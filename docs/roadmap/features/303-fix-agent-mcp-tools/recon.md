# Recon: fix-agent-mcp-tools

**Created**: 2026-11-07
**From**: product-spec.md
**Tree**: feature/fix-agent-mcp-tools@7bc411f ≡ origin/feature/fix-agent-mcp-tools
**Affected services**: xstockstrat-agent

---

## Objective

Every agent MCP tool signals anticipated refusals (backend gRPC errors, input validation, admin gate) with
`RuntimeError`/`ValueError`/`PermissionError`. The `mcp` 2.3.0 SDK treats anything that is not
`ToolError` as a crash and returns only `Error executing tool <name>`, so callers never see the gRPC code
or message (first seen on `set_config` `FAILED_PRECONDITION`). Operator-decided scope: convert both the
gRPC-mapped and the validation/admin refusals to `ToolError`, prefix the gRPC code name, via one shared
mechanism.

## Codebase Map

- **`xstockstrat-agent`** (Python)
  - Error mapper: `_grpc_error_message(exc, not_found, *, deadline_s, write)` — `app/tools.py:225-254` (text only, no code prefix; catch-all `details() or str(code)` at `:254`)
  - `raise RuntimeError(_grpc_error_message(...)) from e` call sites: 47, all inside `except grpc.aio.AioRpcError` (table in discovery; e.g. `set_config` `:1894`, `manage_account` `:2474`, `_score_strategy` `:263`, `_write_source_bearer` `:391`, `_get_source` `:2585`)
  - Other raises in `app/tools.py`: 8 hand-written `RuntimeError` (`:127 _require_claims`, `:168 _caller_user_id`, `:571`, `:609`, `:1271`, `:1453`, `:1928`, `:2715 _fetch_url`), 44 `ValueError` (tool bodies + nested `_validate_roles` `:1981/:1984` + helpers `:2589 _get_source`, `:2600/:2602/:2609 _extract_from_bytes`), 2 `PermissionError` (`:154 _require_admin`, `:2462 manage_account resume`)
  - `app/client.py` raises ~21 `ValueError` (e.g. `:504`, `:668`, `:2072-2094`, `:2411-2414`, `:2489-2491`, `:2601`) that surface through tools; other raise types in `client.py` not verified
  - Wiring: `server.middleware.append(CallerPropagationMiddleware())` `app/tools.py:398`; `server.middleware.append(ToolMetricsMiddleware(server))` `app/main.py:82`; `from mcp.server.mcpserver import Context, MCPServer` `app/tools.py:72` (no `ToolError` import anywhere in `app/` or `tests/`)
  - SDK (`.venv/.../mcp/server/mcpserver/`): `exceptions.py:4` `MCPServerError(Exception)`, `:43` `ToolError(MCPServerError)` plain-message ctor, not a `RuntimeError`/`ValueError` subclass; `tools/base.py:208-213` — `ToolError` → re-raised as `ToolError("Error executing tool <name>: <exc>")`, anything else → `UnexpectedToolError("Error executing tool <name>")`; `server.py:441-456` — `ToolError` logs INFO (no traceback), others `logger.exception` ERROR; both return `CallToolResult(is_error=True, text=str(exc))`
  - Last migration / config / proto: none involved

## Patterns to REUSE

- Central error text → keep and extend `_grpc_error_message` (`app/tools.py:225-254`) as the single place that formats gRPC-derived text (add the code-name prefix there once); do not add a parallel mapper.
- Backend error metric → `_CountingChannel.__aexit__` `app/mtls.py:39-56` already counts `agent.backend.rpc_errors{backend, grpc_code}` at the channel layer, independent of the exception a tool raises; no telemetry change needed.
- `mcp.tool.duration` outcome → `ToolMetricsMiddleware.__call__` `app/tool_metrics.py:121-133` + `_is_error_result` `:87-92`: `outcome="error"` for both `ToolError` and a crash (unchanged).
- Test fixture home (C-13, Python) → `tests/conftest.py`: has `_ctx` (`:22`), `bound_admin`, `otel_reset`; `_rpc_error` is duplicated in `test_tool_deadlines.py:51`, `test_tools.py:918`, `test_mtls_backend_errors.py:21` — a dispatch-level error test needs it from the second consumer on, so centralize into `conftest.py` (second-consumer rule).
- Dispatch-level test precedent → `server.call_tool` used in `test_tools.py:807` and `test_tool_metrics.py:82/:185`; every other tool test calls `_tool_fn(...)` directly and never sees SDK masking (why CI stayed green).
- Descriptor/contract-test pattern (`insights.md` 2026-08-02): add an executable test over the whole tool surface (not per-tool spot checks) so a future tool raising a built-in exception fails closed.

