# Implementation Spec: strategy-engine

**Status**: `complete`
**Created**: 2026-06-04
**Feature**: `docs/roadmap/features/047-strategy-engine/feature.md`
**Total Steps**: 14
**Feature Branch**: `feature/strategy-engine`

---

## Execution Summary

The implementation proceeds in four logical phases. First, the proto contract is extended with new strategy messages and RPCs (Steps 1–2). Second, the `analysis.strategies` table is created and the `xstockstrat-analysis` service is wired to a DB pool; the shared strategy evaluator module is authored; and `AnalysisServicer` gains the new strategy management RPCs and a reworked `RunBacktest` that routes through the evaluator (Steps 3–7). Third, the MCP agent (`xstockstrat-agent`) gains three new management tools wrapping `ManageStrategy`, `ManageFormula`, and `ManageSignalSource`, plus the client helper functions they depend on (Steps 8–11). Finally, docs are updated and integration tests verify backward compatibility and end-to-end flows (Steps 12–14).

Steps 1–2 (proto) must complete before Steps 3–11 (service/agent) because all later steps import the generated stubs. Step 3 (migration) can proceed in parallel with Step 1 since it is pure SQL. Steps 8–10 (agent tools) can proceed in parallel with Steps 4–7 (analysis service) once Step 1 is complete, as they share only the generated stubs.

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto): generated stubs must exist before any service imports them.
- Steps 4–7 (analysis service) require Steps 1–2 (proto + gen): import `analysis_pb2` new messages.
- Steps 8–10 (agent client + tools) require Steps 1–2 (proto + gen): import `analysis_pb2` and `indicators_pb2` stubs.
- Step 3 (migration) is independent of proto steps — depends only on `asyncpg` pool wiring in Step 4 at runtime.
- Step 4 (analysis DB wiring) requires Step 3 (migration): migration must exist before the pool is validated in integration.
- Step 7 (analysis test) covers Steps 4–6: run after all analysis service steps complete.
- Step 11 (agent test) covers Steps 8–10: run after all agent steps complete.
- Steps 12–13 (docs) are independent; can be done at any point after Steps 4–6 and 8–10 are understood.
- Step 14 (integration test) requires all service/agent steps and migration steps to be merged.
- Steps 8–11 (agent tools) require feature `009-agent-mcp-server` to be merged into `feature/strategy-engine` first — those steps modify `client.py`, `tools.py`, `test_client.py`, and `test_tools.py`, which are created by that feature.

---

### Step 1 — proto: Add strategy messages and RPCs to analysis.proto

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/analysis/v1/analysis.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, additive/non-breaking changes; `xstockstrat-analysis` (service owner) — backtest reproducibility, strategy scoring determinism

**Codebase Evidence**:
- Confirmed last used field numbers via Read of `packages/proto/analysis/v1/analysis.proto`:
  - `RunBacktestRequest`: fields 1–5 used (`strategy_id`=1, `range`=2, `symbols`=3, `initial_capital`=4, `strategy_params`=5)
  - `AnalysisService` RPCs: `RunBacktest`=1, `ScoreStrategy`=2, `ListStrategies`=3, `GetStrategyReport`=4 — next RPC slot is 5
  - All new messages are additive (new messages + new service RPCs); no existing field is changed or removed
- Confirmed via `packages/proto/buf.yaml` at repo root — `buf lint` and `buf breaking` are enforced in CI
- `ComponentKind` enum required: product spec FR-2 enumerates `BUILTIN_INDICATOR`, `CUSTOM_FORMULA`; root CLAUDE.md proto governance requires `_UNSPECIFIED = 0` sentinel

**Instructions**:

Add the following to `packages/proto/analysis/v1/analysis.proto`, after the existing `GetStrategyReportRequest` message (before the closing of the file):

1. Add the `ComponentKind` enum:
   ```protobuf
   enum ComponentKind {
     COMPONENT_KIND_UNSPECIFIED = 0;
     COMPONENT_KIND_BUILTIN_INDICATOR = 1;
     COMPONENT_KIND_CUSTOM_FORMULA = 2;
   }
   ```

2. Add the `StrategyComponent` message:
   ```protobuf
   message StrategyComponent {
     string ref_name = 1;
     ComponentKind kind = 2;
     string indicator = 3;      // used when kind == COMPONENT_KIND_BUILTIN_INDICATOR
     string formula_id = 4;     // used when kind == COMPONENT_KIND_CUSTOM_FORMULA
     map<string, double> params = 5;
   }
   ```

3. Add the `StrategyDefinition` message. `entry_rule` and `exit_rule` are JSON-encoded condition trees (FR-3). `signal_params` carries the signal-weighting fields from FR-4 (`signal_sources`, `signal_weight`, `technical_weight`, `min_conviction`) as a Struct to match the existing `strategy_params` Struct pattern in `RunBacktestRequest`:
   ```protobuf
   message StrategyDefinition {
     string strategy_id = 1;
     string display_name = 2;
     repeated StrategyComponent components = 3;
     string entry_rule = 4;   // JSON-encoded condition tree
     string exit_rule = 5;    // JSON-encoded condition tree
     google.protobuf.Struct signal_params = 6;
     bool active = 7;
   }
   ```

4. Add the `StrategyOperation` enum and `ManageStrategy` request/response messages. Per root CLAUDE.md proto governance, operation verbs for a closed set must be an enum with `_UNSPECIFIED = 0`:
   ```protobuf
   enum StrategyOperation {
     STRATEGY_OPERATION_UNSPECIFIED = 0;
     STRATEGY_OPERATION_REGISTER = 1;
     STRATEGY_OPERATION_UPDATE = 2;
     STRATEGY_OPERATION_DEACTIVATE = 3;
   }

   message ManageStrategyRequest {
     StrategyOperation operation = 1;
     StrategyDefinition definition = 2;
   }

   message GetStrategyRequest {
     string strategy_id = 1;
   }

   message ListStrategyDefinitionsRequest {
     bool include_inactive = 1;
     int32 page_size = 2;
     int32 page_offset = 3;
   }

   message ListStrategyDefinitionsResponse {
     repeated StrategyDefinition definitions = 1;
     int32 total_count = 2;
   }
   ```

5. Add two additive fields to `RunBacktestRequest` (after field 5, which is `strategy_params`):
   ```protobuf
   // field 6 — resolve definition from DB; legacy strategy_params (field 5) remains supported
   string strategy_id_ref = 6;
   // field 7 — inline definition; takes precedence over strategy_id_ref if both supplied
   StrategyDefinition inline_definition = 7;
   ```
   Note: the existing field 1 (`strategy_id`) serves as the result label; `strategy_id_ref` (field 6) is the DB lookup key. This distinction is necessary because `strategy_id` (field 1) is already used for result labeling and cannot be repurposed for DB lookup without semantic confusion.

6. Add three new RPCs to `AnalysisService` (additive, non-breaking):
   ```protobuf
   rpc ManageStrategy(ManageStrategyRequest) returns (StrategyDefinition);
   rpc GetStrategy(GetStrategyRequest) returns (StrategyDefinition);
   rpc ListStrategyDefinitions(ListStrategyDefinitionsRequest) returns (ListStrategyDefinitionsResponse);
   ```

**Verification**:
```bash
cd /home/user/xstockstrat/packages/proto
buf lint
buf breaking --against ".git#branch=main-dev"
```
Both commands must exit with code 0. Confirm `buf breaking` reports no breaking changes (all changes are additive).

---

