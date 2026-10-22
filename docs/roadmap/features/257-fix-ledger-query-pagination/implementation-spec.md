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

### Step 1 — docs: Record merge order (263, 252 before 257; 251 after 257) and the rolling-deploy note

**Status**: `pending`
**Service**: `docs/roadmap/features/`
**Files**:
- `docs/roadmap/features/merge-order.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/roadmap/features/merge-order.md` has the `## Blocking Dependencies` table with header
  `| Feature | Must wait for | Reason | Resolved |`. `grep -n "257\|251\|263\|252\|query-pagination"` on it returns
  nothing at `111b4e25` (`origin/main-dev`), so no row exists yet (recon.md § Dependencies).
- The operator decided on 2026-10-21 that 257 merges before or with 251 (context.md). On 2026-10-22 the operator
  decided that 263 merges first (context.md, Session 2026-10-22 — sdd-design).
- 263's implementation spec defers its own 263-before-257 row to its Step 12 "only after the operator confirms the
  direction" (`origin/feature/fix-edge-owner-scope:docs/roadmap/features/263-fix-edge-owner-scope/implementation-spec.md:66-69`).
  The 2026-10-22 decision confirms it.
- 248's implementation spec Step 1 already records its own hard dependency on 252 (`248 implementation-spec.md:90`).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Append three rows to `## Blocking Dependencies`. If 263's Step 12 already wrote the first row, keep that one and
   do not duplicate it.
   - `| \`fix-ledger-query-pagination\` | \`fix-edge-owner-scope\` | 257's keyset token is built on 263's ledger \`QueryEvents\` owner predicate (same WHERE builder, \`ledgerServiceImpl.ts#queryEvents\`); operator decision 2026-10-22 | No |`
   - `| \`fix-ledger-query-pagination\` | \`fix-identity-ledger-test-suites\` | 257's ledger tests need 252's compile-then-test runner; on the strip-types runner they pass vacuously (fails.md:1941) | No |`
   - `| \`fix-getpnl-source-service\` | \`fix-ledger-query-pagination\` | 251 makes GetPnL's \`SourceService\` filter match real fills; without 257 the ignored page token re-reads page 1 and inflates realized P&L once >500 platform fills exist (D-46); operator decision 2026-10-21 | No |`
2. Under the table, add one note of at most 3 lines. During the ledger rollout, a token from an old ledger build (an
   `event_id` UUID) or a repeated page makes `GetPnL` return `UNAVAILABLE` until every ledger instance runs 257.
   Realized P&L changes on purpose once 251 lands: announce it as a correction (insights.md:176-188).

**Verification**:
```bash
grep -n "fix-ledger-query-pagination" docs/roadmap/features/merge-order.md   # >= 3 rows (2 as Feature, 1 as Must wait for)
grep -n "UNAVAILABLE" docs/roadmap/features/merge-order.md                    # rolling-deploy note present
```

---

### Step 2 — service: ledger `queryEvents` keyset token, page clamp and the BigInt sequence helper

