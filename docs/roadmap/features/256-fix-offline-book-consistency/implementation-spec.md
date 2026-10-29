# Implementation Spec: fix-offline-book-consistency

**Status**: `pending` (spec-level template field, `.claude/skills/sdd-spec/reference/spec-template.md:8`; lifecycle lives in `status.md`)
**Created**: 2026-10-22
**Feature**: `docs/roadmap/features/256-fix-offline-book-consistency/feature.md`
**Total Steps**: 16
**Feature Branch**: `feature/fix-offline-book-consistency`

---

## Execution Summary

The two additive proto fields land first (Steps 1–2), because the portfolio marker steps, the UI gating
and the agent pass-through all compile against the regenerated stubs. Trading then closes D-49 (Steps 3–4,
the shared `isFinite` guard before the load) and D-63 (Steps 5–6, the error-returning sibling
`appendLedgerEvent`, ConfirmOrder UNAVAILABLE on an unpublished recompute). Portfolio closes D-47
(Steps 7–8: error-returning sync/deregistration handlers behind the SQLSTATE-classifying `boundedRetry`
wrapper) and D-48 (Steps 9–12: per-row `GetOfflineStates` decode exposed as `readValuation.unavailable`, then
the marker and zeroing on every read path). The consumer surfaces follow (Steps 13–15: UI gating plus
Playwright/vitest, agent pass-through test), and Step 16 updates the service docs that describe the changed
behaviour (context-forge teardown). No migration, no config key, no new env var or port (design.md § Spine).

Each `service` step is paired with the `test` step that follows it. `/sdd-execute` authors and runs the
paired test first to capture RED (P-06, `.claude/skills/sdd-execute/reference/tdd-gate.md`), then the
service change for GREEN.

### Scenario Coverage (C-15)

| Scenario | Covering step(s) |
|---|---|
| `@AC-1` failed offline realized write retried, not acked | 8 |
| `@AC-2` failed offline-realized delete on deregistration retried | 8 |
| `@AC-3` offline P&L never reported complete (ListPortfolios / GetPortfolio / ListPositions / GetPosition) | 12 (service), 14 (UI), 15 (agent) |
| `@AC-4` ConfirmOrder rejects non-finite / negative fill | 4 (service), 14 (UI dialog), 15 (agent) |
| `@AC-5` ConfirmOrder does not report success when the emit fails | 6 (service), 14 (UI dialog), 15 (agent) |
| `@AC-6` persistently failing sync event parked, stream not blocked | 8 |
| `@AC-7` valid fills keep the status derivation and emit | 4, 6 |
| `@AC-8` one undecodable offline state degrades only its own account | 10, 12 |
| `@AC-9` transient write failure never parks | 8 |
| `@AC-10` un-confirm with filled_qty 0 stays valid | 4 |

### Consumer surfaces (C-14)

- **UI `/trader`** (Book → Portfolio page, positions pages, dashboard `PortfolioPanel`/`OrderBook`, confirm-fill
  dialog): Step 13 (gating) and Step 14 (Playwright + vitest). Step 13 also gates the one latent consumer the
  consumer grep found outside `/trader`: `src/components/insights/AccountPortfolioSelector.tsx` (design Open Risk
  "latent consumers").
- **Agent** (`get_positions` / `get_positions_by_account_id` / `manage_offline_account`): no code change
  (design.md §5). Step 15 proves the pass-through with tests.

## Step Dependencies

- Step 2 [proto-gen] requires Step 1 [proto]: stubs are generated from the edited `.proto`.
- Steps 11, 12, 13, 14, 15 require Step 2: they read `Portfolio.OfflineStateUnavailable` /
  `Position.OfflineStateUnavailable` (Go), `offlineStateUnavailable` (TS) or `offline_state_unavailable` (Python).
- Step 4 [test] covers Step 3 [service]; Step 6 [test] covers Step 5 [service]; Step 8 [test] covers Step 7
  [service]; Step 10 [test] covers Step 9 [service]; Step 12 [test] covers Step 11 [service]; Step 14 [test]
  covers Step 13 [service].
- Step 5 requires Step 3: both edit `ConfirmOrder` in `services/xstockstrat-trading/internal/service/trading.go`;
  Step 5's line references are the post-Step-3 positions of the same symbols.
- Step 11 requires Step 9: `applyAccountPnL` reads `readValuation.unavailable`, which Step 9 adds.
- Step 16 [docs] requires Steps 7, 9 and 11: it documents their final behaviour.
- Proto gate (design Open Risk 1): if the Proto Reviewer refuses field 17 or 26 at Step 1, **stop**. The
  fallback (whole-call UNAVAILABLE) turns `@AC-14`/`@AC-3 @feature-157` into a CHANGE and needs operator
  sign-off plus a re-spec; it is not specced here.
- Merge order (rebase-only overlaps from context.md): 248 edits `portfolio_service.go:185-202`/`:220-221`. This
  spec deliberately does **not** edit `consumeEventStream`/`streamEventsFrom` (design § Spine). 267 edits other
  `trading.go` functions. 264/257/251 edit other `portfolio_service.go` functions. Rebase only.
- Recorded UX gap (design Open Risk "onSettled"): `useInvalidatingMutation`
  (`services/xstockstrat-ui/src/hooks/useInvalidatingMutation.ts:14-31`) invalidates only in `onSuccess` and
  accepts no `onSettled`. After an FR-6 UNAVAILABLE the order row was already persisted, so the orders list
  can be stale until the next refetch or the (successful) re-confirm. Accepted; no step adds an option to the
  shared hook (C-18 YAGNI). Recorded in context.md.
- Accepted (design Open Risks, recorded at Step 8 / Step 16): same-stream head-of-line blocking during a
  transient DB outage; a park is Error-log only, with no metric (revisit at launch verification); the boot
  replay re-attempts historically parked deterministic events (≤ 5 × 2s each).

---

### Step 1 — proto: additive `offline_state_unavailable` markers on Portfolio (17) and Position (26)

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/portfolio/v1/portfolio.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness per message, no breaking change, `buf lint`/`buf breaking` pass; `xstockstrat-portfolio` owner — P&L calculation accuracy; `xstockstrat-ui` owner — analytics display accuracy; `xstockstrat-trading` owner — order execution correctness (consumer of Position via `trading.go:2089/:2793/:3535`)

**Codebase Evidence**:
- `message Portfolio {` at `packages/proto/portfolio/v1/portfolio.proto:47`, closing `}` at `:68`; highest tag
  `optional double fees_lifetime = 16;         // offline accounts only` (`:67`).
- `message Position {` at `:70`, closing `}` at `:119`; highest tag
  `google.protobuf.Timestamp mark_as_of = 25;` (`:118`); `string stop_order_id = 20;` (`:107`) — tag 20 is
  taken (design Rejected Alternatives). No `reserved` statement in either message (awk over both message
  bodies found none).
- `grep -rn offline_state_unavailable packages/proto` → no match (field names free).

**TDD**: `N/A (proto — non-code-bearing; the marker behaviour is proven in Steps 10/12/14/15)`

**Covers**: —

**Instructions**:
1. In `message Portfolio`, after `fees_lifetime = 16` (`:67`), add:
   ```proto
   // Offline accounts only: true when this account's offline P&L state could not be read. day_pnl,
   // day_pnl_pct and total_pnl are then zero and realized/fee fields unset — not a real $0.
   bool offline_state_unavailable = 17;
   ```
2. In `message Position`, after `mark_as_of = 25` (`:118`), add the same field comment (worded for a position:
   "day_pnl and day_pnl_pct are then zero — not a real $0") and `bool offline_state_unavailable = 26;`.
3. Plain `bool`, no enum (design C-04: binary value set). No other proto change.

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against "$(git rev-parse --show-toplevel)/.git#branch=feature/fix-offline-book-consistency,subdir=packages/proto"
cd packages/proto && buf breaking --against "$(git rev-parse --show-toplevel)/.git#branch=origin/main-dev,subdir=packages/proto"   # integration-PR baseline (CI form, ci.yml:125)
grep -n 'offline_state_unavailable = 17\|offline_state_unavailable = 26' portfolio/v1/portfolio.proto   # two hits
```

---

### Step 2 — proto-gen: regenerate Go/TS/Python stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/portfolio/v1/portfolio.pb.go` — modify (generated)
- `packages/proto/gen/ts/portfolio/v1/portfolio_pb.ts` — modify (generated)
- `packages/proto/gen/ts/dist/portfolio/v1/portfolio_pb.js` — modify (generated)
- `packages/proto/gen/ts/dist/portfolio/v1/portfolio_pb.d.ts` — modify (generated)
- `packages/proto/gen/python/portfolio/v1/portfolio_pb2.py` — modify (generated)

Message-only change: `portfolio_grpc.pb.go`, `portfoliov1connect/`, `portfolio_connect.ts` and `portfolio_pb2_grpc.py`
are expected unchanged. Generated output is never hand-edited (root `CLAUDE.md` § Key File Paths).

**Reviewers**: Proto Reviewer — field number uniqueness per message, no breaking change, `buf lint`/`buf breaking` pass; `xstockstrat-portfolio` owner — P&L calculation accuracy; `xstockstrat-ui` owner — analytics display accuracy; `xstockstrat-trading` owner — order execution correctness

**Codebase Evidence**:
- root `CLAUDE.md` § Generating Proto Stubs: `./scripts/buf-gen.sh` generates TS, Python and Go stubs and compiles
  the TS package; CI `proto-freshness` enforces it. Generated dirs are listed in root `CLAUDE.md` § Key File Paths
  (never hand-edited).
- Host fallback when Docker is unavailable: `docs/runbooks/codegen-toolchain-host-setup.md`.

**TDD**: `N/A (proto-gen — generated output)`

**Covers**: —

**Instructions**:
1. Run `./scripts/buf-gen.sh` from the repo root.
2. Stage only the regenerated files under `packages/proto/gen/` that change for `portfolio/v1` (plus the
   compiled `gen/ts/dist/` output). A diff outside `portfolio/v1` means a toolchain-pin drift — stop and follow
   `docs/runbooks/codegen-toolchain-host-setup.md` instead of committing it.

**Verification**:
```bash
./scripts/buf-gen.sh
git diff --stat packages/proto/gen/ | grep -v 'portfolio' || true   # expect no non-portfolio paths (dist bundles excepted)
grep -rln 'OfflineStateUnavailable' packages/proto/gen/go/portfolio/v1/ | head -1   # non-empty
```

