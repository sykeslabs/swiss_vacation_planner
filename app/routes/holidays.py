"""GET /api/holidays — baseline holidays of one location and year, checked against You.com.

You.com failing (not configured, quota, outage, no usable page) never fails this
endpoint: the baseline is returned with a warning (CLAUDE.md rule 8).
"""

import logging
from datetime import UTC, datetime

from flask import Blueprint, jsonify, request

from app.errors import ApiError
from app.validation import parse_holidays_query
from domain.holidays import baseline_holidays, holiday_key, merge_holidays
from services import youcom
from services.cache import TTLCache
from services.http import UpstreamError

log = logging.getLogger(__name__)

bp = Blueprint("holidays", __name__)

CACHE_TTL_S = 24 * 3600
FAILURE_TTL_S = 10 * 60          # retry a failed lookup only after 10 min (free tier: 100/day)
_cache = TTLCache(CACHE_TTL_S, max_items=1024)
_failures = TTLCache(FAILURE_TTL_S, max_items=1024)

_FAILURE_WARNINGS = {
    "no_api_key": ("youcom_not_configured",
                   "Lokale Feiertage werden nicht geprüft (Websuche nicht eingerichtet). "
                   "Es gilt der kantonale Referenzkalender."),
    "quota": ("youcom_quota",
              "Tageslimit der Websuche erreicht. Es gilt der kantonale Referenzkalender."),
}
_UNAVAILABLE = ("youcom_unavailable",
                "Die Websuche ist im Moment nicht erreichbar. Es gilt der kantonale Referenzkalender.")


def cache_key(municipality_id: int, canton: str, year: int) -> tuple:
    return municipality_id, canton, year


def _web_lookup(q) -> tuple[list | None, dict | None]:
    """(found rows, None) or (None, warning). Results and failures are cached."""
    key = cache_key(q.municipality_id, q.canton, q.year)
    cached = _cache.get(key)
    if cached is not None:
        return cached, None
    failed = _failures.get(key)
    if failed is not None:
        return None, failed
    try:
        pages = youcom.fetch_pages(youcom.build_query(q.municipality, q.canton, q.year))
    except UpstreamError as exc:
        code, message = _FAILURE_WARNINGS.get(exc.reason, _UNAVAILABLE)
        log.warning("You.com lookup failed for %s: %s", key, exc.reason)
        warning = {"code": code, "message": message}
        _failures.set(key, warning)
        return None, warning
    found = youcom.parse_pages(pages, year=q.year, municipality=q.municipality, canton=q.canton)
    _cache.set(key, found)
    return found, None


@bp.get("/api/holidays")
def holidays():
    q = parse_holidays_query(request.args)
    retrieved_at = datetime.now(UTC).isoformat(timespec="seconds")
    try:
        baseline = baseline_holidays(q.canton, [q.year], retrieved_at)
    except ValueError:
        raise ApiError(400, "invalid_canton", "Unbekannter Kanton.")

    found, warning = _web_lookup(q)
    warnings = [warning] if warning else []
    if found is None:
        merged = baseline
    else:
        merged = merge_holidays(baseline, found, year=q.year, canton=q.canton, municipality=q.municipality)
        if not found:
            warnings.append({"code": "youcom_no_data",
                             "message": f"Die Websuche fand keine Feiertagsliste für {q.municipality} {q.year}. "
                                        "Es gilt der kantonale Referenzkalender."})
        conflicts = [h for h in merged if h.conflict and h.enabled]
        if conflicts:
            warnings.append({"code": "holiday_conflict",
                             "message": f"Bei {len(conflicts)} Feiertag(en) widersprechen sich die Quellen."})

    confirmed = sum(1 for h in merged if h.confidence == "high")
    optional = sum(1 for h in merged if not h.enabled)
    titles = {}
    for h in merged:
        for url in (h.source_url, *h.corroborated_by):
            if url:
                titles.setdefault(url, h.source_title if url == h.source_url else "")
    sources = sorted(titles.items())
    return jsonify({
        "year": q.year,
        "location_id": q.location_id,
        "holidays": [{**h.to_dict(), "key": holiday_key(h)} for h in merged],
        "warnings": warnings,
        "summary": {"confirmed": confirmed, "optional": optional, "checked": found is not None},
        "sources": [{"url": u, "title": t} for u, t in sources],
    })
