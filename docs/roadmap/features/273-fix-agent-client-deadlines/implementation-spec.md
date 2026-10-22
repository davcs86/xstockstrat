# Implementation Spec: fix-agent-client-deadlines

**Status**: `pending`
**Created**: 2026-10-22
**Feature**: `docs/roadmap/features/273-fix-agent-client-deadlines/feature.md`
**Total Steps**: 12
**Feature Branch**: `feature/fix-agent-client-deadlines`

---

## Execution Summary

This spec follows design.md § Chosen Approach and its build order. Fixed module constants
`_RPC_TIMEOUT_S = 10.0` and `_LONG_RPC_TIMEOUT_S = 45.0` go on every agent → backend unary call as a per-call
`timeout=`. The mapper gains a `write` flag and the 272 server-detail pass-through. Every tool catch site passes
`deadline_s`, plus `write=` in mutating tools, and six tools gain a wrap. `ValidateToken` is bounded with a
three-way result, so an identity stall returns 503 without `WWW-Authenticate`. The pipeline has no channel
change, no shared helper and no config key (design.md Rejected Alternatives).

The steps run in this order:

1. A latency baseline (Step 1) runs first, because R1 can force an FR-2 amendment before the 45 s budget is
   pinned.
2. Each code change then lands as a red/green pair: client (2/3), mapper (4/5), tools (6/7) and auth (8/9).
3. Docs and governance close the feature: mcp-tools.md and the strat-lab skill in the same PR (10), the report
   sidecar, merge-order rows and follow-up reports (11), then the teardown (12).

