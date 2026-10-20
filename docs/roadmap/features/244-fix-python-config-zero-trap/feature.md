# Feature: fix-python-config-zero-trap

**Type**: bug
**Development Branch**: `feature/fix-python-config-zero-trap`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-19-python-config-zero-trap-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20
**Last Updated**: 2026-10-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-20 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-19-python-config-zero-trap-defect.md` |

---

## Reviewers

Provisional snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-triage time (2026-10-20). `/sdd-spec` overwrites it with per-step assignments.

| Reviewer | Focus |
|---|---|
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| `xstockstrat-indicators` owner | Formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution |
| `xstockstrat-ingest` owner | Signal normalization correctness, idempotent ingestion, newsletter source schema stability |
| `xstockstrat-config` owner | Only if SetConfig bounds (`configServiceImpl.ts:112-121`) are revised once getters honour 0: config key naming, scoping, WatchConfig stream stability |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-python-config-zero-trap`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The Python `ConfigWatcher.get_int` / `get_str` / `get_float` return `v.<x>_val or default` in analysis, indicators
and ingest, so an operator-stored `0`, `0.0` or `""` resolves to the coded default (e.g. a zero-commission backtest
or a zero signal-rank weight cannot be configured).

## Next Action

`/sdd-design fix-python-config-zero-trap` — recommended design depth (full) from triage; see context.md
