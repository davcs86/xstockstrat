# Context: cross-stock-score-derivation

**Feature**: `docs/roadmap/features/065-cross-stock-score-derivation/feature.md`
**Product Spec**: `docs/roadmap/features/065-cross-stock-score-derivation/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/065-cross-stock-score-derivation/implementation-spec.md`

---

## Session 2026-07-12 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Origin: design discussion following PR #758 (feature 064 backtest run history). The user
  explicitly chose **statistical robustness** over single-run traceability for the headline
  grade ("the product is named after Cross Stock Strategies").
- Key design decisions carried from the discussion into the spec:
  - Unit of evidence is the **(symbol × window) cell**, not the run — runs are arbitrary
    user-shaped containers; cells make breadth measurable and kill overlapping-run
    double-counting.
  - Dedup rule: one cell per symbol, **most trading days wins** (tie → newest). Replays add
    no weight; short runs can't displace long ones.
  - Aggregation: trading-day evidence weights + **empirical-Bayes shrinkage toward 0.5**
    (`analysis.scoring.shrinkage_days`, default 250). Chosen over lower-confidence-bound
    variants (LCB breaks at n=1 cell) and over dispersion penalties (deferred, out of scope).
  - **Weight by evidence, never by outcome**: the user's original suggestion included yield
    as a weight; rejected as outcome-weighting = built-in upward bias. Yield-as-component is
    an open question instead.
  - `strategy_scores` is kept as a **materialized cache** of the derivation (recomputed at
    write time), preserving the write-through + hydrate-at-boot pattern (ledger insight
    2026-07-03, persist-strategy-scores) — read paths untouched.
  - Reset on `ManageStrategy UPDATE` via eligibility filter `completed_at >
    strategies.updated_at`.
  - `ScoreStrategy` repurposed as recompute-from-cells (currently vestigial — re-scores the
    in-memory latest backtest that RunBacktest already scored).
  - No cell backfill from pre-existing run-level aggregates (not per-symbol; would poison the
    evidence base).
- Ledger reads surfaced two relevant entries, both recorded in the spec:
  - insight 2026-07-03 (persist-strategy-scores): keep write-through+hydrate (FR-4).
  - fail 2026-07-01 / C-10(b) (056-open-positions-ui): two read paths surfacing one value —
    here the divergence between per-run score and derived grade is *intentional*; spec
    requires explicit labeling + test instead of parity (FR-8, Open Questions).

## Session 2026-07-12 (later) — open-questions expansion

- On user request, expanded the spec's Open Questions into OQ-1…OQ-6, each with candidate
  resolutions, pros/trade-offs, and a recommendation. Checkboxes remain open pending user
  confirmation (to be recorded here when given). Recommended resolutions:
  - OQ-1: keep `shrinkage_days=250` + floor 3 symbols/500 days; documented the closed-form
    calibration anchors (perfect-evidence A ⇔ W ≥ 1.5k symbol-days; B ⇔ W ≥ 0.43k).
  - OQ-2: keep the three-component blend; no return component (defer; opt-in
    `return_weight=0.0` key is the retrofit path if rankings mislead post-launch).
  - OQ-3: headline-score **registered definitions only**; ad-hoc strategy_ids keep run
    history + per-run scores but get no headline (also fixes the pre-existing
    strategy_scores pollution gap). If confirmed → FR-2a/FR-6 deltas noted in the spec.
  - OQ-4: in-request recompute only (RunBacktest / UPDATE / ScoreStrategy triggers); hydrate
    unchanged; documented staleness semantics — ScoreStrategy is the manual refresh after a
    scoring-config change.
  - OQ-5: close the C-10(b) trap with copy ("Strategy Grade" card vs "Run score" column) +
    a Playwright both-labels-render assertion.
  - OQ-6: accept correlated-symbol breadth inflation for v1 with a named revisit trigger;
    sector-capped weights (via feature-059 fundamentals sector data) is the designated
    follow-up if needed.

## Session 2026-07-12 (later) — OQ resolutions confirmed

- **User confirmed all six recommendations as-is** ("go with your recs"). All OQ checkboxes
  marked resolved in product-spec.md; the analyses are retained there as the decision record.
- OQ-3 FR deltas applied: FR-2a now scopes headline scoring to registered strategies only
  (ad-hoc ids record cells + history, no headline, no `strategy_scores` write); FR-6 returns
  NOT_FOUND for unregistered ids. Out of Scope updated accordingly (existing ad-hoc
  `strategy_scores` rows are not cleaned up here; OQ-2 decision noted).
