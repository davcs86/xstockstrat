# Recon: fix-identity-ledger-test-suites

**Created**: 2026-10-20
**From**: product-spec.md
**Affected services**: xstockstrat-identity, xstockstrat-ledger (test tooling only; Track C bug, SEV-3)

---

## Objective

The identity and ledger unit suites run `node --experimental-strip-types --test src/__tests__/*.test.ts`
(`services/xstockstrat-identity/package.json:12-13`, `services/xstockstrat-ledger/package.json:13-14`).
Each impl test file swallows its subject-import failure in `before()` and early-returns from every case.
As a result the impl and authz tests pass vacuously and c8 measures only `mtls.ts` and `telemetry.ts`.
The fix makes both suites load and exercise the real `IdentityServiceImpl`, `authz`, `LedgerServiceImpl`
and `EventNotifier`. An unloadable subject must fail the run, and the coverage gate must measure the impl
modules. Every existing test must pass for real: none may be deleted, skipped or weakened (FR-1..FR-5).

## Codebase Map

- **`xstockstrat-identity`** (Node.js 24 / TypeScript)
  - Entry point: `services/xstockstrat-identity/src/index.ts:46` (`new IdentityServiceImpl(pool, configWatcher, ledgerAudit)`); `ConfigWatcher` at `:20`; proto import `:6` (extensionless `@xstockstrat/proto/identity/v1/identity`).
  - Handler/servicer: `src/grpc/identityServiceImpl.ts:104` (`export class IdentityServiceImpl`).
    - Constructor parameter properties at `:105-110`; strip-only mode cannot load these.
    - Sibling imports are extensionless (`:6-9`).
    - Other exports: `SEED_ADMIN_PASSWORD_HASH` `:32`, `isBlockedDefaultAdmin` `:38`.
  - `authz`: `src/grpc/authz.ts:14` `first`, `:20` `userIdFrom`, `:28` `hasAdminAccessScope`.
  - Last migration: `006_user_metadata.up.sql` (`services/xstockstrat-identity/migrations/`). Not touched.
  - Config-read pattern: `identityServiceImpl.ts:122` `this.config.getInt('identity.jwt.access_ttl_seconds', 900)`. Tests stub `config` as `{ getInt: (_k, def) => def } as any` (`identityServiceImpl.test.ts:58`).
  - Scripts and build:
    - `package.json:8` `"build": "tsc"`.
    - `:12-13` are the strip-types `test` and `test:coverage` scripts.
  - tsconfig: `tsconfig.json:3-4` sets ES2020 / `commonjs`, `:10` sets `strict: false`, and `:19-23` has `"exclude": ["node_modules","dist","src/**/*.test.ts"]`. The ledger tsconfig is byte-identical (diff verified).
  - Test files (`src/__tests__/`):
    - `identityServiceImpl.test.ts`:
      - File header documenting the skip behaviour: `:7-11`.
      - `let … : any` subject vars: `:22-26`.
      - Swallowed lazy import of `../grpc/identityServiceImpl.js` and `../grpc/authz.js`: `:28-40`.
      - Guards: 61 `if (!x) return;` plus 4 `if (!IdentityServiceImpl) return null;` helpers (`:56`, `:272`, `:692`, `:892`), 65 in total.
      - Second silent skip (proto import): `:227-232`.
      - AC-1 target test `:403`, with its revoke assertion at `:417`.
      - authz block `:646-670`, guards at `:648`, `:654`, `:660`, `:666`.
    - `mtls.test.ts:13`: `import * as mtls from '../mtls.ts'`.
    - `telemetry.test.ts:3`: `from '../telemetry.ts'`.
    - `telemetry.export.test.ts`:
      - `:5` and `:8` add a `createRequire(import.meta.url)` shim, with its comment at `:7`.
      - `:9` sets `const TELEMETRY = '../telemetry.ts'`.
      - `:31` has a strip-types warning-filter comment.
  - AC-1 mutation target: the `refreshOAuthToken` revoke at `identityServiceImpl.ts:524-527`. The `refreshToken` revoke at `:251-255` has no test on this base.
  - Proto runtime dependency: `src/services/configWatcher.ts:7-8` imports `@xstockstrat/proto/config/v1/config` and `common/v1/common`, so loading the impl needs the built proto `dist`.
  - Coverage baseline: the main checkout's untracked `services/xstockstrat-identity/coverage/lcov.info` lists only `SF:src/mtls.ts` and `SF:src/telemetry.ts`.
  - Docker:
    - `Dockerfile:13` copies the root `pnpm-lock.yaml`, and `:17` runs `pnpm install --frozen-lockfile`.
    - `:24` runs `pnpm --filter xstockstrat-identity run build`.
    - `:27` runs `pnpm deploy --prod`.
