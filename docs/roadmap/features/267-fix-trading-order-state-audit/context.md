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

---

## Session 2026-10-21 — sdd-batch design gate (round 3)

Full-mode `/sdd-design` debate halted at its approval gate after round 3 (gate policy: halt). `design.md` was not written and `status.md` stays `spec-ready`. The debate resumes from the state block below on the next `/sdd-batch` run.

## Open Threads

- **Approach (round-3 synthesis):** proposal r3 plus two adversary code fixes, both verified in the worktree. The C-03 waiver is dropped: the operator rejected it on 2026-10-21. Every request-derived write or emit now uses `context.WithoutCancel(ctx)`. RPC return codes and FailedPrecondition messages do not change. D-04 stays log-only, and only the reclaim branch is extracted.
  - **D-04:** a new `persistOrderBestEffort(ctx, order, path)` helper wraps `UpsertOrder` in `context.WithTimeout(context.WithoutCancel(ctx), <existing bound>)`. It covers these sites:
    - `:688` `broker_timeout` and `:703` `broker_reject`, which used `context.Background()`.
    - `:1367` `cancel_final` and `:1550` `replace_final`, which used the raw ctx.
    - The bound reuses an existing value, `ledgerEmitTimeout` or `trading.broker.timeout_ms` (F-07).
    - On error it logs `slog.Error("order state write failed", …)` with the raw error.
  - **D-62:** `reclaimStaleIntent(ctx, intentID, pendingSince, staleBefore, trigger, ownerID)` does three things:
    - It runs the reclaim CAS on `context.WithoutCancel(ctx)`.
    - On error it logs `slog.Warn`.
    - On success it fires an async `order_intent.reclaimed_unknown` emit on the `order:` stream, also on `WithoutCancel`, so `x-trace-id` flows through the existing ctx-value client interceptor (`propagation.go:35-52`, `trading.go:184`).
  - **Payload:** `reclaimedUnknownPayload(trigger, out, pendingSince)` renders `was_pending_since` as an RFC3339Nano string. This fixes two defects:
    - `structpb.NewStruct` rejects `time.Time`, and `emitLedgerEvent` discards that error (`trading.go:3662`), so the event went out with a nil payload.
    - `out.UpdatedAt` is the time of the CAS, not the time the intent went pending (`order_intent_repo.go:107-109`).
  - **Call sites:** the three reactive sites (`:603`/`:1301`/`:1498`) each become one call. The sweeper adopts only the payload builder, passing `rec.UpdatedAt`.
  - **Tests:** a new `trading_order_state_audit_test.go`.
    - A `traceCapturingLedger` runs the real client interceptor and records under the embedded mutex.
    - Each test cancels the parent ctx explicitly, then waits on the event with a bounded Eventually.
    - Assertions: the payload is non-nil, the field values are correct, `was_pending_since` equals the pending-since time, `x-trace-id == "t-267"`, and `user_id == "u-1"`.
- **Strongest open objections (both blocking, folded into the synthesis but not yet answered by a proposer):**
  1. **[F-04-adjacent / P-03] Payload serialization.** The next proposal must adopt the `pendingSince` parameter and the RFC3339 string, plus tests that assert `req.Payload != nil`. It must also acknowledge that the sweeper's ledger payload changes from nil (today) to populated. That is a behaviour change to put in front of the operator.
  2. **[C-03 / operator decision 2026-10-21]** The reactive reclaim CAS must run on `context.WithoutCancel(ctx)`. r3 left it on the raw request ctx, which contradicts its own claim that every write uses WithoutCancel.
- **Other open objections (non-blocking):**
  - [C-18] The proposer must pick and cite the timeout bound for the now-uncancellable writes.
  - [C-03] The neighbouring pre-existing `Background()` calls go to the operator as one include/defer decision. These are the emits at `:689`/`:700` and the FinalizeIntent calls at `:706`/`:749`/`:1524`/`:1553`/`finalizeCancelIntent` `:1405`. If deferred, log them in findings.
  - [P-03] Record the flatten-path `reactive_place` label decision.
  - [C-13] Test-race and ordering discipline. `ctx.Err()==nil` is tautological under WithoutCancel; the meaningful assertion is that the parent was cancelled before the invoker ran.
  - [evidence] Restate the flatten timing: latest retry ≈ 1× broker timeout + 1.5s, against a ≥1.5× threshold. The empty flatten owner emits `""` with no trace id.
  - [PLAT doc drift] Lifecycle events use a bare orderID stream while the new emits use `order:`. Log this in findings only.
- **Floor status:** no Floor breaches.
- **Uncovered @AC changes:** none outside the feature's own scope.
  - `@AC-1`..`@AC-9` are all EXTEND (additive). No operator decision covers them yet, so they need sign-off at the gate. The operator's ctx/trace decision governs implementation, not acceptance behaviour.
  - PRESERVE: `@AC-1`/`@AC-3 @feature-202`, `@AC-1`..`@AC-3 @feature-206`, `@AC-1 @feature-192`, `@AC-5 @feature-157`. RPC codes and messages are unchanged.
