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

## Session 2026-11-20 (sdd-batch design gate (round 4))

- `/sdd-design fix-notify-stream-contract` full debate is at its approval gate after round 4 (gate policy: halt). design.md is not written and status.md is unchanged (spec-ready). The register is in `debate.md` (D-11..D-14, R-8, R-9, O-12, P-5..P-8 added; O-9, O-11 closed).

## Open Threads

- **Approach.** Two steps, both inside `services/xstockstrat-notify`, with no proto, migration or config-key change. `/sdd-spec` stays gated on the pre-spec spike results in this file **and** a recorded operator ruling on P-1..P-4.
  - **Register status.** No reopen was applied this round. The steer to reopen D-2, D-6, R-2 and D-7 appeared only in the workflow's computed task text; no operator ruling is on record here or in `debate.md`. D-2, D-6, R-2 and D-7 stand as written. The proposer's four round-4 REOPENs repeat the P-1..P-4 evidence, so they are logged as P-5..P-8 and dropped as not new.
  - **Step 1 (D-1, not contingent).** Type `StreamSubscriber.severities` as `AlertSeverity[]`, keep the string compare (NOTIFY-1), add the positive AC-1 test, convert numeric fixtures to string-enum form, retire the severity records.
  - **Step 2, settled parts.** D-5 detection (`sub.call.writableLength >= MAX_QUEUED_ALERTS`, 1024 messages, before write; the evicting alert is neither written nor counted). D-6 order: map delete, `recordStreamEviction('backpressure')`, warn log, teardown inside `try` with a logging `catch` (D-10). The `'error'` listener is guarded by the `Map.delete` result; the spec states that a stream error arriving after the entry is gone is not counted as `stream_error` (D-14). `StreamEvictionReason` gains `'backpressure'` and notify `CLAUDE.md:115` is updated (D-3). D-8 records are retired and the AC-2 Given is amended.
  - **Step 2, teardown call (blocked).** The binding text is still D-6's `call.destroy(new Error('backpressure'))`. Source predicts it sends no trailers and no RST (grpc-js 1.14.7 server-call.js:108-164), so the client never reconnects. It cannot be approved as is.
  - **Contingent replacement (needs the P-1..P-3 verdict).** `sub.call.emit('error', { code: 8, details: 'slow consumer evicted' })`. grpc-js's own `'error'` listener sets the pending status and calls `end()` (server-call.js:121-124), and `_final` sends the status after the bounded queue flushes (:152-156). The client gets the queued alerts, then RESOURCE_EXHAUSTED, which is retryable (streamBackoff.ts:18). The code is the bare numeric 8 with no grpc import, matching the file's house style (D-13, R-9).
  - **AC-2 test.** Emits 1-1024 are written with no eviction; emit 1025 evicts (`backpressure==1`, `stream_error==0`, teardown called once); emit 1026 leaves the write total at 1024. The teardown spy captures that the subscriber is already absent from the map and invokes any registered `'error'` listener (D-12). A throwing-teardown variant shows EmitAlert still succeeds (@AC-5). The unit test cannot show that a status reaches the client; only the spike can.
  - **Spike.** Binding text is D-7 plus D-9, on grpc-js 1.14.5 and 1.14.7. D-11 adds one observation: right after the `emit('error')` teardown, record `call.writableEnded === true` and `call.writableErrored === null`. The 1.14.7-only run with pass (a)+(f)+(g) waits on P-4. If (g) fails, stop and return to the operator; both other options (R-2, R-4) are locked.
- **Strongest open objection.** O-8 (blocking). The operator ruling on P-1..P-4 is not on record. Until it is written here and in `debate.md`, D-6's `destroy()` is binding and is predicted to strand recovered clients on a stream that never sends, which is worse than the defect. O-1 (the spike has not run) is also open and blocking. O-10 and O-12 are open and non-blocking.
- **Floor status.** No Floor breaches.
- **Uncovered @AC changes.** None of the following has an operator decision behind it:
  - @AC-2 (316) EXTEND. The Given is amended to the queued-write-length trigger; the client-visible terminal status (RESOURCE_EXHAUSTED) depends on the teardown ruling.
  - @AC-32 (signal-map-instrumentation) EXTEND. Eviction reasons gain `'backpressure'`; `stream_error` is counted only when the listener removes the entry.
  - PRESERVEs of @AC-1 (316), @AC-4 (notify-external-fanout), @AC-5 (pwa-notifications: EmitAlert must not fail on a teardown error) and @AC-1 (fix-push-untargeted-broadcast).
- **Residual design.md must carry (O-10).** After a status-path eviction, a peer paused at stream level but alive at session level keeps up to 1024 × largest alert plus the h2 window, invisible to the subscribers gauge, until it resumes, cancels or the connection dies. notify sets no keepalive (src/index.ts:48).
- **Resume.** The next `/sdd-batch` run resumes the debate from the state block below.

