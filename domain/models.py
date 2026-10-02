"""Domain models. External data is normalised into these before it reaches domain logic."""

from dataclasses import asdict, dataclass


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

    def to_dict(self) -> dict:
        return asdict(self)
