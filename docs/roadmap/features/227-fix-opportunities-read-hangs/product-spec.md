# Product Spec: fix-opportunities-read-hangs

**Type**: bug
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-14-opportunities-read-hangs-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-14

---

## Problem Statement

**Observed.** On staging, `list_opportunities` (agent MCP tool → analysis `ListOpportunities`) times out at the 60s
client limit on every call, including `page_size=5`. Nothing is logged in agent, analysis or marketdata. Other
analysis RPCs answer promptly at the same time. The shared Postgres cluster is saturated: load 7–9 on 1 vCPU since
2026-10-14 14:45 UTC.

**Expected.** The read returns within a bounded time:
- Live-price enrichment that cannot complete in time degrades to unenriched rows, per the existing "unavailable
  values are omitted" contract.
- A read that cannot complete fails fast with a gRPC status and a log line.

## Reproduction Steps

1. On staging, call the agent MCP tool `list_opportunities` with `page_size: 5` while the DB is under load.
2. The client times out at 60s, and no error or log line appears in any service.

## Root Cause Hypothesis

**Confirmed in code:**
- No deadline on agent → analysis `ListOpportunities` (`services/xstockstrat-agent/app/client.py:862`).
- No deadline on analysis → marketdata `BatchGetLatestPrice` (`services/xstockstrat-analysis/app/handlers/servicer.py:4368`).
- No asyncpg acquire or command timeout in analysis.
- marketdata `BatchGetLatestPrice` discards every error (`marketdata_service.go:754`, `:774`, and the per-symbol fallback).

**Not confirmed** (errors are discarded and OTel export is down): which dependency stalls. It is either the DB
(saturated cluster, full-queue LATERAL reads not bounded by `page_size`) or marketdata/Alpaca.

## Affected Services

xstockstrat-agent, xstockstrat-analysis, xstockstrat-marketdata

## Fix Scope

- [ ] No proto changes anticipated
- [ ] No database migrations anticipated
- [ ] Config key changes possible (timeout values should be config, not hard-coded — decided in design)

(Update after investigation — remove or replace each item as needed)

## Operator-chosen fix direction (2026-10-14)

1. A deadline on the agent → analysis `ListOpportunities` call.
2. A deadline on analysis → marketdata `BatchGetLatestPrice`. On timeout, return the stored rows unenriched.
3. Log the errors marketdata `BatchGetLatestPrice` currently discards.
4. Bound the analysis DB pool acquires.

## Acceptance Criteria

See `acceptance.feature`: the regression scenario(s) that must fail on the buggy behavior and pass after the fix
(Constitution **C-15**). Also, existing tests pass, and the staging `list_opportunities` call returns or fails fast.

## Out of Scope

- **DB capacity.** Resizing the shared cluster is an operator decision, recorded in the defect report.
- **The OTel export failure.** It is a separate defect.
- **Query-plan optimisation of the opportunities read**, unless design finds it necessary for the bound.
- Refactoring unrelated to the bug.
