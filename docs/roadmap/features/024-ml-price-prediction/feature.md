# Feature: ml-price-prediction

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

Train an LSTM or transformer model on OHLCV price data to predict future price movements and feed predictions into the analysis scoring engine.

## Demotion Rationale (short)

ML models trained on price data alone perform at or below chance after transaction costs in live conditions. The platform's signal-based approach (human-curated sources + formula engine + Claude NLP) already leverages the best available text intelligence. Adding a price-prediction model introduces opaque outputs, continuous retraining overhead, and false confidence from backtesting — with no defensible edge over the existing architecture.

## Next Action

_None — feature is demoted. Do not implement._
