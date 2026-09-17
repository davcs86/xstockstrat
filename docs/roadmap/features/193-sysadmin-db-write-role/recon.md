# Recon: sysadmin-db-write-role

**Created**: 2026-09-17
**From**: product-spec.md
**Affected services**: xstockstrat-agent, xstockstrat-identity, xstockstrat-ui, xstockstrat-config (mirror site), scripts/manage-users.py

---

## Objective

Introduce a new `sysadmin` role + SYSADMIN access-scope bit (`0x10`) that is the sole privilege
permitted to execute write/destructive SQL through the MCP agent's `db_execute_sql` tool (reads stay
at ADMIN `0x04`), grantable only via `scripts/manage-users.py` (kept out of the closed proto `Role`
enum so consumer RPCs cannot express it). Closes security-audit finding **H-5**: a prompt-injected
admin session can currently drive `confirm=true` arbitrary cross-schema writes. Per operator decision
this session, an **additive non-breaking field** on the identity `User` message surfaces sysadmin in
admin views (FR-6).

## Codebase Map

- **`xstockstrat-agent`** (Python)
  - `db_execute_sql` tool: `services/xstockstrat-agent/app/tools.py:1993-2020` — admin gate `if not (access_scope & 0x04)` at `:2005-2006`; `_is_destructive(sql) and not confirm` → dry-run at `:2008-2017`; forwards `postgres_mcp_client.call_tool("execute_sql", …)` at `:2019`; docstring "SELECT and INSERT execute immediately" `:2000`.
  - `_is_destructive`: `app/tools.py:247-273`; verbs `_DESTRUCTIVE_KEYS = {"update","delete","drop","truncatetable"}` `:241`; regex `UPDATE|DELETE|DROP|TRUNCATE` `:244`; three-tier (sqlglot AST → Command-node safe-default `True` `:259-261` → regex fallback `:267`). **INSERT is NOT gated** (`tests/test_db_tools.py:37-38`).
  - `roles_to_access_scope`: `app/scopes.py:39-54`; bit consts `_READ=0x01/_WRITE=0x02/_ADMIN=0x04/_TRADING=0x08` `:33-36` (no `0x10`); mapping `:48-53`; module docstring `:1-11` names the mirror sites.
  - All nine `db_*` tools use inline `& 0x04` (not `_require_admin`): `:1961,1972,1985,2005,2028,2039,2049,2060,2072`. `_caller_access_scope` `:123-132`; `_require_admin` `:135-141` (user-admin tools only).
  - Scope derivation: **verified JWT roles** — `app/auth.py:49-84` (`validate_bearer_claims` → identity `ValidateToken`, roles `:77`), stamped on ASGI scope `app/main.py:130-146`, read per-call `app/tools.py:100-102`. Never a forwarded `x-access-scope` header.
  - `list_users`/`get_user`: `app/tools.py:1485-1504` → `client.list_users`/`get_user`; `_project_user` `app/client.py:1367-1375` reads enum `u.roles` and `"roles": [_ROLE_ENUM_TO_STRING[r] for r in u.roles if r in _ROLE_ENUM_TO_STRING]` `:1372` — **silently drops** unknown enum. `ROLE_STRING_TO_ENUM = {"admin":1,"trader":2,"viewer":3}` `:1363`.
  - `manage_user`: `app/tools.py:1459-1466`; `_VALID_ROLES = {"admin","trader","viewer"}` `:1421`; `_validate_roles` `:1450-1456`; `create_user`/`set_user_roles` encode through closed `ROLE_STRING_TO_ENUM` (`client.py:1396-1397,1431-1432`) — sysadmin inexpressible.
  - Config-read: `client.py:1559-1587` one-shot `GetConfig` (no `WatchConfig` stream); no `agent.*` key gates db tools.
  - Test home: `tests/conftest.py` (claim dicts `ADMIN`/`TRADER`/`VIEWER` `:12-14`, `_ctx` builder `:17-27`); `tests/test_db_tools.py` (`_is_destructive` `:34-58`, admin-gate `:76-80`, confirm `:86-125`). Acceptance: `services/xstockstrat-agent/acceptance/agent-postgres-mcp.feature`.

