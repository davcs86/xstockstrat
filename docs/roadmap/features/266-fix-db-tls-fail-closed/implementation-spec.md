# Implementation Spec: fix-db-tls-fail-closed

**Status**: `pending`
**Created**: 2026-10-22
**Feature**: `docs/roadmap/features/266-fix-db-tls-fail-closed/feature.md`
**Total Steps**: 17
**Feature Branch**: `feature/fix-db-tls-fail-closed`

---

## Execution Summary

The work follows `design.md` § Chosen Approach (items 1–9). Step 1 adds the fail-closed resolver
`resolveDbConnection` as five byte-identical, zero-import `dbTls.ts` files. Step 2 adds the shared resolver test
table. Step 3 lands the CI and dependency plumbing the platform guard needs: the `.do/**` filter and the `yaml`
devDependency. Steps 4–11 wire the four backends one service at a time. Each wiring step puts the resolver before
anything else in `main()`, and each pairs with a boot child-process test plus a TLS-stub test. Steps 12–13 move the
config-ui audit route onto the resolver. Steps 14–15 add the missing UI `DATABASE_CA_CERT` binding to both `.do`
specs and the platform guard vitest, which covers the AC-5 YAML parse, the SHA-256 copy guard and the static wiring
check. Steps 16–17 cover docs, the DRY exception, the rollout canary and the context teardown.

No proto, no migration, no config key. `DATABASE_CA_CERT` stays a boot-time env var (F-07).

**Consumer surface (C-14):** the product spec names the UI `/config-ui` audit view. Steps 12–13 change its API
route, `/config-ui/api/audit`, which the existing page consumes. There is no new page, route, field or nav entry,
so C-10(a) does not apply. Agent: not affected (product spec § Consumer Surface(s)).

### P-03 gate result — pg merge precedence (read from source, pg@8.20.0 / pg-connection-string@2.12.0 per `pnpm-lock.yaml:5294,5318`)

- In `pg/lib/connection-parameters.js:59-60`, the fields parsed from the URL **override** the explicit config:
  `config = Object.assign({}, config, parse(config.connectionString))`.
- In `pg-connection-string/index.js:77-78`, any of `sslcert`, `sslkey`, `sslrootcert` or `sslmode` in the URL
  replaces `ssl` with `{}`.
  - `:73-74`: `ssl=0` → `false`.
  - `:145-148`: `sslmode=no-verify` → `rejectUnauthorized = false`.
  - `:100-125`: `uselibpqcompat=true` switches to libpq semantics, where `require` means no verification.
- `:39-41`: the loop copies **every** search-param entry, so the **last** duplicate key wins.
- Conclusion: an explicit `ssl: { rejectUnauthorized: true, ca }` survives **only if no `ssl*` or `uselibpqcompat`
  key remains in the URL**. This confirms design rules (c)+(e).
- It also exposes one gap the design did not name: `?sslmode=disable&sslmode=no-verify`. The resolver's
  `get('sslmode')` reads the first value, `disable`, but pg applies the last value, `no-verify`. That would give an
  unverified TLS connection while the resolver reports `ssl: false`.
- Step 1 therefore throws on a repeated `sslmode`. This adds fail-closed strictness within the approved rule
  set and changes none of the rules (fails.md 2026-08-06 "categorical inputs fail closed").

### Spec-time decisions (recorded in `context.md`)

- **mTLS/DB check order (design item 2, the choice left to the spec):** **record the reorder as deliberate**.
  - The resolver call is the first statement of `main()` in all four backends. In ledger, identity and notify it
    runs before `new ConfigWatcher(...)`, whose constructor throws for `MTLS_*` (`configWatcher.ts:33`/`:33`/`:35`).
  - When both env sets are missing, the operator sees the `DATABASE_CA_CERT` error first, then the `MTLS_*` error on
    the next boot. Both gates stay fail-closed, so `@AC-4 @feature-210` holds.
  - No combined error, because YAGNI (C-18) applies: a combined error would add cross-module coupling for a
    one-boot ergonomics gain.
- **Boot-test entry (design item 4, corrected with evidence):** all four boot tests spawn `node dist/index.js`, the
  production `CMD` (`services/xstockstrat-{ledger,identity,notify}/Dockerfile:38/45/38`, config `:34`).
  - Ledger and identity build first with `pnpm run build` (`tsc`; their `tsconfig.json` excludes tests).
  - The design's `--experimental-strip-types src/index.ts` cannot load `src/index.ts`. Its extensionless relative
    imports (`import { initTelemetry } from './telemetry'`, ledger `index.ts:1`) fail ESM resolution under
    strip-types.
  - This was verified locally on a two-file `a.ts → './b'` reproduction (`ERR_MODULE_NOT_FOUND`). It is also the
    fails.md:2238-2240 dual-runner trap.
- **Resolver output name:** every call site binds `const dbConn = resolveDbConnection(...)` and passes
  `connectionString: dbConn.connectionString, ssl: dbConn.ssl`. Step 15's wiring guard keys on this name.

## Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` backend refuses to boot without CA | Steps 5, 7, 9, 11 (child-process boot test, one per backend) |
| `@AC-2` backend rejects a wrong-CA cert | Step 7 (config, end to end through `main()`); Steps 5, 9, 11 (Pool-level TLS stub + positive control); Step 15 (static wiring guard). Narrowed for ledger, identity and notify → Deviation Log |
| `@AC-3` `sslmode=disable` boots without a CA | Step 2 (resolver `disable` row); Step 7 (config `main()` sends a plaintext StartupMessage to the stub, no SSLRequest; "serves gRPC" not asserted → Deviation Log) |
| `@AC-4` audit route never queries over unverified TLS | Step 13 |
| `@AC-5` every direct-DB component binds `DATABASE_CA_CERT` | Step 15 (YAML parse of both specs, plus a negative row) |
| `@AC-6` URL with no `sslmode` still requires a CA | Step 2 (resolver row); Step 5 (ledger boot test) |
| `@AC-7` audit route rejects a cert from an unconfigured CA | Step 13 (mocked `pg` → Deviation Log) |
| `@AC-8` audit route with `sslmode=disable` reads without a CA | Step 2 (resolver row); Step 13 |

## Step Dependencies

- Steps 4, 6, 8, 10, 12 require Step 1, because they import `resolveDbConnection`.
- Step 2 [test] covers Step 1 [service].
- Step 15 requires Step 3: the `yaml` devDependency must exist so the RED run fails on the missing binding, not on
  a missing module. Step 15 also requires Steps 4–13, because the wiring and hash guard asserts the final state of
  all five call sites. **Step 15 executes before Step 14** (order 13 → 15 RED → 14 → 15 GREEN) so its AC-5 RED is
  genuine; Step 14 is complete only once Step 15 re-runs GREEN (C-08/P-06).
- Each wiring step pairs with the test step after it: Step 5 [test] covers Step 4, Step 7 covers Step 6, Step 9
  covers Step 8, Step 11 covers Step 10, Step 13 covers Step 12. Step 15 [test] covers Step 14 (and re-asserts
  Steps 1/4/6/8/10/12 wiring).
- **Deploy ordering (recon.md:94, design item 8):** Step 14 (UI `.do` binding) and Step 12 (route) ship in the
  **same** integration PR. Neither may be cherry-picked to `main-dev` alone.
- The **pre-merge dev canary** (Step 17) must pass before the integration PR merges. It proves on running dev
  backends that `${xstockstrat.CA_CERT}` is non-empty and verifies, and that `${xstockstrat.DATABASE_URL}` carries
  only `sslmode=require`.
- **Operator sign-off gate (design Open Risk):** before Step 8 / Step 10 execute, the operator must sign off in
  `context.md` on identity and notify crash-looping when the DB is down (the new boot `SELECT 1`). The sign-off
  covers only FR-2's exit-at-boot clause. If it is refused, drop the probe from Steps 8/10 and log a Deviation for
  that clause only. The AC-2 Pool-level tests stay.
- **P-06 / feature 252:** the new ledger and identity test files import only `../dbTls.ts` plus node built-ins and
  `pg`, with no `before()` skip-guard. Their verification must show the new test names executing (`--test-reporter=spec`),
  independent of 252's repair of the older suites.
- **Merge order:** rebase onto 242 (notify `index.ts`, both `.do` specs) and 248 (ledger `index.ts`, `ci.yml`) if
  they merge first. Watch the `ci.yml` filter block for peer-feature conflicts (248, 250). The earlier 241 entry is
  dropped: 241's implementation-spec modifies `configUiBff.ts`/`insightsBff.ts` and only cites `route.ts` in
  recon (`241-.../recon.md:94`), so it does not touch the audit route. Also watch 252 on ledger/identity
  `package.json` test globs (Steps 5/9).

---

### Step 1 — service: Add the fail-closed resolver `dbTls.ts` (five byte-identical copies)

**Status**: `done`
**Service**: `xstockstrat-ledger`, `xstockstrat-config`, `xstockstrat-identity`, `xstockstrat-notify`, `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ledger/src/dbTls.ts` — create
- `services/xstockstrat-config/src/dbTls.ts` — create
- `services/xstockstrat-identity/src/dbTls.ts` — create
- `services/xstockstrat-notify/src/dbTls.ts` — create
- `services/xstockstrat-ui/src/lib/dbTls.ts` — create

