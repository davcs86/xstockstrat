# Feature: fix-vendor-key-in-url

**Type**: bug
**Development Branch**: `feature/fix-vendor-key-in-url`
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-29-marketdata-vendor-key-url-residuals-defect.md
**Severity**: SEV-2
**Created**: 2026-11-10
**Last Updated**: 2026-11-13

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 1 defect report(s) (clustered triage) |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 warnings) |
| 2026-11-13 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-13 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 6 steps (Step 1 operator gate; U1 = Steps 2-5; Step 6 docs) |
| 2026-11-13 | `implementation-ready` → `in-progress` | /sdd-execute | → in-progress (sdd-batch-execute setup); main-dev `d5de836b` merged, steps 2,4,5,6 re-spec'd (conditional) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Debate Register](debate.md) — settled decisions, rejected alternatives, objections
- [Design](design.md) — approved approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — 6 numbered steps; one atomic unit (U1, Steps 2-5)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The FMP (`apikey=`) and Finnhub (`token=`) API keys still travel in the request query string, so they can
leak through a redirect `Location`-parse error and are recorded in any URL-logging access log on the path.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Service owner `xstockstrat-marketdata` | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency |
| Security | API keys and secrets: vendor keys resolved only via `GetSecret`, never stored, logged or placed in a URL |

## Next Action

`/sdd-review fix-vendor-key-in-url impl-spec` — validate implementation spec, then `/sdd-execute fix-vendor-key-in-url` (Step 1 is the operator's pre-merge vendor header proof)