- **`xstockstrat-identity`** (Node.js)
  - JWT mint: `src/grpc/identityServiceImpl.ts` `AuthenticateUser` (`:132,166-172,174,195`), `RefreshToken` (`:249,259`), OAuth mint (`:320,328`) — copy raw DB `roles` strings into claim untouched. `TokenClaims.roles = repeated string` (`packages/proto/identity/v1/identity.proto:63`).
  - Closed `Role` enum: `identity.proto:166-171` `{ROLE_UNSPECIFIED=0, ROLE_ADMIN=1, ROLE_TRADER=2, ROLE_VIEWER=3}` (no sysadmin). `CreateUserRequest.roles` `:185`, `SetUserRolesRequest.roles` `:203` — both `repeated Role`.
  - `User` message: `identity.proto:174-180`, roles typed `repeated Role roles = 3`; fields user_id=1/email=2/roles=3/is_active=4/created_at=5 → **next free field number = 6**.
  - Row→proto mapper: `toUserView(row)` `identityServiceImpl.ts:42-50` → `stringsToRoles` `:22-25` collapses unknown string → `0` (UNSPECIFIED). Used by `getUser` `:788,798`, `listUsers` `:775,781`, `createUser` `:747,767`, `setUserRoles` `:835,871`.
  - Identity authz: `authz.ts:10` `ADMIN_SCOPE=0x04` + `hasAdminAccessScope(md)` `:28-32` (reads inbound header); `adminGate` `identityServiceImpl.ts:740` on all 8 admin RPCs. Identity does NOT derive scope from roles.
  - Schema: `identity.users.roles TEXT[] NOT NULL DEFAULT '{"trader"}'` `migrations/001_identity_tables.up.sql:10`; latest migration `006` → next `007` (no migration needed — sysadmin is a value, not a column).
  - Test home: `src/__tests__/identityServiceImpl.test.ts` (inline `USER_ROW` `:718`; role/enum/claim tests `:136-158,744-773,812-871`; adminGate scope tests `:701,710`). No shared `fixtures/` dir.

- **`scripts/manage-users.py`** (Python, direct psycopg to Postgres)
  - `VALID_ROLES = ["admin", "trader"]` `:43` (no `viewer`, no `sysadmin`); `_validate_roles` `:121-137` (rejects unknown `:128`).
  - `create-user` `:214` (SQL `:236-237`, `%s::text[]`); `update-roles` `:322` (SQL `:372-375`); `list-users` `:270` (SQL `:282-288`, renders roles `:313-317`).
  - Connection: `DATABASE_URL`/`.env`, `psycopg.connect(db_url)` `:178,234,291,335` (local-dev fallback `localhost:5432`).

- **`xstockstrat-ui`** (Next.js)
  - `rolesToAccessScope`: `src/lib/auth.ts:81-92`; `ADMIN_SCOPE=0x04` exported `:79`; `READ=0x01/WRITE=0x02/TRADING=0x08` are **function-local** consts `:82-84`; role match on strings `:87-89`; `hasAdminScope` `:95-96`.
  - Admin-gate chokepoint: `src/lib/bffShared.ts:46-51` (`requireAdminScope`→`hasAdminScope`), scope header `:38-44` (`String(rolesToAccessScope(claims.roles))`), `forwardAdmin` `:60-80`. Consumers: `configUiBff.ts:31,60,66-69,72,77`; audit route `src/app/config-ui/api/audit/route.ts:45` (H-6 fix). Scope-header forwarders (no gate): `restBackendHeaders.ts:6,12`, `trader/api/ledger/export/route.ts:6,103`.
  - Admin users view: `src/app/config-ui/users/page.tsx` renders proto `Role` **enum** (`:29,46,147,326,337`); `roleLabels.ts:5-13` — `ROLE_LABELS: Record<Role,string>` **exhaustive** (tsc-enforced), `ASSIGNABLE_ROLES=[ADMIN,TRADER,VIEWER]` `:13`, `rolesLabel` filters `'—'` `:16-19`.
  - Anti-spoof: scope/user headers rebuilt per-outbound-call in `bffShared.ts:38-44` from verified `claims` (`verifyAccessToken` `auth.ts:22-31`, jose HS256/`JWT_SECRET`); `middleware.ts` only verifies cookie + injects `x-trace-id`.
  - DRY guard: `.eslintrc.json:13-14,21-22` bans raw `x-access-scope`/`0x04` outside `src/lib/{headers,auth}.ts`.
  - Test data: `e2e/helpers/auth.ts:29` `signTestJwt(roles: string[])`, `:70-72` `addAdminCookie`→`['admin']`; `e2e/fixtures/users.ts` (`USER_VIEW_*` with proto `Role` enums `:31-58`, `LAST_ADMIN_USER_ID` `:27`); `e2e/config-ui/users.spec.ts`. Vitest `src/lib/auth.test.ts` covers only cookie/session helpers — **`rolesToAccessScope`/`hasAdminScope` untested** (coverage gap for the function gaining the bit).

