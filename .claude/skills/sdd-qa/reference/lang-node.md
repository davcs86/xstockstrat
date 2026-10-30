# QA reference — Node

Services: `xstockstrat-ledger`, `xstockstrat-identity`, `xstockstrat-notify`,
`xstockstrat-config`. Load this file only when the target is one of them.

## Layout

Node's built-in `node:test` (`describe`/`it`), no Jest or Vitest. Tests live in
`src/__tests__/<name>.test.ts`. Coverage via `c8 --lines 40` — declared, not enforced: no script passes `--check-coverage` (see § Commands).

## One runner — compile first

All four services compile and test the build output:

```bash
pnpm --filter xstockstrat-<svc> run test
#   tsc && node --test dist/__tests__/*.test.js
```

That is the fix for the incident in `docs/roadmap/ledger/fails.md` (2026-07-29, feature 074): under
`--experimental-strip-types`, a TS **parameter property** (`constructor(private readonly pool)`) fails
to compile, a `.js` specifier for a `.ts` source raises `ERR_MODULE_NOT_FOUND`, and extensionless
relative imports break once the file is reparsed as ESM. Config and notify ran compiled first;
identity and ledger followed in feature 252. Tests are in the `tsc` program, so a `.ts`-suffixed
import (TS5097, `fails.md` 2026-09-09, feature 171) or `import.meta` in a test breaks `pnpm build`.

## The two traps

**1. The glob is not recursive.** `dist/__tests__/*.test.js` matches one directory level only. A test
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
pnpm --filter xstockstrat-<svc> exec c8 check-coverage --lines 40   # right after test:coverage — the only enforcing check
pnpm --filter xstockstrat-<svc> run lint
```

40% lines is declared for all four but not enforced by CI; check it with the `check-coverage` line above.
Follow-up: `docs/reports/2026-10-28-node-leaf-c8-check-coverage-unenforced-defect.md`. `docs/patterns/ci-overview.md`
is the reference.
