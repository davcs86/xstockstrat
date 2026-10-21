# Implementation Spec: fix-sandbox-seed-keys

**Status**: `pending`
**Created**: 2026-10-20
**Feature**: `docs/roadmap/features/243-fix-sandbox-seed-keys/feature.md`
**Total Steps**: 5
**Feature Branch**: `feature/fix-sandbox-seed-keys`

---

## Execution Summary

The fix follows design.md § Chosen Approach: one forward-only config migration, 031, plus tests and doc
fixes. Indicators source does not change, because `watcher.py:133-145` already reads the full-dotted keys.

Order of work:
1. Step 1 writes the DB assertion file `scripts/migration-assertions/config-031.sql`, red first.
2. Step 2 writes migration 031, which turns Step 1 green.
3. Step 3 adds the indicators getter-contract test. It is independent of Steps 1-2.
4. Step 4 fixes the docs and runs the teardown.
5. Step 5 is design G1: a read-only staging state check right before the integration PR merges into
   `main-dev`, plus an advisory production read-back after promotion.

**Scenario coverage (C-15):**

| Scenario | Step(s) |
|---|---|
| `@AC-1` bare keys gone, full-dotted rows hold 5000 / 134217728 / seed imports with int/int/string | 1 (assertion), 2 (implementation) |
| `@AC-2` watcher resolves stored full-dotted rows (getter-contract guard) | 3 |
| `@AC-3` `memory_bytes` description says headroom, no "memory cap", no "64MB" | 1, 2 |
| `@AC-4` heal does not abort on `config_values_scope_uniq` when a twin exists | 1, 2 |
| `@AC-5` a pre-existing full-dotted row keeps its value and the bare row is removed (appended at this /sdd-spec run, design.md § 4) | 1, 2 |

**Consumer surfaces (C-14).** Product spec names the agent `test_formula`, `/config-ui` and `/insights`.
- `/config-ui` changes through data only. Step 2's rows appear under `indicators.sandbox.*` with the headroom
  description, and the raw-row listing renders them (recon.md:54). No UI code step is needed.
- Effective limits stay 5000 ms / 128 MiB, because the row values equal the code defaults (`watcher.py:134,138`).
  So `/insights` (`services/xstockstrat-ui/src/components/insights/formulaReference.ts:168-175`) and agent
  `test_formula` need no step.
- This is a recorded decision (product-spec.md § Consumer Surface(s); design.md § Chosen Approach), not an
  omission. Once hotfix #1263 merges, its clamp ceiling is the row value, which equals the code default.

## Step Dependencies

- Step 2 requires Step 1. The assertion file must be red against a schema without 031 (P-06), and
  Step 2's draft red needs the AC-4/AC-5 block.
- Step 4 requires Step 2. The docs cite the 031 filename and its sentinel.
- Step 5 requires Steps 1-4. It runs immediately before the integration PR into `main-dev` merges, since a
  `main-dev` push deploys staging (design.md § 3).
- Step 3 has no dependency. It is a standalone `test` step: no `service` step exists, because the indicators
  source is unchanged (design confirmation (i)).
- Re-verify the next config migration number just before merge (`fails.md:2909-2912`). Today it is 031:
  `origin/main-dev` ends at `030_marketdata_edgar_snapshot_keys`, and `git log --remotes` finds no
  `031*`/`032*` config migration. Feature 241 adopts no migration
  (`origin/feature/fix-config-audit-author-spoof:docs/roadmap/features/241-fix-config-audit-author-spoof/design.md:43`).
- Soft ordering with 244 (`tests/test_config_watcher.py`) and hotfix #1263 (indicators `CLAUDE.md`, module
  findings `:24`). Whichever lands second rebases. Neither needs a `merge-order.md` row.

---

### Step 1 — test: DB assertions for migration 031 (`config-031.sql`)

**Status**: `pending`
**Service**: `xstockstrat-config` (harness `scripts/migration-assertions/`)
**Files**:
- `scripts/migration-assertions/config-031.sql` — create

**Reviewers**: `xstockstrat-config` owner — Config key naming (`<service>.<category>.<key>`), environment (`production`/`staging`) / global-per-user scoping, secret encryption + redaction, WatchConfig stream stability

