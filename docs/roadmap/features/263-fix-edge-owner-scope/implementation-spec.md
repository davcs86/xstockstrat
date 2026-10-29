# Implementation Spec: fix-edge-owner-scope

**Status**: `pending`
**Created**: 2026-10-22
**Feature**: `docs/roadmap/features/263-fix-edge-owner-scope/feature.md`
**Total Steps**: 12
**Feature Branch**: `feature/fix-edge-owner-scope`
**Severity**: SEV-2 (Track C bug, debt-radar D-25, D-31)

---

## Execution Summary

This spec follows design.md's Chosen Approach (operator-approved 2026-10-22), in its build order.

1. **Proto first (Steps 1–2).** The trader BFF (Step 5) and the ledger (Step 3) both read the new
   `QueryEventsRequest.owner_only` field from the regenerated stubs.
2. **D-25 (Steps 3–7).** The ledger gets a shared caller-owner helper and an opt-in owner predicate
   (Steps 3–4). Then the trader BFF `queryEvents` takes one of three branches (Steps 5–6), and the e2e
   mock and fixtures prove the behaviour at the trader surface (Step 7).
3. **D-31 (Steps 8–11).** Config binds a non-admin caller's foreign body `user_id` to the header caller
   on `GetConfig`/`ListKeys` (Steps 8–9). The agent echoes the effective `user_id` (Steps 10–11).
4. **Same-PR docs (Step 12)**, per C-10 and P-03.

D-25 and D-31 do not depend on each other. Steps 8–11 can run before Steps 1–7 if the C-09 proto
approval stalls.

**Consumer surfaces (C-14).**

- **UI `/trader`.** Step 5 changes `src/lib/traderBff.ts`, the edge that `useReconciliationStatus`,
  `usePositionLineage` and `CopilotRail` reach. Step 7 proves it end to end through the BFF. The hooks
  themselves need no edits: a foreign account's `PERMISSION_DENIED` reaches `useReconciliationStatus`
  as a react-query error, which is its existing error state.
- **Agent MCP tools.** Step 10 changes the `get_config` / `list_config_keys` result label in
  `app/client.py` and the tool docstrings in `app/tools.py`. The agent's data comes from the config
  bind in Step 8.

The trader, insights and config-ui `getConfig`/`listKeys` forwards are closed by Step 8 with no BFF
edit (design.md D-31 "One site closes four edges").

## Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` foreign `account:` → PERMISSION_DENIED | Step 6 (vitest), Step 7 (e2e) |
| `@AC-2` no stream key → no foreign / NULL rows | Step 4 (ledger SQL capture), Step 6 (forces `ownerOnly`), Step 7 (e2e) |
| `@AC-3` own account + copilot isolation | Step 6, Step 7 |
| `@AC-4` non-admin `get_config` foreign id → bound | Step 9 (config), Step 11 (agent echo) |
| `@AC-5` non-admin `list_config_keys` foreign id → bound | Step 9, Step 11 |
| `@AC-6` own overlay still read | Step 9, Step 11 |
| `@AC-7` own lineage, no stream key | Step 4, Step 7 (evidence is the SQL capture plus the e2e mock, **not** a dev smoke test, because `usePositionLineage.ts:18` sends `sourceService: 'trading'`, which nothing writes) |
| `@AC-8` admin reads foreign overlay | Step 9, Step 11 |

## Step Dependencies

- Step 2 requires Step 1, because it regenerates the stubs from the edited `.proto`.
- Steps 3, 5 and 7 require Step 2. The ledger (ts-proto `ownerOnly`) and the UI (protobuf-es
  `ownerOnly`) compile against the regenerated stubs.
- Step 4 [test] covers Step 3 [service]. Step 6 [test] and Step 7 [test] cover Step 5 [service].
  Step 9 [test] covers Step 8 [service]. Step 11 [test] covers Step 10 [service].
  - Per P-06, `/sdd-execute` writes each test first and captures it failing against the
    pre-implementation tree, then captures it passing after the paired service step.
  - Step 7 is RED-provable before Step 5 because its mock returns foreign and NULL rows whenever
    `ownerOnly` is unset, which is today's BFF behaviour.
- Step 12 [docs] requires Steps 1–11, because it documents the shipped semantics.
- **Overlap: feature 257 (`fix-ledger-query-pagination`).** 257 is spec-ready on main-dev and edits
  the same `queryEvents` body (`ledgerServiceImpl.ts:124-176`). Its product spec anticipates no proto
  change, so field 7 is not expected to collide, but a textual rebase conflict is likely. Step 12 writes
  the `merge-order.md` row **only after the operator confirms the direction** (257 waits for 263). The
  impl-spec review left that decision open (context.md Open Threads).
- **Overlap: feature 241.** `configServiceImpl.ts` `setConfig` collides with Step 8's
  `getConfig`/`listKeys` hunks in the same file. The hunks are not expected to overlap.
- **Overlap: features 247 and 273.** Both edit `client.py` `get_config` (:2034-2080), which collides
  with Step 10. Rebase whichever lands second.
- **Feature 242 is not an overlap.** Its implementation spec edits no `traderBff.ts`, and it only reads
  config `authz.ts:135-142` (`peerDnsSans`) as a copy source
  (`242-fix-push-untargeted-broadcast/implementation-spec.md:183`). The triage-time claim that it touches
  both files is not supported, so no rebase is expected.

---

### Step 1 — proto: add `owner_only` to `QueryEventsRequest`

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/ledger/v1/ledger.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking change, buf lint/breaking pass;
`xstockstrat-ledger` owner — append-only invariant, event ordering; `xstockstrat-ui` owner — Connect-RPC
call safety

**Codebase Evidence**:
- `packages/proto/ledger/v1/ledger.proto:60-67`: `message QueryEventsRequest` uses fields 1–6, the last
  being `int64 from_sequence = 6;      // replay from sequence`. Field 7 is free.
- `QueryEventsResponse` is at `:69`, so the field is added inside the message, before its closing `}`.
- Feature 257's product spec on main-dev says "No proto changes anticipated". No other feature claims
  field 7.

**TDD**: N/A (proto contract; behaviour is tested in Steps 4/6/7)

**Covers**: —

**Instructions**:
1. After `from_sequence = 6`, add `bool owner_only = 7;` to `QueryEventsRequest`.
2. Give it a field comment of at most 2 lines stating the constraint, for example:
   `// When true, only rows whose user_id equals the caller's x-user-id (never NULL rows).`
   `// Every user-facing edge MUST set it; internal callers leave it false.`
3. This is an additive field and needs no enum (it is a boolean flag, so C-04 does not apply).
4. Record the C-09 approval gate in the PR description. If the gate stalls, the only fallback is the
   unverified peer-SAN gate (design.md Open Risks), and that is an escalation, not a silent swap.

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against "$(git rev-parse --path-format=absolute --git-common-dir)#branch=origin/main-dev,subdir=packages/proto"
```
- `--git-common-dir` resolves to the main checkout's `.git`, including from a worktree. `subdir=` is
  mandatory (PLAT-10). The against-ref is `origin/main-dev`, matching CI (`ci.yml:125`).
- Then confirm `grep -n "owner_only = 7" packages/proto/ledger/v1/ledger.proto` returns one line.

---

### Step 2 — proto-gen: regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/ledger/v1/ledger.pb.go` — modify (generated)
- `packages/proto/gen/go/ledger/v1/ledger_grpc.pb.go`, `packages/proto/gen/go/ledger/v1/ledgerv1connect/` —
  expected unchanged (no RPC change)
