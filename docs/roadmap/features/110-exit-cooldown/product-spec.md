# Product Spec: exit-cooldown

**Created**: 2026-08-07

---

## Problem Statement

A rule-based strategy's `exit_rule` can fire and sell a position on the very next bar after entry
(e.g. on a brief pullback), producing premature exits that cut a position before the thesis has had
time to play out. Strategy builders need a way to enforce a minimum holding period per strategy —
"do not sell for N days" after entry — the exit-side mirror of the existing re-entry cooldown
(feature 069, `cooldown_days`, which gates re-entry after an exit).

## User Story

As a strategy builder, I want to configure an exit cooldown (minimum number of days a position must
be held before it can be sold/exited) on a strategy definition, alongside the existing re-entry
cooldown field, so that strategies can enforce a minimum holding period and avoid premature exits.

## Functional Requirements

FR-1. `StrategyDefinition` gains a new optional per-strategy field expressing the minimum holding
period in calendar days before an exit is permitted (exact name/field number decided at design
time — precedent: `cooldown_days` field 9, `optional int32`, explicit-presence semantics).

FR-2. Explicit-presence semantics mirror `cooldown_days` (feature 069): field unset → platform
default (a new `analysis.strategy.*` config key); explicit `0` → no minimum hold (exit permitted
immediately, current behavior); negative → rejected at write time with `INVALID_ARGUMENT`.

FR-3. While the exit cooldown is active (current time < entry time + N calendar days), the
strategy's `exit_rule` must NOT trigger an exit — even if the rule's conditions evaluate true — for
both the backtest engine and the live evaluation loop. This is a gate on the exit decision, not a
change to `exit_rule` evaluation itself (same shape as FR-3/FR-4 of feature 069's entry-side gate).

FR-4. Backtest/live parity (mirrors feature 069 FR-4): the same gate function, given the same
entry timestamp and current timestamp, must produce the same verdict in both the backtest engine
(`servicer.py` bar-by-bar loop) and the live evaluation loop (`live_loop.py` `_eval_pair`).

FR-5. Backtest cooldown state is ephemeral, per-`RunBacktest`, in-memory only (mirrors feature 069
FR-7) — two backtest runs of the same strategy/symbol must never cross-contaminate.

FR-6. Live-loop exit-cooldown state (the entry timestamp per open `(strategy_id, symbol)` position)
must survive a service restart (mirrors feature 069 FR-8) — open question for design: whether this
reuses/extends the existing `analysis.strategy_cooldowns` table (which currently stores only
`last_exit_at`) or introduces a new durable store for `last_entry_at`.

FR-7. The `manage_strategy` MCP tool exposes the new field as an optional parameter on
`create`/`update` operations, following the same "send only what's supplied" partial-update
semantics feature 070 established for `cooldown_days` (a bare update must not silently touch this
field), with `clear_fields` support to revert to the platform default.

FR-8. The `StrategyWizard` UI (Step 1 — Identity) exposes the new field as a labeled input next to
"Re-entry cooldown (days)", with the same presence-honest parsing feature 069 established (blank →
omit field; `"0"` → explicit 0; validation error on negative/non-integer).

FR-9. Changing the field on an existing strategy is a scoring-relevant definition change (mirrors
`cooldown_days`) — it must participate in the definition fingerprint so a stale derived grade is
cleared until fresh backtest evidence is supplied.

FR-10. `docs/runbooks/mcp-tools.md` and the `plugins/strat-lab` `backtest` skill must document the
new field (per root `CLAUDE.md`'s requirement that a change to `manage_strategy` update the
strat-lab skill in the same PR).

## Out of Scope

- Changing or removing the existing re-entry cooldown (`cooldown_days`) — this feature is additive
  only.
- Applying the exit cooldown to manual/UI-triggered position closes outside the strategy's own
  `exit_rule` evaluation (e.g. a manual sell order placed directly against `xstockstrat-trading`) —
  this feature only gates the strategy engine's own automated exit signal.
- Choosing a non-zero platform-wide default value with an external rationale (feature 069's 31-day
  default had an explicit wash-sale tax rationale; a minimum-holding-period default has no such
  externally-mandated number) — default to `0` (no minimum hold, current behavior) unless the design
  phase surfaces a reason otherwise.

## Affected Services

- `xstockstrat-analysis` — `StrategyDefinition` proto field, backtest engine gate, live-loop gate,
  durable entry-timestamp persistence, config default key, definition fingerprint inclusion
- `xstockstrat-agent` — `manage_strategy` MCP tool parameter, docstring, `docs/runbooks/mcp-tools.md`
- `xstockstrat-ui` — `StrategyWizard` form field
- `packages/proto` — `StrategyDefinition` message field addition (non-breaking)

## Consumer Surface(s)

- [x] **UI** — `xstockstrat-ui` segment: `/insights` — `StrategyWizard.tsx` Step 1 — Identity gains
  a new "Exit cooldown (days)" input next to the existing "Re-entry cooldown (days)" field (already
  reachable via the existing New Strategy / Edit Strategy wizard route — no new nav registration
  needed, C-10(a) does not apply).
- [x] **Agent** — `xstockstrat-agent` MCP tool: `manage_strategy` (new optional parameter on
  `create`/`update`, plus `clear_fields` support and `get_strategy` echoing the stored value).
- [ ] **None**

## Proto Contract Changes

- New optional field on `StrategyDefinition` (`packages/proto/analysis/v1/analysis.proto`) —
  `optional int32`, next available field number (design/spec time — do not assume a number without
  grepping the current message). Non-breaking addition.
- `UpdateStrategyRequest`'s maskable-paths set (`_MASKABLE_PATHS` in `servicer.py`, mirrored by any
  proto-level field-mask allowlist) gains the new field name.

