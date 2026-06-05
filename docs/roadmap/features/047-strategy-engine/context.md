# Context: strategy-engine

**Feature**: `docs/roadmap/features/047-strategy-engine/feature.md`
**Product Spec**: `docs/roadmap/features/047-strategy-engine/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/047-strategy-engine/implementation-spec.md`

---

## Session 2026-06-01 — sdd-story (original)

- Created as `046-mcp-management-tools` from user story:
  "More MCP tools: Register/Manage Source, Register/Manage Strategy, Register/Manage Formula."
- Finding: source + formula management wrap existing RPCs; strategy management had no backing
  store/RPC (analysis kept strategies only in-memory per `RunBacktest`).

## Session 2026-06-01 — sdd-story (revamp)

- User clarification chain established that, today:
  - a "strategy" is effectively just an instance of a backtest (label + `strategy_params`,
    in-memory only);
  - `RunBacktest` is hardwired to SMA crossover — no way to select an indicator, and
    `RunBacktestRequest` has no indicator/formula field (verified `analysis.proto` + `servicer.py`);
  - it cannot compose multiple indicators; the indicators service has built-ins + custom formulas
    but `RunBacktest` never calls `ExecuteFormula`;
  - backtest ≠ alerts — alerts come from signal ingestion threshold / explicit `emit_alert`; there
    is **no live strategy→alert engine**.
- User directive: revamp to a **live "strategy→alert" engine**; a strategy can have multiple
  indicators / custom formulas and run continuously **and** in backtests.
- Decisions (via AskUserQuestion):
  - **Scope:** split. This feature (047) = composable strategy model + persistence + shared
    evaluator + backtest integration + admin MCP management tools. New feature
    `048-live-strategy-alert-engine` = the continuous live→alert runtime, depending on 047.
  - **Name:** renamed `mcp-management-tools` → `strategy-engine` (branch `feature/strategy-engine`).
- Renumbered 046 → **047** because a remote sync introduced `046-align-frontend-e2e-bff-mocks`
  during this session; live engine created as **048**.
- Key design principle carried into the spec: a **single shared evaluator** is the source of truth
  for strategy behavior so backtest (047) and live (048) cannot diverge. Rule representation and
  evaluator placement left as Open Questions for `/sdd-spec`.

## Session 2026-06-04 — sdd-review product-spec

- Product spec approved. Status: `draft` → `spec-ready`.
- All 7 open questions resolved:
  - **Rule representation**: structured JSON condition tree (machine-validatable, UI-renderable). See FR-3.
  - **Evaluator placement**: standalone Python module inside `xstockstrat-analysis`; feature 048 imports it directly.
  - **Backtest reference shape**: both `strategy_id` (resolve from DB) and `inline_definition` (one-off); inline takes precedence. See FR-7.
  - **ListStrategies reconciliation**: add `ListStrategyDefinitions` for stored definitions; existing `ListStrategies` (StrategyScore) unchanged. See FR-9.
  - **Signals as rule term**: deferred to feature 048 or a follow-up. Signals remain a separate weighting layer (FR-4) outside the rule grammar. Evaluator interface must be designed to accommodate a future signal term without breaking change.
  - **ListFormulas RPC**: feature 003 (`formula-management-ui`) delivers it; this feature consumes it. See FR-11.
  - **Agent reviewer-registry gap**: noted; separate docs PR to add `xstockstrat-agent` to `docs/runbooks/reviewer-registry.md`. Not a blocker.
- Advisory warnings (no action required):
  - FR-3 testability depends on resolved rule representation (now resolved).
  - `packages/proto` removed from Affected Services bullet list; moved to a note under the section.
  - AC-5 strengthened to a concrete, observable acceptance criterion.
  - Overlap WARNs: features 003 (xstockstrat-indicators), 007 (xstockstrat-analysis), 008 (xstockstrat-ingest dependency), 009 (xstockstrat-agent), 018 (xstockstrat-agent) — coordinate merge order; no FAIL-level conflicts.

## Session 2026-06-04T00:00:00Z — sdd-spec

