# Feature: ui-resume-halted-account

**Development Branch**: `feature/ui-resume-halted-account`
**Created**: 2026-09-04
**Last Updated**: 2026-09-05

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-04 | `idea` → `draft` | /sdd-story | Product spec generated from performance audit Track D |
| 2026-09-04 | `draft` → `spec-ready` | /sdd-review | FAILED first pass (criterion 9, scope contradiction); resolved all Open Questions (admin-only scope, conservative), re-review PASS; overlap CLEAN |
| 2026-09-05 | `spec-ready` → `design-approved` | /sdd-design | Design debated (4 rounds, extended); round-4 adversary SOUND; recon.md + design.md written |
| 2026-09-05 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 8 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase map, Patterns to REUSE, Existing Business Rules
- [Design](design.md) — chosen approach, rejected alternatives, open risks, Constitution rules
- [Implementation Spec](implementation-spec.md) — 8 numbered steps with codebase evidence
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
| `xstockstrat-ui` owner | Trading UI correctness, Connect-RPC call safety, UI/UX consistency (C-17), test-data inventory (C-12) — all 8 steps modify `xstockstrat-ui` only |
| Security (role) | Auth scope on the privileged Resume mutation (Steps 3, 5, 8): admin-gated at the BFF (`forwardAdmin`) with no scope widening at the edge; enforcement is the pre-existing admin-only RPC |

_(No `xstockstrat-trading` reviewer — the `ResumeAccount` RPC is consumed unchanged; no backend/proto
change in this feature.)_

## Next Action

`/sdd-review ui-resume-halted-account impl-spec` — validate the implementation spec, then
`/sdd-execute ui-resume-halted-account`
