// Full-screen Swiss base map in Web Mercator (EPSG:3857), swisstopo data only.
// - "Karte": swisstopo WMTS raster (pixelkarte-farbe), names and borders included.
// - "Satellit": swisstopo vector style "imagerybasemap" (SWISSIMAGE + place names +
//   borders, as on map.geo.admin.ch), rendered by MapLibre GL through the Leaflet bridge.
//   Without WebGL/MapLibre it falls back to SWISSIMAGE raster + national border overlay.
/* global L */

const WMTS = "https://wmts.geo.admin.ch/1.0.0/{layer}/default/current/3857/{z}/{x}/{y}.{ext}";
export const IMAGERY_STYLE_URL = "https://vectortiles.geo.admin.ch/styles/ch.swisstopo.imagerybasemap.vt/style.json";

const ATTRIBUTION =
  '© <a href="https://www.swisstopo.admin.ch/de/home.html" target="_blank" rel="noopener">swisstopo</a>';

// Bounding box of Switzerland (Chiasso–Schaffhausen, Geneva–Müstair). The view never
// leaves it and can't zoom out further than the level at which it fills the window,
// because swisstopo imagery and maps are blank outside Switzerland.
export const SWISS_BOUNDS = [[45.818, 5.956], [47.808, 10.492]];

export const DEFAULT_BASE_LAYER = "satellite";
const TILE_ERROR_THRESHOLD = 6;

function wmts(id, ext, opts) {
  return L.tileLayer(WMTS.replace("{layer}", id).replace("{ext}", ext), {
    attribution: ATTRIBUTION, maxZoom: 19, crossOrigin: true, ...opts,
  });
}

/** Counts failures and reports them once, until tiles load again. */
function watchErrors(onFailing, onOk) {
  let errors = 0;
  return {
    error() {
      errors += 1;
      if (errors === TILE_ERROR_THRESHOLD) onFailing();
    },
    ok() {
      if (errors >= TILE_ERROR_THRESHOLD) onOk();
      errors = 0;
    },
  };
}

function rasterLayer(layer, watcher) {
  layer.on("tileerror", watcher.error);
  layer.on("load", watcher.ok);
  return layer;
}

function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

function satelliteLayer(watcher) {
  if (typeof L.maplibreGL === "function" && typeof window.maplibregl !== "undefined" && webglAvailable()) {
    try {
      const layer = L.maplibreGL({ style: IMAGERY_STYLE_URL, interactive: false });
      layer.getAttribution = () => ATTRIBUTION;
      layer.on("add", () => {
        const gl = layer.getMaplibreMap();
        gl.on("error", watcher.error);
        gl.on("idle", watcher.ok);
      });
      return layer;
    } catch {
      // fall through to the raster fallback
    }
  }
  return L.layerGroup([
    rasterLayer(wmts("ch.swisstopo.swissimage", "jpeg", { maxNativeZoom: 19 }), watcher),
    wmts("ch.swisstopo.swissboundaries3d-land-flaeche.fill", "png", { maxNativeZoom: 18, attribution: "" }),
  ]);
}

/**
 * Create the map in `el`. Returns { map, setBaseLayer(key), activeBaseLayer() }.
 * `onNotice(text|null)` shows or clears a non-blocking message.
 */
