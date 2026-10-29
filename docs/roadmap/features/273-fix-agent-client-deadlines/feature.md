# Feature: fix-agent-client-deadlines

**Type**: bug
**Development Branch**: `feature/fix-agent-client-deadlines`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-agent-client-deadlines-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-29

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-agent-client-deadlines-defect.md` (debt-radar D-16, minus the `get_config_value` call covered by feature 247) |
| 2026-10-21 | `draft` → `spec-ready` | /sdd-review | Product spec approved (7 warnings; overlap WARN: same-file with 247, 215, 241, 249) |
| 2026-10-22 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + design.md written. Operator r3 additions: FR-6/@AC-11 (ValidateToken deadline), 503 without WWW-Authenticate on identity stall, widened 272 pass-through |
| 2026-10-22 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 12 steps |
| 2026-10-29 | `implementation-ready` (no change) | /sdd-execute (re-spec) | Steps 2, 3, 6, 7, 8 and 11 re-anchored to the post-247 `main-dev` merge; BacktestResult cite fixed (`analysis.proto:123`); Step 11 now only rewords the existing 272 merge-order row |
| 2026-10-29 | `implementation-ready` → `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Up-front confirmation by operator standing authorization (session_01NpS3HShZK6pSnogA7CFo2f, 2026-10-28/29) |
| 2026-10-29 | `in-progress` (no change) | /sdd-execute sequential | Step 1 done: Tempo baseline recorded. ValidateToken p99 ≤134 ms (passes R5). The four long RPCs have 0 dev spans in 24 h, so `Baseline verdict: HALT` gates Step 3's commit pending operator sign-off |
| 2026-10-29 | `in-progress` (no change) | /sdd-execute sequential | Step 2 done: `hung_backend` fixture in conftest; `test_client_deadlines.py` with @AC-5 (live + kwarg) and @AC-10 AST guard, RED pending Step 3 |
| 2026-10-29 | `in-progress` (no change) | /sdd-execute sequential | Step 3 done: `_RPC_TIMEOUT_S = 10.0` / `_LONG_RPC_TIMEOUT_S = 45.0` and `timeout=` on 71 agent client calls (67 RPC, 4 LONG); R1 HALT overridden by operator sign-off; three capture stubs widened (operator scope expansion) |
| 2026-10-29 | `in-progress` (no change) | /sdd-execute sequential | Step 4 done: five `_grpc_error_message` tests (write tail, read retry text, 272 server-detail pass-through, client sentinel, write without deadline); 3 RED pending Step 5, 227 tests unchanged |
| 2026-10-29 | `in-progress` (no change) | /sdd-execute sequential | Step 5 done: `_grpc_error_message` gains keyword-only `write` (the "outcome unknown, verify before retrying" tail) and passes through non-sentinel server DEADLINE_EXCEEDED details (272); 227 text byte-identical |
| 2026-10-29 | `in-progress` (no change) | /sdd-execute sequential | Step 6 done: `tests/test_tool_deadlines.py` (@AC-1..4, @AC-6..9, FR-3 arithmetic, catch-site `deadline_s`/`write` AST guards, six-wrap mapping); 14 RED pending Step 7 |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-spec time (2026-10-22).

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-agent` owner | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; error surfacing for `DEADLINE_EXCEEDED` | 2, 3, 4, 5, 6, 7 |
| `xstockstrat-agent` owner | OAuth 2.1 edge-auth correctness and statelessness (no in-memory store — `instance_count > 1` must stay safe) | 8, 9 |
| none | docs steps | 1, 10, 11, 12 |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — approved design, rejected alternatives, open risks (Phase 1)
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Of the agent's 71 unary backend RPCs in `client.py`, only `ListOpportunities` has a deadline (and `get_config_value`
is being fixed by feature 247); every other call hangs an MCP tool indefinitely when a backend stalls.

## Next Action

`/sdd-review fix-agent-client-deadlines impl-spec` — validate implementation spec, then `/sdd-execute fix-agent-client-deadlines` (only after 247 has merged to main-dev and this branch is rebased)
