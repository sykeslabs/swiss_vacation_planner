"""GET /api/locations?q= — Swiss municipality / postcode search."""

import logging

from flask import Blueprint, jsonify, request

from app.errors import ApiError
from services import geoadmin
from services.http import UpstreamError

log = logging.getLogger(__name__)

bp = Blueprint("locations", __name__)

MIN_QUERY_LEN = 3
MAX_QUERY_LEN = 80


@bp.get("/api/locations")
def search():
    q = " ".join((request.args.get("q") or "").split())
    if len(q) < MIN_QUERY_LEN:
        raise ApiError(400, "query_too_short", "Bitte mindestens 3 Zeichen eingeben.")
    if len(q) > MAX_QUERY_LEN:
        raise ApiError(400, "query_too_long", "Der Suchbegriff ist zu lang.")
    try:
        locations = geoadmin.search_locations(q)
    except UpstreamError as exc:
        log.warning("Location search failed: %s", exc)
        raise ApiError(503, "geoadmin_unavailable",
                       "Die Ortssuche ist im Moment nicht erreichbar. Die Karte kannst du weiter nutzen.")
    return jsonify({"locations": [loc.to_dict() for loc in locations]})
