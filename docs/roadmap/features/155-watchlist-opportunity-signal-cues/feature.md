# Feature: watchlist-opportunity-signal-cues

**Development Branch**: `feature/watchlist-opportunity-signal-cues`
**Created**: 2026-08-25
**Last Updated**: 2026-08-25

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-25 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-25 | `draft` → `design-approved` | /sdd-design | Design debated (2 rounds, quick + 1 user round) and approved; recon.md + design.md written |
| 2026-08-25 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 12 steps |
| 2026-08-25 | `implementation-ready` → `in-progress` | /sdd-execute | Step 1 (shared cue spine) started |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase map (Phase 0)
- [Design](design.md) — debated, approved architecture (Phase 1)
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Make firing/ready and in-queue states visually distinguishable with consistent color + icon coding
across the Watchlists readiness panel and Opportunities cards/mobile view, add a "firing"-row jump to
the symbol's order/position page, and fix three UX defects (Opportunities-origin breadcrumb, mobile
Opportunities grouping/tags, and stale filter tags).

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

Snapshot from `docs/runbooks/reviewer-registry.md` (§ Step Category → Reviewer Roles). All 12 steps
are `service`/`test` on `xstockstrat-ui` → the sole reviewer is the service owner.

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` (service owner) | Trading UI correctness, analytics display accuracy, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log) |

## Next Action

`/sdd-review watchlist-opportunity-signal-cues impl-spec` — validate implementation spec, then `/sdd-execute watchlist-opportunity-signal-cues`
