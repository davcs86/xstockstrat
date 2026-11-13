# Implementation Spec: fix-telemetry-startup-log

**Status**: `pending`
**Created**: 2026-11-13
**Feature**: `docs/roadmap/features/329-fix-telemetry-startup-log/feature.md`
**Total Steps**: 19
**Feature Branch**: `feature/fix-telemetry-startup-log`
**Tree**: `detached@26a61637 ≡ origin/feature/fix-telemetry-startup-log`. That branch is based on `main-dev@c4fd48b0a` and is 41 commits behind `origin/main-dev@52f6d5a6`. It was not synced here: this run may edit only the feature directory, so the `main-dev` merge is deferred to `/sdd-execute` BRANCH SYNC. All code evidence below was read from `origin/main-dev@52f6d5a6` (`git archive`), which is the tree design D-15 re-grepped. Those lines are where Step 1 starts once BRANCH SYNC has merged `main-dev`.

---

## Execution Summary

The work is nine per-service atomic units plus one docs step. Each unit is a `test` step followed by its `service` step, joined by `**Lands with**`. The test is RED by design until the one-token fallback lands, so the two steps commit as one unit with one red→green cycle (`step-constraints.md` §C; design § Delivery: failing tests first, then the edits, then docs).

Order:
1. **Node leaves (Steps 1-8):** config, identity, ledger, notify. These go first because the open risk "pinned Node SDK may throw on `""`" is decided at the first leaf unit (config, Step 1).
2. **UI (Steps 9-10).**
3. **Python (Steps 11-18):** analysis, indicators, ingest, agent.
4. **Docs (Step 19):** the UI `CLAUDE.md` line, last, so it describes shipped behaviour.

Every production edit is value-only at the `endpoint` read site (design D-1):
- Node: `process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'SDK default'` (D-2, D-7).
- Python: `os.getenv(...)`, then `if endpoint is None: endpoint = "SDK default"`, so an empty string is logged as `""` (D-2).

Nothing else changes: the log text, the argument-less exporters (D-1; `insights.md:3601-3604`), the `try`/`except` scope (platform `@AC-42`, 171 `@AC-2`) and the disabled path. No shared helper is added (R-6).

**Consumer surface (C-14):** none, internal/platform-only. This is a decision, not an omission (design § Consumer surface). Only each service's own stdout and structured startup log record change, plus one env-docs line. No UI segment page and no agent MCP tool behaviour changes.

**Deploy-file audit:** no new env var and no new port. `OTEL_EXPORTER_OTLP_ENDPOINT` already exists in `docker-compose.yml`, `.do/app.yaml` and `.do/app.dev.yaml` (recon.md § Dependencies). None of the deploy files change.

**O-2 hermeticity, decided: option (a).** Any test that leaves the base `OTEL_EXPORTER_OTLP_ENDPOINT` unset or `""` and then reaches a flush points the three per-signal variables at the suite's own local receiver:
- the variables: `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`, `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`;
- the values: `http://127.0.0.1:<port>/otlp/v1/{traces,metrics,logs}`. Per-signal values are used verbatim, so the full path is given.

This covers the Python cases and the UI AC-1 case. Why (a) and not (b):
- (a) sends nothing to a real `localhost:4318`. Option (b), a short timeout, still sends there, so a developer's local collector would receive test spans.
- (a) makes the awaited UI `sdk.shutdown()` deterministic, which bounds the "UI shutdown may hang" risk.
- (a) needs no timing claim about the SDK.
- It also exercises D-5: with per-signal variables set and the base variable unset, the log still reads `SDK default`. That is the documented per-signal blind spot (Step 19).

The Node-leaf `INIT_ONLY_CHILD` exits without flushing (D-9, D-14), so it needs no mitigation.

