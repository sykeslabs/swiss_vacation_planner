// Run: node --test "tests/js/*.test.mjs"
import assert from "node:assert/strict";
import { test } from "node:test";

import { CATEGORIES, dayCategory, groupByMonth } from "../../public/js/calendar-model.js";
import { formatDate, formatDateWithWeekday, formatRange, parseIso, weekdayIndex } from "../../public/js/format.js";
import {
  calendarWindow, createPlannerStore, defaultHalfDays, MAX_LOCATIONS, optimizePayload,
  restoreState, selectableYears, serializeState, STORAGE_KEY,
} from "../../public/js/state.js";

const TODAY = new Date(2026, 9, 2);   // 2 Oct 2026, local time
const ZH = { id: "bfs-261", name: "Zürich", postcode: null, municipality: "Zürich", municipality_id: 261,
  canton: "ZH", latitude: 47.37, longitude: 8.53 };
const BE = { ...ZH, id: "bfs-351", name: "Bern", municipality: "Bern", municipality_id: 351, canton: "BE" };

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = String(v); }, data };
}

// --- dayCategory: every attribute combination ------------------------------------------

const base = { is_working_day: true, is_weekend: false, is_holiday: false, holiday_names: [],
  holiday_on_non_working_day: false, work_fraction: 1, is_vacation: false, is_free: false,
  in_selected_period: false, in_planned_year: true };

test("dayCategory derives every category from attributes", () => {
  const cases = [
    [{}, "workday"],
    [{ work_fraction: 0.5 }, "half_day"],
    [{ is_working_day: false, is_weekend: true, work_fraction: 0, is_free: true }, "weekend"],
    [{ is_working_day: false, work_fraction: 0, is_free: true }, "weekend"],           // e.g. Friday off in a Mon–Thu week
    [{ is_holiday: true, work_fraction: 0, is_free: true }, "holiday"],
    [{ is_holiday: true, is_working_day: false, holiday_on_non_working_day: true, work_fraction: 0, is_free: true }, "holiday_off"],
    [{ is_vacation: true, work_fraction: 0, is_free: true, in_selected_period: true }, "vacation"],
    [{ is_working_day: false, work_fraction: 0, is_free: true, in_selected_period: true }, "free_run"],
    [{ is_holiday: true, work_fraction: 0.5 }, "half_day"],                            // partial holiday
  ];
  for (const [attrs, expected] of cases) assert.equal(dayCategory({ ...base, ...attrs }), expected, JSON.stringify(attrs));
});

test("every category has a legend label", () => {
  assert.deepEqual(CATEGORIES.map((c) => c.key).sort(),
    ["free_run", "half_day", "holiday", "holiday_off", "vacation", "weekend", "workday"]);
  assert.ok(CATEGORIES.every((c) => c.label && !c.label.includes("ß")));
});

test("groupByMonth keeps order and boundary months", () => {
  const days = ["2026-12-31", "2027-01-01", "2027-01-02", "2028-01-01"].map((date) => ({ ...base, date }));
  const months = groupByMonth(days);
  assert.deepEqual(months.map((m) => [m.year, m.month, m.days.length]), [[2026, 12, 1], [2027, 1, 2], [2028, 1, 1]]);
});

// --- formatting ---------------------------------------------------------------------------

test("German date formats", () => {
  assert.equal(formatDate("2027-12-24"), "24. Dezember 2027");
  assert.equal(formatDateWithWeekday("2027-12-24"), "Fr, 24. Dezember 2027");
  assert.equal(formatRange("2027-05-06", "2027-05-09"), "6.–9. Mai 2027");
  assert.equal(formatRange("2027-04-30", "2027-05-03"), "30. April – 3. Mai 2027");
  assert.equal(formatRange("2026-12-28", "2027-01-03"), "28. Dezember 2026 – 3. Januar 2027");
  assert.equal(formatDate("2027-03-01"), "1. März 2027");
  assert.equal(weekdayIndex("2027-01-04"), 0);   // Monday
  assert.equal(parseIso("2027-02-30"), null);
});

// --- state --------------------------------------------------------------------------------

test("defaults: Mon–Fri, current year, 24./31.12. of both Decembers", () => {
  const s = createPlannerStore({ today: TODAY }).get();
  assert.equal(s.year, 2026);
  assert.deepEqual(s.workingDays, ["MON", "TUE", "WED", "THU", "FRI"]);
  assert.deepEqual(Object.keys(s.halfDays).sort(), ["2025-12-24", "2025-12-31", "2026-12-24", "2026-12-31"]);
  assert.deepEqual(selectableYears(TODAY), [2026, 2027, 2028]);
  assert.deepEqual(calendarWindow(2027), { start: "2026-12-01", end: "2028-01-31" });
});

