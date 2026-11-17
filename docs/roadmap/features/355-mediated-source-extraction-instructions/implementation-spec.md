# Implementation Spec: mediated-source-extraction-instructions

**Status**: `complete`
**Created**: 2026-11-17
**Feature**: `docs/roadmap/features/355-mediated-source-extraction-instructions/feature.md`
**Total Steps**: 11
**Feature Branch**: `feature/mediated-source-extraction-instructions`

---

Paths: `ingest/` = `services/xstockstrat-ingest/`, `agent/` = `services/xstockstrat-agent/`,
`ui/` = `services/xstockstrat-ui/`. Every `path:line` below was read on the tree
`ccr-424ada30-29m2lv@9703dad ≡ origin/ccr-424ada30-29m2lv` (`origin/main-dev@f0ec13f` is an
ancestor). Nothing under `ingest/`, `agent/`, `ui/`, `packages/proto/`, `scripts/` or
`docs/runbooks/mcp-tools.md` changed between the recon tree (`f8e7a99`) and this one
(`git diff --stat f8e7a99 HEAD -- <those paths>` is empty), so recon.md's evidence still holds; a few
of its line numbers were off by one and are corrected here. Symbols marked **new** do not exist today
and are created by the step that names them. `D-n` / `R-n` / `O-n` are `debate.md` ids.

## Execution Summary

The order is design.md § Steps (D-18, D-23, D-29). Each of the design's five steps is written here as
one atomic unit of numbered steps:

1. **Steps 1–4** (design S1) — the proto field, the regenerated stubs, and the two agent client
   projections that the agent's descriptor-parity tests require the moment the field exists.
2. **Step 5** (design S2) — ingest migration `017` (column + prose on the four system templates), its
   assertion file and the migration-rerun version literal.
3. **Steps 6–7** (design S3) — ingest repository, validator, servicer and tests. Needs Step 5: the
   seeded prose is what keeps the seeded mediated templates instantiable once prose is required.
4. **Steps 8–9** (design S4) — agent tool shaping, docstrings, prompt file, runbook and tests.
5. **Steps 10–11** (design S5) — the two UI forms, fixtures and e2e.

**Consumer surfaces (C-14).** Agent: `list_signal_sources`, `manage_signal_source`,
`instantiate_template` — Steps 3 and 8. UI: `/insights/signal-sources` and `/config-ui/templates` —
Step 10. No page, route, tool, RPC, config key, env var or port is added, so there is no
`PLATFORM_SUBNAV` registration, no tool-count change (45 stays, `agent/tests/test_tools_endpoint.py:15`)
and no `docker-compose.yml` / `.do/*.yaml` edit.

**Trading domain (step-constraints §A).** Not engaged: no step touches `TRADING_MODE`, broker
dispatch, order types or fill handling.

**Numbers re-derived (context.md open thread).** `SignalSource` field **15** and ingest migration
**017** are free on this tree, on `origin/main-dev`, and on every `origin/feature/*`,
`origin/feature-steps/*`, `origin/fix/*` and `origin/hotfix/*` head fetched on 2026-11-17 (highest
`SignalSource` field on any of them: 14; no ingest migration ≥ 017). No other in-flight feature's
spec names an ingest migration or the `SignalSource` message. `claude/*` / `ccr-*` heads were not
scanned.

**Deploy window (design.md).** `db-migrator` runs 017 before services roll. Old ingest on the new
schema works. New agent/UI against old ingest shows the default text. Old agent/UI against new ingest
has mediated registers rejected until they deploy.

**Assumptions made by this spec** (each is a choice the design left to `/sdd-spec`):

- `origin/feature/mediated-source-extraction-instructions` does not exist yet, and the feature
  directory is not on `origin/main-dev`. The tree was verified against the harness branch
  `ccr-424ada30-29m2lv`, which stands in for the feature branch in this session; basis: the same
  choice recorded for `/sdd-design` in context.md.
- The design's five steps become 11 numbered steps (`proto` / `proto-gen` / `migration` / `service` /
  `test`), and every `service` + `test` pair lands together; basis: the template's categories and the
  feature-350 spec.
- The three validator messages (Step 6) are worded here; the design fixes only that each names
  `extraction_instructions` (D-23).
- Ingest gets one constant `_MEDIATED_EXTRACTOR_MODULE` for the forced `app.extractors.noop`; basis:
  the literal is written at two sites and exists nowhere in `ingest/app/` today.
- `insert_source` / `update_source` take the new keyword without a default; basis: D-2 "code always
  binds a `str`", and the `reliability_weight` precedent (`ingest/tests/test_signal_sources.py:265`).
- New test modules are `ingest/tests/test_extraction_instructions.py` and
  `agent/tests/test_extraction_instructions.py` (neither path exists).
- The agent treats a whitespace-only stored value as empty when it picks the default text; basis:
  the product spec's definition of "empty".
- The UI over-cap message is "Extraction instructions must be at most 16,000 characters", and the
  new `Textarea` gets its accessible name from `aria-label`; basis: `aria-label="Reliability weight"`
  at `ui/src/app/insights/signal-sources/page.tsx:620`.
- `@AC-15` "does not tell the agent to provide `extractor_module` for a mediated source" is tested
  as: every occurrence of `extractor_module` in the checked text has `non-mediated` within 200
  characters (whitespace-normalised), and the prompt file does not contain `extractor_module` at all.
- The five instruction texts are checked against design.md by one-off commands in Steps 5 and 8, not
  by a committed test; basis: `/sdd-archiver` deletes design.md.
- The runbook's `list_signal_sources` return example is rewritten to the tool's real key set (Step
  8). The paragraph under it that describes source-health fields the tool does not return
  (`docs/runbooks/mcp-tools.md:149-152` vs `agent/app/tools.py:561-571`) is existing drift and is left
  alone — see "Reported, not fixed here".
- Migration SQL is syntax-checked offline with `pglast` through `uv run --no-project --with pglast`
  (run in this session against `016`: 3 and 1 statements); basis: ledger insight 2026-11-10
  (config-dead-rows-prune). CI `migration-rerun` is the live run.
- Ledger read: `insights.md` / `fails.md` (1.2 MB) were filtered to entries about signal sources,
  templates, the agent parity tests and the migration harness, not read end to end.

**Carried from design.md § Open Risks** (none blocks this spec):

- Feature 328 (`fix-agent-bearer-secret-orphan`, spec-ready) edits the same `manage_signal_source` /
  `instantiate_template` bodies; no `merge-order.md` row — whichever merges second rebases (Step 8).
- Admin-authored mediated templates with no prose stop instantiating and cannot be updated until
  prose is added (D-12) — state it in the Step 6 PR description.
- The five instruction texts can be edited cheaply only until Step 5 merges; after that a seeded text
  changes only by a new migration. The operator reviews them in the Step 5 PR.
- An unpaginated `ListSignalSources` with maximum-length prose can exceed the 4 MiB gRPC receive
  limit; no guard is added (O-35).

**Reported, not fixed here.**

- `docs/runbooks/mcp-tools.md:149-152` documents `active` / `health` / `last_seen_at` / `last_error`
  / `signals_fed` on `list_signal_sources`; the tool returns none of them. Hand to `/sdd-qa defect`.
- `agent/app/prompts/signal_extraction.md:36` says `extract_website_content` "handles authentication
  internally"; a source with credentials raises (`agent/app/tools.py:637-638`).

**Integration PR obligations (not steps).** Promote `@AC-1..26` into the durable suites of ingest,
agent and ui (C-16), and add the `@feature-161` `@AC-2` / `@AC-10` EXTEND case (design.md § Business
Rules Touched). Ledger entries are written by `/sdd-execute`.

## Scenario Coverage (C-15)

| Scenario | Step(s) | Test home |
|---|---|---|
| `@AC-1`, `@AC-2`, `@AC-3`, `@AC-4`, `@AC-5` | 7 | `ingest/tests/test_extraction_instructions.py` |
| `@AC-6` | 4 (client projection), 9 (tool) | `agent/tests/test_signal_source_projection.py`, `agent/tests/test_extraction_instructions.py` |
| `@AC-7`, `@AC-8`, `@AC-10`, `@AC-15`, `@AC-24` | 9 | `agent/tests/test_extraction_instructions.py` |
| `@AC-9` | 7 (the instance inherits the template's prose), 9 (response shape) | `ingest/tests/test_seed_source_templates.py`, `agent/tests/test_extraction_instructions.py` |
| `@AC-11`, `@AC-12`, `@AC-13` | 11 | `ui/e2e/insights/signal-sources.spec.ts` |
| `@AC-14` | 11 | `ui/e2e/config-ui/templates.spec.ts` |
| `@AC-16` | 7 (the four seeded payloads, parsed from `017`); also asserted in SQL by Step 5's `ingest-017.sql` in CI | `ingest/tests/test_seed_source_templates.py` |
| `@AC-17` … `@AC-23`, `@AC-25`, `@AC-26` | 7 | `ingest/tests/test_extraction_instructions.py` |

## Step Dependencies

- Steps 1+2+3+4 land together: a `.proto` edit needs its regenerated stubs, and the new field turns
  two agent descriptor-parity tests red until the client carries it (step-constraints §C, row 2).
  The unit spans `packages/proto` and the agent client because those parity guards are the trigger's
  required companions; it has four members, the cap.
- Step 5 stands alone. Step 5 requires nothing from Steps 1–4.
- Steps 6+7 land together: Step 6 adds a required keyword to `insert_source` / `update_source` and
  makes prose mandatory, which fails existing tests that Step 7 edits (`test_signal_sources.py`,
  `test_seed_source_templates.py`).
- Step 6 requires Step 2 (`SignalSource.extraction_instructions` in the Python stubs) and Step 5
  (Step 7 parses `017_…up.sql`; without the seeded prose `test_ac7_…` fails under the new rule).
- Steps 8+9 land together: Step 9's tests are red until Step 8 and are its only proof. Step 8
  requires Step 3 (the client list projection and request builder carry the field).
- Steps 10+11 land together: Step 11's tests are red until Step 10. Step 10 requires Step 2 (the
  TypeScript stubs).
