# Context: unify-admin-auth-gates

**Feature**: `docs/roadmap/features/049-unify-admin-auth-gates/feature.md`
**Product Spec**: `docs/roadmap/features/049-unify-admin-auth-gates/product-spec.md`
**Implementation Spec**: _not yet generated_

---

## Session 2026-06-05 — backlog capture (during 047/048 execution)

- Created as a backlog item while executing features 047 (`strategy-engine`) and 048
  (`live-strategy-alert-engine`) sequentially. During the user-requested admin-gate consistency pass,
  `xstockstrat-analysis` was aligned to a single model: **internal services do an `x-access-scope`
  ADMIN-bit role check (`_has_admin_scope`), authentication/authorization lives at the entry points**
  (UI BFF JWT, MCP agent SSE), and the agent validates the admin role at the entry
  (`client.validate_admin`).
- Two gates were **deliberately left out of 047's scope** because changing them means modifying services
  047 doesn't own:
  - `xstockstrat-ingest` `ManageSignalSource` → still uses `_validate_admin_token` (Bearer + identity
    `ValidateApiKey` re-auth inside the internal service).
  - `xstockstrat-indicators` formula management → uses author-ownership (`user_id == author`), a
    genuinely different authorization concern.
- This feature tracks bringing ingest into the unified model and **deciding** (OQ-1) whether the
  indicators ownership model stays distinct or is unified/augmented with admin scope.
- Code references for the future spec:
  - Target pattern: `services/xstockstrat-analysis/app/handlers/servicer.py` `_has_admin_scope`
    (post-047/048); agent `services/xstockstrat-agent/app/client.py` `validate_admin` + `_admin_metadata`.
  - ingest gate today: `services/xstockstrat-ingest/app/handlers/servicer.py` `_validate_admin_token`
    + `ManageSignalSource`.
  - indicators gate today: `services/xstockstrat-indicators/app/handlers/servicer.py`
    `RegisterFormula`/`UpdateFormula`/`DeleteFormula` (`user_id == author`).
  - agent tools: `manage_signal_source`, `manage_formula` in `services/xstockstrat-agent/app/tools.py`.
- **Do NOT start before 047/048 are merged to main-dev** — the `_has_admin_scope` / `validate_admin`
  pattern this feature extends only lands there once 047/048 merge.

## Session 2026-06-06 — sdd-story (flesh out product spec)

- **Dependency cleared:** 047 (`strategy-engine`, PR #581) and 048 (`live-strategy-alert-engine`,
  PR #596) are both merged to `main-dev`. The `_has_admin_scope` / `validate_admin` pattern is present.
- Fast-forwarded `claude/product-spec-049-ZiIXN` to `origin/main-dev` (`8b0245c`) so the 049 files
  are on the working branch.
- **Verified the backlog spec's premises against the merged code** — all accurate:
  - analysis target: `_has_admin_scope` at `services/xstockstrat-analysis/app/handlers/servicer.py:58`
    (checks `x-access-scope & 0x04`); gates `ManageStrategy` (`:655`) and `SetStrategyLive` (`:726`).
  - agent: `validate_admin` (`app/client.py:374`), `_admin_metadata` (`app/client.py:30`); strategy
    tools forward `x-access-scope: 7`.
  - ingest: `_validate_admin_token` (`app/handlers/servicer.py:47`) re-auths via identity
    `ValidateApiKey`; **only** call site is `ManageSignalSource` (`:427`) → `identity_channel` removal
    (FR-3) is clean. Wiring at `app/main.py:60,67`.
  - agent `manage_signal_source` tool (`app/tools.py:320-351`) has **no** entry `validate_admin` and
    forwards no `x-access-scope` (the `validate_admin` at `:364` belongs to `set_strategy_live`).
  - indicators: `UpdateFormula`/`DeleteFormula` enforce `row["author"] != request.user_id`
    (`:211,236`); **`RegisterFormula` (`:135-150`) is effectively ungated** — `author` defaults to
    `"dev-user"`. New finding surfaced into the spec.
  - UI BFF callers exist: `config-ui/hooks/useSignalSourceMutations.ts`, `hooks/useFormulas.ts`.
- **Fleshed out `product-spec.md`** to the standard SDD template + grounding: added User Story,
  Affected Services (with file:line evidence), Proto/Config/DB change declarations (all "none"),
  Feature Workflow Notes (dependency satisfied; approval gates), FR-7 + AC-4/5/6, the
  `RegisterFormula` gap, and an "Open Questions — Review & Recommendations" section (OQ-1 keep
  ownership + admin override + close RegisterFormula gap; OQ-2 verify ingress header-strip; OQ-3 defer
  shared helper, duplicate now).
- Status stays `draft`. Next action unchanged: `/sdd-review unify-admin-auth-gates product-spec`.

## Session 2026-06-06 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Criteria: all PASS (Problem Statement, FR-1..7, Out of Scope/Non-Goals, Affected Services exact-match
  registry, Proto/Config/DB all declared none, AC-1..6, Open Questions no unchecked checkboxes).
