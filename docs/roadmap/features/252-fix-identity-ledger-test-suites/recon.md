# Recon: fix-identity-ledger-test-suites

**Created**: 2026-10-20
**From**: product-spec.md
**Affected services**: xstockstrat-identity, xstockstrat-ledger (test tooling only; Track C bug, SEV-3)

Sources: the identity, ledger and scenario-recon digests. Every `path:line` cited below was re-grepped at
`origin/feature/fix-identity-ledger-test-suites` @ `24320e2b`, except items marked *(digest)*. Nothing
was compiled or executed. Every pass/fail claim is inferred or quoted from `context.md`.

---

## Objective

The identity and ledger suites run `node --experimental-strip-types --test src/__tests__/*.test.ts`
(`services/xstockstrat-identity/package.json:12-13`, `services/xstockstrat-ledger/package.json:13-14`). Each
impl test file swallows its failed subject import in `before()` and early-returns from every case. As a
result `IdentityServiceImpl`, `authz`, `LedgerServiceImpl` and `EventNotifier` never load, and their tests
pass vacuously. The fix makes both suites execute against the real modules, makes an unloadable subject
fail the run, and points the c8 gate at the impl modules. Every existing test must pass for real: none may
be deleted, skipped or weakened (FR-1..FR-5).

## Codebase Map

- **`xstockstrat-identity`** (Node.js 24 / TypeScript, CJS build)
  - Entry point: `src/index.ts:46` (`new IdentityServiceImpl(pool, configWatcher, ledgerAudit)`); `ConfigWatcher` `:20`; `addService` `:50`.
  - Handler: `src/grpc/identityServiceImpl.ts:104`.
    - Constructor parameter properties `:105-110`. Strip-only mode rejects them.
    - Extensionless sibling imports `:6-9`.
    - Config read `:122`, `:126` (`identity.jwt.{access,refresh}_ttl_seconds`). Tests stub it as `{ getInt: (_k, def) => def } as any` (`identityServiceImpl.test.ts:58`).
  - Runtime proto dependency of the impl:
    - `identityServiceImpl.ts:9` → `./ledgerAudit` → `ledgerAudit.ts:8` `LedgerServiceClient` (value use `:35`) and `../mtls` (`:7`).
    - `ConfigWatcher` (`:6`) is type-only, so CJS `tsc` elides it.
    - Loading the impl therefore needs the built proto `dist` (CI `ci.yml:579-580`).
  - `authz`: `src/grpc/authz.ts`; `first` `:14`, `userIdFrom` `:20`, `hasAdminAccessScope` `:28`, `ADMIN_SCOPE_ERROR` `:35`.
  - Last migration: `migrations/006_user_metadata.up.sql`. Not touched.
  - Scripts: `package.json:8` `build` = `tsc`; `:12-13` strip-types `test` / `test:coverage` (c8 `--lines 40`).
  - Devdeps: `@types/node` `^24` `:38`, `c8` `:43`, `ts-node` `:50`, `typescript` `^5.4.5` `:51`. No `"type"` field.
  - tsconfig: `tsconfig.json:3-4` (ES2020 / `commonjs`), `:10` `strict: false`, `:12` `skipLibCheck`, `:19-23` `"exclude": [..., "src/**/*.test.ts"]`.
  - Tests (`src/__tests__/`):
    - `identityServiceImpl.test.ts` (1106 lines):
      - Header `:7-11` describes the skip and the strip-types run command.
      - `let … : any` subjects `:22-26`.
      - Swallowed import `:28-40` (`../grpc/identityServiceImpl.js` `:30`, `../grpc/authz.js` `:34`, `catch` `:37-38`).
      - **65** `if (!` guards: 29 × `if (!impl) return;` (e.g. `:82`), 27 × `if (!IdentityServiceImpl) return;` (e.g. `:632`), 4 null-returning helpers (`:56`, `:272`, `:692`, `:892`), `isBlockedDefaultAdmin` `:129`, `userIdFrom` `:648`, `:654`, `first` `:660`, `:666`.
      - **Second silent skip**: proto import `:227-232` (`@xstockstrat/proto/identity/v1/identity.js`, `catch { return; }`).
      - AC-1 target `:403` "rotates the refresh token and mints a new aud-bound access JWT"; revoke regex `:417`.
      - authz block `:646`.
      - No `.skip` / `.todo` anywhere in either service's `__tests__` (grep).
    - `mtls.test.ts:13` `'../mtls.ts'`; `telemetry.test.ts:3` `'../telemetry.ts'`.
    - `telemetry.export.test.ts`: `createRequire` `:5`; ESM-rationale comment `:7`; `createRequire(import.meta.url)` shim `:8`; `TELEMETRY = '../telemetry.ts'` `:9`, used `:53`; strip-types warning-filter comment `:31`.
  - Mutation anchors (AC-1):
    - `refreshOAuthToken` revoke `identityServiceImpl.ts:524-527`. The `last_used_at` UPDATE `:520-523` does not match the `:417` regex, so the mutation is detectable.
    - `refreshToken` revoke `:251-255` has no test on this base.
  - Coverage baseline: the main checkout's untracked `coverage/lcov.info` has only `SF:src/mtls.ts` and `SF:src/telemetry.ts`.
  - Docker: `Dockerfile:13` (root `pnpm-lock.yaml`), `:17` `--frozen-lockfile`, `:20` proto build, `:24` `run build`, `:27` `pnpm deploy --prod`, `:45` `CMD node dist/index.js`.
