// Moves a fixed-position element by dragging its handle (mouse, pen, touch) or with the
// arrow keys while the handle has focus (Shift = larger steps).
import { clampPosition } from "./panel-layout.js";

const KEY_STEP = 16;
const KEY_STEP_LARGE = 64;

// One stacking order for all movable panels (above the fixed panels at z-index 1000).
let topZ = 1100;
export function bringToFront(el) {
  el.style.zIndex = String(++topZ);
}

/** Saved {left, top} for one panel; storage failures are ignored (position is a convenience). */
export function storedPosition(storage, key) {
  try {
    const pos = JSON.parse(storage?.getItem(key) ?? "null");
    return pos && Number.isFinite(pos.left) && Number.isFinite(pos.top) ? pos : null;
  } catch {
    return null;
  }
}
export function storePosition(storage, key, pos) {
  try {
    storage?.setItem(key, JSON.stringify(pos));
  } catch {
    // ignore
  }
}

export function makeDraggable(el, handle, {
  onStart = () => {}, onMove = () => {}, onEnd = () => {}, enabled = () => true,
} = {}) {
  let drag = null;

  const viewport = () => ({
    width: el.offsetWidth,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    headerHeight: handle.offsetHeight || 40,
  });

  function moveTo(left, top) {
    const pos = clampPosition({ left, top }, viewport());
    el.style.left = `${pos.left}px`;
    el.style.top = `${pos.top}px`;
    onMove(pos);
    return pos;
  }

  handle.addEventListener("pointerdown", (e) => {
    if (!enabled() || e.button !== 0 || e.target.closest("button, a, input, select")) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    drag = { id: e.pointerId, dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    try {
      handle.setPointerCapture(e.pointerId);   // keeps the drag when the pointer leaves the handle
    } catch {
      // pointer already gone (or a synthetic event): dragging still works while over the handle
    }
    el.classList.add("is-dragging");
    onStart();
  });
  handle.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    moveTo(e.clientX - drag.dx, e.clientY - drag.dy);
  });
  const stop = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    el.classList.remove("is-dragging");
    const rect = el.getBoundingClientRect();
    onEnd({ left: Math.round(rect.left), top: Math.round(rect.top) });
  };
  handle.addEventListener("pointerup", stop);
  handle.addEventListener("pointercancel", stop);

  handle.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d || e.target !== handle || !enabled()) return;
    e.preventDefault();
    onStart();
    const rect = el.getBoundingClientRect();
    onEnd(moveTo(rect.left + d[0], rect.top + d[1]));
  });

  return {
    /** Place without a drag (initial position, window resize). */
    place(left, top) {
      return moveTo(left, top);
    },
  };
}