- Next: `/sdd-review cross-stock-score-derivation product-spec`.

## Session 2026-07-12 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: none (criteria pass: PASS, 0 blockers, 0 warnings, 3 notes).
- Overlap findings: none (CLEAN — analysis migration 007 free; StrategyScore proto fields 5–7
  free, BacktestRunSummary 15+ free; new `analysis.scoring.*` keys unclaimed; no in-flight
  feature touches these tables/files).
- Notes carried forward for /sdd-spec:
  1. Resolve the "optional, decide at spec time" `BacktestRunSummary.range_start/range_end`
     proto addition (field numbers 15+ are free).
  2. Include Config-Keys-Consumed table registration in `services/xstockstrat-analysis/CLAUDE.md`
     for the three new `analysis.scoring.*` keys (routine per config governance).
  3. If seeding the config keys via a config-service seed migration (pattern of 058/059/062),
     the next free number in `services/xstockstrat-config/migrations/` is `009`.
  4. FR-9 UX cliff acknowledged by review as documented-behavior-not-gap: a legacy broad grade
     can drop sharply on first post-deploy recompute (cells-only evidence).

## Session 2026-07-13 — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-analysis, xstockstrat-ui,
  packages/proto; key reuse patterns: `_compute_metrics` per symbol at the `servicer.py:298`
  insertion point, write-through+hydrate preserved). Extra finds: third UI score render
  surface (insights dashboard, duplicated `ratingVariant`), `updated_at` bumped by
  live-toggle/deactivate, no config seed migration needed (fallback-only precedent).
- Phase 1 Grilling: **2 rounds (full)**. Round 1 found blocking B1 (cells carried no
  executed-definition identity: UI button runs legacy SMA, inline forgery, mid-run UPDATE
  race). Round 2 refined to per-cell definition fingerprints and was verified sound.
  Chosen approach: fingerprint-stamped per-symbol evidence cells + traded-first DISTINCT ON
  dedup + shrinkage aggregation in Python, materialized via the existing score write funnel;
  full detail in design.md. Rejected (headline items): timestamp eligibility,
  definition_updated_at column, definition_version counter, zero-trade exclusion,
  pure-prior ScoreStrategy response, unshrunk components.
- **User-signed decisions (P-03/P-04), all via interactive gate 2026-07-13**:
  1. B1 fix = fingerprint + UI detail page sends `strategyIdRef` (UI runs now execute the
     registered definition — engine switch acknowledged).
  2. **Zero-trade cells COUNT as evidence** (≈0.30 F-ish score), with traded-cells-first
     dedup so non-participation can never shadow traded evidence. (Overrides the earlier
     working steer of "exclude" — that steer was never user-confirmed; the original
     interactive gate failed to deliver.)
  3. ScoreStrategy on zero eligible cells: clear stale grade (in-memory pop + NON-best-effort
     DB delete on this path), then NOT_FOUND.
  4. Components shrunk identically to overall with weights renormalized wᵢ/Σw.
  5. MCP agent caller parity IN SCOPE (`strategy_id_ref=strategy_id` in agent client);
     product-spec Affected Services amended.
  6. FR-3 deviations signed: renames don't reset evidence; definition REVERTS RESURRECT the
     prior evidence base (evidence describes definition content, not a timeline).
  7. Side-effectful NOT_FOUND on ScoreStrategy sanctioned; `analysis.strategy.scored` event
     stays ScoreStrategy-only (documented asymmetry).
- Constitution rules touched: C-01, C-02, C-04, C-05, C-07, C-08, C-09, C-10, C-11, P-01..P-06,
  F-01, F-02/03, F-04, F-06, F-07, F-11. Floor breaches: **none** (both rounds clean).
- Open Threads (mirrored from design.md § Open Risks):
  - Fingerprint canonicalization sensitivity (entry/exit rule strings) → fingerprint-stability
    unit tests in the service-cells step.
  - Zero-trade grade semantics = visible behavior shift → docs step.
  - `backtest_run_symbols` retention gap → docs step.
  - Correlated-breadth inflation → post-launch observation (OQ-6).
  - Per-strategy lock is single-process-only protection → docs note.
- Status: spec-ready → design-approved.

## Session 2026-07-13 — sdd-spec

