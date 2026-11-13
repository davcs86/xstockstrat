# Context Log: fix-live-enrich-ttl-seed

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect report (Issues disabled; clustered triage):
  - docs/reports/2026-10-19-live-enrich-ttl-seed-below-poll-defect.md — Seeded live-enrich memo TTL (10s) is below the UI poll (15s), so the memo never hits (SEV-3)
- Cluster rationale: single-report feature — one stale seeded config value.
- Severity: SEV-3
- Routing: report says "Config-only fix possible: yes" (Track B), **converted to Track C by operator decision 2026-11-10** — since feature 296 a key's value is seeded by a config migration, not a manual `SetConfig`, so the fix is a new numbered config migration (028 is applied and never edited).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..AC-2), context.md; stamped the report sidecar `triaged`
- Affected services (from report): xstockstrat-config, xstockstrat-analysis, xstockstrat-ui
- Root cause hypothesis: analysis code default raised to 20 after 028 seeded 10; no follow-up migration. Migration 041 synced `default_value` but leaves `value_data` unchanged — confirm stored value per environment in recon.
- Open questions: overwrite policy for rows not at the seeded value (product-spec § Open Questions)
- Recommended design depth: full → `/sdd-design fix-live-enrich-ttl-seed` (rationale: SEV-3, but a DB (config data) migration and ≥2 affected services — rubric escalate signals)
- Development branch: feature/fix-live-enrich-ttl-seed

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags); overwrite policy deferred (AC-1 holds either way); first review FAILed crit 6 (fixed: full key contract); overlap FAIL with 322 resolved (330 owns the row)
- Overlap findings: WARN: config migration NNN with 321/322
- Recommended design depth: full (config migration; analysis + ui)
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)

## Session 2026-11-11 — sdd-batch design gate (round 2)

- /sdd-design full debate halted at its approval gate after round 2 (gate policy: halt). design.md NOT written; status.md unchanged (spec-ready). Register: debate.md (D-1..D-12, R-1..R-9, O-1..O-3, P-1..P-2).

### Open Threads

