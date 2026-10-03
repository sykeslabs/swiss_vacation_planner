# Swiss Vacation Planner — Specification v4

> Put this file at `docs/SPEC.md`. The rules in `CLAUDE.md` take precedence.
> §2 lists assumptions and open decisions. The owner may edit them. Anything marked **[DECISION]** must be confirmed at the end of M0.

## 1. Product summary

This is a Flask web app for planning Swiss vacations. The user picks one or more Swiss locations on a full-screen map of Switzerland. The app:

- fetches each location's public holidays;
- applies a weekday schedule the user configures;
- calculates deterministically which vacation periods give the most consecutive days off;
- shows them on an interactive year calendar;
- compares historical weather for the chosen period across the locations.

Optionally, the user can then pick a country on a world map and get 10 AI-generated travel ideas for that period from OpenRouter.

The app is called **Adam**.

**Flow (updated 2026-10-03):** onboarding wizard in three steps — **1 Jahr** (year badges) → **2 Arbeitsort** (search "Arbeitsort oder PLZ suchen" or click the map; after the choice the search hides and the map zooms in; no modal in this step) → **3 Präferenzen** (working days Mo–So, default Mo–Fr; required "Anzahl Ferientage", prefilled with 25, whole or half days; "Weiter" validates) → planner: one panel per town with the calendar and, below it, "So setzt du deine Ferientage clever ein" (the recommended periods) → pick a period in the list or on a turquoise day in the month detail (it gets highlighted and its details appear; weather from M6) → modal "Ferienangebote?" → world map → click a country → OpenRouter → 10 offer cards. The calendar and the optimizer don't run before step 3 is completed. The wizard holds no business logic; it only fills PlannerState.

**Stack:** Python and Flask; HTML, CSS, and vanilla JS (unless the repo already uses a framework); Leaflet; deployed on Vercel.

## 2. Assumptions and open decisions

Claude must confirm or raise each item in the M0 report.

| # | Topic | Default in this spec | Why it matters |
|---|---|---|---|
| D1 **[DECISION]** | **Holiday source reliability.** You.com returns web search results or text, not structured holiday data. Turning that into normalized dates without an LLM means fragile parsing, and the optimizer then depends on non-deterministic input. | **Hybrid.** A deterministic reference calendar (Easter-based computation and/or the `holidays` package with Swiss cantons) gives the baseline. You.com retrieves and corroborates canton- and municipality-specific holidays with provenance. Disagreements are flagged, never auto-resolved. **Update 2026-10-03:** a flagged (disputed) reference holiday — e.g. one the canton page lists for less than 50 % of the population (Mariä Empfängnis in Aargau, 11.6 %) — and an optional (web-only) holiday count as **no holiday** until the user switches it on in the town modal; the switch is per location. **Update 2026-10-03 (owner approved):** a small curated list `data/local_days.json` adds local customary half days (Sechseläuten and Knabenschiessen in Zürich, Zibelemärit in Bern) from deterministic date rules; they are optional (off) half days, the web search only corroborates them, and they also appear without You.com. | This changes "You.com exclusively". The owner must approve it, or confirm You.com-only and accept the risk. |
| D2 **[DECISION]** | How You.com output is parsed (search snippets, or an AI/research endpoint that returns text) | Spike in M0: run 3 real queries, show raw output, propose a parser | Determines feasibility |
| D3 | Vacation-day budget | **Required** input "Anzahl Ferientage" in wizard step 3, prefilled with 25 (whole or half days, 0–366; an empty field is an error, no "no limit"), changeable later in ⚙ Präferenzen. The plan uses only periods within that budget (updated 2026-10-03). | The headline "Wie viele Ferientage holst du raus?" implies a budget |
| D4 | Candidate bounds | A candidate costs 1–10 vacation days, spans at most 21 calendar days, and must start and end next to a non-working day | Prevents a combinatorial explosion |
| D5 | Efficiency | `days_free / vacation_days_required`. Periods costing 0 vacation days (long weekends) are listed separately as "Ohne Ferientag". | Formula was undefined |
| D6 | Half-day semantics | A half-day date is a working day that costs 0.5 vacation days. 24.12 and 31.12 are **recurring** half days (month/day rules) that are on by default and apply to every year shown, including the boundary months. The user can switch them off and add own dates (whole day off or half day, once or "jährlich") in the town modal; these custom days are **global** (all towns, also towns added later). Half days and own dates are not part of the wizard steps (updated 2026-10-03). | The meaning was ambiguous |
| D7 | Multiple locations | Holidays and optimization are calculated **per location**. The calendar shows one *active* location at a time (switch via chips). The candidate list can be filtered by location. | "Independently" was unclear in the UI |
| D8 | Year-boundary periods | A period that spans 31.12/1.1 is charged to the year in which each vacation day falls. The UI shows the split. | Accounting across years |
| D9 | Selectable years | Current year to current year + 2 | No year selector was specified |
| D10 | Weather reference years | The last 10 **completed** calendar years relative to today, not to the planned year | The planned year may be in the future |
| D11 **[DECISION]** | MeteoSwiss access | Station-based only for v1, using MeteoSwiss Open Government Data (verify the current endpoint/STAC collection in M0). Gridded data is deferred. | Gridded NetCDF is too heavy for serverless |
| D12 | Weather station choice | Nearest station that has all required variables for all 10 years. Tie-break: smallest elevation difference. Show distance and elevation difference. | Needs to be deterministic |
| D13 | OpenRouter model | Set by the `OPENROUTER_MODEL` env var. `source_urls` stays empty unless the model or plugin actually does web retrieval. | URLs from a plain model are likely invented |
| D14 | World-map data | Natural Earth admin-0 GeoJSON (public domain), simplified, served as a static file. ISO-3166 alpha-2 codes. | Needs a license-clean source |
| D15 | Persistent cache | None in v1 (in-memory per instance). Propose Vercel KV or Upstash as a follow-up. | Vercel filesystem is ephemeral |
| D16 | Vercel `api/` folder conflict | **Don't** put Flask blueprints in a top-level `api/` folder. Vercel treats every file there as a separate function. Use `app/routes/` and have one entrypoint. | The original suggested structure breaks on Vercel |

