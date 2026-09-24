# Implementation Spec: order-time-in-force-enum

**Status**: `pending`
**Created**: 2026-09-24
**Feature**: `docs/roadmap/features/202-order-time-in-force-enum/feature.md`
**Total Steps**: 9
**Feature Branch**: `feature/order-time-in-force-enum`

---

## Execution Summary

The implementation proceeds proto-first, then backend, then frontend — each layer builds on the
previous one's generated code. Step 1 defines the enum and converts the three proto fields in place
(wire-breaking). Step 2 runs codegen. Step 3 normalizes historical DB strings. Steps 4–5 add the
Go-side validation/mapping and their unit tests. Steps 6–7 update the UI components and their E2E
fixtures/assertions. Step 8 is a cross-service build verification. Step 9 adds a deploy-note doc
for the transient order-intent-hash breakage.

This is a wire-breaking change requiring the 2-owner + platform-lead approval gate
(`docs/runbooks/approval-flow.md`; `docs/runbooks/proto-versioning.md`). The CI `buf breaking` job
will flag the in-place type changes; a temporary `--exclude-path trading/v1/trading.proto` workaround
is applied in Step 1 and removed after merge.

## Scenario Coverage

| Scenario | Covered by step(s) |
|---|---|
| `@AC-1` (GTC market order placed, enum mapped to Alpaca wire, persisted/read as enum) | Step 5 |
| `@AC-2` (UNSPECIFIED rejected at edge) | Step 5 |
| `@AC-3` (broker-unsupported TIF rejected before submission) | Step 5 |
| `@AC-4` (legacy unmappable string reads back as UNSPECIFIED) | Step 5 |
| `@AC-5` (trader form sends TIF as Connect-JSON NAME-string, exhaustive label map) | Step 7 |

## Step Dependencies

- Step 2 requires Step 1: codegen runs on the modified `.proto`
- Step 3 requires Step 1: migration references the canonical TIF strings the enum maps to
- Steps 4–5 require Step 2: Go code imports generated `TimeInForce` type
- Steps 6–7 require Step 2: TS code imports generated `TimeInForce` enum
- Step 8 requires Steps 1–7: cross-service build verification

---

### Step 1 — proto: Define TimeInForce enum and convert fields in place

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/trading/v1/trading.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking changes without deprecation, `buf lint` passes; `xstockstrat-trading` owner — order execution correctness, broker API safety; `xstockstrat-ui` owner — Connect-JSON enum NAME-string encoding

**Codebase Evidence**:
- `Order.time_in_force = 12` (string) at `packages/proto/trading/v1/trading.proto:58`
- `PlaceOrderRequest.time_in_force = 7` (string) at `packages/proto/trading/v1/trading.proto:108`
- `ReplaceOrderRequest.time_in_force = 5` (string) at `packages/proto/trading/v1/trading.proto:188`
- Existing `OrderType` enum pattern at `packages/proto/trading/v1/trading.proto:81-88` (to mirror)
- Existing `OrderStatus` enum pattern at `packages/proto/trading/v1/trading.proto:90-99` (to mirror)

**TDD**: N/A (proto, non-code-bearing)

**Covers**: —

**Instructions**:

1. Add a `TimeInForce` enum after the `OrderStatus` enum (after line 99), mirroring the `OrderType`
   naming convention:
   ```protobuf
   enum TimeInForce {
     TIME_IN_FORCE_UNSPECIFIED = 0;
     TIME_IN_FORCE_DAY = 1;
     TIME_IN_FORCE_GTC = 2;
     TIME_IN_FORCE_IOC = 3;
     TIME_IN_FORCE_FOK = 4;
     TIME_IN_FORCE_OPG = 5;
     TIME_IN_FORCE_CLS = 6;
   }
   ```

2. Convert three fields in place (wire-breaking: string wire type 2 → varint wire type 0):
   - `Order.time_in_force = 12`: change `string` to `TimeInForce`
   - `PlaceOrderRequest.time_in_force = 7`: change `string` to `TimeInForce`
   - `ReplaceOrderRequest.time_in_force = 5`: change `string` to `optional TimeInForce`
     (proto3 explicit presence — Go delivers `*tradingv1.TimeInForce`, protobuf-es delivers
     `TimeInForce | undefined`)

