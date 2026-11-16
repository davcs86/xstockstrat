# Implementation Spec: alert-detail-page

**Status**: `pending`
**Created**: 2026-11-15
**Feature**: `docs/roadmap/features/344-alert-detail-page/feature.md`
**Total Steps**: 23
**Feature Branch**: `feature/alert-detail-page`
**Tree**: `detached@5c62d0174 ≡ origin/feature/alert-detail-page` for every `path:line` below (later commits on the branch touch only this feature directory). `origin/main-dev@d1c97273b` is 4 commits ahead and **not merged** here: docs and `uv.lock` only, no source file cited below. It does change `services/xstockstrat-notify/docs/context-constitution.md` (adds NOTIFY-14..17), which Step 23 re-greps.

---

## Execution Summary

Backend first, so the UI has something real to call: the additive `GetAlert` proto (Steps 1–2), the notify handler and push deep link (Steps 3–6), then the ingest body (Steps 7–8). The UI follows in the design's build order: BFF and mock (9–10), shared helpers (11–12), the page and nav (13–14), the inbox title link (15–16). Steps 17–22 are **blocked on 339-fix-symbol-page-alerts-ui being merged**: they move the bell into the shared header, put the alert read models on one react-query prefix and add the drawer link. Step 23 is docs. Paths in the UI steps are relative to `services/xstockstrat-ui/` unless they start with `services/` or `packages/`.

