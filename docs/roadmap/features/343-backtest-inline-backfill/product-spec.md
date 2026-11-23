# Product Spec: backtest-inline-backfill

**Created**: 2026-11-15

---

## Problem Statement

When a backtest on the symbol page returns insufficient data ("has 53, needs 200 bars"), the trader is told to switch to the Backfill coverage tab, ingest, and re-run by hand. That tab's trigger is admin-only and always requests full history, ignoring the exact missing range the backtest response already carries.

## User Story

As a trader, I want to backfill the data a backtest is missing directly from its insufficient-data message and then re-run it, so that I can get a result without leaving the Backtests card.

## Functional Requirements

FR-1. The insufficient-data state of the symbol page Backtests card offers a "Backfill missing data" action.
FR-2. The action requests a daily-bars backfill for the symbol from the start of the missing range reported by the backtest (`coverage_gaps[].gap`) through the end of the backtest window, fetching missing bars only (gaps-only, no overwrite), not full history. _(Amended 2026-11-15, operator at the design gate, design.md D-8; it was "over exactly the missing range".)_
FR-3. While the backfill runs, the card shows its progress inline and the action cannot be triggered again.
FR-4. When the backfill completes, the card shows a "data ready" state with a "Re-run backtest" action; the backtest is not re-run automatically.
FR-5. When the backfill fails, is partial, or is canceled, the card says so, with the job's error when one is reported, and offers the backfill action again.
FR-6. The action is available to every authenticated user, not only admins.
FR-7. **Fallback (operator-directed, 2026-11-15)**: if design finds that FR-6 requires extensive change, FR-1…FR-6 are dropped and the section instead shows strategy scores only, defaulting to "Not enough data" with no actions. _(Not taken: the operator chose FR-6 through the bounded self-serve envelope at the design gate, 2026-11-15, design.md R-6. @AC-8 is struck.)_

## Out of Scope

- Fundamentals or signal backfills (bars only)
- Changing the Backfill coverage tab's own trigger
- Suppressing the stored "No data" history row (persisted by design)
- A configurable backtest window (stays 2024 / $100k)

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-ui` — Backtests card inline action, progress, re-run state
- `xstockstrat-ingest` — `TriggerBackfill` authorization: admin, or the bounded self-serve envelope with per-symbol de-duplication (design.md)
- `xstockstrat-config` — seed migration for the new `ingest` key `backfill.self_serve_max_range_days` (added at /sdd-spec from design.md § Config)
- `xstockstrat-agent` — `trigger_backfill` tool wording, runbook and `strat-lab` skill parity (added at /sdd-spec from design.md § Consumer surfaces)

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` segment `/trader`: symbol page (`/trader/positions/[symbol]`) Analysis → Backtests card — existing route, new control
- [x] **UI** — `xstockstrat-ui` segment `/insights`: strategy page (`/insights/strategies/[id]`) "Backfill this range" button — existing control, opened to every signed-in user (operator, design gate, 2026-11-15; design.md D-10)
- [x] **Agent** — `trigger_backfill` now succeeds for a non-admin caller inside the self-serve envelope (FR-6 chosen). The tool wording, `docs/runbooks/mcp-tools.md` and the `strat-lab` plugin's `backtest` skill change in the same PR (`docs/patterns/strat-lab-plugin.md`). Ticked at /sdd-spec as design.md directs
- [ ] **None**

## Proto Contract Changes

- [x] No proto changes required — confirmed in design: the existing `TriggerBackfill` / `GetBackfillStatus` RPCs carry every field

## Config Key Changes

- [ ] No new config keys
- [x] One new key (design.md § Config; C-05, F-07): namespace `ingest`, key `backfill.self_serve_max_range_days`, `value_type` int, code default and seed 730, reader `services/xstockstrat-ingest/app/config/watcher.py:backfill_self_serve_max_range_days` (`int_positive`), seeded by a config migration, live through `WatchConfig`. `backfill.max_concurrent_jobs` keeps default and seed 3; only the homelab value changes, through `SetConfig`

## Database Changes

- [x] No schema changes — confirmed in design. The only migration is the config seed row for the new key (data, not schema)

## Feature Workflow Notes

Branch to create: `feature/backtest-inline-backfill` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change) — the new config key also needs the config team (root `CLAUDE.md` § Approval Flow)
- [ ] 2 service owners + platform lead (breaking proto change)
- [ ] DBA review + service owner (schema migration)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [x] **FR-6 vs FR-7 (design gate)** — resolved as a process decision (operator, 2026-11-15): FR-6 is attempted first and FR-7 is the fallback. The operator set the fallback but not the threshold for "a lot of changes", so `design.md` must present the cost of opening `TriggerBackfill` to non-admins (range/symbol bounds, per-user concurrency or rate limits, vendor-quota exposure, ledger/audit attribution) and the operator picks FR-6 or FR-7 at the design gate; design never chooses silently. @AC-1…@AC-7 and @AC-9 are authoritative if FR-6 is chosen, @AC-8 if FR-7 is chosen; the losing scenarios are struck, not renumbered.
- [x] If FR-7 is taken: which "strategy scores" the section shows — resolved: the backtest score per strategy for the symbol, "Not enough data" where none exists, no actions (@AC-8). The source must be an existing RPC (no proto change); design names it.
- [x] `strat-lab` skill — resolved, a binding constraint rather than a question: if the admin gate on `TriggerBackfill` changes, the `strat-lab` plugin's `backtest` skill is updated in the same PR (`docs/patterns/strat-lab-plugin.md`).
- [x] Does a gate like `marketdata.fundamentals.history.enabled` block a bars backfill? — resolved, no: that key is read only in `BackfillFundamentals` (`services/xstockstrat-marketdata/internal/service/marketdata_service.go:2269`); `BackfillBars` (`:1477`) reads no enable flag, and the ingest backfill path has none.
- Known trap (ledger, `backfill-management-ui`): when the spec offers alternative branches, run the existing suite before committing to one; the e2e at `e2e/trader/position-detail.spec.ts:337` asserts the current "Backfill coverage panel" sentence.
