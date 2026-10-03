from datetime import UTC, datetime

import pytest

YEAR = datetime.now(UTC).year + 1

ZURICH = {"id": "bfs-261", "name": "Zürich", "postcode": None, "municipality": "Zürich",
          "municipality_id": 261, "canton": "ZH", "latitude": 47.37, "longitude": 8.53,
          "source": "GeoAdmin (swisstopo)", "source_url": "https://api3.geo.admin.ch/",
          "retrieved_at": "2026-10-02T00:00:00+00:00"}
APPENZELL = {**ZURICH, "id": "bfs-3101", "name": "Appenzell", "municipality": "Appenzell",
             "municipality_id": 3101, "canton": "AI", "latitude": 47.33, "longitude": 9.40}


def payload(**overrides):
    body = {"year": YEAR, "locations": [ZURICH], "working_days": ["MON", "TUE", "WED", "THU", "FRI"],
            "half_days": {f"{YEAR}-12-24": 0.5}, "vacation_budget": None}
    body.update(overrides)
    return body


def post(client, body):
    return client.post("/api/optimize", json=body)


def test_returns_days_per_location(client):
    res = post(client, payload(locations=[ZURICH, APPENZELL]))
    assert res.status_code == 200
    data = res.get_json()
    assert data["year"] == YEAR
    assert set(data["per_location"]) == {"bfs-261", "bfs-3101"}
    zh = data["per_location"]["bfs-261"]
    assert zh["days"][0]["date"] == f"{YEAR - 1}-12-01"
    assert zh["days"][-1]["date"] == f"{YEAR + 1}-01-31"
    assert zh["candidates"] and zh["summary"]["candidates_count"] >= len(zh["candidates"])
    c = zh["candidates"][0]
    assert set(c) == {"location_id", "start", "end", "days_free", "vacation_days_required", "efficiency",
                      "anchor_holidays", "vacation_days_by_year", "vacation_dates"}
    assert zh["candidates"] == sorted(zh["candidates"], key=lambda c: (c["start"], c["end"]))
    assert all(z["days_free"] >= 3 for z in zh["zero_cost"])
    assert {"holidays_total", "holidays_on_working_days", "best", "budget"} <= set(zh["summary"])
    assert zh["warnings"] == []          # holiday warnings come from GET /api/holidays
    assert {h["source"] for h in zh["holidays"]} == {"Referenzkalender (Python-Paket holidays)"}
    day = next(d for d in zh["days"] if d["date"] == f"{YEAR}-12-24")
    assert set(day) == {"date", "weekday", "in_planned_year", "is_working_day", "is_weekend",
                        "is_holiday", "holiday_names", "holiday_on_non_working_day",
                        "work_fraction", "is_vacation", "is_free", "in_selected_period"}


def test_villages_of_one_municipality_are_allowed(client):
    wengen = {**ZURICH, "id": "bfs-584-plz-3823", "name": "Wengen", "postcode": "3823",
              "municipality": "Lauterbrunnen", "municipality_id": 584, "canton": "BE"}
    lauterbrunnen = {**wengen, "id": "bfs-584", "name": "Lauterbrunnen", "postcode": None,
                     "postcodes": ["3822", "3823"]}
    assert post(client, payload(locations=[wengen, lauterbrunnen])).status_code == 200


def test_locations_with_different_holidays(client):
    data = post(client, payload(locations=[ZURICH, APPENZELL])).get_json()["per_location"]
    zh_hol = {d["date"] for d in data["bfs-261"]["days"] if d["is_holiday"]}
    ai_hol = {d["date"] for d in data["bfs-3101"]["days"] if d["is_holiday"]}
    assert zh_hol != ai_hol


def test_half_day_applied(client):
    data = post(client, payload()).get_json()["per_location"]["bfs-261"]
    day = next(d for d in data["days"] if d["date"] == f"{YEAR}-12-24")
    assert day["work_fraction"] == (0.5 if day["is_working_day"] else 0)


