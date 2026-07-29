# Implementation Spec: fix-config-write-authz

**Status**: `complete`
**Created**: 2026-07-29
**Feature**: `docs/roadmap/features/074-fix-config-write-authz/feature.md`
**Total Steps**: 7
**Feature Branch**: `feature/fix-config-write-authz` (this run: `claude/runs-073-074-sdd-6wtwal`)

---

## Execution Summary

Step 1 repairs `xstockstrat-config`'s unit-test runner, which today executes zero assertions — it
must land **first**, because every later `test` step is meaningless until the runner actually loads a
module (design.md §5; the defect is verified by execution in `context.md`). Step 2 adds the
`authz.ts` helper and the `SetConfig` gate; Step 3 is its paired test (C-08), including the
loopback-gRPC wiring proof. Steps 4–5 add the BFF gate and its e2e pair. Steps 6–7 close the
remaining shared surfaces (integration script, docs) that C-10 requires.

## Step Dependencies

- Step 2 requires Step 1: a test written before the runner repair would silently skip, so
  red-before-green (**P-06**) cannot be demonstrated.
- Step 3 [test] covers Step 2 [service]; Step 5 [test] covers Step 4 [service].
- Step 6 and Step 7 require Step 2: the runbook and integration script must send the metadata the
  gate now requires.

---

### Step 1 — test: repair the `xstockstrat-config` unit-test runner

**Status**: `complete`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/package.json` — modify (`test`, `test:coverage` scripts)
- `services/xstockstrat-config/src/__tests__/configServiceImpl.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/configWatcher.test.ts` — modify

**Reviewers**: `xstockstrat-config` (service owner) — test-harness correctness; Security — the SEV-1
gate's evidence path depends on this step.

**Codebase Evidence**:
- `package.json:12` → `"test": "node --experimental-strip-types --test src/__tests__/*.test.ts"`
- `configServiceImpl.test.ts:17` → `await import('../grpc/configServiceImpl.js')`, wrapped in
  `try {} catch {}` (`:15-22`), with `if (!ConfigServiceImpl) return;` at `:36` and `:66`
- `configWatcher.test.ts:26` → same `.js`-specifier + skip-guard shape; its first case constructs
  `new ConfigWatcher('localhost:1', 'test')` (`:38`), which dials a real gRPC channel
- `configServiceImpl.ts:94` → `constructor(private readonly pool: Pool) {}` (parameter property)
- Executed this session: `.js` specifier → `ERR_MODULE_NOT_FOUND`; `.ts` specifier →
  `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX: TypeScript parameter property is not supported in strip-only
  mode`; against compiled `dist/`, `configServiceImpl.test.js` fails 1 of 2 and
  `configWatcher.test.js` hangs.

**TDD**: `N/A (test-infrastructure repair — its own verification is that previously-silent cases now
actually execute and one of them goes red)`

**Instructions**:
1. Point the test scripts at compiled output so the existing CommonJS module graph resolves:
   `"test": "tsc && node --test dist/__tests__/*.test.js"` and the same `tsc &&` prefix on
   `test:coverage` (keep `c8 --lines 40`).
2. In both test files, replace the `try/catch` + `let X` import guard with a direct top-level
   `await import(...)` (or a `before()` that does not swallow), and delete every
   `if (!X) return;` early return. A broken stub environment must fail loudly, not skip.
3. Fix the stale expectation in `configServiceImpl.test.ts` — `value_type` is the string
   `'VALUE_TYPE_FLOAT_MAP'`, not `1`, because `packages/proto/buf.gen.yaml` sets `stringEnums=true`.
4. Stop `configWatcher.test.ts` from dialing: build the instance with
   `Object.create(ConfigWatcher.prototype)` instead of `new ConfigWatcher(...)`. The file's own
   docstring says it tests "getter logic" with the snapshot injected — constructing a live client
   was never needed.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm test 2>&1 | tail -20
# MUST show a non-zero, all-passing case count AND terminate without hanging.
# Sanity-check the repair is real: temporarily break one assertion and confirm it goes red.
```

---

### Step 2 — service: ADMIN-scope gate on `SetConfig`