**Reviewers**: `xstockstrat-ledger` owner — event ordering / append-only path unaffected; `xstockstrat-config` owner — secret-bearing DB channel; `xstockstrat-identity` owner — secret store integration; `xstockstrat-notify` owner — boot behaviour; `xstockstrat-ui` owner — no direct DB access (except audit log); Security — fail-closed TLS verification

**Codebase Evidence**:
- No shared helper exists. All five sites inline `includes('sslmode=disable')` plus `searchParams.delete('sslmode')`:
  - ledger `src/index.ts:27,32`;
  - config `src/index.ts:25,30`;
  - identity `src/index.ts:24,29`;
  - notify `src/index.ts:26,31`;
  - UI `src/app/config-ui/api/audit/route.ts:13,17`.
  - Confirmed by `grep -rn "rejectUnauthorized\|includes('sslmode" services/xstockstrat-{ledger,config,identity,notify,ui}/src`, which matches only those files.
- Per-service fail-closed module precedent: `services/xstockstrat-config/src/mtls.ts:15-17` throws
  `'mtls: MTLS_CERT, MTLS_KEY and MTLS_CA_CERT must all be set (fail-closed)'`.
- Runtime regimes the copy must satisfy (re-spec 2026-10-29, after feature 252):
  - All four backends now build and test tsc-first under CJS: `test` is `tsc && node --test dist/__tests__/*.test.js`
    and `test:coverage` is `tsc && c8 ... --lines 40 node --test dist/__tests__/*.test.js` (ledger
    `package.json:13-14`, identity `:12-13`, config `:12-13`, notify `:12-13`); each `tsconfig.json` sets
    `"module": "commonjs"` and includes `src/**/*`. Ledger and identity no longer use strip-types, so the
    erasable-syntax rule below is harmless rather than required.
  - UI uses the Next bundler plus vitest (`services/xstockstrat-ui/vitest.config.ts:20`).
- pg precedence: see § P-03 gate result (`pg/lib/connection-parameters.js:59-60`; `pg-connection-string/index.js:39-41,73-78,100-148`).

**TDD**: `red-green required` (paired with Step 2)

**Covers**: —

**Instructions**:
1. Create `services/xstockstrat-ledger/src/dbTls.ts` with exactly this content. It has zero imports and erasable
   syntax only: no enums, no parameter properties, no namespaces.
   ```ts
   // Fail-closed DB TLS resolver (feature 266). Byte-identical in five services and hash-guarded by
   // services/xstockstrat-ui/src/lib/dbTlsPlatformGuard.test.ts; edit all five copies together.
   export type DbSsl = false | { rejectUnauthorized: true; ca: string };

   export function resolveDbConnection(
     databaseUrl: string | undefined,
     caCert: string | undefined,
   ): { connectionString: string; ssl: DbSsl } {
     let url: URL;
     try {
       url = new URL(databaseUrl ?? '');
     } catch {
       throw new Error('db-tls: DATABASE_URL is unset or invalid');
     }
     const modes = url.searchParams.getAll('sslmode');
     if (modes.length > 1) {
       throw new Error('db-tls: DATABASE_URL sets sslmode more than once');
     }
     for (const key of url.searchParams.keys()) {
       const k = key.toLowerCase();
       if ((k.startsWith('ssl') && key !== 'sslmode') || k === 'uselibpqcompat') {
         throw new Error(`db-tls: DATABASE_URL parameter "${key}" is not allowed; TLS is configured by DATABASE_CA_CERT`);
       }
     }
     if (modes[0] === 'disable') {
       return { connectionString: databaseUrl as string, ssl: false };
     }
     if (!caCert) {
       throw new Error(
         'db-tls: DATABASE_CA_CERT is required for a TLS database connection (fail-closed); set it or use sslmode=disable',
       );
     }
     url.searchParams.delete('sslmode');
     return { connectionString: url.toString(), ssl: { rejectUnauthorized: true, ca: caCert } };
   }
   ```
2. Copy that file byte-for-byte to the other four paths in **Files**, for example with `cp`. Do not reformat a copy:
   the lint-staged prettier pass must leave every copy identical, and the Verification below checks this.
3. The error messages never include the URL or any parameter value. They name only the key or the env var.
   The `ssl*`/`uselibpqcompat` key scan runs **before** the `sslmode=disable` early return (impl-spec review,
   2026-10-22), so `?sslmode=disable&ssl=...` is refused without relying on pg's intra-parse key precedence.
   Local compose sets only `?sslmode=disable` (`docker-compose.yml:27`), so this is unaffected.
4. Do not wire any call site in this step. Steps 4/6/8/10/12 do that.

**Verification**:
```bash
sha256sum services/xstockstrat-{ledger,config,identity,notify}/src/dbTls.ts services/xstockstrat-ui/src/lib/dbTls.ts | awk '{print $1}' | sort -u | wc -l   # → 1
grep -c "^import" services/xstockstrat-ledger/src/dbTls.ts   # → 0
for s in ledger config identity notify; do (cd services/xstockstrat-$s && pnpm run build && pnpm run lint) || exit 1; done
(cd services/xstockstrat-ui && pnpm exec tsc --noEmit && pnpm run lint)
```

---

### Step 2 — test: Resolver test table (`dbTls.test.ts`, five copies)

**Status**: `done`
**Service**: `xstockstrat-ledger`, `xstockstrat-config`, `xstockstrat-identity`, `xstockstrat-notify`, `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ledger/src/__tests__/dbTls.test.ts` — create
- `services/xstockstrat-config/src/__tests__/dbTls.test.ts` — create
- `services/xstockstrat-identity/src/__tests__/dbTls.test.ts` — create
- `services/xstockstrat-notify/src/__tests__/dbTls.test.ts` — create
- `services/xstockstrat-ui/src/lib/dbTls.test.ts` — create

**Reviewers**: service owners of the five services (as Step 1); Security — fail-closed TLS verification

**Codebase Evidence**:
- Node test style is `import { describe, it } from 'node:test'` plus `import assert from 'node:assert/strict'`
  (`services/xstockstrat-identity/src/__tests__/mtls.test.ts:6-7`).
- The import specifier is extensionless in all four backends (re-spec 2026-10-29, after feature 252):
  `import * as mtls from '../mtls'` (ledger `src/__tests__/mtls.test.ts:13`, identity `:15`, config `:12`, notify
  `:14`). Their `tsconfig.json` has no `allowImportingTsExtensions` and includes `src/**/*`, so tests are compiled
  by `tsc` and a `'../dbTls.ts'` specifier would fail with TS5097.
- UI vitest picks up `src/**/*.test.ts` and measures coverage over `src/lib/**` (`services/xstockstrat-ui/vitest.config.ts:20,25`).
- P-06: fails.md:2223-2225 records strip-types suites that skipped silently through a `before()` import guard. After
  252 the suites run tsc-first, so the risk is moot, but this file still adds no such guard.

**TDD**: `red-green required` — RED: the file fails to import `resolveDbConnection` before Step 1 lands; GREEN after.

**Covers**: `AC-3, AC-6, AC-8` (resolver level; boot and route levels are covered in Steps 5/7/13)

**Instructions**:
1. Write one test table and put the same rows in all five files. Only the import line and the test API differ:
   - ledger, identity, config and notify: `import { resolveDbConnection } from '../dbTls'`;
   - UI: `from './dbTls'`, using vitest `describe/it/expect`.
2. Use the placeholder `const CA = '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----'`. It is a
   single-consumer inline literal, so it is C-13 compliant. Use `const BASE = 'postgres://u:secretpw@db.example:25060/xstockstrat'`.
3. Rows:
   - `${BASE}?sslmode=require`, `BASE` with no `sslmode` (**@AC-6**), and `${BASE}?sslmode=verify-full`, each with
     `CA`:
     - returns `ssl` deep-equal to `{ rejectUnauthorized: true, ca: CA }`;
     - `new URL(result.connectionString).searchParams` has no key starting with `ssl` and no `uselibpqcompat`.
   - `BASE` with no `sslmode` and no CA: throws, and the message contains `DATABASE_CA_CERT`.
   - `${BASE}?sslmode=require` with CA `''`: throws, and the message contains `DATABASE_CA_CERT`.
   - `${BASE}?sslmode=disabled` with no CA: throws (exact match only).
   - `${BASE}?ssl=0`, `${BASE}?sslmode=require&sslrootcert=/x` and `${BASE}?uselibpqcompat=true&sslmode=require`,
     each with CA: each throws naming the key (`ssl`, `sslrootcert`, `uselibpqcompat`).
   - `${BASE}?sslmode=disable&sslmode=no-verify` with CA: throws (repeated `sslmode`, see § P-03).
   - `${BASE}?sslmode=disable&ssl=true` with no CA: throws naming `ssl` (the key scan precedes the `disable`
     carve-out).
   - `${BASE}?sslmode=disable` with no CA (**@AC-3/@AC-8**): returns `{ connectionString: input, ssl: false }`.
   - `''` and `'not a url secretpw'`: each throws `db-tls: DATABASE_URL is unset or invalid`, and the message does
     not contain `secretpw`.
4. Name each Node test so `--test-reporter=spec` lists it, for example `it('AC-6: missing sslmode requires a CA', ...)`.

