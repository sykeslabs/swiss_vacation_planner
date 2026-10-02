"""D1 baseline. The `holidays` package computes dates locally (no network)."""

from datetime import date

import pytest

from domain.holidays import SOURCE, baseline_holidays
from domain.models import CANTONS

T = "2026-10-02T00:00:00+00:00"


def dates(hs, year=None):
    return {h.date for h in hs if year is None or h.date.year == year}


def test_cantons_differ():
    zh = baseline_holidays("ZH", [2027], T)
    ai = baseline_holidays("AI", [2027], T)
    corpus_christi = date(2027, 5, 27)
    assert corpus_christi in dates(ai) and corpus_christi not in dates(zh)
    assert date(2027, 5, 1) in dates(zh) and date(2027, 5, 1) not in dates(ai)


def test_easter_dates_are_computed_not_hard_coded():
    # Good Friday moves with Easter: 2027-03-26, 2028-04-14.
    hs = baseline_holidays("ZH", [2027, 2028], T)
    good_friday = {h.date for h in hs if h.name == "Karfreitag"}
    assert good_friday == {date(2027, 3, 26), date(2028, 4, 14)}


def test_provenance_and_jurisdiction():
    hs = baseline_holidays("BE", [2027], T)
    assert hs and all(h.source == SOURCE and h.source_url and h.retrieved_at == T for h in hs)
    assert all("holidays" in h.source_title for h in hs)
    assert all(h.canton == "BE" and h.municipality is None and h.confidence == "medium" for h in hs)
    jur = {h.name: h.jurisdiction for h in hs}
    assert jur["Nationalfeiertag"] == "national"
    assert jur["Berchtoldstag"] == "canton"


def test_sorted_and_german_names():
    hs = baseline_holidays("ZH", [2026, 2027, 2028], T)
    assert hs == sorted(hs, key=lambda h: (h.date, h.name))
    assert "Weihnachten" in {h.name for h in hs}


@pytest.mark.parametrize("canton", sorted(CANTONS))
def test_every_canton_has_national_day(canton):
    assert date(2027, 8, 1) in dates(baseline_holidays(canton, [2027], T))


def test_unknown_canton_rejected():
    with pytest.raises(ValueError):
        baseline_holidays("XX", [2027], T)
