// "Deine Orte" panel (after onboarding): town chips (click → town modal, × → remove).
// The "+" button in its title bar is wired in main.js.
import { el } from "./dialog.js";
import { locationLabel } from "./state.js";

export function createPlannerPanel({ root, store, onOpenTown }) {
  const chips = root.querySelector("#town-chips");

  function render(state) {
    chips.replaceChildren(...state.locations.map((loc) => {
      const li = el("li", "chip");
      const name = `${locationLabel(loc)} (${loc.canton})`;
      const open = el("button", "chip-label", name);
      open.type = "button";
      open.title = "Optionale Feiertage und halbe Tage";
      open.setAttribute("aria-label", `${name}: optionale Feiertage und halbe Tage`);
      open.addEventListener("click", () => onOpenTown(loc.id, open));
      const rm = el("button", "chip-remove", "×");
      rm.type = "button";
      rm.title = "Entfernen";
      rm.setAttribute("aria-label", `${name} entfernen`);
      rm.addEventListener("click", () => store.removeLocation(loc.id));
      li.append(open, rm);
      return li;
    }));
  }
  store.subscribe(render);
  render(store.get());
  return { render: () => render(store.get()) };
}
