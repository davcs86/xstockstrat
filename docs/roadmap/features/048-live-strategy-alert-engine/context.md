# Context: live-strategy-alert-engine  (archived 2026-08-05)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-05 — /sdd-archiver

**What**: A single asyncio background loop inside `xstockstrat-analysis` (`app/engine/live_loop.py`) polls active+live-enabled strategies on a fixed cadence, re-runs the exact 047 evaluator, and emits edge-triggered `EmitAlert` calls (category="strategy") — no new service, no order placement. Shipped alongside an admin-gated `SetStrategyLive` RPC/MCP tool and a trader-UI Live Strategies panel.
**Why (irrecoverable rationale)**: Runtime placement (in-process asyncio task, not a new service) was mandated by 047 product-spec AC-5 to guarantee evaluator-code-path parity (context.md:30). In-memory dedup was accepted for v1 because alerts are non-authoritative — durability deliberately deferred (context.md:32).
**Rejected alternatives**:
- New dedicated service for the live loop — would break evaluator parity (context.md:23,30).
- Bar-close event trigger — no such event exists (025 tick streaming out of scope); fixed polling used instead (context.md:31).
- Durable DB-backed trigger-state table — v1 scope rejected; alert-only semantics make in-memory acceptable (context.md:32,36).
**Scars & gotchas**:
- Evaluator shipped at `app/services/evaluator.py`, not the pre-spec'd `app/engine/evaluator.py`; servicer has no `self._evaluator` — loop constructs its own `StrategyEvaluator(...)`. Forced re-spec of Steps 4/5/6/7 (context.md:81-83).
- `_row_to_strategy_definition` originally failed to map the new `live_enabled` column into the proto response (only strategy_id/display_name/active carried) — `SetStrategyLive` would have silently returned a stale flag until Step 6 tests surfaced it; fixed as a Step-4 correction applied in Step 6 (context.md:137-139).
- Admin-gate mechanism was initially analysis-local (own `x-access-scope` check, agent-side `validate_admin` at MCP entry) rather than 047's shared helper — but a later re-sync session merged 047's admin-gate refactor and refactored `SetStrategyLive` onto the shared `_has_admin_scope` helper, the same gate as `ManageStrategy`; the divergence was reconciled, not permanent (context.md:88-92, 209-214).
- `StrategyDefinition` has no `symbols` field; loop reads per-strategy symbols from `signal_params.symbols` (context.md:129-130).
- Trader `page.tsx` assumed server component (`getSession()`); actually `'use client'` — required `GET /api/auth/me` + `useIsAdmin()` hook workaround (context.md:169-172).
- Mock-backend port bug caught only by e2e: AnalysisService mock first on 9091, trader BFF dials 9092, 501s until moved (context.md:187-190).
**Permanent deviations**:
- design said `analysis.strategy.evaluated` ledger event (FR-7) -> shipped only `.triggered`/`.live_toggled` -> per-cycle-evaluated event never implemented; docs corrected to match reality (context.md:197-199).
- design (implementation-spec.md Step 10, product-spec.md FR-11) said filter the strategy alert feed by Struct field introspection (`a.context?.fields?.strategy_id?.stringVal`) -> shipped `useStrategyAlerts` instead filters by the `strategy_id:<id>` tag string -> because protobuf-es v2 Struct-field access was judged fragile/unreliable in this codebase, explicitly "for protobuf-es v2 robustness/safety" (context.md:166, 174, 180-181).
**Cross-feature signal**: Hard-dependency re-spec pattern — a feature branched from a not-yet-merged prerequisite should budget a targeted re-spec pass once the prerequisite's delivered code (and later refactors) diverge from its pre-merge design (context.md:79-96, 209-214). Also: features `031-strategy-performance-dashboard` and `032-walk-forward-backtesting` were noted as should-reuse-047-evaluator candidates during 048's story session — this pointer exists nowhere else and should be checked when those features are picked up (context.md:21).
**Deferred follow-ons**:
- Parallel evaluation cycles (currently sequential, capped) — v2 (context.md:34).
- Durable dedup/trigger-state persistence (context.md:32).
- Market-hours (017) integration with polling cadence was explicitly deferred; `analysis.engine.eval_interval_seconds` lets operators lengthen the interval off-hours as a workaround in the meantime (product-spec.md:169-171).
**Ledger entries written**: insights.md (1), fails.md (3) — see the 2026-08-05 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at f5abed5.
