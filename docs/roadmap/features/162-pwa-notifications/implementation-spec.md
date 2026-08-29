# Implementation Spec: pwa-notifications

**Status**: `pending`
**Created**: 2026-08-29
**Feature**: `docs/roadmap/features/162-pwa-notifications/feature.md`
**Total Steps**: 12
**Feature Branch**: `feature/pwa-notifications` (harness develops on `claude/pwa-notifications-2eggrc`, from/to `main-dev`)

---

## Execution Summary

Ship Web Push as a **third, disjoint, best-effort fanout channel** in `xstockstrat-notify` plus the
PWA plumbing that makes `xstockstrat-ui` installable and able to render OS notifications when closed,
per `design.md` (Chosen Approach, `design-approved`). Order is contract-first: the additive proto and
its codegen (Steps 1–2) precede the notify service change (Step 5), because `registerPushSubscription`/
`unregisterPushSubscription` surface automatically through the regenerated `createNotifyServiceDefinition()`
(`serviceDefinition.ts:4-6`). The two migrations (Steps 3–4) are independent and can land any time
before deploy; they live in **two different services' `migrations/` dirs** (ledger 2026-08-26 trap).
The notify service (Step 5) + its Node test (Step 6) carry the whole backend behavior — the
`WebPushDispatcher`, the register/unregister handlers, the second `queueMicrotask`, and the 404/410
prune. The UI lands in two `service` steps: PWA plumbing (Step 7, paired test Step 8) then the enable
control + BFF (Step 9, paired test Step 10). Secret/env wiring (Step 11) must complete VAPID across
**every** deploy site in the same PR (ledger 2026-08-19 `finnhub-key` trap). Docs (Step 12) close the
context-scrubber loop.

**Consumer surface (C-14):** the product spec names exactly one — **UI** (`/accounts/notifications`
enable control, reachable from the shared shell). Steps 7–10 land it. No Agent surface (product spec
marks it `[ ] Agent — no MCP tool change`); no separate step required.

## Scenario Coverage (Constitution C-15)

| Scenario | Covered by step(s) |
|---|---|
| `@AC-1` app installable / standalone manifest / SW controls all 4 segment scopes | Step 8 (UI PWA test) |
| `@AC-2` enabling persists per-user subscription + upsert (no duplicate) | Step 6 (notify: captured upsert SQL), Step 10 (BFF register-ownership) |
| `@AC-3` disabling removes the subscription (delete-by-endpoint) | Step 6 (notify: captured DELETE SQL), Step 10 (UI disable flow) |
| `@AC-4` emitted alert pushed to target's devices; EmitAlertResponse returns without waiting | Step 6 (notify) |
| `@AC-5` push never fails or delays the primary emit | Step 6 (notify) |
| `@AC-6` push disabled when VAPID keys absent | Step 6 (notify) |
| `@AC-7` min-severity gate suppresses low-severity pushes | Step 6 (notify) |
| `@AC-8` a Gone (404/410) subscription is pruned | Step 6 (notify) |
| `@AC-9` clicking a push notification focuses/opens the app | Step 8 (UI: sw.js `notificationclick` logic) |

## Step Dependencies

- Step 2 (`proto-gen`) requires Step 1 (`proto`): stubs regenerate from the edited `.proto`.
- Step 5 (notify service) requires Step 2: the register/unregister handler method names and request
  shapes come from the regenerated `NotifyServiceService` / `*_pb` types.
- Step 6 (notify test) covers Step 5 (`service`) — Constitution C-08 pairing.
- Step 7 (UI PWA plumbing) requires Step 11's `VAPID_PUBLIC_KEY` env var **name** to exist in the UI
  run sites, but not its value (push stays disabled without it). Steps 7 and 11 may land together;
  Step 7's `VapidKeyProvider` reads `process.env.VAPID_PUBLIC_KEY` at request time.
- Step 8 (UI PWA test) covers Step 7.
- Step 9 (UI control + BFF) requires Step 2 (regenerated `notify_pb` for the browser `notifyClient`
  calls) and Step 7 (the `VapidKeyProvider` it consumes to subscribe).
- Step 10 (UI control test) covers Step 9.
- Step 11 (VAPID secret/env wiring) is required before any deploy actually pushes; independent of the
  code steps but must be in the same PR (secret-wiring trap).
- Step 12 (docs) after 5/9/11 so it documents the landed config key + env vars.

---

### Step 1 — proto: additive RegisterPushSubscription / UnregisterPushSubscription

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/notify/v1/notify.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness per message, non-breaking (no field removal/type change), `buf lint`/`buf breaking` pass; xstockstrat-notify — RPC contract; xstockstrat-ui — browser consumer of the new RPCs

**Codebase Evidence**:
- Existing service block: `packages/proto/notify/v1/notify.proto` `service NotifyService { rpc EmitAlert…; rpc StreamAlerts…; rpc AcknowledgeAlert…; rpc ListAlerts…; }` (confirmed via full read of the file).
- `AcknowledgeAlertResponse { bool success = 1; }` is the response-with-a-bool precedent to mirror for `UnregisterPushSubscriptionResponse { bool deleted = 1; }`.
- All messages use `proto3`, `snake_case` fields, fresh field numbers per message.

**TDD**: `N/A (proto — non-code-bearing; verification is buf lint/breaking)`

**Covers**: —

**Instructions**:
1. Add two RPCs to `service NotifyService` (additive, after `ListAlerts`):
   ```proto
   rpc RegisterPushSubscription(RegisterPushSubscriptionRequest) returns (RegisterPushSubscriptionResponse);
   rpc UnregisterPushSubscription(UnregisterPushSubscriptionRequest) returns (UnregisterPushSubscriptionResponse);
   ```
2. Add four new messages (design.md § Proto), each with fresh field numbers starting at 1:
   ```proto
   message RegisterPushSubscriptionRequest {
     string user_id = 1;      // filled by the BFF from the verified session — never trusted from the browser body
     string endpoint = 2;
     string p256dh = 3;
     string auth = 4;
     string user_agent = 5;
   }
   message RegisterPushSubscriptionResponse { string subscription_id = 1; }
   message UnregisterPushSubscriptionRequest { string endpoint = 1; }   // no user_id — delete by endpoint (design Decision 1)
   message UnregisterPushSubscriptionResponse { bool deleted = 1; }
   ```
3. Do **not** touch any existing message/enum/RPC — additive only (C-09 non-breaking; the four new
   `string` fields are open runtime values, correctly not enums — C-04).

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against ".git#branch=main-dev"
```
Both must pass (C-09). `buf breaking` against `main-dev` proves the additive change is non-breaking.

---

### Step 2 — proto-gen: regenerate stubs

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/ts/**`, `packages/proto/gen/python/**`, `packages/proto/gen/go/**` — modify (generated; do not hand-edit)

**Reviewers**: Proto Reviewer — inherited from Step 1; xstockstrat-notify; xstockstrat-ui

**Codebase Evidence**:
- Root CLAUDE.md § Generating Proto Stubs: `./scripts/buf-gen.sh` generates TS/Python/Go and compiles the TS package; CI `proto-freshness` enforces an empty diff afterward.
- notify TS consumers import from `@xstockstrat/proto/notify/v1/notify` (`serviceDefinition.ts:1`, `notifyServiceImpl.ts:3`) and the browser from `@xstockstrat/proto/notify/v1/notify_pb` (`browserClients/notifyClient.ts:3`, `e2e/mock-backend.ts:24`).

