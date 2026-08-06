# Context: backtest-result-attachment  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: `run_backtest` now returns `[TextContent(summary), EmbeddedResource]` — a ~1 KB inline summary (headline metrics + per-symbol `no_trade_reason`/`warmup_bars`/coverage gaps) plus the full per-bar diagnostics and trade list as a compact-JSON attachment — replacing one large pretty-printed inline payload (context.md:41-45, 380-387).
**Why (irrecoverable rationale)**: `EmbeddedResource` over `ResourceLink` turned on failure asymmetry under statelessness, not size — the agent has no in-memory store and cannot know at emit time whether feature-068's best-effort detail row landed, so a dangling link loses data permanently while an inline blob's worst case is merely verbose (context.md:148-151, ledger insights.md:301 DUP). JSON over CSV turned on `MessageToDict`'s executed type contract — int64→string, non-finite→`'NaN'`/`'Infinity'` — which CSV cannot round-trip (context.md:175-179, ledger insights.md:286 DUP).
**Rejected alternatives**:
- Fold into feature 071 as an FR, not a separate feature — lost because 071 was already design-approved with six steps left including the risky `trade_start_idx` loop restructure; folding in would reopen 071's product spec, re-run its review gate, and delay window work behind engine risk, whereas this change is agent-only and independently shippable (context.md:17-20) [NEW]
- `ResourceLink` — dangling-link risk, no producer-side signal of a failed persist (context.md:139,148-151)
- CSV — fidelity failure, verified by execution (context.md:139,175-179)
- gzip'd `BlobResourceContents` — inverts the feature's own failure-asymmetry rule; measured 103 KB not 53 KB; needs two unobserved connector behaviors (context.md:344-366, ledger insights.md:330 DUP)
- Content-trimming — a 0-trade run keeps 0/2520 bars, deleting the payload exactly when feature-064 diagnosis needs it most (context.md:426-432)
- `range`/time-window field in FR-2 summary — declined, `BacktestResult` carries no window field (context.md:485-487)
- Tiering / `ResourceLink` alongside the blob / inline `trades` — re-litigated and killed round 2 (context.md:411-418)

**Scars & gotchas**:
- `test_run_backtest_calls_grpc` asserts on the tool's own return shape, forcing steps 3+4 into one dispatch unit (context.md:219-224)
- `grep -n "fourteen"` is case-sensitive against `tools.py:4`'s capitalized "**F**ourteen" — fixed to `grep -in` (context.md:287-289)
- `mtime=0` gzip reproducibility is same-process only (context.md:397-401)
- `profit_factor: "Infinity"` is unreachable (clamped to 999.0/1.0) — false belief nearly shipped; ledger fails.md:61 DUP

**Permanent deviations**: none (context.md:340,422).
**Scars & gotchas**: none
**Permanent deviations**: none
**Cross-feature signal**:
- Missing `xstockstrat-agent` reviewer-registry row and phantom `uv lock --check` CI claim fixed mid-feature, shared gaps also affecting 070/071 (context.md:319-336)
- Same defect class recurred 3 review rounds: correcting an assertion ≠ correcting its fixture, correcting one step ≠ its paired step (context.md:549-554)
**Deferred follow-ons**:
- Gzip escalation gated on observing both: connector inlines the attachment AND a gunzip-able download affordance exists (context.md:403-409)
- `999.0` profit_factor clamp is a sentinel wearing a metric's type, persisted/surfaced unlabeled — out of 072's scope; "072's only obligation is not to publish it unlabeled" (context.md:482-484)
**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at f871138.
