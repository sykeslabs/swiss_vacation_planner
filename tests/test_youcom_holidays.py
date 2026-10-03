"""M4: You.com holiday retrieval, parsing, merge and GET /api/holidays (all offline)."""

import json
from datetime import UTC, date, datetime
from pathlib import Path

import pytest

from app.routes import holidays as holidays_route
from domain.holidays import baseline_holidays, holiday_key, merge_holidays, name_key
from domain.models import FoundHoliday
from services import http, youcom

FIXTURES = Path(__file__).parent / "fixtures"
YEAR = 2027
NEXT_YEAR = datetime.now(UTC).year + 1


def pages_of(name):
    data = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
    return [{"url": w["url"], "title": w.get("title", ""), "markdown": (w.get("contents") or {}).get("markdown", "")}
            for w in data["body"]["results"]["web"]]


def found_for(fixture, municipality, canton):
    return youcom.parse_pages(pages_of(fixture), year=YEAR, municipality=municipality, canton=canton, retrieved_at="t")


def merged_for(fixture, municipality, canton):
    return merge_holidays(baseline_holidays(canton, [YEAR], "t"), found_for(fixture, municipality, canton),
                          year=YEAR, canton=canton, municipality=municipality)


def by_name(holidays):
    return {h.name: h for h in holidays}


# --- parsing ---------------------------------------------------------------------------------

@pytest.mark.parametrize("line,expected", [
    ('| 26.03.2027 | Fr | [Karfreitag](https://x.ch/a "Den Sonntagen gleichgestellter Feiertag") | 12 | [2](https://x.ch/l) |',
     (date(2027, 3, 26), "Karfreitag", "legal", None)),
    ('| 15.08.2027 | So | [Mariä Himmelfahrt](https://x.ch/a "Gesetzlich anerkannter Feiertag (öffentlicher Ruhetag)") | 32 | [1](https://x.ch/l) |',
     (date(2027, 8, 15), "Mariä Himmelfahrt", "legal", None)),
    ('| 19.04.2027 | Mo | [Sechseläuten](https://x.ch/a "nur teilweise gültig") | 16 | 26.9 % |',
     (date(2027, 4, 19), "Sechseläuten", "partial", 26.9)),
    ('| 15.01.2027 | Fr | [Hilari](https://x.ch/a "nur teilweise gültig") | 02 | <1 % |',
     (date(2027, 1, 15), "Hilari", "partial", 0.5)),
    ('| 02.01.2027 | Sa | [Berchtoldstag](https://x.ch/a "gesetzlich nicht anerkannter Feiertag (Geschäfte …)") | 53 |',
     (date(2027, 1, 2), "Berchtoldstag", "unofficial", None)),
    ('| 14.02.2027 | So | [Valentinstag](https://x.ch/a "Ereignistag") | 06 | [5](https://x.ch/l) |',
     (date(2027, 2, 14), "Valentinstag", "event", None)),
    ('| 01.01.2027 | Fr | Neujahr | 53 |', (date(2027, 1, 1), "Neujahr", "unclassified", None)),
    ('| 24.12.2027 | Fr | Heiligabend | 51 | [3](https://x.ch/l) |', (date(2027, 12, 24), "Heiligabend", "half", None)),
])
def test_parse_row(line, expected):
    assert youcom.parse_row(line) == expected


@pytest.mark.parametrize("line", ["| 31.02.2027 | Mi | Unsinn | 09 |", "| Datum | Tag | Feiertag |", "26.03.2027 Karfreitag", ""])
def test_parse_row_rejects_non_rows(line):
    assert youcom.parse_row(line) is None


def test_pages_for_other_cantons_or_years_are_ignored():
    page = {"url": "u", "title": "Feiertage Kanton Bern 2027", "markdown": "| 26.03.2027 | Fr | Karfreitag | 12 |"}
    assert youcom.parse_pages([page], year=2027, municipality="Zürich", canton="ZH") == []
    other_year = {**page, "title": "Feiertage Kanton Zürich 2026"}
    assert youcom.parse_pages([other_year], year=2027, municipality="Zürich", canton="ZH") == []


