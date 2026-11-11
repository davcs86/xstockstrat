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
