"""Contact and donation details for the "Über Adam" help modal.

Read from environment variables only (never hard-coded). Invalid or missing values are
dropped so the modal simply hides that element.
"""

import logging
import os
import re

log = logging.getLogger(__name__)

_EMAIL_RE = re.compile(r"^[^@\s<>\"']{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,}$")
_URL_RE = re.compile(r"^https?://[^\s<>\"']{3,500}$")
MAX_LABEL_LEN = 40


def _env(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def _checked(name: str, pattern: re.Pattern) -> str | None:
    value = _env(name)
    if not value:
        return None
    if not pattern.match(value):
        log.warning("%s is set but invalid; the element stays hidden.", name)
        return None
    return value


def about_config() -> dict:
    """{"contact_email", "website_url", "donate_url", "donate_label"}; missing values are None."""
    donate_url = _checked("ADAM_DONATE_URL", _URL_RE)
    label = " ".join(_env("ADAM_DONATE_LABEL").split())[:MAX_LABEL_LEN]
    return {
        "contact_email": _checked("ADAM_CONTACT_EMAIL", _EMAIL_RE),
        "website_url": _checked("ADAM_WEBSITE_URL", _URL_RE),
        "donate_url": donate_url,
        "donate_label": (label or "Spenden") if donate_url else None,
    }
