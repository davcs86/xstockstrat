# Feature: screener-watchlist-fidelity

**Lifecycle Status**: `draft`
**Development Branch**: `feature/screener-watchlist-fidelity`
**Created**: 2026-08-02
**Last Updated**: 2026-08-02

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-02 | `idea` → `draft` | /sdd-story | Product spec generated — derivable-only fidelity fixes for the Screener and Watchlists pages left low-fidelity by feature 083; livestream (LAST/CHG/Quotes) split to a named backlog follow-up |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec screener-watchlist-fidelity`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Raise the Screener and Watchlists pages to the feature-083 "Nocturne" high-fidelity design using
**only data and controls already derivable from existing backend RPCs and DB tables** — surfacing the
`ScreenCriterion.weight`/`hard_filter` fields as sliders + a hard/rank toggle, "Save as watchlist" from
screener results, a master-detail Watchlists layout with strategy-scoped readiness roll-ups, and a
"Build from screener" affordance. All live-quote elements (LAST, CHG %, the Quotes tab) are deferred to
a named backlog follow-up feature.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` (service owner) | Analytics display accuracy, Connect-RPC call safety, nav reachability (C-10(a)), no fabricated signal→strategy binding, no secret values rendered, derived-value parity (C-10(b)) |

## Next Action

`/sdd-review screener-watchlist-fidelity product-spec` — AI review of product spec before running /sdd-spec
