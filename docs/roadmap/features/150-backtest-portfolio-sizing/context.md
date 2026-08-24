# Context: backtest-portfolio-sizing

**Feature**: `docs/roadmap/features/150-backtest-portfolio-sizing/feature.md`
**Product Spec**: `docs/roadmap/features/150-backtest-portfolio-sizing/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/150-backtest-portfolio-sizing/implementation-spec.md`

---

## Session 2026-08-23 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the
  metrics-sweep audit finding #2 (`_tasks/x-backtest-metrics-audit.md` Q2; `_tasks/x-strategy-followup-sweep.md`).
- Root evidence: `services/xstockstrat-analysis/app/handlers/servicer.py:522,525-529,571,3630` — serial
  equity threading + per-symbol curve concatenation → aggregate total_return is Π(1+rᵢ)−1.
- Operator decision this session: **story + design only** — stop before /sdd-spec and /sdd-execute so
  the design (allocation policy, opt-in/versioned mechanism, comparability guardrails) is approved
  before any behavior code is written. This is a behavior redesign that would retroactively affect
  banked-backtest comparability, hence gated on opt-in + explicit approval.
- Known traps surfaced (ledger): 067 (proto enum ↔ UI exhaustive `Record` map coupling — a new
  sizing-mode enum needs its TS map key in the same PR); analysis review focus = backtest
  reproducibility / no look-ahead bias.
- Consumer surfaces (C-14): Agent `run_backtest` (+ strat-lab `backtest` skill update in same PR) and
  UI `/insights` backtest views (mode labeling). Scope to be pinned in design.
- Development branch note: rides `claude/xstockstrat-metrics-sweep-m070rf` this session per the binding
  branch constraint rather than a fresh `feature/` branch.

## Session 2026-08-23 — sdd-design

- Phase 0 Recon: wrote recon.md (services: analysis + agent + ui; reuse: _compute_metrics, per-symbol
  cells, cooldown helpers, additive enum shape). Four recon subagents (analysis, agent, ui, scenario-recon).
- Phase 1 Grilling: 5 rounds (full; user overrode the default and ran to the cap). Chosen approach:
  dedicated _simulate_portfolio fed per-bar intent RETURNED additively by the existing simulators
  (single fetch), shared cash pool + concurrent positions on a union calendar, cooldown applied
  portfolio-locally, force-close-realized terminal policy, portfolio equity curve fed to existing
  _compute_metrics; legacy path byte-for-byte, grade per-symbol-cell (FR-4). Config-only sizing params.
- Rejected: diagnostics-replay (lossy), double-pass (2× fetch, feature-141 hazard), live-equity sizing
  (order-dependent), request-override params (speculative), graded-conviction (binary conviction).
- Constitution rules touched: C-04, C-05/F-07, C-08/P-06, C-09, C-10/C-14, C-16, F-01, F-06. Floor
  breaches: none at any round.
- Cross-feature field/migration coordination with 151 recorded in merge-order.md (150 owns
  RunBacktestRequest.8, BacktestResult 17/18/19, BacktestRunSummary 17, migration 017; 151 takes the
  next slots). Numbers re-derived from the merged tree at /sdd-spec time.
- Open risks (carried): shared-calendar forward-fill look-ahead (AC (e) needs a mid-series-gap
  fixture); stale-close drawdown understatement; merge-order.md SPOF; symbol-ASC systematic bias;
  per-symbol BarDiagnostic.equity stays per-symbol.
- Status: draft → design-approved. Operator decision: stop before /sdd-spec this session.

## Session 2026-08-23 — sdd-spec

- Generated implementation-spec.md with 13 steps. Status → implementation-ready.
- Proto/migration numbers re-derived from the merged main-dev tree and confirmed to match the
  merge-order.md 150↔151 reserved split exactly: `RunBacktestRequest` next-free field = **8**;
  `BacktestResult` next-free = **17** (so 17/18/19 = sizing_mode/capital_skips/portfolio_equity_curve);
  `BacktestRunSummary` next-free = **17**; last analysis migration on disk = `016_...` → next = **017**.
  No drift from the design footprint — 151's slots (req 9, result 20, summary 18, migration 018) stay free.
