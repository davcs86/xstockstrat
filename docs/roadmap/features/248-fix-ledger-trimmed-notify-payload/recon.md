# Recon: fix-ledger-trimmed-notify-payload

**Created**: 2026-10-20
**From**: product-spec.md
**Affected services**: xstockstrat-ledger (fix site), xstockstrat-analysis (consumer, verify), xstockstrat-portfolio (consumer, verify)

---

## Objective

When `row_to_json(NEW)` is longer than 7000 chars, the ledger NOTIFY trigger replaces the body with a 5-field stub.
`StreamEvents` then writes that stub as a full `LedgerEvent`: `payload` is absent, `occurred_at` is Invalid, and
`source_service`, `correlation_id`, `metadata` and `user_id` are lost. Analysis and portfolio advance their cursors
past these stubs. The fix resolves any payload-less NOTIFY row to the full `ledger.events` row before `call.write`.
It must keep sequence order and `maxSeq` dedup, must not starve `AppendEvent` under `DB_POOL_MAX=1`, and must fail the
stream non-OK rather than ever writing a stub (FR-1..FR-4).

## Codebase Map

- **`xstockstrat-ledger`** (Node.js, TS)
  - Entry point: `services/xstockstrat-ledger/src/index.ts:44` (query pool `max: parseInt(process.env.DB_POOL_MAX ?? '1', 10)`), `:51` (`new EventNotifier(() => new Client(...))`, the dedicated LISTEN conn), `:55` (`new LedgerServiceImpl(pool, configWatcher, notifier)`)
  - Handler: `streamEvents`, `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:182-260`
    - `:191` seeds `maxSeq` at `fromSequence - 1`.
    - `:195-198` `writeRow` is the only write sink. It updates `maxSeq` and then calls `call.write(rowToEvent(row))`; the return value of `call.write` is ignored.
    - `:202-220` `notifier.subscribe`: `onEvent` buffers while `!live` (`:205-208`) and goes live at `:210`. `onReconnect` calls `call.end()` (`:212-219`).
    - `:229-231` cleanup on `cancelled`/`close`/`error`. There is no `'drain'` handling.
    - `:235-243` replay `SELECT * ... sequence >= $3 ORDER BY sequence ASC` through `this.pool.query` (borrow and release).
    - `:244-248` replay error path: `cleanup(); call.destroy(err)`.
    - `:255-259` synchronous buffer flush, then `live = true` (LEDGER-2).
  - Fan-out: `EventNotifier.dispatch`, `services/xstockstrat-ledger/src/services/eventNotifier.ts:119-137`
    - `:124` `JSON.parse(msg.payload)`.
    - `:129-130` filters on `stream_key`/`event_type`. The stub still carries both, so filtering is unaffected.
    - `:131-135` `sub.onEvent(row)` in a try/catch that swallows errors.
    - `:12` `onEvent: (row: any) => void` is sync-typed.
    - `:17`, `:93` the `onReconnect` hook.
  - Stub source: `services/xstockstrat-ledger/migrations/001_ledger_events_hypertable.up.sql:72`
    - `:72` `IF length(payload) > 7000 THEN`
    - `:73-79` stub fields `event_id, event_type, stream_key, sequence, recorded_at`.
    - `:81-82` `pg_notify(channel, …)` and `pg_notify('ledger_stream_all', …)`.
    - `:87` trigger `ledger_event_notify`, AFTER INSERT.
    - `001` is applied, so it is immutable (F-01).
  - Row mapper: `rowToEvent`, `ledgerServiceImpl.ts:364-377`. `:371` `payload: row.payload`; `:373` `occurredAt: new Date(row.occurred_at)`; `correlationId ?? ''`, `metadata ?? {}`, `userId ?? ''`.
  - Last migration: `003_events_user_id.up.sql` (`services/xstockstrat-ledger/migrations/`). Next free is `004` on this branch; re-derive across remote branches at /sdd-spec.
  - Config-read pattern: `this.config.getBool('ledger.export.enabled', true)` at `ledgerServiceImpl.ts:284`. No config key is involved in this fix.
  - Other key symbols:
    - `getEvent` full-row read `'SELECT * FROM ledger.events WHERE event_id = $1'`, `ledgerServiceImpl.ts:264-267`.
    - `ledger.events` PK `(event_id, recorded_at)` (`001_…up.sql:22`). `idx_events_sequence` is at `001_…up.sql:43-44`; there is no standalone `event_id` index.
    - Constructor parameter properties at `ledgerServiceImpl.ts:20-25`. The strip-types runner cannot load the file (fails.md 2026-08-31 / 2026-07-29).
