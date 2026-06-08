# Context: auth2-authorized-apps-ui

**Feature**: `docs/roadmap/features/051-auth2-authorized-apps-ui/feature.md`
**Product Spec**: `docs/roadmap/features/051-auth2-authorized-apps-ui/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/051-auth2-authorized-apps-ui/implementation-spec.md`

---

## Session 2026-06-07 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- User story: "add a UI module for auth2.1 authorized apps. I want to see a button or the URL to connect Claude.ai from my web app."
- **Renumbered 049 → 051**: the initial draft was created on a stale `main-dev` checkout and picked `049`, but `origin/main-dev` already has `049-unify-admin-auth-gates` and `050-strategy-creation-flow`. Re-numbered this feature to `051` (dir + internal references) after fetching `origin/main-dev`.
- **Regrounded on feature 049, not 018**: feature `049-unify-admin-auth-gates` (Part B) absorbed and re-specced `018-agent-mcp-oauth` (whose impl spec is stale post-045) and is the real, current OAuth 2.1 source of truth. Key facts pulled from 049's product-spec:
  - Agent becomes the OAuth 2.1 Resource Server + AS facade; identity is the durable OAuth backend over gRPC.
  - Endpoints: `/.well-known/oauth-protected-resource` (RFC 9728), `/.well-known/oauth-authorization-server` (RFC 8414), `/oauth/register` (DCR), `/oauth/authorize`, `/oauth/callback`, `/oauth/token`.
  - `AGENT_PUBLIC_URL` is the established env var for the agent's public base URL (049 FR-B2/B12) → this feature reuses it; no new var/config key invented.
  - 049 completes the UI `/auth/oauth-login` **login delegation** page; THIS feature adds a separate operator-facing **connect/discovery** page (button + copyable MCP URL). No overlap.
- Grounding decisions:
  - Single affected service: `xstockstrat-ui`. No proto/DB/backend changes.
  - **Hard dependency**: 049 Part B must merge first (agent must actually serve OAuth discovery endpoints). Note in merge-order.md at /sdd-spec.
  - Related: `019-unified-login-page` (login UI, out of scope here).
- Open questions captured: Claude.ai deep-link mechanics, nav placement (config-ui recommended), optional discovery-endpoint health status, 049-merge sequencing. Env-var question resolved (reuse `AGENT_PUBLIC_URL`).

## Session 2026-06-07 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Criteria: all PASS except initial criterion-9 FAIL (4 open questions unresolved). Resolved via user decisions, then re-passed.
- User decisions (2026-06-07):
  - **Connect UX**: copy-URL only, no in-app button/deep-link (Claude.ai has no documented prefill deep-link; operator pastes URL in Settings → Connectors). → FR-2.
  - **Nav placement**: a NEW "Accounts" segment with a "My Authorized Apps" page (`/accounts/authorized-apps`) — NOT config-ui. → FR-1, FR-6 (add `/accounts` to protected matcher).
  - **Health status**: include a reachable/unreachable health indicator via a UI BFF probe of `${AGENT_PUBLIC_URL}/.well-known/oauth-protected-resource`. → FR-8, AC-4.
- All 5 open questions now resolved (`- [x]`).
- Warnings (advisory): overlap on `xstockstrat-ui` with `049-unify-admin-auth-gates` (hard dependency) and `050-strategy-creation-flow` (spec-ready, /insights — low risk). No proto/DB/config-key overlaps (this feature adds none).
- Note for /sdd-spec: adding a new top-level UI segment (`/accounts`) is more than a single page — confirm segment scaffolding, nav wiring, and middleware matcher against the post-045 consolidated `xstockstrat-ui` structure.

## Session 2026-06-07 — re-scope (user correction)

- User: "these exclusions are exactly the reason why this 'My authorized apps' submodule exists at all."
  The two items previously in Out of Scope (list/audit/revoke authorized OAuth clients; per-user
  management) ARE the core purpose. The copy-URL connect flow is just the add/empty-state affordance.