## 3. Milestones

Do one milestone at a time, then stop and report.

| M | Scope | Acceptance checks |
|---|---|---|
| **M0** Discovery | Inspect the repo. Spike: a live sample call to GeoAdmin search, You.com, MeteoSwiss OGD, and OpenRouter (if keys exist), saving raw samples to `docs/samples/`. Confirm the Vercel Flask entrypoint pattern. Write `docs/PLAN.md` (structure, models, API contracts) and answer D1–D16. **No feature code.** | PLAN.md exists. Each decision is answered or escalated. Each API's real response shape is documented. |
| **M1** Skeleton and map | Project structure, Vercel config, `/healthz`, full-screen Swiss map, Karte/Satellit toggle (swisstopo WMTS, EPSG:3857), attribution, glassmorphism base styles. | `vercel dev` serves the map. The toggle works. Attribution is visible. |
| **M2** Locations | `services/geoadmin.py`, `GET /api/locations`, search with ≥3 characters and 300 ms debounce, name or postcode lookup, normalized `Location`, multi-location chips (add/remove), markers, fit-bounds, search → zoom → ~1 s → planner panel. | Town and postcode searches work (live). Normalization is unit-tested. Add/remove works. GeoAdmin down → friendly error, map still usable. |
| **M3** Calendar and working days | `DayInfo` model, calendar builder (planned year plus Dec of the previous year and Jan of the next), weekday toggles, half-days, year view, month zoom (shared renderer), legend, recalculation without page reload. Uses holidays from the reference calendar (D1 baseline). | All days are rendered. Category comes from attributes. Month zoom-in and back work. Config changes re-render. Unit tests pass. |
| **M4** Holidays | `services/youcom.py`, normalization, provenance, conflict flags, cache key `(municipality_id, canton, year)`, `GET /api/holidays`, warnings in the UI. | Live check for 2 cantons that differ. Unit tests: ambiguous/conflicting/missing data. You.com down → baseline calendar still works, with a warning. |
| **M5** Optimizer | `domain/vacation_optimizer.py`, `POST /api/optimize`, headline, candidate list, period selection and highlighting, per-location results. | All optimizer tests in §9 pass. Results are identical across repeated runs. |
| **M6** Weather | `services/meteoswiss.py`, station selection, same-date 10-year averaging, `GET /api/weather`, comparison table, methodology shown in the UI. | Weather tests in §9 pass. Live check for 2 locations. MeteoSwiss down → planner still works. |
| **M7** Travel discovery | Offers modal, world map (country click), `services/openrouter.py`, `POST /api/travel/offers`, schema validation, offer cards, AI-suggestion labelling, navigation back. | Travel tests in §9 pass, including "no call before country selection" and "no call on decline". Live call made once, with cost reported. |
| **M8** Hardening | Input validation, error handling, a security pass (keys, XSS), README (setup, env vars, deploy, API contracts), Vercel preview deploy. | A full checklist run of §10 passes on `vercel dev` and on the preview URL. |

