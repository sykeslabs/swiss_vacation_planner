// Planner state (SPEC §4 PlannerState): onboarding step, year, working days, vacation
// budget, vacation type, locations, global custom days and per-location holiday switches.
// Pure module (no DOM); persistence goes through an injected storage. Unit-tested.
import { parseIso, toIso } from "./format.js";

export const WEEKDAY_CODES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
export const DEFAULT_WORKING_DAYS = ["MON", "TUE", "WED", "THU", "FRI"];
export const MAX_LOCATIONS = 10;
export const DEFAULT_BUDGET = 25;           // prefilled in step 3 (owner request), still required
export const STORAGE_KEY = "svp.planner.v2";      // v2: wizard + custom_days (v1 states are not migrated)
const STORAGE_VERSION = 2;
const LOCATION_FIELDS = ["id", "name", "municipality", "municipality_id", "canton", "latitude", "longitude"];
const KEY_RE = /^\d{4}-\d{2}-\d{2}\|.{1,100}$/;

/** Onboarding steps: 1 Jahr → 2 Arbeitsort → 3 Präferenzen → "done". */
export const STEPS = [1, 2, 3];
export const DONE = "done";

/** Vacation types (SPEC §4). Stored for travel discovery only — never sent to the optimizer. */
export const VACATION_TYPES = [
  { key: "no_preference", label: "Egal" },
  { key: "beach", label: "Strand" },
  { key: "city", label: "Städtereise" },
  { key: "hiking", label: "Wandern" },
  { key: "skiing", label: "Ski" },
  { key: "wellness", label: "Wellness" },
  { key: "nature", label: "Natur" },
  { key: "family", label: "Familie" },
  { key: "road_trip", label: "Roadtrip" },
];

/** D6: the only default entries that start active — recurring half days 24.12. and 31.12. */
export const DEFAULT_CUSTOM_DAYS = [
  { id: "builtin-12-24", name: "Heiligabend", kind: "half", recurring: true, month: 12, day: 24, active: true, builtin: true },
  { id: "builtin-12-31", name: "Silvester", kind: "half", recurring: true, month: 12, day: 31, active: true, builtin: true },
];

/** D9: current year … current year + 2 */
export function selectableYears(today = new Date()) {
  const y = today.getFullYear();
  return [y, y + 1, y + 2];
}

/** Planned year plus December before and January after (matches the server). */
export function calendarWindow(year) {
  return { start: toIso(year - 1, 12, 1), end: toIso(year + 1, 1, 31) };
}

/** Same town = same municipality and same place name ("Baden" and "5400 Baden"); different
 * villages of one municipality ("3823 Wengen", "Lauterbrunnen") stay separate. */
export function townKey(loc) {
  return `${loc.municipality_id}|${String(loc.name).toLocaleLowerCase("de-CH")}`;
}

/** "YYYY-MM" of the first month to show: the current month when planning the current
 * year (past months are hidden), otherwise null (show the whole window). */
export function firstVisibleMonth(year, today = new Date()) {
  if (year !== today.getFullYear()) return null;
  return `${year}-${String(today.getMonth() + 1).padStart(2, "0")}`;
}

function isValidLocation(loc) {
  return loc && typeof loc === "object" && LOCATION_FIELDS.every((f) => loc[f] !== undefined && loc[f] !== null)
    && typeof loc.id === "string" && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude);
}

// --- custom days (global: half days, user-added dates) -------------------------------------

function validMonthDay(month, day) {
  return Number.isInteger(month) && Number.isInteger(day) && parseIso(toIso(2028, month, day)) !== null;  // 2028: leap year
}

/** Validates one custom day; returns a clean copy or null. */
export function cleanCustomDay(d) {
  if (!d || typeof d !== "object" || typeof d.id !== "string") return null;
  const kind = d.kind === "full" ? "full" : d.kind === "half" ? "half" : null;
  const name = typeof d.name === "string" ? d.name.trim().slice(0, 60) : "";
  if (!kind || !name) return null;
  const base = { id: d.id, name, kind, active: d.active !== false, builtin: d.builtin === true };
  if (d.recurring) {
    return validMonthDay(d.month, d.day) ? { ...base, recurring: true, month: d.month, day: d.day } : null;
  }
  return parseIso(d.date) ? { ...base, recurring: false, date: d.date } : null;
}

/** Concrete dates of the active custom days for the calendar window of `year`:
 * recurring rules in every year of the window (Dec of year-1 … Jan of year+1),
 * one-off dates only if they fall into the window. */
