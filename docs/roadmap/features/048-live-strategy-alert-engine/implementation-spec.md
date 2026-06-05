# Implementation Spec: live-strategy-alert-engine

**Status**: `pending`
**Created**: 2026-06-05
**Feature**: `docs/roadmap/features/048-live-strategy-alert-engine/feature.md`
**Total Steps**: 13
**Feature Branch**: `feature/live-strategy-alert-engine`

---

## Execution Summary

The implementation proceeds in five logical phases. First, the proto contract is extended with `SetStrategyLive` messages and RPCs, and `bool live_enabled = 8` is added to `StrategyDefinition` (Steps 1–2). Second, the `live_enabled` column migration is created for `analysis.strategies` (Step 3). Third, `xstockstrat-analysis` gains `SetStrategyLive` RPC handling, the asyncio evaluation loop (`app/engine/live_loop.py`), and the `NOTIFY_ENDPOINT` channel wired in `main.py` for alert emission (Steps 4–6). Fourth, the MCP agent gains a `set_strategy_live` admin-scoped tool (Steps 7–8). Fifth, the UI gains the trader BFF route for `SetStrategyLive` and `ListAlerts(categories=["strategy"])`, the `LiveStrategiesPanel` component, and E2E coverage (Steps 9–12). Step 13 is a docs update.

Steps 1–2 (proto) must complete before all service steps because service code imports the generated stubs. Step 3 (migration) can run in parallel with Step 1. Steps 4–6 (analysis) require Steps 1–2. Steps 7–8 (agent) require Steps 1–2. Steps 9–12 (UI) require Steps 1–2. This feature **hard-depends on `047-strategy-engine`** — all analysis steps assume the `analysis.strategies` table (from 047 Step 3), `StrategyDefinition` message (from 047 Step 1), `ListStrategyDefinitions` RPC (from 047 Step 1), and the shared evaluator (`app/engine/evaluator.py`, from 047 Steps 4–5) already exist.

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto): generated stubs must exist before service imports.
- Steps 4–6 (analysis service) require Steps 1–2: import `analysis_pb2` new messages and `notify_pb2`.
- Steps 7–8 (agent) require Steps 1–2: import `analysis_pb2` for `SetStrategyLiveRequest`.
- Step 3 (migration) is independent of proto steps.
- Steps 4–6 require Step 3 at runtime (column must exist before `SetStrategyLive` writes it).
- Step 6 (analysis test) covers Steps 4–5 and Step 3.
- Steps 9–11 (UI BFF + component) require Steps 1–2.
- Step 12 (UI E2E) covers Steps 9–11.

---

### Step 1 — proto: Add SetStrategyLive RPC and live_enabled field to analysis.proto

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/analysis/v1/analysis.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, additive/non-breaking changes; `xstockstrat-analysis` (service owner) — backtest reproducibility, strategy scoring determinism

**Codebase Evidence**:
- Confirmed current `AnalysisService` RPCs via Read of `packages/proto/analysis/v1/analysis.proto` L11–16: `RunBacktest`, `ScoreStrategy`, `ListStrategies`, `GetStrategyReport` — next slot is 5 (used by 047 for `ManageStrategy`), then 6 (`GetStrategy`), 7 (`ListStrategyDefinitions`). Next available RPC slot after 047 adds three is **RPC 8** for `SetStrategyLive`.
- Confirmed `StrategyDefinition` message in 047 Step 1 uses fields 1–7. Field 8 (`bool live_enabled`) is the next available slot — confirmed additive.
- `SetStrategyLiveRequest`/`SetStrategyLiveResponse` are new messages — no collision with existing messages.
- `ManageStrategyResponse` is `StrategyDefinition` itself (per 047 Step 1, `rpc ManageStrategy returns (StrategyDefinition)`), establishing precedent for `SetStrategyLiveResponse { StrategyDefinition definition = 1; }`.
- Confirmed `buf.yaml` and `buf.gen.yaml` at `packages/proto/` — `buf lint` + `buf breaking` enforced in CI.

**Instructions**:

This step modifies `packages/proto/analysis/v1/analysis.proto`. All changes are additive and non-breaking — no existing field, message, or RPC is modified.

1. Add `bool live_enabled = 8;` to the `StrategyDefinition` message (from 047 Step 1). This field is the last in the message after `bool active = 7;`. Example:
   ```protobuf
   message StrategyDefinition {
     // ... fields 1-7 from 047 ...
     bool live_enabled = 8;
   }
   ```

2. Add the `SetStrategyLiveRequest` and `SetStrategyLiveResponse` messages after the last message in the file:
   ```protobuf
   message SetStrategyLiveRequest {
     string strategy_id = 1;
     bool live_enabled = 2;
   }

   message SetStrategyLiveResponse {
     StrategyDefinition definition = 1;
   }
   ```

3. Add the `SetStrategyLive` RPC to `AnalysisService`. After 047 adds RPCs 5–7, the next available slot is 8:
   ```protobuf
   rpc SetStrategyLive(SetStrategyLiveRequest) returns (SetStrategyLiveResponse);
   ```

**Verification**:
```bash
cd /home/user/xstockstrat/packages/proto
buf lint
buf breaking --against ".git#branch=main-dev"
```
Both commands must exit with code 0. `buf breaking` must report no breaking changes (all changes are additive). Baseline is `main-dev` (same as feature 047 Step 1) — the 048 additions are additive relative to both the current production state and 047's pending additions.

---

### Step 2 — proto-gen: Regenerate stubs after analysis.proto changes

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/python/analysis/v1/analysis_pb2.py` — modify (regenerated)
- `packages/proto/gen/python/analysis/v1/analysis_pb2_grpc.py` — modify (regenerated)
- `packages/proto/gen/go/analysis/v1/analysis.pb.go` — modify (regenerated)
- `packages/proto/gen/go/analysis/v1/analysis_grpc.pb.go` — modify (regenerated)
- `packages/proto/gen/ts/analysis/v1/analysis.ts` — modify (regenerated)
- `packages/proto/gen/ts/analysis/v1/analysis_connect.ts` — modify (regenerated)
- `packages/proto/gen/ts/analysis/v1/analysis_pb.ts` — modify (regenerated)

**Reviewers**: Proto Reviewer — field number uniqueness, additive/non-breaking changes; `xstockstrat-analysis` (service owner) — backtest reproducibility, strategy scoring determinism

**Codebase Evidence**:
- `scripts/buf-gen.sh` confirmed at `/home/user/xstockstrat/scripts/buf-gen.sh` — single command for all-language codegen.
- Phase 3 deviation note: if `buf` is unavailable, fall back to `python3 -m grpc_tools.protoc`; prefer `buf-gen.sh`.

**Instructions**:
From the repo root, run:
```bash
./scripts/buf-gen.sh
```
Stage and commit proto source + generated stubs together in one commit.

**Verification**:
```bash
git diff packages/proto/gen/
# Must show changes to analysis stubs (SetStrategyLiveRequest, SetStrategyLiveResponse,
# SetStrategyLive in service stub, live_enabled in StrategyDefinition) and no unrelated changes.
```

---

### Step 3 — migration: Add live_enabled column to analysis.strategies

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/migrations/002_strategy_live_enabled.up.sql` — create
- `services/xstockstrat-analysis/migrations/002_strategy_live_enabled.down.sql` — create