**Codebase Evidence**:
- Runner: `scripts/migration-rerun.sh:183-190` runs every non-`fixtures-*` file in `scripts/migration-assertions/`
  with `psql -v ON_ERROR_STOP=1` (no `-1`), after pass 0 (`:46-83`), pass 1 (`:85-87`) and pass 3 (`:173-181`).
- Config takes the catch-all `*) migrate … up` at `migration-rerun.sh:78`, so 031 is already applied when the
  assertions run. No script edit is needed (design.md § 4; the `goto 30` option is rejected).
- CI: job `migration-rerun` (`.github/workflows/ci.yml:633`). Path filter `migrations` includes
  `scripts/migration-assertions/**` and `services/*/migrations/**` (`ci.yml:70-77`). The repo is mounted at
  `/repo` (`ci.yml:668`). CI runs on every `pull_request` (`ci.yml:3-4`).
- Template: `scripts/migration-assertions/indicators-007.sql:3-23`, `DO $$ … RAISE EXCEPTION 'AC-N: …' $$` blocks.
- **Not found**: no existing assertion file uses `\ir`. psql `\ir` resolves relative to the including file, so
  `../../services/…` from `scripts/migration-assertions/` reaches the repo root.
- Schema: `config.config_values` columns at `services/xstockstrat-config/migrations/001_config_tables.up.sql:7-19`,
  plus `environment` (`002:7`), `caller_identity` (`014_config_caller_identity.up.sql:9`), and
  `value_encrypted`/`user_id` (`017_config_secrets_and_scoping.up.sql:25-26`). Scope index
  `config_values_scope_uniq` is at `017:101-102`.
- Production seed values and descriptions: `002_config_environment.up.sql:61-63`. Staging: `001:62-64`.

**TDD**: `red-green required` (CI-proven). The executor never starts a database (sdd-execute HARD CONSTRAINTS).
RED and GREEN come from the `migration-rerun` job log of the step PR.
- RED a (this step): with 031 absent, block 1 raises `AC-1: …`, because the bare rows exist and the full-dotted
  rows do not (recon.md:79).
- RED b (Step 2): a draft 031 without the twin-wins DELETE raises a `config_values_scope_uniq` unique violation
  inside block 3.
- GREEN: the job passes once the final 031 lands.
- Record each capture in context.md and the PR body. Never edit this step (F-09).

**Covers**: `AC-1, AC-3, AC-4, AC-5`

**Instructions**:
1. Header: one line, `-- config 031 (AC-1, AC-3, AC-4, AC-5): run by migration-rerun.sh after all passes.`
   Add one constraint line: the file replays the historical 031 up-file, so a later migration that changes these
   rows or the `config_values` columns must update or retire it (design confirmation (iii)).
2. **Block 1 — AC-1.** A `DO $$` block that raises `'AC-1: …'` when any of these hold:
   - any `namespace='indicators'` row has key `sandbox.timeout_ms`, `sandbox.memory_bytes` or
     `sandbox.allowed_imports`, in any environment or scope;
   - for each environment in `production` and `staging`, the global row (`user_id IS NULL`) for any of the
     three getter strings is missing or not exactly one. The getter strings are
     `indicators.sandbox.timeout_ms`, `indicators.sandbox.memory_bytes` and `indicators.sandbox.allowed_imports`
     (`watcher.py:134,138,143`; read back against the getter string, `fails.md:2333-2336`);
   - the rows hold values other than `5000` / `134217728` / `numpy,pandas,math,statistics`;
   - the rows have a `value_type` other than `int` / `int` / `string`.
3. **Block 2 — AC-3.** A `DO $$` block over the global `indicators.sandbox.memory_bytes` rows. It raises
   `'AC-3: …'` unless:
   - exactly one row exists per environment `production` and `staging`;
   - every description contains `headroom` and `VmData`;
   - no description matches `ILIKE '%memory cap%'` or `LIKE '%64MB%'`.
