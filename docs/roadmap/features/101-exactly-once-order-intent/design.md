# Design: exactly-once-order-intent

**Created**: 2026-08-06
**From**: product-spec.md + recon.md
**Debate**: full mode, 7 rounds (user-extended past the default 5-round cap to close two rounds of
newly-surfaced correctness gaps — see context.md)

---

## Chosen Approach

### Schema — `trading.order_intents` (migration `006_order_intents`, pre-assigned in `merge-order.md`)

```sql
-- state values match the trading.v1.IntentState proto enum:
--   0 = UNSPECIFIED, 1 = PENDING, 2 = COMPLETED, 3 = REJECTED, 4 = UNKNOWN.
-- Every INSERT sets state explicitly (see InsertIntent) — the DEFAULT is a schema-level
-- safety net only, never relied on by application code (0 = UNSPECIFIED, not a real value).
CREATE TABLE IF NOT EXISTS trading.order_intents (
    intent_id         UUID        PRIMARY KEY,
    order_id          UUID,       -- populated at INSERT for ALL command types, see below
    request_hash      TEXT        NOT NULL,
    state             SMALLINT    NOT NULL DEFAULT 0,
    broker_account_id UUID        NOT NULL,
    first_response    JSONB,
    latest_response   JSONB,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_intents_pending_updated_at
    ON trading.order_intents (updated_at)
    WHERE state = 1;  -- PENDING only; matches the sweep's and reactive reclaim's exact predicate
```

Go-side mirror constants (never a bare literal in SQL or Go comparisons):

```go
const (
    IntentStateUnspecified int16 = 0
    IntentStatePending     int16 = 1
    IntentStateCompleted   int16 = 2
    IntentStateRejected    int16 = 3
    IntentStateUnknown     int16 = 4
)
```

**`order_id` is populated at insert time for every command type, including `PlaceOrder`** (the final,
round-7 fix). `PlaceOrder` already mints `orderID` and eagerly `UpsertOrder`s a real `trading.orders`
row (status `NEW`/`PENDING_APPROVAL`) *before* the broker call (`services/xstockstrat-trading/internal/service/trading.go:279-313`,
existing, unmodified behavior). The intent-insert reuses that same `orderID` as `order_intents.order_id`
instead of leaving it `NULL` until the terminal write. Without this, a crash-then-sweep-reclaimed
`PlaceOrder` intent could never join back to its already-visible order row via the LATERAL join below —
silently defeating FR-4's "surface `UNKNOWN` distinctly" promise for exactly the restart scenario FR-6
exists to cover, and leaving the `order_intent.reclaimed_unknown` ledger event with no `order_id` to key
on (every existing `emitLedgerEvent` call in this service keys on `order_id`, `trading.go:315,321,331,346,377`).
`ReplaceOrder`/`CancelOrder` populate it from `req.OrderId` (an existing order), unchanged from earlier
rounds.

### Concurrency — pure DB-only, no in-process mutex

The insert-or-return-existing idiom, verified correct across rounds 1–7 (no precedent existed in this
service for this shape — `recon.md`'s "Patterns to REUSE" confirms only a clobber-style `UpsertOrder`
`ON CONFLICT` existed before this feature):

```go
const insertIntentSQL = `
INSERT INTO trading.order_intents
    (intent_id, order_id, request_hash, state, broker_account_id, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, now(), now())
ON CONFLICT (intent_id) DO NOTHING
RETURNING intent_id, order_id, request_hash, state, broker_account_id,
          first_response, latest_response, created_at, updated_at`
// $4 = IntentStatePending — set explicitly, never left to the column DEFAULT (0 = UNSPECIFIED)
```

1 row returned → caller owns this intent; for `PlaceOrder` the intent-insert and the provisional
`trading.orders` row insert share one short local transaction (both are fast, local, no network I/O) —
**never** wrapping the subsequent broker HTTP call. Proceed to the broker call outside any transaction.