**TDD**: `N/A (generated output)`

**Covers**: —

**Instructions**:
1. Run `./scripts/buf-gen.sh` from repo root. Commit the regenerated stubs under `packages/proto/gen/`.
2. Do not hand-edit generated files.

**Verification**:
```bash
./scripts/buf-gen.sh && git status --porcelain packages/proto/gen/ | head
```
After a fresh run the working tree under `packages/proto/gen/` must be exactly the regenerated output
(no residual diff on a second run — mirrors CI `proto-freshness`).

---

### Step 3 — migration: notify `002_push_subscriptions`

**Status**: `pending`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/migrations/002_push_subscriptions.up.sql` — create
- `services/xstockstrat-notify/migrations/002_push_subscriptions.down.sql` — create

**Reviewers**: DBA — migration NNN numbering (no gap/conflict), up+down pair, index correctness, no hypertable needed; xstockstrat-notify — schema ownership

**Codebase Evidence**:
- Last notify migration is `001_notify_alerts.up.sql` → **next NNN = `002`** (confirmed `ls services/xstockstrat-notify/migrations/` → `000_schema`, `001_notify_alerts`).
- Style to mirror (`001_notify_alerts.up.sql`): `CREATE SCHEMA IF NOT EXISTS notify;`, `CREATE TABLE IF NOT EXISTS`, `UUID PRIMARY KEY DEFAULT gen_random_uuid()`, snake_case, `TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `CREATE INDEX IF NOT EXISTS …`.
- Migrations run via golang-migrate (`scripts/db-migrate.sh`), **not** the notify `migrate` npm script (notify CLAUDE.md § Running Locally).
- F-01: `002` is a new file — never edit `001`.

**TDD**: `N/A (migration — offline structural verification only)`

**Covers**: —

**Instructions**:
1. `002_push_subscriptions.up.sql` — mirror `001` style:
   ```sql
   CREATE TABLE IF NOT EXISTS notify.push_subscriptions (
       subscription_id  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
       user_id          TEXT         NOT NULL,
       endpoint         TEXT         NOT NULL UNIQUE,
       p256dh           TEXT         NOT NULL,
       auth             TEXT         NOT NULL,
       user_agent       TEXT,
       created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
   );
   CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON notify.push_subscriptions (user_id);
   ```
   `endpoint` is `UNIQUE` — it is the upsert conflict target and the delete key (design Decisions 1/2).
   No hypertable (low-volume relational table; product spec § Database Changes).
2. `002_push_subscriptions.down.sql`:
   ```sql
   DROP TABLE IF EXISTS notify.push_subscriptions;
   ```
   (The index is dropped with the table.)

**Verification** (offline, no DB — spec-template § "Migration step verification is offline"):
```bash
ls services/xstockstrat-notify/migrations/002_push_subscriptions.up.sql \
   services/xstockstrat-notify/migrations/002_push_subscriptions.down.sql
```
Then read both: confirm the `CREATE TABLE` + `CREATE INDEX` in `.up` are reversed by the `DROP TABLE`
in `.down`, and that `endpoint` carries `UNIQUE`.

---

### Step 4 — migration: config seed `021_notify_push_min_severity`

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/021_notify_push_min_severity.up.sql` — create
- `services/xstockstrat-config/migrations/021_notify_push_min_severity.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair; xstockstrat-config — config key naming (`notify.push.min_severity`), env scoping (`staging`/`production`, `user_id` NULL = global), `value_type` matches the reader getter

**Codebase Evidence**:
- Last config migration is `020_remove_analysis_signal_source_weights` → **next NNN = `021`** (confirmed `ls services/xstockstrat-config/migrations/`).
- Seed precedent is feature 020's `018_notify_fanout.up.sql` (read in full): `INSERT INTO config.config_values (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id) VALUES (…) ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;` — one row per environment (`'staging'`, `'production'`), `user_id NULL`.
- The `key` column carries the **full dotted key** the notify watcher reads with no namespace prefix added (`018` header comment) — must equal `notify.push.min_severity`.
- `value_type` must be `'int'` to match `ConfigWatcher.getInt` (ledger migration-016 value-type-immutability trap; notify reads via `getInt` — Step 5).
- Ledger 2026-08-26 trap: this seed is a **config-service** migration; the `push_subscriptions` table (Step 3) is a **notify** migration. Do not merge them.

**TDD**: `N/A (migration — offline structural verification only)`

**Covers**: —

**Instructions**:
1. `021_notify_push_min_severity.up.sql` — mirror `018_notify_fanout.up.sql`, seeding one key across
   two environments (namespace `notify`, `value_type 'int'`, value `'2'`, `consuming_service
   'xstockstrat-notify'`):
   ```sql
   INSERT INTO config.config_values
     (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id)
   VALUES
     ('notify', 'notify.push.min_severity', 'int', '2',
      'Web Push gate: minimum AlertSeverity ordinal to send a Web Push (0=UNSPECIFIED,1=INFO,2=WARNING,3=ERROR,4=CRITICAL). Clamped to [0,4] at read. Mirrors notify.fanout.min_severity; default 2 (WARNING) excludes INFO fill confirmations.',
      '2', 'xstockstrat-notify', 'staging', NULL),
     ('notify', 'notify.push.min_severity', 'int', '2',
      'Web Push gate: minimum AlertSeverity ordinal to send a Web Push (0=UNSPECIFIED,1=INFO,2=WARNING,3=ERROR,4=CRITICAL). Clamped to [0,4] at read. Mirrors notify.fanout.min_severity; default 2 (WARNING) excludes INFO fill confirmations.',
      '2', 'xstockstrat-notify', 'production', NULL)
   ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
   ```
2. `021_notify_push_min_severity.down.sql` — mirror `018_notify_fanout.down.sql`:
   ```sql
   DELETE FROM config.config_values
    WHERE namespace = 'notify'
      AND key = 'notify.push.min_severity';
   ```
3. Do **not** seed any VAPID row here — VAPID are `type: SECRET`/env credentials, never `config_values`
   (config `@AC-2`/`@AC-10` PRESERVE; F-07 honored — the key is read live, the secrets are env).

**Verification** (offline, no DB):
```bash
ls services/xstockstrat-config/migrations/021_notify_push_min_severity.up.sql \
   services/xstockstrat-config/migrations/021_notify_push_min_severity.down.sql
```
Then read both: the `.up` INSERT of `notify.push.min_severity` (two env rows) is reversed by the
`.down` DELETE of the same key; `value_type` is `'int'`; `ON CONFLICT … DO NOTHING` present.

---

### Step 5 — service: notify WebPushDispatcher + register/unregister handlers + emitAlert wiring