```sdd-batch-design-state
{
  "round": 4,
  "synth": {
    "approach": "Two steps, both inside services/xstockstrat-notify. No proto, migration or config-key change. /sdd-spec stays gated on (1) the pre-spec spike results in context.md and (2) a recorded operator ruling on P-1..P-4.\n\nREGISTER STATUS (why the reopens are not applied this round)\n- The round's \"operator steer\" (reopen D-2, D-6, R-2, D-7) appears only in the workflow's computed task text. The relayed user request is \"Yes, resume all together\", which names no register ID.\n- The task itself states \"OPERATOR DECISIONS: none recorded\". context.md on origin/feature/fix-notify-stream-contract has no ruling; its last entry says the debate halted at the gate awaiting the operator on P-1..P-4.\n- Only the operator reopens. So D-2, D-6, R-2 and D-7 stand as written, `reopened` is empty, and O-8 stays open and blocking.\n- Both sides and the source agree on the technical direction. The contingent approach below is ready to adopt unchanged once the operator's verdict on P-1..P-4 is written into context.md and debate.md.\n\nSTEP 1: severity typing (D-1, unchanged, not contingent)\n- Import AlertSeverity from '@xstockstrat/proto/notify/v1/notify' as at src/fanout/fanout.ts:6. Type StreamSubscriber.severities as AlertSeverity[] (src/grpc/notifyServiceImpl.ts:31).\n- Keep the string-vs-string includes in matchesSubscriber (NOTIFY-1).\n- Add the positive AC-1 test: filter [WARNING, CRITICAL], a CRITICAL alert is delivered and an INFO alert is not. Convert the numeric fixtures to string-enum form (C-13).\n- Retire the severity records and flip that report's sidecar.\n\nSTEP 2: detection (D-5, unchanged, not contingent)\n- Module constant MAX_QUEUED_ALERTS = 1024 (unit: messages).\n- In the matchesSubscriber branch, before write (notifyServiceImpl.ts:125), check `sub.call.writableLength >= MAX_QUEUED_ALERTS`.\n- The evicting alert is neither written nor counted in deliveredCount.\n\nSTEP 2: eviction order (D-6 order, D-10)\n1. this.subscribers.delete(subId)\n2. recordStreamEviction('backpressure')\n3. log.warn('StreamAlerts subscriber evicted', { reason: 'backpressure' })\n4. the teardown call inside try; the catch logs a warning\n5. continue\n\nSTEP 2: teardown call\n- Binding text (D-6 as settled): call.destroy(new Error('backpressure')). Source-predicted to fail: ServerWritableStreamImpl has no _destroy (grpc-js 1.14.7 server-call.js:108-164), so the client gets no trailers and no RST and never reconnects (useReconnectingStream.ts:46-63). It cannot be approved as is.\n- Contingent replacement (needs the P-2/P-3 verdict, and P-1 for the internal end()): `sub.call.emit('error', { code: 8, details: 'slow consumer evicted' })`.\n  - grpc-js's own 'error' listener sets pendingStatus = serverErrorToStatus(err) and calls end() (server-call.js:121-124). serverErrorToStatus honours an integer code and string details (:25-41). _final runs sendStatus after the bounded queue flushes (:152-156).\n  - grpc-js fails a serverStream the same way (server.js:104-110).\n  - The client gets the queued alerts, then grpc-status 8 (RESOURCE_EXHAUSTED), which is retryable (streamBackoff.ts:18), so the UI reconnects.\n  - Status code literal: bare numeric 8, matching the file's house style (code: 3 / 5 / 13 at notifyServiceImpl.ts:55, :68, :274) and the recorded invariant at services/xstockstrat-notify/docs/context-constitution.md:48 (\"grpc.status is never imported\"). No new import. This replaces the proposal's `import * as grpc`.\n  - A bare call.end() with OK status stays rejected under R-2.\n\nSTEP 2: listeners, telemetry, records (D-3, D-8)\n- Guard the 'error' listener (notifyServiceImpl.ts:178-180) as `if (this.subscribers.delete(subId)) recordStreamEviction('stream_error')`. The 'cancelled' listener is unchanged.\n- The spec states the consequence: a stream error that arrives after the entry is already gone (cancel or eviction) is not counted as stream_error.\n- Widen StreamEvictionReason (src/telemetry.ts:322) with 'backpressure'; update notify CLAUDE.md:115 in the same step.\n- Amend the AC-2 Given to the queued-write-length trigger. Retire notify docs/context-constitution.md:30 and context-constitution-findings.md:34 and :61. Flip both report sidecars.\n\nAC-2 TEST\n- Mock call: write returns false and increments writableLength; on() records listeners; the teardown is a spy that also invokes any registered 'error' listener (models synchronous dispatch).\n- Emits 1-1024: 1024 writes, no eviction.\n- Emit 1025: no write, subscriber removed, evictions{backpressure}==1, evictions{stream_error}==0, teardown called once.\n- Inside the teardown spy, capture that the subscriber is already absent from the map, so a reordering regression fails.\n- Under the contingent teardown, also assert the emitted object has integer code 8 and string details.\n- Emit 1026: write total stays 1024.\n- Negative case: writableLength stays 0, nothing is evicted.\n- Throwing-teardown variant: EmitAlert still succeeds and the warning is logged (@AC-5).\n- The AC-32 write_error test is unchanged.\n- The unit test cannot show that a status reaches the client; that is the spike's job.\n\nSPIKE (pre-spec, results in context.md before /sdd-spec)\n- Binding text: D-7 as settled plus the D-9 observations, on grpc-js 1.14.5 and the installed 1.14.7, against a raw http2 client that calls pause().\n- Additive observation this round: right after the emit('error') teardown, record call.writableEnded === true and call.writableErrored === null. It is an early, deterministic read on whether _final will run.\n- Contingent amendment (needs the P-4 verdict): 1.14.7 only; pass = (a) writableLength is a live numeric message depth, (f) with the client paused writableLength stays <= 1024 and no write runs after eviction, (g) after resume the client gets the queued alerts, then grpc-status 8 trailers, then close, with backpressure=1 and stream_error=0. (e') is recorded; the old (c) is dropped.\n- If (g) fails: stop and return to the operator. No silent switch. Both remaining options, bare end()/OK (R-2) and private h2 internals (R-4), are locked.\n\nRESIDUALS design.md MUST CARRY (O-10; additive to O-5's set)\n- After a status-path eviction, a peer paused at stream level but alive at session level keeps up to 1024 x largest alert plus the h2 window, invisible to the subscribers gauge, until it resumes, cancels or the connection dies.\n- notify sets no keepalive (src/index.ts:48). Exposure is linear in stalled streams and limited by mTLS to authorised peers.",
    "open_objections": [
      {
        "text": "O-8 (still open): the operator ruling on P-1..P-4 (reopen D-2, D-6, R-2, D-7) is not on record. The steer exists only in the workflow's computed task text; context.md and the operator-decisions list hold no ruling. The orchestrator must get the operator's verdict and write it to context.md and debate.md before approval. Until then D-6's destroy() is binding and is source-predicted to strand clients (grpc-js 1.14.7 server-call.js:108-164).",
        "blocking": true
      },
      {
        "text": "O-1 (still open): the pre-spec spike has not run. The contingent teardown depends on a manually emitted 'error' not marking the Writable errored, so that end() reaches _final and sendStatus after the 1024-message queue drains. Results go in context.md before /sdd-spec.",
        "blocking": true
      },
      {
        "text": "O-10 (still open): design.md must carry the post-eviction held-queue residual verbatim (bounded queue invisible to the gauge, no keepalive at src/index.ts:48, linear in stalled streams, limited by mTLS). It closes when design.md is written.",
        "blocking": false
      },
      {
        "text": "C-16 @AC-32 / D-3: the spec must state that the guarded 'error' listener no longer counts a stream error arriving after the entry was already removed (cancel or eviction), and keep the notify CLAUDE.md:115 reason list accurate.",
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
        "ac_id": "@AC-2 (316 acceptance.feature, backpressure eviction; Given amended to queued-write-length trigger per D-8; client-visible terminal status RESOURCE_EXHAUSTED pending the operator's teardown ruling)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-32 (signal-map-instrumentation.feature, eviction reasons gain 'backpressure'; stream_error counted only when the listener removes the entry)",
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
      "Bare call.end() with OK status as the teardown. It flushes the same bounded queue but reports a false normal finish on an endless push stream, and an OK close is not retryable in every client. It stays locked as R-2.",
      "emit('error') plus a hard-kill timer that drops the connection if no finish or cancel arrives. It would free the held queue, but every hard-kill path goes through grpc-js private internals (R-4, locked).",
      "Importing grpc into notifyServiceImpl.ts for grpc.status.RESOURCE_EXHAUSTED. It contradicts the recorded house style (notify docs/context-constitution.md:48; bare codes at notifyServiceImpl.ts:55, :68, :274) and would need that row amended. Bare 8 needs no import.",
      "Dropping the 1.14.5 spike run and D-7's condition (c) without an operator ruling. That amends settled D-7, so it waits on P-4.",
      "Private h2 RST via grpc-js internals. Stays locked as R-4."
    ],
    "open_risks": [
      "The operator ruling on P-1..P-4 is not recorded. Under the register as written (D-6 destroy), recovered clients are stranded on a stream that never sends, which is worse than the defect. Approval cannot proceed without the ruling.",
      "Spike condition (g) may fail: a paused peer may never let the queue drain to _final, or Node's Writable may treat the manual 'error' emit as errored and skip _final. Then no status reaches the client, and the only alternatives (R-2, R-4) are locked.",
      "After a status-path eviction, a paused-but-alive peer holds up to 1024 x largest alert plus the h2 window with no gauge visibility. notify has no keepalive (src/index.ts:48).",
      "If a grpc-js upgrade drops or renames writableLength, eviction silently fails open (undefined >= 1024 is false). The AC-2 test pins behaviour only against the mock.",
      "The per-stream memory bound scales with alert size because req.context is free-form.",
      "Detection is lazy: a filtered, stalled subscriber keeps its queue until the next matching alert.",
      "Alerts are lost between eviction and reconnect (accepted residual, O-5).",
      "The AC-2 unit test cannot prove a status is sent, because the mock does not run grpc-js's own 'error' listener. Only the spike covers that.",
      "Merge-order conflicts with peer features on notifyServiceImpl.ts and telemetry.ts (fix-alert-event-targeting and others in this batch)."
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
    "rationale": "The technical dispute is over; the register dispute is not.\n\nTechnical. The adversary re-verified the proposal's citations against the installed grpc-js 1.14.7 source, and the notify line references match the current tree. emit('error', {code, details}) is grpc-js's own server-stream status path, and destroy() reaches neither trailers nor an RST. There is no Floor breach.\n\nRegister. The proposal treats D-2, D-6, R-2 and D-7 as reopened on an operator steer. I checked for a record of that steer and found none:\n- the task lists \"OPERATOR DECISIONS: none recorded\";\n- context.md on origin/feature/fix-notify-stream-contract ends at the round-3 halt, awaiting the operator on P-1..P-4;\n- the only user words relayed for this run are \"Yes, resume all together\", which do not name any register ID.\nThe steer text sits in the script-computed task, which cannot stand in for the operator. So I left `reopened` empty and kept O-8 open and blocking, as the adversary asked. If the operator did give this steer, recording it in context.md and debate.md is all that is needed; the contingent approach is already written to match it.\n\nThe proposer's four REOPENs cite the same evidence as P-1..P-4, so they are logged with is_new=false and merge into those petitions.\n\nChoices between the two sides:\n- Status code literal: I took the adversary's house-style option (bare 8, no grpc import). I confirmed notify docs/context-constitution.md:48 records \"grpc.status is never imported\" and that the file uses bare 3, 5 and 13. This avoids a new import and a record amendment.\n- Spike: the writableEnded/writableErrored read is additive, like D-9, so it is recorded as a decision without touching D-7.\n- Test: capturing map absence inside the teardown spy is teardown-agnostic, so it is recorded now.\n\nObjections closed: O-9 and O-11. D-10 already settles the try, the logging catch and the stream_error==0 assertion, D-6 fixes delete-before-teardown, and this round adds the in-spy order check. O-10 stays open until design.md exists. O-1 stays open until the spike runs.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "The pre-spec spike also records, right after the emit('error') teardown, call.writableEnded === true and call.writableErrored === null. This is an additive observation; D-7's pass condition is unchanged.",
          "evidence": "grpc-js 1.14.7 server-call.js:121-124 (listener only sets pendingStatus and calls end()), :152-156 (_final -> sendStatus)"
        },
        {
          "text": "The AC-2 test's teardown spy captures that the subscriber is already absent from the map when the teardown is called, and invokes any registered 'error' listener to model synchronous dispatch.",
          "evidence": "notifyServiceImpl.ts:128-130, :178-181; D-6 order; D-10; C-15"
        },
        {
          "text": "If the operator approves a status-path teardown, the emitted error is { code: 8, details: <string> } with the bare numeric code and no grpc import in notifyServiceImpl.ts; the AC-2 test asserts integer code and string details.",
          "evidence": "services/xstockstrat-notify/docs/context-constitution.md:48; notifyServiceImpl.ts:55, :68, :274; grpc-js 1.14.7 server-call.js:25-41"
        },
        {
          "text": "The spec states that the guarded 'error' listener does not count a stream error that arrives after the entry was already removed, and the notify CLAUDE.md:115 reason list is kept accurate.",
          "evidence": "D-3; notifyServiceImpl.ts:178-181; @AC-32"
        }
      ],
      "new_rejected": [
        {
          "text": "emit('error') teardown plus a hard-kill timer that drops the connection when no finish or cancel arrives",
          "why": "Every hard-kill path goes through grpc-js private internals, which R-4 locks."
        },
        {
          "text": "Importing grpc into notifyServiceImpl.ts to use grpc.status.RESOURCE_EXHAUSTED",
          "why": "Contradicts the recorded house style (notify docs/context-constitution.md:48) and adds an import and a record amendment; bare 8 matches the file."
        }
      ],
      "new_objections": [
        {
          "text": "C-16 @AC-32 / D-3: the spec must state that the guarded 'error' listener no longer counts a stream error arriving after the entry was already removed, and keep notify CLAUDE.md:115 accurate.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-9",
          "how": "Covered by settled D-6 (map delete before teardown) and D-10 (teardown inside try; AC-2 test asserts stream_error==0 next to backpressure==1), plus this round's in-spy check that the subscriber is already absent when the teardown is called."
        },
        {
          "id": "O-11",
          "how": "Covered by settled D-10: the teardown catch logs a warning in the existing log.warn style instead of an empty catch."
        }
      ],
      "reopen_petitions": [
        {
          "target": "D-2",
          "evidence": "Proposer r4: grpc-js 1.14.7 server-call.js:121-124, :152-156 show neither option tears down a zero-window stream out-of-band. Same evidence as P-2; merge into P-2.",
          "is_new": false
        },
        {
          "target": "D-6",
          "evidence": "Proposer r4: server-call.js:108-164 has no _destroy, so destroy() sends no trailers or RST; replace step 4 with emit('error', {code: 8, details}). Same evidence as P-3; merge into P-3.",
          "is_new": false
        },
        {
          "target": "R-2",
          "evidence": "Proposer r4: D-5's 1024 cap bounds what end() holds, and the status path calls end() internally (server-call.js:123). Proposed lock wording: bare end()/OK stays rejected; the internal end() via emit('error') is permitted. Same evidence as P-1; merge into P-1.",
          "is_new": false
        },
        {
          "target": "D-7",
          "evidence": "Proposer r4: notify pins ^1.14.7 (package.json:21); spike on 1.14.7 only with pass (a)+(f)+(g), (e') recorded, (c) dropped. Same evidence as P-4; merge into P-4.",
          "is_new": false
        }
      ],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-20 — D-7 spike results (grpc-js 1.14.7)

Pre-spec spike for O-1 (D-7 + D-9 + D-11). Scratch harness only (`.sdd-logs/spike-316/spike.cjs`, git-ignored, not committed). No register entry is changed here; `debate.md` and `status.md` are untouched.

**Environment**

- Node v24.22.1 (`/opt/node24/bin/node --expose-gc`), Linux, loopback, insecure credentials.
- `@grpc/grpc-js` 1.14.7 at `/home/user/xstockstrat/node_modules/.pnpm/@grpc+grpc-js@1.14.7/node_modules/@grpc/grpc-js` (its `package.json` says `"version": "1.14.7"`). It is the only grpc-js copy on the host.
- Pin: `origin/main-dev` has `^1.14.7` (`services/xstockstrat-notify/package.json:21`, `pnpm-lock.yaml:1165`). This feature branch's own copy still reads `^1.14.5` / lock `1.14.5` (it predates the bump).
- **Not exercised: grpc-js 1.14.5.** It is not installed and the spike may not install packages, so D-9's "1.14.5 as well" run did not happen.

**Method**

- A real grpc-js server with one server-streaming method (identity serializers) and a handler that mirrors `emitAlert`: check `call.writableLength >= 1024` before each `write` of a 1 KiB message; on eviction do map delete, count `backpressure`, then the teardown candidate. The `'error'` listener counts `stream_error` only when `Map.delete` returns true (D-3).
- Two stalled clients per candidate: a raw `node:http2` client with no `'data'` listener (wire view: trailers, `rstCode`, `localWindowSize`), and a real grpc-js client in a child process frozen with SIGSTOP (status as a grpc client sees it). An in-process grpc-js client with no `'data'` listener does not stall the server (it keeps reading and buffers), so it was not used.
- Per case: fill to the cap, evict, hold the stall 1.1 s, then the client resumes (attach `'data'` / SIGCONT) and is given 5 s to terminate. Server-side `_write` (= `sendMessage`) calls are counted; the server's `ServerHttp2Stream` is read for `rstCode` / `sentTrailers` / `writableLength` (observation only).
- A second variant never resumes: the stalled client cancels, then `global.gc()` + `WeakRef` show whether the call and its queued chunks are still reachable.
- Extra cases: `none` (map delete only, R-6) and `emit('error')` followed by one late `write()`.

**Results** (identical for both client kinds unless noted)

| Observation | (1) `call.destroy(err)` | (2) `call.emit('error', {code: 8, details})` | (3) `call.end()` | (3') `call.end(metadata)` |
|---|---|---|---|---|
| Client status while stalled (1.1 s) | none | none | none | none |
| Trailers / RST on the wire while stalled | neither (`h2.rstCode=0`, `sentTrailers=null`, h2 stream not destroyed) | neither; the status is queued behind the window | neither; queued | neither; queued |
| `writableLength` during the stall | 1024, held | 1024, held | 1024, held | 1024, held |
| Unit of `writableLength` | messages (object mode); includes the one in-flight message | same | same | same |
| Right after teardown | `destroyed=true`, `writableEnded=false`, `errored=Error: backpressure` | `writableEnded=true`, `errored=null`, `destroyed=false` | `writableEnded=true`, `errored=null`, `destroyed=false` | same as (3) |
| Handler writes after eviction | 0 | 0 | 0 | 0 |
| `sendMessage` calls during the stall, after eviction | 0 | 0 | 0 | 0 |
| `sendMessage` calls after resume | 0 (the 1023 queued alerts are dropped) | 1023 (the queue flushes) | 1023 | 1023 |
| Raw client after resume, in order | the 64 already-sent messages, then nothing: no trailers, no RST, no status. Still open at the 5 s timeout | 1087 messages (all), then trailers `grpc-status: 8`, `grpc-message: slow%20consumer%20evicted`, then END_STREAM (`rstCode=0`), within about 40 ms of the resume | 1087 messages, then `grpc-status: 0`, `grpc-message: OK` | 1087 messages, then `grpc-status: 0` plus trailer `x-evicted: backpressure` |
| grpc-js client after resume | no `status`, no `error`, no `end` (hangs; its message count was not reported because the child prints counts only on events) | 1087 messages, `error` code=8 details="slow consumer evicted", then `status` code=8, then `end` | 1087 messages, `status` code=0 details="OK", `end` (a clean end, no error) | 1087 messages, `status` code=0 with metadata `x-evicted` |
| Server events | `error`, `close` at eviction; `cancelled` only when the client later cancels | `error(8)` at eviction (synchronous); after the flush `finish`, `cancelled`, `close` | after the flush `finish`, `cancelled`, `close` | same as (3) |
| Counters | `backpressure=1`, `stream_error=0` | `backpressure=1`, `stream_error=0` | `backpressure=1`, `stream_error=0` | same |
| Memory held during the stall | 1024 queued messages, bounded by the cap; not released by `destroy()` | 1024 queued messages, bounded by the cap | same | same |
| Released on peer cancel (never-resume variant, after gc) | yes (call and chunks unreachable) | yes | yes | not run |

Other observations:

- **Detection (D-5).** `typeof call.writableLength === 'number'`. Depth by messages written: `1->1 16->15 64->13 100->49 200->137 600->537 1000->937`, and 1024 at the eviction (attempt 1088 = 63 messages inside the 65,535-byte window + 1024 on the call + the evicting one, which is not written). `write()` first returns false at message 17. After a resume the depth returns to 0. The http2 stream itself holds only the one in-flight frame (1029 bytes).
- **No status ever arrives (`destroy`, and `none`).** The recovered client hangs: the stream stays open with no trailers and no RST until the client itself cancels. With `none` it first receives all 1087 messages; with `destroy` it receives only the 64 sent before the stall and the other 1023 are lost silently.
- **Late write after `emit('error')`.** One `write()` after the teardown raises `ERR_STREAM_WRITE_AFTER_END`, Node destroys the stream (`destroyed=true`), the queue is dropped and **no status is ever sent**: the client ends up exactly like the `destroy` case. So D-6's map-delete-before-teardown order is load-bearing for a status-path teardown.
- **`'cancelled'` after a normal finish.** On the status path the server emits `finish`, then `cancelled`, then `close`. notify's `'cancelled'` listener will therefore log a disconnect for an evicted subscriber; its map delete is a no-op.
- **D-11.** `call.writableEnded === true` holds. `call.writableErrored` is `undefined`, not `null`, because Node has no such property (`'writableErrored' in new Writable()` is false). The real property is `call.errored`, which is `null` after `emit('error')`.
- Heap + external delta over the stall was between -0.9 and +0.4 MB per case (noise; observation only, R-7).

**Verdict per pass condition**

| Condition | Verdict |
|---|---|
| (a) `writableLength` is a number | holds |
| (b) it is a live depth in messages, back to about 0 after resume | holds |
| (c) `destroy(err)` sends close/RST within 1 s and releases the buffer | **fails**: no RST, no trailers, and the 1024-message queue stays held until the peer reads or cancels |
| (d) order of the error and cancelled events | recorded: `destroy` gives `error`, `close`, and `cancelled` only on a later peer cancel. `emit('error')` gives `error` synchronously, then `finish`, `cancelled`, `close` once the queue has flushed |
| (e) a status/trailer write queues behind the zero window | **holds** for `emit('error')` and both `end()` forms |
| (e') whether `destroy()` sends trailers or an RST at all | neither, ever (stalled or after resume) |
| (f) `emit('error')` with the client paused: `writableLength` ≤ 1024, no write after eviction | holds (1024 held, 0 handler writes, 0 `sendMessage` calls) |
| (g) after resume: queued alerts, then grpc-status 8, counters `backpressure=1`, `stream_error=0` | holds (1087 messages, then `grpc-status: 8` / "slow consumer evicted") |

- **D-7 as written (pass = (a), (b), (c) hold and (e) does not): FAIL.** (c) fails and (e) holds, so by D-7's own rule the teardown returns to the operator. This is the outcome P-1..P-4 predicted from source.
- **Teardown-matched condition from P-4 ((a) + (f) + (g), with (e') recorded): PASS for `emit('error', { code: 8, details })` on 1.14.7.** It does not apply until the operator rules on P-4.

**Conclusion.** Only `call.emit('error', { code: 8, details })` gives a recovered client the queued alerts followed by a retryable RESOURCE_EXHAUSTED; `destroy()` strands the client with no status, `end()` reports a clean OK, and no candidate frees the stalled stream's 1024-message queue before the peer reads or cancels.

Key output lines (verbatim from the run, lines elided within each case; `client=raw` is the http2 client, `client=grpc` the SIGSTOP child):

```text
NODE-BASELINE fresh Writable: writableErrored=undefined ('writableErrored' in w: false) errored=null
ENV node=v24.22.1 grpc-js=1.14.7 dir=/home/user/xstockstrat/node_modules/.pnpm/@grpc+grpc-js@1.14.7/node_modules/@grpc/grpc-js CAP=1024 MSG_BYTES=1024

