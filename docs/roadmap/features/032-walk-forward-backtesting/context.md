# Context: walk-forward-backtesting

**Feature**: `docs/roadmap/features/032-walk-forward-backtesting/feature.md`
**Product Spec**: `docs/roadmap/features/032-walk-forward-backtesting/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/032-walk-forward-backtesting/implementation-spec.md`

---

## Session 2026-05-26T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from brainstorming session.
- Feature number assigned: 032.
- New streaming proto RPC (RunWalkForward) — non-breaking addition to analysis proto.
- No schema changes; reads existing OHLCV and signal tables.
- Key constraint: look-ahead-free guarantee is a correctness requirement, not just best practice. Must be verified in acceptance testing.
- Two open questions deferred to impl-spec: result persistence vs. ephemeral, and SSE/streaming bridge in insights UI.

## Session 2026-08-29 — product-spec rescope (walk-forward → regime-segmented backtest)

- **Trigger**: user asked whether this feature adds value given a live strategy can already be
  tested in **paper mode**. Investigation surfaced a contradiction in the original spec: the
  Problem Statement sold overfitting detection ("how well the strategy would have traded the data
  it was tuned on"), but Out-of-Scope removed parameter optimization, and
  `grep -rilE 'optimi[sz]|grid.?search|param.*(tune|fit|search)|walk.?forward'
  services/xstockstrat-analysis/` returned **nothing** — the platform has no strategy-parameter
  optimizer. With no in-sample fitting, "walk-forward" was really a rolling/segmented backtest.
- **Rescope**: rewrote product-spec.md as **regime-segmented backtest** — dropped the
  in-sample/out-of-sample framing (meaningless without an optimizer), reframed the value as
  *regime-consistency* (per-window + aggregate stats: mean/worst-window Sharpe, consistency ratio,
  Sharpe dispersion), and recorded true walk-forward as a **Future Extension gated on an optimizer**
  (build no in-sample plumbing now — CLAUDE.md "How to Act" #2, no dead scaffolding).
- **Honest value vs. what already exists**: single backtest = one aggregate history number; paper
  mode = real forward, one regime, slow. This fills the remaining gap: fast, multi-regime
  consistency breakdown. Genuine but **incremental** — re-ranked down from the earlier #1 slot
  (that ranking predated weighing paper-mode's existence).
- Proto/config names updated in spec: `RunSegmentedBacktest` RPC,
  `analysis.segmentedbacktest.max_total_window_days` config key (was `RunWalkForward` /
  `analysis.walkforward.*`). Slug/dir unchanged (`032-walk-forward-backtesting`).
- No design/spec/code exists yet (still `draft`); this is a pre-design product-spec correction, so
  no downstream artifacts to revise.
- Status unchanged: `draft`.
