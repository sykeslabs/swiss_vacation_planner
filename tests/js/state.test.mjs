// Run: node --test "tests/js/*.test.mjs"
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  calendarWindow, canOptimize, createPlannerStore, DONE, expandCustomDays, firstVisibleMonth, formatPostcodes,
  locationDetail, MAX_LOCATIONS, optimizePayload, parseBudget, restoreState, selectableYears, serializeState,
  STORAGE_KEY, townKey, validatePreferences,
} from "../../public/js/state.js";

const TODAY = new Date(2026, 9, 2);   // 2 Oct 2026, local time
const ZH = { id: "bfs-261", name: "Zürich", postcode: null, municipality: "Zürich", municipality_id: 261,
  canton: "ZH", latitude: 47.37, longitude: 8.53 };
const BE = { ...ZH, id: "bfs-351", name: "Bern", municipality: "Bern", municipality_id: 351, canton: "BE" };

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = String(v); }, data };
}

/** A store that went through the wizard (Zürich, 25 days). */
function onboarded(opts = {}) {
  const store = createPlannerStore({ today: TODAY, ...opts });
  store.wizardNext();
  store.setWorkLocation(ZH);
  store.wizardNext();
  store.setBudget(25);
  store.wizardNext();
  return store;
}

// --- onboarding wizard ----------------------------------------------------------------------

test("wizard: steps in order Jahr → Arbeitsort → Präferenzen → planner", () => {
  const store = createPlannerStore({ today: TODAY });
  assert.equal(store.get().onboarding, 1);
  assert.equal(store.setWorkLocation(ZH), false);              // no location before step 2
  assert.deepEqual(store.wizardNext(), { step: 2 });
  assert.deepEqual(store.wizardNext(), { error: "location" });  // step 2 needs a work location
  assert.equal(store.setWorkLocation(ZH), true);
  assert.equal(store.setWorkLocation(BE), true);                // a new choice replaces the old one
  assert.deepEqual(store.get().locations.map((l) => l.id), ["bfs-351"]);
  assert.deepEqual(store.wizardNext(), { step: 3 });
  assert.equal(store.wizardBack(), 2);
  assert.deepEqual(store.wizardNext(), { step: 3 });
  store.setBudget(25);
  assert.deepEqual(store.wizardNext(), { step: DONE });
});

test("wizard step 3 validation: no working days, missing vacation days", () => {
  const store = createPlannerStore({ today: TODAY });
  store.wizardNext();
  store.setWorkLocation(ZH);
  store.wizardNext();
  let r = store.wizardNext();
  assert.equal(r.error, "preferences");
  assert.match(r.errors.budget, /Anzahl Ferientage/);
  for (const d of ["MON", "TUE", "WED", "THU", "FRI"]) assert.equal(store.toggleWorkingDay(d), true);
  assert.deepEqual(store.get().workingDays, []);
  store.setBudget(25);
  r = store.wizardNext();
  assert.match(r.errors.workingDays, /mindestens einen Arbeitstag/);
  assert.equal(r.errors.budget, undefined);
  store.toggleWorkingDay("TUE");
  assert.deepEqual(store.wizardNext(), { step: DONE });
  // after onboarding the last working day can't be removed any more
  assert.equal(store.toggleWorkingDay("TUE"), false);
});

test("budget: whole or half days, required", () => {
  assert.equal(parseBudget("25"), 25);
  assert.equal(parseBudget("24,5"), 24.5);
  assert.ok(Number.isNaN(parseBudget("")));
  assert.ok(Number.isNaN(parseBudget("-1")));
  assert.deepEqual(validatePreferences({ workingDays: ["MON"], budget: 24.5 }), {});
  assert.ok(validatePreferences({ workingDays: ["MON"], budget: 12.3 }).budget);
  assert.ok(validatePreferences({ workingDays: ["MON"], budget: null }).budget);
  const store = createPlannerStore({ today: TODAY });
  assert.equal(store.get().budget, null);
  assert.equal(store.setBudget("abc"), false);
  assert.equal(store.setBudget("12.3"), false);
  assert.equal(store.setBudget("12,5"), true);
  assert.equal(store.get().budget, 12.5);
});

test("no optimizer before step 3 is completed", () => {
  const store = createPlannerStore({ today: TODAY });
  const seen = [];
  store.subscribe((s) => seen.push(canOptimize(s)));
  store.wizardNext();
  store.setWorkLocation(ZH);
  store.wizardNext();
  store.setBudget(25);
  assert.ok(seen.every((ok) => ok === false));
  store.wizardNext();
  assert.equal(seen.at(-1), true);
});

