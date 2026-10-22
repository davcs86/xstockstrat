# Design: fix-config-stream-resilience

**Created**: 2026-10-22
**Rounds**: 2 (full; termination: approved)
**Approved by**: operator @ 2026-10-22 (design gate r2, "APPROVED as synthesized", including the reconnect-retry fix; Floor clear)
**Grounded in**: recon.md

---

## Chosen Approach

This is SEV-2 Track C, scoped to D-05, D-06, D-35 and D-58. All changes stay inside `ConfigServiceImpl`
(`services/xstockstrat-config/src/grpc/configServiceImpl.ts`, recon.md:23-24) and ledger `appendEvent`
(`services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:73-118`, recon.md:59-64). The fix adds no class,
connection, proto, migration, config key or `src/index.ts` edit (recon.md:146-153). It is internal-only: every
`WatchConfig` subscriber (backend services, UI, agent) and every `GetConfig`/`SetConfig`/`AppendEvent` caller
picks up the error-status contract through its existing client reconnect/error path (`69c8554` for Node,
recon.md:151-152). No UI segment or Agent tool surface changes (C-14).

### 1. LISTEN lifecycle (FR-1, FR-2; AC-1, AC-2, AC-9)

The fix keeps fork (a), the pooled LISTEN client (recon.md:161-167). It ports the ledger `EventNotifier`
lifecycle (recon.md:74-86, `eventNotifier.ts:74-117`).

- **New private fields** next to `:156-158`: `listener: PoolClient | null`, `connectedOnce`, `reconnectTimer`,
  `backoffMs`, and `chain: Promise<void> = Promise.resolve()`.
- **`serial<T>(fn)`**: `const run = this.chain.then(fn); this.chain = run.then(() => undefined, () => undefined); return run;`.
  The caller sees the real rejection, and the stored tail never rejects.
- **`connectListener()`**. The whole body is one try, mirroring `eventNotifier.ts:82-107`:
  - `c = await this.pool.connect()` runs **inside** the try.
  - Attach `error` and `end` handlers that call `dropListener(c, e)`, plus the `notification` handler.
  - Set `this.listener = c`.
  - `await c.query('LISTEN config_changed')`.
  - `await this.serial(() => connectedOnce ? this.resyncAll() : this.reloadAll())`.
  - Set `connectedOnce = true` and reset `backoffMs`.
- **LISTEN before reload on boot.** The boot path now issues LISTEN before `reloadAll`. This closes the lost-NOTIFY
  window between `reloadAll()` (`:163`) and `LISTEN` (`:165`) (recon.md:30-33).
- **The catch in `connectListener()`**:
  - If `c` exists, call `dropListener(c, err)`.
  - If `c` is undefined (`pool.connect()` rejected) and `connectedOnce` is true, call `scheduleReconnect()`
    directly. This is the reconnect-retry fix approved at the r2 gate.
  - If `connectedOnce` is false, rethrow. Boot still fails fast and `index.ts` `main()` exits (recon.md:20-22).
- **`initialize()`** (`:162-174`) becomes `await this.connectListener()`.
- **`dropListener(c, err)`**:
  - `if (this.listener !== c) return;`
  - `listener = null`
  - `c.removeAllListeners('notification')`
  - `try { c.release(err) } catch {}`. Releasing with the error makes the pool discard the dead client.
  - `log.error`
  - `if (connectedOnce) scheduleReconnect()`
  - The identity guard means each client is released exactly once, whatever the order of `error`, `end` and a
    resync failure, and stale notifications are dropped.
- **`scheduleReconnect()`** keeps the single-timer guard from `eventNotifier.ts:110-117` (recon.md:77):
  - It returns early if a timer is already pending.
  - The timer callback sets `reconnectTimer = null` **before** it calls `connectListener().catch(() => {})`
    (`eventNotifier.ts:114`). That catch cannot end the retry loop, because every failure path inside
    `connectListener` reschedules for itself.
  - The backoff starts at 1000 ms, doubles after each schedule, and is capped at 30000 ms. There is no jitter,
    because there is one listener per process.
  - These values are code constants (F-07; recon.md:80-81, :148-149). An optional `opts.listenerBackoff`
    constructor argument (`:160`) may be added for tests; `node:test` mock timers are an acceptable substitute.
