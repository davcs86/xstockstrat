# Feature: config-keys-alias-removal

**Development Branch**: `feature/config-keys-alias-removal`
**Created**: 2026-11-07
**Last Updated**: 2026-11-07

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-07 | `idea` → `draft` | /sdd-story | Product spec generated from feature 296's approved design (`296-fix-config-keys-contract/design.md` §1, §10; FR-8). Created at the operator's explicit direction as slice D of the 296 split; `Type: feature`. This is the "named follow-up" of 296 FR-8 / AC-12 |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec config-keys-alias-removal`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Removes the transitional compatibility that 295 and 296 left behind once feature 304 has launched: the legacy spelling alias, the `SetConfig` write-time spelling tolerance, the trading poller canonicalisation exception and its WARN, the agent `get_config` alias filter, and the gate's alt/`form-mismatch` path. Also settles the three baseline entries owned by it (`platform` / `log_level`, `trading` / `risk.daily_loss_limit`, and `ledger` / `stream.notify_enabled`, re-owned from feature 305).

## Reviewers

| Role | Review Focus |
|---|---|
| Service owner — `xstockstrat-config` | WatchConfig stream stability, snapshot/delta content, authz (`canonical()` users), `SetConfig` error mapping |
| Service owner — `xstockstrat-trading` | The reconciliation poller must send `trading_state` before the exception is removed; escalation safety (`@AC-54` @feature-294) |
| Service owner — `xstockstrat-agent` | MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity (`get_config` shape) |
| Platform Lead | Earliest-start evidence (zero WARNs over a staging release), gate close-out |

## Next Action

`/sdd-review config-keys-alias-removal product-spec` — AI review of product spec before running /sdd-spec