- **`xstockstrat-analysis`** (Python): verify only
  - Entry point: `services/xstockstrat-analysis/app/main.py:199-211` (`create_task(pnl_pattern_consumer.run_forever())`).
  - Consumer: `services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py`
    - `:152-153` one unfiltered `StreamEvents(from_sequence=cursor)`.
    - `:147-162` reconnect loop. Any stream exception leads to `log.warning(... retrying)`, `asyncio.sleep(2)` (`:161-162`), a cursor re-read and a resume.
    - `:156-159` per-event errors are swallowed.
    - `:164-168` `if event.sequence <= cursor:` drops replayed events.
    - `:176` `payload = MessageToDict(event.payload) if event.HasField("payload") else {}`. This is where a stub is silently consumed.
    - `:240`, `:287` advance the cursor in the same txn.
    - `:403-413` cursor persisted with `GREATEST` in `analysis.ledger_stream_cursor` (`migrations/016_order_snapshots_pnl_patterns.up.sql:74-77`).
  - Last migration: `027_contract_owner_dimension`. No analysis migration is needed.
  - Contract prose: `services/xstockstrat-analysis/CLAUDE.md:144-160` ("strictly in order", cursor "never advances past unwritten data"). It says nothing about stubs.
- **`xstockstrat-portfolio`** (Go): verify only
  - Entry point: `services/xstockstrat-portfolio/cmd/server/main.go:64-68`, five `go svc.Consume*(ctx)` goroutines.
  - Helper: `consumeEventStream`, `services/xstockstrat-portfolio/internal/service/portfolio_service.go:185`
    - `:186` in-memory `var lastSeq int64`.
    - `:190-200` reconnect on any error with `time.Sleep(2 * time.Second)` (`:199`).
    - `:237` `isGracefulStreamClose` changes the log level only.
  - Stream read: `streamEventsFrom`, `portfolio_service.go:206`
    - The request sets only `EventType` and `FromSequence`.
    - `:220` `io.EOF` is a clean close; it returns `(lastSeq, nil)`, so the helper reconnects with no sleep.
    - `:226` a handler error returns before the cursor moves.
    - `:229-230` cursor advance.
  - Subscriptions: `order.filled` `:168`, `account.positions.synced` `:1117`, `account.deregistered` `:1129`, `order.bracket_updated` `:1249`, `account.balance.synced` `:1297`.
  - Stub skip: `if event.Payload == nil {` at `:265` (`return nil`, read); same check at `:1133`, `:1176`, `:1301` (bodies not read).
  - Last migration: `017_offline_realized_lifetime_fees`. None is needed.
  - Invariant: PORTFOLIO-3, `services/xstockstrat-portfolio/docs/context-constitution.md:22`.

## Patterns to REUSE

- **Full-row read by `event_id`.** Reuse the `getEvent` query `SELECT * FROM ledger.events WHERE event_id = $1` (`ledgerServiceImpl.ts:264-267`) and `rowToEvent` (`:364-377`) unchanged. There is no second mapper; live, replay and `GetEvent` then share one mapping (FR-1 parity, AC-8 export parity). No re-fetch helper exists yet, and a second caller would justify extracting one (C-18 DRY). The stub also carries `sequence`, so `idx_events_sequence` (`001_…up.sql:43-44`) is an indexed alternative key; `event_id` alone has no index (PK is `(event_id, recorded_at)`). Design picks the key.
- **Borrow-and-release query.** Reuse `this.pool.query(...)` as the replay does (`ledgerServiceImpl.ts:235-243`). LEDGER-5 allows this because it is not a long read and the connection is released on resolve.
  - Never hold a `pool.connect()` client across `call.write`.
  - Never open a new dedicated `pg.Client` (`streamExportRows`, `:333-339`). That costs a backend slot per event (F-06).
  - Never nest a second pool borrow inside a txn client (LEDGER-1 self-deadlock at max=1).
