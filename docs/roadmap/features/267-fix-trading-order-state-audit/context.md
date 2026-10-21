# Context Log: fix-trading-order-state-audit

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-trading-order-state-audit-defect.md` (Issues disabled).
- Source: repo-surveyor debt-radar scan `docs/repo-surveyor/debt-radar-findings.md` @ 4535695, findings D-04, D-62.
- Severity: SEV-2 (group severity; D-62 alone was rated one tier lower by the surveyor). Impact type:
  order-state-loss-unlogged. Environment: dev (main-dev) @ a053b0e. Config-only: no.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..5), context.md.
- Affected services: xstockstrat-trading (fix site); xstockstrat-ledger receives a reused event type, no change.
- Root cause hypothesis: error/terminal-path writes treated as best-effort with results discarded; the four-way
  intent-lookup switch copied the discarded reclaim into three RPCs.
- Re-verification on main-dev @ a053b0e: both D-ids reproduce. Line drift: none — D-04 still `trading.go:688`,
  `:703`, `:1367`, `:1550`; D-62 still `:603`, `:1301`, `:1498`; sweeper contrast `order_intent.go:144-157`;
  switch copies at `classifyIntentLookup` calls `:586`, `:789`, `:1285`, `:1482`. Note the existing inline comment
  at `:602` ("Best-effort — the caller need not distinguish…") justifies the response shape, not the missing log/event.
- **Overlaps:** `trading.go` is touched by in-flight 241-fix-config-audit-author-spoof, 242-fix-push-untargeted-broadcast
  (alert sites `:1938-1944`, `:2751-2757`) and 249-fix-ibkr-request-signing (broker instantiation, credential
  validation), all `implementation-ready`, plus launched 240-offline-account-full-pnl. None edits the seven call
  sites here, but expect textual merge conflicts in `trading.go`; check `merge-order.md` before the integration PR.
  Related, not included: debt-radar NC-C (`CancelOrder` fail-open). Sibling batch feature 256-fix-offline-book-consistency
  (created concurrently, D-47/D-48/D-49/D-63) edits `ConfirmOrder` in `trading.go` (`:863-954` region) — no shared lines,
  but sequence the two `trading.go` branches via `merge-order.md`.
- Recommended design depth: quick → `/sdd-design fix-trading-order-state-audit quick` (rationale: SEV-2, single
  service, no proto/migration/config). Design forks: log-only vs surfacing the write failure; extract the intent
  switch now vs three-site fix.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2 (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Development branch: feature/fix-trading-order-state-audit

---

## Session 2026-10-21 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria verdict: PASS WITH WARNINGS (no fails, no floor breaches); overlap verdict: WARN (file-level only).
- Warnings:
  - C-15 (criterion 8): FR-5 bound reactive_cancel/reactive_replace but only AC-4 asserted the emit. **Resolved:** added `@AC-8` (CancelOrder, trigger `reactive_cancel`) and `@AC-9` (ReplaceOrder, trigger `reactive_replace`); FR-5 now traces to AC-4/AC-8/AC-9.
  - Criterion 9: both Open Questions are ticked but only deferred, not decided. Open for `/sdd-design`, which must close them (C-11).
  - FR-1/AC-1 log status `ORDER_STATUS_NEW` (pre-call) on the uncertain-outcome path although the broker state is unknown. Open: design to confirm the intended audit value. FR-4/AC-6 status was unspecified. **Resolved:** FR-4 now names the order's existing status, which `ReplaceOrder` does not change (verified at `trading.go:1535-1550`, where only qty/prices/TIF/intent state are mutated before the write).
  - AC-1/AC-2 assert "the order id" with no concrete value. Accepted: the id is generated server-side.
  - Criterion 4: ledger listed as "no change expected". Spot-checked: no event-type whitelist or `reclaimed_unknown` reference under `services/xstockstrat-ledger/src`. Design recon should confirm.
  - Code-checkable claims verified at the seven call sites and the sweeper emit (`order_intent.go:144-157`, payload `trigger`/`order_id`/`intent_id`/`was_pending_since` confirmed this session). Switch lines `:586/:789/:1285/:1482` not re-verified by the reviewer.
- Overlap findings (all file-level, rebase-only, no config-key/proto/migration collision):
  - `trading.go` vs 241-fix-config-audit-author-spoof (implementation-ready), escalateSystemic SetConfig `:2168-2176`.
  - `trading.go` vs 242-fix-push-untargeted-broadcast (implementation-ready), EmitAlert sites `:1938-1944`, `:2751-2757`.
  - `trading.go` (+ `internal/broker/ibkr.go`) vs 249-fix-ibkr-request-signing (implementation-ready), `:87-92`, `:3084-3097`.
- OPERATOR DECISIONS (binding, recorded 2026-10-21):
  - Grouped by service+theme from the 2026-10-20 debt-radar scan; Track C.
  - Scope is D-04, D-62.
  - Operator confirmed 2026-10-21: not a duplicate of demoted trading-state-machine-invariants (that was property-based lifecycle testing; this is discarded UpsertOrder / ReclaimOrphanIntent results).
  - Open Questions (log-only vs surfacing; extract the intent-lookup switch) are deferred to /sdd-design per C-11.
- Next: `/sdd-design fix-trading-order-state-audit`.

---

## Session 2026-10-21 — sdd-batch design gate (round 2)

Full-mode `/sdd-design` debate halted at its approval gate after round 2 (gate policy: halt). `design.md` was not written and `status.md` stays `spec-ready`. The debate resumes from the state block below on the next `/sdd-batch` run.

## Open Threads

- **Approach (round-2 synthesis):** proposal r2 plus three adversary refinements. RPC return codes do not change.
  - **D-04 (log-only):** a new `persistOrderBestEffort(ctx, order, path)` helper next to `emitLedgerEvent` owns the `slog.Error("order state write failed", …)` on these sites:
    - `:688` `broker_timeout` and `:703` `broker_reject`, both on `context.Background()`, unchanged.
    - `:1367` `cancel_final` and `:1550` `replace_final`, which switch to `context.WithoutCancel(ctx)` to match their neighbouring finalize calls.
    - Rationale: every write happens after the broker side effect, so surfacing the error would invite a retry against an order the broker already holds.
  - **D-62:** `reclaimStaleIntent` in `order_intent.go` runs the CAS synchronously on the request ctx. On error it logs `slog.Warn`. On success it fires an async `order_intent.reclaimed_unknown` emit on the `order:` stream, with the resolved owner as user_id (`accountEntry.userID` / `order.UserId`). Each reactive site (`:603` `reactive_place`, which includes the internal flatten retry; `:1301` `reactive_cancel`; `:1498` `reactive_replace`) becomes one call. The sweeper changes only by adopting `reclaimedUnknownPayload("sweep", out)`. Only the reclaim branch is extracted; the four-way lookup switch stays.
  - **Tests:** handler-level, in the new `trading_order_state_audit_test.go` with test-local fakes (C-13). It covers the PlaceOrder, ReplaceOrder and CancelOrder gate tables. Assertions match the full "still pending" message and poll async emits with a bounded Eventually. RED tests must first prove they reach the reclaim branch.
- **Strongest open objection (non-blocking, C-08/P-06):** the ReplaceOrder gate table (`:1435-1459`, including `checkTradingStateForReplace` with trading_state ACTIVE) and the CancelOrder broker-path setup are in the synthesis, but no proposal text has shown them yet. Without them, a HALTED-gate FailedPrecondition could make RED pass for the wrong reason.
- **Other open objections (non-blocking, spec stage can discharge):**
  - Accept the WithoutCancel switch at `:1367`/`:1550`, or record log-only-by-choice. Either way, keep the raw error in the log (P-03).
  - Record the C-03 waiver for the `context.Background()` reactive emits, after checking whether trading's ledger client reads trace metadata from ctx values (C-03).
  - Add the C-18 mirror constraint comment on `reclaimStaleIntent`.
  - Log the bare-orderID vs `order:` stream drift in the findings file, not fixed here.
  - Restate the flatten-is-rare timing correctly: latest retry ≈ 1× broker timeout + 1.5s, against a ≥1.5× threshold. Note that the empty-owner case emits "".
- **Floor status:** no Floor breaches (adversary verdict SOUND).
- **Uncovered @AC changes:** none outside the feature's own scope.
  - `@AC-1`..`@AC-9` are all EXTEND (additive). No operator decision covers them yet, so they need sign-off at the gate.
  - PRESERVE: `@AC-1`/`@AC-3 @feature-202`, `@AC-1`..`@AC-3 @feature-206`, `@AC-1 @feature-192`, `@AC-5 @feature-157`. The RPC return codes and FailedPrecondition branches are unchanged.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Round-2 best approach: proposal r2 plus three adversary refinements (helper owns the emit, WithoutCancel at the two request-ctx D-04 sites, ReplaceOrder/CancelOrder gate table). RPC return codes are unchanged. D-04 is log-only. Only the reclaim branch is extracted; the four-way lookup switch stays.\n\nD-04 (FR-1..FR-4; AC-1/2/3/6):\n- Add `persistOrderBestEffort(ctx, order *tradingv1.Order, path string)` in services/xstockstrat-trading/internal/service/trading.go next to `emitLedgerEvent` (:3661).\n  - It calls `s.repo.UpsertOrder`.\n  - On error it logs `slog.Error(\"order state write failed\", order_id, user_id, status=order.Status.String(), path, error)` and returns nothing.\n- Sites and ctx:\n  - :688 `broker_timeout`, ctx `context.Background()` (unchanged). Broker SubmitOrder already ran at :681.\n  - :703 `broker_reject`, ctx `context.Background()` (unchanged). Definite broker reject (:681-684, :696-702); `order.broker_rejected` already emitted (:700).\n  - :1367 `cancel_final`, ctx `context.WithoutCancel(ctx)` (CHANGED). Broker CancelOrder ran at :1322, legs at :1341-1347. The BrokerOrderId==\"\" fail-open branch (:1309-1310) is NC-C and out of scope.\n  - :1550 `replace_final`, ctx `context.WithoutCancel(ctx)` (CHANGED). Broker ReplaceOrder succeeded at :1519.\n- Why WithoutCancel at :1367/:1550:\n  - It matches the finalize calls right after them, which already use context.Background() (:1368 finalizeCancelIntent, :1553).\n  - It removes a client-disconnect cause of D-04 while keeping context values.\n  - Go 1.27 supports it. It is not used anywhere in trading today.\n- Log-only rationale, recorded per site in design.md: the broker side effect has already happened, so surfacing an error invites a retry against an order the broker already holds.\n- The Error message is distinct from the Warn \"db upsert order failed\" at :646. Tests select the record by msg plus `status`, not by level.\n\nD-62 (FR-5/FR-6; AC-4/5/7/8/9), in order_intent.go:\n- (a) `func (s *TradingService) reclaimStaleIntent(ctx context.Context, intentID string, staleBefore time.Time, trigger, ownerID string)` with no return value.\n  - It runs `s.orderIntentRepo.ReclaimOrphanIntent` synchronously on the request ctx.\n  - On error it logs `slog.Warn(\"order intent reclaim failed\", intent_id, trigger, error)`.\n  - When nothing was reclaimed it returns silently.\n  - On success it fires `go s.emitLedgerEvent(context.Background(), \"order_intent.reclaimed_unknown\", \"order:\"+out.OrderID, ownerID, reclaimedUnknownPayload(trigger, out))`.\n  - A ≤2-line constraint comment above it says it mirrors `sweepOrderIntents` (:144-151), so a change to the reclaim contract updates both.\n- (b) `reclaimedUnknownPayload(trigger string, out *repository.OrderIntentRecord) map[string]interface{}` builds the existing 4-key payload.\n- Sweeper (order_intent.go:144-157): its only change is replacing the map literal at :152-157 with `reclaimedUnknownPayload(\"sweep\", out)`. Its log text at :146, the `continue` at :149-151, and the synchronous emit on the sweeper ctx with user \"\" are byte-for-byte unchanged.\n- Each reactive site becomes one call, then returns its existing FailedPrecondition \"... still pending\":\n  - trading.go:603: `s.reclaimStaleIntent(ctx, intentID, existing.UpdatedAt.Add(staleThreshold(s.cfgW)), \"reactive_place\", accountEntry.userID)`\n  - :1301: `\"reactive_cancel\", order.UserId`\n  - :1498: `\"reactive_replace\", order.UserId`\n- The owner always comes from the resolved owner, never from the header:\n  - accountEntry.userID is set at :627. It is ownership-gated at :433 on PlaceOrder, and the flatten caller passes accountEntry at :2838.\n  - order.UserId is gated against the caller at :1256 (cancel) and :1429 (replace).\n  - This is consistent with the emits at :649, :689, :700 and :1370.\n  - On flatten, an empty owner would emit \"\" (the same as the sweeper), which is harmless. Record this in design.md.\n- The `reactive_place` label includes the internal flatten retry. Flatten reuses ClientOrderId after a timeout (:2838) and mints a new one only after brokerRejectedError (:2846-2847).\n  - Corrected timing for design.md: the latest retry starts at about 1× broker timeout + 1.5s (attempt 0 can spend the full timeout, then 3×500ms spacing).\n  - staleThreshold is ≥1.5× max(trading.broker.timeout_ms, IBKRRequestTimeout), 3× by default (order_intent.go:91-106).\n  - Later attempts at :600-606 return \"still pending\" without calling the broker.\n  - So a flatten-originated reclaim is rare.\n\nDocs:\n- services/xstockstrat-trading/CLAUDE.md \"Ledger Events Emitted\": add an `order_intent.reclaimed_unknown` row.\n  - stream `order:{order_id}`\n  - triggers sweep / reactive_place (incl. internal flatten retry) / reactive_cancel / reactive_replace\n  - user_id is the owner for reactive emits and \"\" for sweep\n- services/xstockstrat-trading/docs/context-constitution-findings.md:\n  - mark :13 resolved;\n  - add a new finding: lifecycle events emit to a bare orderID stream (trading.go:649, :689, :700, :1370) while the CLAUDE.md table says `order:{order_id}`. Do not fix it here.\n- context.md: record the C-03 waiver (the new emits use context.Background() and drop x-trace-id), and the WithoutCancel decision.\n\nTests: new file internal/service/trading_order_state_audit_test.go, with test-local fakes (C-13).\n- Fakes:\n  - `failingExecDB` embeds execOnlyDB (trading_flatten_rejection_test.go:27).\n  - `staleIntentRepo` embeds fakeOrderIntentRepo (trading_bracket_test.go:496):\n    - InsertIntent returns false;\n    - GetIntentByID returns a stale PENDING record with UpdatedAt = now-1h, RequestHash equal to placeOrderRequestHash(req) or the cancel/replace hash, and OrderID \"o-1\";\n    - ReclaimOrphanIntent is programmable.\n  - Reused as-is: fakeBroker, recordingLedgerClient, captureLogs (non-parallel).\n- Every AC enters at handler level.\n- PlaceOrder gate table (proposal r2, :400-546): set trading_state ACTIVE via config.NewSnapshotWatcher, and set `trading.risk.max_position_pct=0`.\n- ReplaceOrder gate table:\n  - status NEW or PARTIALLY_FILLED (:1435-1441)\n  - account halt (:1445)\n  - checkTradingStateForReplace, so the snapshot must be ACTIVE (:1450)\n  - BrokerOrderId non-empty (:1454)\n  - resolveAccount (:1459)\n- CancelOrder gate table: BrokerOrderId != \"\" plus a pool entry, so the broker path is exercised.\n- Assertions:\n  - \"still pending\" assertions match the full message (e.g. \"replace on order o-1 is still pending\", :1501), not just the gRPC code.\n  - Async emits use a bounded Eventually (≥1s, 10ms tick) and assert user_id \"u-1\".\n  - RED tests first prove the reclaim branch (:600/:1301/:1498) is reached, then assert the emit.\n\nBuild order:\n1. RED tests.\n2. persistOrderBestEffort and the four sites.\n3. reclaimStaleIntent, reclaimedUnknownPayload, the three one-line reactive sites, and the sweeper payload swap.\n4. Docs, findings and context.md.",
    "open_objections": [
      {
        "text": "[C-08/P-06] Gate coverage for ReplaceOrder and CancelOrder is now part of the synthesized approach, but no proposal text has shown it yet. The spec must include the ReplaceOrder gate table (:1435-1459, including checkTradingStateForReplace with trading_state ACTIVE) and the CancelOrder broker-path setup (BrokerOrderId != \"\" plus a pool entry). It must also match the full \"still pending\" message, so that the HALTED-gate FailedPrecondition cannot make RED pass for the wrong reason.",
        "blocking": false
      },
      {
        "text": "[P-03 / D-04 root cause] The synthesis switches :1367 and :1550 to context.WithoutCancel(ctx). The next proposer must accept this or explicitly choose the alternative: keep the request ctx and record in context.md that a cancel-caused failure stays log-only by choice. Either way the Error log must carry the raw error, so `context canceled` is distinguishable from a DB failure.",
        "blocking": false
      },
      {
        "text": "[C-03] The three new reactive emits use context.Background() and drop x-trace-id. This must be recorded in context.md as an explicit C-03 waiver, not as an 'assumption'. Before waiving, the spec should check whether trading's outbound ledger call reads trace metadata from ctx values (middleware/propagation.go). If it does, use context.WithoutCancel(ctx) for the new emits instead.",
        "blocking": false
      },
      {
        "text": "[C-18] The three-way reclaim result handling exists twice (sweeper :144-151 and reclaimStaleIntent). This is accepted as deliberate, to keep the sweeper byte-for-byte unchanged. It requires a ≤2-line constraint comment on reclaimStaleIntent naming the mirror.",
        "blocking": false
      },
      {
        "text": "[PLAT doc drift] Lifecycle events emit to a bare orderID stream (trading.go:649, :689, :700, :1370), but the CLAUDE.md table lists `order:{order_id}`. The new reactive emits use `order:` (matching the sweeper), so they land on a different stream from the same order's lifecycle events. Log this in services/xstockstrat-trading/docs/context-constitution-findings.md. Do not 'correct' the new row to match, and do not fix the mismatch here.",
        "blocking": false
      },
      {
        "text": "[evidence] design.md must restate the flatten 'rare' argument with the correct timing: attempt 0 can spend the full broker timeout before retries begin (latest retry ≈ 1× timeout + 1.5s, against a ≥1.5× threshold). It must also record that an empty flatten-path owner would emit \"\" (the sweeper's semantics, harmless), because non-emptiness on that path was not proven.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-6",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-7",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-8",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-9",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-1 @feature-202",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3 @feature-202",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-1 @feature-206",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 @feature-206",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3 @feature-206",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-1 @feature-192",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5 @feature-157",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Surface the D-04 write failure as an RPC error (Internal/Unavailable). Every site writes after the broker side effect (:681-703, :1322, :1519), so a retry would collide with an order the broker already holds. It would also reopen PRESERVE @AC-1/@AC-3 @feature-202 and @AC-1 @feature-192. The reconciliation poller already repairs divergence.",
      "Retry the D-04 write once on context.Background() before logging. It adds error-path latency and behavior beyond the defect's scope. WithoutCancel at :1367/:1550 removes the cancel-caused failure mode more cheaply.",
      "Extract the full four-way intent-lookup switch. The three reclaiming copies return different types and messages, and the offline copy at :789 has no reclaim (:800-803). The generic plumbing costs more under C-18 than the DRY gain.",
      "Route the sweeper through a single async-emitting helper (proposal r1). It changes sweeper emit timing, shutdown cancellation and log text, and no AC covers those changes.",
      "reclaimStaleIntent returns (record, bool) with the emit inlined at each reactive site (proposal r2). The reclaim+emit sequence and the trigger literal repeat three times, and a mismatched trigger is an easy copy-paste error. Having the helper emit makes each site one line.",
      "Make the reactive reclaim CAS itself async. It moves the CAS off the request ctx and races a tight client retry.",
      "Take the reactive emit user_id from middleware.FromContext(ctx).UserID. It is empty on the background flatten path. The resolved owner (accountEntry.userID, order.UserId) is always the source.",
      "Thread a trigger parameter through submitOrder for a `reactive_flatten` label. It widens an 11-parameter signature (:550-561) for a rare case. The payload is open, so it can be added later if operators need it.",
      "Change the new CLAUDE.md row, or the existing emits, to reconcile the bare-orderID vs `order:` stream key. That is out of scope; it goes in the findings log instead."
    ],
    "open_risks": [
      "Handler-level tests may still miss a gate or a nil field. A missing ledger, orderIntentRepo or broker field in the test literal panics inside a goroutine instead of failing an assertion. A RequestHash that does not exactly match placeOrderRequestHash(req) diverts AC-4 to the hash-mismatch branch (:588). RED tests must first prove they reach the reclaim branch.",
      "Async reactive emits are fire-and-forget on context.Background(). A ledger outage loses the event with only a log, and x-trace-id is dropped (C-03 waiver).",
      "Eventually-polled assertions (AC-4/8/9) can flake under CI load if the bound is too tight.",
      "`reactive_place` covers flatten-originated reclaims too. That may mislead ledger readers unless the CLAUDE.md row documents it.",
      "The flatten-path owner is not proven non-empty. If empty, the reactive emit carries user_id \"\" (the sweeper's semantics).",
      "context.WithoutCancel at :1367/:1550 means the final write can outlive the client deadline. The write is bounded only by the DB driver and pool timeouts.",
      "The reactive emits land on the `order:` stream while lifecycle events land on a bare orderID stream, so per-order ledger queries must read both until the drift is fixed."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-03",
      "C-08",
      "C-11",
      "C-13",
      "C-16",
      "C-18",
      "P-02",
      "P-03",
      "P-06"
    ],
    "rationale": "Both round-1 blocking objections are now answered concretely.\n1. Flatten label. The `reactive_place` label stays on corrected grounds: ClientOrderId is reused after a timeout (:2838), a new one is minted only after brokerRejectedError (:2846-2847), and the stale threshold is ≥1.5× the broker timeout. The adversary corrected the timing to include attempt 0's full timeout, and the conclusion still holds.\n2. Owner source. The emit user_id comes from accountEntry.userID (:627, gated at :433) and order.UserId (gated at :1256/:1429).\nThe adversary returned SOUND with no Floor breaches.\n\nI checked the adversary's new claims in the worktree:\n- :1367 and :1550 call `UpsertOrder(ctx, …)` on the request ctx, while the finalize calls next to them use context.Background() (:1553).\n- The lifecycle emits use a bare orderID or req.OrderId as the stream (:649, :1370).\n- context.WithoutCancel is not used anywhere in the service.\n- The flatten caller passes accountEntry into submitOrder.\n\nChanges to the best approach this round:\n- WithoutCancel at the two request-ctx D-04 sites. It is cheap, consistent with the neighbouring finalize calls, and removes a common cause instead of only logging it. It stays an objection so the proposer can explicitly pick the log-only-by-choice alternative.\n- The reclaim helper now emits too, so each reactive site is one line. This closes the trigger-literal copy-paste risk the adversary raised. The sweeper still adopts only the payload builder, which keeps the r1 sweeper-regression concern closed.\n- The ReplaceOrder/CancelOrder gate tables and full-message assertions are folded in, so RED cannot pass on the HALTED gate.\n\nEvery remaining objection is documentation, waiver recording, or test design that the spec stage can discharge, so none is blocking.\n\nBusiness-rule impact:\n- All nine ACs are additive (EXTEND).\n- The recon PRESERVE set is kept, because the RPC return codes and FailedPrecondition branches are unchanged: @feature-202 AC-1/AC-3, @feature-206 AC-1..3, @feature-192 AC-1, @feature-157 AC-5.\n- No operator decision sanctions a business-rule change. The operator only scoped D-04/D-62 and deferred the design questions to this phase."
  },
  "floor_breaches": []
}
```
