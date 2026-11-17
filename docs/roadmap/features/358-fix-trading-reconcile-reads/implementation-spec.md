# Implementation Spec: fix-trading-reconcile-reads

**Status**: `pending`
**Created**: 2026-11-17
**Feature**: `docs/roadmap/features/358-fix-trading-reconcile-reads/feature.md`
**Total Steps**: 5
**Feature Branch**: `feature/fix-trading-reconcile-reads`

---

## Execution Summary

The fix follows design.md § Chosen Approach exactly. It is one service (xstockstrat-trading) with no proto,
migration, config key, env var or portfolio change. The order is bottom-up, so every commit builds and
passes its own Verification:

1. Step 1 adds the skip counter to the telemetry package. Nothing calls it yet.
2. Step 2 adds it to the label allowlist test. Its RED is the `minInstruments` entry failing with
   "instrument … not collected" before Step 1.
3. Step 3 replaces the single `ListPositions` call in `reconcileTick` with the fail-closed drain helper
   and records the counter in the unchanged `ppErr` skip branch.
4. Step 4 adds the 358 regression tests. Its behavioural subtests are written first and fail on the
   pre-Step-3 tree (RED). The direct-helper hardening table is added after Step 3, because it calls
   symbols Step 3 creates.
5. Step 5 updates the service docs.

**Consumer surface (C-14)**: `None — internal/platform-only` (product-spec.md § Consumer Surface(s)). There is
no UI or Agent step. The only visible effect is the absence of a false halt (existing `HaltBadge` and
reconciliation alert) plus the new OTel counter.

**Durable suites (C-16)**: the @AC-1..@AC-4 scenarios are promoted into
`services/xstockstrat-trading/acceptance/` by `/sdd-execute` at integration (`.claude/skills/sdd-execute/SKILL.md`
step 2.5). No step here hand-writes a durable rule.

**FR-5 / @AC-4**: appended to `product-spec.md` and `acceptance.feature` in this `/sdd-spec` session, per the
binding operator decision at design gate r6 (IDs append-only).

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` Reconcile does not flag a held position past the first 500 | Step 4 |
| `@AC-2` A page error skips the account for the tick (plus the deadline variant) | Step 4 |
| `@AC-3` A repeated `next_page_token` is a failed read | Step 4 |
| `@AC-4` A skipped position-side check is counted with a bounded outcome label | Step 2 (bounded label set / allowlist), Step 4 (outcome counts) |

## Step Dependencies

- Step 2 [test] covers Step 1 [service]. Step 2 references `telemetry.RecordReconcilePositionSkip`, which
  Step 1 creates, so Step 2 runs after Step 1. Step 1 passes its own Verification alone: the counter is
  reachable only through the exported `RecordReconcilePositionSkip`, and nothing calls it yet.
- Step 3 requires Step 1: the `ppErr` branch calls `telemetry.RecordReconcilePositionSkip` and the mapper
  returns `telemetry.ReconcileSkipOutcome`.
- Step 4 [test] covers Step 3 [service]. The RED run is Step 4's behavioural subtests against the tree that
  holds only Steps 1-2 (`.claude/skills/sdd-execute/reference/tdd-gate.md`). Those subtests use only
  symbols that already exist (`fakeReconciliationPortfolioClient`, `snapshotInts`, `installMetricReader`,
  `counterValue`, `outcome`, `keysByInstrument`, the counter name as a string literal). The hardening table
  calls `listAccountPlatformPositions`, `reconcilePositionSkipCause`, the three sentinels and
  `reconcilePositionsPageSize`, so it is written after Step 3 lands.
- Step 3 passes its own Verification without Step 4: the existing `reconcileTick` tests use the default
  `fakeReconciliationPortfolioClient` response (`trading_reconciliation_test.go:128-132`, no `Page`) or a
  single page with no `next_page_token` (:617, :655), so the drain makes exactly one call and returns the
  same map as today.
- Step 5 [docs] follows Step 3: it documents the shipped counter name and outcome set.
- **Atomic units (`**Lands with**`)**: none. A §C trigger check over every step found:
  - no changed signature, constructor or return shape (all new symbols are additive);
  - no `.proto` edit;
  - no test that references a symbol a *later* step creates (the hardening table is sequenced after
    Step 3, see above);
  - no deleted referenced resource (the deleted `platformBySymbol` rebuild at `trading.go:2244-2247` is
    local to `reconcileTick`);
  - no config seed;
  - no cross-module rename.
  Each step is therefore its own commit.
- Merge order: 358 must not merge ahead of feature 353 (`fix-listpositions-nextpagetoken-skips`). 353's
  server-side token fix is already an ancestor of this branch (recon.md:73). Track this at the integration PR.

---

### Step 1 — service: Add the `trading.reconciliation.position_check_skipped` counter and its typed outcome

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/telemetry/otel.go` — modify

