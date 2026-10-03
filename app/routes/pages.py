"""HTML page and health check."""

from flask import Blueprint, jsonify, render_template

from app.about import about_config

bp = Blueprint("pages", __name__)


@bp.get("/")
def index():
    # Help modal details are injected as JSON (Jinja's tojson escapes them for <script>).
    return render_template("index.html", about=about_config())


@bp.get("/healthz")
def healthz():
    # Liveness only: deliberately makes no external calls.
    return jsonify({"status": "ok"})
