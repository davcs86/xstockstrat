# Design: fix-db-tls-fail-closed

**Created**: 2026-10-22
**Rounds**: 2 (full; termination: approved — operator approval at the design gate, Floor clear)
**Approved by**: user @ 2026-10-22 (design gate r2: "APPROVED as synthesized, including both folded-in fixes")
**Grounded in**: recon.md

---

## Chosen Approach

Five byte-identical TLS resolvers, a fail-closed boot on every backend, a fail-closed audit route in the UI, the
missing CA binding on the UI component, and one UI vitest platform guard. No proto, no migration, no config key.

**Consumer surface (C-14):** the config-ui audit view (`/config-ui/api/audit`, `recon.md:45-49`) is the only consumer
surface whose behaviour changes. It now verifies the server certificate and fails at the route level, not at boot.
The four backends change internally: their boot fails closed, and the RPC surface is unchanged.

### 1. Resolver (`dbTls.ts`, five copies)

- **Signature:** `resolveDbConnection(databaseUrl, caCert) → { connectionString, ssl: false | { rejectUnauthorized: true, ca } }`.
- **Files:** `services/xstockstrat-{ledger,config,identity,notify}/src/dbTls.ts` and `services/xstockstrat-ui/src/lib/dbTls.ts`.
  - This follows the per-service `src/mtls.ts` precedent (`recon.md:60`).
  - No shared helper exists today; all five sites inline the same parse (`recon.md:67`).
- **Rules, applied in order:**
  - (a) An empty `DATABASE_URL`, or one where `new URL` throws, raises `db-tls: DATABASE_URL is unset or invalid`.
    The URL is never echoed. This replaces the fail-open `catch { keep original }` (`recon.md:97`).
  - (b) An exact `searchParams.get('sslmode') === 'disable'` returns the URL unchanged with `ssl: false`.
    This preserves the local and CI path (`recon.md:55-56`).
  - (c) **Throw-on-present allow-list.** Any URL key other than `sslmode` that starts with `ssl`, plus
    `uselibpqcompat`, throws. The error names the key, never its value.
  - (d) An empty `caCert` throws `db-tls: DATABASE_CA_CERT is required for a TLS database connection (fail-closed); set it or use sslmode=disable`.
  - (e) Otherwise, delete `sslmode` and return `{ rejectUnauthorized: true, ca }`.
- **File constraints:**
  - Erasable TypeScript only (no enums, no parameter properties). Ledger and identity run under
    `--experimental-strip-types` (`recon.md:27,38`).
  - Zero imports.
  - Must be valid under both CJS `tsc` (config and notify, `recon.md:32,44`) and the Next bundler.
- **P-03 gate:** `/sdd-spec` reads `node_modules/pg/lib/connection-parameters.js` and `pg-connection-string` after
  `pnpm install`, and records in `context.md` how pg merges URL parameters with the `ssl` option. The design is safe
  under either precedence, because no `ssl*` key survives in the URL.
- **Identical test table** in every `src/__tests__/dbTls.test.ts`:
  - `require`, a missing `sslmode` and `verify-full`, each with a CA: the output contains no `ssl*` or
    `uselibpqcompat` key.
  - `?ssl=0`, `?sslrootcert=/x` and `?uselibpqcompat=true`: each throws.
  - `disabled` without a CA: throws.
  - `disable`: returns `ssl: false`.
  - A malformed URL: throws, and the message does not contain the password.

### 2. Backend wiring

- **Call placement:** the resolver is the first statement of `main()`, before `waitForSnapshot` (ledger `:23`,
  identity `:21`, notify `:22`; `recon.md:22,34,40,96`). A missing CA therefore never waits 90 s for config.
- **Exit path:** a throw reaches the existing `main().catch → process.exit(1)` (ledger `:85-88`, config `:79`,
  identity `:72`, notify `:70`; `recon.md:61`).
