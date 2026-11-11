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
