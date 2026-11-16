# Implementation Spec: alert-detail-page

**Status**: `pending`
**Created**: 2026-11-15
**Feature**: `docs/roadmap/features/344-alert-detail-page/feature.md`
**Total Steps**: 23
**Feature Branch**: `feature/alert-detail-page`
**Tree**: `detached@5c62d0174 ≡ origin/feature/alert-detail-page` for every `path:line` below (later commits on the branch touch only this feature directory). `origin/main-dev@d1c97273b` is 4 commits ahead and **not merged** here: docs and `uv.lock` only, no source file cited below. It does change `services/xstockstrat-notify/docs/context-constitution.md` (adds NOTIFY-14..17), which Step 23 re-greps. **Steps 17–22 were re-specified on 2026-11-16 against `a900126ff`** (this branch with `origin/main-dev@573050534` merged, 339 included); their `path:line` references are that tree's.

---

## Execution Summary

Backend first, so the UI has something real to call: the additive `GetAlert` proto (Steps 1–2), the notify handler and push deep link (Steps 3–6), then the ingest body (Steps 7–8). The UI follows in the design's build order: BFF and mock (9–10), shared helpers (11–12), the page and nav (13–14), the inbox title link (15–16). Steps 17–22 were blocked on 339-fix-symbol-page-alerts-ui; 339 merged at `573050534` (PR #1550) and they are re-specified against the post-339 tree: they move the bell into the shared header, put the alert read models on one react-query prefix and add the drawer link. Step 23 is docs. Paths in the UI steps are relative to `services/xstockstrat-ui/` unless they start with `services/` or `packages/`.

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
3. **(Resolved 2026-11-16: 339 shipped the merged-list badge; Step 19 follows it.) 339's approved design and this design disagree on the badge value.** design.md §7 here says the bell count is `unreadCount` from `listAlerts({ limit: 1 })`. 339's design (`origin/feature/fix-symbol-page-alerts-ui@0442d300d`, design.md §5; status `design-approved`) makes the badge the length of a merged, de-duplicated unread list fed by `listAlerts({ unreadOnly: true, limit: 50 })`, keeps it off react-query, and leaves one `refreshUnread()` function. design.md §8 here already says the post-339 step adapts to what 339 shipped, so Step 19 carries a decision rule for both shapes. None of 339's symbols exist in this tree.
4. **(Resolved 2026-11-16 by the re-spec.) Steps 17–22 cannot cite post-339 line numbers.** Their anchors are today's lines plus a mandatory re-grep. Re-running `/sdd-spec alert-detail-page` after 339 merges would re-ground them and is the safer path.
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
- Steps 17–22 were blocked on 339-fix-symbol-page-alerts-ui. **Unblocked 2026-11-16**: 339 merged into `main-dev` at `573050534` (PR #1550), `main-dev` merged into this branch at `a900126ff`, and Steps 17–22 re-specified against that tree (review finding 1). The 339 → 344 row is at `docs/roadmap/features/merge-order.md:126`; 339's constraint line is at its `context.md:30`. Two re-spec choices await the operator (see the 2026-11-16 `context.md` entry, "Open decisions"): the stream handler does not invalidate the query (Step 19), and 339's `stubNotify` moves into the shared helper (Steps 18, 20).
- Step 20 requires Step 18 (`e2e/helpers/alertReadState.ts`). Steps 18 and 20 both edit `e2e/trader/alert-stream.spec.ts` (imports only).
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

**Status**: `done`
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

**Status**: `done`
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

**Status**: `done`
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

**Status**: `done`
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

### Step 17 — service: the bell in the shared header

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/trader/AlertStream.tsx` — delete (moved)
- `services/xstockstrat-ui/src/components/shared/AlertStream.tsx` — create (moved)
- `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx` — modify
- `services/xstockstrat-ui/src/components/trader/AppShell.tsx` — modify

**Reviewers**: Service owner `xstockstrat-ui` — trading UI correctness, Connect-RPC call safety

**Codebase Evidence** (post-339 tree, `a900126ff`; confirmed via `cat -n` and `grep -rn "AlertStream" src e2e`):
- 339 is merged: `origin/main-dev@573050534` is "feat(fix-symbol-page-alerts-ui) … (339) (#1550)", merged into this branch at `a900126ff`; `grep -n "unreadOnly" src/components/trader/AlertStream.tsx` → `:34`.
- The only mount: `import { AlertStream } from './AlertStream';` (`src/components/trader/AppShell.tsx:5`) and `<AlertStream />` as the last child of the `actions` div (`:24`), after `<TradingModeBadge mode={environmentMode} />` (`:22`) and `<AccountSelector />` (`:23`). No other importer in `src` or `e2e`; the other hits are prose (`src/lib/alertShared.ts:1`, `e2e/mock-backend.ts:681`, `e2e/mobile-overflow.spec.ts:79`) and name no path.
- Target: `function PlatformHeaderInner({ actions }: PlatformHeaderProps)` (`src/components/shared/PlatformHeader.tsx:191`) renders `<div className="flex items-center gap-2 ml-auto">` with `{actions}` (`:247`) and `<CopilotToggle />` (`:248`).
- Imports of `AlertStream.tsx` as 339 shipped it: `'../ui/button'`, `'../ui/badge'`, `'../ui/sheet'`, `'../ui/separator'` (`:6-9`) stay valid from `components/shared/`. **`import { CardNotice } from '../shared/CardNotice';` (`:10`, added by 339) does not** — from `components/shared/` it is `'./CardNotice'` (`src/components/shared/CardNotice.tsx` exists). The `@/lib/…` and `@/hooks/…` imports (`:3`, `:11-19`) are alias paths and do not change.
- Every `PlatformHeader` mount is inside a `QueryClientProvider`: trader (`src/app/trader/layout.tsx:10` → `providers.tsx:12`), insights (`src/app/insights/layout.tsx:10` → `src/app/insights/providers.tsx` re-exports `src/components/shared/QueryProviders.tsx:15`; header at `src/components/insights/AppShell.tsx:20`), accounts (`src/app/accounts/layout.tsx:24-25`), config-ui (`src/app/config-ui/layout.tsx:12-13`).
- The bell calls the root-relative `notifyClient` (`makeBrowserTransport('/trader/api')`, `src/lib/browserClients/notifyClient.ts:5`); the sanctioned UI-2 exception is at `services/xstockstrat-ui/docs/context-constitution.md:19`.
- The disconnected label is `sr-only sm:not-sr-only` (`src/components/trader/AlertStream.tsx:108-115`), which is why the 640–1024px width check exists (D-19).
- e2e that locate the bell on `/trader`: `e2e/trader/alert-stream.spec.ts:23-24` (`bellOf`, `badgeOf`) and both of its suites (`:88-245`); `e2e/trader/stream-reconnect.spec.ts:73-96`; the shell aria snapshot `e2e/theme/theme-bundle.spec.ts-snapshots/shell.aria.yml:38` (`button "Alerts"`, taken on `/trader` by `e2e/theme/theme-bundle.spec.ts:73-79`). A header overflow at exactly 1024px on trader pages is a known, pre-existing edge (`e2e/mobile-overflow.spec.ts:69-84`).

**TDD**: `red-green required` — Step 18's `@AC-10` cases fail first (no bell outside `/trader`).

**Covers**: `—`

**Instructions**:
0. 339 is merged at `573050534` (PR #1550) and is in this branch since `a900126ff`. Re-grep the anchors above only if the branch has moved past `a900126ff` in these four files.
1. Move the file with `git mv src/components/trader/AlertStream.tsx src/components/shared/AlertStream.tsx`. The only content edit is the import at `:10`: `'../shared/CardNotice'` → `'./CardNotice'`. Change no behaviour in the move.
2. `src/components/trader/AppShell.tsx` — remove the `AlertStream` import (`:5`) and the `<AlertStream />` element (`:24`). `TradingModeBadge` and `AccountSelector` stay (`@AC-12 @feature-270` PRESERVE).
3. `src/components/shared/PlatformHeader.tsx` — import `AlertStream` from `./AlertStream` and render `<AlertStream />` in `PlatformHeaderInner` directly after `{actions}` (`:247`) and before `<CopilotToggle />` (`:248`). One mount, so each page in every segment has exactly one `StreamAlerts` consumer (D-14).
4. If the header overflows between 640px and 1024px on the insights or accounts routes Step 18 checks, fix it inside `AlertStream` (for example by keeping the disconnected label `sr-only` below `lg`), not by removing header content.
5. Do not refresh `shell.aria.yml` by hand. The bell keeps its place in the accessibility tree on `/trader` (after the account selector, before the copilot toggle); if the theme spec fails on that snapshot, stop and record it rather than re-recording it in this step.

**Verification** (host e2e fallback form; CI's `frontend-e2e` is the confirming run):
```bash
set -euo pipefail
cd services/xstockstrat-ui
pnpm run lint
pnpm exec tsc --noEmit
pnpm run format:check
pnpm run test:unit
test "$(grep -rln "export function AlertStream" src | tr '\n' ' ')" = "src/components/shared/AlertStream.tsx "
test "$(grep -rn "<AlertStream />" src | cut -d: -f1 | tr '\n' ' ')" = "src/components/shared/PlatformHeader.tsx "
if grep -rn "AlertStream" src/components/trader; then exit 1; fi
CI=1 NEXT_DISABLE_STANDALONE=1 pnpm exec playwright test e2e/trader/alert-stream.spec.ts e2e/trader/stream-reconnect.spec.ts e2e/mobile-overflow.spec.ts e2e/nav-reachability.spec.ts e2e/accounts e2e/theme/theme-bundle.spec.ts --project=chromium --no-deps --trace off
```

---

### Step 18 — test: the bell on every segment

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/helpers/alertReadState.ts` — create
- `services/xstockstrat-ui/e2e/trader/alert-stream.spec.ts` — modify (imports only)
- `services/xstockstrat-ui/e2e/alert-bell.spec.ts` — create
- `services/xstockstrat-ui/e2e/mobile-overflow.spec.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify

**Reviewers**: Service owner `xstockstrat-ui` — trading UI correctness

**Codebase Evidence** (post-339 tree, `a900126ff`):
- The bell's accessible name: `aria-label={disconnected ? 'Alerts — live alerts disconnected' : 'Alerts'}` (`src/components/trader/AlertStream.tsx:121`). The badge is a `Badge` inside the trigger button, text `{unread > 9 ? '9+' : unread}` (`:124-131`).
- 339's locators, local to its spec: `const bellOf = (page: Page) => page.getByRole('button', { name: /^Alerts/, includeHidden: true });` and `const badgeOf = (page: Page) => bellOf(page).locator('[data-slot="badge"]');`, with the Radix comment above them (`e2e/trader/alert-stream.spec.ts:22-24`). They are the shipped way to find the bell and its badge; a second copy in a new spec would break the DRY guard rail (`docs/patterns/dry-guard-rail.md`).
- Under the shared mock the badge is stable: `listAlerts` with `unreadOnly` returns the 2 stored unread rows plus `ALERT_STREAM_ALL` (`e2e/mock-backend.ts:686-694`), and `streamAlerts` yields `ALERT_STREAM_ALL` then stays open until the client aborts (`:676-684`); 339 asserts `'5'` on `/trader` (`e2e/trader/alert-stream.spec.ts:100-110`).
- The mock stream never ends on its own, so `useReconnectingStream` does not reconnect (`src/hooks/useReconnectingStream.ts:40-64`). A request count is still unstable outside CI mode: without `CI` the web server is `pnpm dev` (`playwright.config.ts:129`), where React strict mode mounts effects twice. The one-stream check is therefore structural (one bell), not a request count.
- Overflow helper and viewport pattern: `NETWORK_IDLE_MS` (`e2e/mobile-overflow.spec.ts:41`), `horizontalOverflow(page)` (`:43-47`), the capped and caught `networkidle` wait (`:57`), `test.describe` + `test.use({ viewport: { width: 1280, height: 900 } })` (`:85-86`). The 390px sweep already covers `/insights/opportunities`, `/config-ui` and `/trader` (`:12-38`) and so re-checks the bell at phone width once Step 17 lands. `/config-ui` loads with `addAuthCookie` there (`:26`, no `admin` flag).
- Dropped-stream indicator and reconnect on `/trader`: `e2e/trader/stream-reconnect.spec.ts:73-96` (`fulfillStream(route, [ALERT_STREAM_001], DROPPED)` on attempt 1, then `route.continue()` after a `gate()`; `alert-stream-disconnected` attaches, then has count 0). `fulfillStream` and `gate` are exported from `e2e/helpers/connectStream.ts:21-37`.
- Helpers live in `e2e/helpers/` (`auth.ts`, `browser-resolution.ts`, `connectStream.ts`, `devCerts.ts`, `watchlistMock.ts`); a helper has an `INVENTORY.md` row (`e2e/fixtures/INVENTORY.md:47` for `watchlistMock`). The alert rows are `:53-55`.
- `e2e/alert-bell.spec.ts`, `e2e/helpers/alertReadState.ts`: **Not found** — created by this step.

**TDD**: `red-green required` — run the new spec against the pre-Step-17 commit first: the `/insights/opportunities`, `/config-ui` and `/accounts/notifications` cases fail (no bell).

**Covers**: `AC-10`

**Instructions**:
0. 339 is merged at `573050534` (PR #1550), in this branch since `a900126ff`.
1. Create `e2e/helpers/alertReadState.ts` and move `bellOf` and `badgeOf` into it, exported, with their comment (`e2e/trader/alert-stream.spec.ts:22-24`). `e2e/trader/alert-stream.spec.ts` imports them from `../helpers/alertReadState`; no test body changes. Step 20 adds the stateful stub to the same file.
2. Create `e2e/alert-bell.spec.ts`:
   - **`@AC-10`** — a parametrised test over `/trader`, `/insights/opportunities`, `/config-ui`, `/accounts/notifications`: after `addAuthCookie(page)` and `page.goto(path)`, `bellOf(page)` is visible, `toHaveCount(1)`, and `badgeOf(page)` is visible. Read the badge text on `/trader` first (wait until it is stable, as `alert-stream.spec.ts:106` does with its timeout) and assert the other three pages show the same text under the same mock. Values only; no hard-coded count, no call counting (D-26).
   - **One stream consumer per page** — on `/accounts/notifications`: at least one request to `**/xstockstrat.notify.v1.NotifyService/StreamAlerts` is seen (`page.on('request')`), and `bellOf(page)` has count 1. No upper bound on the request count (see Evidence).
   - **`@AC-9 @feature-270` EXTEND** — on `/accounts/notifications`, drop the first `StreamAlerts` attempt exactly as `e2e/trader/stream-reconnect.spec.ts:77-86` does: `alert-stream-disconnected` attaches and the bell's accessible name matches `/disconnected/`; after the gate is released the name is `Alerts` and the indicator has count 0.
   - **`@AC-12 @feature-270` PRESERVE** — on `/trader` the trading-mode badge and the account selector are still in the `banner`. Take both locators from an existing trader spec (grep `e2e/trader` for the selector's and the badge's locators at execute); do not add a testid for this.
3. `e2e/mobile-overflow.spec.ts` — add a `test.describe` for D-19 that checks `horizontalOverflow(page) <= 1` at widths 640, 768 and 1024 on `/insights/opportunities` and `/accounts/notifications` (six cases), using the same capped `networkidle` wait and the 800 ms settle. The known 1024px trader edge (`:69-84`) is out of scope and stays documented there.
4. `e2e/fixtures/INVENTORY.md` — add a row for `e2e/helpers/alertReadState.ts` (`bellOf`, `badgeOf`; consumers `e2e/alert-bell.spec.ts`, `e2e/trader/alert-stream.spec.ts`). C-12: no new domain data; the bell reads the existing alert fixtures through the mock.

**Verification** (host e2e fallback form; CI's `frontend-e2e` is the confirming run):
```bash
set -euo pipefail
cd services/xstockstrat-ui
pnpm run lint
pnpm exec tsc --noEmit
grep -n "helpers/alertReadState" e2e/alert-bell.spec.ts e2e/trader/alert-stream.spec.ts
grep -n "alertReadState" e2e/fixtures/INVENTORY.md
if grep -n "const bellOf\|const badgeOf" e2e/trader/alert-stream.spec.ts e2e/alert-bell.spec.ts; then exit 1; fi
CI=1 NEXT_DISABLE_STANDALONE=1 pnpm exec playwright test e2e/alert-bell.spec.ts e2e/mobile-overflow.spec.ts e2e/trader/alert-stream.spec.ts --project=chromium --no-deps --trace off
CI=1 NEXT_DISABLE_STANDALONE=1 pnpm exec playwright test --project=chromium --no-deps --trace off
```
The last line is the whole suite: the bell is now on every page (`fails.md`, fix-ui-trader-feedback — a shell change breaks specs far from it). If a spec fails on the host for a reason that also fails on the pre-Step-17 commit, record it in the Deviation Log as environmental; CI's `frontend-e2e` decides.
No coverage threshold applies to Playwright e2e (`docs/patterns/ci-overview.md:29` lists none for `frontend-e2e`); the `src/lib/**` vitest gate (≥ 40%) is checked in Step 12.

---

### Step 19 — service: shared alert read models

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/alertShared.ts` — modify
- `services/xstockstrat-ui/src/components/shared/AlertStream.tsx` — modify
- `services/xstockstrat-ui/src/app/accounts/notifications/AlertInbox.tsx` — modify
- `services/xstockstrat-ui/src/app/accounts/notifications/[alert_id]/AlertDetail.tsx` — modify

**Reviewers**: Service owner `xstockstrat-ui` — trading UI correctness, Connect-RPC call safety

**Codebase Evidence** (post-339 tree, `a900126ff`; `AlertStream.tsx` lines are the file as 339 shipped it — Step 17 moves it and changes line 10 only):
- **339 shipped the merged-list badge** (the old spec's Case A). `AlertStream.tsx`: state `stored`, `streamed: { alert; seq }[]`, `readIds`, `seqRef`, `pending`, `fetchFailed`, `markNotice` (`:22-28`); `refreshUnread` is the only fetch — `notifyClient.listAlerts({ unreadOnly: true, limit: UNREAD_PAGE_SIZE })`, a superseded response dropped by `seq !== seqRef.current`, then `setStored`, `setStreamed((prev) => pruneStreamed(prev, resultIds, seq))`, `setFetchFailed(false)`; the catch sets `fetchFailed` (`:30-43`). It runs on mount (`:45-47`) and on drawer open (`:103-107`).
- Stream handler: stamps the entry with `seqRef.current` and adds it to `streamed` unless its `alertId` is already there, capped at `UNREAD_PAGE_SIZE` (`:57-64`). The badge is `mergeUnread(stored, streamed.map((e) => e.alert), readIds).length` (`:67-72`), shown as `9+` above 9 (`:129`). Nothing reads the server `unreadCount`.
- Drawer mark-read: `notifyClient.markAlertRead({ alertIds: [alert.alertId] })`, add to `readIds`, `setMarkNotice('error')` on failure, then `await refreshUnread()` after success **and** failure (`:75-86`). Clear all: `drainUnread({ list, mark, cutoff: merged[0] })`, add `result.markedIds` to `readIds`, notice when the outcome is not `done`, then `await refreshUnread()` (`:88-100`). Notices: `:153-160`.
- Helpers in `src/lib/alertShared.ts`: `UnreadLike` (`:33-36`), `UNREAD_PAGE_SIZE = 50` (`:39`), `mergeUnread` (`:50-60`), `pruneStreamed(streamed, resultIds, fetchSeq)` — keeps an entry that is in the result or has `seq >= fetchSeq` (`:62-68`), `drainUnread` (`:77-112`). `ALERTS_QUERY_KEY` / `ALERT_UNREAD_COUNT_KEY`: **Not found** in `src` or `e2e` (grep) — created by this step.
- 339's constraint for this step, in its own words: "the value under `ALERT_UNREAD_COUNT_KEY` is derived from the merged, de-duplicated unread list (D-5), never the server `unreadCount` plus a streamed delta (R-5). Mark-read and Clear all must invalidate it." (`docs/roadmap/features/339-fix-symbol-page-alerts-ui/design.md:194-196`; also `context.md:30,61`). It leaves "the single `refreshUnread()`, which 344 can swap for a `useQuery` / `invalidateQueries` pair" (`design.md:192-193`).
- A streamed alert that the stored-unread list does not return is dropped by the next fetch that starts after it arrived: `e2e/mock-backend.ts:687` says so ("unreadOnly must include ALERT_STREAM_ALL, or the drawer prunes streamed rows"). `ALERT_STREAM_HELD` is **not** in the mock's `unreadOnly` list (`e2e/mock-backend.ts:688-694`), and `e2e/trader/alert-stream.spec.ts:132-146` (`271 @AC-5`) needs its title visible in the open drawer after it streams in.
- `useInvalidatingMutation(mutationFn, invalidateKeys, options?: { mutationKey?, meta? })` invalidates each key on success only (`src/hooks/useInvalidatingMutation.ts:15-32`).
- `meta.errorHandled === true` is the only opt-out from the global mutation error fallback (`src/lib/mutationErrorStore.ts:37-39`; `src/lib/queryClient.ts:15-19`); the fallback renders `role="alert"` (`src/components/shared/MutationErrorFallback.tsx:30`).
- Query defaults: `staleTime: 5_000, retry: 1` (`src/lib/queryClient.ts:22`); `refetchOnWindowFocus` is the library default (on). One `QueryClient` per segment provider, held in `useState` (`src/app/trader/providers.tsx:10`, `src/components/shared/QueryProviders.tsx:13`), so the cache is shared inside a segment and not across segments.
- Inbox: local `alerts` / `unreadCount` / `loading` / `error` state and `refetch()` → `notifyClient.listAlerts({})` (`src/app/accounts/notifications/AlertInbox.tsx:14-35`); `markRead(alertIds)` calls `notifyClient.markAlertRead` then `refetch()` inside `try/catch`, error text into `error` (`:37-48`); "N unread" badge from `unreadCount` (`:58-60`); "Mark all read" (`:61-69`) and the per-row button (`:122-130`) both call `markRead`; skeleton on `loading` (`:74-79`).
- Alert page: after `getAlert` resolves, `notifyClient.markAlertRead({ alertIds: [res.alertId] }).then(() => { if (active) setMarkedRead(true); }).catch(() => {})` (`src/app/accounts/notifications/[alert_id]/AlertDetail.tsx:33-39`); `markedRead` feeds `alert-read-state` (`:76`).
- `markAlertRead` call sites in `src` today: `AlertStream.tsx:79`, `:93` (inside `drainUnread`), `AlertInbox.tsx:41`, `AlertDetail.tsx:35`.

**TDD**: `red-green required` — Step 20's badge-drop cases fail first.

**Covers**: `—`

**Instructions**:
0. 339 is merged at `573050534` (PR #1550), in this branch since `a900126ff`. The shape is the old spec's Case A; Case B (server-count badge) is dropped.
1. `src/lib/alertShared.ts` — export `ALERTS_QUERY_KEY = ['alerts'] as const` and `ALERT_UNREAD_COUNT_KEY = ['alerts', 'unread-count'] as const` (D-20). No other key constant: the inbox key is written as `[...ALERTS_QUERY_KEY, 'list']`.
2. **Bell read model** (`src/components/shared/AlertStream.tsx`) — swap `refreshUnread()` for the `useQuery` / `invalidateQueries` pair 339 left the seam for, and keep 339's derivation:
   - The stored-unread fetch becomes `useQuery` on `ALERT_UNREAD_COUNT_KEY`. Its query function increments `seqRef` and makes the same call as today (`listAlerts({ unreadOnly: true, limit: UNREAD_PAGE_SIZE })`), returning the alerts together with that fetch's `seq`, because `pruneStreamed` needs the sequence of the fetch that produced the result. `stored` is the query data's alerts (empty while there is none); the `stored` state, the manual `seq !== seqRef.current` guard and the mount effect go. When the query data changes, prune `streamed` with `pruneStreamed(prev, resultIds, seq)` as `:36-38` does today.
   - `fetchFailed` is the query's error state. With `retry: 1` the "Could not load alerts" notice appears after the retry, not at once.
   - `refreshUnread()` becomes one `queryClient.invalidateQueries({ queryKey: ALERT_UNREAD_COUNT_KEY })`; the drawer's `onOpenChange` keeps calling it on open.
   - The badge, `hasHighSeverity` and the drawer list keep `mergeUnread(stored, streamed, readIds)`; `readIds`, `pruneStreamed`, `drainUnread`, the `9+` display and the notices stay. The value under the key is the unread list, and the count is derived from the merged list (339's constraint).
   - **Stream handler — conservative reading, see Open decisions (1).** The `onItem` handler stays as 339 shipped it (`:57-64`): it adds the alert to the `streamed` buffer, de-duplicated on `alertId`, and does **not** invalidate the query. No cached count is incremented (R-13 holds: a re-delivered alert is dropped by the `alertId` check and by `mergeUnread`). design.md §8 / D-24 asks for an invalidation on message; with 339's prune that would drop a streamed alert the stored list does not return (`271 @AC-5`, `ALERT_STREAM_HELD`). Do not add the invalidation unless the operator rules for it.
   - Drawer per-row mark-read goes through `useInvalidatingMutation((alertIds: string[]) => notifyClient.markAlertRead({ alertIds }), [ALERTS_QUERY_KEY], { meta: { errorHandled: true } })`, called with `mutateAsync` inside the existing `try/catch`. Success adds the id to `readIds` and the mutation invalidates the prefix; the catch keeps `setMarkNotice('error')` and calls `refreshUnread()` so the list still re-syncs after a failure, as `:85` does today.
   - Clear all keeps `drainUnread` with direct `notifyClient` calls (it is not a mutation, so nothing reaches the global fallback) and ends with one `queryClient.invalidateQueries({ queryKey: ALERTS_QUERY_KEY })` in place of `await refreshUnread()` (`:99`).
3. **Inbox** (`AlertInbox.tsx`) — replace the local `alerts` / `unreadCount` / `loading` state and `refetch()` with `useQuery({ queryKey: [...ALERTS_QUERY_KEY, 'list'], queryFn: () => notifyClient.listAlerts({}) })` (D-23). `markRead` becomes a `useInvalidatingMutation((alertIds: string[]) => notifyClient.markAlertRead({ alertIds }), [ALERTS_QUERY_KEY], { meta: { errorHandled: true } })` called with `mutateAsync` inside the existing `try/catch`, which keeps the inbox's own error text (D-22); the empty-list early return (`:39`) stays. Keep every testid, the skeleton, the two `EmptyState`s, "Mark all read" and the "N unread" badge (from the query's `unreadCount`). The skeleton maps to `isLoading`, so it shows on the first load only and no longer flashes after a mark-read; the error text is the query error or the mark error.
4. **Alert page** (`AlertDetail.tsx`) — replace the direct `markAlertRead` call (`:34-39`) with the same `useInvalidatingMutation` (keys `[ALERTS_QUERY_KEY]`, `meta: { errorHandled: true }`), fired with `mutate([res.alertId], { onSuccess })` after a successful `GetAlert`; `onSuccess` sets `markedRead` under the same `active` guard. Failure stays silent (D-7, D-22). The `GetAlert` fetch itself is unchanged.
5. One invalidation of the `['alerts']` prefix now refreshes the bell badge, the drawer list, the inbox rows and the inbox "N unread" badge, whichever surface marked the alert read. Do not add a window event, a second refresh mechanism or a count-only invalidation for mark-read (R-8, R-11, R-12).
6. Behaviour changes to carry into the PR body and Step 23: the bell refetches on window focus and retries once (D-26); a focus refetch prunes streamed alerts the stored list does not return, as a drawer open already does; the inbox no longer shows its skeleton on a refetch.
7. Mutation opt-out audit (`fails.md`, fix-ui-trader-feedback): every `markAlertRead` call in `src` is either inside a `useInvalidatingMutation` that passes `errorHandled` (inbox, alert page, drawer row) or the `drainUnread` `mark` callback.

**Verification** (host e2e fallback form; CI's `frontend-e2e` is the confirming run):
```bash
set -euo pipefail
cd services/xstockstrat-ui
pnpm run lint
pnpm exec tsc --noEmit
pnpm run format:check
pnpm run test:coverage
test "$(grep -rn "export const ALERTS_QUERY_KEY\|export const ALERT_UNREAD_COUNT_KEY" src | cut -d: -f1 | sort -u)" = "src/lib/alertShared.ts"
grep -n "ALERT_UNREAD_COUNT_KEY" src/components/shared/AlertStream.tsx
grep -n "ALERTS_QUERY_KEY" src/components/shared/AlertStream.tsx src/app/accounts/notifications/AlertInbox.tsx "src/app/accounts/notifications/[alert_id]/AlertDetail.tsx"
test "$(grep -rn "errorHandled: true" src/components/shared/AlertStream.tsx src/app/accounts/notifications | wc -l)" -eq 3
test "$(grep -rn "markAlertRead" src --include=*.tsx | wc -l)" -eq 4
if grep -n "unreadCount" src/components/shared/AlertStream.tsx; then exit 1; fi
CI=1 NEXT_DISABLE_STANDALONE=1 pnpm exec playwright test e2e/accounts/notifications.spec.ts e2e/accounts/alert-detail.spec.ts e2e/trader/alert-stream.spec.ts e2e/trader/stream-reconnect.spec.ts e2e/alert-bell.spec.ts --project=chromium --no-deps --trace off
```
The 339 suite in `e2e/trader/alert-stream.spec.ts` (`@AC-3`, `@AC-4`, `@AC-5`, `@AC-9`, `@AC-10`) and `271 @AC-5` are the PRESERVE guard for the swap: all must pass unchanged.

---

### Step 20 — test: read-state e2e and the stateful fixture

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/helpers/alertReadState.ts` — modify
- `services/xstockstrat-ui/e2e/trader/alert-stream.spec.ts` — modify (the stub moves out)
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify
- `services/xstockstrat-ui/e2e/accounts/alert-read-state.spec.ts` — create

**Reviewers**: Service owner `xstockstrat-ui` — trading UI correctness, Connect-RPC call safety

**Codebase Evidence** (post-339 tree, `a900126ff`):
- The shared mock cannot prove a badge drop: `markAlertRead` stores nothing and its comment sends stateful assertions to `page.route()` (`e2e/mock-backend.ts:698-702`).
- **339 already shipped the stateful stub this step was going to write**: `stubNotify(page, stored, stream: 'held' | 'gated')` and its `DrawerAlert` type, local to `e2e/trader/alert-stream.spec.ts:26-86`. It routes `ListAlerts` (answers the unread set for `unreadOnly`, else every alert with `read`, and `unreadCount`, `:58-67`), `MarkAlertRead` (records `markedIds`, `:68-71`) and `StreamAlerts` (held, or one gated delivery, `:73-84`), and returns its state (`stored`, `streamed`, `markedIds`, `listCalls`, `streamAttempts`, `release`). It has no `GetAlert` route. A second stub with the same three routes would break the DRY guard rail — see Open decisions (2).
- Request shapes the stub must answer after Step 19: the bell and the drain send `{ unreadOnly: true, limit: 50 }` (`src/components/trader/AlertStream.tsx:34`; `src/lib/alertShared.ts:93`), the inbox sends `{}` (`AlertInbox.tsx:23`), the alert page sends `GetAlert { alertId }` then `MarkAlertRead { alertIds }` (`AlertDetail.tsx:27-35`).
- Fixtures that can be a `page.route` body as they are (Connect-JSON `createdAt`): `DRAWER_ALERT_STORED_UNREAD` (`alertId: 'alert-drawer-stored-unread'`, title "Backfill 67276d1f failed", `read: false`), `DRAWER_ALERT_STREAMED` (`e2e/fixtures/alerts.ts:128-162`). `ALERT_DETAIL` cannot: its `createdAt` is a bigint and needs the `alertJson` conversion (`e2e/accounts/alert-detail.spec.ts:43-50`). This step therefore seeds `DRAWER_ALERT_STORED_UNREAD`, not `ALERT_DETAIL`.
- Route paths and the error body shape: `GET_ALERT` / `MARK_READ` (`e2e/accounts/alert-detail.spec.ts:11-12`); a not-found answer is HTTP 404 with `code: 'not_found'` (`:30-39`).
- The inbox row and badge locators: `getByTestId('alert-row')` with `data-read`, `getByLabel('Unread count')`, the per-row button `Mark notification <title> read` (`AlertInbox.tsx:58,89-90,127`); the title link `list.getByRole('link', { name })` (`e2e/accounts/notifications.spec.ts:194-202`). The alert page: `getByTestId('alert-detail')`, `alert-read-state` (`AlertDetail.tsx:58,76`).
- The accounts header is rendered by the layout and does not remount on list → detail navigation (`src/app/accounts/layout.tsx:24-27`), so only an invalidation can refresh the badge there.
- 339's streamed-alert scenario is `@AC-5` "A streamed alert raises the badge without a reload" (`services/xstockstrat-ui/acceptance/fix-symbol-page-alerts-ui.feature:45-46`), tested at `e2e/trader/alert-stream.spec.ts:183-199`; the drawer-list case after a mark-read is `@AC-4` (`:164-181`).
- `e2e/helpers/alertReadState.ts` exists after Step 18 (`bellOf`, `badgeOf`). `e2e/accounts/alert-read-state.spec.ts`: **Not found** — created by this step.

**TDD**: `red-green required` — run the new spec against the pre-Step-19 commit first: the client-navigation, delayed-list and inbox-and-bell cases fail (the bell does not refresh).

**Covers**: `AC-6`

**Instructions**:
0. 339 is merged at `573050534` (PR #1550), in this branch since `a900126ff`.
1. `e2e/helpers/alertReadState.ts` — move `stubNotify` and `DrawerAlert` out of `e2e/trader/alert-stream.spec.ts:26-86` into this file, exported, behaviour unchanged for the existing callers; `alert-stream.spec.ts` imports them and keeps every test body. Then extend it:
   - a `GetAlert` route answering the stored or streamed alert with that `alertId` (with its current `read`), else HTTP 404 `{ code: 'not_found' }`;
   - an optional options argument: `holdFirstList` (the first `ListAlerts` response waits on a `gate()`; the state gains `releaseList()`), and `failMarkRead` (`MarkAlertRead` answers HTTP 500 and records nothing).
   The name `stubNotify` stays (339's callers); the old spec's `routeAlertReadState` name is not introduced.
2. `e2e/fixtures/INVENTORY.md` — extend the Step 18 helper row with `stubNotify` / `DrawerAlert` and their consumers, and add `e2e/accounts/alert-read-state.spec.ts` to the consumers of the 339 drawer-fixture row (`:55`) (D-12, C-12). No new fixture.
3. `e2e/accounts/alert-read-state.spec.ts` — every case seeds one unread alert (`DRAWER_ALERT_STORED_UNREAD`) through `stubNotify(page, [...], 'held')` unless it says otherwise, finds the bell with `bellOf` / `badgeOf`, and asserts badge **values only**, never request counts (D-26):
   - **`@AC-6` direct open** — `page.goto('/accounts/notifications/' + DRAWER_ALERT_STORED_UNREAD.alertId)`: the alert page renders and the bell on that page ends with no badge (`toHaveCount(0)`). Then `page.reload()` and `page.goto('/accounts/notifications')`: the row for the alert has `data-read="true"`.
   - **`@AC-6` client navigation** — `page.goto('/accounts/notifications')`, assert the bell badge is `1`, click the row title link; on the alert page the bell badge disappears without a reload. There is no `page.goto('/trader')` step (D-21).
   - **Delayed first `ListAlerts`** — with `holdFirstList`, open the alert page directly; wait until `markedIds` holds the id, then `releaseList()`; the bell must end with no badge, not at the stale `1`. Keep the page focused and do not blur the window, so the focus refetch does not mask a failure.
   - **Inbox and bell together (D-23)** — on `/accounts/notifications`, one "Mark read" click on the row takes the inbox badge to "0 unread" and removes the bell badge.
   - **Failed page-open mark-read (D-22)** — with `failMarkRead`: the alert page stays rendered, `alert-read-state` reads "Unread", and `page.getByRole('alert')` has count 0 (no global error banner).
   - **`@AC-1`/`@AC-3 @feature-203` PRESERVE** — on the direct-open path `markedIds` equals exactly `[DRAWER_ALERT_STORED_UNREAD.alertId]`: the page-open path sends no other mark.
4. **339's streamed-alert raise and drawer list (D-24)** are not duplicated here: `e2e/trader/alert-stream.spec.ts` `@AC-5` (`:183-199`) and `@AC-4` (`:164-181`) already assert them through the same stub and now run against the swapped read model. They are in this step's Verification; record in `context.md` that the re-assertion was done by running 339's own cases.

**Verification** (host e2e fallback form; CI's `frontend-e2e` is the confirming run):
```bash
set -euo pipefail
cd services/xstockstrat-ui
pnpm run lint
pnpm exec tsc --noEmit
grep -n "helpers/alertReadState" e2e/accounts/alert-read-state.spec.ts e2e/trader/alert-stream.spec.ts
grep -n "from '../fixtures/alerts'" e2e/accounts/alert-read-state.spec.ts
grep -n "stubNotify" e2e/fixtures/INVENTORY.md
test "$(grep -rln "async function stubNotify" e2e | tr '\n' ' ')" = "e2e/helpers/alertReadState.ts "
CI=1 NEXT_DISABLE_STANDALONE=1 pnpm exec playwright test e2e/accounts/alert-read-state.spec.ts --project=chromium --no-deps --trace off --repeat-each=3
CI=1 NEXT_DISABLE_STANDALONE=1 pnpm exec playwright test e2e/trader/alert-stream.spec.ts e2e/trader/stream-reconnect.spec.ts e2e/accounts e2e/alert-bell.spec.ts --project=chromium --no-deps --trace off
```
`--repeat-each=3` guards the delayed-response case against flake. The whole suite is CI's `frontend-e2e`.
No coverage threshold applies to Playwright e2e (`docs/patterns/ci-overview.md:29` lists none for `frontend-e2e`); the `src/lib/**` vitest gate (≥ 40%) is checked in Step 12.

---

### Step 21 — service: drawer row title links to the alert page

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/shared/AlertStream.tsx` — modify

**Reviewers**: Service owner `xstockstrat-ui` — trading UI correctness

**Codebase Evidence** (post-339 tree, `a900126ff`; lines are the file as 339 shipped it, before Steps 17 and 19 edit it — re-grep `a.title`):
- Drawer row: `<li key={a.alertId} className="rounded-lg border border-border bg-card p-3 space-y-1">` (`src/components/trader/AlertStream.tsx:169-172`), title `<p className="text-sm font-medium">{a.title}</p>` (`:179`), then 339's per-row button `aria-label={\`Mark read: ${a.title}\`}` (`:181-190`). The row is a plain `<li>`; the file has no `Link` / `href` (grep).
- "Clear all" is in the `SheetHeader` (`:139-147`); the empty state is the text "No alerts" (`:161-165`).
- The `Sheet` is **uncontrolled**: `<Sheet onOpenChange={(open) => { if (open) void refreshUnread(); }}>` with no `open` prop (`:103-107`). `SheetClose` is defined and exported by `src/components/ui/sheet.tsx` (`:18`, export block `:121`); `AlertStream.tsx` does not import it yet (`:8`).
- The link goes on the title, as in the inbox (`AlertInbox.tsx:111-115`), so no button is nested in an anchor (D-9, R-4).
- 339's tests find the title with `drawer.getByText(title)` and the button by its accessible name (`e2e/trader/alert-stream.spec.ts:157,171-173,215`); a link inside the `<p>` keeps both.

**TDD**: `red-green required` — Step 22 fails first (the drawer title is not a link).

**Covers**: `—`

**Instructions**:
0. 339 is merged at `573050534` (PR #1550), in this branch since `a900126ff`.
1. Import `Link` from `next/link` and add `SheetClose` to the existing `'../ui/sheet'` import. Wrap the title text of each drawer row, inside the existing `<p>`: `<SheetClose asChild><Link href={\`/accounts/notifications/${a.alertId}\`} className="hover:underline">{a.title}</Link></SheetClose>`.
2. `SheetClose asChild` is used on every segment, not only `/accounts/*`: the `Sheet` is uncontrolled, the `/accounts` header does not remount on navigation (`src/app/accounts/layout.tsx:24-27`), and closing on click is harmless where the shell remounts anyway. Do not make the `Sheet` controlled.
3. Leave the `<li>`, 339's "Mark read" button and its accessible name, "Clear all" and the notices unchanged.

**Verification** (host e2e fallback form; CI's `frontend-e2e` is the confirming run):
```bash
set -euo pipefail
cd services/xstockstrat-ui
pnpm run lint
pnpm exec tsc --noEmit
pnpm run format:check
grep -n "SheetClose asChild" src/components/shared/AlertStream.tsx
grep -n 'href={`/accounts/notifications/${a.alertId}`}' src/components/shared/AlertStream.tsx
CI=1 NEXT_DISABLE_STANDALONE=1 pnpm exec playwright test e2e/trader/alert-stream.spec.ts e2e/alert-bell.spec.ts e2e/accounts/alert-read-state.spec.ts --project=chromium --no-deps --trace off
```

---

### Step 22 — test: drawer link e2e

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/accounts/alert-read-state.spec.ts` — modify

**Reviewers**: Service owner `xstockstrat-ui` — trading UI correctness

**Codebase Evidence** (post-339 tree, `a900126ff`):
- The drawer is opened by `bellOf(page).click()` and read through `page.getByRole('dialog')` (`e2e/trader/alert-stream.spec.ts:155-156`); its rows are `getByRole('listitem')` (`:195`). After Step 18 `bellOf` / `badgeOf` come from `e2e/helpers/alertReadState.ts`; after Step 20 so does `stubNotify`, with a `GetAlert` route.
- 339's `@AC-3` "The Alerts drawer shows a stored unread alert that was not streamed" (`services/xstockstrat-ui/acceptance/fix-symbol-page-alerts-ui.feature:28-29`; test at `e2e/trader/alert-stream.spec.ts:150-162`) is what makes a stored alert appear in the drawer.
- The empty drawer shows the text "No alerts" (`src/components/trader/AlertStream.tsx:164`), asserted by 339 as `drawer.getByText('No alerts')` (`e2e/trader/alert-stream.spec.ts:174`).
- `e2e/accounts/alert-read-state.spec.ts` exists after Step 20 and seeds `DRAWER_ALERT_STORED_UNREAD`.

**TDD**: `red-green required` — run case 1 against the pre-Step-21 commit first: there is no link in the drawer row.

**Covers**: `AC-5`

**Instructions**:
0. 339 is merged at `573050534` (PR #1550), in this branch since `a900126ff`.
1. **`@AC-5`** — with one stored unread alert (`DRAWER_ALERT_STORED_UNREAD`) through `stubNotify(page, [...], 'held')`, on `/trader`: wait for the badge `1`, open the bell, click `page.getByRole('dialog').getByRole('link', { name: DRAWER_ALERT_STORED_UNREAD.title })`; assert the URL ends with `/accounts/notifications/alert-drawer-stored-unread` and `getByTestId('alert-detail')` contains the title.
2. **Drawer no longer lists it (D-24)** — on that alert page, after `markedIds` holds the id: the bell has no badge; open the bell and the drawer shows "No alerts".
3. **The drawer closes on `/accounts`** — start on `/accounts/notifications`, open the bell, click the drawer row's title link: the alert page is shown and `page.getByRole('dialog')` has count 0 (the header did not remount; `SheetClose` closed it).
4. **No nested interactive** — inside the open drawer, `page.getByRole('dialog').locator('a button')` has count 0, and the row still has its `Mark read: <title>` button.

**Verification** (host e2e fallback form; CI's `frontend-e2e` is the confirming run):
```bash
set -euo pipefail
cd services/xstockstrat-ui
pnpm run lint
pnpm exec tsc --noEmit
grep -n "@AC-5" e2e/accounts/alert-read-state.spec.ts
CI=1 NEXT_DISABLE_STANDALONE=1 pnpm exec playwright test e2e/accounts/alert-read-state.spec.ts e2e/trader/alert-stream.spec.ts --project=chromium --no-deps --trace off
CI=1 NEXT_DISABLE_STANDALONE=1 pnpm exec playwright test --project=chromium --no-deps --trace off
```
The last line is the whole suite, run once more now that Steps 17–22 are complete; the Step 18 note on host-only failures applies, and CI's `frontend-e2e` decides.
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

### Step 13 — RED probe held uncommitted; Verification run in a private namespace under CI mode (2026-11-15)
- **Planned**: Step 14's page spec fails first (the route is a 404); the Verification block runs on the host.
- **Actual**: (1) Step 13 and Step 14 do not land together and the page cases are Step 14's, so a temporary spec (`e2e/accounts/alert-page-probe.spec.ts`: `@AC-1` details, context rows and `Read`, `@AC-3` "No context fields", `@AC-2` "Alert not found") was run RED and GREEN, then deleted; it is not committed. RED failed on `getByTestId('alert-detail')` `element(s) not found` (3 failed). (2) The linked `node_modules` resolve `@xstockstrat/proto` to the main checkout's stubs, which lack `GetAlert`, and another worktree's e2e held port 9091 (first RED attempt: `EADDRINUSE 127.0.0.1:9091`), so each run went through `unshare -m -n`: loopback up, this branch's `packages/proto/gen/ts/dist` bind-mounted (namespace-only) over the main checkout's `dist`, and the egress proxy relayed in over a unix socket (`next/font` fetches Roboto at build). RED and GREEN ran with `CI=1` (production build), the Verification block with `CI=1 E2E_PREBUILT=1` on that build. The block itself ran verbatim; its closing `)` sits on its own line because its last line ends in a `#` comment. (3) The `PlatformHeader.tsx:94` edit was made as written (design.md §5); the operator keep/drop question on it (C-18) was not raised, under the standing "do not stop at checkpoints" authorization, and stays listed as unaddressed.
- **Disposition**: CI-equivalent fallback; TDD red/green evidence in `context.md` (F-09).

### Step 14 — RED against the pre-Step-13 tree; Verification run in a private namespace under CI mode (2026-11-15)
- **Planned**: every page case fails first (no route), then passes; the Verification block runs on the host.
- **Actual**: (1) Step 13 had already landed, so RED ran the step's Verification with `src/app/accounts/notifications/[alert_id]/` moved out of the worktree and `PlatformHeader.tsx` restored from `94a010bba` (the commit before Step 13), then both restored to the committed files. RED: all 10 new cases failed on `element(s) not found` (`getByTestId('alert-detail')` / `empty-state`), or `Received: undefined` for the `@AC-6` mark-read capture, and Playwright stopped at `maxFailures` 10. (2) The linked `node_modules` resolve `@xstockstrat/proto` to the main checkout's stubs, which lack `GetAlert`, so each run went through `unshare -m` with this branch's `packages/proto/gen/ts/dist` bind-mounted (namespace-only) over the main checkout's `dist`. RED ran with `CI=1` (production build). The first GREEN attempt failed before any test because another worktree's e2e held port 3000, so the build ran on its own (`CI=1 pnpm build`) and GREEN ran with `CI=1 E2E_PREBUILT=1` inside `unshare -m -n` with loopback brought up (no `ip` binary; a `SIOCSIFFLAGS` ioctl from Python). The block itself ran verbatim. (3) The block's last line is the closing `grep`, so `exit=0` on RED too; pass/fail was judged from the Playwright summary in the log.
- **Disposition**: CI-equivalent fallback; TDD red/green evidence in `context.md` (F-09).

### Step 15 — RED probe held uncommitted; Verification run in a private namespace under CI mode (2026-11-15)
- **Planned**: Step 16's click test fails first (the title is not a link); the Verification block runs on the host.
- **Actual**: (1) Step 15 and Step 16 do not land together and `e2e/accounts/notifications.spec.ts` is Step 16's file, so Step 16's `@AC-4` case (click the "Order rejected" link inside `alert-inbox-list`, expect `/accounts/notifications/alert-002` and the title in `alert-detail`) was added to that file in the working tree, run RED and GREEN through the Verification block, then reverted with `git checkout`; only `AlertInbox.tsx` is staged. RED failed on `waiting for getByTestId('alert-inbox-list').getByRole('link', { name: 'Order rejected' })` (test timeout). (2) The linked `node_modules` resolve `@xstockstrat/proto` to the main checkout's stubs, which lack `GetAlert`, so each run went through `unshare -m` with this branch's `packages/proto/gen/ts/dist` bind-mounted (namespace-only) over the main checkout's `dist`. The production bundle was built on its own (`CI=1 NEXT_DISABLE_STANDALONE=1 pnpm build`, mount namespace only, since `next/font` fetches at build), once before and once after the edit; each Verification run used `CI=1 E2E_PREBUILT=1` inside `unshare -m -n` with loopback brought up by a `SIOCSIFFLAGS` ioctl. The block itself ran verbatim; its closing `)` sits on its own line because its last line ends in a `#` comment.
- **Disposition**: CI-equivalent fallback; TDD red/green evidence in `context.md` (F-09).

### Step 16 — RED against the pre-Step-15 `AlertInbox.tsx`; Verification run in a private mount namespace under CI mode (2026-11-15)
- **Planned**: the `@AC-4` click test fails first (the title is not a link), then passes; the Verification block runs on the host.
- **Actual**: (1) Step 15 had already landed, so RED ran the step's Verification with `src/app/accounts/notifications/AlertInbox.tsx` temporarily restored from `9352362ec^`, then restored to the committed file; only the spec file is staged. RED: `@AC-4` failed on `waiting for getByTestId('alert-inbox-list').getByRole('link', { name: 'Order rejected' })` (test timeout, and again on retry), `1 failed`, `9 passed`. The `@AC-6 @feature-203` EXTEND guard passed at RED too: it is a characterisation that the link nests no button and leaves every row's module, body and "Mark read" intact. (2) The linked `node_modules` resolve `@xstockstrat/proto` to the main checkout's stubs, which lack `GetAlert`, so each build and run went through `unshare -m` with this branch's `packages/proto/gen/ts/dist` bind-mounted (namespace-only) over the main checkout's `dist`. Ports 3000 and 9091 were free, so no network namespace was used. The bundle was built on its own (`CI=1 NEXT_DISABLE_STANDALONE=1 pnpm build`) before RED and again after the restore; each Verification run used `CI=1 E2E_PREBUILT=1`. The block itself ran verbatim. (3) The block's last line is the closing `grep`, so `exit=0` on RED too; pass/fail was judged from the Playwright summary in the log.
- **Disposition**: CI-equivalent fallback; TDD red/green evidence in `context.md` (F-09).

### Step 17 — RED probe held uncommitted; per-entry linked `node_modules` on this branch's TS stubs; production build (2026-11-16)
- **Planned**: Step 18's `@AC-10` cases fail first (no bell outside `/trader`); the Verification block runs on the host in its e2e fallback form.
- **Actual**: (1) Step 17 and Step 18 do not land together and `e2e/alert-bell.spec.ts` is Step 18's file, so a temporary probe (`e2e/alert-bell-probe.spec.ts`: on `/trader`, `/insights/opportunities`, `/config-ui` and `/accounts/notifications`, the `banner` holds a visible bell `/^Alerts/` and the page has exactly one) ran RED and GREEN, then was deleted; it is not committed. RED: the three non-trader cases failed on `element(s) not found`, `3 failed`, `1 passed`; GREEN: `4 passed`. Each probe run used a separately built bundle (`CI=1 NEXT_DISABLE_STANDALONE=1 pnpm build`) and `CI=1 E2E_PREBUILT=1`. (2) The main checkout's `@xstockstrat/proto` lacks `getAlert`, so per the operator note `services/xstockstrat-ui/node_modules` in this worktree is a directory of per-entry links to the main checkout's entries, with `@xstockstrat/proto` linked to this worktree's `packages/proto/gen/ts` (its `node_modules` likewise per-entry linked); no namespace or bind mount. The Verification block ran verbatim (its `CI=1` line built and started the bundle itself). (3) The disconnected label and the 640–1024px header width were left as is: Step 18 adds the width check; Instruction 4 applies only if it fails there.
- **Disposition**: CI-equivalent fallback; TDD red/green evidence in `context.md` (F-09).

### Step 18 — operator-approved header change outside **Files**; RED on the pre-Step-17 tree (2026-11-16)
- **Planned**: Step 18 touches only its five e2e/INVENTORY files; the six D-19 cases (640/768/1024px on `/insights/opportunities` and `/accounts/notifications`) pass with the header as Step 17 left it; Step 17 Instruction 4 would fix any overflow inside `AlertStream`.
- **Actual**: (1) At 640px both pages scroll horizontally by 83px with the Step 17 header (`.sdd-logs/v-2.log`) and by 43px on the pre-Step-17 tree with no bell at all (`.sdd-logs/v-1.log`), so the Primary nav row, not the bell, is what does not fit; 768px and 1024px pass. Operator decision (2026-11-16, Option A, "Fix the header now (Recommended)"): `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx` wraps each Primary nav link label in `<span className="sr-only md:not-sr-only">`, so between 640px and 768px the five links (all of which have an icon) are icon-only and keep their accessible names; the bell is not hidden and nothing changes below 640px (the nav is `hidden sm:flex`) or from 768px up. It is committed with Step 18. After it, all six D-19 cases pass, the theme-bundle `shell.aria.yml` snapshot passes without re-recording, and nav-reachability passes (`.sdd-logs/v-3.log`). (2) RED ran the step's Verification with `src/components/trader/{AlertStream,AppShell}.tsx` and `src/components/shared/PlatformHeader.tsx` restored from `699b84715^` and `src/components/shared/AlertStream.tsx` set aside, then all four restored to the committed files. (3) `services/xstockstrat-ui/node_modules` is per-entry linked with `@xstockstrat/proto` on this worktree's stubs, as in Step 17. The block ran verbatim; its `CI=1` lines built and started the bundle themselves.
- **Disposition**: operator-approved scope expansion (one file outside **Files**); CI-equivalent fallback; TDD red/green evidence in `context.md` (F-09).

### Step 19 — RED/GREEN on an uncommitted probe; per-entry linked `node_modules` on this branch's TS stubs (2026-11-16)
- **Planned**: Step 20's badge-drop cases fail first (TDD line); the Verification block runs on the host in its e2e fallback form.
- **Actual**: (1) Step 19 and Step 20 do not land together and `e2e/accounts/alert-read-state.spec.ts` is Step 20's file, so a temporary probe (`e2e/accounts/alert-read-state-probe.spec.ts`: one unread `DRAWER_ALERT_STORED_UNREAD` behind inline `page.route` stubs; client navigation from the inbox title link to the alert page, then no bell badge; one inbox "Mark read", then "0 unread" and no bell badge) ran RED and GREEN with its own `CI=1 NEXT_DISABLE_STANDALONE=1 pnpm exec playwright test <probe>` command (not the Verification block, whose Playwright line does not name the probe), then was deleted; it is not committed. RED `.sdd-logs/v-1.log`: both cases failed on `badgeOf(page)` `Expected: 0` / `Received: 1`, `2 failed`; GREEN `.sdd-logs/v-2.log`: `2 passed (1.2m)`. (2) The main checkout's `@xstockstrat/proto` lacks `getAlert`, so, as in Steps 17–18, `services/xstockstrat-ui/node_modules` in this worktree is a directory of per-entry links to the main checkout's entries with `@xstockstrat/proto` linked to this worktree's `packages/proto/gen/ts` (its `node_modules` likewise per-entry linked); no install. (3) The Verification block ran verbatim on the committed tree (`.sdd-logs/v-3.log`, `exit=0`). (4) The stream handler stays as 339 shipped it (no invalidation on message), per the step's conservative reading; open decision 1 of the 2026-11-16 re-spec is still the operator's.
- **Disposition**: CI-equivalent fallback; TDD red/green evidence in `context.md` (F-09).

### Step 20 — fix outside **Files** in the shared invalidation helper; two test deviations; RED on the uncancelled helper (2026-11-16)
- **Planned**: Step 20 touches only its four e2e/INVENTORY files and adds tests only; the delayed-first-`ListAlerts` case seeds one alert and expects no badge; the failed-mark-read case asserts `page.getByRole('alert')` has count 0; RED runs the new spec against the pre-Step-19 commit.
- **Actual**: (1) **Scope expansion (operator Option A on the re-dispatched Step 20 blocker, 2026-11-16).** The delayed case found a real defect in Step 19's read model: TanStack Query's `invalidateQueries` reuses an in-flight fetch that has no data yet instead of starting a new one, so the first stored-unread `ListAlerts`, answered with its pre-mark state, settles the bell at the stale count. Fix: one shared helper `invalidateAlertReadModels(queryClient)` in `src/lib/alertShared.ts` calls `cancelQueries` on the `['alerts']` prefix, then `invalidateQueries`. The three mark-read sites (`AlertStream.tsx` per-row mutation and Clear all, `AlertInbox.tsx`, `AlertDetail.tsx`) call it from a `useMutation` `onSuccess` with `meta: { errorHandled: true }` in place of `useInvalidatingMutation`, which is unchanged. A vitest case in `src/lib/alertShared.test.ts` pins the race. Files outside **Files**: `src/lib/alertShared.ts`, `src/lib/alertShared.test.ts`, `src/components/shared/AlertStream.tsx`, `src/app/accounts/notifications/AlertInbox.tsx`, `src/app/accounts/notifications/[alert_id]/AlertDetail.tsx`. Step 19's audit still holds: 3 `errorHandled: true` mutations plus the `drainUnread` `mark` callback, 4 `markAlertRead` sites. (2) **Delayed case (accepted by the orchestrator, reported to the operator):** it seeds two unread alerts (`DRAWER_ALERT_STORED_UNREAD`, `DRAWER_ALERT_CLEAR_A`) and expects the badge `1`. The specced one-alert "no badge" form cannot fail: no badge also holds before any `ListAlerts` has answered. The stale answer shows `2`. It is a normal test (no `test.fail`, no `fixme`). (3) **Error-banner assertion (accepted by the orchestrator, reported to the operator):** `page.getByRole('alert').filter({ hasText: /\S/ })` has count 0. The bare `getByRole('alert')` fails on every run because Next's route announcer is an empty `role="alert"`. (4) **RED**: the unit case on the helper without `cancelQueries` timed out (`.sdd-logs/v-1.log`, the invalidation awaited the held first fetch); the e2e spec on the same tree failed only the delayed case, `Expected: "1"` / `Received: "2"`, `1 failed`, `4 passed` (`.sdd-logs/v-4.log`). The client-navigation and inbox cases were not re-run against the pre-Step-19 commit in this session; their pre-Step-19 RED is Step 19's probe (`Received: 1`, recorded in `context.md`). (5) `services/xstockstrat-ui/node_modules` is per-entry linked with `@xstockstrat/proto` on this worktree's stubs, as in Steps 17–19; the Verification block ran verbatim with `CI=1` (its Playwright lines built and started the bundle themselves). Before that, `prettier --write` reformatted one assertion in the new spec (its own line).
- **Disposition**: operator-approved scope expansion (five files outside **Files**); two orchestrator-accepted test deviations; CI-equivalent fallback; TDD red/green evidence in `context.md` (F-09).
