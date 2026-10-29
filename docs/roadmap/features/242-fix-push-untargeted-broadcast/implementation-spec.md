# Implementation Spec: fix-push-untargeted-broadcast

**Status**: `pending`
**Created**: 2026-10-21
**Feature**: `docs/roadmap/features/242-fix-push-untargeted-broadcast/feature.md`
**Total Steps**: 16
**Feature Branch**: `feature/fix-push-untargeted-broadcast`

---

## Execution Summary

Follows design.md § Chosen Approach build order (`design.md:22-23`): proto → identity → notify →
portfolio → analysis → docs → C-14 follow-up. The additive `IdentityService.ListAdminUserIds` RPC and
its stubs land first (Steps 1-2) because both the identity handler (Steps 3-4) and the notify client
(Steps 5-8) compile against the generated `IdentityServiceService` / `IdentityServiceClient`. Notify is
split into the AdminDirectory client + env wiring (Steps 5-6) and the dispatcher audience change
(Steps 7-8) so the single-flight/deadline/trio seam is proven before the dispatcher depends on it.
Portfolio and analysis owner-targeting (Steps 9-12) are independent of the identity/notify chain and
may run in parallel with Steps 3-8. Docs, agent wording and the C-14 trading follow-up close the
feature (Steps 13-16; platform docs Step 14, service docs Step 15, split per the 5-file advisory). No migration and no config key (`design.md:88`; product-spec Fix Scope).

`acceptance.feature` already holds @AC-1..@AC-11 (design.md item 8 was applied at /sdd-design,
`context.md` 2026-10-21 "acceptance.feature: @AC-8..@AC-11 minted from the feature branch"); no
acceptance-minting step is needed and IDs are not renumbered (C-15).

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| @AC-1 untargeted alert not pushed to non-admins; EmitAlert returns id; StreamAlerts unchanged | Step 8 |
| @AC-2 targeted alert reaches only target's devices | Step 8 |
| @AC-3 portfolio concentration alert targeted at owner | Step 10 |
| @AC-4 live-loop strategy trigger targeted at owner | Step 12 |
| @AC-5 untargeted alert pushed only to admin devices | Step 8 |
| @AC-6 portfolio drawdown alert targeted at owner | Step 10 |
| @AC-7 live-loop fundamentals-unavailable targeted at owner | Step 12 |
| @AC-8 demoted/deactivated admin stops receiving on next alert | Steps 6, 8 |
| @AC-9 `ListAdminUserIds` returns active admin IDs only to notify peer | Step 4 |
| @AC-10 non-notify peers denied before touching `identity.users` | Step 4 |
| @AC-11 identity lookup failure never fails/delays EmitAlert, no push, one ERROR / 60s | Steps 6, 8 |

### Consumer Surfaces (C-14)

- PWA device notifications (`/trader`, `/insights`, `/config-ui`): reached by the notify dispatcher
  change (Step 7). No `xstockstrat-ui` code change: the UI only registers subscriptions
  (`services/xstockstrat-ui/src/app/accounts/notifications/PushToggle.tsx:80`, recon.md:387-389) and the
  audience is resolved server-side.
- Agent MCP tool `emit_alert`: wording-only update in Step 13 (`design.md:218`).
- In-app StreamAlerts/ListAlerts: unchanged by design (`design.md:217`).
- Trading per-account CRITICAL alerts: deferred to provisional follow-up slug `fix-trading-account-alert-targeting`
  via Step 16 (C-14, `design.md:207-212`); its `NNN` is assigned only when `/sdd-triage --from-report` runs.

### Launch gate (non-waivable, `design.md:254`)

Before `/promote` flips this feature to `launched`: on dev, an admin device receives an untargeted
`ALERT_SEVERITY_WARNING` push and a non-admin device does not. Record the result in `context.md`.

## Step Dependencies

- Step 2 requires Step 1: stubs are generated from the edited `identity.proto`.
- Steps 3, 5 require Step 2: `IdentityServiceService.listAdminUserIds` (identity) and
  `IdentityServiceClient` (notify) are generated symbols.
- Step 4 [test] covers Step 3 [service]; Step 6 [test] covers Step 5 [service]; Step 8 [test] covers
  Step 7 [service]; Step 10 [test] covers Step 9 [service]; Step 12 [test] covers Step 11 [service].
  Each test step is authored to fail against the pre-implementation tree (P-06).
- Step 7 requires Step 5: `WebPushDispatcher` takes the `AdminDirectory` type.
- Steps 9-12 are independent of Steps 1-8.
- Steps 14, 15 require Steps 3, 5, 7: docs describe the shipped notify→identity edge. Step 15 runs the
  Teardown audit for both docs steps, so it follows Step 14.
- Step 16 must be committed before the integration PR merges (`design.md:207-210`).
- No `xstockstrat-ui` step (C-14): the UI only registers subscriptions (`PushToggle.tsx:80`) and the push
  audience is resolved server-side in notify; `PushToggle.tsx` / `AlertInbox.tsx` carry no broadcast copy
  (grep, /sdd-review impl-spec 2026-10-21).
- Merge-order coupling (`design.md:263`; overlap re-scan 2026-10-21): `215-block-fundamentals-strategy-on-etf`
  (status `in-progress`) also edits `_emit_fundamentals_unavailable_alert`
  (`services/xstockstrat-analysis/app/engine/live_loop.py:847-861`). Whichever merges second rebases and
  keeps `target_user_id=definition.user_id`. Open defect
  `docs/reports/2026-10-19-portfolio-concentration-logged-as-drawdown-defect.md` edits `emitRiskAlert`
  (`portfolio_service.go:1004-1018`); the later fix keeps the `userID` parameter and `TargetUserId`.
  No other in-flight feature references `identity.proto`, `webPush.ts`, `emitRiskAlert`,
  `identityServiceImpl.ts` or `identity/src/index.ts` (grep of non-terminal feature dirs, 2026-10-21).
  `252-fix-identity-ledger-test-suites` (draft) may move identity to compile-then-test and touch
  `services/xstockstrat-identity/src/__tests__/mtls.test.ts` (Step 4); whichever lands second re-verifies the
  runner and import style. Step 15 files overlap open defects `docs/reports/2026-10-19-notify-claude-md-drift-defect.md`
  and `docs/reports/2026-10-19-identity-claude-md-drift-defect.md`; expect rebases there.
  Branch vs `origin/main-dev`: no diff on any file this spec touches (`git diff HEAD origin/main-dev`).

---

### Step 1 — proto: add `IdentityService.ListAdminUserIds`

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/identity/v1/identity.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking change, `buf lint`/`buf breaking` pass; `xstockstrat-identity` owner — JWT expiry and rotation, API key scoping; `xstockstrat-notify` owner — stream delivery guarantees, backpressure handling, alert deduplication

**Codebase Evidence**:
- `rpc ListUsers(ListUsersRequest) returns (ListUsersResponse);` at `packages/proto/identity/v1/identity.proto:41`, inside the feature-043 admin block (`:38-45`); service closes at `:46`.
- `message ListUsersRequest {}` / `message ListUsersResponse { repeated User users = 1; }` at `:189-190` — the empty-request / repeated-response shape to mirror.
- No existing `ListAdminUserIds` symbol: grep of `packages/proto` returns none.

**TDD**: N/A (proto — non-code-bearing)

**Covers**: —

**Instructions**:
1. After the `SetUserActive` rpc (`identity.proto:45`), before `}` (`:46`), add a 2-line comment and the rpc:
   ```proto
   // Active admin user IDs for notify's push audience (feature 242). Authorized by mTLS peer SAN
   // xstockstrat-notify only; every request header is ignored.
   rpc ListAdminUserIds(ListAdminUserIdsRequest) returns (ListAdminUserIdsResponse);
   ```
2. After `message SetUserActiveResponse` (`:211`), append:
   ```proto
   message ListAdminUserIdsRequest {}
   message ListAdminUserIdsResponse { repeated string user_ids = 1; }
   ```
3. No other message, field or enum changes (`design.md:25-32`).

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against "$(git rev-parse --path-format=absolute --git-common-dir)#branch=main-dev,subdir=packages/proto"
```
(PLAT-10: the `subdir=packages/proto` qualifier is mandatory, `docs/context-constitution.md:44`.) Against
`main-dev`, the trunk `scripts/buf-gen.sh:37-41` defaults to; needs a local `refs/heads/main-dev` (same
precondition as `:38`). `--git-common-dir` because `.git` is a file in a git worktree.
Identity-owner proto approval recorded in `context.md` before Step 2 commits (C-09, `design.md:30-31`).

---

### Step 2 — proto-gen: regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/identity/v1/identity.pb.go` — modify (generated)
- `packages/proto/gen/go/identity/v1/identity_grpc.pb.go` — modify (generated)
- `packages/proto/gen/go/identity/v1/identityv1connect/` — modify only if regenerated
- `packages/proto/gen/python/identity/v1/identity_pb2.py` — modify (generated)
- `packages/proto/gen/python/identity/v1/identity_pb2_grpc.py` — modify (generated)
- `packages/proto/gen/python/identity/v1/__init__.py` — modify only if regenerated
- `packages/proto/gen/ts/identity/v1/identity.ts` — modify (generated)
- `packages/proto/gen/ts/identity/v1/identity_pb.ts` — modify (generated)
- `packages/proto/gen/ts/identity/v1/identity_connect.ts` — modify (generated)
- `packages/proto/gen/ts/dist/identity/v1/identity.js`, `identity.d.ts`, `identity_pb.js`, `identity_pb.d.ts` — modify (compiled; tracked via `.gitignore:27` `!packages/proto/gen/ts/dist/`)

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking change, `buf lint`/`buf breaking` pass; `xstockstrat-identity` owner — JWT expiry and rotation, API key scoping; `xstockstrat-notify` owner — stream delivery guarantees, backpressure handling, alert deduplication

