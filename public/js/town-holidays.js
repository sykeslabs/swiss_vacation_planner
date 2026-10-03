// View model of the town modal's holiday list (pure, unit-tested). Public holidays that
// count are not listed (they are visible in the calendar).
// "Optionale Feiertage und halbe Tage": one list with on/off switches for disputed and
//   optional holidays of THIS town plus the global custom days (24.12., 31.12., own dates).
// Provenance and conflicts are not shown inline, only as ⓘ tooltip text built from the data.
import { formatDateWithWeekday, MONTHS, toIso } from "./format.js";

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const WEB_SOURCE = "Websuche (You.com)";
/** Curated local customary day (Sechseläuten …), not a web-only find. */
export const isCuratedLocal = (h) => h.type === "local" && h.source !== WEB_SOURCE && h.source_title !== "von dir aktiviert";

/** Tooltip text (provenance, conflicts) for a holiday from GET /api/holidays. */
export function holidayInfoText(h) {
  const parts = [];
  if (h.disputed) {
    parts.push("Laut kantonalem Referenzkalender ein Feiertag, die Websuche widerspricht.");
    if (h.conflict) parts.push(h.conflict);
    parts.push("Zählt erst, wenn du ihn einschaltest.");
  } else if (h.enabled === false && isCuratedLocal(h)) {
    parts.push("Lokaler Brauch, kein gesetzlicher Feiertag.");
    if (h.note) parts.push(h.note);
    parts.push("Zählt erst, wenn du ihn einschaltest.");
  } else if (h.enabled === false) {
    parts.push("Nur in der Websuche gefunden, nicht im kantonalen Referenzkalender.");
    if (h.note) parts.push(h.note);
    parts.push("Zählt erst, wenn du ihn einschaltest.");
  } else if (h.confidence === "high") {
    parts.push("Bestätigt: Referenzkalender und Websuche stimmen überein.");
  } else {
    parts.push("Quelle: kantonaler Referenzkalender (nicht durch die Websuche bestätigt).");
  }
  if (h.work_fraction > 0) parts.push("Halber Tag: am Vormittag wird gearbeitet.");
  const hosts = [...new Set([...(h.corroborated_by ?? []), ...(h.enabled === false && h.source_url && !isCuratedLocal(h) ? [h.source_url] : [])]
    .map(hostOf).filter(Boolean))];
  if (hosts.length) parts.push(`Websuche: ${hosts.join(", ")}`);
  return parts.join(" ");
}

function customLabel(d, year) {
  if (d.recurring) return `${d.day}. ${MONTHS[d.month - 1]} – ${d.name}`;
  return `${formatDateWithWeekday(d.date)} – ${d.name}`;
}

function customInfo(d) {
  const kind = d.kind === "half" ? "Halber Tag: du arbeitest nur einen halben Tag." : "Ganzer freier Tag.";
  const when = d.recurring ? "Jedes Jahr am selben Datum." : "Nur an diesem Datum.";
  const who = d.builtin ? "Voreinstellung, gilt für alle Orte." : "Von dir hinzugefügt, gilt für alle Orte.";
  return `${kind} ${when} ${who}`;
}

/**
 * `data` = GET /api/holidays response for this town and year (or null while loading),
 * `state` = PlannerState, `isActive(key)` = per-location switch.
 * Returns { switches: [...] } sorted by date.
 */
export function townHolidayModel(data, state, isActive) {
  const holidays = data?.holidays ?? [];
  const switches = [
    ...holidays.filter((h) => h.disputed || h.enabled === false).map((h) => ({
      kind: h.disputed ? "disputed" : "optional", key: h.key, sort: h.date,
      label: `${formatDateWithWeekday(h.date)} – ${h.name}`,
      tag: [h.disputed ? "umstritten" : "lokal", h.work_fraction > 0 ? "halber Tag" : null].filter(Boolean).join(" · "),
      active: isActive(h.key), info: holidayInfoText(h), removable: false,
    })),
    ...(state.customDays ?? []).map((d) => ({
      kind: "custom", key: d.id, sort: d.recurring ? toIso(state.year, d.month, d.day) : d.date,
      label: customLabel(d, state.year),
      tag: [d.kind === "half" ? "halber Tag" : "ganzer Feiertag", d.recurring ? "jährlich" : null].filter(Boolean).join(" · "),
      active: d.active, info: customInfo(d), removable: !d.builtin,
    })),
  ].sort((a, b) => a.sort.localeCompare(b.sort) || a.label.localeCompare(b.label));
  return { switches };
}
