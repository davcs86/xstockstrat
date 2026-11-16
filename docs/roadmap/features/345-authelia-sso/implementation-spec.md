# Implementation Spec: authelia-sso

**Status**: `pending`
**Created**: 2026-11-16
**Feature**: `docs/roadmap/features/345-authelia-sso/feature.md`
**Total Steps**: 40
**Feature Branch**: `feature/authelia-sso`

---

## Execution Summary

The spec follows the design's rollout order (D-20, D-48): proto, then migrations, then identity, the
config grant, the admin script, the agent, the UI, and the docs. Every intermediate state is legacy
mode. The two issuers stay `""` and the password flag is seeded `true` until a deployment cuts over,
so no step can lock anyone out. Within each surface the order is leaf modules first, then the code
that composes them, then routes and pages, so each `service` step passes its own Verification before
the next one starts.

The step bodies cite the debate register (`D-n`), not the design-layer prose (design.md §Precedence).
The config seed is **`051_authelia_sso_keys`** (D-94; feature 341 took `050`). `debate.md` D-20, D-36,
D-44, D-48 and D-57 still say `050`; D-94 governs.

**Consumer surfaces (C-14):** UI. This covers the login page, `/api/auth/sso/{start,callback}`, logout
plus the header Sign-out button, `/accounts/authorized-apps`, and the `.well-known` copies (Steps
23–38). The agent's authentication and effective scope for every MCP tool are in Steps 15–22. The
script `manage-users.py update-email|unlink-sso` is in Steps 13–14. No new page or route segment is
added, so no `PLATFORM_SUBNAV` registration is needed (C-10a). The new routes are API routes and the
two changed pages already exist.

**Business rules (C-16):** this is the design.md §Business Rules list. One CHANGE is owner-signed: logout
in both modes (D-60, D-77, D-80). One rule is PRESERVE in legacy mode only: agent `@AC-19 @feature-294`
(D-17). The integration PR promotes the `@AC-*` scenarios into the durable suites.

### Scenario Coverage (C-15)

| AC | Step(s) | AC | Step(s) | AC | Step(s) | AC | Step(s) |
|---|---|---|---|---|---|---|---|
| AC-1 | 12, 38 | AC-17 | 9, 38 | AC-33 | 12 | AC-49 | 37, 38 |
| AC-2 | 12 | AC-18 | 14 | AC-34 | 38 | AC-50 | 12, 14 |
| AC-3 | 12 | AC-19 | 14 | AC-35 | 5, 7 | AC-51 | 33, 38 |
| AC-4 | 11, 12, 33 | AC-20 | 40 | AC-36 | 40 | AC-52 | 29, 31 |
| AC-5 | 11, 12, 33 | AC-21 | 22 | AC-37 | 22 | AC-53 | 29, 31, 38 |
| AC-6 | 12 | AC-22 | 20, 22 | AC-38 | 11 | AC-54 | 25, 27, 33, 37, 38 |
| AC-7 | 11, 12, 33 | AC-23 | 22 | AC-39 | 11, 12, 33 | AC-55 | 16, 22 |
| AC-8 | 12 | AC-24 | 29, 33 | AC-40 | 22 | AC-56 | 31, 38 |
| AC-9 | 11, 12 | AC-25 | 12 | AC-41 | 5, 38 | AC-57 | 25, 31, 38 |
| AC-10 | 22 | AC-26 | 11, 12, 33 | AC-42 | 22, 38 | AC-58 | 25, 31, 33, 38 |
| AC-11 | 22, 37 | AC-27 | 11 | AC-43 | 22 | AC-59 | 25, 33, 38 |
| AC-12 | 20 | AC-28 | 11, 12 | AC-44 | 22, 38 | AC-60 | 27, 33 |
| AC-13 | 20 | AC-29 | 33, 38 | AC-45 | 31, 38 | AC-61 | 18, 22 |
| AC-14 | 22 | AC-30 | 12, 22 | AC-46 | 27, 38 | AC-62 | 31 |
| AC-15 | 22 | AC-31 | 9 | AC-47 | 33 | AC-63 | 38 |
| AC-16 | 9, 31, 38 | AC-32 | 16, 22, 27, 38 | AC-48 | 38 | AC-64 | 31, 38 |

## Step Dependencies

- Steps 1 + 2 land together: the step edits a `.proto`, so the `proto-gen` step must commit with it (§C).
  No descriptor-parity guard covers identity messages. A grep for `_MAPPED` / `covers_every_proto_field`
  found hits only in agent tests that never import `identity_pb2`.
- Steps 8 + 9 land together. Step 8 adds `this.config.getBool(...)` to `authenticateUser`. The identity
  test mocks have only `getInt` (`identityServiceImpl.test.ts:58,292,357,1141,1388`,
  `identityServiceImpl.otlp.test.ts:40`, `identityTelemetry.test.ts:13`; recon R-7), so every existing
  password-login test would throw at runtime until Step 9 adds `getBool`.
- Steps 39 + 40 land together. AC-20/AC-36 are `grep -F` RED→GREEN checks over the docs Step 39 writes
  (D-48).
- Step 4 seeds the keys. Their readers land in Step 8 (identity), Step 15 (agent) and Step 26 (UI),
  across three surfaces, so they cannot form one §C unit. The bridge is the step-time
  `check-config-wiring.mjs` mode: a missing leg prints `PENDING` and does not block
  (`docs/patterns/config-governance.md:85-88`). `--final` runs only at the integration PR (the 338/341
  precedent).
- Steps 3–4 (migrations) precede Step 12 (the identity DB tier applies them) and Step 5 (the seed test
  reads 051).
- Step 6 (config grant) precedes Step 26. `loadOidcClientSecret` is denied without the grant in any
  live run; the unit tests mock it.
- Steps 10–11 precede Step 22: the agent resolve path calls `ResolveExternalIdentity`. Unit tests mock it.
- Step 17 precedes Step 21, and Step 19 precedes Step 21: `sso_auth.py` composes `jwks.py`, `scopes.py` and the client helper.
- Step 23 (`typecheck` in CI) precedes Step 30. D-83's `@ts-expect-error` cases only go RED under a real `tsc` (D-93).
- Step 24 precedes Steps 26/28/30/32; Step 26 precedes Steps 28/30/32/34/35; Step 28 precedes Steps 30/32.
- Step 32 precedes Step 34: the login form posts to `/api/auth/sso/start`.
- Step 38 (e2e) requires every UI step 23–37.
- **Merge order (rollout, not steps):** feature 319 merges first or alongside (D-52; the RevokeToken
  unverified-decode defect). Rebase over 324 (`manage-users.py`, `ci.yml`), 331 and 323 (agent `main.py`).
  Re-check that config `051` and identity `007` are still the next free numbers at merge (D-94; 343 also plans a config seed).

---

### Step 1 — proto: Add ResolveExternalIdentity, IssueSessionForUser and ExternalIdentityOutcome

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/identity/v1/identity.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness per message, additive-only, `buf lint` + `buf breaking` against the dev trunk; `packages/proto` owner — backward compatibility, naming conventions; `xstockstrat-identity` owner — JWT expiry and rotation

**Codebase Evidence**:
- `grep -n "rpc ListAdminUserIds" packages/proto/identity/v1/identity.proto` → `:49`, the last RPC of the service block, which closes at `:50`; the SAN-gate comment precedent is at `:47-48`.
- `AuthTokenResponse{access_token=1, refresh_token=2, expires_at=3, claims=4}` is at `:57-62`. `enum Role { ROLE_UNSPECIFIED = 0; … }` is at `:170-175`. The file is 218 lines and has no `reserved` ranges.
- `packages/proto/buf.yaml` lint `STANDARD` except `RPC_RESPONSE_STANDARD_NAME`, `RPC_REQUEST_RESPONSE_UNIQUE`, so returning the existing `AuthTokenResponse` is allowed (recon).

**Lands with**: Step 2

**TDD**: N/A (proto contract; verified by buf lint/breaking)

**Covers**: —

**Instructions**:
1. After `rpc ListAdminUserIds(...)` (`:49`), add two RPCs, each with a SAN comment in the `:47-48` style:
   - `// Resolves an Authelia (iss, sub, email) to an identity.users row (feature 345). Authorized by mTLS peer SAN xstockstrat-ui or xstockstrat-agent only; every request header is ignored.`
     `rpc ResolveExternalIdentity(ResolveExternalIdentityRequest) returns (ResolveExternalIdentityResponse);`
   - `// Mints a first-party session for a resolved user (feature 345). Authorized by mTLS peer SAN xstockstrat-ui only.`
     `rpc IssueSessionForUser(IssueSessionForUserRequest) returns (AuthTokenResponse);`
2. Append these messages at the end of the file (D-11):
   - `message ResolveExternalIdentityRequest { string issuer = 1; string subject = 2; string email = 3; }`
   - `message ResolveExternalIdentityResponse { string user_id = 1; repeated Role roles = 2; bool is_active = 3; ExternalIdentityOutcome outcome = 4; }`
   - `message IssueSessionForUserRequest { string user_id = 1; }`
   - `enum ExternalIdentityOutcome { EXTERNAL_IDENTITY_OUTCOME_UNSPECIFIED = 0; EXTERNAL_IDENTITY_OUTCOME_LINKED_EXISTING = 1; EXTERNAL_IDENTITY_OUTCOME_LINKED_BY_EMAIL = 2; EXTERNAL_IDENTITY_OUTCOME_CREATED = 3; }` (C-04)
3. Add no `refusal` enum value: refusals are gRPC statuses (FR-3, D-11).

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against "../../.git#branch=feature/authelia-sso,subdir=packages/proto"
```

---

### Step 2 — proto-gen: Regenerate stubs for the identity additions

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/ts/**` — modify (generated)
- `packages/proto/gen/python/**` — modify (generated)
- `packages/proto/gen/go/**` — modify (generated)

**Reviewers**: Proto Reviewer — field number uniqueness, `buf lint` + `buf breaking`; `packages/proto` owner — backward compatibility; `xstockstrat-identity` owner — JWT expiry and rotation

**Codebase Evidence**:
- Root `CLAUDE.md` § Generating Proto Stubs: `./scripts/buf-gen.sh` generates TS, Python and Go stubs and compiles the TS package. The CI `proto-freshness` job is at `.github/workflows/ci.yml:255`.
- Ledger `insights.md:895-897`: incidental WKT comment diffs from `buf-gen` are committed, not reverted.

**Lands with**: Step 1

**TDD**: N/A (generated code)

**Covers**: —

**Instructions**:
1. Run `./scripts/buf-gen.sh` from the repo root. Commit every changed file under `packages/proto/gen/`, including any incidental WKT doc-comment refresh (insights.md:895).
2. Never Read/Grep the generated files (root `CLAUDE.md` Key File Paths). Check them only through the build below.

**Verification**:
```bash
./scripts/buf-gen.sh && git status --porcelain packages/proto/gen | head -5 && pnpm --filter @xstockstrat/proto run build
# re-running buf-gen.sh must leave `git diff --exit-code packages/proto/gen/` empty
./scripts/buf-gen.sh && git diff --exit-code packages/proto/gen/
```

---

### Step 3 — migration: identity 007_external_identities

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/migrations/007_external_identities.up.sql` — create
- `services/xstockstrat-identity/migrations/007_external_identities.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair, index correctness, run order per `scripts/db-migrate.sh`; `xstockstrat-identity` owner — JWT expiry and rotation

**Codebase Evidence**:
- `ls services/xstockstrat-identity/migrations | tail -3` → `005_drop_api_keys.up.sql`, `006_user_metadata.down.sql`, `006_user_metadata.up.sql`. So the next number is `007` (C-07).
- `identity.users`: `email TEXT NOT NULL UNIQUE`, `password_hash TEXT NOT NULL`, `roles TEXT[] DEFAULT '{"trader"}'` (`001:6-14`, recon). There is no `lower(email)` index (recon R-5).
- `scripts/db-migrate.sh` runs config, then identity, then the rest (recon § Deploy).

**TDD**: N/A (migration)

**Covers**: —

**Instructions**:
1. Up (D-5, D-7; the product spec § Database Changes):
   ```sql
   CREATE TABLE identity.external_identities (
     issuer    TEXT        NOT NULL,
     subject   TEXT        NOT NULL,
     user_id   UUID        NOT NULL REFERENCES identity.users(user_id) ON DELETE CASCADE,
     linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     PRIMARY KEY (issuer, subject),
     UNIQUE (issuer, user_id)
   );
   CREATE INDEX users_email_lower_idx ON identity.users (lower(email));
   ```
   The index is **non-unique** (R-2 locked: existing mixed-case duplicates must resolve to `ambiguous email`).
2. Down: `DROP INDEX IF EXISTS identity.users_email_lower_idx; DROP TABLE IF EXISTS identity.external_identities;`
3. Edit no applied migration (F-01).

**Verification**:
```bash
ls services/xstockstrat-identity/migrations/007_*.up.sql services/xstockstrat-identity/migrations/007_*.down.sql
# read both: the CREATE TABLE and CREATE INDEX in .up have DROP inverses in .down; the index is not UNIQUE
grep -c "UNIQUE INDEX" services/xstockstrat-identity/migrations/007_external_identities.up.sql   # expect 0
```

---

### Step 4 — migration: config 051_authelia_sso_keys and the regenerated stored set

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/051_authelia_sso_keys.up.sql` — create
- `services/xstockstrat-config/migrations/051_authelia_sso_keys.down.sql` — create
- `scripts/config-wiring-stored.json` — modify (regenerated, never hand-written)

**Reviewers**: DBA — migration NNN numbering, up+down pair, run order; `xstockstrat-config` owner — key naming, environment scoping, secret encryption + redaction

**Codebase Evidence**:
- `ls services/xstockstrat-config/migrations | tail -2` → `050_ui_chart_history_bars.{down,up}.sql`, owned by feature 341. So the next number is `051` (D-94).
- The seed row column order and conflict target come from `049_notify_commsgun_channel_keys.up.sql:4-55`: `(namespace, key, value_type, value_data, description, default_value, consuming_service, updated_by, environment, user_id)` and `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING`.
- The seeded-empty secret comes from `049_*.up.sql:57-67`: `value_data '[redacted]'`, `is_secret TRUE`, ciphertext NULL, and the comment "Ciphertext stays NULL: a migration has no master key".
- The notify CTE comes from `046_config_dead_rows_prune.up.sql:57-61`: `nt AS (SELECT pg_notify('config_changed', json_build_object('namespace', t.namespace, 'environment', t.environment)::text) AS sent FROM (SELECT DISTINCT namespace, environment FROM d) t) SELECT (SELECT count(*) FROM d) …, (SELECT count(*) FROM nt) AS notified;`
- The down guard comes from `050_ui_chart_history_bars.down.sql` and 049: `updated_by` sentinel plus seed value.
- `scripts/check-config-wiring.mjs:716` reports `STALE-STORED … regenerate it with DATABASE_URL=<scratch postgres> python3 scripts/config-wiring-stored.py`. CI regenerates the file and diffs it (`ci.yml:1250-1292`, job `config-wiring-stored`).

**TDD**: N/A (migration)

**Covers**: —

**Instructions**:
1. **Up**: one statement, using the 046/047 CTE shape (D-20, D-57):
   `WITH ins AS (INSERT INTO config.config_values (...) VALUES … ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING RETURNING namespace, environment), nt AS (SELECT pg_notify('config_changed', json_build_object('namespace', t.namespace, 'environment', t.environment)::text) AS sent FROM (SELECT DISTINCT namespace, environment FROM ins) t) SELECT (SELECT count(*) FROM ins) AS inserted, (SELECT count(*) FROM nt) AS notified;`
   - It seeds 14 rows: 7 keys × `staging` / `production`, `user_id NULL`, `updated_by = 'system:config-migration-feature-authelia-sso'`.
   - `identity` / `auth.password_login_enabled`: `bool`, value `'true'`, default_value `'false'`, consuming_service `xstockstrat-identity`.
   - `ui` / `oidc.issuer`, `oidc.client_id`, `oidc.mcp_client_id`, `oidc.mcp_client_id_readonly`: `string`, value `''`, default `''`, consuming_service `xstockstrat-ui`.
   - `ui` / `oidc.client_secret`: `string`, `is_secret TRUE`, value `'[redacted]'`, default `''`, ciphertext column left NULL (the 049 sentinel, D-57).
     - The secret row needs the `is_secret` column, so the VALUES list must name it for every row. Use `FALSE` on the other 12 rows. One INSERT keeps the single CTE.
   - `agent` / `oidc.issuer`: `string`, value `''`, default `''`, consuming_service `xstockstrat-agent`.
   - Each description states the operator effect. The issuer descriptions include the FR-14 grammar: https or loopback http, a lowercase host, no default port, no trailing slash, no query or fragment, and `""` = legacy. The flag description says "seeded true until this deployment's cutover; code default false (fail closed)".
   - A fresh DB gives `notified = 6` (identity, ui and agent × 2 environments); a re-apply gives 0.
2. **Down** (D-36): a `WITH d AS (DELETE FROM config.config_values WHERE environment IN ('staging','production') AND user_id IS NULL AND updated_by = 'system:config-migration-feature-authelia-sso' AND ((namespace='ui' AND key IN ('oidc.issuer','oidc.client_id','oidc.mcp_client_id','oidc.mcp_client_id_readonly') AND value_data='') OR (namespace='ui' AND key='oidc.client_secret' AND value_data='[redacted]' AND value_encrypted IS NULL) OR (namespace='agent' AND key='oidc.issuer' AND value_data='')) RETURNING namespace, environment)` CTE feeding the same `pg_notify` select.
   - It **never** deletes `identity` / `auth.password_login_enabled` (D-36: removing it would make the code default `false` lock out password login).
   - Confirm the ciphertext column's name at execute by reading `045` / `049`; `value_encrypted` is the name D-36 cites.
3. Add a header comment of two lines at most. It cites feature 345, states that the flag seed differs from the code default (the config-constitution exception, D-20), and states that the down keeps the flag row.
4. Regenerate the stored set on a scratch Postgres 16 with `psql` + `migrate` (the generator creates and drops its own DB):
   `DATABASE_URL=<scratch postgres> python3 scripts/config-wiring-stored.py`. Commit `scripts/config-wiring-stored.json`.
   - The file is **never hand-written**.
   - If no scratch Postgres is reachable, block the step (P-03) and run the CI `config-wiring-stored` job. It uploads the regenerated file as an artifact (`ci.yml:1294-1300`); commit that artifact. This is the 341 precedent.

**Verification**:
```bash
ls services/xstockstrat-config/migrations/051_*.up.sql services/xstockstrat-config/migrations/051_*.down.sql
grep -c "'staging'\|'production'" services/xstockstrat-config/migrations/051_authelia_sso_keys.up.sql   # 14 tuples
grep -n "password_login_enabled" services/xstockstrat-config/migrations/051_authelia_sso_keys.down.sql  # expect no match
# Step-time wiring: declared keys whose reader is not written yet print PENDING and do not fail (exit 0)
node scripts/check-config-wiring.mjs --declared-migration services/xstockstrat-config/migrations/051_authelia_sso_keys.up.sql
git diff --stat scripts/config-wiring-stored.json   # regenerated, non-empty
```

---

### Step 5 — test: Static seed test and migration-rerun assertion for 051

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/autheliaSsoSeedMigration.test.ts` — create
- `scripts/migration-assertions/config-authelia-sso-keys.sql` — create

