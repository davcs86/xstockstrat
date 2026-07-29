# sdd-qa reference — fixture inventory (`audit` / `add` / `update`)

The procedures here were absorbed from the retired `test-data` skill when `sdd-qa` took over
fixture stewardship. System rules: `docs/patterns/test-data-inventory.md`. Live catalog:
`services/xstockstrat-ui/e2e/fixtures/INVENTORY.md`. Governed by Constitution **C-13** (and **C-12**,
which is now the `xstockstrat-ui` instance of it).

## Always first

1. Read `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` and `e2e/fixtures/index.ts`.
2. Read `docs/patterns/test-data-inventory.md` § Rules.

## Canonical homes per language

C-13 binds every language, but **materializes lazily** — a literal may stay inline while it has
exactly one consumer; the **second consumer** forces centralization plus a catalog row, in the same
step. Never create a home ahead of demand.

| Language | Canonical home | Status today |
|---|---|---|
| Next.js | `e2e/fixtures/*.ts` + `INVENTORY.md`; auth from `e2e/helpers/auth.ts` | Materialized |
| Python | `tests/conftest.py` | Exists in all four services |
| Go | `internal/testdata/` | Not materialized — create on second consumer only |
| Node | `src/__tests__/fixtures/` | Not materialized — create on second consumer only |

With identity at 1 test file, notify at 1, and config/ledger at 2, the expected near-term outcome is
that **no new home is created at all**. The rule exists so the second copy is never written, not so
four inventories appear.

## `audit [service]` — find inline mock data that should be centralized

Default scope is `services/xstockstrat-ui/e2e`.

```bash
grep -rn "route.fulfill\|const MOCK_\|const SAMPLE_\|SignJWT" services/xstockstrat-ui/e2e --include="*.spec.ts"
grep -rn "displayName:\|portfolioId:\|strategyId:\|formulaId:" services/xstockstrat-ui/e2e --include="*.spec.ts"
```

For a backend service, look for repeated struct/dict literals across `_test.go`, `test_*.py`, or
`*.test.ts` files instead — and remember the trigger there is *second consumer*, not *exists*.

Classify each hit:

- **Violation** — re-declares a domain object that already has a canonical fixture, or the same shape
  appears in ≥2 files. Report `file:line`, the duplicated shape, and the existing fixture (or a
  proposed symbol + module).
- **Catalog gap** — inline data whose domain is missing from `INVENTORY.md` entirely, including its
  "Not yet centralized" table. Propose the row.
- **OK** — scenario one-off: error payload, `{ ...FIXTURE, override }` spread, reserved sentinel id,
  or single-consumer data already listed as not-yet-centralized.

**Audit is advisory: report only, change nothing.** Offer to fix violations via `add`/`update`.

## `add <domain>` — create a canonical fixture

1. Find every existing inline site (greps above) and the proto shape:
   ```bash
   grep -rn "message <Entity>" packages/proto/
   ```
   Never invent fields — copy the camelCase Connect-JSON names from the proto message. If no proto
   message and no inline site defines the shape, stop and report.
2. Write the fixture into the language's canonical home (for the UI: `e2e/fixtures/<domain>.ts`,
   created and re-exported from `index.ts` if new), with a module-header comment naming the proto
   shape source.
3. Replace every inline duplicate with the import. Keep scenario overrides as
   `{ ...FIXTURE, field: value }` spreads.
4. Update `INVENTORY.md` — add or extend the row (symbols, module, shape source, consumers); remove
   the domain from "Not yet centralized" if listed.
5. Verify: `pnpm --filter xstockstrat-ui exec tsc --noEmit`, then run the touched specs.

## `update <fixture-symbol>` — change an existing fixture

1. Locate the module via `INVENTORY.md`, then **grep its consumers first** to see every assertion
   that depends on current values.
2. Apply the change in the fixture module only — never fork a per-spec copy. A spec needing a
   different value gets a `{ ...FIXTURE, field: value }` override.
3. Update the `INVENTORY.md` row if symbols, consumers, or shape source changed.
4. Verify as in `add` step 5, running every consumer spec listed in the catalog row.

## Rules

- The catalog change ships in the **same commit** as the fixture change — never leave `INVENTORY.md`
  stale.
- Do not rename a reserved sentinel id (`INVENTORY.md` § sentinels) without updating every listed
  site. `mock-backend.ts` pattern-matches these to trigger specific scenario branches, so reusing one
  for a different meaning silently changes another spec.
- This path edits fixtures, specs, and catalogs only — never runtime code.