- **Operator decisions recorded this round:** the operator rejected the C-03 waiver (new emits on `context.Background()`) on 2026-10-21. Binding rule: every request-derived write and emit uses `context.WithoutCancel(ctx)`.

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "Round-3 best approach: proposal r3 (C-03 waiver dropped; every request-derived write/emit uses context.WithoutCancel(ctx)) plus the adversary's two verified code fixes folded in. RPC return codes and FailedPrecondition messages are unchanged. D-04 stays log-only. Only the reclaim branch is extracted.\n\nVerified in the worktree this round:\n- `OrderIntentRecord.UpdatedAt` is `time.Time` (services/xstockstrat-trading/internal/repository/order_intent_repo.go:31).\n- `emitLedgerEvent` throws away the `structpb.NewStruct` error (`p, _ :=`, internal/service/trading.go:3662), so a payload containing a time.Time is sent as `Payload: nil`. The sweeper's event (order_intent.go:152-157) therefore reaches the ledger with no payload today.\n- The reclaim CAS sets `updated_at = now()` and returns it (order_intent_repo.go:107-109), so `out.UpdatedAt` is the time of the reclaim, not the time the intent went pending.\n\nD-04 (FR-1..FR-4; AC-1/2/3/6):\n- Add `persistOrderBestEffort(ctx, order *tradingv1.Order, path string)` next to `emitLedgerEvent` (trading.go:3661).\n  - It calls `s.repo.UpsertOrder` on `context.WithTimeout(context.WithoutCancel(ctx), <bound>)`. The bound reuses an existing value (e.g. `ledgerEmitTimeout`, trading.go:3657, or the live `trading.broker.timeout_ms`) so no new literal is added (F-07).\n  - On error it logs `slog.Error(\"order state write failed\", order_id, user_id, status=order.Status.String(), path, error=err)` and returns nothing. The raw error is kept so `context canceled` can be told apart from a DB failure.\n- Call sites, all passing the request ctx:\n  - :688 `broker_timeout`, was context.Background()\n  - :703 `broker_reject`, was context.Background()\n  - :1367 `cancel_final`, was the raw ctx\n  - :1550 `replace_final`, was the raw ctx\n- Log-only rationale: the broker side effect has already happened (:681, :1322, :1519).\n\nD-62 (FR-5/FR-6; AC-4/5/7/8/9), in order_intent.go:\n- (a) `reclaimStaleIntent(ctx, intentID string, pendingSince, staleBefore time.Time, trigger, ownerID string)`:\n  - It runs `ReclaimOrphanIntent(context.WithoutCancel(ctx), …)` synchronously. This is changed from r3's raw request ctx, per the operator rule.\n  - An error logs `slog.Warn(\"order intent reclaim failed\", intent_id, trigger, error)`.\n  - If nothing was reclaimed it returns silently.\n  - On success it runs `go s.emitLedgerEvent(context.WithoutCancel(ctx), \"order_intent.reclaimed_unknown\", \"order:\"+out.OrderID, ownerID, reclaimedUnknownPayload(trigger, out, pendingSince))`.\n  - It carries a ≤2-line constraint comment: do not replace WithoutCancel with Background() or x-trace-id is lost; mirrors sweepOrderIntents :144-151.\n- (b) `reclaimedUnknownPayload(trigger string, out *repository.OrderIntentRecord, pendingSince time.Time) map[string]interface{}` returns keys trigger, order_id, intent_id, and `was_pending_since = pendingSince.UTC().Format(time.RFC3339Nano)`, a string so NewStruct accepts it.\n- Reactive sites, one line each, then the existing FailedPrecondition:\n  - :603 passes `existing.UpdatedAt`, `\"reactive_place\"`, `accountEntry.userID`\n  - :1301 passes `\"reactive_cancel\"`, `order.UserId`\n  - :1498 passes `\"reactive_replace\"`, `order.UserId`\n- Sweeper: the payload literal at :152-157 becomes `reclaimedUnknownPayload(\"sweep\", out, rec.UpdatedAt)`, where rec comes from SweepStalePending (:138). The sweeper keeps its own ctx, its synchronous emit and user \"\". Its payload goes from nil (today) to populated. No @AC-* guards this, but the operator must be told, because it changes what ledger readers see.\n- x-trace-id path:\n  - UnaryServerInterceptor stores PropagationData as a ctx value (middleware/propagation.go:35-39).\n  - WithoutCancel keeps that value.\n  - The ledger conn's UnaryClientInterceptor (trading.go:184; propagation.go:46-52) emits it as outgoing metadata.\n  - No new header code is needed.\n\nTests: new file internal/service/trading_order_state_audit_test.go.\n- Round-2 fakes: `failingExecDB` and `staleIntentRepo`, the latter returning a stale PENDING record with UpdatedAt = now-1h and the exact request hash.\n- Gate tables for PlaceOrder, ReplaceOrder (:1435-1459, snapshot ACTIVE) and CancelOrder (BrokerOrderId plus a pool entry).\n- \"still pending\" assertions match the full message.\n- New `traceCapturingLedger` embeds recordingLedgerClient, runs the real `middleware.UnaryClientInterceptor` through a fake invoker, and records x-trace-id under the embedded mutex (trading_reconciliation_test.go:138).\n- Ordering: the inbound ctx is `WithPropagationData(cancelable, {UserID:\"u-1\", TraceID:\"t-267\"})`. Cancel it explicitly after the handler returns, then wait with a bounded Eventually (≥1s, 10ms tick) for the recorded event.\n- AC-4/8/9 assert:\n  - `req.Payload != nil`;\n  - payload trigger, order_id and intent_id are correct;\n  - was_pending_since equals the stale record's UpdatedAt and not the CAS time;\n  - x-trace-id == \"t-267\";\n  - user_id == \"u-1\".\n- A sweeper test asserts the populated payload.\n- Every test ends by waiting on the ledger event, never by sleeping, so no emit goroutine logs after captureLogs has restored slog.Default.\n\nDocs:\n- trading/CLAUDE.md: add a Ledger Events row for order_intent.reclaimed_unknown (stream `order:{order_id}`; triggers incl. flatten-originated reactive_place; payload keys incl. RFC3339 was_pending_since).\n- context-constitution-findings.md:\n  - mark :13 resolved;\n  - add the bare-orderID vs `order:` stream drift;\n  - add that emitLedgerEvent swallows the NewStruct error (trading.go:3662);\n  - add that neighbouring pre-existing Background() emits/finalizes drop x-trace-id, unless the operator includes them.\n- context.md: record the operator's rejection of the C-03 waiver and the WithoutCancel decision.\n\nBuild order:\n1. RED tests.\n2. persistOrderBestEffort and the four sites.\n3. The reclaim helper, the payload builder, the three reactive sites and the sweeper swap.\n4. Docs.",
    "open_objections": [
      {
        "text": "[F-04-adjacent / P-03] Payload serialization (verified). OrderIntentRecord.UpdatedAt is time.Time (order_intent_repo.go:31). structpb.NewStruct rejects it, and emitLedgerEvent discards that error (trading.go:3662), so the event is sent with Payload nil. The sweeper's event is already empty today, and r3's reclaimedUnknownPayload(trigger, out) would copy that defect to all three reactive sites, so the AC-4/8/9 trigger assertions could never pass. Separately, out.UpdatedAt is the CAS's now() (order_intent_repo.go:107-109), not the time the intent went pending. The next proposal must adopt the folded-in fix: a pendingSince parameter (existing.UpdatedAt for reactive sites, rec.UpdatedAt for the sweeper), the value rendered as an RFC3339Nano string, and tests asserting req.Payload != nil and the field values. It must also acknowledge that the sweeper payload goes from nil to populated, a behaviour change to put in front of the operator.",
        "blocking": true
      },
      {
        "text": "[C-03 / operator decision 2026-10-21] The reactive reclaim CAS is a request-derived write but runs on the raw request ctx. A client cancel in the middle of the CAS logs a misleading 'reclaim failed' and leaves the intent PENDING. r3 also claims that 'every new or changed write uses WithoutCancel', which this contradicts. The next proposal must run ReclaimOrphanIntent(context.WithoutCancel(ctx), …) inside reclaimStaleIntent. This is folded into the best approach but not yet answered by a proposer.",
        "blocking": true
      },
      {
        "text": "[C-18 / robustness] WithoutCancel at :1367/:1550 (and now :688/:703) removes the only deadline on the UpsertOrder write. The best approach wraps the call in WithTimeout using an existing bound (ledgerEmitTimeout or the live trading.broker.timeout_ms) to avoid a new literal (F-07). The proposer must pick the bound and cite it.",
        "blocking": false
      },
      {
        "text": "[C-03 / operator 'as much as possible'] Neighbouring pre-existing request-derived Background() calls on lines this change touches: the emits at trading.go:689 and :700, and the FinalizeIntent writes at :706, :1524 and :1553 (also :749 and finalizeCancelIntent :1405). Put them to the operator as one include/defer decision, not just the two emits. If deferred, log them in findings.",
        "blocking": false
      },
      {
        "text": "[P-03] The flatten-path 'reactive_place' label (submitOrder is called from flatten, trading.go:2838) needs a recorded decision. Either accept it in design.md together with the CLAUDE.md row, or pass a caller tag. It was carried from round 2 without being recorded.",
        "blocking": false
      },
      {
        "text": "[C-13 / test design] traceCapturingLedger must record under the embedded recordingLedgerClient mutex, or -race fails. Tests must cancel the parent ctx explicitly before waiting, and must end by waiting on the recorded event, so no emit goroutine logs after captureLogs has restored slog.Default. ctx.Err()==nil alone is tautological under WithoutCancel. The meaningful assertion is that the parent was cancelled before the invoker ran.",
        "blocking": false
      },
      {
        "text": "[evidence] design.md must restate the flatten timing (latest retry ≈ 1× broker timeout + 1.5s, against a ≥1.5× stale threshold). It must also record that an empty owner on the flatten path emits \"\" and carries no trace id, because no request originated it.",
        "blocking": false
      },
      {
        "text": "[PLAT doc drift] Lifecycle events go to a bare orderID stream (trading.go:649, :689, :700, :1370), while the new emits go to `order:`. Log this in findings and do not fix it here.",
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
      "C-03 waiver, with the new emits on context.Background(). The operator rejected it on 2026-10-21. WithoutCancel carries x-trace-id through the existing client interceptor (propagation.go:35-52, trading.go:184).",
      "Reuse the sweeper's payload literal unchanged (r3). Its time.Time value fails structpb.NewStruct and the error is discarded (trading.go:3662), so every event would carry a nil payload. Its UpdatedAt is also the CAS time, not the pending-since time.",
      "Fix serialization generically inside emitLedgerEvent (convert time.Time, or log the NewStruct error). It would touch a shared hot helper beyond D-04/D-62. The helper-level fix plus a findings entry is enough here. Logging the error remains a candidate hardening for the operator.",
      "Synchronous reactive emit on WithoutCancel with a short timeout. It removes goroutine-timing flakiness, but it adds latency to the FailedPrecondition response. The async emit plus a bounded Eventually and explicit ordering was kept.",
      "Keep the request ctx at :1367/:1550 and stay log-only by choice. This conflicts with the operator's binding WithoutCancel rule for request-derived writes.",
      "Surface the D-04 write failure as an RPC error. The broker side effect has already happened, so a retry would collide with an order the broker already holds. It would also reopen PRESERVE @AC-1/@AC-3 @feature-202 and @AC-1 @feature-192.",
      "Retry the D-04 write once on Background(). It adds error-path latency. WithoutCancel plus a timeout removes the cancel failure mode more cheaply.",
      "Extract the full four-way intent-lookup switch. The copies return different types and messages, and the offline copy has no reclaim. The C-18 cost outweighs the DRY gain.",
      "Route the sweeper through the async helper. It would change sweeper emit timing and shutdown cancellation. Only the payload builder is shared.",
      "Take the emit user_id from the middleware header. It is empty on flatten. The resolved owner (accountEntry.userID, order.UserId) is used instead.",
      "Make the reclaim CAS async. It would race a tight client retry.",
      "A bufconn wire test for trace propagation. Calling the real client interceptor through a fake invoker covers the value-to-metadata path, and mTLS already has a wire test."
    ],
    "open_risks": [
      "The sweeper's ledger payload changes from nil to populated. No AC covers it, so any downstream reader that assumed an empty payload is unaffected only by luck. Confirm with the operator.",
      "WithoutCancel extends the lifetime of writes and emits past the RPC and flatten/shutdown ctx. The WithTimeout bound limits this, but a ledger outage still loses the reactive event with only a Warn log.",
      "Eventually-polled async assertions (AC-4/8/9) can flake under CI load if the bound is too tight. Late emit goroutines can pollute captured logs if a test does not wait for its event.",
      "Handler-level tests can be diverted by a missed gate, a nil service field or a request-hash mismatch (the :588 hash-mismatch branch). RED tests must first prove they reach the reclaim branch.",
      "Other emitLedgerEvent callers may also silently send nil payloads because of the discarded NewStruct error. This is out of scope and only logged as a finding.",
      "Flatten-originated reclaims are labelled reactive_place, carry no trace id, and may carry owner \"\".",
      "Reactive emits go to the `order:` stream while lifecycle events go to a bare orderID stream, so per-order ledger queries must read both until the drift is fixed."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-03",
      "C-08",
      "C-11",
      "C-13",
      "C-16",
      "C-18",
      "F-04",
      "F-07",
      "P-02",
      "P-03",
      "P-06"
    ],
    "rationale": "Proposal r3 correctly applies the operator's binding no-Background() rule to the D-04 writes and the reactive emits. It also grounds x-trace-id propagation in the existing ctx-value interceptor chain (propagation.go:35-52, trading.go:184), so the round-2 C-03 objection is closed.\n\nThe adversary raised two blocking defects, and I verified both in the worktree:\n1. Payload serialization. UpdatedAt is time.Time (order_intent_repo.go:31), and emitLedgerEvent discards NewStruct's error (trading.go:3662). The 'known-good' sweeper payload is therefore actually nil today, and AC-4/8/9's trigger assertions could not pass. The CAS's RETURNING updated_at also yields the reclaim time (order_intent_repo.go:107-109), so was_pending_since was wrong as well.\n2. Reclaim CAS ctx. The CAS still runs on the raw request ctx, which contradicts the operator rule and the proposal's own claim.\n\nBoth fixes are concrete and small, and I folded them into the best approach: a pendingSince parameter rendered as an RFC3339 string, and the CAS on WithoutCancel. They stay blocking until a proposer adopts them and shows the payload-non-nil test, because no proposal has answered them yet. I also folded in a bounded timeout for the now-uncancellable DB writes, reusing an existing value. The neighbouring Background() emits and finalizes, and the populated sweeper payload, go to the operator as explicit decisions.\n\nThere are no Floor breaches. Business-rule impact is unchanged:\n- All nine feature ACs are additive (EXTEND).\n- The recon PRESERVE set holds, because RPC codes and messages are unchanged.\n- No operator decision sanctions a business-rule change. The operator's ctx/trace decision governs implementation, not acceptance behaviour."
  },
  "floor_breaches": []
}
```

---

## Session 2026-10-21 — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-trading, xstockstrat-ledger (no change); key reuse patterns: the sweeper's three-way reclaim handling `order_intent.go:144-157`, and `emitLedgerEvent` `trading.go:3661`).
- Phase 1 Grilling: 3 rounds (full). The operator approved at the round-3 gate. No Floor breaches.
  - **Chosen approach:**
    - D-04 is log-only, through `persistOrderBestEffort`. It calls `UpsertOrder` on `WithTimeout(WithoutCancel(ctx), <existing bound>)` and logs `slog.Error` with the raw error.
    - D-62 goes through `reclaimStaleIntent`. It runs the CAS on `WithoutCancel(ctx)`, logs Warn on error, and on success fires an async `order_intent.reclaimed_unknown` emit on `WithoutCancel(ctx)`.
    - The emit payload comes from `reclaimedUnknownPayload(trigger, out, pendingSince)`, with an RFC3339Nano `was_pending_since`. The sweeper shares that builder.
    - Only the reclaim branch is extracted.
  - **Rejected:** the C-03 waiver with `Background()` emits; surfacing the write error as an RPC error; a full switch extraction; reusing the sweeper's `time.Time` payload literal.
- Constitution rules touched: C-01, C-03, C-08, C-11, C-13, C-16, C-18, F-04, F-07, P-02, P-03, P-06. Floor breaches: none.
- Status: spec-ready → design-approved.

### Decisions

- **Open Question 1 closed (C-11):** D-04 is log-only. The broker side effect has already happened at every site, so surfacing the error would invite a retry against an order the broker already holds and reopen PRESERVE @AC-1/@AC-3 @feature-202 and @AC-1 @feature-192.
- **Open Question 2 closed (C-11):** only the reclaim branch is extracted, as `reclaimStaleIntent`. The four-way intent-lookup switch stays.
- **Operator 2026-10-21, C-03 waiver rejected.** Every request-derived write and emit uses `context.WithoutCancel(ctx)`. x-trace-id then flows through the existing ctx-value client interceptor (`propagation.go:35-52`, `trading.go:184`).
- **Operator 2026-10-21, design gate round 3: APPROVED as synthesized.** This includes:
  - `was_pending_since` as an RFC3339Nano string, with a `pendingSince` parameter and a `Payload != nil` test assertion;
  - the reclaim CAS on `WithoutCancel(ctx)`;
  - the sweeper's ledger payload changing from nil to populated, which the operator ACCEPTED.
- **Operator 2026-10-21, scope widening.** The neighbouring pre-existing request-path `context.Background()` ledger emits and finalize calls in `trading.go` also convert to `WithoutCancel(ctx)`, each with a test proving x-trace-id reaches the ledger. `/sdd-spec` enumerates the sites by grep. Background-only callers are left as they are. This replaces the earlier "log as a finding, do not fix" note.
- **Flatten label (P-03):** flatten-originated reclaims are labelled `reactive_place`, and the trading CLAUDE.md row says so. No caller tag is threaded through `submitOrder`. On that path the emit carries no trace id and may carry owner `""`. The latest flatten retry starts at about 1× the broker timeout + 1.5s, while the stale threshold is at least 1.5×, so this case is rare.

## Open Threads

- [ ] Sweeper payload nil → populated, accepted by the operator but guarded by no AC. Check downstream readers and call it out in the PR. Target: the /sdd-spec sweeper-swap step.
- [ ] Pick and cite the `WithTimeout` bound (`ledgerEmitTimeout` `trading.go:3657` or `trading.broker.timeout_ms`, F-07). A ledger outage still loses the reactive event with only a Warn log. Target: the D-04 helper step.
- [ ] Bounded `Eventually` plus explicit parent-cancel ordering, and every test waits on its event so goroutines don't log after `captureLogs` restores `slog.Default`. Target: the RED test step.
- [ ] RED tests must prove they reach the reclaim branch, not the hash-mismatch branch at `:588` or a HALTED gate. Target: the RED test step.
- [ ] Other `emitLedgerEvent` callers may silently send nil payloads, because the `NewStruct` error is discarded at `trading.go:3662`. Out of scope; log in findings. Target: the docs step.
- [ ] Bare-orderID vs `order:` stream drift. Log in findings only. Target: the docs step.
- [ ] Scope-widening list is at recon-time line numbers. Enumerate by grep, with one trace test per converted site. Target: /sdd-spec.
- [ ] `trading.go` merge overlap with 241/242/249/256. Target: the integration PR, via `merge-order.md`.

---

## Session 2026-10-21 — sdd-spec

- Generated implementation-spec.md with 7 steps: 3 RED→GREEN pairs, then docs. Status: design-approved → implementation-ready.
  1. RED tests for D-04 (AC-1/2/3/6).
  2. `persistOrderBestEffort` and the four D-04 sites.
  3. RED tests for D-62 (AC-4/5/7/8/9), plus a sweeper-payload test.
  4. `reclaimStaleIntent`, `reclaimedUnknownPayload`, the reactive sites and the sweeper swap.
  5. RED trace-matrix tests for the scope widening.
  6. The `WithoutCancel(ctx)` conversions.
  7. Docs.
- This discharges the design-session Open Threads on the timeout bound, the scope-widening grep, the downstream-reader check and the RED reach-the-branch guard. Each is handled in its step.
- Key codebase findings:
  - Grep found 40 `context.Background()` hits in `internal/service/trading.go`, and none in the other non-test files of the package.
    - 31 are converted by Step 6; the table is in Step 5.
    - `:688` and `:703` belong to Step 2. Step 2 also handles the raw-ctx writes at `:1367` and `:1550`.
    - Three stay as they are: `:2859` and `:2907` are the background-only bracket-protection watchdog, and `:2617` is an open question (see Open Threads).
  - `finalizeCancelIntent` (`trading.go:1400`) has no ctx parameter. Step 6 adds one, and its callers `:1368`, `:1386` and `:1396` pass the request ctx.
  - Some functions are shared between the request path and the pollers:
    - `applyBrokerOrderStatus` (`:1772`) is reached from a request through `reconcileNotCancelable` `:1394` → `CancelOrder`.
    - `createBracket`/`resizeBracket` (`:3389`/`:3432`) are reached from a request through `submitOrder` `:740`.
    - Their sites are converted. On a poller ctx, `WithoutCancel` behaves like `Background()`: there is no PropagationData and no shutdown cancel. Background behaviour is therefore unchanged.
  - Forwarding the request headers changes no stored owner:
    - Ledger `AppendEvent` takes the owner from `req.userId` and falls back to `x-user-id` only when that is empty (`ledgerServiceImpl.ts:37-39`).
    - Notify `EmitAlert` uses `req.targetUserId`.
  - The ledger and notify clients both chain `middleware.UnaryClientInterceptor` (`trading.go:184`, `:192`). `WithoutCancel(ctx)` therefore carries `x-trace-id` with no new header code.
  - Nothing outside `order_intent.go` references `order_intent.reclaimed_unknown`. Design Open Risk 1 is discharged: no downstream reader assumes a nil payload.
  - `go.mod` has no testify. Bounded polls follow `waitForAlert` (`trading_bracket_test.go:397`).
  - PlaceOrder tests must set three things:
    - `TimeInForce`, because `validateTIF` requires it (`tif_validation.go:61-64`);
    - `platform.trading_state=ACTIVE`, because the default is HALTED (`trading.go:3496-3498`);
    - `trading.risk.max_position_pct=0`.

### Decisions

- **`WithTimeout` bound (design Open Risk 2, F-07):** `persistOrderBestEffort` uses the existing `ledgerEmitTimeout` (`trading.go:3657`). `brokerCallTimeout()` was not used: it is operator-tuned for broker REST latency, so retuning it would silently change the DB-write deadline.
- **Trace-test ordering:** the tests cancel the traced parent ctx *before* the handler runs. This is the deterministic form of design.md's requirement that the parent be cancelled before the invoker ran. It tells the three cases apart:
  - `Background()` → trace `""`;
  - raw ctx → `ctx.Err()!=nil`;
  - `WithoutCancel` → trace set and `ctx.Err()==nil`.
  - If a path aborts on `ctx.Err()`, fall back to the design's cancel-after-return ordering and add a Deviation Log entry.
- **DRY:** the sweeper and `reclaimStaleIntent` share a `reclaimedUnknownEventType` const. This is a spec-level choice with no semantic change.
- **Reclaim CAS:** it runs on `context.WithoutCancel(ctx)` with no extra timeout, as design.md (a) specifies. A stalled DB would hold the handler goroutine after the client disconnects, bounded only by the pool and driver. This is accepted as designed.

## Open Threads

- [ ] **Operator decision needed on `trading.go:2617`.** The call is `validateAndRecordCredential` → `accountRepo.UpdateCredentialStatus(context.Background(), …)`.
  - It is request-reachable (`RegisterBrokerAccount` `:2528`, `UpdateBrokerAccountCredentials` `:2575`) and also poller-reachable (`:2690`).
  - It is neither a ledger emit nor a finalize, and it sits outside the order-state neighbourhood. The standing rule that request-derived writes use `WithoutCancel` could still be read to cover it.
  - It is not converted; Step 7 logs it in the findings file.
  - Decide: convert it in this feature, or route it to a follow-up feature.
- [ ] The sweeper payload changes from nil to populated (Step 4). Call this out in the integration PR body.
- [ ] `trading.go` overlaps with 241/242/249/256. Sequence them through `merge-order.md` at the integration PR.
- [ ] The reclaim CAS has no explicit timeout on `WithoutCancel` (design (a)). Revisit if a DB stall is ever observed.
- [ ] Workflow note: the computed task gave the feature directory as `docs/roadmap/features/docs/roadmap/features/267-fix-trading-order-state-audit/`, with the prefix doubled. The real directory, `docs/roadmap/features/267-fix-trading-order-state-audit/`, was used.

---

## Session 2026-10-21 — sdd-review impl-spec (advisory)

- Result: 0 failures, 8 warnings (advisory, did not block). Overlap: WARN. Lifecycle unchanged (`implementation-ready`).
- Addressed in implementation-spec.md (each claim re-checked against the code):
  - [x] Steps 1, 3 and 5 now state the coverage threshold as N/A: `internal/service/` is excluded from the CI coverage gate (`.github/workflows/ci.yml:259`), and the `>= 40%` gate runs in Step 6 (C-13 / B2).
  - [x] The Step 6 coverage command now uses `export GOWORK=off && …`, so `GOWORK=off` reaches `go list` and `go test`.
  - [x] Step 5 count corrected from 40 to 36 `context.Background()` hits in `trading.go`, grep re-run this session: 31 converted, plus `:688`/`:703` (Step 2), plus `:2617`/`:2859`/`:2907` left as is. The sdd-spec entry above says "40". It is left unedited because this log is append-only, and this line supersedes it.
  - [x] Step 1 gains PARTIALLY_FILLED sub-cases for AC-3 (CancelOrder has no status gate, `trading.go:1237-1314`) and AC-6 (ReplaceOrder accepts PARTIALLY_FILLED at `:1435-1441`; its final `updateOrder` at `:1533-1547` keeps `Status`). This covers product-spec C-5.
  - [x] The Execution Summary now states that STOP, STOP_LIMIT and TRAILING_STOP are unaffected (product-spec C-4).
  - [x] The Step 6 end-state grep now spells out the expectation for each way `:2617` could be decided.
- Still open, carried into /sdd-execute (announce these at each checkpoint, P-03):
  - [ ] **Operator decision on `trading.go:2617`** (`validateAndRecordCredential` → `UpdateCredentialStatus(context.Background(), …)`). Resolve before Step 6, so its grep expectation is final (C-11). This is the same item as the sdd-spec Open Thread.
  - [ ] Step 4 trade-offs (NOTE, accepted in design): the reclaim CAS has no timeout on `WithoutCancel(ctx)` and can outlive a client disconnect. Flatten-originated reclaims are labelled `reactive_place`, with no trace id and possibly an empty owner. Step 7 documents both.
  - [ ] Overlap: `trading.go` with 249 (Step 8 `isUncertainBrokerOutcome` at the submitOrder `:684` and ReplaceOrder `:1521` classifiers, in the same function bodies as this feature's `:688`/`:1550`). That needs a manual merge, not a mechanical rebase. 241 (`:2176` escalateSystemic) is rebase-only. `services/xstockstrat-trading/CLAUDE.md` and `docs/context-constitution-findings.md` overlap with 249 in different sections. Sequence all of these via `merge-order.md` at the integration PR.
  - [ ] Process (not a spec defect): the workflow script doubled the feature-directory prefix again. The relayed user request to "open the follow-up PR for sdd-batch.js" is outside this review step, which may edit feature docs only, and was not done here.

## Session 2026-10-21 (operator decision — `trading.go:2617`)

- **Decided:** convert `validateAndRecordCredential` → `accountRepo.UpdateCredentialStatus(context.Background(), …)` (`trading.go:2617`) in this feature, under the standing x-trace-id rule (request-derived writes use `context.WithoutCancel(ctx)`). It is request-reachable (`RegisterBrokerAccount` `:2528`, `UpdateBrokerAccountCredentials` `:2575`). On the poller path (`:2690`), `WithoutCancel` behaves the same as `Background()`.
- **implementation-spec.md:** Step 5 gains row 32 (`:2617`) with a ctx-capturing `accountRepo` test. "Left as-is" is reduced to `:2859`/`:2907`. Step 6 instruction 3 and the end-state grep now expect only `:2859`/`:2907`.
- **Open Thread resolved:** the earlier "Operator decision needed on `trading.go:2617`" items (sdd-spec Open Threads and the impl-spec carry-over list) are closed by this entry.

## Session 2026-10-28 — re-spec (sdd-execute sequential, sdd-batch-execute)

- Branch setup: `git merge -X ours origin/main-dev` into the detached checkout of `origin/feature/fix-trading-order-state-audit` (4e752827), pushed.
- Re-verified Steps 1, 3, 4, 5, 6, 7 against the merged tree; no blocking mismatch. Citation drift corrected in implementation-spec.md:
  - Step 1: default-HALTED read is `currentTradingState` at `trading.go:3494-3497` (was `:3496-3498`); `FromContext` `propagation.go:20`, `WithPropagationData` `:27` (were `:19-22`/`:24-28`).
  - Steps 1/3/5: CI coverage exclusion is the `COVERPKGS` regex at `.github/workflows/ci.yml:266` (`:259` is the comment block). The 2026-10-21 impl-spec review entry above still says `:259`; this line supersedes it.
  - Step 3: `classifyIntentLookup` PENDING return is `order_intent.go:83-85`; `:98-106` is `staleThreshold`. `UnaryClientInterceptor` starts at `propagation.go:45`. The `reclaimed_unknown` grep also hits trading `docs/context-constitution-findings.md` (the Step 7 drift row, a doc) — "no downstream code reader" still holds. Step 3's test file is created by Step 1.
  - Steps 4, 5 (36 `context.Background()` hits, unchanged), 6, 7: no drift.

## Session 2026-10-28 — sdd-execute sequential (sdd-batch-execute)

- Status: `implementation-ready` → `in-progress`. Mode: sequential (one commit per step on `feature/fix-trading-order-state-audit`, single integration PR at the end).
- **Up-front confirmation (P-03):** given by operator standing authorization — operator chat 2026-10-28 (session_01NpS3HShZK6pSnogA7CFo2f): "Start executing features 241-276" via batch-execute, plus "start batch 2 in parallel too". Recorded answers: checkpoints unattended (`report`); C-16 promotion auto-confirmed unless it changes an existing @AC rule; merge-train authorized; 255/275 deferred; operator-only DB/prod steps — open the PR, hold the merge.
- Carried-forward open items (announce at checkpoints): sweeper payload nil → populated (Step 4, call out in PR body); `trading.go` overlap with 241/242/249/256 (sequence via `merge-order.md`); reclaim CAS has no timeout under `WithoutCancel`.

### Step 1 — test: RED — D-04 order-state write failures are logged (AC-1, AC-2, AC-3, AC-6) [done]
- Created `trading_order_state_audit_test.go`. It holds test-local fakes (`ctxCapturingDB`, `failingExecDB()`,
  `replaceOKBroker`) and the helpers `tracedCancelledCtx`, `findLog` and `waitForLedgerEvents`. It also has
  6 log-assertion tests (AC-1, AC-2, AC-3 plus PARTIALLY_FILLED, AC-6 plus PARTIALLY_FILLED) and 4 ctx
  tests (trace id kept, `ctx.Err()==nil`).
- TDD: RED captured against the unmodified tree (`go test ./internal/service/ -run _AC -race -count=1 -v`).
  - AC-1, AC-2, AC-3 and AC-6: each asserted `want exactly one "order state write failed" record ... got 0` and FAILED.
  - ctx AC-1/AC-2: FAILED with `traceID = "", want t-267` (`Background()`).
  - ctx AC-3/AC-6: FAILED with `ctx.Err() = context canceled`.
  - Every pre-existing `_AC*` test passed.
- GREEN feasibility: the tests were also run against a scratch copy of Step 2's `persistOrderBestEffort`.
  All 10 passed, and `-count=5` was stable. That scratch edit was reverted and not committed; Step 2 owns it.
- Files modified: `services/xstockstrat-trading/internal/service/trading_order_state_audit_test.go`
- Deviations: D1-1 to D1-4 (test-local `replaceOKBroker`, `recordingLedgerClient` instead of `fakeLedgerClient`,
  `-run _AC` instead of the pipe regex, ctx tests split per AC). Full detail is in the Deviation Log.
- Open item: the local `golangci-lint` v2.14.0 binary was built with go1.26 and refuses Go 1.27 modules
  (`can't load config`). Step 1's Verification does not need it. Step 2 does, so Step 2 must use a
  go1.27-built binary or record a CI-lint fallback. `gofmt` and `go vet` are clean.

