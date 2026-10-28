# Design: fix-ledger-query-pagination

**Created**: 2026-10-22
**Rounds**: 2 (full; termination: approved — both blocking objections closed by the operator's r2 sign-off)
**Approved by**: user (operator) @ 2026-10-22, design gate r2, "APPROVED as synthesized" (context.md, Session 2026-10-22 — sdd-design)
**Grounded in**: recon.md
**Severity**: SEV-2

---

## Chosen Approach

The fix is three narrow edits, with no proto, migration or config change. `PageRequest`/`PageResponse` already carry
the fields the fix needs (recon.md:161-162). The consumer surface is internal only. The fix reaches users through
portfolio `GetPnL`'s realized P&L, which the UI trader and insights segments show via the existing BFF
`QueryEvents`/`GetPnL` paths (recon.md:87-89). No UI or agent-tool code changes.

**Rebase base (operator decision 2026-10-22).** `263-fix-edge-owner-scope` merges **first**. This feature rebases
onto 263's ledger `QueryEvents` owner filter, and builds the page token on top of it. The token must work together
with the owner predicate: the keyset `sequence > $n` is one more `conditions[]` entry, ANDed with 263's owner
condition, so paging never widens scope (ledger @AC-11). This design adds no `QueryEventsRequest` field. If
`/sdd-spec` finds that one is needed, it takes the next free field number after 263's `owner_only`.

### 1. Ledger `queryEvents`: keyset paging with a capped page size (D-13; FR-1..FR-4)

Edit site: `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:124-176` (recon.md:23-30).

- **Constants.** Add `QUERY_EVENTS_DEFAULT_PAGE_SIZE = 100` and `QUERY_EVENTS_MAX_PAGE_SIZE = 1000` next to
  `EXPORT_BATCH_SIZE` at `:11` (recon.md:42, :96-97).
- **Limit clamp.** A non-positive `page_size` gets the default. A value above the max is capped at the max. Nothing
  is rejected, so no caller has to change.
- **Token.** The token is the decimal string of the last returned row's `sequence`. It stays opaque to callers
  (recon.md:103-104).
  - `parseSequenceToken` accepts `/^\d{1,19}$/` with a value `<= 2^63-1`.
  - Anything else returns gRPC code 3, INVALID_ARGUMENT (recon.md:101-102).
- **Query.** Bind the token as `sequence > $n::bigint` through the existing `conditions[]`/`params[]` builder
  (`:126-156`).
  - Replace `ORDER BY recorded_at ASC` (`:162`) with `ORDER BY sequence ASC`. Export (`:316`) and replay (`:240`)
    already sort this way, and `idx_events_sequence` backs it (recon.md:98-100, :53).
  - Keep the `limit+1` probe (`:166`), so an exactly-full last page returns an empty token.
  - `totalCount` stays the page length, as a number (recon.md:114, :233).
- **Sequence helper.** One shared helper turns a `sequence` into a BigInt. It accepts `number`, decimal `string` and
  `bigint`, because pg returns BIGINT as a string (no `setTypeParser`, recon.md:177-185) and the proto-loader `longs`
  option is unverified. The token encoder, the replay cursor and the `maxSeq` dedupe all use it.
- **Order switch.** `recorded_at` and `sequence` order can differ only for rows inserted concurrently
  (recon.md:201-206).
  - GetPnL pass 2 no longer depends on order (§3).
  - `HydrateStops` (`portfolio_service.go:534`, first 100, no paging) may pick a different first 100 only when
    concurrent inserts tie. That is accepted and needs no change.
  - The other callers send no `Page` and keep the default of 100: trading `trading.go:2222`, the UI BFF and the UI
    callers (recon.md:84-89). The stray `trading.go:2091`/`:3221` cites in FR-4 are dropped (recon.md:198-200).

### 2. Ledger `streamEvents`: bounded, batched replay on the pool (D-27; FR-7)

Edit site: `ledgerServiceImpl.ts:182-260` (recon.md:31-41). This keeps LEDGER-2's ordering, subscribe → replay →
buffer-flush → go-live (recon.md:56-57).

- **Order of operations.**
  1. Subscribe through `notifier.subscribe` (`:202`), as today.
  2. Capture `max(sequence)` once, as the replay's upper bound.
  3. Run a keyset batch loop `sequence > cursor AND sequence <= bound ORDER BY sequence ASC LIMIT
     REPLAY_BATCH_SIZE` on `this.pool`, with `REPLAY_BATCH_SIZE = 1000`. Each batch is its own single-statement
     query, so the one pooled connection is released between batches and a queued `AppendEvent` gets in.
  4. Flush the buffer synchronously, deduped by BigInt `row.sequence > maxSeq` (`:255-259`).
  5. Set `live = true`.
- **Cancellation.** Check `cancelled`/`cleaned` between batches (`:222-231`, `:251`).
- **Backpressure.** When `call.write()` returns false, await a drain helper that races `drain` against
  cancel/close/error (recon.md:207-208).
- **`maxSeq`.** It becomes a BigInt through the shared helper at every use: the seed (`:191`), `writeRow` (`:196`),
  the live dedupe (`:210`) and the flush (`:256`). This fixes the string-vs-string lexicographic comparison
  (`"10" > "9"` is false) at recon.md:177-185. The comparison must also cover 248's trimmed-notify rows when this
  feature rebases onto 248.
- **Connection budget.** It stays at 1 pooled connection plus 1 LISTEN connection (F-06). The replay never moves onto
  the LISTEN client (fails.md:3006-3021, recon.md:216-219).
- **Constant.** `REPLAY_BATCH_SIZE` stays a constant, following the `EXPORT_BATCH_SIZE` precedent. If production
  needs tuning, it is promoted to `ledger.stream.replay_batch_size` (C-05, needs config-team approval).
- **Delivery contract, signed off by the operator 2026-10-22 (r2, change (a)).** Every matching event committed
  before the walk passes its sequence is delivered exactly once, in ascending order. A lower sequence that commits
  after the walk has passed it is not delivered by that walk.
  - The gap *class* predates this feature: the live dedupe at `:210` and the LEDGER-3 resume both have it.
  - Batching widens the gap *window* from one statement snapshot to the length of the replay up to the bound.
  - A `pg_snapshot_xmin` bound is the named follow-up, and that widening is its trigger.

### 3. Portfolio `GetPnL`: fail closed and fold every fill exactly once (D-46; FR-5, FR-6)

Edit site: `services/xstockstrat-portfolio/internal/service/portfolio_service.go:718`, `:749-845` (recon.md:58-74).

- **Sentinel.** Add `ErrLedgerUnavailable` next to `ErrQuotesUnavailable` (`:718`, recon.md:105-106).
- **Page errors.** Both `slog.Warn` + `break` sites (`:757`, `:802`) return
  `fmt.Errorf("GetPnL: QueryEvents (<type>): %w: %w", ErrLedgerUnavailable, err)`.
- **Repeated token.** A page that returns the same token it was sent also returns `ErrLedgerUnavailable`. This guards
  against an old ledger build or any re-read loop.
- **Page size.** Change both `PageSize: 500` literals (`:754`, `:799`) to 1000, to match
  `QUERY_EVENTS_MAX_PAGE_SIZE`.
- **Pass 2 (changed per the operator sign-off 2026-10-22, change (b)).** Per order ID, keep the
  `order.partially_filled` event with the **largest cumulative `FilledQty`**, instead of "last wins".
  - Comparison is strict `>`, so on an equal `FilledQty` the first event seen is kept.
  - The result does not depend on event order, which removes the coupling to the order switch.
  - Update the `:829-830` comment and the `computeRealizedPnL` test mirror (`portfolio_helpers_test.go:107`,
    recon.md:119-120) in the same edit.
- **Error mapping.** `classifyGetPnLError` (`internal/handler/portfolio_handler.go:425`) gains an
  `errors.Is(err, ErrLedgerUnavailable)` → `CodeUnavailable` branch.
  - `toGRPCError` (`:432-446`) already maps Unavailable, so no change is needed there.
  - FR-6 is met through UNAVAILABLE. A ledger deadline is wrapped in the same sentinel. No DEADLINE_EXCEEDED mapping
    is added, because both layers would drop it today (recon.md:186-189).
  - `TestClassifyGetPnLError` (`portfolio_handler_test.go:39`) gets the new case on purpose, and its existing
    assertions stay (recon.md:117-118).
- **Trace propagation (C-03, operator decision 2026-10-21).** Every page call uses the inbound request `ctx`, so
  `x-trace-id`, `x-user-id` and `x-access-scope` go out on every page. No background context is introduced.
- **No `SourceService` fix here.** 251's `SourceService` fix is **not** absorbed. A `merge-order.md` row enforces
  257 ≤ 251 instead.

**GetPnL ceiling.**
- Pages walked: `pages = ceil(platform_filled/1000) + ceil(platform_partials/1000)`.
- Walk time: `walk_ms ≈ pages × per_page_ms`, compared against the caller deadline.
- Follow-up trigger: once `walk_ms` is more than 50% of the deadline, add a user-scoped walk on
  `idx_events_user_sequence`. That walk depends on 263's NULL-`user_id` handling.

**P&L behaviour change** (insights.md:176-188, recon.md:222-223). Once 251 lands, realized P&L changes for every user
on a platform with more than 500 fills. The new value is the correct one. It must be announced as a correction, not
read as a regression.

### 4. Tests (C-15)

- **Ledger `queryEvents` and replay tests.** Rows carry `sequence` as a pg-style **string** that crosses a digit
  boundary (`"9"`, `"10"`, `"11"`).
  - The token round trip, the batch cursor and the `maxSeq` live dedupe must all advance correctly.
  - The existing mocks are numeric (`ledgerServiceImpl.test.ts:66`, `:100`, `:174`) and hide this bug.
- **FIFO interleave test.** It uses a single-slot pool fake in the `makeIdempotentPool` style
  (`ledgerServiceImpl.test.ts:56`, recon.md:112-114).
  - An INSERT queued during the replay must run before the next batch's SELECT.
  - The replayed sequences must be strictly ascending and unique.
  - The test is RED on today's code.
- **Drain-helper test.** Covers `write()` returning false.
- **Portfolio AC-3, AC-4 and AC-6.** These use a scripted paging `QueryEvents` fake in the `stopLedger` style
  (`portfolio_risk_test.go:143-148`) with `ctxWithUser` (`watchlist_service_test.go:280`), extending `fakeLedger`
  (`watchlist_service_test.go:254`) (recon.md:107-111). They cover multi-page exactly-once, a page error → UNAVAILABLE,
  a repeated token → UNAVAILABLE, and the max-cumulative partial.

### 5. AC-5 evidence (C-15)

- **Run.** One manual run against TimescaleDB with `DB_POOL_MAX=1`, 200k rows and 5 concurrent replays.
- **Recorded in `context.md`.** The run's parameters: row count, `event_type` filter selectivity and
  `REPLAY_BATCH_SIZE`. Its results:
  - the `AppendEvent` p100 against the 2 s bound;
  - a real-pg `QueryEvents` token walk across a digit boundary that returns every row once, in order
    (fails.md:2783-2786);
  - `per_page_ms` and the platform fill count, used for the GetPnL ceiling.
- **Gate.** A failed run is a **hard stop before merge**. Its remedy is a smaller `REPLAY_BATCH_SIZE`, or index
  migration `004` with DBA and service-owner approval (C-07; recon.md:163-164).
- **Harness comment.** AC-5's comment becomes: "Evidence: unit FIFO interleave test (CI) + one recorded
  real-TimescaleDB run (context.md); not a CI job." No existing harness can host AC-5 (recon.md:209-213).

### 6. Docs and teardown

- **Ledger `CLAUDE.md` "Live Streaming Architecture".** Rewrite it for subscribe → bounded batched replay → flush →
  live. This also fixes the "replays … then subscribes" order drift at `:43-44`.
- **Ledger `CLAUDE.md` Critical Invariant 4 (`:35`).** Correct it to "monotonic, may gap (nextval; rollbacks burn
  values)".