def test_legal_page_without_class_column_counts_as_legal():
    page = {"url": "u", "title": "Feiertage Kanton Zürich 2027 (Gesetzliche Feiertage)",
            "markdown": "| 26.03.2027 | Fr | Karfreitag | 12 |\n| 01.01.2026 | Do | Neujahr | 01 |"}
    rows = youcom.parse_pages([page], year=2027, municipality="Zürich", canton="ZH", retrieved_at="t")
    assert [(r.name, r.kind) for r in rows] == [("Karfreitag", "legal")]      # 2026 row dropped


def test_live_fixture_zurich_parses_classes():
    rows = {(r.date, r.name): r for r in found_for("youcom_zuerich_2027.json", "Zürich", "ZH")}
    assert rows[(date(2027, 3, 26), "Karfreitag")].kind == "legal"
    assert rows[(date(2027, 4, 19), "Sechseläuten")].share_percent == 26.9
    assert all(r.kind != "event" for r in rows.values())
    assert all(r.source_url.startswith("https://") for r in rows.values())


# --- merge: confirmed / ambiguous / conflicting / missing -----------------------------------------

def test_zurich_baseline_confirmed_and_local_holidays_optional():
    merged = by_name(merged_for("youcom_zuerich_2027.json", "Zürich", "ZH"))
    for name in ("Neujahrstag", "Karfreitag", "Auffahrt", "Nationalfeiertag", "Weihnachten"):
        assert merged[name].confidence == "high" and merged[name].enabled and merged[name].corroborated_by
    for name in ("Sechseläuten", "Knabenschiessen", "Berchtoldstag"):
        h = merged[name]
        assert h.confidence == "low" and not h.enabled and h.conflict == "nur in Websuche gefunden" and h.note
        assert h.source == "Websuche (You.com)" and h.source_url.startswith("https://")
    # ambiguous: holidays of other places in the canton (< 20 % share) are not offered
    assert "Horgner Fasnacht" not in merged and "Chilbi Wädenswil" not in merged and "Hilari" not in merged
    # Sundays never cost a working day: Ostern/Pfingsten are not offered
    assert "Ostern" not in merged and "Pfingsten" not in merged


def test_cantons_differ_after_merge():
    zh = by_name(merged_for("youcom_zuerich_2027.json", "Zürich", "ZH"))
    ai = by_name(merged_for("youcom_appenzell_2027.json", "Appenzell", "AI"))
    assert "Fronleichnam" in ai and "Fronleichnam" not in zh
    assert ai["St. Mauritius"].enabled is False and "88.4 %" in ai["St. Mauritius"].note
    assert "Sechseläuten" in zh and "Sechseläuten" not in ai


def test_unclassified_rows_only_confirm():
    merged = by_name(merged_for("youcom_appenzell_2027.json", "Appenzell", "AI"))
    assert "Valentinstag" not in merged and "Muttertag" not in merged and "Halloween" not in merged


def row(d, name, kind="legal", share=None):
    return FoundHoliday(d, name, kind, share, "https://example.ch/p", "Feiertage Kanton Zürich 2027", "t")


def test_conflicting_date_is_flagged_not_resolved():
    base = baseline_holidays("ZH", [YEAR], "t")
    merged = by_name(merge_holidays(base, [row(date(2027, 3, 27), "Karfreitag")], year=YEAR, canton="ZH",
                                    municipality="Zürich"))
    kf = merged["Karfreitag"]
    assert kf.date == date(2027, 3, 26)                       # baseline date kept
    assert kf.conflict and "27.03.2027" in kf.conflict and kf.enabled


def test_missing_web_data_invents_nothing():
    base = baseline_holidays("ZH", [YEAR], "t")
    assert merge_holidays(base, [], year=YEAR, canton="ZH", municipality="Zürich") == base


def test_name_matching_and_keys():
    assert name_key("Neujahr") == name_key("Neujahrstag")
    assert name_key("Nationalfeiertag Schweiz") == name_key("Nationalfeiertag")
    assert name_key("Mariä Empfängnis") == "maria empfangnis"
    h = baseline_holidays("ZH", [YEAR], "t")[0]
    assert holiday_key(h) == "2027-01-01|Neujahrstag"


def test_half_holiday_from_web_keeps_half_day():
    base = baseline_holidays("ZH", [YEAR], "t")
    merged = by_name(merge_holidays(base, [row(date(2027, 12, 24), "Heiligabend", "half")], year=YEAR,
                                    canton="ZH", municipality="Zürich"))
    assert merged["Heiligabend"].work_fraction == 0.5 and not merged["Heiligabend"].enabled


