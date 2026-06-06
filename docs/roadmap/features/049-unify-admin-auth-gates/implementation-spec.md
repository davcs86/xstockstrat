# Implementation Spec: unify-admin-auth-gates

**Status**: `in-progress`
**Created**: 2026-06-06
**Feature**: `docs/roadmap/features/049-unify-admin-auth-gates/feature.md`
**Total Steps**: 22
**Feature Branch**: `feature/unify-admin-auth-gates`

---

## Execution Summary

This feature has two independent parts that can be built and merged in either order, but the
spec orders **Part A first** (smaller, self-contained internal-gate unification: ingest +
indicators + agent tool layer) because Part B is a large additive build that depends on a new
proto contract and an identity migration. **Part B** then proceeds bottom-up: proto contract →
codegen → identity migration → identity OAuth RPCs (durable client/code store, audience-bound
JWT mint, refresh rotation) → agent OAuth 2.1 HTTP facade (discovery, DCR, authorize, callback,
token, `/sse` 401+`aud` validation) → UI login-delegation completion → config keys → docs. Every
backend `service` step is paired with a `test` step that enforces the CI coverage threshold and
runs the language linter.

**OQ resolutions locked at /sdd-spec** (from the product spec recommendations):
- **OQ-A** (formula gate): keep author-ownership, add an admin-scope (`x-access-scope & 0x04`)
  override on `UpdateFormula`/`DeleteFormula`, and close the `RegisterFormula` gap by defaulting
  `author` to the propagated `x-user-id` (require it) instead of `"dev-user"`. → Step 3.
- **OQ-E** (discovery reachability): introduce a new `AGENT_PUBLIC_URL` env var (confirmed absent
  from all deployment files) used to build absolute `.well-known` + endpoint URLs. In DO it is set
  to `${APP_URL}/agent` (the agent is mounted under the `/agent` route prefix); in docker-compose
  to `http://localhost:9000`. → Steps 12, 19.
- **OQ-G** (`?api_key=` deprecation): keep the query-param fallback, mark it deprecated in code
  comments + docs; do not remove. → Steps 17, 22.
- **OQ-H** (TTLs): reuse identity's existing `identity.jwt.access_ttl_seconds` (default 900s) for
  the access JWT and `identity.jwt.refresh_ttl_seconds` (default 2592000s) for the refresh token —
  no new config keys for TTLs. → Step 10.

## Step Dependencies

- **Part A**: Steps 1–5 are independent of Part B. Step 2 [test] covers Step 1 [service] (ingest).
  Step 4 [test] covers Step 3 [service] (indicators). Step 5 [service] (agent tool layer) is
  covered by Step 21 [test] (agent test step is shared with Part B agent changes).
- Step 1 (ingest gate swap) and Step 5 (agent `manage_signal_source` entry validation +
  `x-access-scope` forward) are paired behaviorally (AC-A1/AC-A2) but live in different services;
  they may merge in either order — ingest's new gate reads `x-access-scope`, which the agent must
  forward, so for an end-to-end pass both must land.
- **Part B proto chain**: Step 6 [proto] → Step 7 [proto-gen] must run before any consumer
  (Steps 8–18). Step 8 [migration] must run before Step 9/10 (identity OAuth RPCs query the new
  tables). Step 9 [service] (identity OAuth RPCs) must land before Step 12–18 (agent calls them).
- Step 10 [test] covers Step 9 [service] (identity).
- Steps 12–17 (agent OAuth modules + main.py wiring) require Step 7 (generated identity stubs with
  the new RPCs). Step 18 (UI login delegation) requires Step 14 (agent `/oauth/callback`) to exist
  as the redirect target. Step 21 [test] covers Steps 5 + 12–17 (agent).
- Step 19 [config] (deployment env vars: `AGENT_PUBLIC_URL`) supports Steps 12/17.
- Step 20 [config] (`agent.oauth.*` config keys) supports Steps 13/16.
- Steps 11 and 22 [docs] last.

---

### Step 1 — service: ingest `ManageSignalSource` admin-scope gate swap (FR-A1, FR-A3)

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify
- `services/xstockstrat-ingest/app/main.py` — modify

**Reviewers**: `xstockstrat-ingest` (service owner) — Signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- Confirmed gate today: `_validate_admin_token` at `services/xstockstrat-ingest/app/handlers/servicer.py:47-62` re-authenticates via `self._identity.ValidateApiKey(...)` and checks `"admin" in claims.roles`.
- Single call site: `ManageSignalSource` at `servicer.py:427` (`is_admin = await self._validate_admin_token(context)` → aborts `UNAUTHENTICATED` at `:429`). Verified via the product-spec evidence and the only `_validate_admin_token` reference in the file.
- `_identity` wiring: constructed at `servicer.py:41-43` from `identity_channel`; `identity_channel` created at `app/main.py:60` and passed at `app/main.py:67`. `IDENTITY_ENDPOINT` env read at `app/main.py:34`.
- Target pattern: analysis `_has_admin_scope` at `services/xstockstrat-analysis/app/handlers/servicer.py:58-70` — `int(metadata.get("x-access-scope","0")) & 0x04`, abort `PERMISSION_DENIED` "admin scope required" (`:655-656`).
- `gen.identity.v1` import at `servicer.py:12` becomes unused after removal (also imported only for `_validate_admin_token`).