- **`resyncAll()`**:
  - `await reloadAll()` (`:176-201`), then `broadcastToSubscribers(ns, env)` (`:260`) once for each distinct
    subscribed `(namespace, environment)` (recon.md:87-90).
  - `broadcastToSubscribers` builds its own DELTA through `snapshotForSubscriber`, so `reloadAll`'s
    `updateType: 1` never reaches the wire.
  - A `reloadAll` rejection propagates to `connectListener`'s catch. The client is released once, `connectedOnce`
    stays true, and a retry is scheduled.
  - A per-subscriber broadcast failure goes to `endSubscriber` and never drops the listener.
- **`onNotification`** (recon.md:85-86, `eventNotifier.ts:119-137`):
  - A guarded `JSON.parse` ignores a malformed payload.
  - The handler then runs `this.serial(async () => { await reloadNamespace(ns, env); await broadcastToSubscribers(ns, env); }).catch(err => log.error('config_changed handling failed', ...))`,
    so a rejection is logged and never escapes (AC-2; recon.md:205-206).
  - Reload and notification work share one chain. A stale `reloadAll` write (`:191`) therefore cannot overwrite a
    newer `reloadNamespace` write (`:214`).

### 2. Unary handlers (FR-3; AC-3, AC-4, AC-5, AC-10, AC-11)

- **`getConfig`**: wrap the DB call at `:319` (recon.md:51) in a try. The catch calls `log.error` and returns
  `callback({ code: 13, message })`, following the `:521` convention (recon.md:91-93).
- **`setConfig`**: wrap only the gate queries (`:447-451`, `:457-462`; recon.md:52-58) in a try with the same catch.
  - These checks stay outside the new try, so their specific codes survive: INVALID_ARGUMENT (`:422-441`),
    NOT_FOUND (`:466-472`), PERMISSION_DENIED (`:391`, `:402`), and the encryption catch (`:490-493`).
  - The existing write try (`:500-522`) is unchanged, so AC-11 is a regression pin.
  - There is no shared error helper. `GetSecret` (`:335-369`) is untouched.
- **Ledger `appendEvent`** (recon.md:63-68, :197-198):
  - Declare `let client: PoolClient | undefined; let failure: unknown;`.
  - Move `client = await this.pool.connect()` from `:74` to the first line inside the try at `:75`.
  - The catch (`:112-115`) sets `failure = err` and runs `if (client) await client.query('ROLLBACK').catch(() => {})`.
    It keeps its existing log and its code-13 return.
  - The finally (`:117`) becomes `client?.release(failure instanceof Error ? failure : undefined)`. A client that
    broke mid-transaction is destroyed, not returned to ledger's `DB_POOL_MAX=1` query pool.
  - The success path, idempotency dedup and sequence ordering are unchanged.

### 3. WatchConfig and broadcast (FR-4, FR-5; AC-6, AC-7, AC-8)

- **Subscriber fields.** `Subscriber.lastVersion` (`:93`, `:302`; unread per recon.md:181-183) is replaced by
  `pending: boolean`, `missedDelta: boolean` and `traceId?: string`.
  - `traceId` is read once with the existing `first(call.metadata, 'x-trace-id')` helper (the form at `:405`), so
    background broadcast and termination logs carry the originating trace id (C-03 operator decision).
