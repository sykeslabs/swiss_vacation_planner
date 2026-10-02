// A fixed, movable panel with a title bar, an optional collapse button and remembered
// position/collapsed state (per browser). Used by the "Jahr" and summary panels.
import { bringToFront, makeDraggable, storedPosition, storePosition } from "./draggable.js";

const NARROW = "(max-width: 720px)";

export function makeFloatingPanel({
  root, head, toggle = null, body = null, storage = null, positionKey, collapsedKey = null,
  defaultPosition, toggleLabel = "Panel",
}) {
  const narrow = window.matchMedia(NARROW);
  const drag = makeDraggable(root, head, {
    onStart: () => bringToFront(root),
    onEnd: (pos) => storePosition(storage, positionKey, pos),
  });
  root.addEventListener("pointerdown", () => bringToFront(root), true);
  root.addEventListener("focusin", () => bringToFront(root));

  function place() {
    if (root.hidden) return;
    const pos = storedPosition(storage, positionKey)
      ?? defaultPosition(root.getBoundingClientRect(), { narrow: narrow.matches });
    drag.place(pos.left, pos.top);
  }
  window.addEventListener("resize", place);
  narrow.addEventListener?.("change", place);

  function setCollapsed(on) {
    if (!toggle || !body) return;
    body.hidden = on;
    root.classList.toggle("is-collapsed", on);
    toggle.textContent = on ? "▸" : "▾";
    toggle.setAttribute("aria-expanded", String(!on));
    toggle.setAttribute("aria-label", `${toggleLabel} ${on ? "ausklappen" : "einklappen"}`);
    toggle.title = on ? "Ausklappen" : "Einklappen";
  }
  if (toggle && body) {
    let start = false;
    try {
      start = collapsedKey ? storage?.getItem(collapsedKey) === "1" : false;
    } catch {
      start = false;
    }
    setCollapsed(start);
    toggle.addEventListener("click", () => {
      const on = !root.classList.contains("is-collapsed");
      setCollapsed(on);
      try {
        if (collapsedKey) storage?.setItem(collapsedKey, on ? "1" : "0");
      } catch {
        // convenience only
      }
    });
  }

  return {
    place,
    show() {
      const was = root.hidden;
      root.hidden = false;
      if (was) place();
    },
    hide() {
      root.hidden = true;
    },
    bringToFront: () => bringToFront(root),
  };
}