- `packages/proto/gen/python/ledger/v1/ledger_pb2.py` — modify (generated)
- `packages/proto/gen/ts/ledger/v1/ledger.ts`, `packages/proto/gen/ts/ledger/v1/ledger_pb.ts` — modify (generated)
- `packages/proto/gen/ts/dist/ledger/v1/ledger.{js,d.ts}`, `packages/proto/gen/ts/dist/ledger/v1/ledger_pb.{js,d.ts}` —
  modify (compiled)
- Exception to the exact-paths rule: the generator decides the final set. Any other ledger file it
  changes is accepted. A non-ledger change means the toolchain pins drifted, so stop and check.

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking change, buf lint/breaking pass;
`xstockstrat-ledger` owner — append-only invariant, event ordering; `xstockstrat-ui` owner — Connect-RPC
call safety (inherited from Step 1)

**Codebase Evidence**:
- Root `CLAUDE.md` § Generating Proto Stubs: `./scripts/buf-gen.sh` generates the TS, Python and Go
  stubs and compiles the TS package. The CI `proto-freshness` job enforces it.
- The ledger consumes ts-proto output: `services/xstockstrat-ledger/src/grpc/serviceDefinition.ts:1`
  imports `LedgerServiceService` from `@xstockstrat/proto/ledger/v1/ledger`.
- The UI consumes protobuf-es output: `services/xstockstrat-ui/src/lib/traderBff.ts:6` imports
  `LedgerService` from `@xstockstrat/proto/ledger/v1/ledger_pb`.
- `scripts/buf-gen.sh` generates the Python stubs with `python3 -m grpc_tools.protoc`, so the host needs
  `grpcio-tools`. Re-spec 2026-10-28: it is not installed on the execution host yet. PyPI is reachable,
  so this is a setup step, not a blocker.

**TDD**: N/A (generated code)

**Covers**: —

**Instructions**:
1. If `python3 -c "import grpc_tools"` fails, install it first with `python3 -m pip install grpcio-tools`
   (or through `uv`). Then run `./scripts/buf-gen.sh` from the repo root.
2. Do not hand-edit anything under `packages/proto/gen/`. Never Read or Grep the generated stubs (root
   `CLAUDE.md` § Key File Paths).
3. If Docker or GitHub-releases egress is unavailable, follow
   `docs/runbooks/codegen-toolchain-host-setup.md`.

**Verification**:
```bash
./scripts/buf-gen.sh && git status --short packages/proto/gen/ | grep -i ledger
```
- Expect only ledger stub files to change.
- A second `./scripts/buf-gen.sh` run must leave `git diff --stat packages/proto/gen/` unchanged
  (freshness).

---

### Step 3 — service: ledger shared caller-owner helper + opt-in `queryEvents` owner predicate

**Status**: `done`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts` — modify

**Reviewers**: `xstockstrat-ledger` owner — append-only invariant (no deletes or updates), event ordering;
Security — a caller reads only their own data

**Codebase Evidence**:
- `ledgerServiceImpl.ts:124` is `async queryEvents(call: any, callback: any)`. It builds `conditions` and
  `params` with a `$${p++}` counter (`:126-154`).
- `:156` builds `const where = conditions.length ? \`WHERE ${conditions.join(' AND ')}\` : '';`, and the
  SELECT is at `:162` (`SELECT * FROM ledger.events ${where} ORDER BY recorded_at ASC LIMIT $${p}`).
- There is no owner predicate today.
- `exportEvents` (`:282`) derives the owner as follows:
  - `:301` comment: `// Empty caller matches nothing (user_id = '' never true), excluding historical NULL-user_id rows.`
  - `:302`: `const caller: string = call.metadata?.get?.('x-user-id')?.[0] ?? '';`
  - `:311`: `WHERE user_id = $1`
- Module-level helpers live beside `readCursor` (`:13`), `toValidDate` (`:359`) and `rowToEvent`
  (`:364`).
- The four internal Go callers never set the new field: portfolio
  `internal/service/portfolio_service.go:534/:751/:796` and trading `internal/service/trading.go:2222`
  (recon.md:203-212). Their SQL is unchanged.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add an exported module-level helper next to `toValidDate`. It returns the inbound caller id, or `''`.
   ```ts
   export function callerUserId(call: any): string { return call.metadata?.get?.('x-user-id')?.[0] ?? ''; }
   ```
   Move the existing `:301` constraint comment (at most 2 lines) onto it.
2. In `exportEvents`, replace the inline derivation at `:302` with `const caller = callerUserId(call);`.
   This must not change behaviour (`@AC-11 @feature-021`).
3. In `queryEvents`, after the `fromSequence` condition (`:151-154`) and before `const where`, add:
   ```ts
   if (req.ownerOnly) { conditions.push(`user_id = $${p++}`); params.push(callerUserId(call)); }
   ```
   With the flag absent or false, `conditions`/`params` and therefore the SQL text are byte-identical to
   today's.
4. An empty caller under `ownerOnly` binds `''`, which matches nothing. NULL rows never match
   `user_id = $n`, so the predicate always excludes them.
5. Do not touch `streamEvents` (`:182`) or `getEvent` (`:262`). They are recorded as a follow-up finding
   in Step 12.

**Verification**: see Step 4. Also run `grep -n "callerUserId" services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts`
and expect the definition, one use in `exportEvents` and one in `queryEvents`.

---

### Step 4 — test: ledger owner-predicate SQL capture