**Hard precondition: 247 merged.** Feature `247-fix-agent-getconfig-deadline` must be merged to `main-dev` before
Step 2 starts, and this branch rebased onto it. Step 2's @AC-10 allow-list names 247's `_CONFIG_READ_TIMEOUT_S`,
and Step 6's @AC-2/@AC-8 tests reuse 247's `hung_config_server` fixture. At spec time 247 is
`implementation-ready` and unmerged: `grep -n "_CONFIG_READ_TIMEOUT_S" services/xstockstrat-agent/app/client.py`
returns nothing. **All `client.py` / `tools.py` / `conftest.py` line numbers below are pre-247, at branch tip
`9f99103b`.** 247 inserts three lines after `client.py:29`, so after the rebase re-anchor every site by its
**function name** (the design's line cites are function-`def` lines; the tables below give the call line).

**Consumer surface (C-14).** The surface is the MCP agent tools (`services/xstockstrat-agent/app/tools.py`,
Steps 6/7) plus the MCP HTTP auth edge (`app/main.py`, Steps 8/9). There is no UI, proto or REST surface
(product-spec § Consumer Surface(s)).

**Business-rule promotion (C-16).** At the integration PR, `/sdd-execute` promotes @AC-1..@AC-11 into
`services/xstockstrat-agent/acceptance/` (next to `fix-opportunities-read-hangs.feature`). The OAuth-edge CHANGE
(401 → 503 on an identity stall) was signed off at the r3 gate, addition (b), recorded in context.md.

## Scenario Coverage

| Scenario | Step(s) |
|---|---|
| @AC-1 get_positions hung → deadline error, "within" wording | 6 (tool), 4 (mapper wording) |
| @AC-2 get_config tool hung GetConfig | 6 |
| @AC-3 ingest_signal hung IngestSignal | 6 |
| @AC-4 slow RunBacktest (above default, below long) succeeds | 6 |
| @AC-5 nine-RPC bounded table | 2 |
| @AC-6 run_backtest all backends hung ≤ 57 s | 6 (tool hop + FR-3 arithmetic); auth term by 8 |
| @AC-7 responsive ListPositions unchanged | 6 |
| @AC-8 IngestSignal answers 42, config + notify hang | 6 |
| @AC-9 hung RunBacktest bounded by long budget | 6 |
| @AC-10 static guard: every stub call carries timeout | 2 |
| @AC-11 identity stall → 503 without WWW-Authenticate, shared trace id; invalid → 401 | 8 |

## Step Dependencies

- **247 must be merged and this branch rebased before Step 2** (see Execution Summary). Step 1 does not depend
  on 247.
- **Step 1 runs before Step 3 is committed.** If the measured RunBacktest / RunFundamentalsScan / ScreenSymbols /
  TriggerBackfill p99 is above 45 s, halt and escalate for an FR-2 amendment and an operator CHANGE sign-off on
  198 @AC-8 (design.md R1, P-03). Do not change the number silently. The same applies if the ValidateToken p99
  is not comfortably below 10 s (R5).
- Step 2 [test] covers Step 3 [service]. Step 4 [test] covers Step 5 [service]. Step 6 [test] covers Step 7
  [service]. Step 8 [test] covers Step 9 [service].
- Step 6 requires Steps 2, 3 and 5. It reuses Step 2's `hung_backend` fixture, and its wording assertions need
  Step 5's mapper.
- Step 7 requires Step 3, because the catch sites reference `client._RPC_TIMEOUT_S` / `client._LONG_RPC_TIMEOUT_S`.
- Step 8 requires Step 2 (`hung_backend`, with the `module=` redirect for `app.auth`) and Step 3 (the constant).
- Step 9 requires Step 3 (`auth.py` reads `client._RPC_TIMEOUT_S`).
- Steps 10-12 require Steps 3, 5, 7 and 9, because they document the shipped wording and behaviour.
- **Merge order:** 247 → 273 → 272 (`fix-analysis-backtest-bounds`). Step 11 writes both rows. Features 215, 240,
  241, 245 and 249 also edit `client.py` / `tools.py`. That is textual overlap only, so whichever merges second
  rebases and re-runs the agent suite. It is not a merge-order row.
- **Open risks carried to execution:**
  - R2: the 272 nesting is inverted today. ScreenSymbols has the same inversion:
    `analysis.screener.max_duration_seconds` defaults to 120 (`services/xstockstrat-analysis/app/handlers/servicer.py:3786`),
    above the agent's 45 s. The backend side belongs to the open
    `docs/reports/2026-10-19-cross-hop-deadline-bounds-unenforced-defect.md`.
  - R4 (`list_opportunities`, 68 s) and R10 (`extract_*`, no MCP-level cap) get follow-up defect reports in
    Step 11.
  - R7 is resolved by evidence, so no step is needed. `ExecuteFormula`'s sandbox time is
    `_clamp_override(request.timeout_ms_override, configured)`, which only tightens
    (`services/xstockstrat-indicators/app/handlers/servicer.py:66-68`, `:282`). The configured
    `indicators.sandbox.timeout_ms` is 5000 (`services/xstockstrat-config/migrations/001_config_tables.up.sql:62`)
    and 3000 in production (`002_config_environment.up.sql:61`), both under 10 s. No SetConfig upper bound exists:
    `grep -n "sandbox" services/xstockstrat-config/src/grpc/configServiceImpl.ts` finds nothing. The truncation
    risk therefore exists only if an operator raises the key to 10 000 ms or more, and the Step 11 follow-up note
    records it.

---

### Step 1 — docs: Latency baseline for the long RPCs and ValidateToken (R1, R5)

**Status**: `pending`
**Service**: `docs/roadmap/features/273-fix-agent-client-deadlines/`
**Files**:
- `docs/roadmap/features/273-fix-agent-client-deadlines/context.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- The agent emits gRPC client spans: `GrpcAioInstrumentorClient().instrument()` (`services/xstockstrat-agent/app/telemetry.py:39`, `:53`). Grafana Cloud setup is in `docs/setup/grafana-cloud.md`.
- The precedent is 247's Step "GetConfig latency baseline" (`git show origin/feature/fix-agent-getconfig-deadline:docs/roadmap/features/247-fix-agent-getconfig-deadline/implementation-spec.md`, lines 600-615): a 24 h query recording count, p50, p99 and max, with "Not measured" plus an escalation when no spans exist.
- Server bounds that may cap observed latency: `analysis.backtest.max_duration_seconds` 300 / 120 in production (`services/xstockstrat-config/migrations/001_config_tables.up.sql:69`, `002_config_environment.up.sql:71`), and `analysis.screener.max_duration_seconds` default 120 (`services/xstockstrat-analysis/app/handlers/servicer.py:3786`).
- No p99 for any of these RPCs exists in the repo. `grep -rn "p99" docs/roadmap/features/273-fix-agent-client-deadlines/` matches only the design's risk text. **Not found**, so it must be measured.

**TDD**: N/A (docs: measurement record only)

**Covers**: —

**Instructions**:
1. On the dev deployment, query the agent's client spans over at least 24 h for each of the following, and record
   count, p50, p99 and max for each:
   - `/xstockstrat.analysis.v1.AnalysisService/RunBacktest`
   - `/xstockstrat.analysis.v1.AnalysisService/RunFundamentalsScan`
   - `/xstockstrat.analysis.v1.AnalysisService/ScreenSymbols`
   - `/xstockstrat.ingest.v1.IngestService/TriggerBackfill`
   - `/xstockstrat.identity.v1.IdentityService/ValidateToken`

   If dev OTel is off, no spans exist, or the executor lacks trace access, record "Not measured" with the reason
   and escalate to the operator (P-03). Do not guess.
2. Append a `context.md` session entry headed `Deadline latency baseline` with the query text, the UTC window and
   the per-RPC figures. Also record the margins: for the four long RPCs against 45 s, and for ValidateToken
   against 10 s.
3. Escalate before Step 3 is committed, and do not proceed, if either holds:
   - any long-RPC p99 is above 45 s, which needs an FR-2 amendment plus a 198 @AC-8 CHANGE sign-off;
   - the ValidateToken p99 is not comfortably below 10 s (operator judgment).

**Verification**:
```bash
grep -n "Deadline latency baseline" docs/roadmap/features/273-fix-agent-client-deadlines/context.md
grep -n "RunBacktest\|RunFundamentalsScan\|ScreenSymbols\|TriggerBackfill\|ValidateToken" docs/roadmap/features/273-fix-agent-client-deadlines/context.md | tail -5
```

---

### Step 2 — test: Generic hung-backend fixture and client-level deadline RED tests (@AC-5, @AC-10)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/conftest.py` — modify
- `services/xstockstrat-agent/tests/test_client_deadlines.py` — create

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- Hung-server harness to copy (recon.md § Patterns to REUSE): `services/xstockstrat-agent/tests/test_list_opportunities_deadline.py`.
  - `_HANG_GUARD_S = 10` (`:17`) and a servicer doing `await asyncio.Event().wait()` (`:34`).
  - `monkeypatch.setattr(client, "ANALYSIS_ENDPOINT", f"127.0.0.1:{port}")` (`:48`).
  - `monkeypatch.setattr(client.mtls, "secure_channel", lambda ep, _svc: grpc.aio.insecure_channel(ep))` (`:49-51`).
  - `asyncio.wait_for(..., _HANG_GUARD_S)` (`:60`).
- 247 (merged by precondition) adds `HANG_GUARD_S = 10` and the `hung_config_server(monkeypatch)` fixture to `tests/conftest.py`. That fixture is a sync threaded `grpc.server(ThreadPoolExecutor(max_workers=8))`, because "`TestClient`'s portal loop cannot serve a pytest-loop-bound aio server". Its hang handler loops `while context.is_active() and not stop.is_set(): stop.wait(0.05)`, and teardown is `stop.set()` then `server.stop(0).wait()` (247 implementation-spec.md lines 140-160).
- `app.auth` and `app.client` share one `mtls` module object (`app/client.py:17`, `app/auth.py:15`, both `from app import mtls`), so a single `client.mtls.secure_channel` patch redirects both.
- Enumeration of all 73 unary call expressions, by an AST walk over `app/client.py` that matches `await stub.X(` and `await stub_cls(channel).X(`: only `list_opportunities`'s `ListOpportunities` (`:866`, `timeout=timeout` at `:872`) carries `timeout` today. The two `stub_cls(channel)` shapes are `list_templates` `:1318` and `instantiate_template` `:1342`.
- Client entry points and endpoints for the @AC-5 table:
  - `ingest_signal(source, symbol, direction, valid_from, ...)` (`client.py:209`) → `INGEST_ENDPOINT` `:240`
  - `emit_alert(severity, category, title, body, ...)` (`:249`) → `NOTIFY_ENDPOINT` `:280`
  - `list_positions(user_id, account_id="", limit=0, page_token="")` (`:2356`) → `PORTFOLIO_ENDPOINT` `:2372`
  - `get_config(namespace, environment, user_id="")` (`:2034`) → `CONFIG_ENDPOINT` `:2041`
  - `register_oauth_client(redirect_uris, client_name)` (`:1355`) → `IDENTITY_ENDPOINT` `:1359`
  - `run_backtest(user_id, strategy_id, symbols, ...)` (`:561`) → `ANALYSIS_ENDPOINT` `:632`
  - `screen_symbols(symbols, ...)` (`:698`) → `ANALYSIS_ENDPOINT` `:744`
  - `run_fundamentals_scan(force=False, dry_run=False, symbols=None, access_scope=0)` (`:1695`) → `ANALYSIS_ENDPOINT` `:1710`
  - `trigger_backfill(symbols, timeframe="1d", ...)` (`:1876`) → `INGEST_ENDPOINT` `:1947`
- Autouse env fixture: `tests/conftest.py:51` (`set_env`), which sets dummy `MTLS_*` (`:64-66`).
- No AC-10-style static test exists. `grep -rn "ast.parse" services/xstockstrat-agent/tests` finds none, so it is **Not found** and created here.

**TDD**: `red-green required`

**Covers**: `AC-5, AC-10`

**Instructions**:
1. In `tests/conftest.py`, add the fixture `hung_backend(monkeypatch)` next to 247's `hung_config_server`. Its value
   is `start(endpoint_attr: str, *, module=None, answers: dict | None = None)`. `module` defaults to `app.client`.
   `start` returns a handle exposing `port`, `calls` (a list of `(method, metadata_dict)`) and `entered`
   (`len(calls)`).
   - **Server.** Use `grpc.server(ThreadPoolExecutor(max_workers=8))` with one `grpc.GenericRpcHandler` whose
     `service(details)` returns `grpc.unary_unary_rpc_method_handler(fn)` with no (de)serializers, so requests and
     responses are raw bytes. It serves any method, so no per-service servicer class is needed. Bind
     `127.0.0.1:0` and start it.
   - **Handler.** Record `(details.method.rsplit("/", 1)[-1], dict(context.invocation_metadata()))` under a
     `threading.Lock`. Then branch on `answers.get(method_name)`:
     - `(delay_s, msg)`: call `stop.wait(delay_s)`, then return `msg.SerializeToString()`.
     - `(delay_s, grpc.StatusCode)`: wait, then call `context.abort(code, "rejected")`.
     - absent (hang mode): run 247's loop `while context.is_active() and not stop.is_set(): stop.wait(0.05)`.
   - **Redirect.** Call `monkeypatch.setattr(module, endpoint_attr, f"127.0.0.1:{port}")` and patch
     `client.mtls.secure_channel` exactly as `test_list_opportunities_deadline.py:49-51` does.
   - **Teardown.** Use 247's teardown: `stop.set()`, then `server.stop(0).wait()`.
   - **Docstring.** Explain why both fixtures exist: config paths keep 247's `hung_config_server`
     (recon REUSE), and this one serves every other service. Do not modify 247's fixture.
2. Create `tests/test_client_deadlines.py`, importing `HANG_GUARD_S` from `tests.conftest` (C-13: reuse the
   harness, do not copy it).
   - `test_ac5_every_listed_rpc_is_bounded`, parametrised over the 9 rows of acceptance.feature @AC-5.
     - Each row gives `(rpc, endpoint_attr, call, budget_attr)`. `call` invokes the client function with minimal
       args from the evidence list. Use `get_config("analysis", "staging")` with 247's `hung_config_server` for
       the GetConfig row, and `hung_backend` for the rest.
     - Patch `client._RPC_TIMEOUT_S` to 0.2 and `client._LONG_RPC_TIMEOUT_S` to 0.4, both with `raising=False`.
     - Assert `grpc.aio.AioRpcError` with `.code() == grpc.StatusCode.DEADLINE_EXCEEDED`.
     - Assert elapsed `< patched budget + 0.5` (absolute, design §5).
     - Assert `handle.entered == 1`.
     - Wrap each await in `asyncio.wait_for(…, HANG_GUARD_S)`.
   - `test_ac5_listed_rpcs_pass_the_production_budget_kwarg`, parametrised over the same 9 rows.
     - Use the mocked-stub shape (`patch(“app.client.mtls.secure_channel”)` plus a stub `AsyncMock`, as
       `tests/test_auth.py:21-28`).
     - Assert `call_args.kwargs["timeout"] == getattr(client, budget_attr)` for each row.
   - `test_deadline_constants_are_pinned`:
     - `client._RPC_TIMEOUT_S == 10.0`
     - `client._LONG_RPC_TIMEOUT_S == 45.0`
   - `test_ac10_every_unary_stub_call_carries_a_deadline` is the AST guard over
     `Path(client.__file__).read_text()`.
     - **Match.** Every `ast.Await` whose value is an `ast.Call` on an `ast.Attribute`, where the base is the name
       `stub` or is itself an `ast.Call` (the `stub_cls(channel)` shape). Assert at least 73 matches, so a matcher
       regression cannot pass vacuously.
     - **Every call** has a `timeout` keyword.
     - **Allowed `timeout` values.** It is an `ast.Name` whose id is in `{"_RPC_TIMEOUT_S", "_LONG_RPC_TIMEOUT_S"}`.
       The only exceptions are an explicit allow-list:
       - `ListOpportunities` → `timeout` (227);
       - `get_config_value`'s `GetConfig` → `_CONFIG_READ_TIMEOUT_S` (247).
     - **Bidirectional LONG check (R11).** The set of RPC attribute names using `_LONG_RPC_TIMEOUT_S` equals exactly
       `{"RunBacktest", "ScreenSymbols", "RunFundamentalsScan", "TriggerBackfill"}`.
3. C-13 verdict: the RPC table and response literals are single-consumer and stay inline in this file.
   `hung_backend` lives in `conftest.py` because Steps 6 and 8 also consume it.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run --no-sync pytest tests/test_client_deadlines.py -v   # RED before Step 3, GREEN after
grep -n "def hung_backend\|def hung_config_server\|HANG_GUARD_S" services/xstockstrat-agent/tests/conftest.py
grep -n "from tests.conftest import" services/xstockstrat-agent/tests/test_client_deadlines.py
cd services/xstockstrat-agent && ruff check . && ruff format --check . && uv run --no-sync pytest --cov=app --cov-fail-under=40
```

---

### Step 3 — service: Deadline constants and `timeout=` on every agent → backend unary call

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- Endpoint block `client.py:21-29`. 247 inserts `_CONFIG_READ_TIMEOUT_S = 3.0` directly after `:29`, with a
  two-line comment (247 implementation-spec.md lines 370-376).
- Constant style precedent: `_POLICY_READ_TIMEOUT_S = 3.0` (`app/tools.py:2369-2371`), "looked up at call time
  (never bound as a default argument) so tests can monkeypatch it".
- Kwarg precedent: `timeout=timeout,` after `metadata=` (`client.py:871-872`).
- Header trio unchanged: `_metadata()` (`client.py:59-87`) already carries `x-user-id` / `x-access-scope` /
  `x-trace-id` on every call (C-03, 210 @AC-2/@AC-5). This step adds no new outbound call.
- Channel factory untouched: `mtls.secure_channel` (`app/mtls.py:37-43`), per AGENT-1.
- Full call-site inventory (AST walk, pre-247 lines):

  | Function | RPC @ line | Constant |
  |---|---|---|
  | `list_signal_sources` | ListSignalSources @174 | RPC |
  | `ingest_signal` | IngestSignal @242 | RPC |
  | `emit_alert` | EmitAlert @282 | RPC |
  | `ensure_signal_watchlist` | EnsureSignalWatchlist @296 | RPC |
  | `add_watchlist_symbol` | AddWatchlistSymbols @314 | RPC |
  | `list_watchlists` / `get_watchlist` / `create_watchlist` | ListWatchlists @364, GetWatchlist @377, CreateWatchlist @409 | RPC |
  | `update_watchlist` | UpdateWatchlist @464 (masked), GetWatchlist @474, UpdateWatchlist @484 | RPC |
  | `delete_watchlist` / `add_watchlist_symbols` / `remove_watchlist_symbols` | DeleteWatchlist @497, AddWatchlistSymbols @521, RemoveWatchlistSymbols @534 | RPC |
  | `update_watchlist_bindings` | UpdateWatchlistBindings @554, GetWatchlist @555 | RPC |
  | `run_backtest` | RunBacktest @634 | **LONG** |
  | `screen_symbols` | ScreenSymbols @746 | **LONG** |
  | `list_opportunities` | ListOpportunities @866 | untouched (`timeout=timeout`) |
  | `manage_strategy` / `get_strategy` / `list_strategy_definitions` | ManageStrategy @947, GetStrategy @967, ListStrategyDefinitions @984 | RPC |
  | `execute_formula` / `cancel_backfill` | ExecuteFormula @1022, CancelBackfill @1043 | RPC |
  | `manage_formula` | RegisterFormula @1101, UpdateFormula @1133, DeleteFormula @1137 | RPC |
  | `list_formulas` / `get_formula` / `list_fundamental_metrics` | ListFormulas @1154, GetFormula @1178, ListFundamentalMetrics @1194 | RPC |
  | `manage_signal_source` | ManageSignalSource @1255 | RPC |
  | `list_templates` / `instantiate_template` | `stub_cls(channel).ListTemplates` @1318, `.InstantiateTemplate` @1342 | RPC |
  | OAuth: `register_oauth_client`, `get_oauth_client`, `issue_auth_code`, `validate_token`, `exchange_auth_code`, `refresh_oauth_token` | RegisterOAuthClient @1361, GetOAuthClient @1376, IssueAuthCode @1390, ValidateToken @1413, ExchangeAuthCode @1432, RefreshOAuthToken @1456 | RPC |
  | users: `get_user_metadata`, `update_user_metadata`, `create_user`, `list_users`, `get_user`, `set_user_roles`, `set_user_active`, `reset_password`, `admin_get_user_metadata`, `admin_update_user_metadata` | @1474, @1513, @1571, @1581, @1591, @1606, @1617, @1628, @1638, @1665 | RPC |
  | `set_strategy_live` | SetStrategyLive @1682 | RPC |
  | `run_fundamentals_scan` | RunFundamentalsScan @1712 | **LONG** |
  | `get_config_value` | GetConfig @1751 | untouched (247) |
  | `get_bars` / `get_fundamentals` / `get_historical_fundamentals` | GetBars @1811, GetFundamentals @1825, GetHistoricalFundamentals @1859 | RPC |
  | `trigger_backfill` | TriggerBackfill @1949 | **LONG** |
  | `get_backfill_status` | GetBackfillStatus @1973, ListBackfillJobs @2003 | RPC |
  | `get_config` / `list_config_keys` / `set_config` | GetConfig @2043, ListKeys @2073, SetConfig @2137 | RPC |
  | offline: `register_offline_account`, `record_offline_order`, `confirm_offline_order`, `snapshot_offline_positions`, `get_order`, `list_account_orders` | RegisterBrokerAccount @2195, PlaceOrder @2231, ConfirmOrder @2276, SnapshotOfflinePositions @2326, GetOrder @2336, ListOrders @2349 | RPC |
  | `list_positions` | ListPositions @2374 | RPC |
  | broker: `register_broker_account`, `update_broker_account_credentials`, `deregister_broker_account`, `resume_broker_account`, `list_broker_accounts` | @2409, @2433, @2453, @2470, @2488 | RPC |

  That is 73 expressions in total: 71 edited, 2 untouched.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Directly below 247's `_CONFIG_READ_TIMEOUT_S` line, add:
   ```python
   # Fixed nesting invariants under the MCP client's 60 s request timeout (PLAT-13), not config keys.
   # Read at call time so tests can monkeypatch them.
   _RPC_TIMEOUT_S = 10.0
   _LONG_RPC_TIMEOUT_S = 45.0
   ```
2. For every row above marked RPC or LONG, add `timeout=_RPC_TIMEOUT_S` (or `timeout=_LONG_RPC_TIMEOUT_S` on the
   four LONG rows) as the last keyword of the awaited stub call, after the existing `metadata=` keyword.
   - Read the constant in the body. Never add a `timeout` parameter or a default argument (C-18).
   - Do not touch `ListOpportunities` (`:872`) or 247's `get_config_value` site.
3. Change nothing else: no channel options, no helper, no reformatting of untouched lines.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run --no-sync pytest tests/test_client_deadlines.py -v   # GREEN
grep -c "timeout=_RPC_TIMEOUT_S" services/xstockstrat-agent/app/client.py      # expect 67
grep -c "timeout=_LONG_RPC_TIMEOUT_S" services/xstockstrat-agent/app/client.py # expect 4
grep -n "metadata=_metadata\|metadata=meta" services/xstockstrat-agent/app/client.py | wc -l   # unchanged vs pre-step (header trio untouched)
cd services/xstockstrat-agent && ruff check . && ruff format --check . && uv run --no-sync pytest --cov=app --cov-fail-under=40
```

---

### Step 4 — test: Mapper `write` branch and 272 pass-through RED tests (P-06)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tools.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- `_grpc_error_message(exc, not_found="not found", *, deadline_s=None)`: `app/tools.py:223-240`. The
  DEADLINE_EXCEEDED branch is at `:228-231`.
- The existing 227 contract tests stay unchanged:
  - `test_grpc_error_message_deadline_exceeded_names_the_deadline` (`tests/test_tools.py:1974-1982`);
  - `test_grpc_error_message_deadline_exceeded_without_deadline_s` (`:1985-1992`, which asserts
    `"within" not in msg`).
- Helper: `_rpc_error(code, details="")` (`tests/test_tools.py:929-932`) builds a real `grpc.aio.AioRpcError`.
  grpc's client-side deadline produces details `"Deadline Exceeded"` (the literal used at `:1979`, `:1990`).

**TDD**: `red-green required`

**Covers**: `AC-1` (the FR-4 "did not respond within" wording at the mapper unit; end to end in Step 6)

**Instructions**: next to the two 227 tests, add:
1. `test_grpc_error_message_write_deadline_says_outcome_unknown`. With `deadline_s=10.0, write=True` and details
   `"Deadline Exceeded"`, assert:
   - the message contains `within 10s` and `outcome unknown, verify before retrying`;
   - `"retry shortly" not in msg` (C-10).
2. `test_grpc_error_message_read_deadline_keeps_retry_text`. With `deadline_s=45.0` and the default
   `write=False`, assert `within 45s` and `retry shortly`.
3. `test_grpc_error_message_passes_through_server_deadline_detail` (272 pass-through, operator r2/r3 (c)). With
   details `"backtest exceeded max_duration_seconds"`, assert the result equals the details:
   - with `deadline_s=45.0`;
   - with `deadline_s=None`;
   - with `deadline_s=45.0, write=True`.
4. `test_grpc_error_message_client_sentinel_is_not_passed_through`. With details `"Deadline Exceeded"` and
   `deadline_s=45.0`, the message is the "within 45s" text, not `"Deadline Exceeded"`.
5. `test_grpc_error_message_write_without_deadline_s`. With `write=True` and `deadline_s=None`, assert the
   message contains `outcome unknown` and does not contain `within`.
6. Leave `:1974-1992` untouched. They must still pass after Step 5.
7. C-13: single-consumer literals stay inline.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run --no-sync pytest tests/test_tools.py -k grpc_error_message -v   # new tests RED before Step 5; 227 tests GREEN throughout
cd services/xstockstrat-agent && ruff check . && ruff format --check . && uv run --no-sync pytest --cov=app --cov-fail-under=40
```

---

### Step 5 — service: `_grpc_error_message` `write` flag and server-detail pass-through

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- `app/tools.py:223-231`, quoted:
  `if deadline_s is None: return "upstream did not respond (deadline exceeded); retry shortly"` / `return f"upstream did not respond within {deadline_s:g}s (deadline exceeded); retry shortly"`.
- The operator owns the pass-through for 272 (r2), widened at r3 (c): "fires when details != 'Deadline Exceeded',
  regardless of deadline_s" (context.md, 2026-10-22 sdd-design).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Change the signature to
   `_grpc_error_message(exc, not_found="not found", *, deadline_s: float | None = None, write: bool = False)`.
2. Rewrite only the DEADLINE_EXCEEDED branch:
   - `details = exc.details()`. If `details` is non-empty and `!= "Deadline Exceeded"`, return `details`. Add a
     one-line comment: grpc's client-side sentinel is that literal, so any other text came from the server.
   - `head` is `"upstream did not respond (deadline exceeded)"` when `deadline_s is None`, otherwise
     `f"upstream did not respond within {deadline_s:g}s (deadline exceeded)"`.
   - `tail` is `"outcome unknown, verify before retrying"` when `write`, otherwise `"retry shortly"`. Add a
     one-line comment: a client deadline does not prove a write failed.
   - `return f"{head}; {tail}"`.
   - The `deadline_s=None, write=False` text must stay byte-identical (227 contract).
3. Leave the other status branches untouched.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run --no-sync pytest tests/test_tools.py -k grpc_error_message -v   # GREEN, incl. :1974-1992
cd services/xstockstrat-agent && uv run --no-sync pytest tests/test_list_opportunities_deadline.py -v  # 227 "within 0.2s" unchanged
cd services/xstockstrat-agent && ruff check . && ruff format --check . && uv run --no-sync pytest --cov=app --cov-fail-under=40
```

---

### Step 6 — test: Tool-level deadline RED tests and catch-site guards (@AC-1..4, @AC-6..9)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tool_deadlines.py` — create

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- Tool-fn access pattern: `server = MCPServer("test-agent"); tools.register_tools(server); server._tool_manager.get_tool(name).fn` (`tests/test_list_opportunities_deadline.py:20-23`).
- Claims ctx: `from tests.conftest import ADMIN, _ctx` (`tests/conftest.py:12`, `:17`).
- Fixtures: `hung_backend` (Step 2) and 247's `hung_config_server` (its `answer_after_s` / `values` params, 247
  implementation-spec.md lines 147-150).