- Generated implementation-spec.md with 14 steps. Status → implementation-ready.
- Key codebase findings:
  - `analysis.strategies` is the first migration for xstockstrat-analysis; no migrations directory exists yet. Last migration file confirmed absent via `find services/xstockstrat-analysis -name "*.sql"` → no results. First migration uses `001_` prefix.
  - `AnalysisServicer` at `servicer.py:L32` has no DB pool or identity channel today; both must be added (DB pool wiring follows indicators pattern at `indicators/app/main.py`; `asyncpg>=0.29.0` is already in `pyproject.toml`; `DATABASE_URL` is already in docker-compose via `*db-url` anchor and in app.dev/prod.yaml).
  - `IDENTITY_ENDPOINT` is **absent** from the analysis service docker-compose environment block and from the analysis `envs:` blocks in both app.dev.yaml and app.yaml — must be added in Step 6.
  - `INDICATORS_ENDPOINT` is **absent** from the agent's docker-compose environment block and app.yaml/app.dev.yaml agent envs — must be added in Step 8 for the new `manage_formula` client helper.
  - `RunBacktestRequest` fields 1–5 are in use; new `strategy_id_ref` (field 6) and `inline_definition` (field 7) are additive. Field 1 (`strategy_id`) remains the result label, distinct from the DB lookup key (field 6).
  - `db-migrate.sh` already creates the `analysis` schema (L113) and already runs `migrate_service "xstockstrat-analysis" "analysis"` (L146) — no change needed to the migration script.
  - The `StrategyEvaluator` must reside in `app/services/evaluator.py` (directory does not exist yet) with no backtest-only imports/side-effects — design constraint for feature 048 reuse.
  - Admin gating for `manage_strategy` tool: SSE-layer auth enforces API key for all MCP tool callers; backend `ManageStrategy` RPC adds defense-in-depth. Admin key must be forwarded as gRPC metadata `authorization: Bearer <key>`. New `_admin_metadata(api_key)` helper in client.py combines `x-mcp-secret` + `authorization`.
  - `credentials_ref` must never appear in the return dict of `manage_signal_source` (FR-12); the client helper omits it; the tool docstring documents this.

## Session 2026-06-04T00:01:00Z — sdd-spec (re-run)

- Re-generated implementation-spec.md with 14 steps (same count). Status remains implementation-ready.
- Fresh codebase evidence corrections from this session:
  - `INGEST_ENDPOINT` is defined in `services/xstockstrat-analysis/app/main.py` L29 and passed to `AnalysisServicer` at L44, but is **absent** from the `xstockstrat-analysis` environment block in `docker-compose.yml` (L329–360) and from the analysis envs blocks in both `.do/app.dev.yaml` and `.do/app.yaml`. Step 4 now includes adding this missing env var as a required file change.
  - `IDENTITY_ENDPOINT` absence from analysis docker-compose block and DO app specs re-confirmed fresh (Step 6 unchanged but evidence updated).
  - `INDICATORS_ENDPOINT` absence from agent docker-compose block and DO app specs re-confirmed fresh (Step 8 unchanged but evidence updated).
  - `services/xstockstrat-agent/claude_mcp_config.json` does NOT enumerate tool names — it only contains connection config (mcpServers, endpoints). Step 10 updated: only the module docstring in `tools.py` needs updating, not the JSON config file.
  - `AnalysisServicer.__init__` confirmed at `servicer.py` L33 with 5 parameters; `RunBacktest` at L49; `propagation_meta` at L71-75; `_backtest_symbol` at L188.
  - `formulas_repository.py` methods confirmed: `__init__` L32, `create` L35, `get_by_id` L62, `list` L69, `update` L95, `delete` L118 — reference for `StrategiesRepository` pattern.
  - `make_servicer()` factory at `test_analysis_servicer.py` L20 confirmed — needs update to accept `db_pool` and `identity_channel` for new management RPC tests.

## Session 2026-06-05 — sdd-execute (sequential)

Running `/sdd-execute "strategy-engine > live-strategy-alert-engine" sequential` (047 then 048).
Branch strategy: strict SDD stacked per-step PRs (user-authorized override of harness single-branch
mandate). Re-spec gate for 047: directive `none` — all 14 steps' codebase evidence re-validated
against current `feature/strategy-engine` (= main-dev) and matched; **no re-spec applied**.

Toolchain: `buf` and `protoc` absent on host → installed CI-pinned versions (buf 1.69.0,
protoc-gen-go@v1.36.11, protoc-gen-go-grpc@v1.6.2, protoc-gen-connect-go@v1.19.2,
grpcio-tools==1.80.0 in a venv) per sequential-mode CI-equivalent fallback. `pnpm install
--frozen-lockfile` for TS proto plugins.

