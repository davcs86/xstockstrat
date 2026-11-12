# Feature: seed-curated-templates

**Development Branch**: `ccr-4bdb931f-mr7ofl`
**Created**: 2026-11-12
**Last Updated**: 2026-11-12

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-12 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-11-12 | `draft` → `spec-ready` | /sdd-review | Product spec approved (1 warning) |
| 2026-11-12 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-12 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 29 steps |
| 2026-11-12 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential execution started (Step 1 done) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — settled decisions, rejected alternatives
- [Design](design.md) — approved architecture
- [Implementation Spec](implementation-spec.md) — 29 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Seed the template catalog (feature 224) with 9 formula, 14 strategy and 4 signal-source templates taken
from the operator's staging instances, make system templates read-only through `ManageTemplate` (with a
config-ui "System" badge), seed the `fundamentals_macd_blend` strategy for `admin@localhost` and the
system `fundamentals` source, and prove template-vs-staging parity from an operator-run export.

## Reviewers

_(Snapshot finalized by `/sdd-spec` on 2026-11-12 from `docs/runbooks/reviewer-registry.md` and the
per-step `**Reviewers**` lines of `implementation-spec.md`. Re-run `/sdd-spec` if the registry changes.)_

| Role | Review Focus | Steps |
|---|---|---|
| DBA | Migration NNN numbering (no gaps, no conflicts), up+down pair present, run-order compliance with `scripts/db-migrate.sh`; read-only export query; replay / down / collision assertions | 1, 12, 13, 14, 16, 17, 18, 20, 21 |
| Proto Reviewer | Field number uniqueness per message, no breaking changes, `buf lint` / `buf breaking` pass | 2, 3 |
| `xstockstrat-indicators` owner | Formula sandboxing, numeric precision, no side-effects from formula execution | 1, 2, 3, 4, 5, 10, 11, 12, 13, 14, 15, 23 |
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias | 1, 2, 3, 6, 7, 10, 11, 12, 16, 17, 18, 19, 23 |
| `xstockstrat-ingest` owner | Signal normalization correctness, idempotent ingestion, newsletter source schema stability | 1, 2, 3, 8, 9, 10, 11, 12, 20, 21, 22, 23 |
| `xstockstrat-ui` owner | Config mutation safety, Connect-RPC call safety, no direct DB access | 2, 3, 24, 25 |
| `xstockstrat-agent` owner | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity | 2, 3, 26, 27 |

`scripts/` has no owner row in the registry; its steps (1, 10, 11, 12, 23) are reviewed by the owners
of the three services whose data they compare. Docs steps (28, 29): none.

## Next Action

Operator: run `scripts/testdata/seed-templates-staging-export.sql` on staging and commit its output; then `/sdd-execute seed-curated-templates sequential` to clear Steps 12 and 23 and open the path to merge.
