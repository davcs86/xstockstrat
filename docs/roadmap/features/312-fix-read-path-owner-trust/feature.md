# Feature: fix-read-path-owner-trust

**Type**: bug
**Development Branch**: `feature/fix-read-path-owner-trust`
**GitHub Issue**: none (Issues disabled) — reports: `docs/reports/2026-10-19-trading-listorders-body-user-id-filter-defect.md`, `docs/reports/2026-10-19-portfolio-default-identity-fallback-defect.md`, `docs/reports/2026-10-19-notify-listalerts-owner-fallback-unscoped-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-10
**Last Updated**: 2026-11-27

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 3 defect report(s) (clustered triage) |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (4 warnings) |
| 2026-11-20 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-20 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 20 steps |
| 2026-11-26 | `implementation-ready` → `in-progress` | /sdd-execute | → in-progress (sdd-batch-execute setup); main-dev `f802b184` merged, steps 1,3,4,5,6,7,8,10,11,12,13,15,16,17,18,19 re-specced (`9f69d778`) |
| 2026-11-27 | `in-progress` → `code-completed` | /sdd-execute | All 20 steps done (sequential, sdd-batch-execute); Step 20 O-11 count recorded (DO staging 1, homelab staging 0, production waived) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — settled decisions, rejected alternatives, objections
- [Design](design.md) — approved approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

_(Snapshot from docs/runbooks/reviewer-registry.md, finalized at /sdd-spec time — re-run /sdd-spec
if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-trading` owner | Order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement |
| `xstockstrat-portfolio` owner | P&L calculation accuracy, position snapshot consistency, concurrent write safety |
| `xstockstrat-notify` owner | Stream delivery guarantees, backpressure handling, alert deduplication |
| Proto Reviewer | Field number uniqueness per message, no breaking changes without deprecation comment, `buf lint` passes, `buf breaking` passes against dev trunk |

---

## Summary

Read and consume paths take ownership from somewhere other than the trusted `x-user-id` header (PLAT-11):
trading `ListOrders`/`StreamOrderUpdates` and notify `ListAlerts` trust a body user id (empty = all users),
and portfolio files identity-less events under placeholder owners that trading's `RegisterBrokerAccount`
can produce.

## Next Action

`/sdd-review fix-read-path-owner-trust impl-spec` — validate implementation spec, then `/sdd-execute fix-read-path-owner-trust`
