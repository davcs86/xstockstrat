# Feature: quote-fanout-batching

**Development Branch**: `feature/quote-fanout-batching`
**Created**: 2026-09-04
**Last Updated**: 2026-09-04

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-04 | `idea` → `draft` | /sdd-story | Product spec generated from performance audit Track C |
| 2026-09-04 | `draft` → `spec-ready` | /sdd-review | FAILED first pass (false "batch RPC exists" premise); reworked to additive GetLatestQuotes RPC, re-review PASS; overlap = soft rebase w/172 |
| 2026-09-05 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, extended); round-3 adversary SOUND; recon.md + design.md written |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase map, Patterns to REUSE, Existing Business Rules
- [Design](design.md) — chosen approach, rejected alternatives, open risks, Constitution rules
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec quote-fanout-batching`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Collapse the N+1 fan-out on the portfolio→marketdata and portfolio→DB read edges: add an additive
`GetLatestQuotes` batch RPC to marketdata (wrapping its existing internal `MultiSymbolSource` helper)
and switch `enrichPositions` from per-position `GetLatestQuote` to it, collapse `ListWatchlists`'
per-watchlist `listBindings` into one `ANY`-array query, and add single-flight to marketdata's
cold-symbol live fallback.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Additive `GetLatestQuotes` RPC — non-breaking (`buf breaking`), enum/field conventions, codegen freshness |
| `xstockstrat-portfolio` owner | P&L calculation accuracy, position snapshot consistency, concurrent write safety |
| `xstockstrat-marketdata` owner | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency |

## Next Action

`/sdd-spec quote-fanout-batching` — generate the implementation spec from the approved design
