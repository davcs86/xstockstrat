# Context: strategy-reentry-cooldown

**Feature**: `docs/roadmap/features/068-strategy-reentry-cooldown/feature.md`
**Product Spec**: `docs/roadmap/features/068-strategy-reentry-cooldown/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/068-strategy-reentry-cooldown/implementation-spec.md`

---

## Session 2026-07-24T07:05:26Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Motivating evidence: MCP-tool-driven shadow-strategy validation session (no production strategy
  touched) that fixed a sandbox bug in two custom formulas (`rolling_zscore_v2`,
  `kaufman_efficiency_ratio_v2`) for a `range_mean_reversion_v2` shadow strategy, then tested a
  bounded-exit variant `range_mean_reversion_v3` (adds `er>0.5 OR z<=-3.0` bail-out conditions to
  the `z>=0` exit). v3 improved the 10-symbol basket aggregate materially (total_return -8.42%→
  +1.23%, max_drawdown 53.1%→36.3%) but degraded WSM specifically (win rate 66.7%→46.7%, Sharpe
  -0.55→-1.07) because the tightened exit stopped it out and the entry condition immediately
  refired on the same still-declining symbol, four times within about a month — confirmed in code
  at `services/xstockstrat-analysis/app/handlers/servicer.py:849`
  (`if position == 0.0 and decision.entry:`, no recency check). This feature is the fix for that
  specific whipsaw mechanism.
- User directed the default cooldown to be wash-sale-safe: 31 calendar days (outside the IRS
  30-day-each-side wash-sale window), configurable per strategy via a new
  `analysis.strategy.default_cooldown_days` config key and `StrategyDefinition.cooldown_days` field.
- No production strategy or shadow strategy has been modified as part of this `/sdd-story` step —
  this is spec-only.

## Session 2026-07-24 — product-spec review with user

Reviewed Out of Scope / Open Questions with the user and resolved three previously-open decisions:

1. **Cooldown trigger**: any exit (win or loss), not losses-only (FR-5). Wash-sale rule motivates
   the *default duration* only, not the trigger condition.
2. **Restart durability**: live-loop cooldown state MUST persist across restarts (FR-8) — this
   reverses the original draft's "in-memory only, out of scope" stance. Added new migration
   `008_strategy_cooldowns` (next free number after `007_backtest_run_symbols`) to Database Changes,
   added DBA to feature.md Reviewers, added DBA approval gate to Feature Workflow Notes.
3. **Cross-stock score fingerprint**: `cooldown_days` IS included (FR-9) — no exclusion added to
   `_definition_fingerprint`'s existing `display_name`/`active`/`live_enabled` exclusion list.

Also converted the "shared cooldown-check helper" open question into a hard requirement (FR-4) —
this repo's ledger (`fails.md`, 056-open-positions-ui) already records the exact failure mode of two
independently-implemented read paths drifting apart, so it isn't a genuine open design choice.

Added FR-7 (new) to explicitly guard against a reproducibility hazard the restart-durability
decision introduces: backtests must stay ephemeral/per-run and never read/write the new persisted
`strategy_cooldowns` table, or two unrelated backtest runs (or a backtest overlapping live trading)
would cross-contaminate each other's entry decisions. Added corresponding Acceptance Criteria 7–9
(restart-survival test, backtest-reproducibility test, fingerprint-change test).

Remaining Open Questions (both implementation-shape, deferred to `/sdd-design`): exact
`strategy_cooldowns` column/index shape, and whether the live-loop write is synchronous or
best-effort-deferred.

Next action unchanged: `/sdd-review strategy-reentry-cooldown product-spec`, then
`/sdd-design strategy-reentry-cooldown quick`.

## Session 2026-07-24 (cont.) — scope clarification with user

User asked two clarifying questions:

1. "Are the cooldown days per ticker?" — confirmed and left as-is: the *duration* (`cooldown_days`)
   is one value per strategy (not configurable per symbol); the *enforcement clock* (last-exit
   timestamp) is tracked per `(strategy_id, symbol)` pair, so each traded symbol gets its own
   independent timer using that same duration. User accepted this as designed (no spec change).
2. "Are UI and agent in scope?" — they were NOT in the original Affected Services list. Checked the
   actual code and confirmed a real gap: `services/xstockstrat-agent/app/tools.py:290-345`
   (`manage_strategy` tool) has an explicit parameter allowlist that would not forward
   `cooldown_days` even after the proto field exists, and
   `services/xstockstrat-ui/src/components/insights/StrategyWizard.tsx:115-128` (`handleSubmit`)
   builds the definition payload with no cooldown field — same "shipped the producer, forgot the
   consumer surface" shape as ledger entries 056/060/066. User directed: expand scope to both.

Added FR-10 (agent: `manage_strategy` gains `cooldown_days` param + `docs/runbooks/mcp-tools.md`
parameter table update) and FR-11 (UI: `StrategyWizard.tsx` gains a cooldown input, flows through
`handleSubmit`). Added `xstockstrat-agent` and `xstockstrat-ui` to Affected Services, feature.md
Reviewers, and the approval-gate checklist (now "service owner approval from each affected service"
rather than singular). Added Acceptance Criteria 10 (agent round-trip) and 11 (UI e2e coverage in
`e2e/insights/`).

Explicitly scoped OUT of FR-10 (and noted why): the agent `CLAUDE.md` tool table and
`docs/runbooks/CLAUDE.md` index, since the 066 "five discovery surfaces" ledger insight applies to a
*new* tool, not a parameter added to an existing one — only the tool signature/docstring and the
`mcp-tools.md` parameter table need updating here.

Next action unchanged: `/sdd-review strategy-reentry-cooldown product-spec`, then
`/sdd-design strategy-reentry-cooldown quick`.
