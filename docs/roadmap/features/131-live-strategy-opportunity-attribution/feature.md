# Feature: live-strategy-opportunity-attribution

**Committed to main**: 94e4e24fa6ac41eb20bd16e1e9af15c8388e885a
**Launched date**: 2026-08-16
**Archived**: 2026-08-19
**Development Branch**: `feature/live-strategy-opportunity-attribution`
**Created**: 2026-08-13
**Last Updated**: 2026-08-15

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-13 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-13 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 warnings) |
| 2026-08-14 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds — started quick, upgraded to full mid-debate) and approved; recon.md + design.md written |
| 2026-08-14 | `design-approved` (unchanged) | /sdd-design | Round 4 reopened at user request; resolved 2 of 4 remaining Open Risks with citation-backed evidence (insertion-order safety, C-12 fixture obligation); 2 still open, tracked in design.md for `/sdd-spec` |
| 2026-08-14 | `design-approved` (unchanged) | /sdd-design | Post-approval amendment: fixed the compute-fan-out Open Risk for real (2 rejected fix attempts, adversarially caught real bugs in each) — added a new config key (`analysis.opportunity.max_live_strategies_per_symbol`) and amended product-spec.md (AC-4 clarified, new AC-7) with explicit user sign-off. Test-helper incompatibility Open Risk explicitly waived (not required) per user decision. |
| 2026-08-14 | `design-approved` (unchanged) | /sdd-design | Follow-up round (user-requested, "clear warnings"): closed the last remaining Open Risk (distinct-symbol-count fan-out). 3 sub-rounds: round 1's cap had a starvation bug (already-curated symbols wasted slots); round 2's symbol-level fix regressed FR-4 (silently dropped valid cross-strategy pairs); round 3 corrected to a per-`(symbol, strategy)` newness check with a proof of correct composition. New config key `max_live_only_symbols_per_compute`, new AC-8, user explicit sign-off obtained. |
| 2026-08-14 | `design-approved` (unchanged) | /sdd-design | User asked to also close the held-symbol-count dimension rather than accept it deferred. 2 sub-rounds: round 1's fix had 2 real bugs (a held-blind step-6 could re-discover a budget-denied symbol and wrongly entry-trace a duplicate row; `held_value_by_symbol` had the same raw-vs-normalized key bug already fixed once for `live_by_symbol`), round 2 fixed both (`held_norm` excluded from step 6's domain entirely; `_drain_held_symbols` normalizes at construction). New config key `max_live_held_symbols_per_compute`, new AC-9 with a combined compound-worst-case note across all three caps (200-row ceiling). All Open Risks now resolved; test-helper incompatibility remains the one explicitly-waived item. |
| 2026-08-14 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 5 steps |
| 2026-08-15 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential (stacked) execution started (Steps 1–2) |
| 2026-08-15 | `in-progress` → `code-completed` | /sdd-execute | All 5 steps done (474 analysis tests pass, 82.6% cov); integration PR next |

| 2026-08-16 | `code-completed` → `launched` | CI workflow | Promoted via PR #963; committed 94e4e24fa6ac41eb20bd16e1e9af15c8388e885a |
| 2026-08-19 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(2)/fails(3); pruned 4 specs |
---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture
- [Implementation Spec](implementation-spec.md)
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

`/sdd-review live-strategy-opportunity-attribution impl-spec` — validate implementation spec, then
`/sdd-execute live-strategy-opportunity-attribution`. **Must land after
`134-signal-source-reliability-weight`** and before `132-strategy-symbol-denylist` (same-function
overlap in `_compute_opportunities`, `servicer.py:2144-2168`; cohort order `133 → 134 → 131 → 132` —
see `docs/roadmap/features/merge-order.md`).
