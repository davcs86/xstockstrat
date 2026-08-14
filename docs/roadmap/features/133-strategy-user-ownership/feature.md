# Feature: strategy-user-ownership

**Lifecycle Status**: `draft`
**Development Branch**: `feature/strategy-user-ownership`
**Created**: 2026-08-14
**Last Updated**: 2026-08-14

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-14 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec strategy-user-ownership`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Makes `StrategyDefinition` user-owned: `strategy_id` becomes unique per-owner (not platform-wide),
ownership gates every RPC that touches a strategy (including `RunBacktest`), and the live evaluation
loop resolves each strategy's symbol universe (watchlist/held/signals) against its own owner —
closing `132-strategy-symbol-denylist`'s cross-user-aggregation gap by construction instead of a new
cross-user RPC. Foundational, wide-blast-radius change: every table/proto referencing a bare
`strategy_id` today (watchlist bindings, trading orders, backtest run history, live-loop cooldown
state) needs a `user_id` alongside it.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Platform Lead | Cross-service architecture — this touches the strategy-identity contract every service that references `strategy_id` depends on |
| Proto Reviewer | Breaking-change risk: `strategy_id` semantics change platform-wide across `analysis.proto`, `portfolio.proto`, `trading.proto` |
| DBA | 3+ migrations across `analysis` (strategies PK, strategy_cooldowns PK) and any composite-key changes elsewhere |
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism — ownership gating on `RunBacktest`, live-loop per-owner evaluation |
| `xstockstrat-trading` owner | Order execution correctness — `Order.strategy_id` ownership resolution |
| `xstockstrat-portfolio` owner | Watchlist binding ownership resolution |
| `xstockstrat-identity` owner | JWT/API-key scoping — this is the platform's first strategy-level authorization model |
| `xstockstrat-agent` owner | `manage_strategy`/`run_backtest`/`set_strategy_live` MCP tools — all now ownership-gated; `strat-lab` plugin skill update required in the same PR (root CLAUDE.md rule) |

## Next Action

`/sdd-review strategy-user-ownership product-spec` — AI review of product spec before running
`/sdd-design strategy-user-ownership`. **This feature must land (or at minimum have its
`(user_id, strategy_id)` identity contract settled) before `132-strategy-symbol-denylist`'s FR-3 can
be implemented** — see `docs/roadmap/features/merge-order.md`, which must be updated once
`/sdd-design` confirms the exact dependency shape.
