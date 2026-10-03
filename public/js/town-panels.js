// One movable panel per selected town: title bar (drag handle; the name opens the town
// modal; collapse, remove), status, legend, the town's own calendar and below it the list
// of recommended periods. Position and collapsed state are remembered per town.
import { createCalendarView, renderLegend } from "./calendar-view.js";
import { holidayCountText, periodListItems, planSummary } from "./candidate-list.js";
import { bringToFront as raise, makeDraggable } from "./draggable.js";
import { defaultPosition, PANEL_GAP } from "./panel-layout.js";
import { locationLabel } from "./state.js";

export const POSITIONS_KEY = "svp.panels.v4";   // v4: panels start right of the planner panel
const NARROW = "(max-width: 720px)";
const EXPECTED_PANEL_HEIGHT = 520;   // header + legend + 2 rows of 7 months + period list
const MONTHS_PER_ROW = 7;
export const COLLAPSED_KEY = "svp.panels-collapsed.v1";

export function createTownPanels({
  container, storage = null, onRemove, onLayoutChange = () => {}, leftPanel = null, onHolidayClick = () => {},
  rightBoundary = () => window.innerWidth, onPeriodClick = () => {}, onOpenTown = () => {}, topOffset = () => PANEL_GAP,
}) {
  const panels = new Map();          // id → { el, calendar, status, source, drag }
  let positions = {};
  try {
    positions = JSON.parse(storage?.getItem(POSITIONS_KEY) ?? "{}") ?? {};
  } catch {
    positions = {};
  }
  const narrow = window.matchMedia(NARROW);
  let collapsed = new Set();
  try {
    const saved = JSON.parse(storage?.getItem(COLLAPSED_KEY) ?? "[]");
    if (Array.isArray(saved)) collapsed = new Set(saved.filter((x) => typeof x === "string"));
  } catch {
    collapsed = new Set();
  }
  function saveCollapsed() {
    try {
      storage?.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
    } catch {
      // convenience only
    }
  }

  function savePositions() {
    try {
      storage?.setItem(POSITIONS_KEY, JSON.stringify(positions));
    } catch {
      // positions are a convenience only
    }
  }

  function bringToFront(id) {
    const p = panels.get(id);
    if (p) raise(p.el);
  }

  function place(id, index) {
    const p = panels.get(id);
    if (!p) return;
    const saved = positions[id];
    if (narrow.matches && !saved) {
      // Phones: panels start in the lower part of the screen, slightly cascaded.
      const top = Math.round(window.innerHeight * 0.45) + index * 28;
      p.drag.place(PANEL_GAP + index * 12, top);
      return;
    }
    const leftRect = leftPanel && !leftPanel.hidden ? leftPanel.getBoundingClientRect() : null;
    // The previous panel's calendar may not be loaded yet, so assume at least its full height.
    const prevEl = [...panels.values()][index - 1]?.el;
    const prevRect = prevEl?.getBoundingClientRect();
    const previous = prevRect && { left: prevRect.left, top: prevRect.top,
      height: Math.max(prevRect.height, EXPECTED_PANEL_HEIGHT) };
    const pos = saved ?? defaultPosition(index, {
      viewportWidth: rightBoundary(),
      viewportHeight: window.innerHeight,
      top: topOffset(),
      minLeft: leftRect ? Math.round(leftRect.right + PANEL_GAP) : PANEL_GAP,
      previous,
      width: p.el.offsetWidth || undefined,
    });
    p.drag.place(pos.left, pos.top);
  }

  function create(loc) {
    const el = document.createElement("section");
    el.className = "glass panel town-panel";
    el.dataset.locationId = loc.id;
    const titleId = `town-title-${loc.id}`;
    el.setAttribute("aria-labelledby", titleId);

    const head = document.createElement("header");
    head.className = "town-head";
    head.tabIndex = 0;
    head.title = "Ziehen zum Verschieben";
    head.setAttribute("aria-label", `${locationLabel(loc)}: Panel verschieben mit Ziehen oder Pfeiltasten`);
    const title = document.createElement("h2");
    title.id = titleId;
    title.className = "town-title";
    // The name opens the town modal (holidays, optional days); dragging uses the rest of the bar.
    const nameBtn = document.createElement("button");
    nameBtn.type = "button";
    nameBtn.className = "town-name";
    nameBtn.textContent = `${locationLabel(loc)} (${loc.canton})`;
    nameBtn.title = "Feiertage dieses Orts anzeigen";
    nameBtn.setAttribute("aria-haspopup", "dialog");
    nameBtn.addEventListener("click", () => onOpenTown(loc.id, nameBtn));
    const count = document.createElement("span");
    count.className = "town-count";            // "· 9 Feiertage" (set with each result)
    title.append(nameBtn, count);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "chip-remove";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `${locationLabel(loc)} entfernen`);
    remove.addEventListener("click", () => onRemove(loc.id));
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "chip-remove panel-toggle";
    const bodyId = `town-body-${loc.id}`;
    toggle.setAttribute("aria-controls", bodyId);
    const actions = document.createElement("span");
    actions.className = "head-actions";
    actions.append(toggle, remove);
    head.append(title, actions);

    const status = document.createElement("p");
    status.className = "hint town-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.textContent = "Kalender wird berechnet …";

    const legend = document.createElement("details");
    legend.className = "legend-box";
    legend.open = false;            // collapsed by default
    const summary = document.createElement("summary");
    summary.textContent = "Legende";
    legend.append(summary, renderLegend());

    const calendarEl = document.createElement("div");
    calendarEl.className = "calendar";
    const source = document.createElement("p");
    source.className = "source-note";

    // "So setzt du deine Ferientage clever ein": the recommended periods, chronological.
    // A click selects the period exactly like a turquoise day in the month detail.
    const tipsBox = document.createElement("details");
    tipsBox.className = "legend-box tips-box";
    tipsBox.open = true;
    const tipsSummary = document.createElement("summary");
    tipsSummary.textContent = "So setzt du deine Ferientage clever ein";
    const tipsBody = document.createElement("p");
    tipsBody.className = "hint plan-summary";
    tipsBody.textContent = "Empfehlung wird berechnet …";
    const periodList = document.createElement("ol");
    periodList.className = "period-list";
    tipsBox.append(tipsSummary, tipsBody, periodList);

    const body = document.createElement("div");
    body.className = "town-body";
    body.id = bodyId;
    body.append(status, legend, calendarEl, tipsBox, source);
    el.append(head, body);

    function setCollapsed(on) {
      body.hidden = on;
      el.classList.toggle("is-collapsed", on);
      toggle.textContent = on ? "▸" : "▾";
      toggle.setAttribute("aria-expanded", String(!on));
      toggle.setAttribute("aria-label", `${locationLabel(loc)} ${on ? "ausklappen" : "einklappen"}`);
      toggle.title = on ? "Ausklappen" : "Einklappen";
    }
    setCollapsed(collapsed.has(loc.id));
    toggle.addEventListener("click", () => {
      const on = !collapsed.has(loc.id);
      if (on) collapsed.add(loc.id);
      else collapsed.delete(loc.id);
      saveCollapsed();
      setCollapsed(on);
      onLayoutChange();
    });
    el.addEventListener("pointerdown", () => bringToFront(loc.id), true);
    el.addEventListener("focusin", () => bringToFront(loc.id));
    container.append(el);

    const drag = makeDraggable(el, head, {
      onStart: () => bringToFront(loc.id),
      onMove: () => onLayoutChange(),
      onEnd: (pos) => {
        positions[loc.id] = pos;
        savePositions();
        onLayoutChange();
      },
    });
    const entry = { el, status, source, drag, holidays: [], tipsBody, periodList, count, location: loc };
    entry.calendar = createCalendarView(calendarEl, {
      onHolidayClick: (day, cell) => onHolidayClick({
        location: loc, day, from: cell,
        holidays: entry.holidays.filter((h) => h.date === day.date),
      }),
      onPeriodClick: (key, cell) => onPeriodClick({ location: loc, key, from: cell }),
    });
    panels.set(loc.id, entry);
    bringToFront(loc.id);
  }

  function relayout() {
    [...panels.keys()].forEach((id, i) => place(id, i));
    onLayoutChange();
  }
  window.addEventListener("resize", relayout);
  narrow.addEventListener?.("change", relayout);

  return {
    /** Create/remove panels to match the selected towns (in selection order). */
    sync(locations) {
      const ids = new Set(locations.map((l) => l.id));
      for (const [id, p] of panels) {
        if (!ids.has(id)) {
          p.el.remove();
          panels.delete(id);
          delete positions[id];
          collapsed.delete(id);
        }
      }
      savePositions();
      saveCollapsed();
      locations.forEach((loc, i) => {
        if (!panels.has(loc.id)) {
          create(loc);
          place(loc.id, i);
        }
      });
      onLayoutChange();
    },
    setResult(id, { days, holidays = [], fromMonth, statusText, sourceText }) {
      const p = panels.get(id);
      if (!p) return;
      p.holidays = holidays;
      const months = p.calendar.setDays(days, { fromMonth });
      // Width follows the months shown (up to 7 per row), e.g. Oct–Jan → 4 columns.
      const cols = String(Math.max(1, Math.min(MONTHS_PER_ROW, months)));
      if (p.el.style.getPropertyValue("--month-cols") !== cols) {
        p.el.style.setProperty("--month-cols", cols);
        if (!positions[id]) {
          // not moved by the user: keep it right-aligned next to the "Jahr" panel
          place(id, [...panels.keys()].indexOf(id));
        } else {
          p.drag.place(positions[id].left, positions[id].top);   // re-clamp to the window
        }
        onLayoutChange();
      }
      p.status.textContent = statusText;
      p.source.textContent = sourceText;
    },
    /** The recommended plan (turquoise days) as a list below the calendar, the selected
     * period marked; and the number of public holidays next to the town name. */
    setPlan(id, summary, selectedKey = null) {
      const p = panels.get(id);
      if (!p) return;
      p.tipsBody.textContent = planSummary(summary);
      p.periodList.replaceChildren(...periodListItems(summary, selectedKey).map((item) => {
        const li = document.createElement("li");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "candidate-btn";
        btn.dataset.period = item.key;
        btn.setAttribute("aria-pressed", String(item.selected));
        btn.setAttribute("aria-haspopup", "dialog");
        const t = document.createElement("span");
        t.className = "candidate-title";
        t.textContent = item.title;
        btn.append(t);
        if (item.split) {
          const m = document.createElement("span");
          m.className = "candidate-meta";
          m.textContent = item.split;
          btn.append(m);
        }
        btn.addEventListener("click", () => onPeriodClick({ location: p.location, key: item.key, from: btn }));
        li.append(btn);
        return li;
      }));
      p.count.textContent = summary ? ` · ${holidayCountText(summary.holidays_total)}` : "";
    },
    setStatus(id, text) {
      const p = panels.get(id);
      if (p) p.status.textContent = text;
    },
    bringToFront,
    show: () => { container.hidden = false; },
    hide: () => { container.hidden = true; },
    isShown: () => !container.hidden,
    /** Screen rectangles of the panels (for keeping map markers clear of them). */
    rects: () => (container.hidden ? [] : [...panels.values()].map((p) => p.el.getBoundingClientRect())),
    isNarrow: () => narrow.matches,
  };
}