**Instructions**:
1. Add a static `_has_admin_scope(context) -> bool` to `IngestServicer` mirroring the analysis helper exactly: read `dict(context.invocation_metadata()).get("x-access-scope", "0")`, `int(...)` with a `(TypeError, ValueError)` guard, return `bool(scope & 0x04)`.
2. In `ManageSignalSource` (`:427-430`), replace the `_validate_admin_token` call + `UNAUTHENTICATED` abort with: `if not self._has_admin_scope(context): await context.abort(grpc.StatusCode.PERMISSION_DENIED, "admin scope required"); return`. (Note: status changes from `UNAUTHENTICATED` to `PERMISSION_DENIED` to match the analysis model and AC-A1.)
3. Delete `_validate_admin_token` (`:47-62`).
4. Remove the `_identity` attribute (`:41-43`) and the `identity_channel` constructor parameter (`:36`). Remove the now-unused `from gen.identity.v1 import identity_pb2, identity_pb2_grpc` import (`:12`).
5. In `app/main.py`: delete `IDENTITY_ENDPOINT` (`:34`), `identity_channel = grpc.aio.insecure_channel(IDENTITY_ENDPOINT)` (`:60`), and the `identity_channel=identity_channel` argument (`:67`).
6. Leave `credentials_ref` handling untouched (FR-A5 — already correct; never echoed by the servicer's `ManageSignalSourceResponse`).

**Verification**:
- `grep -n "_validate_admin_token\|identity_channel\|_identity\b\|identity_pb2" services/xstockstrat-ingest/app/handlers/servicer.py services/xstockstrat-ingest/app/main.py` — must return no matches (FR-A3 / AC-A4).
- `grep -n "_has_admin_scope" services/xstockstrat-ingest/app/handlers/servicer.py` — confirm the new helper + its call site in `ManageSignalSource`.

---

### Step 2 — test: ingest gate-swap coverage (AC-A1, AC-A4)

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_ingest_servicer.py` — modify

**Reviewers**: `xstockstrat-ingest` (service owner) — Signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- Existing servicer test file confirmed present: `services/xstockstrat-ingest/tests/test_ingest_servicer.py` (from the file inventory).
- Coverage gate for ingest is **40%** (root CLAUDE.md §CI/CD; `services/xstockstrat-ingest/CLAUDE.md` shows `--cov=app --cov-fail-under=40`).

**Instructions**:
1. Add/adjust tests for `ManageSignalSource`: (a) a fake context whose `invocation_metadata()` returns `x-access-scope: "7"` (admin bit set) succeeds (reaches `upsert_source`); (b) a context with `x-access-scope: "1"` (no admin bit) → `PERMISSION_DENIED`; (c) a context with no `x-access-scope` → `PERMISSION_DENIED`.
2. Remove/replace any test that asserted the old `ValidateApiKey` re-auth path or `UNAUTHENTICATED` behavior, and any test that constructed `IngestServicer(..., identity_channel=...)`.

**Verification**:
- `cd services/xstockstrat-ingest && ruff check . && ruff format --check . && pytest --cov=app --cov-fail-under=40` — confirm lint passes and coverage ≥ 40%.

---

### Step 3 — service: indicators formula gate (OQ-A / FR-A4)

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-indicators` (service owner) — Formula sandboxing, numeric precision, timeout enforcement, no side-effects from formula execution

**Codebase Evidence**:
- `RegisterFormula` at `servicer.py:135-167`; `author` defaults to `"dev-user"` at `:144` (`author = request.author if request.author else "dev-user"`) — the ungated gap.
- `UpdateFormula` author check at `servicer.py:211-215` (`if row["author"] != request.user_id: abort PERMISSION_DENIED "user_id does not match formula author"`).
- `DeleteFormula` author check at `servicer.py:236-240` (same pattern).
- Admin-scope reference pattern to copy: analysis `_has_admin_scope` (`services/xstockstrat-analysis/app/handlers/servicer.py:58-70`).
- The servicer has no `context.invocation_metadata()` reads today (grep within this file: only `RegisterFormula`/`Update`/`Delete` use `request.*`), so a `_has_admin_scope` helper must be **created from scratch** in this servicer (mirroring analysis).

**Instructions**:
1. Add a static `_has_admin_scope(context) -> bool` helper mirroring the analysis helper (same `x-access-scope & 0x04` logic).
2. **`RegisterFormula` gap close**: change the `author` default. Read `x-user-id` from `dict(context.invocation_metadata()).get("x-user-id", "")`. If `request.author` is set, keep it; else if `x-user-id` is present, default `author` to it; else abort `INVALID_ARGUMENT` "authenticated user required to register a formula" (no more silent `"dev-user"`).
3. **`UpdateFormula` admin override**: at `:211`, change the gate to `if row["author"] != request.user_id and not self._has_admin_scope(context):` before the `PERMISSION_DENIED` abort. (Ownership still passes for the owner; admins with the access-scope bit may override.)
4. **`DeleteFormula` admin override**: same change at `:236`.

**Verification**:
- `grep -n "dev-user" services/xstockstrat-indicators/app/handlers/servicer.py` — must return no matches (gap closed).
- `grep -n "_has_admin_scope" services/xstockstrat-indicators/app/handlers/servicer.py` — confirm helper + both override sites.

---

### Step 4 — test: indicators formula gate coverage (AC-A3)

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_formulas.py` — modify

**Reviewers**: `xstockstrat-indicators` (service owner) — Formula sandboxing, numeric precision, timeout enforcement, no side-effects from formula execution

**Codebase Evidence**:
- Existing formula test file confirmed present: `services/xstockstrat-indicators/tests/test_formulas.py` (file inventory).
- Coverage gate for indicators is **50%** (`services/xstockstrat-indicators/CLAUDE.md`: `--cov-fail-under=50`).

**Instructions**:
1. `RegisterFormula`: test that with `x-user-id` metadata and no `request.author`, the stored `author` equals the `x-user-id`; test that with neither `request.author` nor `x-user-id`, it aborts `INVALID_ARGUMENT`.
2. `UpdateFormula`/`DeleteFormula`: test (a) owner (`user_id == author`) succeeds with no admin scope; (b) non-owner with `x-access-scope: "7"` succeeds (admin override); (c) non-owner with no admin scope → `PERMISSION_DENIED`.

**Verification**:
- `cd services/xstockstrat-indicators && ruff check . && ruff format --check . && pytest --cov=app --cov-fail-under=50` — confirm lint passes and coverage ≥ 50%.

---

### Step 5 — service: agent `manage_signal_source` entry validation + scope forward (FR-A2, FR-A5)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify
- `services/xstockstrat-agent/app/client.py` — modify

**Reviewers**: `xstockstrat-agent` (service owner) — Part A entry validation; Part B OAuth 2.1 AS/RS endpoints, PKCE, code store, gRPC, SSE backward-compat

**Codebase Evidence**:
- `manage_signal_source` tool at `app/tools.py:319-351` has **no** `validate_admin` entry check (confirmed: the `validate_admin` calls at `:265` and `:364` belong to `manage_strategy` and `set_strategy_live`).
- `client.validate_admin(api_key)` at `app/client.py:374-392` (`ValidateApiKey` → `"admin" in claims.roles`).
- `client.manage_signal_source` at `app/client.py:329-371` forwards `metadata=_admin_metadata(api_key)` (`:361`) but **no** `x-access-scope`. Compare to `manage_strategy` (`app/client.py:227`) and `set_strategy_live` (`app/client.py:405`), which append `[("x-access-scope", "7")]`.
- FR-A5 already satisfied: `client.manage_signal_source` return dict (`:364-371`) omits `credentials_ref` (comment at `:363`).

**Instructions**:
1. In `app/tools.py` `manage_signal_source` (`:319`), add an entry guard at the top of the `try`-free section, mirroring `manage_strategy` (`:265-266`): `if not await client.validate_admin(admin_api_key): raise RuntimeError("admin API key required")`.
2. In `app/client.py` `manage_signal_source` (`:359-361`), build `meta = list(_admin_metadata(api_key)) + [("x-access-scope", "7")]` and pass `metadata=meta` to `stub.ManageSignalSource`, matching `set_strategy_live` (`:405`). This is required because ingest's new gate (Step 1) reads `x-access-scope`.
3. Do not change the response shape (FR-A5 — `credentials_ref` still never echoed).

**Verification**:
- `grep -n "validate_admin" services/xstockstrat-agent/app/tools.py` — confirm a call inside `manage_signal_source` (in addition to the existing `manage_strategy`/`set_strategy_live` calls).
- `grep -n "x-access-scope" services/xstockstrat-agent/app/client.py` — confirm `manage_signal_source` now appends it (3 total occurrences: manage_strategy, set_strategy_live, manage_signal_source).

> Header propagation note (§5c): this step adds no new outbound gRPC client — it reuses the existing `_admin_metadata` + `_metadata` (`x-mcp-secret`) path on the already-wired ingest `ManageSignalSource` call (`app/client.py:359-361`), and additionally forwards `x-access-scope`. No new propagation mechanism required.

---

### Step 6 — proto: additive identity OAuth RPCs + `TokenClaims.aud`

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/identity/v1/identity.proto` — modify

**Reviewers**: Proto Reviewer — Field number uniqueness per message, no breaking changes without deprecation comment, `buf lint`/`buf breaking` pass; `xstockstrat-identity` (service owner) — JWT expiry and rotation, API key scoping, secret store integration

**Codebase Evidence**:
- Current service block: `packages/proto/identity/v1/identity.proto:9-18` (8 RPCs). `TokenClaims` at `:32-38` (fields 1–5). `AuthTokenResponse` at `:25-30`.
- `go_package` option at `:5`; imports `google/protobuf/timestamp.proto` at `:7`.
- Governance: additive only (product spec Proto Contract Changes) — new RPCs + new messages + a new field on `TokenClaims` (next field number `6`). No existing field/RPC renumbered.

**Instructions**:
1. Add `aud` to `TokenClaims` as **field 6**: `string aud = 6;` (audience/resource URI; existing readers ignore it — additive).
2. Add five RPCs to `service IdentityService`:
   - `rpc RegisterOAuthClient(RegisterOAuthClientRequest) returns (OAuthClient);`
   - `rpc GetOAuthClient(GetOAuthClientRequest) returns (OAuthClient);`
   - `rpc IssueAuthCode(IssueAuthCodeRequest) returns (IssueAuthCodeResponse);`
   - `rpc ExchangeAuthCode(ExchangeAuthCodeRequest) returns (OAuthTokenResponse);`
   - `rpc RefreshOAuthToken(RefreshOAuthTokenRequest) returns (OAuthTokenResponse);`
3. Add messages (use `repeated string redirect_uris` for DCR; `google.protobuf.Timestamp created_at`):
   - `OAuthClient { string client_id = 1; repeated string redirect_uris = 2; string client_name = 3; google.protobuf.Timestamp created_at = 4; }`
   - `RegisterOAuthClientRequest { repeated string redirect_uris = 1; string client_name = 2; }`
   - `GetOAuthClientRequest { string client_id = 1; }`
   - `IssueAuthCodeRequest { string user_id = 1; string client_id = 2; string redirect_uri = 3; string code_challenge = 4; string resource = 5; }`
   - `IssueAuthCodeResponse { string code = 1; }`
   - `ExchangeAuthCodeRequest { string code = 1; string code_verifier = 2; string redirect_uri = 3; string client_id = 4; string resource = 5; }`
   - `OAuthTokenResponse { string access_token = 1; string token_type = 2; int64 expires_in = 3; string refresh_token = 4; }`
   - `RefreshOAuthTokenRequest { string refresh_token = 1; string resource = 2; }`
4. Follow root CLAUDE.md proto governance: enums only where value sets are closed — none needed here (all string/identifier fields are open). Every message starts field numbering at 1.

**Verification**:
- `cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/unify-admin-auth-gates"` — both must pass (additive ⇒ non-breaking). (Per the feature-workflow proto-verification convention. If the branch ref is unavailable locally, fall back to `--against ".git#branch=main-dev"` as `scripts/buf-gen.sh` does.)

---

### Step 7 — proto-gen: regenerate stubs (Go, Python, TS)

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/identity/v1/` — modify (generated)
- `packages/proto/gen/python/identity/v1/` — modify (generated)
- `packages/proto/gen/ts/identity/v1/` — modify (generated)

**Reviewers**: Proto Reviewer — Field number uniqueness per message, no breaking changes without deprecation comment, `buf lint`/`buf breaking` pass; `xstockstrat-identity` (service owner) — JWT expiry and rotation, API key scoping, secret store integration

**Codebase Evidence**:
- `./scripts/buf-gen.sh` generates Go + TS via `buf generate` and Python via `grpcio-tools` (`scripts/buf-gen.sh:45-90`), then compiles TS to JS via `pnpm --filter @xstockstrat/proto run build` (`:88+`).
- Agent imports the generated Python identity stubs as `from gen.identity.v1 import identity_pb2, identity_pb2_grpc` (`services/xstockstrat-agent/app/auth.py:12`, `app/client.py:382`); the agent test harness registers `packages/proto/gen/python` as the `gen` namespace (`tests/conftest.py:9-30`).
- Identity (Node) imports `@xstockstrat/proto/identity/v1/identity` (`services/xstockstrat-identity/src/index.ts:5`).

**Instructions**:
1. Run `./scripts/buf-gen.sh` from repo root.
2. Commit the proto source (Step 6) **and** all regenerated stubs together (proto-freshness CI gate).

**Verification**:
- `./scripts/buf-gen.sh && git diff --stat packages/proto/gen/` — after running, `git status` for `packages/proto/gen/` must be clean (re-running produces no diff), confirming stubs match the proto (proto-freshness rule, `docs/runbooks/proto-versioning.md`).
- `grep -rn "RegisterOAuthClient\|ExchangeAuthCode\|RefreshOAuthToken" packages/proto/gen/python/identity/v1/ packages/proto/gen/ts/identity/v1/` — confirm the new RPCs appear in generated stubs.

---

### Step 8 — migration: identity `003_oauth` (oauth_clients + oauth_auth_codes)

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/migrations/003_oauth.up.sql` — create
- `services/xstockstrat-identity/migrations/003_oauth.down.sql` — create

**Reviewers**: DBA — Migration NNN numbering (no gaps), up+down pair present, index correctness, run-order compliance; `xstockstrat-identity` (service owner) — JWT expiry and rotation, API key scoping, secret store integration

**Codebase Evidence**:
- Last identity migration is `002_seed_admin.up.sql` / `.down.sql` (file inventory) → next is `003` (no gap). Naming convention `NNN_description.up.sql` + `.down.sql` (root CLAUDE.md §Database).
- Schema is `identity` (`migrations/001_identity_tables.up.sql:4` `CREATE SCHEMA IF NOT EXISTS identity;`); existing tables use `gen_random_uuid()`, `TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `TEXT[]` (`001_identity_tables.up.sql:6-37`).
- Refresh tokens reuse `identity.refresh_tokens` (`001_identity_tables.up.sql:27-34`) — **no new table** for refresh (product spec Database Changes).

**Instructions**:
1. `003_oauth.up.sql` (schema `identity`):
   - `oauth_clients`: `client_id TEXT PRIMARY KEY`, `redirect_uris TEXT[] NOT NULL DEFAULT '{}'`, `client_name TEXT`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
   - `oauth_auth_codes`: `code TEXT PRIMARY KEY` (store the **SHA-256 hash** of the code, matching the api_keys/refresh_tokens hashing convention), `client_id TEXT NOT NULL REFERENCES identity.oauth_clients(client_id) ON DELETE CASCADE`, `user_id UUID NOT NULL REFERENCES identity.users(user_id) ON DELETE CASCADE`, `redirect_uri TEXT NOT NULL`, `code_challenge TEXT NOT NULL`, `resource TEXT`, `expires_at TIMESTAMPTZ NOT NULL`, `consumed_at TIMESTAMPTZ`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
   - Index: `CREATE INDEX IF NOT EXISTS idx_oauth_codes_client ON identity.oauth_auth_codes (client_id);`
2. `003_oauth.down.sql`: `DROP TABLE IF EXISTS identity.oauth_auth_codes; DROP TABLE IF EXISTS identity.oauth_clients;` (drop the child table first).
3. Never edit `000`–`002` (root CLAUDE.md §Database).

**Verification**:
- `ls services/xstockstrat-identity/migrations/ | sort` — confirm `003_oauth.up.sql` and `003_oauth.down.sql` are the highest-numbered pair with no gap after `002`.
- `cd services/xstockstrat-identity && pnpm run migrate` (or `scripts/db-migrate.sh` against a local TimescaleDB) — confirm migration applies cleanly; then verify both tables exist in schema `identity`.

---

### Step 9 — service: identity OAuth RPC implementations (FR-B3/B6/B7/B7b/B8 backend)

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts` — modify
- `services/xstockstrat-identity/src/index.ts` — modify (no change expected; service registration is by `IdentityServiceService` — see Instructions)

**Reviewers**: `xstockstrat-identity` (service owner) — JWT expiry and rotation, API key scoping, secret store integration

**Codebase Evidence**:
- Service registered via `grpcServer.addService(IdentityServiceService, identityImpl ...)` at `src/index.ts:44-47` — adding methods to `IdentityServiceImpl` whose names match the generated service descriptor is sufficient; **no `index.ts` change needed** beyond confirming the regenerated `IdentityServiceService` (Step 7) now includes the new methods.
- JWT mint pattern: `(jwt as any).sign(claimsPayload, this.jwtSecret, { expiresIn: this.accessTtlSeconds })` (`identityServiceImpl.ts:80-82`), claims `{ user_id, email, roles, issued_at, expires_at }` (`:72-78`).
- TTLs: `this.accessTtlSeconds` (`:38-40`, default 900) and `this.refreshTtlSeconds` (`:42-44`, default 2592000) — reuse for OQ-H.
- Refresh insert/rotate pattern: `INSERT INTO identity.refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,NOW()+($3||' seconds')::interval)` (`:87-91`) and rotation `UPDATE identity.refresh_tokens SET revoked_at = NOW() WHERE token_id = $1` (`:157-160`) inside `refreshToken` (`:135-195`).
- Hashing convention: `crypto.createHash('sha256').update(x).digest('hex')` (`:85`, `:249`).
- gRPC handler shape: `async method(call, callback)`, `call.request` camelCase fields, error via `callback({ code, message })` (codes used: 3 INVALID_ARGUMENT, 16 UNAUTHENTICATED, 13 INTERNAL). `secondsToDate` helper at `:18-20`.
- `validateToken` decodes JWT and returns claims (`:115-130`) — extend to surface `aud`.

**Instructions**:
1. **`registerOAuthClient(call, callback)`**: validate each `redirectUris` entry is `https://` (or matches the config allowlist — see Step 20; for this step, enforce `https://` minimum); generate `client_id = "oauthc_" + crypto.randomBytes(16).toString('hex')`; `INSERT INTO identity.oauth_clients (client_id, redirect_uris, client_name) VALUES ($1,$2,$3)`; return `{ clientId, redirectUris, clientName, createdAt: <Date> }`.
2. **`getOAuthClient(call, callback)`**: `SELECT ... FROM identity.oauth_clients WHERE client_id = $1`; 16/NOT_FOUND-style abort if absent (use code 5 NOT_FOUND).
3. **`issueAuthCode(call, callback)`**: validate the `clientId` exists and the `redirectUri` exactly matches one of its `redirect_uris`; generate an opaque code, store its SHA-256 hash in `identity.oauth_auth_codes` with `expires_at = NOW() + interval '60 seconds'`, `code_challenge`, `user_id`, `redirect_uri`, `resource`, `client_id`; return `{ code: <raw code> }`.
4. **`exchangeAuthCode(call, callback)`**: look up by SHA-256(`code`); reject (code 16, message `invalid_grant`-mappable) if missing, `consumed_at IS NOT NULL`, or `expires_at <= NOW()`; verify exact `redirect_uri` + `client_id` match the stored row; verify PKCE: `base64url(sha256(code_verifier)) === code_challenge` (S256); set `consumed_at = NOW()` (single-use); mint a JWT access token with the same claim shape **plus `aud: <stored resource>`** and `expiresIn: this.accessTtlSeconds`; mint + store a rotating refresh token (reuse the refresh_tokens insert pattern, keyed to `user_id`); return `{ accessToken, tokenType: "Bearer", expiresIn: this.accessTtlSeconds, refreshToken }`.
5. **`refreshOAuthToken(call, callback)`**: reuse the existing `refreshToken` rotation logic (validate + revoke old + insert new in `identity.refresh_tokens`), but mint the new access JWT with `aud: <request.resource>`; return `OAuthTokenResponse` shape. Old refresh invalidated (rotation, FR-B7b).
6. **`validateToken` extension (FR-B8 support)**: in the `validateToken` response (`:120-126`), add `aud: decoded.aud ?? ''` so the agent RS can read it from `TokenClaims.aud`.
7. Put the resource URI into the JWT `aud` claim wherever a token is minted for OAuth (steps 4 & 5). Use the JWT lib's native `aud` or a top-level `aud` claim that `validateToken`'s `jwt.verify` returns under `decoded.aud`.

**Verification**:
- `grep -n "registerOAuthClient\|getOAuthClient\|issueAuthCode\|exchangeAuthCode\|refreshOAuthToken" services/xstockstrat-identity/src/grpc/identityServiceImpl.ts` — confirm all five methods present.
- `grep -n "aud" services/xstockstrat-identity/src/grpc/identityServiceImpl.ts` — confirm `aud` is set on mint and surfaced in `validateToken`.
- Covered by Step 10 test/coverage gate.

---

### Step 10 — test: identity OAuth RPC coverage (AC-B2/B3/B4/B5)

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/__tests__/identityServiceImpl.test.ts` — modify

**Reviewers**: `xstockstrat-identity` (service owner) — JWT expiry and rotation, API key scoping, secret store integration

**Codebase Evidence**:
- Test harness uses a fake pool (`makePool(rows, throws)` at `identityServiceImpl.test.ts:36-43`) and `makeImpl` injecting `config.getInt` defaults (`:45-50`), `makeCall(req)` (`:52-54`) — no real DB. Existing tests assert callback codes and JWT round-trips with `jsonwebtoken` (`:14`).
- Coverage gate: `pnpm run test:coverage` runs `c8 ... --lines 40` (`package.json:13`).

**Instructions**:
1. `exchangeAuthCode`: PKCE happy path (correct `code_verifier` → `accessToken` + `refreshToken` returned, decoded JWT carries `aud`); bad `code_verifier` → error mappable to `invalid_grant`; consumed/expired code → error; non-matching `redirect_uri` → error (AC-B3).
2. `registerOAuthClient`: non-`https://` redirect rejected; valid returns a `clientId`.
3. `refreshOAuthToken`: returns a new access JWT (with `aud`) + a new refresh token; assert the rotation `UPDATE ... revoked_at` query is issued via a spy on the fake pool (AC-B5).
4. `validateToken`: a JWT signed with an `aud` claim surfaces `aud` in the response (supports FR-B8).
5. Keep the lazy-import skip guard pattern (`before(async () => { try { ... } catch {} })`, `:23-30`).

**Verification**:
- `cd services/xstockstrat-identity && pnpm run lint && pnpm run test:coverage` — confirm lint passes and coverage threshold (`--lines 40`) holds.

---

### Step 11 — docs: identity OAuth backend + migration

**Status**: `pending`
**Service**: `docs/` / `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-identity/CLAUDE.md` documents the gRPC method list ("all eight methods") and the migration/table set — both now stale after Steps 6/8/9.

**Instructions**:
1. Update the gRPC method list in `xstockstrat-identity/CLAUDE.md` ("eight methods" → thirteen, naming the five new OAuth RPCs).
2. Document migration `003_oauth` and the `oauth_clients` / `oauth_auth_codes` tables under the existing DB/migration notes.
3. Note that the OAuth access token is an `aud`-bound JWT and the refresh token reuses `identity.refresh_tokens`.

**Verification**:
- `grep -n "RegisterOAuthClient\|003_oauth\|oauth_clients" services/xstockstrat-identity/CLAUDE.md` — confirm the additions.

---

### Step 12 — service: agent OAuth discovery endpoints + `AGENT_PUBLIC_URL` (FR-B1, FR-B2)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/oauth_metadata.py` — create
- `services/xstockstrat-agent/app/main.py` — modify
- `docker-compose.yml` — modify
- `.do/app.dev.yaml` — modify
- `.do/app.yaml` — modify

**Reviewers**: `xstockstrat-agent` (service owner) — Part B OAuth 2.1 AS/RS endpoints, PKCE, code store, gRPC, SSE backward-compat

**Codebase Evidence**:
- Starlette routes today: `Route("/sse", ...)` + `Mount("/messages", ...)` only (`app/main.py:80-85`). No `/.well-known` routes — these modules must be **created from scratch**.
- `UI_BASE_URL` is read at `app/main.py:27` with a `TODO(019)` placeholder (`:28-30`).
- `AGENT_PUBLIC_URL` **confirmed absent** from all source and deployment files: `grep -rn "AGENT_PUBLIC_URL" docker-compose.yml .do/app.dev.yaml .do/app.yaml services/` → no match.
- Agent env block in `docker-compose.yml:486-499` (ends with `UI_BASE_URL: http://localhost:3000`); DO agent `envs:` block in `.do/app.dev.yaml` and `.do/app.yaml` ends with `UI_BASE_URL` → `value: ${APP_URL}` (`.do/app.dev.yaml:259-260`, `.do/app.yaml:259-260`). Route rule mounts the agent under `prefix: /agent` (`.do/app.dev.yaml`).

**Instructions**:
1. Add `AGENT_PUBLIC_URL = os.environ.get("AGENT_PUBLIC_URL", "http://localhost:9000")` in `app/main.py` alongside the other env reads.
2. Create `app/oauth_metadata.py` with two async Starlette handlers returning `JSONResponse`:
   - `/.well-known/oauth-protected-resource` (RFC 9728): `{ "resource": AGENT_PUBLIC_URL, "authorization_servers": [AGENT_PUBLIC_URL] }`.
   - `/.well-known/oauth-authorization-server` (RFC 8414): `{ "issuer": AGENT_PUBLIC_URL, "authorization_endpoint": f"{AGENT_PUBLIC_URL}/oauth/authorize", "token_endpoint": f"{AGENT_PUBLIC_URL}/oauth/token", "registration_endpoint": f"{AGENT_PUBLIC_URL}/oauth/register", "code_challenge_methods_supported": ["S256"], "response_types_supported": ["code"], "grant_types_supported": ["authorization_code", "refresh_token"] }`.
3. Register both routes in the Starlette app in `_run_sse` (`app/main.py:80-85`).
4. **docker-compose.yml** agent block (after `UI_BASE_URL` at `:499`): add `AGENT_PUBLIC_URL: http://localhost:9000` (confirmed absent via grep above).
5. **.do/app.dev.yaml** + **.do/app.yaml** agent `envs:` (after the `UI_BASE_URL` entry): add `- key: AGENT_PUBLIC_URL` / `value: ${APP_URL}/agent` (the agent is served under the `/agent` route prefix — OQ-E). Confirmed absent via the same grep.

**Verification**:
- `grep -n "AGENT_PUBLIC_URL" docker-compose.yml .do/app.dev.yaml .do/app.yaml services/xstockstrat-agent/app/main.py` — confirm present in all four with the values above.
- Covered behaviorally by Step 21 (assert both `.well-known` handlers return the expected JSON shape).

---

### Step 13 — service: agent `/oauth/register` DCR endpoint (FR-B3)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/oauth_server.py` — create
- `services/xstockstrat-agent/app/client.py` — modify
- `services/xstockstrat-agent/app/main.py` — modify

**Reviewers**: `xstockstrat-agent` (service owner) — Part B OAuth 2.1 AS/RS endpoints, PKCE, code store, gRPC, SSE backward-compat

**Codebase Evidence**:
- Agent→identity gRPC client pattern: `app/client.py:374-392` (`validate_admin` opens `grpc.aio.insecure_channel(IDENTITY_ENDPOINT)`, builds `IdentityServiceStub`, calls with `metadata=_metadata()`). `IDENTITY_ENDPOINT` at `app/client.py:21`. New `from gen.identity.v1 import identity_pb2, identity_pb2_grpc` already imported lazily there.
- `_metadata()` adds `x-mcp-secret` (`app/client.py:24-27`).
- No `/oauth/*` routes today (`app/main.py:80-85`) — `app/oauth_server.py` is **created from scratch**.

**Instructions**:
1. In `app/client.py`, add an async helper `register_oauth_client(redirect_uris: list[str], client_name: str) -> dict` that calls `stub.RegisterOAuthClient(identity_pb2.RegisterOAuthClientRequest(redirect_uris=..., client_name=...), metadata=_metadata())` on `IDENTITY_ENDPOINT` and returns `{client_id, redirect_uris}`.
2. In `app/oauth_server.py`, add an async Starlette handler `register(request)` for `POST /oauth/register`: parse JSON body (`redirect_uris`, `client_name`); reject (`JSONResponse(400)`) if registration is disabled (Step 20 config) or any redirect URI is not `https://` (allowlist check deferred to identity per Step 9, but enforce `https://` at the edge too); call `client.register_oauth_client(...)`; return `{ "client_id": ..., "redirect_uris": ... }` (RFC 7591 — public client, no secret).
3. Register the route in `app/main.py` `_run_sse`.

**Verification**:
- `grep -n "RegisterOAuthClient\|register_oauth_client" services/xstockstrat-agent/app/client.py services/xstockstrat-agent/app/oauth_server.py` — confirm wiring.
- Covered by Step 21.

> Header propagation note (§5c): `register_oauth_client` adds a **new outbound gRPC call** to identity. DCR is an unauthenticated edge call (no inbound user context yet), so there is no `x-user-id`/`x-access-scope` to forward; it reuses the existing `_metadata()` (`x-mcp-secret`) helper exactly as `validate_admin` does (`app/client.py:388`). No user-header propagation applies at this pre-login stage.

---

### Step 14 — service: agent `/oauth/authorize` + `/oauth/callback` (FR-B4, FR-B6)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/oauth_server.py` — modify
- `services/xstockstrat-agent/app/client.py` — modify
- `services/xstockstrat-agent/app/main.py` — modify

**Reviewers**: `xstockstrat-agent` (service owner) — Part B OAuth 2.1 AS/RS endpoints, PKCE, code store, gRPC, SSE backward-compat

**Codebase Evidence**:
- `UI_BASE_URL` redirect target intended at `app/main.py:26-30` (`TODO(019)` → `{UI_BASE_URL}/auth/oauth-login`). The UI page exists (`services/xstockstrat-ui/src/app/auth/oauth-login/page.tsx`) and reads `redirect_uri` + `state` query params (`:9-11`).
- `getOAuthClient` gRPC RPC added in Steps 6/9 for exact-redirect validation; `issueAuthCode` for code minting. Agent gRPC pattern as in Step 13.
- `RedirectResponse` is available from `starlette.responses` (already importing `Response` at `app/main.py:51`).
- **Same-origin user handoff (verified):** in DO production the app is a single path-routed ingress — `/agent` → agent, `/` → UI (`.do/app.yaml:10-21`), so the UI and the agent callback share one origin. The UI session cookie `access_token` is set `httpOnly`, `secure`, `sameSite: 'lax'`, `path: '/'` (`services/xstockstrat-ui/src/lib/auth.ts:42-45`), so a top-level 302 to `{AGENT_PUBLIC_URL}/oauth/callback` (= `${APP_URL}/agent/oauth/callback`) **carries that cookie**. The cookie value is the identity-issued access JWT (stored verbatim by the BFF login route from `AuthenticateUser`), so the agent can derive a trustworthy `user_id` by validating it via identity `ValidateToken` — **not** by trusting a query param. (Local docker-compose is cross-origin — UI `:3000` vs agent `:9000` — so the full browser round-trip is only end-to-end testable in a prod-like single-origin setup; unit tests mock the identity stubs.)

**Instructions**:
1. `GET /oauth/authorize` handler: require `response_type=code`, `code_challenge_method=S256` (reject otherwise), a registered `client_id` (call `client.get_oauth_client`), and an **exact-match** `redirect_uri` against the client's registered list (no wildcard). Capture `state`, `code_challenge`, `resource`. On success, 302-redirect (`RedirectResponse`) to `{UI_BASE_URL}/auth/oauth-login` carrying the agent callback URL (`{AGENT_PUBLIC_URL}/oauth/callback`), `state`, and an opaque server-side-free transaction blob (encode `client_id`, `redirect_uri`, `code_challenge`, `resource`, `state` into a signed/encoded `txn` query param so the agent stays stateless — FR-B13). Use the existing `MCP_AGENT_SECRET` to HMAC-sign the `txn` blob.
2. Add `client.get_oauth_client(client_id) -> dict`, `client.issue_auth_code(user_id, client_id, redirect_uri, code_challenge, resource) -> str`, and `client.validate_token(token) -> dict` (gRPC `ValidateToken` → returns the `TokenClaims` incl. `user_id`) to `app/client.py` (gRPC to identity, `metadata=_metadata()`).
3. `GET /oauth/callback` handler — **derive the user from the same-origin session cookie, never from a query param** (closes the forgeable-callback gap):
   - Read the `txn` + `state` query params; **verify the `txn` HMAC** (signed in instruction 1) and that `state` matches the value inside `txn`.
   - Read the **`access_token` cookie** from the request (delivered same-origin per the evidence above). If absent, redirect the browser back to `{UI_BASE_URL}/auth/oauth-login?...` to authenticate (not yet logged in).
   - Call `client.validate_token(access_token)`; if it fails, return 401 / re-redirect to login. On success take `user_id` from the validated claims. **Do not** trust any `login=ok`-style flag.
   - Call `client.issue_auth_code(user_id, client_id, redirect_uri, code_challenge, resource)` using the `txn`-carried request context; 302-redirect to the client's registered `redirect_uri` with `code` + `state` (FR-B6).
4. Register both routes in `app/main.py`.

**Verification**:
- `grep -n "oauth/authorize\|oauth/callback\|issue_auth_code\|get_oauth_client" services/xstockstrat-agent/app/oauth_server.py services/xstockstrat-agent/app/client.py services/xstockstrat-agent/app/main.py` — confirm handlers + client helpers + route registration.
- Covered by Step 21 (exact-redirect-mismatch → 400; S256 required).

> Header propagation note (§5c): `get_oauth_client`, `issue_auth_code`, and `validate_token` are new outbound gRPC calls to identity made during the OAuth handshake. `validate_token` establishes the `user_id` from the session cookie (the agent reads it from the validated claims, not from an inbound header); the other two take `user_id`/`client_id` as arguments. All reuse `_metadata()` (`x-mcp-secret`); no `x-user-id`/`x-access-scope`/`x-trace-id` exist to forward at this pre-token stage.

---

### Step 15 — service: agent `/oauth/token` endpoint (FR-B7, FR-B7b)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/oauth_server.py` — modify
- `services/xstockstrat-agent/app/client.py` — modify
- `services/xstockstrat-agent/app/main.py` — modify

**Reviewers**: `xstockstrat-agent` (service owner) — Part B OAuth 2.1 AS/RS endpoints, PKCE, code store, gRPC, SSE backward-compat

**Codebase Evidence**:
- `ExchangeAuthCode` / `RefreshOAuthToken` gRPC RPCs added in Steps 6/9 return `OAuthTokenResponse` (`access_token`, `token_type`, `expires_in`, `refresh_token`).
- Agent gRPC client pattern as in Step 13 (`grpc.aio.insecure_channel(IDENTITY_ENDPOINT)`).

**Instructions**:
1. Add `client.exchange_auth_code(code, code_verifier, redirect_uri, client_id, resource) -> dict` and `client.refresh_oauth_token(refresh_token, resource) -> dict` to `app/client.py` (gRPC to identity).
2. `POST /oauth/token` handler: branch on `grant_type`:
   - `authorization_code`: read `code`, `code_verifier`, `redirect_uri`, `client_id`, `resource`; call `client.exchange_auth_code(...)`; on gRPC error return `JSONResponse({"error": "invalid_grant"}, 400)`; on success return `{access_token, token_type, expires_in, refresh_token}` as JSON (never in a query string — FR-B7).
   - `refresh_token`: read `refresh_token`, `resource`; call `client.refresh_oauth_token(...)`; same error/success mapping (FR-B7b — rotation handled in identity).
   - any other grant → `JSONResponse({"error": "unsupported_grant_type"}, 400)`.
3. Register the route in `app/main.py`.

**Verification**:
- `grep -n "oauth/token\|exchange_auth_code\|refresh_oauth_token\|invalid_grant" services/xstockstrat-agent/app/oauth_server.py services/xstockstrat-agent/app/client.py` — confirm both grant branches + error mapping.
- Covered by Step 21 (auth-code success → JWT; refresh → new token pair).

> Header propagation note (§5c): new outbound gRPC calls to identity; pre-/at-token-issuance, no inbound platform user headers exist. Reuse `_metadata()` (`x-mcp-secret`). Consistent with Steps 13–14.

---

### Step 16 — service: agent `/sse` 401+`WWW-Authenticate` + JWT `aud` validation (FR-B0, FR-B8, FR-B10)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/auth.py` — modify
- `services/xstockstrat-agent/app/main.py` — modify

**Reviewers**: `xstockstrat-agent` (service owner) — Part B OAuth 2.1 AS/RS endpoints, PKCE, code store, gRPC, SSE backward-compat

**Codebase Evidence**:
- `handle_sse` builds `auth_header` from the `authorization` header or the `?api_key=` fallback (`app/main.py:60-74`), calls `await validate_api_key(auth_header)` (`:71`), and returns a bare `Response("Unauthorized", status_code=401)` with **no** `WWW-Authenticate` header (`:72-73`).
- `validate_api_key` (`app/auth.py:19-43`) only calls `ValidateApiKey` and returns a bool — no JWT/`aud` path.
- `AGENT_PUBLIC_URL` added in Step 12; `ValidateToken` + `TokenClaims.aud` added in Steps 6/9.

**Instructions**:
1. In `app/auth.py`, add `async def validate_bearer_jwt(token: str) -> bool` that calls identity `ValidateToken(ValidateTokenRequest(token=token))` and returns `True` **iff** the returned `claims.aud == AGENT_PUBLIC_URL` (read `AGENT_PUBLIC_URL` here too). Add `IDENTITY_ENDPOINT` is already module-level (`app/auth.py:16`).
2. In `app/main.py` `handle_sse`: keep the legacy `Authorization: Bearer <api_key>` path (FR-B10) AND the `?api_key=` fallback (FR-B10/OQ-G, leave the existing deprecation-worthy comment, add "deprecated: OAuth 2.1 forbids credentials in query strings"). New logic: if the bearer token validates as an `aud`-bound JWT (`validate_bearer_jwt`), accept; else fall back to `validate_api_key` (API-key path). If both fail, return 401 **with** `headers={"WWW-Authenticate": f'Bearer resource_metadata="{AGENT_PUBLIC_URL}/.well-known/oauth-protected-resource"'}` (FR-B0).
3. Order: try JWT validation first (so a token whose `aud` is wrong is rejected even if it would otherwise validate as some other credential — FR-B8 "any valid token works" gap closed).

**Verification**:
- `grep -n "WWW-Authenticate\|validate_bearer_jwt\|resource_metadata" services/xstockstrat-agent/app/main.py services/xstockstrat-agent/app/auth.py` — confirm the 401 header and the `aud`-checked JWT path.
- Covered by Step 21 (no-token → 401+header; wrong-`aud` JWT → 401; correct JWT → accepted; legacy api_key → accepted).

> Header propagation note (§5c): `validate_bearer_jwt` adds a new outbound gRPC call (`ValidateToken`) to identity. This is an inbound-auth check before any user context is established; it reuses `_metadata()`-style `x-mcp-secret` (add the same metadata used by `validate_api_key` in `app/auth.py` — currently `validate_api_key` passes none, so match its existing behavior). No user headers to propagate at the auth boundary.

---

### Step 17 — service: agent stateless multi-instance confirmation (FR-B13)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/oauth_server.py` — modify (review/confirm — no in-memory state)
- `services/xstockstrat-agent/CLAUDE.md` — modify

**Reviewers**: `xstockstrat-agent` (service owner) — Part B OAuth 2.1 AS/RS endpoints, PKCE, code store, gRPC, SSE backward-compat

**Codebase Evidence**:
- All OAuth state (clients, codes, refresh) is in identity's DB (Steps 8/9); the agent's only cross-request linkage is the HMAC-signed `txn` blob carried in URLs (Step 14), so the agent holds **no** in-memory store.
- DO agent block currently `instance_count: 1` (`.do/app.dev.yaml` agent block). This step documents that the constraint is no longer required by OAuth state (it may stay `1` for cost, but is no longer a correctness requirement).

**Instructions**:
1. Review `app/oauth_server.py` to confirm no module-level/in-memory dict is used to hold auth codes or client registrations (all such state goes through `client.*` gRPC calls to identity). If any was introduced, remove it.
2. Add a short "OAuth 2.1 edge auth (feature 049)" section to `xstockstrat-agent/CLAUDE.md` documenting: the agent is a stateless RS + AS facade; all OAuth state lives in identity; `instance_count > 1` is safe (FR-B13); list the new routes (`/.well-known/*`, `/oauth/register|authorize|callback|token`) and `AGENT_PUBLIC_URL`.

**Verification**:
- `grep -rn "= {}\|dict()" services/xstockstrat-agent/app/oauth_server.py` — confirm no in-memory code/client store (any match must be a request-local variable, not module/instance state).
- `grep -n "AGENT_PUBLIC_URL\|oauth" services/xstockstrat-agent/CLAUDE.md` — confirm the doc section.

---

### Step 18 — service: UI `/auth/oauth-login` redirect-to-agent-callback (FR-B5)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/auth/oauth-login/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` (service owner) — Trading UI correctness, Connect-RPC call safety, no secret values rendered in UI

**Codebase Evidence**:
- Current stub: on `/api/auth/login` success it redirects to `${redirectUri}?state=${state}` (`page.tsx:42-44`) with **no auth code** and **directly to the external client** — the bug FR-B5 fixes.
- It reads `redirect_uri` + `state` from query params (`page.tsx:10-11`). The BFF login route sets session cookies on success (`src/app/api/auth/login/route.ts:17` → `setSessionCookies`), which writes `access_token` `httpOnly`/`secure`/`sameSite:'lax'`/`path:'/'` (`src/lib/auth.ts:42-45`).
- **Same-origin in prod:** UI and agent share one DO ingress origin (`.do/app.yaml:10-21`), so a top-level 302 to the agent callback carries the `access_token` cookie automatically — **the UI does not put any user id or token in the URL**. The agent derives `user_id` by validating that cookie (Step 14). (Local compose is cross-origin — full round-trip is prod-only; see Step 14 evidence.)
- The agent `/oauth/callback` (Step 14) expects `txn` + `state` query params and reads the session cookie itself.

**Instructions**:
1. Change the authorize-flow params the page reads to accept the **agent callback URL** and the signed `txn` blob (Step 14 passes `agent_cb`, `txn`, `state` when it redirects here). Keep backward-compatible reads of `redirect_uri`/`state` only for the invalid-request guard; the real OAuth flow now carries `agent_cb` + `txn`.
2. On `/api/auth/login` success, 302 the browser to the **agent callback** carrying **only** `txn` + `state` — **no user id, no token, no `login=ok` flag** in the URL: `window.location.href = \`${agentCb}?txn=${encodeURIComponent(txn)}&state=${encodeURIComponent(state)}\``. Authentication rides along as the same-origin `access_token` cookie (httpOnly; the browser sends it, the page never reads it); the agent callback validates that cookie via identity `ValidateToken` to derive `user_id` (Step 14). This avoids exposing any credential in the URL and is non-forgeable.
3. Update the invalid-request guard to require `agent_cb` + `txn` (the OAuth path), keeping a clear error card.

**Verification**:
- `grep -n "agent_cb\|txn" services/xstockstrat-ui/src/app/auth/oauth-login/page.tsx` — confirm the redirect targets the agent callback with `txn`+`state` only (and **not** `login=ok` / any user id / token).
- `cd services/xstockstrat-ui && pnpm run lint` — confirm the Next/Node linter passes (frontend has no coverage gate).
- Covered by Step 21's integration assertion (AC-B8) and the UI's existing Playwright E2E (no coverage threshold for the UI — see test-pairing table).

---

### Step 19 — config: deployment env var `AGENT_PUBLIC_URL`

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- (Covered by Step 12 deployment-file edits — see Step 12 `**Files**`.)

**Reviewers**: `xstockstrat-agent` (service owner) — Part B OAuth 2.1 AS/RS endpoints, PKCE, code store, gRPC, SSE backward-compat

**Codebase Evidence**:
- `AGENT_PUBLIC_URL` confirmed absent from `docker-compose.yml`, `.do/app.dev.yaml`, `.do/app.yaml` (grep in Step 12). This step is a pointer; the actual edits live in Step 12 to keep them atomic with the code that reads the var.

**Instructions**:
1. No separate edits — verify Step 12 added `AGENT_PUBLIC_URL` to all three deployment files with the values: docker-compose `http://localhost:9000`; DO dev + prod `${APP_URL}/agent`.

**Verification**:
- `grep -n "AGENT_PUBLIC_URL" docker-compose.yml .do/app.dev.yaml .do/app.yaml` — three matches, correct per-target values.

---

### Step 20 — config: new `agent.oauth.*` config keys (FR-B11)

**Status**: `pending`
**Service**: `xstockstrat-agent` / `xstockstrat-config`
**Files**:
- `CLAUDE.md` (root) — modify (document keys per config-rollout pre-rollout checklist)
- `services/xstockstrat-agent/CLAUDE.md` — modify (declare service-owned config defaults)
- `services/xstockstrat-agent/app/oauth_server.py` — modify (read keys via `client.get_config_value`)

**Reviewers**: `xstockstrat-agent` (service owner) — Part B OAuth 2.1 AS/RS endpoints, PKCE, code store, gRPC, SSE backward-compat

**Codebase Evidence**:
- Config key naming `<service>.<category>.<key>` (root CLAUDE.md §Config Governance; `docs/runbooks/config-rollout.md:31-39`). New keys: namespace `agent`, category `oauth`.
- Agent reads config via `client.get_config_value(key)` → one-shot `GetConfig(GetConfigRequest(namespace="agent"))` (`app/client.py:421-438`); note it reads `snapshot.values.get(key)` where `key` is the **bare** key under the `agent` namespace and returns `.string_val`.
- `agent.oauth.*` confirmed absent everywhere (grep in earlier survey).
- New-key process: "For new keys: open a PR to root CLAUDE.md to document the key" (`config-rollout.md:53`).

**Instructions**:
1. `agent.oauth.allowed_redirect_uris` — string (comma-separated exact URIs; empty = require `https://` at registration only; no allow-any default). `agent.oauth.registration_enabled` — bool (default `true`).
2. In `app/oauth_server.py`: in the `register` handler (Step 13) gate on `agent.oauth.registration_enabled` (read via `client.get_config_value("oauth.registration_enabled")` — bare key under the `agent` namespace, parse truthy) and use `agent.oauth.allowed_redirect_uris` for the exact-match allowlist when non-empty (else fall back to the `https://` check).
3. Document both keys in root `CLAUDE.md` (Config Governance area / agent service config table) and in `services/xstockstrat-agent/CLAUDE.md` defaults.

**Verification**:
- `grep -rn "agent.oauth\|oauth.registration_enabled\|oauth.allowed_redirect_uris" CLAUDE.md services/xstockstrat-agent/` — confirm keys documented and read.

---

### Step 21 — test: agent Part A + Part B coverage (AC-A2, AC-B0..B8)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tools.py` — modify
- `services/xstockstrat-agent/tests/test_auth.py` — modify
- `services/xstockstrat-agent/tests/test_oauth.py` — create

**Reviewers**: `xstockstrat-agent` (service owner) — Part A entry validation; Part B OAuth 2.1 AS/RS endpoints, PKCE, code store, gRPC, SSE backward-compat

**Codebase Evidence**:
- Existing tests + harness: `tests/test_tools.py`, `tests/test_auth.py`, `tests/test_client.py`, `tests/conftest.py` (registers proto `gen` namespace at `:9-30`, patches endpoints at `:32+`).
- Coverage gate: `uv run pytest --cov=app --cov-fail-under=40` (`services/xstockstrat-agent/CLAUDE.md`).
- Starlette test client can exercise the routes by building the app via `create_server()` + the `_run_sse` route list (refactor the route list into a small factory if needed for testability).

**Instructions**:
1. **Part A** (`test_tools.py`): `manage_signal_source` rejects a non-admin key at entry (mock `client.validate_admin` → False raises `RuntimeError`); for an admin key, assert `client.manage_signal_source` is called and the response omits `credentials_ref` (AC-A2).
2. **Part B discovery** (`test_oauth.py`): `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` return the expected JSON (S256, endpoints, `refresh_token` in grant types) (AC-B1); unauthenticated `GET /sse` → 401 with `WWW-Authenticate: ... resource_metadata=...` (AC-B0).
3. **Part B token/audience** (`test_auth.py` + `test_oauth.py`, mocking the identity stubs): a JWT whose `aud != AGENT_PUBLIC_URL` → `/sse` 401; a JWT with the correct `aud` → accepted (AC-B4); legacy `Authorization: Bearer <api_key>` still accepted; `?api_key=` still accepted (AC-B7).
4. **Part B PKCE/exact-redirect/DCR/refresh** (mock identity gRPC): bad `code_verifier`/exchange error → `invalid_grant` 400; `redirect_uri` mismatch at authorize → 400; `/oauth/register` returns a `client_id`; `/oauth/token` refresh branch returns a new pair (AC-B2/B3/B5).

**Verification**:
- `cd services/xstockstrat-agent && ruff check . && ruff format --check . && uv run pytest --cov=app --cov-fail-under=40` — confirm lint passes and coverage ≥ 40%.

---

### Step 22 — docs: MCP OAuth 2.1 connect flow + `claude_mcp_config.json` + header-propagation note

**Status**: `pending`
**Service**: `docs/` / `xstockstrat-agent`
**Files**:
- `docs/runbooks/mcp-tools.md` — modify
- `services/xstockstrat-agent/claude_mcp_config.json` — modify
- `docs/patterns/header-propagation.md` — modify (FR-A6)

**Reviewers**: none

**Codebase Evidence**:
- `claude_mcp_config.json` still references nginx (`xstockstrat-sse-nginx` block, `url: http://localhost/agent/sse?api_key=`) — stale post-045; and documents `?api_key=` only.
- `docs/runbooks/mcp-tools.md` is the MCP tool/transport reference (docs/runbooks/CLAUDE.md).
- FR-A6 requires `docs/patterns/header-propagation.md` to describe the "entry authenticates, internal role-checks" model and list the indicators ownership exception.

**Instructions**:
1. `mcp-tools.md`: document the OAuth 2.1 connect flow (discovery → DCR → authorize → UI login → callback → token → `/sse` with `aud`-bound JWT) as the **recommended** production method; mark `?api_key=` deprecated/Desktop-only (OQ-G); note `AGENT_PUBLIC_URL` + the DO `/agent` route (OQ-E).
2. `claude_mcp_config.json`: remove the nginx block; add an OAuth-based remote-MCP entry pointing at `{AGENT_PUBLIC_URL}/sse`; keep `?api_key=` as a labeled deprecated Desktop fallback.
3. `header-propagation.md` (FR-A6): document the single "entry point authenticates (UI BFF JWT / MCP agent SSE), internal services do an `x-access-scope` role check" model; list the **indicators formula author-ownership** as the deliberate documented exception (with the admin-scope override from Step 3).

**Verification**:
- `grep -n "oauth\|OAuth\|deprecated" services/xstockstrat-agent/claude_mcp_config.json docs/runbooks/mcp-tools.md` — confirm OAuth flow + deprecation note.
- `grep -n "author-ownership\|x-access-scope\|exception" docs/patterns/header-propagation.md` — confirm the model + indicators exception.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
