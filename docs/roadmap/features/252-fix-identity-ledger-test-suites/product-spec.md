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
38 in ledger). The import fails twice over: the `.js` path does not exist (`ERR_MODULE_NOT_FOUND`), and the `.ts`
cannot load in strip-only mode because the constructors use parameter properties (`identityServiceImpl.ts:105-106`,
`ledgerServiceImpl.ts:20-21`; `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`) and import siblings without extensions. Every
impl test passes vacuously; the c8 `--lines 40` gate measures only the files that load (authz, mtls, telemetry).

**Expected.** The identity and ledger suites load and exercise the real implementation in CI and locally, and a test
whose subject fails to load fails the run instead of passing. config and notify already do this
(`"test": "tsc && node --test dist/__tests__/*.test.js"`, `services/xstockstrat-config/package.json:12`).

## Reproduction Steps

1. `cd services/xstockstrat-identity && pnpm test` → `# pass 74 # fail 0`.
2. `node --experimental-strip-types -e "import('./src/grpc/identityServiceImpl.js').catch(e=>console.log(e.code))"`
   → `ERR_MODULE_NOT_FOUND`; with `.ts` → `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`.
3. Compile the suite with `tsc` and run `node --test` on the output: the impl tests execute (on the hotfix #1262
   branch the pre-fix rotation code fails 5 of them).
4. Same for `services/xstockstrat-ledger` (`ledgerServiceImpl`, `eventNotifier`).

## Root Cause Hypothesis

The suites were written for a TypeScript runtime and guarded with "skip if the import fails" to survive strip-only
mode; the guard turned a hard failure into a silent pass. config and notify moved to compile-then-test; identity and
ledger never did.

## Affected Services

- xstockstrat-identity (test scripts + test files only)
- xstockstrat-ledger (test scripts + test files only)

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated
- [ ] CI change possible: `node-test` keeps running `pnpm run test:coverage`; the per-service script and c8 scope change

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass after the fix
(Constitution **C-15**). Plus: existing tests pass once they actually execute (any test that fails when run for real is
a pre-existing defect to fix or record, never to delete or skip); the c8 `--lines 40` gate still passes over the
loaded impl files.

## Out of Scope

- Rewriting test content beyond what loading the real impl requires
- Changing config or notify test setups (already correct)
- Other services' test runners
