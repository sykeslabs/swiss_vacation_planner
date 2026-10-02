# Decisions

One line per decision: date — decision — reason. Status: **accepted** (owner approved or spec default with no conflict) or **proposed** (awaiting owner).

- 2026-10-02 — accepted — `SPEC.md` moved to `docs/SPEC.md`; `git init`; `.gitignore` excludes `.env` — owner approved (M0 question 1).
- 2026-10-02 — accepted — M0 spike budget: ≤ 10 You.com calls, 1 OpenRouter call with a cheap model — owner delegated ("You decide"). Used: 7 You.com calls, 1 OpenRouter call (USD 0.00086).
- 2026-10-02 — accepted — D16: one Flask Vercel Function, entrypoint `wsgi.py`, no top-level `api/` — verified in the Vercel docs (2026-08-12).
- 2026-10-02 — proposed — Static assets in `public/**` instead of `static/` — Vercel serves only `public/` from the CDN and advises against Flask `static_folder` (deviation from SPEC §5).
- 2026-10-02 — proposed — Python 3.13 via `.python-version` — supported by Vercel, matches local 3.13.7.
- 2026-10-02 — proposed — D1: hybrid. `holidays` package (canton, category `public`) as baseline + You.com search+livecrawl with a deterministic table parser for corroboration; You.com-only holidays are shown but off by default — snippets contain no structured dates, and the express agent hallucinated.
- 2026-10-02 — proposed — D2: You.com `GET ydc-index.io/v1/search` with `livecrawl=web&livecrawl_formats=markdown`; no research/agent endpoints for normalised data — LLM output isn't deterministic, and the express agent was wrong in the spike.
- 2026-10-02 — accepted — D3–D10 as in the spec, except where the open questions in the M0 report apply.
- 2026-10-02 — proposed — D11: MeteoSwiss OGD SMN station data via STAC `ch.meteoschweiz.ogd-smn`, daily `_d_historical.csv` — endpoint verified, 6.5 MB per station, < 1 s.
- 2026-10-02 — proposed — D12: candidate stations = all 5 variables in the inventory since the first reference year and still active (98/159); nearest by haversine, tie-break on |Δ elevation|; per-year gaps are then handled as missing years (SPEC §8).
- 2026-10-02 — proposed — D13: `OPENROUTER_MODEL` default `google/gemini-2.5-flash-lite` — strict JSON schema works, 10 valid offers, USD 0.00086 per call.
- 2026-10-02 — proposed — D14: Natural Earth 50m admin-0, `ISO_A2_EH`, simplified with mapshaper at dev time — 110m lacks small states; `ISO_A2` is -99 for FR/NO.
- 2026-10-02 — accepted — D15: no persistent cache in v1 (in-memory TTL only).
- 2026-10-02 — proposed — OpenRouter timeout 25 s and Vercel `maxDuration` 30 s (all other services ≤ 8 s) — the spike call took 8.27 s, above the SPEC §5 limit.
- 2026-10-02 — proposed — The API passes location fields (canton, BFS, lat/lon, elevation) alongside `location_id`; `/api/optimize` receives holidays from the client — the server is stateless on Vercel.
- 2026-10-02 — accepted — Vercel CLI 62.2.0 installed locally (≥ 48.2.10 required for Flask `vercel dev`).
- 2026-10-02 — proposed — You.com is on the free tier (100 queries/day, per owner): at most 1 You.com call per uncached `(municipality_id, canton, year)`; treat HTTP 429/402 as "quota exhausted" → baseline holidays + warning; tests and dev use fixtures, not live calls — the quota is shared by all users and in-memory caches are lost on cold starts.
- 2026-10-02 — accepted — Static assets in `public/**`; Flask serves `public/` with `static_url_path=""` locally, so URLs match Vercel — M1 approved by owner; verified on `vercel dev`.
- 2026-10-02 — accepted — Python 3.13 (`.python-version`), local `.venv`, `requirements.txt` (runtime) + `requirements-dev.txt` (pytest) — owner chose venv option (a).
- 2026-10-02 — accepted — Leaflet 1.9.4 from unpkg with SHA-384 SRI; no frontend build step — spec allows vanilla JS; SRI hashes computed from the served files.
- 2026-10-02 — accepted — Base map `ch.swisstopo.pixelkarte-farbe` / satellite `ch.swisstopo.swissimage` via WMTS EPSG:3857 (JPEG), attribution "© swisstopo", map limited to minZoom 7 and padded Swiss bounds — SPEC §7.
