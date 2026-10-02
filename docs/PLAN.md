# PLAN — Swiss Vacation Planner (M0 output, 2026-10-02)

This plan is based on live spike calls (raw responses in `docs/samples/`). Items marked **[OWNER]** need confirmation before the milestone that depends on them.

## 1. Repository state at M0

Empty project: `CLAUDE.md`, `docs/SPEC.md` (moved from root), `.env` (`YDC_API_KEY`, `OPENROUTER_API_KEY`; no `OPENROUTER_MODEL`). `git init` done, `.gitignore` excludes `.env`. Local Python 3.13.7, Node 24. **Vercel CLI not installed** (needed from M1: `npm i -g vercel`, version ≥ 48.2.10).

## 2. Vercel deployment pattern (D16, verified against Vercel docs updated 2026-08-12)

- Zero-config Flask: Vercel looks for an `app` variable in `app.py`, `index.py`, `server.py`, `main.py`, `wsgi.py` or `asgi.py` (also inside `src/` or `app/`). The whole Flask app becomes **one** Vercel Function. No top-level `api/` folder.
- **Entrypoint:** root `wsgi.py` → `from app import create_app; app = create_app()`.
- **Static files must live in `public/**`.** Vercel serves them from the CDN at the root path (`public/js/app.js` → `/js/app.js`). Vercel says not to use Flask's `static_folder`. Locally, Flask serves `public/` with `static_url_path=""` so URLs are identical. *(Deviation from SPEC §5 `static/`.)*
- Python version: `.python-version` = `3.13` (supported: 3.12 default, 3.13, 3.14). Dependencies: `requirements.txt`.
- `vercel.json`: `functions["wsgi.py"].maxDuration = 30` (see C2) and `excludeFiles` for `tests/**`, `docs/**`.
- Bundle limit is 500 MB; our dependencies are ~25 MB.

## 3. Project structure

```
wsgi.py                      # Vercel entrypoint
app/__init__.py              # create_app()
app/errors.py                # {error:{code,message}}, no stack traces to client
app/validation.py            # request parsing → pydantic models, 400 on invalid
app/routes/{pages,locations,holidays,planner,weather,travel}.py
domain/models.py             # Location, Holiday, DayInfo, PlannerState, VacationCandidate, VacationType registry
domain/calendar.py           # build_days(), derive_category()  (single source for all views)
domain/working_days.py
domain/holidays.py           # baseline (reference calendar) + merge/conflict logic, pure
domain/vacation_optimizer.py # pure, deterministic, no I/O
domain/weather_statistics.py # pure: same-date averaging, leap-day handling
domain/travel.py             # prompts, offer schema, sanitising (no HTTP)
services/http.py             # shared requests.Session, timeouts, error mapping
services/cache.py            # in-memory TTL cache (per instance)
services/{geoadmin,youcom,meteoswiss,openrouter}.py   # HTTP + normalisation only
templates/index.html
public/css/  public/js/  public/data/world.geojson
tests/  docs/{SPEC,PLAN,DECISIONS}.md  vercel.json  requirements.txt  .python-version  README.md
```

Import rule (enforced by a test that parses imports): nothing under `domain/` imports `services.*`. `services/openrouter.py` is imported only by `app/routes/travel.py`.

Dependencies: `flask`, `requests`, `pydantic` (v2), `holidays` (11 MB, pure Python; needs D1 approval), `pytest` (dev only). Frontend: Leaflet via CDN (unpkg), vanilla JS, no build step.

## 4. External APIs — observed behaviour

### 4.1 GeoAdmin (locations, tiles) — no key