### Step 2 — proto-gen: Regenerate stubs after analysis.proto changes

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/python/analysis/v1/analysis_pb2.py` — modify (regenerated)
- `packages/proto/gen/python/analysis/v1/analysis_pb2_grpc.py` — modify (regenerated)
- `packages/proto/gen/go/analysis/v1/analysis.pb.go` — modify (regenerated)
- `packages/proto/gen/go/analysis/v1/analysis_grpc.pb.go` — modify (regenerated)
- `packages/proto/gen/ts/analysis/v1/` — modify (regenerated; exact filenames determined by buf-gen.sh output)

**Reviewers**: Proto Reviewer — field number uniqueness, additive/non-breaking changes; `xstockstrat-analysis` (service owner) — backtest reproducibility, strategy scoring determinism

**Codebase Evidence**:
- `scripts/buf-gen.sh` confirmed at `/home/user/xstockstrat/scripts/buf-gen.sh` — this is the single command to run for codegen
- Phase 3 deviation note: if `buf` is unavailable, fall back to `python3 -m grpc_tools.protoc`; prefer `buf-gen.sh` in this feature

**Instructions**:
From the repo root, run:
```bash
./scripts/buf-gen.sh
```
Confirm the following generated files are updated (timestamps change):
- `packages/proto/gen/python/analysis/v1/analysis_pb2.py`
- `packages/proto/gen/python/analysis/v1/analysis_pb2_grpc.py`
- `packages/proto/gen/go/analysis/v1/analysis.pb.go`
- `packages/proto/gen/go/analysis/v1/analysis_grpc.pb.go`

Stage and commit proto source + generated stubs together in one commit.

**Verification**:
```bash
git diff packages/proto/gen/
# Must show changes to analysis stubs and no unrelated changes.
# If empty, buf-gen.sh did not pick up the proto changes — re-run with --debug.
```

---

### Step 3 — migration: Create analysis.strategies table

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/migrations/001_strategies.up.sql` — create
- `services/xstockstrat-analysis/migrations/001_strategies.down.sql` — create

**Reviewers**: DBA — NNN numbering, up+down pair, index/partition correctness; `xstockstrat-analysis` (service owner) — backtest reproducibility, strategy scoring determinism

**Codebase Evidence**:
- Confirmed via `find /home/user/xstockstrat/services/xstockstrat-analysis -name "*.sql"` → **no results** — no migrations directory exists yet for this service; this is the first migration, so `001_` prefix is correct
- Confirmed via `scripts/db-migrate.sh` — the migrator already covers `xstockstrat-analysis` (pattern established: `migrate_service "xstockstrat-analysis" "analysis"`); `CREATE SCHEMA IF NOT EXISTS analysis;` is also handled by the script; no changes to `db-migrate.sh` needed
- Confirmed `analysis.strategies` is not a hypertable per product spec FR-1: "Not a hypertable (low-cardinality definition store)"
- Pattern confirmed from `services/xstockstrat-ingest/migrations/002_add_signal_sources_registry.up.sql` — uses `TEXT PRIMARY KEY`, `BOOL DEFAULT TRUE`, `TIMESTAMP WITH TIME ZONE`; last ingest migration is `002_add_signal_sources_registry.up.sql`

**Instructions**:

Create `services/xstockstrat-analysis/migrations/` directory and two files:

`001_strategies.up.sql`:
```sql
CREATE TABLE IF NOT EXISTS analysis.strategies (
    strategy_id   TEXT PRIMARY KEY,           -- lowercase/underscore, user-supplied
    display_name  TEXT NOT NULL,
    definition_json JSONB NOT NULL,
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strategies_active ON analysis.strategies (active);
```

`001_strategies.down.sql`:
```sql
DROP TABLE IF EXISTS analysis.strategies;
```

**Verification**:
```bash
./scripts/db-migrate.sh up
# Must complete without error. Then confirm:
psql "$DATABASE_URL" -c "\d analysis.strategies"
# Must show: strategy_id TEXT PK, display_name TEXT, definition_json JSONB, active BOOL, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
psql "$DATABASE_URL" -c "\di analysis.idx_strategies_active"
# Must show index exists
```

---

### Step 4 — service: Wire asyncpg pool and strategy repository into AnalysisServicer

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/main.py` — modify
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/repositories/__init__.py` — create
- `services/xstockstrat-analysis/app/repositories/strategies.py` — create
- `docker-compose.yml` — modify (add missing `INGEST_ENDPOINT` to analysis block)
- `.do/app.dev.yaml` — modify (add missing `INGEST_ENDPOINT` to analysis envs block)
- `.do/app.yaml` — modify (add missing `INGEST_ENDPOINT` to analysis envs block)

**Reviewers**: `xstockstrat-analysis` (service owner) — backtest reproducibility, strategy scoring determinism

**Codebase Evidence**:
- Confirmed `asyncpg>=0.29.0` is already in `services/xstockstrat-analysis/pyproject.toml` L14 — no new dependency needed
- Confirmed `DATABASE_URL` is already in `docker-compose.yml` analysis environment block via `*db-url` anchor (L338: `<<: [*common-env, *db-url]`), and in `app.dev.yaml` L221 and `app.yaml` L221 for analysis service
- Pattern confirmed: `services/xstockstrat-indicators/app/main.py` at L16 imports `asyncpg` and at L48 creates `asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)` and passes `db_pool` to servicer; same pattern applies here
- Pattern confirmed: `services/xstockstrat-indicators/app/services/formulas_repository.py` is the reference for a repository class with `__init__` (L32), `create` (L35), `get_by_id` (L62), `list` (L69), `update` (L95), `delete` (L118) methods
- Confirmed `AnalysisServicer.__init__` at `servicer.py` L33-47 — currently accepts `config_watcher`, `marketdata_channel`, `indicators_channel`, `ingest_channel`, `ledger_channel`; add `db_pool=None` parameter
- Confirmed `INGEST_ENDPOINT` is defined in `services/xstockstrat-analysis/app/main.py` at L29 and passed to `AnalysisServicer` at L44, but is **absent** from the `xstockstrat-analysis` environment block in `docker-compose.yml` (L329–360) and from the `xstockstrat-analysis` envs blocks in `.do/app.dev.yaml` (L203–222) and `.do/app.yaml` (same structure) — confirmed absent: `grep -n "INGEST_ENDPOINT" docker-compose.yml` → L451 (trading) and L488 (agent) only, not analysis

**Instructions**:

1. In `services/xstockstrat-analysis/app/main.py`, add after the existing endpoint env vars (after L30 `LEDGER_ENDPOINT`):
   ```python
   import asyncpg
   DATABASE_URL = os.environ.get("DATABASE_URL", "")
   ```
   In the `serve()` function (L33), before `servicer = AnalysisServicer(...)` (L40), add:
   ```python
   db_pool = None
   if DATABASE_URL:
       db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
       log.info("analysis DB pool created")
   ```
   Pass `db_pool=db_pool` to `AnalysisServicer(...)`.

2. Create `services/xstockstrat-analysis/app/repositories/__init__.py` (empty).

3. Create `services/xstockstrat-analysis/app/repositories/strategies.py` — a `StrategiesRepository` class with the following async methods (follow exact pattern from `services/xstockstrat-indicators/app/services/formulas_repository.py`):
   - `__init__(self, db_pool)`: store pool
   - `async create(self, strategy_id, display_name, definition_json: dict) -> dict`: INSERT into `analysis.strategies`, return row
   - `async get_by_id(self, strategy_id: str) -> dict | None`: SELECT by `strategy_id`
   - `async update(self, strategy_id: str, display_name: str, definition_json: dict) -> dict`: UPDATE `display_name`, `definition_json`, `updated_at = NOW()`, return updated row
   - `async deactivate(self, strategy_id: str) -> dict | None`: UPDATE `active = FALSE`, return row or None if not found
   - `async list(self, include_inactive: bool = False, page_size: int = 0, page_offset: int = 0) -> tuple[list[dict], int]`: SELECT with optional `active = TRUE` filter, pagination; return (rows, total_count)

4. In `services/xstockstrat-analysis/app/handlers/servicer.py`, update `AnalysisServicer.__init__` (L33) to accept `db_pool=None` and instantiate `StrategiesRepository(db_pool)` if pool is provided (store as `self._strategies_repo`). Import `StrategiesRepository` from `app.repositories.strategies`.