- **Approach**: one new config data migration `services/xstockstrat-config/migrations/0NN_analysis_live_enrich_ttl_reseed.{up,down}.sql` (NN = 048 today; re-run `ls` at spec and execute, 321/322 also want 048). Each file is a single CTE statement: guarded UPDATE on `config.config_values` (namespace `analysis`, relative key `opportunity.live_enrich_ttl_seconds`, `user_id IS NULL`, staging + production) WHERE value is the seeded `'10'` OR the description is the verbatim 028 text; value CASE `'10'→'20'`; separate description CASE on the 028 text (D-3); actor columns (`updated_by`/`update_reason`/`caller_identity`) CASE-guarded on the value branch only (D-9); no `default_value` write (D-2); `pg_notify('config_changed')` CTE per (namespace, environment) forced by a final SELECT that references it (D-10). Down reverts value only where `'20'` AND the sentinel (D-5), description only where it still equals the 330 text byte for byte. Tests: RED static node:test `liveEnrichTtlReseedMigration.test.ts` (reads the 028 text via `findOne`, D-11) + analysis @AC-2 memo test (TTL=20, re-poll at t+15s issues no `BatchGetLatestPrice`). Dev-deploy check passes on global value > 15 and description fixed (D-12; staging holds 600). Per-user rows out of scope, listed at deploy (D-6). Docs: config-governance.md:422,473 + Per-Feature Registered Keys row; analysis CLAUDE.md:610; catalog.tsv untouched (D-8).
- **Strongest open objection (O-3, non-blocking)**: operator ruling on REOPEN petitions P-1/P-2 — sentinel spelling slug form `system:config-migration-feature-fix-live-enrich-ttl-seed` (config-governance.md:142) vs settled D-4 `system:config-migration-feature-330`. If granted, only the literal changes and D-5's "record a C-10(c) sentinel row" task drops. Second non-blocking item: story owner adds FR-1/FR-2, tags `@AC-1 @FR-1` / `@AC-2 @FR-2`, amends the @AC-1 Given to "…and the row still holds the seeded '10'" before spec (O-1 closed as an artifact action).
- **Floor status**: no Floor breaches.
- **Uncovered @AC changes**: @AC-1 CHANGE (not covered by an operator decision); @AC-2, @AC-9, @AC-14, @AC-24, @AC-26, @AC-28 PRESERVE.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Add one new config data migration, services/xstockstrat-config/migrations/0NN_analysis_live_enrich_ttl_reseed.{up,down}.sql. NN is 048 today. Re-run `ls` at spec and again at execute, because features 321 and 322 also want 048. Each file is a single CTE statement: a guarded UPDATE on config.config_values, then a pg_notify tail, then a final SELECT that references the notify CTE. That last SELECT is required: without it PostgreSQL never evaluates the CTE and the notify does not fire (047_config_alias_removal_rows.up.sql:57-61).\n\nUP\n- Scope (from 043_analysis_live_loop_keys.up.sql:31-35): namespace 'analysis', the relative key 'opportunity.live_enrich_ttl_seconds', user_id IS NULL, environment IN ('staging','production').\n- WHERE: the scope AND (value_data = '10' OR description = <028 verbatim text, 028:112,115>). This is D-3.\n- Value CASE: '10' becomes '20'.\n- Description CASE: guarded on the 028 verbatim text. It is separate from the value guard and follows the 032 pattern (032:5-9).\n- Actor columns (new this round, closes the adversary's blocking item): updated_by, update_reason and caller_identity are each CASE-guarded on the value branch. Example: `updated_by = CASE WHEN v.value_data = '10' THEN <sentinel> ELSE v.updated_by END`, and the same shape for update_reason and caller_identity (NULL on the value branch, otherwise the existing value).\n  - A row that only gets the description rewrite keeps its real writer. That matters because the 017 trigger (017_config_secrets_and_scoping.up.sql:69) audits only when value_data changes, and config-governance.md:130-135 relies on caller_identity to tell automated writes apart.\n  - The sentinel therefore marks exactly the rows whose value 330 changed.\n- default_value is not written (D-2).\n- The 017/001 trigger writes the audit row for the value change.\n- Notify: `nt AS (SELECT pg_notify('config_changed', json_build_object('namespace', ..., 'environment', ...)::text) FROM (SELECT DISTINCT namespace, environment FROM u) t)`, ending with `SELECT (SELECT count(*) FROM u), (SELECT count(*) FROM nt)`.\n\nDOWN\n- Same scope.\n- The value goes back to '10' only WHERE value_data = '20' AND updated_by = <sentinel> (D-5, sentinel only, with no config_audit anchor).\n- The description goes back to the 028 text only where it still equals the 330 text, byte for byte.\n- The actor columns are guarded on the value branch in the same way.\n- Same notify tail and final SELECT that references nt.\n\nSENTINEL STRING\n- The settled D-4 value 'system:config-migration-feature-330' stands until the operator rules on the proposer's REOPEN petition (both sides on record).\n- The petition asks for the slug form 'system:config-migration-feature-fix-live-enrich-ttl-seed', per the existing convention at docs/patterns/config-governance.md:142.\n- If the operator grants it, only the literal changes, and the \"record a C-10(c) sentinel row\" doc task is dropped because that convention row already exists.\n\nOUT OF SCOPE\n- Per-user rows (D-6). The deploy-time listing of per-user values stays.\n\nTESTS\n1. Static node:test suite, services/xstockstrat-config/src/__tests__/liveEnrichTtlReseedMigration.test.ts. It follows the zeroTrapDescriptionMigration.test.ts structure, uses findOne and splitStatements from migrationSql.ts, and is RED until the migration exists (D-7). It asserts:\n   - the key is namespace-relative, with no 'analysis.' prefix;\n   - the user_id IS NULL and environment scope;\n   - the '10'→'20' value CASE;\n   - the description CASE, guarded on the old text, which the test reads from the 028 file via findOne('analysis_opportunity_keys','up') instead of a hand-copied literal;\n   - the down's description literal equals the up's new text byte for byte;\n   - the actor columns are stamped only on the value branch;\n   - no default_value assignment and no DELETE;\n   - the notify CTE is present and referenced by the final SELECT, in both up and down;\n   - the down's value revert is guarded on '20' AND the sentinel.\n   Spec should check whether globalIntSeedCases.ts can drive these cases (C-13).\n2. Analysis @AC-2 behaviour test next to tests/test_live_enrich_memo.py:44-64: with TTL=20, a re-poll at t+15s issues no BatchGetLatestPrice.\n\nVERIFICATION\n- The dev-deploy query passes per environment when the global stored value is > 15 and the description no longer equals the 028 text. Checking for exactly '20' would report a false failure on staging, which holds 600.\n- AC-1's \"is '20'\" Example is checked against a fresh database, through the static test.\n- The query also lists per-user rows.\n\nDOCS\n- config-governance.md:422,473 and a Per-Feature Registered Keys row (D-8).\n- services/xstockstrat-analysis/CLAUDE.md:610.\n- catalog.tsv is not edited.\n\nSTORY ARTIFACTS (owner action, not a design change)\n- Add FR-1 and FR-2 to product-spec, tag @AC-1 @FR-1 and @AC-2 @FR-2, and amend the @AC-1 Given to \"…and the row still holds the seeded '10'\".\n\nBUILD ORDER\n1. RED static test.\n2. Up and down migration.\n3. Analysis AC-2 test.\n4. Doc sync.\n5. Dev-deploy verification.",
    "open_objections": [
      {
        "text": "Pending operator ruling on the REOPEN petition for D-4/D-5 sentinel spelling. The petition asks for the slug form 'system:config-migration-feature-fix-live-enrich-ttl-seed' (config-governance.md:142). The current settled value 'system:config-migration-feature-330' matches neither documented sentinel form exactly. Until the operator rules, the approach keeps D-4's string.",
        "blocking": false
      },
      {
        "text": "Story owner must add FR-1 and FR-2 plus the @FR tags, and amend the @AC-1 Given clause ('row still holds the seeded 10') before spec. This is C-15 hygiene and has no design impact.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-9",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-14",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-24",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-26",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-28",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Stamping the actor columns (updated_by, update_reason, caller_identity) on every row the WHERE matches. Description-only rows would carry the 330 sentinel, so the sentinel-only down would over-revert a '20' row to '10', which violates @AC-9. It would also erase the real writer on staging's 600 row, and the 017 trigger leaves no audit row for a description-only change.",
      "Splitting the up into two UPDATE statements (value plus actor columns, then description only). That needs a second statement and a second notify source, with atomicity resting on golang-migrate's implicit transaction. Column-level CASE guards give the same isolation in one statement.",
      "Sentinel plus a config_audit EXISTS anchor in the down (the O-2 runner-up). It adds a correlated subquery for a two-row revert (C-18). Once the actor columns are guarded, it identifies the same rows as the sentinel alone.",
      "A notify CTE that no final SELECT references. PostgreSQL never evaluates it, so pg_notify silently does not fire and analysis keeps the stale 10 until its next reload.",
      "A dev-deploy check requiring the stored value to equal exactly '20'. It reports a false failure on staging, where the operator value 600 is preserved by design (D-1)."
    ],
    "open_risks": [
      "Live staging and production stored values may differ from the repo snapshots. A global row an operator set to a value other than 10 stays as the operator left it, even below 15. The post-deploy query is the mitigation.",
      "The staging per-user row (inventory-staging.jsonl:16) holds an unknown value that overrides the global row. If it is below 15, the memo stays useless for that user until an operator acts.",
      "A future writer that changes value_data without rewriting updated_by would leave a stale sentinel, and a rollback could wrongly reset that row to '10'. No such writer exists today (configServiceImpl.ts:829-835).",
      "Migration number collision with features 321 and 322 at 048. Re-run ls at spec and at execute. The D-4 numbered sentinel would need renaming if the operator denies the slug petition and the file is renumbered.",
      "The design assumes the single-CTE file is atomic and that pg_notify is delivered at commit under golang-migrate. Confirm at spec.",
      "No test runs the migration against a real database, so the static test plus dev verification carry the @AC-1 claim. Reading the old text from the 028 file reduces the risk of a mismatched literal, but does not remove it."
    ],
    "constitution_rules_touched": [
      "C-05",
      "C-07",
      "C-10",
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "F-01",
      "P-02",
      "P-03",
      "CONFIG-2"
    ],
    "rationale": "I checked the adversary's blocking objection against the code. The 017 trigger (017_config_secrets_and_scoping.up.sql:69) audits only when value_data changes. As proposed, the up would therefore put the 330 sentinel on rows whose value it never touched, and the sentinel-only down would push those rows back below the 15s poll. Guarding each actor column on the value branch fixes this inside one statement. It keeps D-3 (description decoupled from the value) and D-5 (sentinel-only down) and makes the two consistent, so O-2 closes as sentinel-only.\n\nI also confirmed that 047:61 forces evaluation of its notify CTE with a final SELECT, so D-4's notify needs that same line. The AC-1 versus staging gap is resolved by checking AC-1 against a fresh database and making the deploy check pass on \"value > 15 and description fixed\".\n\nThe sentinel-spelling petition rests on genuinely new evidence (config-governance.md:142, which round 1 never cited). Only the operator can reopen a settled D-n, so the synthesis keeps D-4's string, records the petition, and leaves it open as non-blocking. O-1 is concretely answered as a story-owner action and closes, with the pending artifact edit tracked as a non-blocking item.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "In both up and down, the actor columns (updated_by, update_reason, caller_identity) are CASE-guarded on the value branch. Only rows whose value_data 330 changes get the sentinel and the NULL caller_identity. Description-only rows keep their real writer.",
          "evidence": "017_config_secrets_and_scoping.up.sql:69 (audit only on value change); docs/patterns/config-governance.md:130-135; adversary r2 blocking objection"
        },
        {
          "text": "Up and down each end with a final SELECT that references the notify CTE (as in 047:61), so pg_notify is actually evaluated. The static test asserts this.",
          "evidence": "047_config_alias_removal_rows.up.sql:57-61"
        },
        {
          "text": "The static test reads the old 028 description from the 028 migration file via findOne, not from a copied literal. It asserts that the down's description literal equals the up's new text, and that the key is namespace-relative.",
          "evidence": "services/xstockstrat-config/src/__tests__/migrationSql.ts; 028_analysis_opportunity_keys.up.sql:112,115; fix-config-keys-drift.feature:18"
        },
        {
          "text": "AC-1's literal '20' is checked against a fresh database through the static test. The dev-deploy check passes per environment when the global value is > 15 and the description no longer equals the 028 text.",
          "evidence": "report-staging-041.jsonl:9 (staging global row holds 600)"
        }
      ],
      "new_rejected": [
        {
          "text": "Stamping actor columns on every WHERE-matched row, including description-only rows",
          "why": "Makes the sentinel-only down over-revert to '10' (violates @AC-9) and erases the real writer on rows where the trigger leaves no audit row"
        },
        {
          "text": "Splitting the up into two UPDATE statements to isolate the actor stamping",
          "why": "A second statement and notify source for the same result that column-level CASE guards give in one atomic statement"
        },
        {
          "text": "A config_audit EXISTS anchor in the down",
          "why": "Correlated subquery cost (C-18); once the actor columns are guarded it reverts the same rows as the sentinel alone"
        }
      ],
      "new_objections": [
        {
          "text": "Operator to rule on the REOPEN petition for the D-4/D-5 sentinel spelling: slug form per config-governance.md:142 versus the settled 'system:config-migration-feature-330'.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-2",
          "how": "Sentinel only, made sound by guarding the actor columns on the value branch so the sentinel marks exactly the rows 330 changed. The config_audit EXISTS anchor is rejected as the runner-up."
        },
        {
          "id": "O-1",
          "how": "Resolved as a story-artifact action with no design impact: the story owner adds FR-1 and FR-2, tags @AC-1 @FR-1 and @AC-2 @FR-2, and amends the @AC-1 Given to 'row still holds the seeded 10'."
        }
      ],
      "reopen_petitions": [
        {
          "target": "D-4",
          "evidence": "docs/patterns/config-governance.md:142 defines the number-free sentinel 'system:config-migration-feature-<slug>' (first used by feature 305); requested sentinel 'system:config-migration-feature-fix-live-enrich-ttl-seed'. Proposer filed it and the adversary recommends granting it.",
          "is_new": true
        },
        {
          "target": "D-5",
          "evidence": "Same config-governance.md:142 convention row already exists, so D-5's task 'record the sentinel as a C-10(c) convention' would be dropped. Only the sentinel string changes.",
          "is_new": true
        }
      ],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-13 — sdd-batch design gate (round 3)

