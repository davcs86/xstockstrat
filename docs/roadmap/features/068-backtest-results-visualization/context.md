# Context: backtest-results-visualization

**Feature**: `docs/roadmap/features/068-backtest-results-visualization/feature.md`
**Product Spec**: `docs/roadmap/features/068-backtest-results-visualization/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/068-backtest-results-visualization/implementation-spec.md`

---

## Session 2026-07-21 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Working branch note: this session runs on the harness-assigned branch
  `claude/backtest-results-visualization-ljhyyj` (re-based onto `origin/main-dev` per root
  CLAUDE.md § Harness Default Branch); it plays the role of the feature branch for this feature
  and PRs into `main-dev`.
- Grounding findings from codebase recon (pre-story):
  - `ListBacktests` (analysis proto) persists **summary rows only**; proto comment confirms
    "the full trades/diagnostics live only on the latest in-memory result".
  - Strategy detail page (`services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx`)
    already renders metrics grid, a trade-ordinal equity curve (trades only, x-axis = trade #),
    `BacktestDiagnostics`, and a read-only Past Runs table — rows are not openable.
  - Relevant ledger fails noted in product-spec Open Questions: C-10(a) nav reachability,
    C-10(b) multi-path parity, C-10(d) exhaustive TS enum maps.

## Session 2026-07-21 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: none (initial round FAILed on unchecked Open Questions; resolved in-spec:
  full detail incl. diagnostics persisted; retention = 20 runs/strategy count-based,
  eviction never trims `backtest_runs` summaries; migration pre-assigned `008_*`;
  config default 20 declared).
- Overlap findings: CLEAN. Constraints recorded: migration number must be `008` (065's
  `007_backtest_run_symbols` is on the baseline); reuse `BacktestDiagnostics.tsx` (067);
  no merge-order row needed.
- Reviewer note carried to design: `INSUFFICIENT_DATA` runs get no persisted detail
  (permanent FR-6 state) — confirm intentional at design.

## Session 2026-07-21 — sdd-design

- Phase 0 Recon: wrote recon.md (services: analysis, ui, proto; key reuse patterns:
  `_persist_backtest_run` best-effort wrapper + `backtest_runs.py` repo shape; BFF `forward()`
  + `useBacktestHistory` hook shape; `_build_bar_diagnostic` single builder).
- Phase 1 Grilling: 1 round (quick). Chosen approach: persist OK runs' full `BacktestResult`
  as serialized-proto BYTEA in `analysis.backtest_details` (migration 008, FK→backtest_runs,
  explicit completed_at, insert-time eviction clamped ≥1); additive proto
  `GetBacktest` RPC + `BacktestResult.initial_capital=15` + `BarDiagnostic.equity=15`;
  DB-only read path; in-page historical view reusing the single result seam; per-symbol
  time-aligned equity curve (normalized % default for multi-symbol) with nearest-bar trade
  markers; `src/lib/equityCurve.ts` + `src/lib/protoTime.ts`. Rejected: memory-first read,
  JSONB, normalized rows, no-FK table, new route, trades-cumulative fallback, aggregate curve,
  summary-sourced metrics grid (full list in design.md).
- Adversary objections: 12 raised, all accepted with fixes folded into design.md (notably
  DB-only reads killing 3 staleness/collision bugs; FK for existence parity; normalized
  multi-symbol rendering; seam-clear on fresh run). Objection 12c (no-detail rows show empty
  state only, no summary-sourced grid) decided in favor of AC-5 single render path — P-03
  recorded here rather than silently assumed.
- Constitution rules touched: C-01, C-04, C-05, C-07, C-08, C-09, C-10(a/b), P-03, P-06,
  F-01, F-06, F-07. Floor breaches: none.
- Approval: standing authorization — the initiating user instruction directed the full SDD
  pipeline through implementation in this autonomous session (recorded per P-04/C-11).
- Status: spec-ready → design-approved.

### Open Threads

- BYTEA↔proto wire-compat coupling — guard at proto step (buf breaking note). Target: step 1.
- Insert+evict not transactional (≤1 extra row transiently) — re-check at analysis step.
- No "has detail" flag on `BacktestRunSummary` (discover-on-open UX) — post-launch only.
