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


@bp.get("/api/locations/at")
def at_point():
    """The place at a map point (click on the map), or {"location": null}."""
    try:
        lat = float(request.args.get("lat", ""))
        lon = float(request.args.get("lon", ""))
    except ValueError:
        raise ApiError(400, "invalid_point", "Ungültiger Punkt.")
    if not (45.5 <= lat <= 48.0 and 5.8 <= lon <= 10.6):
        return jsonify({"location": None})
    try:
        loc = geoadmin.locate(lat, lon)
    except UpstreamError as exc:
        log.warning("Reverse lookup failed: %s", exc)
        raise ApiError(503, "geoadmin_unavailable",
                       "Der Ort konnte gerade nicht bestimmt werden. Die Suche oben funktioniert weiterhin.")
    return jsonify({"location": loc.to_dict() if loc else None})
