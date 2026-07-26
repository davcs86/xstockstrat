# Product Spec: backtest-result-attachment

**Created**: 2026-07-26

---

## Problem Statement

The `run_backtest` MCP tool returns the **entire** `BacktestResult` inline. `client.run_backtest`
(`services/xstockstrat-agent/app/client.py:166-175`) serialises the whole proto with
`MessageToDict(..., always_print_fields_with_no_presence=True)`, which includes the per-symbol
`diagnostics` added by feature 064 — a day-by-day row per bar (OHLCV, every computed indicator value,
warm-up flag, entry/exit/conviction decision) for **every simulated symbol**. A five-symbol backtest
over the default ~504-trading-day window is on the order of 2,500 bar rows, all delivered as one
inline payload that the model then renders as prose. It is unreadable for a human, and it consumes an
enormous share of the agent's context for data that is mostly only needed on demand.

**Grounding (verified, not assumed):**
- The MCP Python SDK in use (`mcp>=1.0.0`, `mcp.server.FastMCP`) exposes `EmbeddedResource`,
  `ResourceLink`, `BlobResourceContents` and `TextResourceContents`, so an attachment-style return is
  supported by the protocol.
- **All thirteen current tools return plain `dict`/`str`** — this would be the agent's first
  non-text tool result, so there is no in-repo precedent to copy.
- Transport is Streamable HTTP (MCP 2025-03-26) plus SSE
  (`services/xstockstrat-agent/app/main.py:50-98`).

## User Story

As a strategy author driving backtests through the MCP agent, I want the full result delivered as an
attached file with only a compact summary inline, so that I can read the outcome at a glance and open
the detail when I actually need it — instead of scrolling thousands of lines of bar-by-bar prose.

## Functional Requirements

FR-1. `run_backtest` MUST return a **compact inline summary** plus an **attachment** carrying the full
detail, rather than one large inline payload.

FR-2. The inline summary MUST remain sufficient to diagnose the common failure case **without**
opening the attachment. It MUST retain at minimum: `backtest_id`, `status`, the headline metrics
(`total_return`, `sharpe_ratio`, `max_drawdown`, `win_rate`, `total_trades`, `profit_factor`,
`initial_capital`), any `coverage_gaps`, and **per symbol** its `no_trade_reason`, `bars_total` and
`warmup_bars`.

> This requirement exists to protect feature 064. The current `run_backtest` docstring
> (`services/xstockstrat-agent/app/tools.py:252-255`) states the diagnostics are returned so the agent
> can "explain why a strategy produced 0 trades and suggest changes to the strategy or its
> indicators." Moving *everything* into an opaque attachment would regress that capability, because
> the model cannot read an attachment it has not fetched. The per-symbol `no_trade_reason` +
> `warmup_bars` fields are precisely the 0-trade diagnosis, so they stay inline.

FR-3. The attachment MUST carry the full `BacktestResult` — including the complete per-bar
`diagnostics` for every symbol and the full `trades` list — in a machine-readable format, with no
loss of fidelity versus today's inline payload.

FR-4. The attachment MUST be delivered through an MCP-native mechanism (`EmbeddedResource` or
`ResourceLink` — chosen at design, see OQ-1), not by writing to a local path. The agent is a remote
service; a filesystem path is not reachable by the client.

FR-5. **Graceful degradation.** Client rendering of MCP resources is client-dependent and outside
this platform's control. If a client does not surface an attachment affordance, the inline summary
(FR-2) MUST still stand on its own as a usable result. The design MUST state this assumption
explicitly rather than presuming a download UI exists.

FR-6. The `run_backtest` tool docstring and `docs/runbooks/mcp-tools.md` (§`run_backtest`, parameter
and return-shape documentation at `:241-257`) MUST describe the new return shape and what lives
inline versus in the attachment.

## Out of Scope

- Any change to backtest math, scoring, fills, or sizing — this is purely a **return
  representation** change in the agent layer.
- Changing the return shape of the other twelve MCP tools (a shared helper may be introduced, but
  retrofitting other tools is a separate decision).
- Any `xstockstrat-ui` change. The UI calls `RunBacktest` over its own BFF and is unaffected.
- Persisting anything new: feature 068 already stores every OK run's full result (see OQ-1).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-agent` — **the only service that changes.** `run_backtest` tool
  (`app/tools.py:239-260`) and its client wrapper (`app/client.py:143-175`).

No change to `xstockstrat-analysis`: the full `BacktestResult` already arrives over the wire; this
feature only changes how the agent presents it.