5. Add missing deployment wiring for `INGEST_ENDPOINT` (confirmed absent — see Codebase Evidence):
   - In `docker-compose.yml`, add `INGEST_ENDPOINT: xstockstrat-ingest:50055` to the `xstockstrat-analysis` environment block (after `LEDGER_ENDPOINT: xstockstrat-ledger:50057` at L344)
   - In `.do/app.dev.yaml`, add `- key: INGEST_ENDPOINT` / `value: ${xstockstrat-ingest.PRIVATE_DOMAIN}:50055` to the `xstockstrat-analysis` envs block (after the `INDICATORS_ENDPOINT` entry at L214)
   - In `.do/app.yaml`, same addition (same location in the analysis envs block)

**Verification**:
```bash
cd /home/user/xstockstrat/services/xstockstrat-analysis
ruff check . && ruff format --check .
grep -n "INGEST_ENDPOINT" /home/user/xstockstrat/docker-compose.yml
# Must now show an entry in the xstockstrat-analysis block (L329-360 range)
```
Service starts without error when `DATABASE_URL` is set: `docker compose up xstockstrat-analysis` — confirm log line "analysis DB pool created".

---

### Step 5 — service: Implement shared strategy evaluator module

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/services/__init__.py` — create
- `services/xstockstrat-analysis/app/services/evaluator.py` — create

**Reviewers**: `xstockstrat-analysis` (service owner) — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Confirmed via `find /home/user/xstockstrat/services/xstockstrat-analysis -type f` → **not found**: `app/services/` directory does not exist; must be created from scratch
- Confirmed `indicators_engine.INDICATOR_REGISTRY` keys at `services/xstockstrat-indicators/app/services/indicators_engine.py` L136-144: `SMA`, `EMA`, `RSI`, `MACD`, `BB`, `ATR`, `VWAP`, `STOCH` — the supported built-in set for FR-5 validation
- Confirmed `indicators_pb2_grpc.IndicatorsServiceStub` is already imported in `servicer.py` L21 — the evaluator will call `ComputeIndicator` and `ExecuteFormula` via the stub passed to it
- Evaluator placement confirmed: product spec AC-5 and Open Questions resolution — "standalone Python module inside `xstockstrat-analysis`; feature 048 imports it directly with no signature changes"
- Header propagation pattern confirmed: Python services extract `propagation_meta` from `context.invocation_metadata()` and pass as `metadata=propagation_meta` to all stub calls — the evaluator's `__init__` accepts a `propagation_meta` parameter, matching the pattern established at `servicer.py` L71-75

**Instructions**:

1. Create `services/xstockstrat-analysis/app/services/__init__.py` (empty).

2. Create `services/xstockstrat-analysis/app/services/evaluator.py` with a `StrategyEvaluator` class:

```python
"""
Shared strategy evaluator for xstockstrat-analysis.
Reused by RunBacktest (feature 047) and the live runtime (feature 048).

Entry point:
    evaluator = StrategyEvaluator(indicators_stub, propagation_meta=())
    decisions = await evaluator.evaluate(definition, bars, signals_map)
    # returns list[BarDecision] — one per bar

BarDecision has fields: bar_index (int), entry (bool), exit (bool), conviction (float).
"""
import json
import logging
from dataclasses import dataclass
from typing import Any

from gen.analysis.v1 import analysis_pb2
from gen.indicators.v1 import indicators_pb2
from google.protobuf.struct_pb2 import Struct

log = logging.getLogger(__name__)

_SUPPORTED_INDICATORS = {"SMA", "EMA", "RSI", "MACD", "BB", "ATR", "VWAP", "STOCH"}

# Supported condition functions in leaf nodes (FR-3)
_SUPPORTED_FNS = {"crosses_above", "crosses_below", ">", "<", ">=", "<="}


@dataclass
class BarDecision:
    bar_index: int
    entry: bool
    exit: bool
    conviction: float  # 0.0–1.0 combined conviction


class StrategyEvaluator:
    """
    Evaluates a StrategyDefinition against a window of OHLCV bars.

    Design constraints (AC-5, feature 048 reuse):
    - No backtest-only imports, parameters, or side effects in this class.
    - Accepts StrategyDefinition proto message, a list of OHLCV bar dicts, and an
      active signals_map (dict[source, list[signal]]) matching the RunBacktest convention.
    - Returns per-bar BarDecision list; no look-ahead (bar i only uses data from bars 0..i).
    - feature 048 calls evaluate() directly with no signature changes.
    """

    def __init__(self, indicators_stub, propagation_meta=()):
        """
        indicators_stub: IndicatorsServiceStub — used to compute built-in indicators
                         and execute custom formulas bar by bar.
        propagation_meta: list of (key, value) tuples propagated from inbound request.
        """
        self._indicators = indicators_stub
        self._meta = propagation_meta

    async def evaluate(
        self,
        definition,  # analysis_pb2.StrategyDefinition
        bars: list,  # list of OHLCV bar proto messages with .close, .timestamp
        signals_map: dict[str, list] | None = None,
    ) -> list[BarDecision]:
        """
        Compute per-bar entry/exit decisions for the given strategy definition.

        Steps:
        1. Validate definition (FR-5): check components, entry_rule, exit_rule.
        2. Compute component series for all bars (no look-ahead).
        3. Evaluate entry_rule and exit_rule condition trees bar by bar.
        4. Return one BarDecision per bar.
        """
        if not bars:
            return []

        # Step 1: validate definition
        _validate_definition(definition)

        closes = [b.close for b in bars]

        # Step 2: compute component series
        component_series = {}
        for comp in definition.components:
            series = await self._compute_component(comp, closes)
            component_series[comp.ref_name] = series  # list[float | None], len == len(bars)

        # Step 3: parse rules
        entry_rule = json.loads(definition.entry_rule) if definition.entry_rule else None
        exit_rule = json.loads(definition.exit_rule) if definition.exit_rule else None

        # Step 4: evaluate bar by bar
        decisions = []
        for i in range(len(bars)):
            entry = _eval_condition(entry_rule, component_series, i) if entry_rule else False
            exit_ = _eval_condition(exit_rule, component_series, i) if exit_rule else False
            conviction = 1.0 if entry else 0.0
            decisions.append(BarDecision(bar_index=i, entry=entry, exit=exit_, conviction=conviction))
        return decisions

    async def _compute_component(self, comp, closes: list[float]) -> list[float | None]:
        """Compute a single component's series over all bars."""
        if comp.kind == analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR:
            resp = await self._indicators.ComputeIndicator(
                indicators_pb2.ComputeIndicatorRequest(
                    indicator=comp.indicator,
                    values=closes,
                    params=dict(comp.params),
                ),
                metadata=self._meta,
            )
            # Build aligned list — None for warm-up bars where result is absent
            result_map = {i: p.value for i, p in enumerate(resp.result)}
            return [result_map.get(i) for i in range(len(closes))]
        elif comp.kind == analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA:
            input_struct = Struct()
            input_struct.update({"close": closes})
            resp = await self._indicators.ExecuteFormula(
                indicators_pb2.ExecuteFormulaRequest(
                    formula_id=comp.formula_id,
                    input_data=input_struct,
                ),
                metadata=self._meta,
            )
            if not resp.success:
                log.warning("formula %s execution failed: %s", comp.formula_id, resp.error)
                return [None] * len(closes)
            # Formula output must contain a "value" key with a list
            output = dict(resp.output)
            raw = output.get("value", [])
            return [float(v) if v is not None else None for v in raw]
        return [None] * len(closes)
