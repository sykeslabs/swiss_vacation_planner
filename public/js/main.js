import { fetchHolidays, fetchLocations, postOptimize } from "./api.js";
import { applySelection } from "./calendar-model.js";
import { candidateKey } from "./candidate-list.js";
import { makeFloatingPanel } from "./floating-panel.js";
import { createHolidayModal } from "./holiday-modal.js";
import { createSwissMap } from "./map.js";
import { PANEL_GAP, PANEL_WIDTH, rightCoverage } from "./panel-layout.js";
import { createSettingsPanel } from "./planner.js";
import { createSearchBox } from "./search.js";
import { renderSummary } from "./summary-panel.js";
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
  // Before the first panel is visible, reserve room for one panel (and the "Jahr" panel).
  getRightCoverage: () => {
    const rects = [...(townPanels?.rects() ?? [])];
    if (!settingsRoot.hidden) rects.push(settingsRoot.getBoundingClientRect());
    return rightCoverage(rects, window.innerWidth) || PANEL_WIDTH + PANEL_GAP;
  },
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

// "Jahr" panel (shared settings): top right, movable, collapsible, remembered.
const settingsPanel = makeFloatingPanel({
  root: settingsRoot,
  head: settingsRoot.querySelector(".panel-head"),
  toggle: $("settings-toggle"),
  body: $("settings-body"),
  storage,
  positionKey: "svp.settings-panel.v2",        // v2: default moved to the top right
  collapsedKey: "svp.settings-collapsed.v1",
  toggleLabel: "Arbeitstage",
  defaultPosition: (rect) => ({ left: window.innerWidth - PANEL_GAP - rect.width, top: PANEL_GAP }),
});

// Summary panel: left, below the search; movable, collapsible, remembered.
const summaryRoot = $("summary");
const summaryPanel = makeFloatingPanel({
  root: summaryRoot,
  head: summaryRoot.querySelector(".panel-head"),
  toggle: $("summary-toggle"),
  body: $("summary-body"),
  storage,
  positionKey: "svp.summary-panel.v1",
  collapsedKey: "svp.summary-collapsed.v1",
  toggleLabel: "Übersicht",
  defaultPosition: () => {
    const below = document.querySelector(".search-panel").getBoundingClientRect();
    return { left: below.left, top: below.bottom + PANEL_GAP };
  },
});

const holidayModal = createHolidayModal();

townPanels = createTownPanels({
  container: $("town-panels"),
  storage,
  searchPanel: document.querySelector(".search-panel"),
  // Town panels open to the left of the "Jahr" panel (top right).
  rightBoundary: () => (settingsRoot.hidden ? window.innerWidth : Math.round(settingsRoot.getBoundingClientRect().left)),
  onRemove: (id) => store.removeLocation(id),
  onHolidayClick: ({ location, day, holidays, from }) => holidayModal.open({
    day, from, town: `${locationLabel(location)} (${location.canton})`,
    holidays: holidays.map((h) => withWebInfo(location.id, h)),
  }),
});

// --- holidays checked against the web search (GET /api/holidays) ------------------------------

const holidayData = new Map();      // "location_id|year" → response (or an error stand-in)
const holidayInflight = new Set();
const dataKey = (id, year) => `${id}|${year}`;

function holidayLists(state) {
  return Object.fromEntries(state.locations.map((l) => [l.id, holidayData.get(dataKey(l.id, state.year))?.holidays ?? []]));
}

/** Adds confidence, sources and notes from the web check to a holiday of the calendar. */
function withWebInfo(locationId, holiday) {
  const data = holidayData.get(dataKey(locationId, store.get().year));
  const match = data?.holidays?.find((h) => h.date === holiday.date && h.name === holiday.name);
  return match ? { ...holiday, ...match, enabled: holiday.source_title === "von dir aktiviert" ? true : match.enabled } : holiday;
}

function renderHolidaySections(state) {
  for (const loc of state.locations) {
    townPanels.setHolidayData(loc.id, holidayData.get(dataKey(loc.id, state.year)) ?? null, {
      isEnabled: (key) => store.isHolidayEnabled(loc.id, key),
      onToggle: (key) => store.toggleHoliday(loc.id, key),
    });
  }
}

