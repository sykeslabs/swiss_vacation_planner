// Geometry for the movable town panels. Pure functions (no DOM); unit-tested.

export const PANEL_WIDTH = 480;
export const PANEL_GAP = 12;
const CASCADE_STEP = 28;
const MIN_VISIBLE = 80;     // px of a panel that must stay on screen while dragging

/**
 * Default position of the panel with index `index`: side by side from the right edge,
 * leaving `minLeft` free (search panel). Panels that don't fit cascade near the right.
 */
export function defaultPosition(index, { viewportWidth, top, minLeft, width = PANEL_WIDTH, gap = PANEL_GAP }) {
  const sideBySide = viewportWidth - gap - (index + 1) * width - index * gap;
  if (sideBySide >= minLeft) return { left: sideBySide, top };
  const fit = Math.max(1, Math.floor((viewportWidth - minLeft - gap) / (width + gap)));
  const extra = index - fit + 1;
  const left = Math.max(minLeft, viewportWidth - gap - width - extra * CASCADE_STEP);
  return { left: Math.max(0, left), top: top + extra * CASCADE_STEP };
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