No migration, no config key, no env var, no port and no new inter-service edge (recon.md:103-107). Consumer surface (C-14): **UI only** — Steps 9–22 land it on `xstockstrat-ui`. **Agent: none** — a decision recorded in the product spec ("An agent tool for reading alerts" is out of scope), not an omission.

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` every detail shown | Step 4 (notify fields, context, read state), Step 12 (context rows), Step 14 (page) |
| `@AC-2` another user's alert | Step 4 (code 5), Step 10 (BFF passes `not_found`), Step 14 ("Alert not found") |
| `@AC-3` broadcast alert opens | Step 4, Step 14 |
| `@AC-4` inbox row links | Step 16 |
| `@AC-5` drawer row links | Step 22 |
| `@AC-6` opening marks read | Step 14 (mark-read call with the server id), Step 20 (badge drop, reload) |
| `@AC-7` push opens the page | Step 6 (payload `url`), Step 12 (service-worker helpers, characterisation) |
| `@AC-8` plain-language body | Step 8 |
| `@AC-9` targeted alert opens | Step 4, Step 14 |
| `@AC-10` bell on every segment | Step 18 |

### Spec-time findings (read before review)

1. **Spec artifacts amended in this session, per D-17 and the operator's sign-off.** `acceptance.feature`: `@AC-6` now asserts the badge "on that page"; `@AC-10 @FR-8` added. `product-spec.md`: FR-8 added, Consumer Surface line amended. `@AC-8` keeps its text; its code-only and non-RPC cases are test cases in Step 8.
2. **The nav edit the design names is a no-op in the rendered shell.** The shell renders `NAV_GROUPS` (`src/components/shared/PlatformHeader.tsx:107-110,194`), whose `Notifications` entry has no `match` and so already matches by prefix (`src/components/shared/navGroups.tsx:12-13,89`). `PLATFORM_SUBNAV.accounts` (`PlatformHeader.tsx:94`, `match: 'exact'`) is passed as `subNav`, which `PlatformHeaderProps` documents as ignored (`:118-119`). Step 13 still makes the edit because design.md §5 requires it; the active-state assertion in Step 14 is therefore a guard that is already green for the nav part and red only because the page does not exist.
3. **339's approved design and this design disagree on the badge value.** design.md §7 here says the bell count is `unreadCount` from `listAlerts({ limit: 1 })`. 339's design (`origin/feature/fix-symbol-page-alerts-ui@0442d300d`, design.md §5; status `design-approved`) makes the badge the length of a merged, de-duplicated unread list fed by `listAlerts({ unreadOnly: true, limit: 50 })`, keeps it off react-query, and leaves one `refreshUnread()` function. design.md §8 here already says the post-339 step adapts to what 339 shipped, so Step 19 carries a decision rule for both shapes. None of 339's symbols exist in this tree.
4. **Steps 17–22 cannot cite post-339 line numbers.** Their anchors are today's lines plus a mandatory re-grep. Re-running `/sdd-spec alert-detail-page` after 339 merges would re-ground them and is the safer path.
5. **Design's "one step blocked on 339" is written as one blocked group of six steps** (17–22), split along design.md §6, §7 and the drawer link so that each commit has its own red→green. The content is the same; the split is this spec's choice and is open to review.
6. **O-5 is still open.** The non-RPC fallback body in Step 7 is the proposed wording. The operator answers relayed to this run ("Approved", "Confirmed", "Sign-off the change, amend it", "There are no production instances. Staging is enough.") arrived without their questions, so none is tied to O-5 here.
7. **O-9 is half done.** 339's `context.md` (same ref, lines 894 and 918) records a constraint for 344 in 339's own words. `docs/roadmap/features/merge-order.md` on `origin/main-dev` still has no 339 → 344 row (grep).

### Impl-spec review findings (2026-11-15, advisory — `/sdd-review alert-detail-page impl-spec`)

Verdict: PASS WITH WARNINGS, no FAIL, no Floor breach. Re-checked on `origin/main-dev@d1c97273b`: 339 is not merged (`git log` has no `fix-symbol-page-alerts-ui` commit) and `docs/roadmap/features/merge-order.md` has no 339 or 344 row.

1. **Steps 17–22 must not run as written before 339 merges.** They cite 339 symbols that are **Not found** in this tree (`refreshUnread`, `mergeUnread`, `pruneStreamed`, `drainUnread`, `readIds`, `unreadOnly`) and carry conditionals (Step 19 Case A / Case B, the Step 21 `SheetClose` fallback, the "state which was used" alternatives in Steps 18 and 20). Once execution starts a step body cannot be edited (F-09), so the reviewed path is: re-run `/sdd-spec alert-detail-page` after 339 merges and before Step 17. If the steps are executed as written instead, every adaptation made at a re-grep gate is a Deviation Log entry, not an edit to the step.
2. **The 339 → 344 merge-order row is a precondition of Step 17** (O-9). It is outside this feature directory; the orchestrator owns it.
3. **O-5 is still open**: the Step 7 fallback wording is pinned by Step 8 case 3 and has no operator confirmation tied to it. Confirm it, or accept it explicitly as the default, before Step 7 (P-03).
4. **Left as written, for the operator to weigh at the execute checkpoint** (recorded in `context.md`): the Steps 5+6 fold (design.md §2, no §C trigger); the Step 13 `PlatformHeader.tsx:94` edit (design.md §5, a no-op in the rendered shell, C-18); the notify Reviewers focus text on Steps 1–6, which is the registry's wording (`docs/runbooks/reviewer-registry.md:21`) and does not describe a request/response RPC.
5. **File overlap, non-blocking**: 316-fix-notify-stream-contract (`spec-ready`) names `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts:15` and `src/__tests__/notifyServiceImpl.test.ts:634` (its `product-spec.md:46,48`). Steps 3 and 4 edit other regions of the same two files; whichever feature merges second re-greps its anchors. No migration, config-key or proto field-number collision was found.

## Step Dependencies

- Steps 1+2 land together: `.proto` edit with its `proto-gen` (`step-constraints.md` §C row 2). No descriptor-parity guard covers `notify.v1` (grep of `_MAPPED` / `covers_every_proto_field` finds only agent and analysis suites).
- Step 3 requires Step 2: the generated `NotifyServiceService` must carry `getAlert` for the registered impl object to serve it.
- Steps 3+4 land together: the notify `tsc` build compiles tests (`tsconfig.json` `include: ["src/**/*"]`), so a typed `impl.getAlert(...)` test is a compile failure, not a behaviour RED, without the method (§C row 3; design.md §2 last bullet; recon.md:126).
- Steps 5+6 land together: design.md §2 last bullet requires each notify change to land with its tests in one commit (recon.md:126). No §C compile trigger applies here (`payload` is `any` in the test); the fold is the design's, recorded so the reviewer can weigh it.
- Step 8 [test] covers Step 7 [service]. Step 10 covers 9, 12 covers 11, 14 covers 13, 16 covers 15, 18 covers 17, 20 covers 19, 22 covers 21.
- Step 9 requires Step 2 (the generated `NotifyService` descriptor must carry `getAlert`).
- Step 13 requires Steps 9 and 11. Step 15 requires Step 13 (the link target must exist).
- Steps 17–22 are **blocked on 339-fix-symbol-page-alerts-ui merged into `main-dev` and merged into this branch** (operator decision: 339 lands first). Preconditions of execute for these steps, owned by the orchestrator (O-9): the 339 → 344 row in `docs/roadmap/features/merge-order.md`, and 339's `context.md` constraint line. Reviewed path: re-run `/sdd-spec alert-detail-page` after 339 merges, before Step 17 (review finding 1); a gate adaptation made without that re-spec goes in the Deviation Log (F-09).
- Step 19 requires Step 17 (the bell must be in the shared header for the badge to be on the alert page). Step 21 requires Step 19 (the drawer no longer lists an opened alert only once the drawer list is under the `['alerts']` prefix).
- Step 23 requires Steps 17–22 for its bell and read-model paragraphs.
- No surface is deferred. If 339 is abandoned, Steps 17–22 need a re-spec, not a skip: `@AC-5`, `@AC-6` and `@AC-10` depend on them.

---

### Step 1 — proto: add `GetAlert` to `notify.v1.NotifyService`

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/notify/v1/notify.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, `buf lint` and `buf breaking` pass; Service owner `xstockstrat-notify` — stream delivery guarantees, backpressure handling, alert deduplication; Service owner `xstockstrat-ui` — Connect-RPC call safety

**Codebase Evidence**:
- Confirmed via: `cat -n packages/proto/notify/v1/notify.proto` — service block `:12-40`; `rpc ListAlerts` `:24`; `rpc MarkAlertRead` with its header-owner comment `:26-28`; last RPC `FanoutWebhook` `:39`.
- `message Alert` `:42-59` already carries `source_service = 6`, `context = 9` (`google.protobuf.Struct`), `correlation_id = 12`, `read = 13`, `read_at = 14`. It is not changed.
- Existing pattern: `message MarkAlertReadRequest { // Owner resolved from the propagated x-user-id header (C-03), never the body. repeated string alert_ids = 1; }` (`:116-119`).
- `GetAlert` / `GetAlertRequest`: **Not found** anywhere in `packages/proto` or `services/` (grep) — created by this step.

**Lands with**: `Step 2`

**TDD**: `N/A (proto)`

**Covers**: `—`

**Instructions**:
1. In the `service NotifyService` block, after `rpc MarkAlertRead` (`:28`) and before the `RegisterPushSubscription` comment (`:30`), add:
   ```proto
   // Get one alert visible to the calling user (targeted at them, or broadcast). Owner resolved from
   // the propagated x-user-id header (C-03). NOT_FOUND for a missing, not-visible or malformed id.
   rpc GetAlert(GetAlertRequest) returns (Alert);
   ```
2. After `message MarkAlertReadResponse {}` (`:121`), add:
   ```proto
   message GetAlertRequest {
     // Owner resolved from the propagated x-user-id header (C-03), never the body.
     string alert_id = 1;
   }
   ```
   Field number `1` is the only field. There is no user field (mirrors `MarkAlertReadRequest`, D-1).
3. Do not touch `message Alert` or any other message.

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against "$(git rev-parse --show-toplevel)/.git#branch=feature/alert-detail-page,subdir=packages/proto"
```
`subdir=` is mandatory (PLAT-10). In a checkout with no local `feature/alert-detail-page` ref, use `branch=origin/feature/alert-detail-page`, the form CI uses (`.github/workflows/ci.yml:240`). Expected: no lint finding, no breaking change (a new RPC and a new message are additive).

---

### Step 2 — proto-gen: regenerate the notify stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/ts/notify/v1/notify.ts` — modify (generated)
- `packages/proto/gen/ts/notify/v1/notify_pb.ts` — modify (generated)
- `packages/proto/gen/ts/notify/v1/notify_connect.ts` — modify (generated)
- `packages/proto/gen/go/notify/v1/notify.pb.go` — modify (generated)
- `packages/proto/gen/go/notify/v1/notify_grpc.pb.go` — modify (generated)
- `packages/proto/gen/python/notify/v1/notify_pb2.py` — modify (generated)
- `packages/proto/gen/python/notify/v1/notify_pb2_grpc.py` — modify (generated)

(Also whatever `./scripts/buf-gen.sh` rewrites under `packages/proto/gen/go/notify/v1/notifyv1connect/` and `packages/proto/gen/ts/dist/`. The file list is the generator's output; do not hand-edit any of it.)

**Reviewers**: Proto Reviewer — field number uniqueness, `buf lint` and `buf breaking` pass; Service owner `xstockstrat-notify`; Service owner `xstockstrat-ui` (inherited from Step 1)

**Codebase Evidence**:
- Confirmed via: `ls packages/proto/gen/{ts,go,python}/notify/v1` — the seven files above plus the `notifyv1connect` directory.
- Generator: `scripts/buf-gen.sh` (`buf lint` `:35`, `buf breaking` with `subdir=packages/proto` `:41`, `buf generate` `:48`, Python via `grpcio-tools` `:53-61`).
- Break radius of the new RPC, grepped across `services/`:
  - notify registers the generated `NotifyServiceService` whole (`services/xstockstrat-notify/src/grpc/serviceDefinition.ts:1-6`, `src/index.ts:60`); a method with no handler is additive.
  - Go fakes embed the client interface, so a new method does not break them: `services/xstockstrat-trading/internal/service/trading_resume_account_test.go:354`, `trading_bracket_test.go:177`, `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go:325`, `services/xstockstrat-portfolio/internal/service/portfolio_quote_deadline_test.go:350`.
  - Python callers build `NotifyServiceStub` only (`services/xstockstrat-ingest/app/handlers/servicer.py:345`, `services/xstockstrat-analysis/app/handlers/servicer.py:549`, `services/xstockstrat-agent/app/client.py:307`).
  - UI: `router.service(NotifyService, {...})` takes a partial implementation (`src/lib/traderBff.ts:96`, `e2e/mock-backend.ts:663`).

**Lands with**: `Step 1`

**TDD**: `N/A (proto-gen)`

**Covers**: `—`

**Instructions**:
1. From the repo root run `./scripts/buf-gen.sh`. If Docker or the pinned `buf` is unavailable on the host, follow `docs/runbooks/codegen-toolchain-host-setup.md` first.
2. Stage only the regenerated files under `packages/proto/gen/`. If the diff touches a package other than `notify`, stop: the toolchain pins differ from the committed stubs (root `CLAUDE.md` § Version Bump Workflow).

**Verification**:
```bash
./scripts/buf-gen.sh && git status --porcelain packages/proto/gen | grep -v "notify" ; test -z "$(git status --porcelain packages/proto/gen | grep -v notify)"
./scripts/buf-gen.sh && git diff --stat packages/proto/gen   # second run: no further change
(cd services/xstockstrat-notify && pnpm run build)
(cd services/xstockstrat-ui && pnpm exec tsc --noEmit)
(cd services/xstockstrat-trading && GOWORK=off go build ./...)
```
Expected: only `notify` stubs change; the notify build, the UI typecheck and one Go consumer build pass.

---

### Step 3 — service: notify `getAlert` handler

**Status**: `done`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts` — modify

**Reviewers**: Service owner `xstockstrat-notify` — stream delivery guarantees, backpressure handling, alert deduplication

**Codebase Evidence**:
- Confirmed via: `cat -n services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts`.
- Identity read: `const userId = call.metadata?.get?.('x-user-id')?.[0]?.toString() || call.request.userId || null;` (`:202`, `markAlertRead`). Missing identity → `callback({ code: 3, message: 'x-user-id header required' })` (`:203-205`). The header-only form with no body fallback is at `:269-272` (`registerPushSubscription`).
- Read join and visibility predicate to reuse (`listAlerts`, `:236-239`): `SELECT a.*, ar.read_at FROM notify.alerts a LEFT JOIN notify.alert_reads ar ON ar.alert_id = a.alert_id AND ar.user_id = $1 WHERE ($1::text IS NULL OR a.target_user_id = $1 OR a.target_user_id IS NULL)`. The `$1::text IS NULL OR` branch is the unscoped one that must not be copied (NOTIFY-7, `services/xstockstrat-notify/docs/context-constitution.md:19`).
- `rowToAlert` (`:371-391`) maps `sourceService`, `correlationId`, `read`, `readAt` and not `context`. It stays unchanged (D-3, R-1).
- `context` is stored as `JSON.stringify(req.context ?? {})` (`:97`) into `context JSONB` (`services/xstockstrat-notify/migrations/001_notify_alerts.up.sql:14`); `emitAlert` writes the same plain object to stream subscribers (`:113`).
- `alert_id` is `UUID` (`migrations/001_notify_alerts.up.sql:7`), so a non-UUID id fails the cast with code 13 unless checked first (`fails.md` 2026-10-07, alert-read-unread-persistence).
- Error style: bare numeric codes (`:204` code 3, `:221` code 13).
- Registration: the impl object is passed whole to `addService` (`src/index.ts:60`), so no handler-map entry is needed.
- DB pool max 1 (root `CLAUDE.md` § Connection Pool Budget): one query only.
- `getAlert`: **Not found** in `services/xstockstrat-notify/` (grep) — created by this step.

**Lands with**: `Step 4`

**TDD**: `red-green required` — one cycle for the unit. For a behaviour RED rather than a `TS2339` compile failure, first add `getAlert` as a stub that answers `callback({ code: 12, message: 'not implemented' })`, write Step 4's tests, capture the failing assertions, then replace the stub.

**Covers**: `—`

**Instructions**:
1. Add a module-private constant above `class NotifyServiceImpl` (next to the constants at `:14-16`): `const ALERT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;`.
2. Add `async getAlert(call: any, callback: any)` to `NotifyServiceImpl`, placed after `listAlerts` (ends `:262`):
   - `const userId = (call.metadata?.get?.('x-user-id')?.[0] ?? '').toString();` — header only. If empty: `return callback({ code: 3, message: 'x-user-id header required' });` with no query. No `call.request.userId` fallback (D-2).
   - `const alertId = call.request.alertId;` If `!ALERT_ID_RE.test(alertId ?? '')`: `return callback({ code: 5, message: 'alert not found' });` with no query.
   - One query, in a `try`:
     ```sql
     SELECT a.*, ar.read_at
     FROM notify.alerts a
     LEFT JOIN notify.alert_reads ar ON ar.alert_id = a.alert_id AND ar.user_id = $1
     WHERE (a.target_user_id = $1 OR a.target_user_id IS NULL)
       AND a.alert_id = $2
     ```
     with params `[userId, alertId]`.
   - No row: `callback({ code: 5, message: 'alert not found' })` — the same code and message as the malformed-id case, so a missing alert, another user's alert and a malformed id are indistinguishable (D-2, `@AC-2`).
   - Row: `callback(null, { ...rowToAlert(row), context: row.context ?? {} })`. `context` is mapped here only.
   - `catch (err: any)`: `callback({ code: 13, message: err.message })`.
3. Comment on the method: at most two lines, stating only the constraints (header-only identity; one code for missing, not-visible and malformed).
4. No outbound gRPC call is added, so header propagation does not apply (PLAT-4).

**Verification**:
```bash
cd services/xstockstrat-notify && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
grep -n "x-user-id" src/grpc/notifyServiceImpl.ts   # getAlert reads the header and has no request.userId fallback
```
(Union with Step 4: the unit is one commit.)

---

### Step 4 — test: notify `getAlert` and the `context` round-trip

**Status**: `done`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts` — modify

**Reviewers**: Service owner `xstockstrat-notify` — stream delivery guarantees, backpressure handling, alert deduplication

**Codebase Evidence**:
- Confirmed via: `grep -n "metaCall\|^describe\|capturingPool\|seqPool" services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts`.
- `metaCall(userId, request)` builds a call whose metadata carries `x-user-id` (`:534-539`). `capturingPool(rows)` records every `query(sql, params)` (`:520-531`). `noopFanout()` `:61`, `noopWebPush()` `:66`.
- Suites to model on: `describe('markAlertRead (feature 203)'` `:847-894` (code-3 and no-DB-write assertions at `:876-883`); `describe('listAlerts — read state (feature 203)'` `:896-943`.
- `Alert` is already imported from `@xstockstrat/proto/notify/v1/notify` (`:25`) and `Alert.encode(alert).finish()` is already used (`:825`).
- `src/__tests__/fixtures/` exists (`collectingReader.ts`, `fakeCommsgun.ts`, `fakeConfig.ts`, `scriptedPool.ts`, `stubFetch.ts`); none holds an alert row.

**Lands with**: `Step 3`

**TDD**: `red-green required` (see Step 3)

**Covers**: `AC-1, AC-2, AC-3, AC-9`

**Instructions**:
Add `describe('getAlert (feature 344)', …)` after the `listAlerts — read state` suite (ends `:943`). Use a UUID-shaped id constant local to the suite (for example `const ALERT_ID = 'a1f3c0de-0000-4000-8000-000000000001';`). Cases:
1. **`@AC-9` targeted alert** — pool returns one row with `target_user_id: 'u1'`, `context: { job_id: '67276d1f' }`, `correlation_id: 'c-77'`, `source_service: 'xstockstrat-ingest'`, `read_at: null`. Assert the response has `alertId`, `sourceService`, `correlationId`, `context.job_id === '67276d1f'` and `read === false`.
2. **`@AC-3` broadcast alert** — row with `target_user_id: null`. Assert it is returned with `targetUserId === ''`.
3. **`@AC-2` another user's alert** — pool returns no rows. Assert `err.code === 5`. Assert the SQL (whitespace-collapsed) matches `/a\.target_user_id = \$1 OR a\.target_user_id IS NULL/`, matches `/a\.alert_id = \$2/`, does **not** match `/\$1::text IS NULL/`, and that params equal `['u1', ALERT_ID]`.
4. **Malformed id** — `alertId: 'a1f3'`. Assert `err.code === 5`, the same `err.message` as case 3, and `pool.calls.length === 0`.
5. **Missing identity** — `metaCall(null, { alertId: ALERT_ID, userId: 'u1' })`. Assert `err.code === 3` and `pool.calls.length === 0` (the body `userId` is ignored).
6. **`@AC-1` per-caller read state** — row with `read_at` set. Assert `read === true` and `readAt instanceof Date`; assert the SQL matches `/LEFT JOIN notify\.alert_reads ar ON ar\.alert_id = a\.alert_id AND ar\.user_id = \$1/`.
7. **`@AC-1` `context` round-trip (D-4)** — take the response of a row whose `context` is `{ job_id: '67276d1f', failed_symbols: ['AAPL', 'TSLA'], attempts: 3, extra: {} }`, run `Alert.decode(Alert.encode(res).finish())` and `assert.deepEqual` the decoded `context` against the same object. Add a second assertion with `context: {}`.
8. **`ListAlerts` unchanged (R-1)** — `rowToAlert({ …, context: { a: 1 } })` has no `context` key.

C-13: the alert row literal has one consumer file after this step (this suite); inline is compliant. No fixture home entry is created.

**Verification**:
```bash
cd services/xstockstrat-notify && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
grep -n "__tests__/fixtures" src/__tests__/notifyServiceImpl.test.ts   # existing imports only; no second inline copy of the row
```
Expected: the new suite runs (count the `getAlert` cases in the `node --test` output) and line coverage is ≥ 40%.

---

### Step 5 — service: notify push payload carries the alert url

**Status**: `done`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/fanout/webPush.ts` — modify

**Reviewers**: Service owner `xstockstrat-notify` — stream delivery guarantees, backpressure handling, alert deduplication

**Codebase Evidence**:
- Confirmed via: `sed -n 28,52p;143,152p services/xstockstrat-notify/src/fanout/webPush.ts`.
- `interface PushPayload { title; body; icon; tag; url?: string; }` (`:44-52`) — `url` already exists and is optional.
- Payload build: `const payload: PushPayload = { title: alert.title, body: alert.body, icon: '/icon-192.png', tag: alert.category || 'xstockstrat' };` (`:143-148`); `alert.alertId` is in scope (`PushAlert.alertId` `:29`, used at `:152`).
- The service worker already reads `url` (`services/xstockstrat-ui/public/sw.js:30,57,64`), so nothing on the UI side changes (D-5).
- The audience code (`:107-141`) is not touched (NOTIFY-8).

**Lands with**: `Step 6`

**TDD**: `red-green required` — write Step 6's assertion first; it fails with `payload.url === undefined`.

**Covers**: `—`

**Instructions**:
1. In the payload literal at `:143-148`, add `url: \`/accounts/notifications/${alert.alertId}\`,`.
2. Change nothing else: no new payload field, no audience change, no `sw.js` change.

**Verification**:
```bash
cd services/xstockstrat-notify && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
```
(Union with Step 6.)

---

### Step 6 — test: push payload url

**Status**: `done`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/__tests__/webPush.test.ts` — modify

**Reviewers**: Service owner `xstockstrat-notify` — stream delivery guarantees, backpressure handling, alert deduplication

**Codebase Evidence**:
- Confirmed via: `grep -n "function alert\|class StubbedDispatcher\|payload" services/xstockstrat-notify/src/__tests__/webPush.test.ts`.
- `StubbedDispatcher` records `{ endpoint, payload: JSON.parse(body) }` (`:121-126`). `alert()` builds a `PushAlert` with `alertId: 'a1'` (`:176-185`).
- Existing payload assertions: `assert.equal(d.sent[0].payload.title, 'Order filled');` and `.body` (`:228-229`), in the test `"AC-4 / @AC-2: pushes to exactly the target user's subscriptions, carrying title/body"` (`:218`).
- No test asserts the whole payload object (`grep -n "deepEqual(.*payload" src/__tests__/webPush.test.ts` → none), so adding a field breaks nothing.

**Lands with**: `Step 5`

**TDD**: `red-green required`

**Covers**: `AC-7`

**Instructions**:
1. In the test at `:218`, after the `body` assertion (`:229`), add `assert.equal(d.sent[0].payload.url, '/accounts/notifications/a1');` and assert every sent payload carries the same `url`.
2. In the untargeted (admin audience) test whose payload title is asserted at `:249`, add the same `url` assertion with that test's alert id, so the deep link is proven on both audiences (`@AC-4 @feature-165` EXTEND; `@AC-5 @feature-242` PRESERVE).
3. C-13: no new domain literal; the existing `alert()` builder is reused.

**Verification**:
```bash
cd services/xstockstrat-notify && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
```
Expected: line coverage ≥ 40%; the two extended tests pass.

---

### Step 7 — service: ingest plain-language backfill-failure body

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify

**Reviewers**: Service owner `xstockstrat-ingest` — signal normalization correctness, idempotent ingestion

**Codebase Evidence**:
- Confirmed via: `cat -n services/xstockstrat-ingest/app/handlers/servicer.py | sed -n 519,593p`.
- `async def _emit_backfill_alert(self, job_id, status, failed_symbols, error, propagation_meta)` (`:519`). Context: `ctx.update({"job_id": job_id, "failed_symbols": list(failed_symbols), "error": error or ""})` (`:529`). Body: `body=f"Backfill job {job_id} {label}: {error}"` (`:536`).
- Callers (`grep -n "_emit_backfill_alert" -r services/xstockstrat-ingest/app services/xstockstrat-ingest/tests` → three calls, none in tests): the FAILED caller that holds the exception, `:591-593` (`str(e)`, inside `except Exception as e` at `:574`); `:762-764` (`"all backfill chunks failed"`); `:774-780` (PARTIAL, `"some chunks/symbols failed to backfill"`).
- The job row (`error=str(e)` `:584`) and the ledger payload (`{"error": str(e)}` `:589`) are not changed.
- Code and details on an RPC error: `e.code().name` and `e.details()` on `grpc.aio.AioRpcError` (`:489-495`).
- The `@AC-8` path is the fundamentals call, `self._marketdata.BackfillFundamentals(...)` (`:601-608`), which raises into `:574`.
- The existing `EmitAlert` call already passes `metadata=propagation_meta` (`:541`); no new outbound call is added.
- No reader of the old body exists (recon.md:125).

**TDD**: `red-green required` — Step 8's `@AC-8` test fails first on the body text.

**Covers**: `—`

**Instructions**:
1. Add a module-level helper near the other module constants (above `class IngestServicer`):
   ```python
   _BACKFILL_FAILURE_FALLBACK = "unexpected error — see the alert details"


   def _backfill_failure_detail(exc: Exception) -> str:
       if isinstance(exc, grpc.aio.AioRpcError):
           details = exc.details()
           return f"{exc.code().name} — {details}" if details else exc.code().name
       return _BACKFILL_FAILURE_FALLBACK
   ```
   The exception type name is never used (R-5, D-16). The fallback wording is the proposed text; O-5 is open.
2. Change the signature to `_emit_backfill_alert(self, job_id, status, failed_symbols, error, propagation_meta, detail=None)` and the body line (`:536`) to `body=f"Backfill job {job_id} {label}: {detail if detail is not None else error}"`. Leave `:529` as is, so `context["error"]` keeps the raw `error` string with no sanitising and no redaction (O-1 ruling (a)).
3. At the FAILED caller (`:591-593`), pass `detail=_backfill_failure_detail(e)`. Keep `str(e)` as the `error` argument.
4. Do not change the callers at `:762-764` and `:774-780`, the job-row write (`:580-586`) or the ledger event (`:588-590`).

**Verification**:
```bash
cd services/xstockstrat-ingest && ruff check . && ruff format --check . && pytest --cov=app --cov-fail-under=40
grep -n "_emit_backfill_alert" app/handlers/servicer.py   # one definition, three callers; only the :591 caller passes detail=
```

---

### Step 8 — test: ingest backfill-failure body

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_ingest_servicer.py` — modify

**Reviewers**: Service owner `xstockstrat-ingest` — signal normalization correctness, idempotent ingestion

**Codebase Evidence**:
- Confirmed via: `grep -n "rpc_error\|_wake_servicer\|_make_fund_req\|EmitAlert.await_args" services/xstockstrat-ingest/tests/test_ingest_servicer.py`.
- `rpc_error(code, details="")` builds a `grpc.aio.AioRpcError` (`tests/_helpers.py:96-98`), imported at `test_ingest_servicer.py:27`.
- `_wake_servicer()` returns a servicer with `_marketdata` and `_notify.EmitAlert` mocked (`:913-919`); `_make_fund_req(symbols)` builds a FUNDAMENTALS request (`:2292-2298`).
- A runner exception on the fundamentals path is already driven as `svc._marketdata.BackfillFundamentals = AsyncMock(side_effect=Exception("boom"))` with `patch(f"{_REPO}.update_job", …)` (`:932-938`).
- Alert assertions read `svc._notify.EmitAlert.await_args.args[0]` (`:716`, `:737`). The fixed-string FAILED case is `test_all_chunks_fail_emits_failed_and_error_alert` (`:720-737`); the PARTIAL case is `test_partial_emits_completed_and_warning_alert` (`:696-717`). Neither asserts the body today.

**TDD**: `red-green required`

**Covers**: `AC-8`

**Instructions**:
Add `class TestBackfillFailureAlertBody` after `TestWebhookWakeUp`. Each case uses `_wake_servicer()`, `patch(f"{_REPO}.update_job", AsyncMock())` and `_make_fund_req(["LYFT"])`, then reads `alert = svc._notify.EmitAlert.await_args.args[0]`.
1. **`@AC-8`** — `BackfillFundamentals` raises `rpc_error(grpc.StatusCode.FAILED_PRECONDITION, "marketdata.fundamentals.history.enabled is false")`; run job `"67276d1f"`. Assert `alert.body == "Backfill job 67276d1f failed: FAILED_PRECONDITION — marketdata.fundamentals.history.enabled is false"`, `"AioRpcError" not in alert.body`, `alert.context["error"] == str(err)` and `"AioRpcError" in alert.context["error"]`.
2. **Code only** — `rpc_error(grpc.StatusCode.UNAVAILABLE)` (empty details). Assert `alert.body == "Backfill job 67276d1f failed: UNAVAILABLE"`.
3. **Non-RPC fallback** — `side_effect=ValueError("boom at /srv/x.py:12")`. Assert `alert.body == "Backfill job 67276d1f failed: unexpected error — see the alert details"`, `"ValueError" not in alert.body`, `alert.context["error"] == "boom at /srv/x.py:12"`.
4. **Job row and ledger unchanged** — in case 1 also assert the final `update_job` kwargs carry `error == str(err)` and the `ingest.backfill.failed` ledger event payload still carries the raw text.
5. **Fixed-string callers unchanged** — extend `test_all_chunks_fail_emits_failed_and_error_alert` (`:720`) with `alert.body == "Backfill job job-3 failed: all backfill chunks failed"`, and `test_partial_emits_completed_and_warning_alert` (`:696`) with `alert.body == "Backfill job job-2 partial: some chunks/symbols failed to backfill"`. These two are characterisation assertions (green before and after).

C-13: no new domain literal; `rpc_error`, `_wake_servicer` and `_make_fund_req` are reused. Inline strings have one consumer.

**Verification**:
```bash
cd services/xstockstrat-ingest && ruff check . && ruff format --check . && pytest --cov=app --cov-fail-under=40
grep -n "def .*fixture\|from .conftest\|conftest" tests/test_ingest_servicer.py   # existing imports only
```
Expected: coverage ≥ 40%; `TestBackfillFailureAlertBody` has three behaviour cases that failed before Step 7.

---

### Step 9 — service: UI BFF `getAlert`

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/traderBff.ts` — modify

**Reviewers**: Service owner `xstockstrat-ui` — Connect-RPC call safety, trading UI correctness

**Codebase Evidence**:
- Confirmed via: `sed -n 96,116p services/xstockstrat-ui/src/lib/traderBff.ts`.
- `router.service(NotifyService, {` `:96`; `listAlerts: forward((req, opts) => notifyClient.listAlerts(req, opts)),` `:104`; `markAlertRead: forward((req, opts) => notifyClient.markAlertRead(req, opts)),` `:115`.
- `forward` verifies the session and adds the propagated identity headers (`src/lib/bffShared.ts:77-90`), so `x-user-id`, `x-access-scope` and `x-trace-id` reach notify through the existing mechanism (PLAT-4). No new client is created: the server `notifyClient` exists (`src/lib/connectClients.ts:98-99`).
- An unregistered method answers HTTP 404 with an empty body (`src/lib/bffShared.ts:140-145`), which is what the browser gets for `GetAlert` today.
- No BFF pin lists notify methods (`grep -n -i "notify\|alert" src/lib/__tests__/bffAllowlist.test.ts src/lib/traderBff.test.ts` → only a `notifyClient: {}` mock at `traderBff.test.ts:13`).

**TDD**: `red-green required` — Step 10's BFF spec fails first with HTTP 404 and no JSON body.

**Covers**: `—`

**Instructions**:
1. After `markAlertRead` (`:115`), inside the same `router.service(NotifyService, {…})` block, add:
   ```ts
   // Owner resolved from the x-user-id header; notify answers NOT_FOUND for an alert the caller can't see.
   getAlert: forward((req, opts) => notifyClient.getAlert(req, opts)),
   ```
2. No REST route, no admin gate, no timeout option.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit && pnpm run test:unit
grep -n "getAlert: forward" src/lib/traderBff.ts   # the call goes through forward(), which propagates the three headers
```

---

### Step 10 — test: mock `getAlert`, alert-detail fixtures and the BFF contract

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/fixtures/alerts.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify
- `services/xstockstrat-ui/e2e/accounts/alert-detail.spec.ts` — create

**Reviewers**: Service owner `xstockstrat-ui` — Connect-RPC call safety, trading UI correctness

**Codebase Evidence**:
- Confirmed via: `cat -n e2e/fixtures/alerts.ts`, `sed -n 663,693p e2e/mock-backend.ts`, `grep -n -i alert e2e/fixtures/INVENTORY.md`.
- Fixture home: `e2e/fixtures/alerts.ts` (`ALERT_LIST_001..003` `:48-72`, `ALERT_READ` `:76`, `ALERT_UNREAD` `:82`, `ALERT_LIST_WITH_READ_STATE` `:94`, `MOCK_UNREAD_COUNT` `:95`). Catalog row: `e2e/fixtures/INVENTORY.md:50` ("Alerts (feature 203)").
- Mock: `router.service(NotifyService, {` `e2e/mock-backend.ts:663`; `listAlerts` `:685-688`; `markAlertRead` `:691-693`. `ConnectError` and `Code` are already imported (`:16`) and `Code.NotFound` is already thrown (`:225`). Alert fixtures are imported at `:35`.
- The BFF is driven directly from a spec today with `page.request.post(REGISTER, { headers: CONNECT_HEADERS, data })` (`e2e/accounts/notifications.spec.ts:16-38`).
- Auth helper: `addAuthCookie` (`e2e/helpers/auth.ts`, imported at `e2e/accounts/notifications.spec.ts:2`). `TEST_USER_ID` (`e2e/fixtures/users.ts:9`).
- `e2e/accounts/alert-detail.spec.ts`: **Not found** — created by this step.

**TDD**: `red-green required` — run the spec before Step 9: `GetAlert` answers HTTP 404 with an empty body, so both cases fail.

**Covers**: `AC-2`

**Instructions**:
1. `e2e/fixtures/alerts.ts` — append (C-12, extending the existing module, not a new one):
   - `ALERT_DETAIL_ID = 'a1f3c0de-0000-4000-8000-000000000001'` and `ALERT_DETAIL_BROADCAST_ID = 'c9d0c0de-0000-4000-8000-000000000002'`, `ALERT_DETAIL_UNKNOWN_ID = 'b2e4c0de-0000-4000-8000-000000000003'` (a reserved id the mock never resolves).
   - `ALERT_DETAIL`: `alertId: ALERT_DETAIL_ID`, `severity: 3`, `category: 'backfill'`, `title: 'Backfill 67276d1f failed'`, `body: 'Backfill job 67276d1f failed: FAILED_PRECONDITION — marketdata.fundamentals.history.enabled is false'`, `sourceService: 'xstockstrat-ingest'`, `targetUserId: TEST_USER_ID`, `correlationId: 'c-77'`, `createdAt: { seconds: BigInt(1_763_200_000), nanos: 0 }`, `context: { job_id: '67276d1f', failed_symbols: ['LYFT'], error: '<AioRpcError of RPC that terminated with: status = StatusCode.FAILED_PRECONDITION>' }`, `read: false`.
   - `ALERT_DETAIL_BROADCAST`: `{ ...ALERT_DETAIL, alertId: ALERT_DETAIL_BROADCAST_ID, targetUserId: '', title: 'Broadcast notice', context: {} }`.
   - `ALERT_DETAILS = [ALERT_DETAIL, ALERT_DETAIL_BROADCAST]`.
2. `e2e/fixtures/INVENTORY.md` — add a row under "Canonical fixtures" after `:50`: domain "Alert detail (feature 344)", the symbols above, module `e2e/fixtures/alerts.ts`, shape `xstockstrat.notify.v1.Alert` (with `context` as a protobuf-es v2 `JsonObject`), consumers `e2e/mock-backend.ts` (`getAlert`) and `e2e/accounts/alert-detail.spec.ts`.
3. `e2e/mock-backend.ts` — import the new symbols at `:35` and add after `markAlertRead` (`:693`):
   ```ts
   async getAlert(req: { alertId?: string }) {
     const found = [...ALERT_DETAILS, ...ALERT_LIST_WITH_READ_STATE].find((a) => a.alertId === req.alertId);
     if (!found) throw new ConnectError('alert not found', Code.NotFound);
     return found;
   },
   ```
   The list fixtures are included so the inbox rows resolve in Step 16.
4. `e2e/accounts/alert-detail.spec.ts` — create with one `test.describe('GetAlert BFF contract (feature 344)')`:
   - `const GET_ALERT = '/trader/api/xstockstrat.notify.v1.NotifyService/GetAlert';` and the `CONNECT_HEADERS` literal as in `notifications.spec.ts:18`.
   - Case 1: after `addAuthCookie(page)`, `page.request.post(GET_ALERT, { headers, data: { alertId: ALERT_DETAIL_ID } })` → `res.ok()`, body `alertId === ALERT_DETAIL_ID`, `correlationId === 'c-77'`, `context.job_id === '67276d1f'`.
   - Case 2 (`@AC-2`, the BFF error trap in `fails.md` 2026-08-06): `data: { alertId: ALERT_DETAIL_UNKNOWN_ID }` → `res.status() === 404` and the JSON body's `code === 'not_found'`. This proves the Connect code survives `createDispatch`, not only a message string.
   The `CONNECT_HEADERS` literal now has two consumer specs; move it to `e2e/helpers/` only if a helper for it already exists (`ls e2e/helpers` → `auth.ts`, `browser-resolution.ts`, `devCerts.ts`, `watchlistMock.ts`; none today) — otherwise it stays a scenario one-off, which C-12 exempts.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit && pnpm exec playwright test e2e/accounts/alert-detail.spec.ts --project=chromium
grep -n "from '../fixtures\|helpers/auth" e2e/accounts/alert-detail.spec.ts && grep -n "Alert detail (feature 344)" e2e/fixtures/INVENTORY.md
```
No coverage threshold applies to Playwright e2e (`docs/patterns/ci-overview.md:29` lists none for `frontend-e2e`); the `src/lib/**` vitest gate (≥ 40%) is checked in Step 12.

---

### Step 11 — service: shared alert helpers (`formatWhen`, `contextEntries`)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/alertShared.ts` — modify
- `services/xstockstrat-ui/src/app/accounts/notifications/AlertInbox.tsx` — modify

**Reviewers**: Service owner `xstockstrat-ui` — trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- Confirmed via: `cat -n src/lib/alertShared.ts` — `severityLabel` `:5-10`, `severityVariant` `:12-17`; nothing else is exported.
- `formatWhen` is a private function of the inbox: `function formatWhen(alert: Alert): string { const s = alert.createdAt?.seconds; if (s == null) return ''; return new Date(Number(s) * 1000).toLocaleString(); }` (`src/app/accounts/notifications/AlertInbox.tsx:12-16`), used once at `:114`. No other importer (`grep -rn "formatWhen" src` → `AlertInbox.tsx` only).
- Canonical timestamp conversion: `timestampToDate(ts)` (`src/lib/protoTime.ts:16-19`); hand-rolled `Number(seconds) * 1000` is the drift UI-1 names (`services/xstockstrat-ui/docs/context-constitution.md:16`).
- protobuf-es v2 gives a `Struct` field as a plain `JsonObject`; `JsonObject` is already imported that way (`src/hooks/useReconciliationStatus.ts:2,25`, `src/app/trader/positions/page.tsx:5,341`). Do not use `context?.fields?.<key>` introspection (`fails.md` 2026-08-05, live-strategy-alert-engine).
- `contextEntries`: **Not found** (grep) — created by this step.

**TDD**: `red-green required` — Step 12's vitest fails first (`contextEntries` is not exported).

**Covers**: `—`

**Instructions**:
1. In `src/lib/alertShared.ts` add:
   - `export function formatWhen(createdAt: ProtoTimestamp | undefined): string` returning `timestampToDate(createdAt)?.toLocaleString() ?? ''` (import `timestampToDate` and `ProtoTimestamp` from `@/lib/protoTime`).
   - `export function contextEntries(context: JsonObject | undefined): { key: string; value: string }[]` — `Object.entries(context ?? {})` in insertion order; a string value is shown as is, any other value as `JSON.stringify(value)`. An empty or missing object gives `[]`. Import the `JsonObject` type from `@bufbuild/protobuf`.
2. In `AlertInbox.tsx` delete the local `formatWhen` (`:12-16`), import it from `@/lib/alertShared` (extend the import at `:5`) and change the call at `:114` to `formatWhen(a.createdAt)`. Remove the `Alert` type import only if it becomes unused (it is still used at `:19`).
3. Update the file-header comment of `alertShared.ts` only if it would otherwise be false; keep it within two lines.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit && pnpm run test:unit
pnpm exec playwright test e2e/accounts/notifications.spec.ts --project=chromium   # the inbox still renders its rows
grep -rn "formatWhen" src   # one definition (alertShared.ts) and its importers; no local copy
```

---

### Step 12 — test: vitest for the alert helpers and the push click target

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/alertShared.test.ts` — create
- `services/xstockstrat-ui/src/lib/swHelpers.test.ts` — modify

**Reviewers**: Service owner `xstockstrat-ui` — trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- Confirmed via: `cat vitest.config.*` — node environment, `include: ['src/**/*.test.ts']`, coverage scoped to `src/lib/**` with 40% thresholds.
- `src/lib/alertShared.test.ts`: **Not found** (`ls src/lib/*.test.ts`) — created by this step.
- `src/lib/swHelpers.test.ts`: `describe('parsePushPayload'` `:4`, `'parses a well-formed payload'` `:5`, `describe('pickClientUrl'` `:44`, `'returns null when no window matches (open a new one)'` `:52`.
- `parsePushPayload` keeps a string `url` (`src/lib/swHelpers.ts:36`); `pickClientUrl(windowUrls, targetUrl)` returns a window whose URL contains the target, else `null` (`:48-53`). `public/sw.js` mirrors both (`:30`, `:62-70`). Neither file changes (D-5).

**TDD**: `red-green required` for `alertShared.test.ts`. The two `swHelpers` cases are **characterisation** (red N/A — no behaviour change; the helpers already handle any url): state that in the PR body and `context.md`.

**Covers**: `AC-1, AC-7`

**Instructions**:
1. Create `src/lib/alertShared.test.ts` (vitest, as `src/lib/protoTime.test.ts` does):
   - `contextEntries` over a `JsonObject` (D-11): `{ job_id: '67276d1f' }` → `[{ key: 'job_id', value: '67276d1f' }]` (`@AC-1`); a list `{ failed_symbols: ['AAPL', 'TSLA'] }` → value `'["AAPL","TSLA"]'`; a number `{ attempts: 3 }` → `'3'`; `{}` → `[]`; `undefined` → `[]`; insertion order kept for a three-key object.
   - `formatWhen`: `undefined` → `''`; `{ seconds: BigInt(1_763_200_000), nanos: 0 }` → equals `new Date(1_763_200_000_000).toLocaleString()`.
   - The literals are scenario one-offs for a pure function; C-12 does not require a fixture.
2. In `src/lib/swHelpers.test.ts` add (`@AC-7`; `@AC-9 @feature-165` EXTEND):
   - under `parsePushPayload`: a payload with `url: '/accounts/notifications/a1f3c0de-0000-4000-8000-000000000001'` keeps that `url`;
   - under `pickClientUrl`: with one window at `https://app.example/trader` and that target, the result is `null` (a new window opens); with a window already on the alert url, that window is returned.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit && pnpm run test:coverage
```
Expected: the `src/lib/**` thresholds (lines, functions, statements ≥ 40%) hold; `alertShared.test.ts` runs its cases.

---

### Step 13 — service: the alert page and the nav match

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/accounts/notifications/[alert_id]/page.tsx` — create
- `services/xstockstrat-ui/src/app/accounts/notifications/[alert_id]/AlertDetail.tsx` — create
- `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx` — modify

**Reviewers**: Service owner `xstockstrat-ui` — trading UI correctness, Connect-RPC call safety

**Codebase Evidence**:
- Confirmed via: `ls src/app/accounts/notifications` → `AlertInbox.tsx`, `PushToggle.tsx`, `page.tsx`. `[alert_id]/`: **Not found** — created by this step.
- Page shape to follow: `src/app/accounts/notifications/page.tsx:5-24` (a server page that renders client components inside `<div className="mx-auto max-w-2xl space-y-4">`).
- Client data access under `/accounts` uses the root-relative browser client: `notifyClient` (`src/lib/browserClients/notifyClient.ts:5-6`, `makeBrowserTransport('/trader/api')`), as `AlertInbox.tsx:28,46` does. This is the sanctioned UI-2 exception recorded at `services/xstockstrat-ui/docs/pwa-push.md:28`.
- Local-state fetch pattern (loading / error / data): `AlertInbox.tsx:19-40`. States go through `Skeleton` and `EmptyState` (`AlertInbox.tsx:79-88`; `src/components/shared/EmptyState.tsx:7-25`, C-17).
- Severity: `severityVariant[a.severity] ?? 'info'` and `severityLabel[a.severity] ?? 'INFO'` (`AlertInbox.tsx:107-109`; `src/lib/alertShared.ts:5-17`). `severityLabel[3]` is `'ERROR'`.
- Mark read: `notifyClient.markAlertRead({ alertIds })` (`AlertInbox.tsx:46`), idempotent on the server (`services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts:211-217`).
- Connect error code: `ConnectError.from(err).code === Code.Unauthenticated` (`src/app/api/auth/login/route.ts:31-32`); `Code` is from `@connectrpc/connect`.
- Route param: `const params = useParams<{ id: string }>();` (`src/app/trader/orders/[id]/page.tsx:42`).
- Nav: `{ label: 'Notifications', href: '/accounts/notifications', match: 'exact' },` (`src/components/shared/PlatformHeader.tsx:94`); `isItemActive` (`:100-104`). The rendered shell uses `NAV_GROUPS` (`:107-110`, `:194`, `:332-339`), whose entry already matches by prefix (`src/components/shared/navGroups.tsx:89`) — see finding 2 in the Execution Summary.
- C-10(a): the page gets no nav entry of its own (product-spec.md, Consumer Surface); the proof is the active state on the child path (Step 14).
- The keys `ALERTS_QUERY_KEY` / `ALERT_UNREAD_COUNT_KEY` are not introduced here; design.md §8 puts them in the post-339 group (Step 19).

**TDD**: `red-green required` — Step 14's page spec fails first (the route is a 404).

**Covers**: `—`

**Instructions**:
1. `[alert_id]/page.tsx` — a server component that renders `<div className="mx-auto max-w-2xl space-y-4"><AlertDetail /></div>`. No data access on the server, no REST route.
2. `[alert_id]/AlertDetail.tsx` — `'use client'`:
   - `const alertId = useParams<{ alert_id: string }>()?.alert_id;`
   - State: `alert`, `status: 'loading' | 'ready' | 'not-found' | 'error'`, `errorText`, `markedRead`.
   - In an effect keyed on `alertId` (with an `active` flag, as `src/components/trader/AlertStream.tsx:19-32` does): `notifyClient.getAlert({ alertId })`.
     - Success: store the alert, set `ready`, then call `notifyClient.markAlertRead({ alertIds: [res.alertId] })` — the **server-returned** id, not the URL param (D-7). On success set `markedRead`. On failure do nothing: the page stays rendered and no error is shown (non-blocking).
     - `ConnectError.from(e).code === Code.NotFound`: set `not-found`. Key on the code, never on the message text.
     - Any other error: set `error` with the message.
   - Render inside one `Card` with `data-testid="alert-detail"`:
     - `loading` → `Skeleton` rows.
     - `not-found` → `<EmptyState title="Alert not found" description="This alert does not exist or is not visible to you." />`.
     - `error` → `<EmptyState title="Could not load alert" description={errorText} />`.
     - `ready` → the severity `Badge` (`severityVariant` / `severityLabel`), the category, the title as the card title, the full body (`whitespace-pre-wrap`, not truncated), and a definition list with one labelled row each for: Source service (`alert.sourceService`), Created (`formatWhen(alert.createdAt)`), Status (`Read` when `alert.read || markedRead`, else `Unread`, in an element with `data-testid="alert-read-state"`), Correlation ID (`alert.correlationId`, shown as `—` when empty). Then a "Context" section with one row per `contextEntries(alert.context)` entry (`data-testid="alert-context-row"`, the key as the term and the value as the description, `break-all` for long values); render "No context fields" when the list is empty.
   - Design tokens only (no colour literals); every value has a visible text label (C-17).
3. `PlatformHeader.tsx:94` — change `match: 'exact'` to `match: 'prefix'` on the `Notifications` entry of `PLATFORM_SUBNAV.accounts`. Touch no other entry (`:93`, `:95`, `:96` have different paths).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit && pnpm run test:unit
pnpm exec playwright test e2e/nav-reachability.spec.ts e2e/accounts/notifications.spec.ts --project=chromium   # existing nav and inbox suites stay green
```

---

### Step 14 — test: alert page e2e and the child route in nav-reachability

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/accounts/alert-detail.spec.ts` — modify
- `services/xstockstrat-ui/e2e/nav-reachability.spec.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify

**Reviewers**: Service owner `xstockstrat-ui` — trading UI correctness, Connect-RPC call safety

**Codebase Evidence**:
- `e2e/accounts/alert-detail.spec.ts` and the `ALERT_DETAIL*` fixtures exist after Step 10.
- Stateful assertions use `page.route()` on the browser → BFF URL: `await page.route('**' + MARK_READ, async (route) => { markReadIds = route.request().postDataJSON()?.alertIds; await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });` (`e2e/accounts/notifications.spec.ts:117-123`).
- A dynamic route with no nav link is asserted by direct `page.goto` plus `aria-current` on the Primary tab: `e2e/nav-reachability.spec.ts:100-121` (`/trader/positions/AAPL` → `Book`). The Settings group and its `Notifications` item are walked at `:51-53`. Nav landmarks: `aria-label="Primary"` (`src/components/shared/PlatformHeader.tsx:216`), `aria-label="Section"` (`:327`).
- The mock resolves `ALERT_DETAIL_ID` and `ALERT_DETAIL_BROADCAST_ID` and answers `NotFound` for anything else (Step 10).

**TDD**: `red-green required` — every page case fails before Step 13 (no route).

**Covers**: `AC-1, AC-2, AC-3, AC-6, AC-9`

**Instructions**:
1. In `e2e/accounts/alert-detail.spec.ts` add `test.describe('alert page (feature 344)')`. Each case starts with `addAuthCookie(page)`.
   - **`@AC-1`** — `page.goto('/accounts/notifications/' + ALERT_DETAIL_ID)`. Inside `getByTestId('alert-detail')` assert the texts `ERROR`, `backfill`, `xstockstrat-ingest`, the fixture title and the full fixture body, a non-empty Created value, `c-77`, and an `alert-context-row` that contains both `job_id` and `67276d1f`. Assert a row per fixture context key (three rows). Assert `getByTestId('alert-read-state')` has text `Read`.
   - **`@AC-9`** — the same URL shows the title and body (the fixture is targeted at `TEST_USER_ID`).
   - **`@AC-3`** — `ALERT_DETAIL_BROADCAST_ID` shows its title and body, and "No context fields".
   - **`@AC-2`** — `ALERT_DETAIL_UNKNOWN_ID` shows "Alert not found" inside `getByTestId('empty-state')`, and `alert-read-state` is absent. Add a second case that fulfils `GetAlert` through `page.route` with HTTP 404 and body `{"code":"not_found","message":"something else entirely"}`: the page still shows "Alert not found", which proves it keys on the code and not the message.
   - **Malformed id in the URL** — `/accounts/notifications/a1f3` shows "Alert not found" (the mock answers `NotFound`).
   - **Other error** — fulfil `GetAlert` with HTTP 500 and `{"code":"internal","message":"db down"}`: "Could not load alert" is shown and no `MarkAlertRead` request is sent.
   - **`@AC-6` (first half; D-7)** — fulfil `GetAlert` through `page.route` with `{ ...ALERT_DETAIL as JSON, alertId: ALERT_DETAIL_BROADCAST_ID }` while navigating to the `ALERT_DETAIL_ID` URL; capture the `MarkAlertRead` body with `page.route`. Assert with `expect.poll` that the captured `alertIds` equals `[ALERT_DETAIL_BROADCAST_ID]` — the server-returned id, not the URL id. Do not count calls.
   - **Mark-read failure is non-blocking** — fulfil `MarkAlertRead` with HTTP 500: the alert stays rendered and `alert-read-state` shows `Unread`.
   `BigInt` fixture fields cannot go through `JSON.stringify`; build the routed JSON body from the fixture with `createdAt` written as an RFC 3339 string. That body is a scenario one-off (`{ ...FIXTURE, override }`), which C-12 exempts.
2. In `e2e/nav-reachability.spec.ts` add a third test after the symbol-page test (`:100-121`): with `addAuthCookie`, `page.goto('/accounts/notifications/' + ALERT_DETAIL_ID)`; assert `getByTestId('alert-detail')` is visible, the Primary `Settings` link has `aria-current="page"`, and the Section `Notifications` link has `aria-current="page"` (C-10(a) for a page with no nav entry of its own).
3. `e2e/fixtures/INVENTORY.md` — add `e2e/nav-reachability.spec.ts` to the consumers of the "Alert detail (feature 344)" row.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit && pnpm exec playwright test e2e/accounts/alert-detail.spec.ts e2e/nav-reachability.spec.ts --project=chromium
grep -n "from '../fixtures\|from './fixtures\|helpers/auth" e2e/accounts/alert-detail.spec.ts e2e/nav-reachability.spec.ts
```
No coverage threshold applies to Playwright e2e (`docs/patterns/ci-overview.md:29` lists none for `frontend-e2e`); the `src/lib/**` vitest gate (≥ 40%) is checked in Step 12.

---

### Step 15 — service: inbox row title links to the alert page

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/accounts/notifications/AlertInbox.tsx` — modify

**Reviewers**: Service owner `xstockstrat-ui` — trading UI correctness

**Codebase Evidence**:
- Confirmed via: `cat -n src/app/accounts/notifications/AlertInbox.tsx` (line numbers are pre-Step-11; Step 11 removes five lines above them, so re-grep `a.title`).
- Row: `<li key={a.alertId} data-testid="alert-row" data-read={…} …>` (`:92-97`). Title: `<p className={a.read ? 'text-sm' : 'text-sm font-semibold'}>{a.title}</p>` (`:116`). Per-row button: `<Button … aria-label={\`Mark notification ${a.title} read\`}>Mark read</Button>` (`:122-131`).
- The file has no `Link` / `href` today (grep). `Link` from `next/link` is the in-app link used elsewhere (`src/components/shared/PlatformHeader.tsx:4`).
- Wrapping the whole row would nest the button in an anchor and disturb the testids the 203 suite reads (`e2e/accounts/notifications.spec.ts:95-131`) — rejected (R-4).

**TDD**: `red-green required` — Step 16's click test fails first (the title is not a link).

**Covers**: `—`

**Instructions**:
1. Import `Link` from `next/link`.
2. Replace the title's text child with a link, keeping the `<p>` and its classes: `<p className={…}><Link href={\`/accounts/notifications/${a.alertId}\`} className="hover:underline">{a.title}</Link></p>`. The link's accessible name is the alert title.
3. Leave the `<li>`, its `data-testid` / `data-read`, the unread dot, the badge, the category span, the body and the "Mark read" button unchanged.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit
pnpm exec playwright test e2e/accounts/notifications.spec.ts --project=chromium   # the 203 inbox suite stays green
```

---

### Step 16 — test: inbox row title navigation

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/accounts/notifications.spec.ts` — modify

**Reviewers**: Service owner `xstockstrat-ui` — trading UI correctness

**Codebase Evidence**:
- Inbox suite: `test.describe('alert inbox (feature 203)'` (`e2e/accounts/notifications.spec.ts:92-133`); it waits on `getByTestId('alert-inbox-list')` (`:100`).
- The mock list is `ALERT_LIST_WITH_READ_STATE` (`e2e/fixtures/alerts.ts:94`): `ALERT_READ` (`alertId: 'alert-001'`, title "Position limit approaching"), `ALERT_UNREAD` (`'alert-002'`, "Order rejected"), `ALERT_ACKNOWLEDGED_UNREAD` (`'alert-strat-001'`).
- The mock `getAlert` resolves these ids after Step 10.

**TDD**: `red-green required`

**Covers**: `AC-4`

**Instructions**:
Add to the inbox suite:
1. **`@AC-4`** — after the list is visible, click `page.getByRole('link', { name: ALERT_UNREAD.title })` inside the `alert-row` list; assert `page` has URL `/accounts/notifications/alert-002` and `getByTestId('alert-detail')` shows the title. Import `ALERT_UNREAD` from `../fixtures/alerts`.
2. **`@AC-6 @feature-203` EXTEND guard** — every `alert-row` still has its `alert-module`, its body and, for an unread row, its "Mark read" button, and no `button` is a descendant of an `a` (`page.locator('a button')` has count 0).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit && pnpm exec playwright test e2e/accounts/notifications.spec.ts --project=chromium
grep -n "from '../fixtures\|helpers/auth" e2e/accounts/notifications.spec.ts
```
No coverage threshold applies to Playwright e2e (`docs/patterns/ci-overview.md:29` lists none for `frontend-e2e`); the `src/lib/**` vitest gate (≥ 40%) is checked in Step 12.

---

### Step 17 — service: [blocked on 339] the bell in the shared header

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/trader/AlertStream.tsx` — delete (moved)
- `services/xstockstrat-ui/src/components/shared/AlertStream.tsx` — create (moved)
- `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx` — modify
- `services/xstockstrat-ui/src/components/trader/AppShell.tsx` — modify

**Reviewers**: Service owner `xstockstrat-ui` — trading UI correctness, Connect-RPC call safety

**Codebase Evidence** (this tree, pre-339 — every anchor is re-grepped after 339 merges):
- The only mount: `import { AlertStream } from './AlertStream';` (`src/components/trader/AppShell.tsx:5`) and `<AlertStream />` inside the `actions` prop (`:24`). `grep -rn "AlertStream" src --include=*.tsx --include=*.ts` finds no other importer.
- Target: `<div className="flex items-center gap-2 ml-auto">{actions}<CopilotToggle />` in `PlatformHeaderInner` (`src/components/shared/PlatformHeader.tsx:246-248`).
- `AlertStream.tsx` imports its primitives relatively (`'../ui/button'`, `'../ui/badge'`, `'../ui/sheet'`, `'../ui/separator'`, `:6-9`); `components/shared/` is a sibling of `components/trader/`, so those paths stay valid after the move.
- Every `PlatformHeader` mount is inside a `QueryClientProvider`: trader (`src/app/trader/layout.tsx` → `providers.tsx:12`), insights (`src/app/insights/layout.tsx` → `src/components/shared/QueryProviders.tsx:15`), accounts (`src/app/accounts/layout.tsx:24-25`), config-ui (`src/app/config-ui/layout.tsx:12-13`).
- The bell calls the root-relative `notifyClient` (`/trader/api`), which works from any segment for the four facts recorded at `services/xstockstrat-ui/docs/context-constitution.md:19`.
- The disconnected label is `sr-only sm:not-sr-only` (`src/components/trader/AlertStream.tsx:53-59`), which is why the 640–1024px width check exists (D-19).
- e2e that locate the bell on `/trader`: `e2e/trader/alert-stream.spec.ts:19-99`, `e2e/trader/stream-reconnect.spec.ts:111-128`. A header overflow at exactly 1024px on trader pages is a known, pre-existing edge (`e2e/mobile-overflow.spec.ts:76-83`).
- 339's changes to `AlertStream.tsx`, its helpers in `src/lib/alertShared.ts` and its e2e: **Not found** in this tree.
- Gate status at re-spec (2026-11-15, `origin/main-dev@9f8856229` merged): **the 339 gate fails, so Steps 17–22 stay blocked.** `origin/feature/fix-symbol-page-alerts-ui@4d1ee033f` is not an ancestor of this branch, `origin/main-dev` has no `fix-symbol-page-alerts-ui` merge commit, `grep unreadOnly src/components/trader/AlertStream.tsx` is empty, and 339's `status.md` on its branch is `implementation-ready`. The 339 → 344 row is now on `origin/main-dev` (`docs/roadmap/features/merge-order.md:126`) and says Steps 17–22 must be re-specified after 339 merges.

**TDD**: `red-green required` — Step 18's `@AC-10` cases fail first (no bell outside `/trader`).

**Covers**: `—`

**Instructions**:
0. **Gate.** Confirm 339 is merged into this branch: `git log --oneline origin/main-dev | grep -i "fix-symbol-page-alerts-ui"` and `grep -n "unreadOnly" src/components/trader/AlertStream.tsx`. If either is empty, stop — this step is blocked. Then re-grep every anchor above and adapt to what 339 shipped; do not assume its shape (design.md §8).
1. Move the file with `git mv src/components/trader/AlertStream.tsx src/components/shared/AlertStream.tsx`, as 339 left it. Change no behaviour in the move.
2. Repoint every importer found by `grep -rn "AlertStream'" src e2e` (today: `AppShell.tsx:5` only; include any test 339 added).
3. `src/components/trader/AppShell.tsx` — remove the `AlertStream` import and the `<AlertStream />` element from `actions`. `TradingModeBadge` and `AccountSelector` stay (`@AC-12 @feature-270` PRESERVE).
4. `src/components/shared/PlatformHeader.tsx` — import `AlertStream` from `./AlertStream` and render `<AlertStream />` in `PlatformHeaderInner` directly after `{actions}` and before `<CopilotToggle />` (`:247-248`). One mount, so each page in every segment has exactly one `StreamAlerts` consumer (D-14).
5. If the header overflows between 640px and 1024px on the insights or accounts routes Step 18 checks, fix it inside `AlertStream` (for example by keeping the disconnected label `sr-only` below `lg`), not by removing header content.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit && pnpm run test:unit
grep -rn "AlertStream" src --include=*.tsx --include=*.ts   # one definition under components/shared, one mount in PlatformHeader.tsx, none in components/trader
pnpm exec playwright test e2e/trader/alert-stream.spec.ts e2e/trader/stream-reconnect.spec.ts e2e/mobile-overflow.spec.ts e2e/nav-reachability.spec.ts --project=chromium
```

---

### Step 18 — test: [blocked on 339] the bell on every segment

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/alert-bell.spec.ts` — create
- `services/xstockstrat-ui/e2e/mobile-overflow.spec.ts` — modify

**Reviewers**: Service owner `xstockstrat-ui` — trading UI correctness

**Codebase Evidence**:
- The bell's accessible name is `Alerts` (`aria-label={disconnected ? 'Alerts — live alerts disconnected' : 'Alerts'}`, `src/components/trader/AlertStream.tsx:66` pre-339 — re-grep).
- Badge locator used today: `page.locator('span[data-slot="badge"]').filter({ hasText: /^2$/ })` (`e2e/trader/alert-stream.spec.ts:39`).
- Overflow helper and viewport pattern: `horizontalOverflow(page)` (`e2e/mobile-overflow.spec.ts:43-47`), `test.use({ viewport: { width: 1280, height: 900 } })` (`:86`), the `networkidle` wait is capped and caught because streams keep the network busy (`:40-41`, `:57`).
- Dropped-stream indicator and reconnect: `e2e/trader/stream-reconnect.spec.ts:111-128` (`alert-stream-disconnected`).
- `e2e/alert-bell.spec.ts`: **Not found** — created by this step.
- Gate status at re-spec (2026-11-15): the 339 gate fails (see Step 17), so this step stays blocked.

**TDD**: `red-green required`

**Covers**: `AC-10`

**Instructions**:
0. **Gate** as in Step 17. Re-grep the bell's accessible name and the badge markup 339 shipped.
1. Create `e2e/alert-bell.spec.ts`:
   - **`@AC-10`** — a parametrised test over `/trader`, `/insights/opportunities`, `/config-ui`, `/accounts/notifications`: after `addAuthCookie(page)` and `page.goto(path)`, `page.getByRole('button', { name: 'Alerts' })` is visible, there is exactly one such button, and it shows an unread badge. Read the badge text on `/trader` first and assert the other three pages show the same value under the same mock (values only; no hard-coded count, no call counting — D-26).
   - **One stream per page** — count requests to `**/NotifyService/StreamAlerts` with `page.on('request')` on `/accounts/notifications` and assert at least one and, after the page settles, that only one is open (assert via the single bell button and a single `Sheet` trigger rather than a request count if 339's reconnect logic makes the count unstable; state which one was used in `context.md`).
   - **`@AC-9 @feature-270` EXTEND** — on `/accounts/notifications`, abort `StreamAlerts` as `e2e/trader/stream-reconnect.spec.ts:111-128` does; `alert-stream-disconnected` attaches, then detaches after the route is released.
   - **`@AC-12 @feature-270` PRESERVE** — on `/trader` the trading-mode badge and the account selector are still in the header.
2. `e2e/mobile-overflow.spec.ts` — add a `test.describe` for D-19 that checks `horizontalOverflow(page) <= 1` at widths 640, 768 and 1024 on `/insights/opportunities` and `/accounts/notifications` (six cases), using the same capped `networkidle` wait. The known 1024px trader edge (`:76-83`) is out of scope and stays documented there.
3. C-12: no new domain data; the bell reads the existing alert fixtures through the mock.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit && pnpm exec playwright test e2e/alert-bell.spec.ts e2e/mobile-overflow.spec.ts --project=chromium
pnpm test:e2e   # the bell is now on every page: run the whole suite once (fails.md 2026-11-04, fix-ui-trader-feedback)
```
No coverage threshold applies to Playwright e2e (`docs/patterns/ci-overview.md:29` lists none for `frontend-e2e`); the `src/lib/**` vitest gate (≥ 40%) is checked in Step 12.

---

### Step 19 — service: [blocked on 339] shared alert read models

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/alertShared.ts` — modify
- `services/xstockstrat-ui/src/components/shared/AlertStream.tsx` — modify
- `services/xstockstrat-ui/src/app/accounts/notifications/AlertInbox.tsx` — modify
- `services/xstockstrat-ui/src/app/accounts/notifications/[alert_id]/AlertDetail.tsx` — modify

**Reviewers**: Service owner `xstockstrat-ui` — trading UI correctness, Connect-RPC call safety

**Codebase Evidence** (this tree, pre-339):
- `useInvalidatingMutation(mutationFn, invalidateKeys, options?: { mutationKey?, meta? })` invalidates each key on success (`src/hooks/useInvalidatingMutation.ts:15-32`).
- `meta.errorHandled === true` is the only opt-out from the global mutation error fallback (`src/lib/mutationErrorStore.ts:36-38`; `src/lib/queryClient.ts:15-19`); the fallback renders `role="alert"` (`src/components/shared/MutationErrorFallback.tsx:28-36`).
- Query defaults: `staleTime: 5_000, retry: 1` (`src/lib/queryClient.ts:22`); `refetchOnWindowFocus` is the library default (on).
- One `QueryClient` per segment provider (`src/app/trader/providers.tsx:10`, `src/components/shared/QueryProviders.tsx:13`), so the cache is shared inside a segment and not across segments.
- Bell count today: a one-shot effect, `notifyClient.listAlerts({ limit: 1 })` → `setUnreadCount(res.unreadCount)` (`src/components/trader/AlertStream.tsx:19-32`). Stream handler: `(alert) => setAlerts((prev) => prev.some(…) ? prev : [alert, ...prev].slice(0, 50))` (`:42-45`); a reconnect re-delivers alerts (`:34`).
- Inbox today: local state plus `refetch()` (`src/app/accounts/notifications/AlertInbox.tsx:19-40`), `markRead` calls `notifyClient.markAlertRead` then `refetch()` inside `try/catch` with its own error text (`:42-53`), "N unread" badge from `unreadCount` (`:63-65`).
- Alert page mark-read: the direct call added in Step 13.
- **Not found in this tree — from 339's design.md §5 (`origin/feature/fix-symbol-page-alerts-ui@0442d300d`), to be confirmed by grep after the merge**: `refreshUnread()`, `mergeUnread`, `pruneStreamed`, `drainUnread`, a `readIds` set, a badge equal to the merged unread list length, a per-row drawer mark-read and a draining "Clear all". 339's `context.md:894` states its constraint for 344: "the `ALERT_UNREAD_COUNT_KEY` value is derived from the merged, de-duplicated unread list and is invalidated by mark-read and Clear all".
- Gate status at re-spec (2026-11-15): the 339 gate fails (see Step 17). None of `refreshUnread`, `mergeUnread`, `pruneStreamed`, `drainUnread`, `readIds`, `unreadOnly` is in `src`, so neither Case A nor Case B can be confirmed; this step stays blocked.

**TDD**: `red-green required` — Step 20's badge-drop cases fail first.

**Covers**: `—`

**Instructions**:
0. **Gate** as in Step 17, then `grep -n "refreshUnread\|mergeUnread\|unreadOnly\|listAlerts" src/components/shared/AlertStream.tsx src/lib/alertShared.ts` and pick the case below. If what 339 shipped fits neither case, stop and escalate (P-03); do not improvise a third shape.
1. `src/lib/alertShared.ts` — export `ALERTS_QUERY_KEY = ['alerts'] as const` and `ALERT_UNREAD_COUNT_KEY = ['alerts', 'unread-count'] as const` (D-20). No other key constant: the inbox key is written as `[...ALERTS_QUERY_KEY, 'list']`.
2. **Bell read model** (`AlertStream.tsx`) — the server read that feeds the badge becomes a `useQuery` on `ALERT_UNREAD_COUNT_KEY`, replacing the mount effect or 339's fetch-on-trigger:
   - **Case A — 339 shipped the merged-list badge** (its approved design): the query function is the stored-unread fetch 339 already makes (`listAlerts({ unreadOnly: true, limit: 50 })`); the badge keeps 339's derivation (merged, de-duplicated list length, `9+` display); `refreshUnread()` becomes one `queryClient.invalidateQueries({ queryKey: ALERT_UNREAD_COUNT_KEY })`; 339's merge, prune and `readIds` helpers stay. This is the shape 339's own constraint line asks for.
   - **Case B — the badge is still the server count**: the query function is `listAlerts({ limit: 1 })` with `select: (res) => res.unreadCount` (design.md §7 as written).
   - In both cases the stream `onMessage` path **invalidates** `ALERT_UNREAD_COUNT_KEY` and never increments a cached value, because a reconnect re-delivers alerts (D-24, R-13). 339's "a streamed alert raises the badge without a reload" behaviour must still hold (`@AC-5 @feature-339` PRESERVE).
   - Drawer mark-read and "Clear all" (if 339 shipped them) go through `useInvalidatingMutation(…, [ALERTS_QUERY_KEY], { meta: { errorHandled: true } })` or, where 339's drain helper owns the calls, end with one `invalidateQueries({ queryKey: ALERTS_QUERY_KEY })`. Keep 339's own error notices.
3. **Inbox** (`AlertInbox.tsx`) — replace the local `alerts` / `unreadCount` / `loading` state and `refetch()` with `useQuery({ queryKey: [...ALERTS_QUERY_KEY, 'list'], queryFn: () => notifyClient.listAlerts({}) })` (D-23). `markRead` becomes a `useInvalidatingMutation((alertIds: string[]) => notifyClient.markAlertRead({ alertIds }), [ALERTS_QUERY_KEY], { meta: { errorHandled: true } })` called with `mutateAsync` inside the existing `try/catch`, which keeps the inbox's own error text (D-22). Keep every testid, the skeleton, the two `EmptyState`s and the "N unread" badge; loading maps to `isLoading`, the error text to the query error or the mark error.
4. **Alert page** (`AlertDetail.tsx`) — replace the direct `markAlertRead` call with the same `useInvalidatingMutation` (keys `[ALERTS_QUERY_KEY]`, `meta: { errorHandled: true }`), fired with `mutate([res.alertId])` after a successful `GetAlert`. Failure stays silent (D-7, D-22). The `GetAlert` fetch itself is unchanged.
5. One invalidation of the `['alerts']` prefix now refreshes the bell, the drawer list, the inbox rows and the inbox "N unread" badge, whichever surface marked the alert read. Do not add a window event, a second refresh mechanism or a count-only invalidation (R-8, R-11, R-12).
6. Behaviour change to carry into the PR body and Step 23: the bell now refetches on window focus and retries once (D-26).
7. Mutation opt-out audit (`fails.md` 2026-11-04, fix-ui-trader-feedback): `grep -rn "markAlertRead" src` — every call site is one of the three above (inbox, alert page, drawer) and each passes `errorHandled`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit && pnpm run test:unit
grep -rn "ALERTS_QUERY_KEY\|ALERT_UNREAD_COUNT_KEY" src   # one definition each; bell, inbox and alert page use them
grep -rn "markAlertRead" src   # every call site sits in a mutation that passes meta.errorHandled
pnpm exec playwright test e2e/accounts/notifications.spec.ts e2e/accounts/alert-detail.spec.ts e2e/trader/alert-stream.spec.ts e2e/trader/stream-reconnect.spec.ts e2e/alert-bell.spec.ts --project=chromium
```

---

### Step 20 — test: [blocked on 339] read-state e2e and the stateful fixture

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/helpers/alertReadState.ts` — create
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify
- `services/xstockstrat-ui/e2e/accounts/alert-read-state.spec.ts` — create

**Reviewers**: Service owner `xstockstrat-ui` — trading UI correctness, Connect-RPC call safety

**Codebase Evidence**:
- The shared mock cannot prove a badge drop: `listAlerts` returns a fixed `MOCK_UNREAD_COUNT` and `markAlertRead` stores nothing (`e2e/mock-backend.ts:685-693`); its own comment sends stateful assertions to `page.route()` (`:689-690`).
- `page.route()` fulfil pattern: `e2e/accounts/notifications.spec.ts:120-123`. Helpers live in `e2e/helpers/` (`auth.ts`, `browser-resolution.ts`, `devCerts.ts`, `watchlistMock.ts`).
- Fixtures: `ALERT_DETAIL`, `ALERT_DETAIL_ID` (Step 10), `ALERT_UNREAD` (`e2e/fixtures/alerts.ts:82`).
- The accounts header is rendered by the layout and does not remount on list → detail navigation (`src/app/accounts/layout.tsx:24-27`), so only an invalidation can refresh the badge there.
- 339's streamed-alert scenario: `@AC-5` "A streamed alert raises the badge without a reload" (339 `acceptance.feature`, same ref). 339's e2e file names: **Not found** in this tree — re-grep after the merge.
- `e2e/helpers/alertReadState.ts`, `e2e/accounts/alert-read-state.spec.ts`: **Not found** — created by this step.
- Gate status at re-spec (2026-11-15): the 339 gate fails (see Step 17) and 339's e2e files are not in this tree; this step stays blocked.

**TDD**: `red-green required`

**Covers**: `AC-6`

**Instructions**:
0. **Gate** as in Step 17. Grep the `ListAlerts` request shapes the bell and the drawer send after 339 (`unreadOnly`, `limit`) so the helper answers each one consistently.
1. `e2e/helpers/alertReadState.ts` — export `routeAlertReadState(page, alerts)`: it installs `page.route()` handlers for `ListAlerts`, `GetAlert` and `MarkAlertRead` on the `/trader/api/…NotifyService/` paths, holds the set of read ids in a closure, and answers `ListAlerts` from that state (rows with `read`, the `unreadOnly` filter, and `unreadCount`), so the count drops to 0 once `MarkAlertRead` is called for the only unread alert. It returns `{ markedIds(): string[] }`. Optional argument: a delay for the first `ListAlerts` response. Add an `INVENTORY.md` row for it (D-12, C-12).
2. `e2e/accounts/alert-read-state.spec.ts` — all cases seed one unread alert (`ALERT_DETAIL`) and assert badge **values only**, never request counts (D-26):
   - **`@AC-6` direct open** — `page.goto('/accounts/notifications/' + ALERT_DETAIL_ID)`: the bell on that page ends with no unread badge. Then `page.reload()` and `page.goto('/accounts/notifications')`: the row for the alert has `data-read="true"`.
   - **`@AC-6` client navigation** — `page.goto('/accounts/notifications')`, assert the bell badge is `1`, click the row title link; on the alert page the bell badge disappears without a reload. There is no `page.goto('/trader')` step (D-21).
   - **Delayed first `ListAlerts`** — the first response is held until after `MarkAlertRead` returns; the badge must end at no badge, not at the stale `1`. Keep the page focused and do not blur the window, so the focus refetch does not mask a failure.
   - **Inbox and bell together (D-23)** — on `/accounts/notifications`, one "Mark read" click drops the inbox "0 unread" badge and the bell badge together.
   - **Failed page-open mark-read (D-22)** — `MarkAlertRead` answers HTTP 500: the alert page stays rendered and `page.getByRole('alert')` has count 0 (no global error banner).
   - **339's streamed-alert raise, re-asserted (D-24)** — with one stored unread alert and the drawer closed, a streamed alert raises the badge without a reload. Reuse 339's own stream stub for this; if 339's spec already covers it unchanged, run that spec here instead of duplicating it and record which was done.
   - **`@AC-1`/`@AC-3 @feature-203` PRESERVE** — `MarkAlertRead` is the only write the page-open path sends (the helper records no other mutation).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit && pnpm exec playwright test e2e/accounts/alert-read-state.spec.ts --project=chromium --repeat-each=3
pnpm test:e2e
grep -n "from '../fixtures\|helpers/auth\|helpers/alertReadState" e2e/accounts/alert-read-state.spec.ts && grep -n "alertReadState" e2e/fixtures/INVENTORY.md
```
`--repeat-each=3` guards the delayed-response case against flake.
No coverage threshold applies to Playwright e2e (`docs/patterns/ci-overview.md:29` lists none for `frontend-e2e`); the `src/lib/**` vitest gate (≥ 40%) is checked in Step 12.

---

### Step 21 — service: [blocked on 339] drawer row title links to the alert page

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/shared/AlertStream.tsx` — modify

**Reviewers**: Service owner `xstockstrat-ui` — trading UI correctness

**Codebase Evidence**:
- Drawer row today (pre-339, pre-move): `<li key={a.alertId} className="rounded-lg border border-border bg-card p-3 space-y-1">` with the title `<p className="text-sm font-medium">{a.title}</p>` (`src/components/trader/AlertStream.tsx:104-117`, title `:115`). No `Link` / `href` (grep).
- 339's design keeps drawer rows a plain `<li>` "so feature 344 can wrap them later" and adds a per-row mark-read button (339 design.md §5, same ref). The shipped markup: **Not found** in this tree — re-grep.
- The link goes on the title, as in the inbox (Step 15), so no button is nested in an anchor (D-9, R-4).
- `SheetClose` is exported from `src/components/ui/sheet.tsx` (`:18`, `:124`).
- Gate status at re-spec (2026-11-15): the 339 gate fails (see Step 17), so the drawer markup 339 ships cannot be re-grepped yet; this step stays blocked.

**TDD**: `red-green required` — Step 22 fails first (the drawer title is not a link).

**Covers**: `—`

**Instructions**:
0. **Gate** as in Step 17; re-grep the drawer row markup.
1. Import `Link` from `next/link` and wrap the title text of each drawer row: `<Link href={\`/accounts/notifications/${a.alertId}\`} className="hover:underline">{a.title}</Link>`, inside the existing title element.
2. Leave the row element, 339's mark-read button and its accessible name, and the "Clear all" control unchanged.
3. Navigating away closes the drawer with the page change on `/trader` and `/insights` (the shell remounts). On `/accounts/*` the header persists, so close the `Sheet` on link click if it would otherwise stay open over the alert page (use the `Sheet`'s controlled `open` state only if 339 already made it controlled; otherwise wrap the link in `SheetClose asChild` if `src/components/ui/sheet.tsx` exports it — grep first, and if neither exists, stop and record it rather than adding a new primitive).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit
pnpm exec playwright test e2e/trader/alert-stream.spec.ts e2e/alert-bell.spec.ts --project=chromium
```

---

### Step 22 — test: [blocked on 339] drawer link e2e

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/accounts/alert-read-state.spec.ts` — modify

**Reviewers**: Service owner `xstockstrat-ui` — trading UI correctness

**Codebase Evidence**:
- The drawer is opened today by clicking the bell (`e2e/trader/alert-stream.spec.ts:50-55`); after Step 18 the bell is `page.getByRole('button', { name: 'Alerts' })`.
- `routeAlertReadState` and `e2e/accounts/alert-read-state.spec.ts` exist after Step 20.
- 339's `@AC-3` "The Alerts drawer shows a stored unread alert that was not streamed" (339 `acceptance.feature`, same ref) is what makes a stored alert appear in the drawer.
- Gate status at re-spec (2026-11-15): the 339 gate fails (see Step 17), so this step stays blocked.

**TDD**: `red-green required`

**Covers**: `AC-5`

**Instructions**:
0. **Gate** as in Step 17.
1. **`@AC-5`** — with one stored unread alert (`ALERT_DETAIL`) through `routeAlertReadState`, on `/trader`: open the bell, click the drawer row's title link, assert the URL is `/accounts/notifications/<ALERT_DETAIL_ID>` and `getByTestId('alert-detail')` shows the title.
2. **Drawer no longer lists it (D-24)** — after the alert page has marked it read, open the bell on that page: the drawer shows "No alerts" (or 339's empty state — use the text 339 shipped) and the bell has no badge.
3. **No nested interactive** — inside the open drawer, `page.locator('a button')` has count 0.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit && pnpm exec playwright test e2e/accounts/alert-read-state.spec.ts --project=chromium
pnpm test:e2e
```
No coverage threshold applies to Playwright e2e (`docs/patterns/ci-overview.md:29` lists none for `frontend-e2e`); the `src/lib/**` vitest gate (≥ 40%) is checked in Step 12.

---

### Step 23 — docs: alert page, bell on every page, findings

**Status**: `pending`
**Service**: `services/xstockstrat-ui/docs/`, `services/xstockstrat-notify/docs/`
**Files**:
- `services/xstockstrat-ui/docs/pwa-push.md` — modify
- `services/xstockstrat-ui/docs/context-constitution.md` — modify
- `services/xstockstrat-ui/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-notify/docs/context-constitution.md` — modify
- `services/xstockstrat-notify/docs/context-constitution-findings.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-ui/docs/pwa-push.md:21-23` says the `/trader` bell badge "shows the server `unreadCount` fetched once on mount — it does not refresh after mark-read or on a streamed alert"; `:28` records the sanctioned reuse of the root-relative `notifyClient` under `/accounts`. `:16-17` says the Notifications page is registered in both `PLATFORM_SUBNAV.accounts` and `NAV_GROUPS`.
- UI-2 and its sanctioned exception: `services/xstockstrat-ui/docs/context-constitution.md:17,19`.
- Doc drift (D-18): the comment at `src/components/shared/PlatformHeader.tsx:42-45` says react-query "is unavailable in /accounts and /config-ui", but both layouts wrap the header in the shared `Providers` (`src/app/accounts/layout.tsx:24-25`, `src/app/config-ui/layout.tsx:12-13`). UI findings sections: "Documentation that lies" (`context-constitution-findings.md:5`).
- NOTIFY-7 (`services/xstockstrat-notify/docs/context-constitution.md:19`) describes the body-`userId` fallback of `MarkAlertRead` / `ListAlerts` and warns against copying it into a new RPC. On this tree the last id is NOTIFY-13; `origin/main-dev@d1c97273b` adds NOTIFY-14..17 — re-grep after the merge.
- notify findings sections: "Latent bugs" (`context-constitution-findings.md:20`), "Open questions" (`:32`).
- Exposure facts for D-13: `emitAlert` writes `context` to every matching stream subscriber (`services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts:113,121-124`); a broadcast alert matches every subscriber (`:355-357`). `markAlertRead` has no visibility check (`:211-217`).
- No other doc references `components/trader/AlertStream.tsx` as a live path except reports and a debt finding (`grep -rn "AlertStream" --include=*.md .` → `docs/reports/*`, `docs/repo-surveyor/debt-radar-findings.md`, `docs/patterns/ui-ux-governance.md:261`), which are historical records and are not edited.

**TDD**: `N/A (docs)`

**Covers**: `—`

**Instructions**:
1. `services/xstockstrat-ui/docs/pwa-push.md`:
   - Rewrite the bell sentence at `:21-23`: the bell (`components/shared/AlertStream.tsx`) is mounted once in `PlatformHeaderInner` and is on every page of every segment; its read model is on `ALERT_UNREAD_COUNT_KEY`; every mark-read path (alert page, inbox, drawer) invalidates the `['alerts']` prefix; the cache is per segment; the bell refetches on window focus and retries once; every open tab holds one `StreamAlerts` stream and runs the count query (accepted risk).
   - Add the alert page: `/accounts/notifications/<alert_id>`, `GetAlert` through `traderBff`, mark-read after a successful load, "Alert not found" keyed on `Code.NotFound`, links from the inbox row title, the drawer row title and the push `url`.
   - Note at `:16-17` that the rendered shell reads `NAV_GROUPS`; `PLATFORM_SUBNAV` is the legacy list.
2. `services/xstockstrat-ui/docs/context-constitution.md` — extend the sanctioned UI-2 exception (`:19`) with one paragraph: the header bell calls the root-relative `notifyClient` (`/trader/api`) from all four segments, for the same four facts; it is not a precedent for other cross-segment reuse (D-18).
3. `services/xstockstrat-ui/docs/context-constitution-findings.md` — add a "Documentation that lies" row for the `PlatformHeader.tsx:42-45` comment (found 2026-11-15, D-18), and one for `pwa-push.md`'s "registered in both" sentence if step 1 did not fully correct it.
4. `services/xstockstrat-notify/docs/context-constitution.md` — amend the NOTIFY-7 row in place (no new id): `GetAlert` (feature 344) is the header-only counter-example — it rejects a missing `x-user-id` with code 3, has no body fallback and no unscoped branch, and answers code 5 for a missing, not-visible or malformed id.
5. `services/xstockstrat-notify/docs/context-constitution-findings.md` — add, dated 2026-11-15:
   - D-13: `StreamAlerts` sends `context`, including a backfill alert's raw `error` text, to every connected subscriber of a broadcast alert.
   - O-1 ruling (a): since `GetAlert`, that text is readable on demand by every authenticated user for broadcast alerts; accepted by the operator on 2026-11-15, no sanitising and no redaction.
   - R-3: `markAlertRead` has no visibility check (an existence probe); left as is by feature 344.
6. Acceptance-suite promotion (C-16) is done by the `/sdd-execute` integration PR, not here.

**Verification**:
```bash
grep -n "components/shared/AlertStream\|ALERT_UNREAD_COUNT_KEY\|/accounts/notifications/<alert_id>" services/xstockstrat-ui/docs/pwa-push.md
grep -n "header bell" services/xstockstrat-ui/docs/context-constitution.md
grep -n "PlatformHeader.tsx" services/xstockstrat-ui/docs/context-constitution-findings.md
grep -n "GetAlert" services/xstockstrat-notify/docs/context-constitution.md services/xstockstrat-notify/docs/context-constitution-findings.md
```
Then re-read each touched doc against the code it describes.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Steps 1+2 — verification run inside the pinned codegen image (2026-11-15)
- **Planned**: run both Verification blocks on the host (`buf lint`/`buf breaking`, `./scripts/buf-gen.sh`, notify build, UI `tsc --noEmit`, trading `go build`).
- **Actual**: `buf` is not on the host, so each block ran verbatim inside the cached `xstockstrat-codegen` image (`Dockerfile.codegen`, the image `scripts/localenv-setup.py` builds) with the repo bind-mounted at its own path, the main checkout's `packages/proto/gen/ts/node_modules` mounted read-only, and the host Go module cache mounted with `GOPROXY=off` (populated first by `GOWORK=off go mod download` in `services/xstockstrat-trading`). `localenv-setup.py` itself was not run because it also writes dev mTLS certs into the worktree.
- **Step 1 block**: used `branch=origin/feature/alert-detail-page` (no local `feature/alert-detail-page` ref), the alternative the step names.
- **Disposition**: CI-equivalent fallback.

### Steps 3+4 — Step 4's fixtures grep cannot match (2026-11-15)
- **Planned**: Step 4's Verification ends with `grep -n "__tests__/fixtures" src/__tests__/notifyServiceImpl.test.ts`, to list the existing fixture imports.
- **Actual**: the test file imports its fixtures as `./fixtures/…` (`:23-24,28-29`), so the pattern matches nothing and the block exits 1 on that last line. Lint (0 errors), `test:coverage` (414 pass, 0 fail) and `c8 check-coverage --lines 40` all passed earlier in the same block. A supplementary `grep -n "fixtures/"` lists the four existing imports, and the diff adds 0 fixture imports.
- **Disposition**: run verbatim, intent met by the supplementary check; Verification text left unchanged (F-09).

### Step 7 — body expression, RED test held uncommitted, Verification run form (2026-11-15)
- **Planned**: body line `f"Backfill job {job_id} {label}: {detail if detail is not None else error}"`; Step 8's test fails first (TDD gate); Verification block run as written.
- **Actual**: the planned line is 101 characters (ruff E501, limit 100), so the step's own line reads `{error if detail is None else detail}` — same value for every input. Step 7 and Step 8 do not land together and the test file is Step 8's, so Step 8's three behaviour cases (AC-8, code only, non-RPC fallback) were written in the working tree, run RED (3 failed on the body text) and GREEN (3 passed), then reverted; the commit stages `servicer.py` only and Step 8 still owns the test. Verification ran with the ingest `.venv/bin` first on `PATH` (bare `pytest` resolves to a user-level install without the service deps); its closing `)` sits on its own line because the block's last line ends in a `#` comment. Verification re-run on the committed tree: 503 passed, 86.53% coverage.
- **Disposition**: lint fix of the step's own line (in scope); TDD red/green evidence in `context.md` (F-09).

### Step 8 — RED against the pre-Step-7 servicer; block exit set by its closing grep (2026-11-15)
- **Planned**: the three behaviour cases fail first, then pass; the Verification block's exit status is the pass signal.
- **Actual**: Step 7 had already landed, so RED ran the step's Verification with `servicer.py` temporarily restored from `45a35cb69` (the commit before Step 7), then restored to the committed file; only the test file is staged. The block's last line is the `grep` with no `&&`, so the block printed `exit=0` on the RED run too (3 failed); pass/fail was judged from the pytest summary line in the log. Verification ran with the ingest `.venv/bin` first on `PATH`, as in Step 7.
- **Disposition**: run verbatim, judged from the log; Verification text left unchanged (F-09).

### Step 9 — Verification run in a container on the branch's TS stubs; RED probe held uncommitted (2026-11-15)
- **Planned**: run the Verification block on the host; Step 10's BFF spec fails first with HTTP 404 and no JSON body.
- **Actual**: the linked `services/xstockstrat-ui/node_modules` resolves `@xstockstrat/proto` to the main checkout's `packages/proto/gen/ts`, whose `dist/notify/v1/notify_pb.d.ts` has no `GetAlert` (0 matches; 7 on this branch), so a host `tsc --noEmit` cannot see `notifyClient.getAlert`. The block ran verbatim in the cached `xstockstrat-codegen` image (node 24, pnpm 9.15.9) with the main checkout mounted read-only, the worktree read-write, and this branch's `packages/proto/gen/ts/dist` mounted read-only over the main checkout's `dist`. Step 10's tests are Playwright and not yet written, so the RED/GREEN probe was a temporary vitest case (`src/lib/__tests__/traderBffGetAlert.test.ts`: POST `/trader/api/xstockstrat.notify.v1.NotifyService/GetAlert` through `dispatchConnect`, expects 200, one `notifyClient.getAlert` call, `x-user-id` forwarded), run RED and GREEN and then deleted; it is not committed. RED answered **501** (Connect `unimplemented`), not 404: with the regenerated descriptor the router knows the method but has no handler. Step 10's "HTTP 404" RED expectation describes a tree without the regenerated stubs.
- **Disposition**: CI-equivalent fallback; TDD red/green evidence in `context.md` (F-09).

### Step 10 — Verification run in a private namespace under CI mode; RED answered 501 (2026-11-15)
- **Planned**: run the Verification block on the host (`pnpm dev` web server); RED is HTTP 404 with an empty body (both cases fail).
- **Actual**: (1) the linked `node_modules` resolve `@xstockstrat/proto` to the main checkout's stubs, which lack `GetAlert`, and a concurrent e2e run from another worktree held ports 3000/9091–9093. Each run therefore went through `unshare -m -n`: loopback up, this branch's `packages/proto/gen/ts/dist` bind-mounted (namespace-only, read path) over the main checkout's `dist`, and the egress proxy relayed into the namespace over a unix socket. (2) Under `pnpm dev` the `setup` warm-up hit its 10 s timeout on cold compiles (runs 1–3, no spec case executed), so RED ran with `CI=1` (`pnpm build && pnpm start`, the CI `frontend-e2e` path) and GREEN with `CI=1 E2E_PREBUILT=1` on that build (the Next bundle does not include `e2e/mock-backend.ts`). The block itself ran verbatim. (3) RED answered **501** (Connect `unimplemented`: the mock had no `getAlert`), not 404 — the Step 9 entry above explains why. (4) The block's last line is the closing `grep`, so `exit=` is 0 on RED too; pass/fail was judged from the Playwright summary in the log.
- **Disposition**: CI-equivalent fallback; TDD red/green evidence in `context.md` (F-09).

### Step 11 — RED probe held uncommitted; Verification run in a private namespace under CI mode (2026-11-15)
- **Planned**: Step 12's vitest fails first (`contextEntries` not exported); the Verification block runs on the host.
- **Actual**: (1) Step 11 and Step 12 do not land together and `alertShared.test.ts` is Step 12's file, so Step 12's `alertShared` cases were written in the working tree, run RED and GREEN, then deleted (as in Step 7); the commit stages Step 11's two files only. RED failed at `tsc --noEmit` with `TS2305 … has no exported member 'contextEntries'` / `'formatWhen'`, before vitest ran. (2) As in Step 10, each run went through `unshare -m -n` with this branch's `packages/proto/gen/ts/dist` bind-mounted over the main checkout's (the e2e mock's `getAlert` needs it for `tsc`) and the egress proxy relayed in over a unix socket, because another worktree's e2e run held port 3000. RED ran under `pnpm dev` and its `setup` warm-up timed out; GREEN ran with `CI=1` (production build) and the committed-tree re-run with `CI=1 E2E_PREBUILT=1`. (3) The block's last line is the closing `grep`, so `exit=0` on RED too; pass/fail was judged from the log.
- **Disposition**: CI-equivalent fallback; TDD red/green evidence in `context.md` (F-09).

### Step 12 — RED against the pre-Step-11 `alertShared.ts`; Verification run in a private mount namespace (2026-11-15)
- **Planned**: `alertShared.test.ts` fails first (`contextEntries` not exported); the Verification block runs on the host.
- **Actual**: (1) Step 11 had already landed, so RED ran the step's Verification with `src/lib/alertShared.ts` temporarily restored from `f22410b3c` (the commit before Step 11), then restored to the committed file; only the two test files are staged. RED failed at `tsc --noEmit` (`TS2305 … has no exported member 'contextEntries'` / `'formatWhen'`), before vitest ran. (2) The linked `node_modules` resolve `@xstockstrat/proto` to the main checkout's stubs, which lack `GetAlert` (needed by `e2e/mock-backend.ts` under `tsc`), so each run went through `unshare -m` with this branch's `packages/proto/gen/ts/dist` bind-mounted (namespace-only) over the main checkout's `dist`. No network namespace: the block has no e2e. The block itself ran verbatim.
- **Disposition**: CI-equivalent fallback; TDD red/green evidence in `context.md` (F-09).
