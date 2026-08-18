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
