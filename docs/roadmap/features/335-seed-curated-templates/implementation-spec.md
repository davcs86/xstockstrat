# Implementation Spec: seed-curated-templates

**Status**: `pending`
**Created**: 2026-11-12
**Feature**: `docs/roadmap/features/335-seed-curated-templates/feature.md`
**Total Steps**: 30
**Feature Branch**: `feature/seed-curated-templates`

---

Paths: `indicators/`, `analysis/`, `ingest/`, `agent/`, `ui/`, `identity/` abbreviate
`services/xstockstrat-<name>/`. Every `path:line` below was read on the tree
`ccr-4bdb931f-mr7ofl@4798326` (= `origin/main-dev@cee3bae` + 12 docs-only commits that add only this
feature directory and one ledger entry; 0 behind `origin/main-dev`). `origin/feature/seed-curated-templates`
does not exist yet (`git ls-remote --exit-code --heads` → 2); `/sdd-execute` creates it from `main-dev`.
`recon.md` was written on `@6c940a8`; the affected source paths have not changed since.

"D-n" / "R-n" are `debate.md` ids. "Seeded ids" means the 9 + 14 + 4 `tpl-*` ids fixed in Steps 13, 16
and 20.

## Execution Summary

The work has two halves that meet at the seed migrations. **Guard half** (Steps 2–9): the additive
proto field and its stubs, then the `ManageTemplate` read-only guard and the server-set `read_only`
flag in indicators, analysis and ingest, each with its tests. **Seed half** (Steps 1, 10–23): the
staging export query is committed first so the operator can run it while the guard half is built;
then the parity checker; then the operator's raw export is committed (Step 12, a human gate); then one
atomic unit per service (indicators → analysis → ingest) holding the seed migration, its real-PostgreSQL
assertions and its validity test; then one whole-catalog test. Guards come before seeds because the
seed validity tests assert `read_only = true` through the real row mappers. Indicators comes before
analysis because the analysis test validates the 14 strategy templates against the 9 formula templates
parsed from the indicators seed file. The consumer surfaces follow (UI Steps 24–25, Agent Steps 26–28),
and the docs are last (Steps 29–30).

**Consumer surfaces (C-14).** The product spec names two. **UI** — `/config-ui` templates page: Steps
24–25. `/insights` template views and `admin@localhost`'s strategies list render the seeded rows through
existing code and need no change (design.md § Chosen Approach 2; D-18). **Agent** — `list_templates`:
Steps 26–28. `instantiate_template` needs no change.

**Decisions taken here that the reviewer should check** (all recorded in `context.md`):

1. **D-38 is realised as three per-service atomic units, not one.** `design.md` § Landing asks for the
   four migrations, their tests/assertions and the `migration-rerun.py` version bump as one
   `Lands with` unit. With tests and assertions that is 10 steps across three services;
   `step-constraints.md` §C caps a unit at 4. The seam is the service: each unit carries its own seed
   migration, the deletion of its predecessor's "has seed rows" assertion, and its own element of the
   `migration-rerun.py:1114` tuple (ingest 15→16 in Step 21, analysis 27→29 in Step 18; indicators has
   no element there), so the `migration-rerun` job is green after each unit alone. D-38's reason ("the
   version assertion fails otherwise") is met per unit, and the three still reach `main-dev` together in
   the one integration PR.
2. **The export is two steps.** Design's "first implementation step" is split into Step 1 (the
   read-only query, committed by the executor) and Step 12 (the operator's raw output, committed
   unedited). Steps 2–11 and 24–28 need only the query's output *format*, not the output.
3. **Formula template ids.** FR-10 says "a snake_case slug of the name" without defining it. Rule used
   here: lowercase; every run of characters outside `[a-z0-9]` becomes one `_`; leading/trailing `_`
   stripped; prefix `tpl-`. It reproduces the one formula id the acceptance scenarios pin
   (`tpl-kaufman_efficiency_ratio`, AC-23). The nine ids are listed in Step 13.
4. **Template row `name` / `description`.** Not fixed by `design.md`. Formula: the payload's own `name`
   and `description`. Strategy: `name` = the staging `display_name`, `description` = `''`
   (`StrategyDefinition` has no description field, `packages/proto/analysis/v1/analysis.proto:343-393`).
   Source: `name` = `display_name`, `description` = `''`.
5. **D-36(c) fake `GetFormula`.** D-36 builds it "from the code module". That module lives in the
   indicators service (`indicators/app/formulas/fundamentals_value_quality.py`) and imports
   `app.formulas`, which resolves to the analysis package inside the analysis test run, so it cannot be
   imported there. Step 19 builds the fake from the seeded composite template payload instead, which
   Step 15 pins to the code module field by field (FR-11).
