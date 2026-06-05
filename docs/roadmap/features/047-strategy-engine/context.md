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