**Reviewers**: `xstockstrat-config` owner — key naming, environment scoping, secret encryption + redaction

**Codebase Evidence**:
- The helper is `src/__tests__/migrationSql.ts`: `findOne(suffix, 'up'|'down')` (`:8`) and `splitStatements(sql)` (`:19`).
- The precedent is `src/__tests__/uiChartHistoryBarsSeedMigration.test.ts:1-30` (`SUFFIX`, `ACTOR`, a `ROW` regex, the `upInsert()` single-statement assertion).
- `scripts/migration-assertions/notify-commsgun-channel.sql:1-2` is the slug-named assertion run by `migration-rerun.py` after all migrations (`docs/patterns/database.md:66-72`). Name it by slug, not number (fails.md:3962-3964).

**TDD**: red-green required

**Covers**: AC-35 (the secret is seeded `is_secret`, NULL ciphertext), AC-41 (both issuers `""` and the flag `true` on every DB)

**Instructions**:
1. In `autheliaSsoSeedMigration.test.ts` (node:test, the `uiChartHistoryBarsSeedMigration.test.ts` style), assert on `findOne('_authelia_sso_keys', 'up'|'down')`:
   - The up is exactly one statement. It inserts 14 tuples whose `(namespace, key, environment)` set equals the 7 keys × 2 environments.
   - Every key is relative: no key starts with `ui.`, `agent.` or `identity.` (045 CHECK, `@AC-1 @feature-296`).
   - The flag rows carry value `'true'` and default `'false'`. The issuer and client-ID rows carry `''`/`''`.
   - The secret row has `TRUE` and `'[redacted]'`, and the other rows have `is_secret` `FALSE`.
   - `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING` is present.
   - `pg_notify` is fed by `SELECT DISTINCT namespace, environment FROM ins`. That gives 6 notifies on a fresh DB by construction (3 namespaces × 2 environments).
   - The down never names `password_login_enabled`, and guards the secret row on `value_encrypted IS NULL`.
2. In `config-authelia-sso-keys.sql` (BEGIN … ROLLBACK, `DO $$ … RAISE EXCEPTION` on a mismatch, the notify-commsgun shape):
   - Assert that the 14 global rows exist.
   - Assert that the two `ui/oidc.client_secret` rows have `is_secret` true and NULL ciphertext.
   - Re-run a copy of the 051 up statement and assert `inserted = 0 AND notified = 0`. The PREPARE body is a copy of the shipped statement; change both together.
3. The domain literals have a single consumer (this test), so they stay inline (C-13).

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
grep -n "__tests__/fixtures" src/__tests__/autheliaSsoSeedMigration.test.ts || echo "C-13: single consumer, inline"
```

---

### Step 6 — service: GetSecret grant for ui/oidc.client_secret

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/authz.ts` — modify

**Reviewers**: `xstockstrat-config` owner — secret encryption + redaction; Security — secrets decryptable only via `GetSecret` gated by the `x-internal-caller` allow-list

**Codebase Evidence**:
- `SECRET_CALLER_ALLOWLIST` is at `authz.ts:136-155`. It holds three grants, each with a `peerSan`; the last is `{callerID:'notify', namespace:'notify', keys:['commsgun.app_key'], peerSan:'xstockstrat-notify'}` at `:149-154`.
- `hasSecretCallerAuthority` (`authz.ts:178-193`) requires the `x-internal-caller` header, a matching callerID and namespace, the key, and the `peerSan`.

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. Append `{ callerID: 'ui', namespace: 'ui', keys: ['oidc.client_secret'], peerSan: 'xstockstrat-ui' }` to `SECRET_CALLER_ALLOWLIST` (product spec § Affected Services, AC-35). Change no other grant.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run lint && grep -n "callerID: 'ui'" src/grpc/authz.ts
```

---

### Step 7 — test: The ui secret grant is SAN-bound

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/secretCallerAuthz.test.ts` — modify

**Reviewers**: `xstockstrat-config` owner — secret encryption + redaction

**Codebase Evidence**:
- `secretCallerAuthz.test.ts:97-98` holds `describe('hasSecretCallerAuthority — notify grant', …)` with the `@AC-14` case. The SAN near-miss and missing-auth-context cases are at `:81-95`.

**TDD**: red-green required

**Covers**: AC-35

**Instructions**:
1. Add `describe('hasSecretCallerAuthority — ui grant (feature 345)')`, cloning the notify block, with these cases:
   - **@AC-35:** `x-internal-caller: ui` + SAN `DNS:xstockstrat-ui` → true for `('ui','oidc.client_secret')`.
   - The same with SAN `xstockstrat-agent` → false.
   - Caller `agent` → false.
   - Key `oidc.client_id` → false (not a secret grant).
   - A near-miss SAN `xstockstrat-uix` → false.
   - No header → false.
2. Redaction for `GetConfig`/`WatchConfig` is unchanged code (`@AC-2/3/14 @feature-147` PRESERVE). Add no new assertion here.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
```

---

### Step 8 — service: Password-login flag gate in AuthenticateUser

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts` — modify
- `services/xstockstrat-identity/src/telemetry.ts` — modify

**Reviewers**: `xstockstrat-identity` owner — JWT expiry and rotation; Security — auth scope correctness

**Codebase Evidence**:
- `authenticateUser` is at `identityServiceImpl.ts:150-206`. It validates fields at `:151-155` and then runs the DB query at `:156-160`.
- `ConfigWatcher.getBool(key, def)` is at `src/services/configWatcher.ts:222-226`. That file is byte-identical across services and is not edited (`scripts/check-watcher-copies.py`, recon).
- `LoginFailureReason` is at `telemetry.ts:357-362` (`'missing_fields' | 'unknown_or_inactive' | 'blocked_default_admin' | 'bad_password' | 'internal'`). `recordLoginFailure` is at `:410`.
- The config-wiring receiver `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:this.config` → `identity` already exists (`scripts/config-wiring.json:105`), so no registry edit is needed.

**Lands with**: Step 9

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. Add `'password_login_disabled'` to `LoginFailureReason` (`telemetry.ts:357-362`).
2. In `authenticateUser`, after the `missing_fields` check and **before** the `pool.query` (D-12):
   - `if (!this.config.getBool('auth.password_login_enabled', false)) { recordLoginFailure('password_login_disabled'); return callback({ code: 7, message: 'password login disabled' }); }`
   - The code default `false` is the FR-9 fail-closed default. The stored key is relative (C-05).
3. Leave the email comparison case-sensitive here. FR-3's lowercasing applies to the SSO paths only (D-49 N-3).

**Verification**:
```bash
cd services/xstockstrat-identity && pnpm run lint && node ../../scripts/check-config-wiring.mjs --keys identity.auth.password_login_enabled
```

---

### Step 9 — test: Password gate and the getBool mock fix

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/__tests__/identityServiceImpl.test.ts` — modify
- `services/xstockstrat-identity/src/__tests__/identityServiceImpl.otlp.test.ts` — modify
- `services/xstockstrat-identity/src/__tests__/identityTelemetry.test.ts` — modify
- `services/xstockstrat-identity/src/__tests__/telemetryAllowlist.test.ts` — modify

**Reviewers**: `xstockstrat-identity` owner — JWT expiry and rotation

**Codebase Evidence**:
- The config mocks have only `getInt`: `identityServiceImpl.test.ts:58,292,357,1141,1388`, `identityServiceImpl.otlp.test.ts:40`, `identityTelemetry.test.ts:13` (grep `getInt\|getBool` over `src/__tests__`).
- `telemetryAllowlist.test.ts:46` drives `telemetry.recordAuditFailure('identity.user.created')`.

**Lands with**: Step 8

**TDD**: red-green required

**Covers**: AC-16, AC-17, AC-31

**Instructions**:
1. At every mock site above, add `getBool: (k: string, d: boolean) => (k === 'auth.password_login_enabled' ? true : d)`. This keeps the existing password-login tests (`@AC-2/3/6 @feature-043`, flag-on PRESERVE) green.
2. Add these cases to `identityServiceImpl.test.ts`:
   - **@AC-16:** the flag is false → code 7 "password login disabled", **zero** `pool.query` calls, and `password_login_disabled` recorded.
   - **@AC-31:** `getBool` returns its default (the row is missing) → the same denial.
   - **@AC-17:** the flag is true → today's token pair.
3. In `telemetryAllowlist.test.ts`, drive `recordLoginFailure('password_login_disabled')` and keep the label keys closed (`@AC-22 @feature-294` PRESERVE).
4. The new literals have a single consumer and stay inline (C-13).

**Verification**:
```bash
cd services/xstockstrat-identity && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
grep -n "__tests__/fixtures" src/__tests__/identityServiceImpl.test.ts || echo "C-13: single consumer, inline"
```

---

### Step 10 — service: ResolveExternalIdentity, IssueSessionForUser and the shared mint path

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/grpc/adminDirectory.ts` — modify
- `services/xstockstrat-identity/src/grpc/externalIdentity.ts` — create
- `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts` — modify
- `services/xstockstrat-identity/src/telemetry.ts` — modify

**Reviewers**: `xstockstrat-identity` owner — JWT expiry and rotation, secret store integration; Security — JWT claims minimal, auth scope correctness

**Codebase Evidence**:
- SAN gate (`adminDirectory.ts`):
  - `peerDnsSans(call)` is module-private at `:12-19`; `ADMIN_DIRECTORY_PEER_SANS` is at `:6`.
  - `PEER_SAN_ERROR` is at `:27-30`; the gate runs before `pool.query` at `:37-40`.
  - The file comment is at `:1-2`: "No relative imports (loads under strip-types). Header-blind by design".
- Delegation precedent: `identityServiceImpl.ts:988-990` `async listAdminUserIds(call, callback) { return listAdminUserIds(this.pool, call, callback); }`.
- Mint path:
  - `authenticateUser` mints at `:185-186`: `this.mintAccessToken(user.user_id, email, user.roles)` + `this.issueRefreshToken(user.user_id)`, and builds the reply at `:189-200`.
  - `mintAccessToken` is at `:304-324`, private, claims `{user_id,email,roles,issued_at,expires_at}` plus `aud` only when given. `issueRefreshToken(userId, clientId?, db)` is at `:330-343`.
- Errors and roles:
  - `mapDbError` is at `:116-120` (`23505` → code 6 "user already exists").
  - `ROLE_ENUM_TO_STRING`, `rolesToStrings` and `stringsToRoles` are at `:33-43`.
- Audit:
  - `auditSafe(eventType, targetUserId, metadata, payload)` is at `:777-788`.
  - `AUDIT_EVENT_TYPES` (six `identity.user.*`) is at `telemetry.ts:381-388`.
- `createUser` hashes with `bcrypt.hash(password, 10)` at `:810`.
- `setUserActive` revokes every refresh token at `:962-968` (recon R-11).

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. **`adminDirectory.ts`** (D-4):
   - Add `export` to `peerDnsSans` and to its `AdminDirectoryCall` interface. Add no import and no relative import.
   - `ADMIN_DIRECTORY_PEER_SANS`, `hasAdminDirectoryPeer` and `PEER_SAN_ERROR` are unchanged (`@AC-10 @feature-242`).
