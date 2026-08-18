# Feature: exactly-once-order-intent

**Committed to main**: 856ad5a3a2ebc431c108cc7f508deb26885545c6
**Launched date**: 2026-08-07
**Priority**: `P1` — rescoped 2026-08-04 to the trader UI's real order flow, not hypothetical
scheduler/agent callers (see context.md); not `P0` because the risk today is bounded by a human
watching the UI, unlike an unattended caller
**Development Branch**: `feature/exactly-once-order-intent`
**Created**: 2026-08-04
**Last Updated**: 2026-08-07
**Archived**: 2026-08-16

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-04 | `idea` → `draft` | /sdd-story | Product spec generated from external live-capital-safety risk review |
| 2026-08-04 | `draft` (rescoped) | feasibility re-check | Scope cut to the trader UI's real place/replace/cancel flow; `close`/`emergency-flatten` and automated `UNKNOWN` reconciliation deferred; see context.md |
| 2026-08-05 | `draft` → `spec-ready` | /sdd-review | Product spec approved after 3 review rounds (2 warnings) |
| 2026-08-06 | `spec-ready` → `design-approved` | /sdd-design | Design debated (7 rounds, full — user-extended past the default 5-round cap) and approved; recon.md + design.md written |
| 2026-08-06 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 20 steps |
| 2026-08-07 | `implementation-ready` → `in-progress` | /sdd-execute (sequential) | Steps 1-2 done — proto `IntentState` enum + `Order.intent_state` field, stubs regenerated |
| 2026-08-07 | `in-progress` → `code-completed` | /sdd-execute (sequential) | All 20 steps done. Stacked-branch build (per user directive) on top of `feature/account-trading-halt-and-kill-switch` (feature 100) — integration PR #880 targets that branch, not `main-dev` |

| 2026-08-07 | `code-completed` → `launched` | CI workflow | Promoted via PR #878; committed 856ad5a3a2ebc431c108cc7f508deb26885545c6 |
| 2026-08-16 | launched (unchanged) | /sdd-archiver | Archived: synthesis written to context.md + Ledger, specs pruned. |
---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture
- [Implementation Spec](implementation-spec.md) — 20 steps
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Introduces a durable order-intent record in `xstockstrat-trading` (platform-generated intent ID, deterministic broker client-order ID, request hash, lifecycle state, retry/uncertainty tracking) so the trader UI's place/replace/cancel calls — the only order flow that exists today — execute at most once despite network retries, timeouts, or a service restart on this single-instance, no-HA deployment.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-trading` owner | Order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement |
| `xstockstrat-ui` owner | Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log) |
| Proto Reviewer | Field number uniqueness per message, no breaking changes without deprecation comment, `buf lint` passes, `buf breaking` passes against dev trunk |
| DBA | Migration NNN numbering (no gaps, no conflicts), up+down pair present, hypertable partitioning strategy, index correctness, run-order compliance with `scripts/db-migrate.sh` |
| QA advisory (`.claude/agents/qa-tester.md`) | Test-data inventory stewardship (C-12/C-13) on the e2e fixture step |

## Next Action

[PR #880](https://github.com/davcs86/xstockstrat/pull/880) is open against
`feature/account-trading-halt-and-kill-switch` (stacked-branch strategy) — drive to green.
Then proceed to feature 023 (position-sizing-engine).
