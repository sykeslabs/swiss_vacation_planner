// Run: node --test "tests/js/*.test.mjs"
import assert from "node:assert/strict";
import { test } from "node:test";

import { CATEGORIES, dayCategory, groupByMonth } from "../../public/js/calendar-model.js";
import { formatDate, formatDateWithWeekday, formatRange, parseIso, weekdayIndex } from "../../public/js/format.js";


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
    [{ is_holiday: true, is_working_day: false, holiday_on_non_working_day: true, work_fraction: 0, is_free: true }, "holiday"],   // weekend holiday: red too
    [{ is_holiday: true, is_working_day: false, holiday_on_non_working_day: true, work_fraction: 0, is_free: true, plan_key: "k" }, "holiday"],
    [{ is_vacation: true, work_fraction: 0, is_free: true, in_selected_period: true }, "vacation"],
    [{ is_working_day: false, work_fraction: 0, is_free: true, in_selected_period: true }, "free_run"],
    [{ is_holiday: true, work_fraction: 0.5 }, "half_day"],                            // partial holiday
    [{ is_vacation: true, work_fraction: 0.5, is_free: true }, "vacation_half"],        // vacation on 31.12. costs ½
  ];
  for (const [attrs, expected] of cases) assert.equal(dayCategory({ ...base, ...attrs }), expected, JSON.stringify(attrs));
});

