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
