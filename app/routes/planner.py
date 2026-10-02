"""POST /api/optimize — per-location day model. Candidates and summary follow in M5.

Holidays: the deterministic baseline, plus the optional (web-only) holidays the user
enabled (`extra_holidays`, from GET /api/holidays). This route makes no network calls.
"""

from datetime import UTC, datetime

from flask import Blueprint, jsonify, request

from app.validation import parse_optimize
from domain.calendar import build_days, window_years
from domain.holidays import WEB_SOURCE, baseline_holidays
from domain.models import CalendarConfig, Holiday
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
    retrieved_at = datetime.now(UTC).isoformat(timespec="seconds")

    per_location = {}
    for loc_in in req.locations:
        loc = loc_in.to_domain()
        holidays = baseline_holidays(loc.canton, window_years(req.year), retrieved_at)
        holidays += [Holiday(
            date=x.date, name=x.name, type="local", jurisdiction="municipality",
            canton=loc.canton, municipality=loc.municipality, source=WEB_SOURCE, source_url="",
            source_title="von dir aktiviert", retrieved_at=retrieved_at, confidence="low",
            work_fraction=x.work_fraction, enabled=True,
        ) for x in req.extra_holidays.get(loc.id, [])]
        days = build_days(config, holidays)
        per_location[loc.id] = {
            "days": [d.to_dict() for d in days],
            "holidays": [h.to_dict() for h in sorted(holidays, key=lambda h: (h.date, h.name))],
            "warnings": [],
            "candidates": [],       # M5
            "summary": None,        # M5
        }
    return jsonify({"year": req.year, "per_location": per_location})
