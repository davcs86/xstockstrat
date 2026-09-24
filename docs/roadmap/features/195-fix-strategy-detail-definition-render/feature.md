# Feature: fix-strategy-detail-definition-render

**Type**: bug
**Development Branch**: `claude/todays-bug-triage-ubv9ag` (harness-assigned; PR targets `main-dev`)
**Defect Report**: `docs/reports/2026-09-18-strategy-detail-definition-not-rendered-defect.md` (GitHub Issues disabled — report is the audit trail)
**Severity**: SEV-3
**Created**: 2026-09-19
**Last Updated**: 2026-09-19

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-19 | `bug-reported` → `draft` | triage (manual, from-report) | UX/observability gap; Track C. |
| 2026-09-19 | `draft` → `code-completed` | bug-fix session | Definition card added (all readers, operator-approved); RuleSummary hoisted (DRY); unit + e2e tests; lint/tsc clean. Shipped in the consolidated today's-triage PR. |

---

## Artifacts

- [Product Spec](product-spec.md) — points at the defect report
- [Acceptance Scenarios](acceptance.feature) — the detail page renders the definition
- [Context Log](context.md) — the all-readers decision + the DRY hoist factoring

---

## Summary

`/insights/strategies/[id]` fetched the strategy definition (`useGetStrategy`) but never rendered it:
no components, no `entry_rule`, no `exit_rule` anywhere on the page — so a user could conclude a
strategy "has no entry or exit rules" when both are stored and correct. Read-surface / observability
gap; no correctness or trading-safety risk.

## Fix

Added a read-only **Definition** card (components + entry/exit rules + cooldowns + deny list),
visible to all readers (definition is read-only info the owner already has via the RPC; the page only
admin-gates write controls). No new RPC/hook/network call — renders fields already in component
state. The wizard's module-local `RuleSummary` was hoisted to a shared component and the pure rule
parsers extracted to `src/lib/ruleSummary.ts` (DRY guard rail — no copy) so the read-only page does
not bundle the full editor.

## Next Action

Ships in the consolidated today's-triage PR to `main-dev`. Promote via the next `/promote` cycle.
