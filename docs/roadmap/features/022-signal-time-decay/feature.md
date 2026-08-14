# Feature: signal-time-decay

**Lifecycle Status**: `implementation-ready`
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
| 2026-08-14 | `spec-ready` → `design-approved` | /sdd-design | Full-mode debate, 4 rounds, 0 Floor breaches at any round. Round 1: found structurally-reachable negative-`age_hours` bug (race with the `QuerySignals` await). Round 2: fix verified, but found 2 new must-fix defects (`UnboundLocalError` risk in the FR-6 log path when decay is disabled; a silent platform-wide signal blackout via `ingested_at` proto zero-value during an ingest/analysis deploy-ordering race). Round 3: both fixed (branch-independent age/decay computation; `HasField` presence guard) and verified sound — user chose to run round 4 anyway rather than accept as final. Round 4: resolved 4 remaining mechanical objections (134-composition claim corrected to a spec-time re-verify instruction; `product-spec.md` AC-5 amended + AC-7 added for the 2 new regression surfaces; per-signal WARNING aggregated to one-per-compute-pass; NaN fail-safety converted from an argument-order-dependent `max()` property to an explicit `isfinite()` guard) — and proactively found + fixed its own new structural bug (signals-merge section is a 2-level nested loop; decay must be computed once per signal, hoisted above the per-target loop, or the fixes above would still amplify per bound strategy). `recon.md` + `design.md` written; `product-spec.md` amended (FR-5 placement wording, AC-5, new AC-7) in the same pass. |
| 2026-08-14 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 7 steps. Re-verified current trunk per design instruction: **134 and 131 have NOT landed** (both `implementation-ready`), so the write site is still `c["signal_axis"] = max(c["signal_axis"], sig.conviction)` (`servicer.py:2163`) with no `source_weight` term and `weight_for` absent — Step 5 cites real current code (F-04) and carries an explicit execute-time re-grep/rebase constraint (land after 134 → 131). Config key runtime-registered (no seed migration, sibling `analysis.scoring.*` precedent); no UI/Agent step (C-14 existing surface). |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture
- [Implementation Spec](implementation-spec.md) — 7 numbered steps with codebase-cited evidence
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

_(Finalized at /sdd-spec: distinct reviewers across all 7 steps. The `xstockstrat-config` owner from
the earlier draft is not a step reviewer — the config key is declared in the analysis service `CLAUDE.md`
and read in analysis code; no `xstockstrat-config` service code or migration changes, so per the
reviewer-registry matrix the `config`-category step is owned by the analysis owner.)_

| Role | Review Focus | Steps |
|---|---|---|
| Proto Reviewer | Field number uniqueness, no breaking changes without deprecation, `buf lint`/`buf breaking` | 1, 2 |
| `xstockstrat-ingest` owner | Signal normalization correctness, idempotent ingestion, newsletter source schema stability | 1, 2, 3, 4 |
| `xstockstrat-analysis` owner | Strategy scoring determinism, no look-ahead bias; config key naming (`analysis.scoring.*`) for the config-declaration step | 1, 2, 5, 6, 7 |

## Next Action

`/sdd-review signal-time-decay impl-spec` — validate the implementation spec, then
`/sdd-execute signal-time-decay`. **Must land after `134-signal-source-reliability-weight` and
`131-live-strategy-opportunity-attribution`** (same-expression/same-function overlap in
`_compute_opportunities`, `servicer.py:2154-2168` — see `docs/roadmap/features/merge-order.md`,
landing order 134 → 131 → 022). As of 2026-08-14 neither has landed (both `implementation-ready`);
`/sdd-execute` must re-grep the actual landed `_compute_opportunities` body and rebase Step 5 per the
spec's MERGE-ORDER / REBASE CONSTRAINT before implementing.