**Verification**:
```bash
cd packages/proto && buf lint
# buf breaking will flag the wire-type changes — expected for this intentional in-place conversion.
# The feature branch CI workaround: temporarily exclude the file in .github/workflows/ci.yml
# proto-lint job's buf breaking step. Remove after merge.
```

---

### Step 2 — proto-gen: Regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/trading/v1/` — regenerated
- `packages/proto/gen/python/trading/v1/` — regenerated
- `packages/proto/gen/ts/trading/v1/` — regenerated
- `packages/proto/gen/ts/dist/` — recompiled

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking changes without deprecation, `buf lint` passes; `xstockstrat-trading` owner — order execution correctness, broker API safety; `xstockstrat-ui` owner — Connect-JSON enum NAME-string encoding

**Codebase Evidence**:
- Codegen script: `scripts/buf-gen.sh`
- Generated stubs are committed per `docs/runbooks/proto-versioning.md`

**TDD**: N/A (codegen, non-code-bearing)

**Covers**: —

**Instructions**:

1. Run `./scripts/buf-gen.sh`
2. Verify generated Go type: `*tradingv1.TimeInForce` pointer for `ReplaceOrderRequest.TimeInForce`
   (explicit presence `optional`), non-pointer `tradingv1.TimeInForce` for `Order.TimeInForce` and
   `PlaceOrderRequest.TimeInForce`.
3. Verify protobuf-es (TS) type: `TimeInForce | undefined` for `ReplaceOrderRequest.timeInForce`
   (presence tracking), plain `TimeInForce` for the other two.
4. Verify ts-proto `stringEnums=true` delivers string constants (per `buf.gen.yaml`).

**Verification**:
```bash
./scripts/buf-gen.sh
git diff packages/proto/gen/ | head -100
# Confirm TimeInForce enum appears in generated files
grep -r "TimeInForce" packages/proto/gen/go/trading/v1/ | head -5
grep -r "TimeInForce" packages/proto/gen/ts/trading/v1/ | head -5
```

---

### Step 3 — migration: Normalize historical TIF strings

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/migrations/010_normalize_tif.up.sql` — create
- `services/xstockstrat-trading/migrations/010_normalize_tif.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair present, index correctness; `xstockstrat-trading` owner — order execution correctness

**Codebase Evidence**:
- Last migration file is `009_offline_position_baselines.up.sql` — confirmed next is `010`
- DB column: `time_in_force TEXT` nullable at `services/xstockstrat-trading/migrations/001_orders_hypertable.up.sql:21`
- No CHECK constraint on `time_in_force` (confirmed — matches `order_type` pattern, no CHECK there either)

**TDD**: N/A (migration, non-code-bearing)

**Covers**: —

**Instructions**:

`010_normalize_tif.up.sql`:
```sql
-- Normalize historical time_in_force strings to lowercase canonical forms.
-- Column stays TEXT — the Go layer owns validation (same pattern as order_type).
UPDATE trading.orders SET time_in_force = LOWER(time_in_force)
WHERE time_in_force IS DISTINCT FROM LOWER(time_in_force);

UPDATE trading.orders SET time_in_force = 'gtc'
WHERE time_in_force IN ('good_till_cancel', 'good_til_cancel', 'good_till_cancelled');

UPDATE trading.orders SET time_in_force = 'day'
WHERE time_in_force IS NULL OR time_in_force = '';
```

`010_normalize_tif.down.sql`:
```sql
-- No-op: the normalization is data-cleanup, not schema change.
-- Original mixed-case/alias values are not recoverable.
```

**Verification**:
```bash
ls services/xstockstrat-trading/migrations/010_normalize_tif.up.sql \
   services/xstockstrat-trading/migrations/010_normalize_tif.down.sql
# Read both: confirm .up normalizes strings; .down is a no-op (no inverse needed for data cleanup)
```

---

### Step 4 — service: Add TIF validation and mapping (trading)

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/tif_validation.go` — create
- `services/xstockstrat-trading/internal/repository/tif.go` — create
- `services/xstockstrat-trading/internal/service/trading.go` — modify
- `services/xstockstrat-trading/internal/repository/trading_repo.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, broker API safety, fill detection, paper-only dev invariant

