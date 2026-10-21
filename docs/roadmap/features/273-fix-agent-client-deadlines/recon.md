# Recon: fix-agent-client-deadlines

**Created**: 2026-10-21
**From**: product-spec.md
**Affected services**: xstockstrat-agent

---

## Objective

Bound every agent → backend unary gRPC call in `services/xstockstrat-agent/app/client.py` with a deadline: a 10 s
default (FR-1) and 45 s for `RunBacktest`, `TriggerBackfill`, `RunFundamentalsScan`, `ScreenSymbols` (FR-2). Each
MCP tool's worst case must stay at least 3 s under the MCP client's 60 s request timeout (FR-3, PLAT-13). A stall
must surface as a `DEADLINE_EXCEEDED`-derived tool error rather than a hang (FR-4), and the happy path must not change
(FR-5). The `get_config_value` → `GetConfig` call (`client.py:1751`) belongs to feature 247 and is excluded
(operator decision, 2026-10-21).

## Codebase Map

- **`xstockstrat-agent`** (Python 3.13, MCP server)
  - Entry point: `create_server` — `app/main.py:77`; tool registration via `tools.register_tools(server)`.
  - Handler/servicer: MCP tools in `app/tools.py`. All of them reach backends through `app/client.py`.
  - Channel factory: `secure_channel` — `app/mtls.py:37-43`. It passes only
    `options=[("grpc.ssl_target_name_override", target_service)]` and sets no deadline or keepalive. AGENT-1
    (`docs/context-constitution.md`) requires one ephemeral channel per call, with no pooled channel.
  - Client call sites: 69 `mtls.secure_channel(` opens and 71 `await stub.<Rpc>(` calls in `app/client.py`, plus
    two calls written as `await stub_cls(channel).ListTemplates(` / `.InstantiateTemplate(` (`client.py:1318`,
    `:1342`) that a naive `await stub\.` grep misses. That makes 73 unary call expressions. No streaming calls.
  - The only call with a deadline today: `list_opportunities(..., timeout: float | None = None)` — `client.py:853`,
    passed as `timeout=timeout` at `client.py:872`.
  - Call sites outside `client.py`: `app/auth.py:39` and `:71` (`ValidateToken` on identity, through
    `mtls.secure_channel` at `:37` / `:69`). Neither has a deadline, and FR-1's wording ("in `app/client.py`")
    does not cover them. See Risks.
  - Last migration: n/a. The agent has no `migrations/` directory and this feature needs none.
  - Config-read pattern: `_agent_policy` — `app/tools.py:2374-2387` (calls `client.get_config_value`, falls back to the
    default on any exception). Its fixed cap is `_POLICY_READ_TIMEOUT_S = 3.0` at `app/tools.py:2371`, applied through
    `asyncio.wait_for` at `app/tools.py:1551-1553` (`list_opportunities`).
  - Other key symbols:
    - `_grpc_error_message(exc, not_found=..., *, deadline_s=None)` — `app/tools.py:223-231`. The `DEADLINE_EXCEEDED`
      branch returns `"upstream did not respond within {deadline_s:g}s (deadline exceeded); retry shortly"`, or
      `"upstream did not respond (deadline exceeded); retry shortly"` when `deadline_s` is None.
    - `CallerPropagationMiddleware` — `app/tools.py:190-220`. It only binds and unbinds caller context and maps no
      errors.
    - `ingest_signal` tool — `app/tools.py:581-669` (calls at `:612`, `:627`, `:646`, `:663`, `:664`).
    - `run_backtest` tool — `app/tools.py:715`. It catches `AioRpcError` at `:793-794`.
    - `instantiate_template` tool — `app/tools.py:1197`. It catches at `:1233-1234`.
    - `get_config` tool — `app/tools.py:1592`. It catches at `:1611-1612`.
    - `manage_watchlist` tool — `app/tools.py:1906`. It catches at `:1979-1980`.
    - `get_positions` tool — `app/tools.py:2265-2267` and `:2289-2296`. Both catch and map.

## Patterns to REUSE

- **Deadline constant** → reuse the module-level fixed-float style of `_POLICY_READ_TIMEOUT_S = 3.0`
  (`app/tools.py:2371`). Feature 247 is about to add `_CONFIG_READ_TIMEOUT_S = 3.0` in `client.py` (its
  `implementation-spec.md:178`). It is not in the tree yet, so this feature rebases after 247 and must not alias
  or re-edit 247's site.