- **`xstockstrat-ledger`** (Node.js 24 / TypeScript)
  - Entry point: `services/xstockstrat-ledger/src/index.ts:55` (`new LedgerServiceImpl(pool, configWatcher, notifier)`); `new EventNotifier(...)` `:51`; `addService` `:58`.
  - Handler/servicer: `src/grpc/ledgerServiceImpl.ts:19`.
    - Constructor parameter properties at `:20-25`.
    - `ConfigWatcher` and `EventNotifier` imports at `:4-5` are type-only.
    - `protected async streamExportRows` at `:333`.
    - Exports: `toValidDate` `:359`, `rowToEvent` `:364`.
  - `EventNotifier`: `src/services/eventNotifier.ts`.
    - Constructor parameter properties at `:32-36`.
    - `dispatch` at `:119`; `sub.onEvent(row)` at `:132`.
    - Reconnect `setTimeout` at `:110-117`, with `reconnectDelayMs` defaulting to 2000 at `:35`.
  - Last migration: `003_events_user_id.up.sql` (`services/xstockstrat-ledger/migrations/`). Not touched.
  - Config-read pattern:
    - `ledgerServiceImpl.ts:284` `getBool('ledger.export.enabled', true)`.
    - `:294` `getInt('ledger.export.max_window_days', 365)`.
    - Tests pass `{}` as `ConfigWatcher` (`ledgerServiceImpl.test.ts:47`, `:286`, `:331`).
  - Scripts and build:
    - `package.json:8` `build` = `tsc`; `:9` `start`; `:10` `dev` = ts-node.
    - `:13-14` are the strip-types `test` and `test:coverage` scripts.
  - tsconfig: `tsconfig.json:19-23`, the same test exclusion as identity.
  - Test files (`src/__tests__/`):
    - `ledgerServiceImpl.test.ts`:
      - File header `:1-10`.
      - `let LedgerServiceImpl: any; let rowToEvent: any;` at `:18-19`.
      - Swallowed lazy import: `:21-29`.
      - Null helpers `:45` and `:568`; 31 guards in total.
      - AC-2 target test `:444`.
      - `streamExportRows` override `:586`. It type-checks only because the subject is `any`.
      - Second silent skip (proto import): `:729-734`.
    - `eventNotifier.test.ts`:
      - Swallowed lazy import: `:16-23`.
      - 7 guards.
      - AC-2 target test `:82`.
    - `mtls.test.ts:13`, `telemetry.test.ts:3` and `telemetry.export.test.ts:5,7-9` are the same as identity's. The ledger `telemetry.export.test.ts` is byte-identical to identity's (diff verified).
  - AC-2 mutation targets:
    - The duplicate-key branch at `ledgerServiceImpl.ts:84-105` → `ledgerServiceImpl.test.ts:444`.
    - `eventNotifier.ts:132` → `eventNotifier.test.ts:82`.
  - Docker:
    - `Dockerfile:13` copies the root lock, and `:17` runs `--frozen-lockfile`.
    - `:24` runs the build and `:27` runs `pnpm deploy --prod`.
    - `:38` runs `CMD ["node", "dist/index.js"]`.
  - The ledger `CLAUDE.md` has no test-runner section.
- **Shared CI** (`.github/workflows/ci.yml`, `node-test` job `:534-591`)
  - The matrix gives identity and ledger `coverage_threshold: 40` at `:553-556`. The `node-test` job never reads `matrix.coverage_threshold`; only `:266` and `:401` in other jobs do.
  - Node is `"24"` (`:572`), while `.nvmrc` is `22`.
  - Install step: `pnpm install --no-frozen-lockfile` (`:577`).
  - Proto stubs are built at `:579-580` before the test runs at `:582-584`, in `services/<svc>`.
  - The job uploads `coverage/lcov.info` (`:590`).
  - `.gitignore:15,25` ignores `**/dist/`, and `:20` ignores `**/coverage/`.