**Codebase Evidence**:
- `buildBrokerRequest` defaults TIF to `"day"` at `services/xstockstrat-trading/internal/service/trading.go:3367-3370`
- PlaceOrder persists `req.TimeInForce` (currently string) at `trading.go:576`
- ReplaceOrder reads/writes `req.TimeInForce` (string) at `trading.go:1347,1372-1373`
- Hardcoded `"day"` in flatten at `trading.go:2594` (flattenAndHalt `PlaceOrderRequest`)
- Hardcoded `"day"` in bracket-legs at `trading.go:3182,3224` (`BracketLegsRequest`, stays `string`)
- `UpsertOrder` passes `o.TimeInForce` directly (string) at `trading_repo.go:84`
- `scanOrder` assigns `TimeInForce: timeInForce` (raw DB string) at `trading_repo.go:342`
- `typeStr()`/`parseType()` pattern at `trading_repo.go:378-391,442-455` — mirror for TIF
- `orderTypeToIBKR()` enum→wire switch pattern at `ibkr.go:68-79` — mirror for TIF
- `BrokerType` enum at `common/v1/common.proto:68-75` (UNSPECIFIED=0, ALPACA=1, IBKR=2, OFFLINE=3)
- `broker.OrderRequest.TimeInForce` stays `string` at `broker.go:85`
- `broker.BracketLegsRequest.TimeInForce` stays `string` at `broker.go:109`
- Alpaca adapter passes `req.TimeInForce` string at `alpaca.go:125` (submit), `alpaca.go:253-254` (replace)
- IBKR adapter uppercases `req.TimeInForce` at `ibkr.go:130` (submit), `ibkr.go:189,196` (bracket legs), `ibkr.go:271-272` (replace)

**TDD**: red-green required

**Covers**: —

**Instructions**:

**(a) Create `internal/service/tif_validation.go`**:

- `tifToWireString(tradingv1.TimeInForce) string` — exhaustive switch:
  `TIME_IN_FORCE_DAY→"day"`, `GTC→"gtc"`, `IOC→"ioc"`, `FOK→"fok"`, `OPG→"opg"`, `CLS→"cls"`,
  `UNSPECIFIED→"day"` (defense-in-depth belt, unreachable after validation). Mirrors the
  `orderTypeToIBKR` switch at `ibkr.go:68-79`.

- `var allowedTIFs = map[commonv1.BrokerType]map[tradingv1.TimeInForce]bool` — per-broker support
  matrix: Alpaca: all 6 (DAY/GTC/IOC/FOK/OPG/CLS). IBKR: DAY/GTC/IOC/FOK. OFFLINE: all 6.
  Hardcoded constants (deployment-time-fixed per proto governance, not config-driven).

- `validateTIF(tif tradingv1.TimeInForce, broker commonv1.BrokerType) error` — returns
  `codes.InvalidArgument` for `TIME_IN_FORCE_UNSPECIFIED` or a variant not in `allowedTIFs[broker]`.
  Error message names the field (`"time_in_force"`) and the offending value.

**(b) Create `internal/repository/tif.go`**:

- `tifStr(tradingv1.TimeInForce) string` — exhaustive switch mirroring `typeStr()` at
  `trading_repo.go:378-391`: `DAY→"day"`, `GTC→"gtc"`, `IOC→"ioc"`, `FOK→"fok"`, `OPG→"opg"`,
  `CLS→"cls"`, default→`"day"` (defensive, never reached on write after validation).

- `parseTif(string) tradingv1.TimeInForce` — mirroring `parseType()` at `trading_repo.go:442-455`:
  `"day"→DAY`, `"gtc"→GTC`, `"ioc"→IOC`, `"fok"→FOK`, `"opg"→OPG`, `"cls"→CLS`,
  default→`UNSPECIFIED` (unknown/empty legacy strings read back as UNSPECIFIED per FR-4).

**(c) `trading_repo.go` changes**:

- `UpsertOrder` (line 84): change `o.TimeInForce` to `tifStr(o.TimeInForce)` — the field is now an
  enum; the DB column stays TEXT.
- `scanOrder` (line 342): change `TimeInForce: timeInForce` to `TimeInForce: parseTif(timeInForce)`
  — raw DB string → enum.

**(d) `trading.go` handler changes**:

