import { fetchLocations } from "./api.js";
import { createSwissMap } from "./map.js";
import { createPlannerPanel } from "./planner.js";
import { createSearchBox } from "./search.js";
import { createLocationStore, locationLabel } from "./state.js";

const PLANNER_OPEN_DELAY_MS = 1000;   // search → zoom → ~1 s → planner panel

const notice = document.getElementById("map-notice");
function showNotice(text) {
  notice.textContent = text ?? "";
  notice.hidden = !text;
}

const swissMap = createSwissMap(document.getElementById("map"), { onNotice: showNotice });

const segButtons = document.querySelectorAll(".layer-switch .seg");
for (const btn of segButtons) {
  btn.addEventListener("click", () => {
    swissMap.setBaseLayer(btn.dataset.layer);
    for (const b of segButtons) {
      b.setAttribute("aria-pressed", String(b.dataset.layer === swissMap.activeBaseLayer()));
    }
  });
}

const store = createLocationStore();

const search = createSearchBox({
  input: document.getElementById("location-search"),
  list: document.getElementById("location-results"),
  status: document.getElementById("search-status"),
  fetchLocations,
  isSelected: (id) => store.has(id),
  onSelect(location) {
    if (!store.add(location)) swissMap.fitLocations([location]);   // already selected: just go there
  },
});

const planner = createPlannerPanel({
  panel: document.getElementById("planner"),
  chips: document.getElementById("location-chips"),
  addButton: document.getElementById("add-location"),
  onRemove: (id) => store.remove(id),
  onAdd: () => search.focus(),
});

let openTimer = null;
store.subscribe((locations) => {
  swissMap.setLocations(locations, locationLabel);
  swissMap.fitLocations(locations);
  planner.render(locations);
  if (!locations.length) {
    clearTimeout(openTimer);
    planner.close();
  } else if (!planner.isOpen()) {
    clearTimeout(openTimer);
    openTimer = setTimeout(() => planner.open(), PLANNER_OPEN_DELAY_MS);
  }
});
