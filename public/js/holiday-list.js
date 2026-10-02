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
  if (data.summary.disputed) parts.push(`${data.summary.disputed} umstritten`);
  if (data.summary.optional) parts.push(`${data.summary.optional} optionale lokale Feiertage`);
  return parts.join(" · ");
}

function switchRow(id, labelText, note, checked, onChange, sourceUrl) {
  const li = el("li", "optional-holiday");
  const box = document.createElement("input");
  box.type = "checkbox";
  box.id = id;
  box.checked = checked;
  box.addEventListener("change", onChange);
  const label = el("label", "", labelText);
  label.htmlFor = id;
  li.append(box, label, el("span", "optional-note", note ?? ""));
  if (sourceUrl) {
    const src = el("a", "optional-source", `Quelle: ${hostOf(sourceUrl)} ↗`);
    src.href = sourceUrl;
    src.target = "_blank";
    src.rel = "noopener noreferrer";
    li.append(src);
  }
  return li;
}

/**
 * Renders the section body into `root`. Optional holidays: `isEnabled(key)`, `onToggle(key)`;
 * disputed reference holidays: `isSwitchedOff(key)`, `onToggleDisputed(key)`.
 */
export function renderHolidaySection(root, data, {
  isEnabled, onToggle, isSwitchedOff = () => false, onToggleDisputed = () => {},
}) {
  const nodes = [el("p", "hint holiday-summary", holidaySummary(data))];
  if (data) {
    for (const w of data.warnings ?? []) {
      if (w.message !== nodes[0].textContent) nodes.push(el("p", "hint holiday-warning", `⚠ ${w.message}`));
    }
    const rowId = (prefix, key) => `${prefix}-${data.location_id}-${key}`.replace(/[^\w-]/g, "_");
    const disputed = (data.holidays ?? []).filter((h) => h.disputed);
    if (disputed.length) {
      const list = el("ul", "optional-holidays");
      for (const h of disputed) {
        list.append(switchRow(rowId("dis", h.key), `${formatDateWithWeekday(h.date)} – ${h.name}`, `⚠ ${h.conflict}`,
          !isSwitchedOff(h.key), () => onToggleDisputed(h.key), null));
      }
      nodes.push(el("p", "field-label", "Umstrittene Feiertage (gelten, bis du sie ausschaltest):"), list);
    }
    const optional = (data.holidays ?? []).filter((h) => h.enabled === false);
    if (optional.length) {
      const list = el("ul", "optional-holidays");
      for (const h of optional) {
        list.append(switchRow(rowId("opt", h.key), `${formatDateWithWeekday(h.date)} – ${h.name}`, h.note,
          isEnabled(h.key), () => onToggle(h.key), h.source_url));
      }
      nodes.push(el("p", "field-label", "Optionale Feiertage (zählen erst, wenn du sie aktivierst):"), list);
    }
  }
  root.replaceChildren(...nodes);
}
