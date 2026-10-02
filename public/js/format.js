// German (Swiss Standard German) date formatting. Dates are ISO strings "YYYY-MM-DD";
// parsing never goes through local time zones.

export const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli",
  "August", "September", "Oktober", "November", "Dezember"];
export const WEEKDAYS_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export function parseIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return { year: y, month: mo, day: d, time: t };
}

export function toIso(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 0 = Monday … 6 = Sunday */
export function weekdayIndex(iso) {
  const p = parseIso(iso);
  return (new Date(p.time).getUTCDay() + 6) % 7;
}

export function monthTitle(year, month) {
  return `${MONTHS[month - 1]} ${year}`;
}

/** "24. Dezember 2027" */
export function formatDate(iso) {
  const p = parseIso(iso);
  return `${p.day}. ${MONTHS[p.month - 1]} ${p.year}`;
}

/** "Fr, 24. Dezember 2027" */
export function formatDateWithWeekday(iso) {
  return `${WEEKDAYS_SHORT[weekdayIndex(iso)]}, ${formatDate(iso)}`;
}

/** "6.–9. Mai 2027", "30. April – 3. Mai 2027", "28. Dezember 2026 – 3. Januar 2027" */
export function formatRange(startIso, endIso) {
  const a = parseIso(startIso);
  const b = parseIso(endIso);
  if (startIso === endIso) return formatDate(startIso);
  if (a.year === b.year && a.month === b.month) return `${a.day}.–${b.day}. ${MONTHS[b.month - 1]} ${b.year}`;
  if (a.year === b.year) return `${a.day}. ${MONTHS[a.month - 1]} – ${b.day}. ${MONTHS[b.month - 1]} ${b.year}`;
  return `${formatDate(startIso)} – ${formatDate(endIso)}`;
}
