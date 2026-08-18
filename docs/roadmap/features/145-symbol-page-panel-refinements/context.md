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
