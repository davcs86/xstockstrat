# Implementation Spec: fix-notify-stream-contract

**Status**: `pending`
**Created**: 2026-11-20
**Feature**: `docs/roadmap/features/316-fix-notify-stream-contract/feature.md`
**Total Steps**: 8
**Feature Branch**: `feature/fix-notify-stream-contract`

---

## Execution Summary

Step 1 is design.md's "Step 0": it brings the feature branch up to `origin/main-dev` so notify runs on `@grpc/grpc-js` 1.14.7, the only version the spike exercised. Steps 2–4 are design.md's "Step 1" (severity typing, AC-1): the regression test, the type change, then the record retirement. Steps 5–8 are design.md's "Step 2" (bounded queue with a status-path eviction, AC-2): the mock unit tests and the real-grpc-js test are written first and are red, the eviction makes them green in the same atomic unit, and a docs step then adds the `NOTIFY-*` invariant and retires the backpressure records.

All work is inside `services/xstockstrat-notify`, plus two report sidecars and this feature's `acceptance.feature`. There is no proto, migration, config-key, env-var or port change (design.md § Chosen Approach; recon.md § Dependencies).

**Divergence from product-spec.md (F-07, D-4).** product-spec.md:58 says "Config key changes anticipated: **yes (likely)**". The design decided otherwise, and this spec follows the design: `MAX_QUEUED_ALERTS = 1024` is a code constant (Step 7), recorded as a memory-safety bound with no operator tuning (design.md:94-96 "Why the cap is a code constant"; design.md:145, `F-07` honored). This is a recorded trade-off, not an omission; the reviewer of Step 7 should see both documents. If operators later want to tune the cap, that is a new change carrying the full config-key contract (a seed migration in `xstockstrat-config`, a reader in notify, and the live `WatchConfig` mechanism; `docs/patterns/config-governance.md`). It is not part of this feature.

**Consumer surface (C-14).** None: internal/platform-only. This is a decision, not an omission. The bug-template product spec has no `## Consumer Surface(s)` section, and design.md records that `StreamAlerts` keeps its contract. The one client-visible difference is that an evicted slow consumer receives a terminal `RESOURCE_EXHAUSTED` status, which the UI's existing reconnect hook already handles (`services/xstockstrat-ui/src/hooks/useReconnectingStream.ts:23`; D-2 evidence). No UI or agent step is needed.

**Citation tree.** Every `path:line` below was read at `origin/main-dev` `fb52065c`, which is the tree the feature branch holds after Step 1. The branch itself is at merge-base `c4fd48b0a`, 168 commits behind, where recon.md's line numbers apply. Two things moved since recon and matter here:

- The fan-out loop is now in `persistAndBroadcast` (`notifyServiceImpl.ts:79`), which both `emitAlert` (`:50`) and `emitInternalAlert` (`:73`) call. design.md's "the `emitAlert` loop" means this loop.
- `services/xstockstrat-notify/docs/context-constitution.md` no longer carries the two gotchas recon cited at `:30` and `:31`.

If `origin/main-dev` has moved past `fb52065c` when Step 1 runs, `/sdd-execute` re-greps each anchor by symbol name before editing.

Re-verified on 2026-11-20 by `/sdd-review impl-spec`: `origin/main-dev` is still `fb52065c` and the branch is still 168 commits behind. These anchors were re-grepped there and hold: `notifyServiceImpl.ts` `:31`, `:79`, `:122`, `:125`, `:129`, `:162`, `:174`, `:178`, `:180`, `:392`; `telemetry.ts:380` and `:397`; `package.json:21` (`^1.14.7`); `fanout.test.ts:13` and `:243`; notify `CLAUDE.md:4` and `:125`.

## Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` a severity-filtered subscriber receives alerts matched by the string enum form | Step 2 |
| `@AC-2` a subscriber whose stream stops draining is evicted | Step 5 (mock, exact counts), Step 6 (real grpc-js, spike conditions (f) and (g)) |

Existing durable rules the tests also pin (C-16, design.md § Business Rules Touched): `@AC-32` (signal-map-instrumentation) by Step 5; `@AC-5` (pwa-notifications) by Step 5.

## Step Dependencies

- Step 1 gates everything: no later step starts until its Verification passes (D-19). If it fails, `/sdd-execute` stops and reports; it does not start Step 5–7 on grpc-js 1.14.5.
- Step 3 [service] is covered by Step 2 [test]. They are not an atomic unit: the type change breaks no call site (every test reaches `matchesSubscriber` and `streamAlerts` through `any`), so each passes its own Verification alone.
- Step 4 requires Steps 2 and 3: it retires the severity records only once the type and the test are in.
- Steps 5+6+7 land together: Steps 5 and 6 add tests that are red until Step 7's eviction exists, so neither can pass its own Verification on a tree without Step 7 (`step-constraints.md` §C, test-first pairing; precedent: feature 329's test → service units). Three adjacent steps, one consumer surface (backend).
- Step 7 [service] is covered by Step 5 [test] and Step 6 [test].
- Step 8 requires Step 7: the `NOTIFY-*` invariant and the retired records describe code that must already exist.
- Step 8 follows the Steps 5+6+7 unit directly. No `origin/main-dev` merge and no lockfile change goes between them, so the `NOTIFY-*` invariant is written against the same grpc-js version the eviction was tested on. Step 8's Verification re-checks the version.
- TDD evidence that is never committed: Step 2's mutation red and Step 3's "no natural red" note exist only as `/sdd-execute` records in `context.md` and the PR body (`tdd-gate.md:55-58`, P-03). Neither step is `done` until its record is written.
- Before `/sdd-execute`: check `docs/roadmap/features/merge-order.md` for features 312, 323 and 324, which also touch `notifyServiceImpl.ts` and `telemetry.ts` (design.md Open Risks; recon.md:104). Feature 334's overlap is already merged into `main-dev` and is absorbed by Step 1.
- File overlaps found by the `/sdd-review impl-spec` scan on 2026-11-20. All are rebase-only (WARN); none is a FAIL, and `merge-order.md` has no row for 316 (it names 316 only in prose at `:403`). Whichever feature merges second re-greps its anchors:
  - `src/grpc/notifyServiceImpl.ts`: 312 (`spec-ready`) modifies `listAlerts` `:196-229` (its spec `:713`, `:718`, on `origin/feature/fix-read-path-owner-trust`). A different function from Steps 3 and 7.
  - `src/telemetry.ts`: 337 (`in-progress`) modifies it (its spec `:190`). Step 7 edits only the `StreamEvictionReason` union at `:380`. Feature 329's edit is already in `fb52065c` and is absorbed by Step 1.
  - `src/__tests__/fanout.test.ts`: 337's spec (`:242`) relies on this file's existing tests staying unchanged. Step 5 moves only `withLogs` (`:243-256`) and edits no test.
  - `services/xstockstrat-notify/CLAUDE.md`: 323 (`spec-ready`) modifies it (its spec `:269`, on `origin/feature/fix-orphaned-code`); the scan reports its edit is the dead `jsonwebtoken`/`bcrypt` phrase in the `:4` banner, the same line Step 4 edits. Expect a textual conflict there; keep both removals.
  - No evidence was found on `origin/main-dev` that 324 touches a notify file (it has no implementation spec there yet); the design.md mention stands unverified.
