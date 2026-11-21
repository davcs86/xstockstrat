# Design: fix-agent-bearer-secret-orphan

**Created**: 2026-11-20
**Rounds**: 3 (full; termination: approved)
**Approved by**: user @ 2026-11-20 (operator approval at the design gate; Floor clear)
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

The secret-first write stays (operator ruling 2026-11-10; recon.md:9). An operator-run SQL sweep
reclaims the `ingest` / `mcp_credential.*` per-user secret rows that no
`ingest.signal_sources.credentials_ref` references. There is **no migration, no proto change and no
new config key** (D-1, D-5): config has no delete RPC and no scheduler (recon.md:32,35), and a
config migration cannot read `ingest.signal_sources` on a fresh database because config migrates
before ingest (D-1; recon.md:117).

**Consumer surface (C-14).** The fix is internal-only plus an operator runbook. The agent tools
(`manage_signal_source`, `instantiate_template`; recon.md:19-23) and the config-ui / insights hooks
(`writeOwnBearerSecret`; recon.md:49-53) keep their behavior. They gain regression pins and text
edits only. AC-1..3 hold after an operator runs the sweep.

### 1. Sweep — new `scripts/config-heal/mcp-credential-orphan-sweep.sql`

Exactly one SQL statement: a data-modifying CTE in the 046 shape
(`services/xstockstrat-config/migrations/046_config_dead_rows_prune.up.sql:17-61`; recon.md:61)
made of `d` (DELETE … RETURNING), then `aud`, then `nt`, then a final `SELECT deleted, notified`
that **references `nt`** (without that reference the notify CTE never runs). No latch, no snapshot
(D-3; recon.md:119), no transaction statement.

- **Header:** `\if :{?grace_hours} \else \set grace_hours 24 \endif`
- **Predicate**, between `-- mcp_orphan:begin` and `-- mcp_orphan:end`, byte-identical in the sweep
  and the preview (D-6):
  - `v.is_secret AND v.user_id IS NOT NULL AND v.namespace = 'ingest' AND starts_with(v.key, 'mcp_credential.')`
    (D-11: `starts_with`, not LIKE; the ingest GetSecret grant is a literal prefix,
    `services/xstockstrat-config/src/grpc/authz.ts:146`; recon.md:34)
  - `AND v.updated_at < now() - make_interval(hours => GREATEST(:'grace_hours'::int, 1))`
    (the in-flight race; recon.md:115)
  - `AND NOT EXISTS (SELECT 1 FROM ingest.signal_sources s WHERE s.user_id = v.user_id AND substring(s.credentials_ref from position('.' in s.credentials_ref) + 1) = v.key)`
    (D-2: owner-exact, stripped key, environment ignored; `split_credentials_ref` semantics,
    recon.md:43-44,73)
- **Audit (D-4):** one explicit `config.config_audit` row per delete, actor
  `system:config-heal-mcp-credential-sweep`, `old_value = d.value_data` (the `[redacted]` sentinel).
  No DELETE trigger exists, so this is the only record.
- **No `rep` CTE.** The `config.config_keys_report_296` write is dropped (O-23, C-18): the table is
  a feature-296 migration artifact probed by `scripts/migration-rerun.py:102`, and the actor-tagged
  audit row is already the record of each delete.
- **Notify (D-7, CONFIG-4; recon.md:38,118):**
  `SELECT pg_notify('config_changed', json_build_object('namespace', namespace, 'key', min(key), 'environment', environment, 'user_id', user_id)::text) FROM d GROUP BY namespace, environment, user_id`

### 2. Preview — new `scripts/config-heal/mcp-credential-orphan-sweep-preview.sql`

Same header; one read-only statement:
`SELECT user_id, key, environment, now() - updated_at AS age, count(*) OVER () AS total FROM config.config_values v WHERE <same marker block>`.

### 3. Runbook

- **Home:** a new section in `docs/runbooks/config-rollout.md`, beside the existing config-heal
  operator procedures, cross-linked from `docs/runbooks/mcp-tools.md` (O-22).
- **Access path:** `docs/runbooks/operator-db-access.md` — DB-owner psql over direct `:25060`, not
  the app-console PgBouncer `:25061` `DATABASE_URL`.
- **Command form:** psql 10 or later (O-15); every command is
  `psql … -v ON_ERROR_STOP=1 [-v grace_hours=N] -f …`.
