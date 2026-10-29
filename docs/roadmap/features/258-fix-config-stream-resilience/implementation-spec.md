# Implementation Spec: fix-config-stream-resilience

**Status**: `pending`
**Created**: 2026-10-22
**Feature**: `docs/roadmap/features/258-fix-config-stream-resilience/feature.md`
**Total Steps**: 9
**Feature Branch**: `feature/fix-config-stream-resilience`

---

## Execution Summary

This is a SEV-2 Track C fix scoped to D-05, D-06, D-35 and D-58. It follows design.md § Chosen Approach exactly.
The design's rejected alternatives are not used: no dedicated `pg.Client`, no `EventNotifier` reuse, no keepAlive,
no `SELECT 1` keepalive, no version gate, no DELTA buffer, no `UNAVAILABLE` code, no shared error helper, and no
soft start. The fix adds no proto, migration, config key, env var, port or `src/index.ts` edit (recon.md
§ Dependencies).

- **Steps 1–6 (config)** all edit the same file, `services/xstockstrat-config/src/grpc/configServiceImpl.ts`, so
  they run in order. Each service step is followed by its paired test step in
  `src/__tests__/configServiceImpl.test.ts` (design.md § Build order).
  - Steps 1–2: the LISTEN lifecycle (FR-1, FR-2).
  - Steps 3–4: the unary handlers (FR-3).
  - Steps 5–6: WatchConfig registration and broadcast termination (FR-4, FR-5).
- **Steps 7–8 (ledger)** cover `appendEvent` (FR-3). They do not depend on the config steps.
- **Step 9 (docs)** updates the config service docs and records the limitations.

**Consumer surfaces (C-14).** None — internal/platform-only (product-spec § Consumer Surface(s)). No RPC shape, proto
field or stored state changes. Every `WatchConfig` subscriber (backend services, UI, agent) and every
`GetConfig`/`SetConfig`/`AppendEvent` caller picks up the error-status contract through its existing client
reconnect or error path (`69c8554` for Node). This was decided in the product spec; it is not an omission.