test("locations: add, dedupe, activate, remove, limit", () => {
  const store = createPlannerStore({ today: TODAY });
  const changes = [];
  store.subscribe((s, c) => changes.push(c.type));
  assert.equal(store.addLocation(ZH), "added");
  assert.equal(store.addLocation({ ...ZH }), "duplicate");
  assert.equal(store.addLocation(BE), "added");
  assert.equal(store.get().activeLocationId, "bfs-351");          // newest becomes active
  assert.equal(store.setActiveLocation("bfs-261"), true);
  assert.equal(store.removeLocation("bfs-261"), true);
  assert.equal(store.get().activeLocationId, "bfs-351");          // falls back to a remaining one
  assert.equal(store.removeLocation("bfs-261"), false);
  assert.deepEqual(changes, ["add", "add", "active", "remove"]);
  for (let i = 0; i < MAX_LOCATIONS; i++) store.addLocation({ ...ZH, id: `bfs-${1000 + i}` });
  assert.equal(store.get().locations.length, MAX_LOCATIONS);
  assert.equal(store.addLocation({ ...ZH, id: "bfs-9" }), "full");
});

test("working days can't become empty", () => {
  const store = createPlannerStore({ today: TODAY });
  for (const d of ["MON", "TUE", "WED", "THU"]) assert.equal(store.toggleWorkingDay(d), true);
  assert.deepEqual(store.get().workingDays, ["FRI"]);
  assert.equal(store.toggleWorkingDay("FRI"), false);
  assert.equal(store.toggleWorkingDay("SAT"), true);
  assert.equal(store.toggleWorkingDay("MON"), true);
  assert.deepEqual(store.get().workingDays, ["MON", "FRI", "SAT"]);   // kept in weekday order
});

test("half days: add, duplicate, out of range, remove", () => {
  const store = createPlannerStore({ today: TODAY });
  assert.equal(store.addHalfDay("2026-04-20"), "added");
  assert.equal(store.addHalfDay("2026-04-20"), "duplicate");
  assert.equal(store.addHalfDay("2024-01-01"), "out_of_range");
  assert.equal(store.addHalfDay("2026-02-30"), "out_of_range");
  assert.equal(store.removeHalfDay("2026-12-24"), true);
  assert.equal(store.get().halfDays["2026-12-24"], undefined);
  assert.equal(store.get().halfDays["2026-04-20"], 0.5);
});

test("year change keeps visible half days and re-adds the December defaults", () => {
  const store = createPlannerStore({ today: TODAY });
  store.addHalfDay("2026-12-23");
  store.removeHalfDay("2026-12-31");
  assert.equal(store.setYear(2027), true);
  assert.deepEqual(Object.keys(store.get().halfDays).sort(),
    ["2026-12-23", "2026-12-24", "2026-12-31", "2027-12-24", "2027-12-31"]);
  assert.equal(store.setYear(2031), false);
});

test("state survives a reload via storage", () => {
  const storage = memoryStorage();
  const a = createPlannerStore({ storage, today: TODAY });
  a.addLocation(ZH);
  a.addLocation(BE);
  a.setActiveLocation("bfs-261");
  a.setYear(2027);
  a.toggleWorkingDay("FRI");
  a.addHalfDay("2027-04-19");
  const b = createPlannerStore({ storage, today: TODAY });
  assert.deepEqual(b.get(), a.get());
  assert.ok(storage.data[STORAGE_KEY].includes('"v":1'));
});

test("corrupt or foreign storage falls back to defaults", () => {
  const fallback = createPlannerStore({ today: TODAY }).get();
  for (const raw of ["{nope", JSON.stringify({ v: 99, year: 2027 }), JSON.stringify(null), "42"]) {
    assert.deepEqual(restoreState(raw, TODAY), fallback, raw);
  }
  const mixed = restoreState(JSON.stringify({
    v: 1, year: 2040, workingDays: ["XYZ"], halfDays: { "2026-12-24": 0.5, "1999-01-01": 0.5, "2026-06-01": 7 },
    locations: [ZH, { id: "broken" }, ZH], activeLocationId: "missing",
  }), TODAY);
  assert.equal(mixed.year, 2026);
  assert.deepEqual(mixed.workingDays, ["MON", "TUE", "WED", "THU", "FRI"]);
  assert.deepEqual(Object.keys(mixed.halfDays).sort(), ["2025-12-24", "2025-12-31", "2026-12-24", "2026-12-31"]);
  assert.deepEqual(mixed.locations.map((l) => l.id), ["bfs-261"]);
  assert.equal(mixed.activeLocationId, "bfs-261");
});

test("storage errors never break the planner", () => {
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("quota"); } };
  const store = createPlannerStore({ storage: broken, today: TODAY });
  assert.equal(store.addLocation(ZH), "added");
  assert.equal(store.get().locations.length, 1);
});

test("optimize payload never contains a vacation type", () => {
  const store = createPlannerStore({ today: TODAY });
  store.addLocation(ZH);
  const p = optimizePayload(store.get());
  assert.deepEqual(Object.keys(p).sort(), ["half_days", "locations", "vacation_budget", "working_days", "year"]);
  assert.deepEqual(p.half_days, defaultHalfDays(2026));
  assert.ok(serializeState(store.get()));
});
