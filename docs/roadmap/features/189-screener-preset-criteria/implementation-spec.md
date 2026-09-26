# Implementation Spec: screener-preset-criteria

**Status**: `pending`
**Created**: 2026-09-26
**Feature**: `docs/roadmap/features/189-screener-preset-criteria/feature.md`
**Total Steps**: 4
**Feature Branch**: `feature/screener-preset-criteria`

---

## Execution Summary

UI-only feature in `xstockstrat-ui` (no proto/config/migration/backend changes — product spec
`## Proto/Config/Database Changes` all "No"). Order: (1) create the `screenPresets.ts` data module,
(2) its vitest unit test, (3) wire a controlled preset `Select` into the Screener page, (4) extend the
screener Playwright e2e with a preset-loading scenario. Steps 1→2 and 1→3 are ordered by the module
import; step 4 depends on the page change.

**Consumer surface (C-14):** the product spec names one surface — **UI `/insights`** (Screener page
`/insights/screener`). Step 3 lands the change on that surface (the preset `Select` control); step 4
proves it reachable/usable end-to-end. No new page/route is added (the selector is a control on the
existing, already-nav-registered Screener page — `recon.md` → `PlatformHeader.tsx:80` +
`navGroups.tsx:50`), so **C-10(a)** requires no new nav registration.

## Scenario Coverage (C-15)

- **AC-1** (selector visible, lists presets) → Step 4
- **AC-2** (loading populates 5 rows with expected metric/op/threshold/hardFilter) → Step 4
- **AC-3** (preset rows fully editable) → Step 4
- **AC-4** (loading replaces all existing criteria) → Step 4
- **AC-5** (`SCREEN_PRESETS` importable; each criterion references a valid catalog entry) → Step 2

## Step Dependencies

- Step 2 requires Step 1: `screenPresets.test.ts` imports `SCREEN_PRESETS` from `./screenPresets`.
- Step 3 requires Step 1: `page.tsx` imports `SCREEN_PRESETS` from `@/lib/screenPresets`.
- Step 4 requires Step 3: the e2e scenario exercises the preset `Select` rendered by the page.
- Step 2 [test] covers Step 1 [service]; Step 4 [test] covers Step 3 [service] (frontend — no
  coverage-threshold pairing beyond the vitest `src/lib/**` gate; see the per-step Verification).

---

