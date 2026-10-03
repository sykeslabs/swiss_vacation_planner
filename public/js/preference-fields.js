// Form fields for Jahr, Arbeitstage and Anzahl Ferientage. Used by the wizard (steps 1 and 3)
// and the ⚙ preferences modal; they only call store methods (no business logic here).
import { el } from "./dialog.js";
import { parseBudget, selectableYears, validatePreferences, WEEKDAY_CODES } from "./state.js";

const WEEKDAY_LABELS = { MON: "Mo", TUE: "Di", WED: "Mi", THU: "Do", FRI: "Fr", SAT: "Sa", SUN: "So" };
const WEEKDAY_NAMES = { MON: "Montag", TUE: "Dienstag", WED: "Mittwoch", THU: "Donnerstag",
  FRI: "Freitag", SAT: "Samstag", SUN: "Sonntag" };

let idCounter = 0;
const uid = (name) => `${name}-${++idCounter}`;

function hintNode() {
  const p = el("p", "hint field-error");
  p.setAttribute("role", "alert");
  p.hidden = true;
  return p;
}
function setHint(node, text) {
  node.textContent = text ?? "";
  node.hidden = !text;
}

export function yearField(store) {
  const labelId = uid("year-label");
  const root = el("div", "field");
  const label = el("span", "field-label", "Jahr");
  label.id = labelId;
  const group = el("div", "year-badges");
  group.setAttribute("role", "group");
  group.setAttribute("aria-labelledby", labelId);
  const badges = selectableYears().map((y) => {
    const b = el("button", "year-badge", String(y));
    b.type = "button";
    b.dataset.year = String(y);
    b.addEventListener("click", () => store.setYear(y));
    return b;
  });
  group.append(...badges);
  root.append(label, group);
  return {
    root,
    render(state) {
      for (const b of badges) b.setAttribute("aria-pressed", String(Number(b.dataset.year) === state.year));
    },
  };
}

export function workingDaysField(store) {
  const labelId = uid("wd-label");
  const root = el("div", "field");
  const label = el("span", "field-label", "Arbeitstage");
  label.id = labelId;
  const group = el("div", "wd-toggles");
  group.setAttribute("role", "group");
  group.setAttribute("aria-labelledby", labelId);
  const hint = hintNode();
  const buttons = WEEKDAY_CODES.map((code) => {
    const b = el("button", "wd-toggle", WEEKDAY_LABELS[code]);
    b.type = "button";
    b.dataset.code = code;
    b.setAttribute("aria-label", WEEKDAY_NAMES[code]);
    b.addEventListener("click", () => {
      const changed = store.toggleWorkingDay(code);
      setHint(hint, changed ? null : "Mindestens ein Arbeitstag muss ausgewählt sein.");
    });
    return b;
  });
  group.append(...buttons);
  root.append(label, group, hint);
  return {
    root,
    render(state) {
      for (const b of buttons) b.setAttribute("aria-pressed", String(state.workingDays.includes(b.dataset.code)));
    },
    showError: (text) => setHint(hint, text),
  };
}

export function budgetField(store) {
  const id = uid("budget");
  const root = el("div", "field");
  const label = el("label", "", "Anzahl Ferientage");
  label.htmlFor = id;
  const input = document.createElement("input");
  input.id = id;
  input.type = "text";
  input.inputMode = "decimal";
  input.required = true;
  input.placeholder = "z. B. 25";
  input.autocomplete = "off";
  input.className = "text-input budget-input";
  const hint = hintNode();
  input.setAttribute("aria-describedby", `${id}-hint`);
  hint.id = `${id}-hint`;
  const apply = () => {
    const value = parseBudget(input.value);
    const error = validatePreferences({ workingDays: ["MON"], budget: value }).budget;
    if (error) {
      setHint(hint, error);
      input.setAttribute("aria-invalid", "true");
      return false;
    }
    input.removeAttribute("aria-invalid");
    setHint(hint, null);
    store.setBudget(value);
    return true;
  };
  input.addEventListener("change", apply);
  // A valid entry clears the error while typing, so the layout doesn't jump on blur
  // (which would move the "Weiter" button away from the pointer).
  input.addEventListener("input", () => {
    const value = parseBudget(input.value);
    if (!validatePreferences({ workingDays: ["MON"], budget: value }).budget) apply();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") apply();
  });
  root.append(label, input, hint);
  return {
    root,
    input,
    apply,
    render(state) {
      if (document.activeElement !== input) input.value = state.budget == null ? "" : String(state.budget).replace(".", ",");
    },
    showError(text) {
      setHint(hint, text);
      if (text) input.setAttribute("aria-invalid", "true");
    },
  };
}