- Trading-domain checks: skipped (non-trading feature).
- Warnings: 1 — `018-agent-mcp-oauth` (implementation-ready) also modifies `xstockstrat-agent`;
  coordinate merge order. Low collision risk (018 = SSE/OAuth auth layer `app/auth.py` + `agent.oauth.*`
  config keys; 049 = tool layer `manage_signal_source` + `client.py`; different files, no shared key).
- Advisory: OQ-1 (formula author-ownership vs admin-scope) is a genuine pending decision with an owner
  (Platform Lead + Security) and a recommendation; settle it before/at /sdd-spec. FR-4 accommodates
  either outcome, so it does not block product-spec approval.
- Note: 041-upgrade-nextjs15 touches the UI but 049 expects no UI code change → no real overlap.
- Next: /sdd-spec unify-admin-auth-gates.

## Session 2026-06-06 — re-spec: merge 018 (OAuth 2.1) into 049 (user decision)

- **User decisions** (AskUserQuestion): (1) **merge** 049 + OAuth into one feature; (2) **full MCP
  OAuth 2.1** scope; (3) **re-spec first** (018's impl spec is stale).
- Feature broadened to **two parts**: Part A = original internal admin-scope gates; Part B = full MCP
  OAuth 2.1 edge auth (absorbs 018). Directory slug `unify-admin-auth-gates` retained for branch/PR
  continuity; working title *unify-agent-auth*. **Status reset `spec-ready` → `draft`** (scope changed;
  prior product-spec approval no longer covers OAuth) → needs re-review.
- **Why 018 could not be implemented as-written (stale):** its impl spec assumes nginx (deleted by 045),
  HTTP/Connect-RPC `80xx` ports + `IDENTITY_HTTP_ENDPOINT` (removed; backends gRPC-only), and separate
  trader/insights/config-ui (consolidated into `xstockstrat-ui`). Retired; 018 marked demoted/canceled.
- **Architecture grounding for Part B (verified):**
  - Agent = FastMCP+Starlette+uvicorn:9000, routes only `/sse` + `/messages`
    (`services/xstockstrat-agent/app/main.py:80-85`); no `/.well-known` or `/oauth`.
  - Agent→identity is gRPC-only (`auth.py:36` ValidateApiKey; `client.py:374-392` validate_admin). No
    httpx-to-identity, no `IDENTITY_HTTP_ENDPOINT`.
  - Identity gRPC-only (`src/index.ts:42-57`, :50058): `AuthenticateUser`, `CreateApiKey` (returns
    `xss_` key), `ValidateApiKey` (`TokenClaims.roles`). golang-migrate migrations up to `002`.
  - Intended login design already half-wired: `main.py:26-30` `UI_BASE_URL` + `TODO(019)` to redirect to
    `{UI_BASE_URL}/auth/oauth-login`. UI page `src/app/auth/oauth-login/page.tsx` EXISTS but is a STUB —
    on login it redirects to `${redirect_uri}?state=` with NO auth code (agent code-issuance never
    built). Part B (FR-B5/FR-B6) completes this handshake.
- **Design decisions captured as OQs with recommendations:** OQ-A keep ownership + admin override +
  close RegisterFormula gap; OQ-B DCR clients in-memory in agent (recommended) vs identity DB+RPC
  (conditional proto/migration); OQ-C in-memory PKCE-bound single-use ≤60s code store; OQ-D access
  token = `xss_` API key (reuse validate_api_key); OQ-E discovery reachability under DO `/agent` route
  (resolve at /sdd-spec); OQ-F in-memory ⇒ instance_count:1; OQ-G keep `?api_key=` as deprecated.
- **Conditional governance:** proto + identity migration ONLY if OQ-B picks the DB-backed DCR store;
  otherwise none. Heavy Security review required for Part B (outward-facing edge auth).
- Next: `/sdd-review unify-admin-auth-gates product-spec` (re-review expanded spec).

## Session 2026-06-06 — sdd-review product-spec (re-review of expanded Part A + Part B)

- Expanded product spec re-approved. Status: draft → spec-ready.
- Criteria: all PASS — Problem Statement (2 personas, 2 layers), FR-A1..A6 + FR-B1..B12 (numbered/
  testable), Out of Scope, Affected Services exact-match (agent/ingest/indicators/identity/ui), Proto
  (conditional, flagged additive/non-breaking), Config keys (agent.oauth.* svc.cat.key), DB (conditional
  migration with NNN-after-002 + up/down), AC-A*/AC-B*/AC-X, Open Questions (no unchecked checkboxes;
  OQ-A..G are bullets w/ owners+recommendations).
- Trading-domain checks: skipped (non-trading).
- Warnings: 1 — `041-upgrade-nextjs15` (code-completed) also touches xstockstrat-ui; coordinate merge
  order (low risk: 041 is a Next.js bump, 049 completes /auth/oauth-login logic; no shared config key).
- Overlap cleared: 018 now demoted/canceled → no longer an active concurrent feature.
- Advisory (does not block): settle OQ-A (formula gate), OQ-B (DCR storage — decides if any proto/DB
  change exists), OQ-D (token type), OQ-E (discovery reachability) before/at /sdd-spec.
- Next: /sdd-spec unify-admin-auth-gates.

## Session 2026-06-06 — sdd-spec (generate implementation spec)

- Generated implementation-spec.md with **22 steps**. Status → `implementation-ready`.
- **OQ resolutions locked** (per product-spec recommendations): OQ-A keep author-ownership +
  add `x-access-scope & 0x04` admin override on Update/Delete + close RegisterFormula gap by
  defaulting `author` to propagated `x-user-id` (require it); OQ-E `AGENT_PUBLIC_URL` new env var
  (absent everywhere) = `${APP_URL}/agent` in DO (agent under `/agent` route), `http://localhost:9000`
  in compose; OQ-G keep `?api_key=` deprecated; OQ-H reuse identity `identity.jwt.access_ttl_seconds`
  (900) + `refresh_ttl_seconds` (2592000) — no new TTL config keys.
- **Key codebase findings (verified by grep/Read):**
  - Migrations: ingest last = `002_add_signal_sources_registry`, indicators = `001_formulas`,
    identity = `002_seed_admin` → new `003_oauth` (up+down). Refresh tokens reuse existing
    `identity.refresh_tokens` (migration 001, no new table).
  - ingest gate: `_validate_admin_token` (servicer.py:47-62), single call site `ManageSignalSource`
    (:427); `_identity`/`identity_channel` wiring at servicer.py:41-43 + main.py:34,60,67 → clean
    removal. Target: analysis `_has_admin_scope` (analysis servicer.py:58-70).
  - indicators: `RegisterFormula` author default `"dev-user"` at servicer.py:144 (the gap);
    Update/Delete ownership checks at :211 / :236. No metadata reads today → add `_has_admin_scope`.
  - agent: `manage_signal_source` tool (tools.py:319-351) has NO entry `validate_admin`; client
    `manage_signal_source` (client.py:359-361) forwards `_admin_metadata` but NO `x-access-scope`
    (cf. manage_strategy :227 / set_strategy_live :405 which append `("x-access-scope","7")`).
    SSE `/sse` 401 (main.py:72-73) has NO `WWW-Authenticate` header; `validate_api_key` (auth.py)
    has no JWT/aud path. Routes today = only `/sse` + `/messages` (main.py:80-85).
  - identity: JWT mint `jwt.sign(claims, secret, {expiresIn: accessTtlSeconds})` (impl.ts:80-82);
    refresh insert/rotate pattern (:87-91 / :157-176); sha256 hashing (:85,:249); service
    registration via `IdentityServiceService` (index.ts:44-47) → adding matching methods needs no
    index.ts change. `validateToken` (:115-130) extended to surface `aud`. Proto: TokenClaims fields
    1–5 → add `aud=6`; 8 RPCs → add 5 OAuth RPCs (all additive/non-breaking).
  - UI: `/auth/oauth-login/page.tsx` stub redirects to `${redirect_uri}?state=` with NO code,
    directly to external client (the FR-B5 bug). BFF `/api/auth/login/route.ts` sets session cookies.
  - Deployment: `AGENT_PUBLIC_URL` + `agent.oauth.*` confirmed absent from docker-compose.yml +
    both .do app specs. Agent reads config via `client.get_config_value` → `GetConfig(namespace="agent")`.
- **Every backend `service` step paired with a `test` step** enforcing CI coverage (ingest/agent 40%,
  indicators 50%, identity `c8 --lines 40`) + the language linter (ruff / eslint).
- Reviewers snapshot written to feature.md (deduped across 22 steps): adds Proto Reviewer (6,7),
  DBA (8) now that OQ-B/D activated proto + migration gates.
- Next: /sdd-review unify-admin-auth-gates impl-spec.

## Session 2026-06-06 — OQ-B resolved (user); hold at spec-ready

- **User decisions:** OQ-B → **durable DCR store in identity** (proto + migration); **do NOT run
  /sdd-spec yet** (hold at spec-ready).
- Locked OQ-B into product-spec.md:
  - **Proto:** additive identity RPCs `RegisterOAuthClient`/`GetOAuthClient` + `OAuthClient` message in
    `packages/proto/identity/v1/identity.proto` (new field numbers; `buf breaking` must pass → non-breaking).
  - **DB:** new `services/xstockstrat-identity/migrations/003_oauth_clients.up.sql` (+ `.down.sql`),
    NNN after `002`; table `identity.oauth_clients`. Auth codes stay in-memory (OQ-C).
  - **Governance gates activated:** additive-proto (identity owner + config/proto team) and DB-migration
    (DBA + identity owner) checkboxes now checked.
  - Affected Services + OQ-F updated (only the in-memory auth-code store now needs instance_count:1).
- Status unchanged: `spec-ready` (resolving the already-declared conditional branch does not invalidate
  the approval). Remaining open: OQ-A (formula gate), OQ-D (token type), OQ-E (discovery reachability) —
  to settle at /sdd-spec.
- Next (when ready): /sdd-spec unify-admin-auth-gates.

## Session 2026-06-06 — "100% connect" analysis + revision (user)

- **User goal:** Claude.ai must connect at 100%. Analyzed each Out-of-Scope item vs the MCP authorization
  spec (modelcontextprotocol.io 2025-06-18), RFC 8707 (resource indicators), RFC 9728 (PRM).
- **Repo finding:** identity ALREADY has JWT + rotating-refresh infra (`AuthenticateUser` issues
  access+refresh JWT; `RefreshToken` rotates; `identity.refresh_tokens` table). The prior spec bypassed
  it and returned the never-expiring API key (`createApiKey` sets no `expires_at`).
- **Spec MUST/SHOULD that mattered:** PRM (MUST) + AS metadata (MUST) + 401 `WWW-Authenticate` (MUST,
  the discovery trigger) + PKCE (MUST) + exact redirect (MUST) + **RS audience validation, "tokens MUST
  be issued specifically for them"** (RFC 8707) + public-client **refresh-token rotation MUST** (if
  refresh issued) + SHOULD issue short-lived access tokens. DCR is SHOULD (already in scope).
