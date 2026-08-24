# Product Spec: market-regime-benchmark-operand

**Created**: 2026-08-24

---

## Problem Statement

Strategy rule operands resolve **only against the evaluated symbol's own bars**, so a control like
"don't buy dips when the broad market is sick" — inherently cross-symbol — cannot be expressed today.
OOS validation of `dip_buyer_vol_stop` over three non-overlapping years showed a −19.23% / −1.26
Sharpe year (2024-08→2025-08) that a per-symbol rising-200-day gate did **not** fix (it removed 1 of
64 entries, because each name's own 200-day was still rising while the *market* chopped). The correct
gate is on the broad market, which requires a benchmark/reference-symbol operand.

## User Story

As a strategy author, I want a component to be computed on a fixed reference symbol (e.g. VOO)
instead of the evaluated symbol, so that I can gate entries/exits on broad-market regime (e.g. "buy
dips only when VOO's 200-day is rising") across any evaluated symbol.

## Functional Requirements

FR-1. A strategy component accepts an optional `source_symbol`. **Omitted / empty → computed on the
evaluated symbol's bars (today's behavior, byte-identical).** Set to a ticker → computed on that
ticker's bars.

FR-2. A `source_symbol` component's **output series** is left-joined onto the **evaluated symbol's**
trading-day (timestamp) index. Missing benchmark bars (differing halt/holiday calendars, ADRs) are
**gaps, not forward-filled**; a rule referencing a gapped benchmark bar evaluates to **hold/false**
for that bar. The evaluated symbol is never reindexed to the benchmark (its own bars are never
dropped). No look-ahead: the benchmark value at bar *t* uses only benchmark data ≤ *t*.

FR-3. The component is computed on the benchmark's **own** series first, and the **output** is then
aligned — never align raw benchmark closes then compute (that corrupts rolling windows across gaps).
Benchmark bars are fetched from before `start` with the same warmup guarantee as the evaluated
symbol, preserving the reproducible-window (explicit start+end → identical numbers any day)
guarantee.

FR-4. If a benchmark lacks enough history to warm its component, the run reports
`BACKTEST_STATUS_INSUFFICIENT_DATA` with the **benchmark** symbol named in `coverage_gaps` (reusing
the existing coverage-gap path). Applies to **entry_rule and exit_rule** identically.

FR-5. `manage_strategy` accepts `source_symbol` on components, normalizes it to uppercase, treats
empty-after-trim as unset, and includes `source_symbol` in the definition **fingerprint** (changing
the benchmark clears the derived grade). Reference resolution of `ref_name` in rules is unchanged.

FR-6. **Live-eval is wired (operator decision 2026-08-24).** The benchmark load+align path is
implemented in the live evaluator (`live_loop.py`) too, so a benchmark-referencing strategy can be
enabled live and evaluated correctly. The live path must apply the same warmup-from-before-start and
gap→hold/false semantics as backtest; a benchmark lacking live-window history must degrade safely
(the benchmark component reads as a gap → entry conditions hold/false), never crash the live loop.
Live alerting deltas that touch `xstockstrat-notify` behavior require explicit sign-off before wiring.

## Out of Scope

- **v2 true breadth** — a universe aggregate (e.g. % of a named universe above its 200-day) requires
  a cross-sectional precompute/service and a universe definition. Deferred; note in `_tasks/`-equivalent
  follow-up. v1's benchmark operand covers the motivating case.
- **`screen_symbols` `source_symbol`** — technical screening criteria could also gain it; deferred to
  keep this change bounded. Note as a follow-on.
- **Live alerting wiring into `xstockstrat-notify`** — not touched without explicit sign-off (see FR-6).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `packages/proto` — additive `string source_symbol` field on the `Component` message.
- `xstockstrat-analysis` — benchmark bar loading + output alignment in the backtest engine (and the
  live evaluator per FR-6 decision); coverage-gap routing; definition fingerprint.
- `xstockstrat-agent` — `manage_strategy` write-path validation (accept/normalize `source_symbol`,
  fingerprint) and the dict→proto request builder must carry the new field; `run_backtest` exercises
  it. **`strat-lab` plugin `backtest` skill must update in the same PR** (root CLAUDE.md rule).

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **Agent** — `xstockstrat-agent` MCP tools: `manage_strategy` (accepts `source_symbol` on a
  component), `run_backtest` (backtests a benchmark-referencing strategy), and `set_strategy_live`
  (rejects with `FAILED_PRECONDITION` if live isn't wired — FR-6). This is the primary surface the
  capability is authored and consumed through.
- [ ] **UI** — `xstockstrat-ui` strategy view: rendering/editing `source_symbol` in the strategy
  builder is a **deferred follow-up** (named: `strategy-builder-source-symbol`), pending confirmation
  the UI has an editable component form. Agent-authored strategies are fully functional without it.
- [ ] **None**

## Proto Contract Changes

- [x] Add `string source_symbol = <next_free_tag>;` to the `Component` message (optional; empty =
  evaluated symbol). Additive optional string → **non-breaking**; `buf breaking` must pass clean.
- Regenerate stubs via `./scripts/buf-gen.sh`; commit `packages/proto/gen/{go,python,ts}`.

## Config Key Changes

- [x] No new config keys.

## Database Changes

- [x] No schema changes. (Strategy definitions are stored as-is; the new field rides in the existing
  definition blob — to be confirmed at design/spec time against the analysis strategy store.)

## Feature Workflow Notes

Branch to create: `feature/market-regime-benchmark-operand` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md and root approval table):
- [x] 1 service owner approval (non-breaking proto field addition — `xstockstrat-analysis` owner)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A, additive
- [ ] DBA review + service owner (schema migration) — N/A, no migration

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [x] **Live-eval decision (FR-6) — RESOLVED 2026-08-24:** operator chose to **wire live-eval too**.
  The live evaluator gets the benchmark load+align path. `set_strategy_live` is therefore NOT a hard
  reject; instead the live loop must load+align the benchmark safely (gap→hold/false on missing live
  history). Live alerting behavior changes that touch `xstockstrat-notify` still require sign-off.
- [ ] **Known trap (Ledger F-12 / RC-1, 2026-08-02):** the agent's hand-written dict→proto request
  builders silently drop new proto fields, and tool docs/`strat-lab` skill drift. Any `source_symbol`
  addition must (a) be carried through the `manage_strategy` request builder, (b) be pinned by a
  parity test, and (c) update the `strat-lab` skill in the same PR.
- [ ] **Known trap (Ledger, 2026-08-06 backtest-debug-info):** the real marketdata bar field is
  `bar.time`, not `bar.timestamp`; benchmark-alignment code and its tests must use real `Bar` proto
  instances (not `MagicMock`) so wrong-attribute bugs surface.