- **Non-OK stream termination (FR-4).** Reuse `call.destroy({ code, message })` (`ledgerServiceImpl.ts:285`, `:297`, `:325`) or `call.destroy(err)` (`:246`). Do not use `call.end()` (`:214`): portfolio treats `io.EOF` as a clean close and reconnects immediately (`portfolio_service.go:220`). Both consumers already reconnect and resume on a non-OK status (`portfolio_service.go:190-200`, `pnl_pattern_consumer.py:147-162`), so no consumer change is needed.
- **"End the call so the client replays the gap".** Reuse the precedent `onReconnect`, `ledgerServiceImpl.ts:212-219`. Replay at `:235-243` reads the complete row, so ending the stream is itself a correct recovery path for a stub.
- **Single write sink.** Keep `writeRow` (`ledgerServiceImpl.ts:195-198`) as the only place `maxSeq` advances and `call.write` happens. Resolve the stub before it reaches `writeRow`, and do not add a parallel sink. That keeps FR-3 dedup in one place.
- **Partial-row detection.** Detect on `payload` absent (`row.payload === undefined`); the stub at `001_…up.sql:73-79` has no `payload` key. Nothing in `src/` checks this today, so the check is new; keep it in one place.
- **Ordering across an async resolve.** The design has to add this; nothing in the code does it yet. LEDGER-2 (`docs/context-constitution.md:19`) requires subscribe → replay → flush → live in one synchronous block (`ledgerServiceImpl.ts:255-259`). Reuse the existing `buffer` array and the `live` flag rather than adding a second queue structure.
- **Test harness.**
  - Ledger: `makePool`/`makeImpl`/`makeRow` (`src/__tests__/ledgerServiceImpl.test.ts:35`, `:44`, `:88`) and `makeStreamCall` (`:545-565`). `makeStreamCall` must be extended with a `write()` that returns `false`, a `'drain'` emit and a recording `on()` (AC-4). Also reuse `FakeClient.notify(payload)` and `row()` from `src/__tests__/eventNotifier.test.ts:27-55` and `:57`.
  - Analysis: `make_event`/`FakePool`/`make_consumer` (`services/xstockstrat-analysis/tests/test_pnl_pattern_consumer.py:22-34`, `:59-76`, `:177-194`).
  - Portfolio: `streamLedger`/`sliceStream` (`services/xstockstrat-portfolio/internal/service/portfolio_fill_errors_test.go:118-165`), if a consumer-side test is wanted.
  - C-13: inline literals stay inline until a second consumer exists. No fixture home is pre-built.

## Existing Business Rules (preserve / extend)

No CHANGE. The fix restores the existing `StreamEvents` contract; no `@AC-*` guarantees stub or partial delivery.

