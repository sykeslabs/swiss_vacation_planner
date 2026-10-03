// Modal glass dialog on the native <dialog> element: × button, Esc and a click outside
// close it; Tab stays inside; focus returns to the element that opened it. With
// `movable`, the title bar drags it (mouse, touch, arrow keys) like the other panels.
// With `modal: false` it doesn't block the page (no backdrop, no Tab trap; Esc still
// closes it), so other panels such as the holiday details can open on top of it.
import { bringToFront, makeDraggable } from "./draggable.js";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, [tabindex="0"]';

export const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

let idCounter = 0;

export function createDialog({
  title = "", className = "", closeLabel = "Schliessen", onClose = () => {}, movable = false, modal = true,
} = {}) {
  const root = el("dialog", `glass modal ${className}`.trim());
  const titleId = `dialog-title-${++idCounter}`;
  root.setAttribute("aria-labelledby", titleId);
  const frame = el("div", "modal-frame");
  const head = el("header", "modal-head");
  const heading = el("h2", "modal-title", title);
  heading.id = titleId;
  const close = el("button", "chip-remove modal-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", closeLabel);
  close.title = closeLabel;
  head.append(heading, close);
  const body = el("div", "modal-body");
  const footer = el("footer", "modal-foot");
  footer.hidden = true;
  frame.append(head, body, footer);
  root.append(frame);
  document.body.append(root);

  // Movable: absolute left/top instead of the centred default (margin: auto).
  let drag = null;
  let position = null;            // where the user left it (kept while the page is open)
  if (movable) {
    root.classList.add("is-movable");
    head.tabIndex = 0;
    head.title = "Ziehen zum Verschieben";
    head.setAttribute("aria-label", "Fenster verschieben mit Ziehen oder Pfeiltasten");
    drag = makeDraggable(root, head, { onEnd: (pos) => { position = pos; } });
  }
  function placeOnOpen() {
    if (!drag) return;
    const r = root.getBoundingClientRect();
    const pos = position ?? { left: (window.innerWidth - r.width) / 2, top: Math.max(24, (window.innerHeight - r.height) / 3) };
    drag.place(pos.left, pos.top);
  }

  let returnFocus = null;
  let reason = null;

  function hide(why = "close") {
    if (!root.open) return;
    reason = why;
    root.close();
  }
  root.addEventListener("close", () => {
    const target = returnFocus;
    returnFocus = null;
    const why = reason ?? "close";
    reason = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
    onClose(why);
  });
  close.addEventListener("click", () => hide("close"));
  // Esc: the native "cancel" event; we close ourselves so `onClose` sees the reason.
  root.addEventListener("cancel", (e) => {
    e.preventDefault();
    hide("escape");
  });
  // Outside click: the backdrop belongs to the <dialog> element itself, the content to the frame.
  // It counts only if the press also started outside: a drag that ends over the backdrop
  // (pointer faster than the moving dialog) must not close it.
  let pressedOutside = false;
  root.addEventListener("pointerdown", (e) => {
    pressedOutside = e.target === root;
  });
  root.addEventListener("click", (e) => {
    if (e.target === root && pressedOutside) hide("outside");
    pressedOutside = false;
  });
  if (!modal) {
    root.classList.add("is-modeless");
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        hide("escape");
      }
    });
    root.addEventListener("pointerdown", () => bringToFront(root), true);
  }
  root.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || !modal) return;
    const items = [...root.querySelectorAll(FOCUSABLE)].filter((n) => !n.closest("[hidden]") && n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  return {
    root, body, footer, heading,
    setTitle(text) {
      heading.textContent = text;
    },
    open(from = document.activeElement) {
      returnFocus = from instanceof HTMLElement ? from : null;
      if (!root.open) {
        if (modal) root.showModal();
        else root.show();
        placeOnOpen();
      }
      if (!modal) bringToFront(root);
      (root.querySelector("[autofocus]") ?? close).focus({ preventScroll: true });
    },
    close: hide,
    isOpen: () => root.open,
  };
}
