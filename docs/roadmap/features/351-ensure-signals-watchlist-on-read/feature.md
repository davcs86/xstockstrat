# Feature: ensure-signals-watchlist-on-read

**Development Branch**: `feature/ensure-signals-watchlist-on-read`
**Created**: 2026-11-16
**Last Updated**: 2026-11-16

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-16 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-11-16 | `draft` → `spec-ready` | /sdd-review | Product spec approved after 2 rounds (round 1 FAIL: unresolved Open Questions; round 2 PASS WITH WARNINGS, all fixed; 2 author assumptions carried to the design gate) |
| 2026-11-16 | `spec-ready` → `design-approved` | /sdd-design | Design debated (4 rounds, full; escalated from quick at the post-Recon gate) and approved; recon.md + debate.md + design.md written; token bug split to separate defect sessions, cap accepted at 49, fail-open confirmed |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon](recon.md) — grounded codebase dossier + existing business rules (C-16)
- [Debate Register](debate.md) — settled decisions D-1..D-12, locked rejections R-1..R-6, objections O-1..O-24
- [Design](design.md) — approved architecture, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec ensure-signals-watchlist-on-read`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The per-user system-managed "Signals" watchlist (feature 127) exists only after an agent `ingest_signal(direction="watchlist")` side effect, so users who never ingested one (Homelab staging) have none. `ListWatchlists` will idempotently ensure the caller's system list so every user sees it.

## Reviewers

| Role | Review Focus |
|---|---|
| Service owner — `xstockstrat-portfolio` | P&L calculation accuracy, position snapshot consistency, concurrent write safety |

## Next Action

`/sdd-spec ensure-signals-watchlist-on-read` — generate implementation spec from the approved design. Note: the final integration PR waits for the `ListByUser` token fix (D-10/D-11; verified step 4).
