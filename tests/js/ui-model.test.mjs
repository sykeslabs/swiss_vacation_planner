// Run: node --test "tests/js/*.test.mjs"
// Pure view models behind the town modal, the period list, the calendar clicks and the
// "Über Adam" modal.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { aboutLinks, readAboutConfig } from "../../public/js/about-view.js";
import { applyPlan, periodKey } from "../../public/js/calendar-model.js";
import { cellAction } from "../../public/js/calendar-view.js";
import { overlapsMonth, periodListItems, townHeadline } from "../../public/js/candidate-list.js";
import { createPlannerStore } from "../../public/js/state.js";
import { holidayInfoText, townHolidayModel } from "../../public/js/town-holidays.js";

const TODAY = new Date(2026, 9, 2);
const ZH = { id: "bfs-261", name: "Zürich", postcode: null, municipality: "Zürich", municipality_id: 261,
  canton: "ZH", latitude: 47.37, longitude: 8.53 };
const BE = { ...ZH, id: "bfs-351", name: "Bern", municipality: "Bern", municipality_id: 351, canton: "BE" };

function onboarded() {
  const store = createPlannerStore({ today: TODAY });
  store.wizardNext();
  store.setWorkLocation(ZH);
  store.wizardNext();
  store.setBudget(25);
  store.wizardNext();
  return store;
}

const KF = { key: "2026-04-03|Karfreitag", date: "2026-04-03", name: "Karfreitag", enabled: true, disputed: false,
  confidence: "high", corroborated_by: ["https://www.feiertagskalender.ch/x"], work_fraction: 0 };
const MAE = { key: "2026-12-08|Mariä Empfängnis", date: "2026-12-08", name: "Mariä Empfängnis", enabled: true,
  disputed: true, confidence: "medium", conflict: "Auf der Seite der Gemeinde Baden nicht als Feiertag aufgeführt.",
  work_fraction: 0 };
const SECHS = { key: "2026-04-20|Sechseläuten", date: "2026-04-20", name: "Sechseläuten", enabled: false,
  disputed: false, confidence: "low", note: "Nachmittag frei", source_url: "https://www.zuerich.ch/feiertage",
  work_fraction: 0.5 };
const DATA = { location_id: "bfs-261", holidays: [KF, MAE, SECHS], summary: { checked: true }, warnings: [] };

// --- town modal ---------------------------------------------------------------------------------

test("town modal: no public holidays (they are in the calendar), one switch list with disputed, optional and custom days", () => {
  const store = onboarded();
  const m = townHolidayModel(DATA, store.get(), (key) => store.isHolidayActive("bfs-261", key));
  assert.ok(!m.switches.some((s) => s.key === KF.key));       // confirmed Karfreitag isn't listed
  assert.equal(m.confirmed, undefined);
  assert.deepEqual(m.switches.map((s) => [s.kind, s.active]), [
    ["optional", false],           // 20.4. Sechseläuten
    ["disputed", false],           // 8.12. Mariä Empfängnis: inactive by default
    ["custom", true],              // 24.12.
    ["custom", true],              // 31.12.
  ]);
  assert.equal(m.switches[2].label, "24. Dezember – Heiligabend");
  assert.equal(m.switches[2].tag, "halber Tag · jährlich");
  assert.equal(m.switches[2].removable, false);
});

test("town modal: user-added days appear in every town modal, also for towns added later", () => {
  const store = onboarded();
  store.addCustomDay({ date: "2026-11-02", name: "Firmenjubiläum", kind: "full", recurring: false });
  store.addLocation(BE);
  for (const id of ["bfs-261", "bfs-351"]) {
    const m = townHolidayModel({ location_id: id, holidays: [] }, store.get(), (k) => store.isHolidayActive(id, k));
    const own = m.switches.find((s) => s.label.includes("Firmenjubiläum"));
    assert.ok(own, id);
    assert.equal(own.active, true);
    assert.equal(own.removable, true);
    assert.equal(own.tag, "ganzer Feiertag");
  }
});

