# Feature: seed-curated-templates

**Development Branch**: `feature/seed-curated-templates`
**Created**: 2026-11-12
**Last Updated**: 2026-11-12

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-12 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-11-12 | `draft` → `spec-ready` | /sdd-review | Product spec approved (1 warning) |
| 2026-11-12 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + debate.md + design.md written |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — settled decisions, rejected alternatives
- [Design](design.md) — approved architecture
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec seed-curated-templates`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Seed the template catalog (feature 224) with 9 formula, 14 strategy and 4 signal-source templates taken
from the operator's staging instances, make system templates read-only through `ManageTemplate` (with a
config-ui "System" badge), seed the `fundamentals_macd_blend` strategy for `admin@localhost` and the
system `fundamentals` source, and prove template-vs-staging parity from an operator-run export.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| DBA | Migration NNN numbering (no gaps, no conflicts), up+down pair present, run-order compliance with `scripts/db-migrate.sh` |
| `xstockstrat-indicators` owner | Formula sandboxing, numeric precision, no side-effects from formula execution |
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| `xstockstrat-ingest` owner | Signal normalization correctness, idempotent ingestion, newsletter source schema stability |
| Proto Reviewer | Field number uniqueness per message, no breaking changes, `buf lint` / `buf breaking` pass |
| `xstockstrat-ui` owner | Config mutation safety, no direct DB access |
| `xstockstrat-agent` owner | MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity |

## Next Action

`/sdd-spec seed-curated-templates` — generate implementation spec from the approved design