=== teardown=destroy client=raw ===
  typeofWritableLength: number
  depthAtEviction: 1024
  h2BytesAtEviction: 1029
  rightAfterTeardown: writableEnded=false writableErrored=undefined errored=Error: backpressure destroyed=true writableLength=1024 writableFinished=false
  written: 1087
  firstFalseWriteAt: 17
  evictedAtAttempt: 1088
  depthSamples_written_to_writableLength: 1->1 16->15 64->13 100->49 200->137 600->537 1000->937
  postEvictionHandlerWrites: 0
  stall100ms: writableLength=1024 h2.writableLength(bytes)=1029 clientLocalWindow=0
  stall1100ms: writableLength=1024 h2.writableLength(bytes)=1029 h2.destroyed=false h2.rstCode=0 h2.sentTrailers=null
  sendMessageCallsDuringStallAfterEviction: 0
  serverEventsDuringStall: [error(backpressure)@30ms, close@30ms]
  resumeWaitMs: 5002
  afterResume: clientMsgs=64 status=NONE terminated=false server.writableLength=0 h2.rstCode=0 h2.sentTrailers=null
  clientEventsAfterResume: []
  sendMessageCallsAfterResume: 0
  countersFinal: {"backpressure":1,"stream_error":0,"write_error":0}

=== teardown=emit-error client=raw ===
  rightAfterTeardown: writableEnded=true writableErrored=undefined errored=null destroyed=false writableLength=1024 writableFinished=false
  stall1100ms: writableLength=1024 h2.writableLength(bytes)=1029 h2.destroyed=false h2.rstCode=0 h2.sentTrailers=null
  sendMessageCallsDuringStallAfterEviction: 0
  serverEventsDuringStall: [error(8)@29ms]
  resumeWaitMs: 41
  afterResume: clientMsgs=1087 status=grpc-status=8 grpc-message=slow%20consumer%20evicted terminated=true server.writableLength=0 h2.rstCode=0 h2.sentTrailers={"grpc-status":8,"grpc-message":"slow%20consumer%20evicted"}
  clientEventsAfterResume: [trailers:grpc-status=8 grpc-message=slow%20consumer%20evicted@1155ms(msgs=1087), end@1155ms(msgs=1087), close:rstCode=0@1155ms(msgs=1087)]
  serverEventsAfterResume: [finish@1153ms, cancelled@1153ms, close@1153ms]
  sendMessageCallsAfterResume: 1023
  countersFinal: {"backpressure":1,"stream_error":0,"write_error":0}

=== teardown=emit-error client=grpc ===
  afterResume: clientMsgs=1087 status=code=8 details="slow consumer evicted" md={} terminated=true server.writableLength=0 h2.rstCode=0 h2.sentTrailers={"grpc-status":8,"grpc-message":"slow%20consumer%20evicted"}
  clientEventsAfterResume: [error:code=8 details="slow consumer evicted"@child+1178ms(msgs=1087), status:code=8 details="slow consumer evicted" md={}@child+1179ms(msgs=1087), end@child+1179ms(msgs=1087)]

=== teardown=end client=raw ===
  afterResume: clientMsgs=1087 status=grpc-status=0 grpc-message=OK terminated=true server.writableLength=0 h2.rstCode=0 h2.sentTrailers={"grpc-status":0,"grpc-message":"OK"}

=== teardown=end+metadata client=grpc ===
  afterResume: clientMsgs=1087 status=code=0 details="OK" md={"x-evicted":"backpressure"} terminated=true server.writableLength=0 h2.rstCode=0 h2.sentTrailers={"grpc-status":0,"grpc-message":"OK","x-evicted":"backpressure"}

=== teardown=none(map-delete-only) client=raw ===
  afterResume: clientMsgs=1087 status=NONE terminated=false server.writableLength=0 h2.rstCode=0 h2.sentTrailers=null

=== teardown=emit-error+late-write client=raw ===
  rightAfterTeardown: writableEnded=true writableErrored=undefined errored=Error [ERR_STREAM_WRITE_AFTER_END]: write after end destroyed=true writableLength=1024 writableFinished=false
  afterResume: clientMsgs=64 status=NONE terminated=false server.writableLength=0 h2.rstCode=0 h2.sentTrailers=null

=== stalled-then-peer-cancel (never resumes) teardown=destroy written=1087 ===
  whileStalledAfterTeardown+gc: callReachable=true lastQueuedChunkReachable=true writableLength=1024 destroyed=true
  afterPeerCancel+gc: callReachable=false lastQueuedChunkReachable=false writableLength=n/a destroyed=n/a serverEvents=[error, close, cancelled]

=== stalled-then-peer-cancel (never resumes) teardown=emit-error written=1087 ===
  whileStalledAfterTeardown+gc: callReachable=true lastQueuedChunkReachable=true writableLength=1024 destroyed=false
  afterPeerCancel+gc: callReachable=false lastQueuedChunkReachable=false writableLength=n/a destroyed=n/a serverEvents=[error, cancelled, close]
