// Search box view: combobox + listbox. All text is set via textContent.
import { createSearchController } from "./search-controller.js";
import { locationDetail, locationLabel } from "./state.js";

export function createSearchBox({ input, list, status, fetchLocations, onSelect, isSelected }) {
  let results = [];
  let active = -1;

  const setStatus = (text) => {
    status.textContent = text ?? "";
    status.hidden = !text;
  };

  const setOpen = (open) => {
    list.hidden = !open;
    input.setAttribute("aria-expanded", String(open));
    if (!open) input.removeAttribute("aria-activedescendant");
  };

  function highlight(index) {
    active = index;
    [...list.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === index)));
    if (index >= 0) {
      input.setAttribute("aria-activedescendant", list.children[index].id);
      list.children[index].scrollIntoView({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function renderResults(items) {
    results = items;
    active = -1;
    list.replaceChildren(
      ...items.map((loc, i) => {
        const li = document.createElement("li");
        li.id = `location-option-${i}`;
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", "false");
        const primary = document.createElement("span");
        primary.className = "option-primary";
        primary.textContent = locationLabel(loc);
        const detail = document.createElement("span");
        detail.className = "option-detail";
        detail.textContent = locationDetail(loc) + (isSelected(loc) ? " · bereits hinzugefügt" : "");
        li.append(primary, detail);
        // mousedown keeps focus in the input so the list doesn't close before the click.
        li.addEventListener("mousedown", (e) => e.preventDefault());
        li.addEventListener("click", () => choose(i));
        return li;
      })
    );
    setOpen(items.length > 0);
  }

  const controller = createSearchController({
    fetchLocations,
    onState(state) {
      switch (state.status) {
        case "idle":
          renderResults([]);
          setStatus(null);
          break;
        case "loading":
          setStatus("Suche …");
          break;
        case "results":
          renderResults(state.results);
          setStatus(state.results.length ? null : "Keine Orte gefunden.");
          break;
        case "error":
          renderResults([]);
          setStatus(state.message);
          break;
      }
    },
  });

  function choose(index) {
    const loc = results[index];
    if (!loc) return;
    input.value = "";
    controller.reset();
    onSelect(loc);
  }

  input.addEventListener("input", () => controller.input(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && results.length) {
      e.preventDefault();
      highlight((active + 1) % results.length);
    } else if (e.key === "ArrowUp" && results.length) {
      e.preventDefault();
      highlight(active <= 0 ? results.length - 1 : active - 1);
    } else if (e.key === "Enter" && results.length) {
      e.preventDefault();
      choose(active >= 0 ? active : 0);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  });
  input.addEventListener("blur", () => setOpen(false));
  input.addEventListener("focus", () => setOpen(results.length > 0));

  return { focus: () => input.focus() };
}
