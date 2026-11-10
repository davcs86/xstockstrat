# Context: fix-sandbox-seed-keys  (archived 2026-11-10)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-11-10 — /sdd-archiver

**What**: Config migration 031 renamed the inert bare `sandbox.*` indicators seeds to their full-dotted keys. It kept the values production already runs (the code defaults 5000 / 134217728), so effective limits did not change; the operator chose this over activating the 002 values (3000 / 64 MiB). Indicators source was unchanged. Step 5 closed out via #1446.

The migration merged in #1334 on 2026-10-28, before the operator's G1 staging gate ran. G1 therefore became a post-merge check, done by a new console module, `python -m app.maintenance.sandbox_keys_check`. Staging passed on 2026-11-04. The production read-back was still pending at launch (2026-11-05).

**Why (irrecoverable rationale)**:
- **The healed rows keep today's effective values.** The defect report and triage framed the fix as "make 3000 ms / 64 MiB apply". The operator overrode that: the healed rows hold the values production *effectively runs today*, so behaviour does not change. Applying 3000/64 MiB would break feature-209 @AC-3 and halve the feature-228 headroom. Design rejected "rename-only" for the same reason.
- **Code plus config migration, not Track B `SetConfig create_key`.** This was the operator's choice. Recon also found that `create_key` would itself create the full-dotted twins that make a later heal collide.
- **Twin-wins.** A pre-existing full-dotted row is the one indicators reads today, and the bare row is inert, so deleting the bare row preserves behaviour. This is the ONLY reason skipping `pg_notify` is safe. Fallback 1b would need a notify or a restart.
- **Per-user bare rows are renamed only, with no literal applied.** The indicators `WatchConfig` request sends no `user_id`, so per-user rows are never read. Overwriting them would destroy operator data for no gain.
- **Every write sets `caller_identity = NULL`** (decided at spec time). The BEFORE UPDATE trigger copies `NEW.caller_identity` into `config_audit`, so a stale value would mis-attribute the migration's audit rows.
- **Overwriting operator-edited global bare rows was a deliberate accepted risk.** S2 overwrites them to the literal, including a stored `""` `allowed_imports` (feature-173 @AC-4). This was accepted because such rows are inert (never read), and every write is attributed and snapshotted. G1 was the only escalation point.
  - `premigration_031` is permanent by design (design confirmation iv).
  - This answers the open question in config `context-constitution-findings.md` ("Was the overwrite deliberate … and the snapshot table intended to stay?"). Resolve that row citing this synthesis.
- **Every statement S2–S4 carries the sentinel.**
  - S3: without `updated_by`, the AFTER INSERT trigger records `changed_by` as NULL.
  - S4: the description-only rewrite also sets it, so ListKeys (feature 219) does not credit an operator with the migration's edit.
- **AC-2 cannot be red-first.** The operator values equal the code defaults, so it uses fixture values (3000 / 100663296 / "numpy,math"). The red proof is AC-1, AC-3 and AC-4.

**Rejected alternatives**:
- Fork 1b (overwrite a full-dotted twin to 5000/134217728): turns an operator's effective value into a behaviour change. It is kept only as a G1 escalation fallback, and would then also need a notify or restart.
- Applying the literal to per-user rows (the round-1 choice): destroys per-user data for no behaviour gain.
- Reusing 029's separate literal UPDATE after the rename: once renamed, healed rows are indistinguishable from twins, so the UPDATE would overwrite a live twin. Rename and value are therefore set in one UPDATE whose CASE reads the pre-rename key.
- A 017-style `DROP TABLE IF EXISTS` + `CREATE` snapshot: a dirty-state replay would replace the real pre-state with the post-state. Hence `CREATE TABLE IF NOT EXISTS`.
- Hand-written `config_audit` rows for the deletes: a second audit writer outside the triggers, which would also have to track feature 241's attribution change. The snapshot table gives the same trace.
- A symmetric 030-style inverse down: it cannot tell healed rows from twins or from deleted rows, so it over-reverts. The down is `SELECT 1;` and keeps `config_values_premigration_031`, the only record of the deletes.
- A `config) goto 30` case in `migration-rerun.sh` plus a persistent 4000-twin fixture: the persistent twin fails AC-1 on the shared migration-rerun DB. Replaced by a `\ir` replay inside `BEGIN…ROLLBACK` in `config-031.sql`.
- `SCALAR_BOUNDS_REGISTRY` bounds: new write-time validation that overlaps 244/240. YAGNI.
- A class-level "no bare non-secret key anywhere" guard: other namespaces still hold bare rows, so it fails today and grows scope. It is a platform follow-up.
- A manual production gate before promotion, plus a config freeze: the freeze cannot be enforced, it needs DB access, and it repeats the fails.md missed-gate shape. The production read is advisory.

