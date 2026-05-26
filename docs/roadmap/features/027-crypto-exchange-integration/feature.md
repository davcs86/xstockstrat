# Feature: crypto-exchange-integration

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

Integrate one or more cryptocurrency exchanges (Coinbase, Binance) alongside the existing IBKR/Alpaca equity stack, allowing the platform to trade both stocks and crypto assets through the same signal and execution pipeline.

## Demotion Rationale (short)

Crypto markets have fundamentally different microstructure from equities: 24/7 trading breaks all session logic, fragmented liquidity across dozens of CEXes, wash trading corrupts volume signals, and the existing signal sources are equity-focused. This is a fork of the platform, not an extension. Build separately if and when the equity strategy is proven out.

## Next Action

_None — feature is demoted. Do not implement._
