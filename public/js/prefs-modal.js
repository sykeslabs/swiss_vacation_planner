// ⚙ Präferenzen: year, working days and vacation days after onboarding. Every change is
// applied at once (the planner recalculates; a year change reloads the holidays).
import { createDialog, el } from "./dialog.js";
import { budgetField, workingDaysField, yearField } from "./preference-fields.js";

export function createPrefsModal({ store }) {
  const dialog = createDialog({ title: "Präferenzen", className: "prefs-modal" });
  const year = yearField(store);
  const days = workingDaysField(store);
  const budget = budgetField(store);
  dialog.body.append(year.root, days.root, budget.root,
    el("p", "hint", "Änderungen gelten sofort für alle Orte."));
  const render = (state) => {
    year.render(state);
    days.render(state);
    budget.render(state);
  };
  store.subscribe(render);
  render(store.get());
  return {
    open(from) {
      render(store.get());
      dialog.open(from);
    },
    close: () => dialog.close(),
  };
}
