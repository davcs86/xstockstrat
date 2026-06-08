# Feature: auth2-authorized-apps-ui

**Lifecycle Status**: `code-completed`
**Development Branch**: `feature/auth2-authorized-apps-ui`
**Created**: 2026-06-07
**Last Updated**: 2026-06-07

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-06-07 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-06-07 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 warnings: UI overlap with 049, 050) |
| 2026-06-07 | `spec-ready` → `draft` | user re-scope | Scope expanded: per-user authorized-app list + revoke (not UI-only); now spans ui + identity + proto + migration. Re-review required. |
| 2026-06-07 | `draft` → `spec-ready` | /sdd-review | Re-scoped spec approved (2 warnings: hard dep + deep overlap with 049; UI overlap with 050) |
| 2026-06-07 | `spec-ready` → `implementation-ready` | /sdd-spec | Implementation spec generated with 9 steps |
| 2026-06-07 | `implementation-ready` (re-spec) | /sdd-spec | Regenerated against merged 049: migration pinned to 004, proto RPCs after RefreshOAuthToken (L25); Step 4 now also tags OAuth refresh tokens with client_id (049's mint path omits it) so list/revoke work |
| 2026-06-07 | `implementation-ready` (review fixes) | /sdd-review impl-spec | Applied non-B3 advisory fixes: buf-breaking base → main-dev; split 8-file UI step into Step 6 (BFF) + Step 7 (page/nav), drop providers.tsx; explicit 049 OAuth-test regression guard; last_used_at labeled "last refreshed". Steps 9 → 10 |
| 2026-06-07 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential run started (stacked per-step PRs). Step 1 (proto RPCs/message) done |
| 2026-06-08 | `in-progress` → `code-completed` | /sdd-execute | All 10 steps done (PRs #623–#631 stacked → feature branch). Deviations: host proto toolchain, throwaway-PG migration test, AgentUrlContext (Option B), playwright env + e2e tsc/lint fallback |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — 10 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Add a per-user **"My Authorized Apps"** management module (new `/accounts` segment in `xstockstrat-ui`) that lets an operator list, audit, and **revoke** the OAuth apps (e.g. Claude.ai) they've authorized against the xstockstrat MCP agent, plus connect a new one. Extends feature `049-unify-admin-auth-gates`'s identity OAuth backend with additive list/revoke RPCs + a per-user linkage migration (049 shipped no list and no revocation).

## Reviewers

_(Snapshot finalized at /sdd-spec time from docs/runbooks/reviewer-registry.md — distinct
reviewers across all 10 steps. Re-run /sdd-spec if the registry changes.)_

| Role | Review Focus | Steps |
|---|---|---|
| Proto Reviewer | Field number uniqueness, additive (no removal/renumber), `buf lint` + `buf breaking` pass | 1, 2 |
| `xstockstrat-identity` (service owner) | JWT expiry/rotation, refresh-token invalidation semantics, per-user isolation (no IDOR), never plaintext secrets | 1, 2, 3, 4, 5 |
| `xstockstrat-ui` (service owner) | Connect-RPC call safety, environment scope correctness, no secret values rendered in UI | 1, 2, 6, 7, 8, 9 |
| DBA | Migration NNN numbering (no gap/conflict vs 049's OAuth migration), up+down pair, index correctness, run-order via scripts/db-migrate.sh | 3 |
| Security | Revocation correctness, per-user IDOR isolation, no token/secret exposure in list responses, refresh-token invalidation semantics | (cross-cutting — gates 1, 3, 4, 6 per product-spec governance) |

## Next Action

`/sdd-review auth2-authorized-apps-ui impl-spec` — validate implementation spec, then `/sdd-execute auth2-authorized-apps-ui`