**Reviewers**: xstockstrat-trading service owner — order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement

**Codebase Evidence**:
- Counter block: `grep -n "NewCounter(\"trading\." services/xstockstrat-trading/internal/telemetry/otel.go` → lines 332-337 inside `var (` … `)` at :331-338 (`escalationSystemic = NewCounter("trading.escalation.systemic")` at :337).
- Label key: `KeyOutcome = "outcome"` at `otel.go:312` (const block :311-316, comment at :310: "a recorded attribute key outside this set fails the allowlist test").
- Record-function pattern: `func RecordBracketOutcome(ctx context.Context, outcome string) { bracketOutcome.Add(ctx, 1, attribute.String(KeyOutcome, outcome)) }` at `otel.go:356-358`. `RecordEscalationSystemic` is the last one, at :375-377.
- `NewCounter` is lazy (binds on first `Add` against the current global MeterProvider): `otel.go:191-205`. A per-test `installMetricReader` therefore observes it.

**Lands with**: —

**TDD**: `red-green required` — the RED is Step 2's `minInstruments` entry failing with "instrument trading.reconciliation.position_check_skipped not collected" on the tree before this step.

**Covers**: —

**Instructions**:
1. In the counter `var (` block at `otel.go:331-338`, add after `escalationSystemic`:
   `reconcilePositionSkip = NewCounter("trading.reconciliation.position_check_skipped")`.
2. After `RecordEscalationSystemic` (:375-377), add:
   - `type ReconcileSkipOutcome string`
   - a const block with exactly three values (operator r6, O-22/O-23):
     `ReconcileSkipRPCError ReconcileSkipOutcome = "rpc_error"`,
     `ReconcileSkipDeadline ReconcileSkipOutcome = "deadline"`,
     `ReconcileSkipCursorInvalid ReconcileSkipOutcome = "cursor_invalid"`.
   - `func RecordReconcilePositionSkip(ctx context.Context, outcome ReconcileSkipOutcome) { reconcilePositionSkip.Add(ctx, 1, attribute.String(KeyOutcome, string(outcome))) }`
3. Use no other attribute. Never add `account_id` or `user_id`: both are in `forbiddenLabelKeys`
   (`internal/service/telemetry_allowlist_test.go:32-35`). Add no new `Key*` constant. Do not touch
   `escalationSystemic` (R-15) and do not make the new counter unlabelled (R-16).