## Patterns to REUSE

- **Compile-then-test scripts** → copy `services/xstockstrat-config/package.json:12-13` verbatim. Notify's `package.json:12-13` is identical:
  - `"test": "tsc && node --test dist/__tests__/*.test.js"`
  - `"test:coverage": "tsc && c8 --reporter=text --reporter=lcov --lines 40 node --test dist/__tests__/*.test.js"`
  - `ts-node`, `typescript` and `c8` are already devDependencies (identity `package.json:43,50-51`; ledger `:39,48-49`), so no new dependency or lockfile change is needed.
- **Compiling tests into `dist/`** → config and notify tsconfigs have no test exclusion: `services/xstockstrat-config/tsconfig.json:14-15` and `services/xstockstrat-notify/tsconfig.json:14-15` (`"include": ["src/**/*"], "exclude": ["node_modules", "dist"]`). Their compiler options otherwise match identity and ledger (ES2020, commonjs, `strict: false`).
- **Hard-fail subject import.** Two precedents exist:
  - (a) A bare dynamic import in `before()` with no try/catch, plus a `test harness` assertion: `services/xstockstrat-config/src/__tests__/configServiceImpl.test.ts:15-27` (`assert.ok(ConfigServiceImpl, '… must import — never skip silently')`) and `configWatcher.test.ts:26,39`.
  - (b) A static import plus a harness assertion: `services/xstockstrat-notify/src/__tests__/notifyServiceImpl.test.ts:8-15` (rationale header), `:20` (`import { NotifyServiceImpl, rowToAlert } from '../grpc/notifyServiceImpl.js'`) and `:28-33`.
  - Notify's documented convention is at `services/xstockstrat-notify/CLAUDE.md:57-58` ("Tests run compile-first").
- **Typed subject with structural mocks**:
  - Config types the subject as `typeof import('../grpc/configServiceImpl').ConfigServiceImpl` (`configServiceImpl.test.ts:13`), and its `makePool(...)` returns `any` (`:30`).
  - Notify passes `pool as any, {} as any` (`notifyServiceImpl.test.ts:50`).
  - Ledger today relies on `let LedgerServiceImpl: any` (`ledgerServiceImpl.test.ts:18`). That keeps `{}` as `ConfigWatcher` (`:47,286,331`) and the `protected streamExportRows` override (`:586` vs `ledgerServiceImpl.ts:333`) compiling. Keep the `any` typing or cast at the call sites; do not add typed fixtures.
- **Non-impl tests that compile under `tsc` (CJS)** → the config and notify counterparts:
  - `mtls.test.ts:13` imports `'../mtls'`, `telemetry.test.ts:3` imports `'../telemetry'`, and `telemetry.export.test.ts:6` sets `const TELEMETRY = '../telemetry'`. None has a `createRequire` shim.
  - Identity's `telemetry.export.test.ts` differs from config's only at `:5,7-9`, the shim and the `.ts` suffix (diff verified). The import edit is therefore a known-good copy.
  - `telemetry.ts:33-43` (identity and ledger) lazy-`require()`s the OTel SDK, which is native under CJS.
- **Proto import specifier** → use the extensionless form, as `services/xstockstrat-identity/src/index.ts:6` (`@xstockstrat/proto/identity/v1/identity`), `services/xstockstrat-ledger/src/grpc/serviceDefinition.ts:1` (`@xstockstrat/proto/ledger/v1/ledger`) and `notifyServiceImpl.test.ts:22` already do.
  - This is the fix for the second silent skips at `identityServiceImpl.test.ts:229` and `ledgerServiceImpl.test.ts:731`.
  - The exports map is `"./*": "./dist/*.js"` (`packages/proto/gen/ts/package.json:5-7`).
