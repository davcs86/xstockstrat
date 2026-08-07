# Recon: exactly-once-order-intent

**Created**: 2026-08-06
**From**: product-spec.md
**Affected services**: xstockstrat-trading, xstockstrat-ui

---

## Objective

Introduce a durable order-intent record in `xstockstrat-trading` (platform intent ID, deterministic
broker client-order ID, request hash, lifecycle state including a new `UNKNOWN` uncertainty state,
broker account/environment, first/latest broker response) so that the trader UI's `PlaceOrder`/
`ReplaceOrder`/`CancelOrder` calls execute at most once despite retries, timeouts, or a service restart
on this single-instance, no-HA deployment — not a new state machine built from scratch, but closing a
confirmed, already-live gap.

## Codebase Map

- **`xstockstrat-trading`** (Go)
  - Entry points: `TradingHandler.PlaceOrder` (`internal/handler/trading.go:31-43`, wraps every error
    as `CodeInternal` — loses status detail), `.CancelOrder` (`:45-54`), `.ReplaceOrder` (`:56-67`,
    preserves gRPC status code via `connectCodeFromErr`).
  - Service layer: `TradingService.PlaceOrder` (`internal/service/trading.go:242-385`), `.CancelOrder`
    (`:387-427`), `.ReplaceOrder` (`:433-504`).
  - **Confirmed: zero idempotency layer exists today.** `PlaceOrder` mints `orderID := uuid.New()`
    (`trading.go:279`) fresh on every call — a retried RPC mints a *new* ID and calls the broker again.
    No pre-broker-call lookup by request hash or client ID anywhere.
  - **Confirmed: timeout and rejection are conflated.** Any broker-call error (including a timeout) is
    wrapped and the order is unconditionally set to `ORDER_STATUS_REJECTED` (`trading.go:343-352`) —
    this is exactly the ambiguity FR-4's `UNKNOWN` state must fix, not a hypothetical gap.
  - `ClientOrderId` is a real proto field (`Order.client_order_id=2`,
    `PlaceOrderRequest.client_order_id=10`, `trading.proto:34,91`) but **the request's value is never
    used for broker dedup** — the internally-minted `orderID` is sent to the broker instead
    (`brokerReq.ClientOrderID = orderID`, `trading.go:341`); `req.ClientOrderId` is stored/displayed
    only (`trading.go:287`).
  - **Broker-level client-order-id support is asymmetric**: Alpaca forwards `client_order_id` in its
    `POST /v2/orders` body (`internal/broker/alpaca.go:106,113`). **IBKR's `SubmitOrder` sends no
    client-order-id field at all** (confirmed via full read, `internal/broker/ibkr.go:116-169`) — IBKR
    has no broker-side dedup hook today, so this feature's dedup must be enforced at the platform layer
    (the `order_intents` table), not delegated to the broker for IBKR.
  - No `context.WithTimeout` wraps the synchronous broker call in any of the three handlers — timeout
    enforcement is entirely inside each broker client's own HTTP client (Alpaca: `trading.broker.timeout_ms`,
    default 5000ms, `alpaca.go:44-53`; **IBKR hardcodes 10s**, `ibkr.go:55`, a confirmed pre-existing bug
    per `services/xstockstrat-trading/docs/context-constitution-findings.md:21` — not this feature's to fix,
    but relevant context for how long an `UNKNOWN` window can last).
  - `CancelOrder` on broker failure only logs a warning and marks the order `CANCELED` locally regardless
    (`trading.go:404-413`, comment: "broker may have already filled/canceled") — an existing, deliberate
    fail-open pattern for cancel specifically.
  - `ReplaceOrder` on broker failure returns `codes.Internal` and leaves persisted state untouched
    (`trading.go:478-480`) — no uncertainty flag recorded today.
  - Last migration: `004_broker_accounts_credential_status` (`services/xstockstrat-trading/migrations/`)
    — confirmed highest on disk via directory listing.
  - Repository: `TradingRepo` (`internal/repository/trading_repo.go:16-33`); pool via `newPool`
    (`internal/repository/pool.go:19-40`, `DB_POOL_MAX` default 2). Only existing `ON CONFLICT` is
    `UpsertOrder`'s clobber-style `ON CONFLICT (order_id, created_at) DO UPDATE SET ...`
    (`trading_repo.go:61-68`) — **not** an insert-or-return-existing idiom; no precedent for that shape
    exists in this service.
  - No `ErrNotFound`-style sentinel exists in this service's repo layer — `GetOrder` returns `(nil,nil)`
    on not-found, callers check `order == nil` (`trading_repo.go:82-95`).
  - `Order` message: fields 1–20, next available field number **21** (`trading.proto:32-53`).
    `OrderStatus` enum: values 0–7 (`UNSPECIFIED..PENDING_APPROVAL`), next available **8**
    (`trading.proto:70-79`) — **no `UNKNOWN` value exists yet**. A same-file precedent for a tri-state
    uncertainty enum already exists: `CredentialStatus` (`UNSPECIFIED=0, OK=1, INVALID=2, UNKNOWN=3`,
    `trading.proto:160-165`) — useful naming/shape precedent.
  - `emitLedgerEvent(ctx, eventType, streamKey, payload)` — `trading.go:1426-1439`, fire-and-forget,
    10s timeout, called via `go s.emitLedgerEvent(...)` at every existing lifecycle transition
    (`trading.go:315,321,331,346,377,421,498`).
  - Config-read pattern: `s.cfgW.GetBool/GetFloat/GetInt("trading.<category>.<key>", default)` —
    e.g. `trading.broker.timeout_ms` (`trading.go:1280`), `trading.approval.require_above_qty`
    (`trading.go:274`). A new `trading.order_intent.*` retry-block-duration key would follow this.