**Status**: `complete`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/authz.ts` — create
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify
- `services/xstockstrat-config/.eslintrc.json` — modify

**Reviewers**: `xstockstrat-config` (service owner) — the new authorization check itself; Security —
**required**, this is the first authz check ever added to `SetConfig`.

**Codebase Evidence**:
- `configServiceImpl.ts:251-274` — `setConfig`; destructure at `:252`, INSERT `:256-265`,
  `pg_notify` `:266-268`, `callback({ code: 13 })` at `:272`. No `call.metadata` read anywhere.
- Platform rule: `docs/patterns/header-propagation.md:24-26` — `int(x-access-scope) & 0x04`, abort
  `PERMISSION_DENIED` with `"admin scope required"`.
- Accessor shape to copy: `header-propagation.md:128-135` — `(md.get(k)[0] as string) ?? ''`,
  scope defaulting to `'0'`.
- Python reference: `services/xstockstrat-ingest/app/handlers/servicer.py:119-132`, abort at `:860`.
- `author` precedent: `services/xstockstrat-indicators/app/handlers/servicer.py:207-220` —
  `if request.author: author = request.author`, else `x-user-id`, else abort.
- Name collision to avoid: `services/xstockstrat-ui/src/lib/auth.ts:79-81` exports
  `hasAdminScope(roles: string[])`.
- `services/xstockstrat-config/.eslintrc.json` has no `no-restricted-syntax`; the UI's
  (`services/xstockstrat-ui/.eslintrc.json:6-33`) bans `x-access-scope` and `0x04` with a
  `src/lib/{headers,auth}.ts` override.

**TDD**: `red-green required` — paired by Step 3.

**Instructions**:
1. Create `authz.ts` exporting `ADMIN_SCOPE = 0x04`, `HEADER_ACCESS_SCOPE`, `HEADER_USER_ID`,
   `hasAdminAccessScope(md?: Metadata): boolean`, `userIdFrom(md?: Metadata): string`, and the two
   error objects (`ADMIN_SCOPE_ERROR` using the named `status.PERMISSION_DENIED` with message
   exactly `'admin scope required'`; `MISSING_AUTHOR_ERROR` using `status.INVALID_ARGUMENT`).
   Absent/missing/NaN scope must resolve to `0` ⇒ denied.
2. In `setConfig`, make the gate the **first statement**, before the destructure at `:252`, so a
   denied call reaches neither the INSERT nor `pg_notify`.
3. Resolve `author` as `request.author` → `userIdFrom(call.metadata)` → `MISSING_AUTHOR_ERROR`.
4. Mirror the two `no-restricted-syntax` selectors into config's eslint config with an override for
   `src/grpc/authz.ts`.
5. Do **not** touch `getConfig`/`listKeys`/`watchConfig`, the `code: 13` sites, or
   `src/middleware/propagation.ts` (design.md §8).

**Verification**:
```bash
cd services/xstockstrat-config && pnpm lint && pnpm build
```

---

### Step 3 — test: `SetConfig` authz, incl. real-wire loopback proof

**Status**: `complete`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/setConfigAuthz.test.ts` — create

**Reviewers**: `xstockstrat-config` (service owner); Security — the denial path is the deliverable.

**Codebase Evidence**:
- Fake pool factory to extend: `configServiceImpl.test.ts:25-33` (`makePool`)
- Production wiring to mirror: `src/index.ts:47-50` —
  `addService(createConfigServiceDefinition(), configImpl as unknown as grpc.UntypedServiceImplementation)`
- Generated client already used in-repo: `src/services/configWatcher.ts:9,29`
  (`ConfigServiceClient`, `grpc.credentials.createInsecure()`)

**TDD**: `red-green required` — every denial case fails against the pre-Step-2 tree, where
`setConfig` writes unconditionally.

**Instructions**:
1. Unit-test `hasAdminAccessScope` directly: `'4'`→true, `'7'`→true (bitmask, not equality),
   `'0'`→false, absent header→false, `undefined` metadata→false, `'abc'`→false.
2. Add an **in-process loopback** suite: real `grpc.Server`, real `createConfigServiceDefinition()`,
   real `ConfigServiceImpl(recordingPool)`, `bindAsync('127.0.0.1:0', ...)` (take the kernel-assigned
   port from the callback), dial with the generated `ConfigServiceClient`, send real
   `grpc.Metadata`. Teardown: `client.close()` + `server.forceShutdown()`.
3. Use a **recording** pool stub that pushes `[sql, params]`, so a denied call asserts
   `queries.length === 0` — direct evidence the INSERT and `pg_notify` were both skipped.
4. Cases: no metadata → `PERMISSION_DENIED` + `'admin scope required'` + zero queries;
   `x-access-scope: '3'` → same; `'7'` → success, queries written; `'4'` + empty author +
   `x-user-id` → `updated_by` is the propagated user id; `'4'` + neither → `INVALID_ARGUMENT`.
