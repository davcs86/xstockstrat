# Implementation Spec: screener-fundamental-metric-selector

**Status**: `pending`
**Created**: 2026-08-07
**Feature**: `docs/roadmap/features/117-screener-fundamental-metric-selector/feature.md`
**Total Steps**: 3
**Feature Branch**: `feature/screener-fundamental-metric-selector`

---

## Execution Summary

Three steps, strictly sequential. Step 1 adds the frontend catalog (`FUNDAMENTAL_METRICS` +
`DEFAULT_FUNDAMENTAL_METRIC`) that Step 2 consumes to convert the Screener page's Fundamental
metric field from a free-text `<Input>` to a catalog-driven Radix `Select`, matching the
`ComponentEditor.tsx` pattern per `design.md` § Chosen Approach. Step 3 is the paired e2e test
proving the dropdown renders exactly the 11 catalog options with `pe_ratio` selected by default and
that picking a different option is what gets sent on scan — the regression coverage for both prior
steps and for `design.md`'s order-independent-default requirement (FR-3). This is a UI-only change
(`xstockstrat-ui`, `/insights` segment) — no proto, migration, or config-key changes.

Consumer surface (Constitution C-14): product-spec names `/insights/screener` explicitly (existing
route, no new nav registration needed — C-10(a) not triggered). Steps 1–2 land the change on that
surface; Step 3 is its reachability/regression proof.

## Step Dependencies

- Step 2 requires Step 1: `page.tsx` imports `FUNDAMENTAL_METRICS`/`DEFAULT_FUNDAMENTAL_METRIC` from
  `strategyCatalog.ts`, which must exist first.
- Step 3 [test] covers Steps 1 and 2 [service] — per the test-step-pairing rule (Constitution C-08),
  placed immediately after Step 2 rather than as a third independent unit.

---

### Step 1 — service: add `FUNDAMENTAL_METRICS` catalog to `strategyCatalog.ts`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/strategyCatalog.ts` — modify

**Reviewers**: `xstockstrat-ui` (service owner) — Trading UI correctness, analytics display accuracy,
Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct
DB access (except audit log)

**Codebase Evidence**:
- Confirmed via `Read services/xstockstrat-ui/src/lib/strategyCatalog.ts`:
  - Doc-comment header naming the two existing mirrored sources — `strategyCatalog.ts:1-12`:
    ```
    /**
     * Strategy authoring catalog — the closed set of choices the backend accepts.
     *
     * These mirror the analysis/indicators services so the wizard can offer
     * select-only inputs (dropdowns / type-ahead) instead of free-form text boxes:
     *   - Built-in indicators + their parameters: `xstockstrat-indicators`
     *     `app/services/indicators_engine.py` (`INDICATOR_REGISTRY` + each `_fn` default).
     *   - Rule condition functions: `xstockstrat-analysis`
     *     `app/services/evaluator.py` (`_SUPPORTED_FNS`).
     *
     * Keep this file in sync with those two sources of truth.
     */
    ```
  - `BuiltinIndicator` shape convention (`{ name, description, ... }`, not `{ value, label }`) —
    `strategyCatalog.ts:37-49`.
  - `BUILTIN_INDICATORS` array + `defaultParamsFor` helper end at `strategyCatalog.ts:114-126`; the
    "Condition functions" section begins at `strategyCatalog.ts:128`. The new catalog is inserted
    between these two, as a sibling to `BUILTIN_INDICATORS`, not touching either.
  - No existing fundamentals-metric catalog anywhere in this file (confirmed by full read).
- Confirmed via `Read services/xstockstrat-analysis/app/services/screener.py:32-44` — the 11-name
  `_FUNDAMENTAL_FIELDS` set to mirror:
  ```python
  _FUNDAMENTAL_FIELDS = {
      "market_cap", "pe_ratio", "pb_ratio", "dividend_yield", "eps", "beta", "roe",
      "debt_to_equity", "price", "year_high", "year_low",
  }
  ```
- `design.md` § Chosen Approach point 3 (order-independent default — never `[0].name`) and point 2
  (extend the doc comment to name `screener.py`/`_FUNDAMENTAL_FIELDS` as a third mirrored source).

**TDD**: `N/A (static catalog data, no branching logic to red/green — matches the untested
`BUILTIN_INDICATORS` precedent; see Step 3 Codebase Evidence for the vitest-coverage rationale)`