- **PlaceOrder** (around line 408, after existing trading-state/halt gates): add
  `if err := validateTIF(req.TimeInForce, commonv1.BrokerType(accountEntry.brokerType)); err != nil { return nil, err }`.
  This runs after the trading-state and halt gates (not before — preserving `@AC-3 @feature-052`).

- **`buildBrokerRequest`** (lines 3367-3370): remove the dead `if tif == "" { tif = "day" }`
  fallback. Replace with `tifToWireString(req.TimeInForce)` for the `broker.OrderRequest.TimeInForce`
  field. The wire string is now derived from the validated enum.

- **ReplaceOrder** (lines 1340-1374): the `req.TimeInForce` field is now `*tradingv1.TimeInForce`
  (optional). Change the broker-request wiring (line 1347) to:
  ```go
  if req.TimeInForce != nil {
      if err := validateTIF(*req.TimeInForce, commonv1.BrokerType(entry.brokerType)); err != nil {
          return nil, err
      }
      brokerReq.TimeInForce = tifToWireString(*req.TimeInForce)
  }
  ```
  Change the persist path (lines 1372-1373) from `if req.TimeInForce != ""` to
  `if req.TimeInForce != nil { order.TimeInForce = *req.TimeInForce }`.

- **Hardcoded `"day"` sites**:
  - `flattenAndHalt` PlaceOrderRequest (line 2594): change `TimeInForce: "day"` to
    `TimeInForce: tradingv1.TimeInForce_TIME_IN_FORCE_DAY` — this field is now the enum type.
  - `maybeSubmitBracket` BracketLegsRequest (line 3182): change `TimeInForce: "day"` to
    `TimeInForce: tifToWireString(tradingv1.TimeInForce_TIME_IN_FORCE_DAY)` — the struct stays `string`.
  - `resizeBracket` BracketLegsRequest (line 3224): same change as line 3182.

**Broker coverage note**: Alpaca adapter at `alpaca.go:125,253-254` and IBKR adapter at
`ibkr.go:130,189,196,271-272` continue to receive `string` values from `broker.OrderRequest` /
`broker.BracketLegsRequest` — no changes needed. The enum-to-wire boundary is
`tifToWireString()` in the service layer, keeping adapters string-native.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./...
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 5 — test: Trading service TIF unit tests

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/tif_validation_test.go` — create
- `services/xstockstrat-trading/internal/repository/tif_test.go` — create
- `services/xstockstrat-trading/internal/service/order_intent_test.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, broker API safety

**Codebase Evidence**:
- Existing `order_intent_test.go:39-41` creates `PlaceOrderRequest` fixtures without `TimeInForce` —
  the zero-value enum (`UNSPECIFIED`) is now the default, which is rejected by validation. Tests must
  add explicit `TimeInForce: tradingv1.TimeInForce_TIME_IN_FORCE_DAY`.
- Test-data inventory (C-13): Go service canonical home is `internal/testdata/`. `order_rows.go:13,25`
  holds testdata but has no TIF fixture — new test literals have exactly one consumer per test file
  (single-consumer → inline is compliant; no centralization needed).
- No second consumer of these literals after this step (compliant with C-13).

**TDD**: red-green required

**Covers**: AC-1, AC-2, AC-3, AC-4

**Instructions**:

**(a) `tif_validation_test.go`** — test cases:

- `TestTifToWireString`: DAY→"day", GTC→"gtc", IOC→"ioc", FOK→"fok", OPG→"opg", CLS→"cls",
  UNSPECIFIED→"day". **(AC-1)**: confirms enum-to-wire mapping.
- `TestValidateTIF_UNSPECIFIED_Rejected`: `validateTIF(UNSPECIFIED, ALPACA)` returns
  `codes.InvalidArgument` naming `"time_in_force"`. **(AC-2)**
- `TestValidateTIF_Valid_Alpaca`: DAY/GTC/IOC/FOK/OPG/CLS all pass for ALPACA. **(AC-1)**
- `TestValidateTIF_Unsupported_IBKR`: OPG and CLS are rejected for IBKR with
  `codes.InvalidArgument` naming the value. **(AC-3)**
- `TestValidateTIF_Valid_IBKR`: DAY/GTC/IOC/FOK all pass for IBKR.
- `TestValidateTIF_Offline`: all 6 pass for OFFLINE.

**(b) `tif_test.go`** — test cases:

