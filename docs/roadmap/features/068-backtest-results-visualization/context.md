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

## Session 2026-07-21 — sdd-spec

- Generated implementation-spec.md with 12 steps. Status → implementation-ready.
- Key codebase findings (all recon.md anchors re-verified live before writing):
  - Migration number confirmed **008** (`ls services/xstockstrat-analysis/migrations/` →
    007_backtest_run_symbols is last); parent-table + index precedent in `006_backtest_runs.up.sql`.
  - Proto insert points verified free: `BacktestResult` highest field 14 (`analysis.proto:70`),
    `BarDiagnostic` highest 14 (`:120`); single-line request-message precedent
    `GetStrategyReportRequest` at `:198`; CI buf invocation confirmed at
    `.github/workflows/ci.yml:103-120` (`buf lint packages/proto/` + `buf breaking . --against`).
  - **Design refinement (recorded, not silent — P-03)**: design.md said per-bar equity is "wired
    through the single shared builder `_build_bar_diagnostic`", but that builder runs BEFORE the
    simulation loop computes equity (diags are pre-built; the loop mutates `diags[i].action`,
    `servicer.py:737-738,886`). The spec instead stamps `diags[i].equity = daily_equity[i]` in the
    shared finalize pass `_finalize_symbol_diagnostics` (`servicer.py:1516-1530`, called by both
    engine paths after the forced-close patch) — same single-shared-assembly intent (ledger
    insights 2026-07-09), physically possible ordering. Step 4 carries the rationale.
  - `GetBacktest` no-DB path: repo None → abort NOT_FOUND with the single FR-6 message (precedent:
    `ListBacktests` returns empty when repo None, `servicer.py:1255-1256`).
  - UI: `forward()` registration anchor `insightsBff.ts:39`; `useBacktestHistory`/`useStrategyReport`
    hook shapes confirmed in `src/hooks/useStrategies.ts` (NOT_FOUND-aware retry via
    `isNotFoundError`); page seams live at `page.tsx:95-98` (onSuccess), `:103` (result seam),
    `:109-116` (trade-ordinal derivation to delete), `:364-398` (chart block to replace),
    `:429-471` (Past Runs rows); mock backend `AnalysisService` object at `mock-backend.ts:396+`
    with `bt-hist-2`/`bt-hist-1` fixtures; `xstockstrat-ui` scripts confirmed
    (`test:coverage` = vitest, `test:e2e` = playwright, `lint` = next lint).
  - Reviewers snapshot finalized in feature.md: analysis owner, ui owner, Proto Reviewer, DBA.
- Step layout: 1 proto → 2 proto-gen (+frontend build check per ledger trap) → 3 migration 008 →
  4/5 analysis engine capture + tests → 6/7 detail repo/persist/evict/GetBacktest + tests (incl.
  AC-4 parity) → 8/9 UI lib derivation + unit tests → 10/11 UI wiring + e2e → 12 config-key docs
  (C-05).

## Session 2026-07-21 — sdd-execute (start)

- Impl-spec advisory review: PASS WITH WARNINGS (no blockers, no Floor risk). Overlap: CLEAN.
  Executor guidance carried in (not spec edits — F-09): run `buf breaking` from
  `packages/proto` with `subdir=packages/proto` on the against ref; concrete
  `migrate ... down 1` for the Step-3 reversibility check; keep `context.abort(NOT_FOUND)`
  outside the bare `except` in `GetBacktest`; stale `:83-93` anchor in Step 10 evidence noted
  (real anchor `:26-34`).
- **Execution mode deviation (recorded, not silent — P-03)**: steps run as sequential commits
  on the harness-assigned branch `claude/backtest-results-visualization-ljhyyj` (feature-branch
  role, see sdd-story entry), one commit per verified step (F-05), single final PR into
  `main-dev`. Per-step sub-branch PRs are not used: the harness forbids pushing branches other
  than the assigned one. F-02/F-03 honored (no direct push to main-dev/main; the one PR targets
  main-dev as the integration PR of the feature-branch-role branch).
- Environment: no Docker → codegen toolchain provisioned on host per
  `docs/runbooks/codegen-toolchain-host-setup.md`; empty-diff baseline validated before any
  proto edit. Local Postgres 16 (no TimescaleDB ext) provisioned; analysis migrations 001–007
  applied via golang-migrate with the script's `analysis_schema_migrations` tracking-table
  convention (TimescaleDB not needed by analysis migrations).