test("every category has a legend label", () => {
  assert.deepEqual(CATEGORIES.map((c) => c.key).sort(),
    ["free_run", "half_day", "holiday", "vacation", "vacation_half", "weekend", "workday"]);
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

// --- holiday background info ------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { effectLabel, jurisdictionLabel, loadHolidayInfo, lookupHoliday, wikipediaUrl } from "../../public/js/holiday-info.js";

const INFO = JSON.parse(readFileSync(new URL("../../public/data/holiday-info.json", import.meta.url), "utf8"));

test("holiday info lookup with aliases and Wikipedia links", () => {
  const kf = lookupHoliday(INFO, "Karfreitag");
  assert.match(kf.text, /Kreuzigung/);
  assert.equal(kf.url, "https://de.wikipedia.org/wiki/Karfreitag");
  assert.equal(lookupHoliday(INFO, "Bundesfeiertag").url, lookupHoliday(INFO, "Nationalfeiertag").url);
  assert.equal(lookupHoliday(INFO, "Unbekannter Tag"), null);
  assert.equal(lookupHoliday(null, "Karfreitag"), null);
  assert.equal(wikipediaUrl("Schlacht bei Näfels (1388)"), "https://de.wikipedia.org/wiki/Schlacht_bei_N%C3%A4fels_(1388)");
});

test("holiday facts in German", () => {
  assert.equal(jurisdictionLabel({ jurisdiction: "national" }), "Gesamtschweizerischer Feiertag");
  assert.equal(jurisdictionLabel({ jurisdiction: "canton", canton: "ZH" }), "Kantonaler Feiertag (ZH)");
  assert.match(effectLabel({ holiday_on_non_working_day: true }), /keinen zusätzlichen freien Tag/);
  assert.match(effectLabel({ holiday_on_non_working_day: false }), /ohne einen Ferientag/);
});

test("holiday info loads once and retries after a failure", async () => {
  let calls = 0;
  const failing = async () => { calls++; throw new Error("offline"); };
  assert.equal(await loadHolidayInfo(failing), null);
  const ok = async () => { calls++; return { ok: true, json: async () => INFO }; };
  assert.equal((await loadHolidayInfo(ok)).holidays.Karfreitag.wiki, "Karfreitag");
  await loadHolidayInfo(ok);
  assert.equal(calls, 2);                       // second successful call served from cache
});

// --- M4: optional holidays ------------------------------------------------------------------

import { holidaySummary } from "../../public/js/holiday-list.js";
import { confidenceLabel } from "../../public/js/holiday-info.js";


test("holiday summary and confidence texts", () => {
  assert.match(holidaySummary(null), /geprüft/);
  assert.equal(holidaySummary({ summary: { checked: true, confirmed: 9, optional: 3 }, warnings: [] }),
    "9 Feiertage durch die Websuche bestätigt · 3 optionale lokale Feiertage");
  assert.equal(holidaySummary({ summary: { checked: false }, warnings: [{ message: "Tageslimit erreicht." }] }), "Tageslimit erreicht.");
  assert.match(confidenceLabel({ confidence: "high" }), /stimmen überein/);
  assert.match(confidenceLabel({ confidence: "medium" }), /Referenzkalender/);
  assert.match(confidenceLabel({ confidence: "low", enabled: false }), /selbst aktivieren/);
});

// --- M5: selected period ----------------------------------------------------------------------

import { applyPlan, formatDays, periodKey, vacationDaysLabel } from "../../public/js/calendar-model.js";

test("recommended plan: vacation days turquoise, free days 'Frei am Stück', selection ring", () => {
  const mk = (date, extra = {}) => ({ ...base, date, ...extra });
  const free = { is_working_day: false, work_fraction: 0, is_free: true };
  const days = [mk("2027-05-05"), mk("2027-05-06", { is_holiday: true, work_fraction: 0, is_free: true }),
    mk("2027-05-07"), mk("2027-05-08", free), mk("2027-05-09", free), mk("2027-05-10"),
    mk("2027-05-14"), mk("2027-05-15", free), mk("2027-05-16", free)];
  const auffahrt = { start: "2027-05-06", end: "2027-05-09", vacation_dates: ["2027-05-07"] };
  const other = { start: "2027-05-14", end: "2027-05-16", vacation_dates: ["2027-05-14"] };
  const out = applyPlan(days, [auffahrt, other], periodKey(auffahrt));
  assert.deepEqual(out.map(dayCategory), ["workday", "holiday", "vacation", "free_run", "free_run", "workday",
    "vacation", "free_run", "free_run"]);
  assert.deepEqual(out.map((d) => d.in_selected_period), [false, true, true, true, true, false, false, false, false]);
  assert.equal(out[2].plan_key, "2027-05-06|2027-05-09");
  assert.equal(out[6].plan_key, "2027-05-14|2027-05-16");
  assert.equal(out[0].plan_key, undefined);
  assert.equal(days[2].is_vacation, false);              // input not mutated
  assert.equal(applyPlan(days, []), days);
});

test("vacation day labels", () => {
  assert.equal(formatDays(0.5), "½");
  assert.equal(formatDays(4.5), "4½");
  assert.equal(vacationDaysLabel(1), "1 Ferientag");
  assert.equal(vacationDaysLabel(0.5), "½ Ferientag");
  assert.equal(vacationDaysLabel(4), "4 Ferientage");
});

import { candidateTitle, holidayCountText, planSummary, yearSplit } from "../../public/js/candidate-list.js";

const C1 = { start: "2027-05-06", end: "2027-05-09", days_free: 4, vacation_days_required: 1, efficiency: 4,
  anchor_holidays: ["Auffahrt"], vacation_days_by_year: { 2027: 1 }, vacation_dates: ["2027-05-07"] };
const C2 = { start: "2027-03-20", end: "2027-03-29", days_free: 10, vacation_days_required: 4, efficiency: 2.5,
  anchor_holidays: ["Karfreitag", "Ostermontag"], vacation_days_by_year: { 2027: 4 }, vacation_dates: [] };
const C3 = { start: "2026-12-25", end: "2027-01-10", days_free: 17, vacation_days_required: 8.5, efficiency: 2,
  anchor_holidays: [], vacation_days_by_year: { 2026: 3.5, 2027: 5 }, vacation_dates: [] };

test("period title in the SPEC §7 format", () => {
  assert.equal(candidateTitle(C1), "1 Ferientag → 4 Tage frei · 6.–9. Mai 2027");
  assert.equal(candidateTitle(C3), "8½ Ferientage → 17 Tage frei · 25. Dezember 2026 – 10. Januar 2027");
});

test("year split only across years", () => {
  assert.equal(yearSplit(C1), "");
  assert.equal(yearSplit(C3), "Davon 3½ Ferientage im 2026, 5 Ferientage im 2027");
});

test("holiday count next to the town name", () => {
  assert.equal(holidayCountText(9), "9 Feiertage");
  assert.equal(holidayCountText(1), "1 Feiertag");
  assert.equal(holidayCountText(0), "0 Feiertage");
});

test("plan line with the budget that is left", () => {
  const plan = [{ start: "2027-05-06", end: "2027-05-09" }, { start: "2027-03-20", end: "2027-03-29" }];
  assert.equal(planSummary({ plan, plan_vacation_days: 5, plan_days_free: 14, budget: 25, budget_left: 20 }),
    "Empfehlung: 2 Perioden · 5 Ferientage → 14 Tage frei · 20 Ferientage frei verteilbar");
  assert.equal(planSummary({ plan, plan_vacation_days: 5, plan_days_free: 14, budget: null, budget_left: null }),
    "Empfehlung: 2 Perioden · 5 Ferientage → 14 Tage frei");
  assert.equal(planSummary({ plan: [], budget: 0, budget_left: 0 }), "Keine passende Periode innerhalb deines Budgets (0 Ferientage).");
  assert.equal(vacationDaysLabel(0), "0 Ferientage");
  assert.equal(vacationDaysLabel(1.5), "1½ Ferientage");
});
