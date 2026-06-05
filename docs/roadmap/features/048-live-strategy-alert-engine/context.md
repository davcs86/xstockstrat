# Context: live-strategy-alert-engine

**Feature**: `docs/roadmap/features/048-live-strategy-alert-engine/feature.md`
**Product Spec**: `docs/roadmap/features/048-live-strategy-alert-engine/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/048-live-strategy-alert-engine/implementation-spec.md`

---

## Session 2026-06-01 — sdd-story

- Split out of the `047-strategy-engine` revamp. User wanted a live "strategy→alert" engine where
  strategies (composed of multiple indicators/custom formulas) run continuously and in backtests.
  The model/persistence/evaluator/backtest half went to 047; this feature is the **continuous
  live evaluation runtime** that emits alerts on entry/exit triggers.
- **Hard dependency on 047** (StrategyDefinition + shared evaluator). Must merge after 047 — to be
  recorded in `merge-order.md` when 047/048 reach implementation.
- Core principle: **evaluator parity** — live evaluation calls the same 047 evaluator as backtest,
  so live and simulated decisions cannot diverge.
- Safety invariant captured: **alerts only, never orders**, in any trading mode.
- Related existing features noted: `010-agent-scheduler` (continuous signal-extraction loop — same
  runtime concern, reuse pattern), `031-strategy-performance-dashboard`, `032-walk-forward-backtesting`
  (should reuse 047 evaluator), `025-realtime-tick-streaming` (out of scope — this engine uses bars).
- Main Open Question for /sdd-spec: where the runtime lives (analysis loop vs new service vs agent
  scheduler) — Platform Lead decision.

## Session 2026-06-05 — sdd-review product-spec

- Product spec approved. Status: `draft` → `spec-ready`.
- All 5 open questions resolved:
  - **OQ-1 Runtime placement**: asyncio background task inside `xstockstrat-analysis`. Mandated by feature 047 product spec AC-5 ("feature 048 calls evaluator directly with no changes to its signature or module path"). No new service.
  - **OQ-2 Trigger cadence**: fixed polling interval (default 60s, `analysis.engine.eval_interval_seconds`). Feature 025 (tick streaming) is out of scope; no bar-close event exists. Silent no-op when market closed (no new bars since last cycle).
  - **OQ-3 Dedup durability**: in-memory `last_state: dict[tuple[str, str], bool]`. FR-4 already defines restart policy as "re-arm without replaying." Alert-only semantics make in-memory acceptable for v1.
  - **OQ-4 Live enable/disable surface**: new `live_enabled BOOLEAN NOT NULL DEFAULT FALSE` column on `analysis.strategies` (migration `002_`), new `SetStrategyLive` RPC on `AnalysisService` (additive), new `set_strategy_live` MCP tool (admin-scoped). `active` and `live_enabled` remain independent flags.
  - **OQ-5 Scale**: sequential evaluation, `analysis.engine.max_strategies_per_cycle` cap (default 50 pairs), single-flight via asyncio.Lock. Parallelism is a follow-up.
- Proto Contract Changes section updated: `SetStrategyLiveRequest`/`SetStrategyLiveResponse` + `SetStrategyLive` RPC (additive). `StrategyDefinition` proto field for `live_enabled` left as open question for `/sdd-spec`.
- Database Changes updated: migration `002_strategy_live_enabled.up.sql` — `ALTER TABLE analysis.strategies ADD COLUMN live_enabled BOOLEAN NOT NULL DEFAULT FALSE`. No `strategy_live_state` table.
- Config Keys updated: `analysis.engine.eval_interval_seconds`, `analysis.engine.max_strategies_per_cycle`, `analysis.engine.alert_throttle_seconds` — all in `analysis` namespace.
- Feature 047 and 009 merge-order dependencies added to `docs/roadmap/features/merge-order.md`.
- Review passed (PASS). Stale text fixed: FR-9 TBD namespace → `analysis.engine.*`; Affected Services `xstockstrat-analysis` qualifier updated; Feature Workflow Notes gates updated.
- Advisory overlap WARNs: 047 (same service/proto/migrations dir — merge-order already recorded), 007 (same service, no key collision), 009 (prerequisite chain: 009→047→048).
- Open proto design deferred to sdd-spec: whether `StrategyDefinition` gets a `bool live_enabled` field or live status is a separate response message.
