from datetime import date, timedelta

import pytest

from domain.calendar import build_days, calendar_window, default_half_days
from domain.holidays import baseline_holidays
from domain.models import CalendarConfig, Holiday
from domain.working_days import DEFAULT_WORKING_DAYS, parse_working_days

T = "2026-10-02T00:00:00+00:00"


def holiday(d, name="Testfeiertag", work_fraction=0.0):
    return Holiday(date=d, name=name, type="public", jurisdiction="canton", canton="ZH",
                   municipality=None, source="test", source_url="", source_title="",
                   retrieved_at=T, confidence="medium", work_fraction=work_fraction)


def by_date(days):
    return {d.date: d for d in days}


@pytest.mark.parametrize("year", [2027, 2028])   # 2028 is a leap year
def test_every_date_exactly_once_including_boundary_months(year):
    days = build_days(CalendarConfig(year, DEFAULT_WORKING_DAYS), [])
    dates = [d.date for d in days]
    start, end = calendar_window(year)
    assert (start, end) == (date(year - 1, 12, 1), date(year + 1, 1, 31))
    assert dates[0] == start and dates[-1] == end
    assert len(dates) == len(set(dates)) == (end - start).days + 1
    assert all(b - a == timedelta(days=1) for a, b in zip(dates, dates[1:]))
    assert sum(d.in_planned_year for d in days) == (366 if year == 2028 else 365)
    assert {d.date.month for d in days if not d.in_planned_year} == {12, 1}


def test_weekday_codes_and_weekend_flag():
    days = by_date(build_days(CalendarConfig(2027, DEFAULT_WORKING_DAYS), []))
    assert days[date(2027, 1, 4)].weekday == "MON"
    assert days[date(2027, 1, 9)].weekday == "SAT" and days[date(2027, 1, 9)].is_weekend
    assert not days[date(2027, 1, 8)].is_weekend


def test_mon_fri_working_days():
    days = by_date(build_days(CalendarConfig(2027, DEFAULT_WORKING_DAYS), []))
    fri, sat = days[date(2027, 1, 8)], days[date(2027, 1, 9)]
    assert fri.is_working_day and fri.work_fraction == 1 and not fri.is_free
    assert not sat.is_working_day and sat.work_fraction == 0 and sat.is_free


@pytest.mark.parametrize("codes,free_weekday", [
    (["MON", "TUE", "WED", "THU"], "FRI"),
    (["MON", "TUE", "WED", "THU", "FRI", "SAT"], None),
])
def test_custom_working_days(codes, free_weekday):
    days = build_days(CalendarConfig(2027, parse_working_days(codes)), [])
    for d in days:
        assert d.is_working_day == (d.weekday in codes)
        assert d.is_free == (d.weekday not in codes)
    if free_weekday:
        assert all(d.is_free for d in days if d.weekday == free_weekday)


def test_holiday_on_working_day():
    d = date(2027, 3, 26)  # Friday
    day = by_date(build_days(CalendarConfig(2027, DEFAULT_WORKING_DAYS), [holiday(d, "Karfreitag")]))[d]
    assert day.is_holiday and day.holiday_names == ("Karfreitag",)
    assert day.is_working_day and not day.holiday_on_non_working_day
    assert day.work_fraction == 0 and day.is_free


def test_holiday_on_non_working_day():
    d = date(2027, 8, 1)  # Sunday
    day = by_date(build_days(CalendarConfig(2027, DEFAULT_WORKING_DAYS), [holiday(d)]))[d]
    assert day.is_holiday and day.holiday_on_non_working_day and day.is_free


def test_consecutive_holidays_and_two_names_on_one_day():
    hs = [holiday(date(2027, 12, 25), "Weihnachten"), holiday(date(2027, 12, 26), "Stephanstag"),
          holiday(date(2027, 12, 26), "Anderer Name")]
    days = by_date(build_days(CalendarConfig(2027, DEFAULT_WORKING_DAYS), hs))
    assert days[date(2027, 12, 25)].is_holiday and days[date(2027, 12, 26)].is_holiday
    assert days[date(2027, 12, 26)].holiday_names == ("Anderer Name", "Stephanstag")


def test_half_day_is_a_working_day_with_fraction():
    d = date(2027, 12, 24)  # Friday
    cfg = CalendarConfig(2027, DEFAULT_WORKING_DAYS, {d: 0.5})
    day = by_date(build_days(cfg, []))[d]
    assert day.is_working_day and day.work_fraction == 0.5 and not day.is_free


def test_half_day_on_holiday_or_weekend_costs_nothing():
    hol, sat = date(2027, 3, 26), date(2027, 12, 25)
    cfg = CalendarConfig(2027, DEFAULT_WORKING_DAYS, {hol: 0.5, sat: 0.5})
    days = by_date(build_days(cfg, [holiday(hol)]))
    assert days[hol].work_fraction == 0 and days[hol].is_free
    assert days[sat].work_fraction == 0 and days[sat].is_free


def test_partial_holiday_reduces_work():
    d = date(2027, 4, 19)  # Monday, e.g. an afternoon-off holiday
    day = by_date(build_days(CalendarConfig(2027, DEFAULT_WORKING_DAYS), [holiday(d, work_fraction=0.5)]))[d]
    assert day.is_holiday and day.work_fraction == 0.5 and not day.is_free


def test_holidays_outside_window_are_ignored():
    days = build_days(CalendarConfig(2027, DEFAULT_WORKING_DAYS), [holiday(date(2025, 1, 1))])
    assert not any(d.is_holiday for d in days)


def test_default_half_days_cover_both_decembers():
    assert set(default_half_days(2027)) == {date(2026, 12, 24), date(2026, 12, 31),
                                            date(2027, 12, 24), date(2027, 12, 31)}
    assert set(default_half_days(2027).values()) == {0.5}


def test_boundary_months_use_adjacent_year_holidays():
    hs = baseline_holidays("ZH", [2026, 2027, 2028], T)
    days = by_date(build_days(CalendarConfig(2027, DEFAULT_WORKING_DAYS), hs))
    assert days[date(2026, 12, 25)].is_holiday and not days[date(2026, 12, 25)].in_planned_year
    assert days[date(2028, 1, 1)].is_holiday


def test_deterministic():
    hs = baseline_holidays("BE", [2026, 2027, 2028], T)
    cfg = CalendarConfig(2027, DEFAULT_WORKING_DAYS, default_half_days(2027))
    assert build_days(cfg, hs) == build_days(cfg, list(reversed(hs)))


@pytest.mark.parametrize("codes", [[], ["MON", "XYZ"], None])
def test_invalid_working_days(codes):
    with pytest.raises(ValueError):
        parse_working_days(codes)