```

Add module-level helper functions (outside the class):

```python
def _validate_definition(definition) -> None:
    """FR-5: Validate at write time. Raises ValueError on invalid definition."""
    ref_names = set()
    for comp in definition.components:
        if not comp.ref_name:
            raise ValueError("Each component must have a non-empty ref_name")
        if comp.ref_name in ref_names:
            raise ValueError(f"Duplicate ref_name: {comp.ref_name}")
        ref_names.add(comp.ref_name)
        if comp.kind == analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR:
            if comp.indicator.upper() not in _SUPPORTED_INDICATORS:
                raise ValueError(
                    f"Unknown built-in indicator '{comp.indicator}'. "
                    f"Supported: {sorted(_SUPPORTED_INDICATORS)}"
                )
        elif comp.kind == analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA:
            if not comp.formula_id:
                raise ValueError("COMPONENT_KIND_CUSTOM_FORMULA component must have formula_id set")
        else:
            raise ValueError(f"Unknown ComponentKind: {comp.kind}")

    # Validate rule JSON parsability and ref_name references
    for rule_name, rule_json in [("entry_rule", definition.entry_rule), ("exit_rule", definition.exit_rule)]:
        if not rule_json:
            continue
        try:
            rule = json.loads(rule_json)
        except json.JSONDecodeError as e:
            raise ValueError(f"{rule_name} is not valid JSON: {e}") from e
        _validate_rule_refs(rule, ref_names, rule_name)


def _validate_rule_refs(node: Any, ref_names: set[str], rule_name: str) -> None:
    """Recursively validate that all lhs ref_names in leaf nodes exist as components."""
    if "op" in node and node["op"] in ("AND", "OR"):
        for child in node.get("conditions", []):
            _validate_rule_refs(child, ref_names, rule_name)
    elif "fn" in node:
        lhs = node.get("lhs", "")
        if isinstance(lhs, str) and lhs not in ref_names:
            raise ValueError(
                f"{rule_name}: leaf node lhs='{lhs}' is not defined as a component ref_name"
            )
        fn = node.get("fn", "")
        if fn not in _SUPPORTED_FNS:
            raise ValueError(f"{rule_name}: unsupported function '{fn}'. Supported: {sorted(_SUPPORTED_FNS)}")
    else:
        raise ValueError(f"{rule_name}: unrecognized condition node structure: {node}")


def _eval_condition(node: Any, series: dict[str, list], i: int) -> bool:
    """
    Evaluate a condition tree at bar index i. No look-ahead: only series[*][0..i] are visible.
    Returns True if the condition is satisfied at bar i.
    """
    if "op" in node and node["op"] == "AND":
        return all(_eval_condition(c, series, i) for c in node.get("conditions", []))
    if "op" in node and node["op"] == "OR":
        return any(_eval_condition(c, series, i) for c in node.get("conditions", []))

    # Leaf node
    lhs_ref = node.get("lhs")
    rhs = node.get("rhs")
    fn = node.get("fn", "")

    lhs_val = _resolve_term(lhs_ref, series, i)
    rhs_val = _resolve_term(rhs, series, i) if isinstance(rhs, str) else float(rhs)

    if lhs_val is None or rhs_val is None:
        return False  # warm-up period — no signal

    if fn == ">":
        return lhs_val > rhs_val
    if fn == "<":
        return lhs_val < rhs_val
    if fn == ">=":
        return lhs_val >= rhs_val
    if fn == "<=":
        return lhs_val <= rhs_val
    if fn == "crosses_above":
        if i == 0:
            return False
        prev_lhs = _resolve_term(lhs_ref, series, i - 1)
        prev_rhs = _resolve_term(rhs, series, i - 1) if isinstance(rhs, str) else rhs_val
        if prev_lhs is None or prev_rhs is None:
            return False
        return prev_lhs <= prev_rhs and lhs_val > rhs_val
    if fn == "crosses_below":
        if i == 0:
            return False
        prev_lhs = _resolve_term(lhs_ref, series, i - 1)
        prev_rhs = _resolve_term(rhs, series, i - 1) if isinstance(rhs, str) else rhs_val
        if prev_lhs is None or prev_rhs is None:
            return False
        return prev_lhs >= prev_rhs and lhs_val < rhs_val
    return False


def _resolve_term(term: Any, series: dict[str, list], i: int) -> float | None:
    """Resolve a term to a float: look up ref_name in series, or pass through numeric."""
    if isinstance(term, str):
        s = series.get(term, [])
        return s[i] if i < len(s) else None
    return float(term) if term is not None else None
```

**Verification**:
```bash
cd /home/user/xstockstrat/services/xstockstrat-analysis
ruff check . && ruff format --check .
# Also verify module imports correctly:
python3 -c "from app.services.evaluator import StrategyEvaluator, _validate_definition; print('ok')"
```

---

### Step 6 — service: Add ManageStrategy/GetStrategy/ListStrategyDefinitions RPCs and rework RunBacktest

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/main.py` — modify (add `IDENTITY_ENDPOINT`)
- `docker-compose.yml` — modify (add `IDENTITY_ENDPOINT` to analysis block)
- `.do/app.dev.yaml` — modify (add `IDENTITY_ENDPOINT` to analysis envs block)
- `.do/app.yaml` — modify (add `IDENTITY_ENDPOINT` to analysis envs block)

**Reviewers**: `xstockstrat-analysis` (service owner) — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Confirmed existing `AnalysisServicer` class at `servicer.py` L32 — five methods: `RunBacktest` (L49), `_backtest_symbol` (L188), `ScoreStrategy` (L396), `ListStrategies` (L471), `GetStrategyReport` (L475)
- `RunBacktest` extracts `fast_period`/`slow_period` from `request.strategy_params` at L98-103 — this code must be preserved for backward compatibility (FR-8)
- `propagation_meta` is extracted at `RunBacktest` L71-75 and passed to all downstream stub calls — new methods must follow the same pattern
- `_validate_admin_token` pattern confirmed at `services/xstockstrat-ingest/app/handlers/servicer.py` L47-62 — uses `identity_channel`; the analysis servicer currently has no `identity_channel`; must be added
- `IDENTITY_ENDPOINT` is **absent** from the `xstockstrat-analysis` environment block in `docker-compose.yml` (L329–360) — confirmed: `grep -n "IDENTITY_ENDPOINT" docker-compose.yml` shows L307 (ingest), L446 (trading), L491 (agent) — not analysis
- `IDENTITY_ENDPOINT` is **absent** from the analysis envs block in `.do/app.dev.yaml` (L203–222) and `.do/app.yaml` (same structure) — confirmed by reviewing analysis service block which only contains: `GRPC_PORT`, `CONFIG_ENDPOINT`, `LEDGER_ENDPOINT`, `NOTIFY_ENDPOINT`, `MARKETDATA_ENDPOINT`, `INDICATORS_ENDPOINT`, `WAIT_FOR`, `DATABASE_URL`, `SERVICE_NAME`, `MCP_AGENT_SECRET`
- Header propagation: Python pattern confirmed — extract `propagation_meta` at top of each RPC handler, pass as `metadata=propagation_meta` to all stub calls (pattern at `servicer.py` L71-75); all new outbound gRPC calls in this step must include `metadata=propagation_meta` — new calls reuse the existing `self._identity` stub via the same propagation mechanism

**Instructions**:

1. In `services/xstockstrat-analysis/app/main.py`, add after `LEDGER_ENDPOINT` (L30):
   ```python
   IDENTITY_ENDPOINT = os.environ.get("IDENTITY_ENDPOINT", "xstockstrat-identity:50058")
   ```
   Pass `identity_channel=grpc.aio.insecure_channel(IDENTITY_ENDPOINT)` to `AnalysisServicer(...)`.

2. Update `AnalysisServicer.__init__` (L33) to accept `identity_channel=None` (alongside `db_pool=None` from Step 4) and add:
   - Import `identity_pb2_grpc` from `gen.identity.v1`
   - `self._identity = identity_pb2_grpc.IdentityServiceStub(identity_channel) if identity_channel else None`