**Verification**:
```bash
cd services/xstockstrat-ledger && pnpm run build && node --test --test-reporter=spec dist/__tests__/dbTls.test.js && pnpm run test:coverage && pnpm run lint
cd ../xstockstrat-identity && pnpm run build && node --test --test-reporter=spec dist/__tests__/dbTls.test.js && pnpm run test:coverage && pnpm run lint
cd ../xstockstrat-config && pnpm run build && node --test --test-reporter=spec dist/__tests__/dbTls.test.js && pnpm run test:coverage && pnpm run lint
cd ../xstockstrat-notify && pnpm run build && node --test --test-reporter=spec dist/__tests__/dbTls.test.js && pnpm run test:coverage && pnpm run lint
cd ../xstockstrat-ui && pnpm exec vitest run src/lib/dbTls.test.ts && pnpm run test:coverage && pnpm run lint
# coverage threshold: 40% in every service (c8 --lines 40 for the four backends; vitest src/lib 40% for UI)
# confirm the spec reporter lists every AC-tagged test name (non-zero assertion count; P-06)
```

---

### Step 3 — config: CI `.do/**` filter and UI `yaml` devDependency (no config key)

**Status**: `done`
**Service**: `xstockstrat-ui` (CI wiring + devDependency)
**Files**:
- `.github/workflows/ci.yml` — modify
- `services/xstockstrat-ui/package.json` — modify
- `pnpm-lock.yaml` — modify

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC / config mutation safety (CI gate scope); Security — guard must run on `.do`-only PRs

**Codebase Evidence**:
- `.github/workflows/ci.yml:63`: `xstockstrat-ui:         ['services/xstockstrat-ui/**']`. The filter block runs
  `:39-71` and has no `.do` entry. recon cited `:62`; the line has since drifted to `:63`.
- `node-test` runs the whole Node matrix, including `xstockstrat-ui`, when any of
  `xstockstrat-{config,ledger,identity,notify,ui}`, `proto`, `node-shared` or `ci` matches (job `ci.yml:547`,
  `if:` `:550-558`, matrix `:559-574`).
- `yaml` is absent from `services/xstockstrat-ui/package.json`. It is already in the lockfile as a transitive dep:
  `yaml@2.9.0` at `pnpm-lock.yaml:6372,12592`.

**TDD**: `N/A (CI filter + dependency manifest; no code)`

**Covers**: —

**Instructions**:
1. In `.github/workflows/ci.yml:63`, change the `xstockstrat-ui` filter to
   `xstockstrat-ui:         ['services/xstockstrat-ui/**', '.do/**']`. A `.do`-only PR then runs `node-test`,
   and with it the Step 15 guard.
   - Side effect: every other job gated on the `xstockstrat-ui` filter also runs on `.do`-only PRs. Accept this, as
     the design-gate r2 approval did, and do not add a new filter name.
2. From the repo root, run `pnpm --filter xstockstrat-ui add -D yaml@^2.9.0`, then commit `services/xstockstrat-ui/package.json`
   and `pnpm-lock.yaml` together.

**Verification**:
```bash
grep -n "xstockstrat-ui:.*'.do/\*\*'" .github/workflows/ci.yml
grep -n '"yaml"' services/xstockstrat-ui/package.json
pnpm install --frozen-lockfile
```

---

### Step 4 — service: Ledger — resolve first, wire Pool + EventNotifier

**Status**: `done`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/index.ts` — modify

**Reviewers**: `xstockstrat-ledger` owner — append-only invariant, event ordering (LISTEN/NOTIFY client boot); Security — fail-closed TLS verification

**Codebase Evidence**:
- `services/xstockstrat-ledger/src/index.ts` (re-spec 2026-10-29, after feature 248):
  - `import { makeListenerClient, makeResolveRow } from './services/eventRowResolver'` `:11`;
  - `configEndpoint` `:17`; `const databaseUrl = process.env.DATABASE_URL ?? ''` `:19`;
  - `new ConfigWatcher(configEndpoint, 'ledger')` `:23`, whose constructor calls `mtls.clientCredentials()` (`src/services/configWatcher.ts:33`);
  - `waitForSnapshot(90_000)` `:24`;
  - inline block `:27-40`: `sslDisabled` `:27`, `catch { /* keep original if URL parsing fails */ }` `:34`, `rejectUnauthorized: !!caCert` `:38`;
  - `new Pool({ connectionString: dbUrl, ..., ssl: sslOption })` `:41-47`;
  - `await pool.query('SELECT 1')` `:48`;
  - `new EventNotifier(makeListenerClient(dbUrl, sslOption, configWatcher), { resolveRow: makeResolveRow(configWatcher) })` `:53-55`;
  - `main().catch(... console.error('Fatal error:', err); process.exit(1))` `:89-92`.
- The listener factory takes TLS positionally: `makeListenerClient(connectionString, ssl: ClientConfig['ssl'], config)`
  returns `() => new Client({ connectionString, ssl, statement_timeout: ... })`
  (`src/services/eventRowResolver.ts:40-47`). No edit there.
- Third consumer: the export cursor `new Client({ connectionString: opts.connectionString, ssl: opts.ssl })` reads
  `(this.pool as any).options` (`src/grpc/ledgerServiceImpl.ts:355-356`), so it inherits whatever the Pool was given.
  No edit there.
- Logger: `const log = getLogger('ledger:server')` `:14`.

**TDD**: `red-green required` (paired with Step 5)

**Covers**: —

**Instructions**:
1. Add `import { resolveDbConnection } from './dbTls';` beside `import * as mtls from './mtls';` (`:5`). It stays
   extensionless, like the existing imports.
2. Make `const dbConn = resolveDbConnection(process.env.DATABASE_URL, process.env.DATABASE_CA_CERT);` the **first
   statement** of `main()`, before `configEndpoint` (`:17`) and before `new ConfigWatcher` (`:23`). Then, when
   `dbConn.ssl !== false`, log `log.info('db-tls: verifying server cert against DATABASE_CA_CERT')`. The line
   carries no value (canary, design item 8).
3. Delete `const databaseUrl` (`:19`) and the inline block `:27-40`.
4. Pool (`:41-47`): set `connectionString: dbConn.connectionString` and `ssl: dbConn.ssl`. Keep `max` and its comment.
5. EventNotifier (`:53`): change only the listener factory's arguments to
   `makeListenerClient(dbConn.connectionString, dbConn.ssl, configWatcher)`. Keep the `resolveRow` option.
6. Do not touch `ledgerServiceImpl.ts` or `eventRowResolver.ts`. The export cursor keeps inheriting through
   `pool.options`, and the listener factory passes `ssl` through unchanged.
7. Exit path: a resolver throw reaches the existing `main().catch` (`:89-92`), and `console.error` prints the message
   that names `DATABASE_CA_CERT` (FR-1). No new exit path.

**Verification**:
```bash
cd services/xstockstrat-ledger && pnpm run build && pnpm run lint
grep -n "rejectUnauthorized\|includes('sslmode" src/index.ts   # → no output
grep -c "ssl: dbConn.ssl" src/index.ts                          # → 1 (Pool)
grep -c "makeListenerClient(dbConn.connectionString, dbConn.ssl, configWatcher)" src/index.ts   # → 1 (EventNotifier)
```

---

### Step 5 — test: Ledger boot test + Pool-level TLS stub

**Status**: `done`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/__tests__/dbTlsBoot.test.ts` — create

**Reviewers**: `xstockstrat-ledger` owner — boot behaviour of query pool + LISTEN connection; Security — wrong-CA rejection

**Codebase Evidence**:
- Throwaway-CA fixture to mirror: `mintLeaf()` and `mintPki()` shell out to `openssl` in a `mkdtempSync` dir
  (`services/xstockstrat-ledger/src/__tests__/mtls.test.ts:35` and `:43`; identity's copy at
  `services/xstockstrat-identity/src/__tests__/mtls.test.ts:38` and `:46`).
- Production entry is `node dist/index.js` (`services/xstockstrat-ledger/Dockerfile:38`). `build` is `tsc`
  (`package.json:8`).
- Re-spec 2026-10-29 (after feature 252): `tsconfig.json` includes `src/**/*` and excludes only `node_modules` and
  `dist`, so tests compile to `dist/__tests__/`. Test glob: `tsc && node --test dist/__tests__/*.test.js`
  (`package.json:13-14`). `dist/index.js` therefore exists whenever the suite runs.

**TDD**: `red-green required` — RED before Step 4:
- the boot test's stderr lacks `DATABASE_CA_CERT`, because the old code reaches `ConfigWatcher` and throws `mtls: ...`
  or waits on config;
- the Pool-level test fails to compile on the missing `../dbTls` import before Step 1.

**Covers**: `AC-1, AC-6, AC-2` (AC-2 narrowed to Pool level + Step 15 wiring guard → Deviation Log)

**Instructions**:
1. **Boot test (AC-1, AC-6).**
   - No `pnpm run build` in `before()`: the `test`/`test:coverage` scripts run `tsc` first, and the Verification
     below builds explicitly. The tests run from the service dir.
   - Spawn `process.execPath` with `[join(process.cwd(), 'dist/index.js')]`. Give it an **explicit** env: `{ PATH: process.env.PATH }`
     plus `DATABASE_URL`. Do not inherit `DATABASE_CA_CERT` or `MTLS_*`.
   - Case AC-1: `DATABASE_URL=postgres://u:p@db.example:25060/xstockstrat?sslmode=require`.
   - Case AC-6: the same URL with no query string.
   - For each case, assert a non-zero exit code within 15 s, and that stderr contains `DATABASE_CA_CERT` and does
     **not** contain `mtls:`. The second check proves the resolver ran before `ConfigWatcher`.
