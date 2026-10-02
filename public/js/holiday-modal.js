// Movable info panel for a public holiday (opened from the month detail view).
// All text is set via textContent; links open in a new tab.
import { bringToFront, makeDraggable } from "./draggable.js";
import { formatDateWithWeekday } from "./format.js";
import {
  effectLabel, jurisdictionLabel, loadHolidayInfo, lookupHoliday, wikipediaSearchUrl,
} from "./holiday-info.js";

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export function createHolidayModal({ parent = document.body } = {}) {
  const root = el("section", "glass panel holiday-modal");
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-labelledby", "holiday-modal-title");

  const head = el("header", "panel-head");
  head.tabIndex = 0;
  head.title = "Ziehen zum Verschieben";
  head.setAttribute("aria-label", "Feiertag: Panel verschieben mit Ziehen oder Pfeiltasten");
  const title = el("h2", "town-title");
  title.id = "holiday-modal-title";
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
  function hide() {
    root.hidden = true;
    returnFocus?.focus?.({ preventScroll: true });
    returnFocus = null;
  }
  close.addEventListener("click", hide);
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      hide();
    }
  });

  function holidayBlock(holiday, day, info) {
    const block = el("article", "holiday-entry");
    block.append(el("h3", "holiday-name", holiday.name));
    const facts = el("ul", "holiday-facts");
    facts.append(el("li", "", jurisdictionLabel(holiday)), el("li", "", effectLabel(day)));
    block.append(facts);
    const entry = lookupHoliday(info, holiday.name);
    block.append(el("p", "holiday-text", entry?.text
      ?? (info ? "Für diesen Feiertag ist noch kein Hintergrundtext hinterlegt."
        : "Der Hintergrundtext konnte nicht geladen werden.")));
    const link = el("a", "holiday-link", entry ? "Mehr dazu auf Wikipedia ↗" : "Auf Wikipedia suchen ↗");
    link.href = entry?.url ?? wikipediaSearchUrl(holiday.name);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    block.append(link);
    return block;
  }

  return {
    /** `holidays`: Holiday objects of that date; `day`: its DayInfo; `town`: label. */
    async open({ day, holidays, town, from }) {
      returnFocus = from ?? null;
      const info = await loadHolidayInfo();
      title.textContent = holidays.map((h) => h.name).join(" · ") || "Feiertag";
      const meta = el("p", "hint holiday-meta", `${formatDateWithWeekday(day.date)} · ${town}`);
      const sources = [...new Set(holidays.map((h) => h.source_title || h.source))].join(", ");
      const note = el("p", "source-note",
        `Datum: ${sources || "Referenzkalender"}. Text: ${info?.source ?? "redaktionell"}.`);
      body.replaceChildren(meta, ...holidays.map((h) => holidayBlock(h, day, info)), note);
      const wasHidden = root.hidden;
      root.hidden = false;
      if (wasHidden) {
        // Open centred; afterwards it stays where the user moved it.
        const r = root.getBoundingClientRect();
        drag.place((window.innerWidth - r.width) / 2, Math.max(70, (window.innerHeight - r.height) / 3));
      }
      bringToFront(root);
      close.focus({ preventScroll: true });
    },
    close: hide,
    isOpen: () => !root.hidden,
  };
}
