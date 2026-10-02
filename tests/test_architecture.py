"""Static checks for the architecture rules in CLAUDE.md (rules 1 and 3)."""

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _imported_modules(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    mods = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            mods.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            mods.add(node.module)
            # `from services import openrouter` must count as services.openrouter
            mods.update(f"{node.module}.{alias.name}" for alias in node.names)
    return mods


def _py_files(*dirs: str):
    for d in dirs:
        yield from (ROOT / d).rglob("*.py")


NETWORK_MODULES = {"requests", "httpx", "urllib.request", "http.client", "socket", "aiohttp"}


def test_domain_never_imports_services_or_network():
    for path in _py_files("domain"):
        for mod in _imported_modules(path):
            assert not mod.startswith("services"), f"{path} imports {mod}"
            assert not mod.startswith("app"), f"{path} imports {mod}"
            assert mod.split(".")[0] not in NETWORK_MODULES and mod not in NETWORK_MODULES, \
                f"{path} imports network module {mod}"


def test_openrouter_only_imported_by_travel_route():
    allowed = {ROOT / "app" / "routes" / "travel.py", ROOT / "services" / "openrouter.py"}
    for path in _py_files("app", "domain", "services"):
        if path in allowed:
            continue
        for mod in _imported_modules(path):
            assert "openrouter" not in mod, f"{path} imports {mod}"
