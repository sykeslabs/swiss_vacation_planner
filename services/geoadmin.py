"""GeoAdmin (swisstopo) location search, normalised into `Location`.

Observed API behaviour (see docs/PLAN.md §4.1 and docs/samples/):
- `gg25` results: featureId is the BFS municipality number; the canton is only in the
  label ("<b>Zürich (ZH)</b>"). Lakes are also in gg25, with BFS numbers >= 9000.
  Translated names repeat the same featureId ("Appenzello (AI)").
- `zipcode` results carry no BFS number or canton, so the municipality is resolved by a
  point query (`identify`) on the municipality boundary layer.
- Text queries match only `gg25`; the zipcode layer matches only digits.
- The `gg25` point is a representative point of the whole municipality, which can be
  far from the town (Baden since its mergers: ~1 km). The settlement name point from
  the `gazetteer` origin (objectclass TLM_SIEDLUNGSNAME) marks the town itself.
- Postcodes of a municipality come from the official locality directory, bundled as
  data/postcodes.json (scripts/build_postcodes.py).
"""

import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path

from domain.models import Location
from services import http
from services.cache import TTLCache

POSTCODES_FILE = Path(__file__).resolve().parent.parent / "data" / "postcodes.json"

log = logging.getLogger(__name__)

SERVICE = "geoadmin"
SOURCE = "GeoAdmin (swisstopo)"
SEARCH_URL = "https://api3.geo.admin.ch/rest/services/api/SearchServer"
IDENTIFY_URL = "https://api3.geo.admin.ch/rest/services/api/MapServer/identify"
MUNICIPALITY_LAYER = "ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill"

MAX_RESULTS = 8
LAKE_BFS_MIN = 9000
CACHE_TTL_S = 24 * 3600

_search_cache = TTLCache(CACHE_TTL_S)
_identify_cache = TTLCache(CACHE_TTL_S, max_items=2048)

_TAG = re.compile(r"<[^>]+>")
_ITALIC = re.compile(r"<i>.*?</i>", re.S)
_MUNICIPALITY_LABEL = re.compile(r"^(?P<name>.+?)\s*\((?P<canton>[A-Z]{2})\)$")
_ZIP_LABEL = re.compile(r"^(?P<plz>\d{4})\s*-\s*(?P<place>.+)$")
# "<i>Ort</i> <b>Baden</b> (AG) - Baden"  /  "<b>Bern</b> (BE) - Bremgarten bei Bern,Bern,…"
_SETTLEMENT_LABEL = re.compile(r"^(?P<name>.+?)\s*\((?P<canton>[A-Z]{2})\)\s*-\s*(?P<munis>.+)$")
SETTLEMENT_CLASS = "TLM_SIEDLUNGSNAME"


def _now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _clean(label: str) -> str:
    return " ".join(_TAG.sub("", label or "").split())


def is_postcode_query(q: str) -> bool:
    return q[:1].isdigit()


@lru_cache(maxsize=1)
def postcodes_by_bfs() -> dict[str, list[str]]:
    """BFS number → postcodes. A missing or broken file only drops the postcode display."""
    try:
        return json.loads(POSTCODES_FILE.read_text(encoding="utf-8"))["by_bfs"]
    except (OSError, ValueError, KeyError) as exc:
        log.warning("Postcode directory unavailable: %s", exc)
        return {}


def parse_settlement(attrs: dict) -> tuple[str, str, list[str], float, float] | None:
    """(name, canton, municipalities, lat, lon) of a gazetteer settlement-name result."""
    if attrs.get("objectclass") != SETTLEMENT_CLASS:
        return None
    m = _SETTLEMENT_LABEL.match(_clean(_ITALIC.sub("", attrs.get("label", ""))))
    if not m:
        return None
    try:
        lat, lon = float(attrs["lat"]), float(attrs["lon"])
    except (KeyError, TypeError, ValueError):
        return None
    munis = [x.strip() for x in m["munis"].split(",") if x.strip()]
    return m["name"], m["canton"], munis, lat, lon


def settlement_point(loc: Location, settlements: list[tuple]) -> tuple[float, float] | None:
    """Point of the settlement that carries the municipality's own name, if any."""
    for name, canton, munis, lat, lon in settlements:
        if canton == loc.canton and name.casefold() == loc.name.casefold() \
                and any(m.casefold() == loc.municipality.casefold() for m in munis):
            return lat, lon
    return None


