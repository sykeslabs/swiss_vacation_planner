"""HTML page and health check."""

from flask import Blueprint, jsonify, render_template

bp = Blueprint("pages", __name__)


@bp.get("/")
def index():
    return render_template("index.html")


@bp.get("/healthz")
def healthz():
    # Liveness only: deliberately makes no external calls.
    return jsonify({"status": "ok"})
