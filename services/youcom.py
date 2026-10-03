"""You.com search (holiday retrieval only) and normalisation into FoundHoliday rows.

One search with `livecrawl=web&livecrawl_formats=markdown` returns the full markdown of
the result pages. Holidays are read from markdown table rows with a full `dd.mm.yyyy`
date; the class of a row comes from feiertagskalender.ch's link titles or class column
(see docs/PLAN.md §4.2). No LLM is involved: parsing is deterministic.
"""

import logging
import os
import re
from datetime import UTC, date, datetime

from domain.models import CANTON_NAMES, FoundHoliday
from services import http

log = logging.getLogger(__name__)

SERVICE = "youcom"
SEARCH_URL = "https://ydc-index.io/v1/search"
TIMEOUT_S = 8
RESULT_COUNT = 5


class YouComUnavailable(http.UpstreamError):
    """Not configured (no API key) or quota exhausted; `reason` says which."""


def api_key() -> str | None:
    key = (os.environ.get("YDC_API_KEY") or "").strip()
    return key or None


def build_query(municipality: str, canton: str, year: int) -> str:
    return f"Feiertage {municipality} Kanton {CANTON_NAMES[canton]} {year}"


def fetch_pages(query: str) -> list[dict]:
    """[{url, title, markdown}] of the result pages. Raises UpstreamError / YouComUnavailable."""
    key = api_key()
    if not key:
        raise YouComUnavailable(SERVICE, "no_api_key")
    try:
        body = http.get_json(SERVICE, SEARCH_URL, {
            "query": query,
            "count": str(RESULT_COUNT),
            "country": "CH",
            "language": "de",
            "livecrawl": "web",
            "livecrawl_formats": "markdown",
        }, headers={"X-API-Key": key}, timeout=TIMEOUT_S)
    except http.UpstreamError as exc:
        if exc.reason in ("HTTP 402", "HTTP 429"):
            raise YouComUnavailable(SERVICE, "quota") from exc
        raise
    web = ((body or {}).get("results") or {}).get("web") or []
    pages = []
    for w in web:
        md = ((w or {}).get("contents") or {}).get("markdown")
        if isinstance(md, str) and w.get("url"):
            pages.append({"url": w["url"], "title": w.get("title") or "", "markdown": md})
    return pages


# --- parsing ---------------------------------------------------------------------------------

_ROW = re.compile(r"^\|\s*(\d{2})\.(\d{2})\.(\d{4})\s*\|(.*)\|\s*$")
# Name-first tables (ferienwiki.ch, localcities.ch …): "| Sechseläuten | 20.04.2026 (Montag) |"
_NAME_ROW = re.compile(r"^\|\s*([^|]*?[A-Za-zÄÖÜäöüéè]{3,}[^|]*?)\s*\|\s*(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s*\([^)|]*\))?\s*\|")
_LINK = re.compile(r'\[([^\]]+)\]\((?:[^()\s]+)(?:\s+"([^"]*)")?\)')
_SHARE = re.compile(r"^(<\s*)?(\d+(?:\.\d+)?)\s*%$")
_CLASS_NUM = re.compile(r"^\[?([1-5])\]?")
_WEEKDAY = re.compile(r"^(Mo|Di|Mi|Do|Fr|Sa|So)$")


def _kind_from_title(title: str) -> str | None:
    t = (title or "").casefold()
    if not t:
        return None
    if "nur teilweise" in t:
        return "partial"
    if "ereignistag" in t:
        return "event"
    if "nicht anerkannt" in t:
        return "unofficial"
    if "halb" in t:
        return "half"
    if "gleichgestellt" in t or "anerkannt" in t or "gesetzlich" in t:
        return "legal"
    return None


_CLASS_KIND = {"1": "legal", "2": "legal", "3": "half", "4": "unofficial", "5": "event"}


def page_matches(title: str, year: int, municipality: str, canton: str) -> bool:
    """The page is about our year and our canton or municipality (titles like
    'Feiertage Kanton Zürich 2027 (…)', 'Feiertage Stadt Bern 2027')."""
    t = (title or "").casefold()
    names = {municipality.casefold(), CANTON_NAMES[canton].casefold()}
    return str(year) in t and any(n in t for n in names)