## Proto Contract Changes

- [x] No proto changes required
- The agent already receives the complete `BacktestResult` (`analysis.proto:64-83`). Nothing new is
  needed on the wire. Note that message's persisted-verbatim warning (`analysis.proto:60-63`) — a
  reason **not** to reshape it for presentation purposes.

## Config Key Changes

- [x] No new config keys
- The chosen split is unconditional (summary inline, detail attached), so no size/bar-count threshold
  tunable is required. A threshold-based variant was explicitly rejected at story time precisely
  because it would need a config key and give the tool two response shapes to test.

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/backtest-result-attachment` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval — behavior change confined to `xstockstrat-agent` (no proto, no
  config, no migration)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A, no proto change
- [ ] DBA review + service owner (schema migration) — N/A

## Acceptance Criteria

Each criterion below **fails on unmodified `main-dev`**, where `run_backtest` returns one inline dict
containing every diagnostic bar.

1. A multi-symbol `run_backtest` call returns an inline payload that does **not** contain per-bar
   `diagnostics` or the full `trades` list, and is a small bounded size regardless of window length or
   symbol count.
2. The same call returns an attachment whose content round-trips to the **complete** `BacktestResult`,
   byte-for-byte equivalent in information to today's inline payload (FR-3).
3. A 0-trade run can still be diagnosed from the inline summary alone: `no_trade_reason`,
   `bars_total` and `warmup_bars` are present per symbol (FR-2 / feature-064 regression guard).
4. An `INSUFFICIENT_DATA` run still surfaces its `coverage_gaps` inline.
5. The `run_backtest` docstring and `docs/runbooks/mcp-tools.md` describe the split return shape.
6. The tool inventory count is **unchanged** — this modifies an existing tool and adds none, so
   `tests/test_tools_endpoint.py`'s name-set assertion and the five "thirteen tools" surfaces must
   **not** change. (Stated as a criterion because feature 066's lesson makes "did the count move?" a
   reflex check.)

## Open Questions

- [ ] **OQ-1 — `EmbeddedResource` vs `ResourceLink` (design phase).** This is the load-bearing
  decision, because it determines whether the feature actually solves the problem. An
  `EmbeddedResource` still ships the full bytes in the tool result; if the client inlines that into
  the model's context, the payload is *relabelled but not reduced* and FR-1's intent is defeated. A
  `ResourceLink` genuinely defers the bytes until read. **Strong reuse candidate:** feature 068
  already persists every OK run's full serialized result (`analysis.backtest_details`) and serves it
  via the `GetBacktest(backtest_id)` RPC (`analysis.proto:21`), so a link could resolve through an MCP
  resource backed by `GetBacktest` — **no new storage, retention, or TTL needed**. Design must also
  cover the `INSUFFICIENT_DATA` case, which feature 068 may not persist.
- [ ] **OQ-2 — attachment format (design phase).** `diagnostics` is strongly tabular (one row per
  bar), so CSV is dramatically more compact than nested JSON; but `BacktestResult` as a whole is
  nested. Options include JSON for the envelope, CSV for the per-bar table, or both. Fidelity
  (FR-3) is the constraint, compactness the goal.
- [ ] **OQ-3 — does the attachment need auth?** If OQ-1 lands on `ResourceLink`, the resource read
  path must carry the same OAuth 2.1 / scope treatment as the tool call itself
  (`app/main.py:8`), not become an unauthenticated side channel.
- [ ] **Known trap (ledger C-10, fails 056/060/067):** this changes a **shared consumer surface** —
  the tool docstring and `docs/runbooks/mcp-tools.md` must move in the same PR with a test. The tool
  *count* does not change, so the five-surface inventory rule from feature 066 does **not** fully
  apply here; AC-6 pins that explicitly.
- [ ] **Merge overlap with feature 071.** `071-backtest-time-window` also edits
  `app/tools.py` `run_backtest`, `app/client.py` `run_backtest`, and the same
  `docs/runbooks/mcp-tools.md` section — 071 changes the tool's **inputs** (`start`/`end`), this
  changes its **output**. No field, key, or migration collision; a rebase-only textual overlap.
  Whichever lands second rebases. Recorded in `merge-order.md`.
- [ ] **Registry gap (process, not blocking):** `docs/runbooks/reviewer-registry.md` has **no
  `xstockstrat-agent` row** in its Service Owners table, so the reviewer focus below is inferred
  rather than registry-sourced. Features 070 and 071 have the same gap. Worth a separate one-line
  registry addition.
