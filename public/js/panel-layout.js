// Geometry for the movable town panels. Pure functions (no DOM); unit-tested.

export const PANEL_WIDTH = 1000;   // room for 7 months per row with readable day numbers
export const PANEL_GAP = 12;
const CASCADE_STEP = 28;
const MIN_VISIBLE = 80;            // px of a panel that must stay on screen while dragging
const MIN_ROOM_BELOW = 160;        // a stacked panel needs at least this much height to start

/**
 * Default position of the panel with index `index`:
 * - side by side from the right edge while they fit next to the left panels (`minLeft`);
 * - otherwise right-aligned directly below the previous panel (`previous` = its rect);
 * - if there's no room below either, cascaded with a small offset.
 */
export function defaultPosition(index, {
  viewportWidth, viewportHeight = Infinity, top, minLeft, previous = null,
  width = PANEL_WIDTH, gap = PANEL_GAP,
}) {
  const sideBySide = viewportWidth - gap - (index + 1) * width - index * gap;
  if (sideBySide >= minLeft) return { left: sideBySide, top };
  const right = Math.max(0, Math.min(viewportWidth - gap - width, viewportWidth - width));
  if (index === 0 || !previous) return { left: right, top };
  const below = previous.top + previous.height + gap;
  if (below + MIN_ROOM_BELOW <= viewportHeight) return { left: right, top: below };
  return {
    left: Math.max(0, previous.left - CASCADE_STEP),
    top: Math.min(previous.top + CASCADE_STEP, Math.max(top, viewportHeight - MIN_ROOM_BELOW)),
  };
}

/** Keeps the title bar reachable: at least MIN_VISIBLE px horizontally, top inside the window. */
export function clampPosition({ left, top }, { width, viewportWidth, viewportHeight, headerHeight = 40 }) {
  const minLeft = MIN_VISIBLE - width;
  const maxLeft = viewportWidth - MIN_VISIBLE;
  const maxTop = Math.max(0, viewportHeight - headerHeight);
  return {
    left: Math.round(Math.min(Math.max(left, minLeft), maxLeft)),
    top: Math.round(Math.min(Math.max(top, 0), maxTop)),
  };
}

/**
 * Map padding that keeps markers clear of the panels: the panels' union on the right.
 * `rects` are DOMRect-like objects of the visible panels.
 */
export function rightCoverage(rects, viewportWidth) {
  const onRight = rects.filter((r) => r.left + r.width / 2 > viewportWidth / 2);
  if (!onRight.length) return 0;
  const minLeft = Math.min(...onRight.map((r) => r.left));
  return Math.max(0, Math.round(viewportWidth - minLeft));
}
