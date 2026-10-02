"""Builds data/postcodes.json (BFS municipality number -> postcodes) from the official
swisstopo locality directory ("Amtliches Ortschaftenverzeichnis", swisstopo OGD terms:
free use, source must be credited).

Run occasionally (the directory changes a few times a year):
    .venv/Scripts/python scripts/build_postcodes.py
"""

import csv
import io
import json
import urllib.request
import zipfile
from datetime import UTC, datetime
from pathlib import Path

SOURCE_URL = ("https://data.geo.admin.ch/ch.swisstopo-vd.ortschaftenverzeichnis_plz/"
              "ortschaftenverzeichnis_plz/ortschaftenverzeichnis_plz_4326.csv.zip")
# A postcode is listed for a municipality if at least this share of its addresses lies
# there; smaller shares are border slivers (e.g. 0.06 % of 8134 Adliswil in Zürich).
MIN_ADDRESS_SHARE_PERCENT = 10.0
OUT = Path(__file__).resolve().parent.parent / "data" / "postcodes.json"


def parse_share(text: str) -> float:
    return float(text.replace("%", "").strip())


def build(csv_text: str) -> dict[str, list[str]]:
    by_bfs: dict[str, set[str]] = {}
    for row in csv.DictReader(io.StringIO(csv_text), delimiter=";"):
        if parse_share(row["Adressenanteil"]) < MIN_ADDRESS_SHARE_PERCENT:
            continue
        by_bfs.setdefault(str(int(row["BFS-Nr"])), set()).add(row["PLZ4"])
    return {bfs: sorted(plz) for bfs, plz in sorted(by_bfs.items(), key=lambda kv: int(kv[0]))}


def main() -> None:
    raw = urllib.request.urlopen(SOURCE_URL, timeout=60).read()
    archive = zipfile.ZipFile(io.BytesIO(raw))
    name = next(n for n in archive.namelist() if n.endswith(".csv"))
    by_bfs = build(archive.read(name).decode("utf-8-sig"))
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({
        "source": "Amtliches Ortschaftenverzeichnis (swisstopo)",
        "source_url": SOURCE_URL,
        "retrieved_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "min_address_share_percent": MIN_ADDRESS_SHARE_PERCENT,
        "by_bfs": by_bfs,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{OUT}: {len(by_bfs)} municipalities")


if __name__ == "__main__":
    main()