4. **Block 3 — AC-4 and AC-5**, wrapped in `BEGIN;` … `ROLLBACK;` so no fixture persists.
   - **Fixture (i), production, Given-faithful to "up to 030".** Columns follow `030_…up.sql:84-85`.
     - `UPDATE` the global `indicators.sandbox.timeout_ms` to `'4000'`.
     - `INSERT` a bare global `sandbox.timeout_ms` = `'3000'`.
     - `DELETE` the global full-dotted `memory_bytes` and `allowed_imports`.
     - Re-`INSERT` their bare forms with the `002:62-63` values and descriptions.
   - **Fixture (ii), staging.**
     - `DELETE` the global `indicators.sandbox.memory_bytes`.
     - `INSERT` a bare global `sandbox.memory_bytes` = `'67108864'`.
     - `INSERT` a per-user twin `indicators.sandbox.memory_bytes` (`user_id='u-243'`) = `'100663296'`.
     - `INSERT` a per-user bare `sandbox.timeout_ms` (`user_id='u-243b'`, no twin) = `'2500'`.
   - **Baseline:** `CREATE TEMP TABLE b031 AS SELECT * FROM config.config_values;`
   - **Replay:** `\ir ../../services/xstockstrat-config/migrations/031_heal_indicators_sandbox_keys_full_dotted.up.sql`.
     Reaching the next statement is the AC-4 "no unique violation" proof.
   - **Assert** in one `DO $$` block. Prefix each failure with `AC-4:` or `AC-5:`.
     - AC-5: exactly one global production `indicators.sandbox.timeout_ms`, with value `4000`.
     - AC-4: no bare `sandbox.*` row of the three keys in any environment or scope.
     - Production global `memory_bytes` and `allowed_imports` exist with `134217728` and the seed imports.
     - Staging global `memory_bytes` exists with `134217728` (renamed and set, not deleted).
     - The `u-243` twin still holds `100663296`.
     - `u-243b` now has `indicators.sandbox.timeout_ms` = `2500`, renamed with its value kept.
     - Every row outside `namespace='indicators' AND key LIKE '%sandbox.%'` equals `b031`: `EXCEPT` in both
       directions, count 0.
   - `ROLLBACK;`
5. Block order matters. Blocks 1-2 come first, so RED a fails on AC-1 (the right reason) and not on the `\ir`.
   Block 3 runs only once 031 exists.
6. Inline literals are scenario one-offs in a single consumer. C-13: compliant, so no fixture home is created.

**Verification**:
Offline:
```
f=scripts/migration-assertions/config-031.sql
grep -c "RAISE EXCEPTION 'AC-1" $f; grep -c "RAISE EXCEPTION 'AC-3" $f
grep -c "AC-4:" $f; grep -c "AC-5:" $f                       # each >= 1
grep -n '^\\ir ../../services/xstockstrat-config/migrations/031_heal_indicators_sandbox_keys_full_dotted.up.sql' $f
grep -c '^BEGIN;$' $f; grep -c '^ROLLBACK;$' $f              # 1 and 1
```
CI: the step PR's `migration-rerun` job fails with `AC-1:` (RED a). It passes after Step 2 (GREEN).

---

