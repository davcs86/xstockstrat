# Context: opportunity-live-only-rotation

**Feature**: `docs/roadmap/features/366-opportunity-live-only-rotation/feature.md`
**Product Spec**: `docs/roadmap/features/366-opportunity-live-only-rotation/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/366-opportunity-live-only-rotation/implementation-spec.md`

---

## Session 2026-11-26 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Origin: staging vs homelab staging opportunity comparison (2026-11-25/26). AAPL on homelab got only its watchlist-bound dip_buyer_vol_stop row; squeeze_breakout_trend / fundamentals_macd_blend rows went only to the top 20 live-only symbols (exactly 20 symbols / 40 rows from a ~350 pool).
- OPERATOR DECISIONS (2026-11-26, verbatim choices from the question dialog):
  - Semantics: "Rotate across passes" — each compute evaluates the next chunk of max_live_only_symbols_per_compute symbols from a persisted cursor (chosen over "All chunks, one pass" and "All chunks, budgeted").
  - Scope: "Live-only cap only" — max_live_held_symbols_per_compute out of scope.
  - Process: "SDD: story + design full".
- C-16 CHANGE: this reverses feature 131's rejection of cross-pass carried state for the live-only cap (131 context.md:12) and changes 131's AC-8 rule (live-only cap = truncation). 131's scenarios were archived without promotion to a durable suite, so the rule lives only in 131 context.md and services/xstockstrat-analysis/CLAUDE.md (key table). Operator sign-off is the "Rotate across passes" decision above; design must restate it.
- Raised for design (product-spec Open Questions): coverage latency ≈ ceil(P/N) daily computes (~18 days for P≈350, N=20); carried-row valid_until semantics; rotation order under churn; persistence shape vs replace_for_user; reuse of live_loop's scheduler; no behavioral test pins the current cap.