**C-03 (standing operator decision, 2026-10-21).** No step adds an outbound gRPC call. Request handlers keep their
inbound metadata. Each WatchConfig subscriber carries its inbound `x-trace-id` (read once with `first()`) into
background broadcast and termination logs (Step 5). Only the listener/reconnect path, which has no originating
request, logs without a trace id.

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` propagation resumes after the LISTEN connection drops | Step 2 |
| `@AC-2` a failing reload inside the notification handler does not crash config | Step 2 |
| `@AC-3` GetConfig returns an error status when the overlay query fails | Step 4 |
| `@AC-4` SetConfig returns an error status when the existence-gate query fails | Step 4 |
| `@AC-5` idempotent AppendEvent returns an error status when `pool.connect` rejects | Step 8 |
| `@AC-6` a failed initial WatchConfig snapshot ends the stream with an error status | Step 6 |
| `@AC-7` a change committed while the snapshot is in flight still reaches the new subscriber | Step 6 |
| `@AC-8` a subscriber whose broadcast fails is told to reconnect | Step 6 |
| `@AC-9` a change committed while LISTEN is down reaches subscribers after reconnect | Step 2 |
| `@AC-10` idempotent AppendEvent releases its client with the error when a query in the transaction fails | Step 8 |
| `@AC-11` SetConfig returns an error status when the value write fails (regression pin) | Step 4 |

## Step Dependencies

- Steps 1 → 3 → 5 run in this order because they all edit `configServiceImpl.ts`. Step 5's `broadcastToSubscribers`
  change is also called by Step 1's `resyncAll`.
- Step 2 [test] covers Step 1 [service]. Step 4 [test] covers Step 3. Step 6 [test] covers Step 5. Step 8 [test]
  covers Step 7.
- Step 2's subscriber cases use only **global** subscribers (`user_id = ''`). `resolveOverlayValues` returns before
  any query for them (`configServiceImpl.ts:232`), so Step 2 holds both before and after Step 5 reorders
  `watchConfig`.
- Steps 7–8 do not depend on Steps 1–6.
- **Step 8 hard dependency: feature 252's ledger runner change must land first (fails.md:115-134, the 074
  zero-assertion trap).** Under today's runner, `LedgerServiceImpl` cannot load at all, so Step 8 cannot go green:
  - `ledgerServiceImpl.ts:20-25` uses constructor parameter properties (`private readonly pool`, `config`,
    `notifier`). The ledger suite runs `node --experimental-strip-types --test src/__tests__/*.test.ts`
    (`package.json:13-14`). Strip-only mode rejects parameter properties on every Node version, including Node 24,
    so the import is swallowed (`ledgerServiceImpl.test.ts:5-8` header, `:21-29` catch). The test also imports
    `'../grpc/ledgerServiceImpl.js'`, but only a `.ts` source exists under `src/`.
  - `252-fix-identity-ledger-test-suites` (`implementation-ready`, not merged) Step 4 moves ledger to compile-then-test.
    It changes `test`/`test:coverage` to `tsc && … node --test dist/__tests__/*.test.js` and drops the
    `src/**/*.test.ts` tsconfig exclusion. Its Step 5 de-guards `ledgerServiceImpl.test.ts`. This feature does not
    change the ledger runner itself: that would collide with 252's `package.json`/`tsconfig.json` edits. A
    per-file `--experimental-transform-types` would be a second runner beside 252's.
  - So Step 8 starts only after 252 Steps 4–5 are merged to `main-dev` and `feature/fix-config-stream-resilience` is
    rebased onto them. If 252 has not merged when Step 8 is reached, Step 8 is **blocked**. Record it in the
    Deviation Log and stop and ask; do not improvise a runner change (P-03). Step 7 (service) may land first, but
    its red/green proof waits for Step 8.
  - Step 8's new cases still assert the import (`assert.ok(LedgerServiceImpl, …)`) and never use the
    `if (!impl) return;` skip shape.
- Step 9 runs after Steps 1–8 so its line references match the final code.
- **Merge overlaps (design.md § Open Risks).** These are non-blocking and need a manual merge at the integration
  PR. The `merge-order.md` rows are added by `/sdd-execute` at integration time, because this spec's writer may
  only edit the feature directory.
  - `241-fix-config-audit-author-spoof` (implementation-ready) edits `setConfig` (`:405-414`, `:513`). Step 3 wraps
    `:446-463` of the same function.
  - `263-fix-edge-owner-scope` touches `getConfig` `:317-319`. Step 3 wraps `:319`.
  - `266-fix-db-tls-fail-closed` owns `src/index.ts:25-43`. No step here edits `index.ts`.
  - `248-fix-ledger-trimmed-notify-payload` and `257-fix-ledger-query-pagination` touch other functions in
    `ledgerServiceImpl.ts`, so they need a rebase only.
- **Fallback (design.md § Rejected Alternatives, fork b).** If Step 1's required pg_terminate_backend check shows
  the pooled client does not emit `error`/`end`, stop. Record it in the Deviation Log and return to `/sdd-design`
  for the dedicated-client fallback. Do not improvise it in place (P-03).

---

### Step 1 — service: config LISTEN lifecycle (reconnect with backoff, serial chain, guarded notifications)

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify

**Reviewers**: `xstockstrat-config` owner — WatchConfig stream stability, environment / global-per-user scoping,
secret redaction on every broadcast

**Codebase Evidence** (re-spec 2026-10-29: the step is implemented in `907fa340`; the anchors describe the
current tree, and the pre-Step-1 sites are in recon.md):
- `configServiceImpl.ts:1` already reads `import { Pool, PoolClient } from 'pg';`.
- `:19` `const log = getLogger('config:impl');`.
- `:156-157` `LISTENER_BACKOFF_INITIAL_MS = 1000` / `LISTENER_BACKOFF_MAX_MS = 30000`.
- `:159` `export class ConfigServiceImpl {`. The fields `subscribers` (`:160`) and `snapshots` (`:162`) are followed
  by the Step 1 fields `listener`, `connectedOnce`, `reconnectTimer`, `backoffMs` (`:163-166`) and `chain` (`:168`).
  The constructor is at `:170`.
- `initialize()` `:172-174` is now `await this.connectListener();`. The old `:162-174` body (the unguarded
  `pool.connect` at `:164` and the notification handler with no try) is gone.
- `serial()` `:176-183`. `connectListener()` `:185-205`: `pool.connect()` at `:188` inside the try,
  `LISTEN config_changed` at `:195` before the serial `reloadAll`/`resyncAll` at `:196`, the `log.info` at `:199`,
  and the catch at `:200-204`.
- `dropListener()` `:207-218`; `scheduleReconnect()` `:220-230`; `resyncAll()` `:232-241`; `onNotification()`
  `:243-259`.
- `reloadAll()` `:261-286` reads global rows only and does not broadcast. `reloadNamespace()` `:288-312` writes the
  full-namespace DELTA snapshot (`changedKeys: Object.keys(values)` at `:305`; CONFIG-1).
- `broadcastToSubscribers(namespace, env)` `:345-359` builds each payload through `snapshotForSubscriber` (`:350`),
  so calling it after `reloadAll` puts no `updateType: 1` on the wire.
- Reference to port (mandatory reuse, recon.md § Patterns to REUSE): ledger
  `services/xstockstrat-ledger/src/services/eventNotifier.ts`.
  - `:71-108` `connect()`: `connect()`/`LISTEN` sit inside one try (`:82`), and the catch reschedules
    (`:99-107`).
  - `:110-117` `scheduleReconnect()`: the single-timer guard `if (this.closing || this.reconnectTimer) return;`.
    The timer callback clears `this.reconnectTimer = null` (`:114`) before reconnecting.
  - `:119-137` `dispatch()`: a guarded `JSON.parse`, and a malformed payload is ignored.
  - `:35` `reconnectDelayMs = 2000`, a hardcoded constant. This is the F-07 precedent for code-constant backoff.
- Re-verified 2026-10-29 after the second main-dev merge: the ledger `eventNotifier.ts` anchors still match, and the
  configServiceImpl.ts anchors above are re-stamped against the post-Step-3 tree.
- Boot path: `src/index.ts:47-48` (`new ConfigServiceImpl(pool)`, `await configImpl.initialize()`). A rejection
  from `initialize()` makes `main()` exit (recon.md:20-22). That fail-fast behaviour is kept, and `index.ts` is not
  edited.
- Lint: `services/xstockstrat-config/.eslintrc.json` extends `eslint:recommended`. Its `no-empty` rule flags an
  empty `catch {}`, so every intentionally empty catch body holds a one-line comment, as at
  `eventNotifier.ts:103-105`.
- Header propagation: no new outbound gRPC call, so C-03 propagation does not apply. The listener path has no
  originating request (standing operator decision).

**TDD**: `red-green required` (Step 2 is the paired test)

**Covers**: —

**Instructions** (already applied in `907fa340`; kept as the record of what the step does — do not re-apply):
1. Change `:1` to `import { Pool, PoolClient } from 'pg';`.
2. Next to `:156-158`, add the private fields and two module-level code constants (F-07: config cannot watch itself,
   invariant #1; precedent `eventNotifier.ts:35`):
   - Constants: `LISTENER_BACKOFF_INITIAL_MS = 1000` and `LISTENER_BACKOFF_MAX_MS = 30000`.
   - Fields: `listener: PoolClient | null = null`, `connectedOnce = false`,
     `reconnectTimer: NodeJS.Timeout | null = null`, `backoffMs = LISTENER_BACKOFF_INITIAL_MS`, and
     `chain: Promise<void> = Promise.resolve()`.
   - Do not add a constructor option. Step 2 drives the timers with `t.mock.timers`, as at
     `configWatcher.test.ts:139`.
3. Add `private serial<T>(fn: () => Promise<T>): Promise<T>`:
   `const run = this.chain.then(fn); this.chain = run.then(() => undefined, () => undefined); return run;`.
   The caller sees the real rejection, and the stored tail never rejects.
4. Add `private async connectListener(): Promise<void>`. Declare `let c: PoolClient | undefined;`. The whole body is
   one try, mirroring `eventNotifier.ts:82-107`:
   - `c = await this.pool.connect();` runs **inside** the try (the reconnect-retry fix approved at the r2 gate).
   - Capture `const client = c;` for the closures. Then attach:
     - `client.on('error', (e) => this.dropListener(client, e))`
     - `client.on('end', () => this.dropListener(client, new Error('LISTEN connection ended')))`
     - `client.on('notification', (msg) => this.onNotification(client, msg))`
   - `this.listener = client;`
   - `await client.query('LISTEN config_changed');` — on boot this now runs **before** `reloadAll`, which closes
     the lost-NOTIFY window between `:163` and `:165`.
   - `await this.serial(() => (this.connectedOnce ? this.resyncAll() : this.reloadAll()));`
   - `this.connectedOnce = true; this.backoffMs = LISTENER_BACKOFF_INITIAL_MS;`, then the `log.info` from `:173`.
   - The catch handles each case as follows:
     - If `c` is set, call `this.dropListener(c, err)`.
     - Else, if `this.connectedOnce` is true, call `this.scheduleReconnect()`. This is the case where
       `pool.connect()` rejected.
     - Then, if `!this.connectedOnce`, `throw err`, so boot still fails fast.
5. Add `private dropListener(c: PoolClient, err: Error)`:
   - `if (this.listener !== c) return;` This identity guard means each client is released exactly once, whatever
     the order of `error`, `end` and a resync failure.
   - `this.listener = null; c.removeAllListeners('notification');`
   - `try { c.release(err); } catch { /* already released */ }`. Releasing with the error makes pg-pool discard
     the broken client.
   - `log.error('config LISTEN connection lost', { error: err.message })`
   - `if (this.connectedOnce) this.scheduleReconnect();`
6. Add `private scheduleReconnect()`:
   - `if (this.reconnectTimer) return;`
   - `const delay = this.backoffMs; this.backoffMs = Math.min(this.backoffMs * 2, LISTENER_BACKOFF_MAX_MS);`
   - `this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.connectListener().catch(() => { /* every failure path reschedules itself */ }); }, delay);`
   - There is no jitter, because there is one listener per process.
7. Add `private async resyncAll()`:
   - `await this.reloadAll();`
   - Collect the distinct `(namespace, environment)` pairs from `this.subscribers`.
   - Call `await this.broadcastToSubscribers(ns, env)` once for each pair.
   - A `reloadAll` rejection propagates to `connectListener`'s catch, where the client is released once and a retry
     is scheduled.
8. Add `private onNotification(c: PoolClient, msg: { payload?: string })`:
   - `if (this.listener !== c || !msg.payload) return;`
   - Parse inside `try { ({ namespace, environment } = JSON.parse(msg.payload)); } catch { return; /* malformed payload */ }`,
     following `eventNotifier.ts:119-128`.
   - `if (typeof namespace !== 'string' || !namespace) return; /* payload without a namespace */` — dropped
     before the chain, so `reloadNamespace(namespace: string, …)` (`:203`) is never called with `undefined`.
   - `const env = (environment ?? 'staging') as EnvStr;` (kept from `:169`).
   - `this.serial(async () => { await this.reloadNamespace(namespace, env); await this.broadcastToSubscribers(namespace, env); }).catch((err) => log.error('config_changed handling failed', { namespace, env, error: err?.message }));`
   - Reload and notification work share one chain, so a stale `reloadAll` write (`:191`) cannot overwrite a newer
     `reloadNamespace` write (`:214`).
9. Replace the body of `initialize()` (`:162-174`) with `await this.connectListener();`.
10. Do not touch `reloadAll`, `reloadNamespace` or `buildConfigValue`. Every row still goes through
    `buildConfigValue`, so redaction is preserved (PRESERVE config-secrets `@AC-2`/`@AC-14`, platform `@AC-35`).

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run build && pnpm run lint
grep -n "pool.connect()" src/grpc/configServiceImpl.ts      # expect: exactly one hit (:188), inside connectListener's try
grep -n "LISTENER_BACKOFF_INITIAL_MS = 1000\|LISTENER_BACKOFF_MAX_MS = 30000" src/grpc/configServiceImpl.ts
```