test("town modal: toggling a disputed holiday only changes its own town", () => {
  const store = onboarded();
  store.addLocation(BE);
  store.toggleLocationHoliday("bfs-261", MAE.key);
  const zh = townHolidayModel(DATA, store.get(), (k) => store.isHolidayActive("bfs-261", k));
  const be = townHolidayModel({ ...DATA, location_id: "bfs-351" }, store.get(), (k) => store.isHolidayActive("bfs-351", k));
  assert.equal(zh.switches.find((s) => s.key === MAE.key).active, true);
  assert.equal(be.switches.find((s) => s.key === MAE.key).active, false);
});

test("town modal while the holiday check is still loading shows the custom days", () => {
  const m = townHolidayModel(null, onboarded().get(), () => false);
  assert.equal(m.switches.length, 2);
});

test("provenance and conflict notes are tooltip text generated from the data", () => {
  assert.match(holidayInfoText(KF), /stimmen überein.*feiertagskalender\.ch/);
  assert.match(holidayInfoText(MAE), /widerspricht.*Gemeinde Baden.*einschaltest/);
  assert.match(holidayInfoText(SECHS), /Nur in der Websuche.*Nachmittag frei.*Halber Feiertag.*zuerich\.ch/);
});

// --- calendar clicks and the period list ----------------------------------------------------------

test("a click in the year overview only zooms, it never selects", () => {
  for (const flags of [{}, { plan: true }, { holiday: true }, { plan: true, holiday: true }]) {
    assert.equal(cellAction("year", flags), "zoom");
  }
  assert.equal(cellAction("month", { plan: true }), "period");
  assert.equal(cellAction("month", { holiday: true, plan: true }), "holiday");
  assert.equal(cellAction("month", {}), null);
});

test("list and month detail share one selection (same key → same highlight)", () => {
  const p1 = { start: "2027-05-06", end: "2027-05-09", vacation_days_required: 1, days_free: 4,
    vacation_dates: ["2027-05-07"], vacation_days_by_year: { 2027: 1 } };
  const p0 = { start: "2027-03-26", end: "2027-03-29", vacation_days_required: 1, days_free: 4,
    vacation_dates: ["2027-03-26"], vacation_days_by_year: { 2027: 1 } };
  const summary = { plan: [p1, p0] };
  const items = periodListItems(summary, null);
  assert.deepEqual(items.map((i) => i.key), [periodKey(p0), periodKey(p1)]);   // chronological
  assert.ok(items.every((i) => !i.selected));
  // The list button and a turquoise day in the month detail both pass the period key to
  // the same handler; the calendar highlight and the list marker derive from that key.
  const key = items[1].key;
  const days = [{ date: "2027-05-07", is_working_day: true, is_holiday: false, holiday_names: [], work_fraction: 1 }];
  const highlighted = applyPlan(days, summary.plan, key);
  assert.equal(highlighted[0].plan_key, key);
  assert.equal(highlighted[0].in_selected_period, true);
  assert.deepEqual(periodListItems(summary, key).map((i) => i.selected), [false, true]);
  assert.match(items[0].title, /1 Ferientag → 4 Tage frei · 26\.–29\. März 2027/);
});

// --- "Über Adam" ----------------------------------------------------------------------------------

test("help modal: mailto and donate link from the config, missing values hide the element", () => {
  assert.deepEqual(aboutLinks({}), { contact: null, website: null, donate: null });
  assert.deepEqual(aboutLinks(readAboutConfig("{broken")), { contact: null, website: null, donate: null });
  const links = aboutLinks({ contact_email: "hallo@example.org", website_url: "https://www.example.org/",
    donate_url: "https://example.org/spenden", donate_label: "Kaffee spendieren" });
  assert.deepEqual(links.contact, { href: "mailto:hallo@example.org", text: "hallo@example.org" });
  assert.deepEqual(links.website, { href: "https://www.example.org/", text: "example.org" });
  assert.deepEqual(links.donate, { href: "https://example.org/spenden", text: "Kaffee spendieren" });
  assert.equal(aboutLinks({ donate_url: "https://example.org/x" }).donate.text, "Spenden");
  assert.equal(aboutLinks({ donate_url: "javascript:alert(1)" }).donate, null);
  assert.equal(aboutLinks({ contact_email: "x" }).contact, null);
});

