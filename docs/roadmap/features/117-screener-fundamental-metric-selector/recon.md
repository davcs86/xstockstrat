# Recon: screener-fundamental-metric-selector

**Created**: 2026-08-07
**From**: product-spec.md
**Affected services**: `xstockstrat-ui`

---

## Objective

Convert the Screener page's Fundamental-criterion `metricName` field from a free-text `<Input>` to
a select control, sourced from a new frontend catalog that mirrors the backend's closed 11-name
`_FUNDAMENTAL_FIELDS` set, so a user can no longer submit an unrecognized/mistyped fundamental
metric name.

## Codebase Map

- **`xstockstrat-ui`** (Next.js)
  - Screener page: `services/xstockstrat-ui/src/app/insights/screener/page.tsx`
  - `CriterionRow` type — `page.tsx:31-44` (`kind`, `metricName: string`, `op`, `threshold`,
    `weight`, `hardFilter`)
  - `KIND_OPTIONS` — `page.tsx:53-56`
  - `newCriterion()` default (seeds `metricName: 'pe_ratio'`) — `page.tsx:66-76`, esp. line 70
  - `addCriterion` / `updateCriterion` — `page.tsx:100-108`
  - Kind-switch handler (resets `metricName` on kind change) — `page.tsx:207-227`, reset logic at
    `page.tsx:211-219`:
    ```ts
    const kind = Number(e.target.value) as CriterionRow['kind'];
    const metricName = kind === ScreenKind.TECHNICAL_INDICATOR ? BUILTIN_INDICATORS[0].name : 'pe_ratio';
    updateCriterion(i, { kind, metricName });
    ```
  - Native `<select>` for `kind` — `page.tsx:207-227` (class `h-9 rounded-md border bg-background px-2 text-sm`)
  - Native `<select>` for the **Technical indicator** metric (driven by `BUILTIN_INDICATORS`) —
    `page.tsx:228-240` (class adds `font-mono`) — **note:** this sibling field is itself a native
    `<select>`, not Radix `Select`; only the watchlist-target picker on this page uses Radix.
  - Free-text `<Input>` for the **Fundamental** metric (being replaced) — `page.tsx:241-248`,
    `aria-label="metric"`
  - Native `<select>` for `comparator` — `page.tsx:249-262`
  - Existing Radix `Select` usage on this page (watchlist target picker) — `page.tsx:402-413`:
    ```tsx
    <Select value={targetListId} onValueChange={setTargetListId}>
      <SelectTrigger className="h-8 w-40" aria-label="Target watchlist">
        <SelectValue placeholder="Add top 5 to…" />
      </SelectTrigger>
      <SelectContent>
        {(watchlists.data?.watchlists ?? []).map((wl) => (
          <SelectItem key={wl.watchlistId} value={wl.watchlistId}>{wl.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
    ```
  - Radix Select import — `page.tsx:10-16`; `BUILTIN_INDICATORS` import — `page.tsx:23`
  - Catalog file: `services/xstockstrat-ui/src/lib/strategyCatalog.ts`
    - "Keep in sync" doc comment — `strategyCatalog.ts:1-12` (currently names only the indicators
      service's `INDICATOR_REGISTRY` and analysis' `_SUPPORTED_FNS` as sources of truth to mirror —
      **does not yet mention** `_FUNDAMENTAL_FIELDS`/`screener.py`)
    - `BuiltinIndicator` shape — `strategyCatalog.ts:37-49`: `{ name, description, params, outputs? }`
      (field is `name`, not `value`)
    - `BUILTIN_INDICATORS` array — `strategyCatalog.ts:52-114`
    - No existing fundamentals-metric catalog anywhere in this file.
  - Radix Select primitives: `services/xstockstrat-ui/src/components/ui/select.tsx:11-81`
    (`Select`, `SelectGroup`, `SelectValue`, `SelectTrigger`, `SelectContent`, `SelectItem`;
    forwardRef wrappers around `@radix-ui/react-select`, any Radix prop incl. `aria-label` passes
    through)
  - Reference catalog-driven Radix Select pattern:
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
  - e2e spec: `services/xstockstrat-ui/e2e/insights/screener.spec.ts` — the only Screener spec file.
    - Exercises `aria-label="metric"` only for the **Technical indicator** kind via
      `.selectOption('RSI')` (native-select API) — `screener.spec.ts:130-143`.
    - No test currently fills the Fundamental metric field; every other test leaves the seeded
      `'pe_ratio'` default untouched, so no existing assertion breaks by value.
    - Radix-select interaction pattern already used in this same file for the watchlist picker
      (`click()` + `getByRole('option', ...)`, not `.selectOption()`) — `screener.spec.ts:221-222`
      — this is the pattern a new Fundamental-select test must follow, since `.selectOption()` only
      works on a native `<select>`.
  - Backend source of truth: `services/xstockstrat-analysis/app/services/screener.py:32-44`
    (`_FUNDAMENTAL_FIELDS`, 11 names, confirmed exact match to product-spec FR-2).

