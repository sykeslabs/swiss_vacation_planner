"""GeoAdmin normalisation and error handling, against recorded responses (no network)."""

import json
from pathlib import Path

import pytest

from services import geoadmin, http

FIXTURES = Path(__file__).parent / "fixtures"
SEARCH = json.loads((FIXTURES / "geoadmin_search.json").read_text(encoding="utf-8"))
IDENTIFY = json.loads((FIXTURES / "geoadmin_identify.json").read_text(encoding="utf-8"))
IDENTIFY_8001 = IDENTIFY["identify_gemeinde_8001"]["body"]


def search_body(key):
    return SEARCH[key]["body"]


@pytest.fixture(autouse=True)
def clear_caches():
    geoadmin._search_cache.clear()
    geoadmin._identify_cache.clear()
    yield


class FakeApi:
    """Stands in for services.http.get_json; routes by URL and records calls."""

    def __init__(self, search=None, identify=None, search_error=None, identify_error=None,
                 gazetteer=None, gazetteer_error=None):
        self.search, self.identify = search, identify
        self.search_error, self.identify_error = search_error, identify_error
        self.gazetteer = gazetteer if gazetteer is not None else {"results": []}
        self.gazetteer_error = gazetteer_error
        self.calls = []

    def __call__(self, service, url, params=None, **kwargs):
        self.calls.append((url, dict(params or {})))
        assert service == "geoadmin"
        if url == geoadmin.SEARCH_URL and (params or {}).get("origins") == "gazetteer":
            if self.gazetteer_error:
                raise self.gazetteer_error
            return self.gazetteer
        if url == geoadmin.SEARCH_URL:
            if self.search_error:
                raise self.search_error
            return self.search
        if url == geoadmin.IDENTIFY_URL:
            if self.identify_error:
                raise self.identify_error
            return self.identify
        raise AssertionError(f"unexpected URL {url}")

    def count(self, url):
        return sum(1 for u, _ in self.calls if u == url)


@pytest.fixture
def fake(monkeypatch):
    def install(**kwargs):
        api = FakeApi(**kwargs)
        monkeypatch.setattr(http, "get_json", api)
        return api
    return install


# --- normalisation -------------------------------------------------------------------

def test_municipality_normalised():
    attrs = search_body("Zürich|gg25,zipcode")["results"][0]["attrs"]
    loc = geoadmin.normalise_municipality(attrs, "2026-10-02T00:00:00+00:00")
    assert loc.id == "bfs-261"
    assert loc.name == "Zürich" and loc.municipality == "Zürich"
    assert loc.municipality_id == 261
    assert loc.canton == "ZH"
    assert loc.postcode is None
    assert loc.latitude == pytest.approx(47.3772, abs=1e-3)
    assert loc.longitude == pytest.approx(8.5273, abs=1e-3)
    assert loc.source == geoadmin.SOURCE and loc.source_url == geoadmin.SEARCH_URL
    assert loc.retrieved_at == "2026-10-02T00:00:00+00:00"


def test_lake_is_not_a_municipality():
    lake = next(r["attrs"] for r in search_body("Zürich|gg25,zipcode")["results"]
                if "see" in r["attrs"]["label"].lower())
    assert int(lake["featureId"]) >= 9000
    assert geoadmin.normalise_municipality(lake, "t") is None


@pytest.mark.parametrize("label", ["<b>Zürich</b>", "", "<b>Zürich (Z)</b>"])
def test_label_without_canton_is_rejected(label):
    attrs = {"featureId": "261", "lat": 47.0, "lon": 8.0, "label": label}
    assert geoadmin.normalise_municipality(attrs, "t") is None


def test_html_is_stripped_from_names():
    attrs = {"featureId": "371", "lat": 47.1, "lon": 7.2, "label": "<b>Biel/Bienne <i>(BE)</i></b>"}
    loc = geoadmin.normalise_municipality(attrs, "t")
    assert loc.name == "Biel/Bienne" and loc.canton == "BE"
    assert "<" not in loc.name


