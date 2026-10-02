import pytest

from domain.models import Location
from services import geoadmin
from services.http import UpstreamError

ZURICH = Location(id="bfs-261", name="Zürich", postcode=None, municipality="Zürich",
                  municipality_id=261, canton="ZH", latitude=47.37, longitude=8.53,
                  source=geoadmin.SOURCE, source_url=geoadmin.SEARCH_URL,
                  retrieved_at="2026-10-02T00:00:00+00:00")


@pytest.mark.parametrize("q", ["", "  ", "Zü", "  Zü  "])
def test_short_query_is_rejected(client, monkeypatch, q):
    monkeypatch.setattr(geoadmin, "search_locations", lambda q: pytest.fail("must not call"))
    res = client.get("/api/locations", query_string={"q": q})
    assert res.status_code == 400
    assert res.get_json()["error"]["code"] == "query_too_short"


def test_long_query_is_rejected(client):
    res = client.get("/api/locations", query_string={"q": "x" * 81})
    assert res.status_code == 400


def test_returns_normalised_locations(client, monkeypatch):
    seen = []
    monkeypatch.setattr(geoadmin, "search_locations", lambda q: seen.append(q) or [ZURICH])
    res = client.get("/api/locations", query_string={"q": "  Zürich  "})
    assert res.status_code == 200
    assert seen == ["Zürich"]
    assert res.get_json() == {"locations": [ZURICH.to_dict()]}


def test_geoadmin_down_returns_friendly_503(client, monkeypatch):
    def down(q):
        raise UpstreamError("geoadmin", "ConnectTimeout at https://api3.geo.admin.ch/secret")
    monkeypatch.setattr(geoadmin, "search_locations", down)
    res = client.get("/api/locations", query_string={"q": "Bern"})
    assert res.status_code == 503
    body = res.get_json()
    assert body["error"]["code"] == "geoadmin_unavailable"
    assert "Karte" in body["error"]["message"]
    assert "ConnectTimeout" not in res.get_data(as_text=True)


def test_map_page_still_works_when_geoadmin_down(client, monkeypatch):
    monkeypatch.setattr(geoadmin, "search_locations",
                        lambda q: (_ for _ in ()).throw(UpstreamError("geoadmin", "down")))
    assert client.get("/api/locations?q=Bern").status_code == 503
    assert client.get("/").status_code == 200
    assert client.get("/healthz").status_code == 200
