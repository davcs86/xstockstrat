# Feature: fix-identity-auth-code-race

**Type**: bug
**Development Branch**: `feature/fix-identity-auth-code-race`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-identity-auth-code-race-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-29

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-identity-auth-code-race-defect.md` (debt-radar D-23 auth-code half, D-21 residual) |
| 2026-10-22 | `draft` → `spec-ready` | /sdd-review | Product spec approved (7 warnings; overlap WARN with 252) |
| 2026-10-22 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written |
| 2026-10-22 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 6 steps |
| 2026-10-29 | `implementation-ready` (re-spec) | /sdd-execute sequential (sdd-batch-execute) | Steps 2, 4, 5, 6 re-anchored to the current codebase after the main-dev merge (feature 252 test-file rewrite); Steps 1, 3 unchanged |
| 2026-10-29 | `implementation-ready` → `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Sequential execution started; up-front confirmation by operator standing authorization (batch-execute 241-276) |
| 2026-10-29 | `in-progress` (Step 1 done) | /sdd-execute sequential (sdd-batch-execute) | Step 1 — `redeemAuthCode` conditional claim + same-transaction refresh INSERT in `exchangeAuthCode` (D-23) |
| 2026-10-29 | `in-progress` (Step 2 done) | /sdd-execute sequential (sdd-batch-execute) | Step 2 — AC-1/2/3/5/6 tests with the `makeAuthCodeDb` transactional fake (RED 4 fail → GREEN 86/86) |
| 2026-10-29 | `in-progress` (re-spec) | /sdd-execute sequential (sdd-batch-execute) | Steps 3, 4, 5 re-anchored to the current codebase after merging origin/main-dev (line-anchor drift only, no symbol drift) |
| 2026-10-29 | `in-progress` (Step 3 done) | /sdd-execute sequential (sdd-batch-execute) | Step 3 — `mintAccessToken` (optional `aud`) + `issueRefreshToken` shared by login, refresh and OAuth (D-21) |
| 2026-10-29 | `in-progress` (Step 4 done) | /sdd-execute sequential (sdd-batch-execute) | Step 4 — AC-4 claim-shape + refresh `client_id` parity tests (RED 1 fail on pre-Step-3 source → GREEN 89/89); FR-6/FR-7 grep 1 sign + 1 INSERT |
| 2026-10-29 | `in-progress` (Step 6 done) | /sdd-execute sequential (sdd-batch-execute) | Step 6 — identity context constitution re-grounded (IDENTITY-1/2/4 to `mintAccessToken`, all line hints re-stamped); manual reconciliation, context-forge refresh plugin unavailable |
| 2026-10-29 | `in-progress` → `code-completed` | /sdd-execute sequential (operator session) | Step 5 marked done by operator decision ("Run it after deploy."): the 20-caller repro runs post-merge on dev; merge hold lifted |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-spec time (2026-10-22); stable unless `/sdd-spec` re-runs.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-identity` owner | JWT expiry and rotation, API key scoping, secret store integration (here: single-use auth-code semantics, transaction correctness, unchanged claim shape and TTL) | 1, 2, 3, 4, 5 |
| Security | JWT claims minimal, auth scope (an authorization code is redeemable exactly once; claims unchanged by the D-21 dedup) | 1, 2, 3, 4 |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — approved design: chosen approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`ExchangeAuthCode` checks `consumed_at` in JS after an unlocked SELECT and then consumes with an unconditional
UPDATE, so concurrent exchanges of one code each mint a grant; the residual first-party mint/refresh-issue
duplication (D-21) is folded in so the fix covers one shared path.

## Next Action

After the integration PR merges and deploys to dev: operator runs the post-deploy 20-caller OAuth-token repro (implementation-spec.md Deviation Log, Step 5 post-merge entry) and the session records it in context.md under `rollout (dev)`.