- Open Risks from design.md and where they land: grpc-js 1.14.5 never exercised → Step 1. Status path verified on 1.14.7 only, caret range floats, `writableLength` could be renamed → Step 6 (runs in CI on whatever the lockfile resolves) and Step 8 (invariant). Recon line drift → resolved by the citation tree above. The four accepted residuals (held queue after eviction, bound scales with alert size, lazy detection, alerts lost until reconnect) have no step by design.

---

### Step 1 — docs: branch sync gate — notify on grpc-js 1.14.7 (design.md "Step 0")

**Status**: `done`
**Service**: `xstockstrat-notify` (branch-level precondition)
**Files**:
- `services/xstockstrat-notify/package.json` — verify only (already at the target; no edit)
- `pnpm-lock.yaml` — verify only (already at the target; no hand edit, no `pnpm install` that rewrites it)

**Reviewers**: none

**Codebase Evidence** (re-spec 2026-11-26, after the merge of `origin/main-dev` `2b2dec92` as `6bc876bb`):
- The target state already holds. The earlier merge `c0f0757b` ("merge main-dev into feature branch (pre-execute sync)") brought the grpc-js bump in; the feature tip `7540f38f` already pinned it.
- `git grep -n "grpc-js" HEAD -- services/xstockstrat-notify/package.json` → `:21` `"@grpc/grpc-js": "^1.14.7"`.
- `git grep -n -A8 "^  services/xstockstrat-notify:" HEAD -- pnpm-lock.yaml` → `:373` importer block, `:378-380` `'@grpc/grpc-js'` / `specifier: ^1.14.7` / `version: 1.14.7`.
- Before the sync the branch was 21 commits behind `2b2dec92`; `git diff --stat 2b2dec92...7540f38f` showed only `docs/roadmap/ledger/fails.md` (+5). After `6bc876bb` (two parents: `7540f38f`, `2b2dec92`), `git rev-list --count HEAD..origin/main-dev` → 0 and `git diff --stat origin/main-dev HEAD` shows only `docs/roadmap/ledger/fails.md`.
- The linked `services/xstockstrat-notify/node_modules/@grpc/grpc-js/package.json` reports `"version": "1.14.7"`.
- The spike ran on 1.14.7 only; 1.14.5 is not installed on the host (context.md:588-590).

**Lands with**: —

**TDD**: `N/A (branch sync; no executable logic authored)`

**Covers**: —

**Instructions**:
1. This step is a verify-only gate: the branch already carries grpc-js 1.14.7 and already contains `origin/main-dev` (merge `6bc876bb`). It authors no diff and edits no file; nothing outside this feature's directory is edited by hand.
2. If `origin/main-dev` has moved past `2b2dec92` and the branch no longer contains it, do not merge inside this step: stop and report (P-03), so the sync runs as its own BRANCH SYNC.
3. Do not run `pnpm install`. The installed grpc-js already matches the lockfile (1.14.7). If `pnpm ls` shows any other version, stop and report it (P-03).
4. The category is `docs` only because no step category fits a branch-sync gate; it authors no documentation.
5. Proceed only when (a) `origin/main-dev` is an ancestor of `HEAD`, and (b) `git diff origin/main-dev HEAD --stat` shows only this feature's directory and `docs/roadmap/ledger/fails.md`. Any other path in that diff is a hand edit that does not belong on this branch: stop and report (P-03).

**Verification**:
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
If either of the first two checks fails, the eviction unit (Steps 5–7) does not start.

---

### Step 2 — test: AC-1 string-enum severity filter test, and string-form severity fixtures

