# Implementation Spec: authelia-sso

**Status**: `pending`
**Created**: 2026-11-24 (regenerated after the 2026-11-24 re-spec; the 2026-11-16 52-step spec is superseded and stays in git history at `f0ed7dc`)
**Feature**: `docs/roadmap/features/345-authelia-sso/feature.md`
**Total Steps**: 58
**Feature Branch**: `feature/authelia-sso`
**Tree**: `ccr-589817f0-cyg7gy@2c1d154 ≡ origin/ccr-589817f0-cyg7gy (⊇ origin/main-dev@187e9f8)`, re-grounded 2026-11-27 (context.md). The commits over `main-dev` are docs-only (`docs/roadmap/features/345-authelia-sso/**`), so every code citation below is `main-dev@187e9f8`.

---

## Execution Summary

The steps follow design.md § 0 "Build order": proto, the two migrations and the shared vector file, then identity,
the config grant, the operator script, the agent, the UI and the docs. Every intermediate state behaves as `local`
(D-109): the mode key is seeded `local`, every reader defaults to `local`, and the new RPCs are unused until the UI
and agent steps land. The only behaviour change before cutover is FR-15's every-mode logout (Origin 403, JSON on an
expired session, the header Sign-out button), which ships with the UI steps. Within each surface the order is leaf
modules, then the code that composes them, then routes and pages, so each `service` step passes its own
Verification before the next starts. Every step touches at most five hand-written files.

The step bodies cite the debate register (`D-n`); design.md's four approval amendments (D-134..D-137) win over its
body text. The config seed is **`060_authelia_sso_keys`** on trunk today (`059` is the highest file; `053` is a gap
that must never be filled). Features 314, 317 and 321 merged with `057`–`059` (`merge-order.md` row 345 vs 314/317/321,
resolved), and Step 4 still takes the next free number above trunk's highest at execute time.

**Consumer surfaces (C-14):**
- **UI** (`xstockstrat-ui`): the login page (Step 44), `/api/auth/sso/{start,callback}` (Step 40), the Link SSO
  routes (Step 42) and the new `/accounts/sso` page with its two nav registrations (Step 45, C-10a), the header
  Sign-out button (Step 46), logout (Step 36), `/accounts/authorized-apps` (Step 47) and the two discovery documents
  (Step 48). E2E reachability and behaviour: Step 53.
- **Agent** (`xstockstrat-agent`): every MCP tool's authentication and effective scope in `oidc` (Steps 17–24); no
  tool name, parameter or response changes.
- **Script**: `scripts/manage-users.py set-auth-mode` and `unlink-sso` (Steps 15–16).

**Business rules (C-16):** design.md § Business Rules Touched. CHANGE-by-config items are owner-signed for `oidc`
only (context.md 2026-11-24). The integration PR promotes the `@AC-*` scenarios into the durable suites.

### Scenario Coverage (C-15)

Guards are labelled `(guard)` in the covering step's `**Covers**` and Verification (D-118).

| AC | Step(s) | AC | Step(s) | AC | Step(s) | AC | Step(s) |
|---|---|---|---|---|---|---|---|
| AC-1 | 12, 41, 53 | AC-23 | 24 | AC-45 | 53 | AC-63 | 53 |
| AC-2 | 12, 41 | AC-24 | 33, 41 | AC-46 | 31, 49, 53 | AC-64 | 37, 53 |
| AC-3 | 12, 29, 41, 53 | AC-25 | 12 (+guard) | AC-47 | 41, 53 | AC-65 | 12, 41, 43, 53 |
| AC-4 | 12, 29, 43, 53 | AC-27 | 12 | AC-48 | 31, 53 | AC-66 | 12, 29, 43, 53 |
| AC-6 | 12 (+guard), 41 | AC-28 | 12 | AC-49 | 24, 49, 53 | AC-67 | 12, 29, 43, 53 |
| AC-7 | 12, 29, 41, 53 | AC-29 | 41, 53 | AC-50 | 12, 16 | AC-68 | 35, 37, 43 |
| AC-10 | 24 | AC-30 | 24 | AC-51 | 41, 53 | AC-69 | 43, 53 |
| AC-11 | 24, 49 | AC-31 | 8, 10, 18, 31, 53 | AC-52 | 33, 37 | AC-70 | 12 |
| AC-12 | 22 | AC-32 | 24 | AC-53 | 33, 37, 53 | AC-71 | 8, 16, 24 |
| AC-13 | 22 | AC-33 | 12 (guard) | AC-54 | 27, 31, 41, 53 | AC-72 | 8, 18, 31 |
| AC-14 | 24 | AC-34 | 53 | AC-55 | 18, 24, 49 | AC-73 | 12 |
| AC-15 | 24 | AC-35 | 14, 31 | AC-56 | 37, 53 | AC-74 | 41, 53 |
| AC-16 | 10, 39, 53 | AC-36 | 58 | AC-57 | 27, 37, 53 | AC-75 | 12 |
| AC-17 | 10, 53 | AC-38 | 12 | AC-58 | 27, 37, 41 | AC-76 | 35, 41, 53 |
| AC-20 | 58 | AC-41 | 5, 53 | AC-59 | 27, 41, 53 | AC-77 | 41, 43 |
| AC-21 | 24 | AC-42 | 24 (guard), 53 | AC-60 | 31, 41, 53 | AC-78 | 49 |
| AC-22 | 22, 24 | AC-43 | 24 | AC-61 | 20, 24 | | |
| | | AC-44 | 8, 16, 24, 53 | AC-62 | 37, 53 | AC-79 | 20, 24 |

Retired IDs (never reused): AC-5, AC-8, AC-9, AC-18, AC-19, AC-26, AC-37, AC-39, AC-40.

### Spec-level choices the design did not settle (flag at `/sdd-review impl-spec` and at each step gate)

1. **`OIDC_SCOPE = 'openid email profile'`** (Step 32). FR-16.2's label falls back to `preferred_username`, a
   `profile`-scope claim (OIDC Core § 5.4); design.md names `OIDC_SCOPE` without a value. The owner kept this scope on
   2026-11-24, and homelab-edge's SSO spec § 4.6 is amended to register `xstockstrat[-staging]-web` with
   `openid profile email` (it listed `openid email`, which Authelia would refuse with `invalid_scope`); that
   registration is design § 6 cutover gate 3.
2. **`_JWKS_FRESH_S = 300`** and the asymmetric allow-list `{RS,PS,ES}{256,384,512}` with EdDSA excluded (Step 19;
   carried from the 2026-11-16 spec, which `/sdd-review impl-spec` accepted; D-2/D-13 name no values). With them,
   **`_JWKS_MAX_AGE_S = 3600`** (D-138, owner 2026-11-27; replaces D-37's `_JWKS_STALE_MAX_S = 86400`, whose pending
   sign-off is superseded): a key is used only from a set fetched within the last 3600 s; past that the token waits
   for a refetch, and a failed or cooled-down refetch gives 503 `jwks_unavailable`, never a verify with the old keys
   (AC-79; product-spec Risks; stated in the cutover runbook, Step 54).
3. **One serial SSO spec file inside a `chromium-sso` Playwright project** (`dependencies: ['chromium']`,
   `workers: 1`, Step 52). D-120 fixes the serial file; the separate project keeps the parallel `chromium` files
   from reading the mock's global mode while the serial file changes it.
4. **config-wiring receivers the design did not list** (Step 6): identity `src/authMode.ts:config` → `identity`
   (a new file, so the existing `identityServiceImpl.ts:this.config` receiver does not cover it) and agent
   `app/sso_mode.py:agent_config` → `agent` (the `agent/oidc.issuer` read sits beside the mode read).