**Search:** `GET https://api3.geo.admin.ch/rest/services/api/SearchServer?searchText=<q>&type=locations&origins=gg25,zipcode&sr=4326&limit=10`
- `results[].attrs`: `origin` (`gg25` = municipality, `zipcode`, also `district`, `kantone`, `gazetteer` …), `featureId`, `label` (contains HTML `<b>`), `lat`, `lon`, `detail`, `geom_st_box2d`.
- `gg25`: `featureId` **is the BFS municipality number** (Zürich 261, Bern 351, Appenzell 3101). Canton only in the label: `"<b>Zürich (ZH)</b>"`. Results include lakes (`Zürichsee (ZH)`, featureId 9051 → BFS ≥ 9000 must be filtered out) and translated duplicates (`Appenzello (AI)`, same featureId → dedupe by featureId).
- `zipcode`: `label` `"<b>8001 - Zürich</b>"`, `featureId` is a PLZ-layer id (4385), **not** a BFS number, and there is **no canton**.
- **Postcode → municipality:** second call `GET …/MapServer/identify?geometry=<lon>,<lat>&geometryType=esriGeometryPoint&sr=4326&layers=all:ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill&tolerance=0&returnGeometry=false&timeInstant=<current year>` → `attributes.gde_nr` (BFS), `gemname`, `kanton`. Without `timeInstant` it returns 177 historical results (184 KB); with it, 1 result (886 B). Limitation: a postcode spanning several municipalities resolves to the municipality at the PLZ centroid.
- **Elevation** (needed for D12): `GET https://api3.geo.admin.ch/rest/services/height?easting=&northing=&sr=2056` → `{"height":"407.7"}`. Only LV95/LV03 are accepted. LV95 coordinates come from a SearchServer call with `sr=2056` (to verify in M2) or a local WGS84→LV95 approximation (swisstopo formulas).
- **Tiles (verified 200 image/jpeg):** `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg` and `…/ch.swisstopo.swissimage/…jpeg`. Attribution "© swisstopo".

Normalised `Location.id` = `"bfs-<BFS>"` or `"bfs-<BFS>-plz-<PLZ>"`.

M2 finding: the `zipcode` origin matches digits only, so a village name that isn't a municipality (e.g. "Wengen") is found only by its postcode (3823 → Gemeinde Lauterbrunnen). Text queries therefore search `gg25` only; digit queries search `zipcode` only. GeoAdmin's matching is fuzzy, so nonsense input can return unrelated municipalities.

### 4.2 You.com (holidays) — `X-API-Key`

| Endpoint | Result | Latency |
|---|---|---|
| `GET https://ydc-index.io/v1/search?query=&count=&country=CH&language=de` | `results.web[]{url,title,description,snippets[],favicon_url}`. Snippets are prose (*"Feiertage sind der 1. und 2. Januar, Karfreitag …"*), so dates can't be parsed from them. | — |
| same + `livecrawl=web&livecrawl_formats=markdown` | adds `contents.markdown` (6–13 k chars/page) with **real tables**, e.g. feiertagskalender.ch: `\| 26.03.2027 \| Fr \| [Karfreitag](…) \| 12 \| [2](…) \|` (Klasse 1 = gesetzlich, 2 = Sonntagen gleichgestellt, 3 = halber Feiertag, 4 = nicht anerkannt, 5 = Ereignistag) | 3.9 s |
| `POST https://api.you.com/v1/research {input}` | LLM-written markdown answer plus `sources[]`. Correct for Zürich 2027, including municipal half-days. | not timed |
| `POST https://api.you.com/v1/agents/runs {agent:"express"}` | Ran **no search**, answered from model memory and was **wrong** (Auffahrt/Pfingstmontag "halbtags", 1. Mai missing) | — |

Observations relevant to D1/D2:
- The pages returned vary between calls. For AI the "all events" variant came back (Valentinstag, Muttertag, Sommerzeit …), so the parser must use the `Klasse` column.
- Many result pages (ferienwiki.ch, stadt-zuerich.ch) have tables with `dd.mm.` dates without a year, or employer-specific rules (Stadt Zürich "Betriebsferientage").
- In practice one third-party site (feiertagskalender.ch, "Irrtümer vorbehalten") carries the parsable data.
- Prototype parser (regex on markdown rows with `dd.mm.yyyy`) extracted the 9 ZH and the AI rows correctly, including `St. Mauritius` (22.9., inner district only) and `Mariä Himmelfahrt`.
- **Pricing:** free tier, 100 queries/day (owner, 2026-10-02). The quota is shared by all users; in-memory caches reset on cold starts. Quota errors (429/402) degrade to baseline + warning. A persistent cache (D15 follow-up, Upstash/Vercel KV) would protect the quota and needs owner approval.

### 4.3 MeteoSwiss Open Government Data (weather) — no key, licence CC BY

