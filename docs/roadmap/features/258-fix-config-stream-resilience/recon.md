# Recon: fix-config-stream-resilience

**Created**: 2026-10-21
**From**: product-spec.md
**Affected services**: xstockstrat-config, xstockstrat-ledger

---

## Objective

Make config's change-propagation path survive DB failures (SEV-2, Track C; scope D-05, D-06, D-35, D-58).
The `LISTEN config_changed` client must reconnect with backoff and re-broadcast on reconnect. `GetConfig`,
`SetConfig` and ledger `AppendEvent` must return a gRPC error instead of hanging on a DB rejection.
`WatchConfig` must lose no delta between snapshot and registration, and must end the call with an error status
when the snapshot or a broadcast fails, so the client's existing reconnect path (`69c8554`) runs.

## Codebase Map

- **`xstockstrat-config`** (Node.js 24 / TypeScript)
  - Entry point: `services/xstockstrat-config/src/index.ts:14` (`main`). The pool is built at `:35-43` with
    `max: parseInt(process.env.DB_POOL_MAX ?? '2', 10)` at `:38` and ssl options at `:39-42`.
    `new ConfigServiceImpl(pool)` at `:47`, and `await configImpl.initialize()` runs once at `:48`.
  - Handler/servicer: `ConfigServiceImpl` — `services/xstockstrat-config/src/grpc/configServiceImpl.ts:155`.
    Its constructor takes only `pool` (`:160`).
  - Last migration: `030_marketdata_edgar_snapshot_keys.up.sql` (`services/xstockstrat-config/migrations/`).
  - Config-read pattern: n/a. Config is the source and never subscribes to itself (`src/index.ts:22-23`; service
    CLAUDE.md invariant #1).
  - Logger: `const log = getLogger('config:impl')` (`configServiceImpl.ts:19`), called as `log.warn/info/error(msg, meta)`.
  - Fix-site symbols:
    - **D-05** `initialize()` — `configServiceImpl.ts:162-174`. `reloadAll()` runs before LISTEN (`:163`). The
      LISTEN client comes from the pool: `const pgClient = await this.pool.connect();` (`:164`). It is never
      released. `LISTEN config_changed` is at `:165`. Only a `notification` listener exists, and it is `async`
      with no try/catch (`:166-172`). Inside it: `JSON.parse(msg.payload)` (`:168`), env defaults to `'staging'`
      (`:169`), then `reloadNamespace` (`:170`) and `broadcastToSubscribers` (`:171`). There is no `error`/`end`
      handler and no reconnect.
    - `reloadAll()` — `:176-201`. Loads global rows only (`user_id IS NULL`, `:181`) and sets every snapshot with
      `updateType: 1` (`:196`). **It does not broadcast.**
    - `reloadNamespace()` — `:203-223`. Snapshot keyed by `snapKey(namespace, env)`, with `updateType: 2` and
      `changedKeys: Object.keys(values)` (`:219-220`). This is the full-namespace DELTA (CONFIG-1).
    - `resolveOverlayValues()` — `:229-243`. Returns early with the global copy when `!userId` (`:232`), so a
      global-only subscriber never queries the DB. The per-user overlay SELECT is at `:233`.
    - `snapshotForSubscriber()` — `:245-258`.
    - **D-58** `broadcastToSubscribers()` — `:260-274`. The catch at `:268-271` logs
      `log.warn('Failed to write to subscriber', { clientId: sub.clientId })` without `err`, then
      `this.subscribers.delete(id)`. It never ends the call.
    - **D-35** `watchConfig(call)` — `:280-313`. It is synchronous. `cancelled`/`error` handlers delete the
      subscriber (`:288-294`), and the `Subscriber` is built at `:296-303` (`lastVersion: '0'`, `:302`).
      `.then((payload) => { call.write(payload); this.subscribers.set(subId, sub); })` (`:305-309`) registers the
      subscriber only after the snapshot. `.catch` only calls `log.warn('Failed to send initial snapshot', …)`
      (`:310-312`), so the stream stays open with no status.
    - **D-06** `getConfig()` — `:315-328`. `await this.resolveOverlayValues(...)` at `:319` is not inside a try.
    - **D-06** `setConfig()`:
      - The existence-gate `await this.pool.query` at `:447-451` is outside any try.
      - The global-fallback `await this.pool.query` at `:457-462` is also outside any try.
      - The NOT_FOUND gate is `code: 5` (`:466-472`). The secret-encryption catch is `code: 13` (`:490-493`).
      - The INSERT and `pg_notify` are already wrapped in a try (`:500-522`), whose catch is
        `callback({ code: 13, message: err.message })` (`:521`). AC-11's write path is therefore already guarded;
        AC-11 is a regression pin.
- **`xstockstrat-ledger`** (Node.js 24 / TypeScript)
  - Handler/servicer: `appendEvent` — `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts` (the
    idempotent branch is at `:73-118`).
    - The plain no-key path is already inside a try (`:61-71`).
    - **D-06**: `const client = await this.pool.connect();` at `:74` comes before the `try` at `:75`.
    - The dedup-branch `await client.query('ROLLBACK')` at `:86` is inside the try. The catch at `:112-115` runs
      `await client.query('ROLLBACK').catch(() => {})` and then `callback({ code: 13, message: \`Internal error: …\` })`.
    - `finally { client.release(); }` is at `:116-118`.
    - Net gap: only the `pool.connect()` rejection escapes. AC-10 (a query rejecting inside the transaction) is
      already covered by the existing catch/finally and acts as a regression pin.
  - Last migration: `003_events_user_id.up.sql` (`services/xstockstrat-ledger/migrations/`).
  - Reference implementation: `EventNotifier` — `services/xstockstrat-ledger/src/services/eventNotifier.ts:25-138`.

## Patterns to REUSE

- **LISTEN lifecycle (FR-1)** → reuse ledger `EventNotifier` (`services/xstockstrat-ledger/src/services/eventNotifier.ts`):
  - `client.on('error', … scheduleReconnect())` and `client.on('end', () => { if (!this.closing) this.scheduleReconnect(); })`
    (`:74-80`).
  - A single-timer guard, `if (this.closing || this.reconnectTimer) return;` (`:110-117`).
  - A `connectedOnce`/`reconnected` flag that fires a re-sync hook only after a *re*-connect, swallowing errors per
    subscriber (`:86-98`).
  - On connect failure, `client.end()` inside a try/catch and then retry (`:99-107`).
  - `makeClient: () => Client` injected through the constructor (`:32-36`), which keeps the class testable with a
    fake client.
  - Caveat: the delay is a **fixed** `reconnectDelayMs = 2000` (`:35`). There is no exponential-backoff helper in
    either service, so the backoff shape and constants are a design decision (product-spec Fix Scope).
- **Notification payload parse (FR-2)** → reuse `EventNotifier.dispatch`, which runs `JSON.parse` in a try/catch,
  ignores a malformed payload, and wraps each subscriber in try/catch (`eventNotifier.ts:119-137`).
- **Re-snapshot on reconnect (FR-1/AC-9)** → reuse `reloadAll()` (`configServiceImpl.ts:176-201`), then
  `broadcastToSubscribers(namespace, env)` (`:260`) for each distinct subscribed `(namespace, environment)`.
  `broadcastToSubscribers` builds its own DELTA payload through `snapshotForSubscriber` (`:265`), so the
  `updateType: 1` that `reloadAll` stores does not leak onto the wire as a SNAPSHOT.
- **gRPC unary error callback (FR-3)** → reuse `callback({ code: 13, message: err.message })` (config
  `configServiceImpl.ts:521`) or ledger's `callback({ code: 13, message: \`Internal error: ${err.message}\` })`
  (`ledgerServiceImpl.ts:68`, `:115`), plus `log.error('appendEvent failed', { error: err.message, … })` (`:67`, `:114`).
- **Ending a server stream with a status (FR-4/FR-5)** → reuse ledger's
  `call.destroy({ code, message })` (`ledgerServiceImpl.ts:285`, `:297`, `:325`). Config has no
  `call.destroy` or `call.emit('error'` today (grep of `services/xstockstrat-config/src`), so this would be the
  first use there.
- **Test fakes** → reuse:
  - ledger `FakeClient` (`services/xstockstrat-ledger/src/__tests__/eventNotifier.test.ts:27-55`), with handlers,
    `emit`, `notify`, `failConnect` and `listens`, as the model for config LISTEN reconnect tests.
  - config `makePool(rows)` (`services/xstockstrat-config/src/__tests__/configServiceImpl.test.ts:30`, `connect:`
    at `:33`), constructed as `new ConfigServiceImpl(pool)`.
  - ledger `makeIdempotentPool(opts)` (`ledgerServiceImpl.test.ts:56`, `async connect()` at `:77`) for AC-5 and
    AC-10.
  - ledger stream tests that already assert `call.destroyed.code` (`ledgerServiceImpl.test.ts:630-645`), as the
    model for a fake `call` asserting the status passed to `destroy`.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-2` "WatchConfig never streams secret plaintext" (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`) — the snapshot and broadcast carry the redaction sentinel. The FR-1 reconnect re-broadcast and the FR-4 reorder must not leak plaintext.
