# Context: backtest-debug-info

**Feature**: `docs/roadmap/features/064-backtest-debug-info/feature.md`
**Product Spec**: `docs/roadmap/features/064-backtest-debug-info/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/064-backtest-debug-info/implementation-spec.md`

---

## Session 2026-07-08 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Origin: user posted a screenshot of the strategy backtest run (symbol LLY, 0 trades / 0% return,
  data coverage sufficient) and asked for "more debugging information … a table day by day with
  OHLCV and indicators data."
- User decisions captured up front (AskUserQuestion):
  - **Debug scope**: Full diagnostics (OHLCV + indicators + warm-up markers + per-bar signal scores
    + entry/exit/conviction decision + why-no-trade summary).
  - **Delivery**: Always included in the `RunBacktest` response (no opt-in request flag).
  - **Approach**: Spec-first — write the product spec for review before writing any code.
- Recon notes for the design/spec phase:
  - `RunBacktest` returns `BacktestResult` (`packages/proto/analysis/v1/analysis.proto:54`);
    already carries `trades`, `status`, `coverage_gaps`.
  - Two engine paths in `services/xstockstrat-analysis/app/handlers/servicer.py`:
    `_backtest_symbol` (legacy SMA crossover — computes fast/slow SMA, tech_signal, signal_score,
    combined conviction) and `_backtest_symbol_evaluated` (evaluator path).
  - `app/services/evaluator.py` computes `component_series` (all output series, no look-ahead) but
    `evaluate()` returns only `list[BarDecision]` — component series would need to be exposed for
    diagnostics.
  - Bar fields available: open/high/low/close/volume/vwap/time
    (`packages/proto/marketdata/v1/marketdata.proto:44`).
  - UI target: `services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx` (metrics grid +
    equity curve + existing `INSUFFICIENT_DATA` coverage-gap/backfill card, feature 053).
- Ledger `fails.md` is empty — no prior trap to design around. Chief self-identified risks recorded as
  OQ-1 (no look-ahead / warm-up definition) and OQ-2 (always-included response size).

Next: `/sdd-review backtest-debug-info product-spec`.

## Session 2026-07-08 — spec refinement (open-question resolution)

User answered the four open questions; spec updated in place:

- **OQ-1 (qq-1) — warm-up definition → RESOLVED (Option B, rule-referenced, union of entry+exit
  refs).** Explained the tradeoffs: Option A ("any component unresolved") is cheapest but
  false-flags warm-up when an unused long-lookback component exists — misleading the exact "why 0
  trades" case; Option C ("declared lookback") is elegant for built-ins but doesn't generalize to
  custom formulas. Chose B (reuses the evaluator's `_validate_rule_refs` walk; legacy SMA path is the
  specialization "until both SMAs resolve"). Position-aware refinement deferred. User may still elect
  simpler Option A at /sdd-design. → FR-4.
- **OQ-2 (qq-2/qq-3) — response size → RESOLVED via a global range cap.** User: "Limit all backtests
  to 2 calendar years" and confirmed 2y is acceptable (~504 daily rows/symbol). Added FR-4b + new
  config key `analysis.backtest.max_range_days` (int, default 730), owned by xstockstrat-analysis.
  Behavior = **reject** over-cap requests with `INVALID_ARGUMENT` (not silent clamp), UI constrains
  date pickers. This is a broader contract change affecting ALL RunBacktest callers, not just
  diagnostics.
- **OQ-4 (qq-4) — signals → RESOLVED.** No newsletter signals this version; `signal_score` stays 0 on
  the evaluator path, real only on the legacy signal-weighted path. Field retained + documented. →
  FR-4a.
- **OQ-3 (agent tool)** left open — verify at /sdd-spec that `run_backtest` MCP tool tolerates the
  larger (now 2-year-bounded) response.

Governance delta from this session: feature now adds 1 config key (was "no new config keys"). Reviewer
set unchanged — the `config` category maps to the analysis service owner, already listed.

## Session 2026-07-08 — OQ-1 → Option C + custom-formula warm-up (scope addition)