**Report template (end of every milestone):**

```
Milestone:
Implemented:
Verified (unit-tested / manually verified (live API) / not verified):
Tests: <command> → <pass/fail counts>
External APIs called live: <service, #calls>
Actual API cost: <OpenRouter tokens/$, You.com calls>
Decisions taken (also in DECISIONS.md):
Open issues:
Deviations from spec:
Proposed next milestone:
```

## 4. Domain model (minimum)

```python
Location(id, name, postcode, municipality, municipality_id, canton, latitude, longitude)

PlannerState(onboarding: 1 | 2 | 3 | "done", year, locations: list[Location],
             working_days: set[Weekday], vacation_budget: float,   # required (D3)
             vacation_type: VacationType,
             custom_days: list[CustomDay],                        # global, all locations (D6)
             active_holidays: dict[location_id, set[holiday_key]]) # disputed/optional switched on (D1)

CustomDay(id, name, kind: full | half, recurring: bool,
          date | (month, day), active: bool, builtin: bool)   # builtin: 24.12 and 31.12

holiday_key = "YYYY-MM-DD|Name"
# Sent to POST /api/optimize: half_days (expanded custom half days of the calendar window),
# custom_holidays (expanded custom whole days, global), extra_holidays (optional holidays switched
# on, per location), disabled_holidays (disputed holidays NOT switched on, per location).

VacationType = Enum: beach, city, hiking, skiing, wellness, nature, family,
                     road_trip, no_preference   # extensible, labels in a registry

Holiday(date, name, type, jurisdiction: national|canton|municipality,
        canton, municipality, source, source_url, source_title,
        retrieved_at, confidence: high|medium|low, conflict: str | None)

DayInfo(date, weekday, is_working_day, is_weekend, is_holiday, holiday_names,
        holiday_on_non_working_day, work_fraction,   # 1, 0.5, 0
        is_vacation, is_free, in_selected_period)

VacationCandidate(location_id, start, end, days_free, vacation_days_required,
                  efficiency, anchor_holidays: list[str], vacation_days_by_year)
```

The displayed day category (Feiertag, Ferientag, Frei am Stück, Feiertag an freiem Tag, Wochenende) is **derived** from `DayInfo` by a single function. CSS only styles that derived category.

## 5. Backend

**Structure** (adapt to the repo, keeping D16 in mind):

```
app/__init__.py            # Flask app factory
app/routes/{locations,holidays,planner,weather,travel}.py
domain/{calendar,holidays,working_days,vacation_optimizer,weather_statistics,travel}.py
services/{geoadmin,youcom,meteoswiss,openrouter}.py   # HTTP + normalization only
templates/index.html   static/{css,js,data}/
tests/   docs/{SPEC,PLAN,DECISIONS}.md   vercel.json   requirements.txt   README.md
```

**API** (document the exact request and response shapes in the README):

```
GET  /api/locations?q=                       → Location[]
GET  /api/holidays?year=&location_id=        → {holidays: Holiday[], warnings: []}
POST /api/optimize   {year, locations, working_days:["MON",...], half_days:{"2027-12-24":0.5},
                      vacation_budget, custom_holidays:[{date,name}],
                      extra_holidays:{id:[{date,name,work_fraction}]}, disabled_holidays:{id:["YYYY-MM-DD|Name"]}}
                                              → {per_location: {id: {days: DayInfo[], candidates: [], summary}}}
GET  /api/weather?location_id=&start=&end=   → {averages, methodology, years_used, missing_years}
POST /api/travel/offers {vacation_type, country, country_code, origin:"CH",
                      start_date, end_date, days_free, vacation_days_required} → {offers: [], meta}
```

- Validate every input: year range, ISO dates, weekday enum, a non-empty `working_days`, country code from the allowed list, `start ≤ end`. Invalid input returns 400 with a friendly message.
- Errors use the shape `{error: {code, message}}`. Each service has a timeout of ≤ 8 s. A failure in one service never escalates into another feature.
- Caching is in-memory with a TTL, keyed by: GeoAdmin `q`; holidays `(municipality_id, canton, year)`; weather `(location_id, start, end, source)`; travel offers on the full request payload.

