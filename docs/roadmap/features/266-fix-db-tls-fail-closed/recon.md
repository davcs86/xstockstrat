# Recon: fix-db-tls-fail-closed

**Created**: 2026-10-21
**From**: product-spec.md
**Affected services**: xstockstrat-ledger, xstockstrat-config, xstockstrat-identity, xstockstrat-notify, xstockstrat-ui
**Severity**: SEV-2 (Track C; scope is debt-radar D-32 — operator decision 2026-10-21)

---

## Objective

Every Node-side `pg.Pool` (four backends plus the config-ui audit route) builds
`ssl: { rejectUnauthorized: !!caCert }`, so a missing `DATABASE_CA_CERT` silently downgrades to encrypted-but-unverified
TLS. The fix makes these pools fail closed: unless `DATABASE_URL` explicitly sets `sslmode=disable`, a pool verifies
the server against `DATABASE_CA_CERT`, or the backend refuses to boot and the audit route refuses to query, with a
log line naming the variable. `xstockstrat-ui` gets the CA in both `.do` specs, so the deployed audit view keeps working.

## Codebase Map

- **`xstockstrat-ledger`** (Node.js)
  - Entry point: `main()` in `services/xstockstrat-ledger/src/index.ts`; fatal handler `main().catch(... process.exit(1))` at `:85-88`
  - Boot order: `configWatcher.waitForSnapshot(90_000)` `:23` → `sslDisabled = databaseUrl.includes('sslmode=disable')` `:26` → `u.searchParams.delete('sslmode')` `:31` → `caCert = process.env.DATABASE_CA_CERT` `:35` → `rejectUnauthorized: !!caCert` `:37` → `new Pool` `:40` → `await pool.query('SELECT 1')` `:47` → gRPC `bindAsync` `:60`
  - Second connection: `new EventNotifier(() => new Client({ connectionString: dbUrl, ssl: sslOption }))` `:51` — shares `sslOption`, so one fix covers the LISTEN/NOTIFY client
  - Logger: `getLogger('ledger:server')` `:13`; mTLS module `import * as mtls from './mtls'` `:5`
  - Last migration: n/a (no migration in scope)
  - Test cmd: `node --experimental-strip-types --test src/__tests__/*.test.ts` (`services/xstockstrat-ledger/package.json:13`)
- **`xstockstrat-config`** (Node.js)
  - Entry point: `services/xstockstrat-config/src/index.ts`; no `waitForSnapshot` (config is the source); `loadMasterKey()` fail-fast at `:19`
  - Pool: `sslDisabled` `:25`, `searchParams.delete('sslmode')` `:30`, `caCert` `:34`, `new Pool` `:35`, `rejectUnauthorized: !!caCert` `:40`, `await pool.query('SELECT 1')` `:44`, `bindAsync` `:53`, fatal `process.exit(1)` `:79`
  - Logger: `getLogger('config:server')` `:12`
  - Test cmd: `tsc && node --test dist/__tests__/*.test.js` (`services/xstockstrat-config/package.json:12`)
- **`xstockstrat-identity`** (Node.js)
  - Entry point: `services/xstockstrat-identity/src/index.ts`; `waitForSnapshot(90_000)` `:21`
  - Pool: `sslDisabled` `:24`, `searchParams.delete('sslmode')` `:29`, `caCert` `:33`, `new Pool` `:34`, `rejectUnauthorized: !!caCert` `:39`, `bindAsync` `:55`, `main().catch(... process.exit(1))` `:72`
  - **No startup `pool.query('SELECT 1')`** — the pool is lazy, so a cert rejection (FR-2/AC-2) surfaces only on first query unless design adds a boot probe
  - Logger: `getLogger('identity:server')` `:13`
  - Test cmd: `node --experimental-strip-types --test src/__tests__/*.test.ts` (`services/xstockstrat-identity/package.json:12`)
- **`xstockstrat-notify`** (Node.js)
  - Entry point: `services/xstockstrat-notify/src/index.ts`; `waitForSnapshot(90_000)` `:22`
  - Pool: `sslDisabled` `:25`, `searchParams.delete('sslmode')` `:30`, `caCert` `:34`, `new Pool` `:35`, `rejectUnauthorized: !!caCert` `:41`, `bindAsync` `:53`, `main().catch(... process.exit(1))` `:70`
  - **No startup `pool.query('SELECT 1')`** — same lazy-pool caveat as identity
  - Logger: `getLogger('notify:server')` `:14`
  - Test cmd: `tsc && node --test dist/__tests__/*.test.js` (`services/xstockstrat-notify/package.json:12`)
