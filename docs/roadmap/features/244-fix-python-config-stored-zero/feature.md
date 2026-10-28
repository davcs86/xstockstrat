# Feature: fix-python-config-stored-zero

**Type**: bug
**Development Branch**: `feature/fix-python-config-stored-zero`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-19-python-config-zero-trap-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20
**Last Updated**: 2026-10-28

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-20 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-19-python-config-zero-trap-defect.md` |
| 2026-10-20 | `draft` → `spec-ready` | /sdd-review | Product spec approved (8 warnings, 2 notes; overlap WARN) |
| 2026-10-20 | `spec-ready` (re-review) | /sdd-review | Product spec re-reviewed and approved (6 warnings; overlap WARN) |
| 2026-10-21 | `spec-ready` (amended) | /sdd-design | product-spec.md FR-3 amended per design: read-site `max(1, …)` guards subsumed by the `>0` clamp; negatives resolve to the default; present-aware `retry_seconds` guards stay |
| 2026-10-21 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved under operator standing authorization; recon.md + design.md written |
| 2026-10-21 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 18 steps; acceptance.feature extended (20 @AC-6 rows, @AC-10..@AC-12) |
| 2026-10-28 | `implementation-ready` (re-spec) | /sdd-execute sequential | Merged origin/main-dev (`-X ours`); re-specced Steps 7, 8, 10, 12, 14, 15, 17 (evidence and Instructions/Verification) to the current codebase — indicators servicer line drift and `_clamp_override`, ci.yml real_pg step, `_sched_loop` line, 029 line, CLAUDE.md/governance grep lines, config Node/pnpm tooling note |
| 2026-10-28 | `implementation-ready` → `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Up-front plan confirmed by operator standing authorization (operator chat 2026-10-28, session_01NpS3HShZK6pSnogA7CFo2f: 'Start executing features 241-276'; unattended checkpoints = report; C-16 promotion auto-confirmed unless it changes an existing @AC rule) |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-spec time (2026-10-21), deduplicated from the per-step `**Reviewers**` lines.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-ingest` owner | Signal normalization correctness, idempotent ingestion, newsletter source schema stability | 1-4 |
| `xstockstrat-indicators` owner | Formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution | 5-8 |
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias | 9-12 |
| `xstockstrat-config` owner | Config key naming (`<service>.<category>.<key>`), environment (`production`/`staging`) / global-per-user scoping, secret encryption + redaction, WatchConfig stream stability | 13-16 |
| DBA | Migration NNN numbering (no gaps, no conflicts), up+down pair present, hypertable partitioning strategy, index correctness, run-order compliance with `scripts/db-migrate.sh` | 15 |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (call-site classification, reuse patterns, business rules)
- [Design](design.md) — approved design: chosen approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The Python `ConfigWatcher.get_int` / `get_str` / `get_float` return `v.<x>_val or default` in analysis, indicators
and ingest, so an operator-stored `0`, `0.0` or `""` resolves to the coded default (e.g. a zero-commission backtest
or a zero signal-rank weight cannot be configured).

## Next Action

`/sdd-execute fix-python-config-stored-zero sequential` — Step 1 (ingest getters honour a stored zero)
