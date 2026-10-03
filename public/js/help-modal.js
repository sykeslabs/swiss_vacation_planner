// "Über Adam" (help): static explanation, contact and donation. No API call: the contact
// and donation details were injected into the page by the server (environment variables).
import { aboutLinks } from "./about-view.js";
import { createDialog, el } from "./dialog.js";

const STEPS = [
  "Wähle das Jahr, das du planen möchtest.",
  "Suche deinen Arbeitsort (oder klicke ihn auf der Karte an) und prüfe seine Feiertage.",
  "Gib deine Arbeitstage und deine Anzahl Ferientage an.",
  "Adam färbt die empfohlenen Ferientage türkis. Klicke auf eine Periode in der Liste oder im Monat für Details.",
];

const SOURCES = [
  "Karte und Orte: swisstopo (GeoAdmin)",
  "Feiertage: kantonaler Referenzkalender, abgeglichen mit einer Websuche (You.com)",
  "Wetter: historische Messwerte von MeteoSwiss (bald verfügbar)",
  "Ferienideen: KI-generierte Vorschläge über OpenRouter (bald verfügbar)",
];

function link(node, { href, text }, newTab) {
  const a = el("a", node, text);
  a.href = href;
  if (newTab) {
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  }
  return a;
}

export function createHelpModal({ config = {}, onOpenTodos = null } = {}) {
  const dialog = createDialog({ title: "Über Adam", className: "help-modal", movable: true });
  const links = aboutLinks(config);

  const steps = el("ol", "help-steps");
  steps.append(...STEPS.map((s) => el("li", "", s)));
  const sources = el("ul", "help-list");
  sources.append(...SOURCES.map((s) => el("li", "", s)));

  const nodes = [
    el("h3", "help-heading", "Was ist Adam?"),
    el("p", "", "Adam zeigt dir, wie du mit möglichst wenigen Ferientagen möglichst viele freie Tage am Stück "
      + "bekommst. Er verbindet die Feiertage deines Arbeitsorts mit deinen Arbeitstagen und berechnet, wo sich "
      + "ein Ferientag am meisten lohnt. Die Berechnung ist fest programmiert, ohne KI."),
    steps,
    el("h3", "help-heading", "Datenquellen"),
    sources,
    el("p", "hint", "Feiertage können je nach Gemeinde, Kanton und Arbeitgeber abweichen. Prüfe sie im Fenster "
      + "deines Orts: umstrittene und lokale Feiertage zählen erst, wenn du sie einschaltest."),
    el("p", "hint", "Wetterangaben sind historische Durchschnittswerte, keine Prognose. Ferienideen sind "
      + "KI-Vorschläge, keine bestätigten Preise oder Verfügbarkeiten."),
  ];
  if (onOpenTodos) {
    // "Was ist geplant?" opens the to-do list (static, see todos.js)
    const todo = el("button", "btn-link help-todo", "Was ist geplant? (To-dos)");
    todo.type = "button";
    todo.setAttribute("aria-haspopup", "dialog");
    todo.addEventListener("click", () => onOpenTodos(todo));
    nodes.push(el("h3", "help-heading", "Weiterentwicklung"), todo);
  }

  if (links.contact || links.website) {
    const contact = el("p", "help-contact");
    if (links.contact) contact.append(link("", links.contact, false));
    if (links.contact && links.website) contact.append(" · ");
    if (links.website) contact.append(link("", links.website, true));
    nodes.push(el("h3", "help-heading", "Kontakt"), contact);
  }
  if (links.donate) {
    nodes.push(
      el("h3", "help-heading", "Unterstützen"),
      el("p", "", "Adam ist kostenlos. Wenn er dir hilft, freue ich mich über eine Spende."),
      link("btn-primary help-donate", links.donate, true),
    );
  }
  dialog.body.append(...nodes);

  return { open: (from) => dialog.open(from), close: () => dialog.close(), isOpen: dialog.isOpen };
}
