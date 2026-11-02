# Feature: fix-ui-transport-hardening

**Type**: bug
**Development Branch**: `feature/fix-ui-transport-hardening`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-ui-transport-hardening-defect.md`
**Severity**: SEV-3
**Created**: 2026-10-21
**Last Updated**: 2026-10-29
**Committed to main**: df521ff51091a86e813950b34afff09ac4e8821b
**Launched date**: 2026-10-30

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-ui-transport-hardening-defect.md` (debt-radar D-37, D-38) |
| 2026-10-21 | `draft` → `spec-ready` | /sdd-review | Product spec approved (5 warnings) |
| 2026-10-22 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written |
| 2026-10-22 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 10 steps |
| 2026-10-28 | `implementation-ready` (re-spec) | /sdd-execute sequential (sdd-batch-execute) | Steps 1, 3, 7, 10 re-specced against current codebase (line drift only; Step 10 findings path disambiguated) |
| 2026-10-28 | `implementation-ready` → `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Up-front plan confirmed by operator standing authorization (session_01NpS3HShZK6pSnogA7CFo2f) |
| 2026-10-28 | `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Step 1 done — leaf `deadlines.ts` + 30s unary transport default |
| 2026-10-28 | `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Step 2 done — vitest transport-deadline cases + real-socket black-hole spec (AC-1, AC-5, AC-6) |
| 2026-10-28 | `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Step 3 done — held-open alert stream e2e outlives the 30s unary default (AC-5) |
| 2026-10-29 | `in-progress` (re-spec) | /sdd-execute sequential (sdd-batch-execute) | Steps 4–10 re-verified after merging `origin/main-dev`; Steps 5, 6, 7 re-specced (line drift; Step 7 client mock widened to the three-BFF union); Steps 4, 8, 9, 10 unchanged |
| 2026-10-29 | `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Step 4 done — `refreshSession` bounded by `REFRESH_TIMEOUT_MS` (10s) |
| 2026-10-29 | `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Step 5 done — refresh deadline fails closed: vitest + e2e stalled identity (AC-2) |
| 2026-10-29 | `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Step 6 done — `forwardAdmin` takes `timeoutMs`; long RPCs at `LONG_RPC_TIMEOUT_MS` (300s), order mutations at `ORDER_MUTATION_TIMEOUT_MS` (60s) |
| 2026-10-29 | `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Step 7 done — vitest: `forwardAdmin` threads `timeoutMs` + admin gate; BFF deadline classes pinned per registration (AC-6) |
| 2026-10-29 | `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Step 8 done — middleware exempts exactly the eight segment health paths (`PUBLIC_HEALTH_PATHS`); dead root `api/health` and `health` matcher prefixes dropped |
| 2026-10-29 | `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Step 9 done — vitest + e2e: the eight segment health routes answer without a session (agent-health 401), lookalike and non-health routes still redirect to login (AC-3, AC-4) |
| 2026-10-29 | `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Step 10 done — UI `CLAUDE.md` middleware row documents `PUBLIC_HEALTH_PATHS`; UI constitution deadline gotcha rewritten around `deadlines.ts` (30s unary default); teardown reconciled by hand (context-forge `context-constitution` unavailable) |
| 2026-10-29 | `in-progress` → `code-completed` | /sdd-execute sequential (sdd-batch-execute) | All 10 steps done; AC-1–AC-6 promoted (C-16) to `services/xstockstrat-ui/acceptance/fix-ui-transport-hardening.feature`; integration PR opened |

| 2026-10-30 | `code-completed` → `launched` | CI workflow | Promoted via PR #1368; committed df521ff51091a86e813950b34afff09ac4e8821b |
---

## Reviewers

Canonical per-step snapshot from `implementation-spec.md` (/sdd-spec, 2026-10-22); stable unless `/sdd-spec` re-runs.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-ui` owner | Connect-RPC call safety, trading UI correctness, environment scope correctness | 1, 2, 3, 4, 5, 6, 7, 8, 9 |
| Security | Identity, auth scope | 8, 9 (unauthenticated surface widens to exactly the eight segment health paths) |

---|---|---|
| `xstockstrat-ui` owner | Connect-RPC call safety, trading UI correctness, environment scope correctness | TBD (/sdd-spec) |
| Security | Identity, auth scope | D-38 matcher change widens the unauthenticated surface to health routes only; confirm no other path is exempted |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — approved design: chosen approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — 10 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The UI's server-side gRPC transport has no default deadline, so a hung backend (notably identity during
middleware `refreshSession`) hangs requests (D-37); the middleware matcher exempts only non-existent
root-level health paths, so the eight segment health routes require auth (D-38).

## Next Action

`/sdd-review fix-ui-transport-hardening impl-spec` — validate implementation spec, then `/sdd-execute fix-ui-transport-hardening`