### Step 1 — proto: Add strategy messages and RPCs to analysis.proto [done]
- Added `ComponentKind`/`StrategyOperation` enums, `StrategyComponent`/`StrategyDefinition`/
  `ManageStrategyRequest`/`GetStrategyRequest`/`ListStrategyDefinitions{Request,Response}` messages,
  two additive `RunBacktestRequest` fields (`strategy_id_ref`=6, `inline_definition`=7), and three
  additive RPCs (`ManageStrategy`/`GetStrategy`/`ListStrategyDefinitions`).
- Files modified: `packages/proto/analysis/v1/analysis.proto`
- Verification: `buf lint` + `buf breaking --against main-dev` both exit 0 (all additive, no breaking).
- Deviations: none (toolchain install logged in Deviation Log as CI-equivalent fallback).

### Step 2 — proto-gen: Regenerate stubs after analysis.proto changes [done]
- Ran `./scripts/buf-gen.sh` with CI-pinned toolchain. Regenerated Go (analysis.pb.go,
  analysis_grpc.pb.go, analysisv1connect/analysis.connect.go), Python (analysis_pb2.py,
  analysis_pb2_grpc.py), and TS (analysis.ts/_pb.ts/_connect.ts + dist/) stubs.
- Files modified: 12 generated stub files under `packages/proto/gen/{go,python,ts}/analysis/v1/`.
- Verification: `git status packages/proto/gen/` scoped to analysis only; new `StrategyDefinition`/
  `ManageStrategy` symbols present in `analysis_pb2.py`. No lockfile drift.
- Deviations: none beyond the toolchain CI-equivalent fallback already logged.

### Step 3 — migration: Create analysis.strategies table [done]
- Created `services/xstockstrat-analysis/migrations/001_strategies.{up,down}.sql` (first migration for
  this service; `001_` prefix correct). Table: `strategy_id` TEXT PK, `display_name` TEXT NOT NULL,
  `definition_json` JSONB NOT NULL, `active` BOOL DEFAULT TRUE, `created_at`/`updated_at` TIMESTAMPTZ;
  `idx_strategies_active` index. Not a hypertable (FR-1).
- Files created: `migrations/001_strategies.up.sql`, `migrations/001_strategies.down.sql`.
- Verification: Docker daemon unavailable → applied up+down on a local ephemeral postgres 16 cluster
  (initdb as unprivileged user). UP created the exact table+index; DOWN dropped it (`dropped = t`).
- Deviations: DB verified via local ephemeral postgres instead of docker postgres:16 / db-migrate.sh
  (CI-equivalent fallback; logged in Deviation Log).