- **PRESERVE** `@AC-2 @FR-3 @feature-042` "Closing a position triggers pattern analysis and materializes factor rows" (`services/xstockstrat-analysis/acceptance/order-snapshots-pnl-patterns.feature`) — this is PnLPatternConsumer's live StreamEvents input. The fix repairs it, and the 10s seal latency bound must still hold with the added re-fetch.
- **PRESERVE** `@AC-1 @FR-1 @FR-2 @feature-042` "Filling an order captures a snapshot with indicator and signal context" (`services/xstockstrat-analysis/acceptance/order-snapshots-pnl-patterns.feature`) — a large `order.*` event must reach the consumer with the same shape as a replayed one.
- **PRESERVE** `@AC-17 @FR-1 @feature-225` "An ownerless order event issues no owner-scoped call" (`services/xstockstrat-analysis/acceptance/private-by-default-enforce-contract.feature`) — the consumer reads `user_id` from the payload, and a stub takes the ownerless path today. A resolved event must carry `user_id` unchanged, and the ownerless rule stays.
- **PRESERVE** `@AC-10 @FR-4 @feature-029` "A per-fill fee flows through the fee-capture plumbing into the net win test" (`docs/sdd/business-rules/platform.feature`) — the `portfolio.position.closed` payload keys `fees_total` and `realized_pnl` must reach analysis intact.
- **PRESERVE** `@AC-7 @FR-6 @feature-157` "A confirmed offline fill updates positions via the shared absolute-sync path" (`services/xstockstrat-portfolio/acceptance/offline-account-portfolios.feature`) — `ConsumePositionSyncs` consumes the `account.positions.synced` stream. Only payload completeness changes, not the fold.
- **PRESERVE** `@AC-10 @FR-6 @feature-157`, `@AC-11 @FR-6 @feature-157`, `@AC-12 @FR-6 @feature-157` (`services/xstockstrat-portfolio/acceptance/offline-account-portfolios.feature`) — same sync consumer. The idempotent re-edit, sell-to-close and short-open outcomes must not change.
- **PRESERVE** `@AC-4 @regression @feature-206` "An empty broker position snapshot does not delete order-fill-derived positions" (`services/xstockstrat-portfolio/acceptance/fix-reconciliation-false-halt.feature`) — the delete guard keys on whether `realized_pnl` is present in the payload. A full payload must keep the broker vs offline distinction exactly.
- **PRESERVE** `@AC-1 @AC-2 @AC-3 @AC-4 @AC-5 @AC-11 @AC-12 @AC-13 @AC-14 @AC-17 @feature-163` (`services/xstockstrat-portfolio/acceptance/snapshot-offline-positions.feature`) — baseline fold, provenance `source`/`as_of` and the realized-P&L reset, all driven by the complete `account.positions.synced` payload.
- **PRESERVE** `@AC-10 @FR-6 @feature-163` "A snapshot write emits an append-only audit ledger event" (`services/xstockstrat-ledger/acceptance/snapshot-offline-positions.feature`) — the ledger write path (AppendEvent, stream key, fields) is untouched; the fix is read-side only.
- **PRESERVE** `@AC-8 @FR-7 @feature-021` "Each exported row carries the required fields" (`services/xstockstrat-ledger/acceptance/ledger-event-export.feature`) — the live `LedgerEvent` field set must equal the export and replay set (FR-1).
- **PRESERVE** `@AC-11 @FR-10 @feature-021` "The export returns only the authenticated user's own events" (`services/xstockstrat-ledger/acceptance/ledger-event-export.feature`) — a resolved live row must carry `user_id`, so any user scoping matches export.
- **PRESERVE** `@AC-1 @FR-1 @FR-2 @feature-021` "Date-range export streams every event as NDJSON in global-sequence order" (`docs/sdd/business-rules/platform.feature`) — the ascending global-sequence order also binds live fan-out (FR-3).
- **PRESERVE** `@AC-6 @FR-6 @FR-3 @feature-210` "A long-lived streaming RPC survives a certificate rotation" (`docs/sdd/business-rules/platform.feature`) — when a re-fetch fails, FR-4's non-OK end must keep reconnect-and-replay lossless. It must not drop data, and it must not end the stream more often than today.
- Out of scope / not impacted:
  - `order-snapshots-pnl-patterns.feature` `@AC-3/6/7`.
  - `signal-performance-attribution.feature`.
  - Portfolio valuation, quote, drawdown and watchlist suites.
  - The other analysis suites.
  - `platform.feature` `@feature-157 @AC-15`, `@feature-163 @AC-18`, and `@feature-210 @AC-1/2/4/5`.
  - The remaining platform rules (unrelated subjects).
- No durable `@AC-*` covers the `StreamEvents` contract itself (live equals replay, ordering, `maxSeq` dedup, no starvation at `DB_POOL_MAX=1`). This feature's `@AC-1..@AC-8` collide with nothing. Under C-16 they are promoted to `services/xstockstrat-ledger/acceptance/` at launch. That directory holds only `ledger-event-export.feature` and `snapshot-offline-positions.feature`.
- Coverage:
  - Read in full:
    - `platform.feature`.
    - Both ledger suites.
    - Analysis `order-snapshots-pnl-patterns`, `signal-performance-attribution`, and the `@AC-16/@AC-17` block of `private-by-default-enforce-contract`.
    - Portfolio `fix-reconciliation-false-halt`, `offline-account-portfolios` and `snapshot-offline-positions`.
  - Grep only (tag and keyword): 29 other analysis suites and 8 other portfolio suites.
  - No consumer-surface service is involved (C-14: internal/platform-only).

## Dependencies