0 rows returned → existing intent; `SELECT` it and branch:

```go
const getIntentByIDSQL = `
SELECT intent_id, order_id, request_hash, state, broker_account_id,
       first_response, latest_response, created_at, updated_at
FROM trading.order_intents WHERE intent_id = $1`
```

- `RequestHash` mismatch → `codes.FailedPrecondition` (FR-3 — reusing an intent ID with different
  content is rejected outright).
- `State ∈ {Completed, Rejected}` → return the stored `first_response`/`latest_response` without
  calling the broker (FR-2).
- `State == Unknown` → `codes.FailedPrecondition`, no broker call, no exception (FR-5).
- `State == Pending` → staleness check against the derived threshold (see below); regardless of
  whether this call's own reclaim attempt fires, reject with the same `codes.FailedPrecondition` —
  the caller cannot and need not distinguish "not yet stale" from "just reclaimed" (round 3's
  collapsed-rejection decision, confirmed through round 7).

**Reclaim CAS** — the single mechanism for the `PENDING → UNKNOWN` transition, shared identically by
the reactive path above and the sweep loop below (deliberately: reusing one SQL statement for both call
sites avoids two divergent implementations of the same safety-critical transition):

```go
const reclaimOrphanIntentSQL = `
UPDATE trading.order_intents
SET state = $1, updated_at = now()
WHERE intent_id = $2 AND state = $3 AND updated_at < $4
RETURNING intent_id, order_id, request_hash, broker_account_id, updated_at`
// $1 = IntentStateUnknown, $3 = IntentStatePending, $4 = staleness cutoff
// updated_at included in RETURNING (round-7 fix) so the reclaim ledger event can record
// how long the intent was actually pending, not just that it exceeded the threshold
```

1 row affected → this call genuinely reclaimed the orphan; emit `order_intent.reclaimed_unknown`
(payload includes `trigger: "reactive"` or `trigger: "sweep"`, `order_id`, the original `updated_at`).
0 rows affected → someone else (a concurrent reactive caller, or a sweep tick) already reclaimed it, or
it's no longer stale — no event, silent no-op.

**Why no in-process mutex is needed (verified, round 2):** under Postgres's default READ COMMITTED
isolation, a blocked `UPDATE ... WHERE state = $3` re-evaluates its WHERE clause against the
just-committed row (`EvalPlanQual`) once it acquires the row lock — a second concurrent reclaimer
correctly sees 0 rows affected. **Load-bearing invariant, stated explicitly (round 3):** every
`order_intents` operation (insert, select, reclaim, terminal write) is its own single autocommit
statement under this pool's default isolation; **no transaction ever wraps the synchronous broker HTTP
call**, and no pooled connection is held across it. `xstockstrat-trading`'s pool is capped at
`DB_POOL_MAX` default 2 (`internal/repository/pool.go:19-40`) — holding a connection across a 5–10s
broker round-trip (`trading.broker.timeout_ms` default 5000ms for Alpaca, IBKR hardcoded 10s,
`internal/broker/ibkr.go:55`) against that budget would starve the fill/position-sync/credential
pollers and every other RPC handler. The one exception, explicitly scoped and justified (round 4): the
intent-insert and the provisional order-row insert (both fast, local, no network I/O) may share one
short transaction, closing a narrow orphaned-intent-with-no-matching-order crash window for free.

### Sweep — proactive reclaim, closing the unattended-crash gap (round 4–5)

The reactive reclaim above only fires as a side effect of a *retry*. If a client crashes and the
operator never resubmits, a `PENDING` intent would sit unreclaimed forever with no operator signal —
exactly the silent-not-failed scenario FR-4 exists to prevent, and exactly the crash-mid-request
scenario named in product-spec's own Problem Statement. `StartOrderIntentSweeper(ctx)` closes this,
mirroring `StartFillPoller`'s exact ticker + `ctx.Done()` shape (`services/xstockstrat-trading/internal/service/trading.go:629-650`),
wired at startup alongside the three existing pollers (`cmd/server/main.go:106,108,110`), sharing the
same top-level cancellable `ctx`.

