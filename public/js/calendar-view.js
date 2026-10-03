// Calendar view. `renderMonth` is the ONE render function for the year overview, the
// month detail and (from M5) period highlighting (CLAUDE.md rule 6).
import { CATEGORIES, categoryLabel, dayCategory, groupByMonth } from "./calendar-model.js";
import { formatDateWithWeekday, monthTitle, WEEKDAYS_SHORT, weekdayIndex } from "./format.js";

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/**
 * What a click on a day does. Year overview: a month box only zooms in, it never selects a
 * period. Month detail: a holiday opens its background, a recommended day selects its period.
 */
export function cellAction(view, { holiday = false, plan = false } = {}) {
  if (view !== "month") return "zoom";
  if (holiday) return "holiday";
  if (plan) return "period";
  return null;
}

/**
 * Hover preview of a recommended period: marks the day cells of period `key` (year and
 * month view alike, via data-plan) and unmarks all others; `key` null clears. Returns the
 * number of marked cells. Works on anything with `dataset` and `classList`.
 */
export function markHover(cells, key) {
  let n = 0;
  for (const cell of cells) {
    const on = key !== null && cell.dataset.plan === key;
    cell.classList.toggle("is-hover", on);
    if (on) n += 1;
  }
  return n;
}

function dayTitle(day, category) {
  const parts = [formatDateWithWeekday(day.date), categoryLabel(category)];
  if (day.holiday_names.length) parts.push(day.holiday_names.join(", "));
  return parts.join(" · ");
}

/**
 * Renders one month from DayInfo objects. `detail` only changes how much text each
 * cell carries; categories, classes and highlighting are identical in both views.
 */
export function renderMonth(month, { detail = false } = {}) {
  const root = el("div", `month ${detail ? "month-detail" : "month-mini"}`);
  root.append(el(detail ? "h3" : "div", "month-title", monthTitle(month.year, month.month)));

  const grid = el("div", "month-grid");
  grid.setAttribute("role", "grid");
  const head = el("div", "month-row month-head");
  head.setAttribute("role", "row");
  for (const wd of WEEKDAYS_SHORT) {
    const h = el("span", "wd", wd);
    h.setAttribute("role", "columnheader");
    head.append(h);
  }
  grid.append(head);

  let row = el("div", "month-row");
  row.setAttribute("role", "row");
  for (let i = 0; i < weekdayIndex(month.days[0].date); i++) row.append(el("span", "day day-empty"));
  for (const day of month.days) {
    if (row.children.length === 7) {
      grid.append(row);
      row = el("div", "month-row");
      row.setAttribute("role", "row");
    }
    const category = dayCategory(day);
    const cell = el("span", `day cat-${category}`);
    cell.setAttribute("role", "gridcell");
    // Boundary months (Dec before, Jan after) look like the planned year (owner request).
    if (day.in_selected_period) cell.classList.add("in-period");
    cell.dataset.date = day.date;
    cell.title = dayTitle(day, category);
    if (day.plan_key) {
      // Part of a recommended period: clicking opens the period details (both views).
      cell.dataset.plan = day.plan_key;
      cell.title += " · Empfehlung";
      if (detail) {
        cell.title += ": klicken für Details";
        cell.tabIndex = 0;
        cell.setAttribute("aria-haspopup", "dialog");
      }
    }
    cell.append(el("span", "day-num", String(Number(day.date.slice(8)))));
    if (detail) {
      if (day.holiday_names.length) {
        cell.append(el("span", "day-note", day.holiday_names.join(", ")));
        // Holidays open their background info (see createCalendarView onHolidayClick).
        cell.dataset.holiday = "true";
        cell.tabIndex = 0;
        cell.setAttribute("aria-haspopup", "dialog");
        cell.title += " · Klicken für Hintergrund";
      }
      else if (category === "half_day") cell.append(el("span", "day-note", "½ Tag"));
      else if (category === "vacation_half") cell.append(el("span", "day-note", "½ Ferientag"));
    }
    row.append(cell);
  }
  grid.append(row);
  root.append(grid);
  return root;
}

export function renderLegend() {
  const list = el("ul", "legend");
  for (const { key, label } of CATEGORIES) {
    const item = el("li", "legend-item");
    item.append(el("span", `legend-swatch day cat-${key}`), el("span", "", label));
    list.append(item);
  }
  return list;
}

