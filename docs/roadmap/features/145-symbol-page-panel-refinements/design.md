# Design: symbol-page-panel-refinements

**Status**: design-approved · **Rounds**: 1 (quick mode) · **Termination**: user-approved after the
mandated adversarial round (no Floor breach).

## Chosen Approach

All changes are in `xstockstrat-ui` `/trader` (no proto/config/DB/backend). Reuse feature 139's
`SymbolPanelGroup` (desktop columns / mobile tabbed, all panels mounted; `SymbolPanelGroup.tsx:27-78`)
and the exact strategy-list pattern from `SignalReadiness.tsx:32,67-78`.

### 1. Single strategy selection — derived, not seeded (FR-6/7/8)

- One page state `pickedStrategyId` (default `undefined`). The **effective** strategy is a pure
  derivation, no effect / no `seededRef`:
  `effectiveStrategyId = pickedStrategyId ?? urlStrategy ?? boundStrategyId ?? ''`
  where `urlStrategy = useSearchParams().get('strategy') ?? ''` and `boundStrategyId` is the existing
  watchlist-binding read (`page.tsx:127-141`). This implements the user's precedence exactly
  (`?strategy=` → watchlist binding → empty-until-picked) and is race/flash-free — when `boundStrategyId`
  resolves after watchlists load, `effectiveStrategyId` recomputes with no wrong-state flash (adversary
  objection on the effect-based seed, adopted).
- `owningStrategy` (`page.tsx:86-92`) is **dropped as a resolution source** (removed from the
  `strategyId={boundStrategyId || owningStrategy}` passes at `page.tsx:304,360`) but **kept as a
  computed display value** for the Position header subtitle "· owned by X" (`page.tsx:612`) and the
  "Why it's held" panel — enumerated disposition of every `owningStrategy` ref (`:86,243,304,360,571,575,612,729,738,743,744`):
  resolution passes removed; display uses retained.
- New component `services/xstockstrat-ui/src/components/insights/StrategyPicker.tsx` (co-located with
  `SignalReadiness`, which shares its `analysisClient`-coupled `useStrategyDefinitions` — **not**
  segment-agnostic `components/shared/`; adversary layering objection, adopted). Props:
  `{ value, onChange, ariaLabel }`. Encapsulates `useStrategyDefinitions(false)` →
  `.filter((s) => s.liveEnabled)` → `Select` of `<SelectItem value={s.strategyId}>{s.displayName || s.strategyId}</SelectItem>`.
- Rendered in the card headers of `IndicatorSection`, `BacktestsSection`, and (controlled)
  `SignalReadiness`, on **every** render branch incl. the empty/no-strategy state (the current empty
  branches `page.tsx:912-926,1041-1056` are reshaped to a stable Card+header carrying the picker, else
  the user can never pick from the default-empty state).
- **Distinct accessible names** — `"Strategy for Indicators"` / `"Strategy for Backtests"` /
  `"Strategy for Why this fired"` — so the three synced pickers don't collide on `getByLabel('Strategy')`
  (`position-detail.spec.ts:315`, the fails.md 2026-08-09 Breadcrumb trap). The spec's `:315` locator is
  updated to the readiness-specific name.
- `onChange` sets `pickedStrategyId` **and** mirrors to the URL: `const u = new URL(location.href);
  u.searchParams.set('strategy', id); history.replaceState(null,'',u)` — preserves the `#section` hash
  (mirror of `SymbolSectionNav.tsx:104-106`), triggers no Next navigation/refetch. URL is a write-mostly
  mirror; state is the source of truth.
- `SignalReadiness` becomes **controlled** (`props: strategyId, onStrategyChange`); its internal
  `useState`/`useSearchParams` picker (`SignalReadiness.tsx:34,67-78`) is removed. Blast radius: this
  page only (`insights/market/[symbol]` is a redirect-only stub).
- **Next 15 Suspense**: the page-level `useSearchParams` read is placed inside a `Suspense` boundary
  (the page already wraps `SignalReadiness` in one at `page.tsx:284`) to avoid the CSR-bailout de-opt.

### 2. Research section (FR-1, FR-5)

- Render **all** `symbolOpportunities` as one `SymbolPanelGroup` (key `o.opportunityKey`, label
  `o.strategyId`) in **both** watchlist branches — 1 opportunity → bare card (keeps
  `getByRole('heading',{name:'Opportunity'})` green for AAPL, `position-detail.spec.ts:113,133`).