### Step 2 — service: persistOrderBestEffort and the four D-04 sites (FR-1..FR-4) [done]
- Added `persistOrderBestEffort(ctx, order, path)` above `emitLedgerEvent` in `trading.go`: writes on
  `WithTimeout(WithoutCancel(ctx), ledgerEmitTimeout)` and logs `slog.Error("order state write failed", order_id,
  user_id, status, path, error)`. Replaced the four discarded writes: `broker_timeout` (`:688`),
  `broker_reject` (`:703`), `cancel_final` (`:1367`), `replace_final` (`:1550`). Checked writes `:645`/`:744`
  untouched.
- TDD: RED (pre-change, `go test ./internal/service/ -run _AC -race -count=1 -v`) — the 10 Step 1 tests FAILED
  (no "order state write failed" record; traceID ""; ctx.Err() canceled). GREEN after — all 10 PASS; full
  `go test ./... -race -count=1` passes; `go vet` clean; `golangci-lint run` 0 issues; `grep "_ = s.repo.UpsertOrder"`
  empty.
- Files modified: `services/xstockstrat-trading/internal/service/trading.go`
- Deviations: D2-1 (`-run _AC`), D2-2 (golangci-lint v2.14.0 rebuilt with go1.27 into scratchpad). Closes the
  Step 1 open item on the lint binary for this session.