def test_identical_requests_give_identical_responses(client):
    a = post(client, payload()).get_json()
    b = post(client, payload()).get_json()
    strip = lambda r: [(d["date"], d["is_free"], d["work_fraction"]) for d in r["per_location"]["bfs-261"]["days"]]
    assert strip(a) == strip(b)


@pytest.mark.parametrize("overrides,code", [
    ({"working_days": []}, "invalid_working_days"),
    ({"working_days": ["MON", "FUN"]}, "invalid_working_days"),
    ({"working_days": ["MON", "MON"]}, "invalid_working_days"),
    ({"year": YEAR + 5}, "invalid_year"),
    ({"year": YEAR - 3}, "invalid_year"),
    ({"year": "next"}, "invalid_year"),
    ({"locations": []}, "invalid_locations"),
    ({"locations": [ZURICH, ZURICH]}, "invalid_locations"),
    ({"locations": [ZURICH, {**ZURICH, "id": "bfs-261-plz-8001", "postcode": "8001"}]}, "invalid_locations"),
    ({"locations": [{**ZURICH, "postcodes": ["80O1"]}]}, "invalid_locations"),
    ({"locations": [{**ZURICH, "canton": "XX"}]}, "invalid_locations"),
    ({"locations": [{**ZURICH, "latitude": 52.5}]}, "invalid_locations"),
    ({"locations": [{**ZURICH, "id": f"bfs-{i}"} for i in range(1, 12)]}, "invalid_locations"),
    ({"half_days": {"2027-13-40": 0.5}}, "invalid_half_days"),
    ({"half_days": {"2001-12-24": 0.5}}, "invalid_half_days"),
    ({"half_days": {f"{YEAR}-12-24": 1.5}}, "invalid_half_days"),
    ({"vacation_budget": -1}, "invalid_vacation_budget"),
    ({"vacation_type": "beach"}, "unknown_field"),
    ({"custom_holidays": [{"date": f"{YEAR + 3}-03-01", "name": "X"}]}, "invalid_custom_holidays"),
    ({"custom_holidays": [{"date": f"{YEAR}-03-01", "name": ""}]}, "invalid_custom_holidays"),
    ({"custom_holidays": [{"date": f"{YEAR}-03-01", "name": "X", "work_fraction": 0.5}]}, "invalid_custom_holidays"),
    ({"extra_holidays": {"bfs-999": [{"date": f"{YEAR}-04-19", "name": "X"}]}}, "invalid_extra_holidays"),
    ({"extra_holidays": {"bfs-261": [{"date": f"{YEAR + 3}-04-19", "name": "X"}]}}, "invalid_extra_holidays"),
    ({"extra_holidays": {"bfs-261": [{"date": f"{YEAR}-04-19", "name": "X", "work_fraction": 0.9}]}},
     "invalid_extra_holidays"),
])
def test_invalid_input_returns_400(client, overrides, code):
    res = post(client, payload(**overrides))
    assert res.status_code == 400
    assert res.get_json()["error"]["code"] == code
    assert res.get_json()["error"]["message"]


def test_non_json_body(client):
    res = client.post("/api/optimize", data="nope", content_type="text/plain")
    assert res.status_code == 400


def test_enabled_optional_holiday_frees_the_day(client):
    # 3rd Monday of April in YEAR — a working day without a baseline holiday in ZH
    from datetime import date, timedelta
    d = date(YEAR, 4, 15)
    while d.weekday() != 0:
        d += timedelta(days=1)
    body = payload(extra_holidays={"bfs-261": [{"date": d.isoformat(), "name": "Sechseläuten"}]})
    data = post(client, body).get_json()["per_location"]["bfs-261"]
    day = next(x for x in data["days"] if x["date"] == d.isoformat())
    assert day["is_holiday"] and day["is_free"] and day["holiday_names"] == ["Sechseläuten"]
    extra = next(h for h in data["holidays"] if h["name"] == "Sechseläuten")
    assert extra["confidence"] == "low" and extra["source"] == "Websuche (You.com)"
    without = post(client, payload()).get_json()["per_location"]["bfs-261"]
    assert not next(x for x in without["days"] if x["date"] == d.isoformat())["is_holiday"]


