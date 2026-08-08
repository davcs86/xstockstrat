# Feature: screener-data-readiness-polling

**Lifecycle Status**: `implementation-ready`
**Development Branch**: `feature/screener-data-readiness-polling`
**Created**: 2026-08-08
**Last Updated**: 2026-08-08

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-08 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-08 | `draft` → `design-approved` | /sdd-design | Design debated (1 round, quick) and approved; recon.md + design.md written. Skipped `/sdd-review product-spec` per explicit user direction to proceed (recorded in context.md) — `draft` is the actual prior status, not `spec-ready`. |
| 2026-08-08 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 3 steps (all `xstockstrat-ui`, no other service touched). |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture
- [Implementation Spec](implementation-spec.md) — 3 steps
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

When a Screener criterion (fundamental or technical) can't be evaluated because its underlying
data isn't available yet, automatically re-check in the background and update the existing
pending badges live, so a user watching the page sees results resolve without manually re-running
the scan.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` | Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log) |

`xstockstrat-analysis`'s conditional row (see design.md § Chosen Approach) resolved to **not
needed** — the approved design makes no proto/servicer/engine change; it resends the existing
`ScreenSymbolsRequest` unchanged.

## Next Action

`/sdd-review screener-data-readiness-polling impl-spec` — validate implementation spec, then `/sdd-execute screener-data-readiness-polling`
