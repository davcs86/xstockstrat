# xstockstrat-agent — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24; last refreshed 2026-11-10 (`main-dev` @
`3b0fa6ab`). For triage/fixing, not
governance. The internal admin-scope self-grant (`x-access-scope=7`) is a cross-cutting ⚠ security
question tracked in the root findings log.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
_None currently open_ — ~~CLAUDE.md "Config Keys Consumed" lists only `agent.oauth.*`~~ **RESOLVED** (confirmed 2026-08-09 refresh): CLAUDE.md now lists `agent.signal.alert_threshold` alongside `agent.oauth.*`; the `source.<slug>.credentials` plaintext read was removed entirely (`app/tools.py#_CREDENTIALS_UNSUPPORTED (~L91)`) rather than documented, so there is no longer a second undocumented key to reconcile.

## Documentation that lies — additions (2026-10-14)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| ⚠ CLAUDE.md § Management-tool authorization: "`manage_formula` is different — it forwards **no** admin scope (plain `_metadata()`)" (found 2026-11-13, `/context-scrubber`) | Since PR #994 a plain `_metadata()` call emits the bound caller's `x-access-scope` (with `x-user-id`/`x-trace-id`); `CallerPropagationMiddleware` binds the caller on every `tools/call` | `app/client.py#_metadata`; `app/tools.py#CallerPropagationMiddleware` | Human call: reword to "not admin-gated; indicators enforces author-ownership" (the scope still rides along) |
| ⚠ CLAUDE.md § Management-tool authorization: the watchlist tools "forward **only** the caller's own `x-user-id` … and never an admin `x-access-scope`" (found 2026-11-13, `/context-scrubber`) | The watchlist RPCs also carry the caller's `x-access-scope` and `x-trace-id` — `_metadata` emits the whole trio and de-duplicates the explicit `x-user-id` extra | `app/client.py#_metadata` | Human call: drop "only … never an admin `x-access-scope`"; ownership (portfolio `loadOwned`) is the gate |
| `app/auth.py#validate_bearer_claims` docstring: "rather than the hardcoded admin tuple every other management tool forwards" (found 2026-11-04) | That tuple was removed by feature 092 (`app/scopes.py` and `app/client.py` say so) | `app/auth.py#validate_bearer_claims` | Reword |
| `app/tools.py#_caller_user_id` docstring cites `notify.proto:34` for the broadcast sentinel (found 2026-11-04) | The proto lines are ~L45 and ~L71 | `packages/proto/notify/v1/notify.proto#target_user_id` | Cite by symbol |

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| ~~`client.get_config_value` hardcodes `namespace="agent"` … reads may always return `None` and silently fall back to defaults~~ **RESOLVED (feature 093):** `get_config_value` now takes required `namespace`/`environment`, projects the active oneof stringified (the `float`-typed `signal.alert_threshold` returned `None` under the old `string_val`-only read regardless of scope), and surfaces transport errors instead of swallowing. **Superseded (feature 295; noted 2026-11-10):** no app code calls `get_config_value` any more — policy reads are snapshot lookups (`app/config/watcher.py#read_value`, AGENT-9). `signal.alert_threshold`/OAuth reads are env-scoped best-effort; the `source.<slug>.credentials` plaintext read was **removed** (extract tools raise when credentials are required — a plaintext config secret would violate C-05/invariant #6). | Resolved | `app/client.py` `get_config_value`; `app/tools.py` extract tools + alert read; `app/oauth_server.py` |
| `MCP_TRANSPORT` default is `"stdio"` while the whole service (port 9000, OAuth, Streamable HTTP) assumes the HTTP transport; an **unrecognized** value also falls through to stdio | Running without the env var set — or with a typo like `htp` — starts the wrong transport. Still open after feature 079, but **narrowed**: `resolve_transport()` now logs a warning on both the deprecated `sse` alias and any unrecognized value. The fallthrough itself is deliberate (AC-4). Aggravating factor: the agent has no HTTP healthcheck (only a TCP probe on 9000 in compose, and no `health_check` block in `.do/app*.yaml`), so the mis-start is otherwise silent | `app/main.py` `resolve_transport()` |

## Dead / orphaned code

| What | Why it looks dead | Evidence |
|---|---|---|
| `app/prompts/signal_extraction.md` | still unreferenced — feature 197 wired the prompts surface (`register_prompts` reads `app/prompts/list_correlation.md` via `@server.prompt`), but `signal_extraction.md` specifically has no reader | `app/prompts/` (grep for `signal_extraction` = zero; the dir is no longer prompt-machinery-free) |
| `Opportunity.sparkline` (field 17) projection — action: deprecate `analysis.proto` field 17 and fix the docstring (found 2026-10-19) | analysis never populates it (`rg sparkline services/xstockstrat-analysis/app` = zero), yet the agent projects it and the client docstring still describes a "sparkline gap" | `app/client.py#_opportunity_to_dict (~L864; sparkline ~L899-900)`; `packages/proto/analysis/v1/analysis.proto#repeated SparklinePoint sparkline = 17 (~L626)` |
| `app/auth.py#validate_bearer_jwt` (found 2026-11-04) | Zero call sites in `app/`; only `tests/test_auth.py` (10 refs) exercise it. It maps DEADLINE/UNAVAILABLE to `False` (a 401 and a pointless OAuth re-auth) — the behaviour `app/main.py#_send_identity_unavailable` exists to avoid, so a caller copying it reintroduces the bug | `app/auth.py#validate_bearer_jwt` vs `#validate_bearer_claims` |
| `app/main.py#UI_BASE_URL` (~L73) (found 2026-11-04) | Read and never used in `main.py`; `app/oauth_server.py` keeps its own copy and is the only consumer | `app/main.py#UI_BASE_URL` |
| Undeclared direct imports (found 2026-11-04, low) | `app/egress.py` imports `httpcore` and `app/tool_metrics.py` imports `mcp_types`; neither is in `pyproject.toml` `dependencies` (`httpcore` arrives transitively via `httpx`) | `app/egress.py`, `app/tool_metrics.py`, `pyproject.toml` |
| `app/client.py#get_config_value (~L1912)` + `#_CONFIG_READ_TIMEOUT_S (~L41)` (new 2026-11-10) — action: delete both with their tests, and fix the `tests/conftest.py#hung_config_server` docstring | Zero callers in `app/` since feature 295 moved policy reads to the snapshot registry (AGENT-9); only its own tests (`tests/test_client.py`, `tests/test_client_deadlines.py`, `tests/test_tool_deadlines.py`) and `patch.object(client, "get_config_value", …)` mocks that assert it is never awaited reference it. The `hung_config_server` fixture docstring still says it points `client.get_config_value` at a stalled server | `rg get_config_value services/xstockstrat-agent/app` → `client.py` def + a `watcher.py` docstring only; `tests/conftest.py#hung_config_server (~L134)` |

## Open questions (unresolved *why* — needs a maintainer)

- `snapshot_offline_positions` sets **both** a request-body `user_id` (`app/client.py#snapshot_offline_positions` ~L2523) **and** the `x-user-id` header (~L2535), while the CLAUDE.md caller-identity contract does not list snapshot among the body-`user_id` builders. Is the body `user_id` on `SnapshotOfflinePositionsRequest` a deliberate target selector, or leftover caller-identity duplication to drop (like the feature-164/133 builders)? — status: **open**
- `manage_signal_source` bearer-token orchestration writes the encrypted secret **before** registering the source, with **no compensating cleanup** on a failed register (`app/tools.py#_write_source_bearer`, docstring "only orphans a redacted secret"). Confirm the orphan-secret-on-partial-failure is an accepted trade-off, not a reconciliation gap. — status: **open**
- Is `app/auth.py#validate_bearer_jwt` kept only for tests, or can it be removed? `validate_bearer_claims` "deliberately duplicates the ValidateToken call" — status: **open** (found 2026-11-04)
- `GET /api/tools` is unauthenticated (documented in `docs/oauth.md` and `app/main.py#list_tools_metadata`), exposing the full tool schema publicly — still wanted now that the UI has its own BFF? — status: **open** (found 2026-11-04)

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
- **RESOLVED (feature 273; verified 2026-11-04) — six agent tools leaked raw gRPC errors.** Every client-calling tool body in `app/tools.py` now has `except grpc.aio.AioRpcError` → `_grpc_error_message` (95 sites, enumerated against every `await client.*` site); report `2026-10-19-agent-tools-missing-grpc-error-mapping-defect` is `triaged`.
- **RESOLVED 2026-11-04 — AGENT-2 "trips the linter" + `CLAUDE.md` "Language: Python 3.13".** AGENT-2 already says "convention, not a lint gate", and the `## Language` section was removed from `CLAUDE.md` (0 hits for `3.13`), so the `pyproject.toml` (`requires-python >=3.12`) mismatch no longer has a doc to contradict.
- **RESOLVED 2026-11-04 — `set_config` caller-supplied `author` (was an open question; feature 241).** `app/tools.py#set_config` (L1815) no longer takes an `author` parameter; the audit identity is derived from verified claims.
- **RESOLVED 2026-11-10 — `app/config/__init__.py` dead package (dead code, 2026-07-24).** The package is live: `app/config/watcher.py` / `watch_core.py` are imported by `app/tools.py`, `app/oauth_server.py`, `app/client.py#formula_deadline_s` and `app/main.py` (feature 295).
- **RESOLVED 2026-11-10 — `set_config` docstring "Secret keys are global-scope only" (doc-lie, 2026-10-14).** `app/tools.py#set_config` (~L1868) no longer contains the phrase (`grep "global-scope only"` = 0); it now says the key "may be a secret key, stored encrypted".
- **RESOLVED 2026-11-10 — `CLAUDE.md` "One management write tool still hits a backend admin gate" (doc-lie, 2026-11-04).** `grep "One management" CLAUDE.md` = 0; § Management-tool authorization now names `trigger_backfill`, `cancel_backfill`, `run_fundamentals_scan` and a global `set_config`.
- **RESOLVED 2026-11-10 — open question on `get_config_value` metadata during the OAuth handshake.** Moot: policy reads are no longer RPCs — `app/oauth_server.py` and `app/tools.py` read the snapshot via `read_config_value` (AGENT-9, feature 295), so no caller trio is sent on them.


## Filed as defect reports (2026-10-19)

The open rows above were re-verified against `1302e6d` and recorded as `docs/reports/` defects
(status sidecar `open`) for `/sdd-triage --from-report`. A row stays here until its report is resolved.

| Report | Title |
|---|---|
| [`2026-10-19-agent-bearer-secret-orphan-on-failed-register-defect`](../../../docs/reports/2026-10-19-agent-bearer-secret-orphan-on-failed-register-defect.md) | Signal-source bearer secret is orphaned when the source register fails |
| [`2026-10-19-agent-mcp-transport-stdio-fallthrough-defect`](../../../docs/reports/2026-10-19-agent-mcp-transport-stdio-fallthrough-defect.md) | Agent silently starts stdio transport when MCP_TRANSPORT is unset or mistyped |
| `2026-10-19-agent-tools-missing-grpc-error-mapping-defect` (pruned 2026-11-04; git show 9892b610:docs/reports/2026-10-19-agent-tools-missing-grpc-error-mapping-defect.md) | Six agent MCP tools leak raw gRPC errors (no `_grpc_error_message` mapping) — **triaged; fixed in code (feature 273, verified 2026-11-04)** |
| `2026-10-19-agent-ui-claude-md-drift-defect` (pruned 2026-11-10; `git show adf411c3:docs/reports/2026-10-19-agent-ui-claude-md-drift-defect.md`) | Agent and UI CLAUDE.md / tool docstring drift from current code |
| [`2026-10-19-orphaned-code-defect`](../../../docs/reports/2026-10-19-orphaned-code-defect.md) | Orphaned modules, scripts and dependencies across services |

## Filed as defect reports (2026-10-29)

Follow-ups from feature 247 `design.md` § Open Risks, recorded as `docs/reports/` defects (status sidecar `open`).

| Report | Title |
|---|---|
| `2026-10-29-agent-config-snapshot-read-defect` (pruned 2026-11-10; git show 29f54de3:docs/reports/2026-10-29-agent-config-snapshot-read-defect.md) | Agent `extract_email_content` exceeds the MCP 60 s budget during a config stall for five or more URLs |
| [`2026-10-29-agent-dcr-fail-closed-defect`](../../../docs/reports/2026-10-29-agent-dcr-fail-closed-defect.md) | Agent OAuth dynamic client registration fails open on a config stall (SECURITY POSTURE) |
| [`2026-10-29-agent-extract-tools-no-mcp-cap-defect`](../../../docs/reports/2026-10-29-agent-extract-tools-no-mcp-cap-defect.md) | (open report absent from this table until 2026-11-04; title not re-read) |
| [`2026-10-29-agent-list-opportunities-over-mcp-timeout-defect`](../../../docs/reports/2026-10-29-agent-list-opportunities-over-mcp-timeout-defect.md) | (open report absent from this table until 2026-11-04; title not re-read) |

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