- **Connect-impact verdict:** API-key-as-token connects but (a) advertising expires_in forces periodic
  re-consent (no refresh), (b) isn't audience-bound (violates a MUST), (c) in-memory code store pins
  instance_count:1. Revocation/OIDC/implicit-password-clientcred grants do NOT affect connect → stay OOS.
- **User decisions (AskUserQuestion):** token model = **JWT + refresh + audience**; ALSO bring in **401
  WWW-Authenticate**, **audience validation**, **shared auth-code store**.
- **Spec revised accordingly:**
  - Architecture: agent = RS + AS-HTTP-facade (stateless); **identity = durable OAuth state + token
    backend over gRPC** (owns clients + codes; mints aud-bound JWT + rotating refresh).
  - New FRs: FR-B0 (401+WWW-Authenticate), FR-B7 (ExchangeAuthCode → aud JWT+refresh), FR-B7b (refresh
    rotation), FR-B8 (RS aud validation), FR-B13 (stateless/multi-instance). Updated FR-B1/B2/B3/B6/B9.
  - Proto (additive): `RegisterOAuthClient`/`GetOAuthClient`, `IssueAuthCode`, `ExchangeAuthCode`,
    `RefreshOAuthToken`, + `aud` on `TokenClaims`. buf breaking must pass.
  - DB: migration `003_oauth` → `oauth_clients` + `oauth_auth_codes` (reuse existing `refresh_tokens`).
  - OQ resolutions: OQ-C durable shared code store; OQ-D JWT+refresh+audience; OQ-F no instance_count:1
    constraint. Still open: OQ-A (formula), OQ-E (discovery reachability), OQ-G (api_key deprecation),
    OQ-H (TTLs).
  - Out of Scope trimmed to truly-non-connect items (revocation, OIDC, implicit/password/clientcred,
    BFF re-arch, other internal gates).
