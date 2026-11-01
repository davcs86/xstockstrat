# Feature: fix-agent-getconfig-deadline

**Type**: bug
**Development Branch**: `feature/fix-agent-getconfig-deadline`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-19-agent-get-config-value-no-deadline-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20
**Last Updated**: 2026-10-29
**Committed to main**: df521ff51091a86e813950b34afff09ac4e8821b
**Launched date**: 2026-10-30

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-20 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-19-agent-get-config-value-no-deadline-defect.md` |
| 2026-10-20 | `draft` → `spec-ready` | /sdd-review | Product spec approved (6 warnings, 4 notes; low-cost ones resolved in-place) |
| 2026-10-20 | re-review (status retained at `spec-ready`) | /sdd-review | Product-spec re-run: PASS WITH WARNINGS (8 warnings, 3 notes). 7 already resolved by the prior pass; persona added to the Problem Statement. Overlap WARN (file-level only) |
| 2026-10-20 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved under operator standing authorization; recon.md + design.md written |
| 2026-10-21 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 6 steps |
| 2026-10-28 | re-spec (status retained at `implementation-ready`) | /sdd-execute | Steps 1-6 Evidence/Instructions/Verification anchors re-derived after merging origin/main-dev (respec commit 189edd1c) |
| 2026-10-28 | `implementation-ready` → `in-progress` | /sdd-execute | sequential (sdd-batch-execute); up-front plan confirmed by operator standing authorization (session_01NpS3HShZK6pSnogA7CFo2f) |
| 2026-10-28 | step 1 done (status retained at `in-progress`) | /sdd-execute | Step 1 — `hung_config_server` harness + `HANG_GUARD_S` in conftest; AC-1/AC-5/P-06 client tests (RED pending Step 3) |
| 2026-10-28 | step 2 done (status retained at `in-progress`) | /sdd-execute | Step 2 — AC-2, `extract_email_content` urls, AC-3 tool tests and AC-4 DCR test against `hung_config_server` (RED pending Step 3) |
| 2026-10-28 | step 3 done (status retained at `in-progress`) | /sdd-execute | Step 3 — `_CONFIG_READ_TIMEOUT_S = 3.0` + `timeout=` on `get_config_value`'s `GetConfig`, status-code warning; `tools.py`/`oauth_server.py` comment corrections (Steps 1-2 GREEN) |
| 2026-10-28 | step 4 done (status retained at `in-progress`) | /sdd-execute | Step 4 — agent `CLAUDE.md`, agent context-constitution + findings, root findings reconciled for `_CONFIG_READ_TIMEOUT_S` (docs only) |
| 2026-10-29 | step 5 done (status retained at `in-progress`) | /sdd-execute | Step 5 — two follow-up defect reports (`agent-config-snapshot-read`, `agent-dcr-fail-closed`) + `open` sidecars and agent findings index; `agent-rpc-deadlines` dropped as a duplicate of the feature-273 report (operator Option A, cross-reference added); manual teardown audit |
| 2026-10-29 | step 6 done; status → `code-completed` | /sdd-execute (operator-recorded) | Step 6 — dev `GetConfig` latency baseline: 27 spans, p50 24 ms, p99 ≤ 134 ms (bucket bound), max 83.4 ms; D = 3.0 s stands. Integration PR #1338 merge no longer held |

| 2026-10-30 | `code-completed` → `launched` | CI workflow | Promoted via PR #1368; committed df521ff51091a86e813950b34afff09ac4e8821b |
---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-spec time (2026-10-21). Stable unless `/sdd-spec` re-runs.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-agent` owner | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; OAuth 2.1 edge-auth correctness and statelessness; no secret values in tool output | 1, 2, 3 (`test`/`service`) |
| none | `docs` steps carry no reviewer role (registry § Step Category → Reviewer Roles) | 4, 5, 6 |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — debated, approved design (Phase 1)
- [Implementation Spec](implementation-spec.md) — 6 steps
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The agent's `client.get_config_value` calls `GetConfig` with no gRPC deadline. A config service that accepts
connections but never answers therefore hangs `extract_website_content`, `ingest_signal`'s alert-threshold
read and OAuth dynamic client registration until the MCP client times out.

## Next Action

Merge the integration PR #1338 (all 6 steps done; Step 6 baseline recorded 2026-10-29).
