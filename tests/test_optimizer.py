"""SPEC §9 optimizer tests. Days come from the real day-model builder; holidays are
synthetic (names never matter to the optimizer)."""

from datetime import date, timedelta

import pytest

from domain.calendar import build_days, default_half_days, window_years
from domain.holidays import baseline_holidays
from domain.models import CalendarConfig, Holiday
from domain.vacation_optimizer import (
    MAX_COST, MAX_SPAN_DAYS, PLAN_MIN_EFFICIENCY, best_candidate, find_candidates, recommend_plan, summarize,
    zero_cost_runs,
)
from domain.working_days import DEFAULT_WORKING_DAYS, parse_working_days

YEAR = 2027
TODAY = date(2026, 10, 2)


def hol(d, name="Feiertag X", fraction=0.0):
    return Holiday(date=d, name=name, type="public", jurisdiction="canton", canton="ZH", municipality=None,
                   source="test", source_url="", source_title="", retrieved_at="t", confidence="medium",
                   work_fraction=fraction)


def days_for(holidays=(), working=DEFAULT_WORKING_DAYS, half_days=None):
    return build_days(CalendarConfig(YEAR, working, half_days or {}), list(holidays))


def cands(days, today=TODAY):
    return find_candidates(days, location_id="x", year=YEAR, today=today)


def by_run(candidates):
    return {(c.start, c.end): c for c in candidates}


# --- working-day configurations ----------------------------------------------------------------

def test_mon_fri_thursday_holiday_gives_bridge_friday():
    thu = date(2027, 5, 6)                         # a Thursday
    c = by_run(cands(days_for([hol(thu)])))[(thu, date(2027, 5, 9))]
    assert c.vacation_days_required == 1 and c.days_free == 4 and c.efficiency == 4
    assert c.vacation_dates == (date(2027, 5, 7),) and c.anchor_holidays == ("Feiertag X",)


def test_mon_sat_week_needs_saturday_too():
    thu = date(2027, 5, 6)
    days = days_for([hol(thu)], working=parse_working_days(["MON", "TUE", "WED", "THU", "FRI", "SAT"]))
    runs = by_run(cands(days))
    assert (thu, date(2027, 5, 9)) in runs         # Fri + Sat taken: Thu–Sun
    c = runs[(thu, date(2027, 5, 9))]
    assert c.vacation_days_required == 2 and c.days_free == 4


def test_mon_thu_week_friday_is_already_free():
    tue = date(2027, 5, 4)                         # holiday on a Tuesday
    days = days_for([hol(tue)], working=parse_working_days(["MON", "TUE", "WED", "THU"]))
    runs = by_run(cands(days))
    # Monday off bridges Fri–Sun before to the Tuesday holiday: Fri 30.4 – Tue 4.5
    c = runs[(date(2027, 4, 30), tue)]
    assert c.vacation_days_required == 1 and c.days_free == 5


# --- holidays ---------------------------------------------------------------------------------

def test_holiday_on_non_working_day_gives_no_bridge():
    sat = date(2027, 5, 8)
    shape = lambda cs: {(c.start, c.end, c.vacation_days_required) for c in cs}
    # Same periods and costs as without the holiday (only the anchor names differ).
    assert shape(cands(days_for([hol(sat)]))) == shape(cands(days_for()))


def test_consecutive_holidays_are_one_run():
    thu, fri = date(2027, 12, 23), date(2027, 12, 24)
    days = days_for([hol(thu, "A"), hol(fri, "B")])
    zero = {(r.start, r.end): r for r in zero_cost_runs(days, year=YEAR, today=TODAY)}
    assert zero[(thu, date(2027, 12, 26))].days_free == 4
    assert zero[(thu, date(2027, 12, 26))].anchor_holidays == ("A", "B")


def test_half_day_costs_half():
    # Thursday holiday, Friday is a half working day: bridging costs 0.5
    thu, fri = date(2027, 5, 6), date(2027, 5, 7)
    c = by_run(cands(days_for([hol(thu)], half_days={fri: 0.5})))[(thu, date(2027, 5, 9))]
    assert c.vacation_days_required == 0.5 and c.efficiency == 8


