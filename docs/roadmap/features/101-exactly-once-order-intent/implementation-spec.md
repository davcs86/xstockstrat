# Implementation Spec: exactly-once-order-intent

**Status**: `in-progress`
**Created**: 2026-08-06
**Feature**: `docs/roadmap/features/101-exactly-once-order-intent/feature.md`
**Total Steps**: 20
**Feature Branch**: `feature/exactly-once-order-intent`

---

## Execution Summary

Builds the `trading.order_intents` table and the DB-only insert-or-return-existing dedup mechanism
`design.md` chose (no in-process mutex), then wires it into `PlaceOrder`/`ReplaceOrder`/`CancelOrder`
in that order: proto → migration → config docs → broker client-order-id plumbing → repository →
pure decision helpers + sweeper → DI wiring → the three write handlers → the trader UI's `UNKNOWN`
display + Place Order client nonce → the fixed/extended test suites. Broker plumbing (Step 5) lands
before the repository/service layers because `PlaceOrder`'s rewrite (Step 12) needs
`DeriveBrokerClientOrderID` already in place. The pure helpers in `internal/service/order_intent.go`
(Step 9) land before the three write-handler rewrites (Steps 12–14) because all three call
`classifyIntentLookup`. UI steps (17–19) depend on the proto regen (Step 2) for the generated
`IntentState` TS enum. Per **C-14**, this spec lands both named Consumer Surface(s) from
product-spec.md: the `/trader` existing-orders `UNKNOWN` display (Steps 17–18) and the Place Order
flow's client nonce (Step 19) — neither is deferred.

