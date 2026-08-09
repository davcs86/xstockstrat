# xstockstrat-agent — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24. For triage/fixing, not
governance. The internal admin-scope self-grant (`x-access-scope=7`) is a cross-cutting ⚠ security
question tracked in the root findings log.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
_None currently open_ — ~~CLAUDE.md "Config Keys Consumed" lists only `agent.oauth.*`~~ **RESOLVED** (confirmed 2026-08-09 refresh): CLAUDE.md now lists `agent.signal.alert_threshold` alongside `agent.oauth.*`; the `source.<slug>.credentials` plaintext read was removed entirely (`_CREDENTIALS_UNSUPPORTED`, `app/tools.py:49-54`) rather than documented, so there is no longer a second undocumented key to reconcile.

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| ~~`client.get_config_value` hardcodes `namespace="agent"` … reads may always return `None` and silently fall back to defaults~~ **RESOLVED (feature 093):** `get_config_value` now takes required `namespace`/`environment`, projects the active oneof stringified (the `float`-typed `signal.alert_threshold` returned `None` under the old `string_val`-only read regardless of scope), and surfaces transport errors instead of swallowing. `signal.alert_threshold`/OAuth reads are env-scoped best-effort; the `source.<slug>.credentials` plaintext read was **removed** (extract tools raise when credentials are required — a plaintext config secret would violate C-05/invariant #6). | Resolved | `app/client.py` `get_config_value`; `app/tools.py` extract tools + alert read; `app/oauth_server.py` |
| `MCP_TRANSPORT` default is `"stdio"` while the whole service (port 9000, OAuth, Streamable HTTP) assumes the HTTP transport; an **unrecognized** value also falls through to stdio | Running without the env var set — or with a typo like `htp` — starts the wrong transport. Still open after feature 079, but **narrowed**: `resolve_transport()` now logs a warning on both the deprecated `sse` alias and any unrecognized value. The fallthrough itself is deliberate (AC-4). Aggravating factor: the agent has no HTTP healthcheck (only a TCP probe on 9000 in compose, and no `health_check` block in `.do/app*.yaml`), so the mis-start is otherwise silent | `app/main.py` `resolve_transport()` |

## Dead / orphaned code

| What | Why it looks dead | Evidence |
|---|---|---|
| `app/config/__init__.py` | empty, unused package; config access goes through `client.get_config_value` | `app/config/__init__.py` |
| `app/prompts/signal_extraction.md` (+ `__init__.py`) | zero references (no `@server.prompt`, no file read) | `app/prompts/` (grep zero) |

## MCP tool ↔ backend alignment audit (2026-08-01) — 13 findings, all now resolved

Full triage: [`docs/reports/2026-08-01-mcp-tools-alignment-triage.md`](../../../docs/reports/2026-08-01-mcp-tools-alignment-triage.md).
Every finding was re-confirmed against current code on 2026-08-02, then again on 2026-08-09 — every
remaining behavioral row now resolves. Most landed with features 086–093 (Aug 2, 03:52–04:23),
*before* the 2026-08-02 refresh's own baseline (Aug 2, 11:41) — this log simply hadn't been swept
against them until now (CF-N12).

| ID | Behavioral defect (code still to fix) | Evidence | Track | Status |
|---|---|---|---|---|
| F-1 | ~~Extract-tool credentials: `get_config_value` reads a dev-scoped `agent`-namespace key and swallows errors~~ **RESOLVED (feature 093):** `get_config_value` env/namespace-scoped + typed-oneof projection + non-swallowing; extract tools no longer read a plaintext-config credential (they raise when one is required — secure resolution deferred, AC-3). | `app/client.py` `get_config_value`; `app/tools.py` extract tools | ✅ done |
| F-2/F-3 | ~~`manage_formula` update is full-replace (no `update_mask`); `outputs`/`warmup_period` never sent; no `get_formula`/`list_formulas` read tools~~ **RESOLVED (feature 086):** `app/client.py:601-621` builds `UpdateFormulaRequest` with `outputs`, `warmup_period`, and an AIP-161 `update_mask`; `get_formula`/`list_formulas` read tools exist (`app/tools.py:713,726`). | `app/client.py` `manage_formula` builders; `app/tools.py` `manage_formula`/`get_formula`/`list_formulas` | C | ✅ resolved |
| F-4 | ~~`screen_symbols` never maps `ScreenCriterion.component` (technical kinds silently skipped); `min_conviction` sent but unread~~ **RESOLVED (feature 090):** `app/client.py:291-302,354,367` builds/forwards `component` and `min_conviction`. | `app/client.py` `screen_symbols` | B/C | ✅ resolved |
| F-5 | ~~Strategy re-register raises generic INTERNAL, not ALREADY_EXISTS; no reactivate path~~ **RESOLVED:** `services/xstockstrat-analysis/app/handlers/servicer.py:1613-1629` returns `ALREADY_EXISTS` naming the reactivate operation. | analysis `servicer.py`/`repositories/strategies.py` | B/C | ✅ resolved |
| F-6 | ~~`manage_signal_source` register/update is one destructive upsert; omitted `credentials_ref` NULLs it; update always reactivates (`active=True` hardcoded)~~ **RESOLVED (feature 088):** `app/client.py:667-727` uses an honest operation enum, sets `credentials_ref` only when provided, no hardcoded `active=True`. | `app/client.py` `manage_signal_source`; ingest `servicer.py` | C | ✅ resolved |
| F-7 | ~~`set_strategy_live` succeeds on inert configs (inactive / no symbols) — no FAILED_PRECONDITION~~ **RESOLVED:** `services/xstockstrat-analysis/app/handlers/servicer.py:1821-1843` aborts `FAILED_PRECONDITION` on an inactive strategy or no symbols; disable is always allowed. | analysis `live_loop.py`, `SetStrategyLive` handler | B/C | ✅ resolved |
| F-8 | ~~`set_config` typo silently creates an orphan key (blind upsert); agent already has the `ListKeys` answer and discards it~~ **RESOLVED (feature 091):** `app/tools.py:1018-1053` forwards `create_key`; server-side `NOT_FOUND` existence gate. | `app/tools.py` `set_config`; config `configServiceImpl.ts` | B + C | ✅ resolved |
| F-9 | ~~`ingest_signal` conviction: no source default (docs fixed); `>1.0` fails as INTERNAL not INVALID_ARGUMENT~~ **RESOLVED:** `services/xstockstrat-ingest/app/handlers/servicer.py:719-725` (comment explicitly cites "# F-9") raises `INVALID_ARGUMENT`. | ingest `servicer.py` | B | ✅ resolved |
| F-10 | ~~Built RPCs with no MCP surface: `ExecuteFormula` (test_formula), `CancelBackfill`, `ListStrategyDefinitions`, `GetFormula`/`ListFormulas`, source-health fields, `emit_alert` context/tags/correlation_id~~ **RESOLVED:** all present in `app/tools.py`/`app/client.py` and listed in CLAUDE.md's 22-tool table. | `app/client.py`, `app/tools.py` | C | ✅ resolved |
| F-11 | ~~`TriggerBackfill` is ungated server-side while `CancelBackfill` is admin-gated; the agent's "admin-scoped" label is decorative (unverified `x-access-scope=7`)~~ **RESOLVED (feature 092):** ingest `TriggerBackfill` now admin-gates via `_has_admin_scope` (mirrors `CancelBackfill`); the agent forwards the caller's *real* derived scope on all four management write tools (hardcoded `_admin_metadata()` removed); `EmitAlert` codified as an internal-service-caller contract (private-network + OAuth-edge trust boundary, no per-call gate). | ~~ingest `servicer.py`; `app/client.py` `_admin_metadata`~~ Resolved | B + C | ✅ resolved |

**All 13 rows in this audit are now resolved** — nothing open remains from the 2026-08-01 alignment pass.

**Antidote (prevention):** add descriptor-parity/return-shape contract tests over the `app/client.py`
request builders + projections, mirroring `tests/test_backtest_view.py` (the only tool that did not
drift). See ledger `docs/roadmap/ledger/insights.md` (2026-08-02) and `fails.md` (2026-08-02).

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
