# Design: fix-notify-stream-contract

**Created**: 2026-11-20
**Rounds**: 5 (full; termination: approved)
**Approved by**: operator @ 2026-11-20, under the standing authorisation recorded the same day (context.md:32, § Decisions › Operator decisions, "Standing authorisation"; the former "Session 2026-11-20 — sdd-design" section was folded into Decisions by distill 4a4d9f13). The round-5 adversary verdict was SOUND, with no Floor breach and no blocking objection.
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

Two code steps and one precondition, all inside `services/xstockstrat-notify`. There is no proto, migration or config-key change (recon.md:78-84). The change is internal-only: `StreamAlerts` keeps its contract, and the one client-visible difference is that an evicted slow consumer now receives a terminal `RESOURCE_EXHAUSTED` status, which the UI's existing reconnect path already handles (D-2 evidence, `useReconnectingStream.ts:46-63`).

Line numbers below are recon's (tree `c4fd48b0a`, recon.md:5). They have drifted since; `/sdd-spec` must re-grep (see Open Risks).

### Step 0: branch sync precondition (D-19)

- `feature/fix-notify-stream-contract` still pins `@grpc/grpc-js` `^1.14.5` (lock 1.14.5). `origin/main-dev` has `^1.14.7` (lock 1.14.7). The spike ran on 1.14.7 only (context.md:253-255).
- Sync the branch with `main-dev` before the eviction step starts.
- Pass condition: `services/xstockstrat-notify/package.json` reads `^1.14.7`, and the `services/xstockstrat-notify` importer block in the root `pnpm-lock.yaml` shows `@grpc/grpc-js` with `version: 1.14.7`.
- If either check fails, `/sdd-execute` does not start the eviction step.

### Step 1: severity typing, AC-1 (D-1)

- Type `StreamSubscriber.severities` as `AlertSeverity[]` (recon.md:18, currently `number[]`). Import `AlertSeverity` the way `src/fanout/fanout.ts:6` does (recon.md:33, :56).
- Keep the registration line and the string-vs-string compare unchanged (recon.md:27, :31). NOTIFY-1 requires the fan-out to keep the string form (recon.md:56).
- Add the positive AC-1 test through `streamAlerts` + `emitAlert`: a subscriber filtered to WARNING and CRITICAL receives a CRITICAL alert and does not receive an INFO alert (recon.md:60-61).
- Convert the numeric severity fixtures to string-enum form, using the test file's own helpers (recon.md:48, :51, :64; C-13).
- Retire the severity-mismatch records and flip that report's sidecar (recon.md:96-99).

### Step 2: bounded queue with a status-path eviction, AC-2 (D-5, D-15, D-16)

**Detection (D-5).**

- Module constant `MAX_QUEUED_ALERTS = 1024`, in messages.
- In the `emitAlert` loop, inside the `matchesSubscriber` branch and before the write (recon.md:24), check `sub.call.writableLength >= MAX_QUEUED_ALERTS`.
- The evicting alert is neither written nor counted in `deliveredCount`.
- The spike confirmed that `writableLength` is a number and a live depth in messages, 1024 at the eviction (context.md:286).

**Eviction (D-15).** All synchronous, reusing the eviction idiom at recon.md:25 and :57:

1. `this.subscribers.delete(subId)`
2. `recordStreamEviction('backpressure')`
3. `log.warn('StreamAlerts subscriber evicted', { reason: 'backpressure' })`
4. `try { sub.call.emit('error', { code: 8, details: 'slow consumer evicted' }) } catch { log.warn(...) }`
5. `continue`

- The code is the bare numeric `8` with no grpc import (D-13, R-9).
- The stream ends with `grpc-status: 8` after flushing at most the capped queue (context.md:277-278).
- The map delete must come before the emit. The spike showed that one write after the emit raises `ERR_STREAM_WRITE_AFTER_END`, and then no status is ever sent (context.md:288).
- The teardown is never `call.destroy()` and never a bare `call.end()` (R-10, R-11).
- The existing write call and its `write_error` catch are unchanged.

**Listeners (D-3, D-14, D-16).** Both listeners at recon.md:28-29 act only when `Map.delete` returns true.