**Scars & gotchas**:
- **The "integration PR merge held until G1" gate did not hold.** 031, its tests and the acceptance suites merged via #1334 before any G1 run, and 032–034 landed on 2026-10-29. G1 had to be redesigned for the post-031 shape, plus a skipped-031 detector (`schema_migrations >= 032` with no snapshot).
- **The first check version reported FAIL on a legitimate edit.** Staging `indicators.sandbox.timeout_ms = 15000` is an operator edit made after 031 (`updated_by` is a user UUID). It was fixed so that a non-sentinel author is a note, not a problem (`sandbox_keys_check.py` `evaluate()`). The operator confirmed 15000 is intentional, so staging does NOT hold the AC-1 literal 5000.
- **031 could have been skipped silently.** 244's `032_analysis_zero_trap_descriptions` sat on another branch while 031 was unmerged. Had 032 reached an environment first, golang-migrate would have skipped 031 without error. It resolved because 031 merged first.
- **Each environment's DB holds both env-scoped row sets.** The staging G1 run (dev indicators pod, db=staging) shows inert `production`-environment rows. It therefore says nothing about the production DB, and the production read-back must run in the production app.
- **RED was static only.** Sequential batch-execute has no step PR and no DB, so live RED (absent 031) and RED b (a 029-shaped draft hitting `config_values_scope_uniq`) were captured statically, with a `pglast` parse as the offline check.
- **A Verification grep contradicted required comment text.** The grep expected a `value_encrypted` count of 0, while the comment had to say it excludes `value_encrypted`. The comment was reworded to "omits the secret ciphertext column".
- **`config-031.sql` replays a historical up-file against the HEAD schema forever.** Any future migration touching these rows or the `config_values` columns must update or retire it.
- The context-constitution refresh skill was unavailable, so the teardown was reconciled by hand.

**Permanent deviations**:
- **G1 check.**
  - Design: G1 was a hand-run read-only psql query on staging before the main-dev merge, passing only on exactly 6 bare global rows.
  - Shipped: a console module `python -m app.maintenance.sandbox_keys_check` (indicators image) that checks the post-031 shape after merge.
  - Because: 031 had already merged via #1334.
- **Healed values.**
  - Design: healed rows hold 5000/134217728 in both environments.
  - Shipped: the staging timeout is 15000.
  - Because: an operator edit after 031, confirmed intentional on 2026-11-04.
- **RED b.**
  - Design: RED b is a pushed 029-shaped draft, captured from the step PR log.
  - Shipped: a static RED only.
  - Because: sequential mode has no step PR, and committing an unverified draft is forbidden.
- **Production read-back.**
  - Design: the production read-back of `premigration_031` follows the promotion deploy.
  - Actual: it was never recorded before launch.

**Cross-feature signal**:
- Under batch-execute and merge-train, an operator-only gate written as "hold the merge" was overtaken by the merge itself. This is the same class as the earlier missed-gate fails entry, but the cause here is automated merging.
- **Superseded key direction.** Feature 295/296 (config migration 044) and 304 later renamed these rows to the RELATIVE form, recording that 295 "changes the canonical-key direction 243 established" (`merge-order.md`).
  - Today the stored key is `sandbox.*`, and `sandbox_keys_check` was inverted by 304 to check the post-044 shape.
  - 031's full-dotted outcome is historical. Code reading `sandbox.*` is NOT a regression of 243.
- At archive time, the dead copy-pasted analysis/ingest `sandbox_*` getters noted during 243 no longer exist.

**Deferred follow-ons**:
- The production advisory read-back is still pending: run `python -m app.maintenance.sandbox_keys_check` in the production indicators app.
- `config.config_values_premigration_031` is permanent. A later migration may drop it after operator review; no cleanup is scheduled.
- Class-level seed guard (no bare non-secret key in any namespace): a platform follow-up.
- A soft 243→244 ordering row exists in `merge-order.md` (not a hard gate). It is moot because 031 landed first.

**Ledger entries written**: insights.md (2), fails.md (2) — see the 2026-11-10 entries.

**Runtime-invariant recommendations (→ /context-constitution)**: A CONFIG-4 corollary: a raw-SQL config heal sends no `pg_notify`, so subscribers keep their old snapshot. That is safe only when every post-migration effective value equals what subscribers already hold. Otherwise the migration owes a notify or a restart.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 2d91b5671335fcce267679b50caa494440205f51. Defect report `docs/reports/2026-10-19-indicators-sandbox-seed-keys-unprefixed-defect.md` (+ `.status`) was pruned in the same run.
