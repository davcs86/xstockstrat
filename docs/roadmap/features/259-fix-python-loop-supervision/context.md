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

## Session 2026-10-22 — sdd-batch design gate (round 3)

The full `/sdd-design fix-python-loop-supervision` debate is at its approval gate after round 3 (gate policy: halt). design.md is not written and status.md is unchanged, per the grilling protocol. The state block below lets the next /sdd-batch run resume at round 4.

### Open Threads

- **Approach.** The r1–r3 structure carries forward unchanged: `supervision.py` (spawn/_on_done/retry_until_ok/run_supervised), seed → jitter → run_supervised for the four `*_forever` loops, `spawn` at the eight analysis `main.py` sites, and the three identical `config/watcher.py` edits. There is no proto change, no migration and no config key. Both operator-bound r2 rules, the replay reset rule (`sequence >= _replay_seq`) and the DB-health probe at K=5, are implemented correctly in r3 and their blocking objections are closed. Round 4 must still revise the P&L consumer (`services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py`) on these points:
  - a consumer-local positive poison allow-list `_is_poison`, covering ValueError, TypeError, KeyError, protobuf decode errors and asyncpg SQLSTATE classes 22/23. Every other error goes to replay plus the probe;
  - the probe bounded with `asyncio.wait_for(self._cursor(), _PROBE_TIMEOUT_SECONDS)`, with a timeout treated as DB down;
  - a `_stream_fail_count` that escalates to ERROR on the 5th consecutive outer-handler failure;
  - the park emit bounded by a keyword-only gRPC `timeout` inside `_emit` (default None);
  - `correlation_id=event.correlation_id` added to the existing emits at :243 and :299, under the operator's 2026-10-21 trace decision;
  - pinned park-failure semantics: a raise in `_advance_cursor` propagates without resetting the replay pair, and the re-park is deduplicated by `pnl_park:{seq}`.
- **Strongest open objection (BLOCKING).** Classifier inversion. `read_budget.is_transient_db_error` (:31-32) is an allow-list that defaults to non-transient. Under r3, OutOfMemoryError (53200), deadlock/serialization (class 40) and DiskFull therefore park after 3 attempts at about 1 s spacing and never reach replay or the probe. The close's realized_pnl and fees_total are then lost for good, which is a C-16 regression risk on @AC-2 @feature-042 and @AC-10 @feature-029. The synthesis pins the `_is_poison` fix, but no proposer has adopted it yet. It stays blocking until round 4 confirms the predicate and adds the OOM/deadlock-goes-to-replay test.
- **Other open items (non-blocking).**
  - the full-outage escalation gap, when `_cursor()` raises before StreamEvents opens (fails.md:1616);
  - probe and attempt hangs, because pool.acquire()/fetchval have no timeout;
  - the trace-field confirmation (`LedgerEvent.correlation_id` vs metadata, and AppendEvent with no x-user-id under mTLS);
  - ledger replay amplification (at most 5 unpaged StreamEvents per stuck event), to coordinate with fix-ledger-query-pagination.