- Generated implementation-spec.md with 12 steps. Status → implementation-ready.
- Anchor verification (two discovery agents) confirmed recon/design citations and surfaced
  spec-shaping corrections, all folded into the steps:
  - **No `strategy_id == strategy_id_ref` comparison exists** in RunBacktest today — the
    fingerprint stamp guard is net-new (Step 4).
  - **No asyncio.Lock in servicer.py** (precedents only in live_loop.py:56 /
    fundsignal_loop.py:76) and **no `delete` on StrategyScoresRepository** — both net-new
    (Step 6).
  - `_compute_metrics` uses a **literal 252** (servicer.py:1379, :1383) — no named constant;
    the UI's `TRADING_DAYS_PER_YEAR` mirrors it with a comment (Step 10).
  - **Agent has no CI test job** (ci.yml python-test matrix covers indicators/ingest/analysis
    only) — Step 9 verification is local-only, noted for reviewers.
  - **UI has no unit-test runner** (Playwright only) — Step 10 carries no unit red-green;
    behavior asserted by Step 11 e2e (new assertions fail pre-implementation).
  - Global react-query `retry: 1` (queryClient.ts:14) — the NotFound retry predicate in
    useStrategyReport must override it (Step 10).
  - Dashboard duplicates **both** helpers (`scoreColor` insights/page.tsx:213-217 and
    `ratingVariant` :219) — both extracted to scoreDisplay.ts (Step 10).
  - Detail page has NO score empty state today (card hidden by `report?.score &&` guard) —
    cleared-state card is net-new (Step 10); mock getStrategyReport returns bare
    `{strategyId}` for unknown ids (mock-backend.ts:511) — hook for the NOT_FOUND e2e case.
  - Ledger completion emit at servicer.py:387-395 confirmed unguarded — recompute ordered
    before it (Step 6).
  - `ScoreStrategyRequest.range = 2` exists and is unused — documented as ignored (Steps 6, 12).
  - No env-var or deployment-file changes needed (analysis endpoints already present in
    docker-compose and both app specs).
- Step layout: proto → proto-gen → migration 007 → cells+fingerprint (service+test) →
  derivation+triggers (service+test) → agent parity (service+test) → UI (service+e2e) → docs.
  Migration explicitly ordered before service deploys (extended upsert references new columns).

## Session 2026-07-13 (later) — sdd-spec amendment: test-infrastructure scope addition

