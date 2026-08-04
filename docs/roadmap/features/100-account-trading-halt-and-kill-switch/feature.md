# Feature: account-trading-halt-and-kill-switch

**Lifecycle Status**: `draft`
**Development Branch**: `feature/account-trading-halt-and-kill-switch`
**Created**: 2026-08-04
**Last Updated**: 2026-08-04

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-04 | `idea` → `draft` | /sdd-story | Product spec generated from external live-capital-safety risk review |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec account-trading-halt-and-kill-switch`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Introduces a server-authoritative account trading state (`ACTIVE` / `REDUCE_ONLY` / `HALTED` / `EMERGENCY_FLATTEN`) enforced inside `xstockstrat-trading` immediately before every broker order submission, so a single kill switch stops exposure-increasing orders from any caller — UI, agent, strategy engine, scheduled job, or internal RPC — with no administrative-scope override.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-trading` owner | Order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement |
| `xstockstrat-portfolio` owner | P&L calculation accuracy, position snapshot consistency, concurrent write safety |
| `xstockstrat-config` owner | Config key naming (`<service>.<category>.<key>`), environment/trading_mode scoping, WatchConfig stream stability |
| `xstockstrat-ui` owner | Trading UI correctness, config mutation safety, no direct DB access |
| `xstockstrat-agent` owner | MCP tool contract stability, admin `x-access-scope` forwarded only by management tools |
| Platform Lead | Cross-service architecture, new service additions, port assignments |

## Next Action

`/sdd-review account-trading-halt-and-kill-switch product-spec` — AI review of product spec before running /sdd-spec