- **Passing the deadline** → reuse the `timeout=` kwarg on the stub call, as `ListOpportunities` does
  (`client.py:872`). AGENT-1 forbids channel caching, and grpc-python has no channel-level default deadline
  option. The deadline therefore goes on the call (either per site or through one shared helper; that choice is a
  design fork), not on `mtls.secure_channel`.
- **Deadline error text** → reuse `_grpc_error_message(e, deadline_s=...)` (`app/tools.py:223-231`). This is
  feature 227's wording and satisfies FR-4 and @AC-1 ("did not respond within"). Tools that already catch
  `AioRpcError` call it without `deadline_s`, so they currently produce the generic text without a number.
- **Hung-server test harness** → copy `tests/test_list_opportunities_deadline.py`:
  - an in-process `grpc.aio.server()` whose servicer does `await asyncio.Event().wait()` (`:34`);
  - `monkeypatch.setattr(client, "<SVC>_ENDPOINT", ...)` (`:48`);
  - the `client.mtls.secure_channel` → `grpc.aio.insecure_channel` swap (`:50`);
  - the `asyncio.wait_for(..., _HANG_GUARD_S)` guard (`:17`, `:60`).

  The autouse env fixture is in `tests/conftest.py:51`. Tests run with `uv run pytest --cov=app --cov-fail-under=40`.