- **Coverage enforcement** → c8's own `--check-coverage` flag. It defaults to `false` (`node_modules/.pnpm/c8@10.1.3/node_modules/c8/lib/parse-args.js:85-86`), and the threshold check runs only when it is set (`.../c8/lib/commands/report.js:43`). Nothing in the repo uses it today (see Risks 1).
- **Vacuous-suite discriminator** → a mutation-under-compiled-run check (product-spec Reproduction step 3). The tell from `docs/roadmap/ledger/fails.md:2226` is that the pass count stays the same with and without the impl. AC-1 and AC-2 already encode it as mutation Thens.
- **Test-data home (C-13)** → none needed. Neither service has a `src/__tests__/fixtures/`, every inline mock has a single consumer, and the fix adds no new domain data.
- **Doc convention** → if identity and ledger `CLAUDE.md` get a runner note, mirror `services/xstockstrat-notify/CLAUDE.md:57-58` rather than writing new prose. Whether that note is needed at all is a design decision (C-18 YAGNI).

## Existing Business Rules (preserve / extend)

All relevant guarantees are **PRESERVE**. There is no EXTEND and no CHANGE, because this feature changes test tooling only and no runtime behavior.

These rules matter because the impl tests asserting them execute for the first time after this fix. A real failure must be fixed or recorded, never skipped or weakened (FR-5, C-16, operator decision 2026-10-20). Weakening any of these tests would be a silent C-16 regression.