New config key `trading.order_intent.sweep_interval_ms`, default **5000** (matching
`trading.fill_poller.interval_ms`'s existing precedent value, `trading.go:630,640` — corrected from an
earlier round's erroneous 30000ms default, which was actually *double* the threshold floor despite
being described as "well under" it).

Each tick:

```go
const sweepSelectSQL = `
SELECT intent_id, order_id, request_hash, broker_account_id
FROM trading.order_intents
WHERE state = $1 AND updated_at < $2
ORDER BY updated_at
LIMIT $3`
// $1 = IntentStatePending, $3 = 100 (batch size per tick)
```

Then loop over the returned rows, re-running `reclaimOrphanIntentSQL` once per `intent_id` — the
**identical** statement the reactive path uses, not a new SQL shape, so it inherits the same safety
property (each is an independent single-row optimistic UPDATE, no new lock, bounded lock duration per
row given the 2-connection pool). A row that changed state between the `SELECT` and its own `UPDATE` is
a safe no-op (0 rows affected). `LIMIT 100` per tick, uncaught backlog rolls to the next tick 5000ms
later — self-healing; corrected worst-case-lag statement: **an orphaned `PENDING` intent is reclaimed
no later than `threshold_ms` + up to one `sweep_interval_ms`**, not "roughly one interval" as an
earlier round mis-stated.

**Audit symmetry (round 6):** both the reactive path's own successful reclaim and the sweep's
successful reclaim emit the *same* event type, `order_intent.reclaimed_unknown`, distinguished only by
a `trigger` payload field — not two different event names — so the audit trail for "this intent went
`PENDING → UNKNOWN`" is uniform regardless of which code path performed it.

**Sweep visibility is poll-only, not pushed** (round 5, explicit deliberate limitation): the sweeper
does not call `broadcastOrder` for `StreamOrderUpdates` subscribers — doing so would require loading
the full `Order`, refreshing the in-memory map, and broadcasting, extra plumbing not justified by this
feature's scope. Justified because `useOrders`/`useOrder` already poll independently at
`refetchInterval: 5_000` (`services/xstockstrat-ui/src/hooks/useOrders.ts:48,61`), the same order of
magnitude as the sweep interval — a sweep-driven `UNKNOWN` surfaces via the LATERAL join (below) on the
next poll regardless of streaming.

### Cross-intent precedence — read-time LATERAL join (round 3)

An `Order` can accumulate multiple intents (a `Place`, possibly `Replace`(s), possibly a `Cancel`), each
independently `PENDING`/`UNKNOWN`/terminal. Precedence rule: **the intent row with the latest
`updated_at` across all intents sharing that `order_id` determines the single `intent_state` shown on
that `Order`.** Mechanism — a read-time query, not a second write path, so it adds zero writes beyond
the intent table itself:

```sql
LEFT JOIN LATERAL (
    SELECT state, updated_at FROM trading.order_intents
    WHERE order_id = trading.orders.order_id
    ORDER BY updated_at DESC LIMIT 1
) li ON true
```

