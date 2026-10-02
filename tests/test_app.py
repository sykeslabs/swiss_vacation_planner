import re

from app.errors import ApiError


def test_healthz(client):
    res = client.get("/healthz")
    assert res.status_code == 200
    assert res.get_json() == {"status": "ok"}


def test_index_serves_map_page(client):
    res = client.get("/")
    assert res.status_code == 200
    html = res.get_data(as_text=True)
    assert 'id="map"' in html
    assert 'data-layer="map"' in html and 'data-layer="satellite"' in html
    assert ">Karte<" in html and ">Satellit<" in html
    # Third-party scripts are pinned with SRI.
    for tag in re.findall(r"<(?:script|link)[^>]+unpkg\.com[^>]*>", html):
        assert 'integrity="sha384-' in tag


def test_static_assets_served_from_public(client):
    for path in ("/css/app.css", "/js/main.js", "/js/map.js"):
        res = client.get(path)
        assert res.status_code == 200, path
        res.close()


def test_map_uses_swisstopo_wmts_3857_with_attribution(client):
    js = client.get("/js/map.js").get_data(as_text=True)
    assert "wmts.geo.admin.ch/1.0.0/{layer}/default/current/3857/{z}/{x}/{y}" in js
    assert "ch.swisstopo.pixelkarte-farbe" in js
    assert "ch.swisstopo.swissimage" in js
    assert "swisstopo</a>" in js
    assert "google" not in js.lower()


def test_unknown_api_route_returns_json_error(client):
    res = client.get("/api/does-not-exist")
    assert res.status_code == 404
    body = res.get_json()
    assert set(body["error"]) == {"code", "message"}


def test_api_error_shape(app):
    @app.get("/api/_test_api_error")
    def boom():
        raise ApiError(400, "invalid_year", "Ungültiges Jahr.")

    res = app.test_client().get("/api/_test_api_error")
    assert res.status_code == 400
    assert res.get_json() == {"error": {"code": "invalid_year", "message": "Ungültiges Jahr."}}


def test_unexpected_error_hides_stack_trace(app):
    app.config["PROPAGATE_EXCEPTIONS"] = False

    @app.get("/api/_test_crash")
    def crash():
        raise RuntimeError("secret internal detail")

    res = app.test_client().get("/api/_test_crash")
    assert res.status_code == 500
    text = res.get_data(as_text=True)
    assert "secret internal detail" not in text
    assert "Traceback" not in text
    assert res.get_json()["error"]["code"] == "internal_error"