- **PRESERVE** `@AC-1 @FR-1 @feature-043` "Admin lists all users" (`services/xstockstrat-identity/acceptance/user-management-ui.feature`) — ListUsers returns password-free views; the `listUsers` impl test becomes live, so a real failure must be fixed, never skipped.
- **PRESERVE** `@AC-2 @FR-2 @feature-043` "Admin creates a new user who can then sign in" (`services/xstockstrat-identity/acceptance/user-management-ui.feature`) — CreateUser hashes the password and returns a password-free view; the `createUser` impl test becomes live.
- **PRESERVE** `@AC-3 @FR-3 @feature-043` "Admin resets a user's password without the current password" (`services/xstockstrat-identity/acceptance/user-management-ui.feature`) — UpdatePassword updates the hash, revokes refresh tokens and returns an empty body; the `updatePassword` impl test becomes live.
- **PRESERVE** `@AC-4 @FR-4 @feature-043` "Admin assigns and removes roles" (`services/xstockstrat-identity/acceptance/user-management-ui.feature`) — SetUserRoles Role-enum mapping; the `setUserRoles` impl test becomes live.
- **PRESERVE** `@AC-5 @FR-5 @feature-043` "Admin deactivates a user, blocking login" (`services/xstockstrat-identity/acceptance/user-management-ui.feature`) — SetUserActive(false) flips `is_active` and revokes tokens; the `setUserActive` impl test becomes live.
- **PRESERVE** `@AC-6 @FR-6 @feature-043` "Admin reactivates a previously deactivated user" (`services/xstockstrat-identity/acceptance/user-management-ui.feature`) — SetUserActive(true) does not revoke tokens; same test group.
- **PRESERVE** `@AC-7 @FR-7 @feature-043` "A non-admin caller is denied every user-management RPC" (`services/xstockstrat-identity/acceptance/user-management-ui.feature`) — admin gate returns PERMISSION_DENIED and runs no query; the `admin gate (AC-7)` impl tests become live.
- **PRESERVE** `@AC-8 @FR-8 @feature-043` "Every user-management action writes a ledger audit event" (`services/xstockstrat-identity/acceptance/user-management-ui.feature`) — audit events are secret-free and best-effort; the `ledger audit emits` impl tests become live.
- **PRESERVE** `@AC-10 @FR-10 @feature-043` "Passwords are never returned or displayed" (`services/xstockstrat-identity/acceptance/user-management-ui.feature`) — no password or hash in any payload; asserted across the create, list and update impl tests.
- **PRESERVE** `@AC-11 @FR-11 @feature-043` "The last active admin cannot be deactivated or demoted" (`services/xstockstrat-identity/acceptance/user-management-ui.feature`) — FAILED_PRECONDITION "cannot remove last admin"; the `last-admin guard` impl tests become live.
- **PRESERVE** `@AC-10 @FR-10 @feature-183` "Admin profile RPCs enforce admin gating at the identity service, not only in the agent" (`services/xstockstrat-identity/acceptance/mcp-user-profile-roles.feature`) — `admin metadata gate (AC-10)` impl tests become live.
- **PRESERVE** `@AC-3 @FR-3 @feature-021` "event_type filter restricts the export to the listed types" (`services/xstockstrat-ledger/acceptance/ledger-event-export.feature`) — `exportEvents` AC-3 impl test becomes live.
- **PRESERVE** `@AC-4 @FR-3 @feature-021` "Omitting event_type returns all five event types" (`services/xstockstrat-ledger/acceptance/ledger-event-export.feature`) — `exportEvents` AC-4 impl test becomes live.
- **PRESERVE** `@AC-5 @FR-4 @feature-021` "A window wider than the configured maximum is rejected" (`services/xstockstrat-ledger/acceptance/ledger-event-export.feature`) — INVALID_ARGUMENT with the exact message; `exportEvents` AC-5 impl test becomes live.
- **PRESERVE** `@AC-8 @FR-7 @feature-021` "Each exported row carries the required fields" (`services/xstockstrat-ledger/acceptance/ledger-event-export.feature`) — wire shape including `userId` and `payload`; `exportEvents` AC-8 impl test becomes live.
- **PRESERVE** `@AC-10 @FR-9 @feature-021` "Export is disabled when the feature flag is off" (`services/xstockstrat-ledger/acceptance/ledger-event-export.feature`) — FAILED_PRECONDITION; `exportEvents` AC-10 impl test becomes live.
- **PRESERVE** `@AC-11 @FR-10 @feature-021` "The export returns only the authenticated user's own events" (`services/xstockstrat-ledger/acceptance/ledger-event-export.feature`) — per-user scoping; `exportEvents` AC-11 impl test becomes live.
- **PRESERVE** `@AC-1 @FR-1 @FR-2 @feature-021` "Date-range export streams every event as NDJSON in global-sequence order" (`docs/sdd/business-rules/platform.feature`) — the ledger-side ASC ordering is asserted in the ledger `exportEvents` impl test.
- **PRESERVE** `@AC-7 @FR-6 @feature-021` "A one-million-row export streams without buffering the full result set" (`docs/sdd/business-rules/platform.feature`) — batched writes via a dedicated client; the ledger `exportEvents` AC-7 impl test becomes live.
- **PRESERVE** `@AC-1 @FR-1 @regression @feature-171` "A telemetry module's built Resource no longer carries the trading_mode attribute" (`docs/sdd/business-rules/platform.feature`) — `telemetry.test.ts` in identity and ledger must keep asserting it through the `.ts` import rewrite.
- **PRESERVE** `@AC-1 @FR-1 @feature-210` "A plaintext gRPC caller is refused in production configuration" (`docs/sdd/business-rules/platform.feature`) — `mtls.test.ts` (both services) must keep asserting it through the import rewrite.
- **PRESERVE** `@AC-2 @FR-1 @FR-2 @feature-210` "A mutually-authenticated peer with a valid platform-issued identity is accepted" (`docs/sdd/business-rules/platform.feature`) — `mtls.test.ts` (both services), same constraint.
- **PRESERVE** `@AC-4 @FR-4 @feature-210` "mTLS is enforced identically in every environment; verification cannot be disabled" (`docs/sdd/business-rules/platform.feature`) — `mtls.test.ts` (both services), same constraint.
- **PRESERVE** `@AC-5 @FR-5 @feature-210` "Header-propagation semantics are unchanged beneath mTLS" (`docs/sdd/business-rules/platform.feature`) — `mtls.test.ts` (both services), same constraint.
- **PRESERVE** `@AC-6 @FR-6 @FR-3 @feature-210` "A long-lived streaming RPC survives a certificate rotation" (`docs/sdd/business-rules/platform.feature`) — ledger `mtls.test.ts` `@AC-6` (rotated leaf accepted without a restart) must keep asserting it.
- **PRESERVE** `@AC-1 @FR-1 @regression @feature-226` "A backend service exports traces over OTLP/HTTP to a path-prefixed gateway URL" (`docs/sdd/business-rules/platform.feature`) — `telemetry.export.test.ts` (both services) must keep asserting it through the import rewrite.
- **PRESERVE** `@AC-3 @FR-3 @regression @feature-226` "A failed trace export is visible in service logs" (`docs/sdd/business-rules/platform.feature`) — `logs a rejected export` in `telemetry.export.test.ts` (both services), same constraint.
- **PRESERVE** `@AC-2 @FR-2 @regression @item-6 @feature-175` "The confirmed-dead propagation middleware is gone from the Node leaf services" (`docs/sdd/business-rules/platform.feature`) — ledger and identity must still build (tsc) and pass their tests under the new runner.
- **PRESERVE** `@AC-3 @FR-3 @regression @item-7 @feature-175` "The Node leaf type surface matches the Node 24 runtime" (`docs/sdd/business-rules/platform.feature`) — keep `@types/node` ^24 (identity and ledger `package.json:38`) and the `tsc` build typecheck when adding a test-build tsconfig or loader devDependency.

