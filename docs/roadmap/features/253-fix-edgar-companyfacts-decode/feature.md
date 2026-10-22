# Feature: fix-edgar-companyfacts-decode

**Type**: bug
**Development Branch**: `feature/fix-edgar-companyfacts-decode`
**GitHub Issue**: none (Issues disabled) — defect report `docs/reports/2026-10-21-edgar-companyfacts-string-cik-defect.md`
**Severity**: SEV-3
**Created**: 2026-10-21
**Last Updated**: 2026-10-21

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report `docs/reports/2026-10-21-edgar-companyfacts-string-cik-defect.md` |
| 2026-10-21 | `draft` → `implementation-ready` | /sdd-spec | Implementation spec generated with 2 steps (design skipped per triage; `/sdd-review product-spec` not run) |
| 2026-10-21 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential mode; test-first (Step 2 RED) then Step 1 |
| 2026-10-21 | `in-progress` → `code-completed` | /sdd-execute | Both steps done; integration PR #1274 → `main-dev` |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

| Reviewer | Focus | Steps |
|---|---|---|
| xstockstrat-marketdata service owner | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency | 1 (service), 2 (test) |

---

## Summary

The EDGAR companyfacts decode fails for filers whose `cik` SEC serves as a zero-padded string (CRCL, ELWT, PSKY,
RDDT), so their fundamentals history is never stored and every snapshot read falls back to the vendor.

## Next Action

Merge PR #1274; after the dev deploy, re-run the fundamentals backfill for CRCL, ELWT, PSKY, RDDT (and AARD).
