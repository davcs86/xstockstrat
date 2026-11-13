# Context Log: fix-notify-stream-contract

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect reports (clustered triage):
  - docs/reports/2026-10-19-notify-severities-type-runtime-mismatch-defect.md (SEV-3)
  - docs/reports/2026-10-19-notify-stream-ignores-backpressure-defect.md (SEV-3)
- Cluster rationale: both are defects in the same StreamAlerts fan-out path (`emitAlert` / `matchesSubscriber` in
  notifyServiceImpl.ts) and share one test surface.
- Severity: SEV-3 (highest of cluster)
- Routed to SDD path (Track C)
- Created: status.md, feature.md, product-spec.md, acceptance.feature (2 regression scenarios), context.md
- Affected services (from reports): xstockstrat-notify
- Root cause hypothesis: hand-typed numeric severities predating stringEnums; fan-out discards write()'s false return.
- Recommended design depth: quick → `/sdd-design fix-notify-stream-contract quick` (rationale: SEV-3, single service, no proto/migration,
  but a config change is possible — threshold key / max_subscribers enforcement — so not skip)
- Development branch: feature/fix-notify-stream-contract

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags; no Consumer Surface section); backpressure threshold key contract deferred; AC-2 threshold not concrete and Then allows two policies
- Overlap findings: WARN: xstockstrat-notify shared with 312, 323, 324
- Recommended design depth: full (overlap with 312/323/324 on notify)
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)

## Session 2026-11-11 (sdd-batch design gate (round 2))

- `/sdd-design fix-notify-stream-contract` full debate is at its approval gate after round 2 (gate policy: halt). design.md is not written and status.md is unchanged (spec-ready). The register is in `debate.md`.

## Open Threads

- **Approach.** Two steps, both inside `services/xstockstrat-notify`, with no proto, migration or config-key change. A pre-spec spike gates `/sdd-spec`:
  - **Pre-spec spike (D-7).** Run a scratch harness, not committed: a real `@grpc/grpc-js` 1.14.5 server and a paused raw `node:http2` client. It records:
    - (a) whether `call.writableLength` is a number;
    - (b) whether it is a live depth in messages (it returns to about 0 after the client resumes);
    - (c) whether `call.destroy(err)` sends close/RST within 1 s and releases the buffer;
    - (d) the order of the error and cancelled events;
    - (e) whether a status/trailer write queues behind the zero window.

    Pass is (a), (b) and (c) holding, and (e) not holding. If (a) or (b) fails, the spec uses fallback (b), a consecutive-false counter. If (c) fails or (e) holds, the work returns to design or the operator.
  - **Step 1, AC-1 (D-1).** `StreamSubscriber.severities` becomes `AlertSeverity[]` and the string compare stays (NOTIFY-1). It adds a positive AC-1 test, moves the numeric fixtures to string-enum form (C-13), and retires the severity records and the report's sidecar.
  - **Step 2, AC-2 (D-5, D-6).** The check `sub.call.writableLength >= MAX_QUEUED_ALERTS` (code constant 1024) runs before write. On eviction it does a map delete, then `recordStreamEviction('backpressure')`, then a warn log, then `try { call.destroy(...) }`. The evicting alert is neither written nor counted in `deliveredCount`. The error listener is guarded by the `Map.delete` result, and `StreamEvictionReason` gains `'backpressure'`. The step also amends the AC-2 Given, retires the backpressure records and flips the sidecars (D-8).
- **Strongest open objection.** O-1 and O-2, both blocking and narrowed to the spike. On real grpc-js 1.14.5 it is still unproven that `destroy(err)` resets a zero-window stream without a queued trailer, and that `writableLength` is a live message depth. No in-scope fallback teardown API exists. The private-internals close stays rejected (R-4) without operator sign-off.
- **Floor status.** No Floor breaches.
- **Uncovered @AC changes.** None of the following has an operator decision behind it:
  - @AC-2 (316) EXTEND, with the Given amended to the queued-write-length trigger;
  - @AC-32 (signal-map-instrumentation) EXTEND;
  - PRESERVEs of @AC-1 (316), @AC-4 (notify-external-fanout), @AC-5 (pwa-notifications) and @AC-1 (fix-push-untargeted-broadcast).