**Out of scope / not impacted**
- `@AC-10 @FR-6 @feature-163` (`services/xstockstrat-ledger/acceptance/snapshot-offline-positions.feature`): the ledger impl tests do not assert the snapshot caller's `account.positions.baseline_set` event.
- The following platform rules are BFF-level, init-path or compose behaviour that these suites do not assert:
  - feature 021 `@AC-2` (CSV).
  - feature 171 `@AC-2` (telemetry init).
  - feature 226 `@AC-4` (compose).
- All other platform scenarios share no RPC, table, config key or surface with this fix.

**Notes**
- **Coverage gaps.** No durable `@AC` guards the behaviours that this feature's own AC-1 and AC-2 mutations target:
  - `refreshOAuthToken` rotation, `appendEvent` idempotent dedup and `EventNotifier` fan-out.
  - The seed-admin lockout, the authz helpers and the append-only/global-sequence invariants.
  - These live only in the service `CLAUDE.md` and `context-constitution.md` files. They enter the durable suites only through launch-time promotion of this feature's `acceptance.feature` (C-16).
- **`@AC-n` numbers are not unique within a suite.** For example, identity `@AC-10` appears under both `@feature-043` and `@feature-183`. Some unit-test titles also cite feature 183 numbering (`adminGetUserMetadata (AC-7)`). Match tests to scenarios by `@feature-*` tag, not by number.
- **Login clauses are not unit-covered.** The end-to-end login clauses of feature 043 `@AC-2/3/5/6` have no unit test, so this fix does not affect them.
- **Method.** Tests were mapped to scenarios by describe/it titles and test tags, not by reading every test body.
- **Scan size.** 71 scenarios scanned (11 identity, 7 ledger, 53 platform), 29 relevant. Scenario counts were confirmed by grep.

## Dependencies

- **Proto/RPC:** no change. There is a build-time dependency: the tests load modules that import the built proto `dist` (`identity/src/services/configWatcher.ts:7-8`), and CI builds it first at `ci.yml:579-580`.
- **Migration:** none. If one were ever needed, the next numbers would be identity `007` and ledger `004`.
- **Config keys:** none. The impl reads existing keys (`identity.jwt.*`, `ledger.export.*`) through test stubs, never through a live `ConfigWatcher`.
- **Inter-service edges:** none.
- **New env vars / ports:** none. The tests set `JWT_SECRET` in-process (`identityServiceImpl.test.ts:404`), and `mtls.test.ts` mints its PKI in a temp dir via `openssl` (`:8`, `:20`, then `mkdtempSync` at identity `:42` / ledger `:44`).
- **Toolchain** (root `pnpm-lock.yaml`; identity importer `:128`, ledger importer `:222`):
  - Installed: typescript 5.9.3 (`^5.4.5`), c8 10.1.3, ts-node 10.9.2.
  - No `tsx` or `@swc-node` is installed.
  - A loader route would add a devDependency and change the root lock. The Dockerfiles install with `--frozen-lockfile` while CI installs with `--no-frozen-lockfile` (`ci.yml:577`), so a stale lock fails the image build but not CI.

## Risks / Not-found