**Codebase Evidence**:
- `./scripts/buf-gen.sh` runs `buf breaking … subdir=packages/proto` (`scripts/buf-gen.sh:41`, only when `refs/heads/main-dev` exists, `:38`) then `buf generate` (`:48`).
- TS plugin `protoc-gen-ts_proto` with `outputServices=grpc-js`, `stringEnums=true` (`packages/proto/buf.gen.yaml:22-30`) emits `<Service>Service` + `<Service>Client`; precedents: `IdentityServiceService` import at `services/xstockstrat-identity/src/index.ts:6`, `LedgerServiceClient` at `services/xstockstrat-identity/src/grpc/ledgerAudit.ts:8`, `ConfigServiceClient` at `services/xstockstrat-config/src/__tests__/listKeysWire.test.ts:67`.

**TDD**: N/A (proto-gen — generated code)

**Covers**: —

**Instructions**:
1. Run `./scripts/buf-gen.sh` from repo root.
2. Stage the proto source change (Step 1) and the regenerated stubs together. Never hand-edit `gen/`.

**Verification**:
```bash
./scripts/buf-gen.sh && git status --porcelain packages/proto/gen/ | grep -v "identity/v1" ; echo "non-identity gen drift above must be empty"
./scripts/buf-gen.sh && git diff --exit-code packages/proto/gen/   # second run after staging: empty diff (proto-freshness)
```

---

### Step 3 — service: identity `ListAdminUserIds` handler (SAN-gated, header-blind)

**Status**: `done`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/grpc/adminDirectory.ts` — create
- `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts` — modify

**Reviewers**: `xstockstrat-identity` owner — JWT expiry and rotation, API key scoping, secret store integration; Security — auth scope (cross-user data exposure; the new RPC's only authorization is the mTLS peer SAN)

**Codebase Evidence**:
- `peerDnsSans(call)` to copy verbatim: `services/xstockstrat-config/src/grpc/authz.ts:135-142` (parses `getAuthContext()?.sslPeerCertificate?.subjectaltname`, keeps `DNS:` entries). Call shape `SecretCallerCall` at `:129-132`. Runtime copy #2 (C-18; `design.md:281`).
- Admin predicate source: `WHERE user_id <> $1 AND is_active = true AND 'admin' = ANY(roles)` at `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:855` (second copy in `setUserActive` at `:897`); the new query drops `user_id <> $1` (`design.md:47-50`).
- `identity.users.user_id UUID`, `roles TEXT[]`, `is_active BOOLEAN` at `services/xstockstrat-identity/migrations/001_identity_tables.up.sql:7,10,11`.
- Error-echo anti-pattern NOT to copy: `callback({ code: 13, message: err.message })` at `identityServiceImpl.ts:788` (the pattern recurs 15 times in the file) (`design.md:51-52`).
- `IdentityServiceImpl` holds `private readonly pool: Pool` (`identityServiceImpl.ts:105-106`); class closes at file end (`:935`) after `setUserActive` (starts `:882`). Registered via `grpcServer.addService(IdentityServiceService, identityImpl as unknown as grpc.UntypedServiceImplementation)` (`services/xstockstrat-identity/src/index.ts:50-53`) — the generated descriptor routes `listAdminUserIds` to the impl method of that name, so `index.ts` needs no change.
- `adminGate` (`identityServiceImpl.ts:739-749`) and `authz.ts` stay byte-identical (`@AC-7 @feature-043`, `design.md:53-54`).
- Header propagation: the handler makes **no** outbound call (step-constraints §B header row N/A).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Create `services/xstockstrat-identity/src/grpc/adminDirectory.ts`. Imports **only** `import * as grpc from '@grpc/grpc-js';` and `import type { Pool } from 'pg';` — no relative imports, no logger (`design.md:35-36`).
2. First lines: a ≤2-line constraint comment, e.g.
   `// No relative imports (loads under strip-types). Header-blind by design: authorization is the mTLS`
   `// peer SAN only; never read x-access-scope / x-user-id / x-internal-caller here.`
3. Module-private:
   - `const ADMIN_DIRECTORY_PEER_SANS = ['xstockstrat-notify'] as const;`
   - `peerDnsSans(call)` copied verbatim from `config/src/grpc/authz.ts:135-142` (typed against a local
     `interface AdminDirectoryCall { getAuthContext?: () => { sslPeerCertificate?: { subjectaltname?: string } } | undefined }`).
   - `hasAdminDirectoryPeer(call): boolean` — `peerDnsSans(call).some((s) => (ADMIN_DIRECTORY_PEER_SANS as readonly string[]).includes(s))` (exact match; no prefix/suffix).
   - `const PEER_SAN_ERROR = { code: grpc.status.PERMISSION_DENIED, message: 'peer not authorized for ListAdminUserIds' };`
4. Export `async function listAdminUserIds(pool: Pool, call: AdminDirectoryCall, callback: grpc.sendUnaryData<{ userIds: string[] }>)`:
   1. If `!hasAdminDirectoryPeer(call)` → `callback(PEER_SAN_ERROR)` and return **before any `pool` access**.
   2. `const r = await pool.query("SELECT user_id::text AS user_id FROM identity.users WHERE is_active = true AND 'admin' = ANY(roles)")`; `callback(null, { userIds: r.rows.map((x) => x.user_id) })`. IDs only — no email/roles/flags (@AC-9).
   3. On throw → `callback({ code: grpc.status.INTERNAL, message: 'admin directory lookup failed' })` — generic; never include the thrown text.
5. In `identityServiceImpl.ts`: add `import { listAdminUserIds } from './adminDirectory';` beside the `./ledgerAudit` import (`:9`), and a one-line delegate method at the end of the class:
   `async listAdminUserIds(call: any, callback: any) { return listAdminUserIds(this.pool, call, callback); }`
   No other line in the file changes.
6. Canonical form (`design.md:261`): `user_id::text` yields the lowercase hyphenated UUID; that equals the `x-user-id` notify stores at register (`identityServiceImpl.ts:167` JWT `user_id: user.user_id` → `services/xstockstrat-ui/src/lib/bffShared.ts:40` (`[HEADER_USER_ID]: claims.user_id`) → `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts:232`). No normalization is added.

**Verification**:
```bash
cd services/xstockstrat-identity && pnpm run build && pnpm run lint
grep -n "^import" src/grpc/adminDirectory.ts   # exactly the two allowed imports
grep -n "x-access-scope\|x-user-id\|x-internal-caller\|metadata" src/grpc/adminDirectory.ts   # only the constraint comment may match
git diff --stat src/grpc/authz.ts src/index.ts   # empty
```

---

### Step 4 — test: identity `ListAdminUserIds` deny matrix + real-socket case

