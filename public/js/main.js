import { readAboutConfig } from "./about-view.js";
import { fetchHolidays, fetchLocationAt, fetchLocations, postOptimize } from "./api.js";
import { applyPlan, periodKey } from "./calendar-model.js";
import { createDialog, el } from "./dialog.js";
import { makeFloatingPanel } from "./floating-panel.js";
import { createHelpModal } from "./help-modal.js";
import { createTodoModal } from "./todo-modal.js";
import { createHolidayDaysModal } from "./holiday-days-modal.js";
import { createHolidayModal } from "./holiday-modal.js";
import { createSwissMap } from "./map.js";
import { createPeriodModal } from "./period-modal.js";
import { PANEL_GAP, PANEL_WIDTH, rightCoverage } from "./panel-layout.js";
import { createPlannerPanel } from "./planner.js";
import { createPrefsModal } from "./prefs-modal.js";
import { createSearchBox } from "./search.js";
import {
  canOptimize, createPlannerStore, DONE, firstVisibleMonth, locationDetail, locationLabel, MAX_LOCATIONS,
  optimizePayload,
} from "./state.js";
import { createTownModal } from "./town-modal.js";
import { createTownPanels } from "./town-panels.js";
import { debounce } from "./util.js";
import { createWizard } from "./wizard.js";

const RECALC_DEBOUNCE_MS = 200;

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

const store = createPlannerStore({ storage });
const isDone = () => store.get().onboarding === DONE;

let townPanels = null;
const plannerRoot = $("planner");
const swissMap = createSwissMap($("map"), {
  onNotice: showNotice,
  onMapClick: (latlng) => pickOnMap(latlng),
  // Before the first panel is visible, reserve room for one panel.
  getRightCoverage: () => rightCoverage([...(townPanels?.rects() ?? [])], window.innerWidth) || PANEL_WIDTH + PANEL_GAP,
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

// --- holidays checked against the web search (GET /api/holidays) ------------------------------

const holidayData = new Map();      // "location_id|year" → response (or an error stand-in)
const holidayInflight = new Set();
const dataKey = (id, year) => `${id}|${year}`;
const getHolidayData = (id, year) => holidayData.get(dataKey(id, year)) ?? null;

function holidayLists(state) {
  return Object.fromEntries(state.locations.map((l) => [l.id, getHolidayData(l.id, state.year)?.holidays ?? []]));
}

/** Adds confidence, sources and notes from the web check to a holiday of the calendar. */
function withWebInfo(locationId, holiday) {
  const match = getHolidayData(locationId, store.get().year)?.holidays?.find((h) => h.date === holiday.date && h.name === holiday.name);
  return match ? { ...holiday, ...match, enabled: holiday.source_title === "von dir aktiviert" ? true : match.enabled } : holiday;
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
        townModal.refresh();
        if (store.get().year === state.year) scheduleRecalc();   // disputed/optional switches now known
        // a failed check is retried on the next change
        if (holidayData.get(key)?.failed) setTimeout(() => holidayData.delete(key), 0);
      });
  }
}

// --- modals -----------------------------------------------------------------------------------

// Optional holidays and half days of a town: opened from its panel or its chip (never in the wizard).
const townModal = createTownModal({ store, getHolidayData });
const openTown = (id, from = null) => {
  if (isDone()) townModal.open(id, { from });
};

const prefsModal = createPrefsModal({ store });
const todoModal = createTodoModal();
const helpModal = createHelpModal({
  config: readAboutConfig($("about-config")?.textContent),
  onOpenTodos: (from) => todoModal.open(from),
});
const holidayModal = createHolidayModal();
// "N Feiertage" list; a date opens the same holiday details as a click in the month view.
const holidayDaysModal = createHolidayDaysModal({
  onHolidayClick: ({ locationId, date, from }) => {
    const loc = store.get().locations.find((l) => l.id === locationId);
    const result = latest?.per_location[locationId];
    const day = result?.days.find((d) => d.date === date);
    if (!loc || !day) return;
    holidayModal.open({
      day, from, town: `${locationLabel(loc)} (${loc.canton})`, locationId,
      holidays: (result.holidays ?? []).filter((h) => h.date === date).map((h) => withWebInfo(locationId, h)),
    });
  },
});

const resetDialog = createDialog({ title: "Alles zurücksetzen?", className: "confirm-modal" });
{
  const cancel = el("button", "btn-secondary", "Abbrechen");
  cancel.type = "button";
  cancel.autofocus = true;
  cancel.addEventListener("click", () => resetDialog.close("cancel"));
  const confirm = el("button", "btn-danger", "Zurücksetzen");
  confirm.type = "button";
  confirm.addEventListener("click", () => {
    resetDialog.close("confirm");
    store.reset();
  });
  resetDialog.body.append(el("p", "", "Deine Orte, eigenen Daten und Einstellungen werden gelöscht. "
    + "Danach beginnst du wieder bei Schritt 1."));
  resetDialog.footer.append(cancel, confirm);
  resetDialog.footer.hidden = false;
}

