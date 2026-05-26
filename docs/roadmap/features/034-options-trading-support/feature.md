# Feature: options-trading-support

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

Add options contract trading (calls, puts, spreads) alongside the existing equity execution stack, allowing signals to drive options positions as well as stock positions.

## Demotion Rationale (short)

Options have a completely different data model (chains, Greeks, IV surface, expiry calendars), pricing requirements (Black-Scholes or binomial tree), and broker API semantics from equities. The existing proto types and signal pipeline are equity-centric. This is a separate platform domain, not an additive feature. The current signal sources produce directional equity signals, not strike/expiry-specific options signals.

## Next Action

_None — feature is demoted. Do not implement._