- Tool bodies:
  - `get_positions` → `client.list_positions` (`tools.py:2264-2267`)
  - `get_config` tool (`:1592`, catch `:1611`) → `client.get_config` (`client.py:2034`)
  - `ingest_signal` (`:581`). The primary call is at `:612-622`. The best-effort follow-ups run in their own
    `except Exception` blocks: config `:626-635`, EmitAlert `:641-657`, watchlist add `:660-668`.
  - `run_backtest` (`:715`) makes one `client.run_backtest` call (`:782-794`). Its summary block at `:799-802` is
    presentation-only.
  - `instantiate_template` (`:1197`): `_write_source_bearer` runs at `:1221-1224`, outside the `try`, before
    `client.instantiate_template` (`:1225-1234`).
- Protos for answered responses:
  - `portfolio_pb2.ListPositionsResponse(positions=[...])` (`packages/proto/portfolio/v1/portfolio.proto:198-201`)
  - `ingest_pb2.IngestSignalResponse(signal_id=...)` (`ingest.proto:138-139`)
  - `analysis_pb2.BacktestResult` (`analysis.proto:13`)
- Preserved rules: 127 @AC-4 (`services/xstockstrat-agent/acceptance/consolidate-watchlist-signal.feature`), and
  224 @AC-18/@AC-19 (`docs/sdd/business-rules/platform.feature`).