**Status**: `done`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/__tests__/ledgerServiceImpl.test.ts` — modify

**Reviewers**: `xstockstrat-ledger` owner — append-only invariant, event ordering

**Codebase Evidence**:
- `ledgerServiceImpl.test.ts:35`: `makePool` ignores SQL (`async query(_sql, _params)`), so these
  tests need a capturing pool.
- `:545`: `makeStreamCall(req, userId)` supplies `metadata.get('x-user-id')`.
- `describe('queryEvents')` is at `:142`, and the `describe('exportEvents')` SQL-capture model is at
  `:624` (`captured.sql` / `captured.params`).
- **Vacuous-green trap** (`docs/roadmap/ledger/fails.md:1941-1956`, feature 021): the impl uses TS
  parameter properties (`ledgerServiceImpl.ts:20-24`, `constructor(private readonly pool…)`), which
  `node --experimental-strip-types` cannot load.
  - The test file's guarded import (`:21-29`) and `if (!impl) return;` then pass with zero assertions.
  - So `pnpm run test:coverage` alone is **not** RED/GREEN evidence.

**TDD**: `red-green required`

**Covers**: `AC-2, AC-7`

**Instructions**:
1. Add a capturing helper beside `makePool`, as an inline single-consumer test double (C-13 verdict:
   one consumer, inline is compliant). It records `{ sql, params }` and returns the given rows.
2. Give the call shape metadata by reusing `makeStreamCall(req, userId)`, which already carries
   `x-user-id`. Never re-declare it.
3. In `describe('queryEvents')`, add:
   - **(a)** `ownerOnly: true` with caller `u-a`: the SQL contains `user_id = $N` and the params contain
     `'u-a'`. *(AC-2/AC-7: own rows match, NULL and foreign rows cannot.)*
   - **(b)** `ownerOnly: true` with an empty caller: the bound value is `''`, which matches nothing.
   - **(c)** Flag absent, with `{ eventType: 'order.filled', streamKey: 'order:1' }`: the captured SQL
     and params are exactly equal (`assert.strictEqual` / `deepStrictEqual`) to the pre-change shape,
     `SELECT * FROM ledger.events WHERE stream_key = $1 AND event_type = $2 ORDER BY recorded_at ASC LIMIT $3`,
     and contain no `user_id`. This pins the internal Go callers.
   - **(d)** `ownerOnly` combined with `eventType`: placeholders stay sequential, the user param sits
     at the right index, and the `LIMIT` placeholder is last.
4. The existing `describe('exportEvents')` cases (`:624+`) stay unchanged and guard the helper
   extraction.

**Verification**:
```bash
cd services/xstockstrat-ledger && pnpm run build && node --test dist/__tests__/ledgerServiceImpl.test.js
cd services/xstockstrat-ledger && pnpm run test:coverage && pnpm run lint
```
- The first command is the RED/GREEN evidence. It compiles the impl, so the tests actually run: RED
  before Step 3 (new cases a/b/d fail), GREEN after.
- The second command is the CI-parity coverage and lint gate. Its threshold is **40% lines** (c8
  `--lines 40` in `package.json:14`; the `node-test` job in `docs/patterns/ci-overview.md`).
- That run uses `--experimental-strip-types`, so it can pass vacuously (fails.md:1941). Its coverage
  number does not count as evidence for the new cases. Only the compiled `node --test dist/...` run does.
- C-13: `grep -n "makeStreamCall" services/xstockstrat-ledger/src/__tests__/ledgerServiceImpl.test.ts`
  should show one declaration and reuses only.

---

### Step 5 — service: trader BFF `queryEvents` three-branch owner scoping

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/traderBff.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety, trader BFF IDOR guards, no regression of
position lineage / reconciliation status; Security — a caller reads only their own data

**Codebase Evidence**:
- `traderBff.ts:118-127` (`queryEvents`) rewrites only keys that start with `COPILOT_STREAM_PREFIX` and
  forwards everything else unchanged. This is the bug.
- Already imported:
  - `tradingClient` (`:9`) and `ledgerClient` (`:14`) from `@/lib/connectClients`
  - `requireSession` and `backendHeaders` from `@/lib/bffShared` (`:17-25`)
  - `COPILOT_STREAM_PREFIX` and `copilotStreamKey` from `@/lib/copilot` (`:26`; `copilot.ts:9`/`:27`)
- `listBrokerAccounts` is a plain `forward` at `:53`.
- Trading scopes it per user: `services/xstockstrat-trading/internal/repository/account_repo.go:84-92`
  runs `WHERE user_id = $1`. The request is empty and the response is `repeated BrokerAccount accounts`
  with `string id = 1` (`packages/proto/trading/v1/trading.proto:238-239`, `:297-301`). It is not
  paginated.
- `backendHeaders` (`bffShared.ts:38-44`) builds `x-user-id`, `x-access-scope` and `x-trace-id`
  (C-03).
- `ConnectError` and `Code` are **not** yet imported in `traderBff.ts`. `bffShared.ts` imports them from
  `@connectrpc/connect`.
- Owned `account:` streams carry NULL-owned rows: `trading.go:1930` emits `reconciliation.mismatch_found`
  with an empty user id. So branch 2 must forward unfiltered (AC-3).
- `usePositionLineage.ts:16-20` sends no `streamKey`, and `useReconciliationStatus.ts:12-15` sends
  `account:${accountId}`.
- There is no existing `'account:'` constant in `services/xstockstrat-ui/src` (the only hit is the hook's
  template literal).
- fails.md:1652-1654: `traderBff.ts` is a server bundle. Add no client-only import.
- Re-verified 2026-10-28 after the main-dev merge: `queryEvents` `:118-127` (handler comment `:116-117`),
  `listBrokerAccounts` `:53`, `appendEvent` `:130`, ConfigService block `:144-147`; `backendHeaders`
  `bffShared.ts:38`; `COPILOT_STREAM_PREFIX`/`copilotStreamKey` `copilot.ts:9`/`:27`; `trading.go:1930`;
  `account_repo.go` `WHERE user_id = $1`. `dispatchConnect` is exported at `traderBff.ts:151`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add `import { ConnectError, Code } from '@connectrpc/connect';` to `traderBff.ts`.
2. Add a module-local `const ACCOUNT_STREAM_PREFIX = 'account:';`. It has one consumer, so it stays
   module-local (YAGNI; the hook keeps its literal).
3. Rewrite `queryEvents`. Build `const headers = backendHeaders(claims, ctx);` **once** and reuse it for
   every outbound call, so one `x-trace-id` covers the request. The browser can never control
   `ownerOnly`: every branch sets it explicitly. Take the first matching branch:
   1. **Copilot key.** If `req.streamKey?.startsWith(COPILOT_STREAM_PREFIX)`, forward
      `{ ...req, streamKey: copilotStreamKey(claims.user_id), ownerOnly: false }`. This is today's
      rewrite, kept.
   2. **Account key.** If `req.streamKey?.startsWith(ACCOUNT_STREAM_PREFIX)`:
      - Let `accountId` be the exact remainder after the prefix.
      - If `accountId` is empty, throw `new ConnectError('stream not owned by caller', Code.PermissionDenied)`.
      - Otherwise `await tradingClient.listBrokerAccounts({}, { headers })`. Do not catch it: a trading
        `ConnectError` (UNAVAILABLE, DEADLINE_EXCEEDED, …) propagates with its own code, so the request
        fails closed with no ledger call.
      - If no `accounts[].id === accountId`, throw the same `PermissionDenied`.
      - If the account is owned, forward `{ ...req, ownerOnly: false }` unfiltered, so the owner keeps the
        NULL-owned `reconciliation.*` rows.
   3. **Any other key, or an empty key.** Forward `{ ...req, ownerOnly: true }` (FR-2).
4. Replace the `:116-117` handler comment with at most 2 constraint lines. For example: "Every branch
   sets ownerOnly server-side; account: keys are ownership-checked via trading ListBrokerAccounts
   (errors pass through)."
5. Each `account:` poll now makes one extra trading RPC. This is accepted with no cache (design.md
   Rejected Alternatives). After deploy, a dev smoke check of the `/trader` reconciliation poll latency
   is advisable. It is not acceptance evidence.
6. Leave `appendEvent` (`:130-141`), the ConfigService block (`:144-147`) and `insightsBff.ts:148-157`
   unchanged.

**Verification**: see Steps 6 and 7. Also:
```bash
grep -n "backendHeaders(claims, ctx)" services/xstockstrat-ui/src/lib/traderBff.ts
```
- Within `queryEvents`, expect one call, and expect both `listBrokerAccounts` and `queryEvents` to use
  the same `headers`. This is the header-propagation evidence (reuses the propagating `backendHeaders`).
- Then run `cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit`.

---

### Step 6 — test: trader BFF `queryEvents` unit test (vitest)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/__tests__/traderBff.test.ts` — create

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety, trader BFF IDOR guards