**Status**: `pending`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/fanout/webPush.ts` — create (new `WebPushDispatcher` class)
- `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts` — modify (two new handler methods; second `queueMicrotask`; constructor gains the dispatcher)
- `services/xstockstrat-notify/src/index.ts` — modify (construct + inject `WebPushDispatcher`)
- `services/xstockstrat-notify/package.json` — modify (add `web-push` dep + `@types/web-push` devDep)

**Reviewers**: xstockstrat-notify — stream delivery guarantees (primary emit never blocked/delayed), best-effort isolation, alert dedup semantics unchanged

**Codebase Evidence**:
- `FanoutDispatcher` structure to mirror (`src/fanout/fanout.ts`): const `FANOUT_HTTP_TIMEOUT_MS = 3000` at `:18` (sanctioned non-config timeout — F-07 carve-out); `class FanoutDispatcher` `:46`; constructor reads creds from env once `:51-54`; `async dispatch(alert)` `:57`; live config `this.config.getInt('notify.fanout.min_severity', 2)` clamped `[0,4]` `:61`; full-body `try { … } catch (e) { log.warn(…) }` `:57-108`; per-channel `send*` with `AbortController` + `setTimeout(abort, TIMEOUT)` `:120-144`.
- Config getter to reuse: `ConfigWatcher.getInt(key, def)` `src/services/configWatcher.ts:89`.
- emitAlert wiring: `notifyServiceImpl.ts:97-100` success callback; `:106-110` existing `queueMicrotask(() => void this.fanout.dispatch(alert).catch(…))`; the `alert` object (with `targetUserId`) built `:69-82`; constructor `:22-26` (`pool`, `config`, `fanout`).
- Injection site: `index.ts:45` `const fanout = new FanoutDispatcher(configWatcher);` → `:46` `const notifyImpl = new NotifyServiceImpl(pool, configWatcher, fanout);`. `pool` created `:33-38` (`max: DB_POOL_MAX ?? 1` — F-06: no new pool, reuse this `pool`).
- Handler auto-surface: `createNotifyServiceDefinition()` returns `NotifyServiceService` (`serviceDefinition.ts:4-6`); once Step 2 regenerates it with the two RPCs, adding `registerPushSubscription`/`unregisterPushSubscription` methods on `NotifyServiceImpl` exposes them (same node-style `(call, callback)` signature as `acknowledgeAlert` `:148`, `listAlerts` `:160`).
- `web-push` is **not** currently a dependency (confirmed `grep web-push services/xstockstrat-notify/package.json` → no hit); `pg` is `^8.11.5` `:30`.
- Ledger 2026-08-26 insight (folded into design Decision 3): a best-effort side-channel must dispatch
  **after** the success callback via `queueMicrotask`, not merely inside a try/catch.
- Feature 162 insight (`insights.md:2506-2514`): `web-push` throws synchronously per send if
  `vapidDetails.subject` is not `mailto:`/`https:` — validate at startup, fail-loud/disable, never a
  silent per-send black-hole.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Dependency (F-08 / DRY):** add `"web-push"` to `dependencies` and `"@types/web-push"` to
   `devDependencies` in `services/xstockstrat-notify/package.json`, then `cd services/xstockstrat-notify
   && pnpm install` to update `pnpm-lock.yaml` in the same PR. (Node/pnpm workspace — no `uv.lock`.)
2. **`webPush.ts` — `WebPushDispatcher`** mirroring `FanoutDispatcher` (disjoint class, shares no state
   with fanout — design Rejected Alternative "Extend FanoutDispatcher"):
   - Module-level `const WEBPUSH_HTTP_TIMEOUT_MS = 10000;` (sanctioned non-config send timeout; push
     endpoints are slower than Slack — mirrors the `FANOUT_HTTP_TIMEOUT_MS` carve-out).
   - Constructor `(private readonly pool: Pool, private readonly config: ConfigWatcher)`. Read VAPID
     once from env: `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` (all `?.trim() || ''`).
     Compute `this.vapidConfigured = !!priv && !!pub && !!subject && /^(mailto:|https:)/.test(subject);`
     If all three present **but** subject malformed → `log.error(...)` **once** here and leave
     `vapidConfigured=false` (design Decision 3 — avoids the per-send throw). When `vapidConfigured`,
     call `webpush.setVapidDetails(subject, pub, priv)` once.
   - `async dispatch(alert: FanoutAlert): Promise<void>` — full-body `try { … } catch (e) {
     log.warn('push dispatch rejected', { alertId: alert.alertId, channel: 'push', error: … }); }`
     that never rethrows:
     - If `!this.vapidConfigured` → `return;` (FR-5 / `@AC-6`).
     - `const minSev = clamp(this.config.getInt('notify.push.min_severity', 2), 0, 4);` and skip when
       the alert's numeric severity `< minSev` (FR-5 / `@AC-7`). Convert the alert's string-enum
       severity to a number with `alertSeverityToNumber` (already imported in `notifyServiceImpl.ts:3`;
       import from `@xstockstrat/proto/notify/v1/notify`).
     - Load target subscriptions: `alert.targetUserId` non-empty → `SELECT subscription_id, endpoint,
       p256dh, auth FROM notify.push_subscriptions WHERE user_id = $1` (params `[alert.targetUserId]`);
       empty → `SELECT … FROM notify.push_subscriptions` (broadcast, all rows). Reuse the injected
       `pool` — **no new pool** (F-06).
     - **Sequential** send loop (design: one row per device, already off the hot path). Per row call a
       private `sendOne(row, payload)` with its own try/catch. Build the JSON payload
       `{ title: alert.title, body: alert.body, url?: <deep-link if present>, icon: '/icon-192.png' }`
       and `await webpush.sendNotification({ endpoint, keys: { p256dh, auth } }, JSON.stringify(payload))`.
     - **Prune on Gone (FR-6 / `@AC-8`):** in `sendOne`'s catch, if the thrown error's `statusCode`
       is `404` or `410` → `await this.pool.query('DELETE FROM notify.push_subscriptions WHERE endpoint = $1', [row.endpoint])`. Any other error → `log.warn(..., { alertId, channel: 'push' })`, no
       rethrow (extends notify `@AC-6`). **Open risk (design):** confirm `web-push`'s thrown error
       exposes `.statusCode` (the `WebPushError` shape) when adding the dep; if the field name differs,
       record the confirmed accessor in `context.md` and use it.
   - Add the two register/unregister DB helpers as methods here **or** inline in the servicer (see 3).
3. **`notifyServiceImpl.ts`:**
   - Constructor: add `private readonly webPush: WebPushDispatcher` as a fourth param (after `fanout`).
   - After the existing fanout `queueMicrotask` (`:106-110`), add a **second** `queueMicrotask`:
     ```ts
     queueMicrotask(() =>
       void this.webPush.dispatch(alert).catch((e: any) =>
         log.warn('push dispatch rejected', { alertId, error: e?.message ?? String(e) }),
       ),
     );
     ```
     This inherits the exact after-success-callback isolation contract (FR-3 / `@AC-4`/`@AC-5`;
     notify `@AC-1`/`@AC-4` PRESERVE).
   - Add two node-style handler methods (same `(call, callback)` shape as `acknowledgeAlert` `:148`):
     - `async registerPushSubscription(call, callback)` — `const { userId, endpoint, p256dh, auth, userAgent } = call.request;` then upsert (design Decision 2, full SET):
       ```sql
       INSERT INTO notify.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (endpoint) DO UPDATE
         SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh,
             auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent, created_at = NOW()
       RETURNING subscription_id
       ```
       `callback(null, { subscriptionId: rows[0].subscription_id })`. On error `callback({ code: 13, message: err.message })` (matches the numeric-13 style at `:113`,`:156`,`:171`).
     - `async unregisterPushSubscription(call, callback)` — `DELETE FROM notify.push_subscriptions WHERE endpoint = $1` (params `[call.request.endpoint]`), `callback(null, { deleted: (result.rowCount ?? 0) > 0 })`. **No `user_id` bind** (design Decision 1 / Rejected Alternative — endpoint reassignment would strand a user-scoped delete).
4. **`index.ts`:** after `:45` add `const webPush = new WebPushDispatcher(pool, configWatcher);` and pass
   it as the fourth arg at `:46`: `new NotifyServiceImpl(pool, configWatcher, fanout, webPush)`. Import
   `WebPushDispatcher` from `./fanout/webPush`.

**Verification** (behavioral + prune + isolation are asserted in the paired Step 6; here confirm build):
```bash
cd services/xstockstrat-notify && pnpm run build   # tsc must compile the new dispatcher + handlers
```
(Lint + coverage run in Step 6.)

---

### Step 6 — test: notify push channel + register/unregister

**Status**: `pending`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/__tests__/webPush.test.ts` — create
- `services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts` — modify (register/unregister + second-microtask isolation cases)
- `services/xstockstrat-notify/src/__tests__/fixtures/pushSubscription.ts` — create **only if** a push-subscription domain literal gains a second consumer across the two test files (C-13; see Instructions)

