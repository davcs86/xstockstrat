# Feature: filter-otc-symbols

**Development Branch**: `feature/filter-otc-symbols`
**Created**: 2026-10-31
**Last Updated**: 2026-11-05

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-31 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-11-01 | `draft` → `spec-ready` | /sdd-review | Product spec approved (PASS WITH WARNINGS, no blockers; open question resolved from code) |
| 2026-11-01 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, quick extended to the cap) and approved; recon.md + design.md written |
| 2026-11-01 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 15 steps |
| 2026-11-02 | `implementation-ready` (unchanged) | /sdd-design (quick, amendment) | Seed-key amendment approved after 3 rounds (Variant L): config migrations 038/039 with their readers (Steps 5/9), EREA order in Steps 9/10, Step 16 seed parse tests + 281 test conversion; executes after 281 merges |
| 2026-11-05 | `implementation-ready` (unchanged) | /sdd-execute (sequential, §5.3 re-spec) | Merged `origin/main-dev`; re-specced Steps 1, 3, 5, 7, 9, 10, 11, 12, 14, 15, 17 to the post-281 tree (Step 11 keeps 281's 5-parameter `add_watchlist_symbol`, Step 12 uses the 5-argument call shape, Step 17 takes `MARKETDATA-16` / `PORTFOLIO-19`; the rest re-anchor drifted lines) |
| 2026-11-05 | `implementation-ready` → `in-progress` | /sdd-execute (sequential, sdd-batch-execute) | Execution started after the operator's up-front confirmation |
| 2026-11-05 | `in-progress` (unchanged) | /sdd-execute (sequential, §5.3 re-spec) | `origin/main-dev` already merged (no-op), ledger-guard clean; re-specced Steps 7, 9, 11, 12, 13, 17 to the post-Step-5 tree (Step 7 anchors +2 lines, one-line drift elsewhere, Step 17 asset-set section placed after `## Alpaca Integration`); Steps 8, 10, 14, 15, 16 verified with no mismatch |

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
