# Product Spec: shadcn-migration-custom-composites

**Created**: 2026-08-08

---

## Problem Statement

The "Component Ledger" audit's "bespoke — correctly not reinvented" list (12 domain-specific widgets
with no shadcn analog) held up under re-verification for most entries, but four of them are worth
revisiting now that `119-shadcn-ui-migration` has landed the shadcn CLI toolchain: (1) the audit's own
Combobox finding is now stale — it's already the real shadcn recipe; (2) the app runs three
independent, unconsolidated charting approaches (`recharts`, `lightweight-charts`, inline SVG) with no
shared theming layer, and shadcn now ships an official `Chart` primitive; (3) three separate
repeatable-row editors (`OutputEditor`, `ParameterEditor`, `RuleEditor`'s condition builder) implement
overlapping add/move/remove logic — two already share a hook, one doesn't; (4) `StrategyWizard`'s
numbered step indicator has no shadcn analog in the *core* registry, but shadcn now ships a dedicated
`Questionnaire` primitive for exactly this multi-step-flow shape.

## User Story

As an `xstockstrat-ui` developer, I want the four remaining "bespoke" audit findings that now have a
real shadcn answer — Combobox (verify only), chart consolidation, the repeatable-row-editor family, and
the strategy wizard shell — addressed with a deliberate design decision recorded for each, rather than
left as unrevisited audit notes now that the underlying primitives exist.

## Functional Requirements

### Combobox — verification only, no migration needed

FR-1. Confirm `src/components/ui/combobox.tsx` is the shadcn CLI-generated `radix-rhea`-style Combobox
(it is — built on `@base-ui/react`'s `Combobox.Root` compound API per `components.json`'s
`"style": "radix-rhea"`), and confirm its three call sites (`src/components/trader/ChartPanel.tsx`,
`src/components/insights/ComponentEditor.tsx`, `src/components/insights/RuleEditor.tsx`) all use the
current compound API (`Combobox`/`ComboboxInput`/`ComboboxContent`/`ComboboxList`/`ComboboxItem`), not
the pre-119 single-prop wrapper. **This is already true as of `119-shadcn-ui-migration`** — this FR
closes the audit's original "self-built, no `cmdk`/Popover dependency" finding as resolved, with no
code change expected. If `/sdd-design` or `/sdd-spec` finds a stray call site still on the old API,
that becomes an in-scope fix; otherwise this FR is a documentation-only close-out in `context.md`.

### Chart consolidation

FR-2. Add `src/components/ui/chart.tsx` (`npx shadcn@latest add chart` against the existing
`components.json` preset — the official shadcn `Chart` primitive: `ChartContainer` +
`ChartTooltipContent` + `ChartLegendContent`, a thin composition layer over `recharts` driven by CSS
custom properties, not a wrapper that locks out `recharts`'s own API).

FR-3. Migrate `src/components/insights/EquityCurveChart.tsx` (composed `recharts` line/scatter chart
with a hand-rolled `CurveTooltip`) onto `ui/chart.tsx`'s `ChartContainer`/`ChartTooltipContent`,
replacing the hand-rolled tooltip with the shared one.

FR-4. Migrate `src/components/insights/FormulaRunResult.tsx`'s inline-SVG `Sparkline` onto a small
`recharts`-based `LineChart` wrapped in `ui/chart.tsx`'s `ChartContainer`, matching the theming (CSS
variable-driven stroke/fill) the other two charts use after FR-3.

FR-5. **Design decision, not pre-decided here**: evaluate whether `src/components/trader/ChartPanel.tsx`'s
`lightweight-charts`-based OHLCV candlestick chart should also move onto a `recharts` + `ui/chart.tsx`
composition, or stay on `lightweight-charts` as a deliberate, documented exception. `recharts` has no
first-party candlestick geometry — a `recharts` candlestick needs a custom `Customized`/`Bar`-shape
composition, which is real additional engineering, not a drop-in swap like FR-3/FR-4. `/sdd-design`
must record the decision and rationale in `design.md`. If the decision is to keep `lightweight-charts`,
add a short "sanctioned exception" note to `services/xstockstrat-ui/CLAUDE.md` § Styling so a future
audit doesn't re-flag `ChartPanel.tsx` as unconsolidated.

### Repeatable-row editor composite

FR-6. Extend the existing `src/hooks/useListEditor.ts` (already shared by `OutputEditor.tsx` and
`ParameterEditor.tsx`) — or generalize it if its current shape is too narrow — to also back
`src/components/insights/RuleEditor.tsx`'s visual condition-tree builder (`RuleEditor.tsx:179-325` as
of current `main-dev`; this is inside `mode === 'visual'`'s render branch, and reimplements its own
add/update/remove logic over `tree.conditions` independently of the shared hook).

