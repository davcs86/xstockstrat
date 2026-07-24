# Product Spec: strategy-reentry-cooldown

**Created**: 2026-07-24

---

## Problem Statement

`StrategyDefinition.entry_rule`/`exit_rule` are evaluated per-bar with no memory of recent trade
history: `_backtest_symbol_evaluated` (`services/xstockstrat-analysis/app/handlers/servicer.py:849`)
allows immediate re-entry — `if position == 0.0 and decision.entry:` fires on the very next bar with
no check of how recently the position on that symbol was exited. This was observed empirically
while validating a shadow recalibration of the `range_mean_reversion` strategy: a variant with a
tightened, more defensive exit rule stopped out of a losing WSM position and re-entered the same
still-declining symbol four times within about a month, each re-entry incurring a fresh loss plus
commission/slippage — worse win rate (66.7%→46.7%) and Sharpe (-0.55→-1.07) than a single longer
hold would have produced, despite the exit rule successfully defusing a comparable situation on a
different symbol (BX) where price genuinely reversed after the cooldown-shaped gap would have
occurred. Strategy authors need a way to suppress re-entry on a symbol for a period after an exit.

## User Story

As a strategy calibrator, I want strategies to enforce a configurable re-entry cooldown period per
symbol after an exit, so that a rule-based strategy cannot immediately whipsaw back into the same
symbol while a losing move is still in progress, and so that (by default) the cooldown is long
enough to avoid triggering U.S. wash-sale disallowance on a repurchase.

## Functional Requirements

FR-1. `StrategyDefinition` gains an `optional int32 cooldown_days` field (proto3 explicit presence;
calendar days, not trading-day bar counts). **Presence semantics (refined at /sdd-design, approved by
the user 2026-07-24):** field **unset** → use the platform default; field **explicitly set to `0`** →
genuine no-cooldown (immediate re-entry allowed); **negative** → rejected (FR-6). `optional` is
required, not stylistic — `HasField` is illegal on a plain proto3 scalar, and explicit presence is the
only way to distinguish "unset → default" from "explicit 0 → no cooldown". (This supersedes the earlier
draft's "`0`/unset both mean the default" wording; see design.md § Chosen Approach for the safety note.)

FR-2. A new config key `analysis.strategy.default_cooldown_days` (int, default `31`) supplies the
default when a strategy's `cooldown_days` is **unset** — 31 calendar days is chosen specifically to sit
outside the IRS wash-sale window (30 calendar days before/after a sale at a loss), matching this
repo's existing "no hardcoded values in source" config convention. **`get_int` zero-trap (documented,
not fixed):** an operator setting this key to `0` platform-wide silently gets `31` back (same trap
documented for `analysis.scoring.shrinkage_days`); a *per-strategy* explicit-0 is unaffected because it
travels via proto explicit presence, not this config read. Fixing `get_int` service-wide is out of scope
(design.md § Rejected Alternatives).

FR-3. The cooldown is enforced per `(strategy_id, symbol)` pair: after an exit on that symbol, the
entry condition must not fire again until at least `cooldown_days` calendar days (measured via bar
timestamps, not trading-day bar counts — weekends/holidays must not shrink the effective wait) have
elapsed since the exit.

FR-4. The cooldown gate logic (given a last-exit timestamp, a current bar timestamp, and an
effective `cooldown_days`, decide whether entry is suppressed) MUST be implemented as a single
shared helper used by both the backtest engine (`_backtest_symbol_evaluated`, `servicer.py`) and the
live evaluation loop (`app/engine/live_loop.py`) — not two independently-written copies. This is not
optional/design-time discretion: it directly reinforces this service's stated backtest/live parity
invariant, and this repo's own ledger (`fails.md`, 2026-07-01, 056-open-positions-ui) records a prior
incident where two read paths for the same value drifted out of sync. A parity test must assert both
call sites agree given the same inputs.

FR-5. The cooldown applies after **any** exit (win or loss), not only realized losses — decided
explicitly to keep the gate simple (no per-trade P&L-sign tracking required); the wash-sale rule
motivates the *default duration* (FR-2), not the trigger condition, so this is not a literal
wash-sale implementation.

FR-6. `ManageStrategy` register/update must accept and echo `cooldown_days`, and reject a negative
value with `INVALID_ARGUMENT` (mirroring existing definition-validation patterns in this service).