**Reviewers**: DBA — NNN numbering, up+down pair present; `xstockstrat-analysis` (service owner) — backtest reproducibility, strategy scoring determinism

**Codebase Evidence**:
- Confirmed via `ls services/xstockstrat-analysis/migrations/` → **no migrations directory exists** in the current codebase. Feature 047 creates this directory with `001_strategies.up.sql`. This feature creates `002_` — sequential, no gap, no conflict.
- `scripts/db-migrate.sh` L146: `migrate_service "xstockstrat-analysis" "analysis"` — already wired; no change to the migrator script needed.
- Per product spec §Database Changes: `ALTER TABLE analysis.strategies ADD COLUMN IF NOT EXISTS live_enabled BOOLEAN NOT NULL DEFAULT FALSE;` — `IF NOT EXISTS` guard makes the migration safe to re-run; `DEFAULT FALSE` means all existing strategies are opt-in (disabled by default), satisfying FR-5.
- DBA review required per approval-flow.md (additive column on a table owned by the analysis service owner).

**Instructions**:

Create `services/xstockstrat-analysis/migrations/002_strategy_live_enabled.up.sql`:
```sql
ALTER TABLE analysis.strategies ADD COLUMN IF NOT EXISTS live_enabled BOOLEAN NOT NULL DEFAULT FALSE;
```

Create `services/xstockstrat-analysis/migrations/002_strategy_live_enabled.down.sql`:
```sql
ALTER TABLE analysis.strategies DROP COLUMN IF EXISTS live_enabled;
```

**Verification**:
```bash
# After running db-migrate.sh (or docker compose up db-migrator):
psql "$DATABASE_URL" -c "\d analysis.strategies"
# Output must include: live_enabled | boolean | not null | false
```

---

### Step 4 — service: Add SetStrategyLive RPC to AnalysisServicer

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/repositories/strategies.py` — modify (add `set_live_enabled`)
- `services/xstockstrat-analysis/app/main.py` — modify (add `NOTIFY_ENDPOINT` + `notify_channel`)

**Reviewers**: `xstockstrat-analysis` (service owner) — backtest reproducibility, strategy scoring determinism, no look-ahead bias, per-strategy live state correctness

**Codebase Evidence** (re-spec 2026-06-05 — aligned with 047's *delivered* code):
- Confirmed via Read of `services/xstockstrat-analysis/app/handlers/servicer.py`: 047 delivered `AnalysisServicer.__init__(self, config_watcher, marketdata_channel, indicators_channel, ingest_channel, ledger_channel, db_pool=None, identity_channel=None)` — both `db_pool` **and** `identity_channel` are present (047 Steps 4 & 6). This step adds `notify_channel=None` as a further keyword param (after `identity_channel=None`).
- 047 stores the strategy store as `self._strategies_repo` (a `StrategiesRepository`), **not** a bare `self._db`. SetStrategyLive must go through the repository — add a `set_live_enabled(strategy_id, live_enabled)` method to `app/repositories/strategies.py` and call it (consistent with the repo's existing `deactivate`/`update` methods which already `RETURNING *`).
- Confirmed existing `propagation_meta` pattern at `RunBacktest` (`context.invocation_metadata()` filtered for `x-user-id`, `x-access-scope`, `x-trace-id`) — SetStrategyLive follows it.
- Admin gate (per platform header-propagation trust model + product owner guidance): the internal analysis service does a **role check only** on the propagated `x-access-scope` ADMIN bit (`0x04`); it does NOT re-authenticate. Authentication is owned by the entry points (UI BFF via JWT; MCP agent via its SSE auth layer). Abort `PERMISSION_DENIED` if the ADMIN bit is absent.
- `NOTIFY_ENDPOINT` is already in `docker-compose.yml` and both `.do` specs for the analysis block, but **absent** from `app/main.py` — this step adds `NOTIFY_ENDPOINT` + `notify_channel` to main.py.
- `notify_pb2_grpc.NotifyServiceStub` import: `from gen.notify.v1 import notify_pb2, notify_pb2_grpc`.
- Confirmed `grpc.StatusCode.PERMISSION_DENIED` available in Python grpc.

**Instructions**:

1. In `services/xstockstrat-analysis/app/handlers/servicer.py`, add to the imports:
   ```python
   from gen.notify.v1 import notify_pb2, notify_pb2_grpc
   ```

2. Extend `AnalysisServicer.__init__` to accept `notify_channel=None` (after the existing `identity_channel=None`), and set `self._notify`:
   ```python
   def __init__(
       self,
       config_watcher: ConfigWatcher,
       marketdata_channel,
       indicators_channel,
       ingest_channel,
       ledger_channel,
       db_pool=None,            # 047 Step 4
       identity_channel=None,   # 047 Step 6
       notify_channel=None,     # 048 — new
   ):
       ...
       self._notify = (
           notify_pb2_grpc.NotifyServiceStub(notify_channel) if notify_channel else None
       )
   ```

3. Add a `set_live_enabled` method to `services/xstockstrat-analysis/app/repositories/strategies.py` (mirrors the existing `deactivate` method):
   ```python
   async def set_live_enabled(self, strategy_id: str, live_enabled: bool) -> dict | None:
       row = await self._db.fetchrow(
           """
           UPDATE analysis.strategies
              SET live_enabled = $2, updated_at = NOW()
            WHERE strategy_id = $1
           RETURNING *
           """,
           strategy_id,
           live_enabled,
       )
       return _to_dict(row)
   ```

4. Add the `SetStrategyLive` async method to `AnalysisServicer`. It must:
   - Extract `propagation_meta` (same pattern as `RunBacktest`).
   - Role check: parse `x-access-scope` from the inbound metadata; if the ADMIN bit (`0x04`) is not set, `await context.abort(grpc.StatusCode.PERMISSION_DENIED, "admin scope required")` and return. (Role check only — no identity call.)
   - If `self._strategies_repo` is None, abort `UNAVAILABLE`.
   - `row = await self._strategies_repo.set_live_enabled(request.strategy_id, request.live_enabled)`; if `row is None`, abort `NOT_FOUND`.
   - Build the response via `_row_to_strategy_definition(row)` (047 helper) → `SetStrategyLiveResponse(definition=...)`.
   - Best-effort ledger event `analysis.strategy.live_toggled` (`strategy_id`, `live_enabled`), swallowing exceptions (same pattern as `ScoreStrategy`).

5. In `services/xstockstrat-analysis/app/main.py`:
   - Add `NOTIFY_ENDPOINT = os.environ.get("NOTIFY_ENDPOINT", "xstockstrat-notify:50059")` (after the existing endpoint env vars).
   - Pass `notify_channel=grpc.aio.insecure_channel(NOTIFY_ENDPOINT)` to `AnalysisServicer(...)`.

**Header propagation note**: `SetStrategyLive` makes no outbound user-context gRPC calls (only the repo DB write and a best-effort ledger write via the existing `self._ledger` stub with `propagation_meta`). No new propagation wiring needed.

**Verification**:
```bash
grep -n "SetStrategyLive\|PERMISSION_DENIED" \
  services/xstockstrat-analysis/app/handlers/servicer.py