2. **Pool-level TLS stub (AC-2).**
   - Mint two throwaway CAs, A and B, inline with the openssl helpers modelled on ledger `mtls.test.ts` (`mintLeaf`
     `:35`, `mintPki` `:43`). Mint a server leaf with `subjectAltName=DNS:localhost` signed by B. The helper has one
     consumer in this file, so it stays inline (C-13).
   - Stand up a `net.createServer` on `127.0.0.1:0`.
     - The first 8-byte packet must be the SSLRequest: `readInt32BE(4) === 80877103`.
     - Answer `'S'`, then upgrade with `new tls.TLSSocket(sock, { isServer: true, cert, key })`.
     - Record `secure` events, and close the socket once the first post-TLS packet arrives.
   - Build the client through the resolver:
     `const c = resolveDbConnection('postgres://u:p@localhost:<port>/x?sslmode=require', caA)`, then
     `new pg.Pool({ connectionString: c.connectionString, ssl: c.ssl, max: 1 })`.
   - Wrong CA: `await assert.rejects(pool.query('SELECT 1'), e => ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN'].includes(e.code))`.
   - Positive control: repeat with the CA set to B. The stub must record a completed `secure` handshake, and the
     rejection, which comes from the stub closing the socket, must **not** carry either verification code.
   - `pool.end()` in `finally`.
3. Import with `import { resolveDbConnection } from '../dbTls'` and `import pg from 'pg'` (`esModuleInterop: true`).
   Add no `before()` skip-guard (P-06).

**Verification**:
```bash
cd services/xstockstrat-ledger && pnpm run build && node --test --test-reporter=spec dist/__tests__/dbTlsBoot.test.js
pnpm run test:coverage   # c8 --lines 40 passes
pnpm run lint
# C-13: grep -n "mintPki\|mintLeaf" src/__tests__/dbTlsBoot.test.ts → declared once in this file (single consumer)
```

---

### Step 6 — service: Config — resolve first, replace inline TLS block

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/index.ts` — modify

**Reviewers**: `xstockstrat-config` owner — secret encryption + redaction (DB channel carries ciphertext), WatchConfig stream stability; Security — fail-closed TLS verification

**Codebase Evidence**:
- `services/xstockstrat-config/src/index.ts`:
  - `const databaseUrl = process.env.DATABASE_URL ?? ''` `:16`;
  - `loadMasterKey()` `:19`;
  - inline block `:25-33`;
  - `new Pool({ connectionString: dbUrl, max, ssl: sslDisabled ? false : { rejectUnauthorized: !!caCert, ... } })` `:35-43`;
  - `await pool.query('SELECT 1')` `:44`;
  - `mtls.serverCredentials()` at `bindAsync` `:53-55`;
  - `main().catch(... process.exit(1))` `:77-80`.
- No `waitForSnapshot` in config (recon.md:29). The mTLS check is at bind, after the DB, so the DB-first order is
  unchanged here.
- Logger: `getLogger('config:server')` `:12`.

**TDD**: `red-green required` (paired with Step 7)

**Covers**: —

**Instructions**:
1. Add `import { resolveDbConnection } from './dbTls';` after `import * as mtls from './mtls';` (`:5`).
2. Make `const dbConn = resolveDbConnection(process.env.DATABASE_URL, process.env.DATABASE_CA_CERT);` the first
   statement of `main()`, before `loadMasterKey()` (`:19`), so all four backends share the same first gate. When
   `dbConn.ssl !== false`, log the same value-free canary line as Step 4.
3. Delete `databaseUrl` (`:16`) and the inline block `:25-33`. The Pool becomes
   `{ connectionString: dbConn.connectionString, max: ..., ssl: dbConn.ssl }`. Keep the `max` comment.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run build && pnpm run lint
grep -n "rejectUnauthorized\|includes('sslmode" src/index.ts   # → no output
grep -c "ssl: dbConn.ssl" src/index.ts                          # → 1
```

---

### Step 7 — test: Config boot tests through `main()` (AC-1, AC-2 end to end, AC-3)

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/dbTlsBoot.test.ts` — create

**Reviewers**: `xstockstrat-config` owner — boot ordering beside `CONFIG_SECRETS_ENCRYPTION_KEY` fail-fast; Security — wrong-CA rejection

**Codebase Evidence**:
- `loadMasterKey()` (`services/xstockstrat-config/src/crypto.ts:13`) requires `CONFIG_SECRETS_ENCRYPTION_KEY` as
  64 hex chars (32 bytes), throwing at ~`:16` (range `:13-27`).
- Test script: `tsc && node --test dist/__tests__/*.test.js` (`package.json:12-13`). `tsconfig.json` compiles tests
  and `dist/index.js` exists when the tests run.
- Production entry: `CMD ["node", "dist/index.js"]` (`Dockerfile:34`).
- Openssl fixture pattern: `services/xstockstrat-config/src/__tests__/mtls.test.ts` imports `sh`, `mintLeaf` and
  `setEnv` from `./mtlsTestPki` (`:13`) and defines `mintPki()` at `:31`. The boot test may reuse the
  `./mtlsTestPki` helpers instead of an inline openssl helper.

**TDD**: `red-green required` — RED before Step 6:
- AC-1: the old code connects without verification, so it does not exit with `DATABASE_CA_CERT`.
- AC-2: with `rejectUnauthorized: !!caCert` true, the wrong CA is already rejected, so the RED evidence for AC-2
  comes from AC-1, AC-3 and the Step 15 wiring guard. Record which assertions were red in the TDD capture.

**Covers**: `AC-1, AC-2, AC-3` (AC-3 "serves gRPC" narrowed → Deviation Log)

**Instructions**:
1. Spawn `process.execPath` with `[join(process.cwd(), 'dist/index.js')]` and an explicit env:
   `PATH`, `CONFIG_SECRETS_ENCRYPTION_KEY='0'.repeat(64)`, `DATABASE_URL`, plus `DATABASE_CA_CERT` only when the
   case sets it.
2. AC-1:
   - `?sslmode=require` URL to `db.example:25060`, with no CA.
   - Assert a non-zero exit within 15 s and that stderr contains `DATABASE_CA_CERT`.
3. AC-2:
   - Use the Step 5 TLS stub shape (inline, single consumer). Mint CA A and CA B; the stub leaf is signed by B with
     SAN `DNS:localhost`.
   - Wrong CA: `DATABASE_URL=postgres://u:p@localhost:<port>/xstockstrat?sslmode=require`, `DATABASE_CA_CERT=<CA A>`.
     Assert a non-zero exit, and that stderr contains `UNABLE_TO_VERIFY_LEAF_SIGNATURE` or `SELF_SIGNED_CERT_IN_CHAIN`.
   - Positive control: `DATABASE_CA_CERT=<CA B>`. The stub records a completed TLS handshake. Kill the child after
     the first post-TLS packet.
4. AC-3:
   - Point a plaintext stub at `?sslmode=disable` and set no CA.
   - Assert the first packet is a StartupMessage (`readInt32BE(4) === 196608`) and **not** an SSLRequest
     (`80877103`). Assert stderr has no `db-tls:`. Then kill the child.
   - "serves gRPC" would need a full Postgres wire implementation. It is not asserted; record this in the Deviation
     Log at execute.
5. Always `child.kill()` in `finally`, and `server.close()`.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run build && node --test --test-reporter=spec dist/__tests__/dbTlsBoot.test.js
pnpm run test:coverage   # c8 --lines 40 passes
pnpm run lint
```

---

### Step 8 — service: Identity — resolve first, boot `SELECT 1` probe

**Status**: `done`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/index.ts` — modify

**Reviewers**: `xstockstrat-identity` owner — secret store integration (DB carries password/refresh-token hashes), JWT path unaffected; Security — fail-closed TLS verification

**Codebase Evidence**:
- `services/xstockstrat-identity/src/index.ts`:
  - `databaseUrl` `:18`;
  - `new ConfigWatcher(configEndpoint, 'identity')` `:20`, whose constructor calls `mtls.clientCredentials()`
    (`src/services/configWatcher.ts:33`);
  - `waitForSnapshot(90_000)` `:21`;
  - inline block `:24-32`;
  - `new Pool({ ..., max: parseInt(process.env.DB_POOL_MAX ?? '2', 10), ssl: ... rejectUnauthorized: !!caCert ... })` `:34-42`;
  - `createLedgerAudit()` `:45`;
  - `bindAsync` `:55`;
  - `main().catch(... process.exit(1))` `:72`.
- No boot `pool.query` exists today: the pool is lazy (recon.md:36). The probe pattern to mirror is ledger
  `await pool.query('SELECT 1'); log.info('Database connected');` (`services/xstockstrat-ledger/src/index.ts:48-49`).
- Gate status: the operator crash-loop sign-off is recorded in `context.md` § "Session 2026-10-22 (operator
  decision — fail-closed boot)" (`:528-531`). The earlier `- [ ]` open-thread items (`:432`, `:491`, `:518`) predate
  it and were not ticked in place (append-only log).
- Pool budget: identity is direct, max 2 (root `CLAUDE.md` § Connection Pool Budget). The probe borrows one pooled
  connection and returns it, so no new budget is needed (F-06).

**TDD**: `red-green required` (paired with Step 9)

**Covers**: —

**Instructions**:
0. **Gate:** confirm the operator's crash-loop sign-off is recorded in `context.md` (§ Step Dependencies; recorded
   at `context.md:528-531`). If it is refused, skip instruction 4 only and log a Deviation.
1. Add `import { resolveDbConnection } from './dbTls';` after `import * as mtls from './mtls';` (`:5`).
2. Make `const dbConn = resolveDbConnection(process.env.DATABASE_URL, process.env.DATABASE_CA_CERT);` the first
   statement of `main()`, before `new ConfigWatcher` (`:20`). Log the canary line when `dbConn.ssl !== false`.
3. Delete `databaseUrl` (`:18`) and the inline block `:24-32`. The Pool becomes
   `{ connectionString: dbConn.connectionString, max: ..., ssl: dbConn.ssl }`.
4. Directly after the Pool, add `await pool.query('SELECT 1'); log.info('Database connected');`, before
   `createLedgerAudit()` (`:45`) and before `bindAsync`.

**Verification**:
```bash
cd services/xstockstrat-identity && pnpm run build && pnpm run lint
grep -n "rejectUnauthorized\|includes('sslmode" src/index.ts   # → no output
grep -n "ssl: dbConn.ssl\|pool.query('SELECT 1')" src/index.ts  # → both present
```

---

### Step 9 — test: Identity boot test + Pool-level TLS stub

**Status**: `done`
**Service**: `xstockstrat-identity`
**Files**:
- `services/xstockstrat-identity/src/__tests__/dbTlsBoot.test.ts` — create

**Reviewers**: `xstockstrat-identity` owner — boot behaviour; Security — wrong-CA rejection

**Codebase Evidence**:
- Same runner as ledger after feature 252 (re-spec 2026-10-29): `tsc && node --test dist/__tests__/*.test.js`
  (`package.json:12-13`).
- `build: tsc` (`:8`); `tsconfig.json` includes `src/**/*`, so tests are compiled; entry `CMD ["node", "dist/index.js"]`
  (`Dockerfile:45`).
- Fixture model: `src/__tests__/mtls.test.ts` `mintLeaf` `:38`, `mintPki` `:46`.
- P-06: fails.md:2223-2225 (silent skip in the old strip-types suite) is moot after 252, but the new file must still
  execute visibly (`--test-reporter=spec`).

**TDD**: `red-green required` — RED before Step 8: the boot stderr lacks `DATABASE_CA_CERT` (it hits `mtls:`).

**Covers**: `AC-1, AC-2` (AC-2 narrowed to Pool level + Step 15 wiring guard → Deviation Log)

**Instructions**:
1. Same structure as Step 5:
   - **boot test (AC-1):** no build in `before()` (tsc runs first); spawn `dist/index.js` with an explicit env and
     a `?sslmode=require` URL with no CA, then assert a non-zero exit and that stderr contains `DATABASE_CA_CERT`
     and not `mtls:`;
   - **Pool-level TLS stub (AC-2):** a wrong-CA rejection code plus the positive control.
2. Imports: `from '../dbTls'` and `import pg from 'pg'`. No skip-guard.

**Verification**:
```bash
cd services/xstockstrat-identity && pnpm run build && node --test --test-reporter=spec dist/__tests__/dbTlsBoot.test.js
pnpm run test:coverage   # c8 --lines 40 passes
pnpm run lint
```

---

### Step 10 — service: Notify — resolve first, boot `SELECT 1` probe

**Status**: `done`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/index.ts` — modify

