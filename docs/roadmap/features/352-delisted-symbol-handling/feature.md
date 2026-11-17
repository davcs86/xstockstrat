# Feature: delisted-symbol-handling

**Development Branch**: `feature/delisted-symbol-handling`
**Created**: 2026-11-16
**Last Updated**: 2026-11-17

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-16 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-11-16 | `draft` → `spec-ready` | /sdd-review | Product spec approved (0 warnings after 4 rounds; 3 notes) |
| 2026-11-17 | `spec-ready` → `design-approved` | /sdd-design | Design debated (6 rounds, full; round cap overridden by the operator) and approved; recon.md + debate.md + design.md written |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon](recon.md) · [Debate Register](debate.md) · [Design](design.md)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec delisted-symbol-handling`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Detect a watchlist symbol that stops being servable after it was added (delisted, acquired, moved to
OTC), remove it from system-managed "Signals" watchlists and mark it on user watchlists, stop
watchlist-driven work from requesting it, and make backfill jobs report it as `skipped` with a
per-symbol reason instead of ending `PARTIAL`. Stored bars and fundamentals are kept.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-marketdata` owner | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency |
| `xstockstrat-portfolio` owner | P&L calculation accuracy, position snapshot consistency, concurrent write safety |
| `xstockstrat-ingest` owner | Signal normalization correctness, idempotent ingestion, newsletter source schema stability |
| `xstockstrat-agent` owner | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity |
| `xstockstrat-ui` owner | Analytics display accuracy, Connect-RPC call safety |
| `xstockstrat-notify` owner | Stream delivery guarantees, backpressure handling, alert deduplication |
| `packages/proto` owner + Proto Reviewer | Field number uniqueness, backward compatibility, `buf lint` / `buf breaking` pass |
| DBA | Migration NNN numbering, up+down pair present, index correctness, run-order compliance (only if the design adds a migration) |

## Next Action

`/sdd-spec delisted-symbol-handling` — generate implementation spec from the approved design