3. Add `_validate_admin_token` method (exact pattern from `ingest/servicer.py` L47-62, adapted to use `self._identity`):
   - Reads `authorization` metadata, strips `Bearer ` prefix, calls `self._identity.ValidateApiKey`, checks `"admin" in claims.roles`
   - Returns `False` if no identity stub or auth header is absent/invalid
   - Outbound `ValidateApiKey` call must pass `metadata=propagation_meta` (header propagation)

4. Add `ManageStrategy` RPC method:
   - Extract `propagation_meta` from `context.invocation_metadata()` (same pattern as `RunBacktest` L71-75)
   - Validate admin token via `_validate_admin_token(context)`; if not admin, `await context.abort(grpc.StatusCode.UNAUTHENTICATED, "admin API key required")`
   - If `self._strategies_repo` is None, abort with `UNAVAILABLE`
   - `request.operation == analysis_pb2.STRATEGY_OPERATION_REGISTER`: call `_validate_definition_proto(request.definition)`, then `self._strategies_repo.create(...)`. Return `StrategyDefinition` proto built from the DB row via `_row_to_strategy_definition(row)`.
   - `request.operation == analysis_pb2.STRATEGY_OPERATION_UPDATE`: validate definition, call `self._strategies_repo.update(...)`
   - `request.operation == analysis_pb2.STRATEGY_OPERATION_DEACTIVATE`: call `self._strategies_repo.deactivate(request.definition.strategy_id)`
   - Helper `_validate_definition_proto(definition)` wraps `_validate_definition(definition)` from `app.services.evaluator` — catches `ValueError` → `abort(INVALID_ARGUMENT, str(e))`

5. Add `GetStrategy` RPC method:
   - Extract `propagation_meta`
   - If no repo: abort `UNAVAILABLE`
   - Call `self._strategies_repo.get_by_id(request.strategy_id)`
   - If None: abort `NOT_FOUND`
   - Return `StrategyDefinition` proto from row via `_row_to_strategy_definition(row)`

6. Add `ListStrategyDefinitions` RPC method:
   - If no repo: return empty `ListStrategyDefinitionsResponse`
   - Call `self._strategies_repo.list(include_inactive=request.include_inactive, page_size=request.page_size, page_offset=request.page_offset)`
   - Return `ListStrategyDefinitionsResponse(definitions=[...], total_count=total)`

7. Rework `RunBacktest` to support stored and inline strategies (FR-7, FR-8):
   - After extracting `propagation_meta` and the existing `strategy_params` fast/slow periods (L92–109), add:
     ```python
     # Resolve strategy definition: inline takes precedence over strategy_id_ref (FR-7)
     active_definition = None
     if request.HasField("inline_definition"):
         active_definition = request.inline_definition
     elif request.strategy_id_ref:
         if self._strategies_repo:
             row = await self._strategies_repo.get_by_id(request.strategy_id_ref)
             if row:
                 active_definition = _row_to_strategy_definition(row)
             else:
                 await context.abort(grpc.StatusCode.NOT_FOUND,
                     f"strategy '{request.strategy_id_ref}' not found")
                 return
     ```
   - If `active_definition` is not None, pass it to a new evaluator-based `_backtest_symbol_evaluated` method. If `active_definition` is None (legacy call: only `strategy_params`), fall through to the existing `_backtest_symbol` SMA-crossover path unchanged (FR-8 backward compatibility).
   - The evaluator-based path: instantiate `StrategyEvaluator(self._indicators, propagation_meta)`, call `decisions = await evaluator.evaluate(definition, bars, signals_map)`, then simulate trades using `decisions[i].entry` / `decisions[i].exit` instead of the manual SMA crossover logic. The evaluator call propagates headers via `propagation_meta` passed to its constructor.

8. Add helper `_row_to_strategy_definition(row: dict) -> analysis_pb2.StrategyDefinition` — converts the `definition_json` JSONB column back to a `StrategyDefinition` proto message. Pattern: mirrors `_row_to_formula` at `services/xstockstrat-indicators/app/handlers/servicer.py` L246-268.

**Verification**:
```bash
cd /home/user/xstockstrat/services/xstockstrat-analysis
ruff check . && ruff format --check .
grep -n "IDENTITY_ENDPOINT" /home/user/xstockstrat/docker-compose.yml
# Must now show IDENTITY_ENDPOINT in the xstockstrat-analysis block (lines ~329-360)
grep -n "IDENTITY_ENDPOINT" /home/user/xstockstrat/.do/app.dev.yaml /home/user/xstockstrat/.do/app.yaml
# Must show entries in xstockstrat-analysis sections (before the xstockstrat-agent section)
```

---

### Step 7 — test: Tests for analysis service (strategy management + evaluator + RunBacktest rework)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_strategy_evaluator.py` — create
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify (add new test classes)

**Reviewers**: `xstockstrat-analysis` (service owner) — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Confirmed test structure at `tests/test_analysis_servicer.py` L1-335 — uses `make_servicer()` factory (L20-32) with `MagicMock` dependencies; `AsyncMock` for stub calls; `pytest.mark.asyncio`
- `make_servicer()` at L20 takes no extra args; will need updating to pass `db_pool=MagicMock()` and `identity_channel=MagicMock()` for management RPC tests
- Coverage threshold: 40% confirmed in `services/xstockstrat-analysis/CLAUDE.md` ("uv run pytest --cov=app --cov-fail-under=40")
- Confirmed `asyncio_mode = "auto"` in `pyproject.toml` L31 — `@pytest.mark.asyncio` not required for async tests

**Instructions**:

1. Create `services/xstockstrat-analysis/tests/test_strategy_evaluator.py` with tests for:
   - `_validate_definition`: accepts valid definitions with `COMPONENT_KIND_BUILTIN_INDICATOR` and `COMPONENT_KIND_CUSTOM_FORMULA` components; rejects unknown indicator names; rejects missing `formula_id` on `CUSTOM_FORMULA`; rejects undefined `ref_name` in rules; rejects invalid JSON in `entry_rule`/`exit_rule`
   - `_eval_condition`: verifies `crosses_above`, `crosses_below`, `>`, `<` with synthetic series; verifies no look-ahead (bar 0 always returns False for crossover functions)
   - `StrategyEvaluator.evaluate` (async): mock `indicators_stub.ComputeIndicator` returning a synthetic series; confirm `BarDecision` list has `len == len(bars)` and `entry` is True at the expected bar

2. In `services/xstockstrat-analysis/tests/test_analysis_servicer.py`, add:
   - `TestManageStrategy`: test register (valid definition → row returned), test deactivate (NOT_FOUND when repo returns None), test update, test admin gate (abort UNAUTHENTICATED when identity returns non-admin)
   - `TestGetStrategy`: test NOT_FOUND, test success
   - `TestListStrategyDefinitions`: test empty when no repo, test returns definitions
   - `TestRunBacktestBackwardCompat`: verify a call with only `strategy_params` (no `strategy_id_ref`, no `inline_definition`) produces a valid result using the existing SMA-crossover path (mock unchanged; verifies FR-8)

**Verification**:
```bash
cd /home/user/xstockstrat/services/xstockstrat-analysis
ruff check . && ruff format --check .
uv run pytest --cov=app --cov-fail-under=40
# Must pass with ≥40% coverage
```

---

### Step 8 — service: Add manage_strategy, manage_formula, manage_signal_source client helpers to agent

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify
- `docker-compose.yml` — modify (add `INDICATORS_ENDPOINT` to agent block)
- `.do/app.dev.yaml` — modify (add `INDICATORS_ENDPOINT` to agent envs block)
- `.do/app.yaml` — modify (add `INDICATORS_ENDPOINT` to agent envs block)

**Reviewers**: `xstockstrat-agent` (service owner) — MCP management-tool correctness, admin-scope enforcement, `x-mcp-secret` propagation