- /sdd-design full debate halted at its approval gate after round 3 (gate policy: halt). design.md NOT written; status.md unchanged. Register: debate.md (D-1..D-15, R-1..R-12, O-1..O-4, P-1..P-4).

### Open Threads

- **Approach**: the round-2 design (D-1..D-12) stands, with three verified corrections and one CI touchpoint. (1) The migration is `services/xstockstrat-config/migrations/049_analysis_live_enrich_ttl_reseed.{up,down}.sql`, because feature 334 holds 048 on trunk (D-13). The spec's merge checklist re-checks the number with `git log --all` for 049*/050* plus a scan of origin/feature/* migration tails (321, 322). At merge the number must equal max(origin/main-dev)+1, because golang-migrate silently skips lower versions. File content stays number-free. (2) The `pg_notify('config_changed')` CTE uses the four-field CONFIG-4 payload `{namespace, key, environment, user_id: NULL}` from `SELECT DISTINCT namespace, key, environment FROM u`. A final SELECT forces its evaluation in both up and down (D-14, D-10). (3) The down's `'20' AND sentinel` value guard has trunk precedent in 048_webhook_fanout_callback_keys.down.sql:4-13 (D-5). (4) New CI touchpoint: the migration step's Files include `scripts/config-wiring-stored.json`, regenerated only with `DATABASE_URL=<scratch postgres> python3 scripts/config-wiring-stored.py` and regenerated again after any renumber. Without it, check-config-wiring `--final` fails STALE-STORED (D-15). Unchanged from round 2: single-CTE guarded UPDATE, value '10'→'20', description CASE decoupled from the value guard on the 028 text, actor columns guarded on the value branch only, no `default_value` write, per-user rows out of scope (listed at deploy), RED static test `liveEnrichTtlReseedMigration.test.ts`, analysis @AC-2 memo test at TTL=20, dev-deploy check "global > 15 and description fixed", and the doc sync (config-governance.md:422,473 + registered-keys row; analysis CLAUDE.md:610; catalog.tsv untouched). Build order: RED static test → 049 up/down + regenerated config-wiring-stored.json → analysis AC-2 test → doc sync → dev-deploy verification.
- **Strongest open objection (O-4, non-blocking)**: the operator rules on REOPEN petitions P-3/P-4 against D-12/D-7. They ask to add a real-DB assertion file `scripts/migration-assertions/live-enrich-ttl-reseed.sql`, number-free and modelled on config-043.sql and webhook-fanout-callback.sql. `migration-rerun.py:562-576` picks it up automatically. It is the only check that would run the D-3/D-9 CASE-and-trigger interaction and the R-7 over-revert guard against Postgres. The proposer's "bespoke harness" rebuttal is factually wrong. D-7/D-12 stay as settled until the operator rules. Still open as well: O-3 (P-1/P-2 sentinel spelling, slug form vs settled `system:config-migration-feature-330`; only the literal changes) and the story-owner action from closed O-1 (FR-1/FR-2, @FR tags, amend the @AC-1 Given) before spec.
- **Floor status**: no Floor breaches.
- **Uncovered @AC changes**: @AC-1 CHANGE (not covered by an operator decision); @AC-2, @AC-3, @AC-9, @AC-14, @AC-24, @AC-26, @AC-28, @AC-34 PRESERVE.

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "The round-2 design stands (D-1 to D-12) with three verified corrections and one CI touchpoint added. No new mechanism is introduced.\n\nMIGRATION FILE\n- Path: services/xstockstrat-config/migrations/049_analysis_live_enrich_ttl_reseed.{up,down}.sql.\n- 048 is taken on trunk by feature 334 (048_webhook_fanout_callback_keys.up.sql:9). `git log --all -- 'services/xstockstrat-config/migrations/049*'` is empty today.\n- Number re-check, written into the spec's merge checklist:\n  - Run `git log --all` for 049* and 050*.\n  - Scan the migration tails of the origin/feature/* branches, including in-flight 321 and 322.\n  - At merge, the number must be max(origin/main-dev) + 1. golang-migrate silently skips any version lower than the applied maximum (fails.md:3815-3817, 2909-2911; insights.md:4216).\n- File content is number-free. The sentinel carries the feature, not the migration number. A renumber is therefore a rename plus a regeneration of config-wiring-stored.json (see below).\n\nUP: one CTE statement\n1. `u AS (UPDATE config.config_values v SET ... WHERE ... RETURNING namespace, key, environment)`.\n   - Scope: namespace='analysis', key='opportunity.live_enrich_ttl_seconds' (relative), user_id IS NULL, environment IN ('staging','production'). Same as 043_analysis_live_loop_keys.up.sql:27-35.\n   - WHERE: the scope AND (value_data='10' OR description = <028 verbatim text, 028_analysis_opportunity_keys.up.sql:112,115>) (D-3).\n   - SET clause:\n     - value_data: CASE '10' → '20'.\n     - description: CASE guarded on the 028 verbatim text (032 pattern, 032:5-9).\n     - updated_by, update_reason, caller_identity: each CASE-guarded on the value branch (D-9).\n     - default_value: never written (D-2).\n2. `nt AS (SELECT pg_notify('config_changed', json_build_object('namespace',namespace,'key',key,'environment',environment,'user_id',NULL)::text) FROM (SELECT DISTINCT namespace,key,environment FROM u) t)`.\n   - This is the four-field CONFIG-4 payload (services/xstockstrat-config/docs/context-constitution.md:21).\n   - The handler defaults a missing environment, so environment is load-bearing (configServiceImpl.ts:417-424).\n3. Final `SELECT (SELECT count(*) FROM u), (SELECT count(*) FROM nt);` (D-10; 047_config_alias_removal_rows.up.sql:57-61).\n- The 017 trigger audits only value changes (017:69).\n\nDOWN: mirror of the up\n- Value reverts to '10' only WHERE value_data='20' AND updated_by=<sentinel> (D-5). This is the same \"sentinel AND seeded value\" shape as 048_webhook_fanout_callback_keys.down.sql:4-13.\n- Description reverts only where it equals the 330 text byte for byte.\n- Actor columns are value-branch guarded.\n- Same four-field notify tail and forced final SELECT.\n\nSENTINEL\n- 'system:config-migration-feature-330' (D-4) stays until the operator rules on P-1/P-2 (O-3).\n- Either spelling has trunk precedent: 305/306 used the number form (migration-rerun.py:70-71), 334 used the slug form (048…up.sql:9, config-governance.md:142). Only the literal changes.\n\nCI TOUCHPOINT (new this round)\n- scripts/config-wiring-stored.json goes in the migration step's Files and is regenerated with the generator only: `DATABASE_URL=<scratch postgres> python3 scripts/config-wiring-stored.py`. Never edit it by hand.\n- Why:\n  - check-config-wiring.mjs:226-231 hashes every config migration file.\n  - :715-716 fails STALE-STORED on a hash mismatch, under `--final` (ci.yml:1240).\n  - The config-wiring-stored job regenerates the file on a scratch DB and diff-compares it (ci.yml:1248-1249).\n  - The file's rows for this key (config-wiring-stored.json:939-960) also carry the 028 description, which 049 rewrites.\n- Regenerate again after any renumber.\n\nOUT OF SCOPE\n- Per-user rows (D-6). The deploy-time listing of per-user values stays.\n\nTESTS\n1. Static node:test suite services/xstockstrat-config/src/__tests__/liveEnrichTtlReseedMigration.test.ts (D-7, D-11). Uses findOne and splitStatements from migrationSql.ts. Reads the old description through findOne('analysis_opportunity_keys','up'). Asserts:\n   - the relative key;\n   - the user_id IS NULL and environment scope;\n   - the value CASE and the description CASE;\n   - the actor columns are value-branch only;\n   - no default_value assignment and no DELETE;\n   - the notify CTE is referenced by the final SELECT in up and down, and the payload includes environment;\n   - the down's description literal equals the up's new text;\n   - the down's value revert is guarded on '20' AND the sentinel.\n2. Analysis @AC-2 memo test at TTL=20, next to tests/test_live_enrich_memo.py:44-64.\n3. Pending the operator ruling on P-3/P-4, not adopted yet: a real-DB assertion file scripts/migration-assertions/live-enrich-ttl-reseed.sql.\n   - Number-free name, not config-NNN, so it runs after all migrations.\n   - The harness picks it up with no wiring: migration-rerun.py:562-576 globs every *.sql.\n   - Modelled on config-043.sql:102-378 and webhook-fanout-callback.sql.\n   - Checks: operator 600 kept, second apply makes no change and writes no audit row, the down reverts only sentinel rows, and another actor's '20' and the per-user row survive.\n\nVERIFICATION AND DOCS\n- As settled (D-8, D-12): the dev-deploy query passes when the global value is > 15 and the description no longer equals the 028 text, and it lists per-user rows.\n- Doc sync: config-governance.md:422,473, plus a Per-Feature Registered Keys row; services/xstockstrat-analysis/CLAUDE.md:610. catalog.tsv is not edited.\n\nBUILD ORDER\n1. RED static test.\n2. 049 up and down migration, plus the regenerated config-wiring-stored.json.\n3. Analysis AC-2 test.\n4. Doc sync.\n5. Dev-deploy verification.\n\nStory-artifact FR tagging (closed O-1) remains an owner action before spec.",
    "open_objections": [
      {
        "text": "O-3 (carried): the operator rules on P-1/P-2, the sentinel spelling. The options are the slug form per config-governance.md:142 (334 precedent) or the settled 'system:config-migration-feature-330' (305/306 precedent). Only the literal changes.",
        "blocking": false
      },
      {
        "text": "The operator rules on P-3/P-4 (REOPEN D-12/D-7): whether to add the real-DB assertion file scripts/migration-assertions/live-enrich-ttl-reseed.sql. It is the only check that executes the D-3/D-9 CASE and trigger interaction and the R-7 over-revert guard against Postgres. The harness picks it up automatically (migration-rerun.py:562-576). The proposer's ground for rejecting it, a 'bespoke fixture replay', is factually wrong. The approach keeps D-7/D-12 as settled until the operator rules.",
        "blocking": false
      },
      {
        "text": "Story owner action before spec (from closed O-1): add FR-1 and FR-2 and the @FR tags, and amend the @AC-1 Given to 'row still holds the seeded 10'.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-9",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-14",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-24",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-26",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-28",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-34",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Numbering the migration 048. Feature 334's 048_webhook_fanout_callback_keys already holds that number on trunk.",
      "Re-checking the migration number with `ls` on the working tree only. It misses numbers held on unmerged sibling feature branches, and it misses golang-migrate's silent skip of a version lower than the applied maximum (fails.md:3815-3817, 2909-2911).",
      "Keeping 047's two-field notify payload {namespace, environment}. It works, but it drifts from the four-field CONFIG-4 contract (context-constitution.md:21). The four-field payload costs nothing extra.",
      "Leaving scripts/config-wiring-stored.json untouched. Any new config migration file changes storedInputsSha256 and turns check-config-wiring --final red (STALE-STORED, check-config-wiring.mjs:715-716).",
      "Hand-editing scripts/config-wiring-stored.json. CI regenerates it on a scratch DB and requires an exact match (ci.yml:1248-1249), so only generator output is valid.",
      "(Carried from earlier rounds, locked) R-1 to R-9: writing default_value, value-gated description, unguarded overwrite, 047 latch machinery, editing catalog.tsv, runbook SetConfig seeding, stamping actor columns on all matched rows, a two-statement split, a config_audit EXISTS anchor."
    ],
    "open_risks": [
      "Migration number race. 321 and 322 may land 049 or 050 first. A missed max(origin/main-dev)+1 check at merge would collide, or golang-migrate would silently skip the file. Mitigation: the merge-checklist procedure, plus regenerating config-wiring-stored.json after any renumber.",
      "Without the P-3/P-4 assertion file, no test executes the migration against real Postgres. The D-9 CASE and 017 trigger interaction and the down's no-over-revert property then rest on static text and dev verification only. fails.md:3834-3843 records a config down-guard bug that surfaced only at merge.",
      "Live staging and production values may differ from the repo snapshots. A global row an operator set to a non-10 value below 15 stays as it is. The post-deploy query is the mitigation.",
      "The staging per-user row (inventory-staging.jsonl:16) may hold a value below 15 that overrides the global row. Operator follow-up is needed via the deploy-time listing.",
      "A future writer that changes value_data without rewriting updated_by would leave a stale sentinel, and the down could then mis-revert that row. No such writer exists today (configServiceImpl.ts:829-835).",
      "The key-string overlap scan on (namespace, key) must be re-run after each main-dev merge. Recon found only 322 touching this key, and 322 defers to 330.",
      "The design assumes golang-migrate runs each file in one transaction, so pg_notify is delivered at commit. Confirm at spec. The single statement keeps the change atomic either way."
    ],
    "constitution_rules_touched": [
      "C-05",
      "C-07",
      "C-10",
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "F-01",
      "F-08",
      "P-02",
      "P-03",
      "CONFIG-2",
      "CONFIG-4"
    ],
    "rationale": "I checked the round-3 claims against the repo.\n- 048_webhook_fanout_callback_keys exists on trunk, and `git log --all` shows no 049 file. 049 is correct for now, but the re-check must follow the ledger procedure, not working-tree `ls`.\n- The 048 down uses exactly the 'sentinel AND seeded value' guard, which confirms D-5 has precedent.\n- CONFIG-4 documents a four-field payload, and the handler defaults a missing environment. The proposer's payload correction is adopted.\n\nThe adversary's blocking CI finding is real.\n- check-config-wiring.mjs:226-231 hashes every config migration, and :715-716 fails on mismatch under --final (ci.yml:1240).\n- A separate job diff-compares a scratch-DB regeneration (ci.yml:1248-1249).\n- The synthesized approach therefore adds the generator-regenerated config-wiring-stored.json to the migration step. That answers the objection concretely, so it is recorded as a decision rather than left open.\n\nThe adversary is also right that migration-rerun.py:562-576 globs every assertion file with no enrolment. The proposer's reason for rejecting real-DB coverage is a false premise. Adding the file would make D-7's 'only RED test' claim false and would extend D-12's verification basis. Both are settled decisions, so per the register guardrails I do not adopt it unilaterally. It is filed as REOPEN petitions on D-12 and D-7 with evidence not previously on record, left as a non-blocking operator item, and described in the approach as pending.\n\nO-3 stays open. The proposer's sentinel context restates evidence already in P-1, so no new petition is filed for it. No settled D-n is contradicted, no locked R-n is reintroduced, and no closed O-n is re-raised.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "The migration is 049_analysis_live_enrich_ttl_reseed.{up,down}.sql, not 048. The spec's merge checklist re-checks the number with `git log --all` for 049*/050* plus a scan of origin/feature/* migration tails. At merge the number must equal max(origin/main-dev)+1, because golang-migrate skips lower versions. File content stays number-free.",
          "evidence": "services/xstockstrat-config/migrations/048_webhook_fanout_callback_keys.up.sql:9 (048 taken by feature 334); fails.md:3815-3817, 2909-2911; insights.md:4216"
        },
        {
          "text": "The pg_notify payload in up and down is the four-field CONFIG-4 shape {namespace, key, environment, user_id: NULL}, built from SELECT DISTINCT namespace, key, environment FROM u.",
          "evidence": "services/xstockstrat-config/docs/context-constitution.md:21 (CONFIG-4); services/xstockstrat-config/src/grpc/configServiceImpl.ts:417-424 (environment defaulted when missing), :841-842 (SetConfig sends four fields)"
        },
        {
          "text": "The migration step's Files include scripts/config-wiring-stored.json, regenerated only via `DATABASE_URL=<scratch postgres> python3 scripts/config-wiring-stored.py` and never hand-edited. It is regenerated again after any renumber.",
          "evidence": "scripts/check-config-wiring.mjs:226-231 (storedInputsSha256 over migrations), :715-716 (STALE-STORED fail); .github/workflows/ci.yml:1240 (--final), :1248-1249 (scratch-DB regeneration must match); scripts/config-wiring-stored.json:939-960 (028 description stored for this key)"
        }
      ],
      "new_rejected": [
        {
          "text": "Re-checking the migration number with working-tree `ls` only",
          "why": "Misses numbers held on unmerged sibling branches and golang-migrate's silent skip of a version below the applied maximum (fails.md:3815-3817, 2909-2911)"
        },
        {
          "text": "Keeping 047's two-field notify payload {namespace, environment}",
          "why": "Drifts from the documented four-field CONFIG-4 contract; the four-field payload costs nothing extra"
        },
        {
          "text": "Leaving scripts/config-wiring-stored.json unchanged, or hand-editing it",
          "why": "A new config migration changes the input hash and fails check-config-wiring --final; CI regenerates the file on a scratch DB and requires an exact match, so only generator output is valid"
        }
      ],
      "new_objections": [
        {
          "text": "Operator to rule on P-3/P-4 (REOPEN D-12/D-7): add the real-DB assertion file scripts/migration-assertions/live-enrich-ttl-reseed.sql, number-free and modelled on config-043.sql. It would prove operator-value retention, idempotent replay with no audit rows, and sentinel-only down ownership against real Postgres.",
          "blocking": false
        }
      ],
      "closed_objections": [],
      "reopen_petitions": [
        {
          "target": "D-12",
          "evidence": "scripts/migration-rerun.py:562-576 globs and runs every scripts/migration-assertions/*.sql with no enrolment (non-config-NNN names run after all migrations). Trunk precedents for small seed migrations are scripts/migration-assertions/config-043.sql:102-378 and webhook-fanout-callback.sql (feature 334). Requested: supplement D-12's static-test and dev-deploy verification with a real-DB assertion file. Filed by the adversary; the proposer's 'bespoke harness' rebuttal is factually wrong.",
          "is_new": true
        },
        {
          "target": "D-7",
          "evidence": "Same evidence (migration-rerun.py:562-576 auto-glob; config-043.sql and webhook-fanout-callback.sql precedents). Adding the assertion file would make it a second check that goes RED on the defect, contradicting D-7's 'only RED test' wording.",
          "is_new": true
        }
      ],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-13 — sdd-design

