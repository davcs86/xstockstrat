# Recon: shadcn-migration-custom-composites

**Created**: 2026-08-08
**From**: product-spec.md
**Affected services**: `xstockstrat-ui`

---

## Objective

Close out the fourth backlog item from "The Component Ledger" shadcn/ui gap audit: verify the
already-resolved Combobox finding (FR-1); add the shadcn `Chart` primitive and migrate
`EquityCurveChart.tsx`/`FormulaRunResult.tsx`'s sparkline onto it, with `ChartPanel.tsx`'s
`lightweight-charts` candlestick left as an explicit design decision (FR-2–FR-5); extract a shared
`RepeatableRowList` composite so `OutputEditor`/`ParameterEditor`/`RuleEditor`'s condition rows stop
reimplementing add/move/remove independently (FR-6–FR-8); and adopt the shadcn `Questionnaire`
primitive for `StrategyWizard`'s step shell, with install path and shell-vs-restructure scope left as
an explicit design decision (FR-9–FR-11). No proto, config, or DB changes; single service
(`xstockstrat-ui`), no new routes.

## Codebase Map

- **`xstockstrat-ui`** (Node.js/Next.js 15, TS)
  - `components.json:1-18` — style `radix-rhea`, `baseColor: "stone"`, `iconLibrary: "tabler"`,
    `registries: {}` (no external registries configured today).
  - `src/components/ui/` inventory (`ls`, confirmed): `badge.tsx`, `button.tsx`, `card.tsx`,
    `combobox.tsx`, `input-group.tsx`, `input.tsx`, `select.tsx`, `separator.tsx`, `sheet.tsx`,
    `skeleton.tsx`, `table.tsx`, `textarea.tsx`, `utils.ts` — **no `chart.tsx` or `questionnaire.tsx`
    yet**. `src/components/ui/button.tsx:39-46` — confirms the post-119 primitive shape (plain
    function component, `cva()`, `data-slot`, no `forwardRef`).
  - `src/components/ui/combobox.tsx:1-14` — Base-UI-backed (`@base-ui/react`'s `Combobox` compound
    API), full `Combobox`/`ComboboxInput`/`ComboboxContent`/`ComboboxList`/`ComboboxItem`/
    `ComboboxEmpty` set exported.
  - Combobox call sites (FR-1), all confirmed on the current compound API:
    `src/components/trader/ChartPanel.tsx:9-14,92-114`; `src/components/insights/ComponentEditor.tsx:5-10,117-131`;
    `src/components/insights/RuleEditor.tsx:5-10,206-238,258-295`. No stray old-API call site found.
  - `src/components/insights/EquityCurveChart.tsx:1-193` — `recharts` `ComposedChart`/`Line`/`Scatter`/
    `Tooltip`, hand-rolled `CurveTooltip` (`:45-91`). Dynamic per-symbol `<Line>` count (`series.map`,
    `:152-164`) and a custom `Scatter` `shape` render-prop for trade markers (`:165-186`). Load-bearing
    `data-testid`s: `equity-curve-chart` (`:132`), `curve-tooltip` (`:62`), `marker-tooltip` (`:66`),
    `trade-marker` (`:174-175`), `equity-curve-empty` (`:118`).
  - `src/components/insights/FormulaRunResult.tsx:6-27` — inline-SVG `Sparkline` (140×30, no axis, one
    instance per numeric output row via `OutputRow`, `:36-55`). No `data-testid` on the sparkline itself.
  - **Third, previously-unnamed `recharts` consumer**: `src/app/insights/page.tsx:5-13,176-199` — the
    `/insights` dashboard's "Score Trend"/"Equity Curve" card is a *second, independent* hand-rolled
    `recharts` `LineChart` (its own `CartesianGrid`/`XAxis`/`YAxis`/`Tooltip`/`Line` with inline
    `contentStyle`/`labelStyle` — the same "no shared theming layer" pattern FR-2's Problem Statement
    describes) — confirmed via `grep -rln "from 'recharts'" src/`, which returns
    `EquityCurveChart.tsx` **and** `insights/page.tsx`, not just the one file product-spec.md's
    Affected Services / FR-3 names. Not excluded by Out-of-Scope (which excludes other features'
    findings and any *behavioral redesign*, not a same-shape consolidation target found during recon).
    Flagged as a recon-driven scope question for the design decision below — not silently added.
  - `src/components/trader/ChartPanel.tsx:1-167` — candlestick chart via the shared
    `src/hooks/useCandlestickChart.ts:1-56` hook (dynamic `import('lightweight-charts')`,
    `chart.addCandlestickSeries(...)` — v4 API; the hook's own comment at `:31` already flags "v5
    renamed this to `addSeries(CandlestickSeries)`"). `data-testid="chart-container"` (`ChartPanel.tsx:160`).
  - **`useCandlestickChart` has three consumers, not one** — product-spec's Affected Services names
    only `ChartPanel.tsx` for FR-5; the hook is also used by
    `src/app/trader/positions/[symbol]/page.tsx:10,69` and
    `src/app/insights/market/[symbol]/page.tsx:12,44` (confirmed via `grep -rln useCandlestickChart
    src/`). A "replace" decision on FR-5 changes shared infrastructure reaching both `/trader` and
    `/insights` segments, not just the one file the product spec names.
  - `src/hooks/useListEditor.ts:1-26` — generic `add`/`update`/`remove`/`move` over a flat
    `value: T[]`/`onChange`/`makeEmpty` triple. Already consumed by `OutputEditor.tsx:46-47` and
    `ParameterEditor.tsx:138-139`.
  - `src/components/insights/OutputEditor.tsx:46-108` — row shape: 2 `Input`s + move-up/move-down/
    remove `Button`s, single-tier row.
  - `src/components/insights/ParameterEditor.tsx:138-261` — row shape: **two-tier**. Header row
    (`Input` name + `Select` type + move/remove `Button`s, `:152-204`) plus a conditional body grid
    (`Default`/`Min`/`Max`/`Required`, `:205-245`) plus a trailing description `Input` (`:246-251`).
    Not a single flat row of fields.
  - `src/components/insights/RuleEditor.tsx:22-28` — `RuleTree = { op: 'AND'|'OR', conditions:
    Condition[] }`; despite the "tree" name, `conditions` is a **flat array**
    (`Condition = { lhs, fn, rhs }`), directly `useListEditor`-shaped. Visual-mode condition rows:
    `:179-325`. Each row is `Combobox` (lhs) + `Select` (comparator) + `Combobox` (rhs, free-text) +
    a **`Remove`-only** button (`:296-308`) — **no move-up/move-down** (order is semantically
    irrelevant under `AND`/`OR`), unlike `OutputEditor`/`ParameterEditor`.
  - `src/components/insights/StrategyWizard.tsx:156-348` — 4-step wizard, own `step`/`setStep` state
    (not a library). Step indicator `<ol>` at `:159-178` (numbered pills, `cn()` ternary tone). Step
    content: Step 1 (`:187-242`, 4 independent `Input`s: strategy ID, display name, cooldown days, exit
    cooldown days); Step 2 (`:244-266`, dynamic `ComponentEditor` list + "Add component"); Step 3
    (`:268-283`, two full `RuleEditor` instances — Entry/Exit rule); Step 4 (`:285-321`, read-only
    summary + conditional error-jump link `"Go to Step {n}"` at `:316`). Navigation `Back`/`Next`/
    `Create Strategy`/`Save Changes` at `:325-346`.

## Patterns to REUSE

- Chart theming layer → shadcn's own `Chart` registry item (verified live against
  `https://ui.shadcn.com/r/styles/radix-rhea/chart.json` — matches this repo's exact style/preset):
  `ChartContainer` + `ChartConfig` (a `Record<string, {label, color|theme}>` driving `--color-<key>`
  CSS custom properties via a `<style>` tag, `ChartStyle`) + `ChartTooltipContent` +
  (unfetched but named in FR-2) `ChartLegendContent`. `ChartConfig` is a plain object built at
  render time, not a compile-time-fixed key set — compatible with `EquityCurveChart.tsx`'s dynamic
  per-symbol line count (build one `ChartConfig` entry per `series[i].symbol`).
- List-editor primitives for `RepeatableRowList` (FR-7) → build from what already exists in
  `src/components/ui/`: `Card`, `Button`, `Input`, `Select`, `Combobox` (all present; no new shadcn
  primitive needed, matching product-spec's own framing).
- Row add/move/remove logic → `src/hooks/useListEditor.ts` (already generic over `T`); `RuleEditor`'s
  `tree.conditions` is directly bindable as `useListEditor<Condition>(tree.conditions, (next) =>
  updateTree({ ...tree, conditions: next }), () => ({ lhs: '', fn: '>', rhs: '' }))` without changing
  the hook's shape (confirmed by reading both files — flat array in, flat array out).
- Wizard step chrome → shadcn's `Questionnaire` registry item (verified live against
  `https://ui.shadcn.com/r/styles/radix-rhea/questionnaire.json`): the generated wrapper file matches
  this repo's post-119 primitive shape exactly (plain function components, `data-slot`, no
  `forwardRef`) and each part (`QuestionnaireItem` in particular) forwards `{...props}` — including
  arbitrary `children` — to the underlying primitive, so `Questionnaire.Item` is not restricted to
  `Choices`/`Input` content structurally.