- **`xstockstrat-ledger`** (Node.js 24 / TypeScript, CJS build)
  - Entry point: `src/index.ts:55` (`new LedgerServiceImpl(pool, configWatcher, notifier)`); `new EventNotifier` `:51`; `addService` `:58`.
  - Handler: `src/grpc/ledgerServiceImpl.ts:19`.
    - Constructor parameter properties `:20-25`.
    - `ConfigWatcher` / `EventNotifier` imports `:4-5` are type-only, so the impl loads no proto at runtime.
    - Default import `pg-cursor` `:2` (needs `esModuleInterop`, set at `tsconfig.json:11`).
    - `protected async streamExportRows` `:333`; exports `toValidDate` `:359`, `rowToEvent` `:364`.
    - Config reads `:284` `getBool('ledger.export.enabled', true)`, `:294` `getInt('ledger.export.max_window_days', 365)`.
  - `src/services/eventNotifier.ts`: constructor parameter properties `:32-35` (`reconnectDelayMs = 2000` `:35`); reconnect `setTimeout` `:113`; `dispatch` `:119`; `sub.onEvent(row)` `:132`.
  - Last migration: `migrations/003_events_user_id.up.sql`. Not touched.
  - Scripts: `package.json:8` `build` = `tsc`; `:13-14` strip-types `test` / `test:coverage`. Devdeps `@types/node` `:38`, `c8` `:39`, `ts-node` `:48`, `typescript` `:49`.
  - tsconfig: byte-identical to identity's (`diff` verified), including the `:19-23` test exclusion.
  - Tests (`src/__tests__/`):
    - `ledgerServiceImpl.test.ts` (753 lines):
      - Header `:1-10`.
      - `let LedgerServiceImpl: any; let rowToEvent: any;` `:18-19`.
      - Swallowed import `:21-29`.
      - **31** guards: `rowToEvent` ×4 (`:111`, `:124`, `:132`, `:727`), `impl` ×9 (`:145`…`:306`), `LedgerServiceImpl` ×9 (`:279`…`:524`), `h` ×7 (`:627`…`:700`), null factories `makeImpl` `:45`, `makeExportImpl` `:568`.
      - `{}` passed as `ConfigWatcher` (`:47`, `:286`, `:331`, …).
      - `impl.streamExportRows = …` override `:586` of a `protected` method. It compiles only while the subject is `any`.
      - `makeIdempotentPool` `:56`; AC-2 target `:444`.
      - **Second silent skip**: proto import `:729-734` (`@xstockstrat/proto/ledger/v1/ledger.js`, `catch { return; }`).
    - `eventNotifier.test.ts` (177 lines):
      - Swallowed import `:16-23`; `let EventNotifier: any` `:14`.
      - `FakeClient` `:27`, passed as `() => client` `:85`. It is not a `pg.Client`, which `any` hides.
      - **7** guards `:72`…`:152`; AC-2 target `:82`.
      - Reconnect test `:151-176` uses `reconnectDelayMs = 1` and `n.stop()`.
    - `mtls.test.ts:13`, `telemetry.test.ts:3`, `telemetry.export.test.ts:5,7-9,31`: the same shapes as identity.
    - The ledger `mtls.test.ts` alone has the `@AC-6` rotated-leaf case `:149`.
  - Mutation anchors (AC-2): the duplicate-key branch `ledgerServiceImpl.ts:84-105` (block closes `:106`; dedup `callback` `:104`) → test `:444`; `eventNotifier.ts:132` → `eventNotifier.test.ts:82`.
  - Docker: `Dockerfile:13`, `:17`, `:20`, `:24`, `:27` (same as identity), `:38` `CMD node dist/index.js`.
  - The ledger `CLAUDE.md` has no test-runner section.