- **New LEDGER-* invariant** in `services/xstockstrat-ledger/docs/context-constitution.md`. It covers:
  - the token format;
  - the late-commit delivery contract (§2), including how batching widens the window;
  - the `pg_snapshot_xmin` follow-up;
  - the accepted limit of an unbounded per-stream buffer.
- **`docs/roadmap/features/merge-order.md`.** Add:
  - the row "`fix-getpnl-source-service` must wait for `fix-ledger-query-pagination`";
  - a note that 263 merges before 257;
  - a rolling-deploy note: during the ledger rollout, a token from an old ledger build (an `event_id` UUID) or a
    repeated page makes GetPnL return UNAVAILABLE.
- **Teardown.** Run the context-constitution teardown audit over the files touched.

**Build order:**
1. Sequence helper, `queryEvents` and the string-sequence tests.
2. Bounded replay, drain helper and FIFO tests.
3. Portfolio `GetPnL`: sentinel, classifier, pass 2, the `PageSize` edit, and their tests.
4. The manual AC-5 run.
5. Docs and teardown.

## Rejected Alternatives

- **A dedicated `pg.Client` + `Cursor` for the replay** (the export pattern at `:333-352`, recon.md:93-95). Rejected:
  each concurrent replay would add a backend connection beyond the 1+1 budget (F-06).
