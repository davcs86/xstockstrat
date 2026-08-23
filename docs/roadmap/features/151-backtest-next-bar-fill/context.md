# Context: backtest-next-bar-fill

**Feature**: `docs/roadmap/features/151-backtest-next-bar-fill/feature.md`
**Product Spec**: `docs/roadmap/features/151-backtest-next-bar-fill/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/151-backtest-next-bar-fill/implementation-spec.md`

---

## Session 2026-08-23 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the
  metrics-sweep audit finding #3 (`_tasks/x-backtest-metrics-audit.md` Q1).
- Root evidence: both simulators fill at the current bar's close ± slippage —
  `services/xstockstrat-analysis/app/handlers/servicer.py:966-967,1005-1020` (`_backtest_symbol`) and
  `:1174-1175,1190-1208` (`_backtest_symbol_evaluated`); the decision for bar i is evaluated from bar
  i's own series, so filling at bar i's close is a mild look-ahead.
- Operator decision this session: **story + design only** — stop before /sdd-spec and /sdd-execute.
- Orthogonal to feature 150 (sizing): fill model and sizing mode are independent request params;
  cross-feature coordination noted for proto field numbers (150 `sizing_mode=8`, this `fill_model=9`)
  and migration numbers (whichever lands first takes 017).
- Known traps: ledger 067 (proto enum ↔ UI exhaustive `Record` map coupling); alignment invariant
  `daily_equity[j]↔diags[j]` (`servicer.py:3275-3296`, feature 071) must be preserved; analysis review
  focus = no look-ahead bias.
- Development branch note: rides `claude/xstockstrat-metrics-sweep-m070rf` this session per the binding
  branch constraint.

## Session 2026-08-23 — sdd-design

- Phase 0 Recon: recon.md written from the shared analysis/agent/ui/scenario recon (fill sites, the
  daily_equity↔diags 1:1 invariant, cross-feature coordination with 150).
- Phase 1 Grilling: 7 rounds (full; user raised the cap 5→7). Chosen approach: opt-in FillModel enum;
  deferred execution via ONE shared _apply_fill state machine that RETURNS the fill-bar action and
  never writes diags (loop is sole diags.action writer); allow n-2→n-1.open fill, drop only
  absolute-last-bar; fill-to-fill cooldown; effective fill_model resolved once at RunBacktest entry
  and persisted/echoed; mandated byte-for-byte golden test over BOTH simulators with real protos.
- Rejected: price-only resolver (look-ahead), suppress-last-bar-entry (breaks cross-mode symmetry),
  signal-to-signal cooldown (default), in-place diag mutation (clobber hazard), stamp-signal-conviction
  (invasive for a display-only gain).
- Constitution rules touched: C-04, C-05/F-07, C-07, C-08/P-06, C-09, C-10/C-14, C-16, F-01. Floor
  breaches: none at any round. Terminal verdict (round 7): APPROVABLE.
- Field/migration coordination with 150 recorded in merge-order.md (151: request 9, result 20,
  summary 18, migration 018; re-derived at spec time; whichever lands second renumbers migration).
- Open risks / /sdd-spec confirm-items: diagnostic action/conviction decouple (display-only, doc+AC);
  cooldown reference-bar (pin fill-bar); pending applied above the warm-up continue; config zero-trap
  rationale; migration re-derivation.
- Status: draft → design-approved. Operator decision: stop before /sdd-spec this session.

## Session 2026-08-23 — sdd-spec

