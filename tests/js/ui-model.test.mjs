// Run: node --test "tests/js/*.test.mjs"
// Pure view models behind the town modal, the period list, the calendar clicks and the
// "Über Adam" modal.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { aboutLinks, readAboutConfig } from "../../public/js/about-view.js";
import { applyPlan, dayCategory, holidayDays, periodKey } from "../../public/js/calendar-model.js";
import { cellAction, markHover } from "../../public/js/calendar-view.js";
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
  assert.match(holidayInfoText(SECHS), /Nur in der Websuche.*Nachmittag frei.*Halber Tag.*zuerich\.ch/);
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
  // two lines, no year split
  assert.equal(items[0].cost, "1 Ferientag → 4 Tage frei");
  assert.equal(items[0].range, "26.–29. März 2027");
  assert.deepEqual(Object.keys(items[0]).sort(), ["cost", "key", "range", "selected"]);
  const newYear = { start: "2026-12-25", end: "2027-01-10", vacation_days_required: 8.5, days_free: 17,
    vacation_dates: [], vacation_days_by_year: { 2026: 3.5, 2027: 5 } };
  const [ny] = periodListItems({ plan: [newYear] });
  assert.deepEqual([ny.cost, ny.range], ["8½ Ferientage → 17 Tage frei", "25. Dezember 2026 – 10. Januar 2027"]);
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

test("the town modal never opens by itself (wizard or \"+\"); town panels have a button for it", () => {
  const main = readFileSync(new URL("../../public/js/main.js", import.meta.url), "utf8");
  const choose = main.slice(main.indexOf("function chooseWorkLocation"), main.indexOf("}", main.indexOf("function chooseWorkLocation")));
  assert.doesNotMatch(choose, /openTown/);                       // step 2: zoom only
  const fromAdd = main.slice(main.indexOf("function addTown"));
  const add = fromAdd.slice(0, fromAdd.search(/\r?\n\}\r?\n/));
  assert.doesNotMatch(add, /openTown/);                          // "+": no modal either
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

test("hovering a period in the list highlights its days in the calendar", () => {
  const cell = (plan) => {
    const classes = new Set();
    return { dataset: plan ? { plan } : {}, classes,
      classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) } };
  };
  const a = "2027-05-06|2027-05-09";
  const cells = [cell(a), cell(a), cell("2027-05-14|2027-05-16"), cell(null)];
  assert.equal(markHover(cells, a), 2);
  assert.deepEqual(cells.map((c) => c.classes.has("is-hover")), [true, true, false, false]);
  assert.equal(markHover(cells, null), 0);
  assert.ok(cells.every((c) => !c.classes.has("is-hover")));
  const panels = readFileSync(new URL("../../public/js/town-panels.js", import.meta.url), "utf8");
  for (const ev of ["mouseenter", "mouseleave", "focus", "blur"]) assert.match(panels, new RegExp(`"${ev}"`));
});

test("holiday list behind 'N Feiertage': exactly the counted days of the planned year", () => {
  const d = (date, extra = {}) => ({ date, in_planned_year: true, is_holiday: false, holiday_names: [],
    work_fraction: 1, holiday_on_non_working_day: false, ...extra });
  const days = [
    d("2026-12-25", { in_planned_year: false, is_holiday: true, holiday_names: ["Weihnachten"], work_fraction: 0 }),
    d("2027-01-01", { is_holiday: true, holiday_names: ["Neujahrstag"], work_fraction: 0 }),
    d("2027-01-02", { is_holiday: true, holiday_names: ["Berchtoldstag"], work_fraction: 0, holiday_on_non_working_day: true }),
    d("2027-01-04"),
    d("2027-04-19", { is_holiday: true, holiday_names: ["Sechseläuten"], work_fraction: 0.5 }),
  ];
  assert.deepEqual(holidayDays(days), [
    { date: "2027-01-01", names: "Neujahrstag", half: false, offDay: false },
    { date: "2027-01-02", names: "Berchtoldstag", half: false, offDay: true },
    { date: "2027-04-19", names: "Sechseläuten", half: true, offDay: false },
  ]);
  assert.deepEqual(holidayDays(undefined), []);
});