### Step 2 — migration: `031_heal_indicators_sandbox_keys_full_dotted` (twin-wins heal, forward-only down)

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/031_heal_indicators_sandbox_keys_full_dotted.up.sql` — create
- `services/xstockstrat-config/migrations/031_heal_indicators_sandbox_keys_full_dotted.down.sql` — create

**Reviewers**: DBA — Migration NNN numbering (no gaps, no conflicts), up+down pair present, run-order compliance with `scripts/db-migrate.sh`; `xstockstrat-config` owner — Config key naming (`<service>.<category>.<key>`), environment (`production`/`staging`) / global-per-user scoping, secret encryption + redaction, WatchConfig stream stability

**Codebase Evidence**:
- Last migration: `services/xstockstrat-config/migrations/030_marketdata_edgar_snapshot_keys.{up,down}.sql`
  (`ls`; `git ls-tree origin/main-dev`). Next free: 031.
- Bare seeds, never edited (F-01):
  - `001_config_tables.up.sql:62-64`: 5000 / `134217728` "Formula memory cap bytes" / imports; this is staging
    after `017:38`.
  - `002_config_environment.up.sql:61-63`: production 3000 / `67108864` "Formula memory cap bytes (64MB)" /
    imports, with `default_value` mirroring.
- Rename shape: `029_heal_config_keys_full_dotted.up.sql:24-28` (`SET key = namespace || '.' || key`, `is_secret = false`).
  As written it is not conflict-safe (ledger `fails.md`, 2026-10-20 entry).
- Snapshot precedent: `017:31-33` (`CREATE TABLE config.config_values_premigration_017 AS SELECT *`). 031 uses
  `IF NOT EXISTS` and an explicit column list instead (design.md § 1 step 0).
- Insert idiom: `030_…up.sql:84-85,117`, including `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING`.
- Description-only update: `016_deprecate_analysis_signal_source_weights_desc.up.sql:9-14`.
- Forward-only down: `029_…down.sql:1-19` (`SELECT 1;`).
- Triggers:
  - BEFORE UPDATE `config.audit_config_change` (`017:66-79`) audits only on a `value_data` change, uses
    `NEW.updated_by` / `NEW.update_reason` / `NEW.caller_identity`, and always bumps `updated_at`.
  - AFTER INSERT `config.audit_config_insert` (`017:81-91`) audits every insert.
- `caller_identity` is populated only for an internal-caller SetConfig write and is NULL otherwise
  (`014_config_caller_identity.up.sql:5-9`).
- Snapshot columns: all of `config.config_values` except `value_encrypted`. That is `id, namespace, key,
  value_type, value_data, is_secret, description, default_value, consuming_service, updated_by, update_reason,
  created_at, updated_at` (`001:7-19`), `environment` (`002:7`), `caller_identity` (`014:9`) and `user_id`
  (`017:26`). `trading_mode` was dropped at `017:96`.
- Headers: no `-- requires-env:` (`scripts/render-migrations.sh:23` reads only the first 5 lines) and no
  `-- contract-of:` (`scripts/check-migration-contract.sh:16`). golang-migrate wraps the file, so it has no
  BEGIN/COMMIT (`029:15`).

**TDD**: `N/A (migration)`. This step implements Step 1's red→green cycle, and the evidence comes from CI (Step 1
**TDD**). RED b: commit and push a draft up-file without statement 1. Capture the `config_values_scope_uniq`
violation from the step PR's `migration-rerun` log into context.md. Then push the final file.

**Covers**: —

**Instructions**:
1. **Up file.** The header is two lines (`-- Migration: …` / `-- Service: xstockstrat-config — feature 243`).
   Every other comment is a constraint of at most 2 lines (How-to-Act #5); rationale goes in the PR body.
   Every statement is re-runnable and carries `namespace = 'indicators'`. Let S = the sentinel
   `updated_by = 'system:config-migration-031'`, `update_reason = 'feature 243: heal bare sandbox seed key'`,
   `caller_identity = NULL`. Statements, in order:
   0. **Snapshot.** `CREATE TABLE IF NOT EXISTS config.config_values_premigration_031 AS SELECT <the explicit
      column list above> FROM config.config_values WHERE namespace = 'indicators' AND key LIKE '%sandbox.%';`
      Constraint comment: the snapshot excludes `value_encrypted`, the down keeps it, and `IF NOT EXISTS`
      keeps a replay from replacing the pre-state.
   1. **Twin wins.** `DELETE FROM config.config_values b WHERE b.namespace = 'indicators' AND b.key IN
      ('sandbox.timeout_ms','sandbox.memory_bytes','sandbox.allowed_imports') AND b.is_secret = false AND EXISTS
      (SELECT 1 FROM config.config_values t WHERE t.namespace = b.namespace AND t.key = 'indicators.' || b.key AND
      t.environment = b.environment AND COALESCE(t.user_id,'') = COALESCE(b.user_id,''));`
      The match uses the full `config_values_scope_uniq` tuple.
   2. **Rename and set the value in one UPDATE**, over the same three bare keys with `is_secret = false`:
      - `key = namespace || '.' || key`;
      - `value_data` and `default_value` = `CASE WHEN user_id IS NULL THEN CASE key WHEN 'sandbox.timeout_ms`
        `THEN '5000' WHEN 'sandbox.memory_bytes' THEN '134217728' ELSE 'numpy,pandas,math,statistics' END ELSE`
        `<the column> END`. The RHS reads the old `key`;
      - set S.
      Never touch `value_type` (CONFIG-10). Per-user rows are only renamed, because the indicators request
      carries no `user_id` (`watcher.py:61-67`).
   3. **Insert any missing global row**: six rows, 3 keys × `production`/`staging`.
      - Columns: `030:84-85`'s list plus `updated_by, update_reason`, with `consuming_service = 'xstockstrat-indicators'`
        and `user_id` NULL.
      - Values and `default_value`: the step-2 literals. `value_type`: `int`/`int`/`string`.
      - Descriptions: `'Formula execution timeout ms'` and `'Allowed imports'` verbatim from `001:62,64`;
        `memory_bytes` uses the step-4 text.
      - End with `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING`.
   4. **Headroom description.** `UPDATE config.config_values SET description = 'Formula memory headroom in bytes`
      `above the sandbox child''s measured pre-lockdown VmData baseline; RLIMIT_DATA = baseline + this value`
      `(feature 228).'`, plus S. Scope: `WHERE namespace = 'indicators' AND key = 'indicators.sandbox.memory_bytes'`
      `AND is_secret = false AND description IS DISTINCT FROM <same text>`. This includes twins and per-user rows.
