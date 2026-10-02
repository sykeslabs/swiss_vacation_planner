// Run: node --test "tests/js/*.test.mjs"
import assert from "node:assert/strict";
import { test } from "node:test";

import { createSearchController, DEBOUNCE_MS } from "../../public/js/search-controller.js";
import { createLocationStore, locationDetail, locationLabel } from "../../public/js/state.js";
import { debounce, normaliseQuery } from "../../public/js/util.js";

function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const pending = new Map();
  return {
    setTimeout(fn, ms) { const id = nextId++; pending.set(id, { fn, at: now + ms }); return id; },
    clearTimeout(id) { pending.delete(id); },
    advance(ms) {
      now += ms;
      for (const [id, t] of [...pending].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now) { pending.delete(id); t.fn(); }
      }
    },
  };
}

const flush = () => new Promise((r) => setImmediate(r));

function setup(fetchImpl) {
  const timers = fakeTimers();
  const states = [];
  const calls = [];
  const ctrl = createSearchController({
    timers,
    onState: (s) => states.push(s),
    fetchLocations: (q, opts) => { calls.push({ q, signal: opts.signal }); return fetchImpl(q, opts); },
  });
  return { timers, states, calls, ctrl };
}

const ZH = { id: "bfs-261", name: "Zürich", postcode: null, municipality: "Zürich", canton: "ZH" };

test("no request below 3 characters", async () => {
  const { timers, calls, states, ctrl } = setup(async () => [ZH]);
  ctrl.input("Zü");
  ctrl.input("  Zü ");
  timers.advance(1000);
  await flush();
  assert.equal(calls.length, 0);
  assert.equal(states.at(-1).status, "idle");
});

test("debounces to one request 300 ms after the last keystroke", async () => {
  const { timers, calls, ctrl } = setup(async () => [ZH]);
  ctrl.input("Zür");
  timers.advance(200);
  ctrl.input("Züri");
  timers.advance(DEBOUNCE_MS - 1);
  assert.equal(calls.length, 0);
  timers.advance(1);
  await flush();
  assert.deepEqual(calls.map((c) => c.q), ["Züri"]);
});

test("delivers results and caches them per query", async () => {
  const { timers, calls, states, ctrl } = setup(async () => [ZH]);
  ctrl.input("Zürich");
  timers.advance(DEBOUNCE_MS);
  await flush();
  assert.deepEqual(states.at(-1), { status: "results", query: "Zürich", results: [ZH] });
  ctrl.input("Zürichs");
  ctrl.input("Zürich");
  timers.advance(DEBOUNCE_MS);
  await flush();
  assert.equal(calls.filter((c) => c.q === "Zürich").length, 1);
  assert.equal(states.at(-1).status, "results");
});

test("a newer query aborts the older request and stale results are ignored", async () => {
  const resolvers = {};
  const { timers, calls, states, ctrl } = setup(
    (q) => new Promise((resolve, reject) => {
      resolvers[q] = resolve;
    })
  );
  ctrl.input("Bern");
  timers.advance(DEBOUNCE_MS);
  ctrl.input("Basel");
  timers.advance(DEBOUNCE_MS);
  assert.equal(calls[0].signal.aborted, true);
  resolvers.Basel([{ ...ZH, id: "bfs-2701", name: "Basel" }]);
  resolvers.Bern([ZH]);
  await flush();
  const last = states.at(-1);
  assert.equal(last.query, "Basel");
  assert.equal(last.results[0].name, "Basel");
});

test("errors surface the server message", async () => {
  const { timers, states, ctrl } = setup(async () => {
    throw new Error("Die Ortssuche ist im Moment nicht erreichbar.");
  });
  ctrl.input("Bern");
  timers.advance(DEBOUNCE_MS);
  await flush();
  assert.equal(states.at(-1).status, "error");
  assert.match(states.at(-1).message, /nicht erreichbar/);
});

test("clearing the input cancels a pending search", async () => {
  const { timers, calls, ctrl } = setup(async () => [ZH]);
  ctrl.input("Bern");
  ctrl.input("");
  timers.advance(1000);
  await flush();
  assert.equal(calls.length, 0);
});

test("store adds, deduplicates and removes locations", () => {
  const store = createLocationStore();
  const changes = [];
  store.subscribe((locs, change) => changes.push([change.type, locs.map((l) => l.id)]));
  assert.equal(store.add(ZH), true);
  assert.equal(store.add({ ...ZH }), false);
  assert.equal(store.add({ ...ZH, id: "bfs-351", name: "Bern" }), true);
  assert.equal(store.remove("bfs-261"), true);
  assert.equal(store.remove("bfs-261"), false);
  assert.deepEqual(changes, [
    ["add", ["bfs-261"]],
    ["add", ["bfs-261", "bfs-351"]],
    ["remove", ["bfs-351"]],
  ]);
});

test("labels", () => {
  const plz = { ...ZH, id: "bfs-261-plz-8001", postcode: "8001" };
  assert.equal(locationLabel(ZH), "Zürich");
  assert.equal(locationLabel(plz), "8001 Zürich");
  assert.equal(locationDetail(ZH), "Gemeinde · ZH");
  assert.equal(locationDetail(plz), "PLZ · Gemeinde Zürich · ZH");
});

test("util", () => {
  assert.equal(normaliseQuery("  8001   Zürich "), "8001 Zürich");
  const timers = fakeTimers();
  let n = 0;
  const d = debounce(() => n++, 100, timers);
  d(); d(); timers.advance(100);
  assert.equal(n, 1);
  d(); d.cancel(); timers.advance(100);
  assert.equal(n, 1);
});