**Reviewers**: `xstockstrat-notify` owner — stream delivery guarantees, no regression of alert delivery at boot; Security — fail-closed TLS verification

**Codebase Evidence**:
- `services/xstockstrat-notify/src/index.ts` (re-spec 2026-10-29; cites shifted +1):
  - `databaseUrl` `:20`;
  - `new ConfigWatcher(configEndpoint, 'notify')` `:22`, whose constructor calls `mtls.clientCredentials()`
    (`src/services/configWatcher.ts:35`);
  - `waitForSnapshot(90_000)` `:23`;
  - inline block `:26-34`;
  - `new Pool({ ..., max: parseInt(process.env.DB_POOL_MAX ?? '1', 10), ssl: ... rejectUnauthorized: !!caCert ... })` `:36-45` (`DB_POOL_MAX` `:40`);
  - `new FanoutDispatcher` `:47`;
  - `bindAsync` `:54`;
  - `main().catch(... process.exit(1))` `:71`.
- The pool is lazy today (recon.md:42). Budget: notify is direct, max 1, and the probe returns its connection
  before the server binds (F-06).

**TDD**: `red-green required` (paired with Step 11)

**Covers**: —

**Instructions**:
0. **Gate:** confirm the crash-loop sign-off, as in Step 8 (recorded at `context.md:528-531`).
1. Add `import { resolveDbConnection } from './dbTls';` after `import * as mtls from './mtls';` (`:5`).
2. Make `const dbConn = resolveDbConnection(process.env.DATABASE_URL, process.env.DATABASE_CA_CERT);` the first
   statement of `main()`, before `new ConfigWatcher` (`:22`). Log the canary line when `dbConn.ssl !== false`.
3. Delete `databaseUrl` (`:20`) and the inline block `:26-34`. The Pool becomes
   `{ connectionString: dbConn.connectionString, max: ..., ssl: dbConn.ssl }`. Keep the `max` comment.
4. After the Pool, add `await pool.query('SELECT 1'); log.info('Database connected');`, before
   `new FanoutDispatcher` (`:47`).

**Verification**:
```bash
cd services/xstockstrat-notify && pnpm run build && pnpm run lint
grep -n "rejectUnauthorized\|includes('sslmode" src/index.ts   # → no output
grep -n "ssl: dbConn.ssl\|pool.query('SELECT 1')" src/index.ts  # → both present
```

---

### Step 11 — test: Notify boot test + Pool-level TLS stub

**Status**: `done`
**Service**: `xstockstrat-notify`
**Files**:
- `services/xstockstrat-notify/src/__tests__/dbTlsBoot.test.ts` — create

**Reviewers**: `xstockstrat-notify` owner — boot behaviour; Security — wrong-CA rejection

**Codebase Evidence**:
- Runner: `tsc && node --test dist/__tests__/*.test.js` (`package.json:12-13`). `tsconfig.json` compiles tests.
- Entry: `CMD ["node", "dist/index.js"]` (`Dockerfile:38`).
- Fixture model: `src/__tests__/mtls.test.ts`.

**TDD**: `red-green required` — RED before Step 10: the boot stderr lacks `DATABASE_CA_CERT`.

**Covers**: `AC-1, AC-2` (AC-2 narrowed to Pool level + Step 15 wiring guard → Deviation Log)

**Instructions**:
1. Same structure as Step 5. `dist/index.js` already exists because `tsc` runs before the tests, so skip the
   `pnpm run build` in `before()`.
2. Imports: `from '../dbTls'` (CJS `tsc` style) and `import { Pool } from 'pg'`.

**Verification**:
```bash
cd services/xstockstrat-notify && pnpm run build && node --test --test-reporter=spec dist/__tests__/dbTlsBoot.test.js
pnpm run test:coverage   # c8 --lines 40 passes
pnpm run lint
```

---

### Step 12 — service: UI audit route — fail-closed resolve, safe error log, generic 500

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/config-ui/api/audit/route.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — no direct DB access (except audit log), no secret values rendered; Security — fail-closed TLS verification, no connection material in client responses

**Codebase Evidence**:
- `services/xstockstrat-ui/src/app/config-ui/api/audit/route.ts`:
  - `let pool: Pool | null = null` `:5`;
  - `function getPool()` `:7-35`, with the inline block `:12-22` (`catch { /* keep original */ }` `:19-21`) and
    `rejectUnauthorized: !!caCert` `:31`;
  - `GET` `:37`, with 401 `:39-41`, 403 `:45-47`, `if (!process.env.DATABASE_URL) return { entries: [] }`
    `:52-54`, and `const db = getPool()` `:57`;
  - `catch` returning `{ error: err.message }` with status 500 `:81-86`.
- `HEADER_TRACE_ID` constant: `services/xstockstrat-ui/src/lib/headers.ts:7`. The raw literal is banned by ESLint
  (`.eslintrc.json:17-18`).
- No server logger under `src/lib` (recon.md:49), so use `console.error`.
- The e2e test at `e2e/config-ui/audit.spec.ts:66-75` mocks the route at the browser layer
  (`route.fulfill({ status: 500, ... })`), so it does not execute `route.ts` and keeps passing.
- Deployment-file parity (B2/B2b): the route now reads `DATABASE_CA_CERT`. Both `.do` specs gain the binding in
  Step 14. `docker-compose.yml` is **unchanged** by design: its shared `DATABASE_URL` ends in `?sslmode=disable`
  (`docker-compose.yml:27`), so the resolver takes the no-CA path locally.

**TDD**: `red-green required` (paired with Step 13)

**Covers**: —

**Instructions**:
1. Add these imports:
   - `import { resolveDbConnection } from '@/lib/dbTls';`
   - `import { HEADER_TRACE_ID } from '@/lib/headers';`
2. Replace `getPool()` with `getPool(): Pool`:
   - If `pool` is set, return it.
   - Otherwise `const dbConn = resolveDbConnection(process.env.DATABASE_URL, process.env.DATABASE_CA_CERT);`, then
     `pool = new Pool({ connectionString: dbConn.connectionString, max: ..., ssl: dbConn.ssl })`.
   - The pool is assigned only after a successful resolve, because a throw leaves `pool` null.
   - Delete the stale comment at `:9-11`, which describes "without rejecting the DO-signed certificate". Keep the
     `max` comment.
