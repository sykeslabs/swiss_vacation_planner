import { fetchLocations, postOptimize } from "./api.js";
import { createCalendarView, renderLegend } from "./calendar-view.js";
import { createSwissMap } from "./map.js";
import { createPlannerPanel } from "./planner.js";
import { createSearchBox } from "./search.js";
import { createPlannerStore, locationLabel, MAX_LOCATIONS, optimizePayload } from "./state.js";
import { debounce } from "./util.js";

const PLANNER_OPEN_DELAY_MS = 1000;   // search → zoom → ~1 s → planner panel
const RECALC_DEBOUNCE_MS = 200;

const $ = (id) => document.getElementById(id);

function showNotice(text) {
  const notice = $("map-notice");
  notice.textContent = text ?? "";
  notice.hidden = !text;
}

const swissMap = createSwissMap($("map"), { onNotice: showNotice });

const segButtons = document.querySelectorAll(".layer-switch .seg");
for (const btn of segButtons) {
  btn.addEventListener("click", () => {
    swissMap.setBaseLayer(btn.dataset.layer);
    for (const b of segButtons) {
      b.setAttribute("aria-pressed", String(b.dataset.layer === swissMap.activeBaseLayer()));
    }
  });
}

let storage = null;
try {
  storage = window.localStorage;
} catch {
  // storage blocked (e.g. privacy settings): the planner works, it just won't remember
}
const store = createPlannerStore({ storage });

const locationsHint = $("locations-hint");
const search = createSearchBox({
  input: $("location-search"),
  list: $("location-results"),
  status: $("search-status"),
  fetchLocations,
  isSelected: (id) => store.has(id),
  onSelect(location) {
    const result = store.addLocation(location);
    locationsHint.hidden = result !== "full";
    if (result === "full") locationsHint.textContent = `Du kannst höchstens ${MAX_LOCATIONS} Orte vergleichen.`;
    if (result === "duplicate") {
      store.setActiveLocation(location.id);
      swissMap.fitLocations([location]);
    }
  },
});

const planner = createPlannerPanel({ root: $("planner"), store, onAddLocation: () => search.focus() });

// --- calendar ---------------------------------------------------------------------------

const calendar = createCalendarView($("calendar"));
$("calendar-legend").append(renderLegend());
const calendarStatus = $("calendar-status");
const calendarSource = $("calendar-source");

let latest = null;          // last successful /api/optimize response
let inflight = null;

function renderCalendar() {
  const state = store.get();
  const active = store.activeLocation();
  const result = active && latest?.year === state.year ? latest.per_location[active.id] : null;
  if (!active) {
    calendar.clear();
    calendarStatus.textContent = "";
    calendarSource.textContent = "";
    return;
  }
  if (!result) return;     // a recalculation is pending; keep showing the previous days
  calendar.setDays(result.days);
  const warnings = (result.warnings ?? []).map((w) => w.message);
  calendarStatus.textContent = [`${locationLabel(active)} (${active.canton}) · ${state.year}`, ...warnings].join(" · ");
  const h = result.holidays?.[0];
  calendarSource.textContent = h ? `Quelle Feiertage: ${h.source_title} · Kanton ${active.canton}` : "";
}

async function recalculate() {
  const state = store.get();
  if (!state.locations.length) return;
  inflight?.abort();
  const ctrl = new AbortController();
  inflight = ctrl;
  calendarStatus.textContent = "Kalender wird berechnet …";
  try {
    latest = await postOptimize(optimizePayload(state), { signal: ctrl.signal });
    renderCalendar();
  } catch (err) {
    if (err.name === "AbortError") return;
    calendarStatus.textContent = err.message;
  } finally {
    if (inflight === ctrl) inflight = null;
  }
}
const scheduleRecalc = debounce(recalculate, RECALC_DEBOUNCE_MS);

// --- wiring -------------------------------------------------------------------------------

let openTimer = null;
store.subscribe((state, change) => {
  planner.render(state);
  if (change.type === "add" || change.type === "remove") {
    swissMap.setLocations(state.locations, locationLabel);
    swissMap.fitLocations(state.locations);
  }
  if (!state.locations.length) {
    clearTimeout(openTimer);
    planner.close();
    latest = null;
    renderCalendar();
    return;
  }
  if (!planner.isOpen()) {
    clearTimeout(openTimer);
    openTimer = setTimeout(() => planner.open(), PLANNER_OPEN_DELAY_MS);
  }
  if (change.type === "active") renderCalendar();
  else scheduleRecalc();
});

// Restore a remembered session without the search → zoom → delay sequence.
const initial = store.get();
planner.render(initial);
if (initial.locations.length) {
  swissMap.setLocations(initial.locations, locationLabel);
  swissMap.fitLocations(initial.locations);
  planner.open();
  recalculate();
}
