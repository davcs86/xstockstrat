# Product Spec: fix-strategy-detail-definition-render

**Type**: bug (Track C) · **Severity**: SEV-3 · **Config-only**: no

## Source

`docs/reports/2026-09-18-strategy-detail-definition-not-rendered-defect.md` — the report proves the
data is already fetched (`page.tsx` `useGetStrategy`) then never read for components/entryRule/
exitRule. That report is the authoritative analysis; this is the Track C wrapper.

## Problem

`/insights/strategies/[id]` renders six cards but none shows the strategy's definition. A user
investigating `fundamentals_macd_blend` concluded it "has no entry or exit rules" when both are
stored and correct. Observability cost only — the engine evaluates the stored rules correctly.

## Affected service(s)

- `xstockstrat-ui` (`/insights` segment) only.

## Chosen approach

- Add a read-only **Definition** card to the detail page — components (ref name, indicator/formula,
  params, source symbol), entry rule, exit rule, cooldowns, and deny list — rendering fields already
  in `useGetStrategy` state (no new RPC/hook/network).
- **Visibility: all readers** (operator-approved). Definition is read-only information the owner
  already has via the RPC; the page only admin-gates write controls.
- **DRY**: the wizard's module-local `RuleSummary` is hoisted to a shared
  `components/insights/RuleSummary.tsx`, and the pure parsers (`parseRuleTree`/`summarizeRule`/
  `ruleHasConditions`) are extracted to `src/lib/ruleSummary.ts` (RuleEditor re-exports for
  back-compat) so the read-only page does not bundle the editor's client-only UI. Avoids a
  jscpd/`dry-reviewer` finding.
- **UI/UX governance (C-17)**: design tokens only (no hardcoded colors), shared Card primitives.

## Governance gates

- Proto: none. Config: none. DB: none. Reviewer: xstockstrat-ui owner.

## Acceptance

See `acceptance.feature` — the detail page renders the definition (components + rules) for any reader.