- **Order:** (1) privilege pre-check with `has_table_privilege` — SELECT on `ingest.signal_sources`,
  DELETE on `config.config_values`, INSERT on `config.config_audit` (recon.md:116); (2) confirm the
  target databases; (3) preview; (4) sweep; (5) re-preview and expect 0.
- **Target databases:** the spec writes down the list the operator confirms, chosen from DO dev,
  DO prod and homelab (`docs/runbooks/config-rollout.md:292-293`; recon.md:121).
- **Reclaim rule:** a key left unreferenced longer than `grace_hours` (default 24h, floor 1h) is
  reclaimed. This includes a key staged with `set_config` and attached later through an explicit
  `credentials_ref`.
- **Audit query:** filter on `changed_by = 'system:config-heal-mcp-credential-sweep'`.

### 4. Tests

**(a) Config SQL-text test — `services/xstockstrat-config/src/__tests__/mcpCredentialSweep.test.ts`.**
node:test, like `deadRowsMigration.test.ts:2` (D-12; recon.md:74), paths resolved as at `:9`. It
asserts:

- **Single statement (O-21).** After dropping lines that start with `\` and the marker comments,
  `splitStatements` (`src/__tests__/migrationSql.ts:19-53`) returns exactly 1 statement per file,
  starting with `WITH` (sweep) and `SELECT` (preview). The anchored 046 transaction regex
  (`deadRowsMigration.test.ts:27-30`) may stay as a secondary check.
- The sweep's final SELECT references `nt`.
- The two marker blocks are byte-identical.
- The predicate uses `updated_at` (not `created_at`), the `GREATEST(…, 1)` floor, `starts_with`
  (no `LIKE`) and the stripped-key `NOT EXISTS`.
- The sweep has `GROUP BY namespace, environment, user_id` with the four payload keys and no
  `DISTINCT ON`.
- Neither file contains `value_encrypted`, `premigration`, `config_markers` or
  `config_keys_report_296`.

**(b) Assertion — new `scripts/migration-assertions/config-mcp-credential-sweep.sql`.** Multi-block
template of `scripts/migration-assertions/ingest-016.sql:19-97`: one
`BEGIN; seed; \ir ../config-heal/mcp-credential-orphan-sweep.sql; DO $$ … RAISE … $$; ROLLBACK;`
block per case. It runs through the existing post loop with no harness edit (D-8, D-12;
`scripts/migration-rerun.py:562-572,1112-1120`). A `pg_notify` inside a rolled-back transaction is
never delivered.

Seeding rules:

- Rows are seeded by INSERT with an explicit `updated_at`, never backdated by UPDATE (D-10; the
  BEFORE UPDATE trigger stamps `NEW.updated_at = NOW()`,
  `services/xstockstrat-config/migrations/017_config_secrets_and_scoping.up.sql:66-76`).
- Orphans are seeded in the exact shape SetConfig writes (`configServiceImpl.ts:828-839`):
  `value_type 'string'`, `value_data '[redacted]'`, non-null `value_encrypted`, `is_secret`,
  `user_id` and `environment` (O-19).
- Every must-survive seed is 25h old and matches every other conjunct, so only the conjunct under
  test protects it (O-17).

Block 1 (default grace):

| Seed | Expected | What it pins |
|---|---|---|
| U's referenced key A | survives | the referenced case (AC-4) |
| U's orphan B | deleted | the basic orphan case (AC-1..4) |
| U's in-grace orphan C (fresh) | survives | the grace window |
| Old global secret `ingest/mcp_credential.g` (user_id NULL) | survives | `user_id IS NOT NULL` |
| Old per-user `is_secret=false` row `ingest/mcp_credential.x` | survives | `is_secret` |
| Old per-user secret `mcp_credential.y` under a non-ingest namespace | survives | `namespace` |
| Old unreferenced `mcpXcredential.z` | survives | `starts_with` |
| Sources with no-dot, NULL and empty `credentials_ref` | (no crash) | the stripped-key edge cases |
| Old pre-staged key | deleted | the documented reclaim rule |
| **Cross-owner (i):** V holds U's referenced key A and has no source | **deleted** | a key-only join would keep it |
| **Cross-owner (ii):** V's source references K; U holds an old orphan K | U's K **deleted** | owner-exact join |
| **Cross-owner (iii):** V's own referenced key | survives | the referenced case for a second owner |

The three cross-owner seeds, each older than the grace window, are **binding** (operator decision
2026-11-20, design gate; O-16 closed). Each assertion is scoped to the seed user_ids. The audit
count filters on `changed_by = 'system:config-heal-mcp-credential-sweep'` and must equal the deleted
count, because the AFTER INSERT trigger (`017:81-91`) writes a row for every seed INSERT (O-18). A
second `\ir` must change nothing.

Block 2: `\set grace_hours 0` before its `\ir` (O-12). Orphans seeded 30 minutes and 2 hours old:
the 30-minute row survives and the 2-hour row is deleted, which pins the 1h floor.

**(c) Agent tests — `services/xstockstrat-agent/tests/test_tools.py`**, extending the AsyncMock
seam at `:143-182` (recon.md:76).

- **AC-1:** the register raises an ALREADY_EXISTS `AioRpcError`. Over three attempts the tool raises
  the mapped ToolError, `set_config` is awaited three times with three distinct keys, and
  `manage_mock` receives `credentials_ref == f"ingest.{key}"` on each attempt — the ref form the
  D-2 join depends on.
- **AC-2:** the same for `instantiate_template`.

**(d) UI Playwright test — `services/xstockstrat-ui/e2e/insights/signal-sources.spec.ts`**
(recon.md:55). AC-3 goes inside the feature-224 block (`:200`) and reuses the
`route.fulfill({status: 409, … 'already_exists'})` seam at `:111-118`; C-12 allows the inline error
body as a scenario one-off. It asserts the error alert is shown and exactly one `/SetConfig` call
is made. The UI instantiate writer (`templates/page.tsx:40`) gets a **recorded intentional skip**
(O-25): the sweep is keyed on key shape and covers all four writers.

**Covers lines.** Each step's Covers line states that (c) and (d) are writer-side pins, green on the
pre-fix tree, and that the RED coverage for the AC-1..3 Then-clauses is SQL block 1 (O-19).

### 5. CI (`.github/workflows/ci.yml`)

Add `scripts/config-heal/mcp-credential-orphan-sweep*.sql` to the `migrations` filter at `:88-97`
and to the `xstockstrat-config` filter at `:60`. The `migration-rerun` job triggers at `:901-903`.
The SQL gate is that live job plus a local pglast pre-parse with meta-commands stripped (D-9).

### 6. Text edits (C-10)

Add "+ reclaimed by the orphan sweep (runbook)" at the sites below (recon.md:124-131). The
`tools.py` sites are named by symbol, not line number (O-24), because batch peers
`fix-mcp-deadline-budget` and `fix-agent-mcp-transport-fallthrough` also touch `tools.py`.

- the `_write_source_bearer` docstring (`tools.py:400-404`)
- the `manage_signal_source` `credentials_ref:` param doc (`:1439`), which also states the grace
  reclaim rule
- `useSignalSourceMutations.ts:35-36`
- `docs/patterns/config-governance.md:318,525`
- the agent `CLAUDE.md:175`
- `docs/patterns/inter-service-mtls.md:58`
- the ingest `CLAUDE.md` bearer note
- the insights.md feature-166 note

Also add a row for `system:config-heal-mcp-credential-sweep` to the author-sentinel table at
`docs/patterns/config-governance.md:137-142` (O-20). Agent finding
`services/xstockstrat-agent/docs/context-constitution-findings.md:44` moves to resolved
(recon.md:26). `acceptance.feature` is not edited (O-9).

### Operator decisions (binding, recorded 2026-11-20 — context.md)

- The round-3 synthesis fix is binding: the assertion's cross-owner seeds are the three owner-exact
  cases in block 1 above, each older than the grace window.
- "The migration number is the next free config migration above the main-dev tip at spec time
  (main-dev now holds 055)." This design ships **no migration** (D-1), so the rule has nothing to
  number today. It applies only if `/sdd-spec` finds a migration is needed after all, which would
  contradict D-1 and must be raised with the operator, not assumed.

## Rejected Alternatives

- `R-1` Latched config migration 048 (incl. a `to_regclass`/EXECUTE-guarded variant) — rejected
  because config migrates before ingest (`db-migrate.sh:152` vs `:173`), the guard hides the SQL
  from pglast, and it only catches orphans present when it runs.
- `R-2` Ingest migration deleting `config.*` rows — rejected because it is a cross-service write
  into another service's schema.
- `R-3` Ingest-side reaper loop / new config delete RPC — rejected because the operator ruled out
  new proto/RPC and config has no delete RPC.
- `R-4` Config-internal periodic sweep job — rejected under C-18 YAGNI: config has only listener
  timers, and this is a SEV-3 with secrets already redacted.
- `R-5` Snapshotting swept rows (with or without `value_encrypted`) — rejected because it either
  keeps the ciphertext or cannot restore anything.
- `R-6` `DISTINCT ON (namespace, environment, user_id) … min(key)` notify form — rejected because
  it is invalid SQL: an aggregate without GROUP BY aborts the single sweep statement.
- `R-7` Explicit `psql -f` invocation of the sweep assertion in the migration-rerun harness —
  rejected because the catch-all post loop already runs it, so the line would run it twice (runner
  cite corrected by D-12 to `scripts/migration-rerun.py:562-572,1112-1120`).
- `R-8` Preview implemented as the sweep wrapped in BEGIN/ROLLBACK — rejected because it takes row
  locks during preview and does not read as read-only to an operator.
- `R-9` UI Vitest for the AC-3 hook guard — rejected because UI Vitest is node-env and scoped to
  `src/lib/**`; the Playwright signal-sources spec is the seam.
- `R-10` `LIKE 'mcp_credential.%'` prefix test (including the escaped `mcp\_credential.%` variant) —
  rejected because `_` is a LIKE wildcard that also matches keys like `mcpXcredential.*`, and the
  escaped form depends on `standard_conforming_strings` and is easily un-escaped later.
- `R-11` Backdating assertion seed rows via UPDATE of `updated_at` — rejected because the BEFORE
  UPDATE trigger resets `updated_at` to NOW() (`017:66-76`), so the orphan case would pass
  vacuously.

Considered in round 3 without a register row (recorded here so they are not re-proposed): a
cross-owner seed that is fresh or same-key-only (protected by the grace window, not by owner
scoping); the transaction-token denylist regex as the only O-10 guard (misses `BEGIN TRANSACTION`,
`COMMIT WORK`, `COMMIT AND CHAIN`); a read-only orphan-count signal in the indicators config
inventory (`config_inventory.py:42` — a cross-schema read in a third service, C-18; follow-up option
only); a standalone sweep section in `mcp-tools.md` with a bare `psql "$DATABASE_URL"` (splits the
operator DB procedures and points at PgBouncer `:25061`).

## Open Risks

- [ ] Reclaim depends on an operator running the script against the right databases. Orphans pile
  up between runs, and AC-1..3 hold only after a manual run. The read-only orphan-count signal is
  the follow-up option — to be addressed at the runbook step (state the cadence) / a follow-up
  feature if it matters.
- [ ] A credential deliberately staged longer ago than `grace_hours` is reclaimed; a source later
  updated to reference it gets GetSecret `found=false` (config @AC-16). Documented, not prevented —
  to be addressed at the runbook step and the `credentials_ref:` param-doc text edit.
- [ ] The prod operator role's privileges on `ingest.signal_sources` and `config.*` are unverified
  (fails.md ~L2819) — to be addressed at the runbook step (privilege pre-check) and at the first
  operator run.
- [ ] The target database list is not yet confirmed by the operator (fails.md:3941-3947) — to be
  addressed at `/sdd-spec` (record the confirmed list before the runbook step).
- [ ] No CI step statically parses the sweep; only the live `migration-rerun` job catches SQL
  defects — to be addressed at the sweep/assertion steps (executor runs the local pglast pre-parse).
- [ ] The assertion runs in the shared rerun database; isolation depends on BEGIN…ROLLBACK blocks
  and on each script being exactly one statement with no transaction control — to be addressed at
  the config SQL-text test step (single-statement check) and the assertion step.
- [ ] An operator's host psql older than 10 fails on `\if` and `:{?var}` — to be addressed at the
  runbook step (minimum version stated).
- [ ] Batch peers `fix-mcp-deadline-budget` and `fix-agent-mcp-transport-fallthrough` also edit
  `services/xstockstrat-agent/app/tools.py` — to be addressed at the text-edit step (symbol-named
  sites) and at integration-PR rebase.
- [ ] Non-blocking objections O-17..O-25 stay `open` in debate.md; each is folded into the Chosen
  Approach above — to be addressed at `/sdd-spec` (every one must map to a step) and
  `/sdd-review impl-spec`.

## Constitution Rules Touched

- `C-01` — honored by: no proto change; the operator ruled out a delete RPC (R-3).
- `C-08` — honored by: no new config key, no hardcoded service config; `grace_hours` is a psql
  variable of an operator script no service reads (D-5).
- `C-10` — honored by: every duplicated doc/comment instance of the "orphan accepted" text is
  edited (§6), the new `changed_by` sentinel gets its author-table row, and the UI instantiate
  writer's missing pin is a recorded skip.
- `C-11` — honored by: this design gate; 3 full-mode rounds, operator-approved.
- `C-12` — honored by: the UI AC-3 test reuses the existing route-fulfill seam; the inline 409 body
  is a scenario one-off.
- `C-15` — honored by: AC-1..4 each have a named test; Covers lines name SQL block 1 as the RED
  coverage for the AC-1..3 Then-clauses.
- `C-16` — honored by: every touched `@AC-*` is a PRESERVE (below); no CHANGE.
- `C-18` — honored by: no periodic job (R-4), no report-table write, no orphan-count signal.
- `F-07` — honored: not applicable in substance — no migration ships and no service-read value is
  hardcoded.
- `P-03` — honored by: the target database list is recorded from the operator, not guessed.
- `P-06` — honored by: the RED test is SQL assertion block 1; writer pins are declared green on the
  pre-fix tree.
- `CONFIG-4` — honored by: the notify payload carries `{namespace, key, environment, user_id}`.
- `PLAT-N1` — honored by: runbook order ends with a re-preview expecting 0; the assertion re-runs
  the sweep and expects no change.

Floor breaches: none.

## Business Rules Touched (C-16)

No CHANGE and no EXTEND; `acceptance.feature` is not edited.

- PRESERVE `@AC-1` "a failed manage_signal_source register leaves no unreferenced bearer secret"
  (feature `acceptance.feature`) — covered by the operator's sweep ruling of 2026-11-10
  (context.md); met by: agent writer pin (c) + SQL block 1.
- PRESERVE `@AC-2` "a failed instantiate_template signal_source leaves no unreferenced bearer
  secret" (feature `acceptance.feature`) — covered by the operator's sweep ruling of 2026-11-10;
  met by: agent writer pin (c) + SQL block 1.
- PRESERVE `@AC-3` "a failed config-ui signal-source register leaves no unreferenced bearer secret"
  (feature `acceptance.feature`) — covered by the operator's sweep ruling of 2026-11-10; met by:
  Playwright pin (d) + SQL block 1.
- PRESERVE `@AC-4` "the orphan sweep never deletes a referenced bearer secret" (feature
  `acceptance.feature`) — not regressed by: the owner-exact stripped-key `NOT EXISTS` and the
  referenced-key seeds for U and V.
- PRESERVE `@AC-3` "Ingest resolves the bearer token via GetSecret and sends it as an Authorization
  header" (`services/xstockstrat-ingest/acceptance/mcp-client-signal-source.feature`) — not
  regressed by: referenced keys survive; the grace window covers the SetConfig→register gap.
- PRESERVE `@AC-35` "Two users with the same mcp_client slug use their own credentials"
  (`docs/sdd/business-rules/platform.feature`) — not regressed by: the owner-exact join, pinned by
  the three cross-owner seeds (operator decision 2026-11-20, context.md).
- PRESERVE `@AC-1`/`@AC-2`/`@AC-3`/`@AC-14` redaction
  (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`) — not regressed by:
  the audit `old_value` is the `[redacted]` sentinel; neither script reads `value_encrypted`.
- PRESERVE `@AC-11`/`@AC-13` per-user scoping (same file) — not regressed by:
  `user_id IS NOT NULL` and the per-`user_id` notify; global rows are never touched.
- PRESERVE `@AC-4`/`@AC-5` GetSecret authority (same file) — not regressed by: no RPC, grant or
  allow-list change.
- PRESERVE `@AC-16` GetSecret `found=false` (same file) — not regressed by: a swept credential
  reads as not-configured, which is the existing contract.