**Status**: `done`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/__tests__/adminDirectory.test.ts` — create
- `services/xstockstrat-identity/src/__tests__/mtls.test.ts` — modify

**Reviewers**: `xstockstrat-identity` owner — JWT expiry and rotation, API key scoping, secret store integration

**Codebase Evidence**:
- Static-import posture with no skip guard: `import * as mtls from '../mtls.ts';` at `services/xstockstrat-identity/src/__tests__/mtls.test.ts:13` (`design.md:123-125`). Counter-pattern to avoid: the `before()` try/catch lazy import at `identityServiceImpl.test.ts:28-40` (fails.md:2224-2226, `:116-125`).
- Test runner: `node --experimental-strip-types --test src/__tests__/*.test.ts`; coverage `c8 … --lines 40` (`services/xstockstrat-identity/package.json` `test` / `test:coverage`). Tests excluded from `tsc` (`tsconfig.json` `exclude: src/**/*.test.ts`).
- Fake `getAuthContext` shape: config `SecretCallerCall` (`services/xstockstrat-config/src/grpc/authz.ts:129-132`).
- Real-socket harness: `mintLeaf` (`mtls.test.ts:33-39`), `mintPki` (`:41-53`, client leaf `xstockstrat-client` at `:47`), `setEnv` (`:55-59`), passthrough descriptor `addService` (`:70-89`, `path: METHOD` at `:74` — not usable for a typed RPC, `design.md:139-140`), `call()` overwrites env at `:100`; per-leaf creds built before the call at `:136-137`.
- Generated-stub import: do NOT copy `await import('@xstockstrat/proto/identity/v1/identity.js')` (`identityServiceImpl.test.ts:229`, inside a swallowing `try`): the exports map `"./*": "./dist/*.js"` (`packages/proto/gen/ts/package.json:5-6`) resolves it to `identity.js.js`. Import the specifier with no `.js` suffix.
- SAN format already proven by `services/xstockstrat-config/src/__tests__/peerSanSpike.test.ts:102-110` — cite, do not duplicate.
- C-13: no Node fixture home exists in identity (`src/__tests__/` has no `fixtures/`). The fake pool and user rows have one consumer (this file) → inline is compliant.

**TDD**: `red-green required`

**Covers**: `AC-9, AC-10`

**Instructions**:
1. `adminDirectory.test.ts`: static `import { listAdminUserIds } from '../grpc/adminDirectory.ts';` plus a harness `it` asserting `typeof listAdminUserIds === 'function'` (RED on Node 24 = module-not-found before Step 3).
2. Fixtures (inline): `fakePool(rows | Error)` recording every `query(sql)`; `callWith(san?: string, md?: Record<string,string>, noAuthContext = false)` building `{ getAuthContext: () => ({ sslPeerCertificate: { subjectaltname: san } }), metadata }`; rows `[{ user_id: 'user-99' }]` as the DB result for the active-admin query (the inactive `user-98` and non-admin `user-42` givens are excluded by SQL; assert the SQL predicate rather than simulating Postgres).
3. Cases (each name carries its `@AC-*`):
   - (i) `@AC-9` SAN `DNS:xstockstrat-notify` → `userIds` deep-equals `['user-99']`; response keys are exactly `['userIds']`; one query whose SQL contains `is_active = true` and `'admin' = ANY(roles)`.
   - (ii) `@AC-10` SAN `DNS:xstockstrat-ui` → `PERMISSION_DENIED`, zero queries.
   - (iii) `@AC-10` SANs `DNS:xstockstrat-notify.evil`, `DNS:xstockstrat-notifyx` → `PERMISSION_DENIED`, zero queries.
   - (iv) `@AC-10` `subjectaltname` absent → `PERMISSION_DENIED`, zero queries.
   - (v) `@AC-10` `getAuthContext` absent → `PERMISSION_DENIED`, zero queries.
   - (vi) `@AC-10` ui SAN + metadata `x-access-scope: 4`, `x-user-id: system` → `PERMISSION_DENIED`, zero queries.
   - (vi-b) `@AC-9` notify SAN + the same metadata → identical response and single query as (i) (header-blindness).
   - (vii) pool throws `new Error('relation "identity.users" secret-detail')` → code `INTERNAL`; message does not contain `secret-detail`.
4. `mtls.test.ts` real-socket case (new `describe`, reusing `mintLeaf`/`mintPki`/`setEnv`):
   - Add a notify leaf `mintLeaf(dir, 'xstockstrat-notify', ca, caKey)` to `mintPki` (new `notifyCert`/`notifyKey` in `Pki`).
   - Start a server with `mtls.serverCredentials()` and `server.addService(IdentityServiceService, { listAdminUserIds: (call, cb) => listAdminUserIds(fakePool, call, cb) })` using the **generated** `IdentityServiceService` from `@xstockstrat/proto/identity/v1/identity`.
   - Build each leaf's `mtls.clientCredentials()` under its own `setEnv` before dialing (pattern `:136-137`), dial with `IdentityServiceClient` + `mtls.targetOverride(SVC)`.
   - Assert: `xstockstrat-client` leaf → `PERMISSION_DENIED` and zero pool queries (`@AC-10`); `xstockstrat-notify` leaf → `userIds` `['user-99']` (`@AC-9`).
5. P-06 evidence (record in `context.md`): RED run output on Node 24 (import failure), GREEN pass-count delta, and a separate load check that the guarded `identityServiceImpl.test.ts` actually loads (non-zero assertions; e.g. its `typeof IdentityServiceImpl === 'function'` path executes). Correct `fails.md:2224` only if that suite skips vacuously on Node 24.

**Verification**:
```bash
node --version   # must be v24.x (fails.md:2224-2226)
cd services/xstockstrat-identity && pnpm run test:coverage && pnpm run build && pnpm run lint   # coverage ≥ 40% lines (c8 --lines 40, package.json:13)
grep -n "@AC-9\|@AC-10" src/__tests__/adminDirectory.test.ts src/__tests__/mtls.test.ts
grep -n "__tests__/fixtures" src/__tests__/adminDirectory.test.ts   # none: single-consumer inline (C-13)
```

---

### Step 5 — service: notify `AdminDirectory` client + `IDENTITY_ENDPOINT` wiring

**Status**: `done`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/services/adminDirectory.ts` — create
- `docker-compose.yml` — modify
- `.do/app.dev.yaml` — modify
- `.do/app.yaml` — modify

**Reviewers**: `xstockstrat-notify` owner — stream delivery guarantees, backpressure handling, alert deduplication

