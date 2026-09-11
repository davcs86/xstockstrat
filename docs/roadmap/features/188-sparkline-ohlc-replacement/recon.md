# Recon: sparkline-ohlc-replacement

**Created**: 2026-09-11
**From**: product-spec.md
**Affected services**: xstockstrat-ui

---

## Objective

Replace the shared `Sparkline` bar chart rendered on the Opportunities List page and the Single
Opportunity (symbol detail) page with a compact OHLC text block (date + Open/High/Low/Close from
the most recent completed daily bar). The data is already fetched by `useSparklines` via `getBars`
but only `close` is mapped today — the hook's return type changes to expose full bar fields.

## Codebase Map

- **`xstockstrat-ui`** (Next.js / TypeScript)
  - Shared Sparkline component: `src/components/shared/Sparkline.tsx:7`
  - useSparklines hook: `src/hooks/useSparklines.ts:22`
  - Bar→SparklinePoint mapping (close-only): `src/hooks/useSparklines.ts:33-34`
  - getBars client: `src/lib/browserClients/insightsMarketDataClient.ts:8`
  - **Opportunities page** (`/insights/opportunities`):
    - Hook call: `src/app/insights/opportunities/page.tsx:177`
    - SymbolGroupCard prop: `src/app/insights/opportunities/page.tsx:339`
    - OpportunityRow render: `src/app/insights/opportunities/page.tsx:540-541`
  - **Symbol detail page** (`/trader/positions/[symbol]`):
    - Hook call: `src/app/trader/positions/[symbol]/page.tsx:223`
    - Header render: `src/app/trader/positions/[symbol]/page.tsx:478-479`
  - Money formatter: `src/lib/money.ts:4` — `fmtUsd` (`$1,234.56` format)
  - No existing short-date "MMM DD" formatter — a new `fmtShortDate` utility is needed
  - E2E sparkline assertions:
    - Opportunities: `e2e/insights/opportunities.spec.ts:195` (`opp-sparkline-CAPR` testId)
    - Symbol detail: `e2e/trader/position-detail.spec.ts:782` (`detail-sparkline` testId)
  - Test fixture: `e2e/fixtures/opportunities.ts:16` (`CAPR_SPARKLINE`)
  - Mobile `SectionRenderer`: confirmed no sparkline reference — no changes needed

### FormulaRunResult — separate local Sparkline (NOT the shared component)

`src/components/insights/FormulaRunResult.tsx:14` defines a **local, file-scoped** `Sparkline`
function using `recharts` `LineChart` — it does NOT import the shared `Sparkline` from
`@/components/shared/Sparkline`. Therefore the shared `Sparkline.tsx` component **can be deleted**
after removing the two call sites; the `FormulaRunResult` local function is unaffected.

This resolves open question FR-5 from the product spec: the shared Sparkline has exactly 2
consumers (opportunities page + symbol detail page), both being removed by this feature.

## Patterns to REUSE

- **USD formatting** → reuse `fmtUsd` at `src/lib/money.ts:4` — for OHLC values
- **Progressive-enhancement absence pattern** → reuse the existing `{data && data.length > 0 && (...)}` guard already on both sparkline call sites (`:540-541`, `:478-479`)
- **Browser client for getBars** → reuse `insightsMarketDataClient.getBars` at `src/lib/browserClients/insightsMarketDataClient.ts:8` — no new RPC
- **Hook query pattern** → reuse `useQueries` batch pattern in `useSparklines.ts` — refactor in-place, don't create a new hook
- **testId convention** → e2e tests use `data-testid` strings like `opp-sparkline-CAPR`; new OHLC elements should follow the same `opp-ohlc-SYMBOL` / `detail-ohlc` pattern

## Existing Business Rules (preserve / extend)

From `services/xstockstrat-ui/acceptance/opportunity-live-market-enrichment.feature` (feature 095):

- **CHANGE** `@AC-3` "A queue card renders a price sparkline from recent bars" — this feature
  replaces the sparkline with OHLC text; the 20-bar close sparkline guarantee is superseded by the
  OHLC text block. Requires sign-off (recorded in context.md if approved).