### Step 1 — service: Create the `screenPresets.ts` preset-data module

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/screenPresets.ts` — create

**Reviewers**: `xstockstrat-ui` Service Owner — Trading UI correctness, analytics display accuracy, Connect-RPC call safety, no direct DB access (except audit log)

**Codebase Evidence**:
- Reuse target — `CriterionRow` type (no new type): `src/lib/screenCriteria.ts:17-25` →
  `{ refName; kind: ScreenKind.FUNDAMENTAL | ScreenKind.TECHNICAL_INDICATOR; metricName; op: Comparator; threshold; weight; hardFilter }`.
- Enum source: `Comparator` (`LT`, `GT`) and `ScreenKind` (`FUNDAMENTAL`) imported from
  `@xstockstrat/proto/analysis/v1/analysis_pb` — same import path used at `src/lib/screenCriteria.ts:2`.
- Preset thresholds mirror `_BUILTIN_BANDS` bad-endpoints, confirmed via
  `services/xstockstrat-analysis/app/engine/fundsignal_loop.py:35-40`:
  `pe_ratio (10.0, 35.0)`, `pb_ratio (1.0, 5.0)`, `roe (0.25, 0.05)`, `debt_to_equity (0.3, 2.0)` —
  bad endpoint = the value the linear interp maps to 0.0 (35 / 5 / 0.05 / 2). EPS binary gate confirmed
  at `fundsignal_loop.py:395-396` (`1.0 if f.eps > 0 else 0.0`).
- Analogous typed-constant-array pattern: `src/components/insights/formulaReference.ts:20` (`FormulaTemplate`
  interface + exported array) — the closest existing starter-template pattern (`recon.md` → Patterns to REUSE).

**TDD**: `red-green required` — paired with Step 2's unit test (P-06; Step 2 authored to fail against
the pre-Step-1 tree, where the import does not resolve).

**Covers**: —

**Instructions**:
- Create `src/lib/screenPresets.ts`. Import `{ Comparator, ScreenKind }` from
  `@xstockstrat/proto/analysis/v1/analysis_pb` and `import type { CriterionRow } from './screenCriteria';`.
- Export a `ScreenPreset` type: `{ id: string; name: string; description: string; criteria: CriterionRow[] }`
  (design.md § Chosen Approach — reuse `CriterionRow`, do not invent a new row type).
- Export `const SCREEN_PRESETS: ScreenPreset[]` with one entry, `id: 'fundamentals-signal'`,
  `name: 'Fundamentals Signal'`, a short `description`, and exactly these 5 `CriterionRow` entries
  (fully-qualified enum values on every row — `context.md` § Decisions; `kind: ScreenKind.FUNDAMENTAL`
  explicit on each):
  | refName | metricName | op | threshold | weight | hardFilter |
  |---|---|---|---|---|---|
  | c1 | `pe_ratio` | `Comparator.LT` | 35 | 1 | false |
  | c2 | `pb_ratio` | `Comparator.LT` | 5 | 1 | false |
  | c3 | `roe` | `Comparator.GT` | 0.05 | 1 | false |
  | c4 | `debt_to_equity` | `Comparator.LT` | 2 | 1 | false |
  | c5 | `eps` | `Comparator.GT` | 0 | 1 | true |
- All 5 `metricName`s are in `FUNDAMENTAL_METRICS` (`src/lib/strategyCatalog.ts:137-149`) — the closed
  5-metric set; the feature-117 `_validate_fundamental_metrics` superset trap does not apply
  (`product-spec.md` Open Questions; `recon.md` → Risks).
- Do **not** set `symbolsText` or add any factory/parameterization (design.md § Rejected Alternatives —
  static constant, not a factory; C-18 YAGNI).

**Verification**:
- `cd services/xstockstrat-ui && npx tsc --noEmit` — type-checks (confirms `CriterionRow` shape satisfied).
- Lint gate is run in the paired Step 2 (`pnpm run lint`), per `reference/step-constraints.md` §B.

---

### Step 2 — test: Unit-test `SCREEN_PRESETS` shape and catalog validity

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/screenPresets.test.ts` — create

**Reviewers**: `xstockstrat-ui` Service Owner — Trading UI correctness, analytics display accuracy, Connect-RPC call safety, no direct DB access (except audit log)

**Codebase Evidence**:
- Vitest unit-test pattern (node env, `src/**/*.test.ts`): `src/lib/screenWeights.test.ts:1-4`
  (`import { describe, it, expect } from 'vitest';` + module-under-test import).
- Catalog sources for validity assertions: `FUNDAMENTAL_METRICS` (`src/lib/strategyCatalog.ts:137-149`)
  and `BUILTIN_INDICATORS` (`src/lib/strategyCatalog.ts:54-116`, per `recon.md` Codebase Map).
- Coverage config: `vitest.config.ts` — node env, coverage scoped to `src/lib/**` at 40%
  (`services/xstockstrat-ui/CLAUDE.md` § Testing); a new `src/lib/*.test.ts` file is auto-collected.

**TDD**: `red-green required` — this test must be authored to **fail** against the pre-Step-1 tree
(the `./screenPresets` import is unresolved → red), then pass once Step 1 lands (P-06).

**Covers**: AC-5

**Instructions**:
- Create `src/lib/screenPresets.test.ts` following `screenWeights.test.ts`'s structure
  (`describe`/`it` from `vitest`). Import `SCREEN_PRESETS` from `./screenPresets` and
  `{ FUNDAMENTAL_METRICS, BUILTIN_INDICATORS }` from `./strategyCatalog`; `{ ScreenKind, Comparator }`
  from `@xstockstrat/proto/analysis/v1/analysis_pb`.