**Codebase Evidence**:
- Confirmed `app/client.py` defines: `INGEST_ENDPOINT` (L14), `NOTIFY_ENDPOINT` (L15), `ANALYSIS_ENDPOINT` (L16), `MCP_AGENT_SECRET` (L17), `CONFIG_ENDPOINT` (L18) — **no `INDICATORS_ENDPOINT`** — confirmed absent
- `_metadata()` at `client.py` L21-24 returns `[("x-mcp-secret", MCP_AGENT_SECRET)]` when set — all new client functions must call `_metadata()` for their gRPC calls (FR-13)
- Existing `run_backtest` at `client.py` L135-161 is the reference pattern: opens a channel per call (`async with grpc.aio.insecure_channel(...) as channel`), creates a stub, calls the RPC with `metadata=_metadata()`, returns a dict
- `IDENTITY_ENDPOINT` is already in the agent's docker-compose block (L491) and app.dev.yaml agent block — the agent uses it for SSE auth validation in `app/auth.py` L16; management tools do not call identity directly
- `INDICATORS_ENDPOINT` is **absent** from agent's docker-compose environment block (L486-499) — confirmed: agent block has INGEST, NOTIFY, ANALYSIS, IDENTITY, CONFIG but NOT INDICATORS
- `INDICATORS_ENDPOINT` is **absent** from agent envs in `.do/app.dev.yaml` agent block (L236-258) and `.do/app.yaml` (same) — confirmed by reviewing agent envs which list: `INGEST_ENDPOINT`, `NOTIFY_ENDPOINT`, `ANALYSIS_ENDPOINT`, `IDENTITY_ENDPOINT`, `CONFIG_ENDPOINT`, `WAIT_FOR`, `MCP_TRANSPORT`, `MCP_SSE_PORT`, `MCP_AGENT_SECRET`, `UI_BASE_URL`
- Admin gating: the SSE auth header is a session-level check only; backend `ManageStrategy` (analysis) and `ManageSignalSource` (ingest) validate their own admin token from `authorization` metadata — the agent must pass the user's API key as `authorization: Bearer <key>` in gRPC metadata alongside `x-mcp-secret`
- `MessageToDict` is already imported at `client.py` L11 (`from google.protobuf.json_format import MessageToDict`)
- `ManageSignalSource` call: `ingest_pb2.ManageSignalSourceRequest(operation=..., source=..., credentials_ref=...)` — confirmed at `ingest/servicer.py` L427 for field structure
- Header propagation: the agent uses `_metadata()` for all outbound gRPC calls (confirmed pattern at `client.py` L50, L100, L129, L148); `_admin_metadata()` extends this with `authorization: Bearer <key>` for admin-scoped calls

**Instructions**:

1. Add to `app/client.py` after `CONFIG_ENDPOINT` (L18):
   ```python
   INDICATORS_ENDPOINT = os.environ.get("INDICATORS_ENDPOINT", "xstockstrat-indicators:50054")
   ```

2. Add helper `_admin_metadata(api_key: str | None = None) -> list[tuple[str, str]]`:
   ```python
   def _admin_metadata(api_key: str | None = None) -> list[tuple[str, str]]:
       meta = list(_metadata())
       if api_key:
           meta.append(("authorization", f"Bearer {api_key}"))
       return meta
   ```

3. Add `async def manage_strategy(operation: str, definition: dict, api_key: str | None = None) -> dict`:
   - `operation`: `"register"` | `"update"` | `"deactivate"` — map to enum: `"register"` → `analysis_pb2.STRATEGY_OPERATION_REGISTER`, `"update"` → `analysis_pb2.STRATEGY_OPERATION_UPDATE`, `"deactivate"` → `analysis_pb2.STRATEGY_OPERATION_DEACTIVATE`; raise `ValueError` for unknown values
   - `definition`: dict with keys `strategy_id`, `display_name`, `components` (list of dicts), `entry_rule` (str), `exit_rule` (str), `signal_params` (dict, optional), `active` (bool, optional)
   - Each `components[i]["kind"]` string must be mapped: `"builtin"` → `analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR`, `"formula"` → `analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA`; raise `ValueError` for unknown values
   - Build `analysis_pb2.ManageStrategyRequest(operation=<mapped_op>, definition=StrategyDefinition(...))`, call `AnalysisServiceStub.ManageStrategy`
   - Return `MessageToDict(resp)`
   - Use `_admin_metadata(api_key)` as metadata

4. Add `async def get_strategy(strategy_id: str) -> dict`:
   - Call `AnalysisServiceStub.GetStrategy(analysis_pb2.GetStrategyRequest(strategy_id=strategy_id))`
   - Return `MessageToDict(resp)`

5. Add `async def list_strategy_definitions(include_inactive: bool = False) -> list[dict]`:
   - Call `AnalysisServiceStub.ListStrategyDefinitions`
   - Return list of dicts from `resp.definitions`

6. Add `async def manage_formula(operation: str, formula: dict, api_key: str | None = None) -> dict`:
   - `operation`: `"register"` | `"update"` | `"delete"`; raise `ValueError` for unknown values
   - Open channel to `INDICATORS_ENDPOINT`; use `_admin_metadata(api_key)` as metadata
   - `"register"` → `IndicatorsServiceStub.RegisterFormula(RegisterFormulaRequest(name=formula["name"], description=formula.get("description", ""), source=formula["source"], is_public=formula.get("is_public", False), author=formula.get("author", "")))` — return `{"formula_id": resp.formula_id}`
   - `"update"` → `IndicatorsServiceStub.UpdateFormula(UpdateFormulaRequest(formula_id=formula["formula_id"], user_id=formula["user_id"], name=formula.get("name", ""), description=formula.get("description", ""), source=formula.get("source", ""), is_public=formula.get("is_public", False)))` — return `MessageToDict(resp.formula)`. Note: `user_id` must match `formula.author` (returns `PERMISSION_DENIED` otherwise); the tool layer must expose a `formula_author_user_id` parameter and pass it here
   - `"delete"` → `IndicatorsServiceStub.DeleteFormula(DeleteFormulaRequest(formula_id=formula["formula_id"], user_id=formula["user_id"]))` — return `{"success": resp.success}`. Same `user_id` constraint applies

7. Add `async def list_formulas(author_filter: str = "", include_public: bool = True) -> list[dict]`:
   - Wraps `IndicatorsServiceStub.ListFormulas`
   - Return list of dicts from `resp.formulas`

8. Add `async def manage_signal_source(operation: str, source: dict, credentials_ref: str | None = None, api_key: str | None = None) -> dict`:
   - Wraps `IngestServiceStub.ManageSignalSource`
   - `source`: dict matching `SignalSource` fields (slug, display_name, source_type, etc.)
   - `credentials_ref`: optional, forwarded to ingest backend but **never echoed back in response** (FR-12)
   - Never include `credentials_ref` in the return dict
   - Use `_admin_metadata(api_key)`

9. Add missing deployment wiring for `INDICATORS_ENDPOINT` (confirmed absent — see Codebase Evidence):
   - In `docker-compose.yml`, add `INDICATORS_ENDPOINT: xstockstrat-indicators:50054` to the `xstockstrat-agent` environment block (after `IDENTITY_ENDPOINT: xstockstrat-identity:50058`)
   - In `.do/app.dev.yaml`, add `- key: INDICATORS_ENDPOINT` / `value: ${xstockstrat-indicators.PRIVATE_DOMAIN}:50054` to the `xstockstrat-agent` envs block
   - In `.do/app.yaml`, same addition

**Verification**:
```bash
grep -n "INDICATORS_ENDPOINT" /home/user/xstockstrat/docker-compose.yml
# Must now show entry in xstockstrat-agent block
cd /home/user/xstockstrat/services/xstockstrat-agent
ruff check . && ruff format --check .
```

---

### Step 9 — service: Add manage_strategy, manage_formula, manage_signal_source MCP tools to agent

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: `xstockstrat-agent` (service owner) — MCP management-tool correctness, admin-scope enforcement, `x-mcp-secret` propagation

