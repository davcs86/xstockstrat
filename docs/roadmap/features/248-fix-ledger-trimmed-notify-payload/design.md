# Design: fix-ledger-trimmed-notify-payload

**Created**: 2026-10-21
**Rounds**: 3 (full; termination: approved — auto-approved under operator standing authorization 2026-10-21)
**Approved by**: orchestrator auto-approval under operator standing authorization @ 2026-10-21 (rounds ≥ 2, no Floor breach, no blocking objection, no CHANGE to an existing `@AC`; decisions recorded verbatim in context.md)
**Grounded in**: recon.md

---

## Chosen Approach

Resolve each trimmed NOTIFY row once, in global NOTIFY order, inside `EventNotifier` before fan-out. The read runs on
the dedicated LISTEN client, never the query pool. Internal-only (C-14): no consumer-surface step
(recon.md:127); the existing `StreamEvents` contract is restored for analysis and portfolio, whose reconnect paths
are unchanged (recon.md:84).

**1. `EventNotifier`** (`services/xstockstrat-ledger/src/services/eventNotifier.ts`, fan-out at recon.md:30-35)

- a. Constructor `(makeClient, opts: { resolveRow: (client, stub) => Promise<row|null>; channel?; reconnectDelayMs? })`.
  `resolveRow` is required, so a missed wire-up fails to compile rather than shipping stubs. The notifier holds no
  Pool and no SQL. The test at `eventNotifier.test.ts:154-162` migrates to `{ reconnectDelayMs: 1 }`.
- b. `NotifySubscription` (`:6-18`) gains a required `onGap({ notFound, message })`. Errors are signalled through
  `onGap`, not thrown, because `dispatch` swallows `onEvent` throws (recon.md:33, :147).
- c. `dispatch` (`:119-137`) parses the row, then:
  - Fast path iff `!this.draining && this.queue.length === 0 && row.payload !== undefined`. It calls
    `fanOut(row, matching(row))`, with `fanOut` being the loop extracted from `:128-136`. Fan-out stays synchronous,
    as it is today.
  - Otherwise it pushes `{ row, subs: matching(row) }` (a snapshot taken at enqueue) and starts `drain()` unless
    `draining` is already set.
  - Stub detection is `row.payload === undefined`, in this one place (recon.md:87). The stub still carries
    `stream_key` and `event_type`, so filtering is unaffected (recon.md:32, :38).
- d. `drain()` is serial and never rejects. It sets `draining = true` and loops on the head:
  - A full row is fanned out to `subs ∩ live`.
  - A trimmed row with empty `subs` is skipped without a read.
  - A trimmed row otherwise runs `await opts.resolveRow(this.client, row)`. A null `this.client` throws.
  - After the await, `subs` is intersected with the live Set. On success the resolved row is fanned out. On error
    or null, each sub gets `subscribers.delete(sub)` followed by `sub.onGap(...)`.
  - It logs `log.warn('trimmed row resolve failed', { eventId, sequence, reason: not_found|error|timeout, elapsedMs, queueDepth })`.
  - `draining = false` is set in `finally`.
- e. Stale-drain guard. Each pass captures `const q = this.queue, g = this.gen`.
  - If `g !== this.gen` after the await, the result is discarded and nothing is shifted, because the array was
    replaced. `draining` is set to false, and `drain()` restarts if `this.queue` is non-empty.
  - Otherwise `q` is shifted only after the head has been handled.
- f. Wedged-listener teardown. When `resolveRow` rejects with pg's `Query read timeout` (the 2B backstop), the
  notifier ends or destroys `this.client`. pg leaves the active query on the connection, so without this the
  listener stays wedged until TCP gives up.
  - The existing `'end'`/`'error'` → `scheduleReconnect` → `connect()` → `onReconnect` path (recon.md:35) then
    resyncs every stream within about 2B + `reconnectDelayMs`.