**Status**: `pending`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts` — modify

**Reviewers**: `xstockstrat-ledger` owner — Append-only invariant (no deletes or updates), event ordering, hypertable partition safety

**Codebase Evidence** (at `3690b923`; line numbers shift after the 263 rebase, so locate by content):
- `ledgerServiceImpl.ts:11` `const EXPORT_BATCH_SIZE = 1000;` is the constant precedent, and `:13`
  `function readCursor` is the module-level helper precedent.
- `queryEvents` starts at `:124`. The `conditions[]`/`params[]`/`let p = 1` builder is at `:126-154`, and the last
  condition today is `if (req.fromSequence) { conditions.push(\`sequence >= $${p++}\`); … }` at `:151-154`. 263
  Step 3 adds its `if (req.ownerOnly) …` condition right after it.
- `:156` `const where = …`; `:157` `const limit = req.page?.pageSize || 100;` (no cap); `:158`
  `params.push(limit + 1);`.
- `:162` `` `SELECT * FROM ledger.events ${where} ORDER BY recorded_at ASC LIMIT $${p}` ``.
- `:166` `const hasMore = result.rows.length > limit;`.
- `:171` `page: { nextPageToken: hasMore ? rows[rows.length - 1].event_id : '', totalCount: rows.length }`.
  `req.page.pageToken` is never read (`grep -n "pageToken" ledgerServiceImpl.ts` → no hit).
- `:174` `callback({ code: 13, message: err.message });` is the internal-error shape. Bad input uses `code: 3`
  (recon.md § Patterns to REUSE).
- No `setTypeParser` exists in `services/xstockstrat-ledger/src` (grep: no hit), so pg returns `sequence` (BIGINT) as
  a string. `packages/proto/buf.gen.yaml:24-31` passes ts-proto no `forceLong` option, so int64 fields such as
  `fromSequence` and `LedgerEvent.sequence` use ts-proto's default `number`. The helper still accepts all three types
  (design.md § 1 "Sequence helper").
- `idx_events_sequence ON ledger.events (sequence)` backs `ORDER BY sequence`
  (`migrations/001_ledger_events_hypertable.up.sql:43-44`).

**TDD**: `red-green required`

**Covers**: — (behaviour asserted in Step 3)

**Instructions**:
1. Next to `EXPORT_BATCH_SIZE` (`:11`), add `export const QUERY_EVENTS_DEFAULT_PAGE_SIZE = 100;` and
   `export const QUERY_EVENTS_MAX_PAGE_SIZE = 1000;`. Do not merge them with `EXPORT_BATCH_SIZE` (design.md
   § Rejected Alternatives, "One shared 1000 constant").
2. Next to `readCursor`, add two exported module-level helpers:
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
   - After the last existing condition, which after the rebase is 263's `ownerOnly` predicate, add the keyset
     condition when the token is non-null: `conditions.push(\`sequence > $${p++}::bigint\`); params.push(cursor.toString());`.
     Pass a string, not a BigInt, so pg's parameter serialization is not relied on. The keyset is one more ANDed
     entry, so it never widens 263's owner scope (ledger `@AC-11`).
   - Replace `:157` with a clamp: `const requested = req.page?.pageSize ?? 0;` then
     `const limit = requested > 0 ? Math.min(requested, QUERY_EVENTS_MAX_PAGE_SIZE) : QUERY_EVENTS_DEFAULT_PAGE_SIZE;`.
     Never reject an oversized or non-positive size (FR-3).
   - In the SELECT at `:162`, change `ORDER BY recorded_at ASC` to `ORDER BY sequence ASC`. Keep `LIMIT $${p}` with
     `limit + 1` (FR-2 probe).
   - At `:171`, set `nextPageToken: hasMore ? toSeq(rows[rows.length - 1].sequence).toString() : ''`. Leave
     `totalCount: rows.length` as is (FR-3; the `:203-217` number regression stays green).
4. Do not touch `streamEvents`, `getEvent`, `exportEvents` or `rowToEvent` in this step.

**Verification**: see Step 3. Also:
```bash
cd services/xstockstrat-ledger
grep -n "ORDER BY recorded_at" src/grpc/ledgerServiceImpl.ts           # no hit
grep -n "sequence > \$\${p++}::bigint" src/grpc/ledgerServiceImpl.ts      # 1 hit, in queryEvents
grep -n "QUERY_EVENTS_MAX_PAGE_SIZE\|export function toSeq\|export function parseSequenceToken" src/grpc/ledgerServiceImpl.ts
pnpm run build && pnpm run lint
```

---

### Step 3 — test: ledger `queryEvents` keyset walk, cap, default page and token validation (string sequences)

**Status**: `pending`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/__tests__/ledgerServiceImpl.test.ts` — modify

**Reviewers**: `xstockstrat-ledger` owner — Append-only invariant (no deletes or updates), event ordering, hypertable partition safety

**Codebase Evidence**:
- `ledgerServiceImpl.test.ts:35` `makePool` ignores the SQL (`async query(_sql, _params)`), so it cannot prove keyset
  semantics. `:56` `makeIdempotentPool` routes by SQL regex and is the model for an SQL-aware fake (recon.md
  § Patterns to REUSE).
- `:88` `makeRow` uses numeric `sequence: 1` (`:100`), and so does the `:174` hasMore test. These numeric mocks hide
  the BIGINT-as-string bug (fails.md 2026-10-22 entry, design.md § 4).
- `describe('queryEvents')` is at `:142`. The `:203-217` `totalCount` number regression must stay green.
- The impl loads only through 252's compile-then-test runner (fails.md:1941-1956; 252 implementation-spec Step 4).
  248 Step 6 may move `makeRow` into `src/__tests__/fixtures/`. If it has, import it from there.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-7`

**Instructions**:
1. Add a module-local `makeKeysetPool(rows)` fake in the `makeIdempotentPool` style. It records every `(sql, params)`
   and emulates the predicates the impl emits:
   - it filters on `event_type` when the SQL has `event_type = $n`;
   - it filters on `toSeq(row.sequence) > BigInt(params[n-1])` when the SQL has `sequence > $n::bigint`;
   - it sorts by `toSeq(row.sequence)` only when the SQL has `ORDER BY sequence ASC`, and otherwise returns rows in
     insertion order;
   - it slices to the last param (`LIMIT`).
   Rows carry `sequence` as a pg-style **string**. C-13: it has one consumer in one file, so it stays inline (state
   this in the test comment).
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
   - **Owner + token compose (263).** `{ ownerOnly: true, pageToken: '10', eventType: 't' }` with an `x-user-id`
     metadata stub. The SQL contains both `user_id = $` and `sequence > $`, joined by `AND`, and the params hold the
     caller id and `"10"`.
   - **`toSeq` / `parseSequenceToken` unit cases.** `toSeq('10') > toSeq('9')`; `toSeq(10)`, `toSeq('10')` and
     `toSeq(10n)` are equal; `toSeq('1e3')` throws; `parseSequenceToken('')` is `null`.
3. Leave the existing `:142-217` tests as they are. They must stay green: the clamp keeps `pageSize: 100/10/2`, and
   the hasMore test now gets a sequence-string token.

**Verification**:
```bash
cd services/xstockstrat-ledger
pnpm run test:coverage   # 252's compile-then-test runner; exits 0 with 0 failed tests
# confirm the c8 table has a non-zero ledgerServiceImpl row (not a vacuous 0% run, fails.md:1941)
pnpm run lint
grep -n "function makeKeysetPool" src/__tests__/*.test.ts   # exactly 1 declaration (C-13, single consumer)
```

---

### Step 4 — service: ledger `streamEvents` bounded batched replay, drain backpressure and BigInt `maxSeq`

**Status**: `pending`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts` — modify

**Reviewers**: `xstockstrat-ledger` owner — Append-only invariant (no deletes or updates), event ordering, hypertable partition safety

**Codebase Evidence** (at `3690b923`; locate by content after the 263/248 rebases):
- `streamEvents` starts at `:182`. `:191` `let maxSeq = req.fromSequence ? req.fromSequence - 1 : 0;`.
- `:195-198` `writeRow` does `if (row.sequence > maxSeq) maxSeq = row.sequence; call.write(rowToEvent(row));`. It
  ignores `write()`'s return value.
- `:202` `notifier.subscribe({...})` runs before the replay (LEDGER-2, `docs/context-constitution.md:19`). The live
  dedupe is at `:210` `if (row.sequence > maxSeq) writeRow(row);`.
- `:222-231` holds `cleanup`, the `cleaned` flag and the `cancelled`/`close`/`error` hooks.
- `:235-243` is the replay: one `this.pool.query(… AND sequence >= $3 ORDER BY sequence ASC)` with no LIMIT, and
  `[req.streamKey || null, req.eventType || null, req.fromSequence || 0]`. Its catch at `:244-248` calls
  `cleanup(); call.destroy(err)`.
- `:251` `if (cleaned) return;`. `:255-259` is the synchronous flush with `if (row.sequence > maxSeq) writeRow(row);`
  and then `live = true`.
- The query pool is `DB_POOL_MAX=1` (`src/index.ts:44`), plus the one `EventNotifier` LISTEN client. That is the
  F-06 budget. The replay must stay on `this.pool` and never on the LISTEN client (fails.md 2026-10-21 248 entry).
- If 248 is merged: 248 Step 7 has rewritten `:191`, `:196`, `:210` and `:256` to `Number(...)`, and 248's LEDGER-2
  addendum requires that "the flush stays synchronous" (248 implementation-spec Step 11).

**TDD**: `red-green required`

**Covers**: — (behaviour asserted in Step 5)

**Instructions**:
1. Add `export const REPLAY_BATCH_SIZE = 1000;` next to the Step 2 constants.
2. `maxSeq` becomes a BigInt everywhere:
   - `:191` becomes `let maxSeq: bigint = req.fromSequence ? toSeq(req.fromSequence) - 1n : 0n;`.
   - `writeRow` uses `const seq = toSeq(row.sequence); if (seq > maxSeq) maxSeq = seq; return call.write(rowToEvent(row));`.
     It returns the write result.
   - The live dedupe (`:210`) and the flush (`:256`) compare `toSeq(row.sequence) > maxSeq`.
   - If 248's `Number(...)` forms are present, replace them. `toSeq` must also accept 248's resolved rows, whose
     `sequence` is a pg string.
3. Add a module-level `export function waitForDrain(call): Promise<void>`. It resolves on the first of `drain`,
   `cancelled`, `close` or `error`, then removes the other listeners.
4. Replace the replay block (`:234-249`) with this, keeping the same catch (`cleanup(); call.destroy(err); return;`):
   ```ts
   const bound = (await this.pool.query('SELECT COALESCE(MAX(sequence), 0) AS max FROM ledger.events')).rows[0].max;
   let cursor = maxSeq;  // sequence > cursor
   for (;;) {
     if (cleaned) return;
     const { rows } = await this.pool.query(
       `SELECT * FROM ledger.events
        WHERE ($1::text IS NULL OR stream_key = $1) AND ($2::text IS NULL OR event_type = $2)
          AND sequence > $3::bigint AND sequence <= $4::bigint
        ORDER BY sequence ASC LIMIT $5`,
       [req.streamKey || null, req.eventType || null, cursor.toString(), toSeq(bound).toString(), REPLAY_BATCH_SIZE],
     );
     for (const row of rows) { if (!writeRow(row)) await waitForDrain(call); if (cleaned) return; }
     if (rows.length < REPLAY_BATCH_SIZE) break;
     cursor = toSeq(rows[rows.length - 1].sequence);
   }
   ```
   - Capture the bound **after** `notifier.subscribe` (LEDGER-2). Rows above it arrive through the buffer.
   - Each batch is its own single-statement pool query, so the one pooled connection is released between batches.
     A queued `AppendEvent` therefore runs before the next batch.
   - The cursor seed equals the existing `maxSeq` seed, so the `fromSequence` semantics (`>= fromSequence`) are
     unchanged.
5. Keep the `:251` `if (cleaned) return;` guard and the flush exactly as they are: synchronous, no `await` between
   the flush loop and `live = true`.
6. Keep a ≤2-line constraint comment on the bound: rows that commit with a sequence ≤ the walk position after the
   walk passed it are not replayed (operator sign-off (a)); `pg_snapshot_xmin` is the named follow-up.
7. Do not add a buffer cap (design.md § Rejected Alternatives) and do not touch `streamExportRows` (ledger `@AC-7`).

**Verification**: see Step 5. Also:
```bash
cd services/xstockstrat-ledger
grep -n "REPLAY_BATCH_SIZE\|waitForDrain\|COALESCE(MAX(sequence)" src/grpc/ledgerServiceImpl.ts
grep -n "row.sequence > maxSeq\|Number(row.sequence)" src/grpc/ledgerServiceImpl.ts   # no hit (all via toSeq)
grep -n "new Client(" src/grpc/ledgerServiceImpl.ts                                    # 1 hit only (streamExportRows) — replay stays on the pool (F-06)
pnpm run build && pnpm run lint
```

---

### Step 5 — test: ledger replay FIFO interleave, string-sequence dedupe, drain and cancellation

**Status**: `pending`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/__tests__/ledgerServiceImpl.test.ts` — modify

**Reviewers**: `xstockstrat-ledger` owner — Append-only invariant (no deletes or updates), event ordering, hypertable partition safety

**Codebase Evidence**:
- No `streamEvents` unit test exists in `src/__tests__/` (recon.md § Risks). 248 Step 8 may have added
  `makeStreamCall` and stream tests. Reuse its stream-call fake if present (`grep -n "makeStreamCall"`). Otherwise
  this is the first consumer, so it stays inline (C-13).
- The `makeIdempotentPool` SQL-routing style is at `:56`. The `poolQueried` export harness at `:569-621` is the
  pool-assertion model.
- The impl constructor takes `(pool, config, notifier?)` (`ledgerServiceImpl.ts:20-24`). `streamEvents` needs a
  notifier with `subscribe({ onEvent, onReconnect }) → unsubscribe`.

**TDD**: `red-green required`

**Covers**: `AC-5` (unit layer; the real-DB layer is Step 8)

**Instructions**:
1. Add a `makeSingleSlotPool(rows)` fake. `query()` runs strictly FIFO through one promise chain, standing in for a
   one-connection pool, and appends each dispatched SQL to a `dispatched[]` log.
   - It answers `MAX(sequence)` with the max row sequence.
   - It answers the replay SELECT by emulating `sequence > $3`, `<= $4`, `ORDER BY sequence` and `LIMIT $5`.
   - It answers `INSERT INTO ledger.events` with `{ rows: [{ sequence: '<next>', recorded_at: new Date() }] }`.
   - All `sequence` values are pg-style strings.
2. Add a stub notifier that captures `onEvent`, and a stream call fake with `write()`, `on()`, `emit()` and
   `destroy()`.
3. Add these tests under a new `describe('streamEvents')`:
   - **AC-5 FIFO interleave.** 2500 rows (`REPLAY_BATCH_SIZE` 1000 → 3 batches). When the fake dispatches the first
     replay batch, it enqueues one `INSERT` through the same pool (`impl.appendEvent` with an empty idempotency key,
     or a direct `pool.query`). Assert:
     - `dispatched` places the `INSERT` before the second replay SELECT;
     - there are ≥ 3 replay SELECTs;
     - the written sequences are strictly ascending and unique, with exactly 2500 replay rows.
     RED today: one unbounded SELECT, and the INSERT dispatches only after it.
   - **String-sequence dedupe across a digit boundary.** Replay rows `"9"`, `"10"`, `"11"`. During replay the
     notifier delivers `11` (a duplicate, numeric as NOTIFY JSON) and `12`. Assert the written sequences are exactly
     9, 10, 11, 12. RED today: string `"10" > "9"` is false, so `maxSeq` stalls at `"9"` and the flush re-delivers
     11.
   - **`fromSequence` kept.** `fromSequence: 10` replays `"10"` and `"11"`, not `"9"`.
   - **Drain.** `write()` returns `false` on the first row. Assert no further replay SELECT dispatches until the test
     emits `drain`, then the replay completes.
   - **Cancel during drain.** Emitting `cancelled` while waiting resolves `waitForDrain`. Assert there is no further
     SELECT, `unsubscribe` was called and `live` never flips (no live write after cancel).
   - **Error path.** The replay SELECT throws, and `call.destroy` is called with that error after `cleanup`.
4. The LEDGER-2 order stays asserted: `subscribe` is called before the first SELECT (the dispatch log is empty when
   `subscribe` runs).

**Verification**:
```bash
cd services/xstockstrat-ledger
pnpm run test:coverage   # exits 0, 0 failed tests, non-zero ledgerServiceImpl c8 row; total >= 40% lines
pnpm run lint
grep -n "function makeSingleSlotPool" src/__tests__/*.test.ts   # exactly 1 declaration (C-13)
```

---

### Step 6 — service: portfolio `GetPnL` fails closed, rejects a repeated token, pages at 1000, keeps the largest partial

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify
- `services/xstockstrat-portfolio/internal/handler/portfolio_handler.go` — modify

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence** (at `3690b923`):
- `portfolio_service.go:718` `var ErrQuotesUnavailable = errors.New("quotes unavailable")` is the sentinel precedent.
- `GetPnL` starts at `:722`. Pass 1 runs from `:749` to `:791`:
  - `:752-754` `EventType: "order.filled", SourceService: "trading", Page: &commonv1.PageRequest{PageSize: 500, PageToken: pageToken}`;
  - `:756-758` `slog.Warn("GetPnL: QueryEvents (filled) failed", "error", err)` then `break`;
  - `:772` user filter, `:775-783` mode filter, `:787-790` token follow.
- Pass 2 runs from `:795` to `:836`:
  - `:799` `PageSize: 500`;
  - `:801-803` `slog.Warn(… (partially_filled) failed …)` then `break`;
  - `:829-830` `// Events arrive in recorded_at order; overwrite = keep last …` / `latestPartials[fill.OrderID] = fill`.
- `:838-843` applies partials only to orders not in `filledOrderIDs`. `:845` `realized := pnl.Fold(fills).Realized`.
- `orderFillPayload` is at `:245-259` (`Qty` for `order.filled`, `FilledQty` cumulative for `order.partially_filled`).
- `portfolio_handler.go:96` calls `classifyGetPnLError`. At `:425-430` that function maps only `ErrQuotesUnavailable`
  to `CodeUnavailable`, and everything else to `CodeInternal`. `toGRPCError` at `:432-447` already maps
  `CodeUnavailable` to `codes.Unavailable`.
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
     `QUERY_EVENTS_MAX_PAGE_SIZE`. It replaces both `PageSize: 500` literals.
3. Rewrite pass 1 and pass 2 on top of the helper and return its error unchanged (no `slog.Warn` + `break`).
   - Pass 1 sets `filledOrderIDs[fill.OrderID] = true` and appends `pnl.Fill{Symbol, Qty: fill.Qty, Price: fill.FillPrice}`.
   - Pass 2 keeps, per `OrderID`, the payload with the largest cumulative `FilledQty`: `if prev, ok := latestPartials[id]; !ok || math.Abs(fill.FilledQty) > math.Abs(prev.FilledQty)`.
     The comparison is strict, so the first one seen wins a tie (operator sign-off (b)). The magnitude form equals
     the design's "largest `FilledQty`" for the non-negative values trading emits today
     (`trading.go:1822-1824`, `"filled_qty": order.FilledQty`). It also stays correct for signed (sell-negative)
     fixtures; see context.md, Session 2026-10-22 — sdd-spec.
   - Replace the `:829-830` comment with one that states the order-independent rule.
4. Leave the unrealized side (`:723-740`) and `:838-851` unchanged (portfolio `@AC-5/@AC-6/@AC-13/@AC-28`, PRESERVE).
5. In `portfolio_handler.go` `classifyGetPnLError`, add
   `if errors.Is(err, service.ErrLedgerUnavailable) { return connect.CodeUnavailable }` and update its comment (≤2
   lines). `toGRPCError` is unchanged. No `DEADLINE_EXCEEDED` mapping is added (design.md § 3, FR-6 narrowed to
   `UNAVAILABLE`).

**Verification**: see Step 7. Also:
```bash
cd services/xstockstrat-portfolio
grep -n "PageSize: 500" internal/service/portfolio_service.go                       # no hit inside GetPnL (ListPositions' 500 at :724 is a repo arg, unchanged)
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

**Codebase Evidence**:
- `internal/service/portfolio_quote_deadline_test.go:93` `newQuoteSvc(t, stub, timeoutMs)` returns
  `(svc, pgxmock, *fakeLedger)` with `ledger: ledger` in the struct, so a test can set `svc.ledger` to its own fake.
  `:70` `guard(t, fn)` is the 5 s hang guard. `:268` `TestGetPnL_AC5_QuotesUnavailable` is the GetPnL error-path
  model.
- `portfolio_fill_errors_test.go:36` `anyArgs(n)`, and `:45` `positionCols` for an empty `FROM portfolio.positions`
  result. The empty result means `latestQuotesFor` returns `ok` for zero symbols (`portfolio_service.go:399-401`).
- `watchlist_service_test.go:254-272` `fakeLedger.QueryEvents` always returns an empty page. `:280` `ctxWithUser`
  injects `x-user-id` through the real interceptor.
- `portfolio_risk_test.go:143-148` `stopLedger` is the scripted `QueryEvents` stub pattern (it embeds
  `ledgerv1.LedgerServiceClient`).
- `portfolio_fill_errors_test.go:24` `fillEvent` hard-codes user `u1` and price 100, so it cannot express AC-3/AC-6.
- `portfolio_helpers_test.go:107-131` `computeRealizedPnL` mirrors pass 2 as "last wins" (`:118-121`).
- `internal/handler/portfolio_handler_test.go:39` `TestClassifyGetPnLError` (feature 229 @AC-5).
- `internal/service` and `internal/handler` are excluded from CI coverage measurement (spec-template coverage
  table, `COVERPKGS` filter).

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
       buy. `pnl.Fill` qty is signed (`packages/proto/pnl/pnl.go:23-26`).
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
   - **AC-4.**
     - A first `order.filled` page of 200 events for `u-1` with a non-empty token, and the next call fails with
       `codes.DeadlineExceeded`.
     - Assert `errors.Is(err, ErrLedgerUnavailable)`, a nil `PnLResponse`, and `classifyGetPnLError`-equivalent
       mapping through the handler (item 4).
     - Add the same case for a pass-2 (`order.partially_filled`) failure.
     - RED today: success with a partial sum.
3. In `portfolio_helpers_test.go`, change the `computeRealizedPnL` mirror's pass 2 (`:118-121`) and its doc comment
   (`:103-106`) to the largest-`|FilledQty|`, first-seen-tie rule, so the mirror cannot drift. Add
   `TestRealizedPnL_PartialOrderIndependent`, which feeds partials for one order in descending order and expects the
   largest one.
4. In `portfolio_handler_test.go` `TestClassifyGetPnLError`, add
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

### Step 8 — test: manual real-TimescaleDB run — AC-5 non-starvation, real-pg token walk, GetPnL ceiling inputs

**Status**: `pending`
**Service**: `xstockstrat-ledger`
**Files**:
- `docs/roadmap/features/257-fix-ledger-query-pagination/context.md` — modify (record the run)

**Reviewers**: `xstockstrat-ledger` owner — Append-only invariant (no deletes or updates), event ordering, hypertable partition safety

**Codebase Evidence**:
- No real-TimescaleDB ledger harness exists in `services/xstockstrat-ledger/src/__tests__/` (recon.md § Risks).
  `scripts/integration-test.sh:229-246` targets stale HTTP Connect paths, so it cannot host AC-5.
- The CI TimescaleDB job is a rejected alternative (design.md § Rejected Alternatives). The evidence plan is this
  manual run, which the operator accepted at r2 (context.md, Session 2026-10-22 — sdd-design).
- The operator required the run to include the string-typed sequence checks and the real-pg token walk (operator
  decision 2026-10-22).
- Page-token claims need one real-backend check, because stubs cannot prove paging (fails.md 2026-10-07
  backfilled-data-queryable entry).
- Local stack: `docker-compose.yml` plus `./scripts/bootstrap.sh` (TimescaleDB + migrations); ledger pool
  `DB_POOL_MAX` (`src/index.ts:44`).

**TDD**: `N/A (manual evidence run; the CI RED/GREEN for AC-5 is Step 5)`

**Covers**: `AC-5, AC-1`

**Instructions**:
1. Bring up TimescaleDB, run the ledger migrations, and start the Step 2–4 ledger build with `DB_POOL_MAX=1`. Seed
   200 000 `ledger.events` rows with mixed `event_type` (record the selectivity of the filtered type), so that
   `sequence` crosses several digit boundaries.
2. **AC-5.**
   - Open 5 concurrent `StreamEvents` replays (`from_sequence` 0, one filtered by a sparse `event_type`).
   - While they replay, issue `AppendEvent` calls in a loop and record their p100 latency.
   - Pass: p100 < 2 s, and every replay delivers the pre-bound rows ascending with no duplicates (count + sorted
     uniqueness check).
3. **Real-pg token walk (AC-1).** `QueryEvents{event_type, page_size 1000}` follows `next_page_token` to `''` across
   a digit boundary. Every matching row is returned exactly once, in ascending order, and the last page's token is
   empty. Also run one walk with `owner_only: true` (263) and check it returns only the caller's rows.
4. **GetPnL ceiling inputs.** Record `per_page_ms` (median and p95 of the walk) and the platform's `order.filled` /
   `order.partially_filled` counts, then compute `walk_ms ≈ pages × per_page_ms` (design.md § 3).
5. Append a `## Session <date> — AC-5 manual run` entry to `context.md` with:
   - the parameters (row count, selectivity, `REPLAY_BATCH_SIZE`, `DB_POOL_MAX`, replay count);
   - the results (p100, walk counts, `per_page_ms`, `walk_ms` against the caller deadline);
   - the git sha the run used.
6. **Hard stop.** If any check fails, block the integration PR, record it in `## Deviation Log`, and ask the
   operator. The remedy is a smaller `REPLAY_BATCH_SIZE` or index migration `004` (DBA + owner, C-07), and both need
   a re-spec. If `walk_ms` is more than 50% of the deadline, open the user-scoped-walk follow-up (design.md § 3)
   rather than changing this feature.

**Verification**:
```bash
grep -n "AC-5 manual run" docs/roadmap/features/257-fix-ledger-query-pagination/context.md
# the entry records p100 < 2s, token-walk count == seeded matching count, and per_page_ms
```

---

### Step 9 — docs: ledger CLAUDE.md, ledger constitution invariant, portfolio CLAUDE.md, teardown audit

**Status**: `pending`
**Service**: `services/xstockstrat-ledger/`, `services/xstockstrat-portfolio/`
**Files**:
- `services/xstockstrat-ledger/CLAUDE.md` — modify
- `services/xstockstrat-ledger/docs/context-constitution.md` — modify
- `services/xstockstrat-portfolio/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Ledger `CLAUDE.md:35` says "**sequence** is globally monotonic — never gaps, never decreasing". That is wrong:
  `nextval`, so rollbacks burn values (design.md § 6).
- Ledger `CLAUDE.md` § Live Streaming Architecture (`:37-53`) says the handler "replays history with a
  borrow-and-release pool query, then subscribes to the notifier". That order is drift: the code subscribes first
  (`ledgerServiceImpl.ts:202` before `:235`).
- `docs/context-constitution.md:19` LEDGER-2, `:22` LEDGER-5 ("`StreamEvents` replay borrows-and-releases"), and
  `:24` LEDGER-7, the last row. 248 Step 11 appends LEDGER-8.
- Portfolio `CLAUDE.md:26-29` documents `GetPnL` `UNAVAILABLE` for quotes only (`ErrQuotesUnavailable` →
  `classifyGetPnLError`). `:118` already says pass 2 keeps "the highest cumulative `filled_qty`".
- Teardown rule: root `CLAUDE.md` § Teardown (context-forge refresh, or a manual reconciliation recorded in the PR
  body, fails.md:670).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. **Ledger `CLAUDE.md`.**
   - Invariant 4 becomes "monotonic, may gap (`nextval`; rollbacks burn values), never decreasing".
   - Rewrite the § Live Streaming Architecture order sentence as subscribe → bounded batched replay on the pool
     (`REPLAY_BATCH_SIZE`, up to a `max(sequence)` bound captured after subscribe) → synchronous flush → live.
   - Add one line that `QueryEvents` pages by an opaque `sequence` keyset token, with page size default 100 and cap
     1000.
2. **Ledger constitution.**
   - Append the next free `LEDGER-N` (`LEDGER-9` if 248's `LEDGER-8` has landed, else `LEDGER-8`). It covers:
     - the `QueryEvents` token is the decimal last `sequence`, and a bad token is code 3;
     - all sequence compare and encode goes through `toSeq` (pg BIGINT strings);
     - the late-commit delivery contract (sign-off (a)), noting that the gap class predates this feature in the live
       dedupe and the LEDGER-3 resume, while batching widens its window to the replay up to the bound;
     - `pg_snapshot_xmin` as the named follow-up;
     - the unbounded per-stream notifier buffer as an accepted limit.
   - Cite `ledgerServiceImpl.ts#queryEvents`, `#streamEvents`, `#toSeq`.
   - Amend LEDGER-5's `StreamEvents` clause to "replays in bounded pool batches, releasing between batches".
3. **Portfolio `CLAUDE.md` `:26-29`.** Add that a ledger page error, a deadline or a repeated page token also makes
   `GetPnL` return `UNAVAILABLE` (`ErrLedgerUnavailable`). Keep `:118`, which already matches.
4. **Teardown.** Run `/context-constitution refresh` scoped to the three files and fix any grounded drift. If the
   plugin is unavailable, re-read each file against the code, reconcile it by hand, and record both facts in the
   integration PR body.

**Verification**:
```bash
grep -n "may gap" services/xstockstrat-ledger/CLAUDE.md
grep -n "LEDGER-[89].*toSeq\|toSeq" services/xstockstrat-ledger/docs/context-constitution.md
grep -n "ErrLedgerUnavailable" services/xstockstrat-portfolio/CLAUDE.md
grep -n "then subscribes" services/xstockstrat-ledger/CLAUDE.md   # no hit
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