function prefersMotion() {
  return !document.hidden && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** FLIP: animate `node` from the rectangle `from` to its current layout position. */
function flip(node, from, { reverse = false } = {}) {
  const to = node.getBoundingClientRect();
  if (!from || !to.width || !to.height) return Promise.resolve();
  const inverted = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`;
  const frames = [{ transform: inverted, opacity: 0.4 }, { transform: "none", opacity: 1 }];
  node.style.transformOrigin = "top left";
  const anim = node.animate(reverse ? frames.reverse() : frames, { duration: 320, easing: "cubic-bezier(.2,.7,.2,1)" });
  return anim.finished.catch(() => {});
}

/**
 * Year overview (14 month boxes) with zoom into a month and back.
 * `container` gets fully managed content.
 */
export function createCalendarView(container, { onHolidayClick = null, onPeriodClick = null, onMonthChange = () => {} } = {}) {
  const yearView = el("div", "year-view");
  const detailView = el("div", "month-view");
  detailView.hidden = true;
  const back = el("button", "btn-back", "← Jahresübersicht");
  back.type = "button";
  const detailBody = el("div", "month-view-body");
  detailView.append(back, detailBody);
  container.replaceChildren(yearView, detailView);

  let months = [];
  let openKey = null;            // "YYYY-MM" of the zoomed month, kept across re-renders

  const keyOf = (m) => `${m.year}-${String(m.month).padStart(2, "0")}`;

  function renderYear() {
    yearView.replaceChildren(...months.map((m) => {
      const box = el("button", "month-box");
      box.type = "button";
      box.dataset.month = keyOf(m);
      box.setAttribute("aria-label", `${monthTitle(m.year, m.month)} vergrössern`);
      box.append(renderMonth(m));
      // cellAction("year") is always "zoom": selecting happens in the month detail or the list.
      box.addEventListener("click", () => openMonth(keyOf(m), box.getBoundingClientRect()));
      return box;
    }));
  }

  function renderDetail() {
    const m = months.find((x) => keyOf(x) === openKey);
    if (!m) return closeMonth({ animate: false });
    detailBody.replaceChildren(renderMonth(m, { detail: true }));
  }

  function openMonth(key, fromRect) {
    openKey = key;
    onMonthChange(key);
    renderDetail();
    yearView.hidden = true;
    detailView.hidden = false;
    // Bring the detail to the top of the (scrollable) planner panel. The jump is instant;
    // the FLIP below animates from where the month box was on screen.
    detailView.scrollIntoView({ block: "start", behavior: "auto" });
    back.focus({ preventScroll: true });
    if (prefersMotion()) flip(detailView, fromRect);
  }

  async function closeMonth({ animate = true } = {}) {
    const key = openKey;
    openKey = null;
    if (key) onMonthChange(null);
    if (detailView.hidden) return;
    const detailRect = detailView.getBoundingClientRect();
    yearView.hidden = false;
    detailView.hidden = true;
    const box = yearView.querySelector(`[data-month="${key}"]`);
    box?.scrollIntoView({ block: "nearest", behavior: "auto" });
    // Shrink the year box out of the detail rectangle for continuity.
    if (animate && box && prefersMotion()) await flip(box, detailRect);
    box?.focus({ preventScroll: true });
  }

  back.addEventListener("click", () => closeMonth());

  // Holiday cells in the month detail: click, Enter or Space opens the background info.
  function holidayFromEvent(e) {
    const cell = e.target.closest?.('[data-holiday="true"]');
    if (!cell || !onHolidayClick) return null;
    const m = months.find((x) => keyOf(x) === openKey);
    const day = m?.days.find((d) => d.date === cell.dataset.date);
    return day ? { day, cell } : null;
  }
  // Holidays open their background; other days of a recommended period open the period.
  function activate(e) {
    const hit = holidayFromEvent(e);
    const planCell = e.target.closest?.("[data-plan]");
    const action = cellAction("month", { holiday: Boolean(hit), plan: Boolean(planCell && onPeriodClick) });
    if (action === "holiday") onHolidayClick(hit.day, hit.cell);
    else if (action === "period") onPeriodClick(planCell.dataset.plan, planCell);
    return action !== null;
  }
  detailBody.addEventListener("click", activate);
  detailBody.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && activate(e)) e.preventDefault();
  });

  return {
    /** Re-render from a fresh day list; an open month detail stays open.
     * `fromMonth` ("YYYY-MM") hides earlier months (current-year planning). */
    /** Returns the number of months shown (used to size the panel). */
    setDays(days, { fromMonth = null } = {}) {
      months = groupByMonth(days).filter((m) => !fromMonth || keyOf(m) >= fromMonth);
      renderYear();
      if (openKey) renderDetail();
      return months.length;
    },
    clear() {
      months = [];
      openKey = null;
      yearView.replaceChildren();
      detailBody.replaceChildren();
      yearView.hidden = false;
      detailView.hidden = true;
    },
    openMonth: (key) => openMonth(key, yearView.querySelector(`[data-month="${key}"]`)?.getBoundingClientRect()),
    closeMonth,
    openMonthKey: () => openKey,
  };
}
