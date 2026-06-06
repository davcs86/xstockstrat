# Feature: unify-admin-auth-gates

**Lifecycle Status**: `spec-ready`
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

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec unify-admin-auth-gates`_
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

**Part B — edge OAuth 2.1 for MCP** (absorbs feature `018-agent-mcp-oauth`). The agent becomes the
OAuth 2.1 Authorization/Resource Server for its MCP SSE endpoint: RFC 8414 + RFC 9728 discovery
metadata, RFC 7591 Dynamic Client Registration, mandatory PKCE/S256, **exact** redirect-URI matching,
login **delegated to `xstockstrat-ui` `/auth/oauth-login`**, identity reached over **gRPC**
(`AuthenticateUser`/`CreateApiKey`), and the access token = the existing `xss_` API key (unchanged
`validate_api_key` path). Legacy `Authorization: Bearer` stays; `?api_key=` is kept as a deprecated
Desktop-only fallback. **018's OAuth 2.0 impl spec is retired as stale** (it assumed nginx + HTTP/Connect
`80xx` ports removed by feature 045).

## Dependencies

- **047/048 merged** (#581/#596) — the `_has_admin_scope` (analysis) + `validate_admin` (agent)
  patterns Part A extends are on `main-dev`. ✅ satisfied.
- **019 unified-login** — `xstockstrat-ui` `/auth/oauth-login/page.tsx` and agent `UI_BASE_URL` plumbing
  exist (the page is currently a stub; Part B completes the code-issuance handshake). ✅ present.
- **Supersedes `018-agent-mcp-oauth`** — folded into Part B; 018 marked `demoted/canceled`.
- Touches the **header-propagation trust model** (`docs/patterns/header-propagation.md`), the agent
  admin-metadata helpers (`_admin_metadata`, `validate_admin`), and the agent's Starlette transport.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md at /sdd-spec time.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-ingest` (service owner) | Part A: `ManageSignalSource` gate change — role check vs re-auth; `credentials_ref` unchanged; `identity_channel` removal |
| `xstockstrat-indicators` (service owner) | Part A: formula author-ownership + admin-override decision; `RegisterFormula` gap; sandbox/permission correctness |
| `xstockstrat-agent` (service owner) | Part A entry validation; Part B OAuth 2.1 AS/RS endpoints, PKCE, code store, gRPC `CreateApiKey`, SSE backward-compat |
| `xstockstrat-identity` (service owner) | Part B: `CreateApiKey`/`AuthenticateUser`/`ValidateApiKey` usage; conditional DCR client store (OQ-B) |
| `xstockstrat-ui` (service owner) | Part B: complete `/auth/oauth-login` code-issuance handshake; redirect back to agent callback (not external client) |
| Security | Part B edge auth: PKCE enforcement, exact redirect match, DCR/SSRF surface, single-use+TTL codes, no tokens in query, CSRF/state binding, token scoping. Part A ingest trust-boundary (ingress strips `x-access-scope`) |
| Platform Lead | OQ-A (formula model), OQ-B/D (DCR + token-type architecture), discovery reachability under DO `/agent` route, service-registry/port consistency |
| Config team | New `agent.oauth.*` keys |

## Next Action

`/sdd-spec unify-admin-auth-gates` — generate the implementation spec from the approved product spec. Settle OQ-A (formula gate), OQ-E (discovery reachability / `AGENT_PUBLIC_URL`), OQ-G (api_key deprecation), OQ-H (access/refresh TTLs) during spec discovery.
