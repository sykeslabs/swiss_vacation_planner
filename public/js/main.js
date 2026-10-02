import { createSwissMap } from "./map.js";

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
