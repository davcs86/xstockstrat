# Design: order-time-in-force-enum

**Created**: 2026-09-24
**Rounds**: 5 (full; termination: approved at cap)
**Approved by**: user @ 2026-09-24
**Grounded in**: recon.md

---

## Chosen Approach

**In-place string-to-enum conversion** of `time_in_force` across three proto messages, the trading
service, and the UI. This is a wire-breaking change (string wire type 2 → varint wire type 0 on the
same field numbers) requiring the 2-owner + platform-lead approval gate.

### Proto + Codegen

New `TimeInForce` enum in `packages/proto/trading/v1/trading.proto` (after `OrderStatus`, mirroring
`OrderType` at `:81-88`):
- `TIME_IN_FORCE_UNSPECIFIED = 0` (C-04 sentinel — always rejected server-side per user constraint)
- `TIME_IN_FORCE_DAY = 1`
- `TIME_IN_FORCE_GTC = 2`
- `TIME_IN_FORCE_IOC = 3`
- `TIME_IN_FORCE_FOK = 4`
- `TIME_IN_FORCE_OPG = 5`
- `TIME_IN_FORCE_CLS = 6`

Field conversions (all in-place, wire-breaking):
- `Order.time_in_force = 12` (`trading.proto:58`) — `string` → `TimeInForce`
- `PlaceOrderRequest.time_in_force = 7` (`trading.proto:108`) — `string` → `TimeInForce`
- `ReplaceOrderRequest.time_in_force = 5` (`trading.proto:188`) — `string` → `optional TimeInForce`
  (proto3 explicit presence: Go delivers `*TimeInForce`, protobuf-es delivers `TimeInForce | undefined`)

Run `./scripts/buf-gen.sh`. Mandated post-codegen verification: confirm Go `*tradingv1.TimeInForce`
for the optional field, protobuf-es presence tracking, and `buf breaking --exclude-path
trading/v1/trading.proto` CI workaround (removed after merge).

### Trading Service (Go)

**(a) `internal/service/tif_validation.go`** (new file):
- `tifToWireString(TimeInForce) string` — DAY→"day", GTC→"gtc", IOC→"ioc", FOK→"fok", OPG→"opg",
  CLS→"cls", UNSPECIFIED→"day" (defense-in-depth belt, unreachable after validation). Mirrors
  `orderTypeToIBKR` switch at `ibkr.go:68-79` (`recon.md:63`).
- `allowedTIFs map[BrokerType]map[TimeInForce]bool` — Alpaca: all 6 values. IBKR: DAY/GTC/IOC/FOK
  (OPG/CLS are Alpaca-specific equity TIFs). OFFLINE: all 6. Hardcoded constants, not config-driven
  (the set is deployment-time-fixed per proto governance).
- `validateTIF(tif TimeInForce, broker BrokerType) error` — returns `InvalidArgument` for
  UNSPECIFIED or unsupported variant. Called in **both** `PlaceOrder` (before broker dispatch) and
  `ReplaceOrder` (when `req.TimeInForce != nil`).

**(b) `internal/repository/tif.go`** (new file):
- `tifStr(TimeInForce) string` and `parseTif(string) TimeInForce` mirroring `typeStr()`/`parseType()`
  at `trading_repo.go:378-391,442-455` (`recon.md:64`). Unknown/empty legacy strings → UNSPECIFIED
  per FR-4 read-back. `tifStr(UNSPECIFIED)` returns `"day"` (defensive, never reached on write).

**(c) `trading_repo.go` changes**:
- `UpsertOrder` (`:84`) — `o.TimeInForce` → `tifStr(o.TimeInForce)`
- `scanOrder` (`:342`) — raw string → `parseTif(timeInForce)`

**(d) `trading.go` handler changes**:
- `buildBrokerRequest` (`:3367-3370`) — remove dead `if tif == "" { tif = "day" }` fallback; use
  `tifToWireString(req.TimeInForce)` for `broker.OrderRequest.TimeInForce`.
- `PlaceOrder` — add `validateTIF(req.TimeInForce, brokerType)` before broker dispatch.
- `ReplaceOrder` (`:1340-1374`) — nil-guard with validation: `if req.TimeInForce != nil {
  if err := validateTIF(*req.TimeInForce, brokerType); err != nil { return nil, err };
  tifWire = tifToWireString(*req.TimeInForce) } else { tifWire = "" }`.
  Both Alpaca (`:253`) and IBKR (`:271`) treat empty string as "leave unchanged".
  Persist path (`:1372-1373`): `if req.TimeInForce != ""` → `if req.TimeInForce != nil`.
