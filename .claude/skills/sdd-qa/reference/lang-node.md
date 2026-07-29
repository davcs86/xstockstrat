# QA reference — Node

Services: `xstockstrat-ledger`, `xstockstrat-identity`, `xstockstrat-notify`,
`xstockstrat-config`. Load this file only when the target is one of them.

## Layout

Node's built-in `node:test` (`describe`/`it`), no Jest or Vitest. Tests live in
`src/__tests__/<name>.test.ts`. Coverage via `c8 --lines 40`.

## Two different runners — check which one the service uses

Three services strip types and run TypeScript directly:

```bash
pnpm --filter xstockstrat-<ledger|identity|notify> run test
#   node --experimental-strip-types --test src/__tests__/*.test.ts
```

**`xstockstrat-config` compiles first and tests the build output:**

```bash
pnpm --filter xstockstrat-config run test
#   tsc && node --test dist/__tests__/*.test.js
```

That difference is not cosmetic. It is the fix for the incident in `docs/roadmap/ledger/fails.md`
(2026-07-29, feature 074): under `--experimental-strip-types`, a TS **parameter property**
(`constructor(private readonly pool)`) fails to compile, a `.js` specifier for a `.ts` source raises
`ERR_MODULE_NOT_FOUND`, and extensionless relative imports break once the file is reparsed as ESM.
When adding a test to a strip-types service, keep it clear of those three constructs — or expect the
same class of failure.

## The two traps

**1. The glob is not recursive.** `src/__tests__/*.test.ts` matches one directory level only. A test
placed in `src/__tests__/sub/thing.test.ts` is **silently never run** — no error, no skip, just
absent from the count. Keep new tests flat, or change the script.

**2. A passing suite may be asserting nothing.** This is the 074 incident itself: both config test
files wrapped their import in `try { await import('../x.js') } catch {}` and early-returned from
every case. `pnpm test` printed "7 tests, 7 pass, 0 skipped" while executing zero assertions, hiding
three real blockers. Run against compiled output and the truth appeared — one case failing, the
other hanging on a live `ConfigWatcher` that dials and retries.

So: a skip guard must assert the import succeeded or let it throw, never swallow. Before citing any
Node suite as coverage, confirm the cases *execute* — deliberately break one assertion and watch it
go red. An exit code of 0 is not evidence.

## Commands

```bash
pnpm --filter xstockstrat-<svc> run test
pnpm --filter xstockstrat-<svc> run test:coverage   # c8 --reporter=text --lines 40 …
pnpm --filter xstockstrat-<svc> run lint
```

Threshold is 40% lines for all four; `docs/patterns/ci-overview.md` is the reference.