2. Do not add `pg_notify` (CONFIG-4). Every value effective after 031 equals what subscribers already hold under
   twin-wins (design.md § 1).
3. `caller_identity = NULL` in S is a spec-time refinement of design.md § 1 step-2 attribution. Without it, the
   BEFORE UPDATE audit row inherits any earlier internal caller's `caller_identity` (`017:71-74`, `014:5-9`).
   It is recorded in context.md.
4. **Down file.** A two-line header, then one constraint comment (`-- forward-only: an inverse cannot tell healed
   rows from pre-existing twins or step-1 deletes; keeps premigration_031`), then `SELECT 1;` (029 precedent).
5. Re-verify the NNN before the integration merge (Step 5).

**Verification**:
Offline only:
```
ls services/xstockstrat-config/migrations/031_heal_indicators_sandbox_keys_full_dotted.up.sql \
   services/xstockstrat-config/migrations/031_heal_indicators_sandbox_keys_full_dotted.down.sql
ls services/xstockstrat-config/migrations/ | tail -4          # 030 then 031, no other 031
f=services/xstockstrat-config/migrations/031_heal_indicators_sandbox_keys_full_dotted.up.sql
grep -c "CREATE TABLE IF NOT EXISTS config.config_values_premigration_031" $f   # 1
grep -c "value_encrypted" $f                                                     # 0
grep -c "COALESCE(t.user_id" $f                                                  # 1
grep -c "ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING" $f  # 1
grep -c "system:config-migration-031" $f                                         # >= 3
grep -ci "value_type *=" $f; grep -ci "pg_notify\|BEGIN;\|COMMIT;\|requires-env\|contract-of" $f   # 0 and 0
grep -c "SELECT 1;" services/xstockstrat-config/migrations/031_heal_indicators_sandbox_keys_full_dotted.down.sql  # 1
```
Then check by inspection that the down is forward-only by design (no inverse). The live apply is proven by Step 1's
CI GREEN.

---

### Step 3 — test: AC-2 indicators watcher getter-contract test

**Status**: `pending`
**Service**: `xstockstrat-indicators`
**Files**:
- `services/xstockstrat-indicators/tests/test_config_watcher.py` — modify

**Reviewers**: `xstockstrat-indicators` owner — Formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution

**Codebase Evidence**:
- Helper `_str_watcher(key, val)` at `tests/test_config_watcher.py:51-56`: dial-free `ConfigWatcher.__new__`,
  `snap.values[key].string_val = val`, `w._snapshot = snap`. Its callers are at `:60` and `:74`.
- Getters:
  - `sandbox_timeout_ms` at `app/config/watcher.py:132-134` (`get_int`, default 5000);
  - `sandbox_memory_bytes` at `:136-138` (default `128 * 1024 * 1024`);
  - `sandbox_allowed_imports` at `:140-145` (`get_str_present`, split on `,`).
- `get_int` returns `v.int_val or default` (`:114`; the zero-trap belongs to 244).
- Imports at `:9-12` (`config_pb2`, `ConfigWatcher`).
- Ledger `fails.md:2358-2361`: every getter needs a read-path test against a populated, realistically keyed snapshot.