## Patterns to REUSE

- Radix `Select`/`SelectTrigger`/`SelectContent`/`SelectItem` primitives → reuse
  `services/xstockstrat-ui/src/components/ui/select.tsx` (already imported in `page.tsx:10-16`,
  no new import path).
- Catalog-driven `SelectItem` list JSX → reuse the exact shape at
  `ComponentEditor.tsx:159-170` (map over a static array, `key`/`value` = the metric name).
- New catalog placement/doc-comment convention → reuse `strategyCatalog.ts`'s existing
  "mirrors backend, keep in sync" pattern (`strategyCatalog.ts:1-12`, `BUILTIN_INDICATORS` shape at
  `strategyCatalog.ts:37-49`) — add a sibling `FUNDAMENTAL_METRICS` array with the same
  `{ name, description }` shape (not `{ value, label }`, to match the file's existing convention)
  and extend the doc comment to name `_FUNDAMENTAL_FIELDS`/`screener.py` as the third source to
  mirror.
- e2e Radix-select interaction → reuse the `click()` + `getByRole('option', ...)` pattern at
  `screener.spec.ts:221-222`, not `.selectOption()`.
- Test fixtures: none needed — no `INVENTORY.md` entry exists for screener criteria and none is
  warranted; criteria are client-authored form state, not server-mocked data
  (`e2e/fixtures/INVENTORY.md:57` lists only "Screener results" as not-yet-centralized, which is a
  different, unrelated surface).

## Dependencies

- Proto/RPC: none — `ScreenCriterion.metric_name` stays `string metric_name = 3` (unchanged).
- Migration: none
- Config keys: none
- Inter-service edges: none (UI-only change)
- New env vars / ports: none

## Risks / Not-found

- **Not found**: no existing fundamentals-metric catalog/array anywhere in `src/` — confirmed this
  feature must add it from scratch (expected, matches product-spec scope).
- **Not found**: no vitest unit test file for `strategyCatalog.ts` today (`all: false`, coverage
  only applies to files actually exercised by a test — adding the catalog array does not itself
  force a new unit test under the current vitest scope/policy, `vitest.config.ts:15-23`).
- **Design note carried into Phase 1**: the *sibling* Technical-indicator metric field is a native
  `<select>` (`page.tsx:228-240`), not Radix — so converting only the Fundamental field to Radix
  `Select` (per product-spec FR-1, matching the watchlist-target picker instead) creates two
  different select implementations for the two metric-name fields on the same row. This
  visual/pattern-consistency trade-off (Radix vs. native, and which sibling to match) is exactly
  the kind of fork the grilling round should weigh — recon surfaces it, does not resolve it.
- **Ledger**: no `fails.md`/`insights.md` entry specific to Screener catalog additions found; the
  general "frontend catalog duplicated from backend, keep in sync via doc comment" pattern is
  already the accepted, precedented approach (`BUILTIN_INDICATORS`), not a known trap.

## Recommended Scope

1. `strategyCatalog.ts`: add `FUNDAMENTAL_METRICS` catalog (11 entries, `{ name, description }`)
   + extend the "keep in sync" doc comment to name `_FUNDAMENTAL_FIELDS`/`screener.py`.
2. `page.tsx`: replace the Fundamental metric `<Input>` with a catalog-driven select (component
   choice — Radix vs. native — is the Phase 1 decision), update the kind-switch reset logic
   (`page.tsx:211-219`) to source the Fundamental default from the new catalog instead of the
   hardcoded literal `'pe_ratio'`.
3. `screener.spec.ts`: extend/add an e2e assertion that the Fundamental metric field is a
   catalog-backed select (not free text) and that an out-of-catalog value cannot be entered.