export function createSwissMap(el, { onNotice = () => {}, getRightCoverage = () => 0, onMapClick = null } = {}) {
  const swiss = L.latLngBounds(SWISS_BOUNDS);
  const map = L.map(el, {
    zoomControl: false,
    maxBounds: swiss,
    maxBoundsViscosity: 1.0,   // hard edge: no white beyond the box while panning
    zoomSnap: 0.25,            // lets the "fill the window" zoom fit closely
    maxZoom: 19,
  });
  map.attributionControl.setPrefix(
    '<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>'
  );
  L.control.zoom({ position: "bottomright", zoomInTitle: "Hineinzoomen", zoomOutTitle: "Herauszoomen" })
    .addTo(map);
  // Smallest zoom at which the Swiss box covers the whole window ("inside" fit).
  const coverZoom = () => map.getBoundsZoom(swiss, true);
  function applyZoomFloor() {
    const min = coverZoom();
    map.setMinZoom(min);
    if (map.getZoom() < min) map.setZoom(min, { animate: false });
  }
  map.setView(swiss.getCenter(), coverZoom(), { animate: false });
  applyZoomFloor();
  window.addEventListener("resize", applyZoomFloor);

  const watcher = () => watchErrors(
    () => onNotice("Kartenkacheln von swisstopo konnten nicht geladen werden."),
    () => onNotice(null),
  );
  const layers = {
    map: rasterLayer(wmts("ch.swisstopo.pixelkarte-farbe", "jpeg", { maxNativeZoom: 18 }), watcher()),
    satellite: satelliteLayer(watcher()),
  };

  let active = null;
  function setBaseLayer(key) {
    if (!layers[key] || key === active) return;
    if (active) map.removeLayer(layers[active]);
    layers[key].addTo(map);
    active = key;
    onNotice(null);
  }
  setBaseLayer(DEFAULT_BASE_LAYER);

  const markerLayer = L.layerGroup().addTo(map);
  const markers = new Map();

  /** Sync markers with `locations` (id-keyed); returns nothing. */
  function setLocations(locations, labelOf) {
    const ids = new Set(locations.map((l) => l.id));
    for (const [id, marker] of markers) {
      if (!ids.has(id)) {
        markerLayer.removeLayer(marker);
        markers.delete(id);
      }
    }
    for (const loc of locations) {
      if (markers.has(loc.id)) continue;
      const marker = L.circleMarker([loc.latitude, loc.longitude], {
        radius: 8, weight: 2, color: "#ffffff", fillColor: "#d52b1e", fillOpacity: 0.95,
        bubblingMouseEvents: false,          // a click on a marker is not a "pick a place" click
      });
      // Pass a DOM node, not a string: Leaflet inserts strings as HTML.
      const label = document.createElement("span");
      label.textContent = labelOf(loc);
      marker.bindTooltip(label, { permanent: true, direction: "top", offset: [0, -8], className: "loc-label" });
      marker.addTo(markerLayer);
      markers.set(loc.id, marker);
    }
  }

  // Keep the selected places clear of the town panels (right side, or bottom sheet on phones).
  function viewPadding() {
    const narrow = window.innerWidth <= 720;
    if (narrow) return { paddingTopLeft: [40, 140], paddingBottomRight: [40, Math.round(window.innerHeight * 0.45)] };
    const right = Math.min(Math.round(window.innerWidth * 0.7), Math.max(60, getRightCoverage() + 40));
    return { paddingTopLeft: [60, 60], paddingBottomRight: [right, 60] };
  }

  // Fly animations run on requestAnimationFrame, which browsers pause in background tabs;
  // jump instead there, and for users who prefer reduced motion.
  function shouldAnimate() {
    return !document.hidden && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function fitLocations(locations) {
    if (!locations.length) {
      // Back to the start view: Switzerland filling the window.
      if (shouldAnimate()) map.flyTo(swiss.getCenter(), coverZoom(), { duration: 0.8 });
      else map.setView(swiss.getCenter(), coverZoom(), { animate: false });
      return;
    }
    const bounds = L.latLngBounds(locations.map((l) => [l.latitude, l.longitude]));
    const options = { ...viewPadding(), maxZoom: 12 };
    if (shouldAnimate()) map.flyToBounds(bounds, { ...options, duration: 0.8 });
    else map.fitBounds(bounds, { ...options, animate: false });
  }

  // Picking a place on the map: Leaflet fires "click" only without a drag, so panning
  // and zooming stay unaffected.
  const popup = L.popup({ className: "pick-popup", autoPan: true, maxWidth: 280, closeButton: true });
  if (onMapClick) map.on("click", (e) => onMapClick(e.latlng));
  function showPopup(latlng, node) {
    popup.setLatLng(latlng).setContent(node).openOn(map);   // node, not an HTML string
  }
  const closePopup = () => map.closePopup(popup);

  return { map, setBaseLayer, activeBaseLayer: () => active, setLocations, fitLocations, showPopup, closePopup };
}
