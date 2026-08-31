# Context: premarket-aftermarket-session-toggle  (archived 2026-08-31)

**Feature**: ./feature.md
**Status**: demoted/canceled — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-31 — /sdd-archiver

**What**: A UI toggle to filter pre-market / regular / after-hours sessions on intraday charts, backlogged as a stub during feature 014 (`trader-chart-panel`) execution in May 2026. Never advanced past `idea` — no product-spec, design, or code was written. Formally demoted August 2026 because two independent platform decisions made its premise moot.
**Why (irrecoverable rationale)**: The cancellation rested on two independent obsolescence counts: (1) Feature 143 (`daily-bars-only`, launched) restricted `GetBars`/`BackfillBars` to `1d` timeframe only — the intraday bars this toggle would have filtered no longer exist in the platform. (2) Feature 045 (`ui-consolidation-nextjs`) removed `xstockstrat-trader` as a standalone service; the `ChartPanel` component this toggle targeted was absorbed into the consolidated `xstockstrat-ui`. Explicit policy recorded at cancellation: if intraday support is ever revived, create fresh under a new NNN — not resurrected from this stub.
**Rejected alternatives**: Deferring rather than canceling — rejected because both obsolescence counts were architectural commitments, not temporary constraints; "deferral" would imply a path back that doesn't exist without a platform reversal.
**Scars & gotchas**: Pre-cancellation known implementation blocker was a proto gap: `GetBarsRequest` had no `session`/`extended_hours` field, requiring a proto change, Alpaca client propagation, and frontend wiring before any UI work — a three-layer change for a backlogged idea. If intraday is ever revived, this is the first gate.
**Permanent deviations**: n/a — nothing shipped.
**Cross-feature signal**: Features 017 and 025 (`realtime-tick-streaming`) were both demoted/canceled in the same August 2026 product review pass for the same root cause: intraday-adjacent ideas accumulated in the backlog without vetting against the platform's bar-timeframe trajectory. When feature 143 landed, both became obsolete simultaneously. Pattern: backlog ideas that depend on specific data granularity must be recon'd against current architectural constraints at intake.
**Deferred follow-ons**: If intraday support is ever revived (reverting feature 143's daily-only restriction), open as a new NNN with a fresh design. The proto blocker (no `session` field on `GetBarsRequest`) is the first gate.
**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-08-31 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: none
**Pruned artifacts**: (none — feature had no spec files on the deletion allowlist)