- Step structure: proto(1) → proto-gen(2) → migration 017(3) → config declaration(4) → analysis engine
  in two service/test pairs (5/6 = additive intent-return + pure `_simulate_portfolio`; 7/8 = RunBacktest
  routing + persistence + summary), guarding the byte-for-byte legacy invariant with a RED test before
  any routing edit → agent surface(9/10) → strat-lab skill same-PR(11) → UI(12/13).
- Key codebase findings (all evidence-cited in the spec):
  - Both simulators compute per-bar intent BEFORE the position/capital gate — SMA `combined`
    (`servicer.py:995`, gates `:1004`/`:1017`), evaluated `decision.entry/.exit`
    (`servicer.py:1185`/`:1201`); intent-return is a clean additive 5th tuple element, legacy control
    flow untouched. Serial loop + concatenation at `:522-571`; aggregate `_compute_metrics` at `:3617`
    (reused for the portfolio curve, not forked — DRY).
  - Per-symbol evidence cells (`servicer.py:557-569`) run unchanged in BOTH modes, so the feature-065
    derived grade is byte-for-byte identical for free (FR-4/AC-5) — cells are relative to each symbol's
    own `daily_eq[0]`, scale-invariant and order-independent.
  - Cooldown parity (FR-6) reuses the pure `app/services/cooldown.py` helpers against portfolio-local
    per-symbol anchors (never `analysis.strategy_cooldowns`).
  - Persistence: `_persist_backtest_run` (`servicer.py:1546`) → `BacktestRunsRepository.insert`
    (`backtest_runs.py:25-68`) + `_row_to_backtest_summary` (`servicer.py:3422`) get the three new
    columns (mirrors the nullable `user_id` add in migration 015 / repo). Config keys use the
    intended `get_float`/`get_int` zero-trap (a configured `0` disables → default), declared in
    analysis CLAUDE.md (no config seed migration — analysis keys are code-default, verified).
  - Agent: `client.run_backtest` returns `MessageToDict`, so new fields flow through automatically;
    the descriptor-parity guard `test_backtest_view.py:157-173` fails-closed on the 3 new
    `BacktestResult` fields until `backtest_view.py` accounts for each (the C-10 built-in red).
  - strat-lab `backtest` skill Phase 3 + `reference/aggregation.md` already document the
    sequential-compounding problem this feature fixes — updated in the SAME PR (root CLAUDE.md).
  - UI: `SizingMode` render map is net-new (no pre-existing exhaustive Record → no 067 tsc break on
    regen, but the new map must be exhaustive); BFF unchanged (forwards the full message).
