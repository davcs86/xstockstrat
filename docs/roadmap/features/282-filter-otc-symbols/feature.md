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
| 2026-11-01 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, quick extended to the cap) and approved; recon.md + design.md written |
| 2026-11-01 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 15 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture
- [Implementation Spec](implementation-spec.md) — 15 numbered steps
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Keep over-the-counter (OTC) symbols out of the bar-ingestion warm set and out of watchlists, so symbols the configured Alpaca feed cannot serve stop generating failing `GetBars` calls, repeated live fetches and no-bars warnings.

## Reviewers

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness, backward compatibility, `buf lint` / `buf breaking` |
| Service owner `xstockstrat-marketdata` | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency |
| Service owner `xstockstrat-portfolio` | P&L calculation accuracy, position snapshot consistency, concurrent write safety |
| Service owner `xstockstrat-config` | Config key naming (`<service>.<category>.<key>`), environment / global-per-user scoping, WatchConfig stream stability |
| Service owner `xstockstrat-agent` | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity |
| Service owner `xstockstrat-ui` | Connect-RPC call safety, environment scope correctness, UI correctness |

## Next Action

`/sdd-review filter-otc-symbols impl-spec` — validate implementation spec, then `/sdd-execute filter-otc-symbols`