test("reset clears the state and returns to step 1", () => {
  const storage = memoryStorage();
  const store = onboarded({ storage });
  store.addLocation(BE);
  store.addCustomDay({ date: "2027-03-01", name: "Brückentag Firma", kind: "full", recurring: false });
  const changes = [];
  store.subscribe((s, c) => changes.push(c.type));
  store.reset();
  assert.deepEqual(changes, ["reset"]);
  assert.deepEqual(store.get(), createPlannerStore({ today: TODAY }).get());
  assert.equal(store.get().onboarding, 1);
  assert.equal(createPlannerStore({ storage, today: TODAY }).get().onboarding, 1);
});

test("reload resumes the wizard, but never past a step whose input is missing", () => {
  const storage = memoryStorage();
  const a = onboarded({ storage });
  a.setYear(2027);
  a.addLocation(BE);
  a.setVacationType("hiking");
  const b = createPlannerStore({ storage, today: TODAY });
  assert.deepEqual(b.get(), a.get());
  assert.ok(storage.data[STORAGE_KEY].includes('"v":2'));
  const broken = JSON.parse(storage.data[STORAGE_KEY]);
  broken.budget = null;
  assert.equal(restoreState(JSON.stringify(broken), TODAY).onboarding, 3);
  broken.locations = [];
  assert.equal(restoreState(JSON.stringify(broken), TODAY).onboarding, 2);
});

// --- defaults and basics --------------------------------------------------------------------

test("defaults: Mon–Fri, current year, no budget, 24./31.12. as recurring half days", () => {
  const s = createPlannerStore({ today: TODAY }).get();
  assert.equal(s.year, 2026);
  assert.deepEqual(s.workingDays, ["MON", "TUE", "WED", "THU", "FRI"]);
  assert.equal(s.budget, null);
  assert.equal(s.vacationType, "no_preference");
  assert.deepEqual(s.customDays.map((d) => [d.month, d.day, d.kind, d.recurring, d.active]),
    [[12, 24, "half", true, true], [12, 31, "half", true, true]]);
  assert.deepEqual(selectableYears(TODAY), [2026, 2027, 2028]);
  assert.deepEqual(calendarWindow(2027), { start: "2026-12-01", end: "2028-01-31" });
});

test("locations: add, dedupe, remove, limit", () => {
  const store = onboarded();
  const changes = [];
  store.subscribe((s, c) => changes.push(c.type));
  assert.equal(store.addLocation({ ...ZH }), "duplicate");
  assert.equal(store.addLocation(BE), "added");
  assert.deepEqual(store.get().locations.map((l) => l.id), ["bfs-261", "bfs-351"]);
  assert.equal(store.removeLocation("bfs-261"), true);
  assert.equal(store.removeLocation("bfs-261"), false);
  assert.deepEqual(changes, ["add", "remove"]);
  for (let i = 0; i < MAX_LOCATIONS; i++) store.addLocation({ ...ZH, id: `bfs-${1000 + i}`, municipality_id: 1000 + i, name: `Ort ${i}` });
  assert.equal(store.get().locations.length, MAX_LOCATIONS);
  assert.equal(store.addLocation({ ...ZH, id: "bfs-9", municipality_id: 9, name: "Ort X" }), "full");
});

test("the same town can't be added twice (municipality + place name)", () => {
  const baden = { ...ZH, id: "bfs-4021", name: "Baden", municipality: "Baden", municipality_id: 4021, canton: "AG" };
  const baden5400 = { ...baden, id: "bfs-4021-plz-5400", postcode: "5400" };
  const turgi = { ...baden, id: "bfs-4021-plz-5300", name: "Turgi", postcode: "5300" };
  const store = createPlannerStore({ today: TODAY });
  assert.equal(store.addLocation(baden), "added");
  assert.equal(store.addLocation(baden5400), "duplicate");
  assert.equal(store.findSameTown(baden5400).id, "bfs-4021");
  assert.equal(store.addLocation(turgi), "added");
  assert.equal(townKey(baden), townKey(baden5400));
  const restored = restoreState(serializeState({ ...store.get(), locations: [baden, baden5400, turgi] }), TODAY);
  assert.deepEqual(restored.locations.map((l) => l.id), ["bfs-4021", "bfs-4021-plz-5300"]);
});

