// The single place where a day's display category is derived from its DayInfo
// attributes (SPEC §4). CSS only styles these categories. Pure; unit-tested.

export const CATEGORIES = [
  { key: "workday", label: "Arbeitstag" },
  { key: "half_day", label: "Halber Arbeitstag" },
  { key: "weekend", label: "Wochenende / arbeitsfrei" },
  { key: "holiday", label: "Feiertag" },
  { key: "holiday_off", label: "Feiertag an freiem Tag" },
  { key: "vacation", label: "Ferientag" },
  { key: "free_run", label: "Frei am Stück" },
];

export function dayCategory(day) {
  if (day.is_vacation) return "vacation";
  if (day.is_holiday && day.work_fraction === 0) {
    return day.holiday_on_non_working_day ? "holiday_off" : "holiday";
  }
  if (!day.is_working_day) return day.in_selected_period ? "free_run" : "weekend";
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

/**
 * Days with a selected period applied: days of the free run get in_selected_period,
 * the candidate's vacation days become is_vacation. Returns new objects (pure).
 */
export function applySelection(days, candidate) {
  if (!candidate) return days;
  const vacation = new Set(candidate.vacation_dates);
  return days.map((d) => (d.date >= candidate.start && d.date <= candidate.end
    ? { ...d, in_selected_period: true, is_vacation: vacation.has(d.date), is_free: true }
    : d));
}

/** "½", "1", "4½" */
export function formatDays(n) {
  const whole = Math.floor(n);
  const half = n - whole >= 0.5;
  return half ? `${whole || ""}½` : String(whole);
}

/** "1 Ferientag", "½ Ferientag", "4½ Ferientage" */
export function vacationDaysLabel(n) {
  return `${formatDays(n)} ${n > 1 ? "Ferientage" : "Ferientag"}`;
}
