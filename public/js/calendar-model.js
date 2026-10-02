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