1. **c8 `--lines 40` is unenforced everywhere.**
   - `check-coverage` defaults to off (`c8/lib/parse-args.js:85-86`; `report.js:43`).
   - No service script passes `--check-coverage`, and there is no `.c8rc*`, `.nycrc*` or `package.json` `"c8"` block in identity, ledger, config or notify (Glob and grep: none).
   - This is why `fails.md:1948` says a zero-file run exits 0.
   - As a result, FR-4 / AC-4's "the 40 percent threshold still passes" holds vacuously today. The design must decide whether to add `--check-coverage` to identity and ledger.
   - Config and notify have the same gap. Product-spec Out of Scope says "changing config or notify test setups" is excluded, so the design must state whether that exclusion covers this flag.
2. **A second silent skip survives a runner-only fix**, in both `identityServiceImpl.test.ts:227-232` and `ledgerServiceImpl.test.ts:729-734`.
   - The `…/v1/identity.js` and `…/v1/ledger.js` specifiers resolve through the exports map to `dist/<pkg>/v1/<name>.js.js`, which does not exist.
   - Only `identity.js` and `ledger.js` exist in `packages/proto/gen/ts/dist/`.
   - This is inferred from the exports map and was not executed. Unless the specifier and the `catch { return; }` are both fixed, those two tests stay vacuous, against FR-3 and FR-5.
3. **Some non-impl test syntax cannot survive `tsc` under `module: commonjs`.**
   - The `.ts`-suffixed imports fail with TS5097. That is the original reason tests are excluded from tsconfig (`fails.md:2238-2241`, feature 171/175).
   - `import.meta.url` at `telemetry.export.test.ts:8` is invalid in CJS.
   - Removing the exclusion re-exposes the production `pnpm build` to test sources. Verify both `pnpm build` and `test:coverage` per service, as the platform feature-175 `@AC-2`/`@AC-3` rules require.
4. **Compiled tests ship in the image** (`Dockerfile:24,27` in both services), as config's already do. No root `.dockerignore` was found. The alternative is a test-only tsconfig, but none exists in any Node service (not found).
5. **The `mtls.test.ts` result is unverified.**
   - It was the single failure in each service under the triage session's ad-hoc compile (identity 66/67, ledger 36/37; `context.md` /sdd-triage entry).
   - Config's same-shape test runs compile-first, but the ledger copy adds an `@AC-6` rotated-leaf case that config lacks.
   - The real compile-then-test result has not been observed here.
6. **Hang risk** (`fails.md:115`, feature 074: a compiled run exposed a live `ConfigWatcher` dial hang).
   - No test constructs a live `ConfigWatcher` (grep: none).
   - `EventNotifier` schedules a reconnect `setTimeout` at `eventNotifier.ts:113` that could hold the event loop open if a test triggers a disconnect without closing the notifier. This is not verified.
7. **Expect latent failures** (`insights.md:1149-1152`).
   - FR-5 vs AC-5 tension (`context.md`, sdd-review entry): FR-5 allows a real failure to be "recorded in context.md", but AC-5 requires `# fail 0`.
   - The operator decision of 2026-10-20 forbids delete, skip or weaken. The design must say how a recorded-but-unfixed failure lands: fix it in this feature, or stop and ask.
8. **Type errors are possible if subjects get typed.**
   - `{}` passed as `ConfigWatcher` and object-literal pools do not structurally match `Pool`, even with `strict: false`.
   - The `protected` override at `:586` also needs an untyped subject.
   - These failures are inferred, not compiled.
9. **AC-3 mechanism evidence.**
   - A static import of a missing module fails `tsc`, and so `tsc && …`, before any test runs. tsconfig has no `noEmitOnError`, but `tsc` still exits non-zero.
   - For a bare dynamic `import()` in `before()`, it is not verified whether `tsc` flags the unresolved literal or the failure only surfaces at runtime as a failed hook.
   - Either path satisfies AC-3's Thens, but the RED evidence must be captured, not assumed.
10. **Node version split.** `.nvmrc` is 22 and CI is 24 (`fails.md:2223-2226`). Strip-types behaviour differs by Node version; a compile-first runner removes that dependence.
11. **Overlaps.**
    - **Hotfix #1262** (`origin/hotfix/fix-refresh-token-rotation`) touches `identityServiceImpl.test.ts` (+82 lines) and `identityServiceImpl.ts`. It adds 2 more `if (!impl) return;` guards in `${method} rotation is single-use`. Whichever lands second must also remove those and merge the other's test changes (operator decision).
    - **Feature 248** (status `draft`): its branch currently touches only the two `docs/context-constitution-findings.md` files under `services/`. If its regression test lands in `ledgerServiceImpl.test.ts` or `eventNotifier.test.ts`, it becomes a hard failure once this fix lands.
    - **Feature 241** has no overlap (`context.md` correction).