- Phase 0 Recon: recon.md (written 2026-11-11). Services: xstockstrat-config (the fix), xstockstrat-analysis (reader, no change), xstockstrat-ui (15s poller, no change). Key reuse patterns: the 043 global-row scoped UPDATE and the 032 verbatim-old-description guard.
- Phase 1 Grilling: 3 rounds (full).
  - Termination: approved by the operator at the sdd-batch design gate.
  - Chosen approach: one guarded single-CTE config migration, `049_analysis_live_enrich_ttl_reseed.{up,down}.sql`:
    - value `'10'`→`'20'` only on seeded global rows;
    - a decoupled description CASE;
    - actor columns stamped only on the value branch (sentinel `system:config-migration-feature-330`);
    - no `default_value` write;
    - a four-field CONFIG-4 `pg_notify`, forced by a final SELECT;
    - a sentinel-guarded down;
    - `scripts/config-wiring-stored.json` regenerated by the generator.
  - Rejected: R-1..R-12 (default_value write, value-gated description, unguarded overwrite, 047 machinery, catalog.tsv edit, runbook SetConfig, unguarded actor stamping, a two-statement split, a config_audit anchor, `ls`-only renumber check, the two-field notify, a stale or hand-edited config-wiring-stored.json).
- Operator decision (2026-11-13, sdd-batch design gate):
  - C-16 sign-off for this feature's `@AC-1` CHANGE. The literal `"20"` now holds where the global row still holds the seeded `'10'`; operator values are kept and must be > 15.
  - REOPEN petitions P-1..P-4 declined (approved at the gate instead). The sentinel stays `system:config-migration-feature-330` (D-4/D-5). No real-DB assertion file is added (D-7/D-12 stand).
