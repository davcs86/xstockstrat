# Feature: live-strategy-opportunity-attribution

**Lifecycle Status**: `draft`
**Development Branch**: `feature/live-strategy-opportunity-attribution`
**Created**: 2026-08-13
**Last Updated**: 2026-08-13

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-13 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec live-strategy-opportunity-attribution`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Attributes a held position or active signal in the Opportunities queue to a live-enabled strategy
that already covers its symbol (via `signal_params.symbols`), instead of falling back to
unattributed whenever the symbol isn't also watchlist-bound to that strategy.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |

## Next Action

`/sdd-review live-strategy-opportunity-attribution product-spec` — AI review of product spec before running /sdd-spec