```

## Session 2026-11-20 (sdd-batch design gate (round 5))

- `/sdd-design fix-notify-stream-contract` full debate is at its approval gate after round 5 (gate policy: halt). design.md is not written and status.md is unchanged (spec-ready). The register is in `debate.md` (D-15..D-21, R-10..R-12, O-13, O-14 added; O-1, O-8, O-12 closed; D-2, D-6, D-7, R-2 marked reopened).

## Open Threads

- **Approach.** Two code steps plus one precondition, all inside `services/xstockstrat-notify`. No proto, migration or config-key change.
  - **Step 0, branch sync (D-19).** This branch still has `@grpc/grpc-js` `^1.14.5` (lock 1.14.5); `origin/main-dev` has `^1.14.7` (lock 1.14.7). Step 2 does not start until the branch is synced with main-dev, `services/xstockstrat-notify/package.json` reads `^1.14.7`, and the `services/xstockstrat-notify` importer block in the root `pnpm-lock.yaml` shows `@grpc/grpc-js` version 1.14.7. The spike ran on 1.14.7 only.
  - **Step 1 (D-1, unchanged).** Type `StreamSubscriber.severities` as `AlertSeverity[]`, keep the string compare (NOTIFY-1), add the positive AC-1 test, convert numeric fixtures to string-enum form (C-13), retire the severity records and flip that report's sidecar.
  - **Step 2, detection (D-5, unchanged).** `sub.call.writableLength >= MAX_QUEUED_ALERTS` (1024 messages) before the write, inside the `matchesSubscriber` branch. The evicting alert is neither written nor counted.
  - **Step 2, eviction (D-15).** All synchronous: map delete, `recordStreamEviction('backpressure')`, warn log, then `try { sub.call.emit('error', { code: 8, details: 'slow consumer evicted' }) } catch { log.warn(...) }`. Bare numeric 8, no grpc import (D-13, R-9). The stream ends with status 8 after flushing at most the capped queue. Delete-before-emit is load-bearing: the spike showed one write after the emit raises `ERR_STREAM_WRITE_AFTER_END` and no status is ever sent. `call.destroy()` and bare `call.end()` are rejected (R-10, R-11).
  - **Step 2, listeners.** Both `'error'` and `'cancelled'` act only when `Map.delete` returns true (D-14, D-16). Our own emit therefore counts no `stream_error`, and an evicted subscriber is not logged as a disconnect.
  - **Step 2, telemetry, docs, records.** `StreamEvictionReason` gains `'backpressure'` with no new instrument; the reason list in notify `CLAUDE.md` § Observability is updated in the same step. The AC-2 Given is amended to the queued-write-length trigger; the backpressure records are retired and both report sidecars flipped (D-8). A NOTIFY-* invariant is added to `services/xstockstrat-notify/docs/context-constitution.md`: the status path relies on grpc-js's own server-stream `'error'` listener, was verified on 1.14.7 only, and a grpc-js bump must re-run the spike (D-20).
  - **AC-2 test.** Emits 1-1024 are written with no eviction. Emit 1025 writes nothing, removes the entry, gives `backpressure==1` and `stream_error==0`, and calls `emit` once with `'error'`, integer code 8 and string details; the spy captures that the subscriber is already absent from the map. Emit 1026 leaves the write total at 1024. Invoking the recorded `'cancelled'` listener after eviction changes nothing and logs no disconnect (D-21). A throwing `emit` still lets EmitAlert succeed (@AC-5). The AC-32 `write_error` test is unchanged.
  - **Spike (D-17).** The pass condition is (a) + (f) + (g) on grpc-js 1.14.7, with (e') recorded and (c) dropped. It is met (spike session above). The post-teardown observation is `call.writableEnded === true` and `call.errored === null`; `writableErrored` does not exist in Node (D-18).
- **Strongest open objection.** O-13 (non-blocking, with a revert clause). The operator ruling behind this round's reopens (P-1..P-4 "user reopened", the `emit('error')` teardown, the teardown-matched D-7 condition, the spike corrections) reached this session only through the workflow's computed task text. It is not written in this file, and P-1..P-4 still read "pending user" in `debate.md`. The orchestrator must record the ruling here with its timestamp and flip P-1..P-4. If it cannot trace the ruling to the operator, the reopens of D-2, D-6, D-7 and R-2 revert and O-8 reopens as blocking.
  - **O-14 (non-blocking).** The AC-2 mock re-implements grpc-js's listener chain, so no automated check catches a grpc-js upgrade that breaks the status path. Either commit the spike's `emit('error')` case as a real-grpc-js test in notify's `node --test`, or record its absence as a waived residual. The next proposer or the operator must choose.
  - **O-10 (non-blocking).** Closes when design.md is written with the residual below.
- **Floor status.** No Floor breaches.
- **Uncovered @AC changes.** Two EXTENDs have no explicit operator decision behind them:
  - @AC-2 (316) EXTEND. The Given is amended to the queued-write-length trigger (D-8).
  - @AC-32 (signal-map-instrumentation) EXTEND. Eviction reasons gain `'backpressure'`; `stream_error` is counted only when the listener removes the entry.
  - Covered by the operator decision (subject to O-13): @AC-2 (316) EXTEND, the client-visible terminal status RESOURCE_EXHAUSTED after the capped queue flushes.
  - PRESERVEs: @AC-1 (316), @AC-4 (notify-external-fanout), @AC-5 (pwa-notifications), @AC-1 (fix-push-untargeted-broadcast).
- **Residuals design.md must carry (O-10, additive to O-5's set).** After eviction the stalled stream keeps up to 1024 × the largest alert plus the h2 window until the peer reads or cancels. It is invisible to the subscribers gauge, and with the guarded `'cancelled'` listener nothing logs when the queue is finally freed. No instrument is added (C-18). notify sets no keepalive (`src/index.ts:48`); exposure is linear in stalled streams and limited by mTLS to authorised peers.
- **Resume.** The next `/sdd-batch` run resumes the debate from the state block below.

```sdd-batch-design-state
{
  "round": 5,
  "synth": {
    "approach": "Two code steps plus one precondition, all inside services/xstockstrat-notify. No proto, migration or config-key change. The operator-reopened D-2, D-6, R-2 and D-7 are resettled below.\n\nRECORD CHECK (done this round)\n- Spike record: confirmed. context.md on origin/feature/fix-notify-stream-contract has \"Session 2026-11-20 — D-7 spike results (grpc-js 1.14.7)\" at :581-708, added by commit 311de686 (the branch tip).\n- Operator ruling: present only in this round's OPERATOR DECISIONS list. It is not yet in context.md or debate.md on the branch; debate.md still shows P-1..P-4 as \"pending user\". The orchestrator must write it at the gate (see open objections).\n- Version pins: confirmed. The feature branch has `^1.14.5` with lock 1.14.5; origin/main-dev has `^1.14.7` with lock 1.14.7 (services/xstockstrat-notify/package.json:21).\n\nSTEP 0: BRANCH SYNC precondition\n- Sync feature/fix-notify-stream-contract with main-dev before Step 2 starts.\n- Pass condition: services/xstockstrat-notify/package.json:21 reads `^1.14.7`, and the `services/xstockstrat-notify` importer block in the root pnpm-lock.yaml shows `'@grpc/grpc-js'` with `version: 1.14.7`.\n- If either check fails, /sdd-execute does not start Step 2.\n\nSTEP 1: severity typing (D-1, unchanged)\n- Import AlertSeverity as at src/fanout/fanout.ts:6.\n- Type StreamSubscriber.severities as AlertSeverity[] (src/grpc/notifyServiceImpl.ts:31, currently number[]).\n- Keep the string-vs-string includes at :392 (NOTIFY-1).\n- Add the positive AC-1 test: filter [WARNING, CRITICAL]; CRITICAL is delivered, INFO is not.\n- Convert the numeric fixtures to string-enum form (C-13).\n- Retire the severity records and flip that report's sidecar.\n\nSTEP 2: detection (D-5, unchanged)\n- Module constant MAX_QUEUED_ALERTS = 1024 (messages).\n- Inside the matchesSubscriber branch, before the write at notifyServiceImpl.ts:125, check `sub.call.writableLength >= MAX_QUEUED_ALERTS`.\n- The evicting alert is neither written nor counted in deliveredCount.\n\nSTEP 2: eviction, all synchronous (reuses the idiom at :127-130)\n1. this.subscribers.delete(subId)\n2. recordStreamEviction('backpressure')\n3. log.warn('StreamAlerts subscriber evicted', { reason: 'backpressure' })\n4. try { sub.call.emit('error', { code: 8, details: 'slow consumer evicted' }) } catch { log.warn(...) }\n5. continue\n- Bare numeric 8, no grpc import (D-13, R-9).\n- Delete-before-emit is load-bearing. The spike showed one write after the emit raises ERR_STREAM_WRITE_AFTER_END and no status is ever sent (context.md:623).\n- Never call.destroy() and never bare call.end().\n\nSTEP 2: listeners\n- 'error' (:178-181) becomes `if (this.subscribers.delete(subId)) recordStreamEviction('stream_error')`. Our own emit therefore counts nothing (D-3, D-14).\n- 'cancelled' (:174-177) becomes `if (this.subscribers.delete(subId)) log.info('StreamAlerts subscriber disconnected', ...)`. On the status path the server emits finish, cancelled, close (context.md:624), so an evicted subscriber must not be logged as a disconnect.\n\nSTEP 2: telemetry, docs, records\n- Widen StreamEvictionReason (src/telemetry.ts:380) with 'backpressure'. No new instrument.\n- Update the `reason` list in notify CLAUDE.md § Observability in the same step (currently `write_error|stream_error`; the register's :115 has drifted, re-grep).\n- Amend the AC-2 Given to the queued-write-length trigger. Retire the backpressure records and flip both report sidecars (D-8).\n- Add a NOTIFY-* invariant to services/xstockstrat-notify/docs/context-constitution.md: the status-path teardown relies on grpc-js's own server-stream 'error' listener (pendingStatus, end(), then _final and sendStatus; 1.14.7 server-call.js:121-124, :152-156), it was verified on 1.14.7 only, and a grpc-js bump must re-run the spike.\n\nAC-2 TEST (mock shape from notifyServiceImpl.test.ts:687-708; D-12)\n- Mock: on() records listeners. emit() is a spy that records its argument, captures that the subscriber is already absent from the map, then dispatches to the recorded listeners. write returns false and increments writableLength.\n- Emits 1-1024: 1024 writes, no eviction.\n- Emit 1025: no write; entry gone; evictions{backpressure}==1; evictions{stream_error}==0; emit called once with 'error', integer code 8 and string details.\n- Emit 1026: write total stays 1024.\n- Invoking the recorded 'cancelled' listener after eviction changes nothing and logs no disconnect.\n- Negative: writableLength stays 0, nothing is evicted.\n- Throwing emit: EmitAlert still succeeds and the warning is logged (@AC-5).\n- The AC-32 write_error test is unchanged.\n\nSPIKE (D-7 as resettled)\n- Pass condition is (a) + (f) + (g) on grpc-js 1.14.7, with (e') recorded and (c) dropped. All three are met (context.md:630-642).\n- grpc-js 1.14.5 was not exercised (context.md:590); Step 0 is the mitigation.\n- The spike's post-teardown observation is `call.writableEnded === true` and `call.errored === null`. `writableErrored` does not exist in Node.\n\nRESIDUALS design.md MUST CARRY (O-10, additive to O-5's set)\n- After eviction the stalled stream keeps up to 1024 x the largest alert plus the h2 window. Nothing frees it until the peer reads or cancels (spike-confirmed for every teardown).\n- It is invisible to the subscribers gauge. With the guarded 'cancelled' listener, nothing logs when an evicted stream's queue is finally freed. No instrument is added (C-18).\n- notify sets no keepalive (src/index.ts:48). Exposure is linear in stalled streams and limited by mTLS to authorised peers.",
    "open_objections": [
      {
        "text": "Register recording: the operator ruling (P-1..P-4 'user reopened', the emit('error') teardown, the teardown-matched D-7 condition, and the spike corrections) is in this round's operator-decisions list but not in context.md or debate.md on origin/feature/fix-notify-stream-contract, where P-1..P-4 still read 'pending user'. At the gate the orchestrator writes the ruling into context.md with its timestamp, flips P-1..P-4 to 'user reopened', and marks D-2, D-6, D-7 and R-2 'reopened @ round 5 (user, context.md <ISO>)'. If the orchestrator cannot trace the ruling to the operator, the reopens revert and O-8 reopens as blocking.",
        "blocking": false
      },
      {
        "text": "C-15 (adversary r5, unanswered): the AC-2 mock re-implements grpc-js's listener chain, so no automated check catches a grpc-js upgrade that breaks the status path. Either commit the spike's emit('error') case as a real-grpc-js test in notify's node --test (in-process server, paused raw http2 client, assertions (f) and (g)), or record its absence as a waived residual next to O-10. The next proposer or the operator must choose.",
        "blocking": false
      },
      {
        "text": "O-10 (still open): design.md must carry the post-eviction held-queue residual, now including the note that nothing logs or gauges when an evicted stream's queue is freed. It closes when design.md is written.",
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
        "ac_id": "@AC-2 (316 acceptance.feature, backpressure eviction: client-visible terminal status RESOURCE_EXHAUSTED after the capped queue flushes, via emit('error'))",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-2 (316 acceptance.feature: Given amended to the queued-write-length trigger per D-8)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-32 (signal-map-instrumentation.feature: eviction reasons gain 'backpressure'; stream_error counted only when the listener removes the entry)",
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
      "call.destroy(err) as the teardown. On grpc-js 1.14.7 it sends no trailers and no RST, the recovered client hangs with no status, and the 1023 queued alerts are dropped (context.md:612-613, :634).",
      "Bare call.end(), with or without trailing metadata, as the teardown. It flushes the same queue but reports grpc-status 0 OK, a false clean finish on an endless push stream (context.md:612-613). The internal end() reached through emit('error') is permitted.",
      "Exact pin of @grpc/grpc-js 1.14.7 for notify. It diverges from the platform-wide ^1.14.7 and blocks security patches; the lockfile check in Step 0 plus the NOTIFY invariant cover the risk.",
      "A new instrument or log for the moment an evicted stream's queue is freed. Not needed for the fix (C-18); the gap is recorded as a residual.",
      "Private h2 RST via grpc-js internals, and an emit('error') plus hard-kill timer. Both stay locked (R-4, R-8).",
      "Importing grpc for grpc.status.RESOURCE_EXHAUSTED. Stays locked (R-9); bare 8 is used."
    ],
    "open_risks": [
      "The feature branch still pins @grpc/grpc-js ^1.14.5 with lock 1.14.5, and the spike could not exercise 1.14.5. The fix must not land before the Step 0 branch sync puts notify on 1.14.7.",
      "The operator ruling is not yet written to context.md or debate.md on the branch. Until the orchestrator records it, the register still shows P-1..P-4 as pending.",
      "The status path depends on grpc-js's own 'error' listener behaviour, verified on 1.14.7 only. A later grpc-js that changes it would strand recovered clients as destroy() does, and the AC-2 unit mock cannot catch that. Guards are the Step 0 lock check and the NOTIFY invariant; an automated real-grpc-js test is still an open objection.",
      "The caret range ^1.14.7 lets a later lockfile refresh float to a newer 1.x without re-running the spike.",
      "After eviction a paused-but-alive peer holds up to 1024 x the largest alert plus the h2 window with no gauge or log visibility. notify has no keepalive (src/index.ts:48).",
      "If a grpc-js upgrade drops or renames writableLength, eviction silently fails open (undefined >= 1024 is false).",
      "The per-stream memory bound scales with alert size because req.context is free-form.",
      "Detection is lazy: a filtered, stalled subscriber keeps its queue until the next matching alert.",
      "Alerts emitted between eviction and reconnect are lost (accepted residual, O-5).",
      "Line references have drifted from recon (telemetry.ts:322 is now :380; :288 is now :392; CLAUDE.md:115). The spec must re-grep.",
      "Merge-order conflicts with peer features on notifyServiceImpl.ts and telemetry.ts."
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
    "rationale": "The adversary's verdict is SOUND with no Floor breach, and I found nothing that contradicts it.\n\nWhat I checked myself\n- The spike record exists on origin/feature/fix-notify-stream-contract (context.md:581-708, commit 311de686). It supports every claim the proposal takes from it: destroy() sends nothing and drops 1023 alerts, emit('error', code 8) delivers 1087 messages then grpc-status 8 with backpressure=1 and stream_error=0, end() reports OK, and a late write after the emit kills the status.\n- The version split is real: the branch has ^1.14.5 / lock 1.14.5, main-dev has ^1.14.7 / lock 1.14.7.\n- The notify line references match the current tree (:31, :125, :174-181, :392; telemetry.ts:380, :397).\n\nRegister\n- Last round I left the reopens unapplied because the operator-decisions list was empty. This round it carries the ruling and the steer names D-2, D-6, R-2 and D-7, so I applied them and closed O-8.\n- The ruling text is not yet in context.md or debate.md on the branch. I recorded that as an open, non-blocking recording item with a revert clause, because the orchestrator writes those files at the gate and is the one that can trace the ruling to the operator.\n- O-1 is closed on the spike record. O-12 is closed: D-14 already settles the 'error' listener statement, and this round adds the 'cancelled' guard and the CLAUDE.md reason-list update.\n- D-11's wording is corrected (call.errored, not writableErrored). No petition covers D-11, but the operator's binding corrections state this explicitly, so it is recorded as a correction under that clause.\n- D-9's 1.14.5 run did not happen. The operator's ruling accepts this and requires the branch on 1.14.7, which Step 0 enforces.\n- No new petitions this round.\n\nChoices between the two sides\n- Step 0 check: I took the adversary's exact wording (the notify importer block in the root pnpm-lock.yaml), because the proposal's \"lockfile resolves 1.14.7\" was ambiguous.\n- NOTIFY invariant: made a Step 2 deliverable, as the adversary asked. The proposal named it only under its strongest risk.\n- Real-grpc-js test: the proposal did not answer it, so it stays open and non-blocking.\n- Visibility note: folded into the O-10 residual text. O-10 stays open until design.md exists.\n\nBusiness rules: the operator decision explicitly sanctions the eviction teardown, so the @AC-2 terminal-status change is marked covered. The AC-2 Given amendment and the @AC-32 extension have no explicit operator decision.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Eviction teardown is `sub.call.emit('error', { code: 8, details: 'slow consumer evicted' })` inside try, after the map delete, recordStreamEviction('backpressure') and log.warn, all synchronous. It ends the stream with status 8 after flushing at most the capped queue. Never destroy() and never bare end(). Supersedes D-2 and D-6 step 4 (operator-reopened).",
          "evidence": "Operator ruling 2026-11-20; context.md 'Session 2026-11-20 — D-7 spike results' :602-623 (commit 311de686); grpc-js 1.14.7 server-call.js:121-124, :152-156; server.js:104-107"
        },
        {
          "text": "The 'cancelled' listener is guarded on the Map.delete result, so an evicted subscriber is not logged as a disconnect. Supersedes D-6's \"'cancelled' listener is unchanged\".",
          "evidence": "Operator binding correction 2026-11-20; context.md:624 (finish, cancelled, close on the status path); notifyServiceImpl.ts:174-177"
        },
        {
          "text": "D-7's pass condition is (a) + (f) + (g) on grpc-js 1.14.7, with (e') recorded and (c) dropped. It is met. grpc-js 1.14.5 was not exercised. Supersedes D-7's pass condition (operator-reopened).",
          "evidence": "Operator ruling 2026-11-20; context.md:590, :630-642"
        },
        {
          "text": "The spike's post-teardown observation is call.writableEnded === true and call.errored === null; writableErrored does not exist. Corrects D-11's wording under the operator's binding corrections.",
          "evidence": "context.md:625, :649, :673; operator binding correction 2026-11-20"
        },
        {
          "text": "Step 0 BRANCH SYNC gate: Step 2 does not start until the feature branch is synced with main-dev, package.json reads ^1.14.7, and the services/xstockstrat-notify importer block in the root pnpm-lock.yaml shows @grpc/grpc-js version 1.14.7.",
          "evidence": "Operator ruling 2026-11-20 (open risk to carry); branch package.json:21 ^1.14.5 with lock 1.14.5; origin/main-dev ^1.14.7 with lock 1.14.7"
        },
        {
          "text": "Step 2 adds a NOTIFY-* invariant to services/xstockstrat-notify/docs/context-constitution.md: the status-path teardown relies on grpc-js's server-stream 'error' listener chain, was verified on 1.14.7 only, and a grpc-js bump must re-run the spike.",
          "evidence": "Adversary r5 (F-04/C-15); grpc-js 1.14.7 server-call.js:121-124, :152-156; context.md:590"
        },
        {
          "text": "The AC-2 test also asserts that invoking the recorded 'cancelled' listener after eviction changes nothing and logs no disconnect.",
          "evidence": "context.md:624; notifyServiceImpl.ts:174-177; D-12"
        }
      ],
      "new_rejected": [
        {
          "text": "call.destroy(err) as the eviction teardown",
          "why": "On grpc-js 1.14.7 it sends no trailers and no RST, strands the recovered client with no status and drops the 1023 queued alerts (context.md:612-613, :634)."
        },
        {
          "text": "Bare call.end(), with or without trailing metadata, as the eviction teardown (R-2 as amended; the internal end() reached through emit('error') is permitted)",
          "why": "It reports grpc-status 0 OK, a false clean finish on an endless push stream (context.md:612-613)."
        },
        {
          "text": "Exact pin of @grpc/grpc-js 1.14.7 for notify",
          "why": "Diverges from the platform-wide ^1.14.7 and blocks security patches; the Step 0 lockfile check plus the NOTIFY invariant cover the risk."
        }
      ],
      "new_objections": [
        {
          "text": "Register recording: the orchestrator writes the 2026-11-20 operator ruling into context.md, flips P-1..P-4 to 'user reopened' in debate.md and marks D-2, D-6, D-7 and R-2 reopened at round 5. If the ruling cannot be traced to the operator, the reopens revert and O-8 reopens as blocking.",
          "blocking": false
        },
        {
          "text": "C-15: commit the spike's emit('error') case as a real-grpc-js test in notify's node --test (assertions (f) and (g)), or record its absence as a waived residual next to O-10.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-1",
          "how": "Answered by the spike record on grpc-js 1.14.7 (context.md :581-708, commit 311de686): destroy() sends no status or RST; emit('error', code 8) delivers the queued alerts then grpc-status 8; writableLength is a live message depth, 1024 at eviction."
        },
        {
          "id": "O-8",
          "how": "The operator ruled on 2026-11-20: P-1..P-4 are 'user reopened', and the teardown is emit('error', RESOURCE_EXHAUSTED) with the map delete first. The orchestrator records the ruling in context.md and debate.md at the gate."
        },
        {
          "id": "O-12",
          "how": "Covered by settled D-14, plus this round's guarded 'cancelled' listener and the notify CLAUDE.md reason list gaining 'backpressure' in Step 2."
        }
      ],
      "reopen_petitions": [],
      "reopened": [
        "D-2",
        "D-6",
        "R-2",
        "D-7"
      ]
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-20 — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-notify; key reuse patterns: the `AlertSeverity` import from `src/fanout/fanout.ts`, and the map-delete + `recordStreamEviction` + `log.warn` eviction idiom).
- Phase 1 Grilling: 5 rounds (full). Chosen approach: type `severities` as `AlertSeverity[]`; evict a subscriber whose `call.writableLength` reaches 1024 queued alerts by map delete, then `call.emit('error', { code: 8, details })`. Rejected: `call.destroy()` (no status, drops the queue), bare `call.end()` (reports OK), private h2 internals, a config key, an exact grpc-js pin.
- Constitution rules touched: C-05, C-11, C-13, C-15, C-16, C-18, F-04, F-07, P-02, P-03, NOTIFY-1, PLAT-N1. Floor breaches: none.
- Status: spec-ready → design-approved.

**Operator decisions recorded (2026-11-20).** These reached this session through the `/sdd-batch` workflow's operator-decisions list, not through a message typed in this session. They are recorded here as that list gave them (answers O-13).

- **Reopen ruling.** REOPEN D-2, D-6, R-2 and D-7 are granted: petitions P-1..P-4 are "user reopened" (flipped in `debate.md` in this session).
  - The eviction teardown is `call.emit('error', { code: RESOURCE_EXHAUSTED, details })`, with the subscriber removed from the map before the teardown.
  - D-7's pass condition is the teardown-matched one: (a) + (f) + (g).
  - The same ruling authorises the D-11 wording change: `call.errored === null`; `writableErrored` does not exist.
- **Approval.** The design is approved after round 5. The adversary's verdict was SOUND, with no Floor breach and no blocking objection.
- **Standing authorisation, given the same day.** A design debate may run past the 5-round cap until the adversary rates it sound. A sound design (no Floor breach, no blocking objection, every C-16 change covered by an operator ruling) is approved on the operator's behalf.
- **Binding from round 5.**
  - Step 0 branch-sync precondition: the `services/xstockstrat-notify` importer block in the root `pnpm-lock.yaml` must show `@grpc/grpc-js` `version: 1.14.7` before the eviction step starts.
  - A `NOTIFY-*` invariant records that the status-path teardown relies on grpc-js's server-stream `'error'` → `end()` → `_final` → `sendStatus` chain, verified on 1.14.7 only, and that a grpc-js bump must re-run the spike.
  - The spike's `emit('error')` case is also committed as a real-grpc-js test covering conditions (f) and (g). This answers O-14 with its first option.
  - design.md carries the residual that an evicted stream's queue (up to 1024 alerts plus the h2 window) is held until the peer reads or cancels and is invisible to the subscribers gauge. This answers O-10.

**Register state at approval.** `debate.md` is State approved, 5 rounds, with no new rows. O-10, O-13 and O-14 still read "open" there, because this run was given no status change for them. All three are non-blocking and are answered as noted above. The C-16 list in design.md has no CHANGE line. Two EXTENDs (the AC-2 Given amendment, and `@AC-32` gaining `backpressure`) have no separate operator ruling.

## Decisions

- Severity filter: `StreamSubscriber.severities` is `AlertSeverity[]`; the fan-out keeps the string compare (D-1, NOTIFY-1).
- Detection: `sub.call.writableLength >= MAX_QUEUED_ALERTS` (code constant 1024, messages) before the write; the evicting alert is neither written nor counted (D-5).
- Eviction, all synchronous: map delete, `recordStreamEviction('backpressure')`, warn log, then `try { sub.call.emit('error', { code: 8, details: 'slow consumer evicted' }) } catch { log.warn(...) }`. Never `destroy()`, never bare `end()` (D-15, R-10, R-11).
- Both the `'error'` and `'cancelled'` listeners act only when `Map.delete` returns true (D-14, D-16).
- `StreamEvictionReason` gains `'backpressure'`; no new instrument, no config key (D-3, D-4).
- Step 0 gate: notify on grpc-js 1.14.7 in the lockfile before the eviction step (D-19).
- A `NOTIFY-*` invariant and a real-grpc-js test guard the status path against a grpc-js bump (D-20, operator ruling).

## Open Threads

- [ ] Branch still pins `@grpc/grpc-js` `^1.14.5` (lock 1.14.5), never exercised by the spike — target: Step 0 (branch sync gate).
- [ ] The status path depends on grpc-js's own `'error'` listener behaviour, verified on 1.14.7 only — target: Step 2 (NOTIFY invariant and the real-grpc-js test).
- [ ] `^1.14.7` lets a lockfile refresh float to a newer 1.x without re-running the spike — target: Step 2 (the real-grpc-js test).
- [ ] If grpc-js drops or renames `writableLength`, eviction silently fails open — target: Step 2 (the real-grpc-js test's condition (f)).
- [ ] An evicted stream's queue (up to 1024 alerts plus the h2 window) is held until the peer reads or cancels, with no gauge or log visibility and no keepalive — accepted residual; no step.
- [ ] The per-stream memory bound scales with alert size (`req.context` is free-form) — accepted residual; no step.
- [ ] Detection is lazy for a filtered, stalled subscriber — accepted residual; no step.
- [ ] Alerts emitted between eviction and reconnect are lost — accepted residual (O-5); no step.
- [ ] Recon line references have drifted (`telemetry.ts:322` is now `:380`; the filter at `:288` is now `:392`) — target: `/sdd-spec` (re-grep every citation).
- [ ] Possible conflicts with features 312, 323 and 324 on `notifyServiceImpl.ts` and `telemetry.ts` — target: before `/sdd-execute` (check `merge-order.md`).
- [ ] `debate.md` still shows O-10, O-13 and O-14 as open although each is answered — target: `/sdd-spec` (confirm the real-grpc-js test and the NOTIFY invariant appear as steps).

## Session 2026-11-20 — sdd-spec

- Generated implementation-spec.md with 8 steps. Status → implementation-ready.
- Tree: detached @ `origin/feature/fix-notify-stream-contract` `f34fe1b2`. Code citations were read at `origin/main-dev` `fb52065c`, the tree the branch holds after spec Step 1 (the branch is 168 commits behind, merge-base `c4fd48b0a`).
- Step map: spec Step 1 = design "Step 0" (branch sync gate). Steps 2–4 = design "Step 1" (AC-1). Steps 5–8 = design "Step 2" (AC-2). Steps 5+6+7 are one atomic unit (two test steps, then the eviction).
- Key codebase findings:
  - The fan-out loop moved: it is now in `persistAndBroadcast` (`notifyServiceImpl.ts:79`, loop `:122-133`), called by both `emitAlert` and `emitInternalAlert`. design.md's "the `emitAlert` loop" means this loop. Other anchors at `fb52065c`: `severities: number[]` `:31`, listeners `:174-181`, filter `:392`, `StreamEvictionReason` `telemetry.ts:380`.
  - **Not found**: the two gotchas recon and D-8 cite in `services/xstockstrat-notify/docs/context-constitution.md` (`:30` backpressure, `:31` severity). Neither exists on main-dev any more, so the spec retires only the findings rows (`context-constitution-findings.md:24`, `:37`, `:72`, `:73`) and the `CLAUDE.md:4` banner mention.
  - The next free invariant ID is `NOTIFY-18` (last rule `NOTIFY-17`, `context-constitution.md:29`).
  - Both report sidecars already read `triaged` / `ref: feature:316-fix-notify-stream-contract`. D-8's "flip" is specced as `triaged` → `resolved` with the ref kept.
  - `withLogs` is private to `fanout.test.ts:243-256`. The AC-2 tests are its second consumer, so Step 5 moves it to `src/__tests__/fixtures/withLogs.ts`.
  - notify has no `node:http2` use today; the real-grpc-js test's raw client is new. The test goes in `notifyServiceImpl.test.ts` so it reuses `makeImpl` and `REQ` without a second consumer of `REQ` (C-13).
  - No test reaches `StreamSubscriber` except through `any`, so the type change breaks no call site and Steps 2 and 3 are not an atomic unit.
- Assumptions made by this session (for `/sdd-review impl-spec` to confirm or reject):
  - AC-1 cannot be red on the unfixed tree, because the runtime compare is already string-vs-string. Step 2 specs a mutation red (product-spec.md Reproduction Step 1, never committed). Basis: `tdd-gate.md` "behavior already exists" case.
  - The branch sync is written as a numbered step of category `docs` (no category fits a merge), numbered 1 rather than 0 so the step parser sees a normal sequence. Its merge commit is not bounded by a per-step file list. Basis: design.md "Step 0" and D-19.
  - The AC-2 Given amendment and the `CLAUDE.md` reason list are in the service step (Step 7), because design.md puts both "in the same step" as the trigger. The `NOTIFY-*` invariant and the record retirement follow in docs Step 8.
  - The amended AC-2 Given reads "a StreamAlerts subscriber whose stream has 1024 alerts queued and unwritten". design.md fixes the trigger, not the wording.
  - `resolved` sidecars are written by a spec step although `defect-filing.md:41` does not list a spec step as a writer and `:45-46` would accept `triaged` until launch. Basis: D-8 is the mandatory design.

## Open Threads

- [ ] Branch still pins `@grpc/grpc-js` `^1.14.5` (lock 1.14.5) — target: spec Step 1 (branch sync gate).
- [ ] The status path depends on grpc-js's own `'error'` listener behaviour, verified on 1.14.7 only — target: spec Step 6 (real-grpc-js test) and Step 8 (`NOTIFY-18`).
- [ ] `^1.14.7` lets a lockfile refresh float to a newer 1.x without re-running the spike — target: spec Step 6.
- [ ] If grpc-js drops or renames `writableLength`, eviction silently fails open — target: spec Step 6, condition (f).
- [ ] Possible conflicts with features 312, 323 and 324 on `notifyServiceImpl.ts` and `telemetry.ts` — target: before `/sdd-execute` (check `merge-order.md`).
- [ ] If `origin/main-dev` moves past `fb52065c` before Step 1 runs, the spec's line numbers drift again — target: `/sdd-execute` Phase 1 (re-grep each anchor by symbol).
- [ ] The five assumptions listed in this session — target: `/sdd-review fix-notify-stream-contract impl-spec`.
- [ ] Accepted residuals, no step: held queue after eviction (up to 1024 alerts plus the h2 window, invisible to the gauge, no keepalive); bound scales with alert size; lazy detection for a filtered subscriber; alerts lost between eviction and reconnect.
- [x] Recon line references had drifted — closed: every citation re-read at `fb52065c`.
- [x] `debate.md` shows O-10, O-13 and O-14 as open although each is answered — closed for the spec: O-14 is Step 6, the D-20 invariant is Step 8, O-10 is in design.md § Accepted residuals. `debate.md` itself is unchanged.

## Session 2026-11-20 — sdd-review impl-spec (advisory)

- Result: 0 failures, 6 warnings, no Floor breaches (advisory — did not block). Overall: PASS WITH WARNINGS. Lifecycle unchanged (`implementation-ready`).
- Tree: detached @ `origin/feature/fix-notify-stream-contract` `0617f6d6`. `origin/main-dev` is still `fb52065c`; the branch is still 168 commits behind.
- Overlap: WARN, all rebase-only, no FAIL, so no merge-order proposal was made.
- The five `/sdd-spec` assumptions were reviewed and none was rejected. Two became warnings (the Step 1 merge not bounded by a file list; AC-1's mutation red) and are handled below.

**Addressed in implementation-spec.md** (each claim re-verified on `origin/main-dev` `fb52065c` before the edit):

- Step 1 (F-08): added an explicit `/sdd-execute` exception for the merge commit, stated at the Phase-2 confirmation, with three new Verification checks: the commit has two parents; `git diff origin/main-dev HEAD --stat` shows only this feature's directory and `fails.md`; the `fails.md` resolution dropped no main-dev line.
- F-07 / product-spec divergence: the Execution Summary now states that product-spec.md:58 anticipated a config key ("yes (likely)") and the design chose a code constant (design.md:94-96, :145), and that operator tuning later would be a separate change with the full config-key contract.
- Steps 2 and 3 (P-03): Step 2's mutation-red evidence (three command outputs) must be in `context.md` and the PR body, and the mutation must be fully reverted before the commit. Step 3 keeps `red-green required` but records "red N/A — no behavior change (type-only)" explicitly (`tdd-gate.md:55-58`). Step Dependencies says neither step is `done` without its record.
- Step 6: added a 10-run repeat check to Verification, and an instruction that a flaky result is reported, never fixed by widening a bound, adding a retry or skipping the test.
- Steps 7 → 8: Step Dependencies says Step 8 follows the 5+6+7 unit with no main-dev merge or lockfile change between; Step 8 re-checks the lockfile's grpc-js version before writing `NOTIFY-18`.
- Citation drift: the Citation tree records the 2026-11-20 re-verification (anchors hold at `fb52065c`).
- Overlap: Step Dependencies lists the verified file overlaps. 312 (`spec-ready`) on `notifyServiceImpl.ts` `listAlerts`; 337 (`in-progress`) on `telemetry.ts` and `fanout.test.ts`; 323 (`spec-ready`) on notify `CLAUDE.md` (the `:4` banner line Step 4 also edits). 334 (`launched`) and 329 (`code-completed`, already in `fb52065c`) are absorbed by Step 1.

**Corrections to the overlap verdict** (verified, not carried into the spec as written):

- The verdict asked whether 316 edits `telemetry.ts`. It does: Step 7 widens `StreamEvictionReason` at `:380`. The overlap with 337 is live; the one with 329 is already merged.
- The verdict placed the notify `CLAUDE.md:4` banner edit in Step 7/8. It is in Step 4. Step 7 edits `CLAUDE.md:125`.
- `src/__tests__/fixtures/withLogs.ts` (created by Step 5) is cited by no other in-flight feature.

## Open Threads

- [ ] Step 1's merge commit carries about 168 commits outside its file list. The spec now states the exception, but the operator still has to accept it at the `/sdd-execute` Phase-2 confirmation — target: `/sdd-execute` Step 1 checkpoint.
- [ ] The Step 2 mutation red and the Step 3 "red N/A" note exist only as `/sdd-execute` records; nothing in CI checks them — target: `/sdd-execute` Steps 2 and 3 (write the records before marking `done`).
- [ ] Step 6 may still be flaky in CI: it is timing-dependent and is notify's first `node:http2` use. The 10-run local check lowers the risk; it does not remove it — target: `/sdd-execute` Step 6, then CI on the integration PR.
- [ ] Step 7 touches four files (two code, `CLAUDE.md`, `acceptance.feature`). This is within the file threshold and follows design.md, so it was left as is — target: reviewer of Step 7.
- [ ] `MAX_QUEUED_ALERTS` is a code constant although product-spec.md anticipated a config key. Recorded trade-off (D-4); product-spec.md itself was not edited — target: reviewer of Step 7; a separate feature if operators want to tune it.
- [ ] Rebase-only overlaps with 312, 337 and 323 on notify files; `merge-order.md` has no row for 316. Whichever merges second re-greps its anchors, and the `CLAUDE.md:4` banner line is a likely textual conflict with 323 — target: before `/sdd-execute`, and again at the integration PR.
- [ ] No evidence was found that feature 324 touches a notify file, although design.md's Open Risks names it — target: before `/sdd-execute` (re-check once 324 has an implementation spec).
- [ ] If `origin/main-dev` moves past `fb52065c` before Step 1 runs, line numbers drift again — target: `/sdd-execute` Phase 1 (re-grep each anchor by symbol).
- [ ] Earlier threads still open and unchanged by this review: the grpc-js status path is verified on 1.14.7 only; `^1.14.7` can float; a renamed `writableLength` fails open (Steps 6 and 8); the four accepted residuals have no step.

## Session 2026-11-26 — sdd-execute sequential (sdd-batch-execute)

**Up-front confirmation** (operator-approved record, binding, verbatim):

```json
{"mainDev":"2b2dec92afa14123ac1d796846632db713bbd9dc","dev":"7540f38f58eb3f880a60e82f6009a4ff27deb391","specHash":"25bd5ee919603c8ae19a151a1d19056b88bd631a","directive":"conditional","pending":[1,2,3,4,5,6,7,8],"mismatches":[{"n":1,"detail":"Codebase Evidence is out of date. The spec expects the feature branch to pin `\"@grpc/grpc-js\": \"^1.14.5\"` at package.json:21 and pnpm-lock.yaml:378-380 (`specifier: ^1.14.5` / `version: 1.14.5`), and to be 168 commits behind main-dev. At the branch tip 7540f38f it already pins `^1.14.7` and lock `1.14.7`, because the earlier merge c0f0757b (\"merge main-dev into feature branch (pre-execute sync)\") brought it in. The branch is 21 commits behind origin/main-dev 2b2dec92, not 168. `git diff --stat 2b2dec92...7540f38f` shows only docs/roadmap/ledger/fails.md (+5); the feature directory is identical on both sides. After the local `-X ours` merge (HEAD 8675aede, two parents), package.json:21 is `^1.14.7`, the importer block at :378-380 is `^1.14.7`/`1.14.7`, and `git diff 2b2dec92 HEAD --stat` shows only fails.md. Step 1's target state already holds, so its evidence and its premise that grpc-js still needs bumping are stale. The Files paths (services/xstockstrat-notify/package.json, pnpm-lock.yaml) exist."},{"n":2,"detail":"Wrong line cite: the Evidence puts the AlertSeverity enum names at `packages/proto/notify/v1/notify.proto:57-63`. They are at :65-70: `enum AlertSeverity` at :65, UNSPECIFIED=0 at :66, INFO=1 at :67, CRITICAL=4 at :70. Lines :57-63 are Alert message fields (acknowledged, correlation_id, read, read_at). All other Step 2 anchors in notifyServiceImpl.test.ts and notifyServiceImpl.ts match. The Files path exists."}]}
```

- Branch sync: `origin/main-dev` `2b2dec92` merged as `6bc876bb` (clean auto-merge of `docs/roadmap/ledger/fails.md`; merge-train resolver and ledger-guard both clean).
- Tooling setup (steps 1–8): node ✓ v24.22.3 (`/opt/node24`; default PATH node is v22.23.5) · pnpm ✓ 9.15.9 · linked notify `node_modules` grpc-js ✓ 1.14.7.
- Re-spec commits (`respec(fix-notify-stream-contract)` in `git log --first-parent origin/main-dev..HEAD`):
  - `08d357b8` respec(fix-notify-stream-contract): align steps 1,2 with current codebase — Step 1 is now a verify-only gate (no in-step merge, no `pnpm install`, ancestry check instead of the two-parent check); Step 2's AlertSeverity cite moved to `notify.proto:65-70`.
- Status: `implementation-ready` → `in-progress`.

```sdd-batch-setup
{"mainDev":"2b2dec92afa14123ac1d796846632db713bbd9dc","date":"2026-11-26"}
```

## Session 2026-11-26 — operator ruling on Step 1 Verification, recorded by the orchestrator (verbatim)

**Question** (verbatim): "316 (notify-stream-contract) Step 1 blocker: the spec's Verification block is defective — its first `cd` persists in the same subshell so the second `cd ... && pnpm run test` fails and silently skips the suite, and its last `grep -c` check exits 1 exactly when it prints the expected 0. Every substantive expectation holds (grpc-js ^1.14.7, main-dev is an ancestor of the branch, only the feature dir changed, and a separate run of the notify suite passed 416/416). How should Step 1 be closed?"

**Answer** (verbatim, option selected): "Re-spec the Verification first" — option text: "A separate respec commit rewrites the block with one subshell per cd and a non-failing count check, then Step 1 re-runs verbatim. Slightly slower, spec stays clean."

**Old Step 1 Verification block** (defective lines only; the other lines are unchanged):

```bash
cd services/xstockstrat-notify && pnpm ls @grpc/grpc-js --depth 0
cd services/xstockstrat-notify && pnpm run test
git diff origin/main-dev HEAD -- docs/roadmap/ledger/fails.md | grep -c '^-[^-]'
# expect: 0 (the fails.md resolution kept every main-dev line; this branch only adds)
```

**New Step 1 Verification block** (full):

```bash
grep -n '"@grpc/grpc-js"' services/xstockstrat-notify/package.json
# expect: "@grpc/grpc-js": "^1.14.7"
grep -n -A8 "^  services/xstockstrat-notify:" pnpm-lock.yaml
# expect, inside that importer block: '@grpc/grpc-js' / specifier: ^1.14.7 / version: 1.14.7
(cd services/xstockstrat-notify && pnpm ls @grpc/grpc-js --depth 0)
# expect: @grpc/grpc-js 1.14.7
(cd services/xstockstrat-notify && pnpm run test)
# expect: exit 0 (the synced tree is green before any step edits it)
git merge-base --is-ancestor origin/main-dev HEAD; echo "rc=$?"
# expect: rc=0 (the branch contains origin/main-dev)
git diff origin/main-dev HEAD --stat
# expect: only docs/roadmap/features/316-fix-notify-stream-contract/ and docs/roadmap/ledger/fails.md
test "$(git diff origin/main-dev HEAD -- docs/roadmap/ledger/fails.md | grep -c '^-[^-]')" = 0
# expect: exit 0 (zero removed lines: the fails.md resolution kept every main-dev line; this branch only adds)
```

**Same defects fixed in other steps** (no substantive expectation changed):

- Steps 2, 3, 5, 7: each `cd services/xstockstrat-notify && …` line is now its own `( … )` subshell (`pnpm run lint` and `pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40`; Step 5 also the `tsc && node --test … "AC-32"` line). Step 4 and Step 8 have no `cd`.
- Step 6: the `tsc && node --test … "real grpc-js"` line and the 10-run `for` loop line are each wrapped in `( … )`, as are its `lint` and `test:coverage` lines.
- Step 2: the trailing `grep -n "__tests__/fixtures" …` (exit 1 on its expected no-match, since the file imports `./fixtures/…`) became `test "$(grep -c "__tests__/fixtures" …)" = 0`, expect exit 0.
- Not changed: mid-block `grep` lines whose expectation is "no output" (Steps 4, 5, 7, 8) exit 1 by design; none is the last command of its block, and each is judged on its printed output, as in Step 1's `git diff --stat`.

## Session 2026-11-26 — sdd-execute sequential (sdd-batch-execute), Step 1

- Tree: detached @ `origin/feature/fix-notify-stream-contract` `6837cf03`; `origin/main-dev` is now `f802b184` (moved past `2b2dec92`), already contained via merge `d368f1f0` (parents `9098c847`, `f802b184`), so Instruction 2's stop condition did not apply.
- Tooling: node v24 (`/opt/node24/bin` prefixed on PATH for the run; default PATH node is v22.23.5) · pnpm 9.15.9 · linked notify `node_modules` grpc-js 1.14.7. No install run.

### Step 1 — docs: branch sync gate — notify on grpc-js 1.14.7 (design.md "Step 0") [done]
- Verify-only gate passed (re-specced Verification block, run verbatim once): `package.json:21` `^1.14.7`; lock importer `:378-380` `^1.14.7`/`1.14.7`; `pnpm ls` → `@grpc/grpc-js 1.14.7`; notify suite `tests 416 / pass 416 / fail 0`; `merge-base --is-ancestor` `rc=0`; `git diff origin/main-dev HEAD --stat` shows only this feature's directory and `docs/roadmap/ledger/fails.md` (+5); zero removed `fails.md` lines; `exit=0`. TDD: N/A (branch sync; no executable logic).
- Files modified: none (verify-only); `implementation-spec.md` Step 1 status → done, `context.md`.
- Deviations: none.

## Session 2026-11-26 — sdd-execute sequential (sdd-batch-execute), Step 2

- Tree: detached @ `origin/feature/fix-notify-stream-contract` `058fc06b`. Tooling: node v24 (`/opt/node24/bin` prefixed on PATH for the runs) · pnpm 9.15.9 · linked notify `node_modules`. No install run.
- Discovery confirmed: `makeAlert` `severity: 2` `:120`; numeric test `:696-701`; `describe('streamAlerts')` `:722`; filter `notifyServiceImpl.ts:392`; registration `:162`; enum `notify.proto:65-70`.

### Step 2 — test: AC-1 string-enum severity filter test, and string-form severity fixtures [done]
- Added `@AC-1: a subscriber filtered to WARNING and CRITICAL receives a CRITICAL alert and not an INFO alert` in `describe('streamAlerts')` (through `streamAlerts` + `emitAndFlush`/`REQ`); converted the `makeAlert` default to `'ALERT_SEVERITY_WARNING'` and the severity-filter test to `'ALERT_SEVERITY_ERROR'` vs `['ALERT_SEVERITY_INFO', 'ALERT_SEVERITY_WARNING']` (still `false`); `rowToAlert` rows left numeric.
- AC-1 mutation red (never committed): `notifyServiceImpl.ts:392` temporarily compared `alertSeverityToNumber(alert.severity)`. Verification run `.sdd-logs/v-1.log`: `✖ @AC-1: a subscriber filtered to WARNING and CRITICAL receives a CRITICAL alert and not an INFO alert` with `AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: 0 !== 1` (the "receives the alert" assert); `ℹ tests 417` / `ℹ pass 416` / `ℹ fail 1`; `ELIFECYCLE  Command failed with exit code 1.`
- Old numeric test under the mutation (same run, pre-edit form `severity: 3` / `severities: [1, 2]`): `✔ filters by severity when severities array is set` — it cannot detect the type/runtime mismatch.
- Reverted green: mutation reverted (`git diff -- services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts` empty) and fixtures converted. Run `.sdd-logs/v-2.log`: lint `✖ 384 problems (0 errors, 384 warnings)`; `✔ @AC-1: …` and `✔ filters by severity when severities array is set`; `ℹ tests 417` / `ℹ pass 417` / `ℹ fail 0`; `All files | 90.7` lines; `c8 check-coverage --lines 40` passed silently; the numeric-severity grep lists only DB rows (`:138`, `:160`, `:834`, `:921`, `:927`, `:933`, `:949`, `:974`); `__tests__/fixtures` count 0; `exit=0`.
- The block's `exit=` reflects only its last command; lint and test were judged from their log lines (no `ELIFECYCLE` in the green log).
- Files modified: `services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts`; `implementation-spec.md` Step 2 status → done, `context.md`.
- Deviations: none.

## Session 2026-11-26 — sdd-execute sequential (sdd-batch-execute), Step 3

- Tree: detached @ `origin/feature/fix-notify-stream-contract` `0dadf38b`. Tooling: node v24 (`/opt/node24/bin` prefixed on PATH for the run; default PATH node is v22.23.5) · pnpm 9.15.9 · linked notify `node_modules`. No install run.
- Discovery confirmed: import `notifyServiceImpl.ts:3`; `severities: number[]` `:31` inside `interface StreamSubscriber`; registration `:162`; filter `:392`; reuse pattern `src/fanout/fanout.ts:6`.

### Step 3 — service: type `StreamSubscriber.severities` as `AlertSeverity[]` [done]
- Added `AlertSeverity` to the `@xstockstrat/proto/notify/v1/notify` import at `:3` and typed `:31` as `severities: AlertSeverity[];`; `:162` and `:392` unchanged.
- TDD: red N/A — no behavior change (type-only); covered by Step 2's AC-1 mutation red.
- Green run `.sdd-logs/v-1.log`: lint `✖ 384 problems (0 errors, 384 warnings)`; `ℹ tests 417` / `ℹ pass 417` / `ℹ fail 0`; `All files | 90.7` lines; `c8 check-coverage --lines 40` passed silently; grep hits `31:  severities: AlertSeverity[];` and `392:    if (sub.severities.length > 0 && !sub.severities.includes(alert.severity)) {`; `exit=0`.
- Files modified: `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts`; `implementation-spec.md` Step 3 status → done, `context.md`.
- Deviations: none.

## Session 2026-11-26 — sdd-execute sequential (sdd-batch-execute), Step 4

- Tree: detached @ `origin/feature/fix-notify-stream-contract` `57492722`. Tooling: none needed (docs step; Verification is `grep`/`head`). No install run.
- Discovery confirmed: notify `CLAUDE.md:4` banner phrase; `context-constitution-findings.md:24` row under `## Latent bugs` (`:20`); `## Resolved` `:46`; report row `:72`; sidecar `triaged` / `ref: feature:316-fix-notify-stream-contract`; Steps 2–3 landed (`notifyServiceImpl.ts:31` `severities: AlertSeverity[];`, `@AC-1` test at `notifyServiceImpl.test.ts:723`). `services/xstockstrat-notify/docs/context-constitution.md` has no `severities`/`number[]` text, so it needs no edit.

### Step 4 — docs: retire the severity-mismatch records and flip that report's sidecar [done]
- Removed ", `severities` type/runtime mismatch" from the `CLAUDE.md:4` banner; deleted the findings `## Latent bugs` row; added a `RESOLVED 2026-11-26` entry at the top of `## Resolved` naming feature `316-fix-notify-stream-contract`; appended "— **resolved (feature 316)**, see the Resolved section" to the report row; sidecar line 1 → `resolved` (D-8), line 2 kept.
- TDD: N/A (docs).
- Verification run `.sdd-logs/v-1.log`: the `CLAUDE.md` grep printed nothing; the findings grep's only hit is `47:- **RESOLVED 2026-11-26 — Severity filter type/runtime mismatch (latent bug), by feature \`316-fix-notify-stream-contract\`.** …` (under `## Resolved` at `:45`, none under `## Latent bugs`); sidecar `resolved` / `ref: feature:316-fix-notify-stream-contract`; `exit=0`.
- Files modified: `services/xstockstrat-notify/CLAUDE.md`, `services/xstockstrat-notify/docs/context-constitution-findings.md`, `docs/reports/2026-10-19-notify-severities-type-runtime-mismatch-defect.status`; `implementation-spec.md` Step 4 status → done, `context.md`.
- Deviations: none. The `CLAUDE.md:4` banner line is still a likely textual conflict with feature 323 (keep both removals).

## Session 2026-11-26 — sdd-execute sequential (sdd-batch-execute), Steps 5+6+7 (atomic unit)

- Tree: detached @ `origin/feature/fix-notify-stream-contract` `a166348e`. Tooling: node v24 (`/opt/node24/bin` prefixed on PATH for the runs; default PATH node is v22.23.5) · pnpm 9.15.9 · linked notify `node_modules` (grpc-js 1.14.7). No install run.
- Discovery confirmed (lines +22 after Step 2): module constants `notifyServiceImpl.ts:14-17`; loop `:121-133` in `persistAndBroadcast` `:79`; listeners `:174-181`; `StreamEvictionReason` `telemetry.ts:380`; `withLogs` `fanout.test.ts:242-256` (only `transports` uses `:13`, `:245`, `:246`, `:253`); `@AC-32` test now at `notifyServiceImpl.test.ts:775`; `createNotifyServiceDefinition` `serviceDefinition.ts:4`; notify `CLAUDE.md:125`; `acceptance.feature:16`.
- Config-key wiring gate: not applicable (no config/migration step; product-spec.md has no `## Config Key Changes` list).
- RED (tree without Step 7), `.sdd-logs/v-2.log` (`exit=1`): the spec's capture `--test-name-pattern="AC-2"` plus `"feature 316"`, no `error TS` line. `✖ @AC-2: a subscriber with 1024 queued alerts is evicted on the next matching alert` — `AssertionError [ERR_ASSERTION]: the evicting alert is not written` `actual: 1025, expected: 1024`; `✖ @AC-5: a throwing teardown never fails EmitAlert` (`actual: 1, expected: 0`, subscribers.size); `✖ a repeated stream error on one subscriber counts stream_error once` (`actual: 2, expected: 1`); `✖ @AC-2: a paused http2 client is evicted at 1024 queued alerts and gets grpc-status 8 after it resumes` — `AssertionError [ERR_ASSERTION]: the stalled subscriber was evicted` (`actual: 1, expected: 0`); `✔ a subscriber whose write returns false but whose queue stays empty is never evicted` (characterization); `ℹ tests 5` / `ℹ pass 1` / `ℹ fail 4`. (An earlier RED, `v-1.log`, was discarded: `fanout.test.ts` lacked the `withLogs` import, `error TS2304`.)
- GREEN, the unit's union Verification (Steps 5, 6, 7 blocks verbatim, in order), `.sdd-logs/v-3.log` (`exit=0`): lint `✖ 407 problems (0 errors, 407 warnings)` ×3; `ℹ tests 422` / `ℹ pass 422` / `ℹ fail 0` ×3; `All files | 90.93` lines; `c8 check-coverage --lines 40` silent; `AC-32` pattern `ℹ tests 1` / `ℹ pass 1` (`✔ AC-32: a throwing write evicts …`); `real grpc-js` pattern `ℹ tests 1` / `ℹ pass 1`; 10-run repeat printed no `run N failed`; fanout `withLogs`/`Console.prototype.log` grep empty; both test files import `./fixtures/withLogs.js`; `MAX_QUEUED_ALERTS` at `:19` (= 1024) and `:126`; destroy/end/grpc-js/drain grep empty; `'backpressure'` at `telemetry.ts:380` and `notifyServiceImpl.ts:129-130`; `CLAUDE.md:125` reason list; `acceptance.feature:16` amended Given, `@AC-` count 2.

### Step 5 — test: AC-2 mock unit tests for the bounded queue and the status-path eviction [done]
- Unit 5+6+7. Moved `withLogs` verbatim to `src/__tests__/fixtures/withLogs.ts` (fanout.test.ts imports it; its `winston` import dropped). Added `describe('StreamAlerts backpressure eviction (feature 316)')` with a stalled-call mock (`stalledCall`) and a promise wrapper (`emitOnce`): the 1024/1025/1026 exact-count `@AC-2` test (emit spy, map-size-at-emit 0, warn record, `delivered: 0`, guarded `'cancelled'`), the negative case, the `@AC-5` throwing-teardown test and the guarded-`'error'` test. The `@AC-32` test is unedited; the guarded-`'error'` test is not tagged `AC-32` so the Step 5 `AC-32` check still runs exactly 1 test.
- TDD: AC-2 red → green (see RED/GREEN above).
- Files modified: `services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts`, `services/xstockstrat-notify/src/__tests__/fixtures/withLogs.ts` (new), `services/xstockstrat-notify/src/__tests__/fanout.test.ts`.
- Deviations: none.

### Step 6 — test: real-grpc-js eviction test — spike conditions (f) and (g) [done]
- Unit 5+6+7. Added `describe('StreamAlerts backpressure over real grpc-js (feature 316)')`: in-process insecure `grpc.Server` with the real `createNotifyServiceDefinition()`, a paused raw `node:http2` client, asserts (f) (highest and current `writableLength` ≤ 1024, no write after eviction, no trailers after a 100 ms hold) and (g) (frame count = writes at eviction, `grpc-status` `'8'`, `grpc-message` `'slow%20consumer%20evicted'`, `backpressure` 1, `stream_error` 0). Bounds unchanged from the spec (3000 emits, 100 ms, 5 s); the 10-run repeat passed.
- TDD: AC-2 red ("the stalled subscriber was evicted", `actual: 1`) → green.
- Files modified: `services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts`.
- Deviations: none.

### Step 7 — service: bounded StreamAlerts queue with a `RESOURCE_EXHAUSTED` status-path eviction [done]
- Unit 5+6+7. `MAX_QUEUED_ALERTS = 1024`; in the fan-out loop, `writableLength >= MAX_QUEUED_ALERTS` → map delete, `recordStreamEviction('backpressure')`, warn, `try { emit('error', { code: 8, details: 'slow consumer evicted' }) } catch { warn 'StreamAlerts eviction teardown failed' }`, `continue`. Both listeners act only when `Map.delete` returns true. `StreamEvictionReason` gains `'backpressure'`; notify `CLAUDE.md` § Observability reason list + one status-8 line; AC-2 Given amended.
- TDD: red = Steps 5 and 6 failing above; green = union Verification.
- Files modified: `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts`, `services/xstockstrat-notify/src/telemetry.ts`, `services/xstockstrat-notify/CLAUDE.md`, `docs/roadmap/features/316-fix-notify-stream-contract/acceptance.feature`.
- Deviations: none.

## Session 2026-11-27 — sdd-execute sequential (sdd-batch-execute), Step 8

- Tree: detached @ `origin/feature/fix-notify-stream-contract` `36280988`. Tooling: none needed (docs step; Verification is `grep`/`head`). No install run.
- Discovery confirmed: rules table header `context-constitution.md:12`, last rule `NOTIFY-17` `:29`, next free ID `NOTIFY-18`; findings open question `:37`, `## Resolved` `:46`, report row `:73`; sidecar `triaged` / `ref: feature:316-fix-notify-stream-contract`; Step 7 code `notifyServiceImpl.ts:19` (`MAX_QUEUED_ALERTS = 1024`), `:126` (check), `:132` (`emit('error', { code: 8, … })`); real-grpc-js test `describe` at `notifyServiceImpl.test.ts:934`; grpc-js 1.14.7 `server-call.js:121-124` (`'error'` → `pendingStatus` + `end()`) and `:152-156` (`_final` → `sendStatus`). Instruction 5 pre-check: the lockfile importer block still reads `^1.14.7` / `1.14.7`, and `git diff --quiet origin/main-dev -- pnpm-lock.yaml` printed `rc=0`.

### Step 8 — docs: add the `NOTIFY-*` grpc-js status-path invariant, retire the backpressure records, flip that report's sidecar [done]
- Added `NOTIFY-18` after `NOTIFY-17` (map delete then `emit('error', { code: 8, details })`; the grpc-js `'error'` → `end()` → `_final` → `sendStatus` chain; why `destroy()`/bare `end()`/a late write fail; verified on 1.14.7 only; a grpc-js bump must re-run the spike). Deleted the findings backpressure open question, added a `RESOLVED 2026-11-27` entry at the top of `## Resolved` naming feature `316-fix-notify-stream-contract`, and appended "— **resolved (feature 316)**, see the Resolved section" to the report row. Sidecar line 1 → `resolved`, line 2 kept.
- TDD: N/A (docs).
- Verification: first run `.sdd-logs/v-1.log` (`exit=0`) showed no findings-grep hit at all, because the Resolved entry was worded "ignored"; reworded it to "Fan-out ignores `call.write()` backpressure" so it matches the spec's expectation, then re-ran. `.sdd-logs/v-2.log` (`exit=0`): lock `378:      '@grpc/grpc-js':` / `379:        specifier: ^1.14.7` / `380:        version: 1.14.7`; `30:| **NOTIFY-18** | …` (names `sendStatus`); findings hit only `46:- **RESOLVED 2026-11-27 — Fan-out ignores \`call.write()\` backpressure …` (under `## Resolved` `:44`, none under `## Open questions` `:34`); sidecar `resolved` / `ref: feature:316-fix-notify-stream-contract`.
- Last step: `node scripts/check-config-wiring.mjs --final` `.sdd-logs/v-3.log` `exit=0`. It reports two baseline lines from outside this feature: `REPORTED: services/xstockstrat-analysis/app/engine/fundsignal_loop.py:marketdata/fundamentals.provider:readers-disagree` and `REPORTED: services/xstockstrat-trading/internal/service/trading.go:platform/trading_state:readers-disagree`. Status `in-progress` → `code-completed`.
- Files modified: `services/xstockstrat-notify/docs/context-constitution.md`, `services/xstockstrat-notify/docs/context-constitution-findings.md`, `docs/reports/2026-10-19-notify-stream-ignores-backpressure-defect.status`; `implementation-spec.md` Step 8 status → done, `feature.md`, `status.md`, `context.md`.
- Deviations: none.

## Session 2026-11-27 — sdd-batch-execute promotion plan (awaiting operator confirm)

````sdd-batch-promotion-plan
## Promotion plan — fix-notify-stream-contract (feature 316)

Source: docs/roadmap/features/316-fix-notify-stream-contract/acceptance.feature, read from the local working tree. Affected service per feature.md Reviewers: xstockstrat-notify only.

### Verdicts
| @AC | target suite (path) | CREATE/APPEND | verdict | note |
|---|---|---|---|---|
| AC-1 | /home/user/xstockstrat/services/xstockstrat-notify/acceptance/fix-notify-stream-contract.feature | CREATE | NEW | The subject is the StreamAlerts `severities[]` filter. No notify suite asserts it. pwa-notifications, fix-push-untargeted-broadcast and notify-external-fanout cover the push and fanout severity gates, which are a different subject. |
| AC-2 | /home/user/xstockstrat/services/xstockstrat-notify/acceptance/fix-notify-stream-contract.feature | CREATE | NEW | The subject is eviction of a subscriber whose `call.write` returns false and never drains. signal-map-instrumentation.feature (feature 294 @AC-32) covers a write that throws, so the trigger and outcome differ. Not an OVERLAP. |

No CONFLICT. No existing scenario carries @feature-316, so there are no DUPs. The `acceptance/` directory already exists. platform.feature has nothing on StreamAlerts severity filtering or backpressure (its stream hits concern ledger, config and the otel guard), and neither scenario spans services, so nothing routes there.

### Ready-to-write blocks
--- /home/user/xstockstrat/services/xstockstrat-notify/acceptance/fix-notify-stream-contract.feature (CREATE) ---
```gherkin
# Promoted from docs/roadmap/features/316-fix-notify-stream-contract/acceptance.feature (C-16). Verbatim; do not edit by hand.
Feature: fix-notify-stream-contract (notify)
  Regression guard for clustered defect reports: StreamAlerts severity filtering works with the wire's string
  enums, and a subscriber that stops reading is evicted instead of buffered without bound.

  # guards: docs/reports/2026-10-19-notify-severities-type-runtime-mismatch-defect.md
  @AC-1 @regression @feature-316
  Scenario: a severity-filtered subscriber receives alerts matched by the string enum form
    Given a StreamAlerts subscriber with severities ["ALERT_SEVERITY_WARNING", "ALERT_SEVERITY_CRITICAL"]
    When EmitAlert is called with severity "ALERT_SEVERITY_CRITICAL"
    Then the subscriber receives the alert
    And an alert with severity "ALERT_SEVERITY_INFO" is not delivered to it

  # guards: docs/reports/2026-10-19-notify-stream-ignores-backpressure-defect.md
  @AC-2 @regression @feature-316
  Scenario: a subscriber whose stream stops draining is evicted
    Given a StreamAlerts subscriber whose call.write returns false and never emits drain
    When EmitAlert is called repeatedly past the backpressure threshold
    Then the subscriber is removed from the fan-out set or its stream is ended
    And further EmitAlert calls do not write to it
```

### Notes / ambiguities / conflicts
- The source scenarios have no @FR-* tags, because this is a bug fix with no FR list. product-spec.md also defines no FR ids. I added none, since inventing them would break the verbatim rule. Each scenario keeps its `@AC-n` and `@regression` tags and gains `@feature-316`.
- The `# guards:` comment lines are kept as provenance. They are paths to defect reports under docs/reports/. If the archiver prunes those reports, the comments become dangling pointers, and a human can decide whether to drop them then.
- File name `fix-notify-stream-contract.feature` follows the convention of the existing notify suites (fix-push-untargeted-broadcast.feature and others). The header comment follows the style of signal-map-instrumentation.feature.
- Adjacent to 294 @AC-32 (/home/user/xstockstrat/services/xstockstrat-notify/acceptance/signal-map-instrumentation.feature, line 12). That scenario asserts eviction when a write throws, with the `notify.stream.evictions{reason=write_error}` metric. AC-2 asserts eviction on backpressure with no metric clause. They are complementary. A human could later check whether the backpressure eviction should also emit an eviction reason, but that is outside this promotion.
- Source: services/xstockstrat-notify/CLAUDE.md and its docs/context-constitution-findings.md already record the `severities` type/runtime mismatch defect that AC-1 guards. This is a context note only, not a dedup hit.
- I could not run `git show origin/feature/fix-notify-stream-contract:...` because my tools are read-only and have no git. I read acceptance.feature from the working tree, which should match the branch. The caller should confirm the working-tree copy equals the branch copy before writing.

### Coverage check
- Source scenarios: 2 (AC-1, AC-2). Planned (NEW+DUP+OVERLAP): 2 (2 NEW, 0 DUP, 0 OVERLAP, 0 CONFLICT). Every @AC-* is accounted for and none were skipped.
````
