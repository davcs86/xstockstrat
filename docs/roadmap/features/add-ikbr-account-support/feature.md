# Feature: add-ikbr-account-support

**Lifecycle Status**: `draft`
**Created**: 2026-05-02
**Last Updated**: 2026-05-02

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-02 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-05-02 | `draft` → `spec-ready` | /sdd-story | All open questions resolved |
| 2026-05-02 | `spec-ready` → `draft` | user clarification | Scope revised: multi-account model replaces single-broker-switch |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec add-ikbr-account-support`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Allow a platform user to register multiple broker accounts (Alpaca and/or IBKR) and place orders against a specific account, with the portfolio tracking positions and P&L per account. Introduces a `broker_accounts` DB table, a broker client pool in `xstockstrat-trading`, `account_id` fields on `Order` and `Portfolio`, and a `BrokerType` enum in the proto contract. Dev environments enforce paper-only across all registered accounts.

## Next Action

`/sdd-spec add-ikbr-account-support` — generate implementation spec from the product spec