**Instructions**:
1. In the header doc comment (`strategyCatalog.ts:1-12`), add a third mirrored-source bullet after
   the existing "Rule condition functions" bullet (after `_SUPPORTED_FNS`.\`) and before the closing
   `*/`:
   ```
   *   - Fundamental metric names: `xstockstrat-analysis`
   *     `app/services/screener.py` (`_FUNDAMENTAL_FIELDS`).
   ```
   Change `"Keep this file in sync with those two sources of truth."` to `"...those three sources of
   truth."`.
2. Immediately after `defaultParamsFor` (ends `strategyCatalog.ts:126`) and before the `// Condition
   functions supported by the evaluator` comment (`strategyCatalog.ts:128`), insert:
   ```ts
   export type FundamentalMetric = {
     /** Canonical name sent as `ScreenCriterion.metric_name` (matches `_FUNDAMENTAL_FIELDS`). */
     name: string;
     description: string;
   };

   // Mirrors _FUNDAMENTAL_FIELDS in xstockstrat-analysis app/services/screener.py.
   export const FUNDAMENTAL_METRICS: FundamentalMetric[] = [
     { name: 'market_cap', description: 'Market cap' },
     { name: 'pe_ratio', description: 'P/E ratio' },
     { name: 'pb_ratio', description: 'P/B ratio' },
     { name: 'dividend_yield', description: 'Dividend yield' },
     { name: 'eps', description: 'EPS' },
     { name: 'beta', description: 'Beta' },
     { name: 'roe', description: 'ROE' },
     { name: 'debt_to_equity', description: 'Debt/equity' },
     { name: 'price', description: 'Price' },
     { name: 'year_high', description: '52-week high' },
     { name: 'year_low', description: '52-week low' },
   ];

   // Order-independent default (design.md § Chosen Approach point 3) — never
   // `FUNDAMENTAL_METRICS[0].name`; `pe_ratio` staying the default is load-bearing for FR-3.
   export const DEFAULT_FUNDAMENTAL_METRIC = FUNDAMENTAL_METRICS.find(
     (m) => m.name === 'pe_ratio',
   )!.name;
   ```
   Labels/descriptions match product-spec FR-2's example (`pe_ratio` → "P/E ratio") and the
   `_FUNDAMENTAL_FIELDS` name list exactly (11 entries, order matches the proto/backend set's
   listing order in the product spec).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec tsc --noEmit
grep -n "FUNDAMENTAL_METRICS\|DEFAULT_FUNDAMENTAL_METRIC\|_FUNDAMENTAL_FIELDS" src/lib/strategyCatalog.ts
grep -c "name: '" src/lib/strategyCatalog.ts
```
Confirm `tsc --noEmit` is clean (new array/type-checks), and the first grep shows the new array, the
`DEFAULT_FUNDAMENTAL_METRIC` constant, and the updated doc-comment reference to
`_FUNDAMENTAL_FIELDS`. Read the `FUNDAMENTAL_METRICS` array by eye and confirm it has exactly 11
entries whose `name` values match `_FUNDAMENTAL_FIELDS` (`screener.py:32-44`) 1:1.

---

### Step 2 — service: convert the Fundamental metric field to a catalog-driven `Select`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/screener/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` (service owner) — Trading UI correctness, analytics display accuracy,
Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct
DB access (except audit log)

**Codebase Evidence**:
- Confirmed via `Read services/xstockstrat-ui/src/app/insights/screener/page.tsx`:
  - Existing `strategyCatalog` import — `page.tsx:23`: `import { BUILTIN_INDICATORS } from
    '@/lib/strategyCatalog';`
  - Existing Radix `Select` import (already present, no new import path needed) — `page.tsx:10-16`.
  - `newCriterion()` seeds the default row — `page.tsx:66-76`, the literal at `page.tsx:70`:
    `metricName: 'pe_ratio',`
  - Kind-switch reset handler — `page.tsx:207-227`; the fundamental-branch literal at
    `page.tsx:211-219`:
    ```tsx
    onChange={(e) => {
      const kind = Number(e.target.value) as CriterionRow['kind'];
      // Reset to a valid default for the new kind so a leftover fundamentals
      // field name (e.g. "pe_ratio") isn't sent as a bogus indicator name.
      const metricName =
        kind === ScreenKind.TECHNICAL_INDICATOR
          ? BUILTIN_INDICATORS[0].name
          : 'pe_ratio';
      updateCriterion(i, { kind, metricName });
    }}
    ```
  - Sibling Technical-indicator native `<select>` (stays untouched, native, not Radix) —
    `page.tsx:228-240`.
  - The free-text `<Input>` being replaced — `page.tsx:241-248`:
    ```tsx
    ) : (
      <Input
        aria-label="metric"
        className="w-40 font-mono"
        value={c.metricName}
        onChange={(e) => updateCriterion(i, { metricName: e.target.value })}
      />
    )}
    ```
  - Reference catalog-driven Radix `Select` pattern (the shape to mirror) —
    `services/xstockstrat-ui/src/components/insights/ComponentEditor.tsx:159-170`:
    ```tsx
    <Select value={indicator?.name ?? ''} onValueChange={selectIndicator}>
      <SelectTrigger aria-label="indicator name"><SelectValue placeholder="Select an indicator…" /></SelectTrigger>
      <SelectContent>
        {BUILTIN_INDICATORS.map((ind) => (
          <SelectItem key={ind.name} value={ind.name}>{ind.name} — {ind.description}</SelectItem>
        ))}
      </SelectContent>
    </Select>
    ```
  - `Select`/`SelectTrigger`/`SelectContent`/`SelectItem`/`SelectValue` primitives (forwardRef
    wrappers, `aria-label` passes through via `...props`) —
    `services/xstockstrat-ui/src/components/ui/select.tsx:11-81`.
- `design.md` § Chosen Approach points 3 (order-independent default) and 4 (component/JSX shape).
  § Rejected Alternatives explicitly rules out a native `<select>` here (would match the sibling
  Technical field, but FR-1 mandates Radix) — do not change that decision.

**TDD**: `red-green required` (paired with Step 3's e2e assertions)

**Instructions**:
1. In the `strategyCatalog` import at `page.tsx:23`, add the two new symbols:
   ```ts
   import { BUILTIN_INDICATORS, FUNDAMENTAL_METRICS, DEFAULT_FUNDAMENTAL_METRIC } from '@/lib/strategyCatalog';
   ```
2. In `newCriterion()` (`page.tsx:66-76`), replace the literal at line 70:
   ```ts
   metricName: 'pe_ratio',
   ```
   with:
   ```ts
   metricName: DEFAULT_FUNDAMENTAL_METRIC,
   ```
3. In the kind-switch `onChange` handler (`page.tsx:211-219`), replace the fundamental-branch
   literal:
   ```ts
   const metricName =
     kind === ScreenKind.TECHNICAL_INDICATOR
       ? BUILTIN_INDICATORS[0].name
       : 'pe_ratio';
   ```
   with:
   ```ts
   const metricName =
     kind === ScreenKind.TECHNICAL_INDICATOR
       ? BUILTIN_INDICATORS[0].name
       : DEFAULT_FUNDAMENTAL_METRIC;
   ```
   (The Technical-indicator branch's `BUILTIN_INDICATORS[0].name` stays untouched per `design.md` —
   its index-0 choice isn't load-bearing the way `pe_ratio` is.)
4. Replace the free-text `<Input>` block at `page.tsx:241-248` (the `) : ( ... )}` ternary branch for
   the non-Technical-indicator case) with a catalog-driven Radix `Select`, mirroring
   `ComponentEditor.tsx:159-170`:
   ```tsx
   ) : (
     <Select value={c.metricName} onValueChange={(v) => updateCriterion(i, { metricName: v })}>
       <SelectTrigger aria-label="metric" className="h-9 w-40 font-mono">
         <SelectValue placeholder="Select a metric…" />
       </SelectTrigger>
       <SelectContent>
         {FUNDAMENTAL_METRICS.map((m) => (
           <SelectItem key={m.name} value={m.name}>
             {m.name} — {m.description}
           </SelectItem>
         ))}
       </SelectContent>
     </Select>
   )}
   ```
   Keep `aria-label="metric"` (same accessible name as the field it replaces, so the existing
   `<label className="text-xs ...">` association and any surrounding markup stay unchanged) and the
   `font-mono` styling convention carried over from the replaced `<Input>`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec tsc --noEmit
grep -n "FUNDAMENTAL_METRICS\|DEFAULT_FUNDAMENTAL_METRIC" src/app/insights/screener/page.tsx
grep -n "aria-label=\"metric\"" src/app/insights/screener/page.tsx
```
Confirm `tsc --noEmit` is clean, both new symbols are referenced in `page.tsx` (import + 3 call
sites: `newCriterion`, kind-switch reset, `SelectTrigger`), and exactly one `aria-label="metric"` per
kind branch (Technical native `<select>` at `page.tsx:228-240` unchanged, Fundamental now a Radix
`SelectTrigger`).

---

### Step 3 — test: e2e coverage for the catalog-driven Fundamental metric select

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/screener.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` (service owner) — Trading UI correctness, analytics display accuracy,
Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct
DB access (except audit log)

**Codebase Evidence**:
- Confirmed via `Read`/`Grep services/xstockstrat-ui/e2e/insights/screener.spec.ts` (227 lines
  total):
  - `mockScreen(page, captured)` helper (`screener.spec.ts:7-23`) — reusable controlled
    `ScreenSymbols` mock + request capture, already used by the wire-assertion tests (e.g.
    `screener.spec.ts:88-105`, `:122-144`).
  - `test.describe('Screener', () => { ... })` wraps every test (`screener.spec.ts:32,227`); new
    tests are inserted immediately before the closing `});` at line 227.
  - The only existing `getByLabel('metric')` usage is for the **Technical indicator** kind via
    `.selectOption('RSI')` (native-select API) — `screener.spec.ts:131-132`. No existing test
    exercises the Fundamental metric field, so no assertion needs updating for the new default
    render — only new tests are added.
  - `data-testid="criterion-row"` row wrapper — `services/xstockstrat-ui/src/app/insights/screener/page.tsx:200`.
  - Radix-select interaction pattern already proven in this same file for the watchlist-target
    picker (`click()` + `getByRole('option', ...)`, not `.selectOption()`, which only works on a
    native `<select>`) — `screener.spec.ts:221-222`.
- `design.md` § Open Risks — "`aria-label="metric"` collision across mixed-kind multi-criteria rows":
  scope the new locators through `page.getByTestId('criterion-row')` rather than a bare
  `page.getByLabel('metric')`, as a forward-looking habit (today's single-row tests don't strictly
  require it, since only one criterion row exists per test, but this is the target step design.md
  named).
- `design.md` § Chosen Approach point 5 — the three required assertions (11 options, `pe_ratio`
  default, selecting a different entry updates what's sent on scan).
- Test-data inventory (Constitution C-12, step-constraints.md §B): confirmed via recon.md § Patterns
  to REUSE — no `INVENTORY.md` fixture applies here; criteria are client-authored form state, not
  server-mocked domain data. The new tests reuse the existing `mockScreen` helper (already in this
  file, not a new inline literal) for the `ScreenSymbols` response — no fixture module or
  `INVENTORY.md` row is warranted.
- Coverage threshold table (`reference/spec-template.md` § Test step pairing rule): `xstockstrat-ui`
  (listed as `xstockstrat-insights` in the historical Phase-5 row, now consolidated) has **no**
  vitest coverage threshold for this change — `pnpm test:e2e` is the verification, per the template's
  "n/a — use `pnpm test:e2e`" row. No vitest unit test is added for `strategyCatalog.ts`'s new static
  array, matching the untested `BUILTIN_INDICATORS` precedent (`vitest.config.ts:1-27`, `all: false`,
  `include: ['src/lib/**']` — coverage only applies to files a unit test actually exercises; confirmed
  no `strategyCatalog.test.ts` file exists today).

**TDD**: `red-green required` — run this spec against the pre-Step-2 tree first (the free-text
`<Input>`) to confirm it fails (no `option` role exists, `getByLabel('metric')` resolves to a
`textbox`, not a `combobox`/button), then again after Step 2 to confirm it passes.

**Instructions**:
Insert two new tests immediately before the closing `});` of `test.describe('Screener', ...)` at
`screener.spec.ts:227`:

```ts
test('the Fundamental metric field is a catalog-backed select with 11 options, default P/E ratio (FR-1/FR-2/FR-3)', async ({
  page,
}) => {
  await addAuthCookie(page);
  await page.goto('/insights/screener');

  // Default seeded criterion is Fundamental (page.tsx newCriterion()) — its metric control is now
  // a Radix Select trigger, not a native <select> or free-text <input>. Scope through the row
  // wrapper per design.md's Open Risks note (a second, Technical-kind row would otherwise collide
  // on the shared aria-label="metric").
  const row = page.getByTestId('criterion-row').first();
  const metricTrigger = row.getByLabel('metric');
  await expect(metricTrigger).toContainText('pe_ratio');

  await metricTrigger.click();
  await expect(page.getByRole('option')).toHaveCount(11);
  await expect(page.getByRole('option', { name: /pe_ratio — P\/E ratio/ })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('selecting a different Fundamental metric updates metricName and is what gets sent on scan (FR-1/FR-2)', async ({
  page,
}) => {
  await addAuthCookie(page);
  const captured: { req?: Record<string, unknown> } = {};
  await mockScreen(page, captured);
  await page.goto('/insights/screener');

  const row = page.getByTestId('criterion-row').first();
  await row.getByLabel('metric').click();
  await page.getByRole('option', { name: /market_cap — Market cap/ }).click();
  await expect(row.getByLabel('metric')).toContainText('market_cap');

  await page.getByTestId('run-screen').click();
  await expect(page.getByTestId('screen-results')).toBeVisible({ timeout: 10000 });

  const criteria = captured.req?.criteria as Array<{ metricName?: string }>;
  expect(criteria[0].metricName).toBe('market_cap');
});
```

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec tsc --noEmit && pnpm run lint && pnpm test:e2e -- e2e/insights/screener.spec.ts
```
Confirm `tsc --noEmit` and `pnpm run lint` are clean, and all tests in `screener.spec.ts` pass
(including the two new ones and the pre-existing Technical-indicator test at `screener.spec.ts:122`,
which must remain unaffected per Acceptance Criterion 5). Before Step 2 lands, running this same
command against the pre-Step-2 tree must show the two new tests **failing** (red) — the
`getByRole('option')` count assertion and the `toContainText('pe_ratio')` trigger assertion cannot
pass against a free-text `<Input>`.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
