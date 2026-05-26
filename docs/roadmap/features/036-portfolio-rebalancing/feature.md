# Feature: portfolio-rebalancing

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

Periodically rebalance the portfolio back to target asset weights on a schedule, trimming positions that have grown above their target allocation and adding to those that have drifted below.

## Demotion Rationale (short)

Rebalancing is a concept from passive index allocation, not signal-driven discretionary strategies. Applying it here would cause the system to add to losing positions (drifted below target) and trim winning positions (drifted above target), directly conflicting with signal conviction logic. There is no "target weight" for any given stock in this system — the right allocation is zero when there is no signal.

## Next Action

_None — feature is demoted. Do not implement._
