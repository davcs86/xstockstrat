# Feature: opportunity-universe-unification

**Lifecycle Status**: `spec-ready`
**Development Branch**: `feature/opportunity-universe-unification`
**Created**: 2026-08-03
**Last Updated**: 2026-08-03

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-03 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-03 | `draft` → `spec-ready` | /sdd-review | Product spec approved — PASS WITH WARNINGS (no blockers); 5 design forks routed to /sdd-design; no blocking overlap (098/099 UI-only, rebase-only) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec opportunity-universe-unification`_
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

`/sdd-design opportunity-universe-unification` — recon + adversarial design debate (resolve the 5 forks)
