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
