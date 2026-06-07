# Feature: unify-admin-auth-gates

**Lifecycle Status**: `launched`
**Committed to main**: edc530f9dbc08bb9f523f556bd2d243a6ea20ace
**Launched date**: 2026-06-07
**Development Branch**: `feature/unify-admin-auth-gates`
**Created**: 2026-06-05
**Last Updated**: 2026-06-06

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-06-05 | `idea` → `draft` | backlog capture | Split out of the 047/048 admin-gate consistency work — analysis was aligned to the x-access-scope role-check model; ingest + indicators still use their own gates. Captured as a backlog feature for later alignment. |
| 2026-06-06 | `draft` (unchanged) | /sdd-story | Dependency cleared (047/048 merged). Verified spec premises against merged code; fleshed out product-spec.md to full SDD template (User Story, Affected Services w/ evidence, Proto/Config/DB declarations, Feature Workflow Notes, FR-7, AC-4/5/6), surfaced the ungated `RegisterFormula` finding, and added an open-questions review with recommendations. |
| 2026-06-06 | `draft` → `spec-ready` | /sdd-review | Product spec approved (1 warning: 018-agent-mcp-oauth also modifies xstockstrat-agent — coordinate merge order; advisory: settle OQ-1 before/at /sdd-spec). No criteria failures. |
| 2026-06-06 | `spec-ready` → `draft` | re-spec (user) | **Scope expanded & merged with 018.** Per user decision, folded `018-agent-mcp-oauth` into this feature as **Part B — full MCP OAuth 2.1 edge auth** (RFC 8414/9728 metadata, RFC 7591 DCR, mandatory PKCE/S256, exact redirect match, UI-delegated login), alongside the original **Part A — internal admin-scope gates**. Re-spec grounded in current architecture (gRPC-only identity, no nginx, `xstockstrat-ui` `/auth/oauth-login`). 018's impl spec retired as stale. Reset to `draft` for re-review. |
| 2026-06-06 | `draft` → `spec-ready` | /sdd-review | Expanded (Part A + Part B) product spec re-approved. No criteria failures. 1 warning (041-upgrade-nextjs15 also touches xstockstrat-ui — coordinate merge order); 018 overlap cleared (demoted). Advisory: settle OQ-A/B/D/E before/at /sdd-spec — OQ-B decides whether any proto/DB change exists. |
| 2026-06-06 | `spec-ready` → `draft` | "100% connect" revision (user) | Analyzed out-of-scope items vs the MCP authorization spec (2025-06-18). To make Claude.ai connect seamlessly **and** spec-compliantly, brought 4 items INTO scope: **audience-bound JWT access tokens + RS `aud` validation (RFC 8707)**, **rotating refresh tokens**, the **`401 + WWW-Authenticate` discovery trigger**, and a **durable identity-backed OAuth state store** (stateless agent, multi-instance). Flipped OQ-D (was API-key-as-token → now JWT+refresh+audience). Identity becomes the AS/token backend (new RPCs `IssueAuthCode`/`ExchangeAuthCode`/`RefreshOAuthToken` + `TokenClaims.aud`; migration `003` adds `oauth_clients` + `oauth_auth_codes`). Reset to `draft` for re-review. |
| 2026-06-06 | `draft` → `spec-ready` | /sdd-review | "100% connect" revision re-approved. No criteria failures. 1 warning (041-upgrade-nextjs15 also touches xstockstrat-ui — coordinate merge order; no proto/migration/config collision). Remaining open: OQ-A (formula gate), OQ-E (discovery reachability), OQ-G (api_key deprecation), OQ-H (TTLs) — settle at /sdd-spec. |
| 2026-06-06 | `spec-ready` → `implementation-ready` | /sdd-spec | Implementation spec generated with 22 steps. Settled OQ-A (keep ownership + admin override + close RegisterFormula gap), OQ-E (`AGENT_PUBLIC_URL`=`${APP_URL}/agent` in DO under the `/agent` route), OQ-G (keep `?api_key=`, mark deprecated), OQ-H (reuse identity `access_ttl_seconds`/`refresh_ttl_seconds`). Confirmed: ingest migrations up to 002, indicators 001, identity 002 (→003); `AGENT_PUBLIC_URL` + `agent.oauth.*` absent from all deploy files; identity JWT/refresh-rotation infra reusable for the OAuth token mint. |
| 2026-06-06 | `implementation-ready` → `in-progress` | /sdd-execute (sequential) | Started full 22-step sequential execution. Per user decision: all work on harness branch `claude/sdd-execute-049-sequential-076Qx` with a single integration PR → `main-dev` at the end (not the stacked per-step-PR model). Spec artifacts brought in from `claude/product-spec-049-ZiIXN` (never synced to main-dev; `feature/unify-admin-auth-gates` absent on origin). |
| 2026-06-06 | `in-progress` → `code-completed` | /sdd-execute (sequential) | All 22 steps done. Part A (ingest/indicators/agent admin-scope gates) + Part B (full MCP OAuth 2.1: identity proto RPCs + 003_oauth migration + OAuth RPC impls, agent discovery/DCR/authorize/callback/token + aud-bound /sse, UI login delegation, config keys, docs). Verified per-service: ingest 67%, indicators 82%, identity test:coverage EXIT=0, agent 63%; buf lint+breaking (additive); migration reversible on postgres:16; all linters clean. Deviations: CI-equivalent codegen/DB fallbacks, user-approved agent ruff cleanup, /sse Route→Mount bug fix (see Deviation Log). |

