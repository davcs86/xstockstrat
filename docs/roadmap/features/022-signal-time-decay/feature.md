# Feature: signal-time-decay

**Lifecycle Status**: `design-approved`
**Development Branch**: `feature/signal-time-decay`
**Created**: 2026-05-26
**Last Updated**: 2026-08-14

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-26 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-13 | `draft` (unchanged) | /sdd-review | Round 1 FAIL (missing Consumer Surface, unresolved Open Questions); fixed. Round 2 FAIL (stale premise — feature 097 retired the backtest/live signal blend this spec originally targeted); retargeted to `Opportunity.signal_axis` per user direction. Round 3 FAIL (FR-1/FR-5 internal contradiction); fixed. Round 4 FAIL (AC-1 arithmetic error); fixed. |
| 2026-08-13 | `draft` → `spec-ready` | /sdd-review | Round 5: PASS, 0 warnings |
| 2026-08-14 | `spec-ready` → `design-approved` | /sdd-design | Full-mode debate, 4 rounds, 0 Floor breaches at any round. Round 1: found structurally-reachable negative-`age_hours` bug (race with the `QuerySignals` await). Round 2: fix verified, but found 2 new must-fix defects (`UnboundLocalError` risk in the FR-6 log path when decay is disabled; a silent platform-wide signal blackout via `ingested_at` proto zero-value during an ingest/analysis deploy-ordering race). Round 3: both fixed (branch-independent age/decay computation; `HasField` presence guard) and verified sound — user chose to run round 4 anyway rather than accept as final. Round 4: resolved 4 remaining mechanical objections (130-composition claim corrected to a spec-time re-verify instruction; `product-spec.md` AC-5 amended + AC-7 added for the 2 new regression surfaces; per-signal WARNING aggregated to one-per-compute-pass; NaN fail-safety converted from an argument-order-dependent `max()` property to an explicit `isfinite()` guard) — and proactively found + fixed its own new structural bug (signals-merge section is a 2-level nested loop; decay must be computed once per signal, hoisted above the per-target loop, or the fixes above would still amplify per bound strategy). `recon.md` + `design.md` written; `product-spec.md` amended (FR-5 placement wording, AC-5, new AC-7) in the same pass. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec signal-time-decay`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Adds exponential confidence decay to the Opportunities queue's `signal_axis` ranking
(`_compute_opportunities`) so a signal loses ranking weight as it ages, instead of ranking equally
with a fresh signal until it expires. (Retargeted 2026-08-13 from the original premise — decaying
the backtest/live scoring loop's signal blend — which feature 097 had already retired.)

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness, no breaking changes without deprecation, `buf lint`/`buf breaking` |
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| `xstockstrat-ingest` owner | Signal normalization correctness, idempotent ingestion, newsletter source schema stability |
| `xstockstrat-config` owner | Config key naming (`<service>.<category>.<key>`), environment/trading_mode scoping, WatchConfig stream stability |

## Next Action

`/sdd-spec signal-time-decay` — generate implementation spec. **Must land after
`130-signal-source-reliability-weight` and `131-live-strategy-opportunity-attribution`**
(same-expression/same-function overlap in `_compute_opportunities`, `servicer.py:2144-2168` —
see `docs/roadmap/features/merge-order.md`, landing order 130 → 131 → 022).