5. **Assertion discipline**: assert only on authz outcome, author resolution, and query count. Do
   **not** assert on `environment`/`trading_mode` — over the real wire ts-proto sends camelCase and
   string enums while the impl reads `call.request.trading_mode` against a numeric map
   (`configServiceImpl.ts:13-14,253`), a pre-existing logged bug
   (`services/xstockstrat-config/docs/context-constitution-findings.md:19`) that is not this
   feature's to fix.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm lint && pnpm test:coverage 2>&1 | tail -20
# c8 --lines 40 must pass; the loopback cases must appear in the output and pass.
```

---

### Step 4 — service: admin gate on the config-ui BFF `setConfig` handler

**Status**: `complete`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/configUiBff.ts` — modify

**Reviewers**: `xstockstrat-ui` (service owner) — config mutation safety; Security.

**Codebase Evidence**:
- `configUiBff.ts:16-22` — `setConfig` handler; `requireSession(ctx)` at `:17`, `author` injection
  at `:19`, `backendHeaders(claims, ctx)` at `:20`. Import block at `:4-10` lacks `requireAdminScope`.
- Guard to reuse: `bffShared.ts:50-54` — throws `ConnectError('Admin scope required', Code.PermissionDenied)`
- Exact precedent for an explicit admin-gated body: `insightsBff.ts:42-54` (`requireAdminScope(claims)` at `:51`)

**TDD**: `red-green required` — paired by Step 5.

**Instructions**:
1. Add `requireAdminScope` to the import block at `:4-10`.
2. Call `requireAdminScope(claims);` immediately after `requireSession(ctx)`.
3. Keep the explicit handler body — `forwardAdmin` cannot be used because the handler injects
   `author: claims.user_id`.
4. Do **not** gate `listKeys` or `manageSignalSource` (design.md §8 — the latter is already gated at
   `services/xstockstrat-ingest/app/handlers/servicer.py:859-861`).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm lint && pnpm build
```

---

### Step 5 — test: config-ui e2e admin/non-admin pair

**Status**: `complete`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/config-ui/api-smoke.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` (service owner); Security.

**Codebase Evidence**:
- `api-smoke.spec.ts:120-132` and `:134-147` — both call the SetConfig BFF after `addAuthCookie`
  (roles `[]`) and assert `status === 200`; both flip to denied under the new gate.
- `e2e/helpers/auth.ts:56-58` (`addAuthCookie` → `[]`), `:61-63` (`addAdminCookie` → `['admin']`)
- Pair shape to copy: `e2e/trader/live-strategies.spec.ts:37-58` (admin) and `:60-78` (non-admin:
  `expect(result.status).not.toBe(200)`, body contains `'permission'`)
- `e2e/mock-backend.ts:752-754` — `setConfig` stub needs no change; the gate is BFF-side.
- C-12: no new fixture; auth cookies are already canonical (`e2e/fixtures/INVENTORY.md:13`).

**TDD**: `red-green required` — the new non-admin case fails against the pre-Step-4 tree (returns
200 today).

