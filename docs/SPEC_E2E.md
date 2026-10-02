# Swiss Vacation Planner — Extended API, Supabase & Travel Architecture

## Purpose

Extend the existing Swiss Vacation Planner architecture with a scalable persistence/cache layer and a staged international travel-data architecture.

The core principle must remain:

> **External APIs provide facts → deterministic Python logic performs calculations → OpenRouter synthesizes factual inputs → Supabase persists/caches data.**

Do not turn the application into an LLM-driven calculator or allow AI-generated information to become a source of truth.

---

# 1. Supabase Integration

Introduce Supabase as an optional persistence, caching, and history layer.

Supabase must NOT contain the core vacation optimization logic.

## Responsibilities

Use Supabase for:

* saved vacation planners
* user preferences
* travel-search history
* generated travel offers
* API response caching
* eventually user accounts / profiles
* eventually saved trips

The application must remain functional for deterministic vacation planning if Supabase is unavailable.

## Initial schema

Design a small schema that can evolve:

```text
profiles
planners
planner_locations
planner_settings

holiday_cache
weather_cache

travel_searches
travel_offers
```

Avoid unnecessary tables during the initial implementation.

## Cache examples

### holiday_cache

```text
municipality
canton
year
data
retrieved_at
```

Cache key must uniquely identify the requested municipality/canton/year combination.

### weather_cache

```text
location
start_date
end_date
source
data
retrieved_at
```

The cache key must include every input that materially affects the result.

### travel offers

Potentially cache based on:

```text
country
country_code
vacation_type
start_date
end_date
preferences
```

Do not return stale data indefinitely. Make cache lifetime configurable.

## Architecture

Use:

```text
External API
    ↓
Provider-specific service
    ↓
Normalize response
    ↓
Validate data
    ↓
Supabase cache
    ↓
Domain logic / application
```

Do not place external API calls directly inside frontend code.

Never expose:

* API secrets
* Supabase service-role key
* OpenRouter API key
* Amadeus credentials
* You.com API key

to the browser.

Use Supabase RLS appropriately if user-specific data is introduced.

---

# 2. International Weather — Open-Meteo

Add Open-Meteo as the international weather provider.

Keep the existing separation:

```text
MeteoSwiss
    → Swiss locations

Open-Meteo
    → international destinations
```

Open-Meteo can provide:

* historical weather
* forecasts
* temperature
* precipitation
* sunshine
* other relevant weather variables

Do not replace MeteoSwiss for Swiss-specific historical analysis unless there is an explicit documented reason.

Create a dedicated service module, for example:

```text
services/open_meteo.py
```

Normalize Open-Meteo responses into an internal weather model before passing data to the domain layer.

Potential future workflow:

```text
Swiss vacation period
        ↓
candidate international destinations
        ↓
Open-Meteo historical weather
        ↓
factual destination comparison
```

Do not allow the LLM to invent weather statistics.

---

# 3. Amadeus — Actual Travel Data

Investigate Amadeus as a future travel-data provider.

Potential responsibilities:

* flights
* hotels
* activities
* destination information
* potentially transfers/cars where appropriate

Architecture:

```text
Selected vacation period
        ↓
Vacation profile
        ↓
Country
        ↓
Candidate destinations
        ↓
Amadeus
   ├── flights
   ├── hotels
   └── activities
        ↓
validated travel options
```

The distinction between AI-generated ideas and actual travel inventory must remain explicit.

### AI-generated idea

Example:

> Consider Crete for a beach holiday.

### Actual travel option

Example:

```text
Zurich → Heraklion
06.05.2027 → 09.05.2027
Flight option
Hotel option
Current price
```

Never allow the LLM to fabricate:

* flight availability
* hotel availability
* prices
* booking references
* booking URLs

If Amadeus is unavailable, the planner must continue working.

Do not implement Amadeus merely for architectural completeness. Investigate API access, pricing, licensing, rate limits, and actual usefulness before integrating it.

---

# 4. REST Countries — Country Normalization

Use REST Countries or an equivalent authoritative country-data service for canonical country information.

The world-map country selection must produce a normalized country object such as:

```json
{
  "country": "Greece",
  "country_code": "GR"
}
```

Potential additional data:

```text
currency
capital
region
subregion
languages
flag
coordinates
```

Do not use an LLM to resolve country identity when a deterministic country dataset can do so.

The country code should become the canonical identifier used by downstream services.

---

# 5. OpenStreetMap / Overpass — Destination Intelligence

Investigate OpenStreetMap / Overpass for factual destination POIs.

Potential categories:

* beaches
* hiking trails
* viewpoints
* museums
* restaurants
* castles
* lakes
* attractions
* ski resorts
* villages
* landmarks

