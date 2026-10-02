"""Flask application factory."""

from pathlib import Path

from flask import Flask

from app.errors import register_error_handlers
from app.routes.locations import bp as locations_bp
from app.routes.pages import bp as pages_bp

ROOT = Path(__file__).resolve().parent.parent


def create_app(config: dict | None = None) -> Flask:
    # On Vercel, public/** is served by the CDN at the site root. Locally, Flask
    # serves the same folder at the same URLs so templates need no switch.
    app = Flask(
        __name__,
        static_folder=str(ROOT / "public"),
        static_url_path="",
        template_folder=str(ROOT / "templates"),
    )
    app.json.ensure_ascii = False
    if config:
        app.config.update(config)

    register_error_handlers(app)
    app.register_blueprint(pages_bp)
    app.register_blueprint(locations_bp)
    return app