- **Shared CI / repo**
  - `.github/workflows/ci.yml` `node-test` `:534-591`:
    - Matrix `:549-562` (ledger `:553`, identity `:555`, both `coverage_threshold: 40`). The job never reads `matrix.coverage_threshold`; only `:266` and `:401`, in other jobs, do.
    - Node `"24"` `:572`; `pnpm install --no-frozen-lockfile` `:577`.
    - Proto build `:579-580`, then `pnpm run test:coverage` in `services/<svc>` `:582-584`.
    - Upload `coverage/lcov.info` `:590`.
  - `.nvmrc:1` = `22`.
  - The ignore file covers `**/dist/` (`:15`, `:25`) and `**/coverage/` (`:20`). There is no root `.dockerignore`.
  - Proto exports map `packages/proto/gen/ts/package.json:5-7` is `"./*": "./dist/*.js"`. `dist/identity/v1/` and `dist/ledger/v1/` hold only `<name>.js`, `<name>.d.ts`, `<name>_pb.{js,d.ts}`.

## Patterns to REUSE

- **Compile-then-test scripts** → copy `services/xstockstrat-config/package.json:12-13`. Notify's `package.json:12-13` is identical:
  - `"test": "tsc && node --test dist/__tests__/*.test.js"`
  - `"test:coverage": "tsc && c8 --reporter=text --reporter=lcov --lines 40 node --test dist/__tests__/*.test.js"`
  - `typescript`, `c8` and `ts-node` are already devDependencies in both services. No new dependency or lockfile change is needed.
- **Tests inside the `tsc` program** → config and notify tsconfigs have no test exclusion: `services/xstockstrat-config/tsconfig.json:14-15` and `services/xstockstrat-notify/tsconfig.json:14-15` (`"include": ["src/**/*"], "exclude": ["node_modules", "dist"]`). Their compiler options otherwise match identity and ledger (ES2020, commonjs, `strict: false`, `esModuleInterop`, `skipLibCheck`).
- **Hard-fail subject import.** Two precedents:
  - (a) A bare `before()` dynamic import with no try/catch, plus a `test harness` case. See `services/xstockstrat-config/src/__tests__/configServiceImpl.test.ts:15-27`: the rationale comment `:15-17`, `await import('../grpc/configServiceImpl.js')` `:19`, and `assert.ok(ConfigServiceImpl, '… must import — never skip silently')` `:25`. The subject is typed `typeof import('../grpc/configServiceImpl').ConfigServiceImpl` (`:13`).
  - (b) A static import plus a harness case. See `services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts`: rationale header `:8-16`, `import { NotifyServiceImpl, rowToAlert } from '../grpc/notifyServiceImpl.js'` `:20`, harness `:28-33`.
  - Notify's documented convention is `services/xstockstrat-notify/CLAUDE.md:57-60`.
  - The `.js` relative specifiers resolve under the compiled CJS layout, so identity and ledger `:30`, `:34`, `:23`, `:18` need no specifier change.
- **Untyped mocks stay untyped** → keep the `any` subject or cast at the call site. Do not build typed fixtures. This keeps `{}` as `ConfigWatcher`, the `protected streamExportRows` override (`ledgerServiceImpl.test.ts:586`) and `FakeClient` (`eventNotifier.test.ts:85`) compiling. Notify does the same with `pool as any, {} as any` (`notifyServiceImpl.test.ts:50`).
- **Non-impl tests that compile under CJS `tsc`** → the config and notify counterparts:
  - `mtls.test.ts:13` `'../mtls'`, `telemetry.test.ts:3` `'../telemetry'`, `telemetry.export.test.ts:6` `const TELEMETRY = '../telemetry'`.
  - None has a `createRequire` shim. `telemetry.ts:33,35,37,43` (identity and ledger) `require()`s the OTel SDK natively under CJS.