def test_parse_postcode():
    attrs = search_body("8001|zipcode")["results"][0]["attrs"]
    plz, place, lat, lon = geoadmin.parse_postcode(attrs)
    assert (plz, place) == ("8001", "Zürich")
    assert lat == pytest.approx(47.3729, abs=1e-3)


def test_parse_identify_picks_current_year():
    many_years = {"results": [
        {"attributes": {"gde_nr": 7700, "gemname": "Alt", "kanton": "ZH", "is_current_jahr": False}},
        *IDENTIFY_8001["results"],
    ]}
    assert geoadmin.parse_identify(many_years) == (261, "Zürich", "ZH")
    assert geoadmin.parse_identify({"results": []}) is None
    assert geoadmin.parse_identify({}) is None


# --- search ----------------------------------------------------------------------------

def test_name_search_returns_municipalities_only(fake):
    api = fake(search=search_body("Appenzell|gg25,zipcode"))
    locs = geoadmin.search_locations("Appenzell")
    # "Appenzell" and "Appenzello" share BFS 3101 -> one result
    assert [l.id for l in locs].count("bfs-3101") == 1
    assert all(l.postcode is None for l in locs)
    assert api.calls[0][1]["origins"] == "gg25"
    assert api.count(geoadmin.IDENTIFY_URL) == 0


def test_name_search_drops_lakes(fake):
    fake(search=search_body("Zürich|gg25,zipcode"))
    locs = geoadmin.search_locations("Zürich")
    assert [l.id for l in locs] == ["bfs-261"]


def test_postcode_search_resolves_municipality(fake):
    api = fake(search=search_body("8001|zipcode"), identify=IDENTIFY_8001)
    locs = geoadmin.search_locations("8001")
    assert len(locs) == 1
    loc = locs[0]
    assert loc.id == "bfs-261-plz-8001"
    assert (loc.name, loc.postcode, loc.municipality, loc.municipality_id, loc.canton) == \
        ("Zürich", "8001", "Zürich", 261, "ZH")
    assert api.calls[0][1]["origins"] == "zipcode"
    identify_params = next(p for u, p in api.calls if u == geoadmin.IDENTIFY_URL)
    assert identify_params["layers"] == f"all:{geoadmin.MUNICIPALITY_LAYER}"
    assert "timeInstant" in identify_params


def test_identify_falls_back_to_previous_year(fake, monkeypatch):
    answers = iter([{"results": []}, IDENTIFY_8001])
    api = fake(search=search_body("8001|zipcode"))
    api.identify = None
    original = api.__call__

    def call(service, url, params=None, **kw):
        if url == geoadmin.IDENTIFY_URL:
            api.calls.append((url, dict(params)))
            return next(answers)
        return original(service, url, params, **kw)

    monkeypatch.setattr(http, "get_json", call)
    locs = geoadmin.search_locations("8001")
    years = [int(p["timeInstant"]) for u, p in api.calls if u == geoadmin.IDENTIFY_URL]
    assert years[1] == years[0] - 1
    assert locs[0].municipality_id == 261


def test_results_are_cached(fake):
    api = fake(search=search_body("Bern|"))
    first = geoadmin.search_locations("Bern")
    calls_after_first = len(api.calls)
    second = geoadmin.search_locations("  bern ")
    assert first == second
    assert calls_after_first == 2            # municipalities + settlement points
    assert len(api.calls) == calls_after_first


def test_search_outage_raises(fake):
    fake(search_error=http.UpstreamError("geoadmin", "ConnectTimeout"))
    with pytest.raises(http.UpstreamError):
        geoadmin.search_locations("Bern")


def test_identify_outage_raises_and_is_not_cached(fake):
    api = fake(search=search_body("8001|zipcode"),
               identify_error=http.UpstreamError("geoadmin", "HTTP 503"))
    with pytest.raises(http.UpstreamError):
        geoadmin.search_locations("8001")
    api.identify_error, api.identify = None, IDENTIFY_8001
    assert geoadmin.search_locations("8001")[0].id == "bfs-261-plz-8001"