- **Ledger:** passes the resolved `ssl` to `Pool` (`:40`) and to the `EventNotifier` `Client` (`:51`)
  (`recon.md:22-23`). The export cursor inherits it from the pool options (`ledgerServiceImpl.ts:338-339`,
  `recon.md:24`), so the resolved object must stay on those options.
- **Config:** replaces its inline `includes('sslmode=disable')` (`:25`) and `rejectUnauthorized: !!caCert` (`:40`)
  (`recon.md:30`).
- **Identity and notify:** add a boot `SELECT 1` before `bindAsync`, inside the existing pool `max` (F-06). Today
  both pools are lazy (`recon.md:36,42,95`).
- **mTLS/DB check order (decide at `/sdd-spec`):** today ledger, identity and notify hit the `MTLS_*` throw first,
  in the `ConfigWatcher` constructor. The spec must pick one option and record it in `context.md`:
  - record the new order as deliberate, or
  - check both env sets up front and throw one combined error.

  Both options stay fail-closed, so `@AC-4 @feature-210` holds either way.

### 3. AC-2 coverage (wrong CA)

- **Config:** AC-2 is tested end to end through `main()`. This works because config has no `waitForSnapshot`
  (`recon.md:29`).
  - Spawn config with `CONFIG_SECRETS_ENCRYPTION_KEY` set, `DATABASE_CA_CERT` set to a wrong CA, and a
    fake-Postgres TLS stub as the database.
  - Assert a non-zero exit and a specific verification error.
  - Add a positive control that uses the correct CA.
  - The openssl throwaway-CA fixture is the one used by `mtls.test.ts` (`recon.md:63`). No Deviation is needed for config.
- **Ledger, identity and notify:** a Pool-level stub test asserts `UNABLE_TO_VERIFY_LEAF_SIGNATURE` or
  `SELF_SIGNED_CERT_IN_CHAIN`, with a positive control. A static wiring assertion closes the gap between this test
  and the real boot path (item 5c).
- The narrower AC-2 coverage for these three services goes in the Deviation Log.

### 4. Boot tests (AC-1, AC-6)

- One child-process test per backend.
- **How each backend is spawned:**
  - Ledger and identity: `--experimental-strip-types src/index.ts`.
  - Config and notify: `dist/index.js`, after `tsc`.
- **Environment:** `DATABASE_CA_CERT` unset and a `sslmode=require` URL.
- **Assertions:** a non-zero exit, and stderr containing `DATABASE_CA_CERT`.
- If the combined-check option in item 2 is chosen, set `MTLS_*` in the env so the stderr assertion stays specific.

### 5. CI and guards (C-15, C-18)

One UI vitest file, documented as a platform check housed in the UI suite. It does three things:

- **(a) AC-5 check.** It parses both `.do` specs with a YAML parser and asserts that every direct-DB component binds
  `DATABASE_CA_CERT`.
  - This follows the parse-not-grep lesson in `fails.md` (`recon.md:100`).
  - `yaml` becomes a UI devDependency, with a `pnpm-lock.yaml` update.
  - A fixture row proves the check fails when the UI `DATABASE_CA_CERT` binding is removed.
- **(b) Copy guard.** It compares the SHA-256 of the five `dbTls.ts` files.
- **(c) Wiring assertion.** No `rejectUnauthorized` and no `includes('sslmode` may appear anywhere outside
  `dbTls.ts` in the five services' `src/`. Every backend `index.ts` and the UI `route.ts` must import
  `resolveDbConnection`.

Supporting changes:

- **Path filter.** Add `'.do/**'` to the `xstockstrat-ui` paths filter (`.github/workflows/ci.yml:62`). Today the
  filter block at `ci.yml:39-66` has no `.do` entry, so a PR that changes only `.do/**` skips the guard.
  - The `node-test` matrix runs all five Node services whenever any of their filters matches (`ci.yml:537-564`).
  - So a backend-only `dbTls.ts` edit already runs the UI vitest.