User: "oq-1. Option C. Include in the scope to make custom formulas to set a warmup period."

- **OQ-1 re-resolved to Option C (declared lookback)**, superseding the prior Option-B choice.
  Warm-up length = max lookback of the *referenced* components; bar `i` warm-up iff `i < length`. →
  FR-4 rewritten.
- **Scope addition (FR-4c): custom formulas can declare a `warmup_period`** — this is the piece that
  makes Option C generalize (its original weakness). Grounded against real contracts:
  - `indicators.proto`: `FormulaDefinition` (field 12), `RegisterFormulaRequest`/`UpdateFormulaRequest`
    gain `warmup_period` (additive).
  - `indicators.formulas` is DB-backed (migrations `001_formulas`, `002_formula_parameters`,
    `003_formula_outputs` add JSONB columns) → new **migration `004_formula_warmup`** (ADD COLUMN
    `warmup_period INT NOT NULL DEFAULT 0`).
  - Formula authoring UI at `services/xstockstrat-ui/src/app/insights/formulas/{new,[id]}/page.tsx`
    gains a Warm-up period input.
  - analysis reads it via `GetFormula` (servicer already fetches formula metadata for validation).
- **New OQ-5**: define the per-built-in-indicator lookback (`_INDICATOR_WARMUP` alongside
  `_INDICATOR_SERIES`): simple indicators → `period`; `MACD` → slow+signal; `STOCH` → k+d.
- **Governance / scope-creep note**: feature grew from 3 areas (proto/analysis/ui) to 5
  (adds `xstockstrat-indicators` service + a DB migration). Reviewers updated in feature.md to add the
  indicators owner and DBA. This is a deliberate, user-requested expansion — flagged here so
  /sdd-design weighs whether to split the formula-warmup piece into its own feature if it complicates
  the review/merge.

## Session 2026-07-08 — sdd-review product-spec

- Product spec approved. Status: `draft` → `spec-ready`.
- `spec-reviewer` verdict: all code-checkable claims verified (service names vs registry; config-key
  format; proto field numbers — `indicators.proto` `warmup_period` 12/9/9 all free, `analysis.proto`
  `diagnostics` = 14 additive; `_UNSPECIFIED=0` sentinels present per C-04; migration `004` correct
  next number per F-01; all file paths resolve). Sole FAIL: criterion 9 (two unchecked open questions).
- **Blocker resolved in-spec** (not deferred): OQ-3 → agent `run_backtest` omits `diagnostics` from
  its projected result (UI-facing only; keeps agent context lean). OQ-5 → FR-4 built-in lookback uses
  a declared `_INDICATOR_WARMUP` table (period-based → period; MACD → slow+signal; STOCH → k+d), exact
  ±1 constants pinned by a unit test at /sdd-spec. All OQs now `[x]`.
- `feature-overlap` verdict: CLEAN — no config-key/proto-field/migration-number collision; no
  merge-order entry needed. Draft neighbors `031-strategy-performance-dashboard`,
  `032-walk-forward-backtesting` share the backtest theme but declare no concrete overlap (note only).
- Warnings: none. Overlap findings: none.

## Session 2026-07-08 — OQ-3 revised + sdd-design

- User revised OQ-3: the agent `run_backtest` tool now **includes** the `diagnostics` array (was
  "omit to stay lean") so the agent can reason over per-bar data and **suggest strategy/indicator
  changes**. FR/Affected-Services + OQ-3 updated accordingly. This is a deliberate reversal for the
  diagnostic-advisor use case; response bounded by the 2-year cap.

## Session 2026-07-08 — sdd-design

- Phase 0 Recon: wrote recon.md (services: proto, analysis, indicators, ui, agent). Key reuse patterns:
  the `outputs`/`is_public` column pattern for `warmup_period`; shared shadcn `Table` + `FormulaWorkspace`;
  `MessageToDict` for the agent; extract `referenced_refs()` from the existing rule-walk.
