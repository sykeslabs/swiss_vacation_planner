// Onboarding wizard: 1 Jahr → 2 Arbeitsort (+ town modal) → 3 Präferenzen → planner.
// It only fills PlannerState through store methods; the steps' rules live in state.js.
import { el } from "./dialog.js";
import { budgetField, workingDaysField, yearField } from "./preference-fields.js";
import { createSearchBox } from "./search.js";
import { DONE, locationLabel, validatePreferences } from "./state.js";

function navButtons({ back = null, next }) {
  const row = el("div", "wizard-nav");
  if (back) {
    const b = el("button", "btn-secondary", "Zurück");
    b.type = "button";
    b.addEventListener("click", back);
    row.append(b);
  }
  const n = el("button", "btn-primary", "Weiter");
  n.type = "button";
  n.addEventListener("click", next);
  row.append(n);
  return { row, next: n };
}

export function createWizard({ root, store, fetchLocations, onPickLocation, onCheckHolidays }) {
  const progress = el("p", "wizard-progress");
  const title = el("h1", "wizard-title");
  title.id = "wizard-title";
  root.setAttribute("aria-labelledby", "wizard-title");
  root.append(progress, title);

  // Step 1: Jahr
  const step1 = el("div", "wizard-step");
  const year = yearField(store);
  const nav1 = navButtons({ next: () => store.wizardNext() });
  step1.append(el("p", "hint wizard-lead", "Adam zeigt dir, wie du mit wenigen Ferientagen möglichst viele freie Tage am Stück bekommst."),
    year.root, nav1.row);

  // Step 2: Arbeitsort
  const step2 = el("div", "wizard-step");
  const searchBox = el("div", "search");
  const input = document.createElement("input");
  input.type = "search";
  input.id = "wizard-search";
  input.placeholder = "Arbeitsort oder PLZ suchen";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", "wizard-results");
  input.setAttribute("aria-label", "Arbeitsort oder PLZ suchen");
  const list = el("ul", "results");
  list.id = "wizard-results";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Suchergebnisse");
  list.hidden = true;
  const status = el("p", "search-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.hidden = true;
  searchBox.append(input, list, status);
  let searching = !store.get().locations.length;   // search visible (no town yet, or "Anderen Ort wählen")
  createSearchBox({
    input, list, status, fetchLocations,
    isSelected: () => false,
    onSelect: (loc) => {
      searching = false;
      onPickLocation(loc);
    },
  });
  const chosen = el("div", "wizard-chosen");
  const chosenName = el("p", "wizard-place");
  const check = el("button", "btn-secondary", "Feiertage prüfen");
  check.type = "button";
  check.addEventListener("click", () => onCheckHolidays(check));
  const other = el("button", "btn-link", "Anderen Ort wählen");
  other.type = "button";
  other.addEventListener("click", () => {
    searching = true;
    render(store.get());
    input.focus();
  });
  const chosenActions = el("div", "wizard-actions");
  chosenActions.append(check, other);
  chosen.append(chosenName, chosenActions);
  const error2 = el("p", "hint field-error");
  error2.setAttribute("role", "alert");
  error2.hidden = true;
  const nav2 = navButtons({
    back: () => store.wizardBack(),
    next: () => {
      const r = store.wizardNext();
      error2.hidden = !r.error;
      error2.textContent = r.error ? "Bitte wähle zuerst deinen Arbeitsort." : "";
    },
  });
  step2.append(el("p", "hint wizard-lead", "Die Feiertage hängen von deinem Arbeitsort ab. Du kannst ihn auch auf der Karte anklicken."),
    searchBox, chosen, error2, nav2.row);

  // Step 3: Präferenzen
  const step3 = el("div", "wizard-step");
  const days = workingDaysField(store);
  const budget = budgetField(store);
  const nav3 = navButtons({
    back: () => store.wizardBack(),
    next: () => {
      // An invalid entry in the field blocks, even if an earlier valid value is stored.
      const budgetOk = budget.input.value.trim() !== "" && budget.apply();
      const r = budgetOk ? store.wizardNext()
        : { error: "preferences", errors: validatePreferences({ workingDays: store.get().workingDays, budget: Number.NaN }) };
      if (r.error) {
        days.showError(r.errors.workingDays ?? null);
        budget.showError(r.errors.budget ?? null);
        (r.errors.workingDays ? days.root.querySelector("button") : budget.input).focus();
      }
    },
  });
  nav3.next.textContent = "Kalender anzeigen";
  step3.append(days.root, budget.root, nav3.row);

  root.append(step1, step2, step3);

  const TITLES = { 1: "Für welches Jahr planst du?", 2: "Wo arbeitest du?", 3: "Deine Arbeitstage und Ferientage" };
  let lastStep = null;
  function render(state) {
    const step = state.onboarding;
    root.hidden = step === DONE;
    if (step === DONE) {
      lastStep = step;
      return;
    }
    root.dataset.step = String(step);
    progress.textContent = `Schritt ${step} von 3`;
    title.textContent = TITLES[step];
    step1.hidden = step !== 1;
    step2.hidden = step !== 2;
    step3.hidden = step !== 3;
    year.render(state);
    days.render(state);
    budget.render(state);
    const loc = state.locations[0];
    if (!loc) searching = true;
    searchBox.hidden = !searching;
    chosen.hidden = searching || !loc;
    if (loc) chosenName.textContent = `Arbeitsort: ${locationLabel(loc)} (${loc.canton})`;
    if (loc) error2.hidden = true;
    if (step !== lastStep) {
      lastStep = step;
      // move focus into the new step (not on the first render: the page just loaded)
      const target = step === 1 ? nav1.next : step === 2 ? (searching ? input : nav2.next) : days.root.querySelector("button");
      if (document.activeElement && document.activeElement !== document.body) target?.focus({ preventScroll: true });
      else if (step === 2 && searching) input.focus({ preventScroll: true });
    }
  }
  store.subscribe(render);
  render(store.get());

  return {
    render: () => render(store.get()),
    /** Step 2: a place was chosen on the map. */
    picked() {
      searching = false;
      render(store.get());
    },
  };
}
