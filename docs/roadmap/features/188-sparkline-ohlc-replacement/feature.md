# Feature: sparkline-ohlc-replacement

**Development Branch**: `feature/sparkline-ohlc-replacement`
**Created**: 2026-09-11
**Last Updated**: 2026-09-26
**Committed to main**: `aab3fa8d` (promotion PR #1137)
**Launched date**: 2026-09-11
**Archived**: 2026-10-07

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-11 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-09-11 | `draft` → `design-approved` | /sdd-design | Design debated (2 rounds, quick) and approved; recon.md + design.md written |
| 2026-09-11 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated (8 steps, UI-only) |
| 2026-09-11 | `implementation-ready` → `launched` | /sdd-execute (#1136) | All 8 steps implemented and merged to main-dev via #1136, promoted to main via #1137. **Status not advanced at the time** — reconciled 2026-09-26. |
| 2026-09-26 | `implementation-ready` → `launched` | drift reconciliation | Bookkeeping catch-up: code shipped 2026-09-11 (OhlcBlock, useOhlcBars, selectOhlcBar, Sparkline.tsx deleted, mobile OHLC parity, E2E) but status.md/impl-spec were never advanced. Verified present in origin/main. |
| 2026-10-07 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(2)/fails(2); pruned 4 spec(s); acceptance scenarios promoted to per-service suites (C-16) |

---

## Artifacts

- Product Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15); promoted to services/xstockstrat-ui/acceptance/sparkline-ohlc-replacement.feature (@AC-2/5/6); @AC-1/3/4 withheld pending retirement of 095 @AC-3/@AC-4 — see context.md (C-16)
- Recon Dossier — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Design — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Implementation Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
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