export function expandCustomDays(customDays, year) {
  const { start, end } = calendarWindow(year);
  const halfDays = {};
  const holidays = [];
  for (const d of customDays ?? []) {
    if (!d.active) continue;
    const dates = d.recurring
      ? [year - 1, year, year + 1].map((y) => toIso(y, d.month, d.day)).filter((iso) => parseIso(iso))
      : [d.date];
    for (const iso of dates) {
      if (iso < start || iso > end) continue;
      if (d.kind === "half") halfDays[iso] = 0.5;
      else holidays.push({ date: iso, name: d.name });
    }
  }
  holidays.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  return { halfDays, holidays };
}

// --- defaults, validation, persistence ------------------------------------------------------

export function defaultState(today = new Date()) {
  return {
    onboarding: 1,
    year: selectableYears(today)[0],
    workingDays: [...DEFAULT_WORKING_DAYS],
    budget: DEFAULT_BUDGET,             // required; prefilled with 25
    vacationType: "no_preference",
    locations: [],
    customDays: DEFAULT_CUSTOM_DAYS.map((d) => ({ ...d })),
    activeHolidays: {},                 // { location_id: ["YYYY-MM-DD|Name"] } disputed/optional switched on
  };
}

/** Validation of step 3 / the ⚙ preferences. Returns { workingDays?, budget? } messages. */
export function validatePreferences({ workingDays, budget }) {
  const errors = {};
  if (!Array.isArray(workingDays) || !workingDays.length) errors.workingDays = "Bitte wähle mindestens einen Arbeitstag.";
  if (typeof budget !== "number" || !Number.isFinite(budget) || budget < 0 || budget > 366 || budget * 2 !== Math.round(budget * 2)) {
    errors.budget = "Bitte gib deine Anzahl Ferientage ein (ganze oder halbe Tage, 0–366).";
  }
  return errors;
}

/** Parses the "Anzahl Ferientage" field: "25", "24.5", "24,5" → number; invalid → NaN. */
export function parseBudget(text) {
  const s = String(text ?? "").trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return Number.NaN;
  return Number(s);
}

/** The calendar and optimizer run only after onboarding (and with valid inputs). */
export function canOptimize(state) {
  return state.onboarding === DONE && state.locations.length > 0
    && Object.keys(validatePreferences(state)).length === 0;
}

export function restoreState(raw, today = new Date()) {
  const base = defaultState(today);
  let data;
  try {
    data = typeof raw === "string" ? JSON.parse(raw) : null;
  } catch {
    return base;
  }
  if (!data || data.v !== STORAGE_VERSION) return base;

  const year = selectableYears(today).includes(data.year) ? data.year : base.year;
  const workingDays = Array.isArray(data.workingDays) ? WEEKDAY_CODES.filter((c) => data.workingDays.includes(c)) : [];
  const seen = new Set();
  const locations = (Array.isArray(data.locations) ? data.locations : [])
    .filter((l) => isValidLocation(l) && !seen.has(townKey(l)) && seen.add(townKey(l)))
    .slice(0, MAX_LOCATIONS);
  const ids = new Set();
  const customDays = (Array.isArray(data.customDays) ? data.customDays : base.customDays)
    .map(cleanCustomDay).filter((d) => d && !ids.has(d.id) && ids.add(d.id));
  const activeHolidays = {};
  if (data.activeHolidays && typeof data.activeHolidays === "object") {
    for (const loc of locations) {
      const keys = data.activeHolidays[loc.id];
      if (Array.isArray(keys)) {
        const valid = keys.filter((k) => typeof k === "string" && KEY_RE.test(k));
        if (valid.length) activeHolidays[loc.id] = [...new Set(valid)].sort();
      }
    }
  }
  const budget = typeof data.budget === "number" && data.budget >= 0 && data.budget <= 366
    ? Math.round(data.budget * 2) / 2 : base.budget;
  const restored = {
    onboarding: [1, 2, 3, DONE].includes(data.onboarding) ? data.onboarding : 1,
    year,
    workingDays: workingDays.length ? workingDays : base.workingDays,
    budget,
    vacationType: VACATION_TYPES.some((t) => t.key === data.vacationType) ? data.vacationType : base.vacationType,
    locations,
    customDays,
    activeHolidays,
  };
  // Never resume past a step whose requirements are missing.
  if (restored.onboarding === DONE && !canOptimize(restored)) restored.onboarding = locations.length ? 3 : 2;
  if (restored.onboarding === 3 && !locations.length) restored.onboarding = 2;
  return restored;
}

export function serializeState(state) {
  return JSON.stringify({ v: STORAGE_VERSION, ...state });
}

