# Design: fix-trading-order-state-audit

**Created**: 2026-10-21
**Rounds**: 3 (full; termination: approved — operator approval at the round-3 gate, Floor clear)
**Approved by**: user @ 2026-10-21 (operator decision, design gate round 3, recorded in context.md)
**Grounded in**: recon.md

---

## Chosen Approach

This change is internal to `xstockstrat-trading`. It has no consumer-surface change (C-14): RPC return codes
and `FailedPrecondition` messages stay as they are. The only externally visible effects are new `slog`
records and new or populated `order_intent.reclaimed_unknown` ledger events. There is no proto, migration or
config change (recon.md:109-113). The ledger stores event types verbatim (recon.md:61), so it needs no change.

Both deferred Open Questions are closed here (C-11):

- **D-04 stays log-only.** Every write happens after the broker side effect, so surfacing the error would
  invite a retry against an order the broker already holds (recon.md:143-145).
- **Only the reclaim branch is extracted.** The four-way intent-lookup switch stays (recon.md:139-142).

### Binding ctx rule (operator 2026-10-21)

Every request-derived write and emit uses `context.WithoutCancel(ctx)`. Nothing request-derived mints a fresh
`context.Background()`. The result keeps `x-trace-id`:

- `UnaryServerInterceptor` stores `PropagationData` as a ctx value (`internal/middleware/propagation.go:35-39`).
- `WithoutCancel` keeps ctx values.
- The ledger connection's `UnaryClientInterceptor` (`trading.go:184`; `propagation.go:46-52`) turns that value
  back into outgoing metadata.

No new header code is needed. Background-only work (the sweeper, the reconciliation loops, and flatten when it
originates from a loop) keeps its own ctx.

### D-04: checked order-state writes (FR-1..FR-4; @AC-1/2/3/6)

- Add `persistOrderBestEffort(ctx, order *tradingv1.Order, path string)` in `internal/service/trading.go`,
  next to `emitLedgerEvent` (recon.md:39; `trading.go:3661`).
  - It calls `s.repo.UpsertOrder` on `context.WithTimeout(context.WithoutCancel(ctx), <bound>)`.
  - The bound reuses an existing value, so no new literal is added (F-07). The candidates are
    `ledgerEmitTimeout` (`trading.go:3657`) and the live `trading.broker.timeout_ms`. `/sdd-spec` picks one and
    cites it.
  - On error it logs `slog.Error("order state write failed", "order_id", …, "user_id", order.UserId,
    "status", order.Status.String(), "path", path, "error", err)` and returns nothing.
  - The raw error is kept so that `context canceled` can be told apart from a DB failure (P-03). The style
    follows `trading.go:646`/`:745` (recon.md:57-59, 74-75).
  - The message differs from the `Warn "db upsert order failed"` at `:646`. Tests select the record by message
    plus `status`, not by level (recon.md:129-130).

| Site | `path` | Previous ctx | Broker side effect already happened |
|---|---|---|---|
| `trading.go:688` (recon.md:30-31) | `broker_timeout` | `context.Background()` | `SubmitOrder` `:681` |
| `trading.go:703` (recon.md:32) | `broker_reject` | `context.Background()` | definite reject `:681-702` |
| `trading.go:1367` (recon.md:36-37) | `cancel_final` | raw request ctx | `CancelOrder` `:1322` |
| `trading.go:1550` (recon.md:38) | `replace_final` | raw request ctx | `ReplaceOrder` `:1519` |

### D-62: audited reactive reclaims (FR-5/FR-6; @AC-4/5/7/8/9), in `internal/service/order_intent.go`

**(a) `reclaimStaleIntent(ctx, intentID string, pendingSince, staleBefore time.Time, trigger, ownerID string)`**
mirrors the sweeper's three-way handling at `order_intent.go:144-157` (recon.md:44-48, 67-71):

- It runs `ReclaimOrphanIntent(context.WithoutCancel(ctx), …)` synchronously. This is the shared CAS
  (recon.md:50-52), and running it on `WithoutCancel` means a client cancel cannot abort it.
- An error logs `slog.Warn("order intent reclaim failed", "intent_id", …, "trigger", …, "error", err)`.
- When nothing was reclaimed it returns silently.
- When a row was reclaimed it runs
  `go s.emitLedgerEvent(context.WithoutCancel(ctx), "order_intent.reclaimed_unknown", "order:"+out.OrderID, ownerID, reclaimedUnknownPayload(trigger, out, pendingSince))`.