- **Proto specifier** → the extensionless form already used by `services/xstockstrat-identity/src/index.ts:6` and `notifyServiceImpl.test.ts:22`. This plus removing the `catch { return; }` closes the second silent skips (`identityServiceImpl.test.ts:229`, `ledgerServiceImpl.test.ts:731`).
- **Coverage enforcement** → c8's own `--check-coverage`. It defaults to `false` (`node_modules/.pnpm/c8@10.1.3/node_modules/c8/lib/parse-args.js:85-86`), and thresholds are checked only when it is set (`…/c8/lib/commands/report.js:43`). See Risk 1.
- **Vacuous-suite discriminator** → a mutation check under the real runner. The tell is the same pass count with and without the impl (`docs/roadmap/ledger/fails.md:2226`). AC-1 and AC-2 already encode it as mutation Thens.
- **Test-data home (C-13)** → none. Neither service has `src/__tests__/fixtures/`, every inline mock has one consumer, and the fix adds no domain data.
- **Runner doc note** → if a service `CLAUDE.md` gets one, mirror `services/xstockstrat-notify/CLAUDE.md:57-60` rather than new prose. Whether one is needed at all is a C-18 YAGNI call for design.

## Existing Business Rules (preserve / extend)

There is no EXTEND and no CHANGE: this is test tooling with no runtime behavior change (`product-spec.md` Consumer Surface(s)). Every relevant guarantee below is PRESERVE.

The tests asserting the 043, 183 and 021 rules execute for the first time after this fix. A real failure there means the guarantee was silently regressed. Under FR-5 and the operator decision of 2026-10-20 it is fixed or recorded, and never deleted, skipped or weakened. Editing or removing an assertion in one of these tests would itself be a silent CHANGE (C-16) and needs user sign-off recorded in `context.md`.

