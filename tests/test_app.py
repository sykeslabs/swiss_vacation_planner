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


def test_map_uses_swisstopo_only_with_attribution(client):
    js = client.get("/js/map.js").get_data(as_text=True)
    assert "wmts.geo.admin.ch/1.0.0/{layer}/default/current/3857/{z}/{x}/{y}" in js
    assert "ch.swisstopo.pixelkarte-farbe" in js
    # Satellite: swisstopo vector style with names and borders, raster fallback with border
    assert "vectortiles.geo.admin.ch/styles/ch.swisstopo.imagerybasemap.vt/style.json" in js
    assert "ch.swisstopo.swissimage" in js
    assert "ch.swisstopo.swissboundaries3d-land-flaeche.fill" in js
    assert 'DEFAULT_BASE_LAYER = "satellite"' in js
    assert "swisstopo</a>" in js
    assert "google" not in js.lower()


def test_satellite_is_preselected(client):
    html = client.get("/").get_data(as_text=True)
    assert 'data-layer="satellite" aria-pressed="true"' in html
    assert 'data-layer="map" aria-pressed="false"' in html


def test_page_layout_after_the_scope_change(client):
    html = client.get("/").get_data(as_text=True)
    # The old header is gone completely; the app is called Adam.
    assert "Ferienplaner Schweiz" not in html and "<h1" not in html
    assert "<title>Adam" in html
    # Onboarding wizard container (steps built in wizard.js)
    assert '<section id="wizard"' in html
    # Top right, left to right: ⚙, ?, Reset; with aria-labels and tooltips.
    start = html.index('id="top-controls"')
    controls = html[start:html.index("</nav>", start)]
    ids = ["btn-prefs", "btn-help", "btn-reset"]
    assert [controls.index(f'id="{i}"') for i in ids] == sorted(controls.index(f'id="{i}"') for i in ids)
    for label in ("Präferenzen", "Über Adam", "Alles zurücksetzen"):
        assert re.search(rf'aria-label="{label}"\s+title="{label}"', controls), label
    # "?" is always visible; ⚙ and Reset only after onboarding (hidden at first).
    help_tag = re.search(r'<button id="btn-help"[^>]*>', controls).group(0)
    assert "hidden" not in help_tag
    assert 'id="btn-add"' not in controls
    for i in ("btn-prefs", "btn-reset"):
        assert re.search(rf'<button id="{i}"[^>]*hidden>', controls), i
    # "Deine Orte": "+" (in the title bar) and the town chips only; no vacation type, no preferences.
    start = html.index('<section id="planner"')
    planner = html[start:html.index("</section>", start)]
    assert 'id="town-chips"' in planner
    assert re.search(r'<button id="btn-add"[^>]*aria-label="Ort hinzufügen"', planner)
    assert planner.index('id="btn-add"') < planner.index('id="planner-body"')
    for gone in ("vacation-type", "Was für Ferien", "working-days", "half-day", "planner-budget", "year-badges"):
        assert gone not in planner, gone
    assert 'id="town-panels"' in html


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