def test_no_special_casing_of_named_holidays():
    # Same pattern, different name → identical result apart from the anchor name.
    thu = date(2027, 5, 6)
    a = by_run(cands(days_for([hol(thu, "Auffahrt")])))[(thu, date(2027, 5, 9))]
    b = by_run(cands(days_for([hol(thu, "Irgendwas")])))[(thu, date(2027, 5, 9))]
    assert (a.vacation_days_required, a.days_free) == (b.vacation_days_required, b.days_free)


# --- year boundary (D8) ------------------------------------------------------------------------

def test_year_boundary_charges_each_year():
    hs = baseline_holidays("ZH", window_years(YEAR), "t")
    days = build_days(CalendarConfig(YEAR, DEFAULT_WORKING_DAYS, default_half_days(YEAR)), hs)
    xmas = [c for c in cands(days) if c.start.year == YEAR - 1 and c.end.year == YEAR]
    assert xmas, "expected a period across New Year"
    c = max(xmas, key=lambda c: c.days_free)
    assert set(c.vacation_days_by_year) == {YEAR - 1, YEAR}
    assert sum(c.vacation_days_by_year.values()) == c.vacation_days_required


def test_periods_need_a_vacation_day_in_the_planned_year():
    hs = baseline_holidays("ZH", window_years(YEAR), "t")
    days = build_days(CalendarConfig(YEAR, DEFAULT_WORKING_DAYS, {}), hs)
    for c in cands(days, today=date(YEAR - 1, 1, 1)):
        assert any(d.year == YEAR for d in c.vacation_dates)


def test_no_vacation_in_the_past():
    days = days_for([hol(date(2027, 5, 6))])
    assert all(min(c.vacation_dates) >= date(2027, 6, 1) for c in cands(days, today=date(2027, 6, 1)))


# --- zero cost, bounds, dominance ------------------------------------------------------------

def test_zero_cost_runs_need_three_days():
    days = days_for([hol(date(2027, 3, 26)), hol(date(2027, 3, 29))])     # Fri + Mon: Easter weekend
    zero = zero_cost_runs(days, year=YEAR, today=TODAY)
    assert any(r.start == date(2027, 3, 26) and r.days_free == 4 for r in zero)
    assert all(r.days_free >= 3 for r in zero)                            # plain weekends excluded


def test_bounds():
    hs = baseline_holidays("ZH", window_years(YEAR), "t")
    days = build_days(CalendarConfig(YEAR, DEFAULT_WORKING_DAYS, default_half_days(YEAR)), hs)
    for c in cands(days):
        assert 0 < c.vacation_days_required <= MAX_COST
        assert c.days_free <= MAX_SPAN_DAYS
        assert c.days_free == (c.end - c.start).days + 1


def test_dominated_candidates_are_dropped():
    hs = baseline_holidays("ZH", window_years(YEAR), "t")
    days = build_days(CalendarConfig(YEAR, DEFAULT_WORKING_DAYS, {}), hs)
    cs = cands(days)
    for c in cs:
        assert not any(o is not c and o.start <= c.start and o.end >= c.end and (o.start, o.end) != (c.start, c.end)
                       and o.vacation_days_required <= c.vacation_days_required for o in cs)


def test_free_runs_are_really_free_once_vacation_is_taken():
    hs = baseline_holidays("BE", window_years(YEAR), "t")
    days = build_days(CalendarConfig(YEAR, DEFAULT_WORKING_DAYS, default_half_days(YEAR)), hs)
    by_date = {d.date: d for d in days}
    for c in cands(days):
        d = c.start
        while d <= c.end:
            assert by_date[d].work_fraction == 0 or d in c.vacation_dates
            d += timedelta(days=1)
        assert by_date[c.start - timedelta(days=1)].work_fraction > 0
        assert by_date[c.end + timedelta(days=1)].work_fraction > 0


# --- best period, budget, summary, determinism ------------------------------------------------

def test_best_is_most_efficient_and_respects_budget():
    days = days_for([hol(date(2027, 5, 6)), hol(date(2027, 3, 26)), hol(date(2027, 3, 29))])
    cs = cands(days)
    best = best_candidate(cs, year=YEAR, budget=None)
    assert best.efficiency == max(c.efficiency for c in cs)
    assert best_candidate(cs, year=YEAR, budget=0.5) is None
    two = best_candidate(cs, year=YEAR, budget=2)
    assert two.vacation_days_by_year.get(YEAR, 0) <= 2