- g. `connect()` (`:89-97`, before the `onReconnect` loop) and `stop()` (`:53-69`) both run `gen++` and `queue = []`.
  Queued rows are therefore never written to calls that `onReconnect` already ended.

**2. Resolver** (a free function beside `EventNotifier` or in a small repo module, not in `ledgerServiceImpl.ts`; C-18
layering)

- a. `resolveEventRow(q, stub, timeoutMs)` returns `rows[0] ?? null`. It runs:
  - `q.query({ text: 'SELECT * FROM ledger.events WHERE event_id=$1 AND recorded_at=$2::timestamptz', values: [stub.event_id, stub.recorded_at], query_timeout: 2*timeoutMs })`.
  - The key is the PK `(event_id, recorded_at)`, so the read prunes to one chunk (recon.md:47, :153).
  - `$2` is the raw `json_build_object` string from the stub (recon.md:38), never passed through `new Date`.
  - The row is mapped by the single `rowToEvent` (recon.md:42, :79); there is no second mapper.
- b. `streamResolveTimeoutMs(config)` returns `getInt('ledger.stream.resolve_timeout_ms', 2000)` with a
  `Number.isFinite` guard, floored, and ≤0 → 2000. The guard is needed because `getInt` does not validate
  (`configWatcher.ts:112-115`). The call-site default follows the existing `getBool` pattern (recon.md:44).
- c. Wiring at `index.ts:51` (recon.md:21):
  - `makeClient = () => new Client({ connectionString: dbUrl, ssl: sslOption, statement_timeout: streamResolveTimeoutMs(configWatcher) })`.
  - `resolveRow = (c, s) => resolveEventRow(c, s, streamResolveTimeoutMs(configWatcher))`.
  - The query pool (`index.ts:44`) is untouched, so `AppendEvent` is unchanged and F-06 stays at 1 pool + 1 listener
    (recon.md:138).
- d. Bounds:
  - The server-side `statement_timeout` B is the primary bound: 57014 → `onGap` → code 14.
  - `query_timeout` 2B is the backstop for an undeliverable cancel: `onGap` plus the 1.f teardown.
- e. Listener rule: the listener client never opens a transaction and never runs a bulk read, because a transaction
  on the LISTEN session holds back NOTIFY delivery. For that reason `BEGIN; SET LOCAL` is rejected (see Rejected).
- f. Live-ness of B is open (see Open Risks). Either issue a session-level `SET statement_timeout = n` (autocommit)
  before a resolve when B differs from the value last applied, or document "applies on listener reconnect". The
  mediator prefers SET-on-change.

**3. `streamEvents`** (`ledgerServiceImpl.ts:182-260`, recon.md:22-29)

- `onGap` calls `cleanup()`, then `call.destroy({ code: notFound ? 13 : 14, message })`, following the precedent at
  `:285` (recon.md:84).
  - It never calls `call.end()`: portfolio treats `io.EOF` as a clean close (recon.md:69, :84).
  - Both consumers reconnect and replay on a non-OK status, so no consumer change is needed (recon.md:53, :65, :84).
- `Number()` is applied at `:191`, `:196`, `:210` and `:256`, normalising the pg BIGINT string against the NOTIFY JSON
  number (recon.md:154-157).
- `cleaned` guards the flush (`:251`), not the replay loop (`:243`). Writes after `onGap` go to a destroyed call and
  are dropped; that is lossless because the client replays the gap.
- `writeRow` remains the single sink and the only place `maxSeq` advances (recon.md:24, :86).
- The LEDGER-2 synchronous flush is preserved: no `await` enters `streamEvents` (recon.md:29, :88, :143-146).

**4. Config (F-07)**

- Key `ledger.stream.resolve_timeout_ms` (int, default 2000).
- Seeded by config migration `031_ledger_stream_resolve_timeout` (staging + production, global), copying
  `022_ledger_export_keys.up.sql:15-30`.
  - `value_type` MUST be `'int'`: a `'string'` row makes `getInt` silently return the default (`022:11-13`).
  - Re-derive NNN across remote branches at /sdd-spec; 030 is the latest here.
