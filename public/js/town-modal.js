// Town modal: result of the holiday check for one town and one list
// "Optionale Feiertage und halbe Tage" with switches (disputed/optional per town, custom
// days global) and "Datum hinzufügen". Provenance only in ⓘ tooltips. textContent only.
import { createDialog, el } from "./dialog.js";
import { holidaySummary } from "./holiday-list.js";
import { calendarWindow, locationLabel } from "./state.js";
import { townHolidayModel } from "./town-holidays.js";

let tipCounter = 0;

/** ⓘ button with a tooltip (hover, keyboard focus, tap = focus). */
function infoTip(text, label) {
  const wrap = el("span", "info");
  const id = `tip-${++tipCounter}`;
  const btn = el("button", "info-btn", "i");
  btn.type = "button";
  btn.setAttribute("aria-label", `Herkunft: ${label}`);
  btn.setAttribute("aria-describedby", id);
  const tip = el("span", "info-tip tip-left", text);
  tip.id = id;
  tip.setAttribute("role", "tooltip");
  wrap.append(btn, tip);
  return wrap;
}

const ADD_MESSAGES = {
  invalid: "Bitte gib ein gültiges Datum im angezeigten Zeitraum und einen Namen ein.",
  duplicate: "Dieses Datum ist bereits eingetragen.",
  invalid_range: "Das Enddatum («bis») liegt vor dem Startdatum («von»).",
  too_long: "Ein Zeitraum darf höchstens 31 Tage umfassen.",
};

