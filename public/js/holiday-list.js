// "Feiertage" section of a town panel: result of the web check (GET /api/holidays),
// optional holidays with an on/off switch, conflicts. All text via textContent.
import { formatDateWithWeekday } from "./format.js";

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Short German summary line for the panel. */
export function holidaySummary(data) {
  if (!data) return "Feiertage werden geprüft …";
  if (!data.summary?.checked) return data.warnings?.[0]?.message ?? "Es gilt der kantonale Referenzkalender.";
  const parts = [`${data.summary.confirmed} Feiertage durch die Websuche bestätigt`];
  if (data.summary.optional) parts.push(`${data.summary.optional} optionale lokale Feiertage`);
  return parts.join(" · ");
}

/** Renders the section body into `root`. `isEnabled(key)`, `onToggle(key)`. */
export function renderHolidaySection(root, data, { isEnabled, onToggle }) {
  const nodes = [el("p", "hint holiday-summary", holidaySummary(data))];
  if (data) {
    for (const w of data.warnings ?? []) {
      if (w.message !== nodes[0].textContent) nodes.push(el("p", "hint holiday-warning", `⚠ ${w.message}`));
    }
    const optional = (data.holidays ?? []).filter((h) => h.enabled === false);
    if (optional.length) {
      const list = el("ul", "optional-holidays");
      for (const h of optional) {
        const li = el("li", "optional-holiday");
        const id = `opt-${data.location_id}-${h.key}`.replace(/[^\w-]/g, "_");
        const box = document.createElement("input");
        box.type = "checkbox";
        box.id = id;
        box.checked = isEnabled(h.key);
        box.addEventListener("change", () => onToggle(h.key));
        const label = el("label", "", `${formatDateWithWeekday(h.date)} – ${h.name}`);
        label.htmlFor = id;
        const note = el("span", "optional-note", h.note ?? "");
        const src = el("a", "optional-source", `Quelle: ${hostOf(h.source_url)} ↗`);
        src.href = h.source_url;
        src.target = "_blank";
        src.rel = "noopener noreferrer";
        li.append(box, label, note, src);
        list.append(li);
      }
      nodes.push(el("p", "field-label", "Optionale Feiertage (zählen erst, wenn du sie aktivierst):"), list);
    }
    const conflicts = (data.holidays ?? []).filter((h) => h.enabled !== false && h.conflict);
    for (const h of conflicts) nodes.push(el("p", "hint holiday-warning", `⚠ ${h.name}: ${h.conflict}`));
  }
  root.replaceChildren(...nodes);
}