- `'error'`: `if (this.subscribers.delete(subId)) recordStreamEviction('stream_error')`. Our own emit therefore counts no `stream_error`.
- `'cancelled'`: the disconnect log runs only when the delete removed an entry. On the status path the server emits `finish`, `cancelled`, `close` (context.md:289), so without the guard an evicted subscriber would be logged as a disconnect.

**Telemetry, docs and records.**

- Widen `StreamEvictionReason` with `'backpressure'` (recon.md:35, :58). No new instrument is added.
- Update the `reason` list in notify `CLAUDE.md` § Observability in the same step (recon.md:69).
- Amend the AC-2 Given in this feature's `acceptance.feature` to the queued-write-length trigger. Retire the backpressure records and flip both report sidecars (D-8).
- Add a `NOTIFY-*` invariant to `services/xstockstrat-notify/docs/context-constitution.md` (D-20). It records three things:
  - the status-path teardown relies on grpc-js's own server-stream `'error'` listener chain: `'error'` → `end()` → `_final` → `sendStatus` (1.14.7 `server-call.js:121-124`, `:152-156`);
  - the chain was verified on 1.14.7 only;
  - a grpc-js bump must re-run the spike.

**AC-2 unit test (D-12, D-21).** Mock shape from the feature-294 eviction test (recon.md:52, :60).

- Mock: `on()` records listeners. `emit()` is a spy that records its argument, captures that the subscriber is already absent from the map, then dispatches to the recorded listeners. `write` returns false and increments `writableLength`.
- Emits 1-1024: 1024 writes and no eviction.
- Emit 1025: no write; the entry is gone; `evictions{backpressure} == 1`; `evictions{stream_error} == 0`; `emit` is called once with `'error'`, integer code 8 and string details.
- Emit 1026: the write total stays 1024.
- Invoking the recorded `'cancelled'` listener after eviction changes nothing and logs no disconnect.
- Negative case: `writableLength` stays 0 while `write` returns false, and nothing is evicted.
- Throwing `emit`: `EmitAlert` still succeeds and the warning is logged (`@AC-5`).
- The `@AC-32` `write_error` test is unchanged.

**Real-grpc-js test (operator ruling, round 5; answers O-14).** The spike's `emit('error')` case is also committed as a test in notify's `node --test` suite that uses real grpc-js: an in-process server and a paused raw `node:http2` client. It asserts the two spike conditions:

- (f) with the client paused, `writableLength` stays ≤ 1024 and no write runs after eviction;
- (g) after resume, the client gets the queued alerts, then `grpc-status: 8`, with counters `backpressure=1` and `stream_error=0`.

This is the automated check that catches a grpc-js upgrade breaking the status path. The unit mock above cannot, because it re-implements the listener chain.

### Spike result the design rests on (D-17, D-18)

- D-7's pass condition, as resettled, is (a) + (f) + (g) on grpc-js 1.14.7, with (e') recorded and (c) dropped. All three hold (context.md:295-307).
- grpc-js 1.14.5 was not exercised (context.md:255). Step 0 is the mitigation.
- Right after the teardown, `call.writableEnded === true` and `call.errored === null`. `writableErrored` does not exist in Node (context.md:290).

### Why the cap is a code constant (F-07, D-4)

The cap is a memory-safety bound with no operator tuning, so it is a code constant. A config key would need a seed migration in `xstockstrat-config` (recon.md:81, :103) and adds nothing the fix needs. `notify.stream.max_subscribers` stays out of scope (recon.md:82, :88).

### Accepted residuals (O-5, O-10)

- **Held queue after eviction.** An evicted stream's queue is held until the peer reads or cancels: up to 1024 alerts plus the h2 window. The spike confirmed this for every teardown candidate (context.md:281-282).
- **No visibility.** That held queue is invisible to the `notify.stream.subscribers` gauge, because the entry is already out of the map. With the guarded `'cancelled'` listener, nothing logs when the queue is finally freed. No instrument or log is added for it (C-18).
- **No keepalive.** notify sets none (`src/index.ts:48`). Exposure is linear in stalled streams and limited by mTLS to authorised peers.
- **Lost alerts.** Alerts emitted between eviction and reconnect are lost from the live view. Reconnect does not page history.
- **Bound scales with alert size.** The per-stream bound is 1024 × the largest alert, because `req.context` is free-form.
- **Lazy detection.** A stalled subscriber filtered to rare severities or categories keeps its queue until the next alert that matches it.

