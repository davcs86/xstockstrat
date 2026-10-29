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

## Session 2026-10-22 — sdd-design

- Phase 0 Recon: recon.md (services: xstockstrat-config, xstockstrat-ledger). Reuse patterns: the ledger
  `EventNotifier` LISTEN lifecycle (`eventNotifier.ts:74-117`) and ledger `call.destroy({ code, message })`
  (`ledgerServiceImpl.ts:285`).
- Phase 1 Grilling: 2 rounds (full). Terminated approved: the operator approved at the r2 design gate
  (2026-10-22, "APPROVED as synthesized"). That approval covers the reconnect-retry fix: `pool.connect()` inside
  `connectListener`'s try, `scheduleReconnect()` from the catch when `connectedOnce`, and `reconnectTimer` cleared
  before reconnecting. It also covers the reject-twice-then-succeed test. This closes the one blocking objection
  that was pending the proposer's confirmation.
- Chosen approach:
  - Pooled LISTEN client (fork a) with the identity-guarded `dropListener`, a single-timer exponential backoff
    (1000 ms doubling to a 30000 ms cap), and one `serial()` chain for reload and notification work.
  - LISTEN runs before `reloadAll` on boot. On reconnect, `resyncAll` re-broadcasts.
  - Narrow try blocks in `getConfig`, the `setConfig` gate queries and ledger `appendEvent` (connect inside the
    try, and the client is released with the error).
  - WatchConfig registers a pending subscriber with a `missedDelta` catch-up, and the idempotent `endSubscriber`
    ends the stream with `destroy({ code: 13 })`.
- Rejected:
  - Fork (b), a dedicated `pg.Client`, because of the index.ts/266 overlap and F-06. It is the fallback if the
    dev check fails.
  - keepAlive, deferred to 266.
  - A `SELECT 1` keepalive, version-gating, DELTA buffering, UNAVAILABLE, a shared error helper, and a soft start.
- Constitution rules touched: C-03, C-11, C-15, C-16, C-18, F-06, F-07, P-02, P-03, P-06, PLAT-N1, CONFIG-1.
  Floor breaches: none. F-06 and F-07 are honored.
- C-16: AC-1..AC-10 are CHANGE, signed off by the operator decisions of 2026-10-21 (Track C, scope
  D-05/D-06/D-35/D-58) and 2026-10-22 (r2 gate). AC-11, platform `@AC-6 @FR-6 @feature-210`, config-secrets
  redaction/encryption and the INVALID_ARGUMENT bounds suites are PRESERVE.
- Operator decision (standing, 2026-10-21): x-trace-id is propagated with no C-03 waiver. Each WatchConfig
  subscriber carries its inbound trace id (via `first()`) into background logs. Only the listener/reconnect path
  mints its own context.
