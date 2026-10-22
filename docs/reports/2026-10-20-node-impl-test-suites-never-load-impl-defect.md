# Defect: identity and ledger unit suites never load the service implementation, so their impl tests pass without running

**Recorded**: 2026-10-20
**Severity**: SEV-3
**Impact type**: test-coverage-gap
**Environment**: dev (main-dev) @ 4535695
**Affected service(s)**: xstockstrat-identity, xstockstrat-ledger
**Config-only fix possible**: no
**Source**: found while red/green-proving hotfix #1262 (`hotfix/fix-refresh-token-rotation`); config and notify checked and unaffected

## Observed

`pnpm test` and the CI `node-test` job (`pnpm run test:coverage`) for identity and ledger run
`node --experimental-strip-types --test src/__tests__/*.test.ts`. The impl test files load their
subject with a lazy `await import('../grpc/<impl>.js')` in a `before()` hook, catch any failure, and
every test then early-returns (`if (!impl) return;`). That import fails for two independent reasons:

1. **The path doesn't exist.** `src/grpc/identityServiceImpl.js` is not on disk; only the `.ts` source is (`ERR_MODULE_NOT_FOUND`).
2. **Even the `.ts` can't load in strip-only mode.** The constructors use TypeScript parameter properties (`private readonly pool: Pool`), which strip-only mode rejects (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`). The impls also import siblings without a file extension.

As a result, every impl-level test passes vacuously: identity has 65 early-return guards and ledger has 38 (31 + 7). The c8 `--lines 40` gate measures only the files that do load (`authz`, `mtls`, `telemetry`), so it passes too.

Proof:
- `pnpm test` stays green against code that is known to be broken. Identity showed 78/78 against the pre-#1262 rotation race, while the new rotation tests fail 5/70 when the suite is compiled with `tsc` and run against the real impl.
- In both services, compiling the suite with `tsc` and running `node --test dist/...` executes the impl tests, and they pass on current main-dev.

config and notify are unaffected: their `test` script is `tsc && node --test dist/__tests__/*.test.js`.

## Expected

The suites load the real implementation in CI and locally, and a test that cannot reach its subject fails rather than passing. Concretely:
- Align the identity and ledger `test`/`test:coverage` scripts with config and notify (`tsc` to `dist/`, then `node --test dist/__tests__/*.test.js`, with `c8` over `dist`), or use a TypeScript loader.
- Make an import failure fail the suite instead of skipping it.

## Reproduction

1. `cd services/xstockstrat-identity && pnpm test` reports `# pass 74 # fail 0`.
2. `node --experimental-strip-types -e "import('./src/grpc/identityServiceImpl.js').catch(e=>console.log(e.code))"` prints `ERR_MODULE_NOT_FOUND`, and the same import with `.ts` prints `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`.
3. `npx tsc --outDir dist/_t --rootDir src src/__tests__/identityServiceImpl.test.ts src/grpc/identityServiceImpl.ts --module commonjs --target ES2022 --esModuleInterop --skipLibCheck && node --test dist/_t/__tests__/identityServiceImpl.test.js` runs the impl tests for real (on the #1262 branch, the old code fails 5 of them).
4. Steps 1–3 behave the same in `services/xstockstrat-ledger` with `ledgerServiceImpl` and `eventNotifier`.

## Evidence

`services/xstockstrat-identity/package.json:12-13` (ledger `package.json:13-14` is identical)
> "test": "node --experimental-strip-types --test src/__tests__/*.test.ts",
> "test:coverage": "c8 --reporter=text --reporter=lcov --lines 40 node --experimental-strip-types --test src/__tests__/*.test.ts",

`services/xstockstrat-identity/src/__tests__/identityServiceImpl.test.ts:30` and `:37-38`
> const mod = await import('../grpc/identityServiceImpl.js');
> } catch {
>   // Unsupported TypeScript syntax in strip-only mode — tests will be skipped.

`services/xstockstrat-identity/src/__tests__/identityServiceImpl.test.ts:82`
> if (!impl) return;

`services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:105-106`
> constructor(
>   private readonly pool: Pool,

`services/xstockstrat-ledger/src/__tests__/ledgerServiceImpl.test.ts:23`, `eventNotifier.test.ts:18`
> const mod = await import('../grpc/ledgerServiceImpl.js');
> const mod = await import('../services/eventNotifier.js');

`services/xstockstrat-config/package.json:12` (unaffected, for comparison)
> "test": "tsc && node --test dist/__tests__/*.test.js",

`.github/workflows/ci.yml:584` (the `node-test` matrix includes identity and ledger)
> run: pnpm run test:coverage

## Root cause hypothesis

The suites were written for a TypeScript runtime and given a "skip if the import fails" guard so they wouldn't crash under strip-only mode. The guard turned a hard failure into a silent pass. config and notify moved to compile-then-test; identity and ledger never did.

## Confidence

high