- **User-directed scope addition** (P-04 sign-off = user message 2026-07-13: "we need to seed
  UI unit testing with vitest and agent unit testing as part of this project"). Product spec
  gains FR-10; implementation spec amended 12 → 14 steps (no execution had started, so F-09
  immutability was not yet in force).
- New Step 10 (test): seed vitest in xstockstrat-ui — node-environment logic tests, coverage
  scoped to `src/lib/**` at 40 (whole-src unearnable at seed time), lcov reporter matching the
  node-test job's artifact contract (`ci.yml:511-521`); component/jsdom testing explicitly out
  of scope. Ordered BEFORE the UI service step so scoreDisplay.ts + the NotFound retry
  predicate get true red-green unit gates (old Step 10/11 renumbered to 11/12; Step 12 now
  carries the vitest suites + e2e).
- New Step 13 (test): CI wiring. Grounded finding: **xstockstrat-agent is entirely absent
  from ci.yml** — no `changes` path filter (`ci.yml:36-70`), no python-lint (`:281-287`) or
  python-test (`:322-331`) entries; its `pyproject.toml:19-20` dev extra is already compatible
  with the job's `pip install -e ".[dev]"` pattern (`:344-345`). Adds agent filter+lint+test
  (threshold 40) and xstockstrat-ui to node-test (`:465-487`).
- Step 14 (docs) expanded: UI CLAUDE.md § Testing (vitest layer), agent CLAUDE.md § Running
  Tests (now CI-enforced), root CLAUDE.md tooling table (vitest row).
- Risk noted for execute: the agent suite has never run in CI — environmental failures
  surface at Step 13's PR; local pre-check mirrors the CI command exactly.

## Session 2026-07-13 — sdd-review impl-spec (advisory)

- **PASS WITH WARNINGS** (0 blockers, 2 warnings, 4 notes; 14/14 steps otherwise clean).
  Overlap scan CLEAN (migration 007, proto 5-7/15-16, config keys, CI/UI/agent file set all
  unclaimed; no merge-order entry needed). No Floor risk (F-01/F-06/F-07 assessed clean;
  the UI 252 constant judged a mirrored domain constant, not an F-07 breach).
- Both advisory warnings fixed in the spec pre-execution (F-09 not yet in force):
  1. Step 1 `buf breaking` verification now includes `,subdir=packages/proto`
     (buf module root ≠ repo root; precedent scripts/buf-gen.sh:41).
  2. Step 9 retargeted: the `strategy_id_ref` assertion goes in the stub-capture pattern
     (test_tools.py:432-464), not test_run_backtest_calls_grpc (:232 mocks
     client.run_backtest wholesale — no request object exists there).
- Notes accepted as-is: minor line-anchor drift in Steps 2/13 (content claims verified);
  Step 10's coverage threshold enforced via Step 12's test:coverage.
- Next: /sdd-execute cross-stock-score-derivation.

## Session 2026-07-13 — sdd-execute (sequential, single-PR)

- Resumed on designated branch `claude/cross-stock-score-derivation-94k11z`, rebuilt from
  `origin/main-dev` (user: "use main-dev"). Feature dir loaded from main-dev (065).
- **Workflow deviation (user-directed)**: single integration PR for the whole feature instead of
  sequential mode's default stacked per-step PRs ("all that but only one single PR, no stacked
  PRs"). All 14 steps commit sequentially to the one branch; one PR → main-dev at the end.
- Toolchain: buf/protoc/grpc_tools/migrate missing + Docker daemon down. Installed the codegen
  toolchain on the host pinned to CI proto-freshness versions (buf 1.69.0, protoc-gen-go v1.36.11,
  protoc-gen-go-grpc v1.6.2, protoc-gen-connect-go v1.19.2, grpcio-tools 1.80.0, pnpm workspace).

### Step 1 — proto: additive StrategyScore provenance + BacktestRunSummary range fields [done]
- Added `StrategyScore.evidence_symbols=5`, `evidence_days=6`, `provisional=7`; `BacktestRunSummary.range_start=15`, `range_end=16`. All additive scalars/Timestamps (no enums, C-04 N/A).
- Verified: `buf lint` OK; `buf breaking` against `origin/main-dev` OK (non-breaking).
- Files modified: `packages/proto/analysis/v1/analysis.proto`
- Deviations: buf breaking baseline used `origin/main-dev` (feature branch never pushed) — full detail in Deviation Log.
- TDD: N/A (proto)

### Step 2 — proto-gen: regenerate stubs [done]
- Ran `./scripts/buf-gen.sh` (host toolchain, CI-pinned versions). Diff scoped to analysis/v1 only (Go/Python/TS + compiled dist). New fields present in all three languages. Re-run produced empty diff (idempotent).
- Files modified: `packages/proto/gen/go/analysis/v1/analysis.pb.go`, `packages/proto/gen/python/analysis/v1/analysis_pb2.py`, `packages/proto/gen/ts/analysis/v1/*`, `packages/proto/gen/ts/dist/analysis/v1/*`
- Deviations: none. TDD: N/A (proto-gen)

### Step 3 — migration: analysis 007 evidence cells + range + provenance columns [done]
- Created backtest_run_symbols table (PK backtest_id,symbol) + idx_brs_eligibility (traded-first DISTINCT ON); ALTER backtest_runs +range_start/range_end; ALTER strategy_scores +n_symbols/total_trading_days/provisional. No strategies ALTER.
- Verified reversibility on throwaway Postgres 16 (migrate/Docker unavailable): 001→007 up, 007 down (clean), 007 re-up. CI-equivalent fallback, logged in Deviation Log.
- Files modified: `services/xstockstrat-analysis/migrations/007_backtest_run_symbols.up.sql`, `.../007_backtest_run_symbols.down.sql`
- Deviations: throwaway-postgres verification — full detail in Deviation Log. TDD: N/A (migration)

### Step 4 — service: per-symbol evidence cells + definition fingerprint capture [done]
- Added `_definition_fingerprint` (sha256 of DB definition_json minus display_name/active/live_enabled), `BacktestRunSymbolsRepository` (insert_many + traded-first fetch_eligible), per-symbol cell buffering in RunBacktest (zero-trade cells buffered), OK-run cells flush stamping fingerprint + range, and range_start/range_end on the run-history insert.
- Fingerprint stamped only when strategy_id == strategy_id_ref AND registered row present (inline/legacy/id-mismatch/unregistered → None).
- Files modified: `app/repositories/backtest_run_symbols.py` (new), `app/repositories/backtest_runs.py`, `app/handlers/servicer.py`
- TDD: red → green (see Step 5).

### Step 5 — test: cells + fingerprint coverage [done]
- red: `test_backtest_run_symbols_repo.py` + servicer cell/fingerprint tests failed pre-Step-4 (`No module named 'app.repositories.backtest_run_symbols'`; `_definition_fingerprint` absent). green: 195 passed, coverage 77.10% (≥40 floor), ruff clean.
- Covers: insert_many SQL/params, fetch_eligible DISTINCT ON + traded-first ordering, fingerprint stability (rename/toggle same, rule-change differs, key-order-invariant, None/{}), OK run buffers one cell/symbol incl zero-trade, registered-own-run stamps fingerprint, id-mismatch → None, INSUFFICIENT flushes nothing, cells-flush failure never fails run, range passthrough to history insert.
- Files modified: `tests/test_backtest_run_symbols_repo.py` (new), `tests/test_analysis_servicer.py`
- Deviations: none. TDD: red → green.

### Step 6 — service: headline derivation, recompute triggers, ScoreStrategy repurpose [done]
- Extracted `_score_from_metrics`/`_grade` from `_score_from_result` (delegates); added pure `_aggregate_cells` (evidence-day weights + EB shrinkage toward 0.5, components shrunk identically, non-finite filtered, Σw==0→None); `StrategyScoresRepository.delete` + provenance columns on upsert; per-strategy `_recompute_locks` + `_recompute_headline`/`_recompute_headline_locked` + `_fetch_and_aggregate`/`_derive_score_from_cells`.
- RunBacktest: removed per-run headline upsert; recompute from cells before completion emit. ManageStrategy UPDATE: unconditional in-memory pop + best-effort inner recompute under lock. ScoreStrategy: repurposed to cell-derived recompute (UNAVAILABLE/NOT_FOUND/clear-then-NOT_FOUND paths; range ignored). `_row_to_score`/hydrate read provenance with pre-007 defaults.
- Files modified: `app/handlers/servicer.py`, `app/repositories/strategy_scores.py`
- TDD: red → green (Step 7).

### Step 7 — test: derivation + trigger coverage [done]
- red: 9 tests failed against the new behavior (old ScoreStrategy grade-from-backtest + :301 per-run upsert). green: 220 passed, coverage 77.70% (≥40), ruff clean.
- Revised `:301` (no per-run headline upsert), `TestScorePersistence` (cell-derived ScoreStrategy path); replaced obsolete `TestScoreStrategy` grade tests with `_score_from_metrics`/`_grade` unit tests. Added: `_aggregate_cells` OQ-1 anchors (W=375→A; 60-day→0.597 C), Σw==0→None, renormalization, non-finite filter, zero-trade drag; triggers (OK run derives from cells not run; UPDATE unconditional pop even when delete raises; UPDATE→recompute no deadlock via wait_for); ScoreStrategy paths (UNAVAILABLE/NOT_FOUND/clear+NOT_FOUND/cells-read-fail no-mutation/success provenance+ledger/range ignored); hydrate provenance + pre-007 defaults; strategy_scores repo new columns + delete SQL.
- Files modified: `tests/test_analysis_servicer.py`, `tests/test_strategy_scores_repo.py`
- Deviations: none. TDD: red → green.

### Step 8 — service: MCP agent caller parity [done]
- `client.run_backtest` now sends `strategy_id_ref=strategy_id` so agent-triggered runs execute the registered definition and earn fingerprinted evidence; unregistered ids now return NOT_FOUND. Updated the `run_backtest` tool docstring + mcp-tools.md runbook.
- Files modified: `services/xstockstrat-agent/app/client.py`, `.../app/tools.py`, `docs/runbooks/mcp-tools.md`
- TDD: red → green (Step 9).

### Step 9 — test: agent parity coverage [done]
- red: `test_run_backtest_sends_strategy_id_ref_for_registered_definition` failed pre-Step-8 (`'' == 'sma'`). green: 54 passed, coverage 61.32% (≥40), ruff clean. Assertion at stub-capture level (constructed RunBacktestRequest), not the wholesale-mocked `test_run_backtest_calls_grpc`.
- Files modified: `services/xstockstrat-agent/tests/test_tools.py`
- Deviations: none (agent has no CI job yet — verified locally; Step 13 wires it). TDD: red → green.
