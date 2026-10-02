// Planner panel. M2 content: the selected-location chips and "Ort hinzufügen".
import { locationLabel } from "./state.js";

export function createPlannerPanel({ panel, chips, addButton, onRemove, onAdd }) {
  addButton.addEventListener("click", onAdd);

  function render(locations) {
    chips.replaceChildren(
      ...locations.map((loc) => {
        const li = document.createElement("li");
        li.className = "chip";
        const label = document.createElement("span");
        label.textContent = `${locationLabel(loc)} (${loc.canton})`;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "chip-remove";
        remove.textContent = "×";
        remove.setAttribute("aria-label", `${locationLabel(loc)} entfernen`);
        remove.addEventListener("click", () => onRemove(loc.id));
        li.append(label, remove);
        return li;
      })
    );
  }

  return {
    render,
    open: () => { panel.hidden = false; },
    close: () => { panel.hidden = true; },
    isOpen: () => !panel.hidden,
  };
}
