// The single place where a day's display category is derived from its DayInfo
// attributes (SPEC §4). CSS only styles these categories. Pure; unit-tested.

export const CATEGORIES = [
  { key: "workday", label: "Arbeitstag" },
  { key: "half_day", label: "Halber Arbeitstag" },
  { key: "weekend", label: "Wochenende / arbeitsfrei" },
  { key: "holiday", label: "Feiertag" },
  { key: "vacation", label: "Ferientag" },
  { key: "free_run", label: "Frei am Stück" },
];

export function dayCategory(day) {
  if (day.is_vacation) return "vacation";
  // A holiday is red also on a weekend / day off (owner request); the holiday details
  // still say that it brings no extra day off.
  if (day.is_holiday && (day.work_fraction === 0 || !day.is_working_day)) return "holiday";
  if (!day.is_working_day) return day.in_selected_period || day.plan_key ? "free_run" : "weekend";
  if (day.work_fraction > 0 && day.work_fraction < 1) return "half_day";
  return "workday";
}

export function categoryLabel(key) {
  return CATEGORIES.find((c) => c.key === key)?.label ?? key;
}

/** Days (in date order) → [{ year, month, days }] */
export function groupByMonth(days) {
  const months = [];
  for (const day of days) {
    const year = Number(day.date.slice(0, 4));
    const month = Number(day.date.slice(5, 7));
    const last = months.at(-1);
    if (last && last.year === year && last.month === month) last.days.push(day);
    else months.push({ year, month, days: [day] });
  }
  return months;
}

export const periodKey = (c) => `${c.start}|${c.end}`;

/**
 * Days with the recommended plan applied (pure, returns new objects):
 * - every day of a recommended period gets `plan_key` (its period), its vacation days
 *   become is_vacation (turquoise "Ferientag"), its free days "Frei am Stück";
 * - the days of the selected period (`selectedKey`) also get in_selected_period (ring).
 */
export function applyPlan(days, plan = [], selectedKey = null) {
  if (!plan.length) return days;
  const byDate = new Map();
  for (const c of plan) {
    const vacation = new Set(c.vacation_dates);
    for (const d of days) {
      if (d.date >= c.start && d.date <= c.end) byDate.set(d.date, { key: periodKey(c), vacation: vacation.has(d.date) });
    }
  }
  return days.map((d) => {
    const hit = byDate.get(d.date);
    if (!hit) return d;
    return { ...d, plan_key: hit.key, is_vacation: hit.vacation, is_free: true,
      in_selected_period: hit.key === selectedKey };
  });
}

/** "½", "1", "4½" */
export function formatDays(n) {
  const whole = Math.floor(n);
  const half = n - whole >= 0.5;
  return half ? `${whole || ""}½` : String(whole);
}

/** "1 Ferientag", "½ Ferientag", "0 Ferientage", "4½ Ferientage" */
export function vacationDaysLabel(n) {
  return `${formatDays(n)} ${n > 0 && n <= 1 ? "Ferientag" : "Ferientage"}`;
}

/** The public holidays of the planned year (the days counted as "N Feiertage"), with
 * their names and whether they are half days or fall on a day off. */
export function holidayDays(days) {
  return (days ?? [])
    .filter((d) => d.in_planned_year && d.is_holiday)
    .map((d) => ({
      date: d.date,
      names: d.holiday_names.join(", "),
      half: d.work_fraction > 0 && d.work_fraction < 1,
      offDay: Boolean(d.holiday_on_non_working_day),
    }));
}
