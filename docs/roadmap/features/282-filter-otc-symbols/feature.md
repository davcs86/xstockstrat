# Feature: filter-otc-symbols

**Development Branch**: `feature/filter-otc-symbols`
**Created**: 2026-10-31
**Last Updated**: 2026-11-01

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-31 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-11-01 | `draft` → `spec-ready` | /sdd-review | Product spec approved (PASS WITH WARNINGS, no blockers; open question resolved from code) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec filter-otc-symbols`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Keep over-the-counter (OTC) symbols out of the bar-ingestion warm set and out of watchlists, so symbols the configured Alpaca feed cannot serve stop generating failing `GetBars` calls, repeated live fetches and no-bars warnings.

## Reviewers

| Role | Review Focus |
|---|---|
| Service owner `xstockstrat-marketdata` | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency |
| Service owner `xstockstrat-portfolio` | P&L calculation accuracy, position snapshot consistency, concurrent write safety |
| Service owner `xstockstrat-ingest` | Signal normalization correctness, idempotent ingestion, newsletter source schema stability |
| Service owner `xstockstrat-agent` | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity |
| Service owner `xstockstrat-ui` | Trading UI correctness, Connect-RPC call safety, environment scope correctness |
| Proto Reviewer (if the design adds an RPC or field) | Field number uniqueness, backward compatibility, `buf lint` / `buf breaking` |

## Next Action

`/sdd-design filter-otc-symbols quick` — recon + design debate, then `/sdd-spec`