4. Any comment stays at most 2 lines and states a constraint (e.g. "closed outcome set; no per-account
   attribute — cardinality").

**Verification**:
```bash
( cd services/xstockstrat-trading && GOWORK=off go build ./... && GOWORK=off go vet ./internal/telemetry/... ./internal/service/... && GOWORK=off go test ./internal/telemetry/... ./internal/service/... -count=1 )
( cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod )
```
Both exit 0.

---

### Step 2 — test: Register the skip counter in the label allowlist test

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/telemetry_allowlist_test.go` — modify

**Reviewers**: xstockstrat-trading service owner — order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement

**Codebase Evidence**:
- `grep -n "minInstruments\|driveAllInstruments" services/xstockstrat-trading/internal/service/telemetry_allowlist_test.go`:
  - `var minInstruments = []string{` at :37-40 (ends with `"trading.escalation.systemic"`);
  - `func driveAllInstruments(ctx context.Context)` at :44-52 (last call `telemetry.RecordEscalationSystemic(ctx)`).
- `TestAllowlist_AC41_EveryLabelKeyIsATelemetryConstant` at :100 fails with `"instrument %s not collected"` for any `minInstruments` name not driven, and checks every key against `allowedLabelKeys` (:28-30) and `forbiddenLabelKeys` (:32-35).
- No `t.Parallel` in `internal/service` (comment at :25-26; `trading_telemetry_test.go:283`).

**Lands with**: —

**TDD**: `red-green required`.

**Covers**: `AC-4` (the label set is bounded and carries no `account_id`/`user_id` key).

**Instructions**:
1. RED is a temporary run on the pre-Step-1 tree, taken out of the step order. Before Step 1 is applied,
   append `"trading.reconciliation.position_check_skipped"` to `minInstruments` (:37-40). Run
   `GOWORK=off go test -run TestAllowlist_AC41 ./internal/service/` and capture the failure
   `instrument trading.reconciliation.position_check_skipped not collected`. Keep that edit uncommitted
   while Step 1 lands. No new test function is added; the existing `TestAllowlist_AC41_*` tests cover it.
2. After Step 1 is committed: append to `driveAllInstruments` (:44-52) one call per outcome:
   `telemetry.RecordReconcilePositionSkip(ctx, telemetry.ReconcileSkipRPCError)`,
   `telemetry.RecordReconcilePositionSkip(ctx, telemetry.ReconcileSkipDeadline)`,
   `telemetry.RecordReconcilePositionSkip(ctx, telemetry.ReconcileSkipCursorInvalid)`.
   The existing allowlist and forbidden-key loops then cover the new instrument with no new assertion code.
3. C-13: no domain test data is added (instrument names and typed constants only). Single consumer, nothing
   to move.
4. The Step 2 commit holds both edits together: the `minInstruments` entry (item 1) and the
   `driveAllInstruments` calls (item 2).

**Verification**:
```bash
( cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/ -run 'TestAllowlist' -count=1 -v 2>&1 | grep -E "^(--- |ok|FAIL)" )
( cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod )
```
Every `TestAllowlist*` passes. New logic is in the excluded `telemetry`/`service` packages, so no coverage
threshold applies here (Step 4 runs the full coverage command).

---

### Step 3 — service: Drain `ListPositions` fail-closed in `reconcileTick` and count skips

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify

**Reviewers**: xstockstrat-trading service owner — order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement

**Codebase Evidence**:
- Defect site (re-read at this tree): `trading.go:2231-2239`:
  - `listPosCtx, listPosCancel := context.WithTimeout(ctx, timeout)`;
  - `listPosCtx = metadata.AppendToOutgoingContext(listPosCtx, "x-user-id", entry.userID)` at :2234;
  - `s.portfolio.ListPositions(listPosCtx, &portfoliov1.ListPositionsRequest{AccountId: &accountID, TradingMode: tradingMode, Page: &commonv1.PageRequest{PageSize: 500}})` at :2235-2238;
  - `listPosCancel()` at :2239.
- Skip branch: `trading.go:2240-2243`: `if ppErr != nil { slog.WarnContext(ctx, "reconcileTick: portfolio ListPositions failed", "account_id", accountID, "error", ppErr); continue // not counted toward systemic … }`.
- Rebuild to delete: `trading.go:2244-2247` (`platformBySymbol := make(map[string]float64, len(platformPositions.Positions))` + range loop). Consumers of `platformBySymbol`: :2256 and :2277-2278.
- `tradingMode` derived at `trading.go:2227-2230`. `timeout := brokerCallTimeout(s.cfgW)` at :2109 (`func brokerCallTimeout` at :2585-2591).
- Imports already present in `trading.go`: `"errors"` (:7), `"fmt"` (:8), `"google.golang.org/grpc/codes"` (:20), `"google.golang.org/grpc/metadata"` (:22), `grpcstatus "google.golang.org/grpc/status"` (:23, the status package is aliased `grpcstatus` in this file), `commonv1` (:28), `portfoliov1` (:33), `"github.com/xstockstrat/trading/internal/telemetry"` (:41). No import change is needed.
- Precedent drain (reuse target, recon.md § Patterns to REUSE): `services/xstockstrat-portfolio/internal/service/portfolio_service.go:1114-1170` (`collectFills`):
  - `PageRequest{PageSize, PageToken: token}` at :1122;
  - error on an RPC error (:1124-1126);
  - empty page with a token (:1127-1129);
  - `next := resp.GetPage().GetNextPageToken()` (:1162), return on `""` (:1163-1165);
  - error on `next == token` (:1166-1168).
- Only production `ListPositions` call in trading: `trading.go:2235` (recon.md:35).
- Trading-domain survey (step-constraints §A):
  - Broker coverage: the change is broker-agnostic. The portfolio read runs for every `brokerMap` entry; `BROKER_TYPE_OFFLINE` stays skipped at `trading.go:2095`. ALPACA and IBKR are both unaffected beyond the read.
  - Trading-mode gate: not an order-placement path; `TRADING_MODE` is unaffected. The mode passed is the existing `tradingMode` from `entry.client.IsPaper()` (:2227-2230).
  - Order types and fill states (`PARTIALLY_FILLED`/`FILLED`): unaffected by this step. The order-side reconcile and `resolveUnknownIntents` (:2292) are not edited.
- Header propagation (§B): no new outbound RPC. The existing `ListPositions` call is now made once per page, and each page context re-applies the same `x-user-id` injection as :2234 (PLAT-4; the background poller has no inbound headers, so `x-access-scope`/`x-trace-id` stay absent as today).

**Lands with**: —

**TDD**: `red-green required` — RED is Step 4's behavioural subtests (AC-1, positive control, AC-2 error, AC-2 deadline, AC-3, counter outcomes), run against the tree before this step.

**Covers**: —

**Instructions** (all in `services/xstockstrat-trading/internal/service/trading.go`):
1. Add the package declarations next to `reconcileTick` (before :2085):
   - `const reconcilePositionsPageSize = 500` (D-6; no config key, no page cap: R-4, R-5).
   - `var errEmptyPageWithToken = errors.New("empty page with next_page_token")`
   - `var errRepeatedPageToken = errors.New("repeated next_page_token")`
   - `var errDuplicateSymbol = errors.New("duplicate symbol")`
2. Add the helper
   `func (s *TradingService) listAccountPlatformPositions(ctx context.Context, accountID, userID string, mode commonv1.TradingMode, timeout time.Duration) (map[string]float64, error)`
   (D-1, D-16, D-19; it never reads config). It keeps `out := map[string]float64{}`,
   `seen := map[string]bool{}`, `token := ""`, and loops with a 1-based page index `i`. Per page, in this
   order (D-9; R-7 forbids merging before the token guards):
   1. `pctx, cancel := context.WithTimeout(ctx, timeout)`, then
      `pctx = metadata.AppendToOutgoingContext(pctx, "x-user-id", userID)`, then call
      `s.portfolio.ListPositions(pctx, &portfoliov1.ListPositionsRequest{AccountId: &accountID, TradingMode: mode, Page: &commonv1.PageRequest{PageSize: reconcilePositionsPageSize, PageToken: token}})`.
      Call `cancel()` right after the call returns, never `defer` inside the loop (D-3; R-1 forbids one
      shared deadline).
   2. On an error: `return nil, fmt.Errorf("page %d: list positions: %w", i, err)`.
   3. `next := resp.GetPage().GetNextPageToken()`. Then:
      - if `len(resp.GetPositions()) == 0 && next != ""`:
        `return nil, fmt.Errorf("page %d: %w %q", i, errEmptyPageWithToken, next)`;
      - if `next != "" && seen[next]`:
        `return nil, fmt.Errorf("page %d: %w %q", i, errRepeatedPageToken, next)`. Every token already
        sent is in `seen` (sub-step 5), so `next == sent` is caught (a superset of FR-3's rule). A
        comment of at most 2 lines may say this is defense-in-depth against the keyset cursor (O-5).
   4. For each position: if `_, dup := out[p.GetSymbol()]; dup`,
      `return nil, fmt.Errorf("page %d: %w %q", i, errDuplicateSymbol, p.GetSymbol())` (D-5, D-13, R-3).
      Otherwise `out[p.GetSymbol()] = p.GetQty()`.
   5. If `next == ""` return `out, nil`. Otherwise `seen[next] = true; token = next; i++`.

   It returns either the complete map or `nil` plus an error, never a partial map. The resulting error
   texts are exactly:
   - `page 2: repeated next_page_token "p2"`
   - `page N: empty page with next_page_token "<tok>"`
   - `page 2: duplicate symbol "SYM500"`
   - `page N: list positions: <rpc error>`
3. Add the mapper `func reconcilePositionSkipCause(err error) telemetry.ReconcileSkipOutcome` (binding
   operator decision r6, O-20/O-24). In order:
   - `errors.Is(err, context.DeadlineExceeded) || grpcstatus.Code(err) == codes.DeadlineExceeded` →
     `telemetry.ReconcileSkipDeadline`;
   - `errors.Is` any of `errEmptyPageWithToken`, `errRepeatedPageToken`, `errDuplicateSymbol` →
     `telemetry.ReconcileSkipCursorInvalid`;
   - everything else, including `context.Canceled` → `telemetry.ReconcileSkipRPCError`.
   It never matches error text (R-17).
4. In `reconcileTick`, replace :2231-2239 with
   `platformBySymbol, ppErr := s.listAccountPlatformPositions(ctx, accountID, entry.userID, tradingMode, timeout)`.
   Delete :2244-2247 (the rebuild), so `platformBySymbol` binds directly from the helper (D-16, R-11).
   Move the existing 2-line `x-user-id` comment (:2232-2233) into the helper unchanged.
5. In the `ppErr` branch (:2240-2243), add exactly one line before the unchanged WARN:
   `telemetry.RecordReconcilePositionSkip(ctx, reconcilePositionSkipCause(ppErr))` (D-21). Keep the WARN
   message, its keys and the `continue` byte-for-byte. Do not increment `systemicCount` (D-7, R-6).
   The wrapped error already carries the page index and cause into the WARN's `error` field (D-8).
6. Change nothing else: the order-side reconcile, `NetFilledQtyBySymbol` grounding (:2254-2273), the
   compare loop (:2275-2288), `resolveUnknownIntents` (:2292) and `escalateSystemic` stay as they are.

**Verification**:
```bash
( cd services/xstockstrat-trading && GOWORK=off go build ./... && GOWORK=off go vet ./... && GOWORK=off go test ./... -count=1 )
( cd services/xstockstrat-trading && grep -n "reconcilePositionsPageSize\|listAccountPlatformPositions\|reconcilePositionSkipCause\|RecordReconcilePositionSkip\|PageSize: 500" internal/service/trading.go )
( cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod )
```
`go test ./...` passes: the pre-existing reconcile tests stay green on a single page. The grep shows the
const, the helper, the mapper and one `RecordReconcilePositionSkip` call, and no remaining `PageSize: 500`
literal. Lint exits 0.

---

### Step 4 — test: 358 regression tests: drain, skip-the-tick, repeated token, counted skips, guard hardening

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_reconciliation_test.go` — modify

**Reviewers**: xstockstrat-trading service owner — order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement

**Codebase Evidence** (all re-read at this tree):
- Harness in `trading_reconciliation_test.go`:
  - `fakeReconciliationBroker{listOrdersFn, getPositionsFn, isPaper}` at :79-83 (`IsPaper()` returns `f.isPaper`, :115);
  - `fakeReconciliationPortfolioClient{listPositionsFn}` at :122-133 (default response is an empty `ListPositionsResponse`, :131);
  - `recordingLedgerClient` at :137-170, recording the full `AppendEventRequest` (`events`) with `eventTypes()`;
  - `newTestReconciliationService(brokers, portfolio, ledger, notify, accountRepo)` at :168-170, which delegates to `newTestReconciliationServiceWithIntents` (:176-196); that helper sets `cfgW: &config.Watcher{}` (:179), `reconcilePositionLookup: &fakePositionQtyLookup{}` (:188) and `reconcileCandidates: make(map[string]int)` (:194);
  - `fakePositionQtyLookup` at :228-245 (empty `net`, so SYM501 is unexplained);
  - `noopAccountRepo` at :250-256;
  - two-tick grace pattern at :554-555;
  - payload reads `e.Payload.Fields["order_id"].GetStringValue()` at :632.
  Existing imports (:3-22) lack `fmt`, `codes`, `status`, `metadata` and `commonv1`; add them.
- `fakeNotifyClient` at `trading_bracket_test.go:180`.
- `snapshotInts(map[string]int64) *config.Watcher` at `trading_ibkr_auth_test.go:121-127` (`config.MustSnapshotWatcher("trading", …)`). `brokerCallTimeout` reads `cfgW.GetFloat("broker.timeout_ms", 5000)` (`trading.go:2585-2591`), and `GetFloat` widens an IntVal (recon/D-11 evidence `internal/config/watchcore.go:406-416`).
- Metric helpers in package `service`:
  - `installMetricReader(t)` at `trading_telemetry_test.go:285-296`;
  - `counterValue(t, reader, name, kv...)` at :316-332;
  - `outcome(v)` at :334;
  - `keysByInstrument(t, reader)` at `telemetry_allowlist_test.go:55`.
- Halt state: `isAccountHalted` at `trading.go:2892-2896`. A finding is `emitReconciliationFinding` (:2060-2083), which writes `reconciliation.mismatch_found` with payload keys `expected`/`broker_reported` and halts via `haltAccount`.
- Ignore-token fake with a call cap (reuse shape): `services/xstockstrat-portfolio/internal/service/portfolio_pnl_paging_test.go:27-28` (`pagingCallCap = 100`), :34 (`ignoreToken`), :43 (cap check), :49 (token honoured unless `ignoreToken`).
- C-13: the 501-symbol broker/page builders and `reconcile358Owner` have one consumer (this file). Inline is compliant; nothing moves to `internal/testdata/`.

**Lands with**: —

**TDD**: `red-green required`. RED is captured on the behavioural subtests (items 2-7 below) on the tree
before Step 3: today's single call reads SYM501 as 0, so tick 1 emits a finding and halts, and the call
count is 1 per tick. The hardening table (item 8) references Step 3's symbols, so it is written after
Step 3 and is GREEN-side only. Its guard discrimination is exact text per row (D-12).

**Covers**: `AC-1, AC-2, AC-3, AC-4`

**Instructions** (no `t.Parallel` anywhere; every test that asserts the counter calls
`reader := installMetricReader(t)` as its **first statement**, D-23):
1. **Fixtures** (file-local):
   - `const reconcile358Owner = "user-358-owner"`, placed in `brokerPoolEntry.userID` (`trading.go:75-81`) (D-20).
   - A builder for the 501 `broker.BrokerPosition{Symbol: fmt.Sprintf("SYM%03d", n), Quantity: 10}`. The broker fake always sets `isPaper: true` (D-20).
   - A paging fake (mirroring `pagingLedger`) wired through `fakeReconciliationPortfolioClient.listPositionsFn`. Under a mutex it records, at call entry:
     - `req.GetPage().GetPageToken()`, `req.GetPage().GetPageSize()`;
     - `req.GetAccountId()`, `req.GetTradingMode()`;
     - the outgoing `x-user-id` (`metadata.FromOutgoingContext(ctx)`);
     - `ctx.Deadline()`.
     It enforces a call cap of 100 (returns `codes.ResourceExhausted` past it). It serves page 1
     (`SYM001..SYM500`, next `"p2"`) and page `"p2"` by token, with hooks for:
     - a page-2 qty override;
     - a page-2 error;
     - page-1 `time.Sleep`;
     - a page-2 block on `ctx.Done()`;
     - `ignoreToken`.
     `takeLog()` returns the log and resets it (D-15).
2. **AC-1** (`@AC-1`, plus `@AC-4` zero guard), test `TestReconcileTick_358_AC1_DrainsAllPages_NoFindingNoHalt`:
   - Page 2 holds `SYM501` qty 10 with next `""`. Pre-seed `svc.reconcileCandidates["acc-1:pos:SYM501"] = 1`.
   - Run `svc.reconcileTick(context.Background(), 1, 1.1)` twice.
   - After **each** tick assert:
     - `takeLog()` has exactly 2 entries with tokens `["", "p2"]`;
     - every entry has `x-user-id == reconcile358Owner`, `AccountId == "acc-1"` and `TradingMode == commonv1.TradingMode_TRADING_MODE_PAPER` (D-17; a literal enum, R-13);
     - no `reconciliation.mismatch_found` in `ledger.eventTypes()`;
     - `!svc.isAccountHalted("acc-1")`.
   - After tick 1, also assert the seeded key is absent.
   - After both ticks, assert `counterValue(t, reader, "trading.reconciliation.position_check_skipped") == 0`.
   - RED today: the finding and the halt at tick 1, and 1 call per tick (O-8).
3. **Positive control** (preserves `@AC-2 @feature-206`), test `TestReconcileTick_358_PositiveControl_Page2MismatchHalts`:
   - Same as AC-1, but page 2 has SYM501 qty 5.
   - After two ticks assert exactly one `reconciliation.mismatch_found` whose `Payload.Fields["order_id"]` is `"SYM501"`, `["expected"].GetNumberValue() == 5` and `["broker_reported"].GetNumberValue() == 10`, read only from `recordingLedgerClient` (D-10, D-14, R-9).
   - Assert `svc.isAccountHalted("acc-1")`, the per-entry identity/mode assertions from item 2, and skip counter total 0.
   - RED today: `expected == 0`.
4. **AC-2 error** (`@AC-2`, `@AC-4` rpc_error row), test `TestReconcileTick_358_AC2_Page2RPCError_SkipsAccountForTick`:
   - Page `"p2"` returns `status.Error(codes.Unavailable, "portfolio down")`.
   - After each tick assert:
     - a `"p2"` call was made;
     - there is no key with prefix `"acc-1:pos:"` in `svc.reconcileCandidates`;
     - there is no `mismatch_found`;
     - the account is not halted.
   - After two ticks assert:
     - `counterValue(t, reader, name, outcome("rpc_error")) == 2`;
     - `keysByInstrument(t, reader)[name]` holds neither `"account_id"` nor `"user_id"`.
5. **AC-2 deadline** (EXTEND of `@AC-2`), test `TestReconcileTick_358_AC2_Page2Deadline_SkipsAccountForTick`:
   - `svc.cfgW = snapshotInts(map[string]int64{"broker.timeout_ms": 50})`.
   - Page 1 does `time.Sleep(5 * time.Millisecond)` and never observes ctx (D-18, R-12).
   - Page `"p2"` blocks on `<-ctx.Done()` and returns `ctx.Err()`. This is a **plain `context.DeadlineExceeded`**, the form the AC-2 deadline fake returns (operator r6).
   - The broker fakes never sleep.
   - Assert the same skip outcomes as item 4.
   - Assert that in each tick's log the page-2 entry `Deadline()` is strictly after page 1's (D-11; a shared deadline, R-1, gives equal values).
   - Assert `counterValue(..., outcome("deadline")) == 2`.
6. **AC-3** (`@AC-3`, `@AC-4` cursor_invalid row), test `TestReconcileTick_358_AC3_IgnoredToken_SkipsAccountForTick`:
   - `ignoreToken`: every call returns page 1 with next `"p2"`.
   - After each tick assert:
     - at most 2 calls (exactly 2: `["", "p2"]`);
     - no `acc-1:pos:` candidate, no finding, not halted.
   - After two ticks assert `counterValue(..., outcome("cursor_invalid")) == 2` and no `account_id`/`user_id` key.
   - The repeated-token guard (not the duplicate-symbol guard) fires, because the token guards run before the merge (D-9). The hardening row in item 8 pins the text.
7. This step is staged in two passes and lands as one commit:
   - Pass 1, before Step 3 is applied: write items 1-6 (uncommitted), run
     `GOWORK=off go test ./internal/service/ -run 'TestReconcileTick_358' -count=1 -v`, and confirm items
     2-6 FAIL. Capture that output as the RED evidence.
   - Then Step 3 lands as its own commit, with the pass-1 test edits still uncommitted in the working tree.
   - Pass 2: add item 8, run the Verification below, and commit the whole file as the Step 4 commit.
8. **Direct-helper hardening table** (after Step 3; D-12, D-13), table test
   `TestListAccountPlatformPositions_358_Guards` (guard rows plus the happy row) and table test
   `TestReconcilePositionSkipCause_358` (the mapper-only rows). Call
   `svc.listAccountPlatformPositions(context.Background(), "acc-1", reconcile358Owner, commonv1.TradingMode_TRADING_MODE_PAPER, time.Second)`
   against the paging fake. Each row asserts `got == nil`, the exact `err.Error()` (or the stated
   check), and `reconcilePositionSkipCause(err)`:

   | Row | Fake | Error assertion | `reconcilePositionSkipCause` |
   |---|---|---|---|
   | repeated token | `ignoreToken` | `page 2: repeated next_page_token "p2"` | `cursor_invalid` |
   | empty page with token | page 2 empty with next `"p3"` | `page 2: empty page with next_page_token "p3"` | `cursor_invalid` |
   | duplicate symbol | page 2 repeats `SYM500` under next `""` | `page 2: duplicate symbol "SYM500"` | `cursor_invalid` |
   | RPC error | page 2 `codes.Unavailable` | `status.Code(err) == codes.Unavailable` and the text starts with `page 2: list positions:` (O-14) | `rpc_error` |

   Add a happy row: a 2-page drain returns a 501-entry map with SYM501 = 10, and every recorded
   `PageSize == reconcilePositionsPageSize` (D-6 shared const).

   Add mapper-only rows (operator r6; one per deadline form, O-24):
   - `fmt.Errorf("page 2: list positions: %w", context.DeadlineExceeded)` → `deadline`;
   - `fmt.Errorf("page 2: list positions: %w", status.Error(codes.DeadlineExceeded, "x"))` → `deadline`;
   - `fmt.Errorf("page 2: list positions: %w", context.Canceled)` → `rpc_error`.
9. Re-run the other `reconcileTick` suites unchanged (`trading_ibkr_auth_test.go:335`,
   `trading_telemetry_test.go:249`, `:550`). Their default single-page response must stay green
   (recon.md:80).

**Verification**:
```bash
( cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/ -run 'TestReconcileTick|TestListAccountPlatformPositions|TestReconcilePositionSkipCause|TestAllowlist' -count=1 -race -v 2>&1 | grep -E "^(--- |ok|FAIL)" )
( cd services/xstockstrat-trading && export GOWORK=off && COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:" )
( cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod )
( grep -n "t.Parallel" services/xstockstrat-trading/internal/service/trading_reconciliation_test.go )
```
- All 358 tests pass under `-race`. The `-run` filter selects them by the names in items 2-6 and 8:
  `TestReconcileTick_358_*`, `TestListAccountPlatformPositions_358_Guards` and
  `TestReconcilePositionSkipCause_358`. The output must list each of the seven by name.
- The coverage total is ≥ 40%. New logic is in the excluded `service` and `telemetry` packages, so the
  threshold is unchanged by this feature; the 358 unit tests are the verification.
- Lint exits 0.
- The `t.Parallel` grep prints nothing.

---

### Step 5 — docs: Document paging and the skip counter in the trading reconciliation docs

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/docs/reconciliation.md` — modify
- `services/xstockstrat-trading/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-trading/docs/reconciliation.md:56-57`: "A broker position that disagrees with `xstockstrat-portfolio`'s `ListPositions` projection is not immediately a foreign position" (the position-side paragraph).
- `reconciliation.md:98`: "- Instruments: `trading.flatten.outcome{outcome}`, … `trading.escalation.systemic` (unlabelled)." (feature 294 list).
- `services/xstockstrat-trading/CLAUDE.md:221-223`: `## Position & Balance Sync Observability`, a pointer line naming `reconciliation.md`. The service CLAUDE.md has no section titled exactly "Observability" (D-24).
- `packages/otel/produced-signals.tsv`: no row is needed. `scripts/check-otel-produced-signals.py:2-9` enforces the registry only for series that an alert or dashboard queries, and none is added (D-24).

**Lands with**: —

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. `reconciliation.md` after line 57's sentence: add one sentence. The `ListPositions` projection is read
   page by page (500 per page, each page under its own `broker.timeout_ms` deadline). Any page error,
   deadline, empty page with a token, repeated `next_page_token` or duplicate symbol skips that account's
   position-side check for the tick (no candidate, no halt, not systemic), and the account is re-checked
   next tick (feature 358).
2. `reconciliation.md:98`: append `trading.reconciliation.position_check_skipped{outcome rpc_error|deadline|cursor_invalid}`
   (feature 358) to the instrument list, with one sentence:
   - one increment means one account's position check was skipped for one tick;
   - a sustained non-zero rate means that account is going unreconciled;
   - a deploy/shutdown produces a burst of `rpc_error` (cancelled tick ctx), so any alert needs a rate or
     for-duration window, and must bring its `packages/otel/produced-signals.tsv` row.
3. `CLAUDE.md:223`: extend the pointer line to name the counter, e.g. "…instruments (incl. the feature-358
   `trading.reconciliation.position_check_skipped` skip counter) and load-bearing logs…".

**Verification**:
```bash
grep -n "position_check_skipped" services/xstockstrat-trading/docs/reconciliation.md services/xstockstrat-trading/CLAUDE.md
grep -n "page by page\|next_page_token" services/xstockstrat-trading/docs/reconciliation.md
```
The counter appears in both files, and the paging sentence is present.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