- **`xstockstrat-ui`** (Next.js) — config-ui audit route `services/xstockstrat-ui/src/app/config-ui/api/audit/route.ts`
  - Module-level cache `let pool: Pool | null = null` `:5`; lazy `function getPool()` `:7`
  - `sslDisabled = connectionString.includes('sslmode=disable')` `:13`, `searchParams.delete('sslmode')` `:17`, `caCert` `:23`, `rejectUnauthorized: !!caCert` `:31`
  - `GET` `:37`: 401 `:40` → 403 (admin scope) `:46` → `if (!process.env.DATABASE_URL)` returns `{ entries: [] }` `:52` → `const db = getPool()` inside `try` `:57` → `catch` returns 500 with `err.message` `:81-85`
  - No logger import in the route, and no server logger under `src/lib/` (`ls src/lib | grep -i log` → none)
- **Deploy specs**
  - `.do/app.yaml`: `DATABASE_CA_CERT` (`scope: RUN_TIME`, `value: ${xstockstrat.CA_CERT}`) at `:434` ledger, `:481` identity, `:528` notify, `:586` config. `xstockstrat-ui` component `:601`; its `DATABASE_URL` key `:656`, value `:658`, no CA → insert after `:658`. `db-migrator` `:663` (out of scope).
  - `.do/app.dev.yaml`: `DATABASE_CA_CERT` at `:431`, `:478`, `:525`, `:583`. `xstockstrat-ui` component `:598`; `DATABASE_URL` `:658`/`:660`, no CA → insert after `:660`. `db-migrator` `:665` (out of scope).
  - `${xstockstrat.CA_CERT}` is a DO database-component binding, not a `YOUR_*` placeholder — `deploy.yml` substitutes only `YOUR_*_MTLS_CA_CERT` (`.github/workflows/deploy.yml:186`), so no substitution edit is needed.
- **Local / CI**
  - `docker-compose.yml:27` `DATABASE_URL: ...@timescaledb:5432/xstockstrat?sslmode=disable` — only `DATABASE_*` var; no CA (FR-3/AC-3/AC-8 path)
  - CI integration: `.github/workflows/ci.yml:669` `DATABASE_URL="...?sslmode=disable"`

## Patterns to REUSE