- No `packages/proto` PR, following the 022 precedent. `services/xstockstrat-config/CLAUDE.md:103` is drift and goes
  to the teardown.
- Register the key in the config-governance per-feature log and the ledger `CLAUDE.md` Config Keys table.
- Owner + config-team approval is a pre-merge gate in the impl-spec. The fallback is the named constant
  `RESOLVE_TIMEOUT_MS` with a recorded F-07 ruling.
- This supersedes recon.md:44 and :133 ("no config key").

**5. AC-9 (new, appended under C-15; EXTEND)**

- Scenario: "A trimmed event whose full-row read exceeds the resolve bound ends only matching streams non-OK."
  - Given B = 200 and a live subscriber whose last delivered sequence is 10.
  - When an 8000-char event is appended as 11 and a 100-char event as 12.
  - Then no message arrives for 11 or 12.
  - And the stream ends non-OK within 2B.
  - And a new stream opened from 11 receives 11 and 12 complete, in order.
- The clause "AppendEvent for 12 returns while the read is blocked" is dropped. Under the LISTEN-client resolve it
  cannot go red; the structural "resolve never borrows a pool connection" assertion moves to tier (ii).
- Tier (iv) harness:
  - The listener is built with the real `makeClient` closure over a fake config returning 200.
  - A `pg_sleep(1)` `resolveRow` wrapper is the whole seam: 57014 fires inside the wrapper, so the real
    `resolveEventRow` is proven only by the trigger-stub round-trip test.
  - The `query_timeout` backstop and the wedged-listener teardown are unit-only. They go in the Deviation Log, not in
    `**Covers**` (recon.md:177).

**6. Test tiers** (C-08; harnesses at recon.md:89-93)

- **(i) Notifier unit:** `FakeClient` (`eventNotifier.test.ts:27-55`) plus a fake `resolveRow`, extended to return a
  row, error, null or hang. It covers:
  - AC-2, AC-3, AC-8, and the notifier side of AC-6/7/9;
  - resolve held open → full row → release, asserting stub-then-full order;
  - a subscriber added after enqueue is not `onGap`'d;
  - the queue is cleared on reconnect and on stop;
  - a gen bump during an in-flight resolve does not shift or drop the new queue head;
  - a backstop timeout ends the client and triggers `onReconnect`.
- **(ii) Wired:** the real `EventNotifier`, the real resolver and a borrow-counting fake pool. It covers AC-1, AC-4
  (zero pool borrows by the resolve, `write()` → false) and AC-5.
- **(iii) `streamEvents`:** via `makeStreamCall` (`ledgerServiceImpl.test.ts:545-565`). It covers the 13/14 mapping,
  destroy-not-end, and a replayed `"99"` followed by a resolved `100`.
- **(iv) Real TimescaleDB:** a new CI job, `ledger-db-test`.
  - Script: `"test:db": "tsc && node --test dist/__tests__/db/*.test.js"`. It rides on feature 252's compile-then-test
    (252 `design.md:25-31` on `origin/feature/fix-identity-ledger-test-suites`), which drops the `tsconfig.json:22`
    test exclude.
  - Tests live in `src/__tests__/db/*.db.test.ts`, outside the non-recursive unit/coverage glob. `before()` throws if
    `LEDGER_DB_TEST_URL` is unset, so the suite fails rather than skips.
  - Toolchain is copied from `node-test` (`ci.yml:566-580`); the DB and migrator from `migration-rerun`
    (`ci.yml:640-669`).
  - The job is gated on `xstockstrat-ledger` (`ci.yml:60`), migrations, proto, ci and `node-shared` (`ci.yml:48-51`),
    and is added to `ci-gate.needs` and the evaluate list (`ci.yml:773-788`).
  - Scope: trigger stub → resolve with full-field equality to `GetEvent` plus an EXPLAIN showing one chunk; AC-6/AC-7
    replay recovery; AC-9 as scoped in item 5.