- **Option (b), a `pg_snapshot_xmin` bound on each page and batch.** Rejected: it closes the gap on the replay path
  only, while the live dedupe at `:210` and the LEDGER-3 resume keep it, and it adds mechanism. It stays the named
  follow-up.
- **An open-ended "loop until a short batch" replay.** Rejected: it may never end under sustained appends. The
  `max(sequence)` bound captured after subscribe replaces it.
- **A CI TimescaleDB service-container job for AC-5.** Rejected: it adds a new CI job, against the low-rework ask. A
  unit FIFO test plus a recorded manual run is used instead.
- **A buffer-length cap that calls `call.end()` and relies on the LEDGER-3 resume.** Rejected: it adds a reconnect
  trigger for portfolio's three permanent streams (YAGNI, C-18). The unbounded buffer is recorded as an accepted
  limit.
- **Keeping GetPnL `PageSize` at 500.** Rejected: raising it to 1000 halves the walk at no cost.
- **A user-scoped GetPnL walk on `idx_events_user_sequence` now.** Rejected: it depends on 263's NULL-`user_id`
  handling. It is deferred behind the 50%-of-deadline trigger.
- **Absorbing 251's `SourceService` change.** Rejected: it widens scope against the operator's grouping. The
  merge-order row is used instead.
- **A config key for the page size or `REPLAY_BATCH_SIZE` now** (`ledger.query.max_page_size`, recon.md:165-167).
  Rejected: the `EXPORT_BATCH_SIZE` constant is the precedent. Promotion is documented in case a tuning need appears.
