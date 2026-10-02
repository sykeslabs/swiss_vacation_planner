"""Holidays (D1 hybrid).

- Baseline: cantonal public holidays from the `holidays` package (deterministic, local).
- Merge: web-found rows (You.com, parsed in services/youcom.py) confirm or flag the
  baseline; holidays only found on the web are shown but disabled until the user
  enables them. Disagreements are flagged, never resolved automatically.
Pure functions: no network access, no services import.
"""

import unicodedata
from dataclasses import replace
from datetime import date
from importlib.metadata import version

import holidays as holidays_lib

from domain.models import CANTONS, FoundHoliday, Holiday

SOURCE = "Referenzkalender (Python-Paket holidays)"
SOURCE_URL = "https://github.com/vacanza/holidays"


def _source_title() -> str:
    return f"holidays {version('holidays')}, Schweiz, Kategorie public"


def _expand(calendar) -> dict[date, list[str]]:
    # The package joins several names on one date with "; ".
    return {d: [n.strip() for n in names.split(";") if n.strip()] for d, names in calendar.items()}


def baseline_holidays(canton: str, years: list[int], retrieved_at: str) -> list[Holiday]:
    """Public holidays for `canton` in `years`, sorted by date then name.

    Days that are public holidays in every canton are tagged "national", the rest "canton".
    Confidence is "medium": the baseline isn't corroborated yet (that is M4's job).
    """
    if canton not in CANTONS:
        raise ValueError(f"unknown canton: {canton!r}")
    years = sorted(set(years))
    cantonal = _expand(holidays_lib.country_holidays(
        "CH", subdiv=canton, years=years, categories=("public",), language="de"))
    national = _expand(holidays_lib.country_holidays(
        "CH", years=years, categories=("public",), language="de"))

    title = _source_title()
    result = []
    for day, names in cantonal.items():
        for name in names:
            is_national = name in national.get(day, [])
            result.append(Holiday(
                date=day,
                name=name,
                type="public",
                jurisdiction="national" if is_national else "canton",
                canton=canton,
                municipality=None,
                source=SOURCE,
                source_url=SOURCE_URL,
                source_title=title,
                retrieved_at=retrieved_at,
                confidence="medium",
            ))
    result.sort(key=lambda h: (h.date, h.name))
    return result


# --- merge with web results ---------------------------------------------------------------

WEB_SOURCE = "Websuche (You.com)"
MIN_PARTIAL_SHARE_PERCENT = 20.0   # "nur teilweise gültig" rows below this belong to other places
SUNDAY = 7

# Different spellings of the same holiday (normalised keys).
_ALIASES = {
    "neujahr": "neujahrstag",
    "nationalfeiertag schweiz": "nationalfeiertag",
    "bundesfeiertag": "nationalfeiertag",
    "schweizer nationalfeiertag": "nationalfeiertag",
    "christi himmelfahrt": "auffahrt",
    "weihnachtstag": "weihnachten",
    "stefanstag": "stephanstag",
    "dreikonigstag": "heilige drei konige",
    "maria aufnahme in den himmel": "maria himmelfahrt",
}

_NOTES = {
    "legal": "Laut Websuche gesetzlicher Feiertag, fehlt aber im Referenzkalender.",
    "half": "Laut Websuche halber Feiertag.",
    "unofficial": "Kein gesetzlicher Feiertag, aber vielerorts arbeitsfrei.",
    "partial": "Nur in Teilen des Kantons gültig ({share} % der Bevölkerung).",
}


def name_key(name: str) -> str:
    """Comparable form of a holiday name: lower case, no accents, single spaces."""
    folded = unicodedata.normalize("NFKD", name.casefold())
    plain = "".join(c for c in folded if not unicodedata.combining(c))
    plain = " ".join(plain.replace(".", " ").replace("-", " ").split())
    return _ALIASES.get(plain, plain)