**Codebase Evidence**:
- No `traderBff` or `bffShared` unit test exists (recon.md Not found). The model is
  `src/lib/__tests__/insightsBff.test.ts`:
  - `vi.mock('@/lib/auth', …)` (starting `:11`) stubs `verifyAccessToken`, `rolesToAccessScope`,
    `generateTraceId` and `hasAdminScope`
  - `fakeCtx()` (`:27`)
- `traderBff.ts:151` exports `dispatchConnect = createDispatch(router, '/trader/api')`, and
  `bffShared.ts:115` (`createDispatch`) dispatches a `Request` by pathname.
- `src/lib/__tests__/traderBff.test.ts` does not exist yet (re-verified 2026-10-28), so it is a create.
- `vitest.config.ts`: node environment, `include: ['src/**/*.test.ts']`, `@` alias. Coverage excludes
  `src/lib/*Bff.ts`, so this test adds no threshold pressure.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-7`

**Instructions**:
1. Mock `@/lib/auth` as `insightsBff.test.ts` does, with `user_id: 'u-a'` (`roles: ['trader']`).
2. `vi.mock('@/lib/connectClients', …)` with `tradingClient.listBrokerAccounts` and
   `ledgerClient.queryEvents` as `vi.fn`s. The other exported clients are empty objects.
3. Drive the real handler through `dispatchConnect(new Request('http://localhost/trader/api/xstockstrat.ledger.v1.LedgerService/QueryEvents', { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'access_token=t' }, body: JSON.stringify({...}) }))`.
4. Add these cases:
   - **AC-1.** `listBrokerAccounts` resolves `{ accounts: [{ id: 'acct-a' }] }` and the request is
     `{ streamKey: 'account:acct-b' }`. The response is a Connect `permission_denied` error, and
     `ledgerClient.queryEvents` is not called.
   - **AC-1, empty id.** `{ streamKey: 'account:' }` returns `permission_denied` and makes no trading or
     ledger call.
   - **Trading error.** `listBrokerAccounts` rejects with `new ConnectError('x', Code.Unavailable)`.
     The response code is `unavailable`, not `permission_denied`, and no ledger call is made.
   - **AC-3, account.** `{ streamKey: 'account:acct-a' }` → ledger called with `ownerOnly: false` and the
     key unchanged.
   - **AC-3, copilot.** `{ streamKey: 'copilot:anything' }` → ledger called with `streamKey: 'copilot:u-a:default'`
     (via `copilotStreamKey('u-a')`, not a re-typed literal) and `ownerOnly: false`.
   - **AC-2/AC-7.** `{ eventType: 'order.filled' }` with no key → ledger called with `ownerOnly: true`.
     Also `{ streamKey: 'portfolio:u-b' }` → `ownerOnly: true`.
   - **Browser override.** `{ eventType: 'order.filled', ownerOnly: false }` from the browser → ledger is
     still called with `ownerOnly: true`.
   - **C-03.** The ledger call's and the trading call's `headers` carry the same `x-trace-id` and
     `x-user-id: 'u-a'`.
5. C-12 verdict: the inputs are scenario one-offs (sentinel account ids, error payloads). They stay
   inline, and no domain fixture is added.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec vitest run src/lib/__tests__/traderBff.test.ts
cd services/xstockstrat-ui && pnpm run test:coverage && pnpm run lint
```
- RED before Step 5: the AC-1, AC-2 and override cases fail. GREEN after.
- Coverage threshold: **40%** lines/statements over `src/lib/**` (`vitest.config.ts` `thresholds`).
  `src/lib/*Bff.ts` is excluded, so this test cannot move the number. The gate only must not regress.

---

### Step 7 — test: trader BFF owner scoping end to end (e2e mock + fixtures + spec)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/fixtures/ledgerEvents.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify
- `services/xstockstrat-ui/e2e/trader/ledger-owner-scope.spec.ts` — create

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety, trader BFF IDOR guards, no regression of
position lineage / reconciliation status

**Codebase Evidence**:
- `e2e/mock-backend.ts:394-471`: `LedgerService.queryEvents` has these branches:
  - `portfolio.position.closed` (`:399`)
  - copilot (`:418`; `copilotThreads.get` at `:419`), keyed by `req.streamKey` in `copilotThreads`
  - `account:` (`:435`), which returns one `reconciliation.mismatch_found`
  - a default `order.filled` return (`:450-470`), with no top-level `userId` and `sourceService: 'trading'`
    (`:456`)
  It has no owner or `ownerOnly` branch.
- `mock-backend.ts:321-323`: `listBrokerAccounts` returns `BROKER_ACCOUNTS` (a second router's copy at
  `:1354` is unrelated and stays untouched). That is
  `[BROKER_ACCOUNT_ALPACA ('alpaca-default'), BROKER_ACCOUNT_IBKR ('ibkr-001')]`
  (`e2e/fixtures/accounts.ts:15-16`, `:24-25`, `:75`).
- `e2e/fixtures/ledgerEvents.ts:7` imports `TEST_USER_ID` from `./users`
  (`users.ts:9`, `'test-user-001'`). INVENTORY.md row `:81` records that the inline `order.filled`
  branch migrates opportunistically, under the "migrate opportunistically" policy at `:73`.
- No existing spec depends on the default AAPL `mock-order-001` row: `positions.spec.ts` intercepts its
  own lineage query, and the api-smoke `QueryEvents` test asserts the shape only when
  `events.length > 0`.
- `e2e/trader/api-smoke.spec.ts:194-221` is the BFF `fetch` pattern (`addAuthCookie(page)`,
  `page.goto('/auth/login')`, `page.evaluate(fetch('/trader/api/xstockstrat.ledger.v1.LedgerService/QueryEvents'…))`).
- The existing `positions-reconciliation.spec.ts` uses `account:alpaca-default`, which is owned in the
  mock, so it keeps passing.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-7`

**Instructions**:
1. **Fixtures.** In `ledgerEvents.ts`, add an exported `OWNER_SCOPE_ORDER_FILLED_EVENTS` array, shaped
   like `LedgerEvent` and following the file's existing neutral-row convention. It holds three
   `order.filled` rows:
   - one owned by `TEST_USER_ID`, symbol `MSFT` (AC-7)
   - one owned by a foreign user `u-b`, symbol `AAPL`
   - one with an empty `userId` (NULL-owned legacy), symbol `TSLA`, stream `account:acct-legacy`
   Add one catalog row for it to `INVENTORY.md`, and update the `:81` row: the `order.filled` default
   branch now comes from this fixture.
2. **Mock.** In `mock-backend.ts`, replace the default `order.filled` return (`:450-470`) so it returns
   the rows from `OWNER_SCOPE_ORDER_FILLED_EVENTS`. When `req.ownerOnly` is true, it returns only the
   rows whose `userId === TEST_USER_ID`; otherwise it returns all three.
   - This mirrors the ledger predicate and lets the spec fail RED against today's BFF.
   - The mock no longer filters on `sourceService`, matching today's behaviour, which ignores it.
   - Keep the `account:` and copilot branches unchanged.
3. **Spec.** Create `e2e/trader/ledger-owner-scope.spec.ts`, using the api-smoke `fetch` pattern and
   `addAuthCookie`, with these tests:
   - **AC-1.** `streamKey: 'account:acct-b'` (not in `BROKER_ACCOUNTS`) → the HTTP status is not 200, and
     the Connect error code is `permission_denied`.
   - **AC-2.** `{ eventType: 'order.filled' }` → no event has `userId === 'u-b'`, none has an empty
     `userId`, and none has symbol `TSLA`.
   - **AC-7.** The same response contains the `TEST_USER_ID` `MSFT` row.
   - **AC-3.** `streamKey: \`account:${BROKER_ACCOUNT_ALPACA.id}\`` returns the reconciliation event.
     `appendEvent` with a note and then `queryEvents` with `streamKey: 'copilot:anything'` returns exactly
     that note. A note seeded under `copilot:u-b:default` in the mock's `copilotThreads` is not returned.
     For the seed, use the mock's own store keyed by the resolved stream key, or assert that the
     resolved key is the caller's thread.
   Import fixtures from `../fixtures` / `../fixtures/ledgerEvents` and auth from `../helpers/auth`. Add no
   inline domain literals.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec playwright test e2e/trader/ledger-owner-scope.spec.ts e2e/trader/positions-reconciliation.spec.ts e2e/trader/api-smoke.spec.ts