- F-07 rationale: the backoff constants are code constants, not config keys, because config cannot watch itself
  (service invariant #1). Ledger hardcodes `reconnectDelayMs` the same way (`eventNotifier.ts:35`).
- Status: spec-ready → design-approved.

### Open Threads (from design.md Open Risks)

- [ ] **Half-open socket.** Without keepAlive, a half-open socket may never emit `error`/`end`, so AC-1 and AC-9
  could pass against the FakeClient only. Target: step 1 Verification, a required dev `pg_terminate_backend`
  check. Fallback: fork (b).
- [ ] **Pool contention during recovery.** The listener competes with queries for the 2 pool slots, and pg-pool's
  `connect()` wait is unbounded. Target: step 5 docs (limitation).
- [ ] **Stale namespaces.** A namespace whose rows were all deleted during an outage keeps a stale snapshot. This is
  an accepted limitation. Target: step 5 docs.
- [ ] **Merge overlaps.** 241 (`setConfig`) and 263 (`getConfig` `:317-319`) need a manual merge. 266 owns
  `index.ts`. Target: /sdd-spec merge-order rows and the integration PR.
- [ ] **Ledger test import-swallow.** The swallow at `ledgerServiceImpl.test.ts:23-26` and `:145` can give a
  zero-assertion green. Target: the step 4 precondition (252 merged, or remove the swallow first) and the
  non-zero-assertion Verification.
- [ ] **Propagation lag.** With the 30 s backoff cap, propagation can lag by up to about 30 s after a long outage.
  Target: step 5 (service CLAUDE.md § WatchConfig Flow).

## Session 2026-10-22 — sdd-spec

- Generated implementation-spec.md with 9 steps. Status → implementation-ready.
- The steps follow design.md § Chosen Approach and its build order:
  - 1–2: the config LISTEN lifecycle;
  - 3–4: the unary try blocks;
  - 5–6: WatchConfig pending registration with catch-up, plus `endSubscriber`;
  - 7–8: ledger `appendEvent`;
  - 9: docs.
- No rejected alternative is used. No proto, migration, config key, env var or `index.ts` edit.
- C-15 mapping:
  - AC-1, AC-2, AC-9 → Step 2
  - AC-3, AC-4, AC-11 → Step 4
  - AC-6, AC-7, AC-8 → Step 6
  - AC-5, AC-10 → Step 8
- C-14: none, internal/platform-only. This restates the product spec.
- Key codebase findings, re-verified on this branch:
  - Every recon.md config anchor resolves: `configServiceImpl.ts` `:162-174`, `:260-274`, `:280-313`, `:319`,
    `:447-462`, `:500-522`.
  - `setConfig`'s `existing`/`globalRow` are read after the gate (`:465`, `:476-482`). Step 3 therefore hoists them
    as `let` declarations above the new try.
  - Config ESLint extends `eslint:recommended`, whose `no-empty` rule flags an empty `catch {}`. Every
    intentionally empty catch carries a comment.
  - `PoolClient` is imported in neither service today. Config `:1` and ledger `:1` gain it.
  - `t.mock.timers` precedent: `configWatcher.test.ts:139`. No `src/__tests__/fixtures/` home exists in either
    service, so the C-13 verdict is inline.
  - The config logger is a module-private winston Console sink (`src/services/logger.ts:10-19`). No test captures
    logs today, and winston is not installed in this checkout. The capture method for AC-2/AC-8 is therefore
    **Not verified**: Step 2 says to confirm the sink at execute and record it in the Deviation Log.
  - Ledger: the import swallow is at `ledgerServiceImpl.test.ts:21-29`, with 9 `if (!impl) return;` sites.
    `252-fix-identity-ledger-test-suites` is still implementation-ready, not merged. Step 8's new describe asserts
    its import instead of skipping, and leaves the swallow for 252 to avoid a collision.
- Spec-time decisions (P-03, surfaced rather than guessed):
  - **Required check location.** Step 1's required `pg_terminate_backend` check runs on the local compose stack.
    If Docker is unavailable, Step 1 is blocked, and the check moves to the dev app as an integration-PR blocker.
    It is never waived.
  - **Merge-order rows.** The non-blocking rows (258 vs 241 `setConfig`, 258 vs 263 `getConfig`) are not written
    here, because this writer may only edit the feature directory. `/sdd-execute` adds them at the integration PR.
    This was the open thread "Merge overlaps", and it is now retargeted.

### Open Threads (updated)

- [ ] Half-open socket → Step 1 required check (fallback: back to /sdd-design for fork b).
- [ ] Log-capture sink for AC-2/AC-8 → confirm at Step 2 execute.
- [ ] Merge-order rows 258↔241 / 258↔263 → /sdd-execute integration PR.
- [ ] Ledger import swallow → Step 8 precondition (import assertion + red run).
- [ ] Pool contention, stale namespaces, propagation lag → Step 9 docs.

## Session 2026-10-22 — sdd-review impl-spec (advisory)

- Result: 1 failure, 7 warnings; overlap WARN (no FAIL for this feature). Advisory, did not block; lifecycle unchanged
  (`implementation-ready`).
- Re-verified the FAIL before editing:
  - `ledgerServiceImpl.ts:20-25` uses constructor parameter properties.
  - Ledger `package.json:13-14` runs `node --experimental-strip-types`, and the test header `:5-8` names that as the
    skip cause.
  - This supersedes the sdd-spec session's "Node 24 precondition" reading.
- Addressed (implementation-spec.md edited):
  - [x] Step 8 FAIL (C-08/P-06): Step 8 now hard-depends on feature 252 Steps 4–5 (compile-then-test ledger runner,
    de-guarded `ledgerServiceImpl.test.ts`). This replaces the Node 24 precondition, which did not fix the
    unsupported syntax. The step has a precondition gate (`test:coverage` starts with `tsc &&`, else blocked and
    stop-and-ask). Its Verification now proves the cases executed: TAP `# pass` > 0 and two `ok … @AC-5/@AC-10`
    hits. A per-file `--experimental-transform-types` was not chosen, because it would be a second runner beside
    252's and collide with its `package.json`.
  - [x] Step 7 WARN: Verification adds `pnpm run build` (tsc) and a grep for the import.
  - [x] Step 7 WARN: `PoolClient` comes in through a separate `import type { PoolClient } from 'pg'`, and `:1` is
    left unchanged.
  - [x] Step 2 WARN: a gating log-sink spike (instruction 0) that reads the installed winston Console transport,
    records the writer and proves capture with a probe before AC-2/AC-8 are written. Step 6 reuses it.
  - [x] Step 1 WARN (Docker): it is now explicit that Step 1 cannot be marked `done` until the pg_terminate_backend
    check passes, locally or on the dev app. Steps 2–6 may proceed meanwhile.
  - [x] Step 1 WARN: `onNotification` drops a parsed payload whose `namespace` is missing or not a string, before
    the chain.
- Still open (carried into /sdd-execute; announce at each checkpoint, P-03):
  - [ ] Step 8 blocked until 252 Steps 4–5 merge to `main-dev` and this branch is rebased (P-06). Step 7 may land
    first.
  - [ ] Merge-order rows not yet in `docs/roadmap/features/merge-order.md` (this writer may edit only the feature
    dir). Non-blocking rows are owed at integration:
    - 258↔241 (`setConfig`);
    - 258↔263 (`getConfig`);
    - 258↔248 (`ledgerServiceImpl.ts` import line and nearby hunks);
    - a blocking dependency 258 → 252 (Step 8 runner).
    - Add a rebase-only note for the shared config `CLAUDE.md` and `docs/context-constitution.md` (241, 244, 248).
  - [ ] Steps 1 and 5 rewrite a large share of `configServiceImpl.ts`. The six config steps run in sequence on one
    file. No spec change: this was advisory and the ordering is already documented.
  - [ ] Step 9 must run last, because it re-stamps the CONFIG-1 line hints that 241 and 244 also edit.
  - [ ] Out of scope for 258, to flag to the owners: 244 (`032_analysis_zero_trap_descriptions`) and 248
    (`032_ledger_stream_resolve_timeout`) both claim config migration NNN 032. That is a FAIL between those two
    peers and needs a blocking merge-order row.
  - [ ] Batch peers with no feature directory on this checkout (fix-marketdata-secret-exposure,
    fix-offline-book-consistency, fix-python-loop-supervision, fix-fundsignal-emit-accounting), and 257/263/266,
    were not overlap-scanned. Re-scan them when they reach implementation-ready.

---

## Session 2026-10-29 (/sdd-execute sequential — branch setup + re-spec)

- Branch setup (§5.3): merged `origin/main-dev` into `feature/fix-config-stream-resilience` (normal merge, no
  conflicts). The ledger-guard check (`--own-slug fix-config-stream-resilience --base origin/main-dev --fix`)
  reported clean, so the merge commit needed no repair.
- Re-spec of Steps 3, 4, 5, 8, 2, 1 and 9 (bodies only) against the merged tree:
  - Steps 3/4: the `setConfig` anchors moved +2 because main-dev added the `platform.trading_state`
    INVALID_ARGUMENT block (`configServiceImpl.ts:418-430`). The gates are now `:449-465`, NOT_FOUND `:468-474`,
    and the write try `:502-524`. Symbols and code shapes are unchanged. `getConfig` `:315-328` / `:319` and
    `getSecret` `:335-369` match.
  - Step 5: no mismatch; it is marked re-verified. Step 6's ledger fake-call anchors were re-stamped as well
    (`:597-598`, `:609`).
  - Step 8: feature 252 has landed on this branch. Ledger `test:coverage` is `tsc && c8 … node --test
    dist/__tests__/*.test.js` (`package.json:14`), the `before()` import is unguarded (`:10-12`, asserted at
    `:18`), and no `if (!impl) return;` skip remains. So the Step 8 precondition gate now passes. The
    § Step Dependencies "Step 8 hard dependency" paragraph and the open item "Step 8 blocked until 252…" above
    are therefore satisfied. They were left as written, because this re-spec covers step bodies only.
  - Step 2: ledger `FakeClient` anchors re-stamped (`eventNotifier.test.ts:22/27/47`). The log-sink spike still
    needs `pnpm install` first.
  - Step 1: all anchors match. The pg_terminate_backend check cannot run in this worktree session, because
    starting a database is barred. It takes the spec's own fallback (dev app, integration-PR blocker).
  - Step 9: CONFIG-1's line hints are already stale (`reloadNamespace` `:203`, `changedKeys` `:220`).
    Instruction 2's re-stamp covers this.

---

## Session 2026-10-29 (sdd-execute sequential (sdd-batch-execute))

- Up-front confirmation (sequential mode): the operator approved the plan by standing authorization in operator
  chat 2026-10-28/29 (session_01NpS3HShZK6pSnogA7CFo2f). The authorization covers:
  - "Start executing features 241-276" via batch-execute;
  - unattended checkpoints with `report`, and merge-train authorized; 255 and 275 deferred;
  - C-16 promotion auto-confirmed unless it changes an existing `@AC` rule;
  - operator-only DB/prod steps: open the PR and hold the merge;
  - the blocker decisions of 2026-10-29, recorded per feature.
- Status `implementation-ready` → `in-progress`.
- Carry-forward: the Step 1 pg_terminate_backend check is pending, and goes to the dev app as an integration-PR
  blocker unless a session can run it. The merge-order rows (258↔241/263/248) are still owed at integration.

### Step 1 — service: config LISTEN lifecycle (reconnect with backoff, serial chain, guarded notifications) [blocked]
- Implemented Instructions 1–10 in `configServiceImpl.ts`:
  - `connectListener` runs LISTEN before `reloadAll`, with `pool.connect()` inside the try.
  - `dropListener` has an identity guard and a single `release(err)`.
  - `scheduleReconnect` uses a single timer and backs off 1 s → 30 s.
  - `resyncAll` and the guarded `onNotification` both run through the `serial` chain.
  - `initialize()` now calls `connectListener()`.
- Verification passed:
  - build exit 0;
  - lint exit 0 (0 errors, 158 pre-existing warnings, unchanged);
  - one `pool.connect()` at `:188`, constants at `:156-157`;
  - existing suite 182/182 pass (`test:coverage` exit 0).
- TDD (throwaway probe; Step 2 owns the committed proof). Both runs used the same uncommitted fake-pool probe
  against `dist/`:
  - RED: `listenBeforeReloadAll:false, connects:1, listens:1, releases:[]`; unhandled: the `"not json"`
    JSON.parse rejection and the unhandled `error` event; and one namespace SELECT for a payload without a
    namespace.
  - GREEN: `listenBeforeReloadAll:true, connects:2, listens:2`, one release carrying the error, no unhandled
    rejections, and 0 namespace SELECTs.
- Blocked only on the operator-only pg_terminate_backend check (Deviation Log). Step **Status** stays `pending`, and
  the integration-PR merge is held until that check passes on the dev app. Steps 2–6 may proceed.
- Files modified: `services/xstockstrat-config/src/grpc/configServiceImpl.ts`
- Deviations: Step 1 deferred to operator (pg_terminate_backend check); RED captured by a throwaway probe because the
  paired test is Step 2. Full detail is in the Deviation Log.
- Two constraint comments were added beyond the spec text: the `chain` field (it serializes reloads) and the
  LISTEN-before-reload line.

### Step 2 — test: LISTEN reconnect, retry, resync and notification-failure cases (AC-1, AC-2, AC-9) [done]
- Tooling: node 24.20.0 ✓ · pnpm 9.15.9 ✓ · `pnpm install --frozen-lockfile` (config + root) ⬇.
- Log sink (Instruction 0): winston 3.19.0 Console writes every level to `console._stdout` = `process.stdout`;
  the probe passed and was deleted. Step 6 reuses the `process.stdout.write` capture (Deviation Log).
- Added `describe('ConfigServiceImpl — LISTEN lifecycle (feature 258)')` with 8 cases: boot order, @AC-1, @AC-9,
  connect rejects twice (backoff 1 s → 2 s → 4 s, then reset to 1 s), reloadAll rejects once, interleave (chain
  order 300 then 600), @AC-2, malformed payload. Local `FakeClient`/routing pool/`fakeCall` helpers (C-13 inline;
  no fixtures home).
- TDD: RED against the pre-Step-1 `configServiceImpl.ts` (a482eae2, restored temporarily): 8/8 new cases fail as
  predicted. GREEN on the Step 1 code: 11/11 in the file, 5 repeated runs with 0 failures.
- Verification: `pnpm run test:coverage` exit 0 (190/190 pass, c8 lines 92.04% ≥ 40); `pnpm run lint` exit 0 with
  0 errors (168 warnings: 158 pre-existing plus 10 `no-explicit-any` in the new test helpers); the AC greps hit;
  the fixtures grep has no hits.
- Files modified: `services/xstockstrat-config/src/__tests__/configServiceImpl.test.ts`

### Step 3 — service: config getConfig / setConfig gate queries return a gRPC error on DB rejection [done]
- `getConfig`: `resolveOverlayValues` wrapped; a rejection logs `getConfig failed` and calls back code 13.
- `setConfig`: `existing`/`globalRow` declared above one try that holds only the two existence-gate queries; a
  rejection logs `setConfig existence gate failed` and calls back code 13. PERMISSION_DENIED, MISSING_AUTHOR,
  INVALID_ARGUMENT, NOT_FOUND, the encryption catch and the write try are unchanged and outside the new try.
- TDD (throwaway probe; Step 4 owns the committed proof). RED: three handlers rejected `connection terminated`
  with no callback. GREEN: callback code 13 for all, no INSERT after a gate failure; write-try pin code 13 both runs.
- Verification: build exit 0; lint exit 0 (0 errors, 172 warnings = 168 + 4 spec-mandated `any`); one hit each for
  both log strings (`:408`, `:561`); existing suite 190/190 pass, c8 lines 91.44%.
- Files modified: `services/xstockstrat-config/src/grpc/configServiceImpl.ts`
- Environment note: the host disk was at 100% (about 40 MB free) during this step; one Edit failed with ENOSPC and
  was retried with no partial write.


## Session 2026-10-29 (/sdd-execute sequential (sdd-batch-execute) — second main-dev merge + re-spec)

- Authorization: operator's standing up-front authorization (operator chat 2026-10-28/29,
  session_01NpS3HShZK6pSnogA7CFo2f: "Start executing features 241-276" via batch-execute; unattended checkpoints
  reported, C-16 promotion auto-confirmed unless it changes an existing @AC rule; operator-only DB/prod steps:
  open the PR and hold the merge). Status was already `in-progress`, so no transition.
