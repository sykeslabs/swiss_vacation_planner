// Movable details panel for a recommended period (opened by clicking a turquoise day in
// the year or month view, or the best period in the summary). textContent only.
import { yearSplit } from "./candidate-list.js";
import { vacationDaysLabel } from "./calendar-model.js";
import { bringToFront, makeDraggable } from "./draggable.js";
import { formatDateWithWeekday, formatRange } from "./format.js";

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export function createPeriodModal({ parent = document.body, onClose = () => {} } = {}) {
  const root = el("section", "glass panel holiday-modal period-modal");
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-labelledby", "period-modal-title");
  const head = el("header", "panel-head");
  head.tabIndex = 0;
  head.title = "Ziehen zum Verschieben";
  head.setAttribute("aria-label", "Periode: Panel verschieben mit Ziehen oder Pfeiltasten");
  const title = el("h2", "town-title");
  title.id = "period-modal-title";
  const close = el("button", "chip-remove", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Schliessen");
  head.append(title, close);
  const body = el("div", "holiday-body");
  root.append(head, body);
  parent.append(root);

  const drag = makeDraggable(root, head, { onStart: () => bringToFront(root) });
  root.addEventListener("pointerdown", () => bringToFront(root), true);

  let returnFocus = null;
  let current = null;
  function hide() {
    if (root.hidden) return;
    root.hidden = true;
    const was = current;
    current = null;
    returnFocus?.focus?.({ preventScroll: true });
    returnFocus = null;
    onClose(was);
  }
  close.addEventListener("click", hide);
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      hide();
    }
  });

  return {
    /** `period` = candidate, `town` = label, `locationId`, `from` = element to refocus. */
    open({ period, town, locationId, from }) {
      returnFocus = from ?? null;
      current = { locationId, period };
      title.textContent = formatRange(period.start, period.end);
      const facts = el("ul", "holiday-facts");
      facts.append(
        el("li", "", `${period.days_free} Tage frei für ${vacationDaysLabel(period.vacation_days_required)}`),
        el("li", "", `Effizienz: ${period.efficiency.toLocaleString("de-CH")} freie Tage pro Ferientag`),
      );
      if (period.anchor_holidays.length) facts.append(el("li", "", `Dank: ${period.anchor_holidays.join(", ")}`));
      if (yearSplit(period)) facts.append(el("li", "", yearSplit(period)));
      const dates = el("ul", "period-dates");
      for (const d of period.vacation_dates) dates.append(el("li", "", formatDateWithWeekday(d)));
      body.replaceChildren(
        el("p", "hint holiday-meta", town),
        facts,
        el("p", "field-label", "Diese Tage als Ferien eingeben:"),
        dates,
        el("p", "source-note", "Empfehlung des Optimierers aus deinen Arbeitstagen und den Feiertagen."),
      );
      const wasHidden = root.hidden;
      root.hidden = false;
      if (wasHidden) {
        const r = root.getBoundingClientRect();
        drag.place((window.innerWidth - r.width) / 2, Math.max(70, (window.innerHeight - r.height) / 3));
      }
      bringToFront(root);
      close.focus({ preventScroll: true });
    },
    close: hide,
    current: () => current,
  };
}