- **Status reset spec-ready → draft** (material scope change) → re-review needed.
- Next: /sdd-review unify-admin-auth-gates product-spec.

## Session 2026-06-06 — sdd-review product-spec (re-review #2, "100% connect" revision)

- Revised product spec re-approved. Status: draft → spec-ready.
- Criteria: all PASS — Problem Statement, FR-A1..A6 + FR-B0..B13 (numbered/testable), Out of Scope
  (trimmed to non-connect items), Affected Services exact-match (agent/ingest/indicators/identity/ui),
  Proto (additive identity RPCs + TokenClaims.aud, buf-breaking gate flagged), Config keys (agent.oauth.*),
  DB (migration 003_oauth oauth_clients+oauth_auth_codes, NNN-after-002, up+down), AC-A*/AC-B0..B8/AC-X,
  Open Questions (no unchecked checkboxes).
- Trading-domain checks: skipped (non-trading).
- Warnings: 1 — 041-upgrade-nextjs15 (code-completed) also touches xstockstrat-ui; coordinate merge
  order. No proto/migration/config-key collision (049 proto+migration are identity-side).
- Remaining open (settle at /sdd-spec): OQ-A (formula gate), OQ-E (discovery reachability /
  AGENT_PUBLIC_URL under DO /agent route), OQ-G (?api_key= deprecation), OQ-H (access/refresh TTLs).
