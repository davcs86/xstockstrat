# Context: backtest-time-window

**Feature**: `docs/roadmap/features/071-backtest-time-window/feature.md`
**Product Spec**: `docs/roadmap/features/071-backtest-time-window/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/071-backtest-time-window/implementation-spec.md`

---

## Session 2026-07-26 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- **Origin:** surfaced during in-engine validation of the `range_mean_reversion_v3` re-entry
  cooldown (feature 069). Re-running the same backtest two days apart (window start moved
  2024-07-25 → 2024-07-29) shifted a symbol's first trade because the shortened indicator warm-up
  pushed its boundary entry later — everything else matched to the digit. Also blocked a proper
  out-of-sample test: only cross-sectional OOS (new symbols) was possible, never a held-out period.
- **Known trap noted:** additive proto request fields still hard-couple the `run_backtest` MCP tool
  and any UI backtest trigger (ledger fails 056/060/067, rule C-10) — update consumers in the same
  feature with a test.

## Session 2026-07-26 — sdd-review product-spec

- **Verdict: FAIL, then PASS after re-scope.** Status: `draft` → `spec-ready`.
- **The spec's core premise was wrong.** `RunBacktestRequest.range` (`common.v1.TimeRange`,
  `packages/proto/analysis/v1/analysis.proto:34`) already exists, is honored by the servicer
  (`services/xstockstrat-analysis/app/handlers/servicer.py:273-297`, incl. the `max_range_days` cap
  and `now`-anchored defaulting), and is **already sent by the UI backtest form**
  (`services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx:91`).
- **Proto change withdrawn.** Adding `start`/`end` would create a second, ambiguous window
  representation on a message whose wire bytes are persisted verbatim in `analysis.backtest_details`
  (`analysis.proto:60-63`). Checked `- [x] No proto changes required`; dropped the Proto Reviewer row.
- **Real scope**: (1) plumb the window through `client.run_backtest`
  (`services/xstockstrat-agent/app/client.py:143-165`) and the `run_backtest` tool
  (`app/tools.py:240-244`) — the only place the window is missing; (2) pre-window indicator warm-up
  (genuinely new engine work).
- **New requirements added from review findings:** FR-2a (one-sided windows), FR-3a
  (`max_range_days` binds the requested window, not the warm-up-extended fetch span), FR-6 (agent↔UI
  parity + feature-065 evidence-cell impact), FR-7 (**backtest/live parity** — `live_loop.py:116-121`
  builds its own window and `:133` calls the same shared evaluator, a documented parity invariant
  that FR-3 could silently break).
- AC-3 restated against a frozen clock — the `now`-anchored default makes cross-day byte equality
  impossible by construction, so the original "byte-for-byte" wording was unverifiable.
- Resolved OQs: `Timestamp` vs ISO string (moot — `TimeRange` already uses `Timestamp`);
  `max_range_days` applicability (answered declaratively by FR-3a).
- **Observation, out of scope:** `live_loop.py:126` queries `GetBars` with `timeframe="1Day"` while
  the backtest path uses the canonical `"1d"` (feature 053 fixed that mismatch for backtests only).
  Possible latent defect; not touched — flagging for a separate triage.
- **Deviation:** implemented on the harness-assigned branch `claude/features-070-071-rnbkqo`
  (rebased onto `main-dev`) rather than `feature/backtest-time-window` with per-step PRs, because the
  harness pins the branch. Features 070 and 071 share this one branch/PR.