- **DRY exception.** Add one entry to `docs/patterns/dry-guard-rail.md`.
  - It names exactly the five `dbTls.ts` files and the four `mtls.ts` copies, and names the hash guard as the
    enforcement.
  - It must not read as general permission to copy security code.
  - jscpd blocks only within `services/xstockstrat-ui/src` (`.husky/pre-commit:10-13`). The backend copies fall
    under the report-only scan (`.husky/pre-commit:18`).

### 6. UI audit route

File: `services/xstockstrat-ui/src/app/config-ui/api/audit/route.ts` (`recon.md:45-48`).

- **Order:** 401 → 403 → `!DATABASE_URL → { entries: [] }` → resolver → pool. The pool is cached only after a
  successful resolve.
- **Failure log:** on failure, `console.error` writes three things:
  - the inbound trace id, read via `HEADER_TRACE_ID` (`src/lib/headers.ts:7`), never a raw literal;
  - `err.code`;
  - `err.message`.

  The whole pg error object is never logged. No `src/lib` logger exists (`recon.md:49`).
- **Client response:** a generic 500 body. The current body echoes `err.message` (`recon.md:98`), and the generic
  body removes that leak.
- **Tests:** `e2e/config-ui/audit.spec.ts:70,75` still passes (`recon.md:65`). UI AC-7 is tested with a mocked `pg`,
  and this goes in the Deviation Log.

### 7. Deploy specs

- Add `DATABASE_CA_CERT: ${xstockstrat.CA_CERT}` to the UI block, copied verbatim from `.do/app.yaml:434-436`:
  - `.do/app.yaml`, after `:658`;
  - `.do/app.dev.yaml`, after `:660`.

  Recon location: `recon.md:51-52,66`.
- The change only adds lines. No `deploy.yml` substitution is needed (`recon.md:53`).
- The deploy-spec change ships with or before the route change (`recon.md:94`).

### 8. Canary

- The UI route is the only deployed component whose behaviour definitely changes. The four backends already evaluate
  `rejectUnauthorized: !!caCert` to true, unless the `${xstockstrat.CA_CERT}` binding expands to an empty string.
- Ship a value-free log line: `log.info('db-tls: verifying server cert against DATABASE_CA_CERT')`.
- Before the backend change merges, confirm on running dev backends that the CA binding is non-empty and verifies.
  Use the verification log or `openssl s_client -starttls postgres -CAfile`.
- Rollout order: first the UI route and the `.do` change, then the backends.

### 9. Docs and teardown

- **Service docs:** the five services' `CLAUDE.md` env sections must state two things:
  - the `sslmode=disable` carve-out applies to the DB URL only;
  - identity and notify now need the DB in order to boot.
- **Other docs:**
  - `docs/patterns/database.md`;
  - `services/xstockstrat-identity/docs/operations.md:20` (`recon.md:104`);
  - `docs/setup/digitalocean.md:555`.
- **Teardown:** the context-constitution refresh (`fails.md:670`).

**Trace ids (operator standing decision 2026-10-21):** the UI failure log carries the inbound trace id. Boot failures
have no originating request, so they carry none.

## Rejected Alternatives

- **Shared workspace package (`packages/node-db-tls`)** — rejected. It would give one source and no hash guard, but:
  - the UI Dockerfile copies only the proto gen and the UI tree (`Dockerfile:11-19`);
  - the backends use `pnpm deploy`;
  - it would touch five Dockerfiles plus `docker-build.md` for a function of about 20 lines;
  - D-20 is out of scope.
- **Strip every `ssl*` URL key instead of throwing** — rejected. It silently discards operator intent such as
  `sslrootcert` while reporting that verification is on (`fails.md:600-603`). No live URL carries such keys
  (`.do/app.yaml:433,480,527,585,658`; `docker-compose.yml:27`).
- **Strip only `sslmode` (r1)** — rejected. `ssl=0`, `sslrootcert` and similar keys could still override verification.
- **Substring match on `disable`** — rejected. It lets `sslmode=disabled` opt out.
- **Keep catch-and-keep-original on an unparseable URL** — rejected. It is fail-open (ledger `index.ts:33`,
  `route.ts:19-21`).
