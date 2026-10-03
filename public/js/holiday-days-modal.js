// "N Feiertage" of a town: the exact dates of the planned year's public holidays (the same
// days the count and the calendar use). Movable, non-blocking window; a date opens its
// details like in the month view. Text only.
import { holidayDays } from "./calendar-model.js";
import { createDialog, el } from "./dialog.js";
import { formatDateWithWeekday } from "./format.js";

export function createHolidayDaysModal({ onHolidayClick = () => {} } = {}) {
  const dialog = createDialog({ className: "holiday-days-modal", movable: true, modal: false });
  let ownerId = null;
  return {
    /** `days`: DayInfo list of the town (with the plan applied or not). */
    open({ locationId, town, year, days, from }) {
      ownerId = locationId;
      const items = holidayDays(days);
      dialog.setTitle(`Feiertage ${year} · ${town}`);
      const list = el("ul", "holiday-rows");
      list.append(...items.map((h) => {
        const li = el("li", "holiday-row");
        const tags = [h.half ? "halber Tag" : null, h.offDay ? "an einem freien Tag" : null].filter(Boolean).join(" · ");
        const label = `${formatDateWithWeekday(h.date)} – ${h.names}`;
        const open = el("button", "row-label row-link", label);
        open.type = "button";
        open.title = "Details zum Feiertag";
        open.setAttribute("aria-haspopup", "dialog");
        open.addEventListener("click", () => onHolidayClick({ locationId: ownerId, date: h.date, from: open }));
        li.append(open, el("span", "row-tag", tags));
        return li;
      }));
      dialog.body.replaceChildren(
        items.length ? list : el("p", "muted", "Keine Feiertage in diesem Jahr."),
        el("p", "hint", "Optionale Feiertage zählen erst, wenn du sie unter «Optionale Feiertage und halbe Tage» einschaltest."),
      );
      dialog.open(from);
    },
    close: () => dialog.close(),
    closeFor(id) {
      if (dialog.isOpen() && ownerId === id) dialog.close();
    },
  };
}