5. **AC-77 row 1** (no session cookie → the middleware's redirect to `/auth/login`) is asserted in
   `middleware.test.ts` (Step 41): a request with no session cookie at all never reaches the handler
   (`middleware.ts:80-83`), exactly as for today's `/accounts/api/authorized-apps` (`route.ts:15-16`). The handler's
   own 401 is the stale-token case, what `apiFetch` sees after an idle gap (R-4, D-107), asserted at the handler in
   Step 43 (FR-16.6).
6. **`ssoErrorRedirect` events** (Step 36): login destination records `sso_login_error` when `fault`, else
   `sso_login_failed{reason}`; link destination always records `sso_link_failed{reason}` (D-72 remainder, D-113).
7. **`prm.expected` includes `scopes_supported`** with the four `xstockstrat.*` scopes (D-10, carried by D-110).
8. **No migration-assertion file for the config seed.** It sends no notify (D-109), and its idempotence comes from
   `ON CONFLICT DO NOTHING` replayed by `migration-rerun`.

## Step Dependencies

- Steps 1 + 2 land together: a `.proto` edit lands with its `proto-gen` step (§C). No descriptor-parity guard covers
  identity messages (`grep -rn "_MAPPED\|covers_every_proto_field" services` hits only agent tests that never
  import `identity_pb2`).
- Steps 9 + 10 land together: Step 9 adds `this.config.getString(...)` to `authenticateUser`, and every identity
  config mock has only `getInt` (`identityServiceImpl.test.ts:58,292,357,1141,1388`,
  `identityServiceImpl.otlp.test.ts:40`, `identityTelemetry.test.ts:13`, `revokeToken.test.ts:12`; recon R-6), so every existing
  password-login test throws until Step 10 replaces them with `fakeConfig()`.
- Step 4 seeds the keys; their readers land in Steps 7 (identity), 17 (agent) and 30 (UI), on three consumer
  surfaces, so they cannot form one §C unit. The bridge is step-time `check-config-wiring.mjs`: a missing leg prints
  `PENDING` and does not fail (`check-config-wiring.mjs:887-899`). `--final` runs at the integration PR.
- Step 6 (receivers, vector file) precedes Steps 7, 8, 17, 18, 30 and every test that loads the vector file
  (Steps 8, 12, 18, 24, 27, 29, 31, 49): the receivers must exist no later than the reads, or step time gates them
  as `unattributed` (`GATED_UNLESS_BASELINED`, `check-config-wiring.mjs:691`).
- Steps 3 (identity `007`) precedes Step 12 (its constraint-name test reads the up file).
- Step 11 precedes Steps 23 and 40–43 (the agent and UI call the new RPCs; their unit tests mock them).
- Step 13 (config grant) precedes Step 30 in any live run; the UI unit tests mock `getSecret`.
- Steps 19 and 21 precede Step 23 (`sso_auth.py` composes `jwks.py`, `scopes.py` and the client helper).
- Step 25 (UI `typecheck` in CI) precedes Step 36: D-83's `@ts-expect-error` cases go RED only under a real `tsc`
  (D-93); the RED is recorded in Step 37.
- UI leaf order: 26 → 28 → 30 → 32 → 34 → 36 → 38 → 40 → 42 → 44 → 45 → 46 → 47 → 48. Step 30 needs Step 26
  (`oidcIssuer`, `sameOrigin`, deadlines); Step 36 needs Steps 28, 30, 32, 34; Step 40 needs 34 and 36; Step 42
  needs 40 (the shared callback seals the link cookie); Step 44 needs 36 (`SSO_ERROR_CODES`) and 40 (the form posts
  to `/start`); Step 45 needs 42 and 36.
- Steps 50 → 51 → 52 → 53: the stub IdP and fixtures precede the mock backend that serves their state, and the
  serialized project precedes the spec file it runs. Step 53 requires every UI step 25–49.
- Steps 54–57 (docs) precede Step 58. Step 54's first action runs Step 58's Verification on the pre-docs tree to
  record the RED. No `**Lands with**`: a docs-presence grep matches no §C trigger.
- **Merge order (rollout, not steps):** feature 319 merges first or alongside (D-52; the RevokeToken
  unverified-decode defect), `merge-order.md` row; satisfied: 319 merged 2026-11-26 (#1610), and `revokeToken` now
  verifies the signature (`identityServiceImpl.ts:284-293`). Rebase over 324 (`manage-users.py`, `ci.yml`), 331 and 323
  (agent `main.py`). At merge, re-check config `060` (highest + 1) and identity `007`.

---

### Step 1 — proto: Add ResolveExternalIdentity, LinkExternalIdentity, GetExternalIdentityLinks and IssueSessionForUser

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/identity/v1/identity.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness per message, additive-only, `buf lint` + `buf breaking` against the dev trunk; `packages/proto` owner — backward compatibility, naming conventions; `xstockstrat-identity` owner — JWT expiry and rotation

**Codebase Evidence**:
- `grep -n "rpc ListAdminUserIds" packages/proto/identity/v1/identity.proto` → `:49`, the last RPC; its SAN comment precedent is at `:47-48`.
- `message AuthTokenResponse` is at `:57`; `enum Role` at `:170`. The file is 218 lines (`wc -l`).
- `packages/proto/buf.yaml` excepts `RPC_RESPONSE_STANDARD_NAME`, so returning the existing `AuthTokenResponse` passes lint (recon § Codebase Map).

**Lands with**: Step 2

**TDD**: N/A (proto contract; verified by buf lint/breaking)

**Covers**: —

**Instructions**:
1. After `rpc ListAdminUserIds(...)` (`:49`), add four RPCs, each with a one-line SAN comment in the `:47-48` style (FR-4, D-103):
   - `rpc ResolveExternalIdentity(ResolveExternalIdentityRequest) returns (ResolveExternalIdentityResponse);` — peer SAN `xstockstrat-ui` or `xstockstrat-agent` only; headers ignored.
   - `rpc IssueSessionForUser(IssueSessionForUserRequest) returns (AuthTokenResponse);` — `xstockstrat-ui` only.
   - `rpc LinkExternalIdentity(LinkExternalIdentityRequest) returns (LinkExternalIdentityResponse);` — `xstockstrat-ui` only.
   - `rpc GetExternalIdentityLinks(GetExternalIdentityLinksRequest) returns (GetExternalIdentityLinksResponse);` — `xstockstrat-ui` only.
2. Append at the end of the file (fields numbered from 1; product spec § Proto Contract Changes):
   - `message ResolveExternalIdentityRequest { string issuer = 1; string subject = 2; }`
   - `message ResolveExternalIdentityResponse { string user_id = 1; repeated Role roles = 2; bool is_active = 3; }`
   - `message IssueSessionForUserRequest { string user_id = 1; }`
   - `message LinkExternalIdentityRequest { string user_id = 1; string issuer = 2; string subject = 3; string password = 4; }`
   - `message LinkExternalIdentityResponse {}`
   - `message GetExternalIdentityLinksRequest { string user_id = 1; }`
   - `message GetExternalIdentityLinksResponse { repeated string issuers = 1; }`
3. No outcome enum (dropped by the re-spec): refusals are gRPC statuses with a closed detail set (D-123).

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against "../../.git#branch=feature/authelia-sso,subdir=packages/proto"
```

---

### Step 2 — proto-gen: Regenerate stubs for the identity additions

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/ts/identity/v1/*` + `packages/proto/gen/ts/dist/identity/v1/*` — modify (generated)
- `packages/proto/gen/python/identity/v1/{identity_pb2.py,identity_pb2_grpc.py}` — modify (generated)
- `packages/proto/gen/go/identity/v1/*` — modify (generated)
- Any other path `buf-gen.sh` changes (an incidental WKT doc-comment refresh, insights.md:895) is committed too and recorded in the Deviation Log (F-08); generated output never counts toward the 5-file limit.

**Reviewers**: Proto Reviewer — field number uniqueness, `buf lint` + `buf breaking`; `packages/proto` owner — backward compatibility; `xstockstrat-identity` owner — JWT expiry and rotation

**Codebase Evidence**:
- Root `CLAUDE.md` § Generating Proto Stubs: `./scripts/buf-gen.sh` generates TS, Python and Go stubs and compiles the TS package; the CI `proto-freshness` job diffs `packages/proto/gen/`.
- Ledger `insights.md:895-897`: incidental WKT comment diffs from `buf-gen` are committed, not reverted.

**Lands with**: Step 1

**TDD**: N/A (generated code)

**Covers**: —

**Instructions**:
1. Run `./scripts/buf-gen.sh` from the repo root and commit every changed file under `packages/proto/gen/`.
2. Never Read/Grep the generated files (root `CLAUDE.md` Key File Paths); check them through the build below.

**Verification**:
```bash
./scripts/buf-gen.sh && pnpm --filter @xstockstrat/proto run build
./scripts/buf-gen.sh && git diff --exit-code packages/proto/gen/   # a second run changes nothing
(cd packages/proto && buf lint && buf breaking --against "../../.git#branch=feature/authelia-sso,subdir=packages/proto")
```

---

### Step 3 — migration: identity 007_external_identities

**Status**: `done`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/migrations/007_external_identities.up.sql` — create
- `services/xstockstrat-identity/migrations/007_external_identities.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair, index correctness, run order per `scripts/db-migrate.sh`; `xstockstrat-identity` owner — JWT expiry and rotation

**Codebase Evidence**:
- `ls services/xstockstrat-identity/migrations | tail -3` → `005_drop_api_keys.up.sql`, `006_user_metadata.down.sql`, `006_user_metadata.up.sql`; next is `007` (C-07).
- `identity.users.user_id` is the PK referenced (`001_identity_tables.up.sql:6-14`, recon).
- `migration-rerun` (`.github/workflows/ci.yml:944`) applies every migration once; since feature 318 (#1619) it replays only the feature-224/225 up-files ("Older up-files are not replayed.", `:942-943`).

**TDD**: N/A (migration)

**Covers**: —

**Instructions**:
1. Up (D-104; product spec § Database Changes), idempotent:
   ```sql
   CREATE TABLE IF NOT EXISTS identity.external_identities (
     issuer    TEXT        NOT NULL,
     subject   TEXT        NOT NULL,
     user_id   UUID        NOT NULL REFERENCES identity.users(user_id) ON DELETE CASCADE,
     linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     CONSTRAINT external_identities_pkey PRIMARY KEY (issuer, subject),
     CONSTRAINT external_identities_issuer_user_key UNIQUE (issuer, user_id)
   );
   ```
   No email index (nothing matches by email).
2. Down: `DROP TABLE IF EXISTS identity.external_identities;`
3. One header comment of at most two lines per file naming feature 345; edit no applied migration (F-01).

**Verification**:
```bash
ls services/xstockstrat-identity/migrations/007_*.up.sql services/xstockstrat-identity/migrations/007_*.down.sql
grep -c "CONSTRAINT external_identities_pkey\|CONSTRAINT external_identities_issuer_user_key\|IF NOT EXISTS" services/xstockstrat-identity/migrations/007_external_identities.up.sql   # 3
# read both: the CREATE TABLE has its DROP TABLE IF EXISTS inverse
```

---

### Step 4 — migration: config 060_authelia_sso_keys and the regenerated stored set

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/060_authelia_sso_keys.up.sql` — create (number re-checked at execute)
- `services/xstockstrat-config/migrations/060_authelia_sso_keys.down.sql` — create
- `scripts/config-wiring-stored.json` — modify (regenerated, never hand-written)

**Reviewers**: DBA — migration NNN numbering, up+down pair, run order; `xstockstrat-config` owner — key naming, environment scoping, secret encryption + redaction

**§C acknowledgement (seed before readers)**: readers land in Steps 7, 17 and 30 on three surfaces; `check-config-wiring.mjs` reports the missing legs as `PENDING` at step time and `--final` gates the integration PR.

**Codebase Evidence**:
- `ls services/xstockstrat-config/migrations | tail -6` → `057_*`, `058_*`, `059_*` (`053` stays a gap); next free above the highest is `060`. A number below trunk's highest is never used (`merge-order.md` row 345 vs 314/317/321); the CI `migration-order-gate` (`ci.yml:1004-1024`, `scripts/check-migration-order.py`) refuses an added up-file not above the base branch's maximum for its service.
- Plain seed shape: `054_marketdata_delisting_confirmation_days.up.sql:4-13` (`(namespace, key, value_type, value_data, description, default_value, consuming_service, updated_by, environment, user_id)` + `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING`).
- Secret seed shape: `049_notify_commsgun_channel_keys.up.sql:57-67` (`is_secret` column, `'[redacted]'`, comment "Ciphertext stays NULL: a migration has no master key").
- Down guard shape: `049_*.down.sql:5-18` (sentinel `updated_by` + seed value; secret row `is_secret AND value_encrypted IS NULL`, so `value_encrypted` is the ciphertext column) and `054_*.down.sql:4-10`.
- `scripts/check-config-wiring.mjs` reports `STALE-STORED` when `scripts/config-wiring-stored.json` lags the migrations; the CI `config-wiring-stored` job regenerates and diffs it (`ci.yml:1444`).

**TDD**: N/A (migration)

**Covers**: —

**Instructions**:
1. **Number.** At execute, `ls services/xstockstrat-config/migrations | tail -2`; use highest + 1 (`060` today). Any other number is recorded in the Deviation Log and every `060` below reads as that number.
2. **Up**: two statements, both `ON CONFLICT … DO NOTHING`, `user_id NULL`, `updated_by = 'system:config-migration-feature-authelia-sso'`, each key for `staging` and `production` (18 rows, D-109). **No notify**: every seed equals its code default.
   - Statement 1 (the `054` shape), 16 rows:
     - `identity` / `auth.mode`, `string`, value `'local'`, default `'local'`, consuming_service `xstockstrat-identity`. Description: "Login mode for this deployment: local (password; built-in MCP OAuth), both (SSO and password; Link SSO; built-in MCP OAuth) or oidc (SSO only; MCP accepts issuer tokens only). Any other value reads as local. Read globally; set with scripts/manage-users.py set-auth-mode."
     - `ui` / `oidc.issuer`, `oidc.client_id`, `oidc.mcp_client_id`, `oidc.mcp_client_id_readonly`, `oidc.mcp_client_id_claude_code`, `oidc.mcp_client_id_claude_code_readonly`: `string`, `''`/`''`, `xstockstrat-ui`.
     - `agent` / `oidc.issuer`: `string`, `''`/`''`, `xstockstrat-agent`.
     - The issuer descriptions state the FR-14 grammar: https (http only on localhost, 127.0.0.1, [::1]), a lowercase host, no IP except loopback, no IDN/`xn--`, no default port, no userinfo/query/fragment/`%`, no trailing slash; `""` is invalid in `both`/`oidc`.
   - Statement 2 (the `049:57-67` shape), 2 rows: `ui` / `oidc.client_secret`, `string`, `'[redacted]'`, `is_secret TRUE`, default `''`, `xstockstrat-ui`, with the "Ciphertext stays NULL" comment.
3. **Down**: one `DELETE` with the `049` guard: `environment IN ('staging','production') AND user_id IS NULL AND updated_by = '<sentinel>' AND ((namespace='identity' AND key='auth.mode' AND value_data='local') OR (namespace='ui' AND key IN (<the six plain ui keys>) AND value_data='') OR (namespace='agent' AND key='oidc.issuer' AND value_data='') OR (namespace='ui' AND key='oidc.client_secret' AND is_secret AND value_encrypted IS NULL))`. A row an operator changed is never deleted.
4. Header comments: at most two lines per file, naming feature 345 and the constraint (namespace-relative keys; operator-changed rows survive the down).
5. Regenerate the stored set **after** the file has its final number (its `inputs_sha256` hashes every config migration): `DATABASE_URL=<scratch postgres 16> python3 scripts/config-wiring-stored.py`, then commit `scripts/config-wiring-stored.json`. Never hand-write it. Without a scratch Postgres, block (P-03) and take the CI `config-wiring-stored` artifact (the 341 precedent).

**Verification**:
```bash
ls services/xstockstrat-config/migrations/060_*.up.sql services/xstockstrat-config/migrations/060_*.down.sql
ls services/xstockstrat-config/migrations | grep -c '^060_'   # 2: no other feature holds 060
! grep -n "pg_notify" services/xstockstrat-config/migrations/060_authelia_sso_keys.up.sql   # no notify (D-109)
node scripts/check-config-wiring.mjs --declared-migration services/xstockstrat-config/migrations/060_authelia_sso_keys.up.sql   # exit 0; readers not yet written print PENDING
git diff --stat scripts/config-wiring-stored.json   # regenerated, non-empty
! node scripts/check-config-wiring.mjs --final 2>&1 | grep STALE-STORED
```

---

### Step 5 — test: Static seed test for 060

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/autheliaSsoSeedMigration.test.ts` — create

**Reviewers**: `xstockstrat-config` owner — key naming, environment scoping, secret encryption + redaction

**Codebase Evidence**:
- `src/__tests__/migrationSql.ts` exports `findOne` and `splitStatements` (`notifyCommsgunSeedMigration.test.ts:3`).
- Precedent with a secret row: `src/__tests__/notifyCommsgunSeedMigration.test.ts:1-30` (`SUFFIX`, `ACTOR`, `CONFLICT`, `ENVIRONMENTS`, `SECRET_KEY`, `splitTopLevel`).

**TDD**: red-green required

**Covers**: AC-41 (every database seeds `auth.mode` = `local`, the code default)

**Instructions**:
1. Clone the `notifyCommsgunSeedMigration.test.ts` shape for `SUFFIX = 'authelia_sso_keys'`:
   - the up has exactly two statements; their tuples equal the 9 keys × 2 environments (18), `user_id NULL`, the sentinel actor;
   - every stored key is relative: none starts with `identity.`, `ui.` or `agent.` (`@AC-1 @feature-296`);
   - **@AC-41:** both `auth.mode` rows carry value and default `'local'`;
   - every other plain row carries `''`/`''`; the two secret rows carry `TRUE`, `'[redacted]'` and default `''`;
   - both statements carry the `ON CONFLICT … DO NOTHING` target; the up contains no `pg_notify`;
   - the down deletes only by the sentinel and the seed value, and guards the secret row on `value_encrypted IS NULL`.
2. The literals have one consumer (this file), so they stay inline (C-13).

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
grep -n "__tests__/fixtures" src/__tests__/autheliaSsoSeedMigration.test.ts || echo "C-13: single consumer, inline"
```

---

### Step 6 — config: Shared vector file, CI change filters and the config-wiring receivers

**Status**: `done`
**Service**: `scripts/` (shared test data, config-wiring registry) and `.github/workflows/ci.yml`
**Files**:
- `scripts/testdata/oidc-issuer-vectors.json` — create
- `scripts/config-wiring.json` — modify
- `.github/workflows/ci.yml` — modify

**Reviewers**: `xstockstrat-config` owner — key naming, environment scoping; `xstockstrat-agent` owner — OAuth 2.1 edge-auth correctness; Platform Lead — CI gate parity

**Codebase Evidence**:
- `scripts/testdata/` holds `rpc-status-vectors.json`, the shared-vector precedent (D-66 basis, carried by D-79/D-88).
- The approved grammar and its 66 `issuer` and 16 `app_url` rows are verbatim in `git show 7eeab3d:docs/roadmap/features/345-authelia-sso/design.md` lines 769–870 (keys `issuer_pattern`, `app_url_pattern`, `issuer`, `app_url`, `mode`; counted at spec time with `json.load`: 66/16/10). D-110 carries D-79/D-88; D-101 repurposes the `mode` rows; D-130e adds `refusals` and `prm`.
- Receivers: `attribute()` maps `"<file>:<receiver>"` to one namespace (`check-config-wiring.mjs:547-551`); a TS getter's receiver is `receiverBefore(src, m.index)` and an index read's is `receiverBefore(…, 'values')` (`:471-472`); a Python attribute call's receiver is `ast.unparse(func.value)` (`config-wiring-py-reads.py:142-144`). Existing: `"services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:this.config": "identity"` (`config-wiring.json:94`), `"services/xstockstrat-ui/src/lib/indicatorChart.ts:values": "ui"` (`:131`), forwarder `"services/xstockstrat-agent/app/config/watcher.py:read_config_value"` (`:35`).
- `validateState` never requires the file to exist, so receivers may land before their readers (Step 6 precedes Steps 7, 17, 30).
- CI `changes` filters: `xstockstrat-agent` `ci.yml:59`, `xstockstrat-identity` `:62`, `xstockstrat-ui` `:64`.

**TDD**: N/A (test data and registry configuration; RED→GREEN in Steps 8, 12, 18, 24, 27, 29, 31, 49)

**Covers**: —

**Instructions**:
1. **Vector file.** Create `scripts/testdata/oidc-issuer-vectors.json`:
   - `issuer_pattern`, `app_url_pattern`, `issuer` (66 rows) and `app_url` (16 rows): copied byte-for-byte from `git show 7eeab3d:…/design.md` lines 769–870. The old `mode` array is **not** copied.
   - `mode` (D-101, D-121), 10 rows `{name, value, expected, logs}` where `value: null` means the row is absent: `absent` (null → `local`, false), `local`, `both`, `oidc` (each itself, false), `empty` (`""` → `local`, true), `upper` (`"BOTH"` → `local`, true), `leading_space` (`" both"` → `local`, true), `trailing_space` (`"oidc "` → `local`, true), `legacy_word` (`"sso"` → `local`, true), `typo` (`"oidcc"` → `local`, true).
   - `refusals` (design.md § 1 "Refusal contract", D-123/D-130e): `{"resolve": ["not linked","account inactive"], "link": ["invalid credentials","account inactive","account already linked","already linked to this issuer","link disabled"], "session": ["account inactive"]}`.
   - `prm` (D-10, D-130e): `{"agent_public_url": "https://xstockstrat-staging.example.test/agent", "issuer": "https://auth.example.test", "expected": {"resource": "https://xstockstrat-staging.example.test/agent", "authorization_servers": ["https://auth.example.test"], "scopes_supported": ["xstockstrat.read","xstockstrat.write","xstockstrat.admin","xstockstrat.trade"]}}`.
2. **`config-wiring.json` `registry.receivers`** (D-109; spec-level choice 4):
   - `"services/xstockstrat-identity/src/authMode.ts:config": "identity"`;
   - `"services/xstockstrat-agent/app/sso_mode.py:identity_config": "identity"`, `"services/xstockstrat-agent/app/sso_mode.py:agent_config": "agent"`;
   - `"services/xstockstrat-ui/src/lib/oidcConfig.ts:identity.values": "identity"`, `"…:ui.values": "ui"`, `"…:agent.values": "agent"`.
   - No `findings` baseline entry (`docs/patterns/config-governance.md` **Baseline.** bullet, `:90`).
3. **`ci.yml`**: append `'scripts/testdata/oidc-issuer-vectors.json'` to the `xstockstrat-agent` (`:59`), `xstockstrat-identity` (`:62`) and `xstockstrat-ui` (`:64`) filters.
4. Hand-check the JSON once against both engines (D-88 practice): every `issuer` row through Python `re.fullmatch` and Node `new RegExp(...).test` gives its `valid`; record the output in the step's evidence.

**Verification**:
```bash
python3 -c "import json;d=json.load(open('scripts/testdata/oidc-issuer-vectors.json'));print(len(d['issuer']),len(d['app_url']),len(d['mode']),sorted(d['refusals']),sorted(d['prm']))"   # 66 16 10 ['link','resolve','session'] ['agent_public_url','expected','issuer']
python3 -c "import json,re;d=json.load(open('scripts/testdata/oidc-issuer-vectors.json'));r=re.compile(d['issuer_pattern']);bad=[x['name'] for x in d['issuer'] if (r.fullmatch(x['value']) is not None)!=x['valid']];print('python mismatches',bad);assert not bad"
node -e "const d=require('./scripts/testdata/oidc-issuer-vectors.json');const r=new RegExp(d.issuer_pattern);const bad=d.issuer.filter(x=>r.test(x.value)!==x.valid).map(x=>x.name);console.log('node regex-only mismatches',bad)"   # any mismatch must be a row the TS URL round-trip rejects (Step 27 asserts it)
node --input-type=module -e "import {loadState} from './scripts/check-config-wiring.mjs'; const r=loadState(process.cwd()).registry.receivers; const want={'services/xstockstrat-identity/src/authMode.ts:config':'identity','services/xstockstrat-agent/app/sso_mode.py:identity_config':'identity','services/xstockstrat-agent/app/sso_mode.py:agent_config':'agent','services/xstockstrat-ui/src/lib/oidcConfig.ts:identity.values':'identity','services/xstockstrat-ui/src/lib/oidcConfig.ts:ui.values':'ui','services/xstockstrat-ui/src/lib/oidcConfig.ts:agent.values':'agent'}; for (const [k,v] of Object.entries(want)) if (r[k]!==v) { console.error('missing '+k); process.exit(1) } console.log('receivers registered')"
grep -c "scripts/testdata/oidc-issuer-vectors.json" .github/workflows/ci.yml   # 3
```

---

### Step 7 — service: Identity mode reader (src/authMode.ts) and the watcher hook

**Status**: `done`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/authMode.ts` — create
- `services/xstockstrat-identity/src/index.ts` — modify

**Reviewers**: `xstockstrat-identity` owner — JWT expiry and rotation; Security — auth scope correctness

**Codebase Evidence**:
- `ConfigWatcher.getString(key, def = '')` at `src/services/configWatcher.ts:203-207`: an absent key returns `def` (after the watcher's own rate-limited WARN, `:184-193`), a present `stringVal` (including `''`) is returned as-is.
- The watcher emits `'update'` on every snapshot/delta at `configWatcher.ts:107`; `configWatcher.ts` is byte-identical across services and is not edited (`scripts/check-watcher-copies.py`, D-129).
- `src/index.ts:24-26`: `new ConfigWatcher(configEndpoint, 'identity')`, `await configWatcher.waitForSnapshot(90_000)`, `log.info('Config snapshot received')`; `main()` runs at import (`:71`).
- The receiver `src/authMode.ts:config` → `identity` is registered in Step 6.

**TDD**: red-green required (paired test: Step 8)

**Covers**: —

**Instructions**:
1. **`src/authMode.ts`** (D-101, D-121, D-129):
   - `export const AUTH_MODES = ['local', 'both', 'oidc'] as const; export type AuthMode = (typeof AUTH_MODES)[number];`
   - `export function parseAuthMode(raw: string | undefined): { mode: AuthMode; invalid: boolean }`: `undefined` → `{local, false}`; one of the three exact strings → itself; anything else (`''`, case or whitespace variants) → `{local, true}`.
   - `export function readAuthMode(config: { getString(key: string, def?: string): string }): AuthMode` — the **only** read: `config.getString('auth.mode', 'local')`, then `parseAuthMode`; on `invalid`, `log.warn('auth_mode_invalid', { value })` once per distinct value (a module-level `Set`; export `__resetAuthModeLogOnce()` for tests). The parameter must be named `config` (wiring receiver).
   - `export function watchAuthMode(watcher: { getString(...): string; on(event: 'update', fn: () => void): unknown }): void`: calls `readAuthMode(watcher)` once, then on every `'update'`.
   - Use the service logger (`src/services/logger.ts`).
2. **`src/index.ts`**: after `log.info('Config snapshot received')` (`:26`), add `watchAuthMode(configWatcher);` and its import.

**Verification**:
```bash
cd services/xstockstrat-identity && pnpm run lint && pnpm run build
grep -n "watchAuthMode(configWatcher)" src/index.ts   # 1
cd ../.. && node scripts/check-config-wiring.mjs --keys identity.auth.mode   # exit 0: the read is attributed to identity
```

---

### Step 8 — test: authMode parsing, log-once, watcher re-parse and the seeded row

**Status**: `done`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/__tests__/authMode.test.ts` — create
- `services/xstockstrat-identity/src/__tests__/configWatcher.test.ts` — modify

**Reviewers**: `xstockstrat-identity` owner — JWT expiry and rotation

**Codebase Evidence**:
- `configWatcher.test.ts` builds a real watcher from a snapshot (`seeded(values)`, `:93-98`) and asserts `w.getString('labels.issuer','xs')` at `:115`.
- `src/__tests__/` compiles to `dist/__tests__/` (`package.json` `"test": "tsc && node --test dist/__tests__/*.test.js"`), so the vector file is `path.resolve(__dirname, '../../../../scripts/testdata/oidc-issuer-vectors.json')`.

**TDD**: red-green required

**Covers**: AC-72 (identity logs `auth_mode_invalid` once), AC-31 (absent row → `local`, no log), AC-71 and AC-44 (identity leg: an update re-parses; the `index.ts` hook is a labelled guard)

**Instructions**:
1. **`authMode.test.ts`**:
   - every vector `mode` row: `parseAuthMode(value ?? undefined)` gives `expected` and `invalid === logs`;
   - **@AC-72:** `readAuthMode` on a stub returning `'sso'` twice logs `auth_mode_invalid` exactly once; a second distinct value logs again;
   - **@AC-31:** a stub returning its default (absent row) gives `local` and no `auth_mode_invalid`;
   - **@AC-71/@AC-44:** `watchAuthMode` with an `EventEmitter` fake that has `getString`: the first parse happens immediately; after the fake's value changes to `'oidc'` and it emits `'update'`, the next `getString` call count rises and a changed invalid value logs (D-129);
   - `__resetAuthModeLogOnce()` in `beforeEach`.
2. **`configWatcher.test.ts`** (seeded row → real reader, config-wiring b): `seeded({ 'auth.mode': { stringVal: 'both' } })` → `readAuthMode(w) === 'both'`; `stringVal: ''` → `local` + one `auth_mode_invalid`; a snapshot without the key → `local`.
3. C-13: the test literals have one consumer each; the shared vectors come from `scripts/testdata/`.

**Verification**:
```bash
cd services/xstockstrat-identity && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
grep -n "watchAuthMode(configWatcher)" src/index.ts   # (guard) AC-44/AC-71: index.ts runs main() at import (:71), so the hook is grep-guarded (D-129)
```

---

### Step 9 — service: verifyPassword, the pure sessionResponse builder and the oidc password gate

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts` — modify
- `services/xstockstrat-identity/src/telemetry.ts` — modify

**Reviewers**: `xstockstrat-identity` owner — JWT expiry and rotation; Security — auth scope correctness

**Codebase Evidence**:
- `authenticateUser` `identityServiceImpl.ts:151-207`: missing fields → 3 (`:152-156`); `SELECT user_id, password_hash, roles … WHERE email = $1 AND is_active = true` (`:158-161`); none → `recordLoginFailure('unknown_or_inactive')` + 16 (`:162-165`); seed-admin guard with `log.warn` + `blocked_default_admin` + 16 (`:171-178`); `bcrypt.compare` → `bad_password` + 16 (`:180-184`); mint `:186-187`; reply literal `:190-201`.
- `refreshToken` builds the same reply literal at `:259-270`.
- `LoginFailureReason` `telemetry.ts:357-362`.

**Lands with**: Step 10

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. **`verifyPassword(selector, password)`** (D-102), a private method: `selector` is `{ email }` (exact `email = $1`) or `{ userId }`; `SELECT user_id, email, password_hash, roles, is_active FROM identity.users WHERE <column> = $1` (no `is_active` filter). Order: no row → `{ok:false, reason:'unknown'}`; `!is_active` → `'inactive'`; `isBlockedDefaultAdmin(hash, APPLICATION_ENV)` → `'blocked_default_admin'`; `bcrypt.compare` false → `'bad_password'`; else `{ok:true, user}`. It records no metric and logs nothing.
2. **`sessionResponse({accessToken, issuedAt, expiresAt}, refreshToken, claims: {userId, email, roles})`** (D-122): a pure function returning today's reply object; every argument required. Replace both literals (`:190-201`, `:259-270`) with it.
3. **`authenticateUser`**: after the missing-fields check and before any query, `if (readAuthMode(this.config) === 'oidc') { recordLoginFailure('password_login_disabled'); return callback({ code: 7, message: 'password login disabled' }); }` (D-102). Then call `verifyPassword({email}, password)` and map: `unknown`/`inactive` → `unknown_or_inactive` + 16; `blocked_default_admin` → today's `log.warn` + metric + 16; `bad_password` → today's. Mint with the **request** `email` as today. Observable behaviour in `local`/`both` is unchanged (`@AC-2/3/6 @feature-043` PRESERVE there).
4. **`telemetry.ts`**: add `'password_login_disabled'` to `LoginFailureReason`.

**Verification**:
```bash
cd services/xstockstrat-identity && pnpm run lint && pnpm run build
grep -c "sessionResponse(" src/grpc/identityServiceImpl.ts   # definition + 2 call sites
```

---

### Step 10 — test: fakeConfig fixture, the mock sites and the oidc gate

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/__tests__/fixtures/fakeConfig.ts` — create
- `services/xstockstrat-identity/src/__tests__/identityServiceImpl.test.ts` — modify
- `services/xstockstrat-identity/src/__tests__/identityServiceImpl.otlp.test.ts` — modify
- `services/xstockstrat-identity/src/__tests__/identityTelemetry.test.ts` — modify
- `services/xstockstrat-identity/src/__tests__/revokeToken.test.ts` — modify
- `services/xstockstrat-identity/src/__tests__/telemetryAllowlist.test.ts` — modify

**Reviewers**: `xstockstrat-identity` owner — JWT expiry and rotation

**Codebase Evidence**:
- Config mocks with only `getInt`: `identityServiceImpl.test.ts:58,292,357,1141,1388`, `identityServiceImpl.otlp.test.ts:40`, `identityTelemetry.test.ts:13`, `revokeToken.test.ts:12` (added by 319, #1610) (grep `getInt\|getString\|getBool` over `src/__tests__`). Eight consumers → one fixture (C-13, R-6).
- Node fixture home exists: `src/__tests__/fixtures/` (`collectingReader.ts`, `otlpReceiver.ts`).
- `telemetryAllowlist.test.ts` drives the closed label sets.

**Lands with**: Step 9

**TDD**: red-green required

**Covers**: AC-16, AC-17, AC-31 (AuthenticateUser legs)

**Instructions**:
1. `fixtures/fakeConfig.ts`: `export function fakeConfig(overrides: { ints?: Record<string, number>; strings?: Record<string, string> } = {})` returning `{ getInt(k, d), getString(k, d) }` (absent key → default). Header comment: a call-builder fixture, not domain data, so no inventory row (`docs/patterns/test-data-inventory.md`).
2. Replace all eight mock sites with `fakeConfig(...)` (the `:292` site keeps `jwt.access_ttl_seconds = 1800`).
3. Cases in `identityServiceImpl.test.ts`:
   - **@AC-16:** `strings: {'auth.mode': 'oidc'}` → code 7 "password login disabled", **zero** `pool.query` calls, `password_login_disabled` counted;
   - **@AC-17:** `'both'` → today's token pair;
   - **@AC-31:** no `auth.mode` → today's token pair;
   - an inactive user selected by email → 16 `unknown_or_inactive` and no bcrypt (PRESERVE);
   - frozen clock: `authenticateUser` and `refreshToken` replies deep-equal their pre-refactor shape (D-122; claims have no `aud`).
4. `telemetryAllowlist.test.ts`: drive `recordLoginFailure('password_login_disabled')`; the label keys stay closed (`@AC-22 @feature-294` EXTEND).

**Verification**:
```bash
cd services/xstockstrat-identity && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
grep -n "fixtures/fakeConfig" src/__tests__/identityServiceImpl.test.ts src/__tests__/identityServiceImpl.otlp.test.ts src/__tests__/identityTelemetry.test.ts
! grep -n "{ getInt:" src/__tests__/*.test.ts   # no inline config mock left
```

---

### Step 11 — service: The four SAN-gated external-identity RPCs

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/grpc/adminDirectory.ts` — modify
- `services/xstockstrat-identity/src/grpc/externalIdentity.ts` — create
- `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts` — modify
- `services/xstockstrat-identity/src/telemetry.ts` — modify

**Reviewers**: `xstockstrat-identity` owner — JWT expiry and rotation, secret store integration; Security — JWT claims minimal, auth scope correctness

**Codebase Evidence**:
- `adminDirectory.ts`: header "No relative imports (loads under strip-types). Header-blind by design" (`:1-2`); `AdminDirectoryCall` (`:8-10`); module-private `peerDnsSans` (`:12-19`) and `hasAdminDirectoryPeer` (`:21-25`); denial before `pool.query` (`:37-40`).
- Delegation precedent `identityServiceImpl.ts:997` `async listAdminUserIds(call, callback)`.
- `mintAccessToken` (`:304-324`), `issueRefreshToken(userId, clientId?, db)` (`:330-343`), `stringsToRoles` (`:40-43`), `mapDbError` (`:116-120`), `auditSafe` (`:782-791`).
- `AUDIT_EVENT_TYPES` `telemetry.ts:381-388` with the doc comment "The audited user.* event types" (`:380`); `recordAuditFailure` `:434-437`; `BoundCounter` used for `identity.login.failures` (`:390`).
- Server wiring binds methods by camelCase name (`src/index.ts:43-46`).

**TDD**: red-green required (paired test: Step 12)

**Covers**: —

**Instructions**:
1. **`adminDirectory.ts`** (D-103): `export` `AdminDirectoryCall` and `peerDnsSans`; add `export function hasPeerSan(call: AdminDirectoryCall, allowed: readonly string[]): boolean` (exact `includes`, never a prefix). No new import; `ADMIN_DIRECTORY_PEER_SANS`, `hasAdminDirectoryPeer`, `PEER_SAN_ERROR` unchanged (`@AC-10 @feature-242`).
2. **`externalIdentity.ts`** (new; may import `./adminDirectory`): export
   - `EXTERNAL_IDENTITY_REFUSALS = { resolve: ['not linked','account inactive'], link: ['invalid credentials','account inactive','account already linked','already linked to this issuer','link disabled'], session: ['account inactive'] } as const` (D-123, D-130e);
   - `EXTERNAL_IDENTITIES_PKEY = 'external_identities_pkey'`, `EXTERNAL_IDENTITIES_ISSUER_USER_KEY = 'external_identities_issuer_user_key'` (D-118);
   - per-RPC SAN lists and `PERMISSION_DENIED` messages: Resolve `['xstockstrat-ui','xstockstrat-agent']`; IssueSession, Link, GetLinks `['xstockstrat-ui']`; message `peer not authorized for <RpcName>`.
3. **`identityServiceImpl.ts`** — four methods, each: SAN check first (no header read, no pool access before it, FR-4), then fields (code 3), then the design § 1 RPC table:
   - `resolveExternalIdentity`: one `pool.query` `SELECT u.user_id, u.roles, u.is_active FROM identity.external_identities e JOIN identity.users u USING (user_id) WHERE e.issuer = $1 AND e.subject = $2`; none → 9 `not linked`; inactive → 9 `account inactive`; else `{userId, roles: stringsToRoles(roles), isActive: true}`; any throw → 13 `resolve failed`. Writes nothing.
   - `issueSessionForUser`: `SELECT user_id, email, roles, is_active FROM identity.users WHERE user_id = $1`; none → 5 `user not found` (D-72 remainder); inactive → 9 `account inactive`; else `mintAccessToken(user_id, <stored email>, roles)` + `issueRefreshToken(user_id)` + `sessionResponse(...)`; throw → 13.
   - `linkExternalIdentity`: `readAuthMode(this.config) !== 'both'` → 9 `link disabled` + `recordLinkFailure('link_disabled')`, before any pool access and any bcrypt (D-126, AC-75). Then `verifyPassword({userId}, password)`: `unknown`/`blocked_default_admin`/`bad_password` → 9 `invalid credentials`; `inactive` → 9 `account inactive`. Then one autocommit `INSERT INTO identity.external_identities (issuer, subject, user_id) VALUES ($1,$2,$3)`. On `err.code === '23505'`, **before** `mapDbError`: `err.constraint === EXTERNAL_IDENTITIES_ISSUER_USER_KEY` → `already linked to this issuer`; `=== EXTERNAL_IDENTITIES_PKEY` → one owner re-read (`SELECT user_id … WHERE issuer=$1 AND subject=$2`): same user → `already linked to this issuer`, another → `account already linked`, none → retry the INSERT once (a second failure → 13). Success → `callback(null, {})`, then `void this.auditSafe('identity.external.linked', user_id, call.metadata, { user_id, issuer, outcome: 'linked' })` (no email, no subject, no password). Every refusal calls `recordLinkFailure(<reason>)`; `password` is never logged.
   - `getExternalIdentityLinks`: `SELECT issuer FROM identity.external_identities WHERE user_id = $1 ORDER BY issuer` → `{issuers}`; unknown user → `[]`; throw → 13.
4. **`telemetry.ts`**: append `'identity.external.linked'` to `AUDIT_EVENT_TYPES` and change its doc comment to "The audited event types"; add a `BoundCounter` `identity.link.failures` with closed `reason ∈ {invalid_credentials, inactive, already_linked, already_linked_issuer, link_disabled, internal}` and `export function recordLinkFailure(reason)`. Link never calls `recordLoginFailure`.

**Verification**:
```bash
cd services/xstockstrat-identity && pnpm run lint && pnpm run build
grep -n "x-access-scope\|x-user-id\|x-internal-caller" src/grpc/externalIdentity.ts || echo "header-blind OK"
grep -n "hasPeerSan" src/grpc/adminDirectory.ts src/grpc/identityServiceImpl.ts
```

---

### Step 12 — test: SAN gates, resolve, link, sessions, refusal contract and the audit seam

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/__tests__/externalIdentity.test.ts` — create
- `services/xstockstrat-identity/src/__tests__/fixtures/sanCall.ts` — create
- `services/xstockstrat-identity/src/__tests__/adminDirectory.test.ts` — modify (import `callWith`; no behaviour change)
- `services/xstockstrat-identity/src/__tests__/identityTelemetry.test.ts` — modify
- `services/xstockstrat-identity/src/__tests__/telemetryAllowlist.test.ts` — modify

**Reviewers**: `xstockstrat-identity` owner — JWT expiry and rotation; Security — auth scope correctness

**Codebase Evidence**:
- `callWith(san?, md, noAuthContext)` and `fakePool` (records `queries`) at `adminDirectory.test.ts:13-30`; second consumer → `fixtures/sanCall.ts` (C-13, D-135).
- Real ledger-audit harness: `identityTelemetry.test.ts:76-92` (patch `LedgerServiceClient.prototype.appendEvent` to fail, `mtls.clientCredentials` insecure, `createLedgerAudit('localhost:1')`, then `counterValue(reader, 'identity.audit.failures', 'event_type', …)`); ERROR `ledger audit append failed (best-effort)` at `src/grpc/ledgerAudit.ts:68` (D-128).
- `rotateRefreshToken` refuses inactive users at `identityServiceImpl.ts:373` (`AND u.is_active = true`); `deactivate flips is_active=false AND revokes refresh tokens` test at `identityServiceImpl.test.ts:1304`.
- Per-deployment databases: `.do/app.yaml` DATABASE_URL `…/production` and `.do/app.dev.yaml` `…/staging` (line 88 in each).

**TDD**: red-green required

**Covers**: AC-1, AC-2, AC-3, AC-4, AC-6 (+guard), AC-7, AC-25 (+guard), AC-27, AC-28, AC-33 (guard), AC-38, AC-50 (identity leg), AC-65 (identity leg), AC-66, AC-67, AC-70, AC-73, AC-75

**Instructions**:
1. **`fixtures/sanCall.ts`**: move `callWith` verbatim from `adminDirectory.test.ts:25-30` (with its own `@grpc/grpc-js` import); import it in both files. Header: call-builder helper, no inventory row. `adminDirectory.test.ts` keeps every case green unchanged.
2. **`externalIdentity.test.ts`** (scripted fake pool recording statements; `fakeConfig` from Step 10):
   - **SAN gates, pool untouched:** @AC-27 Resolve from `xstockstrat-notify` with `x-access-scope: 15` → 7; @AC-38 IssueSession from `xstockstrat-agent` → 7 and no `refresh_tokens` INSERT; @AC-70 Link from agent → 7; @AC-73 GetLinks from agent → 7; plus `xstockstrat-uix`, no auth context, spoofed `x-user-id`/`x-internal-caller` → 7. Allowed peers pass.
   - **Resolve:** @AC-1 linked active user → `user_id` and roles `[ADMIN, TRADER]`; @AC-2 the only statement is the JOIN `SELECT` (no UPDATE/INSERT) and the request carries no email field; @AC-3 no row → 9 `not linked`; @AC-6 the AC-3 case with `APPLICATION_ENV=production` → 9 `not linked`, no write; @AC-7 inactive → 9 `account inactive`.
   - **IssueSession:** missing → 5; inactive → 9; success → stored email in the claims, no `aud`, refresh `client_id` null (`@AC-4 @feature-265` PRESERVE).
   - **Link:** @AC-75 Outline `local`/`oidc` → 9 `link disabled`, zero pool calls, bcrypt spy untouched, `identity.link.failures{link_disabled}`; @AC-65 success → one INSERT `(issuer, subject, user_id)`, audit payload keys exactly `{user_id, issuer, outcome}` and the audit metadata carries the caller's `x-user-id` (D-114); @AC-66 wrong password → 9 `invalid credentials`, no INSERT; blocked seed admin in production → `invalid credentials`; @AC-67 23505 with `err.constraint = EXTERNAL_IDENTITIES_ISSUER_USER_KEY` → `already linked to this issuer`; @AC-4/@AC-25 23505 `EXTERNAL_IDENTITIES_PKEY` + re-read another user → `account already linked` (RED on the constraint-name branch), `mapDbError` never reached; re-read same user → `already linked to this issuer`; re-read none → one retry.
   - **GetLinks:** issuers ordered; unknown user → `[]`. @AC-50 (identity leg): after the user's rows are deleted, Resolve → `not linked` and a new Link succeeds.
   - **Contract:** `EXTERNAL_IDENTITY_REFUSALS` deep-equals the vector file's `refusals`; both constraint-name constants appear as `CONSTRAINT <name>` in `migrations/007_external_identities.up.sql` (read from disk; D-118).
3. **`identityTelemetry.test.ts`** — **@AC-28** (D-128, D-135): with the `:76-92` harness, drive `linkExternalIdentity` with `createLedgerAudit('localhost:1')` as the impl's audit; the callback returns OK; after `await new Promise(setImmediate)`, `identity.audit.failures{event_type="identity.external.linked"}` = 1 and the ERROR was logged.
4. **`telemetryAllowlist.test.ts`**: `recordAuditFailure('identity.external.linked')` is not bucketed as `other`; `identity.link.failures` keys are exactly `['reason']`.
5. C-13: domain literals per file have one consumer, inline; `callWith` and `fakeConfig` are the shared homes.

**Verification**:
```bash
cd services/xstockstrat-identity && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
grep -n "fixtures/sanCall\|fixtures/fakeConfig" src/__tests__/externalIdentity.test.ts src/__tests__/adminDirectory.test.ts
# (guard) AC-25: the "exactly one row" property is the Postgres PK, applied for real by CI migration-rerun (ci.yml:944)
grep -n "CONSTRAINT external_identities_pkey PRIMARY KEY (issuer, subject)" migrations/007_external_identities.up.sql
# (guard) AC-33: deactivation ends a web session at the next refresh (PRESERVE)
grep -n "AND u.is_active = true" src/grpc/identityServiceImpl.ts && grep -n "deactivate flips is_active=false AND revokes refresh tokens" src/__tests__/identityServiceImpl.test.ts && grep -n "@AC-6: expired access + failed refresh" ../xstockstrat-ui/src/middleware.test.ts
# (guard) AC-6: each deployment has its own database
grep -n "25061/production" ../../.do/app.yaml | head -1 && grep -n "25061/staging" ../../.do/app.dev.yaml | head -1
```

---

### Step 13 — service: GetSecret grant for ui/oidc.client_secret

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/authz.ts` — modify

**Reviewers**: `xstockstrat-config` owner — secret encryption + redaction; Security — secrets decryptable only via `GetSecret` gated by the `x-internal-caller` allow-list

**Codebase Evidence**:
- `SECRET_CALLER_ALLOWLIST` at `authz.ts:143-162`; the last grant is `notify` with `peerSan: 'xstockstrat-notify'` (`:157-160`).
- `hasSecretCallerAuthority` requires `HEADER_INTERNAL_CALLER` (`:74`), the callerID, the key and, for a grant with `peerSan`, that exact DNS SAN (`:182-202`; `peerDnsSans` `:175-180`).

**TDD**: red-green required (paired test: Step 14)

**Covers**: —

**Instructions**:
1. Append `{ callerID: 'ui', namespace: 'ui', keys: ['oidc.client_secret'], peerSan: 'xstockstrat-ui' }` (FR-4, D-109). Change no other grant.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run lint && grep -n "callerID: 'ui'" src/grpc/authz.ts
```

---

### Step 14 — test: The ui secret grant is header- and SAN-bound

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/secretCallerAuthz.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/secretsAndScope.test.ts` — modify

**Reviewers**: `xstockstrat-config` owner — secret encryption + redaction; Security — secrets via `GetSecret` only

**Codebase Evidence**:
- `describe('hasSecretCallerAuthority — notify grant')` at `secretCallerAuthz.test.ts:97`.
- Real-mTLS harness `secretsAndScope.test.ts:68-104`: `mintLeaf(dir, '<san>', ca, caKey)` per caller, `getSecretAs(client, md, req)`, `state.getSecretCiphertext = encryptSecret(...)`; redaction cases under `describe('redaction and per-user overlay')` at `:249`.

**TDD**: red-green required

**Covers**: AC-35

**Instructions**:
1. `secretCallerAuthz.test.ts`: `describe('hasSecretCallerAuthority — ui grant (feature 345)')` cloning the notify block: `x-internal-caller: ui` + SAN `xstockstrat-ui` → true for `('ui','oidc.client_secret')`; SAN `xstockstrat-agent` → false; callerID `agent` → false; key `oidc.client_id` → false; SAN `xstockstrat-uix` → false; no header → false.
2. `secretsAndScope.test.ts`, in the GetSecret block: mint `xstockstrat-ui` and `xstockstrat-agent` leaves. **@AC-35:** the UI client with `x-internal-caller: ui` gets the decrypted value; the agent client with the same header gets `PERMISSION_DENIED`. GetConfig/WatchConfig redaction is existing code (`@AC-2/3/14 @feature-147` PRESERVE); no new redaction case.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
```

---

### Step 15 — service: manage-users.py set-auth-mode and unlink-sso

**Status**: `pending`
**Service**: `scripts/manage-users.py`
**Files**:
- `scripts/manage-users.py` — modify

**Reviewers**: `xstockstrat-identity` owner — JWT expiry and rotation; Security — auth scope correctness

**Codebase Evidence**:
- Typer commands at `manage-users.py:165` (`reset-password`), `:213`, `:269`, `:339` (`update-roles`), `:415` (`delete-user`, `--force` at `:420`, exact `WHERE email = %s` lookup at `:448`, `typer.confirm` at `:478-485`); `_load_db_url()` at `:62` (falls back to `.env` POSTGRES_PASSWORD, docstring `:24-25`); usage docstring `:11-26`.
- The 055 CTE: `055_analysis_live_enrich_ttl_reseed.up.sql:4-23` (`WITH u AS (UPDATE … RETURNING …), nt AS (SELECT pg_notify('config_changed', json_build_object('namespace', …, 'key', …, 'environment', …, 'user_id', NULL)::text) …) SELECT …`).
- `docs/patterns/script-tooling.md` Rules 0–2 (tested Python, `scripts/tests/`).

**TDD**: red-green required (paired test: Step 16)

**Covers**: —

**Instructions**:
1. **`set-auth-mode <value> --environment <production|staging> --reason <text>`** (FR-17, D-108):
   - `value ∉ {local, both, oidc}` → print the allowed values, exit 2, **before** any connection.
   - `DATABASE_URL` required (exit 1 when unset); no `.env` fallback for this command.
   - Print the redacted host and database name, then both environments' `identity/auth.mode` global rows before.
   - One statement: `WITH u AS (UPDATE config.config_values SET value_data = %s, updated_by = 'operator:manage-users', update_reason = %s, caller_identity = NULL, updated_at = NOW() WHERE namespace = 'identity' AND key = 'auth.mode' AND environment = %s AND user_id IS NULL RETURNING namespace, key, environment), nt AS (SELECT pg_notify('config_changed', json_build_object('namespace','identity','key','auth.mode','environment', %s,'user_id', NULL)::text) AS sent) SELECT (SELECT count(*) FROM u), (SELECT count(*) FROM nt)` — it **always** notifies (D-108).
   - 0 rows updated: `local` → success (an absent row reads `local`); `both`/`oidc` → "seed migration not applied", exit 1.
   - Print both rows after. Help text names the break-glass use (`local`) and rollback.
2. **`unlink-sso <email> [--issuer <url>] [--force/-f]`** (FR-12): exact `SELECT user_id FROM identity.users WHERE email = %s` (the `:448` lookup); none → exit 1; without `--force`, `typer.confirm` (decline exits 0, nothing deleted); `DELETE FROM identity.external_identities WHERE user_id = %s [AND issuer = %s] RETURNING issuer`; 0 rows → "no SSO link found", exit 1; success prints the count and "<email> can link again with Link SSO while the deployment's auth.mode is both." (D-130b). Never print a subject.
3. Add both commands to the usage docstring.

**Verification**:
```bash
cd scripts && uv run --no-sync ruff check . && uv run --no-sync ruff format --check . && uv run --no-sync python manage-users.py --help | grep -E "set-auth-mode|unlink-sso"
```

---

### Step 16 — test: set-auth-mode and unlink-sso

**Status**: `pending`
**Service**: `scripts/manage-users.py`
**Files**:
- `scripts/tests/test_manage_users.py` — modify

**Reviewers**: `xstockstrat-identity` owner — JWT expiry and rotation

**Codebase Evidence**:
- `_mock_conn(execute_returns)` at `test_manage_users.py:47`; `TestUpdateRolesCmd` `:297`; `TestSqlParameterization` `:446`.
- CI `scripts-python` runs ruff and `uv run --no-sync pytest` in `scripts/` with no `--cov` (`ci.yml:907-940`).

**TDD**: red-green required

**Covers**: AC-44, AC-50, AC-71 (script legs)

**Instructions**:
1. Extend `_mock_conn` with an optional `fetchall_returns` list (D-64); existing callers unchanged.
2. `TestSetAuthModeCmd`:
   - **@AC-71 row 2:** `oidcc` → exit 2, output names `local, both, oidc`, and `psycopg.connect` is never called;
   - **@AC-71 row 1 / @AC-44:** `both` and `local` run the CTE with the value, environment and reason as parameters, `updated_by='operator:manage-users'`, and a `pg_notify` for `identity`/`auth.mode`;
   - 0 rows + `local` → exit 0; 0 rows + `oidc` → exit 1 "seed migration not applied";
   - unset `DATABASE_URL` → exit 1 (no `.env` fallback).
3. `TestUnlinkSsoCmd`: **@AC-50** `--force` deletes and prints the relink sentence; a declined confirmation deletes nothing; unknown email → exit 1; 0 deleted → exit 1; `--issuer` adds `AND issuer = %s`.
4. `TestSqlParameterization`: both commands pass every value as a parameter.

**Verification**:
```bash
cd scripts && uv run --no-sync ruff check . && uv run --no-sync ruff format --check . && uv run --no-sync pytest tests/test_manage_users.py -q
# Coverage: no threshold for scripts/ (the scripts-python job runs pytest without --cov, ci.yml:907-940)
```

---

### Step 17 — service: Agent mode foundation (PyJWT, sso_mode.py, the identity watcher)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/pyproject.toml` — modify
- `services/xstockstrat-agent/uv.lock` — modify
- `services/xstockstrat-agent/app/sso_mode.py` — create
- `services/xstockstrat-agent/app/config/watcher.py` — modify

**Reviewers**: `xstockstrat-agent` owner — OAuth 2.1 edge-auth correctness and statelessness; Security — auth scope correctness; Platform Lead — inter-service dependency graph (agent → config `identity` stream)

**Codebase Evidence**:
- `pyproject.toml:5-19` has no JWT library; `uv.lock:932` `name = "pyjwt"` 2.15.0, transitive via `mcp` (`:607` `{ name = "pyjwt", extra = ["crypto"] }`).
- `watcher.py:16` `WATCHED_NAMESPACES = ("agent", "indicators")`; `read_value(namespace, key)` `:73-82` returns `None` for an absent key or unwatched namespace; docstring `:1-4`; `start_watchers` waits for every namespace's snapshot (`:97-102`).
- Today's readers import `from app.config.watcher import read_value as read_config_value` (`oauth_server.py:29`, `tools.py:80`); the forwarder is registered as `watcher.py:read_config_value` (`config-wiring.json:35`), so an attribute call must use that name.

**TDD**: red-green required (paired test: Step 18)

**Covers**: —

**Instructions**:
1. Add `"pyjwt[crypto]>=2.15.0"` to `[project].dependencies`; run `uv lock` (D-2; root `CLAUDE.md` uv lock rule).
2. **`watcher.py`**: `WATCHED_NAMESPACES = ("agent", "indicators", "identity")` and the docstring; add the module-level alias `read_config_value = read_value` (no behaviour change).
3. **`app/sso_mode.py`** (D-79, D-88, D-101, D-121):
   - `ISSUER_PATTERN = r"…"` equal to the vector file literal; `_ISSUER_RE = re.compile(ISSUER_PATTERN)`; `is_valid_issuer(v) -> bool` = `isinstance(v, str) and _ISSUER_RE.fullmatch(v) is not None`.
   - `AUTH_MODES = ("local", "both", "oidc")`; `parse_auth_mode(raw: str | None) -> tuple[str, bool]` (same rules as identity).
   - `_log_once(level, message, key, extra)` over a module set; `_reset_log_once()` for tests (D-90 carried as one helper per service).
   - Reads, one receiver per namespace (comment above the imports, two lines, constraint only):
     `from app.config import watcher as identity_config` and `from app.config import watcher as agent_config`.
   - `current_auth_mode() -> str`: `parse_auth_mode(identity_config.read_config_value("identity", "auth.mode"))`; invalid → `_log_once('warning', 'auth_mode_invalid', ('auth_mode', raw), {'value': raw})`.
   - `agent_issuer() -> tuple[str, bool]`: `v = agent_config.read_config_value("agent", "oidc.issuer") or ""`; invalid → `_log_once('error', 'sso_issuer_invalid', ('agent_issuer', v), {'reason': 'agent_issuer'})`; returns `(v, is_valid_issuer(v))`.

**Verification**:
```bash
cd services/xstockstrat-agent && uv lock --check && uv run ruff check . && uv run ruff format --check .
uv run pytest --cov=app --cov-fail-under=40 -q   # adding "identity" to WATCHED_NAMESPACES keeps every lifespan/snapshot test green here
cd ../.. && node scripts/check-config-wiring.mjs --keys identity.auth.mode,agent.oidc.issuer   # exit 0: no unattributed read
```

---

### Step 18 — test: Agent vectors and mode resolution

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_oidc_vectors.py` — create
- `services/xstockstrat-agent/tests/test_sso_mode.py` — create
- `services/xstockstrat-agent/tests/conftest.py` — modify

**Reviewers**: `xstockstrat-agent` owner — OAuth 2.1 edge-auth correctness and statelessness

**Codebase Evidence**:
- `install_watcher(monkeypatch, namespace, **values)` at `tests/test_config_watcher.py:46-50`.
- The autouse `config_snapshots` fixture iterates `watcher.WATCHED_NAMESPACES` (`conftest.py:145-157`), so it covers `identity`.
- Vector-path idiom: `Path(__file__).resolve().parents[3] / "scripts" / "testdata" / "oidc-issuer-vectors.json"` (`tests/` → service → `services/` → repo).

**TDD**: red-green required

**Covers**: AC-72 (agent leg), AC-55 (agent log), AC-31 (agent leg)

**Instructions**:
1. `test_oidc_vectors.py`: `ISSUER_PATTERN == data['issuer_pattern']`; every `issuer` row → `is_valid_issuer == valid`; every `mode` row → `parse_auth_mode(value)` gives `(expected, logs)`.
2. `test_sso_mode.py`:
   - **@AC-72:** `identity` `auth.mode = "sso"` → `current_auth_mode() == "local"`, one `auth_mode_invalid` across two calls;
   - **@AC-31:** no row → `local`, no `auth_mode_invalid`;
   - **@AC-55:** `agent` `oidc.issuer = "http://auth.example.test"` → `(…, False)` and one ERROR `sso_issuer_invalid`; a second distinct value logs again;
   - `"identity" in WATCHED_NAMESPACES`.
3. `conftest.py`: an autouse fixture calling `sso_mode._reset_log_once()`.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40 -q && uv run ruff check . && uv run ruff format --check .
grep -n "install_watcher" tests/test_sso_mode.py
```

---

### Step 19 — service: Async JWKS and discovery cache (app/jwks.py)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/jwks.py` — create

**Reviewers**: `xstockstrat-agent` owner — OAuth 2.1 edge-auth correctness and statelessness; Security — auth scope correctness

**Codebase Evidence**:
- `httpx` is a direct dependency (`pyproject.toml:7`); `respx` is a dev dependency (`:22`).
- **Not found**: no async JWKS or discovery client exists (recon); `PyJWKClient` is locked out (R-1).

**TDD**: red-green required (paired test: Step 20)

**Covers**: —

**Instructions**:
1. Fixed invariants, each with the two-line F-07 constraint comment (D-13, D-37, D-138): `_JWKS_FRESH_S = 300` (spec-level choice 2), `_JWKS_COOLDOWN_S = 30`, `_JWKS_FETCH_TIMEOUT_S = 5`, `_JWKS_MAX_AGE_S = 3600`, `_JWKS_MAX_BYTES = 65536`, `_DISCOVERY_FRESH_S = 600`, `_ASYMMETRIC_ALGS = frozenset({"RS256","RS384","RS512","PS256","PS384","PS512","ES256","ES384","ES512"})`.
2. `async def discovery(issuer) -> dict`, cached for `_DISCOVERY_FRESH_S` (D-18, D-27, D-35, D-89): `GET {issuer}/.well-known/openid-configuration` with `httpx.AsyncClient(follow_redirects=False, timeout=_JWKS_FETCH_TIMEOUT_S, headers={'Accept-Encoding':'identity'})`; reject a `Content-Length` above `_JWKS_MAX_BYTES` and cap the streamed body; require `doc['issuer'] == issuer` byte-exact and a same-origin `jwks_uri` on every refetch.
3. `_IssuerKeys` per issuer (D-31): `keys_by_kid`, `fetched_at`, `last_attempt_at`, `last_fetch_ok`, `task`; a fetch starts only when `task is None` and the cooldown passed (or never attempted); the task owns `asyncio.timeout(_JWKS_FETCH_TIMEOUT_S)`, is the only writer, and its done-callback calls `t.exception()`. Ingest (D-35): skip a JWK with one WARN when `alg` is absent or outside `_ASYMMETRIC_ALGS`, or `PyJWK(jwk)` raises; fail only when zero usable keys remain.
4. `async def key_for(issuer, kid) -> tuple[PyJWK, str] | Literal['unknown_kid','unavailable']` per D-31 as amended by D-138, with `age = now - fetched_at`: known `kid` and age ≤ `_JWKS_FRESH_S` → key; known `kid` and age ≤ `_JWKS_MAX_AGE_S` → key + gated non-awaited refresh; age > `_JWKS_MAX_AGE_S` or never fetched → no cached key is returned, known `kid` or not: join or start (cooldown permitting) the task and `await asyncio.shield(task)` (ok and found → the new key; ok but absent → `'unknown_kid'`; failed → `'unavailable'`), and inside the cooldown with no task → `'unavailable'`; unknown `kid` on a set ≤ `_JWKS_MAX_AGE_S` → `await asyncio.shield(task)` as above, and inside the cooldown with no task → `last_fetch_ok` ? `'unknown_kid'` : `'unavailable'`. The caller's deadline bounds the `shield` (D-18).
5. `_reset_for_tests()`.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run ruff check . && uv run ruff format --check . && uv run python -c "import app.jwks"
```

---

### Step 20 — test: JWKS state machine

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_jwks.py` — create
- `services/xstockstrat-agent/tests/conftest.py` — modify (shared `sso_keys` fixture)

**Reviewers**: `xstockstrat-agent` owner — OAuth 2.1 edge-auth correctness and statelessness

**Codebase Evidence**:
- `HANG_GUARD_S = 10` at `conftest.py:20`; `respx` dev dependency (`pyproject.toml:22`).

**TDD**: red-green required

**Covers**: AC-61, AC-79

**Instructions**:
1. `conftest.py` `sso_keys` fixture (C-13; consumers: this file and Step 24's three files): an RSA key pair (`cryptography`), its JWKS (`kid`, `alg=RS256`), and `mint(**claims)` signing RS256 with `kid` and `typ=at+jwt`.
2. `test_jwks.py` (respx-mocked discovery and JWKS, fake clock): fresh hit; between `_JWKS_FRESH_S` and `_JWKS_MAX_AGE_S` serve + background refresh; **@AC-79** known `kid` on a set 3601 s past its last successful fetch + JWKS 500 → `'unavailable'` (the cached key is not returned), the same inside the cooldown with no task → `'unavailable'` with no new fetch, and a successful refetch → the new key; **@AC-61** unknown `kid` + JWKS 500 → `'unavailable'`; fetch ok but `kid` absent → `'unknown_kid'`; cooldown keeps the call count at 1 within 30 s; concurrent unknown-`kid` callers share one fetch; discovery issuer with a trailing slash → reject (D-89); cross-origin `jwks_uri` → reject; no redirect followed; oversized `Content-Length` → reject; an unusable or `EdDSA`/`none`/alg-less JWK skipped with a WARN, and a JWKS of only such keys → `'unavailable'`; a failed task with no awaiter leaves no "exception was never retrieved" (`loop.set_exception_handler` + `gc.collect()`).
3. No key generated inline in `test_jwks.py` (C-13).

**Verification**:
```bash
cd services/xstockstrat-agent && grep -n "def sso_keys" tests/conftest.py && ! grep -n "generate_private_key" tests/test_jwks.py
uv run pytest --cov=app --cov-fail-under=40 -q && uv run ruff check . && uv run ruff format --check .
```

---

### Step 21 — service: Effective scope, the resolve client helper and the new rejection reasons

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/scopes.py` — modify
- `services/xstockstrat-agent/app/tools.py` — modify
- `services/xstockstrat-agent/app/client.py` — modify
- `services/xstockstrat-agent/app/tool_metrics.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability, admin `x-access-scope` forwarded only by management tools; Security — auth scope correctness

**Codebase Evidence**:
- Scope sites: `tools.py:149` `return roles_to_access_scope(claims.get("roles"))` in `_caller_access_scope` (`:140`), and `tools.py:219` in `CallerPropagationMiddleware` (`:196`); import at `tools.py:81` (recon R-7).
- `scopes.py:39` `roles_to_access_scope`.
- `client.py:45` `_RPC_TIMEOUT_S = 10.0`; `validate_token` at `:1596` opens `mtls.secure_channel(IDENTITY_ENDPOINT, "xstockstrat-identity")`; `_metadata(*extra)` at `:81`.
- `tool_metrics.py:36-39` `record_auth_rejected` docstring set.

**TDD**: red-green required (paired test: Step 22)

**Covers**: —

**Instructions**:
1. **`scopes.py`** (D-3, D-95, D-105): `_OAUTH_SCOPE_BITS` (`xstockstrat.read|write|admin|trade` → READ/WRITE/ADMIN/TRADING); `MCP_SCOPES_SUPPORTED` (the four, in that order); `granted_scopes(payload)` = `scp` if `list[str]`, else a space-split `scope` if `str`, else empty; `scopes_to_mask(scopes)`; `effective_access_scope(claims)` = `claims["access_scope"]` when the **key is present** (0 is legal), else `roles_to_access_scope(claims.get("roles"))`.
2. **`tools.py`**: both sites call `effective_access_scope(claims)`; update the import.
3. **`client.py`**: `def rpc_timeout_s() -> float: return _RPC_TIMEOUT_S` beside `:45`; `async def resolve_external_identity(issuer, subject, *, trace_id, timeout_s) -> dict` beside `validate_token`: its own `mtls.secure_channel(IDENTITY_ENDPOINT, "xstockstrat-identity")` (AGENT-1), lazy `gen.identity` import (AGENT-2), `metadata=[("x-trace-id", trace_id)]` (pre-auth: trace id only, D-114/C-03), `timeout=timeout_s`; returns `{user_id, roles: [Role.Name(r).removeprefix('ROLE_').lower()], is_active}`; `grpc.aio.AioRpcError` propagates.
4. **`tool_metrics.py`**: add `jwks_unavailable | account_refused` to the docstring set (D-42).

**Verification**:
```bash
cd services/xstockstrat-agent && uv run ruff check . && uv run ruff format --check . && grep -c "effective_access_scope" app/tools.py   # import + 2 sites
grep -n "def resolve_external_identity" -A25 app/client.py | grep -E "x-trace-id|timeout=timeout_s"
```

---

### Step 22 — test: Scope narrowing at both sites, the resolve helper and the telemetry allow-list

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_sso_scope.py` — create
- `services/xstockstrat-agent/tests/test_telemetry_allowlist.py` — modify
- `services/xstockstrat-agent/tests/test_client_deadlines.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability

**Codebase Evidence**:
- `conftest.py:15-17` `ADMIN`/`TRADER`/`VIEWER`; `_ctx(claims)` `:23`.
- `test_client_deadlines.py` is the per-RPC deadline net (`@AC-10 @feature-273`).

**TDD**: red-green required

**Covers**: AC-12, AC-13, AC-22 (scope arithmetic)

**Instructions**:
1. `test_sso_scope.py`: **@AC-12** trader (11) & `scp=["xstockstrat.read"]` → 1; **@AC-13** viewer & all four → 1; **@AC-22** trader & `read write` → 3; `scope` string fallback = `scp`; neither → 0; non-list `scp` → fallback; both sites honour a stamped `access_scope` (including 0: `scp=[]` → `x-access-scope 0`, D-105); a legacy claim without `access_scope` keeps `roles_to_access_scope` (PRESERVE).
2. `test_telemetry_allowlist.py`: `_drive()` adds `record_auth_rejected("jwks_unavailable")` and `("account_refused")`; keys stay closed.
3. `test_client_deadlines.py`: `resolve_external_identity` passes `timeout=` and `x-trace-id`.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40 -q && uv run ruff check . && uv run ruff format --check .
```

---

### Step 23 — service: oidc token validator, role cache, the status map and mode-gated routes

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/sso_auth.py` — create
- `services/xstockstrat-agent/app/main.py` — modify
- `services/xstockstrat-agent/app/oauth_metadata.py` — modify

**Reviewers**: `xstockstrat-agent` owner — OAuth 2.1 edge-auth correctness and statelessness (`instance_count > 1` safe), MCP tool contract stability; Security — JWT claims minimal, auth scope correctness

**Codebase Evidence**:
- `main.py`: `_authorized` `:142-165` (bearer `:149-154`, `validate_bearer_claims` `:156`, stamp `:161-164`); `_send_unauthorized` `:167-178`; `_send_identity_unavailable` `:180-184` (503 text/plain, no WWW-Authenticate); `handle_mcp` `:197-223` (verdict order `:215-221`); routes `:238-253` with `Mount("/", handle_mcp)` last (an unrouted `/oauth/*` falls to `handle_mcp` → 401, recon R-5).
- `oauth_metadata.py:16` `AGENT_PUBLIC_URL` read at import (AGENT-8); `protected_resource_metadata` `:19-26`; `authorization_server_metadata` `:29-41`.
- `_new_trace_id()` `tools.py:179`; `IDENTITY_UNAVAILABLE` sentinel in `app/auth.py` is not reused (FR-8).

**TDD**: red-green required (paired test: Step 24)

**Covers**: —

**Instructions**:
1. **`app/sso_auth.py`** (design § 2 status map; D-17, D-18, D-25, D-26, D-30, D-69, D-84, D-95):
   - `from app.oauth_metadata import AGENT_PUBLIC_URL` (no fifth env read, AGENT-8); fixed invariants `_ROLE_TTL_S = 60.0`, `_CLOCK_SKEW_S = 30` (F-07 form); `RESOLVE_REFUSALS = ("not linked", "account inactive")` (mirror of `refusals.resolve`).
   - `class Outcome(enum.Enum)`: `OK, UNAUTHORIZED, FORBIDDEN, UNAVAILABLE, INTERNAL`; `@dataclass Verdict(outcome, claims: dict | None = None, body: str = "")` — an explicit refusal, not a truthy sentinel.
   - `_precheck(token, issuer) -> str | None` (outside the deadline): `jwt.get_unverified_header` → `kid` a non-empty `str`, `isinstance(alg, str)` and `alg in _ASYMMETRIC_ALGS` (HS256/`none` refused), `typ.lower() == "at+jwt"`; unverified payload is a `dict` whose `iss == issuer`; any `jwt.InvalidTokenError`/garbage → `None`.
   - `async def authenticate(token, issuer, trace_id) -> Verdict`: precheck `None` → `record_auth_rejected("invalid_token")`, UNAUTHORIZED. Then `async with asyncio.timeout_at(loop.time() + client.rpc_timeout_s())`: `jwks.discovery(issuer)`; `jwks.key_for(issuer, kid)` (`'unknown_kid'` → 401 `invalid_token`; `'unavailable'` → `jwks_unavailable`, UNAVAILABLE); `jwt.decode(token, key, algorithms=[jwk_alg], audience=AGENT_PUBLIC_URL, issuer=issuer, leeway=_CLOCK_SKEW_S, options={"require": ["exp","iss","aud","sub"]})`, then strict `int(exp) > time.time()`, `aud == X or aud == [X]` (else `wrong_audience`), `sub` a non-empty `str`; any decode error → 401 `invalid_token`. Cache `(iss, sub) → (monotonic expiry, user_id, roles)`, successes only, never stale. Miss → `client.resolve_external_identity(iss, sub, trace_id=…, timeout_s=max(0, deadline - loop.time()))`: `FAILED_PRECONDITION` with `details() in RESOLVE_REFUSALS` → `account_refused`, FORBIDDEN, `body = details()`; another detail → `internal_error` + ERROR, INTERNAL (R-30); `UNAVAILABLE`/`DEADLINE_EXCEEDED`/overall `TimeoutError` → `identity_unavailable`, UNAVAILABLE; any other exception → `internal_error` + one ERROR naming `type(e).__name__`, INTERNAL.
   - OK claims: `{user_id, roles, access_scope: roles_to_access_scope(roles) & scopes_to_mask(granted_scopes(payload)), trace_id}` — no `email`, no `sub`. Never log the token or any claim value.
   - `_reset_for_tests()` clears the cache.
2. **`main.py`** (D-105):
   - `handle_mcp` reads `mode = current_auth_mode()` per request. `local`/`both` → today's `_authorized` path, byte-identical.
   - `oidc`, in order: `issuer, valid = agent_issuer()`; invalid → `record_auth_rejected("internal_error")` + `_send_identity_unavailable` (before the bearer check, AC-55); no bearer → `missing_bearer` + `_send_unauthorized`; else `sso_auth.authenticate(token, issuer, _new_trace_id())`: OK → stamp `scope["state"][MCP_CLAIMS_SCOPE_KEY]` as today; UNAUTHORIZED → `_send_unauthorized`; FORBIDDEN → new `_send_forbidden(body)` (403 text/plain, body = the detail, no WWW-Authenticate); UNAVAILABLE/INTERNAL → `_send_identity_unavailable`.
   - `_legacy_only(endpoint)`: in `oidc` → 404 text/plain; otherwise calls the endpoint unchanged. Wrap `/.well-known/oauth-authorization-server` and the four `/oauth/*` routes (they stay registered, R-5).
3. **`oauth_metadata.py`**: `protected_resource_metadata` in `local`/`both` → unchanged; `oidc` + valid issuer → `{"resource": AGENT_PUBLIC_URL, "authorization_servers": [issuer], "scopes_supported": list(MCP_SCOPES_SUPPORTED)}`; `oidc` + invalid → `Response("Service Unavailable", 503, media_type="text/plain", headers={"Cache-Control": "no-store"})`.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run ruff check . && uv run ruff format --check . && uv run pytest tests/test_oauth.py tests/test_streamable_http_auth.py tests/test_auth_deadline.py -q   # local regression net
! grep -n "_RPC_TIMEOUT_S" app/sso_auth.py   # uses client.rpc_timeout_s()
```

---

### Step 24 — test: Agent oidc auth end to end (status map, deadline, routes, metadata)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_sso_auth.py` — create
- `services/xstockstrat-agent/tests/test_sso_auth_deadline.py` — create
- `services/xstockstrat-agent/tests/test_sso_routes.py` — create
- `services/xstockstrat-agent/tests/conftest.py` — modify

**Reviewers**: `xstockstrat-agent` owner — OAuth 2.1 edge-auth correctness and statelessness, MCP tool contract stability

**Codebase Evidence**:
- End-to-end template `test_streamable_http_auth.py:24-60` (`build_http_app()`, `TestClient`, SSE `data:` parse).
- Deadline template `test_auth_deadline.py:51,62,89`.
- Legacy net `tests/test_oauth.py`.

**TDD**: red-green required

**Covers**: AC-10, AC-11 (agent), AC-14, AC-15, AC-21, AC-22, AC-23, AC-30, AC-32, AC-42 (guard), AC-43, AC-44 (agent leg), AC-49 (agent PRM), AC-55, AC-61, AC-71 (agent leg), AC-79

**Instructions**:
1. `conftest.py`: `oidc_mode(monkeypatch)` fixture (three consumers) installing `identity` `auth.mode="oidc"` and `agent` `oidc.issuer` watchers and respx-mocking discovery + JWKS from `sso_keys`; reset `sso_auth`/`jwks` state per test.
2. `test_sso_auth.py` (`client.resolve_external_identity` mocked): **@AC-10** foreign `aud` → 401 + `wrong_audience`; **@AC-23** one case per row (foreign `iss`, expired, foreign signature, identity HS256) → 401, rows 1 and 4 without awaiting JWKS; D-84 garbage rows; `EdDSA`/`none` header → 401; empty/int `sub`, missing claims, wrong `typ` → 401; `aud` `"X"` and `["X"]` pass; **@AC-21** Resolve 9 `account inactive` → FORBIDDEN body `account inactive`; **@AC-30** `not linked` → body `not linked`; an unknown detail → INTERNAL; `RESOLVE_REFUSALS` equals the vector `refusals.resolve`; **@AC-14** fake monotonic clock: +55 s cached scope, +61 s re-resolves new roles; **@AC-15** expired entry + `UNAVAILABLE` → UNAVAILABLE and no backend RPC; inactive results not cached; **@AC-61** unknown `kid` + JWKS down → UNAVAILABLE + `jwks_unavailable`; **@AC-79** a token on a known `kid` whose key set is past `_JWKS_MAX_AGE_S` (advance `jwks`'s clock 3601 s) with the JWKS down → UNAVAILABLE + `jwks_unavailable`, not OK; caplog never contains the token or a sentinel email.
3. `test_sso_auth_deadline.py`: clone `test_auth_deadline.py:51-99` for `oidc` — a stalled Resolve → 503 without WWW-Authenticate within 10.5 s, same `x-trace-id`; a precheck reject consumes no budget.
4. `test_sso_routes.py` (`TestClient(build_http_app())`): **@AC-22** a valid token runs `list_strategies` with backend `x-user-id` = the resolved id (never `sub`) and `x-access-scope` 3; **@AC-21/@AC-30** 403 text/plain bodies and no backend stub called; **@AC-11/@AC-49** PRM deep-equals `prm.expected` from the vector file (with `AGENT_PUBLIC_URL` patched to `prm.agent_public_url`); **@AC-43** `/oauth/register` → 404, AS metadata → 404, an identity HS256 token → 401; **@AC-55** invalid `agent/oidc.issuer` → any bearer 503 without WWW-Authenticate, PRM 503 `no-store`; **@AC-32** `both` → `validate_bearer_claims` path, identity token accepted, an issuer RS256 token for a linked subject → 401; **@AC-44/@AC-71** changing the installed `identity` snapshot from `oidc` to `local` between two requests switches the next request back to `validate_bearer_claims` (the 60 s delivery is the config watch, a labelled guard).
5. **(guard) AC-42**: `tests/test_oauth.py` stays green unchanged in `local`.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40 -q && uv run ruff check . && uv run ruff format --check .
grep -n "def sso_keys\|def oidc_mode" tests/conftest.py
uv run pytest tests/test_oauth.py -q   # (guard) AC-42: local MCP keeps the built-in OAuth server
```

---

### Step 25 — service: UI typecheck script and CI step

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/package.json` — modify
- `services/xstockstrat-ui/tsconfig.json` — modify
- `.github/workflows/ci.yml` — modify

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety; Platform Lead — CI gate parity

**Codebase Evidence**:
- `package.json` scripts (`:6-19`) have no `typecheck`.
- `tsconfig.json:21` `"include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"]`, `:22` `"exclude": ["node_modules"]`.
- `node-test` job: matrix entry `xstockstrat-ui` and the `test with coverage` step at `ci.yml:818`.
- Ledger `insights.md:2948`: a bare `tsc --noEmit` can false-RED on `.next/types`; `exclude` removes the trap.

**TDD**: N/A (tooling gate; its RED proof is the D-83 `@ts-expect-error` removal in Step 37)

**Covers**: —

**Instructions**:
1. `"typecheck": "tsc --noEmit"` in `package.json` (D-93).
2. `tsconfig.json` `"exclude": ["node_modules", ".next"]`.
3. In `node-test`, before `test with coverage`: `- name: typecheck (xstockstrat-ui)`, `if: matrix.service == 'xstockstrat-ui'`, `working-directory: services/xstockstrat-ui`, `run: pnpm run typecheck`.
4. Run it once; paste the exit code and output into the step's evidence. Fix any pre-existing error here without `@ts-ignore` (owner-accepted widening, D-93) and log each touched path in the Deviation Log before the commit (F-08).

**Verification**:
```bash
cd services/xstockstrat-ui && grep -n '".next"' tsconfig.json && pnpm install --frozen-lockfile && pnpm --filter @xstockstrat/proto run build && pnpm run typecheck && pnpm run lint
grep -n "typecheck (xstockstrat-ui)" ../../.github/workflows/ci.yml
```

---

### Step 26 — service: UI leaf modules (issuer grammar, Origin check, deadlines, log-once, compose APP_URL)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/oidcIssuer.ts` — create
- `services/xstockstrat-ui/src/lib/sameOrigin.ts` — create
- `services/xstockstrat-ui/src/lib/deadlines.ts` — modify
- `services/xstockstrat-ui/src/lib/serverLog.ts` — modify
- `docker-compose.yml` — modify

**Reviewers**: `xstockstrat-ui` owner — no secret values rendered in UI, Connect-RPC call safety; Security — auth scope correctness; Platform Lead — deploy config parity (`APP_URL`)

**Codebase Evidence**:
- `deadlines.ts:1` "Leaf module (no imports)", `REFRESH_TIMEOUT_MS = 10_000` at `:3`.
- `serverLog.ts:37` `export const serverLog = { … }`.
- `APP_URL` is set on every deploy target: `.do/app.yaml:658-659`, `.do/app.dev.yaml:655-656`, `deploy/homelab/compose.yml:307`; **absent** from `docker-compose.yml` (UI block: `AGENT_PUBLIC_URL` at `:522`, `ports` at `:526-527`) and from Playwright (D-67).
- The grammar literals and the TS round-trip are in `git show 7eeab3d:…/design.md` § (C) 1 (lines 702–766), carried by D-110 (D-79, D-88).

**TDD**: red-green required (paired test: Step 27)

**Covers**: —

**Instructions**:
1. **`oidcIssuer.ts`**: `ISSUER_PATTERN`, `APP_URL_PATTERN` as `String.raw` literals equal to the vector file; `ISSUER_RE`/`APP_URL_RE` with no flags; `isValidIssuer(v)` = regex + `new URL` round-trip (`u.origin + (v.length > u.origin.length ? u.pathname : '') === v`).
2. **`sameOrigin.ts`** (D-68, D-77, D-81, D-86): `parseAppOrigin(raw)` (`typeof raw === 'string' && APP_URL_RE.test(raw) && new URL(raw).origin === raw ? raw : null`); `appOrigin()` = `parseAppOrigin(process.env.APP_URL)`, logging `logOnce('error', 'app_url_invalid', …, {reason:'app_url'})` on null (unset included); `isSameOrigin(req, 'required' | 'if_present', origin = appOrigin())` (`required`: Origin present and equal; `if_present`: absent passes, present must equal, a null `appOrigin` fails open); `originHost(h)`.
3. **`deadlines.ts`** (stays a leaf; F-07 two-line comments): `AUTH_CONFIG_TIMEOUT_MS = 10_000`, `OIDC_TIMEOUT_S = 10`, `OIDC_DISCOVERY_FRESH_S = 600`, `OIDC_ID_TOKEN_ALG = 'RS256'`, `OIDC_CLOCK_SKEW_S = 30` (D-13, D-37, D-70), and `raceDeadline<T>(p, ms)` that rejects on timeout and clears its timer.
4. **`serverLog.ts`** (D-90): `logOnce(level: 'warn'|'error', message, key, detail?)` over a module `Set`, plus `__resetLogOnce()`.
5. **`docker-compose.yml`**: in the `xstockstrat-ui` block after `AGENT_PUBLIC_URL` (`:522`), `APP_URL: http://localhost:3000` with a two-line constraint comment (must equal the browser origin exactly; local compose SSO is unsupported, D-91).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint
grep -c "key: APP_URL\|APP_URL: \${APP_URL" ../../.do/app.yaml ../../.do/app.dev.yaml ../../deploy/homelab/compose.yml   # each deploy target already sets it
grep -n "APP_URL: http://localhost:3000" ../../docker-compose.yml && docker compose -f ../../docker-compose.yml config --quiet
```

---

### Step 27 — test: UI leaf-module unit tests

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/oidcIssuer.test.ts` — create
- `services/xstockstrat-ui/src/lib/sameOrigin.test.ts` — create
- `services/xstockstrat-ui/src/lib/deadlines.test.ts` — create
- `services/xstockstrat-ui/src/lib/serverLog.test.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety

**Codebase Evidence**:
- `vitest.config.ts:19` node environment, `include: ['src/**/*.test.ts']` (`:24`); coverage over `src/lib/**` with thresholds 40 (`:29`, `:33-37`); `import.meta.url` path idiom at `:16`.
- `serverLog.test.ts` exists (50 lines, last changed `d758013`): its "no provider" test must run first, since the OTel logger
  provider can be set only once.

**TDD**: red-green required

**Covers**: AC-54 (issuer grammar), AC-57, AC-58, AC-59 (Origin semantics)

**Instructions**:
1. `oidcIssuer.test.ts` (vector path `fileURLToPath(new URL('../../../../scripts/testdata/oidc-issuer-vectors.json', import.meta.url))`): pattern constants equal the JSON; every `issuer` row → `isValidIssuer === valid`; every `app_url` row → `parseAppOrigin(value ?? undefined) === origin` (imported from `sameOrigin`); row counts 66/16; **@AC-54** `http://auth.example.test` is invalid.
2. `sameOrigin.test.ts` (`vi.stubEnv('APP_URL', …)`): `required` — missing, `null`, match, other port, other scheme, null `appOrigin`; **@AC-59** no Origin → false; `if_present` — absent, match, **@AC-57** `https://dashboard.example.test` → false, `null`, **@AC-58** null `appOrigin` + sibling → true; one `app_url_invalid` ERROR across repeated calls.
3. `deadlines.test.ts`: `raceDeadline` rejects after `ms` (fake timers), resolves when earlier, leaves `vi.getTimerCount() === 0`.
4. `serverLog.test.ts`: append after the existing tests (keep their order): `logOnce` emits once per key; `__resetLogOnce`
   resets.
5. C-12: scenario one-offs (issuer strings, origins), no domain object — say so in each file header.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint && pnpm run test:coverage   # vitest thresholds 40% over src/lib/** (vitest.config.ts:33-37)
```

---

### Step 28 — service: safeRedirect extraction and the refusal mirror

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/safeRedirect.ts` — create
- `services/xstockstrat-ui/src/lib/ssoRefusals.ts` — create
- `services/xstockstrat-ui/src/app/auth/login/page.tsx` — modify (import the extracted `safeRedirect`)

**Reviewers**: `xstockstrat-ui` owner — no secret values rendered in UI; Security — auth scope correctness

**Codebase Evidence**:
- Local `safeRedirect(target)` at `src/app/auth/login/page.tsx:7-18` (allow-list `/trader`, `/insights`, `/config-ui`, else `/trader`).
- Identity's `EXTERNAL_IDENTITY_REFUSALS` (Step 11) and the vector `refusals` (Step 6).

**TDD**: red-green required (paired test: Step 29)

**Covers**: —

**Instructions**:
1. Move `safeRedirect` verbatim into `src/lib/safeRedirect.ts`; `page.tsx` imports it (D-46). Behaviour unchanged.
2. `ssoRefusals.ts` (D-123, D-130e): `export const SSO_REFUSALS = { resolve: [...], link: [...], session: [...] } as const` with the identity strings, plus `export type ResolveRefusal`, `LinkRefusal`, `SessionRefusal`. No mapping here (the code maps live in Step 36's `ssoErrors.ts`).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint
grep -n "safeRedirect" src/app/auth/login/page.tsx src/lib/safeRedirect.ts
```

---

### Step 29 — test: safeRedirect and the refusal-mirror contract

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/safeRedirect.test.ts` — create
- `services/xstockstrat-ui/src/lib/ssoRefusals.test.ts` — create

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety

**Codebase Evidence**:
- `vitest.config.ts:19-37` (node env, `src/lib/**` coverage, 40%).

**TDD**: red-green required

**Covers**: AC-3, AC-4, AC-7, AC-66, AC-67 (the UI mirror of the identity refusal details these scenarios surface)

**Instructions**:
1. `safeRedirect.test.ts`: today's allow-list plus `/trader/../..//evil.com` pinned to the current return value (D-54).
2. `ssoRefusals.test.ts`: `SSO_REFUSALS` deep-equals the vector `refusals` (the three-language contract, D-123).
3. C-12: scenario one-offs; say so in the headers.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint && pnpm run test:coverage
```

---

### Step 30 — service: Server-side config loaders (oidcConfig.ts)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/oidcConfig.ts` — create
- `services/xstockstrat-ui/src/lib/headers.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — environment (`production`/`staging`) scope correctness, no secret values rendered in UI; Security — secrets via `GetSecret` only

**Codebase Evidence**:
- `headers.ts:5-7` `HEADER_USER_ID`, `HEADER_ACCESS_SCOPE`, `HEADER_TRACE_ID`; the config side's `HEADER_INTERNAL_CALLER = 'x-internal-caller'` at `services/xstockstrat-config/src/grpc/authz.ts:74`; precedent sender `notify commsgunSecret.ts:43` (design § 3).
- `configClient` at `connectClients.ts:113`; per-call `timeoutMs` honoured (`:72-76`).
- `nativeConfigEnvironment()` at `deploymentEnv.ts:13` (unset `APPLICATION_ENV` → STAGING, D-39); BFF precedent `insightsBff.ts:171-175`.
- Oneof-presence reads: UI `CLAUDE.md` § Config Keys Consumed; the mock's `values` shape `{ value: { case, value } }` (`e2e/mock-backend.ts:1569-1576`).
- Receivers `oidcConfig.ts:{identity,ui,agent}.values` registered in Step 6.

**TDD**: red-green required (paired test: Step 31)

**Covers**: —

**Instructions**:
1. `headers.ts`: `export const HEADER_INTERNAL_CALLER = 'x-internal-caller';` (D-130d).
2. `oidcConfig.ts` (design § 3 loader table; D-39, D-101, D-125, D-134). Every read: `environment: nativeConfigEnvironment()`, `userId: ''`, `{ timeoutMs: AUTH_CONFIG_TIMEOUT_MS }`; `GetConfig` with **no headers**; oneof-presence; any rejection or timeout → `'error'`.
   - `parseAuthMode` (same rules as identity) and `loadAuthMode()`: `const identity = await configClient.getConfig({namespace:'identity', …})`; `identity.values['auth.mode']` absent → `local` silently; present → parse, invalid → `logOnce('warn','auth_mode_invalid', value)`. Returns `'local'|'both'|'oidc'|'error'`.
   - `loadOidcConfig()`: `const ui = …getConfig({namespace:'ui'})`; reads `ui.values['oidc.issuer']`, `['oidc.client_id']` and the four `mcp_client_id*` keys (absent → `''`). `valid = isValidIssuer(issuer) && clientId !== '' && appOrigin() !== null`; an invalid issuer logs `logOnce('error','sso_issuer_invalid', …, {reason:'ui_issuer'})` (the `APP_URL` failure logs only through `appOrigin()`, D-86). Returns `{issuer, clientId, mcpClientIds: {claude, claudeReadonly, claudeCode, claudeCodeReadonly}, valid} | 'error'`.
   - `loadOidcClientSecret()`: `configClient.getSecret({namespace:'ui', key:'oidc.client_secret', environment, userId:''}, {timeoutMs, headers: {[HEADER_INTERNAL_CALLER]: 'ui'}})` — that header only; returns `{found, value} | 'error'` (`found=false` or `''` value → `{found:false}`); never logs the value.
   - `loadAgentIssuer()`: `const agent = …getConfig({namespace:'agent'})`; `agent.values['oidc.issuer']` → `{issuer, valid: isValidIssuer(issuer)} | 'error'` (invalid logs `sso_issuer_invalid` with `reason:'agent_issuer'`).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint
cd ../.. && node scripts/check-config-wiring.mjs --declared-from docs/roadmap/features/345-authelia-sso/product-spec.md   # every declared key clean or PENDING; no unattributed read
```

---

### Step 31 — test: Loader modes, validity, environment and the secret header

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/oidcConfig.test.ts` — create

**Reviewers**: `xstockstrat-ui` owner — environment (`production`/`staging`) scope correctness

**Codebase Evidence**:
- `vi.mock('@/lib/connectClients')` pattern in `src/lib/insightsBff.test.ts:11`.

**TDD**: red-green required

**Covers**: AC-31 (UI leg), AC-35 (UI leg), AC-46 (loader leg), AC-48 (seeded client IDs reach the reader), AC-54 (loader leg), AC-60 (loader leg), AC-72 (UI leg)

**Instructions**:
1. Mock `configClient.getConfig`/`getSecret`:
   - every vector `mode` row → `loadAuthMode()` result, and `logs` ⇔ one `auth_mode_invalid` (**@AC-72**); absent row → `local`, no log (**@AC-31**);
   - **@AC-46/@AC-60:** a rejection or timeout of each loader → `'error'`;
   - **@AC-54:** `ui` issuer `http://auth.example.test` → `valid:false` + one `sso_issuer_invalid`; empty `client_id` → `valid:false`; invalid `APP_URL` → `valid:false` with only `app_url_invalid`;
   - **@AC-48:** four distinct `mcp_client_id*` values come back verbatim; absent → `''`;
   - every call: `environment: Environment.PRODUCTION` when `APPLICATION_ENV=production`, `userId: ''`, `timeoutMs: 10_000`, and GetConfig with no headers;
   - **@AC-35:** `getSecret` carries exactly `{ 'x-internal-caller': 'ui' }`; `found:false` and `''` → `{found:false}`;
   - `loadAgentIssuer` valid / invalid / `'error'`.
2. C-12: config snapshots are scenario one-offs; say so.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint && pnpm run test:coverage
```

---

### Step 32 — service: openid-client wiring, the Configuration cache and the logout URL builders

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/package.json` — modify
- `pnpm-lock.yaml` — modify
- `services/xstockstrat-ui/src/lib/oidcClient.ts` — create
- `services/xstockstrat-ui/src/lib/ssoLogout.ts` — create

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety, no secret values rendered in UI; Security — JWT claims minimal

**Codebase Evidence**:
- `package.json` has `"jose": "^5.0.0"` (`:46`) and no OIDC client (recon).
- openid-client 6.8.9 API (`discovery`, `ClientSecretBasic`, `enableNonRepudiationChecks`, `allowInsecureRequests`, `randomState`/`randomNonce`/`randomPKCECodeVerifier`/`calculatePKCECodeChallenge`, `buildAuthorizationUrl`, `authorizationCodeGrant`, `buildEndSessionUrl`) verified by the orchestrator (D-29, D-34, D-89); `tokens.claims()` returns the validated ID-token claims and `auth_time` is optional without `maxAge` (D-127).
- Leaf Dockerfiles use the root lockfile (insights.md:2946-2954); `next.config.js` `output: 'standalone'`.

**TDD**: red-green required (paired test: Step 33)

**Covers**: —

**Instructions**:
1. `"openid-client": "6.8.9"` (exact, D-34); `pnpm install` at the root; commit `pnpm-lock.yaml`.
2. **`oidcClient.ts`** (D-34, D-65, D-70, D-87, D-89):
   - `OIDC_SCOPE = 'openid email profile'` (spec-level choice 1; the web client's registration per homelab-edge SSO spec § 4.6 as amended 2026-11-24).
   - `getOidcConfiguration(issuer, clientId, secret)`: one slot keyed `${issuer}\n${clientId}\n${sha256(secret)}`, TTL `OIDC_DISCOVERY_FRESH_S`; `discovery(new URL(issuer), clientId, { id_token_signed_response_alg: OIDC_ID_TOKEN_ALG }, ClientSecretBasic(secret), { timeout: OIDC_TIMEOUT_S, execute: [enableNonRepudiationChecks, ...(issuer.startsWith('http://') ? [allowInsecureRequests] : [])] })` with the imported function references, then `.then(cfg => assertDiscoveredMetadata(cfg, issuer))` (byte-exact `serverMetadata().issuer`, then a same-origin `jwks_uri`); a rejection clears the slot only if it still holds that promise; `__resetOidcConfigurationCache()`.
   - `buildSsoAuthorizationUrl(cfg, {redirectUri, state, nonce, codeChallenge, link?: boolean})`: `scope: OIDC_SCOPE`, `response_mode: 'query'`, `code_challenge_method: 'S256'`; when `link`, also `prompt: 'login'` and `max_age: '1'` (D-119, D-139; `checks.maxAge` is never passed).
   - `exchangeCode(cfg, currentUrl, {pkceCodeVerifier, expectedState, expectedNonce})` wrapping `authorizationCodeGrant(…, { …, idTokenExpected: true })`; returns `{ iss, sub, email?, preferred_username?, auth_time? }` from `tokens.claims()` only.
3. **`ssoLogout.ts`** (D-51, D-65, D-97, D-134): `portalLogoutUrl(issuer, appOrigin)` = `` `${issuer}/logout?rd=${encodeURIComponent(new URL('/auth/login', appOrigin).href)}` ``; `endSessionUrl(cfg, appOrigin, clientId)` via `buildEndSessionUrl` only when `end_session_endpoint` is advertised and same-origin with the issuer, else `null`; `resolveLogoutRedirect({issuer, clientId, appOrigin}, secret: string | null)` under one `raceDeadline(…, AUTH_CONFIG_TIMEOUT_MS)`: `secret === null` (unset or unreadable) → portal URL; else end-session URL if available, else portal; any throw or timeout → portal URL + `serverLog.warn('sso_logout_portal_fallback')`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint && pnpm run build
cd ../.. && grep -n '"openid-client": "6.8.9"' services/xstockstrat-ui/package.json
docker compose build --no-cache xstockstrat-ui   # D-50: the standalone image builds with the ESM-only dependency
docker run --rm -d --name ui-smoke -p 3999:3000 -e JWT_SECRET="$(openssl rand -hex 32)" $(docker compose config --images xstockstrat-ui) && sleep 8 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3999/auth/login; docker rm -f ui-smoke   # boot smoke: any HTTP status, not a crash
```

---

### Step 33 — test: oidcClient through a fetch stub, and the logout URLs

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/oidcClient.test.ts` — create
- `services/xstockstrat-ui/src/lib/ssoLogout.test.ts` — create

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety

**Codebase Evidence**:
- D-34: the production discovery/grant path is exercised through `vi.stubGlobal('fetch', …)` with `https` URLs and the cache reset between cases. `jose ^5` signs test ID tokens.

**TDD**: red-green required

**Covers**: AC-24 (library leg), AC-52, AC-53 (URL builders)

**Instructions**:
1. `oidcClient.test.ts` (stub discovery, JWKS and token endpoints on `https://auth.example.test`; RS256 ID tokens):
   - correct signature → `{iss, sub, email, preferred_username, auth_time}`;
   - **@AC-24:** a foreign key with the same `kid` rejects (non-repudiation active); nonce mismatch rejects; `aud` mismatch rejects; ES256/`none` reject;
   - `link: true` URL carries `prompt=login` and `max_age=1` (D-139); the login URL carries neither; both carry `scope=openid email profile`, `response_mode=query`, `code_challenge_method=S256`;
   - an ID token without `auth_time` still returns claims (the library does not enforce it; D-127);
   - cache: rotated secret → second discovery; same key within 600 s → one; after 601 s → refetch; rejected discovery not cached; a stale rejection does not clear a newer slot; trailing-slash discovery issuer → reject; a configured `/.well-known/…` issuer → reject; cross-origin `jwks_uri` → reject and rediscover next time.
2. `ssoLogout.test.ts`: **@AC-53** no `end_session_endpoint` → `https://auth.example.test/logout?rd=https%3A%2F%2Fxstockstrat-staging.example.test%2Fauth%2Flogin`; **@AC-52** an advertised same-origin endpoint → that URL with `post_logout_redirect_uri` and `client_id`; cross-origin endpoint → portal; `secret === null` → portal with no discovery call (D-134); a throw or timeout → portal + one `sso_logout_portal_fallback` WARN.
3. Stub documents are scenario one-offs here; the e2e stub IdP's live in `e2e/fixtures/` (Step 50).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint && pnpm run test:coverage
```

---

### Step 34 — service: The SSO transaction and link cookies (ssoTxn.ts)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/ssoTxn.ts` — create

**Reviewers**: `xstockstrat-ui` owner — no secret values rendered in UI; Security — JWT claims minimal, auth scope correctness

**Codebase Evidence**:
- `setSessionCookies` base `{ httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/' }` at `auth.ts:53-54`; `verifyAccessToken` accepts any HS256 `JWT_SECRET` JWS (`auth.ts:30`), hence the JWE (R-7).
- **Not found**: no transaction cookie, HKDF helper or link cookie; Node `crypto.hkdfSync` and jose ^5 `CompactEncrypt`/`compactDecrypt` (dir/A256GCM) are available.

**TDD**: red-green required (paired test: Step 35)

**Covers**: —

**Instructions**:
1. Keys: `hkdfSync('sha256', JWT_SECRET, '', 'xstockstrat-ui/sso-txn', 32)` and `…'xstockstrat-ui/sso-link'…` (D-8, D-107).
2. Txn (design § 3 "Txn cookie"; D-8, D-15, D-23, D-75): `type SsoTxn = { purpose:'login'; state; nonce; code_verifier; remember: boolean; redirect: string; exp } | { purpose:'link'; state; nonce; code_verifier; user_id: string; created_at: number; exp }`; `sealSsoTxn(txn)` → JWE with `exp = now + 600` (link: `created_at = now`); `openSsoTxn(jwe)` → payload or `null` (decrypt + `exp`, no network, D-135); `txnCookieName(state)` = `` `sso_txn_${sha256(state).slice(0,16)}` ``; `TXN_COOKIE_OPTS = { httpOnly: true, sameSite: 'lax', secure: isProduction, path: '/api/auth/sso/callback', maxAge: 600 }`; `clearAllTxnCookies(req, res)`.
3. Link cookie (D-107): `SSO_LINK_COOKIE = 'sso_link'`; `sealSsoLink({link_id, iss, sub, label, user_id, exp})` with `exp = txn.exp` (absolute); `openSsoLink(jwe)` → payload or `null`; options `{ httpOnly: true, sameSite: 'lax', secure: isProduction, path: '/', maxAge: max(0, exp - now) }`; `clearSsoLink(res)`.
4. Never an HS256 JWS.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint
```

---

### Step 35 — test: Transaction and link cookies

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/ssoTxn.test.ts` — create

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety

**Codebase Evidence**:
- `e2e/helpers/auth.ts:20` `TEST_JWT_SECRET`, `:29` `signTestJwt`.

**TDD**: red-green required

**Covers**: AC-68 (absolute expiry), AC-76 (an expired link txn does not open)

**Instructions**:
1. Both purposes round-trip; tampered → `null`; **@AC-76** an expired txn → `null` (fake timers, +601 s); an HS256 JWS made with `JWT_SECRET` is not accepted (R-7); the cookie name derives from sha256(state); options carry `secure` in production and the callback path.
2. **@AC-68:** `sso_link` carries the txn's absolute `exp`: at +601 s from the link start `openSsoLink` → `null`; its `maxAge` shrinks with elapsed time.
3. C-12: sign with `TEST_JWT_SECRET` from `e2e/helpers/auth.ts`; no new secret literal.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint && pnpm run test:coverage
grep -n "helpers/auth" src/lib/ssoTxn.test.ts
```

---

### Step 36 — service: Typed auth metrics, error codes, logout verify and the logout rewrite

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/bffMetrics.ts` — modify
- `services/xstockstrat-ui/src/lib/ssoErrors.ts` — create
- `services/xstockstrat-ui/src/lib/auth.ts` — modify
- `services/xstockstrat-ui/src/app/api/auth/logout/route.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety, no secret values rendered in UI; Security — auth scope correctness

**Codebase Evidence**:
- `bffMetrics.ts`: `AuthEvent` `:9-19`, `JwtRejectReason` `:20`, `recordAuthEvent(event, reason?: JwtRejectReason)` `:47-49`.
- Every caller (`grep -rn "recordAuthEvent(" src`): `auth.ts:27,33`, `identity.ts:22,32,35`, `login/route.ts:11,27,33,37`, `refresh/route.ts:9`, `logout/route.ts:11` (bare `'logout'`, which fails the typed map) and `bffAllowlist.test.ts:48-49`. Only `logout/route.ts:11` breaks, and it is rewritten here (§C satisfied in-step).
- `auth.ts`: `verifyAccessToken` `:23-36` (catches `errors.JWTExpired`); `REMEMBER_ME_MAX_AGE_SECONDS` `:17`; `clearSessionCookies` `:76-80`.
- `logout/route.ts:6-17` revokes any cookie token, records `'logout'`, clears cookies, returns `{ok:true}`.

**TDD**: red-green required (paired test: Step 37)

**Covers**: —

**Instructions**:
1. **`bffMetrics.ts`** (D-72 remainder, D-113): `AuthEvent` gains `sso_login_ok | sso_login_failed | sso_login_error | sso_link_failed | login_disabled`; `LOGOUT_REASONS = ['verified','unverified','expired_too_old','cross_origin'] as const`; per-event reason map `{ jwt_rejected: JwtRejectReason; logout: LogoutReason; sso_login_failed: SsoErrorCode; sso_link_failed: LinkErrorCode }` with a generic rest-tuple `recordAuthEvent` (type-only import from `ssoErrors`).
2. **`ssoErrors.ts`** (design § 3 tables; D-82, D-83, D-113, D-132, D-137): `SSO_ERROR_CODES` (`failed`, `not_configured`, `not_linked`, `inactive`, `no_access`) and `LINK_ERROR_CODES` (`failed`, `not_configured`, `no_access`, `invalid_credentials`, `inactive`, `already_linked_other`, `already_linked_self`) with their exact messages (the `not_linked` message has a `both` and an `oidc` variant); `resolveRefusalCode(detail)` (`not linked`→`not_linked`, `account inactive`→`inactive`, else `failed`); `linkRefusalCode(detail)` (`invalid credentials`→`invalid_credentials`, `account inactive`→`inactive`, `account already linked`→`already_linked_other`, `already linked to this issuer`→`already_linked_self`, `link disabled`→`failed`, else `null`), both keyed on `SSO_REFUSALS`; `ssoErrorRedirect(target: {dest:'login'; code: SsoErrorCode} | {dest:'link'; code: LinkErrorCode}, appOrigin: string | null, {fault?, clearTxnCookie?})` → `new NextResponse(null, {status: 303, headers: {location}})` to `/auth/login?error=` or `/accounts/sso?error=` (relative when `appOrigin` is null), clearing the named txn cookie with `TXN_COOKIE_OPTS` + `maxAge: 0`; it holds the only literal `sso_login_*`/`sso_link_failed` records (spec-level choice 6).
3. **`auth.ts`** (D-61): extract `verifySessionJwt(token)` (`{ok:true; payload} | {ok:false; kind: JwtRejectReason; payload?}`, records nothing); `verifyAccessToken` keeps its behaviour on top of it; add `verifyAccessTokenForLogout(token): Promise<LogoutReason>` (`verified` for a valid signature or a `JWTExpired` whose `exp` is within `REMEMBER_ME_MAX_AGE_SECONDS`; `expired_too_old` beyond; else `unverified`; never records `jwt_rejected`).
4. **`logout/route.ts`** (design § 3 logout row; D-52, D-60, D-61, D-77, D-80, D-134): keep `withBffMetrics('auth', '/api/auth/logout', …)`. Order:
   1. `!isSameOrigin(req, 'if_present')` → `recordAuthEvent('logout','cross_origin')`, `serverLog.warn('logout_origin_mismatch', {origin_host})`, 403 `{error:'origin mismatch'}`, no Set-Cookie, no config read.
   2. `reason = await verifyAccessTokenForLogout(cookie)` → `recordAuthEvent('logout', reason)`.
   3. In parallel, both awaited: `reason === 'verified' ? revokeToken(token) : skip` ‖ the redirect lookup: `mode = await loadAuthMode()`; `local` → none; `'error'` → none + `serverLog.warn('sso_logout_mode_unknown')`; `both`/`oidc` → `cfg = await loadOidcConfig()`; `'error'` or `!cfg.valid` → none; else `secret = await loadOidcClientSecret()` (`'error'` or `found:false` → `null`) and `resolveLogoutRedirect(...)`.
   4. `clearSessionCookies(res)` and `clearSsoLink(res)`.
   5. `{ok:true, redirect}` only when verified and a redirect was resolved; else `{ok:true}`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint && pnpm run test:unit
grep -rn "recordAuthEvent('sso_" src | grep -v "test\|ssoErrors.ts"   # only sso_login_ok (Step 40) outside ssoErrors.ts
```

---

### Step 37 — test: Metric typing, error redirects, logout verify and the logout route

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/__tests__/bffAllowlist.test.ts` — modify
- `services/xstockstrat-ui/src/lib/ssoErrors.test.ts` — create
- `services/xstockstrat-ui/src/lib/auth.test.ts` — modify
- `services/xstockstrat-ui/src/app/api/auth/logout/route.test.ts` — create

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety

**Codebase Evidence**:
- `bffAllowlist.test.ts` drives `recordAuthEvent('login_ok')`, `('jwt_rejected','expired')` at `:48-49`.
- Route-test precedent `src/app/config-ui/api/audit/route.test.ts`; `src/lib/auth.test.ts` exists.

**TDD**: red-green required

**Covers**: AC-52, AC-53, AC-56, AC-57, AC-58, AC-62, AC-64, AC-68 (logout clears `sso_link`)

**Instructions**:
1. `bffAllowlist.test.ts` (D-72, D-83, D-93): `@ts-expect-error` cases (a reason on `login_ok`; a missing reason on `logout`; a `JwtRejectReason` on `logout`; a `LinkErrorCode` on `sso_login_failed`); `drive()` adds `('logout','cross_origin')`, `('sso_login_failed','no_access')`, `('sso_link_failed','no_access')`, `('sso_login_ok')`; `SSO_ERROR_CODES`, `LINK_ERROR_CODES`, `LOGOUT_REASONS` equal their literal lists; keys stay `['event','reason']`. **RED proof for D-93:** remove one directive, `pnpm run typecheck` fails with TS2578, restore it; record the output.
2. `ssoErrors.test.ts`: login and link destinations; null `appOrigin` → relative `Location`; the txn cookie cleared with Max-Age=0 on `/api/auth/sso/callback`; `fault` → `sso_login_error`; link → `sso_link_failed{code}` and never `sso_login_*`; both refusal mappers per detail; every message string verbatim.
3. `auth.test.ts`: `verifyAccessTokenForLogout` valid/expired 1 day/expired 15 days/wrong key/no secret; `jwt_rejected` never recorded on these paths.
4. `logout/route.test.ts` (mock `revokeToken`, the loaders, `resolveLogoutRedirect`): **@AC-57** sibling Origin in `local`/`both`/`oidc` → 403, no revoke, no Set-Cookie, no config read, one WARN; revoke iff verified (D-64); **@AC-53/@AC-52** `both`/`oidc` + valid → `{ok:true, redirect}`; **@AC-56** `valid:false` → `{ok:true}`, no discovery; **@AC-62** `'error'` → `{ok:true}` + WARN, revoke still done; **@AC-64** an expired-but-signed access cookie → 200 `{ok:true…}`, cookies cleared; **@AC-58** invalid `APP_URL` + sibling Origin → passes; secret `found:false` → portal redirect (D-134); `local` → `{ok:true}`; **@AC-68** `sso_link` cleared on every non-403 path.
5. C-12: sign session JWTs with `signTestJwt`/`TEST_JWT_SECRET` from `e2e/helpers/auth.ts`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint && pnpm run test:coverage
grep -n "helpers/auth" src/app/api/auth/logout/route.test.ts src/lib/auth.test.ts
```

---

### Step 38 — service: Revoke deadline and the oidc password 403

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/identity.ts` — modify
- `services/xstockstrat-ui/src/app/api/auth/login/route.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety; Security — auth scope correctness

**Codebase Evidence**:
- `identity.ts:42-44` `revokeToken` calls `identityClient.revokeToken({ token })` with no timeout; `refreshSession` passes `{ timeoutMs: REFRESH_TIMEOUT_MS }` at `:20`.
- `login/route.ts:29-44`: `Unauthenticated` → 401 "Invalid credentials"; everything else → 503.

**TDD**: red-green required (paired test: Step 39)

**Covers**: —

**Instructions**:
1. `identity.ts`: `revokeToken` passes `{ timeoutMs: REFRESH_TIMEOUT_MS }` (D-61).
2. `login/route.ts` (D-106): `Code.PermissionDenied` → `recordAuthEvent('login_disabled')` + 403 `{ error: 'login_disabled' }`. `Unauthenticated` keeps 401 "Invalid credentials" (`@AC-33 @feature-294` PRESERVE).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint && pnpm run test:unit
grep -n "REFRESH_TIMEOUT_MS" src/lib/identity.ts && grep -n "login_disabled" src/app/api/auth/login/route.ts
```

---

### Step 39 — test: Revoke deadline and the login 403

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/identity.test.ts` — modify
- `services/xstockstrat-ui/src/app/api/auth/login/route.test.ts` — create

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety

**Codebase Evidence**:
- `src/lib/identity.ts` is excluded from coverage (`vitest.config.ts:32`); the `src/lib/**` thresholds still gate.

**TDD**: red-green required

**Covers**: AC-16 (UI password POST in `oidc`)

**Instructions**:
1. `identity.test.ts`: `revokeToken` passes `timeoutMs: 10_000`.
2. `login/route.test.ts`: **@AC-16** `authenticateUser` rejects `PermissionDenied` → 403 `{error:'login_disabled'}` + `login_disabled`; `Unauthenticated` → 401 "Invalid credentials"; other → 503.
3. C-12: scenario one-offs.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint && pnpm run test:coverage
```

---

### Step 40 — service: SSO start and callback routes and the middleware sets

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/api/auth/sso/start/route.ts` — create
- `services/xstockstrat-ui/src/app/api/auth/sso/callback/route.ts` — create
- `services/xstockstrat-ui/src/middleware.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety, no secret values rendered in UI; Security — JWT claims minimal, auth scope correctness

**Codebase Evidence**:
- `middleware.ts`: matcher `:22` excludes `api/auth/login|api/auth/refresh|auth/login|auth/oauth-login|\.well-known|api/oauth` but not `api/auth/sso/*` or `api/auth/logout`; `PUBLIC_HEALTH_PATHS` `:27-36` checked first at `:39`; refresh branches `:45-112`.
- `identityClient` at `connectClients.ts:105`; `HEADER_TRACE_ID` (`headers.ts:7`) and `generateTraceId` (`auth.ts:104`); idiom `req.headers.get(HEADER_TRACE_ID) ?? generateTraceId()` at `middleware.ts:43`.
- `setSessionCookies(res, access, refresh, opts?)` `auth.ts:47-66`; `REMEMBER_ME_MAX_AGE_SECONDS` `:17`.

**TDD**: red-green required (paired test: Step 41)

**Covers**: —

**Instructions**:
1. **`start/route.ts`** — `POST` only (GET → 405; D-46, D-54), `withBffMetrics('auth', '/api/auth/sso/start', …)`. Order (design § 3 row; D-134):
   1. `loadAuthMode()`: `local` → 404; `'error'` → login `failed` (fault).
   2. `loadOidcConfig()`: `'error'` → login `failed` (fault); `!valid` → login `not_configured` (before the Origin check, AC-54/58).
   3. `!isSameOrigin(req, 'required')` → login `failed`.
   4. `loadOidcClientSecret()`: `found:false` → `not_configured`; `'error'` → `failed` (fault).
   5. Form fields `remember` (`'1'` → true) and `redirect` (`safeRedirect`).
   6. `randomState`, `randomNonce`, `randomPKCECodeVerifier`; `getOidcConfiguration` (throw → `failed`, fault).
   7. 303 to `buildSsoAuthorizationUrl(cfg, {redirectUri: new URL('/api/auth/sso/callback', appOrigin).href, …})` with `Set-Cookie` `sealSsoTxn({purpose:'login', …})` under `txnCookieName(state)`.
2. **`callback/route.ts`** — `GET`. One `traceId` from the inbound header or generated (D-30, D-114). Order (design § 3 "Callback order"; D-58, D-113, D-125, D-132, D-135); every `Location` on `appOrigin`:
   1. `loadAuthMode()`: `local` → 404 (no redirect); `'error'` → login `failed` (fault).
   2. `loadOidcConfig()`: `'error'` → login `failed`; `!valid` → login `not_configured`.
   3. IdP `error` param: if `state`, clear `txnCookieName(state)`; if that cookie opens through `openSsoTxn` with `purpose:'link'` → link dest (`access_denied` → `no_access`, else `failed`); otherwise login dest (same mapping).
   4. Missing/undecryptable/expired txn → login `failed`. From here `txn.purpose` picks the destination.
   5. `loadOidcClientSecret()`: `found:false` → `not_configured`; `'error'` → `failed`.
   6. `getOidcConfiguration` + `exchangeCode(...)`; any throw → `failed`, logging only `serverLog.warn('sso_callback_failed', {error_class})` (D-75).
   7. `purpose:'login'`: `identityClient.resolveExternalIdentity({issuer: claims.iss, subject: claims.sub}, {timeoutMs: AUTH_CONFIG_TIMEOUT_MS, headers: {[HEADER_TRACE_ID]: traceId}})` — `FailedPrecondition` → `resolveRefusalCode(detail)`, else `failed`; then `issueSessionForUser({userId}, same opts)` — `FailedPrecondition` → `inactive`, else `failed`; no cookies on any failure. Success: `setSessionCookies(res, access, refresh, txn.remember ? {maxAge: REMEMBER_ME_MAX_AGE_SECONDS} : undefined)`, `clearAllTxnCookies`, `recordAuthEvent('sso_login_ok')`, 303 to `new URL(safeRedirect(txn.redirect), appOrigin)`.
   8. `purpose:'link'`: step 1's mode must be `both`, else link `failed` (D-125). `auth_time` check (D-111/D-127): `typeof c.auth_time === 'number' && Number.isFinite(c.auth_time) && c.auth_time >= txn.created_at - OIDC_CLOCK_SKEW_S`, else `serverLog.warn('sso_link_refused', {reason: 'auth_time_missing'|'auth_time_stale'})` + link `failed`. `label = c.email ?? c.preferred_username ?? 'your single sign-on account'`. Seal `sso_link` `{link_id: randomUUID(), iss, sub, label, user_id: txn.user_id, exp: txn.exp}`, `clearAllTxnCookies`, 303 to `/accounts/sso`. No identity call.
   - Never log the code, tokens, the token response, email or `sub`.
3. **`middleware.ts`** (D-40, D-62): export `SSO_PUBLIC_PATHS = new Set(['/api/auth/sso/start', '/api/auth/sso/callback'])`, `COOKIE_GATED_PATHS = new Set(['/api/auth/logout'])` and `PUBLIC_HEALTH_PATHS`; at the top: `SSO_PUBLIC_PATHS.has(path)` → `next()`; `COOKIE_GATED_PATHS.has(path) && (access_token || refresh_token cookie)` → `next()`. `/accounts/api/sso*` are **not** exempt. Matcher unchanged.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run build   # Next tolerates the extra middleware exports; a build error moves them to src/lib/authPaths.ts (Deviation Log)
pnpm run typecheck && pnpm run lint && pnpm run test:unit
grep -n "export async function GET" src/app/api/auth/sso/start/route.ts || echo "start is POST-only"
grep -n "HEADER_TRACE_ID" src/app/api/auth/sso/callback/route.ts
```

---

### Step 41 — test: Start and callback routes and the middleware exemptions

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/api/auth/sso/start/route.test.ts` — create
- `services/xstockstrat-ui/src/app/api/auth/sso/callback/route.test.ts` — create
- `services/xstockstrat-ui/src/middleware.test.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety

**Codebase Evidence**:
- `src/middleware.test.ts` exists (its `@AC-6` expired-access case at `:250`).
- User-id fixtures: `e2e/fixtures/users.ts` (C-12).

**TDD**: red-green required

**Covers**: AC-1, AC-2, AC-3, AC-6 (UI leg), AC-7, AC-24, AC-29, AC-47, AC-51, AC-54, AC-58, AC-59, AC-60, AC-65 (callback link leg), AC-74, AC-76, AC-77 (row 1)

**Instructions**:
1. **`start/route.test.ts`** (`fetch` mocked to prove no IdP request): **@AC-47** `local` → 404; **@AC-60** mode `'error'` → `?error=failed`; **@AC-54** `valid:false` → `not_configured` before the Origin check, `fetch` never called; **@AC-58** invalid `APP_URL` → relative `Location: /auth/login?error=not_configured` whatever the Origin; **@AC-59** sibling or missing Origin → `failed`, GET → 405; secret unset → `not_configured`; happy path → 303 to the authorize URL (`scope`, `response_mode=query`, S256, `redirect_uri=http://localhost:3000/api/auth/sso/callback`, no `prompt`) + a login txn with `remember=true` for `remember=1`.
2. **`callback/route.test.ts`** (mock `exchangeCode` and the identity client):
   - **@AC-47** `local` → 404, Resolve not called; **@AC-60** `'error'` → `failed`;
   - **@AC-51** `error=access_denied` with a login txn → `/auth/login?error=no_access`, txn cleared; **@AC-76** with a link txn → `/accounts/sso?error=no_access`, `sso_link_failed{no_access}`, no `sso_login_failed`; `server_error` → link `failed`; an expired link txn → login page;
   - **@AC-24** state `s-999` (no txn), nonce and `aud` mismatch (`exchangeCode` rejects) → `failed`, Resolve never called, no session cookie;
   - **@AC-1** Resolve OK → IssueSession → session cookies, 303 to `/trader`; **@AC-2** the Resolve request has exactly `{issuer, subject}` (no email);
   - **@AC-3** `not linked` → `not_linked` in `both` and in `oidc` (the page renders the per-mode message, Step 44); **@AC-6** the same refusal under `APPLICATION_ENV=production`;
   - **@AC-7** `account inactive` → `inactive`; IssueSession `FailedPrecondition` → `inactive`; no cookies;
   - **@AC-29** remember → `Max-Age=1209600` + `remember_me=1`; without → session cookies; every `sso_txn_*` cleared on success;
   - one trace per login: inbound `x-trace-id: t-in` reaches Resolve and IssueSession headers; without it, both get the same generated id;
   - **@AC-65** link txn + fresh `auth_time` → `sso_link` sealed with `label` = email, then `preferred_username`, then the default, 303 `/accounts/sso`, no identity call; mode `oidc` on a link txn → link `failed`;
   - **@AC-74** link txn with `auth_time` absent, or `created_at − 31 s` → `/accounts/sso?error=failed`, WARN `sso_link_refused`, no `sso_link`; `created_at − 30 s` accepted;
   - sentinels (`CODE-SENTINEL`, `IDTOKEN-SENTINEL`, `sentinel@example.test`) never appear in any log argument (D-75).
3. **`middleware.test.ts`** (D-40, D-59, D-62): every path in `SSO_PUBLIC_PATHS ∪ COOKIE_GATED_PATHS ∪ PUBLIC_HEALTH_PATHS` has a `route.ts` (`fs.existsSync`); `/api/auth/sso/startx` and `/api/auth/logoutx` redirect; a near-expiry token with a failing refresh on the callback passes through; logout without a cookie → today's redirect, with a cookie → passes; `/accounts/api/sso` is not exempt: **@AC-77** row 1, `GET /accounts/api/sso` with no session cookie → redirect to `/auth/login` (with `redirect=/accounts/api/sso`), the handler never runs.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint && pnpm run test:coverage
grep -n "fixtures/users\|helpers/auth" src/app/api/auth/sso/callback/route.test.ts
```

---

### Step 42 — service: Link SSO routes (/accounts/api/sso, /link, /confirm)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/accounts/api/sso/route.ts` — create
- `services/xstockstrat-ui/src/app/accounts/api/sso/link/route.ts` — create
- `services/xstockstrat-ui/src/app/accounts/api/sso/confirm/route.ts` — create

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety, environment scope correctness, no secret values rendered in UI; Security — auth scope correctness

**Codebase Evidence**:
- Session-gated route precedent `src/app/accounts/api/authorized-apps/route.ts:14-18` (`getSessionFromRequest` → 401 JSON; `restBackendHeaders(req, claims.user_id, claims.roles)`; `withBffMetrics`).
- `restBackendHeaders` `src/lib/restBackendHeaders.ts:9-15` (the platform header trio, D-114).
- `apiFetch` retries a 401 once after a refresh (`authRedirect.ts:67-73`), so a refusal is never 401; `connectCodeToHttp` maps `FailedPrecondition` → 400 (`connectClients.ts:134-139`).
- `JwtClaims.email` (`auth.ts:7`) is the session email.

**TDD**: red-green required (paired test: Step 43)

**Covers**: —

**Instructions**:
All three: `withBffMetrics('accounts', …)`, `getSessionFromRequest(req)` first (none → **401** `{error:'unauthorized'}`), identity calls with `{ headers: restBackendHeaders(req, claims.user_id, claims.roles), timeoutMs: AUTH_CONFIG_TIMEOUT_MS }`. Design § 3 "Link routes" table, D-107, D-124, D-134:
1. **`GET /accounts/api/sso`**: `mode = loadAuthMode()`, `cfg = loadOidcConfig()` (fault → treat as unreadable for `linked`), `getExternalIdentityLinks({userId})` (fail → **503** `{error:'failed'}`). `linked = cfg !== 'error' && isValidIssuer(cfg.issuer) ? issuers.includes(cfg.issuer) : issuers.length > 0` (D-134). `canLink = mode === 'both'`. `pending = canLink && sso_link opens && its user_id === claims.user_id ? {linkId, label, accountEmail: claims.email} : null`. Mode `'error'` → 200 `{mode:'error', linked, canLink:false, pending:null}`. The body never carries `iss` or `sub`.
2. **`POST /accounts/api/sso/link`** (no body): mode not `both` → **404** `{error:'not_found'}` (`'error'` → **503** `{error:'failed'}`); `cfg` `'error'` → 503; `!cfg.valid` → **400** `{error:'not_configured'}`; `!isSameOrigin(req,'required')` → **403** `{error:'failed'}`; secret `found:false` → **400** `not_configured`; secret `'error'` or a discovery fault → **503** `failed`; else **200** `{url: buildSsoAuthorizationUrl(…, {link: true})}` with the link txn cookie `{purpose:'link', user_id: claims.user_id, created_at: now, …}`.
3. **`POST /accounts/api/sso/confirm`** `{linkId, password}`: mode gate as `/link`; Origin → **403** `failed`; `sso_link` missing, unopenable, expired, `user_id !== claims.user_id` or `link_id !== linkId` → **400** `failed` + clear the cookie; empty password → **400** `invalid_credentials` (identity not called); `linkExternalIdentity({userId: claims.user_id, issuer: link.iss, subject: link.sub, password})`: OK → 200 `{ok:true}` + clear; `FailedPrecondition` → `linkRefusalCode(detail)` → **400** `{error: code}` (`invalid_credentials` keeps the cookie, the others clear it; `link disabled` → `failed`); `Unavailable`/`DeadlineExceeded`/other → **503** `failed`, cookie kept. Every refusal records `sso_link_failed{reason}`. Never log the password.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint && pnpm run build
grep -n "restBackendHeaders" src/app/accounts/api/sso/route.ts src/app/accounts/api/sso/link/route.ts src/app/accounts/api/sso/confirm/route.ts
```

---

### Step 43 — test: Link SSO route statuses

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/accounts/api/sso/route.test.ts` — create
- `services/xstockstrat-ui/src/app/accounts/api/sso/link/route.test.ts` — create
- `services/xstockstrat-ui/src/app/accounts/api/sso/confirm/route.test.ts` — create

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety

**Codebase Evidence**:
- Route-test precedent `src/app/config-ui/api/audit/route.test.ts`; session JWTs via `e2e/helpers/auth.ts` `signTestJwt` (`:29`).

**TDD**: red-green required

**Covers**: AC-4, AC-65 (routes), AC-66, AC-67, AC-68, AC-69, AC-77 (rows 2–8)

**Instructions**:
1. **@AC-77** rows 2–8, one case per row, at the handler (row 1 is Step 41's middleware case, spec-level choice 5); plus the FR-16.6 handler-level case: a stale session token (`getSessionFromRequest` → null) → 401 on each of the three routes; GetLinks fails → 503 `failed`; config unreadable → 200 `mode:'error'`, `canLink:false`; `/link` with a sibling Origin → 403 `failed`; `client_id ""` → 400 `not_configured`; secret unset + sibling Origin → 403 (Origin before secret); secret unset same-origin → 400 `not_configured`; `/confirm` with config unreadable → 503 `failed`.
2. GET: `linked` per D-134 (valid issuer in `issuers`; invalid issuer → any link; ui fault → any link); `canLink` true in `both` even when linked (AC-67); `pending` only for a matching `user_id`; **@AC-69** `local`/`oidc` → `canLink:false`, and `/link` → 404.
3. `/link` happy path: 200 `{url}` with `prompt=login&max_age=1` (D-139), the link txn's `user_id` is the session's, never a body value; identity calls carry the session `x-user-id` (D-114).
4. `/confirm`: **@AC-65** OK → 200 and the cookie cleared; **@AC-66** `invalid credentials` → 400 `invalid_credentials`, cookie kept; **@AC-4** `account already linked` → 400 `already_linked_other`; **@AC-67** `already linked to this issuer` → 400 `already_linked_self`; `link disabled` → 400 `failed`; **@AC-68** a `sso_link` for another `user_id`, or expired → 400 `failed`, identity not called; empty password → 400, identity not called; `Unavailable` → 503, cookie kept; no response is ever 401 after the session check.
5. C-12: user ids from `e2e/fixtures/users.ts`; other literals are scenario one-offs.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint && pnpm run test:coverage
```

---

### Step 44 — service: Login page per mode and the SSO sign-in form

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/auth/login/page.tsx` — modify
- `services/xstockstrat-ui/src/app/auth/login/LoginForm.tsx` — create
- `services/xstockstrat-ui/src/components/auth/SsoSignInForm.tsx` — create

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness, no secret values rendered in UI

**Codebase Evidence**:
- `login/page.tsx:1-53`: `'use client'`, `LoginForm` (`CredentialsForm submitLabel="Sign in" … showRememberMe`) in `AuthCardShell`, `Suspense` with `LoginSkeleton`.
- `CardNotice` at `src/components/shared/CardNotice.tsx:5`; `Checkbox` at `src/components/ui/checkbox.tsx`.
- Ledger `fails.md:4251-4259`: a server component may read config but must not read the signed-in user.

**TDD**: red-green required (RED/GREEN via the Step 53 e2e; the UI has no jsdom unit layer, `vitest.config.ts:19`)

**Covers**: —

**Instructions**:
1. Move `LoginForm` and `LoginSkeleton` verbatim into `LoginForm.tsx` (`'use client'`); `CredentialsForm` is untouched (D-54).
2. **`page.tsx`** becomes a server component reading **only** `loadAuthMode()` (design § 3 row; D-106): `local` or `'error'` → `LoginForm`; `both` → `SsoSignInForm` + `LoginForm`; `oidc` → `SsoSignInForm` only. Rendered whatever the web config's validity. Next 15 async `searchParams`: `error` from `SSO_ERROR_CODES` shown in a `CardNotice` (`not_linked` uses the mode's variant; an unknown code shows nothing); `redirect` passed to both forms.
3. **`SsoSignInForm.tsx`** (D-54): native `<form method="post" action="/api/auth/sso/start">`, hidden `redirect`, uncontrolled `Checkbox` `id="ssoRememberMe" name="remember" value="1"` labelled "Keep me signed in for 14 days (SSO)", `Button` "Sign in with SSO"; design tokens only (C-17); accessible names distinct from `CredentialsForm`.
4. At execute, record in `context.md` that a future `Referrer-Policy: no-referrer` would break `/start`'s Origin check (D-54).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint && pnpm run build
grep -n "'use client'" src/app/auth/login/page.tsx || echo "page is a server component"
```

---

### Step 45 — service: /accounts/sso page and its nav registrations

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/accounts/sso/page.tsx` — create
- `services/xstockstrat-ui/src/components/shared/navGroups.tsx` — modify
- `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness, no secret values rendered in UI

**Codebase Evidence**:
- `navGroups.tsx:104` `{ label: 'Authorized apps', href: '/accounts/authorized-apps' }`; accounts subnav `PlatformHeader.tsx:93-98` (`'Authorized Apps'` at `:96`).
- `accounts/layout.tsx:16-33` wraps every accounts page in `PlatformHeader` + providers.
- Primitives: `QueryStateMessages`, `CardNotice`, `FormDialog` (`src/components/shared/*.tsx`; `FormDialog` props `open, onOpenChange, trigger?, title, description?, children` at `:18-32`); `apiFetch(input, init)` at `authRedirect.ts:67`.

**TDD**: red-green required (RED/GREEN via the Step 53 e2e and `nav-reachability.spec.ts`)

**Covers**: —

**Instructions**:
1. **`page.tsx`** (`'use client'`; D-107, D-117, D-124): `apiFetch('/accounts/api/sso')` on mount; render "Single sign-on" with linked / not-linked status; `mode:'error'` or a fetch error through `QueryStateMessages`; `?error=` via `CardNotice` from `LINK_ERROR_CODES`. When `canLink`: a "Link SSO" button posting `apiFetch('/accounts/api/sso/link', {method:'POST'})` then `location.assign(url)`. When `pending`: a `FormDialog` "You are linking {label} to {accountEmail}." with a password field (held in component state across one retry) posting `apiFetch('/accounts/api/sso/confirm', {method:'POST', redirect:'manual', body})`; an `opaqueredirect` → `location.assign('/auth/login')`; a 400 code shows its `LINK_ERROR_CODES` message; 200 → reload status. No `iss`/`sub` rendered.
2. **`navGroups.tsx`**: `{ label: 'Single sign-on', href: '/accounts/sso' }` next to `:104`.
3. **`PlatformHeader.tsx`**: `{ label: 'Single Sign-On', href: '/accounts/sso', match: 'exact' }` in the accounts subnav after `:96` (C-10a).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint && pnpm run build
grep -n "/accounts/sso" src/components/shared/navGroups.tsx src/components/shared/PlatformHeader.tsx   # 2
```

---

### Step 46 — service: Sign-out button in the shared header

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/shared/SignOutButton.tsx` — create
- `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness

**Codebase Evidence**:
- `PlatformHeader.tsx:248-251`: `<div className="flex items-center gap-2 ml-auto">{actions}<AlertStream /><CopilotToggle />`, then the `sm:hidden` sidebar block.
- `Button` in `src/components/ui/button.tsx` (icon size convention, D-63).
- **Not found**: no logout caller in `src/` (recon).

**TDD**: red-green required (RED/GREEN via the Step 53 e2e)

**Covers**: —

**Instructions**:
1. **`SignOutButton.tsx`** (`'use client'`; D-53, D-60, D-63): `Button variant="ghost" size="icon" className="size-11 sm:size-8" aria-label="Sign out"` with a sign-out icon from the icon set in use; `pending` state; on click (try/catch): `res = await fetch('/api/auth/logout', {method:'POST', redirect:'manual'})`; a JSON `res.ok` with `body.redirect` → `location.assign(body.redirect)`; every other outcome → `location.assign('/auth/login')`; `pending` never sticks.
2. **`PlatformHeader.tsx`**: `<SignOutButton />` right after `<CopilotToggle />`, in every mode.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint && pnpm run build
```

---

### Step 47 — service: Authorized-apps split and the issuer pointer card

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/accounts/authorized-apps/page.tsx` — modify
- `services/xstockstrat-ui/src/app/accounts/authorized-apps/AuthorizedAppsList.tsx` — create
- `services/xstockstrat-ui/src/app/accounts/authorized-apps/SsoAppsCard.tsx` — create
- `services/xstockstrat-ui/src/components/accounts/ConnectorUrlField.tsx` — create

**Reviewers**: `xstockstrat-ui` owner — no secret values rendered in UI, environment scope correctness

**Codebase Evidence**:
- `authorized-apps/page.tsx` (270 lines): `'use client'` (`:1`), `useAgentUrl()` (`:68`), `apiFetch('/accounts/api/authorized-apps')` (`:80`, `:113`), `columns` memo (`:127`), `copyAgentUrl` (`:160`), connector field with `aria-label="MCP connector URL"` (`:208-228`), list `Card` (`:245-267`).
- `accounts/layout.tsx:19` reads `AGENT_PUBLIC_URL` server-side into `AgentUrlProvider`; untouched.

**TDD**: red-green required (RED/GREEN via the Step 53 e2e and the existing `auth.spec.ts` list cases)

**Covers**: —

**Instructions**:
1. Extract `ConnectorUrlField` (`'use client'`; `useAgentUrl` + copy state) from `:205-225` (D-55 remainder, D-131).
2. Move the page body **verbatim** into `AuthorizedAppsList.tsx` (`'use client'`), including the `columns` memo and focus target, using `ConnectorUrlField` (D-116; `@feature-350 @AC-4/6/9` PRESERVE in `local`/`both`).
3. **`page.tsx`** becomes a server component: `loadAuthMode()`; `oidc` → `loadOidcConfig()` → `SsoAppsCard`; `local`/`both`/`'error'` → `AuthorizedAppsList`. A `loadOidcConfig` fault in `oidc` renders `SsoAppsCard` with no issuer link and no client-ID rows.
4. **`SsoAppsCard.tsx`** (`'use client'`; props `{ issuerUrl: string | null; clientIds: {claude, claudeReadonly, claudeCode, claudeCodeReadonly} }`; `Card` primitives, C-17): explains that connected apps are managed at the issuer; links to `issuerUrl` only when valid; `ConnectorUrlField`; one row per non-empty client ID labelled for Claude.ai (full / read-only) and Claude Code (full / read-only), with the instruction to paste them into the connector's OAuth settings; no grants, no revoke (AC-34, AC-48).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint && pnpm run build
grep -n "'use client'" src/app/accounts/authorized-apps/page.tsx || echo "page is a server component"
```

---

### Step 48 — service: Mode-aware discovery documents

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/api/oauth/protected-resource/route.ts` — modify
- `services/xstockstrat-ui/src/app/api/oauth/authorization-server/route.ts` — modify
- `services/xstockstrat-ui/src/lib/mcpScopes.ts` — create

**Reviewers**: `xstockstrat-ui` owner — no secret values rendered in UI, environment scope correctness

**Codebase Evidence**:
- `protected-resource/route.ts:8-13` returns `{resource: agent, authorization_servers: [agent]}`; `authorization-server/route.ts:8-19` returns the agent AS document; both `dynamic = 'force-dynamic'`; rewrites at `next.config.js:57-62`.
- A Next route file may not export extra names, so the scope list lives in `src/lib/`.

**TDD**: red-green required (paired test: Step 49)

**Covers**: —

**Instructions**:
1. `mcpScopes.ts`: `export const MCP_SCOPES_SUPPORTED = ['xstockstrat.read','xstockstrat.write','xstockstrat.admin','xstockstrat.trade'] as const;` (mirrors agent `scopes.MCP_SCOPES_SUPPORTED`).
2. **PRM** (design § 3 rows; D-106, D-133, D-136): `loadAuthMode()`: `local`, `both` or `'error'` → today's document byte-identical; `oidc` → `loadAgentIssuer()`: valid → `{resource: AGENT_PUBLIC_URL, authorization_servers: [issuer], scopes_supported: [...MCP_SCOPES_SUPPORTED]}`; invalid, empty or `'error'` → `new NextResponse(null, {status: 503, headers: {'Cache-Control': 'no-store'}})`.
3. **AS**: `local`, `both` or `'error'` → today's; `oidc` → 404.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint && pnpm run build
```

---

### Step 49 — test: Discovery routes and the whole-PRM contract

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/api/oauth/protected-resource/route.test.ts` — create
- `services/xstockstrat-ui/src/app/api/oauth/authorization-server/route.test.ts` — create
- `services/xstockstrat-ui/src/lib/mcpScopes.test.ts` — create

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety

**Codebase Evidence**:
- The agent side of the PRM contract is pinned against the same vector `prm.expected` in Step 24 (D-130e).

**TDD**: red-green required

**Covers**: AC-11 (UI copy), AC-46 (discovery leg), AC-49, AC-55 (UI PRM), AC-78

**Instructions**:
1. `protected-resource/route.test.ts` (mock the loaders; `AGENT_PUBLIC_URL = prm.agent_public_url`): `local`/`both` → today's object; **@AC-49/@AC-11** `oidc` + valid → deep-equals `prm.expected`; **@AC-55** `oidc` + invalid issuer → 503 `no-store`; **@AC-78** `oidc` + `loadAgentIssuer` `'error'` → 503 `no-store`; **@AC-46** `loadAuthMode` `'error'` → today's object with `authorization_servers: [AGENT_PUBLIC_URL]`.
2. `authorization-server/route.test.ts`: `local`/`both` → today's; **@AC-49** `oidc` → 404; **@AC-46** `'error'` → today's with `issuer = AGENT_PUBLIC_URL`.
3. `mcpScopes.test.ts`: equals `prm.expected.scopes_supported`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint && pnpm run test:coverage
```

---

### Step 50 — test: e2e SSO fixtures and the stub IdP

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/helpers/stubIdp.ts` — create
- `services/xstockstrat-ui/e2e/fixtures/sso.ts` — create
- `services/xstockstrat-ui/e2e/fixtures/index.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness

**Codebase Evidence**:
- Mock ports `TRADER_MOCK_PORT = 9091`, `INSIGHTS_MOCK_PORT = 9092`, `CONFIG_UI_MOCK_PORT = 9093` (`mock-backend.ts:124-126`).
- `e2e/helpers/auth.ts`: `TEST_JWT_SECRET` (`:20`), `signTestJwt` (`:29`), `addAuthCookie` (`:83`); `e2e/fixtures/users.ts` and `INVENTORY.md` exist.
- D-91: the stub issuer is `http://127.0.0.1:<port>`, which the grammar accepts.

**TDD**: N/A (harness with no assertions of its own; RED→GREEN via Step 53)

**Covers**: — (harness only; scenarios covered by Step 53)

**Instructions**:
1. **Stub IdP** (`node:http` on `127.0.0.1:<STUB_IDP_PORT>`, a free fixed port next to 9091–9093 confirmed unused at execute): discovery (byte-exact issuer, same-origin `jwks_uri`, `end_session_endpoint` only under the `endSession` knob), `/jwks`, `/authorize` (records `prompt`/`max_age`; redirects with `code`+`state`), `/token` (RS256 ID token via jose: `aud` = client id, the authorize nonce, `sub`/`email`/`preferred_username` per state, `auth_time` per the `authTime: 'fresh'|'absent'|'stale'` knob, `signWith:'foreign'` signs with a key absent from the JWKS), `/logout` (records the call). Control: `POST /__test/state` sets the knobs plus the mode and the config/identity values the mock serves (Step 51); `POST /__test/reset` restores the default (mode row absent). Export the state object, `startStubIdp()`, `stopStubIdp()`.
2. **Fixtures (C-12)**: `fixtures/sso.ts` holds the stub issuer builder, the four staging client IDs, the SSO subject and link labels (reusing `users.ts` ids via spread), and the discovery-document builder; export from `fixtures/index.ts`; add `INVENTORY.md` rows.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint
grep -n "sso" e2e/fixtures/index.ts e2e/fixtures/INVENTORY.md
grep -n "from '../fixtures'\|helpers/auth" e2e/helpers/stubIdp.ts
```

---

### Step 51 — test: Mock-backend SSO handlers and the stub-IdP lifecycle

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify
- `services/xstockstrat-ui/e2e/global-setup.ts` — modify
- `services/xstockstrat-ui/e2e/global-teardown.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness

**Codebase Evidence**:
- `identityHandlers` at `mock-backend.ts:287-325` (`authenticateUser`, `refreshToken`, `revokeToken`, `listAuthorizedApps`, `revokeAuthorizedApp`).
- `getConfig(req)` at `:1560-1586`: requires an environment, answers `ui` with `performance.*`, and **every other namespace with `platform`** (recon R-9).
- `playwright.config.ts:98-99` `globalSetup`/`globalTeardown`.

**TDD**: N/A (harness; the default state is `local` with the mode row absent, so the existing suite is its regression net)

**Covers**: — (harness only; scenarios covered by Step 53)

**Instructions**:
1. `getConfig`: namespace `identity` → `auth.mode` from the stub state (row **absent** by default, D-130e); `agent` → `oidc.issuer`; `ui` → the existing `performance.*` plus `oidc.issuer`, `oidc.client_id` and the four client IDs; a `getConfigFails` knob throws (AC-46/60/62). Other namespaces unchanged.
2. `getSecret` for `ui/oidc.client_secret`: `found` per state; asserts `x-internal-caller: ui`.
3. `identityHandlers` gain `resolveExternalIdentity` (fixture user or `FailedPrecondition` with the state's detail), `issueSessionForUser` (a `signTestJwt` session), `linkExternalIdentity` (records links; refusal per state; `link disabled` unless mode is `both`), `getExternalIdentityLinks` (from the recorded links), and `authenticateUser` answers `PermissionDenied` "password login disabled" when the mode is `oidc`.
4. Start the stub IdP in `global-setup.ts` in the mock's process; stop it in `global-teardown.ts`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint
pnpm exec playwright test e2e/auth.spec.ts --project=chromium   # default state keeps the existing suite green
```

---

### Step 52 — test: Serialized chromium-sso project and the APP_URL wiring

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/playwright.config.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness

**Codebase Evidence**:
- `playwright.config.ts`: `fullyParallel: true` (`:83`), `workers: isCI ? 2 : undefined` (`:85`), `retries` (`:86`), `use.baseURL: 'http://localhost:3000'` (`:101`), `projects` (`:105-134`: `setup`, `chromium`, conditional `firefox` `:120-133`), `webServer` (`:135`) with `AGENT_PUBLIC_URL: 'http://127.0.0.1:9099'` (`:175`).
- `@playwright/test` `1.62.1` (`package.json:67`) has a project-level `workers` option, so no separate CI invocation is needed; CI `frontend-e2e` runs every project (`ci.yml:611`).

**TDD**: N/A (test configuration; RED→GREEN via Step 53)

**Covers**: — (harness only)

**Instructions**:
1. `const BASE_URL = 'http://localhost:3000'` for `use.baseURL` and `APP_URL: BASE_URL` in `webServer.env` (D-67).
2. Project `chromium-sso`: `testMatch: /e2e\/sso\/.*\.spec\.ts/`, `dependencies: ['chromium']`, `fullyParallel: false`, `workers: 1`; the `chromium` project gains `testIgnore: /e2e\/sso\//` (spec-level choice 3). Known cost: a hard `chromium` failure skips `chromium-sso`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint
grep -n "chromium-sso\|workers: 1\|testIgnore\|APP_URL" playwright.config.ts
pnpm exec playwright test --list > /dev/null
```

---

### Step 53 — test: The serial SSO e2e file, the local cases and nav reachability

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/sso/sso.spec.ts` — create
- `services/xstockstrat-ui/e2e/auth.spec.ts` — modify
- `services/xstockstrat-ui/e2e/nav-reachability.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness

**Codebase Evidence**:
- `e2e/auth.spec.ts` holds today's login and logout cases (`page.request.post` sends no Origin, D-77).
- `nav-reachability.spec.ts:22` `GROUPS` lists nav entries per tab.

**TDD**: red-green required

**Covers**: AC-1, AC-3, AC-4, AC-7, AC-16, AC-17, AC-29, AC-31, AC-34, AC-41, AC-42, AC-44, AC-45, AC-46, AC-47, AC-48, AC-49, AC-51, AC-53, AC-54, AC-56, AC-57, AC-59, AC-60, AC-62, AC-63, AC-64, AC-65, AC-66, AC-67, AC-69, AC-74, AC-76

**Instructions**:
1. **`e2e/sso/sso.spec.ts`** — `test.describe.configure({ mode: 'serial' })` (D-120); every case sets state through `/__test/state` and `afterAll` resets:
   - login (`oidc` unless noted): **@AC-1** Sign in with SSO → `/trader`; **@AC-29** checked → `Max-Age=1209600` + `remember_me=1`, and a `page.route` intercept on `/start` sees `remember=1` only when checked (D-64); **@AC-16** only the SSO button + checkbox; **@AC-17** `both` → both forms; **@AC-3** `not linked` → per-mode message (`both`, `oidc`); **@AC-7** inactive message; **@AC-51** `access_denied` (intercept) → no-access message; **@AC-59** a cross-origin POST with `Origin` → `?error=failed`, GET → 405; **@AC-54** `ui` issuer `http://auth.example.test` → `not_configured`; **@AC-47** `local` with issuers set → `/start` and `/callback` 404; **@AC-60** `getConfigFails` → `failed`;
   - local/global: **@AC-31** mode row absent → password form only; **@AC-44** `oidc` → set the stub mode to `local` → next render shows the password form only; **@AC-45** `both` with the stub IdP stopped → password login lands on `/trader`; **@AC-46** `getConfigFails` → password form, and `/.well-known/oauth-authorization-server/agent` 200 with `issuer` = `AGENT_PUBLIC_URL` and the PRM's `authorization_servers` = `[AGENT_PUBLIC_URL]`;
   - logout: **@AC-53/@AC-63** (`both`, `oidc`) header Sign out → cookies cleared, navigation to the stub `/logout?rd=…/auth/login` (`page.route`); **@AC-56** invalid issuer → `/auth/login`; **@AC-62** `getConfigFails` → `/auth/login`; **@AC-57** (`both`, `oidc`) cross-origin POST with cookies → 403, cookies unchanged; **@AC-64** expired access + refresh cookie → 200 JSON `ok`; mobile 375 px `/trader`: no horizontal overflow and the button in the viewport (D-63; fallback logged in the Deviation Log);
   - accounts: **@AC-34/@AC-48** `oidc` → issuer link, connector URL with copy, four labelled client IDs, no revoke; **@AC-49** `oidc` → PRM lists the stub issuer, AS 404; `both` → today's documents;
   - Link SSO (`both`): **@AC-65** Link SSO → stub with `prompt=login&max_age=1` and `authTime:'fresh'` → confirmation "You are linking {email} to {account email}." → correct password → linked; then Sign in with SSO lands on `/trader`; **@AC-66** wrong password → "Incorrect password."; **@AC-67** already linked → `already_linked_self` message; **@AC-4** subject linked to another → `already_linked_other` message; **@AC-74** `authTime:'absent'`/`'stale'` → "Sign-in failed. Try again.", no confirmation; **@AC-76** `access_denied`/`server_error` on the link request (intercept) → `/accounts/sso` with the D-137 message / `failed`; **@AC-69** `local`/`oidc` → status shown, no Link SSO action, `/link` → 404.
2. **`e2e/auth.spec.ts`** (default state only; never calls `/__test/state`): **@AC-41** no SSO button, password login lands on `/trader`; **@AC-42** `/accounts/authorized-apps` lists the grant with revoke; **@AC-57** (`local`) cross-origin POST with cookies → 403; **@AC-63** (`local`) Sign out → `/auth/login`. The existing logout cases stay green.
3. **`nav-reachability.spec.ts`**: add `{ label: 'Single sign-on', href: '/accounts/sso' }` to the accounts group (C-10a).
4. C-12: fixtures from `e2e/fixtures/sso.ts` and `users.ts`; helpers from `e2e/helpers/{auth,stubIdp}.ts`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint
pnpm exec playwright test --list --project=chromium-sso | grep -c "sso.spec.ts"
! pnpm exec playwright test --list --project=chromium | grep -q "sso/sso.spec.ts"
! grep -n "__test/state" e2e/auth.spec.ts
pnpm exec playwright test e2e/auth.spec.ts e2e/nav-reachability.spec.ts e2e/sso --project=chromium --project=chromium-sso
pnpm exec playwright test --list --shard=1/2 | grep -c 'chromium-sso' ; pnpm exec playwright test --list --shard=2/2 | grep -c 'chromium-sso'   # sum = every SSO case; none dropped
# e2e: no coverage threshold (Playwright); the vitest 40% gate covers src/lib/** only
```

---

### Step 54 — docs: MCP connector runbook and the SSO cutover runbook

**Status**: `pending`
**Service**: `docs/runbooks/`
**Files**:
- `docs/runbooks/mcp-tools.md` — modify
- `docs/runbooks/authelia-sso-cutover.md` — create

**Reviewers**: none

**Codebase Evidence**:
- `docs/runbooks/authelia-sso-cutover.md` does not exist (`ls docs/runbooks`).
- `docs/runbooks/mcp-tools.md` documents today's DCR connector flow; it is in the agent CI filter (`ci.yml:59`).

**TDD**: N/A (docs; RED/GREEN for AC-20/AC-36 is Step 58, whose RED this step's first action captures)

**Covers**: —

**Instructions**:
1. **RED capture first**: run Step 58's Verification against the unedited tree and record the non-zero exit in Step 58's evidence.
2. **`mcp-tools.md`** (FR-13, AC-20): connector setup in `oidc` with client IDs `xstockstrat-mcp-claude`, `xstockstrat-mcp-claude-ro`, `xstockstrat-mcp-claude-code`, `xstockstrat-mcp-claude-code-ro` and the `xstockstrat-staging-` set; redirect URIs `https://claude.ai/api/mcp/auth_callback`, `https://claude.com/api/mcp/auth_callback` and the Claude Code loopback redirect; the four scopes and the narrowing rule; `local`/`both` keep today's DCR flow; a link to the cutover runbook.
3. **`authelia-sso-cutover.md`** (design § 6; D-42, D-49 N-9, D-73, D-91, D-97, D-98, D-108, D-119, D-138, D-139): the mode table; pre-checks (config listener up; issuer and `APP_URL` grammar incl. trailing slash, IP literal, IDN; `ui/oidc.client_secret` set; app VM reaches the issuer); the four cutover gates before `both`, written out as the Authelia prerequisites (the `POST /accounts/api/sso/confirm` rate-limit zone; S17: `prompt=login` + `max_age=1` returns a fresh `auth_time`, proven on the edge droplet 2026-11-27 (with `max_age=0` Authelia v4.39.28 never issues a code); the web client registered with scopes `openid profile email` and `claims_policy.id_token` with `email` and `preferred_username`, `auth_time` present by default or via the policy per S17; the seed-row `reset-password`); the lifecycle `local` → `both` → each person links (Link SSO) → every admin linked → `oidc`, each switch by `uv run scripts/manage-users.py set-auth-mode <mode> --environment <env> --reason <text>`, after which the operator checks that the changed row's environment is the deployment's `APPLICATION_ENV` (every database holds both environments' rows and the services read only their own, so a wrong `--environment` changes nothing that runs); the signing-key rule (owner, 2026-11-27; SSO spec § 3; D-138): the agent uses keys only from a set fetched within the last 3600 s (`_JWKS_MAX_AGE_S`), with no stale-key grace, so a JWKS outage outlasting 3600 s from its last good fetch makes every `oidc` MCP call 503 `jwks_unavailable` until the JWKS is reachable again; on the homelab, leave the two `ui/oidc.mcp_client_id_claude_code*` keys (`oidc.mcp_client_id_claude_code`, `oidc.mcp_client_id_claude_code_readonly`) empty in both environments, because homelab-edge registers no Claude Code client (SSO spec § 4.6 and decision 21 as amended 2026-11-27), and an empty value hides that line on the authorized-apps card (FR-11); verification signals (`wrong_audience`, `jwks_unavailable`, `account_refused`, `ui.auth.events{sso_login_failed|sso_login_error|sso_link_failed|logout reason=cross_origin}`, `identity.link.failures`, WARN `sso_link_refused`, ERRORs `sso_issuer_invalid`/`app_url_invalid`/`auth_mode_invalid`); rollback and break-glass = `set-auth-mode local`; unlinking with `unlink-sso`; signing algorithms (RS/PS/ES only, EdDSA excluded); offboarding (`SetUserActive false` + `unlink-sso`; group removal blocks new logins only, D-98); local docker-compose SSO unsupported.

**Verification**:
```bash
grep -c "xstockstrat-staging-mcp-claude-code-ro" docs/runbooks/mcp-tools.md
grep -n "set-auth-mode\|unlink-sso\|EdDSA" docs/runbooks/authelia-sso-cutover.md
for s in "openid profile email" "preferred_username" "auth_time" "max_age=1" "/accounts/api/sso/confirm" "APPLICATION_ENV" "_JWKS_MAX_AGE_S" "mcp_client_id_claude_code"; do grep -qF "$s" docs/runbooks/authelia-sso-cutover.md || { echo "missing: $s"; exit 1; }; done
```

---

### Step 55 — docs: Pattern docs and the root dependency graph

**Status**: `pending`
**Service**: `docs/patterns/` and root `CLAUDE.md`
**Files**:
- `docs/patterns/frontend-auth.md` — modify
- `docs/patterns/database.md` — modify
- `docs/patterns/inter-service-mtls.md` — modify
- `docs/patterns/config-governance.md` — modify
- `CLAUDE.md` — modify (§ Inter-Service Dependencies)

**Reviewers**: none

**Codebase Evidence**:
- `docs/patterns/config-governance.md` § Per-Feature Registered Keys and the **Baseline.** bullet (`:90`, under § Wiring check); root `CLAUDE.md` § Inter-Service Dependencies (the `xstockstrat-notify → xstockstrat-identity (ListAdminUserIds …)` line).

**TDD**: N/A (docs)

**Covers**: —

**Instructions**:
1. `frontend-auth.md`: the keys `identity/auth.mode`, `ui/oidc.*` and `agent/oidc.issuer` (AC-36); the mode-driven login page, SSO start/callback, the txn and `sso_link` cookies, Link SSO through `/accounts/api/sso*` with `apiFetch` (ledger `fails.md:4251`), `IssueSessionForUser`, logout (Origin step 0, verify, revoke, redirect), the middleware sets.
2. `database.md`: `identity.external_identities` in the schema map; IDENTITY-15 note (new migrations resolve the seed owner by `SEED_USER_ID`, never `admin@localhost`).
3. `inter-service-mtls.md`: the `ui` `GetSecret` grant and the four SAN-gated identity RPCs.
4. `config-governance.md`: a row per seeded key (type, default, reader, live mechanism) and the author sentinel `operator:manage-users` (D-109).
5. Root `CLAUDE.md`: `xstockstrat-ui → xstockstrat-identity (ResolveExternalIdentity, IssueSessionForUser, LinkExternalIdentity, GetExternalIdentityLinks)`, `xstockstrat-agent → xstockstrat-identity (ResolveExternalIdentity)`, `xstockstrat-ui → xstockstrat-config (GetSecret, ui OIDC client secret)`, and the external HTTPS edges from the UI and the agent to the OIDC issuer.

**Verification**:
```bash
node scripts/check-config-wiring.mjs --doc-check
grep -n "ResolveExternalIdentity" CLAUDE.md docs/patterns/inter-service-mtls.md && grep -n "external_identities" docs/patterns/database.md && grep -n "operator:manage-users" docs/patterns/config-governance.md
```

---

### Step 56 — docs: Identity docs

**Status**: `pending`
**Service**: `xstockstrat-identity` docs
**Files**:
- `services/xstockstrat-identity/CLAUDE.md` — modify
- `services/xstockstrat-identity/docs/context-constitution.md` — modify
- `services/xstockstrat-identity/docs/operations.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-identity/CLAUDE.md` sections: Ports `:19`, Database / Migrations `:41`, Config Keys Consumed `:57`, Observability `:68`.
- `docs/context-constitution.md:25` IDENTITY-12 (`ListAdminUserIds` SAN-only) and `:27` IDENTITY-15 (seed email read by analysis `029`).

**TDD**: N/A (docs; AC-36's IDENTITY-15 RED/GREEN is Step 58)

**Covers**: —

**Instructions**:
1. `CLAUDE.md`: an "SSO (feature 345)" paragraph naming `identity/auth.mode`, the `ui/oidc.*` keys, `agent/oidc.issuer` and the Link SSO flow (AC-36); Config Keys gains `auth.mode` (string, `local`, read globally at login, Link and every watcher update); Ports/RPCs gain the four RPCs and their SANs; Database gains `007_external_identities`; Observability lists `identity.external.linked` among the audited types, `identity.link.failures`, and the `password_login_disabled` reason (D-130f).
2. `context-constitution.md`: IDENTITY-12 extended to the per-RPC SAN lists; IDENTITY-15 gains "new migrations resolve the seed owner by `SEED_USER_ID`, never by `admin@localhost`" (AC-36).
3. `operations.md`: `set-auth-mode` and `unlink-sso` usage, break-glass.

**Verification**:
```bash
grep -n "SEED_USER_ID" services/xstockstrat-identity/docs/context-constitution.md
grep -n "auth.mode" services/xstockstrat-identity/CLAUDE.md && grep -n "set-auth-mode" services/xstockstrat-identity/docs/operations.md
```

---

### Step 57 — docs: UI and agent docs

**Status**: `pending`
**Service**: `xstockstrat-ui` and `xstockstrat-agent` docs
**Files**:
- `services/xstockstrat-ui/CLAUDE.md` — modify
- `services/xstockstrat-agent/CLAUDE.md` — modify
- `services/xstockstrat-agent/docs/context-constitution.md` — modify
- `services/xstockstrat-agent/docs/oauth.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- UI `CLAUDE.md`: Auth + BFF `:156`, Config Keys Consumed `:199`, Environment Variables `:212` (no `APP_URL`), Testing `:247`.
- Agent `CLAUDE.md`: Config Keys Consumed `:114`; `docs/context-constitution.md:23` AGENT-8, `:24` AGENT-9 (watched namespaces `agent`, `indicators`); AGENT-1 names the lifespan channels.

**TDD**: N/A (docs; AC-36's AGENT-9 RED/GREEN is Step 58)

**Covers**: —

**Instructions**:
1. UI `CLAUDE.md`: `APP_URL` (exact browser origin, D-81); Config Keys gains `identity/auth.mode`, `ui/oidc.*`, `agent/oidc.issuer` and the `GetSecret` read; Auth + BFF gains the SSO routes and the Link SSO flow (`/accounts/sso`, `/accounts/api/sso*`), `oidcConfig.ts`, `oidcClient.ts`, `ssoTxn.ts`, `sameOrigin.ts`, `ssoErrors.ts`; Testing gains the `chromium-sso` project and the rule that every mode-changing e2e case lives in `e2e/sso/sso.spec.ts`.
2. Agent `CLAUDE.md`: Config Keys gains `identity/auth.mode` and `agent/oidc.issuer`; the `oidc` auth path; the same "SSO (feature 345)" paragraph as identity's, naming `identity/auth.mode`, the `ui/oidc.*` keys, `agent/oidc.issuer` and the Link SSO flow (AC-36). The UI `CLAUDE.md` names all four in item 1.
3. Agent constitution: AGENT-1 channels (`agent`, `indicators`, `identity`); AGENT-9 `WATCHED_NAMESPACES` (`agent`, `indicators`, `identity`) and the new sites `app/sso_mode.py#current_auth_mode`, `#agent_issuer` (AC-36); AGENT-8 notes `sso_auth.py` imports `AGENT_PUBLIC_URL` from `oauth_metadata`.
4. `docs/oauth.md`: the `oidc` resource-server path, the 404 legacy routes, the PRM by mode.

**Verification**:
```bash
grep -n "APP_URL" services/xstockstrat-ui/CLAUDE.md && grep -n "chromium-sso" services/xstockstrat-ui/CLAUDE.md
grep -n "AGENT-9" services/xstockstrat-agent/docs/context-constitution.md | grep -F '`identity`'
```

---

### Step 58 — test: AC-20 and AC-36 documentation assertions

**Status**: `pending`
**Service**: `docs/`
**Files**:
- (no file changes — verification-only step; run from the repo root)

**Reviewers**: none

**Codebase Evidence**:
- D-48's coverage rule for AC-20/AC-36 (named RED/GREEN `grep -F` step) is carried as the design's **DG** seam (design.md § 7).
- `insights.md:2940-2946`: a construct-scoped presence RED→GREEN is a named `**Covers**` step, not a permanent CI guard.

**TDD**: red-green required (RED captured by Step 54's first action; GREEN here after Steps 54–57)

**Covers**: AC-20, AC-36

**Instructions**:
1. Confirm Step 54 recorded the RED; run the block and record the GREEN. Add no CI guard (C-18).

**Execute note**: no files change, so `/sdd-execute` records the output in `context.md`; if the executor requires a commit per step, fold this block and `Covers: AC-20, AC-36` into Step 57 and log the fold.

**Verification**:
```bash
set -e
for s in xstockstrat-mcp-claude xstockstrat-mcp-claude-ro xstockstrat-mcp-claude-code xstockstrat-mcp-claude-code-ro xstockstrat-staging-mcp-claude xstockstrat-staging-mcp-claude-ro xstockstrat-staging-mcp-claude-code xstockstrat-staging-mcp-claude-code-ro "https://claude.ai/api/mcp/auth_callback" "https://claude.com/api/mcp/auth_callback"; do grep -qF "$s" docs/runbooks/mcp-tools.md; done   # @AC-20
for s in set-auth-mode unlink-sso "Link SSO" both oidc; do grep -qF "$s" docs/runbooks/authelia-sso-cutover.md; done   # @AC-20 runbook
grep -F "SEED_USER_ID" services/xstockstrat-identity/docs/context-constitution.md | grep -qF "admin@localhost"   # @AC-36 IDENTITY-15
grep -F "AGENT-9" services/xstockstrat-agent/docs/context-constitution.md | grep -F '`identity`' | grep -F '`agent`' | grep -qF '`indicators`'   # @AC-36 AGENT-9
for f in services/xstockstrat-identity/CLAUDE.md services/xstockstrat-ui/CLAUDE.md services/xstockstrat-agent/CLAUDE.md docs/patterns/frontend-auth.md; do
  for s in "auth.mode" "ui/oidc." "agent/oidc.issuer" "Link SSO"; do grep -qF "$s" "$f"; done
done   # @AC-36 the three CLAUDE.md files and frontend-auth.md name the mode key, the ui/oidc.* and agent/oidc.issuer keys, and the Link SSO flow
echo GREEN
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Steps 1+2 — codegen toolchain and incidental Go reflow
- **Expected**: `./scripts/buf-gen.sh` via the Docker codegen image; commit every path it changes.
- **Actual**: the image's `golang:1.27-trixie` pull got Docker Hub `429 Too Many Requests`; ran `buf-gen.sh` host-native with the CI `proto-freshness` pins. That toolchain also reflowed two doc comments in `gen/go/analysis/v1/analysis.pb.go` and `gen/go/trading/v1/trading.pb.go` (no identity change; trunk's committed output, which CI produces, lacks the reflow).
- **Disposition**: CI-equivalent fallback; the two non-identity files were reverted, not committed (CI `proto-freshness` re-checks the gen tree).

### Step 4 — stored set regenerated on a local scratch Postgres (owner override)
- **Expected**: regenerate `scripts/config-wiring-stored.json` on a scratch Postgres 16, or block (P-03) and take the CI `config-wiring-stored` artifact; the execute rails forbid starting a database.
- **Actual**: CI runs only on pull requests, so no artifact existed. The owner chose "Allow scratch Postgres" (2026-11-27, this session) over an early PR or a deferral. Ran one throwaway local Postgres 16 (host binaries, no container) only for `config-wiring-stored.py`; stopped and deleted it right after. No migration was verified against it beyond the generator's own apply.
- **Disposition**: owner-signed override of the no-database rail for this one regeneration; CI's `config-wiring-stored` job re-checks freshness on the integration PR.