let customIdCounter = 0;
const newCustomId = () => `custom-${Date.now().toString(36)}-${(customIdCounter++).toString(36)}`;

/**
 * `storage` is a localStorage-like object or null. Storage failures (private mode,
 * quota) never break the planner; state then simply isn't remembered.
 */
export function createPlannerStore({ storage = null, today = new Date() } = {}) {
  let state = defaultState(today);
  try {
    if (storage) state = restoreState(storage.getItem(STORAGE_KEY), today);
  } catch {
    // unreadable storage: keep defaults
  }
  const listeners = new Set();

  function commit(next, change) {
    state = next;
    try {
      storage?.setItem(STORAGE_KEY, serializeState(state));
    } catch {
      // ignore: persistence is a convenience
    }
    listeners.forEach((fn) => fn(state, change));
  }

  return {
    get: () => state,
    has: (id) => state.locations.some((l) => l.id === id),
    findSameTown: (location) => state.locations.find((l) => townKey(l) === townKey(location)) ?? null,

    // --- onboarding -------------------------------------------------------------------------
    /** Next step if its requirements are met; returns the new step or an error object. */
    wizardNext() {
      const step = state.onboarding;
      if (step === 1) {
        if (!selectableYears(today).includes(state.year)) return { error: "year" };
        commit({ ...state, onboarding: 2 }, { type: "onboarding" });
      } else if (step === 2) {
        if (!state.locations.length) return { error: "location" };
        commit({ ...state, onboarding: 3 }, { type: "onboarding" });
      } else if (step === 3) {
        const errors = validatePreferences(state);
        if (Object.keys(errors).length) return { error: "preferences", errors };
        commit({ ...state, onboarding: DONE }, { type: "onboarding" });
      }
      return { step: state.onboarding };
    },
    wizardBack() {
      if (state.onboarding === 2 || state.onboarding === 3) {
        commit({ ...state, onboarding: state.onboarding - 1 }, { type: "onboarding" });
      }
      return state.onboarding;
    },
    /** Step 2: the work location (replaces an earlier choice during onboarding). */
    setWorkLocation(location) {
      if (state.onboarding !== 2) return false;
      commit({ ...state, locations: [location], activeHolidays: {} }, { type: "add", location });
      return true;
    },
    /** Clears everything and returns to step 1. */
    reset() {
      commit(defaultState(today), { type: "reset" });
    },

    // --- locations (after onboarding: "+" and map click) ----------------------------------------
    /** Returns "added", "duplicate" (same town already selected) or "full". */
    addLocation(location) {
      if (state.locations.some((l) => townKey(l) === townKey(location))) return "duplicate";
      if (state.locations.length >= MAX_LOCATIONS) return "full";
      commit({ ...state, locations: [...state.locations, location] }, { type: "add", location });
      return "added";
    },
    removeLocation(id) {
      const location = state.locations.find((l) => l.id === id);
      if (!location) return false;
      const { [id]: _, ...activeHolidays } = state.activeHolidays;
      commit({ ...state, locations: state.locations.filter((l) => l.id !== id), activeHolidays },
        { type: "remove", location });
      return true;
    },

    // --- preferences -----------------------------------------------------------------------
    setYear(year) {
      if (year === state.year || !selectableYears(today).includes(year)) return false;
      // Recurring custom days follow automatically; one-off dates keep their exact date.
      commit({ ...state, year }, { type: "config", year: true });
      return true;
    },
    /** During onboarding the last day may be removed (validation reports it on "Weiter");
     * afterwards at least one working day always stays selected. */
    toggleWorkingDay(code) {
      if (!WEEKDAY_CODES.includes(code)) return false;
      const on = state.workingDays.includes(code);
      if (on && state.workingDays.length === 1 && state.onboarding === DONE) return false;
      const workingDays = on
        ? state.workingDays.filter((c) => c !== code)
        : WEEKDAY_CODES.filter((c) => c === code || state.workingDays.includes(c));
      commit({ ...state, workingDays }, { type: "config" });
      return true;
    },
    /** Vacation days per year (required). Returns false for invalid input. */
    setBudget(value) {
      const budget = typeof value === "number" ? value : parseBudget(value);
      if (Object.keys(validatePreferences({ workingDays: ["MON"], budget })).length) return false;
      if (budget === state.budget) return true;
      commit({ ...state, budget }, { type: "config" });
      return true;
    },
    setVacationType(key) {
      if (!VACATION_TYPES.some((t) => t.key === key) || key === state.vacationType) return false;
      commit({ ...state, vacationType: key }, { type: "vacation_type" });
      return true;
    },

    // --- custom days (global) --------------------------------------------------------------
    /** { date, name, kind: "full"|"half", recurring } → "added" | "invalid" | "duplicate". */
    addCustomDay({ date, name, kind, recurring }) {
      const p = parseIso(date);
      if (!p) return "invalid";
      const entry = cleanCustomDay(recurring
        ? { id: newCustomId(), name, kind, recurring: true, month: p.month, day: p.day, active: true }
        : { id: newCustomId(), name, kind, recurring: false, date, active: true });
      if (!entry) return "invalid";
      const same = (d) => d.kind === entry.kind && (entry.recurring
        ? d.recurring && d.month === entry.month && d.day === entry.day
        : !d.recurring && d.date === entry.date);
      if (state.customDays.some(same)) return "duplicate";
      commit({ ...state, customDays: [...state.customDays, entry] }, { type: "config" });
      return "added";
    },
    toggleCustomDay(id) {
      if (!state.customDays.some((d) => d.id === id)) return false;
      commit({ ...state, customDays: state.customDays.map((d) => (d.id === id ? { ...d, active: !d.active } : d)) },
        { type: "config" });
      return true;
    },
    removeCustomDay(id) {
      const d = state.customDays.find((x) => x.id === id);
      if (!d || d.builtin) return false;
      commit({ ...state, customDays: state.customDays.filter((x) => x.id !== id) }, { type: "config" });
      return true;
    },

    // --- disputed and optional holidays (per location) -----------------------------------------
    toggleLocationHoliday(locationId, key) {
      if (!state.locations.some((l) => l.id === locationId) || !KEY_RE.test(key)) return false;
      const current = new Set(state.activeHolidays[locationId] ?? []);
      if (current.has(key)) current.delete(key);
      else current.add(key);
      const activeHolidays = { ...state.activeHolidays, [locationId]: [...current].sort() };
      if (!current.size) delete activeHolidays[locationId];
      commit({ ...state, activeHolidays }, { type: "config" });
      return true;
    },
    isHolidayActive: (locationId, key) => (state.activeHolidays[locationId] ?? []).includes(key),

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** Primary display label: "Zürich" or "8001 Zürich". */
export function locationLabel(location) {
  return location.postcode ? `${location.postcode} ${location.name}` : location.name;
}

/** "9050", "3822, 3823, 3824", "8001–8143 (25)" */
export function formatPostcodes(postcodes) {
  const list = Array.isArray(postcodes) ? postcodes : [];
  if (list.length <= 3) return list.join(", ");
  return `${list[0]}–${list.at(-1)} (${list.length})`;
}

/** Secondary line in search results ("ZH · PLZ 8001–8143 (25)"; for a postcode result
 * the municipality only when it differs from the place: "Lauterbrunnen · BE"). */
export function locationDetail(location) {
  if (location.postcode) {
    return location.municipality && location.municipality !== location.name
      ? `${location.municipality} · ${location.canton}` : location.canton;
  }
  const plz = formatPostcodes(location.postcodes);
  return `${location.canton}${plz ? ` · PLZ ${plz}` : ""}`;
}

/**
 * Request body for POST /api/optimize. vacation_type is deliberately not part of it.
 * `holidayLists` = { location_id: holidays from GET /api/holidays }:
 * - optional holidays (web-only) count only when the user switched them on;
 * - disputed reference holidays (D1) are NOT holidays unless switched on;
 * - custom days (global) apply to every location: half days via half_days, full days
 *   via custom_holidays.
 */
export function optimizePayload(state, holidayLists = {}) {
  const { halfDays, holidays } = expandCustomDays(state.customDays, state.year);
  const extra = {};
  const off = {};
  for (const loc of state.locations) {
    const active = new Set(state.activeHolidays?.[loc.id] ?? []);
    const list = holidayLists[loc.id] ?? [];
    const on = list.filter((h) => !h.disputed && h.enabled === false && active.has(h.key));
    if (on.length) extra[loc.id] = on.map((h) => ({ date: h.date, name: h.name, work_fraction: h.work_fraction }));
    const disputedOff = list.filter((h) => h.disputed && !active.has(h.key)).map((h) => h.key);
    if (disputedOff.length) off[loc.id] = disputedOff;
  }
  const payload = {
    year: state.year,
    locations: state.locations,
    working_days: state.workingDays,
    half_days: halfDays,
    vacation_budget: state.budget,
  };
  if (holidays.length) payload.custom_holidays = holidays;
  if (Object.keys(extra).length) payload.extra_holidays = extra;
  if (Object.keys(off).length) payload.disabled_holidays = off;
  return payload;
}