One requirement is intentionally left for `/sdd-execute` to resolve, not silently assumed here per
**C-01**/**P-03**: design.md's Open Risk #1 (Alpaca/IBKR client-order-id length/charset limits are
undocumented in this repo) means Step 5's IBKR field name (`cOID`, IBKR's Client Portal Web API
client-order-id field) must be verified against IBKR's current public API docs before merging — it is
not confirmed by any file in this repository.

## Step Dependencies

- Step 2 requires Step 1 (proto-gen consumes the `.proto` edit).
- Steps 3–20 all read `trading.proto`'s regenerated stubs transitively; Step 2 must land before any
  code step that references `tradingv1.IntentState`.
- Step 7 requires Step 1 (repo scan code references `tradingv1.IntentState` values via the Go
  constants defined alongside them).
- Step 8 [test] covers Step 7 [service].
- Step 10 [test] covers Step 9 [service].
- Step 11 requires Steps 7 and 9 (DI wiring needs both `OrderIntentRepository` and the sweeper to exist).
- Steps 12–14 require Step 11 (the write handlers use the injected `orderIntentRepo` field) and
  Step 5 (they call `broker.DeriveBrokerClientOrderID`).
- Step 15 [test] covers Steps 12–14 [service].
- Step 16 [test] also covers Steps 12–14 — it is the AC-1..AC-4 behavioral proof scripts/unit tests
  cannot give without a live broker/DB (`scripts/integration-test.sh`).
- Step 18 requires Step 17 (call sites consume the render map Step 17 adds).
- Step 20 [test] covers Steps 17–19 [service].
- Migration `006_order_intents` (Step 3) cannot merge until `030-stop-loss-bracket-orders`'s
  `005_broker_accounts_halted` lands first — pre-assigned in `docs/roadmap/features/merge-order.md`
  (row: `exactly-once-order-intent` → `stop-loss-bracket-orders`). Per **C-07**, re-run
  `ls services/xstockstrat-trading/migrations/` immediately before Step 3 executes to confirm `005`
  is still the last file on disk and `006` is still free.
- `102-broker-state-reconciliation` (currently `demoted/canceled`, revived-when-picked-up) depends on
  this feature's `order_intents` schema and `order_intent.late_response_conflict` event shape — no
  action needed here, recorded for forward reference only (`merge-order.md` row:
  `broker-state-reconciliation` → `exactly-once-order-intent`).

---

### Step 1 — proto: add `IntentState` enum and `Order.intent_state` field

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/trading/v1/trading.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, `buf lint`/`buf breaking`; `xstockstrat-trading` owner — order execution correctness; `xstockstrat-ui` owner — consumes the regenerated enum

**Codebase Evidence**:
- `Order` message fields 1–20, next free field number confirmed **21** (`packages/proto/trading/v1/trading.proto:32-53`).
- `OrderStatus` enum values 0–7, next free value **8** — **not used by this feature**; design.md
  §"`IntentState` — orthogonal field, not a widened `OrderStatus`" rejects riding the existing enum
  because "an order that's `NEW` and also uncertain" must stay expressible.
- Naming/shape precedent: `CredentialStatus` tri-state enum (`trading.proto:158-165`,
  `UNSPECIFIED=0/OK=1/INVALID=2/UNKNOWN=3`) — same shape, different values.
- `PlaceOrderRequest.client_order_id = 10` (`trading.proto:91`) already exists and is currently
  optional/unused for dedup (confirmed by product-spec's resolved Open Question — no existing caller
  sets it).

**TDD**: `N/A (proto — no executable logic)`

**Instructions**:
1. Add a new top-level enum immediately after the `CredentialStatus` enum block (after line 165),
   mirroring its comment style:
   ```protobuf
   // IntentState is the platform's own knowledge of whether a PlaceOrder/ReplaceOrder/
   // CancelOrder command actually reached the broker — orthogonal to OrderStatus (an order
   // can be NEW and also UNKNOWN simultaneously). See docs/roadmap/features/101-exactly-once-order-intent/design.md.
   enum IntentState {
     INTENT_STATE_UNSPECIFIED = 0;
     INTENT_STATE_PENDING = 1;    // intent recorded, broker call not yet resolved
     INTENT_STATE_COMPLETED = 2;  // broker call resolved (accepted or a definite rejection)
     INTENT_STATE_REJECTED = 3;   // definite, synchronous broker rejection (not a timeout)
     INTENT_STATE_UNKNOWN = 4;    // broker outcome unknown — never retried automatically (FR-5)
   }
   ```
2. Add `IntentState intent_state = 21;` to the `Order` message (after `broker_type = 20` at line 52),
   with a one-line comment: `// intent_state is set by every write path and read via a cross-intent LATERAL join on other reads; see design.md.`
3. Update `PlaceOrderRequest.client_order_id`'s existing field (line 91) doc comment to state it is
   now **required** — a stable client-generated nonce reused across retries of the same logical
   place-order action (Step 19 wires the UI generator); empty is rejected with `InvalidArgument`
   (wired in Step 12).

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/exactly-once-order-intent"
```
Confirm `IntentState` has a `_UNSPECIFIED = 0` sentinel (C-04) and field 21 does not collide with any
other in-flight feature's claim on `Order` (none found in `merge-order.md`'s proto-field-collision
rows as of this spec).

---

### Step 2 — proto-gen: regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/trading/v1/*` — generate (checked-in codegen output)
- `packages/proto/gen/ts/trading/v1/*` — generate
- `packages/proto/gen/python/trading/v1/*` — generate

**Reviewers**: Proto Reviewer — inherited from Step 1

**Codebase Evidence**: `./scripts/buf-gen.sh` is the canonical regen entrypoint (root `CLAUDE.md` §
Generating Proto Stubs).

**TDD**: `N/A (generated code)`

**Instructions**: Run `./scripts/buf-gen.sh` from repo root. Do not hand-edit anything under `gen/`.

**Verification**:
```bash
./scripts/buf-gen.sh
git status --porcelain packages/proto/gen/
```
Confirm the diff contains only the new `IntentState` enum and `Order.intent_state` field additions
(and the compiled `gen/ts/dist/` output) — no unrelated regeneration drift.

---

### Step 3 — migration: `006_order_intents`

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/migrations/006_order_intents.up.sql` — create
- `services/xstockstrat-trading/migrations/006_order_intents.down.sql` — create

**Reviewers**: DBA — migration numbering, up+down pair, index correctness; `xstockstrat-trading` owner

**Codebase Evidence**:
- Confirmed via `ls services/xstockstrat-trading/migrations/`: highest file on disk is
  `004_broker_accounts_credential_status.{up,down}.sql`. No `005` or `006` exists yet.
- `docs/roadmap/features/merge-order.md` pre-assigns `030` → `005_broker_accounts_halted`,
  `101` → `006_order_intents` — **re-run the `ls` above immediately before creating this file** (C-07)
  to confirm `005` has landed and `006` is still free; if `005` has not landed yet, this step must
  wait (see `## Step Dependencies`).
- Column convention precedent: `004_broker_accounts_credential_status.up.sql` — `SMALLINT NOT NULL
  DEFAULT 0` mapped to a proto enum, with an inline comment documenting the value mapping.
- Full SQL body, index rationale, and the `(order_id, updated_at DESC)` index requirement: `design.md`
  § Schema + § Open Risk #6.

**TDD**: `N/A (migration — offline verification only)`

**Instructions**:

`006_order_intents.up.sql`:
```sql
-- state values match the trading.v1.IntentState proto enum:
--   0 = UNSPECIFIED, 1 = PENDING, 2 = COMPLETED, 3 = REJECTED, 4 = UNKNOWN.
-- Every INSERT sets state explicitly (see OrderIntentRepository.InsertIntent) — the DEFAULT
-- is a schema-level safety net only, never relied on by application code.
CREATE TABLE IF NOT EXISTS trading.order_intents (
    intent_id         UUID        PRIMARY KEY,
    order_id          UUID,       -- populated at INSERT for ALL command types (design.md round 7)
    request_hash      TEXT        NOT NULL,
    state             SMALLINT    NOT NULL DEFAULT 0,
    broker_account_id UUID        NOT NULL,
    first_response    JSONB,
    latest_response   JSONB,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sweep + reactive reclaim predicate (design.md § Sweep, § Reclaim CAS): both scan/update
-- exactly this shape (state=1/PENDING, ordered/filtered by updated_at).
CREATE INDEX IF NOT EXISTS idx_order_intents_pending_updated_at
    ON trading.order_intents (updated_at)
    WHERE state = 1;

-- Cross-intent precedence LATERAL join added to GetOrder/ListOrders in Step 7
-- (design.md § Cross-intent precedence, Open Risk #6) — keeps that join cheap on
-- ListOrders' existing LIMIT 500 query.
CREATE INDEX IF NOT EXISTS idx_order_intents_order_id_updated_at
    ON trading.order_intents (order_id, updated_at DESC);
```

`006_order_intents.down.sql`:
```sql
DROP TABLE IF EXISTS trading.order_intents;
```

**Verification**:
```bash
ls services/xstockstrat-trading/migrations/006_order_intents.up.sql services/xstockstrat-trading/migrations/006_order_intents.down.sql
```
Read both files: confirm the `.down.sql` drops exactly the table the `.up.sql` creates (indexes drop
implicitly with the table, so no explicit `DROP INDEX` is required). Do not start a database or run
`migrate` — that runs in CI/at deploy (`docs/patterns/database.md` § Migration tooling).

---

### Step 4 — config: register the two new keys

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/CLAUDE.md` — modify (Config Keys Consumed table)
- `docs/patterns/config-governance.md` — modify (Per-Feature Registered Keys log)

**Reviewers**: `xstockstrat-trading` owner — config naming/defaults

**Codebase Evidence**:
- Existing table format and every sibling key's default-declaration pattern:
  `services/xstockstrat-trading/CLAUDE.md` § Config Keys Consumed (e.g.
  `trading.fill_poller.interval_ms` | float | `5000`).
- Confirmed via grep: **no existing config-service seed row exists for any current
  `trading.*` key** (`trading.fill_poller.interval_ms`, `trading.credential_health.interval_ms`, etc.
  have zero hits under `services/xstockstrat-config/`) — every existing `trading.*` key is read live
  via `s.cfgW.GetFloat/GetInt(key, default)` with the default supplied in Go code and documented in
  this CLAUDE.md table, with no config-service seed migration. This feature's two new keys follow
  the same established local precedent — no seed row is added.
- Values: `design.md` § Staleness threshold (`trading.order_intent.stale_multiplier`, float, default
  `3.0`, floor-clamped ≥1.5 in code) and § Sweep (`trading.order_intent.sweep_interval_ms`, int,
  default `5000`, corrected in round 5 to match `trading.fill_poller.interval_ms`'s precedent).

**TDD**: `N/A (docs)`

**Instructions**:
1. Add two rows to `services/xstockstrat-trading/CLAUDE.md` § Config Keys Consumed:
   | Key | Type | Default | Description |
   |---|---|---|---|
   | `trading.order_intent.stale_multiplier` | float | `3.0` | Multiplier applied to `max(live trading.broker.timeout_ms, IBKRRequestTimeout)` to derive the PENDING-intent staleness threshold; read live, floor-clamped in code to ≥1.5 so a misconfigured multiplier can never push the threshold below the live broker timeout. |
   | `trading.order_intent.sweep_interval_ms` | int | `5000` | Interval for `StartOrderIntentSweeper`, the proactive reclaim loop that transitions orphaned `PENDING` intents to `UNKNOWN` after an unattended crash (no retry needed). Matches `trading.fill_poller.interval_ms`'s existing default. |
2. Add a new entry to `docs/patterns/config-governance.md` § Per-Feature Registered Keys (newest at
   top, per that log's own convention), using the same two rows plus the one-line feature summary
   ("Durable order-intent dedup + `UNKNOWN` uncertainty tracking for `PlaceOrder`/`ReplaceOrder`/
   `CancelOrder`.").

**Verification**:
```bash
grep -n "trading.order_intent" services/xstockstrat-trading/CLAUDE.md docs/patterns/config-governance.md
```
Confirm both keys appear in both files with matching defaults, and the key names follow
`<service>.<category>.<key>` (C-05).

---

### Step 5 — service: broker client-order-id derivation + IBKR plumbing

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/broker/clientorderid.go` — create
- `services/xstockstrat-trading/internal/broker/ibkr.go` — modify

**Reviewers**: `xstockstrat-trading` owner — broker API safety

**Codebase Evidence**:
- `broker.OrderRequest.ClientOrderID` already exists and is already forwarded by Alpaca
  (`internal/broker/alpaca.go:106,113`) — **no Alpaca change needed**, confirmed handled.
- **IBKR sends no client-order-id field at all** — confirmed via full read of `SubmitOrder`
  (`internal/broker/ibkr.go:116-169`); the request body map built at `ibkr.go:122-129` has no
  client-order-id key.
- IBKR's HTTP client timeout is hardcoded `10 * time.Second` with no named constant
  (`internal/broker/ibkr.go:55`, inside `NewIBKRClient`) — a confirmed pre-existing bug per
  `services/xstockstrat-trading/docs/context-constitution-findings.md:21` (not this feature's to
  fix), but design.md's staleness-threshold formula needs to reference its value as a named constant
  instead of a second `10 * time.Second` literal (design.md round 4 fix).
- Derivation scheme: `design.md` § "`PlaceOrder`'s intent ID — client nonce" — `"xss-" + intentID`
  (~40 chars, ASCII).
- **Open Risk, unresolved (design.md § Open Risks #1)**: the exact IBKR JSON field name for
  client-order-id is not documented anywhere in this repo. IBKR's Client Portal Web API documents a
  `cOID` field on the order object for this purpose — **this must be verified against IBKR's current
  public API docs before this step is considered done**; it is written here as the best-available
  candidate, not a confirmed-in-repo fact.

**TDD**: `red-green required`

**Instructions**:
1. Create `internal/broker/clientorderid.go`:
   ```go
   package broker

   // DeriveBrokerClientOrderID derives the broker-facing client-order-id from the
   // platform's own order-intent ID (design.md § "PlaceOrder's intent ID — client nonce").
   // Both Alpaca and IBKR receive this value via OrderRequest.ClientOrderID.
   func DeriveBrokerClientOrderID(intentID string) string {
       return "xss-" + intentID
   }
   ```
2. In `internal/broker/ibkr.go`, add a named constant next to `NewIBKRClient` (near line 42) replacing
   the bare literal at line 55:
   ```go
   // IBKRRequestTimeout is IBKR's hardcoded HTTP client timeout (a confirmed pre-existing
   // bug — see docs/context-constitution-findings.md — this feature does not fix it, only
   // names it so design.md's staleness-threshold formula has one source of truth).
   const IBKRRequestTimeout = 10 * time.Second
   ```
   and change line 55 to `httpClient: &http.Client{Timeout: IBKRRequestTimeout},`.
3. In `SubmitOrder` (`ibkr.go:116-169`), add the client-order-id to the request body map built at
   lines 122-129 — **verify the exact IBKR field name against IBKR's current Client Portal Web API
   docs before landing this line**; candidate: `body["cOID"] = req.ClientOrderID` (only when
   `req.ClientOrderID != ""`).

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod ./internal/broker/...
```
Confirm `DeriveBrokerClientOrderID` returns a value under IBKR's/Alpaca's documented client-order-id
length limit once that limit is confirmed (Open Risk #1) — flag in the PR description if either
broker's actual limit is shorter than ~40 chars, since `"xss-"+intentID` (a UUID) would then need
truncation, which design.md did not specify.

---

### Step 6 — test: broker client-order-id plumbing

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/broker/clientorderid_test.go` — create
- `services/xstockstrat-trading/internal/broker/ibkr_test.go` — modify

**Reviewers**: `xstockstrat-trading` owner

**Codebase Evidence**:
- Direct precedent for testing `ClientOrderID` plumbing on the Alpaca side:
  `internal/broker/alpaca_test.go:137` `TestSubmitOrder_TrailingStopAndClientOrderID` — already
  asserts `ClientOrderID: "internal-order-uuid"` round-trips into the Alpaca request body. No change
  needed to this test (Alpaca plumbing is unchanged); cited as the pattern to mirror for IBKR.
- IBKR test file structure: `internal/broker/ibkr_test.go:14` `TestSubmitOrder_IBKRResolvesConid`,
  `:72` `TestSubmitOrder_IBKRConidNotFound` — both spin up an `httptest.Server` and assert on the
  captured request body.
- `internal/broker` is **not** excluded from the Go coverage measurement (the excluded set is
  `cmd|handler|repository|telemetry|service` — `.claude/skills/sdd-spec/reference/spec-template.md`
  coverage table) — these tests count toward the 40% threshold.

**TDD**: `red-green required` — write both tests first against the pre-Step-5 tree (they fail: no
`DeriveBrokerClientOrderID` function, no `cOID`/client-order-id key in the IBKR request body), then
implement Step 5, then confirm green.

**Instructions**:
1. `clientorderid_test.go`: table-test `DeriveBrokerClientOrderID` — confirms the `"xss-"` prefix,
   confirms two different `intentID` inputs never collide, confirms output length assumption
   (~40 chars for a UUID input) matches the doc comment.
2. Extend `ibkr_test.go` with `TestSubmitOrder_IBKR_ClientOrderIDForwarded`: mirror
   `TestSubmitOrder_IBKRResolvesConid`'s `httptest.Server` setup, submit an `OrderRequest{..., ClientOrderID: "xss-test-intent"}`,
   assert the captured request body contains the client-order-id field name landed in Step 5.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod ./internal/broker/...
GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./internal/broker/... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
```
Confirm ≥40% and both new tests pass.

---

### Step 7 — service: `OrderIntentRepository` + `GetOrder`/`ListOrders` LATERAL join

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/repository/order_intent_repo.go` — create
- `services/xstockstrat-trading/internal/repository/trading_repo.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness

**Codebase Evidence**:
- Interface + concrete-impl DI shape to mirror exactly: `AccountRepository` interface +
  `pgAccountRepo` struct + `NewAccountRepo(pool *pgxpool.Pool) AccountRepository`
  (`internal/repository/account_repo.go:34-49`) — the only existing precedent in this service for an
  injectable repo interface (`TradingRepo` itself, by contrast, is a concrete struct with no
  interface).
- **Confirmed: no insert-or-return-existing (`ON CONFLICT ... DO NOTHING RETURNING`) idiom exists
  anywhere in this service.** The only existing `ON CONFLICT` is `UpsertOrder`'s clobber-style upsert
  (`trading_repo.go:61-68`) — this is a genuinely new persistence shape for this codebase.
  **No `ErrNotFound`-style sentinel exists** — `GetOrder` returns `(nil, nil)` on not-found
  (`trading_repo.go:82-95`) and callers nil-check; the new `GetIntentByID` follows the same idiom.
- Exact SQL for all four statements (insert, get, reclaim CAS, finalize CAS) and the sweep-select
  query: `design.md` § Concurrency + § Sweep + § Late-broker-response race (verbatim SQL, already
  corrected across rounds 6–7 to use integer `IntentState*` constants, never string literals — see
  `docs/roadmap/ledger/fails.md` 2026-08-06 entry, "exactly-once-order-intent — assumption").
- `GetOrder` (`trading_repo.go:82-95`) and `ListOrders` (`trading_repo.go:98-189`) SQL and `scanOrder`
  (`trading_repo.go:227-279`) are the two read paths the LATERAL join must be added to
  (`design.md` § Cross-intent precedence).
- pool routing: `xstockstrat-trading` connects through PgBouncer transaction-mode pooling
  (`DB_PGBOUNCER=true`, `:25061`, `docs/patterns/database.md` § Connection pooling) with
  `cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeExec` already set in
  `internal/repository/pool.go:36-38` — multi-statement transactions (the `PlaceOrder` intent-insert +
  provisional order-row insert sharing one local transaction, design.md § Concurrency) are compatible
  with PgBouncer transaction mode (the pool assigns one backend connection for the transaction's
  duration); no `pool.go` change is needed.

**TDD**: `red-green required` for the pure/testable surface (see Step 8's scope note — the SQL
statements themselves are exercised only via `scripts/integration-test.sh`, Step 16).

**Instructions**:
1. Create `order_intent_repo.go` with:
   ```go
   package repository

   import (
       "context"
       "time"

       "github.com/jackc/pgx/v5"
       "github.com/jackc/pgx/v5/pgxpool"
   )

   // IntentState mirrors the trading.v1.IntentState proto enum's integer values —
   // the order_intents.state column is SMALLINT, never compared against a string literal.
   const (
       IntentStateUnspecified int16 = 0
       IntentStatePending     int16 = 1
       IntentStateCompleted   int16 = 2
       IntentStateRejected    int16 = 3
       IntentStateUnknown     int16 = 4
   )

   type OrderIntentRecord struct {
       IntentID        string
       OrderID         string
       RequestHash     string
       State           int16
       BrokerAccountID string
       FirstResponse   []byte // JSONB, nil if unset
       LatestResponse  []byte
       CreatedAt       time.Time
       UpdatedAt       time.Time
   }

   // OrderIntentRepository is the insert-or-return-existing dedup store (design.md §
   // Concurrency). Defined as an interface (mirroring AccountRepository) so
   // internal/service tests can substitute a fake without a live DB.
   type OrderIntentRepository interface {
       // InsertIntent attempts the ON CONFLICT DO NOTHING RETURNING insert. ok=true means
       // this call owns the intent (proceed to the broker); ok=false means an existing row
       // was found and the caller must GetIntentByID and branch (design.md's reactive path).
       InsertIntent(ctx context.Context, rec *OrderIntentRecord) (ok bool, err error)
       GetIntentByID(ctx context.Context, intentID string) (*OrderIntentRecord, error)
       // ReclaimOrphanIntent is the single CAS shared by the reactive path and the sweeper
       // (design.md § Reclaim CAS). reclaimed=false means someone else already reclaimed it
       // or it is no longer stale — a safe no-op, not an error.
       ReclaimOrphanIntent(ctx context.Context, intentID string, staleBefore time.Time) (reclaimed bool, rec *OrderIntentRecord, err error)
       FinalizeIntent(ctx context.Context, intentID, orderID string, state int16, response []byte) error
       // SweepStalePending returns up to limit PENDING intents older than staleBefore, for
       // StartOrderIntentSweeper (internal/service/order_intent.go).
       SweepStalePending(ctx context.Context, staleBefore time.Time, limit int) ([]*OrderIntentRecord, error)
   }

   type pgOrderIntentRepo struct {
       pool *pgxpool.Pool
   }

   func NewOrderIntentRepo(pool *pgxpool.Pool) OrderIntentRepository {
       return &pgOrderIntentRepo{pool: pool}
   }
   ```
   Implement each method against the exact SQL in `design.md` (`insertIntentSQL`, `getIntentByIDSQL`,
   `reclaimOrphanIntentSQL`, `finalizeIntentSQL`, `sweepSelectSQL`), substituting the named
   `IntentState*` constants above wherever design.md's snippets say `$N = IntentStatePending` etc.
   `InsertIntent`/`FinalizeIntent`'s `pgx.ErrNoRows` on the `RETURNING` clause is the `ok=false` /
   no-op signal, not an error — check `errors.Is(err, pgx.ErrNoRows)` and return `(false, nil)` /
   `nil` respectively rather than propagating it.
2. In `trading_repo.go`, add the LATERAL join (design.md § Cross-intent precedence) to both
   `GetOrder`'s query (line 83) and `ListOrders`' query (line 110), and scan the joined `li.state`
   into a new `intentState int16` local in `scanOrder` (line 227), converting to
   `tradingv1.IntentState(intentState)` on the returned `Order.IntentState` field.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod ./internal/repository/...
GOWORK=off go build ./...
```
No coverage command here — see Step 8.

---

### Step 8 — test: repository package (coverage-excluded — build/lint only)

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/repository/order_intent_repo.go` — no additional changes (verification-only step)

**Reviewers**: `xstockstrat-trading` owner

**Codebase Evidence**:
- `internal/repository` is inside the Go coverage-**excluded** package set
  (`cmd|handler|repository|telemetry|service` —
  `.claude/skills/sdd-spec/reference/spec-template.md` coverage table) — per that table's own
  guidance: *"If new code lands only in Go packages excluded from CI measurement... note this in the
  test step: 'New logic is in an excluded package — no coverage threshold applies; integration test
  verification is sufficient.' A test step is still required."*
- **Confirmed: zero existing `*_test.go` files anywhere under `internal/repository/`** — no DB-mocking
  library (`pgxmock`/`sqlmock`/`testcontainers`) exists anywhere in this Go monorepo (grep across
  `services/` for those import paths returned no hits), so there is no in-repo precedent for a
  DB-backed unit test at this layer. This matches design.md's own framing: "no precedent exists in
  this service for this shape."

**TDD**: `N/A (coverage-excluded package; the real behavioral proof is Step 16's `scripts/integration-test.sh` extension)`

**Instructions**: New logic in `order_intent_repo.go` and the `trading_repo.go` LATERAL-join addition
is in an excluded package — no coverage threshold applies. This step's verification is the compile +
lint gate (already run in Step 7) plus a `go vet` pass, and the SQL statements' actual correctness is
proven by Step 16's `scripts/integration-test.sh` dedup section against a real broker/DB, and
indirectly by the unit-tested pure decision function in Step 10 (`classifyIntentLookup`), which
exercises every branch `InsertIntent`/`GetIntentByID`'s *result* can produce, without needing a live
connection to do so.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go vet ./internal/repository/...
```

---

### Step 9 — service: pure decision helpers + `StartOrderIntentSweeper`

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/order_intent.go` — create

**Reviewers**: `xstockstrat-trading` owner — order execution correctness

**Codebase Evidence**:
- Ticker + `ctx.Done()` shape to mirror exactly: `StartFillPoller`
  (`internal/service/trading.go:629-650`) — read live interval every tick via
  `s.cfgW.GetFloat("trading.fill_poller.interval_ms", defaultIntervalMs)`, `ticker.Reset` only on
  change. `StartOrderIntentSweeper` follows the identical shape, reading
  `trading.order_intent.sweep_interval_ms` (Step 4).
  Wiring precedent for a 4th poller: `cmd/server/main.go:106-110` starts the existing three
  (`StartFillPoller`, `StartPositionSyncPoller`, `StartCredentialHealthPoller`) each as `go
  svc.Start...Poller(ctx)`, sharing the top-level cancellable `ctx` — `StartOrderIntentSweeper` is
  wired the same way in Step 11.
- Existing pure-helper precedent to match in style: `alpacaStatusToProto`
  (`internal/service/trading.go:1393-1417`) and `normalizeFilledQty` (`:1380-1387`) — both take plain
  values, return a plain value/mutate in place, zero DB/network dependency, and are unit-tested in
  `trading_helpers_test.go` with a table-driven test. `classifyIntentLookup` below follows this exact
  pattern so it is directly unit-testable (Step 10) without a live DB or a mock — the same reasoning
  `insights.md` 2026-07-24's "shared pure gate module" entry (`cooldown.py`) generalizes to Go here.
- `IBKRRequestTimeout` named constant: Step 5.
- `s.cfgW.GetFloat`/`GetInt` signatures: `internal/config/config.go:152,172`
  (`GetInt(key string, def int64) int64`, `GetFloat(key string, def float64) float64`).
- Existing `uuid` import already present in `internal/service/trading.go:13`
  (`"github.com/google/uuid"`) — `uuid.NewSHA1`/`uuid.NameSpaceOID` are part of that same package, no
  new dependency.
- `TradingRepo.Pool()` exposes the shared `*pgxpool.Pool` (`trading_repo.go:31-33`) — reused for
  `NewOrderIntentRepo`, no second pool (F-06).

**TDD**: `red-green required`

**Instructions**:
1. `computeRequestHash(msg proto.Message) ([]byte, error)` — marshal deterministically
   (`proto.MarshalOptions{Deterministic: true}.Marshal(msg)`, new import
   `google.golang.org/protobuf/proto`) and `sha256.Sum256` the bytes; return the 32-byte digest.
2. `placeOrderRequestHash(req *tradingv1.PlaceOrderRequest) ([]byte, error)` — `proto.Clone(req)`, set
   the clone's `ClientOrderId = ""` (the client nonce is the intent ID, not part of the content being
   hashed — hashing it in would make every retry with the same nonce also hash-match trivially, which
   is correct, but would also make two *different* logical orders that happen to reuse a stale nonce
   collide on content instead of being caught — clearing it keeps the hash meaningful independent of
   the nonce), then `computeRequestHash` on the clone.
3. `deriveReplaceCancelIntentID(msg proto.Message) (intentID string, hashHex string, err error)` — for
   `ReplaceOrderRequest`/`CancelOrderRequest`. `sum, err := computeRequestHash(msg)`; `intentID :=
   uuid.NewSHA1(uuid.NameSpaceOID, sum[:]).String()`; `hashHex := hex.EncodeToString(sum[:])`.
4. `type intentAction int` with values `intentActionProceedNew`, `intentActionReturnStored`,
   `intentActionRejectHashMismatch`, `intentActionRejectUnknown`, `intentActionRejectPending`. Function
   `classifyIntentLookup(existing *repository.OrderIntentRecord, requestHashHex string, now time.Time, staleThreshold time.Duration) (action intentAction, isStale bool)`:
   - `existing.RequestHash != requestHashHex` → `intentActionRejectHashMismatch` (FR-3).
   - `existing.State == repository.IntentStateCompleted || existing.State == repository.IntentStateRejected` → `intentActionReturnStored` (FR-2).
   - `existing.State == repository.IntentStateUnknown` → `intentActionRejectUnknown` (FR-5).
   - `existing.State == repository.IntentStatePending`: `isStale = now.Sub(existing.UpdatedAt) >= staleThreshold`; action is always `intentActionRejectPending` regardless of `isStale` (design.md § Concurrency: "the caller cannot and need not distinguish 'not yet stale' from 'just reclaimed'"). The caller uses `isStale` only to decide whether to *attempt* `ReclaimOrphanIntent` before returning the rejection, not to change which action is returned.
5. `staleThreshold(cfgW *config.Watcher) time.Duration` — `brokerMs := cfgW.GetInt("trading.broker.timeout_ms", 5000)`; `floorMs := max(brokerMs, int64(broker.IBKRRequestTimeout/time.Millisecond))`; `multiplier := cfgW.GetFloat("trading.order_intent.stale_multiplier", 3.0)`; clamp `multiplier` to `≥1.5` in code; return `time.Duration(float64(floorMs)*multiplier) * time.Millisecond`.
6. `StartOrderIntentSweeper(ctx context.Context)` and `sweepOrderIntents(ctx context.Context)` —
   mirror `StartFillPoller`/`pollFills`'s exact shape (ticker default 5000ms, live-reread
   `trading.order_intent.sweep_interval_ms` each tick). `sweepOrderIntents` calls
   `s.orderIntentRepo.SweepStalePending(ctx, time.Now().Add(-staleThreshold(s.cfgW)), 100)`, then loops
   calling `s.orderIntentRepo.ReclaimOrphanIntent(ctx, rec.IntentID, staleBefore)` per row (identical
   call the reactive path uses — design.md's "not a new SQL shape" invariant); on `reclaimed==true`,
   emit `order_intent.reclaimed_unknown` via `s.emitLedgerEvent` (payload: `trigger: "sweep"`,
   `order_id`, original `updated_at`), stream key `fmt.Sprintf("order:%s", rec.OrderID)` (matches the
   existing `order:{order_id}` stream-key convention, `trading.go:315` etc.).

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod ./internal/service/...
GOWORK=off go build ./...
```

---

### Step 10 — test: pure decision helpers

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/order_intent_test.go` — create

**Reviewers**: `xstockstrat-trading` owner

**Codebase Evidence**:
- Table-test style precedent: `trading_helpers_test.go:10-37` (`TestAlpacaStatusToProto`).
- `internal/service` is inside the coverage-excluded package set, but per Step 8's cited rule a test
  step is still required — this one is a genuine, DB-free unit test (unlike Step 8), so it is written
  as full red-green regardless of the coverage exclusion, matching this codebase's existing practice
  of unit-testing pure helpers in `service` even though the package isn't measured.

**TDD**: `red-green required` — write against the pre-Step-9 tree (fails: functions don't exist), then
Step 9 lands, then green.

**Instructions**:
1. `TestComputeRequestHash_Deterministic` — same message marshaled twice produces identical digests;
   two messages differing in one field produce different digests.
2. `TestPlaceOrderRequestHash_IgnoresClientOrderId` — two `PlaceOrderRequest`s identical except for
   `ClientOrderId` hash identically; changing any other field changes the hash.
3. `TestDeriveReplaceCancelIntentID_Deterministic` — same `ReplaceOrderRequest` (or `CancelOrderRequest`) content produces the same `intentID` across two calls; different content produces a different `intentID` with overwhelming probability (assert inequality, not a specific value).
4. `TestClassifyIntentLookup` — table test covering all five action branches listed in Step 9
   Instruction 4, including the two `PENDING` sub-cases (`isStale=true` / `isStale=false`, same
   returned action).
5. `TestStaleThreshold_ClampsMultiplierFloor` — a config-mocked `stale_multiplier` of `1.0` (below the
   1.5 floor) still yields a threshold ≥ `1.5 * max(brokerTimeoutMs, IBKRRequestTimeout)`.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod ./internal/service/... && GOWORK=off go test ./internal/service/... -race -count=1
```
All new tests pass; no coverage threshold applies to this package (Step 8's cited exclusion).

---

### Step 11 — service: DI wiring (`orderIntentRepo` field + `resolveAccount` fix + `main.go`)

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify
- `services/xstockstrat-trading/cmd/server/main.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness

**Codebase Evidence**:
- `TradingService` struct fields and `NewTradingService` signature: `trading.go:58-71,96-102` — add
  `orderIntentRepo repository.OrderIntentRepository` as a new field, populated from a new
  `orderIntentRepo repository.OrderIntentRepository` constructor parameter (6th, after `repo
  *repository.TradingRepo`), mirroring how `accountRepo repository.AccountRepository` (an interface)
  already sits alongside the concrete `repo *repository.TradingRepo` in the same struct.
- **Confirmed gap this feature must close**: `resolveAccount(accountID string) (brokerPoolEntry,
  error)` (`trading.go:188-209`) discards the resolved account ID on its single-registered-account
  fallback path (`len(s.brokers) == 1` loop at lines 200-204 never captures the map key) — so
  `order.AccountId` (and therefore `order_intents.broker_account_id`, `NOT NULL`) can be empty on that
  path today even though a real account was used. All 3 call sites: `trading.go:262` (`PlaceOrder`),
  `:405` (`CancelOrder`), `:465` (`ReplaceOrder`).
- `main.go:74-91` — `repo, err := repository.NewTradingRepo(...)`, `accountRepo :=
  repository.NewAccountRepo(repo.Pool())`, `svc, err := service.NewTradingService(cfg, cfgWatcher,
  accountRepo, repo, cfg.BrokerAccountsEncryptionKey)`.
- Poller wiring precedent: `main.go:105-110` (`go svc.StartFillPoller(ctx)` etc.) — add
  `go svc.StartOrderIntentSweeper(ctx)` alongside them.

**TDD**: `red-green required` (the `resolveAccount` signature change is a real behavior fix, not just
plumbing)

**Instructions**:
1. Change `resolveAccount`'s signature to `func (s *TradingService) resolveAccount(accountID string) (resolvedID string, entry brokerPoolEntry, err error)`. In the explicit-`accountID` branch, `resolvedID = accountID`. In the single-registered-account fallback loop (lines 200-204), capture the map key: `for id, e := range s.brokers { return id, e, nil }`. Update all 3 call sites (`trading.go:262,405,465`) to receive and use the resolved ID — in `PlaceOrder`, use it for both `order.AccountId` (replacing the direct `req.AccountId` at line 300) and the new `order_intents.broker_account_id` insert.
2. Add `orderIntentRepo repository.OrderIntentRepository` to the `TradingService` struct (near line 71) and `NewTradingService`'s parameter list (near line 99), assigning it in the constructor body alongside the existing `accountRepo`/`repo` assignments.
3. In `main.go`, after `accountRepo := repository.NewAccountRepo(repo.Pool())` (line 83), add `orderIntentRepo := repository.NewOrderIntentRepo(repo.Pool())` (reuses `TradingRepo`'s shared pool — no new connection, F-06), and pass it into `service.NewTradingService(...)` as the new argument.
4. After the existing three `go svc.Start...Poller(ctx)` lines (`main.go:106-110`), add `go svc.StartOrderIntentSweeper(ctx)`.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod ./...
```
Confirm all 3 `resolveAccount` call sites compile against the new 3-return signature.

---

### Step 12 — service: `PlaceOrder` dedup rewrite

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, broker API safety, paper-only dev invariant, position limit enforcement

**Codebase Evidence**:
- Current `PlaceOrder`: `trading.go:242-385`. Mandatory-nonce, dedup-insert, and error-branch changes
  target this function specifically.
- `orderID := uuid.New().String()` (line 279) — kept unchanged (still the platform order ID); the
  **intent** ID is now `req.ClientOrderId` (mandatory), a separate value.
- Existing broker-error branch to change: `order.Status = ORDER_STATUS_REJECTED` unconditionally on
  any `SubmitOrder` error (`trading.go:343-352`) — recon.md's confirmed conflation: "Any broker-call
  error (including a timeout) is wrapped and the order is unconditionally set to
  `ORDER_STATUS_REJECTED`... this is exactly the ambiguity FR-4's `UNKNOWN` state must fix, not a
  hypothetical gap."
- `brokerReq.ClientOrderID = orderID` (line 341) — changes to
  `broker.DeriveBrokerClientOrderID(intentID)` (Step 5).
- **Trading-mode gate (unaffected)**: the existing `platform.maintenance_mode` check (`trading.go:244`)
  and the paper/live resolution (`resolveTradingMode`, `:271`) are untouched by this step — dedup
  applies identically regardless of trading mode (product-spec's resolved Open Question: "no" behavior
  difference paper vs live).
- **Order type coverage (unaffected)**: dedup operates on the whole request hash, not per-order-type —
  all 5 `OrderType` values are covered uniformly; no order-type-specific branch is added.
- **Fill state completeness (unaffected)**: this step does not touch fill detection
  (`pollFills`/`StartFillPoller`) — `IntentState` is orthogonal to `OrderStatus`/fill progress per
  design.md, unchanged by this step.
- **Broker coverage**: both `BROKER_TYPE_ALPACA` and `BROKER_TYPE_IBKR` are covered — this function is
  broker-agnostic (`accountEntry.client.SubmitOrder`, a `broker.Broker` interface call), so no
  per-broker branch is needed here (the broker-specific plumbing is Step 5).

**TDD**: `red-green required`

**Instructions**:
1. Immediately after the existing trailing-stop validation block (after line 259), add:
   `if req.ClientOrderId == "" { return nil, grpcstatus.Errorf(codes.InvalidArgument, "client_order_id is required") }` — `intentID := req.ClientOrderId`.
2. Compute `hashDigest, err := placeOrderRequestHash(req)` (Step 9); on error, `codes.Internal`.
   `requestHashHex := hex.EncodeToString(hashDigest[:])`.
3. Resolve `resolvedAccountID` via the Step-11-updated `resolveAccount` **before** the dedup insert (it
   must run before any DB write since `order_intents.broker_account_id` needs it) — move the existing
   `accountEntry, err := s.resolveAccount(req.AccountId)` call (line 262) earlier if needed, or keep
   its position and thread `resolvedAccountID` through.
4. Mint `orderID` as today (line 279), then attempt the dedup insert **before** building the
   provisional `order` struct: `ok, err := s.orderIntentRepo.InsertIntent(ctx, &repository.OrderIntentRecord{IntentID: intentID, OrderID: orderID, RequestHash: requestHashHex, State: repository.IntentStatePending, BrokerAccountID: resolvedAccountID})`.
   - Per design.md's transaction-boundary rule, this insert and the provisional `UpsertOrder` call
     (existing line 311) share one short local transaction (both fast, local, no network I/O) — use
     `s.repo.Pool().Begin(ctx)` (already the pattern the pool exposes via `TradingRepo.Pool()`),
     `tx.Exec` for both statements, `tx.Commit()`. This is safe under PgBouncer transaction-mode
     pooling (confirmed, Step 7 evidence).
   - `ok == false`: an existing intent was found. `existing, err := s.orderIntentRepo.GetIntentByID(ctx, intentID)`; call `classifyIntentLookup(existing, requestHashHex, time.Now(), staleThreshold(s.cfgW))` (Step 9).
     - `intentActionRejectHashMismatch` → `codes.FailedPrecondition` (FR-3).
     - `intentActionReturnStored` → unmarshal `existing.LatestResponse` back into an `*tradingv1.Order` and return it directly, **no broker call** (FR-2).
     - `intentActionRejectUnknown` → `codes.FailedPrecondition` (FR-5).
     - `intentActionRejectPending` → if `isStale`, attempt `s.orderIntentRepo.ReclaimOrphanIntent(ctx, intentID, ...)` first (best-effort — ignore its result either way per design.md's "cannot and need not distinguish" rule), then `codes.FailedPrecondition` regardless.
5. `ok == true`: proceed exactly as today (build `order`, `UpsertOrder`, ledger events) through the
   broker call, with `brokerReq.ClientOrderID = broker.DeriveBrokerClientOrderID(intentID)` (replacing
   line 341's `orderID`).
6. On broker-call error (line 343): detect timeout via `errors.Is(err, context.DeadlineExceeded)` **or**
   `var netErr net.Error; errors.As(err, &netErr) && netErr.Timeout()`.
   - **Timeout**: do **not** finalize the intent (leave it `PENDING` for reclaim) and do **not**
     unconditionally set `order.Status = ORDER_STATUS_REJECTED` — leave `order.Status` at its
     pre-broker-call value (`NEW`/`PENDING_APPROVAL`). Still `_ = s.repo.UpsertOrder(...)` and emit the
     existing `order.broker_rejected`-equivalent... actually emit a distinct ledger event
     `order.broker_call_uncertain` (payload: `order_id`, `intent_id`, `error`) so the existing
     `order.broker_rejected` event keeps its "definitely rejected" meaning; return the order as-is
     (its `IntentState` will read `PENDING` until reclaimed) with the existing `fmt.Errorf("broker
     submission failed: %w", err)` error (unchanged — the RPC still errors; the *stored* state is what
     changes).
   - **Non-timeout (a definite synchronous rejection)**: keep the existing behavior — `order.Status =
     ORDER_STATUS_REJECTED`, `_ = s.repo.UpsertOrder(...)`, emit `order.broker_rejected` (unchanged) —
     **and** finalize the intent: `s.orderIntentRepo.FinalizeIntent(ctx, intentID, orderID, repository.IntentStateRejected, marshaledOrder)`.
7. On broker-call success (existing lines 354-384): after building the final `order`, finalize the
   intent: `s.orderIntentRepo.FinalizeIntent(ctx, intentID, orderID, repository.IntentStateCompleted, marshaledOrder)` (best-effort — log a warning on failure, do not fail the RPC, matching this function's existing `_ = s.repo.UpsertOrder(...)` best-effort style).
8. Set `order.IntentState` on every return path in this function (design.md's write-handler-parity
   rule, C-10(b)) — `tradingv1.IntentState_INTENT_STATE_PENDING` before the broker call resolves (the
   approval-required early return at line 327 also needs this — but note: an approval-required order
   has no broker call yet at all, so it is not part of this feature's dedup surface; set its
   `IntentState` to `INTENT_STATE_UNSPECIFIED` since no intent write happens on that path, or skip the
   field entirely — leave a code comment explaining the approval path is out of this feature's intent
   tracking since FR-1..FR-6 concern the broker call, which the approval path defers indefinitely).

**Verification**: covered by Steps 15–16.

---

### Step 13 — service: `ReplaceOrder` dedup rewrite

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness

**Codebase Evidence**:
- Current `ReplaceOrder`: `trading.go:433-504`. Existing fill-state gate (`switch order.Status` at
  lines 452-458, only `NEW`/`PARTIALLY_FILLED` replaceable) and broker-order-id precondition
  (`:460-463`) are **unchanged** by this step.
- Existing broker-error branch to change: `codes.Internal` on `entry.client.ReplaceOrder` error
  (`trading.go:478-480`) — "no uncertainty flag recorded today" (recon.md).
- Server-derived intent ID: `deriveReplaceCancelIntentID(req)` (Step 9), using the full
  `ReplaceOrderRequest` (including `order_id`, since a replace is scoped to a specific order).

**TDD**: `red-green required`

**Instructions**:
1. After resolving `order`/`entry` (existing lines 434-468), compute
   `intentID, requestHashHex, err := deriveReplaceCancelIntentID(req)` (Step 9); on error,
   `codes.Internal`.
2. Attempt `s.orderIntentRepo.InsertIntent(ctx, &repository.OrderIntentRecord{IntentID: intentID, OrderID: req.OrderId, RequestHash: requestHashHex, State: repository.IntentStatePending, BrokerAccountID: order.AccountId})` (no shared transaction needed here — `ReplaceOrder` has no separate provisional-row insert to bundle with, unlike `PlaceOrder`).
3. `ok == false` branch: identical classification/response shape to `PlaceOrder` Step 12 Instruction 4
   (reuse `classifyIntentLookup`), except `intentActionReturnStored` unmarshals the stored response
   into the `*tradingv1.Order` this function returns.
4. On broker `ReplaceOrder` call error (existing line 478): apply the same timeout-vs-definite-error
   branch as `PlaceOrder` Step 12 Instruction 6 — timeout leaves the intent `PENDING` (for reclaim) and
   returns the existing `codes.Internal` error unchanged; a non-timeout error finalizes the intent to
   `IntentStateRejected` and still returns `codes.Internal` (existing behavior preserved).
5. On success (existing lines 482-503): finalize the intent to `IntentStateCompleted` (best-effort,
   matching `PlaceOrder`'s style) before `return order, nil`. Set `order.IntentState` on the returned
   `Order` (C-10(b)).

**Verification**: covered by Steps 15–16.

---

### Step 14 — service: `CancelOrder` dedup rewrite (fail-open semantics preserved)

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness

**Codebase Evidence**:
- Current `CancelOrder`: `trading.go:387-427`. The existing deliberate fail-open behavior — "mark
  canceled locally regardless of broker response" (`trading.go:404-413`, comment: "broker may have
  already filled/canceled") — is a **distinct, pre-existing decision this step does not alter**
  (design.md § Cross-intent precedence: "without altering Cancel's existing 'act as if it worked'
  `OrderStatus` behavior at all — these are deliberately two different axes").
- Server-derived intent ID: `deriveReplaceCancelIntentID(req)` (Step 9), using the `CancelOrderRequest`
  (`order_id` + `user_id`).

**TDD**: `red-green required`

**Instructions**:
1. After resolving `order` (existing lines 388-401), compute `intentID, requestHashHex, err :=
   deriveReplaceCancelIntentID(req)`.
2. Attempt `s.orderIntentRepo.InsertIntent(ctx, &repository.OrderIntentRecord{IntentID: intentID,
   OrderID: req.OrderId, RequestHash: requestHashHex, State: repository.IntentStatePending,
   BrokerAccountID: order.AccountId})`.
3. `ok == false` branch: identical classification/response shape to Step 12/13 (`classifyIntentLookup`).
4. **Do not change the existing broker-call-error fail-open branch** (`trading.go:409-413`) — the
   `entry.client.CancelOrder` error is still only logged as a warning and cancellation proceeds
   locally regardless. **Add**: on that error branch, finalize the intent to `IntentStateUnknown`
   (design.md: "that branch's cancel intent goes to `UNKNOWN` — not `CONFIRMED` — a broker-call
   failure doesn't support the certainty `CONFIRMED` would assert") via
   `s.orderIntentRepo.FinalizeIntent(ctx, intentID, req.OrderId, repository.IntentStateUnknown, marshaledCancelResponse)`
   — best-effort, does not change the existing `order.Status = ORDER_STATUS_CANCELED` line that
   follows unconditionally (line 416).
5. On the no-broker-order-id-yet path (order never reached the broker) and the broker-call-succeeded
   path, finalize the intent to `IntentStateCompleted`.
6. Set `order.IntentState` on the returned `Order` inside `CancelOrderResponse` (C-10(b)).

**Verification**: covered by Steps 15–16.

---

### Step 15 — test: write-handler unit coverage (excluded package — targeted assertions)

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_helpers_test.go` — modify

**Reviewers**: `xstockstrat-trading` owner

**Codebase Evidence**:
- `internal/service` is coverage-excluded (Step 8's cited rule) — `PlaceOrder`/`ReplaceOrder`/
  `CancelOrder` themselves call real broker/repo dependencies through concrete fields (`s.repo
  *repository.TradingRepo` is concrete, not an interface — no substitution point exists for it), so
  they are not unit-testable end-to-end without a live DB, matching this service's existing practice
  (no handler-level unit test exists for `PlaceOrder`/`CancelOrder`/`ReplaceOrder` today either).
- The genuinely new decision surface (`classifyIntentLookup`, hash/ID derivation, staleness clamp) is
  already fully unit-tested in Step 10 — this step is additive only where a plain assertion is
  possible without a live dependency.

**TDD**: `N/A (coverage-excluded package; the real behavioral proof is Step 16)`

**Instructions**: Add `TestPlaceOrder_RequiresClientOrderId` style assertions **only** for the parts
reachable without a broker/DB: construct a `PlaceOrderRequest{ClientOrderId: ""}` and confirm the
handler-level guard added in Step 12 Instruction 1 returns `codes.InvalidArgument` before touching
`s.orderIntentRepo`/`s.repo` — this is reachable because the guard runs before any dependency call, so
a `TradingService{}` zero-value (or one with only `cfgW` set) suffices. Do not attempt to unit-test the
dedup/broker-call branches here — that is out of reach without a live DB/broker per the evidence above;
Step 16 covers them.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/... -race -count=1
```

---

### Step 16 — test: `scripts/integration-test.sh` — fix broken sections + new dedup section

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `scripts/integration-test.sh` — modify

**Reviewers**: `xstockstrat-trading` owner

**Codebase Evidence**:
- `section_8_place_order` (`scripts/integration-test.sh:420-448`) — its `PlaceOrder` JSON body
  (lines 427-433) has no `client_order_id` — will fail `codes.InvalidArgument` once Step 12 lands.
- `section_13_maintenance_mode` (`:502-...`) — its `PlaceOrder` JSON body (lines 527-533) also lacks
  `client_order_id`; its existing broad-grep assertion (`:540`,
  `"maintenance|unavailable|rejected|error|code.*13|UNAVAILABLE"`) would otherwise **false-positive**
  on the new `InvalidArgument`-for-missing-nonce rejection instead of genuinely testing maintenance
  mode — design.md flags this exact false-positive risk.
- This is the AC-1..AC-4 behavioral proof — product-spec's Out of Scope explicitly keeps "ordinary
  unit/integration tests covering the dedup/timeout/restart behavior" in scope (only the dedicated
  crash-injection suite, demoted feature `105`, is out).

**TDD**: `red-green required` for the new section (write it asserting the post-Step-12..14 behavior;
it fails against the pre-implementation tree since `client_order_id` is not yet enforced/deduped).

**Instructions**:
1. Add `"client_order_id": "it-place-<random>"` to `section_8_place_order`'s JSON body (line ~428) and
   `section_13_maintenance_mode`'s JSON body (line ~528) — a fresh value per section run so the two
   sections' intents don't collide with each other.
2. Add a new `section_14_order_intent_dedup()` immediately after `section_13_maintenance_mode`:
   - Place an order with `client_order_id: "it-dedup-fixed"`, capture `order_id` (AC-1 setup).
   - Repeat the identical `PlaceOrder` call (same `client_order_id`, same body) — assert the response's
     `order_id` **matches** the first call's, and log that no second broker submission occurred (AC-1,
     FR-2).
   - Repeat again with the same `client_order_id` but a different `qty` — assert the response is a
     rejection (`FailedPrecondition`/`code.*9`) (AC-3, FR-3).
3. Register the new section in the section-run list (existing `section_8_place_order` /
   `section_13_maintenance_mode` calls near the bottom of the file, `:580,584`).

**Verification**:
```bash
grep -n "client_order_id" scripts/integration-test.sh
```
Confirm both fixed sections now include `client_order_id`, and the new section is both defined and
invoked. This script is not CI-wired (pre-existing condition, unchanged by this feature) — its value
is as a documented, runnable manual proof of AC-1/AC-3, consistent with how `section_13`'s own
comments already describe its role.

---

### Step 17 — service: `xstockstrat-ui` — `IntentState` render map + prop threading

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/trader/orderShared.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness

**Codebase Evidence**:
- Exhaustive-map precedent to follow: `services/xstockstrat-ui/src/lib/opportunityShared.tsx:20-53`
  (`Record<Enum, EnumRender>` keyed on the enum type itself, e.g. `SOURCE_HEALTH`) — per that file's
  own header comment, "adding a proto enum value without a map entry breaks `tsc` here."
- Current non-exhaustive map to leave as-is (out of this step's scope — `OrderStatus`, not
  `IntentState`): `STATUS_VARIANT: Record<string, ...>` (`orderShared.tsx:10-21`) — **not** converted
  by this feature (design.md's Open Risk #7 concerns the new `IntentState` render, not a rewrite of
  the pre-existing `OrderStatus` map, which stays as today).
- `Badge` component variants available: `default/secondary/destructive/outline/buy/sell/paper/live/
  warning/info` (`src/components/ui/badge.tsx:9-20`) — `warning` (yellow) already used for
  `PARTIALLY_FILLED`/`PENDING_APPROVAL` in `STATUS_VARIANT`, reused here for the same "needs
  attention" semantic.
- `IntentState` will be available from the regenerated stub (Step 2) at
  `@xstockstrat/proto/trading/v1/trading_pb`, same import path as `OrderStatus`
  (`orderShared.tsx:6`).

**TDD**: `red-green required` (a `tsc` build is the red/green signal here — see Verification)

**Instructions**:
1. Import `IntentState` alongside the existing `OrderSide, OrderStatus` import (line 6).
2. Add an exhaustive render map, mirroring `opportunityShared.tsx`'s shape but returning `null` for
   states that need no extra UI (only `UNKNOWN` needs a visible signal per product-spec's literal
   requirement — "an order in the `UNKNOWN` state must render distinctly," not every intent state):
   ```tsx
   interface IntentRender { label: string; variant: 'warning' }
   export const INTENT_STATE_RENDER: Record<IntentState, IntentRender | null> = {
     [IntentState.UNSPECIFIED]: null,
     [IntentState.PENDING]: null,
     [IntentState.COMPLETED]: null,
     [IntentState.REJECTED]: null,
     [IntentState.UNKNOWN]: { label: 'Uncertain — verify with broker', variant: 'warning' },
   };
   ```
3. Add `export function IntentStateBadge({ intentState }: { intentState: IntentState })`: `const r =
   INTENT_STATE_RENDER[intentState]; if (!r) return null; return <Badge variant={r.variant}
   title="Command outcome unknown — check the broker dashboard before retrying">{r.label}</Badge>;` —
   returns `null` (renders nothing) for every state except `UNKNOWN`, so existing terminal/working
   orders are visually unchanged.
4. Thread an `intentState: IntentState` prop into `OrderStatusBadge` (line 45) and `OrderStatusCell`
   (line 69), rendering `<IntentStateBadge intentState={intentState} />` alongside the existing status
   badge (do not merge them into one badge — FR-4 requires `UNKNOWN` to be visible **distinctly**, not
   folded into the status label).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec tsc --noEmit
```
Confirms the exhaustive `Record<IntentState, ...>` compiles against all 5 enum values (adding a 6th
later would fail this build — the C-10(a/d) compile-time guard the design requires).

---

### Step 18 — service: wire `intentState` through the 4 call sites + `isWorking()` gate

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/trader/OrderBook.tsx` — modify
- `services/xstockstrat-ui/src/components/trader/OrdersTable.tsx` — modify
- `services/xstockstrat-ui/src/app/trader/orders/[id]/page.tsx` — modify
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness

**Codebase Evidence**: all 4 call sites confirmed via grep —
`OrderBook.tsx:51` (`<OrderStatusCell status={order.status} />`),
`OrdersTable.tsx:110` (same), `orders/[id]/page.tsx:93` (`<OrderStatusBadge status={order.status}
/>`), `positions/[symbol]/page.tsx:388` (`<OrderStatusBadge status={o.status} />`). `isWorking()`
(`orders/[id]/page.tsx:29-31`, `status === NEW || status === PARTIALLY_FILLED`) never checks
`intentState` today — design.md's Open Risk #7: gate Replace/Cancel button availability on
`intentState != UNKNOWN`, a UI-only scope line (server-side RPC blocking of `Replace`/`Cancel` while
`UNKNOWN` is not required — the write handlers reject on their own dedup terms per Steps 13–14, but a
proactive UI disable avoids a pointless round trip). `order.intentState`/`o.intentState` are populated
by the generated TS stub (Step 2) once the BFF forwards `getOrder`/`listOrders` responses unmodified
(confirmed: `traderBff.ts:42-43` already forwards `Order` fields verbatim — no BFF change needed).

**TDD**: `red-green required` — the type-checker fails first (missing prop) once Step 17 makes
`intentState` a required prop on `OrderStatusBadge`/`OrderStatusCell`.

**Instructions**:
1. `OrderBook.tsx:51` and `OrdersTable.tsx:110` — pass `intentState={order.intentState}`.
2. `positions/[symbol]/page.tsx:388` — pass `intentState={o.intentState}`.
3. `orders/[id]/page.tsx:93` — pass `intentState={order.intentState}`.
4. `orders/[id]/page.tsx:29-31` — change `isWorking(status: OrderStatus): boolean` to `isWorking(status: OrderStatus, intentState: IntentState): boolean { return (status === OrderStatus.NEW || status === OrderStatus.PARTIALLY_FILLED) && intentState !== IntentState.UNKNOWN; }`; update its one call site (line 42, `const working = order ? isWorking(order.status) : false;`) to `isWorking(order.status, order.intentState)`. This narrows Edit/Cancel button visibility (lines 97-128) without touching the server-side reject path Steps 13–14 already own.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec tsc --noEmit
```

---

### Step 19 — service: Place Order client nonce (Consumer Surface — Place Order flow)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/trader/OrderForm.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness

**Codebase Evidence**:
- `OrderForm.tsx:70-80` — the `placeOrder(...)` call site; the request object built here has no
  `clientOrderId` field today (confirmed: zero hits for `clientOrderId`/`client_order_id` anywhere
  under `services/xstockstrat-ui/src` or `e2e`, matching product-spec's resolved Open Question — this
  is the platform's first client-side idempotency key).
- `traderBff.ts:28-34` (`placeOrder`) already spreads `{ ...req, userId: claims.user_id }` — a
  `clientOrderId` field on the browser's request object passes through unmodified; **no BFF change is
  required**, confirmed by reading the full handler.
- No `uuid` package is used browser-side anywhere in this codebase (confirmed via grep — the one hit,
  `src/lib/auth.ts`, is unrelated JWT code) — the Web Crypto `crypto.randomUUID()` API (no new
  dependency) is the grounded choice.
- `onSuccess` callback (`OrderForm.tsx:82-89`) already resets `symbol`/`qty`/`limitPrice`/`stopPrice`
  after a successful placement — the natural point to also mint a fresh nonce for the *next* order,
  per design.md's "generate a stable nonce per logical place-order action... reuse the same nonce on
  every retry of that same action" — a successful placement ends that logical action; a failed one
  (network error, timeout, or a genuine `FailedPrecondition`) does not, so the form must keep the same
  nonce across a resubmit attempt.

**TDD**: `red-green required` (proven at the e2e layer, Step 20 — no isolated unit-test target exists
for a component-level nonce given this codebase has no component/jsdom test layer, per
`services/xstockstrat-ui/CLAUDE.md` § Testing: "Component/jsdom testing is intentionally out of
scope").

**Instructions**:
1. Add `const [clientOrderId, setClientOrderId] = useState(() => crypto.randomUUID());` near the other
   `useState` declarations (after line 64) — generated once on mount (the "form open" moment per
   design.md's phrasing).
2. Add `clientOrderId` to the `placeOrder(...)` request object (line 71-80, alongside `symbol`/`side`/
   etc.).
3. In `onSuccess` (line 82-89), after the existing field resets, call
   `setClientOrderId(crypto.randomUUID())` — a new logical action (the next order) gets a fresh nonce.
   Do **not** regenerate it in `onError` — the existing nonce must survive a resubmit of the same
   logical action (a network retry, a double-click, or the operator clicking "Place Order" again after
   seeing the error message), which is the entire point of FR-1/FR-2 for this command type.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec tsc --noEmit
```
Behavioral proof (nonce reused across a retry, rotated after success) is Step 20's e2e test.

---

### Step 20 — test: `xstockstrat-ui` e2e — fixtures, `mock-backend.ts`, `api-smoke.spec.ts`, new assertions

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/fixtures/orders.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify
- `services/xstockstrat-ui/e2e/trader/api-smoke.spec.ts` — modify
- `services/xstockstrat-ui/e2e/trader/order-ticket.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness; QA advisory per `.claude/agents/qa-tester.md` (test-data inventory)

**Codebase Evidence**:
- `e2e/fixtures/orders.ts:16-52` — `ORDER_FILLED`/`ORDER_WORKING`, numeric `status:` literals
  documented inline (per its own header comment) — a new `ORDER_UNKNOWN_INTENT` fixture follows the
  exact same shape, with an `intentState: 4 // UNKNOWN` field (per the proto value ordering landed in
  Step 1: `UNSPECIFIED=0/PENDING=1/COMPLETED=2/REJECTED=3/UNKNOWN=4`).
- `e2e/fixtures/INVENTORY.md:25` — the existing catalog row for `ORDER_FILLED, ORDER_WORKING, ORDERS,
  orderForId` — gets a note appended for the new fixture (C-12: "a new domain object gets a fixture
  module + `INVENTORY.md` catalog row in the same step").
- `api-smoke.spec.ts:71-77` — the `PlaceOrder` POST body has no `clientOrderId`; will 400 once Step 12
  lands (confirmed exact match to design.md's flagged breakage).
- **Feature 096 file-level overlap (design.md Open Risk #8)**: `orderShared.tsx`, `e2e/fixtures/
  orders.ts`, `e2e/mock-backend.ts` are shared with in-flight feature `096-position-and-order-detail-
  pages` — check `docs/roadmap/features/096-position-and-order-detail-pages/context.md`'s current step
  status before editing these three files, to avoid a merge conflict on the same lines; rebase onto
  096's latest state if it has landed changes to these files since this spec was written.
- `e2e/mock-backend.ts:137` (`async placeOrder()`) — confirm whether the mock echoes back
  `clientOrderId`/an intent-state field; if not, extend it minimally so a nonce-reuse e2e assertion
  (Instruction 3 below) has something to assert against, per the `insights.md` 2026-07-27 ledger entry
  ("a mock that echoes a request field back as its response cannot distinguish a correct consumer from
  an incorrect one" — the mock must genuinely branch on `clientOrderId`, not just echo it, for the test
  to mean anything).

**TDD**: `red-green required`

**Instructions**:
1. Add `ORDER_UNKNOWN_INTENT` to `orders.ts` (a working TSLA-shaped order with `intentState: 4 //
   UNKNOWN`) and add it to the `ORDERS` array; update `INVENTORY.md`'s existing orders row to mention
   the new fixture.
2. Fix `api-smoke.spec.ts:75` — add `clientOrderId: 'e2e-smoke-<random>'` to the POST body.
3. Extend `mock-backend.ts`'s `placeOrder` handler (line 137) to key a small in-memory map by
   `clientOrderId`: a repeat call with a `clientOrderId` already seen in the same test run returns the
   same `orderId` as before (not a new one) — genuinely exercising dedup in the mock, not just echoing.
4. Add a new assertion to `order-ticket.spec.ts` (or a new `e2e/trader/order-intent.spec.ts` if the
   existing file's scope doesn't fit): render the orders list with `ORDER_UNKNOWN_INTENT` in the mock
   response, assert the `IntentStateBadge`'s "Uncertain — verify with broker" text is visible, and
   assert it is **absent** for `ORDER_FILLED`/`ORDER_WORKING`.
5. Add an `OrderForm` nonce-reuse assertion: submit the form once (capture the mock's recorded
   `clientOrderId` via the Step-3 in-memory map or a route-intercept), trigger a second submit of the
   same unedited form (simulating a retry) before a success re-render, assert both requests carried the
   **same** `clientOrderId`; then assert a fresh submit *after* a successful placement carries a
   **different** `clientOrderId`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -- trader/order-ticket.spec.ts trader/api-smoke.spec.ts
```
(add `trader/order-intent.spec.ts` to the invocation if created as a separate file). No coverage
threshold applies to `xstockstrat-ui` (spec-template's coverage table: "n/a — use `pnpm test:e2e`").

**Execution notes**:
- Instruction 4 landed as a new `e2e/trader/order-intent.spec.ts` (Instruction 4's own fallback) —
  `order-ticket.spec.ts`'s existing scope is the working/filled contrast, not intent-state uncertainty;
  a separate file keeps that distinction legible. Registered in `INVENTORY.md`'s orders row.
- Instruction 3's dedup map had to store the *whole* mocked response (`{orderId, status, tradingMode}`),
  not just an `orderId` string, and the id itself stays the fixed `'mock-order-001'` literal —
  `order-form.spec.ts` hard-asserts that exact string, and `startMockBackend()` runs once for the whole
  Playwright run (`global-setup.ts`), so the map (and any id-generation scheme) is shared/persistent
  across every spec file and worker for the run's lifetime. A counter-based id would have made that
  assertion depend on cross-file execution order. `Map.get()`'s `| undefined` return also required an
  explicit `stored` local (not returned directly) to satisfy `tsc` against the generated `PlaceOrder`
  handler's `MessageInit<Order>` return type — caught by the Next.js dev-server type-check build itself.
  Also documented in the ledger (2026-08-07 addendum to the 2026-07-27 entry): a dedup mock must persist
  the *stored response*, not synthesize a new deterministic-looking id per call, when any consumer
  elsewhere in the suite hard-asserts the original literal.
- Instruction 5 landed as a new `order-form.spec.ts` test (`clientOrderId nonce is reused on a failed
  resubmit, rotated after success`) using `page.route()` to intercept `PlaceOrder` directly (rather than
  reading the Step-3 map, which isn't exposed to the browser) and recording each request's
  `clientOrderId` from `postDataJSON()` — asserts the id is unchanged across a failed retry and rotates
  after a successful placement.
- `api-smoke.spec.ts:75`'s POST body now sends a fixed `clientOrderId: 'e2e-smoke-place-order-001'`
  rather than a randomly generated one — the smoke test only asserts response shape (`orderId`/`status`
  presence and type), so a fixed literal is simpler and equally correct; no assertion depends on
  uniqueness within this file.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