test("curated local half days: labelled as local custom, half day, off by default", () => {
  const SECHS_CURATED = { key: "2026-04-20|Sechseläuten", date: "2026-04-20", name: "Sechseläuten", type: "local",
    enabled: false, disputed: false, confidence: "high", work_fraction: 0.5, source: "Lokale Bräuche (kuratierte Liste)",
    source_title: "Lokale Bräuche (kuratierte Liste)", source_url: "https://de.wikipedia.org/wiki/Sechseläuten",
    corroborated_by: ["https://www.ferienwiki.ch/feiertage/ch/zuerich"],
    note: "Kein gesetzlicher Feiertag. In der Stadt Zürich geben viele Arbeitgeber den Nachmittag frei." };
  const store = onboarded();
  const m = townHolidayModel({ location_id: "bfs-261", holidays: [SECHS_CURATED] }, store.get(),
    (k) => store.isHolidayActive("bfs-261", k));
  const row = m.switches.find((s) => s.key === SECHS_CURATED.key);
  assert.equal(row.active, false);
  assert.equal(row.tag, "lokal · halber Tag");
  assert.match(row.info, /Lokaler Brauch.*Nachmittag frei.*einschaltest.*Halber Tag.*ferienwiki\.ch/);
  assert.doesNotMatch(row.info, /wikipedia/);
});