- **PRESERVE** `@AC-1 @FR-1 @feature-043` "Admin lists all users" (`services/xstockstrat-identity/acceptance/user-management-ui.feature`) — ListUsers returns no password fields; its tests in identityServiceImpl.test.ts become live once the suite loads the impl.
- **PRESERVE** `@AC-2 @FR-2 @feature-043` "Admin creates a new user who can then sign in" (`services/xstockstrat-identity/acceptance/user-management-ui.feature`) — CreateUser; the createUser test newly executes.
- **PRESERVE** `@AC-3 @FR-3 @feature-043` "Admin resets a user's password without the current password" (`services/xstockstrat-identity/acceptance/user-management-ui.feature`) — UpdatePassword; the updatePassword test newly executes.
- **PRESERVE** `@AC-4 @FR-4 @feature-043` "Admin assigns and removes roles" (`services/xstockstrat-identity/acceptance/user-management-ui.feature`) — SetUserRoles; the setUserRoles test newly executes.
- **PRESERVE** `@AC-5 @FR-5 @feature-043` "Admin deactivates a user, blocking login" (`services/xstockstrat-identity/acceptance/user-management-ui.feature`) — SetUserActive(false); the setUserActive test newly executes.
- **PRESERVE** `@AC-6 @FR-6 @feature-043` "Admin reactivates a previously deactivated user" (`services/xstockstrat-identity/acceptance/user-management-ui.feature`) — SetUserActive(true); the setUserActive test newly executes.
- **PRESERVE** `@AC-7 @FR-7 @feature-043` "A non-admin caller is denied every user-management RPC" (`services/xstockstrat-identity/acceptance/user-management-ui.feature`) — admin gate on all six RPCs; newly executes.
- **PRESERVE** `@AC-8 @FR-8 @feature-043` "Every user-management action writes a ledger audit event" (`services/xstockstrat-identity/acceptance/user-management-ui.feature`) — audit emit with a secret-free payload; newly executes.
- **PRESERVE** `@AC-10 @FR-10 @feature-043` "Passwords are never returned or displayed" (`services/xstockstrat-identity/acceptance/user-management-ui.feature`) — no password or hash in responses; newly executes.
- **PRESERVE** `@AC-11 @FR-11 @feature-043` "The last active admin cannot be deactivated or demoted" (`services/xstockstrat-identity/acceptance/user-management-ui.feature`) — last-admin guard; newly executes.
- **PRESERVE** `@AC-10 @FR-10 @feature-183` "Admin profile RPCs enforce admin gating at the identity service, not only in the agent" (`services/xstockstrat-identity/acceptance/mcp-user-profile-roles.feature`) — admin metadata gate; newly executes.
- **PRESERVE** `@AC-3 @FR-3 @feature-021` "event_type filter restricts the export to the listed types" (`services/xstockstrat-ledger/acceptance/ledger-event-export.feature`) — ExportEvents filter; the exportEvents tests become live with LedgerServiceImpl.
- **PRESERVE** `@AC-4 @FR-3 @feature-021` "Omitting event_type returns all five event types" (`services/xstockstrat-ledger/acceptance/ledger-event-export.feature`) — ExportEvents with no type predicate.
- **PRESERVE** `@AC-5 @FR-4 @feature-021` "A window wider than the configured maximum is rejected" (`services/xstockstrat-ledger/acceptance/ledger-event-export.feature`) — INVALID_ARGUMENT with the exact message.
- **PRESERVE** `@AC-8 @FR-7 @feature-021` "Each exported row carries the required fields" (`services/xstockstrat-ledger/acceptance/ledger-event-export.feature`) — wire shape including userId and payload.
- **PRESERVE** `@AC-10 @FR-9 @feature-021` "Export is disabled when the feature flag is off" (`services/xstockstrat-ledger/acceptance/ledger-event-export.feature`) — `ledger.export.enabled=false` rejection.
- **PRESERVE** `@AC-11 @FR-10 @feature-021` "The export returns only the authenticated user's own events" (`services/xstockstrat-ledger/acceptance/ledger-event-export.feature`) — per-user scoping.
- **PRESERVE** `@AC-1 @FR-1 @FR-2 @feature-021` "Date-range export streams every event as NDJSON in global-sequence order" (`docs/sdd/business-rules/platform.feature`) — only the ledger ascending-sequence clause is touched, by the ledger exportEvents test.
- **PRESERVE** `@AC-7 @FR-6 @feature-021` "A one-million-row export streams without buffering the full result set" (`docs/sdd/business-rules/platform.feature`) — batched streaming on a dedicated client, covered by the ledger exportEvents test.
- **PRESERVE** `@AC-1 @FR-1 @regression @feature-171` "A telemetry module's built Resource no longer carries the trading_mode attribute" (`docs/sdd/business-rules/platform.feature`) — identity and ledger telemetry.test.ts; its import is edited for tsc.
- **PRESERVE** `@AC-2 @FR-3 @regression @feature-171` "Telemetry init remains non-blocking after the trading_mode attribute is removed" (`docs/sdd/business-rules/platform.feature`) — marginal; telemetry modules are touched only by import edits.
- **PRESERVE** `@AC-1 @FR-1 @regression @feature-226` "A backend service exports traces over OTLP/HTTP to a path-prefixed gateway URL" (`docs/sdd/business-rules/platform.feature`) — identity and ledger telemetry.export.test.ts; its import is edited for tsc.
- **PRESERVE** `@AC-3 @FR-3 @regression @feature-226` "A failed trace export is visible in service logs" (`docs/sdd/business-rules/platform.feature`) — telemetry.export.test.ts "logs a rejected export" in both services.
- **PRESERVE** `@AC-1 @FR-1 @feature-210` "A plaintext gRPC caller is refused in production configuration" (`docs/sdd/business-rules/platform.feature`) — mtls.test.ts in both services; the `.ts` import at `:13` is edited.
- **PRESERVE** `@AC-2 @FR-1 @FR-2 @feature-210` "A mutually-authenticated peer with a valid platform-issued identity is accepted" (`docs/sdd/business-rules/platform.feature`) — mtls.test.ts handshake test.
- **PRESERVE** `@AC-4 @FR-4 @feature-210` "mTLS is enforced identically in every environment; verification cannot be disabled" (`docs/sdd/business-rules/platform.feature`) — mtls.test.ts "fails closed when MTLS_* env is absent".
- **PRESERVE** `@AC-5 @FR-5 @feature-210` "Header-propagation semantics are unchanged beneath mTLS" (`docs/sdd/business-rules/platform.feature`) — the trio propagates in the mtls.test.ts handshake test.
- **PRESERVE** `@AC-6 @FR-6 @FR-3 @feature-210` "A long-lived streaming RPC survives a certificate rotation" (`docs/sdd/business-rules/platform.feature`) — asserted only by ledger mtls.test.ts:149.
- **PRESERVE** `@AC-2 @FR-2 @regression @item-6 @feature-175` "The confirmed-dead propagation middleware is gone from the Node leaf services" (`docs/sdd/business-rules/platform.feature`) — ledger must still build (tsc) and pass its tests after the test-build change.
- **PRESERVE** `@AC-3 @FR-3 @regression @item-7 @feature-175` "The Node leaf type surface matches the Node 24 runtime" (`docs/sdd/business-rules/platform.feature`) — production `tsc` typecheck and the `@types/node` ^24 pin must survive the new test tsconfig and loader devDependency.
- Both affected services have an `acceptance/` suite. No service lacks one.

