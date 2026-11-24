# Product Spec: sso-granular-scopes

**Created**: 2026-11-24

---

## Problem Statement

After 345 (`authelia-sso`), an MCP access token's effective scope is
`roles_to_access_scope(roles) & scopes_to_mask(granted scopes)`, built from four coarse bits (read, write, admin, trade;
345 `product-spec.md` FR-7). The scopes a client receives are fixed by its Authelia registration: the full client
`xstockstrat-mcp-claude` gets every bit the user's roles allow (345 FR-13). The owner now connects more AI agents to the
MCP. Hermes Agent's scheduled jobs (homelab-edge re-spec, 2026-11-24) will call the MCP as the `david` user. So a
prompt-injected or misbehaving agent can do everything the owner can do, including `set_strategy_live` and trading.
Nothing in the app lets the owner limit what one client may do on their account.

## User Story

As the platform owner who connects AI agents (Claude.ai, Claude Code, Hermes) to the xstockstrat MCP, I want each
client to hold the least privilege it needs, with read-only as the default and an app-side picker to grant more per
client, while my own web session keeps full access, so that a compromised or misbehaving agent cannot trade or change
my strategies unless I allowed it.

## Functional Requirements

FR-1. **Scope catalog.** xstockstrat defines one documented catalog of OAuth scopes, finer than 345's four bits (granularity:
Open Question 1). Every MCP tool is mapped to exactly one required catalog scope. A tool with no mapping fails the
agent's test suite. The agent's RFC 9728 protected-resource metadata publishes the catalog as `scopes_supported`.

FR-2. **Enforcement per tool call.** A tool call proceeds only if the request's effective scope includes the tool's
required scope. Otherwise the agent answers HTTP 403 with
`WWW-Authenticate: Bearer error="insufficient_scope", scope="<required scope>"`, and no backend RPC is sent. A grant can
only narrow the user's roles, never widen them (345 FR-7 invariant unchanged).

FR-3. **Per-client grants with a read-only default.** For MCP requests, the effective scope is
roles ∧ token scopes ∧ the user's grant for the token's client ID. The client ID comes from the access token (claim:
Open Question 3). A client the user has never configured gets the read scope(s) only. This covers new clients such as
`xstockstrat-mcp-hermes`, with no code or config change per client.

FR-4. **Web session keeps full access.** Requests authenticated by the web session (`xstockstrat-web` / the identity-minted
session JWT) are not narrowed by any per-client grant. Their scope stays `roles_to_access_scope(roles)` as today.

FR-5. **Scope Picker (UI).** A signed-in user sees every MCP client ID that has called the agent for their account in the
current environment (`production`/`staging`), each with its last-used time and current grant. They can tick or untick
catalog scopes for each one. A scope the user's roles do not allow is shown disabled. Saving stores the grant per
`(user_id, environment, client_id)`. "Reset" returns the client to the read-only default.

FR-6. **Changes apply without re-authentication.** A saved grant change applies to that client's next tool call, on every
agent instance, with no new token. Narrowing takes effect within the agent's existing role-cache bound (345 FR-8:
≤ 60 s). The agent keeps no per-instance grant state beyond that cache (`instance_count > 1` stays safe).

FR-7. **Legacy mode unaffected.** With `auth.mode=local` (DigitalOcean deployments), the built-in OAuth server's grants and
`/accounts/authorized-apps` behave as before 345's SSO mode. The picker applies only in `oidc` and `both`.

## Out of Scope

- Authelia client registrations and their allowed scope lists (`davcs86/homelab-edge` `docs/superpowers/specs/2026-11-23-authelia-sso-respec.md` § 4.6). That repo adds the catalog scopes to each MCP client in a paired change.
- Group-to-role mapping from Authelia; apps own roles (homelab-edge SSO decision 6).
- Per-tool argument limits (e.g. max order size or allowed symbols). Only the tool-level scope is checked.
- Scope narrowing for web sessions or API keys.
- Hermes Agent itself and its own tool allowlist (homelab-edge).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-agent` — tool→scope catalog, per-call enforcement, `insufficient_scope` responses, client-ID extraction, grant lookup (cached).
- `xstockstrat-identity` — stores and serves per-`(user_id, environment, client_id)` grants; records the clients that have called.
- `xstockstrat-ui` — Scope Picker page and its BFF routes.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui`: the Scope Picker. Placement (a new page vs. the `/accounts/authorized-apps` page that
  345 FR-11 empties in SSO mode) is Open Question 2. If it is a new route, it is registered in `PLATFORM_SUBNAV` (C-10).
- [x] **Agent** — `xstockstrat-agent`: every MCP tool gains a required scope (FR-1/FR-2). Tool names, parameters and
  response shapes are unchanged. Only the new 403 `insufficient_scope` refusal is added.
- [ ] **None**

## Proto Contract Changes

- New identity RPCs to list a user's MCP clients with their grants, set a grant, and reset a grant. Non-breaking and
  additive to `identity.proto`. Exact messages are decided in `/sdd-design`.

## Config Key Changes

- [ ] No new config keys — to be confirmed in `/sdd-design`. Open Question 4 may add a default-grant key.

## Database Changes

- New identity table for per-`(user_id, environment, client_id)` grants and last-used time (migration with up and down pair; DBA review).

## Feature Workflow Notes

Branch to create: `feature/sso-granular-scopes` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [x] DBA review + service owner (schema migration)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **OQ-1 Catalog granularity.** One option is to keep 345's four bits and make MCP default to `xstockstrat.read`. Another is to
  split by domain (e.g. `strategies.read|write`, `strategies.live`, `trading.execute`, `accounts.read|write`,
  `watchlists.read|write`, `config.admin`). The owner asked for "custom granular scopes", so the split is assumed. The domain list and the
  tool→scope table need the owner's sign-off. Authelia must accept the custom scopes (homelab-edge spike S3).
- [ ] **OQ-2 Picker placement.** A new route, or reuse of `/accounts/authorized-apps`, which 345 FR-11 stops using in SSO mode?
- [ ] **OQ-3 Client-ID claim.** Which access-token claim names the client: `client_id` (RFC 9068) or `azp`? Authelia's
  JWT access-token shape is settled by 345's spike (D-26/D-95). It must be verified, never assumed.
- [ ] **OQ-4 Default grant.** Read-only for every unconfigured client, or a per-environment default (production
  read-only, staging wider)?
- [ ] **OQ-5 Dependency.** Blocked on 345 shipping (`implementation-ready` at filing). Should the read-only default
  wait for 345's prod cutover (homelab-edge phase P3)?
- [ ] **Known trap (ledger, 2026-07-01 056/060 and 2026-07-21 067):** "shipped the producer, forgot the shared consumer".
  The scope catalog has several consumers: the agent tool registry, the PRM `scopes_supported`, the UI's `mcpScopes.ts`
  (345 D-38/D-55 pin the PRM whole on both sides), `docs/runbooks/mcp-tools.md`, and the homelab-edge client
  registrations. All of them move in the same PR set.
