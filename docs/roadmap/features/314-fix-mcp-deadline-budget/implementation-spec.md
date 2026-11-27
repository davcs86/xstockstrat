# Implementation Spec: fix-mcp-deadline-budget

**Status**: `pending`
**Created**: 2026-11-20
**Feature**: `docs/roadmap/features/314-fix-mcp-deadline-budget/feature.md`
**Total Steps**: 9
**Feature Branch**: `feature/fix-mcp-deadline-budget`

---

## Execution Summary

The build follows design.md § Build order: the config write edge first, then the migration, then the agent,
then docs, then an operator-run read-back.

- **Steps 1 + 2 (config, one unit)** lower the `agent` / `opportunities.read_timeout_seconds` ceiling to 44,
  bound the new `agent` / `extract.call_budget_seconds` key to [5,35], and add the two-row
  `CROSS_KEY_ORDERING` gate to `SetConfig`.
- **Steps 3 + 4 (config, one unit)** add config migration `056_mcp_deadline_budget` (seed + global-only
  CASE-guarded clamp + DISTINCT notify), its real-DB assertion file and its static test.
- **Steps 5 + 6 (agent, one unit)** add the whole-call extract budget and its tests.
- **Step 7 (agent)** adds the `@AC-2` injected-clock worst-case test.
- **Step 8** is the doc sync. **Step 9** is the operator-run enumeration and read-back per environment.

No proto change, no new env var, no new port, no new outbound gRPC call, no UI change. Portfolio, marketdata
and analysis are readers only and get doc edits only (design.md § R7 and reader services).

**Consumer surfaces (C-14).** Agent tools `extract_email_content` and `extract_website_content` (Step 5),
`list_opportunities` (reached through the ceiling in Step 1, proven at the agent in Step 7, documented in
Step 8), and the `SetConfig` write edge used by the agent `set_config` tool and config-ui (Step 1). config-ui
needs no code change: it renders the per-key min/max that `ListKeys` already returns
(`configServiceImpl.ts:876`), so the 44 ceiling shows up there on its own.

**Evidence tree.** Every `path:line` below was read on `origin/main-dev` @ `fb52065c` on 2026-11-20. The
feature branch tip (`origin/feature/fix-mcp-deadline-budget` @ `1640bc78`) is 168 commits behind it: it stops
at config migration `047` and lacks `048`–`055`, `scripts/migration-assertions/webhook-fanout-callback.sql`
and the current `scripts/config-wiring-stored.json`. The precondition in § Step Dependencies therefore
applies. Lines that moved since recon.md and design.md:

- `tools.py`: `extract_email_content` `:666` (recon `:575`), URL loop `:700-702` (recon `:609-610`),
  `extract_website_content` `:707` (recon `:616`), `list_opportunities` `:1870` (recon `:1722`), `_get_source`
  `:2771`, `_POLICY_READ_TIMEOUT_S` `:2824` (recon `:2665`), `_agent_policy` `:2827` (design `:2685`),
  `_fetch_url` `:2844` (recon `:2685`).
- `client.py`: `_RPC_TIMEOUT_S` `:45` (recon `:44`), `_LONG_RPC_TIMEOUT_S` `:46`.
- `configServiceImpl.ts`: `setConfig` `:671` (recon `:666`), per-key gate `:753-765` (recon `:750-760`),
  existence gate `:767-792`, `listKeys` `:858` (recon `:871`), sandbox bound `:178` (recon `:176`).
- Findings rows: root `docs/context-constitution-findings.md:51` (recon `:44`), portfolio `:27` (recon `:26`),
  config `:24` (unchanged).

## Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` extract_email_content returns partial results before the MCP client timeout | Step 6 (behaviour), Step 4 (the seeded budget key) |
| `@AC-2` list_opportunities worst case stays under the MCP client timeout | Step 2 (ceiling + budget arithmetic), Step 4 (stored-row clamp), Step 7 (agent worst case); Step 9 (live rows) is advisory operator evidence, not a gate |
| `@AC-3` SetConfig rejects a value that inverts portfolio-over-marketdata quote deadline ordering | Step 2 |

## Spec-time Decisions and Findings

These are recorded in context.md (Session 2026-11-20 — sdd-spec) as well.

1. **Migration number: `056`.** `origin/main-dev` @ `fb52065c` holds `…052, 054, 055`. `053` is claimed by
   feature 345 (spec-only, not on trunk — 352 context.md:63). The operator decision is "next free above the
   main-dev tip", so the number is `056`. It stays provisional until merge (see the renumber checklist below).
   **Known collision (impl-spec review, 2026-11-20):** feature 321 `fix-trading-config-plumbing`
   (`implementation-ready`, not on trunk) also specs `056`
   (`056_trading_broker_paper_per_environment.{up,down}.sql`, its implementation-spec.md:630-631 on
   `origin/feature/fix-trading-config-plumbing`). golang-migrate cannot apply two `056` files, so whichever
   of 314 and 321 merges second renumbers to max + 1 with the checklist below. Neither spec is renumbered
   now: the merge order is not decided, and this feature's SQL, sentinel, tests and docs are number-free.
2. **Enumeration result and sign-off (operator condition).**
   - Staging, global rows, read 2026-11-20 through the staging agent MCP `get_config` (read-only):
     `agent` / `opportunities.read_timeout_seconds` = `40.0` (float); `portfolio` /
     `marketdata.quote_timeout_ms` = `4000`; `marketdata` / `quotes.batch_timeout_ms` = `2500`,
     `quotes.mark_timeout_ms` = `500`, `price.batch_timeout_ms` = `2500`; `analysis` /
     `opportunity.live_enrich_timeout_ms` = `3000`. So (a) no global row above 44 and (b) no inverted pair
     (4000 > max(2500, 500); 3000 > 2500).
   - Not enumerated: production (no read path from this session), per-user rows in either environment, and
     the raw `value_data` text (the tool returns the parsed value, so a non-matching spelling cannot be seen).
   - No operator sign-off on an enumeration was obtained in this run. Per the operator condition the clamp
     ships in its defensive form and **the sign-off is recorded as "unenumerated"**. Step 9 runs the full
     query on both databases before and after the rollout.
3. **Regex: bounded strict decimal, and non-matching rows are enumerated, not cast.** The read edge parses a
   float row with `parseFloat(row.value_data)` (`configServiceImpl.ts:935`), which accepts trailing garbage
   (`'50s'` → 50) that `::numeric` rejects. No regex can make every such row castable. The clamp therefore
   matches only `^[+-]?([0-9]{1,30}(\.[0-9]{0,30})?|\.[0-9]{1,30})([eE][+-]?[0-9]{1,3})?$` — every spelling
   `SetConfig` can store for an in-bounds number that the read edge also reads as that number, with digit and
   exponent runs capped so the cast cannot overflow. Step 9's query lists every global row that does not
   match; the operator fixes those with `SetConfig`.
4. **`RAISE NOTICE` placement.** design.md keeps `<NNN>.up` a single CTE statement and cites
   `config-046.sql:78-85` for the notice, which is an assertion file. The notice therefore lives in
   `scripts/migration-assertions/config-mcp-deadline-budget.sql` (Step 3). That file runs only in the CI
   `migration-rerun` job, so the live per-user count is reported by Step 9's query. **Flag for impl-spec
   review**: if the operator wants the notice emitted on the live databases, it needs a second statement in
   `056.up`, which departs from design.md § 4.
5. **Seed-before-reader bridge.** The seed (Step 3, backend) lands before its reader (Step 5, agent), and a
   unit may not cross surfaces. Step 3 adds one temporary `seeded-unread` entry to `scripts/config-wiring.json`
   and Step 5 deletes it (insights.md:4681-4683, feature 334). The checker's `STALE` rule enforces the removal.
6. **`@AC-2` red-before-green across surfaces.** The fix for `@AC-2` is the config ceiling (Step 1). Its
   red→green cycle is Step 2's ceiling and budget-arithmetic tests, inside the config unit. Step 7's agent test
   lands after the ceiling, so its RED is captured by a working-tree mutation (see Step 7), never committed.
7. **`extract_website_content` and httpx timeouts.** Only the whole-call budget expiring is
   `DEADLINE_EXCEEDED`. Any `httpx.TransportError`, including its timeout subclasses, is
   `FETCH_FAILED: <ExceptionClass>` (D-15: a transport failure is not the call deadline, and "within Ns"
   would misstate a 30 s read timeout). In `extract_email_content`, an `httpx.TimeoutException` on one URL
   counts under `deadline`, any other `httpx.TransportError` under `transport`.
8. **Not changed: the stored description of `opportunities.read_timeout_seconds`.** The `041` seed text says
   "SetConfig-bounded `[30,55]`" (`scripts/config-wiring-stored.json:154,166`). design.md § 4 fixes the
   clamp's SET list to four columns and does not rewrite descriptions, so the stored text stays stale.
   The text is user-visible (`ListKeys`, config-ui), and the PREPARE-copy pin (Step 4) makes a later change
   to the clamp statement costly. **Impl-spec review outcome (2026-11-20):** the default is that Step 8
   records the staleness as a config findings row, so it is not left silent. Rewriting the description (a
   separate statement or a follow-up migration) departs from design.md § 4 and stays an operator decision
   (Open Thread in context.md); if the operator picks it before Step 3, the findings row is dropped.