- Frontend test-data inventory (Constitution C-12) — `services/xstockstrat-ui/e2e/fixtures/
  INVENTORY.md` not re-surveyed in depth here: this feature is a markup/composition refactor of
  already-covered flows (strategy authoring, backtest diagnostics), not a new domain entity, so no new
  fixture is expected. Confirm at `/sdd-spec` time if a step needs new mock data shapes.

## Dependencies

- Proto/RPC: none.
- Migration: none.
- Config keys: none.
- Inter-service edges: none (pure `xstockstrat-ui` markup/composition change).
- New env vars / ports: none.
- **New npm dependency risk (recharts version drift)** — the live shadcn `chart` registry item
  declares `dependencies: ["recharts@3.8.0"]`; this repo has `recharts@^2.12.7` installed
  (`package.json:50`). Recharts 2→3 is a major version bump. The registry file's `ChartContainer`
  passes `initialDimension` to `RechartsPrimitive.ResponsiveContainer` and imports the type
  `TooltipValueType` from `"recharts"` — both v3-era API surface not confirmed present in the
  installed v2.12.7. Per the `trader-chart-panel` ledger insight below, running `npx shadcn@latest add
  chart` as-is would draft against an uninstalled major version.
- **New npm dependency risk (`@shadcn/react`)** — `Questionnaire`'s CLI-vendored registry item still
  declares `dependencies: ["@shadcn/react"]` under the hood (verified via the live registry JSON, not
  just the docs page). Verified directly against the npm registry
  (`https://registry.npmjs.org/@shadcn/react`): package **exists**, latest **0.3.0** (pre-1.0),
  created 2026-06-26, last modified 2026-08-05 (3 days before this recon) — an actively-changing,
  unstable-by-semver-convention dependency, not a mature/pinned one.