---

### Step 3 — service: D-49 shared `isFinite` guard; ConfirmOrder rejects non-finite / negative fill before the load

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, fill detection

**Codebase Evidence**:
- `ConfirmOrder` at `trading.go:890`; `if req.FilledQty < 0 {` at `:894` (NaN passes); fees guard
  `if req.Fees != nil && (*req.Fees < 0 || math.IsNaN(*req.Fees) || math.IsInf(*req.Fees, 0)) {` at `:897`
  returning `"fees must be >= 0"`; `order, err := s.repo.GetOrder(ctx, req.OrderId)` at `:901`.
- `order.FilledAvgPrice = req.FilledAvgPrice` at `:924` (never validated).
- `deriveOfflineStatus` at `:863-871`: `default: return ...FILLED` (NaN/+Inf fall through).
- `SnapshotOfflinePositions` per-row checks: `case math.IsInf(pos.Qty, 0) || math.IsNaN(pos.Qty):` at `:1156`,
  `case math.IsInf(pos.AvgCostPerShare, 0) || math.IsNaN(pos.AvgCostPerShare):` at `:1160`,
  `case pos.AvgCostPerShare < 0:` at `:1164` (per-row reject-with-reason, qty 0 valid per the `default:` comment
  at `:1168`).
- recon.md Patterns to REUSE "Shared finite guard (FR-5)"; insights.md:1936 (inverted range rejects NaN).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add one package-level helper next to `deriveOfflineStatus` (`:863`):
   `func isFinite(x float64) bool { return !math.IsNaN(x) && !math.IsInf(x, 0) }`. No combined
   "finite and non-negative" helper (design Rejected Alternatives).
2. In `ConfirmOrder`, replace `:894-896` with a guard that returns
   `grpcstatus.Errorf(codes.InvalidArgument, "filled_qty must be a finite number >= 0")` when
   `!isFinite(req.FilledQty) || req.FilledQty < 0`.