FR-7. **Backtest cooldown state is ephemeral, scoped to a single `RunBacktest` call, and MUST NOT
read from or write to any durable cross-run store.** A backtest tracks each symbol's last-exit
timestamp in-memory for the duration of that one request only (same lifetime as today's `position`/
`entry_price` locals in `_backtest_symbol_evaluated`). This is a correctness requirement, not a
simplification: if backtests shared the live loop's persisted cooldown store (FR-8), two unrelated
backtest runs — or a backtest and live trading — would silently cross-contaminate each other's
entry decisions, breaking the `xstockstrat-analysis` reproducibility invariant ("no look-ahead
bias" / deterministic backtests, per `docs/runbooks/reviewer-registry.md`).

FR-8. **The live evaluation loop's per-`(strategy_id, symbol)` last-exit timestamp MUST persist
durably** (new table, migration `008_strategy_cooldowns` — see Database Changes) so the cooldown
survives a service restart. On boot, the live loop hydrates its cooldown state from this table
(mirroring the existing hydrate-at-boot pattern documented in this service's CLAUDE.md for
`strategy_scores`); each write is best-effort (log-and-continue on DB failure, consistent with this
service's existing best-effort persistence convention) so a DB hiccup never blocks live evaluation.

FR-9. `cooldown_days` is a behavioral field and is therefore included in the feature-065 cross-stock
score definition fingerprint (`_definition_fingerprint`) with no special-case exclusion — changing a
strategy's cooldown resets its accumulated evidence/grade, identical to any other entry/exit rule
change. No code change is required beyond *not* adding `cooldown_days` to the fingerprint's existing
exclusion list (`display_name`/`active`/`live_enabled`).

FR-10. **Agent reachability.** The `manage_strategy` MCP tool
(`services/xstockstrat-agent/app/tools.py:290-345`) MUST gain a `cooldown_days: int | None = None`
parameter, forwarded into the `definition` dict alongside `components`/`entry_rule`/`exit_rule` (only
when set, mirroring the existing `signal_params` "include only if provided" pattern at
`tools.py:342-343`), and the tool's docstring updated to document it. Without this, the proto field
exists but is unreachable through the agent — the exact gap this repo's own ledger already names for
new-tool additions (`insights.md`, 2026-07-20, trigger-backfill-mcp-tool: "a new MCP agent tool has
five discovery/documentation surfaces, not one"); for a *parameter* addition to an existing tool the
relevant subset is: (a) the tool function signature/docstring itself, and (b) the parameter table in
`docs/runbooks/mcp-tools.md` (`### manage_strategy`, currently lines 308–336) — both must be updated
in the same PR. (The agent `CLAUDE.md` tool table and `docs/runbooks/CLAUDE.md` index only need
updates for a wholly *new* tool, not a parameter addition, so are not in scope here.)

FR-11. **UI reachability.** `StrategyWizard.tsx`
(`services/xstockstrat-ui/src/components/insights/StrategyWizard.tsx`) MUST gain a cooldown input
(numeric, optional, labeled with the effective default so an author who leaves it blank can see
"31 days" rather than a silent zero) and include it in the `definition` payload built in
`handleSubmit` (currently `strategyId`/`displayName`/`components`/`entryRule`/`exitRule`/
`signalParams`, `StrategyWizard.tsx:115-128`) sent on register/update. Both create mode and edit mode
(`/insights/strategies/[id]/edit`) go through this same component, so no separate edit-page change is
needed beyond whatever pre-fills `initial` props from the existing definition.

## Out of Scope

- A losing-exits-only cooldown variant (see FR-5 — resolved as "any exit" for this feature; a
  losses-only mode is a possible future enhancement, not part of this spec).
- Applying a cooldown to non-`entry_rule`/`exit_rule` strategies (the legacy SMA-crossover fallback
  path, `_backtest_symbol`) — this feature targets the composable-rule (`active_definition`) path
  only, matching where the observed whipsaw behavior occurs.
- Retroactively recomputing existing `backtest_run_symbols` evidence cells or cross-stock scores
  (FR-9 means a `cooldown_days` change naturally invalidates old evidence going forward; no backfill
  of historical cells is in scope).
- Persisting *backtest* cooldown state (see FR-7 — backtests are intentionally ephemeral/per-run;
  only the live loop's cooldown state is durable, per FR-8).

## Affected Services

- `xstockstrat-analysis` — proto field, backtest engine cooldown gate, live-loop cooldown gate, new
  config key, `ManageStrategy` validation.
- `packages/proto` — additive field on `StrategyDefinition` (`analysis/v1/analysis.proto`), no other
  message changes anticipated.
- `xstockstrat-agent` — `manage_strategy` MCP tool gains `cooldown_days` (FR-10); regenerated TS/Go/
  Python stubs are consumed here as a plain new field, no RPC signature change.
- `xstockstrat-ui` — `StrategyWizard.tsx` create/edit form gains a cooldown input (FR-11); read paths
  (`insights/strategies` list/detail pages, `useStrategyDefinitions.ts`) pick up the new field
  automatically via regenerated TS stubs, no separate change expected there but verify at `/sdd-spec`.

## Proto Contract Changes

- [ ] No proto changes required
- [x] New field: `StrategyDefinition.cooldown_days` (`int32`, field number `9` — the next free
  number; existing fields 1–8 are `strategy_id`…`live_enabled`). Additive, non-breaking.

## Config Key Changes

- [ ] No new config keys
- [x] `analysis.strategy.default_cooldown_days` (int, default `31`) — wash-sale-safe default
  cooldown in calendar days, applied when a strategy's `cooldown_days` is `0`.

## Database Changes

- [ ] No schema changes
- [x] New table for the live loop's durable cooldown state (FR-8), migration
  `services/xstockstrat-analysis/migrations/008_strategy_cooldowns.{up,down}.sql` (next free
  number after `007_backtest_run_symbols`). Proposed shape (final column/index design deferred to
  `/sdd-design`): `analysis.strategy_cooldowns (strategy_id TEXT, symbol TEXT, last_exit_at
  TIMESTAMPTZ NOT NULL, PRIMARY KEY (strategy_id, symbol))` — upserted on every live-loop exit,
  read once at boot to hydrate in-memory cooldown state (mirrors the existing `strategy_scores`
  hydrate-at-boot pattern). **Backtests never read or write this table** (FR-7).

## Feature Workflow Notes

Branch to create: `feature/strategy-reentry-cooldown` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] Service owner approval from each affected service (non-breaking proto field addition + new
  config key; `xstockstrat-analysis`, `xstockstrat-agent`, `xstockstrat-ui` all affected, none
  breaking)
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable, additive field only
- [x] DBA review + service owner (schema migration) — new `008_strategy_cooldowns` migration
  (FR-8/Database Changes); up+down pair required per `docs/runbooks/feature-workflow.md`

## Acceptance Criteria

1. Registering/updating a strategy with `cooldown_days` set persists and round-trips the value via
   `ManageStrategy`; a negative value is rejected with `INVALID_ARGUMENT`.
2. A strategy with `cooldown_days` **unset** (no proto presence) uses
   `analysis.strategy.default_cooldown_days` (31) as its effective cooldown; a strategy with
   `cooldown_days` **explicitly `0`** has no cooldown (immediate re-entry allowed) — the two are
   distinct, per FR-1's explicit-presence semantics.
3. Backtest: given a symbol whose entry condition is true again the bar immediately after an exit,
   no new entry is recorded until at least the effective cooldown's worth of calendar days (by bar
   timestamp) have elapsed since that exit; this is covered by a unit test reproducing the WSM-style
   whipsaw shape (exit, entry-condition-still-true next bar, no re-entry until cooldown elapses).
4. Live loop: the same `(strategy_id, symbol)` cooldown gate suppresses an entry trigger within the
   cooldown window, verified by a test analogous to the backtest one.
5. A backtest re-run of the `range_mean_reversion_v2`/`v3` shadow strategies (or an equivalent
   synthetic fixture reproducing the WSM trade sequence) with the wash-sale-safe default cooldown
   shows no immediate re-entry into a symbol within 31 calendar days of exiting it.
6. `docs/patterns/config-governance.md` and `services/xstockstrat-analysis/CLAUDE.md` are updated
   with the new config key per the existing config-key documentation convention.
7. Restart durability: a live-loop exit is followed by a simulated service restart (state
   re-hydrated from `analysis.strategy_cooldowns`); the cooldown gate still suppresses entry until
   the full `cooldown_days` window has elapsed, proving the cooldown is not reset by the restart.
8. Reproducibility: two separate `RunBacktest` calls for the same strategy/symbol (or a backtest
   run interleaved with a live-loop exit on the same symbol) produce identical backtest results —
   proving backtest cooldown state never reads the live loop's persisted store (FR-7).
9. A strategy's cross-stock score definition fingerprint changes when its `cooldown_days` changes
   (FR-9), verified by a test asserting `_definition_fingerprint` differs across two otherwise-
   identical definitions that differ only in `cooldown_days`.
10. Agent: calling `manage_strategy(operation="register"|"update", ..., cooldown_days=N)` persists
    `N` and it round-trips on a subsequent read (FR-10); `docs/runbooks/mcp-tools.md`'s
    `manage_strategy` parameter table lists `cooldown_days`.
11. UI: creating or editing a strategy through `StrategyWizard.tsx` with a cooldown value set
    persists it end-to-end (FR-11), covered by a Playwright e2e case in `e2e/insights/` alongside
    existing strategy-wizard coverage. **Presence round-trip (per FR-1 explicit-presence semantics):**
    leaving the field **blank** omits the key from the payload → the field stays **unset** → the
    effective default (31) drives the gate; typing an explicit **`0`** persists `cooldown_days: 0`
    (present) → no cooldown. The e2e must assert blank→omitted-and-default-behavior and `0`→present,
    and must NOT assert `0 → 31` (the superseded collapse). Editing a pre-existing (unset) strategy
    and saving an unrelated change must NOT silently write `cooldown_days: 0`.

## Open Questions

- [ ] Exact index/column shape for `analysis.strategy_cooldowns` (Database Changes proposes a
  minimal `(strategy_id, symbol)` primary key with `last_exit_at`; confirm at `/sdd-design` whether
  any additional column — e.g. an explicit `cooldown_days` snapshot at exit time, in case the
  strategy's cooldown setting changes mid-window — is needed, or whether re-reading the live
  `StrategyDefinition.cooldown_days` at check time is sufficient).
- [ ] Upsert/write path for FR-8: should the live loop write `strategy_cooldowns` synchronously on
  every exit transition (in `live_loop.py`, alongside `_last_state` update), or via the same
  best-effort deferred pattern used for ledger emits — confirm at design time.