**Instructions**:
1. Switch `:121` and `:135` from `addAuthCookie(page)` to `addAdminCookie(page)`.
2. Add a third test asserting a non-admin session is denied, copying `live-strategies.spec.ts:60-78`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec playwright test e2e/config-ui/api-smoke.spec.ts --project=chromium
```

---

### Step 6 — test: integration script section 13

**Status**: `complete`
**Service**: repo scripts
**Files**:
- `scripts/integration-test.sh` — modify

**Reviewers**: none (script is CI-unwired; see below).

**Codebase Evidence**:
- `:493-497` and `:520-524` — `post_raw … /SetConfig` for `platform.maintenance_mode`, no identity
  headers, both suppressed by `|| true`
- `:111-126` — `post`/`post_raw` send only `Content-Type` + optional bearer
- `:41` — `CONFIG_URL="http://${BASE_HOST}:8060"`, a **removed** port
- `:4-11` — whole-file "PENDING UPDATE" banner; zero references to the script under `.github/`
- Precedent for this exact treatment: `docs/roadmap/features/070-strategy-partial-update/context.md:207-213`

**TDD**: `N/A (the script is wired into no CI workflow and already non-functional against the removed
80xx ports — the case is written, not relied upon as coverage)`

**Instructions**:
1. Add `x-user-id` and `x-access-scope: 4` headers to the two SetConfig calls.
2. Record the staleness at the section header, and add a note at the `:513-518` assertion that its
   `grep -qiE "…|error|…"` pattern matches any error string and would report success for the wrong
   reason if the SetConfig above it no-ops.
3. Do **not** convert the section to grpcurl and do **not** fix `CONFIG_URL` — pre-existing
   whole-script debt, recorded as an accepted C-10 gap in design.md.

**Verification**:
```bash
bash -n scripts/integration-test.sh   # syntax only; the script cannot be executed here
```

---

### Step 7 — docs: runbook, service CLAUDE.md, pattern doc, findings

**Status**: `complete`
**Service**: docs
**Files**:
- `docs/runbooks/config-rollout.md` — modify
- `services/xstockstrat-config/CLAUDE.md` — modify
- `docs/patterns/header-propagation.md` — modify
- `services/xstockstrat-config/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-ui/docs/context-constitution-findings.md` — modify

**Reviewers**: none (docs category).

**Codebase Evidence**:
- `config-rollout.md:76-91` — Step 2 gRPC example sends **no** metadata (so it would be denied
  post-fix) but **does** already send `author="platform-team"` at `:87`
- `config-rollout.md:93-104` — Connect-RPC example targets the removed port 8060
- `services/xstockstrat-config/CLAUDE.md:66-68` — "Mutate config via the `SetConfig` gRPC RPC";
  no authz statement anywhere in the file
- `header-propagation.md:26-28` — reference-helper list (Python only today)
- `header-propagation.md:36-37` — states the author "defaults to the propagated `x-user-id`,
  required", which contradicts `indicators/servicer.py:207-220` where `request.author` wins

**TDD**: `N/A (docs)`

**Instructions**:
1. `config-rollout.md` Step 2 — add `metadata=[("x-access-scope","4"),("x-user-id","<operator>")]`
   to the gRPC example; mark the Connect-RPC example as removed-port/stale.
2. `services/xstockstrat-config/CLAUDE.md` — state the invariant: `SetConfig` requires the ADMIN
   bit; `GetConfig`/`ListKeys`/`WatchConfig` are read-open **by construction** (every service boots
   over an unauthenticated `WatchConfig`).
3. `header-propagation.md` — add `xstockstrat-config` to the reference-helper list (first Node
   role-check on the platform), and correct the drifted feature-049 author wording at `:36-37` to
   match the code.
4. Findings docs — record (a) that `authz.ts` deliberately did *not* revive `propagation.ts` and the
   4-service deletion remains open, and (b) the new mock-backend fidelity finding: `e2e/mock-backend.ts`
   does not model ingest's admin gate, proven by `e2e/config-ui/sources.spec.ts:94→110` passing on a
   non-admin cookie.

**Verification**:
```bash
grep -n "x-access-scope" docs/runbooks/config-rollout.md
grep -rn "admin scope required" services/xstockstrat-config/CLAUDE.md
```

---

## Deviation Log

**Step 1 — expanded beyond the written instructions (recorded, not silent).** The spec anticipated
a `.js`→`.ts` specifier fix as a possibility. In fact three blockers stacked, and all three had to
go: the specifier, the parameter property at `configServiceImpl.ts:94`, and extensionless relative
imports once Node reparses as ESM. Rather than churn the service source, the test scripts now run
against compiled output (`tsc && node --test dist/__tests__/*.test.js`) — which resolves all three
at once and leaves `configServiceImpl.ts`'s constructor untouched. `configWatcher.test.ts` also
needed the `Object.create(prototype)` change or the suite hangs forever.

**Step 2 — eslint override widened to include `src/middleware/propagation.ts`.** The new DRY rails
immediately flagged the dead file, which the design deliberately does not delete (1-of-4 rule). The
file is exempted rather than edited, so the pending 4-service deletion stays a single change.
Recorded in the service's findings doc.

**Step 5 — environment friction, resolved.** Playwright's pinned browser build was absent from the
image (`chromium_headless_shell-1217`); `global-setup.ts`'s bare `chromium.launch()` ignores the
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` override, so the pinned build was installed. E2E then ran
with `CI=true E2E_PREBUILT=1` against a prebuilt bundle. No repo change was needed.

**Step 6 — added a `post_raw_admin` helper.** The spec said "add headers to the two SetConfig
calls"; the two call sites use the shared `post_raw`, so adding headers inline would have meant
duplicating the curl invocation twice. A single helper next to `post_raw` keeps it DRY.

**AC #4 / AC #5 — NOT executed.** Both require a dev-environment smoke test against a live
`xstockstrat-config:50060`, which this session has no access to. The runbook example is corrected
and the gate is proven by the in-process loopback suite, but the "reproduce Step 2 end-to-end on
dev" criterion is **outstanding** and must be run before this is considered launched.