## Existing Business Rules (preserve / extend)

CHANGE — class named in the Then; needs user sign-off recorded in `context.md`, Then reworded to "raises an error whose text contains …":
- **CHANGE** `@AC-7 @FR-5 @feature-164` (`services/xstockstrat-agent/acceptance/agent-broker-account-tools.feature`) — pins `RuntimeError` for permission denial
- **CHANGE** `@AC-2 @FR-1 @feature-164` (same) — pins `ValueError` naming broker_type
- **CHANGE** `@AC-3 @FR-1 @feature-164` (same) — pins `ValueError` directing to manage_offline_account
- **CHANGE** `@AC-8 @FR-6 @feature-164` (same) — pins `ValueError` listing operations
- **CHANGE** `@AC-9 @FR-4 @feature-148` (`.../mcp-watchlist-tools.feature`) — pins "value error" naming allowed operations

PRESERVE (class-agnostic or additive-prefix compatible; message bodies/substrings must survive):
- `expose-score-strategy-mcp.feature` (283) @AC-2/3/4/8/9 — exact substrings "no eligible evidence — run a backtest", "fundamentals availability unknown — grade unchanged", "all evidence symbols excluded (fundamentals unavailable: SCHD)", "score accepts only strategy_id"; prefix must not alter or truncate bodies
- `fix-agent-client-deadlines.feature` (273) @AC-1/2/3/6/9 — "upstream did not respond within the deadline" wording; `@AC-5` asserts `DEADLINE_EXCEEDED` at the `app/client.py` function layer and `@AC-10` timeout on every stub call → conversion must live at the tool boundary, never inside `client.py`
- `fix-agent-getconfig-deadline.feature` (247) @AC-1 — `get_config_value` helper must keep raising a gRPC error (do not convert)
- `fix-opportunities-read-hangs.feature` (227) @AC-2 — error names a deadline
- `mcp-watchlist-tools.feature` (148) @AC-3, @AC-6; `surface-signal-weight-decay-config.feature` (161) @AC-3 (must still name `reliability_weight`)
- `fix-fundamentals-signal-producer.feature` (156) @AC-8 — backend gate stays authoritative, no new local gate
- `mcp-user-profile-roles.feature` (183) @AC-9 (PERMISSION_DENIED before any backend call), @AC-1/@AC-4 (password never echoed); `agent-broker-account-tools.feature` (164) @AC-1/@AC-4 (api_key/api_secret/credentials_json never echoed — forwarded backend text must not echo them)
- `extract-tool-ssrf-hardening.feature` (207) @AC-7 (error text carries no internal host/IP/port), @AC-1/2/4/5 (fail-closed refusals)
- `signal-map-instrumentation.feature` (294) @AC-21 — `agent.backend.rpc_errors{backend, grpc_code}` recorded from the original gRPC error; `otel-metrics-logs-export.feature` (274) @AC-21 — raised `ToolError` and isError results both `outcome="error"`
- `consolidate-watchlist-signal.feature` @AC-4 — the swallowed post-commit portfolio failure must NOT become a `ToolError`
- `services/xstockstrat-config/acceptance/fix-config-keys-drift.feature` (295) @AC-34 (read-only context) — agent forwards both key names unmodified
- `docs/sdd/business-rules/platform.feature`: nothing about agent tool error text; no scenario is net-new EXTEND (303 `@AC-1` is the new regression)
- Gap: no suite pins that a secret value is never echoed in an *error* (only payload-side "not echoed" guarantees).

## Dependencies

