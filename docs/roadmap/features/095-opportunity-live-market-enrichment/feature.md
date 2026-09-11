# Feature: opportunity-live-market-enrichment

**Development Branch**: `feature/opportunity-live-market-enrichment`
**Created**: 2026-08-02
**Last Updated**: 2026-09-01
**Committed to main**: c086afc839f905c4f72b24d75e824e22d61af0b2
**Launched date**: 2026-09-01
**Archived**: 2026-09-02

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-02 | `idea` → `draft` | /sdd-story | Product spec generated — the backend + UI backlog for the handoff extras feature 083 intentionally omitted (live price/change, sparkline, per-condition value chips, target/stop chart overlays, R:R + sizing) |
| 2026-08-31 | `draft` (regenerated) | /sdd-story (overwrite) | product-spec.md regenerated to current template; acceptance.feature authored |
| 2026-08-31 | `draft` → `spec-ready` | /sdd-review | Product spec approved; all review blockers addressed |
| 2026-08-31 | `spec-ready` → `design-approved` | /sdd-design | Design debated (full) + agent-consumer revision; approved; recon.md + design.md written |
| 2026-08-31 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated (13 steps) |
| 2026-09-01 | `implementation-ready` → `in-progress` → `code-completed` | /sdd-execute | All 13 steps executed (7 commits); red-before-green on every code step; both impl-review fixes honored |

| 2026-09-01 | `code-completed` → `launched` | CI workflow | Promoted via PR #1065; committed c086afc839f905c4f72b24d75e824e22d61af0b2 |
| 2026-09-02 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(3)/fails(2); pruned 4 specs |
---

## Artifacts

- Specs (product-spec, recon, design, implementation-spec) — pruned by /sdd-archiver 2026-09-02; see [Context Log](context.md) Archive Synthesis
- [Acceptance Criteria](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Fill the backend data gaps (and the UI that consumes them) that feature 083 left as the deliberately
un-faked Nocturne handoff extras: live price + intraday change%, a compact price sparkline,
per-condition live value chips, target/stop chart-overlay lines, and risk:reward + suggested share
sizing on the Decide surface (Opportunities queue + Signal detail).

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer (`packages/proto`) | Field-number uniqueness per message, additive-only (no breaking change), `buf lint`/`buf breaking` pass, `_UNSPECIFIED=0` for any new enum |
| Platform Lead | Inter-service dependency graph — the `analysis → marketdata` quote/bars edge (confirm existing vs new); port/registry consistency |
| `xstockstrat-analysis` (service owner) | Opportunity/readiness aggregation determinism, **no look-ahead** when folding in live quotes, hot backtest path frozen |
| `xstockstrat-marketdata` (service owner) | Latest-quote / recent-bars read integrity, Alpaca feed idempotency, TimescaleDB read cost |
| `xstockstrat-ui` (service owner) | Nocturne fidelity, Connect-RPC call safety, **no-fabrication** (omit absent fields), C-10(b) live-price parity across queue card + Signal-detail header, no execution-path change to the order ticket |
| `xstockstrat-portfolio` (owner, FYI) | Buying-power read used for suggested sizing (read-only consumer) |
| `xstockstrat-indicators` (owner, FYI) | Per-condition indicator values reused from the traced evaluator (no new sandbox path) |

## Next Action

`/sdd-review opportunity-live-market-enrichment impl-spec` then `/sdd-execute opportunity-live-market-enrichment`