## Rejected Alternatives

- `R-1` A drain-event listener used to reset a backpressure counter — rejected because the event was unverified (F-04) and adds state; queue length covers it without an event.
- `R-3` Enforcing a `stream.max_subscribers` config key in this fix — rejected because it is new capability needing a C-05 seed migration, and is not needed once per-stream buffers are bounded.
- `R-4` Closing the h2 stream via grpc-js private internals (`Http2Stream.close` with `NGHTTP2_CANCEL`) — rejected because it breaks on upgrade and violates F-04.
- `R-5` An execute-time verification gate inside Step 2 in place of a pre-spec spike — rejected because the spec would commit to an unverified API with no fallback.
- `R-6` Map delete only on eviction, with no teardown call — rejected because the client is never told, so it never reconnects.
- `R-7` Server heap growth as the spike's eviction pass criterion — rejected because it is GC-noisy; `writableLength` ≤ 1024 with no post-eviction write is the deterministic check.
- `R-8` `emit('error')` teardown plus a hard-kill timer that drops the connection when no finish or cancel arrives — rejected because every hard-kill path goes through the private internals that R-4 locks.
- `R-9` Importing grpc into `notifyServiceImpl.ts` to use `grpc.status.RESOURCE_EXHAUSTED` — rejected because it contradicts the recorded house style; bare `8` matches the file.
- `R-10` `call.destroy(err)` as the eviction teardown — rejected because on grpc-js 1.14.7 it sends no trailers and no RST, strands the recovered client with no status, and drops the 1023 queued alerts (context.md:277-278, :299).
- `R-11` Bare `call.end()`, with or without trailing metadata, as the eviction teardown — rejected because it reports `grpc-status: 0` OK, a false clean finish on an endless push stream (context.md:277-278). The internal `end()` reached through `emit('error')` is permitted.
- `R-12` An exact pin of `@grpc/grpc-js` 1.14.7 for notify — rejected because it diverges from the platform-wide `^1.14.7` and blocks security patches; the Step 0 lockfile check and the NOTIFY invariant cover the risk.

`R-2` (`call.end()` as the eviction teardown) is not listed: the operator reopened it at round 5, and `R-11` is its amended form.

## Open Risks