- **`xstockstrat-config`** (Node.js — mirror/CHECK site only)
  - `authz.ts:8` `ADMIN_SCOPE=0x04`, `hasAdminAccessScope` `:20-24`; consumed only by `SetConfig` global-write branch `configServiceImpl.ts:366-371`. `GetSecret` gated by `x-internal-caller` allow-list `:318` (not the scope bit); `GetConfig`/`ListKeys`/`WatchConfig` ungated (reads open).

## Patterns to REUSE

- **New scope bit + role mapping** → extend the two existing DERIVE sites exactly: `roles_to_access_scope` (`app/scopes.py:39-54`) and `rolesToAccessScope` (`src/lib/auth.ts:81-92`). Add `_SYSADMIN=0x10`/`SYSADMIN=0x10` alongside the existing bit consts and a `sysadmin` role branch. These two are the ONLY roles→bitmap producers in the platform (cross-repo grep confirmed).
- **Write-vs-read gate on `db_execute_sql`** → reuse the existing `_is_destructive` classifier (`app/tools.py:247-273`) as the write/read discriminator; add the SYSADMIN check on the destructive branch. Do NOT invent a new classifier.
- **Role-string allow-list** → extend `manage-users.py` `VALID_ROLES` (`:43`) + agent `_VALID_ROLES` (`tools.py:1421`) — the latter must NOT gain `sysadmin` (keeps it inexpressible via `manage_user`); only the script's allow-list gains it.
- **Additive `User` proto field (FR-6)** → append at field number **6** on the `User` message (`identity.proto:174-180`); a **non-enum** field (`bool is_sysadmin = 6` or `repeated string role_strings = 6`) — NOT a `Role` enum value. Update the row→proto mapper `toUserView` (`identityServiceImpl.ts:42-50`) in lockstep (fails.md 2026-08-05 trap), then the two consumer read-paths: agent `_project_user` (`client.py:1367-1375`) and UI `users/page.tsx`+`roleLabels.ts`.
- **Test fixtures** → agent: extend `tests/conftest.py` claim dicts + `tests/test_db_tools.py`; identity: extend `identityServiceImpl.test.ts` role/enum tests; UI: reuse `e2e/helpers/auth.ts signTestJwt(['sysadmin'])` + `e2e/fixtures/users.ts` (C-12/C-13). Add the missing vitest coverage for `rolesToAccessScope`/`hasAdminScope`.
- **Contract-encoding scope tests** → update `test_config_tools.py:49-51` (add `sysadmin==31`; admin stays 15) and `setConfigAuthz.test.ts:55` (unchanged, `ADMIN_SCOPE==4`).

## Existing Business Rules (preserve / extend)