**Required check (design.md § Open Risks, half-open socket).** Run this before marking the step done. It proves the
pooled client emits `error`/`end` on a terminated backend:

```bash
docker compose up -d timescaledb xstockstrat-config
docker compose exec timescaledb psql -U postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query ILIKE 'LISTEN config_changed%';"
docker compose logs --since 1m xstockstrat-config | grep -E "config LISTEN connection lost|listening for config_changed"
```

- Expect `config LISTEN connection lost`, followed within about 1 s by a new
  `listening for config_changed`.
- Then a `SetConfig` of a registered global key must reach an open WatchConfig stream.
- If Docker is unavailable in the executing session, the step is **blocked** on this check. Record that in the
  Deviation Log. The check then moves to the dev app (`main-dev` deploy) as a blocker on the integration PR. It is
  never silently waived. Step 1 cannot be marked `done` until this check has passed, locally or on the dev app.
  Steps 2–6 may proceed while it is pending, because their fakes do not depend on it.
- Tooling note (2026-10-29): the `docker` / `dockerd` binaries and Compose v5.6.1 are present on the execute host,
  but a batch-execute worktree session is barred from starting a database (sdd-execute HARD CONSTRAINT). In that
  case the check takes the fallback above (dev app, integration-PR blocker). It is not hard-blocked by tooling.

---

