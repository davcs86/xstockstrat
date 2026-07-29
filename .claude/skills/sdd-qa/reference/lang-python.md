# QA reference — Python

Services: `xstockstrat-indicators`, `xstockstrat-ingest`, `xstockstrat-analysis`,
`xstockstrat-agent`. Load this file only when the target is one of them.

## Layout

pytest, with `tests/test_*.py` mirroring the `app/` tree. All four services set
`asyncio_mode = "auto"` and `testpaths = ["tests"]` under `[tool.pytest.ini_options]`, so an async
test needs **no** `@pytest.mark.asyncio` decorator — just `async def test_…`.

`tests/conftest.py` is the existing fixture home in all four services. Under the widened **C-12**
this is already the canonical place for shared domain data; a second consumer of an inline literal
moves it here rather than to a new inventory file.

## Commands

Dependencies are managed by `uv`. `uv lock --check` is CI-enforced, so any `pyproject.toml` change
needs a committed `uv.lock` in the same PR.

```bash
cd services/xstockstrat-<svc>
uv sync --extra dev
uv run pytest tests/test_x.py::test_case -v     # one case
uv run pytest                                    # full suite
uv run pytest --cov=app --cov-fail-under=<n>     # coverage as CI runs it
uv run ruff check . && uv run ruff format --check .
```

`xstockstrat-agent` covers the `app` package too; confirm the `--cov=` target against the service's
own CI matrix row rather than assuming.

## The coverage trap

Thresholds differ: **`xstockstrat-indicators` is 50%**, the other three are 40%
(`.github/workflows/ci.yml:334-344`). `docs/patterns/ci-overview.md` is the reference; do not
restate numbers here.

More subtly, `xstockstrat-indicators` carries a `[tool.coverage.run] omit` list —
`app/services/sandbox.py`, `app/telemetry.py`, `app/main.py`, `app/handlers/servicer.py`,
`app/config/watcher.py`. A test covering an omitted module will not move the percentage. The other
three services currently have no omit list. **Read the target's `pyproject.toml` before promising a
coverage delta** — the omit list changes per service and drifts.

## Designing a case

Prefer a real computation with a hand-worked expected value over a mock that asserts its own setup.
For sandboxed formula execution and backtest determinism, the valuable assertions are the invariants
the service owner cares about: no look-ahead bias, reproducible output for identical input, timeout
enforcement actually firing.

A RED run must fail on the assertion, not on a collection error. If pytest reports an import or
fixture error, that is a broken test, not a red one — fix it, then get a genuine red.
