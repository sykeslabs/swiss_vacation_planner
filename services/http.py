"""Shared HTTP helper: one session, bounded timeouts, failures mapped to UpstreamError."""

import requests

DEFAULT_TIMEOUT_S = 8

_session = requests.Session()
_session.headers["User-Agent"] = "swiss-vacation-planner/0.1"


class UpstreamError(Exception):
    """An external service failed. `service` names it; `reason` is for logs, not for users."""

    def __init__(self, service: str, reason: str):
        super().__init__(f"{service}: {reason}")
        self.service = service
        self.reason = reason


def get_json(service: str, url: str, params: dict | None = None, *,
             headers: dict | None = None, timeout: float = DEFAULT_TIMEOUT_S):
    try:
        res = _session.get(url, params=params, headers=headers, timeout=timeout)
    except requests.RequestException as exc:
        raise UpstreamError(service, type(exc).__name__) from exc
    if res.status_code >= 400:
        raise UpstreamError(service, f"HTTP {res.status_code}")
    try:
        return res.json()
    except ValueError as exc:
        raise UpstreamError(service, "invalid JSON") from exc