**TDD**: `red-green required`. Declared escape: "red N/A — no behavior change; characterization test added"
(tdd-gate.md). The getters already read the full-dotted keys, and `acceptance.feature` labels `@AC-2` a
getter-contract guard. Capture the green run in context.md and the PR body.

**Covers**: `AC-2`

**Instructions**:
1. Generalize `_str_watcher` (`:51-56`) into `_watcher(key: str, field: str, val)`, which runs
   `setattr(snap.values[key], field, val)` and keeps the dial-free comment. Update the two callers (`:60`, `:74`)
   to `_watcher(..., "string_val", "")`. Do not add a near-duplicate `_int_watcher` (C-18).
2. Add `@pytest.mark.parametrize` over the three `acceptance.feature` Examples rows:
   `("indicators.sandbox.timeout_ms", "int_val", 3000, "sandbox_timeout_ms", 3000)`,
   `("indicators.sandbox.memory_bytes", "int_val", 100663296, "sandbox_memory_bytes", 100663296)` and
   `("indicators.sandbox.allowed_imports", "string_val", "numpy,math", "sandbox_allowed_imports", ["numpy", "math"])`.
   Assert `getattr(w, prop) == resolved`. Add `import pytest`.
3. C-13: the literals have one consumer, so they stay inline. `_watcher` stays in this file and does not move to
   `tests/conftest.py`.

**Verification**:
```
cd services/xstockstrat-indicators && uv run pytest tests/test_config_watcher.py -q \
  && uv run pytest --cov=app --cov-fail-under=50 \
  && ruff check . && ruff format --check .
grep -n "_str_watcher" tests/test_config_watcher.py          # no output
grep -n "def .*fixture\|from .conftest\|conftest" tests/test_config_watcher.py   # no output (C-13 single consumer)
```

---

### Step 4 — docs: headroom wording, full-dotted key, findings row, sentinel convention, teardown

**Status**: `pending`
**Service**: `docs/`, `services/xstockstrat-indicators/` (docs only)
**Files**:
- `services/xstockstrat-indicators/CLAUDE.md` — modify
- `docs/runbooks/config-rollout.md` — modify
- `docs/runbooks/indicator-builder.md` — modify
- `services/xstockstrat-indicators/docs/context-constitution-findings.md` — modify
- `docs/patterns/config-governance.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-indicators/CLAUDE.md:12`: "…configurable timeout and memory cap". The Config Keys table at
  `:100-103` is already correct.
- `docs/runbooks/config-rollout.md:180`: `snap.values.get('sandbox.timeout_ms')`.
- `docs/runbooks/indicator-builder.md:167`: "and memory cap all come from the `indicators.sandbox.*` config above".
- `services/xstockstrat-indicators/docs/context-constitution-findings.md:23`: "**Inert indicators seeds.** … — status: **open**".
  The repo-level `docs/context-constitution-findings.md` has no such row (**Not found** there).
- `docs/patterns/config-governance.md:93` is `## Author-sentinel conventions`, with the table at `:100-103`.
  Feature 241 rewrites `:95-103` (its impl-spec Step 12), and no prior config migration sets `updated_by`.
- A repo grep for bare `sandbox.{timeout_ms,memory_bytes,allowed_imports}` outside `docs/roadmap/features` and
  `docs/reports` finds only `001:62-64`, `002:61-63` and `config-rollout.md:180`.
- Teardown: root `CLAUDE.md` § Teardown. `.agents/context-forge.json` `scrubberExtraTargets` =
  `README.md`, `docs/patterns/ui-ux-governance.md`; neither is touched.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. `services/xstockstrat-indicators/CLAUDE.md:12`: "memory cap" → "memory headroom".
2. `docs/runbooks/config-rollout.md:180`: `'sandbox.timeout_ms'` → `'indicators.sandbox.timeout_ms'`. Do not touch
   241's hunks (`:76-100`).
