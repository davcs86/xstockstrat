# Context: sparkline-ohlc-replacement

**Feature**: `docs/roadmap/features/188-sparkline-ohlc-replacement/feature.md`
**Product Spec**: `docs/roadmap/features/188-sparkline-ohlc-replacement/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/188-sparkline-ohlc-replacement/implementation-spec.md`

---

## Session 2026-09-11T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Scope: UI-only change — replace sparkline bar chart with OHLC text on two pages. No proto, no backend, no config, no migration.
- Data already available: `useSparklines` fetches `getBars(TIMEFRAME_1DAY, pageSize: 20)` — the `Bar` response carries `open`, `high`, `low`, `close`, `time`. Currently only `close` is mapped to `SparklinePoint`; the hook return type needs to expose the full bar.
- Known trap surfaced from ledger: `fails.md:1463` (oklch canvas rejection) — not applicable here since we're moving FROM a visual component TO plain text, but noted as context.
- `FormulaRunResult.tsx` also imports `Sparkline` — component must be retained; only the two opportunity-page call sites are removed.
  - **Corrected by recon (Phase 0)**: FormulaRunResult.tsx defines a LOCAL `Sparkline` function using recharts `LineChart` at line 14. It does NOT import the shared `Sparkline.tsx`. The shared component CAN be deleted.

## Session 2026-09-11 — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-ui; key reuse patterns: fmtUsd, useQueries batch, progressive-enhancement guard).
- Phase 1 Grilling: 2 rounds (quick). Chosen approach: refactor useSparklines→useOhlcBars in-place (pageSize:2, skip-today guard, UTC dates), new OhlcBlock component, delete shared Sparkline.tsx. Rejected: keep pageSize:20, Intl.DateTimeFormat cached instance, fmtShortDate in money.ts, OhlcData type in component file.
- Constitution rules touched: C-14, C-15, C-16, C-17, P-03, F-04. Floor breaches: none.
- **C-16 sign-off**: user approved superseding @AC-3 (sparkline rendering) and @AC-4 (warm-up gap) from feature 095's `opportunity-live-market-enrichment.feature`. New guarantees: OHLC text block replaces sparkline; OHLC absent when bars unavailable (FR-4).
- AC-5 rewritten to reflect factual finding: shared Sparkline.tsx deleted (FormulaRunResult uses local function).
- Status: draft → design-approved.

## Decisions

- **pageSize: 2** (down from 20) — OHLC needs only 1–2 bars; YAGNI.
- **UTC everywhere** — skip-today guard and fmtShortDate both use UTC to match UTC-midnight bar timestamps.
- **OhlcData type in hook file** — avoids inverted dependency from component → hook.
- **fmtShortDate in protoTime.ts** — coheres with timestampToDate/timestampToMillis.
- **Enrichment guard-condition** — `sparklinePoints && sparklinePoints.length > 0` → `ohlcData !== undefined`.
- **Keep CAPR_SPARKLINE fixture** — populates Opportunity.sparkline proto field (different data path from getBars hook).

## Session 2026-09-11 — sdd-spec

- Phase 2: wrote implementation-spec.md (8 steps, all `xstockstrat-ui`).
- Step structure: pure utilities first (protoTime.ts), vitest unit tests, hook refactor, new component, two page swaps, Sparkline deletion, E2E updates.
- Key spec decisions:
  - `selectOhlcBar` extracted as a pure function in `protoTime.ts` (within vitest `src/lib/**` coverage scope) with an injectable `now` parameter for deterministic testing.
  - `OhlcData` type defined in `protoTime.ts`, re-exported from `useOhlcBars.ts` — avoids inverted dependency while keeping the hook as the consumer-facing import path.
  - Mock-backend CAPR getBars reduced from 20 bars to 2, with distinct OHLC values (the old mock had identical O/H/L/C = close, which would make OHLC assertions vacuous).
  - `CAPR_SPARKLINE` fixture in `e2e/fixtures/opportunities.ts` retained — it populates the proto `Opportunity.sparkline` field 17, a different data path from getBars.
  - TestIds renamed: `opp-sparkline-*` → `opp-ohlc-*`, `detail-sparkline` → `detail-ohlc`.
- Reviewers: `xstockstrat-ui` service owner (all 8 steps).
- Status: design-approved → implementation-ready.

## Open Threads

- [ ] Bar ordering assumption (ascending) — verify at implementation time against actual getBars response. Target: Step 3 (useOhlcBars).
- [ ] Skip-today UTC edge case — unit test with vitest. Target: Step 2.
- [ ] SparklinePoint proto orphaning — Opportunity.sparkline field 17 still in analysis.proto. Separate proto cleanup PR.

## Session 2026-09-26 — status drift reconciliation

- **Discovered drift:** status.md read `implementation-ready` (impl-spec 0/8 done) despite the full
  implementation having shipped on 2026-09-11 via `#1136` (an ancestor of both `origin/main-dev` and
  `origin/main`). CI's post-promotion status auto-update never ran for this feature.
- **Ground-truth verification (origin/main-dev HEAD):** confirmed all 8 steps' artifacts present:
  `src/components/shared/OhlcBlock.tsx`, `src/hooks/useOhlcBars.ts`, `selectOhlcBar` + `fmtShortDate`
  in `src/lib/protoTime.ts`; `src/components/shared/Sparkline.tsx` deleted (terminal step); mobile
  OHLC parity (AC-6/FR-6) and E2E OHLC assertions (`opp-ohlc-*`, `mobile-ohlc-*`) landed.
- **Promotion trail:** merged to main-dev `36fff5de` (#1136), promoted to main via `aab3fa8d` (#1137)
  on 2026-09-11.
- **Reconciliation applied:** status.md → `launched`; impl-spec all 8 steps + header → `done`;
  feature.md tracking fields (`Committed to main`, `Launched date`) and Status History rows added.
  No code touched — docs-only correction of a missed CI bookkeeping step.