- `TestTifStr`: each enum value maps to the canonical lowercase string.
- `TestParseTif_KnownValues`: "day"→DAY, "gtc"→GTC, "ioc"→IOC, "fok"→FOK, "opg"→OPG, "cls"→CLS.
- `TestParseTif_UnknownReturnsUnspecified`: `"good_till_cancel"`, `""`, `"foobar"` all return
  UNSPECIFIED. **(AC-4)**: confirms unmappable legacy strings read back as UNSPECIFIED.

**(c) `order_intent_test.go`** — update existing fixtures:

- Line 39: add `TimeInForce: tradingv1.TimeInForce_TIME_IN_FORCE_DAY` to `req1`.
- Line 40: add `TimeInForce: tradingv1.TimeInForce_TIME_IN_FORCE_DAY` to `req2`.
- Line 41: add `TimeInForce: tradingv1.TimeInForce_TIME_IN_FORCE_DAY` to `req3`.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
# Confirm >= 40%
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 6 — service: UI TIF enum rendering and form integration

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/trader/orderShared.tsx` — modify
- `services/xstockstrat-ui/src/components/trader/OrderForm.tsx` — modify
- `services/xstockstrat-ui/src/components/trader/EditOrderDialog.tsx` — modify
- `services/xstockstrat-ui/src/app/trader/orders/[id]/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, Connect-RPC call safety, Connect-JSON enum NAME-string encoding

**Codebase Evidence**:
- `orderShared.tsx:7,20` — existing `STATUS_VARIANT` (string-keyed Record) and `TYPE_LABEL` (string-keyed Record); add `TIF_LABEL` as exhaustive `Record<TimeInForce, string>` (F-C-10 trap — must include all values including UNSPECIFIED)
- `OrderForm.tsx:22-32` — existing `ORDER_TYPE_LABEL` / `ORDER_TYPE_ENUM` exhaustive Records; mirror for `TIF_LABEL` / `TIF_ENUM`
- `OrderForm.tsx:94-119` — `placeOrder` call does NOT send `timeInForce` today; must add it
- `EditOrderDialog.tsx:25` — `timeInForce` state as string; `EditOrderDialog.tsx:41` — sends `timeInForce: timeInForce.trim()`; `EditOrderDialog.tsx:106-111` — free-text `<Input>` for TIF
- Order detail page at `services/xstockstrat-ui/src/app/trader/orders/[id]/page.tsx:170` — raw string display `order.timeInForce || '—'`
- `opportunityShared.tsx:28-70` — canonical `Record<Enum, EnumRender>` + `EnumBadge` pattern to reuse
- `usePlaceOrder.ts:5` — `PlaceOrderInput` is typed from the generated client; adding `timeInForce` to the call is type-safe
- `useReplaceOrder.ts:5` — `ReplaceOrderInput` — same; `timeInForce` becomes `TimeInForce | undefined`
- Transport at `transport.ts:57` and `connectClients.ts:26-28` — no custom enum serialization config; default `@connectrpc/connect` sends enums as NAME-strings over Connect-JSON (correct per fails.md:677-679)

**TDD**: red-green required

**Covers**: —

**Instructions**:

**(a) `orderShared.tsx`** — add import for `TimeInForce` from `@xstockstrat/proto/trading/v1/trading_pb`,
then add an exhaustive `TIF_LABEL: Record<TimeInForce, string>` (C-10 / F-C-10):
```typescript
export const TIF_LABEL: Record<TimeInForce, string> = {
  [TimeInForce.UNSPECIFIED]: '—',
  [TimeInForce.DAY]: 'Day',
  [TimeInForce.GTC]: 'GTC',
  [TimeInForce.IOC]: 'IOC',
  [TimeInForce.FOK]: 'FOK',
  [TimeInForce.OPG]: 'OPG',
  [TimeInForce.CLS]: 'CLS',
};
```

**(b) `OrderForm.tsx`** — add import for `TimeInForce as PbTimeInForce` from the proto package.

