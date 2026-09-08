# Product Spec: fundamentals-blend-strategy-restrictions

**Created**: 2026-09-08

---

## Problem Statement

The fundamentals blend strategy (feature 168) currently falls through to the normal owner-scoped `resolve_universe` path when its kill-switch is off or the fundamentals universe resolution fails, causing it to evaluate against watchlist/held symbols — violating the design intent that this strategy runs exclusively on fundamentals-sourced signals. Additionally, nothing prevents operator error or agent tooling from deactivating, toggling non-live, or soft-deleting this strategy via the `ManageStrategy` and `SetStrategyLive` RPCs.

## User Story

As the platform operator, I want the strategy identified by `analysis.engine.fundamentals_blend_strategy_id` to be restricted so that it executes only against the fundamentals signal universe, and is protected from deactivation, live-toggle-off, and deletion — ensuring it remains always-on, always-live, and exclusively scoped to its intended fundamentals universe.

## Functional Requirements

FR-1. **Execution restriction**: When `fundamentals_blend_enabled` is false, or when the fundamentals universe resolution fails/is empty, the blend strategy must be SKIPPED entirely in `_run_cycle` — it must NOT fall through to the normal owner-scoped `resolve_universe` path. The strategy evaluates only when the signal source is "fundamentals" and the universe is successfully resolved.

FR-2. **Deactivation protection**: Any `ManageStrategy(DEACTIVATE)` request whose `strategy_id` matches the configured `fundamentals_blend_strategy_id` must be rejected with an appropriate gRPC error.

FR-3. **Live-toggle protection**: Any `SetStrategyLive(live_enabled=false)` request whose `strategy_id` matches the configured `fundamentals_blend_strategy_id` must be rejected with an appropriate gRPC error.

FR-4. **Config-driven identity**: All three protections use the runtime value of `analysis.engine.fundamentals_blend_strategy_id` (default `fundamentals_macd_blend`) to identify the blend strategy — no hardcoded strategy IDs.

## Out of Scope

- Changing the blend strategy's registration or UPDATE path (updates remain allowed)
- Adding new config keys (all required keys already exist from feature 168)
- Protecting against direct database mutations (out of the application layer's control)
- Preventing REACTIVATE operations (reactivation is safe — the strategy should be active)

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-analysis` — execution restriction in the live loop (`_run_cycle`), deactivation guard in `ManageStrategy`, live-toggle guard in `SetStrategyLive`

## Consumer Surface(s)

_Constitution **C-14**._ The end-user-reachable surface(s) this capability is consumed through.

- [ ] **UI** — no UI changes needed; the restrictions are server-side enforcement
- [x] **Agent** — `xstockstrat-agent` MCP tool(s): `manage_strategy` (DEACTIVATE rejection), `set_strategy_live` (live_enabled=false rejection) — these tools proxy to the analysis RPCs; the new guards surface as gRPC errors the agent relays
- [ ] **None**

The agent surface changes are error-path only (new rejection codes for previously-accepted requests). No new tool parameters or response mappings are needed — the existing error propagation handles it.

## Proto Contract Changes

- [x] No proto changes required

The existing `ManageStrategy` and `SetStrategyLive` RPCs already carry the fields needed. The restrictions are application-logic guards, not contract changes.

## Config Key Changes

- [x] No new config keys

All required keys exist from feature 168: `analysis.engine.fundamentals_blend_strategy_id` and `analysis.engine.fundamentals_blend_enabled`.

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/fundamentals-blend-strategy-restrictions` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [ ] DBA review + service owner (schema migration)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **Known trap (063-fundamentals-scoring-model)**: The ledger records a prior assumption failure around protecting seeded/shared resources from mutation (C-10(c)). This feature's lifecycle guards must use the config-driven `fundamentals_blend_strategy_id` — not a hardcoded ID — so the protection tracks the runtime identity of the blend strategy.
