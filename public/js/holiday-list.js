// Summary line of the web holiday check (GET /api/holidays), shown in the town modal.

/** Short German summary line for the panel. */
export function holidaySummary(data) {
  if (!data) return "Feiertage werden geprüft …";
  if (!data.summary?.checked) return data.warnings?.[0]?.message ?? "Es gilt der kantonale Referenzkalender.";
  const parts = [`${data.summary.confirmed} Feiertage durch die Websuche bestätigt`];
  if (data.summary.disputed) parts.push(`${data.summary.disputed} umstritten`);
  if (data.summary.optional) parts.push(`${data.summary.optional} optionale lokale Feiertage`);
  return parts.join(" · ");
}