- **AC-5 and hash checks in `scripts/workflow-tests/*.test.mjs` (`node --test`)** — rejected.
  - The context-map job is gated on its own filter (`ci.yml:713-715`), so it would need the same `.do` fix.
  - It has no YAML parser.
- **DB probe before `waitForSnapshot` in ledger/identity/notify, so AC-2 could be tested via `main()`** — rejected.
  It changes the boot order and holds a DB connection through the 90 s config wait.
- **Keep the config AC-2 Deviation** — rejected. Config's `main()` has no `waitForSnapshot` and can be spawned
  against the TLS stub.
- **grep-based `.do` spec check** — rejected (`fails.md:2836`).
- **Fail the Next.js boot instead of the audit route** — rejected. One admin route would take down all three UI
  segments, and FR-4 asks for a route-level failure.
- **Validate after `waitForSnapshot`** — rejected. A missing CA would surface only after 90 s.
- **Leave identity and notify without a boot probe** — rejected. A wrong CA would surface only on the first query.

## Open Risks

- [ ] **Empty CA binding.** If `${xstockstrat.CA_CERT}` expands to an empty string in any environment, the backends
  are silently unverified today, and 266 takes ledger, config, identity and notify down together. With config down,
  every other service blocks at `waitForSnapshot`.
  - Mitigation: the pre-merge dev canary (item 8).
  - Address at: the rollout / backend-wiring PR.
- [ ] **UI route breakage.** The UI route is the only deployed component that is newly verifying. A hostname or SAN
  mismatch there breaks `/config-ui/api/audit`.
  - Address at: the UI route step and canary.
- [ ] **pg merge precedence is unverified** (no `node_modules` at design time). The spec must cite the pg source.
  - Address at: `/sdd-spec` (P-03 gate).
- [ ] **DATABASE_URL format.** The `${xstockstrat.DATABASE_URL}` expansion is assumed to carry only
  `sslmode=require`. If it carries another `ssl*` key, throw-on-present crash-loops the backends.
  - Address at: the dev canary, before the backend merge.
- [ ] **Identity and notify crash-loop when the DB is down.** This is new operational behaviour. At the spec gate,
  present the sign-off as covering runtime behaviour only (FR-2 exit-at-boot). If the operator refuses, the Deviation
  covers only that clause for those two services.
  - Address at: the `/sdd-spec` gate.
- [ ] **Build risk from byte-identical copies.** The copies run under three module and runtime regimes
  (strip-types, CJS `tsc`, the Next bundler). The hash guard catches drift, but not a copy that fails to build in one
  service.
  - Address at: the resolver step, by building all five services.
- [ ] **mTLS/DB check order.** Choose between recording the reorder and throwing one combined error.
  - Address at: `/sdd-spec` (backend wiring step).
- [ ] **Merge-order overlap.**
  - Notify `index.ts` and both `.do` specs overlap with 242.
  - Ledger `index.ts` overlaps with 248.
  - `route.ts` overlaps with 241.
  - The `ci.yml` filter edit may conflict with peer features.
  - Address at: rebase before the integration PR.
- [ ] **New identity and ledger tests depend on feature 252** making those suites run (P-06).
  - Address at: the test steps; prove they execute.
- [ ] **Deviation Log entries.** Record the narrowed AC-2 (ledger, identity and notify at Pool level plus the static
  wiring check) and the UI AC-7 with mocked `pg`.
  - Address at: the corresponding test steps.

## Constitution Rules Touched

- `C-03` — honored by: the operator standing decision. The UI failure log carries the inbound trace id via
  `HEADER_TRACE_ID`. No fresh context is minted for request-derived work. Boot paths have no originating request.
- `C-08` — honored by: the security-sensitive change is scoped to D-32, and the reviewers include Security on all steps.
- `C-11` — honored by: a full-mode debate (2 rounds) and operator approval at the design gate on 2026-10-22.
- `C-15` — honored by: every AC has an executable test.
  - AC-5 has the YAML-parse vitest, with the `.do/**` CI filter and a negative fixture row.
  - AC-2 has the config `main()` test, plus Pool-level tests and the static wiring check.
  - Narrowed coverage goes in the Deviation Log.