FR-7. Extract a shared, presentational composite (e.g. `src/components/shared/RepeatableRowList.tsx`)
built from the shadcn primitives already in `src/components/ui/` (`Card`, `Button`, `Input`, `Select`,
`Combobox`) that renders one row per list item with add / move-up / move-down / remove controls via a
render-prop for the row's own fields — a per-row shape that differs by consumer (numeric min/max
inputs for `ParameterEditor`, name/type fields for `OutputEditor`, `Combobox`+`Select` lhs/comparator/rhs
for `RuleEditor`'s conditions).

FR-8. Migrate `OutputEditor.tsx`, `ParameterEditor.tsx`, and `RuleEditor.tsx`'s condition rows onto
`RepeatableRowList` + the (possibly generalized) `useListEditor` hook, deleting `RuleEditor.tsx`'s
bespoke condition-array add/remove/move logic. This is a composite built **from** shadcn primitives —
shadcn's own registry has no "list editor" or "rule builder" recipe to install; do not present this as
adding a shadcn primitive.

### Strategy wizard shell

FR-9. Add the shadcn `Questionnaire` primitive (confirmed live at `ui.shadcn.com/docs/react/questionnaire`
— an unstyled multi-step form primitive: `Root`/`Item`/`Title`/`Description`/`Choices`/`Choice`/
`ChoiceInput`/`ChoiceLabel`/`Input`/`Error`/`Progress`/`Navigation`, managing answers, progress,
validation, and step navigation). **Confirm the actual install path at `/sdd-design` time** — its own
docs show installation as an npm package (`pnpm add @shadcn/react`, `import { Questionnaire } from
"@shadcn/react/questionnaire"`), not the `npx shadcn@latest add <name>` CLI-vendored-source model this
repo's other `ui/*` primitives use; verify against the shadcn CLI version pinned in this repo whether a
CLI-vendored equivalent also exists, since an npm dependency the team doesn't own has different
maintenance implications than vendored source it does (see `services/xstockstrat-ui/CLAUDE.md` §
Styling's existing CLI-managed convention).

FR-10. **Design decision, not pre-decided here**: `Questionnaire` models "one question at a time" with
`Choice`/`ChoiceInput`/`Input` single-answer semantics — well suited to the step
**indicator/progress/navigation shell** (`Questionnaire.Progress`, `Root`'s `item`/`onItemChange`
state, `Next`/`Previous`/`Submit`), a much less obvious fit for `StrategyWizard`'s actual step
**content**, which holds rich sub-forms (symbol/side pickers, an embedded `RuleEditor`, risk-sizing
fields) rather than single Choice/Input answers. `/sdd-design` must choose between: (a) adopt
`Questionnaire.Root`/`Item`/`Progress`/navigation as the wizard shell only, keeping each step's existing
rich content un-refactored inside a `Questionnaire.Item`; or (b) restructure step content to fit
`Questionnaire`'s native answer model. Do not default to (b) without first checking whether a step that
embeds `RuleEditor` can be expressed as `Choice`/`Input` answers at all — if it can't, (a) is the only
viable option for that step regardless of what's chosen for the simpler steps.

FR-11. Replace `StrategyWizard.tsx:159-178`'s hand-rolled `<ol>` step indicator (numbered pills, active/
complete/upcoming tone via a `cn()` ternary) with `Questionnaire.Progress` (or the composed shell
resulting from FR-10's decision).

## Out of Scope

- The high/medium/low-confidence occurrences already covered by
  `120-shadcn-migration-high-confidence`, `121-shadcn-migration-medium-confidence`, and
  `122-shadcn-migration-low-confidence`.
- The remaining 8 "no close match" bespoke widgets from the original audit not listed above
  (candlestick-adjacent decision aside, the candlestick chart's *existence* stays; Monaco formula
  editor, list-editor consumers' *domain logic* — only their repeated shell moves; stat tiles; inline-edit
  watchlist name; copilot note thread; empty state; mobile section dispatcher) — nothing to change there.
- Any visual/behavioral redesign of chart data, tooltips content, or wizard step *order* beyond what
  FR-2 through FR-11 require — this is a consolidation and componentization pass, not a UX redesign.

## Affected Services

- `xstockstrat-ui` — `src/components/insights/{EquityCurveChart,FormulaRunResult,OutputEditor,
  ParameterEditor,RuleEditor,StrategyWizard}.tsx`, `src/components/trader/ChartPanel.tsx` (FR-5
  decision only), `src/hooks/useListEditor.ts`; new files `src/components/ui/chart.tsx`,
  `src/components/shared/RepeatableRowList.tsx`, and (pending FR-9's install-path confirmation) either
  `src/components/ui/questionnaire.tsx` or a new `@shadcn/react` dependency in `package.json`.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` `/insights` segment: the strategy wizard (`strategies/new`), formula
  workspace (`OutputEditor`/`ParameterEditor` consumers), rule editor (used by both formula and
  strategy authoring), backtest equity-curve display, formula run-result sparkline. `/trader` segment
  only if FR-5 decides to touch `ChartPanel.tsx`. All within already-shipped, already-reachable pages —
  no new routes.
- [ ] **Agent** — not applicable.
- [ ] **None**.

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/shadcn-migration-custom-composites` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking, UI-only change — `xstockstrat-ui` owner)
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable
- [ ] DBA review + service owner (schema migration) — not applicable

## Acceptance Criteria

1. `context.md` records the Combobox close-out (FR-1) with confirmation that all three call sites use
   the current compound API — or, if a stray old-API call site is found, a fix for it.
2. `src/components/ui/chart.tsx` exists; `EquityCurveChart.tsx` and `FormulaRunResult.tsx`'s sparkline
   both render through it with no hand-rolled tooltip/SVG chart code remaining in either file.
3. FR-5's `lightweight-charts` keep-vs-replace decision is recorded in `design.md` with rationale; if
   "keep," `services/xstockstrat-ui/CLAUDE.md` § Styling documents it as a sanctioned exception.
4. `src/components/shared/RepeatableRowList.tsx` exists; `OutputEditor.tsx`, `ParameterEditor.tsx`, and
   `RuleEditor.tsx`'s condition builder all render through it and the shared `useListEditor` hook, with
   no independent add/move/remove implementation remaining in any of the three.
5. FR-10's Questionnaire shell-vs-restructure decision is recorded in `design.md`, and
   `StrategyWizard.tsx`'s step indicator renders through the resulting `Questionnaire`-based shell.
6. `pnpm lint` and `pnpm build` pass with no new errors; `pnpm test:e2e` passes for every spec covering
   a touched page/component (strategy wizard flow, formula workspace, rule editor, backtest diagnostics
   equity curve, formula test-run sparkline).

## Open Questions

- [ ] **FR-5 decision** (chart-library scope) is explicitly deferred to `/sdd-design` — do not resolve
  it in `/sdd-spec` by default-choosing "keep `lightweight-charts`" just because it's less work; weigh
  both options on their merits and record the rejected alternative, per the design-debate pattern this
  repo already uses (`docs/roadmap/features/023-position-sizing-engine/design.md` § Rejected
  Alternatives is a good reference for the write-up shape).
- [ ] **FR-9/FR-10 decision** (Questionnaire install path and shell-vs-restructure scope) is explicitly
  deferred to `/sdd-design` for the same reason — additionally, confirm at that time whether
  `Questionnaire`'s `render` prop / custom-rendering support (mentioned in its docs but not fully
  detailed) is sufficient to embed `RuleEditor` inside a `Questionnaire.Item` without fighting the
  primitive's own DOM structure, before committing to option (a) or (b).
- [ ] Per the same e2e-parity caution as the three sibling features' Open Questions
  (`docs/roadmap/ledger/fails.md`, 2026-08-05 — align-frontend-e2e-bff-mocks — duplication), grep
  `e2e/insights/strategies*.spec.ts` and any formula-workspace/rule-editor specs for selectors keyed to
  the current step-indicator/list-editor/chart markup before committing to FR-8/FR-11's migration order.