3. Keep the order: 401 → 403 → `!DATABASE_URL → { entries: [] }` → `getPool()` inside the existing `try`.
4. Replace the `catch` (`:81-86`):
   - Log `console.error('config-ui audit: database error', { traceId: req.headers.get(HEADER_TRACE_ID) ?? '', code: (err as { code?: string })?.code, message: err instanceof Error ? err.message : String(err) })`.
     Never log the whole `err` object.
   - Return `NextResponse.json({ error: 'Audit log unavailable' }, { status: 500 })`, a generic body.
5. The client body never carries `err.message`. Resolver errors name only the env var, so the operator log is
   enough for FR-4 ("logs that DATABASE_CA_CERT is required").

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec tsc --noEmit && pnpm run lint
grep -n "rejectUnauthorized\|includes('sslmode\|err.message }" src/app/config-ui/api/audit/route.ts   # → no output
grep -n "resolveDbConnection\|HEADER_TRACE_ID\|ssl: dbConn.ssl" src/app/config-ui/api/audit/route.ts
```

---

### Step 13 — test: UI audit route vitest (AC-4, AC-7, AC-8)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/config-ui/api/audit/route.test.ts` — create

**Reviewers**: `xstockstrat-ui` owner — config mutation safety, Connect-RPC call safety; Security — no unverified query, no leak in the response body

**Codebase Evidence**:
- vitest `include: ['src/**/*.test.ts']` and alias `@` → `./src` (`services/xstockstrat-ui/vitest.config.ts:16,20`).
- Precedent for `vi.mock` plus `NextRequest` in a node-env vitest: `services/xstockstrat-ui/src/middleware.test.ts:1-14`.
- Route imports to mock: `import { Pool } from 'pg'` (`route.ts:2`) and
  `import { getSessionFromRequest, hasAdminScope } from '@/lib/auth'` (`route.ts:3`).
- C-12: the tests use no domain fixture. Mocked `query` returns `{ rows: [] }`, and the error payloads are scenario
  one-offs, so this is exempt (`services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` unchanged).

**TDD**: `red-green required` — RED before Step 12:
- AC-4: the old `getPool()` constructs a `Pool` with `rejectUnauthorized: false` and queries.
- AC-7: the old body echoes `err.message`, and there is no trace-id log.

**Covers**: `AC-4, AC-7, AC-8` (AC-7 via mocked `pg` → Deviation Log)

**Instructions**:
1. Mock `@/lib/auth`: `getSessionFromRequest` resolves `{ roles: ['admin'] }` and `hasAdminScope` returns `true`.
2. Mock `pg`: `Pool` is a `vi.fn()` constructor recording its options, with `query: vi.fn()`.
3. Isolate the module cache per test: `vi.resetModules()`, `vi.unstubAllEnvs()`, and dynamic
   `await import('./route')`. The route caches `pool` at module level.
4. Build requests with `new NextRequest('http://localhost/config-ui/api/audit', { headers: { [HEADER_TRACE_ID]: 't-266' } })`.
   Import `HEADER_TRACE_ID` from `@/lib/headers`.
5. Cases:
   - **AC-4.** `vi.stubEnv('DATABASE_URL', 'postgres://u:p@db.example:25060/xstockstrat?sslmode=require')`, no CA.
     - Expect status 500 and body `{ error: 'Audit log unavailable' }`.
     - Expect `Pool` **not** constructed and `query` not called.
     - Expect a `console.error` spy call whose second argument has `traceId: 't-266'` and a `message` containing
       `DATABASE_CA_CERT`.
   - **AC-7.** Same URL with `DATABASE_CA_CERT` set. The mocked `query` rejects with
     `Object.assign(new Error('self-signed certificate in certificate chain'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' })`.
     - Expect `Pool` constructed with `ssl` deep-equal to `{ rejectUnauthorized: true, ca: <CA> }`.
     - Expect status 500, and a body with no `self-signed`.
     - Expect `console.error` with `code: 'SELF_SIGNED_CERT_IN_CHAIN'` and `traceId: 't-266'`.
   - **AC-8.** `DATABASE_URL=postgres://xstockstrat:pw@timescaledb:5432/xstockstrat?sslmode=disable`, no CA, with
     `query` resolving `{ rows: [] }`.
     - Expect status 200 and body `{ entries: [] }`.
     - Expect `Pool` constructed with `ssl: false` and a `connectionString` equal to the input.
   - **Regression (`route.ts:52`).** `DATABASE_URL` unset gives status 200, `{ entries: [] }`, and no `Pool`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec vitest run src/app/config-ui/api/audit/route.test.ts
pnpm run test:coverage   # vitest src/lib thresholds (40%) pass
pnpm run lint
grep -n "from '@/lib/headers'" src/app/config-ui/api/audit/route.test.ts
```

---

### Step 14 — config: Bind `DATABASE_CA_CERT` for `xstockstrat-ui` in both `.do` specs (FR-5)

**Status**: `done`
**Service**: `xstockstrat-ui` (deploy env; not a WatchConfig key)
**Files**:
- `.do/app.yaml` — modify
- `.do/app.dev.yaml` — modify

**Reviewers**: `xstockstrat-ui` owner — environment scope correctness; Security — CA as public bootstrap env (like `MTLS_CA_CERT`)

**Codebase Evidence**:
- Entry to copy verbatim from `.do/app.yaml:434-436`: `- key: DATABASE_CA_CERT` / `scope: RUN_TIME` /
  `value: ${xstockstrat.CA_CERT}`.
- `.do/app.yaml`: the `xstockstrat-ui` component is at `:603`. Its `DATABASE_URL` entry is `:658-660` (`- key` at
  `:658`, `value: ${xstockstrat.DATABASE_URL}` at `:660`), there is no CA, and `jobs:` / `db-migrator` follow at
  `:662` / `:665`.
- `.do/app.dev.yaml`: the `xstockstrat-ui` component is at `:600`. Its `DATABASE_URL` entry is `:660-662`, there is
  no CA, and `jobs:` / `db-migrator` follow at `:664` / `:667`.
- `${xstockstrat.CA_CERT}` is a DO DB binding, not a `YOUR_*` placeholder, so no `deploy.yml` substitution is needed:
  `.github/workflows/deploy.yml` has no `CA_CERT` substitution (recon.md:53; the earlier `:186` cite now points at
  an unrelated cert-glob loop).
- Preserve `@AC-8 @feature-147`: the diff adds only `DATABASE_CA_CERT` lines (`docs/sdd/business-rules/platform.feature:11-12`).

**TDD**: `N/A (deploy-spec env binding; behaviour proven by Step 15's AC-5 guard, whose RED run precedes this step)`

**Covers**: —

**Instructions**:
1. In `.do/app.yaml`, insert the three lines from `:434-436` directly after `:660`
   (`value: ${xstockstrat.DATABASE_URL}` in the `xstockstrat-ui` block), with the same 6-space `- key` indentation.
2. In `.do/app.dev.yaml`, insert the same three lines directly after `:662`.
3. Do not touch `db-migrator` (out of scope per product spec) or any other line.

**Verification**:
```bash
git diff --unified=0 .do/app.yaml .do/app.dev.yaml | grep '^[+-][^+-]'   # only the 3 added lines per file
git diff .do/ | grep -c MCP_AGENT_SECRET                                 # → 0
```
(The YAML-parse proof is Step 15. A grep is not the AC-5 check, per fails.md:2836.)

---

### Step 15 — test: Platform guard vitest — AC-5 YAML parse, copy hash, static wiring

**Status**: `done`
**Service**: `xstockstrat-ui` (platform check housed in the UI suite)
**Files**:
- `services/xstockstrat-ui/src/lib/dbTlsPlatformGuard.test.ts` — create

**Reviewers**: `xstockstrat-ui` owner — CI gate correctness; `xstockstrat-ledger`, `xstockstrat-config`, `xstockstrat-identity`, `xstockstrat-notify` owners — their entry files are asserted; Security — drift guard on security code

**Codebase Evidence**:
- `yaml` devDependency from Step 3. The guard runs on `.do`-only PRs through the Step 3 filter, and on any Node
  service PR through the `node-test` matrix (`ci.yml:547-574`).
- The repo root is four levels above `services/xstockstrat-ui/src/lib/`. CI runs from the full checkout
  (`actions/checkout@v7`, `ci.yml:577`).
- Parse, don't grep: fails.md:2836 and recon.md:100.
- The direct-DB components among the five services are each `- name: xstockstrat-<svc>` under the specs' component
  list: `.do/app.yaml:399,444,493,558,603` and `.do/app.dev.yaml:396,441,490,555,600`.
- Wiring targets: the four `src/index.ts` files and `src/app/config-ui/api/audit/route.ts`. The allowed `ssl:` hits
  elsewhere (re-spec 2026-10-29, `grep -rn "ssl:"` over the five non-test `src` trees) are exactly two, both in ledger:
  the export cursor `ssl: opts.ssl` (`services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:356`) and the listener
  factory's parameter annotation `ssl: ClientConfig['ssl'],` (`services/xstockstrat-ledger/src/services/eventRowResolver.ts:42`,
  feature 248). The ledger listener now receives TLS positionally through `makeListenerClient` (Step 4).

**TDD**: `red-green required` — **execute order is 13 → 15 (RED) → 14 → 15 (GREEN)**; Step 15 is written and
RED-run before Step 14's `.do` edit exists (if Step 14 was applied first, revert its hunk with
`git checkout -- .do/app.yaml .do/app.dev.yaml`, never `git stash`). RED: the AC-5 assertion fails for
`xstockstrat-ui` in both specs. Hash and wiring are already green after Steps 1–12, which shows the guard measures
the final state. Also capture the negative rows passing (they assert that the check detects a violation).
GREEN: re-run after Step 14 lands.

