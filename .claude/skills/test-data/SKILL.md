---
name: test-data
description: Maintain the frontend test-data inventory — add or update canonical mocked/dummy fixtures, keep e2e/fixtures/INVENTORY.md in sync, and audit specs for inline duplicates. Usage — /test-data audit | add <domain> | update <fixture-symbol>.
argument-hint: [audit | add <domain> | update <fixture-symbol>]
effort: low
---

Steward the centralized test-data inventory for `services/xstockstrat-ui` (Playwright e2e +
vitest unit). System rules: `docs/patterns/test-data-inventory.md`. Live catalog:
`services/xstockstrat-ui/e2e/fixtures/INVENTORY.md`.

## Arguments

- `$ARGUMENTS[0]` — sub-command: `audit` (default when empty), `add`, or `update`.
- `$ARGUMENTS[1]` — for `add`: a domain (e.g. `orders`, `alerts`, `bars`); for `update`: an
  existing fixture symbol (e.g. `BROKER_ACCOUNT_ALPACA`).

All paths below are relative to `services/xstockstrat-ui/` unless prefixed.

## Always first

1. Read `e2e/fixtures/INVENTORY.md` and `e2e/fixtures/index.ts` — the current inventory.
2. Read `docs/patterns/test-data-inventory.md` § Rules.

## `audit` — find inline mock data that should be in the inventory

1. Collect candidate sites:
   ```bash
   grep -rn "route.fulfill\|const MOCK_\|const SAMPLE_\|SignJWT" services/xstockstrat-ui/e2e --include="*.spec.ts"
   grep -rn "displayName:\|portfolioId:\|strategyId:\|formulaId:" services/xstockstrat-ui/e2e --include="*.spec.ts"
   ```
2. For each hit, classify against the Rules:
   - **Violation** — re-declares a domain object that already has a canonical fixture, or
     the same shape appears in ≥2 files. Report file:line, the duplicated shape, and the
     existing fixture (or proposed new fixture symbol + module).
   - **Catalog gap** — inline data whose domain is missing from `INVENTORY.md` entirely
     (including the "Not yet centralized" table). Propose the catalog row.
   - **OK** — scenario one-off (error payload, `{ ...FIXTURE, override }`, reserved
     sentinel id, single-consumer scenario data already listed as not-yet-centralized).
3. Print a findings report (file:line → verdict → suggested action). **Audit is
   advisory: report only, change nothing.** Offer to fix violations via `add`/`update`.

## `add <domain>` — create a new canonical fixture

1. Find every existing inline site for the domain (grep as in `audit`) and the proto shape:
   ```bash
   grep -rn "message <Entity>" packages/proto/
   ```
   Never invent fields — copy the camelCase Connect-JSON names from the proto message. If
   no proto message and no existing inline site defines the shape, stop and report.
2. Write the fixture into the matching `e2e/fixtures/<domain>.ts` module (create it and
   re-export from `e2e/fixtures/index.ts` if new), with the module-header comment naming
   the proto shape source.
3. Replace every inline duplicate with the import. Keep scenario overrides as
   `{ ...FIXTURE, field: value }` spreads.
4. Update `INVENTORY.md`: add/extend the fixture-table row (symbols, module, shape
   source, consumers); remove the domain from "Not yet centralized" if listed.
5. Verify: `pnpm --filter xstockstrat-ui exec tsc --noEmit` (or `pnpm --filter
   xstockstrat-ui lint` if tsc is unavailable), then run the touched specs:
   `pnpm --filter xstockstrat-ui exec playwright test <touched specs>`.

## `update <fixture-symbol>` — change an existing fixture

1. Locate the symbol's module via `INVENTORY.md`; grep its consumers to see every
   assertion that depends on current values before changing anything.
2. Apply the change in the fixture module only — never fork a per-spec copy. If one spec
   needs a different value, give it a `{ ...FIXTURE, field: value }` override instead.
3. Update the `INVENTORY.md` row if symbols/consumers/shape-source changed.
4. Verify as in `add` step 5, running every consumer spec listed in the catalog row.

## Rules

- The catalog change ships in the same commit as the fixture change — never leave
  `INVENTORY.md` stale.
- Do not rename reserved sentinel ids (see `INVENTORY.md` § sentinels) without updating
  every listed site.
- Backend (Go/Python/Node) test data is out of scope — frontend inventory only.
- This skill edits test fixtures, specs, and the catalog only — never `src/` runtime code.