def test_partial_identify_failure_keeps_good_results_uncached(fake, monkeypatch):
    two = {"results": [
        {"attrs": {"origin": "zipcode", "label": "<b>8001 - Zürich</b>", "lat": 47.37, "lon": 8.54}},
        {"attrs": {"origin": "zipcode", "label": "<b>8002 - Zürich</b>", "lat": 47.36, "lon": 8.53}},
    ]}

    def call(service, url, params=None, **kw):
        if url == geoadmin.SEARCH_URL:
            return two
        if params["geometry"].startswith("8.53"):
            raise http.UpstreamError("geoadmin", "HTTP 500")
        return IDENTIFY_8001

    monkeypatch.setattr(http, "get_json", call)
    locs = geoadmin.search_locations("800")
    assert [l.postcode for l in locs] == ["8001"]
    assert geoadmin._search_cache.get("800") is None


def test_malformed_results_are_skipped(fake):
    fake(search={"results": [{"attrs": {"origin": "gg25", "label": "<b>X (ZH)</b>"}},
                             {"nope": 1}, {"attrs": None}]})
    assert geoadmin.search_locations("Xyz") == []


# --- settlement point and postcodes (owner feedback after M3) ----------------------------

GAZ = json.loads((FIXTURES / "geoadmin_gazetteer.json").read_text(encoding="utf-8"))


def test_dot_is_placed_on_the_settlement_not_the_municipality_centre(fake):
    fake(search=GAZ["Baden|gg25"]["body"], gazetteer=GAZ["Baden|gazetteer"]["body"])
    baden = next(l for l in geoadmin.search_locations("Baden") if l.id == "bfs-4021")
    # gg25 representative point is 47.4702, 8.2922; the town (settlement name) is here:
    assert (round(baden.latitude, 4), round(baden.longitude, 4)) == (47.4759, 8.3032)


def test_settlement_in_several_municipalities_matches_by_list(fake):
    fake(search=GAZ["Zürich|gg25"]["body"], gazetteer=GAZ["Zürich|gazetteer"]["body"])
    zh = next(l for l in geoadmin.search_locations("Zürich") if l.id == "bfs-261")
    assert (round(zh.latitude, 4), round(zh.longitude, 4)) == (47.3839, 8.5301)


def test_settlement_with_same_name_elsewhere_is_not_used():
    settlements = [s for s in (geoadmin.parse_settlement(r["attrs"])
                               for r in GAZ["Biel|gazetteer"]["body"]["results"]) if s]
    biel_bienne = geoadmin.normalise_municipality(
        next(r["attrs"] for r in GAZ["Biel|gg25"]["body"]["results"] if r["attrs"]["featureId"] == "371"), "t")
    lat, lon = geoadmin.settlement_point(biel_bienne, settlements)
    assert (round(lat, 4), round(lon, 4)) == (47.1431, 7.2627)      # "Biel/Bienne (BE)"
    # The settlement "Biel" (BL) lies in Titterten, so it must not move a place in Biel-Benken.
    from dataclasses import replace
    biel_benken = replace(biel_bienne, name="Biel", municipality="Biel-Benken", canton="BL")
    assert geoadmin.settlement_point(biel_benken, settlements) is None


def test_parse_settlement_labels():
    rows = GAZ["Bern|gazetteer"]["body"]["results"]
    name, canton, munis, lat, lon = geoadmin.parse_settlement(rows[0]["attrs"])
    assert (name, canton) == ("Bern", "BE") and "Bern" in munis and "Köniz" in munis
    assert geoadmin.parse_settlement({"objectclass": "TLM_AUS_EINFAHRT", "label": "x"}) is None