3. Directly after it, add: when `req.FilledQty > 0 && (!isFinite(req.FilledAvgPrice) || req.FilledAvgPrice < 0)`
   return `codes.InvalidArgument, "filled_avg_price must be a finite number >= 0 when filling"`. `filled_qty 0`
   skips the price check (un-confirm / bare re-confirm, `@AC-48 @feature-240`, this feature's `@AC-10`).
4. Rewrite the fees guard at `:897` onto the helper — `*req.Fees < 0 || !isFinite(*req.Fees)` — keeping the
   exact message `"fees must be >= 0"` and its position after the qty guard (`@AC-9 @feature-240` EXTEND).
5. All three guards stay above `GetOrder` (`:901`). Consequence recorded in design §1: a bad value on a broker
   order now returns INVALID_ARGUMENT, not FailedPrecondition; the order is unchanged either way.
6. In `SnapshotOfflinePositions`, rewrite `:1156` to `case !isFinite(pos.Qty):` and `:1160` to
   `case !isFinite(pos.AvgCostPerShare):`. Reasons, ordering and the `:1164` negative-cost case are unchanged
   (`@AC-7`/`@AC-8`/`@AC-15 @feature-163`, `@AC-43 @feature-240` PRESERVE).
7. `deriveOfflineStatus` is unchanged; its `default → FILLED` is now unreachable for NaN/Inf.
8. Order type, broker coverage and fill-state handling are unaffected beyond the guard: only
   `BROKER_TYPE_OFFLINE` orders reach the confirm write (gate at `:909-911`); PARTIALLY_FILLED/FILLED derivation
   is unchanged (FR-7). No trading-mode gate is involved (confirm never submits to a broker).

**Verification**:
```bash
grep -n 'func isFinite\|filled_qty must be a finite\|filled_avg_price must be a finite\|!isFinite(pos' services/xstockstrat-trading/internal/service/trading.go
cd services/xstockstrat-trading && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 4 — test: D-49 ConfirmOrder validation and FR-7 / un-confirm non-regression

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_offline_test.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, fill detection

**Codebase Evidence**:
- Template `TestConfirmOrder_AC9_NegativeFeesRejectedBeforeLoad` at `trading_offline_test.go:1710`: loops over
  `-1`, `math.NaN()`, `math.Inf(1)` and asserts `codes.InvalidArgument` plus
  `h.mock.ExpectationsWereMet()` ("GetOrder/UpsertOrder must not run").
- `newConfirmHarness` `:1598`, `h.seed` / `h.confirm` (`:1669`), `newOfflineOrder(id, qty)` (`:1693`),
  `recordingLedger.requestsByType` (`:84`), `TestDeriveOfflineStatus` `:471`, `TestConfirmOrder_Validation`
  `:615`, `TestConfirmOrder_AC48_UnconfirmHidesFeesAndFilledAt` `:1774`,
  `TestSnapshotOfflinePositions_AC7_NonFiniteQtyRejected` `:1396`.

**TDD**: `red-green required` — the NaN/+Inf qty rows and every price row fail on the pre-Step-3 tree
(`:894` accepts NaN, `:924` never validates price).

**Covers**: `AC-4, AC-7, AC-10`

**Instructions**:
1. Add `TestConfirmOrder_AC4_NonFiniteOrNegativeFillRejectedBeforeLoad` modelled on `:1710`: a table of the five
   `@AC-4` examples (`NaN/150`, `+Inf/150`, `10/NaN`, `10/-5`, `10/+Inf`) plus `-1/150`. For each, assert
   `codes.InvalidArgument`, that `h.ledger.requestsByType("account.positions.synced")` is empty, and finally
   `h.mock.ExpectationsWereMet()` (no GetOrder, no UpsertOrder: "order unchanged").
2. Add `TestConfirmOrder_AC7_ValidFillsKeepStatusAndEmit`: seed `newOfflineOrder("ord-1", 10)`, confirm
   `4/150` → `PARTIALLY_FILLED`, then `10/150` → `FILLED`; after each, one `account.positions.synced` request is
   recorded.
3. Add `TestConfirmOrder_AC10_UnconfirmZeroQtyNoPriceValid`: confirm `10/150`, then `0/0` → no error, status
   `NEW`, and an `account.positions.synced` request is recorded.
4. Extend `TestDeriveOfflineStatus` (`:471`) only if needed to document that NaN is never passed (no behaviour
   change); keep `TestSnapshotOfflinePositions_AC7_NonFiniteQtyRejected` (`:1396`) passing unchanged — it is
   the PRESERVE guard for the Snapshot refactor.
5. C-13: the order/fill literals are single-consumer scenario values in this one file and reuse the existing
   `newOfflineOrder` / `testdata.S1UserID` homes — inline is compliant; no new `internal/testdata/` entry.

6. Broker-order sweep (design §1 consequence, Step 3 instruction 5): `grep -rn 'applies only to offline\|FailedPrecondition' services/xstockstrat-trading --include=*_test.go`
   at spec review found no test that confirms a broker order with a bad value (the only `FailedPrecondition`
   hits are `trading_offline_test.go:359`, credentials, and `trading_state_gate_test.go`, place-order gates), and
   every existing `ConfirmOrderRequest` with `FilledQty > 0` sets a finite positive `FilledAvgPrice`. Re-run the
   grep at execute time; any new hit asserting FailedPrecondition for a non-finite fill moves to InvalidArgument.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/ -run 'TestConfirmOrder_AC4_|TestConfirmOrder_AC7_|TestConfirmOrder_AC10_|TestConfirmOrder_AC9_|TestSnapshotOfflinePositions_AC7_|TestDeriveOfflineStatus' -count=1 -v
cd services/xstockstrat-trading && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # confirm ≥ 40%
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```
New logic is in `internal/service/` (excluded from CI coverage measurement); the targeted tests are the
behavioural proof, and the coverage command guards the threshold.

---

### Step 5 — service: D-63 an unpublished recompute is not success (`appendLedgerEvent` sibling + ConfirmOrder UNAVAILABLE)

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify
- `services/xstockstrat-trading/internal/service/ledger_emit_mtls_test.go` — modify (added 2026-10-29, operator Option A: `TestEmitLedgerEventFailSoftOneShot` → `TestEmitLedgerEventFailSoftBoundedRetry`, expects `appendMaxAttempts` attempts)

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, fill detection

**Codebase Evidence**:
- `const ledgerEmitTimeout = 10 * time.Second` (`trading.go:3661`); void
  `func (s *TradingService) emitLedgerEvent(ctx context.Context, eventType, streamKey, userID string, payload map[string]interface{}) {`
  (`:3665`) drops `structpb.NewStruct`'s error (`:3666`) and only Warns `"ledger emit failed"` (`:3675-3677`).
  `grep -n 'emitLedgerEvent(' internal/service/*.go` (non-test) → 28 lines = definition + 27 call sites; only
  the `:1072` site changes (fails.md:2092 shared-helper trap). A second `"account.positions.synced"`
  `emitLedgerEvent` call at `trading.go:2414` is on the broker sync path and stays on the void wrapper.
- `recomputeAndEmitOfflinePositions` (`:967`, doc comment `:965-966`) emits at `:1072` and ends with an
  unconditional `return nil` (`:1083`); query failures already return errors (`:969-983`).
- ConfirmOrder swallow `trading.go:956-959`
  (`slog.Warn("ConfirmOrder: recompute failed; positions.synced not emitted", ...)` then `return resp, nil`);
  lock `lock := s.confirmLock(order.AccountId)` (`:923`).
- SnapshotOfflinePositions call `:1229-1232` (Warn only); `warnings` slice already built above (`:1191-1197`,
  `warnings = append(warnings, "account has unconfirmed NEW offline orders; ...")`), response field
  `repeated string warnings = 4;` (`packages/proto/trading/v1/trading.proto:350`).
- Idempotency key: `string idempotency_key = 8;` (`packages/proto/ledger/v1/ledger.proto:50`). Precedent: portfolio
  `emitEvent` sets `IdempotencyKey: uuid.NewString()` and retries only `codes.Unavailable`
  (`services/xstockstrat-portfolio/internal/service/portfolio_service.go:1032-1046`). `github.com/google/uuid` is
  already imported in `trading.go:16`.
- Header propagation (C-03): no new outbound RPC client; the append reuses `s.ledger.AppendEvent`, and the ctx is
  derived from the inbound request via `context.WithoutCancel`, which keeps the incoming metadata
  (`x-user-id`/`x-access-scope`/`x-trace-id`) for trading's existing outbound propagation
  (`docs/patterns/header-propagation.md`, Go interceptor).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add, beside `ledgerEmitTimeout` (`:3661`), the constants:
   `appendMaxAttempts = 2` (one bounded retry), `appendRetryBackoff = 100 * time.Millisecond`,
   `offlineRecomputeQueryBudget = 5 * time.Second`, and
   `offlineRecomputeTimeout = 30 * time.Second`. Comment (≤ 2 lines, constraint only): the timeout must exceed
   `appendMaxAttempts*ledgerEmitTimeout + appendRetryBackoff + offlineRecomputeQueryBudget` (design §2 rule;
   Step 6 asserts it).
2. Add `func (s *TradingService) appendLedgerEvent(ctx context.Context, eventType, streamKey, userID string, payload map[string]interface{}) error`:
   returns the `structpb.NewStruct` error; builds one `AppendEventRequest` with
   `IdempotencyKey: uuid.NewString()` reused across attempts; each attempt runs under
   `context.WithTimeout(ctx, ledgerEmitTimeout)`; retries only when `grpcstatus.Code(err) == codes.Unavailable`
   and attempts remain, sleeping `appendRetryBackoff`; returns the last error. It never touches `confirmLock`
   (the caller holds it; the lock is non-reentrant — fails.md:2028).
3. Make `emitLedgerEvent` (`:3665`) a void wrapper: `if err := s.appendLedgerEvent(...); err != nil { slog.Warn("ledger emit failed", "event_type", eventType, "error", err) }`.
   This is the design's "sibling" shape (`emitLedgerEvent` is "its void wrapper"). **Recorded behaviour change
   for the other 26 call sites** (impl-spec review, C-18 trade-off): each now gets one `codes.Unavailable` retry
   under a fresh per-event idempotency key, so a ledger outage raises a caller's worst-case emit wait from
   10s to 2×10s + 100ms; non-Unavailable failures are unchanged (one attempt, Warn). Pre-entered in the
   Deviation Log; the no-retry alternative for those callers is an operator choice carried in context.md.
4. In `recomputeAndEmitOfflinePositions`, replace the `s.emitLedgerEvent(ctx, "account.positions.synced", ...)`
   call at `:1072` (only this site — the broker-sync `:2414` emit of the same event type stays void) with `if err := s.appendLedgerEvent(ctx, ...same args...); err != nil { return fmt.Errorf("emit account.positions.synced: %w", err) }`
   and keep the payload map verbatim — `user_id` included (fails.md:2054). The final `return nil` stays for the
   success path. Update the doc comment at `:965-966` to "Fail-closed: a query or ledger-append error is
   returned and nothing is emitted."
5. In `ConfirmOrder`, replace `:955-959` (comment + swallow) with:
   ```go
   recomputeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), offlineRecomputeTimeout)
   defer cancel()
   if err := s.recomputeAndEmitOfflinePositions(recomputeCtx, order.AccountId, order.UserId); err != nil {
       slog.Warn("ConfirmOrder: positions.synced not published", "account_id", order.AccountId, "error", err)
       return nil, grpcstatus.Errorf(codes.Unavailable, "positions not published; re-confirm to retry")
   }
   ```
   The order row is already persisted; a re-confirm with the same values is idempotent (absolute recompute,
   `@AC-10 @feature-157`) and re-emits.
6. In `SnapshotOfflinePositions`, wrap the `:1229` call with the same `WithTimeout(WithoutCancel(ctx), offlineRecomputeTimeout)`
   and, on error, keep the Warn and append `"positions not published; re-snapshot to retry"` to `warnings`
   (the response literal already sets `Warnings: warnings`, `:1238`). No error return there (design §2).
7. Frozen-window confirm (`@AC-46 @feature-240`) still recomputes and emits — there is no no-op path in
   `:967-1083`; it fails only if the ledger append fails.
8. Fill-state completeness: PARTIALLY_FILLED and FILLED both go through the same persist → recompute → emit path;
   order type handling and broker coverage are unaffected (offline-only path).

**Verification**:
```bash
grep -n 'func (s \*TradingService) appendLedgerEvent\|IdempotencyKey: *uuid.NewString\|offlineRecomputeTimeout\|positions not published' services/xstockstrat-trading/internal/service/trading.go
grep -n 'context.WithoutCancel(ctx)' services/xstockstrat-trading/internal/service/trading.go   # ConfirmOrder + Snapshot sites
cd services/xstockstrat-trading && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 6 — test: D-63 emit failure, re-confirm, idempotency-key retry, timeout rule, `user_id`

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_offline_test.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, fill detection

**Codebase Evidence**:
- `recordingLedger` (`trading_offline_test.go:60`) always returns success from `AppendEvent` (`:67-73`); it has
  no failure hook today.
- `fakeBaselineStore.baselineErr` (`:112`, returned at `:237-238`) and `confirmedErr` (`:116`) inject query
  failures; `newConfirmHarness` `:1598`; `parseSyncedPayload(t, ledger)` `:704`.
- `TestConfirmOrder_AC46_FrozenWindowFillIgnored` `:2058`, `TestConfirmOrder_AC47_FrozenReconfirmLeavesPayload`
  `:2071` (PRESERVE guards, must stay green).

**TDD**: `red-green required` — on the pre-Step-5 tree a failing append still returns success from ConfirmOrder.

**Covers**: `AC-5, AC-7`

**Instructions**:
1. Add an optional failure hook to `recordingLedger`: a field `failFn func(*ledgerv1.AppendEventRequest) error`;
   `AppendEvent` records the request, then returns `nil, r.failFn(req)` when the hook is set and returns non-nil.
   Existing users are unaffected (nil hook).
2. `TestConfirmOrder_AC5_EmitFailureIsNotSuccess`: hook fails every `account.positions.synced` with
   `grpcstatus.Error(codes.Internal, "ledger down")`; ConfirmOrder returns `codes.Unavailable` with message
   `"positions not published; re-confirm to retry"`. Then clear the hook; a repeat ConfirmOrder with the same
   values succeeds and one more `account.positions.synced` request is recorded. Table-drive it over a partial
   fill (`4/150` on a qty-10 order, the PARTIALLY_FILLED path) and a full fill (`10/150`) so both fill states
   prove the fail-closed emit (B2b).
3. `TestConfirmOrder_AC5_RecomputeQueryFailureIsNotSuccess`: `baselineErr` set → `codes.Unavailable`; no
   `account.positions.synced` recorded.
4. `TestAppendLedgerEvent_RetriesUnavailableWithSameIdempotencyKey`: hook fails the first attempt with
   `codes.Unavailable`, then succeeds → exactly 2 requests recorded, both with the same non-empty
   `IdempotencyKey`; a `codes.Internal` failure is not retried (1 request).
5. `TestOfflineRecomputeTimeout_CoversRetryBudget`: assert
   `offlineRecomputeTimeout > appendMaxAttempts*ledgerEmitTimeout + appendRetryBackoff + offlineRecomputeQueryBudget`.
6. `TestRecomputeEmit_PayloadKeepsUserID`: after a successful confirm, `parseSyncedPayload` (or the raw
   request payload) carries `user_id == testdata.S1UserID` (fails.md:2054).
7. `TestSnapshotOfflinePositions_EmitFailureAddsWarning`: hook fails the `account.positions.synced` append →
   no error, response `Warnings` contains `"positions not published; re-snapshot to retry"`.
8. C-13: the hook and literals live in this one test file (single consumer) — inline is compliant.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/ -run 'TestConfirmOrder_AC5_|TestAppendLedgerEvent_|TestOfflineRecomputeTimeout_|TestRecomputeEmit_|TestSnapshotOfflinePositions_|TestConfirmOrder_AC46_|TestConfirmOrder_AC47_' -count=1 -v
cd services/xstockstrat-trading && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # confirm ≥ 40%
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
```
New logic is in `internal/service/` (excluded package); the targeted tests are the behavioural proof.

---

### Step 7 — service: D-47 error-returning offline sync / deregistration handlers behind a SQLSTATE-classifying `boundedRetry`

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify
- `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go` — modify (one line: `DeleteOfflineRealized` onto `r.db`)

**Reviewers**: `xstockstrat-portfolio` owner — position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- `type eventHandler func(context.Context, *ledgerv1.LedgerEvent) error` (`portfolio_service.go:173`);
  `func ackAlways(...)` (`:176`); `consumeEventStream` (`:185`, `var lastSeq int64` `:186`, fixed
  `time.Sleep(2 * time.Second)` `:199`); `streamEventsFrom` (`:206`, "lastSeq == 0 replays full history" `:205`)
  returns without advancing on a handler error (`:226-231`). **Not edited** (feature 248's region, design § Spine).
- `ConsumePositionSyncs` (`:1116-1118`):
  `s.consumeEventStream(ctx, "position sync", "account.positions.synced", ackAlways(s.processPositionSync))`;
  `ConsumeAccountDeregistrations` (`:1128-1130`) with `ackAlways(s.processAccountDeregistered)`.
- `processAccountDeregistered` (`:1132`): parse/nil early returns `:1133-1147`; `positionsMu` `:1152`;
  Warn-only `DeletePositionsNotInSync` `:1156-1158` and `DeleteOfflineRealized` `:1159-1161`.
- `processPositionSync` (`:1175`): parse/nil early returns `:1176-1190`; `positionsMu` `:1192`; Warn-only
  `UpsertPositionFromSync` `:1213-1215`, `DeletePositionsNotInSync` `:1219-1221` (inside the unchanged
  `shouldReconcileSyncDeletions` guard `:1218`), `UpsertOfflineRealized` `:1229-1231` (guarded by
  `sync.RealizedPnl != nil`, the offline discriminator).
- Model handler: `processOrderFill` (`:264`) returns `error` for a DB failure and `nil` for a malformed payload
  (`portfolio_fill_errors_test.go` `TestProcessOrderFill_MalformedPayload_Acked` `:111`).
- `DeleteOfflineRealized` uses `r.pool.Exec` (`portfolio_repo.go:535`), unlike its siblings on `r.db`
  (`DeletePositionsNotInSync` `:351-367`); `NewPortfolioRepo` sets `db: pool` (`:45`) so prod behaviour is
  identical, and `NewPortfolioRepoWithDB` leaves `pool` nil (`:49-51`) — a mocked delete would nil-panic.
- Clock seam: `func (s *PortfolioService) clock() time.Time` (`offline_valuation.go:54`, uses `s.now`).
- `github.com/jackc/pgx/v5 v5.9.2` (`go.mod:8`); `pgconn` already imported in service tests
  (`portfolio_offline_test.go:11`).
- `LedgerEvent` fields `event_id = 1`, `sequence = 9`, `stream_key = 10` (`packages/proto/ledger/v1/ledger.proto`).
- Out of scope, keep `ackAlways`: `ConsumeBracketUpdates` (`:1249`) and `ConsumeBalanceSyncs` (`:1297`).
- Header propagation: no new outbound gRPC call; consumers are background loops (design C-03).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `processPositionSync` returns `error`. Parse failures and the nil/empty-account early returns (`:1176-1190`)
   return `nil` (poison, acked). Offline branch (`sync.RealizedPnl != nil`) is **try-all**: attempt every
   `UpsertPositionFromSync`, the guarded `DeletePositionsNotInSync`, and `UpsertOfflineRealized`, collect the
   failures, keep each existing Warn, and return `errors.Join(failures...)`. Broker branch
   (`sync.RealizedPnl == nil`) keeps warn-and-continue and returns `nil`. `shouldReconcileSyncDeletions` is
   unchanged (`@AC-4 @feature-206`).
2. `processAccountDeregistered` returns `error`: parse/nil/empty-account paths return `nil`; it returns
   `errors.Join` of the `DeletePositionsNotInSync` and `DeleteOfflineRealized` failures (both attempted).
   **Deregistration scope — option (a)** (design Open Risk, decided at /sdd-spec and recorded in context.md):
   the `account.deregistered` payload carries no account type (`accountDeregisteredPayload`, `:1120-1123`), and
   both deletes are idempotent, so the retry applies to every deregistered account. A broker account's
   positions purge was already attempted here; retrying it is a recorded scope extension, not an offline-set
   lookup (option (b) would add a query that can itself fail, C-18 YAGNI). **Gate**: this extends past the
   product spec's offline-only scope, so `/sdd-execute` must obtain the operator's explicit sign-off on (a)
   before Step 7 (C-16/P-03, Deviation Log pre-entry); a choice of (b) means re-spec this instruction.
3. Add the bound constants next to the consumers: `syncRetryMinAttempts = 5` and
   `syncRetryFallbackElapsed = 10 * time.Minute`.
4. Add `classifyConsumerErr(err error) retryClass` returning `retryTransient`, `retryDeterministic` or
   `retryUnclassified`, walking every leaf of an `errors.Join` (`interface{ Unwrap() []error }`), with
   **transient > deterministic > unclassified** precedence across leaves:
   - transient: `errors.Is(err, context.DeadlineExceeded)`, `errors.Is(err, context.Canceled)`,
     `pgconn.Timeout(err)`, a `net.Error`, or a `*pgconn.PgError` (via `errors.As`) whose `Code[:2]` is
     `08`, `40`, `53` or `57`;
   - deterministic: a `*pgconn.PgError` whose class is `22` or `23`;
   - anything else: unclassified.
5. Add `func (s *PortfolioService) boundedRetry(consumer string, h eventHandler) eventHandler`. Its closure owns
   `{seq int64; attempts int; first time.Time}` (one goroutine per consumer, so no lock), keyed by
   `event.Sequence`, so the state outlives one `streamEventsFrom` call. On success it clears state for that
   sequence. On error it starts or increments the state (`first = s.clock()` on the first failure of a sequence)
   and parks when:
   - deterministic and `attempts >= syncRetryMinAttempts` (no elapsed floor);
   - unclassified and `attempts >= syncRetryMinAttempts && s.clock().Sub(first) >= syncRetryFallbackElapsed`;
   - transient: never.
   A park writes one `slog.Error("event parked", "event_id", ev.EventId, "sequence", ev.Sequence, "stream_key", ev.StreamKey, "consumer", consumer, "attempts", n, "error", err)`,
   clears state and returns `nil` (ack). Otherwise it returns `err` (the stream reconnects from the failed
   event, unchanged `consumeEventStream` behaviour).
6. Wire it: `ConsumePositionSyncs` → `s.boundedRetry("position sync", s.processPositionSync)`;
   `ConsumeAccountDeregistrations` → `s.boundedRetry("account deregistration", s.processAccountDeregistered)`.
   `ConsumeOrderFills` (`:167`), `:1249` and `:1297` are unchanged.
7. Repo: change `DeleteOfflineRealized` (`portfolio_repo.go:535`) from `r.pool.Exec` to `r.db.Exec` (same pool
   in prod) so Step 8 can fail it through pgxmock.
8. Comments stay ≤ 2 lines and state constraints only (root CLAUDE.md How to Act #5); the self-heal and
   head-of-line notes go to Step 16's docs, not inline.

**Verification**:
```bash
grep -n 'ackAlways(' services/xstockstrat-portfolio/internal/service/portfolio_service.go   # only the bracket + balance consumers remain
grep -n 'func (s \*PortfolioService) boundedRetry\|func classifyConsumerErr\|"event parked"\|syncRetryMinAttempts\|syncRetryFallbackElapsed' services/xstockstrat-portfolio/internal/service/portfolio_service.go
grep -n 'r.db.Exec(ctx, `DELETE FROM portfolio.offline_account_realized' services/xstockstrat-portfolio/internal/repository/portfolio_repo.go
cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 8 — test: D-47 retry, park classification, deregistration retry

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_sync_retry_test.go` — create
- `services/xstockstrat-portfolio/internal/service/portfolio_offline_test.go` — modify (`runOfflineSync` call site)
- `services/xstockstrat-portfolio/internal/service/portfolio_fill_sync_race_test.go` — modify (call site)

**Reviewers**: `xstockstrat-portfolio` owner — position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- `portfolio_fill_errors_test.go`: `var errDBBlip = errors.New("conn reset")` `:22`, `fillEvent` `:24`,
  `anyArgs` `:36`, `newFillSvc(t) (*PortfolioService, pgxmock.PgxPoolIface, *fakeLedger)` `:56`, `sliceStream`
  (`Recv` at `:129`), `TestStreamEventsFrom_HandlerError_DoesNotAdvanceCursor` `:142`.
- Existing void call sites that must take the new return value:
  `portfolio_offline_test.go:257` (`runOfflineSync`) and `:307`; `portfolio_fill_sync_race_test.go:84`
  (`grep -rn 'processPositionSync(\|processAccountDeregistered(' --include=*_test.go` → these 3 only).
- `TestAccountDeregisteredPayload_Parse` `portfolio_offline_test.go:113`.

**TDD**: `red-green required` — on the pre-Step-7 tree the handlers are void and acked, so every retry/park
assertion fails.

**Covers**: `AC-1, AC-2, AC-6, AC-9`

**Instructions**:
1. Update the three call sites to `if err := svc.processPositionSync(...); err != nil { t.Fatalf(...) }` (the
   race test may `_ =` it if its interleave intentionally fails a write — read it at execute time).
2. In the new file, using `newFillSvc`, pgxmock, `errDBBlip` and a fake clock (`svc.now = func() time.Time { return t0 }`, advanced per call):
   - `TestProcessPositionSync_AC1_RealizedUpsertFailureIsRetryable`: `UpsertOfflineRealized` fails once
     (`errDBBlip`) → handler returns an error wrapping it; second delivery succeeds with realized 500.00 bound.
     Drive both deliveries through `streamEventsFrom` with `sliceStream` + `boundedRetry` to assert the cursor
     stays at the prior sequence after the first failure and advances after the second.
   - `TestProcessPositionSync_TryAll`: position upsert fails but `UpsertOfflineRealized` still runs; the returned
     error `errors.Is` the upsert failure.
   - `TestProcessPositionSync_BrokerBranchStillAcked` and `..._MalformedPayloadAcked`: `nil` returns.
   - `TestProcessAccountDeregistered_AC2_DeleteFailureIsRetryable`: `DELETE FROM portfolio.offline_account_realized`
     fails once → error; second delivery deletes both and returns `nil`.
   - `TestBoundedRetry_AC6_DeterministicParksAfterFiveAttempts`: handler returns
     `&pgconn.PgError{Code: "23505"}` for `evt-1` (seq 1) and succeeds for `evt-2` (seq 2); attempts 1–4 return
     the error, attempt 5 returns `nil` and logs one Error `"event parked"` with `event_id`, `sequence`,
     `stream_key`, `consumer` (use the existing slog capture helper `recordWarns`, `portfolio_quote_deadline_test.go:60`, extended to
     Error level if needed); `evt-2` is then applied.
   - `TestBoundedRetry_AC9_TransientNeverParks`: `&pgconn.PgError{Code: "08006"}`, `context.DeadlineExceeded`
     and a `net.Error` each keep failing for 20 attempts across 15 fake minutes → never parked; a later success
     acks.
   - `TestBoundedRetry_UnclassifiedUsesFallbackBound`: `errDBBlip` parks only once attempts ≥ 5 **and** elapsed
     ≥ 10 min (not at attempt 5 / 1 min).
   - `TestClassifyConsumerErr_Table`: classes 22/23 → deterministic; 08/40/53/57 → transient; `errors.Join` of a
     transient and a deterministic leaf → transient; plain error → unclassified.
3. C-13: `pgconn.PgError` literals and events are single-consumer values in this new file; reuse
   `fillEvent`/`errDBBlip`/`newFillSvc` from the sibling file (same package) — no new `internal/testdata/` entry.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/service/ -run 'TestProcessPositionSync_|TestProcessAccountDeregistered_|TestBoundedRetry_|TestClassifyConsumerErr_|TestStreamEventsFrom_|TestProcessOrderFill_' -count=1 -v
cd services/xstockstrat-portfolio && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # confirm ≥ 40%
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
```
New logic is in `internal/service/` (excluded package); the targeted tests are the behavioural proof.

---

### Step 9 — service: D-48 per-row `GetOfflineStates` decode and `readValuation.unavailable`

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go` — modify
- `services/xstockstrat-portfolio/internal/service/offline_valuation.go` — modify
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify (sentinel only)

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy

**Codebase Evidence**:
- `func (r *PortfolioRepo) GetOfflineStates(ctx context.Context, userID string, accountIDs []string) (map[string]OfflineState, error)`
  (`portfolio_repo.go:499`): Query error `:507-509`, Scan error `:516-518`, whole-call
  `return nil, fmt.Errorf("decode recent fills for %s: %w", id, err)` (`:521-523`), `rows.Err` `:527-529`.
  Single production caller: `offline_valuation.go:99` (`grep -rn GetOfflineStates --include=*.go`, non-test).
- `type readValuation struct { states ...; accounts ... }` (`offline_valuation.go:28-31`); `valueRead`
  (`:75`) builds `ids` from explicit ids plus offline-sourced positions (`:76-92`), returns early when empty
  (`:93-97`), then `states, err := s.repo.GetOfflineStates(...)` with the Warn + empty-map substitution
  (`:99-103`).
- Sentinel precedent `var ErrQuotesUnavailable = errors.New("quotes unavailable")` (`portfolio_service.go:718`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Change `GetOfflineStates` to return `(map[string]OfflineState, map[string]error, error)`. Query, Scan and
   `rows.Err` failures stay whole-call errors (`nil, nil, err`). A `json.Unmarshal` failure for row `id`
   records `failed[id] = fmt.Errorf("decode recent fills for %s: %w", id, err)` and `continue`s (the account
   is absent from `out`). Update its doc comment (≤ 2 lines).
2. Add `unavailable map[string]bool` to `readValuation` and a method
   `func (v readValuation) degraded(accountID string) bool { return v.unavailable[accountID] }`.
3. In `valueRead`, replace `:99-103`: on a whole-call error, Warn
   `"offline state unavailable"` (keep the message for log continuity) with `errors.Join(ErrOfflineStateUnavailable, err)`
   and mark **every id in `ids`**; for each `failed` entry, Warn with the account id and mark only that id.
   Only ids passed to `GetOfflineStates` can be marked, so broker accounts never are. `states` stays a non-nil
   map. The quote/bars path below is unchanged.
4. Add `var ErrOfflineStateUnavailable = errors.New("offline state unavailable")` beside `ErrQuotesUnavailable`
   (`portfolio_service.go:718`). It is used for logs and tests only; no read returns it and no handler mapping
   changes (`portfolio_handler.go:60`, `:84`, `:416`, `:432` stay as is — design §4).

**Verification**:
```bash
grep -n 'map\[string\]OfflineState, map\[string\]error, error' services/xstockstrat-portfolio/internal/repository/portfolio_repo.go
grep -n 'unavailable map\[string\]bool\|func (v readValuation) degraded' services/xstockstrat-portfolio/internal/service/offline_valuation.go
grep -n 'ErrOfflineStateUnavailable = errors.New' services/xstockstrat-portfolio/internal/service/portfolio_service.go
cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 10 — test: per-row decode isolation and `valueRead` marking

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/offline_realized_test.go` — modify
- `services/xstockstrat-portfolio/internal/service/offline_valuation_test.go` — modify

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy

**Codebase Evidence**:
- `TestGetOfflineStates_UserScoped` (`offline_realized_test.go:42`, call `got, err := repo.GetOfflineStates(...)`
  `:55`) and `TestGetOfflineStates_EmptyIDsNoQuery` (`:74`, call `:80`) — both must take the 3-value return.
- `expectOfflineStates(mock, userID)` (`offline_valuation_test.go:267`), `offlineListSvc` (`:273`),
  `offlinePosRow` (`:262`).

**TDD**: `red-green required` — the pre-Step-9 repo fails the whole batch on one bad row.

**Covers**: `AC-8`

**Instructions**:
1. Update the two existing repo tests for the 3-value return (assert `failed` empty).
2. Add `TestGetOfflineStates_AC8_UndecodableRowFailsOnlyThatAccount`: rows for `off-1` (`recent_fills` =
   `[]byte("{not json")`) and `off-2` (valid) → no whole-call error; `out` has `off-2` only; `failed` has
   `off-1`.
3. Add `TestGetOfflineStates_ScanErrorStaysWholeCall` (row-error → `nil, nil, err`).
4. In `offline_valuation_test.go`, add `TestValueRead_WholeCallErrorMarksEveryRequestedID` and
   `TestValueRead_RowFailureMarksOnlyThatID` (the broker position, `Source == POSITION_SOURCE_UNSPECIFIED`, is
   never marked).
5. C-13: the corrupt JSON literal is a single-consumer scenario one-off — inline.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/repository/ ./internal/service/ -run 'TestGetOfflineStates_|TestValueRead_' -count=1 -v
cd services/xstockstrat-portfolio && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # confirm ≥ 40%
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
```
New logic is in `internal/repository/` and `internal/service/` (excluded packages); the targeted tests are the
behavioural proof.

---

### Step 11 — service: D-48 degraded marker and zeroing on every read path

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify (`applyAccountPnL`, `buildAccountPortfolio`, callers, aggregate)
- `services/xstockstrat-portfolio/internal/service/offline_valuation.go` — modify (`markDegradedPositions`, beside `readValuation.degraded`)

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy, position snapshot consistency

**Codebase Evidence**:
- `applyAccountPnL(p, positions, bal, st, acct)` (`portfolio_service.go:1339`): sums `positionsValue` and
  `unrealizedPnl` (`:1340-1348`), sets `p.Equity`/`p.TotalPnl = unrealizedPnl` (`:1349-1350`), broker branch
  (`:1351-1358`), `if st == nil { return }` (`:1359-1361`) — the unrealized-only total that D-48 leaks — then the
  offline fields (`:1362-1370`).
- Callers: `GetPortfolio` scoped `:645`, aggregate loop `:654`; `buildAccountPortfolio` (`:1326`, calls
  `applyAccountPnL` at `:1333`) from `ListPortfolios` single-account `:1420` and all-accounts `:1472`.
- GetPortfolio aggregate (`:650-677`): `allOffline := len(scope) > 0` (`:650`), per-account sums of
  `dayPnl`/`totalPnl` (`:655-656`), `prior`/`absCost` switch (`:657-666`), `equity` over all positions
  (`:668-670`), `TotalPnlPct` only when `allOffline` (`:675-677`).
- `enrichPositions` (`:445-448`) discards `valueRead`'s result; `GetPosition` (`:682`, call `:688`),
  `ListPositions` (`:693`, call `:709`).
- Offline position Day P&L comes from `RecentFills` (`offline_valuation.go:195-205`, `:242-246`).
- Trading callers (fails.md:2935 enumeration) — all keep working because position reads stay OK and
  Qty/marks/equity are valid: `trading.go:2089` (reconcile `ListPositions`, reads `p.Qty` only, `:2097-2100`),
  `:2793` (`flattenAndHalt` `GetPosition`, reads `position.Qty`, `:2801-2809`), `:3158`
  (`resolveAccountEquity` `ListPortfolios`, reads `Portfolios[0].Equity`, `:3165`), `:3535` (REDUCE_ONLY
  `GetPosition`, reads `pos.Qty`, `:3546`). No trading change.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add a `degraded bool` parameter to `applyAccountPnL` and `buildAccountPortfolio`; pass
   `val.degraded(id)` at every caller (`:645`, `:654`, `:1420`, `:1472`). When `degraded`:
   set `p.OfflineStateUnavailable = true`; keep `p.Equity = positionsValue`; set `TotalPnl`, `DayPnl`,
   `DayPnlPct` to 0; leave `TotalPnlPct`, `RealizedPnl`, `RealizedPnlLifetime`, `FeesSinceSnapshot`,
   `FeesLifetime` nil; return before the broker/offline branches. (A degraded id is never a broker id —
   Step 9 — so `bal` is nil there.)
2. Add, in `offline_valuation.go` beside `readValuation.degraded` (Step 9),
   `func markDegradedPositions(positions []*portfoliov1.Position, v readValuation)`: for each position with
   `Source != POSITION_SOURCE_UNSPECIFIED` whose `AccountId` is degraded, set `DayPnl = 0`, `DayPnlPct = 0`,
   `OfflineStateUnavailable = true`. Broker rows are untouched.
3. Call it in `enrichPositions` (`:445`) with the `valueRead` result (so `GetPosition`/`ListPositions` stay OK
   and never fail on offline-state unavailability), in `GetPortfolio` after `valueRead` (`:630`), and in both
   `ListPortfolios` branches after `valueRead` (`:1417`, `:1468`), so embedded positions match (C-10(b) parity,
   `@AC-29 @feature-240`).
4. GetPortfolio aggregate: for a degraded id, skip the `dayPnl`/`totalPnl`/`prior`/`absCost` contributions,
   set `portfolio.OfflineStateUnavailable = true` and force `allOffline = false`; `equity` still sums every
   position (`:668-670`). The scoped branch (`:644-647`) gets the marker through `applyAccountPnL`.
5. Do not add any UNAVAILABLE mapping in `internal/handler/portfolio_handler.go`.

**Verification**:
```bash
grep -n 'OfflineStateUnavailable = true\|func markDegradedPositions\|val.degraded(' services/xstockstrat-portfolio/internal/service/portfolio_service.go services/xstockstrat-portfolio/internal/service/offline_valuation.go
git diff --quiet -- services/xstockstrat-portfolio/internal/handler/ && echo "handler untouched"
cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 12 — test: AC-3 on all four reads, AC-8 isolation, aggregate exclusion, sweep of non-fatal-read tests

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/offline_account_pnl_test.go` — modify
- `services/xstockstrat-portfolio/internal/service/offline_valuation_test.go` — modify
- `services/xstockstrat-portfolio/internal/service/portfolio_quote_deadline_test.go` — modify (comment + expectations only if the sweep requires it)

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy, position snapshot consistency

**Codebase Evidence**:
- `TestAccountPnL_OfflineStatesErrorIsNonFatal` (`offline_account_pnl_test.go:230-247`) asserts the old
  behaviour (`expectStates(mock, "u1", nil).WillReturnError(errors.New("db down"))`, `GetPortfolio` succeeds,
  Warn `"offline state unavailable"`). It becomes the GetPortfolio AC-3 marker test.
- Helpers: `acctScenario` (`:27-50`), `expectStates` `:52`, `expectBalanceList` `:71`, `expectOfflineIDList`
  `:79`, `acctSvc` `:94`, `getPortfolioAcc` `:102`, `listPortfoliosAcc` `:116`, `bothReads` `:131`,
  `TestAC29_OfflineReadParity` `:328`, `TestGetPortfolio_AC39_BrokerOfflineAndAggregate` `:377`,
  `TestGetPortfolio_AC52_NoRowsRevealsNothing` `:423`.
- Supersession of the feature-240 "non-fatal state read" decision is recorded in `design.md:149` and the
  sdd-design session of context.md, inside the design the operator approved at the r3 gate. It is a recorded
  240 decision (`240-offline-account-full-pnl/context.md:399`, `:771`), not a durable `@AC-*` business rule:
  `grep -rni 'non-fatal\|GetOfflineStates' docs/sdd/business-rules/` → no hit, so no C-16 CHANGE applies.
- `portfolio_quote_deadline_test.go:115` (in the `expectAllAccounts` doc comment `:114-115`): "GetOfflineStates is left unexpected (its error is non-fatal)" in
  `expectAllAccounts` — an unexpected pgxmock query now marks the offline ids degraded instead of being
  silently ignored, so callers asserting offline P&L under this helper must be swept.
- Fixture homes: `internal/testdata/` exists (`marks.go`, `offline_pnl.go`; `testdata.Aapl`, `testdata.AaplMid`,
  `testdata.LiveQuote` used at `:232-233`).

**TDD**: `red-green required` — on the pre-Step-11 tree no marker is set and TotalPnl is unrealized-only.

**Covers**: `AC-3, AC-8`

**Instructions**:
1. Rewrite `TestAccountPnL_OfflineStatesErrorIsNonFatal` → `TestGetPortfolio_AC3_OfflineStateErrorMarksDegraded`
   (realized 500.00 state, AAPL unrealized 100.00): call succeeds; `pf.OfflineStateUnavailable` true;
   `TotalPnl`, `DayPnl`, `DayPnlPct` 0; `RealizedPnl`/`TotalPnlPct` nil; `Equity` equals the priced market
   value; embedded position marked with `DayPnl` 0. Keep the Warn assertion.
2. Add AC-3 cases for `ListPortfolios` (scoped and all-accounts), `ListPositions` and `GetPosition`: each
   returns OK; offline Portfolio/Position carries the marker; no `total_pnl` 100.00 and no non-zero offline
   `day_pnl`. Use `bothReads` where it fits.
3. Add `TestListPortfolios_AC8_UndecodableRowDegradesOnlyItsAccount`: `acct-off-1` corrupt, `acct-off-2` realized
   200.00, broker `acct-alp-1` day 120.00 → only `acct-off-1` marked; `acct-off-2` total 200.00; broker figures
   unchanged (`@AC-14 @feature-157` PRESERVE).
4. Add `TestListPositions_DegradedOfflineKeepsBrokerRows`: an unscoped ListPositions with one broker and one
   degraded offline position returns both; only the offline row is marked.
5. Add `TestGetPortfolio_AggregateExcludesDegradedAccount`: broker + degraded offline → aggregate `DayPnl`/
   `TotalPnl` equal the broker's alone, `TotalPnlPct` nil (allOffline forced false), aggregate marker true,
   `Equity` still includes the offline market value.
6. Sweep: run the whole package; any test that relied on an unexpected `GetOfflineStates` being non-fatal gets
   an explicit `expectStates`/`expectOfflineStates`, or asserts the marker if degradation is the point. Update
   the `portfolio_quote_deadline_test.go:114-115` comment to the new contract. `TestAC29_OfflineReadParity`,
   `..._AC39_...` and `..._AC52_...` must stay green unchanged (PRESERVE).
7. C-13: the 500.00/100.00/200.00/120.00 values are scenario literals in one file; reuse
   `internal/testdata` symbols for symbols/quotes; a second-consumer literal moves to `internal/testdata/offline_pnl.go`
   in this step.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/service/ -run 'AC3_|AC8_|DegradedOffline|AggregateExcludesDegraded|TestAC29_|AC39_|AC52_' -count=1 -v
cd services/xstockstrat-portfolio && GOWORK=off go test ./... -race -count=1
cd services/xstockstrat-portfolio && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"   # confirm ≥ 40%
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -rn 'error is non-fatal' services/xstockstrat-portfolio/internal/service/*_test.go   # expect no hit
```
New logic is in `internal/service/` (excluded package); the targeted tests are the behavioural proof.

---

### Step 13 — service: UI gating on `offlineStateUnavailable` (consumer grep + every P&L surface)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/portfolioTotals.ts` — modify
- `services/xstockstrat-ui/src/components/trader/PortfolioPanel.tsx` — modify
- `services/xstockstrat-ui/src/components/trader/OrderBook.tsx` — modify
- `services/xstockstrat-ui/src/app/trader/portfolio/page.tsx` — modify
- `services/xstockstrat-ui/src/app/trader/positions/page.tsx` — modify
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — modify
- `services/xstockstrat-ui/src/components/insights/AccountPortfolioSelector.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, analytics display accuracy

**Scope note (impl-spec review, >5 files)**: kept as one step on purpose. All seven files consume the one
`PNL_UNAVAILABLE_LABEL` / `incomplete` contract added in `portfolioTotals.ts`, and Step 14's Playwright run
is the single gate for the consumer surface (C-14); a partial landing would leave some `/trader` surfaces
rendering the zeroed figures as `$0`. If `/sdd-execute` prefers a split, cut it after instruction 4
(totals + PortfolioPanel + OrderBook + Book page) and record that in the Deviation Log.

**Codebase Evidence**:
- Consumer grep (`grep -rln 'usePortfolios\|usePortfolio\b\|usePositions\|usePosition\b\|dayPnl\|totalPnl' src`,
  non-test) → `PortfolioPanel.tsx`, `OrderBook.tsx`, `AccountPortfolioSelector.tsx`, `hooks/usePortfolio.ts`,
  `trader/portfolio/page.tsx`, `trader/positions/[symbol]/page.tsx`, `trader/positions/page.tsx`,
  `insights/attribution/page.tsx` (its `totalPnl` is an attribution row, not a Portfolio — out of scope),
  `lib/portfolioTotals.ts`.
- `portfolioTotals.ts`: `PortfolioFigures` (`:3-14`), `PortfolioTotals` (`:16-26`), `sumPortfolioTotals`
  (`:29-56`) sums `dayPnl`/`totalPnl` for every account (`:48-49`).
- `PortfolioPanel.tsx`: `OfflinePnlStats` (`:21-`) renders Day/Total (`:24-37`); single broker Day/Total
  (`:100-109`); combined totals (`:155`, Day `:165-169`, Total `:170-174`); per-account Day (`:210-214`);
  error notice `:67`.
- `OrderBook.tsx` `PortfolioSummary` (`usePortfolio` → GetPortfolio): Day P&L `:126-130`, Total `:131`.
- `trader/portfolio/page.tsx`: `combined = sumPortfolioTotals(...)` (`:38`), combined Day/Total (`:165-172`),
  per-account Day/Total (`:207-217`), positions-table Day P&L column (`:95-99`), error notice `:147`.
- `trader/positions/page.tsx`: Day P&L columns (`:201-223`), detail "Today's P/L" (`:656-660`, already gated
  by `unpriced(selected) ? dash : ...`).
- `trader/positions/[symbol]/page.tsx`: Day P&L `:798-799`, `:848-849`, `:898-899`.
- `insights/AccountPortfolioSelector.tsx`: aggregate `dayPnl` (`:35`), selected Day/Total (`:100-105`), aggregate
  Day (`:128-129`).
- `CardNotice` variants `'muted' | 'error'` (`src/components/shared/CardNotice.tsx:10`); C-17 state primitive.
- Proto TS field after Step 2: `offlineStateUnavailable: boolean` on `Portfolio` and `Position`
  (`@xstockstrat/proto/portfolio/v1/portfolio_pb`, imported by `hooks/usePortfolio.ts:4`).

**TDD**: `red-green required` (Step 14's vitest + Playwright cases fail before this step)

**Covers**: —

**Instructions**:
1. `portfolioTotals.ts`: add `offlineStateUnavailable?: boolean` to `PortfolioFigures`, `incomplete: boolean` to
   `PortfolioTotals`, and `export const PNL_UNAVAILABLE_LABEL = 'P&L unavailable';`. In `sumPortfolioTotals`, a
   degraded account still adds `equity` (and broker-only cash/BP, which it never has) but skips the
   Day/Total/realized/fee sums and sets `incomplete = true`.
2. `PortfolioPanel.tsx`: `OfflinePnlStats` and the per-account card show `PNL_UNAVAILABLE_LABEL` in place of the
   Day/Total values when `portfolio.offlineStateUnavailable`, plus a
   `<CardNotice variant="muted">Offline P&L temporarily unavailable</CardNotice>`-style line (reuse
   `CardNotice`, no new primitive — C-17); the combined card shows `PNL_UNAVAILABLE_LABEL` for Day/Total when
   `totals.incomplete`. Cash/Buying Power gating for offline accounts is unchanged
   (`@AC-2/@AC-3/@AC-4 @feature-159` PRESERVE).
3. `OrderBook.tsx` `PortfolioSummary`: when `data.offlineStateUnavailable`, Day and Total stats show
   `PNL_UNAVAILABLE_LABEL`.
4. `trader/portfolio/page.tsx`: combined Day/Total use `PNL_UNAVAILABLE_LABEL` when `combined.incomplete`;
   per-account Day/Total use it when `p.offlineStateUnavailable`; the positions-table Day P&L cell uses it when
   `row.original.offlineStateUnavailable`.
5. `trader/positions/page.tsx` and `trader/positions/[symbol]/page.tsx`: every Day P&L / Day % cell or stat
   shows `PNL_UNAVAILABLE_LABEL` when `position.offlineStateUnavailable` (extend the existing `unpriced(...) ? dash`
   conditional at `:657-660`; no new component). Broker rows stay visible (no error state added).
6. `insights/AccountPortfolioSelector.tsx`: skip degraded portfolios in the aggregate `dayPnl` (`:35`) and show
   `PNL_UNAVAILABLE_LABEL` for the selected/aggregate Day/Total when any summed portfolio is degraded.
7. Tokens only (`text-muted-foreground` etc.), no hardcoded colours (C-17). `ConfirmFillDialog.tsx` and
   `useConfirmOrder.ts` need no change: `onError` (`ConfirmFillDialog.tsx:47-49`) already renders
   `ConnectError.rawMessage` in the destructive `Alert` for the FR-5 INVALID_ARGUMENT and FR-6 UNAVAILABLE
   messages.

**Verification**:
```bash
grep -rn 'PNL_UNAVAILABLE_LABEL\|offlineStateUnavailable\|incomplete' services/xstockstrat-ui/src --include=*.ts --include=*.tsx | grep -v '\.test\.'
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit
```

---

### Step 14 — test: UI vitest + Playwright for every gated surface and the confirm-fill error path

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/portfolioTotals.test.ts` — modify
- `services/xstockstrat-ui/e2e/trader/offline-pnl.spec.ts` — modify
- `services/xstockstrat-ui/e2e/trader/offline-accounts.spec.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/portfolios.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/positions.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify

**Reviewers**: `xstockstrat-ui` owner — trading UI correctness, analytics display accuracy

**Codebase Evidence**:
- `portfolioTotals.test.ts` imports `sumPortfolioTotals` (`:2`).
- `offline-pnl.spec.ts`: route constants `LIST_ACCOUNTS`/`LIST_PORTFOLIOS`/`LIST_POSITIONS`/`GET_POSITION`
  (`:20-23`), `routeJson` (`:25-33`), `openOfflinePanel` (`:35-45`), `statValue` (`:53-56`); existing
  `@AC-14` (`:59`), `@AC-15` (`:80`), `@AC-30` (`:100`), `@AC-16` (`:135`), `@AC-31` (`:157`) tests.
- `offline-accounts.spec.ts`: `CONFIRM_ORDER` route (`:20`), `@AC-5 @feature-157` confirm test (`:120-173`)
  with the dialog placeholders `Filled quantity` / `Average fill price`; no ConfirmOrder error case exists
  (recon.md).
- Fixtures: `PORTFOLIO_OFFLINE_FULL_PNL` (`e2e/fixtures/portfolios.ts:59`), `PORTFOLIO_ALPACA_AC30`,
  `POSITION_OFFLINE_AAPL` (`e2e/fixtures/positions.ts:59`); catalog rows `INVENTORY.md:17`, `:41`.

**TDD**: `red-green required`

**Covers**: `AC-3, AC-4, AC-5`

**Instructions**:
1. vitest: `sumPortfolioTotals` with one degraded offline figure → `incomplete` true, its Day/Total/realized
   excluded, equity included; healthy inputs → `incomplete` false and totals unchanged (`@AC-30 @feature-240`).
2. Fixtures (C-12): add `PORTFOLIO_OFFLINE_DEGRADED` (`{ ...PORTFOLIO_OFFLINE_FULL_PNL, offlineStateUnavailable: true, dayPnl: 0, dayPnlPct: 0, totalPnl: 0 }` with realized/fee/totalPnlPct fields removed)
   and `POSITION_OFFLINE_AAPL_DEGRADED` (`{ ...POSITION_OFFLINE_AAPL, offlineStateUnavailable: true, dayPnl: 0, dayPnlPct: 0 }`);
   export them via `e2e/fixtures/index.ts` (already re-exports the module) and add `INVENTORY.md` rows (feature 256).
3. `offline-pnl.spec.ts` (a `describe('Offline state unavailable (feature 256)')` block, `page.route` pattern):
   - `@AC-3` trader card (PortfolioPanel single account) shows `P&L unavailable`, never `+$1,300.00`/unrealized-only.
   - `@AC-3` combined panel with `PORTFOLIO_ALPACA_AC30` + the degraded offline portfolio shows `P&L unavailable`
     for the combined Day/Total, and the broker card's Day P&L is unchanged.
   - `@AC-3` Book page `/trader/portfolio` combined and per-account cards.
   - `@AC-3` positions table and `/trader/positions/AAPL` detail show `P&L unavailable` for the degraded offline
     position while a broker row stays visible.
   - `@AC-3` OrderBook `PortfolioSummary` (route `GetPortfolio` with the degraded portfolio).
4. `offline-accounts.spec.ts`: two confirm-dialog error cases — route `CONFIRM_ORDER` to a Connect error
   (`status: 400`, body `{"code":"invalid_argument","message":"filled_avg_price must be a finite number >= 0 when filling"}`)
   → `@AC-4` the dialog stays open and shows that message; and `{"code":"unavailable","message":"positions not published; re-confirm to retry"}`
   (`status: 503`) → `@AC-5` the dialog shows the message and the order is not shown as FILLED. Error payloads
   are scenario one-offs (inline, C-12 exempt).
5. Do not change shared `e2e/mock-backend.ts` defaults.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:unit -- src/lib/portfolioTotals.test.ts
cd services/xstockstrat-ui && pnpm exec playwright test e2e/trader/offline-pnl.spec.ts e2e/trader/offline-accounts.spec.ts
cd services/xstockstrat-ui && pnpm run lint
grep -n "from '../fixtures'\|helpers/auth" services/xstockstrat-ui/e2e/trader/offline-pnl.spec.ts services/xstockstrat-ui/e2e/trader/offline-accounts.spec.ts
grep -n 'PORTFOLIO_OFFLINE_DEGRADED\|POSITION_OFFLINE_AAPL_DEGRADED' services/xstockstrat-ui/e2e/fixtures/INVENTORY.md
```
`xstockstrat-ui` has no CI coverage threshold beyond the vitest `src/lib/**` scope; the e2e run is the gate.

---

### Step 15 — test: agent pass-through of the marker and the FR-5/FR-6 errors (no agent code change)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_offline_client.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape)

**Codebase Evidence**:
- `_grpc_error_message` (`services/xstockstrat-agent/app/tools.py:223-240`): `INVALID_ARGUMENT` →
  `exc.details() or "invalid argument"` (`:238-239`); any other code incl. `UNAVAILABLE` →
  `exc.details() or str(code)` (`:240`).
- `list_positions` (`app/client.py:2357`) returns
  `MessageToDict(p, preserving_proto_field_name=True, always_print_fields_with_no_presence=True)` per position
  (`:2377-2381`), so `offline_state_unavailable` appears as a key after Step 2.
- `stub.ConfirmOrder` (`app/client.py:2277`) passes errors through; `manage_offline_account` catches
  `grpc.aio.AioRpcError` (`app/tools.py:2147`).
- Existing tests: `test_confirm_offline_order_forwards_user_and_returns_derived_status` (`tests/test_offline_client.py:31`),
  `test_list_account_positions_forwards_user_id_via_header` (`:136`).

**TDD**: `N/A (characterization of existing pass-through — no agent code changes; the marker case is red only before Step 2's stubs exist)`

**Covers**: `AC-3, AC-4, AC-5`

**Instructions**:
1. Add `test_list_positions_passes_offline_state_unavailable`: the fake `ListPositions` returns a
   `portfolio_pb2.Position(offline_state_unavailable=True, day_pnl=0)` → the dict carries
   `offline_state_unavailable: True` and `day_pnl: 0`; a healthy position carries `False`.
2. Add tool-level tests (in this file, following the `:31` pattern) that a `ConfirmOrder` raising
   `INVALID_ARGUMENT` with details `"filled_qty must be a finite number >= 0"` and one raising `UNAVAILABLE`
   with `"positions not published; re-confirm to retry"` surface those exact details through
   `manage_offline_account`'s error output.
3. C-13: the file uses `unittest.mock` fakes, no conftest fixture (single consumer); the error literals are scenario one-offs.
4. No change to `docs/runbooks/mcp-tools.md` or the strat-lab plugin: tool names, parameters and shapes are
   unchanged (the new key is additive in an already-dict-passthrough response).

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest tests/test_offline_client.py -q
cd services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40 -q
cd services/xstockstrat-agent && ruff check . && ruff format --check .
```

---

### Step 16 — docs: service docs for the new retry/park, degrade and confirm contracts

**Status**: `pending`
**Service**: `docs`
**Files**:
- `services/xstockstrat-portfolio/CLAUDE.md` — modify
- `services/xstockstrat-portfolio/docs/context-constitution.md` — modify
- `services/xstockstrat-trading/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-portfolio/CLAUDE.md:35` "Offline valuation (feature 240)" paragraph; `:119`
  `account.positions.synced` / `ConsumePositionSyncs` consumer row.
- `services/xstockstrat-portfolio/docs/context-constitution.md:22` **PORTFOLIO-3** ("the other consumers are
  wrapped in `ackAlways` (best-effort)"); `:30` **PORTFOLIO-11** (`GetOfflineStates` read applied by
  `applyAccountPnL`).
- `services/xstockstrat-trading/CLAUDE.md:29` "Offline confirm fields (feature 240)" (fees ≥ 0 before any load).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Portfolio `CLAUDE.md:119` (`ConsumePositionSyncs` row): add that offline write failures are retried via
   `boundedRetry` (SQLSTATE class 22/23 park after 5 attempts; transient 08/40/53/57, deadline and network
   errors never park; unclassified park after ≥ 5 attempts and ≥ 10 min), a park is one Error log
   `"event parked"`, and **a parked event self-heals on the next boot because `lastSeq` starts at 0 and the
   full history replays** (absolute recompute makes replay safe). Same retry note for the
   `account.deregistered` row, including the option-(a) broker scope.
2. Portfolio `CLAUDE.md:35`: replace the non-fatal state-read wording with the per-account degrade
   (`readValuation.unavailable`, `offline_state_unavailable` on Portfolio 17 / Position 26, zeroed Day/Total,
   position reads never fail).
3. `docs/context-constitution.md` PORTFOLIO-3: the sync and deregistration consumers now return errors through
   `boundedRetry`; only the bracket and balance consumers keep `ackAlways`. PORTFOLIO-11: the per-row decode and
   the marker. Record the head-of-line-blocking-during-outage and "park is log-only" acceptances there.
4. Trading `CLAUDE.md:29`: `filled_qty` must be finite and ≥ 0, `filled_avg_price` finite and ≥ 0 when
   `filled_qty > 0`, both INVALID_ARGUMENT before the load; ConfirmOrder returns UNAVAILABLE
   "positions not published; re-confirm to retry" when the recompute/emit fails (re-confirm is idempotent).
5. Then run `/context-forge:context-constitution refresh` scoped to these three files (root CLAUDE.md Teardown);
   if the plugin is unavailable, re-read each file against the code by hand and record that in the PR body.

**Verification**:
```bash
grep -n 'boundedRetry\|lastSeq\|event parked' services/xstockstrat-portfolio/CLAUDE.md services/xstockstrat-portfolio/docs/context-constitution.md
grep -n 'offline_state_unavailable' services/xstockstrat-portfolio/CLAUDE.md
grep -n 'filled_avg_price\|positions not published' services/xstockstrat-trading/CLAUDE.md
```

---

## Dev smoke (after integration, before launch)

- Read-only NaN detection over confirmed offline orders (design §1, Open Risk "rows that already hold NaN/Inf";
  `filled_qty`/`filled_avg_price` are `NUMERIC(18,8)`, `services/xstockstrat-trading/migrations/001_orders_hypertable.up.sql:15,18`;
  offline is `broker_type = 3`, `011_offline_fees_snapshot_headers.up.sql:6`), run through
  `docs/runbooks/operator-db-access.md`:
  `SELECT order_id, account_id FROM trading.orders WHERE broker_type = 3 AND (filled_qty = 'NaN'::numeric OR filled_avg_price = 'NaN'::numeric);`
  Re-confirm every hit through the ConfirmOrder RPC with valid values before launch.
- Grep dev logs for `"event parked"` after the first deploy (boot replay) and record the count in context.md.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

- Pre-entered at impl-spec review (2026-10-22): Step 5 — `emitLedgerEvent` becomes a void wrapper over
  `appendLedgerEvent`, so its 26 non-confirm callers gain one Unavailable retry (worst case 10s → 20.1s per
  emit during a ledger outage). Operator to confirm, or choose a no-retry path for those callers (context.md
  Open Threads).
- Pre-entered at impl-spec review (2026-10-22): Step 7 — deregistration retry option (a) covers broker
  accounts too, a scope extension beyond the product spec's offline-only Trading-Domain Scope. Needs explicit
  operator sign-off before Step 7 runs (C-16/P-03); option (b) means a Step 7 re-spec.
- Step 1 (2026-10-28, verification method only, no spec change): `buf breaking` ran against `git archive`
  snapshots of `origin/feature/fix-offline-book-consistency` and `origin/main-dev` (`packages/proto`) instead of
  the `.git#branch=` inputs, which cannot be resolved from an isolated worktree. Both passed; the main-dev check
  also passed without the CI `--exclude-path trading/v1/trading.proto`.
- Step 2 (2026-10-28, Files list gap, no spec change): `buf-gen.sh` also regenerated the ts-proto outputs
  `gen/ts/portfolio/v1/portfolio.ts`, `gen/ts/dist/portfolio/v1/portfolio.js` and `.../portfolio.d.ts`. The
  step's **Files** does not list them. They are committed with the step, as Instruction 2 directs (stage every
  regenerated `portfolio/v1` file). As the spec expects, the gRPC/Connect stubs did not change.
- Step 2 (2026-10-28, toolchain, no spec change): the host `~/go/bin/protoc-gen-go` v1.36.11 was built with
  go1.24.7. It reformatted doc comments in `gen/go/analysis/v1/analysis.pb.go`, which is outside `portfolio/v1`.
  Following the runbook, the pinned plugins (protoc-gen-go v1.36.11, -go-grpc v1.6.2, -connect-go v1.19.2) were
  rebuilt under `GOTOOLCHAIN=go1.27.0`, the toolchain CI and `Dockerfile.codegen` use. After the rebuild the
  diff touches only `portfolio/v1`.
- Step 3 (2026-10-28, verification method only, no spec change): the host `~/go/bin/golangci-lint` v2.14.0 was
  built with go1.26 and refuses the module's `go 1.27.0` target ("can't load config"). It was rebuilt at the same
  pinned version under `GOTOOLCHAIN=go1.27.0` into a scratch GOBIN, matching CI's Go 1.27, and reported 0 issues.
  **Disposition**: CI-equivalent fallback. The RED/GREEN run used a throwaway test file that was not committed;
  Step 4 owns the durable tests in `trading_offline_test.go`.
- Step 4 (2026-10-28, verification method only, no spec change): `golangci-lint` v2.14.0 was rebuilt under
  `GOTOOLCHAIN=go1.27.0` into a scratch GOBIN, as in Step 3, and reported 0 issues. **Disposition**: CI-equivalent
  fallback. Step 3 had already landed, so RED was captured by temporarily restoring the pre-Step-3 `trading.go`
  (`12a29f1b`) under the new tests, then restoring it (not committed). `@AC-7` and `@AC-10` pass on both trees by
  design: they are non-regression guards. `TestDeriveOfflineStatus` was not extended (instruction 4: "only if needed").
- Step 5 (2026-10-29, scope expansion, operator Option A): `ledger_emit_mtls_test.go` added to the step's **Files**.
  `TestEmitLedgerEventFailSoftOneShot` asserted feature 210's one-shot emit and contradicted the void-wrapper retry.
  It is renamed `TestEmitLedgerEventFailSoftBoundedRetry` and now expects `appendMaxAttempts` attempts (still
  fail-soft and bounded). This supersedes feature 210's one-shot note for `emitLedgerEvent`; the 2026-10-22
  "retry for all callers" decision stands, closing the pre-entered Step 5 item above.
- Step 5 (2026-10-29, side effect, flagged for the operator): `appendLedgerEvent` returns the `structpb.NewStruct`
  error (Instruction 2), so the void wrapper now Warns and skips the append when a payload cannot be encoded.
  `order_intent.go:156` puts a `time.Time` (`out.UpdatedAt`) in the `order_intent.reclaimed_unknown` payload, which
  `NewStruct` rejects. Before this step that event was appended with an empty payload; now it is not appended. No
  code consumes the event. A one-line follow-up (`out.UpdatedAt.Format(time.RFC3339Nano)`) is outside this step's
  **Files** and is carried as an open item.
- Step 5 (2026-10-29, implementation detail, no spec change): the retry backoff waits on `ctx.Done()` as well as the
  timer, so a cancelled caller stops retrying early.
- Step 5 (2026-10-29, verification method only, no spec change): `golangci-lint` v2.14.0 was rebuilt under
  `GOTOOLCHAIN=go1.27.0` into a scratch GOBIN, as in Steps 3-4, and reported 0 issues. **Disposition**: CI-equivalent
  fallback. RED was captured with a throwaway ConfirmOrder test that was not committed (Step 6 owns the durable tests).
- Step 6 (2026-10-29, verification method only, no spec change): `golangci-lint` v2.14.0 rebuilt under
  `GOTOOLCHAIN=go1.27.0` into a scratch GOBIN, as in Steps 3-5, reported 0 issues. **Disposition**: CI-equivalent
  fallback. Step 5 had already landed, so RED was captured by temporarily restoring the pre-Step-5 `trading.go` and
  `ledger_emit_mtls_test.go` (`ff62180f~1`) under the new tests, then restoring them (not committed). On that tree
  `TestAppendLedgerEvent_*` and `TestOfflineRecomputeTimeout_*` fail to compile (the symbols do not exist), so the
  behavioural RED ran with those two removed. `TestRecomputeEmit_PayloadKeepsUserID` passes on both trees by design
  (non-regression guard, fails.md:2054). The test file adds one helper beyond the instructions, a `setFailFn` setter,
  so the hook is swapped under the ledger mutex.
- Steps 7 + 8 (2026-10-29, operator decision "B: merge Steps 7+8", session question tool): the two steps land as
  **one** lint-green commit with one red→green cycle on Step 8's tests. This breaks one-commit-per-step on purpose:
  Step 7 alone cannot compile the service tests, because the three void call sites
  (`portfolio_offline_test.go:257`, `:307`, `portfolio_fill_sync_race_test.go:84`) must take the new return value.
  The race test checks it with `t.Errorf` inside its goroutine (`t.Fatalf` is not goroutine-safe). Both steps are
  marked done in that commit. Option (a) for deregistration scope was already signed off on 2026-10-22 (context.md).
- Steps 7 + 8 (2026-10-29, Files gap, spec-sanctioned): `portfolio_quote_deadline_test.go` — `warnRecorder.Handle`
  now records Warn **and** Error (`r.Level < slog.LevelWarn` skips), as Step 8 instruction 2 allows ("extended to
  Error level if needed"), so the AC-6 test can read the `"event parked"` Error. The existing callers look records
  up by message only, so they are unaffected.
- Steps 7 + 8 (2026-10-29, implementation detail, no spec change): `classifyConsumerErr` also follows a single-`Unwrap`
  chain, so a `fmt.Errorf("%w", errors.Join(...))` wrapper keeps the per-leaf precedence. The processPositionSync
  failures are wrapped with the write that failed (`upsert position <sym>`, `delete positions not in sync`,
  `upsert offline realized`), so `errors.Is` still reaches the driver error.
- Steps 7 + 8 (2026-10-29, verification method only, no spec change): `golangci-lint` v2.14.0 rebuilt under
  `GOTOOLCHAIN=go1.27.0` (scratch GOBIN), as in Steps 3-6, reported 0 issues. **Disposition**: CI-equivalent fallback.
- Steps 9 + 10 (2026-10-29, operator decision "Merge pairs + standing rule", session question tool): the two steps
  land as **one** lint-green commit with one red→green cycle on Step 10's tests, and both are marked done. Standing
  rule, quoted: "if this step's Verification fails ONLY because the consumers or tests of its new code live in the
  immediately following step [...] Execute this step and the next one together as ONE commit with one red→green cycle
  on the next step's tests, mark BOTH steps done". Step 9 alone cannot compile the repository tests
  (`offline_realized_test.go:55`, `:80` must take the 3-value `GetOfflineStates` return), and `degraded()` has no
  non-test caller until Step 11.
- Steps 9 + 10 (2026-10-29, implementation detail, no spec change): `GetOfflineStates` returns a non-nil empty
  `failed` map on success (including the empty-ids early return); the per-row Warn keeps the `"offline state
  unavailable"` message and adds `account_id`. RED was a compile failure of the new tests plus a throwaway 2-value
  AC-8 test on the pre-Step-9 repo (`decode recent fills for off-1: invalid character ...`, whole batch failed), not
  committed.
- Steps 9 + 10 (2026-10-29, verification method only, no spec change): `golangci-lint` v2.14.0 rebuilt under
  `GOTOOLCHAIN=go1.27.0` (scratch GOBIN), as in Steps 3-8, reported 0 issues. **Disposition**: CI-equivalent fallback.