function ensureHolidays(state) {
  for (const loc of state.locations) {
    const key = dataKey(loc.id, state.year);
    if (holidayData.has(key) || holidayInflight.has(key)) continue;
    holidayInflight.add(key);
    fetchHolidays(loc, state.year)
      .then((data) => holidayData.set(key, data))
      .catch((err) => holidayData.set(key, {
        location_id: loc.id, holidays: [], summary: { checked: false },
        warnings: [{ code: "client_error", message: err.message }], failed: true,
      }))
      .finally(() => {
        holidayInflight.delete(key);
        const now = store.get();
        renderHolidaySections(now);
        if (now.year === state.year) scheduleRecalc();     // enabled optional holidays now known
        // a failed check is retried on the next change
        if (holidayData.get(key)?.failed) setTimeout(() => holidayData.delete(key), 0);
      });
  }
}

// --- calendars ------------------------------------------------------------------------------

let latest = null;          // last successful /api/optimize response
let inflight = null;
const selected = new Map();       // location_id → candidate key "start|end"
const sortModes = new Map();      // location_id → "date" | "efficiency"

function findCandidate(result, key) {
  if (!result || !key) return null;
  return [...result.candidates, ...(result.summary?.best ? [result.summary.best] : [])]
    .find((c) => candidateKey(c) === key) ?? null;
}

function selectCandidate(locationId, candidate) {
  if (candidate) selected.set(locationId, candidateKey(candidate));
  else selected.delete(locationId);
  renderCalendars();
}

function renderCalendars() {
  const state = store.get();
  if (!latest || latest.year !== state.year) return;   // a recalculation is pending
  for (const loc of state.locations) {
    const result = latest.per_location[loc.id];
    if (!result) continue;
    // keep a selection only while that exact period still exists
    const chosen = findCandidate(result, selected.get(loc.id));
    if (!chosen) selected.delete(loc.id);
    const warnings = (result.warnings ?? []).map((w) => w.message);
    const h = result.holidays?.[0];
    townPanels.setResult(loc.id, {
      days: applySelection(result.days, chosen),
      holidays: result.holidays ?? [],
      fromMonth: firstVisibleMonth(state.year),
      statusText: [String(state.year), ...warnings].join(" · "),
      sourceText: h ? `Quelle Feiertage: ${h.source_title} · Kanton ${loc.canton}` : "",
    });
    townPanels.setCandidates(loc.id, result, {
      year: state.year,
      selectedKey: selected.get(loc.id) ?? null,
      sortMode: sortModes.get(loc.id) ?? "date",
      onSelect: (c) => selectCandidate(loc.id, c),
      onSort: (mode) => {
        sortModes.set(loc.id, mode);
        renderCalendars();
      },
    });
  }
  renderSummary(summaryRoot, {
    year: state.year,
    rows: state.locations.map((loc) => ({ location: loc, summary: latest.per_location[loc.id]?.summary ?? null })),
    onPick: (loc, best) => {
      selectCandidate(loc.id, best);
      townPanels.bringToFront(loc.id);
    },
  });
}

async function recalculate() {
  const state = store.get();
  if (!state.locations.length) return;
  inflight?.abort();
  const ctrl = new AbortController();
  inflight = ctrl;
  try {
    latest = await postOptimize(optimizePayload(state, holidayLists(state)), { signal: ctrl.signal });
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
  if (hasTowns) {
    settingsPanel.show();
    summaryPanel.show();
  } else {
    settingsPanel.hide();
    summaryPanel.hide();
  }
  settings.render(state);
}

let openTimer = null;
store.subscribe((state, change) => {
  renderChrome(state);
  townPanels.sync(state.locations);
  ensureHolidays(state);
  renderHolidaySections(state);
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
  ensureHolidays(initial);
  renderHolidaySections(initial);
  swissMap.setLocations(initial.locations, locationLabel);
  swissMap.fitLocations(initial.locations);
  recalculate();
}
