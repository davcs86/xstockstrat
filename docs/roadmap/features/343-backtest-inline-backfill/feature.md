# Feature: backtest-inline-backfill

**Development Branch**: `feature/backtest-inline-backfill`
**Created**: 2026-11-15
**Last Updated**: 2026-11-15

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-15 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-11-15 | `draft` → `spec-ready` | /sdd-review | Product spec approved (8 warnings) |
| 2026-11-15 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-15 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 16 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — settled decisions, rejected alternatives, objections
- [Design](design.md) — approved approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — 16 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Let a user fix an insufficient-data backtest in place: an inline action on the symbol page Backtests card backfills from the start of the missing range through the end of the backtest window (missing bars only), shows progress, then offers a re-run. Every signed-in user can use it, within a bounded self-serve envelope.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Service owner — `xstockstrat-ui` | Trading UI correctness, analytics display accuracy, Connect-RPC call safety |
| Service owner — `xstockstrat-ingest` | Signal normalization correctness, idempotent ingestion (backfill trigger authorization and duplicate-job prevention) |
| Service owner — `xstockstrat-agent` | MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity; admin `x-access-scope` forwarded only by the management tools |
| Service owner — `xstockstrat-config` | Config key naming, environment scoping, WatchConfig stream stability |
| DBA | Migration NNN numbering, up+down pair present, run-order compliance with `scripts/db-migrate.sh` |

## Next Action

`/sdd-review backtest-inline-backfill impl-spec` — validate implementation spec, then `/sdd-execute backtest-inline-backfill`