**Reviewers**: xstockstrat-notify — coverage of isolation contract, prune, gates

**Codebase Evidence**:
- Test harness (compile-first, static import + "import succeeded" assertion — feature 092): notify
  CLAUDE.md § Authorization; `package.json:12-13` (`test` / `test:coverage` = `tsc && node --test dist/__tests__/*.test.js`, c8 `--lines 40`).
- Existing patterns to reuse: `fanout.test.ts` stubs `globalThis.fetch` + a fake `ConfigWatcher` + a cred env dance (`:26-60`); `notifyServiceImpl.test.ts` uses `emitAndFlush` (double `setTimeout(0)` to drain the microtask) `:305-313` and a `makePool` fake `:39-46` that **ignores SQL** (so assert on **captured SQL shape**, not row counts — design Decision 6).
- No `src/__tests__/fixtures/` dir exists yet (confirmed) — C-13: create one only on the **second**
  consumer of a shared literal; a single-consumer inline literal is compliant.

**TDD**: `red-green required` (author to fail against the pre-Step-5 tree)

**Covers**: `AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8`

**Instructions**:
1. **`webPush.test.ts`** — stub `web-push` (mock `sendNotification` to resolve, or reject with an
   object carrying `statusCode`), a fake `ConfigWatcher` (`getInt` returns a controllable
   `min_severity`), and a `makePool` fake capturing every `query(sql, params)` call:
   - `@AC-6`: VAPID env unset → `dispatch(alert)` performs **no** `sendNotification` call and does not
     throw.
   - `@AC-7`: `min_severity=2`, VAPID configured, alert severity INFO (1) → no send; a second dispatch
     with WARNING (2) → one send per subscription row.
   - `@AC-4`: `targetUserId='user-42'` with 2 subscription rows returned by the pool fake → exactly 2
     `sendNotification` calls carrying the payload `title`/`body`.
   - `@AC-8`: `sendNotification` rejects with `{ statusCode: 410 }` → the captured SQL includes
     `DELETE FROM notify.push_subscriptions WHERE endpoint = $1` with the offending endpoint as the
     single positional param; `dispatch` still resolves (no throw).
   - `@AC-5`: `sendNotification` rejects with a network error (no `statusCode`) → `dispatch` resolves
     (caught + WARN), no rethrow, no DELETE.
   - Malformed subject (Decision 3): all three VAPID present but `VAPID_SUBJECT='not-a-url'` →
     `vapidConfigured` false, no send.
2. **`notifyServiceImpl.test.ts`** (extend):
   - `@AC-2`: call `registerPushSubscription` with a request → captured SQL matches
     `INSERT … ON CONFLICT (endpoint) DO UPDATE SET user_id=…, p256dh=…, auth=…, user_agent=…, created_at=NOW()`
     with the full column list and 5 positional params; a **second** identical call issues the same
     upsert (asserting the ON CONFLICT clause is present — the fake can't prove row-uniqueness, so
     assert the clause, per Decision 6).
   - `@AC-3`: `unregisterPushSubscription({ endpoint })` → captured SQL is
     `DELETE FROM notify.push_subscriptions WHERE endpoint = $1` with a **single** positional param and
     **no `user_id`** bind.
   - `@AC-5` isolation: an `emitAlert` whose `webPush.dispatch` rejects still returns the `alertId` via
     the success callback and still writes to in-process subscribers — reuse `emitAndFlush` to drain
     both microtasks; assert the callback fired with `alertId` before/independently of the push
     rejection (the existing fanout isolation cases at `:344-373` are the template).
3. **C-13:** the register/unregister request literal and the subscription-row literal each start with
   one consumer. If the same subscription-row shape is needed in **both** `webPush.test.ts` and
   `notifyServiceImpl.test.ts`, move it to `src/__tests__/fixtures/pushSubscription.ts` (+ a one-line
   catalog note) in this step; otherwise keep inline and record "single consumer — inline compliant"
   in the step's execution note.

**Verification**:
```bash
cd services/xstockstrat-notify && pnpm run lint && pnpm run test:coverage
```
Lint clean; `test:coverage` (`c8 --lines 40`) passes the 40% threshold with the new cases executing
(non-zero assertions — feature-074 zero-assertion trap: confirm the new `webPush.test.ts` cases run,
e.g. by momentarily breaking one and watching it go red).

---

### Step 7 — service: UI PWA plumbing (manifest, service worker, icons, layout, headers, middleware, Dockerfile, VAPID public-key bridge)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/public/manifest.webmanifest` — create
- `services/xstockstrat-ui/public/sw.js` — create
- `services/xstockstrat-ui/public/icon-192.png`, `icon-512.png`, `icon-512-maskable.png` — create
- `services/xstockstrat-ui/src/app/layout.tsx` — modify (metadata: `manifest`, `themeColor`, `icons`)
- `services/xstockstrat-ui/src/app/ServiceWorkerRegistrar.tsx` — create (`'use client'` root-scope SW registration)
- `services/xstockstrat-ui/next.config.js` — modify (add `headers()` for `/sw.js` + `/manifest.webmanifest`)
- `services/xstockstrat-ui/src/middleware.ts` — modify (matcher negative-lookahead adds sw/manifest/icons)
- `services/xstockstrat-ui/Dockerfile` — modify (copy `public/` into the standalone runner)
- `services/xstockstrat-ui/src/app/accounts/AgentUrlContext.tsx` — reference only (pattern to copy)
- `services/xstockstrat-ui/src/app/accounts/VapidKeyContext.tsx` — create (`'use client'` provider/hook)

**Reviewers**: xstockstrat-ui — Connect-RPC call safety, no secret values rendered in UI (VAPID **public** key only), env scope correctness

