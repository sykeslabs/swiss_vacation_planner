"""Day model builder: one DayInfo per date for the planned year plus the boundary months
(December of the previous year, January of the next). Pure and deterministic."""

from datetime import date, timedelta

from domain.models import CalendarConfig, DayInfo, Holiday
from domain.working_days import weekday_code


def calendar_window(year: int) -> tuple[date, date]:
    """First and last date shown for a planned year (inclusive)."""
    return date(year - 1, 12, 1), date(year + 1, 1, 31)


def window_years(year: int) -> list[int]:
    return [year - 1, year, year + 1]


def default_half_days(year: int) -> dict[date, float]:
    """D6 defaults: 24.12. and 31.12. are half working days (both Decembers in the window)."""
    return {date(y, 12, d): 0.5 for y in (year - 1, year) for d in (24, 31)}


def build_days(config: CalendarConfig, holidays: list[Holiday]) -> list[DayInfo]:
    start, end = calendar_window(config.year)
    by_date: dict[date, list[Holiday]] = {}
    for h in holidays:
        if start <= h.date <= end:
            by_date.setdefault(h.date, []).append(h)

    days = []
    current = start
    while current <= end:
        iso = current.isoweekday()
        is_working_day = iso in config.working_days
        day_holidays = by_date.get(current, [])
        # A holiday frees the day unless every holiday on it is only a partial one.
        holiday_fraction = min((h.work_fraction for h in day_holidays), default=1.0)
        is_holiday = bool(day_holidays)

        if not is_working_day:
            work_fraction = 0.0
        else:
            work_fraction = config.half_days.get(current, 1.0)
            if is_holiday:
                work_fraction = min(work_fraction, holiday_fraction)

        days.append(DayInfo(
            date=current,
            weekday=weekday_code(iso),
            in_planned_year=current.year == config.year,
            is_working_day=is_working_day,
            is_weekend=iso >= 6,
            is_holiday=is_holiday,
            holiday_names=tuple(sorted({h.name for h in day_holidays})),
            holiday_on_non_working_day=is_holiday and not is_working_day,
            work_fraction=work_fraction,
            is_free=work_fraction == 0.0,
        ))
        current += timedelta(days=1)
    return days