def normalise_municipality(attrs: dict, retrieved_at: str) -> Location | None:
    """Turn a `gg25` search result into a Location, or None if it isn't a municipality."""
    try:
        bfs = int(attrs["featureId"])
        lat, lon = float(attrs["lat"]), float(attrs["lon"])
    except (KeyError, TypeError, ValueError):
        return None
    if bfs >= LAKE_BFS_MIN:
        return None
    m = _MUNICIPALITY_LABEL.match(_clean(attrs.get("label", "")))
    if not m:
        return None
    return Location(
        id=f"bfs-{bfs}",
        name=m["name"],
        postcode=None,
        municipality=m["name"],
        municipality_id=bfs,
        canton=m["canton"],
        latitude=lat,
        longitude=lon,
        source=SOURCE,
        source_url=SEARCH_URL,
        retrieved_at=retrieved_at,
        postcodes=tuple(postcodes_by_bfs().get(str(bfs), ())),
    )


def parse_postcode(attrs: dict) -> tuple[str, str, float, float] | None:
    """(postcode, locality, lat, lon) from a `zipcode` search result."""
    m = _ZIP_LABEL.match(_clean(attrs.get("label", "")))
    if not m:
        return None
    try:
        return m["plz"], m["place"], float(attrs["lat"]), float(attrs["lon"])
    except (KeyError, TypeError, ValueError):
        return None


def parse_identify(body: dict) -> tuple[int, str, str] | None:
    """(BFS number, municipality name, canton) of the current municipality in an identify response."""
    results = (body or {}).get("results") or []
    current = [r for r in results if (r.get("attributes") or {}).get("is_current_jahr")]
    for r in current or results:
        a = r.get("attributes") or {}
        try:
            bfs = int(a["gde_nr"])
        except (KeyError, TypeError, ValueError):
            continue
        name, canton = a.get("gemname"), a.get("kanton")
        if name and canton and bfs < LAKE_BFS_MIN:
            return bfs, name, canton
    return None


def _identify_municipality(lat: float, lon: float) -> tuple[int, str, str] | None:
    key = (round(lat, 5), round(lon, 5))
    cached = _identify_cache.get(key)
    if cached is not None:
        return cached
    year = datetime.now(UTC).year
    found = None
    # The boundary layer is versioned per year; early in a year the new edition may be missing.
    for time_instant in (year, year - 1):
        body = http.get_json(SERVICE, IDENTIFY_URL, {
            "geometry": f"{lon},{lat}",
            "geometryType": "esriGeometryPoint",
            "sr": "4326",
            "layers": f"all:{MUNICIPALITY_LAYER}",
            "tolerance": "0",
            "returnGeometry": "false",
            "timeInstant": str(time_instant),
            "lang": "de",
        })
        found = parse_identify(body)
        if found:
            break
    if found:
        _identify_cache.set(key, found)
    return found


class _LookupFailed:
    """Marker for a postcode whose municipality lookup failed (result must not be cached)."""


def _postcode_location(attrs: dict, retrieved_at: str) -> Location | type[_LookupFailed] | None:
    parsed = parse_postcode(attrs)
    if not parsed:
        return None
    plz, place, lat, lon = parsed
    try:
        muni = _identify_municipality(lat, lon)
    except http.UpstreamError as exc:
        log.warning("GeoAdmin identify failed for %s: %s", plz, exc.reason)
        return _LookupFailed
    if not muni:
        return None
    bfs, municipality, canton = muni
    return Location(
        id=f"bfs-{bfs}-plz-{plz}",
        name=place,
        postcode=plz,
        municipality=municipality,
        municipality_id=bfs,
        canton=canton,
        latitude=lat,
        longitude=lon,
        source=SOURCE,
        source_url=SEARCH_URL,
        retrieved_at=retrieved_at,
    )


def _settlements(q: str) -> list[tuple] | None:
    """Settlement-name points matching the query; None if the lookup failed."""
    try:
        body = http.get_json(SERVICE, SEARCH_URL, {
            "searchText": q,
            "type": "locations",
            "origins": "gazetteer",
            "sr": "4326",
            "limit": "30",
        })
    except http.UpstreamError as exc:
        log.warning("GeoAdmin gazetteer lookup failed for %r: %s", q, exc.reason)
        return None
    parsed = (parse_settlement(r.get("attrs") or {}) for r in (body or {}).get("results") or [])
    return [s for s in parsed if s]


def _at_settlement(loc: Location | None, settlements: list[tuple]) -> Location | None:
    if loc is None:
        return None
    point = settlement_point(loc, settlements)
    return replace(loc, latitude=point[0], longitude=point[1]) if point else loc


