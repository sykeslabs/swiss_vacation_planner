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

test("locations: add, dedupe, remove, limit", () => {
  const store = createPlannerStore({ today: TODAY });
  const changes = [];
  store.subscribe((s, c) => changes.push(c.type));
  assert.equal(store.addLocation(ZH), "added");
  assert.equal(store.addLocation({ ...ZH }), "duplicate");
  assert.equal(store.addLocation(BE), "added");
  assert.deepEqual(store.get().locations.map((l) => l.id), ["bfs-261", "bfs-351"]);
  assert.equal(store.removeLocation("bfs-261"), true);
  assert.equal(store.removeLocation("bfs-261"), false);
  assert.deepEqual(store.get().locations.map((l) => l.id), ["bfs-351"]);
  assert.deepEqual(changes, ["add", "add", "remove"]);
  for (let i = 0; i < MAX_LOCATIONS; i++) store.addLocation({ ...ZH, id: `bfs-${1000 + i}`, municipality_id: 1000 + i, name: `Ort ${i}` });
  assert.equal(store.get().locations.length, MAX_LOCATIONS);
  assert.equal(store.addLocation({ ...ZH, id: "bfs-9", municipality_id: 9, name: "Ort X" }), "full");
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
    locations: [ZH, { id: "broken" }, ZH],
  }), TODAY);
  assert.equal(mixed.year, 2026);
  assert.deepEqual(mixed.workingDays, ["MON", "TUE", "WED", "THU", "FRI"]);
  assert.deepEqual(Object.keys(mixed.halfDays).sort(), ["2025-12-24", "2025-12-31", "2026-12-24", "2026-12-31"]);
  assert.deepEqual(mixed.locations.map((l) => l.id), ["bfs-261"]);
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

// --- owner feedback after M3 ----------------------------------------------------------------

import { firstVisibleMonth, formatPostcodes, locationDetail, townKey } from "../../public/js/state.js";

test("the same town can't be added twice (municipality + place name)", () => {
  const baden = { ...ZH, id: "bfs-4021", name: "Baden", municipality: "Baden", municipality_id: 4021, canton: "AG" };
  const baden5400 = { ...baden, id: "bfs-4021-plz-5400", postcode: "5400" };
  const turgi = { ...baden, id: "bfs-4021-plz-5300", name: "Turgi", postcode: "5300" };
  const store = createPlannerStore({ today: TODAY });
  assert.equal(store.addLocation(baden), "added");
  assert.equal(store.addLocation(baden5400), "duplicate");
  assert.equal(store.findSameTown(baden5400).id, "bfs-4021");
  assert.equal(store.addLocation(turgi), "added");            // another village of the municipality
  assert.equal(townKey(baden), townKey(baden5400));
  const restored = restoreState(serializeState({ ...store.get(), locations: [baden, baden5400, turgi] }), TODAY);
  assert.deepEqual(restored.locations.map((l) => l.id), ["bfs-4021", "bfs-4021-plz-5300"]);
});

test("current year starts at the current month; other years show the whole window", () => {
  assert.equal(firstVisibleMonth(2026, TODAY), "2026-10");
  assert.equal(firstVisibleMonth(2027, TODAY), null);
  assert.equal(firstVisibleMonth(2026, new Date(2026, 0, 15)), "2026-01");
});

test("postcodes in the search result line", () => {
  assert.equal(formatPostcodes(["9050"]), "9050");
  assert.equal(formatPostcodes(["3822", "3823", "3824"]), "3822, 3823, 3824");
  assert.equal(formatPostcodes(["8001", "8002", "8003", "8143"]), "8001–8143 (4)");
  assert.equal(formatPostcodes(undefined), "");
  assert.equal(locationDetail({ ...ZH, postcodes: ["8001", "8002"] }), "Gemeinde · ZH · PLZ 8001, 8002");
  assert.equal(locationDetail({ ...ZH, postcodes: [] }), "Gemeinde · ZH");
});

// --- movable town panels --------------------------------------------------------------------

import { clampPosition, defaultPosition, PANEL_GAP, PANEL_WIDTH, rightCoverage } from "../../public/js/panel-layout.js";

test("panels: side by side while they fit, then below the previous one, then cascaded", () => {
  const wide = { viewportWidth: 2600, viewportHeight: 1000, top: 64, minLeft: 384 };
  const a = defaultPosition(0, wide);
  const b = defaultPosition(1, wide);
  assert.equal(a.left, 2600 - PANEL_GAP - PANEL_WIDTH);
  assert.equal(b.left, a.left - PANEL_WIDTH - PANEL_GAP);          // two fit next to each other
  const hd = { viewportWidth: 1920, viewportHeight: 1031, top: 64, minLeft: 384 };
  const p0 = defaultPosition(0, hd);
  assert.deepEqual(p0, { left: 1920 - PANEL_GAP - PANEL_WIDTH, top: 64 });
  const p1 = defaultPosition(1, { ...hd, previous: { ...p0, height: 470 } });
  assert.deepEqual(p1, { left: p0.left, top: 64 + 470 + PANEL_GAP });   // stacked below
  const p2 = defaultPosition(2, { ...hd, previous: { ...p1, height: 470 } });
  assert.ok(p2.top > p1.top && p2.left < p1.left && p2.top < hd.viewportHeight);  // no room: cascade
  const small = defaultPosition(0, { viewportWidth: 900, top: 64, minLeft: 384 });
  assert.ok(small.left >= 0);                                         // never off the left edge
});

test("dragging keeps the title bar reachable", () => {
  const vp = { width: 480, viewportWidth: 1200, viewportHeight: 800, headerHeight: 40 };
  assert.deepEqual(clampPosition({ left: -2000, top: -50 }, vp), { left: 80 - 480, top: 0 });
  assert.deepEqual(clampPosition({ left: 5000, top: 5000 }, vp), { left: 1200 - 80, top: 760 });
  assert.deepEqual(clampPosition({ left: 300.4, top: 120.6 }, vp), { left: 300, top: 121 });
});

test("map padding covers the panels on the right only", () => {
  const vw = 1600;
  assert.equal(rightCoverage([], vw), 0);
  assert.equal(rightCoverage([{ left: 588, width: 1000 }, { left: 588, width: 1000 }], vw), 1012);
  assert.equal(rightCoverage([{ left: 20, width: 480 }], vw), 0);   // moved to the left side
});
