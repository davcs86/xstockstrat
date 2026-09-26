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
| 2026-09-26 | `spec-ready` → `design-approved` | /sdd-design | Design debated (4 rounds, full) and approved; recon.md + design.md written |
| 2026-09-26 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 16 steps; direct SEC companyfacts fetch grounded the D/E tag set + corrected the design's IFRS assumption |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase map (Phase 0)
- [Design](design.md) — debated architecture, rejected alternatives, open risks (Phase 1)
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Make EDGAR the single, PIT-faithful source of fundamentals for both backtest and live/snapshot
evaluation — fixing the hardcoded-currency bug, computing financial-debt D/E and market-derived P/B
from the filing itself, adding a point-in-time dividend feed, and disabling the FMP/Finnhub
fundamentals providers by config — so a symbol's backtest score and live score stop diverging.

## Reviewers

_(Canonical snapshot finalized at /sdd-spec time from the distinct per-step Reviewers across all
16 steps — re-run /sdd-spec if the registry changes. No proto step exists, so no Proto Reviewer.)_

| Role | Review Focus | Steps |
|---|---|---|
| `xstockstrat-marketdata` owner | Fundamentals ingestion integrity, Alpaca feed idempotency, TimescaleDB partitioning; FR-8 disable-safety literal audit | 1–11, 15, 16 |
| `xstockstrat-analysis` owner | **No look-ahead bias** (PIT enrichment uses only as-of-filed data); backtest↔live parity | 2, 4, 6, 8, 10, 15 |
| `xstockstrat-config` owner | Config key naming (`<service>.<category>.<key>`) + environment/global scoping; the `snapshot_source`/`edgar.enabled` dispatch reads | 10, 12 |
| `xstockstrat-ui` owner | Data-explorer display accuracy, no secret values rendered, C-17 tokens/primitives | 13, 14 |
| DBA | Migration NNN numbering + up/down pair; plain-table (non-hypertable) choice for `dividend_actions`; config seed scoping | 1, 12 |

**Advisory (validation target, no step assigned):** `xstockstrat-indicators` owner — the seeded
`fundamentals_value_quality` band behavior once PIT matches the snapshot convention (validate, ideally
unchanged; a band retune is out of scope unless @AC-9 validation proves one is needed).

## Next Action

`/sdd-review edgar-fundamentals-enrichment impl-spec` — validate the implementation spec, then `/sdd-execute edgar-fundamentals-enrichment`
