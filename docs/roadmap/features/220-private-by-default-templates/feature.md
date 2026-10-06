# Feature: private-by-default-templates

**Development Branch**: `feature/private-by-default-templates`
**Created**: 2026-10-06
**Last Updated**: 2026-10-06

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-06 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec private-by-default-templates`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Remove the concept of "public" from every user-authored object (formulas, strategies, signal sources and the
signals ingested into them all become owner-private), and add an admin-curated template catalog for
strategies, formulas and signal sources that users instantiate into independent private snapshot copies.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer (`packages/proto`) | Field number uniqueness, backward compatibility (deprecate `is_public`/`include_public`, never delete), naming conventions |
| DBA | Owner-column backfills on `ingest.*` and `analysis.strategy_scores`/backtest tables, new template tables, index/PK changes |
| `xstockstrat-indicators` owner | Formula sandboxing, no side-effects from formula execution — plus owner-only read/execute and template instantiation |
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism — plus owner-scoped formula execution (bypass removal) and strategy-template deep copy |
| `xstockstrat-ingest` owner | Signal normalization correctness, idempotent ingestion (now per-owner dedup), newsletter source schema stability |
| `xstockstrat-agent` owner | MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity; tool-count statements across all six inventory surfaces |
| `xstockstrat-ui` owner | Analytics display accuracy, Connect-RPC call safety, removal of public toggles, template catalog UX |
| `xstockstrat-config` owner | Any new config keys (none planned) |

## Next Action

`/sdd-review private-by-default-templates product-spec` — AI review of product spec before running /sdd-spec