test("help modal is static: no API module, no fetch, links open safely", () => {
  const src = readFileSync(new URL("../../public/js/help-modal.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /fetch\(|XMLHttpRequest|from "\.\/api\.js"/);
  assert.match(src, /noopener noreferrer/);
  assert.match(src, /_blank/);
  assert.doesNotMatch(src, /innerHTML/);
});

test("the town modal never opens in the wizard; town panels have a button for it", () => {
  const main = readFileSync(new URL("../../public/js/main.js", import.meta.url), "utf8");
  const choose = main.slice(main.indexOf("function chooseWorkLocation"), main.indexOf("}", main.indexOf("function chooseWorkLocation")));
  assert.doesNotMatch(choose, /openTown/);                       // step 2: zoom only
  assert.match(main, /const openTown = \(id, from = null\) => \{\s*if \(isDone\(\)\)/);
  const modal = readFileSync(new URL("../../public/js/town-modal.js", import.meta.url), "utf8");
  assert.doesNotMatch(modal, /Weiter|wizard/i);
  const panels = readFileSync(new URL("../../public/js/town-panels.js", import.meta.url), "utf8");
  assert.match(panels, /optionsBtn\.textContent = "Optionale Feiertage und halbe Tage"/);
  assert.match(panels, /optionsBtn\.addEventListener\("click", \(\) => onOpenTown\(loc\.id, optionsBtn\)\)/);
});

test("an open month filters the period list; periods from the month before/after that reach into it stay", () => {
  const mk = (start, end) => ({ start, end, vacation_days_required: 1, days_free: 4, vacation_dates: [], vacation_days_by_year: {} });
  const octNov = mk("2026-10-31", "2026-11-08");     // starts in October
  const dec = mk("2026-12-05", "2026-12-08");
  const newYear = mk("2026-12-25", "2027-01-03");    // ends in January
  const summary = { plan: [dec, newYear, octNov] };
  const keys = (month) => periodListItems(summary, null, month).map((i) => i.key);
  assert.deepEqual(keys("2026-11"), [periodKey(octNov)]);
  assert.deepEqual(keys("2026-10"), [periodKey(octNov)]);
  assert.deepEqual(keys("2026-12"), [periodKey(dec), periodKey(newYear)]);
  assert.deepEqual(keys("2027-01"), [periodKey(newYear)]);
  assert.deepEqual(keys("2026-09"), []);
  assert.deepEqual(keys(null), [periodKey(octNov), periodKey(dec), periodKey(newYear)]);   // year view: all
  assert.equal(overlapsMonth(mk("2028-02-28", "2028-02-29"), "2028-02"), true);
  assert.equal(overlapsMonth(mk("2027-03-01", "2027-03-02"), "2027-02"), false);
  // the selection marker survives the filter
  assert.deepEqual(periodListItems(summary, periodKey(dec), "2026-12").map((i) => i.selected), [true, false]);
});

test("town panel title: holidays and the plan in one line", () => {
  assert.equal(townHeadline({ holidays_total: 9, plan: [{}, {}], plan_vacation_days: 15, plan_days_free: 44 }),
    "9 Feiertage · 15 Ferientage → 44 Tage frei");
  assert.equal(townHeadline({ holidays_total: 1, plan: [{}], plan_vacation_days: 0.5, plan_days_free: 3 }),
    "1 Feiertag · ½ Ferientag → 3 Tage frei");
  assert.equal(townHeadline({ holidays_total: 9, plan: [], plan_vacation_days: 0, plan_days_free: 0 }), "9 Feiertage");
  assert.equal(townHeadline(null), "");
});

test("boundary months are not shaded (no 'outside' class, no legend entry)", () => {
  const view = readFileSync(new URL("../../public/js/calendar-view.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../public/css/app.css", import.meta.url), "utf8");
  assert.doesNotMatch(view, /classList\.add\("outside"\)|Ausserhalb des Planjahres/);
  assert.doesNotMatch(css, /\.day\.outside/);
});
