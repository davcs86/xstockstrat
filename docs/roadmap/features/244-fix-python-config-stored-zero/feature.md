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
| 2026-10-28 | `in-progress` (step 1 done) | /sdd-execute sequential | Step 1: ingest `get_str`/`get_int`/`get_float` use `HasField`; `get_int_present = get_int` alias (TDD red → green) |
| 2026-10-28 | `in-progress` (step 2 done) | /sdd-execute sequential | Step 2: conftest `snapshot_watcher` (C-13 home); ingest @AC-1/@AC-4 getter rows in `test_config_watcher.py` (TDD red → green) |
| 2026-10-28 | `in-progress` (step 3 done) | /sdd-execute sequential | Step 3: module-level `int_positive` clamps the four FR-3 backfill properties and both `mcp_client` loop reads (`max(…, 1)` dropped); dead `sandbox_*` helpers and their 3 tests removed (TDD red → green) |
| 2026-10-28 | `in-progress` (step 4 done) | /sdd-execute sequential | Step 4: ingest @AC-5 (`_backfill_sem` at 0 → 3) and @AC-6 rows (backfill properties, loop timeout/poll interval) plus the AST read-classification guard `tests/test_config_read_classification.py` (TDD red → green) |
| 2026-10-28 | `in-progress` (step 5 done) | /sdd-execute sequential | Step 5: indicators `get_str`/`get_int`/`get_float` use `HasField`; `get_str_present = get_str` alias (TDD red → green) |
| 2026-10-28 | `in-progress` (step 6 done) | /sdd-execute sequential | Step 6: indicators conftest `snapshot_watcher` (C-13 home), `_str_watcher` delegates to it; @AC-1/@AC-4 getter rows in `test_config_watcher.py` (TDD red → green) |
| 2026-10-28 | `in-progress` (step 7 done) | /sdd-execute sequential | Step 7: indicators module-level `int_positive` clamps `sandbox_timeout_ms` / `sandbox_memory_bytes` / `sandbox_max_concurrent()`; `servicer.py` semaphore `max(1, …)` dropped (TDD red → green) |
| 2026-10-28 | `in-progress` (step 8 done) | /sdd-execute sequential | Step 8: indicators @AC-6 accessor rows (0 / -1 → defaults), servicer rows (semaphore `_value == 4`; sandbox receives `max_concurrent` 4, `timeout_ms` 5000, `memory_bytes` 134217728) and the AST read-classification guard `tests/test_config_read_classification.py` (TDD red → green) |
| 2026-10-28 | `in-progress` (step 9 done) | /sdd-execute sequential | Step 9: analysis `get_str`/`get_int`/`get_float` use `HasField`; `get_int_present = get_int` and `get_float_present = get_float` aliases (TDD red → green) |
| 2026-10-28 | `in-progress` (step 10 done) | /sdd-execute sequential | Step 10: analysis conftest `snapshot_watcher`; @AC-1/@AC-4 getter rows, the `:594` contrast flipped to `0.0`; @AC-2 commission/slippage seam + zero-cost fill; @AC-3 rank-weight seam + real-SQL sort-0 order; @AC-9 throttle seam + alert at throttle 0; @AC-12 screener rank cap and patterns `min_sample` (TDD red → green) |
| 2026-10-28 | `in-progress` (step 11 done) | /sdd-execute sequential | Step 11: analysis module-level `int_positive` / `float_positive` / `str_nonempty`; all 34 FR-3 sites clamped; named readers `default_cooldown_days` (servicer) and `fundsignal_source_slug` (fundsignal_loop); read-site `max(1, …)` wrappers and the two inline `<= 0` clamps removed; dead `sandbox_*` helpers and their 3 tests deleted (TDD red → green) |

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

`/sdd-execute fix-python-config-stored-zero sequential` — Step 12 (test: analysis @AC-6 / @AC-7, the guard, and the retention flip)