- Assert (AC-5): `SCREEN_PRESETS` is non-empty; every preset has truthy `id`/`name`/`description` and a
  non-empty `criteria` array; every criterion's `metricName` is in `FUNDAMENTAL_METRICS` (when
  `kind === ScreenKind.FUNDAMENTAL`) or `BUILTIN_INDICATORS` (when `TECHNICAL_INDICATOR`); each
  criterion's field types match `CriterionRow` (string `refName`/`metricName`, numeric
  `threshold`/`weight`, boolean `hardFilter`, `op` ∈ the 4 comparators).
- Add a targeted assertion for the shipped preset: `fundamentals-signal` has exactly 5 rows with
  metrics `['pe_ratio','pb_ratio','roe','debt_to_equity','eps']`, and the `eps` row is a hard filter
  (`hardFilter === true`, `op === Comparator.GT`, `threshold === 0`) — pins FR-4/AC-2.
- **C-12 test-data**: uses no mocked domain objects — validates a source-of-truth constant against the
  static catalogs. No `e2e/fixtures/` import or `INVENTORY.md` row is required (rule materializes only
  for mocked domain data).

**Verification**:
- `cd services/xstockstrat-ui && pnpm run test:unit` — the new suite passes (was red pre-Step-1).
- `cd services/xstockstrat-ui && pnpm run test:coverage` — confirm the vitest `src/lib/**` 40% threshold
  passes (the new `.test.ts` exercises `src/lib/screenPresets.ts`).
- `cd services/xstockstrat-ui && pnpm run lint` — lint/format gate (`reference/step-constraints.md` §B).

---

