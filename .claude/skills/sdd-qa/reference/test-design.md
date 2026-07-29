# QA reference — designing a test

Load this whenever `/qa design` runs, alongside exactly one `lang-*.md`.

## Pick the layer first

| What you are testing | Layer |
|---|---|
| A pure function — parsing, formatting, arithmetic, a scoring rule | Unit (`vitest` for `src/lib/**`; Go `_test.go`; pytest; `node:test`) |
| An RPC handler's wiring, a repository query, a client's retry behavior | Integration test in the owning service |
| A user-visible flow — a page renders, a form submits, a nav path works | Playwright spec in the matching `e2e/<segment>/` |

Wrong-layer tests are the main source of slow, flaky suites. A rule that can be checked with a pure
function should never become a Playwright spec, and a BFF call chain can never be checked by vitest
(coverage there is scoped to `src/lib/**` and deliberately excludes `*Bff.ts`).

## The RED assertion is the deliverable

Under **P-06** a code-bearing step proves a failing test *before* the implementation. So every case
you design must name the single assertion that fails today and passes after. Write it explicitly:

> RED: `computeScore({pe: 0})` returns `0`; after the change it returns `null` because a zero
> denominator is undefined, not neutral.

Two failure modes to avoid:

- **A tautology.** `expect(FIXTURE.id).toBe(FIXTURE.id)`, or asserting a struct field round-trips.
  It passes before and after, so it proves nothing.
- **A false red.** A test that fails because the file does not compile, an import is missing, or a
  fixture is absent is *broken*, not red. Fix it, then get a genuine red on the assertion.

If the behavior already exists and no assertion can be made to fail first, that is a
characterization test — label it as such and say `red N/A — no behavior change` explicitly, never
silently (**P-03**; mirrors `tdd-gate.md`'s escape hatch).

## A green suite is not automatically coverage

This is the rule with the most scar tissue behind it. From `docs/roadmap/ledger/fails.md`
(2026-07-29, feature 074): `xstockstrat-config`'s two unit files each wrapped their import in
`try { await import('../x.js') } catch {}` and then early-returned from every case when the import
failed. `pnpm test` printed **"7 tests, 7 pass, 0 skipped"** while executing **zero assertions**.
Three independent real blockers were sitting inside that silent catch. Run against compiled output,
the truth appeared: one case failing on a stale expectation, the other hanging on a live
`ConfigWatcher` that dials and retries.

So:

1. **A skip guard must never be silent.** Assert the import succeeded, or let it throw. A `catch {}`
   that turns a broken suite into a passing one is worse than no test.
2. **Before citing a suite as coverage, confirm the cases execute.** Deliberately break one
   assertion and watch it go red. Exit code 0 is not evidence.
3. **`/qa run` reports *passed* and *passed without asserting* differently.** Where the runner
   exposes an assertion or case count, surface it; where it does not, say so rather than implying
   the suite was verified.

The same trap distorts flake detection: a vacuously-passing suite is perfectly reproducible and
therefore looks maximally stable. `/qa flake` reports assertion counts alongside its verdict for
exactly this reason.

## Test data

Domain data comes from the service's fixture home under **C-12** — see `fixtures.md`. A literal may
stay inline while it has exactly one consumer; the second consumer forces centralization. Scenario
one-offs (error payloads, `{ ...FIXTURE, override }` spreads, reserved sentinel ids) stay inline by
design.

## Scope

Design the cases the request asks for. A coverage gap you notice in passing belongs in
`## Coverage gaps`, and a bug you notice belongs in `## Defects found` — neither expands the test
plan you were asked to produce (**F-08**).
