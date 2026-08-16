# Feature: fix-fundamentals-upsert-invalid-json

**Type**: bug
**Lifecycle Status**: `in-progress`
**Development Branch**: `claude/commit-135-opportunities-strategies-0xjnxk`
**GitHub Issue**: n/a — GitHub Issues are disabled on `davcs86/xstockstrat`; bug captured directly via `/sdd-triage` (Track C) from `docs/reports/2026-08-16-marketdata-fundamentals-upsert-invalid-json-defect.md`
**Severity**: SEV-3
**Created**: 2026-08-16
**Last Updated**: 2026-08-16

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-16 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report |
| 2026-08-16 | `draft` (unchanged) | /sdd-triage (boot correction) | Corrected **Development Branch** `feature/fix-fundamentals-upsert-invalid-json` → `claude/commit-135-opportunities-strategies-0xjnxk` — session's harness assignment requires all work stay on the `claude/*` branch (same pattern as feature 135's own boot correction) |
| 2026-08-16 | `draft` → `design-approved` | /sdd-design | Design debated (1 round, quick) and approved; recon.md + design.md written. Chosen: `::jsonb` cast fix, gated on a mandatory manual repro (reproduce-then-fix) before merge. |
| 2026-08-16 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 4 steps. |
| 2026-08-16 | `implementation-ready` → `in-progress` | /sdd-execute | Steps 2 (::jsonb cast) and 4 (pgxmock regression test) done, red-before-green confirmed. Steps 1 and 3 (the mandatory live-DB repro) are **blocked** — no Docker daemon in this execute sandbox, and sdd-execute's HARD CONSTRAINTS forbid starting a DB container to verify a step. User chose to apply the code-only steps now and leave the repro as a required follow-up before this fix is considered fully verified — see implementation-spec.md Deviation Log. |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture (::jsonb cast + mandatory repro gate)
- [Implementation Spec](implementation-spec.md) — 4 steps: manual repro (RED) → `::jsonb` fix → manual repro (GREEN) → `pgxmock` regression test
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`MarketDataRepo.UpsertFundamentals` fails for at least one symbol (UPRO, a leveraged ETF) with
Postgres `invalid input syntax for type json (SQLSTATE 22P02)`, so its fundamentals never persist
to cache and are re-fetched from the provider on every request. Root cause is not yet isolated to
a specific field; unrelated to features 131/132/133/134/022/138 (none touch `xstockstrat-marketdata`).

## Reviewers

| Role | Focus |
|---|---|
| Service owner (`xstockstrat-marketdata`) | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency |

## Next Action

**Blocked on Steps 1 & 3**: run the mandatory live-DB repro in an environment with Docker access
(`/sdd-execute fix-fundamentals-upsert-invalid-json 1`, then `... 3`), then re-run
`/sdd-execute fix-fundamentals-upsert-invalid-json` to close out the feature.