### Step 3 — test: RED — reactive reclaims are audited and their failures logged (AC-4, AC-5, AC-7, AC-8, AC-9) [done]
- Extended `trading_order_state_audit_test.go` with test-local fakes `staleIntentRepo` (stale PENDING record
  with the exact request hash; it records the CAS ctx's trace id and `ctx.Err()`) and `traceCapturingLedger`
  (runs the real `middleware.UnaryClientInterceptor` through a fake invoker). Helpers: `reclaimCase`, which has
  place/cancel/replace builders, `reclaimSvc`, `assertReachedReclaim` (the reclaim was called and the full
  "still pending" message matches) and `waitForLedgerEventType` (2s/10ms).
- Tests added:
  - AC-4/8/9 (`*_StaleIntent_ReclaimAudited_*`) cover the emit, its payload, the RFC3339 `was_pending_since`
    and the trace id, and check that the CAS and the emit run on an uncancelled ctx.
  - AC-5/7 (`*_StaleIntent_ReclaimFailureLogged_*`) check the "order intent reclaim failed" log and that no
    event is emitted.
  - `TestSweepOrderIntents_PayloadPopulated` and `TestReclaimedUnknownPayload` cover the sweeper payload
    and the payload builder.
- TDD RED, from the specced Verification command against the unmodified tree:
  - Before `TestReclaimedUnknownPayload` was added:
    - AC-4/8/9 FAILED with `reclaim CAS ctx: traceID = "t-267", ctx.Err() = context canceled` and with
      `no "order_intent.reclaimed_unknown" ledger event within 2s (events: [])`.
    - AC-5/7 FAILED with `want exactly one "order intent reclaim failed" record, got 0`.
    - The sweeper test FAILED with `payload is nil`.
    - Every guard passed, so each test reached the reclaim branch for the right reason.
  - After it was added, the build fails with `undefined: reclaimedUnknownPayload`.
- GREEN feasibility: the Step 4 instructions were applied to scratch copies of `order_intent.go` and
  `trading.go`. All 7 tests passed at `-count=3`, and the full `internal/service` package passed with
  `-race`. That scratch edit was reverted and not committed; Step 4 owns it.
- Files modified: `services/xstockstrat-trading/internal/service/trading_order_state_audit_test.go`
- Deviations D3-1 to D3-4 (ledger injection via `reclaimSvc`, AC-5/7 ctx, package-wide build failure until
  Step 4, no husky hook installed in this environment) are detailed in the Deviation Log.
- The pipe-regex `-run` was accepted this session, so the D1-3/D2-1 fallback was not needed.


---

## Session 2026-10-29 — re-spec (sdd-execute sequential, sdd-batch-execute)

- Authorization: operator standing authorization (operator chat 2026-10-28/29, session_01NpS3HShZK6pSnogA7CFo2f):
  "Start executing features 241-276" via batch-execute; unattended checkpoints ("report"), C-16 promotion
  auto-confirmed unless it changes an existing @AC rule, merge-train authorized, 255/275 deferred; operator-only
  DB/prod steps (open PR, hold merge); blocker decisions 2026-10-29 recorded per feature. This stands as the
  up-front confirmation (§5.4) for this run. Status was already `in-progress` (flipped 2026-10-28), so no flip.
- Branch setup (§5.3): `git merge -X ours origin/main-dev` into the feature branch (merge commit 1ee93e5c), pushed.
  The merge removed one line from `trading.go` (`escalateSystemic`, `Author: "system:reconciliation-poller"`,
  from 241-fix-config-audit-author-spoof), so every `trading.go` line at or after `:2173` is one lower.
- Directive: conditional, Steps 5 and 7.
  - Step 5: `Background()` count is 34, not 36 (Step 2 replaced `:688`/`:703` with `persistOrderBestEffort`).
    Re-spec'd the post-merge line numbers: rows #26-#32 `:3396/:3407/:3418/:3424/:3460/:3466/:2616`, callers
    `:2527/:2574/:2689`, flatten `:2837`, left-as-is `:2858/:2906`, watchdog `:2865` → `:2883`. Rows #1-#25,
    fakes and test anchors (`trading_bracket_test.go`, `trading_cancel_not_cancelable_test.go`,
    `trading_order_state_audit_test.go` helpers) and `ci.yml:266` COVERPKGS verified unchanged.
  - Step 7: `emitLedgerEvent` is at `trading.go:3670`, its `p, _ := structpb.NewStruct` at `:3671`. CLAUDE.md
    Ledger Events table (`:139-159`), findings `:13` row and the bare-`orderID` lifecycle emits verified unchanged.
- Not re-spec'd (outside the directive): Steps 4 and 6 also cite `trading.go` lines past `:2173` (`:2838`,
  `:2617`, `:2859`, `:2907`, `:3359`, `:3389`, `:3432`); each is now one lower. The executor of those steps
  should resolve them by symbol, not line.
