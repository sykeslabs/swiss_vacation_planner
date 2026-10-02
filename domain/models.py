"""Domain models. External data is normalised into these before it reaches domain logic."""

from dataclasses import asdict, dataclass, field
from datetime import date

CANTON_NAMES = {
    "AG": "Aargau", "AI": "Appenzell Innerrhoden", "AR": "Appenzell Ausserrhoden", "BE": "Bern",
    "BL": "Basel-Landschaft", "BS": "Basel-Stadt", "FR": "Freiburg", "GE": "Genf", "GL": "Glarus",
    "GR": "Graubünden", "JU": "Jura", "LU": "Luzern", "NE": "Neuenburg", "NW": "Nidwalden",
    "OW": "Obwalden", "SG": "St. Gallen", "SH": "Schaffhausen", "SO": "Solothurn", "SZ": "Schwyz",
    "TG": "Thurgau", "TI": "Tessin", "UR": "Uri", "VD": "Waadt", "VS": "Wallis", "ZG": "Zug",
    "ZH": "Zürich",
}
CANTONS = frozenset(CANTON_NAMES)


@dataclass(frozen=True)
class Location:
    """A Swiss place the user plans for. Provenance fields record where it came from."""

    id: str                    # "bfs-<BFS>" or "bfs-<BFS>-plz-<postcode>"
    name: str                  # display name (municipality or postcode locality)
    postcode: str | None       # set only when found via postcode
    municipality: str
    municipality_id: int       # BFS municipality number
    canton: str                # two-letter canton code, e.g. "ZH"
    latitude: float
    longitude: float
    source: str
    source_url: str
    retrieved_at: str          # ISO 8601, UTC
    postcodes: tuple[str, ...] = ()   # all postcodes of the municipality (name searches)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["postcodes"] = list(self.postcodes)
        return d

    def town_key(self) -> tuple[int, str]:
        """Two entries are the same town if municipality and place name match
        ("Baden" and "5400 Baden"); different villages of one municipality stay apart."""
        return self.municipality_id, self.name.casefold()


@dataclass(frozen=True)
class Holiday:
    date: date
    name: str
    type: str                  # "public" (more types once You.com data arrives in M4)
    jurisdiction: str          # "national" | "canton" | "municipality"
    canton: str | None
    municipality: str | None
    source: str
    source_url: str
    source_title: str
    retrieved_at: str
    confidence: str            # "high" | "medium" | "low"
    conflict: str | None = None
    work_fraction: float = 0.0  # share of the day still worked: 0 = whole day off, 0.5 = afternoon off
    enabled: bool = True        # False: shown, but not used by the optimizer until the user enables it
    corroborated_by: tuple[str, ...] = ()   # URLs of web pages that confirm this holiday
    note: str | None = None     # short German explanation (e.g. why it's optional)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["date"] = self.date.isoformat()
        d["corroborated_by"] = list(self.corroborated_by)
        return d


@dataclass(frozen=True)
class FoundHoliday:
    """A holiday row parsed from a web page (You.com search result), before merging.

    kind: "legal" (gesetzlich / den Sonntagen gleichgestellt), "half" (halber Feiertag),
          "unofficial" (gesetzlich nicht anerkannt, oft arbeitsfrei), "partial" (nur in
          Teilen der Region gültig), "unclassified" (no class information on the page).
    """

    date: date
    name: str
    kind: str
    share_percent: float | None
    source_url: str
    source_title: str
    retrieved_at: str


@dataclass(frozen=True)
class DayInfo:
    """One calendar day. The displayed category is derived from these attributes only
    (frontend `dayCategory()`), never stored."""

    date: date
    weekday: str               # "MON" … "SUN"
    in_planned_year: bool      # False for the boundary months (Dec before, Jan after)
    is_working_day: bool       # weekday is configured as a working day
    is_weekend: bool           # Saturday or Sunday
    is_holiday: bool
    holiday_names: tuple[str, ...]
    holiday_on_non_working_day: bool
    work_fraction: float       # 1, 0.5 or 0: share of a working day that has to be worked
    is_vacation: bool = False
    is_free: bool = False
    in_selected_period: bool = False

    def to_dict(self) -> dict:
        d = asdict(self)
        d["date"] = self.date.isoformat()
        d["holiday_names"] = list(self.holiday_names)
        return d


@dataclass(frozen=True)
class CalendarConfig:
    year: int
    working_days: frozenset[int]                       # ISO weekday numbers 1 (Mon) … 7 (Sun)
    half_days: dict[date, float] = field(default_factory=dict)
