/** Delays `fn` until `ms` have passed without another call. `cancel()` drops a pending call. */
export function debounce(fn, ms, timers = globalThis) {
  let handle = null;
  const debounced = (...args) => {
    if (handle !== null) timers.clearTimeout(handle);
    handle = timers.setTimeout(() => {
      handle = null;
      fn(...args);
    }, ms);
  };
  debounced.cancel = () => {
    if (handle !== null) timers.clearTimeout(handle);
    handle = null;
  };
  return debounced;
}

/** Collapses whitespace like the server does before validating a query. */
export function normaliseQuery(q) {
  return (q ?? "").split(/\s+/).filter(Boolean).join(" ");
}