- Hook note: no `node_modules` in the main worktree and `core.hooksPath` points at a missing `.husky/_`, so the
  husky pre-commit hook does not run in this environment (same as D3-4); doc-only commits here.

---

## Session 2026-10-29 — sdd-execute sequential (sdd-batch-execute), Step 4

### Step 4 — service: `reclaimStaleIntent`, `reclaimedUnknownPayload`, the three reactive sites, and the sweeper payload swap (FR-5, FR-6) [done]
- `order_intent.go`: added `reclaimedUnknownEventType`, `reclaimedUnknownPayload` (RFC3339Nano
  `was_pending_since`, structpb-safe) and `reclaimStaleIntent` (CAS on `context.WithoutCancel(ctx)`, WARN
  `order intent reclaim failed` on error, async emit with the owner) directly above `sweepOrderIntents`. The
  sweeper now emits `reclaimedUnknownPayload("sweep", out, rec.UpdatedAt)`; its ctx, sync emit, `""` user,
  log and `continue`s are unchanged. `trading.go`: the three discarded reclaims (`:603` place, `:1301`
  cancel, `:1498` replace) now call `reclaimStaleIntent` with `reactive_place`/`reactive_cancel`/
  `reactive_replace` and `accountEntry.userID`/`order.UserId`; guards and `FailedPrecondition` returns unchanged.
