# Debate Register: fix-notify-stream-contract

**State**: in-debate
**Mode**: full
**Rounds run**: 4 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-11 | /sdd-batch | 4 | 3 | 0 | 5 | 0 | yes |
| 2 | 2026-11-11 | /sdd-batch | 4 | 2 | 3 | 2 | 0 | yes |
| 3 | 2026-11-13 | /sdd-batch | 2 | 2 | 3 | 4 | 4 | yes |
| 4 | 2026-11-20 | /sdd-batch | 4 | 2 | 2 | 1 | 4 | yes |

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
| D-9 | 3 | The D-7 spike adds these observations to its pass condition, which is unchanged. It runs on the installed grpc-js 1.14.7 as well as 1.14.5. It records: (e') whether destroy() sends trailers or an RST at all; (f) for the emit('error', RESOURCE_EXHAUSTED) variant with the client paused, writableLength stays ≤ 1024 and no write runs after eviction (heap is observation only); (g) after resume, the client gets the queued alerts, then grpc-status 8, with counters backpressure=1 and stream_error=0. | node_modules/.pnpm/@grpc+grpc-js@1.14.7/node_modules/@grpc/grpc-js/build/src/server-call.js:108-164; server.js:106-107; services/xstockstrat-notify/package.json ^1.14.7 | settled |
| D-10 | 3 | The eviction teardown call stays inside try. Its catch logs a warning in the existing log.warn style, with no new instrument. The AC-2 test asserts evictions{stream_error}==0 next to backpressure==1. | notifyServiceImpl.ts:127-129 (log.warn idiom), :177-180 (error listener); C-18; D-3; @AC-5 | settled |
| D-11 | 4 | The pre-spec spike also records, right after the emit('error') teardown, call.writableEnded === true and call.writableErrored === null. This is an additive observation; D-7's pass condition is unchanged. | grpc-js 1.14.7 server-call.js:121-124 (listener only sets pendingStatus and calls end()), :152-156 (_final -> sendStatus) | settled |
| D-12 | 4 | The AC-2 test's teardown spy captures that the subscriber is already absent from the map when the teardown is called, and invokes any registered 'error' listener to model synchronous dispatch. | notifyServiceImpl.ts:128-130, :178-181; D-6 order; D-10; C-15 | settled |
| D-13 | 4 | If the operator approves a status-path teardown, the emitted error is { code: 8, details: <string> } with the bare numeric code and no grpc import in notifyServiceImpl.ts; the AC-2 test asserts integer code and string details. | services/xstockstrat-notify/docs/context-constitution.md:48; notifyServiceImpl.ts:55, :68, :274; grpc-js 1.14.7 server-call.js:25-41 | settled |
| D-14 | 4 | The spec states that the guarded 'error' listener does not count a stream error that arrives after the entry was already removed, and the notify CLAUDE.md:115 reason list is kept accurate. | D-3; notifyServiceImpl.ts:178-181; @AC-32 | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | A drain-event listener used to reset a backpressure counter | Unverified event (F-04) plus extra state; queue length or reset-on-true covers it without an event | locked |
| R-2 | 1 | call.end() as the eviction teardown | It queues behind a zero-window buffer, so the stream and memory stay held and the client never reconnects | locked |
| R-3 | 1 | Enforcing a stream.max_subscribers config key in this fix | New capability needing a C-05 seed migration, and not needed once per-stream buffers are bounded | locked |
| R-4 | 2 | Closing the h2 stream via grpc-js private internals (Http2Stream.close NGHTTP2_CANCEL) | Breaks on upgrade and violates F-04. Needs operator sign-off and is reachable only if the spike shows destroy sends no RST. | locked |
| R-5 | 2 | Execute-time verification gate inside Step 2 in place of a pre-spec spike | The spec would commit to an unverified API with no fallback, and O-1 requires verification before /sdd-spec | locked |
| R-6 | 3 | Map delete only on eviction, with no teardown call | The client is never told, so it never reconnects (useReconnectingStream.ts:46-63). It has the same flaw as destroy(). | locked |
| R-7 | 3 | Server heap growth as the spike's eviction pass criterion | GC-noisy and nondeterministic. writableLength ≤ 1024 with no post-eviction write is the deterministic check. | locked |
| R-8 | 4 | emit('error') teardown plus a hard-kill timer that drops the connection when no finish or cancel arrives | Every hard-kill path goes through grpc-js private internals, which R-4 locks. | locked |
| R-9 | 4 | Importing grpc into notifyServiceImpl.ts to use grpc.status.RESOURCE_EXHAUSTED | Contradicts the recorded house style (notify docs/context-constitution.md:48) and adds an import and a record amendment; bare 8 matches the file. | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | F-04: verify the grpc-js 1.14.x non-flushing teardown API (destroy vs status error) on a zero-window server stream before /sdd-spec | yes | open |
| O-2 | 1 | F-04: verify what writableLength measures on the server call (messages vs bytes, call vs http2 stream) to choose detection option (a) or (b) and the cap's unit | yes | closed @ round 3 (Answered from installed grpc-js 1.14.7 source. ServerWritableStreamImpl is objectMode (server-call.js:110), and _write passes one chunk at a time to sendMessage (:147-151), so writableLength counts messages queued on the call, not bytes or the h2 stream. The spike's D-7 (a)/(b) remain as confirmation.) |
| O-3 | 1 | Pin the deliveredCount semantics and the exact eviction inequality in the spec, and assert them in the test | no | closed @ round 2 (Pinned: check before write, `>=` 1024, evicting alert not written or counted, exact counts asserted (1024/1025/1026 plus a negative test); the AC-32 test is unchanged) |
| O-4 | 1 | Record the F-07 rationale for the code-constant cap without citing the mis-scoped CLAUDE.md:112 | no | closed @ round 2 (Cap justified in design.md as a memory-safety bound with no operator tuning (fails.md:2699-2701), without citing CLAUDE.md:112) |
| O-5 | 1 | Record the lost-alerts-until-reconnect gap as an accepted residual in design.md | no | closed @ round 2 (design.md residuals record the lost alerts until reconnect (no ListAlerts catch-up, no history paging), the 1024×max-alert-size bound, and lazy detection for filtered subscribers) |
| O-6 | 2 | Amend the AC-2 Given in 316 acceptance.feature to the queued-write-length trigger in the same step | no | closed @ round 3 (Covered by settled D-8: Step 2 amends the AC-2 Given to the queued-write-length trigger in the same step.) |
| O-7 | 2 | Retire the backpressure records (notify context-constitution.md:30, findings.md:34,:61) and flip both reports' .status sidecars | no | closed @ round 3 (Covered by settled D-8: Step 2 retires notify context-constitution.md:30 and findings.md:34 and :61, and flips both report sidecars.) |
| O-8 | 3 | The operator must rule on REOPEN D-2/D-6, REOPEN R-2 and the D-7 amendment before /sdd-spec. Source shows destroy() sends no trailers or RST (server-call.js:108-164). The recommended replacement is emit('error', RESOURCE_EXHAUSTED) (server.js:106-107). | yes | open |
| O-9 | 3 | C-16 @AC-5 / D-3: the spec pins map delete before teardown. The AC-2 test asserts stream_error==0 next to backpressure==1. The teardown stays inside try. | no | closed @ round 4 (Covered by settled D-6 (map delete before teardown) and D-10 (teardown inside try; AC-2 test asserts stream_error==0 next to backpressure==1), plus this round's in-spy check that the subscriber is already absent when the teardown is called.) |
| O-10 | 3 | design.md residuals add the post-eviction held bounded queue for a status-path teardown: invisible to the gauge, freed only on peer cancel or connection death, no keepalive (src/index.ts:48), linear in stalled streams, limited by mTLS. | no | open |
| O-11 | 3 | C-18: the teardown catch logs a warning instead of an empty catch {}. | no | closed @ round 4 (Covered by settled D-10: the teardown catch logs a warning in the existing log.warn style instead of an empty catch.) |
| O-12 | 4 | C-16 @AC-32 / D-3: the spec must state that the guarded 'error' listener no longer counts a stream error arriving after the entry was already removed, and keep notify CLAUDE.md:115 accurate. | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
| P-1 | 3 | R-2 | The grpc-js 1.14.7 source is installed (node_modules/.pnpm/@grpc+grpc-js@1.14.7/.../server-call.js:108-164), contrary to D-7's 'no grpc-js source on host'. destroy() has no _destroy, so it never reaches the h2 stream. D-5's 1024 cap, settled after R-2 was locked, makes the memory end() holds bounded, not unbounded. | pending user |
| P-2 | 3 | D-2 | server-call.js:121-124,152-156 and server-interceptors.js:736-749: neither destroy nor the status-error path tears down a zero-window stream out-of-band, so D-2's 'without flushing' premise is false for both options. destroy strands recovered clients (useReconnectingStream.ts:46-63). | pending user |
| P-3 | 3 | D-6 | Same source as above. The step-4 teardown call.destroy(err) is predicted to send no trailers or RST. Proposed replacement: emit('error', {code:8}), grpc-js's own server-stream status path (server.js:106-107), or end() (proposer). | pending user |
| P-4 | 3 | D-7 | notify pins ^1.14.7 (package.json:21, pnpm-lock.yaml:1165), not the 1.14.5 the report used. D-7's pass condition (c) close/RST is predicted to fail by source, so it would need the teardown-matched condition (g) instead. | pending user |
| P-5 | 4 | D-2 | Proposer r4: grpc-js 1.14.7 server-call.js:121-124, :152-156 show neither option tears down a zero-window stream out-of-band. Same evidence as P-2; merge into P-2. | dropped (evidence not new) |
| P-6 | 4 | D-6 | Proposer r4: server-call.js:108-164 has no _destroy, so destroy() sends no trailers or RST; replace step 4 with emit('error', {code: 8, details}). Same evidence as P-3; merge into P-3. | dropped (evidence not new) |
| P-7 | 4 | R-2 | Proposer r4: D-5's 1024 cap bounds what end() holds, and the status path calls end() internally (server-call.js:123). Proposed lock wording: bare end()/OK stays rejected; the internal end() via emit('error') is permitted. Same evidence as P-1; merge into P-1. | dropped (evidence not new) |
| P-8 | 4 | D-7 | Proposer r4: notify pins ^1.14.7 (package.json:21); spike on 1.14.7 only with pass (a)+(f)+(g), (e') recorded, (c) dropped. Same evidence as P-4; merge into P-4. | dropped (evidence not new) |