### Step 4 — service: Wire asyncpg pool and strategy repository into AnalysisServicer [done]
- `main.py`: added `import asyncpg`, `DATABASE_URL` env, optional `asyncpg.create_pool(...)` ("analysis
  DB pool created" log), pass `db_pool=db_pool` to servicer.
- Created `app/repositories/__init__.py` + `app/repositories/strategies.py` (`StrategiesRepository`
  with create/get_by_id/update/deactivate/list; JSONB `definition_json`; mirrors FormulasRepository).
- `servicer.py`: `__init__` now accepts `db_pool=None`, sets `self._strategies_repo =
  StrategiesRepository(db_pool) if db_pool else None`.
- Added missing `INGEST_ENDPOINT` to analysis block in `docker-compose.yml` and the analysis envs in
  `.do/app.dev.yaml` + `.do/app.yaml`.
- Files modified: `app/main.py`, `app/handlers/servicer.py`, `app/repositories/__init__.py`,
  `app/repositories/strategies.py`, `docker-compose.yml`, `.do/app.dev.yaml`, `.do/app.yaml`.
- Verification: `ruff check` + `ruff format --check` clean; env greps present in all 3 files; modules
  parse. `docker compose up` pool-log check via CI-equivalent fallback (no full stack here).
- Deviations: `import asyncpg` placed at top of file (with other third-party imports) rather than
  literally "after L30", matching the indicators reference and satisfying ruff E402. No behavior change.

### Step 5 — service: Implement shared strategy evaluator module [done]
- Created `app/services/__init__.py` + `app/services/evaluator.py` (`StrategyEvaluator` + `BarDecision`
  + module helpers `_validate_definition`/`_validate_rule_refs`/`_eval_condition`/`_resolve_term`).
  No backtest-only imports/side-effects; no look-ahead (bar i uses only series[0..i]); reused as-is by
  feature 048.
- Files created: `app/services/__init__.py`, `app/services/evaluator.py`.
- Verification: `ruff check` + `ruff format --check` clean; imports `StrategyEvaluator`/
  `_validate_definition` OK via the conftest-style `gen` namespace shim.
- Deviations: ruff format wrapped two long `raise ValueError(...)` lines onto their own lines to satisfy
  E501 (line-length 100) — formatting only, no behavior change.

### Step 6 — service: ManageStrategy/GetStrategy/ListStrategyDefinitions + RunBacktest rework [done]
- `servicer.py`: imported identity stubs + json_format + StrategyEvaluator/_validate_definition;
  `__init__` now takes `identity_channel=None` → `self._identity`. Added `_validate_admin_token`
  (ingest pattern, with header propagation on ValidateApiKey), `_validate_definition_proto`,
  `ManageStrategy` (register/update/deactivate, admin-gated), `GetStrategy`, `ListStrategyDefinitions`,
  and `_backtest_symbol_evaluated` (drives entry/exit from StrategyEvaluator decisions). RunBacktest
  resolves inline_definition > strategy_id_ref (NOT_FOUND if missing) and routes to the evaluator path;
  legacy strategy_params SMA path unchanged (FR-8). Module helper `_row_to_strategy_definition`
  round-trips the JSONB definition via google.protobuf.json_format.
- `main.py`: added `IDENTITY_ENDPOINT`, pass `identity_channel`.
- Added `IDENTITY_ENDPOINT` to analysis block in docker-compose + both `.do` specs.
- Files modified: `app/handlers/servicer.py`, `app/main.py`, `docker-compose.yml`, `.do/app.dev.yaml`,
  `.do/app.yaml`.
- Verification: `ruff check`/`format --check` clean; servicer imports + all new methods present;
  `_row_to_strategy_definition` round-trip verified (components/entry_rule preserved); env greps present.
- Deviations: definition persisted as a single JSONB via `json_format.MessageToDict(...,
  preserving_proto_field_name=True)` and rebuilt with `ParseDict` (clean enum/Struct round-trip) — the
  spec left the JSON shape open; this is the chosen encoding.

### Step 7 — test: Tests for analysis service [done]
- Created `tests/test_strategy_evaluator.py` (validate_definition accept/reject cases; _eval_condition
  >/</crosses_above/crosses_below + no-look-ahead at bar 0; async evaluate per-bar decisions + empty).
- Extended `tests/test_analysis_servicer.py` with `TestManageStrategy` (admin gate, register, update,
  deactivate NOT_FOUND), `TestGetStrategy` (NOT_FOUND/success), `TestListStrategyDefinitions`
  (empty-when-no-repo / returns definitions), `TestRunBacktestBackwardCompat` (legacy strategy_params
  → SMA path, FR-8). Injected `AsyncMock` repo/identity directly rather than changing `make_servicer`
  (keeps existing tests green).
- Files modified: `tests/test_strategy_evaluator.py` (new), `tests/test_analysis_servicer.py`.
- Verification: `ruff check`/`format --check` clean; `uv run pytest --cov=app --cov-fail-under=40` →
  83 passed, total coverage 53.69%.
- Deviations: none.

### Step 8 — service: agent client helpers (manage_strategy/formula/signal_source) [done]
- `client.py`: added `INDICATORS_ENDPOINT`, `_admin_metadata(api_key)`, and async helpers
  `manage_strategy`/`get_strategy`/`list_strategy_definitions` (analysis), `manage_formula`/
  `list_formulas` (indicators), `manage_signal_source` (ingest). Admin-scoped calls forward
  `authorization: Bearer <key>` alongside `x-mcp-secret`. `manage_signal_source` never echoes
  `credentials_ref` (FR-12). Operation strings validated; component `kind` builtin/formula → enum.
- Added `INDICATORS_ENDPOINT` to the agent block in docker-compose + both `.do` specs.
- Files modified: `services/xstockstrat-agent/app/client.py`, `docker-compose.yml`, `.do/app.dev.yaml`,
  `.do/app.yaml`.
- Verification: `ruff check app/client.py` + format clean; agent `uv run pytest` → 23 passed; env greps
  present. Whole-service `ruff check .` has pre-existing 009 ruff drift (agent NOT in CI lint matrix) —
  see Deviation Log.
- IMPORTANT for Steps 9 & 11: agent service has pre-existing ruff-0.15.8 drift (UP045/I001/E501/F841) in
  tools.py and the test files. Since those steps modify those files, scope ruff verification to the
  changed files (or fix the touched lines); do not rewrite unrelated 009 code. Agent is not CI-linted.

### Step 9 — service: agent MCP management tools [done]
- `tools.py`: added `import grpc` + `_grpc_error_message` helper, and three `@server.tool()` functions
  inside `register_tools` after `run_backtest`: `manage_strategy`, `manage_formula`,
  `manage_signal_source`. Each wraps the Step-8 client helper, forwards `admin_api_key`, and maps gRPC
  errors (NOT_FOUND/UNAUTHENTICATED/PERMISSION_DENIED/INVALID_ARGUMENT) to clear messages.
  `manage_signal_source` docstring documents that `credentials_ref` is never echoed (FR-12). New code
  uses modern `X | None` typing (ruff-clean).
- Files modified: `services/xstockstrat-agent/app/tools.py`.
- Verification: tool-registration check confirms all 9 tools registered incl. the 3 new ones; agent
  `uv run pytest` → 23 passed; my additions ruff-clean. Residual UP045/E501 in tools.py are pre-existing
  009 drift (not my lines; agent not CI-linted). `ruff format` also wrapped 2 pre-existing over-long
  lines (behavior-equivalent).
- Deviations: pre-existing agent ruff drift (see Step 8 Deviation Log); 2 pre-existing lines wrapped by
  ruff format.

### Step 10 — service: Update tool count in tools.py module docstring [done]
- Changed module docstring "Six tools:" → "Nine tools:" and appended the three new tool entries.
  Shortened the manage_formula line to satisfy E501 (≤100) on my own docstring lines.
- Files modified: `services/xstockstrat-agent/app/tools.py` (docstring only).
- Verification: grep shows "Nine tools" + all 3 new tool names; no E501 on the new docstring lines.
- Deviations: none (manage_formula docstring trimmed for line length — my own added line).

### Step 11 — test: agent management tools + client helpers [done]
- `tests/test_tools.py`: `TestManageStrategyTool` (args forwarded; UNAUTHENTICATED gRPC error →
  "admin API key required" via `_rpc_error` AioRpcError helper), `TestManageFormulaTool`
  (register+delete), `TestManageSignalSourceTool` (FR-12: credentials_ref not echoed).
- `tests/test_client.py`: `TestManageStrategyClient` (ANALYSIS_ENDPOINT + x-mcp-secret +
  authorization Bearer; unknown-op ValueError), `TestManageFormulaClient` (INDICATORS_ENDPOINT),
  `TestManageSignalSourceClient` (INGEST_ENDPOINT; credentials_ref omitted).
- Files modified: `tests/test_tools.py`, `tests/test_client.py`.
- Verification: `uv run pytest --cov=app --cov-fail-under=40` → 31 passed, total coverage 57.77%.
  My added test code is ruff-clean (fixed one self-introduced F401). Residual I001/F841 are pre-existing
  009 lines (agent not CI-linted).
- Deviations: pre-existing agent ruff drift (see Step 8 Deviation Log).

### Step 12 — docs: Update mcp-tools.md with new management tools [done]
- `mcp-tools.md`: "six" → "nine"; added `### manage_strategy`, `### manage_formula`,
  `### manage_signal_source` sections (Parameters/Return/Errors), with the credentials_ref-never-echoed
  note (FR-12); added a "Strategy management" usage pattern.
- `docs/runbooks/CLAUDE.md`: "all six agent tools" → "all nine agent tools".
- Files modified: `docs/runbooks/mcp-tools.md`, `docs/runbooks/CLAUDE.md`.
- Verification: greps confirm "nine tools" + the three new sections + usage pattern.
- Deviations: none.

### Step 13 — docs: Update indicator-builder.md with strategy-definition model [done]
- Updated the formula-persistence note (formulas persisted in `indicators.formulas`; reference by
  `formula_id` in a `StrategyDefinition`). Appended "## Using Indicators in a Strategy Definition"
  (builtin vs custom-formula components, condition-tree rules, JSON example, register via
  `manage_strategy`/`ManageStrategy`, evaluator path + 048 reuse).
- Files modified: `docs/runbooks/indicator-builder.md`.
- Verification: greps confirm `StrategyDefinition`, `manage_strategy`, `evaluator`.
- Deviations: none.