export function createTownModal({ store, getHolidayData, onClose = () => {} }) {
  let locationId = null;
  const dialog = createDialog({ className: "town-modal", movable: true, onClose: (why) => {
    const id = locationId;
    locationId = null;
    onClose({ locationId: id, why });
  } });

  const summary = el("p", "hint holiday-summary");
  const warnings = el("div", "holiday-warnings");
  const optionalTitle = el("h3", "section-title", "Optionale Feiertage und halbe Tage");
  const optionalHint = el("p", "hint", "Gelten erst, wenn sie eingeschaltet sind. Eigene Daten gelten für alle Orte.");
  const switchList = el("ul", "holiday-rows switch-rows");

  // "Datum hinzufügen" (global custom day)
  const form = el("form", "custom-add");
  form.noValidate = true;
  const formTitle = el("h4", "field-label", "Datum oder Zeitraum hinzufügen");
  // "von" (required) and "bis" (optional: empty = a single day)
  const dateInput = document.createElement("input");
  dateInput.type = "date";
  dateInput.className = "text-input";
  dateInput.setAttribute("aria-label", "Datum, von");
  dateInput.title = "von";
  const endInput = document.createElement("input");
  endInput.type = "date";
  endInput.className = "text-input";
  endInput.setAttribute("aria-label", "bis (optional, für einen Zeitraum)");
  endInput.title = "bis (optional)";
  // picking "von" suggests the same month for "bis"
  dateInput.addEventListener("change", () => {
    if (dateInput.value) endInput.min = dateInput.value;
  });
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.maxLength = 60;
  nameInput.placeholder = "Name, z. B. Betriebsferien";
  nameInput.className = "text-input";
  nameInput.setAttribute("aria-label", "Name");
  const kindSelect = document.createElement("select");
  kindSelect.className = "text-input";
  kindSelect.setAttribute("aria-label", "Art");
  for (const [value, text] of [["full", "ganzer Feiertag"], ["half", "halber Tag"]]) {
    const o = el("option", "", text);
    o.value = value;
    kindSelect.append(o);
  }
  const recurringLabel = el("label", "check");
  const recurring = document.createElement("input");
  recurring.type = "checkbox";
  recurringLabel.append(recurring, " jährlich");
  const addBtn = el("button", "btn-secondary", "Hinzufügen");
  addBtn.type = "submit";
  const formHint = el("p", "hint field-error");
  formHint.setAttribute("role", "alert");
  formHint.hidden = true;
  const formRow = el("div", "custom-add-row");
  formRow.append(el("span", "range-label", "von"), dateInput, el("span", "range-label", "bis"), endInput);
  const formRowKind = el("div", "custom-add-row");
  formRowKind.append(kindSelect, recurringLabel);
  const formRow2 = el("div", "custom-add-row");
  formRow2.append(nameInput, addBtn);
  form.append(formTitle, formRow, formRowKind, formRow2,
    el("p", "hint", "«bis» leer lassen für einen einzelnen Tag."), formHint);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const result = store.addCustomDay({ date: dateInput.value, endDate: endInput.value, name: nameInput.value,
      kind: kindSelect.value, recurring: recurring.checked });
    formHint.textContent = ADD_MESSAGES[result] ?? "";
    formHint.hidden = result === "added";
    if (result === "added") {
      dateInput.value = "";
      endInput.value = "";
      endInput.removeAttribute("min");
      nameInput.value = "";
      recurring.checked = false;
    }
  });

  dialog.body.append(summary, warnings, optionalTitle, optionalHint, switchList, form);

  const done = el("button", "btn-primary", "Fertig");
  done.type = "button";
  done.addEventListener("click", () => dialog.close("done"));
  dialog.footer.append(done);
  dialog.footer.hidden = false;

  function row(item, { withSwitch }) {
    const li = el("li", "holiday-row");
    const label = el(withSwitch ? "label" : "span", "row-label", item.label);
    if (withSwitch) {
      const box = document.createElement("input");
      box.type = "checkbox";
      box.className = "switch";
      box.checked = item.active;
      box.id = `sw-${item.kind}-${item.key}`.replace(/[^\w-]/g, "_");
      label.htmlFor = box.id;
      box.addEventListener("change", () => {
        if (item.kind === "custom") store.toggleCustomDay(item.key);
        else store.toggleLocationHoliday(locationId, item.key);
      });
      li.append(box);
    }
    li.append(label);
    li.append(el("span", "row-tag", item.tag));
    li.append(infoTip(item.info, item.label));
    if (item.removable) {
      const rm = el("button", "chip-remove", "×");
      rm.type = "button";
      rm.setAttribute("aria-label", `${item.label} löschen`);
      rm.title = "Löschen";
      rm.addEventListener("click", () => store.removeCustomDay(item.key));
      li.append(rm);
    }
    return li;
  }

  function render() {
    const state = store.get();
    const loc = state.locations.find((l) => l.id === locationId);
    if (!loc) {
      if (dialog.isOpen()) dialog.close("removed");
      return;
    }
    const data = getHolidayData(loc.id, state.year);
    dialog.setTitle(`${locationLabel(loc)} (${loc.canton}) · ${state.year}`);
    summary.textContent = holidaySummary(data);
    warnings.replaceChildren(...(data?.warnings ?? [])
      .filter((w) => w.message !== summary.textContent)
      .map((w) => el("p", "hint holiday-warning", `⚠ ${w.message}`)));
    const model = townHolidayModel(data, state, (key) => store.isHolidayActive(loc.id, key));
    // keep focus on a switch across the re-render
    const focusedId = document.activeElement?.id;
    switchList.replaceChildren(...model.switches.map((s) => row(s, { withSwitch: true })));
    if (focusedId?.startsWith("sw-")) document.getElementById(focusedId)?.focus({ preventScroll: true });
    const { start, end } = calendarWindow(state.year);
    dateInput.min = start;
    dateInput.max = end;
    endInput.max = end;
  }

  store.subscribe(() => {
    if (dialog.isOpen()) render();
  });

  return {
    open(id, { from = null } = {}) {
      locationId = id;
      formHint.hidden = true;
      render();
      dialog.open(from);
    },
    refresh() {
      if (dialog.isOpen()) render();
    },
    close: () => dialog.close("close"),
    closeFor(id) {
      if (dialog.isOpen() && locationId === id) dialog.close("removed");
    },
    current: () => (dialog.isOpen() ? locationId : null),
  };
}