- TDD: AC-4/5/7/8/9 + sweeper/payload red: build failed `trading_order_state_audit_test.go:590:7: undefined:
  reclaimedUnknownPayload` → green: all 7 named tests PASS (27 matched tests, `ok … internal/service 1.162s`,
  `-race -count=1`). Full `internal/service` package with `-race` also passes.
- Verification: `golangci-lint run --modules-download-mode=mod` → `0 issues.` (D4-1 rebuilt binary);
  `grep -n "_, _, _ = s.orderIntentRepo.ReclaimOrphanIntent" trading.go` → no output; `gofmt -l` clean.
- Sweeper payload nil → populated is the operator-accepted change (round-3 gate); the integration PR body must
  call it out and note Step 3 found no downstream reader.
- Files modified: `services/xstockstrat-trading/internal/service/order_intent.go`,
  `services/xstockstrat-trading/internal/service/trading.go`
- Deviations: D4-1 (lint binary rebuilt), D4-2 (line drift past `:2173`, no effect), D4-3 (no husky hook).
- Review carry-over: the Step 4 trade-off item (no timeout on the `WithoutCancel` CAS; flatten reclaims
  labelled `reactive_place`, no trace id, possibly empty owner) stays `[ ]` until Step 7 documents it.

---

## Session 2026-10-29 — sdd-execute sequential (sdd-batch-execute), Step 5