- **Resume.** The next `/sdd-batch` run resumes the debate from the state block below.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Two steps, both inside services/xstockstrat-notify. No proto, migration or config-key changes. A pre-spec spike gates /sdd-spec.\n\nPRE-SPEC SPIKE (closes O-1 and O-2; runs before /sdd-spec, not during execute).\n- Scratch harness: a real @grpc/grpc-js 1.14.5 server (the version from report :37) with a handler that mirrors emitAlert, plus a raw node:http2 client that calls pause(). Not committed. Results go in the feature's context.md. /sdd-spec does not start until they are there.\n- Record:\n  (a) typeof call.writableLength === 'number' on the handler's call;\n  (b) after the client resumes, writableLength drops back to about 0, which shows it is a live queue depth in messages and not a running count;\n  (c) after call.destroy(new Error('backpressure')), the client stream sees close/RST within 1 s, and the server-side buffer is released;\n  (d) the order of 'error' and 'cancelled' events the call emits after destroy;\n  (e) whether grpc-js's server-side 'error' handling queues a status/trailer write behind the zero window (the R-2 failure arriving by a side door).\n- Pass = (a), (b) and (c) hold, and (e) does not hold.\n- If (a) or (b) fails, use the fallback detector: a per-subscriber count of consecutive write()===false, reset on a true write.\n- If (c) fails or (e) holds, stop and return to design or the operator. Reaching the http2 stream through grpc-js internals stays rejected without operator sign-off.\n\nSTEP 1 — severity typing (AC-1). Unchanged from D-1.\n- Import AlertSeverity at notifyServiceImpl.ts:3, as at fanout.ts:6. Type StreamSubscriber.severities as AlertSeverity[] (:15).\n- Leave :132 and the string compare at :288 unchanged (NOTIFY-1).\n- Add a positive AC-1 test through streamAlerts and emitAlert: severities [WARNING, CRITICAL] receive a CRITICAL alert and do not receive an INFO alert.\n- C-13: change these numeric fixtures to string-enum form: makeAlert default (test.ts:116), :134, :633-634, :747.\n- Retire the severity records: notify CLAUDE.md:4 banner phrase, docs/context-constitution.md:31, docs/context-constitution-findings.md:24 and :60. Flip the severities report's .status sidecar.\n\nSTEP 2 — bounded queue with non-flushing eviction (AC-2, extends AC-32).\n- Add a module constant MAX_QUEUED_ALERTS = 1024 (unit: messages).\n- In the emitAlert loop (notifyServiceImpl.ts:84-95), inside the matchesSubscriber branch and before write, check `sub.call.writableLength >= MAX_QUEUED_ALERTS`. Drop the typeof guard: undefined >= 1024 is already false for the feature-294 mocks, and the spike confirms the field is a number.\n- On eviction, run these in order, synchronously, then continue:\n  1. this.subscribers.delete(subId)\n  2. recordStreamEviction('backpressure')\n  3. log.warn('StreamAlerts subscriber evicted', {reason:'backpressure'})\n  4. try { sub.call.destroy(new Error('backpressure')) } catch {}\n- The evicting alert is not written. deliveredCount counts only writes actually issued.\n- The write call and the write_error catch (:86-93) are unchanged.\n- Error listener at :148-151: `if (this.subscribers.delete(subId)) recordStreamEviction('stream_error');`.\n- The 'cancelled' listener (:144-146) is unchanged. backpressure is recorded before destroy, so it is counted exactly once whatever event order the spike finds.\n- Widen StreamEvictionReason (telemetry.ts:322) to 'write_error'|'stream_error'|'backpressure'. Update notify CLAUDE.md:115 in the same step.\n- C-15: in the same step, amend the AC-2 Given in 316 acceptance.feature to \"whose queued write length reaches the backpressure threshold\" so it matches the trigger.\n- Retire the backpressure records:\n  - services/xstockstrat-notify/docs/context-constitution.md:30 (the gotcha)\n  - docs/context-constitution-findings.md:34 (the open question) and :61 (the report-index row)\n  - flip the backpressure report's .status sidecar.\n- AC-2 test. Mock: write() returns false and increments writableLength; on() accepts any event; destroy is a spy; no drain.\n  - 1024 emits give 1024 writes and no eviction.\n  - Emit 1025 gives no write, deliveredCount 0, the subscriber removed, evictions{reason=backpressure}==1, destroy called once.\n  - Emit 1026: write total is still 1024.\n  - Negative test: writableLength stays at 0 while write returns false. No eviction.\n  - The AC-32 write_error test is unchanged.\n- design.md records:\n  - the F-07 rationale: the cap is a memory-safety bound with no operator tuning, so it is a code constant (fails.md:2699-2701). It does not cite CLAUDE.md:112.\n  - accepted residuals:\n    (i) alerts emitted between eviction and reconnect are lost from the live view. There is no ListAlerts catch-up (AlertStream.tsx:34-41), and reconnect does not page history.\n    (ii) the bound is 1024 × the largest alert, not about 1 MB, because req.context is free-form (:76).\n    (iii) detection is lazy: a stalled subscriber filtered to rare severities or categories keeps its queue and stream until the next alert that matches it.",
    "open_objections": [
      {
        "text": "O-1 (narrowed): before /sdd-spec, the pre-spec spike must show on real grpc-js 1.14.5 that call.destroy(err) on a zero-window server stream sends close/RST to the client within 1 s and releases the buffer, and that no status/trailer write queues behind the window. It must also record the error/cancelled event order. Results go in context.md.",
        "blocking": true
      },
      {
        "text": "O-2 (narrowed): the spike must confirm on the real call that writableLength is a number and is a live depth in messages (it returns to about 0 after the client resumes). If not, spec fallback (b), a consecutive-false counter reset on a true write.",
        "blocking": true
      },
      {
        "text": "Amend the AC-2 Given in 316 acceptance.feature to the queued-write-length trigger in the same step, so the C-16-promoted scenario states the real rule.",
        "blocking": false
      },
      {
        "text": "Step 2 must retire the backpressure records: notify docs/context-constitution.md:30, docs/context-constitution-findings.md:34 and :61. It must also flip both defect reports' .status sidecars.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1 (316 acceptance.feature, severity filter)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 (316 acceptance.feature, backpressure eviction; Given text amended to queued-write-length trigger)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-32 (signal-map-instrumentation.feature)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4 (notify-external-fanout.feature)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5 (pwa-notifications.feature)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-1 (fix-push-untargeted-broadcast.feature)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Running the destroy/writableLength verification as a gate inside Step 2 at execute time. The spec would commit to an unverified API, and with no grounded fallback the step can only stall mid-execute. It moves to a pre-spec spike.",
      "Closing the underlying Http2Stream through grpc-js private internals (NGHTTP2_CANCEL). It breaks on upgrade and violates F-04. Allowed only if the spike shows destroy sends no RST, and then only with operator sign-off.",
      "The grpc-js status-error teardown path. If the trailers queue behind the zero window it is functionally end(), which R-2 locks out. Valid only if the spike shows the status goes out-of-band.",
      "A `typeof writableLength === 'number'` guard. It is redundant (undefined >= N is false), adds code, and gives no signal on a field change.",
      "Fallback (b), a consecutive-false counter, as the primary detector. It maps only indirectly to queue depth and adds per-subscriber state. It is the runner-up only if the spike disqualifies writableLength."
    ],
    "open_risks": [
      "destroy(err) may free the JS queue but leave the h2 stream open without an RST. The client would then never reconnect. The spike catches this, and no in-scope fallback API exists.",
      "If a grpc-js upgrade drops or renames writableLength, eviction is silently disabled: the comparison fails open. The AC-2 test pins the behaviour only against the mock.",
      "The per-stream memory bound scales with alert size: 1024 × the largest free-form context.",
      "Detection is lazy: a filtered, stalled subscriber holds its queue until the next alert that matches it.",
      "Alerts are lost between eviction and reconnect (accepted residual).",
      "Merge-order conflicts with peer features 312, 323 and 324 on notifyServiceImpl.ts and telemetry.ts."
    ],
    "constitution_rules_touched": [
      "C-05",
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "F-04",
      "F-07",
      "P-03",
      "NOTIFY-1",
      "PLAT-N1"
    ],
    "rationale": "The adversary's one blocking objection carries. O-1's own wording requires verification before /sdd-spec, and the proposal admits there is no fallback API. An execute-time gate only moves the same escalation to a more expensive point. The verification therefore becomes a pre-spec spike with a stated pass condition and recorded results. O-1 and O-2 stay open and blocking, narrowed to that spike.\n\nThe proposal's O-2 evidence is accepted as strongly suggestive but not proven:\n- the highWaterMark-16 match;\n- 300,000 − about 63 messages of window = 299,937.\nWhether writableLength is a live depth or a running count is still to be measured.\n\nVerified this round in the worktree:\n- The backpressure records the adversary cited exist and stay open: notify context-constitution.md:30, findings.md:34 and :61. Retiring them joins Step 2.\n- No grpc-js source is on the host.\n- The eviction idiom at notifyServiceImpl.ts:86-93 and the unguarded error listener at :148-151 match the citations.\n\nOne adversary claim is corrected: event order cannot decide whether backpressure is counted. recordStreamEviction('backpressure') runs synchronously before destroy, and both listeners delete only after the map entry is gone. The spike still records the order to confirm stream_error is not double-counted.\n\nThe typeof guard is dropped as redundant code, but this does not remove the fail-open risk: undefined >= N fails open either way. That risk stays listed.\n\nClosed this round:\n- O-3: the inequality, the not-counted semantics and the exact assertions are pinned.\n- O-4: the cap's rationale now stands on its own without CLAUDE.md:112.\n- O-5: the residual section now includes the message-not-byte bound and lazy detection.\n\nThe approach honours D-1 to D-4. Narrowing D-2's \"destroy or status error\" to destroy-first, with the status path conditional on the spike, refines D-2 and does not contradict it. R-1, R-2 and R-3 are not touched.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Detection reads sub.call.writableLength (messages) before write, inside the matchesSubscriber branch, with `>= MAX_QUEUED_ALERTS` (code constant 1024) and no typeof guard. The evicting alert is neither written nor counted in deliveredCount. Fallback (b), a consecutive-false counter reset on a true write, applies only if the spike shows writableLength is not a live numeric depth.",
          "evidence": "report 2026-10-19-notify-stream-ignores-backpressure-defect.md:37 (write false from msg 16; 299,937 = 300,000 − ~63 window msgs); notifyServiceImpl.ts:84-95; test.ts:687-708"
        },
        {
          "text": "Eviction order: map delete, then recordStreamEviction('backpressure'), then log.warn, then try{call.destroy(new Error('backpressure'))}catch{}, all synchronous. The 'cancelled' listener is unchanged; the 'error' listener is guarded by the Map.delete result.",
          "evidence": "notifyServiceImpl.ts:90-92, :144-151; D-2, D-3"
        },
        {
          "text": "The F-04 verification of destroy/RST and writableLength runs as a pre-spec spike on real grpc-js 1.14.5 against a paused raw http2 client, with results in context.md before /sdd-spec. Pass condition: writableLength is a number and a live depth; the client sees close/RST within 1 s after destroy; the buffer is released; no trailer queues behind the window.",
          "evidence": "O-1 wording ('before /sdd-spec'); no grpc-js source on host (searched)"
        },
        {
          "text": "Step 2 retires the backpressure records (notify context-constitution.md:30, findings.md:34 and :61) and flips both reports' sidecars. It also amends the AC-2 Given to the queued-write-length trigger.",
          "evidence": "services/xstockstrat-notify/docs/context-constitution.md:30; context-constitution-findings.md:34,:61; C-15/C-16"
        }
      ],
      "new_rejected": [
        {
          "text": "Closing the h2 stream via grpc-js private internals (Http2Stream.close NGHTTP2_CANCEL)",
          "why": "Breaks on upgrade and violates F-04. Needs operator sign-off and is reachable only if the spike shows destroy sends no RST."
        },
        {
          "text": "Execute-time verification gate inside Step 2 in place of a pre-spec spike",
          "why": "The spec would commit to an unverified API with no fallback, and O-1 requires verification before /sdd-spec"
        }
      ],
      "new_objections": [
        {
          "text": "Amend the AC-2 Given in 316 acceptance.feature to the queued-write-length trigger in the same step",
          "blocking": false
        },
        {
          "text": "Retire the backpressure records (notify context-constitution.md:30, findings.md:34,:61) and flip both reports' .status sidecars",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-3",
          "how": "Pinned: check before write, `>=` 1024, evicting alert not written or counted, exact counts asserted (1024/1025/1026 plus a negative test); the AC-32 test is unchanged"
        },
        {
          "id": "O-4",
          "how": "Cap justified in design.md as a memory-safety bound with no operator tuning (fails.md:2699-2701), without citing CLAUDE.md:112"
        },
        {
          "id": "O-5",
          "how": "design.md residuals record the lost alerts until reconnect (no ListAlerts catch-up, no history paging), the 1024×max-alert-size bound, and lazy detection for filtered subscribers"
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-13 (sdd-batch design gate (round 3))

- `/sdd-design fix-notify-stream-contract` full debate is at its approval gate after round 3 (gate policy: halt). design.md is not written and status.md is unchanged (spec-ready). The register is in `debate.md` (D-9, D-10, R-6, R-7, O-8..O-11, P-1..P-4 added; O-2, O-6, O-7 closed).

## Open Threads

- **Approach.** Two steps, both inside `services/xstockstrat-notify`, with no proto, migration or config-key change. `/sdd-spec` is gated on the D-7 spike results in this file **and** an operator ruling on the round-3 reopen petitions (P-1..P-4).
  - **Source finding (round 3).** The installed `@grpc/grpc-js` 1.14.7 source (notify pins `^1.14.7`) shows `ServerWritableStreamImpl` is an objectMode Writable with no `_destroy` (server-call.js:108-164). So D-6's `call.destroy(err)` is predicted to free the JS queue but send no trailers and no RST. The client is left on a silent open stream and `useReconnectingStream.ts:46-63` never reconnects.
  - **Register-binding approach (stands until the operator rules).** Step 1 is D-1 unchanged (`AlertSeverity[]`, string compare kept, positive AC-1 test, string-enum fixtures, severity records retired). Step 2 is D-5 detection (`writableLength >= 1024` before write), then the D-6 order: map delete, `recordStreamEviction('backpressure')`, warn log, teardown in `try`. The `catch` logs a warn (D-10, C-18). The error listener is guarded by `Map.delete`, `StreamEvictionReason` gains `'backpressure'`, and the D-8 records are retired. The AC-2 test asserts `evictions{stream_error}==0` next to `backpressure==1`.
  - **Petition-contingent recommendation.** Replace the D-6 teardown with `call.emit('error', { code: 8 /*RESOURCE_EXHAUSTED*/ })`, grpc-js's own server-stream status path (server.js:106-107). The client drains the bounded queue, then gets a retryable non-OK status (streamBackoff.ts:18) and reconnects. This is preferred over the proposer's `end()`/OK, which reports a false normal finish and needs locked R-2 reopened.
  - **Spike (D-7 plus D-9).** Runs on 1.14.5 and the installed 1.14.7. It records D-7's (a)-(e), plus (e') whether destroy sends trailers or an RST, (f) whether emit-error keeps `writableLength` ≤ 1024 with no write after eviction, and (g) whether, after resume, the client gets the queued alerts then grpc-status 8, with counters backpressure=1 and stream_error=0.
- **Strongest open objection.** O-8 (blocking). The operator must rule on REOPEN D-2/D-6 (teardown), REOPEN R-2 (`call.end()`) and the D-7 version/pass-condition amendment before `/sdd-spec`. Under the register as written, recovered clients are stranded on a stream that never sends, which is worse than the defect. O-1 (the spike) also stays open and blocking. O-2 is closed on source evidence: objectMode means `writableLength` counts messages queued on the call.
- **Floor status.** No Floor breaches.
- **Uncovered @AC changes.** None of the following has an operator decision behind it:
  - @AC-2 (316) EXTEND. The Given is amended to the queued-write-length trigger; the client-visible close status depends on the teardown ruling.
  - @AC-32 (signal-map-instrumentation) EXTEND, with the new `'backpressure'` reason.
  - PRESERVEs of @AC-1 (316), @AC-4 (notify-external-fanout), @AC-5 (pwa-notifications: EmitAlert must not fail on a teardown error) and @AC-1 (fix-push-untargeted-broadcast).
- **New residual for design.md.** Under a status-path teardown, a peer that is paused but alive holds a bounded queue (1024 × largest alert + h2 window) after eviction, invisible to the subscribers gauge, until it cancels or the connection dies. notify sets no keepalive (src/index.ts:48).
- **Resume.** The next `/sdd-batch` run resumes the debate from the state block below.

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "Two steps, both inside services/xstockstrat-notify (src/grpc/notifyServiceImpl.ts, src/telemetry.ts, tests, docs). No proto, migration or config-key changes. /sdd-spec is gated on two things: the D-7 spike results in context.md, and an operator ruling on this round's REOPEN petitions.\n\nSOURCE FINDING (verified this round in the installed node_modules/.pnpm/@grpc+grpc-js@1.14.7/node_modules/@grpc/grpc-js/build/src/; notify pins ^1.14.7):\n- ServerWritableStreamImpl is an objectMode Writable (server-call.js:108-110) and has no _destroy override.\n- Its own 'error' listener sets pendingStatus = serverErrorToStatus(err) and then calls this.end() (:121-124).\n- _final runs sendStatus (:152-156).\n- Peer cancel goes to emit('cancelled') plus destroy() (server.js:1607-1608).\n- grpc-js ends a serverStream with a status via call.emit('error', status) (server.js:106-107).\nConsequence: D-6's call.destroy(err) is source-predicted to free the JS queue but send no trailers and no RST. The client is left on a stream that is open but never sends anything, and useReconnectingStream.ts:46-63 never reconnects.\n\nREGISTER-BINDING APPROACH (stands until the operator rules):\n- Step 1 (D-1, unchanged). Import AlertSeverity at notifyServiceImpl.ts:3, as at fanout.ts:6, and type StreamSubscriber.severities as AlertSeverity[] (currently notifyServiceImpl.ts:30). Keep matchesSubscriber's string compare (NOTIFY-1). Add the positive AC-1 test (filter [WARNING, CRITICAL]: a CRITICAL alert is delivered and an INFO alert is not). Convert the numeric fixtures to string-enum form (C-13). Retire the severity records and flip that report's sidecar.\n- Step 2, detection (D-5). Module constant MAX_QUEUED_ALERTS = 1024 (unit: messages). Inside the matchesSubscriber branch of the fan-out loop (currently notifyServiceImpl.ts:122-131), before write, check `sub.call.writableLength >= MAX_QUEUED_ALERTS`. The evicting alert is neither written nor counted in deliveredCount.\n- Step 2, eviction order (D-6): subscribers.delete(subId), then recordStreamEviction('backpressure'), then log.warn('StreamAlerts subscriber evicted', {reason:'backpressure'}), then the teardown call inside try/catch, then continue. The catch logs a warn instead of swallowing silently (C-18).\n- Step 2, teardown: per D-6 this is call.destroy(new Error('backpressure')). It is flagged below as source-predicted to fail.\n- Step 2, other parts. Guard the error listener (currently :177-180) as `if (this.subscribers.delete(subId)) recordStreamEviction('stream_error')`. Widen StreamEvictionReason (telemetry.ts:322) and update notify CLAUDE.md:115 in the same step (D-3). D-8 records: amend the AC-2 Given; retire context-constitution.md:30 and findings.md:34 and :61; flip both report sidecars.\n- AC-2 test. Mock: write returns false and increments writableLength; on() accepts any event; teardown spies. Emits 1-1024 give 1024 writes and no eviction. Emit 1025 gives no write and removes the subscriber, with evictions{backpressure}==1 AND evictions{stream_error}==0 and the teardown called once. Emit 1026 leaves the write total at 1024. Negative test: writableLength stays 0, so nothing is evicted. The AC-32 test is unchanged.\n\nPETITION-CONTINGENT RECOMMENDATION (needs operator ruling on REOPEN D-2/D-6; see petitions):\n- Replace the D-6 teardown with `sub.call.emit('error', { code: 8 /*RESOURCE_EXHAUSTED*/, details: 'slow consumer evicted' })`. This is grpc-js's own server-stream status path (server.js:106-107).\n- It reuses the bounded queue (D-5 caps it at 1024 + h2 window). The client gets the queued alerts, then a non-OK status.\n- RESOURCE_EXHAUSTED is retryable (streamBackoff.ts:18), so the UI reconnects (useReconnectingStream.ts:51-63).\n- It is preferred over the proposer's end()/OK. It does not report a false normal finish, and it stays within D-2's 'status error' option, so only D-2's 'without flushing' clause and D-6's teardown need amending.\n- Whether R-2 (call.end()) also needs reopening for it, given that the status path internally calls end(), is for the operator to rule.\n- notify's own 'error' listener fires synchronously on emit. The pinned order (map delete before the guarded listener) keeps stream_error at 0, and the test asserts it.\n\nSPIKE (D-7, unchanged and still pre-spec, with additive observations):\n- Run on grpc-js 1.14.5 per D-7, and also on the installed 1.14.7 that notify runs.\n- Record D-7's (a)-(e) as written.\n- Additionally record:\n  - (e') destroy(): whether the client sees trailers or an RST at all (expected: neither; this is the reopen evidence).\n  - (f) the emit-error variant with the client paused: call.writableLength stays ≤ 1024 and no write runs after eviction (deterministic). Heap is an observation only.\n  - (g) after the client resumes under (f): it receives the queued alerts, then grpc-status 8, then close; the counters read backpressure=1 and stream_error=0.\n\nRESIDUALS FOR design.md (additive to O-5's closed set):\n- Under a status-path teardown, a peer paused at stream level but alive at session level keeps its stream and a bounded queue (up to 1024 × largest alert + window) after eviction, invisible to the subscribers gauge.\n- It is held until the peer cancels or the connection dies. notify sets no keepalive (src/index.ts:48 bare new grpc.Server()), and keepalive would not free it anyway because the session still answers PINGs.\n- The total exposure is linear in stalled streams and limited by mTLS to authorised peers.",
    "open_objections": [
      {
        "text": "O-1 (still open): before /sdd-spec, the D-7 spike must run, with its results recorded in context.md. It now also records (e') destroy shows no RST/trailers, (f) emit-error keeps writableLength ≤1024 with no post-eviction write, and (g) after resume the client gets the queued alerts then grpc-status 8 with backpressure=1 and stream_error=0.",
        "blocking": true
      },
      {
        "text": "The operator must rule on REOPEN D-2/D-6 (teardown), REOPEN R-2 (call.end()) and the D-7 version and pass-condition amendment before /sdd-spec. Installed grpc-js 1.14.7 source shows D-6's destroy() cannot send trailers or an RST (server-call.js:108-164, no _destroy). Recovered clients would sit on a stream that never sends and never reconnect (useReconnectingStream.ts:46-63). The recommended replacement is emit('error', RESOURCE_EXHAUSTED) (server.js:106-107).",
        "blocking": true
      },
      {
        "text": "C-16 @AC-5 / D-3: the emit-error (or any erroring) teardown fires notify's own 'error' listener synchronously. The spec pins map delete before teardown. The AC-2 test asserts evictions{stream_error}==0 next to backpressure==1. The teardown stays inside try so EmitAlert can never fail.",
        "blocking": false
      },
      {
        "text": "design.md residuals must add the post-eviction case for a status-path teardown. A stream that is paused but still alive keeps its bounded queue (1024 × largest alert + h2 window) after the subscribers gauge has dropped it, until the peer cancels or the connection dies. There is no server keepalive (src/index.ts:48), and keepalive would not free it anyway. Exposure is linear in stalled streams and limited by mTLS.",
        "blocking": false
      },
      {
        "text": "C-18: the teardown try/catch must log a warning in the existing log.warn style instead of `catch {}`. No new instrument (D-3).",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1 (316 acceptance.feature, severity filter)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 (316 acceptance.feature, backpressure eviction; Given amended to queued-write-length trigger per D-8; client-visible close status pending the operator's teardown ruling)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-32 (signal-map-instrumentation.feature, eviction reasons gain 'backpressure')",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4 (notify-external-fanout.feature)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5 (pwa-notifications.feature, EmitAlert must not fail on a subscriber teardown error)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-1 (fix-push-untargeted-broadcast.feature)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "call.end() with an OK status as the teardown (proposer r3). It has the same bounded-memory and reconnect behaviour as emit-error RESOURCE_EXHAUSTED, but it reports a false normal finish on an endless push stream, and it needs locked R-2 reopened. It loses to the emit-error variant.",
      "Map delete only, with no teardown call. The client is never told, so it never reconnects. It has the same flaw as destroy().",
      "Server heap growth as a spike pass criterion. It is GC-noisy and nondeterministic. Use writableLength ≤ 1024 and no post-eviction write, and record heap as an observation only.",
      "Private h2 RST via grpc-js internals. This stays locked as R-4, and the new source reading gives no reason to reopen it."
    ],
    "open_risks": [
      "Under the register as it stands (D-6 destroy), the installed grpc-js source predicts recovered clients are stranded on a stream that never sends and are never reconnected, which is worse than the defect. Approval cannot proceed until the operator rules on the teardown.",
      "Under the status-path teardown (emit-error or end), a peer that is paused but alive holds a bounded queue (1024 × largest alert + window) after eviction, with no gauge visibility, until it cancels or the connection dies. notify has no keepalive (src/index.ts:48). The total is linear in stalled streams.",
      "If a grpc-js upgrade drops or renames writableLength, eviction silently fails open (undefined >= 1024 is false). The AC-2 test pins the behaviour only against the mock.",
      "The per-stream memory bound scales with alert size because req.context is free-form.",
      "Detection is lazy: a filtered, stalled subscriber keeps its queue until the next alert that matches it.",
      "Alerts are lost between eviction and reconnect (accepted residual, O-5).",
      "The report reproduced on 1.14.5, but notify runs 1.14.7. Spike results could differ between versions.",
      "Merge-order conflicts with peer features 312, 323 and 324 on notifyServiceImpl.ts and telemetry.ts."
    ],
    "constitution_rules_touched": [
      "C-05",
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "F-04",
      "F-07",
      "P-02",
      "P-03",
      "NOTIFY-1",
      "PLAT-N1"
    ],
    "rationale": "I verified the round's central claim directly. The grpc-js source is installed at node_modules/.pnpm/@grpc+grpc-js@1.14.7/.../build/src, so D-7's 'no grpc-js source on host' evidence is false.\n- server-call.js:108-164 is an objectMode Writable with no _destroy, its error listener runs pendingStatus plus end(), and _final calls sendStatus.\n- server.js:106-107 ends server streams with emit('error', status).\n- server.js:1607-1608 handles peer cancel.\n- The notify anchors in the current tree (src/grpc/notifyServiceImpl.ts:30, :122-131, :173-180) match.\n\nSo both sides agree that D-6's destroy() cannot reach the client, and that is new evidence. Changing D-2, D-6 or R-2 is still the operator's call, not the mediator's. Per the register rules, the approach keeps D-6 as the binding text. It flags D-6 as source-predicted to fail and makes the operator's ruling a blocking gate before /sdd-spec, alongside O-1.\n\nOf the two replacements, I recommend the adversary's emit('error', RESOURCE_EXHAUSTED) over the proposer's end()/OK. Both use the same internal path with the same bounded memory and drain-then-status delivery. emit-error does not report a false OK, it is retryable in the UI backoff (streamBackoff.ts:18), and it sits inside D-2's existing 'status error' option. It still calls end() internally, so whether R-2 needs reopening is the operator's ruling. Both petitions are logged with is_new=true.\n\nO-2 closes on source evidence. objectMode means writableLength counts messages queued on the call, and _write hands one chunk at a time to sendMessage (server-call.js:110,147-151). That answers messages vs bytes and call vs h2 stream, and D-5 already fixes the unit. The spike's (a)/(b) remain as confirmation under D-7.\n\nO-6 and O-7 close because settled D-8 commits Step 2 to both items.\n\nThe spike additions are additive observations, so they do not amend D-7's pass condition: destroy shows no RST, a deterministic writableLength bound, and the status code plus counters after resume. Running the spike on 1.14.7 as well as 1.14.5 is also additive. Changing D-7's pass condition itself is part of the petition.\n\nNew non-blocking objections:\n- Pin the stream_error==0 assertion (C-16 @AC-5).\n- Record the post-eviction held-queue residual. I confirmed notify has no keepalive (src/index.ts:48).\n- Log in the teardown catch (C-18).\n\nNo Floor breaches. No locked R-n is reintroduced. D-1, D-3, D-4, D-5, D-7 and D-8 are honoured.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "The D-7 spike adds these observations to its pass condition, which is unchanged. It runs on the installed grpc-js 1.14.7 as well as 1.14.5. It records: (e') whether destroy() sends trailers or an RST at all; (f) for the emit('error', RESOURCE_EXHAUSTED) variant with the client paused, writableLength stays ≤ 1024 and no write runs after eviction (heap is observation only); (g) after resume, the client gets the queued alerts, then grpc-status 8, with counters backpressure=1 and stream_error=0.",
          "evidence": "node_modules/.pnpm/@grpc+grpc-js@1.14.7/node_modules/@grpc/grpc-js/build/src/server-call.js:108-164; server.js:106-107; services/xstockstrat-notify/package.json ^1.14.7"
        },
        {
          "text": "The eviction teardown call stays inside try. Its catch logs a warning in the existing log.warn style, with no new instrument. The AC-2 test asserts evictions{stream_error}==0 next to backpressure==1.",
          "evidence": "notifyServiceImpl.ts:127-129 (log.warn idiom), :177-180 (error listener); C-18; D-3; @AC-5"
        }
      ],
      "new_rejected": [
        {
          "text": "Map delete only on eviction, with no teardown call",
          "why": "The client is never told, so it never reconnects (useReconnectingStream.ts:46-63). It has the same flaw as destroy()."
        },
        {
          "text": "Server heap growth as the spike's eviction pass criterion",
          "why": "GC-noisy and nondeterministic. writableLength ≤ 1024 with no post-eviction write is the deterministic check."
        }
      ],
      "new_objections": [
        {
          "text": "The operator must rule on REOPEN D-2/D-6, REOPEN R-2 and the D-7 amendment before /sdd-spec. Source shows destroy() sends no trailers or RST (server-call.js:108-164). The recommended replacement is emit('error', RESOURCE_EXHAUSTED) (server.js:106-107).",
          "blocking": true
        },
        {
          "text": "C-16 @AC-5 / D-3: the spec pins map delete before teardown. The AC-2 test asserts stream_error==0 next to backpressure==1. The teardown stays inside try.",
          "blocking": false
        },
        {
          "text": "design.md residuals add the post-eviction held bounded queue for a status-path teardown: invisible to the gauge, freed only on peer cancel or connection death, no keepalive (src/index.ts:48), linear in stalled streams, limited by mTLS.",
          "blocking": false
        },
        {
          "text": "C-18: the teardown catch logs a warning instead of an empty catch {}.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-2",
          "how": "Answered from installed grpc-js 1.14.7 source. ServerWritableStreamImpl is objectMode (server-call.js:110), and _write passes one chunk at a time to sendMessage (:147-151), so writableLength counts messages queued on the call, not bytes or the h2 stream. The spike's D-7 (a)/(b) remain as confirmation."
        },
        {
          "id": "O-6",
          "how": "Covered by settled D-8: Step 2 amends the AC-2 Given to the queued-write-length trigger in the same step."
        },
        {
          "id": "O-7",
          "how": "Covered by settled D-8: Step 2 retires notify context-constitution.md:30 and findings.md:34 and :61, and flips both report sidecars."
        }
      ],
      "reopen_petitions": [
        {
          "target": "R-2",
          "evidence": "The grpc-js 1.14.7 source is installed (node_modules/.pnpm/@grpc+grpc-js@1.14.7/.../server-call.js:108-164), contrary to D-7's 'no grpc-js source on host'. destroy() has no _destroy, so it never reaches the h2 stream. D-5's 1024 cap, settled after R-2 was locked, makes the memory end() holds bounded, not unbounded.",
          "is_new": true
        },
        {
          "target": "D-2",
          "evidence": "server-call.js:121-124,152-156 and server-interceptors.js:736-749: neither destroy nor the status-error path tears down a zero-window stream out-of-band, so D-2's 'without flushing' premise is false for both options. destroy strands recovered clients (useReconnectingStream.ts:46-63).",
          "is_new": true
        },
        {
          "target": "D-6",
          "evidence": "Same source as above. The step-4 teardown call.destroy(err) is predicted to send no trailers or RST. Proposed replacement: emit('error', {code:8}), grpc-js's own server-stream status path (server.js:106-107), or end() (proposer).",
          "is_new": true
        },
        {
          "target": "D-7",
          "evidence": "notify pins ^1.14.7 (package.json:21, pnpm-lock.yaml:1165), not the 1.14.5 the report used. D-7's pass condition (c) close/RST is predicted to fail by source, so it would need the teardown-matched condition (g) instead.",
          "is_new": true
        }
      ],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```
