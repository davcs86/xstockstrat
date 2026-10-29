# Feature: fix-python-loop-supervision

**Type**: bug
**Development Branch**: `feature/fix-python-loop-supervision`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-python-loop-supervision-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-29

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-python-loop-supervision-defect.md` (debt-radar D-07, D-08, D-56) |
| 2026-10-21 | `draft` → `spec-ready` | /sdd-review | Product spec approved (6 warnings; 4 resolved in spec) |
| 2026-10-22 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + design.md written |
| 2026-10-22 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 15 steps |
| 2026-10-28 | `implementation-ready` (no change) | /sdd-execute | Re-spec after merging main-dev: steps 4, 15 re-anchored (line drift only; merge-order 262-row :83 reference to 259 noted) |
| 2026-10-28 | `implementation-ready` → `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Up-front plan confirmed by operator standing authorization (session_01NpS3HShZK6pSnogA7CFo2f) |
| 2026-10-28 | `in-progress` (no change) | /sdd-execute sequential | Step 1 done — `app/supervision.py` + eight `main.py` boot tasks routed through `spawn` |
| 2026-10-28 | `in-progress` (no change) | /sdd-execute sequential | Step 2 done — `tests/test_supervision.py` (@AC-4 supervision helper + boot-retention guard) |
| 2026-10-28 | `in-progress` (no change) | /sdd-execute sequential | Step 3 done — fundsignal + three servicer `*_forever` loops seed via `retry_until_ok` and tick via `run_supervised` |
| 2026-10-29 | `in-progress` (no change) | /sdd-execute sequential (sdd-batch-execute) | Re-spec after merging main-dev: steps 4, 6, 15 re-anchored (fundsignal_loop.py +1 drift and post-Step-3 `run_supervised` evidence; test_config_watcher.py tests :14-38; CLAUDE.md P&L section :143-177) |
| 2026-10-29 | `in-progress` (no change) | /sdd-execute sequential (sdd-batch-execute) | Step 4 done — @AC-1/@AC-2 fundsignal survival tests, `tests/test_loop_supervision.py` (@AC-3, three servicer loops + fundsignal seed), `_StopLoop` now a `BaseException` |
| 2026-10-29 | `in-progress` (no change) | /sdd-execute sequential (sdd-batch-execute) | Step 5 done — analysis `ConfigWatcher._watch` reconnects after any `Exception`; watch task retained as `_watch_task` with an `_on_watch_done` exit log |
| 2026-10-29 | `in-progress` (no change) | /sdd-execute sequential (sdd-batch-execute) | Step 6 done — `tests/test_config_watcher.py` @AC-5 (reconnect after a non-gRPC error, 2s sleep, `analysis-` client_id) and @AC-8 (retained `_watch_task`, ERROR exit log naming `config-watch-analysis`) |
| 2026-10-29 | `in-progress` (no change) | /sdd-execute sequential (sdd-batch-execute) | Step 7 done — indicators `ConfigWatcher._watch` reconnects after any `Exception`; watch task retained as `_watch_task` with an `_on_watch_done` exit log |
| 2026-10-29 | `in-progress` (no change) | /sdd-execute sequential (sdd-batch-execute) | Step 8 done — indicators `tests/test_config_watcher.py` @AC-5 (reconnect after a non-gRPC error, 2s sleep, `indicators-` client_id) and @AC-8 (retained `_watch_task`, ERROR exit log naming `config-watch-indicators`) |
| 2026-10-29 | `in-progress` (no change) | /sdd-execute sequential (sdd-batch-execute) | Step 9 done — ingest `ConfigWatcher._watch` reconnects after any `Exception`; watch task retained as `_watch_task` with an `_on_watch_done` exit log |
| 2026-10-29 | `in-progress` (no change) | /sdd-execute sequential (sdd-batch-execute) | Step 10 done — ingest `tests/test_config_watcher.py` @AC-5 (reconnect after a non-gRPC error, 2s sleep, `ingest-` client_id) and @AC-8 (retained `_watch_task`, ERROR exit log naming `config-watch-ingest`) |
| 2026-10-29 | `in-progress` (no change) | /sdd-execute sequential (sdd-batch-execute) | Step 11 done — P&L consumer `_emit` takes keyword-only `correlation_id`/`idempotency_key`/`timeout`; existing snapshot and pattern-sealed emits carry `event.correlation_id` as the request field and `x-trace-id` metadata |
| 2026-10-29 | `in-progress` (no change) | /sdd-execute sequential (sdd-batch-execute) | Step 12 done — analysis `tests/test_pnl_pattern_consumer.py`: `FakeLedger` records `(req, metadata, timeout)`; `_emit` request shape (`correlation_id`, `idempotency_key`, `x-trace-id`, `timeout`) and event-trace propagation on the snapshot/sealed emits (@AC-7) |
| 2026-10-29 | `in-progress` (no change) | /sdd-execute sequential (sdd-batch-execute) | Re-spec after merging main-dev: step 13 evidence re-verified unchanged; `_ATTEMPT_DB_TIMEOUT_SECONDS = 10` added to instruction 2's fixed invariants (6b used it without declaring it) |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` written by `/sdd-spec` (2026-10-22); stable unless `/sdd-spec` re-runs.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias | 1-6, 11-14 (supervision helper + boot retention, loop survival, analysis config watcher, P&L consumer) |
| `xstockstrat-indicators` owner | Formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution | 7-8 (config watcher copy) |
| `xstockstrat-ingest` owner | Signal normalization correctness, idempotent ingestion, newsletter source schema stability | 9-10 (config watcher copy) |

Step 15 (docs) has no reviewer per the governance matrix.

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — approved design: chosen approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Analysis background loops die for good on one exception in their schedule bookkeeping, and their tasks are
unretained. All three Python `ConfigWatcher._watch` loops end on any non-gRPC exception. The analysis P&L-pattern
consumer skips a failed event and its monotonic cursor moves past it.

## Next Action

`/sdd-execute fix-python-loop-supervision sequential` — Step 10
