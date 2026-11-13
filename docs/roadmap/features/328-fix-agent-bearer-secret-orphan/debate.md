# Debate Register: fix-agent-bearer-secret-orphan

**State**: in-debate
**Mode**: full
**Rounds run**: 3 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-11 | /sdd-batch | 5 | 5 | 0 | 9 | 0 | yes |
| 2 | 2026-11-11 | /sdd-batch | 4 | 4 | 7 | 6 | 2 | yes |
| 3 | 2026-11-13 | /sdd-batch | 3 | 2 | 8 | 10 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | The orphan reclaim is a re-runnable, unlatched operator SQL script at `scripts/config-heal/mcp-credential-orphan-sweep.sql`, not a config or ingest migration. | `scripts/db-migrate.sh:152` (config) runs before `:173` (ingest); a config migration referencing `ingest.signal_sources` fails on a fresh database; the adversary concurred. | settled |
| D-2 | 1 | The sweep matches on the stripped key (`substring` after the first '.'), ignores environment, and joins owner-exact on `user_id`, with `user_id IS NOT NULL`. | `services/xstockstrat-ingest/app/config/watcher.py:21-26`; both user_id columns are TEXT (`config 017:26`, `ingest 013:24`); the adversary concurred. | settled |
| D-3 | 1 | No snapshot or premigration copy of the swept rows; deletion cannot be undone. | `046_config_dead_rows_prune.up.sql:27-33` copies no value_encrypted; keeping ciphertext in a second table is unwanted; the adversary concurred. | settled |
| D-4 | 1 | The explicit audit insert is the only audit row: no DELETE trigger exists on config_values. | `config_value_audit` is BEFORE UPDATE (`001_config_tables.up.sql:49`); `config_value_audit_insert` is AFTER INSERT (`010_config_audit_insert_trigger.up.sql:27-28`). | settled |
| D-5 | 1 | No new config key for the grace window. | Config keys are not readable from SQL; C-18 YAGNI; F-07 does not apply to an operator script no service reads (adversary). | settled |
| D-6 | 2 | The preview is a separate read-only SELECT file whose predicate is a marker-delimited block, byte-identical to the sweep's and enforced by a vitest. It is not the sweep run under BEGIN/ROLLBACK. | The adversary accepted either option (C-18). The SELECT preview takes no config_values row locks and reads as read-only; the proposer's choice, with no counter-argument on record. | settled |
| D-7 | 2 | The sweep notifies with `GROUP BY namespace, environment, user_id` and json_build_object over namespace, min(key), environment and user_id. DISTINCT ON is not used. | DISTINCT ON with an ungrouped aggregate is rejected by PostgreSQL. The listener reads only namespace and environment (`services/xstockstrat-config/src/grpc/configServiceImpl.ts:417-424`). | settled |
| D-8 | 2 | No migration-rerun.sh edit. The assertion `config-mcp-credential-sweep.sql` runs through the existing catch-all loop after ingest is migrated. | `scripts/migration-rerun.sh:759-780`: the loop skips only fixtures-* and config-[0-9]* below R, after db-migrate.sh up brings ingest to 14. | settled |
| D-9 | 2 | The SQL gate for the sweep is the live migration-rerun CI job, plus a local pglast pre-parse with meta-commands stripped. There is no CI static parse. | No pglast in scripts/ or .github/ (grep). fails.md:3878. | settled |
| D-10 | 3 | Assertion seed rows set `updated_at` by INSERT with an explicit value, never by an UPDATE backdate. | The BEFORE UPDATE trigger function sets `NEW.updated_at = NOW()` (`services/xstockstrat-config/migrations/017_config_secrets_and_scoping.up.sql:66-76`). Proposed by the proposer and verified by the adversary in round 3. | settled |
| D-11 | 3 | The sweep and preview prefix test is `starts_with(v.key, 'mcp_credential.')`, not LIKE. | `_` is a LIKE wildcard; the ingest GetSecret grant is a literal prefix (`services/xstockstrat-config/src/grpc/authz.ts:146`). Proposed in round 3, and the adversary raised no objection. | settled |
| D-12 | 3 | Citation correction only, with no change in substance. The D-8 and R-7 runner is `scripts/migration-rerun.py:562-572,1112-1120`, with ingest at 16. The D-6 and O-10 SQL-text tests are node:test (`services/xstockstrat-config/src/__tests__/deadRowsMigration.test.ts:2`), not vitest. The O-2 `migrations` filter is at `.github/workflows/ci.yml:88-97`. | `ls scripts/migration-rerun*` shows only the `.py` file. Both sides confirmed these corrections in round 3. | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Latched config migration 048 (incl. a to_regclass/EXECUTE-guarded variant) | Config migrates before ingest (`db-migrate.sh:152` vs `:173`); the guard hides the SQL from pglast; it only catches orphans present when it runs. | locked |
| R-2 | 1 | Ingest migration deleting config.* rows | Cross-service write into another service's schema. | locked |
| R-3 | 1 | Ingest-side reaper loop / new config delete RPC | The operator ruled out new proto/RPC; config has no delete RPC. | locked |
| R-4 | 1 | Config-internal periodic sweep job | C-18 YAGNI: config has only listener timers; SEV-3 with secrets already redacted. | locked |
| R-5 | 1 | Snapshotting swept rows (with or without value_encrypted) | It either keeps the ciphertext or cannot restore anything. | locked |
| R-6 | 2 | DISTINCT ON (namespace, environment, user_id) ... min(key) notify form | Invalid SQL: an aggregate without GROUP BY aborts the single sweep statement. | locked |
| R-7 | 2 | Explicit psql -f invocation of the sweep assertion in migration-rerun.sh | The catch-all loop at `migration-rerun.sh:768-780` already runs it, so the line would run it twice. | locked |
| R-8 | 2 | Preview implemented as the sweep wrapped in BEGIN/ROLLBACK | It takes row locks during preview and does not read as read-only to an operator; the marker-block SELECT preview was chosen. | locked |
| R-9 | 2 | UI Vitest for the AC-3 hook guard | UI Vitest is node-env and scoped to src/lib/**; the Playwright signal-sources spec is the seam. | locked |
| R-10 | 3 | LIKE 'mcp_credential.%' prefix test (including the escaped `mcp\_credential.%` variant) | `_` is a LIKE wildcard that also matches keys like `mcpXcredential.*`. The escaped form depends on standard_conforming_strings and is easily un-escaped later. | locked |
| R-11 | 3 | Backdating assertion seed rows via UPDATE of updated_at | The BEFORE UPDATE trigger resets updated_at to NOW() (`017:66-76`), so the orphan case would pass vacuously. | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | Grace keyed on created_at with a 1h literal can delete a credential pre-staged via set_config before a later credentials_ref update (`tools.py:1420,1436,1474,1491`), breaking ingest @AC-3 / 'source never references a missing secret'. Fix: updated_at, a 24h default psql var with a 1h floor, documented in the runbook and at `tools.py:1436`, or explicitly scope out the explicit-ref path. | yes | closed @ round 2 (Grace keyed on updated_at (reset by the BEFORE UPDATE trigger, `001_config_tables.up.sql:19,44`), 24h default psql variable with a 1h floor. The explicit-ref reclaim rule is documented in the runbook and at `tools.py:1436`, with a seed case for an old pre-staged key.) |
| O-2 | 1 | CI path filters (`ci.yml:71-79` migrations, config node-test) omit `scripts/config-heal/mcp-credential-orphan-sweep*.sql`. | no | closed @ round 2 (`scripts/config-heal/mcp-credential-orphan-sweep*.sql` added to both the migrations and xstockstrat-config filters in `ci.yml:60,71-79`.) |
| O-3 | 1 | The migration assertion must be BEGIN…ROLLBACK, load the script via `\ir`, and backdate updated_at, so seed rows do not leak into ingest-013/014 or the AC-8 checks (`migration-rerun.sh:768-788`). | no | closed @ round 3 (No harness edit (D-8; the runner is `scripts/migration-rerun.py:562-572,1112-1120`). Every assertion block is BEGIN; seed; \ir sweep; DO-assert; ROLLBACK, with seeds backdated by INSERT of updated_at.) |
| O-4 | 1 | Ship a read-only preview with an identical predicate; runbook order is privilege pre-check, confirm target databases, preview, sweep, re-preview. | no | closed @ round 2 (Read-only preview file with a byte-identical marker-delimited predicate and a vitest equality check. The runbook order is privilege pre-check, confirm targets, preview, sweep, re-preview.) |
| O-5 | 1 | Notify DISTINCT ON (namespace, environment, user_id) with all four CONFIG-4 fields instead of per row; the listener reloads per namespace/environment (`configServiceImpl.ts:417-424`). | no | closed @ round 3 (The notify uses GROUP BY namespace, environment, user_id with json_build_object over all four fields (D-7), and the SQL-text test asserts there is no DISTINCT ON.) |
| O-6 | 1 | Make the grace window a psql variable with a GREATEST(...,1) floor. | no | closed @ round 2 (`grace_hours` psql variable with `GREATEST(:'grace_hours'::int, 1)` and a grace_hours=0 assertion case.) |
| O-7 | 1 | C-10 doc instances: `docs/patterns/config-governance.md:318,525`, `services/xstockstrat-agent/CLAUDE.md:175`, `docs/patterns/inter-service-mtls.md:58`, and the insights.md feature-166 note all need '+ reclaimed by the sweep'. | no | closed @ round 2 (All listed doc and comment instances gain '+ reclaimed by the orphan sweep (runbook)', plus `tools.py:402,1436`, `useSignalSourceMutations.ts:35-36` and the ingest CLAUDE.md note.) |
| O-8 | 1 | Add stripped-key edge-case assertions: a ref with no dot, a NULL ref, an empty ref. | no | closed @ round 2 (No-dot, NULL and empty credentials_ref seed cases in the assertion.) |
| O-9 | 1 | The AC-1..3 'after the sweep runs' wording omits the grace window; either the tests backdate updated_at or acceptance.feature gains 'older than the grace window' (an EXTEND that needs the operator's sign-off). | no | closed @ round 2 (Tests backdate updated_at, and acceptance.feature is not edited. Its header already records the operator's sweep ruling.) |
| O-10 | 2 | The sweep and preview scripts must contain no BEGIN, COMMIT or ROLLBACK token, because an inner COMMIT would leak the assertion's seed rows into the shared rerun DB ahead of ingest-013.sql. A vitest must assert this. | yes | closed @ round 3 (Both scripts carry no transaction statement, checked by the anchored 046 regex (`deadRowsMigration.test.ts:27-30`) in a node:test. The positive single-statement strengthening is tracked as a new non-blocking objection.) |
| O-11 | 2 | Assertion counts must be scoped to the assertion's own seed user_ids, not global counts. | no | closed @ round 3 (All assertion counts are scoped to the assertion's own seed user_ids.) |
| O-12 | 2 | The grace_hours=0 case must `\set grace_hours 0` before a further `\ir`, because the header's `\if :{?grace_hours}` keeps the earlier value. | no | closed @ round 3 (Block 2 runs `\set grace_hours 0` before its `\ir` and pins the 1h floor with a 30-minute orphan (survives) and a 2-hour orphan (deleted).) |
| O-13 | 2 | Assumption 2 (pglast pass 2d) is false. The spec must name the live migration-rerun CI job as the gate, plus a local stripped-meta-command pglast pre-parse. | no | closed @ round 3 (The gate is the live migration-rerun CI job plus a local stripped-meta-command pglast pre-parse (D-9).) |
| O-14 | 2 | The AC-3 UI guard must be a Playwright failure-path spec in `services/xstockstrat-ui/e2e/insights/signal-sources.spec.ts` using fixture-inventory mocks (C-12). | no | closed @ round 3 (A Playwright AC-3 failure-path spec in `e2e/insights/signal-sources.spec.ts` (feature-224 block, `:200`) using the route.fulfill 409 seam at `:111-118`. The inline error body is allowed under C-12 as a scenario one-off.) |
| O-15 | 2 | The runbook must state psql 10 or later as the minimum for `\if` and `:{?var}` on operator hosts. | no | closed @ round 3 (The runbook states psql 10 or later and `-v ON_ERROR_STOP=1` on every command.) |
| O-16 | 3 | [C-16 @AC-35 / D-2] The cross-owner assertion seeds must test the owner-exact join, each older than the grace window: (i) V holds U's referenced key A and has no source, so it is DELETED; (ii) V's source references K and U holds an orphan K, so U's K is DELETED; (iii) V's own referenced key survives. | yes | open |
| O-17 | 3 | Every must-survive seed must be older than the grace window and match every other conjunct. Add an old is_secret=false `ingest/mcp_credential.x` row and an old non-ingest-namespace secret `mcp_credential.y`, and make the global-secret seed old. | no | open |
| O-18 | 3 | The audit count must filter on `changed_by = 'system:config-heal-mcp-credential-sweep'`, because the AFTER INSERT trigger (`017:81-91`) audits every seed insert. | no | open |
| O-19 | 3 | Covers lines must name SQL block 1 as the RED coverage for AC-1..3; the agent and UI tests are writer pins. Block-1 orphans must be seeded in SetConfig's row shape (`configServiceImpl.ts:828-839`), and the agent tests must assert `credentials_ref == f"ingest.{key}"`. | no | open |
| O-20 | 3 | Add `system:config-heal-mcp-credential-sweep` to the author-sentinel table at `docs/patterns/config-governance.md:137-142` (C-10(c)). | no | open |
| O-21 | 3 | Replace or augment the no-transaction denylist regex with a positive check: exactly one statement per file after stripping meta-command lines (`splitStatements`, `migrationSql.ts:19-53`). Also assert that the sweep's final SELECT references `nt`. | no | open |
| O-22 | 3 | The spec must record the operator-confirmed target database list (DO dev, DO prod, homelab). The runbook uses the `operator-db-access.md` direct `:25060` path and lives in `config-rollout.md`, cross-linked from `mcp-tools.md` (P-03, fails.md:3941-3947). | no | open |
| O-23 | 3 | Drop the `rep` write to `config.config_keys_report_296`, or record why it is needed. The table is a feature-296 migration artifact, and the D-4 audit row is already the record (C-18). | no | open |
| O-24 | 3 | Name the `tools.py` docstring edit sites by symbol (`_write_source_bearer`; the `manage_signal_source` `credentials_ref:` param doc, at `:1439` not `:1436`), because batch peers also edit `tools.py`. | no | open |
| O-25 | 3 | The UI instantiate writer (`templates/page.tsx:40`) needs a 409 failure-path pin, or a recorded intentional skip. | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
| P-1 | 2 | O-3 | `scripts/migration-rerun.sh:768-780` catch-all loop already runs non-config-[0-9]*, non-fixtures-* assertions after db-migrate.sh up (`:759-766`), so the proposed explicit invocation runs the file twice (adversary). | pending user |
| P-2 | 2 | O-5 | The proposed `DISTINCT ON ... min(key)` notify is invalid SQL; the listener ignores key and user_id (`configServiceImpl.ts:417-420`) (adversary). | pending user |
