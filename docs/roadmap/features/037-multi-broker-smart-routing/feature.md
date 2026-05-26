# Feature: multi-broker-smart-routing

**Lifecycle Status**: `demoted/canceled`
**Development Branch**: _none — demoted before implementation_
**Created**: 2026-05-26
**Last Updated**: 2026-05-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-26 | `idea` → `demoted/canceled` | brainstorming | Demoted at idea stage — see rationale in product-spec.md |

---

## Artifacts

- [Product Spec](product-spec.md) — demotion rationale
- [Context Log](context.md) — decision log

---

## Summary

Route each order to whichever of IBKR or Alpaca offers better price improvement at execution time, maintaining simultaneous live connections to both brokers and aggregating positions across them.

## Demotion Rationale (short)

Smart order routing is economically meaningful only at institutional scale (millions of shares). For retail-sized positions (tens to hundreds of shares), the execution quality difference between IBKR and Alpaca is cents per trade — not dollars. The complexity of dual-broker position aggregation, ledger reconciliation across two sources, and margin management across accounts is massive relative to any execution benefit. IBKR's own SMART routing already provides best-execution across lit markets.

## Next Action

_None — feature is demoted. Do not implement._
