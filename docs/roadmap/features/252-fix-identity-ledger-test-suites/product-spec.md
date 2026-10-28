# Product Spec: fix-identity-ledger-test-suites

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-20-node-impl-test-suites-never-load-impl-defect.md`
**Severity**: SEV-3
**Created**: 2026-10-20

---

## Problem Statement

**Observed.** `services/xstockstrat-identity/package.json:12-13` and `services/xstockstrat-ledger/package.json:13-14`
run `node --experimental-strip-types --test src/__tests__/*.test.ts` (CI `node-test` runs `pnpm run test:coverage`,
`.github/workflows/ci.yml:584`). The impl test files load their subject in a `before()` hook with
`await import('../grpc/identityServiceImpl.js')` (`identityServiceImpl.test.ts:30`),
`await import('../grpc/ledgerServiceImpl.js')` (`ledgerServiceImpl.test.ts:23`) and
`await import('../services/eventNotifier.js')` (`eventNotifier.test.ts:18`), catch any failure ("tests will be
skipped", `identityServiceImpl.test.ts:37-38`), and then early-return (`if (!impl) return;` — 65 guards in identity,
31 + 7 = 38 in ledger). The import fails twice over: the `.js` path does not exist (`ERR_MODULE_NOT_FOUND`), and the `.ts`
cannot load in strip-only mode because the constructors use parameter properties (`identityServiceImpl.ts:105-106`,
`ledgerServiceImpl.ts:20-21`; `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`) and import siblings without extensions. Every
impl test passes vacuously; the c8 `--lines 40` gate measures only the files that load (mtls, telemetry). authz's tests
(`identityServiceImpl.test.ts:646`) sit behind the same failed import (`:30-36`), so authz never loads either.

**Expected.** The identity and ledger suites load and exercise the real implementation in CI and locally, and a test
whose subject fails to load fails the run instead of passing. config and notify already do this
(`"test": "tsc && node --test dist/__tests__/*.test.js"`, `services/xstockstrat-config/package.json:12`).

**Who is affected.** Platform developers, reviewers and the identity/ledger service owners who rely on the CI
`node-test` gate (`.github/workflows/ci.yml:582-584`) to catch impl regressions.

## Reproduction Steps

1. `cd services/xstockstrat-identity && pnpm test` → `# pass 74 # fail 0`.
2. `node --experimental-strip-types -e "import('./src/grpc/identityServiceImpl.js').catch(e=>console.log(e.code))"`
   → `ERR_MODULE_NOT_FOUND`; with `.ts` → `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`.
3. Compile the suite with `tsc` and run `node --test` on the output: the impl tests execute (on the hotfix #1262
   branch the pre-fix rotation code fails 5 of them). On main-dev, deleting the `refreshOAuthToken` revoke
   (`identityServiceImpl.ts:524-527`) fails the compiled `rotates the refresh token…` test
   (`identityServiceImpl.test.ts:403`) but not `pnpm test`.
4. Same for `services/xstockstrat-ledger` (`ledgerServiceImpl`, `eventNotifier`).

## Root Cause Hypothesis

The suites were written for a TypeScript runtime and guarded with "skip if the import fails" to survive strip-only
mode; the guard turned a hard failure into a silent pass. config and notify moved to compile-then-test; identity and
ledger never did.

## Affected Services

- xstockstrat-identity (test tooling only)
- xstockstrat-ledger (test tooling only)

Test tooling = `package.json` test scripts and c8 scope, test files, and whatever the chosen runner needs: a test-build
tsconfig (`tsconfig.json:19-23` in both services excludes `src/**/*.test.ts`), a loader devDependency plus
`pnpm-lock.yaml`, and the `.ts`-extension imports in the non-impl tests (`mtls.test.ts:13`, `telemetry.test.ts:3`,
`telemetry.export.test.ts:9`, both services), which do not survive `tsc`. `/sdd-design` picks the runner and so the
exact file set, including whether the production `tsc` output may gain compiled tests (config's does:
`services/xstockstrat-config/tsconfig.json:14-15` has no test exclusion).

## Functional Requirements

FR-1. The identity suite loads the real `IdentityServiceImpl` (and `authz`) and its impl tests execute their assertions.
FR-2. The ledger suite loads the real `LedgerServiceImpl` and `EventNotifier` and their impl tests execute their assertions.
FR-3. A test file whose subject module cannot be imported fails the run (non-zero exit), never passes.
FR-4. The c8 `--lines 40` gate measures the impl modules and still passes.
FR-5. Every existing test passes once it executes; a test that fails for real is a pre-existing defect to fix or record
in `context.md`, never deleted, skipped or weakened.

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated
- [x] No CI workflow change: `node-test` keeps running `pnpm run test:coverage` (`.github/workflows/ci.yml:584`); only
  the per-service script and c8 scope change

## Consumer Surface(s)

None — internal/platform-only: unit-test runner and coverage config for identity and ledger; no runtime behavior change.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass after the fix
(Constitution **C-15**): AC-1 (FR-1), AC-2 (FR-2), AC-3 (FR-3), AC-4 (FR-4). AC-5 (FR-5) is a guard, not
`@regression`: it passes vacuously on the buggy code.

No ordering dependency on hotfix #1262: AC-1's mutation check targets `refreshOAuthToken`, present on main-dev.
`refreshToken` (`identityServiceImpl.ts:251-255`) has no test on main-dev; #1262's rotation tests must also execute
once both are on the base (whichever lands second merges the other's test changes).

## Out of Scope

- Rewriting test content beyond what loading the real impl requires (removing the `if (!x) return` guards, making the
  subject import fail hard, and the import/ESM-shim edits the chosen runner needs are in scope)
- Changing config or notify test setups (already correct)
- Other services' test runners
