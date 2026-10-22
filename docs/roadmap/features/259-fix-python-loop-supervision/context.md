# Context Log: fix-python-loop-supervision

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-python-loop-supervision-defect.md` (Issues disabled);
  sidecar `triaged` / `ref: feature:259-fix-python-loop-supervision`.
- Source: repo-surveyor debt-radar scan `docs/repo-surveyor/debt-radar-findings.md` @ 4535695, findings D-07, D-08, D-56.
- Severity: SEV-2 (group). Impact type: silent-background-loop-death. Environment: dev (main-dev) @ a053b0e. Config-only: no.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2 (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..6), context.md.
- Affected services: xstockstrat-analysis, xstockstrat-indicators, xstockstrat-ingest.
- Root cause hypothesis: per-cycle hardening without a supervised-loop helper or task registry (D-07); gRPC-only
  reconnect handler (D-08); skip-on-error plus a `GREATEST` cursor (D-56).
- Re-verification on a053b0e: all three D-ids reproduce by reading.
  - D-07: scan cites `fundsignal_loop.py:164-165` → now `:158-165` (`while True` at `:164`); `_tick`'s `except` also
    does DB I/O (`:152-155`). Servicer loops unchanged at `servicer.py:5925-5930`, `:6100-6106`, `:6144-6146`.
    `DurableSchedule` has no try at all (`durable_schedule.py:57,75,91`). `main.py` unretained `create_task` at
    `:143,167,174,194,211,215,221,225`. `live_loop.run_forever` (`live_loop.py:326-338`) is the guarded counter-example.
  - D-08: analysis `watcher.py:56,78` (unchanged), indicators `:56,77` (unchanged), ingest `:69,91` (unchanged).
  - D-56: `pnl_pattern_consumer.py:155-159` (scan `:156-159`), `GREATEST` at `:408`.
- **Overlaps:**
  - `244-fix-python-config-stored-zero` (implementation-ready) edits the same three `app/config/watcher.py` files
    (getters, not `_watch`) and the tick functions this feature touches: `servicer.py:5890,6066` and
    `fundsignal_loop.py:143,154` (`retry_seconds` wrappers), plus `entry_backfill.py:56-58`. Line-disjoint today, but
    rebase against 244 if it merges first; record in `merge-order.md` at /sdd-spec.
  - `248-fix-ledger-trimmed-notify-payload` (implementation-ready) Step "consumers unchanged" re-reads
    `pnl_pattern_consumer.py:147-162` and treats any change that advances a cursor before the handler as stop-and-ask.
    D-56's fix keeps that property (it retries before advancing), but it changes those lines, so 248's verification
    grep (`await asyncio.sleep(2)`) must still hold or be re-pointed. Sequence 248 first or coordinate.
  - `246-fix-fundsignal-neutral-score` and `260-fix-fundsignal-emit-accounting` edit `fundsignal_loop.py` (scoring /
    emit areas, disjoint from `run_forever`/`_tick`); rebase only.
  - `262-fix-analysis-owner-scope` (D-55) touches the unretained `entry_backfill` task at `main.py:174`; agree who
    owns the task-retention helper (this feature) so 262 reuses it rather than adding a second one.
  - Same-batch sibling `268-fix-indicators-formula-correctness` (draft) touches indicators
    `tests/test_config_watcher.py` and cites `pnl_pattern_consumer.py:50`; test-file rebase only.
- Recommended design depth: full → `/sdd-design fix-python-loop-supervision` (rationale: 3 affected services, the C-0
  full trigger). Design forks: one shared supervised-loop helper vs per-loop try; where the retained task set lives;
  D-56 poison-event rule (retry count, then park table vs log-and-advance).
- Development branch: feature/fix-python-loop-supervision

## Session 2026-10-21 — sdd-review product-spec

- Product spec approved (PASS WITH WARNINGS). Status: draft → spec-ready.
- OPERATOR DECISIONS (binding, recorded 2026-10-21):
  - Grouped by service+theme from the 2026-10-20 debt-radar scan; Track C.
  - Scope is D-07, D-08, D-56.
- Warnings:
  1. AC-7 "attempted up to the retry bound" had no concrete value. **Resolved:** AC-7 now pins a 3-attempt bound as
     its example, and FR-5 says design/spec re-points the example if it picks another value.
  2. AC-1/AC-2 Then steps describe internals. **Partly resolved:** AC-2 now asserts a further tick runs and the error
     is logged. AC-1 keeps `_tick` called as a regression guard; sharpen at /sdd-spec if needed.
  3. Problem Statement named no persona. **Resolved:** added a "Who is affected" line (trader/operator).
  4. Scope gap: the indicators/ingest/analysis watcher tasks are unretained (`watcher.py:56` / `:56` / `:69`), but no FR
     covered it. **Resolved:** FR-3 now requires the watch task to stay referenced with an exit log; new AC-8.
  5. FR-5 retry bound and park mechanism deferred to design. Open for design: a parked-events table needs an analysis
     migration up/down pair and DBA review (already in Fix Scope); any knob follows C-05/F-07.
  6. Possible overlap with batch peer `fix-config-stream-resilience` on the same `watcher.py` files. Open: confirm the
     boundary and merge order at /sdd-design.
- Overlap findings (WARN, no FAIL):
  - `services/xstockstrat-analysis/app/main.py:174` — shared with `262-fix-analysis-owner-scope` (entry backfill
    task). This feature owns the task-retention helper; 262 reuses it.
  - `services/xstockstrat-analysis/app/engine/fundsignal_loop.py` — `run_forever`/`_tick` (`:152-165`) vs
    `246-fix-fundsignal-neutral-score` (implementation-ready, steps 1-2) and `260-fix-fundsignal-emit-accounting`
    (draft, `_emit_signal` `:242-256`). Disjoint lines, same file; rebase, most acute with 246.
  - `services/xstockstrat-ingest/app/config/watcher.py` — `_watch` (`:79-93`) vs `244-fix-python-config-stored-zero`
    (getters) and `261-fix-ingest-poller-backfill` (`resolve_secret` `:155-163`). Disjoint lines; rebase.
  - `services/xstockstrat-indicators/app/config/watcher.py` — `_watch` (`:58-79`) vs `244-fix-python-config-stored-zero`
    (getters). Disjoint lines; rebase.
- Next: `/sdd-design fix-python-loop-supervision` (full depth).

## Session 2026-10-22 — sdd-batch design state recovered (round 2)

- The batch run that produced round 2 was cut off by the session usage limit before its gate writer persisted the debate state. This block is the round-2 synthesis restored verbatim from the run journal (`synth:fix-python-loop-supervision:r2`), so the next /sdd-batch run resumes from it instead of redoing the debate.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "The round-1/round-2 structure stays as it is: supervision.py (spawn/_on_done/retry_until_ok/run_supervised), seed \u2192 jitter \u2192 run_supervised for the four *_forever loops, spawn at the eight analysis main.py sites, and the three identical config/watcher.py edits. No proto, migration or config key is added. Round 3 changes only the P&L consumer (FR-4/FR-5) in services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py.\n\n(1) Per-event retry. The per-event try at :156-159 becomes `await self._process_with_retry(event)`. It retries in place up to _EVENT_MAX_ATTEMPTS=3, with _EVENT_RETRY_BACKOFF_SECONDS=1.0 between attempts. The cursor re-read and the early return at :165-168 keep a partly committed attempt from doing anything twice.\n\n(2) Classification and the escalation counter (fixes adversary blocking #1). When attempts run out, the last error goes to the existing is_transient_db_error (read_budget.py:17-32).\n- Non-transient: park the event.\n- Transient: update the in-memory pair `_replay_seq: int | None`, `_replay_count: int`. If event.sequence == _replay_seq, add 1; otherwise set it to (seq, 1). Then re-raise to the outer reconnect handler (:160-162: sleep 2 s, re-read the cursor, reopen StreamEvents).\n- RESET RULE: the pair resets only when an event with `sequence >= _replay_seq` completes and gets past the early return, or when an event is parked. The replay is inclusive (ledgerServiceImpl.ts:190-191, :239 `sequence >= $3`), so after each reconnect the first event delivered is the cursor's own, already-processed row. Its early return at :167-168 is a no-op and must never reset the counter.\n- Log level: below _REPLAY_ESCALATE_AFTER=5 the line is log.warning. From 5 on it is log.error naming sequence, event_type and correlation_id.\n\n(3) DB-health probe (proposed fix for adversary blocking #2, FR-5 \u2014 not yet confirmed by a proposer). When _replay_count reaches _REPLAY_ESCALATE_AFTER, run one probe, `await self._cursor()` (:140-145).\n- If the probe raises: the DB is really out. Keep replaying at ERROR and never park.\n- If the probe succeeds while the same sequence is still failing transiently: the event is deterministic poison (for example a QueryCanceledError or TimeoutError that hits on every attempt). Park it with reason=\"transient-persistent\".\nThis keeps FR-5's promise that one bad event cannot stall the stream, and still never parks during a real outage. No time cap and no persisted state are added (C-18, instance_count 1).\n\n(4) Park sequence, in fixed order:\n- (a) A structured log.error with sequence, event_id, event_type, correlation_id, attempts, reason, and the identity key (user_id/account_id/symbol/trading_mode when the payload has them).\n- (b) `await asyncio.wait_for(self._emit(\"analysis.pnl.event_parked\", f\"pnl_park:{seq}\", payload, correlation_id=event.correlation_id, idempotency_key=f\"pnl_park:{seq}\"), _PARK_EMIT_TIMEOUT_SECONDS)`. The timeout sits on this call site only. On timeout, log a warning and continue, so the park can never stall the consumer.\n- (c) `_advance_cursor(event.sequence)` (:399).\n- (d) Reset the replay pair.\n\nThe ledger idempotency_key (ledger.proto:50; ledger CLAUDE.md \u00a7 Idempotent Append) makes the park record exactly-once. The log line stays at-least-once. The consumer skips its own park event through the analysis.* self-skip at :170-174.\n\n(5) _emit (:415-435) gains three keyword-only defaults: `correlation_id=\"\"` (AppendEventRequest.correlation_id, ledger.proto:41), `idempotency_key=\"\"` (:50) and, when correlation_id is non-empty, outbound call metadata `((\"x-trace-id\", correlation_id),)`. With those defaults, existing callers (:299 and the snapshot emits) produce the same request as today: no new fields, no metadata, no timeout (P-03). The spec must confirm that LedgerEvent.correlation_id (field 4, \"trace/request correlation\") is the originating trace and not something in metadata (field 8). It must also confirm that ledger accepts an emit with no x-user-id under mTLS. The park row is ownerless by design (ledgerServiceImpl.ts:37-39).\n\n(6) Acceptance (C-15). Edit this feature's own @AC-7 directly to read \"a non-transient error on every attempt, or a transient error that persists while the DB probe succeeds\", and add `And an \"analysis.pnl.event_parked\" ledger event records sequence 10`. Amend the FR-5 text in product-spec.md to match. Add @AC-9 @feature-259: a transiently failing event is not parked while the DB probe fails, and the 5th replay of the same sequence logs ERROR naming it.\n\n(7) Tests, using a fake StreamEvents:\n- The stream re-yields the cursor at N, then N+1 raising a transient error, five times; assert ERROR on the fifth and that the cursor's own early return does not reset the counter.\n- At K with the probe failing: assert replay and no park.\n- At K with the probe succeeding: assert the park order log \u2192 emit (idempotency_key set) \u2192 advance.\n- Non-transient: park immediately.\n- Hanging AppendEvent at park: wait_for fires and the cursor still advances.\n- Success on sequence >= _replay_seq resets the counter.\n- Existing _emit callers send no metadata, no correlation_id and no idempotency_key.\n\n(8) Analysis CLAUDE.md gets:\n- A \"Ledger Events Emitted\" row for analysis.pnl.event_parked (ownerless by design, idempotent per sequence).\n- The retry / replay / probe / park rule.\n- The accepted limitation that a parked position.closed leaves the window open and loses that close's realized_pnl, which compounds the v1 shared-position_id limitation. The identity key in the park payload is there for reconciling it.\n- The fixed invariants: _EVENT_MAX_ATTEMPTS=3, _EVENT_RETRY_BACKOFF_SECONDS=1.0, _REPLAY_ESCALATE_AFTER=5, _PARK_EMIT_TIMEOUT_SECONDS (spec pins a value, suggested 5), _LOOP_ERROR_BACKOFF_SECONDS=30. These follow the servicer.py:346-347 fixed-invariant precedent and the fixed-invariant branch of @AC-7 @feature-158.\n\nBuild order is unchanged from the prior state. Step 4 (P&L) now also covers the _emit keyword additions, the probe, and the @AC-7/@AC-9 edits.",
    "open_objections": [
      {
        "text": "Escalation reset rule (adversary r2 #1). Confirmed in code: StreamEvents replay is inclusive (ledgerServiceImpl.ts:190-191, :239 `sequence >= $3`), run_forever reconnects from _cursor() (pnl_pattern_consumer.py:151-153), and process_event returns early when sequence <= cursor (:167-168). Under r2's rule that any successful process_event resets the counter, every reconnect resets it, so the ERROR escalation never fires. This repeats fails.md:1616. The synthesis pins a fix: reset only when an event with sequence >= _replay_seq completes past the early return, or on park, with the fake-stream test described in the approach. The proposer has not yet adopted it, so this stays open until the next proposal confirms the rule and the test.",
        "blocking": true
      },
      {
        "text": "FR-5 / P-03 conflict (adversary r2 #2). _TRANSIENT includes OSError (read_budget.py:17-18), which covers TimeoutError and ConnectionError on 3.13, and QueryCanceledError. Under r2, a deterministic poison event that times out on every attempt replays forever and blocks attribution for every later event. That narrows FR-5 without operator sign-off. The synthesis proposes the DB-health probe at K replays: _cursor() succeeding means park as transient-persistent, raising means keep replaying. Low rework, and no time cap. The next proposer must either adopt the probe, including its false-park risk under heavy load, or get explicit operator sign-off recorded in context.md for the replay-forever trade-off.",
        "blocking": true
      },
      {
        "text": "Trace field confirmation. The spec must confirm that LedgerEvent.correlation_id (ledger.proto:28, 'trace/request correlation') carries the originating x-trace-id and that it is not in LedgerEvent.metadata (field 8). It must also confirm that ledger AppendEvent accepts a call with no x-user-id under mTLS. The second point was carried over from the r2 assumptions and is not yet verified.",
        "blocking": false
      },
      {
        "text": "_PARK_EMIT_TIMEOUT_SECONDS needs a pinned value in the spec, suggested 5 s. On timeout, the TimeoutError raised by asyncio.wait_for wraps _emit from outside, so _emit's own except never sees it. The spec must catch TimeoutError at the park call site, log a warning and continue to the advance step.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-7 @feature-158",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-9 @feature-158",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3 @feature-156",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4 @feature-156",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5 @feature-156",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-173 zero-trap (@feature-173)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@feature-174 client_id prefix",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3 @feature-171",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 @feature-042",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-6 @feature-042",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-7 @feature-042",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-10 @feature-029",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3 @FR-4 @feature-042 @feature-225",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-17 @feature-225",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5 @FR-5 @feature-210",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-1 @feature-259",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-2 @feature-259",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-3 @feature-259",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-4 @feature-259",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-5 @feature-259",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-6 @feature-259",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-7 @feature-259",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-8 @feature-259",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-9 @feature-259 (new: transient replay never parks while probe fails; escalates to ERROR)",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      }
    ],
    "rejected_alternatives": [
      "Resetting the escalation counter on any successful process_event (r2). The cursor's own row is re-delivered on every reconnect (inclusive replay, ledgerServiceImpl.ts:239) and returns early at :167-168, so the counter would reset every time and the stall would stay a WARN forever (fails.md:1616).",
      "Replay forever on any transient error, accepted as a risk (r2 'Strongest risk'). It narrows FR-5 ('one bad event cannot stall the stream') without operator sign-off (P-03). The DB-health probe resolves it at the cost of one query.",
      "Parking after a wall-clock cap (for example 30 min stuck on one sequence). It parks good events during a long DB outage.",
      "Parking after N escalations without a probe. Same flaw: it parks good events during an ordinary outage.",
      "Order log \u2192 advance \u2192 emit for the park. A crash between the advance and the emit loses the ledger record. A wait_for bound on the emit in the log \u2192 emit \u2192 advance order removes the stall without that loss.",
      "Adding an RPC deadline inside _emit for every caller. It changes the existing post-commit emits (P-03). The timeout is applied only at the park call site.",
      "Building the park AppendEvent inline instead of extending _emit. It duplicates _emit (C-18).",
      "At-least-once park records without an idempotency_key. Ledger AppendEvent already provides at-most-once dedup (ledger.proto:50), so exactly-once costs one keyword with a stable-input key (fails.md:2118-2122).",
      "A consumer-local wrapper around is_transient_db_error so the two policies can diverge later. That is speculative (YAGNI, CLAUDE.md behavior 2), and the probe already separates the consumer's policy from the read-path classifier.",
      "A persisted per-sequence attempt table. In-memory state is enough with instance_count 1 (feature 156 insight) (C-18).",
      "A migration-028 parked-events table. It needs a DBA gate, risks a number collision with peers 260/262/272, and risks leaking into QueryPnLPatterns. The ledger with an idempotency key gives a durable, queryable record.",
      "Labelling this feature's own @AC-7 edit as CHANGE. CHANGE in C-16 applies to existing durable rules. @AC-7 is this feature's unlaunched scenario, so it is edited directly, and FR-5 is amended to match.",
      "Carried over from the prior state: per-seam try hardening inside the ticks, a new local _TRANSIENT tuple, tolerating a failed seed, moving the seed into run_supervised, capped exponential backoff, retrying by reconnecting the stream, a per-caller backoff callable, and the analysis watcher using supervision.spawn."
    ],
    "open_risks": [
      "Probe false-park under load. The DB can be reachable (the probe's SELECT succeeds) while a heavy event keeps hitting statement timeouts from contention, not from its payload. The probe then parks a good event after about 5 \u00d7 (3 attempts + reconnect) \u2248 25-30 s. The damage is limited: the park is recorded exactly-once in the ledger with its identity key for reconciliation. The spec should say whether K=5 is enough or whether two consecutive probe-confirmed escalations are needed.",
      "Probe and event share the pool. With TooManyConnectionsError, the probe probably fails too, so replay continues. That is the right call for an outage, but a pool leak caused by the event itself would look like an outage and replay forever at ERROR.",
      "A parked position.closed leaves the pnl_positions window open. The next close seals a window with a stale opened_at and mixed snapshots, and the parked close's realized_pnl is lost. This is an accepted limitation, recorded in CLAUDE.md and reconcilable from the park payload.",
      "The park-emit timeout drops the ledger record. If AppendEvent hangs past _PARK_EMIT_TIMEOUT_SECONDS, only the log line survives, which is the same durability as a log-only park, in that rare case.",
      "Opportunity tick worst case (carried over): if the final advance (servicer.py:5903) keeps failing, the full all-user recompute re-runs every 30 s while the DB write path stays broken.",
      "Test sentinels (carried over): any loop test that breaks out by raising an Exception subclass will spin under the supervisor. All of them must be converted to BaseException, and the sleep must stay outside the try.",
      "Watchers re-dial every 2 s indefinitely during a long config outage (carried over). The log noise is bounded because there are only three subscribers.",
      "Escalation counter is not persisted. A restart resets it to zero, which only delays the ERROR and the probe by K replays. Acceptable with instance_count 1."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-03",
      "C-08",
      "C-11",
      "C-15",
      "C-16",
      "C-18",
      "F-07",
      "P-02",
      "P-03",
      "D-20"
    ],
    "rationale": "I checked the adversary's two blocking claims against the code, and both hold:\n- ledgerServiceImpl.ts:190-191 seeds maxSeq at fromSequence-1, and :239 queries `sequence >= $3`. run_forever reconnects from _cursor() (:151-153), and process_event returns early on `sequence <= cursor` (:167-168). So r2's reset rule would zero the counter on every reconnect.\n- _TRANSIENT (read_budget.py:17-27) includes OSError and QueryCanceledError, so deterministic timeouts would replay forever, against FR-5's stated promise.\n\nThe synthesis pins concrete, low-rework fixes for both: a reset limited to sequence >= _replay_seq, and a single-query DB-health probe at K. Neither fix has been proposed by a proposer yet, so both objections stay open and blocking until the next round adopts them, or until an operator signs off the replay-forever trade-off in context.md.\n\nI adopted the non-blocking hardening items because each is a keyword or call-site change that leaves existing emits byte-identical (P-03):\n- idempotency_key for an exactly-once park record (ledger.proto:50 exists);\n- wait_for on the park emit only, so the park cannot stall;\n- x-trace-id call metadata taken from correlation_id, which follows the standing operator trace decision (C-03): no minted context, and the trace is carried when available;\n- the identity key in the park payload.\n\n@AC-7 is this feature's own scenario, so it is reclassified from CHANGE to an in-feature edit (EXTEND under the operator's D-56 scope decision), and a new @AC-9 covers the transient-replay and escalation behavior (C-15). The overall wrap-don't-harden structure is unchanged, which keeps the diff off the lines peers 244/246/260 touch and honors the user's 'preserve as much as you can while having low rework' directive."
  },
  "floor_breaches": []
}
```