**Codebase Evidence**:
- `public/` does **not** exist today (recon finding 3; `src/app/icon.svg` is the only icon).
- Root layout metadata `src/app/layout.tsx:8-11` has only `title`/`description` — **no** `icons`/`manifest`/`themeColor`; `<html lang="en">` `:15`.
- `next.config.js` (read in full): `output: 'standalone'` unless `NEXT_DISABLE_STANDALONE` `:7`; has `redirects()` `:16` + `rewrites()` `:24-35`; **no `headers()`, no `basePath`** — a new `headers()` async fn must be added.
- Middleware matcher `src/middleware.ts:12-19`: negative-lookahead excludes `_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|api/auth/login|api/auth/refresh|api/health|health|auth/login|auth/oauth-login|\.well-known|api/oauth` — **does not** exclude `/sw.js`, `/manifest.webmanifest`, or the icon PNGs (they would hit the auth gate → redirect to `/auth/login` `:34-38`).
- Dockerfile (read in full): runner copies `.next/standalone` `:24` + `.next/static` `:25` — **no `public/` copy** (Next standalone does not auto-include `public/`; recon finding 10). CMD `node services/xstockstrat-ui/server.js` `:26`.
- Server-env → browser bridge precedent (**not** `NEXT_PUBLIC_*`): `accounts/layout.tsx` `export const dynamic = 'force-dynamic'` `:15`, reads `process.env.AGENT_PUBLIC_URL` `:19`; `accounts/AgentUrlContext.tsx:8-22` (`'use client'` `createContext`/provider/hook). Mirror exactly for `VAPID_PUBLIC_KEY`.
- SW must be served from **root** to control all four segment scopes (`/trader`, `/insights`, `/config-ui`, `/accounts`) — no `basePath`, so root registration covers all (recon "Service-worker scope").

**TDD**: `red-green required` (paired Step 8)

**Covers**: — (behaviors verified in Step 8)

**Instructions**:
1. `public/manifest.webmanifest`: `{ "name": "xstockstrat", "short_name": "xstockstrat", "display": "standalone", "start_url": "/trader", "theme_color": <token hex>, "background_color": <token hex>, "icons": [ {192, "image/png"}, {512, "image/png"}, {512, "image/png", "purpose": "maskable"} ] }` (FR-1). Generate the three PNGs from the existing brand mark (`src/app/icon.svg`) at 192/512.
2. `public/sw.js` (hand-written, no `next-pwa` — design Rejected Alternative):
   - `self.addEventListener('push', (event) => { … })` — parse `event.data?.json()` inside try/catch,
     fall back to `{ title: 'xstockstrat', body: 'You have a new alert' }`; **always** call
     `event.waitUntil(self.registration.showNotification(title, { body, icon: '/icon-192.png', data: { url }, tag }))` (the `userVisibleOnly` obligation). Set a **deterministic `tag`** on both the
     success and fallback paths (from payload `alertId`, or `category` on fallback — design Decision 4;
     record honestly that `tag` coalesces only same-tag *visible* notifications, not content-hash dedup).
   - `self.addEventListener('notificationclick', (event) => { … })` — `event.notification.close()`;
     `event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => { const url = event.notification.data?.url || '/trader'; for (const w of wins) if (w.url.includes(url) && 'focus' in w) return w.focus(); return clients.openWindow(url); }))` (`@AC-9`).
   - Factor the click-resolution into a small pure helper (e.g. `pickClient(wins, url)`) so Step 8 can
     unit-test the focus-vs-open decision.
3. `layout.tsx` metadata (`:8-11`): add `manifest: '/manifest.webmanifest'`, `themeColor: <token>`,
   `icons: { icon: '/icon-192.png', apple: '/icon-192.png' }`. Render `<ServiceWorkerRegistrar />` inside
   `<body>` (`:16`).
4. `ServiceWorkerRegistrar.tsx` (`'use client'`): in a `useEffect`, `if ('serviceWorker' in navigator)
   navigator.serviceWorker.register('/sw.js')` (root scope → controls all four segments). Guard for
   unsupported browsers (no-op).
5. `next.config.js`: add `async headers() { return [ { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] }, { source: '/manifest.webmanifest', headers: [{ key: 'Cache-Control', value: 'no-cache' }] } ]; }` (design Decision 5 — an updated SW/manifest always reaches clients).
6. `middleware.ts` matcher (`:19`): add `sw.js|manifest\.webmanifest|icon-192\.png|icon-512\.png|icon-512-maskable\.png` to the negative-lookahead group so these are served publicly (SW can register; `@AC-1`).
7. `Dockerfile`: after the `.next/static` copy (`:25`), add
   `COPY --from=builder /workspace/services/xstockstrat-ui/public ./services/xstockstrat-ui/public`
   (standalone drops `public/` — recon finding 10). Follow the Dockerfile update workflow (root CLAUDE.md).
8. `accounts/VapidKeyContext.tsx`: copy `AgentUrlContext.tsx` verbatim, renaming to `VapidKeyProvider`/
   `useVapidKey`. Wire it in `accounts/layout.tsx` (already `force-dynamic`, already reads `process.env`)
   by reading `process.env.VAPID_PUBLIC_KEY ?? ''` and wrapping children in `<VapidKeyProvider>` — the
   **public** key only, never the private key (no secret rendered in UI). Env var name introduced in Step 11.

**Verification** (build + structure; behavior in Step 8):
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm run build
grep -n "sw.js\|manifest.webmanifest" src/middleware.ts next.config.js
grep -n "COPY.*public" Dockerfile
```
Lint clean, build succeeds; the middleware matcher and `next.config.js headers()` reference both
`sw.js` and `manifest.webmanifest`; the Dockerfile copies `public/`.

---

### Step 8 — test: UI PWA (manifest served, SW scope, notificationclick logic)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/pwa.spec.ts` — create (Playwright: manifest reachable + shape)
- `services/xstockstrat-ui/src/lib/sw-click.test.ts` — create (vitest unit: `pickClient` focus-vs-open) — **or** colocate the pure helper under `src/lib/` so vitest coverage (`src/lib/**`) sees it

**Reviewers**: xstockstrat-ui — analytics/UI correctness, no secret rendered

**Codebase Evidence**:
- Playwright e2e home `e2e/` with `mock-backend.ts`, `helpers/auth.ts` (`addAuthCookie`/`addAdminCookie`), `global-setup.ts`; unit tests are vitest, `src/**/*.test.ts`, coverage scoped to `src/lib/**` (root CLAUDE.md § Language Versions — Vitest, feature 065).
- `package.json`: `test:e2e` = `playwright test` `:15`; `test:unit` = `vitest run` `:17`.
- `nav-reachability.spec.ts` is the C-10(a) reachability template (`:1-40`) — reused in Step 10.
- Middleware excludes `/manifest.webmanifest` after Step 7, so it is fetchable without auth.

**TDD**: `red-green required` (author to fail against the pre-Step-7 tree — e.g. manifest 404s / redirects to login today)

**Covers**: `AC-1, AC-9`

**Instructions**:
1. `pwa.spec.ts` (`@AC-1`): fetch `/manifest.webmanifest` (unauthenticated is fine — it's excluded from
   the auth gate); assert HTTP 200, `display === 'standalone'`, icons include 192 and 512 with a
   `purpose: 'maskable'` entry. Assert the served page registers a service worker at root scope (e.g.
   `page.goto('/trader')` then evaluate `navigator.serviceWorker.getRegistration()` resolves with a
   root `scope` covering `/trader`, `/insights`, `/config-ui`, `/accounts`). If the Playwright
   webserver build (`NEXT_DISABLE_STANDALONE`) does not serve `public/` identically, assert the
   manifest route + `sw.js` 200 and note SW-registration coverage is structural.