- Red-before-green follows fails.md 021/074 (recon.md:176): the tests must prove the real impl loaded.

**7. Docs and teardown obligations (for /sdd-spec to step)**

- Product spec: amend FR-2 ("borrows and releases the query-pool connection" → "read on the dedicated LISTEN
  connection, never the query pool, never held across `call.write`"). Flip Fix Scope "No config key changes" to one
  key. Record both with a Status History note. No existing `@AC` text changes.
- Add a `LEDGER-8` row to `services/xstockstrat-ledger/docs/context-constitution.md`: "EventNotifier client runs only
  single-statement PK reads bounded by `statement_timeout`; never a transaction or bulk read".
- Add the resolve-order and bound rule to LEDGER-2.
- Update the "Split pool" pointer (`:35`) and ledger `CLAUDE.md` § Live Streaming Architecture, and fix "three" →
  "five" portfolio subscriptions (recon.md:164).
- Close `docs/context-constitution-findings.md:36` (recon.md:164).
- Add a `merge-order.md` row: 248 after 252 (router).
- Run the teardown (fails.md:670).

## Rejected Alternatives

- Option (b), bound the statement on the query pool — rejected because an unpaged replay holds the only pool
  connection (recon.md:21, :27). Fan-out would stall or `onGap` during portfolio's restart replays, ending streams more
  often than today (`@AC-6 @feature-210`, recon.md:111).
- Option (c), prove B exceeds the worst-case replay hold and page the replay — rejected because it needs
  production-scale evidence and a replay redesign; out of scope for this fix.
- Round-2 pool borrow with the `pool.connect()` wait inside B — rejected because it turns replay contention into
  `onGap` (round-2 blocking objection 2).
- `BEGIN READ ONLY; SET LOCAL statement_timeout` per resolve — rejected under the LISTEN-client resolve. A
  transaction on the LISTEN session holds back NOTIFY delivery and costs extra round-trips. Superseded by the startup
  `statement_timeout` plus `query_timeout`.
- Fast-path predicate `queue.length === 0 && payload !== undefined` (round 2) — rejected because a full row overtakes
  an in-flight resolve, and the resolved row is then dropped at `ledgerServiceImpl.ts:210` (`@AC-2 @feature-042`).
- Client-side `Promise.race` as the only bound — rejected because it leaves the hung query holding the connection; a
  server-side cancel is required.
- Self-contained `tsconfig.dbtest.json` for tier (iv) (r3 adversary) — rejected because 252's approved design
  (`design.md:201` on its branch) rejects a separate test tsconfig for DRY and parity.
- AC-9 harness via `LOCK TABLE ledger.events ACCESS EXCLUSIVE` — rejected because it also blocks the `AppendEvent`
  INSERT.
- Presenting the AC-9 `pg_sleep` wrapper as proof of the real resolver — rejected as a claim. It proves only that the
  listener session honours `statement_timeout`; the gap goes in the Deviation Log.
- Relying on TCP give-up to clear a wedged listener — rejected because it takes about 15 minutes with keepAlive off.
  Replaced by an explicit teardown.
- Resolving per subscriber inside `onEvent` — rejected because it puts an `await` in the synchronous LEDGER-2 flush
  and lets later NOTIFYs overtake the resolved row (recon.md:143-146). It costs about 2 reads per event, not 6.
- A per-stream promise chain in `streamEvents` — rejected because it makes the LEDGER-2 flush async and duplicates
  ordering logic.
- Ending the stream on every stub and letting replay recover (recon.md:85, :194) — rejected because it fails AC-1/3/8
  live delivery and ends streams more often than today.
- Re-fetch by `event_id` alone (getEvent SQL) or by `sequence` — rejected because both probe every chunk
  (recon.md:153). `sequence` is kept only as a fallback if the `recorded_at` round-trip fails.
- Injecting the raw Pool into `EventNotifier`, or passing the resolver as an optional positional argument — rejected.
  The first breaks the pool decoupling (`eventNotifier.ts:20-24`); with the second, a forgotten wire-up silently ships
  stubs.
- A pool-wide `statement_timeout` or `connectionTimeoutMillis` — rejected because it changes `AppendEvent`
  (`ledgerServiceImpl.ts:63`, `:74`).
- Named constant `RESOLVE_TIMEOUT_MS` with an F-07 ruling — runner-up only; it is the fallback if config-team approval
  blocks the fix path.
- Terminating with `call.end()` — rejected because portfolio treats `io.EOF` as a clean close (recon.md:69, :84).
- A trigger change in a new migration to stop trimming — rejected because the payload alone can exceed the 8000-byte
  NOTIFY limit. The char-vs-byte mismatch (recon.md:163) stays out of scope and is not folded in.
- Batch resolve `WHERE (event_id, recorded_at) IN (...)` — deferred (YAGNI).

## Open Risks

- [ ] Unproven LISTEN-session assumptions, all proven only by tier (iv):
  - pg emits `'notification'` while a query is in flight on the same client.
  - Postgres delays, and does not drop, NOTIFYs to a busy listener backend.
  - The `statement_timeout` startup parameter is honoured on the direct `:25060` route.
  - The stub's `recorded_at` text round-trips through `$2::timestamptz`. If it does not, every large event takes the
    AC-7 path, causing a reconnect storm.
  - To be addressed at: the tier (iv) step.
- [ ] Feature 252 is implementation-ready but unmerged. Tiers (i)-(iii) are vacuous until it lands
  (`eventNotifier.test.ts:152`), and `test:db` rides on its scripts. If 252 slips or changes, every real-DB claim slips
  with it and goes to the Deviation Log. To be addressed at: /sdd-spec, with a merge-order row 248-after-252 (router).
- [ ] Under 252's parity, the production `tsc` also emits `src/__tests__/db/**` (252 `design.md:174`), so a DB test
  importing a test-only dependency would break the image build. To be addressed at: the tier (iv) step.
- [ ] Head-of-line latency: K trimmed events in a burst cost up to K×B, or K×2B on the backstop, of live fan-out delay
  for every subscriber. Losslessness holds; latency is unmeasured. Mitigation is `queueDepth` in the `log.warn`. To be
  addressed at: the EventNotifier step.
- [ ] A spurious `Query read timeout` (GC pause, event-loop stall over 2B) causes an avoidable fleet-wide resync
  through the 1.f teardown. To be addressed at: the EventNotifier step (document it).
- [ ] B live-ness (F-07): the startup `statement_timeout` applies only on (re)connect, while the 2B backstop reads B
  live. Choose SET-on-change (preferred) or document "applies on listener reconnect". To be addressed at: /sdd-spec,
  in the resolver step.
- [ ] Config-team approval for `ledger.stream.resolve_timeout_ms` is on the critical path. The fallback is
  `RESOLVE_TIMEOUT_MS` with a recorded F-07 ruling. To be addressed at: a pre-merge gate in the impl-spec.
- [ ] Observability: timeouts and errors map to 14, which portfolio logs at Info (`portfolio_service.go:194-195`). The
  ledger `log.warn` is the only signal, and a counter is deferred (accepted). To be addressed at: no step; accepted.
- [ ] ts-proto encoding of a string `sequence` on resolved rows is assumed from the replay path and was not traced in
  generated code. To be addressed at: tier (iii).
- [ ] Pre-existing, out of scope:
  - a NOTIFY between the reconnect `LISTEN` and the `onReconnect` loop (`eventNotifier.ts:84-97`);
  - unbounded grpc-js write buffering behind a stalled reader (recon.md:152), to which the FIFO adds a second
    unbounded queue;
  - pre-fix stubs already consumed by analysis, whose data-repair report is owed (recon.md:160-161);
  - the char-vs-byte trim mismatch (recon.md:163).
  - To be addressed at: no step; a separate defect report or reports.
- [ ] Checkout drift: the local main-dev copy lacks recon.md and shows 252 as `draft`. Downstream steps read
  `origin/feature/*` or run `/sdd-sync`. To be addressed at: /sdd-spec boot.

## Constitution Rules Touched

- `C-01` — honored by: the cited code was spot-verified:
  - pg@8.20.0 `lib/client.js:387-394` and `:608-662`;
  - `ci.yml:48-51` and `:582-584`;
  - `configWatcher.ts:112-115`, `022_ledger_export_keys.up.sql:11-13` and `eventNotifier.ts:53-117`.
  - The stale "252 is draft" read was corrected against its feature branch.
- `C-08` — honored by: every code step pairs with a tier. Tier (iv) has a concrete build, toolchain, DB and gate path.
  The backstop and teardown tests are unit-only and are recorded as such.
- `C-11` — honored by: a full-mode debate of 3 rounds (≥2), with no blocking objection, Floor breach or `@AC` CHANGE
  remaining. It was auto-approved under the operator standing authorization.
- `C-14` — honored by: internal-only, with no consumer-surface step (recon.md:127).
- `C-15` — honored by: AC-1..AC-9 map to named tiers. AC-9 is new, appended rather than rewritten, and its harness
  limits are stated.
- `C-16` — honored by: durable rules are PRESERVE (see below). The feature `@AC`s are promoted to
  `services/xstockstrat-ledger/acceptance/` at launch (recon.md:119).
- `C-18` — honored by:
  - YAGNI: no counter, no batch resolve.
  - DRY: it reuses the LISTEN client, `rowToEvent`, the `destroy` and `getInt` patterns, the CI steps and 252's runner.
  - Layering: the resolver sits outside the gRPC module.
  - The FIFO trade-off is stated honestly: it saves about 1 read per trimmed event versus about 2 per-subscriber. Pg's
    per-client query queue serializes resolves anyway, so the FIFO adds no head-of-line coupling beyond what is
    inherent. The decision stands on global order and the synchronous LEDGER-2 flush.
- `P-02` — honored by: only mediated synthesis carried between rounds.
- `P-03` — honored by: the 252 dependency is grounded in its approved design, and the proto-touch question is settled
  (no PR; drift goes to the teardown).
- `P-04` — honored by: the product-spec FR-2 / Fix Scope amendment and the config-team approval are recorded as
  obligations outside the design gate.
- `P-05` — honored by: rounds 1-3 are transcribed below and in context.md.
- `P-06` — honored by: red-before-green for tiers (i)-(iii) depends on 252, and the tier (iv) `before()` fails rather
  than skips.
- `F-01` — honored by: no ledger migration; `001` is untouched (recon.md:41). The config seed follows 022.
- `F-06` — honored by: 1 pool + 1 listener (recon.md:21, :138), with no transient third connection.
- `F-07` — honored by: the bound is a WatchConfig key with a call-site default and a clamp; the `2×` is a derived
  ratio, not a tunable. Its live-ness is an open, non-blocking item.

## Business Rules Touched (C-16)

No CHANGE to an existing `@AC`, so no operator CHANGE cover is required (recon.md:97). The operator decisions recorded
2026-10-21 (context.md) govern the gate.

- EXTEND `@AC-1..@AC-8 @feature-248` (this feature's `acceptance.feature`). Each gains named test tiers (item 6). No
  scenario text changes.
- EXTEND `@AC-9 @feature-248` (new) "A trimmed event whose full-row read exceeds the resolve bound ends only matching
  streams non-OK". It covers the bounded resolve on the LISTEN client; the AppendEvent clause is re-scoped to tier (ii).
- PRESERVE `@AC-6 @FR-6 @FR-3 @feature-210` "A long-lived streaming RPC survives a certificate rotation"
  (`docs/sdd/business-rules/platform.feature`). It is not regressed: no pool wait can end a stream, `onGap` is lossless
  through replay, and streams end only on a resolve failure (recon.md:111).
- PRESERVE `@AC-2 @FR-3 @feature-042` and `@AC-1 @FR-1 @FR-2 @feature-042`
  (`services/xstockstrat-analysis/acceptance/order-snapshots-pnl-patterns.feature`). They are not regressed: one global
  FIFO with the `!draining` predicate and the stale-drain guard keeps cross-type order, and one PK read per trimmed
  event stays inside the 10 s seal bound (recon.md:99-100, :178).
- PRESERVE `@AC-7/@AC-10/@AC-11/@AC-12 @feature-157`
  (`services/xstockstrat-portfolio/acceptance/offline-account-portfolios.feature`). They are not regressed: only
  payload completeness changes (recon.md:103-104).
- PRESERVE `@AC-17 @feature-225`, `@AC-10 @feature-029`, `@AC-4 @feature-206`, the `@feature-163` sync/audit set, and
  the `@feature-021` export rules. They are not regressed: a resolved row carries the full field set, including
  `user_id`, equal to replay and export (recon.md:101-110).

## Rounds

**Round 1.** The shape was a resolve-once FIFO in `EventNotifier`. Blocking objections:

- (1) The resolve had no bound; one hung read froze all fan-out.
- (2) The real-DB round-trip of `(event_id, recorded_at)` had to be a required tier, with `log.warn` on every failure
  branch.
- (3) AC-4/AC-5 could not be observed from the `streamEvents` unit tier.

Adopted non-blocking refinements:

- a required `resolveRow` callback;
- clearing the queue on reconnect;
- recomputing subscribers after the await;
- `Number()` at the four sequence sites;
- precise `cleaned` semantics;
- the cost corrected from about 6 reads to about 2.

Rejected in this round:

- per-subscriber resolve;
- a per-stream promise chain;
- end-on-every-stub;
- an `event_id`-only key;
- pool injection;
- `Promise.race` as the only bound;
- folding in migration `004`.

**Round 2.** Round 1's objection (3) was resolved by the wired tier (ii). Objection (2) was resolved for logging;
the tier was committed. Objection (1) was partly resolved by `SET LOCAL statement_timeout`, the WatchConfig key (F-07)
and a new AC-9. New blocking objections:

- (1) The fast-path predicate `queue.length === 0` let a full row overtake an in-flight resolve, breaking AC-2 and
  the 042 seal order.
- (2) Counting the `pool.connect()` wait inside B turned replay contention into `onGap`, ending streams more often
  than today (`@AC-6 @feature-210`).
- (3) Tier (iv) could not be built: tests were excluded from `tsc`, `migration-rerun` had no Node toolchain, and the
  job was not in `ci-gate.needs`.

Adopted:

- the `Number.isFinite` clamp;
- the raw `recorded_at` string;
- the enqueue snapshot ∩ live;
- `queueDepth` logging;
- the proto-touch drift note.

Rejected:

- pool-wide timeouts;
- the `LOCK TABLE` harness.

**Round 3.** The round-2 objections were resolved:

- (1) by the predicate `!this.draining && …`;
- (2) by resolving on the LISTEN client with a startup `statement_timeout` plus `query_timeout`, leaving the pool
  untouched;
- (3) by `test:db` riding on 252's compile-then-test, plus the `node-test` and `migration-rerun` steps and the
  `ci-gate` entry.

The r3 adversary found no Floor breach. Its one blocking item (P-05: the round record was not on disk) was
downgraded to a gate-write obligation and is discharged by this section and the context.md entry. Its claim that 252
is undecided was corrected against 252's feature branch.

Adopted:

- the stale-drain no-shift guard;
- the wedged-listener teardown;
- the honest AC-9 scope;
- `node-shared` in the CI filter;
- `value_type 'int'`;
- the `LEDGER-8` invariant;
- the resolver placement.

Rejected:

- `tsconfig.dbtest.json`;
- `BEGIN`/`SET LOCAL` on the LISTEN session;
- TCP give-up.

Termination: auto-approved under the operator standing authorization, 2026-10-21.
