# Feature: add-ikbr-account-support

**Lifecycle Status**: `draft`
**Created**: 2026-05-02
**Last Updated**: 2026-05-02

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-02 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec add-ikbr-account-support`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Introduce a broker abstraction layer in `xstockstrat-trading` so orders can be routed to either Alpaca or Interactive Brokers (IBKR) for execution. Adds a `BrokerType` enum to the proto contract and a `trading.broker.active` config key to select the broker at runtime per environment (dev = IBKR paper account, prod = IBKR live account).

## Next Action

`/sdd-spec add-ikbr-account-support` — generate implementation spec from the product spec