_Constitution **C-16** — folded from `scenario-recon`._
- **CHANGE** `@AC-13` "Destructive DML executes after explicit confirmation" (`services/xstockstrat-agent/acceptance/agent-postgres-mcp.feature`) — today an ADMIN (`0x04`) + confirm forwards a write; feature restricts write execution to SYSADMIN (`0x10`). **Requires user sign-off recorded in `context.md`** (silent change = C-16 regression). `@feature-169` provenance must survive re-authoring.
- **CHANGE** `@AC-12` "Destructive DML (UPDATE) is blocked without confirmation" (`agent-postgres-mcp.feature`) — confirm-gate mechanics preserved, but the write-privilege actor moves ADMIN→SYSADMIN. **Requires user sign-off recorded in `context.md`.**
- **PRESERVE** `@AC-5` "Admin invokes a read/analysis `db_` tool" (`agent-postgres-mcp.feature`) — reads/analysis stay gated at ADMIN `0x04`; must not rise to SYSADMIN.
- **PRESERVE** `@AC-6` "Non-admin rejected for any `db_` tool" — a caller lacking `0x04` stays denied everything (reads included).
- **PRESERVE** `@AC-7` "Unauthenticated caller cannot discover/invoke `db_` tools" — 401, no tool names leaked.
- **PRESERVE** `@AC-4` "postgres-mcp DML-role: INSERT ok, CREATE TABLE denied" — the DB-role DML/DDL boundary under `db_execute_sql` is untouched; feature only adds a scope gate above it.
- **EXTEND** `@AC-2` "Admin replaces roles via `manage_user set_roles`" (`services/xstockstrat-agent/acceptance/mcp-user-profile-roles.feature`) — sysadmin added as a role NOT grantable via `manage_user`; admin/trader assignment unaltered.
- **PRESERVE** `@AC-1` "Admin creates user via `manage_user`" / `@AC-9` "Non-admin denied every management tool" (`mcp-user-profile-roles.feature`).
- **EXTEND** `@AC-4` "Admin assigns/removes roles" (`services/xstockstrat-identity/acceptance/user-management-ui.feature:36`) — SetUserRoles stays limited to the closed proto `Role` enum; sysadmin kept OUT of that enum. **Design must NOT add `SYSADMIN` to the proto `Role` enum** (doing so flips this EXTEND→CHANGE).
- **EXTEND** `@AC-2` "Admin creates a user who can sign in" — CreateUser role set stays closed-enum.
- **EXTEND** `@AC-1` "Admin lists all users" — additive non-breaking `User` field surfaces sysadmin; existing fields (email/roles/active/created, no password) unchanged.
- **PRESERVE** `@AC-7` "Non-admin denied every user-management RPC" / `@AC-10` (identity) "server-side `0x04` gate authoritative".
- **PRESERVE** `@AC-11` "Last active admin cannot be deactivated/demoted" (`user-management-ui.feature:74-83`) — **AMBIGUITY**: guard is worded on the literal `admin` role STRING; must confirm a sysadmin-role user still satisfies it (see Risks).
- **EXTEND** `@AC-9` "Users section reachable within config-ui" (`services/xstockstrat-ui/acceptance/user-management-ui.feature`) — admin list surfaces sysadmin via the additive field.
- No relevant existing acceptance guarantee for `xstockstrat-config` (suites cover secrets/scoping/config-keys only) — but its `SetConfig` `0x04` gate meaning must stay intact (superset admits sysadmin unchanged).

## Dependencies

- Proto/RPC: **one additive, non-breaking field** on `User` (`packages/proto/identity/v1/identity.proto:174-180`, next field number **6**). NO change to `Role` enum, `TokenClaims.roles` (already `repeated string`), `CreateUser`/`SetUserRoles`. Governance: 1 service owner (non-breaking add). Run `./scripts/buf-gen.sh` + `buf lint`/`buf breaking`.
- Migration: **none** — `identity.users.roles` is an existing `TEXT[]`; `sysadmin` is a new value in the array.
- Config keys: **none** — SYSADMIN is a compile-time scope-bit constant, not a `WatchConfig` value.
- Inter-service edges: agent → identity (`ValidateToken` for JWT-roles→scope; `list_users`/`get_user`); UI BFF → identity (`ListUsers`/`GetUser`). No new edges.
- New env vars / ports: **none**.

## Risks / Not-found