## 6. Optimizer (deterministic)

- A day is **free** if it isn't a working day, or it's a holiday, or it's a vacation day. Vacation is consumed only on configured working days that aren't holidays. A half-day costs its `work_fraction`.
- Generate candidates as described in D4. For each candidate compute `days_free` (the length of the maximal consecutive free run including the neighbouring free days), `vacation_days_required`, and `efficiency`.
- Dedupe identical ranges. Drop a candidate if another one covers a superset of its free days for the same or a lower cost. Sort chronologically, and also offer a sort by efficiency.
- Headline: the maximum consecutive free days achievable, with its cost (respecting the budget if one is set).
- No special-casing of named holidays. Easter, Auffahrt, Christmas, and so on must come out of the algorithm on their own.
- Works for any weekday configuration and across the year boundary (D8).

## 7. Frontend

- **Map:** full-screen, always visible. Glass panels float above it (translucent, backdrop blur, subtle border, rounded corners, restrained type). swisstopo base map and SWISSIMAGE satellite. No Google.
- **No page header** (the former "Ferienplaner Schweiz" title is gone).
- **Onboarding wizard** (top left, see §1): steps Jahr → Arbeitsort → Präferenzen. Map click works in step 2 ("Als Arbeitsort wählen"). No half days and no "Datum hinzufügen" in the wizard steps themselves.
- **Top-right controls**, left to right: **⚙** (Präferenzen: glass modal with Jahr, Arbeitstage, Anzahl Ferientage; a year change reloads the holidays of all towns), **?** ("Über Adam"), **Reset** (asks "Alles zurücksetzen?", then clears PlannerState and returns to step 1). Each has an aria-label and a tooltip. ⚙ and Reset appear after onboarding; "?" is always there.
- **Town modal** "Optionale Feiertage und halbe Tage" (opened from the town panel button "Optionale Feiertage und halbe Tage" or from a town chip; never opens by itself — not in the wizard, not after "+"): the result line of the holiday check and one section "Optionale Feiertage und halbe Tage" with on/off switches — disputed and optional holidays of this town (default off, per location), 24.12/31.12 (default on), own dates (default on, global, deletable) — and "Datum hinzufügen". Public holidays that count are not listed (they are visible in the calendar) (date, name, "ganzer Feiertag"/"halber Tag", "jährlich"). Provenance and conflict notes appear only as an ⓘ tooltip (hover, focus, tap), generated from the data. Every change recalculates without a reload.
- **"Deine Orte" panel:** **+** in its title bar (Ort hinzufügen: location search below the panel; the map zooms to the new town, which inherits the custom days; no modal, no wizard; a prominent filled round button) and the town chips (× removes, a click opens the town modal). No preference controls and no vacation type picker (the vacation type stays in PlannerState; its picker comes with the travel offers, M7). The town modal is movable.
- **Boundary months** (December before, January after) are shown like the planned year (no shading).
- A public holiday on a weekend or another day off is red like any holiday (category "Feiertag"; the details say it brings no extra day off).
- **Town panels:** one movable panel per town. Title bar: town name (plain text), "9 Feiertage · 15 Ferientage → 44 Tage frei" (holidays of the year and the recommended plan); "9 Feiertage" opens a movable modal with the exact dates of those holidays. Body: legend, button "Optionale Feiertage und halbe Tage", the calendar and, below it, the collapsible "So setzt du deine Ferientage clever ein" (expanded by default): the recommended periods, chronological, each in two lines ("X Ferientage → Y Tage frei" / date range; no year split) (hovering or focusing an entry highlights its days in the year or month view); while a month detail is open, only the periods with at least one day in that month (also those starting in the month before or ending in the month after). No holiday source line in the panel (provenance stays in the holiday details and the ⓘ tooltips). A list entry and a turquoise day in the month detail call the same selection handler; the selected period is marked in the list and highlighted in the calendar.
- **"Über Adam" (help modal):** what Adam is (steps, data sources, holiday caveat, weather is historical, offers are AI suggestions), Kontakt (mailto, optional website), Unterstützen ("Adam ist kostenlos. Wenn er dir hilft, freue ich mich über eine Spende." + donate button, new tab, `rel="noopener noreferrer"`). Values come only from the environment (`ADAM_CONTACT_EMAIL`, `ADAM_WEBSITE_URL` optional, `ADAM_DONATE_URL`, `ADAM_DONATE_LABEL` optional), injected into the page by the server; a missing value hides its element. Closes with ×, Esc, or a click outside; focus is trapped and returns to "?". No external API call.
- **Calendar:** 12 month boxes plus the boundary months. Clicking a box only animates a zoom into month detail (CSS transform/FLIP) using the **same renderer** — it never selects a period. A clear "← Jahresübersicht" goes back. Include a legend. Selected-period highlighting must work in both views.
- **Results:** headline "Wie viele Ferientage holst du {year} raus?", the best period, then "So setzt du deine Ferientage clever ein" with cards in the form `X Ferientage → Y Tage frei · Datum–Datum`.
- **Period selected:** highlight it in the calendar, show the date range, cost, free days, the anchor holiday name, and the weather comparison table (Temperatur Ø/min/max, Niederschlag, Sonnenscheindauer per location, plus the label "Historischer Durchschnitt 20XX–20YY, keine Prognose" and the station or distance). Then show the modal "Interessierst du dich für konkrete Ferienangebote?" with **[Ja, Angebote anzeigen] [Nein]**.
- **Travel:** a world map with clickable countries (hover and selected states). Nothing is called before a click. Offer cards show a flag, destination, type, duration, an estimated budget clearly labelled "Schätzung", why it fits, and Details. A banner reads "KI-generierte Reiseideen – keine bestätigten Preise oder Verfügbarkeiten". Navigation: change country, change type, back to the period.

