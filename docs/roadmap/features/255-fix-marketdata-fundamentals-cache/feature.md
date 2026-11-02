# Feature: fix-marketdata-fundamentals-cache

**Type**: bug
**Development Branch**: `feature/fix-marketdata-fundamentals-cache`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-marketdata-fundamentals-cache-defect.md`
**Severity**: SEV-3
**Created**: 2026-10-21
**Last Updated**: 2026-11-01

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-marketdata-fundamentals-cache-defect.md` (debt-radar D-19, D-50, D-51, D-52, D-53) |
| 2026-10-22 | `draft` → `spec-ready` | /sdd-review | Product spec approved (6 warnings); OQ-1 resolved by operator: cap `<= 0` = zero budget |
| 2026-10-22 | `spec-ready` → `design-approved` | /sdd-design | Design debated (4 rounds, full) and approved; recon.md + design.md written |
| 2026-10-22 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 17 steps; AC-5/AC-6 refined, @AC-10 added, FR-4(b) rewritten per operator r3/r4 sign-off |
| 2026-11-01 | `implementation-ready` (re-spec) | /sdd-execute | Merged `origin/main-dev`; steps 0–17 re-anchored to the current codebase (Step 11 now wraps both `getJSON` transport returns; Step 13 reflects existing `WarnContext`) |
| 2026-11-01 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential mode (sdd-batch-execute); operator gave the up-front confirmation |
| 2026-11-01 | `in-progress` → `code-completed` | /sdd-execute | Steps 1–17 done; AC-1..AC-10 promoted to `services/xstockstrat-marketdata/acceptance/fix-marketdata-fundamentals-cache.feature` (C-16); integration PR opened (merge-order 215 gate waived by operator override, see context.md) |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md`, taken by `/sdd-spec` on 2026-10-22.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-marketdata` owner | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency | 2–16 (`service`/`test`) |
| `xstockstrat-agent` owner | MCP tool contract stability (name, parameters, return shape) | 17 (read-only verification) |
| `xstockstrat-ui` owner | Analytics display accuracy, Connect-RPC call safety | 17 (read-only verification) |
| none | `docs` step | 1 |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — approved design: chosen approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — 17 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Five marketdata defects in the fundamentals path:

- Comments document `daily_request_cap <= 0` as uncapped, contradicting the enforced zero budget (D-50).
- Quota counts include edgar and inactive-vendor rows (D-51).
- The vendor cache serves edgar rows (D-52).
- `extra` decode and FMP enrichment errors are dropped silently (D-53).
- The Alpaca stream reconnect budget never resets and gives up silently (D-19).

## Next Action

Integration PR `feature/fix-marketdata-fundamentals-cache` → `main-dev` is open; merge when CI passes and reviewers approve.
