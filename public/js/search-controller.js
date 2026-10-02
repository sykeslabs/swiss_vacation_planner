// Search behaviour without DOM: min length, 300 ms debounce, cancellation of stale
// requests, per-session cache. Unit-tested with node:test.
import { debounce, normaliseQuery } from "./util.js";

export const MIN_QUERY_LENGTH = 3;
export const DEBOUNCE_MS = 300;

/**
 * `onState({status, query, results, message})` is called on every change.
 * status: "idle" | "loading" | "results" | "error"
 */
export function createSearchController({ fetchLocations, onState, debounceMs = DEBOUNCE_MS, timers }) {
  const cache = new Map();
  let current = "";
  let controller = null;

  const abortPending = () => {
    if (controller) controller.abort();
    controller = null;
  };

  async function run(query) {
    if (cache.has(query)) {
      onState({ status: "results", query, results: cache.get(query) });
      return;
    }
    abortPending();
    const ctrl = new AbortController();
    controller = ctrl;
    onState({ status: "loading", query, results: [] });
    try {
      const results = await fetchLocations(query, { signal: ctrl.signal });
      cache.set(query, results);
      if (query === current) onState({ status: "results", query, results });
    } catch (err) {
      if (err.name === "AbortError" || query !== current) return;
      onState({ status: "error", query, results: [], message: err.message });
    } finally {
      if (controller === ctrl) controller = null;
    }
  }

  const scheduled = debounce(run, debounceMs, timers);

  return {
    /** Feed the raw input value on every keystroke. */
    input(raw) {
      const query = normaliseQuery(raw);
      if (query === current) return;
      current = query;
      if (query.length < MIN_QUERY_LENGTH) {
        scheduled.cancel();
        abortPending();
        onState({ status: "idle", query, results: [] });
        return;
      }
      scheduled(query);
    },
    reset() {
      current = "";
      scheduled.cancel();
      abortPending();
      onState({ status: "idle", query: "", results: [] });
    },
  };
}