// --- choosing towns: wizard step 2, "+" search, map click --------------------------------------

function chooseWorkLocation(loc) {
  if (!store.setWorkLocation(loc)) return;
  wizard.picked();          // step 2 only zooms to the place; no modal here (owner request)
}

const addSearch = $("add-search");
const searchStatus = $("search-status");
function setAddSearch(open) {
  addSearch.hidden = !open;
  if (open) {
    // opens right below the "Deine Orte" panel that holds the "+" button
    const r = plannerRoot.getBoundingClientRect();
    addSearch.style.left = `${Math.round(r.left)}px`;
    addSearch.style.top = `${Math.round(r.bottom + PANEL_GAP)}px`;
  }
  $("btn-add").setAttribute("aria-expanded", String(open));
  if (open) $("location-search").focus();
}

/** After onboarding: add a town (it inherits the global custom days). Its modal is not opened
 * automatically; the town panel's button or the chip opens it (owner request). */
function addTown(loc) {
  const result = store.addLocation(loc);
  if (result === "full") {
    searchStatus.textContent = `Du kannst höchstens ${MAX_LOCATIONS} Orte vergleichen.`;
    searchStatus.hidden = false;
    return result;
  }
  setAddSearch(false);
  if (result === "duplicate") {
    const existing = store.findSameTown(loc);
    townPanels.bringToFront(existing.id);
    swissMap.fitLocations([existing]);
    return result;
  }
  return result;
}

createSearchBox({
  input: $("location-search"),
  list: $("location-results"),
  status: searchStatus,
  fetchLocations,
  isSelected: (location) => store.findSameTown(location) !== null,
  onSelect: addTown,
});
$("add-search-close").addEventListener("click", () => setAddSearch(false));
addSearch.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $("location-results").hidden) {
    setAddSearch(false);
    $("btn-add").focus();
  }
});

// Pick a place by clicking the map (also in wizard step 2).
let pickRequest = null;
function pickNode(lines, button = null) {
  const box = el("div", "pick");
  for (const [cls, text] of lines) box.append(el("p", cls, text));
  if (button) box.append(button);
  return box;
}
async function pickOnMap(latlng) {
  const step = store.get().onboarding;
  if (step === 1 || step === 3) return;      // map click chooses the work place only in step 2
  pickRequest?.abort();
  const ctrl = new AbortController();
  pickRequest = ctrl;
  swissMap.showPopup(latlng, pickNode([["hint", "Ort wird bestimmt …"]]));
  try {
    const loc = await fetchLocationAt(latlng.lat, latlng.lng, { signal: ctrl.signal });
    if (ctrl.signal.aborted) return;
    if (!loc) {
      swissMap.showPopup(latlng, pickNode([["hint", "Hier liegt kein Schweizer Ort (z. B. ein See oder das Ausland)."]]));
      return;
    }
    const wizardMode = store.get().onboarding === 2;
    const existing = store.findSameTown(loc);
    const b = el("button", "btn-secondary pick-add",
      wizardMode ? "Als Arbeitsort wählen" : existing ? "Anzeigen" : "+ Ort hinzufügen");
    b.type = "button";
    b.addEventListener("click", () => {
      swissMap.closePopup();
      if (store.get().onboarding === 2) chooseWorkLocation(loc);
      else if (isDone()) addTown(loc);
    });
    swissMap.showPopup(latlng, pickNode([
      ["pick-title", `${locationLabel(loc)} (${loc.canton})`],
      ["hint", locationDetail(loc) + (existing && !wizardMode ? " · bereits hinzugefügt" : "")],
    ], b));
  } catch (err) {
    if (err.name === "AbortError") return;
    swissMap.showPopup(latlng, pickNode([["hint", err.message]]));
  } finally {
    if (pickRequest === ctrl) pickRequest = null;
  }
}

const wizard = createWizard({
  root: $("wizard"),
  store,
  fetchLocations,
  onPickLocation: chooseWorkLocation,
});

// --- planner panel and top-right controls ------------------------------------------------------

createPlannerPanel({ root: plannerRoot, store, onOpenTown: openTown });
const plannerPanel = makeFloatingPanel({
  root: plannerRoot,
  head: plannerRoot.querySelector(".panel-head"),
  toggle: $("planner-toggle"),
  body: $("planner-body"),
  storage,
  positionKey: "svp.planner-panel.v1",
  collapsedKey: "svp.planner-collapsed.v1",
  toggleLabel: "Planer",
  defaultPosition: () => ({ left: PANEL_GAP, top: PANEL_GAP }),
});

$("btn-add").addEventListener("click", () => setAddSearch(addSearch.hidden));
$("btn-prefs").addEventListener("click", (e) => prefsModal.open(e.currentTarget));
$("btn-help").addEventListener("click", (e) => helpModal.open(e.currentTarget));
$("btn-reset").addEventListener("click", (e) => resetDialog.open(e.currentTarget));

// --- calendars ------------------------------------------------------------------------------

