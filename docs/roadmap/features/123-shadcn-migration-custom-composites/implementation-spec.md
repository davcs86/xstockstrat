# Implementation Spec: shadcn-migration-custom-composites

**Status**: `pending`
**Created**: 2026-08-08
**Updated**: 2026-08-09 (Round 4 user-directed override — `recharts` bumped to v3 repo-wide, and the
former Deferred Item folded in as FR-12; Total Steps 13 → 15. See `design.md` § Round 4 and
`context.md`'s 2026-08-09 session entry.)
**Feature**: `docs/roadmap/features/123-shadcn-migration-custom-composites/feature.md`
**Total Steps**: 15
**Feature Branch**: `feature/shadcn-migration-custom-composites`

---

## Execution Summary

Single-service (`xstockstrat-ui`), no proto/config/DB changes. Steps 1–7 land the chart consolidation
(FR-1 close-out; FR-2's repo-wide `recharts` v2→v3 dependency bump, Step 2; new `ui/chart.tsx`
primitive via the CLI run as-is against v3, Step 3; FR-3/FR-4 chart migrations, Steps 4–5; FR-5
keep-decision doc note, Step 6; FR-12's second-chart migration, Step 7); Steps 8–11 land the
repeatable-row-editor composite (FR-6/FR-7/FR-8); Steps 12–14 land the `Questionnaire` wizard shell
(FR-9 install, then FR-10 split per `design.md` § Round 3's user-directed override — Step 13
restructures `StrategyWizard.tsx`'s Step 1 onto `Questionnaire`'s native Choice/Input answer model,
Step 14 shell-wraps Steps 2/3/4 exactly as originally spec'd plus FR-11's outer step indicator); Step
15 is the cross-cutting verification pass (`pnpm lint`, `pnpm build`, targeted `pnpm test:e2e` specs)
plus the acceptance-criteria manual-check note for the three files with no e2e coverage
(`FormulaRunResult.tsx`, `OutputEditor.tsx`/`ParameterEditor.tsx`, `insights/page.tsx`'s Score Trend
chart). Order follows `design.md`'s Chosen Approach numbering; steps within each FR group are sequenced
so a later step's import (`RepeatableRowList`, `ui/chart.tsx`, `ui/questionnaire.tsx`) always exists
before the step that consumes it, and the `recharts` version bump (Step 2) always lands before any step
that adds or migrates `recharts`-based chart code.

**Revision note (2026-08-08)**: the original Step 11 ("FR-10/FR-11 replace `StrategyWizard.tsx`'s step
indicator with `Questionnaire.Progress` (shell only)") assumed `design.md`'s original FR-10 conclusion
— shell-only for the *entire* wizard, Step 1 included. The user has since directly overridden that for
Step 1 specifically (`design.md` § Round 3): Step 1 restructures onto `Questionnaire`'s native
Choice/Input answer model (4 nested sub-screens); Steps 2/3/4 remain exactly as originally spec'd
(shell-only, unchanged). The original Step 11 was split into two steps (Step 1 restructure, then the
unchanged Steps 2-4 shell), and the trailing whole-feature verification step renumbered accordingly.

**Revision note (2026-08-09, Round 4)**: `design.md`'s FR-2 (recharts-version handling) and Chosen
Approach #12 (the `insights/page.tsx` second chart, previously the `## Deferred Item` below) were both
resolved via the user's direct override (`design.md` § Round 4): **bump `recharts` to v3 repo-wide**
(new Step 2), and **fold `insights/page.tsx`'s second chart into this feature now** (new Step 7, FR-12).
This adds 2 steps to the prior 13-step plan (Total Steps 13 → 15); every step from the old Step 2 onward
is renumbered +1 up to the old Step 5 (chart group), then +2 from the old Step 6 onward (row-editor and
wizard groups). The `## Deferred Item` section below is retained only as a historical record of what was
deferred and why, superseded by Step 7.

**Consumer Surface(s) (Constitution C-14)**: `/insights` — formula workspace (Steps 5, 9, 10, 11),
rule editor (Step 11), strategy wizard (Steps 12–14), backtest equity-curve display (Step 4), dashboard
Score Trend card (Step 7, FR-12, added 2026-08-09). `/trader` is touched only by Step 6's documentation
note (FR-5 "keep" decision) — no `/trader` code change, per `design.md` § Chosen Approach #5 (Rejected
Alternatives: replacing `ChartPanel.tsx`'s `lightweight-charts` chart). This matches product-spec's
`## Consumer Surface(s)` exactly.

## Step Dependencies

- Step 3 requires Step 2: `ui/chart.tsx` is authored via the CLI run against the `recharts` v3 Step 2
  installs — running the CLI before the bump would draft against the pre-bump v2 API surface again.
- Step 4 requires Steps 2 and 3: `EquityCurveChart.tsx` imports `ChartContainer`/`ChartTooltipContent`
  from the `src/components/ui/chart.tsx` Step 3 creates, and its `CartesianGrid` fix (landed in Step 2)
  must already be in place.
- Step 5 requires Step 3: same import dependency, for `FormulaRunResult.tsx` (Step 5's `recharts` usage
  is new code, written directly against the v3 Step 2 installs — no separate breaking-change fix needed
  in this file, per `design.md` § Round 4's recon).
- Step 7 requires Steps 2 and 3: same as Step 4 — `insights/page.tsx` imports `ChartContainer`/
  `ChartTooltipContent` from `ui/chart.tsx`, and its `CartesianGrid` fix (landed in Step 2) must already
  be in place.
- Step 9 requires Step 8: `OutputEditor.tsx` imports `RepeatableRowList` from
  `src/components/shared/RepeatableRowList.tsx` Step 8 creates.
- Step 10 requires Step 8: same, for `ParameterEditor.tsx`.
- Step 11 requires Step 8: same, for `RuleEditor.tsx`'s condition rows.
- Step 13 requires Step 12: `StrategyWizard.tsx`'s Step 1 restructure imports `Questionnaire.*` parts
  from `src/components/ui/questionnaire.tsx` Step 12 creates (CLI-vendored install).
- Step 14 requires Step 12 (same `Questionnaire.*` import dependency, for Steps 2/3/4's shell wrap and
  the outer step indicator) **and** Step 13 (both steps modify `StrategyWizard.tsx`; sequenced to avoid
  concurrent edits to the same file within one execution pass — not a hard code dependency, since Step
  13 touches only the Step-1 render branch and Step 14 touches the outer shell + Steps 2/3/4 branches).
- Step 15 requires Steps 1–14: it is the whole-feature verification pass (lint, build, targeted e2e
  specs across every file the prior steps touch).
- Step 2 (the dependency bump) has no prerequisite — it is the first code-touching step, before either
  chart group's own migrations.
- Steps 2–7 (chart group), 8–11 (row-editor group), and 12–14 (wizard group) are otherwise independent
  of each other and may execute in any relative order once their own prerequisite is met.

---

### Step 1 — docs: FR-1 Combobox close-out (verification only, no code change)

**Status**: `done`
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

### Step 2 — service: FR-2 bump `recharts` to v3 repo-wide (dependency bump + minimal build-green fix)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/package.json` — modify (`recharts` `^2.12.7` → `^3.8.0`)
- `services/xstockstrat-ui/pnpm-lock.yaml` — modify (regenerated by the bump)
- `services/xstockstrat-ui/src/components/insights/EquityCurveChart.tsx` — modify (minimal
  `CartesianGrid` fix only — the full `ChartContainer` migration is Step 4)
- `services/xstockstrat-ui/src/app/insights/page.tsx` — modify (same minimal `CartesianGrid` fix — the
  full `ChartContainer` migration is Step 7)

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- `services/xstockstrat-ui/package.json:50` — `"recharts": "^2.12.7"` (installed major, confirmed via
  grep this session).
- `design.md` § Round 4 (this feature's own design phase, user-directed override, 2026-08-09) — the
  full verified recharts v2→v3 breaking-changes list, cited from the orchestrating session's live fetch
  (not re-derived here). The two exposures relevant to this repo's already-shipped charts:
  - **`CartesianGrid`: new required `xAxisId`/`yAxisId` props.** Confirmed via direct read this
    session: `EquityCurveChart.tsx:135` (`<CartesianGrid strokeDasharray="3 3" stroke="hsl(222 20%
    14%)" />`) and `src/app/insights/page.tsx:177` (identical call) both omit these props today. Both
    files' `XAxis`/`YAxis` calls (`EquityCurveChart.tsx:136-150`, `insights/page.tsx:178-179`) are
    themselves unid'd, so they use recharts' implicit default axis id `0` — the fix is
    `xAxisId={0} yAxisId={0}` on each `CartesianGrid`, not a behavior change, just satisfying the new
    required-prop type.
  - **`Scatter`'s `points` prop removed** — confirmed **not applicable**: `EquityCurveChart.tsx:165-186`
    uses `data`/`dataKey`/`shape` (a custom render-prop for trade markers), never the `points` prop.
  - **`activeIndex` removed from all components** — confirmed **not applicable**: grepped
    `services/xstockstrat-ui/src` for `activeIndex`, zero matches.
  - **`Customized`'s state props removed** — confirmed **not applicable**: grepped for `Customized`,
    zero matches.
  - **`ResponsiveContainer`'s `ref.current.current` flattening** — confirmed **not applicable**: both
    files' `ResponsiveContainer` calls (`EquityCurveChart.tsx:133`, `insights/page.tsx:175`) are plain
    `width="100%" height={...}` with no `ref` prop at all.
- `design.md` § Round 4 — `FormulaRunResult.tsx` confirmed to have **zero** `recharts` usage today (its
  current `Sparkline` is hand-rolled inline SVG) — Step 5 introduces its first `recharts` usage as new
  code written directly against v3, so it needs no fix in this step.
- Confirmed via grep this session: exactly 2 files under `services/xstockstrat-ui/src` import from
  `'recharts'` — `EquityCurveChart.tsx` and `insights/page.tsx` — matching the two files' fix list above
  exactly, no other consumer exists.

**TDD**: N/A (dependency bump + a minimal, mechanical required-prop fix — no behavior change; Steps
4/7's later `ChartContainer` migrations are where red-before-green applies against user-visible chart
behavior)

**Instructions**:
1. **Before bumping**, re-verify `recharts`'s current latest 3.x release against the npm registry (per
   `design.md` § Round 4's Open Risk — a fast-moving-enough check to redo right before use, mirroring
   the pattern already applied to `@shadcn/react` in Step 12) — this feature's own live registry-payload
   fetches (Round 1/2) cited `recharts@3.8.0` as the shadcn `chart` registry item's declared dependency;
   confirm this (or a newer 3.x patch/minor) is still current.
2. Update `services/xstockstrat-ui/package.json`'s `"recharts"` entry from `"^2.12.7"` to `"^3.8.0"` (or
   the re-verified current 3.x version from step 1).
3. Run `pnpm install` to regenerate `pnpm-lock.yaml` against the new version.
4. Add `xAxisId={0} yAxisId={0}` to the `CartesianGrid` in `EquityCurveChart.tsx:135` and in
   `src/app/insights/page.tsx:177` — this is the **only** source change this step makes to either file;
   do **not** perform their full `ChartContainer` migrations here (that is Step 4 for
   `EquityCurveChart.tsx` and Step 7 for `insights/page.tsx`) — this step exists solely to keep
   `pnpm build`/`pnpm lint` green immediately after the bump, decoupled from the larger migrations.
5. Run `pnpm build` and `pnpm lint` and confirm both pass with no new errors — any other v3-breaking-
   change compile error surfacing here (beyond the two `CartesianGrid` fixes above) means this step's
   recon evidence missed something and must be reconciled against `design.md` § Round 4 before
   proceeding (per **P-03**, no silent deviation).

**Verification**:
```bash
cd services/xstockstrat-ui
grep -n '"recharts"' package.json
# expect: "^3.8.0" (or the re-verified current 3.x version), not "^2.12.7"
grep -n "CartesianGrid" src/components/insights/EquityCurveChart.tsx src/app/insights/page.tsx
# expect: both now include xAxisId={0} yAxisId={0}
pnpm install --frozen-lockfile  # confirms package.json and pnpm-lock.yaml are consistent
pnpm lint
pnpm build
# expect: both pass — confirms the repo is buildable on recharts v3 before any ChartContainer
# migration lands (Steps 3-7)
```

---

### Step 3 — service: FR-2 add `src/components/ui/chart.tsx` (CLI-vendored, run as-is against recharts v3)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/ui/chart.tsx` — create

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- No `chart.tsx` currently exists: `ls src/components/ui/` (this session) returns `badge.tsx,
  button.tsx, card.tsx, combobox.tsx, input-group.tsx, input.tsx, select.tsx, separator.tsx, sheet.tsx,
  skeleton.tsx, table.tsx, textarea.tsx, utils.ts` — no `chart.tsx`.
- `components.json:1-18` (this session) — `"style": "radix-rhea"`, `"registries": {}` — confirms the
  target style/preset for the registry item design.md fetched live.
- `services/xstockstrat-ui/src/components/ui/button.tsx:1-46` — confirms this repo's post-119 primitive
  shape: plain function component (`function Button({ ... })`), `cva()` for variants, `cn()` from
  `@/components/ui/utils`, no `forwardRef`. `ui/chart.tsx` must follow the same shape.
- `design.md` § Chosen Approach #2 (revised, Round 4, 2026-08-09, user-directed override): with
  `recharts` v3 installed (Step 2), the shadcn `chart` registry item (`https://ui.shadcn.com/r/styles/
  radix-rhea/chart.json`, live-fetched by this feature's own design phase) can now be run **as-is** —
  the `initialDimension` prop and `TooltipValueType` import Round 2 previously identified as v3-only
  gaps against the pre-bump v2 install are no longer gaps at all; there is nothing left to hand-adapt.
- `design.md` § Round 4 — do not hand-author or omit anything from the CLI's output; the "adapt against
  v2" approach was Round 2's now-superseded synthesis, overridden by the user's Round 4 bump decision.

**TDD**: N/A (new primitive file, no existing behavior to regress; Steps 4/5/7's migrations are where
red-before-green applies, since that is where user-visible chart behavior changes)

**Instructions**:
1. Run `npx shadcn@latest add chart` against the existing `components.json` preset — this is now safe
   to run as-is (per `design.md`'s Round 4 override) since `recharts` v3 is already installed (Step 2)
   and the registry item's declared dependency (`recharts@3.8.0`) matches.
2. Do **not** hand-adapt or omit anything from the CLI's output — the `initialDimension`
   prop/`TooltipValueType` import concerns from the original (pre-Round-4) design are resolved by the
   version bump, not by omission.
3. Confirm the generated file follows this repo's post-119 primitive shape: `data-slot` convention,
   plain function components, no `forwardRef` (matching `button.tsx:39-46`) — the CLI's own output
   should already match, since `components.json`'s `radix-rhea` preset is the same one every other
   `ui/*` primitive in this repo was generated against.
4. Confirm the file lands at `src/components/ui/chart.tsx`, matching every other `ui/*` primitive's
   location, and exports `ChartContainer`, `ChartConfig`, `ChartTooltipContent`, `ChartLegendContent`.

**Verification**:
```bash
cd services/xstockstrat-ui
test -f src/components/ui/chart.tsx && echo "chart.tsx exists"
grep -n "ChartContainer\|ChartConfig\|ChartTooltipContent\|ChartLegendContent" src/components/ui/chart.tsx
# expect: all four exported
pnpm lint  # next lint — confirms the new file passes the repo's lint config
pnpm build # confirms the file type-checks cleanly against the installed recharts v3
```

---

### Step 4 — service: FR-3 migrate `EquityCurveChart.tsx` onto `ui/chart.tsx`

**Status**: `done`
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
- **`design.md` § Round 4 recon (2026-08-09)** — this file's concrete v3-breaking-change exposure,
  confirmed by direct read: `Scatter` (`:165-186`) uses `data`/`dataKey`/`shape`, **not** the removed
  `points` prop — no change needed there. No `activeIndex`, no `Customized`, no `ref.current.current`
  `ResponsiveContainer` pattern anywhere in the file. The `CartesianGrid` `xAxisId`/`yAxisId` fix was
  already landed in Step 2 (`xAxisId={0} yAxisId={0}` at `:135`) — carried forward unchanged by this
  step's migration, nothing further to do for it here.

**TDD**: `red-green required`

**Instructions**:
1. Replace the `ResponsiveContainer` + `ComposedChart` wrapper (`:133-188`) with `ui/chart.tsx`'s
   `ChartContainer`, passing a `ChartConfig` built at render time — one entry per `series[i].symbol`
   (mirroring the existing `series.map` dynamic-line-count pattern at `:152-164`), each entry's `color`
   sourced from `LINE_COLORS[i % LINE_COLORS.length]` (`:23-28`) so the visual palette is unchanged.
   Carry forward Step 2's `CartesianGrid` `xAxisId={0} yAxisId={0}` fix unchanged.
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
   own component API (product-spec FR-2's own framing). No `points`-prop change needed (confirmed above
   — this file never used it).

**Verification**:
```bash
cd services/xstockstrat-ui
grep -n "ChartContainer\|ChartTooltipContent" src/components/insights/EquityCurveChart.tsx
grep -n "data-testid=\"equity-curve-chart\"\|data-testid=\"curve-tooltip\"\|data-testid=\"marker-tooltip\"\|data-testid=\"trade-marker\"\|data-testid=\"equity-curve-empty\"" src/components/insights/EquityCurveChart.tsx
# expect: all 5 testids still present, unchanged strings
pnpm lint
pnpm test:e2e -- e2e/insights/backtest-coverage.spec.ts
# red-before-green (P-06): run this spec against the pre-Step-4 tree first and confirm it passes
# today (baseline), then re-run after the migration and confirm it still passes — a regression here
# is the concrete "red" this step's TDD gate watches for, since EquityCurveChart has no pre-migration
# failing-test to write (the e2e spec already covers the rendered chart).
```

---

### Step 5 — service: FR-4 migrate `FormulaRunResult.tsx`'s `Sparkline` onto `ui/chart.tsx`

**Status**: `done`
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
- **`design.md` § Round 4 recon (2026-08-09)** — this file has **zero** `recharts` usage today
  (confirmed: it's not one of the 2 files repo-wide importing from `'recharts'`). This step's `recharts`
  usage is entirely new code, written directly against the v3 already installed by Step 2 — there is no
  legacy v2-vs-v3 exposure to fix, only "write v3-correct code from the start."

**TDD**: `N/A (no e2e selector exists to prove red-before-green against; presentation-parity by
manual check only — see Step 15)`

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
   regression protection. No `CartesianGrid` is added by this component (hidden-axes sparkline look),
   so the `xAxisId`/`yAxisId` v3-required-prop concern from Step 2 does not apply here.

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

### Step 6 — docs: FR-5 record the `lightweight-charts` "keep" decision as a sanctioned exception

**Status**: `done`
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
  its hard-coded hex theme values (`:35-40`). Not affected by FR-2's `recharts` bump — this hook does
  not use `recharts` at all (it wraps `lightweight-charts`, an independent library FR-5 keeps).
- 3 consumers of the hook, confirmed via `recon.md`'s `grep -rln useCandlestickChart src/` (not
  independently re-grepped this session, cited as recon evidence): `src/components/trader/ChartPanel.tsx`,
  `src/app/trader/positions/[symbol]/page.tsx`, `src/app/insights/market/[symbol]/page.tsx`.
- `services/xstockstrat-ui/CLAUDE.md` § Styling (already applied — confirmed present this session: the
  "Sanctioned exception — `ChartPanel.tsx` stays on `lightweight-charts`" paragraph citing "feature 123
  design decision, 2026-08-08" already exists in the file, matching this step's target text verbatim).
  This step is a **no-op confirmation** if the note is already present, not a fresh write.

**TDD**: N/A (docs-only, no behavior change)

**Instructions**:
Confirm `services/xstockstrat-ui/CLAUDE.md` § Styling already carries the sanctioned-exception note
(per `context.md`'s 2026-08-09 cross-check audit, it was applied 2026-08-08). If for any reason it is
missing at execute time, append it verbatim (per `design.md` § Chosen Approach #5):

> `ChartPanel.tsx` (and its siblings via the shared `useCandlestickChart.ts` hook —
> `trader/positions/[symbol]/page.tsx`, `insights/market/[symbol]/page.tsx`) intentionally stays on
> `lightweight-charts` rather than `recharts`/`ui/chart.tsx` (feature 123 design decision, 2026-08-08):
> `recharts` has no first-party OHLCV candlestick geometry, the hook has 3 shared consumers across
> `/trader` and `/insights`, and `e2e/trader/chart-panel.spec.ts` depends on `lightweight-charts`'s own
> injected `.tv-lightweight-charts` DOM class as an async-readiness signal. Do not re-flag this as an
> unconsolidated charting approach in a future audit.

No source code change accompanies this step either way — FR-5's decision is "keep," so `ChartPanel.tsx`,
`useCandlestickChart.ts`, and the two sibling consumer pages are untouched by this feature (including by
FR-2's `recharts` bump, since this hook doesn't use `recharts`).

**Verification**:
```bash
grep -n "ChartPanel.tsx\|lightweight-charts\|feature 123" services/xstockstrat-ui/CLAUDE.md
# expect: the sanctioned-exception paragraph present under § Styling
git diff --stat services/xstockstrat-ui/src/components/trader/ChartPanel.tsx services/xstockstrat-ui/src/hooks/useCandlestickChart.ts
# expect: no changes to either file (confirms "keep" was not accompanied by a stray edit)
```

---

### Step 7 — service: FR-12 migrate `insights/page.tsx`'s "Score Trend" chart onto `ui/chart.tsx` (added 2026-08-09)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` service owner — analytics display accuracy

**Codebase Evidence**:
- **New step, added 2026-08-09** per `design.md` § Round 4's user-directed override (fold in the
  former `## Deferred Item` as FR-12) — the recon below is this session's own direct read of the whole
  224-line file.
- `src/app/insights/page.tsx:5-13` — `recharts` imports: `LineChart`, `Line`, `XAxis`, `YAxis`,
  `CartesianGrid`, `Tooltip`, `ResponsiveContainer`.
- `:154-208` — the dashboard's second card, "Score Trend"/"Equity Curve" (title is conditional on
  `topStrategy`, `:159-161`), containing the chart at `:175-200`.
- `:215-223` — `chartData(strategies: StrategyScore[])`: pure function, `StrategyScore[]` →
  `{ label: string; score: number }[]`. `label` = first 8 chars of `strategyId` (or a 5-item
  placeholder array of zeros, `S1..S5`, when `strategies` is empty); `score` = `overallScore` rounded to
  0-100. **Single series** (`score`) — no dynamic per-symbol line count, unlike `EquityCurveChart.tsx`.
- `:78` — `const { data: strategies } = useStrategies();` — the same hook this page's "Strategy Scores"
  card (`:93-152`) already consumes; `chartData()` is called against `strategies?.strategies ?? []`
  directly at the `LineChart`'s `data` prop (`:176`) — **no new data-fetching hook needed** for this
  migration.
- `:177` — `<CartesianGrid strokeDasharray="3 3" stroke="hsl(222 20% 14%)" />` — **already fixed by
  Step 2** (`xAxisId={0} yAxisId={0}` added there to keep the repo buildable post-bump); this step
  carries that fix forward unchanged.
- `:178-179` — `XAxis dataKey="label"` / `YAxis domain={[0, 100]}`, both plain, fixed-domain, unid'd
  (matching the default axis id `0` Step 2's `CartesianGrid` fix targets).
- `:180-191` — `Tooltip` via built-in `contentStyle`/`labelStyle`/`formatter` props (hard-coded
  hex/hsl values, not CSS custom properties) — **no custom `content` component**, so there is no
  `TooltipProps`/`TooltipContentProps` import to rename (unlike a hand-rolled tooltip component, this
  file never imported either type name).
- `:192-198` — `Line` (single series, `dataKey="score"`, fixed `stroke`/`dot` colors — not per-symbol
  cycled like `EquityCurveChart.tsx`'s `LINE_COLORS`).
- `:175-200` — `ResponsiveContainer width="100%" height={240}`, no `ref` prop — no `ref.current.current`
  exposure.
- No `Scatter`, `activeIndex`, or `Customized` usage anywhere in the file (confirmed via grep this
  session, corroborating `design.md` § Round 4's recon).
- **No e2e coverage**: grepped `services/xstockstrat-ui/e2e/` for `"Score Trend"`, `"insights/page"`,
  `"chartData"`, `"topStrategy"`, `"Equity Curve"` — zero matches in any spec file. This migration is
  manual-verification-only, matching the pattern already established for `FormulaRunResult.tsx` (Step
  5) and `OutputEditor.tsx`/`ParameterEditor.tsx` (Steps 9-10).

**TDD**: `N/A (no e2e selector exists to prove red-before-green against — same situation as Step 5;
manual verification in Step 15 substitutes)`

**Instructions**:
1. Replace the `ResponsiveContainer` + `LineChart` wrapper (`:175-200`) with `ui/chart.tsx`'s
   `ChartContainer`, passing a single-entry `ChartConfig` (`{ score: { label: 'Score', color: 'hsl(163
   100% 44%)' } }`, reusing the existing fixed `Line` stroke color at `:195` so the visual palette is
   unchanged) — no dynamic per-symbol config-building loop is needed here, unlike Step 4's
   `EquityCurveChart.tsx`.
2. Replace the built-in `contentStyle`/`labelStyle`/`formatter` `Tooltip` (`:180-191`) with `ui/chart.
   tsx`'s `ChartTooltipContent`, matching Step 4/Step 5's CSS-variable-driven theming pattern instead of
   this file's own hard-coded hex/hsl `contentStyle` values. Preserve the tooltip's current label
   ("Score") and value formatting (integer, no decimal — matching the existing `formatter`'s
   `v.toFixed(0)`).
3. Carry forward Step 2's `CartesianGrid` `xAxisId={0} yAxisId={0}` fix unchanged — nothing further to
   do for it in this step.
4. Keep `chartData()` (`:215-223`) and the `strategies?.strategies ?? []` data source completely
   unchanged — this migration only touches the chart's rendering layer, not its data derivation.
5. Keep the empty-state paragraph (`:201-205`, "Strategy scores will appear here once backtests are
   run") unchanged — it renders alongside the chart, not inside it, and is unaffected by this migration.

**Verification**:
```bash
cd services/xstockstrat-ui
grep -n "ChartContainer\|ChartTooltipContent" src/app/insights/page.tsx
grep -n "contentStyle\|labelStyle" src/app/insights/page.tsx
# expect: no match — the hard-coded Tooltip styling props are fully removed, not left as a dead prop
pnpm lint
pnpm build
# Manual verification required (no e2e coverage exists for this file — see product-spec Acceptance
# Criteria #6, updated 2026-08-09): open /insights in dev (pnpm dev) with at least one scored strategy,
# confirm the "Score Trend" card renders the same single-line chart at the prior size/position, the
# tooltip shows "Score: N" on hover, and the zero-strategy placeholder (S1..S5 at 0) still renders
# correctly with no strategies registered.
```

---

### Step 8 — service: FR-7 extract `src/components/shared/RepeatableRowList.tsx`

**Status**: `done`
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
  `value: T[]`/`onChange`/`makeEmpty`; already the shape all three rows need.
- Existing `ui/` imports confirmed present for all needed primitives: `Card`
  (`src/components/insights/EquityCurveChart.tsx:14`), `Button`/`Input`/`Select`/`Combobox`
  (`OutputEditor.tsx:4-18`, `ParameterEditor.tsx:5-18`, `RuleEditor.tsx:3-18`) — no new shadcn primitive
  needed, confirming product-spec FR-7's own framing ("shadcn's own registry has no 'list editor' or
  'rule builder' recipe to install").

**TDD**: N/A (new presentational component with no prior behavior; Steps 9–11's migrations are where
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

### Step 9 — service: FR-8a migrate `OutputEditor.tsx` onto `RepeatableRowList` + `useListEditor`

**Status**: `done`
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
  query) — this migration relies on manual verification (Step 15), not e2e regression protection, per
  product-spec Acceptance Criteria #6.

**TDD**: `N/A (no e2e selector exists to prove red-before-green against — see Step 5's identical
situation; manual verification in Step 15 substitutes)`

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

### Step 10 — service: FR-8b migrate `ParameterEditor.tsx` onto `RepeatableRowList` + `useListEditor`

**Status**: `done`
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
- Same no-e2e-coverage situation as Step 9 (`e2e/insights/formulas.spec.ts` confirmed empty of
  row-level selectors).

**TDD**: `N/A (same as Step 9 — no e2e selector to prove red-before-green against; manual verification
in Step 15)`

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
   feasible in Step 8's design — the render-prop takes full control of a row's own JSX).

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

### Step 11 — service: FR-6 + FR-8c bind `RuleEditor.tsx`'s conditions to `useListEditor` and migrate onto `RepeatableRowList`

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
add/edit/remove — with e2e coverage adjacent, per Step 15's spec run against the surrounding wizard
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
   disabled, when `ctx.move` is not supplied, per Step 8's "optional move controls" requirement).
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
# red-before-green (P-06): confirm this spec passes on the pre-Step-11 tree (baseline — it already
# exercises RuleEditor indirectly via the wizard's Step 3), then re-run after and confirm it still
# passes. The spec's JSON-mode/textarea assertions (untouched by this step) act as the regression
# guard for RuleEditor's overall wiring even though no assertion targets the visual-mode rows directly.
```

---

### Step 12 — service: FR-9 install the shadcn `Questionnaire` primitive (CLI-vendored)

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
  before use, not just at design time weeks/days earlier). This is the **only** item from `design.md`'s
  original self-run design session still awaiting a live user confirmation gate (FR-2 and FR-12 were
  resolved via Round 4, 2026-08-09 — see `design.md` § Round 4).
- `services/xstockstrat-ui/CLAUDE.md` § Styling (read this session) — "Adding a primitive not yet in
  `src/components/ui/`: `npx shadcn@latest add <name>`" is this repo's documented norm; `package.json:51`
  confirms the `shadcn` CLI package is already an installed dependency (`"shadcn": "^4.16.2"`).
- `recon.md` § Risks/Not-found — the raw registry payload's `questionnaire.tsx` imports
  `IconPlaceholder` from a shadcn-demo-app-specific path; expected to resolve correctly through the
  actual CLI flow (which performs the icon-library substitution `combobox.tsx`'s
  `@tabler/icons-react` imports already went through), not confirmed by fetching the raw payload
  directly — flag as a fallback risk only if the CLI is unavailable at execute time.

**TDD**: N/A (new primitive install, no existing behavior to regress; Steps 13-14's wizard-shell
migrations are where red-before-green applies)

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

### Step 13 — service: FR-10 (Step 1) restructure `StrategyWizard.tsx`'s Step 1 onto `Questionnaire`'s native Choice/Input answer model

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/StrategyWizard.tsx` — modify
- `services/xstockstrat-ui/e2e/insights/strategy-authoring.spec.ts` — modify (Step 1 fill/click
  sequencing only — see Instructions #9)

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness

**Codebase Evidence**:
- `StrategyWizard.tsx:60-61` — outer `const [step, setStep] = useState(1);`, unchanged; `STEPS` array
  at `:23`.
- `StrategyWizard.tsx:65-74` — controlled state for the 4 Step-1 fields (`strategyId`, `displayName`,
  `cooldownDaysRaw`, `exitCooldownDaysRaw`), seeded from `initial?.*` for edit-mode pre-population —
  kept as-is per `design.md` § Round 3's "Controlled state, not `FormData`-uncontrolled submission."
- `StrategyWizard.tsx:90-98` — `stepForError(msg): number`, to be extended to the `ErrorTarget` shape
  `design.md` § Round 3 specifies (`{ step: number; identitySubStep?: 1|2|3|4 }`).
- `StrategyWizard.tsx:117-127` — `idValid`, `cooldownParsed`, `exitCooldownParsed`, and the combined
  `canAdvance` (`step === 1` branch ANDs all four) — the 4 predicates are reused **verbatim** as each
  new sub-screen's own gate; only their scope narrows (see `design.md` § Round 3's mapping table).
- `StrategyWizard.tsx:187-242` — the flat Step 1 render branch to replace: Strategy ID
  (`:190-202`, `disabled={mode==='edit'}`, placeholder `'e.g. sma_crossover'`, regex error paragraph),
  Display name (`:203-210`, placeholder `'SMA Crossover'`), Re-entry cooldown (`:211-225`,
  `type="number"`, placeholder `'31 (default)'`, error paragraph), Exit cooldown (`:226-240`,
  `type="number"`, placeholder `'0 (default)'`, error paragraph).
- `StrategyWizard.tsx:306-319` — the error-jump `onClick={() => setStep(stepForError(serverError))}`
  and its `"Go to Step {n}"` link text — the `onClick` gains the `identitySubStep` companion call per
  `design.md` § Round 3; the link text itself is unchanged (not e2e-asserted at a specific Step 1
  sub-target, per that section's confirmation the one covered `Go to Step` test targets Step 2, not
  Step 1).
- `StrategyWizard.tsx:325-346` — outer `Back`/`Next`/`Create Strategy`/`Save Changes` navigation, kept
  for Steps 2-4 (Step 14); Step 1's *own* sub-screen navigation is new, added by this step, and is
  scoped to the Step 1 render branch only.
- `design.md` § Round 3 (this feature's own design phase, user-directed override, 2026-08-08) — the
  full design this step implements: the nesting-vs-flattening decision, the `canAdvance`→
  per-sub-screen-gate mapping table, the extended `stepForError`, the Back-navigation persistence
  choice, the controlled-vs-`FormData` decision, and the separate-`Questionnaire.Root`-scope decision.
- `recon.md` § Dependencies (updated 2026-08-08, Round 3) — the two-live-`WebFetch`-verified
  one-answer-per-`Item` evidence (`FormData.get`/`getAll`, `fieldset` structure, no multi-independent-
  `Input`-per-`Item` pattern) that drives the 4-sub-screen split.
- `e2e/insights/strategy-authoring.spec.ts` (re-verified 2026-08-09 via direct grep, correcting an
  earlier miscount of 7) — `getByText('Step 1 — Identity')` appears **12 times**: `:55` in the shared
  `fillToReview` helper, plus `:194`, `:234`, `:262`, `:273`, `:329`, `:341`, `:352`, `:375`, `:421`,
  `:433`, `:444` across the standalone tests — all must resolve unchanged (the outer `CardTitle`
  stays `Step {step} — {STEPS[step-1]}`, unconditional on the new inner sub-step). Two of the
  previously-uncited occurrences (`:352`, `:444` — "editing an unset strategy on an unrelated field")
  today do only a single `next.click()` to leave Step 1 and must become a multi-click sequence like
  the others once Step 1 is 4 sub-screens; Instruction #9 below is written broadly enough ("every
  inline Step-1 fill/click sequence," "both cooldown/exit-cooldown `test.describe` blocks") to cover
  these two without a separate instruction. Every Step-1 fill sequence (the `fillToReview` helper
  `:48-72`, plus the inline sequences in the wizard-gates test `:186-227`, the server-error-jump test
  `:229-255`, the edit-prepopulation
  test `:257-266`, the formula-picker test `:268-291`, and both cooldown-suite `test.describe` blocks
  `:300-457`) needs the interstitial-`Next`-click rewrite `design.md` § Round 3 specifies.
- Not affected by FR-2's `recharts` bump or FR-12's new step — this step and its files are disjoint
  from every chart file this feature touches.

**TDD**: `red-green required` — this step changes real interactive behavior (Step 1's navigation
granularity) with direct, extensive e2e coverage. **Genuine red state, not just a final-state
check** (round-4 cross-check audit correction, 2026-08-09): Instruction 9 below requires running
the *unmodified* `strategy-authoring.spec.ts` against the *restructured* component (after
Instructions 1-8, before rewriting the spec) and recording the actual failure — the old spec's
single-click-then-assert sequences will fail against the new multi-screen Step 1, for the expected
reason (missing interstitial `Next` clicks), not a different one. Only then does the spec get
rewritten to green. This mirrors sibling `120`'s tier-4 mandatory "run unmodified, record actual
pass/fail" two-step discipline.

**Instructions**:
1. Add a new `identitySubStep` state (`useState<1|2|3|4>(1)`) alongside the existing `step` state.
   Persist it across outer-step transitions (do **not** reset it to `1` when `step` changes) — per
   `design.md` § Round 3's Back-navigation choice.
2. Replace the flat Step 1 render branch (`:187-242`) with 4 sub-screens, rendering only the one
   `identitySubStep` selects, each wrapped in its **own**, separately-scoped `Questionnaire.Root`/
   `Questionnaire.Item` (from `src/components/ui/questionnaire.tsx`, Step 12) — distinct from whatever
   chrome-only `Questionnaire.Root`/`Item` Step 14 wraps Steps 2-4 in:
   - Sub-screen 1 — Strategy ID: unchanged `Input` (value/onChange/disabled/placeholder/error paragraph
     verbatim from `:191-202`), inside `Questionnaire.Item name="strategyId"`. Gate (this sub-screen's
     own `Next` `disabled` prop): `!idValid`.
   - Sub-screen 2 — Display name: unchanged `Input` (`:205-210`), inside
     `Questionnaire.Item name="displayName"`. Gate: `displayName.trim() === ''`.
   - Sub-screen 3 — Re-entry cooldown (days): unchanged `Input` (`:215-225`), inside
     `Questionnaire.Item name="cooldownDays"`. Gate: `!cooldownParsed.valid`.
   - Sub-screen 4 — Exit cooldown (days): unchanged `Input` (`:230-240`), inside
     `Questionnaire.Item name="exitCooldownDays"`. Gate: `!exitCooldownParsed.valid`. Its `Next`/advance
     action calls the **outer** `setStep(2)` (not a 5th inner sub-screen) — this is where Step 1 hands
     off to Step 2.
3. Keep every field's `value`/`onChange` bound to the existing controlled state
   (`strategyId`/`setStrategyId`, etc.) — do **not** switch to reading `FormData` at a terminal submit
   (`design.md` § Round 3's explicit "Controlled state, not `FormData`-uncontrolled submission").
4. Preserve every placeholder/label/error string **exactly**: `'e.g. sma_crossover'`,
   `'SMA Crossover'`, `'31 (default)'`, `'0 (default)'`, `'Use lowercase letters, digits, and
   underscores only.'`, `'cooldown days must be a non-negative integer'`,
   `'exit cooldown days must be a non-negative integer'`, and `disabled={mode === 'edit'}` on the
   Strategy ID input.
5. Keep the outer `CardTitle` (`Step {step} — {STEPS[step - 1]}`, currently rendered once for the whole
   Card) **unconditional on `identitySubStep`** — this is the mechanism that keeps all 12
   `getByText('Step 1 — Identity')` e2e assertions valid without modification (per `design.md` § Round
   3's nesting decision).
6. Every sub-screen's advance/back control keeps the literal accessible name `'Next'` / `'Back'`
   (matching `Questionnaire.Navigation`'s `children ?? 'Next'`-style fallback, `recon.md` § Patterns to
   REUSE) — do not invent new button text; only one sub-screen renders at a time, so there is no
   strict-mode ambiguity for `getByRole('button', { name: 'Next', exact: true })`.
7. Extend `stepForError` (`:90-98`) to the `ErrorTarget` shape `design.md` § Round 3 gives verbatim
   (`{ step: number; identitySubStep?: 1|2|3|4 }`, with `'strategy_id'`→sub 1, `'display'`→sub 2,
   `'exit'+'cooldown'`→sub 4, plain `'cooldown'`→sub 3). Update the error-jump `onClick` (`:314`) to
   `setStep(target.step); if (target.step === 1) setIdentitySubStep(target.identitySubStep ?? 1)`.
8. Sub-screen 1's own `Back`/`Previous` stays disabled (nothing precedes Step 1). Back from outer Step 2
   lands on Step 1's sub-screen 4 (`identitySubStep` was left at `4` when Step 1 completed, per
   Instruction #1's persistence).
9. **First, capture red**: after Instructions 1-8 land (the component restructured, the spec file
   still untouched), run `pnpm test:e2e -- e2e/insights/strategy-authoring.spec.ts` against the
   *unmodified* spec and record the actual failures in `context.md` (which tests fail, and confirm
   they fail on the expected symptom — a field fill landing on the wrong sub-screen or a `Next`
   click not yet inserted — not on an unrelated error). This is the genuine red state Instruction 9
   as a whole is gated on producing; do not skip straight to writing the passing version.
   **Then update** `e2e/insights/strategy-authoring.spec.ts` per `design.md` § Round 3's "e2e-update
   implication": rewrite the shared `fillToReview` helper and every inline Step-1 fill/click sequence
   to insert a `next.click()` between each field fill (fields left blank, e.g. cooldown/exit-cooldown in
   several tests, can be skipped over with a bare `next.click()` since blank is still a valid gate —
   `parseCooldownDays`/`parseExitCooldownDays` both return `valid: true` for blank input, unchanged).
   Do **not** change any `getByPlaceholder(...)` string or the `Next`/`Back` accessible names. Re-run
   every affected test (both cooldown/exit-cooldown `test.describe` blocks, the two negative-cooldown
   tests, the edit-prepopulation test, the server-error-jump test, the formula-picker test) and confirm
   each now passes (green) against the restructured component.

**Verification**:
```bash
cd services/xstockstrat-ui
grep -n "identitySubStep" src/components/insights/StrategyWizard.tsx
grep -n "Questionnaire" src/components/insights/StrategyWizard.tsx
grep -n "'e.g. sma_crossover'\|'SMA Crossover'\|'31 (default)'\|'0 (default)'" src/components/insights/StrategyWizard.tsx
# expect: all 4 placeholders still present verbatim
pnpm lint
pnpm build
# red-before-green (P-06), genuine capture: after Instructions 1-8, BEFORE touching the spec file,
# run the unmodified spec and record the actual (expected) failures in context.md:
pnpm test:e2e -- e2e/insights/strategy-authoring.spec.ts   # expect real failures — record which, and why
# THEN apply Instruction 9's spec rewrite, and re-run for the green state:
pnpm test:e2e -- e2e/insights/strategy-authoring.spec.ts   # expect all green — the concrete regression
# guard for the whole restructure: every getByText('Step 1 — Identity'), every getByPlaceholder, and
# every Next/Back/Create Strategy/Save Changes/Go to Step assertion must pass via the new multi-click
# sequencing.
```

---

### Step 14 — service: FR-10 (Steps 2-4) + FR-11 shell-wrap `StrategyWizard.tsx`'s Steps 2-4 and replace the outer step indicator with `Questionnaire.Progress`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/StrategyWizard.tsx` — modify

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness

**Codebase Evidence**:
- `StrategyWizard.tsx:60-61` (read this session) — `const [step, setStep] = useState(1);` — own React
  state, not a library; `STEPS` array at `:23` (`['Identity', 'Components', 'Rules', 'Review']`),
  unchanged by Step 13 (Step 13 only touches Step 1's *inner* content, not the outer `step`/`STEPS`
  model).
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
  true })` (throughout the file), `getByRole('button', { name: 'Create Strategy' })`,
  `getByRole('button', { name: 'Save Changes' })`. **Note**: after Step 13, the outer `Next` button is
  only reachable/visible from Step 2 onward — Step 1's own advance is handled by its 4 sub-screens'
  inner navigation (Step 13) — but its accessible name stays `'Next'`, so these selectors are unaffected.
- `design.md` § Chosen Approach #10 — **Steps 2/3/4 stay SHELL ONLY (option a), unchanged by the Round
  3 override.** Step 2 (dynamic `ComponentEditor` list) and Step 3 (two `RuleEditor` instances — nested
  condition tree) both fail `Questionnaire`'s single-scalar-answer-per-`Item` model outright; Step 4 has
  no fields to collect and trivially fits option (a) via `Questionnaire.Submit`. `StrategyWizard.tsx`
  keeps its own `step`/`setStep` React state exactly as today for these three steps —
  `Questionnaire.Root`/`Item`/`Progress`/`Previous`/`Next`/`Submit` supply chrome only, matching Round
  2's original conclusion (still valid, only Step 1 changed).
- `recon.md` § Patterns to REUSE — the fetched `questionnaire.tsx` registry payload's `QuestionnaireItem`
  forwards `{...props}` including arbitrary `children` to the underlying primitive, confirming
  `Questionnaire.Item` is not structurally restricted to `Choices`/`Input` content — this is what makes
  option (a) (shell-only, existing rich step content un-refactored inside a `Questionnaire.Item`)
  feasible for Steps 2-4.

**TDD**: `red-green required`

**Instructions**:
1. Replace the `<ol>` step indicator (`:159-178`) with `Questionnaire.Progress` (from the
   `src/components/ui/questionnaire.tsx` Step 12 creates), driven by the existing outer `step`/
   `STEPS.length` state — do not adopt `Questionnaire.Root`'s own `item`/`onItemChange`/`FormData`-driven
   answer-and-validation model for the outer shell; `StrategyWizard.tsx` keeps its own `step`/`setStep`
   as the single source of truth for Steps 2-4 (per `design.md`'s "chrome only" framing) so Steps 2/3's
   rich sub-forms (`ComponentEditor` list, `RuleEditor` instances) remain un-refactored inside their
   existing render branches (`:244-283`).
2. If `Questionnaire.Root`/`Item` require being present in the tree for `Questionnaire.Progress`,
   `Questionnaire.Next`/`Previous`/`Submit` to render at all (verify against the actual installed
   `questionnaire.tsx` from Step 12, not assumed from the raw registry payload), wrap the Steps 2-4
   content (`:244-321`) in a minimal `Questionnaire.Root`/`Questionnaire.Item` shell without changing
   what each step renders — the wrapping is chrome, the content inside stays `StrategyWizard`'s own JSX.
   Do **not** wrap Step 1's content in this same shell instance — Step 13 already gave Step 1 its own,
   separately-scoped `Questionnaire.Root` for its native-model sub-screens (`design.md` § Round 3).
3. Replace the outer navigation `Button`s (`:325-346`) with `Questionnaire.Previous`/`Questionnaire.Next`/
   `Questionnaire.Submit` **only if** those parts support a `children` override for their default text
   (confirmed feasible in `recon.md` — "`children ?? 'Next'`-style fallback pattern") — preserve the
   exact button text e2e-load-bearing: `Back`, `Next`, `Create Strategy` / `Save Changes` (mode-
   dependent). If the installed `questionnaire.tsx`'s navigation parts do not support a clean text
   override without fighting their internal disabled/click-handler wiring, keep `StrategyWizard`'s
   existing `Button`s for navigation and use `Questionnaire.Progress` alone for FR-11's actual ask (the
   `<ol>` replacement) — the shell-only decision does not require every navigation control to migrate,
   only the step indicator (product-spec FR-11's literal scope).
4. Do not change Steps 2/3/4's **count**, **order**, or **content** — FR-10's shell-only decision for
   these three steps explicitly excludes any restructuring of what each collects (product-spec
   Out-of-Scope, still in force for Steps 2-4).

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
# red-before-green (P-06): confirm this spec (already updated by Step 13's Instruction #9) still
# passes after this step's outer-shell/indicator swap — this is the concrete regression guard for
# FR-10 (Steps 2-4)/FR-11's shell swap.
```

---

### Step 15 — test: whole-feature verification pass

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- (no new files — this step verifies Steps 1–14's combined changes)

**Reviewers**: `xstockstrat-ui` service owner — Trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- Product-spec Acceptance Criteria #6 (as tightened by `context.md`'s `sdd-review product-spec`
  session, and updated 2026-08-09 for FR-12) — the exact spec-file/selector list this step must pass:
  `e2e/insights/strategy-authoring.spec.ts` (step indicator via button text, `Go to Step`, `Add
  component`, `JSON` toggle, `getByLabel('Entry rule JSON'/'Exit rule JSON')`),
  `e2e/insights/backtest-coverage.spec.ts` (`getByTestId('equity-curve-chart')`),
  `e2e/trader/chart-panel.spec.ts` (`getByTestId('chart-container')` — unaffected by this feature per
  FR-5's "keep" decision, included as a regression check that Step 6's doc-only change didn't
  accidentally touch chart code).
- Same Acceptance Criteria #6 — `FormulaRunResult.tsx`'s sparkline (Step 5),
  `OutputEditor.tsx`/`ParameterEditor.tsx`'s row controls (Steps 9–10), and (added 2026-08-09)
  `insights/page.tsx`'s Score Trend chart (Step 7) have **no e2e selector coverage** — confirmed by
  this feature's own grep against `e2e/insights/formulas.spec.ts` (64 lines, no row-level query) and
  against the whole `e2e/` tree for the Score Trend chart's data/label strings (zero matches) — so this
  step's verification for those four files is explicitly manual, not a gap to silently accept as
  "covered."

**TDD**: N/A (aggregation/verification step, not new behavior)

**Instructions**:
Run the full lint/build/e2e pass across every file Steps 1–14 touched, and perform the manual checks
Acceptance Criteria #6 requires for the three files with no e2e coverage. No code changes in this step —
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
#    sparkline (Step 5) renders at the same compact size/position as before.
# 3. Open a formula's Outputs editor (OutputEditor, Step 9) — confirm add/move-up/move-down/remove.
# 4. Open a formula's Parameters editor (ParameterEditor, Step 10) — confirm the numeric Min/Max grid
#    still shows/hides on type change, and add/move/remove.
# 5. Open the strategy wizard's Rules step (RuleEditor, Step 11) — confirm visual-mode condition
#    add/remove still works and the JSON toggle round-trips correctly.
# 6. Open /insights (dashboard) with at least one scored strategy — confirm the Score Trend chart
#    (Step 7, FR-12) renders correctly, the tooltip shows "Score: N", and the zero-strategy placeholder
#    still renders when no strategies are registered.
```

---

## Deferred Item — historical record, superseded by Step 7 (folded in 2026-08-09)

**Superseded 2026-08-09**: this section originally recorded `src/app/insights/page.tsx:176-199`'s
dashboard "Score Trend" `LineChart` as deliberately excluded from this feature pending the user's
explicit confirmation (`design.md`'s Chosen Approach #12 / Open Risks). The user has since confirmed
folding it in (`design.md` § Round 4, 2026-08-09), and it is now implemented as **Step 7** (FR-12)
above, with `product-spec.md` amended accordingly (new FR-12, Affected Services, Consumer Surface, and
Acceptance Criteria #2/#6 updated). This section is retained only as a historical record of the original
deferral reasoning — it is no longer an open scope question.

Original text (2026-08-08, for the record): "`design.md`'s Chosen Approach #12 recommends folding
`src/app/insights/page.tsx:176-199`'s second, independent `recharts` `LineChart` (the 'Score Trend'
dashboard card) into this feature's `ui/chart.tsx` migration as a natural extension of Step 3's pattern.
`design.md`'s own Open Risks explicitly flag this as 'not yet approved scope' requiring the
orchestrating session's confirmation before `/sdd-spec` turns it into concrete steps — expanding
product-spec's `/sdd-review`-approved Affected Services list is a Commandment-level decision
(Constitution C-14/C-11), not something `/sdd-spec` decides unilaterally."

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