- It carries a constraint comment of at most two lines: do not swap `WithoutCancel` for `Background()` (that
  loses x-trace-id), and the logic mirrors `sweepOrderIntents` `:144-151` (C-18).

**(b) `reclaimedUnknownPayload(trigger string, out *repository.OrderIntentRecord, pendingSince time.Time) map[string]interface{}`**
returns these keys:

- `trigger`
- `order_id`
- `intent_id`
- `was_pending_since`, set to `pendingSince.UTC().Format(time.RFC3339Nano)`

The timestamp has to be a string, for two verified reasons:

1. `OrderIntentRecord.UpdatedAt` is a `time.Time` (`internal/repository/order_intent_repo.go:31`).
   `structpb.NewStruct` rejects it, and `emitLedgerEvent` discards that error (`p, _ :=`, `trading.go:3662`),
   so the event goes out with `Payload: nil`. The sweeper's event already does this today.
2. The CAS's `RETURNING updated_at` is the reclaim's `now()` (`order_intent_repo.go:107-109`), not the moment
   the intent went pending. That is why the caller passes `pendingSince` explicitly.

**Reactive sites.** Each becomes one call, followed by its existing `FailedPrecondition "… still pending"`
(recon.md:27-29, 36-38). The owner always comes from the resolved owner and never from the header, because the
header is empty on flatten.

| Site | `pendingSince` | `trigger` | `ownerID` |
|---|---|---|---|
| `trading.go:603` | `existing.UpdatedAt` | `reactive_place` | `accountEntry.userID` (set `:627`, ownership-gated `:433`) |
| `trading.go:1301` | `existing.UpdatedAt` | `reactive_cancel` | `order.UserId` (gated `:1256`) |
| `trading.go:1498` | `existing.UpdatedAt` | `reactive_replace` | `order.UserId` (gated `:1429`) |

The cancel and replace `order_id` equals `req.OrderId`, because the intent row is inserted with it
(recon.md:122-124).

**Sweeper.** Its payload literal at `order_intent.go:152-157` becomes
`reclaimedUnknownPayload("sweep", out, rec.UpdatedAt)`. `rec` comes from `SweepStalePending` (`:138`) and is the
pre-CAS row. Everything else about the sweeper stays the same:

- its own ctx;
- the synchronous emit;
- user `""`;
- the log text at `:146`;
- the `continue` at `:149-151`.

Its ledger payload changes from nil (today) to populated. The operator accepted this at the round-3 gate. No
`@AC-*` guards that payload (recon.md:104).

**Flatten label (P-03 decision).** `submitOrder` is shared with flatten-and-halt (`trading.go:2838`;
recon.md:117-121). Flatten-originated reclaims are therefore labelled `reactive_place`. This is accepted and
documented in the trading `CLAUDE.md` row; a caller tag is not threaded through.

A flatten-originated reclaim is rare:

- Flatten reuses `ClientOrderId` after a timeout and mints a new one only after `brokerRejectedError`
  (`:2846-2847`).
- The latest retry starts at about 1× the broker timeout plus 1.5s: attempt 0 can spend the full timeout, then
  three retries follow at 500ms spacing.
- `staleThreshold` is at least 1.5× the broker timeout, and 3× by default (`order_intent.go:91-106`).

On that path no request originated the call, so the emit carries no trace id and may carry owner `""`, the same
semantics as the sweeper.

### Scope widening (operator 2026-10-21, design gate)

The neighbouring pre-existing request-path `context.Background()` ledger emits and finalize calls in
`trading.go` are converted to `context.WithoutCancel(ctx)`, so that they carry x-trace-id. At recon-time line
numbers the candidates are:

- emits at `:649`, `:655`, `:665`, `:689`, `:700`, `:755`, `:1353`, `:1370`, `:1559` (and `:842` if it is on a request path);
- `emitApprovalAlert` at `:659`;
- `FinalizeIntent` at `:706`, `:749`, `:1524`, `:1553`, and `finalizeCancelIntent` `:1405`;
- `UpsertOrder` and `maybeSubmitBracket` at `:740`/`:744`.