test("holiday details: web-search links styled like the Wikipedia link, no 'Datum: …/Text: …' line", () => {
  const src = readFileSync(new URL("../../public/js/holiday-modal.js", import.meta.url), "utf8");
  assert.match(src, /el\("a", "holiday-link", `\$\{new URL\(url\)/);
  assert.doesNotMatch(src, /Datum: \$\{|Text: \$\{/);
  // separator between sources and the background text
  assert.ok(src.indexOf('el("hr", "holiday-sep")') > src.indexOf('"holiday-sources"'));
  assert.ok(src.indexOf('el("hr", "holiday-sep")') < src.indexOf('el("p", "holiday-text"'));
});

test("holiday details: date and town in the title bar, holiday name only for several holidays", () => {
  const src = readFileSync(new URL("../../public/js/holiday-modal.js", import.meta.url), "utf8");
  assert.match(src, /title\.textContent = `\$\{formatDateWithWeekday\(day\.date\)\} · \$\{town\}`/);
  assert.match(src, /if \(withName\) block\.append\(el\("h3", "holiday-name"/);
  assert.match(src, /const withName = holidays\.length > 1;/);
  assert.doesNotMatch(src, /holiday-meta/);
  const css = readFileSync(new URL("../../public/css/app.css", import.meta.url), "utf8");
  const rule = (sel) => css.match(new RegExp(`\.${sel} \{([^}]*)\}`))[1];
  for (const sel of ["holiday-facts", "holiday-sources"]) {
    assert.match(rule(sel), /font-size: 0\.88rem/);
    assert.match(rule(sel), /color: var\(--text\)/);
  }
});

test("preferences and help modals are movable", () => {
  for (const f of ["prefs-modal.js", "help-modal.js", "town-modal.js", "holiday-days-modal.js"]) {
    const src = readFileSync(new URL(`../../public/js/${f}`, import.meta.url), "utf8");
    assert.match(src, /createDialog\(\{[^}]*movable: true/, f);
  }
});

test("a drag that ends over the backdrop does not close a dialog", () => {
  const src = readFileSync(new URL("../../public/js/dialog.js", import.meta.url), "utf8");
  assert.match(src, /pressedOutside = e\.target === root/);
  assert.match(src, /if \(e\.target === root && pressedOutside\) hide\("outside"\)/);
});

test("turquoise days add up to the shown vacation days (half day 31.12. counts ½)", () => {
  // Granges 2027: 25.12.2026–10.1.2027, 9 turquoise days for 8½ Ferientage
  const wd = (date, wf = 1) => ({ date, is_working_day: true, is_holiday: false, holiday_names: [], work_fraction: wf });
  const days = ["2026-12-28", "2026-12-29", "2026-12-30"].map((d) => wd(d)).concat([wd("2026-12-31", 0.5)],
    ["2027-01-04", "2027-01-05", "2027-01-06", "2027-01-07", "2027-01-08"].map((d) => wd(d)));
  const plan = [{ start: "2026-12-25", end: "2027-01-10", vacation_days_required: 8.5, days_free: 17,
    vacation_dates: days.map((d) => d.date), vacation_days_by_year: {} }];
  const cats = applyPlan(days, plan).map(dayCategory);
  const cost = cats.reduce((n, c) => n + (c === "vacation" ? 1 : c === "vacation_half" ? 0.5 : 0), 0);
  assert.equal(cats[3], "vacation_half");
  assert.equal(cost, 8.5);
  const css = readFileSync(new URL("../../public/css/app.css", import.meta.url), "utf8");
  assert.match(css, /\.cat-vacation_half \{/);
  assert.match(css, /--cat-vacation-half-bg: linear-gradient\(135deg, var\(--cat-vacation-bg\) 50%, var\(--cat-holiday-bg\) 50%\)/);
});

test("town modal labels for periods", () => {
  const store = onboarded();
  store.addCustomDay({ date: "2026-12-21", endDate: "2026-12-23", name: "Betriebsferien", kind: "full", recurring: false });
  store.addCustomDay({ date: "2026-07-20", endDate: "2026-07-24", name: "Sommerpause", kind: "half", recurring: true });
  const m = townHolidayModel(null, store.get(), () => false);
  const bf = m.switches.find((s) => s.label.includes("Betriebsferien"));
  assert.equal(bf.label, "21.–23. Dezember 2026: Betriebsferien");
  assert.equal(bf.tag, "freie Tage");
  assert.match(bf.info, /jeder Tag im Zeitraum ist arbeitsfrei.*Nur in diesem Zeitraum/);
  const sp = m.switches.find((s) => s.label.includes("Sommerpause"));
  assert.equal(sp.label, "20. Juli – 24. Juli: Sommerpause");
  assert.equal(sp.tag, "halbe Tage · jährlich");
});

import { TODOS } from "../../public/js/todos.js";

test("'Über Adam' links to the to-do list (static, movable, incl. the school-holidays idea)", () => {
  assert.ok(TODOS.length >= 2 && TODOS.every((g) => g.group && g.items.length));
  const all = TODOS.flatMap((g) => g.items).join(" ");
  assert.match(all, /Schulferien/);
  assert.doesNotMatch(all, /ß/);
  const help = readFileSync(new URL("../../public/js/help-modal.js", import.meta.url), "utf8");
  assert.match(help, /Was ist geplant\? \(To-dos\)/);
  const modal = readFileSync(new URL("../../public/js/todo-modal.js", import.meta.url), "utf8");
  assert.match(modal, /movable: true/);
  assert.doesNotMatch(modal, /fetch\(|innerHTML/);
});

test("hovering a period in the calendar highlights its list entry (and its days)", () => {
  const item = (key) => {
    const classes = new Set();
    return { dataset: { period: key }, classes, classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) } };
  };
  const list = [item("a|b"), item("c|d")];
  assert.equal(markHover(list, "c|d", "period"), 1);
  assert.deepEqual(list.map((i) => i.classes.has("is-hover")), [false, true]);
  const panels = readFileSync(new URL("../../public/js/town-panels.js", import.meta.url), "utf8");
  assert.match(panels, /calendarEl\.addEventListener\("pointerover", previewFrom\)/);
  assert.match(panels, /markHover\(p\.periodList\.querySelectorAll\("\.candidate-btn"\), key, "period"\)/);
});

test("holiday date list: non-blocking, each date opens the holiday details", () => {
  const modal = readFileSync(new URL("../../public/js/holiday-days-modal.js", import.meta.url), "utf8");
  assert.match(modal, /movable: true, modal: false/);
  assert.match(modal, /onHolidayClick\(\{ locationId: ownerId, date: h\.date, from: open \}\)/);
  const main = readFileSync(new URL("../../public/js/main.js", import.meta.url), "utf8");
  assert.match(main, /createHolidayDaysModal\(\{\s*onHolidayClick:/);
  const dialog = readFileSync(new URL("../../public/js/dialog.js", import.meta.url), "utf8");
  assert.match(dialog, /if \(modal\) root\.showModal\(\);\s*else root\.show\(\);/);
});
