// One movable panel per selected town: title bar (drag handle, remove), status, legend
// and the town's own calendar. Positions are remembered per town in the browser.
import { createCalendarView, renderLegend } from "./calendar-view.js";
import { makeDraggable } from "./draggable.js";
import { defaultPosition, PANEL_GAP } from "./panel-layout.js";
import { locationLabel } from "./state.js";

export const POSITIONS_KEY = "svp.panels.v1";
const NARROW = "(max-width: 720px)";
const Z_BASE = 1100;

export function createTownPanels({ container, storage = null, onRemove, onLayoutChange = () => {}, searchPanel }) {
  const panels = new Map();          // id → { el, calendar, status, source, drag }
  let z = Z_BASE;
  let positions = {};
  try {
    positions = JSON.parse(storage?.getItem(POSITIONS_KEY) ?? "{}") ?? {};
  } catch {
    positions = {};
  }
  const narrow = window.matchMedia(NARROW);

  function savePositions() {
    try {
      storage?.setItem(POSITIONS_KEY, JSON.stringify(positions));
    } catch {
      // positions are a convenience only
    }
  }

  function bringToFront(id) {
    const p = panels.get(id);
    if (p) p.el.style.zIndex = String(++z);
  }

  function place(id, index) {
    const p = panels.get(id);
    if (!p) return;
    if (narrow.matches) {
      p.el.style.left = p.el.style.top = "";
      return;
    }
    const saved = positions[id];
    const searchRect = searchPanel?.getBoundingClientRect();
    const pos = saved ?? defaultPosition(index, {
      viewportWidth: window.innerWidth,
      top: PANEL_GAP + 52,
      minLeft: searchRect ? Math.round(searchRect.right + PANEL_GAP) : PANEL_GAP,
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
    title.textContent = `${locationLabel(loc)} (${loc.canton})`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "chip-remove";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `${locationLabel(loc)} entfernen`);
    remove.addEventListener("click", () => onRemove(loc.id));
    head.append(title, remove);

    const status = document.createElement("p");
    status.className = "hint town-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.textContent = "Kalender wird berechnet …";

    const legend = document.createElement("details");
    legend.className = "legend-box";
    legend.open = true;
    const summary = document.createElement("summary");
    summary.textContent = "Legende";
    legend.append(summary, renderLegend());

    const calendarEl = document.createElement("div");
    calendarEl.className = "calendar";
    const source = document.createElement("p");
    source.className = "source-note";

    el.append(head, status, legend, calendarEl, source);
    el.addEventListener("pointerdown", () => bringToFront(loc.id), true);
    el.addEventListener("focusin", () => bringToFront(loc.id));
    container.append(el);

    const drag = makeDraggable(el, head, {
      enabled: () => !narrow.matches,
      onStart: () => bringToFront(loc.id),
      onMove: () => onLayoutChange(),
      onEnd: (pos) => {
        positions[loc.id] = pos;
        savePositions();
        onLayoutChange();
      },
    });
    panels.set(loc.id, { el, calendar: createCalendarView(calendarEl), status, source, drag });
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
        }
      }
      savePositions();
      locations.forEach((loc, i) => {
        if (!panels.has(loc.id)) {
          create(loc);
          place(loc.id, i);
        }
      });
      onLayoutChange();
    },
    setResult(id, { days, fromMonth, statusText, sourceText }) {
      const p = panels.get(id);
      if (!p) return;
      p.calendar.setDays(days, { fromMonth });
      p.status.textContent = statusText;
      p.source.textContent = sourceText;
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
    rects: () => (container.hidden || narrow.matches ? [] : [...panels.values()].map((p) => p.el.getBoundingClientRect())),
    isNarrow: () => narrow.matches,
  };
}