3. `docs/runbooks/indicator-builder.md:167`: "memory cap" → "memory headroom".
4. Module findings `:23`: set status **resolved (feature 243)**. Migration 031 heals the rows to
   `indicators.sandbox.*` at 5000 / 134217728 with headroom descriptions; 001/002 stay untouched (F-01). Do not
   touch row `:24` (hotfix #1263).
5. `config-governance.md` Author-sentinel table: add one row.
   - Sentinel: `system:config-migration-<NNN>`.
   - Service: `xstockstrat-config` (SQL migration).
   - Text: "A config migration's raw-SQL data write sets `updated_by` to this sentinel and `caller_identity` to
     NULL (not a SetConfig write); first used by 031 (feature 243)."
   - The wording holds under 241's rewrite. If 241 lands first, rebase this row into its section.
6. Teardown. Run `/context-constitution refresh` scoped to the touched files. If the plugin is unavailable, re-read
   each touched file against the code by hand, and record in the PR body both that the plugin was unavailable and
   what was reconciled (root `CLAUDE.md` § Teardown).

**Verification**:
```
grep -n "memory cap" services/xstockstrat-indicators/CLAUDE.md docs/runbooks/indicator-builder.md   # no output
grep -n "snap.values.get('indicators.sandbox.timeout_ms')" docs/runbooks/config-rollout.md        # 1 hit
grep -n "Inert indicators seeds" services/xstockstrat-indicators/docs/context-constitution-findings.md   # row shows resolved
grep -n "system:config-migration-" docs/patterns/config-governance.md                             # 1 hit
```

---

### Step 5 — config: G1 staging state gate before the `main-dev` merge; production advisory read-back

**Status**: `pending`
**Service**: `xstockstrat-config` (operational, read-only)
**Files**:
- `docs/roadmap/features/243-fix-sandbox-seed-keys/context.md` — modify (record results only)

**Reviewers**: `xstockstrat-config` owner — Config key naming (`<service>.<category>.<key>`), environment (`production`/`staging`) / global-per-user scoping, secret encryption + redaction, WatchConfig stream stability

**Codebase Evidence**:
- Access: `docs/runbooks/operator-db-access.md:42-49` (`psql "<connection-uri>?sslmode=require" -v ON_ERROR_STOP=1 -c …`).
  Safety `:57`: prefer read-only.
- Expected staging state: 3 bare global rows holding the `001:62-64` values (renamed to staging at `017:38`).
  Expected production state: 3 bare rows holding the `002:61-63` values. No full-dotted rows (recon.md:30).
- Snapshot table `config.config_values_premigration_031` (Step 2) records the production pre-state.
- Ledger `fails.md:642-644`: no manual pre-promotion freeze (design.md § Rejected Alternatives).

**TDD**: `N/A (operational read-only gate)`

**Covers**: —

**Instructions**:
1. **Re-verify the NNN.** Run `git fetch origin && git ls-tree --name-only origin/main-dev services/xstockstrat-config/migrations/ | tail -2`.
   If anything at or above `031` exists, stop and renumber Step 2's files to the next free number
   (`fails.md:2909-2912`). Renaming them is a deviation, recorded in the Deviation Log.
2. **Staging G1**, just before the integration PR merges. Run one read-only query:
   `SELECT namespace, key, environment, user_id, is_secret, value_type, value_data, default_value, updated_by,`
   `updated_at FROM config.config_values WHERE namespace = 'indicators' AND key LIKE '%sandbox.%' ORDER BY key,`
   `environment, user_id;` Paste the output into context.md.
   - Pass: exactly the bare global rows, with the seed values, `is_secret = false`, no full-dotted row and no
     `user_id` row.
   - If any of the following appears, escalate to the operator and do not merge: a twin, a per-user row, a secret
     row, or a bare row whose value differs from its seed (including a stored `""` for `allowed_imports`,
     feature-173 `@AC-4`). Fork 1b (overwrite the twin) needs a recorded operator decision, plus a `pg_notify` or
     config restart (design.md § Open Risks).
3. **Production advisory read-back.** After the promotion deploy, read `config.config_values_premigration_031` and
   the healed rows. Report any deviation from the step-2 pass shape to the operator as a follow-up (non-production
   twin value, operator-edited bare row). Behaviour is unchanged in every state, so this step's `done` does not wait
   on it. Record the result in context.md when it happens.

**Verification**:
`grep -n "G1 staging" docs/roadmap/features/243-fix-sandbox-seed-keys/context.md` shows the pasted result with a
PASS verdict, or a recorded operator decision. The NNN check prints `030_…` as the highest config migration on
`origin/main-dev`.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
