# xstockstrat-agent — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24; refreshed 2026-09-02 (branch
`claude/loaded-plugins-list-d120nl` @ `82a0549`); refreshed 2026-09-03 (branch
`claude/watchlist-bulk-default-strategy-zxx6su` @ `d4cd327` — the double-`x-user-id` header bug was
fixed, moved to Resolved; orphan-secret anchor re-grounded); re-verified 2026-10-14 (branch `ccr-fe84109f-0lwin8` @ `09ec8d9`); refreshed 2026-10-19 (branch `ccr-c386317f-6vt6t6` @ `a914f69` — +1 latent bug (undeadlined `_fetch_url` policy reads), +1 dead code (`Opportunity.sparkline`); line hints re-stamped; all other findings still open). For triage/fixing, not
governance. The internal admin-scope self-grant (`x-access-scope=7`) is a cross-cutting ⚠ security
question tracked in the root findings log.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
_None currently open_ — ~~CLAUDE.md "Config Keys Consumed" lists only `agent.oauth.*`~~ **RESOLVED** (confirmed 2026-08-09 refresh): CLAUDE.md now lists `agent.signal.alert_threshold` alongside `agent.oauth.*`; the `source.<slug>.credentials` plaintext read was removed entirely (`app/tools.py#_CREDENTIALS_UNSUPPORTED (~L88)`) rather than documented, so there is no longer a second undocumented key to reconcile.

