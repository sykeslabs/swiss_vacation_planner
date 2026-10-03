"""Local customary days (Sechseläuten, Knabenschiessen, Zibelemärit): not public holidays,
but many employers give the afternoon off. Pure and deterministic: a small curated list
(data/local_days.json) with date rules; the web search only corroborates them.

They are optional holidays (enabled=False): they count only when the user switches them on.
"""

import json
import logging
from dataclasses import dataclass
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

from domain.holidays import name_key
from domain.models import FoundHoliday, Holiday

log = logging.getLogger(__name__)

LOCAL_DAYS_FILE = Path(__file__).resolve().parent.parent / "data" / "local_days.json"
MONDAY = 0


def easter_sunday(year: int) -> date:
    """Gregorian Easter Sunday (anonymous Gregorian algorithm)."""
    a, b, c = year % 19, year // 100, year % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = (h + l - 7 * m + 114) % 31 + 1
    return date(year, month, day)


def nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    first = date(year, month, 1)
    return first + timedelta(days=(weekday - first.weekday()) % 7 + 7 * (n - 1))


def _sechselaeuten(year: int) -> date:
    # Third Monday in April; one week earlier if that is the Monday of Holy Week,
    # one week later if it is Easter Monday (e.g. 2019-04-08, 2025-04-28).
    d = nth_weekday(year, 4, MONDAY, 3)
    easter = easter_sunday(year)
    if d == easter - timedelta(days=6):
        return d - timedelta(days=7)
    if d == easter + timedelta(days=1):
        return d + timedelta(days=7)
    return d


def _knabenschiessen(year: int) -> date:
    # Second weekend in September; the Monday after the second Sunday is the day off.
    return nth_weekday(year, 9, 6, 2) + timedelta(days=1)


def _zibelemaerit(year: int) -> date:
    # Fourth Monday in November.
    return nth_weekday(year, 11, MONDAY, 4)


RULES = {"sechselaeuten": _sechselaeuten, "knabenschiessen": _knabenschiessen, "zibelemaerit": _zibelemaerit}


@dataclass(frozen=True)
class LocalDay:
    name: str
    municipality_ids: tuple[int, ...]
    rule: str
    work_fraction: float
    url: str
    note: str


@lru_cache(maxsize=1)
def load_local_days() -> tuple[str, tuple[LocalDay, ...]]:
    """(source name, entries). A missing or broken file only drops these optional days."""
    try:
        data = json.loads(LOCAL_DAYS_FILE.read_text(encoding="utf-8"))
        days = tuple(LocalDay(d["name"], tuple(int(x) for x in d["municipality_ids"]), d["rule"],
                              float(d["work_fraction"]), d["url"], d["note"])
                     for d in data["days"] if d["rule"] in RULES)
        return data["source"], days
    except (OSError, ValueError, KeyError, TypeError) as exc:
        log.warning("Local days list unavailable: %s", exc)
        return "", ()


def local_days_for(municipality_id: int, canton: str, municipality: str, year: int,
                   retrieved_at: str, found: list[FoundHoliday] | None = None) -> list[Holiday]:
    """Optional local days of a municipality in `year`. Web rows with the same name and
    date (any page, any classification) are listed as corroboration."""
    source, entries = load_local_days()
    result = []
    for entry in entries:
        if municipality_id not in entry.municipality_ids:
            continue
        day = RULES[entry.rule](year)
        web = sorted({f.source_url for f in (found or [])
                      if f.date == day and name_key(f.name) == name_key(entry.name)})
        result.append(Holiday(
            date=day, name=entry.name, type="local", jurisdiction="municipality",
            canton=canton, municipality=municipality, source=source, source_url=entry.url,
            source_title=source, retrieved_at=retrieved_at,
            confidence="high" if web else "medium",
            conflict=None, work_fraction=entry.work_fraction, enabled=False,
            corroborated_by=tuple(web), note=entry.note,
        ))
    return result


def with_local_days(merged: list[Holiday], local: list[Holiday]) -> list[Holiday]:
    """Adds the curated local days. A web-only optional holiday with the same name is
    dropped: the curated entry wins (it knows the half day and the exact date rule)."""
    if not local:
        return merged
    keys = {name_key(h.name) for h in local}
    kept = [h for h in merged if not (h.enabled is False and name_key(h.name) in keys)]
    return sorted([*kept, *local], key=lambda h: (h.date, h.name))