- **Floor status.** No Floor breaches.
- **Uncovered @AC changes.**
  - All prior durable rules are PRESERVE.
  - This feature's @AC-1..@AC-8 are EXTEND and covered by the operator decision. That includes the in-feature @AC-7 edit (poison allow-list or probe-confirmed transient-persistent, plus a recorded park ledger event).
  - The new @AC-9 (no park while the bounded probe fails or times out, and the 5th replay logs ERROR) is also covered by the operator decision.
  - The new **@AC-10 @feature-259** (the 5th consecutive stream/cursor failure logs ERROR) is EXTEND but **not** covered by an operator decision, which covers the reset rule and the probe but not outer-handler escalation. It falls within D-56 scope and needs operator sign-off at the gate.

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "The round-1 to round-3 structure stays as it is: supervision.py (spawn/_on_done/retry_until_ok/run_supervised), seed → jitter → run_supervised for the four *_forever loops, spawn at the eight analysis main.py sites, and the three identical config/watcher.py edits. There is no proto change, no migration and no config key. Round 3 adopts both operator-bound rules. Round 4 must still change the P&L consumer in services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py as follows.\n\n(1) Per-event retry, unchanged from r3. The per-event try at :156-159 becomes `await self._process_with_retry(event)`. It makes up to _EVENT_MAX_ATTEMPTS=3 attempts with _EVENT_RETRY_BACKOFF_SECONDS=1.0 between them, and the sleep sits outside the try. Each attempt re-reads the cursor and returns early (:165-168), so an attempt that partly committed is never applied twice.\n\n(2) Classifying an exhausted event. This replaces r3's reuse of is_transient_db_error and resolves the blocking objection. I checked read_budget.py:17-32: it is an allow-list, so anything not listed is treated as non-transient. That includes OutOfMemoryError (53200, the feature-141 SEV-2 failure), DeadlockDetectedError and SerializationError (class 40), DiskFullError and other InsufficientResourcesError.\n- The consumer gets its own predicate, `_is_poison(e)`, defined next to the constants at :37-47.\n- It is a positive allow-list of payload and logic errors: ValueError, TypeError, KeyError, google.protobuf DecodeError/ParseError, and asyncpg DataError (SQLSTATE class 22) and IntegrityConstraintViolationError (class 23).\n- Poison: park with reason=\"non-transient\".\n- Everything else goes to the replay and probe path. It must not import read_budget._TRANSIENT; the policies are opposite by design, because here a misclassification loses data.\n\n(3) Replay counter and reset rule (operator decision 1, adopted in r3). The pair is `_replay_seq` / `_replay_count`: if event.sequence == _replay_seq, add 1; otherwise set it to (seq, 1).\n- Log at warning below _REPLAY_ESCALATE_AFTER=5 and at error from 5 on, naming sequence, event_type and correlation_id.\n- Reset in run_forever right after `_process_with_retry` returns without raising, only `if self._replay_seq is not None and event.sequence >= self._replay_seq`. Also reset on park, at step (d).\n- The cursor's own row is re-delivered inclusively and has sequence == cursor < _replay_seq, so its early return never resets the counter.\n\n(4) DB-health probe at K (operator decision 2, adopted in r3, now bounded). Once _replay_count >= 5, run exactly one `await asyncio.wait_for(self._cursor(), _PROBE_TIMEOUT_SECONDS)` (:140-145) in its own try.\n- The probe raises or times out: the DB is down or the pool is exhausted. Log at error and re-raise to the reconnect handler. There is no park and no time cap.\n- The probe returns: park inline with reason=\"transient-persistent\" and continue the `async for`.\n\n(5) Outer-handler escalation (new). Add `_stream_fail_count`.\n- The outer except at :160-162 increments it and logs at warning below _REPLAY_ESCALATE_AFTER, at error from the 5th on.\n- It resets on the first event the stream delivers.\n- This covers a full outage where `_cursor()` at :151 raises before StreamEvents opens and the failing event is never re-delivered (fails.md:1616).\n\n(6) Park sequence, in fixed order:\n- (a) Structured log.error with sequence, event_id, event_type, correlation_id, attempts, reason, and the identity key when the payload has it.\n- (b) `await self._emit(\"analysis.pnl.event_parked\", f\"pnl_park:{seq}\", payload, correlation_id=event.correlation_id, idempotency_key=f\"pnl_park:{seq}\", timeout=_PARK_EMIT_TIMEOUT_SECONDS)` with the timeout set to 5. DEADLINE_EXCEEDED is swallowed by _emit's existing except at :434, so no separate TimeoutError handler is needed.\n- (c) `_advance_cursor(event.sequence)` (:399).\n- (d) Reset the replay pair.\n\nA raise in (c) propagates to the reconnect handler and (d) does not run. The re-park on replay is deduplicated by the ledger idempotency_key (ledger.proto:50). The same holds for the poison branch. The park event is self-skipped on the way back in (:170-174).\n\n(7) `_emit` (:415) gains keyword-only `correlation_id=\"\"`, `idempotency_key=\"\"` and `timeout=None`. When correlation_id is non-empty it sends `x-trace-id` call metadata. Under the operator's standing 2026-10-21 trace decision, the existing post-commit emits at :243 and :299 now pass `correlation_id=event.correlation_id`. That is a sanctioned change, and the \"byte-identical existing callers\" test is dropped. timeout stays None for those emits, so their latency is unchanged (P-03).\n\n(8) Acceptance and spec edits:\n- Edit this feature's own @AC-7 to read \"a poison error (payload/logic, SQLSTATE 22/23) on every attempt, or a non-poison error that persists while the bounded DB probe succeeds\", with a step that the park ledger event is recorded. Amend FR-5 to match.\n- Add @AC-9 @feature-259: no park while the probe fails or times out, and the 5th replay logs ERROR.\n- Add @AC-10 @feature-259: when _cursor() raises on every call, the 5th consecutive stream failure logs ERROR.\n- Add a test that OutOfMemoryError and DeadlockDetectedError go to replay, not to an immediate park.\n\n(9) Analysis CLAUDE.md § P&L pattern consumer:\n- The retry, poison, replay, probe and park rules.\n- An \"analysis.pnl.event_parked\" row in Ledger Events Emitted.\n- The fixed invariants: _EVENT_MAX_ATTEMPTS=3, _EVENT_RETRY_BACKOFF_SECONDS=1.0, _REPLAY_ESCALATE_AFTER=5, _PROBE_TIMEOUT_SECONDS (spec pins it, suggested 5), _PARK_EMIT_TIMEOUT_SECONDS=5, _LOOP_ERROR_BACKOFF_SECONDS=30.\n- Both accepted limitations: a parked position.closed leaves its window open and loses its realized_pnl, and a parked order.created/filled opens no window, so its later close no-ops (sealed is None, :281).\n\nBuild order is unchanged. Step 4 (P&L) rebases onto peer 248, which touches :147-162.",
    "open_objections": [
      {
        "text": "Classifier inversion (adversary r3, BLOCKING; C-16 regression risk on @AC-2 @feature-042 and @AC-10 @feature-029; P-03). I checked the code: is_transient_db_error (read_budget.py:31-32) returns True only for listed types, so OutOfMemoryError (53200), DeadlockDetectedError/SerializationError (class 40), DiskFullError and other InsufficientResourcesError count as non-transient. Under r3 step 2 these park after 3 attempts at 1 s spacing, never reach the replay or probe path, and the close's realized_pnl and fees_total are lost for good. The synthesis pins a consumer-local positive poison allow-list, _is_poison: ValueError/TypeError/KeyError/protobuf decode errors and asyncpg SQLSTATE classes 22/23. Every other error goes through replay plus the probe. The proposer has not adopted it yet, so this stays blocking until the next proposal confirms the predicate and adds the OOM/deadlock replay test.",
        "blocking": true
      },
      {
        "text": "Full-outage escalation gap (fails.md:1616). When _cursor() at :151 raises before StreamEvents opens, _replay_count never advances, and the outer handler at :160-161 logs WARNING forever. The fix is a _stream_fail_count that logs ERROR from the 5th consecutive failure, resets on the first delivered event, and is covered by a new @AC-10 test in which _cursor() always raises.",
        "blocking": false
      },
      {
        "text": "Probe and attempt hang. pool.acquire()/fetchval have no timeout (:141, :205, :268, :400), so during pool exhaustion the probe blocks instead of raising, the task stays alive, and FR-2's done-callback never fires. Bound the probe with asyncio.wait_for(self._cursor(), _PROBE_TIMEOUT_SECONDS) and treat a timeout as DB down. Correct the r3 'inverse case' risk text. The spec should also say whether process_event attempts need the same bound.",
        "blocking": false
      },
      {
        "text": "Trace id on existing emits (operator standing decision 2026-10-21, C-03). The existing post-commit emits at :243 and :299 must pass correlation_id=event.correlation_id. The r3 'byte-identical existing callers' test is dropped. The other option is an explicit operator deferral recorded in context.md.",
        "blocking": false
      },
      {
        "text": "Bound the park emit with a gRPC deadline inside _emit (keyword-only timeout, default None), not with wait_for at the call site. DEADLINE_EXCEEDED is then caught by the existing except at :434, and existing callers keep timeout=None.",
        "blocking": false
      },
      {
        "text": "Park failure semantics. The spec must state that a raise in _advance_cursor at step (c) propagates to the reconnect handler without resetting the replay pair, and that the re-park is deduplicated by idempotency_key pnl_park:{seq}. Pin both with a test, for the poison branch and the transient-persistent branch.",
        "blocking": false
      },
      {
        "text": "Trace-field confirmation, carried over. The spec must confirm that LedgerEvent.correlation_id (ledger.proto:28) carries the originating x-trace-id and not metadata (field 8), and that ledger AppendEvent accepts a call with no x-user-id under mTLS.",
        "blocking": false
      },
      {
        "text": "Ledger replay cost. Each replay below K reopens an unpaged StreamEvents(from_sequence=cursor) on ledger's single query connection (fails.md:3006-3010). Note the bounded amplification (at most 5 per stuck event) and coordinate with peer fix-ledger-query-pagination.",
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
        "ac_id": "@AC-7 @feature-259 (in-feature edit: poison allow-list or probe-confirmed transient-persistent; park ledger event recorded)",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-8 @feature-259",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-9 @feature-259 (new: no park while bounded probe fails or times out; 5th replay logs ERROR)",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-10 @feature-259 (new: 5th consecutive stream/cursor failure logs ERROR)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Reusing read_budget.is_transient_db_error to classify consumer errors (r3). It is an allow-list whose default is non-transient, so OOM (53200), deadlock/serialization (class 40) and disk-full park immediately and lose data. A wrong answer there costs a 500; here it loses data permanently. A consumer-local positive poison list is required.",
      "Widening read_budget._TRANSIENT to cover class 40/53. It changes the read-path status mapping (P-03) for a consumer-policy problem.",
      "K=5 with two consecutive probe confirmations (r3 runner-up). It doubles the time to park real poison (about 50-60 s) and does not fix the classifier gap. The spec may revisit it if contention-driven false parks turn out to be high.",
      "Probing the failing event's own tables (SELECT 1 FROM analysis.pnl_positions) instead of _cursor(). It is just as blind to statement timeouts, so the gain is marginal.",
      "asyncio.wait_for around the park _emit at the call site (r3). It adds a second error path. A keyword-only gRPC timeout inside _emit, swallowed by the existing except, is simpler (C-18), and existing callers keep timeout=None.",
      "Keeping existing post-commit emits byte-identical, with no correlation_id. This contradicts the operator's 2026-10-21 standing trace-propagation decision, and threading it through costs 2 lines.",
      "Resetting the escalation counter on any successful process_event (r2). The inclusive cursor-row replay resets it on every reconnect (fails.md:1616).",
      "Replaying forever on any transient error (r2). It narrows FR-5 without operator sign-off.",
      "Parking after a wall-clock cap, or after N escalations without a probe. Both park good events during a real outage.",
      "Order log → advance → emit for the park. A crash between the advance and the emit loses the ledger record.",
      "A persisted per-sequence attempt table or a migration-028 parked-events table. In-memory state is enough with instance_count 1, and a table brings a DBA gate and peer number-collision risk.",
      "Labelling the in-feature @AC-7 edit as CHANGE. It is this feature's own unlaunched scenario, so it is edited directly.",
      "Carried over: per-seam try hardening, a new local _TRANSIENT tuple, tolerating a failed seed, moving the seed into run_supervised, capped exponential backoff, retry-by-reconnect, a per-caller backoff callable, and the analysis watcher using supervision.spawn."
    ],
    "open_risks": [
      "Probe false park under load. _cursor() succeeds while a heavy valid event keeps hitting QueryCanceledError or statement timeouts from contention. The event is parked after about 25-30 s, so the close's realized_pnl is lost and its window stays open. The damage is limited because the park is recorded exactly once in the ledger with its identity key.",
      "Poison allow-list incompleteness. A deterministic payload bug that raises an unlisted type (for example AttributeError or ZeroDivisionError) goes through the replay and probe path and is parked about 25-30 s later instead of after about 2 s. That is safe, only slower. Listing too much would bring back data loss, so the list must stay narrow.",
      "Attempt hang. process_event's pool.acquire() has no timeout, so pool exhaustion can stall an attempt before the probe is ever reached. The spec should decide whether to bound attempts as well.",
      "A parked order.created/filled opens no window, so its later close no-ops (sealed is None, :281). A parked position.closed leaves its window open with stale opened_at. Both are documented, accepted limitations that can be reconciled from the park payload.",
      "Ledger replay amplification. Up to 5 unpaged StreamEvents re-queries per stuck event on ledger's single query connection (fails.md:3006-3010). Coordinate with fix-ledger-query-pagination.",
      "Adding correlation_id and x-trace-id to the existing emits at :243 and :299 changes those requests. It is sanctioned by the operator's trace decision, but ledger must accept the metadata under mTLS. This is unverified.",
      "Counters (replay and stream-fail) are not persisted. A restart delays escalation by K. Acceptable with instance_count 1.",
      "Carried over: opportunity-tick full recompute every 30 s if servicer.py:5903 keeps failing; test sentinels must be BaseException with the sleep outside the try; watchers re-dial every 2 s during a long config outage."
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
    "rationale": "I checked the adversary's blocking claim against the code, and it holds. read_budget.py:31-32 returns `not isinstance(e, _NOT_TRANSIENT) and isinstance(e, _TRANSIENT)`, and _TRANSIENT (:17-27) does not include OutOfMemoryError, the class-40 errors or DiskFull. So r3 would park real transient failures within about 2 s and lose data, which is a C-16 regression risk on the P&L attribution rules. The fix is low-rework: one consumer-local predicate that defaults the other way. It stays blocking because no proposer has adopted it yet.\n\nI also confirmed the full-outage gap. _cursor() at :151 sits inside the outer try, and its failure only logs warning at :161, so I pinned a stream-fail escalation counter for it.\n\nThe other adversary items are each adopted as small, concrete hardening:\n- the bounded probe;\n- the gRPC deadline inside _emit, which supersedes r3's wait_for and the prior state's rejection of an _emit deadline, because the keyword defaults to None for existing callers;\n- correlation_id on the existing emits, required by the operator's standing trace decision, so the P-03 byte-identical argument is overridden by an explicit operator rule;\n- the park-failure semantics;\n- the parked-order limitation.\n\nBoth operator-bound r2 rules (the reset rule and the probe) are implemented correctly in r3 and are carried over unchanged. The prior blocking objections on them are closed.\n\n@AC-10 is new and is an EXTEND of this feature's own scenarios. It is not marked covered_by_operator_decision, because the operator decision covers the reset rule and the probe but not the outer-handler escalation. It does fall within the D-56 scope."
  },
  "floor_breaches": []
}
```

## Session 2026-10-22 — sdd-design approved

- Phase 0 Recon: recon.md was written in an earlier session. Services: analysis, indicators, ingest. Reuse: the per-cycle swallow+log shape (`live_loop.py:335-338`), `_advance_cursor` for the park, and the `servicer.py:346-347` fixed-invariant precedent.
- Phase 1 Grilling: 3 rounds (full). Resumed from the round-3 gate state recorded above.
- OPERATOR DECISIONS (binding, recorded 2026-10-22):
  - Design gate r2: run another round. The proposer must adopt the escalation reset rule (reset only when an event with sequence >= `_replay_seq` completes past the early return, or on park, with a fake-stream test) and the DB-health probe at K replays (`_cursor()` succeeds → park as transient-persistent; it raises → keep replaying, no time cap; the false-park risk is recorded).
  - Design gate r3: APPROVED as synthesized, PLUS a binding positive poison allow-list. A consumer-local `_is_poison` returns True only for ValueError/TypeError/KeyError, protobuf decode errors and asyncpg SQLSTATE classes 22/23, and those park quickly. Every other error (including OutOfMemoryError 53200, class 40 DeadlockDetected/Serialization, DiskFull/InsufficientResources) goes through replay plus the DB-health probe. Add an OOM/deadlock replay test. `read_budget.is_transient_db_error` is not used to decide parking. This resolves the r3 blocking classifier-inversion objection. The r3 approval also covers the new `@AC-10 @feature-259` (outer-handler stream-fail escalation).
  - Standing 2026-10-21: x-trace-id is propagated wherever possible, with no C-03 waiver, so the existing P&L emits at `:243`/`:299` pass `correlation_id=event.correlation_id`.
- Chosen approach: the shared `app/supervision.py` (spawn/_on_done/retry_until_ok/run_supervised) wraps the four `*_forever` loops and the eight `main.py` boot sites. All three `ConfigWatcher._watch` copies get the same catch-widen + retain edit. The P&L consumer gets a 3-attempt in-place retry, then the `_is_poison` park, or replay with the reset rule, a bounded probe at K=5, a stream-fail escalation, and a log → idempotent ledger emit → advance park.
- Rejected: reusing `is_transient_db_error`, widening `_TRANSIENT`, a parked-events table or migration, a wall-clock park cap, per-seam try hardening, and capped exponential backoff (full list in design.md).
- Constitution rules touched: C-01, C-03, C-08, C-11, C-15, C-16, C-18, F-07, P-02, P-03, D-20. Floor breaches: none.
- Business rules: all prior durable `@AC-*` are PRESERVE. `@AC-1..@AC-10 @feature-259` are EXTEND (the `@AC-7` in-feature edit and the new `@AC-9`/`@AC-10` are applied at /sdd-spec). There is no CHANGE.
- Status: spec-ready → design-approved.

### Open Threads

- [ ] Probe false park under load (contention-driven statement timeouts while `_cursor()` succeeds). Target: /sdd-spec step 4 (document it; revisit two-confirmation K if it is observed).
- [ ] Poison allow-list incompleteness (unlisted deterministic errors park about 25-30 s late; keep the list narrow). Target: step 4 + the analysis CLAUDE.md.
- [ ] Attempt hang: `pool.acquire()`/`fetchval` are unbounded (`:141,:205,:268,:400`). Decide whether process_event attempts get a timeout. Target: /sdd-spec step 4.
- [ ] Parked `order.created`/`filled` opens no window, and a parked `position.closed` leaves its window open. These are accepted limitations. Target: step 5 (the analysis CLAUDE.md).
- [ ] Ledger replay amplification (up to 5 unpaged StreamEvents per stuck event). Target: /sdd-spec; coordinate with fix-ledger-query-pagination in merge-order.md.
- [ ] Confirm that `LedgerEvent.correlation_id` (ledger.proto:28) carries x-trace-id and does not go into metadata, and that `AppendEvent` accepts x-trace-id metadata with no x-user-id under mTLS. Target: /sdd-spec step 4 discovery.
- [ ] The replay and stream-fail counters are not persisted, so a restart delays escalation by K. Target: step 5 (docs).
- [ ] Carried over: the opportunity tick recomputes every 30 s if `servicer.py:5903` keeps failing; loop-test sentinels must be BaseException with the sleep outside the try; watchers re-dial every 2 s during a config outage. Target: steps 2-3 + 5.
- [ ] Apply the `@AC-7` edit, add `@AC-9`/`@AC-10` to acceptance.feature, and amend FR-5 in product-spec.md. Target: /sdd-spec.
- [ ] Rebase step 4 onto peer 248 (`pnl_pattern_consumer.py:147-162`); the watcher and tick steps rebase vs 244/246/260; 262 reuses `supervision.spawn`. Target: /sdd-spec merge-order.md.

## Session 2026-10-22 — sdd-spec

- Generated implementation-spec.md with 15 steps (7 service/test red-green pairs + 1 docs step). Status: design-approved → implementation-ready.
- Applied the design.md §4 in-feature acceptance edits: `@AC-7` is now a Scenario Outline (poison → 3 attempts,
  `non-transient`; persistent non-poison with the probe up → 15 attempts, `transient-persistent`) plus the
  `analysis.pnl.event_parked` ledger step; appended `@AC-9` (no park while the probe raises/times out; 5th replay logs
  ERROR; the re-delivered cursor row never resets the count) and `@AC-10` (5th consecutive stream/cursor failure logs
  ERROR). FR-5 in product-spec.md amended to match. Coverage: AC-1..3 → Step 4; AC-4 → Step 2; AC-5/AC-8 → Steps 6/8/10;
  AC-6/AC-7/AC-9/AC-10 → Step 14 (AC-7 request shape also Step 12).
- Key codebase findings:
  - Trace field confirmed: `AppendEventRequest.correlation_id` (`ledger.proto:41`) is the trace (identity maps
    `x-trace-id → correlation_id`, `ledgerAudit.ts:3,49`); ledger accepts a missing `x-user-id` as an ownerless row
    (`ledgerServiceImpl.ts:37-39`). Portfolio's emitter sets no correlation id (`portfolio_service.go:1026-1035`), so
    close events carry no trace today; nothing is minted.
  - `tests/test_fundsignal_loop.py:375` `_StopLoop(Exception)` must become `BaseException`, or the two `@AC-7 @feature-156`
    jitter tests spin under `run_supervised`. `tests/test_opportunity_refresh.py:109` `_Stop(Exception)` is raised from
    the sleep (outside the try) and stays valid.
  - `FakeLedger.AppendEvent(req, metadata=())` (`tests/test_pnl_pattern_consumer.py:138-145`) must accept `timeout`.
  - `docs/patterns/config-startup.md:87` ("retries … on `AioRpcError`") becomes drift; fixed in Step 15.
  - asyncpg is not installed in the spec sandbox; the asyncpg exception names in Step 13 resolve at execute (an
    import-time failure in Step 14 would surface a wrong name).

### Decisions

- `_PROBE_TIMEOUT_SECONDS = 5`, `_PARK_EMIT_TIMEOUT_SECONDS = 5` pinned (fixed invariants).
- Attempt hang: **no per-attempt timeout** in this feature (would cancel inside an open asyncpg txn; C-18). Documented
  as an accepted limitation; detection belongs to the out-of-scope liveness metric. Flagged for impl-spec review.
- `supervision._on_done`: ERROR on an exception exit; silent on cancellation and one-shot completion; INFO (never
  ERROR) when a `forever=True` task returns (the benign early returns).
- Probe seam is a `_probe_db()` method wrapping `asyncio.wait_for(self._cursor(), _PROBE_TIMEOUT_SECONDS)` so tests can
  drive the raise/timeout branches without breaking the other `_cursor()` reads.
- The park reads identity keys from `event.payload.fields`, not `MessageToDict`, since the poison may be the decode.

### Open Threads

- [ ] Record the 259 entry in `docs/roadmap/features/merge-order.md` (248 first on `pnl_pattern_consumer.py:147-162`;
  244/246/260 rebases; 262 reuses `spawn`; 268 test file; replay amplification vs fix-ledger-query-pagination). Target: Step 15.
- [ ] Probe false park, allow-list incompleteness, attempt hang, parked-window limitations, unpersisted counters.
  Target: Step 15 (analysis CLAUDE.md).

## Session 2026-10-22 — sdd-review impl-spec

- MODE B (advisory; lifecycle unchanged, stays `implementation-ready`). Criteria: PASS WITH WARNINGS (0 FAIL, 7 WARN).
  Overlap: WARN (file-level merge-conflict risk only; no migration / proto field / config-key collision).
- Addressed in `implementation-spec.md`:
  - Step 1 Verification: `grep -c "create_task"` would count the `main.py:220` comment (2, not 1); now
    `grep -c "create_task("` (the comment has no `(`).
  - Step 1 Instructions: `functools` added to `supervision.py`'s stdlib imports (for `functools.partial`), or a closure.
  - Step 13 Evidence: asyncpg exception names verified against the locked `asyncpg==0.31.0` wheel (`uv.lock:44-45`):
    `PostgresConnectionError`, `DataError`, `IntegrityConstraintViolationError`, `SerializationError`,
    `DeadlockDetectedError`, `OutOfMemoryError` all exist and are re-exported at top level. Replaces the
    "not installed in the sandbox" note.
  - Attempt-hang refs `pnl_pattern_consumer.py:141,205,268,400` all re-verified (`fetchval` `:141`, `acquire()` the rest).
  - Step Dependencies: explicit rebase note — Step 13 re-greps on the post-Step-11 file, Step 14 builds on the
    post-Step-12 test file.
  - Step 4 item 4: added per-loop seed-failure cases (each servicer loop and fundsignal) pinning the `retry_until_ok`
    wiring, not only the helper.
- No change needed: Step 15 item 5 already carries the root `CLAUDE.md` Teardown (context-forge refresh, or manual
  reconciliation recorded in the PR body). Step 13's density is a recorded C-18 design choice.
- Overlap: peer rebases (244, 246, 248, 260, 262, 268) are already listed in § Step Dependencies and go into
  `merge-order.md` at Step 15. The overlap scan read peers from main-worktree copies, so edits that exist only on
  peers' feature branches were not checked.

### Open Threads

- [ ] Operator confirmation: accept **no per-attempt timeout** on `process_event`. A pool-exhaustion hang on
  `pool.acquire()`/`fetchval` stalls the P&L consumer with no ERROR, and FR-2's done-callback never fires. Documented
  at Step 15; detection deferred to the out-of-scope liveness metric. Target: `/sdd-execute` checkpoint before Step 13.
- [ ] Re-check peer branches (`origin/feature/*` for 215, 244, 246, 248, 260, 262, 268) for line claims on the shared
  files before each touching step. The overlap scan did not cover branch-only edits. Target: `/sdd-execute` discovery.

## Session 2026-10-22 (operator decision — per-attempt timeout)

- **Decided: bound each P&L-consumer attempt's DB waits** (overrides the /sdd-spec "no per-attempt timeout" call).
  `_ATTEMPT_DB_TIMEOUT_SECONDS = 10` is applied as `pool.acquire(timeout=…)` and asyncpg per-query `timeout=…` on
  the attempt path, not as an `asyncio.wait_for` around `process_event`, so no transaction is cancelled at the
  Python level. A hang becomes a non-poison `TimeoutError` that flows into retry → replay → probe.
- `implementation-spec.md` updated: the decisions bullet, Step 13 item 6b, the Step 13 verification grep and the
  Step 15 CLAUDE.md limitation text. **Step 14 must add a test:** a fake pool whose `acquire()` never returns makes
  the attempt fail with `TimeoutError` within the bound and reach the replay path (no silent stall).

## Session 2026-10-28 (sdd-execute sequential (sdd-batch-execute))

- **Up-front confirmation:** the operator approved the up-front plan by standing authorization — operator chat
  2026-10-28 (session_01NpS3HShZK6pSnogA7CFo2f): "Start executing features 241-276" via batch-execute; answers:
  unattended checkpoints (`report`), auto-confirm C-16 promotion unless it changes an existing `@AC` rule,
  merge-train authorized, defer 255/275; operator-only DB/prod steps: open PR, hold merge; "start batch 2 in
  parallel too".
- Branch setup (§5.3): `git merge -X ours origin/main-dev` into the detached `origin/feature/fix-python-loop-supervision`
  checkout (merge 4140f349).
- **Re-spec (steps 4, 15) — line drift only, no substantive mismatch:**
  - Step 4: `tests/test_fundsignal_loop.py` anchors moved — `class _StopLoop(Exception)` `:377` (was `:375`),
    `_sched_loop` `:381`, `_make_loop` `:47`, `_make_cfg` `:23`, `fundsignal_module.asyncio` sleep patches `:496`/`:513`,
    `_tick` `side_effect=_StopLoop` patches `:501`/`:516`. `fundsignal_loop.py` `_tick` `:128`, `run_forever` `:158`,
    `:155`/`:165` raise points unchanged. Every named symbol still exists.
  - Step 15: `merge-order.md` now has one hit for 259 at `:83`, inside the 262 row ("262 also reuses 259's
    task-retention helper for the main.py:174 task"); 259 still has no entry of its own, so the add-entry instruction
    stands (verification now greps the slug). Analysis `CLAUDE.md` sections drifted +1 (`:130`, `:143`, `:549`);
    `config-startup.md:87` still says "on `AioRpcError`".
- Status: `implementation-ready` → `in-progress`.

## Session 2026-10-28 — sdd-execute sequential, Step 1

- **Step 1 done** (service, FR-2): created `services/xstockstrat-analysis/app/supervision.py` (`spawn`, `_on_done`,
  `retry_until_ok`, `run_supervised`, `_BACKGROUND_TASKS`, `_LOOP_ERROR_BACKOFF_SECONDS = 30`; stdlib only) and
  routed the eight `main.py` boot tasks through `spawn` with the spec's names/`forever` flags. The `:120` shutdown
  task is unchanged; `grep -c "create_task(" app/main.py` = 1, `spawn(` = 8 sites.
- TDD (red-green, Step 2's `tests/test_supervision.py` written per Step 2 instructions, not committed in Step 1):
  @AC-4 red: `ImportError: cannot import name 'supervision' from 'app'` → green: `6 passed`. Full suite 1306 passed;
  `ruff check .` / `ruff format --check .` clean.
- Deviation: the readiness-materializer comment's "create_task is safe" now reads "spawn is safe" (see Deviation Log).
- Peer `262-fix-analysis-owner-scope` must reuse `supervision.spawn` for the `entry-backfill` task (now `main.py:175`).

## Session 2026-10-28 — sdd-execute sequential, Step 2

### Step 2 — test: supervision helper and boot retention (@AC-4) [done]
- Created `services/xstockstrat-analysis/tests/test_supervision.py`: @AC-4 crash-logged/sibling-retained/cancel-silent,
  one-shot vs `forever` normal return, `_on_done` never raises, `run_supervised` backoff `[30, 0.0]` with a
  `BaseException` sentinel, `retry_until_ok` `[30, 30]`, and the `main.py` wiring guard (one `create_task(`, eight
  `spawn(` names). Inline literals only (C-13, no conftest).
- TDD: AC-4 red: `ImportError: cannot import name 'supervision' from 'app'` (pre-Step-1 tree: `main.py` checked out from `94a152c9~1`,
  `supervision.py` moved aside, then both restored to HEAD) → green: `6 passed`. Full suite
  1306 passed, coverage 88.67% (≥40); `ruff check .` / `ruff format --check .` clean; no `conftest` reference.
- Files modified: `services/xstockstrat-analysis/tests/test_supervision.py`
- Deviations: none

## Session 2026-10-28 — sdd-execute sequential, Step 3

### Step 3 — service: analysis `*_forever` loops run under supervision (FR-1) [done]
- `app/engine/fundsignal_loop.py`: `run_forever` = `retry_until_ok(self._seed_schedule, "fundsignal seed")` → unchanged
  jitter → `run_supervised(self._tick, "fundsignal")`; `_tick` untouched (no inner `try`).
- `app/handlers/servicer.py`: the opportunity-refresh, readiness-materializer and template-intent-sweep loops seed via
  `retry_until_ok(schedule.seed, "<loop> seed")` and tick via `run_supervised(functools.partial(self.<tick>, schedule),
  "<loop>")`. Early returns, jitter, anchors, `advance(...)` calls and `retry_seconds` reads unchanged.
- TDD (scratch test, deleted; Step 4 authors the durable ones): red: `5 failed` (`PostgresConnectionError: down/seed`
  escaped each loop) → green: `5 passed`. Verification: 4 `run_supervised` + 4 `retry_until_ok` call sites, no
  `while True` in `fundsignal_loop.py`, `ruff check .` / `ruff format --check .` clean. Full suite: 1304 passed,
  coverage 88.64%, with the two `@AC-7 @feature-156` jitter tests deselected.
- **Open until Step 4:** those two jitter tests (`_StopLoop(Exception)` raised from a patched `_tick`) now spin
  forever: the sentinel is swallowed by `run_supervised`. Step 4 item 1 (`_StopLoop(BaseException)`) fixes it. Do not
  run the full suite without that fix or deselecting them.
- Files modified: `services/xstockstrat-analysis/app/engine/fundsignal_loop.py`,
  `services/xstockstrat-analysis/app/handlers/servicer.py`
- Deviations: none (process note in the Deviation Log)


## Session 2026-10-29 — sdd-execute sequential (sdd-batch-execute), re-spec

- Branch setup: merged `origin/main-dev` into the feature branch (`-X ours`, merge commit `d63bac2b`).
- Status was already `in-progress` (flipped 2026-10-28); no status change.
- Up-front plan confirmed by operator standing authorization (operator chat 2026-10-28/29,
  session_01NpS3HShZK6pSnogA7CFo2f): "Start executing features 241-276" via batch-execute; unattended checkpoints
  (`report`), C-16 promotion auto-confirmed unless it changes an existing @AC rule, merge-train authorized, 255/275
  deferred; operator-only DB/prod steps: open PR, hold merge; blocker decisions 2026-10-29 recorded per feature.
- Re-spec (anchors only, no scope change):
  - Step 4: `fundsignal_loop.py` anchors +1 after Step 3 (`_tick` :129, `_advance_schedule(retry)` raise :156,
    `run_forever` :159); `:165` is now `run_supervised(self._tick, "fundsignal")`, so the RED notes for @AC-1/@AC-2
    now say to confirm red against a scratch revert of `:165` (not committed). Test-file anchors unchanged.
  - Step 6: `tests/test_config_watcher.py` tests span `:14-38` (import at `:11`).
  - Step 15: analysis `CLAUDE.md` § P&L pattern consumer spans `:143-177` (next `###` at `:179`);
    `config-startup.md:149` reads "on stream error".

## Session 2026-10-29 — sdd-execute sequential, Step 4

### Step 4 — test: loops survive schedule and cycle errors (@AC-1, @AC-2, @AC-3) [done]
- `tests/test_fundsignal_loop.py`: `_StopLoop` is now a `BaseException` (fixes the two `@AC-7 @feature-156` jitter
  tests that spun after Step 3). New `TestScheduler` tests: @AC-1 (`next_sleep_seconds` raises
  `PostgresConnectionError("down")` once → 30s backoff, tick re-runs, `run_once` awaited, ERROR logged) and @AC-2
  (`run_once` fails and the error-path `_advance_schedule` raises once → absorbed, `run_once` awaited ≥2, both errors
  logged at ERROR).
- `tests/test_loop_supervision.py` (new, @AC-3): parametrized over opportunity-refresh / readiness-materializer /
  template-intent-sweep. Two cases per loop: a schedule-read error (the tick re-runs after a 30s backoff), and a seed
  error retried via `retry_until_ok` (the 30s sleep is recorded before the jitter and the first tick). There is also a
  fundsignal seed-retry case. Both sentinels are `BaseException`, and the recorder stops on the tick's 3600s sleep.
  The fundsignal case reuses `_sched_loop` from `test_fundsignal_loop.py`. Only inline literals are used (C-13).
- TDD: red came from a scratch revert of both Step-3 source files to `fb89f90d~1`, not committed. That revert covers
  the `:165` revert the spec names, plus the `:161` seed wiring. Result: 9 failed (`PostgresConnectionError` escaped
  each loop). Green: all 10 pass.
- Verification: the targeted suites (fundsignal, loop_supervision, opportunity_refresh, readiness_materializer,
  durable_schedule, strategy_templates) give 116 passed. The full suite gives 1315 passed with coverage at 88.90%
  (≥40). `ruff check .` and `ruff format --check .` are clean, and the `_StopLoop(BaseException)` grep hits `:379`.
- Files modified: `services/xstockstrat-analysis/tests/test_fundsignal_loop.py`,
  `services/xstockstrat-analysis/tests/test_loop_supervision.py`
- Deviations: none

## Session 2026-10-29 — sdd-execute sequential, Step 5

### Step 5 — service: analysis ConfigWatcher reconnects after any exception; watch task retained (FR-3) [done]
- `app/config/watcher.py`: `__init__` keeps the task as `self._watch_task` (`name=f"config-watch-{namespace}"`) with
  `add_done_callback(self._on_watch_done)`. `_on_watch_done` returns on cancel and otherwise logs ERROR
  `config watch task %s exited unexpectedly: %r`. Its body is wrapped in `try/except Exception`, so it never raises.
  `_watch` now catches `Exception` (not only `AioRpcError`), logs `config stream error (%s): %s, reconnecting in 2s`
  with the type name, and keeps the single `while True`, the 2s sleep and `_build_watch_request()` per reconnect.
  `_snapshot` is not reset on error (zero-trap). One edit covers both analysis watchers (`main.py:42,48`).
- TDD: a scratch test written to Step 6's instructions (@AC-5 reconnect after `RuntimeError`; @AC-8 retained task plus
  ERROR log naming `config-watch-analysis`) failed RED against the pre-step file: 2 failed (`RuntimeError` escaped
  `_watch`; `AttributeError` because `_watch_task` was missing). It passed GREEN after the edit (2 passed) and was then
  deleted (F-08). Step 6 authors the durable tests.
- Verification: `grep "except grpc.aio.AioRpcError"` finds nothing. The `_watch_task` / `_on_watch_done` /
  `_build_watch_request()` grep hits `:56,59,61,81`. `ruff check .` and `ruff format --check .` are clean. The full
  suite gives 1315 passed with coverage at 88.79% (≥40).
- Files modified: `services/xstockstrat-analysis/app/config/watcher.py`
- Deviations: none

## Session 2026-10-29 — sdd-execute sequential, Step 6

### Step 6 — test: analysis watcher reconnect and exit log (@AC-5, @AC-8 analysis rows) [done]
- `tests/test_config_watcher.py`: added `test_watch_reconnects_after_non_grpc_exception` (@AC-5). It builds the watcher
  dial-free via `ConfigWatcher.__new__` with an inline `_FakeStub`: call 1 raises `RuntimeError("boom")`, call 2 yields
  `ConfigSnapshot(version="v2")` and then a `_Done(BaseException)`. `asyncio.sleep` is patched with `AsyncMock`. The test
  asserts two `WatchConfig` calls, `sleep` awaited once with 2, `_snapshot.version == "v2"`, and the `analysis-`
  client_id on both requests. Also added `test_watch_task_retained_and_exit_logged` (@AC-8). It patches
  `grpc.aio.secure_channel`, `mtls.channel_credentials`/`target_override`, `ConfigServiceStub` and a failing `_watch`,
  then asserts `_watch_task` is done and an ERROR record names `config-watch-analysis` and `boom`. The doubles are inline
  and single-consumer (C-13).
- TDD: red came from a scratch revert of `app/config/watcher.py` to `affc979e~1`, not committed. Result: 2 failed
  (`RuntimeError: boom` escaped `_watch`; `AttributeError` because `_watch_task` was missing). Green against the Step-5
  file: 9 passed.
- Verification: `uv run pytest tests/test_config_watcher.py -q` gives 9 passed. The full suite gives 1317 passed with
  coverage at 89.19% (≥40). `ruff check .` and `ruff format --check .` are clean.
- Files modified: `services/xstockstrat-analysis/tests/test_config_watcher.py`
- Deviations: none

## Session 2026-10-29 — sdd-execute sequential, Step 7

### Step 7 — service: indicators ConfigWatcher reconnects after any exception; watch task retained (FR-3) [done]
- `app/config/watcher.py`: same edit shape as Step 5 (D-20). `__init__` keeps the task as `self._watch_task`
  (`name=f"config-watch-{namespace}"`) with `add_done_callback(self._on_watch_done)`. `_on_watch_done` returns on cancel,
  otherwise logs ERROR `config watch task %s exited unexpectedly: %r`, and never raises. `_watch` catches `Exception`
  (`# noqa: BLE001`), logs `config stream error (%s): %s, reconnecting in 2s`, and keeps the inline request build, the
  single `while True`, the 2s sleep and the last good `_snapshot` (@AC-4 @feature-173).
- TDD: a scratch test written to Step 8's instructions (@AC-5 reconnect after `RuntimeError` with `indicators-`
  client_id; @AC-8 retained task plus ERROR log naming `config-watch-indicators`) failed RED against the pre-step file:
  2 failed (`RuntimeError` escaped `_watch`; `AttributeError` because `_watch_task` was missing). It passed GREEN after
  the edit (2 passed) and was then deleted (F-08). Step 8 authors the durable tests.
- Verification: `grep "except grpc.aio.AioRpcError"` finds nothing. The `_watch_task` / `_on_watch_done` grep hits
  `:56,59,61`. `ruff check .` and `ruff format --check .` are clean. The full suite gives 294 passed with coverage at
  85.61% (≥50).
- Files modified: `services/xstockstrat-indicators/app/config/watcher.py`
- Deviations: none

## Session 2026-10-29 — sdd-execute sequential, Step 8

### Step 8 — test: indicators watcher reconnect and exit log (@AC-5, @AC-8 indicators rows) [done]
- `tests/test_config_watcher.py`: added `test_watch_reconnects_after_non_grpc_exception` (@AC-5) and
  `test_watch_task_retained_and_exit_logged` (@AC-8), mirroring Step 6 with the `indicators` namespace and the
  `indicators-` client_id prefix. Inline single-consumer doubles (`_Done`, `_FakeStub`) (C-13). Existing getter tests
  untouched (feature 244 rebase).
- TDD: red came from a scratch revert of `app/config/watcher.py` to `430b726f~1`, not committed. Result: 2 failed
  (`RuntimeError: boom` escaped `_watch`; `AttributeError` because `_watch_task` was missing). Green against the Step-7
  file: 12 passed.
- Verification: `uv run pytest tests/test_config_watcher.py -q` gives 12 passed. The full suite gives 296 passed with
  coverage at 85.61% (≥50). `ruff check .` and `ruff format --check .` are clean.
- Files modified: `services/xstockstrat-indicators/tests/test_config_watcher.py`
- Deviations: none

## Session 2026-10-29 — sdd-execute sequential, Step 9

### Step 9 — service: ingest ConfigWatcher reconnects after any exception; watch task retained (FR-3) [done]
- `app/config/watcher.py`: same edit shape as Steps 5 and 7 (D-20). `__init__` keeps the task as `self._watch_task`
  (`name=f"config-watch-{namespace}"`) with `add_done_callback(self._on_watch_done)`. `_on_watch_done` returns on cancel,
  otherwise logs ERROR `config watch task %s exited unexpectedly: %r`, and never raises. `_watch` catches `Exception`
  (`# noqa: BLE001`), logs `config stream error (%s): %s, reconnecting in 2s`, and still reconnects through
  `self._build_watch_request()` with the single `while True`, the 2s sleep and the last good `_snapshot`.
- TDD: a scratch test written to Step 10's instructions (@AC-5 reconnect after `RuntimeError` with `ingest-`
  client_id; @AC-8 retained task plus ERROR log naming `config-watch-ingest`) failed RED against the pre-step file:
  2 failed (`RuntimeError` escaped `_watch`; `AttributeError` because `_watch_task` was missing). It passed GREEN after
  the edit (2 passed) and was then deleted (F-08). Step 10 authors the durable tests.
- Verification: `grep "except grpc.aio.AioRpcError"` finds nothing. The `_watch_task` / `_on_watch_done` /
  `_build_watch_request()` grep hits `:69,72,74,94`. `ruff check .` and `ruff format --check .` are clean. The full
  suite gives 328 passed with coverage at 81.25% (≥40).
- Note: a clean stream end (the `async for` finishing without an exception) still loops with no 2s delay, as before;
  the spec keeps the sleep inside the `except` (unchanged behaviour, not a deviation).
- Files modified: `services/xstockstrat-ingest/app/config/watcher.py`
- Deviations: none
