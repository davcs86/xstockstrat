# Feature: fix-marketdata-fundamentals-cache

**Type**: bug
**Development Branch**: `feature/fix-marketdata-fundamentals-cache`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-marketdata-fundamentals-cache-defect.md`
**Severity**: SEV-3
**Created**: 2026-10-21
**Last Updated**: 2026-10-21

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-marketdata-fundamentals-cache-defect.md` (debt-radar D-19, D-50, D-51, D-52, D-53) |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-triage time (2026-10-21). `/sdd-spec` overwrites it with per-step assignments.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-marketdata` owner | OHLCV/fundamentals ingestion integrity, vendor quota correctness, Alpaca feed reconnect behaviour | All steps |
| `xstockstrat-analysis` owner | Downstream consumer of fundamentals (fundsignal scoring); read-only, informed of changed partial-row semantics | Only if design adds a partial marker visible on the wire |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-marketdata-fundamentals-cache`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Five marketdata defects in the fundamentals path:

- `daily_request_cap=0` disables FMP instead of uncapping it (D-50).
- Quota counts include edgar and inactive-vendor rows (D-51).
- The vendor cache serves edgar rows (D-52).
- `extra` decode and FMP enrichment errors are dropped silently (D-53).
- The Alpaca stream reconnect budget never resets and gives up silently (D-19).

## Next Action

`/sdd-design fix-marketdata-fundamentals-cache quick` — recommended design depth: quick (single service, but config-key semantics change for D-50); see context.md
