"""Weekday codes used by the API ("MON" … "SUN") and their ISO numbers."""

WEEKDAY_CODES = ("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")
_CODE_TO_ISO = {code: i + 1 for i, code in enumerate(WEEKDAY_CODES)}

DEFAULT_WORKING_DAYS = frozenset({1, 2, 3, 4, 5})


def parse_working_days(codes) -> frozenset[int]:
    """["MON", "TUE", …] → {1, 2, …}. Raises ValueError for unknown codes or an empty list."""
    if not codes:
        raise ValueError("working_days must not be empty")
    days = set()
    for code in codes:
        iso = _CODE_TO_ISO.get(str(code).upper())
        if iso is None:
            raise ValueError(f"unknown weekday: {code!r}")
        days.add(iso)
    return frozenset(days)


def weekday_code(iso_weekday: int) -> str:
    return WEEKDAY_CODES[iso_weekday - 1]
