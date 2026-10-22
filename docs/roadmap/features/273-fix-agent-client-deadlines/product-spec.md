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
- [ ] No config key changes anticipated — open: design decides whether long-running budgets are code constants (like
  `_POLICY_READ_TIMEOUT_S` / 247's `_CONFIG_READ_TIMEOUT_S`) or `agent.*` config keys; a key is unsuitable for the
  config read itself (circular, per 247)

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- `get_config_value` → `GetConfig` (`client.py:1751`) — feature `247-fix-agent-getconfig-deadline`
- Changing the `ListOpportunities` deadline or the feature-227 `wait_for` (`tools.py:1551`)
- Channel caching/reuse (the other half of D-16's suggested LOE) unless design shows it is needed to place the
  deadline; it is a performance change, not the bug
- Backend-side hang causes (e.g. config await-outside-try, feature `258-fix-config-stream-resilience`)
- Refactoring unrelated to the bug
