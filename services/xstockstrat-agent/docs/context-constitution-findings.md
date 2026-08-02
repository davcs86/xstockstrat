# xstockstrat-agent — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24. For triage/fixing, not
governance. The internal admin-scope self-grant (`x-access-scope=7`) is a cross-cutting ⚠ security
question tracked in the root findings log.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| CLAUDE.md "Config Keys Consumed" lists only `agent.oauth.*` | Code also reads `signal.alert_threshold` and `source.<slug>.credentials` | `app/client.py:678,689`, `app/tools.py:32,193` | Document the additional consumed keys |

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

## MCP tool ↔ backend alignment audit (2026-08-01) — 13 findings, all verified

Full triage: [`docs/reports/2026-08-01-mcp-tools-alignment-triage.md`](../../../docs/reports/2026-08-01-mcp-tools-alignment-triage.md).
Every finding was re-confirmed against current code on 2026-08-02. The **docs-only** portions (F-12
runbook/skill rows, F-13 `tools.py` docstring sync) were fixed in that pass — the docstrings now
describe today's real behavior. The behavioral fixes below are **routed, not yet done**; each is an
open defect until its track lands.

| ID | Behavioral defect (code still to fix) | Evidence | Track |
|---|---|---|---|
| F-1 | ~~Extract-tool credentials: `get_config_value` reads a dev-scoped `agent`-namespace key and swallows errors~~ **RESOLVED (feature 093):** `get_config_value` env/namespace-scoped + typed-oneof projection + non-swallowing; extract tools no longer read a plaintext-config credential (they raise when one is required — secure resolution deferred, AC-3). | `app/client.py` `get_config_value`; `app/tools.py` extract tools | ✅ done |
| F-2/F-3 | `manage_formula` update is full-replace (no `update_mask`); `outputs`/`warmup_period` never sent; no `get_formula`/`list_formulas` read tools | `app/client.py` `manage_formula` builders; `app/tools.py` `manage_formula` | C |
| F-4 | `screen_symbols` never maps `ScreenCriterion.component` (technical kinds silently skipped); `min_conviction` sent but unread | `app/client.py` `screen_symbols` | B/C |
| F-5 | Strategy re-register raises generic INTERNAL, not ALREADY_EXISTS; no reactivate path | analysis `servicer.py`/`repositories/strategies.py` | B/C |
| F-6 | `manage_signal_source` register/update is one destructive upsert; omitted `credentials_ref` NULLs it; update always reactivates (`active=True` hardcoded) | `app/client.py` `manage_signal_source`; ingest `servicer.py` | C |
| F-7 | `set_strategy_live` succeeds on inert configs (inactive / no symbols) — no FAILED_PRECONDITION | analysis `live_loop.py`, `SetStrategyLive` handler | B/C |
| F-8 | `set_config` typo silently creates an orphan key (blind upsert); agent already has the `ListKeys` answer and discards it | `app/tools.py` `set_config`; config `configServiceImpl.ts` | B + C |
| F-9 | `ingest_signal` conviction: no source default (docs fixed); `>1.0` fails as INTERNAL not INVALID_ARGUMENT | ingest `servicer.py` | B |
| F-10 | Built RPCs with no MCP surface: `ExecuteFormula` (test_formula), `CancelBackfill`, `ListStrategyDefinitions`, `GetFormula`/`ListFormulas`, source-health fields, `emit_alert` context/tags/correlation_id — all additive, zero backend change | `app/client.py` (unused fns), `app/tools.py` | C |
| F-11 | `TriggerBackfill` is ungated server-side while `CancelBackfill` is admin-gated; the agent's "admin-scoped" label is decorative (unverified `x-access-scope=7`) | ingest `servicer.py`; `app/client.py` `_admin_metadata` | B + C |

**Antidote (prevention):** add descriptor-parity/return-shape contract tests over the `app/client.py`
request builders + projections, mirroring `tests/test_backtest_view.py` (the only tool that did not
drift). See ledger `docs/roadmap/ledger/insights.md` (2026-08-02) and `fails.md` (2026-08-02).

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