**Covers**: `AC-5, AC-2` (AC-2: per-service wiring proof for ledger Pool + `makeListenerClient` listener, config, identity, notify and the UI route)

**Instructions**:
1. Header comment, at most 2 lines: state that this is a platform check housed in the UI suite, and that it reads
   repo-root files.
2. `const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));`. Import `parse` from `yaml`,
   `readFileSync`/`readdirSync` from `node:fs`, and `createHash` from `node:crypto`.
3. Define a local `missingCa(spec: unknown): string[]`.
   - For every component in `services`, `workers` and `jobs` whose `name` is one of the five services and whose
     `envs` contain `key: DATABASE_URL`, it returns the name when no env has `key: DATABASE_CA_CERT` with
     `value: '${xstockstrat.CA_CERT}'`.
   - Assert `missingCa(parse(readFileSync(ROOT + '.do/app.yaml', 'utf8')))` deep-equals `[]`, and the same for
     `.do/app.dev.yaml` (**AC-5**, one `it` per spec).
4. **Negative row (design-gate r2).** Clone the parsed `.do/app.yaml` with `structuredClone` and remove the
   `DATABASE_CA_CERT` env from the `xstockstrat-ui` component. Assert `missingCa(clone)` deep-equals `['xstockstrat-ui']`.
5. **Copy hash (C-18).** Assert the five `dbTls.ts` paths from Step 1 yield exactly one distinct SHA-256.
6. **Static wiring (AC-2, design item 5c).** For each of the five services' `src/` trees, read every `.ts` file
   recursively, skipping `__tests__/` and `*.test.ts`.
   - Assert that no file other than `dbTls.ts` contains `rejectUnauthorized` or `includes('sslmode`.
   - Assert that each of the five entry files contains `resolveDbConnection(process.env.DATABASE_URL, process.env.DATABASE_CA_CERT)`.
   - Assert that every `/\bssl:\s*([^,}\s]+)/g` match in each entry file captures `dbConn.ssl`.
   - Assert that ledger `src/index.ts` has exactly 1 such match (Pool) and contains
     `makeListenerClient(dbConn.connectionString, dbConn.ssl, configWatcher)` (listener).
   - Assert that the only other `ssl:` hits across the five `src/` trees are an allow-list of exactly two:
     `ssl: opts.ssl` in `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts` and
     `ssl: ClientConfig['ssl']` in `services/xstockstrat-ledger/src/services/eventRowResolver.ts`.
7. **Synthetic negative for the wiring scan.** Assert that the scan function flags a string containing
   `rejectUnauthorized: !!caCert`. This proves the check is not vacuous.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec vitest run src/lib/dbTlsPlatformGuard.test.ts