- Catch sites: 40 `except grpc.aio.AioRpcError` blocks in `tools.py` (`grep -n "except grpc.aio.AioRpcError" app/tools.py`). The only one passing `deadline_s` today is `list_opportunities` `:1564-1565`.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-6, AC-7, AC-8, AC-9`

**Instructions**: Create `tests/test_tool_deadlines.py`.

Shared setup for every hung-server test:
- Patch `client._RPC_TIMEOUT_S` to 0.2, `client._LONG_RPC_TIMEOUT_S` to 0.6 and `client._CONFIG_READ_TIMEOUT_S`
  to 0.2.
- Wrap each await in `asyncio.wait_for(…, HANG_GUARD_S)`.
- Bound elapsed time absolutely at the patched budget sum + 0.5 s.

1. `test_ac1_get_positions_hung_portfolio_surfaces_deadline`
   - Setup: `hung_backend("PORTFOLIO_ENDPOINT")`.
   - Assert a `RuntimeError` whose text contains `within 0.2s (deadline exceeded)`.
   - Assert elapsed `< 0.7` and `entered == 1`.
2. `test_ac2_get_config_tool_hung_config_surfaces_deadline`
   - Setup: 247's `hung_config_server()`, then the tool with `namespace="analysis"`.
   - Assert a `RuntimeError` containing `within 0.2s`.
3. `test_ac3_ingest_signal_hung_ingest_surfaces_deadline`
   - Setup: `hung_backend("INGEST_ENDPOINT")`, symbol `"AAPL"`.
   - Assert a `RuntimeError` containing `within 0.2s` and `outcome unknown, verify before retrying`
     (write=True).
   - Assert no follow-up ran: patch `client.emit_alert` and `client.ensure_signal_watchlist` as `AsyncMock`s and
     assert they were never awaited.
4. `test_ac4_slow_backtest_above_default_still_succeeds`
   - Setup: `hung_backend("ANALYSIS_ENDPOINT", answers={"RunBacktest": (0.4, analysis_pb2.BacktestResult(...))})`,
     which answers after 0.4 s: above the patched default of 0.2 s, below the patched long budget of 0.6 s.
   - Assert the tool returns its result list without raising.
5. `test_ac9_hung_backtest_bounded_by_long_budget`
   - Setup: hung `RunBacktest`.
   - Assert a `RuntimeError` containing `within 0.6s` and `retry shortly` (a read).
   - Assert elapsed `< 1.1`.
6. `test_ac6_run_backtest_tool_hop_bounded` (tool-hop scope)
   - Setup: every analysis method is hung.
   - Assert the error, and that the RunBacktest call is the tool's only backend call (`entered == 1`).
   - The 10 s auth term is proven by Step 8.
7. `test_ac7_responsive_portfolio_result_unchanged`
   - Setup: ListPositions answers one AAPL `Position` after 0.05 s.
   - Assert the tool returns exactly that one position, with the same projection as the existing
     `test_position_tools.py` expectations.
8. `test_ac8_ingest_returns_signal_when_config_and_notify_stall`
   - Setup:
     - `hung_backend("INGEST_ENDPOINT", answers={"IngestSignal": (0, IngestSignalResponse(signal_id=42))})`;
     - a second `hung_backend("NOTIFY_ENDPOINT")`;
     - `hung_config_server()`.
   - Call with conviction 0.9 and direction `"long"`.
   - Assert the result's `signal_id == 42`, and elapsed `< 0.2 + 0.2 + 0.2 + 0.5`.
9. `test_ingest_watchlist_followup_stall_is_swallowed` (127 @AC-4 PRESERVE, R6)
   - Setup: IngestSignal answers 42; portfolio is hung; config answers no threshold; direction `"watchlist"`.
   - Assert `signal_id == 42` is returned and a WARNING containing `Watchlist auto-add failed` is logged.
10. `test_instantiate_template_deadline_after_bearer_is_not_success` (224 @AC-18/19 PRESERVE)
    - Patch `client.set_config` to an `AsyncMock` that succeeds.
    - Patch `client.instantiate_template` to raise `_rpc_error(DEADLINE_EXCEEDED, "Deadline Exceeded")`.
    - Assert a `RuntimeError` containing `outcome unknown`.
    - Also assert that a deadline raised from `client.set_config` inside `_write_source_bearer` surfaces as a
      mapped `RuntimeError` containing `outcome unknown`, never a raw `AioRpcError`.
11. `test_fr3_worst_cases_fit_under_57s`, using the **production** constants (no patch):
    - `auth = client._RPC_TIMEOUT_S`;
    - `auth + client._LONG_RPC_TIMEOUT_S <= 57`;
    - `auth + 4 * client._RPC_TIMEOUT_S + client._CONFIG_READ_TIMEOUT_S <= 57` (the `ingest_signal` path,
      design §4);
    - `auth + 2 * client._RPC_TIMEOUT_S <= 57`.

    This covers the 57 s bounds of @AC-6/@AC-8 at production scale without sleeping.
12. `test_every_catch_site_passes_deadline_s`, an AST guard over `tools.py`:
    - Every `_grpc_error_message(...)` call outside its own `def` has a `deadline_s` keyword.
    - Inside `run_backtest`, `screen_symbols`, `trigger_backfill` and `run_fundamentals_scan` that keyword is
      `client._LONG_RPC_TIMEOUT_S`.
    - In `list_opportunities` it is `timeout_s` (unchanged).
    - Everywhere else it is `client._RPC_TIMEOUT_S` (bidirectional, R11).
13. `test_mutating_tool_catch_sites_pass_write_explicitly`, an AST guard (R3):
    - Every `_grpc_error_message(...)` call inside an enclosing function whose name starts with one of
      `("manage_", "set_", "admin_set_", "trigger_", "cancel_", "instantiate_", "emit_", "ingest_", "run_fundamentals_", "_write_")`
      has a `write` keyword.
    - The prefix set is name-derived, not a per-row W/I list (design rejected that).
14. `test_six_unmapped_tools_now_map`
    - For each of `list_signal_sources`, `extract_email_content` (via `_get_source`), `ingest_signal`,
      `emit_alert`, `screen_symbols` and `_write_source_bearer`, a patched client raising `_rpc_error(UNAVAILABLE, "down")` surfaces as
      `RuntimeError` (mapped), not `AioRpcError`.
    - Define the `_rpc_error` helper locally. C-13: it has one consumer here, and `test_tools.py:929` keeps its own,
      a pre-existing copy outside this step's scope.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run --no-sync pytest tests/test_tool_deadlines.py -v   # RED before Step 7 (except AC-4/AC-7/FR-3, which may pass early — they guard FR-5/FR-3 regressions), GREEN after
grep -n "from tests.conftest import" services/xstockstrat-agent/tests/test_tool_deadlines.py
cd services/xstockstrat-agent && ruff check . && ruff format --check . && uv run --no-sync pytest --cov=app --cov-fail-under=40
```

