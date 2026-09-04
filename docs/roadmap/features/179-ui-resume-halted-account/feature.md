# Feature: ui-resume-halted-account

**Development Branch**: `feature/ui-resume-halted-account`
**Created**: 2026-09-04
**Last Updated**: 2026-09-04

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-04 | `idea` → `draft` | /sdd-story | Product spec generated from performance audit Track D |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec ui-resume-halted-account`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Close the UI-side gap left explicitly out of scope by feature 169: add a browser-side Resume control
(BFF route + button) for a halted account, and surface the halt indicator beside the
account-management controls (not only on the positions page), so an operator can see a halt and clear
it from the UI instead of falling back to the agent or a DBA.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` owner | Trading UI correctness, Connect-RPC call safety, access-scope correctness on a privileged mutation |
| `xstockstrat-trading` owner | Order execution correctness, halt/resume state integrity, scope enforcement on ResumeAccount |
| Security (role) | Access-scope of the Resume mutation (admin vs operator-or-admin), no privilege widening at the BFF edge |

## Next Action

`/sdd-review ui-resume-halted-account product-spec` — AI review of product spec before running /sdd-spec
