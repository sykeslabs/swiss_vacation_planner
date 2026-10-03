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

/** Title bar of a town panel: "9 Feiertage · 15 Ferientage → 44 Tage frei" (the plan part
 * only when there is a recommended plan). */
export function townHeadline(summary) {
  if (!summary) return "";
  const parts = [holidayCountText(summary.holidays_total)];
  const plan = planHeadline(summary);
  if (plan) parts.push(plan);
  return parts.join(" · ");
}

/** "15 Ferientage → 44 Tage frei", or "" without a plan. */
export function planHeadline(summary) {
  return summary?.plan?.length
    ? `${vacationDaysLabel(summary.plan_vacation_days)} → ${summary.plan_days_free} Tage frei` : "";
}

/** "1 Feiertag", "9 Feiertage" */
export function holidayCountText(n) {
  return `${n} ${n === 1 ? "Feiertag" : "Feiertage"}`;
}

/** True if the period has at least one day in month "YYYY-MM" (also when it starts in the
 * month before or ends in the month after). */
export function overlapsMonth(period, month) {
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const last = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  return period.start <= last && period.end >= first;
}

/** The recommended periods of a town, chronological, for the list below the calendar.
 * `selectedKey` marks the period that is also highlighted in the calendar; with `month`
 * ("YYYY-MM", the open month detail) only periods touching that month are listed. */
export function periodListItems(summary, selectedKey = null, month = null) {
  return [...(summary?.plan ?? [])]
    .filter((c) => !month || overlapsMonth(c, month))
    .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end))
    .map((c) => ({ key: periodKey(c), title: candidateTitle(c), split: yearSplit(c), selected: periodKey(c) === selectedKey }));
}