test("corrupt, foreign or v1 storage falls back to defaults", () => {
  const fallback = createPlannerStore({ today: TODAY }).get();
  for (const raw of ["{nope", JSON.stringify({ v: 99, year: 2027 }), JSON.stringify({ v: 1, year: 2027, locations: [ZH] }),
    JSON.stringify(null), "42"]) {
    assert.deepEqual(restoreState(raw, TODAY), fallback, raw);
  }
  const mixed = restoreState(JSON.stringify({
    v: 2, onboarding: "done", year: 2040, workingDays: ["XYZ"], budget: 20, locations: [ZH, { id: "broken" }, ZH],
    customDays: [{ id: "x", name: "", kind: "half", recurring: false, date: "2026-05-01" },
      { id: "y", name: "Ok", kind: "full", recurring: false, date: "2026-02-30" },
      { id: "z", name: "Firmenfest", kind: "full", recurring: true, month: 2, day: 29 }],
    activeHolidays: { "bfs-261": ["2026-04-20|Sechseläuten", "nope", 5], "bfs-999": ["2026-01-01|X"] },
  }), TODAY);
  assert.equal(mixed.year, 2026);
  assert.deepEqual(mixed.workingDays, ["MON", "TUE", "WED", "THU", "FRI"]);
  assert.deepEqual(mixed.locations.map((l) => l.id), ["bfs-261"]);
  assert.deepEqual(mixed.customDays.map((d) => d.id), ["z"]);
  assert.deepEqual(mixed.activeHolidays, { "bfs-261": ["2026-04-20|Sechseläuten"] });
  assert.equal(mixed.onboarding, DONE);
});

test("storage errors never break the planner", () => {
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("quota"); } };
  const store = createPlannerStore({ storage: broken, today: TODAY });
  assert.equal(store.addLocation(ZH), "added");
  assert.equal(store.get().locations.length, 1);
});

test("current year starts at the current month; other years show the whole window", () => {
  assert.equal(firstVisibleMonth(2026, TODAY), "2026-10");
  assert.equal(firstVisibleMonth(2027, TODAY), null);
});

test("postcodes in the search result line", () => {
  assert.equal(formatPostcodes(["9050"]), "9050");
  assert.equal(formatPostcodes(["3822", "3823", "3824"]), "3822, 3823, 3824");
  assert.equal(formatPostcodes(["8001", "8002", "8003", "8143"]), "8001–8143 (4)");
  assert.equal(locationDetail({ ...ZH, postcodes: ["8001", "8002"] }), "ZH · PLZ 8001, 8002");
});

// --- custom days (global) -------------------------------------------------------------------

test("24.12. and 31.12. apply to every December in the window, incl. the boundary months", () => {
  const store = onboarded();
  const p = optimizePayload(store.get());
  assert.deepEqual(p.half_days, { "2025-12-24": 0.5, "2025-12-31": 0.5, "2026-12-24": 0.5, "2026-12-31": 0.5 });
  store.setYear(2027);
  assert.deepEqual(optimizePayload(store.get()).half_days,
    { "2026-12-24": 0.5, "2026-12-31": 0.5, "2027-12-24": 0.5, "2027-12-31": 0.5 });
});

test("only active custom days count", () => {
  const store = onboarded();
  const silvester = store.get().customDays.find((d) => d.day === 31);
  assert.equal(store.toggleCustomDay(silvester.id), true);
  assert.deepEqual(Object.keys(optimizePayload(store.get()).half_days), ["2025-12-24", "2026-12-24"]);
  assert.equal(store.removeCustomDay(silvester.id), false);   // built-in entries can only be switched off
});

test("recurring vs one-off custom days across a year change", () => {
  const store = onboarded();
  assert.equal(store.addCustomDay({ date: "2026-11-02", name: "Firmenjubiläum", kind: "full", recurring: false }), "added");
  assert.equal(store.addCustomDay({ date: "2026-06-12", name: "Betriebsausflug", kind: "half", recurring: true }), "added");
  assert.equal(store.addCustomDay({ date: "2026-06-12", name: "Nochmals", kind: "half", recurring: true }), "duplicate");
  assert.equal(store.addCustomDay({ date: "2026-13-01", name: "X", kind: "full", recurring: false }), "invalid");
  assert.equal(store.addCustomDay({ date: "2026-05-01", name: " ", kind: "full", recurring: false }), "invalid");
  let p = optimizePayload(store.get());
  assert.deepEqual(p.custom_holidays, [{ date: "2026-11-02", name: "Firmenjubiläum" }]);
  assert.equal(p.half_days["2026-06-12"], 0.5);
  store.setYear(2028);
  p = optimizePayload(store.get());
  assert.equal(p.custom_holidays, undefined);                // one-off date is outside the 2028 window
  assert.equal(p.half_days["2028-06-12"], 0.5);              // recurring rule follows the year
  assert.equal(p.half_days["2026-06-12"], undefined);
  store.setYear(2026);
  assert.deepEqual(optimizePayload(store.get()).custom_holidays, [{ date: "2026-11-02", name: "Firmenjubiläum" }]);
});