- Step 7 [test] covers Step 6 [service]; Step 4 covers Step 3; Step 9 covers Step 8; Step 11 covers
  Step 10 (C-08).

---

### Step 1 — proto: `extraction_instructions` on `SignalSource`

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/ingest/v1/ingest.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness per message, no breaking change, `buf lint` / `buf breaking` pass; `packages/proto` owner — field number uniqueness, backward compatibility, naming; `xstockstrat-ingest` owner — newsletter source schema stability; `xstockstrat-agent` owner — MCP tool contract stability; `xstockstrat-ui` owner — Connect-RPC call safety

**Codebase Evidence**:
- `packages/proto/ingest/v1/ingest.proto:172-193` — `message SignalSource`; fields 1–14 used; the
  last is `xstockstrat.common.v1.TemplateOrigin origin = 14;` at `:192`. 15 is free (see Execution
  Summary).
- `ingest.proto:240` — `SourceTemplate { meta = 1; SignalSource payload = 2 }`: a template payload is
  a typed `SignalSource`, so templates get the field with no other schema change.
- Not found anywhere in the repo: `extraction_instructions` (outside this feature directory).

**Lands with**: `Step 2, Step 3, Step 4`

**TDD**: `N/A (proto)`

**Covers**: —

**Instructions**:
1. After `ingest.proto:192` add `string extraction_instructions = 15;` with a comment of at most two
   lines: prose an LLM agent follows for a `mediated_*` source; empty on every other type.
2. Plain `string`, not `optional` (D-1, R-1). No enum (C-04 is not engaged: open prose). Field 4
   `extractor_module` is not touched.

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against "../../.git#branch=feature/mediated-source-extraction-instructions,subdir=packages/proto"
```
Run it before the edit is committed. If the feature branch ref cannot be read locally (a fresh
branch — ledger insight 2026-08-19), use `--against "../../.git#ref=HEAD,subdir=packages/proto"`.

---

### Step 2 — proto-gen: regenerate Go / Python / TypeScript stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/ingest/v1/**` — modify (generated)
- `packages/proto/gen/python/ingest/v1/**` — modify (generated)
- `packages/proto/gen/ts/ingest/v1/**`, `packages/proto/gen/ts/dist/ingest/v1/**` — modify (generated)

**Reviewers**: Proto Reviewer — field number uniqueness per message, no breaking change, `buf lint` / `buf breaking` pass; `packages/proto` owner — field number uniqueness, backward compatibility, naming; `xstockstrat-ingest` owner — newsletter source schema stability; `xstockstrat-agent` owner — MCP tool contract stability; `xstockstrat-ui` owner — Connect-RPC call safety

**Codebase Evidence**:
- `scripts/buf-gen.sh` (lint → breaking → generate → Python stubs → compile the TS package). Stubs
  are committed; CI `proto-freshness` (`.github/workflows/ci.yml:255`) fails on a stale tree.
- `buf` is not installed in the spec sandbox (`which buf` → nothing). Host setup and the pre-edit
  empty-diff gate: `docs/runbooks/codegen-toolchain-host-setup.md`.
- No Go service imports `ingest/v1` (`grep -rln "ingest/v1" --include=*.go services` → none).
- Parity guards the new field turns red: `agent/tests/test_signal_source_projection.py:53-54` and
  `agent/tests/test_signal_source_builder.py:91-112`. No other `SignalSource` descriptor guard exists
  (`grep -rn "fields_by_name" services/*/tests` — the two above are the only `SignalSource` hits).
- UI code builds `SignalSource` values as message-init objects (`ui/src/app/insights/signal-sources/page.tsx:290-313`, `ui/e2e/fixtures/signalSources.ts`), so an added field does not break `tsc`.

**Lands with**: `Step 1, Step 3, Step 4`

**TDD**: `N/A (proto-gen)`

**Covers**: —

**Instructions**:
1. Before Step 1's edit: run `./scripts/buf-gen.sh` and confirm `git diff --stat packages/proto/gen/`
   is empty. A non-empty diff is a toolchain mismatch — fix the toolchain, do not commit the noise.
2. After Step 1's edit: run `./scripts/buf-gen.sh`. Stage only generated files under the `ingest/v1`
   subtrees listed above; any other changed generated file is toolchain drift — stop and resolve it.

**Verification**:
```bash
./scripts/buf-gen.sh
git diff --name-only packages/proto/gen/ | grep -v '/ingest/v1/' | wc -l   # expect 0
cd services/xstockstrat-ingest && uv run pytest -q
cd ../xstockstrat-ui && pnpm exec tsc --noEmit
```
The agent suite is red at this point by design (the two parity tests); it goes green with Steps 3–4
in the same unit.

---

### Step 3 — service: agent client carries `extraction_instructions`

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape); no secret values in tool output

**Codebase Evidence**:
- `agent/app/client.py:192-224` — `list_signal_sources`; the projection dict is `:205-222`, last key
  `"origin": _origin_to_dict(src)` at `:221`.
- `agent/app/client.py:1362-1417` — `manage_signal_source`; the builder is `:1386-1392`
  (`extractor_module=source.get("extractor_module", "")` at `:1390`).
- `agent/app/client.py:1429-1441` — `_managed_source_to_dict`: **not** touched here (D-18: the key
  joins it in Step 8 together with the shaping, so no intermediate tree returns a raw
  `extraction_instructions` from manage/instantiate).
- `agent/app/tools.py:558-571` — the `list_signal_sources` tool builds its own seven-key dict, so the
  new client key does not reach a tool response in this step.
- No new outbound RPC: both functions reuse `_metadata()` (`client.py:200`, `:1413`) — header
  propagation is unchanged.

**Lands with**: `Step 1, Step 2, Step 4`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In the list projection add `"extraction_instructions": src.extraction_instructions` after `:221`.
2. In the request builder add `extraction_instructions=source.get("extraction_instructions", "")`
   to the `ingest_pb2.SignalSource(...)` constructor at `:1386-1392`.

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check .
grep -n "extraction_instructions" app/client.py   # two hits: the list projection and the builder
```

---

### Step 4 — test: agent descriptor-parity tests cover the new field

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_signal_source_projection.py` — modify
- `services/xstockstrat-agent/tests/test_signal_source_builder.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability; `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- `agent/tests/test_signal_source_projection.py:28-54` — builds a `SignalSource` (`:31-41`), calls
  `client.list_signal_sources()`, asserts `projected | _INTENTIONALLY_DROPPED == all_fields`
  (`:52-54`). `_INTENTIONALLY_DROPPED = {"extractor_module"}` (`:18`).
- `agent/tests/test_signal_source_builder.py:91-112` — `test_builder_covers_every_signal_source_subfield`
  compares `req.source.ListFields()` with the descriptor minus `_INTENTIONALLY_UNSET_SOURCE`
  (`:30-38`). `ListFields()` reports only non-default fields, so the test's `source` dict
  (`:98-105`) must carry a non-empty value.
- These guard `@AC-9 @feature-161` (PRESERVE, design.md § Business Rules Touched).
- C-13: the `SignalSource` literals are per-module, one consumer each — inline is compliant.

**Lands with**: `Step 1, Step 2, Step 3`

**TDD**: `red-green required`

**Covers**: `AC-6` (client half: the list projection returns the stored text; the tool-level `Then` is Step 9)

**Instructions**:
1. `test_signal_source_projection.py`: give the message at `:31-41`
   `extraction_instructions="Each bolded ticker is a buy signal."` and assert
   `result[0]["extraction_instructions"]` equals it. `_INTENTIONALLY_DROPPED` is unchanged.
2. `test_signal_source_builder.py`: add `"extraction_instructions": "Each entry is a signal."` to the
   `source` dict at `:98-105`. `_INTENTIONALLY_UNSET_SOURCE` is unchanged. Add one test in
   `TestManageSignalSourceBuilderParity`: `_capture_request(operation="update", source={"slug": "uw",
   "extraction_instructions": "X"}, update_mask=["extraction_instructions"])` sets
   `req.source.extraction_instructions == "X"`.