**Status**: `done`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts` — modify

**Reviewers**: `xstockstrat-notify` owner — Stream delivery guarantees, backpressure handling, alert deduplication

**Codebase Evidence**:
- `grep -n "severity: [0-9]" src/__tests__/notifyServiceImpl.test.ts` → the fan-out fixtures are `:120` (`makeAlert` default `severity: 2`, function at `:117-127`) and `:698` (`makeAlert({ severity: 3 })`). The other hits (`:138`, `:160`, `:812`, `:899`, `:905`, `:911`, `:927`, `:952`) are DB rows passed to `rowToAlert`; the column is INTEGER, so they stay numeric (NOTIFY-1).
- The numeric-only test: `it('filters by severity when severities array is set', …)` at `:696-701`, with `severities: [1, 2]` at `:699`. It is a negative case only.
- Helpers to reuse (C-13): `makeImpl` `:55`, `registerSubscriber` `:324` (mock shape `{ request, on() {}, write(alert) {…} }`), `emitAndFlush` `:335`, `REQ` `:353` (defaults `severity: 'ALERT_SEVERITY_WARNING'`).
- The filter under test: `src/grpc/notifyServiceImpl.ts:392` `if (sub.severities.length > 0 && !sub.severities.includes(alert.severity))`; registration `:162` `severities: req.severities ?? []`; the fan-out alert keeps the string at `:108` `severity: req.severity`.
- Enum names: `packages/proto/notify/v1/notify.proto:65-70` (`enum AlertSeverity` at `:65`, `ALERT_SEVERITY_UNSPECIFIED` = 0 at `:66`, `ALERT_SEVERITY_INFO` = 1 at `:67` … `ALERT_SEVERITY_CRITICAL` = 4 at `:70`).
- `fanout.test.ts:49-62` has its own `makeAlert`, already string-form (`severity: 'ALERT_SEVERITY_WARNING'`); it is not touched.
- Break radius: `tsconfig.json` `include: ["src/**/*"]` compiles tests, `strict: false`. `makeAlert` returns an untyped literal and is used only at `:663-712` of this file, so changing its default breaks no compile.

**Lands with**: —

**TDD**: `red-green required`. The runtime compare is already string-vs-string, so this test passes on the unfixed tree: the defect is the type annotation plus the missing test, not live behaviour. The RED is therefore a **mutation red**, taken from product-spec.md § Reproduction Steps 1 and never committed: temporarily change `notifyServiceImpl.ts:392` to compare `alertSeverityToNumber(alert.severity)`, run the suite, and capture (a) the new `@AC-1` test failing on "the subscriber receives the alert", and (b) the pre-existing numeric test at `:696-701`, in its pre-edit form, still passing. Revert the mutation, re-run, capture green. Record it in `context.md` as "AC-1 mutation red" (the `tdd-gate.md` "behavior already exists" case, stated explicitly, P-03). Because the mutation is never committed, that `context.md` entry and the PR body are the only evidence: both carry the three command outputs (mutated red, the old numeric test passing under the mutation, reverted green), and the step is not marked `done` without them. Before committing, `git diff -- services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts` must be empty (the mutation is fully reverted).

**Covers**: `AC-1`

**Instructions**:
1. Add one test in the `describe('streamAlerts', …)` block (`:722`), named so it carries the tag, for example `it('@AC-1: a subscriber filtered to WARNING and CRITICAL receives a CRITICAL alert and not an INFO alert', …)`. Drive it through the public path, not `matchesSubscriber`:
   - `const impl = makeImpl();`
   - register with `impl.streamAlerts({ request: { userId: '', categories: [], severities: ['ALERT_SEVERITY_WARNING', 'ALERT_SEVERITY_CRITICAL'], includeAcknowledged: false }, on() {}, write(alert) { received.push(alert); } })`;
   - `await emitAndFlush(impl, REQ({ severity: 'ALERT_SEVERITY_CRITICAL' }))` → `received.length === 1` and `received[0].severity === 'ALERT_SEVERITY_CRITICAL'`;
   - `await emitAndFlush(impl, REQ({ severity: 'ALERT_SEVERITY_INFO' }))` → `received.length` is still 1.
2. Convert the two fan-out fixtures to the wire form:
   - `makeAlert` default (`:120`): `severity: 'ALERT_SEVERITY_WARNING'`.
   - the test at `:696-701`: `makeAlert({ severity: 'ALERT_SEVERITY_ERROR' })` and `severities: ['ALERT_SEVERITY_INFO', 'ALERT_SEVERITY_WARNING']`; the expected result stays `false`.
3. Leave every `rowToAlert` row numeric.
4. C-13 verdict: the request literal in instruction 1 has one consumer (this test); inline is compliant. No fixture module is created.

**Verification**:
```bash
(cd services/xstockstrat-notify && pnpm run lint)
(cd services/xstockstrat-notify && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40)
# expect: exit 0 from all three
grep -n "severity: [0-9]\|severities: \[[0-9]" services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts
# expect: only rowToAlert DB rows remain; no makeAlert(...) or severities: [...] line is numeric
test "$(grep -c "__tests__/fixtures" services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts)" = 0
# expect: exit 0 (C-13: no fixtures import added by this step; single-consumer inline literal)
```

---

### Step 3 — service: type `StreamSubscriber.severities` as `AlertSeverity[]`

**Status**: `done`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts` — modify

**Reviewers**: `xstockstrat-notify` owner — Stream delivery guarantees, backpressure handling, alert deduplication

**Codebase Evidence**:
- `grep -n "severities" src/grpc/notifyServiceImpl.ts` → `:31` `severities: number[];` inside `interface StreamSubscriber` (`:28-34`); `:162` registration; `:392` filter.
- Import line `:3`: `import { alertSeverityToNumber, alertSeverityFromJSON } from '@xstockstrat/proto/notify/v1/notify';`
- Reuse pattern (recon.md § Patterns to REUSE): `src/fanout/fanout.ts:6` `import { alertSeverityToNumber, AlertSeverity } from '@xstockstrat/proto/notify/v1/notify';` (also `webPush.ts:8`, `webhookWorker.ts:5`, `commsgunWorker.ts:2`).
- Break radius: `StreamSubscriber` is not exported. `streamAlerts(call: any)` (`:155`) and `matchesSubscriber(alert: any, sub: StreamSubscriber)` (`:385`) are reached from tests only through `any` (`(impl as any).matchesSubscriber(alert, sub)` at test `:665-714`), so no test call site fails `tsc`.

**Lands with**: —

**TDD**: `red-green required`. Paired with Step 2; the type change has no runtime effect, so this step has no natural red of its own. The red is Step 2's mutation red and this step's proof is `tsc` plus the suite staying green. `/sdd-execute` states that explicitly instead of skipping the gate: it records "red N/A — no behavior change (type-only); covered by Step 2's AC-1 mutation red" in `context.md` and the PR body, with this step's green run (`tdd-gate.md:55-58`, P-03).

**Covers**: —

**Instructions**:
1. Add `AlertSeverity` to the import at `:3`.
2. Change `:31` to `severities: AlertSeverity[];`.
3. Change nothing else: `:162` (`req.severities ?? []`) and the string compare at `:392` stay as they are (D-1, NOTIFY-1).

**Verification**:
```bash
(cd services/xstockstrat-notify && pnpm run lint)
(cd services/xstockstrat-notify && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40)
grep -n "severities: AlertSeverity\[\]" services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts
# expect: one hit, in interface StreamSubscriber
grep -n "sub.severities.includes(alert.severity)" services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts
# expect: one hit, unchanged
```

