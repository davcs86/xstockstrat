# Design: fix-sandbox-seed-keys

**Created**: 2026-10-20
**Rounds**: 2 (full; termination: auto-approved under operator standing authorization 2026-10-20)
**Approved by**: orchestrator under operator standing authorization @ 2026-10-20 (rounds >= 2, no Floor breach, no blocking objection, no uncovered CHANGE; context.md 2026-10-20)
**Grounded in**: recon.md

---

## Chosen Approach

One forward-only config migration fixes the defect:
`services/xstockstrat-config/migrations/031_heal_indicators_sandbox_keys_full_dotted.{up,down}.sql`.
It ships with DB assertions, an indicators getter-contract test and doc fixes. Indicators source does not change.

**Why no code change.** The watcher already reads the full-dotted keys (recon.md:40-43). The config snapshot
is keyed by the raw `key` column with no prefix (recon.md:22, CONFIG-9). The defect is therefore purely the
bare seed rows (recon.md:28-30). The indicators `WatchConfig` request carries no `user_id` (recon.md:46;
`watcher.py:61-67`, verified r2), so per-user rows are never read today.

**Governing rule.**
- A row that is effective today keeps its value.
- A global bare row is inert, so it takes the code default.
- A per-user bare row is also inert, so it is renamed only.

This rule implements the operator decision "values prod effectively runs today … no behaviour change"
(context.md 2026-10-20).

**Consumer surfaces (C-14).** Effective limits do not change, so `/insights` (`formulaReference.ts:168-175`),
`/config-ui` (raw rows plus description, feature 219) and the agent `test_formula` need no change
(recon.md:51-55). `/config-ui` shows the rows under their full-dotted keys, plus the new headroom description,
after 031.

### 1. Up migration (5 statements, in order)