- **CHANGE** `@AC-4` "A sparkline warm-up gap renders as null, never NaN" — with OHLC text replacing
  the sparkline, the warm-up gap rendering behavior is no longer applicable; the new guarantee is
  "OHLC absent when bars unavailable" (FR-4).
- **PRESERVE** `@AC-1` "An Opportunities queue card shows live price and change%" — live price display
  is orthogonal to the sparkline→OHLC replacement; must not be regressed.
- **PRESERVE** `@AC-2` "The Signal-detail header shows live price and change%" — same; live price on
  the symbol detail header is separate from the sparkline location.
- **PRESERVE** `@AC-11` "An unavailable live quote omits the price field rather than fabricating it" —
  graceful degradation pattern preserved; OHLC follows the same principle (FR-4).
- **PRESERVE** `@AC-12 @feature-095` "The live price shown on the Decide surface equals the price on the Signal-detail surface" — cross-surface live price parity must hold; OHLC change is orthogonal.

From `services/xstockstrat-ui/acceptance/watchlist-opportunity-signal-cues.feature` (feature 155):

- **PRESERVE** `@AC-3 @feature-155` "The in-queue marker is icon-coded consistently" — in-queue badge on the opportunity card must survive the sparkline→OHLC layout change.
- **PRESERVE** `@AC-9 @feature-155` "Mobile Opportunities groups signals by symbol" — OHLC text must render correctly in mobile grouped cards (SymbolGroupCard).

From `services/xstockstrat-ui/acceptance/opportunity-compute-robustness.feature` (feature 185):

- **PRESERVE** `@AC-3 @feature-185` "The Decide queue renders the unavailable state explicitly" — the C-17 unavailable cue must not regress when OHLC block is absent (FR-4).

## Dependencies

- Proto/RPC: none — `Bar` message already carries `open`, `high`, `low`, `close`, `time` (`packages/proto/marketdata/v1/marketdata.proto:57-71`); `getBars` RPC already returns them
- Migration: none
- Config keys: none
- Inter-service edges: none (existing `insightsMarketDataClient.getBars` call unchanged)
- New env vars / ports: none

## Risks / Not-found

- **No existing short-date formatter**: no `fmtShortDate` ("Sep 10") utility exists in `src/lib/`. Various files use inline `toLocaleDateString()` or ISO slicing. A new utility must be created (scope: ~5 lines in `src/lib/money.ts` or a new `src/lib/date.ts`).
- **Ledger trap `fails.md:1463`** (oklch canvas rejection): not applicable — moving FROM a visual component TO plain text; no canvas path introduced.
- **Ledger trap `fails.md:1780`** (opportunities bars fetch OOM): existing 20-bar `pageSize` cap is unchanged; OHLC uses only the last bar from the same response.
- **E2E test updates required**: two spec files assert sparkline visibility (`opp-sparkline-*` / `detail-sparkline` testIds) — they must be updated to assert OHLC text instead.
- **Fixture updates required**: `CAPR_SPARKLINE` fixture (`e2e/fixtures/opportunities.ts:16`) needs OHLC fields added for the mock bars response.
- **SparklinePoint proto type**: `SparklinePointSchema` (imported from `@xstockstrat/proto/analysis/v1/analysis_pb`) may become an orphan if no other consumer exists — verify at implementation time.

## Recommended Scope

1. **Refactor `useSparklines` hook** — change return type from `Map<string, SparklinePoint[]>` to expose the most recent `Bar` (OHLC + time); rename to `useLastDailyBar` or similar
2. **Create `fmtShortDate` utility** — "Sep 10" format helper in `src/lib/`
3. **Create `OhlcBlock` component** — compact text block: date + O/H/L/C formatted as USD
4. **Replace sparkline in OpportunityRow** — swap `<Sparkline>` for `<OhlcBlock>`; update prop threading through `SymbolGroupCard`
5. **Replace sparkline in symbol detail header** — swap `<Sparkline>` for `<OhlcBlock>`
6. **Delete shared `Sparkline.tsx`** — no remaining consumers (FormulaRunResult uses its own local function)
7. **Update E2E tests + fixtures** — new testIds, OHLC assertions, fixture bar data with open/high/low fields
