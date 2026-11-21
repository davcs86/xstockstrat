# Context Log: fix-notify-stream-contract

> Distilled 2026-11-21 by /sdd-distill. Full pre-distill session prose is in git history (before this commit).
> LINE CITATIONS: `debate.md`, `design.md` and `implementation-spec.md` cite this file by pre-distill line number (e.g. `context.md:581-708`, `:612-613`, `:621`, `:624`, `:672-682`). The spike session ("D-7 spike results") is kept verbatim and contiguous, so every such cite shifts by one constant offset: old line 581 is now line 246, so new line = old line - 335 for any cite inside lines 581-709 of the old file.

Append-only except for /sdd-distill rewrites. Each session appends a new ## Session entry.
Register of record: `debate.md` (D-1..D-21, R-1..R-12, O-1..O-14, P-1..P-8); approved approach: `design.md`.

---

## Decisions

- **Scope**: two SEV-3 defects clustered on the StreamAlerts fan-out path (`persistAndBroadcast`, called by `emitAlert` and `emitInternalAlert`; `matchesSubscriber`): severities type/runtime mismatch (AC-1) and stream ignoring backpressure (AC-2). Single service `xstockstrat-notify`; no proto, migration or config-key change. Track C. Branch `feature/fix-notify-stream-contract`.
- **Step 1, AC-1 (D-1)**: `StreamSubscriber.severities` becomes `AlertSeverity[]`; string compare kept (NOTIFY-1); positive AC-1 test; numeric fixtures to string-enum form (C-13); retire severity records and flip the report sidecar. AC-1 cannot be red on the unfixed tree (runtime compare is already string-vs-string): Step 2 of the spec carries a mutation red (never committed); Step 3 records "red N/A - no behavior change (type-only)" (`tdd-gate.md:55-58`).
- **Step 2, AC-2 detection (D-5, D-4)**: `sub.call.writableLength >= MAX_QUEUED_ALERTS` (code constant 1024 messages, no typeof guard) checked before write, inside the `matchesSubscriber` branch; the evicting alert is neither written nor counted in `deliveredCount`. Code constant (not config key `notify.stream.max_subscribers`, R-3; fails.md:2699-2701: a config key needs a seed migration); memory-safety bound, no operator tuning (product-spec anticipated a config key - recorded F-07 trade-off; a separate feature if operators want to tune). Fallback (b), a consecutive-false counter, applies only if `writableLength` is not a live depth (it is: spike). R-1: a drain-event listener rejected (unverified event, F-04).
- **Step 2, eviction (D-6 as reopened, D-10, D-12..D-16; R-2, R-6, R-8..R-11)**: all synchronous: map delete, `recordStreamEviction('backpressure')`, warn log, then `try { sub.call.emit('error', { code: 8, details: 'slow consumer evicted' }) } catch { log.warn(...) }` (bare numeric 8, no grpc import, D-13/R-9; catch logs, no empty catch, D-10). Delete-before-emit is load-bearing: one write after the emit raises `ERR_STREAM_WRITE_AFTER_END` and no status is ever sent. Rejected: `call.destroy(err)` (grpc-js 1.14.7 `ServerWritableStreamImpl` has no `_destroy`: sends no trailers/RST, strands the recovered client, drops the 1023 queued alerts; R-10), bare `call.end()` with/without metadata (reports grpc-status 0 OK, false clean finish on an endless stream; R-11), map-delete-only (client never told, never reconnects: `useReconnectingStream.ts:46-63`; R-6), private h2 internals / hard-kill timer (R-4, R-8, F-04), exact pin of grpc-js 1.14.7 (R-12: diverges from platform `^1.14.7`, blocks security patches), heap growth as pass criterion (R-7, GC-noisy), execute-time verification gate instead of the spike (R-5). Both `'error'` and `'cancelled'` listeners act only when `Map.delete` returns true (D-14, D-16): our own emit counts no `stream_error`, and an evicted subscriber is not logged as a disconnect (the status path emits `finish`, `cancelled`, `close`). `StreamEvictionReason` gains `'backpressure'`, no new instrument; notify `CLAUDE.md` reason list updated in the same step (D-3). AC-2 Given amended in the same step to "a StreamAlerts subscriber whose stream has 1024 alerts queued and unwritten" (D-8; wording is a spec assumption). Retire backpressure records and flip both report sidecars `triaged` -> `resolved` with the ref kept (D-8).
- **AC-2 tests (D-12, D-21, O-14)**: mock test: emits 1-1024 written, no eviction; emit 1025 writes nothing, removes the entry, `backpressure==1`, `stream_error==0`, `emit` called once with `'error'`, integer code 8, string details, subscriber already absent from the map (spy invokes any registered `'error'` listener); emit 1026 leaves write total 1024; invoking the recorded `'cancelled'` listener changes nothing and logs no disconnect; a throwing `emit` still lets EmitAlert succeed (@AC-5); AC-32 `write_error` test unchanged. Plus a real-grpc-js test (operator ruling, answers O-14) in `notifyServiceImpl.test.ts` (in-process server, paused raw `node:http2` client) covering spike conditions (f) and (g); do not assert the spike's exact eviction attempt 1088 (depends on the h2 window); no hardcoded port; 10-run local repeat check, a flaky result is reported, never fixed by widening a bound/retry/skip.
- **Step 0 / spec Step 1 branch-sync gate (D-19)**: eviction step does not start until the branch is synced with main-dev, `services/xstockstrat-notify/package.json` reads `^1.14.7` and the root `pnpm-lock.yaml` importer block for notify shows grpc-js 1.14.7. Spike ran on 1.14.7 only (1.14.5 not installed). Spec Step 1's merge commit is exempt from the per-step file list (F-08) with three checks (two parents; `git diff origin/main-dev HEAD --stat` shows only this feature's directory and `fails.md`; the `fails.md` resolution dropped no main-dev line).
- **NOTIFY invariant (D-20)**: add `NOTIFY-18` (last rule `NOTIFY-17`, `services/xstockstrat-notify/docs/context-constitution.md:29`): the status path relies on grpc-js's server-stream `'error'` -> `end()` -> `_final` -> `sendStatus` chain, verified on 1.14.7 only; a grpc-js bump must re-run the spike. Step 8 re-checks the lockfile version before writing the row (P-03). The two gotchas recon/D-8 cite at `context-constitution.md:30/:31` no longer exist on main-dev, so the spec retires only findings rows (`context-constitution-findings.md:24,:37,:72,:73`) and the `CLAUDE.md:4` banner mention.
- **Spec shape (8 steps)**: Step 1 = design "Step 0" (branch sync, category docs, numbered 1); Steps 2-4 = design "Step 1" (AC-1; Steps 2 and 3 not atomic); Steps 5-8 = design "Step 2" (AC-2): 5+6+7 one atomic unit (mock tests, real-grpc-js test, eviction), Step 8 docs (NOTIFY-18, records). Step 5 moves `withLogs` from `fanout.test.ts:243-256` to `src/__tests__/fixtures/withLogs.ts`; notify has no `node:http2` use today. Anchors at `fb52065c`: `severities: number[]` `:31`, listeners `:174-181`, filter `:392`, `StreamEvictionReason` `telemetry.ts:380`, loop `notifyServiceImpl.ts:122-133`. Constitution touched: C-05, C-11, C-13, C-15, C-16, C-18, F-04, F-07, P-02, P-03, NOTIFY-1, PLAT-N1; no Floor breaches. C-16: two EXTENDs (@AC-2 Given amendment; @AC-32 gains `backpressure`) without a separate operator ruling; PRESERVE @AC-1 (316), @AC-4 (notify-external-fanout), @AC-5 (pwa-notifications), @AC-1 (fix-push-untargeted-broadcast).
- **Spike verdict (full evidence kept verbatim in the D-7 spike session below; D-17/D-18)**: only `emit('error', {code: 8, details})` gives a recovered client the queued alerts then retryable RESOURCE_EXHAUSTED; `destroy()` strands it; no candidate frees the stalled stream's 1024-message queue before the peer reads or cancels. D-7's original pass condition FAILED ((c)); the operator-reopened teardown-matched condition (a)+(f)+(g) PASSES on 1.14.7. Post-teardown observation is `call.writableEnded === true` and `call.errored === null` (`writableErrored` does not exist in Node, D-18).

