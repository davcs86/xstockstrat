# Feature: fix-historical-fundamentals-price-join

**Type**: bug
**Development Branch**: `feature/fix-historical-fundamentals-price-join`
**Defect Report**: `docs/reports/2026-09-27-fundamentals-backfill-not-rederived-defect.md` (GitHub Issues disabled on this repo — recorded as a report by `/sdd-qa defect`)
**Severity**: SEV-3
**Created**: 2026-09-27
**Last Updated**: 2026-09-27
**Committed to main**: 27f3f276b39fa79d07b4de6c023582f72539aac3
**Launched date**: 2026-10-01

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-27 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report `docs/reports/2026-09-27-fundamentals-backfill-not-rederived-defect.md` |
| 2026-09-27 | `draft` → `spec-ready` | /sdd-review | Product spec approved (1 advisory warning; criterion-9 blocker fixed, C-16 + two-lane warnings folded into Design constraints) |
| 2026-09-27 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full/deep) and approved; recon.md + design.md written. User signed off on the C-16 CHANGE (overwrite=true may overwrite the 5 derived price columns) |
| 2026-09-27 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 4 steps (marketdata-only: repo reader/writer + source type, service recovery loop, two paired tests) |

| 2026-10-01 | `code-completed` → `launched` | CI workflow | Promoted via PR #1205; committed 27f3f276b39fa79d07b4de6c023582f72539aac3 |
---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-1`…`@AC-5`, C-15)
- [Recon Dossier](recon.md) — grounded codebase map, patterns to reuse, existing business rules, risks
- [Design](design.md) — chosen approach, rejected alternatives, open risks, C-16 classification (5-round debate)
- [Implementation Spec](implementation-spec.md) — 4 steps, marketdata-only write-path recovery
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

Canonical snapshot from `/sdd-spec` (source: `docs/runbooks/reviewer-registry.md`). Deduplicated
across all 4 steps.

| Reviewer | Scope | Focus |
|---|---|---|
| `xstockstrat-marketdata` (service owner) | All `service` + `test` steps (1–4) | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency |

No DBA (no migration), Proto Reviewer (no `.proto` change), or Security (no secret/auth change) step.

---

## Summary

Backfilling a symbol's point-in-time fundamentals before its daily OHLCV bars exist leaves every
price-derived metric (`price`, `market_cap`, `pe_ratio`, `pb_ratio`, `dividend_yield`) permanently
`missing`, because the historical-fundamentals write is insert-only (`ON CONFLICT DO NOTHING`) and the
price-join is a one-shot at insert time — so a re-backfill (even `overwrite=true`) never re-derives it.

## Next Action

`/sdd-review fix-historical-fundamentals-price-join impl-spec` — validate the implementation spec, then `/sdd-execute fix-historical-fundamentals-price-join`