---

### Step 4 — docs: retire the severity-mismatch records and flip that report's sidecar

**Status**: `done`
**Service**: `xstockstrat-notify` (`services/xstockstrat-notify/`, `docs/reports/`)
**Files**:
- `services/xstockstrat-notify/CLAUDE.md` — modify
- `services/xstockstrat-notify/docs/context-constitution-findings.md` — modify
- `docs/reports/2026-10-19-notify-severities-type-runtime-mismatch-defect.status` — modify

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-notify/CLAUDE.md:4` (inside the `context-forge:constitution-pointer` block): "defects (dead `jsonwebtoken`/`bcrypt` deps, `severities` type/runtime mismatch)".
- `context-constitution-findings.md:24`, a row of `## Latent bugs`: "Severity filter type/runtime mismatch: `StreamSubscriber.severities: number[]` vs the runtime string enum …".
- `context-constitution-findings.md:72`, a row of `## Filed as defect reports (2026-10-19)`, linking `2026-10-19-notify-severities-type-runtime-mismatch-defect`. The section says "A row stays here until its report is resolved."
- `## Resolved` starts at `context-constitution-findings.md:46`; entries read `- **RESOLVED <date> — <what>, by feature …**`. A resolved report row keeps its place with a "**resolved (feature NNN …)**" note (`:74`).
- Sidecar today: line 1 `triaged`, line 2 `ref: feature:316-fix-notify-stream-contract`. Format: `.claude/skills/sdd-qa/reference/defect-filing.md:32-35`.
- **Not found**: the gotcha recon cited at `services/xstockstrat-notify/docs/context-constitution.md:31`. `grep -n -i "severities\|number\[\]" services/xstockstrat-notify/docs/context-constitution.md` returns nothing at `fb52065c`, so that file needs no edit in this step.

**Lands with**: —

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. `CLAUDE.md:4`: remove ", `severities` type/runtime mismatch" from the defects parenthetical. Change nothing else in the banner.
2. `context-constitution-findings.md`: delete the `:24` row from `## Latent bugs`; add one entry at the top of `## Resolved`: the severity filter type/runtime mismatch is resolved by feature `316-fix-notify-stream-contract` (`StreamSubscriber.severities` is `AlertSeverity[]`; the `@AC-1` test covers the string form). Append "— **resolved (feature 316)**, see the Resolved section" to the `:72` report row.
3. Sidecar: line 1 becomes `resolved`; line 2 stays `ref: feature:316-fix-notify-stream-contract`.
4. The `resolved` flip follows D-8 (design.md § Chosen Approach). `defect-filing.md:41` and `:45-46` would also accept leaving it `triaged` until launch; the design chose the flip, so the spec follows it.

**Verification**:
```bash
grep -n "type/runtime mismatch" services/xstockstrat-notify/CLAUDE.md
# expect: no output
grep -n "Severity filter type/runtime mismatch" services/xstockstrat-notify/docs/context-constitution-findings.md
# expect: no hit under "## Latent bugs"; the RESOLVED entry names feature 316
head -2 docs/reports/2026-10-19-notify-severities-type-runtime-mismatch-defect.status
# expect: resolved / ref: feature:316-fix-notify-stream-contract
```

---

### Step 5 — test: AC-2 mock unit tests for the bounded queue and the status-path eviction

