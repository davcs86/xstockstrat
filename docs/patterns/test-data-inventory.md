# Test-Data Inventory — centralized mocked/dummy data for tests

Tests draw their mocked/dummy domain objects from a canonical **fixture home** instead of
re-declaring inline literals per file. Constitution **C-13** states this for every language;
**C-12** is the `xstockstrat-ui` instance of it, and the frontend inventory (Playwright e2e +
vitest unit) is the only home fully materialized today. This is the test-data sibling of the DRY guard rail
(`docs/patterns/dry-guard-rail.md`): one canonical fixture per domain entity, with a live
catalog and an AI skill to maintain it.

## Why

Before the inventory, ~90–100 inline mock objects were spread across
`e2e/mock-backend.ts` and 11 spec files. The same broker account was declared at 7 sites,
JWT signing was re-implemented in 3 specs, and spec-level copies drifted from the mock
backend (e.g. string vs number money fields for the same portfolio). Drifted mocks make
tests assert against shapes the real proto never produces.

## The three pieces

| Piece | Where | What it is |
|---|---|---|
| **Fixture modules** | `services/xstockstrat-ui/e2e/fixtures/*.ts` (barrel: `index.ts`) | Canonical domain objects (accounts, portfolios, strategies, formulas, test user) in Connect-JSON camelCase proto shape — usable both as mock gRPC handler returns (`e2e/mock-backend.ts`) and as `page.route()` fulfill bodies |
| **Catalog** | `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` | The live index: fixture → module → proto shape source → consumers, plus reserved sentinel ids and the "not yet centralized" ledger |
| **Steward skill** | `/sdd-qa` (`.claude/skills/sdd-qa/SKILL.md`, procedure in `reference/fixtures.md`) | Designs and runs tests; adds/updates fixtures, keeps the catalog in sync, audits for inline duplicates |

Canonical helper home for **auth**: `e2e/helpers/auth.ts` (`TEST_JWT_SECRET`, `signTestJwt`,
`addAuthCookie`, `addAdminCookie`, `addCookieWithRoles`). Specs never re-implement JWT
signing or re-declare the secret.

## Rules

1. **One canonical fixture per domain entity.** If a spec needs a broker account,
   portfolio, strategy, formula, or test-user identity, it imports it from
   `e2e/fixtures` (or `e2e/helpers/auth` for auth) — it does not re-declare the literal.
2. **Shape follows proto.** Fixture fields are the Connect-JSON camelCase names of the
   proto message named in the module header; money/`double` fields are JSON numbers.
   When a proto message changes, the fixture (not each spec) is the single update site.
3. **Second consumer = centralize.** A mock literal may stay inline while it has exactly
   one consumer and is scenario-specific. The moment a second file needs the same domain
   object — or a feature touches a domain listed under "Not yet centralized" in
   `INVENTORY.md` — it moves into a fixture module. Never copy-paste it to the second site.
4. **Scenario one-offs stay inline.** Error-path payloads, deliberately-broken shapes, and
   per-test variations (`{ ...FIXTURE, field: override }`) belong in the spec. Recurring
   **sentinel ids** that `mock-backend.ts` pattern-matches on are reserved in the catalog.
5. **Catalog stays in the same commit.** Any fixture add/change updates
   `INVENTORY.md` (fixture table, consumers column, sentinel table) in the same commit —
   the `/sdd-qa` skill does this for you.
6. **Vitest unit tests use the same inventory.** The unit layer (`src/**/*.test.ts`)
   imports from `e2e/fixtures` when it needs domain objects; if the unit layer ever grows
   heavy fixture use, promoting the directory to a layer-neutral home is a documented
   follow-up, not a second inventory.

## SDD integration

- **Design (Phase 0 recon)** — "Patterns to REUSE" includes existing fixtures for the
  feature's domains (`.claude/skills/sdd-design/reference/recon-checklist.md`).
- **Spec (discovery)** — when `xstockstrat-ui` is an affected service, the discovery
  survey reads `INVENTORY.md` and reports which fixtures the feature's test steps reuse
  or extend (`.claude/skills/sdd-spec/reference/discovery-checklist.md` § Frontend survey).
- **Spec (step constraints)** — every step that adds/modifies UI tests names the
  fixtures it reuses/extends, or justifies scenario-local literals
  (`.claude/skills/sdd-spec/reference/step-constraints.md` §B).
- **Execute** — `reference/repo-conventions.md` loads when a step touches frontend test
  mocks; new UI test steps import from the inventory.
- **Constitution** — Commandment **C-12** (`docs/sdd/constitution.md`) makes fixture
  reuse binding for UI test steps.

## Exemptions

- **Backend test data is in scope under C-13, but materializes lazily.** A domain literal in a
  Go/Python/Node test may stay inline while it has exactly **one** consumer; the **second**
  consumer moves it to that service's canonical home. No service is required to create a fixture
  module, a catalog, or an `INVENTORY.md` until a second consumer exists. With identity at one test
  file, notify at one, and config/ledger at two, the expected near-term outcome is that **no new
  home is created at all** — the rule exists so the second copy is never written, not so four
  inventories appear.

  | Language | Canonical home | Status today |
  |---|---|---|
  | Next.js | `e2e/fixtures/*.ts` + `INVENTORY.md`; auth `e2e/helpers/auth.ts` | Materialized |
  | Python | `tests/conftest.py` | Exists in all four services |
  | Go | `internal/testdata/` | Not materialized — on second consumer only |
  | Node | `src/__tests__/fixtures/` | Not materialized — on second consumer only |
- `scripts/integration-test.sh` posts live smoke data against real services — not mocks,
  not in scope.
- jscpd already ignores test/fixture files (`.jscpd.json`), so the inventory does not
  interact with DRY Layer A; it is enforced by review + the SDD hooks above, like Layer C.

## Adding a fixture (manual steps; `/sdd-qa add <domain>` automates this)

1. Find the proto message (`packages/proto/<service>/v1/*.proto`) and copy the
   camelCase field names.
2. Add the object to the matching module in `e2e/fixtures/` (or a new module,
   re-exported from `index.ts`).
3. Replace every inline duplicate with the import; run the touched specs.
4. Register it in `INVENTORY.md` (fixture table + consumers).