def _web_only(found: FoundHoliday, canton: str, municipality: str) -> Holiday | None:
    if found.kind not in _NOTES or found.date.isoweekday() == SUNDAY:
        return None
    if found.kind == "partial" and (found.share_percent is None
                                     or found.share_percent < MIN_PARTIAL_SHARE_PERCENT):
        return None
    share = f"{found.share_percent:g}" if found.share_percent is not None else "?"
    return Holiday(
        date=found.date,
        name=found.name,
        type="local" if found.kind == "partial" else "public",
        jurisdiction="municipality" if found.kind == "partial" else "canton",
        canton=canton,
        municipality=municipality if found.kind == "partial" else None,
        source=WEB_SOURCE,
        source_url=found.source_url,
        source_title=found.source_title,
        retrieved_at=found.retrieved_at,
        confidence="low",
        conflict="nur in Websuche gefunden",
        work_fraction=0.5 if found.kind == "half" else 0.0,
        enabled=False,
        note=_NOTES[found.kind].format(share=share),
    )


def merge_holidays(baseline: list[Holiday], found: list[FoundHoliday], *, year: int,
                   canton: str, municipality: str) -> list[Holiday]:
    """Baseline holidays of `year`, confirmed or flagged by the web rows, plus disabled
    web-only holidays. Holidays of other years in `baseline` pass through unchanged."""
    in_year = [h for h in baseline if h.date.year == year]
    other_years = [h for h in baseline if h.date.year != year]
    rows = [f for f in found if f.date.year == year]
    by_date: dict[date, list[FoundHoliday]] = {}
    for f in rows:
        by_date.setdefault(f.date, []).append(f)

    municipality_rows = [f for f in rows if f.page_scope == "municipality"]
    merged = []
    for h in in_year:
        day_rows = by_date.get(h.date, [])
        same_day = [f for f in day_rows if f.kind in ("legal", "half", "unclassified")]
        same_name_elsewhere = [f for f in rows if f.kind in ("legal", "half")
                               and name_key(f.name) == name_key(h.name) and f.date != h.date]
        legal_here = [f for f in municipality_rows if f.date == h.date and f.kind in ("legal", "half")]
        partial = [f for f in day_rows if f.kind == "partial" and f.page_scope != "municipality"]
        doubts = []
        if municipality_rows and not legal_here:
            doubts.append(f"Auf der Seite der Gemeinde {municipality} nicht als Feiertag aufgeführt.")
        if partial and not legal_here and not [f for f in same_day if f.kind != "unclassified"]:
            share = max((f.share_percent for f in partial if f.share_percent is not None), default=None)
            doubts.append("Laut Websuche nur in Teilen der Region gültig"
                          + (f" ({share:g} % der Bevölkerung)." if share is not None else "."))
        if doubts:
            # Flag only (owner decision 2026-10-02): stays on with medium confidence; the
            # user may switch it off. Pages that list it on that day are still shown.
            merged.append(replace(h, conflict=" ".join(doubts), disputed=True,
                                  corroborated_by=tuple(sorted({f.source_url for f in same_day}))))
        elif same_day:
            urls = tuple(sorted({f.source_url for f in same_day}))
            merged.append(replace(h, confidence="high", corroborated_by=urls))
        elif same_name_elsewhere:
            other = min(f.date for f in same_name_elsewhere)
            merged.append(replace(h, conflict=f"Websuche nennt ein anderes Datum: {other:%d.%m.%Y}", disputed=True))
        else:
            merged.append(h)

    baseline_dates = {h.date for h in in_year}
    baseline_names = {name_key(h.name) for h in in_year}
    seen = set()
    for f in rows:
        if f.date in baseline_dates or name_key(f.name) in baseline_names:
            continue                       # confirmation or conflict, handled above
        key = (f.date, name_key(f.name))
        if key in seen:
            continue
        extra = _web_only(f, canton, municipality)
        if extra:
            seen.add(key)
            merged.append(extra)

    return sorted(other_years + merged, key=lambda h: (h.date, h.name))


def holiday_key(h: Holiday) -> str:
    """Stable id for enabling an optional holiday: 'YYYY-MM-DD|Name'."""
    return f"{h.date.isoformat()}|{h.name}"