`/sdd-spec` must enumerate every site by grep. Each converted site gets a test asserting that the inbound
`x-trace-id` reaches the ledger call. Background-only callers (the sweeper and the reconciliation loops) are
left as they are. Inside `submitOrder`, the ctx passed in is the request ctx on `PlaceOrder` and the flatten
loop's own ctx on flatten, so `WithoutCancel(ctx)` is correct on both callers. This replaces the earlier
"log as a finding, do not fix" note for these sites.

### Tests

All tests go in a new `internal/service/trading_order_state_audit_test.go` and use test-local fakes (C-13;
recon.md:79-90, 131-136).

Fakes:

- `failingExecDB` embeds `execOnlyDB` (`trading_flatten_rejection_test.go:27`).
- `staleIntentRepo` embeds `fakeOrderIntentRepo` (`trading_bracket_test.go:496`).
  - `InsertIntent` returns false.
  - `GetIntentByID` returns a stale PENDING record with `UpdatedAt = now-1h`, the exact request hash, and
    `OrderID "o-1"`.
  - `ReclaimOrphanIntent` is programmable.
- Reused as they are: `fakeBroker`, `recordingLedgerClient` and `captureLogs` (non-parallel).

Gate tables:

- **PlaceOrder** (`:400-546`): trading_state ACTIVE through the snapshot watcher, and `trading.risk.max_position_pct=0`.
- **ReplaceOrder** (`:1435-1459`): status NEW or PARTIALLY_FILLED, no account halt, `checkTradingStateForReplace`
  ACTIVE, a non-empty `BrokerOrderId`, and `resolveAccount`.
- **CancelOrder**: a non-empty `BrokerOrderId` plus a pool entry.

`traceCapturingLedger` embeds `recordingLedgerClient`. It runs the real `middleware.UnaryClientInterceptor`
through a fake invoker and records `x-trace-id` under the embedded mutex (`trading_reconciliation_test.go:138`).

Ordering:

1. The inbound ctx is `WithPropagationData(cancelable, {UserID:"u-1", TraceID:"t-267"})`.
2. The test cancels the parent explicitly after the handler returns.
3. It then waits for the recorded event with a bounded `Eventually` (at least 1s, 10ms tick).

The meaningful assertion is that the parent was cancelled before the invoker ran. `ctx.Err()==nil` alone proves
nothing, because `WithoutCancel` makes it always true.

Assertions:

- "still pending" checks match the full message.
- @AC-4/8/9 assert all of the following:
  - `req.Payload != nil`;
  - `trigger`, `order_id` and `intent_id` are correct;
  - `was_pending_since` equals the stale record's `UpdatedAt` and not the CAS time;
  - `x-trace-id == "t-267"`;
  - `user_id == "u-1"`.
- A sweeper test asserts the populated payload.
- Every test ends by waiting on its ledger event and never by sleeping. Otherwise an emit goroutine could log
  after `captureLogs` has restored `slog.Default`.
- RED tests first prove they reach the reclaim branch, so that the hash-mismatch branch at `:588` or a
  HALTED-gate `FailedPrecondition` cannot make them pass for the wrong reason.

### Docs

- **`services/xstockstrat-trading/CLAUDE.md` "Ledger Events Emitted"** (recon.md:76-78): add an
  `order_intent.reclaimed_unknown` row.
  - Stream: `order:{order_id}`.
  - Triggers: `sweep`, `reactive_place` (including the flatten retry), `reactive_cancel`, `reactive_replace`.
  - `user_id`: the owner for reactive emits, `""` for the sweep.
  - Payload keys include `was_pending_since` as an RFC3339 string.
- **`services/xstockstrat-trading/docs/context-constitution-findings.md`**:
  - mark `:13` resolved;
  - add the stream drift: lifecycle events use a bare orderID stream (`:649`, `:689`, `:700`, `:1370`) while
    `order:` is used for the new emits;
  - add that `emitLedgerEvent` swallows the `NewStruct` error (`trading.go:3662`).

### Build order

1. RED tests.
2. `persistOrderBestEffort` and the four D-04 sites.
3. `reclaimStaleIntent`, `reclaimedUnknownPayload`, the three reactive sites, and the sweeper payload swap.
4. The scope-widening `WithoutCancel` conversions, each with a trace test.
5. Docs.

## Rejected Alternatives

- C-03 waiver, with the new emits on `context.Background()`. The operator rejected it on 2026-10-21.
  `WithoutCancel` carries x-trace-id through the existing client interceptor (`propagation.go:35-52`,
  `trading.go:184`).
