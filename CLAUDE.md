# CLAUDE.md — Swiss Vacation Planner

Persistent rules for every session in this repo. The full spec is in `docs/SPEC_V1.md`.

## How to work

- Work in milestones (defined in `docs/SPEC_V1.md` §3). Do only the current milestone, then **stop and report** using the template in §3. Do not start the next milestone until the owner approves it.
- Before you write any code, inspect the existing repo. Adapt to it; never overwrite working code without asking.
- If an implementation choice changes a requirement, or the spec contradicts itself or reality (for example an API doesn't behave as described), **stop and ask**. Don't pick an option silently.
- Never claim something works unless you ran it. Label each verification as `unit-tested`, `manually verified (live API)`, or `not verified`.
- The example values in the spec (towns, dates, holidays, weather numbers, results) are illustrations only. Never hard-code them.
- Keep `docs/DECISIONS.md` up to date: one line per decision, with the date and the reason.

## Mandatory architecture rules

1. The vacation optimizer is pure, deterministic Python. It makes no network calls and uses no LLM.
2. Each external service has exactly one role:
   - GeoAdmin/swisstopo: Swiss locations and Swiss map tiles
   - You.com: Swiss holiday retrieval
   - MeteoSwiss: historical weather
   - OpenRouter: optional travel offers only
3. `services/openrouter.py` is never imported by `domain/` optimizer, calendar, or holiday code. The planner must work fully without `OPENROUTER_API_KEY`.
4. OpenRouter is called only after the user has (a) accepted the offers modal **and** (b) explicitly clicked a country on the world map.
5. The vacation type is stored in planner state and passed to travel discovery. It **never** affects the optimizer.
6. Year overview, month detail, and period highlighting all render from **one** day model and **one** render function.
7. All external data is normalized into domain models before it reaches domain logic. Provenance (source, URL, retrieved_at) is preserved.
8. A failure in one external service degrades only its own feature. No other feature breaks.
9. API keys (`YDC_API_KEY`, `OPENROUTER_API_KEY`) stay server-side. Never send stack traces to the client.
10. LLM output is untrusted. Validate it against a schema, render it as text only (no `innerHTML`), and label it as an AI suggestion, never as a confirmed price, availability, flight, or hotel.
11. Weather comparisons show raw figures only. No score, no ranking, no "best location".
12. Don't rely on the local filesystem for persistence (Vercel). In-memory caching is fine. Persistent caching needs owner approval first.

## Conventions

- Code, identifiers, and comments are in English. UI text is in Swiss Standard German (Ferien, Feiertag, no ß). Dates display as `6.–9. Mai 2027`.
- Unit tests mock every external API. `pytest` must pass offline.
- Use the Python version and dependencies supported by the Vercel Python runtime. Keep the bundle small; avoid heavy libraries (xarray, netCDF) unless the owner approves them.
