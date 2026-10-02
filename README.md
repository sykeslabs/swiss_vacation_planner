# Ferienplaner Schweiz

Flask app for planning Swiss vacations. The spec is in `docs/SPEC.md`, the plan in `docs/PLAN.md`. The full README (env vars, API contracts, deploy) follows in M8.

## Local development

```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements-dev.txt     # Windows; on macOS/Linux: .venv/bin/pip
.venv/Scripts/python -m pytest                         # Python tests (offline)
node --test "tests/js/*.test.mjs"                      # frontend logic tests (offline, no npm deps)
vercel dev                                             # http://localhost:3000 (next free port if taken)
```

- `vercel dev` finds `.venv` on its own. **Don't activate the venv or set `VIRTUAL_ENV`** before running it. Otherwise the CLI calls the system `python3`, which on Windows can be the Microsoft Store stub (exit code 9009).
- When starting `vercel dev` from a script or a background job, merge stderr (`vercel dev 2>&1`). Otherwise the Python dev server can die silently on its first log line, and every request returns `FUNCTION_INVOCATION_FAILED`. An interactive terminal isn't affected. If requests still start failing with `FUNCTION_INVOCATION_FAILED` after a while (seen occasionally on Windows), restart `vercel dev`, or use `flask run` (below), which serves the identical app.
- On Windows, stopping `vercel dev` from a parent shell can leave its `node.exe`/`python.exe` children running and holding the port. If the next start reports a different port, end those processes first.
- Without Vercel: `.venv/Scripts/python -m flask --app wsgi run` serves the same app at `http://localhost:5000`. Flask serves `public/` at `/`, just like Vercel's CDN.