# --- service: HTTP behaviour ---------------------------------------------------------------------

def test_no_api_key_means_unavailable(monkeypatch):
    monkeypatch.delenv("YDC_API_KEY", raising=False)
    monkeypatch.setattr(http, "get_json", lambda *a, **k: pytest.fail("must not call"))
    with pytest.raises(youcom.YouComUnavailable) as exc:
        youcom.fetch_pages("q")
    assert exc.value.reason == "no_api_key"


@pytest.mark.parametrize("status,reason", [("HTTP 429", "quota"), ("HTTP 402", "quota")])
def test_quota_errors(monkeypatch, status, reason):
    monkeypatch.setenv("YDC_API_KEY", "test-key")
    def boom(*a, **k):
        raise http.UpstreamError("youcom", status)
    monkeypatch.setattr(http, "get_json", boom)
    with pytest.raises(youcom.YouComUnavailable) as exc:
        youcom.fetch_pages("q")
    assert exc.value.reason == reason


def test_request_shape_and_key_in_header_only(monkeypatch):
    monkeypatch.setenv("YDC_API_KEY", "secret-test-key")
    seen = {}
    def fake(service, url, params=None, headers=None, timeout=None):
        seen.update(service=service, url=url, params=params, headers=headers, timeout=timeout)
        return json.loads((FIXTURES / "youcom_zuerich_2027.json").read_text(encoding="utf-8"))["body"]
    monkeypatch.setattr(http, "get_json", fake)
    pages = youcom.fetch_pages(youcom.build_query("Zürich", "ZH", 2027))
    assert pages and all({"url", "title", "markdown"} <= set(p) for p in pages)
    assert seen["headers"] == {"X-API-Key": "secret-test-key"}
    assert "secret-test-key" not in json.dumps(seen["params"])
    assert seen["params"]["livecrawl"] == "web" and seen["timeout"] <= 8
    assert seen["params"]["query"] == "Feiertage Zürich Kanton Zürich 2027"


# --- GET /api/holidays ---------------------------------------------------------------------------

def query(**over):
    q = {"year": str(NEXT_YEAR), "location_id": "bfs-261", "canton": "ZH", "municipality_id": "261",
         "municipality": "Zürich"}
    q.update(over)
    return q


@pytest.fixture(autouse=True)
def clear_caches():
    holidays_route._cache.clear()
    holidays_route._failures.clear()
    yield


def test_cache_key_is_municipality_canton_year():
    assert holidays_route.cache_key(261, "ZH", 2027) == (261, "ZH", 2027)


def fixture_with_year(fixture, year):
    # The fixtures are for 2027; shift them to the tested year so the route can be exercised.
    text = (FIXTURES / fixture).read_text(encoding="utf-8").replace(".2027", f".{year}").replace(" 2027", f" {year}")
    body = json.loads(text)["body"]
    return [{"url": w["url"], "title": w.get("title", ""), "markdown": (w.get("contents") or {}).get("markdown", "")}
            for w in body["results"]["web"]]


def test_api_merges_and_caches(client, monkeypatch):
    calls = []
    monkeypatch.setattr(youcom, "fetch_pages", lambda q: calls.append(q) or fixture_with_year("youcom_zuerich_2027.json", NEXT_YEAR))
    res = client.get("/api/holidays", query_string=query())
    assert res.status_code == 200
    data = res.get_json()
    assert data["summary"]["checked"] is True and data["summary"]["confirmed"] >= 1
    assert all("key" in h and "|" in h["key"] for h in data["holidays"])
    assert data["sources"] and all(s["url"].startswith("https://") for s in data["sources"])
    client.get("/api/holidays", query_string=query())
    assert len(calls) == 1                                   # second request served from the cache


@pytest.mark.parametrize("exc,code", [
    (youcom.YouComUnavailable("youcom", "no_api_key"), "youcom_not_configured"),
    (youcom.YouComUnavailable("youcom", "quota"), "youcom_quota"),
    (http.UpstreamError("youcom", "ReadTimeout"), "youcom_unavailable"),
])
def test_youcom_down_returns_baseline_with_warning(client, monkeypatch, exc, code):
    calls = []
    def down(q):
        calls.append(q)
        raise exc
    monkeypatch.setattr(youcom, "fetch_pages", down)
    data = client.get("/api/holidays", query_string=query()).get_json()
    assert [w["code"] for w in data["warnings"]] == [code]
    assert data["summary"]["checked"] is False
    names = {h["name"] for h in data["holidays"]}
    assert {"Karfreitag", "Nationalfeiertag"} <= names
    assert all(h["confidence"] == "medium" for h in data["holidays"])
    assert "ReadTimeout" not in json.dumps(data)
    client.get("/api/holidays", query_string=query())
    assert len(calls) == 1                                   # failure cached briefly (protects the quota)


