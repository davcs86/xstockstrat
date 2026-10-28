# Implementation Spec: fix-portfolio-snapshot-surface

**Status**: `pending`
**Created**: 2026-10-22
**Feature**: `docs/roadmap/features/264-fix-portfolio-snapshot-surface/feature.md`
**Total Steps**: 10
**Feature Branch**: `feature/fix-portfolio-snapshot-surface`

---

## Execution Summary

This spec implements design.md § Chosen Approach as approved at the round-2 gate (operator, 2026-10-22). The order
is producer first, then consumer, then the dead key, then docs:

1. **Steps 1-2 (D-24 producer).** `broadcastSnapshot` fans out only to subscribers whose stored `userID` equals the
   snapshot owner. The match is strict and fail-closed.
2. **Steps 3-4 (D-24 consumer).** Both `StreamPortfolioUpdates` paths share an unexported `streamSnapshots` helper
   that takes an unexported `snapshotHub` seam. The gRPC adapter rejects an empty caller before it subscribes.
3. **Steps 5-8 (D-12, branch b).** Delete the zero-caller `StartSnapshotWriter`. Reserve config migration 034 in
   merge-order.md, add `034_retire_portfolio_snapshot_interval.{up,down}.sql`, and add the @AC-5 static scan.
4. **Step 9.** Docs drift and the context-constitution teardown.
5. **Step 10.** The two-sided migration-number gate before merge, plus the dev-smoke `ListKeys` check.

No proto change. No portfolio migration. No new config key; one is retired. No new env var or port. Header
propagation is unchanged: no new outbound call is added. `InsertSnapshot` and `emitEvent` stay on the fill `ctx`
(`portfolio_service.go:376`), so `x-trace-id` propagates (C-03; operator decision 2026-10-21).