Architecture:

```text
Country
   ↓
Candidate destination
   ↓
OSM / Overpass
   ↓
real geographic POIs
   ↓
OpenRouter
   ↓
structured travel suggestions
```

The LLM should synthesize factual POI information rather than inventing attractions.

Create a dedicated service module if implemented:

```text
services/osm.py
```

Do not make OSM/Overpass a hard dependency of the core Swiss vacation planner.

---

# 6. Exchange Rates

Investigate a dedicated exchange-rate API for travel-budget calculations.

Do not ask OpenRouter to perform authoritative currency conversion.

Example:

```text
EUR 850
    ↓
exchange-rate API
    ↓
CHF ~790
```

Normalize monetary values internally.

Potential normalized structure:

```json
{
  "amount": 850,
  "currency": "EUR",
  "amount_chf": 790,
  "rate": 0.929,
  "retrieved_at": "..."
}
```

The exact exchange rate must come from the configured provider.

If no exchange-rate service is available, clearly distinguish unavailable conversion from an estimated value.

---

# 7. Sunrise / Sunset / Daylight

Investigate a sunrise/sunset API as an optional destination-data source.

This is particularly relevant for:

* hiking
* skiing
* nature
* photography
* northern destinations

Normalize:

```text
date
sunrise
sunset
daylight_duration
location
source
```

Example:

```text
Destination
06.05.2027

Sunrise: 05:58
Sunset: 20:42
Daylight: 14h 44m
```

Do not let the LLM calculate authoritative daylight values.

---

# 8. Expanded Travel Architecture

The eventual travel-discovery pipeline should be capable of evolving toward:

```text
1. Configure vacation type
        ↓
2. Configure Swiss planner
        ↓
3. Deterministic vacation optimization
        ↓
4. Select vacation period
        ↓
5. Ask whether travel offers are desired
        ↓
6. Display world map
        ↓
7. Select country
        ↓
8. Normalize country
        ↓
9. Find candidate destinations
        ↓
10. Collect factual data
        ├── Open-Meteo
        ├── Amadeus
        ├── OSM
        ├── REST Countries
        ├── Exchange rates
        └── Sunrise/Sunset
        ↓
11. Check Supabase cache
        ↓
12. OpenRouter synthesis
        ↓
13. Validate structured JSON
        ↓
14. Store result in Supabase
        ↓
15. Display travel suggestions
```

Important:

**Do not call every API for every request.**

Only collect data relevant to the user's selected vacation type and requested workflow.

For example:

```text
Beach
→ weather
→ flights
→ hotels
→ beaches / POIs

Hiking
→ weather
→ daylight
→ hiking POIs
→ flights/hotels if implemented

City
→ flights
→ hotels
→ museums / attractions
→ weather
```

This reduces:

* latency
* API usage
* costs
* unnecessary complexity

---

# 9. OpenRouter's Role

OpenRouter remains a synthesis layer.

It may receive structured factual information such as:

```json
{
  "country": "Greece",
  "destination": "Crete",
  "vacation_type": "beach",
  "dates": {
    "start": "2027-05-06",
    "end": "2027-05-09"
  },
  "weather": {},
  "poi_data": [],
  "flight_options": [],
  "hotel_options": []
}
```

It can then produce structured travel suggestions.

It must NOT be treated as the authoritative source for:

* holidays
* dates
* vacation-day calculations
* weather
* exchange rates
* flight availability
* hotel availability
* POI existence
* prices

Validate every LLM response before returning it to the frontend.

---

# 10. Travel Offer Data Model

Keep the previously defined structured offer model, but make it extensible:

```json
{
  "title": "...",
  "destination": "...",
  "description": "...",
  "vacation_type": "beach",
  "estimated_budget_chf": 0,
  "recommended_duration_days": 0,
  "why_it_fits": "...",
  "best_travel_window": "...",
  "transport_hint": "...",
  "source_urls": []
}
```

When actual provider data becomes available, extend it with clearly separated factual fields:

```json
{
  "flight_options": [],
  "hotel_options": [],
  "activities": [],
  "weather_summary": {},
  "poi_summary": {}
}
```

Do not mix estimated AI-generated information with confirmed provider data without clearly identifying the source.

---

# 11. Provider Abstraction

Use provider-specific service modules.

Example:

```text
services/
├── geoadmin.py
├── youcom.py
├── meteoswiss.py
├── open_meteo.py
├── openrouter.py
├── rest_countries.py
├── amadeus.py
├── osm.py
├── exchange_rates.py
└── daylight.py
```

Do not embed provider-specific HTTP calls throughout Flask routes.

Routes should call application/domain services rather than directly constructing external API requests.

---