**Status**: `done`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts` — modify
- `services/xstockstrat-notify/src/__tests__/fixtures/withLogs.ts` — create
- `services/xstockstrat-notify/src/__tests__/fanout.test.ts` — modify (import the moved helper; no test changes)

**Reviewers**: `xstockstrat-notify` owner — Stream delivery guarantees, backpressure handling, alert deduplication

**Codebase Evidence**:
- Mock shape to copy: the feature-294 eviction test, `notifyServiceImpl.test.ts:752-774` (`describe('StreamAlerts eviction telemetry (feature 294)', …)`): `impl.streamAlerts({ request, on() {}, write(alert) {…} })`, `await emitAndFlush(impl, REQ())`, `counterValue(reader, 'notify.stream.evictions', 'reason', 'write_error')`, `values(reader, 'notify.stream.subscribers')`, `(impl as any).subscribers.size`.
- Metric helpers: `src/__tests__/fixtures/collectingReader.ts` `install` (`:14`), `values` (`:36`), `counterValue` (`:43`); imported at test `:28`. `counterValue` sums to 0 for a label with no points.
- Listener capture precedent: test `:722-746` records the `'cancelled'` handler through `on(event, handler)` and invokes it.
- Log capture: `withLogs` is defined privately at `src/__tests__/fanout.test.ts:243-256` (patches `transports.Console.prototype.log`, `import { transports } from 'winston'` at `:13`) and used at `:340`, `:355` and later. Records carry the raw level at `Symbol.for('level')` and the meta fields at top level (`:344-347`). This step makes a second consumer, so the helper moves to the fixtures home (DRY guard rail; `src/__tests__/fixtures/` already holds `collectingReader.ts`, `fakeConfig.ts`, `scriptedPool.ts`, `stubFetch.ts`, `fakeCommsgun.ts`).
- Code under test after Step 7: the loop at `src/grpc/notifyServiceImpl.ts:122-133`; the listeners at `:174-181`; the log lines `log.warn('StreamAlerts subscriber evicted', { reason: 'write_error' })` (`:130`), `log.info('Alert emitted', { …, delivered: deliveredCount })` (`:134`), `log.info('StreamAlerts subscriber disconnected', { subId })` (`:175`).
- The `@AC-32` test (`:753`) uses mocks with no `writableLength`; `undefined >= 1024` is false, so it is unaffected and is not edited.
- The `@AC-5` test (`:618`) and the feature-242 `@AC-1` test (`:637`) use `registerSubscriber`, also without `writableLength`; unaffected.
- Break radius: the new tests name no symbol Step 7 creates. They read `(impl as any).subscribers` and pass the plain string `'backpressure'` to `counterValue`, so they compile on the pre-Step-7 tree and fail on behaviour.

**Lands with**: `Step 6, Step 7`

**TDD**: `red-green required`. RED on the tree without Step 7, captured per case: after emit 1025 the mock's write count is 1025 not 1024, `subscribers.size` is 1 not 0, `evictions{backpressure}` is 0 not 1, and `emit` was never called. The negative case and the unchanged `@AC-32` test pass before and after (characterization). Capture with `pnpm exec tsc && node --test --test-name-pattern="AC-2" dist/__tests__/notifyServiceImpl.test.js`.

**Covers**: `AC-2`

**Instructions**:
1. Move `withLogs` verbatim from `fanout.test.ts:242-256` to a new `src/__tests__/fixtures/withLogs.ts` as a named export, with its `transports` import. In `fanout.test.ts`, delete the local definition, import it from `./fixtures/withLogs.js`, and drop the `winston` import at `:13` only if `grep -n "transports" src/__tests__/fanout.test.ts` shows no other use.
2. In `notifyServiceImpl.test.ts`, add `describe('StreamAlerts backpressure eviction (feature 316)', …)` after the feature-294 block (`:774`). Build one local mock factory for a stalled call (D-12):
   - `request: { userId: 'u-slow', categories: [], severities: [], includeAcknowledged: false }`;
   - `on(event, handler)` records listeners per event;
   - `write()` counts the call, increments `writableLength`, returns `false`;
   - `emit(event, arg)` is a spy: it records `[event, arg]`, records `(impl as any).subscribers.size` at that moment, then calls every listener recorded for `event` (models grpc-js's synchronous dispatch).
   Emit with a plain promise wrapper around `impl.emitAlert({ request: REQ() }, cb)`; the fan-out is the no-op from `makeImpl`, so the timer flush in `emitAndFlush` is not needed for 1026 emits.
3. Test `@AC-2: a subscriber with 1024 queued alerts is evicted on the next matching alert` (exact counts, O-3):
   - emits 1–1024: 1024 writes, `subscribers.size === 1`, `emit` not called;
   - emit 1025: writes still 1024; `subscribers.size === 0`; `evictions{backpressure} === 1`; `evictions{stream_error} === 0`; `emit` called exactly once with `'error'` and `{ code: 8, details: 'slow consumer evicted' }` (`Number.isInteger(code)`, `typeof details === 'string'`); the size recorded inside the spy is 0 (the map delete came first);
   - under `withLogs`: one `warn` record with message `StreamAlerts subscriber evicted` and `reason: 'backpressure'`; the `Alert emitted` record of emit 1025 has `delivered: 0` (the evicting alert is neither written nor counted, D-5);
   - emit 1026: writes still 1024;
   - invoke the recorded `'cancelled'` listener under `withLogs`: `subscribers.size` stays 0, the counters do not change, and no `StreamAlerts subscriber disconnected` record is written (D-16, D-21).
4. Negative test: a mock whose `write` returns `false` but whose `writableLength` stays 0. After 1026 emits: 1026 writes, `subscribers.size === 1`, `evictions{backpressure} === 0`.
5. Test `@AC-5: a throwing teardown never fails EmitAlert`: a mock with `writableLength` preset to 1024 and an `emit` that throws. `emitAlert` calls back with no error and an `alertId`; `subscribers.size === 0`; `evictions{backpressure} === 1`; one `warn` record with message `StreamAlerts eviction teardown failed` (D-10).
6. Test for the guarded `'error'` listener (D-14, extends `@AC-32`): register a normal subscriber, invoke its recorded `'error'` listener twice. `evictions{stream_error} === 1` (not 2) and `subscribers.size === 0`.
7. Do not edit the `@AC-32` test at `:753-774`.
8. C-13 verdict: the stalled-call mock is a test double, not domain data, and has one consumer; `REQ` is reused from this file. No domain literal gains a second consumer.

**Verification**:
```bash
(cd services/xstockstrat-notify && pnpm run lint)
(cd services/xstockstrat-notify && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40)
# expect: exit 0 (green only together with Steps 6 and 7 — one unit)
grep -n "function withLogs\|Console.prototype.log" services/xstockstrat-notify/src/__tests__/fanout.test.ts
# expect: no output (the helper lives only in fixtures/withLogs.ts)
grep -n "__tests__/fixtures\|fixtures/withLogs" services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts services/xstockstrat-notify/src/__tests__/fanout.test.ts
# expect: both files import ./fixtures/withLogs.js
(cd services/xstockstrat-notify && pnpm exec tsc && node --test --test-name-pattern="AC-32" dist/__tests__/notifyServiceImpl.test.js)
# expect: the unedited @AC-32 test ran and passed (1 test executed, 0 failed)
```

---

### Step 6 — test: real-grpc-js eviction test — spike conditions (f) and (g)

**Status**: `done`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts` — modify

**Reviewers**: `xstockstrat-notify` owner — Stream delivery guarantees, backpressure handling, alert deduplication

**Codebase Evidence**:
- Binding: operator ruling of 2026-11-20 (context.md "Session 2026-11-20 — sdd-design", Binding from round 5) and design.md § Real-grpc-js test: an in-process server plus a paused raw `node:http2` client, asserting (f) and (g). It answers O-14.
- Spike method and results this test reproduces: context.md:594-598 and the `emit('error')` column at `:602-617`; verbatim run `=== teardown=emit-error client=raw ===` at `:672-682` (trailers `grpc-status: 8`, `grpc-message: slow%20consumer%20evicted`; `sendMessageCallsDuringStallAfterEviction: 0`).
- Why a raw http2 client: an in-process grpc-js client with no `'data'` listener keeps reading and does not stall the server (context.md:595; product-spec.md § Reproduction Steps 2).
- Real server wiring to copy: `src/index.ts:59-60` `new grpc.Server()` + `addService(createNotifyServiceDefinition(), notifyImpl as unknown as grpc.UntypedServiceImplementation)`; `createNotifyServiceDefinition` is `src/grpc/serviceDefinition.ts:4`.
- In-process insecure bind precedent: `src/__tests__/telemetry.export.test.ts:359-361` (`new grpc.Server()`, `addService`, `server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, port) => …)`), teardown `server.forceShutdown()` (`:369`).
- grpc import form in notify tests: `import * as grpc from '@grpc/grpc-js';` (`src/__tests__/webPush.test.ts:13`).
- The handler key is `streamAlerts`: `notifyServiceImpl.ts:155` is registered by name through `addService` (`index.ts:60`). RPC: `packages/proto/notify/v1/notify.proto:18` `rpc StreamAlerts(StreamAlertsRequest) returns (stream Alert);`, package `xstockstrat.notify.v1` (`:3`).
- **Not found**: any `node:http2` use in notify (`grep -rn "http2" services/xstockstrat-notify/src` returns nothing). The raw client is written from scratch; no existing pattern in this service.
- Why it lives in `notifyServiceImpl.test.ts`: it needs `makeImpl` (`:55`) and `REQ` (`:353`), which are private to that file. A separate test file would make a second consumer of the `REQ` domain literal and force a fixture move (C-13); adding a `describe` here does not.
- `pnpm run test` runs `tsc && node --test dist/__tests__/*.test.js` (`package.json:12`), so the test runs in CI's notify job on whatever grpc-js the lockfile resolves.