9. **No measured real-time `@AC-2` variant.** At ceiling 44 the modelled worst case is exactly 57 s. A
   wall-clock test with zero slack would be flaky, so Step 7 uses an injected clock. The design's fallback to
   43 applies only if an unmodelled latency term is found (Step 9 smoke, or a later report); that is an
   operator decision.

## Step Dependencies

- **Precondition before Step 1.** Merge `origin/main-dev` into `feature/fix-mcp-deadline-budget` before
  writing any file. The tree must hold config migrations `048`–`055`, `scripts/migration-assertions/`
  (`webhook-fanout-callback.sql`, `config-046.sql`), the trunk `scripts/config-wiring-stored.json`, and the
  line numbers cited here. After the merge, re-grep every `path:line` in the step being executed; other
  in-flight features edit the same files (see "Overlap" below).
- **Steps 1 + 2 land together** (`step-constraints.md` §C, "changes … in a package whose build or typecheck
  compiles tests": the suite's bounds table pins `max: 55` at `setConfigScalarBounds.test.ts:276` and the
  `intVal: 56` / `[30, 55]` case at `:370-378`; both turn red the moment the registry row changes). One
  commit, backend surface. Step 2 is authored first and run RED, then Step 1 makes it GREEN.
- **Steps 3 + 4 land together** (§C, "adds a test that references a symbol a later step creates" and "seeds a
  config key (migration)"). Step 4's suite resolves the migration with `findOne('_mcp_deadline_budget', …)`
  (`services/xstockstrat-config/src/__tests__/migrationSql.ts:8-16`) and reads the assertion file, so it
  cannot pass before Step 3's files exist. The RED is an assertion failure ("expected exactly one …"), not a
  compile error. One commit, backend surface. The reader half of the §C seed trigger is bridged by the
  temporary baseline entry (decision 5), because the reader is on the agent surface.
- **Step 3 requires Step 1**: the clamp writes `44`, which must already be the SetConfig ceiling so a replay
  stays a no-op and no later write can re-raise the value.
- **Step 3 needs a reachable Postgres plus `psql` and `migrate` on `PATH`** to generate
  `scripts/config-wiring-stored.json` (`scripts/config-wiring-stored.py:4-5`). This is artifact generation,
  not verification; the migration itself is verified offline.
  - Local route, same as CI: `docker build -f scripts/Dockerfile.migrate -t xstockstrat-migrate-ci .`, then
    `docker run --rm --network host -e DATABASE_URL=… -v "$PWD:/repo" -w /repo --entrypoint python3
    xstockstrat-migrate-ci scripts/config-wiring-stored.py` against a scratch Postgres 16
    (`.github/workflows/ci.yml:1347-1355`, job `config-wiring-stored`).
  - Fallback: that CI job uploads the regenerated file as artifact `config-wiring-stored`; commit it unedited
    and record the run URL in context.md.
  - If neither route works, Step 3 is blocked (P-03). The JSON is never written by hand. Starting a throwaway
    database for this needs the operator's go-ahead (precedent: 347 context.md:18). **Settle the route at
    the /sdd-execute confirmation, before Step 1 starts** (impl-spec review): Steps 3 + 4 are one unit, so a
    block found at Step 3 strands the unit.
- **Steps 5 + 6 land together** (§C, "changes a … return shape": `tests/test_tools.py:2472-2477` asserts the
  exact set of policy keys an extract call reads, and the new read adds a fifth; plus "adds a test that
  references a symbol a later step creates"). One commit, agent surface. Step 6 is authored first and run RED.
- **Step 5 requires Step 3**: the reader's key must already be seeded, and Step 5 deletes the temporary
  baseline entry Step 3 added.
- **Step 7 requires Step 1** (the ceiling it reads from the registry). It stands alone.
- **Step 8 requires Steps 1–7**: the docs describe the shipped behaviour and name the migration.
- **Step 9 requires the integration PR to be merged and deployed.** Its pre-deploy query runs before that
  merge. It is an operator-run docs step (results recorded in context.md), not a test step: it has no
  coverage threshold and it does not block `code-completed`.
- **Step 2 [test] covers Step 1 [service]; Step 4 [test] covers Step 3 [migration]; Step 6 [test] covers
  Step 5 [service]; Step 7 [test] covers `@AC-2` at the agent** (C-08).
- **Renumber checklist (at the integration PR, and after every `origin/main-dev` merge).**
  1. `git ls-tree --name-only origin/main-dev services/xstockstrat-config/migrations/ | tail -4`. Also check
     the in-flight claims: feature 321 specs `056` and feature 345 specs `053` (decision 1); neither is on
     trunk at `fb52065c`.
  2. If `056` is taken, rename both files to max + 1. The SQL, the sentinel, the tests (which resolve by
     suffix) and the docs are number-free, so nothing else changes; `grep -rn "056_mcp_deadline_budget"` in
     the files this feature changed must come back empty apart from this spec.
  3. Dedup by key: `git grep -n "extract.call_budget_seconds" origin/main-dev -- services/xstockstrat-config/migrations/`
     must be empty (fails.md 2026-11-10, fix-analysis-live-loop-budget-seed).
  4. Regenerate `scripts/config-wiring-stored.json` with the Step 3 command, even without a renumber, after
     any merge that brings in another config migration (`inputs_sha256` hashes every config migration; CI
     step "Committed stored set is fresh", `ci.yml:1366`).
- **Overlap.** `services/xstockstrat-agent/app/tools.py` and
  `services/xstockstrat-config/src/grpc/configServiceImpl.ts` are also edited by features 319, 322, 328 and
  331 (recon.md § Risks) and by peers in this batch (`fix-system-identity-paths`, `fix-auth-trust-hardening`,
  `fix-agent-bearer-secret-orphan`, `fix-agent-mcp-transport-fallthrough`, `fix-read-path-owner-trust`).
  Expect line drift and merge conflicts in the registry block and near the extract tools; resolve by
  re-reading, never by line number.
- **Open risks from design.md and where they land**: concurrent greater/lesser writes (accepted, R-10) →
  Step 8; zero slack at 44 → Step 7 and decision 9; the 35 s cap cutting off slow fetches → Step 8; strict
  `>` prevents inversion only → Step 1 comment; the rule is invisible in ListKeys → Step 1 message, Step 8;
  quote=2500 unwritable over batch=2500 → Step 2 test; the clamp changing a live value, the old-image window,
  float-syntax rows, the unverified heal scope → Step 9; PREPARE-copy drift → Step 4; per-user rows above 44
  → Steps 3, 8, 9. Attachment parsing outside the budget and `HTTPStatusError` aborting the call stay out of
  scope (design.md § Open Risks).

---

### Step 1 — service: SetConfig ceiling, extract-budget bound and cross-key ordering gate

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify

**Reviewers**: xstockstrat-config owner — config key naming (`<service>.<category>.<key>`), environment (`production`/`staging`) / global-per-user scoping, WatchConfig stream stability

**Codebase Evidence**:
Line numbers re-anchored on `origin/main-dev` @ `2b2dec92` (merged into the dev branch); re-anchor by content
if they drift again.
- `SCALAR_BOUNDS_REGISTRY` at `configServiceImpl.ts:115`, keyed `${namespace}.${relative key}` (comment
  `:113-114`); `lookupScalarBounds` at `:188-189`.
- Rows: `'analysis.opportunity.live_enrich_timeout_ms': { minValue: 500, maxValue: 4000 }` `:146`;
  `'marketdata.price.batch_timeout_ms': { minValue: 500, maxValue: 2500 }` `:151`;
  `'agent.opportunities.read_timeout_seconds': { minValue: 30, maxValue: 55 }` `:152`;
  `'portfolio.marketdata.quote_timeout_ms': { minValue: 500, maxValue: 8000 }` `:155`;
  `'marketdata.quotes.batch_timeout_ms': { minValue: 500, maxValue: 5000 }` `:157`;
  `'marketdata.quotes.mark_timeout_ms': { minValue: 100, maxValue: 2500 }` `:161`.
- The ordering exists only as comments: `:143-144` ("the agent floor of 30 sits above analysis's own 27.05s
  worst case") and `:153-154` ("the portfolio quote deadline (default 4000) must exceed max(batch, mark)
  budget plus the warm read").
- No `agent.extract.*` row exists in the registry (`grep -n "'agent\.extract" configServiceImpl.ts` → no hit).
- `setConfig` at `:673`: prefixed-key refusal `:674-678`; `userIdParam` `:682` (`null` = global); admin /
  internal-caller gate (`callback(ADMIN_SCOPE_ERROR)` `:721`); `env` `:739`; per-key bounds gate
  `:760-772` returning `callback({ code: 3, message: … must be a number in [min, max] … })`; existence gate
  starting at its comment `:774`, whose `this.pool.query` reads `config.config_values` by (namespace, key,
  environment, user) and whose `catch` returns `callback({ code: 13, message: err.message })` at `:796-798`.
- `extractValueData` at `:967`; logger `const log = getLogger('config:impl')` at `:31`, key-only warning
  style `log.warn(msg, fields)` at `:719`.
- `listKeys` (`:865`) surfaces only per-key min/max (`:883`); it is not a write path.

**Lands with**: `Step 2`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Registry rows:
   - `:152` becomes `{ minValue: 30, maxValue: 44 }`. Put a comment of at most two lines above it stating the
     invariant: identity auth (10 s) + the policy read (3 s) + this value must stay ≤ 57 s, 3 s under the MCP
     client's 60 s timeout.
   - Add `'agent.extract.call_budget_seconds': { minValue: 5, maxValue: 35 }` next to it, with a comment
     stating: auth (10 s) + the source lookup (10 s) + this value must stay ≤ 57 s.
   - Reword the comments at `:143-144` and `:153-154` so they say the cross-key order is enforced by
     `CROSS_KEY_ORDERING` and "prevents inversion only" (strict `>`, no warm-read margin). Keep each ≤ 2 lines.
   - Do not change any other bound (per-key bounds of the five cross-hop keys stay as they are — R-1).
2. Below `lookupScalarBounds`, add `CROSS_KEY_ORDERING`: a `ReadonlyArray` of exactly two rows, each
   `{ greater: string; lesser: readonly string[] }`, using the registry's `${namespace}.${relative key}` form:
   - `greater: 'portfolio.marketdata.quote_timeout_ms'`, `lesser: ['marketdata.quotes.batch_timeout_ms',
     'marketdata.quotes.mark_timeout_ms']`;
   - `greater: 'analysis.opportunity.live_enrich_timeout_ms'`, `lesser: ['marketdata.price.batch_timeout_ms']`.
   No DSL, no margin field (R-7). Build `CROSS_KEY_RULES_BY_KEY: ReadonlyMap<string, …>` once at module load
   from that table, mapping every member key (greater and lesser) to its rule(s).
3. In `setConfig`, add the gate directly after the per-key gate (after `:772`) and before the existence gate
   comment (`:774`). It runs only when `userIdParam === null` and `CROSS_KEY_RULES_BY_KEY` has
   `${namespace}.${key}`. A per-user write and a key in no rule issue no query.
   - Read the sibling values with **one** `this.pool.query`: the global rows (`user_id IS NULL`) in `env` for
     the other member keys of the matching rule(s). Select `namespace, key, value_data`. The statement text
     must not contain `SELECT key, is_secret` (the existing recording pool in the test suite keys on it).
   - Parse each sibling with `Number(value_data)`. An absent row or a non-finite number skips that
     comparison and logs one `log.warn` carrying the namespace and key only — never a value.
   - A query error takes the same path as `:796-798`: `log.error` without values, then
     `callback({ code: 13, message: err.message })`, and return.
   - Compare with strict `>`, using the written value `Number(extractValueData(value))` (already finite: all
     five member keys are in `SCALAR_BOUNDS_REGISTRY`):
     - writing a `greater` key: reject unless the new value is `>` every present `lesser` sibling;
     - writing a `lesser` key: reject unless the stored `greater` sibling is `>` the new value.
   - On violation: `callback({ code: 3, message })` and return. Nothing is written and no existence query
     runs.
   - The message names both FQNs and the stored sibling value, and its remedy **leads with "raise
     `<greater key>`"** (the only direction that always succeeds: quote max 8000 > max(5000, 2500); enrich
     max 4000 > price max 2500). It offers "or lower `<lesser key>` first" only when the write is to the
     `greater` key and exactly one `lesser` sibling violates.
4. Do not touch `listKeys`, the read path, the authz gate order, or the per-key gate. No new pool, no
   transaction (F-06, R-10). The 44 and 35 ceilings live only here (F-07, R-4).

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run lint && pnpm run test
grep -n "CROSS_KEY_ORDERING\|CROSS_KEY_RULES_BY_KEY\|'agent.extract.call_budget_seconds'\|maxValue: 44" src/grpc/configServiceImpl.ts
```
`pnpm run test` is green only with Step 2's edits in the tree (atomic unit).

---

### Step 2 — test: scalar bounds, `@AC-2` ceiling arithmetic and `@AC-3` cross-key ordering

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/setConfigScalarBounds.test.ts` — modify

**Reviewers**: xstockstrat-config owner — config key naming, environment / global-per-user scoping, WatchConfig stream stability

**Codebase Evidence**:
- Loopback gRPC harness (`before` at `setConfigScalarBounds.test.ts:41`) with a recording pool at `:42-50`. The
  pool answers the existence `SELECT key, is_secret FROM config.config_values` (match at `:44`) with one
  registered row (`:45`) and every other statement with `{ rows: [] }` (`:47`); `insertQuery()` at `:37-39`; admin `setConfig` helper `:72-78`
  (metadata `x-access-scope: '7'`, `x-user-id: 'tester'`).
- Reject-and-write-nothing template: `:94-102` (`err.code === grpc.status.INVALID_ARGUMENT`,
  `insertQuery() === undefined`).
- Bounds table `TIMEOUT_KEY_FORMS` `:270-290`; the agent row `:276` is `min: 30, max: 55`; the loops at
  `:292-309` write each key at `min`, `max`, `min - 1`, `max + 1`.
- `:370-378` "bounds the float agent timeout key when written as an intVal too": `intVal: 56`,
  "above the 55s ceiling", `/\[30, 55\]/`.
- Cross-source read precedent in this service's tests: `path.resolve(__dirname, '../../../../scripts/config-heal/signoff.md')`
  (`aliasRemovalRowsMigration.test.ts:9`).
- Agent constants the arithmetic pins: `_RPC_TIMEOUT_S = 10.0` (`services/xstockstrat-agent/app/client.py:45`),
  `_POLICY_READ_TIMEOUT_S = 3.0` (`services/xstockstrat-agent/app/tools.py:2827`).
- `tsconfig.json` `include: ["src/**/*"]` — tests compile with the build; `pnpm run test` is
  `tsc && node --test dist/__tests__/*.test.js` (`package.json:12`).

**Lands with**: `Step 1`

**TDD**: `red-green required`

**Covers**: `AC-2, AC-3`

**Instructions**:
1. Bounds table and the existing ceiling case:
   - `:276` becomes `max: 44`; add `{ ns: 'agent', key: 'extract.call_budget_seconds', field: 'floatVal', min: 5, max: 35 }`.
   - `:370-378`: the rejected value becomes `intVal: 45`, the text "above the 44s ceiling", the regex `/\[30, 44\]/`.
2. `@AC-2` (name it in the test title): read `_RPC_TIMEOUT_S` from `client.py` and `_POLICY_READ_TIMEOUT_S`
   from `tools.py` by regex (paths resolved from `__dirname` as in `aliasRemovalRowsMigration.test.ts:9`;
   fail the test if either regex does not match). Find the largest accepted value by writing 44 (accepted)
   and 45 (rejected with code 3), then assert `auth + policyRead + 44 <= 57`. On the pre-fix tree the 45
   write is accepted, so the test is RED for the right reason.
3. Sibling-returning mock: extend the recording pool so the cross-key sibling read (the statement that
   selects `value_data`) returns rows from a per-test mutable list that defaults to empty. Existing cases
   must stay untouched by the default.
4. `@AC-3` and the cross-key cases, each asserting code and that no `INSERT` ran unless stated:
   - `@AC-3`: stored global `portfolio` / `marketdata.quote_timeout_ms` = `1000`; write `marketdata` /
     `quotes.batch_timeout_ms` = `5000` → `INVALID_ARGUMENT`, no `INSERT`, message matches
     `/raise portfolio\.marketdata\.quote_timeout_ms/`.
   - Reverse direction: stored `quotes.batch_timeout_ms` = `5000`, `quotes.mark_timeout_ms` = `500`; write
     quote = `1000` → rejected.
   - `max(batch, mark)`: stored batch = `600`, mark = `2500`; write quote = `2000` → rejected (mark is the
     violating sibling).
   - Enrich pair, both directions: stored `marketdata` / `price.batch_timeout_ms` = `2500`, write `analysis` /
     `opportunity.live_enrich_timeout_ms` = `2000` → rejected; stored enrich = `1000`, write price = `2000`
     → rejected.
   - Strict `>` narrowing (design.md § 3, C-16 sign-off for `@AC-1 @feature-229`): stored batch = `2500`,
     mark = `500`; write quote = `2500` → rejected, and the message leads with the raise remedy and also
     offers lowering `marketdata.quotes.batch_timeout_ms` (exactly one lesser sibling violates).
   - Accepted writes reach the `INSERT`: quote = `4000` over batch `2500` / mark `500`; batch = `500` over
     quote `4000` (`@AC-8 @feature-229` stays valid).
   - Per-user write skips the gate: a per-user write (request `userId` equal to the caller's `x-user-id`)
     of an inverting value is not rejected by the gate, and no sibling query runs.
   - Absent sibling (default empty list) and unparseable sibling (`value_data: 'abc'`): the write is
     accepted.
   - Sibling query failure: the pool throws on the sibling read → code `13`, no `INSERT`.
   - Zero queries: an out-of-bounds write to a member key (`quotes.batch_timeout_ms` = `5001`) and a
     non-admin global write to a member key each leave `queries.length === 0`.
5. C-13: the sibling rows are scenario one-offs with a single consumer (this file) — keep them inline; do
   not create `src/__tests__/fixtures/` content for them.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
grep -n "__tests__/fixtures" src/__tests__/setConfigScalarBounds.test.ts   # expect no new import (single-consumer inline literals, C-13)
```
RED capture (before Step 1's edit): `pnpm run test` fails on the `@AC-2` case (45 accepted), the `[30, 44]`
cases and every cross-key rejection case.

---

### Step 3 — migration: config `056_mcp_deadline_budget` (seed + global clamp + notify) and its real-DB assertion

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/057_mcp_deadline_budget.up.sql` — create
- `services/xstockstrat-config/migrations/057_mcp_deadline_budget.down.sql` — create
- `scripts/migration-assertions/config-mcp-deadline-budget.sql` — create
- `scripts/config-wiring-stored.json` — modify (generated by `scripts/config-wiring-stored.py`; never hand-edited)
- `scripts/config-wiring.json` — modify (one temporary `seeded-unread` entry; Step 5 deletes it)

**Reviewers**: DBA — migration NNN numbering (no gaps, no conflicts), up+down pair present, run-order compliance with `scripts/db-migrate.sh`; xstockstrat-config owner — config key naming, environment / global-per-user scoping, WatchConfig stream stability

**Codebase Evidence**:
- Last config migration on `origin/main-dev` @ `2b2dec92`: `056_analysis_live_only_cycle_max_days.{up,down}.sql`
  (feature 366, commit `540f8ff7`, #1608); `053` is absent from trunk (claimed by feature 345); feature 321
  also claims `056` in flight. Next free above the tip: `057` (renumber checklist applied).
- No existing seed of the key: `grep -rn "extract.call_budget_seconds" services/xstockstrat-config/migrations/` → no hit.
- Seed column shape and conflict target: `048_webhook_fanout_callback_keys.up.sql:4-6,43`
  (`(namespace, key, value_type, value_data, description, default_value, consuming_service, updated_by,
  environment, user_id)`, `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING`).
- Existing agent float keys carry `value_type 'float'` (`041_heal_config_keys_to_reader_catalog.up.sql:40,43,46`
  — rows of the `catalog_041` temp-table `VALUES`, not `config_values` inserts).
- Notify CTE shape: `047_config_alias_removal_rows.up.sql:57-61`; down notify over a `RETURNING`:
  `047_config_alias_removal_rows.down.sql:23-24`. A CTE UPDATE with `caller_identity = NULL` and a final
  `SELECT` that forces the notify CTE: `055_analysis_live_enrich_ttl_reseed.up.sql:4-22`.
- Down shape for a seed: `048_webhook_fanout_callback_keys.down.sql:4-13` (sentinel + `user_id IS NULL` +
  key + value).
- The audit trigger writes `NEW.updated_by` and `NEW.caller_identity` when `value_data` changes
  (`017_config_secrets_and_scoping.up.sql:66-78`).
- The read edge parses float rows with `parseFloat(row.value_data)` (`configServiceImpl.ts:942`).
- Assertion-file pattern: `scripts/migration-assertions/webhook-fanout-callback.sql` (`BEGIN;` `:3`,
  `PREPARE … AS` copies `:8-63`, `DO $$ … RAISE EXCEPTION` checks, `ROLLBACK;` last line); a reported,
  not asserted, per-user count: `scripts/migration-assertions/config-046.sql:78-86`.
- `scripts/migration-rerun.py:562-572` (`split_assertions`): a file named `config-[0-9]*` below R is a
  pre-R assertion; any other non-`fixtures-*` name runs after all migrations, so
  `config-mcp-deadline-budget.sql` runs post-migration. Fixtures load by hard-coded name at `:687-690`.
- Baseline format and the temporary-entry precedent: `scripts/config-wiring.json:5-12` (`findings` entries
  `{namespace, key, kind, owner}`), owner regex `scripts/check-config-wiring.mjs:170`, `STALE` rule `:710`,
  `STALE-STORED` rule `:716`; insights.md:4681-4683.
- Number-free sentinel convention: `docs/patterns/config-governance.md:143`.

**Lands with**: `Step 4`

**TDD**: `N/A (migration)`

**Covers**: —

**Instructions**:
1. Create `057_mcp_deadline_budget.up.sql` as **one statement**. Header comment ≤ 2 lines, number-free
   content (sentinel `system:config-migration-feature-fix-mcp-deadline-budget`). Proposed text (not executed
   at spec time — no database; the CI `migration-rerun` job is where it is proven):
   ```sql
   WITH seed AS (
     INSERT INTO config.config_values
       (namespace, key, value_type, value_data, description, default_value, consuming_service, updated_by, environment, user_id)
     VALUES
       ('agent', 'extract.call_budget_seconds', 'float', '35', '<description>', '35', 'xstockstrat-agent',
        'system:config-migration-feature-fix-mcp-deadline-budget', 'staging', NULL),
       ('agent', 'extract.call_budget_seconds', 'float', '35', '<description>', '35', 'xstockstrat-agent',
        'system:config-migration-feature-fix-mcp-deadline-budget', 'production', NULL)
     ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING
     RETURNING namespace, environment
   ), heal AS (
     UPDATE config.config_values
     SET value_data = '44',
         updated_by = 'system:config-migration-feature-fix-mcp-deadline-budget',
         update_reason = 'feature fix-mcp-deadline-budget: clamp to MCP-safe ceiling',
         caller_identity = NULL
     WHERE namespace = 'agent'
       AND key = 'opportunities.read_timeout_seconds'
       AND user_id IS NULL
       AND NOT is_secret
       AND CASE WHEN value_data ~ '^[+-]?([0-9]{1,30}(\.[0-9]{0,30})?|\.[0-9]{1,30})([eE][+-]?[0-9]{1,3})?$'
                THEN value_data::numeric > 44 ELSE false END
     RETURNING namespace, environment
   ), nt AS (
     SELECT pg_notify('config_changed', json_build_object('namespace', t.namespace, 'environment', t.environment)::text) AS sent
     FROM (SELECT DISTINCT namespace, environment
           FROM (SELECT namespace, environment FROM seed UNION ALL SELECT namespace, environment FROM heal) u) t
   )
   SELECT (SELECT count(*) FROM seed) AS seeded, (SELECT count(*) FROM heal) AS clamped, (SELECT count(*) FROM nt) AS notified;
   ```
   - `<description>` is the same text on both rows and states the constraint, e.g. "Whole-call budget
     (seconds) for the URL fetches of one extract_email_content / extract_website_content call. Identity auth
     (10) + the source lookup (10) + this value must stay at or below 57, 3 s under the MCP client's 60 s
     timeout. Read live; a non-finite or <= 0 value reads as 35. SetConfig-bounded [5,35]." Escape any
     single quote by doubling it.
   - The clamp is global-only (`user_id IS NULL`), has the `CASE` guard, and sets `caller_identity = NULL`
     (operator conditions; O-19, O-20, O-22). It has no inverted-pair heal (R-11, D-13).
2. Create `057_mcp_deadline_budget.down.sql`: one statement that deletes only the seed rows — `namespace =
   'agent' AND key = 'extract.call_budget_seconds' AND value_data = '35' AND user_id IS NULL AND environment
   IN ('staging', 'production') AND updated_by = '<sentinel>'` — `RETURNING namespace, environment`, and ends
   with the same DISTINCT `pg_notify` over that `RETURNING` (`047.down:23-24` shape). It is **forward-only
   for the clamp**: it contains no `UPDATE` and no reference to `opportunities.read_timeout_seconds`. Say so
   in the ≤ 2-line header.
3. Create `scripts/migration-assertions/config-mcp-deadline-budget.sql` in the
   `webhook-fanout-callback.sql` pattern: `BEGIN;` … `ROLLBACK;`, with `PREPARE mdb_clamp AS` followed by a
   **verbatim copy** of the `heal` CTE's inner statement (from `UPDATE config.config_values` through
   `RETURNING namespace, environment`). A header line names the source migration by suffix and says "change
   both together". Inside the transaction, set up rows with plain `UPDATE`/`INSERT`, `EXECUTE mdb_clamp`,
   and check with `DO $$ … RAISE EXCEPTION … $$` blocks:
   - the global staging row set to `'55'` and the global production row set to `'44.5'`, each with a
     non-NULL `caller_identity` → both become `'44'`, `updated_by` = the sentinel, `caller_identity IS NULL`;
   - `config.config_audit` holds a row for the key with `new_value = '44'` and `changed_by` = the sentinel;
   - a second `EXECUTE` changes nothing (replay no-op);
   - global `'40'` is untouched;
   - a global non-numeric value (`'abc'`) and a trailing-garbage value (`'50s'`) are untouched and the
     statement raises no error;
   - a per-user row at `'50'` is untouched;
   - the seeded `agent` / `extract.call_budget_seconds` global rows exist in both environments with
     `value_data = '35'`, `value_type = 'float'`, `default_value = '35'`;
   - a final `DO` block that only `RAISE NOTICE`s the count of per-user rows of the clamped key whose value
     matches the regex and is `> 44` (reported, not asserted — `config-046.sql:78-86`).
4. Regenerate `scripts/config-wiring-stored.json` with `scripts/config-wiring-stored.py` (routes in § Step
   Dependencies). First prove the baseline: with the two `057` files held aside the generator must reproduce
   the committed file with an empty diff; with them, the diff must be exactly the two new
   `agent` / `extract.call_budget_seconds` rows plus `inputs_sha256`. If Postgres is available also run
   `scripts/config-heal-dryrun.py --fresh` and confirm `scripts/config-heal/dryrun-fresh.tsv` is unchanged
   (`ci.yml:1357-1363`).
5. Add one entry to `findings` in `scripts/config-wiring.json`:
   `{ "namespace": "agent", "key": "extract.call_budget_seconds", "kind": "seeded-unread", "owner": "feature 314 fix-mcp-deadline-budget — temporary, removed by Step 5 (reader)" }`.
6. Do not edit any applied migration (F-01). Do not start a database to *verify* this step.

**Verification** (offline; no database):
```bash
ls services/xstockstrat-config/migrations/057_mcp_deadline_budget.up.sql services/xstockstrat-config/migrations/057_mcp_deadline_budget.down.sql
ls services/xstockstrat-config/migrations | tail -4          # 057 is the highest number; no duplicate 057
! grep -q "UPDATE\|opportunities.read_timeout_seconds" services/xstockstrat-config/migrations/057_mcp_deadline_budget.down.sql   # exit 0 = no hit
node scripts/check-config-wiring.mjs --final                  # exit 0: stored set fresh, the one temporary entry is not STALE
node --test scripts/config-wiring.test.mjs
```
Then read both files: the `.down` deletes exactly the rows the `.up` seed inserts (sentinel-scoped) and does
not reverse the clamp, by design (operator condition). The apply, replay and assertion run happen in the CI
`migration-rerun` job.

---

### Step 4 — test: static test for `*_mcp_deadline_budget` and the PREPARE-copy pin

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/mcpDeadlineBudgetMigration.test.ts` — create

**Reviewers**: xstockstrat-config owner — config key naming, environment / global-per-user scoping, WatchConfig stream stability

**Codebase Evidence**:
- Helper `findOne(suffix, ext)` and `splitStatements(sql)`:
  `services/xstockstrat-config/src/__tests__/migrationSql.ts:8-16,19-52` (`MIGRATIONS_DIR` at `:6`).
- Closest template (sentinel, notify CTE, final SELECT, down guard, loading inside each `it`):
  `services/xstockstrat-config/src/__tests__/liveEnrichTtlReseedMigration.test.ts:1-60`; seed-row templates:
  `servabilitySeedMigrations.test.ts`, `barIngestBackoffSeedMigration.test.ts`.
- Reading a file under `scripts/` from a config test: `aliasRemovalRowsMigration.test.ts:9`.
- No existing test pins a PREPARE copy to its source (`grep -rn "webhook-fanout-callback.sql" services/` →
  no hit): **Not found** — the pin is new.
- The reader default the seed must equal: `35` (Step 5, `_agent_policy("extract.call_budget_seconds", …)`).

**Lands with**: `Step 3`

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2`

**Instructions**:
1. Resolve the files by suffix `_mcp_deadline_budget` (number-free, so a renumber needs no test edit). Load
   inside each `it` (node 22 exits 0 when a `describe` callback throws —
   `liveEnrichTtlReseedMigration.test.ts:49`).
2. Up — one statement (`splitStatements(…).length === 1`), and:
   - the seed: exactly two rows, `staging` and `production`, `user_id` NULL, namespace `agent`, key
     `extract.call_budget_seconds`, `value_type 'float'`, `value_data '35'`, `default_value '35'`,
     `consuming_service 'xstockstrat-agent'`, a non-empty description identical on both rows, the sentinel
     `system:config-migration-feature-fix-mcp-deadline-budget`, and `ON CONFLICT (namespace, key, environment,
     COALESCE(user_id, '')) DO NOTHING` (`@AC-1`: the budget key is seeded);
   - the clamp (`@AC-2`: a stored value above the ceiling cannot keep the 68 s path): targets only
     `namespace = 'agent' AND key = 'opportunities.read_timeout_seconds'`, contains `user_id IS NULL`,
     `NOT is_secret`, the `CASE WHEN value_data ~ '…' THEN value_data::numeric > 44 ELSE false END` guard,
     sets `value_data = '44'`, the sentinel, a non-empty `update_reason` and `caller_identity = NULL`;
   - no other key or namespace is updated or deleted (no inverted-pair heal — the five cross-hop key names
     do not appear);
   - the notify CTE is `pg_notify('config_changed', …)` over `SELECT DISTINCT namespace, environment` of the
     seed and heal `RETURNING` sets, and the final `SELECT` references `nt`;
   - the migration number appears nowhere in the SQL.
3. Down — one statement: a `DELETE` scoped by the sentinel, `user_id IS NULL`, the seed key and
   `value_data = '35'`; contains no `UPDATE` and no `opportunities.read_timeout_seconds` (forward-only for
   the clamp); ends with the DISTINCT `pg_notify` over the delete's `RETURNING`.
4. PREPARE pin: read `scripts/migration-assertions/config-mcp-deadline-budget.sql` (path resolved from
   `__dirname`), extract the body of `PREPARE mdb_clamp AS … ;`, extract the `heal` CTE's inner statement
   from the up migration, collapse whitespace in both the same way, and assert they are equal. Also assert
   the assertion file starts its work with `BEGIN;` and ends with `ROLLBACK;`.
5. C-13: no domain fixtures; the sentinel and key literals have one consumer (this file) and stay inline.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
grep -n "__tests__/fixtures" src/__tests__/mcpDeadlineBudgetMigration.test.ts   # expect no hit (single-consumer inline literals, C-13)
```
RED capture (before Step 3's files exist): the suite fails with `expected exactly one *_mcp_deadline_budget.up.sql, got []`.

---

### Step 5 — service: whole-call budget for `extract_email_content` and `extract_website_content`

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify
- `scripts/config-wiring.json` — modify (delete the temporary `seeded-unread` entry added in Step 3)

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; no secret values in tool output

**Codebase Evidence**:
- `extract_email_content` at `tools.py:666`: input check `:683-684`; `src = await _get_source(source_slug)`
  `:686`; credential refusal `:688-689`; `texts: list[str] = []` `:691`; attachments loop `:693-697`; serial
  URL loop `for url in urls:` `:700` with `text = await _fetch_url(url, password=None)` `:701`; return
  `{"raw_text": "\n\n".join(texts)}` `:704`. No per-URL catch and no whole-call bound.
- `extract_website_content` at `:707`: `text = await _fetch_url(url, password=None, headers=request_headers)`
  `:738`; return `{"raw_text": text}` `:739`.
- `_fetch_url` at `:2847`: per-request policy reads `:2858-2861` (`extract.max_redirects`,
  `extract.max_bytes`, `extract.connect_timeout_seconds` 10.0, `extract.read_timeout_seconds` 30.0);
  `r.raise_for_status()` `:2898`; `except egress.EgressBlocked` → `ToolError("content fetch refused by
  egress policy")` `:2907-2910`.
- `_agent_policy(key, default, cast)` at `:2830-2845` — snapshot read through `read_config_value("agent",
  key)`; `_POLICY_READ_TIMEOUT_S = 3.0` at `:2827`.
- Guard to reuse: `if not math.isfinite(timeout_s) or timeout_s <= 0: timeout_s = 40.0` at `:1917-1918`
  (inside `list_opportunities`, `:1873`).
- `_get_source` at `:2774` calls `client.list_signal_sources`, which carries the 10 s bound as
  `timeout=_RPC_TIMEOUT_S` (`services/xstockstrat-agent/app/client.py:202`); `_RPC_TIMEOUT_S = 10.0` at
  `client.py:45`. `tools.py:2780` only cites `client._RPC_TIMEOUT_S` in the deadline error message.
- Imports at `tools.py:60-80`: `asyncio`, `math`, `logging` are imported; `httpx` is **not** (it is imported
  in `app/egress.py:16`; `httpx>=0.27.0` is a dependency, `pyproject.toml:7`). `log` at `:100`.
- Raise-class guard: `tests/test_tool_errors.py:430-446` allows only `ToolError` raises in `tools.py` apart
  from two counted exemptions.
- The agent watches global config only: `services/xstockstrat-agent/app/config/watcher.py:49`
  (`WatchConfigRequest` without a `user_id`).
- `_agent_policy` is a registered forwarder for the wiring check (`scripts/config-wiring.json`, `registry.forwarders`,
  `services/xstockstrat-agent/app/tools.py:_agent_policy`, `keyArg: 0`).
- New outbound gRPC calls: none — the header-propagation constraint does not apply.

**Lands with**: `Step 6`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add `import httpx` to the imports. Next to `_POLICY_READ_TIMEOUT_S` (`:2827`) add
   `_EXTRACT_CALL_BUDGET_DEFAULT_S = 35.0` with a ≤ 2-line comment stating the constraint (auth 10 s + source
   lookup 10 s + this ≤ 57 s), and a small helper `_extract_call_budget_s()` that reads
   `_agent_policy("extract.call_budget_seconds", _EXTRACT_CALL_BUDGET_DEFAULT_S, float)` once and returns the
   default when the value is non-finite or `<= 0` (the `:1917-1918` guard). The key is read through
   `_agent_policy` only — no second literal of the budget and no agent-side clamp to the config ceiling (R-4).
2. `extract_email_content`:
   - Read the budget once per call, after `_get_source` and after the attachments loop, and only when `urls`
     is non-empty. Attachments stay outside the budget.
   - Wrap the URL loop in a single `asyncio.timeout(budget)` scope (D-7, O-10). Keep the scope object and
     treat a `TimeoutError` as the budget expiring only when `scope.expired()` is true; otherwise re-raise.
   - Inside the loop, give each URL its own `try`: `httpx.TimeoutException` → record the URL under
     `deadline` and continue; any other `httpx.TransportError` → record it under `transport` and continue
     (`TimeoutException` subclasses `TransportError`, so order the handlers that way). Catch nothing else:
     the `ToolError` from an egress refusal and `httpx.HTTPStatusError` propagate unchanged (D-4, D-7).
   - When the budget expires, the URL in flight and every URL not yet tried are recorded under `deadline`.
   - All URLs fetched → return exactly `{"raw_text": "\n\n".join(texts)}` as today (no extra key).
   - Otherwise return `{"raw_text": <texts gathered so far, attachments included>, "error": "PARTIAL: N of
     M URLs not fetched (deadline: a, transport: b)", "unfetched_urls": [...]}` where `unfetched_urls` holds
     the caller's own URL strings in input order and M counts the `urls` argument.
   - Emit one `log.warning` per partial call with the counts and the exception class names only — never a
     URL, host or IP (FR-6 @feature-207, O-11).
3. `extract_website_content`: wrap the single `_fetch_url` call (`:738`) in the same budget.
   - Budget expiry → `raise ToolError(f"DEADLINE_EXCEEDED: content fetch did not complete within {budget:g}s")`.
   - Any `httpx.TransportError` (timeout subclasses included) → `raise ToolError(f"FETCH_FAILED: {type(e).__name__}")`.
   - Raise both `from None`, and never echo the source URL. Success still returns `{"raw_text": text}`.
4. Update both tools' docstrings (they are the `GET /api/tools` catalog text): the PARTIAL return shape for
   `extract_email_content`, the two new errors for `extract_website_content`, and the 35 s default budget
   (`agent` / `extract.call_budget_seconds`).
5. Do not change `_fetch_url`, `_agent_policy`, `list_opportunities`, `_RPC_TIMEOUT_S` or
   `_POLICY_READ_TIMEOUT_S`.
6. Delete the temporary `agent` / `extract.call_budget_seconds` `seeded-unread` entry from
   `scripts/config-wiring.json` (the reader now exists; leaving it fails as `STALE`).

**Verification**:
```bash
cd services/xstockstrat-agent && uv run ruff check . && uv run ruff format --check .
grep -n "extract.call_budget_seconds\|_EXTRACT_CALL_BUDGET_DEFAULT_S\|asyncio.timeout\|PARTIAL:\|FETCH_FAILED" app/tools.py
cd ../.. && node scripts/check-config-wiring.mjs --final     # exit 0, no STALE entry, key seeded and read under the same string
! grep -q "extract.call_budget_seconds" scripts/config-wiring.json   # exit 0 = no hit (temporary entry removed)
```
The agent test suite is green only with Step 6's edits in the tree (atomic unit).

---

### Step 6 — test: extract whole-call budget (`@AC-1`) and the affected guards

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_extract_call_budget.py` — create
- `services/xstockstrat-agent/tests/test_tools.py` — modify
- `services/xstockstrat-agent/tests/test_tool_deadlines.py` — modify

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- No extract timeout test and no trickling-bytes harness exist under `services/xstockstrat-agent/tests/`
  (recon.md § Risks; `grep -rn "trickle\|AsyncByteStream" services/xstockstrat-agent/tests/` → no hit):
  **Not found** — the harness is new.
- respx intercepts the pinned client above the connection-layer pin, so happy-path fetch tests use it
  (`tests/test_tools.py:2258-2260`); `respx>=0.21.0` is a dev dependency (`pyproject.toml:22`);
  `asyncio_mode = "auto"` (`pyproject.toml:33`).
- Helpers in `tests/test_tools.py`: `_make_server` `:33`, `_tool_fn` `:39`, `_website_source` `:2263`;
  source mocking with `patch.object(client, "list_signal_sources", AsyncMock(return_value=…))` `:258-260`.
- `tests/test_tools.py:2436-2477` (`@AC-2 @feature-247`) asserts `policy_reads == {…}` with exactly four
  `extract.*` keys (`:2472-2477`) and `pinned_calls == [{"connect_timeout": 10.0, "read_timeout": 30.0}]`
  (`:2471`).
- `tests/test_tool_deadlines.py:290-294` `test_fr3_worst_cases_fit_under_57s` sums the fixed budgets against 57.
- `tests/test_tool_errors.py:430-446` `test_tools_py_raises_only_tool_error`; `:353-355` list both extract
  tools in the backend-refusal table.
- Shared test helpers: `tests/conftest.py` (`_ctx` `:23`, `_rpc_error` `:69`, `config_snapshots` `:146`).
- `config_snapshots` is autouse and installs empty `agent` / `indicators` watchers, so policy reads fall back
  to code defaults (`tests/conftest.py:145-163`). A test sets snapshot values with
  `install_watcher(monkeypatch, namespace, **values)` (`tests/test_config_watcher.py:46-50`), imported by
  other suites as `from tests.test_config_watcher import _tool, install_watcher`
  (`tests/test_formula_deadline.py:10`, used at `:60`).
- Cross-source pin precedent in the agent suite: `test_unavailable_pass_strings_match_backend_sources`
  (`tests/test_tool_errors.py:179`).
- Coverage threshold: agent 40 % (`.github/workflows/ci.yml`, python matrix, `--cov-fail-under`).

**Lands with**: `Step 5`

**TDD**: `red-green required`

**Covers**: `AC-1`

**Instructions**:
1. `tests/test_extract_call_budget.py` — new. Build the trickle harness locally: an `httpx.AsyncByteStream`
   subclass that yields a small chunk on a short interval forever (each chunk arrives well inside the read
   timeout, so the per-chunk timeout never fires — the defect's shape), served through a respx route. Scale
   time by monkeypatching `tools._agent_policy` so `extract.call_budget_seconds` returns a sub-second budget
   and the other keys return their defaults. Bound every awaited call with a hang guard
   (`asyncio.wait_for(…, 10)`), so a missing budget fails instead of hanging.
   - `@AC-1` (name it): a source without credentials, three trickling URLs → the tool returns within the
     scaled budget plus a small margin; the response has `raw_text == ""`, `error == "PARTIAL: 3 of 3 URLs
     not fetched (deadline: 3, transport: 0)"` and `unfetched_urls` equal to the three input URLs in order.
   - Texts gathered so far: URL 1 answers fast, URL 2 trickles, URL 3 is never tried → `raw_text` holds
     URL 1's text, `error == "PARTIAL: 2 of 3 URLs not fetched (deadline: 2, transport: 0)"`,
     `unfetched_urls == [url2, url3]`. Add a variant with an attachment and assert its text is in `raw_text`.
   - Transport failure: URL 1 raises `httpx.ConnectError`, URLs 2 and 3 answer → both texts returned,
     `error == "PARTIAL: 1 of 3 URLs not fetched (deadline: 0, transport: 1)"`.
   - Per-URL httpx timeout: URL 1 raises `httpx.ReadTimeout`, URL 2 answers → counted under `deadline`, URL 2
     still fetched.
   - All succeed: the response is exactly `{"raw_text": …}` (`set(result) == {"raw_text"}`).
   - Egress refusal still aborts the whole call with `ToolError("content fetch refused by egress policy")`,
     even after an earlier URL succeeded (`@AC-7 @feature-207` preserved).
   - `httpx.HTTPStatusError` (a 404 route) still propagates unchanged.
   - One WARNING record on a partial call; neither it nor any other captured record contains a URL or host
     of the test routes.
   - `extract_website_content`: a trickling body → `ToolError` matching
     `DEADLINE_EXCEEDED: content fetch did not complete within` and the scaled budget in `:g` form; a
     `httpx.ConnectError` → `ToolError("FETCH_FAILED: ConnectError")`; neither message contains the source URL.
   - Budget guard: `_extract_call_budget_s()` returns `35.0` for a policy value of `0.0`, `-1.0`, `nan`,
     `inf`, and returns a valid value (e.g. `12.0`) unchanged.
   - Real reader against a snapshot (config-key wiring, impl-spec review): **without** patching
     `tools._agent_policy`, call `install_watcher(monkeypatch, "agent", **{"extract.call_budget_seconds":
     12.0})` (import it from `tests.test_config_watcher`; do not copy it) and assert
     `await tools._extract_call_budget_s() == 12.0`; then, with only the autouse empty snapshot (key absent),
     assert it returns `35.0`. This is the one case that runs the real `_agent_policy` →
     `read_config_value("agent", …)` path under the seeded key string.
2. `tests/test_tools.py:2472-2477`: add `"extract.call_budget_seconds": 35.0` to the expected `policy_reads`
   (the default policy now includes the whole-call budget — C-16 CHANGE to `@AC-2 @feature-247`, signed off
   2026-11-20). `pinned_calls` (`:2471`) stays as is.
3. `tests/test_tool_deadlines.py:290-294`: add to `test_fr3_worst_cases_fit_under_57s`
   `auth + client._RPC_TIMEOUT_S + tools._EXTRACT_CALL_BUDGET_DEFAULT_S <= 57`, and the same sum with the
   SetConfig ceiling of `agent.extract.call_budget_seconds` parsed from
   `services/xstockstrat-config/src/grpc/configServiceImpl.ts` (fail if the row is not found).
4. C-13: the trickle stream and the route URLs have one consumer (the new file) and stay inline; reuse
   `tests/conftest.py` helpers and the `tests/test_tools.py` builders by import where a second consumer
   would otherwise appear — do not copy `_website_source`.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run ruff check . && uv run ruff format --check . && uv run pytest --cov=app --cov-fail-under=40
grep -n "def .*fixture\|from .conftest\|conftest" tests/test_extract_call_budget.py   # C-13: shared helpers imported, no second inline copy
```
RED capture (before Step 5's edit): the `@AC-1` case fails on the hang guard / missing `error` key, the
website cases raise no `ToolError`, the budget-guard and real-reader cases fail on the missing helper, and
`tests/test_tools.py` fails on the `policy_reads` equality.

---

### Step 7 — test: `@AC-2` `list_opportunities` worst case at the SetConfig ceiling

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_list_opportunities_deadline.py` — modify

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- The file's hung-server template: `_start_hung_analysis_server` `:27-41`,
  `test_ac2_hung_analysis_read_fails_fast_with_deadline_error` `:45-68`, `_captured_timeout` `:71`,
  policy fallbacks `:79-109`; `_list_opportunities_fn` `:21-24`.
- The three legs of the worst case:
  - auth: `stub.ValidateToken(…, timeout=client._RPC_TIMEOUT_S)` in `validate_bearer_claims`
    (`services/xstockstrat-agent/app/auth.py:74-80`; the same call in `validate_bearer_jwt` `:41-46`);
  - policy read: `asyncio.wait_for(_agent_policy("opportunities.read_timeout_seconds", 40.0, float),
    _POLICY_READ_TIMEOUT_S)` (`tools.py:1910-1913`);
  - analysis: `client.list_opportunities(…, timeout=timeout_s)` (`tools.py:1920-1922`), mapped by
    `_grpc_error_message(e, deadline_s=timeout_s)` (`tools.py:1924`) to
    `… within {deadline_s:g}s (deadline exceeded); …` (`tools.py:263-271`).
- `_rpc_error(code, details)` builds an `AioRpcError` (`tests/conftest.py:69-73`).
- The ceiling row: `'agent.opportunities.read_timeout_seconds': { minValue: 30, maxValue: … }`
  (`services/xstockstrat-config/src/grpc/configServiceImpl.ts:152`; 44 after Step 1).
- `@AC-11 @feature-273` already pins the auth leg's own bound (`tests/test_auth_deadline.py:51`).

**TDD**: `red-green required`

**Covers**: `AC-2`

**Instructions**:
1. Add one test named for `@AC-2` that composes the three legs with an **injected clock** (a small object
   with `now` and `advance(seconds)`); no real waiting:
   - **Ceiling**: parse `maxValue` of `agent.opportunities.read_timeout_seconds` from the config registry
     source (path resolved from the test file; fail if the row is not found). The value is never written as
     a literal in the agent (R-4).
   - **Auth leg** ("identity answers ValidateToken just inside its 10 s deadline"): patch the identity stub
     used by `auth.validate_bearer_claims` with a fake whose `ValidateToken(request, metadata=…, timeout=…)`
     advances the clock by `timeout - 0.001` and returns valid claims with `aud == auth.AGENT_PUBLIC_URL`;
     assert the claims come back.
   - **Policy leg**: patch `tools._agent_policy` with a fake that advances the clock by
     `tools._POLICY_READ_TIMEOUT_S - 0.001` and returns the ceiling.
   - **Analysis leg** ("accepts the connection and never answers"): patch `client.list_opportunities` with a
     fake that advances the clock by the `timeout` it was given and raises
     `_rpc_error(grpc.StatusCode.DEADLINE_EXCEEDED)`.
   - Call the tool function; assert it raises `ToolError` whose text contains `deadline exceeded` and
     `within {ceiling:g}s`, and assert `clock.now <= 57.0`.
2. Add a non-tautology check in the same test: the same composition with the defect's ceiling `55` (a
   scenario one-off from the defect report) gives `> 57`.
3. **RED capture (working-tree mutation, never committed).** The committed history therefore holds no
   red-before-green for this test (C-08 / P-06, accepted trade-off — decision 6: the in-unit red→green for
   `@AC-2` is Step 2). The committed regression evidence is instruction 2's `55` → `> 57` check. Step 1
   already landed the ceiling, so capture
   RED by temporarily changing the registry row back to `maxValue: 55` in the working tree, running the new
   test (it must fail on `clock.now <= 57.0` with 68), then restoring the file with
   `git checkout -- services/xstockstrat-config/src/grpc/configServiceImpl.ts` and confirming `git status`
   shows only this step's file. Record both runs in context.md.
4. If the sum at the ceiling exceeds 57 for any reason other than the mutation, stop: the design's fallback
   to 43 is an operator decision, not an in-step change (P-03).
5. C-13: the fake clock has one consumer and stays inline.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run ruff check . && uv run ruff format --check . && uv run pytest --cov=app --cov-fail-under=40
git status --short services/xstockstrat-config/   # empty: the RED mutation was restored
grep -n "def .*fixture\|from .conftest\|conftest" tests/test_list_opportunities_deadline.py   # C-13: conftest helpers imported; the clock is the only new inline helper
```

---

### Step 8 — docs: key tables, tool contract, rollout runbook, findings

**Status**: `pending`
**Service**: `docs/`, `services/*/CLAUDE.md`
**Files**:
- `services/xstockstrat-agent/CLAUDE.md` — modify
- `services/xstockstrat-portfolio/CLAUDE.md` — modify
- `docs/patterns/config-governance.md` — modify
- `docs/runbooks/mcp-tools.md` — modify
- `docs/runbooks/config-rollout.md` — modify
- `docs/context-constitution.md` — modify
- `docs/context-constitution-findings.md` — modify
- `services/xstockstrat-config/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-portfolio/docs/context-constitution-findings.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Agent key table: `services/xstockstrat-agent/CLAUDE.md:112` (§ Config Keys Consumed), extract rows
  `:126-128`, `opportunities.read_timeout_seconds` row `:129` ("bounded `[30,55]`").
- Stale portfolio text: `services/xstockstrat-portfolio/CLAUDE.md:88` ("Must exceed
  max(`marketdata.quotes.batch_timeout_ms` (2500), `marketdata.quotes.mark_timeout_ms` (500)) plus the warm
  read"), written against the batch default, while the batch ceiling is 5000.
- `docs/patterns/config-governance.md`: author-sentinel table `:128-144` (number-free sentinel row `:143`);
  § Per-Feature Registered Keys `:146` (newest first; feature 366 at `:152`, feature 330 at `:173`); feature
  227 table row `:455` (`[30,55]`); feature 207 section `:484-498`.
- `docs/runbooks/mcp-tools.md`: `extract_email_content` `:194` (Return and Errors table below it),
  `extract_website_content` `:228`, `list_opportunities` section `:1198`, its errors `:1277-1280` ("bounds
  `[30,55]`" at `:1279`).
- `docs/runbooks/config-rollout.md`: § Step 3 — Rollout Multiple Keys `:154-176` (sequential `SetConfig`,
  no batch write); § Step 6 — Post-Deploy Read-Back `:217-228`.
- PLAT-13: `docs/context-constitution.md:37` ("The ordering is **not** enforced by per-key bounds (see
  findings).").
- Findings rows: root `docs/context-constitution-findings.md:51`; config
  `services/xstockstrat-config/docs/context-constitution-findings.md:24`; portfolio
  `services/xstockstrat-portfolio/docs/context-constitution-findings.md:27`. The defect-report index rows
  (root `:93`, config `:58`, portfolio `:61`) and the `docs/reports/*.status` sidecars (`triaged`, `ref:
  feature:314-fix-mcp-deadline-budget`) are **not** edited here; they close at launch.
- Operator SQL access: `docs/runbooks/operator-db-access.md`.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. `services/xstockstrat-agent/CLAUDE.md`: add a row for `extract.call_budget_seconds` (float, `35`,
   whole-call budget for the `extract_*` URL fetches, non-finite / `≤ 0` → `35`, SetConfig-bounded `[5,35]`,
   seeded by the `*_mcp_deadline_budget` config migration); change `:129` to `[30,44]` with the 10 + 3 + v ≤
   57 s reason; add one line that per-user rows of `opportunities.read_timeout_seconds` are never read
   (global watch) and that a future per-user watch must re-run the clamp.
2. `services/xstockstrat-portfolio/CLAUDE.md:88`: replace the stale clause — the order `quote_timeout_ms` >
   max(`quotes.batch_timeout_ms`, `quotes.mark_timeout_ms`) is enforced at `SetConfig` for global writes
   (strict `>`, prevents inversion only), and a write that would invert it is refused.
3. `docs/patterns/config-governance.md`: add a "feature 314 — fix-mcp-deadline-budget" section at the top
   of § Per-Feature Registered Keys (the new key's full contract: namespace `agent`, key
   `extract.call_budget_seconds`, float, default 35, bounds [5,35], reader `tools.py:_extract_call_budget_s`
   via `_agent_policy`, seed migration by suffix, live via the config snapshot; the ceiling change; the
   `CROSS_KEY_ORDERING` rule with its two rows, global-only scope and remedy; the migration's clamp and
   sentinel). Change `:455` to `[30,44]`. Add the sentinel
   `system:config-migration-feature-fix-mcp-deadline-budget` to the author-sentinel table.
4. `docs/runbooks/mcp-tools.md`: for `extract_email_content`, document the partial return
   (`raw_text`, `error` `PARTIAL: N of M URLs not fetched (deadline: a, transport: b)`, `unfetched_urls`),
   the 35 s whole-call budget and that it can cut off a fetch that used to finish after 35 s; for
   `extract_website_content`, add the `DEADLINE_EXCEEDED: content fetch did not complete within Ns` and
   `FETCH_FAILED: <ExceptionClass>` rows; change `:1279` to `[30,44]`.
5. `docs/runbooks/config-rollout.md`: in § Step 3 add the cross-key write order — **raise the greater key
   first** (`portfolio` / `marketdata.quote_timeout_ms`, `analysis` / `opportunity.live_enrich_timeout_ms`),
   then the lesser; the gate covers global writes only; two concurrent writes to a greater and a lesser key
   can each pass against the other's old value (accepted residual), so apply them one after the other. Add a
   short section for this migration: it notifies by itself; the pre-deploy and post-rollout read-only
   queries from Step 9 (the old config image accepts 45–55 between the db-migrator run and the new image
   going live); inverted pairs are fixed by ordered `SetConfig`, never SQL; the "unenumerated" sign-off
   fallback. Keep every shell snippet macOS-compatible.
6. `docs/context-constitution.md:37` (PLAT-13): replace the last sentence — the two orderings are enforced
   at `SetConfig` for global writes by `CROSS_KEY_ORDERING`; add the agent chains (auth 10 + policy read 3 +
   `opportunities.read_timeout_seconds` ≤ 44; auth 10 + source lookup 10 + `extract.call_budget_seconds` ≤ 35).
7. Findings: remove the three latent-bug rows (root `:51`, config `:24`, portfolio `:27`) or mark them
   resolved by feature 314, following the convention each file already uses for resolved rows.
   Add one new row to `services/xstockstrat-config/docs/context-constitution-findings.md` (doc-drift, in the
   file's existing row format): the stored description of `agent` / `opportunities.read_timeout_seconds`
   (seeded by `041`) still says "SetConfig-bounded `[30,55]`" while the enforced bound is `[30,44]`; the
   registry bounds returned by `ListKeys` are authoritative (decision 8). Skip this row only if the operator
   chose to rewrite the description instead.
8. Durable `acceptance/*.feature` suites are not edited here: this feature's scenarios are promoted at the
   integration PR (C-16), where the four signed-off CHANGEs (`@AC-2` of this feature, `@AC-6 @feature-207`,
   `@AC-2 @feature-247`, `@AC-1 @feature-229`) are applied.

**Verification**:
```bash
node scripts/check-config-wiring.mjs --doc-check
grep -rn "\[30, *55\]\|30,55" services/xstockstrat-agent/CLAUDE.md docs/patterns/config-governance.md docs/runbooks/mcp-tools.md   # expect no hit
grep -n "extract.call_budget_seconds" services/xstockstrat-agent/CLAUDE.md docs/patterns/config-governance.md docs/runbooks/mcp-tools.md
grep -n "PARTIAL: \|FETCH_FAILED" docs/runbooks/mcp-tools.md
grep -n "raise the greater key\|unenumerated" docs/runbooks/config-rollout.md
cd services/xstockstrat-agent && uv run pytest tests/test_extraction_instructions.py tests/test_list_correlation_parity.py tests/test_ingest_signal_watchlist.py -q   # mcp-tools.md parity suites still pass
```

---

### Step 9 — docs: enumeration and read-back per environment (operator-run)

**Status**: `pending`
**Service**: `xstockstrat-config` (live databases; results recorded in `context.md`)
**Files**:
- `docs/roadmap/features/314-fix-mcp-deadline-budget/context.md` — modify (results only)

**Reviewers**: xstockstrat-config owner — environment (`production`/`staging`) / global-per-user scoping, WatchConfig stream stability

**Codebase Evidence**:
- `docs/runbooks/config-rollout.md:217-228` § Step 6, Post-Deploy Read-Back: read every touched key back in
  each environment and record the result in `context.md`.
- Sanctioned direct SQL access: `docs/runbooks/operator-db-access.md`.
- Spec-time partial enumeration (decision 2): staging global rows are clean; production, per-user rows and
  raw `value_data` are not enumerated; the sign-off stands as "unenumerated".
- The old config image keeps accepting 45–55 until the new image is live (design.md § Open Risks).

**TDD**: `N/A (operator-run observation of live rows)`

**Covers**: — (advisory live-row evidence for `AC-2`; not a coverage step)

**Gate strength (impl-spec review).** This step is advisory evidence, not an automated gate, and is
categorised `docs` (operator-run, results in context.md) rather than `test`: it has no coverage threshold
and its pass criteria are the operator's readings. The automated `@AC-2` gates are Steps 2, 4 and 7. It exists because live rows can differ from the repo tree and because
the heal scope was not enumerated at spec time.

**Instructions**:
1. **Pre-deploy** (before the integration PR merges), on the staging and the production database, through
   `docs/runbooks/operator-db-access.md`:
   ```sql
   SELECT environment, user_id IS NULL AS global, value_type, value_data, updated_by,
          value_data ~ '^[+-]?([0-9]{1,30}(\.[0-9]{0,30})?|\.[0-9]{1,30})([eE][+-]?[0-9]{1,3})?$' AS matches_numeric
   FROM config.config_values
   WHERE namespace = 'agent' AND key = 'opportunities.read_timeout_seconds'
   ORDER BY environment, global DESC;

   SELECT environment, namespace, key, value_data
   FROM config.config_values
   WHERE user_id IS NULL
     AND (namespace, key) IN (('portfolio', 'marketdata.quote_timeout_ms'),
                              ('marketdata', 'quotes.batch_timeout_ms'),
                              ('marketdata', 'quotes.mark_timeout_ms'),
                              ('analysis', 'opportunity.live_enrich_timeout_ms'),
                              ('marketdata', 'price.batch_timeout_ms'))
   ORDER BY environment, namespace, key;
   ```
   Record in context.md, per environment: (a) global rows above 44 (the clamp will move them — the operator
   confirms that is acceptable), every global row with `matches_numeric = false` (fix by `SetConfig` before
   deploy), and the per-user rows above 44 (reported only, never rewritten); (b) every inverted pair (quote
   ≤ max(batch, mark); enrich ≤ price). Replace the "unenumerated" sign-off with the operator's sign-off on
   these lists, or record that it stays "unenumerated".
2. **Inverted pairs** found in (b): fix with ordered `SetConfig` after the new config image is live —
   raise the greater key first. Never by SQL (D-13, R-11).
3. **Post-rollout** (after the dev app, and later the production app, runs the new config image): re-run
   the first query. Pass per environment: every global row matches and is ≤ 44. A row at 45–55 was written
   through the old image in the deploy window — lower it with `SetConfig`.
4. **Read-back** on each environment's agent MCP: `get_config(namespace="agent")` lists
   `extract.call_budget_seconds` = `35.0` (float) and `opportunities.read_timeout_seconds` ≤ 44;
   `list_config_keys(namespace="agent")` shows the new key once.
5. **Smoke**: call `list_opportunities` and one `extract_website_content` on dev; both answer. Record any
   observed latency that suggests an unmodelled term in the 57 s worst case (decision 9).

**Verification**:
```bash
node scripts/check-config-wiring.mjs --final      # clean on the deployed commit
grep -n "Step 9\|enumerat" docs/roadmap/features/314-fix-mcp-deadline-budget/context.md   # the per-environment results and the sign-off are recorded
```
Pass criteria are the operator's readings in instructions 1, 3 and 4.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Steps 1+2 — Step 2 Verification block exits 1 on success (2026-11-26)
- **Spec said**: Step 2's Verification ends with `grep -n "__tests__/fixtures" … # expect no new import`.
- **Actual**: on a passing tree that grep matches nothing and exits 1, so the block's exit is 1 and it hides
  the exit of the `lint && test:coverage && c8 check-coverage` line. The block also cannot run as written
  inside one `( … )` subshell, because the inline `#` comment swallows a closing paren on the same line. The
  executor put the paren on its own line.
- **Disposition**: the block was run verbatim and judged from its log: lint 0 errors, `ℹ pass 419` /
  `ℹ fail 0`, coverage lines 92.63 % with no c8 `ERROR` line, and the grep printed nothing. No spec edit.

### Steps 3+4 — Step 4 Verification block exits 1 on success (2026-11-26)
- **Spec said**: Step 4's Verification ends with `grep -n "__tests__/fixtures" … # expect no hit`.
- **Actual**: this is the same problem as the Steps 1+2 entry above. On a passing tree the grep matches
  nothing and exits 1, so the block exits 1 and hides the exit of the `lint && test:coverage && c8
  check-coverage` line. The executor put the closing paren on its own line, as before.
- **Disposition**: the block was run verbatim and judged from its log `.sdd-logs/v-3.log`. Lint reported
  0 errors, the tests `# pass 427` / `# fail 0`, coverage `All files | 92.63` lines with no c8 `ERROR`
  line, and the grep printed nothing. No spec edit.
