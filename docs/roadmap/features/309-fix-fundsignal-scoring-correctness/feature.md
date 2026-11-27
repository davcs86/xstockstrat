# Feature: fix-fundsignal-scoring-correctness

**Type**: bug
**Development Branch**: `feature/fix-fundsignal-scoring-correctness`
**GitHub Issue**: none (Issues disabled) — reports: `docs/reports/2026-10-21-analysis-fundsignal-formula-partial-row-wire-zero-defect.md`, `docs/reports/2026-10-21-analysis-fundsignal-small-cross-section-quantile-defect.md`, `docs/reports/2026-10-21-analysis-zero-conviction-read-as-neutral-defect.md`, `docs/reports/2026-10-21-ingest-fundsignal-fabricated-signals-not-retracted-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-10
**Last Updated**: 2026-11-27

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from 4 defect report(s) (clustered triage) |
| 2026-11-10 | `draft` → `spec-ready` | /sdd-review | Product spec approved (7 warnings) |
| 2026-11-20 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-20 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 18 steps |
| 2026-11-26 | `implementation-ready` → `in-progress` | /sdd-execute | → in-progress (sdd-batch-execute setup) |
| 2026-11-27 | `in-progress` (unchanged) | /sdd-spec re-spec | Steps 16-18 (ingest `019` retraction migration, fixture, cross-schema docs) dropped by operator ruling: the frozen retraction list is empty; spec now 15 steps, `@AC-4` closed by recorded zero-row evidence |
| 2026-11-27 | `in-progress` → `code-completed` | /sdd-execute | All 15 steps done; @AC-1..@AC-3 and @AC-5 promoted to the durable analysis/ingest suites (C-16); @AC-4 not promoted (operator ruling, zero-row evidence) |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — settled decisions, rejected alternatives, objections
- [Design](design.md) — approved approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The fundamentals signal producer and its consumers mis-score signals: absent metrics score as wire zeros
on the formula path, a lone scored symbol is always `buy`, an explicit conviction 0.0 is read back as 0.5,
and fabricated 0.5 signals stored before feature 246 stay active.

## Reviewers

_(Snapshot from docs/runbooks/reviewer-registry.md, finalized at /sdd-spec time 2026-11-20 —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness per message, no breaking changes, `buf lint` and `buf breaking` pass |
| `packages/proto` owner | Field number uniqueness, backward compatibility, naming conventions |
| DBA | Migration NNN numbering, up+down pair present, run-order compliance with `scripts/db-migrate.sh` |
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| `xstockstrat-ingest` owner | Signal normalization correctness, idempotent ingestion, newsletter source schema stability |
| `xstockstrat-indicators` owner | Numeric precision, no side-effects from formula execution |
| `xstockstrat-agent` owner | MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity |
| `xstockstrat-marketdata` owner | _No longer applies: ingest `019` (the migration-time read of `marketdata.fundamentals`, design D-12) was dropped on 2026-11-27 — see implementation-spec.md § Dropped Steps_ |

## Next Action

`/sdd-review fix-fundsignal-scoring-correctness impl-spec` — validate implementation spec, then `/sdd-execute fix-fundsignal-scoring-correctness`
