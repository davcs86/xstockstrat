# Context Log: fix-position-fold-correctness

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect reports (Issues disabled; clustered triage):
  - `docs/reports/2026-10-06-portfolio-fill-fold-not-exactly-once-defect.md` — portfolio re-applies full order.filled history on restart; position writes serialized in-process only (SEV-2, production)
  - `docs/reports/2026-10-21-portfolio-live-fold-sell-sign-loss-defect.md` — live position fold treats every trading sell fill as a buy (SEV-2)
  - `docs/reports/2026-10-21-trading-bracket-leg-fills-missing-from-realized-pnl-defect.md` — bracket leg fills never reach the ledger, so realized P&L omits the exit (SEV-2)
- Cluster rationale: all three corrupt the same portfolio live fold of `order.filled` (which fills arrive, how often, and with what sign); fixing them separately would re-touch processOrderFill three times.
- Severity: SEV-2 (all three)
- Routed to SDD path (Track C); prod-impacting SEV-2 (report 1) routed to C by operator decision 2026-11-10
- Created: status.md, feature.md, product-spec.md, acceptance.feature (4 regression scenarios), context.md; report sidecars stamped `triaged`
- Affected services (from reports): xstockstrat-portfolio, xstockstrat-trading
- Root cause hypothesis: in-memory-cursor fold with no idempotency key or DB-level locking; fold ignores side (trading now emits `side` since 251, consumer unchanged); no poller for bracket leg fills
- Recommended design depth: full → `/sdd-design fix-position-fold-correctness` (rationale: DB migration for exactly-once, 2 services, production data repair question)
- Development branch: feature/fix-position-fold-correctness

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags); five open questions deferred to design incl. repair of already-inflated realized_accum; first review FAILed crit 7 + trading C-5 (fixed: migration strategy, AC-5 partial leg fill)
- Overlap findings: WARN: trading/portfolio shared with 312/315/321/326; portfolio migrations vs 318 ordering gate
- Recommended design depth: full (DB migration (portfolio 019); trading + portfolio)
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)

## Session 2026-11-11 — sdd-batch design gate (round 2)

- `/sdd-design fix-position-fold-correctness` (full) halted at its approval gate after round 2 (gate policy: halt). design.md NOT written; status.md unchanged (spec-ready). Register: `debate.md` (D-1..D-11, R-1..R-8, O-1..O-22, P-1).

## Open Threads

- **Approach (round-2 synthesis).** Portfolio: migration `019_fill_applied_events` adds `portfolio.consumer_applied_events` (PK `consumer, user_id, account_id, order_id`; nullable `pending_closed` outbox; no sequence column) and `portfolio.consumer_floors`. `processOrderFill` acks below the time floor (new `errFillAcked`), signs with `signedQty` and parks side-less post-floor fills directly (`ErrFillUnattributable`), then folds inside one tx in `repo.ApplyFill` (`pg_advisory_xact_lock` + `INSERT … ON CONFLICT DO NOTHING` + `SELECT … FOR UPDATE` + `pnl.FoldFrom`) under `positionsMu`. Post-commit `position.*` emits are keyed `<type>:<stored event_id>`; a duplicate re-emits a non-NULL `pending_closed` under the stored id. `observed()` gains explicit acked/parked sentinel branches. A flip through zero emits `closed` then `opened` for a fresh short row. Trading: migration `012_bracket_legs` (TEXT enums, PK `account_id, leg_order_id`, one-time seed with `filled_qty` NULL); leg rows written at leg-id assignment (createBracket, resize ACTIVE) with an alert on failure; `pollBracketLegFills` runs after the `pollFills` loop with one `ListOrders` per account plus capped `GetOrder`; unbaselined legs with a fill > 0 are retired `BASELINE_RETIRED` without emit; not-found legs retire `UNKNOWN` with a WARN; leg emits go through a synchronous keyed `appendLedgerEvent` (D-4 key) with a first-failure per-tick budget, never touching `trading.orders`.
- **Strongest open objection.** P-1 / O-17: REOPEN D-4 is pending an operator ruling. `ledger.idempotency_keys.idempotency_key` is a bare global PK and IBKR leg ids may repeat across accounts, so the D-4 key `bracket-leg:<legID>:<status>:<filledQty>` can silently drop a second account's exit fill. Requested amendment: `bracket-leg:<account_id>:<legID>:<status>:<filledQty>`. Other blocking objections awaiting proposer confirmation with tests: O-14 (`observed()` sentinel branches), O-15 (retire-without-emit for partially filled baselined legs), O-16 (re-emit keyed on stored `event_id`).
- **Floor status.** No Floor breach.
- **Uncovered @AC changes.** `@AC-5` CHANGE (amended wording: `order.partially_filled` filled_qty 4, then `order.filled` qty 10 cumulative at leg average 110) is not covered by an operator decision; needs operator sign-off recorded here (O-11). All other rules (@AC-1..@AC-4, 294 @AC-56, 294 @AC-6, 251 @AC-17, 290 @AC-3, 206 trading @AC-1) PRESERVE.
- **Operator sign-offs still needed.** O-3 cutover residual (overlap double-apply; fills the old binary never folded before first new boot; late-commit `recorded_at` before the floor), O-8 parked re-park every boot, O-11 AC-5 wording, O-13 reconciliation residual, plus the P-1 ruling.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Round-2 synthesis. It keeps D-1 to D-6 and R-1 to R-5, takes the proposer's r2 structure, and folds in fixes for the adversary's r2 blocking defects. I checked three facts against the code:\n- `observed()` maps no sentinels. At `services/xstockstrat-portfolio/internal/service/portfolio_service.go:231-242` every non-nil error counts as \"error\" and is returned.\n- `errFillAcked` does not exist. `ErrFillUnattributable` does (`:972`).\n- `ledger.idempotency_keys.idempotency_key` is a bare global PRIMARY KEY (`services/xstockstrat-ledger/migrations/002_idempotency_keys.up.sql:10`). Nothing prunes it today.\n\nPORTFOLIO (order.filled consumer only; 290 @AC-3 keeps the other consumers on replay-from-0)\n\n(1) Migration `019_fill_applied_events` (additive, with a .down.sql).\n- `portfolio.consumer_applied_events(consumer TEXT, user_id TEXT, account_id TEXT, order_id TEXT, event_id UUID NOT NULL, applied_at TIMESTAMPTZ DEFAULT now(), pending_closed TEXT NULL, PRIMARY KEY (consumer, user_id, account_id, order_id))`.\n  - `account_id` is the value after the `alpaca-default` fallback (`:435`).\n  - `user_id` is added at no cost, so the shared fallback account cannot alias across users.\n  - `order_id` comes from the payload. If it is empty, `event_id` is used.\n  - There is no sequence column (O-10).\n- `portfolio.consumer_floors(consumer TEXT PRIMARY KEY, floor_recorded_at TIMESTAMPTZ NOT NULL)`.\n\n(2) `observed()` change, specified explicitly (new).\n- `observed()` (`:231-242`) gains two sentinel branches before the generic error branch:\n  - `errors.Is(err, errFillAcked)`: count \"acked\", return nil. `errFillAcked` is a NEW unexported sentinel.\n  - `errors.Is(err, ErrFillUnattributable)`: ERROR log \"event parked\", count \"parked\", return nil.\n- Everything else is unchanged: count \"error\" and return the error.\n- `observed()` wraps all five consumers (`:177`, `:1693`, `:1741`, …). The spec must show that no other consumer returns either sentinel today (grep evidence), and add a telemetry test next to `portfolio_telemetry_test.go:578` for each branch plus the unchanged error path.\n- Fresh fills still count `okOutcome` \"ok\" (294 @AC-56).\n\n(3) `processOrderFill`, in order:\n1. Parse the payload and resolve mode (`:373-394`).\n2. Floor check: if `recorded_at < floor`, return `errFillAcked`. One boot INFO line logs the count acked below the floor.\n3. Sign with `signedQty(side, qty)` (`:1065`). If side is empty after the floor, return `ErrFillUnattributable` (parked) directly. The `orderSide` ledger fallback (`:1077`) is NOT called on the live path. Every post-floor `order.filled` comes from current trading code, which sets side (`trading.go:1892-1895`), and legs always set it (D-4). This removes a `QueryEvents` round trip and the `ErrLedgerUnavailable` branch from the fill hot path.\n4. Take `positionsMu` (D-5).\n5. Call `repo.ApplyFill`, which runs one tx (`queryRower.Begin` added at `portfolio_repo.go:22-26`):\n   - `pg_advisory_xact_lock(hashtextextended(user|symbol|mode|account,0))`. It is tx-scoped, so it is PgBouncer-safe (`pool.go:29-31`).\n   - `INSERT applied … ON CONFLICT DO NOTHING RETURNING`.\n   - `SELECT … FOR UPDATE`.\n   - A pure callback over `pnl.FoldFrom` (`pnl.go:54`).\n   - The existing additive upsert (`portfolio_repo.go:61-69`) or the delete.\n   - On a close, set `pending_closed` to the closed payload JSON, bound as a string (fails.md 2026-09-01).\n   - COMMIT.\n6. Duplicate path: `ApplyFill` returns the STORED row's `event_id` and `pending_closed`. If `pending_closed` is non-NULL, re-emit it with key `position.closed:<stored event_id>`. Never use the incoming `event_id`, because a producer duplicate carries a fresh uuid (`trading.go:3848`). Otherwise return `errFillAcked`.\n7. After commit, emit `position.closed`/`opened`/`updated` through `emitEventAs`. It gains a key parameter, where empty means a uuid. The key is `<type>:<stored event_id>`. When the closed emit succeeds, run `UPDATE … SET pending_closed=NULL`.\n8. Release `positionsMu`, then run `checkRiskLimits` and `broadcastSnapshot` (`:482-485`).\n\n(4) Flip through zero (O-6).\n- Emit `closed` for the long, with `realized_accum` plus the fold delta plus this fill's fees.\n- Then write a fresh short row (accumulators 0, `opened_at` = now) and emit `opened`.\n- Rewrite the portfolio CLAUDE.md \"Named v1 scope limitation\" paragraph.\n- Retire `computeNewPosition` (`portfolio_helpers_test.go:23-36`).\n\nTRADING (observer is a `pollFills` callee; no `StartFillPoller` change, per 294 @AC-6 and D-3)\n\n(5) Migration `012_bracket_legs` creates `trading.bracket_legs`.\n- Columns:\n  - `leg_order_id TEXT`\n  - `account_id TEXT`\n  - `bracket_id UUID`\n  - `parent_order_id UUID`\n  - `user_id TEXT`\n  - `symbol TEXT`\n  - `side TEXT NULL` (enum name; 0 stored as NULL, following the trading persistence convention used by `trading.orders` and `order_brackets`)\n  - `trading_mode TEXT NULL` (same convention)\n  - `filled_qty NUMERIC NULL`\n  - `terminal_status TEXT NULL`\n  - `PRIMARY KEY (account_id, leg_order_id)`\n- Partial index `WHERE terminal_status IS NULL`.\n- One-time seed: `INSERT … SELECT` of every non-empty `stop_leg_order_id`/`take_profit_leg_order_id`, joined to the latest `trading.orders` row (`DISTINCT ON order_id`), with `filled_qty` NULL (not baselined).\n- No seed-time terminal marking for CANCELED brackets. Their legs can still fill (R-4 rationale, `trading.go:1400-1411`, `:3002`).\n\n(6) Write leg rows at the point leg ids are assigned. This replaces the per-tick `EnsureLegsTracked` sweep.\n- Write sites:\n  - `createBracket` (`trading.go:3553`, after `SubmitBracketLegs`).\n  - The resize ACTIVE write (`:3630`).\n- Each site writes its `bracket_legs` rows in the same statement or tx as `UpdateBracketStatus(…ACTIVE, legIDs…)`, as a `BracketRepository` method.\n- If that write fails, emit an alert via the existing `emitBracketFailureAlert` path, not a bare WARN.\n- `resizeBracket` keeps its current control flow. The new early-return branch is dropped (it would skip `ReArmProtection` at `:3615` and leave the added qty unprotected). The old leg rows already exist from the earlier ACTIVE write and stay observable after `:3612` blanks the bracket columns (O-12).\n- `BracketRepository.ListObservableLegs` returns rows `WHERE terminal_status IS NULL`.\n\n(7) `pollBracketLegFills(ctx, brokerMap)` runs after the `pollFills` candidate loop (`trading.go:1830`).\n- Fetching:\n  - One `Broker.ListOrders` (`broker.go:74`) per account that has observable legs.\n  - Legs missing from the list fall back to `GetOrder` (`broker.go:69`), capped per account per tick.\n  - Budget per tick: 1 `ListOrders` plus at most the cap of `GetOrder` calls per account with legs (O-7).\n- A not-found leg is set terminal `UNKNOWN`, with no emit and a WARN that names the leg. This keeps legs the broker has forgotten from being polled forever.\n- Per leg:\n  - Not baselined (`filled_qty` NULL), broker cumulative 0: store 0, no emit. The leg is now observed normally.\n  - Not baselined, broker cumulative > 0: store the broker state and set terminal `BASELINE_RETIRED`, with no emit and an INFO count. This stops a later terminal `order.filled qty=<cumulative>` from over-reducing a position that sync already set to broker truth. Without it the position flips to a phantom short, which would false-halt reconciliation (206 trading @AC-1).\n  - Baselined, cumulative rises while open: emit `order.partially_filled` with the cumulative `filled_qty`.\n  - Baselined, terminal (FILLED, or CANCELED/EXPIRED with `FilledQty > 0`): emit `order.filled` with qty = final cumulative `FilledQty` and fill_price = `FilledAvgPrice` (`broker.go:24-25`), then set `terminal_status`.\n- Payload: the entry key set (`:1885-1895`), with these values:\n  - `order_id` and the stream key = leg id.\n  - `side = oppositeSide(parent)` (`:3463`).\n  - user, mode and account from the row.\n  - additive `parent_order_id`.\n\n(8) Delivery is synchronous (O-2, R-3).\n- `appendLedgerEvent` (`:3836`) gains an `idempotencyKey` parameter, where empty means `uuid.NewString()`. `emitLedgerEvent` passes \"\" (R-5).\n- The key format is as settled in D-4: `bracket-leg:<legID>:<status>:<filledQty>`. The adversary has petitioned to REOPEN D-4 and add `account_id`. That needs an operator ruling, so the approach does not change the key unilaterally.\n- The row advances only after a nil return.\n- Per-tick leg budget: on the first leg emit failure, stop leg emits for the rest of the tick. This bounds the stall to one `ledgerEmitTimeout × appendMaxAttempts` (`:3850-3863`). Parent fills and IBKR `SubmitBracketLegs` follow-ups are not starved, so the protection watchdog (`:3020-3031`) is not tripped.\n- Leg events never call `applyBrokerOrderStatus`, `s.orders` or `trading.orders` (D-3). So `NetFilledQtyBySymbol` (`trading_repo.go:171`) is unchanged.\n\n(9) AC-5 amendment (append-only, C-15, needs operator sign-off): \"an order.partially_filled event with filled_qty 4 and an order.filled event with qty 10 (cumulative) at the leg average price 110.\"\n\nBUILD ORDER\n1. Migrations 019 and 012.\n2. `queryRower.Begin`, `ApplyFill` and the `observed()` sentinel branches, with pgxmock and telemetry tests.\n3. The fold rewrite (AC-1, AC-3, flip), and the duplicate test with two distinct `event_id`s for one `order_id` (closed emitted once).\n4. Real-Postgres two-process tests under `DB_PGBOUNCER=true` (AC-2, fill-vs-fill).\n5. Keyed `appendLedgerEvent`, the leg writes at assignment, `ListObservableLegs` and the observer. Tests:\n   - AC-4 and AC-5, on Alpaca and IBKR\n   - ledger down, then retry with the same key\n   - first-failure tick budget\n   - sibling leg\n   - canceled bracket\n   - resize keeping old legs\n   - seeded leg with 0 fill, then observed\n   - seeded leg partially filled, then retired with no emit\n   - not-found, then terminal with a WARN\n6. Docs, the C-16 promotion, and the residuals in `context.md`.",
    "open_objections": [
      {
        "text": "REOPEN D-4 is pending an operator ruling. The leg idempotency key bracket-leg:<legID>:<status>:<filledQty> is scoped by nothing: ledger.idempotency_keys.idempotency_key is a bare global PK (ledger 002_idempotency_keys.up.sql:10). IBKR leg ids are broker-numeric and may repeat across accounts (ibkr.go:343). On a collision the ledger returns the first account's event and the second account's exit fill is dropped silently. The requested amendment is bracket-leg:<account_id>:<legID>:<status>:<filledQty>. Until the operator rules, either the amendment is applied or the spec must prove that leg ids are unique across accounts.",
        "blocking": true
      },
      {
        "text": "observed() (portfolio_service.go:231-242) maps no sentinel today. The spec must add explicit branches: errFillAcked (new) counts acked and returns nil; ErrFillUnattributable counts parked, logs ERROR \"event parked\" and returns nil. It must prove that no other observed()-wrapped consumer returns either sentinel, and add telemetry tests. Without this, the first event below the floor hot-loops the fill consumer at the 2 s retry and stalls every fill after it (fails.md 2026-11-04). The proposal's claim that no new sentinel is needed was false.",
        "blocking": true
      },
      {
        "text": "A leg baselined at cutover with filled_qty > 0 would over-reduce the position when its terminal order.filled qty=<cumulative> arrives, flip it into a phantom short, and false-halt reconciliation (206 trading @AC-1). The synthesis adopts retire-without-emit (terminal BASELINE_RETIRED). The proposer must confirm it and add the test.",
        "blocking": true
      },
      {
        "text": "The re-emit on a duplicate must use the STORED row's event_id (position.closed:<stored event_id>), never the incoming one. A producer duplicate carries a fresh uuid (trading.go:3848), and the incoming id would double-emit position.closed. The synthesis adopts this. The proposer must confirm it and add a test with two distinct event_ids for one order_id.",
        "blocking": true
      },
      {
        "text": "O-3 cutover is still not signed off by the operator. The residual must name three outcomes: an overlap fill double-applied once; a fill the old binary never folded before the first new boot (crash-loop, failed deploy) acked and permanently lost from the live fold; and a late-committing append whose tx-start recorded_at predates the floor and is acked. In each case qty heals at sync and realized_accum may be wrong.",
        "blocking": false
      },
      {
        "text": "Write leg rows at the point leg ids are assigned (createBracket and the resize ACTIVE update), with an emitBracketFailureAlert on failure, and keep only the one-time seed. This replaces the per-tick EnsureLegsTracked sweep over the ever-growing order_brackets and removes the resizeBracket early return, which would have skipped ReArmProtection (trading.go:3615). The synthesis adopts this; the proposer must confirm it and update the bracket-state tests.",
        "blocking": false
      },
      {
        "text": "Synchronous leg emits must not stall pollFills. On the first leg emit failure, stop leg emits for the rest of the tick under a per-tick leg budget, and add a test.",
        "blocking": false
      },
      {
        "text": "A leg the broker no longer returns (an IBKR leg from an earlier session, or an Alpaca not-found) must be retired as terminal UNKNOWN with a WARN and no emit, not polled forever.",
        "blocking": false
      },
      {
        "text": "Each boot replays every post-floor order.filled, one tx per event, through a PgBouncer pool of 2, and consumer_applied_events is never pruned. Name this as a residual with a growth estimate. Any sequence-based resume hint needs a REOPEN petition against R-1 first.",
        "blocking": false
      },
      {
        "text": "O-8 residual: a parked post-floor fill re-parks with an ERROR on every boot and has no named redelivery path. The operator must accept this.",
        "blocking": false
      },
      {
        "text": "O-11: the AC-5 amendment wording is now pinned (partially_filled filled_qty 4, then order.filled qty 10 at leg average 110). Operator sign-off recorded in context.md is still needed.",
        "blocking": false
      },
      {
        "text": "O-13: with retire-without-emit for partially filled baselined legs, reconciliation is not made worse. The existing residual (Alpaca bracket-leg fills never reach trading.orders or NetFilledQtyBySymbol) must still be raised with the operator and recorded.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "294 @AC-56",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "294 @AC-6",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "251 @AC-17",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "290 @AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "206 trading @AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Leg state stored as columns on order_brackets (round-1 synthesis). Lost: resizeBracket blanks the leg ids (trading.go:3612), so old legs would no longer be tracked. Replaced by the trading.bracket_legs table.",
      "A per-tick EnsureLegsTracked INSERT…SELECT sweep. Lost: it scans an ever-growing, unindexed order_brackets every 5 s, and it still misses leg ids whose WARN-only ACTIVE write failed. Replaced by writing rows at leg-id assignment.",
      "A resizeBracket early return when leg tracking fails. Lost: it skips ReArmProtection (trading.go:3615) and the resubmit, leaving the added qty unprotected. That trades an attribution gap for an exposure gap.",
      "Emitting the delta (final minus baseline) for legs baselined while partially filled. Lost: it breaks the reading that order.filled qty is the order total, which 251 @AC-17 relies on (a C-16 change). Retire-without-emit keeps every rule.",
      "Emitting the full cumulative order.filled for legs baselined while partially filled (proposal r2). Lost: it over-reduces positions that sync already set and produces phantom shorts and reconciliation false halts.",
      "The live-path orderSide ledger fallback for side-less fills. Lost: no post-floor producer omits side, so it only adds a ledger round trip and a retry branch to the hot path. Park directly instead.",
      "Re-emitting pending_closed under the incoming event_id. Lost: a producer duplicate carries a fresh uuid, so it gets a fresh ledger key and a double position.closed.",
      "Seed-time terminal marking of CANCELED-bracket legs. Lost: legs of canceled or flattened brackets can still fill (R-4 rationale). Only not-found legs are retired, with a WARN.",
      "SMALLINT enum columns in bracket_legs. Lost: trading persists enums as TEXT names with 0 stored as NULL (trading context-constitution), and UNION and reconcile queries must compare like with like.",
      "An applied key without user_id. Lost: the shared alpaca-default fallback account (portfolio_service.go:435) could alias across users. Adding user_id costs nothing.",
      "Sequence-based boot resume hint. Deferred: it reads as an R-1 variant without a petition. Boot replay cost is named as a residual instead."
    ],
    "open_risks": [
      "If the operator does not reopen D-4, cross-account IBKR leg-id collisions can silently drop exit fills through the global ledger idempotency key.",
      "Cutover: overlap double-apply, fills the old binary never folded being acked below the floor, and late-commit recorded_at before the floor. qty heals at sync; realized_accum and fees_accum may be wrong permanently.",
      "Legs that fill between migration 012 and the first observer tick, or that are partially filled at baseline, are retired without emit. Their realized P&L is lost (qty heals at sync).",
      "A leg id is lost if the bracket ACTIVE plus leg-row write fails. It is now alerted, but its exit fill still never folds.",
      "Boot replays every post-floor order.filled, one tx per event, through a PgBouncer pool of 2, and consumer_applied_events has no retention. Boot cost grows with lifetime fill volume.",
      "A parked post-floor fill re-parks with an ERROR on every boot.",
      "OQ-2 is out of scope: accumulators already inflated are not repaired.",
      "ListOrders coverage: Alpaca limit=500 and the IBKR current-session list can omit legs. The capped GetOrder fallback drains them slowly, and the IBKR netting caveats (ibkr.md) against cumulative filledQuantity are unverified.",
      "Sync and deregistration still rely on positionsMu, so instance_count must stay 1.",
      "Leg fees are copied from the entry path value. BrokerOrder has no fee field (broker.go:24-25), so leg fees are assumed to be 0.",
      "A leg canceled after a partial fill emits order.filled with its partial cumulative qty, which differs from the parent convention."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-10",
      "C-11",
      "C-15",
      "C-16",
      "C-18",
      "F-04",
      "F-06",
      "F-07",
      "P-02",
      "P-03",
      "PLAT-N1"
    ],
    "rationale": "There is no Floor breach. I verified the adversary's three key factual claims in the code:\n- `observed()` counts every error as \"error\" (`portfolio_service.go:231-242`).\n- `errFillAcked` does not exist; only `ErrFillUnattributable` (`:972`) does.\n- The ledger idempotency key is a bare global PK (`002_idempotency_keys.up.sql:10`).\n\nThe proposal's parked/acked mechanism was therefore unimplementable as written. The synthesis specifies the `observed()` branches explicitly and keeps that point open as blocking until the proposer confirms it with tests.\n\nTwo other blocking defects are fixed in the approach but stay open for confirmation:\n- The partial-baseline over-reduce. A phantom short would false-halt reconciliation (206 @AC-1), so the fix is retire-without-emit.\n- The duplicate re-emit using the incoming `event_id`. The fix is to use the stored `event_id`.\n\nThe D-4 key collision is real new evidence: the proposal itself argued that IBKR leg ids are not unique across accounts. But D-4 is settled and only the operator can reopen it. The approach therefore keeps the D-4 key, records the adversary's petition as new, and holds a blocking objection pending the ruling.\n\nNon-blocking adversary points that cost little and remove a safety or performance hazard are adopted:\n- Write leg rows at assignment instead of the sweep, which also drops the resize early return that left qty unprotected.\n- A per-tick emit budget.\n- Not-found legs set terminal.\n- TEXT enums.\n- `user_id` in the applied PK.\n- Parking side-less fills directly.\n\nThe boot-replay resume hint is not adopted; it would need an R-1 petition.\n\nObjections closed this round:\n- O-1: per-leg table.\n- O-2: synchronous keyed append, row advanced only after a nil return. The stall concern is tracked separately.\n- O-4: key with `account_id`, plus `user_id`.\n- O-5: `pending_closed` outbox. The event_id fix is tracked separately.\n- O-6: flip emits closed, then opened.\n- O-7: `ListOrders` plus capped `GetOrder`, with the budget stated.\n- O-9: `signedQty` reused, key as a parameter.\n- O-10: no sequence column.\n- O-12: old leg rows survive the resize blanking.\n\nObjections still open because they need operator sign-off: O-3, O-8 (residual), O-11 and O-13. The AC-5 change remains `covered_by_operator_decision=false`. The OPERATOR STEER reopens nothing, so `reopened` is empty.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Bracket-leg state lives in its own table trading.bracket_legs with PRIMARY KEY (account_id, leg_order_id) and is retired per leg. It is not stored as columns on order_brackets.",
          "evidence": "trading.go:3612 (resizeBracket blanks the order_brackets leg ids); 005_broker_accounts_halted.up.sql:12-21; adversary r2 did not contest"
        },
        {
          "text": "The portfolio applied-event key includes account_id, using the value after the alpaca-default fallback.",
          "evidence": "ibkr.go:343 (broker-numeric leg ids); portfolio_service.go:435; adversary r2 did not contest"
        },
        {
          "text": "The position.closed outbox is a single nullable pending_closed column on the applied row, cleared after a successful emit and re-emitted on a duplicate redelivery.",
          "evidence": "portfolio_service.go:466-467, 1356; adversary r2 contested only the event_id used for the key"
        },
        {
          "text": "A flip through zero emits position.closed for the long, then position.opened for a fresh short row, and the portfolio CLAUDE.md v1 scope-limitation paragraph is rewritten.",
          "evidence": "pnl.go:80-92; adversary r2 did not contest"
        },
        {
          "text": "Leg observation is batched with one Broker.ListOrders per account per tick, with a per-account capped GetOrder fallback for legs missing from the list.",
          "evidence": "broker.go:69,74; alpaca.go:374-413; ibkr.go:448-482; adversary r2 did not contest"
        }
      ],
      "new_rejected": [
        {
          "text": "Early return from resizeBracket when leg tracking fails",
          "why": "It skips ReArmProtection (trading.go:3615) and the resubmit, leaving the added fill qty unprotected. That is worse than the attribution gap it prevents."
        },
        {
          "text": "Emitting the full cumulative order.filled for a leg baselined at cutover with filled_qty > 0",
          "why": "It over-reduces a position that sync already set to broker truth, flips it into a phantom short and false-halts reconciliation (206 trading @AC-1)."
        },
        {
          "text": "Re-emitting pending_closed with a key derived from the incoming event_id",
          "why": "A producer duplicate carries a fresh uuid (trading.go:3848), so the key is fresh and position.closed is emitted twice."
        }
      ],
      "new_objections": [
        {
          "text": "observed() (portfolio_service.go:231-242) maps no sentinel. It must add explicit branches (new errFillAcked: count acked, return nil; ErrFillUnattributable: count parked, ERROR \"event parked\", return nil), prove that no other wrapped consumer returns either sentinel, and add telemetry tests. Otherwise the floor ack hot-loops and stalls the fill consumer.",
          "blocking": true
        },
        {
          "text": "A leg baselined at cutover with filled_qty > 0 must be retired without emit. A cumulative terminal emit over-reduces and false-halts reconciliation.",
          "blocking": true
        },
        {
          "text": "The duplicate-path pending_closed re-emit must key on the stored row's event_id, not the incoming one. A test with two event_ids for one order_id is required.",
          "blocking": true
        },
        {
          "text": "Pending REOPEN D-4: the leg idempotency key must be account-scoped, because ledger.idempotency_keys is a global PK and IBKR leg ids can repeat across accounts. Either the operator rules on the amendment or the spec proves uniqueness.",
          "blocking": true
        },
        {
          "text": "Write bracket_legs rows at leg-id assignment (createBracket and the resize ACTIVE update) in the same tx, with an alert on failure, instead of the per-tick EnsureLegsTracked sweep and the resize early return.",
          "blocking": false
        },
        {
          "text": "Synchronous leg emits need a per-tick budget that stops leg emits after the first failure, so pollFills, IBKR leg submits and the protection watchdog are not starved.",
          "blocking": false
        },
        {
          "text": "Legs the broker no longer returns must be retired as terminal UNKNOWN with a WARN, and not polled forever.",
          "blocking": false
        },
        {
          "text": "Boot replay of every post-floor fill (one tx each, PgBouncer pool of 2, unpruned applied table) must be named as a residual with a growth estimate.",
          "blocking": false
        },
        {
          "text": "The O-3 cutover residual must also name fills the old binary never folded before the first new boot, and late-commit appends whose recorded_at predates the floor. Both are acked and permanently lost from the live fold.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-1",
          "how": "Per-leg trading.bracket_legs table keyed (account_id, leg_order_id). Legs are retired only on broker-terminal status or not-found, with FAILED and CANCELED brackets still observed."
        },
        {
          "id": "O-2",
          "how": "Synchronous appendLedgerEvent with the key parameter, row advanced only after a nil return, and a ledger-down retry test in the build order. The stall concern is tracked as a new objection."
        },
        {
          "id": "O-4",
          "how": "The applied PK is (consumer, user_id, account_id, order_id). The producer duplicate paths are enumerated (trading.go:1861, 1877-1879, 1896)."
        },
        {
          "id": "O-5",
          "how": "pending_closed outbox column, cleared on emit success and re-emitted on a duplicate. The stored event_id requirement is tracked as a new objection."
        },
        {
          "id": "O-6",
          "how": "Closed for the long, then opened for a fresh short row. The CLAUDE.md paragraph is rewritten."
        },
        {
          "id": "O-7",
          "how": "One ListOrders per account plus a capped GetOrder fallback, with the per-tick budget stated."
        },
        {
          "id": "O-9",
          "how": "signedQty (portfolio_service.go:1065) reused; appendLedgerEvent and emitEventAs gain a key parameter where empty means a uuid."
        },
        {
          "id": "O-10",
          "how": "No sequence column on consumer_applied_events."
        },
        {
          "id": "O-12",
          "how": "Old leg rows persist in bracket_legs after resizeBracket blanks the order_brackets columns (trading.go:3612) and stay observable until terminal, so no synchronous fetch is needed."
        }
      ],
      "reopen_petitions": [
        {
          "target": "D-4",
          "evidence": "ledger.idempotency_keys.idempotency_key is a bare global PRIMARY KEY (services/xstockstrat-ledger/migrations/002_idempotency_keys.up.sql:10). IBKR leg ids are broker-numeric and may repeat across accounts (ibkr.go:343, first argued in proposal r2). Requested amendment: bracket-leg:<account_id>:<legID>:<status>:<filledQty>. Filed by the adversary in r2.",
          "is_new": true
        }
      ],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-13 — sdd-batch design gate (round 3)

- `/sdd-design fix-position-fold-correctness` (full) halted at its approval gate after round 3 (gate policy: halt). design.md NOT written; status.md unchanged (spec-ready). Register: `debate.md` (D-1..D-16, R-1..R-13, O-1..O-32, P-1..P-2). Round 3 closed O-14, O-15, O-16, O-18, O-19, O-22.

## Open Threads

- **Approach (round-3 synthesis).** Keeps D-1..D-11 and honours R-1..R-8; the adversary's r3 blocking claims were verified in code and folded in. Portfolio: migration `019_fill_applied_events` (`consumer_applied_events` PK `consumer, user_id, account_id, order_id` with `event_id` + `pending_closed`, no sequence; `consumer_floors` stamped by the new binary on first boot from portfolio's own clock). `observed()` gains `errFillAcked` (count acked, nil) and `ErrFillUnattributable` (ERROR "event parked", count parked, nil) branches (D-12). `processOrderFill`: below-floor → `errFillAcked`; sign with `signedQty`; `repo.ApplyFill` starts with `INSERT … ON CONFLICT DO NOTHING RETURNING`. A duplicate takes no lock, re-emits a non-NULL `pending_closed` under `position.closed:<STORED event_id>` (D-13), and returns `errFillAcked` before `positionsMu`, `checkRiskLimits`, `broadcastSnapshot`, snapshot insert, `position.*` emits and risk alerts (R-9). A fresh fill takes `positionsMu` → advisory xact lock → `SELECT … FOR UPDATE` → `pnl.FoldFrom` → upsert/delete; post-commit emits go through `emitEventAs` (now returns an error, key parameter) and clear `pending_closed` only on success; risk/snapshot run for applied fills only. Flip per D-10. AC-2 proof: real-PG two-writer test `services/xstockstrat-portfolio/internal/repository/apply_fill_realpg_test.go` (two simple-protocol pools), PG provisioned in the portfolio Go CI job per `ci.yml:510-512` with `PORTFOLIO_PG_TEST_URL`. Trading: migration `012_bracket_legs` (seed writes `filled_qty` NULL; new `not_found_ticks`); `BracketRepository.ActivateBracket` replaces the three ACTIVE writes in one tx with `emitBracketFailureAlert` on failure (D-14), writing `filled_qty = 0` and skipping empty leg ids; `KnownBrokerOrderIDs` UNIONs `bracket_legs.leg_order_id`; new `broker.ErrOrderNotFound` (Alpaca 404; IBKR `GetOrder` id-matched, a miss wraps it — also fixes the parent `pollFills` path, logged in trading findings); `pollBracketLegFills` runs after `logTick` and never feeds parent counts; one `ListOrders` per account plus capped `GetOrder`; UNKNOWN only after 3 consecutive not-found ticks; unrecognised statuses stay open; unbaselined legs with fill > 0 retire `BASELINE_RETIRED` without emit (R-12 rejects baseline-offset); leg payloads carry `fees = brokerOrder.Fees` (D-16); synchronous keyed `appendLedgerEvent`, row advanced only on nil, first failure stops leg emits for the tick (D-15). Leg key stays D-4 pending the operator.
- **Strongest open objection.** O-17 / P-1 plus new P-2 against D-4: the leg key `bracket-leg:<legID>:<status>:<filledQty>` is not account-scoped while `ledger.idempotency_keys` is a global PK and IBKR leg ids may repeat across accounts; P-2 adds that GetPnL's `filledOrderIDs` / partials map is keyed on the bare order id (`portfolio_service.go:990-1013`), so account-scoping the ledger key alone does not fully isolate GetPnL. Only the operator can reopen D-4. Other blocking objections awaiting proposer confirmation with tests: O-23 (duplicate/below-floor return before every side effect, zero snapshot/risk calls test), O-24 (`ErrOrderNotFound` + 3-tick threshold), O-25 (IBKR `GetOrder` id-match), O-26 (`filled_qty = 0` at activation, leg-FILLED-on-first-observation test), O-27 (named real-PG AC-2 test + CI PG, or a downgrade with a named actor).
- **Floor status.** No Floor breach.
- **Uncovered @AC changes.** `@AC-5` CHANGE (`order.partially_filled` filled_qty 4, then `order.filled` qty 10 at leg average 110) is still not covered by an operator decision (O-11). All other rules (@AC-1..@AC-4, 294 @AC-56, 294 @AC-6, 251 @AC-17, 251 @AC-14, 290 @AC-3, 206 trading @AC-1) PRESERVE.
- **Operator sign-offs still needed.** P-1 and P-2 rulings on D-4; O-3 cutover residual (overlap double-apply, unfolded pre-boot fills, late-commit `recorded_at` before the floor, ledger/portfolio clock skew; stop-then-start first deploy as a numbered runbook step with a recorded result); O-8 parked re-park every boot; O-11 AC-5 wording; O-13 Alpaca leg fills absent from `trading.orders` / `NetFilledQtyBySymbol`.

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "Round-3 synthesis. It keeps D-1..D-11, honours R-1..R-8, and takes the proposer's r3 structure. I verified the adversary's r3 blocking claims in the code and folded in fixes for each one.\n\nClaims checked against the code:\n- **Side effects run on every fill, duplicates included.** `processOrderFill` calls `checkRiskLimits` and `broadcastSnapshot` after `positionsMu.Unlock` (`services/xstockstrat-portfolio/internal/service/portfolio_service.go:482-485`).\n- **IBKR `GetOrder` returns the first order without matching the id.** It returns `result.Orders[0]` with no id check (`services/xstockstrat-trading/internal/broker/ibkr.go:441-442`). Any non-200 or empty response is a generic error (`:426-439`).\n- **Alpaca `GetOrder` gives a generic error for any non-200** (`alpaca.go:343-344`).\n- **The broker package has one sentinel only,** `ErrOrderNotCancelable` (`broker.go:18`).\n- **`BrokerOrder.Fees` exists** (`broker.go:26-27`). The proposer's leg-fee citation was wrong.\n- **`KnownBrokerOrderIDs` does not include bracket legs.** Its UNION covers only `trading.orders` and `order_brackets` (`trading_repo.go:135-150`).\n- **`pollFills` calls `logTick` at `trading.go:1831`.**\n- **The real CI Postgres precedent is `.github/workflows/ci.yml:510-512`** (the analysis `real_pg` install). The adversary's `:436-438` citation is the Python ruff step.\n- **`observed()` wraps exactly three consumers.** They are order fill (`:177`), bracket update (`:1693`) and balance sync (`:1741`). The last two go through `ackAlways`, which always returns nil (`:185-190`).\n\nPORTFOLIO (the `order.filled` consumer only; 290 @AC-3)\n\n(1) Migration `019_fill_applied_events`, as in r3.\n- `consumer_applied_events` with PK `(consumer, user_id, account_id, order_id)`, plus `event_id`, `pending_closed` and no sequence column.\n- `consumer_floors`, stamped by the new binary on first boot (R-2).\n- Floor clock: portfolio stamps the floor from its own clock. The skew between the ledger's Node clock (`ledgerServiceImpl.ts:74,95`) and portfolio is added to cutover residual (b). There is no ledger round trip at boot.\n\n(2) `observed()` (`:231-242`) gains two `errors.Is` branches before the generic error branch:\n- `errFillAcked` (new, unexported): `sig.handled(ctx, \"acked\", …)`, return nil.\n- `ErrFillUnattributable`: the same ERROR `\"event parked\"` fields as `boundedRetry` `:1532-1533`, then `sig.count(\"parked\")`, return nil.\n- Telemetry tests extend the `portfolio_telemetry_test.go:578` table with acked, parked and a plain error that is still returned.\n\n(3) `processOrderFill`, in order:\n1. Parse the payload.\n2. If `recorded_at < floor`, return `errFillAcked`.\n3. Sign with `signedQty` (`:1065`). If side is missing, return `ErrFillUnattributable`.\n4. Call `repo.ApplyFill` (one tx). It starts with `INSERT applied … ON CONFLICT DO NOTHING RETURNING`.\n   - **Duplicate path (new this round).** On conflict, SELECT the stored `event_id` and `pending_closed`, then COMMIT. No advisory lock and no FOR UPDATE.\n     - The duplicate check is a single atomic statement, so it does not need `positionsMu`. That lets the duplicate path skip the mutex entirely.\n     - Back in the service: if `pending_closed` is non-NULL, re-emit it with key `position.closed:<STORED event_id>` and clear it on success. Then return `errFillAcked`.\n     - The duplicate path returns before taking `positionsMu` and before `checkRiskLimits`, `broadcastSnapshot`, any `position.*` emit, snapshot insert or risk alert.\n     - Duplicates therefore count as `outcome=acked`, so `ok` keeps meaning \"applied\" (294 @AC-56 holds).\n   - **Fresh path.** Take `positionsMu` (D-5) before `ApplyFill`'s lock section. Then `pg_advisory_xact_lock(hashtextextended(user|symbol|mode|account,0))`, `SELECT … FOR UPDATE`, the `pnl.FoldFrom` callback, the upsert or delete (`portfolio_repo.go:61-69`), and `pending_closed` bound as a string. COMMIT.\n   - Implementation note: run the INSERT under the mutex for the fresh path, or do the INSERT, release, and re-acquire the mutex only when the row is fresh. The spec picks one form; both satisfy the rule that a duplicate takes no lock.\n5. After commit, emit through `emitEventAs`, which now **returns an error** and takes a key parameter where empty means a uuid. The key is `<type>:<stored event_id>`. `emitEvent` stays as the fail-soft wrapper, so the other callers are unchanged. Clear `pending_closed` only on a nil return.\n6. Unlock, then run `checkRiskLimits` and `broadcastSnapshot`. This happens for applied fills only.\n\nFlip handling follows D-10. `computeNewPosition` (`portfolio_helpers_test.go:23-36`) is retired.\n\n(4) AC-2 real-Postgres harness (new).\n- Test: `services/xstockstrat-portfolio/internal/repository/apply_fill_realpg_test.go`. Two `pgxpool`s, each standing in for a portfolio instance, both in `DB_PGBOUNCER` simple-protocol exec mode, run against a real PG. Cases:\n  - same `order_id` delivered to both writers: applied exactly once;\n  - two different fills on the same position: both applied, serialized;\n  - a duplicate with `pending_closed` set: re-emitted once.\n- The test skips when `PORTFOLIO_PG_TEST_URL` is unset locally. The portfolio Go CI job installs PG and sets that variable, following the `ci.yml:510-512` precedent, so in CI the test always runs.\n\nTRADING (`pollFills` callee; D-3; 294 @AC-6)\n\n(5) Migration `012_bracket_legs`, per D-7, with TEXT enums and a partial index on open legs.\n- The one-time seed writes `filled_qty` NULL (not baselined).\n- New column `not_found_ticks SMALLINT NOT NULL DEFAULT 0`.\n\n(6) `BracketRepository.ActivateBracket(ctx, id, legs)` replaces all three ACTIVE writes (`trading.go:3571`, `3588`, `3630`).\n- One tx: `UPDATE order_brackets … ACTIVE` plus `INSERT bracket_legs … ON CONFLICT DO NOTHING`.\n- Rows written here carry `filled_qty = 0` (baselined) (new). Only the 012 seed writes NULL.\n- Empty leg ids are skipped. `TakeProfitLegOrderID` is `\"\"` when `risk.take_profit_rr_multiple = 0`.\n- On failure, call `emitBracketFailureAlert`. `resizeBracket` control flow is otherwise unchanged (R-6).\n\n(7) `KnownBrokerOrderIDs` (`trading_repo.go:135-150`) gains `UNION SELECT leg_order_id FROM trading.bracket_legs WHERE account_id=$1 AND leg_order_id = ANY($2)`. A canceled old IBKR leg that `resizeBracket` blanked (`:3612`) then cannot false-halt reconciliation (206 trading @AC-1; fails.md `:2547-2550`).\n\n(8) Broker preconditions for D-11. These are fixes, not a reopen.\n- New `broker.ErrOrderNotFound` in `broker.go`.\n- Alpaca `GetOrder`: an HTTP 404 wraps it.\n- IBKR `GetOrder`:\n  - Select the entry whose `OrderID == brokerOrderID`. A miss, or an empty list, wraps `ErrOrderNotFound`.\n  - This one change also fixes the parent `pollFills` path (`trading.go:1822`). A miss there now becomes a failed poll that is retried, instead of adopting another order's status.\n  - Log the latent parent defect in trading `context-constitution-findings.md`.\n- Every other error (5xx, timeout, IBKR session blip) keeps the leg open and leaves `not_found_ticks` unchanged.\n\n(9) `pollBracketLegFills` is called after `logTick` (`trading.go:1831`). Its outcomes never feed the parent `polled`/`failed` counts.\n- One `ListOrders` per account, and only for accounts with at least one open leg. A capped `GetOrder` fallback covers legs missing from the list.\n- Absence from `ListOrders` alone never counts as not-found, because Alpaca lists only the newest 500 (`alpaca.go:374-376`).\n- `GetOrder` returning `ErrOrderNotFound` increments `not_found_ticks`. At a code constant of 3 consecutive ticks the leg goes terminal `UNKNOWN` with a WARN naming it. Any successful read resets the counter.\n- Unrecognised or non-terminal statuses (for example Alpaca `held`) stay open, by the same rule as the parent path (`trading.go:1853-1858`).\n- Per-leg rules:\n  - Not baselined, cumulative 0: store 0.\n  - Not baselined, cumulative > 0: terminal `BASELINE_RETIRED`, no emit, INFO count (R-7).\n  - Baselined, cumulative rising while open: `order.partially_filled` with the cumulative qty.\n  - Baselined and terminal (FILLED, or CANCELED/EXPIRED with qty > 0): `order.filled` with qty = final cumulative, price = `FilledAvgPrice` and `fees = brokerOrder.Fees`, at parity with the parent (`trading.go:1891`).\n- Delivery: a synchronous `appendLedgerEvent` with a key parameter (R-3, R-5). The row advances only after a nil return. On the first emit failure, leg emits stop for the rest of the tick.\n\n(10) The leg key stays as D-4 until the operator rules on P-1 and the new petition below.\n\nBUILD ORDER\n1. Migrations.\n2. `observed()` branches, the `ApplyFill` duplicate path and telemetry tests.\n3. Fold rewrite and flip handling. Duplicate tests:\n   - two `event_id`s for one `order_id`;\n   - the duplicate fires no snapshot or risk call (a mock asserts zero calls).\n4. Real-PG AC-2 tests and the CI PG step.\n5. Broker `ErrOrderNotFound`, IBKR id-match and their tests.\n6. `ActivateBracket`, the `KnownBrokerOrderIDs` UNION, keyed append and the observer. Tests:\n   - AC-4 and AC-5 on Alpaca and IBKR;\n   - leg already FILLED on its first observation;\n   - ledger down, then retry with the same key;\n   - first-failure tick budget;\n   - sibling leg; canceled bracket; resize keeping old legs;\n   - seeded leg with 0 fill;\n   - seeded leg partially filled, retired with no emit;\n   - 5xx keeps the leg open; three not-found ticks retire it as UNKNOWN;\n   - empty take-profit id; `held` status;\n   - a canceled resize leg is known to reconcile.\n7. Docs, the C-16 promotion, residuals recorded in `context.md`, and the stop-then-start first deploy as a numbered runbook step with a recorded result (fails.md `:3305-3307`).",
    "open_objections": [
      {
        "text": "O-17 / P-1 (and the new petition): the D-4 leg key bracket-leg:<legID>:<status>:<filledQty> is not account-scoped. ledger.idempotency_keys is a global primary key (002_idempotency_keys.up.sql:10), and IBKR leg ids may repeat across accounts (ibkr.go:343-345). This stays blocking until the operator rules: reopen D-4 and amend the key to bracket-leg:<account_id>:<legID>:<status>:<filledQty>, or decline it and record the named residual.",
        "blocking": true
      },
      {
        "text": "The duplicate and below-floor paths must return errFillAcked before positionsMu and before checkRiskLimits, broadcastSnapshot, the snapshot insert, any position.* emit and any risk alert. Today these run after every handled fill (portfolio_service.go:482-485, 1213-1246, 1279-1335). A duplicate's only side effect is the pending_closed re-emit. Duplicates count as acked. The synthesis adopts this; the proposer must confirm it and add a test asserting zero snapshot and risk calls on a duplicate.",
        "blocking": true
      },
      {
        "text": "Not-found classification: add broker.ErrOrderNotFound (Alpaca HTTP 404; IBKR id absent from the response). Retire a leg as UNKNOWN only after 3 consecutive not-found ticks (not_found_ticks column). Every other GetOrder error keeps the leg open, and absence from ListOrders alone never counts. Without this, a broker 5xx or IBKR session blip retires open legs and loses their exit fills (alpaca.go:343-344; ibkr.go:426-441; broker.go:18). The synthesis adopts this; the proposer must confirm it and add the 5xx-stays-open and 3-tick tests.",
        "blocking": true
      },
      {
        "text": "IBKR GetOrder returns result.Orders[0] without matching the requested id (ibkr.go:441-442). It must select the entry whose OrderID == brokerOrderID and treat a miss as ErrOrderNotFound before D-11's GetOrder fallback is safe. Otherwise a synchronous, deterministically keyed leg emit writes another order's fill to the ledger permanently. This also fixes the parent pollFills path (trading.go:1822); log that path's latent defect in the trading findings.",
        "blocking": true
      },
      {
        "text": "Rows written by ActivateBracket must carry filled_qty = 0 (baselined); only the 012 seed writes NULL. Otherwise a leg that fills before the first 5 s tick (a gap-through stop, or a take-profit that is marketable on arrival) is retired as BASELINE_RETIRED with no emit, and AC-4 fails silently. A test with a leg already FILLED on its first observation is required.",
        "blocking": true
      },
      {
        "text": "The AC-2 two-writer proof needs a named real-Postgres test and CI provisioning. pgxmock cannot prove it, and the portfolio Go job has no Postgres. Proposed test: services/xstockstrat-portfolio/internal/repository/apply_fill_realpg_test.go, with two pools in simple-protocol mode. The portfolio Go CI job installs PG following ci.yml:510-512 and sets PORTFOLIO_PG_TEST_URL so the test always runs in CI. The proposer must confirm this, or agree a downgrade with a named actor at this gate.",
        "blocking": true
      },
      {
        "text": "O-3: the cutover residual (overlap double-apply, unfolded pre-boot fills, late-commit recorded_at before the floor, plus the clock skew between ledger and portfolio) still needs operator sign-off. The stop-then-start first deploy must be a numbered runbook step with a recorded result, not just a bullet.",
        "blocking": false
      },
      {
        "text": "O-8: a parked post-floor fill re-parks with an ERROR on every boot and has no redelivery path. Operator acceptance is still needed.",
        "blocking": false
      },
      {
        "text": "O-11: the AC-5 amendment wording (partially_filled filled_qty 4, then order.filled qty 10 at the leg average 110) needs operator sign-off recorded in context.md.",
        "blocking": false
      },
      {
        "text": "O-13: the existing residual, Alpaca bracket-leg fills never reaching trading.orders or NetFilledQtyBySymbol, must be raised with the operator and recorded.",
        "blocking": false
      },
      {
        "text": "O-20: retiring legs the broker no longer returns is now specified through ErrOrderNotFound and a 3-tick threshold (see the blocking objection above). It stays open until the proposer confirms it.",
        "blocking": false
      },
      {
        "text": "O-21: the boot-replay residual must be restated on the side-effect-free duplicate path. That is about 2-3 round trips per post-floor fill, with no snapshot, risk, quote or ledger calls, counted acked. Give a growth estimate; the rolling-floor follow-up is named, not scoped here.",
        "blocking": false
      },
      {
        "text": "Add bracket_legs.leg_order_id to the KnownBrokerOrderIDs UNION (trading_repo.go:135-150). A canceled old IBKR leg blanked by resizeBracket (trading.go:3612) otherwise false-halts reconciliation (206 trading @AC-1; fails.md 2026-10-05). Adopted in the synthesis; needs confirmation and a test.",
        "blocking": false
      },
      {
        "text": "Leg payloads must carry fees = brokerOrder.Fees, at parity with the parent (broker.go:26-27; trading.go:1891). The residual is restated: neither adapter populates Fees yet (alpaca.go:359,411-414; ibkr.go:443,478-480), which affects parents and legs alike.",
        "blocking": false
      },
      {
        "text": "ActivateBracket must skip empty leg ids (take-profit with risk.take_profit_rr_multiple=0). Alpaca held and other unrecognised leg statuses stay non-terminal (trading.go:1853-1858).",
        "blocking": false
      },
      {
        "text": "Analysis is an unlisted consumer of order.filled, order.partially_filled and portfolio.position.closed (pnl_pattern_consumer.py:48-49,388-402). Add services/xstockstrat-analysis/acceptance/* to recon's rule scan, list the affected analysis ACs, and name the D-10 flip residual: the short opened by a flip gets no order event, so analysis never opens its window.",
        "blocking": false
      },
      {
        "text": "emitEventAs must return an error so that pending_closed is cleared only on success. emitEvent stays the fail-soft wrapper for the other callers.",
        "blocking": false
      },
      {
        "text": "pollBracketLegFills runs after logTick (trading.go:1831), and its outcomes never feed the parent polled/failed counts. The spec must state this so 294 @AC-6 tick semantics hold.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "294 @AC-56",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "294 @AC-6",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "251 @AC-17",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "251 @AC-14",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "290 @AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "206 trading @AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Running checkRiskLimits, broadcastSnapshot and the position.* emits on duplicate redeliveries (proposal r3, step 8). Lost: on every boot, every post-floor fill re-runs a snapshot insert, a portfolio.snapshot ledger append, quote fetches of up to 4 s and possibly a user-facing risk alert (portfolio_service.go:482-485, 1213-1246, 1279-1335). The duplicate path now returns errFillAcked before all of these.",
      "Retiring a leg as UNKNOWN on any GetOrder error, or on absence from ListOrders. Lost: no broker sentinel distinguishes not-found from 5xx, timeout or an IBKR session blip (broker.go:18; alpaca.go:343-344; ibkr.go:426-441), and Alpaca ListOrders returns only the newest 500 (alpaca.go:374-376). Open legs would be retired and their exit fills lost.",
      "Trusting IBKR GetOrder's first returned order for the leg fallback. Lost: it does not match the id (ibkr.go:441-442), so a keyed synchronous emit could write another order's fill to the ledger permanently.",
      "Baseline-offset emission for legs that were partially filled at cutover (adversary r3): emit order.filled for cumulative minus baseline, with a recomputed delta average price. Lost: an order.filled whose qty is not the order total breaks 251 @AC-17's reading of order.filled qty as the order total, and GetPnL's per-order partial dedup (portfolio_service.go:990-1013) would mix the pre-cutover partial cumulative with a delta fill under one order id. The affected set is a bounded, one-time cutover population, so BASELINE_RETIRED with a named residual is kept.",
      "Writing ActivateBracket leg rows with filled_qty NULL, like the seed. Lost: a leg that fills before the first tick would be BASELINE_RETIRED with no emit, so AC-4 fails silently.",
      "Feeding leg-poll outcomes into the parent pollFills polled/failed counts. Lost: a ledger-down leg tick would suppress the fill-poller tick record (trading.go:1831,1836-1848; 294 @AC-6).",
      "Emitting leg fees as 0 because BrokerOrder has no fee field (proposal r3). Lost: the citation is false. BrokerOrder.Fees exists (broker.go:26-27), and the parent already emits it (trading.go:1891)."
    ],
    "open_risks": [
      "If the operator does not reopen D-4, cross-account IBKR leg-id collisions can silently drop exit fills through the global ledger idempotency key. Even with an account-scoped ledger key, GetPnL's filledOrderIDs is keyed on the bare order id (portfolio_service.go:990-1013), so a same-user collision across two IBKR accounts still suppresses the other account's partials.",
      "Cutover: an overlap fill double-applied once; fills the old binary never folded, acked below the floor; late-commit recorded_at before the floor; and clock skew between the ledger and portfolio. qty heals at sync, but realized_accum and fees_accum may stay wrong permanently.",
      "Legs that were partially filled at cutover are BASELINE_RETIRED. Their post-cutover remainder fills never reach GetPnL or the live fold (qty heals at sync; realized P&L for that remainder is lost).",
      "It is unverified whether the IBKR /iserver/account/orders?orderId= endpoint honours orderId at all. If it does not, the id-matched GetOrder misses for legs outside the first result, so those legs resolve only through ListOrders, or retire as UNKNOWN after 3 not-found ticks and lose their fills.",
      "IBKR cumulative filledQuantity netting for legs is unverified (services/xstockstrat-trading/docs/ibkr.md not read).",
      "Boot replay still re-walks every post-floor fill, at about 2-3 round trips each over a PgBouncer pool of 2, and consumer_applied_events has no retention. The cost grows with lifetime fill volume until a rolling-floor follow-up lands.",
      "A parked post-floor fill re-parks with an ERROR on every boot.",
      "A leg id is lost from tracking if the ActivateBracket tx fails. That case is alerted, but its exit fill never folds.",
      "Neither broker adapter populates BrokerOrder.Fees yet, so parent and leg fee totals both understate the 029 fee contract.",
      "A leg canceled after a partial fill emits order.filled with its partial cumulative qty, unlike the parent convention.",
      "The analysis pnl_pattern_consumer is affected (windows that never sealed start sealing, and leg events add snapshots), and the D-10 flip short never opens an analysis window. Its acceptance rules have not yet been scanned.",
      "OQ-2 (repair of already-inflated accumulators) is out of scope.",
      "Sync and deregistration still rely on positionsMu, so instance_count must stay 1."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-08",
      "C-10",
      "C-11",
      "C-15",
      "C-16",
      "C-18",
      "F-04",
      "F-06",
      "F-07",
      "P-02",
      "P-03",
      "PLAT-N1"
    ],
    "rationale": "There is no Floor breach.\n\nI verified each adversary r3 blocking claim in the code:\n- `checkRiskLimits` and `broadcastSnapshot` run after every handled fill (`portfolio_service.go:482-485`).\n- IBKR `GetOrder` returns `Orders[0]` unmatched (`ibkr.go:441-442`).\n- Alpaca and IBKR `GetOrder` both return generic errors for any non-200 (`alpaca.go:343-344`; `ibkr.go:426-439`).\n- `broker.go` has only `ErrOrderNotCancelable`.\n- `KnownBrokerOrderIDs` omits any legs table (`trading_repo.go:135-150`).\n- `BrokerOrder.Fees` exists (`broker.go:26-27`), so the proposer's fee residual was false.\nOne adversary citation was off: the CI Postgres precedent is `ci.yml:510-512`, not `:436-438`. The synthesis cites the correct line.\n\nEvery blocking fix is cheap and does not reopen any D-n:\n- the duplicate path returns early, before every side effect;\n- `ErrOrderNotFound` plus a 3-tick threshold;\n- an IBKR id-match, which is a precondition for D-11, not a change to it;\n- `filled_qty = 0` for rows written at activation;\n- a named real-PG AC-2 test with CI provisioning.\nFollowing the round-2 pattern, these stay open until the proposer confirms them with tests.\n\nObjections closed this round, each answered concretely by the proposal:\n- **O-14:** explicit `observed()` branches. The proof that no other consumer can return either sentinel is verified: the wrapped set is {order fill `:177`, bracket update `:1693` via `ackAlways`, balance sync `:1741` via `ackAlways`}, and `ackAlways` returns nil at `:185-190`.\n- **O-15:** `BASELINE_RETIRED` confirmed with a test. The adversary's baseline-offset alternative loses on 251 @AC-17 and on GetPnL's per-order dedup; it is a different option from R-7, but still loses.\n- **O-16:** stored-`event_id` key, with a two-`event_id` test.\n- **O-18:** `ActivateBracket` at all three ACTIVE sites.\n- **O-19:** the per-tick budget.\n- **O-22:** residuals (b) and (c) are named; floor-clock skew is folded into (b).\n\nObjections still open:\n- **O-20:** the proposal's answer could not be implemented without a not-found sentinel.\n- **O-21:** its cost estimate rested on the side-effecting duplicate path.\n\nD-4 stays as settled. The adversary brought new evidence beyond P-1: GetPnL's `filledOrderIDs` is keyed on the bare order id (`portfolio_service.go:990-1013`), and I verified it. I record it as a new petition, and it also shows that account-scoping the ledger key alone does not fully isolate GetPnL. Only the operator can reopen D-4.\n\nAC-5 remains a CHANGE with `covered_by_operator_decision = false`, because no operator decision is recorded. The steer reopens nothing.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "observed() handles the fill consumer's sentinels in place. errFillAcked counts \"acked\" and returns nil. ErrFillUnattributable logs ERROR \"event parked\" with the boundedRetry fields, counts \"parked\" and returns nil. Every other error is unchanged.",
          "evidence": "portfolio_service.go:177,185-190,231-242,1532-1534,1693,1741 (the wrapped set is fill plus two ackAlways consumers that never error); adversary r3 did not contest"
        },
        {
          "text": "The duplicate-path pending_closed re-emit uses the ledger key position.closed:<STORED event_id>, never the incoming event_id.",
          "evidence": "trading.go:3848 (a producer duplicate carries a fresh uuid); R-8; adversary r3 did not contest"
        },
        {
          "text": "BracketRepository.ActivateBracket replaces all three ACTIVE bracket writes (Alpaca, IBKR, resize). In one tx it updates order_brackets and inserts the bracket_legs rows, and on failure emitBracketFailureAlert fires.",
          "evidence": "trading.go:3571,3588,3630; adversary r3 contested only the baseline value written"
        },
        {
          "text": "On the first leg-emit failure in a tick, leg emits stop for the rest of that tick.",
          "evidence": "trading.go:3823,3826 (bound = appendMaxAttempts x ledgerEmitTimeout); adversary r3 did not contest"
        },
        {
          "text": "Leg order.filled and order.partially_filled payloads carry fees = brokerOrder.Fees, at parity with the parent fill path.",
          "evidence": "broker.go:26-27; trading.go:1891; raised by adversary r3, and contradicts no settled decision"
        }
      ],
      "new_rejected": [
        {
          "text": "Running checkRiskLimits, broadcastSnapshot or position.* emits on a duplicate or below-floor order.filled redelivery",
          "why": "Every boot would re-run a snapshot insert, a portfolio.snapshot ledger append, quote fetches and possibly user-facing risk alerts for each post-floor fill (portfolio_service.go:482-485,1213-1246,1279-1335)."
        },
        {
          "text": "Retiring a leg as terminal on any GetOrder error, or on absence from ListOrders",
          "why": "No broker sentinel separates not-found from 5xx, timeout or an IBKR session blip (broker.go:18; alpaca.go:343-344; ibkr.go:426-441), and Alpaca ListOrders returns only the newest 500 (alpaca.go:374-376), so open legs' exit fills would be lost."
        },
        {
          "text": "Using IBKR GetOrder's first returned order without matching the requested id for the leg fallback",
          "why": "ibkr.go:441-442 returns Orders[0] unmatched, so a keyed synchronous emit could permanently write another order's fill to the ledger."
        },
        {
          "text": "Baseline-offset emission (cumulative minus baseline, with a recomputed average) for legs partially filled at cutover",
          "why": "An order.filled whose qty is not the order total breaks 251 @AC-17's order-total reading, and it mixes with the pre-cutover partial under one order id in GetPnL's per-order dedup (portfolio_service.go:990-1013). The affected set is a bounded one-time cutover population."
        },
        {
          "text": "Writing filled_qty NULL on legs inserted at activation",
          "why": "A leg that fills before the first tick would be BASELINE_RETIRED with no emit, so AC-4 fails silently."
        }
      ],
      "new_objections": [
        {
          "text": "The duplicate and below-floor paths must return errFillAcked before positionsMu and before every side effect (checkRiskLimits, broadcastSnapshot, the snapshot insert, position.* emits, risk alerts), with duplicates counted acked. A test must assert zero snapshot and risk calls on a duplicate.",
          "blocking": true
        },
        {
          "text": "Add broker.ErrOrderNotFound (Alpaca 404; IBKR id absent from the response). Retire as UNKNOWN only after 3 consecutive not-found ticks. Every other error keeps the leg open, and absence from ListOrders never counts as not-found.",
          "blocking": true
        },
        {
          "text": "IBKR GetOrder must match OrderID == brokerOrderID and treat a miss as ErrOrderNotFound (ibkr.go:441-442). This is a precondition for D-11's GetOrder fallback. Log the latent parent pollFills defect (trading.go:1822) in the findings.",
          "blocking": true
        },
        {
          "text": "Rows written by ActivateBracket must carry filled_qty = 0 (baselined), with a test for a leg already FILLED on its first observation.",
          "blocking": true
        },
        {
          "text": "Name the AC-2 real-Postgres two-writer test and provision PG in the portfolio Go CI job (precedent ci.yml:510-512), or agree a downgrade with a named actor at this gate.",
          "blocking": true
        },
        {
          "text": "Add bracket_legs.leg_order_id to the KnownBrokerOrderIDs UNION (trading_repo.go:135-150), so that canceled legs blanked by resizeBracket do not false-halt reconciliation.",
          "blocking": false
        },
        {
          "text": "ActivateBracket skips empty leg ids. Alpaca held and other unrecognised leg statuses stay non-terminal.",
          "blocking": false
        },
        {
          "text": "Add services/xstockstrat-analysis/acceptance/* to the recon rule scan for the pnl_pattern_consumer, and name the D-10 flip-short window residual.",
          "blocking": false
        },
        {
          "text": "emitEventAs returns an error so that pending_closed is cleared only on success. emitEvent stays the fail-soft wrapper.",
          "blocking": false
        },
        {
          "text": "pollBracketLegFills runs after logTick (trading.go:1831), and its outcomes never feed the parent polled/failed counts.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-14",
          "how": "Explicit errFillAcked and ErrFillUnattributable branches in observed(). Verified proof: the observed-wrapped set is {order fill :177, bracket update :1693, balance sync :1741}, and the last two are ackAlways, which returns nil (:185-190). Telemetry table tests are added at portfolio_telemetry_test.go:578."
        },
        {
          "id": "O-15",
          "how": "BASELINE_RETIRED (retire without emit) confirmed, with a test for a seeded, partially filled leg. The baseline-offset alternative was rejected this round."
        },
        {
          "id": "O-16",
          "how": "The re-emit key is position.closed:<STORED event_id>, with a test of two distinct event_ids for one order_id where position.closed is appended once."
        },
        {
          "id": "O-18",
          "how": "ActivateBracket at all three ACTIVE sites (trading.go:3571,3588,3630) in one tx with emitBracketFailureAlert. The sweep and the early return are dropped. The baseline value is tracked as a new objection."
        },
        {
          "id": "O-19",
          "how": "Leg emits stop for the rest of the tick after the first failure, with a test."
        },
        {
          "id": "O-22",
          "how": "Residuals (b) fills never folded before the first new boot and (c) late-commit recorded_at before the floor are named in Assumptions. Ledger/portfolio clock skew is folded into (b)."
        }
      ],
      "reopen_petitions": [
        {
          "target": "D-4",
          "evidence": "GetPnL builds filledOrderIDs and the per-order partials map keyed on the bare order id, with no account scope (services/xstockstrat-portfolio/internal/service/portfolio_service.go:990-1013, verified). A same-user IBKR leg-id collision across two accounts therefore also suppresses the other account's partials at query time. The collision is not only a dropped ledger append. Filed by the adversary in r3, who also corrected the proposer's 251 @AC-14 mechanism (:1030-1041 rejects only mixed empty/non-empty account groups).",
          "is_new": true
        }
      ],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-20 — sdd-batch design gate (round 4)

- `/sdd-design fix-position-fold-correctness` (full) halted at its approval gate after round 4 (gate policy: halt). design.md NOT written; status.md unchanged (spec-ready). Register: `debate.md` (D-1..D-22, R-1..R-17, O-1..O-36, P-1..P-3). Round 4 closed O-21, O-23, O-25, O-26, O-28, O-29, O-31, O-32; P-3 dropped (evidence already on record at P-2).

## Open Threads

- **Approach (round-4 synthesis).** Keeps D-1..D-16 and honours R-1..R-13; takes the proposer's r4 structure with four adversary corrections verified in code. Portfolio (`order.filled` consumer only): migration `019_fill_applied_events` and the `observed()` branches are unchanged from r3. `processOrderFill` now has a pinned transaction and lock order: below-floor returns `errFillAcked` with zero DB calls; otherwise `BEGIN`, applied-row `INSERT … ON CONFLICT DO NOTHING RETURNING` inside the fold tx (never autocommit); on conflict SELECT the stored `event_id` / `pending_closed`, `COMMIT`, re-emit under `position.closed:<STORED event_id>` if pending, return `errFillAcked` with no `positionsMu`, advisory lock, FOR UPDATE, risk or snapshot call; on a fresh row `positionsMu.Lock()`, then `pg_advisory_xact_lock`, `SELECT … FOR UPDATE`, fold, `COMMIT`, emits through `emitEventAs`, `Unlock`, then `checkRiskLimits` / `broadcastSnapshot`. No advisory or `positions` row lock is ever taken before `positionsMu`; `ApplyFill` stays one call on one `pgx.Tx` with a hook for the mutex. The AC-2 proof uses the existing harness (`portfolio-db-test`, `//go:build dbtest`, `testPool` / `serviceTestPool`, `PORTFOLIO_DB_TEST_URL`) with no CI change: a repo-level `apply_fill_dbtest_test.go` plus a service-level case with two `PortfolioService` instances folding the same event to qty 15. Trading (`pollFills` callee): migration `012_bracket_legs` with `not_found_ticks`; `ActivateBracket` writes `filled_qty = 0` and skips empty leg ids; `KnownBrokerOrderIDs` gains the `bracket_legs.leg_order_id` UNION; new `broker.ErrOrderNotFound` (Alpaca HTTP 404 only); IBKR `GetOrder` matches `OrderID == brokerOrderID`, and an IBKR miss or empty list is an ordinary error, never not-found, because `GetOrder` and `ListOrders` share `/iserver/account/orders` (R-10) — IBKR legs never auto-retire unless `/sdd-spec` verifies a definitive single-order not-found response (F-04). `pollBracketLegFills` runs after `logTick`, never feeds the parent counts, and retires a leg as `UNKNOWN` only after 3 consecutive `ErrOrderNotFound` ticks.
- **Strongest open objection.** O-17 / O-11 (P-1, P-2), blocking: the D-4 reopen and the C-16 sign-off for the `@AC-5` amendment exist only in the workflow's computed steer. This file records no such ruling, so neither is recorded and the leg key stays `bracket-leg:<legID>:<status>:<filledQty>` (D-4). The amendment is fully specified and applies without another round once the operator's own ruling is recorded here: key `bracket-leg:<account_id>:<legID>:<status>:<filledQty>`, GetPnL's three dedup maps (`portfolio_service.go:993-1013`) on a composite `account_id + "\x00" + order_id`, a two-account same-leg-id test, and a required `/sdd-spec` grep of trading's partial- and full-fill payload history for a consistent `account_id`. If declined, the cross-account IBKR leg-id collision is a named residual. Three further blocking objections were adopted in the synthesis and await the proposer's confirmation: O-33 (fill-path tx and lock order, with a sync-versus-fill no-deadlock test), O-24 / O-20 (IBKR miss never counts as not-found, with an IBKR-miss-never-retires test), and O-27 / O-34 (AC-2 proof on the existing `dbtest` harness with the two-service case).
- **Floor status.** No Floor breach. The design is not approvable this round: four blocking objections remain.
- **Uncovered @AC changes.** `@AC-5` CHANGE is still not covered by an operator decision (O-11). All other rules (@AC-1..@AC-4, 294 @AC-56, 294 @AC-6, 251 @AC-17, 251 @AC-14, 290 @AC-3, 206 trading @AC-1) PRESERVE.
- **Operator sign-offs still needed.** The D-4 ruling and the `@AC-5` sign-off (O-17, O-11), which also carry the GetPnL dedup-scope extension beyond the product spec's stated scope (O-35); O-3 cutover residuals (overlap double-apply, fills never folded before the first new boot, late-commit `recorded_at` before the floor, clock skew; stop-then-start first deploy as a numbered runbook step with a recorded result); O-8 parked post-floor fill re-parks with an ERROR on every boot; O-13 bracket-leg fills absent from `trading.orders` and `NetFilledQtyBySymbol`. Deferred to `/sdd-spec`: the `services/xstockstrat-analysis/acceptance/*` rule scan (O-30), the re-check of migration numbers 019 and 012 against feature 318, and the findings note that `trading.fill_poller` failed counts may rise for IBKR (O-36).

```sdd-batch-design-state
{
  "round": 4,
  "synth": {
    "approach": "Round-4 synthesis. It keeps D-1..D-16, honours R-1..R-13, and takes the proposer's r4 structure with four corrections from the adversary that I verified in the code.\n\nVerified this round:\n- `/home/user/xstockstrat/docs/roadmap/features/311-fix-position-fold-correctness/context.md` (working tree and `origin/feature/fix-position-fold-correctness`) records no D-4 ruling and no @AC-5 sign-off. Lines 37-40 and 325 still list both as pending.\n- Portfolio already has a real-Postgres harness: job `portfolio-db-test` (`.github/workflows/ci.yml:1017-1065`) runs `go test -tags dbtest -race ./internal/repository/... ./internal/service/...` with `PORTFOLIO_DB_TEST_URL`; `testPool` (`services/xstockstrat-portfolio/internal/repository/dbtest_helpers_test.go:22-29`) and `serviceTestPool` (`internal/service/position_drain_dbtest_test.go:24-31`) already skip locally and `t.Fatal` under `CI=true`. `ci.yml:510-512` is the analysis job and only installs binaries.\n- IBKR `GetOrder` and `ListOrders` call the same endpoint, `/iserver/account/orders` (`services/xstockstrat-trading/internal/broker/ibkr.go:415-421` vs `:449`); `GetOrder` returns `result.Orders[0]` unmatched (`:441-442`).\n- GetPnL's `filledOrderIDs`, `latest` and `partialOrder` are keyed on the bare `f.OrderID` (`services/xstockstrat-portfolio/internal/service/portfolio_service.go:993-1013`).\n\nLEG KEY (D-4) — not changed by this synthesis\n- The steer that reopens D-4 and signs off @AC-5 reached this step only inside the workflow's computed task text. The same text says \"OPERATOR DECISIONS: none recorded\", and `context.md` has no record. I therefore do not record a reopen or an operator-covered rule change.\n- Until the operator's ruling is recorded in `context.md`, the leg key stays `bracket-leg:<legID>:<status>:<filledQty>` (D-4).\n- The amendment is fully specified and applies with no further debate once the ruling is recorded:\n  - Key `bracket-leg:<account_id>:<legID>:<status>:<filledQty>`, where `account_id` is the `bracket_legs` PK column (D-7). The rest of D-4 is unchanged.\n  - GetPnL's three dedup maps (`portfolio_service.go:993-1013`) use a composite `account_id + \"\\x00\" + order_id`. Nothing else in GetPnL changes. Events with an empty `account_id` group exactly as today.\n  - Test: two accounts with the same leg id each fold their partial and full fill independently, and the ledger holds both appends.\n  - `/sdd-spec` required step: grep trading's partial- and full-fill payload history to confirm both always carried the same `account_id` (today both emit `order.AccountId`, `trading.go:1935,1956`).\n  - The GetPnL change extends the product spec's stated scope and is recorded in `context.md` with the ruling.\n- If the operator declines: no GetPnL change, and the cross-account IBKR leg-id collision is a named residual.\n\nPORTFOLIO (the `order.filled` consumer only; 290 @AC-3)\n\n(1) Migration `019_fill_applied_events`, unchanged from r3.\n\n(2) `observed()` branches, unchanged (D-12).\n\n(3) `processOrderFill`, with the transaction and lock order pinned:\n1. Parse the payload. If `recorded_at < floor`, return `errFillAcked` with zero DB calls.\n2. Sign with `signedQty` (`:1065`). Missing side returns `ErrFillUnattributable`.\n3. `BEGIN`.\n4. `INSERT applied … ON CONFLICT DO NOTHING RETURNING`, inside the fold tx (D-1). It is never autocommit.\n5. On conflict (duplicate): SELECT the stored `event_id` and `pending_closed`, `COMMIT`. If `pending_closed` is non-NULL, re-emit under `position.closed:<STORED event_id>` (D-13) and clear it on success. Return `errFillAcked`. No `positionsMu`, no advisory lock, no FOR UPDATE, no risk or snapshot call (R-9).\n6. Fresh row: `positionsMu.Lock()` (D-5), then `pg_advisory_xact_lock`, then `SELECT … FOR UPDATE`, the `pnl.FoldFrom` callback, upsert or delete, `pending_closed` bound as a string, `COMMIT`.\n7. Post-commit emits through `emitEventAs` (returns an error, key parameter, `emitEvent` stays the fail-soft wrapper). Clear `pending_closed` only on nil.\n8. `Unlock`, then `checkRiskLimits` and `broadcastSnapshot`, for applied fills only.\n- Lock-order invariant: no advisory lock and no `positions` row lock is ever taken before `positionsMu`. At step 6 the tx holds only the uncommitted applied row, which `processPositionSync` never touches, so the mutex wait cannot deadlock with sync.\n- Repo seam: `ApplyFill` stays one call on one `pgx.Tx` and takes a hook that the service uses to take `positionsMu` after a fresh INSERT and before the advisory lock. `/sdd-spec` picks the exact signature.\n- Tests on the `newFillSvc` scaffold (`portfolio_fill_errors_test.go:56`): a duplicate sets no snapshot or `portfolio.snapshot` expectations and the quote and notify fakes assert zero calls; below-floor makes zero DB calls; a duplicate with `pending_closed` appends once; sync and fill running concurrently do not deadlock.\n\n(4) AC-2 proof on the existing harness. No CI change, no new env var.\n- `services/xstockstrat-portfolio/internal/repository/apply_fill_dbtest_test.go`, `//go:build dbtest`, reusing `testPool` with a `DB_PGBOUNCER` exec-mode option. Cases: one `order_id` to two pools is applied once; two fills on one position serialize; a duplicate with `pending_closed` re-emits once.\n- A service-level case in `internal/service` (also `dbtest`, reusing `serviceTestPool`): two `PortfolioService` instances, each with its own `positionsMu`, run `processOrderFill` on the same event concurrently and the position ends at qty 15. This proves the database, not the in-process mutex, serializes.\n- Both run in `portfolio-db-test` and fail, never skip, under CI. This is not a downgrade.\n\n(5) Boot-replay residual (O-21): a duplicate costs up to 4 round trips (BEGIN, INSERT, SELECT, COMMIT) with no snapshot, risk, quote or ledger call. At the planning figure of 200 fills/day (an assumption) that is about 73k post-floor fills per year, roughly 300 s of boot replay per year of history over the pool of 2. It grows linearly until a rolling-floor follow-up, which is named and not scoped here.\n\nTRADING (`pollFills` callee; D-3; 294 @AC-6)\n\n(6) Migration `012_bracket_legs` per D-7, with `not_found_ticks SMALLINT NOT NULL DEFAULT 0`. Only the seed writes `filled_qty` NULL.\n\n(7) `BracketRepository.ActivateBracket` (D-14) writes `filled_qty = 0` and skips empty leg ids. Test: a leg already FILLED 10 @ 110 on its first observation emits `order.filled` qty 10.\n\n(8) `KnownBrokerOrderIDs` (`trading_repo.go:135-150`) gains the `bracket_legs.leg_order_id` UNION, with a test for a canceled leg blanked by resize.\n\n(9) Broker changes.\n- New `broker.ErrOrderNotFound`. Alpaca `GetOrder` wraps it on HTTP 404 (`alpaca.go:343-344`).\n- IBKR `GetOrder` selects the entry whose `OrderID == brokerOrderID` (R-11). Test: a response whose `Orders[0]` is another id never returns that order.\n- IBKR miss or empty list: this is the same endpoint as `ListOrders`, so it is list absence or a session blip, which R-10 locks out as a not-found signal. It returns an ordinary error, not `ErrOrderNotFound`. IBKR wraps `ErrOrderNotFound` only if `/sdd-spec` verifies (F-04) a definitive single-order not-found response. Until then IBKR legs never auto-retire: WARN and keep polling.\n- Parent `pollFills` (`trading.go:1822`): an IBKR miss is an ordinary failed poll, with no retirement and no status change. The trading findings entry (`services/xstockstrat-trading/docs/context-constitution-findings.md`) logs the latent defect and that `trading.fill_poller` failed counts may rise for IBKR.\n\n(10) `pollBracketLegFills` runs after `logTick` (`trading.go:1831`) and never feeds the parent counts.\n- One `ListOrders` per account with open legs, plus the capped `GetOrder` fallback (D-11). Absence from `ListOrders` never counts as not-found.\n- `ErrOrderNotFound` increments `not_found_ticks`; at 3 consecutive ticks the leg goes terminal `UNKNOWN` with a WARN. A successful read resets the counter. Every other error leaves it unchanged.\n- `held` and other unrecognised statuses stay open.\n- Per-leg emit rules, fees (D-16), synchronous keyed append and the first-failure tick budget (D-15) are unchanged from r3.\n- Tests: 5xx stays open across N ticks; 2 not-found then a success resets; 3 Alpaca not-found retires UNKNOWN; an IBKR miss never retires.\n\nBUILD ORDER\n1. Migrations.\n2. `observed()` branches, the pinned `ApplyFill` order, telemetry and duplicate tests.\n3. Fold rewrite and flip handling (D-10).\n4. The two `dbtest` AC-2 tests.\n5. Broker `ErrOrderNotFound`, IBKR id-match, tests.\n6. `ActivateBracket`, the `KnownBrokerOrderIDs` UNION, keyed append, the observer and its tests.\n7. Docs, the C-16 promotion, residuals in `context.md`, and the stop-then-start first deploy as a numbered runbook step with a recorded result.",
    "open_objections": [
      {
        "text": "O-17 / O-11 (P-1, P-2): the D-4 reopen and the C-16 sign-off for the @AC-5 amendment exist only in the workflow's computed steer. They are not in context.md, and the task itself says no operator decisions are recorded. The orchestrator must get the operator's own ruling on both and record it in context.md. The account-scoped key and the GetPnL composite dedup key are fully specified and apply on that record without another round; if declined, the cross-account collision becomes a named residual.",
        "blocking": true
      },
      {
        "text": "Transaction and lock order for the fill path: the applied INSERT must be inside the fold tx (D-1), never autocommit. Pinned order: BEGIN, INSERT, on conflict SELECT + COMMIT + re-emit + errFillAcked; on a fresh row positionsMu.Lock, pg_advisory_xact_lock, FOR UPDATE, fold, COMMIT, emits, Unlock. No advisory or positions row lock before positionsMu. ApplyFill needs a hook for the mutex. A sync-versus-fill no-deadlock test is required. Adopted in the synthesis; the proposer must confirm.",
        "blocking": true
      },
      {
        "text": "O-24 / O-20: for IBKR, an empty list or an id miss from GetOrder must not count as not-found, because GetOrder uses the same /iserver/account/orders endpoint as ListOrders (ibkr.go:415-421, 449) and R-10 locks out list absence and session blips. IBKR wraps ErrOrderNotFound only on a definitive single-order not-found response verified at /sdd-spec (F-04); otherwise IBKR legs never auto-retire. Alpaca 404 keeps the 3-consecutive-tick rule. Adopted in the synthesis; the proposer must confirm with an IBKR-miss-never-retires test.",
        "blocking": true
      },
      {
        "text": "O-27: the AC-2 proof must use the existing harness, not new CI provisioning. Name it apply_fill_dbtest_test.go with //go:build dbtest, reuse testPool and PORTFOLIO_DB_TEST_URL in the portfolio-db-test job (ci.yml:1017-1065), and add a service-level dbtest case with two PortfolioService instances, each with its own positionsMu, folding the same event to qty 15. An untagged test with a new PORTFOLIO_PG_TEST_URL would fatal in the Go coverage job. Adopted in the synthesis; the proposer must confirm.",
        "blocking": true
      },
      {
        "text": "O-3: the cutover residuals (overlap double-apply, fills never folded before the first new boot, late-commit recorded_at before the floor, clock skew) still need operator sign-off, and the stop-then-start first deploy must be a numbered runbook step with a recorded result.",
        "blocking": false
      },
      {
        "text": "O-8: a parked post-floor fill re-parks with an ERROR on every boot and has no redelivery path. Operator acceptance is still needed.",
        "blocking": false
      },
      {
        "text": "O-13: bracket-leg fills stay absent from trading.orders and NetFilledQtyBySymbol. The proposer names it as a residual, but it has not been raised with the operator.",
        "blocking": false
      },
      {
        "text": "O-30: the services/xstockstrat-analysis/acceptance/* rule scan is deferred to /sdd-spec and the affected analysis ACs are still not listed. The D-10 flip-short window residual is named.",
        "blocking": false
      },
      {
        "text": "The GetPnL dedup-scope change goes beyond the product spec's stated scope. It rides on the D-4 ruling, must be recorded in context.md as a scope extension, and the /sdd-spec grep of trading's partial- and full-fill payload history for a consistent account_id is a required step.",
        "blocking": false
      },
      {
        "text": "The IBKR id-match also changes the parent pollFills path (trading.go:1822): a miss becomes an ordinary failed poll with no retirement and no status change. The spec must state this, and the findings entry must note that trading.fill_poller failed counts may rise for IBKR.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "294 @AC-56",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "294 @AC-6",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "251 @AC-17",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "251 @AC-14",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "290 @AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "206 trading @AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "An autocommit applied-row INSERT on the fill path (the reading of proposal r4's '2 autocommit round trips'). Lost: a crash between that commit and the fold commit marks a fill applied without folding it, which breaks D-1.",
      "A new untagged apply_fill_realpg_test.go with PORTFOLIO_PG_TEST_URL and a PG install step in the portfolio Go job (proposal r4). Lost: it duplicates the existing portfolio-db-test job and testPool helper (ci.yml:1017-1065; dbtest_helpers_test.go:22-29), cites the analysis job as precedent, and without a build tag would fatal in the Go coverage job where the URL is unset.",
      "A repo-only two-pool test as the whole AC-2 proof. Lost: AC-2 is about two portfolio processes, and two pools on ApplyFill do not show that the in-process positionsMu is not what serializes.",
      "Treating an IBKR empty list or id miss as ErrOrderNotFound (proposal r4). Lost: it is locked R-10 under a new name, because IBKR GetOrder and ListOrders share one endpoint (ibkr.go:415-421, 449) and a gateway re-auth window of about 15 s would retire open legs and lose their exit fills.",
      "A wall-clock retirement threshold in place of the 3-consecutive-tick count (adversary r4). Lost: once only a definitive not-found (Alpaca 404) counts, the window length no longer guards against transient reads, so the extra timestamp column buys nothing.",
      "Leg order_id = <account_id>:<legID> instead of the GetPnL composite dedup key (adversary r4). Lost: leg ids would no longer match order_brackets and order.bracket_updated ids textually, and it changes more of D-4 (order_id = leg id) than the key amendment does.",
      "Recording the D-4 reopen and the @AC-5 sign-off on the strength of the computed steer alone. Lost: context.md holds no such ruling and the task states no operator decisions are recorded (C-11, C-16)."
    ],
    "open_risks": [
      "Until the operator's D-4 ruling is recorded, cross-account IBKR leg-id collisions can drop a second account's exit fill through the global ledger idempotency key, and GetPnL's bare-id dedup maps (portfolio_service.go:993-1013) can suppress the other account's partials.",
      "If the composite GetPnL key is applied, a historical order whose partial and full fills carried different account_id values would stop being deduplicated. The mixed-group refusal turns the empty/non-empty case into FAILED_PRECONDITION, but the history grep at /sdd-spec is the only check.",
      "IBKR legs the broker has genuinely forgotten are polled forever (WARN each tick, capped GetOrder budget) unless /sdd-spec finds a definitive single-order not-found response.",
      "It is unverified whether IBKR /iserver/account/orders?orderId= filters at all. If it does not, legs outside the list result never resolve through the fallback.",
      "The fresh fill path holds an open transaction and a PgBouncer connection (pool of 2) while it waits for positionsMu behind a position sync.",
      "Cutover: one overlap fill double-applied, fills the old binary never folded, late-commit recorded_at before the floor, and ledger/portfolio clock skew. qty heals at sync; realized_accum and fees_accum may stay wrong.",
      "Legs partially filled at cutover are BASELINE_RETIRED, so realized P&L for their post-cutover remainder is lost.",
      "Boot replay re-walks every post-floor fill at up to 4 round trips each, and consumer_applied_events has no retention. The 200 fills/day figure is an assumption.",
      "A parked post-floor fill re-parks with an ERROR on every boot.",
      "A leg id is lost from tracking if the ActivateBracket tx fails; it is alerted, but its exit fill never folds.",
      "Neither broker adapter populates BrokerOrder.Fees, so parent and leg fee totals both understate.",
      "IBKR cumulative filledQuantity netting for legs is unverified (services/xstockstrat-trading/docs/ibkr.md unread).",
      "The analysis pnl_pattern_consumer is affected and its acceptance rules are unscanned; a D-10 flip short never opens an analysis window.",
      "Migration numbers 019 and 012 may collide with feature 318 and must be re-checked at /sdd-spec.",
      "OQ-2 (repair of already-inflated accumulators) is out of scope, and instance_count must stay 1 because sync still relies on positionsMu."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-08",
      "C-10",
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "F-04",
      "F-06",
      "F-07",
      "P-02",
      "P-03",
      "PLAT-N1"
    ],
    "rationale": "There is no Floor breach, but the design is not approvable this round: four blocking objections remain.\n\n**Operator rulings.** I did not record the D-4 reopen or the @AC-5 sign-off. The steer arrived only in the workflow's computed task text, which also says \"OPERATOR DECISIONS: none recorded\", and `context.md` on both the working tree and the feature branch still lists both as pending. The relayed user request (\"Yes, resume all together\") names neither. So `reopened` is empty, @AC-5 stays `covered_by_operator_decision = false`, and D-4's key stands. The amendment is written out in full so one recorded ruling applies it without another debate round.\n\n**Adversary claims I verified and adopted.**\n- The AC-2 CI plan duplicated existing infrastructure. `portfolio-db-test` (`ci.yml:1017-1065`) and `testPool` already do what the proposer proposed to build, and that job already runs `./internal/service/...`, so the two-service case fits with no CI change.\n- IBKR `GetOrder` and `ListOrders` share one endpoint (`ibkr.go:415-421`, `:449`). An IBKR miss is therefore list absence, which R-10 locks. The approach is corrected to honour R-10, not recorded as a new decision.\n- The duplicate path's transaction scope was unspecified. The pinned order keeps the INSERT inside the fold tx (D-1) and keeps the duplicate path off `positionsMu` (R-9). At the mutex wait the tx holds only the applied row, so it cannot deadlock with sync.\n\n**Where I did not follow the adversary.** The wall-clock threshold is dropped: with only Alpaca's definitive 404 counting, the 3-tick rule is enough. The leg-`order_id` prefix loses to the composite GetPnL key.\n\n**Closed this round** (confirmed by the proposer with tests, not contested): O-23, O-25, O-26, O-28, O-29, O-31, O-32, and O-21 with the cost corrected to 4 round trips.\n\n**Still open:** O-17 and O-11 (ruling not on record), O-24 and O-20 (IBKR rule corrected, awaiting confirmation), O-27 (harness corrected, awaiting confirmation), O-3, O-8, O-13, O-30.\n\nThe proposer's REOPEN D-4 cites `portfolio_service.go:993-1019`, which is already on record under P-2, so it is not new evidence.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "A duplicate or below-floor order.filled returns errFillAcked with no positionsMu, no advisory lock, no FOR UPDATE and no risk, snapshot or position.* call. Its only side effect is the pending_closed re-emit. Below-floor makes zero DB calls.",
          "evidence": "portfolio_service.go:482-485; R-9; D-12; D-13; proposal r4 item 3(a) with the newFillSvc zero-call test (portfolio_fill_errors_test.go:56); adversary r4 contested only the tx and lock order"
        },
        {
          "text": "IBKR GetOrder selects the entry whose OrderID equals the requested id and never returns Orders[0] unmatched. The latent parent pollFills defect is logged in the trading findings.",
          "evidence": "ibkr.go:441-442; trading.go:1822; R-11; adversary r4 contested only how a miss is classified"
        },
        {
          "text": "Rows written by ActivateBracket carry filled_qty = 0 and empty leg ids are skipped. Only the 012 seed writes NULL. Alpaca held and other unrecognised leg statuses stay non-terminal.",
          "evidence": "R-13; trading.go:1853-1858; proposal r4 item 3(d) with the FILLED-on-first-observation test; adversary r4 did not contest"
        },
        {
          "text": "KnownBrokerOrderIDs gains a UNION over trading.bracket_legs.leg_order_id for the account.",
          "evidence": "trading_repo.go:135-150; trading.go:3612; 206 trading @AC-1; adversary r4 did not contest"
        },
        {
          "text": "emitEventAs returns an error and takes the key parameter; emitEvent stays the fail-soft wrapper. pending_closed is cleared only on a nil return.",
          "evidence": "portfolio_service.go:1342,1356; adversary r4 did not contest"
        },
        {
          "text": "pollBracketLegFills runs after logTick and its outcomes never feed the parent polled/failed counts.",
          "evidence": "trading.go:1831; 294 @AC-6; adversary r4 did not contest"
        }
      ],
      "new_rejected": [
        {
          "text": "An autocommit applied-row INSERT on the fill path, outside the fold transaction",
          "why": "A crash between that commit and the fold commit marks a fill applied without folding it, which breaks D-1."
        },
        {
          "text": "A new untagged real-PG test with PORTFOLIO_PG_TEST_URL and a PG install step in the portfolio Go CI job",
          "why": "It duplicates the portfolio-db-test job and the testPool helper (ci.yml:1017-1065; dbtest_helpers_test.go:22-29), and without the dbtest build tag it would fatal in the Go coverage job where the URL is unset."
        },
        {
          "text": "A wall-clock retirement threshold in place of the 3-consecutive-tick not-found count",
          "why": "Once only a definitive not-found (Alpaca 404) counts, the window length no longer guards against transient reads, so the extra timestamp column is unneeded."
        },
        {
          "text": "Leg order_id = <account_id>:<legID> as the way to scope legs by account",
          "why": "Leg ids would no longer match order_brackets and order.bracket_updated ids textually, and it changes more of D-4 than the key amendment does."
        }
      ],
      "new_objections": [
        {
          "text": "Pin the fill-path transaction and lock order: applied INSERT inside the fold tx; on conflict SELECT, COMMIT, re-emit, errFillAcked; on a fresh row positionsMu.Lock, then pg_advisory_xact_lock, FOR UPDATE, fold, COMMIT, emits, Unlock. No advisory or positions row lock before positionsMu. ApplyFill exposes a hook for the mutex, and a sync-versus-fill no-deadlock test is required.",
          "blocking": true
        },
        {
          "text": "The AC-2 proof needs a service-level dbtest case: two PortfolioService instances, each with its own positionsMu, run processOrderFill on the same event concurrently and end at qty 15 (precedent position_drain_dbtest_test.go:24-31).",
          "blocking": true
        },
        {
          "text": "The GetPnL composite dedup key extends the product spec's scope. Record it in context.md with the D-4 ruling and make the /sdd-spec payload-history grep for a consistent account_id a required step.",
          "blocking": false
        },
        {
          "text": "State that the parent pollFills path treats an IBKR id miss as an ordinary failed poll with no retirement or status change, and note in the findings that trading.fill_poller failed counts may rise for IBKR.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-21",
          "how": "Residual restated on the side-effect-free duplicate path with a growth estimate: up to 4 round trips per post-floor fill (BEGIN, INSERT, SELECT, COMMIT), about 73k fills and roughly 300 s of boot replay per year at an assumed 200 fills/day. The rolling-floor follow-up is named."
        },
        {
          "id": "O-23",
          "how": "Duplicate and below-floor paths return errFillAcked before positionsMu and every side effect, counted acked, with newFillSvc tests asserting zero snapshot, quote and notify calls. The tx and lock order is tracked as a new objection."
        },
        {
          "id": "O-25",
          "how": "IBKR GetOrder matches OrderID to the requested id, with a test that an Orders[0] of another id is never returned, and the parent pollFills defect is logged in the trading findings. How a miss is classified is tracked under O-24."
        },
        {
          "id": "O-26",
          "how": "ActivateBracket rows carry filled_qty = 0, with a test for a leg already FILLED 10 @ 110 on its first observation emitting order.filled qty 10."
        },
        {
          "id": "O-28",
          "how": "KnownBrokerOrderIDs gains the bracket_legs.leg_order_id UNION, with a test for a canceled leg blanked by resize."
        },
        {
          "id": "O-29",
          "how": "ActivateBracket skips empty leg ids, and held and other unrecognised statuses stay open."
        },
        {
          "id": "O-31",
          "how": "emitEventAs returns an error, emitEvent stays the fail-soft wrapper, and pending_closed is cleared only on success."
        },
        {
          "id": "O-32",
          "how": "pollBracketLegFills runs after logTick (trading.go:1831) and its outcomes never feed the parent counts."
        }
      ],
      "reopen_petitions": [
        {
          "target": "D-4",
          "evidence": "Proposer r4: GetPnL's filledOrderIDs, latest and partialOrder maps are keyed on the bare order id (portfolio_service.go:993-1019), so the amendment must extend to GetPnL's dedup scope. This evidence is already on record at P-2 (:990-1013); it refines the remedy only.",
          "is_new": false
        }
      ],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-20 — sdd-batch design gate (round 5)

- `/sdd-design fix-position-fold-correctness` (full) halted at its approval gate after round 5 (gate policy: halt). design.md NOT written; status.md unchanged (spec-ready). Register: `debate.md` (D-1..D-27, R-1..R-22, O-1..O-42, P-1..P-3). Round 5 reopened D-17 (superseded by D-23) and closed O-20, O-24, O-27, O-33, O-34, O-36.

## Open Threads

- **Approach (round-5 synthesis).** D-1..D-3, D-5..D-16 and D-18..D-22 stand and R-1..R-17 are honoured. D-17 is reopened on the user's relayed words ("Do your best to prevent the race condition and fix the bug report") and replaced by D-23. Portfolio fill path (`processOrderFill`, `order.filled` consumer only): below-floor returns `errFillAcked` with zero DB calls; `signedQty` and any pre-251 `orderSide` fallback run before the mutex and `BEGIN`; an autocommit duplicate pre-check `SELECT event_id, pending_closed` by the applied PK takes no tx and no `positionsMu` (a hit re-emits `pending_closed` under `position.closed:<STORED event_id>`, clears it on a nil return, and returns `errFillAcked`; a pre-check DB error returns an error and never falls through). On a miss: `positionsMu.Lock()` before `BEGIN`, then one tx with the applied `INSERT … ON CONFLICT DO NOTHING RETURNING`, `pg_advisory_xact_lock`, one `SELECT … FOR UPDATE` returning qty, cost_basis, avg_entry, realized_accum and fees_accum, a pure `pnl.FoldFrom` callback, upsert or delete, `COMMIT`, `Unlock`. The pool reads at `portfolio_service.go:455` and `:460` are removed. An INSERT conflict is the only duplicate that takes the mutex. `position.*` emits, `checkRiskLimits` and `broadcastSnapshot` run after `Unlock`, for applied fills only (D-24). Repo seam: `FillApplied` (pre-check) and `ApplyFill` (one `pgx.Tx`, begun through a separate `txBeginner`; `queryRower` is not widened; no mutex hook, D-25). Tests: pgxmock on `newFillSvc`, repo-level `apply_fill_dbtest_test.go` on `testPool` in default and `DB_PGBOUNCER` exec mode (including the deterministic conflict-path case), and service-level cases on `serviceTestPool` (two instances to qty 15; sync-versus-fill with no `40P01`), all in the existing `portfolio-db-test` job with no CI change (D-27). Trading is as round 4 and now confirmed by both sides (D-26): only an Alpaca 404 wraps `broker.ErrOrderNotFound`, with `UNKNOWN` retirement after 3 consecutive not-found ticks; an IBKR miss is an ordinary error and never retires a leg. The leg key (D-4) is unchanged. Build order: migrations `019` and `012` (re-check against feature 318), `observed()` branches plus `FillApplied`/`ApplyFill`, fold rewrite, `dbtest` cases, broker `ErrOrderNotFound` and IBKR id-match, `ActivateBracket` and the observer, then docs and the stop-then-start first deploy as a numbered runbook step.
- **Strongest open objection.** O-17 / O-11 (P-1, P-2), blocking: the D-4 reopen and the C-16 sign-off for the `@AC-5` amendment appear only in the workflow's computed text. This file (the "Operator sign-offs still needed" thread of the round-4 entry) still lists both as pending, and the user's relayed words name neither. The leg key stays `bracket-leg:<legID>:<status>:<filledQty>`. The amendment is fully specified (key `bracket-leg:<account_id>:<legID>:<status>:<filledQty>`; GetPnL's three dedup maps keyed on `account_id + "\x00" + order_id`; a two-account same-leg-id test; the `/sdd-spec` payload-history grep; `@AC-5` reworded to `order.partially_filled` 4 then `order.filled` qty 10 at average 110, position 0, realized 100) and applies with no further round once the operator's own words are recorded here. If declined, the cross-account IBKR leg-id collision is a named residual. Three more blocking objections are new this round and await proposer confirmation: O-37 (real-Postgres conflict-path `dbtest`), O-38 (every fold read from the one `FOR UPDATE` row, pure `foldFn`), O-39 (separate `txBeginner`; `portfolio_fill_sync_race_test.go` retired or re-pointed and listed in the spec's Files, F-08).
- **Floor status.** No Floor breach. The design is not approvable this round: four blocking objections remain (O-17/O-11, O-37, O-38, O-39).
- **Uncovered @AC changes.** `@AC-5` CHANGE is still not covered by an operator decision (O-11). All other rules (@AC-1..@AC-4, 294 @AC-56, 294 @AC-6, 251 @AC-17, 251 @AC-14, 290 @AC-3, 206 trading @AC-1) PRESERVE.
- **Operator sign-offs still needed.** The D-4 ruling and the `@AC-5` sign-off (O-17, O-11), which also carry the GetPnL dedup-scope extension beyond the product spec's stated scope (O-35); O-3 cutover residuals (overlap double-apply, fills never folded before the first new boot, late-commit `recorded_at` before the floor, clock skew; stop-then-start first deploy as a numbered runbook step with a recorded result), now with the two post-`Unlock` emit-ordering residuals named beside them (O-42); O-8 (a parked post-floor fill re-parks with an ERROR on every boot); O-13 (bracket-leg fills stay absent from `trading.orders` and `NetFilledQtyBySymbol`). O-30 (analysis acceptance rule scan) is deferred to `/sdd-spec`.

```sdd-batch-design-state
{
  "round": 5,
  "synth": {
    "approach": "Round-5 synthesis. D-1..D-3, D-5..D-16 and D-18..D-22 stand, and R-1..R-17 are honoured. D-17 is reopened on the user's relayed words and replaced by the order below. D-4 is not changed: its reopen is not on record (see LEG KEY).\n\nVerified this round:\n- `/home/user/xstockstrat/docs/roadmap/features/311-fix-position-fold-correctness/context.md:641-645` still lists the D-4 ruling and the @AC-5 sign-off as pending. No operator ruling for either is recorded anywhere in the file.\n- `queryRower` (`services/xstockstrat-portfolio/internal/repository/portfolio_repo.go:23-27`) has only `QueryRow`, `Query` and `Exec`. It is also used by `watchlist_repo.go`, and the hand-written fakes `syncRecorderDB` (`internal/service/portfolio_offline_test.go:220`), `cancelingDB` (`portfolio_sync_cancel_test.go:16`) and `interleaveDB` (`portfolio_fill_sync_race_test.go:27`) do not implement `Begin`.\n- The close branch reads `GetRealizedAccum` (`internal/service/portfolio_service.go:455`) and `GetFeesAccum` (`:460`) as separate pool calls.\n- `positionsMu` is taken at `:399`, `:1602-1603` and `:1649-1650`. `pool.go:15,23` sets MaxConns 2 and no isolation override.\n\nPORTFOLIO FILL PATH (`processOrderFill`, the `order.filled` consumer only; 290 @AC-3)\n1. Parse. Below the floor: return `errFillAcked` with zero DB calls.\n2. Sign with `signedQty` (`:1065`). Any `orderSide` fallback for pre-251 events (`:1080`) runs here, before the mutex and `BEGIN`. A missing side returns `ErrFillUnattributable` (D-12).\n3. Duplicate pre-check: one autocommit `SELECT event_id, pending_closed` by the applied PK. No tx, no lock, no `positionsMu`.\n   - Hit: re-emit a non-NULL `pending_closed` under `position.closed:<STORED event_id>` (D-13). On a nil return, clear it with an autocommit UPDATE keyed by the full PK plus `pending_closed IS NOT NULL` (D-21). A failed clear is a WARN only. Return `errFillAcked`.\n   - A pre-check DB error returns an error for redelivery. It never falls through to the fresh path.\n4. Miss: `positionsMu.Lock()` before `BEGIN`. Then one tx: applied `INSERT … ON CONFLICT DO NOTHING RETURNING` (inside the fold tx, R-14), `pg_advisory_xact_lock`, one `SELECT … FOR UPDATE` returning qty, cost_basis, avg_entry, realized_accum and fees_accum, `pnl.FoldFrom`, upsert or delete, `pending_closed` bound as a string, `COMMIT`, `Unlock`.\n   - `foldFn` is pure: no `s.repo`, ledger, `orderSide` or quote call. The `:455` and `:460` pool reads are removed.\n5. Conflict at the INSERT (another process applied it after our pre-check): SELECT the stored row, `COMMIT`, `Unlock`, re-emit as in step 3, return `errFillAcked`. This is the only duplicate that takes the mutex.\n6. After `Unlock`, for applied fills only: keyed `position.*` emits through `emitEventAs`, then `checkRiskLimits` and `broadcastSnapshot`. Neither duplicate kind runs risk, snapshot or `position.*` (R-9).\n- Lock order: `positionsMu` → `BEGIN` → applied row → advisory → position row. Sync and deregistration take `positionsMu` and then only autocommit single statements, and never an advisory lock.\n- Repo seam: `PortfolioRepo.FillApplied(ctx, key)` (pre-check) and `PortfolioRepo.ApplyFill(ctx, key, foldFn)` (one `pgx.Tx`). `ApplyFill` begins its tx through a separate `txBeginner` interface. `queryRower` is not widened. No mutex hook.\n- `portfolio_fill_sync_race_test.go` (`interleaveDB`) tests the old non-tx path. The spec's Files list must retire or re-point it explicitly (F-08).\n\nTESTS\n- pgxmock, on `newFillSvc` (`portfolio_fill_errors_test.go:56`): with `positionsMu` held, a new fill issues only the pre-check SELECT and no `Begin`; a pre-check hit never touches the mutex; no query runs outside the Begin/Commit bracket on the fresh path; a pre-check error returns an error.\n- `dbtest`, repo level, `internal/repository/apply_fill_dbtest_test.go` on `testPool`, in default and `DB_PGBOUNCER` exec mode (precedent `list_positions_dbtest_test.go:22-23`):\n  - one `order_id` to two pools is applied once; two fills on one position serialize;\n  - conflict path: a raw tx inserts the applied row and does not commit; `ApplyFill` on the same key blocks; on commit it reports conflict, the position is unchanged and `pending_closed` re-emits once; on rollback it applies exactly once.\n- `dbtest`, service level, on `serviceTestPool` (`position_drain_dbtest_test.go:24-31`):\n  - two `PortfolioService` instances fold the same event concurrently and end at qty 15;\n  - instance A runs a real multi-symbol `processPositionSync` (including the fill's symbol and a `DeletePositionsNotInSync`) while instance B folds a fill on that position; both finish under a deadline with no `40P01`.\n- All run in the existing `portfolio-db-test` job (`.github/workflows/ci.yml:1017-1065`) with no CI change and no downgrade (R-15).\n\nLEG KEY (D-4) — unchanged\n- The key stays `bracket-leg:<legID>:<status>:<filledQty>`. The D-4 reopen and the @AC-5 C-16 sign-off appear only in the workflow's computed text. The user's relayed words name the race fix and the bug report, not D-4, GetPnL's dedup scope or @AC-5.\n- The amendment is fully specified and applies with no further round once the operator's own words are in `context.md`: key `bracket-leg:<account_id>:<legID>:<status>:<filledQty>`; GetPnL's three dedup maps (`portfolio_service.go:993-1013`) keyed on `account_id + \"\\x00\" + order_id`; a two-account same-leg-id test; the `/sdd-spec` payload-history grep; @AC-5 reworded to `order.partially_filled` 4 then `order.filled` qty 10 at average 110, position 0, realized 100.\n- If declined: no GetPnL change, and the cross-account IBKR leg-id collision is a named residual.\n\nTRADING — as round 4, now confirmed by both sides\n- Alpaca `GetOrder` wraps `broker.ErrOrderNotFound` on 404; a leg retires `UNKNOWN` after 3 consecutive not-found ticks.\n- IBKR: an id miss or empty list is an ordinary error, never `ErrOrderNotFound` (`ibkr.go:415-421,449`; R-10). IBKR legs never auto-retire unless `/sdd-spec` verifies a definitive single-order not-found response (F-04).\n- Parent `pollFills` (`trading.go:1822`): an IBKR miss is an ordinary failed poll. The trading findings note that `trading.fill_poller` failed counts may rise.\n- Migration `012_bracket_legs`, `ActivateBracket`, the `KnownBrokerOrderIDs` UNION and `pollBracketLegFills` are unchanged.\n\nBUILD ORDER\n1. Migrations `019` and `012` (re-check numbers against feature 318).\n2. `observed()` branches, `FillApplied`, `ApplyFill` with `txBeginner`, the pgxmock tests.\n3. Fold rewrite with in-tx reads and flip handling (D-10).\n4. The `dbtest` cases.\n5. Broker `ErrOrderNotFound`, IBKR id-match, tests.\n6. `ActivateBracket`, the UNION, keyed append, the observer and its tests.\n7. Docs, residuals in `context.md`, and the stop-then-start first deploy as a numbered runbook step.",
    "open_objections": [
      {
        "text": "O-17 / O-11 (P-1, P-2): the D-4 reopen and the C-16 sign-off for the @AC-5 amendment are not on record. They appear only in the workflow's computed text; context.md:641-645 still lists both as pending, and the user's relayed words name neither. The orchestrator must get the operator's own ruling on both into context.md. The amendment then applies without another round; if declined, the cross-account collision is a named residual.",
        "blocking": true
      },
      {
        "text": "The INSERT-conflict path (pre-check miss, then conflict) is the whole race fix and needs a real-Postgres proof. Add the dbtest in apply_fill_dbtest_test.go, in default and DB_PGBOUNCER exec mode: an uncommitted raw tx holds the applied row, ApplyFill blocks, commit gives conflict with the position unchanged and one re-emit, rollback gives exactly one apply. Adopted in the synthesis; the proposer must confirm.",
        "blocking": true
      },
      {
        "text": "Every read the fold uses must come from the one FOR UPDATE row inside the tx. GetRealizedAccum (portfolio_service.go:455) and GetFeesAccum (:460) are pool calls today, which risks a lost update on the accumulators and a second connection from a pool of 2. foldFn must be pure, any orderSide fallback must run before the mutex, and a pgxmock test must assert no query outside the Begin/Commit bracket. Adopted in the synthesis; the proposer must confirm.",
        "blocking": true
      },
      {
        "text": "queryRower must not gain Begin: syncRecorderDB, cancelingDB and interleaveDB do not implement it and watchlist_repo.go shares the interface. ApplyFill uses a separate txBeginner interface, and portfolio_fill_sync_race_test.go is retired or re-pointed and listed in the spec's Files (F-08). Adopted in the synthesis; the proposer must confirm.",
        "blocking": true
      },
      {
        "text": "The no-deadlock claim needs a real-Postgres service-level dbtest: instance A runs a real multi-symbol processPositionSync with DeletePositionsNotInSync while instance B folds a fill on the same position, both finishing under a deadline with no 40P01. Optionally assert no idle-in-transaction session for B in pg_stat_activity. Adopted in the synthesis.",
        "blocking": false
      },
      {
        "text": "Pin pre-check and clear error handling: a pre-check DB error returns an error and never falls through to the fresh path; the clear is keyed by the full PK plus pending_closed IS NOT NULL; a failed clear is a WARN only. Adopted in the synthesis.",
        "blocking": false
      },
      {
        "text": "Emits now run after Unlock. Name two ordering residuals next to O-3: a position.updated emitted after a same-process sync has overwritten the row, and the two processes' emits for one position during the cutover overlap.",
        "blocking": false
      },
      {
        "text": "O-3: the cutover residuals (overlap double-apply, fills never folded before the first new boot, late-commit recorded_at before the floor, clock skew) still need operator sign-off, and the stop-then-start first deploy must be a numbered runbook step with a recorded result.",
        "blocking": false
      },
      {
        "text": "O-8: a parked post-floor fill re-parks with an ERROR on every boot and has no redelivery path. Operator acceptance is still needed.",
        "blocking": false
      },
      {
        "text": "O-13: bracket-leg fills stay absent from trading.orders and NetFilledQtyBySymbol. It is named as a residual but has not been raised with the operator.",
        "blocking": false
      },
      {
        "text": "O-30: the services/xstockstrat-analysis/acceptance/* rule scan is deferred to /sdd-spec and the affected analysis ACs are still not listed.",
        "blocking": false
      },
      {
        "text": "O-35: the GetPnL composite dedup key extends the product spec's scope. It rides on the D-4 ruling, must be recorded in context.md with it, and the /sdd-spec payload-history grep is a required step.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "294 @AC-56",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "294 @AC-6",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "251 @AC-17",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "251 @AC-14",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "290 @AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "206 trading @AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Round-4 order: BEGIN and the applied INSERT before positionsMu. Lost: a new fill waits for the mutex behind a sync batch (portfolio_service.go:1649-1650, 1602-1603) while idle in transaction on 1 of 2 client connections.",
      "positionsMu then BEGIN with no pre-check, every fill transactional (adversary r5). Lost: boot replay of every post-floor fill would take the mutex and a 4-round-trip tx, which is the O-21 cost the pre-check removes.",
      "Keep BEGIN before the mutex but TryLock, ROLLBACK and retry (adversary r5). Lost: the busy-retry churns the applied INSERT and inflates the error and acked counters (294 @AC-56).",
      "An advisory lock taken in its own short transaction ahead of the fold (proposer r5 runner-up). Lost: it splits the D-1 transaction.",
      "Widening queryRower with Begin (proposal r5). Lost: syncRecorderDB, cancelingDB and interleaveDB do not implement Begin and watchlist_repo.go shares the interface, so about 10 test sites break; a separate txBeginner is the smaller diff.",
      "A mutex hook on ApplyFill (round-4 O-33). Lost: with the mutex outside the transaction the hook has no use.",
      "pgxmock as the proof of the INSERT-conflict path (proposal r5). Lost: pgxmock cannot show that READ COMMITTED makes ON CONFLICT DO NOTHING wait on an uncommitted row, and the two-instance qty-15 test reaches that window only sometimes.",
      "Recording the D-4 reopen and the @AC-5 sign-off from the computed task text. Lost: context.md holds no such ruling and the user's relayed words name neither (C-11, C-16)."
    ],
    "open_risks": [
      "Until the operator's D-4 ruling is recorded, cross-account IBKR leg-id collisions can drop a second account's exit fill through the global ledger idempotency key, and GetPnL's bare-id dedup maps (portfolio_service.go:993-1013) can suppress the other account's partials.",
      "If the composite GetPnL key is applied, a historical order whose partial and full fills carried different account_id values would stop being deduplicated. The /sdd-spec history grep is the only check.",
      "A fill transaction can still wait server-side: on the applied-row conflict behind another process's fill tx, and on FOR UPDATE behind a sync's autocommit upsert. It holds 1 of 2 client connections and the process's positionsMu for that wait.",
      "The pre-check has a TOCTOU window. Only the in-tx INSERT conflict path covers it, so the conflict-path dbtest is load-bearing.",
      "Emits run after Unlock, so a position.updated can be emitted after a same-process sync has overwritten the row, and the two processes' emits can interleave during the cutover overlap.",
      "IBKR legs the broker has genuinely forgotten are polled forever (WARN each tick, capped GetOrder budget) unless /sdd-spec finds a definitive single-order not-found response.",
      "It is unverified whether IBKR /iserver/account/orders?orderId= filters at all. If it does not, legs outside the list result never resolve through the fallback.",
      "Cutover: one overlap fill double-applied, fills the old binary never folded, late-commit recorded_at before the floor, and clock skew. qty heals at sync; realized_accum and fees_accum may stay wrong.",
      "Legs partially filled at cutover are BASELINE_RETIRED, so realized P&L for their post-cutover remainder is lost.",
      "Boot replay re-walks every post-floor fill (now 1 round trip each) and consumer_applied_events has no retention. The 200 fills/day figure is an assumption.",
      "A parked post-floor fill re-parks with an ERROR on every boot.",
      "A leg id is lost from tracking if the ActivateBracket tx fails; it is alerted, but its exit fill never folds.",
      "Neither broker adapter populates BrokerOrder.Fees, so parent and leg fee totals both understate.",
      "The analysis pnl_pattern_consumer is affected and its acceptance rules are unscanned; a D-10 flip short never opens an analysis window.",
      "Migration numbers 019 and 012 may collide with feature 318 and must be re-checked at /sdd-spec.",
      "OQ-2 (repair of already-inflated accumulators) is out of scope, and instance_count must stay 1 because sync still relies on positionsMu."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-08",
      "C-10",
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "F-04",
      "F-06",
      "F-07",
      "F-08",
      "P-02",
      "P-03",
      "P-04",
      "PLAT-N1"
    ],
    "rationale": "No Floor breach, but the design is not approvable this round: four blocking objections remain.\n\n**What I recorded from the steer, and what I did not.**\n- **D-17 reopened.** The user's relayed words (\"Do your best to prevent the race condition and fix the bug report\") support it. The new order (mutex before `BEGIN`, pre-check for duplicates) replaces it and keeps its no-side-effect clause for both duplicate kinds.\n- **D-4 not reopened, @AC-5 not signed off.** Both appear only in the computed task text. `context.md:641-645` still lists them as pending and the user's words name neither. Proposer and adversary both reached the same reading. So `reopened` is `[\"D-17\"]` only, P-1/P-2 stay pending, @AC-5 stays uncovered, and O-17/O-11 stay open and blocking. The amendment is written out so one recorded ruling applies it.\n- **AC-2 on the existing `dbtest` harness.** Adopted on its merits; it matches locked R-15 and both sides agree.\n\n**Adversary claims I verified and adopted.**\n- `queryRower` has no `Begin` and three hand-written fakes plus `watchlist_repo.go` depend on it, so the proposer's \"pgxmock already implements it\" does not hold for this tree. `ApplyFill` gets a separate `txBeginner`.\n- `GetRealizedAccum` (`:455`) and `GetFeesAccum` (`:460`) are pool calls outside any row lock. The fold now reads everything from the one `FOR UPDATE` row.\n- The conflict path cannot be proved in pgxmock, so a deterministic real-Postgres case is added.\n\n**Closed this round:** O-33 (order re-pinned, hook dropped), O-24 and O-20 (IBKR rule confirmed by both sides), O-27 and O-34 (harness and two-service case confirmed), O-36.\n\n**Still open:** O-17, O-11, O-35 (ruling not on record); the three new blocking items awaiting proposer confirmation; O-3, O-8, O-13, O-30.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Fill-path order, superseding D-17: below-floor returns errFillAcked with zero DB calls. An autocommit pre-check SELECT by the applied PK runs with no tx and no positionsMu; a hit re-emits pending_closed and returns errFillAcked. On a miss, positionsMu.Lock comes before BEGIN, then the applied INSERT inside the fold tx, pg_advisory_xact_lock, FOR UPDATE, fold, COMMIT, Unlock. An INSERT conflict is the only duplicate that takes the mutex. Neither duplicate kind runs risk, snapshot or position.* calls.",
          "evidence": "portfolio_service.go:399,1602-1603,1649-1650; pool.go:15,23; R-9; R-14; user-approved reopen of D-17; proposal r5 steps 1-5; adversary r5 confirmed the order and contested only its tests and the reads"
        },
        {
          "text": "On an applied fill, position.* emits, checkRiskLimits and broadcastSnapshot run after positionsMu.Unlock. The pending_closed outbox makes the emits durable.",
          "evidence": "D-9; D-21; portfolio_service.go:1342,1356; proposal r5 step 6; adversary r5 asked only that the ordering residual be named"
        },
        {
          "text": "ApplyFill takes no mutex hook. The repo seam is FillApplied (autocommit pre-check) and ApplyFill (one pgx.Tx with a fold callback).",
          "evidence": "proposal r5 Repo seam; C-18; adversary r5 contested only how Begin is obtained"
        },
        {
          "text": "Only an Alpaca 404 wraps broker.ErrOrderNotFound, and a leg retires UNKNOWN after 3 consecutive not-found ticks. An IBKR id miss or empty list is an ordinary error; IBKR legs never auto-retire unless /sdd-spec verifies a definitive single-order not-found response. In the parent pollFills an IBKR miss is an ordinary failed poll, noted in the trading findings.",
          "evidence": "ibkr.go:415-421,449; alpaca.go:343-344; trading.go:1822; R-10; proposal r5 confirmed with the IBKR-miss-never-retires test; adversary r5 did not contest"
        },
        {
          "text": "The AC-2 proof runs on the existing dbtest harness with no CI change: repo-level apply_fill_dbtest_test.go on testPool plus a service-level case where two PortfolioService instances fold the same event to qty 15.",
          "evidence": "ci.yml:1017-1065; dbtest_helpers_test.go:22-29; position_drain_dbtest_test.go:24-31; R-15; proposal r5; adversary r5 asked only for added cases"
        }
      ],
      "new_rejected": [
        {
          "text": "Opening the fill transaction (BEGIN and the applied INSERT) before taking positionsMu",
          "why": "A new fill waits for the mutex behind a sync batch while idle in transaction on 1 of portfolio's 2 client connections (portfolio_service.go:1649-1650, 1602-1603)."
        },
        {
          "text": "Taking positionsMu and a transaction for every fill, with no duplicate pre-check",
          "why": "Boot replay of every post-floor fill would take the mutex and a 4-round-trip transaction."
        },
        {
          "text": "TryLock on positionsMu inside the transaction with ROLLBACK and retry",
          "why": "The busy-retry churns the applied INSERT and inflates the error and acked counters (294 @AC-56)."
        },
        {
          "text": "An advisory lock taken in its own short transaction ahead of the fold",
          "why": "It splits the D-1 transaction."
        },
        {
          "text": "Adding Begin to the queryRower interface",
          "why": "syncRecorderDB, cancelingDB and interleaveDB do not implement it and watchlist_repo.go shares the interface, so about 10 test sites break; a separate txBeginner is the smaller diff."
        }
      ],
      "new_objections": [
        {
          "text": "The INSERT-conflict path needs a real-Postgres dbtest in apply_fill_dbtest_test.go, in default and DB_PGBOUNCER exec mode: an uncommitted raw tx holds the applied row, ApplyFill blocks, commit gives conflict with the position unchanged and one re-emit, rollback gives exactly one apply.",
          "blocking": true
        },
        {
          "text": "Every read the fold uses must come from the one FOR UPDATE row inside the tx, replacing the pool calls at portfolio_service.go:455 and :460. foldFn is pure, any orderSide fallback runs before the mutex, and a pgxmock test asserts no query outside the Begin/Commit bracket.",
          "blocking": true
        },
        {
          "text": "ApplyFill must begin its tx through a separate txBeginner interface, leaving queryRower unchanged, and portfolio_fill_sync_race_test.go must be retired or re-pointed and listed in the spec's Files (F-08).",
          "blocking": true
        },
        {
          "text": "The no-deadlock claim needs a service-level dbtest in which one instance runs a real multi-symbol processPositionSync with DeletePositionsNotInSync while another folds a fill on the same position, both finishing under a deadline with no 40P01.",
          "blocking": false
        },
        {
          "text": "Pin pre-check and clear error handling: a pre-check DB error returns an error and never falls through; the clear is keyed by the full PK plus pending_closed IS NOT NULL; a failed clear is a WARN only.",
          "blocking": false
        },
        {
          "text": "Name the post-Unlock emit-ordering residuals next to O-3: a position.updated emitted after a same-process sync overwrote the row, and cross-process emit interleave during the cutover overlap.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-33",
          "how": "Order re-pinned under the D-17 reopen: positionsMu before BEGIN on a new fill, applied INSERT inside the fold tx, pre-check duplicates off the mutex, no ApplyFill hook. The real-Postgres no-deadlock test is tracked as a new objection."
        },
        {
          "id": "O-24",
          "how": "Only an Alpaca 404 wraps ErrOrderNotFound, with retirement after 3 consecutive not-found ticks. An IBKR miss or empty list is an ordinary error and never retires a leg, with an IBKR-miss-never-retires test."
        },
        {
          "id": "O-20",
          "how": "Alpaca legs retire UNKNOWN with a WARN after 3 consecutive 404 ticks. IBKR legs keep polling under the capped budget, named as a residual, unless /sdd-spec finds a definitive single-order not-found response."
        },
        {
          "id": "O-27",
          "how": "The AC-2 proof is apply_fill_dbtest_test.go under //go:build dbtest on testPool and PORTFOLIO_DB_TEST_URL in the existing portfolio-db-test job, with no CI change and no downgrade."
        },
        {
          "id": "O-34",
          "how": "A service-level dbtest case with two PortfolioService instances, each with its own positionsMu, folding the same event to qty 15 is in the plan."
        },
        {
          "id": "O-36",
          "how": "The parent pollFills treats an IBKR id miss as an ordinary failed poll with no retirement or status change, and the trading findings note that trading.fill_poller failed counts may rise."
        }
      ],
      "reopen_petitions": [],
      "reopened": [
        "D-17"
      ]
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-20 — sdd-batch design gate (round 6)

- `/sdd-design fix-position-fold-correctness` (full) halted at its approval gate after round 6 (gate policy: halt). design.md NOT written; status.md unchanged (spec-ready). Register: `debate.md` (D-1..D-33, R-1..R-27, O-1..O-51, P-1..P-4). Round 6 reopened D-4 (amended by D-28), closed O-8, O-17, O-35 and O-37..O-42, and filed P-4 (REOPEN R-2, pending user; the synthesis does not need it).

## Open Threads

- **Approach (round-6 synthesis).** D-1..D-3, D-5..D-16 and D-18..D-27 stand and R-1..R-22 are honoured, R-2 included. Portfolio cutover: migration `019` creates `consumer_applied_events`, `fill_fence`, `fill_cutover` and a row trigger on `portfolio.positions` that is a no-op while `fill_cutover` is empty. The new binary's first boot arms it in one transaction (`LOCK TABLE portfolio.positions IN SHARE ROW EXCLUSIVE MODE`, snapshot each row's key and full-precision `updated_at` into `fill_fence`, insert `fill_cutover(fenced_at)`), and the fill consumer starts only after the cutover row exists (D-29). Once armed, the trigger rejects any writer not identified as fold-v2, so an overlapping old binary stalls without writing. The floor is per row and held in memory: a fill folds iff `recorded_at >= ` the row's fence `updated_at`, or `>= fenced_at` when the row was absent at the fence; otherwise it is acked with zero DB calls (D-30). Fill path (D-23 order): parse, below-floor ack, autocommit pre-check by applied PK, `orderSide` fallback, then park or `positionsMu.Lock`, `BEGIN`, applied `INSERT`, `pg_advisory_xact_lock`, one `SELECT … FOR UPDATE`, pure `pnl.FoldFrom`, `COMMIT`, `Unlock`, then emits, risk and snapshot. A park is persisted as an applied-table row with `outcome='parked'`, so it logs ERROR and counts once (D-31). All fold reads come from the one `FOR UPDATE` row and `ApplyFill` begins through a separate `txBeginner` (D-32, D-33). D-4 is amended (D-28): leg key `bracket-leg:<account_id>:<legID>:<status>:<filledQty>`, and GetPnL's three dedup maps key on `account_id + order_id`. Trading migration `012_bracket_legs` adds `symbol`, `side` and `observed_filled_qty`; `NetFilledQtyBySymbol` gains a `UNION ALL` over `trading.bracket_legs` using `observed_filled_qty`, while `filled_qty` stays the emit cursor. D-3 is not changed. The rest of trading is as round 5 (D-18..D-22, D-26). All tests run in the existing `portfolio-db-test` job with no CI change.
- **Strongest open objection.** O-43, blocking (C-11 provenance): the operator rulings this round designs to (the D-4 reopen with the GetPnL extension, "None — fix in scope", the decision-packet acceptance) reach this step only through the workflow's computed task text. This file records only the D-17 words. The operator's own words must be written here before the design is approved; any ruling not confirmed reverts its part of the design to the round-5 state. Four more blocking objections are open: O-44 (fence writer identification is unverified under real PgBouncer in both directions; needs a dev smoke through the `:25061` pool at pool size 1, else the `writer_rev` / transaction-local `set_config` fallback), O-45 (ruling (c) says "present in `trading.orders`", which conflicts with settled D-3; the operator must confirm the `bracket_legs` UNION reading or grant REOPEN D-3), O-46 (the `012` seed scope and how historical leg quantities are obtained are not pinned; the unrecoverable set goes to the operator), O-47 (two pre-fence cases stay undecidable and must be presented to the operator as a gate item, after `/sdd-spec` evaluates the `portfolio.position.closed` narrowing).
- **Floor status.** No Floor breach. The design is not approvable this round: five blocking objections remain (O-43..O-47), three of which need the operator (O-43, O-45, O-47).
- **Uncovered @AC changes.** `@AC-5` CHANGE is still not covered by an operator decision (O-11); both wordings are designed, and keeping "qty 6" would need a CHANGE to 251 @AC-17 with its own C-16 sign-off. 251 @AC-17 (GetPnL dedup scope), 206 trading @AC-1 (legs in reconciliation) and 294 @AC-56 (parked counted once) are EXTEND, each covered only by a relayed ruling that O-43 requires to be recorded here. @AC-1..@AC-4, 251 @AC-14, 294 @AC-6 and 290 @AC-3 PRESERVE.
- **Operator sign-offs still needed.** The rulings' own words (O-43); the `bracket_legs` reading of ruling (c) or REOPEN D-3 (O-45); the unrecoverable historical leg set (O-46); the pre-fence undecidable cases (O-3, O-47); the `@AC-5` C-16 sign-off (O-11); P-4 (REOPEN R-2, recommended against by the adversary and not needed by this synthesis). Non-blocking and still open: O-48 (sweep every `portfolio.positions` writer, test pools included), O-49 (name the migration that drops the trigger, plus a disarm-before-image-rollback runbook step), O-50 (proposer to confirm the synthesis-adopted items), O-51 (boot-arming proofs), O-30 (analysis AC ids enumerated at `/sdd-spec`).

```sdd-batch-design-state
{
  "round": 6,
  "synth": {
    "approach": "Round-6 synthesis. D-1..D-3, D-5..D-16 and D-18..D-27 stand; R-1..R-22 are honoured (R-2 included: the floor is stamped by the new binary's first boot, not by the migration). D-4 is amended per the relayed operator ruling. D-3 is NOT changed, so ruling (c) is met through `trading.bracket_legs`, pending operator confirmation.\n\nVerified this round\n- `origin/feature/fix-position-fold-correctness:docs/roadmap/features/311-fix-position-fold-correctness/context.md` records only the D-17 words (lines 911, 1076). \"Approve both\", \"None — fix in scope\" and the decision-packet acceptance are in no copy of context.md (working tree, feature branch, main-dev). They reach this step only through the computed task text.\n- `db-migrator` is `kind: PRE_DEPLOY` (`/home/user/xstockstrat/.do/app.yaml:679-681`).\n- `newPool` sets no `application_name` (`services/xstockstrat-portfolio/internal/repository/pool.go:19-35`); neither does `testPool` (`internal/repository/dbtest_helpers_test.go:31`), which DELETEs and INSERTs positions at `:53` and `:69`.\n- `LoadInflightOrders` hydrates NEW/PARTIALLY_FILLED `trading.orders` rows into `s.orders` (`services/xstockstrat-trading/internal/service/trading.go:337-345`).\n- The ledger serialises `recordedAt: new Date(row.recorded_at)` (`services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:472`), i.e. milliseconds.\n\n1. CUTOVER FENCE, armed at first new-binary boot (ruling (a); adversary r6 objection 1 adopted)\n- Portfolio migration `019` creates `consumer_applied_events`, `fill_fence`, `fill_cutover` and a `BEFORE INSERT OR UPDATE OR DELETE` row trigger on `portfolio.positions`. The trigger is a no-op while `fill_cutover` is empty. A failed or rolled-back deploy before any new binary runs therefore leaves the old binary untouched.\n- The new binary's boot runs one transaction: `LOCK TABLE portfolio.positions IN SHARE ROW EXCLUSIVE MODE`; copy each row's key (account after the `alpaca-default` fallback, D-8) and full-precision `updated_at` into `fill_fence`; `INSERT fill_cutover(fenced_at = clock_timestamp()) ON CONFLICT DO NOTHING`; COMMIT. A second new instance finds it armed and only loads it. The fill consumer starts only after the cutover row exists.\n- Once armed, the trigger rejects any writer not identified as fold-v2. The old binary's fill handler errors, `streamEventsFrom` does not advance (`portfolio_service.go:336-337`) and it retries without writing, so an overlapping old and new instance cannot double-apply.\n- Writer identification is NOT settled (see open objections). Primary: `application_name LIKE 'xstockstrat-portfolio/fold-v2%'`, set once in `newPool` via `cfg.ConnConfig.RuntimeParams`. Fallback if the real-PgBouncer smoke fails in either direction: a `writer_rev` column bumped by the new INSERT/UPDATE SQL, with DELETEs carrying a transaction-local `set_config`.\n- Every writer of `portfolio.positions` is swept: `testPool`, `serviceTestPool` (`position_drain_dbtest_test.go:24-45`), scripts, `db-migrator` data statements, the D-6 repair. Test pools use the same app-name constant; both helper files go in the spec's Files (F-08).\n\n2. PER-ROW FLOOR (replaces the single boot-time floor)\n- The consumer loads `fill_fence` and `fenced_at` into memory once at boot. The floor test makes zero DB calls (D-23).\n- A fill on row r folds iff `recorded_at(e) >= fence_updated_at(r)`; if r was absent at the fence the threshold is `fenced_at`. Otherwise it is acked.\n- The fence timestamp is never truncated. The ledger's millisecond `recorded_at` only errs toward acking. A same-millisecond test is required.\n- Both timestamps come from one Postgres server clock; `/sdd-spec` verifies this from the DSNs.\n- Known undecidable pre-fence cases (acked even if the old binary never folded them): a fill on a row something else wrote after the fill was appended, and a fill on a row absent at the fence with `recorded_at < fenced_at`. A late commit below `fenced_at` falls in one of these. `/sdd-spec` must evaluate the adversary's narrowing (use the old binary's last `portfolio.position.closed` `recorded_at` as the threshold for a closed-and-absent row, `portfolio_service.go:469-470`). What remains goes to the operator as a gate item, not as a design-accepted residual.\n\n3. PORTFOLIO FILL PATH (D-23 order, park step pinned)\n- Order: parse → below-floor `errFillAcked` (zero DB calls) → autocommit pre-check by applied PK → `orderSide` fallback → park or `positionsMu.Lock` → BEGIN → applied INSERT → `pg_advisory_xact_lock` → one `SELECT … FOR UPDATE` → `pnl.FoldFrom` → COMMIT → Unlock → emits, risk, snapshot (D-24).\n- Pre-check hit on an applied row: re-emit `pending_closed` under `position.closed:<STORED event_id>` (D-13), clear keyed by full PK plus `pending_closed IS NOT NULL`, failed clear is a WARN, return `errFillAcked`. Pre-check hit on a parked row: `errFillAcked`, DEBUG log, no ledger query. A pre-check DB error returns an error and never falls through.\n- Park (ruling (b)): `consumer_applied_events` gains `outcome text NOT NULL DEFAULT 'applied'` and nullable `parked_reason`. On `ErrFillUnattributable`, an autocommit `INSERT … outcome='parked' ON CONFLICT DO NOTHING RETURNING`. ERROR \"event parked\" and the `parked` count fire only when the insert returns a row. A DB error on the park insert returns an error and does not count `parked`. `observed()`'s D-12 mapping is unchanged. Redelivery: a runbook step deletes the parked row and the next boot retries.\n- Round-5 fixes, confirmed by the proposer: every fold read comes from the one `FOR UPDATE` row (the pool reads at `portfolio_service.go:455` and `:460` are deleted); `foldFn` is pure; `ApplyFill` begins through a separate `txBeginner` and `queryRower` (`portfolio_repo.go:23-27`) is unchanged; `portfolio_fill_sync_race_test.go` is re-pointed at `FillApplied`/`ApplyFill` over pgxmock, `interleaveDB` is deleted, and the file is listed in the spec's Files.\n\n4. D-4 AMENDMENT (relayed operator ruling)\n- Leg key `bracket-leg:<account_id>:<legID>:<status>:<filledQty>`, passed as the `appendLedgerEvent` key parameter (R-5).\n- GetPnL's `filledOrderIDs`, `latest` and `partialOrder` maps (`portfolio_service.go:993-1013`) key on `account_id + \"\\x00\" + order_id`.\n- Two-account same-leg-id tests at the ledger-key level and the GetPnL level. The `/sdd-spec` payload-history grep for a consistent `account_id` per order is a required step.\n\n5. LEG FILLS IN RECONCILIATION (ruling (c), via `bracket_legs`; D-3 stands)\n- Trading migration `012_bracket_legs` adds `symbol`, `side` and `observed_filled_qty`. `ActivateBracket` writes symbol and `side = oppositeSide` (`trading.go:3463`) in the `trading.orders` encoding.\n- `NetFilledQtyBySymbol` (`trading_repo.go:171-186`) gains `UNION ALL` over `trading.bracket_legs` using `observed_filled_qty`, written on every observation. `filled_qty` stays the emit cursor, advanced only after a nil keyed append. A ledger outage therefore does not make reconciliation lag broker truth.\n- `BASELINE_RETIRED` legs store their observed cumulative qty with no emit (R-7, R-12 hold).\n- Not yet pinned: the `012` seed scope and how historical leg quantities are obtained (see open objections).\n\n6. @AC-5, both variants (sign-off pending)\n- Amended wording: `order.partially_filled` with `filled_qty 4`, then `order.filled` qty 10 at cumulative average 110; position 0, realized 100. Consistent with 251 @AC-17.\n- If the operator keeps \"qty 6\": GetPnL reads 6 as the order total (realized 60) and the live fold leaves qty 4. Honouring it needs a CHANGE to 251 @AC-17 for leg ids (fold by cumulative `filled_qty`, live fold consumes leg partials) with its own C-16 sign-off. The emitter is the same; only the `qty` field differs.\n\n7. TRADING — unchanged from round 5 (D-18..D-22, D-26).\n\nTESTS (all in the existing `portfolio-db-test` job, no CI change)\n- `apply_fill_dbtest_test.go`, default and `DB_PGBOUNCER` exec mode: one order to two pools applies once; conflict path (uncommitted raw tx holds the applied row, `ApplyFill` blocks, commit gives conflict with unchanged position and one re-emit, rollback gives exactly one apply).\n- Service level: two `PortfolioService` instances fold one event to qty 15; real multi-symbol `processPositionSync` with `DeletePositionsNotInSync` versus a fill, no `40P01`.\n- Fence: an unidentified pool is rejected on INSERT, UPDATE and DELETE once armed and admitted while unarmed; a statement blocked on the arming lock is rejected after it; arming twice is idempotent.\n- Floor: a fill newer than its row's fence folds once; an older one is acked; a row absent at the fence uses `fenced_at`; same-millisecond case.\n- Park: a parked fill is not re-parked and issues no ledger query on the next consumer start.\n- pgxmock: no query outside Begin/Commit on the fresh path; mutex held gives only the pre-check SELECT.\n\nBUILD ORDER\n1. Migrations `019` and `012` (re-check numbers against feature 318).\n2. `newPool` writer identification, boot arming, test-pool sweep.\n3. `observed()` branches, `FillApplied`, `ApplyFill`, `txBeginner`.\n4. Fold rewrite with in-tx reads and the D-10 flip; per-row floor; persisted park.\n5. dbtests.\n6. Broker `ErrOrderNotFound`, IBKR id-match.\n7. `ActivateBracket` with symbol/side, both UNIONs, keyed append, observer, GetPnL composite key.\n8. Docs and runbook: disarm-before-image-rollback step, parked-row redelivery step, the follow-up migration that drops the trigger.",
    "open_objections": [
      {
        "text": "Provenance gate (C-11): the operator rulings (D-4 reopen with the GetPnL extension, 'None — fix in scope', the decision-packet acceptance) reach this step only through the computed task text. context.md on origin/feature/fix-position-fold-correctness records only the D-17 words. This synthesis designs to them as relayed; the orchestrator must write the operator's own words into context.md before the design is approved. If any is not confirmed, the matching part (sections 1-2, 3 park, 4, 5) reverts to the round-5 state.",
        "blocking": true
      },
      {
        "text": "Fence writer identification is unverified under PgBouncer in both directions. Outage direction: application_name_add_host would break an equality match (use LIKE 'xstockstrat-portfolio/fold-v2%'). Silent direction: in transaction pooling an old-binary client that never sent application_name may inherit fold-v2 from a shared server connection, so the fence admits it. The DB_PGBOUNCER dbtest covers pgx exec mode only. Required before approval: a dev smoke through the real :25061 pool with pool size 1 — a tagged write, then an untagged write on the same backend that must be rejected. If not proven, use the writer_rev / transaction-local set_config fallback.",
        "blocking": true
      },
      {
        "text": "O-13 / ruling (c): 'present in trading.orders' is met here through a NetFilledQtyBySymbol UNION over trading.bracket_legs because settled D-3 forbids leg rows in trading.orders. The literal reading would route legs through LoadInflightOrders (trading.go:337-345), pollFills, applyBrokerOrderStatus and maybeSubmitBracket, bracketing an exit and double-emitting. The operator must confirm the bracket_legs reading or grant REOPEN D-3.",
        "blocking": true
      },
      {
        "text": "Ruling (c) completeness: the UNION covers only legs the observer tracks. Not covered: legs of brackets exited or canceled before cutover, leg ids already blanked by resizeBracket (trading.go:3612), and IBKR historical legs that never return. Pin the 012 seed scope (every order_brackets row with a leg id, any status), state how a historical leg's filled qty is obtained (Alpaca GetOrder within the cap; IBKR none), and present the unrecoverable set to the operator.",
        "blocking": true
      },
      {
        "text": "O-3 / ruling (a): the per-row floor cannot decide two pre-fence cases against an opaque old binary — a fill on a row written by something else after the fill was appended, and a fill on a row absent at the fence with recorded_at < fenced_at (this includes late commits below fenced_at). The operator rejected this as a residual, so the orchestrator must present it. /sdd-spec must first evaluate narrowing a closed-and-absent row's threshold to the old binary's last portfolio.position.closed recorded_at (portfolio_service.go:469-470).",
        "blocking": true
      },
      {
        "text": "O-11: the C-16 sign-off for the @AC-5 amendment is still pending with the operator. Both variants are designed; 'qty 6' would need a CHANGE to 251 @AC-17 with its own sign-off. Does not block the rest of the design.",
        "blocking": false
      },
      {
        "text": "Sweep every writer of portfolio.positions for the armed fence: testPool (dbtest_helpers_test.go:31,53,69), serviceTestPool (position_drain_dbtest_test.go:38-45), scripts, db-migrator data statements, the D-6 repair and manual psql. Test pools take the same writer constant; both helper files are listed in the spec's Files. State whether the migrator role is admitted.",
        "blocking": false
      },
      {
        "text": "The trigger outlives the cutover (C-18). Name the follow-up migration that drops it once cutover is verified, or record it as a permanent invariant in the portfolio CLAUDE.md. Also name the post-arming rollback hazard: a pre-019 image run after arming cannot write positions until disarmed, so the runbook needs a disarm-before-image-rollback step.",
        "blocking": false
      },
      {
        "text": "Adopted in this synthesis from adversary r6, proposer to confirm: observed_filled_qty (written on every observation) feeds the reconciliation UNION while filled_qty stays the emit cursor; the fence timestamp is never truncated, with a same-millisecond test; park order is below-floor, pre-check, orderSide, park, and a park-insert DB error returns an error without counting parked; the @AC-5 wording says 'filled_qty 4'.",
        "blocking": false
      },
      {
        "text": "Boot arming needs its own proofs: the app role can take SHARE ROW EXCLUSIVE on portfolio.positions; a statement blocked on the arming lock sees the fence armed when it resumes; two new instances arming concurrently produce one cutover row; and the cost of the per-row armed check on every positions write is stated.",
        "blocking": false
      },
      {
        "text": "O-30: the affected analysis ACs are still not listed. The proposer named order-snapshots-pnl-patterns.feature and fix-python-loop-supervision.feature as position.closed readers; their AC ids must be enumerated at /sdd-spec, and the D-10 flip-short window residual stays named.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "251 @AC-17",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "251 @AC-14",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "206 trading @AC-1",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "294 @AC-56",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "294 @AC-6",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "290 @AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Arming the fence inside the PRE_DEPLOY migration 019 (proposal r6). Lost: db-migrator runs before any service restarts (.do/app.yaml:679-681) and DO rolls back images, not the DB, so a failed deploy would leave the old binary unable to write positions until a manual down.",
      "Equality match on application_name (proposal r6). Lost: PgBouncer application_name_add_host appends a suffix, which would reject the new binary; a prefix LIKE is used and the whole mechanism stays gated on a real-PgBouncer smoke.",
      "A single boot-time floor timestamp for all rows (rounds 1-5). Lost: it cannot close fills never folded before the first new boot, late commits, or clock skew, which the operator made requirements.",
      "A two-release cutover: release A acks without folding, release B folds (adversary r6). Lost: it adds a deploy-ordering dependency, which is the runbook reliance the operator rejected, and doubles the deploy.",
      "Feeding the reconciliation UNION from filled_qty, the emit cursor (proposal r6). Lost: under D-15 a ledger outage stops leg emits, so NetFilledQtyBySymbol would lag broker truth and could halt the account; observed_filled_qty is used instead.",
      "Re-parking with an ERROR on every boot (D-12 as first wired). Lost: the operator required that a parked post-floor fill not re-park; the park is persisted as an applied-table outcome.",
      "REOPEN R-2 to stamp the floor in the migration (proposal r6 petition). Not adopted: boot arming stamps the floor at the new binary's first boot, so R-2 need not be reopened.",
      "Designing the pre-fence undecidable cases in as an accepted residual (proposal r6). Lost: the operator rejected the residuals, so the bound goes to the operator as a gate item."
    ],
    "open_risks": [
      "If the fence's writer identification fails in the silent direction (PgBouncer leaks application_name to old-binary clients), the old binary keeps folding and an overlap fill double-applies with no error.",
      "If it fails in the outage direction, the armed trigger rejects the new binary too: a full portfolio positions write outage at first boot.",
      "After arming, an image rollback to a pre-019 binary cannot write positions until someone disarms the fence.",
      "During the overlap the old binary's sync, deregistration and bracket-update writes fail; they heal only through the new binary's replay (290 @AC-3).",
      "Two pre-fence cases stay undecidable and are acked: a fill on a row written by something else after the fill was appended (qty is broker-true from sync, the realized delta is lost), and a fill on a row absent at the fence.",
      "The fence and floor assume ledger and portfolio share one Postgres server clock, and that nothing outside the portfolio binary writes portfolio.positions.",
      "Leg fills from brackets exited before cutover, ids blanked by resizeBracket, and IBKR historical legs cannot be counted in NetFilledQtyBySymbol, so reconciliation may still mismatch for those symbols.",
      "If the composite GetPnL key is applied, a historical order whose partial and full fills carried different account_id values stops being deduplicated; the /sdd-spec history grep is the only check.",
      "A parked fill is retried only after a manual delete of its parked row.",
      "A fill transaction can still wait server-side on the applied-row conflict or on FOR UPDATE, holding 1 of 2 client connections and positionsMu.",
      "The pre-check has a TOCTOU window covered only by the in-tx INSERT conflict path, so the conflict-path dbtest is load-bearing.",
      "A position.updated can be emitted after a same-process sync has overwritten the row (emits run after Unlock).",
      "IBKR legs the broker has forgotten are polled forever unless /sdd-spec finds a definitive single-order not-found response.",
      "Legs partially filled at cutover are BASELINE_RETIRED, so realized P&L for their post-cutover remainder is lost.",
      "Boot replay re-walks every post-floor fill (1 round trip each) and consumer_applied_events has no retention.",
      "A leg id is lost from tracking if the ActivateBracket tx fails; it is alerted, but its exit fill never folds.",
      "Neither broker adapter populates BrokerOrder.Fees, so parent and leg fee totals understate.",
      "Migration numbers 019 and 012 may collide with feature 318.",
      "OQ-2 (repair of already-inflated accumulators) is out of scope, and instance_count must stay 1."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-08",
      "C-10",
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "F-04",
      "F-06",
      "F-07",
      "F-08",
      "P-02",
      "P-03",
      "P-04",
      "PLAT-N1"
    ],
    "rationale": "No Floor breach, but the design is not approvable this round: five blocking items remain, three of which need the operator.\n\n**Provenance.** I checked all three copies of `context.md`. Only the D-17 words are recorded. The other rulings exist only in the computed task text, which I cannot verify. I designed to them as relayed and recorded D-4 as reopened on the same basis the D-17 reopen was taken last round (relayed operator words that name the item). The orchestrator must put the operator's own words in `context.md` before approval; that is the first blocking item.\n\n**What I took from each side.**\n- **Per-row floor (proposer):** kept. Both sides agree it is sound.\n- **Boot arming (adversary):** adopted. I confirmed `db-migrator` is `PRE_DEPLOY`, so a migration-armed trigger turns a failed deploy into a write outage. Boot arming also keeps R-2 intact, so the proposer's REOPEN R-2 is not needed.\n- **Writer identification:** not settled. Neither binary sets `application_name` today and the exec-mode dbtest proves nothing about real PgBouncer. It stays blocking behind a dev smoke, with the `writer_rev` fallback named.\n- **Ruling (c):** the literal text conflicts with settled D-3. I kept D-3 and the `bracket_legs` UNION, and left O-13 open for the operator to confirm the reading or reopen D-3. Historical leg coverage is also unpinned.\n- **Pre-fence undecidable cases:** the operator rejected residuals, so this goes back as a gate item, with the adversary's `position.closed` narrowing to evaluate first.\n- **Smaller adversary points adopted:** `observed_filled_qty`, never truncating the fence, park ordering, the writer sweep including test pools, and the @AC-5 wording.\n\n**Closed this round:** O-17 and O-35 (D-4 amendment with the GetPnL composite key), O-8 (persisted park), O-37, O-38, O-39 (confirmed by the proposer), O-40, O-41, O-42.\n\n**Still open:** O-3, O-13, O-11, O-30, plus the new items above.\n\n**Business rules.** 251 @AC-17 (GetPnL dedup scope), 206 trading @AC-1 (legs in reconciliation) and 294 @AC-56 (parked counted once) are EXTEND, each sanctioned by a relayed ruling. @AC-5 stays CHANGE and uncovered.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "D-4 amended, superseding D-4's key: the leg ledger idempotency key is bracket-leg:<account_id>:<legID>:<status>:<filledQty>, and GetPnL's filledOrderIDs, latest and partialOrder maps key on account_id + order_id. Two-account same-leg-id tests at the ledger-key and GetPnL levels are required, and the /sdd-spec payload-history grep for a consistent account_id per order is a required step. The rest of D-4 (order_id and stream key = leg id, side always set) stands.",
          "evidence": "ledger 002_idempotency_keys.up.sql:10; ibkr.go:343; portfolio_service.go:993-1013; P-1, P-2; relayed operator ruling 2026-11-20 ('Approve both'); proposal r6 item 5; adversary r6 did not contest"
        },
        {
          "text": "The cutover fence is armed by the new binary's first boot, not by the migration. Migration 019 creates a positions row trigger that is a no-op while fill_cutover is empty. Boot runs one tx: LOCK TABLE portfolio.positions IN SHARE ROW EXCLUSIVE MODE, snapshot fill_fence, INSERT fill_cutover(fenced_at) ON CONFLICT DO NOTHING. The fill consumer starts only once the cutover row exists. How a fold-v2 writer is identified is not part of this decision.",
          "evidence": ".do/app.yaml:679-681 (PRE_DEPLOY migrator); portfolio_service.go:336-337 (old binary stalls on a handler error); adversary r6 objection 1; relayed operator ruling (a); R-2 honoured"
        },
        {
          "text": "The fill floor is per row and loaded into memory once at boot: a fill folds iff recorded_at >= the row's fence updated_at, or >= fenced_at when the row was absent at the fence; otherwise it is acked with zero DB calls. The fence timestamp is never truncated.",
          "evidence": "portfolio_repo.go:67 (upsert sets updated_at = NOW()); ledger 001:20 (recorded_at DEFAULT NOW()); ledgerServiceImpl.ts:472 (millisecond recordedAt); D-23; proposal r6 item 2; adversary r6 called it sound and contested only precision and the undecidable cases"
        },
        {
          "text": "A park is persisted: consumer_applied_events gains outcome and parked_reason, and ErrFillUnattributable writes an autocommit parked row with ON CONFLICT DO NOTHING RETURNING. ERROR 'event parked' and the parked count fire only when the insert returns a row. The fill-path order is below-floor, pre-check, orderSide, then park or mutex; a pre-check hit on a parked row returns errFillAcked at DEBUG. A park-insert DB error returns an error. D-12's observed() mapping is unchanged.",
          "evidence": "portfolio_service.go:185-190,231-242; D-12; R-14 (a park writes no position state); relayed operator ruling (b); proposal r6 item 3; adversary r6 objection 10"
        },
        {
          "text": "Every read the fold uses comes from the single FOR UPDATE row inside the tx; the GetRealizedAccum and GetFeesAccum pool reads are removed and foldFn is pure. ApplyFill begins its tx through a separate txBeginner interface. portfolio_fill_sync_race_test.go is re-pointed at FillApplied/ApplyFill over pgxmock, interleaveDB is deleted, and the file is listed in the spec's Files.",
          "evidence": "portfolio_service.go:455,460; portfolio_repo.go:23-27; R-22; proposal r6 item 7 confirmed; adversary r6 did not contest"
        },
        {
          "text": "Pre-check and clear error handling: a pre-check DB error returns an error and never falls through; the pending_closed clear is keyed by the full PK plus pending_closed IS NOT NULL; a failed clear is a WARN only. The dbtest set includes the INSERT-conflict case in default and DB_PGBOUNCER exec mode and the sync-versus-fill no-40P01 service case.",
          "evidence": "D-21; D-27; proposal r6 item 7 (O-37, O-40, O-41 adopted); adversary r6 did not contest"
        }
      ],
      "new_rejected": [
        {
          "text": "Arming the cutover fence inside the PRE_DEPLOY migration",
          "why": "db-migrator runs before any service restarts and DO rolls back images, not the DB (.do/app.yaml:679-681), so a failed or rolled-back deploy would leave the old binary unable to write positions."
        },
        {
          "text": "An equality match on application_name as the fence test",
          "why": "PgBouncer application_name_add_host appends a host suffix, which would reject the new binary."
        },
        {
          "text": "A single boot-time floor timestamp for all rows",
          "why": "It cannot close fills never folded before the first new boot, late commits or clock skew, which the operator made design requirements."
        },
        {
          "text": "A two-release cutover (release A acks without folding, release B folds)",
          "why": "It adds a deploy-ordering dependency, which is the runbook reliance the operator rejected, and doubles the deploy."
        },
        {
          "text": "Using filled_qty, the emit cursor, as the quantity in the NetFilledQtyBySymbol UNION",
          "why": "Under D-15 a ledger outage stops leg emits, so reconciliation would lag broker truth and could halt the account."
        }
      ],
      "new_objections": [
        {
          "text": "Provenance gate (C-11): the operator rulings behind the D-4 reopen, the in-scope residuals and the decision-packet acceptance are relayed only through the computed task text; context.md on the feature branch records only the D-17 words. The operator's own words must be written to context.md before the design is approved.",
          "blocking": true
        },
        {
          "text": "Fence writer identification is unverified under PgBouncer in both directions (suffix breaks the match; a shared server connection may leak application_name to an old-binary client). Require a dev smoke through the real :25061 pool at pool size 1, with a tagged write followed by an untagged write that must be rejected; otherwise use the writer_rev / transaction-local set_config fallback.",
          "blocking": true
        },
        {
          "text": "Ruling (c) says 'present in trading.orders', which conflicts with settled D-3. The operator must confirm the bracket_legs UNION reading or grant REOPEN D-3 (hazard of the literal reading: LoadInflightOrders, pollFills, maybeSubmitBracket on a leg row, trading.go:337-345,1903,1921).",
          "blocking": true
        },
        {
          "text": "Leg coverage in NetFilledQtyBySymbol is limited to legs the observer tracks. Pin the 012 seed scope (every order_brackets row with a leg id, any status), state how historical leg quantities are obtained per broker, and present the unrecoverable set (resize-blanked ids, IBKR historical legs) to the operator.",
          "blocking": true
        },
        {
          "text": "The pre-fence undecidable cases (a fill on a row written by something else after the fill; a fill on a row absent at the fence below fenced_at, including late commits) must be presented to the operator as a gate item, after /sdd-spec evaluates narrowing the absent-row threshold to the last portfolio.position.closed recorded_at.",
          "blocking": true
        },
        {
          "text": "Sweep every writer of portfolio.positions for the armed fence: testPool, serviceTestPool, scripts, db-migrator data statements, the D-6 repair and manual psql. Test pools use the same writer constant and both helper files go in the spec's Files.",
          "blocking": false
        },
        {
          "text": "Name the follow-up migration that drops the fence trigger after cutover (or record its permanence in the portfolio CLAUDE.md), and add a disarm-before-image-rollback runbook step for the post-arming rollback hazard.",
          "blocking": false
        },
        {
          "text": "Proposer to confirm the synthesis-adopted items: observed_filled_qty feeds the reconciliation UNION while filled_qty stays the emit cursor; a same-millisecond fence test; the @AC-5 wording 'filled_qty 4'.",
          "blocking": false
        },
        {
          "text": "Boot arming needs proofs: the app role can take SHARE ROW EXCLUSIVE on portfolio.positions; a statement blocked on the arming lock is rejected when it resumes; two instances arming concurrently produce one cutover row; and the per-write cost of the armed check is stated.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-17",
          "how": "D-4 amended under the relayed operator ruling: account-scoped leg key bracket-leg:<account_id>:<legID>:<status>:<filledQty>, with two-account same-leg-id tests. Recording the ruling in context.md is tracked as a new objection."
        },
        {
          "id": "O-35",
          "how": "The GetPnL composite dedup key is an operator-approved extension of the product spec's scope, and the /sdd-spec payload-history grep is a required step."
        },
        {
          "id": "O-8",
          "how": "A park is persisted as an applied-table outcome; a parked fill logs ERROR and counts parked once, later boots ack it at DEBUG, and a runbook step deletes the row to redeliver."
        },
        {
          "id": "O-37",
          "how": "Proposer confirmed the INSERT-conflict dbtest in apply_fill_dbtest_test.go in default and DB_PGBOUNCER exec mode."
        },
        {
          "id": "O-38",
          "how": "Proposer confirmed: all fold reads from the one FOR UPDATE row, pool reads at :455 and :460 deleted, foldFn pure, orderSide before the mutex, pgxmock asserts no query outside Begin/Commit."
        },
        {
          "id": "O-39",
          "how": "Proposer confirmed: ApplyFill uses a separate txBeginner, queryRower is unchanged, and portfolio_fill_sync_race_test.go is re-pointed over pgxmock and listed in the spec's Files."
        },
        {
          "id": "O-40",
          "how": "The sync-versus-fill no-40P01 service-level dbtest is adopted."
        },
        {
          "id": "O-41",
          "how": "Pre-check error returns an error, the clear is keyed by full PK plus pending_closed IS NOT NULL, and a failed clear is a WARN."
        },
        {
          "id": "O-42",
          "how": "The same-process sync-after-fold position.updated ordering is named as a residual. The cross-process half is removed by the fence, whose verification is tracked as a new objection."
        }
      ],
      "reopen_petitions": [
        {
          "target": "R-2",
          "evidence": "Proposer r6: a 019 fence trigger stops the pre-019 binary writing portfolio.positions from the migration's lock instant (portfolio_service.go:336-337; portfolio_repo.go:64-69), so R-2's premise that the old binary still folds after the migration no longer holds. No fence was on record before. The adversary agrees the evidence is new but recommends against reopening: the boot-armed fence adopted in this synthesis stamps the floor at first boot, so R-2 need not be reopened.",
          "is_new": true
        }
      ],
      "reopened": [
        "D-4"
      ]
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-20 — operator rulings recorded by the orchestrator (verbatim)

Written by the orchestrating session itself, not by a workflow step. Each entry quotes the question put to the
operator and the operator's own answer. These are operator consent (C-11, C-16); later rounds treat them as fixed.

- **Decision packet (round 3 gate).** Packet item, as shown to the operator: "311 (Rec steer): reopen D-4 and scope
  the leg key by account, `bracket-leg:<account_id>:<legID>:…`. The new evidence is that GetPnL also suppresses other
  accounts' partial fills. Bind the synthesis's other 5 fixes. Also choose: run the real-Postgres test in CI (Rec), or
  downgrade it." Operator: "Let's go with the recommendations in the decision packet". Effect: REOPEN D-4 granted;
  the AC-2 two-writer proof runs as a real-Postgres test in CI, no downgrade.
- **D-17.** Question: reopen D-17 for the cross-process race-conflict case only, or accept the idle-in-transaction
  cost. Operator: "Do your best to prevent the race condition and fix the bug report", then, to the orchestrator's
  reading (fill path takes `positionsMu` before BEGIN; a cross-process duplicate may take the mutex): "Yes, that's
  what I meant for 311". Effect: REOPEN D-17 granted, narrowly.
- **D-4 scope extension (O-17, O-35).** Question: "the account-scoped bracket-leg key (the D-4 reopen you accepted in
  the decision packet) also requires GetPnL's three de-duplication maps to key on account_id + order_id instead of the
  bare order id. That edits GetPnL, which the bug's product spec did not list in scope. … Do you approve this scope
  extension?" Operator selected: "Approve both (Recommended)". Effect: P-1/P-2 'user reopened'; composite GetPnL key
  approved as a scope extension; two-account same-leg-id test required.
- **Residuals (O-3, O-8, O-13).** Question: "Feature 311 carries three residuals the design does not fix and wants
  accepted: (a) first-deploy cutover must be stop-then-start, as a runbook step, because old and new instances
  overlapping could double-apply a fill; (b) a parked post-cutover fill re-parks with an ERROR log on every boot until
  handled; (c) bracket-leg fills stay absent from trading.orders and NetFilledQtyBySymbol. Accept these as recorded
  residuals?" Operator selected: "None — fix in scope". Effect: all three are design requirements.
- **@AC-5 amendment — NOT signed off.** Question put; operator answered "Show me the full examples". The examples
  were shown; no sign-off has been given. `@AC-5` stays `covered_by_operator_decision = false` (O-11 open).
- **Round cap.** Operator: "Override round cap until design is sound" — debates may run past 5 rounds until the
  adversary rates the design sound; a sound design with every C-16 change covered is approved on the operator's
  behalf. Round 6 ran under this authorisation.

## Session 2026-11-20 — operator rulings after round 6, recorded by the orchestrator (verbatim)

Written by the orchestrating session itself. Each entry quotes the question and the operator's own selection.

- **@AC-5 — C-16 sign-off GIVEN.** Question: "311 AC-5 (examples shown above): sign off the amended wording, where
  the bracket leg's full-fill event carries qty 10 at the cumulative average price instead of qty 6?" Operator
  selected: "Sign off (Recommended)". `@AC-5` is covered by an operator decision; O-11 closes. Amended Then: "the
  ledger holds an order.partially_filled event with qty 4 and an order.filled event with qty 10 at average fill price
  110 for that leg".
- **Cutover (former residual (a), O-3) — stop-then-start on staging.** Question: the write-fence trigger's writer
  identification is unproven through PgBouncer and two pre-cutover cases stay undecidable; production has never
  launched, so the cutover happens once, on staging; how should the first deploy be made safe? Operator selected:
  "Stop-then-start on staging (Recommended)". This REVERSES "None — fix in scope" for item (a) only: no
  `portfolio.positions` trigger, no `fill_fence`/`fill_cutover`, no application_name fence. The cutover is one
  numbered runbook step with a recorded result (stop portfolio, deploy, start); the overlap case cannot occur. The
  remaining O-3 pre-cutover cases are accepted as the consequence of this choice.
- **Bracket-leg fills in reconciliation (former residual (c), O-13) — via `trading.bracket_legs`.** Question: D-3
  forbids leg rows in `trading.orders`; the design makes `NetFilledQtyBySymbol` include legs from
  `trading.bracket_legs`; is that what "fix in scope" meant? Operator selected: "Via bracket_legs (Recommended)".
  D-3 stands; no REOPEN D-3.
- **Historical legs — forward-only.** Question: legs of brackets exited/canceled before cutover, ids blanked by a
  resize and old IBKR legs cannot all be recovered; how should history be handled? Operator selected: "Forward-only
  (Recommended)". Track legs from cutover on; the unrecoverable historical set is a recorded, accepted gap.
- **Former residual (b), O-8** stays in scope as ruled ("None — fix in scope"): a parked fill must not re-park with
  an ERROR on every boot.

## Session 2026-11-20 — sdd-batch design gate (round 7)

- `/sdd-design fix-position-fold-correctness` (full) halted at its approval gate after round 7 (gate policy: halt). design.md NOT written; status.md unchanged (spec-ready). Register: `debate.md` (D-1..D-38, R-1..R-30, O-1..O-57, P-1..P-7). Round 7 reopened D-29, D-30 and R-25 on the operator steer (superseded by D-34/D-35), closed O-3, O-11, O-13, O-43..O-45 and O-47..O-51, and filed P-5..P-7 (REOPEN R-25, D-29, D-30; pending user).

## Open Threads

- **Approach (round-7 synthesis).** The write fence is removed under the operator ruling (`context.md:1535-1541`): D-29 and D-30 are withdrawn, and D-1..D-3, D-5..D-16, D-18..D-28 and D-31..D-33 stand. Portfolio migration `019` creates only `consumer_applied_events` and `consumer_floors(consumer PK, floor_recorded_at)`; no trigger, no `fill_fence`/`fill_cutover`, no `application_name` (D-34). The floor is one row per consumer, never written by the migration (R-2 honoured): every boot runs `INSERT … date_trunc('milliseconds', clock_timestamp()) ON CONFLICT DO NOTHING`, then loads and caches it before the fill consumer starts; a below-floor fill is acked with zero DB calls, a same-millisecond fill folds, and a stamp or load error keeps the consumer from starting (D-35). The fill path is unchanged from D-23, D-24 and D-31..D-33. Cutover is a numbered stop-then-start runbook step with a recorded result per database (floor value, boot log line, count of `order.filled` rows between stop and floor); window fills are acked as the operator-accepted consequence (D-36). Bracket-leg fills reach reconciliation through `trading.bracket_legs` (`symbol`, `side`, `observed_filled_qty`) in a `NetFilledQtyBySymbol` `UNION ALL`, with `filled_qty` staying the emit cursor and D-3 standing (D-37). `@AC-5` uses the signed-off wording: `order.partially_filled` qty 4, then `order.filled` qty 10 at average 110, position 0, realized 100 (D-38). The trading `012_bracket_legs` seed predicate and the cutover procedure itself are NOT settled.
- **Strongest open objection.** O-46, blocking (seed scope): the proposed seed predicate names an "exited" bracket state that does not exist (status is SMALLINT 0-6; nothing moves a bracket off ACTIVE when a leg fills), so "not CANCELED or FAILED" seeds the historical set the operator excluded, and old IBKR legs then sit in the D-11 capped GetOrder fallback forever and starve new legs, putting AC-4 at risk. The proposer must pin the predicate by numeric status code, isolate seeded legs from the new-leg budget (or use a first-tick broker-side seed) and restate the accepted gap to match the code; retiring a seeded leg on its first ordinary miss is locked R-10. Two more blocking objections are open: O-52 (the stop-then-start step cannot be executed as written, because a main-dev push auto-deploys both the DO app `xstockstrat-staging` and the homelab staging VM and a DO deploy is rolling; the step must name each target, make "portfolio stopped" a merge precondition on the integration PR and state a verified way to stop the component on DO, or the operator scopes DO dev as disposable) and O-53 (an automatic image rollback after the floor is stamped lets the old binary fold above the floor without applied rows, so the next roll-forward folds again; needs a runbook rule, a statement of how the rollback is noticed, and a boot-time detection or a recorded reason for none).
- **Floor status.** No Floor breach. The design is not approvable this round: three blocking objections remain (O-46, O-52, O-53).
- **Uncovered @AC changes.** None. `@AC-5` CHANGE is now covered by the operator's C-16 sign-off (`context.md:1530-1534`). 251 @AC-17 (GetPnL dedup scope), 206 trading @AC-1 (legs in reconciliation) and 294 @AC-56 (parked counted once) are EXTEND, each covered by a recorded ruling. @AC-1..@AC-4, 251 @AC-14, 206 trading @AC-2, 294 @AC-6 and 290 @AC-3 PRESERVE.
- **Operator sign-offs still needed.** The verdicts on P-5..P-7 (REOPEN R-25, D-29, D-30), recorded as "user reopened" citing `context.md:1535-1541`, and P-4 as withdrawn (O-56; the phrase "return to the simplest floor" is only in the computed task text, not in this file); how portfolio is stopped on DO App Platform, or DO dev scoped as disposable (O-52); confirmation that the production portfolio and ledger tables hold no fold history, or the cutover step extended to the first production deploy (O-55). Non-blocking and still open: O-54 (evaluate a workable stamp-the-floor-at-the-stop variant, or record why the boot stamp alone is kept), O-57 (proposer to confirm the adopted adversary items: dbtests pre-insert the floor and assert an applied row, `bracket_legs.side` through the `UpsertOrder` helper, no generic floor API), O-30 (enumerate the affected analysis AC ids at `/sdd-spec`).

```sdd-batch-design-state
{
  "round": 7,
  "synth": {
    "approach": "Round-7 synthesis. The write fence is removed under the operator ruling. D-1..D-3, D-5..D-16, D-18..D-28 and D-31..D-33 stand. D-29 and D-30 are withdrawn. R-2 is honoured: the migration never writes the floor. All paths are under `/home/user/xstockstrat/.claude/worktrees/orch-311`.\n\nVerified this round\n- The operator rulings are recorded verbatim at `docs/roadmap/features/311-fix-position-fold-correctness/context.md:1496-1550`.\n- Bracket status has no exited state. It is a SMALLINT, 0=NONE to 6=FAILED (`services/xstockstrat-trading/migrations/005_broker_accounts_halted.up.sql:17`; `services/xstockstrat-trading/internal/service/trading.go:3452-3458`).\n- A main-dev push deploys two staging targets: the DO app `xstockstrat-staging` and the homelab staging VM (`docs/patterns/ci-overview.md:58,60`). The homelab VM rolls back on its own if a release is unhealthy (`:76`).\n\n1. PORTFOLIO MIGRATION `019_fill_applied_events` (additive, with `.down.sql`)\n- `portfolio.consumer_applied_events`: PK `(consumer, user_id, account_id, order_id)`; `event_id`; nullable `pending_closed`; `outcome` ('applied' or 'parked'); nullable `parked_reason`; `applied_at` (D-8, D-9, D-31).\n- `portfolio.consumer_floors(consumer PRIMARY KEY, floor_recorded_at timestamptz NOT NULL)`. Only `order_fill` uses it. No generic floor API is built around it (C-18).\n- No trigger, no `fill_fence`, no `fill_cutover`, no `application_name`.\n\n2. FLOOR (single per consumer; needs R-25 reopened, see register)\n- On every boot, before the fill consumer starts: `INSERT … ('order_fill', date_trunc('milliseconds', clock_timestamp())) ON CONFLICT DO NOTHING`, then SELECT and cache.\n- A fill with `recorded_at < floor` returns `errFillAcked` with zero DB calls (D-23).\n- A fill in the floor's own millisecond folds; a test covers it.\n- A DB error while stamping or loading keeps the consumer from starting.\n- The DB clock is used, the same clock that writes ledger `recorded_at`. `/sdd-spec` confirms from the DSNs that ledger and portfolio share one server.\n\n3. FILL PATH (unchanged from D-23, D-24, D-31, D-32, D-33)\n- Order: parse → below-floor ack → autocommit pre-check → side resolution (`orderSide` fallback) → persisted park, or `positionsMu.Lock` → BEGIN via `txBeginner` → applied INSERT → `pg_advisory_xact_lock` → one `SELECT … FOR UPDATE` → pure `pnl.FoldFrom` with the D-10 flip → COMMIT → Unlock → keyed emits, risk, snapshot.\n\n4. CUTOVER (operator ruling: stop-then-start; the procedure itself is NOT settled, see blocking objections)\n- One numbered runbook step with a recorded result per database: the `consumer_floors.floor_recorded_at` value, the boot log line naming it, and the count of `order.filled` ledger rows between the stop time and the floor.\n- The step must name each target (DO `xstockstrat-staging`, homelab staging VM) and be a merge precondition on the integration PR, because the deploy fires on the push.\n- A second runbook step covers redelivering a parked fill: delete its parked row, restart.\n- Fills appended between stop and first boot are acked. The operator accepted this.\n\n5. TRADING MIGRATION `012_bracket_legs` (D-7, plus `symbol`, `side`, `observed_filled_qty`)\n- The seed predicate is NOT settled. The proposal's 'not CANCELED, FAILED or exited' does not work: an exited bracket stays ACTIVE (status 3), so that predicate seeds the historical set the operator ruled out.\n- Direction for the next proposer, staying inside the register:\n  - Seed by numeric status codes (3 ACTIVE, 4 CANCELING), non-empty leg ids, `filled_qty NULL` (D-19).\n  - Give un-baselined seeded rows (`filled_qty IS NULL`) their own per-account GetOrder budget, so they never consume the D-11 fallback budget of legs written by `ActivateBracket`.\n  - A seeded leg first seen with fill > 0 is `BASELINE_RETIRED` with no emit (R-7, R-12). A seeded leg first seen open at fill 0 is baselined and tracked.\n  - Do NOT retire a seeded leg on its first ordinary miss. A seeded open leg can emit once baselined at 0, so that is R-10 under another name.\n  - Restate the accepted gap to match the code: CANCELED and FAILED brackets, resize-blanked ids, and IBKR legs the gateway no longer returns.\n  - Alternative to weigh: a first-tick broker-side seed that tracks only legs the broker reports open.\n\n6. RECONCILIATION (ruling (c); D-3 stands)\n- `NetFilledQtyBySymbol` (`services/xstockstrat-trading/internal/repository/trading_repo.go:171-186`) sums the latest-per-order `trading.orders` subquery `UNION ALL` the account's `trading.bracket_legs` rows, using `observed_filled_qty`.\n- `observed_filled_qty` is written on every observation. `filled_qty` stays the emit cursor (R-27, D-15).\n- `bracket_legs.side` is written through the same enum-to-string helper `UpsertOrder` uses, so the `side = 'sell'` CASE at `trading_repo.go:177` matches. A mixed orders-plus-legs sum test for one symbol is required.\n- `KnownBrokerOrderIDs` gains the `bracket_legs` UNION (D-20).\n\n7. LEG KEY AND GetPnL (D-28) — unchanged.\n\n8. @AC-5 (signed off)\n- Then: `order.partially_filled` qty 4, then `order.filled` qty 10 at average fill price 110; position 0; realized 100. The step binds 'qty 4' to the partial's cumulative `filled_qty`. The 'qty 6' variant is dropped.\n\nTESTS (existing `portfolio-db-test` job, no CI change)\n- All D-27 and D-33 cases stand.\n- Service-level dbtests pre-insert the floor before their fixtures (for example `-infinity`) and assert that an applied row exists. Otherwise the qty-15 case can pass without folding anything.\n- Floor: below-floor makes zero DB calls; same-millisecond folds; a second boot keeps the first floor.\n- Trading: two-account same-leg-id at the ledger key and GetPnL; mixed orders-plus-legs sum; a seeded leg does not use the new-leg budget.\n\nBUILD ORDER\n1. Migrations `019` and `012` (re-check numbers against feature 318).\n2. Floor stamp and load; `observed()` branches; `FillApplied`, `ApplyFill`, `txBeginner`.\n3. Fold rewrite with in-tx reads and the D-10 flip; persisted park.\n4. dbtests.\n5. Broker `ErrOrderNotFound`, IBKR id-match.\n6. `ActivateBracket` with symbol and side, both UNIONs, keyed append, observer, GetPnL composite key.\n7. Runbook: the cutover step, the rollback rule, parked-row redelivery; portfolio CLAUDE.md.",
    "open_objections": [
      {
        "text": "O-46 (seed scope) is not closed. The proposal's seed predicate names an 'exited' bracket state that does not exist (status is SMALLINT 0-6, 005_broker_accounts_halted.up.sql:17; trading.go:3452-3458). Nothing moves a bracket off ACTIVE when a leg fills, so 'not CANCELED or FAILED' seeds every historically exited bracket. Old IBKR legs then sit in the D-11 capped GetOrder fallback forever (D-26 never retires them) and starve new legs, which puts AC-4 at risk. The proposer must pin the predicate by numeric status code, isolate seeded legs from the new-leg budget (or use a first-tick broker-side seed), and restate the accepted gap to match the code. Retiring a seeded leg on its first ordinary miss is not available: a seeded open leg can emit after it is baselined at 0, so that is locked R-10.",
        "blocking": true
      },
      {
        "text": "The stop-then-start step cannot be executed as written. A main-dev push automatically deploys two staging targets, the DO app xstockstrat-staging and the homelab staging VM (ci-overview.md:58,60), and a DO deploy is rolling, so old and new instances overlap unless portfolio is stopped first. The runbook step must (a) name each target and record one result per database, (b) make 'portfolio stopped' a merge precondition on the integration PR, and (c) state how the portfolio component is stopped on DO App Platform, verified as possible, or have the operator scope DO dev as disposable. Ledger precedent for an unenforced merge-order instruction: fails.md:3687.",
        "blocking": true
      },
      {
        "text": "Rollback after the floor is stamped double-applies fills. DO and the homelab VM both roll back images automatically and leave the database alone (.do/app.yaml:679-681; ci-overview.md:76). The restored old binary folds fills above the floor without writing applied rows, and the next roll-forward folds them again. This was the rollback half of O-49 and is now unhandled. Required: a runbook rule (any return to a pre-019 portfolio image needs a stop, DELETE FROM portfolio.consumer_floors, and a repeat of the cutover step), plus either a boot-time detection (for example a WARN) or a recorded reason for not having one. An automatic rollback happens without the operator, so the rule must say how it is noticed.",
        "blocking": true
      },
      {
        "text": "Adversary r7 proposes stamping the floor at the stop so window fills (up to a 15-minute CI and deploy window, ci-overview.md:63) fold and are not acked. As written it cannot work: consumer_floors is created by the PRE_DEPLOY migration, which runs after the stop. The proposer should evaluate a workable variant (for example recording the stop timestamp and lowering the floor to it afterwards, checking the interaction with position sync) or record why the boot stamp alone is kept. 'About 0' window fills is not a safe expectation while staging trading keeps polling.",
        "blocking": false
      },
      {
        "text": "C-11 assumption to record: the ruling's premise is that production has never launched, but the product spec headline says '(SEV-2, production)' and OQ-2 / D-6 refer to inflated production accumulators. Either record the operator's confirmation that the production portfolio and ledger tables hold no fold history, or extend the cutover step to the first production deploy (DO prod and the homelab production VM) as a check with a recorded result.",
        "blocking": false
      },
      {
        "text": "Register verdicts to record: the round-7 design needs R-25, D-29 and D-30 reopened. The verbatim ruling at context.md:1535-1541 removes the trigger, fill_fence, fill_cutover and the application_name fence, which makes D-29 and D-30 impossible. The words 'return to the simplest floor' appear only in the computed task text, not in context.md. The orchestrator should record all three as 'user reopened' citing those lines, and P-4 (REOPEN R-2) as withdrawn.",
        "blocking": false
      },
      {
        "text": "Proposer to confirm the items adopted here from adversary r7: service-level dbtests pre-insert the floor before their fixtures and assert an applied row exists; bracket_legs.side is written through the helper UpsertOrder uses, with a mixed orders-plus-legs sum test; consumer_floors gets no generic floor API.",
        "blocking": false
      },
      {
        "text": "O-30: the affected analysis ACs are still not listed. The AC ids in order-snapshots-pnl-patterns.feature and fix-python-loop-supervision.feature must be enumerated at /sdd-spec, and the D-10 flip-short window residual stays named.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "251 @AC-17",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "251 @AC-14",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "206 trading @AC-1",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "206 trading @AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "294 @AC-56",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "294 @AC-6",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "290 @AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "The boot-armed write fence with a per-row floor (round 6, D-29/D-30). Lost: the operator ruled it out (context.md:1535-1541); writer identification was unproven through PgBouncer and two pre-fence cases stayed undecidable.",
      "Seeding an applied row for every historical order.filled at first boot in place of a floor (proposer's runner-up). Lost: it needs a 'seed complete' marker, and a crash mid-seed can mark fills applied that were never folded. Both sides rejected it.",
      "The @AC-5 'qty 6' variant with a CHANGE to 251 @AC-17. Lost: the operator signed off the qty 10 at average 110 wording.",
      "A 012 seed of every bracket that is not CANCELED or FAILED, sharing the new-leg budget (proposal r7). Lost: no exited state exists, so it seeds the historical set the operator excluded and starves new legs on IBKR. The replacement predicate is still open.",
      "Retiring a seeded leg on its first ordinary miss (adversary r7 fix option). Not available: a seeded open leg can emit once baselined at 0, so this is locked R-10.",
      "Stamping consumer_floors from the runbook at the stop, as written (adversary r7). Not adopted as written: the table is created by the PRE_DEPLOY migration after the stop. A workable variant is left for the proposer to evaluate.",
      "Leg rows in trading.orders to satisfy ruling (c). Lost: the operator chose the bracket_legs UNION and D-3 stands."
    ],
    "open_risks": [
      "With no fence there is no code-level guard: if portfolio is not stopped before the deploy, an overlap double-applies fills and nothing reports it.",
      "An automatic image rollback after the floor is stamped lets the old binary fold above the floor; the next roll-forward folds those fills again, and accumulators keep the error.",
      "Fills appended between the stop and the first new boot are acked: qty heals at the next sync, realized P&L for them is lost. The window can be the whole CI and deploy time.",
      "Late-commit appends whose recorded_at is below the floor are acked (operator-accepted O-3 case).",
      "The floor assumes ledger and portfolio share one Postgres server clock, and that nothing outside the portfolio binary writes portfolio.positions or consumer_floors.",
      "If production does hold fold history, its first deploy is an unfenced rolling cutover.",
      "Reconciliation covers only tracked legs. CANCELED or FAILED brackets, resize-blanked ids and IBKR legs the gateway forgot stay uncounted, so NetFilledQtyBySymbol may still mismatch for those symbols.",
      "Seeded IBKR legs that never return are polled indefinitely (D-26).",
      "If the composite GetPnL key is applied, a historical order whose partial and full fills carried different account_id values stops being deduplicated; the /sdd-spec history grep is the only check.",
      "A parked fill is retried only after a manual delete of its parked row.",
      "A fill transaction can wait server-side on the applied-row conflict or on FOR UPDATE, holding 1 of 2 client connections and positionsMu.",
      "The pre-check has a TOCTOU window covered only by the in-tx INSERT conflict path, so the conflict-path dbtest is load-bearing.",
      "A position.updated can be emitted after a same-process sync has overwritten the row.",
      "Legs partially filled at cutover are BASELINE_RETIRED, so realized P&L for their post-cutover remainder is lost.",
      "Boot replay re-walks every post-floor fill and consumer_applied_events has no retention.",
      "A leg id is lost from tracking if the ActivateBracket tx fails; it is alerted, but its exit fill never folds.",
      "Neither broker adapter populates BrokerOrder.Fees, so fee totals understate.",
      "Migration numbers 019 and 012 may collide with feature 318.",
      "OQ-2 (repair of already-inflated accumulators) is out of scope, and instance_count must stay 1."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-08",
      "C-10",
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "F-04",
      "F-06",
      "F-07",
      "F-08",
      "P-02",
      "P-03",
      "P-04",
      "PLAT-N1"
    ],
    "rationale": "The design is not approvable this round. There is no Floor breach, but three blocking objections remain: the seed predicate, the cutover procedure, and rollback after the floor is stamped. The adversary rated the round NEEDS WORK and I agree with all three.\n\n**Provenance.** I read `context.md:1496-1550` in the worktree. The rulings are there verbatim: the D-4 reopen with the GetPnL extension, the @AC-5 sign-off, stop-then-start with the fence removed, legs via `bracket_legs`, forward-only history, and the park staying in scope. O-43 closes.\n\n**What I took from each side.**\n- **Fence removal and single floor (proposer):** adopted. The ruling removes the trigger and both fence tables, so D-29 and D-30 cannot stand, and with R-1 and R-2 locked a single floor is what remains. I recorded R-25, D-29 and D-30 as reopened on the operator steer.\n- **Seed predicate (adversary):** the adversary is right. I confirmed the status enum has no exited state, so the proposal's predicate seeds the excluded historical set. O-46 stays open. I did not adopt the adversary's \"retire a seeded leg on first miss\" fix, because a seeded open leg can still emit after it is baselined, which makes that fix locked R-10.\n- **Cutover executability (adversary):** adopted as a blocking objection. I confirmed the two automatic staging targets in `ci-overview.md`.\n- **Rollback (adversary):** adopted as blocking. It is the surviving half of O-49.\n- **Floor at the stop (adversary):** not adopted as written. `consumer_floors` does not exist until the PRE_DEPLOY migration runs, which is after the stop. It stays as a non-blocking item for the proposer.\n- **Smaller adversary points adopted:** dbtests pre-insert the floor; `side` goes through the existing helper; no generic floor API.\n\n**Closed this round:** O-3, O-11, O-13, O-43, O-45, O-50, and the fence-only items O-44, O-47, O-48, O-49, O-51.\n\n**Still open:** O-46 (blocking), O-30, plus the new items.\n\n**Business rules.** @AC-5 is CHANGE and now covered by the operator's sign-off. 251 @AC-17, 206 trading @AC-1 and 294 @AC-56 are EXTEND, each covered by a recorded ruling.\n\n**One caveat on the reopen.** The phrase \"return to the simplest floor\" is in the computed task text but not in `context.md`. The verbatim ruling still makes D-29 and D-30 impossible, so I treated the reopen as granted and asked the orchestrator to record the three verdicts.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "The write fence is removed, superseding D-29 and D-30. Portfolio migration 019 creates only consumer_applied_events and consumer_floors. There is no trigger on portfolio.positions, no fill_fence or fill_cutover table, no application_name writer identification and no per-row floor.",
          "evidence": "context.md:1535-1541 (operator ruling, stop-then-start on staging); proposal r7 item 1; adversary r7 confirmed the removal follows the ruling"
        },
        {
          "text": "The fill floor is a single row per consumer in portfolio.consumer_floors(consumer PK, floor_recorded_at). The migration never writes it. Every boot runs INSERT ('order_fill', date_trunc('milliseconds', clock_timestamp())) ON CONFLICT DO NOTHING, then loads and caches the value before the fill consumer starts. A fill below the floor is acked with zero DB calls, a fill in the floor's millisecond folds, and a stamp or load error keeps the consumer from starting. Only order_fill uses the table and no generic floor API is added.",
          "evidence": "R-2 honoured; ledger 001_ledger_events_hypertable.up.sql:20; ledgerServiceImpl.ts:472; D-23; operator ruling context.md:1535-1541; proposal r7 item 2; adversary r7 contested only the stamping moment and rollback, and accepted the single-consumer table"
        },
        {
          "text": "The cutover is a numbered stop-then-start runbook step with a recorded result per database: the consumer_floors value, the boot log line naming it, and the count of order.filled ledger rows between the stop time and the floor. Fills in that window are acked as the operator-accepted consequence. Which targets the step covers and how the stop is done are not part of this decision.",
          "evidence": "context.md:1535-1541; proposal r7 item 4; adversary r7 contested only targets, merge ordering and rollback"
        },
        {
          "text": "Bracket-leg fills reach reconciliation through trading.bracket_legs: the table carries symbol, side and observed_filled_qty, and NetFilledQtyBySymbol sums the trading.orders subquery UNION ALL the account's bracket_legs rows using observed_filled_qty, written on every observation. side is written through the same enum-to-string helper UpsertOrder uses, with a mixed orders-plus-legs sum test. D-3 stands and no leg row enters trading.orders.",
          "evidence": "context.md:1542-1545 (operator ruling, via bracket_legs); trading_repo.go:171-186; R-27; D-15; proposal r7; adversary r7 objection 8 contested only the side encoding"
        },
        {
          "text": "@AC-5 amended Then, signed off under C-16: the ledger holds an order.partially_filled event with qty 4 and an order.filled event with qty 10 at average fill price 110 for that leg; position 0; realized 100. The step binds 'qty 4' to the partial payload's cumulative filled_qty, and the order.filled qty is the leg total, consistent with 251 @AC-17.",
          "evidence": "context.md:1530-1534 (operator selected 'Sign off'); proposal r7; adversary r7 found no @AC regression"
        }
      ],
      "new_rejected": [
        {
          "text": "Seeding an applied row for every historical order.filled at first boot in place of a floor",
          "why": "It needs a 'seed complete' marker, and a crash mid-seed can mark fills applied that were never folded. Proposer and adversary both rejected it in round 7."
        },
        {
          "text": "The @AC-5 'qty 6' variant, with a CHANGE to 251 @AC-17 so leg fills fold by cumulative filled_qty",
          "why": "The operator signed off the amended wording (qty 10 at average fill price 110) and dropped this variant (context.md:1530-1534)."
        },
        {
          "text": "Bracket-leg rows in trading.orders as the way to bring leg fills into reconciliation",
          "why": "The operator chose the bracket_legs UNION and declined to reopen D-3 (context.md:1542-1545); leg rows would pass through LoadInflightOrders, pollFills and maybeSubmitBracket (trading.go:337-345)."
        }
      ],
      "new_objections": [
        {
          "text": "The stop-then-start step cannot be executed as written: a main-dev push automatically deploys both the DO app xstockstrat-staging and the homelab staging VM (ci-overview.md:58,60), and a DO deploy is rolling. The runbook step must name each target with one recorded result per database, make 'portfolio stopped' a merge precondition on the integration PR, and state a verified way to stop the portfolio component on DO App Platform, or have the operator scope DO dev as disposable.",
          "blocking": true
        },
        {
          "text": "Rollback after the floor is stamped double-applies fills: DO and the homelab VM roll back images automatically and leave the database alone, so the restored old binary folds above the floor without applied rows and the next roll-forward folds again. Required: a runbook rule (a return to a pre-019 image needs a stop, DELETE FROM portfolio.consumer_floors and a repeat of the cutover step), a statement of how an automatic rollback is noticed, and either a boot-time detection or a recorded reason for not having one.",
          "blocking": true
        },
        {
          "text": "Evaluate stamping the floor at the stop so window fills fold. The adversary's version cannot work as written because consumer_floors is created by the PRE_DEPLOY migration after the stop. The proposer should give a workable variant, checking the interaction with position sync, or record why the boot stamp alone is kept.",
          "blocking": false
        },
        {
          "text": "Record the operator's confirmation that the production portfolio and ledger tables hold no fold history (the product spec headline says 'SEV-2, production'), or extend the cutover step to the first production deploy as a check with a recorded result.",
          "blocking": false
        },
        {
          "text": "The orchestrator should record R-25, D-29 and D-30 as 'user reopened' citing context.md:1535-1541, and P-4 as withdrawn. The words 'return to the simplest floor' appear only in the computed task text, not in context.md.",
          "blocking": false
        },
        {
          "text": "Proposer to confirm the items adopted from adversary r7: service-level dbtests pre-insert the floor before their fixtures and assert an applied row exists; bracket_legs.side goes through the helper UpsertOrder uses; consumer_floors gets no generic floor API.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-3",
          "how": "Operator ruling: stop-then-start as one numbered runbook step with a recorded result, and the remaining pre-cutover cases accepted (context.md:1535-1541). Whether the step can be executed on the automatic deploy path is tracked as a new objection."
        },
        {
          "id": "O-11",
          "how": "Operator gave the C-16 sign-off for the @AC-5 amendment (context.md:1530-1534); the 'qty 6' variant is dropped."
        },
        {
          "id": "O-13",
          "how": "Operator ruling: leg fills reach reconciliation through the NetFilledQtyBySymbol UNION over trading.bracket_legs (context.md:1542-1545)."
        },
        {
          "id": "O-43",
          "how": "The operator's rulings are recorded verbatim in context.md:1496-1550 on the feature branch (commits d3b641a2, f7e82d15), verified this round."
        },
        {
          "id": "O-44",
          "how": "Moot: the operator removed the write fence, so no writer identification exists."
        },
        {
          "id": "O-45",
          "how": "Operator confirmed the bracket_legs reading; D-3 stands and no REOPEN D-3 is granted (context.md:1542-1545)."
        },
        {
          "id": "O-47",
          "how": "Moot: the per-row fence floor is removed, and the operator accepted the remaining pre-cutover cases as the consequence of stop-then-start."
        },
        {
          "id": "O-48",
          "how": "Moot: no fence is armed, so no writer of portfolio.positions needs identifying and the test pools are unchanged."
        },
        {
          "id": "O-49",
          "how": "Moot for the fence: no trigger exists to drop or disarm. The rollback hazard carries over in a new form and is tracked as a new objection."
        },
        {
          "id": "O-50",
          "how": "Proposer confirmed: observed_filled_qty feeds the UNION and filled_qty stays the emit cursor; the floor is truncated to the millisecond with a same-millisecond fold test; @AC-5 uses the operator's wording with filled_qty 4 asserted in the step."
        },
        {
          "id": "O-51",
          "how": "Moot: there is no boot arming, table lock or per-write fence check."
        }
      ],
      "reopen_petitions": [
        {
          "target": "R-25",
          "evidence": "Proposer r7: the operator ruling at context.md:1535-1541 reverses 'fix in scope' for residual (a), chooses stop-then-start, removes the fence tables and accepts the remaining O-3 pre-cutover cases. R-25's only stated reason was that the operator had made those cases design requirements. The ruling postdates round 6. Adversary r7 agrees the evidence is new.",
          "is_new": true
        },
        {
          "target": "D-29",
          "evidence": "Proposer r7: context.md:1538-1540 rules 'no portfolio.positions trigger, no fill_fence/fill_cutover, no application_name fence', which removes the boot-armed fence. The ruling postdates round 6. Adversary r7 agrees.",
          "is_new": true
        },
        {
          "target": "D-30",
          "evidence": "Proposer r7: context.md:1538-1540 removes fill_fence, the table the per-row floor is loaded from, and the operator steer names 'no per-row fence floor'. The ruling postdates round 6. Adversary r7 agrees.",
          "is_new": true
        }
      ],
      "reopened": [
        "D-29",
        "D-30",
        "R-25"
      ]
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-20 — sdd-batch design gate (round 8)

- `/sdd-design fix-position-fold-correctness` (full) halted at its approval gate after round 8 (gate policy: halt). design.md NOT written; status.md unchanged (spec-ready). Register: `debate.md` (D-1..D-45, R-1..R-33, O-1..O-62, P-1..P-7). Round 8 settled D-39..D-45, locked R-31..R-33, closed O-46, O-52..O-55 and O-57, and opened O-58..O-62. Nothing was reopened and no petition was filed; P-5..P-7 are still pending user.

## Open Threads

- **Approach (round-8 synthesis).** Sections 1-3 and 6-8 of the round-7 synthesis stand (D-1..D-3, D-5..D-16, D-18..D-28, D-31..D-38). Round 8 changes only the cutover, the trading `012` migration and the rollback rule.
  - **Leg adoption replaces the seed.** Trading `012_bracket_legs` is DDL only, with `filled_qty NOT NULL` and an `adopted` flag whose only reader is the D-11 fallback sort (D-39). Pre-existing open legs are adopted inside `pollBracketLegFills`: candidates are `order_brackets` leg ids on ACTIVE or CANCELING brackets that are not yet in `bracket_legs`, each matched only against the `ListOrders` result the tick already holds, with no GetOrder call. A leg listed open at fill 0 is tracked; one listed open at fill > 0 is inserted `BASELINE_RETIRED` with no emit; anything else is not inserted (D-40). The parent's `trading.orders` row is joined read-only, which D-3 permits (D-41). The forward-only gap is restated to match the code (D-42).
  - **Cutover.** The numbered step runs at the first deploy of a post-019 portfolio image to each staging target (DO `xstockstrat-staging`, and the homelab staging VM while enabled), with one recorded result per database. The DO stop removes the portfolio service from the live spec; the homelab stop is `gate deploy` or a manual compose stop. Neither method can be verified from this repo. "Portfolio stopped, T_stop recorded, main-dev frozen" is an unenforced checklist item on the integration PR and in `merge-order.md` (D-43).
  - **Rollback.** If a pre-019 image ran after the floor was stamped: stop portfolio, delete the `order_fill` floor row, repeat the cutover step. A rollback is noticed through the Deploy runs; there is no boot-time detection, because the old binary's writes carry no marker (D-44). The floor is stamped only at boot and is not lowered to T_stop (D-45).
  - **Production.** Check only: before the first promotion, record the `portfolio.positions` and ledger `order.filled` counts per production database; a non-zero count blocks the promotion until the operator rules. The proposer's stop-then-start-on-production branch is withdrawn from the approach.
- **Strongest open objection.** O-58, blocking: adoption may never fire. With `012` DDL-only, every account starts with zero `bracket_legs` rows, and nothing in the register forces the D-11 `ListOrders` call for an account with no tracked legs. Without that call the O-46 fix is a silent no-op. The proposer must confirm that `pollBracketLegFills` issues `ListOrders` for every account with at least one adoption candidate, with a test that starts from zero `bracket_legs` rows and one open ACTIVE leg. One more blocking objection is open, O-59: the proposal's production stop-then-start goes beyond the staging-only ruling (`context.md:1535-1541`) and stops portfolio on a live account, where `flattenAndHalt` and the reduce-only exposure check then fail. The proposer must confirm the check-only form, and the non-zero case goes to the operator.
- **Floor status.** No Floor breach. The design is not approvable this round: the three round-7 blocking objections (O-46, O-52, O-53) are answered, but two new blocking objections remain (O-58, O-59) and the proposer has answered neither.
- **Uncovered @AC changes.** None; unchanged from round 7. `@AC-5` CHANGE is covered by the operator's C-16 sign-off (`context.md:1530-1534`). 251 @AC-17, 206 trading @AC-1 and 294 @AC-56 are EXTEND, each covered by a recorded ruling. @AC-1..@AC-4, 251 @AC-14, 206 trading @AC-2, 294 @AC-6 and 290 @AC-3 PRESERVE.
- **Operator sign-offs still needed.**
  - **Production with fold history (O-59).** What happens when the production counts are non-zero. The adversary's candidate is to set `platform.trading_state=HALTED` before the stop, restore it after the boot log line, and record both config changes.
  - **Cutover confirmations (O-61),** to be answered before `/sdd-execute` reaches the integration step:
    1. DO accepts a spec with the portfolio service removed while `.do/app.dev.yaml:78` and `:319` still reference `${xstockstrat-portfolio.PRIVATE_DOMAIN}`.
    2. `doctl apps spec get` round-trips the encrypted secret values.
    3. Homelab `gate deploy` recreates portfolio stop-then-start, or the operator can stop it on the VM.
    4. `gate deploy` exits non-zero when the VM rolls back.
    5. Trading's failed portfolio calls during the stop are acceptable on paper staging.
    6. Alpaca lists bracket legs as top-level orders in every open state.
    If 1 or 2 fails there is no verified DO stop, and scoping DO staging as disposable for this cutover needs its own ruling.
  - **Register verdicts (O-56).** P-5, P-6 and P-7 recorded as "user reopened" citing `context.md:1535-1541`, and P-4 as withdrawn.
- **Non-blocking, for the proposer.** O-60 (adoption details: the D-19 terminal predicate so a `held` leg is adopted, every parent-derived column filled, the adoption cadence across a rolling overlap, the candidate query's row count or a partial index, the DDL comment on `adopted`); O-62 (confirm the freeze evidence in the recorded result and that the delete-floor step applies on DO only after a deliberate console rollback); O-30 (enumerate the affected analysis AC ids at `/sdd-spec`).

```sdd-batch-design-state
{
  "round": 8,
  "synth": {
    "approach": "Round-8 synthesis. Sections 1-3 and 6-8 of the round-7 synthesis and its tests stand unchanged (D-1..D-3, D-5..D-16, D-18..D-28, D-31..D-38). Only section 4 (cutover), section 5 (trading 012 and leg adoption) and the rollback rule change. All paths are under `/home/user/xstockstrat/.claude/worktrees/orch-311`.\n\nVerified this round\n- Bracket status constants are NONE 0, SUBMITTING 1, PENDING_VERIFY 2, ACTIVE 3, CANCELING 4, CANCELED 5, FAILED 6 (`services/xstockstrat-trading/internal/service/trading.go:3451-3459`; `services/xstockstrat-trading/migrations/005_broker_accounts_halted.up.sql:17`). The partial index covers only `status IN (0,1,2,4)` (`005:29-31`), so status 3 is unindexed.\n- The DO deploy applies the whole rendered spec with `doctl apps update \"$APP_ID\" --spec … --update-sources` (`.github/workflows/deploy.yml:101`) and exits 1 on phase ERROR or CANCELED (`:129-131`).\n- Two staging targets deploy on a main-dev push: DO app `xstockstrat-staging` and the homelab staging VM, the latter only while `HOMELAB_STAGING_ENABLED` is true (`docs/patterns/ci-overview.md:58,60,68`). The homelab VM rolls back on its own (`:76`). The gate exposes only `put`, `deploy`, `status` (`.github/workflows/deploy-homelab.yml:189-194`).\n- Other components reference `${xstockstrat-portfolio.PRIVATE_DOMAIN}` (`.do/app.dev.yaml:78,319`). Neither side raised this. A spec with the portfolio service removed leaves those references dangling, so DO may reject it.\n- The operator's cutover ruling is staging-only and rests on the premise that production has never launched (`docs/roadmap/features/311-fix-position-fold-correctness/context.md:1535-1541`).\n\n4. CUTOVER (D-36 stands; this fills in targets, stop method and result)\n- Scope: the numbered runbook step runs at the first deploy of a post-019 portfolio image to each staging target: DO `xstockstrat-staging`, and the homelab staging VM while enabled. One recorded result per database.\n- DO stop: `doctl apps spec get <APP_ID>`, delete the `xstockstrat-portfolio` service block, `doctl apps update --spec`, wait for ACTIVE, record the finish time as T_stop. The integration push re-creates the component from `.do/app.dev.yaml:99-107` with no old instance running. Instance count 0 is not relied on. This method is NOT verified from the repo (see the operator gate item).\n- Homelab stop: either `gate deploy` recreates the single portfolio container stop-then-start, or the operator runs `docker compose stop xstockstrat-portfolio` on the VM before the merge. Not verifiable from this repo (implementation lives in homelab-edge).\n- Merge precondition: 'portfolio stopped on every enabled staging target, T_stop recorded, main-dev frozen (merge-train included)' is a checklist item in the integration PR body and in `docs/roadmap/features/merge-order.md`. It is not enforced; the recorded result is the audit. If the freeze breaks, the stop is redone.\n- Recorded result per database, written to context.md: target name; T_stop; `consumer_floors.floor_recorded_at`; the boot log line naming it with `stamped_now=true`; the count of `order.filled` ledger rows in `[T_stop, floor)`; the green deploy run. Adopted from adversary r8 as freeze evidence: the main-dev SHA at T_stop, which must equal the integration merge's first parent, and the list of Deploy workflow runs between T_stop and the integration run, which must be empty.\n- Production: check only. Before the first production promotion, record the counts of `portfolio.positions` rows and ledger `order.filled` rows on each production database. If either is non-zero, the promotion does not proceed until the operator rules. No production stop is designed here: the ruling is staging-only, and a stopped portfolio on a live account breaks `flattenAndHalt` and the reduce-only exposure check. The proposer's stop-then-start-on-production branch is withdrawn from the approach.\n- The boot stamp alone is kept (O-54). The floor is not lowered to T_stop.\n\nROLLBACK (after the floor is stamped)\n- Rule: if a pre-019 portfolio image ran after the floor was stamped, (1) stop portfolio by the same method, (2) `DELETE FROM portfolio.consumer_floors WHERE consumer = 'order_fill'`, (3) repeat the cutover step.\n- Where the hazard exists: the integration deploy on the homelab VM, and any deliberate old-image deploy (a `deploy-homelab.yml` `image_tag` dispatch, or a DO console rollback). On DO, the deployment before the integration deploy is the stop spec with no portfolio component, so an automatic DO rollback restores no old portfolio (adversary r8 correction, adopted).\n- How it is noticed: the DO Deploy run goes red on ERROR (`deploy.yml:129-131`); on homelab, `gate deploy` and `gate status`. The runbook step requires both runs green before the result is recorded.\n- No boot-time detection, with the recorded reason: a pre-019 binary writes nothing that tells its writes apart from position sync or normal catch-up, and the operator ruled out writer markers (`context.md:1538-1540`). The `stamped_now` log field is for the audit only.\n\n5. TRADING MIGRATION `012_bracket_legs` AND LEG ADOPTION (replaces the seed)\n- `012` is DDL only, with no seed INSERT. Columns as in D-7 and D-37, plus `filled_qty NOT NULL` and `adopted BOOLEAN NOT NULL DEFAULT false`. `adopted` has one reader, the D-11 fallback sort.\n- Adoption runs inside `pollBracketLegFills` (the D-22 callee after `logTick`).\n- Candidates, one read-only query: `trading.order_brackets` leg ids where `status = ANY($1)`, with `$1` bound from `bracketStatusActive` and `bracketStatusCanceling`; leg id non-empty; not already in `bracket_legs`; joined read-only to the parent's latest `trading.orders` row.\n- Each candidate is matched only against the `ListOrders` result the tick already holds. No GetOrder call is made for adoption.\n  - Listed, non-terminal, `FilledQty == 0`: insert tracked, `filled_qty = 0`, `observed_filled_qty = 0`, `adopted = true`.\n  - Listed, non-terminal, `FilledQty > 0`: insert `BASELINE_RETIRED`, no emit, `observed_filled_qty = FilledQty` (R-7, R-12).\n  - Otherwise: not inserted. No tracked leg is retired for absence (R-10).\n- Inserts are `ON CONFLICT (account_id, leg_order_id) DO NOTHING`. A failed query or `ListOrders` retries next tick.\n- In the D-11 GetOrder fallback, `adopted = true` rows sort after rows written by `ActivateBracket`.\n- Adopted from adversary r8, pending proposer confirmation:\n  - `ListOrders` is issued for every account that has at least one adoption candidate, even with zero tracked rows. Without this, adoption never fires after a DDL-only 012.\n  - 'Non-terminal' is the D-19 terminal predicate (`held` and unrecognised statuses count as open).\n  - The join fills every parent-derived column `ActivateBracket` writes: user_id, trading_mode, account, symbol, side (through the `UpsertOrder` helper and `oppositeSide`), parent order id.\n- Accepted forward-only gap, matching the code. Never tracked: legs not open on the adoption tick (every leg filled or cancelled before cutover); ids blanked by `resizeBracket` (`trading.go:3612`); legs on CANCELED (5) or FAILED (6) brackets; Alpaca open legs outside the newest 500 of `status=all` (`services/xstockstrat-trading/internal/broker/alpaca.go:376`); IBKR legs the gateway no longer returns. The remainder of a `BASELINE_RETIRED` leg is not observed.\n\nTESTS added this round (trading)\n- Adoption at fill 0 tracks; at fill > 0 retires with no emit.\n- A status 5 or 6 bracket is never adopted; a leg absent from the list is never inserted.\n- Adopted rows sort after `ActivateBracket` rows in the fallback; a second adoption run is a no-op.\n- Zero `bracket_legs` rows plus one open ACTIVE leg: the leg is adopted.\n- A `held` leg at fill 0 is adopted as tracked.\n- An adopted leg's later fill emits the full 251 payload.\n\nBUILD ORDER: unchanged from round 7, except step 1 (012 is DDL only), step 6 (adds adoption) and step 7 (the runbook gains the per-target cutover step, the rollback rule and the production check).",
    "open_objections": [
      {
        "text": "Adoption may never fire. With 012 DDL-only, every account starts with zero bracket_legs rows, and nothing in the register forces the D-11 ListOrders call for an account with no tracked legs (broker.go:74). The proposer must confirm that pollBracketLegFills issues ListOrders for every account with at least one adoption candidate, and add a test that starts with zero bracket_legs rows and one open ACTIVE leg and asserts the leg is adopted.",
        "blocking": true
      },
      {
        "text": "The proposal's production branch (a full stop-then-start on production when positions or order.filled counts are non-zero) goes beyond the operator's staging-only ruling (context.md:1535-1541) and stops portfolio on a live account, where flattenAndHalt and the reduce-only exposure check then fail. The synthesis reduces it to a check that blocks the promotion on a non-zero count. The proposer must confirm the check-only form, and the non-zero case must go to the operator as a gate item (the adversary's candidate: set platform.trading_state=HALTED before the stop, restore after the boot log line, record both config changes).",
        "blocking": true
      },
      {
        "text": "Adoption details for the proposer to confirm: (a) 'non-terminal' is the D-19 terminal predicate, so an Alpaca held stop leg is adopted, with a test; (b) the join fills every parent-derived column ActivateBracket writes (user_id, trading_mode, account, symbol, side, parent order id), with a test that an adopted leg's later fill emits the full 251 payload; (c) once-per-process adoption misses brackets an old trading instance activates during a rolling overlap, so state the cadence (repeat until a pass adopts nothing, or re-run on the reconciliation interval); (d) the candidate query scans unindexed status 3 rows joined to the trading.orders hypertable (005:29-31), so state the expected row count or add a partial index in 012; (e) the DDL comment gives the adopted column's single purpose.",
        "blocking": false
      },
      {
        "text": "Operator-confirmation gate item, to be recorded in context.md and answered before /sdd-execute reaches the integration step: (1) DO accepts a spec with the portfolio service removed while .do/app.dev.yaml:78 and :319 still reference ${xstockstrat-portfolio.PRIVATE_DOMAIN}; (2) doctl apps spec get round-trips the encrypted secret values; (3) homelab gate deploy recreates portfolio stop-then-start, or the operator can stop it on the VM; (4) gate deploy exits non-zero when the VM rolls back; (5) trading's failed portfolio calls during the stop are acceptable on paper staging; (6) Alpaca lists bracket legs as top-level orders in every open state. If (1) or (2) fails there is no verified DO stop, and the fallback (the operator scopes DO staging as disposable for this cutover) needs its own ruling.",
        "blocking": false
      },
      {
        "text": "Proposer to confirm the runbook additions adopted from adversary r8: the recorded result carries the main-dev SHA at T_stop (equal to the integration merge's first parent) and an empty list of Deploy runs between T_stop and the integration run; and the rollback rule states that an automatic DO rollback of the integration deploy restores the stop spec with no portfolio, so the DELETE-floor step applies on DO only after a deliberate console rollback.",
        "blocking": false
      },
      {
        "text": "O-30: the analysis AC ids in order-snapshots-pnl-patterns.feature and fix-python-loop-supervision.feature are still to be enumerated at /sdd-spec, and the D-10 flip-short window residual stays named.",
        "blocking": false
      },
      {
        "text": "O-56: the orchestrator still has to record P-5, P-6 and P-7 as 'user reopened' citing context.md:1535-1541, and P-4 as withdrawn. The proposer agrees.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "251 @AC-17",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "251 @AC-14",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "206 trading @AC-1",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "206 trading @AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "294 @AC-56",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "294 @AC-6",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "290 @AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "A 012 migration seed of status 3 and 4 brackets with its own GetOrder budget. Lost: nothing moves a bracket off ACTIVE, so it still inserts every historically exited bracket, and under D-26 forgotten IBKR legs are never retired and would be polled forever even on a separate budget.",
      "Lowering the floor to T_stop so window fills fold (O-54). Lost: it needs a manual UPDATE and another restart, and window fills a sync already applied would fold a second time, doubling qty until the next sync. Both sides rejected it.",
      "Taking an adopted leg's symbol and side from in-memory s.orders in place of the read-only trading.orders join. Lost: the parents of open legs are FILLED and LoadInflightOrders does not hydrate them, so most adoptees would be skipped. BrokerOrder carries no symbol or side (broker.go:21-35), so the join is required.",
      "A full stop-then-start on production when its tables hold history (proposal r8). Not adopted: the operator's ruling is staging-only and the stop breaks flattenAndHalt on a live account. It is not locked; it goes to the operator as a gate item.",
      "A boot-time detector for a pre-019 binary having run after the floor was stamped. Lost: the old binary's writes cannot be told apart from position sync or normal catch-up without a writer marker, which the operator ruled out (context.md:1538-1540).",
      "Scoping DO staging as disposable for this cutover. Not chosen now: the acked window becomes unbounded and unrecorded. It stays the named fallback if the DO stop cannot be confirmed, and needs an operator ruling."
    ],
    "open_risks": [
      "The DO stop is unverified, and there is a concrete reason to doubt it: .do/app.dev.yaml:78 and :319 reference ${xstockstrat-portfolio.PRIVATE_DOMAIN}, so a spec with the portfolio service removed may be rejected.",
      "The merge precondition and the main-dev freeze are not enforced. If portfolio is not stopped, or a push lands during the freeze, an overlap double-applies fills and only the recorded evidence shows it.",
      "On the homelab VM an unattended rollback of the integration deploy restores the pre-019 portfolio after the floor is stamped. Noticing it depends on gate deploy exiting non-zero, which is unconfirmed.",
      "Fills appended between T_stop and the first new boot are acked: qty heals at the next sync, realized P&L for them is lost. The window covers the stop, the freeze and the deploy.",
      "While portfolio is stopped on staging, trading's portfolio calls fail: the risk check warns only, reconciliation skips, and flattenAndHalt cannot flatten.",
      "If production holds fold history, the promotion is blocked on an operator ruling that does not exist yet.",
      "Adoption depends on Alpaca listing bracket legs as top-level orders in every open state; this is unverified.",
      "Reconciliation covers only tracked legs. Legs not open at the adoption tick, resize-blanked ids, legs on CANCELED or FAILED brackets, Alpaca legs outside the newest 500 and forgotten IBKR legs stay uncounted.",
      "A BASELINE_RETIRED leg's post-cutover remainder is neither emitted nor observed, so realized P&L for it is lost and NetFilledQtyBySymbol can lag for that symbol.",
      "Adopted IBKR legs that later vanish from the gateway are polled indefinitely (D-26); the set is bounded to legs open at adoption.",
      "The adoption candidate query scans status 3 rows with no index and grows with bracket history.",
      "Late-commit appends whose recorded_at is below the floor are acked (operator-accepted).",
      "The floor assumes ledger and portfolio share one Postgres server clock.",
      "If the composite GetPnL key is applied, a historical order whose partial and full fills carried different account_id values stops being deduplicated; the /sdd-spec history grep is the only check.",
      "A parked fill is retried only after a manual delete of its parked row.",
      "A fill transaction can wait server-side on the applied-row conflict or FOR UPDATE, holding 1 of 2 client connections and positionsMu.",
      "The pre-check has a TOCTOU window covered only by the in-tx INSERT conflict path.",
      "A position.updated can be emitted after a same-process sync has overwritten the row.",
      "Boot replay re-walks every post-floor fill and consumer_applied_events has no retention.",
      "A leg id is lost from tracking if the ActivateBracket tx fails; it is alerted, but its exit fill never folds.",
      "Neither broker adapter populates BrokerOrder.Fees, so fee totals understate.",
      "Migration numbers 019 and 012 may collide with feature 318.",
      "OQ-2 (repair of already-inflated accumulators) is out of scope, and instance_count must stay 1."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-08",
      "C-10",
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "F-01",
      "F-02",
      "F-04",
      "F-06",
      "F-07",
      "F-08",
      "P-02",
      "P-03",
      "P-04",
      "PLAT-N1"
    ],
    "rationale": "The design is not approvable this round. There is no Floor breach, and the three round-7 blocking objections (O-46, O-52, O-53) are answered. Two new blocking objections from the adversary remain, and the proposer has not yet answered either.\n\n**What I checked myself**\n- The status constants and the SMALLINT encoding match the proposal's predicate.\n- `deploy.yml:101` applies the full spec on every push, so the proposer is right that a console change is reset.\n- The cutover ruling in `context.md:1535-1541` is staging-only and assumes production has never launched.\n- New finding: `.do/app.dev.yaml:78,319` reference `${xstockstrat-portfolio.PRIVATE_DOMAIN}`. Removing the portfolio service leaves those dangling. Neither side saw this. I added it to the operator gate item and the risks.\n\n**What I took from each side**\n- **Adoption in place of a seed (proposer):** adopted. The operator steer asked for both options to be weighed. The seed loses because nothing moves a bracket off ACTIVE. The adversary agreed it honours R-7, R-10, R-12 and R-13 and found no register violation.\n- **Adoption trigger (adversary, blocking):** adopted into the approach, but it stays open and blocking until the proposer confirms it. Without it the whole O-46 fix can be a silent no-op.\n- **Production branch (adversary, blocking):** the adversary is right. I corrected the approach to a check that blocks the promotion, which stays inside the operator's ruling. The non-zero case needs the operator.\n- **Cutover and rollback (proposer):** adopted. The steer allows stop methods the repo cannot verify, provided the operator's confirmations are stated exactly; they are now one gate item.\n- **Freeze evidence and the DO rollback correction (adversary):** adopted.\n- **No boot-time detection (proposer):** accepted with the recorded reason. The steer allows that, and the adversary did not contest it.\n\n**Register check**\n- D-19 is narrowed, not reversed: no NULL writer remains.\n- D-3 is clarified, not changed: the join only reads `trading.orders`.\n- No locked R-n returns. Nothing is reopened this round and no petition was filed.\n\n**Closed:** O-46, O-52, O-53, O-54, O-55, O-57. **Still open:** O-30, O-56, and five new items.\n\n**Business rules:** unchanged from round 7.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Trading migration 012_bracket_legs is DDL only, with no seed INSERT. filled_qty is NOT NULL, and an adopted BOOLEAN NOT NULL DEFAULT false column is added whose only reader is the D-11 fallback sort. D-19 is narrowed: with no seed, nothing writes NULL.",
          "evidence": "operator steer r8 (weigh a seed against a broker-side adoption); trading.go:3451-3459; 005_broker_accounts_halted.up.sql:17; D-19; R-13; proposal r8 item 1; adversary r8 found no register violation and accepted the column"
        },
        {
          "text": "Pre-existing open legs are adopted inside pollBracketLegFills. Candidates are order_brackets leg ids with status bound from bracketStatusActive and bracketStatusCanceling, non-empty, not already in bracket_legs. Each is matched only against the tick's ListOrders result, with no GetOrder call. Listed and open at fill 0 is inserted tracked with adopted = true; listed and open at fill > 0 is inserted BASELINE_RETIRED with no emit and observed_filled_qty = FilledQty; anything else is not inserted. Inserts are ON CONFLICT DO NOTHING, and adopted rows sort after ActivateBracket rows in the D-11 fallback. What triggers the ListOrders call and how often adoption repeats are not part of this decision.",
          "evidence": "D-11; R-7; R-10; R-12; broker.go:73-74; alpaca.go:407-413; ibkr.go:478-479; proposal r8 item 1; adversary r8 called it better than any seed and contested only the trigger, the classifier, the columns and the cadence"
        },
        {
          "text": "D-3 clarified: it forbids leg writes to trading.orders or s.orders and the lifecycle calls (applyBrokerOrderStatus, maybeSubmitBracket). A read-only join to the parent's trading.orders row is permitted.",
          "evidence": "D-3; R-30; trading.go:337-345,1903,1921; proposal r8 Assumptions; adversary r8 Register section"
        },
        {
          "text": "The accepted forward-only gap is: legs not open on the adoption tick; ids blanked by resizeBracket; legs on CANCELED or FAILED brackets; Alpaca open legs outside the newest 500; IBKR legs the gateway no longer returns; and the unobserved remainder of a BASELINE_RETIRED leg.",
          "evidence": "context.md:1546-1548 (operator ruling, forward-only); trading.go:3612; alpaca.go:376; proposal r8 item 1; adversary r8 did not contest"
        },
        {
          "text": "Cutover scope and result: the step runs at the first deploy of a post-019 portfolio image to DO xstockstrat-staging and to the homelab staging VM while enabled, with one recorded result per database (target, T_stop, floor value, boot log line with stamped_now, order.filled count in [T_stop, floor), green deploy run, main-dev SHA at T_stop, empty list of Deploy runs in between). 'Portfolio stopped, T_stop recorded, main-dev frozen' is an unenforced checklist item in the integration PR body and merge-order.md. The DO stop is removal of the portfolio service from the live spec and the homelab stop is gate deploy or a manual compose stop; both are subject to the operator-confirmation gate item.",
          "evidence": "ci-overview.md:58,60,68; deploy.yml:101; deploy-homelab.yml:189-194; .do/app.dev.yaml:99-107; D-36; fails.md:3687; proposal r8 item 2; adversary r8 added only the freeze evidence and the gate item"
        },
        {
          "text": "Rollback rule: if a pre-019 portfolio image ran after the floor was stamped, stop portfolio, DELETE FROM portfolio.consumer_floors WHERE consumer = 'order_fill', and repeat the cutover step. A rollback is noticed through the Deploy runs, both of which must be green before the result is recorded. There is no boot-time detection, because the old binary's writes cannot be told apart from sync or catch-up without a writer marker. An automatic DO rollback of the integration deploy restores the stop spec with no portfolio.",
          "evidence": "deploy.yml:129-131; ci-overview.md:71,76; context.md:1538-1540; proposal r8 item 3; adversary r8 accepted it with the DO correction"
        },
        {
          "text": "The floor is stamped only at boot (D-35) and is not lowered to T_stop. The window count is recorded in the cutover result.",
          "evidence": "context.md:1540-1541; proposal r8 Key Decisions (O-54); adversary r8 agreed"
        }
      ],
      "new_rejected": [
        {
          "text": "A 012 migration seed of status 3 and 4 brackets with its own GetOrder budget",
          "why": "Nothing moves a bracket off ACTIVE, so it still inserts every historically exited bracket, and under D-26 forgotten IBKR legs would be polled forever even on a separate budget."
        },
        {
          "text": "Lowering the fill floor to T_stop so window fills fold",
          "why": "It needs a manual UPDATE and another restart, and window fills a sync already applied would fold a second time, doubling qty until the next sync. Both sides rejected it in round 8."
        },
        {
          "text": "Taking an adopted leg's symbol and side from in-memory s.orders in place of the read-only trading.orders join",
          "why": "Parents of open legs are FILLED and not hydrated by LoadInflightOrders, so most adoptees would be skipped; BrokerOrder carries no symbol or side (broker.go:21-35)."
        }
      ],
      "new_objections": [
        {
          "text": "Adoption may never fire: with 012 DDL-only every account starts with zero bracket_legs rows, and nothing forces the D-11 ListOrders call for an account with no tracked legs. The proposer must confirm that pollBracketLegFills issues ListOrders for every account with at least one adoption candidate, with a test that starts from zero bracket_legs rows and one open ACTIVE leg and asserts the leg is adopted.",
          "blocking": true
        },
        {
          "text": "The proposal's production stop-then-start branch goes beyond the staging-only ruling (context.md:1535-1541) and stops portfolio on a live account. The proposer must confirm the check-only form (record the portfolio.positions and order.filled counts per production database; a non-zero count blocks the promotion), and the non-zero case must be put to the operator as a gate item, with the HALTED-during-stop procedure as the candidate.",
          "blocking": true
        },
        {
          "text": "Adoption details to confirm: the non-terminal test is the D-19 predicate (a held leg is adopted, with a test); the join fills every parent-derived column ActivateBracket writes, with a full-251-payload test; the adoption cadence covers brackets activated by an old trading instance during a rolling overlap; the candidate query's row count is stated or a partial index is added in 012; the DDL comment gives the adopted column's single purpose.",
          "blocking": false
        },
        {
          "text": "Operator-confirmation gate item, recorded in context.md and answered before /sdd-execute reaches the integration step: DO accepts a spec with the portfolio service removed while .do/app.dev.yaml:78 and :319 reference ${xstockstrat-portfolio.PRIVATE_DOMAIN}; doctl apps spec get round-trips the encrypted secrets; homelab gate deploy is stop-then-start or a manual stop is possible; gate deploy exits non-zero on a VM rollback; trading's failed portfolio calls during the stop are acceptable on paper staging; Alpaca lists bracket legs as top-level orders. If the DO stop cannot be confirmed, scoping DO staging as disposable needs its own operator ruling.",
          "blocking": false
        },
        {
          "text": "Proposer to confirm the runbook additions adopted from adversary r8: the freeze evidence in the recorded result (main-dev SHA at T_stop equal to the integration merge's first parent; no Deploy runs in between), and the statement that the DELETE-floor step applies on DO only after a deliberate console rollback.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-46",
          "how": "The migration seed is replaced by a broker-side adoption that tracks only legs the broker reports open, with the predicate bound from bracketStatusActive and bracketStatusCanceling, no GetOrder budget used, adopted rows sorted last in the fallback, and the forward-only gap restated to match the code. Whether the ListOrders call fires for an account with no tracked rows is tracked as a new objection."
        },
        {
          "id": "O-52",
          "how": "Both staging targets are named with one recorded result per database, 'portfolio stopped' is a checklist precondition on the integration PR, and a stop method is stated for each target. The methods cannot be verified from the repo, so the exact operator confirmations are tracked as a new gate-item objection."
        },
        {
          "id": "O-53",
          "how": "Runbook rule given (stop, DELETE the order_fill floor row, repeat the cutover step); a rollback is noticed through the Deploy runs; the reason for no boot-time detection is recorded. The homelab exit-code confirmation is part of the operator gate item."
        },
        {
          "id": "O-54",
          "how": "The boot stamp alone is kept. Lowering the floor to T_stop is rejected because window fills already applied by a sync would fold twice; the window count is recorded."
        },
        {
          "id": "O-55",
          "how": "The cutover step is extended to the first production promotion as a check with a recorded result. What happens on a non-zero count is tracked as a new objection."
        },
        {
          "id": "O-57",
          "how": "Proposer confirmed: service dbtests pre-insert the floor and assert an applied row; bracket_legs.side goes through the UpsertOrder helper with a mixed orders-plus-legs sum test; consumer_floors gets no generic API."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-20 — production scope, recorded by the orchestrator (verbatim)

Written by the orchestrating session itself.

- **Production is out of scope.** Operator, earlier the same day, on a pre-deploy action that named both environments:
  "And leave production out. It's never been out/launched". The post-round-6 cutover question was put on that premise
  ("Production has never launched, so the cutover happens once, on staging") and the operator selected
  "Stop-then-start on staging (Recommended)". Effect for this design: no production stop-then-start procedure and no
  production branch in the cutover. At most a check-only note that the first production promotion verifies the
  production database holds no `portfolio.positions` rows and no `order.filled` ledger rows, and stops for the
  operator if it does. How portfolio is stopped on each staging target is confirmed by the operator at execution
  time (the runbook step), not at design time.

## Session 2026-11-20 — sdd-batch design gate (round 9)

- `/sdd-design fix-position-fold-correctness` (full) halted at its approval gate after round 9 (gate policy: halt). design.md NOT written; status.md unchanged (spec-ready). Register: `debate.md` (D-1..D-47, R-1..R-34, O-1..O-64, P-1..P-8). Round 9 settled D-46 and D-47, locked R-34, closed O-58, O-59, O-60 and O-62, opened O-63 and O-64, and filed P-8 (REOPEN D-40, pending user). Nothing was reopened; P-5..P-7 are still pending user.

## Open Threads

- **Approach (round-9 synthesis).** The round-8 synthesis stands as written (D-1..D-3, D-5..D-16, D-18..D-45). Round 9 only pins the adoption trigger and the production form.
  - **Adoption trigger (D-46).** Each tick, `pollBracketLegFills` runs the D-40 candidate query first. It then makes one `Broker.ListOrders` call per account, for the union of accounts with a non-retired `trading.bracket_legs` row and accounts with at least one adoption candidate. The same call serves adoption and tracked-leg observation. Adoption runs every tick and makes no `GetOrder` call.
  - **Failure cases.** A failed `ListOrders` inserts nothing and the account's candidates are retried next tick. If the candidate query fails, accounts with tracked legs are still listed and observed, nothing is adopted, and the error is logged once.
  - **Production (D-47).** Check only. Before the first production promotion, record the `portfolio.positions` and ledger `order.filled` row counts on each production database, and stop for the operator if either is non-zero. No production stop-then-start or HALTED procedure is designed (R-34), following the operator ruling "And leave production out. It's never been out/launched" (`context.md:2137`).
  - **Tests added (trading).** Zero `bracket_legs` rows plus one open ACTIVE leg is adopted with exactly one `ListOrders` call and no `GetOrder` call. An account with no candidates and no tracked rows gets no `ListOrders` call. The candidate-query-error case behaves as above.
- **Strongest open objection.** O-63, non-blocking: steady-state adoption cost. Nothing moves a bracket off ACTIVE, and under D-40 a candidate the broker does not list as open is never inserted, so it stays a candidate forever. Every account with such bracket history gets a `ListOrders` call and a candidate re-scan on every 5 s tick, plus a failure WARN each tick while its broker is down. `/sdd-spec` must state the cost per account and the candidate query's row count, or add a partial index in `012`. The adversary's fix (insert a closed-out row so each candidate is evaluated once) contradicts settled D-40, so it is filed as P-8 for the operator.
- **Floor status.** No Floor breach, and no blocking objection is open. Both round-8 blocking objections (O-58, O-59) are closed and the adversary rates the design sound. The gate waits on the operator.
- **Uncovered @AC changes.** None; unchanged from round 8. `@AC-5` CHANGE is covered by the operator's C-16 sign-off. 251 @AC-17, 206 trading @AC-1 and 294 @AC-56 are EXTEND, each covered by a recorded ruling. @AC-1..@AC-4, 251 @AC-14, 206 trading @AC-2, 294 @AC-6 and 290 @AC-3 are PRESERVE.
- **Operator sign-offs still needed.**
  - **P-8 (REOPEN D-40).** Whether a candidate that a successful `ListOrders` does not show open gets a closed-out row (no emit, `observed_filled_qty = 0`). Declining keeps the per-tick cost named in O-63.
  - **Cutover confirmations (O-61),** to be answered before `/sdd-execute` reaches the integration step; the list is unchanged from the round-8 entry. The same item now carries the question to ask if a production count is non-zero.
  - **Register verdicts (O-56).** P-5, P-6 and P-7 recorded as "user reopened" citing `context.md:1535-1541`, and P-4 as withdrawn.
- **Non-blocking, for `/sdd-spec`.**
  - **O-64 (test scaffolding).** `fakeBroker.ListOrders` panics on purpose (`trading_bracket_test.go:85-87`), so every existing `pollFills` or bracket test whose fake repo holds an ACTIVE bracket with leg ids will panic, e.g. `TestPollFills_PartialFillResizesActiveBracket` (`:416`). The spec's Files list must include a `fakeBroker` `listOrdersFn` and call counter (precedent: `fakeReconciliationBroker`, `trading_reconciliation_test.go:80,101-102`), the `fakeBracketRepo` candidate query, and each affected test.
  - **O-30.** The analysis AC ids in `order-snapshots-pnl-patterns.feature` and `fix-python-loop-supervision.feature` are still to be enumerated, and the D-10 flip-short window residual stays named.
  - **Carried under O-63.** The `012` DDL comment gives the `adopted` column's single purpose.

```sdd-batch-design-state
{
  "round": 9,
  "synth": {
    "approach": "Round-9 synthesis. The round-8 synthesis stands as written (sections 1-3 and 6-8, cutover, rollback rule, 012 as DDL only, adoption, tests, build order; D-1..D-3, D-5..D-16, D-18..D-28, D-31..D-45). This round only pins the adoption trigger and the production form. All paths are under `/home/user/xstockstrat/.claude/worktrees/orch-311`.\n\nVerified this round\n- `fakeBroker.ListOrders` panics on purpose (`services/xstockstrat-trading/internal/service/trading_bracket_test.go:85-87`).\n- The `listOrdersFn` precedent exists on `fakeReconciliationBroker` (`services/xstockstrat-trading/internal/service/trading_reconciliation_test.go:80,101-102`).\n- The operator's words 'And leave production out. It's never been out/launched' are in `docs/roadmap/features/311-fix-position-fold-correctness/context.md:2137`, in the worktree and on `origin/feature/fix-position-fold-correctness`.\n- `reconcileTick` throttles halted accounts through `shouldPollHaltedAccount` (`services/xstockstrat-trading/internal/service/trading.go:2075,2848`).\n\n1. ADOPTION TRIGGER (closes O-58; fills the gap D-40 left open)\n- Each tick, `pollBracketLegFills` (the D-22 callee after `logTick`) runs the D-40 candidate query first.\n- The accounts it lists are the union of (a) accounts with at least one non-retired `trading.bracket_legs` row and (b) accounts with at least one adoption candidate. `order_brackets.account_id` exists (`services/xstockstrat-trading/migrations/005_broker_accounts_halted.up.sql:15`), so no join is needed to group by account.\n- One `Broker.ListOrders` call per account per tick (`services/xstockstrat-trading/internal/broker/broker.go:74`), shared by adoption and tracked-leg observation. An account in both groups is listed once.\n- Adoption makes no `GetOrder` call. Under D-15, the first leg-emit failure stops emits for the tick but not adoption inserts.\n- A failed `ListOrders` for an account inserts nothing; its candidates are retried next tick (R-10).\n- If the candidate query fails, accounts with tracked legs are still listed and observed that tick, nothing is adopted, and the error is logged once.\n- Cadence: adoption runs every tick, so brackets activated by an old trading instance during a rolling overlap are picked up.\n- D-40 is honoured as settled: a candidate the broker does not list as open is not inserted. The adversary's tombstone row is not adopted this round; it is a pending REOPEN D-40 petition.\n- Named residual: nothing moves a bracket off ACTIVE, so a candidate that is never listed open stays a candidate. Every account with such bracket history gets one `ListOrders` call and a candidate re-scan on every tick, and a `ListOrders` failure WARN every tick while its broker or credentials are down. The proposal's claim that the D-11 budget is unchanged is wrong for these accounts.\n\n2. PRODUCTION (closes O-59)\n- Check only. Before the first production promotion, record the counts of `portfolio.positions` rows and ledger `order.filled` rows on each production database, and stop for the operator if either is non-zero.\n- No production stop-then-start, HALTED procedure or other production mechanism is designed. The proposer's production stop-then-start is withdrawn.\n- A non-zero count contradicts the 'never launched' premise and is an operator stop, not a designed branch.\n\nTESTS added this round (trading)\n- Zero `bracket_legs` rows plus one ACTIVE `order_brackets` row whose leg the broker lists open at fill 0: exactly one `ListOrders` call for the account; one row inserted with `adopted = true`, `filled_qty = 0`, `observed_filled_qty = 0`; no `GetOrder` call.\n- An account with no candidates and no tracked rows gets no `ListOrders` call.\n- Candidate query errors: tracked-leg accounts are still listed and observed, nothing is adopted, one error log.\n\nSPEC FILES (for /sdd-spec, verified fact)\n- `fakeBroker` gains a `listOrdersFn` and a call counter, following `fakeReconciliationBroker`.\n- `fakeBracketRepo` gains the candidate query.\n- Every existing `pollFills` or bracket test whose fake repo holds an ACTIVE bracket with leg ids now reaches `ListOrders` and would panic. The clearest case is `TestPollFills_PartialFillResizesActiveBracket` (`trading_bracket_test.go:416`, leg `s1` at `:433`). Each such test goes in the spec's Files list.\n\nBUILD ORDER: unchanged from round 8.",
    "open_objections": [
      {
        "text": "Steady-state adoption cost. Nothing moves a bracket off ACTIVE (R-31), and under D-40 a candidate not listed open is not inserted, so it stays a candidate forever. Every account with bracket history gets a ListOrders call and a candidate re-scan on each 5 s tick, plus a failure WARN each tick while its broker is down. /sdd-spec must state the cost per account and the candidate query's row count, or add a partial index in 012. The tombstone fix needs the pending REOPEN D-40. Carried from O-60: the 012 DDL comment gives the adopted column's single purpose.",
        "blocking": false
      },
      {
        "text": "Test scaffolding (F-08, C-13). fakeBroker.ListOrders panics (trading_bracket_test.go:85-87), so existing pollFills and bracket tests whose fake repo holds an ACTIVE bracket with leg ids will panic once candidates trigger ListOrders (e.g. TestPollFills_PartialFillResizesActiveBracket, :416). The spec's Files list must include the fakeBroker listOrdersFn and call counter, the fakeBracketRepo candidate query, and every affected existing test.",
        "blocking": false
      },
      {
        "text": "O-61: operator-confirmation gate item, to be recorded in context.md and answered before /sdd-execute reaches the integration step (DO spec with portfolio removed versus the PRIVATE_DOMAIN references; doctl spec round-trip of secrets; homelab stop method; gate deploy exit code on rollback; trading's failed portfolio calls on paper staging; Alpaca listing bracket legs as top-level orders). The same item carries the question to ask the operator if a production count is non-zero.",
        "blocking": false
      },
      {
        "text": "O-30: the analysis AC ids in order-snapshots-pnl-patterns.feature and fix-python-loop-supervision.feature are still to be enumerated at /sdd-spec, and the D-10 flip-short window residual stays named.",
        "blocking": false
      },
      {
        "text": "O-56: the orchestrator still has to record P-5, P-6 and P-7 as 'user reopened' citing context.md:1535-1541, and P-4 as withdrawn.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "251 @AC-17",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "251 @AC-14",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "206 trading @AC-1",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "206 trading @AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "294 @AC-56",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "294 @AC-6",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "290 @AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "A stop-then-start (or HALTED-during-stop) procedure on production. Lost: the operator ruled production out of scope ('And leave production out. It's never been out/launched', context.md:2137); only the check-only form remains. Locked this round.",
      "Listing only accounts with tracked bracket_legs rows. Lost: with 012 DDL-only every account starts with zero rows, so adoption would never fire.",
      "A tombstone row for a candidate not listed open (adversary r9). Not adopted this round: it contradicts settled D-40 ('anything else is not inserted') and the steer says to change nothing else. It is a pending REOPEN D-40 petition, not locked.",
      "Adopting only in the first N ticks after boot plus a slow periodic sweep (adversary r9, self-rejected). Lost: it adds a cadence knob and misses legs activated by an old trading instance between sweeps. Not locked; only one side weighed it.",
      "Throttling candidate-only accounts to the 60 s reconciliation cadence (adversary r9). Not chosen: the candidate set stays unbounded and adoption is delayed. Not locked."
    ],
    "open_risks": [
      "New: every account with a never-listed-open ACTIVE or CANCELING candidate gets a ListOrders call and a candidate re-scan on every tick indefinitely, and a failure WARN each tick while its broker or credentials are down. The cost grows with bracket history.",
      "New: the candidate query now gates a broker call and scans unindexed status 3 rows (005:29-31); a slow query delays listing for candidate-only accounts.",
      "New: existing trading tests that hold an ACTIVE bracket with leg ids panic on fakeBroker.ListOrders until the fakes are extended.",
      "If a production count is non-zero, the promotion stops with no designed procedure; it waits on an operator ruling.",
      "The DO stop is unverified: .do/app.dev.yaml:78 and :319 reference ${xstockstrat-portfolio.PRIVATE_DOMAIN}, so a spec with the portfolio service removed may be rejected.",
      "The merge precondition and the main-dev freeze are not enforced; an overlap double-applies fills and only the recorded evidence shows it.",
      "On the homelab VM an unattended rollback of the integration deploy restores the pre-019 portfolio after the floor is stamped; noticing it depends on gate deploy exiting non-zero, which is unconfirmed.",
      "Fills appended between T_stop and the first new boot are acked: qty heals at the next sync, realized P&L for them is lost.",
      "While portfolio is stopped on staging, trading's portfolio calls fail: the risk check warns only, reconciliation skips, and flattenAndHalt cannot flatten.",
      "Adoption depends on Alpaca listing bracket legs as top-level orders in every open state; this is unverified.",
      "Reconciliation covers only tracked legs; the D-42 forward-only gap stays uncounted.",
      "A BASELINE_RETIRED leg's post-cutover remainder is neither emitted nor observed.",
      "Adopted IBKR legs that later vanish from the gateway are polled indefinitely (D-26).",
      "Late-commit appends whose recorded_at is below the floor are acked (operator-accepted).",
      "The floor assumes ledger and portfolio share one Postgres server clock.",
      "With the composite GetPnL key, a historical order whose partial and full fills carried different account_id values stops being deduplicated; the /sdd-spec history grep is the only check.",
      "A parked fill is retried only after a manual delete of its parked row.",
      "A fill transaction can wait server-side on the applied-row conflict or FOR UPDATE, holding 1 of 2 client connections and positionsMu.",
      "The pre-check has a TOCTOU window covered only by the in-tx INSERT conflict path.",
      "A position.updated can be emitted after a same-process sync has overwritten the row.",
      "Boot replay re-walks every post-floor fill and consumer_applied_events has no retention.",
      "A leg id is lost from tracking if the ActivateBracket tx fails; it is alerted, but its exit fill never folds.",
      "Neither broker adapter populates BrokerOrder.Fees, so fee totals understate.",
      "Migration numbers 019 and 012 may collide with feature 318.",
      "OQ-2 (repair of already-inflated accumulators) is out of scope, and instance_count must stay 1."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-08",
      "C-10",
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "F-01",
      "F-02",
      "F-04",
      "F-06",
      "F-07",
      "F-08",
      "P-02",
      "P-03",
      "P-04",
      "PLAT-N1"
    ],
    "rationale": "The design has no blocking objection and no Floor breach left. The adversary rates it SOUND, and both round-8 blocking pins are closed.\n\n**What I checked myself**\n- `fakeBroker.ListOrders` does panic (`trading_bracket_test.go:85-87`), and the `listOrdersFn` precedent exists (`trading_reconciliation_test.go:80,101-102`). The adversary's scaffolding objection is a fact, not something to discover at /sdd-spec.\n- The operator's production ruling is at `context.md:2137`, in the worktree and on the feature branch.\n\n**O-58 (closed).** The proposer answered it concretely: list the union of tracked-row accounts and candidate accounts, candidate query first, one call per account, with the zero-rows adoption test and a no-candidate no-call companion. The adversary confirmed it fills only the gap D-40 left open.\n\n**O-59 (closed).** The proposer withdrew the production stop-then-start and confirmed the check-only form, matching the operator ruling. The non-zero case is an operator stop; its question wording rides on the O-61 gate item.\n\n**What I took from the adversary (all non-blocking)**\n- **Candidate-query error test:** made required. The proposer already said tracked accounts must still be listed, so there is no dispute.\n- **Test scaffolding:** recorded as an open /sdd-spec item with the verified panic.\n- **Steady-state cost:** the adversary is right that the 'budget unchanged' claim is wrong. I named it as a residual and left it open for /sdd-spec to quantify.\n- **Tombstone fix:** not adopted. It contradicts settled D-40 and the steer says to change nothing else. I filed it as a REOPEN D-40 petition with new evidence, for the operator.\n\n**Housekeeping**\n- O-60 and O-62 are closed. The proposer confirmed the round-8 synthesis as written, which carried their items, and the every-tick trigger answers the cadence question. O-60's two leftovers (row count or index, DDL comment) move into the new cost objection.\n- O-30, O-56 and O-61 stay open and non-blocking.\n\n**Register check:** no settled D-n is contradicted, no locked R-n returns, nothing is reopened. Business rules are unchanged from round 8.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Adoption trigger and cadence, filling the gap D-40 left open: each tick pollBracketLegFills runs the D-40 candidate query first and issues one Broker.ListOrders per account for the union of accounts with a non-retired bracket_legs row and accounts with at least one adoption candidate, shared by adoption and D-11 observation. Adoption runs every tick and makes no GetOrder call. A failed ListOrders inserts nothing and retries next tick. If the candidate query fails, tracked-leg accounts are still listed and observed, nothing is adopted and the error is logged once. Required tests: zero bracket_legs rows plus one open ACTIVE leg is adopted with exactly one ListOrders and no GetOrder; an account with no candidates and no tracked rows gets no ListOrders; the candidate-query-error case.",
          "evidence": "operator steer r9 pin (1); D-11; D-39; D-40; R-10; broker.go:74; 005_broker_accounts_halted.up.sql:15; proposal r9 item 1 and Strongest risk; adversary r9 rated it sound and asked only that the error test be required"
        },
        {
          "text": "Production is check-only: before the first production promotion, record the counts of portfolio.positions rows and ledger order.filled rows on each production database and stop for the operator if either is non-zero. No production stop-then-start, HALTED procedure or other production mechanism is designed; a non-zero count is an operator stop.",
          "evidence": "context.md:2137 (operator: 'And leave production out. It's never been out/launched'); operator steer r9 pin (2); D-43; proposal r9 item 2; adversary r9 confirmed"
        }
      ],
      "new_rejected": [
        {
          "text": "A stop-then-start or HALTED-during-stop procedure on production",
          "why": "The operator ruled production out of scope because it has never launched (context.md:2137); only the check-only form remains, and the proposer withdrew the branch in round 9."
        }
      ],
      "new_objections": [
        {
          "text": "Steady-state adoption cost: nothing moves a bracket off ACTIVE, and under D-40 a candidate not listed open is never inserted, so every account with bracket history gets a ListOrders call and a candidate re-scan on each tick indefinitely, plus a failure WARN each tick while its broker is down. /sdd-spec must state the per-account cost and the candidate query's row count or add a partial index in 012; the tombstone fix waits on the REOPEN D-40 petition. Carried from O-60: the 012 DDL comment gives the adopted column's single purpose.",
          "blocking": false
        },
        {
          "text": "Test scaffolding: fakeBroker.ListOrders panics (trading_bracket_test.go:85-87), so existing pollFills and bracket tests holding an ACTIVE bracket with leg ids will panic (e.g. TestPollFills_PartialFillResizesActiveBracket, :416). The spec's Files list must include the fakeBroker listOrdersFn and call counter, the fakeBracketRepo candidate query, and every affected existing test.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-58",
          "how": "pollBracketLegFills issues ListOrders for the union of accounts with tracked rows and accounts with at least one adoption candidate, with the zero-rows/one-open-ACTIVE-leg adoption test and the no-candidate no-call companion. The resulting steady-state cost is tracked as a new objection."
        },
        {
          "id": "O-59",
          "how": "The proposer withdrew the production stop-then-start and confirmed the check-only form under the operator ruling at context.md:2137. A non-zero count is an operator stop; the question to ask then is carried on the O-61 gate item."
        },
        {
          "id": "O-60",
          "how": "The proposer confirmed the round-8 synthesis as written, which carries the D-19 non-terminal predicate with the held-leg test and the full parent-derived column join with the 251-payload test; adoption now runs every tick, which covers the rolling overlap. The row-count-or-index and DDL-comment items are tracked under the new cost objection."
        },
        {
          "id": "O-62",
          "how": "The proposer confirmed the round-8 synthesis as written, which carries the freeze evidence in the recorded result and the statement that the DELETE-floor step applies on DO only after a deliberate console rollback (D-43, D-44)."
        }
      ],
      "reopen_petitions": [
        {
          "target": "D-40",
          "evidence": "Adversary r9: with the union trigger pinned this round, D-40's 'anything else is not inserted' leaves every never-listed-open ACTIVE or CANCELING candidate a candidate forever (nothing moves a bracket off ACTIVE, R-31), so each such account gets a ListOrders call and re-scan on every 5 s tick indefinitely; reconcileTick makes the same call only every 60 s and throttles halted accounts (trading.go:2075,2848). Requested amendment: after a successful ListOrders that does not show a candidate open, insert a closed-out row (no emit, observed_filled_qty = 0) so each candidate is evaluated once. The trigger was not on record before round 9.",
          "is_new": true
        }
      ],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-20 — D-40 reopen, recorded by the orchestrator (verbatim)

Written by the orchestrating session itself.

- **REOPEN D-40 granted.** Question: "round 9 is rated sound with no blocking objection. One cost is left for you.
  Because nothing ever moves a bracket off ACTIVE, every account with any bracket history gets one broker ListOrders
  call on every 5-second fill-poller tick, forever, even when nothing is left to adopt … The adversary's fix is a
  'tombstone': once a successful ListOrders shows a candidate leg is not open, write a closed-out row for it so it is
  evaluated only once. That changes settled decision D-40 and costs one more debate round. Which do you want?"
  Operator selected: "Reopen D-40, add tombstone (Recommended)". Effect: after a successful `ListOrders` that does not
  show a candidate open, insert a closed-out `trading.bracket_legs` row for it (no emit, `observed_filled_qty = 0`),
  so each candidate is evaluated once. A failed `ListOrders` still inserts nothing (R-10).

## Session 2026-11-20 — sdd-batch design gate (round 10)

- `/sdd-design fix-position-fold-correctness` (full) halted at its approval gate after round 10 (gate policy: halt). design.md NOT written; status.md unchanged (spec-ready). Register: `debate.md` (D-1..D-48, R-1..R-36, O-1..O-66, P-1..P-8). Round 10 settled D-48, locked R-35 and R-36, closed O-63, opened O-65 (blocking) and O-66, and reopened D-40 on the operator steer (`context.md:2372-2383`). No petition was filed; P-4..P-8 still carry "pending user" in the register (O-56).

## Open Threads

- **Approach (round-10 synthesis).** The round-9 synthesis stands as written (D-1..D-3, D-5..D-16, D-18..D-28, D-31..D-39, D-41..D-47). Round 10 changes only the D-40 adoption classifier, under the operator's REOPEN D-40.
  - **Tombstone row (D-48).** After a successful `Broker.ListOrders`, a candidate listed in a terminal state gets a `trading.bracket_legs` row with `status = 'NOT_OPEN_AT_ADOPTION'`, `filled_qty = 0`, `observed_filled_qty = 0` and `adopted = true`. Symbol and side come from the read-only parent join (D-41). There is no ledger emit and no `GetOrder` call, and the insert is `ON CONFLICT DO NOTHING`.
  - **Retired everywhere.** `NOT_OPEN_AT_ADOPTION` counts as retired in the D-46 tracked-account set, the D-11 observation set and the `GetOrder` fallback. An account with only retired rows and no candidates gets no `ListOrders` call.
  - **Unchanged cases.** A candidate listed open at fill 0 is inserted as tracked; one listed open at fill > 0 is inserted `BASELINE_RETIRED`. A failed `ListOrders` inserts nothing (R-10).
  - **Insert failure.** A failed tombstone INSERT is one WARN for the tick. The candidate is retried next tick and tracked-leg observation in that tick is unaffected.
  - **Reconciliation.** A tombstone adds 0 to `NetFilledQtyBySymbol` (D-37). Its leg id stays known through the D-20 `bracket_legs` branch, including after `resizeBracket` blanks the `order_brackets` leg ids (`trading.go:3612`).
  - **Absent candidates (not settled).** The synthesis carries the adversary's complete-list gate: absence tombstones a candidate only when the list is non-empty, and under the 500-row cap for Alpaca. Otherwise nothing is inserted and the candidate is retried next tick. D-48 deliberately leaves this condition out.
  - **Tests added (trading).** Listed-terminal tombstone; absent from a 499-row Alpaca list; exactly 500 Alpaca rows without the candidate (no insert); empty IBKR 200 (no insert); `ListOrders` error; tombstone INSERT error; a mixed account with exactly one `ListOrders`; repo dbtests for `NetFilledQtyBySymbol` and `KnownBrokerOrderIDs`. The listed-open tests are kept unchanged.
- **Strongest open objection.** O-65, blocking: absence from an empty or truncated `ListOrders` must not tombstone a candidate.
  - **Evidence.** IBKR `ListOrders` returns an empty slice with a nil error on any 200 with no orders (`ibkr.go:448-482`), so one empty response would permanently tombstone every candidate on the account. Alpaca's list is capped at 500 rows with no paging (`alpaca.go:373-376`).
  - **What the proposer owes.** Confirm the complete-list gate with the empty-IBKR, 500-row and 499-row tests, or give a better gate. The proposer has not answered yet.
  - **IBKR residual.** An idle IBKR account legitimately returns an empty list, so under the gate it never tombstones and keeps its per-tick `ListOrders` call. That is the cost the operator reopened D-40 to remove. The gate also narrows the operator's "evaluated once" (`context.md:2381-2383`); if the proposer cannot bound this case, the reading goes to the operator.
- **Floor status.** No Floor breach. The design is not approvable this round: O-65 is open and blocking, and the adversary rates the round NEEDS WORK.
- **Uncovered @AC changes.** None. `@AC-5` CHANGE is covered by the operator's C-16 sign-off. 251 @AC-17, 206 trading @AC-1 and 294 @AC-56 are EXTEND, each covered by a recorded ruling. @AC-1..@AC-4, 251 @AC-14, 206 trading @AC-2 and @AC-3, 294 @AC-6 and 290 @AC-3 are PRESERVE; 206 trading @AC-3 is new to the list this round.
- **Operator sign-offs still needed.**
  - **O-65 reading,** only if the proposer cannot bound the idle-IBKR case: whether "evaluated once" may be narrowed by the complete-list gate.
  - **Cutover confirmations (O-61),** to be answered before `/sdd-execute` reaches the integration step; the list is unchanged from the round-8 entry.
  - **Register verdicts (O-56).** P-5, P-6 and P-7 recorded as "user reopened" citing `context.md:1535-1541`, P-4 as withdrawn, and now P-8 as "user reopened" citing `context.md:2372-2383`.
- **Non-blocking, for the proposer and `/sdd-spec`.**
  - **O-66.** Proposer to confirm the items adopted from adversary r10: one INFO log per tombstone (`reason`, `account_id`, `leg_order_id`, bracket `order_id`); the runbook redelivery path (delete the `bracket_legs` row); one Go constant for the retired-status set, read by the fakes (C-18); the corrected `KnownBrokerOrderIDs` statement with a resize-blanked tombstone test. `/sdd-spec` states the candidate anti-join's scan cost against the 005 indexes, and the `012` DDL comment gives the `adopted` column's single purpose.
  - **O-64, extended.** The fakes also need the tombstone insert and the retired-status filter.
  - **O-30.** The analysis AC ids are still to be enumerated, and the D-10 flip-short window residual stays named.
- **New named residuals.**
  - An Alpaca account that always returns 500 rows keeps the per-tick call for candidates outside the list.
  - A genuinely open leg that is absent from a complete list on its evaluation tick is tombstoned for good; its exit fill never reaches the ledger, the fold or reconciliation.
  - A tombstone is undone only by a manual delete of its `bracket_legs` row.

```sdd-batch-design-state
{
  "round": 10,
  "synth": {
    "approach": "Round-10 synthesis. The round-9 synthesis stands as written (D-1..D-3, D-5..D-16, D-18..D-28, D-31..D-39, D-41..D-47, build order, cutover, production check-only). The only change is the D-40 adoption classifier, amended under the operator's REOPEN D-40. All paths are under `/home/user/xstockstrat/.claude/worktrees/orch-311`.\n\nVerified this round\n- The operator ruling is recorded verbatim at `docs/roadmap/features/311-fix-position-fold-correctness/context.md:2372-2383` (\"Reopen D-40, add tombstone (Recommended)\").\n- `IBKRClient.ListOrders` returns an empty slice with a nil error on any 200 whose `orders` array is empty or missing (`services/xstockstrat-trading/internal/broker/ibkr.go:448-482`).\n- Alpaca `ListOrders` is `status=all&limit=500` with no paging (`services/xstockstrat-trading/internal/broker/alpaca.go:373-376`).\n- `KnownBrokerOrderIDs` already unions both `order_brackets` leg-id columns (`services/xstockstrat-trading/internal/repository/trading_repo.go:135-150`).\n\n1. AMENDED ADOPTION CLASSIFIER (inside `pollBracketLegFills`, after a successful `Broker.ListOrders` for the account; candidates as in D-40)\n- Listed and open (D-19 non-terminal predicate) at fill 0: unchanged. Insert tracked, `adopted = true`, `filled_qty = 0`.\n- Listed and open at fill > 0: unchanged. Insert `BASELINE_RETIRED`, no emit, `observed_filled_qty = FilledQty`.\n- Listed in a terminal state: insert a tombstone on any successful list.\n- Absent from the list: insert a tombstone only when the list is complete evidence. Complete means non-empty and shorter than the 500 cap for Alpaca, and non-empty for IBKR. Otherwise nothing is inserted and the candidate is retried next tick (the D-46 retry). This gate is adopted from adversary r10 and is not yet confirmed by the proposer; see the blocking objection.\n- `ListOrders` failed: nothing is inserted (R-10).\n- Tombstone INSERT failed: one WARN for the tick, the candidate is retried next tick, and tracked-leg observation in the same tick is unaffected.\n\n2. THE TOMBSTONE ROW\n- `status = 'NOT_OPEN_AT_ADOPTION'`, a new retired status next to `BASELINE_RETIRED` and `UNKNOWN`.\n- `filled_qty = 0`, `observed_filled_qty = 0`, `adopted = true`.\n- Symbol and side come from the read-only parent `trading.orders` join (D-41).\n- No ledger emit and no `GetOrder` call.\n- `INSERT ... ON CONFLICT (account_id, leg_order_id) DO NOTHING`.\n- Every non-retired predicate counts it as retired: the D-46 tracked-account set, the D-11 observation set and the D-11 `GetOrder` fallback. An account whose only rows are retired and that has no candidates gets no `ListOrders` call.\n- If 012 declares a status CHECK or list, it gains the new value. 012 stays DDL only (D-39).\n\n3. EFFECT ON RECONCILIATION\n- `NetFilledQtyBySymbol` (D-37): a tombstone adds 0 to the `observed_filled_qty` sum, so the result is the same with or without the row.\n- `KnownBrokerOrderIDs` (D-20): at insert time the tombstone's id is already in the `order_brackets` union, so the set is unchanged. After `resizeBracket` blanks the `order_brackets` leg ids (`services/xstockstrat-trading/internal/service/trading.go:3612`), the id survives only through the D-20 `bracket_legs` branch and stays known. That is the intended D-20 effect. The proposal's \"set is unchanged\" holds only at insert time.\n\n4. ADOPTED FROM ADVERSARY r10, awaiting proposer confirmation (non-blocking)\n- One INFO log per tombstone with `reason=listed_terminal|absent`, `account_id`, `leg_order_id` and the bracket `order_id`.\n- The runbook names the redelivery path: delete the `bracket_legs` row and the next tick re-evaluates the leg.\n- The retired-status set is one Go constant bound into every SQL predicate; the fakes read the same constant (C-18).\n\nTESTS (trading, this round)\n1. Candidate listed FILLED or CANCELED: one row with `NOT_OPEN_AT_ADOPTION`, both quantities 0, `adopted = true`; no ledger append, no `GetOrder`; next tick the account gets zero `ListOrders` calls and the candidate query returns nothing for it.\n2. Candidate absent from a complete list (Alpaca 499 rows): tombstone, same assertions.\n3. Alpaca list of exactly 500 rows without the candidate: no insert; listed again next tick.\n4. Empty IBKR 200: no insert; listed again next tick.\n5. `ListOrders` error: no insert; the candidate is still present next tick and `ListOrders` is called again.\n6. Tombstone INSERT error: one WARN, retry next tick, tracked legs still observed.\n7. Mixed account (one tracked leg, one tombstone, one new open candidate): exactly one `ListOrders`; the tombstone never enters the `GetOrder` fallback.\n8. Repo dbtest, `NetFilledQtyBySymbol`: an orders row plus a tombstone on the same symbol equals the orders row alone.\n9. Repo dbtest, `KnownBrokerOrderIDs`: same set with and without a tombstone for an id still in `order_brackets`; a resize-blanked tombstoned leg stays known.\n10. The listed-open fill-0 and fill>0 tests are kept unchanged.\n\nSPEC FILES (extends O-64): the `fakeBroker` `listOrdersFn` and call counter and the `fakeBracketRepo` candidate query also need the tombstone insert and the retired-status filter.\n\nNAMED RESIDUALS\n- An IBKR account whose gateway returns an empty order list keeps its candidates and its per-tick `ListOrders` call. An idle IBKR account with old ACTIVE brackets may sit in this state indefinitely, so the cost bound the operator asked for is not reached there.\n- An Alpaca account that always returns 500 rows keeps the per-tick call for candidates outside the list.\n- A genuinely open leg that is absent from a complete list on its evaluation tick is tombstoned for good. Its exit fill never reaches the ledger, the fold or reconciliation (the D-42 gap made final).",
    "open_objections": [
      {
        "text": "Absence from an empty or truncated ListOrders must not tombstone a candidate (adversary r10; D-26's rationale and R-10's reason). IBKR ListOrders returns an empty slice with nil error on any 200 with no orders (ibkr.go:448-482), so one gateway blip would permanently tombstone every candidate on the account; Alpaca's list is capped at 500 (alpaca.go:376). The synthesis adopts the complete-list gate (terminal-listed tombstones on any successful list; absence tombstones only when the list is non-empty, and under 500 rows for Alpaca) with the three tests. The proposer has not answered. The proposer must confirm the gate or give a better one, and must address the IBKR residual: an idle IBKR account that legitimately returns an empty list never tombstones, so its per-tick call continues. The gate narrows the operator's words 'evaluated exactly once' (context.md:2381-2383); if the proposer cannot bound the IBKR case, that reading goes to the operator.",
        "blocking": true
      },
      {
        "text": "Proposer to confirm the items adopted from adversary r10: one INFO log per tombstone with reason, account_id, leg_order_id and bracket order_id; the runbook delete-the-row redelivery path; one Go constant for the retired-status set bound into every predicate and read by the fakes (C-18); the corrected KnownBrokerOrderIDs statement with the resize-blanked tombstone test. /sdd-spec must also state the candidate anti-join's scan cost against the 005 indexes (005_broker_accounts_halted.up.sql:29-31), not only the returned row count, and the 012 DDL comment must give the adopted column's single purpose (carried from O-63).",
        "blocking": false
      },
      {
        "text": "O-64 (test scaffolding), extended: the spec's Files list must include the fakeBroker listOrdersFn and call counter, the fakeBracketRepo candidate query with the tombstone insert and retired-status filter, and every existing test that holds an ACTIVE bracket with leg ids (e.g. TestPollFills_PartialFillResizesActiveBracket, trading_bracket_test.go:416).",
        "blocking": false
      },
      {
        "text": "O-61: operator-confirmation gate item, recorded in context.md and answered before /sdd-execute reaches the integration step (DO spec with portfolio removed versus the PRIVATE_DOMAIN references; doctl spec round-trip of secrets; homelab stop method; gate deploy exit code on rollback; trading's failed portfolio calls on paper staging; Alpaca listing bracket legs as top-level orders). It also carries the question to ask if a production count is non-zero.",
        "blocking": false
      },
      {
        "text": "O-30: the analysis AC ids in order-snapshots-pnl-patterns.feature and fix-python-loop-supervision.feature are still to be enumerated at /sdd-spec, and the D-10 flip-short window residual stays named.",
        "blocking": false
      },
      {
        "text": "O-56: the orchestrator still has to record P-5, P-6 and P-7 as 'user reopened' citing context.md:1535-1541, P-4 as withdrawn, and now P-8 as 'user reopened' citing context.md:2372-2383.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "251 @AC-17",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "251 @AC-14",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "206 trading @AC-1",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "206 trading @AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "206 trading @AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "294 @AC-56",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "294 @AC-6",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "290 @AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Reusing the UNKNOWN status for the tombstone. Lost: UNKNOWN means the 3-tick Alpaca 404 retirement (D-26), and mixing the two would muddle triage. The adversary did not contest. Locked this round.",
      "A listed-terminal tombstone that records the listed FilledQty as observed_filled_qty. Lost: it contradicts the operator ruling's observed_filled_qty = 0 (context.md:2382) and changes the reconciliation sums. Locked this round.",
      "Tombstone on absence from any successful list, whatever its completeness (proposal r10). Not chosen in this synthesis: an empty IBKR 200 or a full 500-row Alpaca list would permanently tombstone open legs. Not locked; it is the subject of the blocking objection.",
      "Tombstone only on a listed terminal status, never on absence (adversary r10, self-rejected). Lost: candidates missing from the list keep the per-tick call, and it is narrower than the ruling's 'does not show open'. Not locked; it may return if the IBKR empty-list case cannot be bounded.",
      "Tombstone on absence across N consecutive successful lists (adversary r10, self-rejected). Lost: it still fails on a truncated Alpaca list and needs a counter column. Not locked; only one side weighed it.",
      "A partial index in 012 for the candidate query. Not chosen: the tombstone shrinks the returned set through the existing anti-join. Not locked; /sdd-spec states the scan cost first."
    ],
    "open_risks": [
      "New: an IBKR account that returns an empty order list never tombstones its candidates, so its per-tick ListOrders call continues; this may be the normal state of an idle IBKR account.",
      "New: an Alpaca account that always returns 500 rows keeps the per-tick call for candidates outside the list.",
      "New: a genuinely open leg absent from a complete list on its evaluation tick is tombstoned permanently; its exit fill never reaches the ledger, the fold or reconciliation.",
      "New: a tombstone is undone only by a manual delete of its bracket_legs row.",
      "The candidate anti-join still scans every ACTIVE or CANCELING order_brackets row each tick; only the returned set shrinks (005:29-31).",
      "Existing trading tests that hold an ACTIVE bracket with leg ids panic on fakeBroker.ListOrders until the fakes are extended.",
      "If a production count is non-zero, the promotion stops with no designed procedure; it waits on an operator ruling.",
      "The DO stop is unverified: .do/app.dev.yaml:78 and :319 reference ${xstockstrat-portfolio.PRIVATE_DOMAIN}, so a spec with the portfolio service removed may be rejected.",
      "The merge precondition and the main-dev freeze are not enforced; an overlap double-applies fills and only the recorded evidence shows it.",
      "On the homelab VM an unattended rollback of the integration deploy restores the pre-019 portfolio after the floor is stamped; noticing it depends on gate deploy exiting non-zero, which is unconfirmed.",
      "Fills appended between T_stop and the first new boot are acked: qty heals at the next sync, realized P&L for them is lost.",
      "While portfolio is stopped on staging, trading's portfolio calls fail: the risk check warns only, reconciliation skips, and flattenAndHalt cannot flatten.",
      "Adoption depends on Alpaca listing bracket legs as top-level orders in every open state; this is unverified.",
      "Reconciliation covers only tracked legs; the D-42 forward-only gap stays uncounted.",
      "A BASELINE_RETIRED leg's post-cutover remainder is neither emitted nor observed.",
      "Adopted IBKR legs that later vanish from the gateway are polled indefinitely (D-26).",
      "Late-commit appends whose recorded_at is below the floor are acked (operator-accepted).",
      "The floor assumes ledger and portfolio share one Postgres server clock.",
      "With the composite GetPnL key, a historical order whose partial and full fills carried different account_id values stops being deduplicated; the /sdd-spec history grep is the only check.",
      "A parked fill is retried only after a manual delete of its parked row.",
      "A fill transaction can wait server-side on the applied-row conflict or FOR UPDATE, holding 1 of 2 client connections and positionsMu.",
      "The pre-check has a TOCTOU window covered only by the in-tx INSERT conflict path.",
      "A position.updated can be emitted after a same-process sync has overwritten the row.",
      "Boot replay re-walks every post-floor fill and consumer_applied_events has no retention.",
      "A leg id is lost from tracking if the ActivateBracket tx fails; it is alerted, but its exit fill never folds.",
      "Neither broker adapter populates BrokerOrder.Fees, so fee totals understate.",
      "Migration numbers 019 and 012 may collide with feature 318.",
      "OQ-2 (repair of already-inflated accumulators) is out of scope, and instance_count must stay 1."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-08",
      "C-10",
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "F-01",
      "F-02",
      "F-04",
      "F-06",
      "F-07",
      "F-08",
      "P-02",
      "P-03",
      "P-04",
      "PLAT-N1"
    ],
    "rationale": "The design is not approvable this round: one blocking objection is open. The adversary rates it NEEDS WORK, with no Floor breach.\n\n**What is settled.** The tombstone itself is agreed by both sides and matches the operator's ruling (context.md:2372-2383): status `NOT_OPEN_AT_ADOPTION`, both quantities 0, no emit, no `GetOrder`, counted as retired everywhere, nothing inserted on a failed `ListOrders`. A candidate listed in a terminal state is tombstoned on any successful list. I recorded that as the new decision and left the absence condition out of it.\n\n**The blocking objection.** The proposal tombstones a candidate that is merely absent from any successful list. I checked the code: IBKR `ListOrders` returns an empty slice with a nil error on any 200 with no orders (ibkr.go:448-482), and Alpaca's list is capped at 500 (alpaca.go:376). One empty IBKR response would permanently tombstone every candidate on the account. That is the failure R-10 was locked to prevent, although R-10's letter covers tracked legs only.\n\nI put the adversary's complete-list gate into the approach because it is the reversible choice: a candidate left alone is retried, a tombstone is permanent. The proposer has not answered it, so the objection stays open and blocking.\n\n**One thing the adversary understated.** An idle IBKR account legitimately returns an empty list. Under the gate such an account never tombstones, so its per-tick call continues. That is the cost the operator reopened D-40 to remove, and it may be the common IBKR case, not \"a few accounts\". The gate also narrows the operator's \"evaluated exactly once\". The proposer must bound this case or the reading goes to the operator.\n\n**Register note on D-26.** The adversary called the proposal in tension with D-26. D-26's text is about `GetOrder` responses, so I treat this as a conflict with its rationale, not a register violation.\n\n**Other adversary items (non-blocking).** I adopted the INFO log, the runbook delete path, the single retired-status constant and the corrected `KnownBrokerOrderIDs` statement, all pending proposer confirmation. The scan-cost statement goes to /sdd-spec.\n\n**Housekeeping.** O-63 is closed: the cost fix it waited on is now decided, and its leftovers move to the new confirm objection. O-64, O-61, O-30 and O-56 stay open and non-blocking. D-40 is reopened by the operator steer. No other settled D-n is contradicted and no locked R-n returns. Business rules are unchanged; I added 206 trading @AC-3 as PRESERVE because the adversary checked it.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "D-40 amended under the operator's reopen, superseding its 'anything else is not inserted' clause: after a successful ListOrders, a candidate listed in a terminal state gets a tombstone row in trading.bracket_legs with status NOT_OPEN_AT_ADOPTION, filled_qty = 0, observed_filled_qty = 0, adopted = true, symbol and side from the read-only parent join, no ledger emit, no GetOrder call, INSERT ON CONFLICT DO NOTHING. NOT_OPEN_AT_ADOPTION is a retired status in every non-retired predicate (the D-46 tracked-account set, the D-11 observation set and the GetOrder fallback). A failed ListOrders inserts nothing. A failed tombstone INSERT is one WARN per tick with a retry next tick and does not affect tracked-leg observation. A tombstone adds 0 to NetFilledQtyBySymbol and keeps its leg id known through the D-20 branch. When absence from the list tombstones a candidate is not part of this decision. All other D-40 clauses stand.",
          "evidence": "context.md:2372-2383 (operator: 'Reopen D-40, add tombstone (Recommended)'); operator steer r10; P-8; trading_repo.go:135-150,171-186; trading.go:3612; D-37; D-20; D-39; D-41; R-10; proposal r10; adversary r10 contested only absence from an empty or truncated list"
        }
      ],
      "new_rejected": [
        {
          "text": "Reusing the UNKNOWN status for the adoption tombstone",
          "why": "UNKNOWN means the 3-consecutive-tick Alpaca 404 retirement (D-26); one status for both would muddle triage. Proposal r10 rejected it and adversary r10 did not contest."
        },
        {
          "text": "A listed-terminal tombstone that records the listed FilledQty as observed_filled_qty",
          "why": "It contradicts the operator ruling's observed_filled_qty = 0 (context.md:2382) and changes the reconciliation sums. Adversary r10 raised it only as an out-of-bounds alternative."
        }
      ],
      "new_objections": [
        {
          "text": "Absence from an empty or truncated ListOrders must not tombstone a candidate: IBKR ListOrders returns an empty slice with nil error on any 200 with no orders (ibkr.go:448-482) and Alpaca's list is capped at 500 (alpaca.go:376). The proposer must confirm the complete-list gate (terminal-listed tombstones on any successful list; absence tombstones only when the list is non-empty, and under 500 rows for Alpaca) with the empty-IBKR, 500-row and 499-row tests, or give a better gate, and must bound the case of an idle IBKR account that legitimately returns an empty list and so never tombstones. The gate narrows the operator's 'evaluated exactly once' (context.md:2381-2383); if the IBKR case cannot be bounded, the reading goes to the operator.",
          "blocking": true
        },
        {
          "text": "Proposer to confirm the items adopted from adversary r10: one INFO log per tombstone with reason, account_id, leg_order_id and bracket order_id; the runbook delete-the-row redelivery path; one Go constant for the retired-status set bound into every predicate and read by the fakes; the corrected KnownBrokerOrderIDs statement with a resize-blanked tombstone test. /sdd-spec states the candidate anti-join's scan cost against the 005 indexes (005_broker_accounts_halted.up.sql:29-31), the 012 DDL comment gives the adopted column's single purpose, and the O-64 fakes gain the tombstone insert and retired-status filter.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-63",
          "how": "The operator granted REOPEN D-40 and the tombstone removes evaluated candidates from the per-tick set. The scan-cost statement and the adopted-column DDL comment are tracked under the new confirm objection; the accounts that still keep the per-tick call are tracked under the new blocking objection."
        }
      ],
      "reopen_petitions": [],
      "reopened": [
        "D-40"
      ]
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-20 — sdd-batch design gate (round 11)

- `/sdd-design fix-position-fold-correctness` (full) halted at its approval gate after round 11 (gate policy: halt). design.md NOT written; status.md unchanged (spec-ready). Register: `debate.md` (D-1..D-50, R-1..R-40, O-1..O-68, P-1..P-8). Round 11 settled D-49 and D-50, locked R-37..R-40, closed O-64, O-65 and O-66, and opened O-67 and O-68 (both non-blocking). No petition was filed and nothing was reopened; P-4..P-8 still carry "pending user" in the register (O-56).

## Open Threads

- **Approach (round-11 synthesis).** The round-10 synthesis stands as written (D-1..D-3, D-5..D-16, D-18..D-28, D-31..D-39, D-41..D-48). Round 11 only closes O-65. `trading.go` below means `services/xstockstrat-trading/internal/service/trading.go`.
  - **Complete-list gate (D-49).** After a successful `Broker.ListOrders`, a candidate absent from the list is tombstoned only when the list is non-empty, and for Alpaca also shorter than 500 rows. An empty IBKR 200, an Alpaca list of exactly 500 rows or a failed `ListOrders` inserts nothing; the candidate is re-evaluated on the account's next adoption list. A candidate listed in a terminal state is tombstoned on any successful list (D-48). Listed-open handling is unchanged.
  - **Adoption-only throttle (D-50).** An account with candidates but no non-retired `bracket_legs` row gets its adoption `ListOrders` only when a per-account cooldown has elapsed. The cooldown is `trading.reconciliation.interval_ms` (default 60000, live read), or `haltedPollInterval()` when the account is halted. No config key is added.
  - **Throttle mechanics.** The body of `shouldPollHaltedAccount` becomes one shared helper. `shouldPollHaltedAccount` keeps its signature and behaviour over `haltedLastPolled`; adoption uses a separate in-memory `adoptionLastListed` map under `haltedMu`. The stamp is taken when the call is allowed, so a failed list is throttled too. The map is empty at boot, so the first tick lists every adoption-only account. The change sits inside `pollBracketLegFills`, with no `StartFillPoller` or `reconcileTick` hunk.
  - **Tracked accounts.** An account with at least one non-retired tracked leg keeps one `ListOrders` per fill-poller tick (D-11, D-46), and adoption shares that list. An account that gains a tracked leg is listed every tick from the next tick.
  - **Steady-state `ListOrders` rate per account from `pollBracketLegFills`** (defaults: tick 5 s, interval 60 s, halted poll 300 s): tracked 12/min, unchanged; adoption-only 1/min, down from 12/min; adoption-only halted 0.2/min; no candidates and no tracked legs 0. `reconcileTick`'s own list is separate and unchanged, so an idle IBKR account totals about 2/min instead of 13/min.
  - **Adopted from adversary r11, not yet in a decision.** The proposer has not confirmed these four items (O-67, O-68):
    - **New-candidate bypass.** An adoption-only account whose candidate set contains an id not seen at its last allowed list is listed on this tick. This keeps the round-10 latency of about 5 s for a bracket activated by an old trading instance.
    - **`interval_ms <= 0`.** Adoption reads it as the 60000 default. `trading.go:1977-1983` keeps the previous interval on `<= 0`; it does not mean "every tick". "Always list" comes only from `halted_poll_interval_ms <= 0` on a halted account.
    - **Injected clock.** The shared helper takes `now`: `time.Now()` from `shouldPollHaltedAccount`, `s.clock()` from `pollBracketLegFills`.
    - **Invalid credentials.** Adoption-only accounts with `credentialsKnownInvalid` status are skipped before the list, and `broker.ErrInvalidCredentials` is handled as `reconcileTick` handles it: WARN and skip, no failure count (`trading.go:2068,2083-2086`).
  - **Tests added (trading, 11-20, each asserting the call count over N ticks).** 500-row Alpaca list without the candidate; idle IBKR with an empty 200; `interval_ms = 0` versus `halted_poll_interval_ms = 0`; tracked account with a candidate; halted adoption-only; `ListOrders` error on tick 1; candidate adopted and listed on the next tick; independence of the two maps, with `trading_reconciliation_test.go:486-503` unchanged; new-candidate bypass; known-invalid credentials.
- **Strongest open objection.** O-67, non-blocking: the proposer has to confirm the new-candidate bypass.
  - **Why it matters.** Without the bypass, the 60 s cooldown widens an existing path from about 5 s to about 60 s. A bracket activated by an old trading instance can fill inside the window and be tombstoned with `observed_filled_qty = 0` (D-48, R-36). Its exit never reaches the ledger or the fold, and `NetFilledQtyBySymbol` keeps the entry quantity against a flat broker position, which can halt the account (206 trading @AC-1).
  - **If declined.** The residual must name the false halt as well as the lost fill.
- **Floor status.** No Floor breach. No blocking objection is open, and the adversary rates the round SOUND. O-65 is closed, so the "evaluated exactly once" reading does not need to go back to the operator.
- **Uncovered @AC changes.** None; the list is unchanged from round 10. `@AC-5` CHANGE is covered by the operator's C-16 sign-off. 251 @AC-17, 206 trading @AC-1 and 294 @AC-56 are EXTEND, each covered by a recorded ruling. @AC-1..@AC-4, 251 @AC-14, 206 trading @AC-2 and @AC-3, 294 @AC-6 and 290 @AC-3 are PRESERVE.
- **Operator sign-offs still needed.**
  - **Design approval** at this gate (policy: halt).
  - **Cutover confirmations (O-61),** to be answered before `/sdd-execute` reaches the integration step; the list is unchanged from the round-8 entry.
  - **Register verdicts (O-56).** P-5, P-6 and P-7 recorded as "user reopened" citing `context.md:1535-1541`, P-4 as withdrawn, and P-8 as "user reopened" citing `context.md:2372-2383`.
- **Non-blocking, for the proposer and `/sdd-spec`.**
  - **O-68.** Proposer to confirm the other three adopted items above (`interval_ms <= 0`, injected clock, invalid credentials). `/sdd-spec` wires the test config fake through `GetFloat` (ledger `fails.md:1392`) and logs the doc drift at `services/xstockstrat-trading/CLAUDE.md:119` in the trading findings.
  - **O-30.** The analysis AC ids are still to be enumerated, and the D-10 flip-short window residual stays named.
- **New named residuals.**
  - An idle IBKR account with an empty list, or an Alpaca account pinned at 500 rows, never tombstones its candidates. It keeps one adoption `ListOrders` per reconciliation interval (1/min by default) indefinitely.
  - The cooldown and the candidate-set memory are in process, so every restart lists each adoption-only account once.
  - The candidate anti-join still runs every tick; only the broker call is throttled.
  - The `services/xstockstrat-trading/CLAUDE.md:119` row implies `interval_ms <= 0` means "every tick". This feature logs the drift and does not fix it.

```sdd-batch-design-state
{
  "round": 11,
  "synth": {
    "approach": "Round-11 synthesis. The round-10 synthesis stands as written (D-1..D-3, D-5..D-16, D-18..D-28, D-31..D-39, D-41..D-48, build order, cutover, production check-only, tombstone row, tests 1-10). This round only closes O-65. All paths are under `/home/user/xstockstrat/.claude/worktrees/orch-311`; `trading.go` means `services/xstockstrat-trading/internal/service/trading.go`.\n\nVerified this round\n- `reconciliation.interval_ms` is read live and a value `<= 0` keeps the reconciler's previous interval; it does not mean \"every tick\" (`trading.go:1977-1983`).\n- `shouldPollHaltedAccount` uses `time.Now()`, stamps when it returns true, and treats `intervalMs <= 0` as \"always poll\" (`trading.go:2848-2859`).\n- `reconcileTick` skips known-invalid-credential accounts before `ListOrders` and applies the halted throttle (`trading.go:2068,2075`); on `broker.ErrInvalidCredentials` it logs a WARN and skips without counting a failure (`trading.go:2083-2086`).\n- `haltAccount` pre-stamps `haltedLastPolled` (`trading.go:2883`); `haltedPollInterval()` defaults to 300000 (`trading.go:2573`).\n\n1. COMPLETE-LIST GATE (confirmed by both sides, as round 10 wrote it; runs after a successful `Broker.ListOrders`)\n- Listed in a terminal state: `NOT_OPEN_AT_ADOPTION` tombstone on any successful list (D-48).\n- Absent from the list: tombstone only when the list is non-empty, and for Alpaca also shorter than 500 rows.\n- Empty IBKR 200, Alpaca list of exactly 500 rows, or a failed `ListOrders`: nothing is inserted; the candidate is re-evaluated on the account's next adoption list.\n- Listed open: unchanged (fill 0 tracked with `adopted = true`; fill > 0 `BASELINE_RETIRED`, no emit).\n\n2. ADOPTION-ONLY THROTTLE (inside `pollBracketLegFills`, after `logTick`; no `StartFillPoller` or `reconcileTick` hunk)\n- Each tick still runs the D-40 candidate query and builds the D-46 union, then splits it per account.\n- Tracked account (at least one non-retired `bracket_legs` row): one `ListOrders` per fill-poller tick, unchanged (D-11, D-46). Adoption shares that list.\n- Adoption-only account (candidates, no non-retired tracked leg): listed only when its cooldown has elapsed.\n  - Cooldown = `trading.reconciliation.interval_ms` (default 60000, live read). If the account is halted, cooldown = `haltedPollInterval()`.\n  - No new config key.\n  - The body of `shouldPollHaltedAccount` becomes one shared helper taking the last-polled map and the interval. `shouldPollHaltedAccount` keeps its signature and behaviour and delegates over `haltedLastPolled`. Adoption calls the helper over a separate `adoptionLastListed` map under `haltedMu`, so neither path consumes the other's slot.\n  - The stamp is taken when the call is allowed, not when it succeeds: a broker that stays down costs one failed call and one WARN per interval.\n  - The map is in memory and empty at boot, so the first tick lists every adoption-only account.\n  - An account that gains a tracked leg is listed every tick from the next tick, whatever its stamp. An account whose last tracked leg retires becomes adoption-only at its next allowed list.\n\n3. ADOPTED FROM ADVERSARY r11, awaiting proposer confirmation (non-blocking)\n- New-candidate bypass: keep the candidate id set seen at the account's last allowed list next to the stamp (under `haltedMu`). An adoption-only account whose current candidate set contains an id not in that set is listed on this tick, and the stamp and set are refreshed. An unchanged or shrunken set stays throttled. This keeps the round-10 latency of about 5 s for a bracket activated by an old trading instance.\n- `reconciliation.interval_ms <= 0` is read as the 60000 default for adoption, matching what the reconciler does from a fresh boot. \"Always list\" comes only from `halted_poll_interval_ms <= 0` on a halted account, which is that key's documented meaning.\n- The shared helper takes `now time.Time`. `shouldPollHaltedAccount` passes `time.Now()`; `pollBracketLegFills` passes `s.clock()`. Tests advance the injected clock and do not touch the map.\n- Adoption-only accounts with `credentialsKnownInvalid` status are skipped before the list, as `reconcileTick` does. A `broker.ErrInvalidCredentials` result is handled as `reconcileTick` handles it: WARN and skip, no failure count. (The adversary called this a \"non-WARN skip\"; the code WARNs.)\n\n4. STEADY-STATE `ListOrders` RATE PER ACCOUNT from `pollBracketLegFills` (defaults: tick 5 s, interval 60 s, halted poll 300 s)\n- Tracked legs: 12/min (17,280/day), unchanged.\n- Adoption-only, not halted (idle IBKR with an empty list; Alpaca pinned at 500 rows): 1/min (1,440/day), down from 12/min. Plus one extra call on a tick where a new candidate id appears.\n- Adoption-only, halted: 0.2/min (288/day).\n- Adoption-only, credentials known invalid: 0.\n- No candidates and no non-retired tracked legs: 0.\n- `reconcileTick`'s own list (1/min, 0.2/min halted) is separate and unchanged, so an idle IBKR account totals about 2/min instead of 13/min.\n\nTESTS (trading; added to round-10 tests 1-10; each asserts the call count over N ticks)\n11. Adoption-only Alpaca, 500-row list without the candidate, interval 60000, three ticks: 1 `ListOrders`, no insert, candidate still present.\n12. Idle IBKR, empty 200, interval 60000, three ticks: 1 call, no tombstone; after the injected clock passes the interval the next tick lists again.\n13. `interval_ms = 0`, not halted, three ticks: 1 call (default applies). `halted_poll_interval_ms = 0` on a halted adoption-only account: 3 calls.\n14. Tracked account with one candidate, interval 60000: 3 calls over 3 ticks, adoption runs on each.\n15. Halted adoption-only, `halted_poll_interval_ms = 300000`: 1 call over 3 ticks.\n16. `ListOrders` errors on tick 1: no call on ticks 2-3, one WARN, nothing inserted.\n17. Candidate listed open on tick 1 and adopted: the account is listed on tick 2 inside the window.\n18. The two maps are independent in both directions; `trading_reconciliation_test.go:486-503` passes unchanged.\n19. Adoption-only account inside its cooldown gains a new candidate id: listed on the next tick; a third tick with the same set makes no call.\n20. Adoption-only account with known-invalid credentials: no `ListOrders`, no WARN.\n\nSPEC FILES (O-64 and O-66 as confirmed): `fakeBroker` `listOrdersFn` and call counter; `fakeBracketRepo` candidate query, tombstone insert and retired-status filter; settable `reconciliation.interval_ms` and `reconciliation.halted_poll_interval_ms` in the test config fake, wired through `GetFloat` (ledger `fails.md:1392`); every existing ACTIVE-bracket test (e.g. `trading_bracket_test.go:416`). /sdd-spec also logs the doc drift at `services/xstockstrat-trading/CLAUDE.md:119` (\"matching `interval_ms`'s own convention\") in the trading findings.",
    "open_objections": [
      {
        "text": "Proposer to confirm the new-candidate bypass adopted from adversary r11: an adoption-only account whose candidate set contains an id not seen at its last allowed list is listed on the next tick (candidate id set kept next to adoptionLastListed under haltedMu), with test 19. Without it the 60 s cooldown widens an existing path from about 5 s to about 60 s: a bracket activated by an old trading instance fills inside the window, is tombstoned with observed_filled_qty = 0 (D-48, R-36), its exit never reaches the ledger or the fold, and NetFilledQtyBySymbol keeps the entry quantity against a flat broker position, which can halt the account (206 trading @AC-1). If the proposer declines the bypass, the residual must name the false halt, not only the lost fill.",
        "blocking": false
      },
      {
        "text": "Proposer to confirm the other items adopted from adversary r11: adoption reads reconciliation.interval_ms <= 0 as the 60000 default (trading.go:1977-1983 keeps the previous interval on <= 0; it does not mean every tick) with test 13 rewritten; the shared throttle helper takes now as a parameter (time.Now() from shouldPollHaltedAccount, s.clock() from pollBracketLegFills) so tests 11-17 advance the injected clock; adoption-only accounts with credentialsKnownInvalid status are skipped before ListOrders and broker.ErrInvalidCredentials is handled as reconcileTick handles it (trading.go:2068,2083-2086), with test 20. /sdd-spec wires the test config fake through GetFloat (fails.md:1392) and logs the trading CLAUDE.md:119 doc drift in the trading findings.",
        "blocking": false
      },
      {
        "text": "O-61: operator-confirmation gate item, recorded in context.md and answered before /sdd-execute reaches the integration step (DO spec with portfolio removed versus the PRIVATE_DOMAIN references; doctl spec round-trip of secrets; homelab stop method; gate deploy exit code on rollback; trading's failed portfolio calls on paper staging; Alpaca listing bracket legs as top-level orders). It also carries the question to ask if a production count is non-zero.",
        "blocking": false
      },
      {
        "text": "O-30: the analysis AC ids in order-snapshots-pnl-patterns.feature and fix-python-loop-supervision.feature are still to be enumerated at /sdd-spec, and the D-10 flip-short window residual stays named.",
        "blocking": false
      },
      {
        "text": "O-56: the orchestrator still has to record P-5, P-6 and P-7 as 'user reopened' citing context.md:1535-1541, P-4 as withdrawn, and P-8 as 'user reopened' citing context.md:2372-2383.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "251 @AC-17",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "251 @AC-14",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "206 trading @AC-1",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "206 trading @AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "206 trading @AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "294 @AC-56",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "294 @AC-6",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "290 @AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Tombstone on absence from any successful list, whatever its completeness (proposal r10). Lost: an empty IBKR 200 or a full 500-row Alpaca list would permanently tombstone open legs (ibkr.go:448-482; alpaca.go:376). The proposer withdrew it in r11 by confirming the gate. Locked this round.",
      "Sharing reconcileTick's own ListOrders result with adoption (proposer r11 runner-up). Lost: it needs a reconcileTick hunk that couples adoption to the 206 @AC-1..3 path, and it makes adoption latency 60 s for every account. Both sides rejected it. Locked this round.",
      "A new config key for the adoption cadence. Lost: the operator steer for round 11 says to reuse reconciliation.interval_ms and the halted throttle rather than add a key. Locked this round.",
      "Throttling adoption through the existing haltedLastPolled map. Lost: an adoption list would consume reconcile's halted re-observation slot, and haltAccount pre-stamps that map (trading.go:2883). The adversary did not contest. Locked this round.",
      "A fixed post-boot full-rate window as a code constant (adversary r11, self-rejected). Lost: a hardcoded duration breaks config governance and misses brackets an old instance activates after the window. Not locked; only one side weighed it.",
      "Tombstone only on a listed terminal status, never on absence (adversary r10). Not needed now that the empty-list case is bounded by the throttle. Not locked.",
      "Tombstone on absence across N consecutive successful lists (adversary r10). Lost: it still fails on a truncated Alpaca list and needs a counter column. Not locked.",
      "A partial index in 012 for the candidate query. Not chosen: /sdd-spec states the scan cost first. Not locked."
    ],
    "open_risks": [
      "An idle IBKR account with an empty list, or an Alpaca account pinned at 500 rows, never tombstones its candidates; it keeps one adoption ListOrders per reconciliation interval (1/min by default) indefinitely.",
      "If the new-candidate bypass is not confirmed, a bracket activated by an old trading instance on an adoption-only account can fill within the 60 s cooldown, be tombstoned with no emit, and false-halt the account through NetFilledQtyBySymbol.",
      "The cooldown and candidate-set memory are in process; every restart lists each adoption-only account once.",
      "The candidate anti-join still runs every tick; only the broker call is throttled (005_broker_accounts_halted.up.sql:29-31).",
      "reconciliation.interval_ms <= 0 means 'keep the previous interval' in the code but the trading CLAUDE.md:119 row implies 'every tick'; the doc drift is only logged, not fixed, in this feature.",
      "A genuinely open leg absent from a complete list on its evaluation tick is tombstoned permanently; its exit fill never reaches the ledger, the fold or reconciliation.",
      "A tombstone is undone only by a manual delete of its bracket_legs row.",
      "Existing trading tests that hold an ACTIVE bracket with leg ids panic on fakeBroker.ListOrders until the fakes are extended.",
      "If a production count is non-zero, the promotion stops with no designed procedure; it waits on an operator ruling.",
      "The DO stop is unverified: .do/app.dev.yaml:78 and :319 reference ${xstockstrat-portfolio.PRIVATE_DOMAIN}, so a spec with the portfolio service removed may be rejected.",
      "The merge precondition and the main-dev freeze are not enforced; an overlap double-applies fills and only the recorded evidence shows it.",
      "On the homelab VM an unattended rollback of the integration deploy restores the pre-019 portfolio after the floor is stamped; noticing it depends on gate deploy exiting non-zero, which is unconfirmed.",
      "Fills appended between T_stop and the first new boot are acked: qty heals at the next sync, realized P&L for them is lost.",
      "While portfolio is stopped on staging, trading's portfolio calls fail: the risk check warns only, reconciliation skips, and flattenAndHalt cannot flatten.",
      "Adoption depends on Alpaca listing bracket legs as top-level orders in every open state; this is unverified.",
      "Reconciliation covers only tracked legs; the D-42 forward-only gap stays uncounted.",
      "A BASELINE_RETIRED leg's post-cutover remainder is neither emitted nor observed.",
      "Adopted IBKR legs that later vanish from the gateway are polled indefinitely (D-26).",
      "Late-commit appends whose recorded_at is below the floor are acked (operator-accepted).",
      "The floor assumes ledger and portfolio share one Postgres server clock.",
      "With the composite GetPnL key, a historical order whose partial and full fills carried different account_id values stops being deduplicated; the /sdd-spec history grep is the only check.",
      "A parked fill is retried only after a manual delete of its parked row.",
      "A fill transaction can wait server-side on the applied-row conflict or FOR UPDATE, holding 1 of 2 client connections and positionsMu.",
      "The pre-check has a TOCTOU window covered only by the in-tx INSERT conflict path.",
      "A position.updated can be emitted after a same-process sync has overwritten the row.",
      "Boot replay re-walks every post-floor fill and consumer_applied_events has no retention.",
      "A leg id is lost from tracking if the ActivateBracket tx fails; it is alerted, but its exit fill never folds.",
      "Neither broker adapter populates BrokerOrder.Fees, so fee totals understate.",
      "Migration numbers 019 and 012 may collide with feature 318.",
      "OQ-2 (repair of already-inflated accumulators) is out of scope, and instance_count must stay 1."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-05",
      "C-08",
      "C-10",
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "F-01",
      "F-02",
      "F-04",
      "F-06",
      "F-07",
      "F-08",
      "P-02",
      "P-03",
      "P-04",
      "PLAT-N1"
    ],
    "rationale": "The design has no blocking objection left. The adversary rates it SOUND with no Floor breach, and O-65 is closed.\n\n**What closed O-65.** The proposer confirmed the complete-list gate exactly as round 10 wrote it, and bounded the two cases where a tombstone is unsafe. An adoption-only account is now listed once per `reconciliation.interval_ms` (once per halted interval when halted) instead of every 5 s tick. That is 1 call/min by default, down from 12, with no new config key. This is what the operator steer asked for, so the \"evaluated exactly once\" reading does not need to go back to the operator.\n\n**What I adopted from the adversary, unconfirmed.** I checked each of the four objections against the code and put the fixes into the approach as non-blocking confirm items:\n- **New-candidate bypass.** The 60 s cooldown widens an existing lost-fill and false-halt path about 12x for brackets an old trading instance activates. The bypass restores the 5 s latency for that population and leaves idle accounts at 1/min. It lives inside the throttle this round adds, so it stays within the steer.\n- **`interval_ms <= 0`.** The proposer's claim that it means \"every tick\" is wrong; `trading.go:1977-1983` keeps the previous interval. Adoption reads it as the 60000 default.\n- **Injected clock.** The helper takes `now`, so tests do not reach into the map.\n- **Invalid credentials.** Adoption-only accounts are skipped as `reconcileTick` skips them. I corrected one adversary detail: `reconcileTick` does log a WARN on `ErrInvalidCredentials` (`trading.go:2083-2086`).\n\nThe two new decisions record only what both sides agree. The four adversary items are left out of them until the proposer confirms.\n\n**Housekeeping.** O-64 and O-66 are closed on the proposer's confirmations, which match their register text. O-30, O-56 and O-61 stay open and non-blocking. No settled D-n is contradicted, no locked R-n returns (R-10 and R-36 are honoured), and nothing is reopened this round. Business rules are unchanged from round 10.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Complete-list gate, filling the gap D-48 left open: after a successful ListOrders, a candidate absent from the list gets the NOT_OPEN_AT_ADOPTION tombstone only when the list is non-empty, and for Alpaca also shorter than 500 rows. An empty IBKR 200, an Alpaca list of exactly 500 rows or a failed ListOrders inserts nothing, and the candidate is re-evaluated on the account's next adoption list. Listed-terminal candidates are tombstoned on any successful list (D-48). Required tests: Alpaca 499 rows tombstones; Alpaca 500 rows does not; empty IBKR 200 does not.",
          "evidence": "operator steer r11 ('confirm the complete-list gate as the synthesis wrote it'); ibkr.go:448-482; alpaca.go:373-376; R-10; D-48; proposal r11 item 1; adversary r11 rated it sound"
        },
        {
          "text": "Adoption-only throttle, amending D-46's 'adoption runs every tick' for accounts with candidates but no non-retired bracket_legs row: such an account gets its adoption ListOrders only when a per-account cooldown has elapsed. The cooldown is trading.reconciliation.interval_ms (default 60000, live read), or haltedPollInterval() when the account is halted; no config key is added. The body of shouldPollHaltedAccount becomes one shared helper; shouldPollHaltedAccount keeps its signature and behaviour over haltedLastPolled, and adoption uses a separate in-memory adoptionLastListed map under haltedMu. The stamp is taken when the call is allowed, so a failed list is throttled too. The map is empty at boot, so the first tick lists every adoption-only account. Tracked accounts keep one ListOrders per tick (D-11, D-46), and an account that gains a tracked leg is listed every tick from the next tick. The throttle sits inside pollBracketLegFills with no StartFillPoller or reconcileTick hunk. Steady-state calls per account from pollBracketLegFills at defaults: tracked 12/min; adoption-only 1/min; adoption-only halted 0.2/min; no candidates and no tracked legs 0. Tests assert the call count over N ticks for each state. The meaning of interval_ms <= 0, the clock source, a new-candidate bypass and a credential gate are not part of this decision.",
          "evidence": "operator steer r11 (reuse reconciliation.interval_ms and shouldPollHaltedAccount, no new key); trading.go:1977,2075,2573,2848-2859,2883; D-11; D-22; D-46; 294 @AC-6; trading_reconciliation_test.go:486-503; proposal r11 items 2-3 and tests 11-18; adversary r11 rated it sound and contested only the four excluded points"
        }
      ],
      "new_rejected": [
        {
          "text": "Tombstoning a candidate on absence from any successful ListOrders, whatever the list's completeness",
          "why": "An empty IBKR 200 (ibkr.go:448-482) or a full 500-row Alpaca list (alpaca.go:376) would permanently tombstone open legs. The proposer withdrew it in round 11 by confirming the complete-list gate."
        },
        {
          "text": "Sharing reconcileTick's own ListOrders result with adoption",
          "why": "It needs a reconcileTick hunk that couples adoption to the 206 @AC-1..3 path and makes adoption latency 60 s for every account. Proposer r11 did not choose it and adversary r11 agreed."
        },
        {
          "text": "A new config key for the adoption ListOrders cadence",
          "why": "The operator steer for round 11 directs reuse of reconciliation.interval_ms and the halted-account throttle rather than a new key."
        },
        {
          "text": "Throttling adoption through the existing haltedLastPolled map",
          "why": "An adoption list would consume reconcile's halted re-observation slot, and haltAccount pre-stamps that map (trading.go:2883). Proposal r11 rejected it and adversary r11 did not contest."
        }
      ],
      "new_objections": [
        {
          "text": "Proposer to confirm the new-candidate bypass adopted from adversary r11: an adoption-only account whose candidate set contains an id not seen at its last allowed list is listed on the next tick, with the candidate id set kept next to adoptionLastListed under haltedMu and a test. Without it the 60 s cooldown widens the path where a bracket activated by an old trading instance fills unobserved, is tombstoned with no emit, and can false-halt the account through NetFilledQtyBySymbol (206 trading @AC-1). If declined, the residual must name the false halt as well as the lost fill.",
          "blocking": false
        },
        {
          "text": "Proposer to confirm the other items adopted from adversary r11: adoption reads reconciliation.interval_ms <= 0 as the 60000 default (trading.go:1977-1983), with the throttle-disabled test driven through halted_poll_interval_ms <= 0; the shared helper takes now as a parameter (time.Now() from shouldPollHaltedAccount, s.clock() from pollBracketLegFills) and the throttle tests advance the injected clock; adoption-only accounts with credentialsKnownInvalid status are skipped before ListOrders and broker.ErrInvalidCredentials is handled as in reconcileTick (trading.go:2068,2083-2086), with a test. /sdd-spec wires the test config fake through GetFloat (fails.md:1392) and logs the trading CLAUDE.md:119 doc drift in the trading findings.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-65",
          "how": "The proposer confirmed the complete-list gate as written, with the empty-IBKR, 500-row and 499-row tests, and bounded the idle-IBKR and pinned-at-500 cases at one adoption ListOrders per reconciliation.interval_ms (one per halted interval when halted) through the reused throttle, with call-count tests. Adversary r11 rated it sound. The cooldown's latency for newly activated brackets is tracked as a new objection."
        },
        {
          "id": "O-66",
          "how": "The proposer confirmed every item: the INFO log per tombstone, the runbook delete-the-row path, the single retired-status constant read by the fakes, the corrected KnownBrokerOrderIDs statement with the resize-blanked test, the /sdd-spec scan-cost statement against the 005 indexes, and the 012 DDL comment for the adopted column."
        },
        {
          "id": "O-64",
          "how": "The proposer confirmed the spec's Files list: the fakeBroker listOrdersFn and call counter, the fakeBracketRepo candidate query with tombstone insert and retired filter, settable reconciliation interval keys in the test config fake, and every existing ACTIVE-bracket test (e.g. trading_bracket_test.go:416)."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-20 — sdd-design (approved)

- Phase 0 Recon: wrote recon.md (services: xstockstrat-portfolio, xstockstrat-trading; consumer surfaces xstockstrat-ui `/trader` and xstockstrat-agent `get_positions` read the folded rows, no code change designed there; key reuse patterns: `pnl.FoldFrom` for the signed fold, `orderSide` for side resolution).
- Phase 1 Grilling: 11 rounds (full). Chosen approach: an applied-event table and boot-stamped floor make the portfolio fill fold exactly-once and signed in one transaction; trading tracks bracket legs in `trading.bracket_legs`, emits keyed leg fills synchronously, adopts pre-existing open legs with a complete-list gate and an adoption-only throttle. Rejected: R-1..R-40 (R-25 reopened and now the chosen floor); see design.md.
- Constitution rules touched: C-01, C-05, C-08, C-10, C-11, C-13, C-15, C-16, C-18, F-01, F-02, F-04, F-06, F-07, F-08, P-02, P-03, P-04, PLAT-N1. Floor breaches: none.
- Status: spec-ready → design-approved.
- **Approval provenance.** The design was approved after round 11 under the operator's standing authorisation ("Override round cap until design is sound", `context.md:1522-1524`): the round-11 adversary verdict was SOUND, with no Floor breach, no blocking objection, and every C-16 CHANGE covered by an operator ruling. The operator did not approve this round in person. This entry was written by the /sdd-design completion step from the workflow's computed task; the operator's own words are only in the sessions titled "recorded by the orchestrator (verbatim)" above.
- **Binding on the spec.** The round-11 synthesis as written, including its section 3 items adopted from the adversary: the new-candidate bypass, `reconciliation.interval_ms <= 0` read as the 60000 default for adoption, the shared throttle helper taking an injected clock, and the known-invalid-credentials skip.
- **Register changes at approval (`debate.md`).** State `approved`. Petition verdicts recorded from the rulings above: P-1 and P-2 "user reopened" (`context.md:1501-1505`, `1510-1514`); P-5, P-6 and P-7 "user reopened" (`context.md:1535-1541`); P-8 "user reopened" (`context.md:2376-2383`); P-4 "user declined" (R-2 was not reopened). The completion task said to mark every pending petition "user declined"; that would contradict the recorded grants for D-4, D-29, D-30, R-25 and D-40, so only P-4 was marked that way. No row was added, reworded or deleted, and no objection status was changed.
- **Before `/sdd-execute`.** This file is far over the 65536-byte `/sdd-execute` limit. `/sdd-distill fix-position-fold-correctness` must run before `/sdd-execute`.
- **For `/sdd-spec`.** Re-check migration numbers (portfolio `019`, trading `012`) against `main-dev` and feature 318.
- No ledger line was written: the debate's reusable lessons (an empty or capped broker list cannot prove absence) are already covered by R-10's evidence and belong to `/sdd-execute` once proven in code.

## Open Threads

- **ORCHESTRATOR ASSUMPTION, not an operator ruling.** The adoption-only throttle (D-50: adoption `ListOrders` at the reconciler cadence for accounts with candidates but no live tracked legs, no new config key) was chosen by the orchestrator to meet the operator's stated reason for the D-40 reopen (remove the permanent per-tick broker load) where a tombstone is unsafe. The operator was told and has not objected or confirmed. The operator can overturn it. Target: operator confirmation before `/sdd-execute`.
- **Housekeeping.**
  - `acceptance.feature` `@AC-5` still reads "qty 6"; the signed-off wording (D-38, `context.md:1530-1534`) is not applied yet. Target: `/sdd-spec`, keeping the `@AC` ID (C-15).
  - O-67 and O-68 stay "open" in `debate.md`; the approval ruling makes their four items binding. Target: `/sdd-spec` treats them as settled.
  - O-56 stays "open" in `debate.md` although its verdicts are now recorded; P-4 reads "user declined" because the register has no "withdrawn" verdict. Target: none.
  - O-30: the analysis AC ids in `order-snapshots-pnl-patterns.feature` and `fix-python-loop-supervision.feature` are not enumerated; the D-10 flip-short window residual stays named. Target: `/sdd-spec`.
  - Migration numbers `019` and `012` may collide with feature 318. Target: `/sdd-spec`.
- **Operator confirmations before the integration step (O-61).** Target: before the cutover runbook step.
  - The DO stop is unverified: `.do/app.dev.yaml:78` and `:319` reference `${xstockstrat-portfolio.PRIVATE_DOMAIN}`, so a spec with the portfolio service removed may be rejected.
  - On the homelab VM an unattended rollback of the integration deploy restores the pre-019 portfolio after the floor is stamped; noticing it depends on `gate deploy` exiting non-zero, which is unconfirmed.
  - Adoption depends on Alpaca listing bracket legs as top-level orders in every open state; this is unverified.
  - While portfolio is stopped on staging, trading's portfolio calls fail: the risk check warns only, reconciliation skips, and `flattenAndHalt` cannot flatten.
  - If a production count is non-zero, the promotion stops with no designed procedure; it waits on an operator ruling.
  - The merge precondition and the `main-dev` freeze are not enforced; an overlap double-applies fills and only the recorded evidence shows it.
- **Accepted residuals: cutover.** Target: recorded in the cutover result or runbook.
  - Fills appended between `T_stop` and the first new boot are acked: qty heals at the next sync, realized P&L for them is lost.
  - Late-commit appends whose `recorded_at` is below the floor are acked (operator-accepted).
  - The floor assumes ledger and portfolio share one Postgres server clock.
- **Accepted residuals: portfolio fold.**
  - A parked fill is retried only after a manual delete of its parked row. Target: runbook step.
  - A fill transaction can wait server-side on the applied-row conflict or `FOR UPDATE`, holding 1 of 2 client connections and `positionsMu`. Target: accepted.
  - The pre-check has a TOCTOU window covered only by the in-transaction INSERT conflict path. Target: the INSERT-conflict dbtest step.
  - A `position.updated` can be emitted after a same-process sync has overwritten the row. Target: accepted.
  - Boot replay re-walks every post-floor fill and `consumer_applied_events` has no retention. Target: follow-up feature (rolling floor).
  - With the composite `GetPnL` key, a historical order whose partial and full fills carried different `account_id` values stops being deduplicated. Target: the `/sdd-spec` payload-history grep.
  - OQ-2 (repair of already-inflated accumulators) is out of scope, and `instance_count` must stay 1. Target: separate data-repair change.
- **Accepted residuals: bracket legs and adoption.**
  - An idle IBKR account with an empty list, or an Alpaca account pinned at 500 rows, never tombstones its candidates; it keeps one adoption `ListOrders` per reconciliation interval (1/min by default) indefinitely. Target: accepted.
  - If the spec dropped the new-candidate bypass, a bracket activated by an old trading instance on an adoption-only account could fill within the 60 s cooldown, be tombstoned with no emit, and false-halt the account through `NetFilledQtyBySymbol`. Target: test 19 at `/sdd-spec`.
  - The cooldown and candidate-set memory are in process; every restart lists each adoption-only account once. Target: accepted.
  - The candidate anti-join still runs every tick; only the broker call is throttled (`005_broker_accounts_halted.up.sql:29-31`). Target: `/sdd-spec` states the scan cost.
  - `reconciliation.interval_ms <= 0` means "keep the previous interval" in the code, but `services/xstockstrat-trading/CLAUDE.md:119` implies "every tick"; the drift is logged, not fixed. Target: trading findings at `/sdd-spec`.
  - A genuinely open leg absent from a complete list on its evaluation tick is tombstoned permanently; its exit fill never reaches the ledger, the fold or reconciliation. Target: accepted.
  - A tombstone is undone only by a manual delete of its `bracket_legs` row. Target: runbook step.
  - Existing trading tests that hold an ACTIVE bracket with leg ids panic on `fakeBroker.ListOrders` until the fakes are extended. Target: first trading test step.
  - Reconciliation covers only tracked legs; the D-42 forward-only gap stays uncounted. Target: accepted (`context.md:1546-1548`).
  - A `BASELINE_RETIRED` leg's post-cutover remainder is neither emitted nor observed. Target: accepted.
  - Adopted IBKR legs that later vanish from the gateway are polled indefinitely (D-26). Target: accepted.
  - A leg id is lost from tracking if the `ActivateBracket` transaction fails; it is alerted, but its exit fill never folds. Target: accepted.
  - Neither broker adapter populates `BrokerOrder.Fees`, so fee totals understate. Target: trading findings.

## Session 2026-11-20 — sdd-spec

- Generated implementation-spec.md with 27 steps. Status → implementation-ready. `acceptance.feature` `@AC-5` now carries the operator-signed wording (D-38); the `@AC` ID is kept (C-15).
- **Written from the workflow's computed task, not by the operator.** The operator's own words are only in the sessions titled "recorded by the orchestrator (verbatim)" above. Nothing here is an operator ruling.
- **Tree.** Service evidence was read from `origin/main-dev@fb52065c`. `origin/feature/fix-position-fold-correctness` was 168 commits behind `main-dev` and differed from the merge base `c4fd48b0` only inside this directory. This run did not merge `main-dev` (its task allowed edits only inside this directory); `/sdd-execute` BRANCH SYNC does. `recon.md`, `debate.md` and `design.md` cite `c4fd48b0` line numbers; the spec's numbers are the current ones.
- Key codebase findings:
  - Migration numbers: portfolio `019` and trading `012` are free on `main-dev@fb52065c` (max `018_watchlist_signal_expiry`, `011_offline_fees_snapshot_headers`). Feature 318 (`spec-ready`) adds no migration file. Unmerged branches of other features were not checked; `/sdd-execute` re-checks after BRANCH SYNC.
  - Portfolio sites: `processOrderFill` `portfolio_service.go:376-490`; `observed` `:234-245`; `emitEventAs` `:1371` (callers `:1367`, `signal_prune.go:60,70`); `GetPnL` dedup maps `:993-1020`; `queryRower` `portfolio_repo.go:23-27`. The service dbtests build the repo with `NewPortfolioRepoWithDB(pool)`, so `ApplyFill` begins its transaction from `r.db` through `txBeginner`, not from `Pool()`.
  - Trading sites: `pollFills` `trading.go:1816-1878` (`logTick` at `:1877`); the three ACTIVE bracket writes `:3680`, `:3697`, `:3739`; `appendLedgerEvent` `:3945` (callers `:1123`, `:3989`, `trading_offline_test.go:2215,2228`); `shouldPollHaltedAccount` `:2949-2960`; `reconcileTick` credential and halted gates `:2174-2193`; `KnownBrokerOrderIDs` `trading_repo.go:130`, `NetFilledQtyBySymbol` `:171`.
  - The v1 scope-limitation paragraph D-10 rewrites is now in `services/xstockstrat-portfolio/docs/position-closed-contract.md`, not in the portfolio `CLAUDE.md`.
  - The `reconciliation.interval_ms` doc row the design cites at trading `CLAUDE.md:119` is now at `:95` (halted row `:98`). `TestShouldPollHaltedAccount_ThrottlesAndRecovers` is at `trading_reconciliation_test.go:491-513`.
  - `.do/app.dev.yaml:439` and `:701-707`: on DO staging, ledger (direct) and portfolio (PgBouncer pool) use the same `xstockstrat` cluster, so they share one server clock. The homelab DSNs are not in this repository and were not checked.
- **Spec assumptions (A-1..A-12 in implementation-spec.md).** These are spec choices, not operator rulings:
  - A fill payload with `qty` 0 or an empty `order_id`, `user_id` or `symbol` is skipped before the applied key is taken. Without this the 294 `@AC-56` fixture's partial-shaped event would take `ord-56`'s key and the test's "4 ok" would break.
  - The D-11 `GetOrder` fallback cap has no number in the register; the spec uses a constant of 5 per account per tick.
  - The leg observer lower-cases the broker status before mapping it, because `alpacaStatusToProto` does not match IBKR's capitalised statuses and IBKR passes them through raw. Without it `@AC-4` and `@AC-5` would hold for Alpaca only.
  - Round-10 trading tests 8-9 are specified as pgxmock SQL-shape tests: trading has no `dbtest` harness and CI has no trading DB job.
  - A floor stamp or load failure is retried every `streamRetryDelay`; the fill stream never opens without a floor.
  - `trading.bracket_legs` also carries `order_id`, `user_id`, `trading_mode` and `not_found_ticks` (round-4 and round-8 syntheses); `design.md` § 2 lists the columns in short form.
  - `PortfolioRepo.GetRealizedAccum`, `GetFeesAccum`, `ClosePosition` and `UpsertPosition` lose their last production caller and are deleted with the fill-path rewrite.

## Open Threads

- **ORCHESTRATOR ASSUMPTION, not an operator ruling (carried forward unchanged).** The adoption-only throttle (D-50: adoption `ListOrders` at the reconciler cadence for accounts with candidates but no live tracked legs, no new config key) was chosen by the orchestrator to meet the operator's stated reason for the D-40 reopen (remove the permanent per-tick broker load) where a tombstone is unsafe. The operator was told and has not objected or confirmed. The operator can overturn it. Steps 23-25 of the spec implement it. It is also listed in `design.md` § Open Risks. Target: operator confirmation before `/sdd-execute`.
- **Before `/sdd-execute`.** This file is far over the 65536-byte `/sdd-execute` limit. `/sdd-distill fix-position-fold-correctness` must run first.
- **Found after the design was approved (the design debated the `c4fd48b0` tree).** Target: `/sdd-review fix-position-fold-correctness impl-spec`, then the operator if a change is wanted.
  - Feature 347 (Alpaca adaptive rate limit) is on `main-dev`. Its trading `@AC-34` ("The fill poller does not stall on a throttled Alpaca account") is a PRESERVE the design did not list. The spec bounds leg `ListOrders` and `GetOrder` calls with `alpacaCallContext`, as the parent poll does.
  - `services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py:48-49` consumes `order.filled` and `order.partially_filled`. Bracket-leg events will reach it with a broker leg id as `order_id`. No step changes analysis; Step 27 logs it in the trading findings. O-30's list: analysis 042 `@AC-1` (snapshot on fill), `@AC-2` (close triggers pattern analysis), `@AC-7`, and 259 `@AC-6`, `@AC-7`, `@AC-9` (consumer retry and park).
  - The parent `pollFills` path maps IBKR statuses through `alpacaStatusToProto` without lower-casing. That defect is outside this feature; Step 27 logs it.
- **Housekeeping closed by this session.** `@AC-5` wording applied. Migration numbers re-checked. O-67 and O-68 are treated as settled: Steps 23-25 carry the new-candidate bypass, `interval_ms <= 0` read as 60000, the injected clock and the known-invalid-credentials skip.
- **Unchanged from the sdd-design (approved) session's Open Threads.** The O-61 operator confirmations before the cutover step, and every accepted residual listed there, still stand. Step 26 writes them into the runbook.

## Session 2026-11-20 — sdd-review impl-spec

- Result: 1 failure, 11 warnings; overlap WARN (advisory, did not block). Lifecycle unchanged (`implementation-ready`).
- **Written from the workflow's computed task, not by the operator.** Nothing here is an operator ruling. The task told this run to edit `implementation-spec.md` for every FAIL and clearly-correct WARN; the skill's MODE B on its own only records findings.
- Every claim was re-checked on `origin/main-dev@fb52065c` (still the tip of `main-dev`) before the spec was changed.
- **Addressed in `implementation-spec.md`:**
  - [x] FAIL, Step 7 (B3b, F-05, C-08): the A-2 skip class made Step 7 fail its own whole-package run. Confirmed: `fillEvent` (`portfolio_fill_errors_test.go:24-34`) has no `order_id`, and the three tests at `:67-109` expect `errDBBlip`. Fix: the skip class moved from Step 7 to Step 9, where the applied key it protects first exists; its tests moved from Step 8 to Step 10. Step 7 now says not to add it. No step was renumbered and no `Lands with` chain changed.
  - [x] WARN, Steps 18-19 side type: `BracketLegParent.Side` is now stated as a `tradingv1.OrderSide` holding the leg side, flipped by the caller with `oppositeSide`'s rule and written through `sideStr`. `oppositeSide` itself returns the broker wire string and is left alone. Recorded as spec assumption A-13.
  - [x] WARN, C-14: a `## Step Dependencies` line now records that ui `/trader` and agent `get_positions` get no step (read-only consumers, verified by the acceptance-suite scan). No follow-up feature is named because no change is planned.
  - [x] WARN, line hints: a hard `/sdd-execute` step now says to locate every cited site by symbol after BRANCH SYNC; the symbol wins over the number. The reviewer's tree predated feature 347; the spec's numbers were spot-checked on `fb52065c` (`processOrderFill` `:376`, `oppositeSide` `:3572`, `sideStr` `:436`) and match.
  - [x] WARN, Steps 7 and 9 both edit the head of `processOrderFill`: a Step Dependencies note says Step 9 re-reads Step 7's result and where the skip class goes.
  - [x] WARN, A-10 analysis consumer: checked. `_handle_order_event` (`pnl_pattern_consumer.py:348-404`) only stores `order_id`; the column has no foreign key or unique constraint (analysis migration `016`, lines 12 and 25-26). An unknown `order_id` is stored, not rejected. A-10 now carries this evidence.
  - [x] WARN, D-50 and the `context.md` size: both are now listed in the spec as gating preconditions; D-50 gates Steps 23-25 only.
  - [x] Overlap: the same-file findings (312, 315, 317, 321, 326) are recorded in Step Dependencies. No migration, proto or config collision.
- **Not changed, with the reason:**
  - Spec header `**Status**: pending`. The spec template (`.claude/skills/sdd-spec/reference/spec-template.md:8`) sets this value; it is step progress, not lifecycle. `status.md` reads `implementation-ready` and is the only lifecycle source. No mismatch.
  - Step 10 touches 8 files. It is not split: Step 9 deletes the repo methods that `portfolio_repo_test.go` and `position_drain_dbtest_test.go` call, so those two files do not compile outside the Step 9+10 unit. The reason is now in Step Dependencies.

## Open Threads

- **Unresolved impl-spec review items carried into execution.** `/sdd-execute` announces each one at every checkpoint until its box is ticked.
  - [ ] unaddressed — Steps 23-25 (D-50): the adoption-only throttle is an orchestrator assumption, not an operator ruling. Target: the operator confirms or overturns it before Step 23 starts.
  - [ ] unaddressed — `context.md` is far over the 65536-byte limit. Target: `/sdd-distill fix-position-fold-correctness` before the first step.
  - [ ] unaddressed — Steps 1-2 migration numbers (portfolio `019`, trading `012`) are free on `fb52065c`; unmerged branches of other features were not inspected. Target: the re-check after BRANCH SYNC.
  - [ ] unaddressed — Step 20 (A-5): the `KnownBrokerOrderIDs` and `NetFilledQtyBySymbol` changes are proven only by pgxmock SQL-shape tests. A wrong `UNION`, `DISTINCT ON` or sign would pass. Trading has no real-Postgres test job. Target: operator decision on a follow-up CI job; none is designed.
  - [ ] unaddressed — Step 21 (A-4, C-2): only the leg observer lower-cases IBKR statuses. The parent `pollFills` path still mismatches them. Step 27 logs it as a finding; it is not fixed here. Target: separate fix.
  - [ ] unaddressed — A-10 residual: a bracket-leg fill that reaches the analysis consumer when no P&L window is open would open one. Whether a leg fill can arrive after its position's close event was not checked. Target: check at Step 22, when the leg emit order is in code.
  - [ ] unaddressed — Overlap: 312 edits the same `alpaca-default` lines of `portfolio_service.go` that Step 9 builds on (`:434-437`); 315, 317, 321 and 326 edit other ranges of files this feature changes. All from product-spec evidence only. Target: whichever merges second rebases; re-run the overlap scan when a peer becomes implementation-ready.
- **Carried forward unchanged.** The O-61 operator confirmations before the cutover step and every accepted residual in the "sdd-design (approved)" and "sdd-spec" Open Threads above still stand.

## Session 2026-11-21 — operator ruling on D-50, recorded by the orchestrator (verbatim)

Question (handoff § 3.3): "Feature 311 (fix-position-fold-correctness), design decision D-50: accounts with adoption-only bracket legs (no fills) are polled for open bracket orders at the reconciler cadence, not on every fill-poller tick. This is currently an orchestrator assumption. Confirm it, or overturn it?"

Operator's answer (option selected): "Confirm D-50 (Recommended)".

Option text as offered: "Adoption-only accounts are listed at the reconciler cadence. Recorded verbatim in 311's context.md; the Step 23 gate clears."

Effect: D-50 is operator-confirmed; the Step 23 confirmation is cleared. Other § 3.3 items (how portfolio is stopped on each staging target; the real-Postgres trading test job follow-up) are still open.

## Session 2026-11-21 — operator rulings on cutover and CI scope, recorded by the orchestrator (verbatim)

Question (handoff § 3.3, cutover): "Feature 311 cutover is stop-then-start on staging, with no write fence. The design proposes stopping portfolio by removing the portfolio component from the DigitalOcean staging app spec, and by a compose stop on the homelab staging VM, but neither is verified from the repo. How is portfolio actually stopped on each staging target?"
Operator's answer (option selected): "As the design proposes".
Option text as offered: "DO staging: remove the portfolio component from the app spec and redeploy. Homelab staging: `docker compose stop` for portfolio on the VM. Recorded verbatim; 311's runbook step uses exactly this."

Question (handoff § 3.3, CI): "Feature 311 (position-fold correctness, portfolio + trading): should a follow-up real-Postgres test job for trading be added to CI, so trading's new fold/duplicate-guard SQL is tested against a real database rather than only fakes?"
Operator's answer (option selected): "Add to 311's scope".
Option text as offered: "Add a step for a real-Postgres trading job to 311's spec. Re-spec and a new impl-spec review are needed; 311 grows beyond 27 steps."

Orchestrator note (not an operator quote): the second ruling changes scope. 311 needs `/sdd-spec` re-spec for the added real-Postgres trading test step (and a C-11 design-gate check that no Floor rule or C-16 rule changes), then `/sdd-review impl-spec`, before `/sdd-execute`. Not yet done. The cutover ruling is confirmed as designed.

## Session 2026-11-26 — sdd-spec re-spec (operator ruling: add real-Postgres trading job)

- Re-spec of `implementation-spec.md` after the operator ruling "Add to 311's scope" (session 2026-11-21, "operator rulings on cutover and CI scope", recorded verbatim above). The cutover ruling is "as designed" and changes nothing. Status stays `implementation-ready`; total steps 27 → 29. `feature.md` (Status History row, Artifacts line, Reviewers snapshot, Next Action) and the spec header carry the new count; `status.md` is a plain lifecycle string and is unchanged.
- **Written by Claude from the orchestrator's task, not by the operator.** The skills' subagents were not available, so the review below is a **self-review by the same session that wrote the steps**, not an independent `/sdd-review impl-spec`. Run `/sdd-review fix-position-fold-correctness impl-spec` before `/sdd-execute`.
- **New steps** (all on `xstockstrat-trading`; former Steps 21-27 renumbered to 23-29, every cross-reference in the spec re-mapped by script and re-read):
  - **Step 21 — test:** real-Postgres proof for the `trading.bracket_legs` SQL. Creates `internal/repository/dbtest_helpers_test.go` (`//go:build dbtest`, `TRADING_DB_TEST_URL`, skip locally, fatal under `CI=true`, `lock_timeout` 500ms, prefix cleanup), `bracket_legs_dbtest_test.go` and `trading_repo_legs_dbtest_test.go`; edits the stale "no live-DB test harness" comment at `trading_repo.go:17-18`. Cases run in default and `QueryExecModeExec` (`DB_PGBOUNCER`) mode: `ActivateBracket` rows and rollback, the `ON CONFLICT DO NOTHING` duplicate guard, `ListTrackedLegs` order and retired filter, `ListAdoptionCandidates` (latest parent row's side, status bind, existing-leg and no-parent exclusions), `InsertAdoptedLeg`, `RecordLegObservation`, `AdvanceLegEmit` 4 then 10 (`@AC-5` at the SQL layer), `KnownBrokerOrderIDs` and `NetFilledQtyBySymbol` unions with signs, the observed column and the `DISTINCT ON` dedup. Covers `AC-4, AC-5`.
  - **Step 22 — config:** CI job `trading-db-test` (clone of `portfolio-db-test`, `./internal/repository/...`, `TRADING_DB_TEST_URL`), its `ci-gate` `needs:` and echo entries, and `build-tags: [dbtest]` in trading's `.golangci.yml`. `TDD: N/A` (workflow YAML).
  - **Step 29 (was 27):** also adds the `trading-db-test` row to `docs/patterns/ci-overview.md`.
  - Spec text changed: A-5 rewritten; new A-14 to A-17; Scenario Coverage rows for `@AC-4` and `@AC-5`; Step Dependencies lines for Steps 21-22 and the `ci.yml` overlap with 318 and 324; the D-50 gating line now records the operator confirmation (2026-11-21), clearing the old Step 25 gate.
- **Evidence used** (tree `origin/main-dev@fb52065c`, re-checked on tip `2b2dec92`): `.github/workflows/ci.yml` (`portfolio-db-test` `:1016-1065`, `marketdata-db-test` `:1067-1116`, `ci-gate` `:1377`, `needs` `:1396-1397`, echo `:1429-1430`, failure step `:1444-1447`, filters `:53`, `:88-97`); `docs/patterns/ci-overview.md:26-28`; `services/xstockstrat-portfolio/.golangci.yml:28-29`; portfolio `internal/repository/dbtest_helpers_test.go`, marketdata `fundamentals_replace_dbtest_test.go:22`; trading `trading_repo.go` (`:17-19`, `:41`, `:53`, `:130`, `:171`), `bracket_repo.go` (`:46-91`), `pool.go:31-32`, `internal/service/mtls_env_test.go:22`, migrations `001`, `003`, `005`; `scripts/db-migrate.sh:164`; `scripts/Dockerfile.migrate`. The tip diff touched none of these (trading changed only OTel versions in `go.mod`, `go.sum`, `internal/telemetry/otel.go`).
- **Design gate (C-11) check:** no design decision, `@AC-*` guarantee (C-16) or Floor rule changes. F-06 untouched (throwaway CI container), F-07 untouched (test-only env var), F-08 satisfied (each step lists everything it stages).
- **Self-review verdict (impl-spec criteria B2, B2b, B3, B3b applied to Steps 21-22 and to the renumbered spec; advisory):** 0 failures, 3 warnings.
  - Mechanical checks passed: 29 headings in order, every step has all template fields, every `**Lands with**` is symmetric, adjacent, at most 3 members (cap 4) and has its `## Step Dependencies` line, no reference to a step above 29, every `Covers` ID exists, every new `**Files**` path is exact.
  - Warning 1 (Step 21): the atomicity case relies on Postgres rejecting a NUL byte in a TEXT parameter (SQLSTATE `22021`). It could not be run here (no database). The step names a fallback and forbids weakening the assertion.
  - Warning 2 (Steps 21-22): the cases cannot be shown red or green locally. The TDD line records the mutation method and the CI job as the proof; a green run must show no skipped case (the helper is fatal under `CI=true`).
  - Warning 3 (Step 22): textual overlap on the `ci-gate` lists with 318 (Step 9) and 324; recorded in Step Dependencies.
  - Not covered by any case, on purpose: whether `AdvanceLegEmit` refuses a lower cursor (Step 18 does not specify it; Step 21 asserts only forward moves).
- **Resolved by this session:** the 2026-11-20 impl-spec review item "Step 20 (A-5): trading has no real-Postgres test job; operator decision on a follow-up CI job" is resolved by the ruling and Steps 21-22. The D-50 gate item is cleared by the 2026-11-21 operator confirmation. All other unaddressed items from that review's Open Threads stand (the old step numbers 23-25 there are now 25-27).

## Open Threads

- **Still open, needs an operator decision:** none. One reading to confirm if wanted: A-15 takes "trading's new fold / duplicate-guard SQL" to mean the `trading.bracket_legs` family (trading has no fold; the fold, pre-check and applied-row insert are portfolio SQL already on a real database in Step 11). If the operator meant more, say what.
- **Before `/sdd-execute`:** `/sdd-review fix-position-fold-correctness impl-spec` (independent, with subagents) on the 29-step spec; then `/sdd-distill fix-position-fold-correctness` (context.md is far over 65536 bytes).
- **Carried unchanged:** migration numbers re-check after BRANCH SYNC; Step 23 (was 21) IBKR status lower-casing only in the leg observer; A-10 analysis residual; peer overlaps 312, 315, 317, 321, 326 and now 318, 324 on `ci.yml`; the O-61 cutover confirmations (the stop methods were ruled "as designed" on 2026-11-21 and Step 28's runbook uses them).

## Session 2026-11-26 — independent impl-spec review + operator ruling on A-15, recorded by the orchestrator (verbatim)

Question (operator): "Your ruling was 'add a real-Postgres trading job so trading's new fold / duplicate-guard SQL is tested against a real database'. Trading has no position fold... The spec reads your ruling as: test trading's new trading.bracket_legs SQL (ON CONFLICT duplicate guards, the leg-adoption inserts, and the net-filled-quantity unions) at the repository level. Is that what you meant?"

Operator's answer (option selected): "Yes, repository-level bracket_legs SQL (Recommended)".

Effect: A-15 is operator-confirmed and is no longer an open assumption.

Independent `/sdd-review impl-spec` of the 29-step spec: PASS WITH WARNINGS, no blockers. Changes made to `implementation-spec.md` (nothing else changed):
- Step 21 atomicity case: the failure is now injected through `BracketLegParent.Symbol` containing a NUL byte, a field only the INSERT sees. A NUL in a stop or take-profit id would fail at the preceding UPDATE (`bracket_repo.go:94-95`) and never exercise the rollback. The case asserts a server `PgError` (22021), the bracket row's pre-call status and leg ids, and no `bracket_legs` rows; a fallback keeps the same assertions.
- Step 21 names its test functions (`TestBracketLegsDB_*`, `TestTradingRepoLegsDB_*`) so the `-run 'BracketLegsDB|TradingRepoLegsDB'` filter in Steps 21 and 22 matches. Step 18 now names the exported status identifiers (`LegStatusOpen`, `LegStatusFilled`, `LegStatusCanceled`, `LegStatusExpired`, `LegStatusRejected`, `LegStatusUnknown`, `LegStatusBaselineRetired`, `LegStatusNotOpenAtAdoption`); Step 21 refers to them.
- Step 21 skip check: an unpiped `go test` run (exit code) plus an unanchored `grep -c -- '--- SKIP'` on its output, so indented subtest skips count.
- `bracket_repo.go` cites aligned to the file: Step 18 `:41-43`, `:46`, `:91-100`; Step 21 `:91-100`.
- Low-severity notes: Step 29 -> Steps 21 and 22 dependency line; the take-profit NULL assertion uses a raw SELECT (`GetBracketByOrderID` COALESCEs to `''`) and the evidence and seed (d) note that `CreateBracket` stores `''` for an empty id; `seedParentOrder` takes a `brokerOrderID` argument; the cleanup remark now states `t.Cleanup` runs last-registered first and gives the registration order; Step 21 item 4 deletes the false parenthetical outright with no replacement comment.
- A-15 text now records the operator confirmation and drops "if the operator meant more, it is an open item".
- Open Threads: the A-15 item in the 2026-11-26 re-spec entry is closed by this ruling. Nothing else changed in status.

## Session 2026-11-26 — sdd-execute sequential (sdd-batch-execute)

Up-front confirmation: the operator approved the plan with this record (verbatim, binding):

```json
{"mainDev":"f802b184b13bd899d858c4b0349a616e9981b9d9","dev":"54c2fd8199edae3eca3b939a3769117d82da24c8","specHash":"18c51d35977e80bf26445e262047ae76b926a1f2","directive":"conditional","pending":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29],"mismatches":[{"n":3,"detail":"Codebase Evidence says '**Not found**: `pg_advisory`, `FOR UPDATE` or `Begin` anywhere in `internal/repository/`'. That is false on the merged tree. `Begin` appears in watchlist_repo.go:39,194,301,325,350,388 (`r.pool.Begin`), signal_expiry_repo.go:62 and deli"},{"n":5,"detail":"The call-site list is incomplete. `grep -rn 'emitEventAs(' services/xstockstrat-portfolio --include=*.go` returns 4 calls, not 3: portfolio_service.go:1360 (`emitRiskAlert`: `s.emitEventAs(ctx, userID, eventType, \"portfolio:risk\", payload)`), portfolio_service"},{"n":7,"detail":"Line drift only; all symbols found. ConsumeOrderFills/observed wrap :179-180, observed :234, streamRetryDelay :248, sleepFor :253, processOrderFill :376, ErrLedgerUnavailable :929, ErrFillUnattributable :975. boundedRetry is at :1550 with its 'event parked' lo"},{"n":9,"detail":"Line drift only. The positionsMu lock sites that stay are at :1610-1611 (processAccountDeregistered) and :1657-1658 (processPositionSync), not :1602-1603/:1649-1650. The fill-path lines match (:399, :409, :423 'fill.Qty > 0 { // buying more', :438 alpaca-defau"},{"n":14,"detail":"The verification `grep -n 'limit=500' services/xstockstrat-trading/internal/broker/alpaca.go # none` will still match the comment at alpaca.go:483 ('status=all keeps just-filled/canceled orders visible; limit=500 is the bulk-list ceiling.'). The evidence cites"},{"n":16,"detail":"Line drift only (about +8 after line 3500). appendLedgerEvent is at trading.go:3953 (spec :3945), IdempotencyKey uuid at :3965 (spec :3957), the emitLedgerEvent call at :3997 (spec :3989), emitLedgerEvent at :3996. The call at :1123 and test calls trading_offl"},{"n":19,"detail":"Line drift only. ACTIVE UpdateBracketStatus writes are at trading.go:3688 (Alpaca createBracket), :3705 (IBKR createBracket) and :3747 (resizeBracket), not :3680/:3697/:3739. ReArmProtection is at :3732, oppositeSide at :3580 (call sites :3695, :3737), emitBra"},{"n":23,"detail":"Line drift only. maybeSubmitBracket is at :3638 (spec :3630), alpacaStatusToProto at :3915 (spec :3907), ledgerEmitTimeout at :3940 and appendMaxAttempts at :3943, appendLedgerEvent at :3953. StartFillPoller :1793, pollFills :1816, logTick :1877, alpacaCallCon"},{"n":25,"detail":"Line drift only. shouldPollHaltedAccount is at :2953, haltAccount at :2977 (pre-stamp :2988), ResumeAccountSvc at :3295 (delete :3322), and TestShouldPollHaltedAccount_ThrottlesAndRecovers at trading_reconciliation_test.go:514 (spec :491-513; the same drift ap"},{"n":26,"detail":"Line drift only. credStatus copy is at :2166-2171, the credentialsKnownInvalid skip at :2178, ErrInvalidCredentials at :2194, isAccountHalted at :2945, credentialsKnownInvalid at :3235, and haltedPollInterval at :2678-2679 (spec :2674-2676). StartReconciliatio"},{"n":28,"detail":"Line drift only. The merge-order.md entry naming 311's trading.go overlap is now at :431 (spec :430). docs/runbooks/position-fold-cutover.md does not yet exist (correct for a create). The .do/app.dev.yaml citations match (:101 portfolio, :439 ledger DATABASE_U"},{"n":29,"detail":"Line drift only. The bracket-leg residual in services/xstockstrat-trading/docs/reconciliation.md is at :76-79 ('Alpaca bracket-leg fills, which never reach `trading.orders`'), not :70-75. The portfolio CLAUDE.md pointer to position-closed-contract.md is at :13"}]}
```

- Setup: the stale check passed (`origin/main-dev` = `f802b184`, dev = `54c2fd81`) and the hook check returned `hook=0`. Tooling detection for the Go steps: go1.27.0 is present. The host `golangci-lint` is v2.5.0 (built with go1.25.1), so each Go step must first install the pinned v2.14.0 with `GOTOOLCHAIN=go1.27.0 go install …` (tooling-setup.md) before its lint check.
- Merged `f802b184` into the dev branch (`acadbbdc`, no conflicts; ledger-guard clean).
- Re-spec (directive `conditional`), step bodies only:
  - Step 3: the "Not found: `FOR UPDATE`/`Begin`" line was false. Every existing transaction starts from `r.pool` or a pool argument, never from `r.db`, and the only row locks are `FOR UPDATE SKIP LOCKED`. `pg_advisory` is still not found. The design is unchanged.
  - Step 5: `emitRiskAlert` (`portfolio_service.go:1360`) is a fourth `emitEventAs` caller. It passes `""` and discards the error, like the `signal_prune.go` callers.
  - Step 14: the `limit=500` verification grep now matches only the URL literal, because the `alpaca.go:483` comment also names `limit=500`.
  - Steps 7, 9, 16, 19, 23, 25, 26, 28, 29: line numbers re-anchored.
- `respec(fix-position-fold-correctness)` commits in `git log --first-parent origin/main-dev..HEAD`: `a20ba1c4` (implementation-spec.md), `b93cb70f` (feature.md), `0f9340bc` (status.md).

```sdd-batch-setup
{"mainDev":"f802b184b13bd899d858c4b0349a616e9981b9d9","date":"2026-11-26"}
```

## Session 2026-11-27 — sdd-execute sequential (sdd-batch-execute), Step 1

### Step 1 — migration: portfolio `019_fill_applied_events` [done]
- Created `019_fill_applied_events.{up,down}.sql`. The `.up` creates `portfolio.consumer_applied_events`, with PK `(consumer, user_id, account_id, order_id)`, `event_id`, an `outcome` CHECK of `applied`/`parked`, `parked_reason`, `pending_closed JSONB` and `applied_at`. It also creates `portfolio.consumer_floors (consumer PK, floor_recorded_at)`. It seeds no row, creates no trigger and creates no other table. The `.down` drops both tables in reverse order. `019` was still the next free number: the highest on the merged tree is `018_watchlist_signal_expiry`. Other features' unmerged branches were not checked.
- TDD: N/A (migration). Verified offline: run `.sdd-logs/v-1.log` printed both paths, `2` and `0`. `exit=1` is `grep -c` exiting on a zero count; see the Deviation Log. Inspection: each CREATE TABLE has a matching DROP TABLE. No database was started. The config-wiring gate does not apply, because the migration writes no `config.config_values` row and the step declares no key.
- Tooling: none needed (migration step).
- Files modified: `services/xstockstrat-portfolio/migrations/019_fill_applied_events.up.sql`, `services/xstockstrat-portfolio/migrations/019_fill_applied_events.down.sql`
- Deviations: the Verification block exits 1 when it passes (Deviation Log, Step 1).
