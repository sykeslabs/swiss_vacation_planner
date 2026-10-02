// Planner state: selected locations, active location and calendar configuration.
// Pure module (no DOM); persistence goes through an injected storage. Unit-tested.
import { parseIso, toIso } from "./format.js";

export const WEEKDAY_CODES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
export const DEFAULT_WORKING_DAYS = ["MON", "TUE", "WED", "THU", "FRI"];
export const MAX_LOCATIONS = 10;
export const STORAGE_KEY = "svp.planner.v1";
const STORAGE_VERSION = 1;
const LOCATION_FIELDS = ["id", "name", "municipality", "municipality_id", "canton", "latitude", "longitude"];

/** D9: current year … current year + 2 */
export function selectableYears(today = new Date()) {
  const y = today.getFullYear();
  return [y, y + 1, y + 2];
}

/** Planned year plus December before and January after (matches the server). */
export function calendarWindow(year) {
  return { start: toIso(year - 1, 12, 1), end: toIso(year + 1, 1, 31) };
}

/** D6 defaults: 24.12. and 31.12. of both Decembers in the window. */
export function defaultHalfDays(year) {
  const out = {};
  for (const y of [year - 1, year]) for (const d of [24, 31]) out[toIso(y, 12, d)] = 0.5;
  return out;
}

function inWindow(iso, year) {
  const { start, end } = calendarWindow(year);
  return parseIso(iso) !== null && iso >= start && iso <= end;
}

function isValidLocation(loc) {
  return loc && typeof loc === "object" && LOCATION_FIELDS.every((f) => loc[f] !== undefined && loc[f] !== null)
    && typeof loc.id === "string" && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude);
}

export function defaultState(today = new Date()) {
  const year = selectableYears(today)[0];
  return { year, workingDays: [...DEFAULT_WORKING_DAYS], halfDays: defaultHalfDays(year), locations: [], activeLocationId: null };
}

/** Validates persisted data; anything unreadable falls back to defaults field by field. */
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
  const workingDays = Array.isArray(data.workingDays)
    ? WEEKDAY_CODES.filter((c) => data.workingDays.includes(c)) : [];
  let halfDays = defaultHalfDays(year);
  if (data.halfDays && typeof data.halfDays === "object" && !Array.isArray(data.halfDays)) {
    halfDays = Object.fromEntries(Object.entries(data.halfDays)
      .filter(([iso, f]) => inWindow(iso, year) && typeof f === "number" && f > 0 && f < 1));
    if (data.year !== year) halfDays = { ...halfDays, ...defaultHalfDays(year) };
  }
  const seen = new Set();
  const locations = (Array.isArray(data.locations) ? data.locations : [])
    .filter((l) => isValidLocation(l) && !seen.has(l.id) && seen.add(l.id))
    .slice(0, MAX_LOCATIONS);
  const activeLocationId = locations.some((l) => l.id === data.activeLocationId)
    ? data.activeLocationId : (locations[0]?.id ?? null);

  return {
    year,
    workingDays: workingDays.length ? workingDays : base.workingDays,
    halfDays,
    locations,
    activeLocationId,
  };
}

export function serializeState(state) {
  return JSON.stringify({ v: STORAGE_VERSION, ...state });
}

/**
 * `storage` is a localStorage-like object or null. Storage failures (private mode,
 * quota) never break the planner; state then simply isn't remembered.
 */
export function createPlannerStore({ storage = null, today = new Date() } = {}) {
  let initial = defaultState(today);
  try {
    if (storage) initial = restoreState(storage.getItem(STORAGE_KEY), today);
  } catch {
    // unreadable storage: keep defaults
  }
  let state = initial;
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
    activeLocation: () => state.locations.find((l) => l.id === state.activeLocationId) ?? null,

    /** Returns "added", "duplicate" or "full". New locations become active. */
    addLocation(location) {
      if (state.locations.some((l) => l.id === location.id)) return "duplicate";
      if (state.locations.length >= MAX_LOCATIONS) return "full";
      commit({ ...state, locations: [...state.locations, location], activeLocationId: location.id },
        { type: "add", location });
      return "added";
    },
    removeLocation(id) {
      const location = state.locations.find((l) => l.id === id);
      if (!location) return false;
      const locations = state.locations.filter((l) => l.id !== id);
      const activeLocationId = state.activeLocationId === id ? (locations[0]?.id ?? null) : state.activeLocationId;
      commit({ ...state, locations, activeLocationId }, { type: "remove", location });
      return true;
    },
    setActiveLocation(id) {
      if (id === state.activeLocationId || !state.locations.some((l) => l.id === id)) return false;
      commit({ ...state, activeLocationId: id }, { type: "active" });
      return true;
    },

    setYear(year) {
      if (year === state.year || !selectableYears(today).includes(year)) return false;
      // Keep half days that are still visible; re-add the 24.12./31.12. defaults of the new window.
      const kept = Object.fromEntries(Object.entries(state.halfDays).filter(([iso]) => inWindow(iso, year)));
      commit({ ...state, year, halfDays: { ...kept, ...defaultHalfDays(year) } }, { type: "config" });
      return true;
    },
    /** Returns false (and changes nothing) when it would leave no working day. */
    toggleWorkingDay(code) {
      if (!WEEKDAY_CODES.includes(code)) return false;
      const on = state.workingDays.includes(code);
      if (on && state.workingDays.length === 1) return false;
      const workingDays = on
        ? state.workingDays.filter((c) => c !== code)
        : WEEKDAY_CODES.filter((c) => c === code || state.workingDays.includes(c));
      commit({ ...state, workingDays }, { type: "config" });
      return true;
    },
    /** Returns "added", "duplicate" or "out_of_range". */
    addHalfDay(iso) {
      if (!inWindow(iso, state.year)) return "out_of_range";
      if (state.halfDays[iso] !== undefined) return "duplicate";
      commit({ ...state, halfDays: { ...state.halfDays, [iso]: 0.5 } }, { type: "config" });
      return "added";
    },
    removeHalfDay(iso) {
      if (state.halfDays[iso] === undefined) return false;
      const { [iso]: _, ...rest } = state.halfDays;
      commit({ ...state, halfDays: rest }, { type: "config" });
      return true;
    },

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

/** Secondary line in search results. */
export function locationDetail(location) {
  return location.postcode
    ? `PLZ · Gemeinde ${location.municipality} · ${location.canton}`
    : `Gemeinde · ${location.canton}`;
}

/** Request body for POST /api/optimize. vacation_type is deliberately not part of it. */
export function optimizePayload(state) {
  return {
    year: state.year,
    locations: state.locations,
    working_days: state.workingDays,
    half_days: state.halfDays,
    vacation_budget: null,
  };
}