- Phase 1 Grilling: **2 rounds (full)**. Chosen approach: bundled/ordered feature; both backtest helpers
  return a 4-tuple with `SymbolDiagnostics` built by a shared `_build_bar_diagnostic`; additive
  `evaluate_with_series()`; hybrid warm-up (observe built-ins / declare formulas); 2-year cap defaulting
  unset bounds. Rejected: pure declared-lookback map (off-by-one), Option B, `return_series` kwarg,
  reading action from `decisions[i]`, `react-window`, splitting FR-4c.
- User-locked decisions (round-1 gate): hybrid warm-up; keep `INSUFFICIENT_CAPITAL` unreachable-but-present;
  add `@tanstack/react-virtual`; bundle strictly ordered.
- Constitution rules touched: C-01, C-04, C-05, C-07, C-08, C-09, P-03, P-06, F-01, F-05, F-06, F-07.
  Floor breaches: none.
- Status: spec-ready → design-approved.

### Open Threads (from design.md Open Risks — resolve at /sdd-spec / execute)

- `vwap != 0` presence heuristic vs `optional double vwap` → decide at **step 3b**.
- All-`None` formula series warm-up ambiguity → formulas always use declared `warmup_period` (**step 3c**).
- `bar.time` fix rewrites existing `TradeRecord` times → real `Bar` fixture (**step 3b**).
- Range-unset defaulting changes agent's range-less coverage → verify (**step 3d**).

## Session 2026-07-09 — sdd-spec

- Generated implementation-spec.md with **17 steps**. Status → `implementation-ready`.
- Consumed recon.md + design.md; spot-verified all load-bearing evidence against the live tree
  (no invented refs — C-01/F-04).
- Step map: 1 proto, 2 proto-gen, 3 migration, 4–5 indicators (service+test), 6–13 analysis
  (four service/test pairs: `evaluate_with_series`+`referenced_refs`; diagnostics+`bar.time`;
  warm-up+`no_trade_reason`; range-cap+config), 14–15 ui (service+e2e), 16–17 agent (service+test).
  Every non-frontend service step has a paired red-before-green test step (C-08/P-06).
- Key codebase findings (confirmed this session):
  - Proto field numbers free & assigned: `analysis.proto` `BacktestResult` max = `coverage_gaps=13`
    (`:67`) → `diagnostics=14`; `indicators.proto` `FormulaDefinition` max=11 → `warmup_period=12`,
    `RegisterFormulaRequest`/`UpdateFormulaRequest` max=8 → `warmup_period=9`/`9`. `Bar.volume` is
    `int64` (`marketdata.proto:51`) → `BarDiagnostic.volume` typed `int64`.
  - Indicators last migration is `003_formula_outputs` → next is **004** (F-01); repos
    `create`/`upsert`/`update` use `SELECT *`/`RETURNING *` so the new scalar column auto-flows; only
    `_row_to_formula` (`servicer.py:343`) needs explicit mapping.
  - **Confirmed the latent `bar.timestamp` bug**: analysis `servicer.py` reads `bar.timestamp` at
    `:489/:499/:530/:601/:608/:637` but the marketdata `Bar` field is `time` (`marketdata.proto:46`);
    tests pass only because bars are MagicMock → Step 8 fixes all six + Step 9 mandates a real `Bar`
    fixture.
  - `evaluate()` (`evaluator.py:74`) returns `list[BarDecision]`, sole hot caller `live_loop.py:119`
    uses `decisions[-1]` → additive `evaluate_with_series()` sibling (insights.md pattern), no
    contract widening.
  - UI has the shared shadcn `Table` (`ui/table.tsx:4`) and `FormulaWorkspace` single-source form
    (`FormulaWorkspace.tsx:46`); `package.json` has NO virtualization dep → `@tanstack/react-virtual`
    is a new dependency (Step 14).
  - Agent `client.run_backtest` (`client.py:138`) hand-builds a 7-field dict dropping
    trades/status/coverage_gaps; `MessageToDict` already imported (`:12`) and used by siblings
    (`:294+`) → switch to `MessageToDict(resp, preserving_proto_field_name=True)` (Step 16).
