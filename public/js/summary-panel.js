// Summary per town (owner request): holiday count and the best period; a list when
// several towns are selected. Clicking a town's best period selects it in its panel.
import { candidateTitle } from "./candidate-list.js";
import { locationLabel } from "./state.js";

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export function holidayCountLabel(summary) {
  const n = summary.holidays_total;
  const w = summary.holidays_on_working_days;
  return `${n} ${n === 1 ? "Feiertag" : "Feiertage"}, davon ${w} an Arbeitstagen`;
}

/** `rows` = [{ location, summary|null, error? }] */
export function renderSummary(root, { year, rows, onPick }) {
  const title = root.querySelector(".summary-title");
  if (title) title.textContent = `Wie viele Ferientage holst du ${year} raus?`;
  const list = el("ul", "summary-list");
  for (const { location, summary, error } of rows) {
    const li = el("li", "summary-row");
    li.append(el("p", "summary-town", `${locationLabel(location)} (${location.canton})`));
    if (error) {
      li.append(el("p", "hint", error));
    } else if (!summary) {
      li.append(el("p", "hint", "wird berechnet …"));
    } else {
      li.append(el("p", "summary-holidays", holidayCountLabel(summary)));
      if (summary.best) {
        const b = el("button", "candidate-btn summary-best");
        b.type = "button";
        b.append(el("span", "candidate-meta", "Beste Periode"), el("span", "candidate-title", candidateTitle(summary.best)));
        if (summary.best.anchor_holidays.length) b.append(el("span", "candidate-meta", summary.best.anchor_holidays.join(", ")));
        b.addEventListener("click", () => onPick(location, summary.best));
        li.append(b);
      } else {
        li.append(el("p", "hint", summary.budget != null ? "Keine Periode innerhalb deines Budgets." : "Keine passende Periode."));
      }
    }
    list.append(li);
  }
  root.querySelector(".summary-body").replaceChildren(list);
}
