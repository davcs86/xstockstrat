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

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
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

`/sdd-design ensure-signals-watchlist-on-read quick` — quick design recommended (single service, no proto/DB/config change; overlaps are rebase-level only)