**Out of scope / not impacted**
- `@AC-10 @FR-6 @feature-163` (`services/xstockstrat-ledger/acceptance/snapshot-offline-positions.feature`): the subject is the portfolio snapshot emitting the event, and no ledger test asserts it.
- Feature 021 `@AC-2 @FR-2` (CSV, BFF-level); feature 226 `@AC-4 @FR-4` (compose OTLP endpoint); feature 171 `@AC-3 @FR-2` (dashboards README); feature 175 `@AC-1 @FR-1 @item-5` (Go config packages).
- Every other `platform.feature` scenario (features 147, 127, 149, 157, 163, 029, 110, 181, 182, 205, 224, 196, 225, 218, 217): the subjects are other services, migrations, docs or the agent.

**Notes**
- **Rules with no durable `@AC`.** The rules targeted by this feature's own AC-1/AC-2 mutations live only in the context constitutions:
  - refresh rotation revoke / `aud`-binding, `services/xstockstrat-identity/docs/context-constitution.md:21` (IDENTITY-4);
  - idempotent-append dedup, `services/xstockstrat-ledger/docs/context-constitution.md:18` (LEDGER-1);
  - `EventNotifier` fan-out;
  - the seed-admin production lockout.

  They enter the durable suites only by launch-time promotion of this feature's `acceptance.feature` (C-16).
- **Tag collisions.** `@AC-n` numbers repeat across source features, e.g. `@AC-1` for 021, 171, 175, 210, 226 and 218 in `platform.feature`, and identity `@AC-10` under both 043 and 183. Always cite `@feature-*` together with the number.
- **Coverage check** (scenario-recon). 71 scenarios scanned (identity 11, ledger 7, platform 53; counts re-grepped). 30 are relevant (identity 11, ledger 6, platform 13). Tests were mapped by describe/it titles.

## Dependencies

- **Proto/RPC:** no change. The build-time dependency is the proto `dist`, needed by the identity impl load path (`ledgerAudit.ts:8`) and by both regression tests (`identityServiceImpl.test.ts:229`, `ledgerServiceImpl.test.ts:731`). It is built in CI at `ci.yml:579-580` and in Docker at `Dockerfile:20`.
- **Migration:** none. The next numbers would be identity `007` and ledger `004`.
- **Config keys:** none. The impls read existing `identity.jwt.*` and `ledger.export.*` keys through in-test stubs, never through a live `ConfigWatcher`.
- **Inter-service edges:** none.
- **New env vars / ports:** none. Tests set `JWT_SECRET` in-process (e.g. `identityServiceImpl.test.ts:404`); `mtls.test.ts` mints its PKI via `openssl` into a temp dir (identity `:2`, `:9`, `:20`).
- **Toolchain:**
  - Root `pnpm-lock.yaml` importers: identity `:128`, ledger `:222`. Workspace `pnpm-workspace.yaml:3` (`services/*`).
  - Installed: typescript 5.9.3 (also 5.4.5, 4.5.2 in the store), c8 10.1.3, ts-node 10.9.2, bcrypt 5.1.1.
  - No `tsx@` entry in the lock (count 0) and no `@swc-node`. A loader route adds a devDependency and changes the root lock.
  - The Dockerfiles install `--frozen-lockfile` (`:17`) while CI uses `--no-frozen-lockfile` (`ci.yml:577`), so a stale lock fails the image, not the PR.
  - TS 5.9.3 declares `rewriteRelativeImportExtensions` (`node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/lib/typescript.d.ts:7103`). That is a possible alternative to editing the `.ts` test imports. It has not been tried.

## Risks / Not-found

### Risks

1. **c8 `--lines 40` is unenforced.**
   - No service script passes `--check-coverage` (grep over `services/*/package.json`: none).
   - There is no `.c8rc*` or `.nycrc*` in identity, ledger, config or notify, and no `"c8"` block in their `package.json`.
   - c8 checks thresholds only with `--check-coverage` (`c8/lib/parse-args.js:85-86`, `report.js:43`). This is why `fails.md:1948` records a zero-file run exiting 0.
   - So AC-4's "the 40 percent line threshold still passes" holds vacuously today. Design must decide whether identity and ledger add `--check-coverage`.
   - Config and notify share the gap, and product-spec Out of Scope excludes "changing config or notify test setups". Design must say whether that exclusion covers this flag.
2. **Second silent skips survive a runner-only fix** (`identityServiceImpl.test.ts:227-232`, `ledgerServiceImpl.test.ts:729-734`).
   - Under the exports map (`packages/proto/gen/ts/package.json:5-7`), `…/v1/<name>.js` resolves to `dist/<pkg>/v1/<name>.js.js`, which does not exist.
   - The `catch { return; }` then passes vacuously, against FR-3 and FR-5.
   - Inferred from the exports map; not executed.
