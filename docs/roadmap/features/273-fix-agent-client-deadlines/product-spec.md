# Product Spec: fix-agent-client-deadlines

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-21-agent-client-deadlines-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21

---

## Problem Statement

Source: repo-surveyor debt-radar scan @ 4535695, finding D-16 (re-verified on main-dev @ a053b0e). The
`get_config_value` → `GetConfig` call (`services/xstockstrat-agent/app/client.py:1751`) is covered by feature
`247-fix-agent-getconfig-deadline` and is **excluded**; this feature covers every other agent → backend RPC.

**Observed.** `services/xstockstrat-agent/app/client.py` opens a fresh `mtls.secure_channel` per call (69 sites) and
issues 71 unary stub calls; only `ListOpportunities` (`:866-872`) passes `timeout=`. `mtls.secure_channel`
(`services/xstockstrat-agent/app/mtls.py:37-43`) sets no deadline or keepalive. A backend that accepts but never
answers (stalled handler, stuck DB pool, paused process) blocks the MCP tool until the MCP client times out, with no
`DEADLINE_EXCEEDED` surfaced. Examples: `IngestSignal` `:242`, `EmitAlert` `:282`, `RunBacktest` `:634`,
`ScreenSymbols` `:746`, `RunFundamentalsScan` `:1712`, `TriggerBackfill` `:1949`, the `get_config` tool's
`GetConfig` `:2043`.

**Expected.** Every agent → backend unary RPC has a bounded deadline: a default for ordinary reads/writes and
explicit larger budgets for long-running RPCs (`RunBacktest`, `TriggerBackfill`, `RunFundamentalsScan`,
`ScreenSymbols`), each inside the MCP request timeout (PLAT-13). A stall surfaces as a clear tool error derived from
`DEADLINE_EXCEEDED`.

## Functional Requirements

Budget values are grounded on the MCP client's 60 s request timeout (`services/xstockstrat-agent/CLAUDE.md`,
`agent.opportunities.read_timeout_seconds` row; feature 227) and the 3.0 s `_POLICY_READ_TIMEOUT_S` precedent
(`services/xstockstrat-agent/app/tools.py:2371`). Design may revise a value only by amending this section.

- **FR-1 — Default deadline.** Every agent → backend unary RPC in `services/xstockstrat-agent/app/client.py` that is
  not listed in FR-2, other than the excluded `get_config_value` call (see Out of Scope), carries a deadline of
  **10 seconds**. This includes the `get_config` tool's `GetConfig` (`client.py:2043`) and `register_oauth_client`
  (`client.py:1355`).
- **FR-2 — Long-running budgets.** `RunBacktest`, `TriggerBackfill`, `RunFundamentalsScan` and `ScreenSymbols` each
  carry an explicit deadline of **45 seconds** in place of the default. A call that finishes inside 45 s succeeds
  unchanged.
- **FR-3 — Nested inside the MCP request timeout (PLAT-13).** For every MCP tool, the worst-case wall-clock of one
  invocation (the sum of the deadlines of its sequential backend calls) stays at least 3 s under the MCP client's
  60 s request timeout. A tool that issues several sequential calls (for example `ingest_signal` →
  `IngestSignal` + `EmitAlert`) must bound its total. Design chooses how.
- **FR-4 — Stalls surface as tool errors.** When a deadline expires, the MCP tool returns an error derived from
  gRPC `DEADLINE_EXCEEDED`. The error says that the upstream did not respond within the deadline, and the tool does
  not hang. The `list_opportunities` wording from feature 227 is the precedent.
- **FR-5 — No behavior change on the happy path.** A backend that answers within its deadline produces the same
  tool result as before the fix.

## Consumer Surface(s)

- **MCP Agent tools** (`services/xstockstrat-agent/app/tools.py`): every tool that reaches a backend through
  `app/client.py`, for example `get_positions`, `ingest_signal`, `emit_alert`, `run_backtest`, `screen_symbols`,
  `trigger_backfill`, `run_fundamentals_scan` and `get_config`. The observable change: a stalled backend now
  produces a bounded `DEADLINE_EXCEEDED`-derived tool error instead of a hang until the MCP client times out
  (FR-4). The happy path does not change (FR-5).
- No UI, proto or REST surface changes.

## Reproduction Steps

1. Stall a backend handler (`kill -STOP` the portfolio process, or a fake gRPC server that never replies).
2. Call `get_positions` via MCP; it never returns until the MCP client gives up.
3. Static: `grep -n "timeout=" services/xstockstrat-agent/app/client.py` → only `:872`.

## Root Cause Hypothesis

Per-call "open channel, call, close" blocks with no shared call helper; deadlines were added only at call sites with
a reported hang (features 227, 247).

## Affected Services

- xstockstrat-agent

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated. Resolved: the FR-1/FR-2 budgets are fixed code constants, following the
  `_POLICY_READ_TIMEOUT_S` / 247 `_CONFIG_READ_TIMEOUT_S` precedent. A config key cannot bound the config read itself
  (circular, per 247), and no operator need to tune them has been shown. Design may propose `agent.*` keys only by
  amending this spec. Any such key must follow `<service>.<category>.<key>` (C-05), for example
  `agent.rpc.default_timeout_seconds`, and goes through the new-config-key approval gate.

**Scope ownership with feature 247.** 247 owns only `get_config_value` → `GetConfig` (`client.py:1751`). This feature
owns every other undeadlined call site, including `get_config` (`client.py:2034-2046`) and `register_oauth_client`
(`client.py:1355`). The follow-up `agent-rpc-deadlines` defect report that 247 plans for those two sites is
superseded by `docs/reports/2026-10-21-agent-client-deadlines-defect.md`, so 247 should not file it. Reconcile at
247 execute. Sequencing: 247 merges first and this feature rebases. This feature reuses 247's constant style and
does not re-edit 247's call site.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- `get_config_value` → `GetConfig` (`client.py:1751`, the internal `agent.*` policy read) is owned by feature
  `247-fix-agent-getconfig-deadline`. The separate `get_config` MCP tool's `GetConfig` (`client.py:2043`) is **in**
  scope (FR-1, @AC-2).
- Changing the `ListOpportunities` deadline or the feature-227 `wait_for` (`tools.py:1551`)
- Channel caching/reuse (the other half of D-16's suggested LOE) unless design shows it is needed to place the
  deadline; it is a performance change, not the bug
- Backend-side hang causes (e.g. config await-outside-try, feature `258-fix-config-stream-resilience`)
- Refactoring unrelated to the bug
