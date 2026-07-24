# Feature: strategy-reentry-cooldown

**Lifecycle Status**: `draft`
**Development Branch**: `feature/strategy-reentry-cooldown`
**Created**: 2026-07-24
**Last Updated**: 2026-07-24

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-24 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec strategy-reentry-cooldown`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Add a configurable per-strategy re-entry cooldown (default 31 calendar days, chosen to sit outside
the U.S. wash-sale window) so a rule-based strategy's `entry_rule` cannot immediately refire on a
symbol on the very next bar after an exit, which today produces whipsaw re-entries during a
persistent decline.

## Reviewers

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` (service owner) | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| Proto Reviewer | Field number uniqueness, backward compatibility (no field removal/type change without deprecation), naming conventions |
| DBA | Migration NNN numbering (no gaps/conflicts), up+down pair present, index correctness — new `008_strategy_cooldowns` migration |

## Next Action

`/sdd-review strategy-reentry-cooldown product-spec` — AI review of product spec before running /sdd-spec
