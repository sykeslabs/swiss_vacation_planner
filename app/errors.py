"""Uniform error responses: ``{"error": {"code", "message"}}``. Never leaks stack traces."""

import logging

from flask import Flask, jsonify, request
from werkzeug.exceptions import HTTPException

log = logging.getLogger(__name__)

# User-facing messages (Swiss Standard German).
MESSAGES = {
    400: "Ungültige Anfrage.",
    404: "Nicht gefunden.",
    405: "Methode nicht erlaubt.",
    500: "Ein interner Fehler ist aufgetreten. Bitte versuche es später erneut.",
}


class ApiError(Exception):
    """Raised by routes for expected, user-facing errors."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def error_response(status: int, code: str, message: str):
    return jsonify({"error": {"code": code, "message": message}}), status


def _wants_json() -> bool:
    return request.path.startswith("/api/") or request.path == "/healthz"


def register_error_handlers(app: Flask) -> None:
    @app.errorhandler(ApiError)
    def handle_api_error(err: ApiError):
        return error_response(err.status, err.code, err.message)

    @app.errorhandler(HTTPException)
    def handle_http_error(err: HTTPException):
        status = err.code or 500
        if not _wants_json():
            return err
        return error_response(status, (err.name or "error").lower().replace(" ", "_"),
                              MESSAGES.get(status, MESSAGES[500]))

    @app.errorhandler(Exception)
    def handle_unexpected(err: Exception):
        log.exception("Unhandled error on %s", request.path)
        return error_response(500, "internal_error", MESSAGES[500])
