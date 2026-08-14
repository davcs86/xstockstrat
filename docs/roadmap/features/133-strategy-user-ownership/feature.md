# Feature: strategy-user-ownership

**Lifecycle Status**: `spec-ready`
**Development Branch**: `feature/strategy-user-ownership`
**Created**: 2026-08-14
**Last Updated**: 2026-08-14

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-14 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-14 | `draft` → `spec-ready` | /sdd-review | Criteria: PASS WITH WARNINGS (4 warnings fixed — migration numbering tightened to explicit 013/014/015+, a seed-user-ownership governance note added to FR-5 per C-10(c), a wrong proto message name corrected (`CreateOrderRequest` → `PlaceOrderRequest`), `feature.md`'s Reviewers table reconciled with Affected Services by removing the unlisted `xstockstrat-identity` row). Overlap: CLEAN — no field/migration/config-key collisions against 132 (both self-coordinated numbers verified disjoint against trunk). |

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
| `xstockstrat-agent` owner | `manage_strategy`/`run_backtest`/`set_strategy_live` MCP tools — all now ownership-gated; `strat-lab` plugin skill update required in the same PR (root CLAUDE.md rule) |

## Next Action

`/sdd-design strategy-user-ownership` — recon + design debate. **The Phase 0 Recon's central
question is the background-loop identity mechanism** (how `live_loop.py`, with no inbound request,
authenticates a portfolio read on behalf of a stored owner) — see product-spec.md § Open Questions.
**This feature must land (or at minimum have its `(user_id, strategy_id)` identity contract settled)
before `132-strategy-symbol-denylist`'s FR-3 can be implemented** — see
`docs/roadmap/features/merge-order.md`, which must be updated once `/sdd-design` confirms the exact
dependency shape.
