# Feature: fix-opportunities-read-hangs

**Type**: bug
**Development Branch**: `feature/fix-opportunities-read-hangs`
**GitHub Issue**: none (Issues disabled) — defect report `docs/reports/2026-10-14-opportunities-read-hangs-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-14
**Last Updated**: 2026-10-14

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-14 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-14-opportunities-read-hangs-defect.md` |
| 2026-10-14 | `draft` → `design-approved` | /sdd-design | Full mode, 6 rounds (round 6 by operator cap override); operator approved round-6 design |
| 2026-10-14 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 13 steps |
| 2026-10-15 | `implementation-ready` → `in-progress` | /sdd-execute | Step 1 done |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — codebase dossier, existing business rules (C-16)
- [Design](design.md) — approved design (6 rounds), rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

| Reviewer | Focus | Steps |
|---|---|---|
| xstockstrat-config owner | Config key naming (`<service>.<category>.<key>`), environment/global-per-user scoping, WatchConfig stream stability | 1, 2 |
| xstockstrat-marketdata owner | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency | 3, 4 |
| xstockstrat-analysis owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias | 5–10 |
| xstockstrat-agent owner | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity | 11, 12 |

---

## Summary

The Decide-queue read (`ListOpportunities`, via the agent's `list_opportunities` tool and the UI) hangs past client
timeouts with no log line. No hop on its path has a deadline, and marketdata `BatchGetLatestPrice` discards its errors.

## Next Action

`/sdd-review fix-opportunities-read-hangs impl-spec`: validate the implementation spec, then `/sdd-execute fix-opportunities-read-hangs`