- STAC: `https://data.geo.admin.ch/api/stac/v1/collections/ch.meteoschweiz.ogd-smn` (automatic weather stations, SMN). Collection assets: `ogd-smn_meta_stations.csv` (159 stations, **cp1252**), `ogd-smn_meta_parameters.csv`, `ogd-smn_meta_datainventory.csv` (0.9 MB, utf-8).
- Per station (`items/<abbr>`): `ogd-smn_<abbr>_d_historical.csv` (daily, start of record → **31.12. of last year**; SMA = 6.46 MB, 59 170 rows, gzip transfer, 0.7 s) and `_d_recent.csv` (1.1. current year → yesterday). The D10 window (last 10 completed years) is always fully inside `_d_historical`.
- CSV: `;`-separated, `reference_timestamp` = `dd.mm.yyyy HH:MM`, empty = missing.
- Variables: `tre200d0` daily mean °C, `tre200dx` daily max °C, `tre200dn` daily min °C, `rre150d0` precipitation daily sum mm (6–6 UTC), `sre000d0` sunshine daily sum **minutes**.
- Stations with all 5 variables since ≤ 2016-01-01 and still running (inventory): **98 of 159**.
- Processing: stream the CSV, keep only the needed columns and years. Cache parsed per-station series in memory (~40 KB per station). Station metadata and inventory are cached for 24 h.

### 4.4 OpenRouter (travel offers) — `Authorization: Bearer`

- `POST https://openrouter.ai/api/v1/chat/completions` with `response_format: {type:"json_schema", json_schema:{name, strict:true, schema}}` and `usage:{include:true}`.
- Spike (model `google/gemini-2.5-flash-lite`, $0.10/$0.40 per M tokens): 200, **8.27 s**, 121 prompt + 2117 completion tokens, **cost USD 0.00086**, 10 schema-valid offers, `source_urls` empty as instructed.
- `usage.cost` is returned per call, so cost logging is direct.
- The model mirrored the prompt's transliteration ("Kuesten"); prompts must use real umlauts.

### 4.5 World map (D14)

Natural Earth admin-0 (public domain). The 110m file (839 KB, 177 features) lacks small states (e.g. Malta). `ISO_A2` is `-99` for France, Norway, Kosovo, N. Cyprus and Somaliland; `ISO_A2_EH` fixes France (FR), Norway (NO) and Kosovo (XK). Plan: 50m admin-0, keep properties `ISO_A2_EH`, `NAME_DE`; simplify/quantise once with mapshaper (dev-time `npx`, output committed to `public/data/world.geojson`, target < 400 KB). Features without a valid code are not clickable. The allowed country list = codes in that file.

## 5. Domain model (Python dataclasses, frozen)

As SPEC §4, plus:
- `Location`: `postcode: str | None` (municipality results have none), `elevation_m: float | None`, `lv95: tuple | None`.
- `Holiday`: `work_fraction: float` (0 = full day, 0.5 = half day), `enabled: bool` (see D1 merge rules).
- `DayCategory` enum, derived only by `domain.calendar.derive_category(day)`. Precedence: in_selected_period overlay → Feiertag (holiday on a working day) → Ferientag → Feiertag an freiem Tag → Wochenende/frei → Arbeitstag. "Frei am Stück" is the overlay for days within a candidate's free run.
- Weather: `WeatherStation(abbr, name, lat, lon, elevation_m)`, `WeatherSummary(location_id, station, distance_km, elevation_diff_m, years_used, missing_years, temp_mean, temp_min, temp_max, precip_mm, sunshine_h, methodology, source, source_url, retrieved_at)`.

## 6. API contracts (draft; final shapes go into README)

The server is stateless (Vercel), so endpoints that take a `location_id` also need the location fields they depend on. **[OWNER] Small deviation from SPEC §5.**

```
GET  /api/locations?q=<≥3 chars>
     → {locations: Location[]}
GET  /api/holidays?year=&location_id=&canton=&municipality_id=&municipality=
     → {holidays: Holiday[], warnings: [{code, message}], sources: [{url,title,retrieved_at}]}
POST /api/optimize
     {year, locations:[Location], working_days:["MON",…], half_days:{"2027-12-24":0.5},
      vacation_budget: float|null, holidays: {location_id: Holiday[]}}
     → {per_location: {id: {days: DayInfo[], candidates: [], zero_cost: [], summary}}}
GET  /api/weather?location_id=&lat=&lon=&elevation=&start=&end=
     → {location_id, station:{…}, distance_km, elevation_diff_m, averages:{temp_mean,temp_min,temp_max,precip_mm,sunshine_h},
        methodology, years_used:[…], missing_years:[…], warnings:[], source, source_url, retrieved_at}
POST /api/travel/offers   (as SPEC §5)
     → {offers: [], meta:{partial, model, generated_at, label:"KI-Vorschlag"}}
```

