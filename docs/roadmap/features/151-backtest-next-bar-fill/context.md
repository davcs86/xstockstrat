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
