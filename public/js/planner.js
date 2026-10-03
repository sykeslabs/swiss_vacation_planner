// Planner panel (after onboarding): town chips (click → town modal, × → remove) and the
// vacation type. The vacation type is stored for travel discovery only (CLAUDE.md rule 5).
import { el } from "./dialog.js";
import { locationLabel, VACATION_TYPES } from "./state.js";

export function createPlannerPanel({ root, store, onOpenTown }) {
  const chips = root.querySelector("#town-chips");
  const select = root.querySelector("#vacation-type");
  for (const t of VACATION_TYPES) {
    const o = el("option", "", t.label);
    o.value = t.key;
    select.append(o);
  }
  select.addEventListener("change", () => store.setVacationType(select.value));

  function render(state) {
    select.value = state.vacationType;
    chips.replaceChildren(...state.locations.map((loc) => {
      const li = el("li", "chip");
      const name = `${locationLabel(loc)} (${loc.canton})`;
      const open = el("button", "chip-label", name);
      open.type = "button";
      open.title = "Feiertage dieses Orts anzeigen";
      open.setAttribute("aria-label", `${name}: Feiertage anzeigen`);
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