- Proto/RPC: none. `rpc StreamEvents(StreamEventsRequest) returns (stream LedgerEvent)` (`packages/proto/ledger/v1/ledger.proto:16`). `LedgerEvent` (`:24`) already carries `occurred_at = 5` (`:29`), `payload = 7` (`:31`) and `user_id = 11` (`:35`).
- Migration: none for the re-fetch. A trigger change is conditional: if design folds the char-vs-byte trim fix in, it takes `004` for `services/xstockstrat-ledger/migrations/` as an up+down pair (latest is `003_events_user_id`; `001` is immutable, F-01). Re-derive `NNN` across remote branches at /sdd-spec. Analysis (`027`) and portfolio (`017`) need none.
- Config keys: none. `ledger.stream.notify_enabled` has no reader (digest 1 `## Not found`; dead-config defect report `docs/reports/2026-10-19-dead-config-keys-defect.md`).
- Inter-service edges: unchanged.
  - portfolio → ledger `StreamEvents` ×5.
  - analysis → ledger `StreamEvents` ×1 (unfiltered).
  - The ledger-internal re-fetch is a `ledger.events` read on the existing pool.
- New env vars / ports: none. `DB_POOL_MAX` stays at the `1` default (`src/index.ts:44`), plus 1 LISTEN conn (`:51`). The direct backend budget is unchanged (F-06).
- Sequencing: feature 252 `fix-identity-ledger-test-suites` is `draft` (`docs/roadmap/features/252-fix-identity-ledger-test-suites/status.md`) and owns `services/xstockstrat-ledger/package.json:13-14` (the strip-types runner) and `src/__tests__/ledgerServiceImpl.test.ts`. 248 merges after 252 unless design picks a feature-local harness that loads the real impl. There is no `merge-order.md` row yet (router carry item, `context.md` 2026-10-20).

## Risks / Not-found

- **Ordering hazard (FR-3, LEDGER-2).**
  - An `await` for the re-fetch inside `onEvent` (sync-typed, `eventNotifier.ts:12`) or inside the flush (`ledgerServiceImpl.ts:255-259`) lets later NOTIFYs overtake the resolved event.
  - The writes then go out of order, and `maxSeq` advanced by a later event drops the resolved one at `:210`.
  - A per-stream ordering mechanism is needed. Nothing exists today.
- **Swallowed errors.** `dispatch` swallows `onEvent` throws (`eventNotifier.ts:131-135`). A re-fetch rejection must be handled inside the stream and turned into `call.destroy({code,…})` (FR-4), not left to the notifier.
- **Pool contention at max=1 (FR-2, F-06).**
  - The re-fetch competes with `AppendEvent`'s txn client.
  - Fan-out is per subscriber (`eventNotifier.ts:128-136`), so one large event costs about 6 identical SELECTs per ledger instance (portfolio 5 filtered subs, matching by type, plus analysis 1).
  - Design should weigh resolving once per event (in or ahead of `dispatch`) against resolving per subscriber.
- **Backpressure.** `call.write`'s return is ignored (`ledgerServiceImpl.ts:197`) and there is no `'drain'` handling anywhere. A resolved row must not keep a pool client checked out while waiting on a slow reader (AC-4).
- **Re-fetch key cost.** `WHERE event_id = $1` has no standalone index (PK `(event_id, recorded_at)`, `001_…up.sql:22`) and may scan chunks. `sequence` (`idx_events_sequence`, `:43-44`) or `event_id` plus `recorded_at` (both in the stub) can use an index. This has not been measured.
- **Sequence type mix.**
  - pg returns `BIGINT sequence` as a string for replay and re-fetched rows. `setTypeParser` has no hit in `services/xstockstrat-ledger/src/`.
  - A NOTIFY row carries a JSON number.
  - The `>` comparisons at `ledgerServiceImpl.ts:196`, `:210` and `:256` therefore rely on JS numeric coercion. A resolved row would replace a number with a string inside the dedup path. This has not been tested.
- **Visibility.** The NOTIFY is delivered after commit, so a re-fetch should find the row. FR-4's no-row branch (AC-7) still has to end the stream non-OK rather than skip the event.
- **Client-visible symptom unverified.** What a client decodes from `occurredAt: new Date(undefined)` depends on the server's Timestamp encoder, which was not traced. A throw inside `call.write` would be swallowed at `eventNotifier.ts:133`. Reproduction step 3 is a server-side object-state description.
- **Consumer-side residue (out of scope, owed).**
  - Analysis's persisted cursor (`pnl_pattern_consumer.py:164-168`, `:403-413`) means pre-fix stubs stay consumed. A data-repair defect report is owed (router carry item).
  - Portfolio replays from 0 on restart (`portfolio_service.go:186`).
