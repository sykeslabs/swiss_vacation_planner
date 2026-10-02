// Full-screen Swiss base map: swisstopo WMTS tiles in Web Mercator (EPSG:3857).
/* global L */

const WMTS = "https://wmts.geo.admin.ch/1.0.0/{layer}/default/current/3857/{z}/{x}/{y}.jpeg";

const ATTRIBUTION =
  '© <a href="https://www.swisstopo.admin.ch/de/home.html" target="_blank" rel="noopener">swisstopo</a>';

// Switzerland, slightly padded so the border regions stay reachable.
const SWISS_BOUNDS = [[45.6, 5.7], [48.0, 10.7]];
const MAX_BOUNDS = [[44.8, 4.4], [48.9, 12.0]];

export const BASE_LAYERS = {
  map: { id: "ch.swisstopo.pixelkarte-farbe", maxNativeZoom: 18 },
  satellite: { id: "ch.swisstopo.swissimage", maxNativeZoom: 19 },
};

const TILE_ERROR_THRESHOLD = 6;

function makeLayer(key, onTilesFailing, onTilesOk) {
  const cfg = BASE_LAYERS[key];
  const layer = L.tileLayer(WMTS.replace("{layer}", cfg.id), {
    attribution: ATTRIBUTION,
    maxNativeZoom: cfg.maxNativeZoom,
    maxZoom: 19,
    crossOrigin: true,
  });
  let errors = 0;
  layer.on("tileerror", () => {
    errors += 1;
    if (errors === TILE_ERROR_THRESHOLD) onTilesFailing();
  });
  layer.on("load", () => {
    if (errors >= TILE_ERROR_THRESHOLD) onTilesOk();
    errors = 0;
  });
  return layer;
}

/**
 * Create the map in `el`. Returns { map, setBaseLayer(key), activeBaseLayer() }.
 * `onNotice(text|null)` shows or clears a non-blocking message.
 */
export function createSwissMap(el, { onNotice = () => {} } = {}) {
  const map = L.map(el, {
    zoomControl: false,
    maxBounds: MAX_BOUNDS,
    maxBoundsViscosity: 0.8,
    minZoom: 7,
    maxZoom: 19,
  });
  map.attributionControl.setPrefix(
    '<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>'
  );
  L.control.zoom({ position: "bottomright", zoomInTitle: "Hineinzoomen", zoomOutTitle: "Herauszoomen" })
    .addTo(map);
  map.fitBounds(SWISS_BOUNDS);

  const failing = () => onNotice("Kartenkacheln von swisstopo konnten nicht geladen werden.");
  const ok = () => onNotice(null);
  const layers = Object.fromEntries(
    Object.keys(BASE_LAYERS).map((key) => [key, makeLayer(key, failing, ok)])
  );

  let active = null;
  function setBaseLayer(key) {
    if (!layers[key] || key === active) return;
    if (active) map.removeLayer(layers[active]);
    layers[key].addTo(map);
    active = key;
    onNotice(null);
  }
  setBaseLayer("map");

  return { map, setBaseLayer, activeBaseLayer: () => active };
}