Add TIF type, label, and enum maps (mirroring `ORDER_TYPE_LABEL` / `ORDER_TYPE_ENUM` at lines 24-38):
```typescript
type TifOption = 'day' | 'gtc' | 'ioc' | 'fok' | 'opg' | 'cls';
const TIF_LABEL: Record<TifOption, string> = {
  day: 'Day', gtc: 'GTC', ioc: 'IOC', fok: 'FOK', opg: 'OPG', cls: 'CLS',
};
const TIF_ENUM: Record<TifOption, PbTimeInForce> = {
  day: PbTimeInForce.DAY, gtc: PbTimeInForce.GTC, ioc: PbTimeInForce.IOC,
  fok: PbTimeInForce.FOK, opg: PbTimeInForce.OPG, cls: PbTimeInForce.CLS,
};
```

Add state: `const [tif, setTif] = useState<TifOption>('day');`

Add a `<Select>` dropdown for TIF in the form body (reusing the `Select`/`SelectItem` components
already imported at line 17, same pattern as the order-type select), defaulting to `'day'`.

In the `placeOrder` call (lines 94-119), add `timeInForce: TIF_ENUM[tif]`.

**(c) `EditOrderDialog.tsx`** — replace the free-text `<Input>` for TIF (lines 105-111) with a
`<Select>` dropdown. Import `TimeInForce as PbTimeInForce` from the proto package, and
`Select, SelectContent, SelectItem, SelectTrigger, SelectValue` from `../ui/select`.

Pre-populate from `order.timeInForce` (now an enum). All options are concrete TIF values
(DAY/GTC/IOC/FOK/OPG/CLS) — no UNSPECIFIED. The state type changes from `string` to
`PbTimeInForce | ''`. On submit, the mutation sends `timeInForce: selectedTif || undefined` (where
`undefined` means "leave unchanged" per the `optional` proto3 semantics).

Per user constraint (design.md): the dialog always sends a concrete TIF value. Pre-fill from
`order.timeInForce`; if that is UNSPECIFIED (legacy), pre-fill with DAY.

**(d) Order detail page** (`page.tsx:170`): change `order.timeInForce || '—'` to use the shared
`TIF_LABEL` from `orderShared.tsx`:
```typescript
import { TIF_LABEL } from '@/components/trader/orderShared';
// ...
<Field label="Time in force" value={TIF_LABEL[order.timeInForce] ?? '—'} />
```

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm build
# Must succeed — F-C-10: exhaustive Record<TimeInForce, string> passes tsc
cd services/xstockstrat-ui && pnpm run lint
```

---

### Step 7 — test: UI E2E fixture and spec updates

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/fixtures/orders.ts` — modify
- `services/xstockstrat-ui/e2e/trader/orders.spec.ts` — modify
- `services/xstockstrat-ui/e2e/trader/order-parity.spec.ts` — modify
- `services/xstockstrat-ui/e2e/trader/offline-accounts.spec.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify (catalog note for TIF field change)
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (placeOrder mock must return concrete TIF)

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness

**Codebase Evidence**:
- `orders.ts:28` — `timeInForce: 'day'` (string); `orders.ts:47` — `timeInForce: 'gtc'`; `orders.ts:71` — `timeInForce: 'day'`
- `orders.spec.ts:27,42,57,72` — inline `timeInForce: 'day'` strings in mock responses
- `order-parity.spec.ts:29,44,59,74,89` — inline `timeInForce: 'day'` strings
- `offline-accounts.spec.ts:35` — inline `timeInForce: 'day'`
- Per C-12: fixture `orders.ts` is the canonical home for order test data; inline overrides in spec files
  reference it or use `{ ...FIXTURE, override }` spreads. The `timeInForce` field change applies
  to the fixtures first, then spec files that override it.

**TDD**: red-green required

**Covers**: AC-5

**Instructions**:

**(a) `orders.ts`** — update the three fixture objects:
- `ORDER_FILLED` (line 28): change `timeInForce: 'day'` to `timeInForce: 1` (numeric enum value
  for `TIME_IN_FORCE_DAY`, matching protobuf-es numeric enum convention for mock gRPC responses)
- `ORDER_WORKING` (line 47): change `timeInForce: 'gtc'` to `timeInForce: 2`
  (`TIME_IN_FORCE_GTC`)
- `ORDER_UNKNOWN_INTENT` (line 71): change `timeInForce: 'day'` to `timeInForce: 1`

**(b) Spec files** — update all inline `timeInForce: 'day'` occurrences to `timeInForce: 1` in:
- `orders.spec.ts:27,42,57,72`
- `order-parity.spec.ts:29,44,59,74,89`
- `offline-accounts.spec.ts:35`

**(c) E2E assertion for AC-5**: in the appropriate order-form spec (or a new test block in
`orders.spec.ts`), verify the PlaceOrder request includes `timeInForce` as a NAME-string
(`"TIME_IN_FORCE_GTC"` or similar) over the Connect-JSON wire, and that the TIF `<Select>`
dropdown renders with the correct default and options.

**(d) `INVENTORY.md`** — add a catalog note in the `orders.ts` entry that `timeInForce` changed
from string to numeric enum.

**(e) `mock-backend.ts`** — in the `placeOrder` mock response handler (~line 244–252), add
`timeInForce: 1` (TIME_IN_FORCE_DAY) to the returned order object. After the enum change, omitting
this field defaults to `0` (UNSPECIFIED), which breaks TIF-specific E2E assertions (design.md R6
advisory #3).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm build
cd services/xstockstrat-ui && pnpm test:e2e
# Or: ../../scripts/run-e2e.sh (hermetic Docker run)
```