- [ ] The feature branch still pins `@grpc/grpc-js` `^1.14.5` (lock 1.14.5), which the spike never exercised. The fix must not land before the branch is on 1.14.7 — to be addressed at Step 0 (branch sync gate).
- [ ] The status path depends on grpc-js's own `'error'` listener behaviour, verified on 1.14.7 only. A later grpc-js that changes it would strand recovered clients as `destroy()` does — to be addressed at Step 2 (NOTIFY invariant and the real-grpc-js test).
- [ ] The caret range `^1.14.7` lets a later lockfile refresh float to a newer 1.x without re-running the spike — to be addressed at Step 2 (the real-grpc-js test runs in CI on whatever version the lockfile resolves).
- [ ] If a grpc-js upgrade drops or renames `writableLength`, eviction silently fails open, because `undefined >= 1024` is false — to be addressed at Step 2 (the real-grpc-js test's condition (f) fails in that case).
- [ ] An evicted stream's queue (up to 1024 alerts plus the h2 window) is held until the peer reads or cancels, with no gauge or log visibility and no keepalive — accepted residual; no step addresses it.
- [ ] The per-stream memory bound scales with alert size, because `req.context` is free-form — accepted residual.
- [ ] Detection is lazy: a filtered, stalled subscriber keeps its queue until the next matching alert — accepted residual.
- [ ] Alerts emitted between eviction and reconnect are lost — accepted residual (O-5).
- [ ] Line references have drifted from recon (for example `telemetry.ts:322` is now `:380`, and the filter at `:288` is now `:392`) — to be addressed at `/sdd-spec` (re-grep every citation).
- [ ] `notifyServiceImpl.ts` and `telemetry.ts` may conflict with features 312, 323 and 324 (recon.md:104) — to be addressed before `/sdd-execute` (check `merge-order.md`).

## Constitution Rules Touched

- `C-05` — honored by: no config key is added; the cap is a code constant, and `notify.stream.max_subscribers` stays out of scope (R-3).
- `C-11` — honored by: this bug fix went through triage, product-spec review and a full 5-round design debate before any code.
- `C-13` — honored by: tests use the notify test file's own helpers (`makeImpl`, `REQ`, `makeAlert`), and the numeric severity fixtures move to string-enum form there (recon.md:64).
- `C-15` — honored by: AC-1 and AC-2 each get a test; the AC-2 Given is amended in the same step as the trigger it describes; the real-grpc-js test covers spike conditions (f) and (g).
- `C-16` — honored by: every affected `@AC-*` is listed below as PRESERVE or EXTEND. No guarantee is broken, so there is no CHANGE line.
- `C-18` — honored by: one constant, one widened union and one guarded listener pair; no new instrument, no config key, no hard-kill timer, and the teardown catch logs a warning instead of swallowing.
- `F-04` — honored: the teardown API and `writableLength` were verified by the spike on real grpc-js 1.14.7 before `/sdd-spec` (context.md:246-373); no private grpc-js internals are used (R-4, R-8).
- `F-07` — honored: the cap is a memory-safety bound, not an operator-tunable config value, so no config value is hardcoded in place of a key (D-4).
- `P-02` — honored by: proposer and adversary saw only the orchestrator's synthesized state in every round.
- `P-03` — honored by: the failed D-7 pass condition went back to the operator through petitions P-1..P-4 instead of being worked around.
- `NOTIFY-1` — honored by: the fan-out filter keeps the string wire form; only the TypeScript type changes.
- `PLAT-N1` — honored by: eviction never fails or delays `EmitAlert`; the teardown sits inside `try` with a `log.warn` catch.

## Business Rules Touched (C-16)

There is no CHANGE line. The operator-decision reference for the one EXTEND that alters client-visible behaviour is given on its line.

- PRESERVE `@AC-1` "a severity-filtered subscriber receives alerts matched by the string enum form" (`docs/roadmap/features/316-fix-notify-stream-contract/acceptance.feature`) — not regressed by: the string compare is unchanged and the positive test is added.
- EXTEND `@AC-2` "a subscriber whose stream stops draining is evicted" (`docs/roadmap/features/316-fix-notify-stream-contract/acceptance.feature`) — new case added: the evicted client receives a terminal `RESOURCE_EXHAUSTED` status after the capped queue flushes, via `emit('error')`. Covered by the operator ruling of 2026-11-20 that granted petitions P-1..P-4 (context.md:27-30, § Decisions › Operator decisions, "Reopen ruling"; the former "Session 2026-11-20 — sdd-design" section was folded into Decisions by distill 4a4d9f13).
- EXTEND `@AC-2` (same scenario) — new case added: the Given is amended to the queued-write-length trigger (D-8). No separate operator ruling; it narrows the scenario to the mechanism the ruling approved.
- EXTEND `@AC-32` "A failed stream write evicts the subscriber visibly" (`services/xstockstrat-notify/acceptance/signal-map-instrumentation.feature`) — new case added: eviction reasons gain `backpressure`, and `stream_error` is counted only when the listener removes the entry. The `write_error` case and the gauge are unchanged. No separate operator ruling.
- PRESERVE `@AC-4` "A Slack webhook timeout does not delay or drop the primary stream" (`services/xstockstrat-notify/acceptance/notify-external-fanout.feature`) — not regressed by: the order of the primary stream and the `queueMicrotask` side-channels is unchanged.
- PRESERVE `@AC-5` "Push dispatch never fails or delays the primary emit" (`services/xstockstrat-notify/acceptance/pwa-notifications.feature`) — not regressed by: the eviction is synchronous and its teardown is inside `try`; a throwing `emit` still lets `EmitAlert` succeed, and a test asserts it.
- PRESERVE `@AC-1` "An untargeted alert is not Web-Pushed to any non-admin user's devices" (`services/xstockstrat-notify/acceptance/fix-push-untargeted-broadcast.feature`) — not regressed by: in-process StreamAlerts subscribers below the cap still receive an untargeted WARNING alert.
