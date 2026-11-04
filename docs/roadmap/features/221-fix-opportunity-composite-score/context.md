# Context: fix-opportunity-composite-score  (archived 2026-11-04)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-11-04 — /sdd-archiver

**What**: Opportunity composite scores were coloured with the strategy-grade `scoreColor` thresholds (red below 0.6), so the neutral 0.500 showed red and a composite driven by one strong axis could never show green. The composite got its own centred diverging colours: muted inside 0.5 ± 0.08, `text-buy` above, `text-sell` below, applied at the three places it is shown; grade colouring untouched. Shipped 2026-10-08. The bug was widely visible because a composite of exactly 0.500 is what full readiness plus a decayed or zero-weight signal (signal sub-score 0) produces, so many real opportunities (e.g. every AXP row) sit at the neutral point.
**Why (irrecoverable rationale)**: The composite is a k=1 empirical-Bayes shrinkage toward 0.5, reachable range about 0.25–0.83 (one maxed axis caps at 0.750, two at 0.833); grade thresholds tuned for a 0–1 grade scale do not fit. ±0.08 is wide enough to keep neutral muted and narrow enough that a single maxed axis (0.75) still reads positive. The operator chose the band edges directly (AskUserQuestion, 2026-10-06), so the quick-mode adversarial round was skipped; triage chose "muted around neutral, colour only on the tails, calibrated to the reachable range".
**Rejected alternatives**:
- ±0.05 muted band — colours small signal drift.
- 5-tier bands (mild/strong per side) — adds threshold surface to govern for no decision value.
- `text-destructive` for the negative tail — destructive is the error/alert role; `text-sell` (loss) is the directional token.
- Changing composite formula, shrinkage k, or server-side ordering — out of scope; bug was display, not scoring.
**Scars & gotchas**: none recorded at build time.
**Permanent deviations**: none against design. Supersedes the "colored via the existing scoreColor scale" clause of feature 199 `@AC-8` (kept 199's 3-decimal value, no A–F grade, no client re-sort). 199's acceptance.feature:70 and the durable suite `services/xstockstrat-ui/acceptance/opportunity-composite-score.feature` (lines 4, 16) still carry the old clause and read as the live rule — human decision whether to amend.
**Cross-feature signal**: Feature 199 reused `scoreColor` for a metric with a different centre and range; DRY reuse of a presentation helper silently carried thresholds meaningful only for the original metric, and 199's own @AC-8 locked it in so tests passed while the display was wrong.
**Deferred follow-ons**: C-16 promotion of @AC-1..3 was never done; performed by this archive run into `services/xstockstrat-ui/acceptance/fix-opportunity-composite-score.feature`.
**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-11-04 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: candidate UI-* invariant — `compositeColor` and `scoreColor` in `services/xstockstrat-ui/src/lib/scoreDisplay.ts` are deliberately separate scales and must not be merged by a DRY refactor; loss direction uses `text-sell`, not `text-destructive` (check `docs/patterns/ui-ux-governance.md` first).
**Pruned artifacts**: product-spec.md, design.md, implementation-spec.md — last present at 1ed63958.
