# Feature: opportunity-universe-unification

**Lifecycle Status**: `code-completed`
**Development Branch**: `feature/opportunity-universe-unification`
**Created**: 2026-08-03
**Last Updated**: 2026-08-03

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-03 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-03 | `draft` → `spec-ready` | /sdd-review | Product spec approved — PASS WITH WARNINGS (no blockers); 5 design forks routed to /sdd-design; no blocking overlap (098/099 UI-only, rebase-only) |
| 2026-08-03 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full) and approved; recon.md + design.md written. Materialized opportunities (lazy + stale-while-revalidate + daily refresh); 8 Open Risks to /sdd-spec |
| 2026-08-03 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 19 steps; all 8 Open Risks (OR-A…OR-H) resolved inline |
| 2026-08-03 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential execution started on feature/opportunity-universe-unification (Step 1 proto done) |
| 2026-08-03 | `in-progress` → `code-completed` | /sdd-execute | All 19 steps done + verified (analysis 419→422 passed 81%; agent 198 passed; UI lint+tsc+unit clean, e2e opportunities/watchlists/strategy-authoring green). PR #861. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon Dossier](recon.md) — grounded codebase map (design Phase 0)
- [Design](design.md) — debated, approved architecture (design Phase 1)
- [Implementation Spec](implementation-spec.md) — 19 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Unify the three symbol-origins that feed the Decide → Opportunities queue (active signals, held
positions, and watchlist entries) into one per-user Universe, evaluated through a single signal-free
readiness kernel, with a stable opportunity identity and server-persisted snooze/dismiss/take. Signals
become a universe + independent ranking axis only (never a strategy-score input), and watchlists change
shape from a bare symbol list into a list of `(symbol, strategy_id)` bindings.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness, no breaking changes without deprecation (`signal_weight`/`signal_sources` and the `Watchlist` shape change must deprecate, not delete), `buf breaking` vs `main`/`main-dev` |
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism (removing the signal blend from scoring), no look-ahead bias, readiness-kernel reuse |
| `xstockstrat-portfolio` owner | Watchlist `(symbol, strategy)` binding shape, position snapshot consistency, concurrent write safety |
| `xstockstrat-ui` owner | Opportunities/Watchlist/Strategy-wizard display correctness, exhaustive enum render maps, Connect-RPC call safety |
| `xstockstrat-agent` owner | MCP tool contract stability + `mcp-tools.md`/`strat-lab` skill parity for `manage_strategy` and any watchlist tool |
| DBA | Migration NNN numbering (portfolio + analysis), up+down pair, index correctness |
| Platform Lead | Cross-service architecture, inter-service dependency graph (no new synchronous cycle, no new DB pool — F-06) |

## Next Action

`/sdd-review opportunity-universe-unification impl-spec` — validate the implementation spec, then `/sdd-execute opportunity-universe-unification`