### Step 2 — test: LISTEN reconnect, retry, resync and notification-failure cases (AC-1, AC-2, AC-9)

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/configServiceImpl.test.ts` — modify

**Reviewers**: `xstockstrat-config` owner — WatchConfig stream stability, environment / global-per-user scoping,
secret redaction on every broadcast

**Codebase Evidence**:
- `configServiceImpl.test.ts` (95 lines):
  - `before()` imports `../grpc/configServiceImpl.js` with no swallow (`:17-21`).
  - The harness assertion is at `:23-27`.
  - `makePool(rows)` is at `:30-38`. It is local to the `listKeys` describe, and its `connect:` (`:33`) returns an
    inert client with no `release`/`removeAllListeners`.
- The suite runs against compiled output: `package.json:12-13`
  (`tsc && c8 --reporter=text --reporter=lcov --lines 40 node --test dist/__tests__/*.test.js`).
- Fake model: ledger `FakeClient` (`services/xstockstrat-ledger/src/__tests__/eventNotifier.test.ts`; `class FakeClient` at `:22`,
  `failConnect` at `:27`, `notify` at `:47`). It has `on`/`emit`/`notify`/`listens`/`failConnect`.
- Timer precedent: `t.mock.timers.enable({ apis: ['setTimeout'] })` and `t.mock.timers.tick(...)`
  (`src/__tests__/configWatcher.test.ts:139-144`).
- AC fixture data: `buildConfigValue` maps a `value_type: 'int'` row to `{ int_val }` (`configServiceImpl.ts:582`).
  `toProtoSnapPayload` maps that to `{ intVal }` (`:49`). The DELTA `updateType` is
  `'CONFIG_UPDATE_TYPE_DELTA'` (string enums; `:37-41`).
- Log capture. `log` is a module-private winston logger (`src/services/logger.ts:10-19`, a
  `transports.Console()` sink), and no config/ledger test captures logs today (grep for `stdout.write`/`winston` in
  `src/__tests__`: no hits). Winston is not installed until `pnpm install` runs (no `node_modules` in a fresh
  checkout), so the sink is **Not verified** here.
  Capture with `t.mock.method(process.stdout, 'write', …)`, which is where winston 3's Console transport writes by
  default. At execute, confirm that against the installed `winston/lib/winston/transports/console.js`. If the sink
  differs, mock what that file actually calls (`console._stdout`, `console.log` or `console.error`) and record the
  choice in the Deviation Log. Assert on `"level"`/`error` plus the message text, which the Console sink output
  carries in both its dev and prod formats.
- C-13: the `FakeClient`, the routing pool and the `analysis.backtest.max_duration_seconds` row are used only in
  this file. No `src/__tests__/fixtures/` home exists (ls), so the verdict is compliant inline.

**TDD**: `red-green required`. Against the pre-Step-1 tree:
- AC-1 and AC-9 fail, because there is no second `pool.connect` or LISTEN after `error`/`end`.
- AC-2 fails, because the handler's rejection escapes (`unhandledRejection` fires).
- The boot-order case fails, because `reloadAll`'s SELECT precedes LISTEN (`:163-165`).
- The reject-twice case fails, because nothing reconnects.

**Covers**: `AC-1, AC-2, AC-9`

**Instructions**:
0. **Log-sink spike (do this first; it gates the AC-2 and AC-8 log assertions).** After `pnpm install`, read the
   installed `node_modules/winston/lib/winston/transports/console.js` and note which writer its `log()` calls for
   `error`-level records. Record that writer in the Deviation Log before any case is written; Step 6 reuses it.
   Then prove the capture works: a throwaway case that calls a `getLogger('t').error('probe')` and asserts the
   mock saw `probe`. It must pass before AC-2/AC-8 are written, and is deleted afterwards. If no writer can be
   mocked from the test, stop and ask; do not drop the log assertions.
1. Add a `describe('ConfigServiceImpl — LISTEN lifecycle (feature 258)')` with these local helpers:
   - `FakeClient extends EventEmitter` (from `node:events`). It needs:
     - `query(sql)`, which pushes to a shared `log: string[]` and records `LISTEN`;
     - `release = (err?) => { releases.push(err) }`;
     - the inherited `removeAllListeners`.
   - A routing pool:
     - `connect()` either shifts a scripted outcome (a FakeClient, or a rejection
       `new Error('connection terminated')`) or returns a fresh FakeClient.
     - `query(sql, params)` routes by SQL and logs each call to the same `log`:
       - `WHERE user_id IS NULL` with no `$1` → reloadAll;
       - `namespace = $1 AND environment = $2 AND user_id IS NULL` → reloadNamespace;
       - `user_id = $3` → overlay.
     - It reads rows from a mutable `rows` array, so a test can change the stored value mid-test.
   - `fakeCall()`: an `EventEmitter` with `request`, `metadata` (a `grpc.Metadata`), a `writes: any[]` array,
     `write(p)`, and `destroy(s)`, which records `destroyed`.
   - `unhandled()`: installs a `process.on('unhandledRejection', …)` collector, and returns it plus a disposer.
2. **Boot ordering.** After `await impl.initialize()`, the index of `LISTEN config_changed` in `log` is lower than
   the index of the reloadAll SELECT.
3. **`@AC-1`.**
   - Setup: `t.mock.timers.enable({ apis: ['setTimeout'] })`. Initialize with the row
     `analysis.backtest.max_duration_seconds` = `'300'` (`value_type: 'int'`, `environment: 'staging'`). Open a
     global `watchConfig` on `analysis`/staging (`environment: 'ENVIRONMENT_STAGING'`, `user_id: ''`). Await one
     `setImmediate`.
   - Drop: emit `error` (`new Error('terminating connection due to administrator command')`), then `end`, on the
     first FakeClient.
   - Assert exactly **one** `release`, carrying that error.
   - `tick(1000)`, then flush with `setImmediate`. Assert a second `pool.connect` and a second
     `LISTEN config_changed`.
   - Set the row to `'600'` and `notify` `{"namespace":"analysis","environment":"staging"}` on the **new** client.
   - Assert the last write is a DELTA whose `values['analysis.backtest.max_duration_seconds'].intVal === 600`.
     Assert the same `impl` instance served it (no restart).
4. **`@AC-9`.** Same setup and drop as AC-1.
   - Set the row to `'600'` while the listener is down, with no NOTIFY.
   - `tick(1000)` and flush.
   - Assert that `resyncAll` delivered a DELTA carrying 600 with no notification sent.
5. **Reconnect `pool.connect()` rejects twice, then succeeds** (the blocking-fix test approved at the r2 gate).
   - After the drop, script `connect` as reject, reject, FakeClient.
   - Tick 1000 → one rejected connect, and no unhandled rejection.
   - Tick 1999 → no new connect. Tick 1 more → the second rejection.
   - Tick 4000 → success, `LISTEN` re-run, and a DELTA re-broadcast to the subscriber.
   - After success, a fresh drop reconnects after 1000 ms (the backoff resets).
6. **Reconnect `reloadAll` rejects once.**
   - Make the reloadAll SELECT reject once, on the first reconnect.
   - Assert the new client is released exactly once, with that error.
   - Then tick 2000 → the retry succeeds and re-broadcasts (AC-9 retry path).
7. **Interleave.**
   - Hold the reloadAll SELECT of a reconnect on a controlled promise.
   - Deliver a notification on the new client, then resolve the reloadAll.
   - Assert that the cached snapshot (via a following `getConfig`) holds the `reloadNamespace` data, and that the
     DELTAs arrive in chain order.
8. **`@AC-2`.**
   - Make the reloadNamespace SELECT reject with `new Error('connection terminated')`, and notify for `analysis`.
   - Await two `setImmediate`s.
   - Assert the collector saw **no** unhandled rejection.
   - Capture the error-level record through the logger's sink and assert it contains `connection terminated`
     (see the log-capture note in Codebase Evidence).
   - Then `await impl.getConfig(...)` still invokes its callback with `err === null`.
9. **Malformed payload.** `notify('not json')` → no throw, no unhandled rejection and no query.
10. Restore timers and remove the `unhandledRejection` collector in each case (`t.after`).

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run test:coverage && pnpm run lint
# c8 --lines 40 must pass (package.json:13); 0 failed tests (reporter-neutral, fails.md:2992-3005).
grep -n "AC-1\|AC-2\|AC-9\|rejects twice" src/__tests__/configServiceImpl.test.ts   # each present
grep -rn "__tests__/fixtures" src/__tests__/configServiceImpl.test.ts             # C-13: expect no hits
```

---

### Step 3 — service: config `getConfig` / `setConfig` gate queries return a gRPC error on DB rejection

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify

**Reviewers**: `xstockstrat-config` owner — WatchConfig stream stability, environment / global-per-user scoping,
secret redaction on every broadcast

**Codebase Evidence**:
- **D-06** `getConfig` `:315-328`. `const values = await this.resolveOverlayValues(namespace, env, userId);` at
  `:319` is outside any try. The success callback is at `:321-327`.
- **D-06** `setConfig` (anchors re-stamped 2026-10-29: +2 after the main-dev merge brought the
  `platform.trading_state` INVALID_ARGUMENT block at `:418-430`; match by symbol, the code shapes are unchanged):
  - `:448` `const createKey = …`
  - `:449-453` `const existing = await this.pool.query(...)` — outside any try.
  - `:457` `let globalRow: any = null;`
  - `:458-465` the `if` block holding `const globalExisting = await this.pool.query(...)` — outside any try.
  - `:467` `keyRegistered`, which reads `existing` and `globalRow`.
  - NOT_FOUND `code: 5` at `:468-474`.
  - `:478-484` `isSecret`, which reads `existing.rows`.
  - The encryption catch, `code: 13`, at `:492-495`.
  - The write try at `:502-524`. Its catch `callback({ code: 13, message: err.message })` at `:523` is the reuse
    convention (recon.md § Patterns to REUSE).
- These checks stay **outside** the new try, so their specific codes survive:
  - PERMISSION_DENIED callbacks `:393`/`:405`; `first(call.metadata, HEADER_INTERNAL_CALLER)` at `:407`
  - MISSING_AUTHOR `:413-416`
  - INVALID_ARGUMENT, including the `platform.trading_state` block `:418-430`, up to the gate
- `getSecret` `:335-369` is not touched, and no shared helper is added (PRESERVE config-secrets `@AC-16`).

**TDD**: `red-green required` (Step 4 is the paired test)

**Covers**: —

**Instructions**:
1. `getConfig`: wrap `:319` in `let values: Record<string, any>; try { values = await this.resolveOverlayValues(namespace, env, userId); } catch (err: any) { log.error('getConfig failed', { namespace, env, userId, error: err.message }); callback({ code: 13, message: err.message }); return; }`.
   Leave `:320-327` unchanged.
2. `setConfig`: declare `let existing: any; let globalRow: any = null;` above `:449`. Then wrap only the two gate
   queries (`:449-453` and the `if` block `:458-465`) in `try { … } catch (err: any) { log.error('setConfig existence gate failed', { namespace, key, env, error: err.message }); callback({ code: 13, message: err.message }); return; }`.
   Remove the original `const`/`let` on those lines. `:467` onward reads the same names.
3. Do not move the NOT_FOUND gate, the encryption catch or the write try (`:502-524`). AC-11 is a regression pin on
   that unchanged try.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run build && pnpm run lint
grep -n "getConfig failed\|setConfig existence gate failed" src/grpc/configServiceImpl.ts   # one hit each
```

---

### Step 4 — test: unary handlers return an error status and keep their specific codes (AC-3, AC-4, AC-11)

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/configServiceImpl.test.ts` — modify

**Reviewers**: `xstockstrat-config` owner — WatchConfig stream stability, environment / global-per-user scoping,
secret redaction on every broadcast

**Codebase Evidence**:
- Step 3's sites (re-stamped 2026-10-29 against the post-Step-3 tree): `getConfig` `:400`, with its overlay call
  `resolveOverlayValues(namespace, env, userId)` at `:406` inside the try. The overlay SELECT (`user_id = $3`) is
  at `:318-322`. The `setConfig` existence gates are at `:541-563`: the exact-scope `SELECT is_secret` at
  `:545-549`, the per-user global-row fallback at `:553-558`, and the catch / code 13 at `:559-563`.
- Admin-scope metadata shape: `setConfigAuthz.test.ts` uses `HEADER_ACCESS_SCOPE`/`HEADER_USER_ID` imported from
  `../grpc/authz` (`authz.ts:10-11`). The inline literals are banned by `.eslintrc.json:13-27`. Scope `'4'` passes
  `hasAdminAccessScope`.
- The bounds registry has no entry for `analysis.backtest.max_duration_seconds` (`configServiceImpl.ts:100-146`;
  grep, re-verified 2026-10-29), so a write of 600 reaches the existence gate.
- INVALID_ARGUMENT source: `'analysis.scoring.signal_decay_half_life_hours': { minValue: 0, maxValue: 8760 }`
  (`:101`).
- NOT_FOUND source: `:566-572`.
- C-13: inline scenario values in this file only; compliant inline.

**TDD**: `red-green required`. Against the pre-Step-3 tree, AC-3 and AC-4 reject from the handler instead of
invoking the callback, and an unhandled rejection is observed, so both fail. AC-11 and the INVALID_ARGUMENT /
NOT_FOUND cases are **regression pins**: they are green before and after (design.md § Business Rules Touched,
PRESERVE). The step's red evidence is AC-3 and AC-4.

**Covers**: `AC-3, AC-4, AC-11`

**Instructions**:
1. Add a `describe('ConfigServiceImpl — unary DB failures (feature 258)')` with a pool whose `query` rejects with
   `new Error('connection terminated')` when the SQL matches a configured regex. Otherwise it returns the configured
   rows.
2. **`@AC-3`.**
   - Make the overlay SELECT (`user_id = $3`) reject.
   - `await impl.getConfig({ request: { namespace: 'analysis', userId: 'u-1', environment: 'ENVIRONMENT_STAGING' } }, cb)`.
   - Assert that `cb` was called once with `err.code === 13`, and that no `unhandledRejection` occurred.
3. **`@AC-4`.**
   - Make the existence-gate SELECT (`SELECT is_secret`) reject.
   - Call `setConfig` with `{ namespace: 'analysis', key: 'analysis.backtest.max_duration_seconds', value: { intVal: 600 } }`,
     admin metadata (`HEADER_ACCESS_SCOPE: '4'`, `HEADER_USER_ID: 'admin-7'`) and `author: 'admin-7'`.
   - Assert `err.code === 13` and that no INSERT was issued.
4. **`@AC-11`.**
   - The gate returns `[{ is_secret: false }]`, and the `INSERT INTO config.config_values` rejects.
   - Assert `err.code === 13` and no unhandled rejection.
5. **Pins.**
   - Bounds: the decay key with `floatVal: -1` gives `err.code === 3`, and no query is issued.
   - NOT_FOUND: the gate returns `[]` and `createKey` is false. Assert `err.code === 5`.
   - A global write with no admin scope still yields PERMISSION_DENIED (`ADMIN_SCOPE_ERROR`), and no query is issued.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run test:coverage && pnpm run lint
# c8 --lines 40 passes; 0 failed tests.
grep -n "AC-3\|AC-4\|AC-11" src/__tests__/configServiceImpl.test.ts
```

---

### Step 5 — service: WatchConfig registers pending before the snapshot; failures end the call (D-35, D-58)

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify

**Reviewers**: `xstockstrat-config` owner — WatchConfig stream stability, environment / global-per-user scoping,
secret redaction on every broadcast

**Codebase Evidence**:
- `interface Subscriber` `:87-94`. `lastVersion: string` (`:93`) is set at `:387` and read nowhere in
  `services/xstockstrat-config/src` (grep; recon.md:181-183).
- **D-58** `broadcastToSubscribers` `:345-359`:
  - The loop is at `:347`.
  - The catch `:353-356` is `log.warn('Failed to write to subscriber', { clientId: sub.clientId })` followed by
    `this.subscribers.delete(id)`. It drops `err` and never ends the call.
- **D-35** `watchConfig(call)` `:365-398`:
  - `subId` is built at `:369`.
  - The `cancelled`/`error` handlers at `:373-379` only delete.
  - The `Subscriber` literal is at `:381-388`.
  - `.then(...)` at `:390-394` registers only after the snapshot write.
  - `.catch(...)` at `:395-397` only warns.
- `first(md, key): string` is declared at `src/grpc/authz.ts:15` (its doc comment is `:14`). It is already imported
  (`configServiceImpl.ts:9`, inside the `./authz` import at `:3-14`). The call form is at `:499` (C-18; not the
  array-returning `metadata.get`). Config `src` outside tests has no `x-trace-id` header constant or literal (grep),
  so the literal is used once.
- Stream-termination pattern to reuse: ledger `call.destroy({ code: 13, message: \`Internal error: ${err.message}\` })`
  (`services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:325`; also `:285`, `:297`). Config has no
  `call.destroy` today (grep).
- `ConfigUpdateType.CONFIG_UPDATE_TYPE_SNAPSHOT` / `_DELTA` are used at `:390` and `:350`.
- Re-verified 2026-10-29 after the second main-dev merge: the anchors above are re-stamped against the post-Step-3
  tree (Steps 1–3 added about 85 lines above them).

**TDD**: `red-green required` (Step 6 is the paired test)

**Covers**: —

**Instructions**:
1. In `interface Subscriber` (`:87-94`), replace `lastVersion: string;` with `pending: boolean;`,
   `missedDelta: boolean;` and `traceId?: string;`.
2. Add `private endSubscriber(id: string, sub: Subscriber, err: any)`:
   - `if (this.subscribers.get(id) !== sub) return;`
   - `this.subscribers.delete(id);`
   - `log.error('WatchConfig subscriber terminated', { subId: id, clientId: sub.clientId, traceId: sub.traceId, error: err?.message });`
   - `try { sub.call.destroy({ code: 13, message: \`Internal error: ${err?.message}\` }); } catch { /* call already closed */ }`
   - It is reachable **only** from the `watchConfig` snapshot/catch-up chain and the per-subscriber broadcast catch
     (C-16: PRESERVE platform `@AC-6 @FR-6 @feature-210`).
3. `broadcastToSubscribers` (`:347-356`):
   - After the namespace/env filter, add `if (sub.pending) { sub.missedDelta = true; continue; }`.
   - Replace the catch body (`:354-355`) with `this.endSubscriber(id, sub, err);`.
4. `watchConfig` (`:381-397`):
   - The literal becomes `{ namespace, environment, userId, clientId, call, pending: true, missedDelta: false, traceId: first(call.metadata, 'x-trace-id') || undefined }`.
   - Register it **before** the snapshot read: `this.subscribers.set(subId, sub);`.
   - Replace `:390-397` with an async chain:
     1. `const snap = await this.snapshotForSubscriber(sub, SNAPSHOT); if (this.subscribers.get(subId) !== sub) return; call.write(snap);`
     2. `while (sub.missedDelta && this.subscribers.get(subId) === sub) { sub.missedDelta = false; const d = await this.snapshotForSubscriber(sub, DELTA); if (this.subscribers.get(subId) !== sub) break; call.write(d); }`
     3. `sub.pending = false;`
     4. Route any rejection to `this.endSubscriber(subId, sub, err)`.
5. Leave the `cancelled`/`error` handlers (`:373-379`) as delete-only. A certificate rotation therefore never
   triggers `destroy`.
6. All payloads still come from `snapshotForSubscriber` → `resolveOverlayValues` → `buildConfigValue`. No new SELECT
   is added (PRESERVE `@AC-2`/`@AC-13`/`@AC-14`, platform `@AC-35`). SNAPSHOT-first (service invariant #2) holds,
   because a pending subscriber receives no broadcast write.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run build && pnpm run lint
grep -n "lastVersion" src/grpc/configServiceImpl.ts     # expect: no hits
grep -n "this.endSubscriber(" src/grpc/configServiceImpl.ts   # expect: exactly 2 call sites (watchConfig chain, broadcast catch)
```

