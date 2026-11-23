# Feature: delisted-symbol-handling

**Development Branch**: `feature/delisted-symbol-handling`
**Created**: 2026-11-16
**Last Updated**: 2026-11-17
**Committed to main**: 37d41f42aaa3c2b7f27a1a06a4630c7d4d72c35f
**Launched date**: 2026-11-17
**Archived**: 2026-11-18

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-16 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-11-16 | `draft` → `spec-ready` | /sdd-review | Product spec approved (0 warnings after 4 rounds; 3 notes) |
| 2026-11-17 | `spec-ready` → `design-approved` | /sdd-design | Design debated (6 rounds, full; round cap overridden by the operator) and approved; recon.md + debate.md + design.md written |
| 2026-11-17 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 32 steps |
| 2026-11-17 | `implementation-ready` (unchanged) | /sdd-execute | Re-spec gate: steps 20, 22, 23, 24, 25, 28, 32 aligned with `main-dev@9a685196` after feature 351 landed (line shifts; Step 25 harness note; 351 PRESERVE rows) |
| 2026-11-17 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential execution started (Steps 1+2 landed) |
| 2026-11-17 | `in-progress` → `code-completed` | /sdd-execute | All 32 steps done (sequential mode); scenarios promoted; integration PR opened |

| 2026-11-17 | `code-completed` → `launched` | CI workflow | Promoted via PR #1576; committed 37d41f42aaa3c2b7f27a1a06a4630c7d4d72c35f |
| 2026-11-18 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(1)/fails(1); pruned 5 specs |
---

## Artifacts

- Product Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15); promoted to docs/sdd/business-rules/platform.feature, services/xstockstrat-agent/acceptance/delisted-symbol-handling.feature, services/xstockstrat-marketdata/acceptance/delisted-symbol-handling.feature, services/xstockstrat-marketdata/acceptance/filter-otc-symbols.feature, services/xstockstrat-portfolio/acceptance/delisted-symbol-handling.feature, services/xstockstrat-portfolio/acceptance/fundsignal-watchlist-universe.feature, services/xstockstrat-ui/acceptance/delisted-symbol-handling.feature (C-16)
- Recon, Debate Register, Design — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Implementation Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Detect a watchlist symbol that stops being servable after it was added (delisted, acquired, moved to
OTC), remove it from system-managed "Signals" watchlists and mark it on user watchlists, stop
watchlist-driven work from requesting it, and make backfill jobs report it as `skipped` with a
per-symbol reason instead of ending `PARTIAL`. Stored bars and fundamentals are kept.

## Reviewers

_(Snapshot finalized by /sdd-spec on 2026-11-17 from the `**Reviewers**` lines of
implementation-spec.md and docs/runbooks/reviewer-registry.md. Re-run /sdd-spec if the registry
changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-marketdata` owner | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency |
| `xstockstrat-portfolio` owner | P&L calculation accuracy, position snapshot consistency, concurrent write safety |
| `xstockstrat-ingest` owner | Signal normalization correctness, idempotent ingestion, newsletter source schema stability |
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| `xstockstrat-config` owner | Config key naming (`<service>.<category>.<key>`), environment / global-per-user scoping, WatchConfig stream stability |
| `xstockstrat-agent` owner | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity |
| `xstockstrat-ui` owner | Analytics display accuracy, Connect-RPC call safety |
| `packages/proto` owner + Proto Reviewer | Field number uniqueness, backward compatibility, `buf lint` / `buf breaking` pass |
| DBA | Migration NNN numbering (marketdata `010`, ingest `018`, config `054`), up+down pair present, index correctness, run-order compliance with `scripts/db-migrate.sh` |

`xstockstrat-notify` has no step (the alerts use the existing `EmitAlert` path unchanged), so its owner
is no longer in the snapshot; `xstockstrat-analysis` and `xstockstrat-config` each gained steps.

## Next Action

Review and merge the integration PR (`feature/delisted-symbol-handling` → `main-dev`) once CI is green and the approvals in root `CLAUDE.md` § Approval Flow are in (DBA + service owners for marketdata `010` / ingest `018`; owner + config team for the new key)