## Config Key Changes

- New key `analysis.strategy.*` (exact name at design time, e.g.
  `analysis.strategy.default_exit_cooldown_days`) — int, default `0` (see Out of Scope: no
  wash-sale-style rationale exists for a non-zero default here).

## Database Changes

- New migration under `services/xstockstrat-analysis/migrations/` (NNN continues from the last
  number in that directory) to durably persist the live loop's per-`(strategy_id, symbol)` entry
  timestamp across restarts. Design phase decides: extend `analysis.strategy_cooldowns` with a
  second `last_entry_at` column, or add a parallel table — see FR-6.

## Feature Workflow Notes

Branch to create: `feature/exit-cooldown` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [x] DBA review + service owner (schema migration)

## Acceptance Criteria

1. A strategy created/updated with an explicit exit-cooldown value of N days does not have its
   `exit_rule` trigger an exit in either the backtest engine or the live loop until N calendar days
   have elapsed since the position's entry, verified by a paired backtest test and a live-loop test
   asserting identical verdicts for the same inputs (FR-4 parity).
2. A strategy with the field unset behaves exactly as before this feature ships (platform default
   `0` → no gating change to existing strategies).
3. `manage_strategy(operation='update', strategy_id=..., exit_cooldown_days=N)` changes only the
   exit-cooldown field, leaving all other stored fields untouched (mirrors feature 070's partial-
   update fix — no regression of that fix).
4. The live loop survives a restart without losing an in-progress exit-cooldown window for an
   already-open position (FR-6).
5. `StrategyWizard` Step 1 shows the new field, round-trips through create/update/get without
   collapsing an intentional explicit `0` into "unset" or vice versa (mirrors feature 069's
   presence-honest UI bug class).
6. `docs/runbooks/mcp-tools.md` and the `strat-lab` `backtest` skill reflect the new parameter.

## Open Questions

- [ ] **Known trap (see `docs/roadmap/ledger/fails.md` 2026-08-05 "live-strategy-alert-engine" —
  mapper-lockstep mistake; also `docs/roadmap/ledger/insights.md` 2026-07-26/2026-08-06 on the
  `manage_strategy` partial-update pattern; also the C-10(b) rule from 056)**: any new field
  added to `StrategyDefinition` must be propagated through **every** row-to-proto mapper
  (`_row_to_strategy_definition`), the maskable-paths set, the fingerprint computation, the MCP tool
  builder, AND the UI form in the same feature — a partial rollout is the exact recurring mistake
  this ledger documents. Design phase must enumerate every call site via recon, not assume the
  `cooldown_days` site list is exhaustive by analogy alone.
- [ ] Exact field name (`exit_cooldown_days` vs. `min_hold_days` vs. other) — resolve during design;
  this spec uses `exit_cooldown_days` as a working name for symmetry with `cooldown_days`.
- [ ] Whether the durable entry-timestamp store (FR-6) extends `analysis.strategy_cooldowns` (adding
  a `last_entry_at` column) or is a new table — a design-time tradeoff, not a story-time decision.
- [ ] Whether the exit-cooldown gate should also suppress the live loop's exit **alert**, or only the
  state transition (feature 069's re-entry gate suppresses both the transition and any alert for the
  suppressed entry) — precedent suggests symmetry, but confirm during design since a suppressed exit
  alert has different operator-visibility implications than a suppressed entry alert.