- Open Risks routed into steps: `vwap != 0` heuristic accepted at Step 8 (deviation-logged);
  all-`None` formula uses declared `warmup_period` at Step 10; real `Bar` fixture at Step 9;
  range-unset defaulting verified at Step 13.

### Post-spec — open risks fixed (user: "fix the open risks in the meantime")

All four design.md Open Risks upgraded from routed-to-step to **resolved**; design.md Open Risks now `[x]`:
- **vwap** — *improved beyond the spec's "accept the heuristic":* `BarDiagnostic.vwap` is a plain scalar
  (not in the presence-sensitive `indicators` map), so Step 8 now **always copies** `bar.vwap` with no
  presence heuristic (0.0 = source carried none). Risk eliminated, not accepted.
- **all-`None` formula** — declared `warmup_period` only (Step 10/11); tested.
- **`bar.time` fix** — real `marketdata_pb2.Bar` fixtures mandated (Step 9); asserts the fix + corrected
  `TradeRecord` times.
- **range-unset** — defaults to last `max_range_days` (Step 12/13); tested.

Next: `/sdd-review backtest-debug-info impl-spec`.

## Session 2026-07-09 — sdd-review impl-spec (advisory) + fixes

- `spec-reviewer`: **PASS WITH WARNINGS**, no Floor breach. All 17 steps' cited paths/symbols/line refs
  resolve; proto numbers free; migration 004 correct; every non-frontend service step paired with a
  red-green test step (C-08/P-06); frontend paired with e2e. B2b trading-domain keywords in Steps 6/8/10
  ruled not-applicable (backtest engine places no broker orders).
- `feature-overlap`: **CLEAN** — no migration/proto-field/config-key/dep collision; no merge-order entry.
- Two advisory warnings **fixed pre-execution**: (1) Steps 6 & 8 mis-cited `F-05` for the DRY concern →
  corrected to reference `docs/patterns/dry-guard-rail.md` (DRY guard rail is not a Floor rule); (2) Step 12
  instruction used `self.watcher.get_int` → corrected to `self._cfg.get_int` (real servicer attr, `:72`,
  used at `:898`).

Next: `/sdd-execute backtest-debug-info sequential` on the `feature/backtest-debug-info` branch flow.


## Session 2026-07-09 — sdd-execute (sequential) — toolchain + Steps 1–2