# 12. Failure Isolation

Every external provider must fail independently.

Examples:

```text
OpenRouter unavailable
→ Swiss planner still works

MeteoSwiss unavailable
→ optimizer still works

You.com unavailable
→ map/search still works

Amadeus unavailable
→ AI travel ideas may still work

OSM unavailable
→ travel suggestions can still work

Supabase unavailable
→ deterministic planner still works
```

Return useful, user-friendly errors.

Never expose:

* stack traces
* API credentials
* internal HTTP details
* provider secrets

to the frontend.

---

# 13. Caching Strategy

Use caching wherever requests are deterministic/repeatable.

Priorities:

### High priority

* Swiss holidays
* historical weather
* country metadata

### Medium priority

* POIs
* daylight data

### Carefully controlled

* flights
* hotels
* actual travel inventory

Actual travel availability and prices become stale quickly and should have much shorter cache lifetimes.

Cache keys must contain all materially relevant inputs.

Do not return cached data while pretending it is live availability.

---

# 14. Implementation Roadmap

Do not implement every integration simultaneously.

Use the following staged roadmap:

## V1 — Swiss Planner

Implement:

* GeoAdmin
* You.com
* MeteoSwiss
* deterministic vacation optimizer
* map/satellite
* Swiss town/ZIP search
* multiple locations
* working-day configuration
* half-days
* yearly calendar
* month zoom/detail
* historical Swiss weather comparison

## V2 — AI Travel Discovery

Implement:

* vacation type
* selected vacation period
* offer modal
* world map
* country selection
* REST Countries normalization
* OpenRouter
* structured travel offers

## V3 — International Weather

Add:

* Open-Meteo
* historical destination weather
* destination weather comparison
* optional forecasts

## V4 — Actual Travel Data

Investigate and, if technically/economically appropriate, integrate:

* Amadeus flights
* Amadeus hotels
* Amadeus activities

## V5 — Destination Intelligence

Investigate:

* OSM
* Overpass
* destination POIs
* beaches
* hiking
* attractions
* ski areas
* restaurants

## V6 — Persistence

Add Supabase:

* PostgreSQL
* caching
* saved planners
* user preferences
* travel history
* generated offer history
* authentication when required

## V7 — Rich Travel Profile

Add:

* budget
* travellers
* departure airport
* accommodation preferences
* meal preferences
* exchange rates
* daylight information

---

# 15. Important Scope Rule

Do not add APIs simply because they are technically interesting.

For every proposed integration, evaluate:

1. What user problem does it solve?
2. Is the data actually required?
3. Is there a reliable provider?
4. What does it cost?
5. What are the rate limits?
6. Does it introduce licensing restrictions?
7. Can the application work without it?
8. Can the data be cached?
9. Does it materially improve the product?

The project should prioritize **empirical usefulness and reliability over architectural sophistication**.

---

# 16. Acceptance Criteria

The extended architecture is considered correctly designed when:

* Supabase is clearly separated from domain logic.
* The deterministic vacation optimizer has no dependency on an LLM.
* External providers are isolated in dedicated service modules.
* OpenRouter is explicitly a synthesis layer.
* Country identity is deterministic.
* International weather is separated from Swiss weather.
* Actual travel inventory is separated from AI-generated ideas.
* API failures are isolated.
* API credentials remain server-side.
* Cache keys contain all relevant inputs.
* Stale travel inventory is not presented as live data.
* The core planner remains useful without optional travel APIs.
* New providers can be added without rewriting the optimizer.
* The architecture supports future Amadeus/OSM/Open-Meteo integration without requiring a major redesign.
* The application can progressively evolve from a Swiss vacation optimizer into a broader travel-planning product.

## Final architectural principle

The implementation should preserve this separation:

```text
                FACTS
                  │
        ┌─────────┼─────────┐
        ▼         ▼         ▼
     GeoAdmin   You.com  MeteoSwiss
        │         │         │
        ▼         ▼         ▼
    Open-Meteo  Amadeus    OSM
        │         │         │
        └─────────┼─────────┘
                  ▼
           NORMALIZED DATA
                  │
                  ▼
        ┌───────────────────┐
        │ Python Domain     │
        │ Logic             │
        │                   │
        │ Vacation optimizer│
        │ Calendar          │
        │ Statistics       │
        └─────────┬─────────┘
                  │
                  ▼
           SELECTED PERIOD
                  │
                  ▼
        ┌───────────────────┐
        │ OpenRouter        │
        │ Synthesis only    │
        └─────────┬─────────┘
                  │
                  ▼
          VALIDATED OUTPUT
                  │
                  ▼
             Supabase
       cache / history / users
```

**Never reverse this dependency direction.**