**Lands with**: `Step 5, Step 7`

**TDD**: `red-green required`. RED on the tree without Step 7: the subscriber is never evicted, so the emit loop reaches its bound and the assertion "the stalled subscriber was evicted" fails (`subscribers.size` is 1). That is a behaviour failure, not a compile or import error.

**Covers**: `AC-2`

**Instructions**:
1. Add imports: `import * as grpc from '@grpc/grpc-js';`, `import * as http2 from 'node:http2';`, `import { createNotifyServiceDefinition } from '../grpc/serviceDefinition.js';`.
2. Add `describe('StreamAlerts backpressure over real grpc-js (feature 316)', …)` with one test, `{ timeout: 20000 }`, named with the tag, for example `@AC-2: a paused http2 client is evicted at 1024 queued alerts and gets grpc-status 8 after it resumes`.
3. Arrange:
   - `const reader = install(); const impl = makeImpl();`
   - `const def = createNotifyServiceDefinition();` real `grpc.Server`, `addService(def, impl as unknown as grpc.UntypedServiceImplementation)`, bind `127.0.0.1:0` with `grpc.ServerCredentials.createInsecure()`.
   - Client: `http2.connect('http://127.0.0.1:' + port)`, then `session.request({ ':method': 'POST', ':path': def.streamAlerts.path, 'content-type': 'application/grpc', te: 'trailers' })`. Send one gRPC-framed empty request (a 5-byte prefix: compression flag 0 and a 4-byte big-endian length, then `def.streamAlerts.requestSerialize({ userId: '', categories: [], severities: [], includeAcknowledged: false })`) and end the request side. Attach **no** `'data'` listener: that is the stall. Attach a `'trailers'` listener that stores the trailers.
   - Wait, bounded, until `(impl as any).subscribers.size === 1`. Take that subscriber's `call`, and wrap its `write` to count calls and track the highest `call.writableLength` seen.
4. Act: emit `REQ({ body: 'x'.repeat(1024) })` through `impl.emitAlert` in a loop, yielding one `setImmediate` after each emit so the h2 window fills, until `subscribers.size === 0` or 3000 emits. Assert the subscriber was evicted. Record the write count at eviction.
5. Assert (f), client still paused:
   - the highest `writableLength` seen is ≤ 1024, and `call.writableLength` is ≤ 1024 now;
   - 10 further emits do not change the write count;
   - after a 100 ms hold the client has no trailers yet (the status is queued behind the window).
6. Resume: attach a `'data'` listener that counts gRPC frames by walking the 5-byte length prefixes across chunk boundaries. Wait, bounded at 5 s, for the stream's `'end'`.
7. Assert (g):
   - the client received exactly as many alerts as the write count at eviction;
   - trailers: `grpc-status` is `'8'` and `grpc-message` is `'slow%20consumer%20evicted'`;
   - `evictions{backpressure} === 1` and `evictions{stream_error} === 0` (`counterValue`).
