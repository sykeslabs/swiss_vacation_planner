"""scripts/build_postcodes.py, offline (no download)."""

import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "build_postcodes", Path(__file__).resolve().parent.parent / "scripts" / "build_postcodes.py")
build_postcodes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build_postcodes)

CSV = """Ortschaftsname;PLZ4;Zusatzziffer;ZIP_ID;Gemeindename;BFS-Nr;Kantonskürzel;Adressenanteil;E;N;Sprache;Validity
Zürich;8001;0;1;Zürich;261;ZH;100 %;8.5;47.3;de;2008-07-01
Zürich;8002;0;2;Zürich;261;ZH;99.5 %;8.5;47.3;de;2008-07-01
Adliswil;8134;0;3;Zürich;261;ZH;0.06 %;8.5;47.3;de;2008-07-01
Adliswil;8134;0;3;Adliswil;131;ZH;99.94 %;8.5;47.3;de;2008-07-01
Zürich;8001;0;1;Zürich;261;ZH;100 %;8.5;47.3;de;2008-07-01
"""


def test_build_filters_border_slivers_and_dedupes():
    assert build_postcodes.build(CSV) == {"131": ["8134"], "261": ["8001", "8002"]}


def test_bundled_file_is_well_formed():
    import json
    data = json.loads(build_postcodes.OUT.read_text(encoding="utf-8"))
    assert data["source_url"].startswith("https://data.geo.admin.ch/")
    assert len(data["by_bfs"]) > 2000
    assert all(len(p) == 4 and p.isdigit() for plz in data["by_bfs"].values() for p in plz)