2. **New `externalIdentity.ts`.** Import `peerDnsSans` from `./adminDirectory` (identity's own `tsc` build; strip-types applies only to adminDirectory). Export:
   - `EXTERNAL_IDENTITY_REFUSALS = { emailRequired: 'email required', inactive: 'account inactive', alreadyLinked: 'account already linked', ambiguous: 'ambiguous email' } as const` (D-24).
   - Two SAN lists and two `PERMISSION_DENIED` errors (D-4):
     - `RESOLVE_PEER_SANS = ['xstockstrat-ui','xstockstrat-agent']`, with "peer not authorized for ResolveExternalIdentity";
     - `ISSUE_SESSION_PEER_SANS = ['xstockstrat-ui']`, with "peer not authorized for IssueSessionForUser".
     - Exact `includes` membership, never a prefix.
   - A pure `decideExternalIdentity(classify)` implementing the D-49 N-4 table, where "linked" means linked under this issuer:
     - link + active → `LINKED_EXISTING`;
     - link + inactive → `account inactive`;
     - no link + empty email → `email required`;
     - more than one `lower(email)` match in any state → `ambiguous email`;
     - exactly one match: linked → `account already linked`; inactive → `account inactive`; otherwise → `LINK`;
     - no match → `CREATE`.
   - The **classify** SQL is one autocommit `pool.query` (D-32). Given `$1=issuer, $2=subject, $3=email`, it returns:
     - the linked row `(user_id, roles, is_active)` for `(issuer, subject)`;
     - the `lower(email)=lower($3)` match rows `(user_id, is_active, linked_under_issuer)`, with `linked_under_issuer` = `EXISTS(SELECT 1 FROM identity.external_identities e WHERE e.user_id=u.user_id AND e.issuer=$1)`.
     - JS only trims and checks for empty; lowercasing happens only in SQL (D-49 N-3).
3. **`identityServiceImpl.ts`.**
   - **`sessionResponse`.** Extract a private `sessionResponse(userId, email, roles)` = `mintAccessToken` + `issueRefreshToken(userId)` + the `:189-200` reply object.
     - `authenticateUser` calls it with its **request** `email` unchanged.
     - Claims stay byte-identical and the refresh `client_id` stays NULL (`@AC-4 @feature-265` EXTEND; D-49).
   - **`resolveExternalIdentity(call, callback)`**, in this order:
     1. The SAN gate, before any DB access. Headers are never read (FR-4).
     2. Validation: issuer and subject are non-empty, else code 3.
     3. Classify, then `decideExternalIdentity`.
     4. Refusals → `callback({code: 9, message: <detail>})`. `LINKED_EXISTING` does no write and no bcrypt (D-32).
     5. **LINK**: `INSERT INTO identity.external_identities (issuer, subject, user_id) SELECT $1, $2, u.user_id FROM identity.users u WHERE u.user_id=$3 AND u.is_active AND lower(u.email)=lower($4) AND NOT EXISTS (SELECT 1 FROM identity.external_identities e WHERE e.issuer=$1 AND (e.subject=$2 OR e.user_id=u.user_id))`. `rowCount===0` counts as a lost race (D-32, D-71).
     6. **CREATE**: first `bcrypt.hash(randomBytes(32).toString('base64url'), 10)` (D-6, D-35). Then one data-modifying CTE: `WITH u AS (INSERT INTO identity.users (email, password_hash, roles) VALUES (lower($3), $4, '{trader}') RETURNING user_id, roles, is_active) INSERT INTO identity.external_identities (issuer, subject, user_id) SELECT $1, $2, user_id FROM u RETURNING user_id`. Roles are explicit `{trader}` (D-10, FR-3).
     7. A raw `err.code === '23505'` (checked **before** `mapDbError`), or LINK `rowCount===0`, means **re-classify once** from step 3 and answer from that. A second conflict → code 13 (D-5, R-10).
     8. **Email sync** (D-19) on every success, effective only for `LINKED_EXISTING`, skipped when the email is empty:
        - `UPDATE identity.users SET email = lower($2) WHERE user_id=$1 AND lower(email)<>lower($2) AND NOT EXISTS (SELECT 1 FROM identity.users o WHERE lower(o.email)=lower($2) AND o.user_id<>$1)`, autocommit, awaited before the reply.
        - A clash (`rowCount===0` while the emails differ, or 23505) → `log.warn('email_sync_conflict', { user_id, issuer })` with no email values (FR-5, AC-9).
     9. Reply `{ userId, roles: stringsToRoles(roles), isActive, outcome }`.
     10. **Audit**, after `callback`: `void this.auditSafe('identity.external.linked' | 'identity.external.created', user_id, call.metadata, { user_id, issuer, outcome })`, only for `LINKED_BY_EMAIL` / `CREATED` (D-21; no email, no token).
     - Each statement is its own `pool.query`, so at most one client is held at a time (D-21, F-06).
   - **`issueSessionForUser(call, callback)`** (D-11, FR-4):
     - the SAN gate (ui only);
     - `SELECT user_id, email, roles, is_active FROM identity.users WHERE user_id=$1`;
     - missing → code 5 `NOT_FOUND` (D-72);
     - inactive → code 9 `account inactive`;
     - else `sessionResponse(user_id, <stored email>, roles)` (D-19: the stored email).
4. **`telemetry.ts`.** Append `'identity.external.linked'` and `'identity.external.created'` to `AUDIT_EVENT_TYPES` (`:381-388`).

**Verification**:
```bash
cd services/xstockstrat-identity && pnpm run lint && pnpm run build
grep -n "peerDnsSans" src/grpc/adminDirectory.ts src/grpc/externalIdentity.ts
grep -n "x-access-scope\|x-user-id\|x-internal-caller" src/grpc/externalIdentity.ts || echo "header-blind OK"
```

---

### Step 11 — test: Unit tests for the SAN gates, the decision table, the mint shape and the audit

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/__tests__/externalIdentity.test.ts` — create
- `services/xstockstrat-identity/src/__tests__/identityServiceImpl.test.ts` — modify
- `services/xstockstrat-identity/src/__tests__/telemetryAllowlist.test.ts` — modify
- `services/xstockstrat-identity/src/__tests__/fixtures/sanCall.ts` — create (only if a second consumer appears; see C-13 below)

**Reviewers**: `xstockstrat-identity` owner — JWT expiry and rotation

**Codebase Evidence**:
- The SAN test template is `adminDirectory.test.ts:25-30` `callWith(san?, md, noAuthContext)`, with look-alike SANs, a missing auth context, spoofed headers and zero DB queries (recon Patterns to REUSE). A fake pool records `queries` at `:14-22`.

**TDD**: red-green required

**Covers**: AC-27, AC-38, AC-9, AC-28, AC-4, AC-5, AC-7, AC-26, AC-39

**Instructions**:
1. **SAN gates** in `externalIdentity.test.ts`:
   - **@AC-27:** peer `xstockstrat-notify` with header `x-access-scope: 15` → `PERMISSION_DENIED` and zero `pool.query`. Also cover `xstockstrat-uix`, no auth context, and spoofed `x-user-id` / `x-internal-caller` → denied.
   - `xstockstrat-ui` and `xstockstrat-agent` → allowed.
   - **@AC-38:** `IssueSessionForUser` from `xstockstrat-agent` → `PERMISSION_DENIED`, zero queries, so no refresh-token INSERT.
2. **Decision table**: pure `decideExternalIdentity` rows for every D-49 N-4 branch (@AC-4 linked, @AC-5 ambiguous, @AC-7/@AC-26 inactive, @AC-39 email required, link, create, linked-existing).
3. **Refusal contract**: assert `EXTERNAL_IDENTITY_REFUSALS` equals the four literal strings (D-24; the UI mirror test is Step 25).
4. **Handler paths with a scripted fake pool**:
   - `23505` on LINK → re-classify → `LINKED_EXISTING`.
   - `mapDbError` is never called for that path.
   - **@AC-9:** email-sync `rowCount 0` → one `warn email_sync_conflict` whose detail has keys exactly `{user_id, issuer}`.
   - **@AC-28:** the audit sink rejects → the reply still succeeds and `recordAuditFailure('identity.external.linked')` is counted (`@AC-24 @feature-294` EXTEND).
   - The audit payload keys are exactly `{user_id, issuer, outcome}`.
5. **Mint shape**: a frozen-clock (`mock.timers` / `Date.now` stub) deep-equal shows `authenticateUser` and `issueSessionForUser` claims are identical in shape. Neither has `aud`, and the refresh INSERT passes `client_id` null (`@AC-4 @feature-265` EXTEND).
6. Allowlist: `telemetryAllowlist.test.ts` drives `recordAuditFailure('identity.external.created')` and asserts it is not bucketed as `other`.
7. **C-13**: if `callWith` gains a second consumer (it already lives inline in `adminDirectory.test.ts`), move it to `src/__tests__/fixtures/sanCall.ts` in this step and import it from both. Otherwise keep it inline and record that verdict.

**Verification**:
```bash
cd services/xstockstrat-identity && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
grep -n "__tests__/fixtures\|from './fixtures" src/__tests__/externalIdentity.test.ts src/__tests__/adminDirectory.test.ts
```

---

### Step 12 — test: Identity DB tier (real Postgres) and the identity-db-test CI job

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/__tests__/db/externalIdentity.db.test.ts` — create
- `services/xstockstrat-identity/package.json` — modify
- `.github/workflows/ci.yml` — modify

**Reviewers**: `xstockstrat-identity` owner — JWT expiry and rotation; DBA — index correctness, run order; Platform Lead — CI gate parity

**Codebase Evidence**:
- `services/xstockstrat-ledger/package.json:15`: `"test:db": "tsc && node --test --test-concurrency=1 dist/__tests__/db/*.test.js"`.
- `ledger/src/__tests__/db/streamResolve.db.test.ts:17-23`: `const url = process.env.LEDGER_DB_TEST_URL; before(() => { if (!url) throw new Error('LEDGER_DB_TEST_URL is required'); pool = new Pool({ connectionString: url, max: 1 }); })`.
- In `ci.yml`, the `ledger-db-test` job spans `:957-1014`: the services block, the migrator build at `:1000`, `Apply migrations` at `:1003-1008` with `SEED_USER_ID`, and `test:db` at `:1010-1014`.
- `ci-gate.needs` includes `ledger-db-test` at `:1322`; the echo line is at `:1353`.
- The changes filters are `xstockstrat-identity: ['services/xstockstrat-identity/**']` at `:62` and `migrations:` at `:88-94`.

**TDD**: red-green required

**Covers**: AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-25, AC-26, AC-28, AC-30, AC-33, AC-39, AC-50

**Instructions**:
1. **`package.json`**: add `"test:db": "tsc && node --test --test-concurrency=1 dist/__tests__/db/*.test.js"`.
   - Leave `test` / `test:coverage` unchanged; their glob `dist/__tests__/*.test.js` does not descend into `db/`.
2. **`externalIdentity.db.test.ts`**:
   - `IDENTITY_DB_TEST_URL` is required (throw when unset, D-33). `IDENTITY_DB_TEST_URL_B` is required for AC-6.
   - Drive `IdentityServiceImpl` with a real `Pool`, a fake config (`getInt` default, `getBool` true), a recording audit sink, and a call whose `getAuthContext` returns `DNS:xstockstrat-ui` or `DNS:xstockstrat-agent`.
   - Each test uses unique random emails and subjects, and cleans up its rows.
   - Cases:
     - **@AC-1**: active unlinked `alice@…` with mixed-case token email → `LINKED_BY_EMAIL`, the link row, and one `identity.external.linked` audit with no email field.
     - **@AC-2 / @AC-8**: linked subject + new email → `LINKED_EXISTING`, and the row's email becomes the lowercased new email.
     - **@AC-3**: unknown `Bob@…` → a new row with `email='bob@…'`, `roles='{trader}'`, active, and linked.
     - **@AC-4**: an email linked to another subject → code 9 `account already linked`, nothing written.
     - **@AC-5**: `dave@` + `Dave@` → `ambiguous email`, no link.
     - **@AC-7**: an inactive linked user → `account inactive`.
     - **@AC-26**: an inactive unlinked match → `account inactive`, no new row.
     - **@AC-39**: unlinked subject + empty email → `email required`, no row.
     - **@AC-9**: a clash keeps the old email and logs `email_sync_conflict`.
     - **@AC-28**: the audit sink throws → the link still commits.
     - **@AC-30**: the agent SAN + an unlinked email → `LINKED_BY_EMAIL`.
     - **@AC-33**: after `setUserActive(false)` (admin metadata), `refreshToken` with the session's refresh token is refused (UNAUTHENTICATED).
     - **@AC-25** (D-33): deterministic 23505.
       1. A blocker client runs `BEGIN; INSERT INTO identity.external_identities …` for the same `(issuer, subject)`.
       2. Start the resolve and poll `SELECT pid FROM pg_stat_activity WHERE pg_blocking_pids(pid) @> ARRAY[<blocker pid>]` until the waiter appears.
       3. `COMMIT` the blocker.
       4. Assert `LINKED_EXISTING`, exactly one user and one link.
       5. Run a sibling variant that expects `LINKED_BY_EMAIL`.
       6. Run a `Promise.all` of two resolves that asserts invariants only: one user, one link, the same `user_id`.
     - **@AC-6**: link subject `a1b2` in DB-A. Against DB-B (`IDENTITY_DB_TEST_URL_B`), with an unlinked `alice@` whose roles are `{viewer}`, resolve → `LINKED_BY_EMAIL` with roles `viewer`. DB-A's link is unchanged.
     - **@AC-50** (identity leg): delete the user's `external_identities` rows (the SQL `unlink-sso` runs, Step 13), then resolve with a new subject → `LINKED_BY_EMAIL`.
   - **R-13 contingency:** if a non-23505 error appears on the CREATE CTE, record it in the Deviation Log and switch to `BEGIN` + two INSERTs on one client (D-32).
3. **`ci.yml`**: add an `identity-db-test` job cloned from `ledger-db-test` (`:957-1014`).
   - `if:` on `xstockstrat-identity` / `migrations` / `proto` / `ci` / `node-shared`.
   - After `Apply migrations`, add a step that creates and migrates a second database for AC-6: `docker run --rm --network host --entrypoint psql xstockstrat-migrate-ci "postgres://xstockstrat:ci-only@localhost:5432/xstockstrat?sslmode=disable" -c 'CREATE DATABASE xstockstrat_b'`, then the same `Apply migrations` run with `DATABASE_URL=…/xstockstrat_b`.
   - `test:db` runs with `working-directory: services/xstockstrat-identity`, `IDENTITY_DB_TEST_URL` and `IDENTITY_DB_TEST_URL_B`.
   - Add `identity-db-test` to `ci-gate.needs` (next to `:1322`) and to the echo list (next to `:1353`).

**Verification**:
```bash
cd services/xstockstrat-identity && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
# DB tier: needs a migrated Postgres 16 (two databases). Without one, the CI identity-db-test job is the gate (block per P-03 until it is green).
IDENTITY_DB_TEST_URL=<db-a> IDENTITY_DB_TEST_URL_B=<db-b> pnpm run test:db
grep -n "identity-db-test" ../../.github/workflows/ci.yml   # job, needs, echo: 3+ hits
```

---

### Step 13 — service: manage-users.py update-email and unlink-sso

**Status**: `pending`
**Service**: `scripts/manage-users.py`
**Files**:
- `scripts/manage-users.py` — modify

**Reviewers**: `xstockstrat-identity` owner — JWT expiry and rotation; Security — auth scope correctness

**Codebase Evidence**:
- Commands are `@app.command("reset-password")` at `:165`, `create-user` at `:213`, `list-users` at `:269`, `update-roles` at `:339-412` (matches `WHERE email = %s` case-sensitively, recon) and `delete-user` at `:415`.
- `delete-user` has `--force` (`:420-422`) and a `typer.confirm` gate (`:478-485`).
- DB access is `_load_db_url()` (`:62`) with psycopg 3.
- The module docstring lists non-interactive usage (`:19-22`).

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. **`update-email <old-email> <new-email>`** (FR-12), modelled on `update-roles`:
   - Look up the user by exact `old-email`.
   - Refuse with "email already in use" and exit 1 when `SELECT 1 FROM identity.users WHERE lower(email)=lower(%s) AND user_id<>%s` finds a row.
   - Otherwise `UPDATE identity.users SET email = lower(%s) WHERE user_id = %s`. `user_id` is kept.
   - A 23505 race also maps to "email already in use", exit 1.
   - All SQL is parameterized.
2. **`unlink-sso <email> [--issuer <url>] [--force/-f]`** (D-43, D-56):
   - Look up `SELECT user_id, email FROM identity.users WHERE lower(email)=lower(%s) LIMIT 2`. 0 rows → "user not found", exit 1. 2 rows → "ambiguous email — fix with update-email", exit 1.
   - Without `--force`, `typer.confirm` the deletion. A decline exits 0 with nothing deleted, mirroring `delete-user`.
   - Run `DELETE FROM identity.external_identities WHERE user_id = %s [AND issuer = %s] RETURNING issuer, subject`. 0 rows → "no SSO link found", exit 1.
   - Print the count and the email the person must have in Authelia to relink. Never print a subject beyond the count.
3. Add both commands to the docstring usage block (`:19-22`).

**Verification**:
```bash
cd scripts && uv run --no-sync ruff check . && uv run --no-sync ruff format --check . && uv run --no-sync python manage-users.py --help | grep -E "update-email|unlink-sso"
```

---

### Step 14 — test: update-email and unlink-sso

**Status**: `pending`
**Service**: `scripts/manage-users.py`
**Files**:
- `scripts/tests/test_manage_users.py` — modify

**Reviewers**: `xstockstrat-identity` owner — JWT expiry and rotation

**Codebase Evidence**:
- `_mock_conn(execute_returns)` at `test_manage_users.py:47-61` feeds successive `fetchone` values only. `TestUpdateRolesCmd` is at `:297`. `TestSqlParameterization` is at `:446`.
- CI `scripts-python` runs `uv run --no-sync pytest` in `scripts/` (`ci.yml:862-893`).

**TDD**: red-green required

**Covers**: AC-18, AC-19, AC-50

**Instructions**:
1. Extend `_mock_conn` with an optional `fetchall_returns` list fed to `cursor.fetchall.side_effect` (D-64). The existing callers are unchanged.
2. `TestUpdateEmailCmd`:
   - **@AC-18:** the UPDATE parameter is lowercased (`Alice@Example.test` → `alice@example.test`) and `user_id` is preserved.
   - **@AC-19:** a held email → exit 1 and "email already in use", with no UPDATE executed.
   - An unknown old email → exit 1.
3. `TestUnlinkSsoCmd`:
   - **@AC-50:** with `--force`, it deletes and prints the relink email.
   - A declined confirmation deletes nothing.
   - The ambiguous `LIMIT 2` case returns the message and exit 1.
   - Zero deleted rows → exit 1.
   - `--issuer` adds `AND issuer = %s`.
4. `TestSqlParameterization`: both new commands pass every value as a parameter, never formatted into the SQL.

**Verification**:
```bash
cd scripts && uv run --no-sync ruff check . && uv run --no-sync ruff format --check . && uv run --no-sync pytest tests/test_manage_users.py -q
```

---

### Step 15 — service: Agent SSO-mode foundation (PyJWT, issuer grammar, mode, ui watcher)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/pyproject.toml` — modify
- `services/xstockstrat-agent/uv.lock` — modify
- `scripts/testdata/oidc-issuer-vectors.json` — create
- `services/xstockstrat-agent/app/sso_mode.py` — create
- `services/xstockstrat-agent/app/config/watcher.py` — modify
- `scripts/config-wiring.json` — modify
- `.github/workflows/ci.yml` — modify

**Reviewers**: `xstockstrat-agent` owner — OAuth 2.1 edge-auth correctness and statelessness; Security — auth scope correctness; Platform Lead — inter-service dependency graph (agent → config `ui` stream)

**Codebase Evidence**:
- Dependencies and the namespace list:
  - `pyproject.toml:6-22` has no JWT library. `uv.lock:932` has `name = "pyjwt"` 2.15.0, transitive via `mcp` (`:607` `{ name = "pyjwt", extra = ["crypto"] }`).
  - `watcher.py:16` `WATCHED_NAMESPACES = ("agent", "indicators")`. `read_value(namespace, key)` is at `:68-77` and returns `None` for an unwatched namespace. `ConfigWatcher.__init__` derives the environment from `resolve_scope("")` (`:31-35`).
- Config-wiring receivers:
  - `config-wiring.json` registers the forwarder `"services/xstockstrat-agent/app/config/watcher.py:read_config_value": {"keyArg": 1}` (`:42-44`) and the receivers `"services/xstockstrat-agent/app/tools.py:read_config_value": "agent"` (`:88`).
  - A Python forwarder call's receiver is the bare callee name, or `ast.unparse(func.value)` for an attribute call (`scripts/config-wiring-py-reads.py:143-147`).
  - `attribute()` maps `file:receiver` to one namespace (`check-config-wiring.mjs:546-551`).
- CI and testdata:
  - The `changes` filters are `xstockstrat-agent` at `ci.yml:59` and `xstockstrat-ui` at `ci.yml:64`; portfolio's out-of-tree entry at `:55` is the precedent.
  - `scripts/testdata/` holds `rpc-status-vectors.json` (precedent, D-66).
- The vector-file JSON is given in full in design.md (C) §1 (`:767-871`).

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. **Dependency.** Add `"pyjwt[crypto]>=2.15.0"` to `[project].dependencies` and run `uv lock` in `services/xstockstrat-agent` (D-2; root `CLAUDE.md` uv lock rule).
2. **Vector file.** Create `scripts/testdata/oidc-issuer-vectors.json` with exactly the JSON in design.md (C) §1: `issuer_pattern`, `app_url_pattern`, 66 `issuer`, 16 `app_url` and 10 `mode` rows (D-79, D-88).
3. **`app/sso_mode.py`** (D-1, D-66, D-78, D-86, D-90):
   - `ISSUER_PATTERN = r"…"`, the literal from the vector file. `_ISSUER_RE = re.compile(ISSUER_PATTERN)` with no flags.
   - `is_valid_issuer(v: object) -> bool`: `isinstance(v, str) and _ISSUER_RE.fullmatch(v) is not None`.
   - `@dataclass(frozen=True) class SsoMode: kind: Literal['legacy','sso']; valid: bool = False; agent_issuer: str = ''; reason: str = ''`.
   - `current_sso_mode() -> SsoMode`:
     - Read `agent` / `oidc.issuer` and `ui` / `oidc.issuer` from the snapshot; `None` → `""`.
     - Either empty (`== ''`, no trim) → legacy. If exactly one is set, `_log_once('warning', 'sso_mode_misconfigured', …)`.
     - Otherwise SSO. Validate the ui issuer, then the agent issuer. The first failure gives `valid=False, reason='ui_issuer'|'agent_issuer'` and `_log_once('error', 'sso_issuer_invalid', key=(reason, value), {'reason': reason})`.
   - `_log_once(level, message, key, extra)` uses a module set. Add a `_reset_log_once()` for tests (D-90).
   - **Reads, with one receiver per namespace for the wiring checker:**
     - `from app.config import watcher as agent_config` and `from app.config import watcher as ui_config`, each read through an attribute call named after the registered forwarder.
     - Concretely: add `read_config_value = read_value` at module level in `watcher.py` (an alias, no behaviour change; it also makes the existing forwarder registration `watcher.py:read_config_value` name a real symbol).
     - Then call `agent_config.read_config_value("agent", "oidc.issuer")` and `ui_config.read_config_value("ui", "oidc.issuer")`.
   - The agent has no `'error'` mode (an absent snapshot key reads as `""` = legacy, D-66).
4. **`watcher.py`.** `WATCHED_NAMESPACES = ("agent", "indicators", "ui")` (D-1).
   - Update the module docstring (`:1-4`).
   - Startup now waits for the `ui` snapshot (recon R-3); the `ui` namespace already has rows (config `023`).
5. **`config-wiring.json`.** Under `registry.receivers` add `"services/xstockstrat-agent/app/sso_mode.py:agent_config": "agent"` and `"services/xstockstrat-agent/app/sso_mode.py:ui_config": "ui"`. Add no `findings` entry (fails.md:3830-3832).
6. **`ci.yml`.** Append `'scripts/testdata/oidc-issuer-vectors.json'` to the `xstockstrat-agent` filter (`:59`) and the `xstockstrat-ui` filter (`:64`) (D-78).

**Verification**:
```bash
cd services/xstockstrat-agent && uv lock --check && uv run ruff check . && uv run ruff format --check .
python3 -c "import json;d=json.load(open('../../scripts/testdata/oidc-issuer-vectors.json'));print(len(d['issuer']),len(d['app_url']),len(d['mode']))"   # 66 16 10
cd ../.. && node scripts/check-config-wiring.mjs --keys agent.oidc.issuer,ui.oidc.issuer   # no finding for the agent reads
```

---

### Step 16 — test: Issuer vectors and SSO-mode resolution in the agent

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_oidc_issuer_vectors.py` — create
- `services/xstockstrat-agent/tests/test_sso_mode.py` — create
- `services/xstockstrat-agent/tests/conftest.py` — modify

**Reviewers**: `xstockstrat-agent` owner — OAuth 2.1 edge-auth correctness and statelessness

**Codebase Evidence**:
- The vector-load idiom is `SERVICE_DIR.parent.parent / "scripts" / "testdata" / …`, cloned from `services/xstockstrat-ingest/tests/test_telemetry.py:112-115` (design.md (B) §D-66).
- `install_watcher(monkeypatch, namespace, **values)` is at `tests/test_config_watcher.py:46-50`.
- The autouse `config_snapshots` fixture (`conftest.py:112-130`) iterates `watcher.WATCHED_NAMESPACES`, so it covers `ui` automatically.

**TDD**: red-green required

**Covers**: AC-32, AC-55

**Instructions**:
1. `test_oidc_issuer_vectors.py`:
   - Assert `sso_mode.ISSUER_PATTERN == data['issuer_pattern']` byte-for-byte.
   - Every `issuer` row gives `is_valid_issuer(value) == valid`.
   - Every `mode` row, applied through `install_watcher` on `agent`/`ui`, gives `current_sso_mode()` mapped as `sso_invalid` ⇔ `kind=='sso' and not valid`.
2. `test_sso_mode.py`:
   - **@AC-32:** ui set and agent `""` → legacy, with one WARN `sso_mode_misconfigured` across two calls (caplog).
   - **@AC-55:** ui `http://auth.example.test` with a valid agent → `kind='sso', valid=False, reason='ui_issuer'`, and exactly one ERROR `sso_issuer_invalid` per distinct `(reason, value)`.
   - A second distinct invalid value logs again.
   - Assert that `WATCHED_NAMESPACES` contains `"ui"`.
3. `conftest.py`: add an autouse fixture that calls `sso_mode._reset_log_once()` (D-90 test isolation).

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40 -q && uv run ruff check . && uv run ruff format --check .
grep -n "conftest\|install_watcher" tests/test_sso_mode.py
```

---

### Step 17 — service: Async JWKS and discovery cache (app/jwks.py)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/jwks.py` — create

**Reviewers**: `xstockstrat-agent` owner — OAuth 2.1 edge-auth correctness and statelessness; Security — auth scope correctness

**Codebase Evidence**:
- `httpx` is a direct dependency (`pyproject.toml:8`). `respx` is a dev dependency (`:21`).
- **Not found**: there is no existing async JWKS or discovery client in the repo. This module is new (recon R-2; R-1 locks out `PyJWKClient`).
- PyJWT 2.15.0 (`uv.lock:932`) provides `jwt.PyJWK`, `jwt.get_unverified_header` and `jwt.decode`. The error classes were verified at 2.15.0 (design Open Risks).

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. **Fixed invariants (F-07 comment form, D-13, D-37, D-49 N-14):**
   - `_JWKS_FRESH_S = 300` — fixed by this spec; D-13 names "JWKS fresh window" without a value. Flagged in context.md.
   - `_JWKS_COOLDOWN_S = 30`, `_JWKS_FETCH_TIMEOUT_S = 5`, `_JWKS_STALE_MAX_S = 86400`, `_JWKS_MAX_BYTES = 65536`, `_DISCOVERY_FRESH_S = 600`.
   - `_ASYMMETRIC_ALGS = frozenset({"RS256","RS384","RS512","PS256","PS384","PS512","ES256","ES384","ES512"})` — the D-2 allow-list. Membership is fixed by this spec; flagged.
2. **Discovery** (D-18, D-27, D-35, D-89): `async def discovery(issuer) -> dict`, cached separately for `_DISCOVERY_FRESH_S`.
   - GET `f"{issuer}/.well-known/openid-configuration"` with `httpx.AsyncClient(follow_redirects=False, timeout=_JWKS_FETCH_TIMEOUT_S, headers={'Accept-Encoding':'identity'})`.
   - Reject a `Content-Length` above `_JWKS_MAX_BYTES` before reading, and cap the streamed body too.
   - Require `doc['issuer'] == issuer` byte-exact and `jwks_uri` same-origin with the issuer. These checks re-run on every refetch.
   - `verify=` stays default. A loopback issuer is `http://` by grammar, so there is no TLS to skip.
3. **`class _IssuerKeys`**, one per issuer (D-31). State: `keys_by_kid: dict[str, tuple[PyJWK, str]]`, `fetched_at`, `last_attempt_at`, `last_fetch_ok`, `task`.
   - A fetch is eligible only if `task is None` and (`now - last_attempt_at >= _JWKS_COOLDOWN_S` or it was never attempted).
   - The task wraps the fetch in `asyncio.timeout(_JWKS_FETCH_TIMEOUT_S)`, is the **only** writer of the state, and has a done-callback that calls `t.exception()`, so no exception is left unretrieved.
   - **Ingest** (D-35): for each JWK, `alg = jwk.get('alg')`. Skip it with one WARN when `alg` is absent or not in `_ASYMMETRIC_ALGS`, or when `PyJWK(jwk)` raises. The fetch fails only when zero usable keys remain.
4. **`async def key_for(issuer, kid) -> tuple[PyJWK, str] | Literal['unknown_kid','unavailable']`**:
   - **Known `kid`, fresh** → the key.
   - **Known `kid`, stale ≤ `_JWKS_STALE_MAX_S`** → the key, plus a gated, non-awaited refresh.
   - **Known `kid`, older** → treat as unknown.
   - **Unknown `kid`**: if a task is eligible or running, `await asyncio.shield(task)`.
     - Found → the key.
     - The task succeeded but the `kid` is still absent → `'unknown_kid'` (401).
     - The task failed → `'unavailable'` (503).
   - **Inside the cooldown with no task**: `last_fetch_ok` and ≤ STALE_MAX → `'unknown_kid'`, else `'unavailable'` (D-71).
   - The caller's `asyncio.timeout_at` deadline (D-18) bounds the `shield` await. A deadline expiry surfaces as `TimeoutError`, which the caller maps to 503.
5. Add `_reset_for_tests()` to clear the module state.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run ruff check . && uv run ruff format --check . && uv run python -c "import app.jwks"
```

---

### Step 18 — test: JWKS state machine

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_jwks.py` — create
- `services/xstockstrat-agent/tests/conftest.py` — modify (only if a second consumer of the JWK/key fixtures appears)

**Reviewers**: `xstockstrat-agent` owner — OAuth 2.1 edge-auth correctness and statelessness

**Codebase Evidence**:
- `respx` is a dev dependency (`pyproject.toml:21`). The `HANG_GUARD_S` outer bound is at `conftest.py:20`.

**TDD**: red-green required

**Covers**: AC-61

**Instructions**:
1. Generate RSA keys with `cryptography` in the test, and mock discovery and JWKS with `respx`. Cases:
   - fresh hit;
   - stale serve + background refresh;
   - beyond STALE_MAX treated as unknown;
   - **@AC-61:** unknown `kid` + JWKS 500 → `'unavailable'`;
   - fetch ok but `kid` absent → `'unknown_kid'`;
   - the cooldown suppresses a second fetch within 30 s (the call count stays 1), and `last_fetch_ok` gives `'unknown_kid'` versus `'unavailable'`;
   - concurrent unknown-`kid` callers share one fetch;
   - discovery `issuer` with a trailing slash → reject (D-89);
   - cross-origin `jwks_uri` → reject;
   - a redirect is not followed;
   - an oversized `Content-Length` → reject;
   - an unusable key is skipped with a WARN while the others are kept;
   - a JWK without `alg` is skipped.
2. A task that fails with no awaiter leaves no "exception was never retrieved" (`loop.set_exception_handler` + `gc.collect()`, D-35).
3. The key literals have one consumer and stay inline unless Step 22 reuses them. If Step 22 reuses them, move them to `conftest.py` in Step 22 (C-13).

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40 -q && uv run ruff check . && uv run ruff format --check .
```

---

### Step 19 — service: Effective scope, the resolve client helper and the new auth-rejection reasons

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/scopes.py` — modify
- `services/xstockstrat-agent/app/tools.py` — modify
- `services/xstockstrat-agent/app/client.py` — modify
- `services/xstockstrat-agent/app/tool_metrics.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability, admin `x-access-scope` forwarded only by management tools; Security — auth scope correctness

**Codebase Evidence**:
- Scope bits and stamping:
  - `scopes.py:33-36` holds the private bits `_READ/_WRITE/_ADMIN/_TRADING`. `roles_to_access_scope` is at `:39-56`; `MCP_CLAIMS_SCOPE_KEY` is at `:18`.
  - `tools.py:146` `return roles_to_access_scope(claims.get("roles"))` (in `_caller_access_scope`, `:137`).
  - `tools.py:216` `roles_to_access_scope(claims.get("roles")),` (in `CallerPropagationMiddleware.__call__`, `:209-224`). These are the two sites (recon R-1, C-10).
- Identity client:
  - `client.py:1572-1590` `validate_token` opens `mtls.secure_channel(IDENTITY_ENDPOINT, "xstockstrat-identity")` and calls `stub.ValidateToken(…, metadata=_metadata(), timeout=_RPC_TIMEOUT_S)`.
  - `_RPC_TIMEOUT_S = 10.0` is at `:44`.
- `tool_metrics.py:39-42` `record_auth_rejected` lists `missing_bearer | wrong_audience | identity_unavailable | invalid_token | internal_error`.

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. **`scopes.py`** (D-3, D-95):
   - `_OAUTH_SCOPE_BITS = {"xstockstrat.read": _READ, "xstockstrat.write": _WRITE, "xstockstrat.admin": _ADMIN, "xstockstrat.trade": _TRADING}`.
   - `MCP_SCOPES_SUPPORTED = ("xstockstrat.read", "xstockstrat.write", "xstockstrat.admin", "xstockstrat.trade")`.
   - `granted_scopes(payload) -> set[str]`: `scp` when it is a `list` of `str`; else a space-split `scope` when it is a `str`; else an empty set.
   - `scopes_to_mask(scopes) -> int`. Unknown scopes contribute 0.
   - `effective_access_scope(claims) -> int`: `claims["access_scope"]` when present (SSO), else `roles_to_access_scope(claims.get("roles"))` (legacy claims never carry `access_scope`).
2. **`tools.py`**: replace both sites (`:146`, `:216`) with `effective_access_scope(claims)`, and update the import at `:78`.
3. **`client.py`**: add `async def resolve_external_identity(issuer, subject, email, *, trace_id: str, timeout_s: float) -> dict` next to `validate_token`.
   - It uses its own `mtls.secure_channel(IDENTITY_ENDPOINT, "xstockstrat-identity")` (AGENT-1) and a lazy `gen.identity` import (AGENT-2).
   - It sends `metadata=[("x-trace-id", trace_id)]`: a pre-auth call carries the trace id only (C-03 per design; the caller identity does not exist yet).
   - It passes `timeout=timeout_s` (`@AC-10 @feature-273`).
   - It returns `{user_id, roles: [role names], is_active, outcome}`, mapping `Role` enum values to `admin`/`trader`/`viewer` like identity's `ROLE_ENUM_TO_STRING`.
   - `grpc.aio.AioRpcError` propagates to the caller.
4. **`tool_metrics.py`**: extend the `record_auth_rejected` docstring set with `jwks_unavailable | account_refused` (D-42).

**Verification**:
```bash
cd services/xstockstrat-agent && uv run ruff check . && uv run ruff format --check . && grep -n "effective_access_scope" app/tools.py   # 2 call sites + import
grep -n "x-trace-id\|timeout=" app/client.py | grep -n "resolve" || grep -n "def resolve_external_identity" -A20 app/client.py | grep -E "trace|timeout"
```

---

### Step 20 — test: Scope narrowing at both sites, the resolve helper and the telemetry allow-list

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_sso_scope.py` — create
- `services/xstockstrat-agent/tests/test_telemetry_allowlist.py` — modify
- `services/xstockstrat-agent/tests/test_client_deadlines.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability

**Codebase Evidence**:
- `conftest.py:15-17` holds the `ADMIN`/`TRADER`/`VIEWER` claim sets; `_ctx(claims)` is at `:23-33`.
- `test_telemetry_allowlist.py:37-42` `_drive()` calls `record_auth_rejected("missing_bearer")`.
- `test_client_deadlines.py` is the per-RPC deadline net (`@AC-10 @feature-273`).

**TDD**: red-green required

**Covers**: AC-12, AC-13, AC-22

**Instructions**:
1. `test_sso_scope.py`:
   - **@AC-12:** trader roles (11) & `scp=["xstockstrat.read"]` → 1, with neither 0x02 nor 0x08.
   - **@AC-13:** viewer & all four scopes → 1.
   - **@AC-22:** trader & `read write` → 3.
   - A `scope` string fallback gives the same results as `scp`. Neither → 0. A non-list `scp` → falls back.
   - Both sites honour a stamped `access_scope`: `_caller_access_scope(_ctx({...,'access_scope':1}))` → 1, and `CallerPropagationMiddleware` binds `access_scope` 1 through `client.set_caller`.
   - A legacy claim without `access_scope` keeps `roles_to_access_scope` (`@AC-1..9 @feature-183` PRESERVE).
2. `test_telemetry_allowlist.py`: `_drive()` adds `record_auth_rejected("jwks_unavailable")` and `("account_refused")`; the key set stays closed.
3. `test_client_deadlines.py`: `resolve_external_identity` passes `timeout=` and `x-trace-id`.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40 -q && uv run ruff check . && uv run ruff format --check .
grep -n "from tests.conftest import\|conftest" tests/test_sso_scope.py
```

---

### Step 21 — service: SSO token validator, role cache, the 401/403/503 map and mode-gated routes

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/sso_auth.py` — create
- `services/xstockstrat-agent/app/main.py` — modify
- `services/xstockstrat-agent/app/oauth_metadata.py` — modify

**Reviewers**: `xstockstrat-agent` owner — OAuth 2.1 edge-auth correctness and statelessness (`instance_count > 1` safe), MCP tool contract stability; Security — JWT claims minimal, auth scope correctness

**Codebase Evidence**:
- `main.py`:
  - `_authorized(scope)` is at `:154-177`: it parses `Bearer`, returns False with `record_auth_rejected("missing_bearer")`, calls `validate_bearer_claims`, and stamps `scope["state"][MCP_CLAIMS_SCOPE_KEY] = claims`.
  - `_send_unauthorized` (`:179-190`) sends WWW-Authenticate `resource_metadata="{AGENT_PUBLIC_URL}/.well-known/oauth-protected-resource"`.
  - `_send_identity_unavailable` (`:192-196`) sends 503 text/plain with no WWW-Authenticate.
  - `handle_mcp` is at `:209-237`. The route table is at `:250-267`: `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`, `/oauth/{register,authorize,callback,token}`, `/api/tools`, and `Mount("/", handle_mcp)` last.
- `oauth_metadata.py:16` reads `AGENT_PUBLIC_URL` at import (AGENT-8). `protected_resource_metadata` (`:19-26`) returns `{resource, authorization_servers:[AGENT_PUBLIC_URL]}`; `authorization_server_metadata` is at `:29-41`.
- `auth.py:27` `IDENTITY_UNAVAILABLE = object()`. FR-8 says this sentinel is **not** reused for SSO.
- `_new_trace_id()` is at `tools.py:181-183`.

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. **`app/sso_auth.py`** (new). Import `AGENT_PUBLIC_URL` from `app.oauth_metadata`; add no fifth independent env read (AGENT-8).
   - Fixed invariants: `_ROLE_TTL_S = 60.0` and `_CLOCK_SKEW_S = 30` (F-07 form, D-13, D-37).
   - `class SsoOutcome(enum.Enum)`: `OK`, `UNAUTHORIZED`, `FORBIDDEN`, `UNAVAILABLE`, `INTERNAL`, plus `@dataclass Verdict(outcome, claims: dict | None)`. This is an explicit refusal, not a truthy sentinel (FR-8).
   - **`_precheck(token, agent_issuer) -> str | None`**: exactly design.md (C) §5 (D-84), plus the D-95 `typ` check: `str(header.get("typ","")).lower() == "at+jwt"`, else None.
   - **`async def authenticate(token, mode, trace_id) -> Verdict`**:
     1. `kid = _precheck(...)`. None → `record_auth_rejected("invalid_token")`, UNAUTHORIZED. This runs outside the deadline (D-69 step 3).
     2. `deadline = loop.time() + client._RPC_TIMEOUT_S`, then `async with asyncio.timeout_at(deadline):` (D-18):
        - a. `await jwks.discovery(mode.agent_issuer)`.
        - b. `jwks.key_for(...)`: `'unknown_kid'` → 401 `invalid_token`; `'unavailable'` → `record_auth_rejected("jwks_unavailable")`, UNAVAILABLE.
        - c. `jwt.decode(token, key, algorithms=[jwk_alg], audience=AGENT_PUBLIC_URL, issuer=mode.agent_issuer, leeway=_CLOCK_SKEW_S, options={"require":["exp","iss","aud","sub"]})`.
          - Then, inside the same `try`, a strict `int(exp) > time.time()` check, then `aud == X or aud == [X]` byte-exact (D-26; R-11 locks out `strict_aud`), then `isinstance(sub, str) and sub`.
          - Any `jwt.InvalidTokenError` / `ValueError` / `TypeError` here → 401 `invalid_token`. A wrong `aud` → `record_auth_rejected("wrong_audience")`.
        - d. **Role cache** `_cache[(iss, sub)] = (monotonic_expiry, user_id, roles)`. It holds successes only and is never served stale (D-49 N-6, FR-8). On a miss, call `client.resolve_external_identity(iss, sub, payload.get("email") or "", trace_id=trace_id, timeout_s=max(0.0, deadline - loop.time()))`.
          - `FAILED_PRECONDITION` → `record_auth_rejected("account_refused")`, FORBIDDEN.
          - `UNAVAILABLE` / `DEADLINE_EXCEEDED` → `record_auth_rejected("identity_unavailable")`, UNAVAILABLE.
          - Any other `AioRpcError` → INTERNAL.
          - On success, cache the result only when `is_active`.
     3. A `TimeoutError` (the overall deadline) → `identity_unavailable`, UNAVAILABLE. Any other exception → `record_auth_rejected("internal_error")`, one `log.error` naming `type(e).__name__`, INTERNAL (D-17).
     4. On OK, the claims are `{user_id, roles, access_scope: roles_to_access_scope(roles) & scopes_to_mask(granted_scopes(payload)), aud, trace_id}`, with **no** `email` and no `sub` (D-3, R-6).
   - Never log the token or the `email` claim (FR-2).
   - `_reset_for_tests()` clears `_cache`.
2. **`main.py`** (D-1, D-10, D-17, D-69, D-78):
   - In `_authorized`, call `mode = current_sso_mode()` first:
     - **legacy**: today's code, byte-identical (`@AC-19 @feature-294` PRESERVE).
     - **SSO and `not mode.valid`**: return an "invalid config" verdict **before** the bearer check.
     - **SSO and valid**: missing bearer → 401 as today (`:164-166`); otherwise `trace_id = _new_trace_id()` and `sso_auth.authenticate`. On OK, stamp the claims exactly as today (`:174-176`).
   - Map verdicts in `handle_mcp`:
     - UNAUTHORIZED → `_send_unauthorized`;
     - FORBIDDEN → a new `_send_forbidden` (403 text/plain, no WWW-Authenticate, no backend RPC);
     - UNAVAILABLE / INTERNAL / invalid config → `_send_identity_unavailable` (503, no WWW-Authenticate; AC-55, AC-61).
   - **Gate the legacy routes.** In SSO mode, `/oauth/{register,authorize,callback,token}` and `/.well-known/oauth-authorization-server` answer 404. Wrap each endpoint in a small `_legacy_only(endpoint)` that checks `current_sso_mode().kind == 'sso'` per request. In legacy mode the endpoints are called unchanged (byte-identical).
3. **`oauth_metadata.py`** (D-10, D-78):
   - `protected_resource_metadata` legacy: unchanged.
   - SSO valid: `JSONResponse({"resource": AGENT_PUBLIC_URL, "authorization_servers": [mode.agent_issuer], "scopes_supported": list(MCP_SCOPES_SUPPORTED)})`.
   - SSO invalid: `Response(status_code=503, headers={"Cache-Control": "no-store"})`.
   - `authorization_server_metadata` is unchanged (the 404 comes from the `_legacy_only` wrap in `main.py`).

**Verification**:
```bash
cd services/xstockstrat-agent && uv run ruff check . && uv run ruff format --check . && uv run pytest tests/test_oauth.py tests/test_streamable_http_auth.py tests/test_auth_deadline.py -q   # legacy regression net stays green
grep -n "x-trace-id" app/client.py | head -3   # resolve carries the trace id (C-03)
```

---

### Step 22 — test: Agent SSO auth end-to-end (status map, deadline, routes, metadata)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_sso_auth.py` — create
- `services/xstockstrat-agent/tests/test_sso_auth_deadline.py` — create
- `services/xstockstrat-agent/tests/test_sso_routes.py` — create
- `services/xstockstrat-agent/tests/conftest.py` — modify

**Reviewers**: `xstockstrat-agent` owner — OAuth 2.1 edge-auth correctness and statelessness, MCP tool contract stability

**Codebase Evidence**:
- The end-to-end template is `test_streamable_http_auth.py:37-60`: `TestClient(_app())` with `patch("app.auth.validate_bearer_claims", …)` and an SSE `data:` parse.
- The deadline template is `test_auth_deadline.py:51,62,89`: `test_ac11_stalled_identity_returns_503_without_www_authenticate`, `…_valid_token_stamps_the_same_trace_id…` and `…_invalid_token_still_401…`.
- The legacy net is `tests/test_oauth.py` (`@AC-42` legacy).
- `install_watcher` is at `test_config_watcher.py:46`.

**TDD**: red-green required

**Covers**: AC-10, AC-11, AC-14, AC-15, AC-21, AC-22, AC-23, AC-30, AC-32, AC-37, AC-40, AC-42, AC-43, AC-44, AC-55, AC-61

**Instructions**:
1. **`conftest.py`** (C-13):
   - Add an `sso_keys` fixture: an RSA key pair, a JWKS, and a `mint(**claims)` token builder with `kid`, `typ=at+jwt` and RS256.
   - Add `sso_mode_on(monkeypatch)`, which installs `agent`/`ui` issuer watchers and respx-mocks discovery and JWKS.
   - These have at least two consumers (the three new files), so they belong in `conftest.py`.
   - Reset `sso_auth`/`jwks` state per test.
2. **`test_sso_auth.py`** (unit level, `client.resolve_external_identity` mocked):
   - **@AC-10:** `aud` = a webhooks URL → 401.
   - **@AC-23**, one case per row: foreign `iss`, expired, foreign signature, identity HS256 → 401.
     - Rows 1 and 4 stay 401 while the JWKS mock raises, and the fetch is never awaited (D-69).
   - D-84 rows: non-JSON payload, `[1]` payload, list `alg`, integer `kid`, missing `kid` → 401.
   - `sub` `""` or `123` → 401. Missing `exp`/`aud`/`sub` → 401. `typ` other than `at+jwt` → 401.
   - `aud` `"X"` and `["X"]` both pass.
   - **@AC-21 / @AC-37 / @AC-40:** resolve `FAILED_PRECONDITION` → FORBIDDEN, metric `account_refused`, and no backend RPC.
   - **@AC-14:** with a fake monotonic clock, the cache hit at +55 s forwards the old scope and +61 s re-resolves the new roles.
   - **@AC-15:** cached at t0, identity `UNAVAILABLE` after expiry → UNAVAILABLE.
   - A deactivated user (`is_active` false) is not cached.
   - **@AC-61:** an unknown `kid` with the JWKS unreachable → UNAVAILABLE and `jwks_unavailable`.
   - Logs never contain the token or the email (caplog with a sentinel email).
3. **`test_sso_auth_deadline.py`**: clone `test_auth_deadline.py:51-100` for SSO.
   - A stalled resolve → 503 without WWW-Authenticate within 10.5 s and the same `x-trace-id` (`@AC-11 @feature-273` EXTEND).
   - A pre-check reject consumes no budget.
4. **`test_sso_routes.py`** (`TestClient(build_http_app())`):
   - **@AC-22 / @AC-30:** a valid token calls `list_strategies`, and the backend metadata carries the resolved `x-user-id` (never `sub`) and `x-access-scope` 3 (or 1 for the AC-30 viewer).
   - **@AC-11:** in SSO mode the PRM equals `{"resource": AGENT_PUBLIC_URL, "authorization_servers": [issuer], "scopes_supported": ["xstockstrat.read","xstockstrat.write","xstockstrat.admin","xstockstrat.trade"]}`, pinned whole. The UI side of this contract is Step 37 (D-55).
   - **@AC-43:** `/oauth/register` → 404, and an identity-minted HS256 token on MCP → 401.
   - **@AC-55:** ui `http://auth.example.test` → any bearer → 503 with no WWW-Authenticate, and the PRM → 503 `no-store`.
   - **@AC-32 / @AC-42 / @AC-44:** half-configured or cleared issuers → legacy. `validate_bearer_claims` is used, the `aud`-bound identity token is accepted, and `/oauth/register` is routed. The existing `test_oauth.py` stays green.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40 -q && uv run ruff check . && uv run ruff format --check .
grep -n "def sso_keys\|def sso_mode_on" tests/conftest.py
```

---

### Step 23 — service: UI typecheck script and CI step

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/package.json` — modify
- `.github/workflows/ci.yml` — modify
- `services/xstockstrat-ui/src/**` — modify (only files with pre-existing type errors the first run reports; list them in the Deviation Log)

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety

**Codebase Evidence**:
- `package.json` scripts (`:6-19`) have no `typecheck`.
- `tsconfig.json` has `"noEmit": true` and `"include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"]` (`:20-21`), so test files are type-checked.
- The `node-test` matrix entry for `xstockstrat-ui` is at `ci.yml:745-773`. Its steps are install (`:784-785`), proto build (`:787-788`) and `test with coverage` (`:790-792`).
- **Ledger trap** (insights.md:2948): a bare `tsc --noEmit` can false-RED on a Next app because `.next/types` exists only after `next build`. D-93 still chooses `tsc`. Verify at execute whether the first run reports `.next/types`-related errors. If it does, run `next build` first in the CI step, or drop `.next/types/**/*.ts` from the typecheck. Record the choice in the Deviation Log.

**TDD**: N/A (tooling gate; its RED proof is the D-83 `@ts-expect-error` removal in Step 31)

**Covers**: —

**Instructions**:
1. Add `"typecheck": "tsc --noEmit"` to `services/xstockstrat-ui/package.json` (D-93).
2. In `node-test`, add a step `- name: typecheck (xstockstrat-ui)`, `if: matrix.service == 'xstockstrat-ui'`, `working-directory: services/xstockstrat-ui`, `run: pnpm run typecheck`. It goes **before** `test with coverage`.
3. Run it once. Fix every pre-existing error in the same PR (owner-accepted widening, D-93), with no `@ts-ignore`. List each touched file in the Deviation Log (F-08: the files are covered by the `src/**` entry).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm install --frozen-lockfile=false && pnpm --filter @xstockstrat/proto run build && pnpm run typecheck && pnpm run lint
```

---

### Step 24 — service: UI leaf modules (issuer grammar, Origin check, safe redirect, refusal mirror, deadlines, log-once)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/oidcIssuer.ts` — create
- `services/xstockstrat-ui/src/lib/sameOrigin.ts` — create
- `services/xstockstrat-ui/src/lib/safeRedirect.ts` — create
- `services/xstockstrat-ui/src/lib/ssoRefusals.ts` — create
- `services/xstockstrat-ui/src/lib/deadlines.ts` — modify
- `services/xstockstrat-ui/src/lib/serverLog.ts` — modify
- `services/xstockstrat-ui/src/lib/headers.ts` — modify
- `services/xstockstrat-ui/src/app/auth/login/page.tsx` — modify (import the extracted `safeRedirect`)

**Reviewers**: `xstockstrat-ui` owner — no secret values rendered in UI, Connect-RPC call safety; Security — auth scope correctness

**Codebase Evidence**:
- `src/app/auth/login/page.tsx:7-18` holds the local `safeRedirect(target)` (allow-list `/trader` / `/insights` / `/config-ui`, else `/trader`).
- `deadlines.ts:1-14` is a leaf module ("Leaf module (no imports)") with `REFRESH_TIMEOUT_MS = 10_000` at `:3`.
- `serverLog.ts:37-41` `export const serverLog = { info, warn, error }`.
- `headers.ts:5-7` holds `HEADER_USER_ID`, `HEADER_ACCESS_SCOPE`, `HEADER_TRACE_ID`. **Not found**: no UI constant for `x-internal-caller` (recon R-9). The config side is `HEADER_INTERNAL_CALLER='x-internal-caller'` at `services/xstockstrat-config/src/grpc/authz.ts:74`.
- The vector file is `scripts/testdata/oidc-issuer-vectors.json` (Step 15).

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. **`oidcIssuer.ts`** (D-79, D-88, design.md (C) §1):
   - Export `ISSUER_PATTERN` and `APP_URL_PATTERN` as `String.raw` literals equal to the JSON.
   - `const ISSUER_RE = new RegExp(ISSUER_PATTERN)` with no flags.
   - `isValidIssuer(v)` is the regex plus the `new URL` round-trip from design.md (C) §1.
2. **`sameOrigin.ts`** (D-68, D-77, D-81, D-86). It imports only `serverLog` and `oidcIssuer`:
   - `parseAppOrigin(raw)`: `typeof raw==='string' && APP_URL_RE.test(raw) && new URL(raw).origin===raw ? raw : null`.
   - `appOrigin()`: `parseAppOrigin(process.env.APP_URL)`. On null, `logOnce('error','app_url_invalid', 'app_url\0'+(APP_URL ?? '<unset>'), {reason:'app_url'})`, unset included (D-86).
   - `isSameOrigin(req, policy, origin = appOrigin())`, with the `required` / `if_present` semantics in design.md (B) §D-68.
   - `originHost(h)` per design.md (C) §2.
3. **`safeRedirect.ts`**: move `safeRedirect` from `login/page.tsx:8-18` verbatim and import it in `page.tsx`. The behaviour is unchanged (D-46).
4. **`ssoRefusals.ts`** (D-24):
   - `SSO_REFUSAL_DETAILS = { 'email required': 'no_email', 'account inactive': 'inactive', 'account already linked': 'linked', 'ambiguous email': 'ambiguous' } as const`. The keys are identity's `EXTERNAL_IDENTITY_REFUSALS` values.
   - Export a `refusalCode(detail): SsoErrorCode | null` mapper. To keep this leaf import-free, type the return as the string-literal union; Step 30 types it with `SsoErrorCode`.
5. **`deadlines.ts`** (D-47, D-61; it stays a leaf):
   - `AUTH_CONFIG_TIMEOUT_MS = 10_000`, with a 2-line F-07 constraint comment.
   - `OIDC_TIMEOUT_S = 10` and `OIDC_DISCOVERY_FRESH_S = 600` (D-37, D-70).
   - `OIDC_ID_TOKEN_ALG = 'RS256'` (D-37; spike-confirmed RS256).
   - `raceDeadline<T>(p: Promise<T>, ms: number): Promise<T>`, which rejects on timeout and clears its own timer in `finally`.
6. **`serverLog.ts`** (D-90): add `export function logOnce(level: 'warn'|'error', message: string, key: string, detail?: Record<string,string>)` over a module `Set`, plus `__resetLogOnce()` for tests.
7. **`headers.ts`**: add `export const HEADER_INTERNAL_CALLER = 'x-internal-caller';`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint
grep -n "safeRedirect" src/app/auth/login/page.tsx src/lib/safeRedirect.ts
```

---

### Step 25 — test: UI leaf-module unit tests (vectors, Origin, redirect, refusal mirror, deadline)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/__tests__/oidcIssuerVectors.test.ts` — create
- `services/xstockstrat-ui/src/lib/sameOrigin.test.ts` — create
- `services/xstockstrat-ui/src/lib/safeRedirect.test.ts` — create
- `services/xstockstrat-ui/src/lib/ssoRefusals.test.ts` — create
- `services/xstockstrat-ui/src/lib/deadlines.test.ts` — create
- `services/xstockstrat-ui/src/lib/serverLog.test.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety

**Codebase Evidence**:
- The vector-load idiom is `fileURLToPath(new URL('../../../../../scripts/testdata/oidc-issuer-vectors.json', import.meta.url))`; `vitest.config.ts:16` uses `import.meta.url` (design.md (B) §D-66).
- `vitest.config.ts:18-20` uses the node environment and `include: ['src/**/*.test.ts']`. Coverage covers `src/lib/**` with a threshold of 40 (`:22-35`).
- `serverLog.test.ts` exists.

**TDD**: red-green required

**Covers**: AC-54, AC-57, AC-58, AC-59

**Instructions**:
1. `oidcIssuerVectors.test.ts`:
   - Each pattern constant equals its JSON literal.
   - Every `issuer` row gives `isValidIssuer === valid`, and `ISSUER_RE.test(v) === isValidIssuer(v)` (the round-trip never changes an outcome).
   - Every `app_url` row gives `parseAppOrigin(value ?? undefined) === origin`.
   - Assert the row counts 66/16/10.
2. `sameOrigin.test.ts`, with `vi.stubEnv('APP_URL', …)`:
   - `required`: missing, `null`, matching, other port, other scheme, `appOrigin` null.
   - `if_present`: absent, matching, sibling `https://dashboard.example.test` (@AC-57), `null`, and `appOrigin` null with a sibling header → true (@AC-58).
   - Unset or invalid `APP_URL` → one ERROR `app_url_invalid` (logOnce) for repeated calls.
   - @AC-59: no Origin under `required` → false.
3. `safeRedirect.test.ts`: today's allow-list, plus `/trader/../..//evil.com` (D-54, D-71). Pin that case to whatever the current function returns; the behaviour is unchanged.
4. `ssoRefusals.test.ts`: the map keys equal the four identity literals (D-24 contract; the identity side is Step 11).
5. `deadlines.test.ts`: `raceDeadline` rejects after `ms` (fake timers), resolves when earlier, and clears its timer (`vi.getTimerCount() === 0`).
6. `serverLog.test.ts`: `logOnce` emits once per key and `__resetLogOnce` resets it.
7. **C-12**: these are scenario one-offs (issuer strings, origins) with no domain object, so they are exempt from the fixture inventory. State this in the test file header comment.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint && pnpm run test:coverage
```

---

### Step 26 — service: Server-side config reads (oidcConfig.ts) and the MCP scope list

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/oidcConfig.ts` — create
- `services/xstockstrat-ui/src/lib/mcpScopes.ts` — create
- `scripts/config-wiring.json` — modify

**Reviewers**: `xstockstrat-ui` owner — environment (`production`/`staging`) scope correctness, no secret values rendered in UI; Security — secrets via `GetSecret` only

**Codebase Evidence**:
- `connectClients.ts:109` `configClient`. Its transport defaults the timeout to `DEFAULT_UNARY_TIMEOUT_MS` unless one is passed (`:66-74`).
- `deploymentEnv.ts:13-16` `nativeConfigEnvironment()`. The BFF precedent `insightsBff.ts:173-174` is `configClient.getConfig({ ...req, environment: nativeConfigEnvironment() }, opts)`.
- `config.proto:103-108` `GetConfigRequest{namespace, environment, user_id}`; `:49-53` `ConfigSnapshot.values map<string, ConfigValue>`; `:110-120` `GetSecretRequest{namespace,key,environment,user_id}` / `GetSecretResponse{value, found}`.
- Config `CLAUDE.md` invariant 5: reads by a header-less caller keep the body `user_id`. Global = `''`.
- Wiring: the TS index read `values[...]` has receiver `receiverBefore(src, m.index, 'values')` (`check-config-wiring.mjs:472`). Receivers map `file:receiver` → namespace (`:546-551`). The precedent is `"services/xstockstrat-ui/src/lib/indicatorChart.ts:values": "ui"` (`config-wiring.json:141`).
- `services/xstockstrat-ui/CLAUDE.md` § Config Keys Consumed: "Values are read with an oneof-presence check (never `value || default`)".

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. **`oidcConfig.ts`** (D-22, D-27, D-39, D-47, D-66, D-78). All reads:
   - are header-less (no `x-user-id`), with `user_id: ''`;
   - pass `environment: nativeConfigEnvironment()` and `{ timeoutMs: AUTH_CONFIG_TIMEOUT_MS }`;
   - read values through a oneof-presence check.
2. Export the `OidcConfigResult` discriminated union exactly as in design.md (B) §D-66.
3. **`loadOidcConfig()`**:
   - `Promise.all` of `getConfig({namespace:'ui'})` and `getConfig({namespace:'agent'})`. Bind each snapshot to its own receiver: `const ui = …; ui.values['oidc.issuer']`, `const agent = …; agent.values['oidc.issuer']`.
   - Any rejection → `{mode:'error'}`.
   - Either issuer `''` → `'legacy'`. If exactly one is set, `logOnce('warn','sso_mode_misconfigured', …)`.
   - Otherwise validate `isValidIssuer(ui)`, then `isValidIssuer(agent)`, then `appOrigin()`.
     - An issuer failure → `logOnce('error','sso_issuer_invalid', reason+'\0'+value, {reason})`.
     - An `app_url` failure logs only through `appOrigin()` (D-86).
   - Return `valid:false, reason`, or `valid:true` with `issuer`, `clientId` (`ui.values['oidc.client_id']`), `agentIssuer` and `appOrigin`.
   - Both variants carry `mcpClientId` / `mcpClientIdReadonly`, from `ui.values['oidc.mcp_client_id']` / `['oidc.mcp_client_id_readonly']`, default `''`.
4. **`loadPasswordLoginEnabled()`**: `getConfig({namespace:'identity'})`, `const identity = …; identity.values['auth.password_login_enabled']`, oneof `boolVal`, default `false` (FR-9). A rejection propagates so the page can treat it as `'error'`.
5. **`loadOidcClientSecret()`**:
   - `configClient.getSecret({namespace:'ui', key:'oidc.client_secret', environment, userId:''}, {timeoutMs: AUTH_CONFIG_TIMEOUT_MS, headers: {[HEADER_INTERNAL_CALLER]: 'ui'}})`.
   - `found=false` or an empty value → `null`, which means `not_configured` (D-41, R-15).
   - Never log the value.
6. **`mcpScopes.ts`**: `export const MCP_SCOPES_SUPPORTED = ['xstockstrat.read','xstockstrat.write','xstockstrat.admin','xstockstrat.trade'] as const;` (D-38).
7. **`config-wiring.json`** `registry.receivers`: add `"services/xstockstrat-ui/src/lib/oidcConfig.ts:ui.values": "ui"`, `"…:agent.values": "agent"` and `"…:identity.values": "identity"`. Each binding resolves one namespace (product spec § Config Key Changes). No `findings` entries.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint
cd ../.. && node scripts/check-config-wiring.mjs --declared-from docs/roadmap/features/345-authelia-sso/product-spec.md   # every declared key either clean or PENDING; no prefixed-read/unattributed
```

---

### Step 27 — test: oidcConfig mode, validity, environment and secret behaviour

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/oidcConfig.test.ts` — create

**Reviewers**: `xstockstrat-ui` owner — environment (`production`/`staging`) scope correctness

**Codebase Evidence**:
- The `vi.mock('@/lib/connectClients')` pattern is used by existing BFF unit tests (`src/lib/__tests__/insightsBff.test.ts`).
- The mode rows are in `scripts/testdata/oidc-issuer-vectors.json` `mode[]` (Step 15).

**TDD**: red-green required

**Covers**: AC-32, AC-46, AC-54, AC-60

**Instructions**:
1. Mock `configClient.getConfig` / `getSecret`. Cases:
   - Every vector `mode` row with `APP_URL=http://localhost:3000` → `legacy` / `sso` valid / `sso` invalid.
   - **@AC-32:** half-configured → legacy and one WARN `sso_mode_misconfigured`.
   - **@AC-46 / @AC-60:** a `getConfig` rejection or timeout → `{mode:'error'}`.
   - **@AC-54:** ui `http://auth.example.test` → `valid:false, reason:'ui_issuer'` and one ERROR `sso_issuer_invalid`.
   - An invalid `APP_URL` → `reason:'app_url'` with exactly one ERROR, `app_url_invalid` (no `sso_issuer_invalid`).
   - Every call passes `environment: Environment.PRODUCTION` when `APPLICATION_ENV=production` (D-39), `userId: ''`, no `x-user-id` header, and `timeoutMs: 10_000`.
   - `getSecret` sends `x-internal-caller: ui`. `found:false` → null, and `''` → null.
   - The flag defaults to `false` when the row is absent.
   - A stored `false` is read as false, not as the default (oneof presence).
2. These are scenario one-offs (config snapshots), so they stay inline and are exempt from C-12. Say so in the file header.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint && pnpm run test:coverage
```

---

### Step 28 — service: openid-client wiring, the Configuration cache and the logout URL builders

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/package.json` — modify
- `pnpm-lock.yaml` — modify
- `services/xstockstrat-ui/src/lib/oidcClient.ts` — create
- `services/xstockstrat-ui/src/lib/ssoLogout.ts` — create

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety, no secret values rendered in UI; Security — JWT claims minimal

**Codebase Evidence**:
- `package.json` has `"jose": "^5.0.0"` and `"next": "^15.5.28"`. **Not found**: no OIDC client library (recon).
- The openid-client 6.8.9 API (`discovery`, `ClientSecretBasic`, `enableNonRepudiationChecks`, `allowInsecureRequests`, `randomState` / `randomNonce` / `randomPKCECodeVerifier` / `calculatePKCECodeChallenge`, `buildAuthorizationUrl`, `authorizationCodeGrant`, `buildEndSessionUrl`) was verified by the orchestrator (D-29, D-34, D-89).
- The root lockfile is used by the Dockerfiles (insights.md:2948-2955: "all leaf Dockerfiles use the ROOT lock").
- `next.config.js` emits `output: 'standalone'` (UI `CLAUDE.md` § Docker Build Pattern).

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. Add `"openid-client": "6.8.9"` (an exact pin, D-34) to the UI's dependencies. Run `pnpm install` at the root and commit `pnpm-lock.yaml`.
2. **`oidcClient.ts`** (D-29, D-34, D-65, D-70, D-87, D-89):
   - A single slot keyed `${issuer}\n${clientId}\n${sha256(secret)}`, with TTL `OIDC_DISCOVERY_FRESH_S` (design.md (B) §D-70).
   - `getOidcConfiguration(issuer, clientId, secret)` calls `discovery(new URL(issuer), clientId, { id_token_signed_response_alg: OIDC_ID_TOKEN_ALG }, ClientSecretBasic(secret), { timeout: OIDC_TIMEOUT_S, execute: [enableNonRepudiationChecks, ...(issuer.startsWith('http://') ? [allowInsecureRequests] : [])] })`. These are imported function references.
   - It ends with `.then((cfg) => assertDiscoveredMetadata(cfg, issuer))`: `serverMetadata().issuer === issuer` byte-exact, then a same-origin `jwks_uri`. A missing `jwks_uri` rejects.
   - A rejection clears the slot only if the slot still holds that promise.
   - Export `__resetOidcConfigurationCache()` for tests.
   - Export thin helpers for Step 32:
     - `buildSsoAuthorizationUrl(cfg, {redirectUri, state, nonce, codeChallenge})` with `scope: 'openid email'`, `response_mode: 'query'`, `code_challenge_method: 'S256'` (D-9, D-41);
     - `exchangeCode(cfg, currentUrl, {pkceCodeVerifier, expectedState, expectedNonce})` wrapping `authorizationCodeGrant(..., { pkceCodeVerifier, expectedState, expectedNonce, idTokenExpected: true })`, returning `claims()` `{ iss, sub, email }` only.
3. **`ssoLogout.ts`** (D-51, D-65, D-97):
   - `autheliaPortalLogoutUrl(issuer, appOrigin)` = `` `${issuer}/logout?rd=${encodeURIComponent(new URL('/auth/login', appOrigin).href)}` ``. The issuer has no trailing slash by grammar.
   - `endSessionUrl(cfg, appOrigin, clientId)` uses `buildEndSessionUrl(cfg, { post_logout_redirect_uri: new URL('/auth/login', appOrigin).href, client_id })` only when `serverMetadata().end_session_endpoint` is set and same-origin with the issuer; otherwise `null`.
   - `resolveLogoutRedirect(cfgResult, secret)`, under one `raceDeadline(…, AUTH_CONFIG_TIMEOUT_MS)`: the end-session URL if available, else the portal URL. A throw or timeout → the portal URL plus `serverLog.warn('sso_logout_portal_fallback')`.
4. Build check (D-50): openid-client is ESM-only and pulls `jose ^6`, while the UI keeps `jose ^5` for sessions and the txn JWE.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint && pnpm run build
cd ../.. && grep -n '"openid-client": "6.8.9"' services/xstockstrat-ui/package.json
docker compose build --no-cache xstockstrat-ui   # D-50: standalone image builds with the ESM-only dependency
docker run --rm -d --name ui-smoke -p 3999:3000 -e JWT_SECRET=smoke-secret-min-32-characters-long $(docker compose config --images xstockstrat-ui) && sleep 8 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3999/auth/login; docker rm -f ui-smoke   # boot smoke: the standalone server answers (any HTTP status, not a crash)
```

---

### Step 29 — test: oidcClient production path through a fetch stub, and the logout URLs

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/oidcClient.test.ts` — create
- `services/xstockstrat-ui/src/lib/ssoLogout.test.ts` — create

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety

**Codebase Evidence**:
- D-34: "`oidcClient.test.ts` exercises the production discovery/grant path through `vi.stubGlobal('fetch', …)`, with `https` URLs and the Configuration cache reset between cases."
- `jose ^5` is available for signing test ID tokens (`package.json`).

**TDD**: red-green required

**Covers**: AC-24, AC-52, AC-53

**Instructions**:
1. `oidcClient.test.ts`: stub `fetch` with discovery, JWKS and token endpoints on `https://auth.example.test`, and sign ID tokens with `jose` (RS256).
   - Correct signature → `exchangeCode` returns `{iss, sub, email}`.
   - **@AC-24 row 4:** a foreign key with the same `kid` → reject (proves `enableNonRepudiationChecks` is active).
   - An ES256 or `none` ID token → reject. A nonce mismatch → reject. An `aud` mismatch → reject.
   - Cache cases (D-70): a rotated secret → a second `discovery` call; the same key within 600 s → one call; after 601 s → a refetch.
   - A rejected discovery is not cached, and a stale rejection does not clear a newer slot.
   - A discovery `issuer` with a trailing slash → reject. A configured `/.well-known/openid-configuration` issuer → reject (D-89). A cross-origin `jwks_uri` → reject, and the next call rediscovers (D-87).
2. `ssoLogout.test.ts`:
   - **@AC-53:** no `end_session_endpoint` → `https://auth.example.test/logout?rd=https%3A%2F%2Fxstockstrat-staging.example.test%2Fauth%2Flogin`.
   - **@AC-52:** an advertised same-origin endpoint → that URL with `post_logout_redirect_uri` and `client_id`. A cross-origin endpoint → the portal URL.
   - A discovery throw or timeout → the portal URL plus one WARN `sso_logout_portal_fallback`.
3. The stub discovery documents and JWKS are scenario one-offs, so they stay inline here. The e2e stub IdP's fixtures go to `e2e/fixtures/` in Step 38.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint && pnpm run test:coverage
```

---

### Step 30 — service: Typed auth metrics, SSO error redirects, logout rewrite and the login 403

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/bffMetrics.ts` — modify
- `services/xstockstrat-ui/src/lib/ssoErrors.ts` — create
- `services/xstockstrat-ui/src/lib/ssoRefusals.ts` — modify (type the return as `SsoErrorCode`)
- `services/xstockstrat-ui/src/lib/auth.ts` — modify
- `services/xstockstrat-ui/src/lib/identity.ts` — modify
- `services/xstockstrat-ui/src/app/api/auth/logout/route.ts` — modify
- `services/xstockstrat-ui/src/app/api/auth/login/route.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety, no secret values rendered in UI; Security — auth scope correctness

**Codebase Evidence**:
- `bffMetrics.ts`: `AuthEvent` (10 members) is at `:9-19`, `JwtRejectReason` at `:20`, and `recordAuthEvent(event, reason?: JwtRejectReason)` at `:47-49`.
- Callers, from `grep -rn "recordAuthEvent(" src`: `auth.ts:27,33`, `identity.ts:22,32,35`, `login/route.ts:11,27,33,37`, `refresh/route.ts:9`, `logout/route.ts:11` (bare `'logout'`, which would fail the typed map) and `bffAllowlist.test.ts:48-49`.
- `auth.ts`:
  - `verifyAccessToken` is at `:23-36`. It uses `jwtVerify(token, new TextEncoder().encode(secret))` and catches `errors.JWTExpired`.
  - `REMEMBER_ME_MAX_AGE_SECONDS = 1_209_600` is at `:17`. `clearSessionCookies` is at `:76-80`. `setSessionCookies` uses the base `{httpOnly, secure: isProduction, sameSite:'lax', path:'/'}` (`:53-54`).
- `identity.ts:42-48` `revokeToken(token)` calls `identityClient.revokeToken({ token })` with no timeout.
- Routes:
  - `logout/route.ts:6-15` revokes any cookie token, records `'logout'`, clears the cookies and returns `{ok:true}`.
  - `login/route.ts:29-44` maps `Unauthenticated` → 401 and everything else → 503 (recon R-8).

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. **`bffMetrics.ts`** (D-72, design.md (B) §D-72):
   - Add `'sso_login_ok' | 'sso_login_failed' | 'sso_login_error' | 'login_disabled'` to `AuthEvent`.
   - `LOGOUT_REASONS = ['verified','unverified','expired_too_old','cross_origin'] as const`, and its `LogoutReason` type.
   - `AuthEventReason = { jwt_rejected: JwtRejectReason; logout: LogoutReason; sso_login_failed: SsoErrorCode }`.
   - The generic rest-tuple `recordAuthEvent` from the design. It imports `type { SsoErrorCode }` from `ssoErrors`.
2. **`ssoErrors.ts`** (D-82, D-83; design.md (C) §3):
   - `SSO_ERROR_CODES` and `SsoErrorCode`.
   - `ssoErrorRedirect(code, appOrigin, opts)`, which returns a 303 `NextResponse` and clears the txn cookie when asked (path `/api/auth/sso/callback`, `maxAge 0`, D-75 attributes).
   - It holds the only two literal `recordAuthEvent` calls: `'sso_login_error'` when `fault`, else `('sso_login_failed', code)`.
3. **`ssoRefusals.ts`**: type `refusalCode` as returning `SsoErrorCode | null`.
4. **`auth.ts`** (D-61, D-72):
   - Extract `verifySessionJwt(token)` returning `{ok:true; payload} | {ok:false; kind: JwtRejectReason; payload?}`. It records nothing and holds the shared key loading.
   - `verifyAccessToken` maps it to `recordAuthEvent('jwt_rejected', kind)`, with unchanged behaviour.
   - Add `verifyAccessTokenForLogout(token): Promise<LogoutReason>`:
     - `'verified'` when the signature is valid, or on a `JWTExpired` whose `payload.exp` is within `REMEMBER_ME_MAX_AGE_SECONDS` of now (R-21: not `clockTolerance`);
     - `'expired_too_old'` beyond that;
     - otherwise `'unverified'` (`no_secret` / `invalid` → `unverified`).
   - It never records `jwt_rejected`.
5. **`identity.ts`**: `revokeToken` passes `{ timeoutMs: REFRESH_TIMEOUT_MS }` (D-61).
6. **`logout/route.ts`**: rewrite as design.md (B) §D-68 + D-77, in this order:
   1. `if (!isSameOrigin(req,'if_present'))`: `recordAuthEvent('logout','cross_origin')`, `serverLog.warn('logout_origin_mismatch', { origin_host: originHost(origin) })`, and return 403 `{error:'origin mismatch'}` with no Set-Cookie.
   2. `reason = await verifyAccessTokenForLogout(cookie)`, then `recordAuthEvent('logout', reason)`.
   3. Only when `'verified'`, run in parallel and await both: `revokeToken(token)` ‖ (`loadOidcConfig()` then, when SSO-valid, `loadOidcClientSecret` + `getOidcConfiguration` → `resolveLogoutRedirect`). The redirect side is bounded by `AUTH_CONFIG_TIMEOUT_MS`.
   4. `clearSessionCookies`.
   5. Respond:
      - legacy → `{ok:true}`;
      - `'error'` → `{ok:true}` plus `serverLog.warn('sso_logout_mode_unknown')`;
      - SSO valid + verified → `{ok:true, redirect}`;
      - SSO `valid:false`, or not verified → `{ok:true}`.
   - Keep the `withBffMetrics('auth', '/api/auth/logout', …)` wrapper.
7. **`login/route.ts`**: `Code.PermissionDenied` → `recordAuthEvent('login_disabled')` and 403 `{ error: 'password login disabled' }` (D-12). The other branches are unchanged.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint && pnpm run test:unit
grep -rn "recordAuthEvent('sso_login" src | grep -v test   # exactly the 2 sites in ssoErrors.ts (+ sso_login_ok added in Step 32)
```

---

### Step 31 — test: Metric typing, logout route, auth verify and login 403

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/__tests__/bffAllowlist.test.ts` — modify
- `services/xstockstrat-ui/src/lib/ssoErrors.test.ts` — create
- `services/xstockstrat-ui/src/lib/auth.test.ts` — modify
- `services/xstockstrat-ui/src/lib/identity.test.ts` — modify
- `services/xstockstrat-ui/src/app/api/auth/logout/route.test.ts` — create
- `services/xstockstrat-ui/src/app/api/auth/login/route.test.ts` — create

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety

**Codebase Evidence**:
- `bffAllowlist.test.ts:18-27` holds `ALLOWED_KEYS['ui.auth.events'] = ['event','reason']`; `drive()` calls are at `:48-49`.
- The route-test precedent is `src/app/config-ui/api/audit/route.test.ts`.
- `auth.test.ts` and `identity.test.ts` exist.

**TDD**: red-green required

**Covers**: AC-16, AC-45, AC-52, AC-53, AC-56, AC-57, AC-58, AC-62, AC-64

**Instructions**:
1. **`bffAllowlist.test.ts`** (D-72, D-83, D-93):
   - Add the `it('recordAuthEvent reason typing is enforced by tsc (D-83)')` block verbatim from design.md (C) §4.
   - `drive()` adds `('logout','cross_origin')`, `('sso_login_failed','no_access')` and `('sso_login_ok')`.
   - Assert `SSO_ERROR_CODES` / `LOGOUT_REASONS` equal the literal lists. The keys stay `['event','reason']` (`@AC-41 @feature-294`).
   - **RED proof for D-93:** remove one `@ts-expect-error` and see `pnpm run typecheck` fail with TS2578, then restore it. Record the output in the step's TDD evidence.
2. **`ssoErrors.test.ts`**: `ssoErrorRedirect('not_configured', null, {clearTxnCookie:'sso_txn_ab'})` → 303, `Location: /auth/login?error=not_configured`, and a `Set-Cookie` with Max-Age=0 on path `/api/auth/sso/callback`. With `fault:true`, it records `sso_login_error`.
3. **`auth.test.ts`**:
   - `verifyAccessTokenForLogout`: valid → verified; expired 1 day → verified; expired 15 days → expired_too_old; wrong key → unverified; no secret → unverified.
   - `vi.spyOn` proves `jwt_rejected` is never recorded on these paths.
4. **`identity.test.ts`**: `revokeToken` passes `timeoutMs: 10_000`.
5. **`logout/route.test.ts`** (mock `revokeToken`, `loadOidcConfig`, `loadOidcClientSecret`, `getOidcConfiguration`):
   - **@AC-57** (legacy and SSO): a sibling Origin with cookies → 403, no `revokeToken`, no `Set-Cookie`, no config read, and one WARN `logout_origin_mismatch`.
   - Revoke happens **iff** the token is signature-valid (D-64).
   - **@AC-53:** SSO valid → `{ok:true, redirect: <portal URL>}` and cleared cookies.
   - **@AC-52:** an end-session endpoint → that URL.
   - **@AC-56:** `valid:false` → `{ok:true}` with no `redirect` and no discovery call.
   - **@AC-62:** a config reject → `{ok:true}` and WARN `sso_logout_mode_unknown`, with revoke still done.
   - **@AC-64:** only an expired-but-signed access cookie → 200 `{ok:true}`, cookies cleared.
   - **@AC-58:** an invalid `APP_URL` plus a sibling Origin → passes, cookies cleared.
   - Legacy → `{ok:true}`, byte-identical.
6. **`login/route.test.ts`**:
   - **@AC-16 / @AC-45:** `authenticateUser` rejects `PermissionDenied` → 403 `{error:'password login disabled'}` and `login_disabled` recorded.
   - `Unauthenticated` → 401 as today.
7. **C-12**: the route tests use scenario one-offs (cookies, origins) and `signTestJwt` / `TEST_JWT_SECRET` from `e2e/helpers/auth.ts` when signing session JWTs. They declare no new secret literal.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint && pnpm run test:coverage
grep -n "helpers/auth" src/app/api/auth/logout/route.test.ts src/lib/auth.test.ts
```

---

### Step 32 — service: SSO start and callback routes, the transaction cookie and the middleware sets

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/ssoTxn.ts` — create
- `services/xstockstrat-ui/src/app/api/auth/sso/start/route.ts` — create
- `services/xstockstrat-ui/src/app/api/auth/sso/callback/route.ts` — create
- `services/xstockstrat-ui/src/middleware.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety, no secret values rendered in UI; Security — JWT claims minimal, auth scope correctness

**Codebase Evidence**:
- `middleware.ts`:
  - `PUBLIC_HEALTH_PATHS = new Set([...])` (exact paths) is at `:27-36`. The function starts at `:38` and checks `PUBLIC_HEALTH_PATHS.has(...)` before `getSessionFromRequest` (`:39-41`).
  - The matcher at `:22` excludes `api/auth/login|api/auth/refresh|auth/login|auth/oauth-login|\.well-known|api/oauth` but **not** `api/auth/sso/*` or `api/auth/logout` (recon R-8).
  - The refresh branches at `:45-84` and `:86-110` redirect.
- `identityClient` is at `connectClients.ts:101`. `HEADER_TRACE_ID` and `generateTraceId` are at `headers.ts:7` and `auth.ts:104-106`.
- `setSessionCookies(res, access, refresh, opts?)` is at `auth.ts:47-66`.
- **Not found**: no SSO transaction cookie, no HKDF helper, no SSO route. These are new (D-8, D-23). Node `crypto.hkdfSync` and jose ^5 `CompactEncrypt` / `compactDecrypt` (dir / A256GCM) are available.

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. **`ssoTxn.ts`** (D-8, D-15, D-23, D-35, D-75):
   - `key = hkdfSync('sha256', JWT_SECRET, '', 'xstockstrat-ui/sso-txn', 32)`.
   - `sealTxn({state, nonce, codeVerifier, remember, redirect})` → a JWE `dir`/`A256GCM` with `exp` now + 600.
   - `openTxn(jwe)` → the payload or `null`.
   - `txnCookieName(state)` = `` `sso_txn_${sha256(state).slice(0,16)}` ``.
   - `TXN_COOKIE_OPTS = { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/api/auth/sso/callback', maxAge: 600 }`.
   - `clearAllTxnCookies(req, res)` clears every `sso_txn_*` with the same path.
   - Never an HS256 JWS (R-7).
2. **`start/route.ts`**: export `POST` only, so GET → 405 (D-46, D-54). Wrap it in `withBffMetrics('auth', '/api/auth/sso/start', …)`. Order (S-2 amended, design.md (B)):
   1. `cfg = await loadOidcConfig()`:
      - `'legacy'` → 404;
      - `'error'` → `ssoErrorRedirect('failed', appOrigin(), {fault:true})`;
      - `valid:false` → `ssoErrorRedirect('not_configured', appOrigin())`.
   2. `!isSameOrigin(req,'required')` → `failed`.
   3. `secret = await loadOidcClientSecret()`. Null → `not_configured`; a throw → `failed` with fault.
   4. Read `remember` and `redirect` from `req.formData()`. `redirect` goes through `safeRedirect`.
   5. Generate `state`, `nonce` and `code_verifier`. `getOidcConfiguration`; a throw → `failed` with fault.
   6. Respond 303 to `buildSsoAuthorizationUrl(...)` with `redirect_uri = new URL('/api/auth/sso/callback', cfg.appOrigin).href`, setting the txn cookie.
3. **`callback/route.ts`**: export `GET`. Canonical order (S-3, D-41, D-58, D-66, D-82):
   1. Mode:
      - `'legacy'` → 404;
      - `'error'` → `failed` with fault;
      - `valid:false` → `not_configured`.
   2. IdP `error` param: clear this request's txn cookie if `state` is present. `access_denied` → `no_access`; any other error → `failed`.
   3. A missing or undecryptable txn for `state` → `failed`.
   4. Secret null → `not_configured`.
   5. `exchangeCode(...)`: any failure → `failed` (fault on a transport error or timeout), and **no** resolve.
   6. `identityClient.resolveExternalIdentity({issuer: claims.iss, subject: claims.sub, email: claims.email ?? ''}, {timeoutMs: AUTH_CONFIG_TIMEOUT_MS, headers: {[HEADER_TRACE_ID]: traceId}})`:
      - `FailedPrecondition` → `refusalCode(detail)` (`linked` / `ambiguous` / `inactive` / `no_email`);
      - other codes → `failed` with fault.
   7. `identityClient.issueSessionForUser({userId}, {…same opts})`:
      - `FailedPrecondition` → `inactive`;
      - anything else → `failed`.
      - No session cookies are set, and the link stays (D-49 N-5).
   8. `setSessionCookies(res, access, refresh, txn.remember ? { maxAge: REMEMBER_ME_MAX_AGE_SECONDS } : undefined)`, then `clearAllTxnCookies`, `recordAuthEvent('sso_login_ok')`, and a 303 to `new URL(txn.redirect, cfg.appOrigin)`.
   - Error logging: `serverLog.warn('sso_callback_failed', { error_class: err.constructor.name, code })`. It never logs the auth code, the tokens, the token response or the email (D-75).
   - Every failure path uses `ssoErrorRedirect(code, appOrigin, {clearTxnCookie: thisRequestsName})`.
4. **`middleware.ts`** (D-40, D-52, D-62):
   - Export the sets `SSO_PUBLIC_PATHS = new Set(['/api/auth/sso/start','/api/auth/sso/callback'])` and `COOKIE_GATED_PATHS = new Set(['/api/auth/logout'])`, and export `PUBLIC_HEALTH_PATHS`.
   - At the top, before `getSessionFromRequest`:
     - `SSO_PUBLIC_PATHS.has(path)` → `NextResponse.next()`;
     - `COOKIE_GATED_PATHS.has(path) && (req.cookies.get('access_token') || req.cookies.get('refresh_token'))` → `NextResponse.next()`.
   - The matcher at `:22` is **unchanged**.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint && pnpm run test:unit
grep -n "HEADER_TRACE_ID" src/app/api/auth/sso/callback/route.ts   # C-03: pre-auth identity calls carry x-trace-id
grep -n "export async function GET" src/app/api/auth/sso/start/route.ts || echo "start is POST-only"
```

---

### Step 33 — test: Start and callback routes, the txn cookie and the middleware exemptions

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/ssoTxn.test.ts` — create
- `services/xstockstrat-ui/src/app/api/auth/sso/start/route.test.ts` — create
- `services/xstockstrat-ui/src/app/api/auth/sso/callback/route.test.ts` — create
- `services/xstockstrat-ui/src/middleware.test.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety

**Codebase Evidence**:
- `src/middleware.test.ts` has a `matches()` helper over the matcher regex (recon).
- The route-test precedent is `src/app/config-ui/api/audit/route.test.ts`.

**TDD**: red-green required

**Covers**: AC-4, AC-5, AC-7, AC-24, AC-26, AC-29, AC-39, AC-47, AC-51, AC-54, AC-58, AC-59, AC-60

**Instructions**:
1. **`ssoTxn.test.ts`**:
   - Seal and open round-trip.
   - A tampered JWE → null. An expired JWE → null.
   - A cookie signed as an HS256 JWS with `JWT_SECRET` is **not** accepted (R-7).
   - The cookie name is derived from sha256(state).
   - The options include `secure` in production and the callback path.
2. **`start/route.test.ts`** (mock `fetch` to prove no IdP request):
   - **@AC-47:** legacy → 404.
   - **@AC-60:** config unreadable → 303 `?error=failed`.
   - **@AC-54:** `valid:false` → `not_configured`, before the Origin check, with `fetch` never called.
   - **@AC-58:** an invalid `APP_URL` → a relative `Location: /auth/login?error=not_configured`, whatever the Origin.
   - **@AC-59:** a sibling Origin or no Origin → `failed`, with `fetch` never called.
   - Secret `found=false` → `not_configured`.
   - Happy path → a 303 to the authorize URL with `scope=openid email`, `response_mode=query`, `code_challenge_method=S256` and `redirect_uri=http://localhost:3000/api/auth/sso/callback`, plus a txn cookie whose content has `remember=true` when the form has `remember=1`.
3. **`callback/route.test.ts`** (mock `exchangeCode` / identity client):
   - **@AC-47 / @AC-60:** legacy 404, and `'error'` → `failed` with no resolve.
   - **@AC-51:** `error=access_denied` → `no_access`, with this txn cookie cleared.
   - **@AC-24:** state `s-999` (no txn cookie), a nonce mismatch and an `aud` mismatch (`exchangeCode` rejects) → `failed`. `resolveExternalIdentity` is never called and no session cookie is set.
   - **@AC-4 / @AC-5 / @AC-7 / @AC-26 / @AC-39:** each refusal detail maps to `linked` / `ambiguous` / `inactive` / `inactive` / `no_email`, with no session cookies.
   - `IssueSessionForUser` `FailedPrecondition` → `inactive`.
   - **@AC-29:** with remember → session cookies `Max-Age=1209600` and `remember_me=1`. Without it → session cookies. On success every `sso_txn_*` is cleared.
   - The resolve call carries `x-trace-id`.
   - Sentinels (`CODE-SENTINEL`, `IDTOKEN-SENTINEL`, `sentinel@example.test`) never appear in any `serverLog` or console argument (D-75).
4. **`middleware.test.ts`** (D-40, D-59, D-62):
   - Every path in `SSO_PUBLIC_PATHS ∪ COOKIE_GATED_PATHS ∪ PUBLIC_HEALTH_PATHS` has a `route.ts` under `src/app/`, checked with `fs.existsSync`.
   - `/api/auth/sso/startx` and `/api/auth/logoutx` redirect.
   - A near-expiry token with a failing refresh on `/api/auth/sso/callback` passes through.
   - Logout with no cookie → today's redirect. Logout with a cookie → passes.
5. **C-12**: the tests use scenario one-offs (state values, refusal details, sentinels). Where a domain user id is needed, import it from `e2e/fixtures/users.ts` rather than declaring a new literal.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint && pnpm run test:coverage
```

---

### Step 34 — service: Login page as a server component with the SSO form and the FR-9 banner

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/auth/login/page.tsx` — modify
- `services/xstockstrat-ui/src/app/auth/login/LoginForm.tsx` — create
- `services/xstockstrat-ui/src/components/auth/SsoSignInForm.tsx` — create

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness, no secret values rendered in UI

**Codebase Evidence**:
- `login/page.tsx:1-55` is a `'use client'` page. It holds `LoginForm` (`useRouter` + `useSearchParams`, `CredentialsForm submitLabel="Sign in" … showRememberMe onSuccess=…`) inside `AuthCardShell`, with a `Suspense` fallback `LoginSkeleton`.
- `AuthForm.tsx`: `CredentialsForm` shows `data.error` from the login response (`:58-67`) and renders `{error && <p className="text-sm text-destructive">…}` (`:121`). Its remember-me control is `id="rememberMe"` (`:105-114`).
- `src/components/ui/checkbox.tsx` exports `Checkbox` (`:29`).
- `src/app/auth/layout.tsx` forces `dynamic = 'force-dynamic'` (UI `CLAUDE.md` § Auth + BFF).

**TDD**: red-green required (RED/GREEN via the Step 38 e2e; no jsdom unit layer exists — `vitest.config.ts:19` node env)

**Covers**: —

**Instructions**:
1. Move today's client `LoginForm` and `LoginSkeleton` verbatim into `LoginForm.tsx` (`'use client'`). `CredentialsForm` is untouched (D-54).
2. **`page.tsx`** becomes a server component (FR-9, D-22, D-47):
   - Read `loadOidcConfig()` and `loadPasswordLoginEnabled()` together with `Promise.allSettled`. Any rejection, or `mode:'error'`, means legacy rendering (AC-46).
   - Read `searchParams.error` and `searchParams.redirect` (Next 15 async `searchParams`).
   - Render per the D-54 table:
     - legacy or `'error'` + flag on → `LoginForm` only;
     - legacy or `'error'` + flag off → `LoginForm` + the FR-9 banner;
     - SSO + flag on → `LoginForm` + `SsoSignInForm`;
     - SSO + flag off → `SsoSignInForm` only.
   - SSO `valid:false` still renders the SSO button (D-66).
   - The banner text is exactly "Password login is disabled in config (identity/auth.password_login_enabled) while SSO is not configured. Ask an admin.", rendered with the canonical `CardNotice` primitive (C-17).
   - The `?error=` message map is `Record<SsoErrorCode, string>`:
     - `failed` → "Sign-in failed. Try again."
     - `not_configured` → "SSO not configured"
     - `linked` → "This account is already linked to another sign-in. Ask an admin."
     - `ambiguous` → "More than one account uses this email. Ask an admin."
     - `inactive` → "This account is disabled. Ask an admin."
     - `no_email` → "Your sign-in has no email. Ask an admin."
     - `no_access` → "You don't have access to xstockstrat. Ask an admin."
     - An unknown code shows nothing.
3. **`SsoSignInForm.tsx`** (D-54): a native `<form method="post" action="/api/auth/sso/start">` with:
   - a hidden `redirect`;
   - an uncontrolled `Checkbox` with `id="ssoRememberMe" name="remember" value="1"` and the label "Keep me signed in for 14 days (SSO)";
   - a `Button` "Sign in with SSO".
   - It uses design tokens only (C-17), and the accessible names differ from `CredentialsForm`'s.
4. Record the Referrer-Policy constraint in `context.md` at execute: a future `no-referrer` policy would break `/start` (D-54).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint && pnpm run build
grep -n "'use client'" src/app/auth/login/page.tsx || echo "page is a server component"
```

---

### Step 35 — service: Authorized-apps pointer card and mode-aware discovery documents

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/accounts/authorized-apps/page.tsx` — modify
- `services/xstockstrat-ui/src/app/accounts/authorized-apps/AuthorizedAppsList.tsx` — create
- `services/xstockstrat-ui/src/app/accounts/authorized-apps/SsoAppsCard.tsx` — create
- `services/xstockstrat-ui/src/components/accounts/ConnectorUrlField.tsx` — create
- `services/xstockstrat-ui/src/app/api/oauth/protected-resource/route.ts` — modify
- `services/xstockstrat-ui/src/app/api/oauth/authorization-server/route.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — no secret values rendered in UI, environment scope correctness

**Codebase Evidence**:
- `authorized-apps/page.tsx`:
  - It is a 256-line `'use client'` page. It uses `useAgentUrl()` (`:29`), `apiFetch('/accounts/api/authorized-apps')` (`:42-47`) and `copyAgentUrl` (`:146-153`).
  - The connector field (an `input readOnly value={agentUrl} aria-label="MCP connector URL"` plus a Copy `Button`) is at `:195-213`.
  - The list `Card` is at `:229-253`.
- `accounts/layout.tsx:18-20` reads `AGENT_PUBLIC_URL` server-side into `AgentUrlProvider`; the layout is untouched (D-28).
- `api/oauth/protected-resource/route.ts:8-13` and `authorization-server/route.ts:8-19` take `export const dynamic = 'force-dynamic'` and return the agent-named documents. The `next.config.js:54-64` rewrites map `/.well-known/oauth-*/agent` to them.

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. Extract `ConnectorUrlField` (`'use client'`; `useAgentUrl` + copy state) from `page.tsx:195-213` (D-55).
2. Move the current page body verbatim into `AuthorizedAppsList.tsx` (`'use client'`), using `ConnectorUrlField` in its dialog.
3. **`page.tsx`** becomes a server component calling `loadOidcConfig()` (D-28, D-49 N-12):
   - `'sso'` → `SsoAppsCard`;
   - `'legacy'` or `'error'` (including a rejection) → `AuthorizedAppsList`.
4. **`SsoAppsCard.tsx`** (`'use client'`, props `{ autheliaUrl: string | null; mcpClientId: string; mcpClientIdReadonly: string }`), built from `Card` primitives (C-17):
   - It explains that connected apps are managed in Authelia.
   - It links to `autheliaUrl`, the valid issuer; the link is omitted when `valid:false` (D-66).
   - It shows `ConnectorUrlField`, and a row for each **non-empty** client ID (full / read-only), with the instruction to paste them into the connector's advanced OAuth settings (FR-11, D-44).
   - It lists no grants and offers no revoke control (AC-34).
5. **`protected-resource/route.ts`** (D-38, D-55, D-78):
   - legacy → byte-identical;
   - SSO valid → `{resource: AGENT_PUBLIC_URL, authorization_servers: [cfg.agentIssuer], scopes_supported: [...MCP_SCOPES_SUPPORTED]}`;
   - SSO invalid or `'error'` → `new NextResponse(null, {status: 503, headers: {'Cache-Control':'no-store'}})`.
6. **`authorization-server/route.ts`**:
   - legacy → byte-identical;
   - SSO (valid or not) → 404;
   - `'error'` → 503 `no-store`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint && pnpm run build
```

---

### Step 36 — service: Sign-out button in the shared header

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/shared/SignOutButton.tsx` — create
- `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness

**Codebase Evidence**:
- `PlatformHeader.tsx:201-202`: `<header …><div className="flex h-[49px] items-center gap-2 …">` is row 1.
- `:246-248`: `<div className="flex items-center gap-2 ml-auto">{actions}<CopilotToggle />`, before the `sm:hidden` mobile sidebar block.
- `Button` lives in `src/components/ui/button.tsx`; the icon-size convention is at `button.tsx:35` (D-63 evidence).

**TDD**: red-green required (RED/GREEN via the Step 38 e2e)

**Covers**: —

**Instructions**:
1. **`SignOutButton.tsx`** (`'use client'`; D-53, D-60, D-63):
   - It renders a `Button` with `variant="ghost"`, `size="icon"`, `className="size-11 sm:size-8"`, `aria-label="Sign out"`, and a sign-out icon from the icon set already in use.
   - It holds `pending` state.
   - On click, inside try/catch:
     - `res = await fetch('/api/auth/logout', {method:'POST', redirect:'manual'})`;
     - a JSON `res.ok` with `body.redirect` → `location.assign(body.redirect)`;
     - every other outcome (a rejection, non-ok including 403, an `opaqueredirect`, non-JSON) → `location.assign('/auth/login')`;
     - `pending` never sticks.
2. **`PlatformHeader.tsx`**: render `<SignOutButton />` right after `<CopilotToggle />` (`:248`), in both modes.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint && pnpm run build
```

---

### Step 37 — test: Discovery-route and PRM contract unit tests

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/api/oauth/protected-resource/route.test.ts` — create
- `services/xstockstrat-ui/src/app/api/oauth/authorization-server/route.test.ts` — create
- `services/xstockstrat-ui/src/lib/mcpScopes.test.ts` — create

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety

**Codebase Evidence**:
- The agent side of the PRM contract is pinned in Step 22 (`test_sso_routes.py`, AC-11) against `oauth_metadata.py`.
- The route-test precedent is `src/app/config-ui/api/audit/route.test.ts`.

**TDD**: red-green required

**Covers**: AC-11, AC-49, AC-54

**Instructions**:
1. `protected-resource/route.test.ts` (mock `loadOidcConfig`):
   - legacy → `{resource, authorization_servers:[AGENT_PUBLIC_URL]}`, byte-identical.
   - **@AC-49 / @AC-11:** SSO valid → `{resource: AGENT_PUBLIC_URL, authorization_servers:['https://auth.example.test'], scopes_supported:['xstockstrat.read','xstockstrat.write','xstockstrat.admin','xstockstrat.trade']}`, pinned **whole** with the same literal object as the agent test (D-55 two-sided contract).
   - **@AC-54:** `valid:false` → 503 `no-store`. `'error'` → 503.
2. `authorization-server/route.test.ts`: legacy → byte-identical; SSO → 404 (@AC-49); `'error'` → 503.
3. `mcpScopes.test.ts`: `MCP_SCOPES_SUPPORTED` equals the four-literal list (mirrors agent `scopes.MCP_SCOPES_SUPPORTED`, Step 20/22).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint && pnpm run test:coverage
```

---

### Step 38 — test: e2e harness (stub IdP, SSO project, APP_URL) and the SSO/legacy specs

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/helpers/stubIdp.ts` — create
- `services/xstockstrat-ui/e2e/fixtures/sso.ts` — create
- `services/xstockstrat-ui/e2e/fixtures/index.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify
- `services/xstockstrat-ui/e2e/global-setup.ts` — modify
- `services/xstockstrat-ui/e2e/global-teardown.ts` — modify
- `services/xstockstrat-ui/playwright.config.ts` — modify
- `services/xstockstrat-ui/e2e/sso/sso-login.spec.ts` — create
- `services/xstockstrat-ui/e2e/sso/sso-logout.spec.ts` — create
- `services/xstockstrat-ui/e2e/sso/sso-accounts.spec.ts` — create
- `services/xstockstrat-ui/e2e/auth.spec.ts` — modify
- `docker-compose.yml` — modify

**Reviewers**: `xstockstrat-ui` owner — Trading UI correctness; Platform Lead — deploy config parity (`APP_URL`)

**Codebase Evidence**:
- `mock-backend.ts`:
  - `identityHandlers` is at `:285-320`: `authenticateUser`, `refreshToken`, `revokeToken`, `listAuthorizedApps`.
  - `getConfig(req)` is at `:1552-1578`. It answers namespace `ui` with the `performance.*` values and **every other namespace with `platform`** (recon R-8).
  - The mock ports are `TRADER_MOCK_PORT = 9091` etc. (`:122-124`).
- `playwright.config.ts`:
  - `fullyParallel: true`, `workers: isCI ? 2 : undefined` (`:84-85`).
  - `use.baseURL: 'http://localhost:3000'` (`:94`). `projects` setup / chromium is at `:98-125`.
  - `webServer.env` has `AGENT_PUBLIC_URL: 'http://127.0.0.1:9099'` (`:168`).
- `e2e/helpers/auth.ts`: `TEST_JWT_SECRET` (`:20`), `signTestJwt` (`:29`), `addAuthCookie` (`:83`). `e2e/fixtures/users.ts` and `INVENTORY.md` exist.
- `e2e/auth.spec.ts:300-312` holds the logout block; `page.request.post` sends no Origin (D-52).
- `docker-compose.yml:520` `AGENT_PUBLIC_URL: http://xstockstrat-agent:9000` and `:524-525` `ports: "3000:3000"` are in the UI block.
- `.do/app.yaml:650-651`, `.do/app.dev.yaml:647-648` and `deploy/homelab/compose.yml:283` already set `APP_URL` (D-67), so they need no change.

**TDD**: red-green required

**Covers**: AC-1, AC-16, AC-17, AC-29, AC-32, AC-34, AC-41, AC-42, AC-44, AC-45, AC-46, AC-48, AC-49, AC-51, AC-53, AC-54, AC-56, AC-57, AC-58, AC-59, AC-63, AC-64

**Instructions**:
1. **APP_URL wiring** (D-67):
   - In `docker-compose.yml`, add `APP_URL: http://localhost:3000` after `:520`, with a 2-line constraint comment: it must equal the browser origin, and local compose SSO is unsupported (D-91).
   - In `playwright.config.ts`, hoist `const BASE_URL = 'http://localhost:3000'`, use it for `use.baseURL`, and add `APP_URL: BASE_URL` to `webServer.env`.
2. **Stub IdP** (`e2e/helpers/stubIdp.ts`; D-34, D-59, D-91). A `node:http` server on `127.0.0.1:<STUB_IDP_PORT>` (pick a free fixed port next to `9091-9093`; confirm it is unused at execute) serving:
   - discovery (`issuer` = `http://127.0.0.1:<port>`, byte-exact; `jwks_uri` same-origin; `end_session_endpoint` only when the `endSession` knob is set);
   - `/jwks`;
   - `/authorize`, which redirects to `redirect_uri` with `code` and `state`, or `error=access_denied` under the knob;
   - `/token`, which returns an RS256 ID token signed with jose: `aud` = client_id, the nonce from the authorize request, `email` / `sub` per knob, and `signWith:'foreign'` signing with a key absent from the JWKS;
   - `/logout`, which records the call.
   - Control: `POST /__test/state` sets the knobs plus the SSO config values the mock `getConfig` serves (below), and `POST /__test/reset` restores legacy.
   - Start it in `global-setup.ts`, in the same process as the mock backend (shared module state), and stop it in `global-teardown.ts`.
3. **`mock-backend.ts`**:
   - `getConfig` answers namespaces `identity` (`auth.password_login_enabled`), `agent` (`oidc.issuer`) and `ui` (the existing `performance.*` plus `oidc.issuer`, `oidc.client_id`, `oidc.mcp_client_id`, `oidc.mcp_client_id_readonly`) from the shared stub state. The default state is legacy: issuers `""`, flag `true`.
   - Add `getSecret` for `ui/oidc.client_secret`. It returns `found` per the state and asserts `x-internal-caller: ui`.
   - `identityHandlers` gains:
     - `resolveExternalIdentity`, which returns the fixture user or throws `FailedPrecondition` with the refusal detail per the stub state;
     - `issueSessionForUser`, which returns a `signTestJwt` session.
4. **Isolation from the parallel suite.** The mode is global server state, so:
   - SSO specs live in `e2e/sso/` and run in a new project `chromium-sso` with `testMatch: /e2e\/sso\/.*\.spec\.ts/` and `dependencies: ['chromium']`, so they run only after the whole default project. The `chromium` project gains `testIgnore: /e2e\/sso\//`.
   - Each SSO spec uses `test.describe.configure({ mode: 'serial' })` and resets the state in `afterAll`.
   - This is a spec-level choice the design did not settle (D-91 fixes only the stub-IdP host). It is flagged in context.md.
   - Known cost: a hard failure in `chromium` skips `chromium-sso`; CI `retries: 1` absorbs flakes.
5. **Fixtures (C-12)**: `e2e/fixtures/sso.ts` holds the stub issuer, the client IDs `xstockstrat-staging-mcp-claude[-ro]`, the SSO user (reuse `users.ts`'s user id and spread overrides) and the discovery-document builder. Export them from `fixtures/index.ts` and add `INVENTORY.md` catalog rows.
6. **Specs**:
   - **`sso-login.spec.ts`**:
     - **@AC-1:** sign in with SSO → lands on `/trader` with a session.
     - **@AC-29:** checked → cookies `Max-Age=1209600` plus `remember_me=1`. Intercept the `/start` body with `page.route` to assert `remember=1` only when checked (D-64).
     - **@AC-16:** flag off → only the SSO button and checkbox, no password field.
     - **@AC-17:** flag on → both.
     - **@AC-51:** access_denied → the no-access message.
     - **@AC-59:** a cross-origin `page.request.post` with an `Origin` header → `?error=failed`; GET → 405.
     - **@AC-54:** ui issuer `http://auth.example.test` → `?error=not_configured`, and `/.well-known/oauth-protected-resource/agent` → 503.
     - **@AC-58:** state with an invalid APP_URL is not reachable in one webServer, so AC-58 is covered by Steps 25/31/33. Note this in the spec header.
     - SSO-mode accessible names resolve uniquely (D-54).
   - **`sso-logout.spec.ts`**:
     - **@AC-53 / @AC-63 (SSO):** the header "Sign out" → cookies cleared and navigation to the stub `/logout?rd=…/auth/login`, caught with a `page.route()` intercept (D-64).
     - **@AC-56:** an invalid issuer → lands on `/auth/login`, not the stub.
     - **@AC-57 (SSO):** a cross-origin POST with cookies → 403, cookies unchanged.
     - **@AC-64:** an expired access cookie plus a refresh cookie → 200 JSON `ok`.
     - A mobile 375 px `/trader`: `scrollWidth <= clientWidth` and the button is in the viewport (D-63). If this fails, the fallback is the offcanvas sheet; log it in the Deviation Log.
   - **`sso-accounts.spec.ts`**:
     - **@AC-34 / @AC-48:** the Authelia link, the connector URL with copy, both client IDs, and no revoke button.
     - **@AC-49:** the protected-resource document lists the stub issuer, and the authorization-server document → 404.
   - **`auth.spec.ts`** (legacy, the default state):
     - **@AC-41:** no SSO button, and the password login lands on `/trader`.
     - **@AC-45:** flag off in legacy (via the state endpoint in a serial block) → the banner plus "password login disabled" on submit.
     - **@AC-46:** a `getConfig` failure knob → the legacy login.
     - **@AC-42:** `/accounts/authorized-apps` lists the grant with revoke.
     - **@AC-32 / @AC-44:** half-configured or cleared → no SSO button.
     - **@AC-57 (legacy):** a cross-origin POST with cookies → 403.
     - **@AC-63 (legacy):** Sign out → `/auth/login`.
     - The existing `:300-312` logout block stays green: `page.request.post` sends no Origin.
     - Specs touching the global state live in `e2e/sso/` or a serial block inside `chromium-sso`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run typecheck && pnpm run lint && pnpm exec playwright test --list | grep -c "sso/"
pnpm exec playwright test e2e/auth.spec.ts e2e/sso --project=chromium --project=chromium-sso
grep -n "from '../fixtures'\|from './fixtures'\|helpers/auth\|helpers/stubIdp" e2e/sso/*.spec.ts && grep -n "sso" e2e/fixtures/INVENTORY.md
grep -n "APP_URL" ../../docker-compose.yml playwright.config.ts
```

---

### Step 39 — docs: FR-13 docs, the cutover runbook and constitution updates

**Status**: `pending`
**Service**: `docs/`, service `CLAUDE.md` files and constitutions
**Files**:
- `docs/runbooks/mcp-tools.md` — modify
- `docs/runbooks/authelia-sso-cutover.md` — create
- `docs/patterns/frontend-auth.md` — modify
- `docs/patterns/database.md` — modify
- `docs/patterns/inter-service-mtls.md` — modify
- `docs/patterns/config-governance.md` — modify
- `CLAUDE.md` — modify (§ Inter-Service Dependencies)
- `services/xstockstrat-identity/CLAUDE.md` — modify
- `services/xstockstrat-identity/docs/context-constitution.md` — modify
- `services/xstockstrat-identity/docs/operations.md` — modify
- `services/xstockstrat-ui/CLAUDE.md` — modify
- `services/xstockstrat-agent/CLAUDE.md` — modify
- `services/xstockstrat-agent/docs/context-constitution.md` — modify
- `services/xstockstrat-agent/docs/oauth.md` — modify
- `services/xstockstrat-config/docs/context-constitution.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Constitution anchors:
  - `services/xstockstrat-identity/docs/context-constitution.md:27` (IDENTITY-15: "the seed email `admin@localhost` are read by another service's migration … analysis `029`").
  - The same file at `:25` (IDENTITY-12: `ListAdminUserIds` SAN-only).
  - `services/xstockstrat-agent/docs/context-constitution.md:15` (AGENT-1: "the two lifespan `WatchConfig` channels (`agent`, `indicators`; …)").
  - The same file at `:24` (AGENT-9: "only the `WATCHED_NAMESPACES` (`agent`, `indicators`) have a snapshot … Sites (N=5)").
  - `services/xstockstrat-config/docs/context-constitution.md:30` ("Seed values must equal the code default … Migration `049` … is another deliberate exception").
- Other anchors:
  - `docs/patterns/config-governance.md:145` "## Per-Feature Registered Keys".
  - Root `CLAUDE.md:283` "## Inter-Service Dependencies".
  - `services/xstockstrat-ui/CLAUDE.md` § Environment Variables lists no `APP_URL`; § Auth + BFF lists the auth files.
  - `services/xstockstrat-agent/CLAUDE.md:99` "## Config Keys Consumed".
  - `services/xstockstrat-identity/CLAUDE.md:57` "## Config Keys Consumed".
- `docs/runbooks/authelia-sso-cutover.md` does not exist (`ls`), so it is new (D-74, D-78).

**Lands with**: Step 40

**TDD**: N/A (docs; the RED/GREEN for AC-20/AC-36 is Step 40)

**Covers**: —

**Instructions**:
1. **`mcp-tools.md`** (FR-13, AC-20):
   - Connector setup for SSO mode, with the client IDs `xstockstrat-mcp-claude`, `xstockstrat-mcp-claude-ro`, `xstockstrat-staging-mcp-claude`, `xstockstrat-staging-mcp-claude-ro` and the redirect URI `https://claude.ai/api/mcp/auth_callback`.
   - The scope list (`xstockstrat.read|write|admin|trade`) and the narrowing rule.
   - Legacy mode keeps today's DCR flow.
2. **`authelia-sso-cutover.md`** (D-42, D-49 N-8/N-9, D-73, D-74, D-91, D-96, D-97, D-98):
   - **Pre-check:** the app VM reaches `auth.<domain>` for discovery and JWKS.
   - **APP_URL and issuer rules:** `APP_URL` has no trailing slash and matches the browser origin exactly. The issuer grammar covers trailing slashes, IP literals and IDN.
   - **Authelia requirements:** byte-exact redirect and audience; the ID-token and access-token `email` claims policies; `requested_audience_mode: implicit`.
   - **Cutover steps** (FR-14):
     1. Set `ui.oidc.client_id`, the secret and the MCP client IDs.
     2. Set both issuers.
     3. Verify one web login, one MCP connection and one logout using the signal list: `wrong_audience`, `jwks_unavailable`, `account_refused`, `ui.auth.events{sso_login_failed,reason|sso_login_error|logout reason=cross_origin}`, ERRORs `sso_issuer_invalid` / `app_url_invalid`.
     4. Run `reset-password` on the staging seed row.
     5. Set the flag `false`.
   - **Rollback:** config first (clear the issuers, flag `true`, verify AC-44), then code (identity first; `051` down is optional), then `reset-password` for CREATED users.
   - **Residuals:** D-61, R-14, D-73, D-74, D-81, D-78, D-98 (group removal does not end an MCP connection; disable in Authelia and/or deactivate), plus trader `BackfillBars` and analysis 029.
   - Local docker-compose SSO is unsupported.
3. **`frontend-auth.md`:** the SSO flow (start, callback, txn cookie, `IssueSessionForUser`), logout (step 0 Origin, verify, revoke, redirect) and the middleware sets.
4. **`database.md`:**
   - The schema map gains `identity.external_identities` and `users_email_lower_idx`.
   - IDENTITY-15 note: new migrations resolve the seed owner by `SEED_USER_ID`, never by `admin@localhost`.
5. **`inter-service-mtls.md`:** the new `ui` `GetSecret` grant and the two new SAN-gated identity RPCs.
6. **`config-governance.md` § Per-Feature Registered Keys:** a row per key from 051, with type, default, reader and live mechanism.
7. **Root `CLAUDE.md` § Inter-Service Dependencies:** add `xstockstrat-ui → xstockstrat-identity (ResolveExternalIdentity, IssueSessionForUser)`, `xstockstrat-agent → xstockstrat-identity (ResolveExternalIdentity)`, `xstockstrat-ui → xstockstrat-config (GetSecret, ui OIDC client secret)`, and the external HTTPS edges to Authelia from the UI and the agent.
8. **Identity docs:**
   - `CLAUDE.md` Config Keys gains `auth.password_login_enabled` (bool, default `false`, seeded `true`).
   - Ports/RPCs gain the two new RPCs.
   - `context-constitution.md`: IDENTITY-12 is extended to the two new per-RPC SAN lists. IDENTITY-15 gains: "admin@localhost may be renamed by SSO cutover (FR-12); new migrations resolve the seed owner by SEED_USER_ID" (AC-36).
   - `operations.md`: `update-email` / `unlink-sso` usage.
9. **UI `CLAUDE.md`:**
   - Environment Variables gains the `APP_URL` line from design.md (B) §D-67.
   - Config Keys Consumed gains `ui/oidc.*`, the `identity` / `agent` one-shot reads and the `GetSecret` read.
   - The Auth + BFF table gains the SSO routes, `oidcConfig.ts`, `oidcClient.ts`, `ssoTxn.ts` and `sameOrigin.ts`.
   - Testing: the `chromium-sso` project.
10. **Agent docs:**
    - `CLAUDE.md` Config Keys gains `agent/oidc.issuer` and the `ui/oidc.issuer` read.
    - `context-constitution.md`:
      - AGENT-1: the lifespan channels are now (`agent`, `indicators`, `ui`).
      - AGENT-9: `WATCHED_NAMESPACES` is (`agent`, `indicators`, `ui`), and the sites now include `app/sso_mode.py#current_sso_mode` and the SSO validator (`app/sso_auth.py`) (AC-36).
      - AGENT-8: `AGENT_PUBLIC_URL` is now read by `sso_auth.py` via `oauth_metadata`.
    - `docs/oauth.md`: the SSO-mode resource-server path, the 404 legacy routes and path-insertion.
11. **Config constitution (`:30`):** record migration `051` as a seed≠default exception (the flag seeded `true`, code default `false`; D-20). Also record the CONFIG-4 `user_id` omission in its notify (D-36).

**Verification**:
```bash
grep -c "xstockstrat-staging-mcp-claude-ro" docs/runbooks/mcp-tools.md
ls docs/runbooks/authelia-sso-cutover.md
node scripts/check-config-wiring.mjs --doc-check
```

---

### Step 40 — test: AC-20 and AC-36 documentation assertions

**Status**: `pending`
**Service**: `docs/`
**Files**:
- none. The check is the Verification block below: it runs RED before Step 39's edits and GREEN after (no file is created or changed).

**Reviewers**: none

**Codebase Evidence**:
- D-48: "AC-20/AC-36 are RED-assertion `grep -F` checks inside a named test step with `**Covers**: AC-20, AC-36`, accepted by the orchestrator as C-15 coverage."
- Insights.md:2940-2946: a construct-scoped presence RED→GREEN is a named `**Covers**` step, not a permanent CI guard.

**Lands with**: Step 39

**TDD**: red-green required (RED on the pre-Step-39 tree, GREEN after)

**Covers**: AC-20, AC-36

**Instructions**:
1. Run the Verification block before Step 39's edits and capture the RED (non-zero exit). Run it again after and capture the GREEN.
2. Add no CI guard (C-18; insights.md:2940-2946).

**Verification**:
```bash
set -e
for s in xstockstrat-mcp-claude xstockstrat-mcp-claude-ro xstockstrat-staging-mcp-claude xstockstrat-staging-mcp-claude-ro "https://claude.ai/api/mcp/auth_callback"; do grep -qF "$s" docs/runbooks/mcp-tools.md; done   # @AC-20
grep -F "SEED_USER_ID" services/xstockstrat-identity/docs/context-constitution.md | grep -qF "admin@localhost"   # @AC-36 IDENTITY-15
grep -F "AGENT-9" services/xstockstrat-agent/docs/context-constitution.md | grep -F '`ui`' | grep -F '`agent`' | grep -qF '`indicators`'   # @AC-36 AGENT-9
echo GREEN
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