- Reuse the sweeper's payload literal unchanged (r3). Its `time.Time` value fails `structpb.NewStruct`, and the
  error is discarded (`trading.go:3662`), so every event would carry a nil payload. Its `UpdatedAt` is also the
  CAS time, not the pending-since time.
- Fix serialization generically inside `emitLedgerEvent` (convert `time.Time`, or log the `NewStruct` error).
  That touches a shared hot helper beyond D-04/D-62. The helper-level fix plus a findings entry is enough here;
  logging the error is left as a candidate hardening.
- Synchronous reactive emit on `WithoutCancel` with a short timeout. It removes goroutine-timing flakiness but
  adds latency to the `FailedPrecondition` response (recon.md:127-128).
- Keep the request ctx at `:1367`/`:1550` and stay log-only by choice. This conflicts with the operator's
  binding `WithoutCancel` rule for request-derived writes.
- Surface the D-04 write failure as an RPC error. The broker side effect has already happened, so a retry would
  collide with an order the broker already holds. It would also reopen PRESERVE `@AC-1`/`@AC-3 @feature-202` and
  `@AC-1 @feature-192` (recon.md:103).
- Retry the D-04 write once on `Background()`. It adds error-path latency, and `WithoutCancel` plus a timeout
  removes the cancel failure mode more cheaply.
- Extract the full four-way intent-lookup switch. The copies return different types and messages, and the
  offline copy at `:789` has no reclaim (recon.md:33-35). The C-18 cost outweighs the DRY gain.
- Route the sweeper through the async helper (r1). It would change the sweeper's emit timing and shutdown
  cancellation. Only the payload builder is shared.
- `reclaimStaleIntent` returns `(record, bool)` and each site inlines the emit (r2). That repeats the trigger
  literal and the emit three times, which invites copy-paste mismatches.
- Take the emit `user_id` from the middleware header. It is empty on flatten; the resolved owner is used instead.
- Thread a trigger parameter through `submitOrder` for a `reactive_flatten` label. It widens an 11-parameter
  signature (`:550-561`) for a rare case. The payload is open, so a label can be added later.
- Make the reclaim CAS async. It would race a tight client retry.
- A bufconn wire test for trace propagation. Calling the real client interceptor through a fake invoker covers
  the value-to-metadata path, and mTLS already has a wire test.
- Reconcile the bare-orderID vs `order:` stream key here. That is out of scope and goes to the findings log.

## Open Risks

- [ ] The sweeper's ledger payload changes from nil to populated. The operator accepted this at the round-3
  gate, but no AC covers it, so downstream readers that assumed an empty payload must be checked. To be
  addressed at the /sdd-spec step that swaps the sweeper payload (call out in the PR body).
- [ ] `WithoutCancel` extends the lifetime of writes and emits past the RPC and the flatten/shutdown ctx. The
  `WithTimeout` bound limits this, but a ledger outage still loses the reactive event with only a Warn log. To
  be addressed at the D-04 helper step: /sdd-spec picks and cites the bound.
- [ ] `Eventually`-polled async assertions (@AC-4/8/9) can flake under CI load if the bound is too tight, and
  late emit goroutines can pollute captured logs if a test does not wait for its event. To be addressed at the
  RED test step.
- [ ] Handler-level tests can be diverted by a missed gate, a nil service field, or a request-hash mismatch
  (`:588`). To be addressed at the RED test step: prove the reclaim branch is reached first.
- [ ] Other `emitLedgerEvent` callers may also silently send nil payloads because of the discarded `NewStruct`
  error. This is out of scope, logged in findings at the docs step.
- [ ] Flatten-originated reclaims are labelled `reactive_place`, carry no trace id, and may carry owner `""`.
  To be documented at the docs step (CLAUDE.md row).
- [ ] Reactive emits go to the `order:` stream while lifecycle events go to a bare orderID stream, so per-order
  ledger queries must read both until the drift is fixed. Logged in findings at the docs step.
- [ ] The scope-widening conversion list is recon-time line numbers. To be addressed at /sdd-spec: enumerate
  every site by grep, keep background-only callers as they are, and give each converted site its own trace test.
- [ ] Merge overlap on `trading.go` with 241, 242, 249 and 256 (recon.md:150). To be addressed at the
  integration PR, via `merge-order.md`.

## Constitution Rules Touched

