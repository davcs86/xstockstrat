<!-- ⚠ AI-GENERATED TRIAGE — UNVERIFIED. Produced by constitution-forge (https://github.com/davcs86/agent-plugins) from static code + git-history analysis. These are CANDIDATE defects, doc-gaps, and security-boundary concerns flagged by automated analysis — NOT confirmed by a human or by running the code; some are explicitly open questions. Do not treat as authoritative: verify each (path:line/commit cited) before acting. Refresh by re-running /constitution. -->
# xstockstrat-agent — Constitution Findings

Module-specific defects (repo-wide ones live in the root findings). `⚠` = security boundary; most-severe first.

## ⚠ Security-boundary defects
- ⚠ **No per-user admin check.** Root `header-propagation.md:22-23` claims the agent validates admin role at entry (`validate_admin`) before forwarding scope. False since `0b74e39`: `validate_admin` has zero call sites; any authenticated MCP caller gets `x-access-scope="7"` trusted by backends. `app/client.py:32`. Action: add a per-user check or correct the doc + confirm the trust model.
- ⚠ `POST /messages` returns before `_authorized()` — possible unauthenticated message-injection surface. `app/main.py:144-146`. Action: verify session binding gates it.

## Documentation that lies
- `mcp-tools.md`: `emit_alert`→`{success}` (actual `{alert_id}`), `run_backtest`→`{backtest_id}` (actual full `BacktestResult`); "webhook" transport (gRPC since `90a6b20`); dead `?api_key=` profile (`0b74e39`). `client.py:140,171`.

## Dead code
- empty `app/config/__init__.py` package; duplicated `_metadata()` in `client.py` + `auth.py`.