added to `GetOrder` (`internal/repository/trading_repo.go:82-95`) and `ListOrders` (`:98-189`), `li.state`
scanned into `Order.IntentState`. This structurally wires `CancelOrder`'s existing fail-open-on-broker-
error path (`trading.go:404-413`, "mark canceled locally regardless") into the same display: that
branch's cancel intent goes to `UNKNOWN` (not `CONFIRMED` — a broker-call failure doesn't support the
certainty `CONFIRMED` would assert), and the LATERAL join surfaces it on the order the operator is
looking at, without altering Cancel's existing "act as if it worked" `OrderStatus` behavior at all —
these are deliberately two different axes (product-spec.md's own orthogonality framing).

**Write-handler parity (round 4, C-10(b)):** `PlaceOrder`, `ReplaceOrder`, and `CancelOrder`'s own
directly-returned `Order` each set `IntentState` from the value they just wrote in memory — not only
via a later `GetOrder`/`ListOrders` call through the LATERAL join.

**Documented eventual-consistency caveat (round 4):** `StreamOrderUpdates` sets `IntentState` inline
from the writer's own just-known value without re-running the LATERAL-join precedence query against
sibling intents — under concurrent activity on the same `order_id`, a stream push can show a value a
subsequent poll then contradicts. Narrow window, accepted under this feature's single-human-operator
usage today.

**Index note:** `(order_id, updated_at DESC)` should be indexed on `order_intents` to keep the LATERAL
join cheap on `ListOrders`' existing `LIMIT 500` query — flagged for `/sdd-spec` alongside the partial
sweep index above.

### `IntentState` — orthogonal field, not a widened `OrderStatus` (round 1, reaffirmed every round)

`IntentState intent_state = 21` on `Order` (`packages/proto/trading/v1/trading.proto:32-53`, next free
field number confirmed by recon), **not** `ORDER_STATUS_UNKNOWN` on the existing `OrderStatus` enum.
Product-spec is explicit and unambiguous: "`UNKNOWN` describes the platform's knowledge of *whether the
command landed*, not the order's fill progress" — an order can be `NEW`/`PARTIALLY_FILLED` *and*
`intent_state = UNKNOWN` simultaneously, which cramming into `OrderStatus` would make inexpressible.
Naming/shape precedent borrowed from `CredentialStatus`'s tri-state enum (`trading.proto:160-165`), not
its actual values.

### Staleness threshold — derived live, floor-clamped (round 3)

```
threshold_ms = max(live trading.broker.timeout_ms, IBKRRequestTimeout) * multiplier
```

`IBKRRequestTimeout` is a single named Go constant (e.g. `broker.IBKRRequestTimeout = 10 * time.Second`),
referenced by both `ibkr.go`'s HTTP client construction and this formula — not two independent `10000`
literals (round 4 fix) — so if the pre-existing IBKR-hardcoded-timeout bug
(`services/xstockstrat-trading/docs/context-constitution-findings.md:21`) is ever fixed to be
config-driven, this formula's floor picks up the change automatically. `multiplier` is read **live**
(not cached) from new config key `trading.order_intent.stale_multiplier` (float, default `3.0`),
**floor-clamped in code to ≥1.5** so an operator cannot push the effective threshold below the live
broker timeout even by misconfiguring the multiplier itself. This closes a real drift risk found in
round 2: `trading.broker.timeout_ms` is live-reloadable via `WatchConfig` with no restart — a static
threshold could silently fall below a raised broker timeout during an incident, causing a premature
reclaim that could push an operator to manually re-place a genuinely-in-flight order through a path
(a fresh nonce) that bypasses this feature's own dedup. Deriving the threshold from the same live value
removes the drift dependency entirely rather than merely documenting it.

### `PlaceOrder`'s intent ID — client nonce (round 1–2, Consumer Surface(s) expanded)

`PlaceOrder`'s intent ID is seeded from `req.ClientOrderId`, now **mandatory** — `InvalidArgument` on
empty (a deliberate, scoped behavior change from today's accepted-but-unused field,
`trading.go:287`). This requires the trader UI's Place Order flow to generate a stable nonce per
logical action (on form open / first submit) and reuse it across retries of that same action — **an
explicit, user-approved expansion of product-spec's Consumer Surface(s)** (Constitution C-14 override,
recorded in context.md 2026-08-06). Without it, the server cannot distinguish "same logical action,
retried" from "a brand new call," and FR-1/FR-2's dedup guarantee cannot hold for `PlaceOrder` — a
content-hash derivation was considered and rejected (round 1) because it would collapse a *deliberate*
duplicate order with a lost-response retry, exactly the failure mode this feature must not introduce.
`ReplaceOrder`/`CancelOrder` target an already-identified `order_id` and derive their intent ID
server-side from request content — no client nonce needed, since a content-identical replace/cancel on
the same order is safe to collapse.