def test_gazetteer_failure_keeps_municipality_point_uncached(fake):
    api = fake(search=GAZ["Baden|gg25"]["body"], gazetteer_error=http.UpstreamError("geoadmin", "HTTP 500"))
    baden = next(l for l in geoadmin.search_locations("Baden") if l.id == "bfs-4021")
    assert round(baden.latitude, 4) == 47.4702
    assert geoadmin._search_cache.get("baden") is None


def test_municipality_results_carry_postcodes(fake):
    fake(search=GAZ["Baden|gg25"]["body"], gazetteer=GAZ["Baden|gazetteer"]["body"])
    baden = next(l for l in geoadmin.search_locations("Baden") if l.id == "bfs-4021")
    assert "5400" in baden.postcodes and list(baden.postcodes) == sorted(baden.postcodes)
    assert baden.to_dict()["postcodes"] == list(baden.postcodes)


def test_missing_postcode_file_degrades(monkeypatch, tmp_path):
    geoadmin.postcodes_by_bfs.cache_clear()
    monkeypatch.setattr(geoadmin, "POSTCODES_FILE", tmp_path / "missing.json")
    try:
        assert geoadmin.postcodes_by_bfs() == {}
    finally:
        geoadmin.postcodes_by_bfs.cache_clear()


def test_same_town_key():
    from domain.models import Location
    common = dict(municipality="Baden", municipality_id=4021, canton="AG", latitude=47.47,
                  longitude=8.30, source="", source_url="", retrieved_at="")
    town = Location(id="bfs-4021", name="Baden", postcode=None, **common)
    via_plz = Location(id="bfs-4021-plz-5400", name="Baden", postcode="5400", **common)
    other_village = Location(id="bfs-4021-plz-5300", name="Turgi", postcode="5300", **common)
    assert town.town_key() == via_plz.town_key()
    assert town.town_key() != other_village.town_key()


# --- reverse lookup: click on the map (owner request 2026-10-03) ---------------------------------

PLZ_ID = json.loads((FIXTURES / "geoadmin_identify_plz.json").read_text(encoding="utf-8"))


def muni_identify(bfs, name, canton):
    return {"results": [{"attributes": {"gde_nr": bfs, "gemname": name, "kanton": canton, "is_current_jahr": True}}]}


class PointApi:
    """identify (municipality / postcode layer) + search, routed by parameters."""

    def __init__(self, muni, plz, searches):
        self.muni, self.plz, self.searches, self.calls = muni, plz, searches, []

    def __call__(self, service, url, params=None, **kw):
        self.calls.append((url, dict(params or {})))
        if url == geoadmin.IDENTIFY_URL:
            return self.plz if geoadmin.PLZ_LAYER in params["layers"] else self.muni
        key = (params["searchText"], params["origins"])
        return self.searches.get(key, {"results": []})


@pytest.fixture
def point_api(monkeypatch):
    geoadmin._locate_cache.clear()
    def install(api):
        monkeypatch.setattr(http, "get_json", api)
        return api
    return install


def test_click_on_a_town_gives_the_municipality(point_api):
    point_api(PointApi(muni_identify(4021, "Baden", "AG"), PLZ_ID["baden"]["body"], {
        ("Baden", "gg25"): GAZ["Baden|gg25"]["body"], ("Baden", "gazetteer"): GAZ["Baden|gazetteer"]["body"]}))
    loc = geoadmin.locate(47.4759, 8.3032)
    assert loc.id == "bfs-4021" and loc.postcode is None and "5400" in loc.postcodes
    assert (round(loc.latitude, 4), round(loc.longitude, 4)) == (47.4759, 8.3032)      # settlement point


def test_click_on_a_village_gives_the_postcode_locality(point_api):
    wengen_search = {"results": [{"attrs": {"origin": "zipcode", "label": "<b>3823 - Wengen</b>",
                                            "lat": 46.6085, "lon": 7.9220}}]}
    point_api(PointApi(muni_identify(584, "Lauterbrunnen", "BE"), PLZ_ID["wengen"]["body"],
                       {("3823", "zipcode"): wengen_search}))
    loc = geoadmin.locate(46.6085, 7.9220)
    assert loc.id == "bfs-584-plz-3823" and loc.name == "Wengen" and loc.municipality == "Lauterbrunnen"