- **Ledger pattern** → insights `2026-10-20 — fix-agent-getconfig-deadline — design` (`docs/roadmap/ledger/insights.md:3695-3705`).
  Before deadlining a read whose callers use an `except Exception` fallback, list what each fallback *permits*,
  because a hang can be an accidental fail-closed control. Apply this to every best-effort follow-up that the new
  deadlines make reachable, starting with `ingest_signal` `:625-669` and `_agent_policy`.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-2 @regression @feature-227` "A hung analysis read fails fast at the agent instead of hanging" (`services/xstockstrat-agent/acceptance/fix-opportunities-read-hangs.feature`). `ListOpportunities` keeps its own deadline (default 40 s) and its wording. The FR-1 10 s default must not override it, and the @AC-10 static check must accept its existing `timeout=`.
- **PRESERVE** `@AC-4 @FR-3 @feature-127` "A portfolio failure never fails the already-committed ingest" (`services/xstockstrat-agent/acceptance/consolidate-watchlist-signal.feature`). A follow-up portfolio gRPC failure, now including `DEADLINE_EXCEEDED`, is swallowed with a WARN log, and `ingest_signal` still returns `signal_id`. This interacts directly with the new @AC-3 and @AC-8.
- **PRESERVE** `@AC-1 @FR-1 @FR-2 @feature-127`, `@AC-2 @FR-6 @feature-127`, `@AC-3 @FR-4 @feature-127` (`docs/sdd/business-rules/platform.feature`). The `ingest_signal` watchlist auto-add fires only for a non-deduplicated `watchlist` direction. It must stay reachable and must not run twice under the new deadlines.
- **PRESERVE** `@AC-5 @FR-5 @feature-127` "The tool docstring and mcp-tools.md both document the watchlist side effect" (`services/xstockstrat-agent/acceptance/consolidate-watchlist-signal.feature`). Any doc or docstring edit for deadlines must keep the side-effect mention.
- **PRESERVE** `@AC-8 @feature-156` "The MCP tool triggers a scan for an admin and rejects a non-admin" (`services/xstockstrat-agent/acceptance/fix-fundamentals-signal-producer.feature`). The 45 s `RunFundamentalsScan` budget must not change scope forwarding or the `PERMISSION_DENIED` mapping.
- **PRESERVE** `@AC-5 @FR-3 @feature-148` "manage_watchlist update of only the name does not wipe existing symbols" (`services/xstockstrat-agent/acceptance/mcp-watchlist-tools.feature`). The read-modify-write merge must stay correct. Count both sequential calls and the replace-all `UpdateWatchlist` when sizing the FR-3 worst case.
- **PRESERVE** `@AC-1 @FR-1 @FR-5 @feature-148`, `@AC-2 @FR-2 @FR-5 @feature-148`, `@AC-4 @FR-3 @FR-5 @feature-148`, `@AC-7 @FR-4 @FR-5 @feature-148` (`services/xstockstrat-agent/acceptance/mcp-watchlist-tools.feature`). `x-user-id` is forwarded, no `user_id` goes in the body, and the happy-path result does not change.
- **PRESERVE** `@AC-3 @FR-2 @feature-148`, `@AC-6 @FR-3 @feature-148` (`services/xstockstrat-agent/acceptance/mcp-watchlist-tools.feature`). `PERMISSION_DENIED` and `FAILED_PRECONDITION` still surface as tool errors. The deadline mapping is added alongside them.
- **PRESERVE** `@AC-11 @FR-5 @feature-170`, `@AC-12 @FR-5 @feature-170` (`services/xstockstrat-agent/acceptance/watchlist-bulk-default-strategy.feature`). The default-strategy round-trip and the atomic bulk assign do not change.
- **PRESERVE** `@AC-8 @FR-7 @feature-198` "Agent run_backtest accepts a fundamental operand" (`services/xstockstrat-agent/acceptance/historical-fundamentals-backtest.feature`). The `RunBacktest` request and result do not change under the 45 s budget.
- **PRESERVE** `@AC-1 @FR-1 @feature-164`, `@AC-6 @FR-4 @feature-164` (`services/xstockstrat-agent/acceptance/agent-broker-account-tools.feature`). Account tool results and ownership gating do not change on the happy path.
- **PRESERVE** `@AC-5 @FR-3 @feature-204`, `@AC-6 @FR-4 @feature-204`, `@AC-7 @FR-4 @feature-204`, `@AC-9 @FR-5 @feature-204`, `@AC-21 @FR-5 @feature-204` (`services/xstockstrat-agent/acceptance/backfilled-data-queryable.feature`). The `query_bars` and `query_fundamentals` output shape, caps and pagination do not change.
- **PRESERVE** `@AC-1 @FR-1 @feature-161`, `@AC-2 @FR-2 @feature-161`, `@AC-3 @FR-2 @feature-161`, `@AC-10 @FR-2 @feature-161` (`services/xstockstrat-agent/acceptance/surface-signal-weight-decay-config.feature`). Signal-source weight surfacing and the mapping of backend rejections do not change.
- **PRESERVE** `@AC-25 @FR-12 @feature-224` "Agent tools expose templates and drop public arguments" (`services/xstockstrat-agent/acceptance/private-by-default-templates.feature`). The template tool surface does not change.
- **PRESERVE** `@AC-18 @FR-9 @feature-224`, `@AC-19 @FR-9 @feature-224` (`docs/sdd/business-rules/platform.feature`). The template deep-copy is all-or-nothing on the server side. An agent-side deadline must never be reported as success after a partial copy.
- **PRESERVE** `@AC-32 @FR-12 @feature-224` (`docs/sdd/business-rules/platform.feature`). `mcp-tools.md` and the strat-lab skill keep listing `list_templates` and `instantiate_template` and keep omitting `is_public` and `include_public`. Any edit for deadline errors must keep this parity.
- **PRESERVE** `@AC-2 @FR-3 @feature-210`, `@AC-5 @FR-5 @feature-210` (`docs/sdd/business-rules/platform.feature`). Adding `timeout=` must not change mTLS channel setup or the propagated header trio.

No CHANGE rows. Every new `@AC-*` in this feature's `acceptance.feature` is additive. The scenario-recon pass read
three agent suites in full and `mcp-watchlist-tools.feature` up to line 50. It scanned the others by tag and title
only, so the rows for features 161, 164, 170, 198 and 204 are inferred and should be re-read at spec.

## Dependencies

- Proto/RPC: none. No message or field changes. The existing RPCs only gain a client-side deadline.
- Migration: none.
- Config keys: none (product-spec Fix Scope: fixed code constants). An `agent.*` key would require a spec amendment
  and the new-config-key gate.
- Inter-service edges: none new. The existing agent → ingest, notify, portfolio, analysis, indicators, identity,
  config, marketdata and trading (gRPC) edges are unchanged in shape.
- New env vars / ports: none.

## FR-3 worst-case enumeration (sequential backend calls per tool invocation)

This is the grep in `app/tools.py` for tool bodies with more than one `await client.` call, cross-checked against
`client.py` functions that make more than one stub call. Budgets assume FR-1 = 10 s, FR-2 = 45 s and 247's 3 s
config read.

| Tool | Sequential calls (worst path) | Worst case | Evidence |
|---|---|---|---|
| `ingest_signal` | `IngestSignal` 10 + `get_config_value` 3 (247) + `EmitAlert` 10 + `EnsureSignalWatchlist` 10 + `AddWatchlistSymbols` 10 | **43 s** (all paths fire when `direction="watchlist"` and conviction ≥ threshold) | `tools.py:612, :627, :646, :663, :664` |
| `manage_watchlist` (update without a mask path) | `GetWatchlist` 10 + `UpdateWatchlist` 10 on one channel | 20 s | `client.py:474, :484`; the masked path is a single call at `:464` |
| `manage_watchlist_symbols` (`assign`) | `UpdateWatchlistBindings` 10 + `GetWatchlist` 10 | 20 s | `client.py:554-555`; tool `tools.py:2027` |
| `list_opportunities` (out of scope) | policy read 3 (`wait_for`) + `ListOpportunities` up to its `[30,55]` SetConfig ceiling | 43 s at the 40 s default; **58 s** at the 55 s ceiling | `tools.py:1551-1562`; `services/xstockstrat-agent/CLAUDE.md:205` |
| `extract_email_content` / `extract_website_content` | 4 × `_agent_policy` config reads (3 s each once 247 lands; no `wait_for`) plus HTTP connect (10 s) and read (30 s) for each redirect hop | backend part 12 s; HTTP part not a backend RPC | `tools.py:2401-2404`, `:2418` loop |
| `instantiate_template`, `get_config`, `run_backtest`, `trigger_backfill`, `run_fundamentals_scan`, `screen_symbols`, `get_positions`, all others | single backend call per invocation (the `manage_user`, `manage_account`, `manage_offline_account`, `manage_formula`, `get_backfill_status` and `query_fundamentals` branches are mutually exclusive) | ≤ 45 s | `tools.py:1783-1800, :2092-2131, :2190-2212, :422-442`; `client.py:1101/1133/1137`, `:1973/2003` |

Conclusion for design: with per-call budgets alone, every in-scope tool fits under 57 s (largest: `ingest_signal` at
43 s). No tool-level `wait_for` is required, **provided** 247's 3 s config deadline has merged. Without it, @AC-8
(config stalled) is unbounded.

## Risks / Not-found

- **Six tools catch no `AioRpcError`**: `list_signal_sources`, `extract_email_content`, `extract_website_content`,
  `ingest_signal`, `emit_alert` and `screen_symbols` (`docs/reports/2026-10-19-agent-tools-missing-grpc-error-mapping-defect.md`,
  status `open`). For these, a deadline surfaces as a raw `AioRpcError` (its code is still `DEADLINE_EXCEEDED`)
  without the FR-4 "did not respond within" wording. @AC-3 (`ingest_signal`) and the `ScreenSymbols` path of FR-4
  hit this directly. Design must decide whether this feature adds the mapping for these tools (a scope overlap with
  that open SEV-3 defect) or relies on the raw error. The middleware catch point (`CallerPropagationMiddleware`,
  `tools.py:190`) currently maps nothing.
- **Tools that do map omit `deadline_s`**, so they print the generic "upstream did not respond (deadline exceeded)".
  @AC-1 asserts "did not respond within", which the generic text does not contain. The wording must either carry
  the number (requiring each tool to know its budget) or @AC-1's assertion must accept the generic form. This is a
  design fork.
- **Conflict between 127 `@AC-4` and FR-4** (from scenario-recon): the follow-up calls in `ingest_signal`
  (config read, `EmitAlert`, portfolio add; `tools.py:625-668`) must stay best-effort inside their existing
  `except Exception`. Only the primary `IngestSignal` deadline may surface as a tool error. Otherwise 127 `@AC-4`
  silently regresses (C-16).
- **Fallback posture (ledger insights :3695)**: the new deadlines make these `except Exception` fallbacks reachable
  on a stall: `_agent_policy` (falls back to a default), the alert-threshold read (falls back to 0.6), and the
  auto-alert and watchlist auto-add (skipped with a WARN). None of them visibly opens a security gate. Design should
  state this explicitly.
- **`auth.py` `ValidateToken` (`app/auth.py:39`, `:71`) is undeadlined and not in FR-1's literal scope**
  ("in `app/client.py`"). It sits on the inbound MCP auth path, so a stalled identity backend hangs every request
  before any tool runs. Design must either amend FR-1 to include it or list it explicitly as out of scope (P-03).
- **`ExecuteFormula` caller-set sandbox timeout**: `test_formula` forwards `timeout_ms_override` (`client.py:997`,
  `:1010`) as a request field. If the indicators sandbox allows an override close to or above 10 s, the 10 s FR-1
  default would cut off a legitimate long dry run. The maximum allowed override has not been verified, so design
  should check it and pick the budget for this call.
- **AC-10 static check shape**: the check must match both `await stub.X(` and `await stub_cls(channel).X(`
  (`client.py:1318`, `:1342`). It must also allow 247's `get_config_value` site once 247 has merged. Counting `await
  stub\.` alone gives 71 and misses two.
- **`list_opportunities` ceiling**: 3 s + 55 s = 58 s, so this out-of-scope tool breaks FR-3's "≥ 3 s under 60" at
  the configured maximum (227 accepted a 2 s margin). FR-3 says "every MCP tool". Design should record this as a
  known exception that is not changed here (product-spec Out of Scope).
- **Sequencing / overlap**: 247 (implementation-ready) must merge first, because it supplies the constant style and
  the config deadline that the @AC-8 bound depends on. Features 215, 240, 241, 245 and 249 also edit
  `client.py`/`tools.py`, so a sweep across about 73 sites will produce textual conflicts and should rebase last.
  There is no merge-order row yet (review recommended a SOFT row after 247).
- **Open PLAT-13 defect** `docs/reports/2026-10-19-cross-hop-deadline-bounds-unenforced-defect.md` (status `open`)
  covers the backend side. This feature only bounds the agent hop.
- **Wall-clock tests**: the AC bounds (10.5 s, 45.5 s, 57 s) must be asserted without real sleeps, per the
  acceptance header, for example by passing the budget through a patched constant or asserting
  `kwargs["timeout"]` (247 §5(b) style). A real 45 s hang test would be too slow for CI.
- **Docs and skill**: root CLAUDE.md requires the strat-lab `backtest` skill (`plugins/strat-lab/`) to be updated
  in the same PR when `run_backtest` or `trigger_backfill` behavior changes. The new deadline error is a new failure
  mode, so check whether the skill or `docs/runbooks/mcp-tools.md` must mention it.
- Not found:
  - any `grpc.keepalive*` or channel-level deadline option in the agent;
  - any shared call helper;
  - `_CONFIG_READ_TIMEOUT_S` (247 is unmerged);
  - an existing AC-10-style static test;
  - hung-server tests for any RPC other than `ListOpportunities`.

## Recommended Scope

Advisory input to grilling and `/sdd-spec`:

1. **Constants and wiring** (`app/client.py`): add `_RPC_TIMEOUT_S = 10.0` and `_LONG_RPC_TIMEOUT_S = 45.0`, and pass
   `timeout=` at every unary call site (four long-running sites, the rest default). Leave `ListOpportunities` and
   247's `get_config_value` untouched. Design fork: per-site kwarg or a thin shared helper. AGENT-1 rules out
   channel-level placement.
2. **Tool error surfacing** (`app/tools.py`): make sure each in-scope tool maps `DEADLINE_EXCEEDED` through
   `_grpc_error_message` with the FR-4 wording. This includes the six unmapped tools, if design takes on that
   overlap, while `ingest_signal` follow-ups stay best-effort.
3. **Tests**: a static AST check (@AC-10); hung-server tests for @AC-1, 2, 3, 8 and 9 modeled on
   `test_list_opportunities_deadline.py` with a patched or asserted budget; a `kwargs["timeout"]` check over the
   @AC-5 table; and happy-path tests for @AC-4 and @AC-7.
4. **Decide `auth.py` ValidateToken** (amend FR-1 to include it, or record it as out of scope), then run the
   docs/skill parity check (`mcp-tools.md`, strat-lab) and the teardown.
