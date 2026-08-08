# Implementation Spec: shadcn-migration-custom-composites

**Status**: `pending`
**Created**: 2026-08-08
**Feature**: `docs/roadmap/features/123-shadcn-migration-custom-composites/feature.md`
**Total Steps**: 12
**Feature Branch**: `feature/shadcn-migration-custom-composites`

---

## Execution Summary

Single-service (`xstockstrat-ui`), no proto/config/DB changes. Steps 1–5 land the chart consolidation
(FR-1 close-out, FR-2 new `ui/chart.tsx` primitive, FR-3/FR-4 chart migrations, FR-5 keep-decision
doc note); Steps 6–9 land the repeatable-row-editor composite (FR-6/FR-7/FR-8); Steps 10–11 land the
`Questionnaire` wizard shell (FR-9/FR-10/FR-11); Step 12 is the cross-cutting verification pass
(`pnpm lint`, `pnpm build`, targeted `pnpm test:e2e` specs) plus the acceptance-criteria manual-check
note for the two files with no e2e coverage (`FormulaRunResult.tsx`, `OutputEditor.tsx`/
`ParameterEditor.tsx`). Order follows `design.md`'s Chosen Approach numbering (1–11); Steps within each
FR group are sequenced so a later step's import (`RepeatableRowList`, `ui/chart.tsx`,
`ui/questionnaire.tsx`) always exists before the step that consumes it.

**Consumer Surface(s) (Constitution C-14)**: `/insights` — formula workspace (Steps 4, 7, 8, 9),
rule editor (Step 9), strategy wizard (Steps 10–11), backtest equity-curve display (Step 3). `/trader`
is touched only by Step 5's documentation note (FR-5 "keep" decision) — no `/trader` code change, per
`design.md` § Chosen Approach #5 (Rejected Alternatives: replacing `ChartPanel.tsx`'s
`lightweight-charts` chart). This matches product-spec's `## Consumer Surface(s)` exactly.