---

### Step 7 — service: Catch-site `deadline_s` / `write`, plus the six new wraps

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- Wrap idiom: `except grpc.aio.AioRpcError as e: raise RuntimeError(_grpc_error_message(e)) from e` (`tools.py:2266-2267`).
- Verb literals: `manage_watchlist` `operation == "create"` / `"update"` / `"delete"` (`:1951`, `:1962`, `:1974`).
  `manage_offline_account` reads are `"get_order"` / `"list_orders"` / `"list_positions"` (`:2113`, `:2117`,
  `:2121`). Its writes are `create_account` / `record_order` / `confirm_order` / `snapshot_positions` (`:2092`,
  `:2096`, `:2107`, `:2127`).
- `manage_watchlist` update is idempotent (I): replace-all `UpdateWatchlist` in a single transaction (design.md §2
  table, `watchlist_repo.go:199-210`).
- Existing catch sites (pre-247 lines) and their edits:

  | Tool (catch line) | `deadline_s=` | `write=` |
  |---|---|---|
  | `query_bars` 390; `query_fundamentals` 425, 450 | `client._RPC_TIMEOUT_S` | — |
  | `run_backtest` 793 | `client._LONG_RPC_TIMEOUT_S` | — |
  | `manage_strategy` 1039; `manage_formula` 1140 | RPC | `True` |
  | `get_formula` 1154; `list_formulas` 1166; `list_fundamental_metrics` 1179; `list_templates` 1193 | RPC | — |
  | `instantiate_template` 1233; `manage_signal_source` 1320; `set_strategy_live` 1353 | RPC | `True` |
  | `trigger_backfill` 1397; `run_fundamentals_scan` 1419 | LONG | `True` |
  | `get_backfill_status` 1450 | RPC | — |
  | `cancel_backfill` 1463 | RPC | `True` |
  | `test_formula` 1496; `list_strategies` 1514 | RPC | — |
  | `list_opportunities` 1564 | unchanged (`timeout_s`) | — |
  | `get_strategy` 1582; `get_config` 1611; `list_config_keys` 1638 | RPC | — |
  | `set_config` 1700; `set_user_metadata` 1737; `manage_user` 1805 | RPC | `True` |
  | `get_user_metadata` 1710; `list_users` 1815; `get_user` 1827; `admin_get_user_metadata` 1840 | RPC | — |
  | `admin_set_user_metadata` 1866 | RPC | `True` |
  | `list_watchlists` 1886; `get_watchlist` 1902 | RPC | — |
  | `manage_watchlist` 1979 | RPC | `operation != "update"` |
  | `manage_watchlist_symbols` 2031 | RPC | `True` |
  | `manage_offline_account` 2138 | RPC | `operation not in ("get_order", "list_orders", "list_positions")` |
  | `manage_account` 2221 | RPC | `True` |
  | `list_accounts` 2239; `get_positions` 2266; `get_positions_by_account_id` 2295 | RPC | — |

