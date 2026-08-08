# Design: shadcn-migration-custom-composites

**Created**: 2026-08-08
**Rounds**: 2 (full; termination: approved — see note on interactive gating below)
**Approved by**: synthesized by this session against strong recon evidence; **the two genuine
architecture forks (FR-5, FR-9/FR-10) and the recon-discovered third recharts consumer were meant to
be gated via `AskUserQuestion` per the orchestrating session's instructions, but no `AskUserQuestion`
tool (nor a `Task` tool to spawn `design-proposer`/`design-adversary` subagents) was available in this
execution environment.** This session ran both debate roles itself (see Round 1 / Round 2 below,
labeled Proposer/Adversary/Synthesis) and made the calls on documented evidence. **These decisions —
FR-5 keep, FR-9 CLI-vendored install, FR-10 shell-only, and the recharts-version and third-chart-site
calls below — need the user's explicit confirmation before `/sdd-execute`**, exactly as the two named
forks would have received via the interactive gate. Flagged prominently in the final report to the
orchestrating session.
**Grounded in**: recon.md

---

## Round 1

**Proposer**: (1) FR-1 — confirmed no-op, close out. (2) FR-2 — hand-author `ui/chart.tsx` targeting
the *installed* `recharts@^2.12.7` (`package.json:50`), adapted from the shadcn `radix-rhea` registry's
reference file rather than running the CLI as-is (registry declares `recharts@3.8.0`,
`recon.md` § Dependencies). (3) FR-3 — migrate `EquityCurveChart.tsx` onto `ChartContainer` +
per-symbol dynamic `ChartConfig`, preserving all 5 testids (`recon.md` Codebase Map). (4) FR-4 —
migrate `FormulaRunResult.tsx`'s `Sparkline` onto a `ChartContainer`-wrapped `recharts` `LineChart`.
(5) FR-5 — **keep** `lightweight-charts` as a sanctioned exception. (6) FR-6/7/8 — `RepeatableRowList`
supporting single-tier rows, two-tier rows with a conditional body grid, and optional move controls;
bind `RuleEditor.tsx`'s `tree.conditions` directly to `useListEditor` without generalizing the hook.
(7) FR-9 — adopt the CLI-vendored `questionnaire.tsx` (confirmed live against the `radix-rhea`
registry, matches this repo's post-119 primitive shape). (8) FR-10 — **shell only** (option a).
(9) FR-11 — `<ol>` → `Questionnaire.Progress`, preserving the e2e-load-bearing button text.

**Adversary**:
1. **FR-2 hand-authoring vs. running the CLI** — this repo's own `services/xstockstrat-ui/CLAUDE.md`
   documents `npx shadcn@latest add <name>` as the norm for "adding a primitive not yet in
   `ui/`," and a future `apply --preset` re-run will silently overwrite a hand-authored `chart.tsx`
   with the v3-targeted registry version, same risk the CLAUDE.md's functional-variant-reconciliation
   note already flags for `button.tsx`/`badge.tsx`. Counter-proposal: bump `recharts` to `3.8.0` as
   part of this feature and let the CLI run cleanly.
2. **FR-5 "keep"** — perpetuates exactly the charting fragmentation FR-2's own Problem Statement
   complains about ("three independent, unconsolidated charting approaches... no shared theming
   layer"). `lightweight-charts` already carries its own major-version-drift risk
   (`insights.md` "trader-chart-panel — reuse": v4 `addCandlestickSeries` vs. v5
   `addSeries(CandlestickSeries)`, `useCandlestickChart.ts:31` already comments on this). Counter-
   proposal: at least attempt the `recharts` `Customized`/`Bar`-shape candlestick composition
   product-spec's own FR-5 text floats as the alternative.
3. **FR-10 shell-only** — accepted in principle given `recon.md`'s `Questionnaire.Item` pass-through
   evidence, but flags: product-spec's own conditional framing ("if [RuleEditor] can't [map to
   Choice/Input], (a) is the only viable option for **that step** regardless of what's chosen for the
   simpler steps") implies the simpler steps (1, 2, 4) might still go with (b) restructure — the
   proposer's blanket "shell only for the whole wizard" may be over-scoping the shell decision without
   checking each step individually.
4. **Constitution check**: no Floor (`F-*`) items implicated (no migrations, no direct pushes, no
   hardcoded config, no invented paths — everything above is recon-cited). **C-10** (integration
   completeness across shared/duplicated surfaces) is relevant to FR-2/FR-3's very premise — flags it
   should be checked against every `recharts` consumer, not just the one product-spec names.

**Synthesis (Round 1)**: FR-1, FR-3, FR-4, FR-6/7/8, FR-9, FR-11 stand as proposed (no live
objection). FR-2 (hand-author vs. bump) and FR-5 (keep vs. replace) need a second round with concrete
evidence, not just competing preferences. FR-10 needs the adversary's step-by-step check actually run,
not asserted either way. The adversary's C-10 prompt led to grepping every `recharts` import in
`src/`, which surfaced a finding neither product-spec nor round 1 had: **`src/app/insights/page.tsx`
has a second, independent hand-rolled `recharts` `LineChart`** ("Score Trend"/"Equity Curve" dashboard
card, `recon.md` Codebase Map) — a third charting-fragmentation site product-spec's Affected Services
doesn't name. Carried into Round 2. No Floor breach.

## Round 2

**Proposer** (addressing Round 1 objections with evidence):
1. **FR-2**: Diffing the registry's `chart.tsx` against `recharts@2.12.7`'s actual API surface, only
   two things are v3-specific: `ChartContainer`'s `initialDimension` prop passed to
   `RechartsPrimitive.ResponsiveContainer` (v2's `ResponsiveContainer` has no such prop — SSR-safe
   initial sizing was added in v3; simply omit it, matching how `EquityCurveChart.tsx`'s existing
   `ResponsiveContainer` usage already omits it today) and the `import type { TooltipValueType } from
   "recharts"` (unused by anything this feature's `ChartTooltipContent` usage needs; drop the import or
   inline an equivalent local type). This is a small, mechanical adaptation of one new file — not a
   rewrite. Bumping `recharts` instead is the larger, riskier move: it touches two *existing*,
   already-shipped charts (`EquityCurveChart.tsx`'s `ComposedChart`/`Scatter`/custom-`shape`-prop usage
   and `insights/page.tsx`'s `LineChart`) for a "consolidation pass, not a UX redesign" (product-spec's
   own Out-of-Scope language), and both risk-vs-reward and root CLAUDE.md's "write the minimum that
   solves the stated problem... no 'while I'm here' scaffolding" argue against a mid-feature major
   version bump the product spec never asked for.
2. **FR-5**: Three concrete, recon-grounded reasons "keep" is not merely the lazier option: (a)
   `useCandlestickChart.ts` has **3 consumers** (`ChartPanel.tsx`, `trader/positions/[symbol]/
   page.tsx`, `insights/market/[symbol]/page.tsx`), tripling the blast radius of any rewrite beyond
   what product-spec's Affected Services names; (b) `e2e/trader/chart-panel.spec.ts:198-206` waits on
   the `.tv-lightweight-charts` DOM class `lightweight-charts` itself injects as its async-readiness
   signal — a `recharts` migration requires redesigning this wait strategy, not just swapping chart
   internals, for a chart with **zero** first-party candlestick support in the target library (product-
   spec's own stated fact) — the "Customized/Bar-shape composition" alternative means hand-building
   OHLC wick/body pixel geometry from scratch on `/trader`'s live price chart, the highest-visibility,
   highest-consequence chart in the app (a rendering bug here misleads a trade decision, not just an
   analytics view); (c) `recharts` is *itself* mid-major-version churn (FR-2's own recon finding) —
   piling brand-new hand-rolled geometry onto a library being bumped in the same feature compounds
   risk for zero required benefit. The "shared theming" goal FR-2 pursues is achievable for
   `lightweight-charts` far more cheaply if ever wanted: `useCandlestickChart.ts` already hardcodes this
   app's dark-theme hex values (`#22c55e`/`#ef4444`/`#94a3b8`/etc.) — swapping those for the app's CSS
   custom properties gets partial visual consistency without a library migration, and is a candidate
   **follow-up**, not part of this feature.
3. **FR-10**: Ran the adversary's step-by-step check explicitly. Step 2 (dynamic `ComponentEditor`
   list — rich sub-forms, not scalar choices) and Step 3 (two `RuleEditor` instances — a nested
   `{op, conditions: [{lhs,fn,rhs}]}` tree, not reducible to a `Choice`/`Input` answer) both fail
   `Questionnaire`'s single-scalar-answer-per-`Item` model (`recon.md` § Dependencies —
   `FormData.get(itemName)`/`getAll`), confirming product-spec's own prediction for the RuleEditor
   step. **Step 1's 4 independent fields are structurally the closest fit** for 4 separate
   `Questionnaire.Item`+`Input` pairs — but doing so would turn today's single 4-field screen into 4
   separate step screens (one `Item` = one answer = one navigable unit in `Questionnaire`'s model),
   changing the wizard's step count and pacing. That is a flow/UX redesign, which product-spec's
   Out-of-Scope explicitly excludes ("any visual/behavioral redesign... beyond what FR-2 through FR-11
   require... not a UX redesign"). Step 4 has no form fields to collect at all (read-only summary +
   conditional error-jump) — it maps naturally to `Questionnaire.Submit` either way. **Net: every step
   is ruled out from (b) restructuring — steps 2/3 by the answer-model mismatch, step 1 by the
   Out-of-Scope UX-redesign constraint, step 4 trivially fits (a) as-is.** This is a stronger and more
   complete result than "RuleEditor forces (a) for its step, undecided elsewhere" — it's (a) for the
   whole wizard, for two independent, converging reasons.
4. **New finding (from Round 1's C-10 check)**: `src/app/insights/page.tsx:176-199`'s dashboard
   "Score Trend" `LineChart` is the same shape of duplication FR-3/FR-4 already fix elsewhere (a
   self-contained, non-dynamic `LineChart` + axes + `Tooltip`, materially simpler than
   `EquityCurveChart.tsx`'s multi-series/scatter composition and closer to a straight FR-4-style
   migration). Recommend folding it into this feature's scope as a natural extension of FR-3's
   established pattern — not excluded by Out-of-Scope (which excludes *other features'* findings and
   *behavioral* redesign, not a same-shape consolidation site recon discovered) — but this expands
   product-spec's literal Affected Services list, so it is called out explicitly here rather than
   silently folded in.

**Adversary (Round 2)**: Accepts FR-2 (adapt, don't bump) and FR-5 (keep) given the concrete evidence,
with two conditions carried into Open Risks: (a) the `services/xstockstrat-ui/CLAUDE.md` § Styling
sanctioned-exception note (product-spec AC#3) must actually land, or a future audit re-flags
`ChartPanel.tsx`; (b) the hardcoded-hex-to-CSS-variable follow-up for `useCandlestickChart.ts` is
worth a ledger note (`insights.md`) even though it's out of this feature's scope, so it isn't
forgotten. Accepts FR-10 shell-only given the step-by-step trace. On the `insights/page.tsx` finding:
agrees it's in-scope-eligible per Out-of-Scope's actual wording, but notes this **materially changes
product-spec's Affected Services / Consumer Surface** beyond what `/sdd-review` approved — recommend
recording it explicitly (not silently) and flagging for the orchestrating session's confirmation before
`/sdd-spec` locks it into concrete steps, rather than the design phase unilaterally deciding a spec-
approved document's scope grew. No Floor breach in any of the above.

**Synthesis (Round 2, final)**: All items resolved with recon-grounded evidence and no unresolved
Floor breach. Per this session's HARD CONSTRAINTS (no `AskUserQuestion`/`Task` tool available), the
design proceeds to `design.md` with the above as the chosen approach, flagged for the user's
confirmation in the final report rather than gated interactively.

---

## Chosen Approach

1. **FR-1** — verification-only close-out, no code change (already confirmed in `context.md`'s
   `sdd-review` session and re-confirmed in `recon.md`).
2. **FR-2** — hand-author `src/components/ui/chart.tsx`, adapted from the shadcn `radix-rhea` registry
   item (fetched live, `recon.md` § Patterns to REUSE) but targeting the *installed*
   `recharts@^2.12.7` (drop the v3-only `initialDimension` prop and `TooltipValueType` import). Same
   `ChartContainer`/`ChartConfig`/`ChartStyle`/`ChartTooltipContent`/`ChartLegendContent` composition
   shape as upstream, same `data-slot` / plain-function-component convention as every other
   `ui/*` primitive in this repo (`recon.md` Codebase Map — `button.tsx:39-46`).
3. **FR-3** — migrate `EquityCurveChart.tsx` onto `ChartContainer` with a `ChartConfig` built at render
   time (one entry per `series[i].symbol`, matching the existing dynamic-line-count pattern). Preserve
   `data-testid`s `equity-curve-chart`, `curve-tooltip`, `marker-tooltip`, `trade-marker`,
   `equity-curve-empty` exactly (all e2e-load-bearing, `recon.md` Codebase Map /
   `e2e/insights/backtest-coverage.spec.ts:168-178`).
4. **FR-4** — migrate `FormulaRunResult.tsx`'s `Sparkline` onto a `ChartContainer`-wrapped `recharts`
   `LineChart` (hidden axes, matching the current 140×30 no-axis look); no e2e selector to preserve
   (confirmed none exists), so this is presentation-parity-by-manual-check only.
5. **FR-5 — KEEP `lightweight-charts`** as a documented sanctioned exception. Reasons (see Round 2):
   3 shared consumers of `useCandlestickChart`, e2e coupling to `lightweight-charts`'s own injected
   DOM class, no first-party `recharts` candlestick geometry on the highest-consequence chart in the
   app, and `recharts` itself mid-major-version churn. **Sanctioned-exception note text** (for
   `services/xstockstrat-ui/CLAUDE.md` § Styling — the orchestrating session applies this, per this
   session's constraints):
   > `ChartPanel.tsx` (and its siblings via the shared `useCandlestickChart.ts` hook —
   > `trader/positions/[symbol]/page.tsx`, `insights/market/[symbol]/page.tsx`) intentionally stays on
   > `lightweight-charts` rather than `recharts`/`ui/chart.tsx` (feature 123 design decision,
   > 2026-08-08): `recharts` has no first-party OHLCV candlestick geometry, the hook has 3 shared
   > consumers across `/trader` and `/insights`, and `e2e/trader/chart-panel.spec.ts` depends on
   > `lightweight-charts`'s own injected `.tv-lightweight-charts` DOM class as an async-readiness
   > signal. Do not re-flag this as an unconsolidated charting approach in a future audit.
6. **FR-6** — bind `RuleEditor.tsx`'s `tree.conditions` (already a flat `Condition[]`, confirmed —
   `recon.md`) directly to `useListEditor<Condition>(tree.conditions, (next) => updateTree({ ...tree,
   conditions: next }), () => ({ lhs: '', fn: '>', rhs: '' }))` — no generalization of the hook needed.
7. **FR-7** — `src/components/shared/RepeatableRowList.tsx`, built from existing `ui/` primitives
   (`Card`/`Button`/`Input`/`Select`/`Combobox`), supporting the three row shapes recon found: (a)
   single-tier (`OutputEditor`), (b) two-tier with a conditional body grid (`ParameterEditor`), (c)
   move controls present-or-absent per consumer (`RuleEditor`'s conditions have none today, order is
   semantically irrelevant under AND/OR). Row content via a render-prop taking `(item, index, {update,
   move?, remove})`.
8. **FR-8** — migrate `OutputEditor.tsx`, `ParameterEditor.tsx`, `RuleEditor.tsx`'s condition rows onto
   `RepeatableRowList` + `useListEditor`, deleting each file's independent add/move/remove logic.
9. **FR-9** — adopt `Questionnaire` via the CLI-vendored path: `npx shadcn@latest add questionnaire`
   against the existing `components.json` preset (confirmed live to exist and match this repo's exact
   `radix-rhea` style — `recon.md` § Patterns to REUSE). This still pulls in `@shadcn/react` as a
   transitive npm dependency (confirmed via the live registry payload — even the styled/CLI-vendored
   variant depends on the unstyled npm package under the hood) — accepted, since there is no
   dependency-free path to this primitive; **pin it precisely** (`@shadcn/react@0.3.0`, not a caret
   range) given its pre-1.0/actively-changing status (verified against the live npm registry: created
   2026-06-26, last modified 2026-08-05 — 3 days before this design session).
10. **FR-10 — SHELL ONLY (option a), for the *entire* wizard**, not just the RuleEditor step. Every
    step is ruled out from (b) restructuring: Steps 2/3 fail `Questionnaire`'s single-scalar-answer-
    per-`Item` model outright (dynamic `ComponentEditor` list; nested rule tree); Step 1's 4 fields are
    the closest structural fit but splitting them into 4 separate `Questionnaire.Item`s would change
    the wizard's step count/pacing — an Out-of-Scope UX redesign; Step 4 has no fields to collect and
    trivially fits (a) via `Questionnaire.Submit`. `StrategyWizard.tsx` keeps its own `step`/component
    React state exactly as today; `Questionnaire.Root`/`Item`/`Progress`/`Previous`/`Next`/`Submit`
    supply only the chrome — `Questionnaire`'s own `FormData`-driven answer/validation model is not
    used at all.
11. **FR-11** — replace `StrategyWizard.tsx:159-178`'s `<ol>` with `Questionnaire.Progress`. Preserve
    the `Next`/`Back`/`Create Strategy`/`Save Changes` button text (e2e-load-bearing,
    `e2e/insights/strategy-authoring.spec.ts`) on whichever elements the FR-10 shell renders them as
    (`Questionnaire.Next`/`Questionnaire.Previous`/`Questionnaire.Submit`, with `children` overriding
    each part's own default text per the registry file's `children ?? 'Next'`-style fallback pattern
    confirmed in `recon.md`).
12. **Recon-discovered scope question (not a literal FR)**: `src/app/insights/page.tsx:176-199`'s
    dashboard "Score Trend" `LineChart` is a same-shape `recharts` duplication FR-2's Problem
    Statement describes but product-spec's Affected Services never names. **Recommended**: fold it
    into FR-3-shaped scope during `/sdd-spec` as a small additional step (same
    `ChartContainer`/`ChartConfig` pattern, no dynamic series, materially simpler than
    `EquityCurveChart.tsx`) — but this is flagged for the orchestrating session's explicit
    confirmation, not silently implemented, since it expands product-spec's already-`/sdd-review`-
    approved Affected Services list.

This is a UI-only, single-service change; the consumer surface is `/insights` (formula workspace, rule
editor, strategy wizard, backtest equity-curve/sparkline displays) and, only for the FR-9/10/11
Questionnaire shell and (if the recon-discovered item above is confirmed) the `/insights` dashboard —
matching product-spec's `## Consumer Surface(s)` (C-14) exactly; `/trader` is touched only by FR-5's
"keep" decision (no code change there beyond the CLAUDE.md note).

## Rejected Alternatives

- **FR-2: bump `recharts` to `3.8.0` to match the CLI registry exactly** — rejected: scope-creeps a
  major dependency upgrade into a UI-consolidation feature that explicitly isn't a redesign, risks
  regressing two already-shipped charts for no requirement this feature has, when the v2-vs-v3 gap in
  the one new file is two small, mechanical omissions.
- **FR-5: migrate `ChartPanel.tsx` (and siblings) onto `recharts` via a custom `Customized`/`Bar`-shape
  candlestick composition** — rejected: `recharts` has no first-party OHLCV geometry (would be built
  from scratch on the highest-consequence chart in the app), the shared hook has 3 consumers not 1,
  the existing e2e suite is coupled to `lightweight-charts`'s own injected DOM class, and `recharts` is
  independently mid-major-version churn from the FR-2 decision above — compounding migration risk for
  a benefit (shared CSS-variable theming) achievable far more cheaply via a follow-up hex-to-CSS-var
  swap in `useCandlestickChart.ts`.
- **FR-9: install `@shadcn/react` directly (`pnpm add @shadcn/react`) and hand-import
  `@shadcn/react/questionnaire`, skipping the CLI-vendored wrapper** — rejected: the CLI-vendored path
  costs nothing extra (same transitive `@shadcn/react` dependency either way, confirmed via the live
  registry payload) and gives the already-styled, already-`data-slot`-convention-matching wrapper file
  for free, consistent with every other primitive in `src/components/ui/`.
- **FR-10: restructure Step 1's 4 fields onto native `Questionnaire.Item`+`Input` answers while keeping
  Steps 2/3 as shell-embedded custom content (a per-step hybrid)** — rejected: splitting Step 1 into 4
  separate `Questionnaire.Item` screens changes the wizard's step count and pacing, which is a
  flow/UX redesign product-spec's Out-of-Scope explicitly excludes; a hybrid would also make FR-11's
  step indicator ambiguous (is a "step" a wizard step or a `Questionnaire.Item`?) for no benefit once
  the full-wizard evidence is traced through.

## Open Risks

- [ ] `@shadcn/react`'s pre-1.0 status (`0.3.0`, last published 3 days before this design session) —
  pin the exact version in `package.json`, not a caret range, and re-verify its API immediately before
  `/sdd-execute` runs the CLI `add questionnaire` step (per the `trader-chart-panel` /
  `unified-login-page` ledger pattern: re-verify a fast-moving external dependency right before use,
  not just at design time) — to be addressed at the FR-9 implementation step.
- [ ] `services/xstockstrat-ui/CLAUDE.md` § Styling sanctioned-exception note for FR-5 (text drafted
  above under Chosen Approach #5) must actually be added by the orchestrating session (this session's
  constraints prohibit editing that file) — to be addressed before this feature is considered
  code-completed, or a future audit re-flags `ChartPanel.tsx`.
- [ ] `insights/page.tsx`'s second `recharts` `LineChart` (Chosen Approach #12) — needs the
  orchestrating session's explicit confirmation before `/sdd-spec` turns it into concrete steps; not
  yet approved scope.
- [ ] `useCandlestickChart.ts`'s hardcoded hex color literals vs. this app's CSS custom properties — a
  candidate low-risk follow-up (partial theming consistency without a full chart-library migration),
  not part of this feature; recommend a `docs/roadmap/ledger/insights.md` note so it isn't lost (the
  orchestrating session applies ledger writes per this session's constraints).
- [ ] This entire design was produced without the interactive `AskUserQuestion` gate the orchestrating
  session's instructions called for (no such tool, nor a `Task` tool for the `design-proposer`/
  `design-adversary` subagents, was available here) — the user should explicitly confirm or override
  the FR-5, FR-9, FR-10, FR-2 (recharts-version), and item-#12 (insights/page.tsx) decisions before
  `/sdd-execute` runs any of them, exactly as the two named forks would have received via the gate.

## Constitution Rules Touched

- `C-01` (zero-assumption / evidence-cited steps) — honored: every recon claim above cites `path:line`
  or a live-fetched registry URL; the `@shadcn/react` maturity claim is cited to the live npm registry
  response, not assumed from the docs page alone.
- `C-10` (integration completeness across shared/duplicated surfaces) — honored by explicitly
  surfacing the third `recharts` consumer (`insights/page.tsx`) rather than letting FR-2's "consolidate
  charting approaches" premise silently stop at the two files product-spec names; flagged as an open
  risk pending confirmation rather than silently folded in or silently ignored.
- `C-14` (name the consumer surface) — honored: Chosen Approach states the consumer surface matches
  product-spec's `## Consumer Surface(s)` exactly, and flags that item #12 (if confirmed) would touch
  the `/insights` dashboard specifically, not a new segment.
- `P-01` (single-orchestrator authority) — this session is the sole writer of `recon.md`/`design.md`;
  no subagent wrote to any file (none were spawned, since no `Task` tool was available — see the header
  note and Open Risks).
- `P-02` (no lateral subagent coordination) — not literally applicable (no subagents were spawned this
  session); the self-run Proposer/Adversary/Synthesis structure above preserves the *spirit* (competing
  positions argued from evidence, then reconciled by a single synthesizer) as closely as possible
  without the tooling.
- `P-04` (phase-gate approval, recorded) — **not fully honored in the interactive sense**: the
  approval gate that should have run via `AskUserQuestion` did not run (tool unavailable). Recorded
  here and in the final report as an explicit deviation, per **P-03** ("no silent deviation — escalate,
  never guess") — this design's forks are documented and flagged for the user's real sign-off rather
  than silently treated as approved.
- `F-11` (Floor rejection halts) — no Floor (`F-*`) violation was identified in either round; nothing
  here required halting the phase.
