"""public/data/holiday-info.json: a background text for every holiday the baseline can return."""

import json
from pathlib import Path

import pytest

from domain.holidays import baseline_holidays
from domain.models import CANTONS

INFO = json.loads((Path(__file__).resolve().parent.parent / "public" / "data" / "holiday-info.json")
                  .read_text(encoding="utf-8"))


def baseline_names() -> set[str]:
    names = set()
    for canton in CANTONS:
        names |= {h.name for h in baseline_holidays(canton, list(range(2025, 2031)), "t")}
    return names


def test_every_baseline_holiday_has_a_background_text():
    missing = baseline_names() - set(INFO["holidays"])
    assert not missing, f"no background text for: {sorted(missing)}"


@pytest.mark.parametrize("name", sorted(INFO["holidays"]))
def test_entries_are_well_formed(name):
    entry = INFO["holidays"][name]
    assert 40 <= len(entry["text"]) <= 400
    assert "ß" not in entry["text"]                 # Swiss Standard German
    assert entry["wiki"] and "/" not in entry["wiki"]


def test_aliases_point_to_entries():
    assert all(target in INFO["holidays"] for target in INFO["aliases"].values())
    assert not set(INFO["aliases"]) & set(INFO["holidays"])