- **Rejecting an oversized or non-positive `page_size` with INVALID_ARGUMENT.** Rejected: clamping needs no caller
  change.
- **One shared 1000 constant.** Rejected: the three values mean different things. Only the BigInt sequence helper is
  shared.

## Open Risks

- [ ] **Late-commit skip.** The window widens from one statement snapshot to the whole bounded replay, and paging
  exposes it to GetPnL for the first time. The contract is accepted (operator sign-off, change (a)). The
  `pg_snapshot_xmin` follow-up stays named. To be addressed in the LEDGER-* invariant at the docs step.
- [ ] **AC-5 rests on one manual real-DB run.** Five concurrent replays with a sparse `event_type` filter on
  `idx_events_sequence` may exceed the 2 s bound. The remedy is a smaller `REPLAY_BATCH_SIZE` or migration `004`
  (C-07, DBA). A failed run is a hard stop. To be addressed at the manual AC-5 step (build order 4).
- [ ] **GetPnL availability scales with the platform-wide fill count.** Past the ceiling, every user gets
  UNAVAILABLE. To be addressed by measuring `per_page_ms` at build order 4, with the user-scoped walk as the
  follow-up trigger.
- [ ] **Realized P&L changes on purpose** once there are more than 500 platform fills and 251 lands. It must be
  announced as a correction. To be addressed in the PR description, the merge-order note and the 251 hand-off.