- Generated implementation-spec.md with 10 steps. Status → implementation-ready.
- Key codebase findings (re-derived from the merged tree, not recon alone):
  - **Neither 150 nor 151 is merged.** `analysis.proto` on trunk: `RunBacktestRequest` fields 1–7
    (`:52-62`), `BacktestResult` 1–16 (`:84-107`), `BacktestRunSummary` 1–16 (`:203-221`). Latest
    analysis migration on disk is `016`. Feature 150 is `implementation-ready` and its spec claims
    exactly the reserved lower split (`sizing_mode=8`, result 17/18/19, summary 17, migration 017).
    151 therefore takes the reserved higher split: `RunBacktestRequest.fill_model=9`,
    `BacktestResult.fill_model=20`, `BacktestRunSummary.fill_model=18`, migration **018** (per
    merge-order.md 150↔151). Proto split is order-independent; migration NNN is order-sensitive
    (golang-migrate won't backfill a lower version) — if 151 lands first, renumber to 017 and 150 to
    018. Re-derive at execute time.
  - Both simulators confirmed at recon line numbers: `_backtest_symbol` `:845` (loop-writer of
    `diags.action` `:1046`, single `daily_equity.append` `:1048`, warm-up `continue` `:970-972,979-981`,
    forced close `:1050-1075`); `_backtest_symbol_evaluated` `:1080` (writer `:1234`, append `:1235`,
    cooldown clocks off `bar.time` `:1187,1196,1203,1231`, forced close `:1237-1261`). Fill sites all
    use `bar.close` today (`:967,1006,1019,1053,1175,1190,1208,1240`).
  - Alignment assert `_finalize_symbol_diagnostics` `:3291` (`n == len(daily_equity)`), stamps at
    `:3295-3296`. Grade blend `_score_from_metrics` `:3310-3336` reads only sharpe/drawdown/win_rate
    (conviction never read → action/conviction decouple is display-only).
  - Effective-model resolution mirrors commission/slippage at `:383-384`; config via `get_int`
    (`watcher.py:95-101`) — zero-trap is INTENTIONAL for `analysis.backtest.default_fill_model`
    (absent and `0` both → UNSPECIFIED → legacy).
  - Persist path: `_persist_backtest_run` `:1558-1577` → `BacktestRunsRepository.insert`
    (`backtest_runs.py:25-68`); row→summary map `_row_to_backtest_summary` `:3428-3446` (reuse the
    `status` name→enum pattern for `fill_model`).
  - Agent: `client.run_backtest` `:503-565`, tool `tools.py:456-524`, summary `backtest_view.py`
    (`_HEAD_KEYS` `:35`); MessageToDict passes new fields through automatically; tool count stays 28.
  - UI: results `page.tsx:508-538`, Past Runs `pastRunsColumns` `:124`; exhaustive-Record precedent
    `BacktestDiagnostics.tsx:10-28` (ledger 067); fixtures `e2e/fixtures/backtests.ts`.
- Design confirm-items pinned: cooldown → fill-bar; config zero-trap → get_int intentional;
  pending-above-warm-up invariant; action/conviction decouple documented (skill + code comment).
- **Acceptance gap flagged**: `acceptance.feature` has only AC-1..AC-6; design.md references
  AC-7/8/9 (cooldown/config/decouple) that were never authored. Spec covers AC-1..AC-6 and asserts
  the three extra behaviors in the Step 5 test body without an @AC tag. If they need first-class
  scenarios, that is a /sdd-story or /sdd-review touch on acceptance.feature (append-only, C-15) —
  not editable by /sdd-spec.

## Session 2026-08-23 — sdd-review impl-spec (advisory)

- Result: 0 failures, 3 warnings + notes (PASS WITH WARNINGS; no Floor breach). Overlap: numbers CLEAN.
- Items addressed in-spec this session:
  - Step 1 buf breaking baseline was the feature branch — [x] fixed: now `--against main-dev` (merge
    target), re-derive merge base at execute time.
  - Acceptance/spec consistency (AC-7..AC-11 appended after spec gen) — [x] already reconciled earlier
    this session: coverage map + Step 5 Covers cite AC-1..AC-11; reviewer confirmed C-15 holds.
- Accepted as-is (advisory, no change):
  - Directory-valued **Files** on Steps 2/5/10 (`packages/proto/gen/**`, `tests/`, `e2e/insights/`) —
    inherent to codegen/test steps; reviewer flagged as acceptable. [x] acknowledged; executor names
    the concrete module at write time.
  - B2b trading-domain checks N/A (backtest simulation fill timing/price, not broker order-fill
    status); user_id column already in backtest_runs.insert signature — informational only.
- Overlap (feature-overlap agent): fill_model request=9 / result=20 / summary=18 / migration 018 all
  CLEAN vs 150 and trunk. Same merge-order.md 150↔151 row ENHANCED with the same-function overlaps.[x]
- Carried into /sdd-execute (no unaddressed ✗): the same-function merge burden with 150 (whichever
  lands second reconciles servicer.py/backtest_runs.py/backtest_view.py manually + re-runs buf-gen).

## Session 2026-08-23 — sdd-execute (on claude/xstockstrat-metrics-sweep-m070rf)

Branch deviation (C-06): executed on the session's designated harness branch, landing in PR #1004
alongside feature 150 (which merged its proto/migration first, so 151 keeps the reserved split).

### Step 1 — proto: FillModel enum + fill_model fields [done]
- Added FillModel enum (UNSPECIFIED/SAME_BAR_CLOSE/NEXT_BAR_OPEN), RunBacktestRequest.fill_model=9,
  BacktestResult.fill_model=20, BacktestRunSummary.fill_model=18 (reserved split honored — 150 took
  8/17/18/19). Additive only. Verify: buf lint clean; buf breaking vs origin/main-dev clean.
### Step 2 — proto-gen: regenerate stubs [done]
- ./scripts/buf-gen.sh; 8 gen files changed; idempotent re-run leaves no further diff.
### Step 3 — migration 018 fill_model column [done]
- Additive nullable fill_model TEXT; up/down reverse-verified offline (no DB). NNN=018 (150 took 017).
### Step 4 — service: shared _apply_fill deferred state machine + routing + persist [done]
- Added SimState + _PendingFill + _set_pending + _apply_fill (module-level). Both simulators
  (_backtest_symbol, _backtest_symbol_evaluated) refactored to the deferred-execution machine:
  detect→_set_pending, then _apply_fill executes a due pending (same-bar: fill_idx=i executes same
  iteration; next-bar: fill_idx=i+1 executes next iteration; the (A) top call runs before the SMA
  warm-up continue so a deferral is never skipped). The loop stays sole writer of diags.action + sole
  appender to daily_equity (071 1:1 invariant intact). Cooldown pinned to fill-bar time inside
  _apply_fill (byte-identical legacy in same-bar). SMA path passes 0/0 cooldowns (it has none).
- RunBacktest resolves effective_fill_model once (request > config default_fill_model > legacy;
  get_int zero-trap intentional), threads it into both simulators, sets result.fill_model, persists
  via _persist_backtest_run (reads result.fill_model → FillModel.Name). Repo insert + column
  fill_model ($20); _row_to_backtest_summary maps it (null → UNSPECIFIED).
- Config key analysis.backtest.default_fill_model (int 0=legacy) declared in service CLAUDE.md +
  a "Backtest Fill Model (feature 151)" prose subsection (last-bar rule, fill-to-fill cooldown,
  display-only action/conviction decouple).
- v1 scope note: fill_model governs the per-symbol serial simulators (per-symbol curves/cells +
  legacy aggregate). _simulate_portfolio (feature 150) still fills intents at close; a portfolio ×
  next-bar run honors next-bar in the per-symbol cells but same-bar in the portfolio curve —
  acceptable v1 limitation (151 spec scopes the serial simulators).
- Byte-for-byte: all 558 pre-existing tests stay green after the refactor. §B header propagation N/A.
- Files: app/handlers/servicer.py, app/repositories/backtest_runs.py, CLAUDE.md
### Step 5 — test: engine golden parity + next-bar behavior + alignment [done]
- New tests/test_fill_model.py: @AC-1 (entry next-bar open), @AC-2 (exit next-bar open), @AC-3
  (last-bar no-fill/no-look-ahead), @AC-4 (unset≡explicit SAME byte-for-byte, both simulators; next-bar
  teeth), @AC-5/@AC-9/@AC-10 (RunBacktest resolve+record+return+persist, config default routing,
  request override, summary map), @AC-6/@AC-11 (ENTER on fill bar, daily_equity 1:1, conviction
  decouple), @AC-7 (n-2 symmetry), @AC-8 (fill-to-fill exit cooldown). C-13: Bar/decision literals
  single-consumer → inline.
- Verify: ruff clean; 571 tests pass; coverage 82.95% (≥40). TDD: red-before-green.
- Files: tests/test_fill_model.py
### Step 6 — service: agent run_backtest fill_model arg + surfacing [done]
- client.run_backtest gained fill_model (next_bar_open→NEXT, same_bar_close/legacy→SAME, None→unset);
  tools.py run_backtest threads it + documents the decouple; backtest_view adds fill_model to
  _HEAD_KEYS (inline, always reaches caller); CLAUDE.md run_backtest row updated. §B N/A.
- Files: app/client.py, app/tools.py, app/backtest_view.py, CLAUDE.md
### Step 7 — test: agent fill_model + summary [done]
- test_client: fill_model next_bar/legacy/unset → req.fill_model; test_tools: passthrough+surfacing +
  assert_called_once_with fill_model=None; test_backtest_view: fixture fill_model + summarize test
  (descriptor-parity auto-balances since fill_model is in _HEAD_KEYS). 277 tests pass, cov 78.2%.
- Files: tests/test_client.py, tests/test_tools.py, tests/test_backtest_view.py
### Step 8 — docs: strat-lab backtest skill [done]
- SKILL.md Phase 2 "Fill model" note (same-bar-close vs next-bar-open, not-comparable, decouple);
  reference/verification.md notes the oracle must fill at bars[i+1].open for a next-bar run.
- Files: plugins/strat-lab/skills/backtest/SKILL.md, reference/verification.md
### Step 9 — service: UI fill-model label + Past Runs column + enum map [done]
- BacktestDiagnostics.tsx: exhaustive FILL_MODEL_LABEL: Record<FillModel,string> (ledger 067).
  page.tsx: fill-model Badge on the results surface (beside the sizing-mode badge), "Fill model"
  column in pastRunsColumns. BFF/hooks unchanged.
- Verify: pnpm lint clean; tsc --noEmit exit 0.
- Files: BacktestDiagnostics.tsx, strategies/[id]/page.tsx
### Step 10 — test: UI fill-model e2e [done]
- e2e/fixtures/backtests.ts: FILL_MODEL_{SAME_BAR_CLOSE,NEXT_BAR_OPEN}; INVENTORY.md row. mock:
  HIST_RUN_METRICS/DETAIL fillModel (bt-hist-2 next-bar, bt-hist-1 legacy), runBacktest echoes
  req.fillModel. New e2e/insights/backtest-fill-model.spec.ts asserts the Fill model column + badge.
- Verify: backtest-fill-model 2/2 + backtest-sizing 3/3 + backtest-coverage 11/11 pass (single-worker).
- Files: e2e/fixtures/backtests.ts, e2e/fixtures/INVENTORY.md, e2e/mock-backend.ts,
  e2e/insights/backtest-fill-model.spec.ts

## Session 2026-08-23 — feature 151 code-completed
All 10 steps done on claude/xstockstrat-metrics-sweep-m070rf → PR #1004. status.md → code-completed.