# Must show: SetStrategyLive method + PERMISSION_DENIED abort.
grep -n "set_live_enabled\|live_enabled" services/xstockstrat-analysis/app/repositories/strategies.py
# Must show the set_live_enabled method updating live_enabled.
grep -n "NOTIFY_ENDPOINT\|notify_channel" services/xstockstrat-analysis/app/main.py
# Must show both lines added.
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
```

---

### Step 5 — service: Add live evaluation loop to xstockstrat-analysis

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/__init__.py` — create (empty)
- `services/xstockstrat-analysis/app/engine/live_loop.py` — create
- `services/xstockstrat-analysis/app/main.py` — modify (start loop alongside gRPC server)

**Reviewers**: `xstockstrat-analysis` (service owner) — backtest reproducibility, strategy scoring determinism, no look-ahead bias, per-strategy live state correctness

**Codebase Evidence** (re-spec 2026-06-05 — aligned with 047's *delivered* code):
- 047 placed the shared evaluator at **`app/services/evaluator.py`** (class `StrategyEvaluator`), NOT `app/engine/evaluator.py`. The `app/engine/` package does **not** exist — **this step creates it** (`app/engine/__init__.py` + `app/engine/live_loop.py`). The live loop imports `from app.services.evaluator import StrategyEvaluator`.
- 047's `AnalysisServicer` does **not** keep a `self._evaluator` instance (it constructs `StrategyEvaluator(self._indicators, propagation_meta)` per backtest call). The loop therefore constructs its own evaluator from the servicer's indicators stub: `StrategyEvaluator(servicer._indicators, ())` (empty propagation_meta — background task, no inbound user context).
- Confirmed `asyncio.Lock` is available in Python standard library — used for single-flight enforcement (FR-8, OQ-5).
- Confirmed `ConfigWatcher.get_int` at `app/config/watcher.py` L67–73 — used to read `analysis.engine.eval_interval_seconds`, `analysis.engine.max_strategies_per_cycle`, `analysis.engine.alert_throttle_seconds` hot-reloadable per cycle.
- `notify_pb2_grpc.NotifyServiceStub.EmitAlert` — pattern confirmed from `app/handlers/servicer.py` (notify import) and agent `client.py` L119–132.
- `marketdata_pb2_grpc.MarketDataServiceStub.GetBars` — pattern confirmed from `servicer.py` L210–217 (`_backtest_symbol`).
- `ingest_pb2_grpc.IngestServiceStub.QuerySignals` — pattern confirmed from `servicer.py` L257–265.
- `google.protobuf.struct_pb2.Struct` import pattern confirmed from `servicer.py` L78.
- FR-4 dedup state: `last_state: dict[tuple[str, str], bool]` — in-memory, reset on restart, per (strategy_id, symbol).
- FR-3 alert shape: `category = "strategy"`, `tags = [f"strategy_id:{strategy_id}"]`, `context` Struct with `strategy_id`, `symbol`, `trigger_type`, `rule_components`, `bar_timestamp`, `conviction`.
- FR-6 safety: the loop must **never** call any trading RPC — this is tested in Step 6.
- FR-8 single-flight: `asyncio.Lock` acquired before each cycle; if lock is already held (previous cycle still running), skip cycle.
- The 047 evaluator lives at `services/xstockstrat-analysis/app/services/evaluator.py` — the live loop imports and calls it directly (same Python process, no gRPC hop, per OQ-1).
- `serve()` in `main.py` (L33–68) uses `asyncio.run(serve())` — the loop is started as `asyncio.get_event_loop().create_task(live_loop.run_forever(...))` before `await grpc_server.wait_for_termination()`, following the same pattern as `ConfigWatcher._watch` (`app/config/watcher.py` L28).

**Instructions**:

1. Create `services/xstockstrat-analysis/app/engine/__init__.py` as an empty file (047 created `app/services/`, not `app/engine/` — this package is new).

2. Create `services/xstockstrat-analysis/app/engine/live_loop.py`. The module must implement:

   ```python
   """
   LiveEvaluationLoop — continuous strategy-to-alert runtime.
   
   Runs as an asyncio background task alongside the gRPC server.
   Evaluates all live-enabled strategies on a configurable cadence.
   Emits alerts via xstockstrat-notify on entry/exit transitions.
   Never places orders (FR-6).
   """
   import asyncio
   import logging
   from google.protobuf.struct_pb2 import Struct
   from google.protobuf.timestamp_pb2 import Timestamp
   # stub imports (gen.analysis.v1, gen.marketdata.v1, gen.ingest.v1, gen.notify.v1, gen.ledger.v1)
   
   log = logging.getLogger(__name__)
   
   _ADMIN_SCOPE_BIT = 0x04  # internal constant — not used by loop (no inbound gRPC context)
   
   
   class LiveEvaluationLoop:
       def __init__(self, config_watcher, db_pool, marketdata_stub, ingest_stub, notify_stub, ledger_stub, evaluator):
           self._cfg = config_watcher
           self._db = db_pool
           self._marketdata = marketdata_stub
           self._ingest = ingest_stub
           self._notify = notify_stub
           self._ledger = ledger_stub
           self._evaluator = evaluator        # 047 shared evaluator instance
           self._last_state: dict[tuple[str, str], bool] = {}  # (strategy_id, symbol) → in_position
           self._last_alert_ts: dict[tuple[str, str], float] = {}  # throttle tracking
           self._lock = asyncio.Lock()
   
       async def run_forever(self):
           """Entry point — runs indefinitely. Call as asyncio.create_task(loop.run_forever())."""
           while True:
               interval = self._cfg.get_int("analysis.engine.eval_interval_seconds", default=60)
               await asyncio.sleep(interval)
               if self._lock.locked():
                   log.info("live_loop: previous cycle still running — skipping")
                   continue
               async with self._lock:
                   try:
                       await self._run_cycle()
                   except Exception as e:
                       log.error("live_loop: cycle error: %s", e)
   
       async def _run_cycle(self):
           # ... fetch live-enabled strategies from analysis.strategies where live_enabled = TRUE
           # ... for each strategy, for each symbol (up to max_strategies_per_cycle pairs):
           #     1. fetch recent bars via GetBars
           #     2. optionally fetch signals via QuerySignals
           #     3. call self._evaluator.evaluate(definition, bars, signals) → (in_position, conviction, components)
           #     4. compare result to self._last_state[(strategy_id, symbol)]
           #     5. if transition: emit alert via _notify.EmitAlert (with throttle check)
           #     6. emit ledger events analysis.strategy.evaluated / analysis.strategy.triggered
           #     7. update self._last_state
           ...
   ```

   Key invariants to enforce in `_run_cycle`:
   - **Single-flight**: already guaranteed by `asyncio.Lock` in `run_forever`.
   - **FR-4 edge-triggered**: only emit alert on a `False → True` (entry) or `True → False` (exit) transition; steady-state unchanged state emits nothing.
   - **FR-8 per-strategy isolation**: wrap each (strategy, symbol) evaluation in `try/except`; log and `continue` on error.
   - **FR-6 safety**: no import of `trading_pb2` or any trading/portfolio stub.
   - **Alert throttle**: before calling `EmitAlert`, check `self._last_alert_ts[(strategy_id, symbol)]` against `time.monotonic()`; skip if `elapsed < alert_throttle_seconds` (from config key `analysis.engine.alert_throttle_seconds`, default 300).
   - **Alert shape** (FR-3): `category="strategy"`, `tags=[f"strategy_id:{strategy_id}"]`, `source_service="xstockstrat-analysis"`, `context` Struct with keys `strategy_id`, `symbol`, `trigger_type` (`"entry"` or `"exit"`), `conviction`, `bar_timestamp`.

3. In `services/xstockstrat-analysis/app/main.py`, after starting the gRPC server and before `await grpc_server.wait_for_termination()`:
   ```python
   from app.engine.live_loop import LiveEvaluationLoop
   from app.services.evaluator import StrategyEvaluator  # 047 shared evaluator

   live_loop = LiveEvaluationLoop(
       config_watcher=cfg_watcher,
       db_pool=db_pool,          # asyncpg pool created by 047's main.py wiring
       marketdata_stub=servicer._marketdata,
       ingest_stub=servicer._ingest,
       notify_stub=servicer._notify,
       ledger_stub=servicer._ledger,
       evaluator=StrategyEvaluator(servicer._indicators, ()),  # 047 evaluator; empty meta (bg task)
   )
   asyncio.get_event_loop().create_task(live_loop.run_forever())
   log.info("live evaluation loop started")
   ```
   Note: the loop only starts if `db_pool` is not None (no DB → nothing to evaluate). Guard accordingly.

**Header propagation note**: The loop runs as an internal asyncio task — there is no inbound gRPC context. All outbound calls (`GetBars`, `QuerySignals`, `EmitAlert`, `AppendEvent`) use an empty metadata list or a platform-internal service identity. This is consistent with the `ConfigWatcher._watch` pattern (no propagation headers — internal service-to-service without a user context). No `x-user-id` propagation is needed for background tasks.

**Verification**:
```bash
grep -rn "run_forever\|LiveEvaluationLoop\|live_loop" \
  services/xstockstrat-analysis/app/main.py \
  services/xstockstrat-analysis/app/engine/live_loop.py
# Must show: LiveEvaluationLoop class, run_forever coroutine, asyncio.create_task call in main.py.
grep -n "trading_pb2\|TradingService\|PlaceOrder\|portfolio_pb2" \
  services/xstockstrat-analysis/app/engine/live_loop.py
# Must return empty — no trading imports allowed (FR-6 safety guard).
```

---

### Step 6 — test: Tests for SetStrategyLive and LiveEvaluationLoop

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify (add SetStrategyLive tests)
- `services/xstockstrat-analysis/tests/test_live_loop.py` — create

**Reviewers**: `xstockstrat-analysis` (service owner) — backtest reproducibility, strategy scoring determinism, no look-ahead bias, per-strategy live state correctness

**Codebase Evidence**:
- Confirmed test file at `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — `make_servicer()` helper at L20–32 creates a fully mocked `AnalysisServicer`; `TestScoreStrategy`, `TestRunBacktest`, `TestListStrategies` follow the same pattern.
- Confirmed `AsyncMock` import at L8 and `MagicMock` at L8 — used for all async stubs.
- Coverage threshold for `xstockstrat-analysis`: 40% (from CLAUDE.md §Language Versions & Tooling and root CI overview).
- New test file `test_live_loop.py` follows the `test_analysis_servicer.py` pattern.

**Instructions**:

1. In `services/xstockstrat-analysis/tests/test_analysis_servicer.py`, add a `TestSetStrategyLive` class. Mock `svc._strategies_repo` (an `AsyncMock`) — 047 stores the repo, not a bare `self._db`:
   ```python
   class TestSetStrategyLive:
       @pytest.mark.asyncio
       async def test_requires_admin_scope(self):
           svc = make_servicer()
           svc._strategies_repo = AsyncMock()
           req = MagicMock(); req.strategy_id = "s1"; req.live_enabled = True
           ctx = MagicMock()
           ctx.invocation_metadata.return_value = [("x-access-scope", "1")]  # READ only, not admin
           ctx.abort = AsyncMock(side_effect=Exception("aborted"))
           with pytest.raises(Exception, match="aborted"):
               await svc.SetStrategyLive(req, ctx)
           ctx.abort.assert_called_once()

       @pytest.mark.asyncio
       async def test_permits_admin_scope(self):
           svc = make_servicer()
           svc._strategies_repo = AsyncMock()
           svc._strategies_repo.set_live_enabled = AsyncMock(return_value={
               "strategy_id": "s1", "display_name": "S1", "active": True,
               "live_enabled": True, "definition_json": {},
           })
           svc._ledger = MagicMock(); svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
           req = MagicMock(); req.strategy_id = "s1"; req.live_enabled = True
           ctx = MagicMock()
           ctx.invocation_metadata.return_value = [("x-access-scope", "7")]  # ADMIN|WRITE|READ
           resp = await svc.SetStrategyLive(req, ctx)
           assert resp.definition.strategy_id == "s1"

       @pytest.mark.asyncio
       async def test_returns_not_found_for_missing_strategy(self):
           svc = make_servicer()
           svc._strategies_repo = AsyncMock()
           svc._strategies_repo.set_live_enabled = AsyncMock(return_value=None)
           req = MagicMock(); req.strategy_id = "missing"; req.live_enabled = True
           ctx = MagicMock()
           ctx.invocation_metadata.return_value = [("x-access-scope", "7")]
           ctx.abort = AsyncMock(side_effect=Exception("aborted"))
           with pytest.raises(Exception, match="aborted"):
               await svc.SetStrategyLive(req, ctx)
   ```

2. Create `services/xstockstrat-analysis/tests/test_live_loop.py` with:
   - `TestLiveEvaluationLoopStateTracking`: verify edge-triggered behavior (entry fires once; no duplicate on steady state; exit fires once).
   - `TestLiveEvaluationLoopSafety`: verify no `trading_pb2` attribute or PlaceOrder call appears anywhere in the loop module.
   - `TestLiveEvaluationLoopThrottle`: verify alert is suppressed when `last_alert_ts` is within `alert_throttle_seconds`.
   - `TestLiveEvaluationLoopIsolation`: verify that an exception in one (strategy, symbol) pair does not prevent evaluation of the next.
   - All tests use `AsyncMock` for stubs and a `MagicMock` config watcher with `get_int` returning defaults.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
# Must pass with 0 errors.
cd services/xstockstrat-analysis && pytest --cov=app --cov-fail-under=40
# Must pass coverage threshold (≥40%).
```

---

### Step 7 — service: Add set_strategy_live MCP tool to xstockstrat-agent

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify (add `set_strategy_live` client function)
- `services/xstockstrat-agent/app/tools.py` — modify (register `set_strategy_live` tool)

**Reviewers**: `xstockstrat-analysis` (service owner) — backtest reproducibility, strategy scoring determinism; Security — admin API key scoping on mutating MCP tools, `x-mcp-secret` propagation

**Codebase Evidence** (re-spec 2026-06-05 — entry-point authorization per product-owner guidance + SSE finding):
- 047 delivered `client.py` with `_metadata()` (x-mcp-secret), `_admin_metadata(api_key)` (adds `authorization: Bearer <key>`), `INDICATORS_ENDPOINT`, and `ANALYSIS_ENDPOINT` (`xstockstrat-analysis:50056`). `set_strategy_live` follows the one-shot-channel pattern of `run_backtest`/`manage_strategy`.
- **Security finding**: the agent's SSE auth (`app/auth.py::validate_api_key`) accepts ANY valid API key — it does **not** check the admin role. So we must NOT blanket-assert `x-access-scope: 7` on all agent calls (that would over-privilege every authenticated caller). Per the product-owner guidance, the agent (entry point) performs the admin **authorization** for this mutating tool; the internal analysis service only **role-checks** the forwarded `x-access-scope` (Step 4).
- `IDENTITY_ENDPOINT` is already in the agent env (used by `app/auth.py`) — add the constant to `client.py` for the admin-role check.
- `identity_pb2.ValidateApiKey` returns `TokenClaims` with a `roles` repeated field (`"admin" in claims.roles`).
- Confirmed `tools.py` tool registration pattern: `@server.tool()` async functions inside `register_tools(server: FastMCP)`; gRPC errors mapped via the `_grpc_error_message` helper added in 047 Step 9.

**Instructions**:

1. In `services/xstockstrat-agent/app/client.py`, add `IDENTITY_ENDPOINT` near the other endpoint constants:
   ```python
   IDENTITY_ENDPOINT = os.environ.get("IDENTITY_ENDPOINT", "xstockstrat-identity:50058")
   ```
   Do **not** change `_metadata()`. Add an admin-role validator (entry-point authorization):
   ```python
   async def validate_admin(api_key: str | None) -> bool:
       """Return True iff the API key is valid AND carries the 'admin' role."""
       if not api_key:
           return False
       from gen.identity.v1 import identity_pb2, identity_pb2_grpc  # noqa: PLC0415
       try:
           async with grpc.aio.insecure_channel(IDENTITY_ENDPOINT) as channel:
               stub = identity_pb2_grpc.IdentityServiceStub(channel)
               claims = await stub.ValidateApiKey(
                   identity_pb2.ValidateApiKeyRequest(api_key=api_key), metadata=_metadata()
               )
               return "admin" in claims.roles
       except Exception:
           return False
   ```

2. Add the `set_strategy_live` client function (forwards admin scope; the tool layer has already authorized):
   ```python
   async def set_strategy_live(
       strategy_id: str, live_enabled: bool, api_key: str | None = None
   ) -> dict[str, Any]:
       """Enable/disable live evaluation via SetStrategyLive RPC (admin-scoped)."""
       from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc  # noqa: PLC0415

       meta = list(_admin_metadata(api_key)) + [("x-access-scope", "7")]
       async with grpc.aio.insecure_channel(ANALYSIS_ENDPOINT) as channel:
           stub = analysis_pb2_grpc.AnalysisServiceStub(channel)
           resp = await stub.SetStrategyLive(
               analysis_pb2.SetStrategyLiveRequest(
                   strategy_id=strategy_id, live_enabled=live_enabled
               ),
               metadata=meta,
           )
       defn = resp.definition
       return {
           "strategy_id": defn.strategy_id,
           "display_name": defn.display_name,
           "live_enabled": defn.live_enabled,
           "active": defn.active,
       }
   ```

3. In `services/xstockstrat-agent/app/tools.py`, add the `set_strategy_live` tool after `run_backtest`. The tool authorizes at the entry, then calls the backend:
   ```python
   @server.tool()
   async def set_strategy_live(
       strategy_id: str,
       live_enabled: bool,
       admin_api_key: str = "",
   ) -> dict:
       """Enable or disable live alert evaluation for a strategy. Admin scope required.
       strategy_id: ID of the strategy to toggle.
       live_enabled: true to enable continuous live evaluation + alerting; false to disable.
       admin_api_key: required; must carry the admin role (validated here at the agent).
       Returns the updated strategy definition with live_enabled reflected."""
       if not await client.validate_admin(admin_api_key):
           raise RuntimeError("admin API key required")
       try:
           return await client.set_strategy_live(
               strategy_id=strategy_id, live_enabled=live_enabled, api_key=admin_api_key
           )
       except grpc.aio.AioRpcError as e:
           raise RuntimeError(_grpc_error_message(e, not_found="strategy not found")) from e
   ```

Note: because `_metadata()` is **not** changed, 047's existing client tests remain valid (no update to `test_metadata_empty_when_no_secret` needed).

**Verification**:
```bash
grep -n "set_strategy_live\|SetStrategyLive" \
  services/xstockstrat-agent/app/client.py \
  services/xstockstrat-agent/app/tools.py
# Must show function in client.py and tool registration in tools.py.
grep -n "x-access-scope\|_metadata" services/xstockstrat-agent/app/client.py | head -10
# Must show: x-access-scope "7" added in _metadata(), set_strategy_live calls _metadata().
```

---

### Step 8 — test: Tests for set_strategy_live MCP tool

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_client.py` — modify (add set_strategy_live client test)
- `services/xstockstrat-agent/tests/test_tools.py` — modify (add set_strategy_live tool test)

**Reviewers**: `xstockstrat-analysis` (service owner) — backtest reproducibility, strategy scoring determinism; Security — admin API key scoping

**Codebase Evidence**:
- Confirmed `tests/test_client.py` and `tests/test_tools.py` exist at `services/xstockstrat-agent/tests/`.
- Confirmed `pytest-asyncio` and `respx` in `dev` dependencies at `pyproject.toml` L17.
- Coverage threshold for `xstockstrat-agent`: 40% (from root CLAUDE.md CI overview).

**Instructions**:

1. In `services/xstockstrat-agent/tests/test_client.py`, add a test for `set_strategy_live` following the `run_backtest` test pattern (mock the gRPC channel, assert the RPC is called with correct arguments and the returned dict contains `strategy_id`, `live_enabled`).

2. In `services/xstockstrat-agent/tests/test_tools.py`, add a test for the `set_strategy_live` tool: mock `client.set_strategy_live` and assert the tool returns the dict unchanged.

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check .
# Must pass with 0 errors.
cd services/xstockstrat-agent && pytest --cov=app --cov-fail-under=40
# Must pass coverage threshold (≥40%).
```

---

### Step 9 — service: Add SetStrategyLive and ListAlerts BFF handlers to traderBff.ts

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/traderBff.ts` — modify

**Reviewers**: `xstockstrat-ui` (service owner) — Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access

**Codebase Evidence**:
- Confirmed `traderBff.ts` structure via Read (L1–148): `createConnectRouter`, `requireSession`, `backendHeaders`, router service registrations for `TradingService`, `PortfolioService`, `MarketDataService`, `NotifyService`, `PREFIX = '/trader/api'`, `handlerMap` pattern.
- `analysisClient` already imported in `connectClients.ts` L34: `export const analysisClient = createClient(AnalysisService, makeTransport(ANALYSIS_ENDPOINT))`.
- `notifyClient` already in `connectClients.ts` L33 and used in `traderBff.ts` for `streamAlerts` (L92–99).
- `AnalysisService` is **not** currently registered in `traderBff.ts` (only in `insightsBff.ts`) — must add a partial registration for `setStrategyLive` and `listStrategyDefinitions`.
- `NotifyService.listAlerts` is **not** currently registered in `traderBff.ts` (only `streamAlerts` is) — must add `listAlerts` handler.
- Admin scope check for `setStrategyLive`: `rolesToAccessScope` maps `admin` role to bit `0x04`. The BFF must check `claims.roles.includes('admin')` before calling `setStrategyLive` — this prevents non-admin UI sessions from calling the toggle even if the JS is tampered with. Pattern for admin check: compare `rolesToAccessScope(claims.roles) & 0x04` — see `auth.ts` L63–71.
- `backendHeaders` at `traderBff.ts` L23–28 produces `x-user-id`, `x-access-scope`, `x-trace-id` headers — all outbound calls to `analysisClient` and `notifyClient` must use `{ headers: backendHeaders(claims, ctx) }`.

**Instructions**:

1. In `services/xstockstrat-ui/src/lib/traderBff.ts`, add to the imports at the top:
   ```typescript
   import { AnalysisService } from '@xstockstrat/proto/analysis/v1/analysis_pb';
   import { analysisClient } from '@/lib/connectClients';
   ```

2. Add `listAlerts` to the existing `router.service(NotifyService, {...})` block (after the existing `streamAlerts` handler):
   ```typescript
   async listAlerts(req, ctx) {
     const claims = await requireSession(ctx);
     return notifyClient.listAlerts(req, { headers: backendHeaders(claims, ctx) });
   },
   ```

3. Add a new `router.service(AnalysisService, {...})` block for the trader BFF (after the existing NotifyService block):
   ```typescript
   router.service(AnalysisService, {
     async listStrategyDefinitions(req, ctx) {
       const claims = await requireSession(ctx);
       return analysisClient.listStrategyDefinitions(req, { headers: backendHeaders(claims, ctx) });
     },
     async setStrategyLive(req, ctx) {
       const claims = await requireSession(ctx);
       // Admin scope gate — enforce before forwarding to gRPC service
       const ADMIN_BIT = 0x04;
       if ((rolesToAccessScope(claims.roles) & ADMIN_BIT) === 0) {
         throw new ConnectError('Admin scope required', Code.PermissionDenied);
       }
       return analysisClient.setStrategyLive(req, { headers: backendHeaders(claims, ctx) });
     },
   });
   ```
   Note: `rolesToAccessScope` is already imported at L8.

**Verification**:
```bash
grep -n "setStrategyLive\|listAlerts\|AnalysisService" \
  services/xstockstrat-ui/src/lib/traderBff.ts
# Must show: AnalysisService import, setStrategyLive handler with admin gate, listAlerts handler.
grep -n "PermissionDenied\|ADMIN_BIT\|rolesToAccessScope" \
  services/xstockstrat-ui/src/lib/traderBff.ts
# Must show admin scope enforcement.
```

---

### Step 10 — service: Create LiveStrategiesPanel component and hooks

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/trader/LiveStrategiesPanel.tsx` — create
- `services/xstockstrat-ui/src/hooks/useLiveStrategies.ts` — create
- `services/xstockstrat-ui/src/lib/browserClients/traderAnalysisClient.ts` — create
- `services/xstockstrat-ui/src/app/trader/page.tsx` — modify (add `<LiveStrategiesPanel />`)

**Reviewers**: `xstockstrat-ui` (service owner) — Trading UI correctness, config mutation safety, Connect-RPC call safety, no secret values rendered in UI

**Codebase Evidence**:
- Confirmed `src/lib/browserClients/` directory with existing clients (`analysisClient.ts` uses `/insights/api` base URL, `notifyClient.ts` uses `/trader/api`). A new `traderAnalysisClient.ts` must use `baseUrl: '/trader/api'` to route through the trader BFF (not the insights BFF).
- Confirmed `src/hooks/useStrategies.ts` exists (uses `analysisClient` from insights BFF). New `useLiveStrategies.ts` uses the trader BFF analysis client.
- `trader/page.tsx` confirmed via Read: uses `AppShell`, `PortfolioPanel`, `OrderForm`, `OrderBook`, `ChartPanel`. New `<LiveStrategiesPanel />` is added below `<ChartPanel />`.
- `Card`, `CardHeader`, `CardTitle`, `CardContent` components confirmed at `src/components/ui/card.tsx`.
- `Badge` component confirmed at `src/components/ui/badge.tsx`.
- `Button` component confirmed at `src/components/ui/button.tsx`.
- `Table` component confirmed at `src/components/ui/table.tsx`.
- Admin toggle visibility: FR-10 requires toggle hidden for non-admin. The panel is a client component — it must receive `isAdmin: boolean` prop derived from the JWT claims. However, JWT claims are only available server-side (the cookie is `httpOnly`). The recommended pattern is to expose an `/api/auth/me` route or include a non-sensitive claim in a readable cookie. Check existing pattern: `src/app/auth/` and `src/context/AccountContext.tsx`. Since there is no existing `isAdmin` client-side signal, the panel should expose a server component wrapper that reads the session and passes `isAdmin` as a prop — OR use a BFF-side check (toggle button calls BFF `setStrategyLive`; the BFF already enforces admin gate returning `PermissionDenied`; the UI can handle the error and hide the toggle after receiving it). For simplicity, show the toggle optimistically for all authenticated users and let the `PermissionDenied` response hide/disable it, OR pass `isAdmin` via a server-rendered page prop. The implementation must document the chosen approach.
- `notifyClient` at `src/lib/browserClients/notifyClient.ts` uses `baseUrl: '/trader/api'` — the `listAlerts` call goes through `traderBff.ts`.

**Instructions**:

1. Create `services/xstockstrat-ui/src/lib/browserClients/traderAnalysisClient.ts`:
   ```typescript
   import { createClient } from '@connectrpc/connect';
   import { createConnectTransport } from '@connectrpc/connect-web';
   import { AnalysisService } from '@xstockstrat/proto/analysis/v1/analysis_pb';
   
   const transport = createConnectTransport({ baseUrl: '/trader/api' });
   export const traderAnalysisClient = createClient(AnalysisService, transport);
   ```

2. Create `services/xstockstrat-ui/src/hooks/useLiveStrategies.ts`:
   ```typescript
   import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
   import { traderAnalysisClient } from '@/lib/browserClients/traderAnalysisClient';
   import { notifyClient } from '@/lib/browserClients/notifyClient';
   
   export function useLiveStrategyDefinitions() {
     return useQuery({
       queryKey: ['trader-strategy-definitions'],
       queryFn: () => traderAnalysisClient.listStrategyDefinitions({ includeInactive: false }),
       refetchInterval: 30_000,
     });
   }
   
   export function useSetStrategyLive() {
     const qc = useQueryClient();
     return useMutation({
       mutationFn: ({ strategyId, liveEnabled }: { strategyId: string; liveEnabled: boolean }) =>
         traderAnalysisClient.setStrategyLive({ strategyId, liveEnabled }),
       onSuccess: () => qc.invalidateQueries({ queryKey: ['trader-strategy-definitions'] }),
     });
   }
   
   export function useStrategyAlerts(strategyId: string) {
     return useQuery({
       queryKey: ['strategy-alerts', strategyId],
       queryFn: async () => {
         const resp = await notifyClient.listAlerts({ categories: ['strategy'], limit: 50 });
         // client-side filter by strategy_id in context
         return resp.alerts.filter(
           (a) => a.context?.fields?.strategy_id?.stringVal === strategyId
         ).slice(0, 10);
       },
       enabled: !!strategyId,
       refetchInterval: 60_000,
     });
   }
   ```

3. Create `services/xstockstrat-ui/src/components/trader/LiveStrategiesPanel.tsx`:
   ```typescript
   'use client';
   import { useState } from 'react';
   import { useLiveStrategyDefinitions, useSetStrategyLive, useStrategyAlerts } from '@/hooks/useLiveStrategies';
   import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
   import { Badge } from '../ui/badge';
   import { Button } from '../ui/button';
   import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
   
   interface LiveStrategiesPanelProps {
     isAdmin: boolean;
   }
   
   export function LiveStrategiesPanel({ isAdmin }: LiveStrategiesPanelProps) {
     const { data, isLoading } = useLiveStrategyDefinitions();
     const [selectedId, setSelectedId] = useState<string | null>(null);
     // ... render strategy table with live_enabled badge, toggle (admin only), and alert feed
   }
   
   function StrategyAlertFeed({ strategyId }: { strategyId: string }) {
     const { data } = useStrategyAlerts(strategyId);
     // ... render alert list with timestamp, symbol, trigger_type (entry/exit), conviction
   }
   ```

4. In `services/xstockstrat-ui/src/app/trader/page.tsx`:
   - `trader/page.tsx` is a Next.js App Router server component by default. It can read the session server-side using the existing `getSession()` utility from `src/lib/auth.ts` (same pattern used by `/api/auth` route handlers).
   - Derive `isAdmin` server-side and pass it as a prop:
     ```typescript
     import { getSession } from '@/lib/auth';
     import { LiveStrategiesPanel } from '@/components/trader/LiveStrategiesPanel';

     // Inside the async server component:
     const session = await getSession();
     const isAdmin = session?.roles?.includes('admin') ?? false;
     // ... render:
     <LiveStrategiesPanel isAdmin={isAdmin} />
     ```
   - This avoids client-side exposure of the admin check and ensures the toggle is never rendered for non-admin sessions, even if the BFF would reject the call anyway.

**Verification**:
```bash
grep -n "LiveStrategiesPanel\|useLiveStrategies\|traderAnalysisClient" \
  services/xstockstrat-ui/src/app/trader/page.tsx \
  services/xstockstrat-ui/src/components/trader/LiveStrategiesPanel.tsx \
  services/xstockstrat-ui/src/hooks/useLiveStrategies.ts \
  services/xstockstrat-ui/src/lib/browserClients/traderAnalysisClient.ts
# Must show all files present with correct imports.
grep -n "isAdmin\|PermissionDenied\|liveEnabled" \
  services/xstockstrat-ui/src/components/trader/LiveStrategiesPanel.tsx
# Must confirm isAdmin prop controls toggle visibility.
```

---

### Step 11 — service: Add AnalysisService and NotifyService mocks for trader segment in mock-backend.ts

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify

**Reviewers**: `xstockstrat-ui` (service owner) — Trading UI correctness, Connect-RPC call safety

**Codebase Evidence**:
- Confirmed `mock-backend.ts` L1–230: trader mock (port 9091) handles `TradingService`, `PortfolioService`, `NotifyService`, `MarketDataService`, `IdentityService`. `AnalysisService` is only in the insights mock (port 9092). New trader-segment BFF routes for `AnalysisService.listStrategyDefinitions`, `AnalysisService.setStrategyLive`, and `NotifyService.listAlerts` require corresponding mock handlers on port 9091.
- Confirmed `AnalysisService` import at `mock-backend.ts` L17 (already imported for port 9092) — no new import needed.
- Confirmed `NotifyService` import at L22 — already imported.
- `listAlerts` handler must return a mock `ListAlertsResponse` with strategy-category alerts so the `useStrategyAlerts` hook can filter them.

**Instructions**:

In `services/xstockstrat-ui/e2e/mock-backend.ts`, inside the `traderHandler` `connectNodeAdapter` (port 9091), add to `router.service(AnalysisService, {...})` (or add a new block if AnalysisService is not yet registered on port 9091):
```typescript
router.service(AnalysisService, {
  async listStrategyDefinitions() {
    return {
      definitions: [
        { strategyId: 'strat-live-001', displayName: 'Live Test Strategy', active: true, liveEnabled: true },
        { strategyId: 'strat-live-002', displayName: 'Inactive Strategy', active: true, liveEnabled: false },
      ],
      totalCount: 2,
    };
  },
  async setStrategyLive(req) {
    return {
      definition: { strategyId: req.strategyId, displayName: 'Live Test Strategy', active: true, liveEnabled: req.liveEnabled },
    };
  },
});
```

Add `listAlerts` to the existing `router.service(NotifyService, {...})` block on port 9091:
```typescript
async listAlerts() {
  return {
    alerts: [
      {
        alertId: 'alert-001',
        severity: 1,
        category: 'strategy',
        title: 'Entry trigger: Live Test Strategy',
        body: 'AAPL entry triggered (conviction 0.82)',
        sourceService: 'xstockstrat-analysis',
        tags: ['strategy_id:strat-live-001'],
        context: { fields: { strategy_id: { stringVal: 'strat-live-001' }, symbol: { stringVal: 'AAPL' }, trigger_type: { stringVal: 'entry' }, conviction: { numberValue: 0.82 } } },
      },
    ],
    nextPageToken: '',
  };
},
```

**Verification**:
```bash
grep -n "listStrategyDefinitions\|setStrategyLive\|listAlerts\|strat-live" \
  services/xstockstrat-ui/e2e/mock-backend.ts
# Must show handlers registered on the trader mock port.
```

---

### Step 12 — test: E2E Playwright tests for Live Strategies panel

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/live-strategies.spec.ts` — create

**Reviewers**: `xstockstrat-ui` (service owner) — Live Strategies panel correctness, admin toggle enforcement, BFF route safety, Playwright E2E coverage

**Codebase Evidence**:
- Confirmed E2E test pattern from `e2e/trader/api-smoke.spec.ts` L1–165: uses `addAuthCookie`, `page.evaluate` for BFF calls, camelCase protobuf-es JSON field names, `TEST_JWT_SECRET = 'test-jwt-secret-for-e2e-tests-min32c'`.
- Confirmed admin role JWT shape: `roles: ['admin']` produces `rolesToAccessScope(['admin']) = 15` (READ|WRITE|ADMIN|TRADING = 1|2|4|8 = 15).
- Confirmed non-admin role: `roles: []` produces scope `0` → ADMIN bit clear → `setStrategyLive` BFF returns 403/PermissionDenied.
- Confirmed mock backend returns `liveEnabled: true` for `strat-live-001` from Step 11.

**Instructions**:

Create `services/xstockstrat-ui/e2e/trader/live-strategies.spec.ts` with the following test cases:

1. **`listStrategyDefinitions BFF returns definitions with liveEnabled`**: call `/trader/api/xstockstrat.analysis.v1.AnalysisService/ListStrategyDefinitions` with auth cookie; assert response has `definitions` array; assert `definitions[0].liveEnabled === true`.

2. **`setStrategyLive BFF succeeds for admin`**: call `/trader/api/xstockstrat.analysis.v1.AnalysisService/SetStrategyLive` with admin JWT (`roles: ['admin']`); assert status 200; assert `definition.liveEnabled` matches the request value.

3. **`setStrategyLive BFF returns PermissionDenied for non-admin`**: call the same route with non-admin JWT (`roles: []`); assert response status is 403 or contains `PermissionDenied`.

4. **`listAlerts BFF returns strategy-category alerts`**: call `/trader/api/xstockstrat.notify.v1.NotifyService/ListAlerts`; assert `alerts[0].category === 'strategy'`; assert `alerts[0].tags` contains `'strategy_id:strat-live-001'`.

Follow the `addAuthCookie` pattern from `api-smoke.spec.ts` — include an `addAdminCookie` helper that sets `roles: ['admin']` in the JWT payload.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
# Must pass with 0 errors.
cd services/xstockstrat-ui && pnpm run test:e2e -- --grep "live-strategies"
# All 4 live-strategies tests must pass.
```

---

### Step 13 — docs: Update CLAUDE.md files for analysis, agent, and UI services

**Status**: `pending`
**Service**: `docs/`
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify
- `services/xstockstrat-agent/CLAUDE.md` — modify (if it exists; **not found** via `find` — create if absent)
- `CLAUDE.md` (root) — modify (update analysis Config Keys table and Ledger Events)

**Reviewers**: none

**Instructions**:

1. In `services/xstockstrat-analysis/CLAUDE.md`:
   - Add to **Config Keys Consumed** table:
     | `analysis.engine.eval_interval_seconds` | int | `60` | Live evaluation polling cadence in seconds |
     | `analysis.engine.max_strategies_per_cycle` | int | `50` | Max (strategy × symbol) pairs per cycle |
     | `analysis.engine.alert_throttle_seconds` | int | `300` | Min seconds between alerts per (strategy, symbol) pair |
   - Add to **Ledger Events Emitted** table:
     | `analysis.strategy.evaluated` | One cycle evaluation complete for a strategy |
     | `analysis.strategy.triggered` | Entry or exit transition detected |
     | `analysis.strategy.live_toggled` | `SetStrategyLive` called |
   - Add to **Environment Variables**: `NOTIFY_ENDPOINT=xstockstrat-notify:50059`
   - Update **Role** section to mention the asyncio live evaluation loop alongside the gRPC server.

2. In root `CLAUDE.md`, no changes are required to the Service Registry or Language Map tables — `xstockstrat-analysis` already appears correctly.

3. If `services/xstockstrat-agent/CLAUDE.md` does not exist (**not found** during `find` search), create it with a minimal stub documenting the new `set_strategy_live` MCP tool.

**Verification**:
```bash
grep -n "eval_interval_seconds\|alert_throttle_seconds\|strategy.evaluated\|strategy.triggered" \
  services/xstockstrat-analysis/CLAUDE.md
# Must show all new config keys and ledger events documented.
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