- `C-16` — honored by: the Business Rules section below. Every CHANGE line traces to an operator decision.
- `C-18` — honored by: the SHA-256 hash guard over the five copies and a narrowly scoped `dry-guard-rail.md` exception.
- `F-06` — honored: the identity and notify boot probe runs inside the existing pool `max`. There is no new connection
  budget.
- `F-07` — honored: `DATABASE_CA_CERT` stays a boot-time env var and is not a WatchConfig key (`recon.md:88`).
- `P-02` — honored by: the proposer and adversary exchanges were mediated through the synthesized state.
- `P-03` — honored by: the pg merge-precedence source read is pinned as a `/sdd-spec` gate. Nothing about it is assumed.
- `P-06` — honored by: the new identity and ledger tests must be proven to execute (dependency on 252).

## Business Rules Touched (C-16)

- CHANGE `@AC-1` (266 — backend refuses to boot without `DATABASE_CA_CERT` on a TLS URL)
  - Altered guarantee: an unset CA was a silent downgrade and is now a boot failure.
  - Signed off: the operator scope decision "Scope is D-32" (2026-10-21), confirmed at the design gate on 2026-10-22
    (`context.md`).
- CHANGE `@AC-2` (266 — wrong CA is rejected)
  - Signed off: the D-32 scope decision (2026-10-21) and design-gate r2 approval on 2026-10-22, which includes the
    per-service wiring proof (`context.md`).
- PRESERVE `@AC-3` (266 — `sslmode=disable` connects without a CA)
  - Not regressed by: resolver rule (b) and the `disable` test row.
- CHANGE `@AC-4` (266 — the UI audit route fails closed without a CA)
  - Signed off: the D-32 scope decision (2026-10-21) and the design gate on 2026-10-22 (`context.md`).
- EXTEND `@AC-5` (266 — every direct-DB component binds `DATABASE_CA_CERT` in both `.do` specs)
  - New case: a negative fixture row, and the `.do/**` CI filter, so the check also runs on `.do`-only PRs.
  - Signed off: design-gate r2 on 2026-10-22 (`context.md`).
- CHANGE `@AC-6` (266 — the boot error names the variable)
  - Signed off: the D-32 scope decision (2026-10-21) and the design gate on 2026-10-22 (`context.md`).
- CHANGE `@AC-7` (266 — the audit route rejects a cert not signed by the configured CA)
  - Signed off: the D-32 scope decision (2026-10-21) and the design gate on 2026-10-22 (`context.md`).
- PRESERVE `@AC-8` (266 — the audit route reads with `sslmode=disable` and no CA)
  - Not regressed by: resolver rule (b), and the route order keeps `!DATABASE_URL → { entries: [] }`.
- PRESERVE `@AC-4 @FR-4 @feature-210` "mTLS is enforced identically in every environment; verification cannot be
  disabled" (`docs/sdd/business-rules/platform.feature:230,235`)
  - Not regressed by: the `sslmode=disable` carve-out applies to the DB URL only and is documented as such. The
    `MTLS_*` gate stays fail-closed under either check-order option.
- PRESERVE `@AC-8 @FR-7 @feature-147` "MCP_AGENT_SECRET is absent from the codebase and deploy surfaces"
  (`docs/sdd/business-rules/platform.feature:11-12`)
  - Not regressed by: the `.do` diff adds only `DATABASE_CA_CERT` lines (`recon.md:72`).
- PRESERVE the remaining recon rules (`recon.md:73-81`) — not regressed, because:
  - the feature-175 type surface still builds under `tsc`, and no `propagation.ts` is reintroduced;
  - the feature-021 ledger export path is unchanged under verified TLS;
  - the feature-147 config secret paths are unchanged;
  - the identity and ledger audit writes are unchanged.
