# Feature: signal-time-decay

**Lifecycle Status**: `draft`
**Development Branch**: `feature/signal-time-decay`
**Created**: 2026-05-26
**Last Updated**: 2026-05-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-26 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec signal-time-decay`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Adds exponential confidence decay to the analysis service scoring loop so that signals lose weight as they age, preventing stale market intelligence from influencing trade decisions after the market has already priced in the information.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| `xstockstrat-config` owner | Config key naming (`<service>.<category>.<key>`), environment/trading_mode scoping, WatchConfig stream stability |

## Next Action

`/sdd-review signal-time-decay product-spec` — AI review of product spec before running /sdd-spec
