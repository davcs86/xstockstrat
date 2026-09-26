# Feature: sparkline-ohlc-replacement

**Development Branch**: `feature/sparkline-ohlc-replacement`
**Created**: 2026-09-11
**Last Updated**: 2026-09-26
**Committed to main**: `aab3fa8d` (promotion PR #1137)
**Launched date**: 2026-09-11

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-11 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-09-11 | `draft` → `design-approved` | /sdd-design | Design debated (2 rounds, quick) and approved; recon.md + design.md written |
| 2026-09-11 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated (8 steps, UI-only) |
| 2026-09-11 | `implementation-ready` → `launched` | /sdd-execute (#1136) | All 8 steps implemented and merged to main-dev via #1136, promoted to main via #1137. **Status not advanced at the time** — reconciled 2026-09-26. |
| 2026-09-26 | `implementation-ready` → `launched` | drift reconciliation | Bookkeeping catch-up: code shipped 2026-09-11 (OhlcBlock, useOhlcBars, selectOhlcBar, Sparkline.tsx deleted, mobile OHLC parity, E2E) but status.md/impl-spec were never advanced. Verified present in origin/main. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — codebase map, patterns, business rules
- [Design](design.md) — debated architecture (2 rounds, quick)
- [Implementation Spec](implementation-spec.md) — 8 steps, UI-only (xstockstrat-ui)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Replace the sparkline bar chart on the Opportunities List page and the Single Opportunity (symbol detail) page with the previous trading day's OHLC price data rendered as text next to the date.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` service owner | Trading UI correctness, analytics display accuracy, Connect-RPC call safety, no secret values rendered in UI, no direct DB access (except audit log) |

## Next Action

None — feature is `launched` (live in production since 2026-09-11).