---

### Step 6 — test: snapshot failure, in-flight change, broadcast failure, cancel during catch-up (AC-6, AC-7, AC-8)

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/configServiceImpl.test.ts` — modify

**Reviewers**: `xstockstrat-config` owner — WatchConfig stream stability, environment / global-per-user scoping,
secret redaction on every broadcast

**Codebase Evidence**:
- Step 5's sites in the pre-Step-5 tree (re-stamped 2026-10-29): `watchConfig` `:365-398` and
  `broadcastToSubscribers` `:345-359`. Step 5 shifts both, so locate them by symbol.
- `broadcastToSubscribers` is private. Tests drive it through the Step 1 `notification` path. They reuse Step 2's
  `class FakeClient` (`configServiceImpl.test.ts:104`) and the routing pool from `makeRig()` (`:123`) in this file
  (no second copy).
- Log capture: there is no shared helper. Step 2's `@AC-2` case mocks `process.stdout.write` inline (about
  `:358-360`, with `t.mock.method`, passing each chunk through; the sink is recorded in the Deviation Log). Step 6
  uses the same inline pattern in each case that asserts a log line.
- Fake-call model: ledger stream tests assert `call.destroyed.code` (`ledgerServiceImpl.test.ts:597-598`, `:609`; fake call `destroyed` field at `:520`, set at `:528`).
- Per-user overlay SELECT: `configServiceImpl.ts:318-322` (`user_id = $3`, in `resolveOverlayValues`).

**TDD**: `red-green required`. Against the pre-Step-5 tree:
- AC-6 fails: there is no `destroy`, and the stream gets no status.
- AC-7 fails: a DELTA broadcast during the in-flight snapshot is missed, so no write carries 600.
- AC-8 fails: there is no `destroy`, and the log is at warn level with no `err`.

**Covers**: `AC-6, AC-7, AC-8`

**Instructions**:
1. **`@AC-6`.**
   - Make the overlay SELECT reject.
   - Open `watchConfig` for `analysis`/`u-1`, then flush.
   - Assert `call.destroyed.code === 13` and `call.writes.length === 0`.
   - Set the row to 600 and notify for `analysis`. Assert `call.writes.length` is still 0.
2. **`@AC-7`.**
   - Hold the overlay SELECT for `u-1` on a controlled promise.
   - Open `watchConfig`. Set the global row to 600 and notify for `analysis`. Flush, so the broadcast runs while
     the snapshot is pending.
   - Resolve the held SELECT; subsequent overlay SELECTs resolve immediately.
   - Assert `writes[0].updateType === 'CONFIG_UPDATE_TYPE_SNAPSHOT'`.
   - Assert that a following write is a DELTA whose `values['analysis.backtest.max_duration_seconds'].intVal === 600`.
     Either form satisfies the scenario wording: the first SNAPSHOT or a following DELTA carries 600.
3. **`@AC-8`.**
   - Register a `u-1` subscriber and let its snapshot complete.
   - Make the overlay SELECT reject once with `new Error('overlay rejected')`, then notify for `analysis`.
   - Assert `call.destroyed.code === 13`.
   - Assert a captured error-level record containing `overlay rejected`, using the inline
     `process.stdout.write` capture from Step 2's `@AC-2` case.
   - A second notify writes nothing to that call.
4. **Cancel during catch-up.**
   - With a held snapshot SELECT and a notify, emit `cancelled` on the call before releasing the SELECT.
   - Assert there is no write after cancel, no `destroy`, and no `WatchConfig subscriber terminated` log line.
5. **Idempotent end.** Two failures for the same subscriber produce one `destroy` and one error log.
6. **Trace id.** A call whose metadata carries `x-trace-id: t-258` logs `traceId: 't-258'` on termination (C-03).

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run test:coverage && pnpm run lint
# c8 --lines 40 passes; 0 failed tests.
grep -n "AC-6\|AC-7\|AC-8\|cancel during catch-up" src/__tests__/configServiceImpl.test.ts
```

