# Recon: screener-preset-criteria

**Created**: 2026-09-12
**From**: product-spec.md
**Affected services**: `xstockstrat-ui`

---

## Objective

Add a preset selector dropdown to the Screener page (`/insights/screener`) that lets traders load
predefined multi-criterion configurations via the existing `setCriteria` mutator. Ship with a
"Fundamentals Signal" preset mirroring `_BUILTIN_BANDS` + EPS gate from `fundsignal_loop.py`. UI-only
— no proto, config, migration, or backend changes.

## Codebase Map

- **`xstockstrat-ui`** (Next.js)
  - Screener page: `src/app/insights/screener/page.tsx:65` — `ScreenerPage()` component (581 lines)
  - Criteria builder section: `page.tsx:298-444` — renders kind/metric/comparator/threshold/weight/hardFilter per row
  - `useCriteriaList` hook: `src/lib/screenCriteria.ts:56-63` — returns `{ criteria, setCriteria, add, remove, update }`
  - `CriterionRow` type: `src/lib/screenCriteria.ts:17-25` — `{ refName, kind, metricName, op, threshold, weight, hardFilter }`
  - `newCriterion()` factory: `src/lib/screenCriteria.ts:43-53` — generates a default row with `ScreenKind.FUNDAMENTAL`, `DEFAULT_FUNDAMENTAL_METRIC`, `Comparator.LT`, threshold 20, weight 1, hardFilter false
  - `buildScreenCriterion`: `src/lib/screenCriteria.ts:69-89` — wire builder for RPC
  - `COMPARATOR_LABELS`: `src/lib/screenCriteria.ts:27-32` — `LT(<), LTE(<=), GT(>), GTE(>=)`
  - `KIND_OPTIONS`: `src/lib/screenCriteria.ts:34-37` — `FUNDAMENTAL, TECHNICAL_INDICATOR`
  - `FUNDAMENTAL_METRICS` (11): `src/lib/strategyCatalog.ts:137-149` — `market_cap, pe_ratio, pb_ratio, dividend_yield, eps, beta, roe, debt_to_equity, price, year_high, year_low`
  - `BUILTIN_INDICATORS` (8): `src/lib/strategyCatalog.ts:54-116`
  - `DEFAULT_FUNDAMENTAL_METRIC`: `src/lib/strategyCatalog.ts:152-154` — `pe_ratio`
  - Select component (shadcn/Radix): `src/components/ui/select.tsx` — already imported on the screener page
  - SymbolScreening card (second consumer): `src/components/trader/SymbolScreening.tsx:25-31,44-48` — imports from both `screenCriteria.ts` and `strategyCatalog.ts`, uses its own `useCriteriaList()` call
  - Nav registration (C-10a): `src/components/shared/PlatformHeader.tsx:80` + `navGroups.tsx:50` — screener already registered
  - Screener e2e: `e2e/insights/screener.spec.ts`
  - Screener fixtures: `e2e/fixtures/screenResults.ts` — `fundamentalsPendingRow`, `barsInsufficientRow`, `resolvedRow`, `criterionDetailRow`, `noCriteriaDataRow`
  - Auth helper: `e2e/helpers/auth.ts` — `signTestJwt`, `addAuthCookie`
  - Vitest config: `vitest.config.ts` — node env, `src/**/*.test.ts`, coverage `src/lib/**` at 40%
  - Existing unit test pattern: `src/lib/screenWeights.test.ts` — tests `normalizeWeights` (same screener domain)
  - Proto enums: `packages/proto/analysis/v1/analysis.proto:422-438` — `Comparator` (LT=1,LTE=2,GT=3,GTE=4), `ScreenKind` (FUNDAMENTAL=1,TECHNICAL_INDICATOR=3)

## Patterns to REUSE

- **Typed constant array for presets** → follow `FormulaTemplate` pattern at `src/components/insights/formulaReference.ts:7` (closest analogous starter-template pattern in the codebase)
- **`setCriteria` mutator** → `src/lib/screenCriteria.ts:59` — the sole integration point; presets call it to replace all rows
- **`CriterionRow` type + `newCriterion()` factory** → `src/lib/screenCriteria.ts:17-53` — preset entries are `CriterionRow[]`, no new type needed
- **shadcn `Select` component** → `src/components/ui/select.tsx` — already used on the screener page (`page.tsx:349-364` for fundamental metric picker); reuse the same `Select/SelectContent/SelectItem/SelectTrigger/SelectValue` import
- **Vitest unit testing** → `src/lib/screenWeights.test.ts` — pattern for testing a `src/lib/` module with vitest in node environment
- **`FUNDAMENTAL_METRICS` catalog** → `src/lib/strategyCatalog.ts:137-149` — preset metric names reference entries from this catalog for validation (AC-5)
- **Screener e2e fixtures** → `e2e/fixtures/screenResults.ts` — extend with preset-related fixture data if e2e tests are added

## Existing Business Rules (preserve / extend)

- No existing `@AC-*` scenarios in the xstockstrat-ui acceptance suites or `platform.feature` assert on the Screener page's criteria builder, preset selection, or fundamentals screening UI. This feature is net-new behavior only.
- Nearest misses: `@AC-11`/`@AC-12` in `watchlist-opportunity-signal-cues.feature` reference "screener" as an Opportunities queue source-filter pill — not impacted since this feature adds no new source type and does not change how screener-sourced rows flow into the Opportunities queue.

## Dependencies

- Proto/RPC: none — no proto changes
- Migration: none — no DB changes
- Config keys: none — no config changes
- Inter-service edges: none — UI-only
- New env vars / ports: none

## Risks / Not-found

- **No existing preset/template pattern in screener domain.** The `FormulaTemplate` pattern in `formulaReference.ts` is the closest analogue but serves a different purpose (formula code starters, not criteria configurations). The new `screenPresets.ts` module will be purpose-built.
- **Applicable `fails.md` trap (060-screener-engine, C-10a):** the screener page was once unreachable because it wasn't registered in `PLATFORM_SUBNAV`. Already resolved — screener is registered at `PlatformHeader.tsx:80` + `navGroups.tsx:50`. No new nav entry needed for this feature (it's a control on an existing page, not a new page).
- **Known trap (fails.md:1399-1403, feature 117):** `_validate_fundamental_metrics` accepts a superset. Not applicable — the Fundamentals Signal preset uses only the 5 closed-set metrics (`pe_ratio`, `pb_ratio`, `roe`, `debt_to_equity`, `eps`), all in `FUNDAMENTAL_METRICS`.

## Recommended Scope

1. **New module `src/lib/screenPresets.ts`** — typed `ScreenPreset` type + `SCREEN_PRESETS` constant array with the "Fundamentals Signal" entry (5 `CriterionRow` entries). DRY-shared between the Screener page and future `SymbolScreening` consumer.
2. **Screener page update `page.tsx`** — add a preset selector `Select` dropdown above the criteria builder, wired to `setCriteria` on selection.
3. **Unit test `src/lib/screenPresets.test.ts`** — validate preset entries reference valid `FUNDAMENTAL_METRICS` / `BUILTIN_INDICATORS` entries, non-empty criteria arrays, correct field types.
4. **E2e test extension** — optional: add a preset-loading scenario to `e2e/insights/screener.spec.ts`.