def test_budget_limits_list_and_best(client):
    free = post(client, payload()).get_json()["per_location"]["bfs-261"]
    one = post(client, payload(vacation_budget=1)).get_json()["per_location"]["bfs-261"]
    assert len(one["candidates"]) < len(free["candidates"])
    assert all(c["vacation_days_by_year"].get(str(YEAR), 0) <= 1 for c in one["candidates"])
    assert one["summary"]["budget"] == 1
    best = one["summary"]["best"]
    assert best is None or best["vacation_days_by_year"].get(str(YEAR), 0) <= 1


def test_switched_off_baseline_holiday_is_a_working_day_again(client):
    plain = post(client, payload()).get_json()["per_location"]["bfs-261"]
    hol = next(h for h in plain["holidays"] if h["date"].startswith(str(YEAR)) and h["name"] == "Karfreitag")
    key = f"{hol['date']}|{hol['name']}"
    off = post(client, payload(disabled_holidays={"bfs-261": [key]})).get_json()["per_location"]["bfs-261"]
    day = next(d for d in off["days"] if d["date"] == hol["date"])
    assert not day["is_holiday"] and day["is_working_day"]
    assert all(h["name"] != "Karfreitag" or not h["date"].startswith(str(YEAR)) for h in off["holidays"])


@pytest.mark.parametrize("value", [{"bfs-999": ["2027-01-01|X"]}, {"bfs-261": ["nope"]}])
def test_invalid_disabled_holidays(client, value):
    res = post(client, payload(disabled_holidays=value))
    assert res.status_code == 400


def _first_monday(month: int):
    from datetime import date, timedelta
    d = date(YEAR, month, 1)
    while d.weekday() != 0:
        d += timedelta(days=1)
    return d


def test_custom_holiday_applies_to_every_location(client):
    d = _first_monday(3)
    body = payload(locations=[ZURICH, APPENZELL], custom_holidays=[{"date": d.isoformat(), "name": "Firmenjubiläum"}])
    data = post(client, body).get_json()["per_location"]
    for loc_id in ("bfs-261", "bfs-3101"):
        day = next(x for x in data[loc_id]["days"] if x["date"] == d.isoformat())
        assert day["is_holiday"] and day["is_free"] and "Firmenjubiläum" in day["holiday_names"]
        own = next(h for h in data[loc_id]["holidays"] if h["name"] == "Firmenjubiläum")
        assert own["type"] == "custom" and own["source"] == "Eigene Eingabe"


def test_custom_holiday_changes_the_recommended_plan(client):
    d = _first_monday(3)
    plain = post(client, payload(vacation_budget=25)).get_json()["per_location"]["bfs-261"]["summary"]
    own = post(client, payload(vacation_budget=25, custom_holidays=[{"date": d.isoformat(), "name": "Brückentag"}]))
    summary = own.get_json()["per_location"]["bfs-261"]["summary"]
    assert summary["holidays_total"] == plain["holidays_total"] + 1
    assert summary["plan"] != plain["plan"]


def test_custom_period_of_31_days_yearly_fits_the_limits(client):
    from datetime import date, timedelta
    days = [date(YEAR - 1, 12, 1) + timedelta(days=i) for i in range(400)]
    days = [d for d in days if d <= date(YEAR + 1, 1, 31)]
    body = payload(custom_holidays=[{"date": d.isoformat(), "name": "Betriebsferien"} for d in days[:120]],
                   half_days={d.isoformat(): 0.5 for d in days[200:330]})
    assert post(client, body).status_code == 200