def search_locations(query: str) -> list[Location]:
    """Search municipalities by name or localities by postcode. Raises UpstreamError."""
    q = " ".join(query.split())
    cache_key = q.casefold()
    cached = _search_cache.get(cache_key)
    if cached is not None:
        return cached

    postcode = is_postcode_query(q)
    body = http.get_json(SERVICE, SEARCH_URL, {
        "searchText": q,
        "type": "locations",
        "origins": "zipcode" if postcode else "gg25",
        "sr": "4326",
        "limit": str(MAX_RESULTS * 2),   # headroom for dropped lakes and duplicates
    })
    retrieved_at = _now_iso()
    attrs_list = [r.get("attrs") or {} for r in (body or {}).get("results") or []]

    if postcode:
        candidates = [a for a in attrs_list if a.get("origin") == "zipcode"][:MAX_RESULTS]
        with ThreadPoolExecutor(max_workers=4) as pool:
            locations = list(pool.map(lambda a: _postcode_location(a, retrieved_at), candidates))
    else:
        locations = [normalise_municipality(a, retrieved_at)
                     for a in attrs_list if a.get("origin") == "gg25"]
        if any(locations):
            settlements = _settlements(q)
            if settlements is None:
                locations.append(_LookupFailed)        # keep gg25 points, don't cache
            else:
                locations = [_at_settlement(loc, settlements) for loc in locations]

    lookup_failed = any(loc is _LookupFailed for loc in locations)
    if lookup_failed and not any(isinstance(loc, Location) for loc in locations):
        # Every municipality lookup failed: report the outage instead of "no results".
        raise http.UpstreamError(SERVICE, "identify failed for all postcode results")

    result, seen = [], set()
    for loc in locations:
        if isinstance(loc, Location) and loc.id not in seen:
            seen.add(loc.id)
            result.append(loc)
    result = result[:MAX_RESULTS]
    if not lookup_failed:
        _search_cache.set(cache_key, result)
    return result


# --- reverse lookup: "which place is at this map point?" (click on the map) ---------------------

PLZ_LAYER = "ch.swisstopo-vd.ortschaftenverzeichnis_plz"
_locate_cache = TTLCache(CACHE_TTL_S, max_items=2048)


def parse_plz_identify(body: dict) -> tuple[str, str] | None:
    """(postcode, locality) of the first locality polygon in an identify response."""
    for r in (body or {}).get("results") or []:
        a = r.get("attributes") or {}
        plz, place = a.get("plz"), a.get("langtext")
        if plz and place and str(plz).isdigit():
            return f"{int(plz):04d}", str(place)
    return None


def locate(lat: float, lon: float) -> Location | None:
    """The place at a map point, as the same Location a search would return: the
    municipality if the locality carries its name (Baden), otherwise the postcode
    locality (3823 Wengen in Lauterbrunnen). None outside Switzerland or on a lake.
    Raises UpstreamError."""
    key = (round(lat, 4), round(lon, 4))
    cached = _locate_cache.get(key)
    if cached is not None:
        return cached or None
    muni = _identify_municipality(lat, lon)
    if not muni:
        _locate_cache.set(key, False)
        return None
    bfs, municipality, canton = muni
    plz_body = http.get_json(SERVICE, IDENTIFY_URL, {
        "geometry": f"{lon},{lat}", "geometryType": "esriGeometryPoint", "sr": "4326",
        "layers": f"all:{PLZ_LAYER}", "tolerance": "0", "returnGeometry": "false", "lang": "de",
    })
    plz = parse_plz_identify(plz_body)
    found = None
    if plz is None or plz[1].casefold() == municipality.casefold():
        found = next((l for l in search_locations(municipality)
                      if l.municipality_id == bfs and l.postcode is None), None)
    if found is None and plz is not None:
        found = next((l for l in search_locations(plz[0])
                      if l.municipality_id == bfs and l.name.casefold() == plz[1].casefold()), None) \
            or next((l for l in search_locations(plz[0]) if l.municipality_id == bfs), None)
    if found is None:
        # Fallback: the municipality at the clicked point (no settlement point known).
        found = Location(id=f"bfs-{bfs}", name=municipality, postcode=None, municipality=municipality,
                         municipality_id=bfs, canton=canton, latitude=lat, longitude=lon, source=SOURCE,
                         source_url=IDENTIFY_URL, retrieved_at=_now_iso(),
                         postcodes=tuple(postcodes_by_bfs().get(str(bfs), ())))
    _locate_cache.set(key, found)
    return found