**Broker client-order-id:** `"xss-" + intentID` (~40 chars, ASCII) sent as `brokerReq.ClientOrderID` —
existing support for Alpaca (`internal/broker/alpaca.go:106,113`); genuinely new plumbing for IBKR,
whose `SubmitOrder` sends no client-order-id today (`internal/broker/ibkr.go:116-169`) — IBKR has no
broker-side dedup at all, so this platform-side mechanism is IBKR's *only* dedup, not a backstop.
**Open Risk, unresolved across all 7 rounds:** Alpaca's and IBKR's actual client-order-id length/charset
limits are not documented anywhere in this repo — must be verified against each broker's public API
docs at `/sdd-spec`, before wiring the broker clients.

### Rejection code

Uniform `codes.FailedPrecondition` for every reject branch (hash mismatch, terminal-content-mismatch,
`UNKNOWN`-block, not-yet-stale-`PENDING`) — precedented in this exact service
(`ReplaceOrder`'s not-replaceable / no-broker-order-id checks, `trading.go:456,461`), matching gRPC's
own documented semantics ("client should not retry until system state is explicitly fixed"). A third,
distinct rejection code ("still processing") was proposed in round 2 and explicitly rejected in round 3
as un-specced, un-actionable client-visible complexity the current UI plan has no use for
(CLAUDE.md's "write the minimum" guardrail).

### Late-broker-response race — accepted limitation (round 4–7, reaffirmed)

If the sweep (or a reactive caller) reclaims an intent to `UNKNOWN` at T, and the *original* (not
retried) synchronous handler's still-in-flight broker call returns after T, its terminal write
(`finalizeIntentSQL`, `WHERE intent_id=$4 AND state=$5(Pending)`) affects 0 rows — it cannot resurrect a
row already reclaimed. This is deliberate: weakening the CAS to a blind overwrite would reintroduce the
"was it a legitimate reclaim or a stale clobber" ambiguity this entire design exists to prevent.
**The real broker response is captured only in the `order_intent.late_response_conflict` ledger event's
payload** (unchanged since round 2), not written back to `order_intents`/`orders`, until demoted feature
`102`'s automated reconciliation eventually lands — FR-5 explicitly defers that (product-spec.md, Out of
Scope). This is an accepted v1 limitation, not a bug: the operator-facing runbook note (below) makes the
two relevant ledger events' semantics explicit so a human isn't left guessing which one to check.

```go
const finalizeIntentSQL = `
UPDATE trading.order_intents
SET state = $1, order_id = $2,
    first_response = COALESCE(first_response, $3), latest_response = $3, updated_at = now()
WHERE intent_id = $4 AND state = $5
RETURNING intent_id`
// $1 = IntentStateCompleted or IntentStateRejected, $5 = IntentStatePending
// COALESCE is defensive: the WHERE state=$5(Pending) guard means this CAS can only ever
// fire once per row (state leaves PENDING permanently after), so first_response is always
// NULL going in today — COALESCE costs nothing and protects against a future regression
// where this statement is reused in a context where that invariant no longer holds.
```

### Runbook note (operator-facing, `/sdd-spec`-time doc addition)

Two distinct ledger events an operator may need to check, named explicitly (not just "candidates"):

- **`order_intent.reclaimed_unknown`** ("we gave up waiting on this intent — the staleness threshold
  passed with no owner response, so we marked it `UNKNOWN` and will never auto-retry it. Action: check
  the broker dashboard directly, per FR-5.")
- **`order_intent.late_response_conflict`** ("the original owner's broker response finally arrived, but
  too late — this intent had already been reclaimed to `UNKNOWN`. The real broker answer is recorded
  *only* in this event's payload, not applied back to the row, until feature 102 lands. Action: read
  this event's payload for the actual outcome.")

### Retention (round 6–7, reframed)

No retention/archival job for `order_intents` in v1 — **a bounded first-version decision, not a
permanent one**, since neither `recon.md` nor `product-spec.md` establishes a retained-row-count
estimate (only a *rate* bound: single human operator, no automated caller). Explicit revisit trigger:
if `order_intents`'s row count exceeds ~500,000 rows (an engineering default, not a measured figure),
add a pruning job or convert to a TimescaleDB hypertable following the `trading.orders` precedent
(`migrations/001_orders_hypertable.up.sql`) — noting that conversion would require a composite PK
(`orders` uses `PRIMARY KEY (order_id, created_at)`, not `order_id` alone), a real if small schema
change to plan for at that time, not now.

### Test fixes (same-PR, C-08)

Mandatory `client_order_id` breaks three existing suites — fixed in the same PR as the feature, not
deferred:

- `scripts/integration-test.sh` `section_8_place_order` (~L420-448): add a `client_order_id` to the
  `PlaceOrder` JSON payload.
- `scripts/integration-test.sh`'s maintenance-mode negative test (~L502-545): its broad grep assertion
  (`maintenance|unavailable|rejected|error|...`) would otherwise **false-positive** on the new
  InvalidArgument-for-missing-nonce rejection instead of genuinely testing maintenance-mode behavior —
  add `client_order_id` to that section's payload too so the test's original intent is preserved.
- `services/xstockstrat-ui/e2e/trader/api-smoke.spec.ts` (~L67-87): add `clientOrderId` to the posted
  body.

### Migration numbering (resolved, round 0/recon)

`006_order_intents` — pre-assigned in `docs/roadmap/features/merge-order.md` (030 →
`005_broker_accounts_halted`, 101 → `006_order_intents`), committed separately from this design debate
as soon as recon found the collision. `101` cannot merge its integration PR until `030`'s migration
lands, per the standard golang-migrate numeric-order rule.

---

## Rejected Alternatives

- **In-process per-intent keyed `sync.Mutex`** (round 1's original proposal) — rejected in round 2: its
  sole justification (`instance_count: 1` → no cross-instance coordination needed) was unverifiable
  against DO App Platform's actual rolling-deploy mechanics (no fact found in `.do/app.yaml` or
  `docs/setup/digitalocean.md` about deploy-cutover overlap), and a mutex provides zero protection
  across a process boundary if one ever exists — exactly during a redeploy, the routine event this
  feature's own Problem Statement names as the risk. The DB-only mechanism is correct under any instance
  count, removing the dependency on that unverified fact entirely rather than defending it.
- **`ORDER_STATUS_UNKNOWN` on the existing `OrderStatus` enum** — rejected in round 1: would make "an
  order that's `NEW` and also uncertain" inexpressible, contradicting product-spec's explicit
  orthogonality statement.
- **Content/time-bucket hash for `PlaceOrder`'s intent ID (no UI nonce)** — rejected in round 1: collapses
  a deliberate duplicate order with a lost-response retry, the exact failure mode this feature must not
  introduce for the one command type where a duplicate is a legitimate, common case.
  Product-spec's Consumer Surface(s) was expanded instead (user-approved, C-14) to name the UI nonce
  work explicitly.
- **A third "still processing" rejection code (`codes.Unavailable`)** — proposed in round 2, rejected in
  round 3: un-specced new client-visible behavior the current UI plan has no use for; collapsed into the
  uniform `FailedPrecondition` rejection instead.
- **Single unified ledger event for reclaim + late-response-conflict** — considered in round 6, rejected:
  the two events answer genuinely different operator questions ("did we give up?" vs. "did we learn the
  truth too late?") and operators grep/alert on event *type* first — conflating them would mislead a
  log scan even with a distinguishing payload field.
- **Full hypertable/chunking for `order_intents` from day one** — considered in round 6/7, rejected as
  premature: a plain table + a partial index is sufficient for the confirmed rate profile; the
  conversion path is named and ready if the revisit trigger is hit, not built preemptively.
- **Blind-overwrite terminal write (no optimistic CAS)** — implicitly rejected throughout: would let a
  late genuine broker response silently clobber a legitimate `UNKNOWN` reclaim with no way to tell
  which write is authoritative; the CAS-loses-cleanly + ledger-event-carries-the-truth design was chosen
  instead.

---

## Open Risks

_Carry each of these into `context.md` § Open Threads with a target step at `/sdd-spec` time._

1. **Broker client-order-id length/charset** — `"xss-"+intentID` (~40 chars) is unverified against
   Alpaca's and IBKR's actual public API limits after 7 rounds; this repo has no such documentation.
   Named owner-step: verify before wiring the broker clients at `/sdd-spec`.
2. **Config registration** — `trading.order_intent.stale_multiplier` and
   `trading.order_intent.sweep_interval_ms` need registration in three places at `/sdd-spec`:
   product-spec.md's Config Key Changes, `services/xstockstrat-trading/CLAUDE.md`'s Config Keys
   Consumed table, and `docs/patterns/config-governance.md`'s Per-Feature Registered Keys log (C-05).
3. **Sweep `LIMIT 100` backlog bound** — low severity given this platform's confirmed profile (single
   human operator, no automated/bulk order placement — corroborated by `merge-order.md`'s note that
   the unattended-caller-dependent features 103/104/105/107 were demoted). Becomes a real risk only if
   a future automated order-placing caller is added — re-assess at that time, not now.
4. **A 4th poller on the 2-connection pool** — with the new partial index keeping each round-trip cheap,
   this is a monitoring note, not a blocker. Worth watching in practice once implemented.
5. **`order_intents` retention** — no job in v1; revisit if row count exceeds ~500,000 (engineering
   default, not measured). Remediation path named: hypertable conversion, composite-PK change required.
6. **`(order_id, updated_at DESC)` index for the LATERAL join** — needed to keep `ListOrders`' `LIMIT 500`
   query cheap; must land in migration `006` alongside the sweep's partial index — flag explicitly at
   `/sdd-spec` so it isn't dropped.
7. **UI 5 call-site enumeration** — `OrderStatusBadge` (`orderShared.tsx:45-48`, called from
   `positions/[symbol]/page.tsx:388` and `orders/[id]/page.tsx:93`) and `OrderStatusCell`
   (`orderShared.tsx:69-75`, called from `OrderBook.tsx:51` and `OrdersTable.tsx:110`) all need the new
   `intentState` prop threaded through; convert `STATUS_VARIANT` to the exhaustive `Record<Enum,
   EnumRender>` pattern (`opportunityShared.tsx:43-48` precedent) so a future enum value fails `tsc`
   instead of silently falling through. `isWorking()` (`orders/[id]/page.tsx:29-31`) gains an
   `intentState` param, gates Replace/Cancel button availability on `intentState != UNKNOWN` — a
   deliberate UI-only scope line (not a server-side RPC block), justified against CLAUDE.md's "touch
   only what the task requires" guardrail.
8. **Feature 096 file-level overlap** — `orderShared.tsx`/`e2e/fixtures/orders.ts`/`mock-backend.ts` are
   shared with in-flight feature 096; check its current step status before editing at `/sdd-spec` to
   avoid a merge conflict on the same files.
9. **`102-broker-state-reconciliation`'s forward dependency** — `102` (demoted/deferred, not building
   this session) will eventually consume `order_intents`' `PENDING`/`UNKNOWN` state and the
   `late_response_conflict` event's payload as its reconciliation input; this design's schema and event
   shapes should be reviewed against `102`'s eventual product-spec when that feature is picked back up,
   per `merge-order.md:43`'s existing dependency note (`102` → `101`).

---

## Constitution Rules Touched

- **C-01** (evidence-grounded claims) — every design decision across all 7 rounds cited to `recon.md`
  `path:line`; multiple rounds explicitly caught and corrected unverified "absence"/"already correct"
  claims (round 3's "no current callers" claim, round 6's SQL-type-literal bug, round 7's `order_id`
  gap) rather than letting them stand. Honored via the adversarial process itself.
- **C-04** (enum zero-value sentinel) — `IntentState`'s `UNSPECIFIED = 0` confirmed as the true
  zero-value, with every INSERT setting `state` explicitly rather than relying on the column `DEFAULT`.
- **C-05** (config naming) — `trading.order_intent.stale_multiplier` / `trading.order_intent.sweep_interval_ms`
  follow the `<service>.<category>.<key>` format; registration in all required locations flagged as
  Open Risk #2, not yet executed (documentation work, deferred to `/sdd-spec`).
- **C-07** (migration numbering) — `006_order_intents` pre-assigned via `merge-order.md` against a real,
  confirmed collision with feature 030; `/sdd-spec`/`/sdd-execute` must still re-`ls migrations/`
  immediately before writing the number, per C-07's literal text.
- **C-08** (test pairing) — same-PR fixes required for the three test files broken by the new mandatory
  `client_order_id`, explicitly named, not deferred as follow-up work.
- **C-10(a)** (no per-handler copy-paste) — the reclaim CAS is a single shared statement used by both the
  reactive path and the sweep loop, not two divergent implementations of the same transition.
- **C-10(b)** (parity across all read paths) — `IntentState` set on every write-handler's own direct
  `Order` response, not only via the `GetOrder`/`ListOrders` LATERAL join; the stream/poll eventual-
  consistency caveat is explicitly documented rather than silently left as an undocumented gap.
- **C-11** (SDD grounding) — this design followed the full recon → grilling pipeline; a genuine C-14
  scope fork (the UI nonce requirement) was routed to the user via `AskUserQuestion` rather than
  silently resolved.
- **C-14** (named consumer surfaces) — product-spec.md's Consumer Surface(s) section was explicitly
  expanded (user-approved override, recorded in context.md) to add the Place Order flow's client-nonce
  generation/reuse, once round 1's adversary found FR-1/FR-2's core guarantee had no defined mechanism
  without it.
- **P-01/P-02** (single orchestrator writer, mediated exchanges) — honored throughout; proposer and
  adversary subagents never exchanged raw output directly across all 7 rounds.
- **P-03** (no silent deviation) — every objection either resolved with a concrete fix or explicitly
  recorded as a named Open Risk with an owner-step; nothing was silently dropped.
- **P-04** (design gate) — every round's synthesis was presented to the user via `AskUserQuestion`
  before proceeding; the user explicitly extended the debate past the default 5-round cap twice
  (rounds 6 and 7) rather than the orchestrator silently looping or silently stopping.
- **F-11** (Floor blocks approval) — no `F-*` breach was found or claimed at any point across all 7
  rounds; the extended debate was driven by correctness/completeness objections (P-03/C-01/C-10-class),
  never a Floor item.

---

## Rounds

**7 rounds, full mode.** Default hard cap is 5; the user explicitly extended it to 7 (see context.md)
because round 5's final adversary pass surfaced two genuinely new gaps (missing index/retention
position, reactive-vs-sweep audit asymmetry) after an initial APPROVE-with-open-risks verdict, and round
6's pass then found a real SQL type-literal bug (string literals against a `SMALLINT` column) plus an
ungrounded retention estimate. Round 7's final adversary pass found one more genuinely new, purely
mechanical gap (`PlaceOrder`'s `order_id` must be populated at insert, not left NULL until the terminal
write) which was folded directly into this document rather than requiring an 8th round, per the
adversary's own assessment that no further debate was needed to resolve it. Termination reason:
round 7's adversary verdict was NEEDS WORK but explicitly characterized as "a one-line, mechanical
change" resolvable without another round — the orchestrator applied the fix directly in this synthesis,
consistent with the design phase's mediator/synthesizer role (P-01/P-02) once no further genuine
disagreement remained.