3. **Test syntax that CJS `tsc` rejects.**
   - The `.ts`-suffixed imports (TS5097) are why the tests are excluded from the tsconfig in the first place (`fails.md:2238-2241`, feature 171/175).
   - `import.meta.url` (`telemetry.export.test.ts:8`) is invalid under `module: commonjs` (TS1343 *(digest)*). Dropping the shim leaves `:5` unused.
   - Removing the exclusion exposes the production `pnpm build` to test sources. Verify both `pnpm build` and `test:coverage` per service, as feature 175 `@AC-2`/`@AC-3` require.
4. **Compiled tests ship in the image.**
   - `Dockerfile:24,27` in both services; config and notify already ship them.
   - The alternative is a test-only tsconfig extending `tsconfig.json`. No Node service has one (Glob: only `tsconfig.json` per service).
5. **Typing a subject breaks `tsc`.**
   - Bare pool objects and `{}` do not satisfy `Pool` / `ConfigWatcher`. `FakeClient` does not satisfy `() => Client` (`eventNotifier.ts:33`).
   - The `protected` override `:586` also fails once the subject is typed.
   - A static import (precedent b) needs casts at those call sites. The `any` binding in a hard `before()` import (precedent a) needs none.
   - Inferred; not compiled.
6. **The compiled result is unobserved.**
   - The triage-time ad-hoc compile gave identity 66/67 and ledger 36/37, with `mtls.test` the single failure in each (`context.md` /sdd-triage entry). Its flags differed from the real tsconfig (defect report Reproduction step 3: `--target ES2022`).
   - Expect latent failures (`insights.md:1149-1152`; `fails.md:115-133`, feature 074: one stale expectation and one hang).
   - The bcrypt native binding loads at `identityServiceImpl.ts:5` and becomes a hard dependency once the import fails loudly *(digest)*.
7. **Timing risk in `eventNotifier.test.ts:151-176`.** The test relies on two `tick()`s against a 1 ms reconnect timer (`eventNotifier.ts:113`). It never ran before, so it may flake. It calls `n.stop()`, so a held-open event loop is unlikely. Unverified.
8. **FR-5 vs AC-5 tension** (`context.md`, sdd-review entry). FR-5 lets a real failure be "recorded in context.md", but AC-5 needs `# fail 0`, and the operator decision forbids delete, skip or weaken. Design must say how a recorded-but-unfixed failure lands: fixed in this feature, or stop and ask.
9. **AC-3 RED mechanism.**
   - A static import of a missing module fails `tsc`, so `tsc && …` exits non-zero before any test runs (no `noEmitOnError`, but the exit code is non-zero).
   - For a literal dynamic `import()` in `before()`, whether `tsc` flags it (TS2307) or the failure surfaces only at runtime as a failed hook is unverified.
   - Either satisfies AC-3, but the RED evidence must be captured, not assumed.
10. **Node version split.** `.nvmrc:1` is `22`; CI uses `24` (`ci.yml:572`; `fails.md:2223-2226`). Compile-first removes the dependence on strip-types behaviour.
11. **Overlaps.**
    - Hotfix #1262 (`origin/hotfix/fix-refresh-token-rotation`) changes `identityServiceImpl.test.ts` (+82) and `identityServiceImpl.ts`. It adds two `if (!impl) return;` guards inside `${method} rotation is single-use` (diff verified). Whichever lands second removes those and merges the other's test changes (operator decision).
    - Feature 248 (`draft`): its branch diff vs main-dev is docs-only (no `services/*/src` change). A future 248 regression test in `ledgerServiceImpl.test.ts` / `eventNotifier.test.ts` becomes a hard failure once 252 lands.
    - Feature 241: no overlap (`context.md` correction).
12. **Teardown targets** (stale once the runner changes; root `CLAUDE.md` § Teardown, `fails.md:671-674`):
    - `.claude/skills/sdd-qa/reference/lang-node.md:11-32`. It already wrongly lists notify as strip-types at `:13-18`.
    - `docs/patterns/ci-overview.md:56`, which calls c8 `0%` "a known TypeScript tooling artefact".
    - The defect rows `services/xstockstrat-identity/docs/context-constitution-findings.md:57` and `services/xstockstrat-ledger/docs/context-constitution-findings.md:50`.
    - The test headers `identityServiceImpl.test.ts:7-11`, `ledgerServiceImpl.test.ts:1-10`, `eventNotifier.test.ts:1-10`, and `telemetry.export.test.ts:7,31` (both services).