- Proto/RPC: none. Migration: none. Config keys: none. Inter-service edges: none changed.
- New env vars / ports: none.
- SDK coupling: `mcp>=2.3.0,<3` (`pyproject.toml`); the `Error executing tool <name>: ` prefix and INFO-vs-ERROR logging are SDK behavior (`tools/base.py:208-213`, `server.py:441-456`).
- Docs that state the old exception behavior (update in the same PR): `docs/runbooks/mcp-tools.md` (`:92-97`, error tables `:185-218`, `:344`, many `Errors:` lines through `:1709`; `:1143` "surfaces as a RuntimeError"), `services/xstockstrat-agent/docs/context-constitution.md:22` (the `raise RuntimeError(_grpc_error_message(...))` convention) and `:31` (cites `PermissionError`, line drifted to `:2462`), `services/xstockstrat-agent/CLAUDE.md` (Management-tool authorization: `_require_admin` rejects `PermissionError`), `plugins/strat-lab/skills/backtest/SKILL.md:202` and `reference/backfill.md:41` ("Python exception name e.g. ValueError → report it") — root CLAUDE.md requires the strat-lab skill to change in the same PR for `run_backtest`/`manage_strategy`/`trigger_backfill`/`get_backfill_status`/`set_strategy_live`.

## Risks / Not-found

- **No handler catches tool `RuntimeError`/`PermissionError`**; only type-agnostic `except Exception` swallows (`tools.py:721`, `:881`, `:2604`) — a type change breaks no runtime handler.
- **Internal control-flow `ValueError`s must not be converted:** `tools.py:2600/:2602` are caught at `:2604` (UTF-8 fallback); `:2347` re-raises inside `except ValueError` (uuid parse); `client.py` ValueErrors caught internally at `:345,:1058,:1170,:1228,:2165`.
- **SDK adds `Error executing tool <name>: ` in front of every `ToolError`** — caller text becomes `Error executing tool X: FAILED_PRECONDITION: …`; any equality/`startswith` assertion on the message breaks (substring `in` checks pass). Equality-style asserts not yet enumerated.
- **AST test coupling:** `tests/test_tool_deadlines.py:304-327` scans for `_grpc_error_message(...)` calls and their kwargs; a helper that replaces or wraps the call shape must update it.
- **91 `pytest.raises(RuntimeError|ValueError|PermissionError)` across 21 test files** assert the old types (many in `test_tools.py`, `test_account_tools.py`, `test_watchlist_tools.py`, `test_user_tools.py`, `test_tool_deadlines.py`); decide whether `ToolError` replaces them or stays a subclass-compatible migration.
- **Unwrapped exceptions still masked** after the sweep: `httpx` errors from `_fetch_url` `r.raise_for_status()` (`tools.py:2703`) and `client.py` `ValueError`s reaching tools — in or out of scope is a design decision.
- **Log-level side effect:** converted failures log INFO without a traceback instead of ERROR with one (`server.py:453` vs `:455`); anything alerting on the ERROR logs loses signal.
- **Secrets/credentials in forwarded text:** no suite pins error-side non-echo (see Gap); operator decided no separate review (context.md 2026-11-07) — recorded, not re-litigated.
- Not found: any shared rpc-error helper in `conftest.py`; any existing `ToolError` use; raise types in `client.py` other than `ValueError` (unverified).
- `fails.md` trap applicable: agent tool surface drifts from its runbook/skill (2026-08-02 mcp-tools-alignment-triage) → docs parity is part of the change, not a follow-up.

## Recommended Scope

(advisory) 1) `_grpc_error_message` gains the code-name prefix + all 47 gRPC sites raise `ToolError`; 2) the 44 `ValueError`/2 `PermissionError`/8 hand-written `RuntimeError` refusals become `ToolError` (excluding the internal control-flow ones above); 3) tests: dispatch-level regression (@AC-1) + a surface-wide guard that no tool raises a non-`ToolError` refusal, migrate the 91 `pytest.raises`; 4) reword the 5 CHANGE scenarios + docs (`mcp-tools.md`, agent constitution/CLAUDE.md, strat-lab skill).
