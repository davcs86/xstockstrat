# Context: symbol-page-panel-refinements

**Feature**: `docs/roadmap/features/145-symbol-page-panel-refinements/feature.md`
**Product Spec**: `docs/roadmap/features/145-symbol-page-panel-refinements/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/145-symbol-page-panel-refinements/implementation-spec.md`

---

## Session 2026-08-18 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from an operator UI-refinement request.
- Predecessor: feature 139 (`symbol-page-section-nav`) built the Overview/Trade/Research/Analysis
  section-nav + `SymbolPanelGroup` (desktop columns / mobile tabbed) this feature reuses.
- Product decisions captured up front from the user (recorded so design/spec don't re-litigate):
  - **Manage + Broker panels → remove both** (Manage links all point to generic `/trader?symbol=`,
    duplicating the Place order panel; Broker's account id/link are already elsewhere).
  - **Fundamentals → always-on** for any symbol (was wrongly watchlist-gated).
  - **Strategy resolution**: `?strategy=` query → watchlist binding → user **picker** (active +
    `liveEnabled` only). Orders-derived `owningStrategy` **dropped**. Default **empty until picked**.
    Picker shown **in each panel header** (Indicators/Backtests/Why-this-fired), synced.
  - **Opportunities** stacked cards → **one tabbed panel group** (one card per strategy). Confirmed
    not a bug — AMZN is evaluated by 3 live strategies.
- Root cause found while scoping: `?strategy=` was already read only by `SignalReadiness` (line 34),
  never by Backtests/Indicators, which resolved via `boundStrategyId || owningStrategy` — the source
  of the "No strategy resolves for AMZN" dead-end despite the URL seed.
- Known trap flagged (fails.md Breadcrumb entry): three synced pickers with the same
  `aria-label="Strategy"` will make `getByLabel('Strategy')` ambiguous — must disambiguate + grep the
  e2e suite before closing the step.
- Harness branch constraint: implement on `claude/symbol-page-ui-refinements-t2xp26`, single PR to
  `main-dev` (no per-step feature-step branches).

## Session 2026-08-18 — sdd-design

- Phase 0 Recon: wrote recon.md (service: xstockstrat-ui; reuse patterns: `SignalReadiness` picker +
  `liveEnabled` filter, `SymbolPanelGroup`, `history.replaceState` query/hash preservation).
- Phase 1 Grilling: 1 round (quick). Proposer proposed lifted `selectedStrategyId` + `StrategyPicker`;
  adversary returned NEEDS WORK (no Floor breach) with valid objections, all adopted.
- **Decisions (design.md):**
  - Strategy selection is a **pure derivation** `effective = picked ?? url ?? bound ?? ''` — NOT an
    effect+seededRef (race/flash-free; matches user precedence query→binding→empty).
  - `owningStrategy` **dropped as a resolution source only**; kept as a display value (Position
    subtitle `page.tsx:612` + "Why it's held"). Enumerated all refs so none stranded (adversary count-claim catch).
  - **"Why it's held" KEPT as a Trade-section panel** (user decision at the design gate; not scope-crept away).
  - `StrategyPicker` lives in `components/insights/` (coupled to insights `analysisClient`), not `shared/`.
  - Distinct picker aria-labels ("Strategy for Indicators/Backtests/Why this fired") + update
    `position-detail.spec.ts:315`; page-level `useSearchParams` inside a Suspense boundary (Next 15).
  - Research: all opportunities → one `SymbolPanelGroup`; Fundamentals always-on.
  - Trade: Position + Risk & exit + Why it's held as panels; Manage + Broker removed; 2-col grid dropped.
  - Tests: new multi-opportunity fixture + INVENTORY row (C-12); RED tests for AC-5 (sync) + AC-6
    (`?strategy=` seed); full-suite `getByLabel` collision grep before close.
- Constitution rules touched: C-10, C-12/C-13, C-14, P-03, P-06. Floor breaches: none.
- Status: draft → design-approved.

## Open Threads

- **R1** — `getByLabel`/`getByRole` collision can surface on a *different* spec; grep full e2e suite +
  broad run before closing the strategy-picker step (fails.md 2026-08-09).
- **R2** — verify no CSR-bailout warning from the page-level `useSearchParams` (Suspense placement) in `pnpm build`.
- **R3** — confirm every `owningStrategy` ref disposition when dropping it as a resolution source (Trade-section step).

## Session 2026-08-18 — sdd-spec

- Generated implementation-spec.md with 3 steps (aligned to design's advisory step boundaries). Status → implementation-ready.
- UI-only (`xstockstrat-ui` `/trader`): no proto/config/DB/backend step; C-14 surface = existing `/trader/positions/[symbol]` (no new route, no `PLATFORM_SUBNAV`). Next.js has no CI coverage threshold, so no separate coverage `test` step — each `service` step carries RED-first Playwright e2e (P-06).
- Key codebase findings verified against the tree:
  - Strategy-list source to reuse is `SignalReadiness.tsx:28,32` (`useStrategyDefinitions()` default `includeInactive=false` per `useStrategyDefinitions.ts:17`, then `.definitions.filter(liveEnabled)`); `Select`+`aria-label` pattern at `SignalReadiness.tsx:67-78`. New `StrategyPicker.tsx` co-located in `components/insights/`.
  - `owningStrategy` resolution passes are `page.tsx:304` (Backtests) and `:360` (Indicators); display uses to keep are subtitle `:612` + "Why it's held" `:729-748` (both inside `PositionBody`, refactored in Step 3).
  - `CardTitle` renders `<h3>` (`ui/card.tsx:36`), so `getByRole('heading')` targets card titles (already used at spec `:113,133,146`).
  - Multi-opportunity FR-1 is untestable on the current mock (one opp row per symbol, `opportunities.ts` + `mock-backend.ts:617`): Step 2 adds AMZN rows (two liveEnabled strategies `strat-live-001`/`strat-001`) + INVENTORY row (C-12).
  - `SymbolPanelGroup` gives each panel `label` a `role="radio"` mobile tab once ≥2 panels — so making "Risk & exit" its own Trade panel (Step 3) creates a 2nd "Risk & exit" DOM occurrence that breaks unscoped `getByText('Risk & exit')` at spec `:29,66,132`; Step 3 rescopes them. Trade-panels membership assert at `:482-483` also updated.
  - Watchlist-binding pre-selection flips the premise of readiness tests `:292-303,305-319` (they bind AAPL then assert the empty prompt) — Step 1 rebinds them to an empty strategy so the prompt still asserts; `:315` accessible name → "Strategy for Why this fired".
- Open Threads mapped to steps: **R1** (full-suite `getByLabel`/`getByRole('combobox')` collision grep + broad `pnpm test:e2e`) and **R2** (page-level `useSearchParams` inside a `Suspense` boundary; verify `pnpm build` has no CSR-bailout) both discharge in **Step 1**; **R3** (`owningStrategy` display uses not stranded) is enforced in **Steps 1 and 3** via `grep -n "owningStrategy"`. Details in the `## Open Threads` block above.

## Session 2026-08-18 — implementation (direct on harness branch)

- Implemented all 3 steps on `claude/symbol-page-ui-refinements-t2xp26` (single-PR harness flow).
- **New**: `src/components/insights/StrategyPicker.tsx` (shared liveEnabled picker).
- **page.tsx**: `PositionDetailInner` under a `Suspense` boundary (R2); page-level `pickedStrategyId`
  + derived `effectiveStrategyId = picked ?? url ?? bound ?? ''` + `handleStrategyChange` (state +
  `?strategy=` URL mirror); pickers wired into Indicators/Backtests/(controlled)SignalReadiness
  headers with distinct aria-labels; opportunities → one `SymbolPanelGroup`; Fundamentals always-on;
  `PositionBody` split into `PositionPanel`/`RiskExitPanel`/`WhyHeldPanel`; Manage + Broker + 2-col
  grid removed; `owningStrategy` kept display-only (subtitle + Why-it's-held).
- **SignalReadiness.tsx**: now controlled (`strategyId`/`onStrategyChange` props); internal
  `useSearchParams`/`useState` picker removed; renders shared `StrategyPicker`.
- **Tests**: AMZN multi-opportunity fixture + INVENTORY row (C-12); e2e updates — Risk & exit →
  `getByRole('heading')` (panel-tab collision), readiness prompt tests rebind empty strategy, picker
  label → "Strategy for Why this fired", Trade-panels membership → 5 panels; new AC-1/AC-4/AC-5/AC-6.
- **Verification**: `tsc --noEmit` clean; `pnpm lint` clean (pre-existing warnings only); `pnpm build`
  clean — no `useSearchParams` CSR-bailout (R2 discharged); `pnpm exec playwright test e2e/trader`
  → 102 passed (2 pre-existing timing flakes passed on retry, both in untouched specs). R1 sweep:
  no unscoped `getByLabel('Strategy')`/`getByRole('combobox')` collision on the symbol page.
- Status: implementation-ready → code-completed.

## Session 2026-08-19 (CI: feature status automation)

- Promotion PR #985 merged to main
- Feature promoted and committed: 6cd5572193b09a153c24e4cb90e3b65708846981
- Status updated: `code-completed` → `launched`
- Launched date: 2026-08-19