- **`xstockstrat-ui`** (Next.js)
  - Orders list: `services/xstockstrat-ui/src/app/trader/orders/page.tsx:1-64` — renders
    `<OrdersTable orders={data?.orders ?? []} .../>` via `useOrders` (`:28,53`).
  - Order detail: `services/xstockstrat-ui/src/app/trader/orders/[id]/page.tsx:93` —
    `<OrderStatusBadge status={order.status} />`; also has its own ad-hoc `isWorking()` predicate
    (`:29-31`, `status === NEW || status === PARTIALLY_FILLED`) that would need reviewing so a new
    `UNKNOWN` value isn't misclassified as "working."
  - **The file to change**: `services/xstockstrat-ui/src/components/trader/orderShared.tsx:10-21,45-48`
    — `STATUS_VARIANT: Record<string, 'info'|'warning'|'buy'|'secondary'|'destructive'>` is a
    **non-exhaustive** map keyed on `string`, not the `OrderStatus` enum type. `OrderStatusBadge`'s
    fallback (`STATUS_VARIANT[name] ?? 'secondary'`, `:47`) means a new enum value added without a
    matching map entry compiles cleanly and silently renders identically to `CANCELED`/`EXPIRED` — no
    `tsc` failure catches the gap.
  - **Exhaustive-map precedent to follow instead**: `services/xstockstrat-ui/src/lib/opportunityShared.tsx:43-48`
    — `SOURCE_HEALTH: Record<SourceHealthStatus, EnumRender>` is keyed on the enum type itself (per
    `services/xstockstrat-ui/CLAUDE.md:77-79`: "Adding a proto enum value without a map entry fails
    `tsc` here"), and already includes an explicit `Unknown`-labeled entry for its own `UNSPECIFIED`
    value — the shape 101's `STATUS_VARIANT`/`OrderStatusBadge` should adopt for compile-time
    enforcement instead of the current silent fallback.
  - Typed client: `useOrders`/`useOrder` (`src/hooks/useOrders.ts:1-63`) import `OrderStatus` straight
    from generated proto TS (`@xstockstrat/proto/trading/v1/trading_pb`) — no hand-rolled duplicate
    type; the only hand-maintained artifact downstream of the enum is `STATUS_VARIANT` itself.
  - BFF proxy: `services/xstockstrat-ui/src/lib/traderBff.ts:35-42` (`listOrders`), `getOrder` (forward).
  - Order e2e fixtures: `services/xstockstrat-ui/e2e/fixtures/orders.ts` (`ORDER_FILLED`, `ORDER_WORKING`,
    `ORDERS`, `orderForId`), catalogued in `e2e/fixtures/INVENTORY.md:25` — numeric `status:` literals
    documented inline (`status: 1 // NEW`) — a new `UNKNOWN`-state fixture follows this pattern.
  - Mock backend: `e2e/mock-backend.ts:150-159` (`listOrders`, `getOrder`).

## Patterns to REUSE

- Deterministic idempotency-key request field → the proto field already exists
  (`PlaceOrderRequest.client_order_id=10`) but is unused for dedup; this feature is the platform's
  *first* client-side idempotency key end-to-end (confirmed by product-spec's own resolved Open
  Question) — no existing generator to interoperate with.
- Tri-state uncertainty enum shape → reuse `CredentialStatus`'s naming precedent (`UNSPECIFIED/OK/
  INVALID/UNKNOWN`, `trading.proto:160-165`) for the new `ORDER_STATUS_UNKNOWN` semantics, though the
  new value lands on the existing `OrderStatus` enum per product-spec (`trading.proto:70-79`), not a
  separate enum.
- New `order_intents` table shape → follow the `broker_accounts`/`credential_status` migration idiom
  (`migrations/002_broker_accounts.up.sql`, `004_broker_accounts_credential_status.up.sql`: additive
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `SMALLINT NOT NULL DEFAULT 0` mapped to a proto enum,
  inline comment documenting the enum-value mapping) for column conventions, even though this is a new
  table, not an added column.
- Ledger audit on intent-state transitions (if the design wants one) → reuse `emitLedgerEvent`'s exact
  call shape (`trading.go:1426-1439`), fire-and-forget via `go s.emitLedgerEvent(...)`.
- Config-driven retry-block duration (if needed) → `s.cfgW.GetInt("trading.order_intent.<key>", default)`
  following the existing `trading.<category>.<key>` idiom.
- UI status→badge exhaustive map → reuse `opportunityShared.tsx`'s `Record<Enum, EnumRender>` pattern
  (`:43-48`) instead of extending the current non-exhaustive `STATUS_VARIANT: Record<string, ...>`.
- UI order fixtures → extend `e2e/fixtures/orders.ts` + `INVENTORY.md`, coordinating with feature 096
  (see Risks) rather than duplicating a parallel fixture set.

## Dependencies

- Proto/RPC: `Order` message next field number **21** (`trading.proto:32-53`); `OrderStatus` enum next
  value **8** (`trading.proto:70-79`) for the new `UNKNOWN` state (exact field/shape at `/sdd-spec` per
  product-spec). No new RPCs.
- Migration: **contested next number** — see Risks below; `services/xstockstrat-trading/migrations/`
  highest on disk is `004_broker_accounts_credential_status`.
- Config keys: none required by product-spec; a `trading.order_intent.*` retry-block-duration key is
  optional, flagged for `/sdd-design`/`/sdd-spec`.
- Inter-service edges: none new — this is entirely internal to `xstockstrat-trading`'s own request
  handling; `xstockstrat-ui` only gains a display-state change, no new call.

## Risks / Not-found

- **Confirmed migration-number collision with feature 030.** `030-stop-loss-bracket-orders`'s already
  `design-approved` `design.md` (`docs/roadmap/features/030-stop-loss-bracket-orders/design.md:56,162`)
  explicitly claims `005_broker_accounts_halted` for this exact service (`xstockstrat-trading`), and
  neither feature has been implemented yet — no `005_*` file exists on disk. This feature (101) must
  either coordinate to take `006` (assuming 030 lands its `005` first) or the two features' `/sdd-spec`
  passes must check `docs/roadmap/features/merge-order.md` / each other's current migration claim
  immediately before locking in a number. This is the exact class of trap already twice-logged in
  `fails.md` (`durable-observable-backfills — migration`: "always `ls migrations/` before writing a
  migration number into any spec"; `fundamentals-signal-producer — migration`: "reserve/announce
  next-free shared migration numbers at design time").
- **IBKR has no client-order-id-based broker-side dedup at all** (confirmed: `ibkr.go:116-169` sends no
  such field) — the platform-side `order_intents` table is not a belt-and-suspenders addition for IBKR,
  it is the *only* dedup mechanism for that broker. A design that treats the intent table as merely
  "extra insurance" on top of broker-side dedup would be wrong for IBKR specifically.
  Alpaca/IBKR client-order-id length/charset constraints are **not documented anywhere in this repo**
  (`## Not found` from the trading-service digest) — must be sourced from each broker's public API docs
  at `/sdd-design` or `/sdd-spec` time, not invented.
- **No insert-or-return-existing (`ON CONFLICT ... DO NOTHING RETURNING` / advisory-lock) pattern exists
  anywhere in this service.** The only `ON CONFLICT` today is `UpsertOrder`'s clobber-style upsert
  (`trading_repo.go:61-68`) — FR-2's "repeating the same intent returns the existing result" needs a
  genuinely new persistence idiom for this codebase, not a reuse of `UpsertOrder`'s shape.
  **No `ErrNotFound`-style sentinel exists in this service's repo layer** (uses `nil,nil` + caller
  nil-check) — a new intent-lookup function should follow that existing idiom rather than introducing a
  sentinel-error convention this service doesn't otherwise use, unless `/sdd-design` explicitly decides
  to introduce one (as feature 100 just did in `xstockstrat-portfolio` with `ErrPositionNotFound`,
  a sibling but different service).
