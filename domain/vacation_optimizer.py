"""Vacation optimizer: which vacation days give the most consecutive days off.

Pure and deterministic: works only on the DayInfo list (no network, no LLM, no clock;
`today` is passed in). Nothing here knows holiday names in advance — Easter, Auffahrt,
Christmas … come out of the free/working pattern of the days (SPEC §6).

Definitions (SPEC §6, D4, D5, D8, DECISIONS.md):
- A day is free if it costs no work (work_fraction 0: non-working weekday or holiday).
- A candidate is a block of vacation days [a, b] such that a and b are days that would
  have to be worked, and the day before a and the day after b are free. Vacation is
  consumed only on days with work (half days cost their work fraction).
- days_free = length of the maximal free run once the block is taken off.
- Bounds: 0 < cost ≤ 10 vacation days, free run ≤ 21 calendar days, at least one
  vacation day in the planned year, no vacation day before `today`.
- A candidate is dropped if another one frees a superset of its days for the same or a
  lower cost. Zero-cost free runs of ≥ 3 days are listed separately.
"""

from dataclasses import dataclass, field
from datetime import date

from domain.models import DayInfo

MAX_COST = 10.0
MAX_SPAN_DAYS = 21
MIN_ZERO_COST_DAYS = 3


@dataclass(frozen=True)
class VacationCandidate:
    location_id: str
    start: date                    # first free day of the run
    end: date                      # last free day of the run
    days_free: int
    vacation_days_required: float
    efficiency: float              # days_free / vacation_days_required
    anchor_holidays: tuple[str, ...]
    vacation_days_by_year: dict[int, float] = field(default_factory=dict)
    vacation_dates: tuple[date, ...] = ()

    def to_dict(self) -> dict:
        return {
            "location_id": self.location_id,
            "start": self.start.isoformat(),
            "end": self.end.isoformat(),
            "days_free": self.days_free,
            "vacation_days_required": self.vacation_days_required,
            "efficiency": round(self.efficiency, 2),
            "anchor_holidays": list(self.anchor_holidays),
            "vacation_days_by_year": {str(y): v for y, v in sorted(self.vacation_days_by_year.items())},
            "vacation_dates": [d.isoformat() for d in self.vacation_dates],
        }


@dataclass(frozen=True)
class FreeRun:
    start: date
    end: date
    days_free: int
    anchor_holidays: tuple[str, ...]

    def to_dict(self) -> dict:
        return {"start": self.start.isoformat(), "end": self.end.isoformat(),
                "days_free": self.days_free, "anchor_holidays": list(self.anchor_holidays)}


def _is_free(day: DayInfo) -> bool:
    return day.work_fraction == 0


def _anchors(days: list[DayInfo]) -> tuple[str, ...]:
    names = []
    for d in days:
        for n in d.holiday_names:
            if n not in names:
                names.append(n)
    return tuple(names)


def _round_cost(x: float) -> float:
    return round(x * 2) / 2      # costs are multiples of 0.5


def find_candidates(days: list[DayInfo], *, location_id: str, year: int, today: date) -> list[VacationCandidate]:
    """All non-dominated candidates, in chronological order."""
    n = len(days)
    found: dict[tuple[date, date], VacationCandidate] = {}
    for a in range(1, n - 1):
        if _is_free(days[a]) or not _is_free(days[a - 1]) or days[a].date < today:
            continue
        left = a - 1
        while left > 0 and _is_free(days[left - 1]):
            left -= 1
        left_run = a - left
        cost = 0.0
        for b in range(a, n - 1):
            if left_run + (b - a + 1) > MAX_SPAN_DAYS:
                break
            cost += days[b].work_fraction
            if cost > MAX_COST:
                break
            if _is_free(days[b]) or not _is_free(days[b + 1]):
                continue
            right = b + 1
            while right < n - 1 and _is_free(days[right + 1]):
                right += 1
            span = right - left + 1
            if span > MAX_SPAN_DAYS:
                continue
            block = days[a:b + 1]
            vacation = [d for d in block if d.work_fraction > 0]
            if not any(d.date.year == year for d in vacation):
                continue
            by_year: dict[int, float] = {}
            for d in vacation:
                by_year[d.date.year] = _round_cost(by_year.get(d.date.year, 0.0) + d.work_fraction)
            total = _round_cost(cost)
            key = (days[left].date, days[right].date)
            cand = VacationCandidate(
                location_id=location_id,
                start=days[left].date,
                end=days[right].date,
                days_free=span,
                vacation_days_required=total,
                efficiency=span / total,
                anchor_holidays=_anchors(days[left:right + 1]),
                vacation_days_by_year=by_year,
                vacation_dates=tuple(d.date for d in vacation),
            )
            if key not in found or total < found[key].vacation_days_required:
                found[key] = cand
    candidates = sorted(found.values(), key=lambda c: (c.start, c.end))
    return [c for c in candidates if not _dominated(c, candidates)]


def _dominated(c: VacationCandidate, others: list[VacationCandidate]) -> bool:
    return any(
        o is not c
        and o.start <= c.start and o.end >= c.end
        and (o.start, o.end) != (c.start, c.end)
        and o.vacation_days_required <= c.vacation_days_required
        for o in others
    )


def zero_cost_runs(days: list[DayInfo], *, year: int, today: date) -> list[FreeRun]:
    """Free runs of ≥ 3 days that need no vacation, touching the planned year, not in the past."""
    runs, i, n = [], 0, len(days)
    while i < n:
        if not _is_free(days[i]):
            i += 1
            continue
        j = i
        while j + 1 < n and _is_free(days[j + 1]):
            j += 1
        run = days[i:j + 1]
        if (len(run) >= MIN_ZERO_COST_DAYS and run[0].date >= today
                and any(d.date.year == year for d in run) and 0 < i and j < n - 1):
            runs.append(FreeRun(run[0].date, run[-1].date, len(run), _anchors(run)))
        i = j + 1
    return runs


def best_candidate(candidates: list[VacationCandidate], *, year: int,
                   budget: float | None) -> VacationCandidate | None:
    """Most free days per vacation day (ties: more free days, then earlier). With a budget,
    only candidates whose vacation days in the planned year fit into it count (D3, D8)."""
    pool = [c for c in candidates if budget is None or c.vacation_days_by_year.get(year, 0.0) <= budget]
    if not pool:
        return None
    return min(pool, key=lambda c: (-c.efficiency, -c.days_free, c.start))


def within_budget(c: VacationCandidate, *, year: int, budget: float | None) -> bool:
    return budget is None or c.vacation_days_by_year.get(year, 0.0) <= budget


def summarize(days: list[DayInfo], candidates: list[VacationCandidate], *, year: int,
              budget: float | None) -> dict:
    in_year = [d for d in days if d.date.year == year]
    best = best_candidate(candidates, year=year, budget=budget)
    return {
        "year": year,
        "holidays_total": sum(1 for d in in_year if d.is_holiday),
        "holidays_on_working_days": sum(1 for d in in_year if d.is_holiday and d.is_working_day),
        "budget": budget,
        "candidates_count": len(candidates),
        "best": best.to_dict() if best else None,
    }