- **Status reverted spec-ready → draft** (material scope change requires re-review).
- User decisions (2026-06-07):
  - **Revoke depth**: refresh-token revoke reusing 049 infra (invalidate refresh token; access JWT
    expires naturally). Immediate JWT denylist (RFC 7009 full) = out of scope / follow-up.
  - **Ownership**: per-user ("My" = caller's own apps), server-enforced in identity (not UI-only filter).
  - **Backend location**: folded into 051 (identity RPCs + migration + UI in one feature).
- Scope now spans THREE areas (was UI-only):
  - `xstockstrat-ui` — new `/accounts` segment + "My Authorized Apps" page; BFF calls to identity
    (header propagation); copy-URL connect + health probe.
  - `xstockstrat-identity` — new `ListAuthorizedApps` / `RevokeAuthorizedApp` RPCs, per-user scoped;
    refresh-token invalidation; user↔client association.
  - `packages/proto` — additive identity.proto RPCs + `AuthorizedApp` message.
- New gates: additive proto (proto reviewer + identity owner), DB migration (DBA + identity owner),
  heavy security review (revocation correctness, per-user IDOR, no token exposure). Reviewers table updated.
- Dependency hardened: this EXTENDS 049's OAuth schema (oauth_clients/oauth_auth_codes/refresh_tokens),
  so 049 must merge first AND the identity migration must sequence after 049's 003_oauth (confirm number
  + linkage shape at /sdd-spec; add merge-order.md row).
- Two /sdd-spec-level details flagged: exact refresh_tokens↔(user_id,client_id) linkage shape, and
  confirming 049 persists enough to derive per-user authorized apps (else migration adds it).

## Session 2026-06-07 — sdd-review product-spec (re-scoped)