- Boot-time fail-closed throw on missing env → reuse the `mtls` module style: `throw new Error('mtls: MTLS_CERT, MTLS_KEY and MTLS_CA_CERT must all be set (fail-closed)')` at `services/xstockstrat-config/src/mtls.ts:16` (identical in identity/notify/ledger `src/mtls.ts`); message names the env var, so it satisfies FR-1's log requirement when it reaches `main().catch`.
- Non-zero exit → reuse the existing `main().catch(... process.exit(1))` (ledger `:85-88`, config `:79`, identity `:72`, notify `:70`); a thrown error needs no new exit path.
- Fail-fast before serving precedent → `loadMasterKey()` at `services/xstockstrat-config/src/index.ts:19`.
- Wrong-CA test fixture → `src/__tests__/mtls.test.ts` in each backend mints a throwaway CA with openssl in a tmp dir (identity imports `'../mtls.ts'`); model for AC-2 / AC-7.
- UI unit test home → pure function under `services/xstockstrat-ui/src/lib/` with a vitest `*.test.ts` (vitest `include: ['src/**/*.test.ts']`, coverage `include: ['src/lib/**']`, `services/xstockstrat-ui/vitest.config.ts:20,25`); precedent: pure-helper extraction for node-only vitest (ledger `insights.md` 2026-10-07 188-sparkline-ohlc-replacement).
- UI error rendering → the existing `catch` 500 path `route.ts:81-85` already surfaces `err.message`, and `e2e/config-ui/audit.spec.ts:70,75` already asserts the "Failed to load audit log: …" rendering for a 500.
- `.do` CA binding → copy the existing four-line entry at `.do/app.yaml:434-436` verbatim into the UI block.
- Shared parse (FR-1 requires one parse across the five sites): no shared helper exists; all five inline `includes('sslmode=disable')` + `searchParams.delete('sslmode')` (ledger `:26,31`, config `:25,30`, identity `:24,29`, notify `:25,30`, UI `:13,17`). Debt-radar D-20 (shared Node DB-pool package) is the adjacent refactor and optional per the spec.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-4 @FR-4 @feature-210` "mTLS is enforced identically in every environment; verification cannot be disabled" (`docs/sdd/business-rules/platform.feature`) — same fail-closed boot pattern; the `sslmode=disable` carve-out applies to the DB URL only and must not become a gRPC-plaintext toggle.
- **PRESERVE** `@AC-3 @FR-3 @regression @feature-175` "The Node leaf type surface matches the Node 24 runtime" (`docs/sdd/business-rules/platform.feature`) — the four backends must still `tsc` and build after the pool/TLS edits.
- **PRESERVE** `@AC-2 @FR-2 @regression @item-6 @feature-175` "The confirmed-dead propagation middleware is gone from the Node leaf services" (`docs/sdd/business-rules/platform.feature`) — a shared pool helper must not reintroduce `src/middleware/propagation.ts`; existing tests keep passing.
- **PRESERVE** `@AC-1 @FR-1 @FR-2 @feature-021` "Date-range export streams every event as NDJSON in global-sequence order" (`docs/sdd/business-rules/platform.feature`) — ledger DB read path unchanged under verified TLS.
- **PRESERVE** `@AC-2 @FR-2 @feature-021` "CSV format returns a header row and one data row per event" (`docs/sdd/business-rules/platform.feature`) — same ledger read path.
- **PRESERVE** `@AC-7 @FR-6 @feature-021` "A one-million-row export streams without buffering the full result set" (`docs/sdd/business-rules/platform.feature`) — cursor streaming unaffected by pool SSL options.
- **PRESERVE** `@AC-1 @FR-1 @FR-4 @feature-147` "A secret written via SetConfig is persisted encrypted, not plaintext" (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`) — config's DB channel hardened; persistence unchanged.
- **PRESERVE** `@AC-2`/`@AC-3`/`@AC-5`/`@AC-16 @feature-147` "WatchConfig never streams secret plaintext" / "GetConfig and ListKeys redact secrets at the edge" / "GetSecret fails closed for a caller not on the allow-list" / "GetSecret distinguishes an unset secret from a decrypt failure" (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`) — config must still boot and serve these with the CA; `DATABASE_CA_CERT` stays a boot env var, not a WatchConfig key.
- **PRESERVE** "Every user-management action writes a ledger audit event" (`services/xstockstrat-identity/acceptance/user-management-ui.feature:62`) — identity must still boot after its pool change.
- **PRESERVE** "A snapshot write emits an append-only audit ledger event" (`services/xstockstrat-ledger/acceptance/snapshot-offline-positions.feature:8`) — depends on ledger DB writes under verified TLS.
- No existing acceptance suite covers the `/config-ui/api/audit` route or DB TLS / `DATABASE_CA_CERT` in any of the five services; 266 `@AC-1`..`@AC-8` are new guarantees (nothing EXTENDed or CHANGEd). Notify and UI suites (`services/xstockstrat-notify/acceptance/*`, `services/xstockstrat-ui/acceptance/*`) were pattern-searched; none assert DB connection or boot behavior.

## Dependencies

- Proto/RPC: none
- Migration: none
- Config keys: none (`DATABASE_CA_CERT` is a boot-time env var; a WatchConfig key would be circular for config)
- Inter-service edges: none changed
- New env vars / ports: none new. `DATABASE_CA_CERT` already exists for the four backends (`.do/app.yaml:434,481,528,586`; `.do/app.dev.yaml:431,478,525,583`); FR-5 adds it to the `xstockstrat-ui` component in both specs. Absent from `docker-compose.yml` by design (`sslmode=disable`, `:27`).

## Risks / Not-found

- **Deploy ordering (from triage):** the UI has no CA in either `.do` spec today; a fail-closed route change without the FR-5 spec edit breaks `/config-ui/api/audit` on deploy. The `.do` edit must land in the same PR or earlier.
- **Lazy pools in identity/notify:** no boot `SELECT 1` (identity `index.ts`, notify `index.ts` — grep miss). FR-2's "backend exits non-zero with a logged certificate verification error" only holds at boot for ledger (`:47`) and config (`:44`) today. Design must decide whether to add a boot connect probe to identity/notify (and note the extra connection against the pool budget, F-06 — identity/notify pools are direct `:25060`, max 2 / 1).
- **Check placement vs the 90s config wait:** ledger (`:23`), identity (`:21`) and notify (`:22`) build the pool after `waitForSnapshot(90_000)`; a check at pool construction fires only after that wait. Design decides whether the CA check runs at the top of `main()`.
- **sslmode parse edge cases:** today all five sites substring-match. A `URL.searchParams.get('sslmode')` parse changes behavior for URL-encoded values and for strings like `sslmode=disabled`; also the existing `catch { /* keep original */ }` on URL-parse failure (e.g. notify `:27-33`) must not fall through to a fail-open path.
- **UI behavior fork:** fail the route (FR-4) vs fail the Next.js boot; whether a missing `DATABASE_URL` keeps returning `{ entries: [] }` (`route.ts:52`); where the UI logs (no logger in `src/lib`). The route's existing `catch` returns `err.message` verbatim (`route.ts:81-85`) — the error message must not leak connection-string material.
- **No existing tests:** no unit test covers pool/SSL construction in any of the five services; no UI test touches `pg` or `DATABASE_*`; `e2e/config-ui/audit.spec.ts:39,69,84` mocks the route at the browser layer and never executes `route.ts`. AC-4/7/8 need a vitest test of an extracted helper or of the handler with a mocked `pg`.
- **AC-5 has no harness:** no script or CI job asserts `.do/app*.yaml` env bindings. A new static check (YAML parse, per-component) is needed; per `fails.md` 2026-10-07 inter-service-mtls — config, verify by parsing the spec, not `grep -c`.
- **Test-suite health (P-06):** `252-fix-identity-ledger-test-suites` (implementation-ready) repairs the identity/ledger suites; any new boot test there must be proven to actually execute.
- **File overlap (merge order, non-blocking):** notify `index.ts` and both `.do` specs with `242-fix-push-untargeted-broadcast`; ledger `index.ts` with `248-fix-ledger-trimmed-notify-payload`; `route.ts` with `241-fix-config-audit-author-spoof` (all implementation-ready). Sequence 266 after them or rebase.
- **Ledger traps:** `fails.md` 2026-10-07 inter-service-mtls — assumption: a design-named assertion (e.g. a wrong-CA rejection) that ships narrower must be recorded in the Deviation Log. `fails.md` 2026-08-06 fundamentals-signal-producer — config: categorical inputs (here `sslmode`) are fail-closed from the start — only an explicit `disable` skips verification.
- **Docs to reconcile (teardown):** `DATABASE_CA_CERT` is undocumented in the five services' `CLAUDE.md` Environment Variables sections and absent from `docs/patterns/database.md`; mentioned only at `docs/patterns/inter-service-mtls.md:21`. `services/xstockstrat-identity/docs/operations.md:20` shows a manual `DATABASE_URL='...?sslmode=require'` with no CA — it will now fail to boot.
- **Out of scope, same class:** Go/Python pools (e.g. `services/xstockstrat-ingest/app/main.py:51` `if "sslmode=disable" not in DATABASE_URL`) and the `db-migrator` job — record separately if needed.
- Not found: any shared Node DB-pool/TLS helper; any existing `DATABASE_CA_CERT` log line; the exact migrations directory listing (not needed).

## Recommended Scope

Advisory, for the grilling and `/sdd-spec`:

1. **Shared parse + ssl-option resolver** (decision point: one helper per service vs one shared module): a pure function `(databaseUrl, caCert) → { connectionString, ssl } | throws` with explicit `sslmode` parse, fail-closed on unset CA, `rejectUnauthorized: true` when set. Unit tests (RED first): no sslmode, `require`/`prefer`/`allow`, `disable`, malformed URL.
2. **Wire the four backends:** replace the inline blocks (ledger `:26-39`, config `:25-43`, identity `:24-42`, notify `:25-44`); run the check before `waitForSnapshot`; decide on a boot probe for identity/notify. Wrong-CA test reusing the `mtls.test.ts` openssl fixture.
3. **UI audit route:** `src/lib` helper + vitest for AC-4/7/8; route returns an error status and logs before `getPool()`/any query.
4. **Deploy specs + static check:** add `DATABASE_CA_CERT` to `xstockstrat-ui` in `.do/app.yaml` (after `:658`) and `.do/app.dev.yaml` (after `:660`); add an AC-5 YAML-parse check. Must ship with or before step 3.
5. **Docs:** service `CLAUDE.md` env sections, `docs/patterns/database.md`, `services/xstockstrat-identity/docs/operations.md:20`; teardown audit.