### Step 5 — test: RED — every request-reachable `Background()` emit/finalize carries the inbound x-trace-id [done]
- Discovery note: the workflow's discovery digest reported `trading_order_state_audit_test.go` and its helpers
  missing. It had read the main worktree, not `origin/feature/fix-trading-order-state-audit`. On the feature
  branch the file and `ctxCapturingDB`/`tracedCancelledCtx`/`traceCapturingLedger` exist (Steps 1 and 3), so
  this was not a blocker. All 34 `context.Background()` hits in `trading.go` match the re-spec'd table.
- Added to `trading_order_state_audit_test.go` (all test-local, C-13 single consumer):
  - fakes: `ctxCapturingIntentRepo`, `traceCapturingNotify`, `ctxCapturingAccountRepo`, `replaceFailBroker`;
  - helpers: the `traceHarness`/`newTraceHarness` harness, `assertTraced` and `assertLedgerTraced`;
  - `outgoingTraceID`, shared with `traceCapturingLedger` (D5-4);
  - 11 `TestTrace_*` drivers covering rows #1-#32.
- Every driver runs on `tracedCancelledCtx("u-1")` and polls async emits and alerts for up to 2s on a 10ms tick.
- TDD red: `go test ./internal/service/ -run 'TestTrace_' -race -count=1 -v` → `FAIL`.
  - Every row fails as `x-trace-id = ""` (or `order-state write traceID = ""` for #9), with `ctx.Err()` nil.
  - There were no panics, races or build errors, and no non-`TestTrace_` test in the package fails.
- GREEN feasibility: Step 6 was applied to a scratch copy of `trading.go`, with every site except `:2858`/`:2906`
  set to `WithoutCancel(ctx)` and `finalizeCancelIntent` given a ctx param.
  - `TestTrace_*` passed at `-race -count=3`, and the full `internal/service` package passed with `-race`.
  - The scratch edit was reverted and not committed; Step 6 owns it.
- Verification: `gofmt -l` is clean; `go vet` is clean; `golangci-lint run --modules-download-mode=mod` → `0 issues.`
- Files modified: `services/xstockstrat-trading/internal/service/trading_order_state_audit_test.go`
- Deviations D5-1..D5-5 are in the Deviation Log:
  - D5-1: row #32 driver added per the evidence paragraph;
  - D5-2: the #30/#31 sub-case split;
  - D5-3: the bracket-call rows are asserted transitively;
  - D5-4: the shared interceptor helper;
  - D5-5: environment.
- `internal/service` tests fail on this branch until Step 6 lands, because the `TestTrace_*` RED suite is in place. Step 6 must land before the
  integration PR's CI runs.

---

## Session 2026-10-29 — sdd-execute sequential (sdd-batch-execute), Step 6

### Step 6 — service: convert the request-reachable `Background()` sites to `context.WithoutCancel(ctx)` [done]
- Discovery: the digest read the main worktree and reported Step 5 missing; on `origin/feature/fix-trading-order-state-audit`
  Step 5 is done (`696dfa39`) and the 34 `Background()` hits match the Step 5 table. Not a blocker.
- Change: rows #1-#32 now pass `context.WithoutCancel(ctx)`; `finalizeCancelIntent` gained a leading `ctx` param and its
  three callers (`CancelOrder`, `reconcileNotCancelable` x2) pass the request ctx. `:2858`/`:2906` left as `Background()`.
  No comments added. 36 lines changed, `trading.go` only.
- TDD red (pre-change): `go test ./internal/service/ -run 'TestTrace_' -race -count=1` → `FAIL`, every row `x-trace-id = ""`
  (e.g. `UpdateCredentialStatus: x-trace-id = "", ctx.Err() = <nil>; want t-267 and nil`).
- TDD green: same command → all 12 `TestTrace_*` PASS (`ok internal/service 1.165s`).
- Verification: `grep -n "context.Background()" trading.go` → only `:2858`, `:2906`; `gofmt -l` / `go vet` clean;
  `golangci-lint` → `0 issues.` (D6-1); full suite `go test ./... -race` all ok, coverage total `73.3%` (D6-2).
- Files modified: `services/xstockstrat-trading/internal/service/trading.go`
- Deviations: D6-1 (lint binary), D6-2 (coverage command literal COVERPKGS), D6-3 (cited lines -1, resolved by table).
- The `internal/service` package is green again on the branch (the Step 5 RED suite now passes).

---

## Session 2026-10-29 — sdd-execute sequential (sdd-batch-execute), Step 7

### Step 7 — docs: ledger-event row, trading findings [done]
- Discovery: the digest read the main worktree and reported Steps 4 and 6 pending. On
  `origin/feature/fix-trading-order-state-audit` both are done (`00326e31`, `8f7e2804`). The row's claims
  were re-checked against the code there: `reclaimedUnknownPayload` (`trigger`, `order_id`, `intent_id`,
  `was_pending_since` as RFC3339Nano), stream `"order:"+OrderID`, and triggers `sweep`, `reactive_place`,
  `reactive_cancel`, `reactive_replace`. Not a blocker.
- Change: added the `order_intent.reclaimed_unknown` row to trading CLAUDE.md "Ledger Events Emitted".
  In the findings file: marked the `:13` row resolved (267); added a doc-lie row for the bare `orderID`
  lifecycle stream vs `order:{order_id}`; added a latent-bug row for `emitLedgerEvent` discarding the
  `NewStruct` error.
- TDD: N/A (docs). Baseline before the edit: the second verification grep exited 1 (no row).
- Verification: both specced greps now match (CLAUDE.md `:159`, findings `:13`).
- Teardown: the context-constitution plugin is unavailable, so reconciliation was done by hand (D7-1). The
  integration PR body must record both facts.
- Files modified: `services/xstockstrat-trading/CLAUDE.md`, `services/xstockstrat-trading/docs/context-constitution-findings.md`
- Deviations: D7-1 (teardown by hand), D7-2 (backticks), D7-3 (no hook installed).

---

## Session 2026-10-29 — sdd-batch-execute promotion plan (awaiting operator confirm)

C-16 promotion plan for the durable trading acceptance suite. Nothing is written to
`services/xstockstrat-trading/acceptance/` until the operator confirms.

```sdd-batch-promotion-plan
## Promotion plan - fix-trading-order-state-audit (feature 267)

### Verdicts
| @AC | target suite (path) | CREATE/APPEND | verdict | note |
|---|---|---|---|---|
| AC-1 | /home/user/xstockstrat/services/xstockstrat-trading/acceptance/fix-trading-order-state-audit.feature | CREATE | NEW | PlaceOrder broker timeout, failed order write logged |
| AC-2 | same | CREATE | NEW | PlaceOrder broker reject, failed order write logged |
| AC-3 | same | CREATE | NEW | CancelOrder final write failure logged |
| AC-4 | same | CREATE | NEW | reactive PlaceOrder reclaim audited |
| AC-5 | same | CREATE | NEW | CancelOrder reclaim failure logged |
| AC-6 | same | CREATE | NEW | ReplaceOrder final write failure logged |
| AC-7 | same | CREATE | NEW | ReplaceOrder reclaim failure logged |
| AC-8 | same | CREATE | NEW | reactive CancelOrder reclaim audited |
| AC-9 | same | CREATE | NEW | reactive ReplaceOrder reclaim audited |

### Ready-to-write blocks
--- /home/user/xstockstrat/services/xstockstrat-trading/acceptance/fix-trading-order-state-audit.feature (CREATE) ---
# Promoted from docs/roadmap/features/267-fix-trading-order-state-audit/acceptance.feature at
# launch (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-267` tag.
# Durable regression guards for the defect at docs/reports/2026-10-21-trading-order-state-audit-defect.md:
# trading must not silently discard UpsertOrder errors (D-04) or reactive ReclaimOrphanIntent results (D-62).
# A rule enters only by promotion from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: fix-trading-order-state-audit (bug fix)
  Regression guard for docs/reports/2026-10-21-trading-order-state-audit-defect.md:
  trading discards UpsertOrder errors (D-04) and reactive ReclaimOrphanIntent results (D-62).

  @AC-1 @FR-1 @regression @feature-267
  Scenario: A failed order-state write after a broker timeout is logged
    Given a trading repository whose UpsertOrder returns error "db unavailable"
    And a broker whose PlaceOrder returns context.DeadlineExceeded
    When user "u-1" places a buy 10 "AAPL" market order with client_order_id "c-1"
    Then an error-level log records the failed order write with the order id, user "u-1" and status ORDER_STATUS_NEW

  @AC-2 @FR-2 @regression @feature-267
  Scenario: A failed order-state write after a broker reject is logged
    Given a trading repository whose UpsertOrder returns error "db unavailable"
    And a broker whose PlaceOrder returns a rejection "insufficient buying power"
    When user "u-1" places a buy 10 "AAPL" market order
    Then an error-level log records the failed order write with the order id, user "u-1" and status ORDER_STATUS_REJECTED

  @AC-3 @FR-3 @regression @feature-267
  Scenario: A failed final write in CancelOrder is logged
    Given an open order "o-1" for user "u-1"
    And a trading repository whose UpsertOrder returns error "db unavailable"
    When user "u-1" cancels order "o-1"
    Then an error-level log records the failed order write for order "o-1", user "u-1" and status ORDER_STATUS_CANCELED

  @AC-6 @FR-4 @regression @feature-267
  Scenario: A failed final write in ReplaceOrder is logged
    Given an open limit order "o-1" for user "u-1"
    And a trading repository whose UpsertOrder returns error "db unavailable"
    When user "u-1" replaces order "o-1" with limit price 101.00
    Then an error-level log records the failed order write for order "o-1" and user "u-1"

  @AC-4 @FR-5 @regression @feature-267
  Scenario: A reactive stale-intent reclaim is audited like a sweeper reclaim
    Given an order intent "c-1" for user "u-1" in PENDING last updated longer ago than the stale threshold
    When user "u-1" calls PlaceOrder again with client_order_id "c-1"
    Then the call returns FailedPrecondition "still pending"
    And the ledger receives an "order_intent.reclaimed_unknown" event for intent "c-1" with trigger "reactive_place"

  @AC-5 @FR-6 @regression @feature-267
  Scenario: A failed reactive reclaim in CancelOrder is logged
    Given an open order "o-1" for user "u-1" with a cancel intent in PENDING older than the stale threshold
    And an order-intent repository whose ReclaimOrphanIntent returns error "db unavailable"
    When user "u-1" cancels order "o-1"
    Then the call returns FailedPrecondition "still pending"
    And a log records the failed reclaim with the cancel intent id and error "db unavailable"

  @AC-7 @FR-6 @regression @feature-267
  Scenario: A failed reactive reclaim in ReplaceOrder is logged
    Given an open limit order "o-1" for user "u-1" with a replace intent in PENDING older than the stale threshold
    And an order-intent repository whose ReclaimOrphanIntent returns error "db unavailable"
    When user "u-1" replaces order "o-1" with limit price 101.00
    Then the call returns FailedPrecondition "still pending"
    And a log records the failed reclaim with the replace intent id and error "db unavailable"

  @AC-8 @FR-5 @regression @feature-267
  Scenario: A reactive stale-intent reclaim in CancelOrder is audited
    Given an open order "o-1" for user "u-1" with a cancel intent in PENDING older than the stale threshold
    When user "u-1" cancels order "o-1"
    Then the call returns FailedPrecondition "still pending"
    And the ledger receives an "order_intent.reclaimed_unknown" event for order "o-1" with trigger "reactive_cancel"

  @AC-9 @FR-5 @regression @feature-267
  Scenario: A reactive stale-intent reclaim in ReplaceOrder is audited
    Given an open limit order "o-1" for user "u-1" with a replace intent in PENDING older than the stale threshold
    When user "u-1" replaces order "o-1" with limit price 101.00
    Then the call returns FailedPrecondition "still pending"
    And the ledger receives an "order_intent.reclaimed_unknown" event for order "o-1" with trigger "reactive_replace"

### Notes / ambiguities / conflicts
- All 9 scenarios assert on trading-service behavior (logs, PlaceOrder/CancelOrder/ReplaceOrder results, ledger emit), so none is cross-cutting. platform.feature was grepped and has no related rules.
- Dedup: grep of the 8 existing suites in /home/user/xstockstrat/services/xstockstrat-trading/acceptance/ for reclaimed_unknown, ReclaimOrphanIntent, UpsertOrder and "still pending" returned nothing. There is no OVERLAP, DUP or CONFLICT.
- AC-1 to AC-9 are kept verbatim and in source order (AC-6 sits before AC-4, as in the source). The only change is the added @feature-267 tag. A header provenance comment is added to the new file.
- The scenarios only add audit and logging guarantees and contradict no promoted rule. The new `order_intent.reclaimed_unknown` ledger event is additive and is not in trading CLAUDE.md's emitted-events table. The orchestrator may want to update that table (docs only).

### Coverage check
- Source scenarios: 9 (AC-1 to AC-9). Planned: 9 NEW, 0 DUP, 0 OVERLAP. All are accounted for and none were skipped.
```

## Session 2026-10-30 (CI: feature status automation)

- Promotion PR #1368 merged to main
- Feature promoted and committed: df521ff51091a86e813950b34afff09ac4e8821b
- Status updated: `code-completed` → `launched`
- Launched date: 2026-10-30