**Consumer surface (C-14): none — internal/platform-only** (product-spec.md § Consumer Surface(s)). No UI segment or
Agent tool subscribes to `StreamPortfolioUpdates`. This is a recorded decision, not an omission.

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` A snapshot stream subscriber receives only its own snapshots | Step 2 (producer) + Step 4 case 4b (gRPC adapter wiring) |
| `@AC-2` A snapshot stream with no caller identity is rejected on the gRPC path | Step 4 |
| `@AC-3` The Connect path also isolates subscribers | Step 2 (producer filter) + Step 4 (Connect helper wiring) |
| `@AC-5` portfolio.snapshot.interval_minutes is retired | Step 8 (static scan) + Step 10 (dev-smoke `ListKeys`) |
| `@AC-6` A snapshot stream with no caller identity stays rejected on the Connect path | Step 4 |

`@AC-4` (FR-4 branch a) is **deleted** from `acceptance.feature`. The operator signed this off at the round-2 design
gate (context.md, Session 2026-10-22 — sdd-design approved). `@AC-1` and `@AC-5` were reworded at spec time; see
context.md, Session 2026-10-22 — sdd-spec.

## Step Dependencies

- Step 2 [test] covers Step 1 [service]. **RED capture point:** apply Step 1 Part A only (new subscriber struct,
  new signature, every call site updated, fan-out loop still unfiltered). Run Step 2; stream B receives u-1's
  snapshot, so the test fails. Then apply Part B (the owner skip) for GREEN.
- Step 3 requires Step 1: the helper calls `Subscribe(id, userID)`.
- Step 4 [test] covers Step 3 [service]. **RED capture point:** apply Step 3 Part A only (interface, `hub` field,
  helper, both paths refactored onto it, gRPC check **not** added). Run Step 4. @AC-2 fails: the error is not
  `InvalidArgument` and the fake records one `Subscribe`. Then apply Part B (the gRPC empty-caller check) for GREEN.
  @AC-6 is `@non-regression`: red N/A, it passes on both trees by design. The @AC-3 handler half is a wiring
  characterization (red N/A); the RED for @AC-3 isolation is captured in Step 2.
- Step 5 [service] is a dead-code deletion with no behavior change (tdd-gate escape: red N/A). Its paired test is
  Step 8. Step 5 must land **before** Step 7, so the key is never retired while a reader still exists in source.
- Step 7 requires Step 6: the 034 reservation is recorded in merge-order.md before the file is created (C-07;
  fails.md:613, :2909).
- Step 8 [test] covers Step 7 [migration] and Step 5 [service]. **RED capture point:** write and run Step 8 before
  Step 7's files exist. The highest-numbered match is then `002_config_environment.up.sql`, an INSERT, so check (ii)
  fails. GREEN comes after Step 7.
- Step 9 requires Steps 1-8: the docs describe the landed behavior.
- Step 10 is last. It runs immediately before the integration PR merges and again after the deploy.
- **Same-file overlap (rebase only).** Features 242, 251, 256 and 257 also edit `portfolio_service.go`
  (insights.md, feature 125). Re-read `broadcastSnapshot`, `Subscribe`/`Unsubscribe` and both
  `StreamPortfolioUpdates` bodies at execute time; cited line numbers may drift.
  - 242's portfolio scope is `checkRiskLimits`/`emitRiskAlert` (`:964-1018`, its Step 9) plus new tests in
    `portfolio_quote_deadline_test.go` (its Step 10). Both are disjoint from this feature's regions.
  - All cited lines were re-verified on 2026-10-22 against `origin/main-dev`, which is post-231 and has no
    portfolio diff vs this branch. `Subscribe("t")` is at `:321/:396/:424` and `broadcastSnapshot` at `:328/:402/:429`.
- **Migration ordering.** 031 is claimed by 243. 032 is double-claimed by 244
  (`244-fix-python-config-stored-zero/implementation-spec.md:1067`) and 248
  (`248-fix-ledger-trimmed-notify-payload/implementation-spec.md:133`). 264 is sequenced after all three (Step 6).
  No no-gap rule applies. `origin/main-dev` config migrations already skip `024`, and golang-migrate needs only
  ascending order. So 034 stays 034 even if 033 is never used; only a lower number landing after it is a hazard.

---

### Step 1 — service: Owner-scope the snapshot subscriber map and fan-out (fail-closed)

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify
- `services/xstockstrat-portfolio/internal/handler/portfolio_handler.go` — modify (two `Subscribe` call sites only)
- `services/xstockstrat-portfolio/internal/service/portfolio_quote_deadline_test.go` — modify (call sites only)

**Reviewers**: `xstockstrat-portfolio` owner — position snapshot consistency, concurrent write safety; Security — cross-tenant isolation (a subscriber sees only its own `x-user-id`)

**Codebase Evidence**:
- `grep -n "subs " portfolio_service.go` → `:54` `subs map[string]chan *portfoliov1.PortfolioSnapshot` (guarded by
  `s.mu`, `:53`). Constructor: `:155` `subs: make(map[string]chan *portfoliov1.PortfolioSnapshot),`.
- `:875` `func (s *PortfolioService) Subscribe(id string) chan *portfoliov1.PortfolioSnapshot` (buffer 32).
  `:884` `Unsubscribe(id string)` deletes the entry and `close(ch)`.
- `:908` `broadcastSnapshot(ctx, userID, mode)`:
  - the unpriced skip is at `:915-919`;
  - `snap.PortfolioId: userID` is at `:925`;
  - `InsertSnapshot` and `emitEvent` are at `:932-935`;
  - the unfiltered loop `for _, ch := range s.subs {` is at `:937`, under `s.mu.RLock()` (`:936`).
- Live caller: `:376` `s.broadcastSnapshot(ctx, fill.UserID, mode)` (fill `ctx`; C-03).
- **Fill-state handling unchanged (B2b).** `ConsumeOrderFills` (`:167`) feeds every `order.filled` ledger event to
  `processOrderFill` (`:264`), which has no PARTIALLY_FILLED vs FILLED branch (no `FILLED`/`PARTIAL` match in
  `portfolio_service.go`). It reaches `:376` once per processed fill, partial or final. This feature changes only who
  receives that snapshot, not when one is produced (product-spec: fill semantics unaffected).
- Pattern to REUSE (recon.md): `services/xstockstrat-trading/internal/service/trading.go:344-357`:
  ```go
  type orderSubscriber struct {
  	ch     chan *tradingv1.Order
  	userID string
  }
  ```
  Also `SubscribeOrderUpdates(id, userID string)` (stores `orderSubscriber{ch: ch, userID: userID}`) and the
  `broadcastOrder` skip at `:390`. Portfolio deliberately **drops** trading's `sub.userID != "" &&` empty-means-all
  arm (design.md § Rejected Alternatives).
- Call sites, from `grep -rn "Subscribe(\|subs:" --include=*.go services/xstockstrat-portfolio`:
  - `internal/handler/portfolio_handler.go:120` `ch := h.svc.Subscribe(subID)` (Connect; `userID` is in scope from `:115`);
  - `:294` `ch := a.h.svc.Subscribe(subID)` (gRPC; the adapter signature is at `:292`, and the id comes from
    `streamUserID(grpcStream.Context())` inside the `Sprintf` at `:293`);
  - `internal/service/portfolio_quote_deadline_test.go:106` (literal `subs: map[string]chan *portfoliov1.PortfolioSnapshot{}`
    inside `newQuoteSvc`);
  - `:321`, `:396`, `:424` `svc.Subscribe("t")`. Each test then calls `svc.broadcastSnapshot(ctxWithUser(t, "u1"), "u1", …)`
    (`:328`, `:402`, `:429`).
- **Correction to design.md:** `offline_account_pnl_test.go:320` calls `svc.broadcastSnapshot(...)` with no
  subscriber. It builds its service through `acctSvc` → `newQuoteSvc` (`offline_account_pnl_test.go:94-96`), so it
  needs **no edit**.

**TDD**: `red-green required`. Use the two-part RED capture in § Step Dependencies.

**Covers**: —

**Instructions**:
*Part A — signature, struct and call sites. The fan-out loop is not filtered yet.*
1. In `portfolio_service.go`, add an unexported type next to `Subscribe`:
   ```go
   type snapshotSubscriber struct {
   	ch     chan *portfoliov1.PortfolioSnapshot
   	userID string
   }
   ```
2. Change the field at `:54` to `subs map[string]snapshotSubscriber` and the constructor at `:155` to
   `make(map[string]snapshotSubscriber)`.
3. Replace `Subscribe(id string)` with `Subscribe(id, userID string) chan *portfoliov1.PortfolioSnapshot`. It
   stores `snapshotSubscriber{ch: ch, userID: userID}` and keeps buffer 32.
4. `Unsubscribe(id string)` keeps its signature and closes `sub.ch`.
5. Update the loop at `:937` to range over `sub` and send on `sub.ch`. Do not filter yet.
6. In `portfolio_handler.go`:
   - Connect `:120` → `h.svc.Subscribe(subID, userID)`.
   - gRPC: hoist `userID := streamUserID(grpcStream.Context())` above the `Sprintf` at `:293`, use it there, and
     call `a.h.svc.Subscribe(subID, userID)`. Step 3 replaces both bodies; this is only the minimum needed to compile.
7. In `portfolio_quote_deadline_test.go`:
   - `:106` → `subs: map[string]snapshotSubscriber{}`;
   - `:321`, `:396`, `:424` → `svc.Subscribe("t", "u1")`, matching each test's `broadcastSnapshot(..., "u1", ...)`
     owner. Otherwise the owner filter drops their updates and the feature-231 @AC-2/@AC-8 tests break.

**STOP — RED capture (mandatory before Part B).** With Part A only applied, write Step 2's test file and run
`GOWORK=off go test ./internal/service/ -run 'TestBroadcastSnapshot_' -count=1 -v`. It must build and FAIL (stream
`b` / `anon` receives u-1's snapshot). Paste the failing output into context.md as the Step 2 RED evidence, then
apply Part B. Do not apply Parts A and B in one edit: that loses the RED.

*Part B — the fail-closed owner skip.*

8. In `broadcastSnapshot`'s loop, add `if sub.userID != userID { continue }` before the non-blocking send. This is a
   strict match: a subscriber with `userID == ""` receives nothing.
9. Leave valuation, the unpriced skip (`:915-919`), `InsertSnapshot` and `emitEvent` (`:932-935`) **unchanged and
   before the loop**, on the caller's `ctx`. Do not add a `context.Background()`/`WithoutCancel` here: the call is
   already request-derived from the fill `ctx`. This preserves feature-231 @AC-2/@AC-8: one emit and one update per
   computed snapshot, and a skip produces no emit and no update.
10. Update the `Subscribe` doc comment to say it is owner-scoped (≤2 lines, constraint not mechanism):
    `// Subscribe registers a streaming channel that receives only userID's snapshots; an empty userID receives none.`

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off go vet ./...
grep -n "snapshotSubscriber\|sub.userID != userID" internal/service/portfolio_service.go   # struct, map, skip present
grep -rn "Subscribe(\"t\")\|Subscribe(subID)$" --include=*.go . ; test $? -eq 1            # no old-signature call left
```

---

### Step 2 — test: Owner isolation at the producer (@AC-1, @AC-3 producer half)

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_snapshot_scope_test.go` — create

**Reviewers**: `xstockstrat-portfolio` owner — position snapshot consistency; Security — cross-tenant isolation

**Codebase Evidence**:
- Harness to REUSE: `newQuoteSvc(t, stub, timeoutMs)` at `internal/service/portfolio_quote_deadline_test.go:93`
  (`package service`, pgxmock, `fakeLedger`).
- Control case to copy: `:316-329` (`"priced control"` uses `quote("AAPL", 150)`):
  - `posRow(mock.NewRows(positionCols), "AAPL", "acc-1", 1, 100, 0)`;
  - `ExpectExec(`INSERT INTO portfolio.snapshots`).WithArgs(anyArgs(7)...)`;
  - `broadcastSnapshot(ctxWithUser(t, "u1"), "u1", mode)`.
- Helpers:
  - `quote(sym, mid)` at `portfolio_quote_deadline_test.go:88`;
  - `posRow` at `:84`;
  - `anyArgs` and `positionCols` at `portfolio_fill_errors_test.go:36,45`;
  - `ctxWithUser` at `watchlist_service_test.go:280`;
  - `testdata.Aapl` in `internal/testdata/marks.go` (already used by `offline_account_pnl_test.go`).
- Test shape: `TestBroadcastOrder_ScopesToSubscriberUser` at
  `services/xstockstrat-trading/internal/service/trading_ownership_test.go:111`, which uses per-subscriber
  `select { case <-ch: … default: }` assertions.

**TDD**: `red-green required`. RED at Step 1 Part A: the u-2 subscriber receives u-1's snapshot. GREEN at Part B.

**Covers**: `AC-1, AC-3`

**Instructions**:
1. Add `TestBroadcastSnapshot_AC1_OnlyOwnerReceives` in `package service`:
   - `svc, mock, ledger := newQuoteSvc(t, &stubMarketData{quotes: []*marketdatav1.Quote{quote(testdata.Aapl, 100)}}, 0)`.
   - Subscribe `a := svc.Subscribe("a", "u-1")` and `b := svc.Subscribe("b", "u-2")`. These are the registrations the
     gRPC (A) and Connect (B) stream paths make, since both call `Subscribe(subID, callerID)`.
   - Expect one `FROM portfolio.positions` query returning 10 `testdata.Aapl` @ avg 100 and one
     `INSERT INTO portfolio.snapshots`.
   - Call `svc.broadcastSnapshot(ctxWithUser(t, "u-1"), "u-1", commonv1.TradingMode_TRADING_MODE_PAPER)`. This is
     the reworded @AC-1 When step: "a snapshot is broadcast for user u-1".
   - Assert:
     - `a` yields exactly one snapshot with `PortfolioId == "u-1"` and `Equity == 1000`;
     - `b` is empty (`len(b) == 0`). The send is synchronous and non-blocking inside `broadcastSnapshot`, so no
       wait is needed;
     - `ledger.calls == 1`, so the emit is unaffected by the filter (feature-231 @AC-2 preserved);
     - `mock.ExpectationsWereMet()`.
2. Add `TestBroadcastSnapshot_EmptyOwnerSubscriberReceivesNothing` (fail-closed, @AC-1/@AC-3):
   `svc.Subscribe("anon", "")` receives nothing for a `u-1` broadcast. Same mocks as case 1.
3. C-13: every literal is a single-consumer scenario value and stays inline. Reuse `testdata.Aapl`; add no new
   `internal/testdata/` symbol.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/service/ -run 'TestBroadcastSnapshot_' -race -count=1 -v
cd services/xstockstrat-portfolio && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # confirm ≥ 40%
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -rn "func TestBroadcastSnapshot_AC1_OnlyOwnerReceives" --include="*_test.go" services/xstockstrat-portfolio   # exactly 1 declaration (C-13)
```
New logic is in `internal/service`, a package excluded from CI coverage measurement, so no coverage threshold
applies to it. The suite-wide total must still meet the threshold.

---

### Step 3 — service: Shared `streamSnapshots` helper, `snapshotHub` seam, gRPC empty-caller rejection

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/handler/portfolio_handler.go` — modify

**Reviewers**: `xstockstrat-portfolio` owner — stream correctness; Security — fail-closed caller identity on `StreamPortfolioUpdates`

**Codebase Evidence**:
- `PortfolioHandler` struct at `:43-46`: `UnimplementedPortfolioServiceHandler` plus `svc *service.PortfolioService`.
  `NewPortfolioHandler` at `:49-51` returns `&PortfolioHandler{svc: svc}`. `cmd/server/main.go:78` calls
  `handler.NewPortfolioHandler(svc)`.
- `streamUserID(ctx)` at `:28-38` reads `x-user-id` from incoming metadata and returns `""` if it is absent.
- Connect `StreamPortfolioUpdates` (`:113-138`):
  - empty-caller check `:115-118` → `connect.NewError(connect.CodeInvalidArgument, errorf("user_id required"))`;
  - `subID := fmt.Sprintf("portfolio-%s-%p", userID, stream)` at `:119`;
  - the subscribe / defer-unsubscribe / select loop at `:120-138`, with the TradingMode filter
    `req.Msg.TradingMode != 0 && snap.TradingMode != req.Msg.TradingMode` at `:129`.
- gRPC `(a *grpcPortfolioAdapter) StreamPortfolioUpdates` (signature `:292`, body through `:311`): no empty-caller check, the same loop shape,
  filter `req.TradingMode` at `:302`, and `grpcStream.Context()` used for `Done()`/`Err()`.
- Only the gRPC adapter is mounted: `cmd/server/main.go:101` `portfoliov1.RegisterPortfolioServiceServer(grpcServer, hdl.GRPCHandler())`.
- Imports already present: `codes`, `status`, `fmt`, `connect` (`:3-18`). `commonv1` is **not** imported. Its path
  is `commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"` (`internal/service/portfolio_service.go:26`).
- Body `user_id` is `[deprecated = true]` and "body value ignored" (`packages/proto/portfolio/v1/portfolio.proto:215`).
  It must stay unread.

**TDD**: `red-green required`. Use the two-part RED capture in § Step Dependencies.

**Covers**: —

**Instructions**:
*Part A — the seam and the helper, with no behavior change.*
1. Add the unexported consumer-side interface:
   ```go
   type snapshotHub interface {
   	Subscribe(id, userID string) chan *portfoliov1.PortfolioSnapshot
   	Unsubscribe(id string)
   }
   ```
   `*service.PortfolioService` satisfies it after Step 1. Add the compile-time assertion
   `var _ snapshotHub = (*service.PortfolioService)(nil)`.
2. Add an unexported field `hub snapshotHub` to `PortfolioHandler` and set it in `NewPortfolioHandler`:
   `&PortfolioHandler{svc: svc, hub: svc}`. This is how the Step 4 fake reaches the real entry points. It adds no
   exported symbol (C-18), and design.md rejected a `SubscriberCount()` export.
3. Add the helper. It holds the subscribe / defer-unsubscribe / select loop and the unchanged TradingMode filter
   (`mode != 0 && snap.TradingMode != mode` → `continue`):
   ```go
   func streamSnapshots(ctx context.Context, hub snapshotHub, userID, subID string, mode commonv1.TradingMode, send func(*portfoliov1.PortfolioSnapshot) error) error
   ```
   It returns `nil` on channel close, `ctx.Err()` on `ctx.Done()`, and the `send` error on a send failure. Add the
   `commonv1` import.
4. Connect: keep `:115-118` unchanged. Then build `subID` as today and
   `return streamSnapshots(ctx, h.hub, userID, subID, req.Msg.TradingMode, stream.Send)`.
5. gRPC: `ctx := grpcStream.Context(); userID := streamUserID(ctx)`. Build
   `subID := fmt.Sprintf("portfolio-%s-%p", userID, grpcStream)`, then
   `return streamSnapshots(ctx, a.h.hub, userID, subID, req.TradingMode, grpcStream.Send)`. **Do not add the check
   yet.** This is the RED capture point.

**STOP — RED capture (mandatory before Part B).** With Part A only applied, write Step 4's test file and run
`GOWORK=off go test ./internal/handler/ -run 'TestStreamPortfolioUpdates_GRPC_AC2' -count=1 -v`. It must build and
FAIL (no `InvalidArgument`; one recorded `Subscribe`). Paste the failing output into context.md as the Step 4 RED
evidence, then apply Part B.

*Part B — fail closed on the gRPC path.*

6. In the gRPC adapter, immediately after `userID := streamUserID(ctx)` and **before** `subID` is built or anything
   subscribes:
   `if userID == "" { return status.Error(codes.InvalidArgument, "user_id required") }`.
   This mirrors the Connect message at `:117`, so an anonymous stream is never registered.
7. Leave `req.UserId` unread on both paths. Do not add a defense-in-depth `snap.PortfolioId` check in the helper
   (rejected in design.md as DRY/YAGNI).

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off go vet ./...
grep -n "type snapshotHub interface\|func streamSnapshots\|hub: svc\|codes.InvalidArgument, \"user_id required\"" internal/handler/portfolio_handler.go
grep -c "case snap, ok := <-ch" internal/handler/portfolio_handler.go   # 1: the loop exists only in streamSnapshots
grep -c "streamSnapshots(ctx, h.hub, userID, subID, req.Msg.TradingMode, stream.Send)" internal/handler/portfolio_handler.go   # 1: Connect wiring (not drivable by a test; see Step 4)
```

---

### Step 4 — test: Stream handler identity gate and helper wiring (@AC-2, @AC-6, @AC-3 Connect half)

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/handler/portfolio_stream_test.go` — create

**Reviewers**: `xstockstrat-portfolio` owner — stream correctness; Security — fail-closed caller identity

**Codebase Evidence**:
- `ctxNoHeader()` and `ctxWithHeader(userID)` at `internal/handler/portfolio_identity_test.go:18-25`, the same
  package. The nil-service, header-gate test shape is at `:27-35`, including the
  `//nolint:staticcheck` deprecated-body pattern at `:29`.
- The generated server-stream interface is `portfoliov1.PortfolioService_StreamPortfolioUpdatesServer` (used at
  `portfolio_handler.go:292`). It embeds `grpc.ServerStream` and adds `Send(*PortfolioSnapshot) error`.
- No `StreamPortfolioUpdates` handler test exists (recon.md § Risks: **Not found**). These are the first fakes for
  this RPC.

**TDD**: `red-green required` for @AC-2. RED at Step 3 Part A: no `InvalidArgument`, and one `Subscribe` call is
recorded. @AC-6 is red N/A (`@non-regression`, by design). The @AC-3 wiring half is red N/A (characterization; its
isolation RED is in Step 2).

**Covers**: `AC-1, AC-2, AC-3, AC-6`

**Instructions**:
1. **Test-local fakes** (C-13: a single consumer, so keep them inline in this file and add no `internal/testdata/`
   home).
   - `fakeHub`:
     - fields: a `sync.Mutex`, `subs map[string]fakeSub{ch; userID}`, `calls []fakeSub` recording every
       `Subscribe(id, userID)`, `unsubscribed []string`, and `subscribed chan string` (buffered) signalled on each
       `Subscribe`;
     - `push(owner string, snap)` delivers only to subs whose recorded `userID == owner`. This mirrors the Step 1
       producer contract.
   - `fakeGRPCStream`: embeds `grpc.ServerStream` and overrides `Context()` (returns a test-supplied ctx) and
     `Send(*portfoliov1.PortfolioSnapshot) error` (records).
2. **`TestStreamPortfolioUpdates_GRPC_AC2_RejectsEmptyCaller`:**
   - Build `a := (&PortfolioHandler{hub: hub}).GRPCHandler()`.
   - Use a stream ctx = `context.WithTimeout(ctxNoHeader(), 200*time.Millisecond)`. The timeout keeps the RED run
     from hanging: pre-fix, the call subscribes and blocks until the deadline.
   - Call `a.StreamPortfolioUpdates(&portfoliov1.StreamPortfolioUpdatesRequest{}, stream)`.
   - Assert `status.Code(err) == codes.InvalidArgument` and `len(hub.calls) == 0`, i.e. never registered.
3. **`TestStreamPortfolioUpdates_Connect_AC6_RejectsEmptyCaller`:**
   - `h := &PortfolioHandler{hub: hub}`.
   - `//nolint:staticcheck` set the deprecated body `UserId: "u-1"` to prove it is ignored.
   - `err := h.StreamPortfolioUpdates(ctxNoHeader(), connect.NewRequest(req), nil)`. A nil stream is safe because
     the check returns first.
   - Assert `connect.CodeOf(err) == connect.CodeInvalidArgument` and `len(hub.calls) == 0`.
4. **`TestStreamSnapshots_AC3_DeliversOnlyToCallersStream`.** Run the helper exactly as the Connect path calls it.
   - Start two goroutines, `streamSnapshots(ctxA, hub, "u-1", "a", 0, sendA)` and
     `streamSnapshots(ctxB, hub, "u-2", "b", 0, sendB)`. `sendX` pushes onto a buffered result channel.
   - Wait for two `hub.subscribed` signals (bounded at 1s), then assert the recorded `(id, userID)` pairs are
     `{a: u-1, b: u-2}`.
   - `hub.push("u-1", &portfoliov1.PortfolioSnapshot{PortfolioId: "u-1"})`.
   - A must receive `PortfolioId == "u-1"` within 1s. B must receive nothing in
     `select { case <-resB: t.Fatal; case <-time.After(100 * time.Millisecond): }`.
   - Cancel both ctxs. Assert each helper returns `context.Canceled` and `hub.unsubscribed` contains `a` and `b`.
4b. **`TestStreamPortfolioUpdates_GRPC_AC1_WiresCallerIdentity`** (end to end through the mounted adapter, so a
   wiring slip in `a.h.hub` / `Subscribe(subID, userID)` fails a test):
   - `a := (&PortfolioHandler{hub: hub}).GRPCHandler()`. Two goroutines call `a.StreamPortfolioUpdates(&…Request{}, sA)`
     and `(…, sB)`, where `sA`/`sB` are `fakeGRPCStream`s whose `Context()` is `context.WithCancel(ctxWithHeader("u-1"))`
     and `(ctxWithHeader("u-2"))`.
   - Wait for two `hub.subscribed` signals (bounded 1s); assert the recorded userIDs are exactly `{u-1, u-2}`.
   - `hub.push("u-1", …)`: `sA` records one snapshot with `PortfolioId == "u-1"` within 1s; `sB` records none within
     100ms. Cancel both; each call returns `context.Canceled` and both subIDs are unsubscribed.
   - **The Connect arm cannot be driven the same way.** `connect.ServerStream` has no exported constructor
     (`go doc connectrpc.com/connect.ServerStream`, v1.16.2), and the Connect route is unmounted (`main.go:101`). Its
     wiring is pinned by the Step 3 grep for `streamSnapshots(ctx, h.hub, userID, subID, req.Msg.TradingMode, stream.Send)`,
     plus case 4, which runs the helper exactly as that line calls it.
5. **`TestStreamSnapshots_TradingModeFilterPreserved`** (non-regression for the moved filter):
   - with mode `TRADING_MODE_PAPER`, a pushed `TRADING_MODE_LIVE` snapshot is not sent;
   - a following `TRADING_MODE_PAPER` snapshot is sent.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/handler/ -run 'TestStreamPortfolioUpdates_|TestStreamSnapshots_' -race -count=1 -v
cd services/xstockstrat-portfolio && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # confirm ≥ 40%
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -rn "type fakeHub struct\|type fakeGRPCStream struct" --include="*_test.go" services/xstockstrat-portfolio   # 1 declaration each (C-13)
```
New logic is in `internal/handler`, a package excluded from CI coverage measurement, so no coverage threshold
applies to it. The suite-wide total must still meet the threshold.

---

### Step 5 — service: Delete the zero-caller `StartSnapshotWriter`

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify

**Reviewers**: `xstockstrat-portfolio` owner — position snapshot consistency (no live path loses snapshots)

**Codebase Evidence**:
- `grep -rn StartSnapshotWriter --include=*.go services/xstockstrat-portfolio` finds only the definition: comment
  `:893`, func `:894-906`.
- `cmd/server/main.go:71-76` starts only `ConsumeOrderFills`, `ConsumePositionSyncs`, `ConsumeBalanceSyncs`,
  `ConsumeBracketUpdates`, `ConsumeAccountDeregistrations` and `HydrateStops`.
- The only reader of `portfolio.snapshot.interval_minutes` is `:895`. `s.cfg` stays in use (`:492`, `:965-966`),
  and `"time"` stays imported (11 other `time.` uses), so no import or field becomes orphaned.

**TDD**: `N/A (red N/A — dead-code deletion with no caller, no behavior change; tdd-gate escape stated)`. The
characterization is the full suite staying green. The paired test is Step 8.

**Covers**: —

**Instructions**:
1. Delete the `StartSnapshotWriter` doc comment and function (`:893-906`).
2. Remove nothing else. `broadcastSnapshot` stays: it is the live per-fill path.

**Verification**:
```bash
grep -rn "StartSnapshotWriter\|snapshot.interval_minutes" --include=*.go services/ ; test $? -eq 1
cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off go test ./... -race -count=1 && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 6 — docs: Reserve config migration 034 and sequence 264 in merge-order.md

**Status**: `pending`
**Service**: `docs/roadmap/features/`
**Files**:
- `docs/roadmap/features/merge-order.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `git ls-tree --name-only origin/main-dev services/xstockstrat-config/migrations/` shows that the tip is
  `030_marketdata_edgar_snapshot_keys`. `git log --remotes --name-only -- services/xstockstrat-config/migrations/`
  (re-run 2026-10-28) shows `031_heal_indicators_sandbox_keys_full_dotted` committed on
  `origin/feature/fix-sandbox-seed-keys` (d8b7a8df) and `032_analysis_zero_trap_descriptions` committed on
  `origin/feature/fix-python-config-stored-zero` (d2002841). No `033_` or `034_` file exists on any remote ref.
  Feature 277's context.md mentions a 033 claim, but 277 is `demoted/canceled`, so it is moot.
- Claims:
  - `031_heal_indicators_sandbox_keys_full_dotted` belongs to 243 (`243-fix-sandbox-seed-keys/design.md:13`);
  - `032_analysis_zero_trap_descriptions` belongs to 244 (`implementation-spec.md:1067`);
  - `032_ledger_stream_resolve_timeout` belongs to 248 (`implementation-spec.md:133`).

  None of the eight batch peers' branches (`git grep` on each `origin/feature/<peer>`) claims a config migration.
- Pre-assignment precedent: the "Config-service seed-migration NNN pre-assignment" blockquote at `merge-order.md:213`.
  The table rows use the form `| <later> | <earlier> | **reason** | Resolved |` (e.g. the 223↔217 row at `:74`).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Add a table row to the main table, after the `fix-after-hours-positions-priced` (231) row at `:76`:
   - Column 1: `fix-portfolio-snapshot-surface` (264).
   - Column 2: `fix-sandbox-seed-keys` (243), `fix-python-config-stored-zero` (244), `fix-ledger-trimmed-notify-payload` (248).
   - Reason: **config migration-NNN ordering**. 264 reserves `034_retire_portfolio_snapshot_interval`; 243 holds 031;
     the 244/248 double claim on 032 must resolve to 032 and 033. golang-migrate skips a lower version that lands
     after a higher one. 264 merges after all three, and its Step 10 two-sided gate is re-run before merge.
   - Resolved: `No`.
2. Do not edit the 244/248 rows or claims. That collision is routed outside this feature (context.md,
   2026-10-21 sdd-review).

**Verification**:
```bash
grep -n "034_retire_portfolio_snapshot_interval" docs/roadmap/features/merge-order.md   # exactly one row
```

---

### Step 7 — migration: `034_retire_portfolio_snapshot_interval.{up,down}.sql`

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/034_retire_portfolio_snapshot_interval.up.sql` — create
- `services/xstockstrat-config/migrations/034_retire_portfolio_snapshot_interval.down.sql` — create

**Reviewers**: DBA — migration NNN numbering (no conflicts), up+down pair, run order; `xstockstrat-config` owner — key naming, environment × global/per-user scoping. Key removal approval: config team + all consumers (`docs/runbooks/config-rollout.md:246`). The only consumer was the code deleted in Step 5.

**Codebase Evidence**:
- Pattern to REUSE: `020_remove_analysis_signal_source_weights.up.sql` (header `-- Migration:` / `-- Service:` /
  `-- Feature 161:`, then `DELETE FROM config.config_values WHERE namespace = 'analysis' AND key = 'signals.source_weights';`).
- `020_….down.sql`:
  - header plus the "NOTE: this hardcoded restore clobbers any live operator edit" comment;
  - column list `(namespace, key, value_type, value_data, is_secret, description, default_value, consuming_service, environment, user_id)`;
  - one row per environment, with `user_id` NULL;
  - `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;`.
- Seeds:
  - `001_config_tables.up.sql:68` `('portfolio', 'snapshot.interval_minutes', 'int', '5', 'Portfolio snapshot frequency', '5', 'xstockstrat-portfolio')`.
    Its environment is renamed `dev`→`staging` by `017_config_secrets_and_scoping.up.sql:38`
    (`UPDATE config.config_values SET environment = 'staging' WHERE environment = 'dev';`).
  - `002_config_environment.up.sql:69` `('portfolio', 'snapshot.interval_minutes', 'int', '1', 'Portfolio snapshot frequency (prod)', '1', 'xstockstrat-portfolio', 'production', 'all')`.
- Key form: `029_heal_config_keys_full_dotted.up.sql:24-28` rewrites `key` to `namespace || '.' || key`, so the
  rows are stored as `portfolio.snapshot.interval_minutes` (recon.md).
- Next free number: 034 (Step 6 evidence). Do not edit the applied 001/002/017/029 files (F-01).

**TDD**: `N/A (migration)`

**Covers**: —

**Instructions**:
0. **Pre-check (ordering).** Step 5 must already be committed. Run
   `grep -rn "snapshot.interval_minutes" --include=*.go services/ ; test $? -eq 1`. If a reader still exists, stop.
   The DELETE sends no pg_notify DELTA and writes no `config_audit` row (context.md, accepted trade-off), so a live
   reader would silently keep a stale value.
1. **`034_…up.sql`**:
   - Header: `-- Migration: 034_retire_portfolio_snapshot_interval.up.sql` / `-- Service: xstockstrat-config` /
     `-- Feature 264: …`. One or two lines saying the key's only reader (`StartSnapshotWriter`) was deleted with zero
     callers.
   - Body: `DELETE FROM config.config_values WHERE namespace = 'portfolio' AND key IN ('portfolio.snapshot.interval_minutes', 'snapshot.interval_minutes');`.
     This covers every environment and every `user_id`, and both stored key forms.
2. **`034_…down.sql`**: copy the 020 down layout literally (header, the clobber NOTE, column list including
   `is_secret`, `ON CONFLICT … DO NOTHING`). Restore exactly these two rows:
   - `('portfolio', 'portfolio.snapshot.interval_minutes', 'int', '5', FALSE, 'Portfolio snapshot frequency', '5', 'xstockstrat-portfolio', 'staging', NULL)`
   - `('portfolio', 'portfolio.snapshot.interval_minutes', 'int', '1', FALSE, 'Portfolio snapshot frequency (prod)', '1', 'xstockstrat-portfolio', 'production', NULL)`

   Add a one-line note that per-user overrides are not restored (accepted, as in 020).
3. Record nothing about audit rows in SQL. The DELETE writes no `config_audit` row and no pg_notify DELTA; that
   trade-off is recorded in context.md (design.md § Open Risks).

**Verification** (offline; no database):
```bash
ls services/xstockstrat-config/migrations/034_retire_portfolio_snapshot_interval.up.sql services/xstockstrat-config/migrations/034_retire_portfolio_snapshot_interval.down.sql
ls services/xstockstrat-config/migrations | grep -E '^03[1-9]_'   # only 034_* locally (031-033 belong to 243/244/248)
grep -n "DELETE FROM config.config_values" services/xstockstrat-config/migrations/034_retire_portfolio_snapshot_interval.up.sql
grep -c "'portfolio', 'portfolio.snapshot.interval_minutes'" services/xstockstrat-config/migrations/034_retire_portfolio_snapshot_interval.down.sql   # 2
# by inspection: the down re-inserts exactly the two rows the up deletes (staging/5, production/1), user_id NULL
```

---

### Step 8 — test: @AC-5 static scan of the config migration set

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/retiredPortfolioSnapshotInterval.test.ts` — create

**Reviewers**: `xstockstrat-config` owner — config key naming and scoping

**Codebase Evidence**:
- `services/xstockstrat-config/package.json:12` `"test": "tsc && node --test dist/__tests__/*.test.js"`; `:13`
  `test:coverage` (`c8 … --lines 40`). The CI job runs `pnpm run test:coverage` (`.github/workflows/ci.yml:594`).
- `tsconfig.json`: `rootDir: ./src`, `outDir: ./dist`, `module: commonjs`. The compiled test lives in
  `dist/__tests__/`, so `join(__dirname, '..', '..', 'migrations')` resolves to `services/xstockstrat-config/migrations`.
- Import style: `import { describe, it } from 'node:test'; import assert from 'node:assert/strict';`
  (`src/__tests__/tradingStateValidation.test.ts:12-13`). fs/path style: `import { readFileSync } from 'node:fs'`,
  `import { join } from 'node:path'` (`src/__tests__/mtls.test.ts:9,11`).
- No existing config test applies migrations (recon.md § Risks), hence the static scan (design.md; a real-DB test
  was rejected).
- Precedent: feature-161 @AC-8, "the dead source-weights key is gone"
  (`services/xstockstrat-config/acceptance/surface-signal-weight-decay-config.feature`).

**TDD**: `red-green required`. RED before Step 7: the highest match is `002_config_environment.up.sql`, an INSERT,
so check (ii) fails. GREEN after Step 7.

**Covers**: `AC-5`

**Instructions**:
1. Read `readdirSync(MIGRATIONS)`, keep `*.up.sql`, and sort by the numeric prefix (`parseInt(name.slice(0, 3), 10)`).
2. A file "matches" if its text contains `'portfolio.snapshot.interval_minutes'` or `'snapshot.interval_minutes'`
   (quoted literals). Split each file into statements on `;`.
3. Assert:
   - (i) at least one up file matches;
   - (ii) the highest-numbered matching file contains a statement that starts with `DELETE FROM config.config_values`
     (case-insensitive, whitespace-normalised) and that **itself** contains `namespace = 'portfolio'` and a key
     literal;
   - (iii) no `INSERT INTO config.config_values` statement naming either form appears in that file or any
     higher-numbered up file.

   Put the file name in each assertion message.
4. Name the test `@AC-5 portfolio.snapshot.interval_minutes is retired by the config migration set`.
5. C-13: no domain fixture is involved (file-system scan only), so there is no `src/__tests__/fixtures/` entry.
6. Keep the assertions reporter-neutral (fails.md 2026-10-20): never assert on runner output text.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run test:coverage   # 0 failed tests; c8 --lines 40 passes
cd services/xstockstrat-config && pnpm run lint
cd services/xstockstrat-config && npx tsc && node --test dist/__tests__/retiredPortfolioSnapshotInterval.test.js   # the @AC-5 case executes (not skipped)
```

---

### Step 9 — docs: Retire the key and record stream isolation in context docs, then the teardown refresh

**Status**: `pending`
**Service**: `docs` (portfolio, platform)
**Files**:
- `services/xstockstrat-portfolio/CLAUDE.md` — modify
- `services/xstockstrat-portfolio/docs/context-constitution-findings.md` — modify
- `docs/repo-surveyor/debt-radar-findings.md` — modify
- `docs/patterns/config-governance.md` — modify
- `docs/context-constitution.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Portfolio `CLAUDE.md`:
  - `:99` is the key row `portfolio.snapshot.interval_minutes | int | 5 | How often to write portfolio snapshots`;
  - `:139` is `portfolio.snapshot | Periodic snapshot written`, which is inaccurate because snapshots are written
    per fill (`portfolio_service.go:376`);
  - `:21-22` says "A missing header still yields `InvalidArgument "user_id required"`". That was false for the gRPC
    stream until Step 3;
  - `:45-52` is the H-3 ownership-gate paragraph (`GetSnapshot` `portfolio_id == caller`).
- `services/xstockstrat-portfolio/docs/context-constitution-findings.md:29` is the "**`StartSnapshotWriter` has no
  caller**" row.
- `docs/repo-surveyor/debt-radar-findings.md`: `:236` `### D-12 … *(carried, open)*` and `:447` `### D-24 … *(carried, open)*`.
- `docs/patterns/config-governance.md:423` uses the form "**Removes** `analysis.signals.source_weights` (migration 020) — …"
  inside § Per-Feature Registered Keys (`:105`).
- `docs/context-constitution.md:40`, **PLAT-6**: its evidence cell cites the deleted reader
  `portfolio_service.go#portfolio.snapshot.interval_minutes (~L814, s.cfg.GetInt("portfolio.snapshot.interval_minutes", 5))`.
  A surviving example of the same pattern is `portfolio_service.go:965`
  `s.cfg.GetFloat("portfolio.risk.max_drawdown_pct", 0.10)`.
- `.agents/context-forge.json` `scrubberExtraTargets`: `README.md`, `docs/patterns/ui-ux-governance.md`. Neither is
  touched.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. **Portfolio `CLAUDE.md`:**
   - delete the `:99` row;
   - reword `:139` to `Snapshot written after each processed fill`;
   - append one sentence to the H-3 paragraph: `StreamPortfolioUpdates` delivers only snapshots whose
     `portfolio_id == x-user-id`; an empty caller is rejected `InvalidArgument` on both paths before subscribing
     (feature 264). This keeps `:21-22` true.
2. **`context-constitution-findings.md:29`:** mark the row resolved by feature 264 (writer deleted, key retired by
   config migration 034), following that file's resolved-row convention.
3. **`debt-radar-findings.md`:** change the `:236` (D-12) and `:447` (D-24) status suffix from `*(carried, open)*`
   to `*(fixed by feature 264)*`.
4. **`config-governance.md`:** add a "**Removes** `portfolio.snapshot.interval_minutes` (migration 034) — feature 264;
   its only reader `StartSnapshotWriter` had zero callers…" entry in the `:423-427` form, in § Per-Feature Registered
   Keys.
5. **`context-constitution.md:40` (PLAT-6):** replace the deleted-reader evidence with
   `services/xstockstrat-portfolio/internal/service/portfolio_service.go#portfolio.risk.max_drawdown_pct`
   (`~L965`, `s.cfg.GetFloat("portfolio.risk.max_drawdown_pct", 0.10)`; re-grep the line at execute time). The rule
   text is unchanged.
6. **Teardown (root `CLAUDE.md`):** run `/context-constitution refresh` scoped to the files above and fix the
   grounded drift it reports. If the plugin is unavailable, re-read each touched file against the code by hand and
   record both facts in the PR body: that the plugin was unavailable, and the reconciliation performed.

**Verification**:
```bash
grep -rn "snapshot.interval_minutes" services/xstockstrat-portfolio/CLAUDE.md docs/context-constitution.md ; test $? -eq 1
grep -n "Removes\*\* \`portfolio.snapshot.interval_minutes\`" docs/patterns/config-governance.md
grep -n "^### D-12\|^### D-24" docs/repo-surveyor/debt-radar-findings.md   # both show "fixed by feature 264"
grep -n "StreamPortfolioUpdates" services/xstockstrat-portfolio/CLAUDE.md
```

---

### Step 10 — test: Pre-merge two-sided migration-number gate and dev-smoke `ListKeys` (@AC-5 applied state)

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- none (a verification gate; record its output in context.md and the integration PR body)

**Reviewers**: DBA — migration run order; `xstockstrat-config` owner — key retirement across environments

**Codebase Evidence**:
- golang-migrate never applies a version lower than the current one. A sibling that lands a higher number first
  silently skips this migration (fails.md:2909 "re-verify the next-free number against main-dev and merge-order.md
  immediately before merge"; fails.md:613).
- `scripts/db-migrate.sh` is the migration runner (root `CLAUDE.md` § Database). `ListKeys` is redacted and
  environment-scoped (config `ListKeys`; agent `list_config_keys`).

**TDD**: `N/A (verification gate; no code)`

**Covers**: `AC-5`

**Instructions**:
1. Immediately before merging the integration PR into `main-dev`, run:
   ```bash
   git fetch origin
   git ls-tree --name-only origin/main-dev services/xstockstrat-config/migrations/ | grep -oE '/[0-9]{3}_' | tr -d '/_' | sort -u
   ```
   - (a) No number ≥ 034 may exist on `origin/main-dev` other than this feature's own `034`.
   - (b) Each of 031, 032 and 033 must be present on `origin/main-dev`, **or** its owner must be explicitly sequenced
     after 264 in `docs/roadmap/features/merge-order.md`.
   - If (a) or (b) fails, **hold the merge** or renumber 034 to the next free number. A renumber is a deviation: it
     needs a Deviation Log entry plus a merge-order.md update, and the Step 8 scan needs no change.
2. After the dev deploy, run `scripts/db-migrate.sh` (or confirm the deploy ran it). Then list the config keys for
   service `portfolio` in `staging` and in `production` (`ListKeys` / the agent `list_config_keys` tool). Neither
   listing may contain `portfolio.snapshot.interval_minutes`.
3. Record the gate output and both listings in context.md and the integration PR body.
4. **Enforcement.** The gate is a process control; no CI job checks it. Open the integration PR as a **draft**, with
   a gate checklist (a)/(b) in its body. Mark it ready only after the item-1 output, captured that day, passes. The
   merge-order.md row from Step 6 stays `Resolved: No` until 243, 244 and 248 have merged.

**Verification**:
```bash
git ls-tree --name-only origin/main-dev services/xstockstrat-config/migrations/ | grep -E '/0(3[4-9]|[4-9][0-9])_'   # expect no output before 264 merges
# dev smoke: list_config_keys(service="portfolio", environment="staging"|"production") → no portfolio.snapshot.interval_minutes
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### 2026-10-28 — Step 1: RED probe file not committed with Step 1
- **Spec said**: the Step 1 STOP block writes Step 2's `portfolio_snapshot_scope_test.go` to capture RED between Part A and Part B.
- **Done**: the file was written and run for RED (fail) and GREEN (pass), then removed from the Step 1 commit. F-08 limits the
  Step 1 commit to its own **Files**; Step 2 creates and commits that file.
- **Disposition**: no behavior change. The gRPC `Sprintf` hoist sits at `portfolio_handler.go:293` (spec text says `:292`, the
  signature line); line drift only.
