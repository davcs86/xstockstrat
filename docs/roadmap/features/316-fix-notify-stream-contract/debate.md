# Debate Register: fix-notify-stream-contract

**State**: in-debate
**Mode**: full
**Rounds run**: 2 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-11 | /sdd-batch | 4 | 3 | 0 | 5 | 0 | yes |
| 2 | 2026-11-11 | /sdd-batch | 4 | 2 | 3 | 2 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | Severity typing: StreamSubscriber.severities becomes AlertSeverity[]; fan-out keeps the string wire-form comparison; makeAlert and the numeric test literals become string-enum form. | notifyServiceImpl.ts:132,:288; NOTIFY-1; notifyServiceImpl.test.ts:116,:134,:633-634,:747; fanout.test.ts:66 | settled |
| D-2 | 1 | Eviction tears down the stream without flushing (destroy or status error, never end()), and removes the subscriber from the map first. | defect report 2026-10-19-notify-stream-ignores-backpressure-defect.md:37 (localWindowSize 0, writableLength held after 10 s); UI reconnect on either close: useReconnectingStream.ts:46-63, streamBackoff.ts:18 | settled |
| D-3 | 1 | New eviction reason 'backpressure' is added to the closed StreamEvictionReason union, with no new instrument. notify CLAUDE.md:115 is updated in the same step. The error listener records stream_error only when Map.delete returns true. | telemetry.ts:322,:339; notifyServiceImpl.ts:148-151; telemetryAllowlist.test.ts:31-36 pins keys/instruments only | settled |
| D-4 | 1 | The queue cap is a code constant justified as a memory-safety bound; notify.stream.max_subscribers is out of scope. | fails.md:2699-2701 (config key needs seed migration); key dropped in adf411c3 | settled |
| D-5 | 2 | Detection reads sub.call.writableLength (messages) before write, inside the matchesSubscriber branch, with `>= MAX_QUEUED_ALERTS` (code constant 1024) and no typeof guard. The evicting alert is neither written nor counted in deliveredCount. Fallback (b), a consecutive-false counter reset on a true write, applies only if the spike shows writableLength is not a live numeric depth. | report 2026-10-19-notify-stream-ignores-backpressure-defect.md:37 (write false from msg 16; 299,937 = 300,000 − ~63 window msgs); notifyServiceImpl.ts:84-95; test.ts:687-708 | settled |
| D-6 | 2 | Eviction order: map delete, then recordStreamEviction('backpressure'), then log.warn, then try{call.destroy(new Error('backpressure'))}catch{}, all synchronous. The 'cancelled' listener is unchanged; the 'error' listener is guarded by the Map.delete result. | notifyServiceImpl.ts:90-92, :144-151; D-2, D-3 | settled |
| D-7 | 2 | The F-04 verification of destroy/RST and writableLength runs as a pre-spec spike on real grpc-js 1.14.5 against a paused raw http2 client, with results in context.md before /sdd-spec. Pass condition: writableLength is a number and a live depth; the client sees close/RST within 1 s after destroy; the buffer is released; no trailer queues behind the window. | O-1 wording ('before /sdd-spec'); no grpc-js source on host (searched) | settled |
| D-8 | 2 | Step 2 retires the backpressure records (notify context-constitution.md:30, findings.md:34 and :61) and flips both reports' sidecars. It also amends the AC-2 Given to the queued-write-length trigger. | services/xstockstrat-notify/docs/context-constitution.md:30; context-constitution-findings.md:34,:61; C-15/C-16 | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | A drain-event listener used to reset a backpressure counter | Unverified event (F-04) plus extra state; queue length or reset-on-true covers it without an event | locked |
| R-2 | 1 | call.end() as the eviction teardown | It queues behind a zero-window buffer, so the stream and memory stay held and the client never reconnects | locked |
| R-3 | 1 | Enforcing a stream.max_subscribers config key in this fix | New capability needing a C-05 seed migration, and not needed once per-stream buffers are bounded | locked |
| R-4 | 2 | Closing the h2 stream via grpc-js private internals (Http2Stream.close NGHTTP2_CANCEL) | Breaks on upgrade and violates F-04. Needs operator sign-off and is reachable only if the spike shows destroy sends no RST. | locked |
| R-5 | 2 | Execute-time verification gate inside Step 2 in place of a pre-spec spike | The spec would commit to an unverified API with no fallback, and O-1 requires verification before /sdd-spec | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | F-04: verify the grpc-js 1.14.x non-flushing teardown API (destroy vs status error) on a zero-window server stream before /sdd-spec | yes | open |
| O-2 | 1 | F-04: verify what writableLength measures on the server call (messages vs bytes, call vs http2 stream) to choose detection option (a) or (b) and the cap's unit | yes | open |
| O-3 | 1 | Pin the deliveredCount semantics and the exact eviction inequality in the spec, and assert them in the test | no | closed @ round 2 (Pinned: check before write, `>=` 1024, evicting alert not written or counted, exact counts asserted (1024/1025/1026 plus a negative test); the AC-32 test is unchanged) |
| O-4 | 1 | Record the F-07 rationale for the code-constant cap without citing the mis-scoped CLAUDE.md:112 | no | closed @ round 2 (Cap justified in design.md as a memory-safety bound with no operator tuning (fails.md:2699-2701), without citing CLAUDE.md:112) |
| O-5 | 1 | Record the lost-alerts-until-reconnect gap as an accepted residual in design.md | no | closed @ round 2 (design.md residuals record the lost alerts until reconnect (no ListAlerts catch-up, no history paging), the 1024×max-alert-size bound, and lazy detection for filtered subscribers) |
| O-6 | 2 | Amend the AC-2 Given in 316 acceptance.feature to the queued-write-length trigger in the same step | no | open |
| O-7 | 2 | Retire the backpressure records (notify context-constitution.md:30, findings.md:34,:61) and flip both reports' .status sidecars | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