3. RED (after Step 2, before Step 3): both descriptor assertions fail on the missing
   `extraction_instructions`.

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check . && uv run pytest --cov=app --cov-fail-under=40
grep -n "conftest\|def .*fixture" tests/test_signal_source_projection.py tests/test_signal_source_builder.py   # C-13: no new shared literal
```

---

### Step 5 — migration: ingest `017` — prose column and seeded template prose

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/migrations/017_signal_source_extraction_instructions.up.sql` — create
- `services/xstockstrat-ingest/migrations/017_signal_source_extraction_instructions.down.sql` — create
- `scripts/migration-assertions/ingest-017.sql` — create
- `scripts/migration-rerun.py` — modify

**Reviewers**: DBA — migration NNN numbering, up+down pair present, run-order compliance with `scripts/db-migrate.sh`; `xstockstrat-ingest` owner — newsletter source schema stability

**Codebase Evidence**:
- `ls ingest/migrations` → last pair `016_seed_source_templates.{up,down}.sql`; next prefix **017**
  (C-07; re-derived, see Execution Summary).
- The file name must not end `_seed_source_templates.up.sql`: `scripts/check-seed-template-parity.py:31`
  and `ingest/tests/test_seed_source_templates.py:29-32` each require exactly one such file.
- `ingest/migrations/016_seed_source_templates.up.sql:7-13` — four `created_by = 'system'` rows
  (`tpl-sec_edgar_8k`, `tpl-sec_edgar_form4`, `tpl-prnewswire_releases`, `tpl-robinhood_snacks`),
  `ON CONFLICT (template_id) DO NOTHING`; header line 5 states its row grammar; literals are
  dollar-quoted.
- `016_….down.sql:6-8` deletes those ids only `WHERE version = 1 AND retired_at IS NULL AND
  created_by = 'system'`; `scripts/migration-assertions/ingest-016.sql:6-16` asserts `version = 1`.
  Hence no version bump (R-2).
- `ingest/migrations/013_signal_ownership_templates.up.sql:118-128` — `ingest.source_templates`
  has `payload JSONB NOT NULL`, `version`, `created_by`, `updated_at`.
- `scripts/migration-assertions/fixtures-pre-224.sql:19` inserts into `ingest.signal_sources` without
  the new column; CI `migration-rerun` (`.github/workflows/ci.yml:898-934`) replays every up-file —
  the column needs a default and the up must be re-runnable.
- `scripts/migration-rerun.py:1102` `refuse_down("ingest", 13, "014")` runs `goto 13` from the top,
  so `017`'s down is executed there and must succeed; `:1114` hardcodes `("ingest", 16)` as the clean
  version after recovery; `:575-576` + `:1119-1120` pick up every `migration-assertions/*.sql` after
  pass 3. No test pins the `16` (`grep -rn '"ingest", 16' scripts/tests/` → none).
- Assertion-file conventions: `ingest-016.sql` (`BEGIN; … \ir ../../services/xstockstrat-ingest/migrations/<file> … ROLLBACK;`, `RAISE EXCEPTION` in `DO $$` blocks).
- F-01: `016` is not edited.
- The four texts: design.md § Instruction texts, blocks `tpl-sec_edgar_8k`, `tpl-sec_edgar_form4`,
  `tpl-prnewswire_releases`, `tpl-robinhood_snacks`. None contains a `$` character (checked), so no
  text can contain the quote tag.

**TDD**: `N/A (migration)`

**Covers**: —

**Instructions**:
1. `017_….up.sql` — header: the `-- Migration:` and `-- Service:` lines as in `016`, then one
   comment of at most two lines stating the row grammar in words: two dollar-quoted literals per row
   (template id, then the instructions), no literal contains the quote tag, parsed by tests. The
   comment must not write the tag itself (D-29). Then exactly two statements:
   ```sql
   ALTER TABLE ingest.signal_sources
       ADD COLUMN IF NOT EXISTS extraction_instructions TEXT NOT NULL DEFAULT '';

   UPDATE ingest.source_templates AS t
      SET payload = t.payload || jsonb_build_object('extraction_instructions', v.instructions),
          updated_at = NOW()
     FROM (VALUES
       (<id literal>, <instructions literal>),   -- four rows, same quote tag as 016
       …
     ) AS v(template_id, instructions)
    WHERE t.template_id = v.template_id
      AND t.created_by = 'system'
      AND t.payload->>'extraction_instructions' IS DISTINCT FROM v.instructions;
   ```
   Each instructions literal is the matching design.md block, byte for byte, line breaks included.
   No `version` change, no CHECK constraint for the cap (D-2), no statement on `signal_sources` rows
   (R-7).
2. `017_….down.sql` — two statements: `UPDATE ingest.source_templates SET payload = payload -
   'extraction_instructions'` for the four ids `WHERE created_by = 'system' AND payload ?
   'extraction_instructions'`; then `ALTER TABLE ingest.signal_sources DROP COLUMN IF EXISTS
   extraction_instructions;` (same shape as `015_backfill_webhook_callback.down.sql`).
3. `scripts/migration-assertions/ingest-017.sql` — a two-line header in the style of
   `ingest-016.sql:1-3`, then:
   - post-state `DO` block: `information_schema.columns` shows `ingest.signal_sources.extraction_instructions`
     as `text`, `is_nullable = 'NO'`, with an empty-string default; exactly four rows of
     `ingest.source_templates` with `created_by = 'system' AND version = 1` have a non-blank
     `payload->>'extraction_instructions'`.
   - `BEGIN; … ROLLBACK;` — snapshot `(template_id, payload, updated_at)` into a temp table, `\ir`
     the 017 up, raise if any row's `payload` or `updated_at` differs.
   - `BEGIN; … ROLLBACK;` — `\ir` the 017 down, raise if a system row still has the key, if the
     column still exists, or if no `ingest.signal_sources` row with `slug = 'fundamentals'` remains.
4. `scripts/migration-rerun.py:1114` — change `("ingest", 16)` to `("ingest", 17)`. Nothing else.
5. Do not edit `ingest-016.sql`, `016_*`, `scripts/check-seed-template-parity.py` or its testdata
   (D-10).
6. Put the five instruction texts in front of the operator in this step's PR description (design.md
   § Open Risks: last cheap edit point).

