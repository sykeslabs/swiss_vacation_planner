// Planner state for the selected locations. Pure module (no DOM), unit-tested with node:test.

export function createLocationStore() {
  let locations = [];
  const listeners = new Set();
  const emit = (change) => listeners.forEach((fn) => fn(locations, change));

  return {
    all: () => locations,
    has: (id) => locations.some((l) => l.id === id),
    /** Adds a location; returns false if it was already selected. */
    add(location) {
      if (locations.some((l) => l.id === location.id)) return false;
      locations = [...locations, location];
      emit({ type: "add", location });
      return true;
    },
    /** Removes a location by id; returns false if it wasn't selected. */
    remove(id) {
      const location = locations.find((l) => l.id === id);
      if (!location) return false;
      locations = locations.filter((l) => l.id !== id);
      emit({ type: "remove", location });
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