---

### Step 8 — docs: Cross-service build verification and deploy note

**Status**: `pending`
**Service**: `docs/runbooks/`
**Files**:
- (no new files — this is a verification-only step)

**Reviewers**: none

**Codebase Evidence**:
- `order_intent.go:33-40` — `placeOrderRequestHash` uses `proto.Marshal` → SHA-256; the wire-type
  change invalidates pre-deployment hashes
- `trading.go:1300` — `deriveReplaceCancelIntentID` same pattern
- `trading.order_intent.stale_multiplier` × broker timeout bounds the transient
  `FailedPrecondition` window (~30s)

**TDD**: N/A (docs, non-code-bearing)

**Covers**: —

**Instructions**:

Verify the complete build chain end to end:
1. Proto: `cd packages/proto && buf lint`
2. Go: `cd services/xstockstrat-trading && GOWORK=off go build ./...`
3. TS/UI: `cd services/xstockstrat-ui && pnpm build`

Document the deploy note from `design.md § (f)`:
- The wire-type change invalidates pre-deployment order-intent hashes, causing transient
  `FailedPrecondition` rejections during the deploy window (~30s, bounded by
  `trading.order_intent.stale_multiplier` × broker timeout).
- The sweeper's existing staleness expiry handles this.
- Optional post-deploy cleanup: `DELETE FROM trading.order_intents WHERE state IN ('PENDING','UNKNOWN') AND created_at < <deploy-timestamp>`.
- Deploy outside active trading hours if possible.

Record this deploy note in the feature's `context.md` (sdd-execute's normal context.md append
handles this — Step 9 is the CI buf-breaking workaround, not the deploy note recording step).

**Verification**:
```bash
cd packages/proto && buf lint
cd services/xstockstrat-trading && GOWORK=off go build ./...
cd services/xstockstrat-ui && pnpm build
```

---

### Step 9 — docs: Feature-branch CI workaround for buf breaking

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `.github/workflows/ci.yml` — modify (temporary)

**Reviewers**: none

**Codebase Evidence**:
- `buf breaking` runs against the feature branch in the `proto-lint` / `proto-freshness` CI jobs
- The in-place type change (string → enum on field 12/7/5) will fail `buf breaking`
- Proto versioning runbook (`docs/runbooks/proto-versioning.md`) documents this as expected for
  intentional breaking changes

**TDD**: N/A (CI config, non-code-bearing)

**Covers**: —

**Instructions**:

Add a temporary `--exclude-path trading/v1/trading.proto` flag to the `buf breaking` step in the
CI workflow's `proto-lint` job. This allows the intentional wire-breaking change to pass CI.

Mark with a `# TEMPORARY: feature/order-time-in-force-enum — remove after merge` comment.
This workaround is removed in the integration PR that merges the feature branch into `main-dev`.

**Verification**:
```bash
grep -n "exclude-path.*trading" .github/workflows/ci.yml
# Confirm the temporary flag is present with the removal comment
```

---

## Deviation Log