### Step 3 — service: Add the preset `Select` control to the Screener page

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/screener/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` Service Owner — Trading UI correctness, analytics display accuracy, Connect-RPC call safety, no direct DB access (except audit log)

**Codebase Evidence**:
- Screener page component: `src/app/insights/screener/page.tsx:66` (`export default function ScreenerPage()`).
- `setCriteria` mutator (sole integration point): destructured from `useCriteriaList()` at
  `page.tsx:73-79`; defined `src/lib/screenCriteria.ts:56-62` (`useCriteriaList` returns
  `{ criteria, setCriteria, add, remove, update }`).
- shadcn `Select` already imported and used on the page: import block `page.tsx:10-16`; existing
  fundamental-metric picker usage `page.tsx:376-390` (`Select`/`SelectTrigger`/`SelectContent`/
  `SelectItem`/`SelectValue` with `value` + `onValueChange`).
- Criteria-builder section (insert selector immediately above): the `Criteria` header row at
  `page.tsx:301-306`, the `criteria.map(...)` builder starting `page.tsx:333`.
- Controlled-value pattern for reset-to-placeholder (design.md § Rejected Alternatives — uncontrolled
  Radix Select won't reset): use `useState<string>('')`, analogous to the page's existing
  `useState` controls (`page.tsx:72,82-89`).

**TDD**: `red-green required` — paired with Step 4's e2e (P-06; Step 4 asserts the selector + 5-row
load, which fail against the pre-Step-3 page).

**Covers**: —

**Instructions**:
- Import `{ SCREEN_PRESETS } from '@/lib/screenPresets';` alongside the existing `@/lib/*` imports at
  the top of `page.tsx`.
- Add `const [presetValue, setPresetValue] = useState<string>('');` beside the existing `useState`
  declarations in `ScreenerPage`.
- Render a controlled shadcn `Select` **above** the criteria-builder block (immediately after the
  `Criteria` header row, before the `criteria.map(...)`): `value={presetValue}`, and `onValueChange`
  that finds the preset by `id` in `SCREEN_PRESETS`, and on a hit calls
  `setCriteria(preset.criteria.map((c) => ({ ...c })))` (defensive shallow copy per `context.md`
  § Decisions — prevents mutating the shared constant), then `setPresetValue('')` so the placeholder
  re-renders and the same preset can be re-selected.
- `SelectTrigger` carries `aria-label="Load preset"` (C-17 accessible name) and a `data-testid`
  (e.g. `preset-selector`); `SelectValue` placeholder `"Load preset…"`; each `SelectItem` uses the
  preset `id` as `value` and renders `name` + `description`, with a per-item `data-testid`
  (e.g. `preset-<id>`) for the e2e.
- Reuse tokens/primitives only (C-17) — no hardcoded color, no new `ui/*` primitive; the `Select` is
  the already-imported primitive. Do not extract a separate `PresetSelector` component (design.md
  § Rejected Alternatives — overbuilt; C-18 YAGNI). Do not touch `symbolsText`, `runScan`, or
  `buildScreenCriterion` (out of scope — presets only populate criteria rows).

**Verification**:
- `cd services/xstockstrat-ui && npx tsc --noEmit` — type-checks.
- `cd services/xstockstrat-ui && pnpm run lint` — lint/format gate.
- End-to-end behavioral proof is Step 4.

---

### Step 4 — test: E2E preset-loading scenario on the Screener page

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/screener.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` Service Owner — Trading UI correctness, analytics display accuracy, Connect-RPC call safety, no direct DB access (except audit log)

**Codebase Evidence**:
- Existing screener e2e suite (551 lines): `e2e/insights/screener.spec.ts` — confirmed via
  `grep -n "preset" e2e/insights/screener.spec.ts` → **no matches** (no preset coverage exists yet).
- Criterion-row + control test hooks the scenario reads, from `page.tsx`: `data-testid="criterion-row"`
  (`page.tsx:337`), the metric/comparator/threshold controls (`aria-label` `metric`/`comparator`/
  `threshold`, `page.tsx:364,393,407`), remove button (`aria-label="remove criterion"`, `page.tsx:429`),
  and `Add criterion` button (`page.tsx:468`). Preset control test hooks come from Step 3.
- Auth + fixtures homes (C-12): `e2e/helpers/auth.ts` (`signTestJwt`, `addAuthCookie`) and
  `e2e/fixtures/screenResults.ts` (`recon.md` Codebase Map) — reuse, do not inline.

**TDD**: `red-green required` — authored to **fail** against the pre-Step-3 page (no `preset-selector`
element, criteria builder never reaches 5 preset rows), passing after Step 3 (P-06).

**Covers**: AC-1, AC-2, AC-3, AC-4

**Instructions**:
- Add one `test(...)` (or a small `describe` block) to `e2e/insights/screener.spec.ts`, following the
  file's existing auth/navigation setup (reuse `e2e/helpers/auth.ts`; do not hand-roll a JWT).
- **AC-1**: navigate to `/insights/screener`, open the preset `Select` (`data-testid="preset-selector"`
  / `aria-label="Load preset"`), assert a `Fundamentals Signal` option with its description is listed.
- **AC-2**: select the `Fundamentals Signal` preset; assert exactly 5 `criterion-row` elements with the
  metric/op/threshold/hardFilter values from `acceptance.feature` AC-2 (pe_ratio `<` 35 rank, pb_ratio
  `<` 5 rank, roe `>` 0.05 rank, debt_to_equity `<` 2 rank, eps `>` 0 hard).
- **AC-4**: before loading, ensure ≥1 pre-existing criterion row (the page seeds one default row via
  `useCriteriaList()` — `screenCriteria.ts:56`); after loading assert the builder shows exactly the 5
  preset rows and none of the prior rows remain.
- **AC-3**: after loading, change the pe_ratio row's threshold (e.g. 35→25), remove the eps row, add a
  new criterion; assert the builder then shows 5 rows (4 preset + 1 new) and the pe_ratio threshold
  reads 25.
- **C-12 test-data**: the scenario asserts on criteria-builder DOM state (no backend scan required for
  AC-1–4). If the scenario also runs a scan, reuse the existing `e2e/fixtures/screenResults.ts`
  fixtures — add no inline domain literal and no new fixture module (rule materializes only on a second
  consumer; scenario one-offs stay inline).

**Verification**:
- `cd services/xstockstrat-ui && pnpm test:e2e -- insights/screener.spec.ts` (or `./scripts/run-e2e.sh`
  for the hermetic Docker run) — the new preset scenario passes; suite green. `xstockstrat-ui` has no
  numeric coverage threshold — Playwright e2e is the behavioral gate (`reference/spec-template.md`
  coverage table).
- `cd services/xstockstrat-ui && pnpm run lint` — lint/format gate.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