6. **AC-39 needs an expected failure inside an assertion file.** No assertion file does this today
   (grep `ON_ERROR_STOP`, `SAVEPOINT`, `LAST_ERROR` over `scripts/migration-assertions/` → no hits).
   Step 14 specifies the psql pattern; it can only be proven in CI (see Step Dependencies, "CI is the
   live run").
7. **The checker takes `--kind`.** Each seed unit must prove its own parity before it commits (F-08
   forbids a later step from repairing an earlier step's files), so
   `scripts/check-seed-template-parity.py` can be limited to one kind.
8. **A stale UI string is left alone.** `ui/src/app/config-ui/templates/page.tsx:323-328` tells an admin
   "The catalog starts empty." It renders only when a kind lists zero templates, which no longer happens
   after the seeds. Rewording it is outside `design.md`; raised here rather than changed.

## Scenario Coverage (C-15)

| Scenario | Step(s) | Scenario | Step(s) | Scenario | Step(s) |
|---|---|---|---|---|---|
| AC-1 | 14, 15 | AC-20 | 15 | AC-31 | 18, 19 |
| AC-2 | 15 | AC-21 | 15 | AC-32 | 18 |
| AC-3 | 18, 19 | AC-22 | 15, 19, 22 | AC-33 | 18 |
| AC-4 | 19 | AC-23 | 14 | AC-34 | 18 |
| AC-5 | 19 | AC-24 | 14, 18, 21 | AC-35 | 23 |
| AC-6 | 22 | AC-25 | 18 | AC-36 | 11, 19, 23 |
| AC-7 | 22 | AC-26 | 5, 7, 9 | AC-37 | 19 |
| AC-9 | 14 | AC-27 | 5 | AC-38 | 19 |
| AC-11 | 21 | AC-28 | 5 | AC-39 | 14 |
| AC-12 | 21 | AC-29 | 25 | AC-40 | 21 |
| AC-14 | 11 | AC-30 | 27 | | |
| AC-18 | 21 | | | | |
| AC-19 | 15, 19, 22 | | | | |

AC-8, AC-10, AC-13, AC-15, AC-16 and AC-17 are retired by comment in `acceptance.feature` and have no
`Scenario:` block. Steps 14, 18 and 21 are `migration`-category assertion files run by the CI job
`migration-rerun` against a real PostgreSQL; they are the only place the replay, down and collision
scenarios (AC-9, 11, 12, 18, 23, 24, 25, 31–34, 39, 40) can run, because `/sdd-execute` never starts a
database.

## Step Dependencies

- **Operator gate.** Step 12 needs the operator to run Step 1's query on staging and hand back the
  output. Ask for it as soon as Step 1 is committed. Steps 13–23 are blocked until Step 12 is done.
  Steps 2–11 and 24–28 do not depend on it; if the output is still outstanding after Step 11, run
  `/sdd-execute seed-curated-templates 24` … `28` first.
- **Authoring source for the seed text.** The export carries formula `source` and `description` only
  as md5 (D-21), so for Step 13 the executor reads those two texts from staging through the agent MCP
  tool `get_formula` (staging server) and Step 12's snapshot proves the transcription byte for byte.
  Everything else in Steps 13, 16, 17 and 20 — names, `display_name`, `extractor_module` and every JSON
  column — is copied from the snapshot, never from tool output. If the staging MCP tools are not
  available in the execute session, Step 13 (and so its unit) is blocked (P-03); nothing is
  reconstructed from memory or from this document.
- Steps 2+3 land together: a `.proto` edit and its stubs (`step-constraints.md` §C row 2; CI
  `proto-freshness`). No descriptor-parity guard covers `TemplateMeta`
  (`grep -rln "_MAPPED\|covers_every_proto_field\|DESCRIPTOR.fields" services` → 13 files, none
  mentions `TemplateMeta`; `grep -rl TemplateMeta services` → the three servicers and their three
  template test files plus `analysis/tests/test_strategy_templates_real_pg.py`, which only constructs
  one).
- Step 3 needs the codegen toolchain, which is absent here (`which buf` → nothing; `docker info` →
  daemon unreachable). Provision it per `docs/runbooks/codegen-toolchain-host-setup.md` and pass its
  empty-diff check **before** Step 2's edit.
- Steps 4, 6 and 8 require Step 3 (`TemplateMeta(read_only=…)` must exist in the Python stubs).
- Steps 4+5, 6+7 and 24+25 each land together so the RED is a behaviour failure proven before the
  implementation (P-06): the test step's system-row cases are written first and fail on the unguarded
  handler / unbadged page, then the service step turns them green and both are committed as one unit.
  Existing tests in those suites stay green throughout — the in-memory repos already implement `get`
  and stamp `created_by` (`indicators/tests/test_formula_templates.py:65-66,77`;
  `analysis/tests/test_strategy_templates.py:96-97,65`).
- Steps 8+9 land together: Step 8 adds a `source_templates.get` call before UPDATE/RETIRE, and three
  existing tests run those operations on `make_servicer(db=MagicMock())` with only `update`/`retire`
  patched (`ingest/tests/test_source_templates.py:196-209,254-263,266-277`). An unpatched `get` awaits a
  `MagicMock` and raises `TypeError` (§C row 1).
- Steps 10+11 land together: the test imports the script by path (`scripts/tests/conftest.py:12-18`
  `load_script`), so without the script its RED is an import error, not a behaviour failure (§C row 3).
- Steps 13+14+15, 16+17+18+19 and 20+21+22 each land together (decision 1). In each unit the validity
  test is written first and fails because the seed file does not exist; the assertion-file step deletes
  the predecessor's "has seed rows" block, which the post-pass-3 sweep would otherwise raise on
  (`scripts/migration-rerun.py:1119-1120`; ledger `fails.md` 2026-11-10 `config-keys-alias-removal`).
- Step 19 requires Step 13 (it parses the indicators seed file). Step 16 requires Step 13 (every
  strategy template references seeded formula template ids).
- Step 23 requires Steps 13–22 (all three seed files and the four assertion files exist).
- Step 24 requires Step 3 (`readOnly` on the generated TS `TemplateMeta`). Step 25 [test] covers
  Step 24.
- Steps 26+27+28 land together: Step 27 asserts text that Step 26 (tool docstring) and Step 28
  (`docs/runbooks/mcp-tools.md`) add.
- **Migration numbers are re-derived at merge** (C-07; ledger `fails.md` 2026-08-06 `migration`).
  `008` / `028` / `029` / `016` are max+1 on this tree (tips `007_private_formulas_templates`,
  `027_contract_owner_dimension`, `015_backfill_webhook_callback`). Only `origin/main-dev` and this
  branch are fetched locally, so the union-of-refs scan could not be re-run here; `/sdd-review`'s
  overlap scan found no claimant (`context.md`). A renumber touches: the migration file names, the
  assertion file names and their `\ir` lines, the `migration-rerun.py:1114` tuple, and Steps 29–30's docs.
  Tests and the checker find seed files by slug glob and need no edit (D-10).
- **CI is the live run for all SQL.** `/sdd-execute` never starts a database
  (`.claude/skills/sdd-execute/SKILL.md:311-317`), so Steps 13, 14, 16–18, 20, 21 verify offline with a
  `pglast` parse (ledger `insights.md` 2026-11-10 `config-dead-rows-prune`), and the `migration-rerun`
  job on the integration PR is the first real execution. Budget CI iterations for the three assertion
  steps, especially the AC-39 expected-failure block (ledger `fails.md` 2026-11-10
  `fix-config-keys-contract`: six defects, one per CI run).
- **Feature 318** `fix-migration-tooling-safety` (spec-ready) reworks dirty-recovery replay and touches
  `scripts/migration-rerun.py`. Re-check its branch before Steps 18 and 21 edit line 1114.
- **C-16 promotion is not a step.** At integration `/sdd-execute` promotes this feature's scenarios;
  the durable `@AC-15 @feature-224` "Catalog starts empty after migration"
  (`docs/sdd/business-rules/platform.feature:270`) is superseded by comment plus a new `@feature-335`
  scenario, never rewritten (D-25, R-6).
- **Before merge (operator):** the production and homelab checks recorded in Step 12 must show
  `fundsignal.source_slug = fundamentals` and no pre-existing `tpl-*` row (design.md Open Risks; D-24).

---

### Step 1 — test: staging export query (parity reference, part 1)

**Status**: `done`
**Service**: `scripts/` (repo tooling)
**Files**:
- `scripts/testdata/seed-templates-staging-export.sql` — create

**Reviewers**: DBA — read-only by construction, no cross-tenant read beyond the named owner; `xstockstrat-indicators` owner — formula columns; `xstockstrat-analysis` owner — strategy columns; `xstockstrat-ingest` owner — source columns, no credential column

**Codebase Evidence**:
- Sanctioned access path: `docs/runbooks/operator-db-access.md:42-57` (`psql "<uri>?sslmode=require" -v ON_ERROR_STOP=1`), and `scripts/db-connect.py:33-38` (`db-connect.py -d xstockstrat-staging -- <psql args>`).
- Formula columns: `indicators/app/services/formulas_repository.py:46-51` (`formula_id, name, description, source, author, input_schema, parameters, outputs, warmup_period, fundamental_inputs`); `deleted_at` from `indicators/migrations/005_add_formula_soft_delete.up.sql:5`. `parameters` / `outputs` are stored as `MessageToDict` dicts (camelCase) and `fundamental_inputs` as integers (`indicators/app/handlers/servicer.py:472-473,497-500`).
- Strategy columns: `analysis/app/repositories/strategies.py:44-46` (`user_id, strategy_id, display_name, definition_json`), `active` (`analysis/migrations/001_strategies.up.sql:5`), `live_enabled` (`analysis/migrations/002_strategy_live_enabled.up.sql:1`).
- Source columns: `ingest/app/repositories/signal_sources.py:157-161` (`slug, display_name, source_type, extractor_module, credentials_ref, config_json, active, reliability_weight, user_id`).
- System formula id `d1ff5e6b-6d9c-589d-b95e-defd862c702b`: `indicators/app/formulas/fundamentals_value_quality.py:10,22-24`; its author is `SYSTEM_AUTHOR` (`:27`), so it is not selected by an owner filter.
- Existing reference-data home: `scripts/testdata/rpc-status-vectors.json`. **Not found**: any `.sql` file under `scripts/testdata/` — this is the first.

**TDD**: `N/A (reference query; no code path executes it in this repo)`

**Covers**: — (it produces the reference that Steps 11 and 23 test against)

**Instructions**:
1. Create one psql script that prints exactly one JSON document and writes nothing. First line a
   comment giving the run command:
   `psql "<staging uri>?sslmode=require" -v ON_ERROR_STOP=1 -At -v owner=<operator user id> -f scripts/testdata/seed-templates-staging-export.sql > scripts/testdata/seed-templates-staging-2026-11-12.json`.
2. Body: `BEGIN TRANSACTION READ ONLY;`, one `SELECT jsonb_pretty(jsonb_build_object(...));`, `ROLLBACK;`.
   No `SET`, no temp table, no function.
3. The document has four keys:
   - `exported_at` — `now()`.
   - `strategies` — from `analysis.strategies` where `user_id = :'owner'` and `strategy_id` is one of
     the 14 ids in product-spec FR-2, ordered by `strategy_id`. Per row: `strategy_id`, `display_name`,
     `active`, `live_enabled`, `definition_json` (raw).
   - `formulas` — from `indicators.formulas`, ordered by `name`, the union of: rows with
     `author = :'owner'`, `deleted_at IS NULL` and `name` one of the eight non-composite names in
     FR-1; the row with `formula_id = 'd1ff5e6b-6d9c-589d-b95e-defd862c702b'`; and every row whose
     `formula_id::text` appears as a `formula_id` in the `components` of the 14 selected
     `definition_json` documents (so a reference to an unlisted formula is visible to the checker).
     Per row: `formula_id`, `name`, `author`, `source_md5` (`md5(source)`), `description_md5`
     (`md5(description)`), `parameters`, `outputs`, `warmup_period`, `fundamental_inputs`,
     `input_schema` (raw).
   - `sources` — from `ingest.signal_sources` where `user_id = :'owner'` and `slug` is one of
     `sec_edgar_8k`, `sec_edgar_form4`, `prnewswire_releases`, `robinhood_snacks`, ordered by `slug`.
     Per row: `slug`, `display_name`, `source_type`, `extractor_module`, `reliability_weight`,
     `config_json` (raw). **Never select `credentials_ref`.**
4. Hashes are taken of the text columns only; JSON columns are exported raw and never hashed
   (`md5(jsonb::text)` is not stable, D-21).
5. Tell the operator the file is ready and ask for the run (Step 12). Record the request in
   `context.md`.

**Verification**:
```bash
uv run --no-project --with pglast python3 - <<'EOF'
from pglast import parse_sql
sql = "\n".join(l for l in open("scripts/testdata/seed-templates-staging-export.sql").read().splitlines() if not l.startswith("\\"))
sql = sql.replace(":'owner'", "'o'")
stmts = parse_sql(sql)
kinds = [type(s.stmt).__name__ for s in stmts]
assert kinds == ["TransactionStmt", "SelectStmt", "TransactionStmt"], kinds
print("ok", kinds)
EOF
grep -c "credentials_ref" scripts/testdata/seed-templates-staging-export.sql   # expect 0
grep -ciE "\b(insert|update|delete|create|alter|drop|truncate)\b" scripts/testdata/seed-templates-staging-export.sql   # expect 0
```

---

### Step 2 — proto: `read_only` on `common.v1.TemplateMeta`

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/common/v1/common.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness per message, no breaking changes, `buf lint` / `buf breaking` pass; `xstockstrat-indicators` owner — formula template mapping; `xstockstrat-analysis` owner — strategy template mapping; `xstockstrat-ingest` owner — source template mapping; `xstockstrat-ui` owner — Connect-RPC call safety; `xstockstrat-agent` owner — MCP tool contract stability

**Codebase Evidence**:
- `packages/proto/common/v1/common.proto:126-135` — `message TemplateMeta` uses fields 1–8 (`template_id` … `updated_at`); 9 is free.
- Consumers of the message: `indicators/app/handlers/servicer.py:854`, `analysis/app/handlers/servicer.py:7305`, `ingest/app/handlers/servicer.py:187` (the only three constructors outside tests).

**Lands with**: `Step 3`

**TDD**: `N/A (proto)`

**Covers**: —

**Instructions**:
Add `bool read_only = 9;` after `updated_at = 8` with a one-line comment: set by the server; true for a
platform-seeded (`created_by = 'system'`) template, which `ManageTemplate` refuses to UPDATE or RETIRE.
Change nothing else in the file.

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against "../../.git#branch=main-dev,subdir=packages/proto"
```

---

### Step 3 — proto-gen: regenerate Go / Python / TypeScript stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/common/v1/common.pb.go` — modify (generated)
- `packages/proto/gen/python/common/v1/common_pb2.py` — modify (generated)
- `packages/proto/gen/ts/common/v1/common.ts` — modify (generated)
- `packages/proto/gen/ts/common/v1/common_pb.ts` — modify (generated)
- `packages/proto/gen/ts/dist/common/v1/common.d.ts` — modify (generated)
- `packages/proto/gen/ts/dist/common/v1/common.js` — modify (generated)
- `packages/proto/gen/ts/dist/common/v1/common_pb.d.ts` — modify (generated)
- `packages/proto/gen/ts/dist/common/v1/common_pb.js` — modify (generated)

Only these eight `common/v1` outputs may change: `TemplateMeta` is the only edited message. Any other
path in `git diff --name-only packages/proto/gen/` is a toolchain-mismatch diff — stop and fix the
toolchain, do not stage it (F-08).

**Reviewers**: inherited from Step 2

**Codebase Evidence**:
- `./scripts/buf-gen.sh` regenerates all three languages and compiles the TS package (root `CLAUDE.md` § Generating Proto Stubs).
- Toolchain absent on this host: `which buf` → not found; `docker info` → unreachable. Host provisioning: `docs/runbooks/codegen-toolchain-host-setup.md`.
- Ledger `fails.md` 2026-11-04 `fix-fundsignal-emit-accounting`: a host-native run can produce a spurious diff from a mismatched plugin toolchain; the final diff must be exactly the intended lines.
- Ledger `fails.md` (007 `signal-source-weighting`): regenerated stubs can raise the minimum `grpcio`; compare against each Python service's `uv.lock`.

**Lands with**: `Step 2`

**TDD**: `N/A (proto-gen)`

**Covers**: —

**Instructions**:
1. Before Step 2's edit, provision the toolchain and confirm `./scripts/buf-gen.sh` leaves
   `git diff packages/proto/gen/` empty.
2. After Step 2's edit, run `./scripts/buf-gen.sh`. Never hand-edit a generated file.
3. Confirm the diff is confined to the `common/v1` stubs (and the TS `dist/` build of them) and adds
   only the `read_only` / `readOnly` field.
4. If the generated Python stubs now require a newer `grpcio` than `indicators/uv.lock`,
   `analysis/uv.lock`, `ingest/uv.lock` or `agent/uv.lock` pin, stop and raise it (do not bump silently).

**Verification**:
```bash
./scripts/buf-gen.sh
git diff --name-only packages/proto/gen/ | grep -v "/common" ; echo "(expect no path printed above this line)"
grep -n "read_only\|readOnly\|ReadOnly" packages/proto/gen/ts/common/v1/common_pb.ts packages/proto/gen/go/common/v1/common.pb.go | head -4
before=$(git diff packages/proto/gen/ | shasum -a 256); ./scripts/buf-gen.sh; after=$(git diff packages/proto/gen/ | shasum -a 256); [ "$before" = "$after" ] && echo "codegen stable"
```

---

### Step 4 — service: read-only guard and `read_only` flag (indicators)

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-indicators` owner — formula sandboxing, numeric precision, no side-effects from formula execution

**Codebase Evidence**:
- `indicators/app/handlers/servicer.py:688-726` — `ManageTemplate`: admin check `:690-694`, `template_id required` `:698-701`, payload validation `:702-708`, CREATE `:709-715` (`get` → `ALREADY_EXISTS`), UPDATE `:716-717`, RETIRE `:718-719`, `NOT_FOUND` on a `None` row `:723-725`.
- `indicators/app/services/formula_templates_repository.py:28-32` — `get(template_id)` returns the row (retired or not) with `created_by` (`SELECT *`).
- Sentinel: `indicators/app/formulas/__init__.py:5` `SYSTEM_AUTHOR = "system"`, already imported at `servicer.py:20`.
- Existing wording precedent for a system refusal: `servicer.py:561-566` (`"system formulas are read-only and cannot be modified"`).
- `indicators/app/handlers/servicer.py:852-865` — `_row_to_template` builds `TemplateMeta`; `retired=row.get("retired_at") is not None` at `:860`.
- `created_by` is written only by `create` (`formula_templates_repository.py:34-48`); `update` and `retire` never set it (`:50-77`), so a get-then-check cannot race (D-17).

**Lands with**: `Step 5`

**TDD**: `red-green required` — RED: Step 5's system-row cases are written first and fail (`UPDATE`/`RETIRE` of a `created_by='system'` row succeeds; `read_only` is false) before this step's guard exists.

**Covers**: —

**Instructions**:
1. In `ManageTemplate`, after the `template_id required` check (`:698-701`) and before the payload
   validation block, for `op` in (`TEMPLATE_OPERATION_UPDATE`, `TEMPLATE_OPERATION_RETIRE`): load
   `existing = await self._templates_repo.get(meta.template_id)`; when `existing` is not `None` and
   `existing.get("created_by") == SYSTEM_AUTHOR`, abort `PERMISSION_DENIED` with exactly
   `f"system template '{meta.template_id}' is read-only"` and return. A missing row falls through
   unchanged so UPDATE/RETIRE of an unknown id still ends `NOT_FOUND` (`:723-725`).
2. Leave CREATE untouched: a seeded id already yields `ALREADY_EXISTS` at `:710-714`.
3. In `_row_to_template`, add `read_only=row.get("created_by") == SYSTEM_AUTHOR` to the `TemplateMeta`
   constructor.
4. No new outbound call, no new config read, no new pool (C-03, F-07, F-06 untouched).

**Verification**:
```bash
cd services/xstockstrat-indicators && uv run ruff check . && uv run ruff format --check . \
  && uv run pytest tests/test_formula_templates.py -q
grep -n "is read-only\|read_only=" app/handlers/servicer.py
```

---

### Step 5 — test: system formula templates are read-only

**Status**: `done`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_formula_templates.py` — modify

**Reviewers**: `xstockstrat-indicators` owner — formula sandboxing, numeric precision, no side-effects from formula execution

**Codebase Evidence**:
- `indicators/tests/test_formula_templates.py:55-108` — `_FakeTemplates` (rows keyed by id; `create` stamps `created_by` `:77`); `:174-178` `_servicer`; `:181-182` `_admin` (`x-user-id: admin`, scope `ADMIN_SCOPE = "7"` `:20`); `:197-201` `_manage`; `:193-194` `_code`.
- `:217` `class TestAuthoring` holds the existing authoring cases; `:296-299` `test_ac15_empty_catalog_lists_zero_templates` (stale name — traces to the durable rule this feature supersedes; D-11).
- `:315-326` `test_duplicate_create_is_already_exists` — the existing `ALREADY_EXISTS` shape.

**Lands with**: `Step 4`

**TDD**: `red-green required` — RED: written before Step 4's edit; the AC-26 cases and the `read_only is True` assertion fail on the unguarded handler. The AC-27 and AC-28 cases pin existing behaviour and are green from the start (regression pins, not RED evidence).

**Covers**: `AC-26, AC-27, AC-28`

**Instructions**:
Add to `TestAuthoring` (seed a system row by writing a dict with `created_by="system"`, `version=1`,
`retired_at=None` straight into `svc._templates_repo.rows`; build its `payload` with
`MessageToDict(_payload())` as the handler does at `servicer.py:708`):
1. `AC-26` — parametrized over UPDATE and RETIRE on `tpl-kaufman_efficiency_ratio`: the call aborts
   `PERMISSION_DENIED`, the abort message equals
   `"system template 'tpl-kaufman_efficiency_ratio' is read-only"`, and the row's `version`, `payload`
   and `retired_at` are unchanged.
2. `AC-27` — CREATE with `template_id="tpl-kaufman_efficiency_ratio"` over that system row aborts
   `ALREADY_EXISTS`.
3. `AC-28` — a template created through `_manage` by the admin: UPDATE returns `version == 2`,
   `ListTemplates` returns it with `meta.read_only is False`, then RETIRE sets `retired_at`.
4. `ListTemplates` returns the system row with `meta.read_only is True`.
5. Rename `test_ac15_empty_catalog_lists_zero_templates` to `test_empty_repo_lists_zero_templates`
   (body unchanged).

C-13: the system-row dict has one consumer (this file); it stays inline.

**Verification**:
```bash
cd services/xstockstrat-indicators && uv run ruff check . && uv run ruff format --check . \
  && uv run pytest --cov=app --cov-fail-under=50
grep -n "test_ac15_empty_catalog" tests/test_formula_templates.py   # expect no match
grep -n "conftest\|def .*fixture" tests/test_formula_templates.py | head -3   # C-13: no second inline copy introduced
```

---

### Step 6 — service: read-only guard and `read_only` flag (analysis)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `analysis/app/handlers/servicer.py:3639-3696` — `ManageTemplate`: admin check `:3641-3645`, repo check `:3646-3648`, meta validation `:3649-3658`, `op = request.operation` `:3659`, RETIRE `:3660-3661`, CREATE/UPDATE `:3662-3688`.
- `analysis/app/repositories/strategy_templates.py:32-36` — `get(template_id)` (`SELECT *`, includes `created_by`); `create` is the only writer of `created_by` (`:38-52`).
- Sentinel: `analysis/app/identity.py:3` `SYSTEM_IDENTITY = "system"`, already imported at `servicer.py:46`.
- `analysis/app/handlers/servicer.py:7304-7320` — `_row_to_strategy_template`; `retired=` at `:7311`.

**Lands with**: `Step 7`

**TDD**: `red-green required` — RED: Step 7's system-row cases are written first and fail before this step's guard exists.

**Covers**: —

**Instructions**:
1. In `ManageTemplate`, immediately after `op = request.operation` (`:3659`), for `op` in
   (`TEMPLATE_OPERATION_UPDATE`, `TEMPLATE_OPERATION_RETIRE`): `existing = await
   self._strategy_templates_repo.get(meta.template_id)`; when it exists and
   `existing.get("created_by") == SYSTEM_IDENTITY`, abort `PERMISSION_DENIED`
   `f"system template '{meta.template_id}' is read-only"` and return. This runs before
   `_validate_template_definition`, so a refused UPDATE makes no indicators call.
2. In `_row_to_strategy_template`, add `read_only=row.get("created_by") == SYSTEM_IDENTITY`.
3. No new outbound call (header-propagation constraint not triggered).

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run ruff check . && uv run ruff format --check . \
  && uv run pytest tests/test_strategy_templates.py -q
grep -n "is read-only\|read_only=" app/handlers/servicer.py
```

---

### Step 7 — test: system strategy templates are read-only

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_strategy_templates.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `analysis/tests/test_strategy_templates.py:55-68` — `_tpl_row(template_id, payload, version, retired)` with `"created_by": "admin-1"`; `:88-134` `FakeTemplates`; `:221-227` `_svc`; `:295-312` `_manage` (admin headers `_ADMIN` `:33`); `:239-241` `_aborted_with`; `:276-292` `_formula_templates` (the `ListTemplates` stub response).
- `:359-373` `test_manage_template_update_bumps_version_and_retire_hides` — the admin-authored UPDATE/RETIRE path that must stay green.

**Lands with**: `Step 6`

**TDD**: `red-green required` — RED: written before Step 6's edit; the AC-26 cases and the `read_only is True` assertion fail on the unguarded handler.

**Covers**: `AC-26`

**Instructions**:
1. Parametrized over UPDATE and RETIRE: `FakeTemplates({**_tpl_row("tpl-quality_dip_buyer"),
   "created_by": "system"})`, `_manage(..., template_id="tpl-quality_dip_buyer")` → `_aborted_with(ctx,
   PERMISSION_DENIED)`, message `"system template 'tpl-quality_dip_buyer' is read-only"`; the row's
   `version`, `payload` and `retired_at` are unchanged; `svc._indicators.calls == []`.
2. `ListTemplates` returns that row with `meta.read_only is True` and an `admin-1` row with
   `read_only is False`.

C-13: the `{**_tpl_row(...), "created_by": "system"}` spread is a scenario one-off; inline.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run ruff check . && uv run ruff format --check . \
  && uv run pytest --cov=app --cov-fail-under=40
```

---

### Step 8 — service: read-only guard and `read_only` flag (ingest)

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- `ingest/app/handlers/servicer.py:1607-1661` — `ManageTemplate`: DB check `:1608-1610`, admin check `:1612-1614`, `op` `:1615`, CREATE-only `template_id required` `:1617-1619`, RETIRE `:1620-1621`, CREATE/UPDATE `:1622-1649`.
- `ingest/app/repositories/source_templates.py:25-30` — `get(db_pool, template_id)`; `_COLS` includes `created_by` (`:11-14`); `create` is its only writer (`:33-47`).
- Sentinel: `ingest/app/repositories/signal_sources.py:36` `SYSTEM_OWNER = "system"`, already imported at `servicer.py:31-32`; `source_templates` module imported at `:30`.
- `ingest/app/handlers/servicer.py:184-198` — `_template_to_proto`; `retired=` at `:193`.

**Lands with**: `Step 9`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `ManageTemplate`, after the CREATE-only `template_id required` check (`:1617-1619`), for `op` in
   (`TEMPLATE_OPERATION_UPDATE`, `TEMPLATE_OPERATION_RETIRE`) with a non-empty `meta.template_id`:
   `existing = await source_templates.get(self._db, meta.template_id)`; when it exists and
   `existing.get("created_by") == SYSTEM_OWNER`, abort `PERMISSION_DENIED`
   `f"system template '{meta.template_id}' is read-only"` and return. Keep it after the admin check so
   a non-admin still gets the existing `"admin scope required"`.
2. In `_template_to_proto`, add `read_only=row.get("created_by") == SYSTEM_OWNER`.

**Verification** (union with Step 9):
```bash
cd services/xstockstrat-ingest && uv run ruff check . && uv run ruff format --check . \
  && uv run pytest tests/test_source_templates.py -q
grep -n "is read-only\|read_only=" app/handlers/servicer.py
```

---

### Step 9 — test: system source templates are read-only

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_source_templates.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- `ingest/tests/test_source_templates.py:29-50` — `_template_row` (`"created_by": "admin1"`); `:80-81` `_manage_req`; `:22-23` patch roots `_SS`, `_ST`; `_aborted_code` imported from `tests.test_signal_ownership` (`:20`).
- Tests that run UPDATE/RETIRE with no `get` patch and break under Step 8: `:196-209` `test_admin_update_returns_bumped_version`, `:254-263` `test_admin_update_or_retire_missing_template_not_found`, `:266-277` `test_admin_retire_marks_retired_and_never_touches_instances`.
- Precedent for patching `get`: `:104` (`patch(f"{_ST}.get", AsyncMock(return_value=template))`).

**Lands with**: `Step 8`

**TDD**: `red-green required`

**Covers**: `AC-26`

**Instructions**:
1. Add `patch(f"{_ST}.get", AsyncMock(return_value=…))` to the three tests listed above:
   `_template_row()` for the two that operate on an existing admin row, `None` for the
   missing-template test.
2. New, parametrized over UPDATE and RETIRE: `get` returns `{**_template_row("tpl-prnewswire_releases"),
   "created_by": "system"}`; `update` and `retire` are `AsyncMock`s. Assert `PERMISSION_DENIED`, the
   abort message `"system template 'tpl-prnewswire_releases' is read-only"`, and that neither `update`
   nor `retire` was awaited.
3. New: `_template_to_proto` of that system row has `meta.read_only is True`; of `_template_row()`,
   `False`.

RED for this unit: tests 2 and 3 fail on the pre-Step-8 tree (UPDATE succeeds; `read_only` is unset).
C-13: the system-row spread is a one-off; inline.

**Verification**:
```bash
cd services/xstockstrat-ingest && uv run ruff check . && uv run ruff format --check . \
  && uv run pytest --cov=app --cov-fail-under=40
```

---

### Step 10 — service: seed/staging parity checker

**Status**: `done`
**Service**: `scripts/` (repo tooling)
**Files**:
- `scripts/check-seed-template-parity.py` — create

**Reviewers**: `xstockstrat-indicators` owner — formula payload comparison; `xstockstrat-analysis` owner — strategy payload comparison, id rewrite; `xstockstrat-ingest` owner — source payload comparison (`scripts/` has no row in the reviewer registry)

**Codebase Evidence**:
- Tooling rules: `docs/patterns/script-tooling.md` § Rules 1–2 — stdlib-only, one standalone file, `main()` behind `if __name__ == "__main__"`, pytest module `scripts/tests/test_<name>.py` loaded with `conftest.load_script`.
- Precedent for the docstring/exit contract: `scripts/check-otel-produced-signals.py:1-20`.
- Stored forms to compare: formula template payload = `MessageToDict(RegisterFormulaRequest)` — camelCase, enum names, defaults omitted (`indicators/app/handlers/servicer.py:708`); staging formula row = `parameters` / `outputs` as the same camelCase dicts, `fundamental_inputs` as integers (`:472-473,497-500`). Strategy template payload and staging `definition_json` are both `MessageToDict(..., preserving_proto_field_name=True)` (`analysis/app/handlers/servicer.py:3674` and `:3269-3271`). Source template payload = the six keys of `_TEMPLATE_PAYLOAD_FIELDS` (`ingest/app/handlers/servicer.py:169-176`).
- Fields absent from a strategy template by contract: `user_id`, `origin`, `warnings`, `active`, `live_enabled` (`analysis.proto:343-393` fields 13, 16, 10, 7, 8; D-9).
- Snapshot format: Step 1.
- **Not found**: any existing parser for `$t$`-quoted seed SQL — created here.

**Lands with**: `Step 11`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
Write `scripts/check-seed-template-parity.py`. Usage:
`check-seed-template-parity.py [--kind formula|strategy|source]... [--snapshot PATH] [--root DIR]`
(default: all three kinds, `scripts/testdata/seed-templates-staging-2026-11-12.json`, the repo root).
Exit 0 = no difference outside the allowlist; 1 = differences, one line each on stderr as
`<kind> <template name or id>: <field path>: <what differs>`; 2 = unreadable input or a seed file that
does not parse.

1. **Seed parser.** Locate each file by slug glob, never by number (D-10):
   `services/xstockstrat-indicators/migrations/*_seed_formula_templates.up.sql`,
   `…-analysis/migrations/*_seed_strategy_templates.up.sql`,
   `…-ingest/migrations/*_seed_source_templates.up.sql`; exactly one match each, else exit 2. A row is
   four consecutive `$t$…$t$` literals in the order `template_id`, `name`, `description`, payload JSON
   (grammar fixed in Steps 13, 16, 20). A literal count not divisible by four, or a payload that is not
   a JSON object, is exit 2.
2. **Formula id map (derived, never hand-written; D-9).** `slug(name)` = lowercase, runs outside
   `[a-z0-9]` → `_`, trimmed. For each snapshot formula the mapped id is `tpl-` + `slug(name)`, except
   the system formula `d1ff5e6b-6d9c-589d-b95e-defd862c702b`, which maps to
   `tpl-fundamentals_value_quality_composite_template` (allowlisted, D-31). Fail when two snapshot
   formulas share a name, when a mapped id has no seed row, or when a custom-formula `formula_id` in
   one of the 14 snapshot strategies is not in the map.
3. **Formulas.** For every seeded formula except the composite: `md5(payload.source)` =
   `source_md5`; `md5(payload.description or "")` = `description_md5`; the row's `name` and
   `description` columns equal the payload's; `payload.name` = snapshot `name`; `parameters` and
   `outputs` structurally equal, lists matched by `name` and reported as
   `parameters.<name>.<field>` / `outputs.<name>.<field>`; `warmupPeriod` (absent = 0) =
   `warmup_period`; `inputSchema` (absent = `{}`) = `input_schema`. `fundamental_inputs`: both sides
   must be empty; a non-empty staging list on a non-composite formula is reported as a difference
   (the checker carries no enum table — raise it, do not map it).
   The composite is **not** content-compared with the snapshot: its parity reference is the code
   module (D-12), enforced by Step 15. Here it only has to exist under its mapped id with the name
   "Fundamentals Value+Quality Composite (template)".
4. **Strategies.** For each of the 14: take the snapshot `definition_json`, rewrite every
   custom-formula `formula_id` through the map, drop `user_id`, `origin`, `warnings`, `active`,
   `live_enabled`, and require structural equality with the seed payload over **all** remaining keys
   (not only the six FR-9 names). The seed payload must not contain any of those five keys — report
   each one found. One allowlisted difference: the blend template's `strategy_id` is
   `fundamentals_macd_blend_copy` where staging has `fundamentals_macd_blend`. The row's `template_id`
   must be `tpl-<staging strategy_id>` and its `name` the staging `display_name`.
5. **Sources.** For each of the 4: `slug`, `display_name`, `source_type`, `extractor_module`,
   `config_json` and `reliability_weight` equal (a seed payload without `reliability_weight` is a
   difference unless the snapshot value is `0`). The row's `template_id` must be `tpl-<slug>` and its
   `name` the snapshot `display_name`. The payload keys must be a subset of the six
   `_TEMPLATE_PAYLOAD_FIELDS` names.
6. **Allowlist, complete (D-21).** The formula-id rewrite; a key omitted on one side whose other-side
   value is the proto3 default (`0`, `""`, `false`, `[]`, `{}`); the five absent strategy keys; the
   blend `strategy_id`; the composite (named differently and referenced to the code module, § 3).
   Nothing else. In particular a staging definition that
   still carries a dead feature-097 `signal_params` key (`analysis/app/handlers/servicer.py:7343-7345`)
   is reported as a difference — the template form strips those keys (`:3671`), and whether to allow
   that is an operator decision, not a checker default.
7. Keep the comparison functions importable (the test calls them on in-memory inputs).

**Verification** (union with Step 11):
```bash
cd scripts && uv run --extra dev ruff check . && uv run --extra dev ruff format --check . \
  && uv run --extra dev pytest tests/test_check_seed_template_parity.py -q
grep -n "^import\|^from" check-seed-template-parity.py   # stdlib only
```

---

### Step 11 — test: parity checker (parser, id map, drift, allowlist)

**Status**: `done`
**Service**: `scripts/` (repo tooling)
**Files**:
- `scripts/tests/test_check_seed_template_parity.py` — create

**Reviewers**: `xstockstrat-indicators` owner, `xstockstrat-analysis` owner, `xstockstrat-ingest` owner — as Step 10

**Codebase Evidence**:
- `scripts/tests/conftest.py:12-18` — `load_script("<file>.py")` (hyphenated scripts are imported by path).
- Layout precedent: `scripts/tests/test_check_migration_contract.py:1-30` (throwaway tree under `tmp_path`, script loaded at module import).
- Harness: `scripts/pyproject.toml` (`testpaths = ["tests"]`), CI job `scripts-python` (`.github/workflows/ci.yml:860-893`).

**Lands with**: `Step 10`

**TDD**: `red-green required`

**Covers**: `AC-14, AC-36`

**Instructions**:
All inputs are synthetic: a `tmp_path` tree with the three seed files in the Step 13/16/20 grammar and a
small snapshot JSON, built by one local helper. No real seed file or snapshot is read here (Step 23
does that).
1. **Parser good/bad pair** (design.md Open Risks, D-21): a seed whose payload `source` ends in a
   newline round-trips with the md5 of the newline-terminated text; a seed with one `$t$` literal
   missing exits 2; a payload that is a JSON array exits 2.
2. **`AC-14`**: a "Kaufman Efficiency Ratio" payload whose `period` default is 11 against a snapshot
   with 10 → exit 1 and stderr contains `Kaufman Efficiency Ratio` and
   `parameters.period.defaultValue`.
3. **Id map**: two snapshot formulas with the same name fail; a strategy component whose uuid is not in
   the snapshot formulas fails; a seed component that keeps the staging uuid instead of the `tpl-` id
   fails; the system formula id maps to the composite template id.
4. **`AC-36`**: a strategy payload containing each of `user_id`, `origin`, `warnings`, `active`,
   `live_enabled` in turn is reported; a clean one is not.
5. **Allowlist**: the blend `strategy_id` difference and the composite name pass; an omitted
   `warmupPeriod` against `warmup_period: 0` passes; a changed `entry_rule`, a changed
   `config_json.scrape_selector`, a changed `extractor_module`, and a dead `signal_params` key present
   only in the snapshot each fail.
6. `--kind source` reads only the source seed (the formula and strategy files may be absent).

C-13: the synthetic seed/snapshot builder has one consumer; inline.

**Coverage**: `scripts/` has no enforced coverage threshold (CI job `scripts-python` runs ruff + pytest only, `docs/patterns/script-tooling.md:29-34`); the pass condition is every listed case green.

**Verification**:
```bash
cd scripts && uv run --extra dev ruff check . && uv run --extra dev ruff format --check . \
  && uv run --extra dev pytest tests/test_check_seed_template_parity.py -q
```

---

### Step 12 — test: commit the operator's staging export; record the pre-merge checks (operator gate)

**Status**: `pending`
**Service**: `scripts/` (repo tooling)
**Files**:
- `scripts/testdata/seed-templates-staging-2026-11-12.json` — create (operator output, unedited)

**Reviewers**: DBA — the file is the raw output of Step 1's query; `xstockstrat-indicators` owner, `xstockstrat-analysis` owner, `xstockstrat-ingest` owner — reference content

**Codebase Evidence**:
- File name fixed by D-9. Home precedent: `scripts/testdata/rpc-status-vectors.json`.
- Why the reference must be a raw export: ledger `insights.md` 2026-11-12 `seed-curated-templates` ("a transcribed snapshot and the hand-written seed can share one copy error and still agree").
- Slug key for the pre-merge check: namespace `analysis`, key `fundsignal.source_slug`, code default `fundamentals` (`analysis/app/engine/fundsignal_loop.py:44-46`); stored key is namespace-relative since feature 296 (root `CLAUDE.md` § Config Governance Rules). Staging already read as `fundamentals` (`context.md`, sdd-design session).
- Template tables for the pre-existing-id check: `indicators.formula_templates` (`indicators/migrations/007_private_formulas_templates.up.sql:38-48`), `analysis.strategy_templates` (`analysis/migrations/026_owner_dimension_templates.up.sql:89-99`), `ingest.source_templates` (`ingest/migrations/013_signal_ownership_templates.up.sql:119-129`).

**TDD**: `N/A (reference data; no code)`

**Covers**: — (reference data for the tests in Steps 11 and 23)

**Instructions**:
1. Receive the operator's output of Step 1's command and write it to the file byte for byte. Do not
   reformat, re-sort, re-indent or "fix" it. If it must be regenerated, the operator re-runs the query.
2. Sanity-check it (Verification). A count other than 14 strategies / 4 sources, or a custom-formula
   id in a strategy with no formula row, is reported to the operator and blocks the step — it is not
   patched in the file.
3. Ask the operator to run, on the **production** and **homelab** databases, and record both results
   verbatim in `context.md` (design.md Open Risks; D-24, D-20):
   ```sql
   SELECT environment, user_id, value_data FROM config.config_values
    WHERE namespace = 'analysis' AND key = 'fundsignal.source_slug';
   SELECT 'formula' AS kind, template_id, created_by FROM indicators.formula_templates WHERE template_id LIKE 'tpl-%'
   UNION ALL SELECT 'strategy', template_id, created_by FROM analysis.strategy_templates WHERE template_id LIKE 'tpl-%'
   UNION ALL SELECT 'source', template_id, created_by FROM ingest.source_templates WHERE template_id LIKE 'tpl-%';
   ```
   A slug other than `fundamentals`, or any returned `tpl-*` row, is surfaced to the operator before
   Step 20 / before merge; the collision guard would fail the migration loudly on the latter.
4. If CI `secret-scan` (`.github/workflows/ci.yml:1138`) flags the 32-hex md5 values, stop and raise
   it; do not add an allowlist entry unasked.

**Verification**:
```bash
python3 - <<'EOF'
import json
d = json.load(open("scripts/testdata/seed-templates-staging-2026-11-12.json"))
assert set(d) == {"exported_at", "strategies", "formulas", "sources"}, set(d)
assert len(d["strategies"]) == 14 and len(d["sources"]) == 4, (len(d["strategies"]), len(d["sources"]))
ids = {f["formula_id"] for f in d["formulas"]}
used = {c["formula_id"] for s in d["strategies"] for c in s["definition_json"].get("components", []) if c.get("formula_id")}
assert used <= ids, used - ids
assert all("credentials_ref" not in s for s in d["sources"])
print("ok", len(d["formulas"]), "formulas")
EOF
grep -n "production\|homelab" docs/roadmap/features/335-seed-curated-templates/context.md | tail -4   # pre-merge results recorded
```

---

### Step 13 — migration: `008_seed_formula_templates` (indicators)

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/migrations/008_seed_formula_templates.up.sql` — create
- `services/xstockstrat-indicators/migrations/008_seed_formula_templates.down.sql` — create

**Reviewers**: DBA — migration NNN numbering (no gaps, no conflicts), up+down pair present, run-order compliance with `scripts/db-migrate.sh`; `xstockstrat-indicators` owner — formula sandboxing, numeric precision, no side-effects from formula execution

**Codebase Evidence**:
- Last migration: `indicators/migrations/007_private_formulas_templates.up.sql` (`ls` → 007 is the tip). Table DDL `:38-48`: `template_id TEXT PRIMARY KEY, name, description DEFAULT '', payload JSONB NOT NULL, version DEFAULT 1, retired_at, created_by TEXT NOT NULL, created_at, updated_at`.
- Header style: `indicators/migrations/007_private_formulas_templates.up.sql:1-4` (`-- Migration:` / `-- Service:` / feature line).
- Verbatim copy rule: `scripts/render-migrations.sh:22-31` — an `.up.sql` with no `-- requires-env:` in its first 5 lines is `cp`'d, so `$`, `$t$` and `$$` survive.
- Idempotent seed shape: `services/xstockstrat-config/migrations/008_analysis_fundsignal_keys.up.sql:10-48` (`INSERT … VALUES … ON CONFLICT … DO NOTHING`); named dollar-quote precedent `ingest/migrations/013_signal_ownership_templates.up.sql:35-52` (`$fn$`).
- Payload form the readers require: `MessageToDict(request.template.payload)` (`indicators/app/handlers/servicer.py:708`) — camelCase keys, enum NAME strings, defaults omitted; read back with strict `ParseDict` (`:835,864`) — an unknown key breaks `ListTemplates` for everyone.
- Composite reference: `indicators/app/formulas/fundamentals_value_quality.py:28-33` (`DESCRIPTION`), `:65` (`PARAMETERS`), `:67-72` (`OUTPUTS`), `:76-83` (`FUNDAMENTAL_INPUTS`), `:90` (`SOURCE`).
- Run order: `scripts/db-migrate.sh:176-177` (indicators before analysis).

**Lands with**: `Step 14, Step 15`

**TDD**: `N/A (migration)`

**Covers**: —

**Instructions**:
1. **Ids and names** (decision 3):

   | `template_id` | `name` |
   |---|---|
   | `tpl-volatility_trailing_stop_direction` | Volatility Trailing Stop Direction |
   | `tpl-bollinger_squeeze_percentile` | Bollinger Squeeze Percentile |
   | `tpl-fundamentals_value_quality_composite_template` | Fundamentals Value+Quality Composite (template) |
   | `tpl-sma_trend_slope_fractional` | SMA Trend Slope (fractional) |
   | `tpl-momentum_quality_clenow` | Momentum Quality (Clenow) |
   | `tpl-kaufman_efficiency_ratio` | Kaufman Efficiency Ratio |
   | `tpl-mean_reversion_z_score` | Mean-Reversion Z-Score |
   | `tpl-rolling_zscore_v2` | rolling_zscore_v2 |
   | `tpl-kaufman_efficiency_ratio_v2` | kaufman_efficiency_ratio_v2 |

2. **Up file.** Header comment (migration, service, feature 335; "data only; system rows are
   read-only through ManageTemplate"), no `-- requires-env:` line, no `BEGIN`/`COMMIT`. Then exactly:
   ```sql
   INSERT INTO indicators.formula_templates (template_id, name, description, payload, created_by)
   VALUES
     ($t$<template_id>$t$, $t$<name>$t$, $t$<description>$t$, $t$<payload JSON>$t$::jsonb, 'system'),
     …
   ON CONFLICT (template_id) DO NOTHING;
   ```
   Every text value is `$t$`-quoted, in that column order, nine rows. `$t$` is used nowhere else in
   the file.
3. **Payloads.** Eight formulas: `name` is the snapshot row's `name`; `description` and `source` are
   the staging formula's text (read through the staging MCP `get_formula`, proven by the snapshot's
   md5); `parameters`, `outputs`, `warmupPeriod` are copied from Step 12's snapshot row (`parameters`,
   `outputs`, `warmup_period`). Keys are camelCase; omit a
   key whose value is the proto default; never write `isPublic`, `author` or any key that is not a
   `RegisterFormulaRequest` field (`packages/proto/indicators/v1/indicators.proto:197-208`). The
   composite: `name` as in the table; `source`, `parameters`, `outputs` and `fundamentalInputs` (enum
   NAME strings) equal to the code module; `description` is the module's `DESCRIPTION` with one
   sentence appended stating that `analysis.backtest.fundamentals.enabled` must be on for it to
   evaluate (D-28). The composite payload never contains the id `d1ff5e6b-…`.
4. **Collision guard**, directly after the INSERT (D-20):
   ```sql
   DO $$
   DECLARE held TEXT;
   BEGIN
     SELECT string_agg(template_id, ', ' ORDER BY template_id) INTO held
       FROM indicators.formula_templates
      WHERE template_id IN (<the nine ids>) AND created_by <> 'system';
     IF held IS NOT NULL THEN
       RAISE EXCEPTION 'indicators seed_formula_templates: seeded template_id held by a non-system row: %', held;
     END IF;
   END $$;
   ```
5. **Down file.** Header comment stating the order "run the analysis seed down before this one"
   (D-3), then one statement:
   `DELETE FROM indicators.formula_templates WHERE template_id IN (<the nine ids>) AND version = 1 AND retired_at IS NULL AND created_by = 'system';`
6. Before committing the unit, run `python3 scripts/check-seed-template-parity.py --kind formula`; a
   reported difference is fixed in this file (re-read staging), never in the snapshot.

**Verification**:
```bash
ls services/xstockstrat-indicators/migrations/008_seed_formula_templates.up.sql services/xstockstrat-indicators/migrations/008_seed_formula_templates.down.sql
ls services/xstockstrat-indicators/migrations/ | grep -c "^008_"   # expect 2 (no other 008)
head -5 services/xstockstrat-indicators/migrations/008_seed_formula_templates.up.sql | grep -c "requires-env"   # expect 0
uv run --no-project --with pglast python3 - <<'EOF'
import re
from pglast import parse_sql, parse_plpgsql
for f in ("up", "down"):
    sql = open(f"services/xstockstrat-indicators/migrations/008_seed_formula_templates.{f}.sql").read()
    print(f, [type(s.stmt).__name__ for s in parse_sql(sql)])
    for m in re.finditer(r"DO \$\$.*?\$\$;", sql, re.S):
        parse_plpgsql(m.group(0))
EOF
# expect: up ['InsertStmt', 'DoStmt'], down ['DeleteStmt']
python3 scripts/check-seed-template-parity.py --kind formula   # exit 0
```
By inspection: the down's `IN` list is the nine inserted ids, and it deletes only `version = 1`,
non-retired, `system` rows.

---

### Step 14 — migration: real-PostgreSQL assertions for the formula seed

**Status**: `pending`
**Service**: `xstockstrat-indicators` (files under `scripts/migration-assertions/`)
**Files**:
- `scripts/migration-assertions/indicators-008.sql` — create
- `scripts/migration-assertions/indicators-007.sql` — modify

**Reviewers**: DBA — replay / down / collision semantics on a real database; `xstockstrat-indicators` owner — formula sandboxing, numeric precision, no side-effects from formula execution

**Codebase Evidence**:
- Runner: every non-`fixtures-*` file is executed after pass 3 with `psql -v ON_ERROR_STOP=1 -f` (`scripts/migration-rerun.py:397-398,562-593,1119-1120`); CI job `migration-rerun` (`.github/workflows/ci.yml:897-933`), triggered by `scripts/migration-assertions/**` and `services/*/migrations/**` (`:87-96`).
- Block to delete: `scripts/migration-assertions/indicators-007.sql:45-47` (`IF EXISTS (SELECT 1 FROM indicators.formula_templates) THEN RAISE EXCEPTION 'AC-15: … has seed rows'`); the `to_regclass` existence check at `:42-44` stays. Line 1's header names AC-15.
- Style: `DO $$ … RAISE EXCEPTION 'AC-n: …'` (`indicators-007.sql:3-23`).
- In-file state building with rollback: `scripts/migration-assertions/config-043.sql:65-88,287` (`BEGIN;` … `\ir ../../services/…/043_….up.sql` … `ROLLBACK;`), down include at `:222`; ledger `insights.md` 2026-11-10 `fix-sandbox-seed-keys` ("prefer an in-file BEGIN…ROLLBACK `\ir` replay over shared harness fixtures").
- Conditional raise outside a `$$` body: `scripts/migration-assertions/config-044.sql:145-152` (`… AS ok \gset`, `\if :ok \else … SELECT 1 / 0; \endif`). psql is 16 (`scripts/Dockerfile.migrate:1`), which sets `LAST_ERROR_MESSAGE`.
- **Not found**: an assertion file that expects an included migration to fail (decision 6).

**Lands with**: `Step 13, Step 15`

**TDD**: `N/A (migration assertions; executed only by CI migration-rerun)`

**Covers**: `AC-1, AC-9, AC-23, AC-24, AC-39`

**Instructions**:
1. `indicators-007.sql`: delete lines 45–47 (the "has seed rows" block) and drop "AC-15, " from the
   line-1 header. Nothing else.
2. `indicators-008.sql`, header comment naming the scenarios, then:
   - **Post-state** (outside any transaction): the non-retired `created_by = 'system'` rows are exactly
     the nine ids of Step 13, each at `version = 1` (`AC-1`); raise naming the missing/extra ids.
   - **Replay keeps version 2** (`AC-23`): `BEGIN;` set `tpl-kaufman_efficiency_ratio` to `version = 2`;
     `\ir ../../services/xstockstrat-indicators/migrations/008_seed_formula_templates.up.sql`; assert 9
     rows and that row still at 2; `ROLLBACK;`.
   - **Replay does not un-retire** (`AC-24`, indicators row): `BEGIN;` set one seeded row's
     `retired_at = NOW()`; `\ir` up; assert 9 rows and a non-null `retired_at`; `ROLLBACK;`.
   - **Down removes only seeded rows** (`AC-9`): `BEGIN;` insert `('tpl-admin-custom', …,
     created_by 'admin1')`; `\ir …008_seed_formula_templates.down.sql`; assert the table holds exactly
     one row, `tpl-admin-custom`; `ROLLBACK;`.
   - **Collision is refused** (`AC-39`): `BEGIN;` `UPDATE … SET created_by = 'admin1' WHERE template_id
     = 'tpl-kaufman_efficiency_ratio'`; `SAVEPOINT collide;` `\set ON_ERROR_STOP off`; `\ir` up;
     `\set seed_error :'LAST_ERROR_MESSAGE'`; `\set ON_ERROR_STOP on`; `ROLLBACK TO SAVEPOINT collide;`
     then `SELECT :'seed_error' LIKE '%held by a non-system row%tpl-kaufman_efficiency_ratio%' AS
     refused \gset` and the `\if :refused \else \echo 'AC-39: …' SELECT 1 / 0; \endif` form of
     `config-044.sql:147-152`; `ROLLBACK;`. `seed_error` must be captured by the meta-command directly
     after the include, before any other statement can overwrite `LAST_ERROR_MESSAGE`.
3. A renumber of 008 changes this file's name and its four `\ir` paths.

**Verification**:
```bash
grep -c "has seed rows" scripts/migration-assertions/indicators-007.sql   # expect 0
grep -c "\\\\ir ../../services/xstockstrat-indicators/migrations/008_seed_formula_templates" scripts/migration-assertions/indicators-008.sql   # expect 4
uv run --no-project --with pglast python3 - <<'EOF'
import re
from pglast import parse_sql, parse_plpgsql
for name in ("indicators-007", "indicators-008"):
    text = open(f"scripts/migration-assertions/{name}.sql").read()
    sql = "\n".join(l for l in text.splitlines() if not l.lstrip().startswith("\\"))
    sql = re.sub(r"\\gset", ";", sql).replace(":'seed_error'", "'x'")
    n = len(parse_sql(sql))
    for m in re.finditer(r"DO \$\$.*?\$\$;", sql, re.S):
        parse_plpgsql(m.group(0))
    print(name, n, "statements parse")
EOF
```
Live run: CI `migration-rerun` on the integration PR.

---

### Step 15 — test: seeded formula payloads are valid, executable and pinned

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_seed_formula_templates.py` — create

**Reviewers**: `xstockstrat-indicators` owner — formula sandboxing, numeric precision, no side-effects from formula execution

**Codebase Evidence**:
- Validators the RPC path applies: `indicators/app/handlers/servicer.py:823-829` `_validate_register_payload`; strict read `ParseDict(row["payload"], RegisterFormulaRequest())` at `:835` and `:864`.
- Sandbox entry: `indicators/app/services/sandbox.py:670-679` `execute_formula(source, input_data, allowed_imports, …, params=…)` → `SandboxResult` (`:532-540`, `success`, `output`, `error`). Formula input contract used by analysis: `{"close": closes}` with params separate (`analysis/app/services/evaluator.py:526-537`). Default import list `numpy,pandas,math,statistics` (`indicators/CLAUDE.md:94`). Composite run precedent: `indicators/tests/test_fundamentals_formula.py:22-31`.
- Reusable doubles (import, do not copy): `indicators/tests/test_formula_templates.py:55-108` `_FakeTemplates`, `:110` `_FakeFormulas`, `:174-178` `_servicer`, `:185-186` `_user`, `:210-214` `_instantiate`.
- Code module for the drift guard: `indicators/app/formulas/fundamentals_value_quality.py:65,67,76,90`.
- Test that reads migration SQL text — precedent: `services/xstockstrat-config/src/__tests__/barIngestBackoffSeedMigration.test.ts:3-47`.
- CI installs `libseccomp2` for this service's sandbox tests (`.github/workflows/ci.yml:503-505`).

**Lands with**: `Step 13, Step 14`

**TDD**: `red-green required` — RED: written before Step 13's file exists, every test fails on "no `*_seed_formula_templates.up.sql`".

**Covers**: `AC-1, AC-2, AC-19, AC-20, AC-21, AC-22`

**Instructions**:
1. Inline seed parser (D-23; nothing under `services/` imports from `scripts/`): glob
   `migrations/*_seed_formula_templates.up.sql` (exactly one), take the `$t$…$t$` literals four at a
   time → `{template_id, name, description, payload, version: 1, retired_at: None, created_by:
   "system", created_at, updated_at}` rows.
2. Every payload: strict `ParseDict` succeeds; `_validate_register_payload` passes; `payload.name ==
   name`; no `is_public` / `author` set.
3. `AC-19`: every `template_id` starts with `tpl-`; the up file's `created_by` literal is `'system'`.
4. `AC-1` / `AC-22`: a servicer whose `_templates_repo.rows` holds the parsed rows returns, for caller
   `bob`, exactly 9 templates at version 1 with the nine names of FR-1, each `meta.read_only is True`.
5. One sandbox run per source (D-8): the eight price formulas over 60 synthetic closes with their
   declared parameter defaults → `success`; the composite over a full fundamentals dict → `success`.
6. `AC-2`: instantiate `tpl-volatility_trailing_stop_direction` as `bob` through the real handler; the
   copy is authored by `bob` and declares `period` (default 22) and `multiplier` (default 3.0); running
   its source over 60 closes with those values yields `value` and `stop_line` series of length 60.
7. `AC-20`: the composite payload's `source`, `parameters`, `outputs` and `fundamentalInputs` equal the
   code module's `SOURCE`, `[MessageToDict(p) for p in PARAMETERS]`, `[MessageToDict(o) for o in
   OUTPUTS]` and the `FUNDAMENTAL_INPUTS` enum names, compared by one local `diff(payload, module)`
   that returns field paths.
8. `AC-21`: the same `diff` on a copy of the payload with `pe_good` default 11.0 returns
   `["parameters.pe_good.defaultValue"]`.

C-13: the parser and the synthetic closes have one consumer in this service; inline.

**Verification**:
```bash
cd services/xstockstrat-indicators && uv run ruff check . && uv run ruff format --check . \
  && uv run pytest --cov=app --cov-fail-under=50
grep -n "^from scripts\|^import scripts" tests/test_seed_formula_templates.py   # expect no match (D-23)
```

---

### Step 16 — migration: `028_seed_strategy_templates` (analysis)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/migrations/028_seed_strategy_templates.up.sql` — create
- `services/xstockstrat-analysis/migrations/028_seed_strategy_templates.down.sql` — create

**Reviewers**: DBA — migration NNN numbering (no gaps, no conflicts), up+down pair present, run-order compliance with `scripts/db-migrate.sh`; `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Last migration: `analysis/migrations/027_contract_owner_dimension.up.sql`. Table DDL `analysis/migrations/026_owner_dimension_templates.up.sql:89-99` (same columns as the formula table).
- Payload form: `json_format.MessageToDict(payload, preserving_proto_field_name=True)` after `_normalize_source_symbols` and `_strip_dead_signal_params` (`analysis/app/handlers/servicer.py:3670-3674`) — snake_case keys, `entry_rule` / `exit_rule` as JSON **strings**, `kind` as enum NAME, defaults omitted. Read with `ignore_unknown_fields=True` (`:7317-7319`), so a wrong key is silently dropped — Step 19 parses strictly instead.
- Instantiation overwrites `strategy_id`, `user_id`, `active`, `live_enabled`, `origin`, `warnings` (`:3831-3836`) and rewrites each custom-formula `formula_id` from the indicators copy map (`:3828-3830`).
- Blend guard on the final id: `:3777-3785`, `:670-678`; the configured id's default is `fundamentals_macd_blend` (`:367-369`).
- The analysis `up` path copies the whole directory, renders only `013` with `envsubst '$SEED_USER_ID'`, then runs `render-migrations.sh` (`scripts/db-migrate.sh:88-104`); a header-less 028 is copied verbatim.

**Lands with**: `Step 17, Step 18, Step 19`

**TDD**: `N/A (migration)`

**Covers**: —

**Instructions**:
1. **Rows.** One per strategy id in FR-2, `template_id = 'tpl-' || strategy_id` (14 rows: 
   `tpl-dip_buyer_vol_stop`, `tpl-squeeze_breakout_trend`, `tpl-fundamentals_macd_blend`,
   `tpl-dip_buyer_vol_stop_m25`, `tpl-dip_buyer_vol_stop_m35`, `tpl-dip_buyer_regime_filtered`,
   `tpl-dip_buyer_market_regime_voo`, `tpl-squeeze_macd_mq`, `tpl-squeeze_mq_confirmed`,
   `tpl-zscore_trend_filtered`, `tpl-clenow_momentum_regime`, `tpl-range_mean_reversion_v2`,
   `tpl-quality_dip_buyer`, `tpl-golden_cross_conviction`). `name` = the staging `display_name`;
   `description` = `''` (decision 4).
2. **Up file.** Same shape and rules as Step 13 § 2, on `analysis.strategy_templates`: header comment,
   no `-- requires-env:`, one `INSERT … VALUES … ON CONFLICT (template_id) DO NOTHING` with `$t$`
   literals in the order `template_id`, `name`, `description`, payload JSON, then `'system'`.
3. **Payloads.** Each is the snapshot row's `definition_json` with: `user_id`, `origin`, `warnings`,
   `active`, `live_enabled` removed; every `COMPONENT_KIND_CUSTOM_FORMULA` component's `formula_id`
   replaced by the formula **template** id from Step 13's table (the snapshot formula with that uuid,
   slugged; the system formula `d1ff5e6b-…` → `tpl-fundamentals_value_quality_composite_template`);
   nothing else changed (if a staging definition still carries a dead `signal_params` key, see § 6).
   The blend row's payload `strategy_id` is `fundamentals_macd_blend_copy`
   (D-31) while its `template_id` stays `tpl-fundamentals_macd_blend`. `entry_rule` / `exit_rule`
   remain JSON strings exactly as stored.
4. **Collision guard** as Step 13 § 4 on `analysis.strategy_templates` with the 14 ids and the message
   prefix `analysis seed_strategy_templates:`.
5. **Down file.** Header: "runs before the indicators seed down" (D-3). One statement:
   `DELETE FROM analysis.strategy_templates WHERE template_id IN (<the 14 ids>) AND version = 1 AND retired_at IS NULL AND created_by = 'system';`
6. Run `python3 scripts/check-seed-template-parity.py --kind strategy` before committing the unit. If
   it reports a dead `signal_params` key present only in staging, stop and ask the operator (Step 10
   § 6); do not edit the snapshot or widen the checker.

**Verification**:
```bash
ls services/xstockstrat-analysis/migrations/028_seed_strategy_templates.up.sql services/xstockstrat-analysis/migrations/028_seed_strategy_templates.down.sql
ls services/xstockstrat-analysis/migrations/ | grep -c "^028_"   # expect 2
head -5 services/xstockstrat-analysis/migrations/028_seed_strategy_templates.up.sql | grep -c "requires-env"   # expect 0
uv run --no-project --with pglast python3 - <<'EOF'
import re
from pglast import parse_sql, parse_plpgsql
for f in ("up", "down"):
    sql = open(f"services/xstockstrat-analysis/migrations/028_seed_strategy_templates.{f}.sql").read()
    print(f, [type(s.stmt).__name__ for s in parse_sql(sql)])
    for m in re.finditer(r"DO \$\$.*?\$\$;", sql, re.S):
        parse_plpgsql(m.group(0))
EOF
# expect: up ['InsertStmt', 'DoStmt'], down ['DeleteStmt']
python3 scripts/check-seed-template-parity.py --kind strategy   # exit 0
grep -c "d1ff5e6b" services/xstockstrat-analysis/migrations/028_seed_strategy_templates.up.sql   # expect 0
```

---

### Step 17 — migration: `029_seed_fundamentals_blend_strategy` (analysis)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/migrations/029_seed_fundamentals_blend_strategy.up.sql` — create
- `services/xstockstrat-analysis/migrations/029_seed_fundamentals_blend_strategy.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair present, run-order compliance with `scripts/db-migrate.sh` (identity before analysis); `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Table: `analysis/migrations/001_strategies.up.sql:1-8` (`strategy_id, display_name, definition_json JSONB NOT NULL, active DEFAULT TRUE, …`), `002_strategy_live_enabled.up.sql:1` (`live_enabled DEFAULT FALSE`), `013_strategies_user_id.up.sql:9,25-27` (`user_id TEXT NOT NULL`, PK `(user_id, strategy_id)`).
- REGISTER's stored form: `definition.user_id = caller_user_id` then `MessageToDict(definition, preserving_proto_field_name=True)` (`analysis/app/handlers/servicer.py:3252,3269-3271`), inserted with the table defaults `active = TRUE`, `live_enabled = FALSE` (`analysis/app/repositories/strategies.py:41-53`). Fingerprint ignores `display_name`, `active`, `live_enabled`, `origin` but not `user_id` (`servicer.py:7282,7297-7301`).
- Owner lookup: `identity/migrations/001_identity_tables.up.sql:6-8` (`user_id UUID PRIMARY KEY`, `email TEXT NOT NULL UNIQUE`); `identity/migrations/002_seed_admin.up.sql:9-15` seeds `admin@localhost` with a generated id. Identity migrates before analysis (`scripts/db-migrate.sh:158,177`).
- A down may delete only rows it can prove it wrote: ledger `fails.md` 2026-11-10 `fix-analysis-live-loop-budget-seed`; R-7.
- The configured blend id default: `servicer.py:367-369`; R-8 forbids reading `config.config_values` here.
- Comment-only down precedent: `identity/migrations/002_seed_admin.down.sql` (`-- rollback not supported for this migration`); `docs/patterns/database.md` § Adding a new migration allows "a stub comment if rollback is not supported".

**Lands with**: `Step 16, Step 18, Step 19`

**TDD**: `N/A (migration)`

**Covers**: —

**Instructions**:
1. **Up file.** Header comment: feature 335; "seeds the blend strategy for admin@localhost, active and
   not live; reads identity.users (the one migration-time cross-schema read, D-37); inserts nothing
   when that user is missing". No `-- requires-env:`, no `BEGIN`/`COMMIT`, no `to_regclass` guard
   (D-34). Exactly one statement:
   ```sql
   INSERT INTO analysis.strategies (user_id, strategy_id, display_name, definition_json, active, live_enabled)
   SELECT u.user_id::text, 'fundamentals_macd_blend', $t$<display name>$t$,
          $t$<definition JSON>$t$::jsonb || jsonb_build_object('user_id', u.user_id::text),
          TRUE, FALSE
     FROM identity.users u
    WHERE u.email = 'admin@localhost'
   ON CONFLICT (user_id, strategy_id) DO NOTHING;
   ```
2. **Definition JSON.** The snapshot's `fundamentals_macd_blend` `definition_json` with `user_id`,
   `origin`, `warnings`, `active`, `live_enabled` removed and the dead `signal_params` keys
   (`servicer.py:7343-7345`) removed — the form a fresh REGISTER stores. `strategy_id` stays
   `fundamentals_macd_blend`; every custom-formula `formula_id` stays the system formula
   `d1ff5e6b-6d9c-589d-b95e-defd862c702b` (no template id here). The display name is the staging
   `display_name`.
3. **Down file.** A comment only: "seeded row is user state; not reversed" (D-35). No statement.

**Verification**:
```bash
ls services/xstockstrat-analysis/migrations/029_seed_fundamentals_blend_strategy.up.sql services/xstockstrat-analysis/migrations/029_seed_fundamentals_blend_strategy.down.sql
ls services/xstockstrat-analysis/migrations/ | grep -c "^029_"   # expect 2
uv run --no-project --with pglast python3 - <<'EOF'
from pglast import parse_sql
up = open("services/xstockstrat-analysis/migrations/029_seed_fundamentals_blend_strategy.up.sql").read()
down = open("services/xstockstrat-analysis/migrations/029_seed_fundamentals_blend_strategy.down.sql").read()
assert [type(s.stmt).__name__ for s in parse_sql(up)] == ["InsertStmt"]
assert parse_sql(down) == ()
print("ok")
EOF
grep -c "tpl-" services/xstockstrat-analysis/migrations/029_seed_fundamentals_blend_strategy.up.sql   # expect 0
grep -c "config\.config_values\|requires-env" services/xstockstrat-analysis/migrations/029_seed_fundamentals_blend_strategy.up.sql   # expect 0
```

---

### Step 18 — migration: real-PostgreSQL assertions for the analysis seeds; final-version bump

**Status**: `pending`
**Service**: `xstockstrat-analysis` (files under `scripts/`)
**Files**:
- `scripts/migration-assertions/analysis-028.sql` — create
- `scripts/migration-assertions/analysis-029.sql` — create
- `scripts/migration-assertions/analysis-026.sql` — modify
- `scripts/migration-rerun.py` — modify

**Reviewers**: DBA — replay / down semantics, cross-schema read, harness version assertion; `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Block to delete: `scripts/migration-assertions/analysis-026.sql:9-11` (`… has seed rows`); the existence check `:6-8` stays; header line 1 names AC-15.
- Version assertion: `scripts/migration-rerun.py:1114` — `for schema, want in (("ingest", 15), ("analysis", 27), ("config", p.cfg_top)):`. Pass 3 first runs `migrate goto 26` on analysis (`:1107`, `refuse_down("analysis", 26, "027")`), which executes the 029 and 028 downs before 027's refuses, then `db-migrate.sh up` re-applies them (`:1113`). `REPLAYS` (`:53-59`) is not extended (R-2, D-6).
- No unit test pins 15 or 27 (`grep -n "27\|15" scripts/tests/test_migration_rerun.py` → no version literal).
- The harness database holds `admin@localhost`: `identity` is in `SCHEMAS` (`scripts/migration-rerun.py:26-34`) and is migrated `up` in pass 0 (`:681-684`).
- Include / rollback / `\gset` patterns: as Step 14.
- Open overlap: feature 318 edits this script (Step Dependencies).

**Lands with**: `Step 16, Step 17, Step 19`

**TDD**: `N/A (migration assertions and harness constant; executed only by CI migration-rerun)`

**Covers**: `AC-3, AC-24, AC-25, AC-31, AC-32, AC-33, AC-34`

**Instructions**:
1. `analysis-026.sql`: delete lines 9–11 and drop "AC-15, " from the header. Nothing else.
2. `scripts/migration-rerun.py:1114`: change `("analysis", 27)` to `("analysis", 29)`. Leave the
   `("ingest", …)` element as it is on the tree at that moment (Step 21 owns it).
3. `analysis-028.sql`:
   - Post-state (`AC-3`): the non-retired `system` rows are exactly the 14 ids of Step 16, version 1;
     and no row exists for `tpl-zz_fscore_probe`, `tpl-dbg_regime_voo_inverted`,
     `tpl-diag_formula_probe`, `tpl-jjjjjjj`, `tpl-bbbb`, `tpl-aaaa`, `tpl-rsi20`,
     `tpl-range_mean_reversion`, `tpl-range_mean_reversion_v3`.
   - Replay does not un-retire (`AC-24`, analysis row): `BEGIN;` retire one seeded row; `\ir` 028 up;
     14 rows, still retired; `ROLLBACK;`.
   - Down keeps a version-2 row (`AC-25`): `BEGIN;` set `tpl-quality_dip_buyer` to `version = 2`;
     `\ir` 028 down; exactly one row remains, `tpl-quality_dip_buyer` at 2; `ROLLBACK;`.
4. `analysis-029.sql` — each state inside its own `BEGIN; … ROLLBACK;`, resolving the admin id with
   `SELECT user_id::text FROM identity.users WHERE email = 'admin@localhost'` written as an **inline
   subselect** in each statement (no `\gset` variable — the offline `pglast` parse in Verification
   substitutes only `:'seed_user_id'`):
   - Admin present, owning no blend (`AC-31`): delete that user's `fundamentals_macd_blend` row; `\ir`
     029 up; exactly one row, `active` true, `live_enabled` false, `definition_json->>'user_id'` equal
     to the admin id, and every `COMPONENT_KIND_CUSTOM_FORMULA` element of
     `definition_json->'components'` has `formula_id = 'd1ff5e6b-6d9c-589d-b95e-defd862c702b'`.
   - Already owning (`AC-32`): set that row's `live_enabled = TRUE`, `display_name = 'mine'`; `\ir` up;
     both values unchanged.
   - Admin absent (`AC-33`): delete the blend row, then `UPDATE identity.users SET email =
     'renamed@localhost' WHERE email = 'admin@localhost'` (a rename, so no foreign key is disturbed);
     `\ir` up succeeds and `analysis.strategies` holds 0 rows with `strategy_id =
     'fundamentals_macd_blend'` for that user id.
   - Down leaves it (`AC-34`): with the row present, `\ir` 029 down; the row still exists.
5. A renumber changes both new file names, their `\ir` paths and the tuple value.

**Verification**:
```bash
grep -c "has seed rows" scripts/migration-assertions/analysis-026.sql   # expect 0
grep -n '("analysis", 29)' scripts/migration-rerun.py   # one hit, in pass_3
cd scripts && uv run --extra dev ruff check migration-rerun.py && uv run --extra dev ruff format --check migration-rerun.py \
  && uv run --extra dev pytest tests/test_migration_rerun.py -q && cd ..
uv run --no-project --with pglast python3 - <<'EOF'
import re
from pglast import parse_sql, parse_plpgsql
for name in ("analysis-026", "analysis-028", "analysis-029"):
    text = open(f"scripts/migration-assertions/{name}.sql").read()
    sql = "\n".join(l for l in text.splitlines() if not l.lstrip().startswith("\\"))
    sql = re.sub(r"\\gset", ";", sql).replace(":'seed_user_id'", "'x'")
    n = len(parse_sql(sql))
    for m in re.finditer(r"DO \$\$.*?\$\$;", sql, re.S):
        parse_plpgsql(m.group(0))
    print(name, n, "statements parse")
EOF
```
Live run: CI `migration-rerun` on the integration PR.

---

### Step 19 — test: seeded strategy templates validate and instantiate; blend literal is a valid REGISTER

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_seed_strategy_templates.py` — create
- `services/xstockstrat-analysis/tests/test_strategy_templates_real_pg.py` — modify
- `.github/workflows/ci.yml` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Template validator: `analysis/app/handlers/servicer.py:3589-3627` `_validate_template_definition` (reads indicators `ListTemplates`, builds `formula_outputs` = `{"value"}` ∪ declared outputs, then `_validate_definition`, `analysis/app/services/evaluator.py:831`).
- Handler under test: `servicer.py:3746-3874` `InstantiateTemplate`.
- REGISTER validation path for the blend literal: `servicer.py:6597-6607` `_normalize_source_symbols`, `:7348-7356` `_strip_dead_signal_params`, `:785` `_validate_definition_proto` (issues `GetFormula` per formula component).
- Reusable doubles (import, do not copy): `analysis/tests/test_strategy_templates.py:88-134` `FakeTemplates`, `:137-157` `FakeIntents`, `:159-196` `FakeStrategies`, `:205-218` `_copy` / `_indicators`, `:221-227` `_svc`, `:230-236` `_instantiate`, `:32` `_BOB`; `ListTemplates` stub shape `:276-292`; all-fields assertion precedent `:427-451`. `RecordingStub`, `ctx_with` from `tests/conftest.py`.
- Real-PG guard that the new seed file trips: `analysis/tests/test_strategy_templates_real_pg.py:26-30` — `touching = [p.name … if "strategy_templates" in p.read_text()]; assert touching == [_DDL_FILE]`. Under `CI=true` these tests fail rather than skip (`analysis/tests/conftest.py:439-447`).
- CI path filter: `.github/workflows/ci.yml:58` `xstockstrat-analysis: ['services/xstockstrat-analysis/**']`; rule PLAT-18 (`docs/context-constitution.md:56`) — a test that reads another service's file needs that path in the filter, in the same PR.

**Lands with**: `Step 16, Step 17, Step 18`

**TDD**: `red-green required` — RED: written before Steps 16–17's files exist, every test fails on the missing seed file.

**Covers**: `AC-3, AC-4, AC-5, AC-19, AC-22, AC-31, AC-36, AC-37, AC-38`

**Instructions**:
1. Inline parsers (D-23): the 028 seed by glob `migrations/*_seed_strategy_templates.up.sql`; the
   indicators seed by glob `../xstockstrat-indicators/migrations/*_seed_formula_templates.up.sql`
   (resolved from `__file__`); the 029 file by glob `migrations/*_seed_fundamentals_blend_strategy.up.sql`
   (its two `$t$` literals: display name, definition JSON).
2. `AC-3` / `AC-19` / `AC-22`: 14 rows; ids are `tpl-` + the 14 FR-2 strategy ids, including
   `tpl-dip_buyer_vol_stop`; none for the nine excluded ids; `_row_to_strategy_template(row).meta.read_only`
   is true for each; `ListTemplates` over a `FakeTemplates` of the rows returns 14.
3. Strict parse (D-36 a): `json_format.ParseDict(payload, StrategyDefinition())` **without**
   `ignore_unknown_fields` succeeds for all 14.
4. `AC-36`: no payload has a `user_id`, `origin`, `warnings`, `active` or `live_enabled` key.
5. `AC-4`: every `COMPONENT_KIND_CUSTOM_FORMULA` `formula_id` is the `template_id` of a parsed formula
   seed row.
6. D-8: for each of the 14, `_validate_template_definition` returns `False` with the indicators stub's
   `ListTemplates` answering `FormulaTemplate`s built from the parsed formula seed.
7. `AC-38` (D-36 b): as non-admin `bob`, drive the real `InstantiateTemplate` for each of the 14 with
   `FakeTemplates(rows)`, fresh `FakeIntents` / `FakeStrategies` and `_indicators()`; all succeed, each
   created definition has `active` and `live_enabled` false, every custom-formula component points at a
   `bob-…` copy, and `_validate_definition(created, formula_outputs)` passes with `formula_outputs`
   keyed by the copy ids.
8. `AC-5`: for `tpl-squeeze_breakout_trend` the saga request's `template_ids` are exactly
   `tpl-bollinger_squeeze_percentile` and `tpl-volatility_trailing_stop_direction`, and the `sqz` and
   `vts` components point at their copies.
9. `AC-37`: `bob` instantiates `tpl-fundamentals_macd_blend` with no `strategy_id` → strategy
   `fundamentals_macd_blend_copy`, not aborted by the blend guard, inactive and not live; its `fscore`
   component points at the copy of `tpl-fundamentals_value_quality_composite_template` and not at
   `d1ff5e6b-6d9c-589d-b95e-defd862c702b`.
10. `AC-31` (D-36 c): the 029 definition parses strictly, has `strategy_id == "fundamentals_macd_blend"`,
    every custom-formula `formula_id` is `d1ff5e6b-…`, has none of the dead `signal_params` keys, and
    passes `_normalize_source_symbols` + `_validate_definition_proto` with `GetFormula` answering for
    that id from the seeded composite template payload (decision 5).
11. `test_strategy_templates_real_pg.py:26-30`: keep `assert touching == [_DDL_FILE]` but select files
    with `re.search(r"(CREATE|ALTER)\s+TABLE[^;]*analysis\.strategy_templates", text)` instead of the
    substring test (D-11).
12. `.github/workflows/ci.yml:58`: append
    `'services/xstockstrat-indicators/migrations/*_seed_formula_templates.up.sql'` to the
    `xstockstrat-analysis` filter list.

C-13: the parsers have one consumer in this service; the doubles are imported from their existing
module, not copied.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run ruff check . && uv run ruff format --check . \
  && uv run pytest --cov=app --cov-fail-under=40
grep -n "seed_formula_templates" ../../.github/workflows/ci.yml   # one hit, on the xstockstrat-analysis filter line
grep -n "^from scripts\|^import scripts" tests/test_seed_strategy_templates.py   # expect no match
```

---

### Step 20 — migration: `016_seed_source_templates` (ingest)

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/migrations/016_seed_source_templates.up.sql` — create
- `services/xstockstrat-ingest/migrations/016_seed_source_templates.down.sql` — create

**Reviewers**: DBA — migration NNN numbering (no gaps, no conflicts), up+down pair present, run-order compliance with `scripts/db-migrate.sh`; `xstockstrat-ingest` owner — signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- Last migration: `ingest/migrations/015_backfill_webhook_callback.up.sql`. Template DDL `ingest/migrations/013_signal_ownership_templates.up.sql:119-129`.
- Payload contract: the six keys of `_TEMPLATE_PAYLOAD_FIELDS` (`ingest/app/handlers/servicer.py:169-176`), snake_case (`:179-181`); read with `ignore_unknown_fields=True` (`:186`).
- `signal_sources`: PK `(user_id, slug)` (`ingest/migrations/013_signal_ownership_templates.up.sql:24-32`); insert column list `ingest/app/repositories/signal_sources.py:157-161`; `source_type` CHECK includes `derived` (`ingest/migrations/011_signal_source_type_mcp_client.up.sql:10-16`).
- Values the producer registers: `analysis/app/engine/fundsignal_loop.py:619-625` (`display_name="Fundamentals Signal Producer"`, `source_type="derived"`, `extractor_module="app.extractors.noop"`, `active=True`); an omitted weight resolves to 1.0 (`ingest/app/handlers/servicer.py:1575-1576`). A second registration returns `ALREADY_EXISTS`, which the producer treats as registered (`fundsignal_loop.py:631-634`).
- Reserved-slug rule to preserve: `ingest/app/handlers/servicer.py:1426-1437` (`_register_conflict`: `system` may not take a slug a user holds); the register path serialises on `pg_advisory_xact_lock(hashtext($1))` (`:1570`).
- Website types require `url` and `scrape_selector` (`ingest/app/repositories/signal_sources.py:257-267`).

**Lands with**: `Step 21, Step 22`

**TDD**: `N/A (migration)`

**Covers**: —

**Instructions**:
1. **Template rows** — `tpl-sec_edgar_8k`, `tpl-sec_edgar_form4`, `tpl-prnewswire_releases`,
   `tpl-robinhood_snacks`; `name` = the snapshot `display_name`; `description` = `''`. Same INSERT
   shape and rules as Step 13 § 2 on `ingest.source_templates` (`$t$` literals in the order
   `template_id`, `name`, `description`, payload JSON; `'system'`; `ON CONFLICT (template_id) DO
   NOTHING`).
2. **Payloads** — exactly `slug`, `display_name`, `source_type`, `extractor_module`, `config_json`,
   `reliability_weight`, each copied from Step 12's snapshot row. `config_json` is copied whole,
   including the SEC `request_headers` User-Agent as stored (OQ-4, operator decision). No other key;
   never a credential.
3. **Collision guard** as Step 13 § 4 on `ingest.source_templates` with the four ids and the prefix
   `ingest seed_source_templates:`.
4. **System `fundamentals` source** (D-4, D-16 exception), after the guard:
   ```sql
   DO $$
   BEGIN
     PERFORM pg_advisory_xact_lock(hashtext('fundamentals'));
     IF NOT EXISTS (SELECT 1 FROM ingest.signal_sources WHERE slug = 'fundamentals') THEN
       INSERT INTO ingest.signal_sources
         (user_id, slug, display_name, source_type, extractor_module, credentials_ref, config_json, active, reliability_weight)
       VALUES ('system', 'fundamentals', 'Fundamentals Signal Producer', 'derived', 'app.extractors.noop', NULL, NULL, TRUE, 1.0);
     END IF;
   END $$;
   ```
   "No holder of the slug" — any owner — is the condition, so a user-held slug gains no system holder
   and an existing system row is never modified. The slug is a literal (D-24).
5. **Down file.** Header comment: "never touches ingest.signal_sources — signals reference the
   fundamentals source and the producer may have created it" (FR-6). One statement:
   `DELETE FROM ingest.source_templates WHERE template_id IN (<the four ids>) AND version = 1 AND retired_at IS NULL AND created_by = 'system';`
6. Run `python3 scripts/check-seed-template-parity.py --kind source` before committing the unit.

**Verification**:
```bash
ls services/xstockstrat-ingest/migrations/016_seed_source_templates.up.sql services/xstockstrat-ingest/migrations/016_seed_source_templates.down.sql
ls services/xstockstrat-ingest/migrations/ | grep -c "^016_"   # expect 2
head -5 services/xstockstrat-ingest/migrations/016_seed_source_templates.up.sql | grep -c "requires-env"   # expect 0
uv run --no-project --with pglast python3 - <<'EOF'
import re
from pglast import parse_sql, parse_plpgsql
for f in ("up", "down"):
    sql = open(f"services/xstockstrat-ingest/migrations/016_seed_source_templates.{f}.sql").read()
    print(f, [type(s.stmt).__name__ for s in parse_sql(sql)])
    for m in re.finditer(r"DO \$\$.*?\$\$;", sql, re.S):
        parse_plpgsql(m.group(0))
EOF
# expect: up ['InsertStmt', 'DoStmt', 'DoStmt'], down ['DeleteStmt']
grep -c "signal_sources" services/xstockstrat-ingest/migrations/016_seed_source_templates.down.sql   # expect 1 (the comment only)
python3 scripts/check-seed-template-parity.py --kind source   # exit 0
```

---

### Step 21 — migration: real-PostgreSQL assertions for the ingest seed; final-version bump

**Status**: `pending`
**Service**: `xstockstrat-ingest` (files under `scripts/`)
**Files**:
- `scripts/migration-assertions/ingest-016.sql` — create
- `scripts/migration-assertions/ingest-013.sql` — modify
- `scripts/migration-rerun.py` — modify

**Reviewers**: DBA — replay / down semantics, reserved-slug states, harness version assertion; `xstockstrat-ingest` owner — signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- Block to delete: `scripts/migration-assertions/ingest-013.sql:67-69` (`… has seed rows`); the existence check `:64-66` stays; header line 1 names AC-15.
- The harness fixture already inserts `fundamentals` before 013 runs (`scripts/migration-assertions/fixtures-pre-224.sql:19-22`), so in the shared database the 016 insert branch never fires and the user-held case never occurs — each state must be built in-file (D-5; O-4). `ingest-013.sql:9-19` requires every `derived` source to be `system`-owned; a rolled-back state does not disturb it.
- Version assertion: `scripts/migration-rerun.py:1114`. Pass 3 runs `migrate goto 13` on ingest (`:1102`), executing the 016 and 015 downs before 014's refuses, then `db-migrate.sh up` re-applies them (`:1113`).
- No foreign key references `signal_sources` (`recon.md` § Risks: the only ingest FK is `004_add_backfill_chunks.up.sql:8`).
- Patterns: as Step 14.

**Lands with**: `Step 20, Step 22`

**TDD**: `N/A (migration assertions and harness constant; executed only by CI migration-rerun)`

**Covers**: `AC-11, AC-12, AC-18, AC-24, AC-40`

**Instructions**:
1. `ingest-013.sql`: delete lines 67–69 and drop "AC-15, " from the header. Nothing else.
2. `scripts/migration-rerun.py:1114`: change `("ingest", 15)` to `("ingest", 16)`; leave the analysis
   element as Step 18 set it.
3. `ingest-016.sql`:
   - Post-state: the non-retired `system` template rows are exactly the four ids, version 1.
   - Slug absent (`AC-11`): `BEGIN;` delete every `signal_sources` row with `slug = 'fundamentals'`;
     `\ir` 016 up; exactly one row for the slug, with `user_id = 'system'`, `source_type = 'derived'`,
     `display_name = 'Fundamentals Signal Producer'`, `extractor_module = 'app.extractors.noop'`,
     `active`, `reliability_weight = 1.0`, null `credentials_ref` and `config_json`; `ROLLBACK;`.
   - Existing system row kept (`AC-12`): `BEGIN;` set the system row's `reliability_weight = 0.4`;
     `\ir` up; still 0.4; `ROLLBACK;`.
   - User-held slug (`AC-40`): `BEGIN;` delete the system row, insert a `fundamentals` row owned by
     `u-1`; `\ir` up; 0 rows with `slug = 'fundamentals' AND user_id = 'system'`; `ROLLBACK;`.
   - Replay does not un-retire (`AC-24`, ingest row): `BEGIN;` retire one seeded template; `\ir` up; 4
     rows, still retired; `ROLLBACK;`.
   - Down (`AC-18`): `BEGIN;` `\ir` 016 down; 0 `source_templates` rows with `created_by = 'system'`,
     and the `fundamentals` row owned by `system` still exists; `ROLLBACK;`.

**Verification**:
```bash
grep -c "has seed rows" scripts/migration-assertions/ingest-013.sql   # expect 0
grep -n '("ingest", 16), ("analysis", 29)' scripts/migration-rerun.py   # one hit
cd scripts && uv run --extra dev ruff check migration-rerun.py && uv run --extra dev ruff format --check migration-rerun.py \
  && uv run --extra dev pytest tests/test_migration_rerun.py -q && cd ..
uv run --no-project --with pglast python3 - <<'EOF'
import re
from pglast import parse_sql, parse_plpgsql
for name in ("ingest-013", "ingest-016"):
    text = open(f"scripts/migration-assertions/{name}.sql").read()
    sql = "\n".join(l for l in text.splitlines() if not l.lstrip().startswith("\\"))
    sql = re.sub(r"\\gset", ";", sql).replace(":'seed_user_id'", "'x'")
    n = len(parse_sql(sql))
    for m in re.finditer(r"DO \$\$.*?\$\$;", sql, re.S):
        parse_plpgsql(m.group(0))
    print(name, n, "statements parse")
EOF
```
Live run: CI `migration-rerun` on the integration PR.

---

### Step 22 — test: seeded source templates are valid and instantiable

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_seed_source_templates.py` — create

**Reviewers**: `xstockstrat-ingest` owner — signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- Validators: `ingest/app/repositories/signal_sources.py:235-285` `validate_config_json`; weight check `_weight_error` used at `ingest/app/handlers/servicer.py:1625`; payload key set `:169-176`.
- Handlers: `ListTemplates` `:1599-1604`, `InstantiateTemplate` `:1664-1689` (→ `_register_source` `:1560-1595`).
- Reusable helpers (import, do not copy): `ingest/tests/test_source_templates.py:84-109` `_instantiate(template=…, slug=…, holders=…)` → `(req, patches, ins, stamp)`; patch roots `_SS`, `_ST` (`:22-23`); `make_servicer` (`tests/test_ingest_servicer.py`), `_ctx` (`tests/conftest.py`). JSONB arrives from the pool as JSON text (`test_source_templates.py:33-34`).

**Lands with**: `Step 20, Step 21`

**TDD**: `red-green required` — RED: written before Step 20's file exists, every test fails on the missing seed file.

**Covers**: `AC-6, AC-7, AC-19, AC-22`

**Instructions**:
1. Inline parser (D-23): glob `migrations/*_seed_source_templates.up.sql`, four `$t$` literals per row,
   → rows in the repository's shape with `payload` as JSON text and `created_by = "system"`.
2. Every payload: keys ⊆ `_TEMPLATE_PAYLOAD_FIELDS`; strict `ParseDict` into `SignalSource` succeeds;
   `validate_config_json(source_type, config_json)` is `None`; the weight passes `_weight_error`;
   `extractor_module` is non-empty.
3. `AC-19` / `AC-22`: four rows, ids `tpl-sec_edgar_8k`, `tpl-sec_edgar_form4`,
   `tpl-prnewswire_releases`, `tpl-robinhood_snacks`; `_template_to_proto(row).meta.read_only` is true.
4. `AC-6`: `ListTemplates` for `bob`, with `source_templates.list_active` patched to return the parsed
   rows, returns four templates whose payload slugs are the four names; the `sec_edgar_form4` payload
   has `source_type == "mediated_simple_website"` and `config_json["scrape_selector"] == "entry"`.
5. `AC-7`: `InstantiateTemplate` of the `prnewswire_releases` row with `slug="bob_prnewswire"` (via the
   imported `_instantiate` helper) calls `insert_source` with `user_id` = bob, `slug =
   "bob_prnewswire"`, `active=True`, `config_json["url"] ==
   "https://www.prnewswire.com/news-releases/news-releases-list/"` and `reliability_weight == 1.0`.
6. The up file's `fundamentals` insert carries the literals `'system'`, `'Fundamentals Signal
   Producer'`, `'derived'`, `'app.extractors.noop'`, and the down file contains no statement on
   `signal_sources` (text assertions; the behaviour is Step 21's).

C-13: parser has one consumer in this service; helpers are imported, not copied.

**Verification**:
```bash
cd services/xstockstrat-ingest && uv run ruff check . && uv run ruff format --check . \
  && uv run pytest --cov=app --cov-fail-under=40
grep -n "^from scripts\|^import scripts" tests/test_seed_source_templates.py   # expect no match
```

---

### Step 23 — test: whole-catalog parity and one seeded-id set across every artifact

**Status**: `pending`
**Service**: `scripts/` (repo tooling)
**Files**:
- `scripts/tests/test_check_seed_template_parity.py` — modify
- `.github/workflows/ci.yml` — modify

**Reviewers**: `xstockstrat-indicators` owner, `xstockstrat-analysis` owner, `xstockstrat-ingest` owner — as Step 10

**Codebase Evidence**:
- Trap this closes: ledger `fails.md` 2026-08-05 `signal-source-registry` ("a value set propagated to one artifact but dropped from its siblings"); D-26.
- The id set is repeated in: each up INSERT, each up collision guard, each down `IN` list (Steps 13, 16, 20), each assertion file (Steps 14, 18, 21), the export filter (Step 1) and the checker's derived map (Step 10).
- CI filter: `.github/workflows/ci.yml:68-69` (`scripts: - 'scripts/**'`); the `scripts-python` job runs on it (`:860-893`). PLAT-18 (`docs/context-constitution.md:56`).

**TDD**: `red-green required` — RED on the pre-seed tree is not reproducible once Steps 13–22 are committed, so prove each new assertion by mutation instead: change one id in a scratch copy of a down file and one digit in a scratch copy of a payload and show the corresponding test fail, then run against the real tree. Record both runs.

**Covers**: `AC-35, AC-36`

**Instructions**:
Add real-file tests to the existing module (they read the committed seeds, snapshot, assertion files
and export query from the repo root, `Path(__file__).resolve().parents[2]`):
1. `AC-35`: the checker's `main` over the real tree and snapshot, all kinds, returns 0 and prints no
   difference.
2. `AC-36`: none of the 14 real strategy payloads has a `user_id`, `origin`, `warnings`, `active` or
   `live_enabled` key.
3. Counts: 9 formula, 14 strategy, 4 source rows.
4. D-26, per service: the set of ids in the up INSERT equals the set in the up guard's `IN` list, the
   down's `IN` list, and the set of `tpl-…` ids named in that service's `NNN` assertion file's
   post-state block (files found by glob `scripts/migration-assertions/<service>-*.sql` containing the
   seed slug in an `\ir` line). The export query names exactly the 14 strategy ids and 4 slugs those
   ids imply, and the eight non-composite formula names of the formula seed. The checker's derived
   formula map covers every custom-formula id used by the 14 seeded strategies.
5. `.github/workflows/ci.yml` `scripts:` filter: add `'services/*/migrations/*_seed_*'` (D-10).

C-13: no new domain literal; the tests read the artifacts themselves.

**Coverage**: `scripts/` has no enforced coverage threshold (CI job `scripts-python` runs ruff + pytest only, `docs/patterns/script-tooling.md:29-34`); the pass condition is every listed case green.

**Verification**:
```bash
cd scripts && uv run --extra dev ruff check . && uv run --extra dev ruff format --check . \
  && uv run --extra dev pytest -q
grep -n "_seed_\*" ../.github/workflows/ci.yml   # one hit under the scripts: filter
python3 check-seed-template-parity.py; echo "exit=$?"   # exit=0
```

---

### Step 24 — service: "System" badge instead of Edit / Retire (config-ui templates page)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/config-ui/templates/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — config mutation safety, Connect-RPC call safety, no direct DB access

**Codebase Evidence**:
- `ui/src/app/config-ui/templates/page.tsx:261-307` — the `columns` memo; the `actions` column `:278-304` returns a `RowActionsMenu` with `Edit` and `Retire` for every row.
- Existing pattern for a platform-held row: `ui/src/app/insights/signal-sources/page.tsx:451-452` — `if (src.userId === SYSTEM_SOURCE_OWNER) return <Badge variant="secondary">System</Badge>;`.
- Primitive: `ui/src/components/ui/badge.tsx` (`secondary` variant, token classes only). `Badge` is not yet imported by the templates page (`:23-34`).
- Row type: `CatalogTemplate` (`ui/src/hooks/useTemplates.ts:37-40`) wraps the generated `FormulaTemplate` / `StrategyTemplate` / `SourceTemplate`, so `r.template.meta?.readOnly` exists once Step 3 has regenerated the TS stubs.
- The page is admin-only (`:399-400`) and lists through the config-ui BFF (`ui/src/lib/configUiBff.ts:63,73,79`).

**Lands with**: `Step 25`

**TDD**: `red-green required` — RED: Step 25's spec is written first and fails on the current page (the system row still shows its actions menu and no badge).

**Covers**: —

**Instructions**:
1. Import `Badge` from `@/components/ui/badge`.
2. In the `actions` cell, before building the menu: `if (r.template.meta?.readOnly) return <Badge
   variant="secondary">System</Badge>;` with a one-line constraint comment mirroring
   `signal-sources/page.tsx:451` (system templates are read-only for every user, C-10(c)).
3. No other change: the existing `Badge` variant is reused (C-17), no new colour, no new component, no
   nav change (the page already exists and is registered — `ui/e2e/nav-reachability.spec.ts:58`). Do
   not touch the empty-state copy at `:323-328` (decision 8).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit
grep -n "readOnly" src/app/config-ui/templates/page.tsx
(cd ../.. && python3 scripts/check-duplication.py services/xstockstrat-ui/src)   # DRY guard (enforced for the UI)
```

---

### Step 25 — test: config-ui shows system templates as read-only (e2e)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/config-ui/templates.spec.ts` — create
- `services/xstockstrat-ui/e2e/fixtures/templates.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify
- `services/xstockstrat-ui/e2e/warmup.setup.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — config mutation safety, Connect-RPC call safety, no direct DB access

**Codebase Evidence**:
- Inventory row to extend: `ui/e2e/fixtures/INVENTORY.md:31` (Templates — `FORMULA_TEMPLATE_ZSCORE`, `STRATEGY_TEMPLATE_MEANREV`, `SOURCE_TEMPLATE_NEWSLETTER`, `TEMPLATES`, `FORMULA_TEMPLATE_INSTANCE`; module `e2e/fixtures/templates.ts`). Fixture shapes: `ui/e2e/fixtures/templates.ts:17-70` (Connect-JSON camelCase, numeric `meta.kind`); re-exported by `e2e/fixtures/index.ts:29`.
- The shared mock handlers serve one template per kind and must stay that way (D-18): `ui/e2e/mock-backend.ts:1431-1432,1455-1456,1641-1642`.
- Per-spec route override precedent: `ui/e2e/insights/templates.spec.ts:85-95` (`page.route('**/xstockstrat.indicators.v1.IndicatorsService/ListFormulas', route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(…)}))`). The page's strategy list calls `/config-ui/api/xstockstrat.analysis.v1.AnalysisService/ListTemplates` (`ui/src/lib/browserClients/configUiAnalysisClient.ts:7-8`; BFF path form as `ui/e2e/config-ui/api-smoke.spec.ts:22`).
- Auth helper: `ui/e2e/helpers/auth.ts:88` `addAdminCookie` (never re-implement JWT signing).
- Tab names: `ui/src/hooks/useTemplates.ts:31-35` (`Formula`, `Strategy`, `Signal source`). Row menu trigger label: `` `Actions for template ${name}` `` (`ui/src/app/config-ui/templates/page.tsx:286`).
- New e2e routes are pre-warmed: `ui/docs/e2e-testing.md:9`; `ui/e2e/warmup.setup.ts:35-36` lists `/config-ui` and `/config-ui/sources` but not `/config-ui/templates`.
- **Not found**: an existing spec for the `/config-ui/templates` page (`ls ui/e2e/config-ui/` has none; only `api-smoke.spec.ts` exercises `ManageTemplate`).

**Lands with**: `Step 24`

**TDD**: `red-green required` — RED: on the pre-Step-24 page the system row shows an actions menu and no badge.

**Covers**: `AC-29`

**Instructions**:
1. `fixtures/templates.ts`: add `STRATEGY_TEMPLATE_SYSTEM` — `meta` `{ templateId:
   'tpl-quality_dip_buyer', kind: KIND_STRATEGY, name: 'Quality Dip Buyer', description: …, version: 1,
   readOnly: true }` with a minimal `payload` (`strategyId`, `displayName`). Do **not** add it to
   `TEMPLATES` or to any `mock-backend.ts` handler.
2. `INVENTORY.md:31`: add `STRATEGY_TEMPLATE_SYSTEM` (read-only system template, used through a
   per-spec route override) and the new spec as a consumer.
3. `warmup.setup.ts`: add `'/config-ui/templates'` to `ROUTES` after `'/config-ui/sources'`.
4. New spec, one test (`AC-29`): `addAdminCookie`; `page.route('**/config-ui/api/xstockstrat.analysis.v1.AnalysisService/ListTemplates', …)`
   fulfilling `{ templates: [STRATEGY_TEMPLATE_SYSTEM, { ...STRATEGY_TEMPLATE_MEANREV, meta: {
   ...STRATEGY_TEMPLATE_MEANREV.meta, templateId: 'tpl-admin-custom' } }] }`; open
   `/config-ui/templates`, select the `Strategy` tab. Assert: the `tpl-quality_dip_buyer` row shows the
   text `System` and has no `Actions for template …` button; the `tpl-admin-custom` row has that button
   and its menu offers `Edit` and `Retire`.

C-12: both templates come from the inventory; the `tpl-admin-custom` id is a `{ ...FIXTURE, override }`
spread, which stays inline.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit
grep -n "from '../fixtures'\|helpers/auth" e2e/config-ui/templates.spec.ts
grep -n "STRATEGY_TEMPLATE_SYSTEM" e2e/fixtures/INVENTORY.md e2e/fixtures/templates.ts
python3 ../../scripts/run-e2e.py e2e/config-ui/templates.spec.ts e2e/insights/templates.spec.ts e2e/config-ui/api-smoke.spec.ts
```
(`run-e2e.py` needs a running Docker daemon; where only Node + Chromium are available use
`pnpm exec playwright test <same paths> --project=chromium`. If neither can run in the execute
session, record that and rely on the CI e2e shards — do not mark the scenario proven locally.)

---

### Step 26 — service: `list_templates` documents `readOnly` (agent)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- `agent/app/tools.py:1354-1366` — the `list_templates` tool; its docstring's return line (`:1360-1362`) lists `meta: {templateId, kind, name, description, version, ...}`.
- `agent/app/client.py:1477-1484` — `list_templates` returns `[MessageToDict(t) for t in resp.templates]`. Default `MessageToDict` emits camelCase and omits a false bool, so `meta.readOnly` appears exactly when the server set `read_only = true`; no client code changes (D-18).
- The docstring is the tool description served by the unauthenticated `GET /api/tools` catalog (`agent/tests/test_tools_endpoint.py:79-81` `_catalog`).

**Lands with**: `Step 27, Step 28`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
Extend the `list_templates` docstring's return description: `meta` may carry `readOnly: true`, present
only for platform-seeded system templates, which cannot be edited or retired but are copied with
`instantiate_template` like any other. No parameter, name or return-shape change; no new tool (the
tool count and its inventory surfaces are untouched). `plugins/strat-lab/` needs no change (D-18: the
`backtest` skill does not describe template metadata).

**Verification** (union with Steps 27–28):
```bash
cd services/xstockstrat-agent && uv run ruff check . && uv run ruff format --check . \
  && uv run pytest tests/test_template_tools.py tests/test_tools_endpoint.py -q
grep -n "readOnly" app/tools.py
```

---

### Step 27 — test: `list_templates` reports `readOnly`; docs parity

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_template_tools.py` — modify
- `.github/workflows/ci.yml` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- `agent/tests/test_template_tools.py:46-76` — `_stubs()` builds real `ListTemplatesResponse` messages per kind; `:79-93` `_run`; `:101-110` the routing test.
- Real messages, not `MagicMock`, for proto field assertions: ledger `fails.md` 2026-08-06 `backtest-debug-info`.
- Docs-parity precedent that reads a file outside the service: `agent/tests/test_tools_endpoint.py:91-97` (`docs/runbooks/mcp-tools.md` via `_REPO`).
- The agent CI filter (`.github/workflows/ci.yml:59`) lists three backend source files but not `docs/runbooks/mcp-tools.md`; PLAT-18 (`docs/context-constitution.md:56`) requires the path a new cross-tree test reads to be added in the same PR.

**Lands with**: `Step 26, Step 28`

**TDD**: `red-green required` — RED: the two text assertions fail before Steps 26 and 28.

**Covers**: `AC-30`

**Instructions**:
1. `AC-30`: with the analysis stub's `ListTemplates` returning one `StrategyTemplate` whose
   `meta` is `TemplateMeta(template_id="tpl-quality_dip_buyer", read_only=True)` and one admin template
   without the flag, `list_templates(kind="strategy")` returns the first with
   `meta["readOnly"] is True` and the second with no `readOnly` key. Extend `_stubs` with an optional
   override rather than a second stub builder.
2. The `list_templates` description in the `/api/tools` catalog contains `readOnly`.
3. `docs/runbooks/mcp-tools.md` contains `readOnly` inside the `### \`list_templates\`` section (slice
   the text between that heading and the next `### `).
4. `.github/workflows/ci.yml:59`: append `'docs/runbooks/mcp-tools.md'` to the `xstockstrat-agent`
   filter list.

C-13: the two `TemplateMeta` messages are scenario one-offs; inline.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run ruff check . && uv run ruff format --check . \
  && uv run pytest --cov=app --cov-fail-under=40
grep -n "mcp-tools.md" ../../.github/workflows/ci.yml   # one hit, on the xstockstrat-agent filter line
```

---

### Step 28 — docs: `list_templates` tool reference

**Status**: `pending`
**Service**: `docs/runbooks/`
**Files**:
- `docs/runbooks/mcp-tools.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/runbooks/mcp-tools.md:788-802` — the `list_templates` section; the return shape at `:801-802` lists `meta: {templateId, kind, name, description, version, retired, createdAt, updatedAt}`.
- `:806-833` — `instantiate_template`; its errors table has no row about system templates and needs none (instantiation is unaffected).

**Lands with**: `Step 26, Step 27`

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
In the `list_templates` section add `readOnly` to the `meta` field list and one sentence: it is present
(`true`) only for platform-seeded system templates (`tpl-*`, seeded by migration since feature 335),
which admins cannot edit or retire; copy them with `instantiate_template`. Also note there that the
blend template `tpl-fundamentals_macd_blend` instantiates under the id `fundamentals_macd_blend_copy`
by default. Change no other section.

**Verification**:
```bash
grep -n "readOnly" docs/runbooks/mcp-tools.md
python3 scripts/check-context-map.py
```

---

### Step 29 — docs: service references (indicators, analysis, ingest, identity)

**Status**: `pending`
**Service**: service `CLAUDE.md` files, identity context-constitution
**Files**:
- `services/xstockstrat-indicators/CLAUDE.md` — modify
- `services/xstockstrat-analysis/CLAUDE.md` — modify
- `services/xstockstrat-ingest/CLAUDE.md` — modify
- `services/xstockstrat-identity/docs/context-constitution.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `indicators/CLAUDE.md:56` § Database; the 007 migration bullet at `:77-79`; § Seeded Formulas at `:98`.
- `analysis/CLAUDE.md:32-76` § "Owner-keyed evidence, identity threading & templates (feature 224)" — the "Blend-id guard" bullet and the "Strategy templates + saga" bullet (which says `ManageTemplate` is "ADMIN only").
- `ingest/CLAUDE.md:68` § Database; the 013 migration bullet at `:85-89`.
- `identity/docs/context-constitution.md:16-31` — rules table, last row `IDENTITY-14`, five columns (ID, Rule, Why, Evidence, Example).
- Doc-reference checker: `scripts/check-context-map.py` (CI `.github/workflows/ci.yml:1093`).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions** (state constraints, not history; keep each addition to the minimum that changes how
an agent acts):
1. `indicators/CLAUDE.md` § Database: add the `008_seed_formula_templates` bullet — 9 `system` formula
   templates, data only; `created_by = 'system'` rows are refused UPDATE/RETIRE by `ManageTemplate`
   (`PERMISSION_DENIED`) and reported `read_only`; catalog changes ship as a new migration that is
   version-guarded and never deletes (D-19); a collision-guard raise is recovered by fixing the
   conflicting row, `migrate force <previous version>`, and re-running (D-20). One line under
   § Seeded Formulas: the composite template's payload is pinned to the code module by
   `tests/test_seed_formula_templates.py` — change both together.
2. `analysis/CLAUDE.md` § templates: `028_seed_strategy_templates` (14 `system` templates, same
   read-only and change rules; its down runs before the indicators seed down);
   `029_seed_fundamentals_blend_strategy` (the blend for `admin@localhost`, active and not live, skipped
   when that user is missing, down is a no-op; reads `identity.users(email, user_id)` at migration
   time). Record the three open risks from `design.md`: the seeded blend cannot be deactivated through
   the API; one `SetStrategyLive(true)` by that account makes a second permanently-live governed blend,
   recoverable only by SQL or `engine.fundamentals_blend_enabled`; while two users hold the id it is
   "ambiguous" for the boot recompute, which is harmless. Amend "`ManageTemplate` (ADMIN only)" to say
   system templates are read-only to admins too.
3. `ingest/CLAUDE.md` § Database: `016_seed_source_templates` — 4 `system` source templates plus the
   `system`/`derived` `fundamentals` source inserted only when no owner holds the slug; the down never
   touches `signal_sources`; the same read-only and change rules.
4. `identity/docs/context-constitution.md`: add `IDENTITY-15` — `identity.users.email` and `.user_id`
   are read by analysis migration `029_seed_fundamentals_blend_strategy` at migration time; renaming
   either, or the `admin@localhost` seed email (`migrations/002_seed_admin.up.sql`), breaks that
   migration's intent and the `migration-rerun` assertions.

**Verification**:
```bash
python3 scripts/check-context-map.py
grep -n "IDENTITY-15" services/xstockstrat-identity/docs/context-constitution.md
grep -n "008_seed_formula_templates" services/xstockstrat-indicators/CLAUDE.md && grep -n "029_seed_fundamentals_blend_strategy" services/xstockstrat-analysis/CLAUDE.md && grep -n "016_seed_source_templates" services/xstockstrat-ingest/CLAUDE.md
```

---

### Step 30 — docs: platform references (constitution, database pattern, root CLAUDE.md)

**Status**: `pending`
**Service**: `docs/`, root `CLAUDE.md`
**Files**:
- `docs/context-constitution.md` — modify
- `docs/patterns/database.md` — modify
- `CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/context-constitution.md:30-56` — `PLAT-*` rows, last is `PLAT-18`, four columns; sentinel rows today are per service (`indicators/docs/context-constitution.md:29` `INDICATORS-12`). C-10(c) requires a new ownership sentinel to be recorded as a governance convention.
- `docs/patterns/database.md:33` — the run order omits `indicators → analysis` (actual: `scripts/db-migrate.sh:152-177`); `:19-20` records the one existing cross-schema read.
- Root `CLAUDE.md` § Database (`:192-196`).
- Doc-reference checker: `scripts/check-context-map.py` (CI `.github/workflows/ci.yml:1093`).
- Feature 276 rejected a *runtime* cross-schema read (`docs/roadmap/features/276-fix-legacy-formula-authors/context.md:24`); D-37 records why this one differs.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions** (state constraints, not history):
1. `docs/context-constitution.md`: add `PLAT-19` — a template row with `created_by = 'system'` is
   platform-seeded and immutable through every RPC in all three template services; `read_only` on
   `TemplateMeta` is derived from it server-side; the only writer is a migration. Evidence anchors: the
   three guard sites added in Steps 4, 6, 8 and the three seed files. Follow the row format of
   `PLAT-18`.
2. `docs/patterns/database.md`: correct the run order to end `… → ingest → indicators → analysis`; in
   the schema-map notes add the second recorded cross-schema read (analysis migration 029 →
   `identity.users`, one-shot, operator-mandated, the only migration-time one).
3. Root `CLAUDE.md` § Database: one sentence — migrations stay inside their own schema; the single
   recorded exception is analysis `029` reading `identity.users` (pointer to `docs/patterns/database.md`).
   Do not touch the Connection Pool Budget table (a test in the agent suite pins its total —
   `docs/context-constitution.md:72`).

**Verification**:
```bash
python3 scripts/check-context-map.py
grep -n "PLAT-19" docs/context-constitution.md
grep -n "indicators → analysis" docs/patterns/database.md
grep -c "Direct backend total\*\* | | | \*\*8\*\*" CLAUDE.md   # expect 1 (unchanged)
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Deviation — execution order (2026-11-12)
- **Steps**: 10+11 ran before 2–9.
- **What**: the parity checker unit was implemented while the Docker codegen image for Steps 2+3 was building.
- **Why safe**: Steps 10+11 touch only `scripts/` and depend on no proto or service change (`## Step Dependencies`).
- **Disposition**: order change only; no step body altered.

### Deviation — integration branch (2026-11-12)
- **What**: commits land on the harness branch `ccr-4bdb931f-mr7ofl` (PR #1526 → `main-dev`), not `feature/seed-curated-templates`.
- **Why**: the execution session may push only to its assigned branch.
- **Disposition**: `feature.md` `**Development Branch**` updated; no per-step PRs (sequential mode).

### Deviation — codegen via the Docker image (2026-11-12)
- **Steps**: 2, 3.
- **What**: `buf lint`, `buf breaking` (against `main-dev`) and `buf-gen.sh` ran inside the version-pinned `Dockerfile.codegen` image (`python3 scripts/localenv-setup.py`) after starting the Docker daemon; `buf` is not installed on the host.
- **Disposition**: CI-equivalent fallback (the sanctioned default in `reference/tooling-setup.md`). Baseline run before the edit left `packages/proto/gen/` unchanged; after the edit exactly the eight `common/v1` outputs changed; a second run was byte-stable.