- Merged `origin/main-dev` into the branch (`7759f2b0`, a normal merge with no conflicts); ledger-guard clean.
- Re-spec of Steps 1, 4, 5, 6 and 9 (the step bodies' evidence/line hints only; no instruction changes):
  - Step 1: Codebase Evidence now describes the implemented tree (`907fa340`): `pool.connect()` at `:188` inside
    `connectListener`, backoff constants at `:156-157`, `reloadNamespace` `:288`, `broadcastToSubscribers` `:345`.
    The false "every Step 1 anchor still matches" line is replaced. Step 1 stays `pending` on the operator
    pg_terminate_backend check (Deviation Log).
  - Step 4: `getConfig` `:400` / overlay call `:406`; overlay SELECT `:318-322`; setConfig gates `:541-563`
    (catch/code 13 `:559-563`); NOT_FOUND `:566-572`.
  - Step 5: `lastVersion: '0'` `:387`; broadcast `:345-359` (catch `:353-356`); `watchConfig` `:365-398`;
    `first()` declared at `authz.ts:15`; call form `:499`. The false "every Step 5 anchor still matches" line is
    replaced.
  - Step 6: reuse `FakeClient` (test `:104`) and `makeRig()` (`:123`); log capture is the inline
    `process.stdout.write` mock (about `:358-360`), not a shared helper.
  - Step 9: CONFIG-1 hints now `reloadNamespace` `:288` / `changedKeys` `:305` (pre-Step-5).
- Next: Step 4.

### Step 1 — re-run after the respec (2026-10-29) [blocked — operator-only]
- The code is unchanged since `907fa340`. Verification was re-run on the post-merge tree: build exit 0; lint 0 errors
  (174 warnings); `test:coverage` 191/191 pass; one `pool.connect()` (`:188`); both backoff constants (`:156-157`).
- The only open item is still the operator-only pg_terminate_backend check. The existing Deviation Log entry
  ("Step 1 deferred to operator") stands, so no new spec entry was added. Step **Status** stays `pending`.

### Step 4 — test: unary handlers return an error status and keep their specific codes (AC-3, AC-4, AC-11) [done]
- Tooling: node 24.20.0 ✓ · pnpm 9.15.9 ✓ · `pnpm install --frozen-lockfile` (config + root) ⬇ (the main worktree has
  no `node_modules`, so it was installed in this worktree rather than symlinked).
- Added `describe('ConfigServiceImpl — unary DB failures (feature 258)')` with 6 cases: @AC-3, @AC-4, @AC-11 and the
  INVALID_ARGUMENT / NOT_FOUND / PERMISSION_DENIED pins. It uses a local regex-failing pool and `unhandled()`
  helper (C-13 inline), and imports `ADMIN_SCOPE_ERROR`, `HEADER_ACCESS_SCOPE` and `HEADER_USER_ID` from
  `../grpc/authz`.
- TDD: RED against the pre-Step-3 `configServiceImpl.ts` (907fa340, restored temporarily). @AC-3 and @AC-4 failed
  with `connection terminated` rejecting from the handler, and the four pins passed. GREEN on the Step 3 code: 6/6,
  and the whole file passed with 0 failures in 3 repeated runs.
- Verification: `pnpm run test:coverage` exit 0 (197/197 pass, c8 lines 92.34% ≥ 40). `pnpm run lint` exit 0 with
  0 errors (182 warnings = 174 + 8 `no-explicit-any` in the new test helpers). The AC grep hits `:448`, `:460` and
  `:470`.
- Files modified: `services/xstockstrat-config/src/__tests__/configServiceImpl.test.ts`

### Step 5 — service: WatchConfig registers pending before the snapshot; failures end the call (D-35, D-58) [done]
- `Subscriber`: `lastVersion` was replaced by `pending`, `missedDelta` and `traceId?`.
- New `endSubscriber(id, sub, err)`:
  - It is identity-guarded.
  - It logs `WatchConfig subscriber terminated` at error level, with the trace id and `err`.
  - It calls `call.destroy({ code: 13 })` inside a try.
  - Its only callers are the broadcast catch and the watchConfig chain.
- `broadcastToSubscribers`: a pending subscriber gets `missedDelta = true` and no write.
- `watchConfig` now registers before the snapshot read. It writes the SNAPSHOT, drains `missedDelta` with DELTA
  catch-ups, then clears `pending`. The `cancelled`/`error` handlers stay delete-only.
- TDD (a throwaway probe; Step 6 owns the committed proof):
  - RED: AC-6 and AC-8 had no `destroy` (code undefined). AC-7 lost the in-flight change: the only write was
    `[SNAPSHOT 300]`.
  - GREEN: 3/3.
  - Step 6 must subscribe with a non-empty `user_id` to hold a snapshot in flight, because the global path issues no
    SELECT.
- Verification:
  - Build exit 0.
  - Lint 0 errors. 183 warnings = 182 + 1 spec-mandated `err: any` on `endSubscriber`.
  - `lastVersion` has 0 hits.
  - `this.endSubscriber(` has exactly 2 call sites: `:360` (broadcast) and `:427` (chain).
  - The existing suite passes 197/197, with c8 lines at 90.55%.
- Files modified: `services/xstockstrat-config/src/grpc/configServiceImpl.ts`

### Step 6 — test: snapshot failure, in-flight change, broadcast failure, cancel during catch-up (AC-6, AC-7, AC-8) [done]
- Tooling: node 24.20.0 ✓ · pnpm 9.15.9 ✓ · `pnpm install --frozen-lockfile` (config + root) ⬇. The main worktree
  has no `node_modules`, so it was installed in this worktree rather than symlinked.
- Added 6 cases to `describe('ConfigServiceImpl — LISTEN lifecycle (feature 258)')`, reusing `FakeClient`/`makeRig()`:
  @AC-6, @AC-7, @AC-8, cancel during catch-up, idempotent end and trace id (`x-trace-id: t-258`). All six subscribe
  with `user_id: 'u-1'` so the overlay SELECT can be held or rejected.
- Rig changes: `makeRig()` gained a `hooks.overlay` queue; `fakeCall(userId)` gained a `destroys` counter; a
  describe-local `captureStdout(t)` wraps the Step 2 stdout capture (Deviation Log).
- TDD: RED against the pre-Step-5 `configServiceImpl.ts` (ec5d13d0^, swapped in temporarily): 6/6 new cases failed
  for the predicted reasons. GREEN on the Step 5 code: 203/203 pass, and 2 repeat runs had 0 failures.
- Verification: `pnpm run test:coverage` exit 0 (203/203, c8 lines 92.89% ≥ 40). `pnpm run lint` 0 errors (185
  warnings = 183 + 2 `no-explicit-any` in `captureStdout`). The AC grep hits `:410`, `:427`, `:447`, `:471`.
- Files modified: `services/xstockstrat-config/src/__tests__/configServiceImpl.test.ts`
- Next: Step 7.

### Step 7 — service: ledger appendEvent acquires the client inside the try and releases it with the error [done]
- `ledgerServiceImpl.ts`:
  - Added `import type { PoolClient } from 'pg';` (`:2`).
  - `let client: PoolClient | undefined; let failure: unknown;` replaces the pre-try connect.
    `client = await this.pool.connect();` is now the first statement in the try (`:78`).
  - The catch sets `failure = err` and guards the ROLLBACK with `if (client)`.
  - The finally runs `client?.release(failure instanceof Error ? failure : undefined)` (`:121`).
  - The success path, dedup branch (LEDGER-1), insert SQL and plain no-key path are unchanged. tsc narrowing
    made `client!` unnecessary.
- Tooling: node 24.20.0 ✓ · pnpm 9.15.9 ✓. `pnpm install --frozen-lockfile` ran in this worktree, because the main
  worktree has no `node_modules`.
- TDD (a throwaway probe; Step 8 owns the committed proof):
  - AC-5 red: `appendEvent` rejected with `timeout exceeded when trying to connect` and never called back → green:
    `cb` was called once with code 13 and nothing was released.
  - AC-10 red: `assert.ok(releases[0] instanceof Error)` failed → green: released with `connection terminated`, and
    ROLLBACK was issued.
  - Success pin: `release(undefined)`.
- Verification:
  - `pnpm run build` exit 0.
  - `pnpm run lint` 0 errors, 97 warnings; the file has 24 warnings both before and after the change.
  - `pnpm run test:coverage` 47/47 pass, with c8 lines at 73.55%.
  - The 3 greps hit once each: `:2`, `:78` (after `try {` at `:77`) and `:121`.
- Line shift: `appendEvent`'s idempotent block moved by +2 to +3 lines. LEDGER-1's `~L73-118` anchor and
  `fix-identity-ledger-test-suites.feature:9` (`:84-105`) are approximate now. Refresh them in Step 9 or in the
  teardown.
- Files modified: `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts`
- Next: Step 8.

### Step 8 — test: idempotent AppendEvent connect and mid-transaction failures (AC-5, AC-10) [done]
- `ledgerServiceImpl.test.ts`:
  - `makeIdempotentPool` gained `connectThrows?` and `throwOn?` options and returns a `releases` array; existing
    callers pass neither option.
  - The two existing idempotent cases now pin `releases` to `[undefined]`.
  - New `describe('LedgerServiceImpl.appendEvent — DB failures (feature 258)')` with `@AC-5` and `@AC-10`, each
    opening with the `never skip silently` import assertion. The 252 `before()` block and runner are untouched.
- Tooling: node 24.20.0 ✓ · pnpm 9.15.9 ✓. `pnpm install --frozen-lockfile --filter xstockstrat-ledger...` ran in this
  worktree (the main worktree has no `node_modules`).
- TDD: RED against the pre-Step-7 source (a9197ef2~1, swapped in temporarily): `# pass 30 / # fail 2`, both `@AC-*`
  `not ok` for the predicted reasons. GREEN: `# pass 32 / # fail 0`, exactly 2 `ok … @AC-(5|10)` hits.
- Verification: precondition grep hit `package.json:14`; `pnpm run test:coverage` 49/49 pass, c8 lines 74.51%;
  `pnpm run lint` 0 errors, 100 warnings (97 → 100, new `no-explicit-any` in the test helper).
- Files modified: `services/xstockstrat-ledger/src/__tests__/ledgerServiceImpl.test.ts`
- Next: Step 9.