**Comments (root CLAUDE.md § How to Act #5):** each new test may carry at most one constraint comment of 2 lines or fewer, naming the `@AC` it guards. Add no narration.

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` Node `xstockstrat-config` | Step 1 (`INIT_ONLY_CHILD`, unset and `""`) |
| `@AC-1` Node `xstockstrat-ui` | Step 9 (`src/telemetry.startupLog.test.ts`) |
| `@AC-1` Python `xstockstrat-analysis` | Step 11 |
| `@AC-1` Python `xstockstrat-agent` | Step 17 |
| `@AC-1`, the remaining services (not in the Examples table; product-spec review warning "AC-1 examples cover 4 of 9 services") | Steps 3 (identity), 5 (ledger), 7 (notify), 13 (indicators), 15 (ingest) |
| `@AC-2` `xstockstrat-ui`, endpoint set | Step 9 (the `instrumentation.testkit.ts:100` assertion tightened to the full suffix, run by all three `defineExportSuite` files). Python set-value cases in Steps 11, 13, 15 and 17 guard the same behaviour per runtime. |

The docs fix has no scenario (product-spec review warning). Step 19 verifies it with a named `grep`.

## Step Dependencies

These pairs each land together as one unit:

| Unit | Steps | Service |
|---|---|---|
| U1 | 1 and 2 | config |
| U2 | 3 and 4 | identity |
| U3 | 5 and 6 | ledger |
| U4 | 7 and 8 | notify |
| U5 | 9 and 10 | ui |
| U6 | 11 and 12 | analysis |
| U7 | 13 and 14 | indicators |
| U8 | 15 and 16 | ingest |
| U9 | 17 and 18 | agent |

- **Why each pair is a unit.** The test step asserts `SDK default`, which only its service step produces, so the test cannot pass its own `**Verification**` alone (`step-constraints.md` §C, green at every commit). Each unit is 2 adjacent steps on one consumer surface: backend for U1-U4 and U6-U8, ui for U5, agent for U9.
- **Unit order.** The units are otherwise independent. U1 (config) runs first because its `""` case settles the open risk "pinned Node SDK may throw on `""`". If that case fails with `[otel] init failed` on stdout (visible because `console.warn` is redirected), `/sdd-execute` halts and returns the `""` case to design before U2-U4. It must not drop the case on its own (D-10, P-03).
- **Step 19 follows Steps 1-18**, so the doc describes shipped behaviour. It edits `services/xstockstrat-ui/CLAUDE.md` only, so it stands alone.
- **BRANCH SYNC is required before Step 1.** Every line below is from `origin/main-dev@52f6d5a6`. On the feature branch's own base `c4fd48b0a` the read sites are at the older recon.md lines, for example ui `:36` and analysis `:180`. If a line has drifted, re-anchor by symbol: the `const endpoint =` / `endpoint = os.getenv(` local inside `initTelemetry` / `init_telemetry`.
- **Out of the step list (F-08).** At integration, this feature's `@AC-1` (CHANGE, signed off 2026-11-13) and `@AC-2` are promoted into the durable suites (C-16) by the `/sdd-execute` integration PR, never in a step.
- **Non-blocking overlaps.**
  - Feature 336 (`python-otel-instance-id`, launched) already edited `_build_resource` in the same Python files. It is merged in `main-dev`; its region does not overlap the startup-log lines.
  - Feature 337 (`metrics-host-provider-label`) touches the same nine telemetry modules and the Python `test_telemetry.py` files. Its code is already in `origin/main-dev@52f6d5a6` (`ee78a669`, #1531; e.g. config `withHostProvider(new OTLPMetricExporter(), provider)` at `:227`), so every anchor here already sits on top of it. Rebase-only; re-anchor by symbol if 337 lands more.
  - The batch peers (318, 320, 322, 326, 330) do not touch any telemetry module.
- **Verification environment.** Node leaves need `pnpm install` plus the proto stub build (`pnpm --filter @xstockstrat/proto run build`), as the CI `node-test` job does. Python needs `uv sync --frozen --extra dev`. If a toolchain is unreachable, the CI `node-test` / `python-test` matrix is the gate. The RED text is recorded from an actual RED run, never predicted (`tdd-gate.md`).
- **jscpd.** `.jscpd.json` ignores `**/__tests__/**`, `**/*.test.ts`, `**/tests/**` and `**/test_*.py`. The near-duplicate test additions therefore cannot raise clones (closes the design's jscpd Open Risk). The production edits are one token. `instrumentation.testkit.ts` is scanned, under the UI's enforced rail, but Step 9 only edits one existing assertion.

---

### Step 1 — test: config startup log names `SDK default` when the endpoint is unset or empty (U1)

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/telemetry.export.test.ts` — modify

**Reviewers**: Service owner `xstockstrat-config` — config key naming, environment / global-per-user scoping, secret encryption + redaction, WatchConfig stream stability

**Codebase Evidence**:
- Confirmed via: `grep -n "runChild\|extraEnv\|FLUSH_CHILD = \|spawn(" services/xstockstrat-config/src/__tests__/telemetry.export.test.ts`:
  - `runChild` is declared at `:312`, with the parameter `extraEnv: Record<string, string> = {}` at `:316`.
  - `spawn` is at `:319`. The hard-coded `OTEL_EXPORTER_OTLP_ENDPOINT` is at `:324` and `OTEL_METRIC_EXPORT_INTERVAL: '600000'` at `:326`. `...extraEnv` is spread last at `:331`. `stdio: ['ignore', 'pipe', 'inherit']` is at `:333`.
  - The 20 s SIGKILL guard is at `:337`.
  - `const FLUSH_CHILD` is at `:351`.
  - Existing callers: `:372` (3 args) and `:405` (`runChild(FLUSH_CHILD, HEADER_FORMS[0], undefined, { HOST_PROVIDER: 'Homelab' })`). Both stay valid after the widening.
- A module-level `const at = (suffix: string) => …` already exists (`:63`), so any new local must not be named `at`.
- `assert` comes from `node:assert/strict` (`:2`). `test` comes from `node:test` (`:1`).
- **Spawn mechanism (D-12), decided: spawn ignores `undefined`-valued env entries.** Probe on this host (Node v22.23.4): `spawnSync(process.execPath, ['-e', 'console.log(JSON.stringify(process.env.X), "X" in process.env)'], { env: { ...process.env, X: undefined } })` printed `undefined false`. A key set to `undefined` in `extraEnv` therefore overrides both the hard-coded `:324` value and the inherited `process.env` copy, and never reaches the child. Spawn's `env` option type is `NodeJS.ProcessEnv` (`string | undefined` values), so the widened type compiles.
- `package.json:12`: `"test": "tsc && node --test dist/__tests__/*.test.js"`. `tsconfig.json:14` includes `src/**/*`, so the test sources are type-checked by the production `tsc`.
- C-13: `INIT_ONLY_CHILD` and the env values are single-consumer literals in this file only. Inline is compliant, and no `src/__tests__/fixtures/` module is created.

**Lands with**: `Step 2`

**TDD**: `red-green required`. RED is this step's two tests failing before Step 2: stdout reads `[otel] tracing enabled → undefined (service=config)` for the unset case and `→  (service=config)` for the `""` case. Record the observed output in `context.md`.

**Covers**: `AC-1`

**Instructions**:
1. Widen `runChild`'s 4th parameter at `:316` to `extraEnv: Record<string, string | undefined> = {}`. Change nothing else in `runChild`: the name, position, default and the spread-last at `:331` all stay (D-12, R-11).
2. Immediately before `const FLUSH_CHILD` (`:351`), add:
   ```ts
   const INIT_ONLY_CHILD = `
   console.warn = (...a) => console.log(...a);
   require(process.env.TELEMETRY_JS).initTelemetry();
   process.stdout.write('', () => process.exit(0));
   `;
   ```
   - The `console.warn` redirect comes before the `require`, so an `[otel] init failed` warning or a diag warning lands on the piped stdout (D-14).
   - The exit goes through the `stdout.write` callback, not `setImmediate` (R-13).
   - `OTEL_METRIC_EXPORT_INTERVAL: '600000'` from `runChild` plus the no-flush exit keep the child clear of the 20 s guard.
3. Add one loop of two tests next to it:
   - **Loop:** `for (const [label, value] of [['unset', undefined], ['empty', '']] as const)`.
   - **Test name:** `` `AC-1: startup log names SDK default when OTEL_EXPORTER_OTLP_ENDPOINT is ${label}` ``.
   - **Call:** `runChild(INIT_ONLY_CHILD, '', undefined, { OTEL_EXPORTER_OTLP_ENDPOINT: value })`.
   - **Asserts, in order:**
     1. `code === 0`, with stdout as the message;
     2. `const idx = stdout.indexOf('[otel] tracing enabled')` is `>= 0`;
     3. `stdout.indexOf('→ SDK default', idx) > idx`;
     4. `!stdout.includes('undefined')`.
4. Add no other change. Do not touch the in-process `before()` suite (R-2).

**Verification**: the union with Step 2, run from the repo root.
```bash
cd services/xstockstrat-config \
  && pnpm run build \
  && pnpm test \
  && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40 \
  && pnpm run lint \
  && grep -n "INIT_ONLY_CHILD\|string | undefined" src/__tests__/telemetry.export.test.ts
```
Confirm the two `AC-1:` tests ran and passed in the `node --test` output. A run that counts zero of them is not green (`tdd-gate.md`).

---

### Step 2 — service: config logs `SDK default` for an unset endpoint (U1)

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/telemetry.ts` — modify

**Reviewers**: Service owner `xstockstrat-config` — config key naming, environment / global-per-user scoping, secret encryption + redaction, WatchConfig stream stability

**Codebase Evidence**:
- Confirmed via: `grep -n "OTEL_EXPORTER_OTLP_ENDPOINT\|tracing enabled\|export function initTelemetry" services/xstockstrat-config/src/telemetry.ts`:
  - `initTelemetry` is at `:190`.
  - The read is at `:211`: `const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;`.
  - The log is at `:240`: `` console.info(`[otel] tracing enabled → ${endpoint} (service=${serviceName})`); ``.
- The exporters are argument-less at `:224-230`. The constraint comment at `:223` reads `No exporter takes a url/headers argument: that would override OTEL_EXPORTER_OTLP_*.` `endpoint` has no other reader.

**Lands with**: `Step 1`

**TDD**: `red-green required`. RED is Step 1's tests failing before this step.

**Covers**: —

**Instructions**:
1. Change `:211` to `const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'SDK default';`. The operator is logical OR (D-7), so `""` also maps to `SDK default` (D-10).
2. Do not pass `endpoint` to any exporter (D-1). Leave the log line `:240`, the `try`/`catch` and the disabled early return (`:191`) unchanged. Add no comment.

**Verification**: Step 1's commands (union).

---

### Step 3 — test: identity startup log names `SDK default` when the endpoint is unset or empty (U2)

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/__tests__/telemetry.export.test.ts` — modify

**Reviewers**: Service owner `xstockstrat-identity` — JWT expiry and rotation, API key scoping, secret store integration (never plaintext secrets in config)

**Codebase Evidence**:
- Confirmed via: `grep -n "runChild\|FLUSH_CHILD = \|spawn(" services/xstockstrat-identity/src/__tests__/telemetry.export.test.ts`:
  - `runChild(code, headers, onLine?)` is at `:204-208` and has no `extraEnv`.
  - `spawn` is at `:210`. The `env` object runs `:212-222`, with the hard-coded endpoint at `:215`. `stdio` is at `:223`.
  - `const FLUSH_CHILD` is at `:241`.
  - Callers: `:262`, `:318`. Both have at most 3 args and stay valid.
- The spawn mechanism is the same as Step 1 (the probe shows spawn drops `undefined` values).
- `package.json:12` is tsc-first. ledger and identity once ran ESM strip-types, and the build broke (`fails.md:2237-2240`), so both `pnpm test` and `pnpm run build` are verified.
- C-13: single-consumer inline literals; compliant.

**Lands with**: `Step 4`

**TDD**: `red-green required`. RED: the unset case prints `→ undefined (service=identity)` and the `""` case prints an empty endpoint. Record the observed output.

**Covers**: `AC-1`

**Instructions**:
1. Add a 4th parameter to `runChild` (`:204-208`), with the same name, type, default and position as config (D-12): `extraEnv: Record<string, string | undefined> = {},`. Spread it last in the `env` object, as `...extraEnv,` after `LOGGER_JS` (`:221`).
2. Add `INIT_ONLY_CHILD` and the two-case `AC-1` loop immediately before `const FLUSH_CHILD` (`:241`). Both are exactly as specified in Step 1, Instructions 2-3.

**Verification**: the union with Step 4.
```bash
cd services/xstockstrat-identity \
  && pnpm run build \
  && pnpm test \
  && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40 \
  && pnpm run lint \
  && grep -n "INIT_ONLY_CHILD\|\.\.\.extraEnv" src/__tests__/telemetry.export.test.ts
```
Confirm that both `AC-1:` tests executed and passed.

---

### Step 4 — service: identity logs `SDK default` for an unset endpoint (U2)

**Status**: `pending`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/telemetry.ts` — modify

**Reviewers**: Service owner `xstockstrat-identity` — JWT expiry and rotation, API key scoping, secret store integration (never plaintext secrets in config)

**Codebase Evidence**:
- Confirmed via: `grep -n "OTEL_EXPORTER_OTLP_ENDPOINT\|tracing enabled\|export function initTelemetry" services/xstockstrat-identity/src/telemetry.ts`:
  - `initTelemetry` is at `:191`.
  - The read is at `:212`: `const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;`.
  - The log is at `:241`.

**Lands with**: `Step 3`

**TDD**: `red-green required`. RED is Step 3's tests.

**Covers**: —

**Instructions**:
1. Change `:212` to `const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'SDK default';`.
2. Make no other change (as Step 2).

**Verification**: Step 3's commands (union).

---

### Step 5 — test: ledger startup log names `SDK default` when the endpoint is unset or empty (U3)

**Status**: `pending`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/__tests__/telemetry.export.test.ts` — modify

**Reviewers**: Service owner `xstockstrat-ledger` — append-only invariant (no deletes or updates), event ordering, hypertable partition safety

**Codebase Evidence**:
- Confirmed via: `grep -n "runChild\|extraEnv\|FLUSH_CHILD = \|spawn(" services/xstockstrat-ledger/src/__tests__/telemetry.export.test.ts`:
  - `runChild` is at `:237`, with `extraEnv: Record<string, string> = {}` at `:241`.
  - `spawn` is at `:244`. `...extraEnv` is spread last at `:256`.
  - `const FLUSH_CHILD` is at `:276`.
  - Callers:
    - `:297` (3 args);
    - `:330` (`{ HOST_PROVIDER: 'aws' }`);
    - `childFlushMetric(extraEnv: Record<string, string>)` at `:353`, which calls `runChild` at `:355`;
    - `:423` (2 args).
  - `Record<string, string>` is assignable to the widened type, so every caller stays valid.
- `package.json:13` is tsc-first (`fails.md:2237-2240`).
- C-13: single-consumer inline literals; compliant.

**Lands with**: `Step 6`

**TDD**: `red-green required`. RED: `→ undefined (service=ledger)` for the unset case and an empty endpoint for `""`.

**Covers**: `AC-1`

**Instructions**:
1. Widen `:241` to `extraEnv: Record<string, string | undefined> = {}`. Leave `childFlushMetric`'s own parameter type (`:353`) unchanged.
2. Add `INIT_ONLY_CHILD` and the two-case `AC-1` loop immediately before `const FLUSH_CHILD` (`:276`), exactly as in Step 1, Instructions 2-3.

**Verification**: the union with Step 6.
```bash
cd services/xstockstrat-ledger \
  && pnpm run build \
  && pnpm test \
  && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40 \
  && pnpm run lint \
  && grep -n "INIT_ONLY_CHILD\|string | undefined" src/__tests__/telemetry.export.test.ts
```
Confirm that both `AC-1:` tests executed and passed. `test:db` is not part of this gate.

---

### Step 6 — service: ledger logs `SDK default` for an unset endpoint (U3)

**Status**: `pending`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/telemetry.ts` — modify

**Reviewers**: Service owner `xstockstrat-ledger` — append-only invariant (no deletes or updates), event ordering, hypertable partition safety

**Codebase Evidence**:
- Confirmed via: `grep -n "OTEL_EXPORTER_OTLP_ENDPOINT\|tracing enabled\|export function initTelemetry" services/xstockstrat-ledger/src/telemetry.ts`:
  - `initTelemetry` is at `:191`.
  - The read is at `:212`: `const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;`.
  - The log is at `:241`.

**Lands with**: `Step 5`

**TDD**: `red-green required`. RED is Step 5's tests.

**Covers**: —

**Instructions**:
1. Change `:212` to `const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'SDK default';`.
2. Make no other change.

**Verification**: Step 5's commands (union).

---

### Step 7 — test: notify startup log names `SDK default` when the endpoint is unset or empty (U4)

**Status**: `pending`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/__tests__/telemetry.export.test.ts` — modify

**Reviewers**: Service owner `xstockstrat-notify` — stream delivery guarantees, backpressure handling, alert deduplication

**Codebase Evidence**:
- Confirmed via: `grep -n "runChild\|FLUSH_CHILD = \|spawn(" services/xstockstrat-notify/src/__tests__/telemetry.export.test.ts`:
  - `runChild(code, headers, onLine?)` is at `:239-243` and has no `extraEnv`.
  - `spawn` is at `:245`. The `env` object runs `:247-257`, with the hard-coded endpoint at `:250` and `LOGGER_JS` at `:256`. `stdio` is at `:258`.
  - `const FLUSH_CHILD` is at `:276`.
  - Callers: `:297`, `:353`. Both have at most 3 args.
- C-13: single-consumer inline literals; compliant.

**Lands with**: `Step 8`

**TDD**: `red-green required`. RED: `→ undefined (service=notify)` for the unset case and an empty endpoint for `""`.

**Covers**: `AC-1`

**Instructions**:
1. Add the 4th parameter `extraEnv: Record<string, string | undefined> = {},` to `runChild` (`:239-243`). Spread `...extraEnv,` last in the `env` object, after `LOGGER_JS` (`:256`). This matches Step 3 (D-12).
2. Add `INIT_ONLY_CHILD` and the two-case `AC-1` loop immediately before `const FLUSH_CHILD` (`:276`), exactly as in Step 1, Instructions 2-3.

**Verification**: the union with Step 8.
```bash
cd services/xstockstrat-notify \
  && pnpm run build \
  && pnpm test \
  && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40 \
  && pnpm run lint \
  && grep -n "INIT_ONLY_CHILD\|\.\.\.extraEnv" src/__tests__/telemetry.export.test.ts
```
Confirm that both `AC-1:` tests executed and passed.

---

### Step 8 — service: notify logs `SDK default` for an unset endpoint (U4)

**Status**: `pending`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/telemetry.ts` — modify

**Reviewers**: Service owner `xstockstrat-notify` — stream delivery guarantees, backpressure handling, alert deduplication

**Codebase Evidence**:
- Confirmed via: `grep -n "OTEL_EXPORTER_OTLP_ENDPOINT\|tracing enabled\|export function initTelemetry" services/xstockstrat-notify/src/telemetry.ts`:
  - `initTelemetry` is at `:192`.
  - The read is at `:213`: `const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;`.
  - The log is at `:242`.

**Lands with**: `Step 7`

**TDD**: `red-green required`. RED is Step 7's tests.

**Covers**: —

**Instructions**:
1. Change `:213` to `const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'SDK default';`.
2. Make no other change.

**Verification**: Step 7's commands (union).

---

### Step 9 — test: UI startup log names `SDK default` when unset, and the full set endpoint when set (U5)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/telemetry.startupLog.test.ts` — create
- `services/xstockstrat-ui/src/instrumentation.testkit.ts` — modify

**Reviewers**: Service owner `xstockstrat-ui` — trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- `services/xstockstrat-ui/src/telemetry.ts` (origin/main-dev):
  - `export function initTelemetry()` is at `:59`, the read at `:80`, the log at `:114`.
  - `:116` is `process.on('SIGTERM', () => sdk.shutdown().catch(console.error));`. The listener returns the shutdown promise, which is what the teardown awaits (D-13).
- `src/instrumentation.testkit.ts`:
  - It uses plain `console.*` recorders installed before OTel loads (`:48-56`; `fails.md:2853-2856`).
  - The receiver is a `createServer` at `:28`, listening in `beforeAll` (`:71-72`, `const { port } = server.address() as AddressInfo`).
  - `:78` sets `process.env.OTEL_EXPORTER_OTLP_ENDPOINT = \`http://127.0.0.1:${port}/otlp\``.
  - `:100` is `expect(calls.info.some((m) => m.includes('[otel] tracing enabled'))).toBe(true);`.
  - `type AddressInfo` is imported at `:5`.
  - The recursion guard `:260-263` (`never reaches /v1/logs`) is untouched.
- `defineExportSuite` callers: `src/instrumentation.test.ts:4`, `src/instrumentation.encoded-header.test.ts:4`, `src/instrumentation.delta.test.ts:5`. All three share the `:78` setup, so the tightened assertion runs three times.
- `vitest.config.ts`: `include: ['src/**/*.test.ts']`, so the new file is picked up. Nothing overrides pool or isolate, so per-file isolation holds (D-13). `src/telemetry.hostProvider.test.ts` exists and is untouched, which is why AC-1 gets its own file.
- `package.json:17` `"test:unit": "vitest run"`, `:10` `"lint": "next lint"`, `:12` `"lint:dup"`.
- C-12: the test uses no domain object (accounts, strategies and so on), only env strings and a loopback URL. That is a scenario one-off, exempt from the fixture inventory, so `INVENTORY.md` is unchanged.

**Lands with**: `Step 10`

**TDD**: `red-green required`.
- **AC-1 RED:** the new test fails before Step 10 because the recorded line is `[otel] tracing enabled → undefined (service=…)`.
- **AC-2:** the tightened testkit assertion passes before and after. The endpoint is set, so this is a characterization tightening (D-4). Record it as "red N/A — AC-2 PRESERVE, characterization" in `context.md`.

**Covers**: `AC-1, AC-2`

**Instructions**:
1. **AC-2 (D-4).** In `instrumentation.testkit.ts`, change the `:100` assertion to match the full suffix. Read the port inside the test from the listening server:
   `` expect(calls.info.some((m) => m.includes(`[otel] tracing enabled → http://127.0.0.1:${(server.address() as AddressInfo).port}/otlp`))).toBe(true); ``
   Change nothing else in the testkit.
2. **AC-1 (D-9, D-13; R-12, R-14).** Create `src/telemetry.startupLog.test.ts`. Its top-level code runs before any OTel or telemetry import:
   1. Install plain `console.info` / `console.warn` recorders into two string arrays, keeping the originals for restore.
   2. Create a receiver: a `node:http` `createServer` that drains the request and answers `200` with `'{}'`.
3. In a single `test('AC-1: startup log names SDK default when OTEL_EXPORTER_OTLP_ENDPOINT is unset', async () => …)`:
   1. Listen the server on `127.0.0.1:0`.
   2. Set `OTEL_ENABLED = 'true'`. Delete `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_LOG_LEVEL`.
   3. Set the O-2 option (a) variables, `OTEL_EXPORTER_OTLP_{TRACES,METRICS,LOGS}_ENDPOINT = http://127.0.0.1:<port>/otlp/v1/{traces,metrics,logs}`.
   4. Snapshot `const before = process.listeners('SIGTERM')`.
   5. `const { initTelemetry } = await import('./telemetry')` and call `initTelemetry()`.
   6. Take `added = process.listeners('SIGTERM').filter((l) => !before.includes(l))`.
   7. In a `try`, assert, in this order:
      - `added` has length 1;
      - some info line contains `[otel] tracing enabled → SDK default`;
      - no info line contains `→ undefined`;
      - no warn line contains `[otel] init failed`.
   8. In the `finally`:
      - for each listener in `added`, `await` its return value (it returns `sdk.shutdown()`), then `process.removeListener('SIGTERM', l)`;
      - restore the env keys the test set or deleted;
      - restore `console`;
      - `server.closeAllConnections(); server.close()`.

      Never call `process.emit('SIGTERM')` (R-12).

**Verification**: the union with Step 10.
```bash
cd services/xstockstrat-ui \
  && pnpm exec vitest run src/telemetry.startupLog.test.ts src/instrumentation.test.ts src/instrumentation.encoded-header.test.ts src/instrumentation.delta.test.ts \
  && pnpm run test:coverage \
  && pnpm run lint \
  && python3 ../../scripts/check-duplication.py src \
  && grep -n "process.emit" src/telemetry.startupLog.test.ts; test $? -eq 1
```
- Confirm the `AC-1:` test executed and passed, along with all three `defineExportSuite` files.
- The `grep … ; test $? -eq 1` line proves `process.emit` is absent.
- `pnpm run test:coverage` (`vitest run --coverage`, the CI `node-test` command) enforces `vitest.config.ts` thresholds `lines: 40`, `functions: 40`, `statements: 40` over `src/lib/**`. `test:unit` (no `--coverage`) does not apply them. This step adds no `src/lib/**` code, so the numbers must not drop.

---

### Step 10 — service: UI logs `SDK default` for an unset endpoint (U5)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/telemetry.ts` — modify

**Reviewers**: Service owner `xstockstrat-ui` — trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log)

**Codebase Evidence**:
- Confirmed via: `grep -n "OTEL_EXPORTER_OTLP_ENDPOINT\|tracing enabled\|SIGTERM" services/xstockstrat-ui/src/telemetry.ts`:
  - The read is at `:80`: `const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;`.
  - The log is at `:114`. The SIGTERM listener is at `:116`.
- The exporter constraint comment at `:100-101` reads `No exporter takes a url option: it overrides OTEL_EXPORTER_OTLP_*`. The exporters are argument-less at `:102-108`.
- This preserves feature 226 UI `@AC-2` (`services/xstockstrat-ui/acceptance/fix-otel-trace-export.feature`): the `[otel] tracing enabled` prefix is kept.

**Lands with**: `Step 9`

**TDD**: `red-green required`. RED is Step 9's AC-1 test.

**Covers**: —

**Instructions**:
1. Change `:80` to `const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'SDK default';`.
2. Make no other change.

**Verification**: Step 9's commands (union).

---

### Step 11 — test: analysis startup record carries the effective endpoint (U6)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_telemetry.py` — modify

**Reviewers**: Service owner `xstockstrat-analysis` — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Confirmed via: `grep -n "^def \|caplog\|^import logging" services/xstockstrat-analysis/tests/test_telemetry.py`:
  - `import logging` is at `:3`.
  - `_start_body_receiver` is at `:120`. It returns `(srv, seen)` and runs a `ThreadingHTTPServer` on `127.0.0.1:0`.
  - `_flush_all` is at `:145`.
  - `test_handler_is_instrumentation_logging_handler` is at `:275`. It establishes the pattern: `srv.shutdown(); srv.server_close()` in `finally`, then the `otel_reset` teardown.
  - The existing `caplog.at_level` usage is at `:93`, `:346`.
- `tests/conftest.py:506` `otel_reset`:
  - It resets the providers and sets `NO_PROXY`.
  - Its teardown calls `provider.shutdown()` for all three providers (`:535-541`). That flush is the source of O-2.
- `app/telemetry.py`:
  - `log = logging.getLogger(__name__)` is at `:15`.
  - The startup record at `:281` is `log.info("OTel tracing initialised", extra={"endpoint": endpoint, "service": svc_name})`.
  - `endpoint` is a structured `extra` field, so the test reads `record.endpoint`, not `caplog.text` (recon.md:47-49).
- C-13: the three `(value, want)` parameters are per-scenario expected values with a single consumer. Inline is compliant, and no `conftest.py` constant is added.

**Lands with**: `Step 12`

**TDD**: `red-green required`. RED: the `unset` case fails with `None != 'SDK default'`. The `set` and `empty` cases pass before and after; they pin D-2 and are characterization cases. Record the observed output.

**Covers**: `AC-1`

**Instructions**:
1. Immediately after `test_handler_is_instrumentation_logging_handler`, add `test_startup_log_names_effective_endpoint(otel_reset, monkeypatch, caplog, value, want)`:
   - **Parametrization:** `@pytest.mark.parametrize(("value", "want"), [(None, "SDK default"), ("http://otel-collector:4318", "http://otel-collector:4318"), ("", "")], ids=["unset", "set", "empty"])`.
   - **Body:**
     1. `from app.telemetry import init_telemetry`, then `srv, _ = _start_body_receiver()`.
     2. In `try`:
        - `monkeypatch.setenv("OTEL_ENABLED", "true")`.
        - For each `sig` in `("traces", "metrics", "logs")`, `monkeypatch.setenv(f"OTEL_EXPORTER_OTLP_{sig.upper()}_ENDPOINT", f"http://127.0.0.1:{srv.server_port}/otlp/v1/{sig}")`. This is O-2 option (a).
        - If `value is None`, `monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)`. Otherwise `monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", value)`.
        - `with caplog.at_level(logging.INFO): init_telemetry()`, then `_flush_all()`.
     3. In `finally`: `srv.shutdown(); srv.server_close()`.
     4. Then `[rec] = [r for r in caplog.records if r.getMessage() == "OTel tracing initialised"]` and `assert rec.endpoint == want`.
2. Keep every line within ruff's `line-length = 100`.

**Verification**: the union with Step 12, run from the repo root.
```bash
cd services/xstockstrat-analysis \
  && uv sync --frozen --extra dev \
  && uv run --no-sync pytest tests/test_telemetry.py -q -k startup_log \
  && uv run --no-sync pytest tests/test_telemetry.py -q \
  && uv run --no-sync pytest --cov=app --cov-fail-under=40 -q \
  && ruff check . && ruff format --check . \
  && grep -n "conftest" tests/test_telemetry.py; test $? -eq 1
```
- The `-k startup_log` run must report 3 passed.
- The full-suite coverage run needs the PostgreSQL binaries for the analysis `real_pg` tests (`ci.yml` installs them). If they are absent locally, the CI `python-test` matrix is the coverage gate.
- C-13: no `conftest` import is added.

---

### Step 12 — service: analysis logs `"SDK default"` for an unset endpoint (U6)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/telemetry.py` — modify

**Reviewers**: Service owner `xstockstrat-analysis` — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Confirmed via: `grep -n "OTEL_EXPORTER_OTLP_ENDPOINT\|OTel tracing initialised\|^def init_telemetry" services/xstockstrat-analysis/app/telemetry.py`:
  - `init_telemetry` is at `:223`.
  - The read is at `:246`: `endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")`.
  - The log is at `:281`.
- The exporter comment at `:250` reads `No endpoint/insecure args: they override OTEL_EXPORTER_OTLP_* (path, TLS, headers).` The exporters are argument-less at `:251-253`.
- The `LoggingHandler` is attached before the log (`:271-273`), so the record is exported to `/v1/logs`. Logging the raw value is unchanged (D-6, config `@AC-7` preserved).

**Lands with**: `Step 11`

**TDD**: `red-green required`. RED is Step 11's `unset` case.

**Covers**: —

**Instructions**:
1. Directly after `:246`, add two lines at the same indent:
   ```python
           if endpoint is None:
               endpoint = "SDK default"
   ```
   This is the two-line form because ruff's default `E701` rejects `if …: …` on one line.
2. Do not use `or` (R-1). An empty string stays `""`.
3. Make no other change.

**Verification**: Step 11's commands (union).

---

### Step 13 — test: indicators startup record carries the effective endpoint (U7)

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_telemetry.py` — modify

**Reviewers**: Service owner `xstockstrat-indicators` — formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution

**Codebase Evidence**:
- Confirmed via: `grep -n "^def \|^import logging" services/xstockstrat-indicators/tests/test_telemetry.py`:
  - `import logging` is at `:3`.
  - `_start_body_receiver` is at `:120` and `_flush_all` at `:145`.
  - `test_handler_is_instrumentation_logging_handler` is at `:241`.
- `tests/conftest.py:196` `otel_reset`. Its teardown shutdown is at `:221-227`.
- `app/telemetry.py`:
  - `log = logging.getLogger(__name__)` is at `:14`.
  - The startup record is at `:275`.
- C-13: single-consumer per-scenario values; compliant.

**Lands with**: `Step 14`

**TDD**: `red-green required`. RED: `unset` fails with `None != 'SDK default'`. Record the observed output.

**Covers**: `AC-1`

**Instructions**:
1. Immediately after `test_handler_is_instrumentation_logging_handler`, add `test_startup_log_names_effective_endpoint`, exactly as in Step 11, Instruction 1 (same parametrization, O-2 option (a) per-signal setup, `caplog` on `record.endpoint`).

**Verification**: the union with Step 14.
```bash
cd services/xstockstrat-indicators \
  && uv sync --frozen --extra dev \
  && uv run --no-sync pytest tests/test_telemetry.py -q -k startup_log \
  && uv run --no-sync pytest tests/test_telemetry.py -q \
  && uv run --no-sync pytest --cov=app --cov-fail-under=50 -q \
  && ruff check . && ruff format --check . \
  && grep -n "conftest" tests/test_telemetry.py; test $? -eq 1
```
- The `-k startup_log` run must report 3 passed.
- The sandbox tests need `libseccomp2` (`ci.yml`). If it is absent locally, CI is the coverage gate.

---

### Step 14 — service: indicators logs `"SDK default"` for an unset endpoint (U7)

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/telemetry.py` — modify

**Reviewers**: Service owner `xstockstrat-indicators` — formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution

**Codebase Evidence**:
- Confirmed via: `grep -n "OTEL_EXPORTER_OTLP_ENDPOINT\|OTel tracing initialised\|^def init_telemetry" services/xstockstrat-indicators/app/telemetry.py`:
  - `init_telemetry` is at `:222`.
  - The read is at `:242`: `endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")`.
  - The log is at `:275`.

**Lands with**: `Step 13`

**TDD**: `red-green required`. RED is Step 13's `unset` case.

**Covers**: —

**Instructions**:
1. Directly after `:242`, add the same two lines as Step 12: `if endpoint is None:` / `endpoint = "SDK default"`.
2. Make no other change.

**Verification**: Step 13's commands (union).

---

### Step 15 — test: ingest startup record carries the effective endpoint (U8)

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_telemetry.py` — modify

**Reviewers**: Service owner `xstockstrat-ingest` — signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- Confirmed via: `grep -n "^def \|^import logging" services/xstockstrat-ingest/tests/test_telemetry.py`:
  - `import logging` is at `:3`.
  - `_start_body_receiver` is at `:120` and `_flush_all` at `:145`.
  - `test_handler_is_instrumentation_logging_handler` is at `:271`.
- `tests/conftest.py:103` `otel_reset`. Its teardown shutdown is at `:128-134`.
- `app/telemetry.py`:
  - `log = logging.getLogger(__name__)` is at `:15`.
  - The startup record is at `:276`.
- C-13: single-consumer per-scenario values; compliant.

**Lands with**: `Step 16`

**TDD**: `red-green required`. RED: `unset` fails with `None != 'SDK default'`. Record the observed output.

**Covers**: `AC-1`

**Instructions**:
1. Immediately after `test_handler_is_instrumentation_logging_handler`, add `test_startup_log_names_effective_endpoint`, exactly as in Step 11, Instruction 1.

**Verification**: the union with Step 16.
```bash
cd services/xstockstrat-ingest \
  && uv sync --frozen --extra dev \
  && uv run --no-sync pytest tests/test_telemetry.py -q -k startup_log \
  && uv run --no-sync pytest tests/test_telemetry.py -q \
  && uv run --no-sync pytest --cov=app --cov-fail-under=40 -q \
  && ruff check . && ruff format --check . \
  && grep -n "conftest" tests/test_telemetry.py; test $? -eq 1
```
The `-k startup_log` run must report 3 passed.

---

### Step 16 — service: ingest logs `"SDK default"` for an unset endpoint (U8)

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/telemetry.py` — modify

**Reviewers**: Service owner `xstockstrat-ingest` — signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- Confirmed via: `grep -n "OTEL_EXPORTER_OTLP_ENDPOINT\|OTel tracing initialised\|^def init_telemetry" services/xstockstrat-ingest/app/telemetry.py`:
  - `init_telemetry` is at `:223`.
  - The read is at `:243`: `endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")`.
  - The log is at `:276`.

**Lands with**: `Step 15`

**TDD**: `red-green required`. RED is Step 15's `unset` case.

**Covers**: —

**Instructions**:
1. Directly after `:243`, add the same two lines as Step 12.
2. Make no other change.

**Verification**: Step 15's commands (union).

---

### Step 17 — test: agent startup record carries the effective endpoint (U9)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_telemetry.py` — modify

**Reviewers**: Service owner `xstockstrat-agent` — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; no secret values in tool output

**Codebase Evidence**:
- Confirmed via: `grep -n "^def \|^import logging" services/xstockstrat-agent/tests/test_telemetry.py`:
  - `import logging` is at `:3`.
  - `_start_body_receiver` is at `:131` and `_flush_all` at `:156`.
  - `test_handler_is_instrumentation_logging_handler` is at `:262`.
  - The existing `caplog.at_level` usage is at `:110`, `:288`.
- `tests/conftest.py:302` `otel_reset`.
- `app/telemetry.py`:
  - `log = logging.getLogger(__name__)` is at `:14`.
  - The startup record is at `:153`.
- No MCP tool contract changes: telemetry only.
- C-13: single-consumer per-scenario values; compliant.

**Lands with**: `Step 18`

**TDD**: `red-green required`. RED: `unset` fails with `None != 'SDK default'`. Record the observed output.

**Covers**: `AC-1`

**Instructions**:
1. Immediately after `test_handler_is_instrumentation_logging_handler`, add `test_startup_log_names_effective_endpoint`, exactly as in Step 11, Instruction 1.

**Verification**: the union with Step 18.
```bash
cd services/xstockstrat-agent \
  && uv sync --frozen --extra dev \
  && uv run --no-sync pytest tests/test_telemetry.py -q -k startup_log \
  && uv run --no-sync pytest tests/test_telemetry.py -q \
  && uv run --no-sync pytest --cov=app --cov-fail-under=40 -q \
  && ruff check . && ruff format --check . \
  && grep -n "conftest" tests/test_telemetry.py; test $? -eq 1
```
The `-k startup_log` run must report 3 passed.

---

### Step 18 — service: agent logs `"SDK default"` for an unset endpoint (U9)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/telemetry.py` — modify

**Reviewers**: Service owner `xstockstrat-agent` — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; no secret values in tool output

**Codebase Evidence**:
- Confirmed via: `grep -n "OTEL_EXPORTER_OTLP_ENDPOINT\|OTel tracing initialised\|^def init_telemetry" services/xstockstrat-agent/app/telemetry.py`:
  - `init_telemetry` is at `:97`.
  - The read is at `:120`: `endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")`.
  - The log is at `:153`.

**Lands with**: `Step 17`

**TDD**: `red-green required`. RED is Step 17's `unset` case.

**Covers**: —

**Instructions**:
1. Directly after `:120`, add the same two lines as Step 12.
2. Make no other change.

**Verification**: Step 17's commands (union).

---

### Step 19 — docs: UI CLAUDE.md documents the endpoint var as required when OTel is on

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via: `grep -n "OTEL_EXPORTER_OTLP_ENDPOINT" services/xstockstrat-ui/CLAUDE.md` gives `:325`, a bare `OTEL_EXPORTER_OTLP_ENDPOINT` line.
- It sits in the env code block after `OTEL_ENABLED                # toggle OTel; init errors never block startup` (`:323`) and `HOST_PROVIDER …` (`:324`), with `SERVICE_NAME=ui` at `:326`. recon.md cites the older `:302`.
- `docs/patterns/observability.md` is out of scope (recon.md § Risks; platform `@AC-9` unaffected).

**Lands with**: —

**TDD**: `N/A (docs)`

**Covers**: — (the docs fix has no scenario; product-spec review warning). This step addresses the per-signal blind-spot Open Risk (D-5) and the userinfo convention (D-6).

**Instructions**:
1. Replace the line at `:325` with this exact text from design § Docs:
   `OTEL_EXPORTER_OTLP_ENDPOINT  # required when OTEL_ENABLED=true; unset ⇒ SDK default. Base var only (per-signal *_ENDPOINT not reflected in the startup log). Credentials go in OTEL_EXPORTER_OTLP_HEADERS, never the URL.`
2. Change no other line.

**Verification**:
```bash
grep -n "OTEL_EXPORTER_OTLP_ENDPOINT  # required when OTEL_ENABLED=true; unset ⇒ SDK default" services/xstockstrat-ui/CLAUDE.md \
  && grep -n "Credentials go in OTEL_EXPORTER_OTLP_HEADERS, never the URL" services/xstockstrat-ui/CLAUDE.md \
  && git diff --stat -- services/xstockstrat-ui/CLAUDE.md
```
The diff must show exactly 1 insertion and 1 deletion.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
