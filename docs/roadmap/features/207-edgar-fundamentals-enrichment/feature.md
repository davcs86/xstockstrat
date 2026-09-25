# Feature: edgar-fundamentals-enrichment

**Development Branch**: `feature/edgar-fundamentals-enrichment`
**Created**: 2026-09-25
**Last Updated**: 2026-09-25

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-25 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-09-25 | `draft` → `spec-ready` | /sdd-review | Product spec approved (0 warnings); overlap CLEAN |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec <slug>`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Make EDGAR the single, PIT-faithful source of fundamentals for both backtest and live/snapshot
evaluation — fixing the hardcoded-currency bug, computing financial-debt D/E and market-derived P/B
from the filing itself, adding a point-in-time dividend feed, and disabling the FMP/Finnhub
fundamentals providers by config — so a symbol's backtest score and live score stop diverging.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-marketdata` owner | OHLCV/fundamentals ingestion integrity, Alpaca feed idempotency, TimescaleDB hypertable partitioning |
| `xstockstrat-analysis` owner | Backtest reproducibility, **no look-ahead bias** (PIT enrichment must use only as-of-filed data) |
| `xstockstrat-indicators` owner | Formula band behavior once PIT matches the snapshot convention (validate, ideally unchanged) |
| `xstockstrat-ui` owner | Data-explorer display accuracy, no secret values rendered |
| `xstockstrat-config` owner | Config key naming + env/global scoping for the vendor-disable + provider-selection keys |
| DBA | Migration NNN numbering + up/down pair for any new dividend/corporate-actions table + hypertable strategy |
| Proto Reviewer | Only if new fields/enum values are added (currency/source fields already exist — likely no change) |

## Next Action

`/sdd-design edgar-fundamentals-enrichment` — recon + grilling debate (resolve the design forks) before /sdd-spec