- Not trading-domain-relevant per step-constraints §A (no trading/portfolio service, no broker/order/
  fill/TRADING_MODE surface — backtest-only accounting, live loop places no orders). No new outbound
  gRPC edge (portfolio sim is in-process, reuses the simulators' existing GetBars) → §B header
  propagation N/A on every service step.
- Carried design Open Risks folded into steps: mid-series-gap fixture REQUIRED for the look-ahead RED
  (Step 6); stale-close drawdown-understatement + symbol-ASC-bias documented as v1 caveats;
  `BarDiagnostic.equity` stays per-symbol (portfolio curve lives only in `portfolio_equity_curve`).

## Session 2026-08-23 — sdd-review impl-spec (advisory)

- Result: 0 failures, 2 warnings + notes (PASS WITH WARNINGS; no Floor breach). Overlap: numbers CLEAN.
- Items addressed in-spec this session:
  - Step 8 golden-compare tension (a legacy run now stamps sizing_mode=SIZING_MODE_LEGACY field 17, so
    a naive full-message compare vs a pre-feature golden false-fails) — [x] fixed: Step 8 now clears
    the three additive fields (sizing_mode/capital_skips/portfolio_equity_curve) alongside
    backtest_id/completed_at, comparing the whole message minus those.
  - FR-6 uncovered by any @AC (portfolio-mode cooldown parity) — [x] fixed: added @AC-7 @FR-6 to
    acceptance.feature; coverage map + Step 6 Covers + a cooldown-parity test item (4b) added.
  - AC-6 vocabulary ("bar's diagnostic reason" vs the dedicated PortfolioCapitalSkip list) — [x] fixed:
    AC-6 reworded to a PortfolioCapitalSkip record + lower-trade-count assertion; coverage map updated.
  - Step 1 buf breaking baseline was the feature branch — [x] fixed: now `--against main-dev` (merge
    target), re-derive merge base at execute time.
  - Step 2 codegen `gen/**` wildcards — [x] no change: intentional/defensible codegen exception
    (never hand-edited; empty-rerun-diff is the gate).
- Overlap (feature-overlap agent): proto field numbers, migration NNN, and config keys all CLEAN vs 151
  and trunk. merge-order.md 150↔151 row ENHANCED to flag the three same-function source overlaps
  (servicer.py, backtest_runs.py, backtest_view.py) as manual-merge for whichever lands second. [x]
- Carried into /sdd-execute (no unaddressed ✗): the same-function merge burden above; the design Open
  Risks already folded into steps (mid-series-gap look-ahead fixture, stale-close drawdown caveat,
  symbol-ASC bias, per-symbol BarDiagnostic.equity).

## Session 2026-08-23 — sdd-execute (on claude/xstockstrat-metrics-sweep-m070rf)

Branch deviation (C-06): executed on the session's designated harness branch, not a fresh
feature/ branch, per the binding session constraint; all steps land in PR #1004. Codegen toolchain
provisioned on host (buf + Go plugins v1.36.11/v1.6.2/v1.19.2 + TS plugins + grpcio-tools==1.80.0);
buf-gen verified byte-for-byte against checked-in stubs before any proto edit.

### Step 1 — proto: SizingMode enum + additive fields [done]
- Added SizingMode enum, RunBacktestRequest.sizing_mode=8, PortfolioCapitalSkip + EquityPoint
  messages, BacktestResult 17/18/19, BacktestRunSummary.sizing_mode=17. Additive only.
- Verify: buf lint clean; buf breaking vs origin/main-dev clean (subdir ref). TDD: N/A (proto).
- Files: packages/proto/analysis/v1/analysis.proto
### Step 2 — proto-gen: regenerate stubs [done]
- ./scripts/buf-gen.sh; diff scoped to analysis go/python/ts(+dist); re-run idempotent. TDD: N/A.
- Files: packages/proto/gen/**
### Step 3 — migration 017 backtest_runs sizing columns [done]
- Additive nullable sizing_mode/position_weight/max_concurrent; up/down pair reverse-verified offline (no DB). TDD: N/A.
- Files: services/xstockstrat-analysis/migrations/017_backtest_runs_sizing.{up,down}.sql
### Step 4 — config keys declared [done]
- analysis.backtest.portfolio_position_weight (0.10), portfolio_max_concurrent (9), zero-trap intended; code-default (no seed). TDD: N/A.
- Files: services/xstockstrat-analysis/CLAUDE.md, docs/patterns/config-governance.md
### Step 5 — service: additive per-bar intent return + `_simulate_portfolio` [done]
- Added `BarIntent` frozen dataclass; both simulators (`_backtest_symbol`, `_backtest_symbol_evaluated`)
  now return an additive 5th element (per-in-window-bar signal intent, computed before the
  position/cooldown/capital gate — signal intent, not realized execution). The two RunBacktest call
  sites unpack the 5th value into a `symbol_intents` buffer (consumed only by the portfolio path,
  Step 7). Legacy 4-tuple output unchanged.
- Added `_simulate_portfolio(...)`: union calendar, past-only forward-fill MTM, shared cash pool,
  exits-first then symbol-ASC entries gated by max_concurrent + cash (else PortfolioCapitalSkip),
  portfolio-local cooldown parity (effective_cooldown_days/is_cooldown_active on ephemeral per-symbol
  anchors), per-bar EquityPoint, terminal force-close. No new gRPC/DB edge (§B N/A).
- Arity ripple: existing tests that unpack the simulators' 4-tuple were updated — RunBacktest mocks
  now return a 5th `[]`; the `_run_evaluated` and `TestTradeStartIndex._run` helpers slice `[:4]` so
  their many 4-tuple callers stay valid. Verified: 267 pre-existing servicer tests still green.
- Verify: ruff check + format clean on servicer.py. TDD: red-green (paired Step 6).
- Files: services/xstockstrat-analysis/app/handlers/servicer.py
### Step 6 — test: intent return + `_simulate_portfolio` [done]
- New `tests/test_portfolio_sizing.py`: look-ahead RED on a mid-series gap (@AC-1/2), order-independence
  + not-the-parlay (@AC-1), shared-pool per-bar equity (@AC-2), capital-skip + lower-trade-count (@AC-6),
  cooldown parity in-window (@AC-7), no-repo-access (FR-6/7), and the additive-5th-element intent return
  (@AC-3 half). C-13: synthetic BarIntent series are single-file helpers here (no second consumer) → stay
  in this test module, not conftest.
- Verify: ruff clean; 551 tests pass; coverage 82.91% (≥40). TDD: red-before-green (the referenced
  `_simulate_portfolio`/intent 5th element did not exist pre-Step-5).
- Files: services/xstockstrat-analysis/tests/test_portfolio_sizing.py
### Step 7 — service: route RunBacktest by sizing_mode; populate + persist [done]
- RunBacktest resolves `sizing_mode` (UNSPECIFIED/LEGACY → legacy path unchanged; PORTFOLIO →
  `_simulate_portfolio`). Portfolio branch resolves config params (portfolio_position_weight 0.10,
  portfolio_max_concurrent 9, max(1,·) clamp) + strategy cooldown days, computes aggregate metrics
  from the order-independent portfolio curve, sets result.sizing_mode/capital_skips/
  portfolio_equity_curve. Legacy branch only additionally stamps sizing_mode=SIZING_MODE_LEGACY
  (field 17) — no other field touched; per-symbol loop, evidence cells, and diagnostics run
  identically in both modes (FR-4/AC-5). INSUFFICIENT_DATA gate stays on the per-symbol all_trades.
- `_persist_backtest_run` + repo `insert` extended with sizing_mode name + position_weight +
  max_concurrent (migration 017 columns; NULL on legacy). `_row_to_backtest_summary` maps
  sizing_mode via the status name→enum pattern (null/legacy row → UNSPECIFIED).
- §B header propagation: N/A (portfolio sim is in-process, no new outbound gRPC edge).
- Files: services/xstockstrat-analysis/app/handlers/servicer.py, app/repositories/backtest_runs.py
### Step 8 — test: legacy byte-for-byte + mode recorded + grade parity [done]
- test_analysis_servicer.py TestPortfolioSizingRouting: UNSPECIFIED==explicit LEGACY byte-for-byte
  (via `_canonical_pre150` clearing the 3 additive fields) + portfolio-branch teeth (@AC-3);
  portfolio run returns + persists SIZING_MODE_PORTFOLIO with resolved params, legacy persists
  NULL params, summary projection maps the mode (@AC-4); per-symbol evidence cells byte-identical
  across modes (@AC-5). test_backtest_runs_repo.py: two new insert-kwargs round-trips (portfolio +
  legacy-NULL).
- Verify: ruff clean; 558 tests pass; coverage 82.95% (≥40). TDD: red-before-green.
- Files: services/xstockstrat-analysis/tests/test_analysis_servicer.py, tests/test_backtest_runs_repo.py
### Step 9 — service: agent run_backtest sizing_mode arg + surfacing [done]
- client.run_backtest gained `sizing_mode: str|None`; maps "portfolio"→SIZING_MODE_PORTFOLIO,
  "legacy"→SIZING_MODE_LEGACY, None→unset (server default). tools.py run_backtest threads it +
  documents the footgun. backtest_view: sizing_mode added to _HEAD_KEYS (inline), capital_skips
  surfaced as a COUNT (mirrors coverage_gaps guard), portfolio_equity_curve added to
  _INTENTIONALLY_DROPPED (attachment-only, O(bars)). CLAUDE.md run_backtest row updated. §B N/A
  (reuses existing outbound edge).
- Files: app/client.py, app/tools.py, app/backtest_view.py, CLAUDE.md
### Step 10 — test: agent sizing_mode + descriptor-parity [done]
- test_backtest_view: descriptor-parity `kept` literal += capital_skips (sizing_mode via _HEAD_KEYS,
  portfolio_equity_curve via dropped); _full_result fixture carries the 3 new fields; new
  summarize tests for the mode + skip-count (incl. []→0). test_client: TestRunBacktestSizingMode
  (portfolio/legacy/unset → req.sizing_mode). test_tools: assert_called_once_with += sizing_mode=None,
  + a passthrough+surfacing test.
- Verify: ruff clean; 272 tests pass; coverage 78.13% (≥40). TDD: red-before-green.
- Files: tests/test_backtest_view.py, tests/test_client.py, tests/test_tools.py
### Step 11 — docs: strat-lab backtest skill [done]
- SKILL.md Phase 3 now lists three baskets (portfolio mode / legacy sequential footgun /
  independent-per-symbol); reference/aggregation.md adds portfolio mode and retires the "sequential
  is the only in-engine portfolio" caveat. Same PR as the tool change (root CLAUDE.md § strat-lab).
- Files: plugins/strat-lab/skills/backtest/SKILL.md, plugins/strat-lab/skills/backtest/reference/aggregation.md
### Step 12 — service: UI mode label + portfolio equity curve + Past Runs mode [done]
- BacktestDiagnostics.tsx: exhaustive `SIZING_MODE_LABEL: Record<SizingMode,string>` (ledger 067 —
  new enum value fails tsc; UNSPECIFIED→"Legacy"). EquityCurveChart.tsx: added sibling
  `PortfolioEquityCurveChart` (single shared-pool line from EquityPoint[]). page.tsx: sizing-mode
  Badge on the results surface, a "Mode" column in pastRunsColumns, and the portfolio curve rendered
  when sizingMode===PORTFOLIO && curve non-empty. BFF/hooks unchanged (full message already flows).
- Verify: pnpm lint clean (pre-existing warnings only); tsc --noEmit exit 0 (regenerated proto TS
  types carry sizingMode/portfolioEquityCurve/capitalSkips).
- Files: BacktestDiagnostics.tsx, EquityCurveChart.tsx, strategies/[id]/page.tsx
### Step 13 — test: UI e2e mode label + fixtures + mock-backend branch [done]
- e2e/fixtures/backtests.ts: PORTFOLIO_EQUITY_CURVE + SIZING_MODE_{LEGACY,PORTFOLIO}; INVENTORY.md
  row (C-12). mock-backend: HIST_RUN_METRICS detailed=portfolio / legacy=legacy, HIST_RUN_DETAIL
  gains sizingMode+portfolioEquityCurve, runBacktest echoes req.sizingMode (portfolio branch returns
  a distinct OK result). New e2e/insights/backtest-sizing.spec.ts asserts the Past Runs Mode column
  + the results-surface badge + the portfolio equity curve chart.
- Verify: backtest-sizing.spec.ts 3/3 pass; backtest-coverage.spec.ts 11/11 pass single-worker (the
  2 transient 2-worker failures were dev-server ECONNRESET flakiness on unrelated strat-high-001
  tests, green on isolated re-run). TDD: red-before-green (spec fails against pre-Step-12 UI).
- Files: e2e/fixtures/backtests.ts, e2e/fixtures/INVENTORY.md, e2e/mock-backend.ts,
  e2e/insights/backtest-sizing.spec.ts

## Session 2026-08-23 — feature 150 code-completed
All 13 steps done on claude/xstockstrat-metrics-sweep-m070rf → PR #1004. status.md → code-completed.

## Session 2026-08-24 (CI: feature status automation)

- Promotion PR #1006 merged to main
- Feature promoted and committed: 2c8c9d7cb563140384324b5e1f9ff6fdceb1a367
- Status updated: `code-completed` → `launched`
- Launched date: 2026-08-24