def test_summary_counts_holidays_on_working_days():
    days = days_for([hol(date(2027, 5, 6)), hol(date(2027, 5, 8)), hol(date(2027, 8, 1))])  # Thu, Sat, Sun
    s = summarize(days, cands(days), year=YEAR, budget=None)
    assert (s["holidays_total"], s["holidays_on_working_days"]) == (3, 1)
    assert s["best"]["start"] == "2027-05-06"


def test_deterministic():
    hs = baseline_holidays("ZH", window_years(YEAR), "t")
    cfg = CalendarConfig(YEAR, DEFAULT_WORKING_DAYS, default_half_days(YEAR))
    a = [c.to_dict() for c in cands(build_days(cfg, hs))]
    b = [c.to_dict() for c in cands(build_days(cfg, list(reversed(hs))))]
    assert a == b


def test_locations_with_different_holidays_differ():
    def best_for(canton):
        hs = baseline_holidays(canton, window_years(YEAR), "t")
        days = build_days(CalendarConfig(YEAR, DEFAULT_WORKING_DAYS, {}), hs)
        return {(c.start, c.end) for c in cands(days)}
    assert best_for("ZH") != best_for("AI")        # e.g. Fronleichnam bridge only in AI



# --- recommended plan (owner decision: greedy within budget) -----------------------------------

def zh_candidates():
    hs = baseline_holidays("ZH", window_years(YEAR), "t")
    days = build_days(CalendarConfig(YEAR, DEFAULT_WORKING_DAYS, default_half_days(YEAR)), hs)
    return cands(days)


def test_plan_without_budget_takes_efficient_non_overlapping_periods():
    plan = recommend_plan(zh_candidates(), year=YEAR, budget=None)
    assert plan and all(c.efficiency >= PLAN_MIN_EFFICIENCY for c in plan)
    for a, b in zip(plan, plan[1:]):
        assert a.end < b.start                                # chronological, no overlap
    assert any("Auffahrt" in c.anchor_holidays for c in plan)


@pytest.mark.parametrize("budget", [0, 1, 4, 10, 25])
def test_plan_respects_budget(budget):
    plan = recommend_plan(zh_candidates(), year=YEAR, budget=budget)
    assert sum(c.vacation_days_by_year.get(YEAR, 0) for c in plan) <= budget
    for a, b in zip(plan, plan[1:]):
        assert a.end < b.start


def test_plan_starts_with_the_best_period():
    cs = zh_candidates()
    best = best_candidate(cs, year=YEAR, budget=None)
    assert best in recommend_plan(cs, year=YEAR, budget=None)
    assert recommend_plan(cs, year=YEAR, budget=1) == [best]


def test_summary_contains_plan_totals():
    hs = baseline_holidays("ZH", window_years(YEAR), "t")
    days = build_days(CalendarConfig(YEAR, DEFAULT_WORKING_DAYS, {}), hs)
    s = summarize(days, cands(days), year=YEAR, budget=10)
    assert s["plan_vacation_days"] <= 10
    assert s["plan_days_free"] == sum(c["days_free"] for c in s["plan"])



# --- owner report 2026-10-03: an ordinary week was recommended ("Dank: Allerheiligen" on a Sunday)

def test_anchors_are_only_holidays_on_working_days():
    sun = date(2027, 10, 31)                       # holiday on a Sunday
    thu = date(2027, 5, 6)
    days = days_for([hol(sun, "Sonntagsfeiertag"), hol(thu, "Donnerstagsfeiertag")])
    names = {n for c in cands(days) for n in c.anchor_holidays}
    assert "Donnerstagsfeiertag" in names and "Sonntagsfeiertag" not in names


def _zh_days(half_days=None):
    hs = baseline_holidays("ZH", window_years(YEAR), "t")
    return build_days(CalendarConfig(YEAR, DEFAULT_WORKING_DAYS,
                                      default_half_days(YEAR) if half_days is None else half_days), hs)


