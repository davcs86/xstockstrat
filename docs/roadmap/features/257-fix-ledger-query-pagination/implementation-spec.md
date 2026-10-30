# Implementation Spec: fix-ledger-query-pagination

**Status**: `pending`
**Created**: 2026-10-22
**Feature**: `docs/roadmap/features/257-fix-ledger-query-pagination/feature.md`
**Total Steps**: 9
**Feature Branch**: `feature/fix-ledger-query-pagination`
**Severity**: SEV-2

---

## Execution Summary

The work follows design.md's build order. Step 1 records the hard merge order (263 and 252 first, 251 after 257)
and is the gate for the rebase. Steps 2–3 give ledger `queryEvents` a keyset token on `sequence`, a 100/1000 page
clamp and one BigInt sequence helper (D-13). Steps 4–5 turn the `streamEvents` replay into bounded pool batches up to
a `max(sequence)` bound captured after subscribe, with a drain helper and BigInt `maxSeq` (D-27). Steps 6–7 make
portfolio `GetPnL` fail closed (`ErrLedgerUnavailable` → `UNAVAILABLE`), reject a repeated token, request 1000 per
page and keep the largest cumulative partial fill (D-46). Step 8 is the manual real-TimescaleDB run (AC-5 evidence,
real-pg token walk, `per_page_ms`), a hard stop before merge. Step 9 updates docs and runs the teardown audit.