- **Char-vs-byte trim mismatch.** `length()` counts chars at `001_…up.sql:72`, while `pg_notify` limits by bytes (`:81-82`). A multi-byte row can fail `AppendEvent`. Design either folds this into a `004` migration or splits it into a separate defect report.
- **Doc drift (router carry item).** `services/xstockstrat-ledger/CLAUDE.md:46` says portfolio holds "three" permanent subscriptions. There are five (`portfolio_service.go:168`, `:1117`, `:1129`, `:1249`, `:1297`; LEDGER-3 at `docs/context-constitution.md:20` already says 5). The findings open question at `services/xstockstrat-ledger/docs/context-constitution-findings.md:36` should be closed by this fix.
- **Not found.**
  - Any `streamEvents` unit test.
  - Any trim or re-fetch test.
  - A fake `call` whose `write()` returns `false` or emits `'drain'`.
  - A real-Postgres ledger test harness (needed for a trigger-level proof).
  - A re-fetch-by-`event_id` helper for the stream path.
  - A `payload === undefined` partial-row check.
  - A ledger migration `004`.
  - Analysis: a stub or empty-payload guard, a `StreamEvents` fake, and `run_forever` or reconnect coverage.
  - Portfolio: a stub fed through `streamEventsFrom` in tests. Its "no stream interceptor" claim (`services/xstockstrat-portfolio/CLAUDE.md`) was not verified in code.
- **Applicable `fails.md` traps.**
  - 2026-08-31 (021) and 2026-07-29 (074) (`docs/roadmap/ledger/fails.md:115-130`, `:1942-1956`): the ledger strip-types suites pass vacuously. Red-before-green (P-06) needs proof that the real impl loaded (non-zero c8 lines, or compiled `dist` tests), otherwise identical pass counts with and without the fix are the tell.
  - 2026-10-07 (210) (`fails.md:2839-2842`): when a design-named stream assertion (backpressure, reconnect-replay) cannot be written, it must be recorded in the Deviation Log, not over-claimed in `**Covers**`.
- **Applicable `insights.md` pattern.** 2026-08-26 (042) (`docs/roadmap/ledger/insights.md:2161-2168`): analysis deliberately uses one broad subscription because it depends on cross-type global-sequence ordering. A fix that reorders around a resolved event breaks the `order.filled` → `portfolio.position.closed` seal ordering (`@AC-2 @feature-042`).

## Recommended Scope

Advisory, not binding.

1. **Ledger: resolve-before-write in `streamEvents`.**
   - Detect a payload-less row.
   - Resolve it with one borrowed `pool.query` (key chosen by design), mapped through `rowToEvent`.
   - Keep strict per-stream sequence order across the await, covering the live path, the replay-window buffer and the flush.
   - On a read error or a missing row, `call.destroy({ code, message })` without writing that event or anything after it.
   - Design forks to settle:
     - Per subscriber vs once per event (in `EventNotifier`).
     - Ordering mechanism (per-stream promise chain or queue vs synchronous fallback).
     - Re-fetch key.
     - Normalizing `sequence` type.
     - Whether a stub can instead end the stream so replay covers it.
2. **Ledger test step (C-08, P-06).** Real-impl `streamEvents` tests for AC-1..AC-8: a fake pool for the re-fetch result, error or empty; a fake `call` with `write() → false` and `'drain'`; a notifier fed a stub row.
   - Prove the impl loads (fails.md 021/074).
   - Settle whether this rides on 252's runner fix or ships a feature-local harness.
   - A trigger-level real-Postgres proof is a separate tier; impl-spec maps each AC to a tier.
3. **Consumer verify (no code change expected).** Confirm portfolio (`portfolio_service.go:185-233`) and analysis (`pnl_pattern_consumer.py:147-168`) reconnect and replay on a non-OK end. Optionally add one consumer test each, reusing `sliceStream`/`make_event`.
4. **Docs and teardown.**
   - Close the open question at `context-constitution-findings.md:36`.
   - Update ledger `CLAUDE.md` § Live Streaming Architecture with the re-fetch and fix the "three" subscriptions count.
   - Decide the char-vs-byte trim: `004` migration or a separate report.
   - File the analysis data-repair report (router).