| 2026-06-07 | `code-completed` → `launched` | CI workflow | Promoted via PR #620; committed edc530f9dbc08bb9f523f556bd2d243a6ea20ace |
---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — 22 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

**Unify agent auth across both layers** (working title: *unify-agent-auth*; directory slug retained for
branch/PR continuity). Two parts in one feature:

**Part A — internal admin-scope gates.** Bring the two gates left out of 047/048 into the single
`x-access-scope` ADMIN-bit (`0x04`) role-check model: `xstockstrat-ingest` `ManageSignalSource`
(stop re-authenticating; agent `manage_signal_source` validates admin at the entry and forwards scope)
and `xstockstrat-indicators` formula management (keep author-ownership, add an admin override, close the
ungated `RegisterFormula` gap).

**Part B — edge OAuth 2.1 for MCP** (absorbs feature `018-agent-mcp-oauth`). The agent is the OAuth 2.1
Resource Server + Authorization-Server HTTP facade for its MCP SSE endpoint, with **identity as the
durable OAuth state + token backend over gRPC**: RFC 8414 + RFC 9728 discovery + `401 WWW-Authenticate`
trigger, RFC 7591 Dynamic Client Registration, mandatory PKCE/S256, **exact** redirect-URI matching,
login **delegated to `xstockstrat-ui` `/auth/oauth-login`**. The access token is an **audience-bound JWT**
(`aud` = agent resource URI, validated at `/sse`) issued **with a rotating refresh token** — reusing
identity's existing JWT/refresh infra (RFC 8707). OAuth state (clients, codes) lives in identity's DB so
the agent is **stateless / multi-instance-safe**. Legacy `Authorization: Bearer <api_key>` stays;
`?api_key=` is kept as a deprecated Desktop-only fallback. **018's OAuth 2.0 impl spec is retired as
stale** (it assumed nginx + HTTP/Connect `80xx` ports removed by feature 045). This "100% connect"
revision satisfies the MCP authorization spec (2025-06-18) end-to-end.

## Dependencies

- **047/048 merged** (#581/#596) — the `_has_admin_scope` (analysis) + `validate_admin` (agent)
  patterns Part A extends are on `main-dev`. ✅ satisfied.
- **019 unified-login** — `xstockstrat-ui` `/auth/oauth-login/page.tsx` and agent `UI_BASE_URL` plumbing
  exist (the page is currently a stub; Part B completes the code-issuance handshake). ✅ present.
- **Supersedes `018-agent-mcp-oauth`** — folded into Part B; 018 marked `demoted/canceled`.
- Touches the **header-propagation trust model** (`docs/patterns/header-propagation.md`), the agent
  admin-metadata helpers (`_admin_metadata`, `validate_admin`), and the agent's Starlette transport.

## Reviewers

_(Snapshot generated by /sdd-spec from docs/runbooks/reviewer-registry.md — deduplicated across all 22 steps. Stable unless /sdd-spec is re-run.)_

| Role | Review Focus | Steps |
|---|---|---|
| `xstockstrat-ingest` (service owner) | Signal normalization correctness, idempotent ingestion, newsletter source schema stability (Part A gate swap + `identity_channel` removal) | 1, 2 |
| `xstockstrat-indicators` (service owner) | Formula sandboxing, numeric precision, timeout enforcement, no side-effects (Part A formula gate + `RegisterFormula` gap) | 3, 4 |
| `xstockstrat-agent` (service owner) | Part A entry validation; Part B OAuth 2.1 AS/RS endpoints, PKCE, code store, gRPC, SSE backward-compat | 5, 12–17, 19, 20, 21 |
| `xstockstrat-identity` (service owner) | JWT expiry and rotation, API key scoping, secret store integration (OAuth RPCs, audience-bound JWT, migration 003) | 6, 7, 8, 9, 10, 11 |
| `xstockstrat-ui` (service owner) | Trading UI correctness, Connect-RPC call safety, no secrets rendered (complete `/auth/oauth-login` → agent callback) | 18 |
| Proto Reviewer | Field number uniqueness, no breaking changes without deprecation, `buf lint`/`buf breaking` pass | 6, 7 |
| DBA | Migration NNN numbering (no gaps), up+down pair, index correctness, run-order compliance | 8 |
| Security | Part B edge auth: PKCE enforcement, exact redirect match, DCR/SSRF surface, single-use+TTL codes, audience binding/RS `aud` validation, refresh rotation, no tokens in query, state/CSRF binding, `401 WWW-Authenticate`. Part A ingest trust-boundary (ingress strips `x-access-scope`) | cross-cutting (Part B 6–18, Part A 1/5) |
| Platform Lead | OQ-A (formula model), identity-backed AS + token/audience architecture, discovery reachability under DO `/agent` route, service-registry/port consistency | cross-cutting (6, 9, 12) |
| Config team | New `agent.oauth.*` keys | 20 |

## Next Action

`/sdd-review unify-admin-auth-gates impl-spec` — validate the implementation spec, then `/sdd-execute unify-admin-auth-gates`. Note merge-order coordination: 041-upgrade-nextjs15 also touches `xstockstrat-ui` (Step 18 here completes `/auth/oauth-login`).