8. Clean up in `finally`: destroy the http2 session and `server.forceShutdown()`.
9. Do not assert the exact eviction attempt (the spike's 1088): it depends on the h2 window. The test hardcodes no port.
10. Timing bounds. The test has three: the 3000-emit cap, the 100 ms hold and the 5 s wait for `'end'`. Every wait is a bounded poll on a condition, except the 100 ms hold, which is a negative check (no trailers while the client is paused). This is also the first `node:http2` use in notify, and CI runs it on whatever grpc-js the lockfile resolves. If the repeat run in Verification shows a failure, `/sdd-execute` does not widen a bound, add a retry or skip the test on its own: it stops, records the failing output in the Deviation Log and `context.md`, and reports (P-03). A failure here may be the grpc-js status path changing, which is what the test exists to catch.

**Verification**:
```bash
(cd services/xstockstrat-notify && pnpm run lint)
(cd services/xstockstrat-notify && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40)
# expect: exit 0 (green only together with Steps 5 and 7 — one unit)
(cd services/xstockstrat-notify && pnpm exec tsc && node --test --test-name-pattern="real grpc-js" dist/__tests__/notifyServiceImpl.test.js)
# expect: the one real-grpc-js test ran (1 test executed, 0 failed) — not 0 tests matched
(cd services/xstockstrat-notify && for i in 1 2 3 4 5 6 7 8 9 10; do node --test --test-name-pattern="real grpc-js" dist/__tests__/notifyServiceImpl.test.js > /dev/null 2>&1 || echo "run $i failed"; done)
# expect: no output (10 consecutive passes; run once Step 7 is in, as part of the unit's union Verification)
grep -n "node:http2\|createInsecure" services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts
# expect: the raw http2 client and the insecure in-process server are present
```

---

### Step 7 — service: bounded StreamAlerts queue with a `RESOURCE_EXHAUSTED` status-path eviction

**Status**: `done`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts` — modify
- `services/xstockstrat-notify/src/telemetry.ts` — modify
- `services/xstockstrat-notify/CLAUDE.md` — modify
- `docs/roadmap/features/316-fix-notify-stream-contract/acceptance.feature` — modify

**Reviewers**: `xstockstrat-notify` owner — Stream delivery guarantees, backpressure handling, alert deduplication

**Codebase Evidence**:
- Module constants: `notifyServiceImpl.ts:14-17` (`FANOUT_WEBHOOK_PEER_SANS`, `WEBHOOK_NAME_MAX_CHARS`, `WEBHOOK_PAYLOAD_MAX_BYTES`, `ALERT_ID_RE`).
- The loop, inside `private async persistAndBroadcast(req: any)` (`:79`):
  ```ts
  let deliveredCount = 0;                                        // :121
  for (const [subId, sub] of this.subscribers) {                 // :122
    if (this.matchesSubscriber(alert, sub)) {                    // :123
      try {
        sub.call.write(alert);                                   // :125
        deliveredCount++;                                        // :126
      } catch {
        this.subscribers.delete(subId);                          // :128
        recordStreamEviction('write_error');                     // :129
        log.warn('StreamAlerts subscriber evicted', { reason: 'write_error' });   // :130
      }
    }
  }
  ```
- Listeners in `streamAlerts` (`:155`):
  ```ts
  call.on('cancelled', () => {                                   // :174
    log.info('StreamAlerts subscriber disconnected', { subId }); // :175
    this.subscribers.delete(subId);                              // :176
  });
  call.on('error', () => {                                       // :178
    this.subscribers.delete(subId);                              // :179
    recordStreamEviction('stream_error');                        // :180
  });
  ```
- Bare numeric status codes, no `grpc` import in this file: `:55` (`code: 3`), `:68` (`code: 13`), `:348` (`code: 7`); house style recorded at `docs/context-constitution.md:48` (D-13, R-9).
- Teardown-catch log idiom: `:144` `log.warn('fanout dispatch rejected', { alertId, error: e?.message ?? String(e) })`.
- Telemetry: `src/telemetry.ts:380` `export type StreamEvictionReason = 'write_error' | 'stream_error';`; `:397` `export function recordStreamEviction(reason: StreamEvictionReason): void`; counter `notify.stream.evictions` at `:387`. Imported at `notifyServiceImpl.ts:9`.
- No other consumer of the union: `grep -rn "StreamEvictionReason\|stream_error\|write_error" services/xstockstrat-notify/src` hits only `telemetry.ts`, `notifyServiceImpl.ts`, `__tests__/telemetryAllowlist.test.ts:36` (records `write_error` only; pins instrument names, not label values) and the `@AC-32` test. Repo-wide, `git grep -l "stream_error"` outside notify hits only the agent's unrelated OAuth metric.
- Doc line: `services/xstockstrat-notify/CLAUDE.md:125`, in `## Observability` (`:122`): "`notify.stream.evictions{reason write_error|stream_error}`".
- Scenario text: `acceptance.feature:16` `Given a StreamAlerts subscriber whose call.write returns false and never emits drain`.
- Spike facts the code rests on (grpc-js 1.14.7): `writableLength` is a number and a live depth in messages, 1024 at the eviction (context.md:621); `emit('error', { code: 8, details })` flushes the capped queue then sends `grpc-status: 8` (`:612-613`); one write after the emit raises `ERR_STREAM_WRITE_AFTER_END` and no status is ever sent (`:623`); the status path emits `finish`, `cancelled`, `close` on the server (`:624`).
- Header propagation: no new outbound gRPC call is added; §B does not apply.
- Break radius: no signature, constructor or return shape changes. Widening a string union and adding a module constant breaks no caller. Existing mocks carry no `writableLength`, so `undefined >= 1024` is false and they behave as before.

**Lands with**: `Step 5, Step 6`

**TDD**: `red-green required`. RED is Steps 5 and 6 failing on the tree without this step; GREEN is the unit's union Verification.

**Covers**: —

**Instructions**:
1. `telemetry.ts:380`: widen to `'write_error' | 'stream_error' | 'backpressure'`. Add no instrument (D-3).
2. `notifyServiceImpl.ts`, after `:17`: add the module constant `MAX_QUEUED_ALERTS = 1024` (messages). It is a memory-safety bound, not a config key (D-4, F-07 rationale in design.md). A comment, if any, states only the constraint, in at most two lines.
3. In the loop, inside the `matchesSubscriber` branch (`:123`) and before the existing `try` (`:124`), add the check and the eviction, all synchronous, in exactly this order (D-5, D-15):
   ```ts
   if (sub.call.writableLength >= MAX_QUEUED_ALERTS) {
     this.subscribers.delete(subId);
     recordStreamEviction('backpressure');
     log.warn('StreamAlerts subscriber evicted', { reason: 'backpressure' });
     try {
       sub.call.emit('error', { code: 8, details: 'slow consumer evicted' });
     } catch (e: any) {
       log.warn('StreamAlerts eviction teardown failed', { error: e?.message ?? String(e) });
     }
     continue;
   }
   ```
   - The map delete comes before the emit; this order is load-bearing (context.md:623).
   - The code is the bare numeric `8`; do not import `grpc` (R-9).
   - Never `call.destroy()` and never a bare `call.end()` (R-10, R-11). Add no timer, no `'drain'` listener, no private grpc-js access (R-1, R-4, R-8), and no `typeof` guard (D-5).
   - The evicting alert is not written and `deliveredCount` is not incremented.
   - The existing `write` call and its `write_error` catch (`:124-131`) are unchanged.
4. Guard both listeners on the `Map.delete` result (D-3, D-14, D-16):
   - `'cancelled'` (`:174-177`): log `StreamAlerts subscriber disconnected` only when `this.subscribers.delete(subId)` returned true.
   - `'error'` (`:178-181`): call `recordStreamEviction('stream_error')` only when `this.subscribers.delete(subId)` returned true. Our own `emit('error')` therefore counts no `stream_error`, and a stream error that arrives after the entry is gone is not counted.
5. `CLAUDE.md:125`: change the reason list to `reason write_error|stream_error|backpressure`. Add, in the same `## Observability` section, one line: a subscriber with 1024 queued alerts is evicted with gRPC status 8, and `stream_error` counts only an error that removed a live subscriber.
6. `acceptance.feature:16`: amend the AC-2 Given to the queued-write-length trigger (D-8; EXTEND, design.md § Business Rules Touched): `Given a StreamAlerts subscriber whose stream has 1024 alerts queued and unwritten`. Keep the tag, the scenario title, the When and both Then lines. Do not renumber or add scenarios.
7. Add no config key, env var, migration or proto change.

**Verification**:
```bash
(cd services/xstockstrat-notify && pnpm run lint)
(cd services/xstockstrat-notify && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40)
# expect: exit 0, with the Step 5 and Step 6 tests executed and passing
grep -n "MAX_QUEUED_ALERTS" services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts
# expect: the constant (= 1024) and one use, `sub.call.writableLength >= MAX_QUEUED_ALERTS`
grep -n "call.destroy\|call.end(\|grpc-js\|'drain'" services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts
# expect: no output
grep -n "'backpressure'" services/xstockstrat-notify/src/telemetry.ts services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts
# expect: the widened union and the recordStreamEviction('backpressure') call
grep -n "write_error|stream_error|backpressure" services/xstockstrat-notify/CLAUDE.md
# expect: one hit in ## Observability
grep -n "1024 alerts queued" docs/roadmap/features/316-fix-notify-stream-contract/acceptance.feature
# expect: the amended AC-2 Given; `grep -c "@AC-" ` on the file still prints 2
```

---

### Step 8 — docs: add the `NOTIFY-*` grpc-js status-path invariant, retire the backpressure records, flip that report's sidecar

**Status**: `done`
**Service**: `xstockstrat-notify` (`services/xstockstrat-notify/docs/`, `docs/reports/`)
**Files**:
- `services/xstockstrat-notify/docs/context-constitution.md` — modify
- `services/xstockstrat-notify/docs/context-constitution-findings.md` — modify
- `docs/reports/2026-10-19-notify-stream-ignores-backpressure-defect.status` — modify

**Reviewers**: none

**Codebase Evidence**:
- `context-constitution.md:12` is the rules table header `| ID | Rule | Why | Evidence | Example (canonical \`path:line\`) |`. The last rule is `NOTIFY-17` (`:29`); `:3` notes there is no `NOTIFY-2`. The next free ID at `fb52065c` is `NOTIFY-18`.
- `context-constitution.md:48` (Pointers): "All RPC errors collapse to a bare numeric gRPC code `13` … `grpc.status` is never imported". The bare `8` is consistent with it; the row is not edited.
- `context-constitution-findings.md:37`, in `## Open questions`: "Fan-out ignores `call.write()` backpressure (drops only on thrown exception, no `drain`) … — status: **open**".
- `context-constitution-findings.md:73`, the report row for `2026-10-19-notify-stream-ignores-backpressure-defect`; `## Resolved` starts at `:46`.
- Sidecar today: line 1 `triaged`, line 2 `ref: feature:316-fix-notify-stream-contract`.
- **Not found**: the backpressure gotcha recon and D-8 cited at `services/xstockstrat-notify/docs/context-constitution.md:30`. `grep -n -i "backpressure" services/xstockstrat-notify/docs/context-constitution.md` returns nothing at `fb52065c`; there is nothing to retire in that file.
- Content of the invariant (D-20; operator ruling of 2026-11-20): grpc-js 1.14.7 `server-call.js:121-124` (the server-stream `'error'` listener sets the pending status and calls `end()`) and `:152-156` (`_final` → `sendStatus`); verified on 1.14.7 only (context.md:590).

**Lands with**: —

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. `context-constitution.md`: add one row after `NOTIFY-17`, using the next free `NOTIFY-*` ID at execute time (`NOTIFY-18` at `fb52065c`), in the table's five columns. It records exactly three things:
   - **Rule**: the StreamAlerts backpressure eviction removes the subscriber from the map and only then tears the stream down with `call.emit('error', { code: 8, details })`. The teardown relies on grpc-js's own server-stream `'error'` listener chain: `'error'` → `end()` → `_final` → `sendStatus`.
   - **Why**: `destroy()` sends no status and drops the queue, a bare `end()` reports OK, and one write after the emit means no status is ever sent. The chain was verified on grpc-js 1.14.7 only.
   - **Evidence / Example**: `src/grpc/notifyServiceImpl.ts#persistAndBroadcast` (the `MAX_QUEUED_ALERTS` check), the real-grpc-js test in `src/__tests__/notifyServiceImpl.test.ts` ("StreamAlerts backpressure over real grpc-js"), and the instruction that a grpc-js bump must re-run the spike (feature 316 context.md, "D-7 spike results").
2. `context-constitution-findings.md`: delete the `:37` open question; add one entry at the top of `## Resolved`: fan-out backpressure is resolved by feature `316-fix-notify-stream-contract` (a subscriber with 1024 queued alerts is evicted with status 8). Append "— **resolved (feature 316)**, see the Resolved section" to the `:73` report row.
3. Sidecar: line 1 becomes `resolved`; line 2 stays `ref: feature:316-fix-notify-stream-contract` (D-8; same note as Step 4 instruction 4).
4. Do not record the accepted residuals here; they live in design.md § Accepted residuals.
5. Before writing the row, confirm the lockfile still resolves the grpc-js version Step 1 verified (first Verification command). If it changed between Step 7 and this step, stop: the row's "verified on 1.14.7 only" would be false, and the spike must be re-run first (P-03).

**Verification**:
```bash
grep -n -A8 "^  services/xstockstrat-notify:" pnpm-lock.yaml
# expect: unchanged since Step 1 — '@grpc/grpc-js' / specifier: ^1.14.7 / version: 1.14.7
grep -n "NOTIFY-18\|sendStatus" services/xstockstrat-notify/docs/context-constitution.md
# expect: the new rule row, naming the 'error' → end() → _final → sendStatus chain, 1.14.7 only, re-run the spike on a bump
grep -n "ignores \`call.write()\` backpressure" services/xstockstrat-notify/docs/context-constitution-findings.md
# expect: no hit under "## Open questions"; the RESOLVED entry names feature 316
head -2 docs/reports/2026-10-19-notify-stream-ignores-backpressure-defect.status
# expect: resolved / ref: feature:316-fix-notify-stream-contract
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