12. **Teardown targets** (stale once the runner changes; root `CLAUDE.md` § Teardown, `fails.md:671-674`):
    - `docs/patterns/ci-overview.md:56`, which says c8's `0%` is a "known TypeScript tooling artefact".
    - `.claude/skills/sdd-qa/reference/lang-node.md:11-32`. It is already wrong at `:13-17`, where it lists notify as strip-types.
    - The defect rows in `services/xstockstrat-identity/docs/context-constitution-findings.md:57` and `services/xstockstrat-ledger/docs/context-constitution-findings.md:50`.
    - The test header comments: `identityServiceImpl.test.ts:7-11`, `ledgerServiceImpl.test.ts:1-10`, and `telemetry.export.test.ts:7,31` (both services).
13. **Not found / unverified** (read-only recon; nothing executed):
    - No compiled `dist/` exists in identity or ledger locally.
    - No `tsconfig.test.json` exists in any Node service.
    - No ledger `coverage/lcov.info` baseline exists.
    - Not checked: whether the per-service `pnpm-lock.yaml` files are git-tracked. The Dockerfiles use the root lock.
    - Not observed:
      - the compiled pass/fail counts;
      - the c8 row names (`dist/…` vs `src/…`; there is no `sourceMap` in any tsconfig);
      - whether c8's default `**/__tests__/**` exclude (`@istanbuljs/schema` default-exclude) keeps test files out of the table.

## Recommended Scope

These step boundaries are advisory input to the grilling round and `/sdd-spec`, not binding.

**Design forks to settle first:**
- **(a) Runner.** The options are:
  - compile-then-test, which reuses config/notify and needs no new dependency;
  - a `tsx` loader, which adds a devDependency and changes the root lock;
  - `--experimental-transform-types`, which needs `.ts` extension rewrites in the impl and so touches runtime files.
- **(b) Test compilation.** Either drop the tsconfig `:19-23` test exclusion (the config precedent, but tests then ship in the image) or add a test-only tsconfig (new to the repo).
- **(c) Hard-fail form.** Either a static import or a bare dynamic import, in both cases plus a harness assertion.
- **(d) Enforcement.** Whether to add `--check-coverage` (Risk 1).
- **(e) Landing a real failure.** How a real failure surfaced under FR-5 lands (Risk 7).

**Steps:**
1. **identity runner.**
   - Change `package.json:12-13` and the tsconfig/test-build per fork (b).
   - Rewrite the non-impl imports: `mtls.test.ts:13`, `telemetry.test.ts:3`, `telemetry.export.test.ts:5,7-9`.
   - Verification: `pnpm build` and `pnpm run test:coverage` both pass, and `lcov.info` gains `identityServiceImpl` and `authz` rows.
2. **identity impl-test hardening.**
   - Make the import hard-fail (`:28-40`) and add a harness test.
   - Remove the 65 guards, fix the proto specifier at `:229` and drop its catch, and rewrite the header at `:7-11`.
   - RED evidence: the AC-1 mutation at `identityServiceImpl.ts:524-527`, the AC-3 bogus import, and the AC-4 rows.
3. **ledger runner.** The same as step 1, applied to `package.json:13-14`, the tsconfig, and the three non-impl test files.
4. **ledger impl-test hardening.**
   - `ledgerServiceImpl.test.ts:21-29`, its 31 guards, and the proto skip at `:729-734`.
   - `eventNotifier.test.ts:16-23` and its 7 guards.
   - The file headers.
   - RED evidence: the AC-2 mutations at `ledgerServiceImpl.ts:84-105` and `eventNotifier.ts:132`, AC-3, and AC-4.
5. **Fix or record the latent failures** that steps 1-4 surface. This is a pre-existing defect per the operator decision, and it is never skipped. It may fold into steps 2 and 4.
6. **Coverage-gate flag**, if fork (d) chooses to add it.
7. **Docs teardown** for the Risk 12 targets, plus the `/context-constitution refresh` audit.