## Documentation that lies — additions (2026-10-14)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| `set_config` tool docstring: "Secret keys are global-scope only — a per-user write to a secret key is rejected INVALID_ARGUMENT by the backend" | Feature 224 allows per-user secrets; `_write_source_bearer` itself writes `user_id=<caller>, is_secret=True`. An LLM reading the tool description will avoid or misreport per-user secret writes | `app/tools.py#set_config` docstring vs `app/tools.py#_write_source_bearer` | Rewrite the docstring |

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| ~~`client.get_config_value` hardcodes `namespace="agent"` … reads may always return `None` and silently fall back to defaults~~ **RESOLVED (feature 093):** `get_config_value` now takes required `namespace`/`environment`, projects the active oneof stringified (the `float`-typed `signal.alert_threshold` returned `None` under the old `string_val`-only read regardless of scope), and surfaces transport errors instead of swallowing. `signal.alert_threshold`/OAuth reads are env-scoped best-effort; the `source.<slug>.credentials` plaintext read was **removed** (extract tools raise when credentials are required — a plaintext config secret would violate C-05/invariant #6). | Resolved | `app/client.py` `get_config_value`; `app/tools.py` extract tools + alert read; `app/oauth_server.py` |
| `MCP_TRANSPORT` default is `"stdio"` while the whole service (port 9000, OAuth, Streamable HTTP) assumes the HTTP transport; an **unrecognized** value also falls through to stdio | Running without the env var set — or with a typo like `htp` — starts the wrong transport. Still open after feature 079, but **narrowed**: `resolve_transport()` now logs a warning on both the deprecated `sse` alias and any unrecognized value. The fallthrough itself is deliberate (AC-4). Aggravating factor: the agent has no HTTP healthcheck (only a TCP probe on 9000 in compose, and no `health_check` block in `.do/app*.yaml`), so the mis-start is otherwise silent | `app/main.py` `resolve_transport()` |

## Dead / orphaned code

| What | Why it looks dead | Evidence |
|---|---|---|
| `app/config/__init__.py` | empty, unused package; config access goes through `client.get_config_value` | `app/config/__init__.py` |
| `app/prompts/signal_extraction.md` | still unreferenced — feature 197 wired the prompts surface (`register_prompts` reads `app/prompts/list_correlation.md` via `@server.prompt`), but `signal_extraction.md` specifically has no reader | `app/prompts/` (grep for `signal_extraction` = zero; the dir is no longer prompt-machinery-free) |
| `Opportunity.sparkline` (field 17) projection — action: deprecate `analysis.proto` field 17 and fix the docstring (found 2026-10-19) | analysis never populates it (`rg sparkline services/xstockstrat-analysis/app` = zero), yet the agent projects it and the client docstring still describes a "sparkline gap" | `app/client.py#_opportunity_to_dict (~L782; sparkline ~L816-817)`; `packages/proto/analysis/v1/analysis.proto#repeated SparklinePoint sparkline = 17 (~L625)` |

## Open questions (unresolved *why* — needs a maintainer)

- `snapshot_offline_positions` sets **both** a request-body `user_id` (`app/client.py#snapshot_offline_positions` ~L2310) **and** the `x-user-id` header (~L2321), while the CLAUDE.md caller-identity contract does not list snapshot among the body-`user_id` builders. Is the body `user_id` on `SnapshotOfflinePositionsRequest` a deliberate target selector, or leftover caller-identity duplication to drop (like the feature-164/133 builders)? — status: **open**
- `manage_signal_source` bearer-token orchestration writes the encrypted secret **before** registering the source, with **no compensating cleanup** on a failed register (`app/tools.py#_write_source_bearer`, docstring "only orphans a redacted secret"). Confirm the orphan-secret-on-partial-failure is an accepted trade-off, not a reconciliation gap. — status: **open**
- `set_config` takes a caller-supplied `author` (required tool parameter) that is recorded in `config.config_audit`; feature 111 derived `emit_alert` and `manage_formula` identities from verified claims for this exact reason. Intentional free-text audit label, or leftover from before the hardening? `app/tools.py#set_config` → `app/client.py#set_config` — status: **open** (candidate identity-spoof class; derive from `_caller_user_id` if not intentional)

## MCP tool ↔ backend alignment audit (2026-08-01) — 13/13 resolved

Full triage: [`docs/reports/2026-08-01-mcp-tools-alignment-triage.md`](../../../docs/reports/2026-08-01-mcp-tools-alignment-triage.md).
All 13 findings (F-1 through F-11, plus two docs-only rows) are resolved — most landed with features
086–093 (2026-08-02), reconfirmed clean on 2026-08-09. Generalizable lessons (add descriptor-parity/
return-shape contract tests over the `app/client.py` request builders + projections) are distilled into
`docs/roadmap/ledger/insights.md` and `fails.md` (2026-08-02 entries).

## Resolved

- **RESOLVED 2026-09-03 — `ensure_signal_watchlist` / `add_watchlist_symbol` emitted `x-user-id` twice (latent bug, 2026-09-02).** Both sites now use the de-duplicating `_metadata(("x-user-id", user_id))` form (`app/client.py#ensure_signal_watchlist` ~L298, `#add_watchlist_symbol` ~L316), so the header is sent exactly once under a bound caller context (AGENT-4 dedup contract honored). Confirmed by re-resolving both citations against current code plus the regression test `tests/test_watchlist_client.py:222-254` (`test_ensure_signal_watchlist_dedups_user_id_under_bound_caller`, "defect 2026-09-03") which binds a caller and asserts `x-user-id` appears exactly once on both RPCs.
- **RESOLVED 2026-10-14 — `telemetry.py` `trading_mode` resource attribute** (was an open question): `_build_resource` now sets only `service.name`, `deployment.environment` (from `APPLICATION_ENV`) and `platform`; grep for `trading_mode|TRADING_MODE` in `app/telemetry.py` → zero hits (remaining mentions are comments/docstrings).
- **RESOLVED (feature 247) — `_fetch_url` / `get_config_value` config reads had no deadline.** `get_config_value` now passes the fixed `timeout=_CONFIG_READ_TIMEOUT_S` (3.0 s) on its `GetConfig` call (`app/client.py#_CONFIG_READ_TIMEOUT_S`), so the four serial `_agent_policy` reads in `_fetch_url`, the `ingest_signal` threshold read and the DCR reads all expire with `DEADLINE_EXCEEDED` and fall back to their defaults; the callers are unchanged. Confirmed by `tests/test_client.py#test_ac1_stalled_config_read_raises_deadline_exceeded_within_bound` and the stalled-config tests in `tests/test_tools.py` / `tests/test_oauth.py`.
- **RESOLVED (feature 247, found-and-fixed) — `app/oauth_server.py` redirect-allowlist comment.** It claimed identity enforces the same allowlist server-side; identity enforces only `https://` (`services/xstockstrat-identity/src/grpc/identityServiceImpl.ts#redirect_uris must use https`), so the agent's allowlist is the only allowlist check. The comment now says so.


## Filed as defect reports (2026-10-19)

The open rows above were re-verified against `1302e6d` and recorded as `docs/reports/` defects
(status sidecar `open`) for `/sdd-triage --from-report`. A row stays here until its report is resolved.

| Report | Title |
|---|---|
| [`2026-10-19-agent-bearer-secret-orphan-on-failed-register-defect`](../../../docs/reports/2026-10-19-agent-bearer-secret-orphan-on-failed-register-defect.md) | Signal-source bearer secret is orphaned when the source register fails |
| [`2026-10-19-agent-mcp-transport-stdio-fallthrough-defect`](../../../docs/reports/2026-10-19-agent-mcp-transport-stdio-fallthrough-defect.md) | Agent silently starts stdio transport when MCP_TRANSPORT is unset or mistyped |
| [`2026-10-19-agent-tools-missing-grpc-error-mapping-defect`](../../../docs/reports/2026-10-19-agent-tools-missing-grpc-error-mapping-defect.md) | Six agent MCP tools leak raw gRPC errors (no `_grpc_error_message` mapping) |
| [`2026-10-19-agent-ui-claude-md-drift-defect`](../../../docs/reports/2026-10-19-agent-ui-claude-md-drift-defect.md) | Agent and UI CLAUDE.md / tool docstring drift from current code |
| [`2026-10-19-orphaned-code-defect`](../../../docs/reports/2026-10-19-orphaned-code-defect.md) | Orphaned modules, scripts and dependencies across services |

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
