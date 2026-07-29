# QA reference — frontend (`xstockstrat-ui`)

Two suites with a deliberate split: **vitest** for pure logic, **Playwright** for anything touching
routing, the BFF, or the DOM. Component/jsdom testing is intentionally out of scope — pick one of
these two layers, never introduce a third.

## vitest — pure logic only

`vitest.config.ts`: node environment, `include: ['src/**/*.test.ts']`. Three files exist today, all
under `src/lib/` (`protoTime`, `scoreDisplay`, `equityCurve`). Style is `it.each([...])` table cases
with plain `expect(fn(x)).toBe(y)`; small local factory helpers (`bar()`, `trade()`) build minimal
proto-shaped objects. The vitest layer does **not** import the `e2e/fixtures/` barrel.

```bash
pnpm --filter xstockstrat-ui run test:unit          # vitest run
pnpm --filter xstockstrat-ui run test:coverage      # vitest run --coverage
```

**Coverage trap.** Coverage is scoped `include: ['src/lib/**']` with `all: false` and excludes
`src/lib/*Bff.ts`, `connectClients.ts`, `identity.ts`. `all: false` means **only files an executed
test actually touches** are counted — so adding a test can *lower* the percentage by pulling a
poorly-covered file into the denominator. Read `vitest.config.ts` before promising a delta.

## Playwright — everything user-visible

23 specs under `e2e/{trader,insights,config-ui,accounts}/` plus `e2e/auth.spec.ts`. Two mocking
layers, and you must pick the right one:

- **Shared defaults** — `e2e/mock-backend.ts` runs three Connect-RPC servers (ports 9091/9092/9093,
  one per UI segment) registering handlers for every backend service. `playwright.config.ts`'s
  `webServer.env` points the BFF's `*_ENDPOINT` vars at them.
- **Per-test overrides** — `page.route(...).fulfill({ body: JSON.stringify(...) })` in the spec.
  Bodies are Connect-JSON: **camelCase field names matching the proto message.**

Auth comes from `e2e/helpers/auth.ts` (`addAuthCookie`) — never hand-roll a `SignJWT` in a spec.
Domain data comes from `e2e/fixtures/` per **C-12**; scenario one-offs stay inline as
`{ ...FIXTURE, field: value }` spreads.

```bash
pnpm --filter xstockstrat-ui exec playwright test <spec>       # one spec
pnpm --filter xstockstrat-ui exec playwright test              # full suite (slow — 23 specs)
pnpm --filter xstockstrat-ui exec tsc --noEmit                 # typecheck gate
```

**Adding a route?** Register it in `ROUTES` in `e2e/warmup.setup.ts`. The `setup` project pre-warms
every route so SSR/JIT compilation does not surface as a first-hit timeout. An unregistered new route
is a reliable source of flake.

CI runs **chromium only**, sharded 2×, `retries: 1`, `maxFailures: 10`. Firefox runs locally only —
the suite tests BFF call chains and React logic, not browser-specific rendering.

## Reserved sentinels

`e2e/fixtures/INVENTORY.md` § sentinels lists magic ids that `mock-backend.ts` pattern-matches to
trigger specific branches (e.g. `strat-formula-error-001` → `RunBacktest` returns
`NO_TRADE_REASON_FORMULA_ERROR`). Check that table before inventing an id — reusing one for a
different meaning silently changes another spec's scenario.

## Flake notes

`retries: 1` in CI means a flaky spec passes on retry and leaves no trace in the run summary. The
`json` reporter is what `/qa flake` reads to see per-attempt results; without it there is only the
HTML artifact, which expires in 7 days and is gitignored locally.
