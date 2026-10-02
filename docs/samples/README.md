# Raw API samples (M0 spike, 2026-10-02)

All files are raw responses from live calls. API keys are never stored (asserted at capture time).

| File | Service / endpoint | Notes |
|---|---|---|
| `geoadmin_search.json` | GeoAdmin `SearchServer` (`type=locations`) | Queries: "Zürich", "8001", "Appenzell", "Bern" |
| `geoadmin_identify.json` | GeoAdmin `MapServer/identify` on `ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill`, plus PLZ feature `ch.swisstopo-vd.ortschaftenverzeichnis_plz/4385` | Identify trimmed to the current-year result (the original had 177 historical results) |
| `youcom_search_{1,2,3}.json` | You.com `GET https://ydc-index.io/v1/search` | Snippets only, no structured dates |
| `youcom_search_livecrawl.json` | Same, with `livecrawl=web&livecrawl_formats=markdown` (Kanton Zürich) | Full page markdown incl. tables |
| `youcom_search_livecrawl_ai.json` | Same (Kanton Appenzell Innerrhoden) | Returned the "all events" page variant |
| `youcom_research.json` | You.com `POST https://api.you.com/v1/research` | LLM answer with sources; correct for ZH |
| `youcom_runs.json` | You.com `POST https://api.you.com/v1/agents/runs` (`agent=express`) | Did no search, hallucinated (Auffahrt "halbtags", 1. Mai missing) |
| `meteoswiss_stac.json` | STAC `data.geo.admin.ch/api/stac/v1/collections/ch.meteoschweiz.ogd-smn` and item `sma` | Asset list per station |
| `meteoswiss_sma_d_historical_excerpt.csv` | `ogd-smn_sma_d_historical.csv` (excerpt) | Full file 6.46 MB, 1864-01-01 … 2025-12-31 |
| `meteoswiss_meta_stations_excerpt.csv` | `ogd-smn_meta_stations.csv` (excerpt) | Original encoding cp1252 |
| `openrouter_offers.json` | OpenRouter `chat/completions`, `google/gemini-2.5-flash-lite`, strict `json_schema` | 10 offers, 2238 tokens, USD 0.00086, 8.27 s |
