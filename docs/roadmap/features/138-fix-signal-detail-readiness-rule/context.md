# Context: fix-signal-detail-readiness-rule  (archived 2026-08-19)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-19 — /sdd-archiver

**What**: A held/`REDUCE` opportunity's Signal-detail page contradicted itself — header conviction came from the queue's exit-rule trace while the "Why this fired" panel came from `EvaluateReadiness`, which was rule-blind and always traced entry. Fixed by making the rule an explicit, additive proto selector (`ReadinessRule` enum on `EvaluateReadinessRequest`) that the UI opts into as `EXIT` only for held rows, so the panel now explains the rule that actually fired. Direct Track C bug fix — no `design.md`/`implementation-spec.md`.

**Why (irrecoverable rationale)**: "Held" is defined as the queue `Opportunity.provenance` containing `"position"` — deliberately the same `is_held` marker `_compute_opportunities` uses to pick `rule="exit"`, NOT the action enum. The point was to guarantee the readiness panel and the header conviction can never disagree: they now branch on the identical signal. A picked strategy with no matching queue row has no `"position"` provenance → falls back to entry rule. Explicit caller opt-in was chosen over server-side held-inference because `EvaluateReadiness` also backs Watchlist readiness, where entry-rule tracing is correct even for held symbols; a blanket server-side "held → exit" flip would have silently regressed Watchlist.

**Rejected alternatives**:
- UI-only relabel (no proto change, no exit leaves) — lost because the queue `Opportunity` message carries only scalar `conviction`/`passing`/`total`, no per-leaf `ConditionEval`; a UI reuse of the queue trace could relabel/hide but could not surface the exit-rule leaves. User explicitly chose the full exit-rule-trace path via AskUserQuestion.

**Scars & gotchas**: Local Playwright could not run (pinned browser binary absent); the new held→exit e2e case was validated only by CI's sharded e2e, not locally — recurring for UI e2e work on this host.

**Permanent deviations**: None — no `design.md` existed (Track C). The shipped `provenance`/`is_held` coupling is the chosen approach, captured above under "Why".

**Cross-feature signal**: Latent hazard — two independent code paths (queue `_compute_opportunities` vs `EvaluateReadiness`) computed the same user-facing quantity via different rule trees and were presented as one panel. The fix converges them on one marker; the general "two traces, one display" trap is worth watching wherever a summary scalar and a detailed leaf view are sourced separately.

**Deferred follow-ons**: none recorded.

**Ledger entries written**: insights.md (2), fails.md (1) — see the 2026-08-19 `fix-signal-detail-readiness-rule` entries.

**Runtime-invariant recommendations (→ /context-constitution)**: <ANALYSIS>-* / cross-module contract candidate — the `xstockstrat-ui` `SignalReadiness` component depends on the exact string literal `"position"` appearing in `Opportunity.provenance` as the definition of "held", the same marker `xstockstrat-analysis._compute_opportunities` emits to choose `rule="exit"`. A hidden cross-service string contract: if analysis renames that provenance marker, the UI's held→exit readiness routing breaks silently with no proto-level signal (provenance is a free-form string). Record as a cross-module invariant (analysis `servicer.py` ↔ UI `SignalReadiness.tsx`).

**Pruned artifacts**: product-spec.md — last present at 1d97c6c. (Surviving defect report `docs/reports/2026-08-15-signal-detail-readiness-traces-entry-rule-on-reduce.md` independently holds the observed/expected trace.)
