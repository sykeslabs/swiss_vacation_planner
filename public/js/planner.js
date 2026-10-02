// Shared settings (apply to every town): year, working days and half days.
// Lives in the search panel top left. All text is set via textContent.
import { formatDateWithWeekday } from "./format.js";
import { calendarWindow, selectableYears, WEEKDAY_CODES } from "./state.js";

const WEEKDAY_LABELS = { MON: "Mo", TUE: "Di", WED: "Mi", THU: "Do", FRI: "Fr", SAT: "Sa", SUN: "So" };
const WEEKDAY_NAMES = { MON: "Montag", TUE: "Dienstag", WED: "Mittwoch", THU: "Donnerstag",
  FRI: "Freitag", SAT: "Samstag", SUN: "Sonntag" };

export function createSettingsPanel({ root, store }) {
  const $ = (id) => root.querySelector(`#${id}`);
  const yearSelect = $("planner-year");
  const weekdayBox = $("working-days");
  const workingHint = $("working-days-hint");
  const halfList = $("half-days");
  const halfInput = $("half-day-input");
  const halfAdd = $("half-day-add");
  const halfHint = $("half-day-hint");

  for (const y of selectableYears()) {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    yearSelect.append(opt);
  }
  yearSelect.addEventListener("change", () => store.setYear(Number(yearSelect.value)));

  const weekdayButtons = WEEKDAY_CODES.map((code) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "wd-toggle";
    b.dataset.code = code;
    b.textContent = WEEKDAY_LABELS[code];
    b.setAttribute("aria-label", WEEKDAY_NAMES[code]);
    b.addEventListener("click", () => {
      const changed = store.toggleWorkingDay(code);
      workingHint.hidden = changed;
      if (!changed) workingHint.textContent = "Mindestens ein Arbeitstag muss ausgewählt sein.";
    });
    weekdayBox.append(b);
    return b;
  });

  function addHalfDay() {
    const result = halfInput.value ? store.addHalfDay(halfInput.value) : "empty";
    const messages = {
      empty: "Bitte wähle ein Datum.",
      out_of_range: "Das Datum muss im angezeigten Zeitraum liegen.",
      duplicate: "Dieser Tag ist bereits ein halber Arbeitstag.",
    };
    halfHint.textContent = messages[result] ?? "";
    halfHint.hidden = result === "added";
    if (result === "added") halfInput.value = "";
  }
  halfAdd.addEventListener("click", addHalfDay);
  halfInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addHalfDay();
    }
  });

  function renderConfig(state) {
    yearSelect.value = String(state.year);
    for (const b of weekdayButtons) b.setAttribute("aria-pressed", String(state.workingDays.includes(b.dataset.code)));
    const { start, end } = calendarWindow(state.year);
    halfInput.min = start;
    halfInput.max = end;
    halfList.replaceChildren(...Object.keys(state.halfDays).sort().map((iso) => {
      const li = document.createElement("li");
      li.className = "half-day";
      const label = document.createElement("span");
      label.textContent = formatDateWithWeekday(iso);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "chip-remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `${formatDateWithWeekday(iso)} entfernen`);
      remove.addEventListener("click", () => store.removeHalfDay(iso));
      li.append(label, remove);
      return li;
    }));
    if (!Object.keys(state.halfDays).length) {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "Keine halben Arbeitstage.";
      halfList.append(li);
    }
  }

  return {
    render(state) {
      renderConfig(state);
    },
    open: () => { root.hidden = false; },
    close: () => { root.hidden = true; },
    isOpen: () => !root.hidden,
  };
}