pnpm run test:coverage && pnpm run lint   # vitest src/lib thresholds (40%) pass
```

---

### Step 16 — docs: Service env docs, database pattern, scoped DRY exception

**Status**: `done`
**Service**: `docs/`, `services/*/CLAUDE.md`
**Files**:
- `services/xstockstrat-ledger/CLAUDE.md` — modify
- `services/xstockstrat-config/CLAUDE.md` — modify
- `services/xstockstrat-identity/CLAUDE.md` — modify
- `services/xstockstrat-notify/CLAUDE.md` — modify
- `services/xstockstrat-ui/CLAUDE.md` — modify
- `docs/patterns/database.md` — modify
- `docs/patterns/dry-guard-rail.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `## Environment Variables` sections: ledger `CLAUDE.md:117`, config `:125`, identity `:82`, notify `:110`, UI
  `:278` (where `DATABASE_URL # config-ui audit route only` is at `:298`). `DATABASE_CA_CERT` is undocumented in
  all five (recon.md:104).
- `docs/patterns/database.md` § `## Connection pooling (PgBouncer)` is at `:104`, followed by `## Approval` at `:157`.
- `docs/patterns/dry-guard-rail.md` § `## Exemptions` is at `:72`. The hook is enforced only for
  `services/xstockstrat-ui/src` (`.husky/pre-commit:10-13`) and is report-only elsewhere (`:19`).
  `.jscpd.json:4` sets `minTokens: 100`.
- **Spec-time correction to recon.md:104 and design item 9:**
  - `services/xstockstrat-identity/docs/operations.md:21` runs `uv run scripts/manage-users.py`, a Python/psycopg
    CLI (`operations.md:7-24`).
  - `docs/setup/digitalocean.md:556` runs `./scripts/db-migrate.sh force` with golang-migrate.
  - Neither is a Node `pg.Pool`, so neither "fails to boot" after 266. Both sit outside D-32 (product spec § Out of
    Scope: db-migrator).
  - These two files are **confirm-only**: re-read them and do not edit. The finding is recorded in `context.md`.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. In each of the four backend `CLAUDE.md` env sections, add a `DATABASE_CA_CERT` row. It says three things:
   - the variable is required unless `DATABASE_URL` has exactly `sslmode=disable` (local compose);
   - otherwise the service exits at boot, naming the variable;
   - any `ssl*` or `uselibpqcompat` URL parameter is refused, and the `sslmode=disable` carve-out is DB-only and
     never affects gRPC mTLS (`@AC-4 @feature-210`).

   Identity and notify also note that the service now needs the DB to boot (the `SELECT 1` probe).
2. In the UI `CLAUDE.md` env section, beside `DATABASE_URL` (`:298`), add `DATABASE_CA_CERT`, for the config-ui
   audit route only. The route returns 500 and logs when the variable is missing on a TLS URL.
3. In `docs/patterns/database.md`, before `## Approval` (`:157`), add a short `## Node DB TLS (fail-closed)`
   subsection. It names `resolveDbConnection` in the five `dbTls.ts` files, the rule order from Step 1, and that
   the six PgBouncer Go/Python services are out of scope (recon.md:105).
4. In `docs/patterns/dry-guard-rail.md` § Exemptions, add one bullet:
   - It names exactly the five `dbTls.ts` paths and the four `src/mtls.ts` copies
     (`services/xstockstrat-{ledger,config,identity,notify}/src/mtls.ts`).
   - It states that the copies stay per-service because the services use separate Docker build contexts.
   - It names `services/xstockstrat-ui/src/lib/dbTlsPlatformGuard.test.ts` as the hash enforcement for `dbTls.ts`.
   - It says explicitly that this is **not** general permission to copy security code.
5. Re-read `services/xstockstrat-identity/docs/operations.md:7-24` and `docs/setup/digitalocean.md:551-559`. Make
   no edit (see Evidence).

**Verification**:
```bash
grep -n "DATABASE_CA_CERT" services/xstockstrat-{ledger,config,identity,notify,ui}/CLAUDE.md docs/patterns/database.md
grep -n "dbTls.ts" docs/patterns/dry-guard-rail.md
git diff --stat services/xstockstrat-identity/docs/operations.md docs/setup/digitalocean.md   # → empty
```

---

### Step 17 — docs: Rollout canary record + context teardown

**Status**: `pending`
**Service**: `docs/roadmap/features/266-fix-db-tls-fail-closed/`
**Files**:
- `docs/roadmap/features/266-fix-db-tls-fail-closed/context.md` — modify
- `docs/context-constitution-findings.md` — modify (only if the refresh reports grounded drift)

**Reviewers**: none

**Codebase Evidence**:
- Design item 8 (canary) and Open Risks: the empty-CA binding and the `DATABASE_URL` format.
- Root `CLAUDE.md` § Teardown: run `/context-forge:context-constitution refresh` scoped to the touched context
  files, or reconcile by hand and record that in the PR body (fails.md:670).

**TDD**: `N/A (operational verification + docs)`

**Covers**: —

**Instructions**:
1. **Pre-merge dev canary.** Do this before the integration PR merges to `main-dev`.
   - On the running dev backends, confirm the binding is non-empty and verifies. Use either:
     - the value-free `db-tls: verifying server cert against DATABASE_CA_CERT` line, which appears only after the
       Step 4/6/8/10 deploy; or
     - the pre-merge check: `openssl s_client -starttls postgres -connect <dev-db-host>:25060 -CAfile <CA from the DO console> -verify_return_error`
       returns `Verify return code: 0`, and the host matches the certificate SAN.
   - Confirm that `${xstockstrat.DATABASE_URL}` carries no `ssl*` key other than a single `sslmode=require`.
   - Record the result in `context.md` with no secret values.
2. Re-confirm the rollout order from design item 8: the UI route and the `.do` change ship with the backends in one
   integration PR, and that PR merges only after the canary passes.
3. **Teardown.** Run `/context-forge:context-constitution refresh`, scoped to the Step 16 files, and fix any
   grounded drift. If the plugin is unavailable, re-read each Step 16 file against the code and record both facts
   in the PR body: that the plugin was unavailable, and what manual reconciliation you did.

**Verification**:
```bash
grep -n "canary" docs/roadmap/features/266-fix-db-tls-fail-closed/context.md
# PR body contains the teardown record (plugin run output, or "plugin unavailable" + manual reconciliation list)
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

Pre-declared at spec time. Execute confirms or amends each entry; per F-09 the step bodies stay unchanged.

- **AC-2 narrowed (ledger, identity, notify).** The wrong-CA rejection is proven at Pool level against a TLS stub,
  plus the Step 15 static wiring guard. It is not proven through `main()`, because those services wait 90 s for
  config first. Config is tested end to end (Step 7).
- **AC-3 narrowed (config).** The test proves `main()` sends a plaintext StartupMessage with no SSLRequest. It does
  not prove that gRPC is served.
- **AC-7 narrowed (UI).** The route's rejection handling is proven with a mocked `pg`, not a live TLS handshake.
  pg's verification itself is proven by the backend stub tests.
- **Steps 1 and 2 executed as one commit (2026-10-29, sequential).** Step 1's TDD gate is `red-green required
  (paired with Step 2)`: its RED test is Step 2's `dbTls.test.ts`, so Step 1 cannot complete a red→green cycle
  alone. Applied the standing operator rule (operator, 2026-10-29, in their own words: 'Merge pairs + standing
  rule'): "if this step's Verification fails ONLY because the consumers or tests of its new code live in the
  immediately following step (e.g. ... the RED test is that next step's test), do NOT return a blocker. Execute this
  step and the next one together as ONE commit with one red→green cycle on the next step's tests, mark BOTH steps
  done, and add a Deviation Log entry quoting the rule." RED: `tsc` TS2307 `Cannot find module '../dbTls'` (ledger)
  and vitest "no tests" import failure (UI). GREEN: 14/14 resolver tests in each of the five services.
  **Disposition**: operator standing rule.
- **Steps 4 and 5 executed as one commit (2026-10-29, sequential).** Step 4's TDD gate is `red-green required
  (paired with Step 5)`: its RED test is Step 5's `dbTlsBoot.test.ts`, so Step 4 cannot complete a red→green cycle
  alone. Applied the standing operator rule (operator, 2026-10-29, in their own words: 'Merge pairs + standing
  rule'): "if this step's Verification fails ONLY because the consumers or tests of its new code live in the
  immediately following step (e.g. ... the RED test is that next step's test), do NOT return a blocker. Execute this
  step and the next one together as ONE commit with one red→green cycle on the next step's tests, mark BOTH steps
  done, and add a Deviation Log entry quoting the rule." RED: both boot tests (AC-1, AC-6) failed — stderr was
  `mtls: MTLS_CERT, MTLS_KEY and MTLS_CA_CERT must all be set`, not `DATABASE_CA_CERT`. The two Pool-level AC-2
  tests were already green at RED, because Step 1 had landed the resolver they import (Step 5's "fails to compile
  before Step 1" RED no longer applies). GREEN: 4/4. **Disposition**: operator standing rule.
- **Steps 6 and 7 executed as one commit (2026-10-29, sequential).** Step 6's TDD gate is `red-green required
  (paired with Step 7)`: its RED test is Step 7's config `dbTlsBoot.test.ts`, so Step 6 cannot complete a red→green
  cycle alone. Applied the standing operator rule (operator, 2026-10-29, in their own words: 'Merge pairs + standing
  rule'): "if this step's Verification fails ONLY because the consumers or tests of its new code live in the
  immediately following step (e.g. ... the RED test is that next step's test), do NOT return a blocker. Execute this
  step and the next one together as ONE commit with one red→green cycle on the next step's tests, mark BOTH steps
  done, and add a Deviation Log entry quoting the rule." RED: AC-1 failed — the old `main()` dialled `db.example`
  and exited on `getaddrinfo ENOTFOUND`, with no `DATABASE_CA_CERT` in its output. AC-2 (wrong CA, positive control)
  and AC-3 were green at RED, as Step 7's TDD note predicts (the old `rejectUnauthorized: !!caCert` already rejected
  a wrong CA once a CA was set, and `sslmode=disable` was already plaintext). GREEN: 4/4. The pre-declared
  "AC-3 narrowed (config)" entry above is confirmed: gRPC serving is not asserted. **Disposition**: operator
  standing rule.
- **Steps 8 and 9 executed as one commit (2026-10-29, sequential).** Step 8's TDD gate is `red-green required
  (paired with Step 9)`: its RED test is Step 9's identity `dbTlsBoot.test.ts`, so Step 8 cannot complete a red→green
  cycle alone. Applied the standing operator rule (operator, 2026-10-29, in their own words: 'Merge pairs + standing
  rule'): "if this step's Verification fails ONLY because the consumers or tests of its new code live in the
  immediately following step (e.g. ... the RED test is that next step's test), do NOT return a blocker. Execute this
  step and the next one together as ONE commit with one red→green cycle on the next step's tests, mark BOTH steps
  done, and add a Deviation Log entry quoting the rule." Gate (instruction 0): the crash-loop sign-off is recorded in
  `context.md` § "Session 2026-10-22 (operator decision — fail-closed boot)", so the boot `SELECT 1` probe landed.
  RED: AC-1 failed — the boot child exited on `mtls: MTLS_CERT, MTLS_KEY and MTLS_CA_CERT must all be set`, not
  `DATABASE_CA_CERT`. The two Pool-level AC-2 tests were green at RED (the resolver from Step 1 already exists).
  GREEN: 3/3. **Disposition**: operator standing rule.
- **Steps 10 and 11 executed as one commit (2026-10-29, sequential).** Step 10's TDD gate is `red-green required
  (paired with Step 11)`: its RED test is Step 11's notify `dbTlsBoot.test.ts`, so Step 10 cannot complete a
  red→green cycle alone. Applied the standing operator rule (operator, 2026-10-29, in their own words: 'Merge pairs +
  standing rule'): "if this step's Verification fails ONLY because the consumers or tests of its new code live in the
  immediately following step (e.g. ... the RED test is that next step's test), do NOT return a blocker. Execute this
  step and the next one together as ONE commit with one red→green cycle on the next step's tests, mark BOTH steps
  done, and add a Deviation Log entry quoting the rule." Gate (instruction 0): the crash-loop sign-off is recorded in
  `context.md` § "Session 2026-10-22 (operator decision — fail-closed boot)", so the boot `SELECT 1` probe landed.
  Instruction 3 also removed the `const caCert = process.env.DATABASE_CA_CERT;` line (`:35`) the delete list did
  not name; it is dead once the resolver takes the CA. RED: AC-1 failed — the boot child exited on `mtls: MTLS_CERT,
  MTLS_KEY and MTLS_CA_CERT must all be set`, not `DATABASE_CA_CERT`. The two Pool-level AC-2 tests were green at RED
  (the resolver from Step 1 already exists). GREEN: 3/3. **Disposition**: operator standing rule.
- **Steps 12 and 13 executed as one commit (2026-10-29, sequential).** Step 12's TDD gate is `red-green required
  (paired with Step 13)`: its RED test is Step 13's `route.test.ts`, so Step 12 cannot complete a red→green cycle
  alone. Applied the standing operator rule (operator, 2026-10-29, in their own words: 'Merge pairs + standing
  rule'): "if this step's Verification fails ONLY because the consumers or tests of its new code live in the
  immediately following step (e.g. ... the RED test is that next step's test), do NOT return a blocker. Execute this
  step and the next one together as ONE commit with one red→green cycle on the next step's tests, mark BOTH steps
  done, and add a Deviation Log entry quoting the rule." RED: AC-4 failed (the old route built a `Pool` and queried,
  body `Cannot read properties of undefined (reading 'rows')`) and AC-7 failed (body echoed `self-signed certificate
  in certificate chain`); AC-8 and the unset-URL regression were green at RED. GREEN: 4/4. The pre-declared
  "AC-7 narrowed (UI)" entry above is confirmed: `pg` is mocked. **Disposition**: operator standing rule.
- **Step 17 deferred to operator — integration PR merge held until the pre-merge dev canary passes (2026-10-29,
  sequential).** This session cannot reach the running dev backends, the dev DB host or the DO-console CA, so
  instruction 1 cannot run here. Everything code-side is done:
  - The value-free `db-tls: verifying server cert against DATABASE_CA_CERT` log is in all four backend
    `src/index.ts` files.
  - The five `dbTls.ts` copies share one SHA-256.
  - Both `.do` specs bind `DATABASE_CA_CERT` for all five Node DB callers.

  The instruction 3 teardown was done by hand, because the context-forge `context-constitution` skill is not
  available in this session. It found no drift (see `context.md`).

  The operator runs these checks before merging the integration PR to `main-dev`:
  1. `openssl s_client -starttls postgres -connect <dev-db-host>:25060 -CAfile <dev CA from the DO console> -verify_return_error </dev/null`
     prints `Verify return code: 0 (ok)`, and the certificate SAN matches `<dev-db-host>`.
  2. In the DO console, the dev `${xstockstrat.CA_CERT}` binding is non-empty. `${xstockstrat.DATABASE_URL}` has no
     `ssl*` or `uselibpqcompat` query key other than a single `sslmode=require`. Record the result with no secret
     values.
  3. Append the result of checks 1 and 2 to `context.md` and set Step 17 **Status** to `done`, then merge. The UI
     route, the `.do` change and the backends ship together in that one integration PR (design item 8).
  4. After the merge, the `main-dev` dev deploy runs. Confirm that the logs of ledger, config, identity and notify
     each show `db-tls: verifying server cert against DATABASE_CA_CERT`, and that none exits at boot with a
     `db-tls:` error. Confirm that `GET /config-ui/api/audit` returns 200, not the generic 500.

  The PR body must carry the teardown record: that the plugin was unavailable, and the manual reconciliation list
  from `context.md`. **Disposition**: operator-only.