`/api/optimize` takes the holidays as input, so the optimizer route makes no You.com call. The client first fetches `/api/holidays` (with warnings) and then optimizes. If the client sends no holidays, the server uses the deterministic baseline. Errors: `{error:{code,message}}`, 400 for validation, 502/503 with a friendly German message for upstream failures.

## 7. Holiday pipeline (proposal for D1)

1. **Baseline (deterministic):** `holidays.CH(subdiv=<canton>, years=[y-1,y,y+1], categories=("public",), language="de")`. Verified for 2027: ZH 9 days, AI 12 (incl. Fronleichnam, Mariä Himmelfahrt, Allerheiligen, Mariä Empfängnis), TI 15, BE 9 (incl. Berchtoldstag). The package's `"Stadt Zurich"` subdivision models city-employee rules (Brückentage, Knabenschiessen on Sat/Sun) and is **not** used.
2. **You.com corroboration:** one search + livecrawl call per `(municipality_id, canton, year)`, query `"Feiertage <Gemeinde> <Kanton> <Jahr>"`. Deterministic parser for markdown table rows with full `dd.mm.yyyy` dates; for feiertagskalender.ch the `Klasse` column is used (1–2 → full day, 3 → half day, 4–5 → ignored). Names are normalised for matching (casefold, umlaut/punctuation folding, alias table e.g. "Neujahr" ≈ "Neujahrstag").
3. **Merge (pure function in `domain/holidays.py`):**
   - In baseline and confirmed → `confidence=high`, both provenances kept.
   - Baseline only → `confidence=medium`, still used.
   - You.com only (municipal, e.g. AI St. Mauritius, ZH Sechseläuten afternoon) → `confidence=low`, `conflict="nur in Websuche gefunden"`, **shown but not used by the optimizer until the user enables it** (toggle per holiday).
   - Same name, different date → conflict flag, baseline date used, both shown.
4. If You.com fails, the baseline is returned with a warning "Lokale Feiertage konnten nicht geprüft werden".

You.com is called only for the planned year; boundary months use the baseline only (warning shown).

## 8. Optimizer outline (M5)

- Build `DayInfo` for 1.12.(y-1) … 31.1.(y+1) per location.
- Candidate generation: every vacation block `[a,b]` of *workdays to take off* where `a-1` and `b+1` are free (or at the window edge), the cost is 1–10 (half-days 0.5) and the resulting free run is ≤ 21 calendar days. Blocks may contain free days. This is O(days × 21), trivially fast.
- `days_free` = length of the maximal free run containing the block. `efficiency = days_free / cost`.
- Zero-cost runs (≥ 3 days, see Q1) are listed separately.
- Dedupe identical free runs. Drop dominated candidates (superset run at ≤ cost). Stable sort by (start, cost).
- `vacation_days_by_year` splits the cost by calendar year (D8). Candidates must contain at least one day in the planned year.
- Headline: see Q2.

## 9. Weather methodology (M6)

- Reference years = the last 10 completed years (today: 2016–2025). Each reference window keeps the planned month/day pattern. If the period crosses New Year, a window is anchored on its start year and must end in a completed year, so the anchors become 2015–2024.
- Per year: the daily values for the window. A year is "missing" if any day lacks one of the five variables. It is excluded and listed; fewer than 7 years → warning.
- 29 Feb as in SPEC §8.
- Figures (proposal, see Q4): `temp_mean` = mean of `tre200d0`, `temp_min` = mean of `tre200dn`, `temp_max` = mean of `tre200dx`, `precip_mm` = mean **period total**, `sunshine_h` = mean period total (minutes ÷ 60). Raw figures only, no scoring.
- Label (example values): "Historischer Durchschnitt 2016–2025, keine Prognose · Station Zürich / Fluntern (SMA), 2.1 km, Δ +149 m · Quelle: MeteoSchweiz".

## 10. Caching (in-memory TTL, per instance)

| Key | TTL |
|---|---|
| GeoAdmin `q` (normalised) | 24 h |
| holidays `(municipality_id, canton, year)` | 24 h |
| MeteoSwiss station meta + inventory | 24 h |
| MeteoSwiss station series `(abbr)` | 24 h |
| weather `(location_id, start, end, source)` | 24 h |
| travel offers (full payload hash) | 1 h |

## 11. Testing

`pytest`, offline. Every service is tested against the recorded samples in `docs/samples/` (copied to `tests/fixtures/`) with mocked `requests`. A static import-boundary test enforces rules 1/3. A small JS test (node:test, no deps) covers the travel flow state machine (no call before country click / on decline).