- **`CancelOrder`'s existing deliberate fail-open-on-broker-error behavior** (mark canceled locally
  regardless of broker response, `trading.go:404-413`) predates this feature and is a distinct decision
  from what FR-1..FR-6 ask for — `/sdd-design` must decide whether `CancelOrder` also gets an intent
  record (for restart-survival / duplicate-delivery correctness per FR-6) without altering its existing
  fail-open cancellation semantics, which is a different axis than the PlaceOrder/ReplaceOrder timeout
  ambiguity this feature is centered on.
- **UI overlap with in-flight feature 096** (`096-position-and-order-detail-pages`, confirmed via
  `e2e/fixtures/orders.ts:2-4`'s own comment: "Centralized (feature 096) because a second consumer
  appeared") — 101 touching `orderShared.tsx`/`orders.ts`/`mock-backend.ts` should check 096's current
  `context.md`/`implementation-spec.md` step status before editing, to avoid a merge conflict on the
  same files (already flagged as an advisory warning in 101's product-spec review, now confirmed as a
  real shared-file overlap by recon, not just a name-level flag).
  Also: `OrderStatusBadge`'s existing fallback logic (`OrderStatus[status] ?? 'UNKNOWN'`, `orderShared.tsx:46`)
  already produces the *string* `'UNKNOWN'` as a fallback label for an unrecognized numeric enum value —
  this is a pre-existing TS-reverse-mapping artifact, not the new proto `ORDER_STATUS_UNKNOWN` value, and
  the two must not be conflated in the UI fix or the real uncertainty state will be masked by the
  pre-existing fallback path.
- **Dead-but-visible retry config**: `trading.order.max_retries`/`retry_delay_ms` are read by nobody
  today (confirmed dead per `services/xstockstrat-trading/docs/context-constitution-findings.md:11`) —
  `/sdd-design` should not assume these keys already gate anything; any real retry-blocking behavior
  this feature introduces needs its own explicit check, not an assumption that the dead keys already do it.
- fails.md **2026-08-06** (`fix-mcp-config-key-registry — assumption`): TS servicer code reading a proto
  field by its snake_case proto name instead of ts-proto's camelCase silently no-ops — relevant if the
  UI-side `UNKNOWN` fix reads any new proto field directly rather than through the generated typed client
  (which `useOrders.ts` already uses correctly).
- insights.md **2026-08-06** (`030-stop-loss-bracket-orders — design`): when reusing an existing
  persistence pattern for new safety-critical/correctness-critical state, verify the precedent's actual
  concurrency mechanics, not just its surface shape — directly relevant since this feature's core new
  mechanism (insert-or-return-existing under concurrent duplicate requests) has no precedent to copy
  from in this service at all, so the mechanics must be designed from scratch and grilled hard, not
  borrowed loosely from `UpsertOrder`.

## Recommended Scope

Advisory only — not binding.

1. `xstockstrat-trading`: resolve the migration-number collision with 030 first (coordinate or defer to
   whichever lands first); new `order_intents` table (intent id, client order id, request hash, state,
   broker account/environment, first/latest broker response, uncertainty flag) with a genuinely new
   insert-or-return-existing persistence idiom (no precedent to reuse) — this is the design's hardest,
   most-scrutinized piece.
2. `xstockstrat-trading`: add `ORDER_STATUS_UNKNOWN = 8` (or a dedicated intent-state field, per
   `/sdd-design`'s decision on whether this rides the existing `OrderStatus` enum or a new orthogonal
   field) to `trading.proto`; wire `PlaceOrder`/`ReplaceOrder` to check-then-insert the intent before
   calling the broker, and to record `UNKNOWN` (not `REJECTED`) on a broker-call error/timeout.
3. `xstockstrat-trading`: decide `CancelOrder`'s relationship to the intent model given its existing
   deliberate fail-open cancellation semantics — likely: intent-tracked for restart-survival, but do not
   alter the existing "cancel locally regardless of broker response" decision.
4. `xstockstrat-trading`: derive the broker client-order-id deterministically from the platform intent
   ID, respecting Alpaca's and IBKR's (externally-sourced) length/charset limits; wire it into both
   broker clients — for IBKR this is new plumbing, not an extension of existing support.
5. `xstockstrat-ui`: convert `STATUS_VARIANT`/`OrderStatusBadge` to the exhaustive `Record<Enum,
   EnumRender>` pattern (`opportunityShared.tsx` precedent) so a future enum addition fails `tsc` instead
   of silently falling through; add the real `UNKNOWN` display state without conflating it with the
   pre-existing TS-reverse-mapping `'UNKNOWN'` fallback string. Coordinate with feature 096's in-flight
   state on shared fixture/mock-backend files.
6. Tests per C-08/C-13 pairing at each service step; extend `e2e/fixtures/orders.ts` +
   `INVENTORY.md` for the new state.
