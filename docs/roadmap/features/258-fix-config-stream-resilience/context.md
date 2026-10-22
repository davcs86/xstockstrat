# Context Log: fix-config-stream-resilience

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-config-stream-resilience-defect.md` (Issues disabled),
  sidecar `triaged` / `ref: feature:258-fix-config-stream-resilience`.
- Source: repo-surveyor debt-radar scan (`docs/repo-surveyor/debt-radar-findings.md` @ 4535695), findings
  D-05, D-06 (config `getConfig` + `setConfig` sites and the ledger `pool.connect` site), D-35, D-58.
- Severity: SEV-2 (group). D-58 was rated one level lower on its own by the surveyor; grouped here because it shares
  the "end the call so the client reconnects" fix contract with D-35. Impact type: stale-config-and-hung-rpc.
  Environment: dev (main-dev) @ a053b0e. Config-only: no.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2
  (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..8), context.md.
- Affected services: xstockstrat-config, xstockstrat-ledger.
- Root cause hypothesis: config assumes the DB is always available — LISTEN client lacks ledger `EventNotifier`'s
  error/end/reconnect handling; stream error paths drop or never register subscribers without ending the call;
  three handlers await before `try`.
- All four D-ids reproduce on a053b0e. Line drift vs the scan: none — D-05 `configServiceImpl.ts:164-172`, D-06
  `:319` / `:447-462` / ledger `ledgerServiceImpl.ts:74`, D-35 `:305-312`, D-58 `:264-271` (scan cited `:268-271`
  for the catch). Reference pattern: `services/xstockstrat-ledger/src/services/eventNotifier.ts:74-78`.
- **Overlaps:**
  - `241-fix-config-audit-author-spoof` (implementation-ready) edits `setConfig` in the same file
    (`configServiceImpl.ts`, author handling around `:410`) — D-06's setConfig fix wraps `:447-462`; rebase/sequence
    against 241 before the integration PR.
  - `248-fix-ledger-trimmed-notify-payload` (implementation-ready) edits `ledgerServiceImpl.ts` (StreamEvents /
    notifier paths), not `appendEvent`; textual merge risk only.
  - `252-fix-identity-ledger-test-suites` (implementation-ready): the ledger unit suite currently early-returns on a
    failed lazy import, so a ledger AC-5 test may not actually run until 252 lands — sequence 252 first or verify
    the new test executes (red-before-green, P-06).
  - Resolved `2026-10-03-node-configwatcher-stream-doubling-defect` (`69c8554`) fixed the client-side reconnect path
    that D-35/D-58's server-side fix depends on.
- Design forks to settle: re-snapshot strategy on LISTEN reconnect (`reloadAll` + broadcast to all vs per-namespace);
  D-35 ordering (register-then-snapshot vs version check); gRPC status for DB failures (`UNAVAILABLE` vs `INTERNAL`);
  reconnect-storm trade-off on a DB outage (clients already back off).
- Recommended design depth: full → `/sdd-design fix-config-stream-resilience` (rationale: SEV-2 with 2 affected
  services, the C-0 full trigger; no proto/migration).
- Development branch: feature/fix-config-stream-resilience

## Session 2026-10-21 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria verdict: PASS WITH WARNINGS (0 fails, 0 floor breaches).
- Warnings:
  - C-15 (criterion 8): AC-2 and AC-8 asserted "the error is logged". **Resolved:** both now assert a captured
    error-level log record carrying the rejection message (observable outcome).
  - FR-3 coverage for `setConfig` exercised only the existence-gate query (AC-4). **Resolved:** added AC-11 (the
    `config.config_values` INSERT/UPDATE rejects after the gate passes → gRPC error status, no unhandled rejection).
  - AC-7 is non-deterministic as worded ("first SNAPSHOT or a following DELTA"). Open for /sdd-design: pin the
    interleaving (e.g. a controlled promise on the snapshot SELECT) once the D-35 ordering is chosen.
  - FR-1 gives no reconnect bound; AC-1/AC-9 cannot be timed deterministically until /sdd-design fixes the backoff
    constants. Not a blocker.
  - No Open Questions section; the design forks are recorded in the triage session above (re-snapshot strategy on
    reconnect: `reloadAll()` + broadcast every namespace vs per-namespace; D-35 ordering; `UNAVAILABLE` vs
    `INTERNAL`; reconnect-storm trade-off). /sdd-design must settle them explicitly (C-11).
- Overlap findings (level WARN, file-level only; no migration, proto field or config-key collision):
  - `configServiceImpl.ts` SetConfig — same function as `241-fix-config-audit-author-spoof` (gate :386, owner
    branch :394, attribution :410-414, :513; implementation-ready). Manual merge, not mechanical rebase.
  - `configServiceImpl.ts` GetConfig :319 — direct line overlap with `263-fix-edge-owner-scope` (config reads
    :317-319; draft).
  - `ledgerServiceImpl.ts` — disjoint functions vs `248-fix-ledger-trimmed-notify-payload` (StreamEvents,
    rowToEvent), `257-fix-ledger-query-pagination` (queryEvents, StreamEvents replay) and `263-fix-edge-owner-scope`
    (QueryEvents); rebase-only.
  - Low risk: `272-fix-analysis-backtest-bounds` may read or retire `analysis.backtest.max_duration_seconds`, used
    here only as an AC fixture key; `244-fix-python-config-stored-zero` edits the disjoint SCALAR_BOUNDS_REGISTRY
    region (:99-146); `252-fix-identity-ledger-test-suites` changes the ledger/config test harness AC-5/AC-10 rely on
    (sequence after 252 or verify the tests run); `266-fix-db-tls-fail-closed` changes startup DB wiring that could
    reach the LISTEN client; `259-fix-python-loop-supervision` and the 247/273 agent deadline features consume the
    FR-3/FR-5 error contracts client-side.
  - merge-order: no row references 258; no FAIL-level overlap, so no blocking row. Optional non-blocking
    same-function rows (258 vs 241 SetConfig, 258 vs 263 getConfig) left for /sdd-spec.
- OPERATOR DECISIONS (binding, recorded 2026-10-21):
  - Grouped by service+theme from the 2026-10-20 debt-radar scan; Track C.
  - Scope is D-05, D-06, D-35, D-58.
- Next: `/sdd-design fix-config-stream-resilience`.

## Session 2026-10-22 — sdd-batch design state recovered (round 2)

- The batch run that produced round 2 was cut off by the session usage limit before its gate writer persisted the debate state. This block is the round-2 synthesis restored verbatim from the run journal (`synth:fix-config-stream-resilience:r2`), so the next /sdd-batch run resumes from it instead of redoing the debate.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "The r2 proposal is adopted, with the adversary's blocking reconnect-retry fix and four near-zero-rework fixes folded in. Everything stays inside `ConfigServiceImpl` (services/xstockstrat-config/src/grpc/configServiceImpl.ts) and ledger `appendEvent` (services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:73-118). There is no new class, connection, proto, migration, config key or src/index.ts edit.\n\n1. LISTEN lifecycle (FR-1, FR-2; AC-1, AC-2, AC-9)\n- New private fields next to :156-158: `listener: PoolClient | null`, `connectedOnce`, `reconnectTimer`, `backoffMs`, and `chain: Promise<void> = Promise.resolve()`.\n- `serial<T>(fn)`: `const run = this.chain.then(fn); this.chain = run.then(() => undefined, () => undefined); return run;`. Callers see the real rejection, and the stored tail never rejects.\n- `connectListener()`. The whole body is one try (the r3 fix, mirroring eventNotifier.ts:82-107):\n  - `c = await this.pool.connect()`.\n  - Attach `error` and `end` handlers that call `dropListener(c, e)`, plus the `notification` handler.\n  - Set `this.listener = c`.\n  - `await c.query('LISTEN config_changed')`.\n  - `await this.serial(() => connectedOnce ? this.resyncAll() : this.reloadAll())`. LISTEN now runs before reloadAll on boot as well, which closes the boot lost-notify window at :163-165.\n  - Set `connectedOnce = true` and reset `backoffMs`.\n- Catch in `connectListener()`:\n  - If `c` exists, call `dropListener(c, err)`. dropListener reschedules only when `connectedOnce` is true.\n  - If `c` is undefined (`pool.connect()` rejected) and `connectedOnce` is true, call `scheduleReconnect()` directly.\n  - If `connectedOnce` is false, rethrow, so boot still fails fast and index.ts main() exits.\n- `initialize()` (:162-174) becomes `await this.connectListener()`.\n- `dropListener(c, err)`:\n  - `if (this.listener !== c) return;`\n  - `listener = null`\n  - `c.removeAllListeners('notification')`\n  - `try { c.release(err) } catch {}`\n  - `log.error`\n  - `if (connectedOnce) scheduleReconnect()`\n  - The identity guard means each client is released once, whatever the order of `error`, `end` and resync failure.\n- `scheduleReconnect()` keeps the single-timer guard from eventNotifier.ts:110-117:\n  - It returns early if a timer is already pending.\n  - The timer callback sets `reconnectTimer = null` before calling `connectListener().catch(() => {})`, as at :114. The catch no longer ends the retry loop, because every failure path inside connectListener reschedules for itself.\n  - After scheduling, `backoffMs = min(backoffMs * 2, 30000)`, starting from 1000. There is no jitter, because there is one listener per process.\n  - These values are code constants. An optional `opts.listenerBackoff` constructor argument (:160) may stay for tests; `node:test` mock.timers is an acceptable substitute.\n- `resyncAll()`:\n  - `await reloadAll()` (:176-201), then `broadcastToSubscribers(ns, env)` (:260) once for each distinct (namespace, environment) in `subscribers`.\n  - A reloadAll rejection propagates to connectListener's catch: the client is released once, `connectedOnce` stays true, and a retry is scheduled.\n  - Per-subscriber broadcast failures go to `endSubscriber` and never drop the listener.\n- `onNotification`: a guarded JSON.parse in the eventNotifier.ts:119-137 shape, then `this.serial(async () => { await reloadNamespace(ns, env); await broadcastToSubscribers(ns, env); }).catch(err => log.error('config_changed handling failed', ...))` (AC-2). The shared chain means a stale reloadAll write (:191) can never overwrite a newer reloadNamespace write (:214).\n\n2. Unary handlers (FR-3; AC-3, AC-4, AC-5, AC-10, AC-11)\n- `getConfig`: wrap the DB call at :319 in a try. The catch logs with `log.error` and returns `callback({ code: 13, message })`.\n- `setConfig`: wrap only the gate queries (:447-451, :457-462) in a try with the same catch.\n  - INVALID_ARGUMENT (:422-441), NOT_FOUND (:466-472), PERMISSION_DENIED (:391, :402) and the encryption catch (:490-493) stay outside the new try.\n  - The existing write try (:500-522) is unchanged.\n  - There is no shared helper, and GetSecret (:335-369) is untouched.\n- Ledger `appendEvent`:\n  - Declare `let client: PoolClient | undefined; let failure: unknown;` and move `client = await this.pool.connect()` from :74 to the first line inside the try at :75.\n  - The catch (:112-115) sets `failure = err` and runs `if (client) await client.query('ROLLBACK').catch(() => {})`, keeping its existing log and code-13 return.\n  - The finally (:117) becomes `client?.release(failure instanceof Error ? failure : undefined)`. A client that broke mid-transaction is destroyed rather than returned to ledger's DB_POOL_MAX=1 pool. The success path is unchanged.\n\n3. WatchConfig and broadcast (FR-4, FR-5; AC-6, AC-7, AC-8)\n- `Subscriber.lastVersion` (:93, :302) is replaced by `pending: boolean`, `missedDelta: boolean` and `traceId?: string`.\n  - `traceId` is read once via the existing `first(call.metadata, 'x-trace-id')` helper (the form used at :405), not `call.metadata.get`.\n  - Background broadcast and termination logs carry the originating trace id, per the standing operator decision on C-03.\n- `watchConfig` registers `{ ..., pending: true, missedDelta: false }` before the snapshot read, then:\n  1. Writes the SNAPSHOT only if `this.subscribers.get(subId) === sub`.\n  2. Runs `while (sub.missedDelta && this.subscribers.get(subId) === sub) { sub.missedDelta = false; const d = await this.snapshotForSubscriber(sub, DELTA); if (this.subscribers.get(subId) !== sub) break; call.write(d); }`. Every write is re-guarded after its await.\n  3. Sets `pending = false`.\n  4. Sends any rejection to `endSubscriber(subId, sub, err)`.\n- `broadcastToSubscribers` (:262-271):\n  - A pending subscriber gets `missedDelta = true` and is skipped with `continue`.\n  - A failure calls `endSubscriber` instead of the warn-and-delete.\n- `endSubscriber`:\n  - Starts with `if (this.subscribers.get(id) !== sub) return;`, so a second call does not log twice or destroy twice.\n  - Then runs `delete`, then `log.error` with subId, clientId, traceId and error, then `try { sub.call.destroy({ code: 13, message }) } catch {}`, following ledgerServiceImpl.ts:285.\n  - It is reachable only from the snapshot/catch-up chain and the per-subscriber broadcast catch.\n  - The cancelled/error handlers (:288-294) still only delete, which preserves platform @AC-6 @FR-6 @feature-210.\n\nBuild order\n- Steps 1, 2 and 3 run in sequence because they share one file. Each is paired with tests in configServiceImpl.test.ts. The tests use a FakeClient modelled on ledger eventNotifier.test.ts:27-55, plus a release spy and `makePool` (:30).\n- Test cases:\n  - `error` then `end` gives exactly one release, and LISTEN is re-run.\n  - A reconnect whose `pool.connect()` rejects twice and then succeeds re-broadcasts. This is the new blocking-fix test.\n  - A reconnect whose reloadAll rejects is released once with the error, then a retry succeeds (AC-9).\n  - Interleave: hold reloadAll on a controlled promise, deliver a notification, then resolve. Assert the last snapshot holds the reloadNamespace data and DELTAs arrive in order.\n  - Boot ordering: LISTEN is issued before reloadAll's query.\n  - AC-2: no unhandledRejection.\n  - AC-3, AC-4 and AC-11, plus explicit INVALID_ARGUMENT and NOT_FOUND regression tests.\n  - AC-6 and AC-8: assert the code passed to destroy.\n  - AC-7: SNAPSHOT first, then a catch-up DELTA that carries 600.\n  - Cancel during catch-up: no write after cancel, a single log line, and no destroy.\n- Step 4 (ledger) is independent. Its precondition is concrete: either 252-fix-identity-ledger-test-suites has merged, or the step's first edit removes the `try { import } catch {}` / `if (!impl) return;` shape (ledgerServiceImpl.test.ts:23-26, :145) for the new cases. Verification requires both: AC-5 and AC-10 fail on current code, and the run reports a non-zero assertion count. Add a test that a mid-transaction failure calls release with the error.\n- Step 5 (docs):\n  - config CLAUDE.md \u00a7 WatchConfig Flow and invariant #4: reconnect, LISTEN-before-reload, the serial chain and re-broadcast.\n  - The CONFIG-1 line references.\n  - context.md: the F-07 rationale (config cannot watch itself, invariant #1; ledger hardcodes `reconnectDelayMs` the same way at eventNotifier.ts:35), the half-open limitation, and the stale-namespace-after-outage limitation.\n- The dev `pg_terminate_backend` check is a required Verification item for step 1, not an assumption. keepAlive in index.ts stays out of scope: 266 owns that object, and the user asked for low rework.",
    "open_objections": [
      {
        "text": "[P-03 / FR-1 / AC-9] RESOLVED-PENDING-PROPOSER-CONFIRMATION. `pool.connect()` must run inside connectListener's try. When the client is undefined and connectedOnce is true, the catch must call scheduleReconnect(). The timer callback must clear reconnectTimer before calling connectListener (eventNotifier.ts:114). This needs a test where connect() rejects twice and then succeeds and re-broadcasts. The synthesis folds the fix into the approach; the next proposal must confirm it with path:line placement.",
        "blocking": true
      },
      {
        "text": "[C-18] Read the trace id with the existing `first(call.metadata, 'x-trace-id')` helper (configServiceImpl.ts:405), not `call.metadata.get`, which returns an array. Adopted in the synthesis.",
        "blocking": false
      },
      {
        "text": "[FR-4] Every catch-up write must re-check `this.subscribers.get(subId) === sub` after its await. endSubscriber must be idempotent (identity check first). Without both, the code double-logs and double-destroys. Adopted in the synthesis; the proposer should confirm and add the cancel-during-catch-up test.",
        "blocking": false
      },
      {
        "text": "[FR-1] On boot, issue LISTEN before reloadAll, inside the serial chain, so a NOTIFY committed between the two is not lost (:163-165). Adopted in the synthesis at no extra cost.",
        "blocking": false
      },
      {
        "text": "[FR-3] Ledger catch must release with the caught error, `client?.release(failure)`, so a client that broke mid-transaction is destroyed rather than handed to the next AppendEvent under DB_POOL_MAX=1. Adopted; this closes the risk previously recorded as a limitation.",
        "blocking": false
      },
      {
        "text": "[P-06 / fails.md 074] The ledger step precondition must be written as a step precondition: either 252 has merged, or the step first removes the import-swallow at ledgerServiceImpl.test.ts:23-26 and :145. Verification requires the red-on-current check and a non-zero assertion count.",
        "blocking": false
      },
      {
        "text": "[Strongest risk] The dev pg_terminate_backend check is a required Verification item for step 1. keepAlive in index.ts is deferred because 266 owns that object, and the half-open gap is recorded in context.md.",
        "blocking": false
      },
      {
        "text": "[C-16] The spec must state that endSubscriber is reachable only from the snapshot/catch-up chain and the per-subscriber broadcast catch. The cancelled/error handlers (:288-294) only delete (platform @AC-6 @FR-6 @feature-210).",
        "blocking": false
      },
      {
        "text": "[F-07] Record in context.md why the backoff constants (1000/30000 ms) are not config keys: config cannot watch itself (invariant #1), with ledger eventNotifier.ts:35 as precedent.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-2",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-3",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-4",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-5",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-6",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-7",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-8",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-9",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-10",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-11",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "platform.feature @AC-6 @FR-6 @feature-210",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "config-secrets @AC-1/@AC-1b/@AC-16",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "config @AC-2/@AC-14/@AC-35 (redaction via buildConfigValue)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "readiness @AC-8 @feature-182, opportunity @AC-4/@AC-8, surface-signal @AC-11/@AC-12",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Fork (b), a dedicated pg.Client created by an injected makeClient (the ledger EventNotifier model). It lost because it needs an index.ts edit (which overlaps 266) and an F-06 re-check (+1 direct connection, or dropping the query pool to 1). The blocking bug it would have avoided is fixed by moving connect() inside the try. It remains the fallback if the dev pg_terminate_backend check shows the pooled client does not emit error/end.",
      "Reusing EventNotifier directly, via a shared package or a copy. There is no shared Node package for it. Its fixed delay and `onReconnect` API also hide reloadAll failures, so the reconnect path could not see them. A copy would duplicate code without removing the config-specific logic.",
      "keepAlive: true in the index.ts pool config. Deferred because the user asked for low rework and 266 owns that object. The half-open gap is handled by the required dev check and a recorded limitation.",
      "A periodic SELECT 1 keepalive on the listener client. It adds a LISTEN-client query_timeout trap surface (fails.md:3006-3021).",
      "The round-1 serial shape `then(fn,fn).catch(log)`. It swallowed reloadAll failures, so the reconnect path never saw them. Replaced by a serial() that returns the real link and stores a non-rejecting tail.",
      "A per-client `released` flag. Superseded by the `this.listener !== c` identity guard, which also drops stale notification events.",
      "Buffering and replaying missed DELTAs. One fresh full-namespace DELTA covers any number of missed ones.",
      "Version-gating with lastVersion. Nothing reads it, and pending/missedDelta keeps SNAPSHOT first with less mechanism.",
      "Swapping a fresh Map inside reloadAll to clear emptied namespaces. It changes boot semantics for every namespace; recorded as a limitation instead.",
      "UNAVAILABLE (14) for stream termination. Code 13 is the existing convention, and Node watchers reconnect on any error.",
      "A shared gRPC error helper. Rejected to keep GetSecret @AC-16 and the existing early-return shapes untouched.",
      "Soft start at boot with an empty cache. Every client would get an empty SNAPSHOT, so boot stays fail-fast."
    ],
    "open_risks": [
      "The pooled LISTEN client may not emit error/end on a half-open or silently dropped socket, because index.ts sets no keepAlive. AC-1 and AC-9 could then pass against the FakeClient only. The required dev pg_terminate_backend check is the gate, and fork (b) is the fallback.",
      "During recovery the listener competes with queries for the two pool slots. pg-pool's connect() wait is unbounded (no connectionTimeoutMillis), so a reconnect can queue behind in-flight queries and notification handling slows while the chain is backed up.",
      "Namespaces whose rows were all deleted during an outage keep stale snapshots. Accepted limitation.",
      "Merge overlaps: 241 edits setConfig and 263 edits getConfig :317-319, so both need a manual merge. 266 owns index.ts, which this design avoids touching.",
      "The ledger test suite import-swallow (ledgerServiceImpl.test.ts:23-26, :145) can give a zero-assertion green unless the step precondition is enforced.",
      "Exponential backoff capped at 30 s means propagation can lag up to about 30 s after a long outage ends. This is acceptable given resync-on-reconnect."
    ],
    "constitution_rules_touched": [
      "C-03",
      "C-11",
      "C-15",
      "C-16",
      "C-18",
      "F-06",
      "F-07",
      "P-02",
      "P-03",
      "P-06",
      "PLAT-N1",
      "CONFIG-1"
    ],
    "rationale": "The r2 proposal settled both round-1 blocking objections.\n- Release-once: the `this.listener !== c` identity guard.\n- Ordering: one serial chain whose returned link really rejects while its stored tail never does.\n\nThese are confirmed and closed.\n\nThe adversary found one real blocking defect, and I checked it against the code. In r2, `pool.connect()` sat outside the try, and the timer's `.catch(() => {})` swallowed the rejection. A reconnect attempt made while the DB was still down therefore ended all retries for good, which brings D-05 back. Ledger's eventNotifier.ts:82-107 avoids this: connect() is inside the try, the catch calls scheduleReconnect(), and the timer clears itself first (:114). The synthesis folds in the same fix. It stays open as blocking, pending the proposer's confirmation with placement and a test, because it is the core FR-1 guarantee.\n\nAll other adversary points were small and are adopted because each costs almost no rework:\n- the `first()` helper for the trace id;\n- a re-guarded catch-up loop and an idempotent endSubscriber;\n- LISTEN before reloadAll on boot;\n- releasing ledger's broken client with the error;\n- the ledger zero-assertion precondition written as a step precondition.\n\nkeepAlive is deferred. The user asked to keep rework low, and 266 owns that index.ts object. The required dev check is the gate instead.\n\nThere are no Floor breaches.\n- F-06: the pooled client is unchanged, so the budget is unchanged.\n- F-07: the backoff values are code constants with a recorded rationale.\n\nBusiness rules:\n- AC-1 to AC-10 change behaviour within the operator-sanctioned SEV-2 Track C scope (D-05, D-06, D-35, D-58).\n- AC-11 and the cross-service suites are preserved because the new try blocks are narrow, there is no shared helper, every row still goes through buildConfigValue, and the cancel/error handlers still only delete.\n\nx-trace-id: request handlers use their inbound metadata. Each WatchConfig subscriber carries its inbound trace id into background broadcast and termination logs. Only the listener and reconnect path, which has no originating request, mints its own log context. This complies with the standing C-03 operator decision."
  },
  "floor_breaches": []
}
```