**Verification** (offline — no database):
```bash
ls services/xstockstrat-ingest/migrations/017_signal_source_extraction_instructions.up.sql \
   services/xstockstrat-ingest/migrations/017_signal_source_extraction_instructions.down.sql \
   scripts/migration-assertions/ingest-017.sql
ls services/xstockstrat-ingest/migrations/*_seed_source_templates.up.sql | wc -l   # expect 1
uv run --no-project --with pglast python -c "
import sys, pglast
for p in sys.argv[1:]:
    print(p, len(pglast.parse_sql(open(p).read())))
" services/xstockstrat-ingest/migrations/017_signal_source_extraction_instructions.up.sql \
  services/xstockstrat-ingest/migrations/017_signal_source_extraction_instructions.down.sql   # expect 2 and 2
python3 - <<'EOF'
import pathlib, re
d = pathlib.Path("docs/roadmap/features/355-mediated-source-extraction-instructions/design.md").read_text()
want = dict(re.findall(r"^#### `([^`]+)`[^\n]*\n\n```\n(.*?)\n```", d, re.DOTALL | re.MULTILINE))
want.pop("_DEFAULT_EXTRACTION_INSTRUCTIONS")
up = pathlib.Path("services/xstockstrat-ingest/migrations/017_signal_source_extraction_instructions.up.sql").read_text()
lits = re.findall(r"\$t\$(.*?)\$t\$", up, re.DOTALL)
got = dict(zip(lits[0::2], lits[1::2]))
assert len(lits) == 8 and got == want, sorted(set(got) ^ set(want)) or [k for k in want if got[k] != want[k]]
print("017 carries the four design.md texts verbatim")
EOF
grep -n '("ingest", 17)' scripts/migration-rerun.py
cd scripts && uv run --extra dev pytest && uv run --extra dev ruff check . && uv run --extra dev ruff format --check .
```
Then read both files: the up's `ADD COLUMN` is reversed by the down's `DROP COLUMN`, and the up's
payload key by the down's `payload - 'extraction_instructions'`. The apply, replay, refused-down and
`ingest-017.sql` runs are proven by CI `migration-rerun` on the PR, not here.

---

### Step 6 — service: ingest stores, validates and returns `extraction_instructions`

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/repositories/signal_sources.py` — modify
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify
- `services/xstockstrat-ingest/CLAUDE.md` — modify
- `services/xstockstrat-ingest/docs/context-constitution-findings.md` — modify

**Reviewers**: `xstockstrat-ingest` owner — signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- `ingest/app/repositories/signal_sources.py`:
  - `_LIST_COLS` `:51-55` — explicit column list used by `list_all_sources` / `list_sources`.
  - `insert_source` `:135-172` — keyword-only parameters, columns `$1..$9` (`VALUES` at `:160`),
    `RETURNING *`.
  - `update_source` `:175-211` — `SET … reliability_weight = $7` (`:199`), `WHERE slug = $1 AND
    user_id = $8` (`:200`).
  - `get_source` `:127-132` is `SELECT *`; `reactivate_source` / `deactivate_source` are
    `RETURNING *` — all three already return the new column.
  - `validate_config_json` `:235-285` — rejects any `source_type` outside its allow-list (`:280-283`);
    the file ends at `:285`.
- `ingest/app/handlers/servicer.py`:
  - import block `:31-46` (`from app.repositories.signal_sources import (…)`).
  - `_SS_MASKABLE_PATHS` `:58-67`; `_SS_CREDENTIAL_REQUIRED_TYPES` `:70-72`.
  - `_TEMPLATE_PAYLOAD_FIELDS` `:169-176`; `_template_payload` `:179-181` drops any key not listed.
  - `_source_to_proto` `:203-232` (`extractor_module=row["extractor_module"]` `:214`,
    `reliability_weight=row.get("reliability_weight", 1.0)` `:218`); used by list, manage and
    instantiate responses.
  - `_validate_source_write(source_type, config_json, credentials_ref)` `:1504-1516`
    (`@staticmethod`), called at `:1620` (update) and `:1669` (register).
  - `ManageSignalSource` update branch `:1574-1648`: stored row `:1575`; mask checks `:1579-1596`;
    `_use_req` `:1598-1599` (`mask is None or field in mask`); `merged_extractor` `:1605-1607`;
    `merged_cred` `:1615-1619`; `update_source(...)` `:1635-1645`. Reactivate / deactivate
    (`:1557-1566`) never reach the validator.
  - `_register_source` `:1652-1688` — shared by REGISTER (`:1570`) and `InstantiateTemplate`
    (`:1786-1788`); conflict check `:1664`; validation `:1669`; the one `insert_source` call
    `:1672-1685` (`extractor_module=src.extractor_module` `:1677`).
  - `ManageTemplate` `:1699-1765`: admin check `:1704`; system-row `PERMISSION_DENIED` `:1712-1722`;
    RETIRE `:1723-1724`; CREATE/UPDATE validation `:1726-1731`
    (`validate_config_json(...) or _weight_error(src)` `:1728`); `_template_payload(src)` `:1732`.
  - `InstantiateTemplate` `:1767-1795`: `src = _template_to_proto(tpl).payload` (`:1780`), so the
    template's prose reaches `_register_source` through the typed payload.
- Break radius of the two repository signatures (`grep -rn "insert_source\|update_source" ingest`):
  the servicer call sites above, and tests — direct calls at `ingest/tests/test_signal_sources.py:257`,
  `:282`, `:301` (edited in Step 7); every other test patches them with `AsyncMock` or a `**kw` fake
  (`test_ingest_servicer.py:2406-2596`, `test_signal_ownership.py:407-523`,
  `test_source_templates.py:107`, `:278`, `:437`, `:456`), which accept a new keyword.
- `app.extractors.noop` is not a literal anywhere in `ingest/app/` except the dead module's own
  docstring (`app/extractors/noop.py:2`).
- No config key, no new outbound RPC (header propagation unchanged), no pool change (F-06/F-07 not
  engaged).
- Docs: `ingest/CLAUDE.md:112-115` (the `016` bullet in § Database);
  `ingest/docs/context-constitution-findings.md:23` (the `signal_sources.extractor_module` row).

**Lands with**: `Step 7`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

*Repository (`signal_sources.py`)*
1. After `validate_config_json` add (all **new**):
   - `EXTRACTION_INSTRUCTIONS_MAX_CHARS = 16_000`.
   - `is_mediated_source_type(source_type: str) -> bool` — `source_type.startswith("mediated_")`.
     This is the only "mediated" test in ingest; do not enumerate the five types (D-4, R-3).
   - `normalize_extraction_instructions(text: str) -> str` — `""` when `text` is whitespace-only,
     otherwise `text` unchanged (no trim) (D-13).
   - `validate_extraction_instructions(source_type: str, text: str, *, require: bool) -> str | None`,
     checks in this order (D-29), returning the first message:
     1. `len(text) > EXTRACTION_INSTRUCTIONS_MAX_CHARS` →
        `"extraction_instructions must be at most 16000 characters"`;
     2. mediated, `require`, and `text == ""` →
        `f"{source_type} source requires non-empty extraction_instructions"`;
     3. not mediated and `text != ""` →
        `f"extraction_instructions is only allowed on mediated_* sources, not {source_type}"`.
2. `_LIST_COLS`: append `extraction_instructions` as the last column.
3. `insert_source`: add keyword-only `extraction_instructions: str`; append the column last in the
   column list, `$10` in `VALUES`, and the argument last in the call. `config_json` stays at
   positional index 6.
4. `update_source`: add keyword-only `extraction_instructions: str`; append
   `extraction_instructions = $9` to the `SET` list and the argument last. `user_id` stays `$8`.

*Servicer (`servicer.py`)*
5. Import `is_mediated_source_type`, `normalize_extraction_instructions` and
   `validate_extraction_instructions` in the block at `:31-46`.
6. Add the module constant `_MEDIATED_EXTRACTOR_MODULE = "app.extractors.noop"` (**new**).
7. Add `"extraction_instructions"` to `_SS_MASKABLE_PATHS` and to `_TEMPLATE_PAYLOAD_FIELDS`.
8. `_source_to_proto`: pass `extraction_instructions=row.get("extraction_instructions", "")`.
9. `_validate_source_write`: new signature
   `(source_type, config_json, credentials_ref, instructions, *, require_instructions)`; after the
   credential check return `validate_extraction_instructions(source_type, instructions,
   require=require_instructions)`. Order stays `validate_config_json` → credential → instructions, so
   an unsupported type or a missing credential is still reported first.
10. `_register_source` (REGISTER and InstantiateTemplate): compute
    `instructions = normalize_extraction_instructions(src.extraction_instructions)`; call
    `_validate_source_write(src.source_type, cfg_dict, cred, instructions, require_instructions=True)`
    at the existing position (after `_register_conflict`, so `ALREADY_EXISTS` /
    `FAILED_PRECONDITION` keep precedence); pass to `insert_source`
    `extractor_module=_MEDIATED_EXTRACTOR_MODULE if is_mediated_source_type(src.source_type) else
    src.extractor_module` and `extraction_instructions=instructions`.
11. Update branch, between `merged_cred` and the `_validate_source_write` call:
    - `merged_extractor` becomes `_MEDIATED_EXTRACTOR_MODULE` whenever
      `is_mediated_source_type(merged_type)`, whatever the request or the stored row holds (FR-3,
      D-15).
    - If `_use_req("extraction_instructions")` (the mask names it, **or there is no mask** — D-11):
      `merged_instructions = normalize_extraction_instructions(src.extraction_instructions)` and
      `require = is_mediated_source_type(merged_type)`.
    - Otherwise: `merged_instructions = stored.get("extraction_instructions", "")` and
      `require = is_mediated_source_type(merged_type) and not
      is_mediated_source_type(stored["source_type"])`.
    - Pass both to `_validate_source_write`, and `extraction_instructions=merged_instructions` to
      `update_source`. The checks stay after the stored-row lookup and the mask checks, so
      `NOT_FOUND` / `PERMISSION_DENIED` keep precedence.
12. `ManageTemplate` CREATE/UPDATE (`:1726-1732`): set
    `src.extraction_instructions = normalize_extraction_instructions(src.extraction_instructions)`
    before validating; the error expression becomes `validate_config_json(...) or
    validate_extraction_instructions(src.source_type, src.extraction_instructions, require=True) or
    _weight_error(src)`. RETIRE is not validated. The system-row `PERMISSION_DENIED` check stays
    ahead of it.
13. Reactivate and deactivate are not changed and not validated.

*Docs*
14. `ingest/CLAUDE.md` § Database: add one bullet after the `016` bullet — migration
    `017_signal_source_extraction_instructions` (feature 355) adds
    `signal_sources.extraction_instructions` (`TEXT NOT NULL DEFAULT ''`) and writes
    `extraction_instructions` into the four system templates' payloads with no version bump; existing
    source rows are not backfilled.
15. `ingest/docs/context-constitution-findings.md:23`: append to the `signal_sources.extractor_module`
    row — since feature 355 ingest writes `app.extractors.noop` for every `mediated_*` source on
    register and on each update, so a legacy mediated row holding `""` changes on its next update
    (D-15).
16. Comments: constraints only, at most two lines each (root `CLAUDE.md` § How to Act #5).

**Verification** (the union with Step 7; on its own this step leaves `test_signal_sources.py` and
`test_seed_source_templates.py` red):
```bash
cd services/xstockstrat-ingest && ruff check . && ruff format --check .
grep -n "extraction_instructions" app/repositories/signal_sources.py app/handlers/servicer.py
grep -c '"mediated_[a-z_]*"' app/handlers/servicer.py   # expect 1 — _SS_CREDENTIAL_REQUIRED_TYPES; no new type list
```

---

### Step 7 — test: ingest validation, merge rules and seeded prose

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_extraction_instructions.py` — create
- `services/xstockstrat-ingest/tests/test_signal_sources.py` — modify
- `services/xstockstrat-ingest/tests/test_seed_source_templates.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- Existing seams (reuse, do not copy): `make_servicer` (`ingest/tests/test_ingest_servicer.py:35`);
  `transaction_conn` (`ingest/tests/_helpers.py:25`); `_ctx` (`ingest/tests/conftest.py:18`);
  `_source_row(slug, user_id, **over)`, `_aborted_code`, `_SS` (`ingest/tests/test_signal_ownership.py:55`,
  `:95`, `:16`); `_template_row`, `_template_msg(source_type, cfg, **payload_over)`, `_manage_req`,
  `_instantiate`, `_ST` (`ingest/tests/test_source_templates.py:30`, `:64`, `:81`, `:85`, `:24`).
  Cross-module test imports are the house pattern (`test_source_templates.py:19-21`,
  `test_seed_source_templates.py:19-22`).
- Patch points for the write paths: `f"{_SS}.get_source"`, `f"{_SS}.update_source"`,
  `f"{_SS}.insert_source"`, `f"{_SS}.slug_holders"` (`test_ingest_servicer.py:2404-2407`,
  `test_signal_ownership.py:406-408`).
- `ingest/tests/test_signal_sources.py`: direct `insert_source` calls `:257-266` and `:282-291`,
  `update_source` call `:301-310`; from-the-end positional assertions `:274`, `:276`, `:316`, `:317`;
  `config_arg = db.fetchrow.call_args[0][6]` stays valid.
- `ingest/tests/test_seed_source_templates.py`: `_seed_file` `:29-32` (glob
  `*_seed_source_templates.<suffix>.sql`, exactly one match); `_rows()` `:35-52` (four literals per
  row, `re.DOTALL`); `test_every_payload_is_a_valid_credential_free_source` `:59-68` asserts
  `set(payload) <= set(_TEMPLATE_PAYLOAD_FIELDS)` and `_template_payload(parsed) == payload`;
  `test_ac7_prnewswire_template_instantiates_into_a_private_source` `:95-110` instantiates a
  `mediated_simple_website` payload through the real handler.
- `pytest` runs with `asyncio_mode = "auto"` (`ingest/pyproject.toml`).
- C-13: no new domain builder is declared. Mediated rows are `_source_row(...)` spreads and template
  payloads are `_template_row(payload=…)` / `_template_msg(...)` arguments — scenario one-offs on
  existing shared builders. Nothing moves to `conftest.py`.

**Lands with**: `Step 6`

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5, AC-9, AC-16, AC-17, AC-18, AC-19, AC-20, AC-21, AC-22, AC-23, AC-25, AC-26`

**Instructions**:

*`test_signal_sources.py`*
1. Add `extraction_instructions=""` to the `insert_source` call at `:257`, a non-empty value to the
   one at `:282`, and a non-empty value to the `update_source` call at `:301`.
2. Shift the from-the-end assertions: insert `:274` → index `-3` is `1.0`, `:276` → `-2` is `"bob"`,
   and `-1` is the instructions; update `:316` → `-3` is `0.5`, `:317` → `"user_id = $8" in sql` and
   `-2` is `"bob"`, plus `"extraction_instructions = $9" in sql` and `-1` is the instructions.
3. Add unit tests for the new pure functions: the predicate is true for each of the five
   `mediated_*` types and false for `simple_email`, `derived`, `mcp_client`; `normalize` maps `"   "`
   to `""` and leaves `" a "` unchanged; the validator's three messages each contain
   `extraction_instructions`; the length check wins over the other two; 16,000 characters pass and
   16,001 fail, counting code points (use a non-BMP character); `"extraction_instructions"` is in
   `_LIST_COLS`.

*`test_seed_source_templates.py`*
4. Inside `_rows()` overlay migration `017`: read
   `_MIGRATIONS / "017_signal_source_extraction_instructions.up.sql"`, extract its literals with the
   same pattern and `re.DOTALL`, assert the count is even and the ids are exactly the four seeded
   `tpl-*` ids, and set `payload["extraction_instructions"]` on the matching row (D-10, D-29).
5. `test_every_payload_…`: additionally assert, for every row, a non-blank
   `payload["extraction_instructions"]` and
   `validate_extraction_instructions(payload["source_type"], payload["extraction_instructions"],
   require=True) is None` (`@AC-16`).
6. Add `@AC-9` (ingest half): instantiate `tpl-robinhood_snacks` through `_instantiate` and the real
   handler; the `insert_source` keywords carry `extraction_instructions` equal to the template
   payload's and `extractor_module == "app.extractors.noop"`. `test_ac7_…` is not edited — it goes
   red with Step 6 alone and green with the overlay.

*`test_extraction_instructions.py`* (new; test names start with their `@AC`, e.g. `test_ac2_…`)
7. Register (`ManageSignalSource`, patching `slug_holders` → `[]` and `insert_source`):
   - `@AC-1` — `mediated_simple_email`, prose, no `extractor_module`: insert keywords carry the prose
     verbatim and `extractor_module == "app.extractors.noop"`; the response carries both.
   - `@AC-2` — parametrised over the seven example rows (five types with their `config_json` and
     credential, `"   "`, and omitted): `INVALID_ARGUMENT`, the abort message contains
     `extraction_instructions`, `insert_source` not called.
   - `@AC-18` — `simple_email` with prose → `INVALID_ARGUMENT`, no insert.
   - `@AC-19` — 16,000 characters succeed, 16,001 → `INVALID_ARGUMENT`.
   - `@AC-26` — `simple_email` with `"   "` succeeds and stores `""`.
   - Precedence: a mediated register with empty prose on a slug the caller already holds is
     `ALREADY_EXISTS`; on a `system`-held slug `ALREADY_EXISTS` (platform `@AC-36 @feature-224`).
8. Update (patching `get_source` with a `_source_row(...)` spread and `update_source`):
   - `@AC-3` — mask `reliability_weight` only: `update_source` gets the stored prose.
   - `@AC-4` — mask `extraction_instructions` only: gets the new prose.
   - `@AC-5` — stored mediated row with `""`, mask `display_name` only: succeeds, prose stays `""`.
   - `@AC-17` — mask `extraction_instructions`, value `""` → `INVALID_ARGUMENT`, `update_source`
     not called.
   - `@AC-20` — mask `extractor_module` with another module on a mediated row: succeeds and
     `update_source` gets `app.extractors.noop`; the same for a stored `extractor_module` of `""`
     (D-15).
   - `@AC-21` — `simple_email` row, mask `extraction_instructions` with prose → `INVALID_ARGUMENT`.
   - `@AC-22` — mask `extraction_instructions` with 16,001 characters → `INVALID_ARGUMENT`.
   - `@AC-23` — stored mediated `""`, mask `extraction_instructions` with `"   "` →
     `INVALID_ARGUMENT`.
   - No mask (D-11): on a mediated row a request without prose → `INVALID_ARGUMENT`; with prose →
     applied.
   - Type change without the path: stored `simple_email` → `mediated_simple_email` with the mask
     naming only `source_type` → `INVALID_ARGUMENT`; stored mediated with prose → `simple_email`
     without clearing → `INVALID_ARGUMENT`.
   - Reactivate and deactivate of a stored mediated row with `""` succeed, and the response carries
     the row's `extraction_instructions` (`@AC-6 @feature-270` PRESERVE).
9. `ManageTemplate`:
   - `@AC-25` — CREATE, parametrised over the three example rows → `INVALID_ARGUMENT` naming
     `extraction_instructions`, `source_templates.create` not called.
   - CREATE of a mediated payload with prose stores `extraction_instructions` in the payload; a
     whitespace-only value on a non-mediated payload is stored without the key.
   - RETIRE of a mediated template whose payload has no prose succeeds (`@AC-2 @feature-269`
     PRESERVE); UPDATE of a `system` row stays `PERMISSION_DENIED` (platform `@AC-26 @feature-335`).
10. RED: on the tree before Step 6, `@AC-1` fails (the response has no prose and the stored module is
    whatever was sent) and `@AC-2` fails (the register succeeds).

**Verification**:
```bash
cd services/xstockstrat-ingest && ruff check . && ruff format --check . && uv run pytest --cov=app --cov-fail-under=40
grep -n "def .*fixture\|from .conftest\|conftest" tests/test_extraction_instructions.py   # C-13: imports _ctx only; no new shared builder
```

---

### Step 8 — service: agent tools return prose, never `extractor_module`, for mediated sources

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify
- `services/xstockstrat-agent/app/client.py` — modify
- `services/xstockstrat-agent/app/prompts/signal_extraction.md` — modify
- `docs/runbooks/mcp-tools.md` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; no secret values in tool output

**Codebase Evidence**:
- `agent/app/tools.py`:
  - module docstring `:1-5` (`list_signal_sources — lists active sources from ingest, enriched with
    extractor_tool` at `:5`); "Forty-five tools" is unchanged.
  - fixed-prose constant precedent `_CREDENTIALS_UNSUPPORTED` `:92-97` (parenthesised implicit string
    concatenation). `ruff` enforces `line-length = 100` with rule set `E` (`agent/pyproject.toml`),
    and the default text has lines of up to 881 characters, so the constant must be built the same
    way.
  - `_EXTRACTOR_TOOL_MAP` `:304-310` (`mediated_simple_email` absent → `None`).
  - `list_signal_sources` `:539-574`: docstring `:543-551`; entry dict `:561-571` (seven keys).
  - `extract_website_content` `:617-647`: docstring `:621-629`; returns `_fetch_url(...)`'s whole
    body (`:646-647`) — `scrape_selector` is never applied.
  - `list_templates` `:1355-1369`: docstring `:1357-1365`; returns raw camelCase payloads.
  - `instantiate_template` `:1371-1413`: return-shape docstring `:1391-1394`; the client call
    `:1401-1407`.
  - `manage_signal_source` `:1415-1507`: signature `:1416-1426`; "Provide
    slug/display_name/source_type/extractor_module" `:1434`; return-shape docstring `:1457-1459`;
    `source` dict `:1460-1470`; `supplied` mask dict `:1473-1482` (`is not None`); the client call
    `:1492-1498`.
  - `_get_source` `:2642-2652` returns the raw client dict; only `has_credentials` / `config_json`
    are read from it.
- `agent/app/client.py:1429-1441` — `_managed_source_to_dict`, shared by manage (`:1417`) and
  instantiate (`:1511`).
- Tests mock `client.*` with dicts that lack the new keys (`agent/tests/test_tools.py:77-102` — two
  mediated entries without `extraction_instructions` / `origin`; `:2072`, `:2081`, `:2098` return
  `{}`), so every read must be `.get` / `.pop(k, None)` (D-6).
- AST guards walk `_grpc_error_message` call sites only (`agent/tests/test_tool_deadlines.py:296-338`);
  wrapping the two returns does not affect them.
- `GET /api/tools` is generated from signatures and docstrings (`agent/app/main.py:124-143`).
- `agent/app/prompts/signal_extraction.md` — read by nothing at runtime
  (`agent/docs/context-constitution-findings.md:36`); `:9-11`, `:16-23`, `:33`, `:43-71`, `:70-71`,
  `:90` are the lines this step edits.
- `docs/runbooks/mcp-tools.md` — `list_signal_sources` `:118-172` (return example `:130-147`);
  `extract_website_content` `:210-235`; `list_templates` `:788-807`; `instantiate_template`
  `:811-838` (return `:827-829`); `manage_signal_source` `:842-896` (parameter table `:861-872`,
  `extractor_module` row `:869`, return `:882-886`, errors `:888-896`); Usage Patterns `:1792-1824`.
  `docs/runbooks/signal-watchlist-expiry-backfill.md` exists (pointer target).
- The default text: design.md § Instruction texts, block `_DEFAULT_EXTRACTION_INSTRUCTIONS`.
- No new outbound RPC; header propagation unchanged.

**Lands with**: `Step 9`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

*`client.py`*
1. `_managed_source_to_dict`: add `"extraction_instructions": src.extraction_instructions`.

*`tools.py` — helpers, placed after `_EXTRACTOR_TOOL_MAP` (all **new**)*
2. `_is_mediated(source_type: str) -> bool` — `source_type.startswith("mediated_")`. The only
   "mediated" test in the agent; no five-type list.
3. `_DEFAULT_EXTRACTION_INSTRUCTIONS` — the design.md block, byte for byte (11 lines joined by
   `"\n"`), written as parenthesised concatenated literals of at most 100 columns.
4. `_instruction_fields(src: dict) -> dict` — `stored = src.get("extraction_instructions") or ""`;
   returns `{"extraction_instructions": stored, "extraction_instructions_is_default": False}` when
   `stored.strip()` is non-empty, otherwise the default text and `True`.
5. `_shape_managed_source(src: dict) -> dict` — on a copy: `stored = pop("extraction_instructions",
   None)`; when `_is_mediated(copy.get("source_type", ""))`, `pop("extractor_module", None)` and
   merge `_instruction_fields({"extraction_instructions": stored})`; a non-mediated source keeps
   `extractor_module` and gets neither new key.

*`tools.py` — tools*
6. `list_signal_sources`: keep the seven keys; for a mediated `source_type` add the two
   `_instruction_fields(src)` keys and `"origin": src.get("origin")`. A non-mediated entry stays at
   seven keys (no `origin`).
7. `manage_signal_source`: add the parameter `extraction_instructions: str | None = None` after
   `bearer_token`; when not `None` set `source["extraction_instructions"]`; add it to `supplied`
   so the update mask names it only when supplied — `""` is supplied and reaches ingest's rejection;
   return `_shape_managed_source(...)` of the client result.
8. `instantiate_template`: apply `_shape_managed_source` to the result when `kind ==
   "signal_source"`; the other kinds are returned unchanged.

*`tools.py` — docstrings (they are the tool contract and the `/api/tools` catalog)*
9. Module header `:5`: the list tool also returns each mediated source's `extraction_instructions`.
10. `list_signal_sources`: a mediated entry also carries `extraction_instructions` (always
    non-empty: the stored text, or the platform's generic procedure),
    `extraction_instructions_is_default` (true when the generic procedure was substituted) and
    `origin`; follow `extraction_instructions`; `extractor_tool: null` means there is no extraction
    tool to call — read the content yourself and follow `extraction_instructions` — never that there
    is nothing to extract.
11. `manage_signal_source`: document `extraction_instructions` (required non-empty when registering a
    `mediated_*` source; on update applied only when supplied; `""` is rejected on a mediated source;
    not allowed on other types; at most 16,000 characters). Reword `:1434` so that
    `extractor_module` is asked for on non-mediated sources only, and the return shape so that a
    mediated source returns `extraction_instructions` + `extraction_instructions_is_default` and no
    `extractor_module`, while a non-mediated source returns `extractor_module`. Wherever
    `extractor_module` appears, the word `non-mediated` appears in the same sentence.
12. `instantiate_template`: the same two return shapes for `signal_source`.
13. `list_templates`: one line — a mediated source template's curated prose is
    `payload.extractionInstructions`; `payload.extractorModule` has no meaning for a mediated source.
14. `extract_website_content`: `raw_text` is the whole fetched body; `config_json.scrape_selector` is
    only a hint for where the content sits and is not applied.

*`signal_extraction.md`*
15. Name `extraction_instructions` and `extraction_instructions_is_default` in both ingestion flows
    (`:9-11`, `:16-23`, `:33`); state that when `extraction_instructions_is_default` is true the text
    is the generic procedure and the operator should be told; add the precedence line "a source's
    `extraction_instructions` override this generic guidance" to the field/conviction guidance
    (`:43-68`); at `:33` say `scrape_selector` is a hint and the tool returns the whole body; delete
    `:70-71` (`ingest_signal` has no source default conviction); correct `:90` — a repeated signal is
    not an error, the result carries `deduplicated: true`. Do not introduce the word
    `extractor_module` into this file.

*`docs/runbooks/mcp-tools.md`*
16. `list_signal_sources`: replace the return example with a mediated entry showing exactly the
    tool's keys (`slug`, `display_name`, `source_type`, `config_json`, `extractor_tool`,
    `has_credentials`, `reliability_weight`, `extraction_instructions`,
    `extraction_instructions_is_default`, `origin`); add a short paragraph on the three new keys, the
    default-text behaviour and the meaning of `extractor_tool: null`; state that non-mediated entries
    carry the first seven keys only.
17. `extract_website_content`: whole body; `scrape_selector` is a hint.
18. `list_templates`: the one line of item 13.
19. `instantiate_template` and `manage_signal_source`: the two return shapes; the
    `extraction_instructions` parameter row; the `extractor_module` row scoped to non-mediated
    sources (with `non-mediated` on the same line); error rows for empty prose on a mediated source,
    prose on a non-mediated source, and prose over 16,000 characters (`INVALID_ARGUMENT`).
20. Usage Patterns (`:1794-1824`): the precedence line of item 15 in both ingestion patterns; one
    note that a host that knows only the date, with no clock tool, ingests nothing from mediated
    sources until the operator supplies the time of day; one pointer to
    `docs/runbooks/signal-watchlist-expiry-backfill.md` for watchlist entries the seven-day expiry
    does not reach.
21. Comments in code: constraints only, at most two lines each.

**Verification** (the union with Step 9):
```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check . && uv run pytest -q
uv run python - <<'EOF'
import pathlib, re
from tests import conftest  # noqa: F401 — registers the proto gen path
from app import tools
d = pathlib.Path("../../docs/roadmap/features/355-mediated-source-extraction-instructions/design.md").read_text()
want = dict(re.findall(r"^#### `([^`]+)`[^\n]*\n\n```\n(.*?)\n```", d, re.DOTALL | re.MULTILINE))
assert tools._DEFAULT_EXTRACTION_INSTRUCTIONS == want["_DEFAULT_EXTRACTION_INSTRUCTIONS"]
print("default text matches design.md")
EOF
grep -c '"mediated_[a-z_]\{2,\}"' app/tools.py   # expect 4 — the _EXTRACTOR_TOOL_MAP keys; the bare "mediated_" prefix in _is_mediated is not a type literal
```

---

### Step 9 — test: agent response shapes, mask rule and doc parity

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_extraction_instructions.py` — create

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- Tool access: `_make_server()` / `_tool_fn(server, name)` (`agent/tests/test_tools.py:33-40`);
  `_ctx`, `ADMIN`, `TRADER`, `_rpc_error` (`agent/tests/conftest.py:15-40`).
- List tool seam: `patch.object(client, "list_signal_sources", AsyncMock(return_value=[…]))`
  (`agent/tests/test_tools.py:111`).
- Tool → client → stub seam for manage: `_capture_manage_request`
  (`agent/tests/test_signal_source_reliability_weight.py:42-58`) patches `app.client.mtls` and
  `ingest_pb2_grpc.IngestServiceStub`; `_channel_cm` (`agent/tests/test_signal_source_builder.py:41-45`).
- Instantiate seam: `_stubs()` / `_run(tool, **kw)` (`agent/tests/test_template_tools.py:46-97`); its
  ingest stub returns a non-mediated `mcp_client` source (`:67-71`).
- `mcp_client` register needs `client.set_config` patched (`agent/tests/test_tools.py:150-170`).
- Doc-parity idioms: `inspect.getdoc(_tool_fn(...))` and a runbook section split
  (`agent/tests/test_ingest_signal_watchlist.py:248-262`); the repo root is
  `Path(__file__).resolve().parents[3]` (`agent/tests/test_tools_endpoint.py:14`).
- Existing mask tests this extends: `agent/tests/test_tools.py:2068-2101`
  (`@AC-2` / `@AC-10 @feature-161`).
- C-13: the mediated `SignalSource` message / dict literals are used by this module only — inline is
  compliant; helpers are imported, not copied.

**Lands with**: `Step 8`

**TDD**: `red-green required`

**Covers**: `AC-6, AC-7, AC-8, AC-9, AC-10, AC-15, AC-24`

**Instructions** (test names start with their `@AC`):
1. `@AC-6` — list with a mediated client dict holding prose: the entry has that prose and
   `extraction_instructions_is_default is False`.
2. `@AC-7` — list with a mediated dict holding `""`, and one with the key absent: the entry's
   `extraction_instructions == tools._DEFAULT_EXTRACTION_INSTRUCTIONS` (non-empty),
   `extraction_instructions_is_default is True`, and `"noop" not in json.dumps(entry)`. Run it for
   `mediated_simple_email` (the type whose `extractor_tool` is `None`) and one website type.
3. `@AC-24` — a mediated dict with `origin = {"template_id": "tpl-robinhood_snacks", …}` keeps
   `origin.template_id`; an `mcp_client` dict yields an entry with exactly the seven existing keys
   (no `origin`, no instruction keys).
4. `@AC-8` — through the tool → client → stub seam with a stubbed response
   `SignalSource(source_type="mediated_simple_email", extractor_module="app.extractors.noop",
   extraction_instructions="Each bolded ticker is a buy signal.")`, parametrised over `update` with
   `reliability_weight=0.5`, `deactivate`, `reactivate`: the result has the prose,
   `extraction_instructions_is_default is False`, and no `extractor_module` key. Add the legacy
   case: a stubbed mediated response with `""` returns the default text and `True`.
5. `@AC-9` — `instantiate_template(kind="signal_source", …)` with the ingest stub returning a
   mediated source with prose: the result has that prose, `False`, and no `extractor_module` key.
   Formula and strategy results are unchanged (one assertion each on the existing `_run` results).
6. `@AC-10` — register an `mcp_client` source (patch `client.set_config`) with the stub returning
   `SignalSource(source_type="mcp_client", extractor_module="app.extractors.mcp_client")`: the result
   has `extractor_module == "app.extractors.mcp_client"` and neither instruction key.
7. Mask rule (EXTEND `@AC-2` / `@AC-10 @feature-161`): `update` with only `display_name` → the mask
   does not name `extraction_instructions`; `update` with `extraction_instructions="X"` → mask is
   `["extraction_instructions"]` and the request source carries `"X"`; `update` with
   `extraction_instructions=""` → the mask names it (the empty value reaches ingest); `register` of a
   mediated source without `extractor_module` sends the prose and an empty `extractor_module`.
8. An `INVALID_ARGUMENT` from ingest still surfaces as a `ToolError` (`_rpc_error`; `@AC-3
   @feature-161` PRESERVE).
9. `@AC-15` — doc parity, over: `signal_extraction.md`, `docs/runbooks/mcp-tools.md`, and the
   descriptions of `list_signal_sources`, `manage_signal_source`, `instantiate_template`:
   - the prompt file, the runbook, and each of the three descriptions contain both
     `extraction_instructions` and `extraction_instructions_is_default`;
   - after collapsing whitespace, every occurrence of `extractor_module` in the runbook and in the
     three descriptions has `non-mediated` within 200 characters; the prompt file does not contain
     `extractor_module`;
   - the `list_signal_sources` description states that a null `extractor_tool` still means there is
     content to read (assert the phrase the docstring uses);
   - the prompt file and the runbook's Usage Patterns each contain the precedence line.
10. RED: before Step 8, `@AC-7` fails (no instruction keys on the entry) and `@AC-8` fails
    (`extractor_module` is present).

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check . && uv run pytest --cov=app --cov-fail-under=40
grep -n "def .*fixture\|from .conftest\|conftest" tests/test_extraction_instructions.py   # C-13: imports only
```

---

### Step 10 — service: UI forms offer extraction instructions

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/signal-sources/page.tsx` — modify
- `services/xstockstrat-ui/src/app/config-ui/templates/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — config mutation safety, Connect-RPC call safety, no secret values rendered in UI

**Codebase Evidence**:
- `ui/src/app/insights/signal-sources/page.tsx`: `SOURCE_TYPES` `:36-48`; `FormState` `:52-70`;
  `EMPTY_FORM` `:72-89`; `isMediatedType` `:123-125` (`t.startsWith('mediated_')` — reuse);
  `formFromSource` `:163-185`; `handleSave` `:269-338` (validation idiom
  `setSaveError(msg); return;` `:275-276`; the `mcp_client` register source `:290-298`; the shared
  `base.source` `:305-313`; update mask paths `:324-331`); the "Extractor Module" block `:601-609`
  (always rendered, disabled on edit); source type is chosen only on a new source (`:580-599`); the
  error line `:764`. `Textarea` is not imported yet.
- `ui/src/components/ui/textarea.tsx:5` — the `Textarea` primitive (C-17: reuse, no new component).
- `ui/src/app/config-ui/templates/page.tsx`: `PAYLOAD_FIELDS[TemplateKind.SIGNAL_SOURCE]` `:80-87`
  (`extractorModule` at `:84`); `formFromTemplate` case `:132-143`; `buildInput` case `:206-231`
  (`payloadFrom(SignalSourceSchema, prior, {…})` `:222-229`); a `multiline: true` `FieldDef` renders
  as a labelled `Textarea` (`:455-471`); `Textarea` is already imported (`:27`). The field list is
  static per kind.
- The only signal-source write surfaces in the UI are these two pages:
  `ui/src/app/config-ui/sources/page.tsx` has no write call
  (`grep -n "manageSignalSource" ui/src/app/config-ui/sources/page.tsx` → none); the write hooks are
  `ui/src/app/config-ui/hooks/useSignalSourceMutations.ts:10-16`, `:38-58`.
- BFFs are typed pass-throughs (`ui/src/lib/insightsBff.ts:85`, `:102`; `configUiBff.ts:61-64`) — no
  field allow-list to extend.
- No new page or route: no `PLATFORM_SUBNAV` change (C-10(a)). No colour or new primitive (C-17).

**Lands with**: `Step 11`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

*`/insights/signal-sources`*
1. Import `Textarea`. Add `extractionInstructions: string` and
   `loadedExtractionInstructions: string` to `FormState`; both `''` in `EMPTY_FORM`; in
   `formFromSource` set both from `src.extractionInstructions` (the loaded value is captured once
   here, D-13).
2. Replace the "Extractor Module" block (`:601-609`) with a conditional: when
   `isMediatedType(form.sourceType)` render a label "Extraction instructions" and a `Textarea` with
   `aria-label="Extraction instructions"` bound to `form.extractionInstructions`, editable on new and
   on edit; otherwise render the existing "Extractor Module" block unchanged.
3. In `handleSave`, after the weight check and before the `mcp_client` branch, apply (D-13):
   - (iv) not mediated → the value sent is `''` and the mask never names the path;
   - (ii) mediated, editing, the loaded value was `''` and the current value is exactly `''` → send
     no change for the field: omit `extraction_instructions` from the mask, other fields save;
   - (iii) mediated and the value is blank in any other case (new source; whitespace-only; loaded
     prose cleared) → `setSaveError('Extraction instructions are required')` and return — no request;
   - cap: `Array.from(value).length > 16000` →
     `setSaveError('Extraction instructions must be at most 16,000 characters')` and return;
   - (i) mediated and non-blank → send the prose as typed; on update add `'extraction_instructions'`
     to the mask paths.
4. Set `extractionInstructions` on **both** source objects — the `mcp_client` register object
   (`:290-298`) and `base.source` (`:305-313`) — to the value from item 3. `extractorModule` handling
   is unchanged (ingest overrides it on a mediated source).

*`/config-ui/templates`* (three sites, D-17)
5. `PAYLOAD_FIELDS[TemplateKind.SIGNAL_SOURCE]`: add
   `{ key: 'extractionInstructions', label: 'Extraction instructions', multiline: true }` after the
   `extractorModule` entry. Unconditional (D-7): the form does not know the source type; ingest
   rejects an invalid combination (FR-15) and the existing `formError` shows the message.
6. `formFromTemplate`: `extractionInstructions: p?.extractionInstructions ?? ''`.
7. `buildInput`: pass `extractionInstructions: form.extractionInstructions` to `payloadFrom`.
8. No change to `ui/e2e/mock-backend.ts`, the BFFs or the hooks.

**Verification** (the union with Step 11):
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit
grep -n "extractionInstructions" src/app/insights/signal-sources/page.tsx src/app/config-ui/templates/page.tsx
```

---

### Step 11 — test: UI fixtures and e2e for both forms

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/fixtures/signalSources.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/templates.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify
- `services/xstockstrat-ui/e2e/insights/signal-sources.spec.ts` — modify
- `services/xstockstrat-ui/e2e/config-ui/templates.spec.ts` — modify

**Reviewers**: `xstockstrat-ui` owner — config mutation safety, Connect-RPC call safety

**Codebase Evidence**:
- Inventory (C-12): `ui/e2e/fixtures/INVENTORY.md:32` (Templates row — `SOURCE_TEMPLATE_NEWSLETTER`,
  `TEMPLATES`) and `:33` (Signal sources row — `SIGNAL_SOURCE_WEIGHTED` / `_NEUTRAL` / `_SYSTEM`,
  `SIGNAL_SOURCES`); modules `ui/e2e/fixtures/signalSources.ts`, `templates.ts` (re-exported by
  `index.ts:28-29`). **Not found**: any mediated source or mediated template fixture.
- The shared source fixtures hold `signalsFed: BigInt(…)` (`signalSources.ts:29`), which
  `JSON.stringify` cannot serialise; a fixture served through `page.route` must be Connect-JSON
  (no `BigInt`).
- Auth helpers: `addAuthCookie` (`signal-sources.spec.ts:2`), `addAdminCookie`
  (`config-ui/templates.spec.ts:2`) from `ui/e2e/helpers/auth.ts`.
- `ui/e2e/insights/signal-sources.spec.ts`: `openPage` `:43-49`; `isManage` / `MANAGE_SOURCE_BFF`
  `:22-23`; "no ManageSignalSource call" idiom `:149-163`; register flow and source-type select
  (`getByRole('combobox')` → `getByRole('option', …)`) `:207-211`; the edit menu
  (`Actions for <slug>` → `Edit`) `ui/src/app/insights/signal-sources/page.tsx:454-463`; a
  `page.route` override of the same BFF path at `:112-118`.
- `ui/e2e/config-ui/templates.spec.ts:23-32` — a per-test `page.route` on a `ListTemplates` BFF path;
  the ingest template RPCs are served at `/config-ui/api/xstockstrat.ingest.v1.IngestService/…`
  (`ui/src/lib/configUiBff.ts:60-64`). The shared mock lists one static source template and echoes
  `manageTemplate` without storing it (`ui/e2e/mock-backend.ts:1678-1692`), so "reopening shows the
  prose" needs a stateful stub (D-17).
- Templates page selectors: tab "Signal source" (`ui/src/hooks/useTemplates.ts:34`); row menu
  `Actions for template <name>` → `Edit` (`config-ui/templates/page.tsx:288-294`); field id
  `template-<key>` with a `Label` (`:456-466`); "Save template" (`:488`).
- A Connect-JSON `updateMask` is one comma-joined camelCase string
  (`ui/e2e/helpers/watchlistMock.ts:100-102`, `ui/e2e/trader/position-detail.spec.ts:452`).
- No vitest change: the new logic is page code, outside `src/lib/**` coverage.

**Lands with**: `Step 10`

**TDD**: `red-green required`

**Covers**: `AC-11, AC-12, AC-13, AC-14`

**Instructions**:

*Fixtures*
1. `signalSources.ts`: add `SIGNAL_SOURCE_MEDIATED_LEGACY` — a `mediated_simple_email` source owned
   by `TEST_USER_ID` with valid `configJson`, `extractorModule: 'app.extractors.noop'`, a
   `reliabilityWeight`, and **no** `extractionInstructions`; Connect-JSON shape (no `BigInt`). Do not
   add it to `SIGNAL_SOURCES`.
2. `templates.ts`: add `SOURCE_TEMPLATE_MEDIATED_WEBSITE` — `meta.kind` `KIND_SIGNAL_SOURCE`, its own
   `templateId` / `name`, payload `sourceType: 'mediated_simple_website'`,
   `configJson: { url: 'https://example.com/feed', scrape_selector: 'main' }`, no
   `extractionInstructions`. Do not add it to `TEMPLATES`.
3. `INVENTORY.md`: extend rows `:32` and `:33` with the two symbols, noting that each sits outside
   its shared array and is served by a per-test `page.route` stub.

*`signal-sources.spec.ts`* — one `test.describe('Extraction instructions (feature 355)')`; titles
start with their `@AC-N`
4. `@AC-11` — open the new-source form, select `mediated_simple_email` (exact option name): an input
   labelled "Extraction instructions" is visible and the text "Extractor Module" is absent.
5. `@AC-12` — select `simple_email` (exact): "Extractor Module" is visible and no input labelled
   "Extraction instructions" exists.
6. `@AC-13` — mediated type, slug / display name / sender / subject patterns filled, instructions
   empty, click Register: no `ManageSignalSource` request (the `:149-163` idiom) and the text
   "Extraction instructions are required" is visible. Repeat with a whitespace-only value.
7. Register with prose: the request body's `source.extractionInstructions` equals the typed text.
8. Legacy edit (rule ii): route `ListSignalSources` on the insights BFF to return
   `[SIGNAL_SOURCE_MEDIATED_LEGACY]` and `ManageSignalSource` to answer 200; open Edit, change the
   display name, Save: the request is sent, its body does not contain `extractionInstructions`, and
   its `updateMask` still names `displayName`.
9. Edit with prose (rule i): same stubs, type prose, Save: the body's `updateMask` names
   `extractionInstructions` and `source.extractionInstructions` is the prose.
10. Non-mediated register (rule iv): a `simple_email` register body does not contain
    `extractionInstructions`.

*`config-ui/templates.spec.ts`*
11. `@AC-14` — as admin, with a stateful pair of `page.route` stubs on the ingest `ListTemplates`
    (returns the stored template) and `ManageTemplate` (stores the posted `template`, answers with
    it), seeded from a copy of `SOURCE_TEMPLATE_MEDIATED_WEBSITE`: open the "Signal source" tab, Edit
    the template, type "Each 8-K item 2.02 entry is an earnings signal." into "Extraction
    instructions", Save; the `ManageTemplate` body's `template.payload.extractionInstructions` is
    that text; reopen Edit and the field shows it.
12. Scenario one-offs (the route bodies, `{ ...FIXTURE, override }` spreads) stay inline (C-12).
13. RED: before Step 10, `@AC-11` fails (no "Extraction instructions" input) and `@AC-14` fails (no
    such field in the dialog).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit
CI=1 NEXT_DISABLE_STANDALONE=1 pnpm exec playwright test e2e/insights/signal-sources.spec.ts e2e/config-ui/templates.spec.ts e2e/insights/templates.spec.ts e2e/config-ui/sources.spec.ts --project=chromium --no-deps --trace off
grep -n "from '../fixtures'\|helpers/auth" e2e/insights/signal-sources.spec.ts e2e/config-ui/templates.spec.ts
grep -n "SIGNAL_SOURCE_MEDIATED_LEGACY\|SOURCE_TEMPLATE_MEDIATED_WEBSITE" e2e/fixtures/INVENTORY.md
```
(or `python3 ../../scripts/run-e2e.py` for the hermetic full suite). There is no coverage threshold
for the e2e layer.

---

## Deviation Log

### 2026-11-17 — `@AC-27` added after the spec was written
- **What**: one acceptance scenario, `@AC-27 @FR-4`, was appended to `acceptance.feature` at the
  integration stage: the agent names `extraction_instructions` in the update mask only when the
  caller supplies it (the EXTEND of `@AC-2` / `@AC-10 @feature-161` that design.md records).
- **Why**: the design named the extension but no scenario stated it, so it could not be promoted
  (C-16 promotes only reviewed scenarios).
- **Test home**: Step 9's `agent/tests/test_extraction_instructions.py` —
  `test_update_of_another_field_does_not_name_instructions_in_the_mask` and
  `test_supplied_instructions_are_masked_even_when_empty`. No code change.
- **Disposition**: operator approved at the promotion gate (context.md); no step body edited.