**Codebase Evidence**:
- Confirmed `register_tools(server: FastMCP)` at `tools.py` L37 — all tools are defined as nested `@server.tool()` async functions inside this function; the three new tools follow the same registration pattern
- Confirmed existing tools use `await client.<function>(...)` pattern — new tools call the new client helpers added in Step 8
- `ingest_signal` at `tools.py` L127-179 shows the full pattern for a tool with validation, error handling, and a multi-step operation
- `run_backtest` at `tools.py` L203-217 is the simplest reference: a single `await client.run_backtest(...)` call
- Module docstring at `tools.py` L1-11 says "Six tools:" — must be updated to "Nine tools:" in Step 10
- FR-12: `manage_signal_source` must never echo `credentials_ref` or secret values — the client helper (Step 8) already omits it from the return dict; the tool docstring must also document this
- FR-13: admin-scoped tools; the API key must be passed as a tool parameter (`admin_api_key`) so the tool can forward it to the backend RPCs via `_admin_metadata`

**Instructions**:

Add three new `@server.tool()` functions inside `register_tools()`, after the existing `run_backtest` tool (after L217):

1. `manage_strategy(operation, strategy_id, display_name, components, entry_rule, exit_rule, signal_params, admin_api_key)`:
   - `operation`: `"register"` | `"update"` | `"deactivate"`
   - `strategy_id`: str — lowercase/underscore
   - `display_name`: str
   - `components`: list of dicts (`{"ref_name": str, "kind": "builtin"|"formula", "indicator": str, "formula_id": str, "params": dict}`)
   - `entry_rule`: str — JSON condition tree
   - `exit_rule`: str — JSON condition tree
   - `signal_params`: optional dict
   - `admin_api_key`: str — required; validated by the analysis service backend
   - Calls `await client.manage_strategy(operation=operation, definition={...}, api_key=admin_api_key)`
   - On gRPC error, raises with a clear message (`NOT_FOUND` → `"strategy not found"`, `INVALID_ARGUMENT` → propagate message, `UNAUTHENTICATED` → `"admin API key required"`)
   - Returns result dict

2. `manage_formula(operation, name, description, source, is_public, formula_id, author, formula_author_user_id, admin_api_key)`:
   - `operation`: `"register"` | `"update"` | `"delete"`
   - `name`, `description`, `source`, `is_public` — for register/update
   - `formula_id` — required for update/delete
   - `author` — for register (stored immutably)
   - `formula_author_user_id` — required for update/delete; must match the formula's original `author` field (enforced by `xstockstrat-indicators`; returns `PERMISSION_DENIED` otherwise)
   - `admin_api_key`: str
   - Calls `client.manage_formula(operation=operation, formula={"formula_id": formula_id, "user_id": formula_author_user_id, "name": name, ...}, api_key=admin_api_key)`
   - Returns result dict

3. `manage_signal_source(operation, slug, display_name, source_type, config_json, extractor_module, credentials_ref, admin_api_key)`:
   - `operation`: `"register"` | `"update"` | `"deactivate"`
   - Parameters map to `SignalSource` fields
   - `credentials_ref`: str | None — forwarded to the ingest backend but **never echoed back in the response** (FR-12); docstring must document this explicitly
   - `admin_api_key`: str
   - Calls `await client.manage_signal_source(operation=operation, source={...}, credentials_ref=credentials_ref, api_key=admin_api_key)`
   - Returns result dict (no `credentials_ref` field per FR-12)

**Verification**:
```bash
cd /home/user/xstockstrat/services/xstockstrat-agent
ruff check . && ruff format --check .
# Confirm tools are registered:
python3 -c "
from app.tools import register_tools
from mcp.server import FastMCP
s = FastMCP('test')
register_tools(s)
tool_names = list(s._tool_manager._tools.keys())
assert 'manage_strategy' in tool_names
assert 'manage_formula' in tool_names
assert 'manage_signal_source' in tool_names
print('tools registered:', tool_names)
"
```

---

### Step 10 — service: Update tool count in tools.py module docstring

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify (docstring only)

**Reviewers**: `xstockstrat-agent` (service owner) — MCP management-tool correctness, admin-scope enforcement, `x-mcp-secret` propagation

**Codebase Evidence**:
- Confirmed `services/xstockstrat-agent/app/tools.py` L1-11 module docstring says `"Six tools:"` with a list of 6 tool names — must update to `"Nine tools:"` after adding 3 new tools
- Confirmed `services/xstockstrat-agent/claude_mcp_config.json` does **not** enumerate tool names — it only contains connection configuration (`mcpServers` with endpoints and transport mode); no tool names to update in that file

**Instructions**:

1. Update the module docstring in `services/xstockstrat-agent/app/tools.py` at L3-11: change `Six tools:` to `Nine tools:` and append the three new tool entries:
   ```
   manage_strategy     — registers/updates/deactivates stored strategies in analysis (admin-scoped)
   manage_formula      — registers/updates/deletes custom formula definitions in indicators (admin-scoped)
   manage_signal_source — registers/updates/deactivates signal sources in ingest (admin-scoped)
   ```

**Verification**:
```bash
grep -n "Nine tools\|manage_strategy\|manage_formula\|manage_signal_source" \
  /home/user/xstockstrat/services/xstockstrat-agent/app/tools.py | head -10
# Must show "Nine tools" and all three new tool names in the docstring
```

---

### Step 11 — test: Tests for agent management tools and client helpers

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tools.py` — modify (add new test classes)
- `services/xstockstrat-agent/tests/test_client.py` — modify (add new client helper tests)

**Reviewers**: `xstockstrat-agent` (service owner) — MCP management-tool correctness, admin-scope enforcement, `x-mcp-secret` propagation

**Codebase Evidence**:
- Confirmed test pattern at `tests/test_tools.py` L14-22: `_make_server()` + `_tool_fn()` helpers; patch `client.<fn>` via `AsyncMock`; tests are `async def` with `asyncio_mode = "auto"` (confirmed in `pyproject.toml`)
- Confirmed coverage threshold: 40% (Python — xstockstrat-agent)
- `test_client.py` L38-63 uses `patch("app.client.grpc")` + stub patching — same pattern for new client helpers

**Instructions**:

In `tests/test_tools.py`, add:
- `TestManageStrategyTool`: test `manage_strategy` calls `client.manage_strategy` with correct args including `api_key`; test UNAUTHENTICATED gRPC error is re-raised as a clear message; test result dict is returned correctly
- `TestManageFormulaTool`: test register and delete paths call correct client functions
- `TestManageSignalSourceTool`: test register path; confirm `credentials_ref` is NOT in the returned dict (FR-12)

In `tests/test_client.py`, add:
- `TestManageStrategyClient`: test `manage_strategy` creates channel to `ANALYSIS_ENDPOINT`, includes `x-mcp-secret` in metadata, includes `authorization: Bearer <key>` when `api_key` is provided
- `TestManageFormulaClient`: test `manage_formula` uses `INDICATORS_ENDPOINT`
- `TestManageSignalSourceClient`: test `manage_signal_source` uses `INGEST_ENDPOINT`, returns dict without `credentials_ref`

**Verification**:
```bash
cd /home/user/xstockstrat/services/xstockstrat-agent
ruff check . && ruff format --check .
uv run pytest --cov=app --cov-fail-under=40
# Must pass with ≥40% coverage
```

---

### Step 12 — docs: Update mcp-tools.md with new management tools

**Status**: `done`
**Service**: `docs/runbooks/`
**Files**:
- `docs/runbooks/mcp-tools.md` — modify
- `docs/runbooks/CLAUDE.md` — modify (update tool count from "six" to "nine")

**Reviewers**: none

**Codebase Evidence**:
- `mcp-tools.md` CLAUDE.md entry in `docs/runbooks/CLAUDE.md`: "MCP tool reference — all six agent tools with parameter tables, return shapes, error cases, transport modes, and x-mcp-secret enforcement" — must update "six" to "nine"
- FR-14 requires: document new tools (params/return/errors) and update the agent's advertised tool count

**Instructions**:

1. Update `docs/runbooks/mcp-tools.md`:
   - Update header/overview line count from "Six tools" to "Nine tools"
   - Add three new tool sections after `### run_backtest` (before `## Usage Patterns`): `### manage_strategy`, `### manage_formula`, `### manage_signal_source`
   - Each section must include: Parameters table, Return example (JSON), Errors table
   - `manage_signal_source` Errors table must include: "credentials_ref is intentionally omitted from return — never exposed to Claude" note
   - Update `## Usage Patterns` to add a "Strategy management" example showing: `manage_strategy(operation="register", ...)` → `manage_formula(...)` → `run_backtest(strategy_id=...)`

