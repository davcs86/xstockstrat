# Context: fix-strategy-detail-definition-render  (archived 2026-10-07)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-10-07 — /sdd-archiver

**What**: Track C, SEV-3 UX/observability fix. `/insights/strategies/[id]` already fetched the strategy `definition` via `useGetStrategy` but never rendered components or entry/exit rules, so a user concluded `fundamentals_macd_blend` "has no entry or exit rules" when both were stored and correct. Fix: a read-only Definition card in the left column before the Run Backtest card — no new RPC, hook or network call (product-spec). Launched 2026-09-24 via PR #1169; no trading-correctness impact.
**Why (irrecoverable rationale)**: Visibility is all readers, by explicit operator approval: the definition is read-only information the owner already has via the RPC, and the page already admin-gates only its write controls; the report's expected default was "all readers" and the operator confirmed it. An ungated card could look like a missed gate. The parser/summary logic was extracted to `src/lib/ruleSummary.ts` instead of importing from `RuleEditor.tsx` to keep the read-only page's bundle free of the editor's client-only UI (Combobox/Select); the lib header does not say why.
**Rejected alternatives**: Copy `RuleSummary` into the detail page (jscpd/`dry-reviewer` finding). Import `summarizeRule`/`parseRuleTree` straight from `RuleEditor.tsx` (pulls editor UI into the read-only page). Admin-only visibility — not adopted; no further reason recorded.
**Scars & gotchas**: Local `next dev` flaked with ECONNRESET on cold compile in e2e because the pre-existing analytics test has a hard-coded 5s timeout; verify e2e CI-style against a prod build (3/3 passed). `tsc --noEmit` reports one pre-existing unrelated `middleware.test.ts` mock-typing error.
**Permanent deviations**: None (no design.md/recon.md). `RuleEditor.tsx` re-exports the extracted parsers for back-compat; the only external importer was `StrategyWizard`'s `summarizeRule`.
**Cross-feature signal**: A presentational summary built local to the strategy wizard's review step was later needed by a read-only surface and hoisted to `components/insights/RuleSummary.tsx`.
**Deferred follow-ons**: None filed. The hard-coded 5s analytics e2e timeout is a latent flake source on `next dev`.
**Runtime-invariant recommendations (→ /context-constitution)**: None (the all-readers rule is already in `@AC-2`, promoted to the ui suite).
**Ledger entries written**: insights.md (1), fails.md (0) — see the 2026-10-07 entries.
**Pruned artifacts**: product-spec.md — last present at 9a1d3bea (`git show 9a1d3bea:docs/roadmap/features/195-fix-strategy-detail-definition-render/<file>`).
