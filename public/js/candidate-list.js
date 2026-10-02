// "So setzt du deine Ferientage clever ein": the optimizer's periods for one town,
// sortable by date or efficiency, plus the selected period's details. textContent only.
import { vacationDaysLabel } from "./calendar-model.js";
import { formatRange } from "./format.js";

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export const candidateKey = (c) => `${c.start}|${c.end}`;

/** "1 Ferientag → 4 Tage frei · 6.–9. Mai 2027" (SPEC §7) */
export function candidateTitle(c) {
  return `${vacationDaysLabel(c.vacation_days_required)} → ${c.days_free} Tage frei · ${formatRange(c.start, c.end)}`;
}

/** Efficiency first (ties: more free days, then earlier), or chronological. */
export function sortCandidates(list, mode) {
  const copy = [...list];
  if (mode === "efficiency") copy.sort((a, b) => b.efficiency - a.efficiency || b.days_free - a.days_free || a.start.localeCompare(b.start));
  else copy.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  return copy;
}

/** Split of the vacation days by calendar year (D8), only when it spans two years. */
export function yearSplit(c) {
  const parts = Object.entries(c.vacation_days_by_year ?? {});
  if (parts.length < 2) return "";
  return `Davon ${parts.map(([y, n]) => `${vacationDaysLabel(n)} im ${y}`).join(", ")}`;
}

function card(c, { selected, onSelect }) {
  const li = el("li", "candidate");
  const b = el("button", "candidate-btn");
  b.type = "button";
  b.setAttribute("aria-pressed", String(selected));
  b.append(el("span", "candidate-title", candidateTitle(c)));
  const meta = [c.anchor_holidays.join(", "), yearSplit(c)].filter(Boolean).join(" · ");
  if (meta) b.append(el("span", "candidate-meta", meta));
  b.addEventListener("click", () => onSelect(selected ? null : c));
  li.append(b);
  return li;
}

/**
 * Renders into `root`. `result` = per-location optimize result; `selectedKey`;
 * `sortMode` "date" | "efficiency"; `onSelect(candidate|null)`; `onSort(mode)`.
 */
export function renderCandidates(root, result, { year, selectedKey, sortMode, onSelect, onSort }) {
  if (!result) {
    root.replaceChildren(el("p", "hint", "Perioden werden berechnet …"));
    return;
  }
  const nodes = [];
  const selected = [...result.candidates, ...(result.summary?.best ? [result.summary.best] : [])]
    .find((c) => candidateKey(c) === selectedKey);
  if (selected) {
    const box = el("div", "selected-period");
    box.append(el("p", "selected-title", formatRange(selected.start, selected.end)));
    const facts = el("ul", "holiday-facts");
    facts.append(
      el("li", "", `${selected.days_free} Tage frei für ${vacationDaysLabel(selected.vacation_days_required)}`),
      el("li", "", `Ferientage: ${selected.vacation_dates.map((d) => `${Number(d.slice(8))}.${Number(d.slice(5, 7))}.`).join(", ")}`),
    );
    if (selected.anchor_holidays.length) facts.append(el("li", "", `Dank: ${selected.anchor_holidays.join(", ")}`));
    if (yearSplit(selected)) facts.append(el("li", "", yearSplit(selected)));
    const clear = el("button", "btn-secondary", "Auswahl aufheben");
    clear.type = "button";
    clear.addEventListener("click", () => onSelect(null));
    box.append(facts, clear);
    nodes.push(box);
  }

  const sortBar = el("div", "sort-bar");
  sortBar.setAttribute("role", "group");
  sortBar.setAttribute("aria-label", "Sortierung");
  sortBar.append(el("span", "field-label", "Sortieren:"));
  for (const [mode, label] of [["date", "Datum"], ["efficiency", "Effizienz"]]) {
    const b = el("button", "year-badge", label);
    b.type = "button";
    b.setAttribute("aria-pressed", String(sortMode === mode));
    b.addEventListener("click", () => onSort(mode));
    sortBar.append(b);
  }
  nodes.push(sortBar);

  if (!result.candidates.length) {
    nodes.push(el("p", "hint", result.summary?.budget != null
      ? `Mit ${vacationDaysLabel(result.summary.budget)} im ${year} gibt es keine passende Periode.`
      : `Für ${year} gibt es keine passende Periode (mehr).`));
  } else {
    const list = el("ul", "candidates");
    for (const c of sortCandidates(result.candidates, sortMode)) {
      list.append(card(c, { selected: candidateKey(c) === selectedKey, onSelect }));
    }
    nodes.push(list);
  }

  if (result.zero_cost?.length) {
    nodes.push(el("p", "field-label", "Ohne Ferientag"));
    const zero = el("ul", "zero-cost");
    for (const z of result.zero_cost) {
      zero.append(el("li", "", `${z.days_free} Tage frei · ${formatRange(z.start, z.end)}${z.anchor_holidays.length ? ` · ${z.anchor_holidays.join(", ")}` : ""}`));
    }
    nodes.push(zero);
  }
  root.replaceChildren(...nodes);
}
