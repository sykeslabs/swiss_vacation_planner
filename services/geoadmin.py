"""GeoAdmin (swisstopo) location search, normalised into `Location`.

Observed API behaviour (see docs/PLAN.md §4.1 and docs/samples/):
- `gg25` results: featureId is the BFS municipality number; the canton is only in the
  label ("<b>Zürich (ZH)</b>"). Lakes are also in gg25, with BFS numbers >= 9000.
  Translated names repeat the same featureId ("Appenzello (AI)").
- `zipcode` results carry no BFS number or canton, so the municipality is resolved by a
  point query (`identify`) on the municipality boundary layer.
- Text queries match only `gg25`; the zipcode layer matches only digits.
"""

import logging
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

from domain.models import Location
from services import http
from services.cache import TTLCache

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
_MUNICIPALITY_LABEL = re.compile(r"^(?P<name>.+?)\s*\((?P<canton>[A-Z]{2})\)$")
_ZIP_LABEL = re.compile(r"^(?P<plz>\d{4})\s*-\s*(?P<place>.+)$")


def _now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _clean(label: str) -> str:
    return " ".join(_TAG.sub("", label or "").split())


def is_postcode_query(q: str) -> bool:
    return q[:1].isdigit()


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