Conventions:
- No BEGIN/COMMIT, because golang-migrate wraps each migration.
- No `-- requires-env:` header and no `-- contract-of:` header (recon.md:69-71, 140).
- Every comment is a constraint of 2 lines or fewer.
- Every statement is re-runnable, because a dirty-state replay can happen (recon.md:196).
- Every statement carries `namespace='indicators'`.
- Every write carries `is_secret=false` (config invariant #6, recon.md:59).

0. **Pre-state snapshot.**
   - SQL: `CREATE TABLE IF NOT EXISTS config.config_values_premigration_031 AS SELECT <explicit columns, excluding value_encrypted> FROM config.config_values WHERE namespace='indicators' AND key LIKE '%sandbox.%';`
   - Precedent: `017_config_secrets_and_scoping.up.sql:31-33`. Use `IF NOT EXISTS`, not 017's DROP+CREATE: a replay must never replace the real pre-state with the post-state.
   - The snapshot records the step-1 deletes, which no DELETE trigger audits (recon.md:34-36), and the step-2 overwrites.
1. **Twin wins.**
   - DELETE bare rows where `key IN ('sandbox.timeout_ms','sandbox.memory_bytes','sandbox.allowed_imports') AND is_secret=false`.
   - Only when there EXISTS a full-dotted twin on the full `config_values_scope_uniq` tuple: `namespace`, `'indicators.'||b.key`, `environment`, `COALESCE(user_id,'')` (recon.md:33, 60-61).
2. **Rename and set the value in one UPDATE** on the remaining bare non-secret rows:
   - `key = namespace||'.'||key` (029's rename, recon.md:59);
   - `value_data = CASE WHEN user_id IS NULL THEN <literal> ELSE value_data END`, and the same for `default_value` (CONFIG-2 metadata, recon.md:195). Literals: `'5000'` / `'134217728'` / `'numpy,pandas,math,statistics'`;
   - `updated_by = 'system:config-migration-031'`, `update_reason = 'feature 243: heal bare sandbox seed key'` (sentinel convention, recon.md:88);
   - `value_type` is never touched (CONFIG-10, recon.md:208).

   Effects by environment:
   - **Production:** the BEFORE UPDATE audit trigger writes attributed `config_audit` rows for the 3000→5000 and 67108864→134217728 changes (recon.md:35, 192; seeds recon.md:29).
   - **Staging:** the rows already hold 5000 / 134217728 (recon.md:28), so the trigger only bumps `updated_at` (recon.md:35).
3. **Insert any missing global row**: 3 keys × `production`/`staging`.
   - Conflict handling: `ON CONFLICT (namespace,key,environment,COALESCE(user_id,'')) DO NOTHING` (recon.md:64, 189).
   - Columns: the 030 column list, plus `updated_by`/`update_reason` set to the sentinel. Without them, the AFTER INSERT trigger records a NULL `changed_by` (recon.md:36).
   - `consuming_service='xstockstrat-indicators'` is passed explicitly.
   - Descriptions are copied verbatim from `001_config_tables.up.sql:62,64` (`'Formula execution timeout ms'`, `'Allowed imports'`). `memory_bytes` gets the headroom text from step 4.
4. **Rewrite the `memory_bytes` description** on every row `WHERE key='indicators.sandbox.memory_bytes' AND is_secret=false AND description IS DISTINCT FROM '<text>'`.
   - This includes twins: a description is metadata only (016 shape, recon.md:63).
   - The statement also sets `updated_by`/`update_reason` to the sentinel, so ListKeys (feature 219) does not show the operator as the last editor of a row the migration changed.
   - Text: "Formula memory headroom in bytes above the sandbox child's measured pre-lockdown VmData baseline; RLIMIT_DATA = baseline + this value (feature 228)." It contains neither "memory cap" nor "64MB" (AC-3).

**No `pg_notify`** (CONFIG-4, recon.md:24, 197). This is safe because every effective value after 031 equals
what subscribers already hold under twin-wins.

### 2. Down migration

The down file is `SELECT 1;` with one constraint comment: "forward-only: an inverse cannot tell healed rows
from pre-existing twins or step-1 deletes; keeps premigration_031". This follows the 029 precedent
(recon.md:66) and fork 4 / `fails.md:2363-2366` (recon.md:190). Unlike 017's down, it does not drop the
snapshot, which is the only record of the deletes.

### 3. Gating step G1 (required, numbered impl-spec step, before merge into main-dev)

A main-dev push deploys staging.

**Staging, before merge.**
- Query: one read-only query through `docs/runbooks/operator-db-access.md` (recon.md:169).
- Columns: `namespace, key, environment, user_id, is_secret, value_type, value_data, default_value, updated_by, updated_at`.
- Filter: `namespace='indicators' AND key LIKE '%sandbox.%'`, over every `user_id`.
- Record: paste the result into context.md.
- Pass condition: exactly the 6 bare global rows, holding the seed values (recon.md:28-29), with `is_secret=false`, no full-dotted row and no `user_id` row.
- Escalate to the operator before merge if any of these appears:
  - a twin;
  - a per-user row;
  - a secret row;
  - a bare row whose value differs from its seed (feature-173 `@AC-4` guard, recon.md:101-104).
- Fork 1b is the documented fallback and needs a recorded operator decision.

**Production, after the promotion deploy (advisory).**
- Read `config.config_values_premigration_031` and report any deviation from the pass condition to the operator as a follow-up.
- Behaviour is unchanged in every state, so nothing waits on this read. There is no freeze and no pre-promotion gate (`fails.md:642-644`).

### 4. Tests

**`scripts/migration-assertions/config-031.sql`**
- **How it runs:** in the existing loop with `ON_ERROR_STOP=1` and no `-1` (recon.md:72-73). The in-file BEGIN…ROLLBACK and `\ir` work, so `migration-rerun.sh` needs no edit. Recon's `config) goto 30` option is rejected (see Rejected Alternatives).
- **AC-1 and AC-3 read-back blocks**, keyed on the exact getter strings (recon.md:211). AC-1 also checks `value_type` int/int/string.
- **AC-4 + AC-5 block**, inside BEGIN…ROLLBACK:
  - **Baseline:** a `CREATE TEMP TABLE` copy of all rows before the replay.
  - **Fixture (i), production:**
    - Set the global `indicators.sandbox.timeout_ms` to `'4000'` and insert a bare `sandbox.timeout_ms` = `'3000'`.
    - Delete the full-dotted `memory_bytes` and `allowed_imports` rows, then re-insert their bare forms with the 002 seed values. This matches AC-4's "up to 030" Given.
  - **Fixture (ii), staging:**
    - Delete the global `indicators.sandbox.memory_bytes`, then insert a bare global `sandbox.memory_bytes` = `'67108864'`.
    - Insert a per-user twin `indicators.sandbox.memory_bytes` (`user_id='u-243'`) = `'100663296'`.
    - Insert a per-user bare `sandbox.timeout_ms` (`user_id='u-243b'`, no twin) = `'2500'`.
  - **Replay:** `\ir ../../services/xstockstrat-config/migrations/031_heal_indicators_sandbox_keys_full_dotted.up.sql` (`ci.yml:668` mounts the repo at `/repo`).
  - **Assert:**
    - exactly one global production `timeout_ms`, with value 4000 (AC-5);
    - no bare row in any environment (AC-4);
    - production `memory_bytes` and `allowed_imports` renamed, holding 134217728 and the seed imports;
    - the staging global `memory_bytes` exists with value 134217728 (renamed, not deleted);
    - the per-user twin still holds 100663296;
    - the per-user bare row is renamed and still holds 2500;
    - every other row equals the TEMP baseline.
- **Red first (P-06):**
  - The file goes red before 031 exists (recon.md:79).
  - During the TDD gate, run the AC-4 block once against a draft 031 with 029's shape (plain `SET key = namespace||'.'||key`, `029:24-28`). Record the `config_values_scope_uniq` violation in context.md as the red.

**`services/xstockstrat-indicators/tests/test_config_watcher.py`** (recon.md:48, 80-83)
- Generalize `_str_watcher` (`:51-56`) into `_watcher(key, field, val)` and update its 2 callers at `:60` and `:74` (C-18).
- Add a parametrized AC-2 getter-contract test over the three Examples rows. The fixture values differ from the defaults.

**`acceptance.feature`** (append-only, C-15). Append `@AC-5 @FR-4 @regression` "A pre-existing full-dotted
row keeps its value and the bare row is removed":
- Given a global `"indicators.sandbox.timeout_ms"` with value 4000 in `"production"` alongside the bare row
- When the corrective migration runs
- Then the production global row has value 4000
- And no `"sandbox.timeout_ms"` row exists

This append is written at `/sdd-spec`.

### 5. Docs

- `services/xstockstrat-indicators/CLAUDE.md:12`: "cap" → "headroom" (recon.md:50).
- `docs/runbooks/config-rollout.md:180`: bare key → full-dotted key (recon.md:171).
- `docs/runbooks/indicator-builder.md:167`: "memory cap" prose (recon.md:53).
- `docs/context-constitution-findings.md:23`: resolve narrowly (recon.md:49, 204).
- `docs/patterns/config-governance.md:93-103`: one row stating the convention "migrations writing data set `updated_by = system:config-migration-<NNN>`". No prior config migration sets `updated_by` (grep-verified r2).
- Run the context-constitution teardown.

**Out of scope:** no `SCALAR_BOUNDS_REGISTRY` change (recon.md:198-201), no proto change, no new keys, no
`pg_notify`. The analysis and ingest dead `sandbox_*` copies are also out of scope (recon.md:202-204).

### Design confirmations (recorded in context.md)

- (i) "Fix in code" means the committed migration plus tests, with no indicators source change.
- (ii) The operator figures "5000 / 134217728 in both environments" mean "the values prod effectively runs today". If a production twin exists, twin-wins applies that reading literally.
- (iii) `config-031.sql` is permanent coupling. A future migration that touches these rows or the `config_values` columns must update or retire it.
- (iv) A later migration may drop `config_values_premigration_031` once the operator has reviewed it. No cleanup is scheduled (YAGNI).

## Rejected Alternatives

- Fork 1b, overwriting a full-dotted twin to 5000/134217728 — rejected because it turns an operator's effective value into a behaviour change. It is only the G1-escalation fallback, and needs a recorded operator decision.
- Applying the literal in every scope, including per-user rows (the round-1 choice) — rejected because it destroys per-user operator data and gains no behaviour, since the request sends no `user_id` (`watcher.py:61-67`).
- 029's separate post-rename literal UPDATE (`029:38-43`, recon.md:62) — rejected because after the rename, healed rows cannot be told from twins, so the UPDATE would overwrite a twin.
- A manual production G1 gate before promotion, with a config freeze — rejected because it sits outside the lifecycle, depends on DB access and a freeze nobody can enforce, and repeats the `fails.md:642-644` missed-gate shape.
- A 017-style DROP TABLE IF EXISTS + CREATE snapshot — rejected because a dirty replay would overwrite the real pre-state with the post-state.
- Hand-written `config_audit` rows for each step-1 delete — rejected because they add a second audit writer outside the triggers that must track feature 241. The snapshot table gives the same trace.
- Rename only, with no production value change — rejected because it makes 3000 ms / 64 MiB effective, breaking feature-209 `@AC-3` and halving the headroom against feature-228 `@AC-1` (recon.md:96, 98).
- Staging AC-4 at the real 030 state via `goto 30` plus a fixtures-* row (recon.md:74-77) — rejected because the persistent 4000 twin fails AC-1 on the shared DB (recon.md:184-186), and the approach needs edits to the shared script.
- A scoped symmetric inverse down, 030 style (recon.md:67) — rejected because it cannot tell healed rows from twins or from step-1 deletes, so it over-reverts (`fails.md:2366`).
- Write-time `SCALAR_BOUNDS_REGISTRY` bounds — rejected because they are new validation behaviour that overlaps 244 and 240 (recon.md:198-201). YAGNI.
- A class-level seed guard (no non-secret bare key anywhere) — rejected because other namespaces still hold bare rows, so the guard fails today and creeps scope. It is left as a platform follow-up.
- Manual SetConfig / Track B — rejected because the operator decision (2026-10-20) requires a code-plus-config migration.

## Open Risks

- [ ] Real production state is unknown until the post-promotion snapshot read. A production twin with a non-default value keeps that value under twin-wins: behaviour is unchanged, but production would not literally hold 5000/134217728. — to be addressed at the impl-spec G1 step (production advisory read-back).
- [ ] An operator-edited global bare row in production is overwritten to the literal. It is inert, the change is attributed via the audit trigger and captured in `config_values_premigration_031`, but nothing escalates it beforehand. — to be addressed at the production advisory read-back.
- [ ] `config.config_values_premigration_031` is a permanent object with no scheduled cleanup, and the down keeps it. — to be addressed at the migration step (confirmation iv). A later migration may drop it.
- [ ] `acceptance.feature` on main-dev is stale: AC-1 says 3000, and AC-4/AC-5 are missing. — to be addressed at `/sdd-spec`, which appends @AC-5, then `/sdd-sync` before review or promotion.
- [ ] Feature 241 (audit-author spoof) may change how `updated_by` flows to `changed_by`, and it rewrites the config-governance.md section the sentinel row lands in (recon.md:194). — to be addressed at the impl-spec review; whichever feature lands second rebases.
- [ ] Feature 244 also edits `tests/test_config_watcher.py` (recon.md:205). — to be addressed at the AC-2 test step; second to land rebases the `_watcher` generalization.
- [ ] Migration 031 can collide with concurrent config migrations (recon.md:152-156). — to be addressed at the migration step: re-verify max NNN just before merge (`fails.md:2909-2912`).
- [ ] `config-031.sql` re-applies a historical up-file against the HEAD schema forever. A later `config_values` column change or a retune of these rows breaks it. — to be addressed at the assertion step: record the coupling cost (confirmation iii).
- [ ] Hotfix #1263 overlaps textually on `services/xstockstrat-indicators/CLAUDE.md` and `docs/context-constitution-findings.md` (recon.md:173-176). After 031 the clamp ceiling is the row value, which equals the code default. — to be addressed at the docs step: merge order reconciles the text.
- [ ] No `pg_notify` is sent. This is safe only while every post-031 effective value equals what subscribers hold, which is true under twin-wins and false under fallback 1b. — to be addressed at G1: if 1b is chosen, the impl-spec adds a notify or restart.
- [ ] Non-blocking r2 objections, adopted in this design but not yet confirmed by the proposer. Each must appear as written in impl-spec. — to be addressed at the `/sdd-spec` and `/sdd-review impl-spec` steps:
  - the snapshot plus advisory production read-back;
  - per-user rename-only;
  - step-4 attribution;
  - the 029-shaped red;
  - the Given-faithful fixture (i);
  - the TEMP baseline;
  - the convention wording for feature 241;
  - the `value_encrypted` exclusion.

## Constitution Rules Touched

- `F-01` — honored by: applied migrations 001/002 are untouched; the fix is a new 031 (recon.md:27).
- `F-07` — honored by: sandbox limits stay config-sourced (recon.md:40-43); the full-dotted rows become the only source, restoring feature-209 `@AC-6` (recon.md:95).
- `F-04` — honored by: unknowns stay in recon `## Not found` (recon.md:165-177), and G1 resolves them by query, not by guess.
- `C-10` — honored by: the overlap with 241 on `docs/patterns/config-governance.md` is flagged, and the second feature to land rebases.
- `C-11` — honored by: the twin-vs-literal fork is resolved by a recorded reading of the operator decision, the staging G1 with escalation, and the production snapshot. None of these is a silent guess.
- `C-14` — honored by: consumer surfaces were reconned read-only; none changes (recon.md:51-55).
- `C-15` — honored by: `acceptance.feature` on the feature branch stays the single source; @AC-5 is appended (append-only), and main-dev drift is flagged for `/sdd-sync`.
- `C-16` — honored by: there is no regression against any recon PRESERVE rule (see Business Rules Touched), and the new ACs promote under `@feature-243` at launch (recon.md:147).
- `C-18` — honored by: `_str_watcher` is generalized, and the 029/030/016/017 SQL shapes and the `indicators-007.sql` assertion style are reused (recon.md:57-88).
- `P-03` — honored by: the ledger was consulted. `fails.md:642-644` drives the snapshot; `fails.md:2363-2366`, `2797`, `2333-2336` and `2909-2912` are carried (recon.md:207-216).
- `P-06` — honored by: the reds are the 029-shaped draft unique violation and the missing `\ir`; AC-2 is labelled a getter-contract guard.
- `CONFIG-2` — honored by: `default_value` is aligned on healed global rows only, as metadata.
- `CONFIG-4` — honored by: no `pg_notify` is needed, because effective values are unchanged.
- `CONFIG-10` — honored by: `value_type` is never modified.
- Config invariant #6 (redaction) — honored by: every write carries `is_secret=false`, and the snapshot excludes `value_encrypted`.
- How-to-Act #5 — honored by: migration comments are capped at 2 lines, and rationale goes in context.md and the PR body.
- Teardown (root CLAUDE.md) — honored by: the touched docs require a context-constitution refresh before push.

## Business Rules Touched (C-16)

There is no CHANGE to any existing durable `@AC` (recon.md:92). The feature-243 scenarios are EXTEND, under
the binding operator decision of 2026-10-20 (context.md): "hold the values prod effectively runs today … no
behaviour change".

**EXTEND** (feature-243's own scenarios):
- EXTEND feature-243 `@AC-1` — case added: value_type and per-environment values 5000 / 134217728 / seed imports. Operator decision 2026-10-20.
- EXTEND feature-243 `@AC-2` — case added: a parametrized getter-contract test over three rows.
- EXTEND feature-243 `@AC-3` — case added: headroom text with no "memory cap" or "64MB". Operator decision 2026-10-20.
- EXTEND feature-243 `@AC-4` — case added: a Given-faithful fixture with a twin-delete alongside renames.
- EXTEND feature-243 `@AC-5` (new, appended) — case added: "A pre-existing full-dotted row keeps its value and the bare row is removed". Operator decision 2026-10-20 ("values prod effectively runs today").

**PRESERVE** (prior features' rules):
- PRESERVE `@AC-6 @feature-209` "Isolation limits are configured, not hardcoded magic numbers" (`services/xstockstrat-indicators/acceptance/indicators-sandbox-os-isolation.feature:46`) — not regressed by: the full-dotted rows become the only config source.
- PRESERVE `@AC-3 @feature-209` "An infinite-loop / memory-bomb formula is terminated deterministically" (`…/indicators-sandbox-os-isolation.feature:25`) — not regressed by: the effective `timeout_ms` stays 5000, and 3000 never becomes effective.
- PRESERVE `@AC-1`/`@AC-2`/`@AC-3 @feature-228` (`services/xstockstrat-indicators/acceptance/fix-indicators-sandbox-matrix.feature:15,22,28`) — not regressed by: headroom stays 134217728, and the description now states headroom semantics. Operator decision 2026-10-20.
- PRESERVE `@AC-4 @feature-173` "An empty allowed_imports denies all sandbox imports …" (`services/xstockstrat-indicators/acceptance/fix-python-config-zero-trap.feature:12`) — not regressed by: twin-wins never overwrites an effective row; a stored `""` in a bare row escalates at G1; overwrites are attributed and snapshotted, not silent.
- PRESERVE `@AC-11`/`@AC-13 @feature-147` (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature:72,80`) — not regressed by: scope-tuple matching, per-user rename-only, `is_secret=false` guards, and a snapshot that excludes `value_encrypted`.
- PRESERVE `@AC-4 @feature-209` (`…/indicators-sandbox-os-isolation.feature:32`) and `@AC-5 @feature-176` (`services/xstockstrat-indicators/acceptance/analysis-concurrency-offload.feature:9`) — not regressed by: the effective limits are unchanged and `max_concurrent` is untouched.
- PRESERVE the feature-182/184 seed conventions (`services/xstockstrat-config/acceptance/readiness-materializer-config-keys.feature:38,49`; `…/opportunity-config-operability.feature:14,22,30`) — not regressed by: full-dotted keys, one global row per environment, code-default values, getter-matching `value_type`, and no runtime change.
- PRESERVE `@AC-6 @feature-224` (`docs/sdd/business-rules/platform.feature:258`) — not regressed by: the system formula runs under unchanged effective limits.