2. `sw-click.test.ts` (`@AC-9`): unit-test the pure `pickClient(wins, url)` helper extracted in Step 7 —
   given a window list containing a URL matching `/trader/positions/AAPL`, it returns that window to
   focus; given none, it returns `null`/falls through to `openWindow(url)`. This isolates the
   focus-vs-open decision from the service-worker global (which Playwright cannot easily drive).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm run test:unit && pnpm run test:e2e -- pwa.spec.ts
```
Unit + the `pwa` e2e spec pass; both assert new behavior (fail on the pre-Step-7 tree). No coverage
threshold on `xstockstrat-ui` (spec-template table) — e2e + unit are the gate.

---

### Step 9 — service: UI enable/disable control + nav registration + BFF register/unregister

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/accounts/notifications/page.tsx` — create (Settings-group page)
- `services/xstockstrat-ui/src/app/accounts/notifications/PushToggle.tsx` — create (`'use client'` control)
- `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx` — modify (`PLATFORM_SUBNAV.accounts` gains Notifications)
- `services/xstockstrat-ui/src/components/shared/navGroups.tsx` — modify (Settings group gains Notifications)
- `services/xstockstrat-ui/src/lib/traderBff.ts` — modify (extend the `router.service(NotifyService, {…})` block)

**Reviewers**: xstockstrat-ui — Connect-RPC call safety, config mutation safety (IDOR guard on register), no secret rendered, C-17 tokens/primitives, C-10(a) nav registration

**Codebase Evidence**:
- The consumer surface (C-14): product spec § Consumer Surface(s) marks **UI** required — a Settings-group control reachable from the shared shell.
- Nav — **two** surfaces both list the existing accounts pages (must update both, C-10(a)):
  - `PLATFORM_SUBNAV.accounts` `PlatformHeader.tsx:91-95` → Profile / Authorized Apps / MCP Tools.
  - `NAV_GROUPS` Settings group `navGroups.tsx:80-96` → Profile / … / Authorized apps / MCP tools.
- BFF block to extend: `traderBff.ts:119-128` `router.service(NotifyService, { async *streamAlerts(req, ctx) { const claims = await requireSession(ctx); yield* notifyClient.streamAlerts({ ...req, userId: claims.user_id }, { headers: backendHeaders(claims, ctx), signal: ctx.signal }); }, listAlerts: forward(...) })`. `streamAlerts` **injects** `userId: claims.user_id` — the IDOR-guard pattern to copy for register.
- BFF helpers: `requireSession` `bffShared.ts:32,68`; `forward` `:63`; `backendHeaders` `:41`; dispatch `createDispatch(router, '/trader/api')` `traderBff.ts:182`.
- Browser client already exists and is guarded: `browserClients/notifyClient.ts:5-6` = `createClient(NotifyService, makeBrowserTransport('/trader/api'))` (auth-refresh interceptor — ui-auth `@AC-5`/`@AC-6` PRESERVE). Step 2 regenerates `notify_pb` so `notifyClient.registerPushSubscription`/`unregisterPushSubscription` exist.
- VAPID public key: `useVapidKey()` from Step 7's `VapidKeyContext` (provider already wired in `accounts/layout.tsx`).
- C-17 primitives available: `ui/switch.tsx`, `ui/card.tsx`, `EmptyState`, `CardNotice`, `QueryStateMessages` (design Decision 8; `docs/patterns/ui-ux-governance.md`).
- **Cross-segment reuse four facts re-verified** (design Open Risk — the UI "Sanctioned exception"):
  (i) `.do/app.yaml` ingress is a single `/` catch-all to `xstockstrat-ui` with only `/agent` split off
  (`.do/app.yaml:12-20`) — `/accounts` and `/trader/api` reach the same component; (ii) session cookies
  are `path: '/'` (`src/lib/auth.ts:76,83`); (iii) `requireSession` re-checks per dispatch
  (`bffShared.ts:32,68`); (iv) `notifyClient` base is root-relative `'/trader/api'`
  (`notifyClient.ts:5`). All four hold → the `/accounts/notifications` page may reuse `notifyClient`.

**TDD**: `red-green required` (paired Step 10)

**Covers**: — (behaviors verified in Step 10)

**Instructions**:
1. `page.tsx` (server component under the `force-dynamic` accounts layout): render `PushToggle` inside a
   `ui/card` shell; page chrome via canonical primitives only (C-17 — no hardcoded colors).
2. `PushToggle.tsx` (`'use client'`): read `useVapidKey()`. Reflect the four states (design Decision 8):
   - unsupported (`!('serviceWorker' in navigator)` or `!('PushManager' in window)`) → `EmptyState`.
   - blocked (`Notification.permission === 'denied'`) → `CardNotice variant="error"`.
   - enabled (an existing `pushManager.getSubscription()`) → `CardNotice variant="muted"` + `Switch` on.
   - default → `Switch` + copy. Mutation loading/error → `QueryStateMessages`.
   - **Enable flow (FR-2):** `Notification.requestPermission()`; on `granted`,
     `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: <VAPID_PUBLIC_KEY, base64url→Uint8Array> })`; POST `subscription.toJSON()` fields via
     `notifyClient.registerPushSubscription({ endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: navigator.userAgent })` — **do not send `userId`** (the BFF injects it, step 5 below).
   - **Disable flow (FR-2 / `@AC-3`):** `subscription.unsubscribe()` then
     `notifyClient.unregisterPushSubscription({ endpoint })`.
   - The `Switch` needs a unique accessible name: `aria-label="Enable push notifications"` (C-17).
3. `PlatformHeader.tsx` `PLATFORM_SUBNAV.accounts` (`:91-95`): add
   `{ label: 'Notifications', href: '/accounts/notifications', match: 'exact' }`.
4. `navGroups.tsx` Settings group `items` (`:80-96`): add
   `{ label: 'Notifications', href: '/accounts/notifications' }`.
5. `traderBff.ts` NotifyService block (`:119-128`): add two entries alongside `streamAlerts`/`listAlerts`:
   - `registerPushSubscription` **injects the session user** (IDOR guard — design; never `forward`, which
     would let the browser spoof `user_id`):
     ```ts
     async registerPushSubscription(req, ctx) {
       const claims = await requireSession(ctx);
       return notifyClient.registerPushSubscription(
         { ...req, userId: claims.user_id },
         { headers: backendHeaders(claims, ctx) },
       );
     },
     ```
   - `unregisterPushSubscription: forward((req, opts) => notifyClient.unregisterPushSubscription(req, opts))`
     (endpoint-only, no user to inject — design Decision 1; accepted-risk recorded in design Open Risks).

**Header propagation (C-03 / step-constraints §B):** the register handler forwards
`x-user-id`/`x-access-scope`/`x-trace-id` via `backendHeaders(claims, ctx)` (the same mechanism
`streamAlerts` uses at `traderBff.ts:124`); `forward()` applies `backendHeaders` internally
(`bffShared.ts:63-73`). No new propagation mechanism.

