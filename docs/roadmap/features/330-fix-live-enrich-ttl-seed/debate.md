# Debate Register: fix-live-enrich-ttl-seed

**State**: in-debate
**Mode**: full
**Rounds run**: 2 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-11 | /sdd-batch | 8 | 6 | 0 | 2 | 0 | yes |
| 2 | 2026-11-11 | /sdd-batch | 4 | 3 | 2 | 1 | 2 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | 048 updates only global rows (user_id IS NULL, staging and production) of analysis/opportunity.live_enrich_ttl_seconds (relative key). value_data goes '10'→'20' only where it is still the seeded '10'; operator values such as staging 600 are left untouched. | fix-config-keys-drift.feature:81 (@AC-24); 043_analysis_live_loop_keys.up.sql:31-35; report-staging-041.jsonl:9 | settled |
| D-2 | 1 | 048 does not write default_value in the up or the down. 041's CONFIG-2 default-sync already moved it to the code default of 20 on every row. | 041_heal_config_keys_to_reader_catalog.up.sql:482-503; report-staging-041.jsonl:7-9; dryrun-fresh.tsv:2-3 | settled |
| D-3 | 1 | The description rewrite is decoupled from the value guard: a separate CASE guarded on the verbatim 028 text, with WHERE = scope AND (value_data='10' OR description=<028 text>). The down inverts each CASE independently. | 028_analysis_opportunity_keys.up.sql:112,115; 032_analysis_zero_trap_descriptions.up.sql:5-9; 322 product-spec:129 | settled |
| D-4 | 1 | The migration ends with an explicit pg_notify('config_changed') per (namespace, environment) and relies on the 001 trigger for the audit. It sets updated_by='system:config-migration-feature-330', update_reason and caller_identity=NULL. | 001_config_tables.up.sql:37-51; configServiceImpl.ts:347,417-423; 047…up.sql:57-59; 041…up.sql:471,501 | settled |
| D-5 | 1 | The down reverts the value only where value_data='20' AND updated_by is the 330 sentinel, with no marker table. The sentinel is recorded as a C-10(c) ownership convention. | configServiceImpl.ts:829-835; 041…up.sql:471,499 | settled |
| D-6 | 1 | Per-user rows are deliberately out of scope. The staging per-user row has a real stored value (not null), so the spec adds a deploy-time check that lists per-user values for operator follow-up. | scripts/config-heal/inventory-staging.jsonl:16 (value_sha256 2abaca49…) | settled |
| D-7 | 1 | The static SQL-text test for AC-1 is the only test that goes RED on the defect. The analysis TTL=20 memo test is @AC-2 behaviour coverage only. | fails.md:1902-1908; tests/test_live_enrich_memo.py:44-64 | settled |
| D-8 | 1 | scripts/config-heal/catalog.tsv is not edited. The doc sync adds a Per-Feature Registered Keys log row in config-governance.md. | scripts/config-heal/signoff.md (sha-pinned 041 inputs) | settled |
| D-9 | 2 | In both up and down, the actor columns (updated_by, update_reason, caller_identity) are CASE-guarded on the value branch. Only rows whose value_data 330 changes get the sentinel and the NULL caller_identity. Description-only rows keep their real writer. | 017_config_secrets_and_scoping.up.sql:69 (audit only on value change); docs/patterns/config-governance.md:130-135; adversary r2 blocking objection | settled |
| D-10 | 2 | Up and down each end with a final SELECT that references the notify CTE (as in 047:61), so pg_notify is actually evaluated. The static test asserts this. | 047_config_alias_removal_rows.up.sql:57-61 | settled |
| D-11 | 2 | The static test reads the old 028 description from the 028 migration file via findOne, not from a copied literal. It asserts that the down's description literal equals the up's new text, and that the key is namespace-relative. | services/xstockstrat-config/src/__tests__/migrationSql.ts; 028_analysis_opportunity_keys.up.sql:112,115; fix-config-keys-drift.feature:18 | settled |
| D-12 | 2 | AC-1's literal '20' is checked against a fresh database through the static test. The dev-deploy check passes per environment when the global value is > 15 and the description no longer equals the 028 text. | report-staging-041.jsonl:9 (staging global row holds 600) | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Writing default_value in 048 (up '20' / down '10') | 041 already synced it to the code default; the down would set the documented default out of line with the code default (CONFIG-2) | locked |
| R-2 | 1 | Gating the description rewrite on the value_data='10' guard | It leaves the stale description on staging's 600 row, which 330 solely owns | locked |
| R-3 | 1 | An unguarded overwrite of all global rows to 20 | It clobbers operator values, against @AC-24, with no C-16 operator sign-off | locked |
| R-4 | 1 | The full 047 latch/snapshot/report/marker machinery | Too much for one guarded value change (C-18) | locked |
| R-5 | 1 | Editing scripts/config-heal/catalog.tsv:41 | It is 041's sha-pinned input evidence | locked |
| R-6 | 1 | Seeding the value through a runbook SetConfig call instead of a migration | Feature 296 requires migration seeding; a fresh DB would reseed '10' | locked |
| R-7 | 2 | Stamping actor columns on every WHERE-matched row, including description-only rows | Makes the sentinel-only down over-revert to '10' (violates @AC-9) and erases the real writer on rows where the trigger leaves no audit row | locked |
| R-8 | 2 | Splitting the up into two UPDATE statements to isolate the actor stamping | A second statement and notify source for the same result that column-level CASE guards give in one atomic statement | locked |
| R-9 | 2 | A config_audit EXISTS anchor in the down | Correlated subquery cost (C-18); once the actor columns are guarded it reverts the same rows as the sentinel alone | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | Add @FR-N tags to the scenarios in 330's acceptance.feature (C-15). | no | closed @ round 2 (Resolved as a story-artifact action with no design impact: the story owner adds FR-1 and FR-2, tags @AC-1 @FR-1 and @AC-2 @FR-2, and amends the @AC-1 Given to 'row still holds the seeded 10'.) |
| O-2 | 1 | Spec to choose the down ownership anchor: sentinel only (C-10(c)) or sentinel plus config_audit EXISTS. | no | closed @ round 2 (Sentinel only, made sound by guarding the actor columns on the value branch so the sentinel marks exactly the rows 330 changed. The config_audit EXISTS anchor is rejected as the runner-up.) |
| O-3 | 2 | Operator to rule on the REOPEN petition for the D-4/D-5 sentinel spelling: slug form per config-governance.md:142 versus the settled 'system:config-migration-feature-330'. | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
| P-1 | 2 | D-4 | docs/patterns/config-governance.md:142 defines the number-free sentinel 'system:config-migration-feature-<slug>' (first used by feature 305); requested sentinel 'system:config-migration-feature-fix-live-enrich-ttl-seed'. Proposer filed it and the adversary recommends granting it. | pending user |
| P-2 | 2 | D-5 | Same config-governance.md:142 convention row already exists, so D-5's task 'record the sentinel as a C-10(c) convention' would be dropped. Only the sentinel string changes. | pending user |
