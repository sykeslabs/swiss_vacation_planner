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
    assert zh["candidates"] == [] and zh["summary"] is None
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