**Verification** (build + structure; behavior in Step 10):
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm run build
grep -n "Notifications" src/components/shared/PlatformHeader.tsx src/components/shared/navGroups.tsx
grep -n "registerPushSubscription\|unregisterPushSubscription" src/lib/traderBff.ts
```
Lint clean, build succeeds; both nav surfaces list Notifications; the BFF block registers both RPCs
(register injects `claims.user_id`).

---

### Step 10 — test: UI enable/disable + BFF register-ownership + nav-reachability

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/accounts/notifications.spec.ts` — create
- `services/xstockstrat-ui/e2e/nav-reachability.spec.ts` — modify (add the Settings Notifications item)
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (add NotifyService register/unregister handlers)
- `services/xstockstrat-ui/src/lib/traderBff.test.ts` — create **or** extend an existing BFF unit test (vitest) for the register-ownership assertion — **or** assert ownership via the e2e mock capturing the injected `userId`

**Reviewers**: xstockstrat-ui — reachability, IDOR guard coverage

**Codebase Evidence**:
- `mock-backend.ts` already has a `router.service(NotifyService, { streamAlerts, listAlerts })` block (`:377-415`) — extend it with `registerPushSubscription`/`unregisterPushSubscription` handlers that **capture** the received request (to assert the BFF-injected `userId`).
- C-12/C-13: UI test data comes from `e2e/fixtures/` (+ `INVENTORY.md`); `helpers/auth.ts` for auth. A new push-subscription fixture object gets a fixture module + `INVENTORY.md` row **only** if reused across specs; a single-spec one-off stays inline (record the verdict).
- `nav-reachability.spec.ts:22+` — the `GROUPS` array walked by the reachability test; the Settings
  group's items are asserted reachable with `aria-current="page"`.
- Ledger 2026-07-01 (060) trap: a new page must be reachable by **walking** the shell, not direct-URL.

**TDD**: `red-green required` (author to fail against the pre-Step-9 tree)

**Covers**: `AC-2, AC-3` (plus C-10(a) nav reachability)

**Instructions**:
1. `notifications.spec.ts`:
   - `@AC-2` (BFF register-ownership — design Decision 7): with `addAuthCookie` for `user-42`, drive the
     enable flow (stub the browser Push API / permission where needed) so the BFF calls the mock
     `registerPushSubscription`; assert the **mock captured `userId === 'user-42'`** even though the
     browser body omitted it — proving the BFF stamps the session user (the thing that makes the
     subscription belong to the right user; IDOR guard).
   - `@AC-3` (disable): drive the disable flow; assert the mock `unregisterPushSubscription` received the
     `endpoint` and **no** `userId`.
   - Cover the unsupported/blocked state rendering (EmptyState / CardNotice) as UI assertions.
2. `nav-reachability.spec.ts`: add `{ label: 'Notifications', href: '/accounts/notifications' }` to the
   Settings group entry so the page is proven reachable by walking the shell with `aria-current="page"`
   (C-10(a); closes the 060 trap).
3. `mock-backend.ts`: extend the NotifyService block (`:377`) with the two handlers, storing the last
   request for the spec to read.
4. Record the C-12/C-13 verdict: name any reused fixture (+ `INVENTORY.md` row) or state
   "single-consumer inline literal — compliant".

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm run test:e2e -- notifications.spec.ts nav-reachability.spec.ts
grep -n "from '../fixtures'\|from './fixtures'\|helpers/auth" e2e/accounts/notifications.spec.ts
```
Both specs pass and assert new behavior (fail on the pre-Step-9 tree); the notifications spec imports
auth/fixtures per C-12 (or records the single-consumer verdict). No coverage threshold on `xstockstrat-ui`.

---

### Step 11 — config: VAPID secret + env wiring through every deploy site

**Status**: `pending`
**Service**: `xstockstrat-notify` (`VAPID_PRIVATE_KEY` secret + `VAPID_PUBLIC_KEY` + `VAPID_SUBJECT`), `xstockstrat-ui` (`VAPID_PUBLIC_KEY`)
**Files**:
- `docker-compose.yml` — modify (notify block: all three; ui block: `VAPID_PUBLIC_KEY`)
- `.do/app.dev.yaml` — modify (notify component: `VAPID_PRIVATE_KEY` `type: SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`; ui component: `VAPID_PUBLIC_KEY`)
- `.do/app.yaml` — modify (same, prod placeholders)
- `.github/workflows/deploy.yml` — modify (reusable `secrets:` input + env + sed/python passthrough for `VAPID_PRIVATE_KEY`)
- `.github/workflows/deploy-dev.yml` — modify (`VAPID_PRIVATE_KEY: ${{ secrets.DEV_VAPID_PRIVATE_KEY }}`)
- `.github/workflows/deploy-prod.yml` — modify (`VAPID_PRIVATE_KEY: ${{ secrets.PROD_VAPID_PRIVATE_KEY }}`)
- `scripts/do-inject-prod-secrets.py` — modify (placeholder→env mapping for `VAPID_PRIVATE_KEY`)
- `.env.example` — modify (VAPID vars with a note: empty ⇒ push disabled locally)

**Reviewers**: Security — new `type: SECRET` credential wiring follows the vendor-credential deploy path, no plaintext secret in config rows, VAPID **private** key never rendered/logged; Platform Lead — env-var naming, deploy-pipeline completeness; xstockstrat-notify; xstockstrat-ui

**Codebase Evidence** (SLACK/SENDGRID is the exact precedent to mirror — feature 020/076):
- `docker-compose.yml:207` `xstockstrat-notify:` block; `:225-226` `SLACK_WEBHOOK_URL: ${SLACK_WEBHOOK_URL:-}` / `SENDGRID_API_KEY: ${SENDGRID_API_KEY:-}`.
- `.do/app.dev.yaml:369` `- name: xstockstrat-notify`; `:398-405` `- key: SLACK_WEBHOOK_URL` / `value: YOUR_DEV_SLACK_WEBHOOK_URL` / `type: SECRET` (+ SENDGRID). `.do/app.yaml:367,396-403` prod equivalents (`YOUR_PROD_*`).
- `deploy.yml:37-44` reusable `secrets:` inputs (`SLACK_WEBHOOK_URL`, `SENDGRID_API_KEY`, "Optional"); `:62-63` env; `:72-73` sed passthrough; `:84-92` python `content.replace('YOUR_DEV_…'/'YOUR_PROD_…', value)`.
- `deploy-dev.yml:52-53` `SLACK_WEBHOOK_URL: ${{ secrets.DEV_SLACK_WEBHOOK_URL }}`; `deploy-prod.yml:51-52` `PROD_*`.
- `scripts/do-inject-prod-secrets.py:43-44` `("YOUR_PROD_SLACK_WEBHOOK_URL", "SLACK_WEBHOOK_URL")`.
- `.env.example` currently documents secrets go in `.env` (not `.env.example`) — SLACK/SENDGRID absent there. VAPID_PUBLIC_KEY/SUBJECT are non-secret; add all three with a comment that empty ⇒ push disabled.
- Ledger 2026-08-19 `finnhub-key` trap: a new secret env var that misses **one** site ships working-locally/broken-on-deploy — enumerate every site here (product spec § Feature Workflow Notes).
- Env-var naming: `VAPID_PRIVATE_KEY` / `VAPID_PUBLIC_KEY` / `VAPID_SUBJECT` are service-local credential env vars (not the `_ENDPOINT` inter-service form) — same class as `SLACK_WEBHOOK_URL`.

**TDD**: `N/A (deploy/config wiring — YAML + workflow + env; no unit-testable code)`

**Covers**: — (enables `@AC-4`/`@AC-6` at deploy time; the disabled-when-absent behavior is unit-tested in Step 6)

**Instructions**:
1. Generate one VAPID keypair (`npx web-push generate-vapid-keys`) and choose a `VAPID_SUBJECT`
   (`mailto:` or `https:` URL). Record the **public** key + subject; the private key is a secret — set it
   in DO / GitHub Secrets, never committed. Note in `context.md` that operators must set the real values
   in DigitalOcean before push works (push stays disabled until present — design).
2. `docker-compose.yml` notify block (after `:226`): add
   `VAPID_PRIVATE_KEY: ${VAPID_PRIVATE_KEY:-}`, `VAPID_PUBLIC_KEY: ${VAPID_PUBLIC_KEY:-}`,
   `VAPID_SUBJECT: ${VAPID_SUBJECT:-}`. In the `xstockstrat-ui` service block add
   `VAPID_PUBLIC_KEY: ${VAPID_PUBLIC_KEY:-}` (UI needs only the public key).
3. `.do/app.dev.yaml` + `.do/app.yaml` notify component `envs`: add `VAPID_PRIVATE_KEY`
   (`value: YOUR_DEV_VAPID_PRIVATE_KEY` / `YOUR_PROD_…`, `type: SECRET`), `VAPID_PUBLIC_KEY` and
   `VAPID_SUBJECT` (plain — non-secret, can carry the real public value/subject). Add `VAPID_PUBLIC_KEY`
   to the `xstockstrat-ui` component `envs` in both files.
4. `deploy.yml`: add `VAPID_PRIVATE_KEY` to the reusable `secrets:` block (Optional, mirroring
   `SLACK_WEBHOOK_URL` `:37-41`); to the env `:62-63`; to the sed passthrough `:72-73`; and a
   `content.replace('YOUR_DEV_VAPID_PRIVATE_KEY', …)` + `'YOUR_PROD_VAPID_PRIVATE_KEY'` in the python
   block `:84-92`. (Public key + subject are non-secret placeholders replaced by literal values, so they
   need no secret passthrough — but keep their placeholders substitutable if you keep them as
   placeholders.)
5. `deploy-dev.yml:52` add `VAPID_PRIVATE_KEY: ${{ secrets.DEV_VAPID_PRIVATE_KEY }}`;
   `deploy-prod.yml:51` add `VAPID_PRIVATE_KEY: ${{ secrets.PROD_VAPID_PRIVATE_KEY }}`.
6. `scripts/do-inject-prod-secrets.py:43` add `("YOUR_PROD_VAPID_PRIVATE_KEY", "VAPID_PRIVATE_KEY")`.
7. `.env.example`: add a VAPID section documenting `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`, and that
   `VAPID_PRIVATE_KEY` is a secret set via `.env` (not committed); empty ⇒ push disabled locally.
8. **DO egress note** (design Open Risk): notify gains new outbound HTTPS to FCM/Mozilla/Apple push
   endpoints — record in `context.md` that the DO App Platform egress policy permits arbitrary outbound
   HTTPS (no allow-list to update), matching the existing Slack/SendGrid outbound.

**Verification**:
```bash
grep -n "VAPID_PRIVATE_KEY\|VAPID_PUBLIC_KEY\|VAPID_SUBJECT" \
  docker-compose.yml .do/app.dev.yaml .do/app.yaml \
  .github/workflows/deploy.yml .github/workflows/deploy-dev.yml .github/workflows/deploy-prod.yml \
  scripts/do-inject-prod-secrets.py .env.example