- `FundamentalsSection` becomes **always-on** (rendered for every symbol, not only the watchlisted
  branch). Its own error/no-data state is unchanged (P-03).
- Watchlisted branch additionally shows controlled `SignalReadiness` + `MuteForStrategy`;
  non-watchlisted branch additionally shows `SymbolScreening`. ("Why this fired" + Mute stay
  watchlist-gated — `position-detail.spec.ts:136` asserts they're hidden for a non-watchlisted symbol.)

### 3. Trade section / PositionBody (FR-2, FR-3, FR-4, + approved "Why it's held" keep)

- Split `PositionBody` (`page.tsx:568-773`): a `Card` **Position** panel (header `:588-632` + stat grid
  `:637-654`) and a **Risk & exit** panel (stop meter + risk `dl`, `:659-703`).
- **Remove Manage (`:705-727`) and Broker (`:751-768`).** Drop the `lg:grid-cols-[1fr_320px]` grid (`:634`).
- **Keep "Why it's held" (`:729-749`)** as a Trade-section panel (user decision at the design gate —
  its data source `owningStrategy` is retained for display).
- Resulting `tradePanels` (held position): `[Position, Risk & exit, Why it's held, Orders & fills, Place order]`;
  unheld: `[Orders & fills, Place order]`. The `radiogroup name="Trade panels"` membership
  (`position-detail.spec.ts:480-488`) is updated to match.

### 4. Tests / fixtures (C-12/C-13, P-06)

- Add a multi-opportunity symbol (≥2 `liveEnabled`-strategy rows for one non-watchlisted symbol) to
  `e2e/fixtures/opportunities.ts` **with an `INVENTORY.md` catalog row in the same step** (C-12).
  `mock-backend.ts listOpportunities` (`:612`) serves them unchanged.
- New RED→green tests: AC-5 (changing one picker updates the other two panels), AC-6
  (`?strategy=<id>` pre-selects all three). Update the readiness tests that watchlist-bind AAPL and
  assert the empty prompt (`position-detail.spec.ts:292-303,305-319`) — a bound symbol now evaluates
  (accepted behavior change). Grep the **whole** e2e suite for `getByLabel('Strategy')`/
  `getByRole('combobox')` collisions and run a broad pass before closing (fails.md 2026-08-09).

## Rejected Alternatives

- **Effect + `seededRef` to seed state** (proposer's original) — race/flash-prone; a pure derivation
  is simpler and correct.
- **Sync three pickers via the URL alone** — `history.replaceState` isn't reactive, so siblings
  wouldn't re-render; shared React state is required.
- **One shared picker in a page toolbar / the section nav** — removes the 3× combobox a11y redundancy
  and the whole `getByLabel` ambiguity class, but the user explicitly chose per-header pickers (FR-7).
- **`StrategyPicker` in `components/shared/`** — it's coupled to the insights `analysisClient`; placing
  it in `components/insights/` keeps the coupling honest.
- **Delete "Why it's held"** — rejected at the gate; kept as a panel (retain `owningStrategy` display).

## Open Risks (→ context.md Open Threads)

- **R1 — `getByLabel`/`getByRole` collision surfaces on a *different* spec** than the one under test;
  the picker step must grep the full suite + run a broad `-g` pass before close (target: the strategy
  picker step). 
- **R2 — Suspense boundary placement** for the page-level `useSearchParams`; verify no CSR-bailout
  warning in `pnpm build` (target: the strategy-selection step).
- **R3 — `owningStrategy` display-use enumeration** must be complete so dropping it as a resolution
  source doesn't strand the subtitle/Why-it's-held (target: the Trade-section step).

## Constitution Rules Touched

- **C-10** — the strategy-picker change touches a shared surface (3 panels + the readiness tests);
  every instance updated with a test; distinct `aria-label`s + full-suite grep prove it.
- **C-12/C-13** — new opportunity fixture gets its `INVENTORY.md` row in the same step.
- **C-14** — consumer surface is the existing `/trader/positions/[symbol]` page (no new route).
- **P-03** — Fundamentals/opportunity no-data states stay explicit; no fabricated values.
- **P-06** — RED-before-green for AC-5/AC-6 and the readiness-behavior test updates.
- **Floor** — none engaged (no migration/proto/config/branch violation).