## 8. Weather and travel details

**Weather:** For a period from d1 to d2, average the same calendar dates over each of the last 10 completed years (D10).

- 29 Feb: in non-leap reference years it is skipped and the day count is recorded. When the planned period has no 29 Feb, ignore the reference years' 29 Feb.
- A missing year is excluded and listed. If fewer than 7 years have data, show a warning.
- Record the source, station ID, distance, elevation difference, period, and variables.
- Never mix data sources across locations in one comparison.

**OpenRouter:**

- Use the system and user prompts given in `domain/travel.py`. Ask for `response_format` JSON with this schema: `{offers: [{title, destination, description, vacation_type, estimated_budget_chf: int|null, recommended_duration_days: int, why_it_fits, best_travel_window, transport_hint, source_urls: url[]}]}`.
- Validate the response (pydantic or jsonschema). Drop invalid offers. Keep 1–10 valid offers and set `meta.partial` if fewer than 10. Retry once on malformed JSON, then return a friendly error.
- Strip any HTML. Drop URLs that aren't `https`.
- Log token usage and cost so the milestone report can include it.

## 9. Tests (all mocked, run with `pytest`)

- **Optimizer:** Mon–Fri; Mon–Sat; Mon–Thu; holiday on a working day; holiday on a non-working day; consecutive holidays; half-day; year boundary; zero-cost periods; empty or invalid `working_days` → error; multiple locations with different holidays; determinism (same input → same output).
- **Calendar:** every date present exactly once; derived category for each attribute combination; boundary months included.
- **Holidays:** normalization; provenance kept; conflict flagged; missing data not invented; cache key; You.com down.
- **Weather:** same-date 10-year average; leap years; a missing year; no suitable station; multiple locations; MeteoSwiss down.
- **Travel:** type, country, and dates passed through correctly; normalization; malformed JSON; fewer than 10 offers; OpenRouter down; no call before a country is selected; no call on decline (frontend logic tested via a small JS test or the API contract); keys never appear in responses.

## 10. Definition of done (checked in M8)

- **Map:** loads; toggle works; attribution shown.
- **Search:** town and postcode search; normalized results; zoom on selection.
- **Planner:** appears after selection; multiple locations add/remove; vacation type can be changed.
- **Calendar:** full year plus boundary months; consistent colours; month zoom-in and back; same semantics in both views.
- **Working days:** per-weekday toggles; half-days; live recalculation.
- **Holidays:** location- and year-specific; provenance shown; ambiguity flagged.
- **Optimizer:** deterministic; dynamic candidates; per location.
- **Weather:** 10-year same-date averages labelled as historical; comparison table; methodology visible.
- **Travel:** modal; declining makes no call; world map; country required; context passed through; up to 10 validated offers; failures handled.
- **Deploy:** `vercel dev` and a preview deploy work; env vars documented (`YDC_API_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`); tests green; README complete.