No proto, migration or config change (design.md § Chosen Approach). No `QueryEventsRequest` field is added, so 257
takes no field number; 263's `owner_only = 7` stays the last one. Consumer surface: **None — internal/platform-only**
at the code level. The user-visible effect is the corrected realized P&L that `GetPnL` returns. The UI BFF
`QueryEvents` callers request a first page only and are unchanged (FR-4 / AC-7). No `xstockstrat-ui` or
`xstockstrat-agent` code calls `GetPnL` (product-spec § Consumer Surface(s)), so no UI or agent step exists (C-14).

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` token walk returns each event once | Step 3 (unit, string sequences `"9"`,`"10"`,`"11"`), Step 8 (real-pg token walk) |
| `@AC-2` oversized `page_size` capped at 1000 | Step 3 |
| `@AC-3` GetPnL folds each fill once across pages | Step 7 |
| `@AC-4` GetPnL fails on a page error | Step 7 |
| `@AC-5` replay does not starve AppendEvent | Step 5 (CI FIFO interleave unit test), Step 8 (recorded real-TimescaleDB run) |
| `@AC-6` largest cumulative partial fill across pages | Step 7 |
| `@AC-7` omitted `page_token` returns the oldest first page | Step 3 |

## Step Dependencies

- **Rebase preconditions (hard, before Step 2).** `263-fix-edge-owner-scope` (status `implementation-ready`) and
  `252-fix-identity-ledger-test-suites` (`implementation-ready`) are merged into `main-dev`, and
  `feature/fix-ledger-query-pagination` is merged up from `main-dev`. 263 is the operator's 2026-10-22 decision: its
  `ownerOnly` condition (263 Step 3, `if (req.ownerOnly) { conditions.push(\`user_id = $${p++}\`); … }`) must exist
  in `queryEvents` before Step 2 appends the keyset condition after it. 252 makes the ledger real-impl suite load
  (fails.md:1941-1956); without it Steps 3 and 5 run vacuously green. If either is not merged, stop and ask; do not
  re-implement either here.
- **248 (`fix-ledger-trimmed-notify-payload`, `implementation-ready`) is a soft same-function overlap, not a hard
  order.** If 248 is in `main-dev` when Step 4 runs, Step 4 replaces 248 Step 7's `Number(row.sequence)` /
  `Number(req.fromSequence)` comparisons with `toSeq(...)` (BigInt) and keeps 248's flush structure. If 248 lands
  after 257, 248 rebases onto `toSeq`. Step 9's new invariant takes the next free `LEDGER-N`: 248 Step 11 claims
  `LEDGER-8`.
- Step 3 [test] covers Step 2 [service]. Step 5 [test] covers Step 4 [service]. Step 7 [test] covers Step 6
  [service]. Per P-06 each test is written and run RED against the pre-implementation tree first.
- Step 4 requires Step 2 (it reuses `toSeq`).
- Step 6 is independent of Steps 2–5 in code. But its repeated-token guard makes `GetPnL` return `UNAVAILABLE`
  against a ledger without Step 2, so Steps 2 and 6 ship in the same integration PR (rolling-deploy note, Step 1).
- Step 8 requires Steps 2–5 (it runs the built ledger). A failed run blocks the integration PR. Remedy: a smaller
  `REPLAY_BATCH_SIZE`, or a new ledger index migration `004` with DBA + service-owner approval (C-07). Either is a
  re-spec, not an in-place step edit (F-09).
- Step 9 requires Steps 2–8 (it documents shipped semantics and Step 8's numbers).
- **251 (`fix-getpnl-source-service`) must merge after, or together with, 257** (Step 1 row). 251's `SourceService`
  fix is not absorbed here (design.md § Rejected Alternatives).

---

### Step 1 — docs: Reconcile the 257 merge-order rows and add the rolling-deploy note

**Status**: `done`
**Service**: `docs/roadmap/features/`
**Files**:
- `docs/roadmap/features/merge-order.md` — modify

**Reviewers**: none

**Codebase Evidence** (re-spec 2026-10-29, merged tree):
- `merge-order.md:21` `## Blocking Dependencies`, header `:23` `| Feature | Must wait for | Reason | Resolved |`.
  The table runs to `:98`; `:100` starts the "Screener initiative build order" paragraph.
- All three 257 rows already exist (written by the 263/252 work, in different wording from the original spec):
  `:78` 257 ← 263, `:79` 257 ← 252, `:80` 251 ← 257, each `Resolved: No`.
- Row `:78` ends "and takes the next free `QueryEventsRequest` field number after 263's". That contradicts this spec:
  257 adds no `QueryEventsRequest` field (its token rides `PageRequest.page_token`), so 263's `owner_only = 7` stays
  the last field.
- `grep -n "UNAVAILABLE" docs/roadmap/features/merge-order.md` → no hit: the rolling-deploy note is absent.
- Preconditions are met on the merged tree: 263 (`if (req.ownerOnly)` at `ledgerServiceImpl.ts:159`), 252
  (`"test:coverage": "tsc && c8` at `services/xstockstrat-ledger/package.json:14`) and 248 (`Number(row.sequence)`
  forms at `ledgerServiceImpl.ts:204,219,274`, `onGap` at `:229`). 251 is `implementation-ready`.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Do not add rows. In row `:78`, replace the clause "and takes the next free `QueryEventsRequest` field number after
   263's" with "and adds no `QueryEventsRequest` field (the token rides `PageRequest.page_token`; 263's
   `owner_only = 7` stays last)". Leave rows `:79` and `:80` and every Resolved cell unchanged.
2. Directly under the table (after `:98`, before the "Screener initiative build order" paragraph), add one note of at
   most 3 lines. During the ledger rollout, a token from an old ledger build (an `event_id` UUID) or a repeated page
   makes `GetPnL` return `UNAVAILABLE` until every ledger instance runs 257. Realized P&L changes on purpose once 251
   lands: announce it as a correction (insights.md:176-188).

**Verification**:
```bash
grep -c "fix-ledger-query-pagination" docs/roadmap/features/merge-order.md          # >= 3
grep -n "field number after 263" docs/roadmap/features/merge-order.md               # no hit
grep -n "UNAVAILABLE" docs/roadmap/features/merge-order.md                          # >= 1 hit (rolling-deploy note)
```

---

### Step 2 — service: ledger `queryEvents` keyset token, page clamp and the BigInt sequence helper

**Status**: `done`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts` — modify

**Reviewers**: `xstockstrat-ledger` owner — Append-only invariant (no deletes or updates), event ordering, hypertable partition safety

**Codebase Evidence** (re-spec 2026-10-29, merged tree; 263 and 248 are in):
- `ledgerServiceImpl.ts:12` `const EXPORT_BATCH_SIZE = 1000;` is the constant precedent, and `:14`
  `function readCursor` is the module-level helper precedent.
- `queryEvents` starts at `:128`. The `conditions[]`/`params[]`/`let p` builder ends with
  `if (req.fromSequence) { conditions.push(\`sequence >= $${p++}\`); … }` at `:155-158`, then 263's
  `if (req.ownerOnly) { conditions.push(\`user_id = $${p++}\`); params.push(callerUserId(call)); }` at `:159-162`.
- `:164` `const where = …`; `:165` `const limit = req.page?.pageSize || 100;` (no cap); `:166`
  `params.push(limit + 1);`.
- `:170` `` `SELECT * FROM ledger.events ${where} ORDER BY recorded_at ASC LIMIT $${p}` ``.
- `:174` `const hasMore = result.rows.length > limit;`.
- `:179` `page: { nextPageToken: hasMore ? rows[rows.length - 1].event_id : '', totalCount: rows.length }`.
  `req.page.pageToken` is never read (`grep -n "pageToken" ledgerServiceImpl.ts` → no hit).
- `:182` `callback({ code: 13, message: err.message });` is the internal-error shape. Bad input uses `code: 3`
  (recon.md § Patterns to REUSE).
- No `setTypeParser` exists in `services/xstockstrat-ledger/src` (grep: no hit), so pg returns `sequence` (BIGINT) as
  a string. `packages/proto/buf.gen.yaml:24-31` (the ts_proto opt block) passes no `forceLong`, so int64 fields such
  as `fromSequence` and `LedgerEvent.sequence` use ts-proto's default `number`. The helper still accepts all three
  types (design.md § 1 "Sequence helper").
- `idx_events_sequence ON ledger.events (sequence)` backs `ORDER BY sequence`
  (`migrations/001_ledger_events_hypertable.up.sql:43-44`).

**TDD**: `red-green required`

**Covers**: — (behaviour asserted in Step 3)

**Instructions**:
1. Next to `EXPORT_BATCH_SIZE` (`:12`), add `export const QUERY_EVENTS_DEFAULT_PAGE_SIZE = 100;` and
   `export const QUERY_EVENTS_MAX_PAGE_SIZE = 1000;`. Do not merge them with `EXPORT_BATCH_SIZE` (design.md
   § Rejected Alternatives, "One shared 1000 constant").
2. Next to `readCursor` (`:14`), add two exported module-level helpers:
   - `export function toSeq(v: number | string | bigint): bigint`. It returns `BigInt(v)` for a safe integer
     `number`, a `/^\d+$/` string or a `bigint`, and throws otherwise. Give it a ≤2-line constraint comment: pg
     returns BIGINT as a string, so string `>` is lexicographic and every sequence compare or encode must go
     through this helper.
   - `export function parseSequenceToken(token: string): bigint | null`. `''` returns `null` (first page). A token
     that matches `/^\d{1,19}$/` and is `<= 9223372036854775807n` returns its BigInt. Anything else throws a marker
     error that `queryEvents` maps to code 3. An old-build `event_id` UUID token is therefore rejected, never
     misread.
3. In `queryEvents`:
   - Parse `req.page?.pageToken ?? ''` first. On a parse error, call
     `callback({ code: 3, message: 'invalid page_token' })` and return before any query.
   - After 263's `ownerOnly` condition (`:159-162`), add the keyset condition when the token is non-null:
     `conditions.push(\`sequence > $${p++}::bigint\`); params.push(cursor.toString());`. Pass a string, not a
     BigInt, so pg's parameter serialization is not relied on. The keyset is one more ANDed entry, so it never
     widens 263's owner scope (ledger `@AC-11`).
   - Replace `:165` with a clamp: `const requested = req.page?.pageSize ?? 0;` then
     `const limit = requested > 0 ? Math.min(requested, QUERY_EVENTS_MAX_PAGE_SIZE) : QUERY_EVENTS_DEFAULT_PAGE_SIZE;`.
     Never reject an oversized or non-positive size (FR-3).
   - In the SELECT at `:170`, change `ORDER BY recorded_at ASC` to `ORDER BY sequence ASC`. Keep `LIMIT $${p}` with
     `limit + 1` (FR-2 probe).
   - At `:179`, set `nextPageToken: hasMore ? toSeq(rows[rows.length - 1].sequence).toString() : ''`. Leave
     `totalCount: rows.length` as is (FR-3; the `ledgerServiceImpl.test.ts:189-203` number regression stays green).
4. Do not touch `streamEvents`, `getEvent`, `exportEvents` or `rowToEvent` in this step.

**Verification**: see Step 3. Also:
```bash
cd services/xstockstrat-ledger
# Rebase preconditions — both hit on the merged tree (re-spec 2026-10-29); if either fails, stop and ask.
grep -n "req.ownerOnly" src/grpc/ledgerServiceImpl.ts      # >= 1 hit in queryEvents (263 merged)
grep -n '"test:coverage": "tsc && c8' package.json          # 1 hit (252's compile-then-test runner merged)
grep -n "ORDER BY recorded_at" src/grpc/ledgerServiceImpl.ts           # no hit
grep -n "sequence > \$\${p++}::bigint" src/grpc/ledgerServiceImpl.ts      # 1 hit, in queryEvents
grep -n "QUERY_EVENTS_MAX_PAGE_SIZE\|export function toSeq\|export function parseSequenceToken" src/grpc/ledgerServiceImpl.ts
pnpm run build && pnpm run lint
```

---

### Step 3 — test: ledger `queryEvents` keyset walk, cap, default page and token validation (string sequences)

**Status**: `done`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/__tests__/ledgerServiceImpl.test.ts` — modify

**Reviewers**: `xstockstrat-ledger` owner — Append-only invariant (no deletes or updates), event ordering, hypertable partition safety

**Codebase Evidence** (re-spec 2026-10-29, merged tree):
- `ledgerServiceImpl.test.ts:28` `makePool` ignores the SQL (`async query(_sql, _params)`), so it cannot prove keyset
  semantics. `:60` `makeIdempotentPool` routes by SQL regex and is the model for an SQL-aware fake (recon.md
  § Patterns to REUSE).
- `makeRow` is no longer local: `:4` imports it as `makeEventRow as makeRow` from `fixtures/ledgerEvents.ts` (248
  moved it). `makeEventRow` defaults to a numeric `sequence: 1` (`fixtures/ledgerEvents.ts:16`), and the `:160`
  hasMore test uses numeric sequences. Numeric mocks hide the BIGINT-as-string bug (fails.md 2026-10-22 entry,
  design.md § 4); pass string `sequence` overrides.
- `describe('queryEvents')` is at `:132`, the hasMore test at `:160`, and the `totalCount` number regression at
  `:189-203`; all must stay green.
- 263's owner tests already exist under `queryEvents` (`:209` `runQuery` helper, `:215-262`). They build the caller
  with `makeStreamCall(req, 'u-a')` (`:5`, `fixtures/streamCall.ts#makeRecordingCall`), whose `metadata.get`
  returns the `x-user-id`. The owner+token compose test reuses that call double and `runQuery` (C-13), not a new
  metadata stub.
- `:10-11` forbids a guarded import (no-silent-skip); the suite runs through 252's compile-then-test runner
  (`package.json:14`). `makeKeysetPool` does not exist yet.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-7`

**Instructions**:
1. Add a module-local `makeKeysetPool(rows)` fake in the `makeIdempotentPool` style. It records every `(sql, params)`
   and emulates the predicates the impl emits:
   - it filters on `event_type` when the SQL has `event_type = $n`;
   - it filters on `user_id` when the SQL has `user_id = $n`;
   - it filters on `toSeq(row.sequence) > BigInt(params[n-1])` when the SQL has `sequence > $n::bigint`;
   - it sorts by `toSeq(row.sequence)` only when the SQL has `ORDER BY sequence ASC`, and otherwise returns rows in
     insertion order;
   - it slices to the last param (`LIMIT`).
   Rows carry `sequence` as a pg-style **string** (`makeRow({ sequence: '10', … })`). C-13: it has one consumer in
   one file, so it stays inline (state this in the test comment).
2. Add these tests under `describe('queryEvents')`. Each one names its `@AC` in the test title:
   - **AC-1.** Rows `e1`/`e2`/`e3` with `sequence` `"9"`, `"10"`, `"11"` (digit boundary). With `pageSize: 2`, page
     1 is `[e1, e2]` and its token is `"10"`. Following it returns `[e3]` and token `''`. Assert the second call's
     SQL contains `sequence > $` and its params contain `"10"`. RED today: the token is never read, so page 2
     repeats `[e1, e2]`.
   - **AC-2.** 20 000 rows with string sequences and `pageSize: 1_000_000` → exactly 1000 events, a non-empty token,
     and a `LIMIT` param of 1001. RED today: 20 000 events.
   - **AC-7.** 150 rows `e1..e150`, inserted into the fake in shuffled `recorded_at` order but with ascending
     sequences.
     - No `page` → `e1..e100` in sequence order, non-empty token.
     - `pageSize: 500` and no token → `e1..e150`, token `''`.
     - Assert `ORDER BY sequence ASC` is in the SQL. RED today: `ORDER BY recorded_at`.
   - **Exactly-full last page (FR-2).** Two rows, `pageSize: 2` → token `''`.
   - **Bad tokens → code 3, and no query is issued.** Cover `'abc'`, `'-1'`, `'9223372036854775808'` and a UUID
     `'0b9c…'` event_id-style token.
   - **Owner + token compose (263).** `runQuery(impl, makeStreamCall({ ownerOnly: true, eventType: 't', page: { pageSize: 10, pageToken: '10' } }, 'u-a'))`.
     The SQL contains both `user_id = $` and `sequence > $`, joined by `AND`, the params hold `'u-a'` and `"10"`,
     and `LIMIT` stays the last placeholder.
   - **`toSeq` / `parseSequenceToken` unit cases.** `toSeq('10') > toSeq('9')`; `toSeq(10)`, `toSeq('10')` and
     `toSeq(10n)` are equal; `toSeq('1e3')` throws; `parseSequenceToken('')` is `null`.
3. Leave the existing `:132-262` tests as they are. They must stay green: the clamp keeps `pageSize: 100/10/2`, and
   the hasMore test now gets a sequence-string token.

**Verification**:
```bash
cd services/xstockstrat-ledger
pnpm run test:coverage   # 252's compile-then-test runner; exits 0 with 0 failed tests
# confirm the c8 table has a non-zero ledgerServiceImpl row (not a vacuous 0% run, fails.md:1941)
npx c8 check-coverage --lines 40   # exits 0: total >= 40% lines (the script's --lines flag alone enforces nothing, 252 FR-4)
pnpm run lint
grep -n "function makeKeysetPool" src/__tests__/*.test.ts   # exactly 1 declaration (C-13, single consumer)
```

---

### Step 4 — service: ledger `streamEvents` bounded batched replay, drain backpressure and BigInt `maxSeq`

**Status**: `done`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts` — modify

**Reviewers**: `xstockstrat-ledger` owner — Append-only invariant (no deletes or updates), event ordering, hypertable partition safety

**Codebase Evidence** (re-spec 2026-10-29, merged tree; 248 is merged, so its `Number(...)` forms are present):
- `streamEvents` starts at `:190`. `:199` `let maxSeq = req.fromSequence ? Number(req.fromSequence) - 1 : 0;`.
- `:203-207` `writeRow` does `const seq = Number(row.sequence); if (seq > maxSeq) maxSeq = seq; call.write(rowToEvent(row));`.
  It ignores `write()`'s return value.
- `:211` `notifier.subscribe({...})` runs before the replay (LEDGER-2, `docs/context-constitution.md:19`). The live
  dedupe is `:219` `if (Number(row.sequence) > maxSeq) writeRow(row);`.
- 248 added `onGap` at `:229-237`: it calls `cleanup()` and then `call.destroy({ code: notFound ? 13 : 14, message })`.
- `:240` `let cleaned = false`, `:241-245` `cleanup` (unsubscribes once), `:246-248` the `cancelled`/`close`/`error`
  hooks.
- `:250-266` is the replay: one `this.pool.query(… AND sequence >= $3 ORDER BY sequence ASC)` with no LIMIT, and
  `[req.streamKey || null, req.eventType || null, req.fromSequence || 0]` (`:258`). Its catch calls
  `cleanup(); call.destroy(err); return;`.
- `:269` `if (cleaned) return;`. `:272-276` is the synchronous flush with `if (Number(row.sequence) > maxSeq) writeRow(row);`,
  and `:277` `live = true`.
- `grep -n "new Client(" src/grpc/ledgerServiceImpl.ts` → 1 hit (`:356`, `streamExportRows`).
- The query pool is `DB_POOL_MAX` default 1 (`src/index.ts:45`), plus the one `EventNotifier` LISTEN client. That is
  the F-06 budget. The replay must stay on `this.pool` and never on the LISTEN client: LEDGER-8
  (`docs/context-constitution.md:25`, 248's notifier invariant) limits that client to single-statement PK reads.
- 248's LEDGER-2 addendum requires that "the flush stays synchronous".
- Test impact: the existing `streamEvents` tests in `ledgerServiceImpl.test.ts:801-910` build the pool with
  `makePool(rows)` (`:28`, same rows for every SQL) or a single-`release` deferred pool (`:836-859`, `:880-897`).
  Once this step adds the `MAX(sequence)` bound query, `rows[0].max` is `undefined` there, `toSeq` throws and the
  stream is destroyed. Step 5 adapts those fakes; this step does not add a test-only fallback.

**TDD**: `red-green required`

**Covers**: — (behaviour asserted in Step 5)

**Instructions**:
1. Add `export const REPLAY_BATCH_SIZE = 1000;` next to the Step 2 constants.
2. `maxSeq` becomes a BigInt everywhere, replacing 248's `Number(...)` forms:
   - `:199` becomes `let maxSeq: bigint = req.fromSequence ? toSeq(req.fromSequence) - 1n : 0n;`.
   - `writeRow` uses `const seq = toSeq(row.sequence); if (seq > maxSeq) maxSeq = seq; return call.write(rowToEvent(row));`.
     It returns the write result.
   - The live dedupe (`:219`) and the flush (`:274`) compare `toSeq(row.sequence) > maxSeq`. `toSeq` accepts 248's
     resolved rows (pg string `sequence`) and the NOTIFY JSON number form.
   - Leave `onGap` (`:229-237`) unchanged.
3. Add a module-level `export function waitForDrain(call): Promise<void>`. It resolves on the first of `drain`,
   `cancelled`, `close` or `error`, registered with `call.once`, then removes the other listeners with
   `call.removeListener` (a real grpc-js `ServerWritableStream` is an EventEmitter; Step 5 extends the call double).
4. Replace the replay block (`:250-266`) with this, keeping the same catch (`cleanup(); call.destroy(err); return;`):
   ```ts
   const bound = toSeq((await this.pool.query('SELECT COALESCE(MAX(sequence), 0) AS max FROM ledger.events')).rows[0].max);
   let cursor = maxSeq;  // sequence > cursor
   for (;;) {
     if (cleaned) return;
     const { rows } = await this.pool.query(
       `SELECT * FROM ledger.events
        WHERE ($1::text IS NULL OR stream_key = $1) AND ($2::text IS NULL OR event_type = $2)
          AND sequence > $3::bigint AND sequence <= $4::bigint
        ORDER BY sequence ASC LIMIT $5`,
       [req.streamKey || null, req.eventType || null, cursor.toString(), bound.toString(), REPLAY_BATCH_SIZE],
     );
     for (const row of rows) { if (!writeRow(row)) await waitForDrain(call); if (cleaned) return; }
     if (rows.length < REPLAY_BATCH_SIZE) break;
     cursor = toSeq(rows[rows.length - 1].sequence);
   }
   ```
   - The bound query sits inside the same `try`, so a failing or malformed bound takes the existing catch path. Do
     not default a missing `max` to `0n`: real pg always returns one row from `COALESCE(MAX(...))`.
   - Capture the bound **after** `notifier.subscribe` (LEDGER-2). Rows above it arrive through the buffer.
   - Each batch is its own single-statement pool query, so the one pooled connection is released between batches.
     A queued `AppendEvent` therefore runs before the next batch.
   - The cursor seed equals the existing `maxSeq` seed, so the `fromSequence` semantics (`>= fromSequence`) are
     unchanged.
5. Keep the `:269` `if (cleaned) return;` guard and the flush exactly as they are: synchronous, no `await` between
   the flush loop and `live = true`.
6. Keep a ≤2-line constraint comment on the bound: rows that commit with a sequence ≤ the walk position after the
   walk passed it are not replayed (operator sign-off (a)); `pg_snapshot_xmin` is the named follow-up.
7. Do not add a buffer cap (design.md § Rejected Alternatives) and do not touch `streamExportRows` (ledger `@AC-7`).

**Verification**: see Step 5 (the full suite, including the adapted `:801-910` streamEvents tests, must be green
there). Also:
```bash
cd services/xstockstrat-ledger
grep -n "REPLAY_BATCH_SIZE\|waitForDrain\|COALESCE(MAX(sequence)" src/grpc/ledgerServiceImpl.ts
grep -n "row.sequence > maxSeq\|Number(row.sequence)\|Number(req.fromSequence)" src/grpc/ledgerServiceImpl.ts   # no hit (all via toSeq)
grep -n "new Client(" src/grpc/ledgerServiceImpl.ts                                    # 1 hit only (streamExportRows) — replay stays on the pool (F-06)
pnpm run build && pnpm run lint
```

---

### Step 5 — test: ledger replay FIFO interleave, string-sequence dedupe, drain and cancellation

**Status**: `done`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/__tests__/ledgerServiceImpl.test.ts` — modify
- `services/xstockstrat-ledger/src/__tests__/fixtures/streamCall.ts` — modify
- `services/xstockstrat-ledger/src/__tests__/fixtures/INVENTORY.md` — modify

**Reviewers**: `xstockstrat-ledger` owner — Append-only invariant (no deletes or updates), event ordering, hypertable partition safety

**Codebase Evidence** (re-spec 2026-10-29, merged tree):
- `streamEvents` unit tests already exist (248): `describe('streamEvents onGap')` at `:801` and
  `describe('streamEvents sequence normalisation')` at `:861`. The latter covers the string-sequence boundary
  (`'98'`/`'99'`/`'100'`) for the live path (`:864`) and the flush path (`:880`).
- `:787` `makeFakeNotifier()` captures the subscription (`captured`) and records `unsubscribed`. Reuse it (C-13).
- `fixtures/streamCall.ts:4` `makeRecordingCall(req, opts)` (imported as `makeStreamCall`, test `:5`) records
  `writes`, `ended`, `destroyed` and `handlers` (via `on`), and `{ writeReturns }` sets every `write()` return. It has
  no `once`, `removeListener` or `emit`, which Step 4's `waitForDrain` needs. `fixtures/INVENTORY.md` catalogues it
  and must change in the same commit (C-13).
- Tests that break on Step 4's bound query: `:807` and `:818` use `makePool(...)` (`:28`, same rows for every SQL);
  `:836-859` and `:880-897` use a pool whose every `query` returns one shared deferred `release`; `:864` uses
  `makePool(rows)`.
- `makeIdempotentPool` (`:60`) is the SQL-routing style; the `makeExportImpl` `poolQueried` harness at `:569-622` is
  the pool-assertion model.
- The impl constructor takes `(pool, config, notifier?)` (`ledgerServiceImpl.ts:21-26`). `makeSingleSlotPool` does
  not exist yet.

**TDD**: `red-green required`

**Covers**: `AC-5` (unit layer; the real-DB layer is Step 8)

**Instructions**:
1. Extend `makeRecordingCall` with EventEmitter-compatible `once(event, cb)`, `removeListener(event, cb)` and
   `emit(event, ...args)` over the existing `handlers` map. `on` and every existing field keep their behaviour, so
   current consumers (`streamResolveWired.test.ts`, `db/streamResolve.db.test.ts`) are unaffected. Update the
   `INVENTORY.md` row (Shape source adds `once`/`removeListener`/`emit`) in the same commit.
2. Add a `makeSingleSlotPool(rows)` fake in `ledgerServiceImpl.test.ts`. `query()` runs strictly FIFO through one
   promise chain, standing in for a one-connection pool, and appends each dispatched SQL to a `dispatched[]` log.
   - It answers `MAX(sequence)` with `{ rows: [{ max: '<max row sequence or 0>' }] }`.
   - It answers the replay SELECT by emulating `sequence > $3`, `<= $4`, `ORDER BY sequence` and `LIMIT $5`.
   - It answers `INSERT INTO ledger.events` with `{ rows: [{ sequence: '<next>', recorded_at: new Date() }] }`.
   - All `sequence` values are pg-style strings. An optional hook lets a test hold the replay SELECT (deferred) while
     the `MAX` query is still answered immediately.
3. Adapt the existing streamEvents tests to the bound query; their assertions stay unchanged:
   - `:807` (onGap loop) and `:818` (AC-6/AC-7 recovery) and `:864` (AC-2): `makePool(...)` → `makeSingleSlotPool(...)`.
   - `:836` (onGap during replay) and `:880` (AC-5 buffered): answer `MAX(sequence)` immediately with the max of the
     rows the test later releases, and defer only the replay SELECT.
4. Add these tests under a new `describe('streamEvents bounded replay')`, reusing `makeFakeNotifier` and
   `makeStreamCall`:
   - **AC-5 FIFO interleave.** 2500 rows (`REPLAY_BATCH_SIZE` 1000 → 3 batches). When the fake dispatches the first
     replay batch, it enqueues one `INSERT` through the same pool (`impl.appendEvent` with an empty idempotency key,
     or a direct `pool.query`). Assert:
     - `dispatched` places the `INSERT` before the second replay SELECT;
     - there are ≥ 3 replay SELECTs;
     - the written sequences are strictly ascending and unique, with exactly 2500 replay rows.
     RED today: one unbounded SELECT, and the INSERT dispatches only after it.
   - **String-sequence dedupe across a digit boundary.** Replay rows `"9"`, `"10"`, `"11"`. During replay the
     notifier delivers `11` (a duplicate, numeric as NOTIFY JSON) and `12`. Assert the written sequences are exactly
     9, 10, 11, 12. (248's `:861` suite covers the `98`/`99`/`100` boundary with `Number()`; this case pins the
     same contract through `toSeq` with a buffered duplicate.)
   - **`fromSequence` kept.** `fromSequence: 10` replays `"10"` and `"11"`, not `"9"`.
   - **Drain.** `makeStreamCall(req, { writeReturns: false })`: assert no further replay SELECT dispatches until the
     test calls `call.emit('drain')`, then the replay advances (emit `drain` once per pending write until done).
   - **Cancel during drain.** `call.emit('cancelled')` while waiting resolves `waitForDrain`. Assert there is no
     further SELECT, `notifier.unsubscribed` is `true` and no live write follows the cancel.
   - **Error path.** The replay SELECT throws, and `call.destroyed` is that error after `cleanup`
     (`notifier.unsubscribed === true`).
5. The LEDGER-2 order stays asserted: `subscribe` is called before the first SELECT (the dispatch log is empty when
   `notifier.captured` is set).

**Verification**:
```bash
cd services/xstockstrat-ledger
pnpm run test:coverage   # exits 0, 0 failed tests (incl. the adapted :801-910 cases), non-zero ledgerServiceImpl c8 row
npx c8 check-coverage --lines 40   # exits 0: total >= 40% lines (252 FR-4)
pnpm run lint
grep -n "function makeSingleSlotPool" src/__tests__/*.test.ts   # exactly 1 declaration (C-13)
grep -n "removeListener\|once(" src/__tests__/fixtures/streamCall.ts   # >= 2 hits
grep -n "once" src/__tests__/fixtures/INVENTORY.md                     # >= 1 hit (catalog updated with the fixture)
```

---

### Step 6 — service: portfolio `GetPnL` fails closed, rejects a repeated token, pages at 1000, keeps the largest partial

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify
- `services/xstockstrat-portfolio/internal/handler/portfolio_handler.go` — modify

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence** (re-verified 2026-10-29 on the merged tree; service-side citations unchanged, handler shifted):
- `portfolio_service.go:718` `var ErrQuotesUnavailable = errors.New("quotes unavailable")` is the sentinel precedent.
- `GetPnL` starts at `:722`; `:724` `s.repo.ListPositions(ctx, userID, req.TradingMode, 500, …)` is a repo arg, not a
  ledger page. Pass 1 runs from `:749` to `:791`:
  - `:752-754` `EventType: "order.filled", SourceService: "trading", Page: &commonv1.PageRequest{PageSize: 500, PageToken: pageToken}`;
  - `:756-758` `slog.Warn("GetPnL: QueryEvents (filled) failed", "error", err)` then `break`;
  - `:772` user filter, `:775-783` mode filter, `:784` `filledOrderIDs[fill.OrderID] = true`, `:787-790` token follow.
- Pass 2 runs from `:795` to `:836`:
  - `:799` `PageSize: 500`;
  - `:801-803` `slog.Warn(… (partially_filled) failed …)` then `break`;
  - `:829-830` `// Events arrive in recorded_at order; overwrite = keep last …` / `latestPartials[fill.OrderID] = fill`.
- `:838-843` applies partials only to orders not in `filledOrderIDs` (`:839`). `:845` `realized := pnl.Fold(fills).Realized`.
- `orderFillPayload` is at `:245-259` (`Qty` for `order.filled`, `FilledQty` cumulative for `order.partially_filled`).
  `latestQuotesFor` returns ok for zero symbols (`:399-401`).
- `portfolio_handler.go:127` returns `connect.NewError(classifyGetPnLError(err), err)`. `classifyGetPnLError` at
  `:424-431` maps only `ErrQuotesUnavailable` to `CodeUnavailable`, and everything else to `CodeInternal`.
  `toGRPCError` at `:433` already maps `CodeUnavailable` to `codes.Unavailable`.
- C-03: every page call uses the inbound `ctx`, and the portfolio ledger client propagates the trio through its Go
  interceptor (`docs/patterns/header-propagation.md`). No new outbound call or context is introduced. This follows
  the operator's 2026-10-21 trace-propagation decision.
- Trading-domain C-5: both `order.filled` (pass 1) and `order.partially_filled` (pass 2) are handled. Order type,
  broker, paper/live gate: unaffected by this step.

**TDD**: `red-green required`

**Covers**: — (behaviour asserted in Step 7)

**Instructions**:
1. Next to `ErrQuotesUnavailable`, add
   `var ErrLedgerUnavailable = errors.New("ledger unavailable")` with a ≤2-line comment: the handler maps it to
   Unavailable, and GetPnL never returns a partial realized sum.
2. Add one private page-walk helper so the two passes share a single fail-closed loop (C-18 DRY, since the two loops
   are already duplicates). It has the same filters and order as today:
   ```go
   // collectFills walks every ledger page of eventType and returns the caller's mode-matching payloads in page order.
   func (s *PortfolioService) collectFills(ctx context.Context, eventType, userID string, mode commonv1.TradingMode) ([]orderFillPayload, error)
   ```
   - It loops over `QueryEvents(ctx, &ledgerv1.QueryEventsRequest{EventType: eventType, SourceService: "trading", Page: &commonv1.PageRequest{PageSize: ledgerPnLPageSize, PageToken: token}})`.
     The `SourceService` literal stays as it is, because 251 owns it.
   - On an error it returns `fmt.Errorf("GetPnL: QueryEvents (%s): %w: %w", eventType, ErrLedgerUnavailable, err)`.
     That covers a deadline too.
   - If `next != "" && next == token` (the page returned the token it was sent), it returns
     `fmt.Errorf("GetPnL: QueryEvents (%s): repeated page token: %w", eventType, ErrLedgerUnavailable)`.
   - It keeps the `:759-783` payload/user/mode filters unchanged.
   - Add `const ledgerPnLPageSize = 1000`, with a ≤2-line comment that it matches the ledger's
     `QUERY_EVENTS_MAX_PAGE_SIZE`. It replaces both `PageSize: 500` literals (`:754`, `:799`).
3. Rewrite pass 1 and pass 2 on top of the helper and return its error unchanged (no `slog.Warn` + `break`).
   - Pass 1 sets `filledOrderIDs[fill.OrderID] = true` and appends `pnl.Fill{Symbol, Qty: fill.Qty, Price: fill.FillPrice}`.
   - Pass 2 keeps, per `OrderID`, the payload with the largest cumulative `FilledQty`: `if prev, ok := latestPartials[id]; !ok || math.Abs(fill.FilledQty) > math.Abs(prev.FilledQty)`.
     The comparison is strict, so the first one seen wins a tie (operator sign-off (b)). The magnitude form equals
     the design's "largest `FilledQty`" for the non-negative values trading emits today
     (`trading.go:1824`, `"filled_qty": order.FilledQty`). It also stays correct for signed (sell-negative)
     fixtures; see context.md, Session 2026-10-22 — sdd-spec.
   - Replace the `:829-830` comment with a ≤2-line constraint comment that states the order-independent rule
     and the signed-quantity assumption, e.g. `// Keep the largest |cumulative FilledQty| (first seen wins a tie);
     // abs() is load-bearing: sell partials may be negative, so a plain > would keep the smallest fill.`
4. Leave the unrealized side (`:723-740`) and `:838-851` unchanged (portfolio `@AC-5/@AC-6/@AC-13/@AC-28`, PRESERVE).
5. In `portfolio_handler.go` `classifyGetPnLError` (`:424-431`), add
   `if errors.Is(err, service.ErrLedgerUnavailable) { return connect.CodeUnavailable }` and update its comment (≤2
   lines). `toGRPCError` is unchanged. No `DEADLINE_EXCEEDED` mapping is added (design.md § 3, FR-6 narrowed to
   `UNAVAILABLE`).

**Verification**: see Step 7. Also:
```bash
cd services/xstockstrat-portfolio
grep -n "PageSize: 500" internal/service/portfolio_service.go                       # no hit (both GetPnL ledger pages now use ledgerPnLPageSize)
grep -n "GetPnL: QueryEvents (.*) failed" internal/service/portfolio_service.go     # no hit (Warn+break removed)
grep -n "ErrLedgerUnavailable" internal/service/portfolio_service.go internal/handler/portfolio_handler.go
GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 7 — test: portfolio `GetPnL` exactly-once across pages, fail-closed, repeated token, largest partial, classifier

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_pnl_paging_test.go` — create
- `services/xstockstrat-portfolio/internal/service/portfolio_helpers_test.go` — modify
- `services/xstockstrat-portfolio/internal/handler/portfolio_handler_test.go` — modify

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence** (re-verified 2026-10-29 on the merged tree):
- `internal/service/portfolio_quote_deadline_test.go:93` `newQuoteSvc(t, stub, timeoutMs)` returns
  `(svc, pgxmock, *fakeLedger)` with `ledger: ledger` in the struct (`:105`), so a test can set `svc.ledger` to its
  own fake. `:70` `guard(t, fn)` is the 5 s hang guard. `:268` `TestGetPnL_AC5_QuotesUnavailable` is the GetPnL
  error-path model.
- `portfolio_fill_errors_test.go:36` `anyArgs(n)`, and `:45` `positionCols` for an empty `FROM portfolio.positions`
  result. The empty result means `latestQuotesFor` returns `ok` for zero symbols (`portfolio_service.go:399-401`).
- `watchlist_service_test.go:269` `fakeLedger.QueryEvents` always returns an empty page. `:280` `ctxWithUser`
  injects `x-user-id` through the real interceptor.
- `portfolio_risk_test.go:143-148` `stopLedger` is the scripted `QueryEvents` stub pattern (it embeds
  `ledgerv1.LedgerServiceClient`).
- `portfolio_fill_errors_test.go:24` `fillEvent` hard-codes user `u1` and price 100, so it cannot express AC-3/AC-6.
- `portfolio_helpers_test.go:112` `computeRealizedPnL`; its doc comment `:107-111` and its pass-2 "last wins" block
  `:122-126` mirror today's GetPnL.
- `internal/handler/portfolio_handler_test.go:39` `TestClassifyGetPnLError` (feature 229 @AC-5).
- `pnl.Fill` qty is signed (`packages/proto/pnl/pnl.go:22-26`).
- `internal/service` and `internal/handler` are excluded from CI coverage measurement (`.github/workflows/ci.yml:269`
  `COVERPKGS` filter). `pnlEvent` and `pagingLedger` do not exist yet.

**TDD**: `red-green required`

**Covers**: `AC-3, AC-4, AC-6`

**Instructions**:
1. Create `portfolio_pnl_paging_test.go` with:
   - a `pagingLedger` fake that embeds `ledgerv1.LedgerServiceClient`;
   - a per-`EventType` event slice;
   - a fixed fake page size of 200 (independent of the request, so 501 events always span pages);
   - an opaque index token;
   - `errAfter` (the page index that returns `status.Error(codes.DeadlineExceeded, …)`);
   - `ignoreToken` (it always serves page 1 with a non-empty token, as today's ledger does);
   - a recorded `[]*ledgerv1.QueryEventsRequest` plus the `middleware.FromContext(ctx).UserID` seen on each call.
   Add a local `pnlEvent(t, typ, user, orderID string, qty, filledQty, price float64)` builder. C-13: it has one
   consumer file, so it stays inline. `fillEvent` stays untouched. A builder is used rather than shared constants
   because these events are scenario-specific.
2. Each test builds `svc, mock, _ := newQuoteSvc(t, &stubMarketData{}, 0)`, expects
   `mock.ExpectQuery("FROM portfolio.positions").WithArgs(anyArgs(3)...).WillReturnRows(mock.NewRows(positionCols))`,
   sets `svc.ledger = &pagingLedger{…}` and calls `GetPnL(ctxWithUser(t, "u-1"), &portfoliov1.GetPnLRequest{})`
   inside `guard`.
   - **AC-3.**
     - 501 `order.filled` events for `u-1`, alternating buy `qty 1` @100 and sell `qty -1` @101 and ending with a
       buy.
     - Assert `RealizedPnl == 250.00`, ≥ 3 pass-1 calls, each request's `Page.PageSize == 1000`, each call seeing
       user `u-1` (C-03, request ctx kept), and a first-call `PageToken` of `""`.
     - Sub-case `ignoreToken`: `GetPnL` returns `errors.Is(err, ErrLedgerUnavailable)` and a nil response, well
       inside the guard.
     - RED today: `PageSize` is 500, and `ignoreToken` loops until ctx expiry and then returns an inflated success.
   - **AC-6.**
     - One `order.filled` buy of 600 @100 for order `o-b`, plus 501 `order.partially_filled` events for sell order
       `o-s` @101 with cumulative `filled_qty` −1 … −501 (sell-signed, matching the fold convention), and no
       `order.filled` for `o-s`.
     - Assert `RealizedPnl == 501.00` with the partials served in ascending order **and** in descending order.
     - RED today: with descending order, "last wins" keeps −1, which gives 1.00.
     - AC-6 was reworded on 2026-10-22 (operator decision) to the sell-signed −1 … −501, so test and scenario agree.
   - **AC-4.**
     - A first `order.filled` page of 200 events for `u-1` with a non-empty token, and the next call fails with
       `codes.DeadlineExceeded`.
     - Assert `errors.Is(err, ErrLedgerUnavailable)`, a nil `PnLResponse`, and `classifyGetPnLError`-equivalent
       mapping through the handler (item 4).
     - Add the same case for a pass-2 (`order.partially_filled`) failure.
     - RED today: success with a partial sum.
3. In `portfolio_helpers_test.go`, change the `computeRealizedPnL` mirror's pass 2 (`:122-126`) and its doc comment
   (`:107-111`) to the largest-`|FilledQty|`, first-seen-tie rule, so the mirror cannot drift. Add
   `TestRealizedPnL_PartialOrderIndependent`, which feeds partials for one order in descending order and expects the
   largest one.
4. In `portfolio_handler_test.go` `TestClassifyGetPnLError` (`:39`), add
   `classifyGetPnLError(fmt.Errorf("GetPnL: QueryEvents (order.filled): %w: %w", service.ErrLedgerUnavailable, status.Error(codes.DeadlineExceeded, "d")))`
   → `connect.CodeUnavailable`, and its `toGRPCError` → `codes.Unavailable`. Keep the existing assertions,
   including "generic stays Internal" (portfolio `@AC-5` EXTEND).
5. The existing GetPnL tests (`TestGetPnL_AC5_QuotesUnavailable`, `TestGetPnL_AC6_BrokerValuedWithoutQuoteFetch`,
   `offline_account_pnl_test.go`) must stay green unchanged. `fakeLedger`'s empty page ends both passes.

**Verification**:
```bash
cd services/xstockstrat-portfolio
GOWORK=off go test ./internal/service/ ./internal/handler/ -race -count=1 -run 'GetPnL|RealizedPnL|ClassifyGetPnL' -v
GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # >= 40%
# New logic is in an excluded package (internal/service, internal/handler) — the threshold is the existing CI gate; the -run tests above are the behavioural check.
GOWORK=off golangci-lint run --modules-download-mode=mod
grep -rn "func pnlEvent" --include="*_test.go" internal/   # exactly 1 declaration (C-13)
```

---

### Step 8 — test: CI real-TimescaleDB tier — AC-5 non-starvation and real-pg token walk (`*.db.test.ts`)

**Status**: `pending`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/__tests__/db/queryPagination.db.test.ts` — create

**Reviewers**: `xstockstrat-ledger` owner — Append-only invariant (no deletes or updates), event ordering, hypertable partition safety

**Codebase Evidence** (re-spec 2026-10-29; operator decision 2026-10-29 "Move it into CI real-DB tier"):
- A real-TimescaleDB ledger tier exists (248 tier iv): `src/__tests__/db/streamResolve.db.test.ts`. It opens
  `new Pool({ connectionString: LEDGER_DB_TEST_URL, max: 1 })` (mirrors `DB_POOL_MAX=1`, `src/index.ts:45`), wires a
  real `EventNotifier` via `makeListenerClient` + `makeResolveRow`, and drives `LedgerServiceImpl` with
  `makeRecordingCall` (`fixtures/streamCall.ts`) and `fixtures/ledgerEvents.ts`. Its `append(impl, request)` and
  `waitFor(pred)` helpers are local to that file.
- `services/xstockstrat-ledger/package.json:15` `"test:db": "tsc && node --test dist/__tests__/db/*.test.js"`, so a new
  `src/__tests__/db/<name>.db.test.ts` is picked up by the glob; `test`/`test:coverage` (`:13-14`) only glob
  `dist/__tests__/*.test.js`, so the DB file never runs in the unit tier.
- CI job `Ledger DB test (TimescaleDB)` (`.github/workflows/ci.yml:706-762`) runs a `timescale/timescaledb:latest-pg16`
  service (`:717`), applies all migrations, then `pnpm run test:db` (`:762`) with `LEDGER_DB_TEST_URL` (`:761`).
  This supersedes design.md's "CI TimescaleDB job" rejected alternative and the r2 manual-run evidence plan.
- The tier does **not** skip without a DB: `streamResolve.db.test.ts`'s `before()` throws
  `'LEDGER_DB_TEST_URL is required'`. The no-silent-skip convention (`ledgerServiceImpl.test.ts:10-11`) applies, so
  the new file follows the same fail-loud `before()`.
- The CI DB is shared with `streamResolve.db.test.ts`, so assertions must scope rows by a unique `stream_key`
  (`randomUUID()`), never count the whole table.
- Page-token claims need one real-backend check, because stubs cannot prove paging (fails.md 2026-10-07
  backfilled-data-queryable entry). The operator required string-typed sequence checks and the real-pg token walk
  (operator decision 2026-10-22).

**TDD**: `red-green required` (the CI job is RED on the pre-Step-2/4 tree: the token walk repeats page 1 and the
replay is one unbounded SELECT)

**Covers**: `AC-5, AC-1`

**Instructions**:
1. Create `src/__tests__/db/queryPagination.db.test.ts` in the `streamResolve.db.test.ts` shape: first-line comment
   naming the tier and `pnpm run test:db`, runtime imports only (`pg`, `node:*`), `before()` that throws when
   `LEDGER_DB_TEST_URL` is unset, `new Pool({ connectionString: url, max: 1 })`, and `after()` that ends the pool.
   Reuse `makeRecordingCall` and `fixtures/ledgerEvents.ts`; if a helper from `streamResolve.db.test.ts` is needed
   verbatim (`append`, `waitFor`), move it to a shared `fixtures/` module and update `INVENTORY.md` rather than copy
   it (C-13 / DRY guard rail), adding those files to this step's commit.
2. Seed per test, scoped by `const streamKey = randomUUID()`: insert `N = 2 × REPLAY_BATCH_SIZE + 500` (2500) rows
   through the pool with a multi-row `INSERT … SELECT generate_series(...)` (no explicit `sequence`, LEDGER-4), so
   `sequence` crosses at least one decimal digit boundary in a fresh CI DB and the replay spans ≥ 3 batches. Use a
   unique `event_type` per test as well when filtering by type.
3. **AC-1 real-pg token walk.** `queryEvents({ streamKey, page: { pageSize: 1000 } })` follows `nextPageToken` until
   `''`. Assert every seeded `event_id` is returned exactly once, sequences strictly ascending (compared with
   `toSeq`), the walk takes `ceil(N / 1000)` pages and the last token is `''`. Repeat with `ownerOnly: true` and a
   caller `x-user-id` set on half the seeded rows (`user_id` column) and assert only that caller's rows come back.
4. **AC-5 non-starvation.** Start 3 concurrent `streamEvents({ streamKey })` replays on one `LedgerServiceImpl` over
   the `max: 1` pool and a real `EventNotifier`. While they replay, issue `appendEvent` calls (other `stream_key`)
   in a loop and record each latency. Assert each replay delivers exactly the N pre-bound rows ascending with no
   duplicates, and the max `appendEvent` latency is under a generous ceiling (`< 5000` ms, not the old 2 s manual
   target, to stay non-flaky on a CI runner). Log `max_append_ms`, `replay_ms` and the per-page token-walk timings
   with `console.log` so the CI log carries the GetPnL ceiling inputs (`per_page_ms`) that Step 9's docs and the
   design.md § 3 user-scoped-walk follow-up check read.
5. **Local verification is compile-only.** Never start a database locally. `pnpm run build` must compile the file;
   running `pnpm run test:db` without `LEDGER_DB_TEST_URL` fails loudly by design and is not a local gate.
6. **Hard stop.** If the CI job fails on the step's push, block the integration PR, record it in `## Deviation Log`
   and ask the operator. The remedy is a smaller `REPLAY_BATCH_SIZE` or index migration `004` (DBA + owner, C-07);
   both need a re-spec.

**Verification**:
```bash
cd services/xstockstrat-ledger
pnpm run build && pnpm run lint                                  # compiles; dist/__tests__/db/queryPagination.db.test.js exists
ls dist/__tests__/db/queryPagination.db.test.js
grep -n "LEDGER_DB_TEST_URL is required" src/__tests__/db/queryPagination.db.test.ts   # 1 hit (fail-loud, no silent skip)
grep -n "randomUUID" src/__tests__/db/queryPagination.db.test.ts                        # >= 1 hit (rows scoped per test)
# Authoritative: CI job 'Ledger DB test (TimescaleDB)' (.github/workflows/ci.yml:706-762) green on the pushed branch/PR.
```
No coverage threshold applies: `test:db` stays outside the c8 gate (`ci.yml:704`).

---

### Step 9 — docs: ledger CLAUDE.md, ledger constitution invariant, portfolio CLAUDE.md, teardown audit

**Status**: `pending`
**Service**: `services/xstockstrat-ledger/`, `services/xstockstrat-portfolio/`
**Files**:
- `services/xstockstrat-ledger/CLAUDE.md` — modify
- `services/xstockstrat-ledger/docs/context-constitution.md` — modify
- `services/xstockstrat-portfolio/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence** (re-spec 2026-10-29, merged tree):
- Ledger `CLAUDE.md:35` says "**sequence** is globally monotonic — never gaps, never decreasing". That is wrong:
  `nextval`, so rollbacks burn values (design.md § 6).
- Ledger `CLAUDE.md` § Live Streaming Architecture (`:38`) says at `:45` the handler "replays history with a
  borrow-and-release pool query, then subscribes to the notifier". That order is drift: the code subscribes first
  (`ledgerServiceImpl.ts:211` before the replay at `:250`).
- `docs/context-constitution.md:19` LEDGER-2, `:22` LEDGER-5 ("`StreamEvents` replay borrows-and-releases"), and
  `:25` LEDGER-8 (248's `EventNotifier` invariant), the last row. The new invariant is therefore `LEDGER-9`.
- Portfolio `CLAUDE.md:28-29` documents `GetPnL` `UNAVAILABLE` for quotes only (`ErrQuotesUnavailable` →
  `classifyGetPnLError`). The `order.partially_filled` row (`:119`) already says pass 2 keeps the highest cumulative
  `filled_qty`.
- Step 8 is now a CI test; its timings are in the `Ledger DB test (TimescaleDB)` job log, not in context.md.
- Teardown rule: root `CLAUDE.md` § Teardown (context-forge refresh, or a manual reconciliation recorded in the PR
  body, fails.md:670).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. **Ledger `CLAUDE.md`.**
   - Invariant 4 (`:35`) becomes "monotonic, may gap (`nextval`; rollbacks burn values), never decreasing".
   - Rewrite the `:45` order sentence as subscribe → bounded batched replay on the pool (`REPLAY_BATCH_SIZE`, up to a
     `max(sequence)` bound captured after subscribe) → synchronous flush → live.
   - Add one line that `QueryEvents` pages by an opaque `sequence` keyset token, with page size default 100 and cap
     1000.
2. **Ledger constitution.**
   - Append `LEDGER-9` after `:25`. It covers:
     - the `QueryEvents` token is the decimal last `sequence`, and a bad token is code 3;
     - all sequence compare and encode goes through `toSeq` (pg BIGINT strings; supersedes 248's `Number(...)`);
     - the late-commit delivery contract (sign-off (a)), noting that the gap class predates this feature in the live
       dedupe and the LEDGER-3 resume, while batching widens its window to the replay up to the bound;
     - `pg_snapshot_xmin` as the named follow-up;
     - the unbounded per-stream notifier buffer as an accepted limit;
     - the real-pg proof lives in `src/__tests__/db/queryPagination.db.test.ts` (CI `Ledger DB test (TimescaleDB)`).
   - Cite `ledgerServiceImpl.ts#queryEvents`, `#streamEvents`, `#toSeq`.
   - Amend LEDGER-5's `StreamEvents` clause to "replays in bounded pool batches, releasing between batches".
3. **Portfolio `CLAUDE.md` `:28-29`.** Add that a ledger page error, a deadline or a repeated page token also makes
   `GetPnL` return `UNAVAILABLE` (`ErrLedgerUnavailable`). Keep `:119`, which already matches.
4. If Step 8's CI log shows a `per_page_ms`-derived walk above 50% of the caller deadline, record the user-scoped-walk
   follow-up (design.md § 3) in context.md; otherwise no doc carries the numbers.
5. **Teardown.** Run `/context-constitution refresh` scoped to the three files and fix any grounded drift. If the
   plugin is unavailable, re-read each file against the code, reconcile it by hand, and record both facts in the
   integration PR body.

**Verification**:
```bash
grep -n "may gap" services/xstockstrat-ledger/CLAUDE.md
grep -n "LEDGER-9" services/xstockstrat-ledger/docs/context-constitution.md     # 1 row, mentions toSeq
grep -n "ErrLedgerUnavailable" services/xstockstrat-portfolio/CLAUDE.md
grep -n "then subscribes" services/xstockstrat-ledger/CLAUDE.md   # no hit
```

---

## Deviation Log

| Date | Step(s) | Deviation | Authority |
|---|---|---|---|
| 2026-10-29 | 1–9 | **Re-spec at branch setup** (`/sdd-execute sequential` via `/sdd-batch-execute`, after merging `origin/main-dev`). Step bodies (Files/Evidence/Instructions/Verification) re-grounded on the merged tree: 263, 252 and 248 are in, so line citations shifted and the preconditions are met. Step 1: the three merge-order rows already exist; only the row `:78` field-number wording and the rolling-deploy note remain. Steps 4/5: the new `MAX(sequence)` bound query breaks 248's `makePool`-based `streamEvents` tests, so Step 5 adapts them and extends `makeRecordingCall` (`once`/`removeListener`/`emit`, + `INVENTORY.md`) and reuses `makeFakeNotifier`; Step 4 adds no test-only fallback for a missing bound. Step 9: the new invariant is `LEDGER-9` (248 took `LEDGER-8`). | Validation mismatches, 2026-10-29 |
| 2026-10-29 | 8 (+ Execution Summary, Step Dependencies, Scenario Coverage AC-5/AC-1 rows) | **Step 8 moved from a manual real-TimescaleDB run into the CI real-DB tier**: new `src/__tests__/db/queryPagination.db.test.ts`, run by `pnpm run test:db` in CI job `Ledger DB test (TimescaleDB)` (`ci.yml:706-762`). It is verified by that job going green, not by a manual run, and is no longer an operator-only or tooling blocker. No database is started locally; local verification is compile-only (the tier fails loudly without `LEDGER_DB_TEST_URL`, by convention). The context.md literal-line greps (`p100_ms`/`token_walk_count`/`per_page_ms`) are dropped; timings go to the CI log. The 2 s p100 target becomes a non-flaky `< 5000` ms ceiling and the 200 000-row seed becomes 2500 rows per test scoped by `randomUUID()` stream key. Where the Execution Summary, Step Dependencies and Scenario Coverage still say "manual run", the Step 8 body governs. Supersedes design.md's "CI TimescaleDB job" rejected alternative. | Operator decision 2026-10-29 (session question tool): "Move it into CI real-DB tier" |
| 2026-10-29 | 2 + 3 | **Steps 2 and 3 executed as ONE commit** with one red→green cycle on Step 3's tests. Step 2's change to `ORDER BY sequence ASC` breaks the three feature-263 exact-SQL expectations in `ledgerServiceImpl.test.ts` (Step 3's file), so Step 2's verification cannot pass alone. Standing rule (operator, 2026-10-29, own words): "Merge pairs + standing rule". | Operator decision 2026-10-30 (session question tool): "A: Fix in same commit (Recommended)" |
| 2026-10-29 | 3 | **Feature-263 exact-SQL expectations updated** in `ledgerServiceImpl.test.ts` (`ownerOnly binds…`, `flag absent…`, `ownerOnly with eventType…`): `ORDER BY recorded_at ASC` → `ORDER BY sequence ASC`. Params and placeholder order unchanged. Step 3 instruction 3 ("leave the existing tests as they are") did not foresee these literal-SQL assertions. | Operator decision 2026-10-30 (session question tool): "A: Fix in same commit (Recommended)" |
| 2026-10-29 | 4 + 5 | **Steps 4 and 5 executed as ONE commit** with one red→green cycle on Step 5's tests. Step 4's `MAX(sequence)` bound query breaks 248's `makePool`/deferred-pool `streamEvents` fakes, and its `waitForDrain` needs Step 5's `once`/`removeListener`/`emit` call double, so Step 4's verification cannot pass alone. Standing rule (operator, 2026-10-29, own words): "Merge pairs + standing rule"; widened (operator, 2026-10-30, own words): "Widen the rule (Recommended)". | Operator decision 2026-10-30 (session question tool): "A: Include the fake fix (Recommended)" |
| 2026-10-29 | 4 + 5 | **Files expansion (test fake only):** `services/xstockstrat-ledger/src/__tests__/streamResolveWired.test.ts` — `makeCountingPool` answers the new `MAX(sequence)` bound query (`wire(replay, max = '0')`; the buffered-resolve test passes `'50'`). No assertion changed; no production code outside Step 4's Files changed. | Operator decision 2026-10-30 (session question tool): "A: Include the fake fix (Recommended)" |