grep -n "from '../fixtures\|helpers/auth" services/xstockstrat-ui/e2e/trader/ledger-owner-scope.spec.ts
grep -n "OWNER_SCOPE_ORDER_FILLED_EVENTS" services/xstockstrat-ui/e2e/fixtures/INVENTORY.md
cd services/xstockstrat-ui && pnpm run lint
```
- RED before Step 5: AC-1 and AC-2 fail. GREEN after, with the reconciliation and api-smoke specs still
  passing.
- C-12: confirm the fixture imports and the `INVENTORY.md` row.
- Coverage threshold: none. Playwright is not coverage-gated (the `frontend-e2e` job in
  `docs/patterns/ci-overview.md`).

---

### Step 8 — service: config `boundReadUserId` on `GetConfig` / `ListKeys`

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/authz.ts` — modify
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify

**Reviewers**: `xstockstrat-config` owner — global/per-user scoping, secret redaction, WatchConfig stream
stability; Security — a caller reads only their own per-user data, explicit admin override

**Codebase Evidence**:
- `authz.ts` helpers:
  - `:8` `export const ADMIN_SCOPE = 0x04;`
  - `:20-24` `hasAdminAccessScope(md?)`, which fails closed on an absent or unparseable scope
  - `:27-29` `userIdFrom(md?)`, which returns `first(md, HEADER_USER_ID)`
- `configServiceImpl.ts`:
  - `:78` `requestUserId(req)` reads the body `userId ?? user_id ?? ''`
  - `getConfig` `:315`, with `const userId = requestUserId(call.request);` at `:317`, feeding
    `resolveOverlayValues` (`:229-243`, `WHERE … user_id = $3`)
  - `listKeys` `:527`, with `requestUserId` at `:529` feeding the SQL
    `(user_id IS NULL OR user_id = $3)` (`:536`)
  - the `authz` import block is `:3-14`
- `setConfig` (`:371`; header read at `:376`) is the reference header-derived pattern
  (`const callerUserId = userIdFrom(call.metadata);`). Feature 241 (merged) also lives there.
- `watchConfig` (its `requestUserId` call is at `:283`) and `getSecret` (`:335-343`) must stay
  untouched. That preserves invariant #5 (`services/xstockstrat-config/CLAUDE.md:36`, with the
  "deliberately **open**" text at `:40`), `@AC-13 @feature-147` and NC-B.
- The config-ui admin view stays exempt:
  - `configUiBff.ts:33` `listKeys: forward(...)` sends `backendHeaders`
  - `rolesToAccessScope` sets `ADMIN_SCOPE` for `admin` (`ui src/lib/auth.ts:79`, `:89`)

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `authz.ts`, after `userIdFrom`, add the exported `boundReadUserId(call: { metadata?: Metadata; request?: any }, bodyUserId: string): string`.
   - Let `caller = userIdFrom(call.metadata)`.
   - If `caller !== ''`, `!hasAdminAccessScope(call.metadata)`, `bodyUserId !== ''` and
     `bodyUserId !== caller`, return `caller`. Otherwise return `bodyUserId`.
   - There is no refusal path (operator decision of 2026-10-22).
   - Give it a doc comment of at most 2 lines stating the constraint: a header-less caller keeps the body
     id, and an empty body id stays global.
   - Taking `bodyUserId` as a parameter keeps `requestUserId` as the single body reader (DRY).
2. In `configServiceImpl.ts`, add `boundReadUserId` to the `./authz` import block. At `getConfig:317`,
   use `const userId = boundReadUserId(call, requestUserId(call.request));`. Do the same at
   `listKeys:529`.
3. Leave `watchConfig`, `getSecret`, `setConfig` (the 241 overlap zone) and `resolveOverlayValues`
   unchanged. Redaction runs after the bind, inside `buildConfigValue` and the `listKeys` mapping, so
   secrets stay redacted under a bound overlay.
4. Accepted gap, recorded in Step 12: header-less callers (agent stdio, empty claims) and `WatchConfig`'s
   body `user_id` are not bound.

**Verification**: see Step 9. Also:
```bash
grep -n "boundReadUserId" services/xstockstrat-config/src/grpc/authz.ts services/xstockstrat-config/src/grpc/configServiceImpl.ts
```
- Expect one definition and exactly two call sites, in `getConfig` and `listKeys`.
- Confirm that `watchConfig` and `getSecret` still call `requestUserId` directly.

---

