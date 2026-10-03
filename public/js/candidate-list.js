// Text helpers for the optimizer's periods (the full list is not shown: the calendar
// colours the recommended plan, details open in the period panel).
import { periodKey, vacationDaysLabel } from "./calendar-model.js";
import { formatRange } from "./format.js";

export const candidateKey = periodKey;

/** "1 Ferientag → 4 Tage frei · 6.–9. Mai 2027" (SPEC §7) */
export function candidateTitle(c) {
  return `${vacationDaysLabel(c.vacation_days_required)} → ${c.days_free} Tage frei · ${formatRange(c.start, c.end)}`;
}

/** Split of the vacation days by calendar year (D8), only when it spans two years. */
export function yearSplit(c) {
  const parts = Object.entries(c.vacation_days_by_year ?? {});
  if (parts.length < 2) return "";
  return `Davon ${parts.map(([y, n]) => `${vacationDaysLabel(n)} im ${y}`).join(", ")}`;
}

/** One line about the recommended plan of a town. */
export function planSummary(summary) {
  const plan = summary?.plan ?? [];
  if (!plan.length) {
    return summary?.budget != null
      ? `Keine passende Periode innerhalb deines Budgets (${vacationDaysLabel(summary.budget)}).`
      : "Keine Empfehlung für dieses Jahr.";
  }
  const periods = plan.length === 1 ? "1 Periode" : `${plan.length} Perioden`;
  const left = summary.budget_left > 0 ? ` · ${vacationDaysLabel(summary.budget_left)} frei verteilbar` : "";
  return `Empfehlung: ${periods} · ${vacationDaysLabel(summary.plan_vacation_days)} → ${summary.plan_days_free} Tage frei${left}`;
}

/** "1 Feiertag", "9 Feiertage" */
export function holidayCountText(n) {
  return `${n} ${n === 1 ? "Feiertag" : "Feiertage"}`;
}

/** The recommended periods of a town, chronological, for the list below the calendar.
 * `selectedKey` marks the period that is also highlighted in the calendar. */
export function periodListItems(summary, selectedKey = null) {
  return [...(summary?.plan ?? [])]
    .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end))
    .map((c) => ({ key: periodKey(c), title: candidateTitle(c), split: yearSplit(c), selected: periodKey(c) === selectedKey }));
}