- New wraps (no `AioRpcError` mapping today):
  - `list_signal_sources` at `:486`;
  - `_get_source` at `:2324`, which covers both `extract_email_content` and `extract_website_content`;
  - `ingest_signal` primary at `:612-622`;
  - `emit_alert` at `:700-710`;
  - `screen_symbols` at `:847-855`;
  - `_write_source_bearer`'s `client.set_config` at `:347-359`.

  These match `docs/reports/2026-10-19-agent-tools-missing-grpc-error-mapping-defect.md` § Observed.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. At each existing catch site in the table, add the listed keywords to its `_grpc_error_message(...)` call. Keep
   its `not_found=` unchanged.
   - The verb-derived `write=` expressions apply any-verb-outside-the-read-set-is-a-write (design §2, R3).
   - When a `manage_*` tool gains a new read verb, it must be added to that tool's read set.
2. Add the six wraps with the idiom from the evidence:
   - `list_signal_sources` and `_get_source`: `deadline_s=client._RPC_TIMEOUT_S`.
   - `screen_symbols`: `deadline_s=client._LONG_RPC_TIMEOUT_S`.
   - `emit_alert`: `deadline_s=client._RPC_TIMEOUT_S, write=True`.
   - `_write_source_bearer`: wrap only the `client.set_config(...)` call, with
     `deadline_s=client._RPC_TIMEOUT_S, write=True`.
   - **`ingest_signal`: wrap ONLY the primary `client.ingest_signal(...)` call** (`:612-622`), with
     `deadline_s=client._RPC_TIMEOUT_S, write=True`.
     - The follow-ups at `:623-668` (alert-threshold read, auto-`emit_alert`, watchlist auto-add) stay exactly
       where they are, inside their existing `except Exception` blocks. This preserves 127 @AC-4 (design §2).
     - Posture (R6): a stall in a follow-up now reaches its fallback silently: the 0.6 default threshold, or a
       skipped auto-alert or auto-add logged at WARN. None of these opens a security gate (insights.md:3695-3705).
     - Do not edit the docstring's SIDE EFFECT text (127 @AC-5).
3. Do not add a mapper helper or a middleware catch (C-18, design Rejected Alternatives).

**Verification**:
```bash
cd services/xstockstrat-agent && uv run --no-sync pytest tests/test_tool_deadlines.py tests/test_tools.py tests/test_ingest_signal_watchlist.py tests/test_template_tools.py tests/test_watchlist_tools.py -v   # GREEN
grep -c "deadline_s=client._RPC_TIMEOUT_S" services/xstockstrat-agent/app/tools.py
grep -c "deadline_s=client._LONG_RPC_TIMEOUT_S" services/xstockstrat-agent/app/tools.py   # expect 4
cd services/xstockstrat-agent && ruff check . && ruff format --check . && uv run --no-sync pytest --cov=app --cov-fail-under=40
```

---

### Step 8 — test: Auth deadline and three-way result RED tests (@AC-11)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_auth.py` — modify
- `services/xstockstrat-agent/tests/test_auth_deadline.py` — create

**Reviewers**: `xstockstrat-agent` owner — OAuth 2.1 edge-auth correctness and statelessness (no in-memory store — `instance_count > 1` must stay safe)

**Codebase Evidence**:
- `validate_bearer_claims` (`app/auth.py:51-87`) calls `stub.ValidateToken(..., metadata=_metadata())` at `:71-73`.
  It catches `AioRpcError` with `log.info` → `None` (`:82-84`), and any other `Exception` with `log.error` →
  `None` (`:85-87`).
- `_metadata()` returns `[]` (`auth.py:23-24`). `validate_bearer_jwt` has the same call at `:39-41`.
- The mocked-stub pattern is `tests/test_auth.py:21-28`: patch `app.auth.mtls.secure_channel` and
  `app.auth.identity_pb2_grpc.IdentityServiceStub`.
- ASGI tests use `TestClient(build_http_app())` (`tests/test_oauth.py:16-19`). The existing 401 assertion is
  `test_streamable_root_unauthenticated_401_with_www_authenticate` (`:94-99`), and session-manager interception
  is shown at `:102-125`.
- `_authorized` (`app/main.py:145-162`) is gated by `handle_mcp` at `:206-208`. `_send_unauthorized` is
  `main.py:164-175`.
- Trace reuse: `CallerPropagationMiddleware` uses `claims.get("trace_id") or _new_trace_id()`
  (`app/tools.py:214`). Middleware trace reuse is already tested by `test_propagates_a_supplied_trace_id`
  (`tests/test_header_propagation.py:100`).
- The TestClient portal loop needs a threaded server, not `grpc.aio` (247 fixture docstring rationale). Step 2's
  `hung_backend` is threaded and takes `module=app.auth`.
- `IdentityService.ValidateToken` returns `TokenClaims` (`packages/proto/identity/v1/identity.proto:12`).

**TDD**: `red-green required`

**Covers**: `AC-11`

**Instructions**:
1. In `tests/test_auth.py`, add these tests, each using the `:21-28` mocked-stub shape:
   - `test_validate_bearer_claims_passes_default_deadline_and_trace`: call
     `validate_bearer_claims("t", trace_id="trace-273")`, then assert:
     - `ValidateToken.call_args.kwargs["timeout"] == client._RPC_TIMEOUT_S`;
     - `("x-trace-id", "trace-273") in kwargs["metadata"]`.
   - `test_validate_bearer_claims_unavailable_on_deadline_and_unavailable`, parametrised over `DEADLINE_EXCEEDED`
     and `UNAVAILABLE` raised as real `AioRpcError`. Assert:
     - the result `is auth.IDENTITY_UNAVAILABLE`;
     - a WARNING record is logged.
   - `test_validate_bearer_claims_invalid_token_still_none`: `UNAUTHENTICATED` → `None`.
   - `test_validate_bearer_jwt_passes_default_deadline`: assert the `timeout` kwarg. Its signature is otherwise
     unchanged.