- Constitution rules touched: C-05, C-07, C-10, C-11, C-13, C-15, C-16, C-18, F-01, F-08, P-02, P-03, CONFIG-2, CONFIG-4. Floor breaches: none.
- Status: spec-ready → design-approved.

### Open Threads

- **Before spec (story owner, from closed O-1):** add FR-1 and FR-2 and the `@AC-1 @FR-1` / `@AC-2 @FR-2` tags, and amend the `@AC-1` Given to "…and the row still holds the seeded '10'" (C-15).
- **Migration number race (target: migration step + merge):** re-check with `git log --all` for 049*/050* and a scan of the origin/feature/* migration tails (321, 322). At merge, require max(origin/main-dev)+1. Regenerate `config-wiring-stored.json` after any renumber.
- **No real-DB execution of the migration (target: static-test step + dev-deploy verification):** P-3/P-4 were declined, so the D-9 CASE/trigger interaction and the down's no-over-revert property rest on the static test and dev verification (cf. fails.md:3834-3843).
- **Live values vs snapshots (target: dev-deploy verification):** the post-deploy query must show each environment's global value > 15 with the description fixed. A non-`10` operator value below 15 is left as it is and needs an operator call.
- **Staging per-user override (target: dev-deploy verification):** the per-user row (`inventory-staging.jsonl:16`) may hold a value below 15. Follow up from the deploy-time listing.
- **Stale-sentinel assumption (target: spec):** a future writer that changes `value_data` without rewriting `updated_by` could make the down mis-revert. No such writer exists today (`configServiceImpl.ts:829-835`).
- **Key overlap re-scan (target: spec + each main-dev merge):** re-run the `(namespace, key)` overlap scan. Only 322 touches this key, and it defers to 330.
- **Transaction/notify timing (target: spec):** confirm golang-migrate runs each file in one transaction, so `pg_notify` is delivered at commit.
