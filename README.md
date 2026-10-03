# Adam – Ferien clever planen

Flask app for planning Swiss vacations. The spec is in `docs/SPEC_V1.md`, the plan in `docs/PLAN.md`. The full README (env vars, API contracts, deploy) follows in M8.

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
- Environment (see `.env.example`; locally in `.env`, on Vercel in the project settings for Production, Preview and Development):
  - `YDC_API_KEY` (You.com, holiday check). Without it the planner works with the cantonal reference calendar and shows a warning.
  - `OPENROUTER_API_KEY` (optional travel ideas, from M7).
  - "Über Adam" help modal: `ADAM_CONTACT_EMAIL` (mailto link), `ADAM_WEBSITE_URL` (optional), `ADAM_DONATE_URL` (donate button), `ADAM_DONATE_LABEL` (optional, default "Spenden"). The server injects them into the page; a missing or invalid value hides its element. They are public by design (shown to every visitor); never put secrets there.
  - `flask run` loads `.env` via python-dotenv (dev dependency).
- Chrome refuses some ports (e.g. 5060/5061, "unsafe port"); use another port for local servers.
- Without Vercel: `.venv/Scripts/python -m flask --app wsgi run` serves the same app at `http://localhost:5000`. Flask serves `public/` at `/`, just like Vercel's CDN.