- Re-scoped product spec approved. Status: draft → spec-ready.
- All A3 criteria PASS; trading checks skipped (non-trading); 0 unchecked open questions.
- Warnings (advisory):
  - **049-unify-admin-auth-gates** — HARD DEPENDENCY + deep overlap: same proto file
    (`packages/proto/identity/v1/identity.proto`), same services (`xstockstrat-identity`, `xstockstrat-ui`),
    same DB surface (`identity.refresh_tokens` + identity `migrations/` dir; 049 uses `003_oauth` so this
    feature's migration must be ≥ `004`). 049 must merge first; 051 extends its OAuth schema/RPCs.
  - **050-strategy-creation-flow** — `xstockstrat-ui` only (different routes; low risk).
- No FAIL-level overlap (no duplicate config keys; 051 adds none).
- TODO at /sdd-spec: add a blocking row to `docs/roadmap/features/merge-order.md` (051 blocked by 049),
  and pin the identity migration number (≥004) + proto field numbers against the merged 049.

## Session 2026-06-07 — sdd-spec

- Generated implementation-spec.md with 9 steps. Status → implementation-ready.
- Key codebase findings:
  - **049 OAuth backend is NOT in main-dev yet.** `packages/proto/identity/v1/identity.proto`
    (read in full) has only the 8 original RPCs — no OAuth/DCR/AuthorizedApp. Identity migrations
    end at `002_seed_admin` (`ls`) — no `003_oauth`, no `oauth_clients`/`oauth_auth_codes` tables.
    `identity.refresh_tokens` (001_identity_tables.up.sql:27-34) has NO `client_id`/`last_used_at`
    column — every token today is a first-party user session. So migration NNN (planned 004),
    the oauth_clients join target, proto field numbers, and AGENT_PUBLIC_URL values must all be
    re-confirmed against the merged 049 at execute time. Documented as a hard-dependency banner +
    pre-execution deviation in the spec; merge-order row added in Step 9.
  - Proto gen emits BOTH ts-proto (`identity.ts`, consumed by identity service as
    `IdentityServiceService`, src/index.ts:5) and protobuf-es (`identity_pb.ts`, consumed by UI
    as `IdentityService`, connectClients.ts:5) from one `./scripts/buf-gen.sh` run (buf.gen.yaml).
  - Identity per-user-scoped patterns to mirror: `listApiKeys` (WHERE user_id=$1, impl L273-293)
    and IDOR-safe `revokeApiKey` (WHERE key_id=$1 AND user_id=$2, L295-303); refresh-token revoke
    `UPDATE refresh_tokens SET revoked_at=NOW() WHERE user_id=$1` (revokeToken L200-217). Responses
    must carry `Date` timestamps (secondsToDate helper, L18-20). Tests: node:test + mock pool;
    coverage `c8 --lines 40` via `pnpm run test:coverage`.
## Session 2026-06-07 — sdd-spec (re-spec against merged 049)

- Regenerated implementation-spec.md (9 steps). Status stays implementation-ready.
- **Major change: feature 049 is now MERGED into main-dev** (was NOT merged at the prior
  /sdd-spec run). Re-verified in the working tree:
  - `packages/proto/identity/v1/identity.proto` now has the OAuth RPCs (RegisterOAuthClient,
    GetOAuthClient, IssueAuthCode, ExchangeAuthCode, RefreshOAuthToken; service block ends L25)
    + OAuth messages (OAuthClient etc.). New 051 RPCs go after L25; new messages after L120.
  - `services/xstockstrat-identity/migrations/` ends at `003_oauth` → 051 migration is
    unambiguously **004** (no collision). `003_oauth.up.sql` creates `oauth_clients`
    (client_id PK) + `oauth_auth_codes`; this is the FK target for the new refresh_tokens.client_id.
  - `AGENT_PUBLIC_URL` already wired but only in the **agent** block (docker-compose L500,
    app.dev/app.yaml L262). Still ABSENT from the UI block → Step 7 still required.
- **New correctness finding (drives Step 4):** 049's `issueRefreshToken(userId)`
  (identityServiceImpl.ts:332-341) inserts only (user_id, token_hash, expires_at) — it does
  NOT record `client_id`. So OAuth grants are indistinguishable from first-party sessions in
  refresh_tokens, and ListAuthorizedApps would return nothing. Step 4 now also extends
  `exchangeAuthCode` (L480) and `refreshOAuthToken` (L493-525) to pass clientId into a new
  `issueRefreshToken(userId, clientId?)` signature, and bumps last_used_at on refresh. The
  prior spec missed this.
- Confirmed-unchanged patterns reused: IDOR-safe revoke mirrors revokeApiKey (WHERE key_id=$1
  AND user_id=$2, L298); list mirrors listApiKeys (WHERE user_id=$1, L274-294) + JOIN
  oauth_clients for name/redirects; Date-timestamp encoding rule (L11-20); test via
  makeSpyPool + SQL-capture asserts (test file L224-239); coverage c8 --lines 40 via
  `pnpm run test:coverage`; identity lint = `eslint src --ext .ts`; UI lint = `next lint`.
- UI BFF: header propagation reuses configUiBff.ts backendHeaders (L21-27); session via
  getSessionFromRequest like config-ui/api/audit/route.ts; identityClient (protobuf-es,
  connectClients.ts:33) exposes the new methods after Step 2; connectCodeToHttp L40 for errors.
- UI: middleware matcher (middleware.ts:9-14) is a negative-lookahead catch-all → `/accounts/*`
    is ALREADY auth-gated; no matcher edit needed (FR-8). BFF header propagation pattern from
    configUiBff.ts (backendHeaders L21-27: x-user-id/x-access-scope/x-trace-id) + simpler
    Route-Handler variant from config-ui/api/audit/route.ts. Segment scaffolding from
    config-ui/layout.tsx + PlatformHeader (segment/PLATFORM_NAV/SEGMENT_HOME need an 'accounts'
    entry). `IDENTITY_ENDPOINT` already wired in all 3 deployment files; only `AGENT_PUBLIC_URL`
    is absent everywhere (grep → no match) and must be added to the UI block in all three (FR-9,
    no `_ENDPOINT` suffix). UI lint = `next lint`; no coverage threshold (E2E only).

## Session 2026-06-07 — sdd-review impl-spec + advisory fixes

- Ran `/sdd-review auth2-authorized-apps-ui impl-spec` (Mode B, advisory): 0 failures, ~6 warnings.
  Overlap: none (049/050 launched; no active concurrent impl-specs; migration 004 free). Trading: N/A.
- User: "fix advisory warnings as long as they are not B3." Applied all non-B3 fixes:
  - Step 1: `buf breaking` base `feature/...` → `main-dev` (canonical per feature-workflow).
  - Split the 8-file UI step: **Step 6** = BFF routes (list/revoke + agent-health + segment health),
    **Step 7** = /accounts segment + page + nav. Dropped `providers.tsx` (page uses plain fetch).
  - Step 4 + Step 5: made the 049 OAuth-test regression guard explicit (test:coverage re-runs
    049's exchangeAuthCode/refreshOAuthToken tests; first-party callers untouched).
  - `last_used_at` documented + UI-labeled as "Last refreshed" (rotation-time, not per-request).
  - Renumbered: deploy 7→8, E2E 8→9 (now covers Steps 6+7), docs 9→10. Total steps 9 → 10.
  - Updated feature.md Reviewers "Steps" column (UI: 1,2,6,7,8,9) + step-count refs; Deviation Log.
- **Left as-is (B3, per user):** Step 8 (AGENT_PUBLIC_URL wiring) sequenced after its Step 6/7
  consumers. Execute Step 8 before/with 6–7 at runtime, but step order unchanged.
- Status unchanged: implementation-ready. Next: /sdd-execute.

## Session 2026-06-07 — sdd-execute (sequential)

- Sequential mode run started for the whole feature (10 steps). User chose **SDD stacked
  per-step PRs** branch strategy (resolving the harness `claude/*` vs SDD `feature/*` conflict):
  integration branch `feature/auth2-authorized-apps-ui` + `feature-steps/...-step-N` stacked PRs,
  then integration PR → main-dev.
- Re-spec gate: directive = none. Read-only validation of all 10 steps' evidence against the
  live codebase — all matched (proto service block ends L25, migrations end at 003_oauth, UI
  reference files present, accounts/ dir absent). No re-spec needed; no blocker.
- **Tooling note:** `buf` and the proto codegen toolchain were not pre-installed and Docker was
  not running. Installed `buf` v1.69.0 (CI proto-freshness pin) on the host to run Step 1's
  `buf lint`/`buf breaking` and Step 2's `buf-gen.sh` (CI-equivalent fallback — see Deviation Log).

### Step 1 — proto: Add ListAuthorizedApps / RevokeAuthorizedApp RPCs + AuthorizedApp message [done]
- Added the two additive RPCs after `RefreshOAuthToken` and the `AuthorizedApp` +
  request/response messages at end of file. `buf lint` clean; `buf breaking` (against main-dev)
  reports no breaking changes.
- Files modified: `packages/proto/identity/v1/identity.proto`
- Deviations: proto toolchain installed on host (buf 1.69.0) — see Deviation Log.

### Step 2 — proto-gen: Regenerate stubs (Go / Python / TS) [done]
- Installed CI-pinned toolchain (Go plugins protoc-gen-go@v1.36.11 / go-grpc@v1.6.2 /
  connect-go@v1.19.2, grpcio-tools==1.80.0, pnpm --frozen-lockfile), then ran `./scripts/buf-gen.sh`.
  Regenerated Go/Python/TS stubs. `git diff --stat packages/proto/gen/` confined to `identity/v1`
  (no other service changed); a second `buf generate` produced no further diff (idempotent, mirrors
  CI stale-stub check). New RPCs present in both ts-proto `IdentityServiceService` and protobuf-es
  `IdentityService`.
- Files modified: `packages/proto/gen/{go,python,ts}/identity/v1/*` (12 files)
- Deviations: toolchain installed on host — see Steps 1–2 Deviation Log entry.

### Step 3 — migration: Add client_id + last_used_at to refresh_tokens [done]
- Created `004_refresh_token_client.up.sql` (ADD COLUMN client_id TEXT FK→oauth_clients ON DELETE
  CASCADE, nullable = first-party session; ADD COLUMN last_used_at TIMESTAMPTZ; partial index
  idx_refresh_user_client WHERE client_id IS NOT NULL) + matching `.down.sql` (reverse order).
- Verified up+down on a throwaway local PG16 cluster (Docker/migrate unavailable) — columns+index
  present after up, gone after down. See Deviation Log.
- Files modified: `services/xstockstrat-identity/migrations/004_refresh_token_client.{up,down}.sql`
- Deviations: DB verification via throwaway PG cluster — see Deviation Log.

### Step 4 — service: client-tag OAuth refresh tokens + listAuthorizedApps/revokeAuthorizedApp [done]
- `issueRefreshToken(userId, clientId?)` now inserts `client_id` (NULL for first-party callers,
  left untouched). `exchangeAuthCode` passes the OAuth `clientId`; `refreshOAuthToken` selects
  `rt.client_id`, bumps `last_used_at` on rotation, and carries `client_id` forward.
- Added per-user `listAuthorizedApps` (JOIN oauth_clients, WHERE rt.user_id, non-sensitive fields
  only) and IDOR-safe `revokeAuthorizedApp` (UPDATE ... WHERE user_id=$1 AND client_id=$2). No new
  outbound gRPC call → header propagation N/A.
- Verification: `pnpm run lint` exits 0 (warnings = file-wide pre-existing `any` convention; new
  methods match it). Behavioral/coverage + 049 regression guard in Step 5.
- Files modified: `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts`
- Deviations: none.

### Step 5 — test: unit tests for client-tagging + list/revoke [done]
- Added `describe('listAuthorizedApps')` (missing-userId → code 3; happy path asserts clientId/
  clientName/lastUsedAt undefined, no `tokenHash` leak, SQL JOINs oauth_clients + WHERE rt.user_id)
  and `describe('revokeAuthorizedApp')` (missing userId/clientId → code 3; happy path success:true +
  UPDATE scoped `WHERE user_id = $1 AND client_id = $2`). Extended the exchangeAuthCode PKCE
  happy-path test to assert the INSERT into refresh_tokens carries client_id.
- Verification: `pnpm run lint` exit 0; `pnpm run test:coverage` exit 0 — 23/23 pass including
  049's exchangeAuthCode/refreshOAuthToken regression tests (Step 4's shared-path edits stay green).
- Files modified: `services/xstockstrat-identity/src/__tests__/identityServiceImpl.test.ts`
- Deviations: none.

### Step 6 — service: UI BFF routes (list/revoke + agent-health + segment health) [done]
- Created `accounts/api/authorized-apps/route.ts` (GET list / POST revoke; session via
  getSessionFromRequest → 401; propagation headers like configUiBff.backendHeaders;
  userId always from the verified session, never body — FR-3; Connect errors via
  connectCodeToHttp; returns only non-sensitive AuthorizedApp fields — FR-7),
  `accounts/api/agent-health/route.ts` (server-side probe of AGENT_PUBLIC_URL discovery endpoint,
  returns {reachable,status} only, graceful 200 on failure — FR-10),
  `accounts/api/health/route.ts` (mirrors config-ui health). middleware.ts unchanged — its
  negative-lookahead matcher already gates `/accounts/*` (FR-8).
- Verification: `pnpm run lint` (next lint) clean; `tsc --noEmit` no errors (regenerated client
  methods resolve).
- Files modified: `services/xstockstrat-ui/src/app/accounts/api/{authorized-apps,agent-health,health}/route.ts`
- Deviations: none.

### Step 7 — service: /accounts segment, My Authorized Apps page, nav [done]
- PlatformHeader: added `'accounts'` to PlatformSegment + PLATFORM_NAV (KeyRound icon) + SEGMENT_HOME.
- `accounts/layout.tsx` (server): reads `process.env.AGENT_PUBLIC_URL`, wraps children in
  AgentUrlProvider + PlatformHeader(segment="accounts") + main. No react-query Providers (page uses
  plain fetch).
- `accounts/authorized-apps/page.tsx` (client): fetches list, renders table (App / Client ID /
  Authorized / **Last refreshed** / Disconnect-with-confirm→refetch); "Connect a new app" section
  with agent reachable/unreachable indicator (GET agent-health), read-only copy-to-clipboard MCP URL
  (from useAgentUrl), and Claude.ai connector steps. No tokens/secrets rendered (FR-7).
- **Blocker resolved (sequential §5.7):** AGENT_PUBLIC_URL server-boundary vs client page — user
  chose **Option B** (layout reads env → client context provider). Added `accounts/AgentUrlContext.tsx`
  (one file beyond the spec Files list). See Deviation Log.
- Verification: `pnpm run lint` clean; `tsc --noEmit` no errors.
- Files modified: `services/xstockstrat-ui/src/app/accounts/{layout.tsx,AgentUrlContext.tsx,authorized-apps/page.tsx}`,
  `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx`
- Deviations: added AgentUrlContext.tsx (Option B) — see Deviation Log.

### Step 8 — service: Wire AGENT_PUBLIC_URL into the xstockstrat-ui deployment block [done]
- Added AGENT_PUBLIC_URL to the xstockstrat-ui block in all three deploy files: docker-compose
  (`http://xstockstrat-agent:9000` — compose service name), app.dev.yaml + app.yaml
  (`value: ${APP_URL}/agent`, matching the agent block's DO route). No `_ENDPOINT` suffix (FR-9).
- Verification: 2 occurrences per file (agent + UI blocks); all three YAML files parse.
- Files modified: `docker-compose.yml`, `.do/app.dev.yaml`, `.do/app.yaml`
- Deviations: none.

### Step 9 — test: E2E for /accounts/authorized-apps (covers Steps 6+7) [done]
- Added `e2e/accounts/authorized-apps.spec.ts` (5 tests: unauth→/auth/login redirect; authed table
  render via real BFF→gRPC mock; Disconnect→confirm→row disappears via page.route stateful stub;
  Connect section shows agent URL + copy control + reachable indicator; no token/secret in page).
  Extended `e2e/mock-backend.ts` identityHandlers with listAuthorizedApps (one app, no secrets) +
  revokeAuthorizedApp. Added AGENT_PUBLIC_URL to playwright webServer env (see Deviation Log).
- Verification: lint clean + tsc --noEmit clean. `test:e2e` itself timed out (dev-server harness
  420s) → sequential-mode fallback (tsc+lint). Spec runs in CI's Playwright job.
- Files modified: `services/xstockstrat-ui/e2e/accounts/authorized-apps.spec.ts`,
  `services/xstockstrat-ui/e2e/mock-backend.ts`, `services/xstockstrat-ui/playwright.config.ts`
- Deviations: playwright env add + e2e fallback — see Deviation Log.