2. Create `tests/test_auth_deadline.py`. Patch `client._RPC_TIMEOUT_S` to 0.2 and use
   `hung_backend("IDENTITY_ENDPOINT", module=app.auth)`.
   - `test_ac11_stalled_identity_returns_503_without_www_authenticate`:
     - Patch `app.main._new_trace_id` to return `"trace-273"`.
     - Build the app and POST `/` with `Authorization: Bearer some.jwt`.
     - Assert `status_code == 503` and `"www-authenticate" not in r.headers`.
     - Assert elapsed `< 0.7`.
     - Assert `handle.calls[0][1]["x-trace-id"] == "trace-273"`.
   - `test_ac11_valid_token_stamps_the_same_trace_id_on_claims`:
     - Identity answers `TokenClaims(user_id="u-1", aud=auth.AGENT_PUBLIC_URL)`.
     - Patch `StreamableHTTPSessionManager.handle_request` to capture `scope["state"][MCP_CLAIMS_SCOPE_KEY]`.
     - Assert the captured `claims["trace_id"] == "trace-273"` and that it equals the ValidateToken metadata trace
       id. Together with `test_header_propagation.py:100`, this proves the tool hop reuses it.
   - `test_ac11_invalid_token_still_401_with_www_authenticate`:
     - Identity answers `grpc.StatusCode.UNAUTHENTICATED`.
     - Assert 401 and `"resource_metadata=" in r.headers["www-authenticate"]`.
3. C-13: single-consumer literals stay inline. The fixture is imported via conftest.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run --no-sync pytest tests/test_auth.py tests/test_auth_deadline.py -v   # RED before Step 9, GREEN after
cd services/xstockstrat-agent && ruff check . && ruff format --check . && uv run --no-sync pytest --cov=app --cov-fail-under=40
```

---

### Step 9 — service: Bounded ValidateToken, three-way result, 503 on an identity stall, shared trace id

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/auth.py` — modify
- `services/xstockstrat-agent/app/main.py` — modify

**Reviewers**: `xstockstrat-agent` owner — OAuth 2.1 edge-auth correctness and statelessness (no in-memory store — `instance_count > 1` must stay safe)

**Codebase Evidence**:
- `auth.py:23-24` `_metadata()`; `:39-41` and `:71-73` the ValidateToken calls; `:82-84` the INFO-logged
  `AioRpcError` → `None`; `:58-61` the never-raises contract.
- `auth.py` imports only `from app import mtls` (`:15`). `app.client` imports no `app.auth` (`client.py:6-17`), so
  `from app import client` in `auth.py` creates no cycle.
- `main.py:26` `from app.tools import register_prompts, register_tools`; `main.py:103`
  `from app.auth import validate_bearer_claims` (inside `build_http_app`).
- `main.py:156-162`: `claims = await validate_bearer_claims(token)`, a `None` check, then the claims are stamped on
  `scope["state"]`. At `:206-208`, `if not await _authorized(scope): await _send_unauthorized(...)`.
- `_new_trace_id()` is at `tools.py:173-175`.
- No claims consumer serialises the claims dict: `grep -n "_require_claims(\|_claims_from_context(\|json.dumps(claims" app/*.py` returns only the readers at `tools.py:123`, `:142`, `:163`. So adding a `trace_id` key is safe (design §3).
- The C-03 / operator 2026-10-21 trace decision: this request-derived call carries the request's trace id.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Update `auth.py`.
   - Add `from app import client`.
   - Add a module sentinel `IDENTITY_UNAVAILABLE = object()`, with a one-line comment: it means "cannot verify",
     never "invalid".
   - Change `_metadata(trace_id: str = "")` to return `[("x-trace-id", trace_id)]` when `trace_id` is non-empty,
     else `[]`.
2. In `validate_bearer_jwt`, add `timeout=client._RPC_TIMEOUT_S` to the ValidateToken call. Nothing else changes.
3. In `validate_bearer_claims(token: str, trace_id: str = "")`:
   - Pass `metadata=_metadata(trace_id), timeout=client._RPC_TIMEOUT_S`.
   - In the `AioRpcError` handler, when `e.code()` is `DEADLINE_EXCEEDED` or `UNAVAILABLE`, call
     `log.warning("JWT claims validation unavailable: %s", e.code().name)` and return `IDENTITY_UNAVAILABLE`.
     Otherwise keep the INFO log and `None`.
   - Update the docstring's return contract: three outcomes, never raises.
4. In `main.py`, extend the `:26` import with `_new_trace_id`, and import `IDENTITY_UNAVAILABLE` alongside
   `validate_bearer_claims` (`:103`).
   - In `_authorized`:
     - mint `trace_id = _new_trace_id()`;
     - call `validate_bearer_claims(token, trace_id=trace_id)`;
     - return `IDENTITY_UNAVAILABLE` when the result is that sentinel;
     - set `claims["trace_id"] = trace_id` before stamping the scope.
   - Add `_send_identity_unavailable`: `Response("Service Unavailable", status_code=503, media_type="text/plain")`
     with **no** `WWW-Authenticate` header. Add a one-line comment: a 401 here would make the OAuth client re-auth
     against the same stalled identity.
   - In `handle_mcp`, run `verdict = await _authorized(scope)`. Check `verdict is IDENTITY_UNAVAILABLE` first (the
     sentinel is truthy), then `if not verdict:` → `_send_unauthorized`.
5. The empty-token path (`main.py:154-155`) and the invalid-token 401 are unchanged.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run --no-sync pytest tests/test_auth.py tests/test_auth_deadline.py tests/test_oauth.py tests/test_streamable_http_auth.py tests/test_header_propagation.py -v   # GREEN
grep -n "timeout=client._RPC_TIMEOUT_S\|x-trace-id\|IDENTITY_UNAVAILABLE" services/xstockstrat-agent/app/auth.py services/xstockstrat-agent/app/main.py
cd services/xstockstrat-agent && ruff check . && ruff format --check . && uv run --no-sync pytest --cov=app --cov-fail-under=40
```

---

### Step 10 — docs: mcp-tools.md, oauth.md and strat-lab backtest skill (same PR)

**Status**: `pending`
**Service**: `docs/runbooks/`, `plugins/strat-lab/`, `services/xstockstrat-agent/docs/`
**Files**:
- `docs/runbooks/mcp-tools.md` — modify
- `services/xstockstrat-agent/docs/oauth.md` — modify
- `plugins/strat-lab/skills/backtest/SKILL.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/runbooks/mcp-tools.md`:
  - § Streamable HTTP discovery bullet: "an unauthenticated request to the root MCP endpoint returns `401` with
    `WWW-Authenticate: …`" (`:63-68`);
  - the `## Tools` heading is at `:84`;
  - `list_opportunities` deadline wording is at `:1044-1046`.
- `services/xstockstrat-agent/docs/oauth.md:31-33`: "unauthenticated requests get `401` with a `WWW-Authenticate`
  … discovery pointer".
- `plugins/strat-lab/skills/backtest/SKILL.md`: § Phase 1 (backfill, `:175-179`) and § Phase 2 (run, `:181-187`).
  Root CLAUDE.md requires a change to `run_backtest` / `trigger_backfill` behaviour to update this skill in the
  same PR.
- Parity to keep (C-16 PRESERVE):
  - `mcp-tools.md` and the skill keep listing `list_templates` / `instantiate_template` without `is_public` /
    `include_public` (224 @AC-32);
  - the `ingest_signal` watchlist side-effect text stays (127 @AC-5).

**TDD**: N/A (docs)