- Hardcoded `"day"` sites:
  - `:2594` (flattenAndHalt `PlaceOrderRequest`) → `tradingv1.TimeInForce_TIME_IN_FORCE_DAY`
    (enum value, not `tifToWireString` — this field is now type `TimeInForce`)
  - `:3182,3224` (BracketLegsRequest, stays `string`) → `tifToWireString(tradingv1.TimeInForce_TIME_IN_FORCE_DAY)`

**(e) `broker.go`** — `OrderRequest.TimeInForce` and `BracketLegsRequest.TimeInForce` at `:85,109`
stay `string`. The enum-to-wire boundary is `tifToWireString()` in the service layer, keeping
adapters string-native.

**(f) Order intent hash — deploy note (no code change)**:
`placeOrderRequestHash` at `order_intent.go:33-40` and `deriveReplaceCancelIntentID` at
`trading.go:1300` use `proto.Marshal` → SHA-256. The wire-type change invalidates pre-deployment
hashes, causing transient `FailedPrecondition` rejections during the deploy window (~30s, bounded by
`trading.order_intent.stale_multiplier` × broker timeout). The sweeper's existing staleness expiry
handles this. Optional post-deploy cleanup: `DELETE FROM trading.order_intents WHERE state IN
('PENDING','UNKNOWN') AND created_at < <deploy-timestamp>`.

### Migration 010

`services/xstockstrat-trading/migrations/010_normalize_tif.up.sql`: normalize historical TIF
strings to lowercase canonical forms, map known aliases (`good_till_cancel`→`gtc`), backfill
NULL/empty→`'day'`. Column stays TEXT — no CHECK constraint (the Go layer owns validation, same
pattern as `order_type`). Down migration is no-op.

### UI

**(a) `orderShared.tsx`** — add `TIF_LABEL: Record<TimeInForce, string>` (exhaustive, following
`Record<Enum, EnumRender>` pattern at `opportunityShared.tsx:28-70`, `recon.md:65`):
UNSPECIFIED→'—', DAY→'Day', GTC→'GTC', IOC→'IOC', FOK→'FOK', OPG→'OPG', CLS→'CLS'. Order detail
page (`:170`) renders via `TIF_LABEL[order.timeInForce]`.

**(b) `OrderForm.tsx`** — add TIF `<Select>` (reusing `Select`/`SelectItem` from `OrderFilters.tsx:
24-42`, `recon.md:66`) defaulting to `TIME_IN_FORCE_DAY`. `TIF_OPTIONS` excludes UNSPECIFIED. The
`placeOrder` call (`:94-119`) includes `timeInForce: selectedTif`.

**(c) `EditOrderDialog.tsx`** — replace free-text `<Input>` (`:105-111`) with a `<Select>` pre-
populated from the order's current `timeInForce`. All options are concrete TIF values (DAY, GTC,
etc.) — no "leave unchanged" option and no UNSPECIFIED. The dialog always sends a concrete TIF
value per user constraint. The mutation sets `timeInForce: TIF_ENUM[selected]`.

**(d) E2E fixtures** — `orders.ts:28,47,71`: string `'day'`/`'gtc'` → numeric enum values (`1`/`2`),
matching protobuf-es numeric enum convention. All E2E spec assertions updated.

**(e) Test fixture breakage note** — all existing `PlaceOrderRequest` test fixtures that omit TIF
(including `order_intent_test.go:39-41`) must add explicit `TimeInForce: TIME_IN_FORCE_DAY`, since
the default enum zero-value (UNSPECIFIED) is now rejected. This is the intended consequence of the
validation tightening.

### Consumer Surface (C-14)

`/trader` segment: OrderForm (place), EditOrderDialog (replace), order detail page (display), order
list (display). No agent tool places orders (confirmed). `strat-lab` plugin has no TIF reference
(confirmed).

### Change-Site Inventory

- `packages/proto/trading/v1/trading.proto:58,108,188` — field type changes
- `services/xstockstrat-trading/internal/service/trading.go:408,1300,1340-1374,2594,3182,3224,3367-3370`
- `services/xstockstrat-trading/internal/service/order_intent.go:33-40,44-51` — hash sites (deploy note)
- `services/xstockstrat-trading/internal/repository/trading_repo.go:84,342`
- `services/xstockstrat-trading/internal/broker/broker.go:85,109` — stays string (no change)
- `services/xstockstrat-trading/internal/broker/alpaca.go:109,125,253-254`
- `services/xstockstrat-trading/internal/broker/ibkr.go:130,189,196,271-272`
- `services/xstockstrat-trading/internal/testdata/order_rows.go:13,25` — fixture, no change needed
- `services/xstockstrat-trading/internal/service/order_intent_test.go:39-41` — must add explicit TIF
- `services/xstockstrat-ui/src/components/trader/OrderForm.tsx:17,22-32,94-119`
- `services/xstockstrat-ui/src/components/trader/EditOrderDialog.tsx:25,41,105-111`
- `services/xstockstrat-ui/src/components/trader/orderShared.tsx:7,20`
- `services/xstockstrat-ui/src/app/trader/orders/[id]/page.tsx:170`
- `services/xstockstrat-ui/e2e/fixtures/orders.ts:28,47,71`