**Not included — needs explicit user confirmation before it becomes a step (see `## Deferred Item`
below)**: `design.md`'s Chosen Approach #12 recommends folding `src/app/insights/page.tsx:176-199`'s
second, independent `recharts` `LineChart` (the "Score Trend" dashboard card) into this feature's
`ui/chart.tsx` migration as a natural extension of Step 3's pattern. `design.md`'s own Open Risks
explicitly flag this as "not yet approved scope" requiring the orchestrating session's confirmation
before `/sdd-spec` turns it into concrete steps — expanding product-spec's `/sdd-review`-approved
Affected Services list is a Commandment-level decision (Constitution **C-14**/**C-11**), not something
`/sdd-spec` decides unilaterally. Per root `CLAUDE.md` behavior #1 ("don't assume — ask, and surface
tradeoffs"), this implementation spec does **not** write a step for it. See `## Deferred Item` for the
exact scope-if-confirmed and the file/line evidence.

## Step Dependencies

- Step 3 requires Step 2: `EquityCurveChart.tsx` imports `ChartContainer`/`ChartTooltipContent` from
  the `src/components/ui/chart.tsx` Step 2 creates.
- Step 4 requires Step 2: same import dependency, for `FormulaRunResult.tsx`.
- Step 7 requires Step 6: `OutputEditor.tsx` imports `RepeatableRowList` from
  `src/components/shared/RepeatableRowList.tsx` Step 6 creates.
- Step 8 requires Step 6: same, for `ParameterEditor.tsx`.
- Step 9 requires Step 6: same, for `RuleEditor.tsx`'s condition rows.
- Step 11 requires Step 10: `StrategyWizard.tsx` imports `Questionnaire.*` parts from
  `src/components/ui/questionnaire.tsx` Step 10 creates (CLI-vendored install).
- Step 12 requires Steps 1–11: it is the whole-feature verification pass (lint, build, targeted e2e
  specs across every file the prior steps touch).
- Steps 2–5 (chart group), 6–9 (row-editor group), and 10–11 (wizard group) are otherwise
  independent of each other and may execute in any relative order once their own prerequisite is met.

---

### Step 1 — docs: FR-1 Combobox close-out (verification only, no code change)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `docs/roadmap/features/123-shadcn-migration-custom-composites/context.md` — modify (append
  close-out confirmation, if not already fully recorded by this point)

**Reviewers**: none (docs step)

**Codebase Evidence**:
- Confirmed via `Read src/components/ui/combobox.tsx`: full Base-UI (`@base-ui/react`) compound API
  exported — `Combobox`/`ComboboxInput`/`ComboboxContent`/`ComboboxList`/`ComboboxItem`/`ComboboxEmpty`.
- Confirmed via `Read` on all three call sites: `src/components/trader/ChartPanel.tsx:8-15,91-115`
  imports and uses `Combobox`/`ComboboxInput`/`ComboboxContent`/`ComboboxList`/`ComboboxItem`/
  `ComboboxEmpty`; `src/components/insights/RuleEditor.tsx:4-11,206-238,258-295` same set (two
  `Combobox` instances per condition row — lhs strict-select, rhs free-text). `ComponentEditor.tsx`
  confirmed by `recon.md` Codebase Map (`:5-10,117-131`) — not independently re-read this session, but
  the pattern (grep for `from '@/components/ui/combobox'` returning only the compound-API import) is
  consistent across all three.
- No stray old-API (pre-119, single-prop wrapper) call site found — `recon.md` § Codebase Map already
  confirms this via grep, and `context.md`'s `sdd-review product-spec` session (2026-08-08) independently
  re-verified it.

**TDD**: N/A (docs-only, no behavior change)

**Instructions**:
This FR requires no source-code change — `src/components/ui/combobox.tsx` is already the shadcn
CLI-generated, Base-UI-backed compound component (landed by `119-shadcn-ui-migration`), and all three
call sites already use the current compound API. Append a final close-out line to `context.md`'s
`/sdd-execute` session log stating: "FR-1 verified closed at execute time — no stray old-API Combobox
call site found; `src/components/ui/combobox.tsx` and its 3 call sites unchanged by this feature." This
satisfies product-spec Acceptance Criteria #1.

**Verification**:
```bash
cd services/xstockstrat-ui && grep -rn "from '@/components/ui/combobox'\|from '../ui/combobox'" src/
# expect exactly 3 files: ChartPanel.tsx, ComponentEditor.tsx, RuleEditor.tsx — each importing the
# compound-API named exports (Combobox, ComboboxInput, ComboboxContent, ComboboxList, ComboboxItem)
```

---

### Step 2 — service: FR-2 add `src/components/ui/chart.tsx` (hand-authored, targets installed recharts v2)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/ui/chart.tsx` — create

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- `services/xstockstrat-ui/package.json:50` — `"recharts": "^2.12.7"` (installed major, confirmed via
  grep this session). No `chart.tsx` currently exists: `ls src/components/ui/` (this session) returns
  `badge.tsx, button.tsx, card.tsx, combobox.tsx, input-group.tsx, input.tsx, select.tsx, separator.tsx,
  sheet.tsx, skeleton.tsx, table.tsx, textarea.tsx, utils.ts` — no `chart.tsx`.
- `components.json:1-18` (this session) — `"style": "radix-rhea"`, `"registries": {}` — confirms the
  target style/preset for the registry item design.md fetched live.
- `services/xstockstrat-ui/src/components/ui/button.tsx:1-46` — confirms this repo's post-119 primitive
  shape: plain function component (`function Button({ ... })`), `cva()` for variants, `cn()` from
  `@/components/ui/utils`, no `forwardRef`. `ui/chart.tsx` must follow the same shape.
- `design.md` § Round 2 Proposer point 1 (this feature's own design phase, live-fetched against
  `https://ui.shadcn.com/r/styles/radix-rhea/chart.json`): the registry's `chart.tsx` is v3-targeted in
  exactly two spots vs. the installed v2.12.7 — (a) `ChartContainer` passes an `initialDimension` prop
  to `RechartsPrimitive.ResponsiveContainer` (v2's `ResponsiveContainer` has no such prop — SSR-safe
  initial sizing was added in v3); (b) `import type { TooltipValueType } from "recharts"` (unused by
  this feature's `ChartTooltipContent` usage). `EquityCurveChart.tsx:7` (Step 3's file) already imports
  `ResponsiveContainer` from `recharts` today without `initialDimension`, confirming the v2 API surface
  in actual use in this codebase.

**TDD**: N/A (new primitive file, no existing behavior to regress; Step 3/4's migration is where
red-before-green applies, since that is where user-visible chart behavior changes)

**Instructions**:
1. Fetch the shadcn `radix-rhea` style `chart` registry item (`https://ui.shadcn.com/r/styles/radix-rhea/chart.json`
   — already confirmed live and matching by this feature's `/sdd-design` phase) and use it as the base
   for `src/components/ui/chart.tsx`.
2. Adapt it for the *installed* `recharts@^2.12.7` (not the registry's declared `recharts@3.8.0`), per
   `design.md`'s Chosen Approach #2 (the "adapt, don't bump" decision — do not run
   `npx shadcn@latest add chart` as-is, since that would draft against v3 API surface not present in
   this repo's installed major):
   - Omit the `initialDimension` prop passed to `RechartsPrimitive.ResponsiveContainer` inside
     `ChartContainer`.
   - Drop (or inline a local equivalent type for) the `import type { TooltipValueType } from "recharts"`
     import if `ChartTooltipContent`'s implementation references it.
3. Preserve the registry's composition shape: `ChartContainer` (wraps `ResponsiveContainer`, builds
   `--color-<key>` CSS custom properties from a `ChartConfig` via a `ChartStyle` `<style>` tag),
   `ChartConfig` type (`Record<string, {label, color|theme}>`), `ChartTooltipContent`,
   `ChartLegendContent` — same `data-slot` / plain-function-component convention as
   `button.tsx:39-46` (no `forwardRef`).
4. Place the file at `src/components/ui/chart.tsx`, matching every other `ui/*` primitive's location.

**Verification**:
```bash
cd services/xstockstrat-ui
test -f src/components/ui/chart.tsx && echo "chart.tsx exists"
grep -n "initialDimension\|TooltipValueType" src/components/ui/chart.tsx
# expect: no match for either (both v3-only, dropped per Instructions step 2)
grep -n "ChartContainer\|ChartConfig\|ChartTooltipContent\|ChartLegendContent" src/components/ui/chart.tsx
# expect: all four exported
pnpm lint  # next lint — confirms the new file passes the repo's lint config
```

---

### Step 3 — service: FR-3 migrate `EquityCurveChart.tsx` onto `ui/chart.tsx`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/EquityCurveChart.tsx` — modify

**Reviewers**: `xstockstrat-ui` service owner — analytics display accuracy

**Codebase Evidence**:
- `EquityCurveChart.tsx:1-193` (read this session) — `recharts` `ComposedChart`/`Line`/`Scatter`/
  `Tooltip`, hand-rolled `CurveTooltip` function component at `:45-91` (reads `data-testid="curve-tooltip"`
  at `:62` and `data-testid="marker-tooltip"` at `:66`). Dynamic per-symbol `<Line>` count via
  `series.map(...)` at `:152-164`; `Scatter` with a custom `shape` render-prop for trade markers at
  `:165-186` (`data-testid="trade-marker"` at `:174-175`, `data-kind={m.kind}`). Outer wrapper
  `data-testid="equity-curve-chart"` at `:132`. Empty-state `data-testid="equity-curve-empty"` at `:118`.
- `e2e/insights/backtest-coverage.spec.ts:168` (grepped this session) — `getByTestId('equity-curve-chart')`
  is e2e-load-bearing; must be preserved on whatever element wraps the new `ChartContainer`.
- `LINE_COLORS` array at `:23-28` (4 fixed hex/hsl values, cycled by symbol index) — the source for the
  per-symbol `ChartConfig` entries the new `ChartConfig` needs.

**TDD**: `red-green required`

**Instructions**:
1. Replace the `ResponsiveContainer` + `ComposedChart` wrapper (`:133-188`) with `ui/chart.tsx`'s
   `ChartContainer`, passing a `ChartConfig` built at render time — one entry per `series[i].symbol`
   (mirroring the existing `series.map` dynamic-line-count pattern at `:152-164`), each entry's `color`
   sourced from `LINE_COLORS[i % LINE_COLORS.length]` (`:23-28`) so the visual palette is unchanged.
2. Replace the hand-rolled `CurveTooltip` component (`:45-91`) with `ui/chart.tsx`'s
   `ChartTooltipContent`, adapting its render-prop/formatter hooks to reproduce the same two branches
   `CurveTooltip` has today: a trade-marker point (full trade payload — kind/symbol/side/qty/entry/exit/
   pnl) vs. a plain curve point (date + per-series value). If `ChartTooltipContent`'s default rendering
   cannot express the trade-marker branch without a custom `content`/render override, keep a thin
   wrapper component that supplies that branch and delegates the plain-curve branch to
   `ChartTooltipContent` — do not silently drop the marker-detail rendering FR-3's own Acceptance
   Criteria (#2) requires be preserved.
3. Preserve every `data-testid` **exactly**: `equity-curve-chart` (outer wrapper), `curve-tooltip`
   (tooltip root), `marker-tooltip` (trade-marker tooltip branch), `trade-marker` (`data-kind` attribute
   too), `equity-curve-empty` (unchanged — the empty-state branch at `:111-124` is untouched by this
   migration).
4. Keep the `Scatter` trade-marker overlay (`:165-186`) as direct `recharts` usage inside
   `ChartContainer` — `ui/chart.tsx` is a composition layer over `recharts`, not a replacement for its
   own component API (product-spec FR-2's own framing).

**Verification**:
```bash
cd services/xstockstrat-ui
grep -n "ChartContainer\|ChartTooltipContent" src/components/insights/EquityCurveChart.tsx
grep -n "data-testid=\"equity-curve-chart\"\|data-testid=\"curve-tooltip\"\|data-testid=\"marker-tooltip\"\|data-testid=\"trade-marker\"\|data-testid=\"equity-curve-empty\"" src/components/insights/EquityCurveChart.tsx
# expect: all 5 testids still present, unchanged strings
pnpm lint
pnpm test:e2e -- e2e/insights/backtest-coverage.spec.ts
# red-before-green (P-06): run this spec against the pre-Step-3 tree first and confirm it passes
# today (baseline), then re-run after the migration and confirm it still passes — a regression here
# is the concrete "red" this step's TDD gate watches for, since EquityCurveChart has no pre-migration
# failing-test to write (the e2e spec already covers the rendered chart).
```

---

### Step 4 — service: FR-4 migrate `FormulaRunResult.tsx`'s `Sparkline` onto `ui/chart.tsx`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/FormulaRunResult.tsx` — modify

**Reviewers**: `xstockstrat-ui` service owner — analytics display accuracy

**Codebase Evidence**:
- `FormulaRunResult.tsx:6-27` (read this session) — inline-SVG `Sparkline` component: fixed 140×30
  viewport, no axes, `<polyline>` built from a manually-normalized `values: number[]` array (min/max
  span mapped to y, index mapped to x). Used once per numeric-series output row via `OutputRow`
  (`:36-55`), gated by `asNumberArray(value)` (`:29-34`) returning non-null.
- No `data-testid` on `Sparkline` or `OutputRow` — confirmed by reading the whole file; `recon.md` and
  product-spec Acceptance Criteria #6 both independently confirm `e2e/insights/formulas.spec.ts` never
  interacts with a formula row (grepped this session: file is 64 lines, only references `parameters: []`/
  `outputs: []` in mock payloads, no row-level selector).

**TDD**: `N/A (no e2e selector exists to prove red-before-green against; presentation-parity by
manual check only — see Step 12)`

**Instructions**:
1. Replace the inline-SVG `Sparkline` function (`:7-27`) with a small `recharts` `LineChart` (hidden
   `XAxis`/`YAxis`, no `CartesianGrid`, no `Tooltip` — matching the current no-axis 140×30 look) wrapped
   in `ui/chart.tsx`'s `ChartContainer`, with a single-entry `ChartConfig` (one series, `value`) driving
   the line's stroke color via the CSS custom property instead of the current hard-coded
   `stroke="currentColor"`.
2. Feed the `LineChart` the same `values: number[]` array `Sparkline` receives today via `OutputRow`
   (`:36-55`) — convert to `{ i, value }[]` point objects (index as x) since `recharts` needs a data-key
   shape, not a raw array.
3. Keep the same call site (`OutputRow`'s `{series && <Sparkline values={series} />}` at `:52`) — only
   the internal implementation of the sparkline component changes, not `OutputRow`'s render logic or
   the `asNumberArray` gate (`:29-34`).
4. No `data-testid` needs to be added or preserved (none exists today) — this migration is
   presentation-parity only, per Acceptance Criteria #6's explicit call-out that this file has no e2e
   regression protection.

**Verification**:
```bash
cd services/xstockstrat-ui
grep -n "ChartContainer" src/components/insights/FormulaRunResult.tsx
grep -n "<svg\|<polyline" src/components/insights/FormulaRunResult.tsx
# expect: no match — the inline-SVG implementation is fully removed, not left as a dead code path
pnpm lint
pnpm build
# Manual verification required (no e2e coverage exists for this file — flagged in product-spec
# Acceptance Criteria #6): open a formula's Run Result panel with a numeric-series output in dev
# (pnpm dev) and visually confirm the sparkline still renders at the prior compact size with no axes.
```

---

### Step 5 — docs: FR-5 record the `lightweight-charts` "keep" decision as a sanctioned exception

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/CLAUDE.md` — modify (§ Styling)

**Reviewers**: none (docs step)

**Codebase Evidence**:
- `design.md` § Chosen Approach #5 (this feature's own design phase) — the exact sanctioned-exception
  note text, drafted and flagged as an Open Risk ("must actually be added by the orchestrating session
  ... or a future audit re-flags `ChartPanel.tsx`").
- `services/xstockstrat-ui/src/hooks/useCandlestickChart.ts:1-59` (read this session) — confirms the
  shared hook (`chart.addCandlestickSeries`, v4 API, comment at `:32` already flags the v5 rename) and
  its hard-coded hex theme values (`:35-40`).
- 3 consumers of the hook, confirmed via `recon.md`'s `grep -rln useCandlestickChart src/` (not
  independently re-grepped this session, cited as recon evidence): `src/components/trader/ChartPanel.tsx`,
  `src/app/trader/positions/[symbol]/page.tsx`, `src/app/insights/market/[symbol]/page.tsx`.
- `services/xstockstrat-ui/CLAUDE.md` § Styling (read this session) — existing section structure to
  append the note into; no prior mention of `ChartPanel.tsx` or a candlestick sanctioned exception in
  the file today.

**TDD**: N/A (docs-only, no behavior change)

**Instructions**:
Append this note to `services/xstockstrat-ui/CLAUDE.md` § Styling (verbatim, per `design.md` § Chosen
Approach #5):

> `ChartPanel.tsx` (and its siblings via the shared `useCandlestickChart.ts` hook —
> `trader/positions/[symbol]/page.tsx`, `insights/market/[symbol]/page.tsx`) intentionally stays on
> `lightweight-charts` rather than `recharts`/`ui/chart.tsx` (feature 123 design decision, 2026-08-08):
> `recharts` has no first-party OHLCV candlestick geometry, the hook has 3 shared consumers across
> `/trader` and `/insights`, and `e2e/trader/chart-panel.spec.ts` depends on `lightweight-charts`'s own
> injected `.tv-lightweight-charts` DOM class as an async-readiness signal. Do not re-flag this as an
> unconsolidated charting approach in a future audit.

No source code change accompanies this step — FR-5's decision is "keep," so `ChartPanel.tsx`,
`useCandlestickChart.ts`, and the two sibling consumer pages are untouched.

**Verification**:
```bash
grep -n "ChartPanel.tsx\|lightweight-charts\|feature 123" services/xstockstrat-ui/CLAUDE.md
# expect: the sanctioned-exception paragraph present under § Styling
git diff --stat services/xstockstrat-ui/src/components/trader/ChartPanel.tsx services/xstockstrat-ui/src/hooks/useCandlestickChart.ts
# expect: no changes to either file (confirms "keep" was not accompanied by a stray edit)
```

---

### Step 6 — service: FR-7 extract `src/components/shared/RepeatableRowList.tsx`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/shared/RepeatableRowList.tsx` — create

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness

**Codebase Evidence**:
- `OutputEditor.tsx:57-101` (read this session) — single-tier row shape: 2 `Input`s
  (`aria-label="output name {i}"` / `"output description {i}"`) + move-up/move-down/remove `Button`s
  (`aria-label="move output up/down {i}"` / `"remove output {i}"`), each using `useListEditor`'s
  `update`/`move`/`remove`.
- `ParameterEditor.tsx:149-253` (read this session) — two-tier row shape: header row (`Input` name +
  `Select` type + move/remove `Button`s, `:153-204`) plus a **conditional** body grid
  (`Default`/`Min`/`Max`/`Required`, `:205-245`, `Min`/`Max` only rendered when `isNumericType(p.type)`
  is true) plus a trailing description `Input` (`:246-251`). Not a single flat row.
- `RuleEditor.tsx:204-310` (read this session) — condition row shape: `Combobox` (lhs, strict-select)
  + `Select` (comparator) + `Combobox` (rhs, free-text via `inputValue`/`onInputValueChange`) + a
  **`Remove`-only** button (`:296-308`, no move-up/move-down — order is semantically irrelevant under
  `AND`/`OR`).
- `src/hooks/useListEditor.ts:9-26` (read this session) — generic `{ update, add, remove, move }` over
  `value: T[]` + `onChange` + `makeEmpty`; already the shape all three rows need.
- Existing `ui/` imports confirmed present for all needed primitives: `Card`
  (`src/components/insights/EquityCurveChart.tsx:14`), `Button`/`Input`/`Select`/`Combobox`
  (`OutputEditor.tsx:4-18`, `ParameterEditor.tsx:5-18`, `RuleEditor.tsx:3-18`) — no new shadcn primitive
  needed, confirming product-spec FR-7's own framing ("shadcn's own registry has no 'list editor' or
  'rule builder' recipe to install").

**TDD**: N/A (new presentational component with no prior behavior; Steps 7–9's migrations are where
red-before-green applies against the existing e2e/manual behavior)

**Instructions**:
1. Create `src/components/shared/RepeatableRowList.tsx` as a generic presentational composite: props
   `{ items: T[], onAdd: () => void, addLabel: string, renderRow: (item: T, index: number, ctx: {
   update: (patch: Partial<T>) => void; remove: () => void; move?: (dir: -1 | 1) => void }) => React.ReactNode
   }` (or an equivalent shape — the exact prop names are an implementation detail, not load-bearing;
   the three consumer shapes below ARE load-bearing).
2. Support the three row shapes recon found, via the render-prop taking full control of a row's own
   fields:
   - Single-tier (`OutputEditor` shape: 2 `Input`s + move/remove).
   - Two-tier with a conditional body grid (`ParameterEditor` shape: header row + optional numeric
     grid + trailing `Input`).
   - Move controls optional (`RuleEditor`'s conditions have none — the `ctx.move` callback must be
     omittable/absent when the consumer doesn't pass a `move` handler, not forced on every row).
3. `RepeatableRowList` itself does not call `useListEditor` — each consumer instantiates its own
   `useListEditor(value, onChange, makeEmpty)` and passes the resulting `update`/`add`/`remove`/`move`
   callbacks down, matching `OutputEditor.tsx`/`ParameterEditor.tsx`'s existing pattern (`:47`/`:139`)
   so `RepeatableRowList` stays a pure rendering shell, not a second state-management layer.
4. Build the "Add" button and the row-wrapping structure using existing `ui/` primitives
   (`Card`/`Button`) — do not import a new shadcn primitive; per the DRY guard rail
   (`docs/patterns/dry-guard-rail.md`), this consolidates the `Button variant="outline"` "Add …" pattern
   already duplicated across `OutputEditor.tsx:102-105` and `ParameterEditor.tsx:255-258`.

**Verification**:
```bash
cd services/xstockstrat-ui
test -f src/components/shared/RepeatableRowList.tsx && echo "RepeatableRowList.tsx exists"
grep -n "export function RepeatableRowList" src/components/shared/RepeatableRowList.tsx
pnpm lint
```

---

### Step 7 — service: FR-8a migrate `OutputEditor.tsx` onto `RepeatableRowList` + `useListEditor`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/OutputEditor.tsx` — modify

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness

**Codebase Evidence**:
- `OutputEditor.tsx:46-107` (read this session) — the full current render (row map + Add button) to be
  replaced; `useListEditor(value, onChange, emptyOutput)` at `:47` already provides `update`/`add`/
  `remove`/`move` — this call is **kept**, only the JSX consuming it changes.
- No e2e selector coverage exists for this file's row interactions (confirmed by
  `e2e/insights/formulas.spec.ts` — grepped this session, 64 lines, no row-level `aria-label`/testid
  query) — this migration relies on manual verification (Step 12), not e2e regression protection, per
  product-spec Acceptance Criteria #6.

**TDD**: `N/A (no e2e selector exists to prove red-before-green against — see Step 4's identical
situation; manual verification in Step 12 substitutes)`

**Instructions**:
1. Replace the `value.map(...)` row block (`:57-101`) and the trailing "Add output" `Button`
   (`:102-105`) with a single `<RepeatableRowList items={value} onAdd={add} addLabel="Add output"
   renderRow={...} />` call, keeping the existing `useListEditor` destructure at `:47` unchanged.
2. In the `renderRow` render-prop, reproduce `OutputEditor`'s exact current row: the two `Input`s with
   their existing `aria-label`s (`output name {i}` / `output description {i}`) and placeholders, and the
   move-up/move-down/remove `Button`s with their existing `aria-label`s (`move output up/down {i}` /
   `remove output {i}`) and `disabled` conditions (`i === 0`, `i === value.length - 1`) — these
   `aria-label`s are not e2e-asserted today but are still the accessible-name contract for this row;
   preserve them verbatim rather than inventing new ones.
3. Delete no logic from `useListEditor` itself — `OutputEditor.tsx` was already using the shared hook
   before this feature (recon confirms); this step is purely a markup/composition change onto
   `RepeatableRowList`.

**Verification**:
```bash
cd services/xstockstrat-ui
grep -n "RepeatableRowList" src/components/insights/OutputEditor.tsx
grep -n "output name \${i}\|output description \${i}\|move output up \${i}\|move output down \${i}\|remove output \${i}" src/components/insights/OutputEditor.tsx
# expect: all 5 aria-label templates still present
pnpm lint
pnpm build
# Manual verification (no e2e coverage): pnpm dev, open a formula's Outputs editor, confirm add/
# move-up/move-down/remove still work identically.
```

---

### Step 8 — service: FR-8b migrate `ParameterEditor.tsx` onto `RepeatableRowList` + `useListEditor`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/ParameterEditor.tsx` — modify

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness

**Codebase Evidence**:
- `ParameterEditor.tsx:138-260` (read this session) — the full current render (row map + Add button);
  `useListEditor(value, onChange, emptyParameter)` at `:139` is **kept**.
- Two-tier row structure confirmed by direct read: header row `:152-204` (name `Input` + type `Select`
  + move/remove `Button`s), conditional numeric grid `:205-234` (`Default`/`Min`/`Max`, `Min`/`Max`
  gated by `numeric = isNumericType(p.type)` at `:150`), `Required` checkbox `:236-244`, trailing
  description `Input` `:246-251`.
- Same no-e2e-coverage situation as Step 7 (`e2e/insights/formulas.spec.ts` confirmed empty of
  row-level selectors).

**TDD**: `N/A (same as Step 7 — no e2e selector to prove red-before-green against; manual verification
in Step 12)`

**Instructions**:
1. Replace the `value.map(...)` row block (`:149-254`) and the trailing "Add parameter" `Button`
   (`:255-258`) with a `<RepeatableRowList items={value} onAdd={add} addLabel="Add parameter"
   renderRow={...} />` call, keeping the existing `useListEditor` destructure at `:139` unchanged.
2. In `renderRow`, reproduce the exact current two-tier structure: header row (name `Input` + type
   `Select` with `TYPE_OPTIONS` at `:38-43` + move/remove `Button`s, all existing `aria-label`s
   preserved verbatim: `parameter name {i}`, `parameter type {i}`, `move parameter up/down {i}`,
   `remove parameter {i}`), then the conditional grid (`Default` `Input` always shown, `Min`/`Max`
   `Input`s only when `numeric` is true, `Required` checkbox), then the trailing description `Input` —
   all `aria-label`s preserved verbatim (`parameter default {i}`, `parameter min/max {i}`,
   `parameter required {i}`, `parameter description {i}`).
3. `RepeatableRowList`'s render-prop must support this two-tier + conditional-grid shape (confirmed
   feasible in Step 6's design — the render-prop takes full control of a row's own JSX).

**Verification**:
```bash
cd services/xstockstrat-ui
grep -n "RepeatableRowList" src/components/insights/ParameterEditor.tsx
grep -n "parameter name \${i}\|parameter type \${i}\|parameter default \${i}\|parameter min \${i}\|parameter max \${i}\|parameter required \${i}\|parameter description \${i}\|move parameter up \${i}\|move parameter down \${i}\|remove parameter \${i}" src/components/insights/ParameterEditor.tsx
# expect: all 10 aria-label templates still present
pnpm lint
pnpm build
# Manual verification (no e2e coverage): pnpm dev, open a formula's Parameters editor, confirm the
# numeric-type Min/Max grid still shows/hides correctly and add/move/remove still work.
```

---

### Step 9 — service: FR-6 + FR-8c bind `RuleEditor.tsx`'s conditions to `useListEditor` and migrate onto `RepeatableRowList`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/RuleEditor.tsx` — modify

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness

**Codebase Evidence**:
- `RuleEditor.tsx:22-28` (read this session) — `type Condition = { lhs: string; fn: RuleFn; rhs: string }`,
  `type RuleTree = { op: 'AND'|'OR'; conditions: Condition[] }` — despite the "tree" name,
  `conditions` is a **flat array**, directly compatible with `useListEditor<T extends object>`.
- `RuleEditor.tsx:128-131` (`updateTree` helper) and `:204-325` (the current bespoke visual-mode render
  — `tree.conditions.map(...)` at `:204`, an inline "Add condition" `onClick` at `:316-322` that
  constructs a `{ lhs: '', fn: '>', rhs: '' }` literal, and a per-row inline `Remove`-only `Button` at
  `:296-308` calling `tree.conditions.filter((_, j) => j !== i)`) — this is the independent add/remove
  logic FR-6/FR-8 require deleting.
- `src/hooks/useListEditor.ts:9-26` — `useListEditor<T extends object>(value: T[], onChange:
  (next: T[]) => void, makeEmpty: () => T)` — `Condition` satisfies `T extends object`.

**TDD**: `red-green required` (this step changes real interactive behavior — condition
add/edit/remove — with e2e coverage adjacent, per Step 12's spec run against the surrounding wizard
flow, even though no selector targets the rows directly)

**Instructions**:
1. Inside `RuleEditor`, replace the ad hoc `updateTree`-based add/remove logic for `tree.conditions`
   with `useListEditor<Condition>(tree.conditions, (next) => updateTree({ ...tree, conditions: next }),
   () => ({ lhs: '', fn: '>', rhs: '' }))`, matching `design.md`'s Chosen Approach #6 exactly — this
   `makeEmpty` literal is the same one the current inline "Add condition" handler constructs at `:319`,
   so the empty-row shape is unchanged.
2. Replace the `tree.conditions.map(...)` block (`:204-310`) and the "Add condition" `Button`
   (`:312-324`) with a `<RepeatableRowList items={tree.conditions} onAdd={add} addLabel="Add condition"
   renderRow={...} />` call, using the `useListEditor` `update`/`remove` from step 1 — **no `move`
   handler is passed** (`RuleEditor`'s conditions have no move-up/move-down today; order is semantically
   irrelevant under `AND`/`OR` — `RepeatableRowList`'s move controls must render as absent, not
   disabled, when `ctx.move` is not supplied, per Step 6's "optional move controls" requirement).
3. In `renderRow`, reproduce the exact current row: the lhs `Combobox` (strict-select,
   `aria-label="left operand"`, `:206-238`), the comparator `Select` (`aria-label="comparator"`,
   `:239-257`), the rhs `Combobox` (free-text via `inputValue`/`onInputValueChange`,
   `aria-label="right operand"`, `:258-295`), and the `Remove`-only `Button` (`:296-308`, text
   `"Remove"`) — all preserved verbatim, since `RuleEditor.tsx`'s visual condition-tree builder carries
   no e2e-load-bearing selector (confirmed by `context.md`'s `sdd-review` session grep — only the `JSON`
   mode-toggle button and the two textareas are e2e-load-bearing, both outside this render branch).
4. Do **not** touch `RuleEditor.tsx:326-335`'s JSON-mode `<textarea>` — that is a disjoint line range
   owned by sibling feature `120-shadcn-migration-high-confidence` (per `context.md`'s
   `sdd-review product-spec` overlap-check note); this step only touches the visual-mode condition rows
   inside the `mode === 'visual'` branch (`:179-325`).
5. Delete the now-redundant inline construction/filter logic this step's `useListEditor` binding
   replaces — no independent add/remove implementation should remain in `RuleEditor.tsx` after this
   step (product-spec Acceptance Criteria #4).

**Verification**:
```bash
cd services/xstockstrat-ui
grep -n "useListEditor" src/components/insights/RuleEditor.tsx
grep -n "RepeatableRowList" src/components/insights/RuleEditor.tsx
grep -n 'tree.conditions.filter\|tree.conditions, { lhs' src/components/insights/RuleEditor.tsx
# expect: no match — the bespoke filter/push-literal logic is gone, replaced by useListEditor calls
grep -n 'aria-label="left operand"\|aria-label="comparator"\|aria-label="right operand"' src/components/insights/RuleEditor.tsx
# expect: all 3 still present
pnpm lint
pnpm build
pnpm test:e2e -- e2e/insights/strategy-authoring.spec.ts
# red-before-green (P-06): confirm this spec passes on the pre-Step-9 tree (baseline — it already
# exercises RuleEditor indirectly via the wizard's Step 3), then re-run after and confirm it still
# passes. The spec's JSON-mode/textarea assertions (untouched by this step) act as the regression
# guard for RuleEditor's overall wiring even though no assertion targets the visual-mode rows directly.
```

---

### Step 10 — service: FR-9 install the shadcn `Questionnaire` primitive (CLI-vendored)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/ui/questionnaire.tsx` — create (CLI-generated)
- `services/xstockstrat-ui/package.json` — modify (pin `@shadcn/react` to an exact version)
- `services/xstockstrat-ui/pnpm-lock.yaml` — modify (regenerated by the CLI/install)

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness

**Codebase Evidence**:
- `design.md` § Chosen Approach #9 (this feature's own design phase, live-verified against
  `https://ui.shadcn.com/r/styles/radix-rhea/questionnaire.json`) — the CLI-vendored registry item
  exists, matches this repo's `radix-rhea` style exactly, and still transitively depends on
  `@shadcn/react` even in its CLI-vendored/styled form.
- `design.md` § Dependencies / Open Risks — `@shadcn/react` verified directly against the live npm
  registry at design time: latest **0.3.0**, created 2026-06-26, last modified 2026-08-05 (3 days
  before the design session) — pre-1.0, actively-changing. **Open Risk, carried forward**: re-verify
  this version/API is still current immediately before running the CLI at execute time (per the
  `trader-chart-panel` ledger pattern — a fast-moving external dependency must be re-checked right
  before use, not just at design time weeks/days earlier).
- `services/xstockstrat-ui/CLAUDE.md` § Styling (read this session) — "Adding a primitive not yet in
  `src/components/ui/`: `npx shadcn@latest add <name>`" is this repo's documented norm; `package.json:51`
  confirms the `shadcn` CLI package is already an installed dependency (`"shadcn": "^4.16.2"`).
- `recon.md` § Risks/Not-found — the raw registry payload's `questionnaire.tsx` imports
  `IconPlaceholder` from a shadcn-demo-app-specific path; expected to resolve correctly through the
  actual CLI flow (which performs the icon-library substitution `combobox.tsx`'s
  `@tabler/icons-react` imports already went through), not confirmed by fetching the raw payload
  directly — flag as a fallback risk only if the CLI is unavailable at execute time.

**TDD**: N/A (new primitive install, no existing behavior to regress; Step 11's wizard-shell migration
is where red-before-green applies)

**Instructions**:
1. **Before running the CLI**, re-verify `Questionnaire`'s API and `@shadcn/react`'s current published
   version against the live shadcn docs/npm registry (the Open Risk above) — if the API has changed
   materially since 2026-08-08, stop and flag it rather than proceeding on stale design evidence (P-03,
   no silent deviation).
2. Run `npx shadcn@latest add questionnaire` against the existing `components.json` preset — this is
   the CLI-vendored path `design.md` § Rejected Alternatives chose over a direct `pnpm add @shadcn/react`
   + hand-import, since the CLI path costs nothing extra (same transitive dependency either way) and
   yields an already-styled, already-`data-slot`-convention-matching wrapper file for free.
3. After the CLI installs `@shadcn/react` as a transitive dependency, edit `package.json` to **pin it to
   an exact version** (no caret range) — e.g. `"@shadcn/react": "0.3.0"` (or whatever version the
   re-verification in step 1 confirms is current) — per its pre-1.0/actively-changing status.
4. Regenerate `pnpm-lock.yaml` accordingly (`pnpm install` after the manual pin, if the CLI's own
   install didn't already produce a lockfile consistent with the pinned version).

**Verification**:
```bash
cd services/xstockstrat-ui
test -f src/components/ui/questionnaire.tsx && echo "questionnaire.tsx exists"
grep -n "IconPlaceholder" src/components/ui/questionnaire.tsx
# expect: either no match (CLI substitution worked) or a resolvable @tabler/icons-react-style import —
# NOT the raw shadcn-demo-app path `@/app/(create)/components/icon-placeholder` (recon Risk flag)
grep -n '"@shadcn/react"' package.json
# expect: an exact version (e.g. "0.3.0"), not a caret/tilde range
pnpm install --frozen-lockfile  # confirms package.json and pnpm-lock.yaml are consistent
pnpm lint
pnpm build
```

---

### Step 11 — service: FR-10/FR-11 replace `StrategyWizard.tsx`'s step indicator with `Questionnaire.Progress` (shell only)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/StrategyWizard.tsx` — modify

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness

**Codebase Evidence**:
- `StrategyWizard.tsx:60-61` (read this session) — `const [step, setStep] = useState(1);` — own React
  state, not a library; `STEPS` array at `:23` (`['Identity', 'Components', 'Rules', 'Review']`).
- `StrategyWizard.tsx:159-178` (read this session) — the `<ol>` step indicator to replace: numbered
  pills via `STEPS.map`, `cn()` ternary for active (`n === step`) / complete (`n < step`) / upcoming
  tone.
- `StrategyWizard.tsx:316` — the error-jump link `"Go to Step {n}"`, confirmed **not** the step
  indicator (a different element inside the Step 4 review branch, `:306-319`) — per `context.md`'s
  `sdd-review` session, `e2e/insights/strategy-authoring.spec.ts:254`'s
  `getByRole('button', {name: /Go to Step/})` targets this link, not the `<ol>`, so the `<ol>` is free
  to be replaced without a selector rewrite.
- `StrategyWizard.tsx:325-346` (read this session) — navigation: `Back` button (`:327-334`, disabled at
  step 1), `Next` button (`:337-339`, disabled via `canAdvance`), `Create Strategy`/`Save Changes`
  button (`:341-343`, text depends on `mode`). Confirmed e2e-load-bearing via grep on
  `e2e/insights/strategy-authoring.spec.ts` this session: `getByRole('button', { name: 'Next', exact:
  true })` (lines 60, 195, 237, 276, 356, 378, 448), `getByRole('button', { name: 'Create Strategy' })`
  (lines 226, 250, 307, 319, 399, 411), `getByRole('button', { name: 'Save Changes' })` (lines 360, 382,
  452).
- `design.md` § Chosen Approach #10 — **FR-10: shell only (option a), for the entire wizard.** Every
  step ruled out from restructuring (option b) with recon-traced evidence: Step 2 (dynamic
  `ComponentEditor` list) and Step 3 (two `RuleEditor` instances — nested condition tree) both fail
  `Questionnaire`'s single-scalar-answer-per-`Item` model outright; Step 1's 4 independent fields are
  the closest structural fit, but splitting them into 4 separate `Questionnaire.Item` screens would be
  an Out-of-Scope UX/step-count redesign; Step 4 has no fields to collect and trivially fits option (a)
  via `Questionnaire.Submit`. `StrategyWizard.tsx` keeps its own `step`/`setStep` React state exactly as
  today — `Questionnaire.Root`/`Item`/`Progress`/`Previous`/`Next`/`Submit` supply chrome only.
- `recon.md` § Patterns to REUSE — the fetched `questionnaire.tsx` registry payload's `QuestionnaireItem`
  forwards `{...props}` including arbitrary `children` to the underlying primitive, confirming
  `Questionnaire.Item` is not structurally restricted to `Choices`/`Input` content — this is what makes
  option (a) (shell-only, existing rich step content un-refactored inside a `Questionnaire.Item`)
  feasible.

**TDD**: `red-green required`

**Instructions**:
1. Replace the `<ol>` step indicator (`:159-178`) with `Questionnaire.Progress` (from the
   `src/components/ui/questionnaire.tsx` Step 10 creates), driven by the existing `step`/`STEPS.length`
   state — do not adopt `Questionnaire.Root`'s own `item`/`onItemChange`/`FormData`-driven
   answer-and-validation model; `StrategyWizard.tsx` keeps its own `step`/`setStep` as the single source
   of truth (per `design.md`'s explicit "chrome only" framing) so Steps 2/3's rich sub-forms
   (`ComponentEditor` list, `RuleEditor` instances) remain un-refactored inside their existing render
   branches (`:244-283`).
2. If `Questionnaire.Root`/`Item` require being present in the tree for `Questionnaire.Progress`,
   `Questionnaire.Next`/`Previous`/`Submit` to render at all (verify against the actual installed
   `questionnaire.tsx` from Step 10, not assumed from the raw registry payload), wrap the existing step
   content (`:187-321`) in a minimal `Questionnaire.Root`/`Questionnaire.Item` shell without changing
   what each step renders — the wrapping is chrome, the content inside stays `StrategyWizard`'s own JSX.
3. Replace the navigation `Button`s (`:325-346`) with `Questionnaire.Previous`/`Questionnaire.Next`/
   `Questionnaire.Submit` **only if** those parts support a `children` override for their default text
   (confirmed feasible in `recon.md` — "`children ?? 'Next'`-style fallback pattern") — preserve the
   exact button text e2e-load-bearing: `Back`, `Next`, `Create Strategy` / `Save Changes` (mode-
   dependent). If the installed `questionnaire.tsx`'s navigation parts do not support a clean text
   override without fighting their internal disabled/click-handler wiring, keep `StrategyWizard`'s
   existing `Button`s for navigation and use `Questionnaire.Progress` alone for FR-11's actual ask (the
   `<ol>` replacement) — the shell-only decision does not require every navigation control to migrate,
   only the step indicator (product-spec FR-11's literal scope).
4. Do not change step **count**, **order**, or **content** — FR-10's shell-only decision explicitly
   excludes any restructuring of what each step collects (product-spec Out-of-Scope).

**Verification**:
```bash
cd services/xstockstrat-ui
grep -n "Questionnaire" src/components/insights/StrategyWizard.tsx
grep -n "<ol" src/components/insights/StrategyWizard.tsx
# expect: no match — the hand-rolled <ol> is fully replaced
grep -n "'Back'\|'Next'\|'Create Strategy'\|'Save Changes'\|Go to Step" src/components/insights/StrategyWizard.tsx
# expect: all navigation/error-jump text still present verbatim
pnpm lint
pnpm build
pnpm test:e2e -- e2e/insights/strategy-authoring.spec.ts
# red-before-green (P-06): confirm this spec passes on the pre-Step-11 tree (baseline), then re-run
# after the migration and confirm every Next/Back/Create Strategy/Save Changes/Go to Step assertion
# still passes — this is the concrete regression guard for FR-10/FR-11's shell swap.
```

---

### Step 12 — test: whole-feature verification pass

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- (no new files — this step verifies Steps 1–11's combined changes)

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- Product-spec Acceptance Criteria #6 (as tightened by `context.md`'s `sdd-review product-spec`
  session) — the exact spec-file/selector list this step must pass:
  `e2e/insights/strategy-authoring.spec.ts` (step indicator via button text, `Go to Step`, `Add
  component`, `JSON` toggle, `getByLabel('Entry rule JSON'/'Exit rule JSON')`),
  `e2e/insights/backtest-coverage.spec.ts` (`getByTestId('equity-curve-chart')`),
  `e2e/trader/chart-panel.spec.ts` (`getByTestId('chart-container')` — unaffected by this feature per
  FR-5's "keep" decision, included as a regression check that Step 5's doc-only change didn't
  accidentally touch chart code).
- Same Acceptance Criteria #6 — `FormulaRunResult.tsx`'s sparkline (Step 4) and
  `OutputEditor.tsx`/`ParameterEditor.tsx`'s row controls (Steps 7–8) have **no e2e selector
  coverage** — confirmed by this feature's own grep against `e2e/insights/formulas.spec.ts` (64 lines,
  no row-level query) — so this step's verification for those three files is explicitly manual, not a
  gap to silently accept as "covered."

**TDD**: N/A (aggregation/verification step, not new behavior)

**Instructions**:
Run the full lint/build/e2e pass across every file Steps 1–11 touched, and perform the manual checks
Acceptance Criteria #6 requires for the two files with no e2e coverage. No code changes in this step —
if any command fails, the fix belongs in the step that introduced the regression (per **F-09**, this
step's own body stays immutable; a fix is a deviation-log entry against the earlier step, not a new
edit here).

**Verification**:
```bash
cd services/xstockstrat-ui
pnpm lint
pnpm build
pnpm test:e2e -- e2e/insights/strategy-authoring.spec.ts e2e/insights/backtest-coverage.spec.ts e2e/trader/chart-panel.spec.ts
# expect: all three specs pass with no selector changes needed beyond what each step's own
# Verification already confirmed

# Manual verification (no e2e coverage exists for these — Acceptance Criteria #6):
# 1. pnpm dev
# 2. Open a formula's Run Result panel with a numeric-series output — confirm the ChartContainer-based
#    sparkline (Step 4) renders at the same compact size/position as before.
# 3. Open a formula's Outputs editor (OutputEditor, Step 7) — confirm add/move-up/move-down/remove.
# 4. Open a formula's Parameters editor (ParameterEditor, Step 8) — confirm the numeric Min/Max grid
#    still shows/hides on type change, and add/move/remove.
# 5. Open the strategy wizard's Rules step (RuleEditor, Step 9) — confirm visual-mode condition
#    add/remove still works and the JSON toggle round-trips correctly.
```

---

## Deferred Item — needs explicit user confirmation, not included as a step

**`design.md` § Chosen Approach #12 / § Open Risks**: `src/app/insights/page.tsx:176-199`'s dashboard
"Score Trend" card is a second, independent hand-rolled `recharts` `LineChart` (`CartesianGrid`/
`XAxis`/`YAxis`/`Tooltip`/`Line` with inline `contentStyle`/`labelStyle`) — confirmed this session by
direct read (`sed -n '170,205p'`). It is the same charting-fragmentation shape FR-2/FR-3 exist to fix,
but it is **not named** in product-spec's Affected Services / Consumer Surface, and `design.md`'s own
Open Risks explicitly flag it as requiring the orchestrating session's confirmation before `/sdd-spec`
turns it into concrete steps — "not yet approved scope."

**If confirmed by the user**, the follow-up step would be materially simpler than Step 3
(`EquityCurveChart.tsx`): no dynamic series, no trade-marker `Scatter` overlay — migrate
`src/app/insights/page.tsx:176-199`'s `ResponsiveContainer`/`LineChart` onto `ui/chart.tsx`'s
`ChartContainer` with a single-entry `ChartConfig`, same pattern as Step 4. No e2e selector was found
targeting this chart specifically (not independently verified this session — would need a grep pass
before that step is written).

**Action needed**: the user (or the orchestrating session on the user's behalf) must explicitly decide
whether to (a) fold this into the current feature via a product-spec amendment + a re-run of
`/sdd-review product-spec` (since it expands the already-approved Affected Services list), or (b) leave
it for a separate, later feature. This implementation spec does not implement it either way — Steps
1–12 above are complete and self-contained without it.

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