def test_click_on_a_lake_or_abroad_gives_nothing(point_api):
    api = point_api(PointApi({"results": []}, {"results": []}, {}))
    assert geoadmin.locate(47.25, 8.65) is None
    assert geoadmin.locate(47.25, 8.65) is None
    assert len(api.calls) <= 2                                    # cached


def test_reverse_lookup_falls_back_to_the_clicked_point(point_api):
    point_api(PointApi(muni_identify(4021, "Baden", "AG"), {"results": []}, {}))
    loc = geoadmin.locate(47.47, 8.30)
    assert loc.id == "bfs-4021" and loc.latitude == 47.47 and loc.canton == "AG"


def test_api_at_point(client, monkeypatch):
    from domain.models import Location
    baden = Location(id="bfs-4021", name="Baden", postcode=None, municipality="Baden", municipality_id=4021,
                     canton="AG", latitude=47.4759, longitude=8.3032, source="s", source_url="u", retrieved_at="t")
    monkeypatch.setattr(geoadmin, "locate", lambda lat, lon: baden)
    assert client.get("/api/locations/at?lat=47.47&lon=8.30").get_json()["location"]["id"] == "bfs-4021"
    assert client.get("/api/locations/at?lat=52.5&lon=13.4").get_json() == {"location": None}   # Berlin
    assert client.get("/api/locations/at?lat=x&lon=8").status_code == 400
    def down(lat, lon):
        raise http.UpstreamError("geoadmin", "ReadTimeout")
    monkeypatch.setattr(geoadmin, "locate", down)
    res = client.get("/api/locations/at?lat=47.47&lon=8.30")
    assert res.status_code == 503 and "ReadTimeout" not in res.get_data(as_text=True)


# --- lakeside postcode: the zipcode point lies in a lake (owner report: 8590 Romanshorn) --------

LAKE = json.loads((FIXTURES / "geoadmin_8590_lake.json").read_text(encoding="utf-8"))


def lake_api(calls, gg25_error=None):
    def api(service, url, params=None, **kwargs):
        p = dict(params or {})
        calls.append((url, p.get("origins")))
        if url == geoadmin.IDENTIFY_URL:
            return LAKE["identify_lake"]
        if p.get("origins") == "zipcode":
            return LAKE["zipcode_8590"]
        if p.get("origins") == "gg25":
            if gg25_error:
                raise gg25_error
            return LAKE["gg25_romanshorn"]
        if p.get("origins") == "gazetteer":
            return LAKE["gazetteer_romanshorn"]
        raise AssertionError(url)
    return api


def test_postcode_in_a_lake_falls_back_to_the_named_municipality(monkeypatch):
    calls = []
    monkeypatch.setattr(http, "get_json", lake_api(calls))
    [loc] = geoadmin.search_locations("8590")
    assert (loc.id, loc.name, loc.postcode, loc.municipality, loc.canton) == \
        ("bfs-4436-plz-8590", "Romanshorn", "8590", "Romanshorn", "TG")
    # placed on land (settlement / municipality point), not on the lake point
    assert (loc.latitude, loc.longitude) != (47.60099411010742, 9.400177001953125)
    assert 47.5 < loc.latitude < 47.6 and 9.3 < loc.longitude < 9.45
    assert ("gg25" in [o for _, o in calls])


def test_lake_fallback_outage_is_not_cached(monkeypatch):
    calls = []
    monkeypatch.setattr(http, "get_json", lake_api(calls, gg25_error=http.UpstreamError("geoadmin", "down")))
    with pytest.raises(http.UpstreamError):
        geoadmin.search_locations("8590")
    monkeypatch.setattr(http, "get_json", lake_api(calls))
    assert [l.postcode for l in geoadmin.search_locations("8590")] == ["8590"]