- [ ] **The per-stream notifier buffer is unbounded.** This is an accepted memory limit while a slow client stalls
  the replay. To be addressed in the LEDGER-* invariant at the docs step.
- [ ] **Rolling-deploy skew.** Old ledger tokens or repeated pages make GetPnL return UNAVAILABLE until the ledger
  rollout completes. To be addressed by the merge-order rolling-deploy note at the docs step.
- [ ] **Rebase coupling with 248 inside `streamEvents`.** The BigInt comparison must cover trimmed rows. To be
  addressed at the replay step (build order 2).
- [ ] **263's owner scope may drop old fills.** If 263 scopes `QueryEvents` by `x-user-id`, GetPnL loses fills written
  before migration 003 unless 263 accounts for them. To be addressed when rebasing onto 263, before build order 1.
- [ ] **The ledger real-implementation tests depend on 252 landing first.** To be addressed by the merge-order check
  at `/sdd-spec`.
- [ ] **The proto-loader `longs` option is unverified.** The BigInt helper must accept number and string for both
  `fromSequence` and `row.sequence`. To be addressed at build order 1.

## Constitution Rules Touched

- `C-03`: honored by keeping the inbound request `ctx` on every GetPnL page call, so the header trio and `x-trace-id`
  propagate. No fresh background context is introduced, and there is no C-03 waiver (operator decision 2026-10-21).
- `C-05`: honored by adding no config key now. A future `ledger.stream.replay_batch_size` would follow
  `<service>.<category>.<key>` and need config-team approval.
- `C-07`: honored by adding no migration. The contingent index migration is a new numbered `004`, with DBA and
  service-owner approval.
- `C-11`: honored by a full-mode debate of 2 rounds, recorded in the ledger.
- `C-15`: honored by covering every FR/AC with tests (string-sequence, FIFO RED, drain, scripted GetPnL fakes). AC-5
  evidence is the CI FIFO test plus the recorded manual run, which the operator accepted at r2.
- `C-16`: honored by giving each durable business rule a verdict below. CHANGEs touch this feature's own FR/AC only,
  and the operator signed them off.
- `C-18`: honored by rejecting the buffer cap and the speculative config keys (YAGNI).
- `P-02`: honored by mediating the proposer and adversary through synthesized state only.
- `P-03`: honored by stating the late-commit gap as an explicit, signed-off contract instead of an "exactly once"
  claim. FR-6's DEADLINE_EXCEEDED narrowing to UNAVAILABLE is recorded here.
- `F-01`: honored. No applied migration is edited, and no migration is added.
- `F-06`: honored. The ledger connection budget stays 1 pooled + 1 LISTEN, and the replay batches on the pool,
  releasing the connection between batches.
- `F-07`: honored. Constants follow the `EXPORT_BATCH_SIZE` precedent, and no literal is hardcoded where config
  governs.
- `LEDGER-2`: honored by keeping subscribe → replay → flush → live, with the replay now bounded and batched.
- `LEDGER-3`: honored. Resume from the last `sequence` is unchanged, and its existing late-commit gap is documented.
- `PLAT-N1`: honored by the define-then-verify loop: RED tests first, and the AC-5 hard stop before merge.

## Business Rules Touched (C-16)

- PRESERVE `@AC-1` "Date-range export streams every event as NDJSON in global-sequence order"
  (`docs/sdd/business-rules/platform.feature`, @feature-021). Not regressed by: the export path is untouched, and
  `QueryEvents` now uses the same `sequence` order.
- PRESERVE `@AC-6` "A long-lived streaming RPC survives a certificate rotation"
  (`docs/sdd/business-rules/platform.feature`, @feature-210). Not regressed by: the subscribe → replay → flush → live
  hand-off and the LEDGER-3 resume are kept. Batching changes only how the replay is read.
