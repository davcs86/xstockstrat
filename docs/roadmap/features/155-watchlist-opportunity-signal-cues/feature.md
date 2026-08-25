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

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase map (Phase 0)
- [Design](design.md) — debated, approved architecture (Phase 1)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec <slug>`_
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

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` (service owner) | Trading/analytics UI correctness, Connect-RPC call safety, no direct DB access, nav/breadcrumb reachability |

## Next Action

`/sdd-spec watchlist-opportunity-signal-cues` — generate implementation spec from the approved design
