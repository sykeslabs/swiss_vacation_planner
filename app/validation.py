"""Request validation. Converts JSON payloads into domain inputs or raises ApiError(400)."""

from datetime import UTC, date, datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from app.errors import ApiError
from domain.calendar import calendar_window
from domain.models import CANTONS, Location
from domain.working_days import WEEKDAY_CODES

MAX_LOCATIONS = 10
MAX_HALF_DAYS = 100
MAX_EXTRA_HOLIDAYS = 30
SELECTABLE_YEARS_AHEAD = 2      # D9: current year … current year + 2


def selectable_years(today: date | None = None) -> range:
    year = (today or datetime.now(UTC).date()).year
    return range(year, year + SELECTABLE_YEARS_AHEAD + 1)


class LocationIn(BaseModel):
    # The client echoes Location objects from /api/locations; unknown keys are ignored.
    model_config = ConfigDict(extra="ignore")

    id: Annotated[str, Field(pattern=r"^bfs-\d{1,5}(-plz-\d{4})?$")]
    name: Annotated[str, Field(min_length=1, max_length=100)]
    postcode: Annotated[str, Field(pattern=r"^\d{4}$")] | None = None
    municipality: Annotated[str, Field(min_length=1, max_length=100)]
    municipality_id: Annotated[int, Field(ge=1, lt=9000)]
    canton: str
    latitude: Annotated[float, Field(ge=45.5, le=48.0)]
    longitude: Annotated[float, Field(ge=5.8, le=10.6)]
    source: str = ""
    source_url: str = ""
    retrieved_at: str = ""
    postcodes: Annotated[list[Annotated[str, Field(pattern=r"^\d{4}$")]], Field(max_length=200)] = []

    @field_validator("canton")
    @classmethod
    def known_canton(cls, v: str) -> str:
        if v not in CANTONS:
            raise ValueError("unknown canton")
        return v

    def to_domain(self) -> Location:
        data = self.model_dump()
        data["postcodes"] = tuple(data["postcodes"])
        return Location(**data)


class ExtraHolidayIn(BaseModel):
    """An optional (web-only) holiday the user enabled for one location."""
    model_config = ConfigDict(extra="forbid")

    date: date
    name: Annotated[str, Field(min_length=1, max_length=100)]
    work_fraction: Annotated[float, Field(ge=0, le=0.5)] = 0.0


class OptimizeIn(BaseModel):
    # extra="forbid": e.g. vacation_type must never reach the optimizer (CLAUDE.md rule 5).
    model_config = ConfigDict(extra="forbid")

    year: int
    locations: Annotated[list[LocationIn], Field(min_length=1, max_length=MAX_LOCATIONS)]
    working_days: list[str]
    half_days: dict[date, float] = Field(default_factory=dict)
    vacation_budget: Annotated[float, Field(ge=0, le=366)] | None = None
    extra_holidays: dict[str, Annotated[list[ExtraHolidayIn], Field(max_length=MAX_EXTRA_HOLIDAYS)]] =         Field(default_factory=dict)


# User-facing messages per field (Swiss Standard German).
_FIELD_MESSAGES = {
    "year": "Ungültiges Jahr.",
    "locations": "Bitte wähle 1 bis 10 gültige Orte.",
    "working_days": "Bitte wähle mindestens einen gültigen Arbeitstag.",
    "half_days": "Ungültige halbe Arbeitstage.",
    "vacation_budget": "Ungültige Anzahl Ferientage.",
    "extra_holidays": "Ungültige zusätzliche Feiertage.",
}


def _fail(code: str, message: str):
    raise ApiError(400, code, message)


def parse_optimize(payload) -> OptimizeIn:
    if not isinstance(payload, dict):
        _fail("invalid_request", "Ungültige Anfrage.")
    try:
        req = OptimizeIn.model_validate(payload)
    except ValidationError as exc:
        first = exc.errors()[0]
        field = str(first["loc"][0]) if first["loc"] else ""
        if first["type"] == "extra_forbidden":
            _fail("unknown_field", f"Unbekanntes Feld: {field}.")
        _fail(f"invalid_{field}" if field else "invalid_request",
              _FIELD_MESSAGES.get(field, "Ungültige Anfrage."))

    if req.year not in selectable_years():
        years = selectable_years()
        _fail("invalid_year", f"Das Jahr muss zwischen {years[0]} und {years[-1]} liegen.")
    if not req.working_days or len(set(req.working_days)) != len(req.working_days) \
            or any(d not in WEEKDAY_CODES for d in req.working_days):
        _fail("invalid_working_days", _FIELD_MESSAGES["working_days"])
    if len(req.half_days) > MAX_HALF_DAYS:
        _fail("invalid_half_days", "Zu viele halbe Arbeitstage.")
    start, end = calendar_window(req.year)
    for day, fraction in req.half_days.items():
        if not start <= day <= end:
            _fail("invalid_half_days", "Halbe Arbeitstage müssen im angezeigten Zeitraum liegen.")
        if not 0 < fraction < 1:
            _fail("invalid_half_days", "Ein halber Arbeitstag muss zwischen 0 und 1 liegen.")
    ids = {loc.id for loc in req.locations}
    for loc_id, extras in req.extra_holidays.items():
        if loc_id not in ids or any(not start <= x.date <= end for x in extras):
            _fail("invalid_extra_holidays", _FIELD_MESSAGES["extra_holidays"])
    towns = {loc.to_domain().town_key() for loc in req.locations}
    if len({loc.id for loc in req.locations}) != len(req.locations) or len(towns) != len(req.locations):
        _fail("invalid_locations", "Jeder Ort darf nur einmal vorkommen.")
    return req


class HolidaysQuery(BaseModel):
    model_config = ConfigDict(extra="ignore")

    year: int
    location_id: Annotated[str, Field(pattern=r"^bfs-\d{1,5}(-plz-\d{4})?$")]
    canton: str
    municipality_id: Annotated[int, Field(ge=1, lt=9000)]
    municipality: Annotated[str, Field(min_length=1, max_length=100)]

    @field_validator("canton")
    @classmethod
    def known_canton(cls, v: str) -> str:
        if v not in CANTONS:
            raise ValueError("unknown canton")
        return v


def parse_holidays_query(args) -> HolidaysQuery:
    try:
        q = HolidaysQuery.model_validate(dict(args))
    except ValidationError as exc:
        field = str(exc.errors()[0]["loc"][0]) if exc.errors()[0]["loc"] else ""
        messages = {"year": "Ungültiges Jahr.", "canton": "Unbekannter Kanton."}
        _fail(f"invalid_{field}" if field else "invalid_request",
              messages.get(field, "Ungültiger Ort."))
    if q.year not in selectable_years():
        years = selectable_years()
        _fail("invalid_year", f"Das Jahr muss zwischen {years[0]} und {years[-1]} liegen.")
    return q