---

### Step 7 — service: ledger `appendEvent` acquires the client inside the try and releases it with the error

**Status**: `done`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts` — modify

**Reviewers**: `xstockstrat-ledger` owner — append-only invariant (no deletes or updates), event ordering,
hypertable partition safety

**Codebase Evidence**:
- `ledgerServiceImpl.ts:1` `import { Pool, Client } from 'pg';`. `appendEvent(call: any, callback: any)` is at `:31`.
- The plain no-key path is already guarded (`:61-71`). Its catch is at `:66-69`:
  `log.error('appendEvent failed', …)` and `callback({ code: 13, message: \`Internal error: ${err.message}\` })`.
- **D-06**: `:73` comment, then `:74` `const client = await this.pool.connect();` before `try {` at `:75`.
- The dedup branch `ROLLBACK` is at `:86`, inside the try. The catch at `:112-115` runs
  `await client.query('ROLLBACK').catch(() => {});`, then the log, then the code-13 callback. `finally { client.release(); }`
  is at `:116-118`.
- Pool budget: ledger's query pool is `DB_POOL_MAX=1` (root CLAUDE.md § Connection Pool Budget). A client that broke
  mid-transaction must be destroyed, not returned to the pool. That is why the client is released with the error.
- Header propagation: no new outbound call.

**TDD**: `red-green required` (Step 8 is the paired test)

**Covers**: —

**Instructions**:
1. Leave `:1` as `import { Pool, Client } from 'pg';` and add `import type { PoolClient } from 'pg';` beside it.
   `PoolClient` is type-only, so `import type` keeps it out of any runtime named import under every ledger runner.
2. Replace `:74` with `let client: PoolClient | undefined; let failure: unknown;`. Make
   `client = await this.pool.connect();` the first statement inside the try at `:75`. Every later `client.` use
   inside the try is reached only after assignment, so use `client!` or a narrowed local (`const c = client`), as
   lint and tsc allow.
3. In the catch (`:112-115`): set `failure = err;`, then `if (client) await client.query('ROLLBACK').catch(() => {});`.
   Keep the existing `log.error` and code-13 callback.
4. Replace the finally body (`:117`) with `client?.release(failure instanceof Error ? failure : undefined);`.
5. Do not change the success path, the idempotency dedup, the insert SQL, or sequence ordering (PRESERVE the
   append-only semantics).

**Verification**:
```bash
cd services/xstockstrat-ledger && pnpm run build && pnpm run lint   # tsc checks the `client` narrowing (C-18)
grep -n "import type { PoolClient } from 'pg'" src/grpc/ledgerServiceImpl.ts   # one hit
grep -n "client = await this.pool.connect()" src/grpc/ledgerServiceImpl.ts   # one hit, after the `try {` line
grep -n "client?.release(failure" src/grpc/ledgerServiceImpl.ts              # one hit
```

---

### Step 8 — test: idempotent AppendEvent connect and mid-transaction failures (AC-5, AC-10)

**Status**: `pending`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/__tests__/ledgerServiceImpl.test.ts` — modify

**Reviewers**: `xstockstrat-ledger` owner — append-only invariant (no deletes or updates), event ordering,
hypertable partition safety

**Codebase Evidence**:
- Re-stamped 2026-10-29 — feature 252 has landed on this branch (via the main-dev merge):
  - `ledgerServiceImpl.test.ts` (707 lines) no longer swallows the import: the `before()` import at `:10-12` is
    unguarded, and `:18` asserts `typeof LedgerServiceImpl === 'function'` with the message `'… never skip
    silently'`. There are 0 `if (!impl) return;` sites (grep).
  - `makeIdempotentPool(opts)` is at `:46` (doc comment `:44`). Its client has `release() {}` (`:64`), and its
    `async connect()` (`:67`) always resolves. Existing callers are at `:391` and `:419`.
- **Runner (precondition met).** `services/xstockstrat-ledger/package.json:14` `test:coverage` is now
  `tsc && c8 --reporter=text --reporter=lcov --lines 40 node --test dist/__tests__/*.test.js` (252 Step 4). The
  test's `'../grpc/ledgerServiceImpl.js'` specifier resolves to the compiled `dist/grpc/ledgerServiceImpl.js`, so
  `LedgerServiceImpl`'s constructor parameter properties load. The Step 0 gate below passes; re-grep it anyway.
- No `src/__tests__/fixtures/` home exists in ledger (ls). `makeIdempotentPool` has one consumer file. C-13
  verdict: compliant inline.

**TDD**: `red-green required`, on 252's compile-then-test runner. Against the pre-Step-7 tree:
- AC-5 fails, because `appendEvent` rejects with the connect error and the callback is never called.
- AC-10 fails on the new assertion that `release` was called with the caught `Error`. Today `release()` is called
  with no argument.

These failing runs are the proof that the cases **execute**. A vacuous skip cannot go red (fails.md:115-134; P-06).

**Covers**: `AC-5, AC-10`

**Instructions**:
0. **Precondition gate.** Confirm `services/xstockstrat-ledger/package.json` `test:coverage` starts with `tsc &&`
   and runs `dist/__tests__/*.test.js` (feature 252 Step 4 merged and rebased in). If it still runs
   `--experimental-strip-types`, Step 8 is **blocked**: record it in the Deviation Log and stop and ask.
1. **Zero-assertion guard.** Put the new cases in a new
   `describe('LedgerServiceImpl.appendEvent — DB failures (feature 258)')`.
   - Its first statement in each case is `assert.ok(LedgerServiceImpl, 'ledgerServiceImpl must import — never skip silently');`.
   - Do **not** use `if (!impl) return;`.
   - Do not edit the `before()` import block (`:10-12`) or the runner. They belong to
     `252-fix-identity-ledger-test-suites`.
   - Name the two cases with `@AC-5` and `@AC-10` in their titles, so the TAP check below can find them.
2. Extend `makeIdempotentPool`'s `opts` with `connectThrows?: Error` and `throwOn?: RegExp`, and record releases:
   - `connect()` rejects with `connectThrows` when it is set.
   - `client.query` throws `new Error('connection terminated')` when the SQL matches `throwOn`.
   - `release(err?)` pushes `err` to a returned `releases` array.
   - Existing callers pass neither option, so their behaviour is unchanged.
3. **`@AC-5`.**
   - `connectThrows: new Error('timeout exceeded when trying to connect')`.
   - `await impl.appendEvent({ request: { streamKey: 'account:a-1', idempotencyKey: 'k-1', eventType: 'x', payload: {} } }, cb)`
     must resolve, not reject.
   - Assert that `cb` was called once with `err.code === 13` and no unhandled rejection, and that `releases` is
     empty (nothing was acquired).
4. **`@AC-10`.**
   - `throwOn: /INSERT INTO ledger\.events/`, with `claimRows: [{ event_id: 'e' }]`.
   - Call with `idempotencyKey: 'k-2'`.
   - Assert `err.code === 13` and `releases.length === 1`, with `releases[0] instanceof Error` and
     `releases[0].message === 'connection terminated'`.
   - Assert that `ROLLBACK` appears in `calls`, and no unhandled rejection.
5. **Success pin.** The existing first-time and duplicate idempotent cases still pass. Their release is called with
   `undefined`.

**Verification** (on 252's compile-then-test runner):
```bash
cd services/xstockstrat-ledger
grep -n '"test:coverage": "tsc &&' package.json   # precondition: one hit (252 Step 4 landed); else Step 8 is blocked
pnpm run test:coverage && pnpm run lint
# c8 --lines 40 passes; 0 failed tests.
node --test --test-reporter=tap dist/__tests__/ledgerServiceImpl.test.js | grep -E '^# (pass|fail) '
# expect: pass > 0 and fail 0 — proves the suite executed rather than skipped
node --test --test-reporter=tap dist/__tests__/ledgerServiceImpl.test.js | grep -E '^ *ok [0-9]+ - .*@AC-(5|10)'
# expect: exactly 2 hits — the two new cases ran and passed
grep -n "never skip silently" src/__tests__/ledgerServiceImpl.test.ts   # the new describe asserts its import
```

Record the red run before Step 7 in the execute log: the same TAP command shows both `@AC-5`/`@AC-10` cases as `not ok`. It is the non-zero-execution proof that
design.md § Build order requires.

---

### Step 9 — docs: config service docs, CONFIG-1 anchors, limitations

**Status**: `pending`
**Service**: `docs` (`services/xstockstrat-config/`, feature directory)
**Files**:
- `services/xstockstrat-config/CLAUDE.md` — modify
- `services/xstockstrat-config/docs/context-constitution.md` — modify
- `docs/roadmap/features/258-fix-config-stream-resilience/context.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-config/CLAUDE.md`:
  - Invariant #4 at `:35`: "Config changes trigger pg_notify → reloads namespace in memory → broadcasts DELTA…".
  - § WatchConfig Flow starts at `:65`. Its tail is "ConfigServiceImpl receives LISTEN notification → Reloads
    namespace from DB → Broadcasts DELTA" (`:87-89`).
- `services/xstockstrat-config/docs/context-constitution.md:18` CONFIG-1 cites
  `configServiceImpl.ts#reloadNamespace (~L197-217; … ~L214)`. This is stale: after Steps 1–3 the code has
  `private async reloadNamespace` at `:288` and `changedKeys: Object.keys(values)` at `:305`. A second
  `changedKeys: Object.keys(values)` at `:338` belongs to `snapshotForSubscriber`. Step 5 shifts these again, and
  instruction 2's grep re-stamp covers that.
- The root CLAUDE.md pool-budget table needs no change. The pooled LISTEN client is unchanged (F-06; design.md
  § Constitution Rules Touched).

**TDD**: `N/A (docs — non-code-bearing)`

**Covers**: —

**Instructions**:
1. Config `CLAUDE.md`:
   - Invariant #4: add one sentence. The LISTEN client issues `LISTEN` before the boot `reloadAll`, and
     notification/reload work runs on one serial chain. On `error`/`end` the client is released with the error,
     and the listener reconnects with backoff (1 s doubling to a 30 s cap; code constants, because config cannot
     watch itself). On reconnect it `reloadAll`s and re-broadcasts a full-namespace DELTA to every subscribed
     `(namespace, environment)`.
   - § WatchConfig Flow: add that a new subscriber is registered pending before its snapshot and gets a catch-up
     DELTA for any change made meanwhile. A snapshot or broadcast failure ends that call with `INTERNAL` (13), so
     the client's reconnect path runs; a cancel or transport error only unregisters.
   - Add one limitation line each:
     - propagation can lag up to about 30 s after a long outage;
     - the listener competes with queries for the 2 pool slots during recovery, and pg-pool's `connect()` wait is
       unbounded;
     - a namespace whose rows were all deleted during an outage keeps its stale snapshot.
2. `docs/context-constitution.md` CONFIG-1: re-stamp the `reloadNamespace` / `changedKeys` line hints against the
   post-Step-5 file (`grep -n "private async reloadNamespace\|changedKeys: Object.keys(values)"`). Add
   `#resyncAll` and the `watchConfig` catch-up as further producers of the full-namespace DELTA.
3. Append to the feature `context.md`:
   - the half-open-socket limitation and the outcome of Step 1's pg_terminate_backend check;
   - the stale-namespace limitation;
   - a pointer to the F-07 rationale already recorded in the sdd-design session.
4. Teardown (root CLAUDE.md § Teardown). Run `/context-forge:context-constitution refresh` scoped to
   `services/xstockstrat-config/`. If the plugin is unavailable, do the manual reconciliation of both touched
   context files against the code, and record both facts in the PR body.

**Verification**:
```bash
grep -n "reconnect\|LISTEN before\|catch-up" services/xstockstrat-config/CLAUDE.md
cd services/xstockstrat-config && grep -n "private async reloadNamespace\|changedKeys: Object.keys(values)" src/grpc/configServiceImpl.ts
# compare with the CONFIG-1 line hints in docs/context-constitution.md — they must match
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Deviation: Step 1 — config LISTEN lifecycle (deferred to operator)
**Spec said**: "If Docker is unavailable in the executing session, the step is **blocked** on this check. … The check
then moves to the dev app (`main-dev` deploy) as a blocker on the integration PR. … Step 1 cannot be marked `done`
until this check has passed, locally or on the dev app. Steps 2–6 may proceed while it is pending."
**Actual**: Step 1 deferred to operator — integration PR merge held until, on the dev app (or a local stack an
operator starts), `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query ILIKE 'LISTEN config_changed%';`
is followed in the xstockstrat-config logs by `config LISTEN connection lost` and, within about 1 s, a new
`listening for config_changed`, and a `SetConfig` of a registered global key then reaches an open WatchConfig
stream. The code is implemented and committed so Steps 2–6 can proceed. The **Verification** block passed
(`pnpm run build` exit 0; `pnpm run lint` exit 0 with 0 errors and the same 158 pre-existing warnings; exactly one
`pool.connect()` at `:188` inside `connectListener`'s try; both backoff constants at `:156-157`). Step **Status**
stays `pending`.
**Reason**: a batch-execute worktree session may not start a database (sdd-execute HARD CONSTRAINT), so the
pg_terminate_backend check cannot run here. The spec's own fallback was applied.
**Disposition**: operator-only check, integration-PR merge blocker.

### Deviation: Step 1 — RED captured with a throwaway probe
**Spec said**: "**TDD**: `red-green required` (Step 2 is the paired test)".
**Actual**: Step 2's suite does not exist yet. RED and GREEN were captured with an uncommitted fake-pool probe run
against the compiled `dist/grpc/configServiceImpl.js`. It checks five things: LISTEN runs before the reloadAll
SELECT; a second connect and a second LISTEN follow `error`+`end`; exactly one `release(err)` occurs; a malformed or
namespace-less payload causes no unhandled rejection; and such a payload issues no namespace query. Step 2 still owns
the committed red→green proof against the pre-Step-1 tree.
**Reason**: the paired test step follows the service step in the spec's order.

### Deviation: Step 2 — log sink recorded (Instruction 0)
**Spec said**: "read the installed `node_modules/winston/lib/winston/transports/console.js` and note which writer its
`log()` calls for `error`-level records. Record that writer in the Deviation Log before any case is written; Step 6
reuses it."
**Actual**: winston 3.19.0 `Console` transport (`console.js:52-89`): `stderrLevels` and `consoleWarnLevels` are empty
by default (`logger.ts` passes no options), so every level, `error` included, goes to `console._stdout.write(...)`,
which Node maps to `process.stdout`. The tests mock `process.stdout.write` with `t.mock.method` and pass each chunk
through to the original. A throwaway probe (`getLogger('t').error('probe')`) passed and was deleted before AC-2 was
written. Step 6 reuses this capture.
**Reason**: the spec required the sink to be confirmed against the installed package; it matched the spec's default.
**Disposition**: as specced (recorded per Instruction 0).

### Deviation: Step 2 — RED captured against the pre-Step-1 source
**Spec said**: "**TDD**: `red-green required`. Against the pre-Step-1 tree".
**Actual**: Step 1 had already landed (907fa340), so RED was run by temporarily restoring
`configServiceImpl.ts` from a482eae2 (the pre-Step-1 commit), compiling, and running the new suite: 8 of 8 new
cases failed for the predicted reasons (boot order `false`; unhandled `error` event on the drop; AC-2's
`connection terminated` escaping as a test failure; the malformed payload's `JSON.parse` throw). The file was then
restored with `git checkout` (no diff) and GREEN run.
**Reason**: the paired test step follows its service step in the spec's order.
**Disposition**: as specced (procedure note).

### Deviation: Step 3 — RED captured with a throwaway probe; anchors drifted after Step 1
**Spec said**: "**TDD**: `red-green required` (Step 4 is the paired test)"; anchors `getConfig` `:319`, `setConfig`
gates `:449-465`.
**Actual**: Step 4's cases do not exist yet, so RED/GREEN were captured with an uncommitted fake-pool probe against
the compiled `dist/grpc/configServiceImpl.js`. RED: `getConfig` (overlay SELECT rejects), the `setConfig` exact-scope
gate and the per-user global-row gate each rejected from the handler with `connection terminated` and never invoked
the callback; the write-try pin already returned code 13. GREEN: all four invoke the callback with code 13, and no
INSERT is issued after a gate failure. Step 1 had shifted the anchors (now `getConfig` `:400`, gates `:534-550`
pre-edit), so the edits were applied by symbol as the spec allows. Lint warnings rose 168 → 172, all
`no-explicit-any` from the spec-mandated `Record<string, any>`, `let existing: any` and two `err: any` catches
(0 errors). Step 4 owns the committed red→green proof.
**Reason**: the paired test step follows its service step in the spec's order.
**Disposition**: as specced (procedure note).

### Deviation: Step 4 — RED captured against the pre-Step-3 source
**Spec said**: "**TDD**: `red-green required`. Against the pre-Step-3 tree, AC-3 and AC-4 reject from the handler
instead of invoking the callback".
**Actual**: Step 3 had already landed (4720488a), so RED was run by temporarily restoring `configServiceImpl.ts` from
907fa340 (the pre-Step-3 commit), compiling, and running the suite: exactly @AC-3 and @AC-4 failed, each with
`Error: connection terminated` rejecting from the handler; @AC-11 and the INVALID_ARGUMENT / NOT_FOUND /
PERMISSION_DENIED pins passed, as predicted. The file was restored with `git checkout` (no diff) and GREEN run.
**Reason**: the paired test step follows its service step in the spec's order.
**Disposition**: as specced (procedure note).

### Deviation: Step 5 — RED/GREEN via a throwaway probe; Step 6 owns the committed proof
**Spec said**: "**TDD**: `red-green required` (Step 6 is the paired test)".
**Actual**: an uncommitted probe test drove the three Step 6 scenarios. It was deleted before commit, along with its
dist output. RED on the pre-Step-5 tree:
- @AC-6 snapshot failure: `call.destroyed?.code` was undefined (expected 13).
- @AC-7: the only write was `[SNAPSHOT 300]`, so the in-flight change to 600 was lost.
- @AC-8 broadcast write failure: `call.destroyed?.code` was undefined, and the failure was logged at warn.

GREEN after the change: 3/3. The probe subscribes with a non-empty `user_id`. A global subscriber's snapshot issues no
SELECT, because `resolveOverlayValues` returns early on `''`. Only a per-user subscriber can therefore hold a
snapshot read in flight, and Step 6 needs the same choice.
**Reason**: the paired test step follows its service step in the spec's order (same as Step 3).
**Disposition**: as specced (procedure note).

### Deviation: Step 6 — RED captured against the pre-Step-5 source; log capture is a describe-local helper
**Spec said**: "**TDD**: `red-green required`. Against the pre-Step-5 tree…" and "Step 6 uses the same inline
pattern in each case that asserts a log line."
**Actual**: Step 5 had already landed (ec5d13d0), so RED was run by temporarily swapping in `configServiceImpl.ts`
from ec5d13d0^ and running the suite: all 6 new cases failed (AC-6/AC-8/trace id: no `destroy`; AC-7: 1 write, not
2; cancel: a write after cancel; idempotent end: 0 termination logs). The file was restored (no diff) and GREEN run.
The Step 2 `process.stdout.write` capture is used unchanged, but it is wrapped once as a describe-local
`captureStdout(t)` for the four cases that read logs, rather than repeated inline four times (DRY guard rail). The
`@AC-2` case was left as is. `makeRig()` gained an `overlay` hook queue, and `fakeCall()` gained a `userId` argument
and a `destroys` counter.
**Reason**: the paired test step follows its service step in the spec's order; four inline copies would trip the DRY
guard rail.
**Disposition**: as specced in substance (procedure and helper-shape note).

### Deviation: Step 7 — RED/GREEN via a throwaway probe; no `client!` needed
**Spec said**: "**TDD**: `red-green required` (Step 8 is the paired test)" and "use `client!` or a narrowed local
(`const c = client`), as lint and tsc allow".
**Actual**: Step 8's cases do not exist yet. RED and GREEN were captured with an uncommitted fake-pool probe run
against the compiled `dist/grpc/ledgerServiceImpl.js`. Pre-change, AC-5 failed (`appendEvent` rejected with
`timeout exceeded when trying to connect`, no callback) and AC-10 failed (`release()` got no Error). Post-change,
3/3 passed, including a success-path pin of `release(undefined)`. tsc narrows `client` after
`client = await this.pool.connect()`, so the try body uses `client.` unchanged, with no `!` and no local alias.
Step 8 still owns the committed red→green proof.
**Reason**: the paired test step follows its service step in the spec's order.
**Disposition**: as specced in substance (procedure note).