### Ledger carried (identity / ledger)

- `fails.md:115-133` (074): this vacuous-green family, and its three blockers. Under the compiled run, one case failed on a stale expectation and another hung on a live `ConfigWatcher`.
- `fails.md:1942-1956` (021, ledger): strip-types runs parameter-property suites at 0% and still exits 0. The rule is build-then-`--test`.
- `fails.md:2223-2226` (identity): the Node 22 vs 24 split. Confirm `typeof Impl === 'function'`; a pass count that is the same with and without the impl is the tell.
- `fails.md:2238-2241` (171): the strip-types-ESM vs `tsc`-first-CJS split. Verify both the test run and the production `tsc` build.
- `fails.md:671-674` (and root `CLAUDE.md` § Teardown, which cites `fails.md:670`): a Teardown audit is not discharged by a note.
- `insights.md:1149-1152`: compile-first surfaces latent errors. Expect and welcome them.
- `insights.md:2946-2949` (175): strip-types type-checks nothing, so `pnpm build` is the real gate. The leaf Dockerfiles use the root lock.

### Not found

- No compiled `dist/` for identity or ledger, and no ledger `coverage/lcov.info` baseline.
- No `tsconfig.test.json` or `tsconfig.build.json` in any Node service.
- No `tsx`, `@swc-node` or other TS loader in the lock.
- No test-runner section in the ledger `CLAUDE.md` or in either service's `docs/context-constitution.md`. Only the findings-index rows mention it.
- Not observed, because nothing was executed:
  - compiled pass/fail counts per service;
  - whether `tsc` over the tests raises type errors under `strict: false`;
  - c8 row names (`dist/…` vs `src/…`; no tsconfig sets `sourceMap`);
  - whether c8's default exclude keeps `__tests__` out of the table;
  - the actual `mtls.test` outcome under the real compile.
- Not checked: whether the per-service `pnpm-lock.yaml` files are tracked. The Dockerfiles use the root lock (`:13`).

## Recommended Scope

Advisory input to the grilling and `/sdd-spec`; not binding.

**Forks to settle:**
- (a) **Runner.** Options:
  - compile-then-test, which reuses config/notify and needs no dependency;
  - a `tsx` loader, which adds a devDependency and changes the root lock;
  - `--experimental-transform-types`, which needs `.ts` extension rewrites in runtime files.
- (b) **Test compilation.** Drop the tsconfig `:19-23` exclusion (the config precedent; tests ship in the image), or add a test-only tsconfig (new to the repo).
- (c) **Hard-fail form.** A bare `before()` import, or a static import. Both add a harness case. Bear in mind the typing cost in Risk 5.
- (d) **`--check-coverage`** (Risk 1) and its scope against Out of Scope.
- (e) **Landing a real failure** (Risk 8).

**Steps:**
1. **identity runner.**
   - Change `package.json:12-13` and the tsconfig per fork (b).
   - Edit the non-impl imports: `mtls.test.ts:13`, `telemetry.test.ts:3`, `telemetry.export.test.ts:5,7-9`.
   - Verify that `pnpm build` and `pnpm run test:coverage` pass, and that lcov gains `identityServiceImpl` and `authz` rows.
2. **identity impl-test hardening.**
   - Make the import at `:28-40` hard-fail and add a harness case.
   - Remove the 65 guards, fix the proto specifier at `:229` and drop its catch, and rewrite the header at `:7-11`.
   - RED evidence: the AC-1 mutation at `identityServiceImpl.ts:524-527`, the AC-3 bogus import, and the AC-4 rows.
3. **ledger runner.** As step 1, applied to `package.json:13-14`, the tsconfig and the three non-impl tests.
4. **ledger impl-test hardening.**
   - `ledgerServiceImpl.test.ts:21-29`, its 31 guards, and the proto skip at `:729-734`.
   - `eventNotifier.test.ts:16-23` and its 7 guards.
   - The file headers.
   - RED evidence: the AC-2 mutations at `ledgerServiceImpl.ts:84-105` and `eventNotifier.ts:132`, AC-3, and AC-4.
5. **Fix or record latent failures** from steps 1-4, per the operator decision; never skip. This may fold into steps 2 and 4.
6. **Coverage flag**, if fork (d) adds it.
7. **Docs teardown** for the Risk 12 targets, plus the `/context-forge:context-constitution refresh` audit.