- **PRESERVE** `@AC-14` "A secret stays redacted even inside a per-user WatchConfig overlay" (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`) — overlay redaction. It touches the same overlay SELECT that FR-4 and FR-5 add error handling for, so error handling must not bypass `buildConfigValue`.
- **PRESERVE** `@AC-13` "A per-user override reaches a WatchConfig subscriber through the overlay" (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`) — per-user snapshot resolution. The FR-4 restructure must not alter it.
- **PRESERVE** `@AC-1b` "is_secret is row-authoritative on write, never trusted from the request" (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`) — SetConfig secret handling is unchanged by the FR-3 `try` wrapping.
- **PRESERVE** `@AC-1` "A secret written via SetConfig is persisted encrypted, not plaintext" (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`) — the encrypted write path is unchanged by the FR-3 `try` wrapping.
- **PRESERVE** `@AC-3` "GetConfig and ListKeys redact secrets at the edge" (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`) — the FR-3 GetConfig error path must not change success-path redaction.
- **PRESERVE** `@AC-11` "A per-user config value overrides the global value" (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`) — GetConfig overlay success behavior is unchanged by the FR-3 fix.
- **PRESERVE** `@AC-16 @FR-3 @feature-147` "GetSecret distinguishes an unset secret from a decrypt failure" (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature:56`) — GetSecret is not a fix site, but any shared catch-to-status helper introduced for FR-3 must not alter its found=false / INTERNAL mapping.
- **PRESERVE** `@AC-5` "A registered materializer key is settable via SetConfig without create_key" (`services/xstockstrat-config/acceptance/readiness-materializer-config-keys.feature`) — the existence gate and the SetConfig→GetConfig round-trip.
- **PRESERVE** `@AC-8 @FR-6 @feature-182` "An out-of-bounds tuning write is rejected at the write edge" (`services/xstockstrat-config/acceptance/readiness-materializer-config-keys.feature:24`) — INVALID_ARGUMENT must survive the new SetConfig catch.
- **PRESERVE** `@AC-9` "The bounds are write-path only and change no read path" (`services/xstockstrat-config/acceptance/readiness-materializer-config-keys.feature`) — WatchConfig/GetConfig read behavior is unchanged.
- **PRESERVE** `@AC-5` "An in-bounds tuning write is accepted without create_key" (`services/xstockstrat-config/acceptance/opportunity-config-operability.feature`) — SetConfig success path.
- **PRESERVE** `@AC-4` "An out-of-bounds tuning write is rejected at the write edge" (`services/xstockstrat-config/acceptance/opportunity-config-operability.feature`) — INVALID_ARGUMENT must be kept and not masked by DB-error wrapping.
- **PRESERVE** `@AC-8 @FR-2 @feature-184` "A bounded key whose lower edge is a legitimate value accepts that value" (`services/xstockstrat-config/acceptance/opportunity-config-operability.feature:52`) — SetConfig success path unchanged.
- **PRESERVE** `@AC-11` and `@AC-12` (`services/xstockstrat-config/acceptance/surface-signal-weight-decay-config.feature`) — server-side write validation rejects without persisting. The same INVALID_ARGUMENT vs. DB-error distinction applies.
- **PRESERVE** `@AC-6 @FR-6 @feature-210` "A long-lived streaming RPC survives a certificate rotation" (`docs/sdd/business-rules/platform.feature`) — WatchConfig continuity. The FR-5 end-call-on-error path must not fire on rotation.
- **PRESERVE** `@AC-35 @FR-14 @feature-224 @feature-225` "Two users with the same mcp_client slug use their own credentials" (`docs/sdd/business-rules/platform.feature`) — GetConfig, ListKeys and WatchConfig never return secret plaintext, including on the reconnect re-broadcast.
- **PRESERVE** `@AC-5 @FR-5 @feature-210` "Header-propagation semantics are unchanged beneath mTLS" (`docs/sdd/business-rules/platform.feature`) — error-path edits must not disturb trio propagation (weak relevance).
- There is no existing acceptance suite for ledger `AppendEvent` behavior. The only append-adjacent rule is the offline-positions baseline event (`services/xstockstrat-ledger/acceptance/snapshot-offline-positions.feature`), weakly PRESERVE: the FR-3 restructure must not change append semantics, idempotency dedup, or sequence ordering.
- **EXTEND** — the feature's AC-1 through AC-11 are new guarantees (LISTEN lifecycle, error status on DB rejection, registration ordering, broadcast-failure signalling) that no current scenario covers.
- **No CHANGE flags.** No existing guarantee is deliberately altered, so no C-16 sign-off is needed.
- Out of scope / not impacted:
  - `config-ui-usability.feature` `@AC-6/7/13` (ListKeys `updated_at`).
  - config-secrets `@AC-4/5` (GetSecret; `@AC-16` is kept above only as a shared-error-helper guard).
  - config-secrets `@AC-10/12` (proto field and migration collapse).
  - The readiness/opportunity seed and bounds-value scenarios.
  - surface-signal-weight-decay `@AC-8`.
  - `services/xstockstrat-ledger/acceptance/ledger-event-export.feature` (ExportEvents).
- The first message on a stream must be the SNAPSHOT (service CLAUDE.md invariant #2), but no `@AC` in any suite
  pins that ordering. Treat it as an invariant that FR-4 must hold, not as a C-16 rule.
- Coverage caveat: `config-secrets-and-scoping.feature` and `platform.feature` were read in full. The other four
  config suites and both ledger suites were keyword-grepped only. Several `@AC-n` numbers repeat across suites,
  so always cite the suite path with the tag.

## Dependencies

- Proto/RPC: none. RPCs touched in behavior only: `WatchConfig`, `GetConfig`, `SetConfig` (config) and
  `AppendEvent` (ledger). No message, field or enum changes.
- Migration: none. For reference, the next free numbers are config `031` and ledger `004`.
- Config keys: none. The backoff is a code constant, since a config key would be circular for config's own LISTEN
  client (product-spec Fix Scope). `analysis.backtest.max_duration_seconds` is used only as an AC fixture key.
- Inter-service edges: none new. Every `WatchConfig` subscriber (all backend services, UI, agent) consumes the
  FR-4/FR-5 error-status contract through its existing client reconnect path (`69c8554` for Node; Python D-08 is
  out of scope).
- New env vars / ports: none.
- **Connection budget (F-06)**: config is a direct `:25060` service with pool max 2 (root CLAUDE.md § Connection
  Pool Budget; `src/index.ts:38`). Today the LISTEN client permanently holds one of those 2 pool slots
  (`configServiceImpl.ts:164`, never released). A dedicated `pg.Client` (the ledger model) would add a connection
  beyond the budget-table figure unless the query pool drops to 1 (ledger's `DB_POOL_MAX=1` + 1 listener). The
  budget table must be re-checked either way.

## Risks / Not-found

- **Design fork: where the LISTEN client comes from.**
  - (a) Keep `pool.connect()`, and on error/end call `release(err)` so the pool discards the dead client before
    reacquiring. Same budget, but the listener competes with queries for the 2 slots.
  - (b) A dedicated `pg.Client` via an injected `makeClient` factory (the ledger model). `ConfigServiceImpl`'s
    constructor would need a new parameter (`:160`), and `src/index.ts:35-43`'s connection-string/ssl options
    would have to be shared with it. This raises config's real backend usage by 1 unless the pool max drops
    (F-06 re-check; root CLAUDE.md table, service CLAUDE.md).
- **Design fork: backoff.** Ledger's delay is fixed (2000 ms). FR-1 says "backoff", but no exponential helper exists
  in either service. Constants (initial, cap, jitter) must be pinned so AC-1/AC-9 can run deterministically. The
  product-spec review left this open.
- **Design fork: re-snapshot on reconnect.** Either `reloadAll()` and then broadcast to every distinct subscribed
  `(namespace, env)`, or a per-namespace reload. `reloadAll` only *adds or overwrites* snapshot keys
  (`:190-199`). A namespace whose rows were all deleted during the outage would keep its stale snapshot. This is
  probably acceptable, but it is unverified.
- **Design fork: D-35 ordering.**
  - Register-before-snapshot opens a window in which a DELTA could be written before the SNAPSHOT. Clients expect
    the SNAPSHOT first (service CLAUDE.md invariant #2), so registration needs a "pending until snapshot written"
    state, or a buffer/version check.
  - The `Subscriber.lastVersion` field is declared at `:93` and set to `'0'` at `:302`, and nothing in
    `services/xstockstrat-config/src` reads it (grep). It is free to repurpose as a version gate, or it can be dropped.
  - AC-7's interleaving must be pinned with a controlled promise on the snapshot SELECT. That is a carry-over
    from the product-spec review, which judged AC-7 as worded to be non-deterministic.
- **Design fork: status code.** `UNAVAILABLE` (14) or `INTERNAL` (13) for DB rejections and stream termination. The
  existing convention everywhere is `13`. The specific codes must survive: INVALID_ARGUMENT (bounds), NOT_FOUND
  (existence gate, `:466-472`) and PERMISSION_DENIED (authz).
- **Risk: reconnect storm.** Ending every subscriber's call on a DB outage (FR-5) makes all platform clients
  reconnect at once, and each reconnect's snapshot hits the same failing DB. Clients already back off (`69c8554`).
  This interacts with platform `@AC-6 @feature-210` (streams survive rotation). The end-call path must be reserved
  for server-side failure.
- **Risk: ending a call then writing to it.** After `call.destroy(...)` in the broadcast catch, the subscriber must be
  removed first or atomically, so a concurrent broadcast loop does not write to a destroyed call. The
  `cancelled`/`error` handlers (`:288-294`) also delete it, and a double delete is harmless.
- **Risk: `appendEvent` finally.** If `pool.connect()` moves inside the try, `finally { client.release(); }`
  (`:116-117`) and the catch's `client.query('ROLLBACK')` (`:113`) must be guarded for an undefined `client`.
- **Not found:** no `unhandledRejection`/`uncaughtException` handler in config or ledger `src` (grep). A rejection in
  the async notification handler (`:166`) therefore follows Node 24's default, which terminates the process.
- **Not found:** no existing test of config `initialize()`, the LISTEN lifecycle, `watchConfig`,
  `broadcastToSubscribers`, or the `getConfig`/`setConfig` DB-failure paths. All config pool stubs resolve
  `connect()` to an inert client (`configServiceImpl.test.ts:33`).
- **fails.md trap (2026-07-29, 074-fix-config-write-authz, `fails.md:115-134`):** a test suite that passes with zero
  assertions.
  - The ledger unit suite still has this shape. `ledgerServiceImpl.test.ts:23-26` wraps
    `await import('../grpc/ledgerServiceImpl.js')` in `try … catch {}`, and cases start with
    `if (!impl) return;` (`:145`, …). The ledger test script runs `node --experimental-strip-types` against `.ts`
    (`services/xstockstrat-ledger/package.json:13`).
  - The AC-5 and AC-10 tests must be proven to *execute* (red-before-green, P-06). Sequence this after
    `252-fix-identity-ledger-test-suites`, or verify a non-zero assertion count.
  - Config's suite imports in `before()` (`configServiceImpl.test.ts:18-19`) and runs against compiled `dist/`
    (`services/xstockstrat-config/package.json:12`).
- **fails.md trap (2026-08-16, `fails.md:1284-1288`):** a WatchConfig subscriber must read `value_data`, not
  `default_value`. Any new reload/broadcast path must keep routing rows through `buildConfigValue`.
- **insights.md (2026-08-20, config-secrets-and-scoping):** redact at the single row→message choke point.
  Reconnect and reorder paths must reuse `reloadAll`/`reloadNamespace`/`resolveOverlayValues`, never a new SELECT
  that bypasses `buildConfigValue`.
- **insights.md (2026-08-26, fix-ohlcv-chunk-lock-oom):** a DO single-node psql restart drops every DB connection
  in both environments at once. This is the real-world trigger for D-05, and it confirms that the reconnect-storm
  risk is realistic.
- **Overlaps (from context.md):**
  - `241-fix-config-audit-author-spoof` edits `setConfig` in the same function, so this is a manual merge.
  - `263-fix-edge-owner-scope` touches getConfig `:317-319`.
  - `248`/`257` touch disjoint `ledgerServiceImpl.ts` functions (rebase only).
  - `266-fix-db-tls-fail-closed` changes the startup DB wiring (`src/index.ts:25-43`) that a dedicated LISTEN
    client would share.
- **Docs drift to carry:** if the LISTEN lifecycle changes, update the service `CLAUDE.md` § WatchConfig Flow and
  invariant #4. Update the root CLAUDE.md pool-budget row if the connection model changes. Update
  `services/xstockstrat-config/docs/context-constitution.md` CONFIG-1 line refs (`~L197-217`), which drift with
  edits.

## Recommended Scope

Advisory only; this is input to the grilling and to /sdd-spec.

1. **config LISTEN lifecycle (FR-1, FR-2; AC-1, AC-2, AC-9).**
   - Extract the listener into an `EventNotifier`-shaped unit, or add it inline in `ConfigServiceImpl`, with
     error/end → backoff reconnect, a guarded notification handler, and an on-reconnect `reloadAll` + per-(ns, env)
     broadcast.
   - Settle the pool-vs-dedicated-client fork and the backoff constants, and re-check F-06.
   - Pair with a test step that uses a `FakeClient`-style fake.
2. **config unary handlers (FR-3; AC-3, AC-4, AC-11).** Wrap the `getConfig` `:319` and `setConfig` `:447-462`
   awaits in try → `callback({ code, message })`, keeping NOT_FOUND/INVALID_ARGUMENT/PERMISSION_DENIED intact. Pair
   with a test step.
3. **config WatchConfig ordering and failure (FR-4; AC-6, AC-7).** Register-pending-before-snapshot (or a version
   gate), and on snapshot failure call `call.destroy({ code, message })` and unregister. Pair with a test step
   using a deterministic controlled-promise interleaving.
4. **config broadcast failure (FR-5; AC-8).** Log `err.message` at error level, unregister, and end the call with a
   status. Pair with a test step.
5. **ledger appendEvent connect guard (FR-3; AC-5, AC-10).** Move `pool.connect()` under the guard with an
   undefined-safe release/ROLLBACK. Pair with a test step that is proven to execute (the 252 / fails-074 trap).
6. **Docs.** Service CLAUDE.md WatchConfig Flow and invariant #4, the pool-budget row if it changes, and
   context-constitution line refs.

Steps 1–4 share `configServiceImpl.ts` and should run sequentially. Step 5 is independent.
