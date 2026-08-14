# Feature: live-strategy-opportunity-attribution

**Lifecycle Status**: `design-approved`
**Development Branch**: `feature/live-strategy-opportunity-attribution`
**Created**: 2026-08-13
**Last Updated**: 2026-08-14

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-13 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-13 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 warnings) |
| 2026-08-14 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds — started quick, upgraded to full mid-debate) and approved; recon.md + design.md written |
| 2026-08-14 | `design-approved` (unchanged) | /sdd-design | Round 4 reopened at user request; resolved 2 of 4 remaining Open Risks with citation-backed evidence (insertion-order safety, C-12 fixture obligation); 2 still open, tracked in design.md for `/sdd-spec` |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture
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

`/sdd-spec live-strategy-opportunity-attribution` — generate implementation spec from the approved
design. **Must land after `130-signal-source-reliability-weight`** (same-function overlap in
`_compute_opportunities`, `servicer.py:2144-2168` — see `docs/roadmap/features/merge-order.md`).