- **`Questionnaire.Item`'s answer model — one answer per `Item`, verified 2026-08-08 (Round 3 override
  session, `design.md`)**. This corrects/replaces an earlier, unsourced citation in `design.md`'s
  Round 2 (point 3) that pointed here ("`recon.md` § Dependencies — `FormData.get(itemName)`/`getAll`")
  before this bullet actually existed — the Round 1/2 registry-payload fetch above only established
  that `QuestionnaireItem` forwards arbitrary `children`, not the `FormData`-key mechanics below.
  Verified via **two independent live `WebFetch` calls** against the shadcn `Questionnaire` docs (not
  the raw registry JSON payload used above, and not assumed):
  - `QuestionnaireItem` renders as a `fieldset`; each `Item` has a unique `name` that becomes the
    `FormData` key.
  - `FormData.get(itemName)` reads a single answer; `FormData.getAll(itemName)` reads a multi-checkbox
    answer (`multiple: true` within one `Choice` group).
  - Exported parts: `QuestionnaireInput` (one input field wrapper), `QuestionnaireChoice`/
    `QuestionnaireChoices` (one choice group). An `Item` supports **one** `Choice` group, OR one
    optional freeform `Input` alongside choices — **not** multiple independently-named `Input` fields.
  - **No pattern exists for multiple independently-named `Input` fields inside one `Item`.**
  - **Consequence** (drives `design.md`'s Round 3 FR-10 override): any UI screen migrated onto this
    model gets exactly one navigable unit per `Item` — a multi-field flat form (like `StrategyWizard`'s
    original Step 1) can only be expressed as one `Item` per field, i.e. one screen per field, not one
    screen with several independently-named answers.

## Risks / Not-found

- **`fails.md` 2026-08-05 "trader-chart-panel — assumption"** (reused above): a prior feature spec'd
  against a library's documented newer major-version API before the dependency was actually installed;
  the installed version resolved to an older major with a different surface (`addCandlestickSeries` v4
  vs `addSeries(CandlestickSeries)` v5 — the exact same shape of trap recharts v2-vs-v3 now presents
  for FR-2/FR-3). Applies directly: `ui/chart.tsx` must be drafted against whichever recharts major is
  actually installed at implementation time, not the CLI registry's declared `recharts@3.8.0`, unless
  the design explicitly decides to bump `recharts` as part of this feature (larger blast radius —
  `EquityCurveChart.tsx`'s existing v2 `ComposedChart`/`Scatter`/custom-`shape`-prop usage would need
  re-verification against v3, not just the new `chart.tsx` file).
- **`insights.md` 2026-08-05 "trader-chart-panel — reuse"** (same feature, confirms the general rule):
  "when a spec step adds a new npm dependency, defer exact API-call instructions until after that
  dependency is actually installed."
- **`fails.md` 2026-08-05 "align-frontend-e2e-bff-mocks — duplication"**: mock/test shape drift between
  files that look similar but aren't identical recurs when copied by hand — relevant if
  `RepeatableRowList`'s per-consumer render-prop rows are drafted by eyeballing one existing editor and
  assuming the others match (they don't: `OutputEditor` is single-tier, `ParameterEditor` is two-tier
  with a conditional body grid, `RuleEditor` has no move controls at all — see Codebase Map).
- **FR-5 blast radius wider than product-spec's Affected Services lists** — `useCandlestickChart` has
  3 consumers (`ChartPanel.tsx`, `trader/positions/[symbol]/page.tsx`, `insights/market/[symbol]/
  page.tsx`), not the 1 the product spec names. Not a product-spec defect (FR-5 is scoped as a design
  decision, and the hook itself is the shared unit regardless of which call sites are enumerated), but
  the design and later the impl-spec must account for all three if "replace" is chosen.
- **`e2e/trader/chart-panel.spec.ts` is unusually implementation-coupled** — it waits on the
  `.tv-lightweight-charts` DOM class `lightweight-charts` itself injects
  (`chart-panel.spec.ts:198-206`) as an async-readiness signal before the timeframe-switch assertion. A
  "replace" decision would need to rewrite this readiness wait, not just swap chart internals.
- **`IconPlaceholder` import in the raw `questionnaire.tsx` registry payload** — the file fetched
  directly from the registry JSON imports `IconPlaceholder` from `@/app/(create)/components/
  icon-placeholder`, a path specific to shadcn's own demo app. This is expected to resolve correctly
  when installed through the actual `npx shadcn@latest add questionnaire` CLI flow (which performs the
  icon-library substitution other primitives in this repo already went through — see `combobox.tsx`'s
  `@tabler/icons-react` imports), not confirmed by fetching the raw registry file directly. Flag as a
  fallback risk if the CLI is unavailable at implementation time and the file must be hand-authored
  from this raw payload.
- **No e2e coverage at all** for `OutputEditor`/`ParameterEditor` row add/move/remove interactions
  (`e2e/insights/formulas.spec.ts` never interacts with a formula row — confirmed by reading the whole
  63-line file) or for `FormulaRunResult.tsx`'s sparkline. FR-4/FR-8's migration for those three files
  has no e2e regression safety net; relies on manual verification (already flagged in product-spec
  Acceptance Criteria #6 during `/sdd-review`).

## Recommended Scope

Advisory step boundaries for `/sdd-spec` (not binding):

1. FR-1 close-out — no code change; a `context.md`/`design.md` confirmation only.
2. FR-2 — add `ui/chart.tsx` (CLI or hand-authored against the *installed* recharts major — design
   decision, see Open Risks above).
3. FR-3 — migrate `EquityCurveChart.tsx` onto `ChartContainer`/`ChartTooltipContent`, preserving
   `equity-curve-chart`/`curve-tooltip`/`marker-tooltip`/`trade-marker`/`equity-curve-empty` testids.
4. FR-4 — migrate `FormulaRunResult.tsx`'s `Sparkline` onto a small `ChartContainer`-wrapped
   `recharts` `LineChart`.
5. FR-5 decision + (if "replace") its implementation across all 3 `useCandlestickChart` consumers; (if
   "keep") the `services/xstockstrat-ui/CLAUDE.md` sanctioned-exception note (owner applies centrally
   per this session's constraints).
6. FR-6 — extend/bind `useListEditor` for `RuleEditor.tsx`'s condition rows.
7. FR-7 — extract `RepeatableRowList.tsx`, built to support: (a) single-tier rows (`OutputEditor`
   shape), (b) two-tier rows with a conditional body grid (`ParameterEditor` shape), (c) move controls
   as optional (present for a/b, absent for `RuleEditor`'s conditions).
8. FR-8 — migrate all three editors onto `RepeatableRowList` + `useListEditor`, deleting bespoke logic.
9. FR-9/FR-10 decision + FR-9's install (CLI-vendored `questionnaire.tsx`, confirmed live to match this
   repo's registry/style) + FR-10's shell-vs-restructure scope (design-time evidence favored (a)
   shell-only for the whole wizard — see Dependencies § answer model finding above — but the user
   directly overrode this for **Step 1 specifically** in a later Round 3 session, per `design.md`;
   Steps 2/3/4 remain shell-only as this recon originally found).
10. FR-11 — replace the `<ol>` step indicator with `Questionnaire.Progress` (or the FR-10-decided shell).