- `C-01`: honored by grounding every claim in recon.md and worktree-verified `path:line`.
- `C-03`: honored. No waiver. Every request-derived write and emit, including the widened neighbouring sites,
  uses `context.WithoutCancel(ctx)` and so carries x-trace-id through the existing interceptor chain. Only
  background loops mint their own ctx.
- `C-08`: honored by the gate tables, which make the RED tests reach the intended branch.
- `C-11`: honored. Both deferred Open Questions are decided (log-only; extract only the reclaim branch), and the
  design-phase ledger touch is made.
- `C-13`: honored by test-local fakes that reuse existing fixtures. A second consumer would move a fake to
  `internal/testdata/` (lazy materialization).
- `C-16`: honored. The PRESERVE set is kept because RPC codes and messages are unchanged, and the feature ACs
  are additive.
- `C-18`: honored. There is one small helper for the reclaim branch rather than a switch extraction, the mirror
  is noted in a two-line constraint comment, and the payload builder is shared with the sweeper.
- `F-04`: honored. Nothing is invented: the payload serialization and CAS-timestamp facts were verified in the
  worktree, and the timeout bound is left for /sdd-spec to cite.
- `F-07`: honored. No new literal; the timeout reuses `ledgerEmitTimeout` or `trading.broker.timeout_ms`.
- `P-02`: honored. The proposer and adversary were mediated through the synthesized state only.
- `P-03`: honored. The raw error is kept in the logs, and the flatten-label and sweeper-payload decisions are
  recorded explicitly.
- `P-06`: honored by the full-message "still pending" assertions and the RED-first ordering.

## Business Rules Touched (C-16)

No CHANGE lines. No existing `@AC-*` guarantee is altered, so no operator CHANGE sign-off is needed. The two
operator decisions on 2026-10-21 (the binding ctx/trace rule and accepting the populated sweeper payload) govern
implementation and an unguarded payload, not acceptance behaviour.

- PRESERVE `@AC-1 @feature-202` "A GTC market order is placed with the TimeInForce enum"
  (`services/xstockstrat-trading/acceptance/order-time-in-force-enum.feature`): not regressed, because the
  PlaceOrder happy path and return codes are unchanged.
- PRESERVE `@AC-3 @feature-202` "A broker-unsupported TIF is rejected before broker submission" (same file): not
  regressed, because the pre-broker reject gains no write or log.
- PRESERVE `@AC-1 @feature-206` "A broker position explained by the platform's own filled orders does not halt"
  (`services/xstockstrat-trading/acceptance/fix-reconciliation-false-halt.feature`): not regressed, because
  order and fill semantics are unchanged and the reconciliation loops keep their ctx.
- PRESERVE `@AC-2 @feature-206` "A genuinely foreign broker position still halts" (same file): not regressed,
  because the halt path is untouched.
- PRESERVE `@AC-3 @feature-206` "A net-filled-qty lookup error never causes a false halt" (same file): not
  regressed, because the logging does not change halt or mismatch behaviour.
- PRESERVE `@AC-1 @feature-192` "an order is accepted when the platform trading state is ACTIVE"
  (`services/xstockstrat-trading/acceptance/fix-trading-config-key-mismatch.feature`): not regressed, because
  the gate is unchanged.
- PRESERVE `@AC-5 @feature-157` "Editing an offline order confirmation from the UI marks it filled"
  (`services/xstockstrat-trading/acceptance/offline-account-portfolios.feature`): not regressed, because
  ConfirmOrder is untouched.
- EXTEND (net-new, additive): this feature's own `@AC-1`..`@AC-9`. They add logging, emit and trace guarantees
  on paths that no existing suite covers (recon.md:101). At promotion they carry `@feature-267` to avoid tag
  collisions (recon.md:105).

## Rounds

| Round | Outcome |
|---|---|
| 1 | Sweeper-through-async-helper proposal rejected (sweeper regression); flatten label and owner source raised as blocking. |
| 2 | Owner from the resolved owner; the helper owns the emit; `WithoutCancel` at `:1367`/`:1550`; gate tables. Adversary verdict SOUND; halted at gate. |
| 3 | C-03 waiver dropped per the operator. Adversary found the nil-payload (`NewStruct`) and CAS-ctx defects, and both fixes were folded in. The operator approved as synthesized, accepted the populated sweeper payload, and widened scope to the neighbouring `Background()` sites. |

Termination: approved by the operator at the round-3 gate, with no Floor breaches.