def page_scope(title: str, municipality: str) -> str:
    """Which area a page covers, from titles like 'Feiertage Gemeinde Baden 2026',
    'Feiertage Bezirk Baden 2026', 'Feiertage Kanton Aargau 2026'."""
    t = (title or "").casefold()
    m = municipality.casefold()
    if any(f"{w} {m}" in t for w in ("gemeinde", "stadt")):
        return "municipality"
    if any(w in t for w in ("bezirk", "verwaltungskreis", "region", "wahlkreis", "amt ")):
        return "region"
    if "kanton" in t:
        return "canton"
    return "other"


def parse_row(line: str) -> tuple[date, str, str, float | None] | None:
    """(date, name, kind, share %) of one markdown table row, or None."""
    m = _ROW.match(line.strip())
    if not m:
        return None
    try:
        day = date(int(m[3]), int(m[2]), int(m[1]))
    except ValueError:
        return None
    cells = [c.strip() for c in m[4].split("|")]
    name, kind, share = None, None, None
    for cell in cells:
        if not cell or _WEEKDAY.match(cell) or cell.isdigit():
            continue
        link = _LINK.search(cell)
        if name is None:
            if link:
                name, kind = link[1].strip(), _kind_from_title(link[2] or "")
            elif re.search(r"[A-Za-zÄÖÜäöüéè]{3,}", cell):
                name = cell
            continue
        # cells after the name: class number ("[2](…)") or share ("26.9 %", "<1 %", "n.v.")
        s = _SHARE.match(cell)
        if s:
            share = 0.5 if s[1] else float(s[2])      # "<1 %" → 0.5 %
            continue
        c = _CLASS_NUM.match(link[1] if link else cell)
        if c and kind is None:
            kind = _CLASS_KIND[c[1]]
    if not name:
        return None
    return day, " ".join(name.split()), kind or "unclassified", share


def parse_name_row(line: str) -> tuple[date, str] | None:
    """(date, name) of a name-first table row, or None. These tables carry no
    classification, so their rows are always "unclassified"."""
    m = _NAME_ROW.match(line.strip())
    if not m:
        return None
    try:
        day = date(int(m[4]), int(m[3]), int(m[2]))
    except ValueError:
        return None
    link = _LINK.search(m[1])
    name = " ".join((link[1] if link else m[1]).split())
    return day, name


def parse_pages(pages: list[dict], *, year: int, municipality: str, canton: str,
                retrieved_at: str | None = None) -> list[FoundHoliday]:
    """FoundHoliday rows for `year` from pages about our canton/municipality.
    Event days are dropped; duplicates keep the most specific classification."""
    retrieved_at = retrieved_at or datetime.now(UTC).isoformat(timespec="seconds")
    best: dict[tuple, FoundHoliday] = {}
    rank = {"unclassified": 0, "partial": 1, "unofficial": 2, "half": 3, "legal": 4}
    for page in pages:
        if not page_matches(page["title"], year, municipality, canton):
            continue
        legal_page = "gesetzliche feiertage" in page["title"].casefold()
        scope = page_scope(page["title"], municipality)
        for line in page["markdown"].splitlines():
            row = parse_row(line)
            if not row:
                named = parse_name_row(line)
                if not named:
                    continue
                # No classification; "Gesetzliche Feiertage" titles on such pages also list
                # customary days (Sechseläuten), so they are never promoted to "legal".
                row = (named[0], named[1], "unclassified", None)
                legal_row = False
            else:
                legal_row = legal_page
            day, name, kind, share = row
            if day.year != year or kind == "event":
                continue
            if kind == "unclassified" and legal_row:
                kind = "legal"       # "(Gesetzliche Feiertage)" pages list legal holidays only
            found = FoundHoliday(day, name, kind, share, page["url"], page["title"], retrieved_at, scope)
            # Rows of a municipality page are kept separately: they decide whether a
            # baseline holiday applies in our municipality (see merge_holidays).
            key = (day, name.casefold(), scope == "municipality")
            if key not in best or rank[kind] > rank[best[key].kind]:
                best[key] = found
    return sorted(best.values(), key=lambda f: (f.date, f.name))
