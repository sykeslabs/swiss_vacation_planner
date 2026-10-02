import { fetchLocations, postOptimize } from "./api.js";
import { bringToFront, makeDraggable, storedPosition, storePosition } from "./draggable.js";
import { createHolidayModal } from "./holiday-modal.js";
import { createSwissMap } from "./map.js";
import { PANEL_GAP, PANEL_WIDTH, rightCoverage } from "./panel-layout.js";
import { createSettingsPanel } from "./planner.js";
import { createSearchBox } from "./search.js";
import { createPlannerStore, firstVisibleMonth, locationLabel, MAX_LOCATIONS, optimizePayload } from "./state.js";
import { createTownPanels } from "./town-panels.js";
import { debounce } from "./util.js";

const PANELS_OPEN_DELAY_MS = 1000;   // search → zoom → ~1 s → panel
const RECALC_DEBOUNCE_MS = 200;
const PLACEHOLDER_SEARCH = "Ort oder PLZ suchen";
const PLACEHOLDER_ADD = "Ort hinzufügen";

const $ = (id) => document.getElementById(id);

function showNotice(text) {
  const notice = $("map-notice");
  notice.textContent = text ?? "";
  notice.hidden = !text;
}

let storage = null;
try {
  storage = window.localStorage;
} catch {
  // storage blocked (e.g. privacy settings): the planner works, it just won't remember
}

let townPanels = null;
const swissMap = createSwissMap($("map"), {
  onNotice: showNotice,
  // Before the first panel is visible, reserve room for one panel.
  getRightCoverage: () => rightCoverage(townPanels?.rects() ?? [], window.innerWidth) || PANEL_WIDTH + PANEL_GAP,
});

const segButtons = document.querySelectorAll(".layer-switch .seg");
for (const btn of segButtons) {
  btn.addEventListener("click", () => {
    swissMap.setBaseLayer(btn.dataset.layer);
    for (const b of segButtons) {
      b.setAttribute("aria-pressed", String(b.dataset.layer === swissMap.activeBaseLayer()));
    }
  });
}

const store = createPlannerStore({ storage });

const searchInput = $("location-search");
const searchLabel = $("location-search-label");
const searchStatus = $("search-status");
createSearchBox({
  input: searchInput,
  list: $("location-results"),
  status: searchStatus,
  fetchLocations,
  isSelected: (location) => store.findSameTown(location) !== null,
  onSelect(location) {
    const result = store.addLocation(location);
    if (result === "full") {
      searchStatus.textContent = `Du kannst höchstens ${MAX_LOCATIONS} Orte vergleichen.`;
      searchStatus.hidden = false;
    }
    if (result === "duplicate") {
      const existing = store.findSameTown(location);
      townPanels.bringToFront(existing.id);
      swissMap.fitLocations([existing]);
    }
  },
});

const settingsRoot = $("settings");
const settings = createSettingsPanel({ root: settingsRoot, store });

// The "Jahr" panel (shared settings) moves like the town panels and remembers its spot.
const SETTINGS_POSITION_KEY = "svp.settings-panel.v1";
const narrowScreen = window.matchMedia("(max-width: 720px)");
const settingsDrag = makeDraggable(settingsRoot, settingsRoot.querySelector(".panel-head"), {
  enabled: () => !narrowScreen.matches,
  onStart: () => bringToFront(settingsRoot),
  onEnd: (pos) => storePosition(storage, SETTINGS_POSITION_KEY, pos),
});
settingsRoot.addEventListener("pointerdown", () => bringToFront(settingsRoot), true);
settingsRoot.addEventListener("focusin", () => bringToFront(settingsRoot));
function placeSettings() {
  if (settingsRoot.hidden) return;
  if (narrowScreen.matches) {
    settingsRoot.style.left = settingsRoot.style.top = "";
    return;
  }
  const below = document.querySelector(".search-panel").getBoundingClientRect();
  const pos = storedPosition(storage, SETTINGS_POSITION_KEY) ?? { left: below.left, top: below.bottom + PANEL_GAP };
  settingsDrag.place(pos.left, pos.top);
}
window.addEventListener("resize", placeSettings);
narrowScreen.addEventListener?.("change", placeSettings);

const holidayModal = createHolidayModal();

townPanels = createTownPanels({
  container: $("town-panels"),
  storage,
  searchPanel: document.querySelector(".search-panel"),
  onRemove: (id) => store.removeLocation(id),
  onHolidayClick: ({ location, day, holidays, from }) =>
    holidayModal.open({ day, holidays, from, town: `${locationLabel(location)} (${location.canton})` }),
});

// --- calendars ------------------------------------------------------------------------------

let latest = null;          // last successful /api/optimize response
let inflight = null;

function renderCalendars() {
  const state = store.get();
  if (!latest || latest.year !== state.year) return;   // a recalculation is pending
  for (const loc of state.locations) {
    const result = latest.per_location[loc.id];
    if (!result) continue;
    const warnings = (result.warnings ?? []).map((w) => w.message);
    const h = result.holidays?.[0];
    townPanels.setResult(loc.id, {
      days: result.days,
      holidays: result.holidays ?? [],
      fromMonth: firstVisibleMonth(state.year),
      statusText: [String(state.year), ...warnings].join(" · "),
      sourceText: h ? `Quelle Feiertage: ${h.source_title} · Kanton ${loc.canton}` : "",
    });
  }
}

async function recalculate() {
  const state = store.get();
  if (!state.locations.length) return;
  inflight?.abort();
  const ctrl = new AbortController();
  inflight = ctrl;
  try {
    latest = await postOptimize(optimizePayload(state), { signal: ctrl.signal });
    renderCalendars();
  } catch (err) {
    if (err.name === "AbortError") return;
    for (const loc of state.locations) townPanels.setStatus(loc.id, err.message);
  } finally {
    if (inflight === ctrl) inflight = null;
  }
}
const scheduleRecalc = debounce(recalculate, RECALC_DEBOUNCE_MS);

// --- wiring -------------------------------------------------------------------------------

function renderChrome(state) {
  const hasTowns = state.locations.length > 0;
  searchInput.placeholder = hasTowns ? PLACEHOLDER_ADD : PLACEHOLDER_SEARCH;
  searchLabel.textContent = hasTowns ? PLACEHOLDER_ADD : PLACEHOLDER_SEARCH;
  const wasHidden = settingsRoot.hidden;
  settingsRoot.hidden = !hasTowns;
  if (wasHidden && hasTowns) placeSettings();
  settings.render(state);
}

let openTimer = null;
store.subscribe((state, change) => {
  renderChrome(state);
  townPanels.sync(state.locations);
  if (change.type === "add" || change.type === "remove") {
    swissMap.setLocations(state.locations, locationLabel);
    swissMap.fitLocations(state.locations);
  }
  if (!state.locations.length) {
    clearTimeout(openTimer);
    townPanels.hide();
    latest = null;
    return;
  }
  if (!townPanels.isShown()) {
    clearTimeout(openTimer);
    openTimer = setTimeout(() => townPanels.show(), PANELS_OPEN_DELAY_MS);
  }
  scheduleRecalc();
});

// Restore a remembered session without the search → zoom → delay sequence.
const initial = store.get();
renderChrome(initial);
if (initial.locations.length) {
  townPanels.show();
  townPanels.sync(initial.locations);
  swissMap.setLocations(initial.locations, locationLabel);
  swissMap.fitLocations(initial.locations);
  recalculate();
}