- PRESERVE `@AC-7` "A one-million-row export streams without buffering the full result set"
  (`docs/sdd/business-rules/platform.feature`, @feature-021). Not regressed by: `streamExportRows` and its `Cursor`
  are not changed.
- PRESERVE `@AC-10` "A snapshot write emits an append-only audit ledger event"
  (`services/xstockstrat-ledger/acceptance/snapshot-offline-positions.feature`, @feature-163). Not regressed by: the
  batched replay releases the pool between batches, so `AppendEvent` commits normally during a replay. The FIFO test
  and AC-5 prove it.
- PRESERVE `@AC-11` "The export returns only the authenticated user's own events"
  (`services/xstockstrat-ledger/acceptance/ledger-event-export.feature`, @feature-021). Not regressed by: the keyset
  condition is ANDed with 263's owner predicate and never widens scope.
- EXTEND `@AC-5` "GetPnL refuses to report unrealized P&L when a needed quote is unavailable"
  (`services/xstockstrat-portfolio/acceptance/fix-book-portfolio-page.feature`, @feature-229). New case added: a
  ledger page error, a deadline or a repeated token returns UNAVAILABLE with no `PnLResponse`. The quote mapping
  stays.
- PRESERVE `@AC-6` "GetPnL values broker-synced positions from the broker price without a quote fetch"
  (`fix-book-portfolio-page.feature`, @feature-229). Not regressed by: the unrealized side is not changed.
- PRESERVE `@AC-6` "A one-sided quote with a close older than the mark bound is priced from the last close on
  ListPositions while GetPnL stays unpriced" (`fix-after-hours-positions-priced.feature`, @feature-231 @feature-240).
  Not regressed by: quote and pricing logic are not changed.
- PRESERVE `@AC-13` "Every portfolio read path values the one-sided position identically"
  (`fix-after-hours-positions-priced.feature`, @feature-231). Not regressed by: the unrealized valuation is not
  changed.
- PRESERVE `@AC-28` "GetPnL keeps refusing an offline holding without a live quote"
  (`offline-account-full-pnl.feature`, @feature-240). Not regressed by: the quote-refusal path is not changed.
- CHANGE 257 `@AC-1`/`@AC-5` + FR-1/FR-7, "exactly once" qualified for late commits. New wording: "every matching
  event committed before the walk passes its sequence is delivered exactly once, ascending; a lower sequence
  committing after the walk passed it is not delivered by that walk". Signed off by the operator @ 2026-10-22, design
  gate r2, change (a) (context.md, Session 2026-10-22 — sdd-design).
- CHANGE 257 FR-5, pass 2 moves from "last event per order ID wins" to "max cumulative `FilledQty`, strict `>`, first
  seen wins a tie". Signed off by the operator @ 2026-10-22, design gate r2, change (b) (context.md, Session
  2026-10-22 — sdd-design).

The two CHANGEs are to this feature's own net-new FR/AC, not to a promoted durable suite. `/sdd-spec` restates
product-spec.md FR-1, FR-5 and FR-7 and acceptance.feature AC-1 and AC-5 to match.

## Rounds

- **Round 1 (full).** Three-edit synthesis: keyset `queryEvents`, bounded pool-batched replay, and fail-closed GetPnL.
  It rejected the dedicated Cursor client (F-06) and the open-ended replay loop.
- **Round 2 (full).** Closed objection 4 (the ceiling formula, plus the `PageSize` 500→1000 edit) and objection 9
  (the unbounded buffer as an accepted limit). It folded in the replay-window note, the config-promotion note, the
  rolling-deploy note, the classifier `%w` wrap and the CLAUDE.md order-drift fix. Two objections remained blocking:
  the late-commit "exactly once" restatement, and the string-typed sequence test gap. Two remained non-blocking: the
  FR-5 rewording and the AC-5 evidence plan.
- **Termination: approved.** At the r2 gate, the operator approved the design as synthesized. The operator signed off
  both spec changes, (a) the late-commit wording and (b) the max-cumulative pass 2. The operator also required the
  string-typed sequence tests and the real-pg token walk in the manual run, which closes the remaining blocking
  objection and accepts the AC-5 evidence plan. No Floor breach.