- Next: /sdd-spec unify-admin-auth-gates.

## Session 2026-06-06 — sdd-review impl-spec (advisory) + housekeeping

- Reviewed the 22-step implementation spec. Result: 0 FAILs, 2 advisory WARNs, no lifecycle change.
  - WARN: Step 7 (proto-gen) lists generated *directories* not files — acceptable for codegen.
  - WARN: Step 18 (UI oauth-login) has no `pnpm run lint` in its/its paired test step's verification —
    recommend adding (frontend has no coverage gate; Playwright note present).
- Step ordering ✓ (migration 8 → identity 9; proto 6 → gen 7 → consumers; every non-frontend service
  step paired with a test step). Overlap ✓ (no impl-ready/in-progress features; carry-forward: 041
  also edits xstockstrat-ui at Step 18 — coordinate merge order). Migration 003 free; proto additive
  (TokenClaims.aud=6; 5 new RPCs; 8 existing untouched).
- **Substantive advisory for Security / impl review:** the agent `/oauth/callback` user-identity handoff
  (Steps 14/18) is under-specified and, as written, forgeable — agent is a different origin (UI session
  cookie won't reach it), the HMAC `txn` is created pre-login (no user_id), and trusting `?login=ok` is
  forgeable. Recommend: UI obtains a short-lived identity-signed assertion (one-time token / access JWT)
  post-login and forwards it to the agent callback; agent validates via identity `ValidateToken` to
  derive the real user_id. Resolve before /sdd-execute Steps 14/18. (sdd-spec also flagged the HMAC-txn
  approach for Security sign-off.)
- Housekeeping: fixed the stale `feature.md` Summary (still described API-key-as-token) to the
  JWT+refresh+audience / identity-backed-AS design.
- Status remains `implementation-ready`. Next: /sdd-execute unify-admin-auth-gates (or resolve the
  callback-handoff advisory first).

## Session 2026-06-06 — resolve callback-handoff advisory (same-origin cookie validation)

- User challenged the "different origin" premise of the prior advisory. Verified: it was wrong for prod.
  - DO is a **single path-routed ingress** — `/agent`→agent, `/`→UI under one domain (`.do/app.yaml:10-21`)
    → agent and UI are **same origin** in production.
  - UI session cookie `access_token` is `httpOnly`/`secure`/`sameSite:'lax'`/`path:'/'`
    (`services/xstockstrat-ui/src/lib/auth.ts:42-45`) → a top-level 302 to `{AGENT_PUBLIC_URL}/oauth/callback`
    (`${APP_URL}/agent/...`) **carries the cookie**. The cookie value is the identity-issued access JWT.
- **Resolution:** the forgeable-callback advisory is solved by deriving the user from the session cookie:
  the agent `/oauth/callback` reads the `access_token` cookie and validates it via identity `ValidateToken`
  → trustworthy `user_id`. Dropped the forgeable `?login=ok` proof. Non-forgeable (attacker can't mint a
  signed JWT).
- **Spec tightened (no scope change):**
  - impl-spec Step 14: added same-origin/cookie evidence; new `client.validate_token(token)->claims`
    helper; `/oauth/callback` now verifies `txn` HMAC + `state`, reads `access_token` cookie, validates
    via `ValidateToken` → `user_id` (re-redirect/401 if missing/invalid); header-prop note updated.
  - impl-spec Step 18: UI redirects to agent callback with `txn`+`state` ONLY (no token/user id/login=ok);
    cookie rides along same-origin; added the `pnpm run lint` gate the review flagged.
  - product-spec: flow steps (5)(6)(7), FR-B5/FR-B6, AC-B8 updated to the cookie→ValidateToken handoff.
- **Residual caveats kept on record:** (1) local docker-compose is cross-origin (UI :3000/agent :9000) →
  full round-trip only prod-testable; unit tests mock stubs. (2) cookie proves *authentication*; `state` +
  signed `txn` still bind the *authorization request* (consent/CSRF) — Security to confirm at execute.
- Status unchanged: `implementation-ready`.

## Session 2026-06-06 — sdd-execute (sequential, all 22 steps)

**Setup decisions (user-confirmed):**
- Branch model: all work on the harness branch `claude/sdd-execute-049-sequential-076Qx`; **single
  integration PR → `main-dev`** at the end (not the SDD stacked per-step-PR model). Reason: the harness
  pre-assigned this branch and forbids pushing elsewhere without permission.
- Scope: execute all 22 steps unattended in one pass.
- Spec artifacts were stranded on `claude/product-spec-049-ZiIXN` (never synced to main-dev; the dev
  branch `feature/unify-admin-auth-gates` does not exist on origin). Brought the four feature files into
  the working branch as the execution baseline.
- buf-breaking baseline (Step 6): `feature/unify-admin-auth-gates` is absent → fall back to `main-dev`
  per the spec's own note.

### Step 1 — ingest ManageSignalSource admin-scope gate swap [done]
- Replaced `_validate_admin_token` (identity ValidateApiKey re-auth) with a static `_has_admin_scope`
  (x-access-scope & 0x04) mirroring analysis; gate now aborts PERMISSION_DENIED. Removed `_identity`,
  the `identity_channel` ctor param, the `gen.identity.v1` import, and all identity wiring in main.py.
- Files modified: `services/xstockstrat-ingest/app/handlers/servicer.py`, `services/xstockstrat-ingest/app/main.py`
- Deviations: none

### Step 2 — ingest gate-swap coverage [done]
- Rewrote `make_servicer` (dropped `identity_channel`) and the `TestManageSignalSource` suite: admin
  scope "7" succeeds; scope "1" and missing scope → PERMISSION_DENIED. Removed ValidateApiKey/identity
  re-auth tests. `ruff` clean; `pytest --cov=app` 67% (≥40).
- Files modified: `services/xstockstrat-ingest/tests/test_ingest_servicer.py`
- Deviations: none

### Step 3 — indicators formula gate (OQ-A / FR-A4) [done]
- Added `_has_admin_scope` (x-access-scope & 0x04) to IndicatorsServicer. RegisterFormula no longer
  silently defaults author to "dev-user": explicit author wins, else falls back to propagated
  x-user-id, else aborts INVALID_ARGUMENT. UpdateFormula/DeleteFormula now allow an admin-scope
  override of the author-ownership check.
- Files modified: `services/xstockstrat-indicators/app/handlers/servicer.py`
- Deviations: none

### Step 4 — indicators formula gate coverage (AC-A3) [done]
- Added TestRegisterFormulaAuthorGate (x-user-id default, explicit author wins, abort without either)
  and TestFormulaAdminOverride (owner ok; non-owner admin override ok; non-owner no-admin denied; same
  for delete). `ruff` clean; `pytest --cov=app` 82% (≥50).
- Files modified: `services/xstockstrat-indicators/tests/test_formulas.py`
- Deviations: none

### Step 5 — agent manage_signal_source entry validation + scope forward (FR-A2, FR-A5) [done]
- tools.py manage_signal_source now calls client.validate_admin(admin_api_key) at entry (raises
  RuntimeError on failure), matching manage_strategy/set_strategy_live. client.py manage_signal_source
  now appends ("x-access-scope","7") to the metadata so ingest's new scope gate (Step 1) passes.
  Response shape unchanged (credentials_ref still never echoed).
- Files modified: `services/xstockstrat-agent/app/tools.py`, `services/xstockstrat-agent/app/client.py`
- Deviations: none (coverage verified later by Step 21).

### Step 6 — proto: additive identity OAuth RPCs + TokenClaims.aud [done]
- Added `aud = 6` to TokenClaims and 5 RPCs (RegisterOAuthClient, GetOAuthClient, IssueAuthCode,
  ExchangeAuthCode, RefreshOAuthToken) + 8 messages (OAuthClient, RegisterOAuthClientRequest,
  GetOAuthClientRequest, IssueAuthCodeRequest, IssueAuthCodeResponse, ExchangeAuthCodeRequest,
  OAuthTokenResponse, RefreshOAuthTokenRequest). All additive.
- Verification: `buf lint` OK; `buf breaking --against origin/main-dev` confirms non-breaking.
- Files modified: `packages/proto/identity/v1/identity.proto`
- Deviations: **CI-equivalent fallback** — host has no `buf`/Docker codegen container; installed the
  CI-pinned toolchain on the host (buf 1.69.0, protoc-gen-go v1.36.11, protoc-gen-go-grpc v1.6.2,
  protoc-gen-connect-go v1.19.2, grpcio-tools 1.80.0, pnpm 9.15.0) and ran the standard
  `scripts/buf-gen.sh`. Disposition: CI-equivalent fallback (see Deviation Log).

### Step 7 — proto-gen: regenerate stubs (Go, Python, TS) [done]
- Ran `./scripts/buf-gen.sh`; diff confined to `packages/proto/gen/{go,python,ts}/identity/v1/`.
  New RPCs confirmed in Python + TS stubs. Re-run is idempotent (no further diff) — mirrors the CI
  proto-freshness stale-stub gate.
- Files modified: generated stubs under `packages/proto/gen/`
- Deviations: none beyond the Step 6 toolchain fallback.

### Step 8 — migration: identity 003_oauth (oauth_clients + oauth_auth_codes) [done]
- Created 003_oauth.up.sql (oauth_clients PK client_id + redirect_uris TEXT[]; oauth_auth_codes PK
  code=SHA-256 hash, FK client_id/user_id ON DELETE CASCADE, code_challenge, resource, expires_at,
  consumed_at; idx_oauth_codes_client) and 003_oauth.down.sql (drop child then parent). Refresh tokens
  reuse identity.refresh_tokens (no new table).
- Verification: applied 000→003 up against a throwaway postgres:16, confirmed both tables in schema
  `identity`, applied 003 down, confirmed both dropped (reversible).
- Files created: `services/xstockstrat-identity/migrations/003_oauth.{up,down}.sql`
- Deviations: CI-equivalent fallback — no live TimescaleDB; reversibility proven via postgres:16
  throwaway container (sequential-mode DB fallback). Disposition: CI-equivalent fallback.

### Step 9 — identity OAuth RPC implementations [done]
- Implemented registerOAuthClient (https-only DCR, client_id=oauthc_<hex>), getOAuthClient (NOT_FOUND
  code 5), issueAuthCode (exact-redirect match, SHA-256 code hash, 60s TTL), exchangeAuthCode (PKCE
  S256 via base64url(sha256(verifier)), single-use/TTL/redirect/client checks → invalid_grant code 16,
  mints aud-bound JWT + rotating refresh), refreshOAuthToken (revoke+reissue rotation, aud-bound JWT).
  Added mintOAuthAccessToken/issueRefreshToken helpers; extended validateToken to surface aud.
  No index.ts change needed (service bound by descriptor; regenerated stubs include the methods).
- Files modified: `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts`
- Deviations: none. (Note: src/index.ts unchanged — confirmed registration is descriptor-based.)

### Step 10 — identity OAuth RPC coverage [done]
- Added tests: exchangeAuthCode PKCE happy path (aud in JWT), bad verifier/consumed/expired/redirect
  mismatch → invalid_grant; registerOAuthClient non-https rejected + valid clientId; refreshOAuthToken
  rotation (spy-pool asserts the revoked_at UPDATE) + unknown token; validateToken aud surfacing.
  18 tests pass; `pnpm run lint` 0 errors; `pnpm run test:coverage` EXIT=0.
- Files modified: `services/xstockstrat-identity/src/__tests__/identityServiceImpl.test.ts`
- Deviations: none (c8 reports 0% under --experimental-strip-types — a pre-existing quirk shared with
  CI; the threshold command exits 0, i.e. CI-equivalent).

### Step 11 — docs: identity OAuth backend + migration [done]
- Updated identity CLAUDE.md: eight→thirteen gRPC methods (naming the five OAuth RPCs), added an
  "OAuth 2.1 backend" subsection (aud-bound JWT, refresh reuse, PKCE/exact-redirect), and a
  Database/Migrations section documenting 003_oauth + the two tables.
- Files modified: `services/xstockstrat-identity/CLAUDE.md`
- Deviations: none

### Step 12 — agent OAuth discovery endpoints + AGENT_PUBLIC_URL (FR-B1/B2) [done]
- Added AGENT_PUBLIC_URL to main.py; created app/oauth_metadata.py (RFC 9728 protected-resource +
  RFC 8414 authorization-server metadata, S256/code/refresh_token capabilities). Refactored _run_sse
  into a build_sse_app() factory (testability) and registered the two .well-known routes. Added
  AGENT_PUBLIC_URL to docker-compose (http://localhost:9000) and both .do specs (${APP_URL}/agent).
- Files modified: app/oauth_metadata.py (new), app/main.py, docker-compose.yml, .do/app.dev.yaml, .do/app.yaml
- Deviations: user-approved agent ruff debt cleanup (see Deviation Log) — UP045/E501/F841 across
  app/tools.py + tests, behavior-preserving, needed for CI agent-lint to pass.

## Open Items
- (none yet)

### Step 13 — agent /oauth/register DCR endpoint (FR-B3) [done]
- Added client.register_oauth_client (gRPC RegisterOAuthClient, _metadata only). Created
  app/oauth_server.py with the register handler (https-only edge check, RFC 7591 public client →
  {client_id, redirect_uris}, 201). Registered POST /oauth/register in build_sse_app. (registration_enabled
  config gate is added in Step 20 per spec.)
- Files modified: app/oauth_server.py (new), app/client.py, app/main.py
- Deviations: none

### Step 14 — agent /oauth/authorize + /oauth/callback (FR-B4, FR-B6) [done]
- client.py: added get_oauth_client, issue_auth_code, validate_token. oauth_server.py: HMAC-signed
  txn helpers (_sign_txn/_verify_txn keyed on MCP_AGENT_SECRET); /oauth/authorize enforces
  response_type=code + S256 + registered client + exact redirect match, then 302s to
  {UI_BASE_URL}/auth/oauth-login with agent_cb+txn+state; /oauth/callback verifies txn HMAC + state,
  reads the same-origin access_token cookie, validates via ValidateToken → user_id (re-redirects to
  login if absent/invalid), mints the code and 302s to the client redirect with code+state. No
  user id ever trusted from a query param. Registered both GET routes.
- Files modified: app/oauth_server.py, app/client.py, app/main.py
- Deviations: none

### Step 15 — agent /oauth/token endpoint (FR-B7, FR-B7b) [done]
- client.py: added exchange_auth_code + refresh_oauth_token (gRPC to identity). oauth_server.py:
  POST /oauth/token branches on grant_type (authorization_code → ExchangeAuthCode; refresh_token →
  RefreshOAuthToken; else unsupported_grant_type 400); gRPC errors map to invalid_grant 400; tokens
  returned only in the JSON body. Registered the POST route.
- Files modified: app/oauth_server.py, app/client.py, app/main.py
- Deviations: none

### Step 16 — agent /sse 401+WWW-Authenticate + JWT aud validation (FR-B0/B8/B10) [done]
- auth.py: added validate_bearer_jwt(token) → ValidateToken + claims.aud == AGENT_PUBLIC_URL (rejects
  wrong-aud tokens); added _metadata (x-mcp-secret). main.py handle_sse: try JWT first, then the
  legacy api_key path (Bearer + ?api_key= deprecated fallback); on failure return 401 with
  WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource".
- Files modified: app/auth.py, app/main.py
- Deviations: none