def test_no_usable_page_warns(client, monkeypatch):
    monkeypatch.setattr(youcom, "fetch_pages", lambda q: [])
    data = client.get("/api/holidays", query_string=query()).get_json()
    assert [w["code"] for w in data["warnings"]] == ["youcom_no_data"]


@pytest.mark.parametrize("over,code", [
    ({"year": "1999"}, "invalid_year"), ({"canton": "XX"}, "invalid_canton"),
    ({"location_id": "x"}, "invalid_location_id"), ({"municipality_id": "abc"}, "invalid_municipality_id"),
])
def test_invalid_query(client, monkeypatch, over, code):
    monkeypatch.setattr(youcom, "fetch_pages", lambda q: pytest.fail("must not call"))
    res = client.get("/api/holidays", query_string=query(**over))
    assert res.status_code == 400 and res.get_json()["error"]["code"] == code


# --- Baden (AG): municipality page vs. canton-wide baseline (owner report, "flag only") -----------

def baden_merged():
    data = json.loads((FIXTURES / "youcom_baden_ag_2026.json").read_text(encoding="utf-8"))
    found = youcom.parse_pages(data["pages"], year=2026, municipality="Baden", canton="AG", retrieved_at="t")
    return found, by_name(merge_holidays(baseline_holidays("AG", [2026], "t"), found, year=2026, canton="AG",
                                         municipality="Baden"))


def test_page_scope_from_title():
    assert youcom.page_scope("Feiertage Gemeinde Baden 2026 (Ereignisse und Feiertage)", "Baden") == "municipality"
    assert youcom.page_scope("Feiertage Stadt Bern 2027", "Bern") == "municipality"
    assert youcom.page_scope("Feiertage Bezirk Baden 2026", "Baden") == "region"
    assert youcom.page_scope("Feiertage Kanton Zürich 2027 (Gesetzliche Feiertage)", "Zürich") == "canton"
    assert youcom.page_scope("Feiertage 2026 und 2027 in Aargau - Ferienwiki", "Baden") == "other"


def test_baden_catholic_holidays_are_flagged_not_removed():
    found, merged = baden_merged()
    assert any(f.page_scope == "municipality" for f in found)
    for name in ("Mariä Empfängnis", "Mariä Himmelfahrt", "Allerheiligen", "Berchtoldstag"):
        h = merged[name]
        assert h.disputed and h.enabled and h.confidence == "medium"       # flagged; the planner treats it as off
        assert "Gemeinde Baden" in h.conflict
    assert "11.6 %" in merged["Mariä Empfängnis"].conflict
    assert merged["Fronleichnam"].confidence == "high" and not merged["Fronleichnam"].disputed
    assert merged["Karfreitag"].confidence == "high" and not merged["Karfreitag"].disputed


def test_no_municipality_page_no_flags():
    merged = by_name(merged_for("youcom_zuerich_2027.json", "Zürich", "ZH"))
    assert not any(h.disputed for h in merged.values())


def test_municipality_page_without_classes_contradicts_nothing():
    # Live crawl 2026-10-03: the Gemeinde Baden page came back without classes and only
    # from October on. It must not turn every holiday into a disputed one.
    data = json.loads((FIXTURES / "youcom_baden_ag_2026_unclassified.json").read_text(encoding="utf-8"))
    found = youcom.parse_pages(data["pages"], year=2026, municipality="Baden", canton="AG", retrieved_at="t")
    municipal = [f for f in found if f.page_scope == "municipality"]
    assert municipal and all(f.kind == "unclassified" for f in municipal)
    merged = by_name(merge_holidays(baseline_holidays("AG", [2026], "t"), found, year=2026, canton="AG",
                                    municipality="Baden"))
    for name in ("Neujahrstag", "Karfreitag", "Weihnachten", "Stephanstag"):
        assert not any("Gemeinde Baden" in (h.conflict or "") for h in [merged[name]]), name
    assert not merged["Weihnachten"].disputed
