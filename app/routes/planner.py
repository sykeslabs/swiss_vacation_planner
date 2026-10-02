"""POST /api/optimize — per-location day model (M3). Candidates and summary follow in M5."""

from datetime import UTC, datetime

from flask import Blueprint, jsonify, request

from app.validation import parse_optimize
from domain.calendar import build_days, window_years
from domain.holidays import baseline_holidays
from domain.models import CalendarConfig
from domain.working_days import parse_working_days

bp = Blueprint("planner", __name__)

BASELINE_WARNING = {
    "code": "baseline_only",
    "message": "Feiertage aus dem kantonalen Referenzkalender. Lokale Feiertage der Gemeinde "
               "sind noch nicht berücksichtigt.",
}


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
        days = build_days(config, holidays)
        per_location[loc.id] = {
            "days": [d.to_dict() for d in days],
            "holidays": [h.to_dict() for h in holidays],
            "warnings": [BASELINE_WARNING],
            "candidates": [],       # M5
            "summary": None,        # M5
        }
    return jsonify({"year": req.year, "per_location": per_location})