- **Toolchain provisioned on host** (replicating Dockerfile.codegen, per user direction; GitHub releases
  egress-blocked so buf installed via `go install github.com/bufbuild/buf/cmd/buf@latest`; Go plugins,
  npm TS plugins, pip grpcio-tools all via allowlisted registries). Validated: regenerating unmodified
  protos produced an **empty diff** after aligning `protoc-gen-go-grpc` to `v1.6.2` (repo is one patch
  ahead of the Dockerfile's v1.6.1 pin). Docker daemon down / no DB — Postgres handled as the sanctioned
  exception at the migration step.
- Created + pushed integration branch `feature/backtest-debug-info` (seeded from the SDD-docs branch).

### Step 1 — proto: additive diagnostics + warmup_period fields [done]
- Added `BarAction`/`NoTradeReason` enums (both with `_UNSPECIFIED=0`), `BarDiagnostic` (14 fields),
  `SymbolDiagnostics`, and `BacktestResult.diagnostics = 14` to `analysis.proto`; `warmup_period` to
  `FormulaDefinition=12` / `RegisterFormulaRequest=9` / `UpdateFormulaRequest=9` in `indicators.proto`.
- Files modified: `packages/proto/analysis/v1/analysis.proto`, `packages/proto/indicators/v1/indicators.proto`
- Verification: `buf lint` PASS; `buf breaking --against feature/backtest-debug-info` PASS (additive-only).
- Deviations: none.

### Step 2 — proto-gen: regenerate + commit stubs [done]
- Ran `./scripts/buf-gen.sh`; regenerated Go/Python/TS stubs + tsc dist. Diff scoped exactly to
  `analysis` + `indicators` stub dirs; new symbols present in all three languages. Bundled into the
  Step 1 PR per the step's own instruction (C-09).
- Files modified: `packages/proto/gen/**`
- Deviations: none.

### Step 3 — migration: 004_formula_warmup [done]
- Created `004_formula_warmup.{up,down}.sql` (ADD/DROP COLUMN warmup_period INTEGER NOT NULL DEFAULT 0),
  mirroring the additive 003_formula_outputs pattern.
- Files: `services/xstockstrat-indicators/migrations/004_formula_warmup.up.sql`, `.down.sql`
- Verification (CI-equivalent fallback — Docker exception, `migrate`/DB not on host): applied 001→004 in
  a throwaway `postgres:16` container; asserted `warmup_period` = integer/NOT NULL/default 0; `down 004`
  drops it (0 cols); re-up clean. Deviation Log: CI-equivalent fallback (no golang-migrate on host).
- Deviations: verification via postgres:16 container + psql instead of ./scripts/db-migrate.sh (host has
  no `migrate` binary / running DB); SQL and behavior identical.

### Steps 4–5 — indicators warmup_period plumbing + test [done]
- Step 4: RegisterFormula/UpdateFormula read `request.warmup_period`, reject `<0` with INVALID_ARGUMENT
  (reusing the existing validation try/abort), pass it to repo create/upsert/update ($10 / $8 binding),
  and `_row_to_formula` maps `warmup_period`. Mirrors the `is_public`/`outputs` scalar-column pattern.
- Step 5: added `TestFormulaWarmupPeriod` — repo round-trip (binding + decode), servicer register→get
  round-trip, default-0 backward compat, and negative-value INVALID_ARGUMENT on both Register and Update.
- Files: `app/handlers/servicer.py`, `app/services/formulas_repository.py`, `tests/test_formulas.py`
- TDD: RED captured (5/6 fail with Step-4 code stashed) → GREEN (95 pass, ruff clean, cov 79.4% ≥ 50).
- Deviations: none. (Combined the service+test pair into one stacked PR — red-green needs both together.)

### Steps 6–7 — analysis evaluate_with_series + referenced_refs + test [done]
- Step 6: split evaluate() → additive evaluate_with_series() returning (decisions, component_series);
  evaluate() now delegates and still returns list[BarDecision] (feature-048 live loop + list-mocks
  unaffected). Added non-raising referenced_refs(rule) + shared _iter_leaf_terms() traversal (dotted
  refs collapsed to base) — no second parallel walker (DRY).
- Step 7: TestEvaluateWithSeries (series shape incl. bare+dotted keys, empty-bars ([],{}), evaluate()==
  evaluate_with_series()[0]) + TestReferencedRefs (nested AND/OR collection, non-raising on unknown).
- Files: `app/services/evaluator.py`, `tests/test_strategy_evaluator.py`
- TDD: RED (import error, evaluator reverted) → GREEN (35 evaluator+live_loop pass; full suite 145 pass,
  ruff clean, cov 67% ≥ 40).
- Deviations: none.

### Steps 8–11 — analysis per-bar diagnostics + hybrid warm-up + no_trade_reason [done]
- Both backtest methods now return a 4-tuple with a `SymbolDiagnostics`; RunBacktest collects them into
  `result.diagnostics`. Shared `_build_bar_diagnostic` (DRY), `_first_resolved_index`,
  `_classify_no_trade_reason`, `_finalize_symbol_diagnostics` helpers.
- `bar.timestamp` → `bar.time` fixed at all 6 sites (real proto field); TradeRecord times now correct.
- Hybrid Option-C warm-up: legacy = observed first-both-SMA-resolved; evaluated = per-referenced-ref via
  `referenced_refs` (built-in observed / custom-formula declared warmup_period via GetFormula cached per
  run). Warm-up override pass sets warmup flag + WARMUP action; `no_trade_reason` classified.
- `.value` alias dropped from the evaluated indicators map. signal_score 0 on evaluated path (FR-4a).
- Files: `app/handlers/servicer.py`, `tests/test_analysis_servicer.py`
- TDD: RED (5 diagnostics tests fail, servicer reverted) → GREEN (152 pass, ruff clean, cov 75% ≥ 40).
- Deviations: Steps 8-11 combined into one PR (tightly coupled); tests in servicer file. See Deviation Log.

### Steps 12–13 — 2-year range cap + config key [done]
- RunBacktest reads `analysis.backtest.max_range_days` (self._cfg.get_int, default 730). Both bounds set
  + span over cap → INVALID_ARGUMENT (reject, not clamp). Unset bound → defaulted (end→now,
  start→end−cap) so all backtests (incl. the range-less agent call) stay bounded.
- Config key declared in analysis/CLAUDE.md + root CLAUDE.md recently-added-keys.
- Files: `app/handlers/servicer.py`, `services/xstockstrat-analysis/CLAUDE.md`, `CLAUDE.md`, `tests/test_analysis_servicer.py`
- TDD: RED (over-cap runs / unset not defaulted) → GREEN (3 pass; full suite green, cov ≥ 40).
- Deviations: none.

### Steps 16–17 — agent run_backtest includes diagnostics [done]
- client.run_backtest now returns MessageToDict(resp, preserving_proto_field_name=True,
  always_print_fields_with_no_presence=True) — full result incl. per-bar diagnostics, snake_case keys,
  zero-valued metrics preserved (the 0-trades case), readable enum names. Tool docstring updated.
- Files: `app/client.py`, `app/tools.py`, `tests/test_tools.py`
- TDD: RED (KeyError, diagnostics absent) → GREEN (50 pass, ruff clean, cov 61% ≥ 40).
- protobuf 6.33.6 → kwarg is `always_print_fields_with_no_presence` (not the old including_default_value_fields).

### Steps 14–15 — UI virtualized debug table + date cap + formula warm-up input [done]
- New `BacktestDiagnostics` component: per-symbol card with the no-trade reason + a `@tanstack/react-virtual`
  virtualized day-by-day table (date, close, volume, dynamic indicator columns, warm-up, action, conviction).
  Rendered below the equity curve on the strategy page. Date pickers capped to a 2-year span (min/max).
- `FormulaWorkspace` gains a "Warm-up period (bars)" numeric input, threaded through `useFormulas`
  register/update payloads; edit page pre-fills `initialWarmupPeriod`.
- Added dep `@tanstack/react-virtual@^3.10.0` (pnpm-lock.yaml updated).
- Files: `src/components/insights/BacktestDiagnostics.tsx` (new), `src/app/insights/strategies/[id]/page.tsx`,
  `src/components/insights/FormulaWorkspace.tsx`, `src/app/insights/formulas/{new,[id]}/page.tsx`,
  `src/hooks/useFormulas.ts`, `e2e/mock-backend.ts`, `e2e/insights/backtest-coverage.spec.ts`, `package.json`.
- Verification: tsc --noEmit ✓, next lint ✓ (CI-equivalent fallback — pinned Playwright browsers absent;
  e2e test + mock branch committed for CI). Deviation logged.
- Used a virtualized div-grid (not shadcn `<Table>`) because row virtualization needs absolute positioning
  incompatible with native table layout; keeps semantic header/cells + a11y count.

## Session 2026-07-09 — sdd-execute (sequential) — ALL 17 STEPS DONE

- All 17 steps executed + verified as 8 stacked per-step PRs (#746–753), each with red-green TDD
  (backend) or tsc+lint (UI); every backend suite green above threshold; proto stubs byte-match CI.
- Feature branch `feature/backtest-debug-info` fast-forwarded to the cumulative stack tip; integration
  PR → main-dev opened. Status: in-progress → code-completed. No merge-order gate for 064.
- Env notes: codegen toolchain provisioned on host (buf via `go install`, egress-blocked GitHub
  releases); Docker+Postgres used under user exception for the migration test; Playwright browsers
  unavailable → tsc+lint fallback for the UI e2e (test committed for CI). Two ledger insights recorded.

## Session 2026-07-12 (CI: feature status automation)

- Promotion PR #759 merged to main
- Feature promoted and committed: 6fab9e323637aa00e0ad5fc09bb68a1ab6c5a529
- Status updated: `code-completed` → `launched`
- Launched date: 2026-07-12