```
Confirm: `VAPID_PRIVATE_KEY` appears in **all eight** files (the secret-wiring checklist — none missed);
`VAPID_PUBLIC_KEY` appears in the notify **and** ui blocks of docker-compose and both app specs;
`type: SECRET` marks `VAPID_PRIVATE_KEY` in both `.do/app*.yaml`.

---

### Step 12 — docs: config key log, service CLAUDE.md, DigitalOcean secret table

**Status**: `pending`
**Service**: `docs/`
**Files**:
- `docs/patterns/config-governance.md` — modify (Per-Feature Registered Keys log: `notify.push.min_severity`)
- `services/xstockstrat-notify/CLAUDE.md` — modify (Config Keys Consumed row + Environment Variables VAPID block)
- `services/xstockstrat-ui/CLAUDE.md` — modify (PWA section: manifest/sw.js/icons, `VAPID_PUBLIC_KEY` env, install behavior, iOS home-screen note)
- `docs/setup/digitalocean.md` — modify (GitHub-Actions secrets table: `DEV_VAPID_PRIVATE_KEY` / `PROD_VAPID_PRIVATE_KEY`)

**Reviewers**: none (docs)

**Codebase Evidence**:
- notify CLAUDE.md § Config Keys Consumed already tables `notify.fanout.*` (read in full) — add a
  `notify.push.min_severity` row in the same shape; § Environment Variables lists `SLACK_WEBHOOK_URL` /
  `SENDGRID_API_KEY` as `type: SECRET` with the deploy-pipeline note — add the VAPID block there.
- `docs/patterns/config-governance.md` holds the Per-Feature Registered Keys log (root CLAUDE.md § Config Governance Rules).
- `docs/setup/digitalocean.md` has the GitHub-Actions secrets table (product spec § Feature Workflow Notes; secret-wiring checklist).
- Teardown rule (root CLAUDE.md § Teardown): after changing these context/docs files, run
  `/context-scrubber scan` scoped to what was touched and fix grounded findings before the PR; if the
  context-forge plugin is unavailable, say so in the PR body.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. `config-governance.md` Per-Feature Registered Keys: add feature 162's `notify.push.min_severity`
   (int, default 2, consuming `xstockstrat-notify`, seeded by config migration `021`).
2. notify CLAUDE.md: add the `notify.push.min_severity` row to § Config Keys Consumed; add
   `VAPID_PRIVATE_KEY` (`type: SECRET`) / `VAPID_PUBLIC_KEY` / `VAPID_SUBJECT` to § Environment Variables
   with the same "delivered through the full deploy pipeline, never config rows; empty ⇒ push disabled"
   note the Slack/SendGrid block carries; document the new `push_subscriptions` table + the Web Push
   third-channel behavior (best-effort, after success callback, 404/410 prune) alongside the fanout note.
3. ui CLAUDE.md: add a PWA section (manifest/`sw.js`/icons served from `public/` at root scope; the
   Dockerfile `public/` copy; `VAPID_PUBLIC_KEY` runtime env bridged via `VapidKeyContext`, never
   `NEXT_PUBLIC_*`; the Settings-group `/accounts/notifications` control; iOS requires home-screen
   install for Web Push — Out of Scope, documented).
4. `docs/setup/digitalocean.md`: add `DEV_VAPID_PRIVATE_KEY` / `PROD_VAPID_PRIVATE_KEY` to the
   GitHub-Actions secrets table (mirroring `*_SLACK_WEBHOOK_URL`).

**Verification**:
```bash
grep -n "notify.push.min_severity" docs/patterns/config-governance.md services/xstockstrat-notify/CLAUDE.md
grep -n "VAPID" services/xstockstrat-notify/CLAUDE.md services/xstockstrat-ui/CLAUDE.md docs/setup/digitalocean.md
```
All four docs reference the new key / VAPID env vars. Run `/context-scrubber scan` (scoped) and fix
grounded findings, or note plugin-unavailable in the PR body.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