test("a one-off date in a boundary month counts; 29.2. only in leap years", () => {
  assert.deepEqual(expandCustomDays([{ id: "a", name: "A", kind: "full", recurring: false, date: "2027-01-15", active: true }], 2026).holidays,
    [{ date: "2027-01-15", name: "A" }]);
  const leap = [{ id: "b", name: "B", kind: "half", recurring: true, month: 2, day: 29, active: true }];
  assert.deepEqual(expandCustomDays(leap, 2027).halfDays, {});
  assert.deepEqual(expandCustomDays(leap, 2028).halfDays, { "2028-02-29": 0.5 });
});

test("user-added days are global: they apply to every location, incl. ones added later", () => {
  const store = onboarded();
  store.addCustomDay({ date: "2026-11-02", name: "Firmenjubiläum", kind: "full", recurring: false });
  store.addLocation(BE);
  const p = optimizePayload(store.get());
  assert.deepEqual(p.custom_holidays, [{ date: "2026-11-02", name: "Firmenjubiläum" }]);   // not per location
  assert.deepEqual(p.locations.map((l) => l.id), ["bfs-261", "bfs-351"]);
  const id = store.get().customDays.at(-1).id;
  store.toggleCustomDay(id);
  assert.equal(optimizePayload(store.get()).custom_holidays, undefined);
});

// --- disputed and optional holidays (per location) -----------------------------------------------

const SECHS = { key: "2026-04-20|Sechseläuten", date: "2026-04-20", name: "Sechseläuten", enabled: false, disputed: false, work_fraction: 0.5 };
const KF = { key: "2026-04-03|Karfreitag", date: "2026-04-03", name: "Karfreitag", enabled: true, disputed: false, work_fraction: 0 };
const MAE = { key: "2026-12-08|Mariä Empfängnis", date: "2026-12-08", name: "Mariä Empfängnis", enabled: true, disputed: true, work_fraction: 0 };

test("disputed and optional holidays are inactive by default (incl. a disputed reference holiday)", () => {
  const store = onboarded();
  const p = optimizePayload(store.get(), { "bfs-261": [SECHS, KF, MAE] });
  assert.equal(p.extra_holidays, undefined);                                   // optional: off
  assert.deepEqual(p.disabled_holidays, { "bfs-261": [MAE.key] });             // disputed: not a holiday
  assert.equal(store.isHolidayActive("bfs-261", MAE.key), false);
});

test("switching on a disputed or optional holiday affects only its location", () => {
  const storage = memoryStorage();
  const store = onboarded({ storage });
  store.addLocation(BE);
  const lists = { "bfs-261": [SECHS, KF, MAE], "bfs-351": [{ ...MAE }] };
  assert.equal(store.toggleLocationHoliday("bfs-261", MAE.key), true);
  assert.equal(store.toggleLocationHoliday("bfs-261", SECHS.key), true);
  const p = optimizePayload(store.get(), lists);
  assert.deepEqual(p.disabled_holidays, { "bfs-351": [MAE.key] });
  assert.deepEqual(p.extra_holidays, { "bfs-261": [{ date: "2026-04-20", name: "Sechseläuten", work_fraction: 0.5 }] });
  assert.deepEqual(createPlannerStore({ storage, today: TODAY }).get().activeHolidays,
    { "bfs-261": [MAE.key, SECHS.key].sort() });
  assert.equal(store.toggleLocationHoliday("bfs-999", MAE.key), false);        // unknown town
  assert.equal(store.toggleLocationHoliday("bfs-261", "nope"), false);
  store.removeLocation("bfs-261");
  assert.deepEqual(store.get().activeHolidays, {});
});

test("optimize payload never contains a vacation type", () => {
  const store = onboarded();
  store.setVacationType("beach");
  assert.equal(store.get().vacationType, "beach");
  assert.equal(store.setVacationType("moon"), false);
  const p = optimizePayload(store.get());
  assert.deepEqual(Object.keys(p).sort(), ["half_days", "locations", "vacation_budget", "working_days", "year"]);
  assert.equal(p.vacation_budget, 25);
});