- **`watchConfig`** (`:280-313`; recon.md:46-50) registers `{ ..., pending: true, missedDelta: false }` *before* the
  snapshot read, then:
  1. Writes the SNAPSHOT only if `this.subscribers.get(subId) === sub`.
  2. Runs the catch-up loop:
     `while (sub.missedDelta && this.subscribers.get(subId) === sub) { sub.missedDelta = false; const d = await this.snapshotForSubscriber(sub, DELTA); if (this.subscribers.get(subId) !== sub) break; call.write(d); }`.
     Every write is re-guarded after its await.
  3. Sets `pending = false`.
  4. Routes any rejection to `endSubscriber(subId, sub, err)`.
  - SNAPSHOT-first (service invariant #2) is kept without a buffer or version gate (recon.md:177-180).
- **`broadcastToSubscribers`** (`:262-271`; recon.md:43-45):
  - A pending subscriber gets `missedDelta = true` and is skipped with `continue`.
  - A failure calls `endSubscriber` instead of the warn-and-delete.
- **`endSubscriber(id, sub, err)`**:
  - Is idempotent: `if (this.subscribers.get(id) !== sub) return;`.
  - Then runs `delete`, then `log.error` (subId, clientId, traceId, error), then
    `try { sub.call.destroy({ code: 13, message }) } catch {}`, following `ledgerServiceImpl.ts:285` (recon.md:94-96).
  - It is reachable **only** from the snapshot/catch-up chain and the per-subscriber broadcast catch.
- **`cancelled`/`error` handlers** (`:288-294`) still only delete. A certificate rotation therefore never triggers
  the end-call path (platform `@AC-6 @FR-6 @feature-210`; recon.md:125, :188-191).
- All payloads still go through `reloadAll`/`reloadNamespace`/`resolveOverlayValues` → `buildConfigValue`, so
  redaction is preserved (recon.md:211-216).

### Build order (for /sdd-spec)

- **Steps 1–3 (config)** run in sequence, because they share one file. Each step is paired with tests in
  `configServiceImpl.test.ts`. The tests use a FakeClient modelled on ledger `eventNotifier.test.ts:27-55`, a
  release spy, and `makePool` (`:30`) (recon.md:98-105). Required cases:
  - `error` then `end` → exactly one release, and LISTEN is re-run.
  - **The reconnect `pool.connect()` rejects twice, then succeeds and re-broadcasts.** This is the blocking-fix
    test.
  - The reconnect `reloadAll` rejects → the client is released once with the error, then a retry succeeds (AC-9).
  - Interleave: hold `reloadAll` on a controlled promise, deliver a notification, then resolve. The last snapshot
    holds the `reloadNamespace` data, and the DELTAs arrive in order.
  - Boot ordering: LISTEN is issued before `reloadAll`'s query.
  - AC-2: no `unhandledRejection`.
  - AC-3, AC-4 and AC-11, plus explicit INVALID_ARGUMENT and NOT_FOUND regression tests.
  - AC-6 and AC-8 assert the code passed to `destroy`.
  - AC-7: the SNAPSHOT comes first, then a catch-up DELTA that carries 600. The interleaving is pinned with a
    controlled promise on the snapshot SELECT.
  - Cancel during catch-up: no write after cancel, a single log line, and no destroy.
  - **Required Verification for step 1:** a dev `pg_terminate_backend` check on the LISTEN backend. It shows that
    the pooled client emits `error`/`end` and that propagation resumes.
- **Step 4 (ledger)** is independent.
  - Precondition: either `252-fix-identity-ledger-test-suites` has merged, or the step's first edit removes the
    `try { import } catch {}` / `if (!impl) return;` shape (`ledgerServiceImpl.test.ts:23-26`, `:145`) for the
    new cases (recon.md:201-208).
  - Verification needs both of these: AC-5 and AC-10 fail on current code, and the run reports a non-zero
    assertion count.
  - Add a test that a mid-transaction failure calls `release` with the error.
- **Step 5 (docs)**:
  - Config `CLAUDE.md` § WatchConfig Flow and invariant #4: reconnect, LISTEN-before-reload, the serial chain and
    the re-broadcast.
  - The CONFIG-1 line refs in `services/xstockstrat-config/docs/context-constitution.md` (recon.md:226-230).
  - `context.md`: the F-07 rationale, the half-open limitation and the stale-namespace limitation.
  - The root pool-budget table needs no change, because the connection model is unchanged.

## Rejected Alternatives

- **Fork (b), a dedicated `pg.Client` via an injected `makeClient`** (the ledger EventNotifier model) — rejected
  because it needs an `index.ts` edit (overlaps 266) and an F-06 re-check (+1 direct connection, or dropping the
  query pool to 1). The blocking bug it would have avoided is fixed by moving `connect()` inside the try. It
  remains the **fallback** if the dev `pg_terminate_backend` check shows that the pooled client does not emit
  `error`/`end`.
- **Reusing `EventNotifier` directly (shared package or copy)** — rejected because there is no shared Node package
  for it. Its fixed delay and `onReconnect` API also hide `reloadAll` failures from the reconnect path. A copy
  would duplicate code without removing the config-specific logic.
- **`keepAlive: true` in the `index.ts` pool config** — deferred, because the operator asked for low rework and 266
  owns that object. The half-open gap is handled by the required dev check and a recorded limitation.
- **A periodic `SELECT 1` keepalive on the listener client** — rejected because it adds a LISTEN-client
  `query_timeout` trap surface (`fails.md:3006-3021`).
- **The round-1 serial shape `then(fn, fn).catch(log)`** — rejected because it swallowed `reloadAll` failures, so
  the reconnect path never saw them. It is replaced by a `serial()` that returns the real link and stores a
  non-rejecting tail.
- **A per-client `released` flag** — superseded by the `this.listener !== c` identity guard, which also drops stale
  notification events.
- **Buffering and replaying missed DELTAs** — rejected because one fresh full-namespace DELTA (CONFIG-1) covers any
  number of missed ones.
- **Version-gating with `lastVersion`** — rejected because nothing reads it, and `pending`/`missedDelta` keeps the
  SNAPSHOT first with less mechanism.
- **Swapping a fresh Map inside `reloadAll` to clear emptied namespaces** — rejected because it changes boot
  semantics for every namespace. Recorded as a limitation instead.
- **UNAVAILABLE (14) for stream termination and DB failures** — rejected because 13 is the existing convention, and
  Node watchers reconnect on any error.
- **A shared gRPC error helper** — rejected so that `GetSecret` `@AC-16` and the existing early-return shapes stay
  untouched.
- **Soft start at boot with an empty cache** — rejected because every client would get an empty SNAPSHOT. Boot
  stays fail-fast.

## Open Risks

- [ ] **Half-open socket.** The pooled LISTEN client may not emit `error`/`end` on a half-open or silently dropped
  socket, because `index.ts` sets no keepAlive. AC-1 and AC-9 could then pass against the FakeClient only.
  — to be addressed at step 1 Verification (dev `pg_terminate_backend` check). Fork (b) is the fallback.
- [ ] **Pool contention during recovery.** The listener competes with queries for the 2 pool slots. pg-pool's
  `connect()` wait is unbounded (no `connectionTimeoutMillis`), so a reconnect can queue behind in-flight queries,
  and notification handling slows while the chain is backed up. — to be documented at step 5 (service CLAUDE.md /
  context.md limitation).
- [ ] **Stale namespaces.** A namespace whose rows were all deleted during an outage keeps a stale snapshot. This is
  an accepted limitation. — to be recorded at step 5 (context.md).
- [ ] **Merge overlaps.** 241 edits `setConfig`, and 263 edits `getConfig` `:317-319`, so both need a manual merge.
  266 owns `index.ts`, which this design avoids. — to be addressed at /sdd-spec (merge-order rows) and the
  integration PR.
- [ ] **Zero-assertion green in ledger tests.** The import-swallow in the ledger test suite
  (`ledgerServiceImpl.test.ts:23-26`, `:145`) can produce a zero-assertion green. — to be addressed by the step 4
  precondition and its non-zero-assertion Verification.
- [ ] **Propagation lag after a long outage.** With the backoff capped at 30 s, propagation can lag by up to about
  30 s after a long outage ends. This is acceptable because resync-on-reconnect makes the lag self-healing. — to
  be recorded at step 5 (service CLAUDE.md § WatchConfig Flow).

## Constitution Rules Touched

- `C-03` — honored by: request handlers keep their inbound metadata. Each WatchConfig subscriber carries its inbound
  `x-trace-id` (via `first()`) into background broadcast and termination logs. Only the listener/reconnect path,
  which has no originating request, mints its own log context (standing operator decision, 2026-10-21).
- `C-11` — honored by: a 2-round full-mode debate with recon, and operator approval at the r2 gate.
- `C-15` — honored by: every behavior maps to `acceptance.feature` AC-1..AC-11, each pinned by a named test above.
  AC-7's interleaving is made deterministic with a controlled promise.
- `C-16` — honored by: the Business Rules section below. The CHANGE lines cite the operator decision, and the
  durable suites are PRESERVE.
- `C-18` — honored by: the trace id is read with the existing `first(call.metadata, 'x-trace-id')` helper
  (`:405`), not the array-returning `call.metadata.get`.
- `F-06` — honored: the pooled LISTEN client is unchanged, so config's direct-connection budget (pool max 2) is
  unchanged. No root CLAUDE.md budget-table edit is needed.
- `F-07` — honored: the backoff constants (1000/30000 ms) are code constants, because config cannot watch itself
  (service invariant #1). Ledger `eventNotifier.ts:35` is the precedent. The rationale is recorded in context.md.
- `P-02` — honored by: the proposer and the adversary exchanged only mediated synthesis state.
- `P-03` — honored by: every claim cites recon.md path:line. The r2 blocking defect (`pool.connect()` outside the
  try) was checked against `eventNotifier.ts:82-114` before the fix was adopted.
- `P-06` — honored by: red-before-green is required per step. The ledger step has an explicit precondition and a
  non-zero-assertion check (`fails.md` 074 trap).
- `PLAT-N1` — honored by: the background failure paths (notification, resync, broadcast) log at error level and
  recover. They never swallow silently, and they never crash the process.
- `CONFIG-1` — honored by: reconnect and catch-up deliveries are full-namespace DELTAs built by
  `snapshotForSubscriber`. The line refs are updated at step 5.

## Business Rules Touched (C-16)

- CHANGE `@AC-1` "Config change propagation resumes after the LISTEN connection drops" (`acceptance.feature:5`) —
  signed off by operator @ 2026-10-21 (Track C, scope D-05/D-06/D-35/D-58; context.md sdd-review session) and
  2026-10-22 (design gate r2 approval).
- CHANGE `@AC-2` "A failing reload inside the notification handler does not crash config" — signed off by operator
  @ 2026-10-21 / 2026-10-22 (same references).
- CHANGE `@AC-3` "GetConfig returns an error status when the per-user overlay query fails" — signed off by operator
  @ 2026-10-21 / 2026-10-22.
- CHANGE `@AC-4` "SetConfig returns an error status when the existence-gate query fails" — signed off by operator
  @ 2026-10-21 / 2026-10-22.
- CHANGE `@AC-5` "Idempotent AppendEvent returns an error status when no pool connection can be acquired" — signed
  off by operator @ 2026-10-21 / 2026-10-22.
- CHANGE `@AC-6` "A failed initial WatchConfig snapshot ends the stream with an error status" — signed off by
  operator @ 2026-10-21 / 2026-10-22.
- CHANGE `@AC-7` "A change committed while the initial snapshot is being built still reaches the new subscriber" —
  signed off by operator @ 2026-10-21 / 2026-10-22.
- CHANGE `@AC-8` "A subscriber whose broadcast fails is told to reconnect instead of silently dropped" — signed off
  by operator @ 2026-10-21 / 2026-10-22.
- CHANGE `@AC-9` "A change committed while the LISTEN connection is down reaches subscribers after reconnect" —
  signed off by operator @ 2026-10-21 / 2026-10-22 (the r2 approval explicitly covers the reconnect-retry fix and
  the reject-twice-then-succeed test).
- CHANGE `@AC-10` "Idempotent AppendEvent returns an error status and releases its client when a query in the
  transaction fails" — signed off by operator @ 2026-10-21 / 2026-10-22. The release now carries the error, so the
  broken client is destroyed.
- PRESERVE `@AC-11` "SetConfig returns an error status when the value write fails after the existence gate passes"
  — not regressed by: the existing write try (`:500-522`) is unchanged, and the new try covers only the gate
  queries.
- PRESERVE `@AC-6 @FR-6 @feature-210` "A long-lived streaming RPC survives a certificate rotation"
  (`docs/sdd/business-rules/platform.feature`) — not regressed by: the `cancelled`/`error` handlers only delete,
  and `endSubscriber` is reachable only from the snapshot/catch-up chain and the per-subscriber broadcast catch.
- PRESERVE config-secrets `@AC-1` / `@AC-1b` / `@AC-16`
  (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`) — not regressed by: the encrypted
  write path and row-authoritative `is_secret` are untouched, there is no shared error helper, and `GetSecret` is
  untouched.
- PRESERVE config-secrets `@AC-2` / `@AC-14` and platform `@AC-35` (redaction) — not regressed by: every reload,
  resync and catch-up row still goes through `buildConfigValue`, and no new SELECT is added.
- PRESERVE readiness `@AC-8 @feature-182`, opportunity `@AC-4` / `@AC-8`, and surface-signal `@AC-11` / `@AC-12`
  (INVALID_ARGUMENT bounds) — not regressed by: the bounds checks (`:422-441`) stay outside the new `setConfig`
  try.