## Rejected Alternatives

- **Additive field strategy** (new enum field + deprecate string) — rejected: user constraint "no old
  callers to care about" makes the simpler in-place path appropriate; additive adds dual-write/read
  complexity for no benefit.
- **UNSPECIFIED→DAY fallback** — rejected: user constraint "Remove unspecified"; implicit defaults
  hide misconfigured callers. The tighter contract is the point of this feature.
- **Config-driven TIF support matrix** — rejected: the TIF set is deployment-time-fixed and changes
  only with a new broker version; hardcoded constants match the `orderTypeToIBKR` pattern and avoid
  config indirection.
- **`optional TimeInForce` on PlaceOrderRequest** (with absence = DAY) — rejected: re-introduces
  implicit default; a new order should always specify TIF explicitly.
- **EditOrderDialog "leave unchanged" mapping to `undefined`** — rejected: user constraint "it must
  have a value, not undefined"; the dialog pre-fills from the order's current TIF and always sends a
  concrete value.
- **CHECK constraint on DB column** — rejected: the Go layer owns validation; a CHECK is a second
  source of truth that breaks on enum growth. Matches `order_type` pattern (no CHECK).
- **Sequential `await` on DB normalize** — not applicable (Go service, single migration).

## Open Risks

- [ ] **IBKR TIF support matrix assumption** — IBKR supports DAY/GTC/IOC/FOK for equities is based
  on Client Portal Web API documentation. If wrong, the `allowedTIFs` map is the sole fix point.
  Verify during implementation.
- [ ] **Order intent hash deploy window** — ~30s transient `FailedPrecondition` during rolling
  deploy. Bounded by sweeper staleness. Optional cleanup query post-deploy. Deploy outside active
  trading hours if possible.
- [ ] **Go protobuf v2 JSONB deserialization** — `latest_response` JSONB stored pre-deploy contains
  string wire-type for field 12. Go protobuf v2 treats this as an unknown field (not decode error),
  reading the enum as 0 (UNSPECIFIED). Per FR-4 read-back. Verify in unit test.

## Constitution Rules Touched

- `C-01` — honored by: every path:line claim verified across 5 rounds; change-site inventory
  includes testdata fixtures and intent-hash sites.
- `C-04` — honored by: `TIME_IN_FORCE_UNSPECIFIED = 0` sentinel exists; rejected at handler per
  user constraint.
- `C-10` — honored by: `TIF_LABEL` exhaustive `Record<TimeInForce, string>` includes UNSPECIFIED
  entry; `pnpm build` verification mandated (F-C-10 trap).
- `C-14` — honored by: `/trader` consumer surface documented; OrderForm, EditOrderDialog, order
  detail, and order list all updated in the same PR.
- `C-16` — honored by: all 8 PRESERVE business rules from recon.md respected; TIF threads through
  existing PlaceOrder/ReplaceOrder flows without altering them.
- `F-04` — honored by: all citations verified against live codebase across 5 rounds.
- `F-11` — honored by: no Floor breaches across 5 rounds.

## Business Rules Touched (C-16)

- PRESERVE `@AC-1 @feature-052` "A market order is placed via Alpaca" — not regressed by: TIF
  validation runs alongside existing order-type dispatch; PlaceOrder flow unchanged.
- PRESERVE `@AC-2 @feature-052` "A limit order is placed via IBKR" — not regressed by: same;
  IBKR adapter uppercasing unchanged at `ibkr.go:130`.
- PRESERVE `@AC-3 @feature-052` "PlaceOrder rejects when trading state is DISABLED" — not
  regressed by: TIF validation runs after or alongside trading-state check, never overriding it.
- PRESERVE `@AC-4 @feature-052` "PlaceOrder records to offline ledger when broker is OFFLINE" —
  not regressed by: OFFLINE allows all 6 TIF values.
- PRESERVE `@AC-5 @feature-075` "Confidence-based auto-sizing adjusts quantity" — not regressed
  by: auto-sizing is orthogonal to TIF.
- PRESERVE `@AC-10 @feature-095` "usePlaceOrder mutation submits and invalidates" — not regressed
  by: the mutation hook gains the TIF field but the submit→invalidate cycle is unchanged.
- PRESERVE `@AC-11 @feature-095` "OrderForm validates quantity" — not regressed by: TIF adds a
  new validated field alongside existing quantity validation.
- PRESERVE `@AC-12 @feature-095` "OrderForm shows enrichment fields as read-only" — not regressed
  by: TIF is editable, distinct from read-only enrichment fields.