### Step 2 — codegen toolchain: host-native fallback (Docker Hub rate-limited)
- **What**: `scripts/localenv-setup.sh`'s Docker path failed — Docker Hub returned `429 Too Many
  Requests` pulling the `golang:1.27-trixie` base image of `Dockerfile.codegen` (shared-egress
  anonymous pull limit). Fell back to the host-native codegen toolchain per
  `docs/runbooks/codegen-toolchain-host-setup.md`, installed pinned to `Dockerfile.codegen`:
  buf 1.72.0, protoc-gen-go v1.36.11, protoc-gen-go-grpc v1.6.2, protoc-gen-connect-go v1.19.2,
  ts-proto 2.11.8, protoc-gen-es 2.12.0, protoc-gen-connect-es 1.7.0, grpcio-tools 1.80.0.
- **Disposition**: CI-equivalent fallback (sequential-mode sanctioned). Same pinned versions CI's
  `proto-freshness` job installs (`.github/workflows/ci.yml`).

### Step 2 — local `buf breaking` skipped for the intentional wire-break
- **What**: `buf-gen.sh` runs `buf breaking` against the local `main-dev` ref, which fails on the
  intentional string→enum wire-type change (fields 12/7/5). Ran codegen with a non-existent
  `AGAINST_BRANCH=__skip_breaking__` so the guard's `git show-ref` fails and the breaking check is
  skipped locally.
- **Disposition**: Expected for this intentional wire-breaking change — the local analog of Step 9's
  CI `--exclude-path trading/v1/trading.proto` workaround. `buf lint` still runs and passes.

### Step 2 — reverted pre-existing gofmt comment-whitespace drift in `analysis.pb.go`
- **What**: Regenerating all stubs also reformatted `packages/proto/gen/go/analysis/v1/analysis.pb.go`
  (14 lines, comment continuation-line indentation tabs↔spaces) — the host `protoc-gen-go`/gofmt
  renders it as tabs where the committed CI-generated stub uses spaces. Unrelated to feature 202
  (`analysis.proto` unchanged); reverted so the working tree stays scoped to `trading/v1`.
  `trading.pb.go` itself shows **no** such whitespace churn (verified: only the 2 new real
  `TimeInForce` comment lines), so the committed trading stubs match what CI regenerates.
- **Disposition**: Out-of-scope drift reverted; feature diff limited to `trading/v1` (mirrors CI's
  stale-stub check). Latent host-vs-CI toolchain-parity gotcha — recurs for 203/204/205 codegen.

### Step 5 — golangci-lint version bump (host tool too old for go1.27)
- **What**: The pre-installed `golangci-lint` (v2.5.0, built with go1.25) refuses a go1.27 target.
  Installed v2.13.1 (CLAUDE.md pin) built with the host go1.27.0 (`GOTOOLCHAIN=go1.27.0`, since a
  `toolchain` directive otherwise pulled go1.26.8). Result: `0 issues`.
- **Disposition**: Tooling provisioning, no code impact. CI uses `golangci-lint-action@v9`.

### Step 7 — `order-form.spec.ts` edited though not in the Files list
- **What**: The new TIF `<Select>` adds a second combobox to the order form, breaking bare
  `getByRole('combobox')` selectors in `order-form.spec.ts` (`.first()` disambiguation applied,
  matching the existing pattern). The AC-5 assertion was also placed here per Step 7(c)'s explicit
  "the appropriate order-form spec (or a new test block in orders.spec.ts)" wording. This file was
  not enumerated in Step 7 `**Files**`, but the change is squarely within Step 7's intent (E2E spec
  updates for the TIF change).
- **Disposition**: In-intent, spec-anticipated; staged with Step 7. Verified GREEN (29/29 trader
  order specs pass, incl. the AC-5 NAME-string assertion).

### Step 7 — UI e2e run: CI-mode host harness (dev-server cold-compile timeout)
- **What**: The non-CI `pnpm dev` harness times out the 10s SSR warmup on cold route compile; the
  Docker e2e runner base (`node:24-bookworm-slim`) risks the Docker Hub 429. Ran the trader order
  specs with `CI=1` (webServer does `pnpm build && pnpm start` with `NEXT_DISABLE_STANDALONE`, 30s
  test timeout) — the faithful analog of CI's `frontend-e2e` job. `pnpm build` (full app + e2e
  type-check) passes; 29/29 targeted specs pass.
- **Disposition**: CI-equivalent fallback. The full multi-segment Playwright suite runs in CI.