townPanels = createTownPanels({
  container: $("town-panels"),
  storage,
  leftPanel: plannerRoot,
  // below the top-right controls
  topOffset: () => Math.round($("top-controls").getBoundingClientRect().bottom + PANEL_GAP),
  onRemove: (id) => store.removeLocation(id),
  onOpenTown: openTown,
  onHolidayCountClick: (id, from) => {
    const loc = store.get().locations.find((l) => l.id === id);
    const result = latest?.per_location[id];
    if (loc && result) {
      holidayDaysModal.open({ locationId: id, town: `${locationLabel(loc)} (${loc.canton})`,
        year: latest.year, days: result.days, from });
    }
  },
  onPeriodClick: ({ location, key, from }) => openPeriod(location, key, from),
  onHolidayClick: ({ location, day, holidays, from }) => holidayModal.open({
    day, from, town: `${locationLabel(location)} (${location.canton})`, locationId: location.id,
    holidays: holidays.map((h) => withWebInfo(location.id, h)),
  }),
});

let latest = null;          // last successful /api/optimize response
let inflight = null;
const selected = new Map();       // location_id → key "start|end" of the selected period

function findPeriod(result, key) {
  if (!result || !key) return null;
  return (result.summary?.plan ?? []).find((c) => periodKey(c) === key) ?? null;
}

const periodModal = createPeriodModal({
  onClose: (was) => {
    if (was) selected.delete(was.locationId);
    renderCalendars();
  },
});

/** The ONE selection handler: list entries and turquoise days in the month detail call it. */
function openPeriod(location, key, from = null) {
  const loc = store.get().locations.find((l) => l.id === location.id) ?? location;
  const period = findPeriod(latest?.per_location[loc.id], key);
  if (!period) return;
  for (const other of [...selected.keys()]) if (other !== loc.id) selected.delete(other);
  selected.set(loc.id, key);
  renderCalendars();
  periodModal.open({ period, locationId: loc.id, from, town: `${locationLabel(loc)} (${loc.canton})` });
}

function renderCalendars() {
  const state = store.get();
  if (!latest || latest.year !== state.year) return;   // a recalculation is pending
  for (const loc of state.locations) {
    const result = latest.per_location[loc.id];
    if (!result) continue;
    // keep a selection only while that exact period is still recommended
    const chosen = findPeriod(result, selected.get(loc.id));
    if (!chosen) {
      selected.delete(loc.id);
      if (periodModal.current()?.locationId === loc.id) periodModal.closeFor(loc.id);
    }
    const key = chosen ? periodKey(chosen) : null;
    const warnings = (result.warnings ?? []).map((w) => w.message);
    townPanels.setResult(loc.id, {
      days: applyPlan(result.days, result.summary?.plan ?? [], key),
      holidays: result.holidays ?? [],
      fromMonth: firstVisibleMonth(state.year),
      statusText: [String(state.year), ...warnings].join(" · "),
    });
    townPanels.setPlan(loc.id, result.summary, key);
  }
}

async function recalculate() {
  const state = store.get();
  if (!canOptimize(state)) return;           // never before onboarding step 3 is completed
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
  const done = state.onboarding === DONE;
  for (const id of ["btn-prefs", "btn-reset"]) $(id).hidden = !done;
  if (!done) setAddSearch(false);
  if (done) plannerPanel.show();
  else plannerPanel.hide();
}

function renderPlanner(state) {
  if (!canOptimize(state)) {
    townPanels.sync([]);
    townPanels.hide();
    latest = null;
    inflight?.abort();
    return;
  }
  townPanels.show();
  townPanels.sync(state.locations);
  renderCalendars();
}

store.subscribe((state, change) => {
  if (change.type === "remove") {
    // Removing a town closes the panels that belong to it.
    holidayModal.closeFor(change.location.id);
    periodModal.closeFor(change.location.id);
    townModal.closeFor(change.location.id);
    holidayDaysModal.closeFor(change.location.id);
    selected.delete(change.location.id);
  }
  if (change.type === "reset") {
    townModal.close();
    holidayDaysModal.close();
    prefsModal.close();
    holidayModal.close();
    periodModal.close();
    selected.clear();
    swissMap.closePopup();
  }
  if (change.type === "config") holidayDaysModal.close();   // its dates may change
  renderChrome(state);
  ensureHolidays(state);
  if (["add", "remove", "reset"].includes(change.type)) {
    swissMap.setLocations(state.locations, locationLabel);
    swissMap.fitLocations(state.locations);
  }
  renderPlanner(state);
  if (change.type !== "vacation_type") scheduleRecalc();     // the vacation type never affects the optimizer
});

// Restore a remembered session without the search → zoom → delay sequence.
const initial = store.get();
renderChrome(initial);
ensureHolidays(initial);
if (initial.locations.length) {
  swissMap.setLocations(initial.locations, locationLabel);
  swissMap.fitLocations(initial.locations);
}
renderPlanner(initial);
recalculate();