**Codebase Evidence**:
- Client construction to mirror: `new LedgerServiceClient(endpoint, mtls.clientCredentials(), mtls.targetOverride('xstockstrat-ledger'))` at `services/xstockstrat-identity/src/grpc/ledgerAudit.ts:35`.
- Trio const + copy loop shape: `const PROPAGATED_HEADERS = ['x-user-id', 'x-access-scope', 'x-trace-id'] as const;` (`ledgerAudit.ts:14`), loop `:40-44`.
- Notify header-read idiom: `call.metadata?.get?.('x-user-id')?.[0]` (`services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts:232`); `md?.get(h)[0]` is rejected (`design.md:68-70`, `:237`).
- Notify mTLS: `clientCredentials()` (`services/xstockstrat-notify/src/mtls.ts:28`), `targetOverride()` (`:35`).
- Logger: `getLogger` (`services/xstockstrat-notify/src/services/logger.ts:11`).
- Mechanism-constant precedent (F-07 exemption): `WEBPUSH_SEND_TIMEOUT_MS = 10000` (`services/xstockstrat-notify/src/fanout/webPush.ts:16`), `fanout.ts:13` `FANOUT_HTTP_TIMEOUT_MS`.
- No `src/middleware/propagation.ts` in notify (feature 175; `@AC-2 @feature-175`, `docs/sdd/business-rules/platform.feature:165-166`).
- Env audit (`IDENTITY_ENDPOINT` absent from every notify block): `docker-compose.yml:217-245` (has `LEDGER_ENDPOINT` `:231`, `WAIT_FOR` `:232`); `.do/app.yaml` notify service `:493` (`LEDGER_ENDPOINT` `:521`); `.do/app.dev.yaml` notify `:490` (`LEDGER_ENDPOINT` `:518`). Value forms: compose `IDENTITY_ENDPOINT: xstockstrat-identity:50058` (`docker-compose.yml:349`); DO `${xstockstrat-identity.PRIVATE_DOMAIN}:50058` (`.do/app.yaml:264-265`, `.do/app.dev.yaml:264-265`).
- Header propagation (§B): new outbound gRPC call; Node has no live AsyncLocalStorage store (`docs/patterns/header-propagation.md:120-125`); the accepted form is explicit inbound-metadata threading as in `ledgerAudit.ts:14,40-44` (`design.md:65-72`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Create `src/services/adminDirectory.ts`:
   - `export interface AdminDirectory { listAdminUserIds(md: grpc.Metadata | undefined): Promise<string[]>; }`
   - `export const ADMIN_LOOKUP_DEADLINE_MS = 2000;` (mechanism constant; comment ≤2 lines naming F-07 like `webPush.ts:13-14`).
   - `const PROPAGATED_HEADERS = ['x-user-id', 'x-access-scope', 'x-trace-id'] as const;`
   - `export type AdminLookupClient = Pick<IdentityServiceClient, 'listAdminUserIds'>;` (`IdentityServiceClient` from `@xstockstrat/proto/identity/v1/identity`).
   - `export function createAdminDirectory(endpoint: string | undefined = process.env.IDENTITY_ENDPOINT, client?: AdminLookupClient): AdminDirectory`:
     - If `!endpoint && !client`: `log.error('IDENTITY_ENDPOINT unset — untargeted Web Push disabled')` once, and return a directory whose `listAdminUserIds` rejects `new Error('IDENTITY_ENDPOINT unset')`. No `??` default host (`design.md:73-74`).
     - Else build one long-lived client: `client ?? new IdentityServiceClient(endpoint, mtls.clientCredentials(), mtls.targetOverride('xstockstrat-identity'))`.
     - `listAdminUserIds(md)`: single-flight — if an in-flight promise exists return it; otherwise create it, clear it in `finally`. No TTL/result cache (`design.md:64`, rejected TTL `:223`).
     - Outbound metadata: `const out = new grpc.Metadata(); for (const h of PROPAGATED_HEADERS) { const v = md?.get?.(h)?.[0]; if (v) out.set(h, String(v)); }`.
     - Call options: `{ deadline: Date.now() + ADMIN_LOOKUP_DEADLINE_MS }` — no `waitForReady`.
     - Resolve with `resp.userIds`; reject on any `ServiceError`.
   - Doc comment (≤2 lines): single-flight joiners reuse the first caller's trio, so their trace correlation is lost (`design.md:102-103`, `:258`).
2. `docker-compose.yml` notify `environment:` — add `IDENTITY_ENDPOINT: xstockstrat-identity:50058` after `LEDGER_ENDPOINT` (`:231`). Do **not** add identity to `WAIT_FOR` (`:232`) or `depends_on` (`design.md:119`).
3. `.do/app.yaml` and `.do/app.dev.yaml` notify `envs:` — after `LEDGER_ENDPOINT` (`:521-522` / `:518-519`) add:
   ```yaml
         - key: IDENTITY_ENDPOINT
           value: ${xstockstrat-identity.PRIVATE_DOMAIN}:50058
   ```
   Never the bare `xstockstrat-identity:50058` in DO specs (`design.md:246`). `WAIT_FOR` unchanged.
4. No change to `index.ts` here (wired in Step 7).

**Verification**:
```bash
(cd services/xstockstrat-notify && pnpm run build && pnpm run lint)
# run from repo root; each count prints 1 (notify block only)
awk '/^  xstockstrat-notify:/{f=1;next} /^  [a-z]/{f=0} f' docker-compose.yml | grep -c "IDENTITY_ENDPOINT"
for f in .do/app.yaml .do/app.dev.yaml; do awk '/^  - name: xstockstrat-notify$/{f=1;next} /^  - name: /{f=0} f' "$f" | grep -c "key: IDENTITY_ENDPOINT"; done
grep -n "PROPAGATED_HEADERS\|md?.get?.(h)?.\[0\]" services/xstockstrat-notify/src/services/adminDirectory.ts   # trio relayed (C-03)
grep -n "waitForReady\|??\s*'xstockstrat-identity" services/xstockstrat-notify/src/services/adminDirectory.ts   # none
ls services/xstockstrat-notify/src/middleware 2>/dev/null   # absent (@AC-2 @feature-175)
```

---

### Step 6 — test: notify `AdminDirectory` (single-flight, freshness, deadline, trio on the wire)

**Status**: `done`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/__tests__/adminDirectory.test.ts` — create
- `services/xstockstrat-notify/src/__tests__/mtls.test.ts` — modify

**Reviewers**: `xstockstrat-notify` owner — stream delivery guarantees, backpressure handling, alert deduplication

**Codebase Evidence**:
- Notify runner is compile-first: `tsc && node --test dist/__tests__/*.test.js`; coverage `c8 … --lines 40` (`services/xstockstrat-notify/package.json` `test` / `test:coverage`); `tsconfig.json` includes `src/**/*` (tests compile).
- Static import + harness assertion posture: `webPush.test.ts:15,21-23`.
- On-the-wire capture pattern: notify `mtls.test.ts:119-128` (`capturedMd?.get('x-user-id')[0]` etc.); PKI helpers `mintLeaf` (`:33`), `mintPki` (`:41-53`), `setEnv` (`:55`), `call()` (`:99`).
- C-13: no notify fixture home (recon.md:477-478); the fake client and ids have one consumer per file → inline compliant.

**TDD**: `red-green required`

**Covers**: `AC-8, AC-11`

**Instructions**:
1. `adminDirectory.test.ts` — static `import { createAdminDirectory, ADMIN_LOOKUP_DEADLINE_MS } from '../services/adminDirectory.js';` + harness assertion. Fake `AdminLookupClient` recording `(req, md, opts)` and resolving/rejecting on demand. Cases:
   - `@AC-8` freshness: two sequential calls where the fake returns `['user-99']` then `[]` → results differ and the fake was called twice (no cache).
   - single-flight: two concurrent calls while the fake is pending → one client call; both resolve to the same array; a third call after settle makes a second client call.
   - deadline: recorded `opts.deadline` is a Date/number within `[now, now + ADMIN_LOOKUP_DEADLINE_MS + 50]`; `opts.waitForReady` is undefined.
   - `@AC-11` failure: fake rejects `{ code: 14 }` → `listAdminUserIds` rejects; in-flight slot is cleared (next call issues a new client call).
   - get-less metadata: `listAdminUserIds({} as any)` and `listAdminUserIds(undefined)` do not throw synchronously; outbound metadata is empty.
   - `@AC-11` missing endpoint: `createAdminDirectory('')` → `listAdminUserIds` rejects with `IDENTITY_ENDPOINT unset`. Pass `''`, not `undefined`: the default parameter would read `process.env.IDENTITY_ENDPOINT` from the runner.
2. `mtls.test.ts` — add an `xstockstrat-identity` server leaf to `mintPki`; new `describe` standing up `IdentityServiceService` (generated) with a `listAdminUserIds` handler that captures `call.metadata` and returns `{ userIds: ['user-99'] }`; dial via `createAdminDirectory('127.0.0.1:<port>')` (real `mtls.clientCredentials()` + `targetOverride('xstockstrat-identity')`). Inbound md `x-user-id: u-1`, `x-access-scope: 7`, `x-trace-id: t-1` → all three arrive on the wire; result `['user-99']`.

**Verification**:
```bash
cd services/xstockstrat-notify && pnpm run test:coverage && pnpm run lint   # coverage ≥ 40% lines (c8 --lines 40, package.json:13)
grep -n "@AC-8\|@AC-11" src/__tests__/adminDirectory.test.ts
grep -n "__tests__/fixtures" src/__tests__/adminDirectory.test.ts   # none: single-consumer inline (C-13)
```

---

### Step 7 — service: notify untargeted push resolves admin audience

**Status**: `done`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/fanout/webPush.ts` — modify
- `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts` — modify
- `services/xstockstrat-notify/src/index.ts` — modify

**Reviewers**: `xstockstrat-notify` owner — stream delivery guarantees, backpressure handling, alert deduplication

**Codebase Evidence**:
- Bug site: unfiltered branch `webPush.ts:97-101`; targeted branch `:90-96` (`WHERE user_id = $1`, `:93`); comment `:88-89`; `PushAlert.targetUserId` comment `:29`.
- Gate order kept: VAPID `:80`, severity `:84-86`, catch-all `:116-118`; `deliver` seam `:121-128`; prune by endpoint `:139` (NOTIFY-6).
- Constructor `(pool, config)` at `webPush.ts:52-55`; wiring `new WebPushDispatcher(pool, configWatcher)` at `index.ts:47`.
- Dispatch call: `void this.webPush.dispatch(alert).catch(…)` at `notifyServiceImpl.ts:108-112` (`:109`), inside the second post-callback `queueMicrotask` (insights.md:2144-2151).
- `push_subscriptions.user_id TEXT NOT NULL` (`migrations/002_push_subscriptions.up.sql:11`), index on `user_id` (`:19`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `webPush.ts`:
   - Import `type { Metadata } from '@grpc/grpc-js'` and `type { AdminDirectory } from '../services/adminDirectory'`.
   - Constructor gains `private readonly admins: AdminDirectory` (3rd, required) and `private readonly now: () => number = Date.now` (4th, optional — injectable clock, `design.md:85-87`). Add `private lastLookupErrorAt = -Infinity;` and `const ADMIN_LOOKUP_ERROR_INTERVAL_MS = 60_000;` (mechanism constant, F-07 exemption like `webPush.ts:16`; ≤2-line comment saying so. Not flagged by /sdd-review impl-spec 2026-10-21, so the config-key fallback in `design.md:284` is not taken).
   - `dispatch(alert: PushAlert, md?: Metadata)`. Keep `:80-86` unchanged. Replace the ternary `:88-101` so the targeted branch stays byte-identical in SQL and params, and the untargeted branch becomes:
     ```ts
     let adminIds: string[];
     try {
       adminIds = await this.admins.listAdminUserIds(md);
     } catch (e: any) {
       this.reportAdminLookupError(alert.alertId, e);
       return;
     }
     if (adminIds.length === 0) return;
     rows = (await this.pool.query<SubscriptionRow>(
       'SELECT subscription_id, endpoint, p256dh, auth FROM notify.push_subscriptions WHERE user_id = ANY($1::text[])',
       [adminIds],
     )).rows;
     ```
   - `private reportAdminLookupError(alertId, e)`: if `this.now() - this.lastLookupErrorAt >= ADMIN_LOOKUP_ERROR_INTERVAL_MS` → set `lastLookupErrorAt` and call `this.logAdminLookupError({ alertId, channel: 'push', code: e?.code, error: e?.message ?? String(e) })`; otherwise do nothing. Any code (14, 4, 7, 12, 13, …) escalates (`design.md:85-87`, rejected 7/12/13-only `:235`).
   - `protected logAdminLookupError(meta)` → `log.error('push admin lookup failed — untargeted push skipped', meta)`. Protected seam for tests, same rationale as `deliver` (`:121-122`). Other push errors stay WARN (`:117`, `:146`).
   - Comments: `:29` → `// '' = untargeted: pushed only to admin-role users' subscriptions`; `:88-89` → state the admin-only audience and F-06 pool reuse (≤2 lines).
2. `notifyServiceImpl.ts:109`: `this.webPush.dispatch(alert, call.metadata)`. No other change (fanout microtask `:100-104` untouched, `@feature-020` PRESERVE).
3. `index.ts`: import `createAdminDirectory` from `./services/adminDirectory`; `const webPush = new WebPushDispatcher(pool, configWatcher, createAdminDirectory());` (`:47`). The startup ERROR for an unset `IDENTITY_ENDPOINT` comes from `createAdminDirectory` (Step 5).

**Verification**:
```bash
cd services/xstockstrat-notify && pnpm run build && pnpm run lint
grep -n "FROM notify.push_subscriptions'" src/fanout/webPush.ts   # none: unfiltered SELECT gone
grep -n "WHERE user_id = \$1\|ANY(\$1::text\[\])" src/fanout/webPush.ts
grep -n "dispatch(alert, call.metadata)" src/grpc/notifyServiceImpl.ts
```

---

### Step 8 — test: notify push audience (deliberate rewrite of feature-165 broadcast case)

**Status**: `done`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/__tests__/webPush.test.ts` — modify
- `services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts` — modify

**Reviewers**: `xstockstrat-notify` owner — stream delivery guarantees, backpressure handling, alert deduplication

**Codebase Evidence**:
- Case to rewrite under operator sign-off: `it('AC-4: broadcast (empty targetUserId) queries all subscriptions'` at `webPush.test.ts:147-155` (context.md § Operator decisions 2026-10-21; C-16 CHANGE, `design.md:290`).
- Targeted guard to keep and extend: `webPush.test.ts:129-145` (`/WHERE user_id = \$1/`, params `['user-42']`, `:142-143`).
- SQL-blind fake: `capturingPool` `:33-45`; `cfg` `:47-49`; `StubbedDispatcher` `:53-60`; `alert()` `:88-98`; `SUBS` `:100-103`. Every existing `new StubbedDispatcher(pool.obj as any, cfg…)` (`:113`, `:123`, `:132`, `:150` (rewritten), `:160`, `:171`, `:184`) and `new ExposedDispatcher(pool.obj as any, cfg())` (`:203`, class `:194`) must pass a 3rd argument once the constructor requires it (tsc compiles tests).
- EmitAlert harness: `recordingWebPush` (`notifyServiceImpl.test.ts:64-75`), `registerSubscriber` (`:314`), `REQ` (`:353`), push isolation (`:546-565`), unauthenticated-caller pin (comment block `:219-225`, `it(...)` at `:226`; must stay green).

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-5, AC-8, AC-11`

**Instructions**:
1. `webPush.test.ts` helpers (inline; single consumer):
   - `stubAdmins(...results: (string[] | Error)[])` — an `AdminDirectory` returning the next result per call and recording calls + received md.
   - `sqlPool(subsByUser: Record<string, Row[]>)` — SQL-aware fake: `WHERE user_id = $1` returns `subsByUser[params[0]]`; `ANY($1::text[])` returns rows for users in `params[0]`; any other `SELECT … FROM notify.push_subscriptions` throws `new Error('unfiltered audience query')`.
   - Givens (from `acceptance.feature`): `user-42` → `/one`, `/two`; `user-77` → `/three`; `user-99` (admin) → `/admin`.
   - Pass `stubAdmins([])` (or the case's directory) as the 3rd constructor arg in every existing case, including `ExposedDispatcher` (`:203`).
2. Replace `:147-155` with:
   - `@AC-5` untargeted WARNING, admins `['user-99']` → sent endpoints exactly `['https://push.example/admin']`, title `portfolio risk limit breach`; SQL matches `ANY($1::text[])`, params `[['user-99']]`.
   - `@AC-1` same dispatch → none of `/one`, `/two`, `/three` sent.
   - empty admin list → zero sends, zero subscription queries.
3. Extend `:129-145` (`@AC-2`): with `sqlPool` givens, targeted `user-42` → exactly `/one`, `/two`; not `/three`, not `/admin`; `stubAdmins` was **not** called.
4. `@AC-8`: one dispatcher, `stubAdmins(['user-99'], [])` → first untargeted dispatch sends `/admin`, second sends nothing.
5. `@AC-11`: `stubAdmins(Object.assign(new Error('unavailable'), { code: 14 }))` → dispatch resolves, zero sends; subclass overriding `logAdminLookupError` counts 1. Repeat with `{ code: 13 }`. With an injected clock: three failures at t=0, 30s, 59s → 1 ERROR; failure at t=60s → 2.
6. Gates: untargeted alert with VAPID absent or severity below `min_severity` → `stubAdmins` not called (`@AC-6/@AC-7 @feature-165` PRESERVE).
7. md pass-through: `dispatch(alert({ targetUserId: '' }), md)` → `stubAdmins` received the same `md`.
8. `notifyServiceImpl.test.ts` — `@AC-1`: `emitAlert({ request: REQ({ targetUserId: '' }), metadata: <md> }, cb)` with `recordingWebPush` → callback returns an `alertId`; `registerSubscriber` received 1; after a microtask the push fake received `(alert, md)` (extend `recordingWebPush` to record the 2nd arg). Existing `:219-226` (pin comment + `it`) and `:546-565` stay unchanged and green (`@AC-11` "never fails or delays EmitAlert").

**Verification**:
```bash
cd services/xstockstrat-notify && pnpm run test:coverage && pnpm run lint   # coverage ≥ 40% lines (c8 --lines 40, package.json:13)
grep -n "broadcast (empty targetUserId) queries all subscriptions" src/__tests__/webPush.test.ts   # none: rewritten
grep -n "@AC-1\|@AC-2\|@AC-5\|@AC-8\|@AC-11" src/__tests__/webPush.test.ts src/__tests__/notifyServiceImpl.test.ts
grep -n "__tests__/fixtures" src/__tests__/webPush.test.ts src/__tests__/notifyServiceImpl.test.ts   # none: single-consumer inline (C-13)
```

---

### Step 9 — service: portfolio risk alerts target the account owner

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- `func (s *PortfolioService) checkRiskLimits(ctx context.Context, userID string, mode commonv1.TradingMode)` at `portfolio_service.go:964`; concentration emit `s.emitRiskAlert(ctx, fmt.Sprintf("concentration limit breach: %s at %.1f%%", sym, pct*100))` at `:991`; drawdown emit `s.emitRiskAlert(ctx, msg)` at `:999`.
- `func (s *PortfolioService) emitRiskAlert(ctx context.Context, msg string)` at `:1004`; `EmitAlertRequest{Severity: …WARNING, Category: "risk", Title: "portfolio risk limit breach", Body: msg, SourceService: "portfolio"}` at `:1008-1014` with no `TargetUserId`.
- Only callers of `emitRiskAlert`: `:991`, `:999` (grep). Only production caller of `checkRiskLimits`: `:375` (`fill.UserID`).
- Field: `EmitAlertRequest.target_user_id = 6` (`packages/proto/notify/v1/notify.proto:71`) → Go `TargetUserId`. Precedent `TargetUserId: order.UserId` (`services/xstockstrat-trading/internal/service/trading.go:3348`).
- Body field, not header: stream path carries no propagation (`internal/middleware/propagation.go:20-49`); existing notify client/interceptor reused (`portfolio_service.go:140,151`) — no new outbound call (§B header row N/A).
- Trading-domain survey (§A): no order placement, broker dispatch, order type or fill-state change in this step — "order type handling unaffected; fill handling unaffected; broker coverage unaffected; trading mode gate unaffected".

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Change the signature to `func (s *PortfolioService) emitRiskAlert(ctx context.Context, userID, msg string)` and add `TargetUserId: userID,` to the `EmitAlertRequest` literal (`:1008-1014`). Ledger event (`:1005-1007`) unchanged.
2. Update both call sites: `:991` → `s.emitRiskAlert(ctx, userID, fmt.Sprintf(…))`; `:999` → `s.emitRiskAlert(ctx, userID, msg)`.
3. No empty-owner guard (`design.md:262`: an empty owner degrades to an admin-only push; note only).

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n "TargetUserId: userID" internal/service/portfolio_service.go
grep -n "emitRiskAlert(ctx, userID" internal/service/portfolio_service.go   # 2 call sites
```

---

### Step 10 — test: portfolio owner targeting (concentration + drawdown)

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_quote_deadline_test.go` — modify

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- `recordingNotify` records `in.Body` only (`portfolio_quote_deadline_test.go:345-357`); second consumer `offline_account_pnl_test.go:314` (`&recordingNotify{}`, unaffected by an added field).
- `TestCheckRiskLimits_AC3_SumsAcrossAccounts` (comment `:440`, func `:441`, owner `"u1"`, exact body set `:454`).
- `TestCheckRiskLimits_AC9_UnpricedSkipsConcentrationDrawdownStillAlerts` (comment `:460`, func `:461`, drawdown `brk-1` 800/1000).
- `expectDrawdowns` hard-codes `.WithArgs("u1", "TRADING_MODE_PAPER")` (`:367-373`); `posRow`, `positionCols`, `anyArgs`, `newQuoteSvc`, `ctxWithUser` used at `:441-451`.
- Go fixture home `internal/testdata/marks.go` (`Lyft`, `Msft`, …) — no `user-42` / `acct-1` constants. Both literals already appear inline as per-test scenario sentinels elsewhere in the module (`"user-42"`: `internal/service/watchlist_service_test.go:620,645,659`, `internal/handler/portfolio_identity_test.go:64`; `"acct-1"`: `internal/service/portfolio_close_payload_test.go:24,28,46`) — the module's convention is inline sentinel IDs, not a shared constant.
- New logic lives in `internal/service/` — an excluded coverage package (spec-template coverage note).

**TDD**: `red-green required`

**Covers**: `AC-3, AC-6`

**Instructions**:
1. Extend `recordingNotify` with `reqs []*notifyv1.EmitAlertRequest` appended in `EmitAlert` (keep `bodies`).
2. `@AC-3`: in `TestCheckRiskLimits_AC3_SumsAcrossAccounts`, after the body-set assertion, assert every recorded req has `TargetUserId == "u1"` (the `checkRiskLimits` owner), `Category == "risk"`, `Severity == ALERT_SEVERITY_WARNING`. Body set stays exactly as `:454` (EXTEND `@AC-3 @feature-231`).
3. `@AC-9 @feature-231` EXTEND: in the AC9 test, assert the single drawdown req has `TargetUserId == "u1"`; still the only alert.
4. `@AC-6`: new `TestCheckRiskLimits_242_AC6_DrawdownTargetsOwner` — owner `"user-42"`; empty positions via `mock.ExpectQuery(\`FROM portfolio.positions\`).WithArgs(anyArgs(4)...)`; drawdown via an inline `mock.ExpectQuery(\`FROM portfolio.account_balances\`).WithArgs("user-42", "TRADING_MODE_PAPER")` returning `acct-1`, `8500.0`, `10000.0`; call `checkRiskLimits(ctxWithUser(t, "user-42"), "user-42", TRADING_MODE_PAPER)`; assert exactly one req with body `drawdown limit breach: account acct-1 at 15.0% (peak 10000.00, current 8500.00)`, category `risk`, severity WARNING, `TargetUserId == "user-42"`. `expectDrawdowns` is not modified.
5. C-13 verdict: `"user-42"` / `"acct-1"` are opaque scenario-sentinel IDs (the `acceptance.feature` givens), not shared fixture data; within `portfolio_quote_deadline_test.go` they have one consumer (this new test) and they follow the module's existing inline-sentinel convention (other files above) → inline compliant, no `internal/testdata` constant; `expectDrawdowns` keeps its `"u1"` literal.

**Verification**:
```bash
(cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/service/... -run 'TestCheckRiskLimits' -count=1 -v)
(cd services/xstockstrat-portfolio && export GOWORK=off && COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:")   # ≥ 40% (ci.yml:256-257 form)
(cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod)
grep -n '"user-42"' services/xstockstrat-portfolio/internal/service/portfolio_quote_deadline_test.go   # repo root; hits only inside TestCheckRiskLimits_242_AC6_DrawdownTargetsOwner (C-13; pre-existing hits in watchlist_service_test.go / portfolio_identity_test.go are unrelated sentinels)
```
New logic is in an excluded package (`internal/service/`) — no coverage threshold applies to it; the targeted `-run` tests are the behavioral proof.

---

### Step 11 — service: analysis live-loop alerts target the strategy owner

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/live_loop.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `_emit_alert` builds `notify_pb2.EmitAlertRequest(severity=…WARNING, category="strategy", title=…, body=…, source_service="xstockstrat-analysis", tags=[…], context=ctx)` at `live_loop.py:834-845`; called `:819`.
- `_emit_fundamentals_unavailable_alert` builder at `:850-861`; called `:727`.
- Owner `definition.user_id` (`StrategyDefinition.user_id = 13`, `packages/proto/analysis/v1/analysis.proto:377`); validated upstream by `owner_metadata` (`app/identity.py:6-10`) via `_run_cycle` `:383-395`; `sector_params.apply_sector` copies with `CopyFrom` (`app/services/sector_params.py:109`) so `user_id` survives (`live_loop.py:734`).
- `fundsignal_loop._emit_warning` (defined `app/engine/fundsignal_loop.py:642`, builder `:646-654`; callers `:283`, `:632`) stays untargeted (`design.md:112-113`; PRESERVE `@AC-6 @feature-224`).
- Existing notify stub reused — no new outbound call (§B header row N/A).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add `target_user_id=definition.user_id,` to both `notify_pb2.EmitAlertRequest(...)` calls (`:835-844`, `:851-860`). Nothing else changes (titles, bodies, tags, dedup).
2. Do not touch `fundsignal_loop.py`.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
grep -n "target_user_id=definition.user_id" app/engine/live_loop.py   # 2 hits
grep -n "target_user_id" app/engine/fundsignal_loop.py   # none
```

---

### Step 12 — test: analysis owner targeting (strategy trigger + fundamentals-unavailable)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_live_loop.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `_make_loop()` (`tests/test_live_loop.py:36-58`, `EmitAlert = AsyncMock` `:56`); `_decision` (`:61-62`); entry driver `await loop._eval_pair(defn, "AAPL", throttle=0)` (`:73`).
- `TestLiveLoopFundamentalsDenyEntry_feature215` (`:1338`): `_loop(snapshot)` (`:1344-1355`), `_blend()` (`:1357-1370`, `user_id="u1"`), `_not_found` (`:1378-1382`); `test_ac6_ac5_denied_three_cycles_one_warn_one_alert` (`:1392`) reads `req = loop._notify.EmitAlert.await_args.args[0]` (`:1409`).
- No test asserts `target_user_id` today (recon.md:473-474).

**TDD**: `red-green required`

**Covers**: `AC-4, AC-7`

**Instructions**:
1. `@AC-4`: in `TestLiveEvaluationLoopStateTracking`, add `test_242_ac4_trigger_alert_targets_owner` — `defn = StrategyDefinition(strategy_id="strat-1", user_id="user-42", display_name="S1")`; `evaluate` returns `_decision(True, False)`; `await loop._eval_pair(defn, "AAPL", throttle=0)`; `req = loop._notify.EmitAlert.await_args.args[0]`; assert `req.target_user_id == "user-42"`, `req.category == "strategy"`, `req.severity == notify_pb2.ALERT_SEVERITY_WARNING`, title `Strategy strat-1 entry on AAPL`.
2. `@AC-7`: in `TestLiveLoopFundamentalsDenyEntry_feature215`, add `test_242_ac7_fundamentals_alert_targets_owner` — `loop = self._loop(self._not_found)`; `defn = self._blend()`; set `defn.user_id = "user-42"`, `defn.strategy_id = "strat-2"`; `evaluate` returns `_decision(True, False)`; `await loop._eval_pair(defn, "MSFT", throttle=0)`; the single fundamentals alert has `target_user_id == "user-42"`, category `strategy`, severity WARNING, title `Strategy strat-2: fundamentals unavailable for MSFT`. If `strategy_id` proves load-bearing in the `_loop` fixtures, keep `_SID` and record the title delta in the Deviation Log (no step-body edit).
3. Extend `test_ac6_ac5_denied_three_cycles_one_warn_one_alert` (`:1409-1413`) with `assert req.target_user_id == "u1"` (EXTEND `@AC-6 @feature-215`: still exactly one alert).
4. C-13 verdict: owner/strategy ids are scenario sentinels, inline like the file's existing `"u1"` / `"s1"` (`:69`, `:89`); no `tests/conftest.py` change.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_live_loop.py -k "242 or ac6_ac5" -q
cd services/xstockstrat-analysis && uv run pytest --cov=app --cov-fail-under=40
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
grep -n "def .*fixture\|from .conftest\|conftest" tests/test_live_loop.py   # unchanged imports only
```

---

### Step 13 — docs: agent `emit_alert` broadcast wording (push reaches admins only)

**Status**: `done`
**Service**: `xstockstrat-agent`, `docs/runbooks/`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify (docstring only)
- `docs/runbooks/mcp-tools.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Docstring `broadcast: REQUIRED, no default. True sends a system-wide broadcast (unchanged semantic — target_user_id="" on the wire)…` at `services/xstockstrat-agent/app/tools.py:690-692`; `target_user_id = "" if broadcast else _caller_user_id(ctx, "emit_alert")` at `:699` (unchanged).
- Runbook row `| \`broadcast\` | \`bool\` | Yes | \`true\` sends a system-wide broadcast …` at `docs/runbooks/mcp-tools.md:256`; `emit_alert` intro paragraph "…or an explicit system-wide broadcast (feature 111)" at `:246`.
- No test pins the phrase "system-wide broadcast" (grep of `services/` and `docs/` outside feature dirs: only `tools.py:690`, `mcp-tools.md:246`, `:256`).

**TDD**: N/A (docs — docstring wording only, no behavior change, `design.md:218`)

**Covers**: —

**Instructions**:
1. `tools.py:690-692`: keep the parameter contract; append that with `broadcast=True` the in-app stream/history reaches every user but the Web Push device notification reaches admin-role users only (feature 242).
2. `mcp-tools.md:256`: same clause in the `broadcast` row, keeping parity with the docstring (agent owner focus: `mcp-tools.md` parity).
3. `mcp-tools.md:246`: after "an explicit system-wide broadcast (feature 111)", add that a broadcast's Web Push reaches admin-role devices only (feature 242).

**Verification**:
```bash
(cd services/xstockstrat-agent && ruff check . && ruff format --check . && uv run pytest tests/test_tools.py tests/test_tools_endpoint.py -q)
grep -n "admin" services/xstockstrat-agent/app/tools.py docs/runbooks/mcp-tools.md | grep -i "push"   # repo root; tools.py, mcp-tools.md:246 and :256
```

---

### Step 14 — docs: platform docs (root CLAUDE.md, PLAT-4, header-propagation, mTLS SAN gate)

**Status**: `pending`
**Service**: `docs/`
**Files**:
- `CLAUDE.md` — modify
- `docs/context-constitution.md` — modify
- `docs/patterns/header-propagation.md` — modify
- `docs/patterns/inter-service-mtls.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Root `CLAUDE.md:336` ("The Node leaf services (ledger, identity, notify, config) make no outbound per-request calls…"); dependency diagram `CLAUDE.md:310-330` (`All services → xstockstrat-notify` `:326`, no notify → identity edge).
- `docs/context-constitution.md:38` PLAT-4 ("identity is the only outbound per-request caller … ledger/notify/config make no outbound per-request calls").
- `docs/patterns/header-propagation.md:123-125` ("none currently does" — already false per `ledgerAudit.ts:14`); AsyncLocalStorage template `:120-154`; "Request-scoped outbound edges" `:160-169`.
- `docs/patterns/inter-service-mtls.md` (90 lines) has no peer-SAN authorization section (grep `peer`: none); the existing SAN grant is config's `peerSan: 'xstockstrat-ingest'` (`services/xstockstrat-config/src/grpc/authz.ts:124`).

**TDD**: N/A (docs)

**Covers**: —

**Instructions**:
1. Root `CLAUDE.md:336`: name notify as a Node outbound per-request caller — notify → identity `ListAdminUserIds` forwards the trio via an inline `PROPAGATED_HEADERS` const, beside identity's ledgerAudit. No "recorded exception" (`design.md:187-189`). Diagram: add `xstockstrat-notify → xstockstrat-identity (ListAdminUserIds, untargeted push audience)`.
2. `docs/context-constitution.md:38` PLAT-4: same correction; add Node outbound evidence `services/xstockstrat-notify/src/services/adminDirectory.ts#PROPAGATED_HEADERS`.
3. `header-propagation.md`: correct `:123-125`; add explicit inbound-metadata threading (identity `ledgerAudit.ts:14,40-44`, notify `adminDirectory.ts`) as an accepted Node form beside the AsyncLocalStorage template; add a `xstockstrat-notify → xstockstrat-identity` bullet under "Request-scoped outbound edges" (`:160-169`) noting the RPC is header-blind (`design.md:90-99`).
4. `inter-service-mtls.md`: add a short "Peer-SAN authorization" note listing the two SAN-gated grants (config `GetSecret` ← `xstockstrat-ingest`; identity `ListAdminUserIds` ← `xstockstrat-notify`), exact-match only, headers ignored for the latter.

**Verification**:
```bash
grep -n "notify" CLAUDE.md | grep -i "identity"
grep -n "ListAdminUserIds" docs/context-constitution.md docs/patterns/header-propagation.md docs/patterns/inter-service-mtls.md
grep -n "none currently does" docs/patterns/header-propagation.md   # none
```

---

### Step 15 — docs: service docs (notify/identity CLAUDE.md + per-module constitution) and Teardown

**Status**: `pending`
**Service**: `services/xstockstrat-notify/`, `services/xstockstrat-identity/`
**Files**:
- `services/xstockstrat-notify/CLAUDE.md` — modify
- `services/xstockstrat-notify/docs/context-constitution.md` — modify
- `services/xstockstrat-notify/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-identity/CLAUDE.md` — modify
- `services/xstockstrat-identity/docs/context-constitution.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Notify `CLAUDE.md`: Dependencies `:62-67` (config + PostgreSQL only); Web Push paragraph `:85-95` ("`target_user_id` (empty ⇒ broadcast to all subscriptions)" `:90`); Env Vars block `:109-119`.
- Notify constitution `services/xstockstrat-notify/docs/context-constitution.md`: Pointers row `:37` (mTLS dial `targetOverride('xstockstrat-config')` only; "per-leaf `propagation.ts` deleted"); Web Push invariants NOTIFY-6 `:20`, severity-only gate `:25`. No rule covers the untargeted audience.
- Notify findings `services/xstockstrat-notify/docs/context-constitution-findings.md:38` (open ⚠ bullet on the broadcast); `## Resolved` at `:40`.
- Identity `CLAUDE.md`: Ports text "exposing all eleven methods" (`:25-30`, "eleven methods" `:26`) — already stale: `identity.proto` has 21 RPCs (open defect `docs/reports/2026-10-19-identity-claude-md-drift-defect.md:12`). Dependencies `:43-48`.
- Identity constitution `services/xstockstrat-identity/docs/context-constitution.md`: IDENTITY-5 `adminGate`-first rule (`:22`) — the new RPC is deliberately NOT `adminGate`d (SAN-only, header-blind); IDENTITY-3 raw numeric codes "EXCEPT the shared `authz.ts`" (`:20`); Pointers `:44-45`.
- Teardown rule: root `CLAUDE.md` § Teardown — context files changed ⇒ `/context-forge:context-constitution refresh` scoped to touched files, or manual reconciliation recorded in the PR body.

**TDD**: N/A (docs)

**Covers**: —

**Instructions**:
1. Notify `CLAUDE.md`: `:90` → untargeted pushes reach admin-role users only via a live, uncached identity `ListAdminUserIds` lookup (single-flight, 2s deadline, ERROR ≤1/60s on failure, no push on failure); Dependencies row `xstockstrat-identity | gRPC ListAdminUserIds | untargeted Web Push audience`; Env Vars `IDENTITY_ENDPOINT=xstockstrat-identity:50058  # feature 242; unset ⇒ startup ERROR, untargeted push disabled`.
2. Notify constitution: add a NOTIFY-* rule — untargeted push audience = admin user IDs from a live, uncached `ListAdminUserIds` call; adding a TTL cache or falling back to all subscriptions on lookup failure reopens defect 242 (evidence `src/fanout/webPush.ts#dispatch`, `src/services/adminDirectory.ts`). Update Pointers `:37` to list the `targetOverride('xstockstrat-identity')` dial and `adminDirectory.ts#PROPAGATED_HEADERS`.
3. Notify findings: move the `:38` bullet to `## Resolved` with "resolved by feature 242 (admin-only untargeted audience)".
4. Identity `CLAUDE.md`: name `ListAdminUserIds` (SAN `xstockstrat-notify` only, header-blind). Replace "all eleven methods" with an uncounted phrase (e.g. "every `IdentityService` method") — do not state a count; the rest of the stale list stays with the open defect. Dependencies unchanged (identity is the callee).
5. Identity constitution: add an IDENTITY-* rule — `ListAdminUserIds` (`src/grpc/adminDirectory.ts`) is authorized by exact mTLS peer SAN `xstockstrat-notify` only and ignores every header; adding `adminGate` or reading `x-access-scope` breaks notify (it calls with the alerting producer's trio). Note the `grpc.status` enum use there as a second IDENTITY-3 exception beside `authz.ts`.
6. Teardown (covers Steps 14 and 15): run `/context-forge:context-constitution refresh` scoped to every file in both steps; fix grounded drift. If the plugin is unavailable, re-read each touched context file against the code and record both "plugin unavailable" and the manual reconciliation in the PR body.

**Verification**:
```bash
grep -n "ListAdminUserIds" services/xstockstrat-notify/CLAUDE.md services/xstockstrat-notify/docs/context-constitution.md services/xstockstrat-identity/CLAUDE.md services/xstockstrat-identity/docs/context-constitution.md
grep -n "broadcast to all subscriptions" services/xstockstrat-notify/CLAUDE.md   # none
grep -n "eleven methods" services/xstockstrat-identity/CLAUDE.md   # none
grep -n "resolved by feature 242" services/xstockstrat-notify/docs/context-constitution-findings.md
```

---

### Step 16 — docs: C-14 follow-up for trading per-account alerts

**Status**: `pending`
**Service**: `docs/reports/`, feature dir
**Files**:
- `docs/reports/2026-10-21-trading-untargeted-per-account-alerts-defect.md` — create
- `docs/reports/2026-10-21-trading-untargeted-per-account-alerts-defect.status` — create
- `docs/roadmap/features/242-fix-push-untargeted-broadcast/context.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Reconciliation mismatch `EmitAlertRequest{Severity: …CRITICAL, Category: "reconciliation", …}` without `TargetUserId` at `services/xstockstrat-trading/internal/service/trading.go:1938-1944`.
- Account halt `EmitAlertRequest{Severity: …CRITICAL, Category: "halt", …}` without `TargetUserId` at `trading.go:2751-2757`.
- Systemic escalation `EmitAlertRequest{Severity: …CRITICAL, Category: "reconciliation", Title: "Systemic broker-reconciliation failure — trading reduced to REDUCE_ONLY", …}` without `TargetUserId` at `trading.go:2183-2189` — system-wide (counts unreachable accounts across all owners), not per-account; admin-only delivery after 242 is the intended audience. Distinct from the per-account reconciliation alert at `:1938-1944` despite the shared category.
- Targeting precedent in the same file: `TargetUserId: order.UserId` (`trading.go:3348`; also `:3684`, `:3700`).
- Defect-report + sidecar format: `.claude/skills/sdd-qa/reference/defect-filing.md`; sidecar precedent `docs/reports/2026-10-19-notify-untargeted-push-broadcasts-all-users-defect.status` (`triaged` / `ref: feature:…`).
- No existing feature dir for this follow-up (`ls docs/roadmap/features | grep account-alert`: none).

**TDD**: N/A (docs)

**Covers**: —

**Instructions**:
1. Write the defect report per `defect-filing.md`: after feature 242, both CRITICAL per-account trading alerts reach admin devices only; the account owner loses the push for their own halt/reconciliation. Severity SEV-2; affected service `xstockstrat-trading`; owner resolvable from `accountID`. State explicitly that the systemic escalation alert (`trading.go:2183-2189`, same `reconciliation` category) is **out of scope**: it is system-wide, so admin-only delivery is intended and it must not be targeted — do not conflate it with the per-account reconciliation alert at `:1938-1944`.
2. Sidecar content: `open`.
3. Append to `context.md`: provisional follow-up slug `fix-trading-account-alert-targeting` (its `NNN` is assigned by `/sdd-triage`; route via `/sdd-triage --from-report docs/reports/2026-10-21-trading-untargeted-per-account-alerts-defect.md`), or an operator sign-off; required before the integration PR merges (C-14, `design.md:207-210`).

**Verification**:
```bash
ls docs/reports/2026-10-21-trading-untargeted-per-account-alerts-defect.md docs/reports/2026-10-21-trading-untargeted-per-account-alerts-defect.status
cat docs/reports/2026-10-21-trading-untargeted-per-account-alerts-defect.status   # open
grep -n "fix-trading-account-alert-targeting" docs/roadmap/features/242-fix-push-untargeted-broadcast/context.md
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

- **Step 1 (2026-10-28) — verification mechanism only, no code deviation.** The worktree-isolation guard refused
  the `buf breaking --against "<git-common-dir>#branch=main-dev,subdir=packages/proto"` form (a path naming the
  shared `.git`). Equivalent input used: `git archive main-dev packages/proto` and `git archive origin/main-dev
  packages/proto` extracted to the session scratchpad, then `buf breaking --against <extract>/packages/proto`. Both
  exit 0 (local `main-dev` 0fc13c41 is behind `origin/main-dev` fa40c8a4, so both were checked); `buf lint` exit 0
  (buf 1.72.0). A blank line precedes the new rpc comment, matching the service block's existing comment spacing.
- **Step 2 (2026-10-29) — toolchain parity only, no code deviation.** (a) The provisioned `protoc-gen-go`
  (v1.36.11) and `protoc-gen-connect-go` (v1.19.2) in `~/go/bin` were built with go1.24.7 and reflowed an unrelated
  doc comment in `gen/go/analysis/v1/analysis.pb.go`; all three Go plugins were rebuilt at their CI pins with
  `GOTOOLCHAIN=go1.27.0` (CI `proto-freshness` uses Go 1.27) into the session scratchpad, which removed the drift.
  (b) `gen/ts` had no `node_modules`, so `tsc` resolved to a global TypeScript 6.0.2 (TS5107 error); ran
  `pnpm install --frozen-lockfile` in the worktree (lockfile TypeScript 5.9.3, as CI does). (c) `buf-gen.sh:41`'s
  `buf breaking` passed in the worktree; also re-checked against a `git archive main-dev packages/proto` extract
  (exit 0). Result: drift is identity-only, and a second `buf-gen.sh` run gives an empty `git diff packages/proto/gen/`.
- **Step 3 (2026-10-29) — formatting and TDD-evidence mechanics only, no behaviour deviation.** (a) The delegate
  `listAdminUserIds(call, callback)` spans three lines, not one (house brace style). `identityServiceImpl.ts` has no
  other change. It was not run through prettier because the file already fails `prettier --check` at HEAD, and a
  reformat would touch unrelated lines. (b) The verbatim `peerDnsSans` copy omits the JSDoc line above it in
  config `authz.ts:134`. It is mechanism narration, not a constraint (root CLAUDE.md comment rule). (c) The spec
  allows only `@AC-*` tests in Step 4's file. So the step-3 RED→GREEN gate ran on an uncommitted scratch suite
  (7 cases mirroring Step 4 (i)-(vii)) that imports `src/grpc/adminDirectory.ts`. Step 4 still owns the committed
  tests. (d) `pnpm run lint` exits 0 with 186 warnings, all pre-existing `no-explicit-any` warnings plus the two the
  spec-mandated `any` delegate adds (`identityServiceImpl.ts:937`). `adminDirectory.ts` is warning-free.
- **Step 4 (2026-10-29) — test mechanics only, no behaviour deviation.** (a) RED was captured by moving the
  already-landed `src/grpc/adminDirectory.ts` (Step 3) out of the tree for one run and restoring it: both test files
  fail with `ERR_MODULE_NOT_FOUND ... src/grpc/adminDirectory.ts`. (b) Case (vii) (DB failure → generic INTERNAL)
  carries no `@AC-*` tag because the spec assigns it none. (c) `mtls.test.ts` keeps its own one-line fake pool
  (`queries` recorder) instead of importing the one in `adminDirectory.test.ts`; each has one consumer (C-13
  inline). (d) `mtls.test.ts` is not run through prettier: it already fails `prettier --check` at HEAD, and a
  reformat would touch unrelated lines. `adminDirectory.test.ts` is prettier-clean. (e) The P-06 load check found
  that the guarded `identityServiceImpl.test.ts` skips vacuously on Node 24.20.0 (see context.md). Per Instruction
  5 the `fails.md:2222` claim is corrected by an appended ledger entry (append-only rule), in its own commit.
- **Step 5 (2026-10-29) — formatting and TDD-evidence mechanics only, no behaviour deviation.** (a) The spec puts
  every `@AC-*` test for this seam in Step 6's `adminDirectory.test.ts`, so the step-5 RED→GREEN gate ran on an
  uncommitted scratch suite (5 cases mirroring Step 6's freshness, single-flight, deadline/trio, failure-clears-slot
  and missing-endpoint cases), deleted before commit; Step 6 still owns the committed tests. (b) The worktree had no
  `node_modules`; `pnpm install --frozen-lockfile` was run at the worktree root (as Steps 2-4) instead of symlinking
  the main worktree's, so pnpm never writes into the shared checkout. (c) `adminDirectory.ts` was run through
  prettier (new file); the `IdentityServiceClient` construction and the `listAdminUserIds` call wrap across lines.
- **Step 6 (2026-10-29) — test mechanics only, no behaviour deviation.** (a) Step 5 had already landed the code under
  test, so RED was captured twice against `src/services/adminDirectory.ts`: moved aside (`tsc` → `TS2307 Cannot find
  module '../services/adminDirectory.js'`), then mutated (single-flight guard removed + `waitForReady: true` added) →
  `tests 79, pass 77, fail 2` (single-flight, deadline). The file was restored byte-identical (`cmp`). (b) One extra
  case beyond the spec list, "relays only the header trio from inbound metadata", asserts an inbound `authorization`
  header is not relayed. It is in Step 6's own file and adds no production code. (c) `grpc.CallOptions` has no
  `waitForReady` member, so the deadline case reads it through a `Record<string, unknown>` cast. (d) The new
  `mtls.test.ts` case carries no `@AC-*` tag: that file's `@AC-*` tags belong to feature 210. The file already fails
  `prettier --check` at HEAD, so only the added lines are prettier-formatted (no whole-file reformat).
  `adminDirectory.test.ts` is prettier-clean. (e) The worktree had no `node_modules`, and the main worktree has none
  to symlink, so `pnpm install --frozen-lockfile --filter xstockstrat-notify... --filter xstockstrat` was run at the
  worktree root. That run installs husky, so the pre-commit hook runs.
- **Steps 7 + 8 (2026-10-29) — merged into one commit (operator decision, Option B).** Step 7 makes `admins:
  AdminDirectory` a required 3rd constructor argument, and `tsc` compiles the tests, so Step 7 alone cannot pass its
  own `pnpm run build` without Step 8's edits to every `new StubbedDispatcher`/`ExposedDispatcher` site. The operator
  chose to land Step 7's three files and Step 8's two test files together, with one red→green cycle on Step 8's
  tests, and to mark both steps done in that commit. Other notes, mechanics only: (a) RED was `tsc` TS2554 ×17
  ("Expected 2 arguments, but got 3/4"), and running the emitted `dist` gave `tests 61, pass 53, fail 8`; GREEN is
  `tests 88, pass 88, fail 0, skipped 0`. (b) The feature-165 targeted case keeps its `AC-4` title and gains `@AC-2`,
  and it switches from `capturingPool(SUBS)` to `sqlPool(GIVENS)`; `capturingPool` and `SUBS` stay for the other
  feature-165 cases. (c) `StubbedDispatcher` also overrides `logAdminLookupError` to record each call, so every
  `@AC-11` case counts escalations through the same subclass. (d) `reportAdminLookupError` reads the clock once per
  call. (e) None of the five files is prettier-clean at HEAD, so only the added lines follow prettier style; there is
  no whole-file reformat. (f) `pnpm run lint` has 0 errors. Warnings went from 211 to 233, and all 22 new ones are
  `no-explicit-any` (the spec's `catch (e: any)` and `e: any`, plus the test fakes).
- **Step 9 (2026-10-29) — verification tooling and TDD-evidence mechanics only, no code deviation.** (a) The
  provisioned `~/go/bin/golangci-lint` (v2.14.0) was built with go1.26 and refuses the module's `go 1.27.0`
  ("can't load config"). It was rebuilt at the same pin with `GOTOOLCHAIN=go1.27.0` into the session scratchpad;
  that build reports `0 issues.` (b) The spec puts every `@AC-*` portfolio test in Step 10, so the step-9 RED→GREEN
  gate ran on an uncommitted scratch test (drawdown alert for owner `u1` must carry `TargetUserId == "u1"`), deleted
  before commit. Step 10 still owns the committed tests. (c) Codebase Evidence cites the trading precedent at
  `trading.go:3348`; it is at `:3347` (also `:3693`, `:3709`). Citation drift only.
- **Step 10 (2026-10-29) — verification tooling and TDD-evidence mechanics only, no code deviation.** (a) Lint ran
  with the same go1.27 rebuild of golangci-lint v2.14.0 as Step 9, because the provisioned binary is go1.26; it
  reports `0 issues.` (b) Step 9's production change was already on the branch, so RED was captured by running the
  new tests against the pre-Step-9 `portfolio_service.go` (`574dc1cf~1`), swapped in temporarily and restored
  before GREEN. That file is not part of this commit.
- **Step 11 (2026-10-29) — TDD-evidence mechanics only, no code deviation.** The spec puts the `@AC-4`/`@AC-7`
  analysis tests in Step 12, so the step-11 RED→GREEN gate ran on an uncommitted scratch test (trigger alert for
  owner `user-42` and fundamentals-unavailable alert for owner `u1` must carry `target_user_id`), deleted before
  commit. Step 12 still owns the committed tests. Spec line cites (`:835-844`, `:851-860`) matched the tree.
- **Step 12 (2026-10-29) — test mechanics only, no behaviour deviation.** (a) Step 11's production change was
  already on the branch, so RED was captured by running the new tests against the pre-Step-11 `live_loop.py`
  (`330afc77~1`), swapped in temporarily and restored byte-identical before GREEN; that file is not in this commit.
  (b) The severity assertions read `live_loop_module.notify_pb2.ALERT_SEVERITY_WARNING`, as the existing feature-215
  test does, so the file gains no import. (c) `strategy_id` is not load-bearing in the `_loop` fixtures, so the
  `@AC-7` test overrides it to `strat-2` and asserts the spec title; it selects the alert with `_fund_alerts`.
- **Step 13 (2026-10-29) — line cites only, no behaviour deviation.** The spec's `tools.py:690-692` / `:699` sit at
  `:689-691` / `:698` (off by one); the text matched as quoted. The new docstring clause is a separate sentence on
  two lines so the Verification grep (`admin` and `push` on one line) hits `tools.py`. The agent venv lacked
  `httpcore`/`starlette`, so `uv sync --extra dev --frozen` was run before the pytest Verification (no lockfile change).
