"""Deterministic reference calendar (D1 baseline): cantonal public holidays from the
`holidays` package. No network access; the package computes dates locally."""

from datetime import date
from importlib.metadata import version

import holidays as holidays_lib

from domain.models import CANTONS, Holiday

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