@pytest.mark.parametrize("budget", [None, 10, 25, 40])
def test_plan_never_contains_an_ordinary_week(budget):
    """Every recommended period contains a day that saves vacation: a holiday on a working day
    or a half working day (step 2, owner 2026-10-03). A weekend holiday alone is not enough."""
    plan = recommend_plan(zh_candidates(), year=YEAR, budget=budget)
    by_date = {d.date: d for d in _zh_days()}
    assert plan
    for c in plan:
        d, saves = c.start, False
        while d <= c.end:
            day = by_date[d]
            saves |= (day.is_holiday and day.is_working_day) or 0 < day.work_fraction < 1
            d += timedelta(days=1)
        assert saves, (c.start, c.end)
    if budget is None:                                  # no budget: only step 1
        assert all(c.anchor_holidays for c in plan)


def test_plan_periods_do_not_overlap_and_fit_the_budget():
    for budget in (5, 10, 17.5, 25, 40):
        plan = recommend_plan(zh_candidates(), year=YEAR, budget=budget)
        assert sum(c.vacation_days_by_year.get(YEAR, 0.0) for c in plan) <= budget
        for a, b in zip(plan, plan[1:]):
            assert a.end < b.start


def test_left_budget_goes_to_christmas_on_a_weekend():
    """Owner report (Baden 2027, 25 days): step 1 left 8 days unused although Christmas 2027
    (Sat/Sun) and New Year 2028 (Sat) allow a long break. Step 2 must use them there."""
    days = _zh_days()
    cs = cands(days)
    step1 = [c for c in recommend_plan(cs, year=YEAR, budget=25) if c.anchor_holidays]
    plan = recommend_plan(cs, year=YEAR, budget=25)
    used = sum(c.vacation_days_by_year.get(YEAR, 0.0) for c in plan)
    assert used > sum(c.vacation_days_by_year.get(YEAR, 0.0) for c in step1)
    xmas = [c for c in plan if c.start <= date(2027, 12, 27) <= c.end]
    assert xmas and "Weihnachten" in xmas[0].holidays_in_run and not xmas[0].anchor_holidays
    assert xmas[0].half_days >= 1                # qualifies through the half day 31.12.
    assert used >= 23                            # (almost) all of the budget is used (ZH 2027: 23½)


def test_fill_prefers_the_most_free_days():
    # a half working day on Friday 11.6.; budget 4.5: the week around it (4½ → 9 days)
    days = days_for([], half_days={date(2027, 6, 11): 0.5})
    plan = recommend_plan(cands(days), year=YEAR, budget=4.5)
    assert len(plan) == 1 and plan[0].days_free == 9 and plan[0].vacation_days_required == 4.5
    assert plan[0].start <= date(2027, 6, 11) <= plan[0].end


def test_a_weekend_holiday_alone_is_not_recommended():
    """Owner report: 24.7.–1.8.2027 (Nationalfeiertag on a Sunday) made no sense."""
    sun = date(2027, 8, 1)
    assert recommend_plan(cands(days_for([hol(sun, "Nationalfeiertag")])), year=YEAR, budget=25) == []
    plan = recommend_plan(zh_candidates(), year=YEAR, budget=25)
    assert not any(c.start <= sun <= c.end for c in plan)


def test_fill_without_any_holiday_recommends_nothing():
    assert recommend_plan(cands(days_for([])), year=YEAR, budget=25) == []


def test_unused_budget_is_reported():
    hs = baseline_holidays("ZH", window_years(YEAR), "t")
    days = build_days(CalendarConfig(YEAR, DEFAULT_WORKING_DAYS, {}), hs)
    s = summarize(days, cands(days), year=YEAR, budget=40)
    assert s["budget_left"] == 40 - s["plan_vacation_days"] and s["budget_left"] > 0
    assert summarize(days, cands(days), year=YEAR, budget=None)["budget_left"] is None


def test_fill_may_extend_a_plan_period_instead_of_adding_an_ordinary_week():
    """Only one holiday (Thursday): step 1 takes the Friday bridge (1 day → 4 days); with 5
    days budget the rest extends that period to a longer one around the same holiday."""
    thu = date(2027, 5, 6)
    days = days_for([hol(thu, "Auffahrt")])
    cs = cands(days)
    one = recommend_plan(cs, year=YEAR, budget=1)
    assert [(c.start, c.end) for c in one] == [(date(2027, 5, 6), date(2027, 5, 9))]
    plan = recommend_plan(cs, year=YEAR, budget=5)
    assert len(plan) == 1
    assert plan[0].start <= thu <= plan[0].end and plan[0].days_free > 4
    assert plan[0].vacation_days_by_year[YEAR] <= 5
