# Debate Register: fix-agent-bearer-secret-orphan

**State**: in-debate
**Mode**: full
**Rounds run**: 2 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-11 | /sdd-batch | 5 | 5 | 0 | 9 | 0 | yes |
| 2 | 2026-11-11 | /sdd-batch | 4 | 4 | 7 | 6 | 2 | yes |

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

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | Grace keyed on created_at with a 1h literal can delete a credential pre-staged via set_config before a later credentials_ref update (`tools.py:1420,1436,1474,1491`), breaking ingest @AC-3 / 'source never references a missing secret'. Fix: updated_at, a 24h default psql var with a 1h floor, documented in the runbook and at `tools.py:1436`, or explicitly scope out the explicit-ref path. | yes | closed @ round 2 (Grace keyed on updated_at (reset by the BEFORE UPDATE trigger, `001_config_tables.up.sql:19,44`), 24h default psql variable with a 1h floor. The explicit-ref reclaim rule is documented in the runbook and at `tools.py:1436`, with a seed case for an old pre-staged key.) |
| O-2 | 1 | CI path filters (`ci.yml:71-79` migrations, config node-test) omit `scripts/config-heal/mcp-credential-orphan-sweep*.sql`. | no | closed @ round 2 (`scripts/config-heal/mcp-credential-orphan-sweep*.sql` added to both the migrations and xstockstrat-config filters in `ci.yml:60,71-79`.) |
| O-3 | 1 | The migration assertion must be BEGIN…ROLLBACK, load the script via `\ir`, and backdate updated_at, so seed rows do not leak into ingest-013/014 or the AC-8 checks (`migration-rerun.sh:768-788`). | no | open |
| O-4 | 1 | Ship a read-only preview with an identical predicate; runbook order is privilege pre-check, confirm target databases, preview, sweep, re-preview. | no | closed @ round 2 (Read-only preview file with a byte-identical marker-delimited predicate and a vitest equality check. The runbook order is privilege pre-check, confirm targets, preview, sweep, re-preview.) |
| O-5 | 1 | Notify DISTINCT ON (namespace, environment, user_id) with all four CONFIG-4 fields instead of per row; the listener reloads per namespace/environment (`configServiceImpl.ts:417-424`). | no | open |
| O-6 | 1 | Make the grace window a psql variable with a GREATEST(...,1) floor. | no | closed @ round 2 (`grace_hours` psql variable with `GREATEST(:'grace_hours'::int, 1)` and a grace_hours=0 assertion case.) |
| O-7 | 1 | C-10 doc instances: `docs/patterns/config-governance.md:318,525`, `services/xstockstrat-agent/CLAUDE.md:175`, `docs/patterns/inter-service-mtls.md:58`, and the insights.md feature-166 note all need '+ reclaimed by the sweep'. | no | closed @ round 2 (All listed doc and comment instances gain '+ reclaimed by the orphan sweep (runbook)', plus `tools.py:402,1436`, `useSignalSourceMutations.ts:35-36` and the ingest CLAUDE.md note.) |
| O-8 | 1 | Add stripped-key edge-case assertions: a ref with no dot, a NULL ref, an empty ref. | no | closed @ round 2 (No-dot, NULL and empty credentials_ref seed cases in the assertion.) |
| O-9 | 1 | The AC-1..3 'after the sweep runs' wording omits the grace window; either the tests backdate updated_at or acceptance.feature gains 'older than the grace window' (an EXTEND that needs the operator's sign-off). | no | closed @ round 2 (Tests backdate updated_at, and acceptance.feature is not edited. Its header already records the operator's sweep ruling.) |
| O-10 | 2 | The sweep and preview scripts must contain no BEGIN, COMMIT or ROLLBACK token, because an inner COMMIT would leak the assertion's seed rows into the shared rerun DB ahead of ingest-013.sql. A vitest must assert this. | yes | open |
| O-11 | 2 | Assertion counts must be scoped to the assertion's own seed user_ids, not global counts. | no | open |
| O-12 | 2 | The grace_hours=0 case must `\set grace_hours 0` before a further `\ir`, because the header's `\if :{?grace_hours}` keeps the earlier value. | no | open |
| O-13 | 2 | Assumption 2 (pglast pass 2d) is false. The spec must name the live migration-rerun CI job as the gate, plus a local stripped-meta-command pglast pre-parse. | no | open |
| O-14 | 2 | The AC-3 UI guard must be a Playwright failure-path spec in `services/xstockstrat-ui/e2e/insights/signal-sources.spec.ts` using fixture-inventory mocks (C-12). | no | open |
| O-15 | 2 | The runbook must state psql 10 or later as the minimum for `\if` and `:{?var}` on operator hosts. | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
| P-1 | 2 | O-3 | `scripts/migration-rerun.sh:768-780` catch-all loop already runs non-config-[0-9]*, non-fixtures-* assertions after db-migrate.sh up (`:759-766`), so the proposed explicit invocation runs the file twice (adversary). | pending user |
| P-2 | 2 | O-5 | The proposed `DISTINCT ON ... min(key)` notify is invalid SQL; the listener ignores key and user_id (`configServiceImpl.ts:417-420`) (adversary). | pending user |
