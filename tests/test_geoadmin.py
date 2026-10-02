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

    def __init__(self, search=None, identify=None, search_error=None, identify_error=None):
        self.search, self.identify = search, identify
        self.search_error, self.identify_error = search_error, identify_error
        self.calls = []

    def __call__(self, service, url, params=None, **kwargs):
        self.calls.append((url, dict(params or {})))
        assert service == "geoadmin"
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
    second = geoadmin.search_locations("  bern ")
    assert first == second
    assert api.count(geoadmin.SEARCH_URL) == 1


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