**Covers**: —

**Instructions**:
1. In `mcp-tools.md`, add a `### Backend deadlines` subsection directly before `## Tools`. It states:
   - Every backend call carries a fixed deadline: 10 s by default, and 45 s for `run_backtest`, `screen_symbols`,
     `trigger_backfill` and `run_fundamentals_scan`. `list_opportunities` keeps its own config-driven deadline.
   - On expiry, read tools raise `upstream did not respond within Ns (deadline exceeded); retry shortly`.
   - Write tools raise `…; outcome unknown, verify before retrying`. Name `get_backfill_status` / `get_watchlist` /
     `list_*` as the verification reads.
   - When the server returned its own deadline detail, that detail is passed through.
   - These are code constants, not config keys.
2. Also in `mcp-tools.md`, after the discovery bullet, add one sentence: if identity cannot be reached in time
   during token validation, the endpoint returns `503` **without** `WWW-Authenticate`, so the client retries
   instead of re-authorizing. An invalid token still returns `401` with the pointer.
3. In `oauth.md:31-33`, add the same 503 sentence.
4. In the strat-lab `SKILL.md`, add one bullet to each phase:
   - Phase 2: `run_backtest` has a 45 s budget. A "did not respond within 45s" error is safe to retry, so narrow
     the symbol set or window first.
   - Phase 1: a `trigger_backfill` deadline says "outcome unknown". Check `get_backfill_status` before
     re-triggering, so no duplicate job is queued.

**Verification**:
```bash
grep -n "Backend deadlines\|outcome unknown, verify before retrying\|503" docs/runbooks/mcp-tools.md
grep -n "503" services/xstockstrat-agent/docs/oauth.md
grep -n "45 s\|45s\|outcome unknown" plugins/strat-lab/skills/backtest/SKILL.md
grep -n "is_public\|include_public" docs/runbooks/mcp-tools.md plugins/strat-lab/skills/backtest/SKILL.md   # expect no new hits
```

---

### Step 11 — docs: Report sidecar, merge-order rows and follow-up defect reports

**Status**: `pending`
**Service**: `docs/reports/`, `docs/roadmap/features/`
**Files**:
- `docs/reports/2026-10-19-agent-tools-missing-grpc-error-mapping-defect.status` — modify
- `docs/roadmap/features/merge-order.md` — modify
- `docs/reports/<date>-agent-list-opportunities-over-mcp-timeout-defect.md` + `.status` — create
- `docs/reports/<date>-agent-extract-tools-no-mcp-cap-defect.md` + `.status` — create

**Reviewers**: none

**Codebase Evidence**:
- The SEV-3 sidecar is currently `open` (`cat docs/reports/2026-10-19-agent-tools-missing-grpc-error-mapping-defect.status`).
- The sidecar contract is `.claude/skills/sdd-qa/reference/defect-filing.md:26-47`:
  - `triaged` + `ref: feature:<NNN-slug>`;
  - a `triaged` report whose feature reaches `launched` counts as resolved.
- `merge-order.md` lists only hard ordering constraints (`:14-18`). There is no row for 247/272/273 yet
  (`grep -n "fix-agent-client-deadlines\|fix-agent-getconfig-deadline\|fix-analysis-backtest-bounds" docs/roadmap/features/merge-order.md` → none).
- 272 is `fix-analysis-backtest-bounds`
  (`git show origin/main-dev:docs/reports/2026-10-21-analysis-backtest-bounds-defect.status` →
  `ref: feature:272-fix-analysis-backtest-bounds`).
- R4: `list_opportunities` reaches 68 s: auth 10 + policy 3 + the `ListOpportunities` ceiling 55
  (`services/xstockstrat-agent/CLAUDE.md` `agent.opportunities.read_timeout_seconds` row; design §4).
- R10: `extract_*` HTTP egress has no MCP-level cap (`tools.py:2390` `_fetch_url`; design §4).

**TDD**: N/A (docs)

**Covers**: —

**Instructions**:
1. Overwrite the SEV-3 sidecar with `triaged` and `ref: feature:273-fix-agent-client-deadlines`, because Step 7
   adds all six wraps. Do not edit the report body (it is a point-in-time record).
2. Append two `merge-order.md` rows, both with Resolved = `No`:
   - `fix-agent-client-deadlines` (273) | `fix-agent-getconfig-deadline` (247). Reason: 273's @AC-10 allow-list
     and the @AC-2/@AC-8 tests consume 247's `_CONFIG_READ_TIMEOUT_S` and `hung_config_server`.
   - `fix-analysis-backtest-bounds` (272) | `fix-agent-client-deadlines` (273). Reason: 272's server deadline
     detail reaches the caller only through 273's `_grpc_error_message` pass-through. Add the PLAT-13 nesting
     note: 272's server bound on `analysis.backtest.max_duration_seconds` must sit at or below about 40 s, under
     the agent's 45 s, or the pass-through never fires (R2).
3. File two follow-up defect reports with `/sdd-qa defect` (template and `open` sidecar, SEV-3):
   - R4: `list_opportunities` worst case 68 s, above the 60 s MCP timeout. Suggest lowering the
     `agent.opportunities.read_timeout_seconds` SetConfig ceiling.
   - R10: `extract_*` has no MCP-level cap. Also note R7's residual: no SetConfig bound on
     `indicators.sandbox.timeout_ms`, which would truncate `test_formula` at 10 000 ms or more.

   Record both paths in context.md.

**Verification**:
```bash
head -2 docs/reports/2026-10-19-agent-tools-missing-grpc-error-mapping-defect.status
grep -n "fix-agent-client-deadlines" docs/roadmap/features/merge-order.md
ls docs/reports/ | grep -i "list-opportunities-over-mcp-timeout\|extract-tools-no-mcp-cap"
```

---

### Step 12 — docs: Context teardown (AGENT-5 drift and the context-forge refresh)

**Status**: `pending`
**Service**: `services/xstockstrat-agent/docs/`
**Files**:
- `services/xstockstrat-agent/docs/context-constitution.md` — modify
- `docs/roadmap/features/273-fix-agent-client-deadlines/context.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- AGENT-5 (`services/xstockstrat-agent/docs/context-constitution.md:22`) says "the older tools don't have it" and
  that `_grpc_error_message` "maps `DEADLINE_EXCEEDED` to a 'retry shortly' message for every tool; a tool that
  sets its own gRPC deadline passes `deadline_s`". Both statements are false after Steps 5 and 7.
- Root CLAUDE.md § Teardown runs `/context-forge:context-constitution refresh` scoped to what changed, with a manual
  reconciliation recorded if the plugin is unavailable (ledger `fails.md:670`).

**TDD**: N/A (docs)

**Covers**: —

**Instructions**:
1. Rewrite AGENT-5's rule text to say:
   - every gRPC-calling tool maps through `_grpc_error_message` and passes `deadline_s`, plus `write=` in mutating
     tools;
   - the write text is "outcome unknown, verify before retrying";
   - non-sentinel server deadline details pass through.

   Keep its anchor `app/tools.py#_grpc_error_message`.
2. Run `/context-forge:context-constitution refresh` scoped to `services/xstockstrat-agent` and the docs touched
   in Steps 10-11, and fix the grounded drift it reports.
   - A fix in a file not listed here is a Deviation Log entry (F-08/F-09), not a silent edit.
   - If the plugin is unavailable, re-read AGENT-1/4/5, `services/xstockstrat-agent/CLAUDE.md` and `oauth.md`
     against the code by hand. Record in context.md, and later in the integration PR body, that the plugin was
     unavailable and what you reconciled.
3. Append the teardown result to `context.md`.

**Verification**:
```bash
grep -n "AGENT-5" services/xstockstrat-agent/docs/context-constitution.md
grep -n "outcome unknown" services/xstockstrat-agent/docs/context-constitution.md
grep -n "teardown" docs/roadmap/features/273-fix-agent-client-deadlines/context.md | tail -1
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
