"""POST /api/optimize — per-location day model, vacation candidates and summary.

Holidays: the deterministic baseline without the disputed holidays the user did not switch
on (`disabled_holidays`), plus the optional (web-only) holidays the user switched on
(`extra_holidays`, from GET /api/holidays), plus the user's own whole days off
(`custom_holidays`, global for every location). This route makes no network calls.
"""

from datetime import UTC, datetime

from flask import Blueprint, jsonify, request

from app.validation import parse_optimize
from domain.calendar import build_days, window_years
from domain.holidays import USER_SOURCE, WEB_SOURCE, baseline_holidays, holiday_key
from domain.models import CalendarConfig, Holiday
from domain.vacation_optimizer import find_candidates, summarize, within_budget, zero_cost_runs
from domain.working_days import parse_working_days

bp = Blueprint("planner", __name__)


@bp.post("/api/optimize")
def optimize():
    req = parse_optimize(request.get_json(silent=True))
    config = CalendarConfig(
        year=req.year,
        working_days=parse_working_days(req.working_days),
        half_days=dict(req.half_days),
    )
    now = datetime.now(UTC)
    retrieved_at = now.isoformat(timespec="seconds")
    today = now.date()

    per_location = {}
    for loc_in in req.locations:
        loc = loc_in.to_domain()
        switched_off = set(req.disabled_holidays.get(loc.id, []))
        holidays = [h for h in baseline_holidays(loc.canton, window_years(req.year), retrieved_at)
                    if holiday_key(h) not in switched_off]
        holidays += [Holiday(
            date=x.date, name=x.name, type="local", jurisdiction="municipality",
            canton=loc.canton, municipality=loc.municipality, source=WEB_SOURCE, source_url="",
            source_title="von dir aktiviert", retrieved_at=retrieved_at, confidence="low",
            work_fraction=x.work_fraction, enabled=True,
        ) for x in req.extra_holidays.get(loc.id, [])]
        holidays += [Holiday(
            date=x.date, name=x.name, type="custom", jurisdiction="user",
            canton=None, municipality=None, source=USER_SOURCE, source_url="",
            source_title="von dir hinzugefügt", retrieved_at=retrieved_at, confidence="high",
        ) for x in req.custom_holidays]
        days = build_days(config, holidays)
        candidates = find_candidates(days, location_id=loc.id, year=req.year, today=today)
        budget = req.vacation_budget
        per_location[loc.id] = {
            "days": [d.to_dict() for d in days],
            "holidays": [h.to_dict() for h in sorted(holidays, key=lambda h: (h.date, h.name))],
            "warnings": [],
            "candidates": [c.to_dict() for c in candidates if within_budget(c, year=req.year, budget=budget)],
            "zero_cost": [r.to_dict() for r in zero_cost_runs(days, year=req.year, today=today)],
            "summary": summarize(days, candidates, year=req.year, budget=budget),
        }
    return jsonify({"year": req.year, "per_location": per_location})
