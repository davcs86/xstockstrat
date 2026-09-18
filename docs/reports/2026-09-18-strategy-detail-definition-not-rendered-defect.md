# Defect: the Insights strategy detail page never renders the strategy's definition (components, entry/exit rules)

**Date**: 2026-09-18
**Reporter**: davcs86@gmail.com (via Claude Code)
**Severity**: SEV-3
**Impact type**: UX-correctness / observability
**Environment**: staging and production (shipped `xstockstrat-ui`; not tied to an in-flight branch)
**Affected service(s)**: `xstockstrat-ui` (`/insights` segment)
**Config-only fix possible**: no

> Severity rationale: no correctness, trading-safety, or money-movement risk — the engine evaluates
> the stored rules correctly and the authoring surface shows them. This is a read-surface gap: the
> page a user lands on to understand *what a strategy does* omits the only fields that answer that.
> It cost a real investigation session (a user concluded a strategy "has no entry or exit rules"
> when both are stored and correct), which is the observability cost this report exists to remove.

## Observed

`/insights/strategies/<id>` renders six cards — Strategy Grade, Warnings, Live Evaluation,
Analytics, Run Backtest, Past Runs (`services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx`,
`CardTitle`s at `:230`, `:262`, `:276`, `:291`, `:347`, `:389`, `:462`, `:478`, `:523`, `:590`).

None of them shows the strategy's **definition**. A grep for `rule|condition|component` over that
file hits only `report.score.componentScores` (`:247`). The page therefore displays no components,
no `entry_rule`, and no `exit_rule` for any strategy.

Concretely, `fundamentals_macd_blend` on staging stores both rules and renders neither:

```json
"entry_rule": "{\"lhs\":\"macd\",\"fn\":\"crosses_above\",\"rhs\":\"macd.signal\"}",
"exit_rule":  "{\"lhs\":\"macd\",\"fn\":\"crosses_below\",\"rhs\":\"macd.signal\"}"
```

## Expected

The detail page should present the strategy's definition — at minimum its components (ref name,
indicator/formula, params) and its entry and exit rules in the same human-readable form the
authoring wizard already uses — so a reader can answer "what does this strategy do?" without
opening the admin-gated edit form.

## Reproduction

1. Open `/insights/strategies/fundamentals_macd_blend` (any registered strategy reproduces it).
2. Observe: no components, no entry rule, no exit rule anywhere on the page.
3. Open `/insights/strategies/fundamentals_macd_blend/edit` (requires admin) → Step 3 shows both
   rules via `RuleSummary` (`components/insights/StrategyWizard.tsx:457-458`).
4. Or call the RPC directly — `get_strategy` / `ListStrategyDefinitions` both return the rules
   populated, so the data is present at every layer below the view.

## Root cause

**The data is already fetched and then simply not used.** The page calls `useGetStrategy(id)` at
`page.tsx:53`:

```tsx
const { data: definition } = useGetStrategy(id);
```

Every consumption of `definition` in the file is `warnings` (`:273`, `:280`), `liveEnabled`
(`:288`-`:315`), `signalEligible` (`:332`-`:335`), and `active` (`:343`-`:353`). The fields
`components`, `entryRule`, `exitRule`, `cooldownDays`, `exitCooldownDays`, `deniedSymbols`, and
`signalParams` are never read.

So this needs **no new RPC, no new hook, and no new network call** — only rendering fields already
in component state.

## Notes for design

- A ready-made renderer already exists and is **already exported**: `summarizeRule(value)` in
  `components/insights/RuleEditor.tsx:94`, which parses the JSON condition tree into
  `{ op: 'AND' | 'OR', parts: string[] }`. `ruleHasConditions` (`:102`) and `parseRuleTree` (`:46`)
  are exported alongside it.
- The presentational wrapper `RuleSummary` (`StrategyWizard.tsx:507-525`) is a **module-local,
  non-exported** function. Reusing it on the detail page means hoisting it to a shared component
  rather than copying it — the DRY guard rail applies (`docs/patterns/dry-guard-rail.md`); a
  duplicated copy would be a jscpd/`dry-reviewer` finding.
- Scope question for design: should the definition card be visible to all readers, or admin-gated
  like the edit form? The page already branches on `useIsAdmin` for its write controls, and the
  definition is read-only information the owner already has via the RPC, so all-readers is the
  expected default — but it should be an explicit decision, not an accident.
- UI/UX governance applies (Constitution **C-17**, `docs/patterns/ui-ux-governance.md`): the new
  card must use design tokens (no hardcoded colors) and the shared Card primitives already imported
  at `page.tsx:6`.

## Related

Surfaced while investigating why `fundamentals_macd_blend` appeared to have no entry/exit rules.
That investigation also produced a separate, unrelated defect on the opportunity-queue path
(feature 168's fundamentals-universe restriction not applied in `_compute_opportunities`), which is
**not** part of this report.
