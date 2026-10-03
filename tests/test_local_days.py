"""Curated local customary days (data/local_days.json): date rules, optional half days,
web corroboration, GET /api/holidays (all offline)."""

import json
from datetime import UTC, date, datetime

import pytest

from app.routes import holidays as holidays_route
from domain import local_days
from domain.holidays import baseline_holidays, merge_holidays
from domain.local_days import easter_sunday, local_days_for, with_local_days
from domain.models import FoundHoliday
from services import youcom

NEXT_YEAR = datetime.now(UTC).year + 1


@pytest.fixture(autouse=True)
def clear_caches():
    holidays_route._cache.clear()
    holidays_route._failures.clear()
    local_days.load_local_days.cache_clear()
    yield
    local_days.load_local_days.cache_clear()


def test_easter():
    assert [easter_sunday(y) for y in (2019, 2025, 2026, 2027, 2028)] == [
        date(2019, 4, 21), date(2025, 4, 20), date(2026, 4, 5), date(2027, 3, 28), date(2028, 4, 16)]


@pytest.mark.parametrize("year,expected", [
    (2019, date(2019, 4, 8)),     # 3rd Monday = Monday of Holy Week → one week earlier
    (2022, date(2022, 4, 25)),    # 3rd Monday = Easter Monday → one week later
    (2025, date(2025, 4, 28)),    # same
    (2026, date(2026, 4, 20)),
    (2027, date(2027, 4, 19)),
    (2028, date(2028, 4, 24)),    # Easter Monday 17.4. → 24.4.
])
def test_sechselaeuten_dates(year, expected):
    assert local_days._sechselaeuten(year) == expected


def test_knabenschiessen_and_zibelemaerit_dates():
    assert local_days._knabenschiessen(2026) == date(2026, 9, 14)
    assert local_days._knabenschiessen(2027) == date(2027, 9, 13)
    assert local_days._zibelemaerit(2026) == date(2026, 11, 23)
    assert local_days._zibelemaerit(2027) == date(2027, 11, 22)


def test_local_days_are_optional_half_days_of_their_municipality_only():
    zh = local_days_for(261, "ZH", "Zürich", 2026, "t")
    assert [(h.name, h.date) for h in zh] == [("Sechseläuten", date(2026, 4, 20)),
                                              ("Knabenschiessen", date(2026, 9, 14))]
    for h in zh:
        assert h.enabled is False and not h.disputed and h.work_fraction == 0.5
        assert h.type == "local" and h.jurisdiction == "municipality" and h.confidence == "medium"
        assert h.source_url.startswith("https://de.wikipedia.org/") and "achmittag" in h.note
    assert [h.name for h in local_days_for(351, "BE", "Bern", 2026, "t")] == ["Zibelemärit"]
    assert local_days_for(4021, "AG", "Baden", 2026, "t") == []
    assert local_days_for(42, "ZH", "Winterthur", 2026, "t") == []


def test_web_rows_corroborate_and_web_only_duplicates_are_replaced():
    row = FoundHoliday(date(2026, 4, 20), "Sechseläuten", "partial", 26.9, "https://feiertagskalender.ch/x",
                       "Feiertage Kanton Zürich 2026", "t", "canton")
    merged = merge_holidays(baseline_holidays("ZH", [2026], "t"), [row], year=2026, canton="ZH", municipality="Zürich")
    assert [h.work_fraction for h in merged if h.name == "Sechseläuten"] == [0.0]   # web-only: full day
    local = local_days_for(261, "ZH", "Zürich", 2026, "t", [row])
    out = with_local_days(merged, local)
    sechs = [h for h in out if h.name == "Sechseläuten"]
    assert len(sechs) == 1 and sechs[0].work_fraction == 0.5 and sechs[0].confidence == "high"
    assert sechs[0].corroborated_by == ("https://feiertagskalender.ch/x",)
    assert out == sorted(out, key=lambda h: (h.date, h.name))


def test_missing_list_only_drops_the_local_days(monkeypatch, tmp_path):
    monkeypatch.setattr(local_days, "LOCAL_DAYS_FILE", tmp_path / "missing.json")
    assert local_days_for(261, "ZH", "Zürich", 2026, "t") == []


def q(**over):
    base = {"year": str(NEXT_YEAR), "location_id": "bfs-351", "canton": "BE", "municipality_id": "351",
            "municipality": "Bern"}
    base.update(over)
    return base


def test_api_lists_local_days_also_without_the_web_search(client, monkeypatch):
    def down(query):
        raise youcom.YouComUnavailable("youcom", "no_api_key")
    monkeypatch.setattr(youcom, "fetch_pages", down)
    data = client.get("/api/holidays", query_string=q()).get_json()
    zib = [h for h in data["holidays"] if h["name"] == "Zibelemärit"]
    assert len(zib) == 1 and zib[0]["enabled"] is False and zib[0]["work_fraction"] == 0.5
    assert zib[0]["key"] == f"{zib[0]['date']}|Zibelemärit"
    assert data["summary"]["optional"] >= 1


def test_api_name_first_table_corroborates(client, monkeypatch):
    y = NEXT_YEAR
    d = local_days._zibelemaerit(y)
    page = {"url": "https://www.ferienwiki.ch/feiertage/ch/bern", "title": f"Feiertage {y} in Bern",
            "markdown": f"| Feiertag | Datum |\n|---|---|\n| Neujahr | 01.01.{y} (Freitag) |\n"
                        f"| [Zibelemärit](https://x.example/z) | {d:%d.%m.%Y} (Montag) |\n"}
    monkeypatch.setattr(youcom, "fetch_pages", lambda query: [page])
    data = client.get("/api/holidays", query_string=q()).get_json()
    zib = next(h for h in data["holidays"] if h["name"] == "Zibelemärit")
    assert zib["confidence"] == "high" and zib["corroborated_by"] == ["https://www.ferienwiki.ch/feiertage/ch/bern"]
    assert data["summary"]["confirmed"] >= 1        # Neujahr confirmed by the name-first table


def test_parse_name_first_rows():
    assert youcom.parse_name_row("| Sechseläuten | 20.04.2026 (Montag) |") == (date(2026, 4, 20), "Sechseläuten")
    assert youcom.parse_name_row("| [Knabenschiessen](https://x) | 14.09.2026 |") == (date(2026, 9, 14), "Knabenschiessen")
    assert youcom.parse_name_row("| 20.04.2026 | Mo | Sechseläuten |") is None
    assert youcom.parse_name_row("| Datum | Feiertag |") is None
    assert youcom.parse_name_row("| Kaputt | 31.02.2026 |") is None
    pages = [{"url": "u", "title": "Gesetzliche Feiertage 2026 und 2027 in Zürich",
              "markdown": "| Sechseläuten | 20.04.2026 (Montag) |\n| Karfreitag | 03.04.2026 (Freitag) |"}]
    found = youcom.parse_pages(pages, year=2026, municipality="Zürich", canton="ZH", retrieved_at="t")
    # a "Gesetzliche Feiertage" title does not make name-first rows legal (customary days are listed too)
    assert {(f.name, f.kind) for f in found} == {("Sechseläuten", "unclassified"), ("Karfreitag", "unclassified")}
    merged = merge_holidays(baseline_holidays("ZH", [2026], "t"), found, year=2026, canton="ZH", municipality="Zürich")
    assert not any(h.name == "Sechseläuten" for h in merged)          # not promoted to a web-only holiday
    assert next(h for h in merged if h.name == "Karfreitag").confidence == "high"