- **[CHANGE sign-off — C-16 blocker]** The ADMIN→SYSADMIN move on `db_execute_sql` write (`@AC-12`/`@AC-13 @feature-169`) is a deliberate change to a launched business rule. Must be **explicitly signed off and recorded in `context.md`** before the design is approved (this is the feature's whole purpose, so sign-off is expected — but it must be recorded, not implied).
- **[Last-admin guard vs superset — correctness fork]** `@AC-11`'s last-admin guard is keyed on the `admin` role STRING (`user-management-ui.feature:74-83`), while FR-5's superset is a BIT relationship (sysadmin ⇒ 0x04|0x10). If a sysadmin user does not literally carry the `admin` role string, the guard could miscount and permit removing the last admin. Design must resolve: (a) require sysadmin users to also hold `admin` (role-level superset), or (b) teach the guard to count sysadmin. **Genuine risk — must be decided in the debate.**
- **[FR-6 consumer read-paths]** Adding the `User` field is necessary but NOT sufficient: both `_project_user` (`client.py:1372`, reads enum `u.roles`) and the UI `users/page.tsx`/`roleLabels.ts` (render enum) currently read the ENUM roles and would still hide sysadmin. Each must be pointed at the new non-enum field. This is more than a proto add.
- **[Enum-lockout invariant]** Adding `SYSADMIN` to the closed proto `Role` enum would (a) trip the C-10(a/d) exhaustive-map trap — UI `roleLabels.ts Record<Role,string>` (tsc-enforced) + agent `_project_user` map + insights 2026-07-26 authz-switch enumeration — AND (b) make consumer RPCs able to express sysadmin, defeating FR-3. **The design's central invariant: sysadmin is a role STRING + scope BIT, never a proto enum value.**
- **[Audit gap]** Granting sysadmin via `manage-users.py` (direct DB write) emits no `SetUserRoles` ledger event (`@AC-8` not violated — it names RPCs — but the audit trail for sysadmin grants is script-side only, per FR-6/AC-11).
- **[fails.md 2026-08-05 blanket-admin trap]** Already structurally avoided — both the agent and UI derive scope from verified JWT roles, never a forwarded `x-access-scope` header. Design must preserve this (never forward an unauthenticated blanket sysadmin scope).
- **[Bit-collision check]** `0x10` (16) is distinct from existing `0x01/0x02/0x04/0x08`; grep confirmed no existing `0x10`/`SYSADMIN` anywhere. No collision.
- **[Not found]** The `xstockstrat_agent` Postgres DML role GRANT/CREATE ROLE is not in `services/xstockstrat-agent/` (provisioned outside this service) — out of scope per product-spec (Postgres grant-level unchanged).
- **[Doc-drift, non-blocking]** UI `docs/context-constitution.md:24` (UI-4) cites stale `auth.ts` line numbers; the invariant (bitmap parity with every backend `& 0x04` check) should be extended to `0x10`.
- **[Pre-existing gap]** `manage-users.py VALID_ROLES` omits `viewer` (present in the enum); FR-3 edit adds `sysadmin` and may note this gap.
- **[Test coverage gap]** `src/lib/auth.ts` `rolesToAccessScope`/`hasAdminScope` have no vitest coverage today; the SYSADMIN mirror is greenfield with no regression guard — the feature's own `@AC-9` (both derivations set the bit) is the new guard; add the vitest test.

## Recommended Scope

_Advisory step boundaries — input to the grilling and `/sdd-spec`, not binding._
1. **Scope-bit derivation (2 mirrors)** — add `SYSADMIN=0x10` + `sysadmin` mapping to `app/scopes.py` and `src/lib/auth.ts`; superset (sysadmin ⇒ 0x04|0x10). Paired tests incl. the new vitest for `rolesToAccessScope`/`hasAdminScope`. (Covers @AC-9, @AC-10.)
2. **`db_execute_sql` write-gate** — split the existing `& 0x04` gate: reads stay 0x04, `_is_destructive` (extended to gate INSERT + all non-read) requires `& 0x10`, fail-closed. Update agent conftest/`test_db_tools.py`. (Covers @AC-1..4, @AC-8; CHANGES @AC-12/@AC-13.)
3. **Assignment lockout + sole path** — `manage-users.py VALID_ROLES += sysadmin`; confirm agent `_VALID_ROLES`/`ROLE_STRING_TO_ENUM` and proto `Role` enum stay unchanged (structural inexpressibility). (Covers @AC-5, @AC-6, @AC-7.)
4. **FR-6 additive `User` field** — `identity.proto` field #6 (non-enum) + `toUserView` lockstep + agent `_project_user` + UI `users/page.tsx`/`roleLabels.ts` read-paths + fixtures. `buf` gates. (Covers @AC-11 audit surfacing.)
5. **Last-admin-guard resolution** — implement whichever option the debate picks (role-level superset vs guard-counts-sysadmin) with a regression test.