2. Update `docs/runbooks/CLAUDE.md` entry for `mcp-tools.md` to say "nine agent tools" instead of "six".

**Verification**:
```bash
grep -n "tools\|manage_strategy\|manage_formula\|manage_signal_source" \
  /home/user/xstockstrat/docs/runbooks/mcp-tools.md | head -10
# Must show "Nine tools" (or "nine") and at least one match per new tool name
```

---

### Step 13 — docs: Update indicator-builder.md with strategy-definition model

**Status**: `done`
**Service**: `docs/runbooks/`
**Files**:
- `docs/runbooks/indicator-builder.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- FR-14 requires: document the strategy-definition model in `indicator-builder.md`
- `indicator-builder.md` contains a note about formula persistence (confirmed via product spec reference and FR-11) — must be updated to reference the new `analysis.strategies` table and `manage_strategy` tool
- The runbook covers built-in indicators and custom formulas; adding a "Using indicators in a strategy" section bridges the gap to the new composable strategy model

**Instructions**:

Append a new section "## Using Indicators in a Strategy Definition" to `docs/runbooks/indicator-builder.md`:
- Explain `StrategyComponent` with `kind: COMPONENT_KIND_BUILTIN_INDICATOR` (using indicator name from built-in registry: `SMA`, `EMA`, `RSI`, `MACD`, `BB`, `ATR`, `VWAP`, `STOCH`) vs `kind: COMPONENT_KIND_CUSTOM_FORMULA` (using `formula_id` from `RegisterFormula`)
- Show a `StrategyDefinition` JSON example with two components and a condition tree (`entry_rule`)
- Show how to register via `manage_strategy` MCP tool or `ManageStrategy` gRPC RPC
- Note that the evaluator is `services/xstockstrat-analysis/app/services/evaluator.py` and feature 048 reuses it

Update the existing note about formula persistence: replace any text about "For persistence across restarts, store formula source in your strategy definition" with "For persistence across restarts, register the formula via `RegisterFormula` and reference it by `formula_id` in a `StrategyDefinition` stored in `xstockstrat-analysis` (see `manage_strategy` MCP tool)."

**Verification**:
```bash
grep -n "StrategyDefinition\|manage_strategy\|evaluator" \
  /home/user/xstockstrat/docs/runbooks/indicator-builder.md
# Must show at least one match per term
```

---

### Step 14 — test: Integration test for backward compatibility and end-to-end strategy flow

**Status**: `done`
**Service**: `xstockstrat-analysis` (integration)
**Files**:
- `scripts/integration-test.sh` — modify

**Reviewers**: `xstockstrat-analysis` (service owner) — backtest reproducibility, strategy scoring determinism

**Codebase Evidence**:
- `scripts/integration-test.sh` is referenced in product spec AC-6: "Existing read/ingest/backtest tools and integration-test.sh still pass"
- Phase 6 deviations note: "integration test approach (curl over grpcurl)" — confirms the script uses curl, not grpcurl
- AC-3: "A legacy RunBacktest call (only strategy_params, no definition) produces the same result as today" — backward compat must be verified
- AC-1/AC-2: an operator can register a strategy and run a backtest via the stored strategy

**Instructions**:

1. Read `scripts/integration-test.sh` and confirm the existing `run_backtest` test section passes with only `strategy_params` (no `strategy_id_ref`, no `inline_definition`) — this verifies FR-8 backward compat without additional code change if that test path is already exercised.

2. Add a new section to the integration test that:
   a. Registers a strategy via `ManageStrategy` RPC with two components (SMA fast + SMA slow) and a condition tree entry rule (`{"op": "AND", "conditions": [{"lhs": "sma_fast", "fn": "crosses_above", "rhs": "sma_slow"}]}`).
   b. Fetches the strategy back via `GetStrategy` and asserts `strategy_id` matches.
   c. Runs `RunBacktest` referencing the stored strategy by `strategy_id_ref`.
   d. Asserts the response contains `backtest_id` and `total_return` is a float.
   e. Runs the legacy `RunBacktest` (only `strategy_params`, no `strategy_id_ref`) and asserts it still returns a valid `backtest_id` (backward compat check).

**Verification**:
```bash
./scripts/integration-test.sh
# Must exit 0 with all sections passing including the new strategy-engine section
```

---

## Deviation Log

### Deviation: Toolchain — proto codegen tools installed on host (CI-equivalent fallback)
**Spec said**: Steps 1–2 run `buf lint` / `buf breaking` / `./scripts/buf-gen.sh` assuming the proto toolchain is present.
**Actual**: `buf` and `protoc` were absent in the execution environment. Installed CI-pinned versions per the sequential-mode verification fallback: buf 1.69.0, protoc-gen-go@v1.36.11, protoc-gen-go-grpc@v1.6.2, protoc-gen-connect-go@v1.19.2, grpcio-tools==1.80.0 (venv); `pnpm install --frozen-lockfile` for TS plugins. Versions match `.github/workflows/ci.yml` proto-freshness job exactly.
**Reason**: Run codegen/verification with the same tool versions CI uses so generated stubs match.
**Disposition**: CI-equivalent fallback.

### Deviation: Step 8 — pre-existing ruff drift in xstockstrat-agent (UP017 autofix)
**Spec said**: Step 8 verification is `ruff check . && ruff format --check .` (whole agent service).
**Actual**: Under ruff 0.15.8, the pristine `xstockstrat-agent` on main-dev already fails 15 lint findings (UP017/UP045/I001/E501/F841) — pre-existing feature-009 code modernized by a newer ruff. **The CI `python-lint` matrix does not include `xstockstrat-agent`** (only indicators/ingest/analysis), so these are not a CI gate. Verification was scoped to the file this step changed: `ruff check app/client.py` + `ruff format --check app/client.py` (clean). The one autofix that touched pre-existing code — `timezone.utc` → `datetime.UTC` (UP017) in `client.py`'s `_iso_to_timestamp`, plus the resulting `from datetime import UTC` reorder — was applied per explicit user instruction; it is behavior-equivalent. Unrelated 009 files (`main.py`, etc.) were left untouched.
**Reason**: The agent isn't CI-linted; absorbing 009's full lint debt is out of scope. My step's own code is lint-clean.
**Disposition**: CI-equivalent fallback (scoped verification) + user-approved pre-existing autofix.

### Deviation: Steps that require a running multi-service stack — verified via CI-equivalent fallback
**Spec said**: Step 3 verification runs `./scripts/db-migrate.sh up` + `psql`; Step 4 confirms a live `docker compose up xstockstrat-analysis` "analysis DB pool created" log; Step 14 runs `./scripts/integration-test.sh`.
**Actual**: The full multi-service stack (config/identity/etc. dependencies, healthchecks) cannot be brought up in this environment. Migrations are verified up+down against a throwaway `postgres:16` container; service-start and integration-test sections are validated structurally (lint + import + script syntax) and rely on CI for live execution.
**Reason**: No full compose stack available; matches the documented sequential-mode fallbacks.
**Disposition**: CI-equivalent fallback.
