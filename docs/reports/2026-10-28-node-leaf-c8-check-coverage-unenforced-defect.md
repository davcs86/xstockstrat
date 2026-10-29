# Defect: Node-leaf c8 `--lines 40` is declared but never enforced (no `--check-coverage`)

**Recorded**: 2026-10-28
**Severity**: SEV-3
**Impact type**: test-coverage-gap
**Environment**: dev (main-dev)
**Affected service(s)**: xstockstrat-config, xstockstrat-ledger, xstockstrat-identity, xstockstrat-notify
**Config-only fix possible**: no
**Source**: filed by feature 252 (`fix-identity-ledger-test-suites`) Step 6 teardown

## Observed

Each Node leaf's `test:coverage` script passes `--lines 40` to c8 but never `--check-coverage`, so c8
prints the table and never compares it to the threshold. The CI `node-test` job runs
`pnpm run test:coverage` and never reads `matrix.coverage_threshold`; only the Go and Python jobs do.
A leaf below 40% lines passes CI.

## Expected

CI fails a Node leaf whose line coverage is below 40%.

## Reproduction

1. In one leaf (e.g. `services/xstockstrat-notify`) on a tree whose line coverage is below 40%, run `pnpm run test:coverage` and record the exit code (0).
2. Run `pnpm exec c8 check-coverage --lines 40` right after and record the exit code (non-zero).

## Evidence

`services/xstockstrat-config/package.json:13`
> "test:coverage": "tsc && c8 --reporter=text --reporter=lcov --lines 40 node --test dist/__tests__/*.test.js"

`services/xstockstrat-ledger/package.json:14`, `services/xstockstrat-identity/package.json:13`,
`services/xstockstrat-notify/package.json:13` — the same script, no `--check-coverage`.

`node_modules/.pnpm/c8@10.1.3/node_modules/c8/lib/commands/report.js:43`
> if (argv.checkCoverage) await checkCoverages(argv, report)

`node_modules/.pnpm/c8@10.1.3/node_modules/c8/lib/parse-args.js:85-86`
> .option('check-coverage', {
>   default: false,

`.github/workflows/ci.yml:562-572` — the `node-test` matrix sets `coverage_threshold: 40`, and `:594`
runs `pnpm run test:coverage`; the only reads of `matrix.coverage_threshold` are `:276` (Go) and
`:411` (Python, `--cov-fail-under`).

## Root cause hypothesis

The leaf scripts were copied from one another without `--check-coverage`, and the `node-test` job
was given a `coverage_threshold` matrix value that no step consumes.

## Confidence

high
