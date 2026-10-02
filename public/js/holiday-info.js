// Curated background texts for public holidays (public/data/holiday-info.json).
// Lookup is pure and unit-tested; loading happens once, on the first click.

const DATA_URL = "/data/holiday-info.json";
let loading = null;

export function loadHolidayInfo(fetchImpl = globalThis.fetch) {
  loading ??= fetchImpl(DATA_URL)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((data) => {
      if (!data) loading = null;     // allow a retry on the next click
      return data;
    });
  return loading;
}

export function wikipediaUrl(title) {
  return `https://de.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(" ", "_"))}`;
}

export function wikipediaSearchUrl(name) {
  return `https://de.wikipedia.org/w/index.php?search=${encodeURIComponent(name)}`;
}

/** { text, url } for a holiday name (aliases resolved), or null if there's no entry. */
export function lookupHoliday(info, name) {
  if (!info?.holidays) return null;
  const key = info.holidays[name] ? name : info.aliases?.[name];
  const entry = key && info.holidays[key];
  return entry ? { text: entry.text, url: wikipediaUrl(entry.wiki) } : null;
}

export function jurisdictionLabel(holiday) {
  if (holiday.jurisdiction === "national") return "Gesamtschweizerischer Feiertag";
  if (holiday.jurisdiction === "municipality") return `Lokaler Feiertag (${holiday.municipality ?? "Gemeinde"})`;
  return `Kantonaler Feiertag (${holiday.canton})`;
}

export function effectLabel(day) {
  return day.holiday_on_non_working_day
    ? "Fällt auf einen arbeitsfreien Tag – du gewinnst dadurch keinen zusätzlichen freien Tag."
    : "Fällt auf einen deiner Arbeitstage – du hast frei, ohne einen Ferientag einzusetzen.";
}

/** How certain a holiday is, in plain German (provenance shown to the user). */
export function confidenceLabel(holiday) {
  if (holiday.confidence === "high") return "Bestätigt: Referenzkalender und Websuche stimmen überein.";
  if (holiday.confidence === "low") {
    return holiday.enabled === false
      ? "Nur in der Websuche gefunden – du kannst diesen Feiertag selbst aktivieren."
      : "Nur in der Websuche gefunden – von dir aktiviert.";
  }
  return "Quelle: kantonaler Referenzkalender (nicht durch die Websuche bestätigt).";
}