### Step 9 — test: config read-binding matrix

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/readUserBinding.test.ts` — create

**Reviewers**: `xstockstrat-config` owner — global/per-user scoping, secret redaction

**Codebase Evidence**:
- `src/__tests__/scopeResolution.test.ts:19-70` is the model:
  - it starts a real gRPC server with `createConfigServiceDefinition()` and
    `new ConfigServiceImpl(pool)`
  - its capturing `pool.query` routes on SQL text (`DISTINCT ON (key)` → `listParams`)
  - its client is `ConfigServiceClient` from `@xstockstrat/proto/config/v1/config`
- `setConfigAuthz.test.ts:43` declares the `md(pairs)` Metadata builder, and `:139-149` passes explicit
  `metadata` to a unary call.
- `HEADER_ACCESS_SCOPE` and `HEADER_USER_ID` are exported from `authz.ts:10-11`.
- The test runner is `tsc && node --test dist/__tests__/*.test.js`, and `test:coverage` is
  `tsc && c8 --lines 40 …` (`package.json:13`), so it compiles first and does not fall into the vacuous strip-only trap.

**TDD**: `red-green required`

**Covers**: `AC-4, AC-5, AC-6, AC-8`

**Instructions**:
1. Copy the real-server harness pattern from `scopeResolution.test.ts`.
2. Use a pool that:
   - captures the params of `WHERE namespace = $1 AND environment = $2 AND user_id = $3` (the
     `getConfig` overlay)
   - captures the params of the `DISTINCT ON (key)` query (`listKeys`)
   - returns per-user rows keyed by `params[2]`: for `u-b`, `analysis.backtest.max_duration_seconds`
     = 900; for `u-a`, = 450
   - also returns one `is_secret: true` row for `u-a`
2. Write the cases, with metadata `x-user-id` / `x-access-scope`:
   - **AC-4.** Non-admin `u-a` (scope `11`) calls `getConfig` with body `userId: 'u-b'`. The bound
     param is `'u-a'`, the value returned is 450, and 900 is never returned.
   - **AC-5.** Non-admin `u-a` calls `listKeys` with body `u-b`. `listParams[2] === 'u-a'`.
   - **AC-6.** Non-admin `u-a` calls with body `u-a`. The param is `'u-a'` (the own overlay).
   - **AC-8.** Admin `u-admin` (scope `15`) calls with body `u-b`. The param is `'u-b'`, for both RPCs.
   - **Header-less caller** (no metadata) with body `u-b`. The param is `'u-b'`, so boot and internal
     readers are unchanged.
   - **Empty body** from non-admin `u-a`. The overlay query is skipped (`getConfig`), and
     `listParams[2] === ''` (global; `@AC-13 @feature-219`).
   - **Secret under a bound overlay.** The `u-a` secret row comes back redacted (`isSecret: true`, with
     no plaintext).
   - **Regression pin.** A header-carrying non-admin "internal" caller asking with a foreign id gets a
     successful response bound to its header id, not an error. This pins bind-not-refuse.
3. Unit-test `boundReadUserId` directly over a small `md()` matrix built with a local Metadata builder.
   - C-13 verdict: `setConfigAuthz.test.ts` already declares `md()` inline. This makes it a second
     consumer of a **test helper**, not of domain data, so C-13 does not require centralizing it.
   - Prefer a single-file inline helper. If the `dry-reviewer` or jscpd flags it, move both into
     `src/__tests__/fixtures/` in this step.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run test:coverage && pnpm run lint
grep -n "__tests__/fixtures" services/xstockstrat-config/src/__tests__/readUserBinding.test.ts || echo "inline (single-file helper)"
```
- Coverage threshold: **40% lines** (c8 `--lines 40`, `package.json:13`).
- `test:coverage` compiles first, so the cases really run. RED before Step 8 (AC-4/AC-5 cases fail).
  GREEN after, with the existing `scopeResolution`, `listKeys*`, `secretsAndScope` and `perUserSecrets`
  suites still green.

---

### Step 10 — service: agent echoes the effective `user_id`; docstrings state the bind

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape),
`docs/runbooks/mcp-tools.md` parity, admin `x-access-scope` forwarded only by management tools

**Codebase Evidence**:
- `client.py:39-42`: `_Caller = tuple[str, int, str]  # (user_id, access_scope, trace_id)`, and
  `_CALLER: contextvars.ContextVar[_Caller | None]` defaults to `None`, so stdio and pre-token paths
  carry no caller.
- `client.py:2040` is `async def get_config(namespace, environment, user_id="")`. It echoes
  `"user_id": user_id` at `:2065`.
- `client.py:2070` is `async def list_config_keys(...)`. It echoes at `:2086`.
- `app/scopes.py:35`: `_ADMIN = 0x04`. `scopes.py` imports only `os` (`:14`), so `client.py` importing
  from it creates no import cycle.
- Tool docstrings:
  - `tools.py:1603-1604` (`get_config`): "pass a user id to see that user's per-user overrides…"
  - `tools.py:1631-1632` (`list_config_keys`): same wording
- The tools stay ctx-less, so `tests/test_config_tools.py:78/:320/:328` and
  `test_config_tools_expose_no_environment_parameter` are unaffected.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `client.py`, import `_ADMIN` from `app.scopes`.
2. Next to the config wrappers, add a private helper `_effective_config_user_id(user_id: str) -> str`.
   - Let `caller = _CALLER.get()`.
   - If `caller` is set, `caller[0]` is non-empty, `not (caller[1] & _ADMIN)`, and `user_id` is non-empty
     and differs from `caller[0]`, return `caller[0]`. Otherwise return `user_id`.
   - Give it a comment of at most 2 lines saying it mirrors config `boundReadUserId`
     (`services/xstockstrat-config/src/grpc/authz.ts`) and must change with it.
3. At `:2065` and `:2086`, echo `"user_id": _effective_config_user_id(user_id)`.
4. Leave the request `user_id` sent to config unchanged (the agent-to-config wire stays the same), and
   leave the metadata via `_metadata()` unchanged.
5. In `tools.py`, reword both docstrings' `user_id:` lines in no more than the same line budget:
   - a non-admin caller passing another user's id is bound to their own id
   - the returned `user_id` is the scope actually read
   - admins may read any user's overlay
6. Out of scope here: `set_config` and `_write_source_bearer` (241's zone), and the `client.py` deadline
   (247/273's zone).

**Verification**: see Step 11. Also run `grep -n "_effective_config_user_id" services/xstockstrat-agent/app/client.py`
and expect one definition plus two uses.

---

### Step 11 — test: agent effective `user_id` echo

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_config_tools.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability, return shape

**Codebase Evidence**:
- The stub-capture harness is `TestSetConfigRequestParity` (`test_config_tools.py:255`; the
  `mtls`/`ConfigServiceStub` patches are at `:277-278`). It patches `app.client.mtls` with a `secure_channel` async-context-manager mock, and patches
  `config_pb2_grpc.ConfigServiceStub` to return an `AsyncMock` stub.
- `client.set_caller(user_id, access_scope, trace_id)` returns a token, and `client.reset_caller(token)`
  releases it (`client.py:45` and `:53`; usage in `tests/test_header_propagation.py:40-45` and
  `tests/test_template_tools.py:39-43`).
- Claims are in `tests/conftest.py:14-15`: `ADMIN u-1`, `TRADER u-2`. `roles_to_access_scope`
  maps trader→11 and admin→15.

**TDD**: `red-green required`

**Covers**: `AC-4, AC-5, AC-6, AC-8`

**Instructions**:
1. Add a `TestConfigReadEchoesEffectiveUserId` class that uses the same stub-patch shape as
   `TestSetConfigRequestParity`.
   - Stub `GetConfig` to return `config_pb2.ConfigSnapshot(namespace="analysis", version="1")`
     (`packages/proto/config/v1/config.proto:23` `rpc GetConfig(GetConfigRequest) returns (ConfigSnapshot)`).
   - Stub `ListKeys` to return `config_pb2.ListKeysResponse()` (`config.proto:29`).
2. Bind the caller with `client.set_caller(TRADER["user_id"], 11, "t")` in `try/finally` with
   `reset_caller`. Write these cases:
   - **AC-4.** `client.get_config(namespace="analysis", environment="staging", user_id="u-b")` echoes
     `user_id == "u-2"`. The request sent still carries `user_id="u-b"` (wire unchanged).
   - **AC-5.** The same for `client.list_config_keys`.
   - **AC-6.** With `user_id="u-2"`, the echo is `"u-2"`.
   - **AC-8.** An admin caller (`set_caller(ADMIN["user_id"], 15, "t")`) with `user_id="u-b"` gets the
     echo `"u-b"`.
   - **No caller bound** (stdio). The echo equals the request.
   - **Empty `user_id` from a non-admin.** The echo is `""` (global).
3. C-13: reuse `TRADER`/`ADMIN` from `tests.conftest` (already imported at `test_config_tools.py:22`). The stub doubles are inline, with one consumer
   class.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest tests/test_config_tools.py -q
cd services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
grep -n "from tests.conftest\|conftest" services/xstockstrat-agent/tests/test_config_tools.py
```
- RED before Step 10 (the AC-4/AC-5 echo cases fail). GREEN after.

---

### Step 12 — docs: same-PR contract docs, findings, merge order (C-10, P-03)

**Status**: `pending`
**Service**: `docs/`, plus the CLAUDE.md files of `xstockstrat-ledger`, `xstockstrat-config` and `xstockstrat-agent`
**Files**:
- `services/xstockstrat-ledger/CLAUDE.md` — modify
- `services/xstockstrat-config/CLAUDE.md` — modify
- `services/xstockstrat-agent/CLAUDE.md` — modify
- `docs/runbooks/mcp-tools.md` — modify
- `docs/context-constitution-findings.md` — modify
- `docs/roadmap/features/merge-order.md` — verify only (the row already exists; item 6)
- `services/xstockstrat-ui/CLAUDE.md` — modify (Copilot rail paragraph `:164-170`; item 7)
- Likely teardown targets (item 8). Record each one in the Deviation Log if it is touched:
  `docs/context-constitution.md` and `services/xstockstrat-{ledger,config,agent,ui}/docs/context-constitution{,-findings}.md`

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-ledger/CLAUDE.md`:
  - Critical Invariants `:30-35`, with `#3` on stream_key
  - the `## Stream Key Conventions` table at `:97-106`, which lists `order:`, `portfolio:`, `backfill:`,
    `formula:`, `alert:` and `config:`, but has no `account:{id}` or `copilot:{user}:default` row
- `services/xstockstrat-config/CLAUDE.md:36`, invariant #5, whose text at `:40` reads
  "`GetConfig`/`ListKeys`/`WatchConfig` are deliberately **open**…"
- `services/xstockstrat-agent/CLAUDE.md`:
  - `:29-30`: "Body `user_id` is still sent where it is a **target/scope selector**… the config tools
    (per-user scope)"
  - `:74` `get_config` row: "scoped by an optional per-user `user_id`"
  - `:75` `list_config_keys` row
- `docs/runbooks/mcp-tools.md`: `### get_config` at `:1052`, `user_id` row at `:1059`; `### list_config_keys`
  at `:1077`, `user_id` row at `:1085`
- `docs/context-constitution-findings.md`: a `## Latent bugs` table at `:29` and `## Open questions` at
  `:45`. It is the root log for cross-module defects.
- `docs/roadmap/features/merge-order.md:78` **already** holds the operator-ordered row
  "`fix-ledger-query-pagination` (257) waits for `fix-edge-owner-scope` (263)" (2026-10-22). It arrived
  through the 2026-10-28 main-dev merge.
- After that merge, `docs/roadmap/features/257-fix-ledger-query-pagination/` exists on this branch
  (status `implementation-ready`). Its implementation spec already plans to rebase onto 263's
  `owner_only = 7`.

**TDD**: N/A (docs)

**Covers**: —

**Instructions**:
1. **Ledger `CLAUDE.md`.**
   - Add a Critical Invariant: `QueryEvents.owner_only` scopes to `user_id = x-user-id`, with NULL rows
     never returned. Every user-facing edge MUST set it. Internal callers leave it false. The field
     defaults to false, so it fails open.
   - Add `account:{account_id}` (xstockstrat-trading; reconciliation rows NULL-owned) and
     `copilot:{user_id}:default` (xstockstrat-ui BFF) rows to the Stream Key table.
2. **Config `CLAUDE.md` invariant #5.**
   - Reads stay open.
   - On `GetConfig`/`ListKeys`, a non-admin header caller's non-empty foreign body `user_id` is bound to
     `x-user-id` (`boundReadUserId`). Admins and header-less callers keep the body id. `WatchConfig` and
     `GetSecret` are unbound.
   - Future internal readers must not forward a user's `x-user-id` while asking about another user.
3. **Agent `CLAUDE.md`.**
   - At `:29-30`, the config tools' body `user_id` is a scope selector **bound to the caller for
     non-admins**.
   - Reword the `:74`/`:75` rows the same way. The echoed `user_id` is the scope actually read.
4. **`mcp-tools.md`.** Update the `get_config` and `list_config_keys` `user_id` rows and their Returns
   lines to the same semantics. The tool count, names and parameters are unchanged.
5. **Findings entry (P-03)** in `docs/context-constitution-findings.md` `## Latent bugs`, as one row,
   feature 263. These are the accepted gaps, each with evidence:
   - `WatchConfig` body `user_id` is unbound (`configServiceImpl.ts:284`)
   - header-less agent paths are unbound (`client.py:39-42`, stdio)
   - ledger `streamEvents` (`ledgerServiceImpl.ts:186`) and `getEvent` (`:266`) are owner-unscoped
   - the `order:<id>` NULL-owned `order_intent.*` rows are hidden by branch 3 (`trading.go:2246`,
     `:2277`)
   - `owner_only` fails open by default
6. **`merge-order.md`: verify, do not add.** The operator confirmed the direction on 2026-10-22, and
   the row "257 waits for 263" is already at `merge-order.md:78`. Do not add a duplicate row. Only
   confirm it with `grep -n "fix-edge-owner-scope" docs/roadmap/features/merge-order.md`.
   - The 241, 242, 247 and 273 overlaps are textual only, so per the file's coverage note they are
     recorded in this feature's `context.md`, not in `merge-order.md`.
7. **UI `CLAUDE.md` Copilot rail paragraph (`:164-170`).** It describes the "copilot-aware
   `queryEvents`". Add at most one sentence: `account:` keys are ownership-checked via trading
   `ListBrokerAccounts`, and every other key is forced to `owner_only` server-side.
8. **Teardown.** Run `/context-constitution refresh` scoped to the four touched modules plus root. If the
   plugin is unavailable, reconcile by hand and record that in the PR body, per the root `CLAUDE.md`
   Teardown rule.

**Verification**:
```bash
grep -n "owner_only" services/xstockstrat-ledger/CLAUDE.md
grep -n "account:{\|copilot:{" services/xstockstrat-ledger/CLAUDE.md
grep -n "boundReadUserId\|bound" services/xstockstrat-config/CLAUDE.md
grep -n "bound to the caller\|bound to their own" services/xstockstrat-agent/CLAUDE.md docs/runbooks/mcp-tools.md
grep -n "263" docs/context-constitution-findings.md docs/roadmap/features/merge-order.md
grep -n "ListBrokerAccounts" services/xstockstrat-ui/CLAUDE.md
```
Each grep must return at least one line. `merge-order.md` must have exactly one `fix-edge-owner-scope`
row (no duplicate).

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### DEV-1 — Step 2: host-native codegen with go1.27-built Go plugins (2026-10-28)

- **What**: Stubs were generated host-native (`./scripts/buf-gen.sh`), not via the `Dockerfile.codegen`
  image. The first run with the pre-installed `~/go/bin` plugins (pinned versions, but built with
  go1.24.7) also rewrote comment indentation in `gen/go/analysis/v1/analysis.pb.go` — a non-ledger
  change, so it was reverted. The three Go plugins were reinstalled at the CI pins
  (`protoc-gen-go@v1.36.11`, `protoc-gen-go-grpc@v1.6.2`, `protoc-gen-connect-go@v1.19.2`) with
  `GOTOOLCHAIN=go1.27.0` (CI `setup-go` 1.27) into a session-local `GOBIN` placed first on `PATH`.
  The re-run changed ledger files only, and a second run left the diff unchanged.
- **Disposition**: CI-equivalent fallback (sequential-mode verification fallbacks — proto codegen).
- **Spec change**: none. `ledger_grpc.pb.go`, `ledgerv1connect/`, `ledger_connect.ts`,
  `ledger_pb2_grpc.py` were unchanged, as expected.

### DEV-2 — Step 3: red/green evidence run against the compiled `dist/` module (2026-10-28)

- **What**: Step 3's verification defers to Step 4, which has not landed, and the in-repo suite is
  vacuous for the impl (its `../grpc/ledgerServiceImpl.js` import fails under both strip- and
  transform-types — fails.md feature 021 trap). RED/GREEN was captured with an uncommitted scratch test
  importing `dist/grpc/ledgerServiceImpl.js` after `pnpm run build`; the existing
  `ledgerServiceImpl.test.ts` cases were also re-run, non-vacuously, against `dist/` (29/29 pass).
- **Disposition**: CI-equivalent fallback (no spec change). Step 4 owns the committed tests.
- **Open for Step 4**: `tsconfig.json` does not emit `src/__tests__/` into `dist/`, so Step 4's
  `node --test dist/__tests__/ledgerServiceImpl.test.js` verification command finds no file as written.

### DEV-3 — Step 4: RED captured against the pre-Step-3 impl; DEV-2 open item resolved by feature 252 (2026-10-29)

- **What**: Step 3 had already landed, so RED was captured by temporarily restoring
  `ledgerServiceImpl.ts` from `5d81b32e` (pre-Step-3), building, and running the compiled suite; the
  file was then restored from the index (not committed). The DEV-2 open item no longer applies: the
  feature 252 merge (`816593e8`) made `build`/`test`/`test:coverage` compile `src/__tests__/` into
  `dist/` with a throwing import, so the spec's `node --test dist/__tests__/ledgerServiceImpl.test.js`
  runs as written and `test:coverage` is no longer vacuous (fails.md feature 021 trap closed).
- **Line drift** (no spec edit, F-09): `makePool` `:26`, `describe('queryEvents')` `:141`,
  `makeStreamCall` `:577`, `describe('exportEvents')` `:655` after this step.
- **Disposition**: no spec change; Step 4's verification ran unmodified.

### DEV-4 — Step 5: RED/GREEN captured with an uncommitted draft of the Step 6 test; pre-existing `tsc` error (2026-10-29)

- **What**: Step 5's paired test is Step 6 (`src/lib/__tests__/traderBff.test.ts`, create). To satisfy
  P-06 before implementing, a draft of that test (Step 6's eight case groups, driven through
  `dispatchConnect`) was written in the worktree, run RED against the pre-Step-5 `traderBff.ts`, then GREEN
  after; it was moved out before commit so Step 6 owns and commits it (F-08).
- **Verification note**: `pnpm exec tsc --noEmit` reports two errors in
  `e2e/insights/backfills.spec.ts:135-136` (`Property 'dataKind'/'timeframeEnum' does not exist on type
  'never'`). The output is byte-identical with and without the Step 5 change, so it is pre-existing and
  outside this step's Files; it was not touched.
- **Disposition**: CI-equivalent fallback for the RED/GREEN evidence (no spec change); the `tsc` error is
  an open item outside this feature's scope.

### DEV-5 — Step 6: RED captured against the pre-Step-5 handler (2026-10-29)

- **What**: Step 5 had already landed (`54ef1a73`), so the committed test's RED was captured by temporarily
  restoring `traderBff.ts` from `54ef1a73~1`, running the test (7/9 fail; the AC-3 account/copilot cases pass
  as baselines), and restoring the file from the index (not committed). GREEN: 9/9 on the Step 5 code.
- **Disposition**: CI-equivalent fallback for the RED evidence (same pattern as DEV-3); no spec change.

### DEV-6 — Step 7: RED via the pre-Step-5 handler; fixture and harness choices (2026-10-29)

- **RED**: Step 5 had already landed, so RED was captured by temporarily restoring `traderBff.ts` from
  `54ef1a73~1` (AC-1 and AC-2/AC-7 fail; both AC-3 cases pass as baselines), then restoring the file from
  the index (not committed). GREEN ran on the committed Step 5 code.
- **Foreign user**: the spec's foreign user `u-b` is the canonical second identity `TEST_USER_B_ID`
  (`'test-user-002'`, `fixtures/users.ts`), re-exported as `OWNER_SCOPE_FOREIGN_USER_ID`, so no new
  identity literal is added (C-12/C-13).
- **AC-3 copilot**: the foreign note is seeded in the mock's `copilotThreads` under
  `copilotStreamKey(OWNER_SCOPE_FOREIGN_USER_ID)` (the "mock's own store keyed by the resolved stream key"
  option). The spec queries with the foreign key itself (stricter than `copilot:anything`) and asserts
  every event is on the caller's key, the appended note is present, and the foreign note is absent. It
  asserts "present", not "exactly one", because the mock store lives for the whole Playwright run and is
  shared with `copilot.spec.ts` and retries. Keys come from `src/lib/copilot` (`copilotStreamKey`,
  `COPILOT_EVENT_TYPE`), not re-typed literals.
- **Harness**: the local dev-server `[setup]` warm-up exceeded its 10 s local timeout, so the
  verification ran with `--project=chromium --no-deps --timeout=120000`. The spec files and assertions
  are unchanged.
- **Formatting**: a standalone `prettier --check` flags the existing one-line `CLOSED_POSITION_ROWS`
  rows in `ledgerEvents.ts`. That is pre-existing. The pre-commit `lint-staged` pass left them unchanged,
  and the added lines are clean.
- **Disposition**: CI-equivalent fallback for the RED evidence and the harness flags. No spec change.

### DEV-7 — Step 8: RED/GREEN via an uncommitted draft of the Step 9 test (2026-10-29)

- **What**: Step 8's verification defers to Step 9 (`readUserBinding.test.ts`, create). To satisfy P-06
  before implementing, a draft of that test (AC-4, AC-5, AC-6, AC-8, header-less and empty-body cases over
  the real-server harness) was run RED against the pre-Step-8 handlers (2/5 fail: AC-4 and AC-5 bind
  `'u-b'`, not `'u-a'`; the rest pass as baselines), then GREEN (5/5) after the change. It was moved out
  before commit so Step 9 owns and commits the test (F-08), the same pattern as DEV-4.
- **Formatting**: `authz.ts` was run through `prettier --write`, which only wrapped the new helper.
  `configServiceImpl.ts` already fails `prettier --check` on lines this step does not touch, so it was not
  reformatted (surgical diff). The `request?: any` parameter adds one `no-explicit-any` lint warning; the
  signature is the spec's.
- **Disposition**: CI-equivalent fallback for the RED evidence (no spec change).
