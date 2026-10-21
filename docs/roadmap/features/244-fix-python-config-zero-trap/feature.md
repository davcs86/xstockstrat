# Feature: fix-python-config-zero-trap

**Type**: bug
**Development Branch**: `feature/fix-python-config-zero-trap`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-19-python-config-zero-trap-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20
**Last Updated**: 2026-10-21

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-20 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-19-python-config-zero-trap-defect.md` |
| 2026-10-20 | `draft` → `spec-ready` | /sdd-review | Product spec approved (8 warnings, 2 notes; overlap WARN) |
| 2026-10-20 | `spec-ready` (re-review) | /sdd-review | Product spec re-reviewed and approved (6 warnings; overlap WARN) |
| 2026-10-21 | `spec-ready` (amended) | /sdd-design | product-spec.md FR-3 amended per design: read-site `max(1, …)` guards subsumed by the `>0` clamp; negatives resolve to the default; present-aware `retry_seconds` guards stay |
| 2026-10-21 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved under operator standing authorization; recon.md + design.md written |

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
- [Recon](recon.md) — grounded codebase dossier (call-site classification, reuse patterns, business rules)
- [Design](design.md) — approved design: chosen approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-python-config-zero-trap`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The Python `ConfigWatcher.get_int` / `get_str` / `get_float` return `v.<x>_val or default` in analysis, indicators
and ingest, so an operator-stored `0`, `0.0` or `""` resolves to the coded default (e.g. a zero-commission backtest
or a zero signal-rank weight cannot be configured).

## Next Action

`/sdd-spec fix-python-config-zero-trap` — generate implementation spec from the approved design