### Operator decisions (binding, recorded 2026-11-20, verbatim)

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

## Open Threads

- [ ] Operator acceptance at the /sdd-execute Phase-2 confirmation of spec Step 1's merge exception. The "168 commits behind main-dev" premise is now stale: the branch was synced (merge commit c0f0757b, package.json already `^1.14.7`); re-verify the lockfile importer block shows 1.14.7, and the Step 1 verification checks (two parents; diff stat limited to this feature's directory and `fails.md`; no main-dev line dropped from `fails.md`) apply to that merge.
- [ ] Step 2 mutation red (three command outputs in context.md and the PR body, mutation fully reverted before commit) and Step 3 "red N/A" note exist only as /sdd-execute records; nothing in CI checks them (P-03) - write before marking `done`.
- [ ] Step 6 may be flaky in CI (timing-dependent; notify's first `node:http2` use); 10-run local repeat lowers but does not remove the risk. Then CI on the integration PR.
- [ ] Status path depends on grpc-js's own `'error'` listener, verified on 1.14.7 only; `^1.14.7` lets a lockfile refresh float to a newer 1.x without re-running the spike; if grpc-js drops/renames `writableLength` eviction silently fails open (Step 6 condition (f); Step 8 NOTIFY-18).
- [ ] Rebase-only overlaps: 312 (`spec-ready`, `notifyServiceImpl.ts` `listAlerts`), 337 (`in-progress`, `telemetry.ts`, `fanout.test.ts`; live overlap via Step 7's `StreamEvictionReason` widening), 323 (`spec-ready`, notify `CLAUDE.md:4` banner also edited by Step 4 - likely textual conflict); `merge-order.md` has no row for 316; whichever merges second re-greps. No evidence 324 touches a notify file (design.md Open Risks names it) - re-check once 324 has an implementation spec (it does now; its spec edits the four leaf `package.json` files incl. notify `package.json`, different lines). 334 (launched) and 329 (already in `fb52065c`) are absorbed by Step 1.
- [ ] If `origin/main-dev` moves past `fb52065c`, spec line numbers drift: re-grep each anchor by symbol at /sdd-execute Phase 1.
- [ ] Step 7 touches four files (two code, `CLAUDE.md`, `acceptance.feature`) - within threshold, left as is; reviewer of Step 7. `CLAUDE.md:125` (not `:115`) holds the reason list Step 7 edits.
- [ ] Register hygiene: O-10, O-13, O-14 read `open` in debate.md though answered (O-14 = Step 6, D-20 invariant = Step 8, O-10 = design.md Accepted residuals).
- Accepted residuals (no step; O-5, O-10): an evicted stream's queue (up to 1024 x largest alert + h2 window) is held until peer reads/cancels, invisible to the subscribers gauge, nothing logs when finally freed, no keepalive (`src/index.ts:48`), linear in stalled streams, limited by mTLS to authorised peers; per-stream bound scales with alert size (`req.context` is free-form); lazy detection for a filtered stalled subscriber; alerts emitted between eviction and reconnect are lost (no ListAlerts catch-up). No instrument added (C-18).

## Files Modified

- none yet - no /sdd-execute step has run. Planned (implementation-spec.md): `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts` (+ `telemetry.ts` reason union), `src/__tests__/notifyServiceImpl.test.ts`, `src/__tests__/fanout.test.ts`, `src/__tests__/fixtures/withLogs.ts`, notify `CLAUDE.md`, `docs/context-constitution.md` (`NOTIFY-18`), `acceptance.feature` (AC-2 Given), findings rows, both report `.status` sidecars.

## Superseded Sessions

- 2026-11-10 (/sdd-triage): two defect reports clustered on the StreamAlerts fan-out path; root-cause hypothesis hand-typed numeric severities predating stringEnums, fan-out discards `write()`'s false return; depth quick -> raised to full by the review (overlap with 312/323/324 on notify).
- 2026-11-10 (sdd-review product-spec): approved, draft -> spec-ready. Warnings: bug-template conventions, backpressure threshold key contract deferred, AC-2 threshold not concrete and Then allows two policies. Overlap WARN: notify shared with 312, 323, 324.
- 2026-11-11 (sdd-batch design gate round 2; halted at gate): designed D-5..D-8 and the pre-spec spike D-7 (scratch grpc-js 1.14.5 server + paused raw http2 client, observations (a)-(e), pass (a)(b)(c) and not (e)); closed O-3..O-5; opened blocking O-1/O-2; locked R-4, R-5. Fence dropped as superseded (register recoverable from debate.md).
- 2026-11-13 (sdd-batch design gate round 3; halted): source finding on installed grpc-js 1.14.7: objectMode Writable with no `_destroy` (server-call.js:108-164) so `destroy(err)` predicted to send no trailers/RST and the client never reconnects; recommended `emit('error', {code: 8})` (server.js:106-107, retryable via streamBackoff.ts:18) over `end()`/OK; opened blocking O-8 (operator ruling on P-1..P-4) and D-9 spike additions (e'), (f), (g); closed O-2 (objectMode: `writableLength` counts messages), O-6, O-7; locked R-6, R-7. Fence dropped as superseded.
- 2026-11-20 (sdd-batch design gate round 4; halted): no reopen applied (steer appeared only in computed task text, no operator ruling on record); P-5..P-8 dropped as not new; D-11..D-14, R-8, R-9; closed O-9, O-11; opened O-12. Fence dropped as superseded.
- 2026-11-20 (sdd-batch design gate round 5; halted at gate): settled D-15..D-21, R-10..R-12, opened O-13/O-14, closed O-1, O-8, O-12, marked D-2/D-6/D-7/R-2 reopened; the Open Threads approach of this round is carried in Decisions above. Last design state (the only `sdd-batch-design-state` fence in this file, last in file):


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

- 2026-11-20 (sdd-design, approved): recon.md written; 5 full rounds, approved at the gate (adversary SOUND, no Floor breach, no blocking objection); chosen approach, rejected alternatives and operator rulings are in Decisions above (verbatim). Status spec-ready -> design-approved.

- 2026-11-20 (D-7 spike results, grpc-js 1.14.7) is kept verbatim below: it is the only copy of the empirical evidence (scratch harness `.sdd-logs/spike-316/spike.cjs` was git-ignored and never committed).

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

## Session 2026-11-21 — /sdd-distill

- Distilled 10 sessions -> header + Superseded Sessions; kept 3 verbatim.
- context.md 1025 -> 448 lines (118771 -> 58998 bytes). Original prose preserved in git history.
- Kept verbatim: the D-7 spike results session (sole copy of the spike evidence; cited by line from debate.md, design.md, implementation-spec.md), sdd-spec and sdd-review impl-spec. Dropped the superseded round-2..round-4 `sdd-batch-design-state` fences (recoverable from debate.md and the round-5 fence); the round-5 fence is the sole, last fence, byte-identical.
- Branch note: the feature branch was synced with main-dev (merge commit c0f0757b) before this distill; the '168 commits behind' premise in the kept sessions is stale.