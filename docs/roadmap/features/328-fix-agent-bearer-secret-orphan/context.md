> Distilled 2026-11-21 by /sdd-distill. Full pre-distill session prose is in git history (before this commit).

# Context Log: fix-agent-bearer-secret-orphan

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries. (/sdd-distill is the sanctioned exception for compaction.)

---

## Decisions

- **Scope (triage 2026-11-10).** Single-report SEV-3 feature, Track C (SDD path), branch `feature/fix-agent-bearer-secret-orphan`, depth full (4 services: xstockstrat-agent, -config, -ingest, -ui; possible proto change; secret-handling posture). Defect report `docs/reports/2026-10-19-agent-bearer-secret-orphan-on-failed-register-defect.md` (signal-source bearer secret orphaned when the source register fails; sidecar stamped `triaged`). Root cause: deliberate secret-first ordering (feature 224) with no compensating delete; `config.proto` has no delete RPC. Product spec approved 2026-11-10 (spec-ready; warnings: bug-template conventions, conditional config RPC must be additive + authz rule, sweep migration strategy deferred, OQ1 gated acceptance); overlap WARN (agent `tools.py` with 314; `config.proto` with 322). Tree ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits).
- **Operator rulings (verbatim, binding).**
  - 2026-11-10 (before /sdd-design): "Operator ruled **sweep**: keep the secret-first write; a sweep deletes `mcp_credential.*` rows unreferenced by any source. No compensating-delete RPC, so no proto change. Where/how the sweep runs (scheduled job vs runbook vs data migration — OQ2) is decided in `/sdd-design`." AC-1..3 now assert the post-sweep state; AC-4 added: the sweep never deletes a referenced secret.
  - 2026-11-20 (design gate): "the round-3 synthesis fix is binding — the assertion's cross-owner seeds are the three owner-exact cases, each older than the grace window: (i) V holds U's referenced key A with no source → DELETED; (ii) V's source references K and U holds an orphan K → U's K DELETED; (iii) V's own referenced key survives. The migration number is the next free config migration above the main-dev tip at spec time (main-dev now holds 055)." Note: the approved design ships no migration (D-1), so there is nothing to number; if `/sdd-spec` finds a migration is needed, that contradicts D-1 and goes back to the operator. This decision closed O-16; petitions P-1 and P-2 were moot and marked `user declined` (operator approved instead of reopening); O-17..O-25 stay `open` in debate.md and are folded into design.md's Chosen Approach.
- **Design (approved after 3 rounds; register in `debate.md`, full text in `design.md`): an operator-run, re-runnable SQL sweep plus a byte-identical-predicate read-only preview and a runbook section; no migration, no proto change, no new config key.**
  - **D-1** `scripts/config-heal/mcp-credential-orphan-sweep.sql`, unlatched, not a config/ingest migration (config migrates before ingest, `db-migrate.sh:152` vs `:173`, so a config migration referencing `ingest.signal_sources` fails on a fresh DB). Exactly one statement: a data-modifying CTE in the config 046 shape (`d` DELETE … RETURNING, `aud`, `nt`, final `SELECT deleted, notified` that references `nt`, otherwise the notify never runs); no BEGIN/COMMIT/ROLLBACK.
  - **D-2/D-11 predicate:** inside a `-- mcp_orphan:begin/end` marker block byte-identical in sweep and preview (D-6): `is_secret`, `user_id IS NOT NULL`, namespace `ingest`, `starts_with(key, 'mcp_credential.')` (not LIKE); NOT EXISTS join owner-exact on `user_id` and the stripped key (`substring` after first '.', environment ignored; both user_id columns TEXT). Grace on `updated_at` (BEFORE UPDATE trigger resets it) via psql variable `grace_hours`, `GREATEST(:'grace_hours'::int, 1)`: default 24h, floor 1h (D-5: no config key; F-07 n/a).
  - **D-3/D-4/D-7 audit & notify:** no snapshot (deletion cannot be undone; 046 copies no `value_encrypted`); the explicit audit insert is the only audit row (no DELETE trigger), actor `system:config-heal-mcp-credential-sweep`, `[redacted]` old_value; notify `GROUP BY namespace, environment, user_id` with `json_build_object` over all four CONFIG-4 fields (never DISTINCT ON); the `config_keys_report_296` write is dropped (C-18, O-23).
  - **D-6 preview:** a separate read-only SELECT over the same marker block with `count(*) OVER ()` total, equality enforced by a node:test (not the sweep wrapped in BEGIN/ROLLBACK).
  - **D-8/D-9/D-12 tests & CI:** assertion `scripts/migration-assertions/config-mcp-credential-sweep.sql` of multi-block BEGIN…`\ir`…DO-assert…ROLLBACK, run by the existing catch-all loop (`scripts/migration-rerun.py:562-572,1112-1120`, no harness edit; one psql process per assertion file, so block 2 must `\set grace_hours 0` before its `\ir`); seeds backdated by INSERT of `updated_at`, never UPDATE (D-10; `017_config_secrets_and_scoping.up.sql:66-76`), in SetConfig's row shape; counts scoped to seed user_ids; audit count filtered on actor; every must-survive seed 25h old matching every other conjunct; grace_hours=0 block with a 30-minute (survives) and a 2-hour (deleted) orphan. Config node:test `mcpCredentialSweep.test.ts` (one statement per file, sweep references `nt`, marker blocks identical, predicate pieces, none of `value_encrypted`/`premigration`/`config_markers`/`config_keys_report_296`). Agent AC-1/AC-2 tests on the `test_tools.py` AsyncMock seam (three distinct keys, `credentials_ref == f"ingest.{key}"`). UI AC-3 Playwright failure-path test in `e2e/insights/signal-sources.spec.ts` (route.fulfill seam). CI: sweep scripts added to the `migrations` filter (`ci.yml:88-97`) and `xstockstrat-config` filter (`:60`); SQL gate is the live migration-rerun job + local stripped-meta-command pglast pre-parse (no CI static parse).
  - **Runbook** in `docs/runbooks/config-rollout.md` cross-linked from `mcp-tools.md`; DB-owner psql over direct `:25060` (`operator-db-access.md`), psql 10 or later, `-v ON_ERROR_STOP=1`; steps: privilege pre-check, confirmed targets, preview, sweep, re-preview expecting 0; states the reclaim rule and the audit query by actor. C-10 text edits: "+ reclaimed by the orphan sweep (runbook)", `tools.py` sites named by symbol (`_write_source_bearer` docstring, `manage_signal_source` `credentials_ref:` param doc), new row in the author-sentinel table (`config-governance.md:137-142`).
- **Rejected (locked).** R-1 latched config migration 048 (incl. to_regclass/EXECUTE-guarded variant; hides SQL from pglast; only catches orphans present at run time). R-2 ingest migration deleting config rows (cross-schema write). R-3 reaper loop / new delete RPC (operator ruled out proto). R-4 config-internal periodic job (C-18 YAGNI). R-5 snapshotting swept rows. R-6 `DISTINCT ON … min(key)` notify (invalid SQL, aborts the statement). R-7 explicit `psql -f` of the assertion in the harness (runs twice). R-8 preview as sweep wrapped in BEGIN/ROLLBACK (row locks, not read-only). R-9 UI Vitest for the AC-3 hook (node-env, scoped to `src/lib/**`). R-10 `LIKE 'mcp_credential.%'` incl. escaped variant (`_` wildcard hits `mcpXcredential.*`; escaped form depends on `standard_conforming_strings`). R-11 UPDATE-backdated seeds (trigger resets `updated_at`, orphan case passes vacuously). Also not adopted: a shared `\ir` predicate fragment spliced mid-CTE (fragile query-buffer behaviour); grace on `GREATEST(created_at, updated_at)` (no gain); exempting the explicit-`credentials_ref` path (a staged key unreferenced past grace is indistinguishable from an orphan; reclaim rule documented instead); editing acceptance.feature to add "older than the grace window" (EXTEND needing sign-off; backdated tests satisfy existing wording); the widened BEGIN/COMMIT/ROLLBACK/END/ABORT denylist regex alone as the O-10 guard (misses `BEGIN TRANSACTION`, `COMMIT WORK`, `COMMIT AND CHAIN`; the positive single-statement check is stronger); a read-only orphan-count signal in indicators `config_inventory.py:42` (cross-schema read in a third service; follow-up option only); a standalone sweep section in `mcp-tools.md` with bare `psql "$DATABASE_URL"` (splits operator DB procedures; app-console URL points at PgBouncer `:25061`); seeding the cross-owner row fresh or same-key-only (protected by grace, so a key-only join regression would pass).
- **@AC status / constitution.** No CHANGE: every touched scenario is PRESERVE and `acceptance.feature` is not edited (O-9); AC-1..3 covered by the 2026-11-10 sweep ruling. Must stay green: feature AC-4, ingest @AC-3, platform @AC-35, config @AC-1/2/3/14 (redaction), @AC-11/13 (per-user scoping), @AC-4/5 (GetSecret authority), @AC-16 (GetSecret found=false). Constitution touched: C-01, C-08, C-10, C-11, C-12, C-15, C-16, C-18, F-07, P-03, P-06, CONFIG-4, PLAT-N1; no Floor breach.
- **Spec shape (implementation-spec.md, 9 steps, status implementation-ready).** 1 config SQL-text suite, 2 rerun assertion + CI filters, 3 sweep + preview SQL (1+2+3 land together, backend), 4 runbook section (operator gate), 5+6 agent text + pins/doc parity (one `Lands with` unit: write Step 6 tests, capture parity red, apply Step 5 edits, one commit), 7 UI hook comment, 8 Playwright AC-3 pin (asserts error text: insights page renders the register error as a plain `<p>`, `page.tsx:822`, and `signal-sources.spec.ts:112-126` fulfills 503/`unavailable`, not 409), 9 remaining docs. Steps 4, 5+6 and 9 are blocked by the Step 4 operator gate; Steps 1-3 and 7-8 are not. Evidence read on `origin/main-dev@fb52065c`; the feature branch (`70221104`) was 168 commits behind and docs-only; `/sdd-execute` BRANCH SYNC merges `main-dev` first. No migration ships (config tip `055_analysis_live_enrich_ttl_reseed`, ingest tip `018`). Sweep/preview/assertion SQL were executed on PostgreSQL 16.15 against a stand-in schema (exit 0, `deleted 4 / notified 2`, replay `0 / 0`, nine single-conjunct mutations each fail the assertion) but never on the real migration chain; survivor arrays must sort `COLLATE "C"`; `uv run --no-project --with pglast` works for the offline pre-parse (1/1/9 statements). C-10 site list: repo-wide `git grep -i -E "orphan|secret-first"`; four "secret-first only" sites left unchanged on purpose: `docs/runbooks/mcp-tools.md:902`, `src/app/insights/signal-sources/page.tsx:322`, `services/xstockstrat-agent/tests/test_template_tools.py:4`, `.gitleaks.toml:20`; this feature does not edit the root `docs/context-constitution-findings.md` (only the agent-local findings file, Step 5). `mcp-tools.md` `instantiate_template` rows unchanged; only `manage_signal_source` rows gain the sweep text.
- **Risks carried.** Reclaim happens only when an operator runs the sweep (orphans pile up; AC-1..3 hold after a manual run; escalation path a post-migrate hook; read-only orphan-count signal is a follow-up option). A credential staged longer ago than `grace_hours` is reclaimed and a source later pointed at it gets GetSecret `found=false` (config @AC-16): documented, not prevented. Prod operator role privileges and cluster topology unverified (fails.md ~L2819, ~L3940; runbook pre-check). No CI static parse (only live `migration-rerun`; fails.md:3878 pattern, expect CI round-trips). Assertion isolation depends on BEGIN…ROLLBACK and single-statement scripts (the assertion file sorts before `ingest-013.sql`; an inner COMMIT would leak seeds). Host psql older than 10 fails on `\if` and `:{?var}`. Batch peers `fix-mcp-deadline-budget` and `fix-agent-mcp-transport-fallthrough` also edit `services/xstockstrat-agent/app/tools.py`.

## Open Threads

- [ ] **Operator gate (Step 4): confirm the target database list (candidates DO dev, DO prod, homelab `xstockstrat-staging`; fails.md:3941-3947) and the sweep cadence** (proposed: on demand and before each `main-dev` → `main` promotion). Blocks Step 4 and with it Steps 5+6 and 9; the spec does not guess (P-03).
- [ ] **Confirm the two-seed-user reading** of the cross-owner decision at the `/sdd-execute` checkpoint: Step 2 uses `sweep328-v1` (case i, no source) and `sweep328-v2` (cases ii, iii, with sources) because the single-V wording contradicts itself.
- [ ] A red `migration-rerun` job on the integration PR reopens Steps 1-3 (SQL only run on a stand-in schema so far).
- [ ] UI instantiate writer (`src/app/insights/templates/page.tsx:40`) stays unpinned (intentional skip, O-25).
- [ ] Product spec has no `## Consumer Surface(s)` section (C-14, bug template); not edited.
- [ ] `docs/repo-surveyor/debt-radar-findings.md:553` asks whether the defect report covers the UI path (it does: AC-3, Steps 7-8); outside this feature's file set, operator decides whether to answer there.
- [ ] O-17..O-25 are open in debate.md and carried in design.md; each maps to a step (checked at impl review). Overlap rule: the second merger rebases and re-greps anchors (345, 357, 321, 330, 318, 324; batch peers 314, 331, 319, 322, 327; no merge-order row needed).
- Next: `/sdd-execute fix-agent-bearer-secret-orphan`.

## Files Modified

- Design/spec artifacts only so far (no service code): `recon.md`, `debate.md` (approved, 3 rounds), `design.md`, `implementation-spec.md` (9 steps; impl-review edits), `acceptance.feature` unchanged beyond the triage AC-1..4.
- Planned: `scripts/config-heal/mcp-credential-orphan-sweep.sql` (+ preview file), `scripts/migration-assertions/config-mcp-credential-sweep.sql`, `services/xstockstrat-config/src/__tests__/mcpCredentialSweep.test.ts`, `.github/workflows/ci.yml` (path filters), `docs/runbooks/config-rollout.md` + `docs/runbooks/mcp-tools.md`, `docs/patterns/config-governance.md`, `services/xstockstrat-agent/app/tools.py` + `tests/test_tools.py` + agent-local findings/CLAUDE.md text, `services/xstockstrat-ui/src/hooks/useSignalSourceMutations.ts` (comment) + `e2e/insights/signal-sources.spec.ts`.

## Superseded Sessions

- 2026-11-10 /sdd-triage and sdd-review product-spec: see Decisions → Scope (open questions then: compensating delete vs accept + sweep; sweep home).
- 2026-11-10 operator decisions before /sdd-design: sweep ruling reproduced verbatim in Decisions.
- 2026-11-11 sdd-batch design gate (round 2): halted at approval gate (D-1..D-9, R-1..R-8, O-1..O-15, petitions P-1/P-2). Synthesis (sweep CTE in 046 shape, owner-exact predicate, updated_at grace with 24h default / 1h floor, one audit row, GROUP BY notify, marker-block preview, runbook, assertion via catch-all loop, CI filters) adopted into D-1..D-9; blocking O-5/P-2 (DISTINCT ON invalid SQL), O-3/P-1 (double harness run), O-10 (no transaction-control token: an inner COMMIT would leak seed rows ahead of `ingest-013.sql`). Superseded by the round-3 fence.
- 2026-11-13 sdd-batch design gate (round 3): halted (D-1..D-12, R-1..R-11, O-1..O-25); closed O-3, O-5, O-10..O-15 (P-1/P-2 moot); new blocking O-16 (cross-owner seed either fails under the correct join or passes vacuously via the grace window; fix = the three old seeds ruled binding at the design gate), non-blocking O-17..O-25; approach, tests, CI and runbook details hoisted into Decisions. State fence (last in file, read by the batch parser) preserved byte-for-byte:

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "Round-3 best approach. It takes the r3 proposal and folds in the adversary's verified test-design fixes. There is no migration, no proto change and no new key (D-1, D-5). The sweep runs as an operator script.\n\n1. **Sweep: new `scripts/config-heal/mcp-credential-orphan-sweep.sql`.** It is exactly one SQL statement: a data-modifying CTE in the 046 shape (`services/xstockstrat-config/migrations/046_config_dead_rows_prune.up.sql:17-61`) made of `d` (DELETE … RETURNING), then `aud`, then `nt`, then a final `SELECT deleted, notified` that **references `nt`**. Without that reference the notify CTE never runs. It has no latch, no snapshot (D-3) and no transaction statement.\n   - **Header:** `\\if :{?grace_hours} \\else \\set grace_hours 24 \\endif`\n   - **Predicate.** It sits between `-- mcp_orphan:begin` and `-- mcp_orphan:end` and is byte-identical in the sweep and the preview (D-6):\n     - `v.is_secret AND v.user_id IS NOT NULL AND v.namespace = 'ingest' AND starts_with(v.key, 'mcp_credential.')`\n     - `AND v.updated_at < now() - make_interval(hours => GREATEST(:'grace_hours'::int, 1))`\n     - `AND NOT EXISTS (SELECT 1 FROM ingest.signal_sources s WHERE s.user_id = v.user_id AND substring(s.credentials_ref from position('.' in s.credentials_ref) + 1) = v.key)` (D-2)\n     - The prefix test is `starts_with`, not LIKE: `_` is a LIKE wildcard, and the ingest GetSecret grant is a literal prefix (`services/xstockstrat-config/src/grpc/authz.ts:146`).\n   - **Audit (D-4):** actor `system:config-heal-mcp-credential-sweep`, with `old_value = d.value_data` (the `[redacted]` sentinel).\n   - **No `rep` CTE.** The synthesis drops the `config.config_keys_report_296` write. D-4 already makes the actor-tagged audit row the one record of each delete. The report table belongs to feature 296; it is created by 044 and probed by `scripts/migration-rerun.py:102`, and a recurring operator tool should not depend on it. The next proposer must confirm this or record why the report is needed.\n   - **Notify (D-7):** `SELECT pg_notify('config_changed', json_build_object('namespace', namespace, 'key', min(key), 'environment', environment, 'user_id', user_id)::text) FROM d GROUP BY namespace, environment, user_id`\n\n2. **Preview: new `scripts/config-heal/mcp-credential-orphan-sweep-preview.sql`.** It has the same header and is one read-only statement: `SELECT user_id, key, environment, now() - updated_at AS age, count(*) OVER () AS total FROM config.config_values v WHERE <same marker block>`.\n\n3. **Runbook.**\n   - **Home:** a new section in `docs/runbooks/config-rollout.md`, beside the existing config-heal operator procedures, cross-linked from `docs/runbooks/mcp-tools.md`.\n   - **Access path:** the one in `docs/runbooks/operator-db-access.md`: DB-owner psql over direct `:25060`, not the app-console PgBouncer `:25061` `DATABASE_URL`.\n   - **Command form:** psql 10 or later (O-15); every command is `psql … -v ON_ERROR_STOP=1 [-v grace_hours=N] -f …`.\n   - **Order:**\n     1. Privilege pre-check (`has_table_privilege`): SELECT on `ingest.signal_sources`, DELETE on `config.config_values`, INSERT on `config.config_audit`.\n     2. Run against the confirmed target databases.\n     3. Preview.\n     4. Sweep.\n     5. Re-preview and expect 0.\n   - **Target databases:** the spec must write down the list the operator confirms, chosen from DO dev, DO prod and homelab (`docs/runbooks/config-rollout.md:292-293`; fails.md:3941-3947).\n   - **Reclaim rule:** a key left unreferenced longer than `grace_hours` (default 24h, floor 1h) is reclaimed. This includes a key staged with set_config and attached later through an explicit `credentials_ref`.\n   - **Audit query:** filter on `changed_by = 'system:config-heal-mcp-credential-sweep'`.\n\n4. **Tests.**\n\n   **(a) Config SQL-text test: `services/xstockstrat-config/src/__tests__/mcpCredentialSweep.test.ts`.** It uses **node:test**, like `deadRowsMigration.test.ts:2`, and resolves the paths the way `:9` does. It asserts:\n   - **Single statement (O-10, strengthened).** After dropping lines that start with `\\` and the marker comments, `splitStatements` (`src/__tests__/migrationSql.ts:19-53`) returns exactly 1 statement for each file. It starts with `WITH` for the sweep and `SELECT` for the preview. The anchored 046 transaction regex (`deadRowsMigration.test.ts:27-30`) may stay as a secondary check.\n   - The sweep's final SELECT references `nt`.\n   - The two marker blocks are byte-identical.\n   - The predicate uses `updated_at` (not `created_at`), the `GREATEST(…, 1)` floor, `starts_with` (no `LIKE`) and the stripped-key `NOT EXISTS`.\n   - The sweep has `GROUP BY namespace, environment, user_id` with the four payload keys, and no `DISTINCT ON`.\n   - Neither file contains `value_encrypted`, `premigration`, `config_markers` or `config_keys_report_296`.\n\n   **(b) Assertion: new `scripts/migration-assertions/config-mcp-credential-sweep.sql`.** It follows the multi-block template of `scripts/migration-assertions/ingest-016.sql:19-97`: one `BEGIN; seed; \\ir ../config-heal/mcp-credential-orphan-sweep.sql; DO $$ … RAISE … $$; ROLLBACK;` block per case. It runs through the existing post loop with no harness edit (D-8; `scripts/migration-rerun.py:562-572,1112-1120`, with ingest at 16). pg_notify inside a rolled-back transaction is never delivered.\n\n   *Seeding rules:*\n   - Rows are seeded by INSERT with an explicit `updated_at`, never backdated by UPDATE. The BEFORE UPDATE trigger function stamps `NEW.updated_at = NOW()` (`services/xstockstrat-config/migrations/017_config_secrets_and_scoping.up.sql:66-76`).\n   - Orphans are seeded in the exact shape SetConfig writes (`configServiceImpl.ts:828-839`): `value_type 'string'`, `value_data '[redacted]'`, non-null `value_encrypted`, `is_secret`, `user_id` and `environment`.\n   - **Every must-survive seed is 25h old and matches every other conjunct**, so only the conjunct under test protects it (fails.md:3939).\n\n   *Block 1 (default grace).* Seeds are listed with the outcome each must have:\n\n   | Seed | Expected | What it pins |\n   |---|---|---|\n   | U's referenced key A | survives | the referenced case |\n   | U's orphan B | deleted | the basic orphan case |\n   | U's in-grace orphan C (fresh) | survives | the grace window |\n   | Old global secret `ingest/mcp_credential.g` (user_id NULL) | survives | `user_id IS NOT NULL` |\n   | Old per-user `is_secret=false` row `ingest/mcp_credential.x` | survives | `is_secret` |\n   | Old per-user secret `mcp_credential.y` under a namespace other than ingest | survives | `namespace` |\n   | Old unreferenced `mcpXcredential.z` | survives | `starts_with` |\n   | Sources with no-dot, NULL and empty `credentials_ref` | (no crash) | the stripped-key edge cases |\n   | Old pre-staged key | deleted | the documented reclaim rule |\n   | **Cross-owner (i):** V holds U's referenced key A and has no source | **deleted** | a key-only join would keep it |\n   | **Cross-owner (ii):** V's source references K; U holds an old orphan K | U's K **deleted** | owner-exact join |\n   | **Cross-owner (iii):** V's own referenced key | survives | the referenced case for a second owner |\n\n   Each assertion is scoped to the seed user_ids. The audit count filters on `changed_by = 'system:config-heal-mcp-credential-sweep'` and must equal the deleted count. The AFTER INSERT trigger (`017:81-91`) writes a row for every seed INSERT, so an unfiltered count would be wrong. A second `\\ir` must change nothing.\n\n   *Block 2.* `\\set grace_hours 0` comes before its `\\ir` (O-12). Orphans seeded 30 minutes and 2 hours old: the 30-minute row survives and the 2-hour row is deleted, which pins the 1h floor.\n\n   **(c) Agent tests: `services/xstockstrat-agent/tests/test_tools.py`.** They extend the AsyncMock seam at `:143-182`.\n   - **AC-1:** the register raises an ALREADY_EXISTS `AioRpcError`. Over three attempts the tool raises the mapped ToolError, `set_config` is awaited three times with three distinct keys, and `manage_mock` receives `credentials_ref == f\"ingest.{key}\"` on each attempt. That pins the ref form the D-2 join depends on.\n   - **AC-2:** the same for `instantiate_template`.\n\n   **(d) UI Playwright test: `services/xstockstrat-ui/e2e/insights/signal-sources.spec.ts`.** AC-3 goes inside the feature-224 block (`:200`) and reuses the `route.fulfill({status: 409, … 'already_exists'})` seam at `:111-118`. C-12 allows an inline error body as a scenario one-off. It asserts the error alert is shown and exactly one `/SetConfig` call is made.\n   - The UI instantiate path (`templates/page.tsx:40`) gets either a parallel 409 case or a recorded skip. Recommendation: record the skip, because the sweep is keyed on key shape and covers all four writers.\n\n   **Covers lines.** Each step's Covers line states that (c) and (d) are writer-side pins, green on the pre-fix tree, and that the RED coverage for the AC-1..3 Then-clauses is SQL block 1.\n\n5. **CI (`.github/workflows/ci.yml`).** Add `scripts/config-heal/mcp-credential-orphan-sweep*.sql` to the `migrations` filter at `:88-97` and to the `xstockstrat-config` filter at `:60`. The `migration-rerun` job triggers at `:901-903`. The SQL gate is that live job plus a local pglast pre-parse (D-9).\n\n6. **Text edits (C-10).** Add \"+ reclaimed by the orphan sweep (runbook)\" at the sites below. Sites are named by symbol, not line number, because batch peers `fix-mcp-deadline-budget` and `fix-agent-mcp-transport-fallthrough` also touch `tools.py`.\n   - the `_write_source_bearer` docstring (`tools.py:400-404`)\n   - the `manage_signal_source` `credentials_ref:` docstring (`:1439`), which also states the grace reclaim rule\n   - `useSignalSourceMutations.ts:35-36`\n   - `docs/patterns/config-governance.md:318,525`\n   - the agent `CLAUDE.md:175`\n   - `docs/patterns/inter-service-mtls.md:58`\n   - the ingest `CLAUDE.md` bearer note\n   - the insights.md feature-166 note\n\n   Also add a row for `system:config-heal-mcp-credential-sweep` to the author-sentinel table at `docs/patterns/config-governance.md:137-142`. Agent finding `:44` moves to resolved. `acceptance.feature` is not edited (O-9).",
    "open_objections": [
      {
        "text": "[C-16 @AC-35 / D-2] The assertion's cross-owner seed must actually test the owner-exact join. Three seeds, each older than the grace window: (i) V holds U's referenced key A and has no source, and it must be DELETED (a key-only join would keep it); (ii) V's source references K and U holds an orphan K, and U's K must be DELETED; (iii) V's own referenced key survives. The round-3 'another user's row with key B' seed is either wrong or vacuous. The synthesis carries the fix, and the next proposer must adopt it explicitly.",
        "blocking": true
      },
      {
        "text": "[fails.md:3939] Every must-survive seed must be older than the grace window and match every other predicate conjunct. Add an old per-user is_secret=false `ingest/mcp_credential.x` row (pins is_secret) and an old per-user secret `mcp_credential.y` in a non-ingest namespace (pins namespace). Make the global-secret seed old, so that `user_id IS NOT NULL` is what protects it.",
        "blocking": false
      },
      {
        "text": "The audit count must filter on `changed_by = 'system:config-heal-mcp-credential-sweep'`. The AFTER INSERT trigger `config.audit_config_insert` (`017_config_secrets_and_scoping.up.sql:81-91`) writes an audit row for every seed INSERT.",
        "blocking": false
      },
      {
        "text": "[C-15/P-06] The agent (4c) and UI (4d) tests pin the writer side and are green on the pre-fix tree. Each step's Covers line must name SQL block 1 as the RED coverage for AC-1..3. Block-1 orphans must be seeded in SetConfig's row shape (`configServiceImpl.ts:828-839`). The agent tests must assert `credentials_ref == f\"ingest.{key}\"` on every attempt.",
        "blocking": false
      },
      {
        "text": "[C-10(c)] The new changed_by sentinel `system:config-heal-mcp-credential-sweep` needs a row in the author-sentinel table at `docs/patterns/config-governance.md:137-142`.",
        "blocking": false
      },
      {
        "text": "[O-10 strengthening] The no-transaction denylist regex misses `BEGIN TRANSACTION;`, `COMMIT WORK;` and `COMMIT AND CHAIN;`. Assert the positive property instead: after stripping meta-command lines, `splitStatements` returns exactly one statement (WITH for the sweep, SELECT for the preview). Also assert that the sweep's final SELECT references `nt`.",
        "blocking": false
      },
      {
        "text": "[P-03 / fails.md:3941-3947] The spec must record the operator-confirmed list of target databases (DO dev, DO prod, homelab, per `config-rollout.md:292-293`). The runbook must use the `operator-db-access.md` direct `:25060` path and live in `config-rollout.md`, cross-linked from `mcp-tools.md`.",
        "blocking": false
      },
      {
        "text": "[C-18] The `rep` write to `config.config_keys_report_296` couples a recurring operator tool to a feature-296 migration table and duplicates the D-4 audit row. The synthesis drops it; the proposer must confirm this or record why the report is needed.",
        "blocking": false
      },
      {
        "text": "[C-10] The `tools.py` edit sites must be named by symbol (`_write_source_bearer` docstring, the `manage_signal_source` `credentials_ref:` docstring) rather than by line, because batch peers also edit `tools.py`. The current cite `:1436` is stale; the param doc is at `:1439`.",
        "blocking": false
      },
      {
        "text": "[C-10 duplicated surface] The UI instantiate writer (`templates/page.tsx:40`) has no failure-path pin. Either add a 409 case or record that the skip is intentional.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "ingest @AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "platform @AC-35",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "config @AC-1/@AC-2/@AC-3/@AC-14 (redaction)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "config @AC-11/@AC-13 (per-user scoping)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "config @AC-4/@AC-5 (GetSecret authority)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "config @AC-16 (GetSecret found=false)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "`LIKE 'mcp_credential.%'` as the prefix test: `_` is a one-character LIKE wildcard, so it would also delete an unreferenced key such as `mcpXcredential.*`.",
      "`LIKE 'mcp\\_credential.%'` (escaped underscore): it depends on `standard_conforming_strings` and is easily un-escaped in a later edit; `starts_with` is exact.",
      "Backdating seed rows by UPDATE: the BEFORE UPDATE trigger function resets `updated_at = NOW()` (`017_config_secrets_and_scoping.up.sql:66-76`), so the orphan case would pass vacuously.",
      "Seeding the cross-owner row fresh or same-key-only: it is protected by the grace window, not by owner scoping, so a key-only join regression would pass.",
      "Using only the widened BEGIN/COMMIT/ROLLBACK/END/ABORT denylist regex as the O-10 guard: it misses `BEGIN TRANSACTION`, `COMMIT WORK` and `COMMIT AND CHAIN`. The positive single-statement check is strictly stronger.",
      "Read-only orphan-count signal in the indicators config inventory (`config_inventory.py:42`): it would make orphan build-up visible without a sweep job, but adds a cross-schema read to a third service. C-18 YAGNI for a SEV-3 with redacted secrets; recorded as a follow-up option only.",
      "A standalone sweep section in `docs/runbooks/mcp-tools.md` with a bare `psql \"$DATABASE_URL\"`: it splits the operator DB procedures across docs, and the app-console URL points at PgBouncer `:25061`."
    ],
    "open_risks": [
      "Reclaim depends on an operator running the script against the right databases. Orphans pile up between runs, and AC-1..3 hold only after a manual run. The read-only orphan-count signal is the follow-up option if this matters.",
      "A credential deliberately staged longer ago than grace_hours is reclaimed. A source later updated to reference it then gets GetSecret found=false (config @AC-16). This is documented, not prevented.",
      "The prod operator role's privileges on `ingest.signal_sources` and `config.*` are unverified (fails.md ~L2819). The runbook privilege pre-check mitigates this.",
      "The target database list is not yet confirmed by the operator (fails.md:3941-3947), and the spec must record it. Until then the run targets are unnamed.",
      "No CI step statically parses the sweep. Only the live migration-rerun job catches SQL defects, so expect CI round-trips unless the executor runs the local pglast pre-parse.",
      "The assertion runs in the shared rerun database. Isolation depends on BEGIN…ROLLBACK blocks and on each script being exactly one statement with no transaction control.",
      "An operator's host psql older than 10 fails on `\\if` and `:{?var}`. The runbook states the minimum version.",
      "Batch peers `fix-mcp-deadline-budget` and `fix-agent-mcp-transport-fallthrough` also edit `services/xstockstrat-agent/app/tools.py`. Docstring edits are named by symbol to avoid stale line anchors and merge conflicts."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-08",
      "C-10",
      "C-11",
      "C-12",
      "C-15",
      "C-16",
      "C-18",
      "F-07",
      "P-03",
      "P-06",
      "CONFIG-4",
      "PLAT-N1"
    ],
    "rationale": "The r3 proposal answers eight open objections concretely, so they close:\n- **O-3:** no harness edit (D-8 is kept, with the runner corrected to `scripts/migration-rerun.py:562-572,1112-1120`). Each block is BEGIN…ROLLBACK with `\\ir`, and seeds are backdated by INSERT because an UPDATE backdate is undone by the trigger.\n- **O-5:** the GROUP BY notify (D-7), asserted by the SQL-text test.\n- **O-10:** an anchored no-transaction check on both scripts. The adversary's stronger single-statement test is carried as a separate non-blocking refinement.\n- **O-11:** assertion counts are scoped to the seed user_ids.\n- **O-12:** `\\set grace_hours 0` comes before block 2's `\\ir`.\n- **O-13:** the gate is the live `migration-rerun` job plus a local pglast pre-parse.\n- **O-14:** a Playwright route-fulfill spec. The adversary verified that C-12 allows an inline error body as a scenario one-off.\n- **O-15:** the runbook states psql 10 or later.\n\nPetitions P-1 and P-2 targeted O-3 and O-5. Those objections are now closed under the evidence the petitions cited, so the petitions are moot and no operator reopen is needed.\n\nI checked the adversary's claims against the code:\n- The AFTER INSERT audit function at `017_config_secrets_and_scoping.up.sql:81-91` writes a row for every insert, so audit counts must filter by actor.\n- The BEFORE UPDATE function sets `NEW.updated_at = NOW()` (`:66-76`).\n- The author-sentinel table at `docs/patterns/config-governance.md:137-142` has no config-heal sentinel.\n- `scripts/migration-rerun.py:102` probes `config_keys_report_296`.\n- `_write_source_bearer` is at `tools.py:400` and the `credentials_ref:` param doc at `:1439`.\n\nThe one blocking objection is the cross-owner seed. As specified, it either fails under the correct D-2 join or passes vacuously because of the grace window. Either way it cannot catch a key-only-join regression, which is exactly the owner-scoping guarantee @AC-35 depends on. The synthesis carries the three-seed fix. It stays blocking until the proposer adopts it, because the proposal did not answer it.\n\nThe other refinements are non-blocking and carried into the approach:\n- old survivor seeds for each conjunct;\n- an actor-filtered audit count;\n- Covers lines stating which tests are RED;\n- the sentinel table row;\n- the single-statement test and the `nt` reference check;\n- the runbook home and a recorded list of target databases;\n- dropping `rep`;\n- symbol-named edit sites;\n- a pin or recorded skip for UI instantiate.\n\nThere are no Floor breaches: there is no migration, and `grace_hours` is a psql variable, so F-07 does not apply. The approach honors D-1..D-9 and reintroduces no R-1..R-9.\n\nThe register's citation errors are recorded as one new decision. They change no substance, so they are not a REOPEN:\n- D-8 and R-7 cite `migration-rerun.sh`;\n- D-6 and O-10 say \"vitest\" where config uses node:test;\n- the O-2 closure cites `ci.yml:71-79`.\n\nAC-1..3 stay `covered_by_operator_decision=true`: the `acceptance.feature` header records the operator's 2026-11-10 sweep ruling, which these scenarios were written for.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Assertion seed rows set `updated_at` by INSERT with an explicit value, never by an UPDATE backdate.",
          "evidence": "The BEFORE UPDATE trigger function sets `NEW.updated_at = NOW()` (`services/xstockstrat-config/migrations/017_config_secrets_and_scoping.up.sql:66-76`). Proposed by the proposer and verified by the adversary in round 3."
        },
        {
          "text": "The sweep and preview prefix test is `starts_with(v.key, 'mcp_credential.')`, not LIKE.",
          "evidence": "`_` is a LIKE wildcard; the ingest GetSecret grant is a literal prefix (`services/xstockstrat-config/src/grpc/authz.ts:146`). Proposed in round 3, and the adversary raised no objection."
        },
        {
          "text": "Citation correction only, with no change in substance. The D-8 and R-7 runner is `scripts/migration-rerun.py:562-572,1112-1120`, with ingest at 16. The D-6 and O-10 SQL-text tests are node:test (`services/xstockstrat-config/src/__tests__/deadRowsMigration.test.ts:2`), not vitest. The O-2 `migrations` filter is at `.github/workflows/ci.yml:88-97`.",
          "evidence": "`ls scripts/migration-rerun*` shows only the `.py` file. Both sides confirmed these corrections in round 3."
        }
      ],
      "new_rejected": [
        {
          "text": "LIKE 'mcp_credential.%' prefix test (including the escaped `mcp\\_credential.%` variant)",
          "why": "`_` is a LIKE wildcard that also matches keys like `mcpXcredential.*`. The escaped form depends on standard_conforming_strings and is easily un-escaped later."
        },
        {
          "text": "Backdating assertion seed rows via UPDATE of updated_at",
          "why": "The BEFORE UPDATE trigger resets updated_at to NOW() (`017:66-76`), so the orphan case would pass vacuously."
        }
      ],
      "new_objections": [
        {
          "text": "[C-16 @AC-35 / D-2] The cross-owner assertion seeds must test the owner-exact join, each older than the grace window: (i) V holds U's referenced key A and has no source, so it is DELETED; (ii) V's source references K and U holds an orphan K, so U's K is DELETED; (iii) V's own referenced key survives.",
          "blocking": true
        },
        {
          "text": "Every must-survive seed must be older than the grace window and match every other conjunct. Add an old is_secret=false `ingest/mcp_credential.x` row and an old non-ingest-namespace secret `mcp_credential.y`, and make the global-secret seed old.",
          "blocking": false
        },
        {
          "text": "The audit count must filter on `changed_by = 'system:config-heal-mcp-credential-sweep'`, because the AFTER INSERT trigger (`017:81-91`) audits every seed insert.",
          "blocking": false
        },
        {
          "text": "Covers lines must name SQL block 1 as the RED coverage for AC-1..3; the agent and UI tests are writer pins. Block-1 orphans must be seeded in SetConfig's row shape (`configServiceImpl.ts:828-839`), and the agent tests must assert `credentials_ref == f\"ingest.{key}\"`.",
          "blocking": false
        },
        {
          "text": "Add `system:config-heal-mcp-credential-sweep` to the author-sentinel table at `docs/patterns/config-governance.md:137-142` (C-10(c)).",
          "blocking": false
        },
        {
          "text": "Replace or augment the no-transaction denylist regex with a positive check: exactly one statement per file after stripping meta-command lines (`splitStatements`, `migrationSql.ts:19-53`). Also assert that the sweep's final SELECT references `nt`.",
          "blocking": false
        },
        {
          "text": "The spec must record the operator-confirmed target database list (DO dev, DO prod, homelab). The runbook uses the `operator-db-access.md` direct `:25060` path and lives in `config-rollout.md`, cross-linked from `mcp-tools.md` (P-03, fails.md:3941-3947).",
          "blocking": false
        },
        {
          "text": "Drop the `rep` write to `config.config_keys_report_296`, or record why it is needed. The table is a feature-296 migration artifact, and the D-4 audit row is already the record (C-18).",
          "blocking": false
        },
        {
          "text": "Name the `tools.py` docstring edit sites by symbol (`_write_source_bearer`; the `manage_signal_source` `credentials_ref:` param doc, at `:1439` not `:1436`), because batch peers also edit `tools.py`.",
          "blocking": false
        },
        {
          "text": "The UI instantiate writer (`templates/page.tsx:40`) needs a 409 failure-path pin, or a recorded intentional skip.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-3",
          "how": "No harness edit (D-8; the runner is `scripts/migration-rerun.py:562-572,1112-1120`). Every assertion block is BEGIN; seed; \\ir sweep; DO-assert; ROLLBACK, with seeds backdated by INSERT of updated_at."
        },
        {
          "id": "O-5",
          "how": "The notify uses GROUP BY namespace, environment, user_id with json_build_object over all four fields (D-7), and the SQL-text test asserts there is no DISTINCT ON."
        },
        {
          "id": "O-10",
          "how": "Both scripts carry no transaction statement, checked by the anchored 046 regex (`deadRowsMigration.test.ts:27-30`) in a node:test. The positive single-statement strengthening is tracked as a new non-blocking objection."
        },
        {
          "id": "O-11",
          "how": "All assertion counts are scoped to the assertion's own seed user_ids."
        },
        {
          "id": "O-12",
          "how": "Block 2 runs `\\set grace_hours 0` before its `\\ir` and pins the 1h floor with a 30-minute orphan (survives) and a 2-hour orphan (deleted)."
        },
        {
          "id": "O-13",
          "how": "The gate is the live migration-rerun CI job plus a local stripped-meta-command pglast pre-parse (D-9)."
        },
        {
          "id": "O-14",
          "how": "A Playwright AC-3 failure-path spec in `e2e/insights/signal-sources.spec.ts` (feature-224 block, `:200`) using the route.fulfill 409 seam at `:111-118`. The inline error body is allowed under C-12 as a scenario one-off."
        },
        {
          "id": "O-15",
          "how": "The runbook states psql 10 or later and `-v ON_ERROR_STOP=1` on every command."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

- 2026-11-20 sdd-design (approved): recon.md (written 2026-11-11; reuse the config 046 single-statement CTE and the `migration-assertions` BEGIN…`\ir`…ROLLBACK block template); 3 grilling rounds (full), approved by the operator at the design gate (Floor clear); wrote design.md; debate.md State approved; status spec-ready → design-approved; business rules all PRESERVE (no CHANGE). Operator decision reproduced verbatim in Decisions. Its Open Threads are hoisted into the header (reclaim depends on an operator run, grace-window reclaim, prod role privileges, target DB list, no CI static parse, assertion isolation, psql >= 10, batch peers on `tools.py`, O-17..O-25 mapping).
- 2026-11-20 sdd-spec and impl-review: see the two verbatim sessions below.

## Session 2026-11-20 — sdd-spec

- Generated implementation-spec.md with 9 steps. Status: design-approved → implementation-ready.
- Tree: the feature branch (`70221104`) is 168 commits behind `main-dev` and holds docs only, so every `path:line` in the spec was read on `origin/main-dev@fb52065c`. No `main-dev` merge was made here (this run may edit only the feature directory); `/sdd-execute`'s BRANCH SYNC does it before Step 1.
- Steps: 1 config SQL-text suite, 2 rerun assertion + CI filters, 3 sweep + preview SQL (1+2+3 land together, backend), 4 runbook section, 5 agent text, 6 agent pins + doc parity, 7 UI hook comment, 8 Playwright AC-3 pin, 9 remaining docs.
- Key codebase findings:
  - No migration ships (D-1), so the operator's "next free config migration" rule has nothing to number. Config tip on `main-dev` is `055_analysis_live_enrich_ttl_reseed`; ingest tip is `018`.
  - The harness is `scripts/migration-rerun.py`; `split_assertions` (`:562-572`) routes `config-mcp-credential-sweep.sql` to the post loop (`:1112-1120`) with no harness edit. One psql process per assertion file, so block 2 must `\set grace_hours 0` before its `\ir`.
  - The sweep, preview and assertion SQL in the spec were executed on PostgreSQL 16.15 against a stand-in schema (three tables, both audit triggers, both CHECKs, the scope unique index): exit 0, `deleted 4 / notified 2`, replay `0 / 0`, and nine single-conjunct mutations of the sweep each fail the assertion. They have not run against the real migration chain; the CI `migration-rerun` job is the first real execution.
  - Survivor arrays must sort with `COLLATE "C"`: under the default collation `mcpXcredential.z` and `mcp_credential.*` order differently and the first draft failed on that alone.
  - `uv run --no-project --with pglast` works for the offline pre-parse (1 / 1 / 9 statements after meta-command lines are stripped and `:'grace_hours'` is replaced).
  - Citation drift corrected in the spec: the agent `tools.py` sites (`_write_source_bearer` `:479`, `credentials_ref:` doc `:1541`), the Playwright seam (`signal-sources.spec.ts:112-126` fulfills 503/`unavailable`, not 409), and the doc sites, several of which no longer contain the word "orphan".
  - The insights page renders the register error as a plain `<p>` (`page.tsx:822`), not a `role="alert"` element, so Step 8 asserts the error text.

### Open Threads

- [ ] **Operator gate (Step 4): the target database list is still not confirmed.** Candidates: DO dev, DO prod, homelab `xstockstrat-staging`. The spec blocks Step 4 until the operator answers; it does not guess (P-03).
- [ ] **Operator gate (Step 4): the sweep cadence.** The design names none. Proposed: on demand, and before each `main-dev` → `main` promotion; the operator confirms or replaces it.
- [ ] **Cross-owner seeds use two seed users.** The binding decision names one user V, but case (i) needs V to have no source and cases (ii)/(iii) need V to have sources. Step 2 uses `sweep328-v1` (case i) and `sweep328-v2` (cases ii, iii) so every clause holds literally. To be checked at `/sdd-review impl-spec`.
- [ ] `mcp-tools.md` `instantiate_template` rows are left unchanged (they never stated the orphan trade-off); only the `manage_signal_source` rows gain the sweep text. To be checked at `/sdd-review impl-spec`.
- [ ] The product spec has no `## Consumer Surface(s)` section (bug template); the spec treats the fix as internal plus runbook and still lands text and pins on the agent and UI surfaces.
- Next: `/sdd-review fix-agent-bearer-secret-orphan impl-spec`, then `/sdd-execute fix-agent-bearer-secret-orphan`.

## Session 2026-11-20 — sdd-review impl-spec (advisory)

- Result: 0 failures, 8 warnings (advisory — did not block). Lifecycle unchanged (`implementation-ready`). Floor breaches: none.
- Overlap: WARN (file-level only). No migration number, proto field number or config key collides; this feature ships none of the three.
- Re-verified on `origin/main-dev@fb52065c` before editing the spec: the `Lands with` rule (`.claude/skills/sdd-spec/reference/step-constraints.md` §C), the live features' file lists (345, 321, 330, 357 implementation specs), `merge-order.md:384-405`, and a repo-wide `git grep -i -E "orphan|secret-first"`.

### Addressed in implementation-spec.md

- [x] Steps 5 / 6 ordering (P-06): Steps 5 and 6 are now one unit (`**Lands with**` on both; reason in § Step Dependencies). Order inside the unit: write Step 6's tests, capture the parity red, apply Step 5's edits, one commit.
- [x] Step 2: added the "no coverage threshold applies; the unit's threshold is Step 1's" note.
- [x] Operator gate reach (P-03): § Step Dependencies now states that Steps 5+6 and Step 9 are blocked with Step 4, and that Steps 1–3 and 7–8 are not.
- [x] C-10 site list: Step 9 § Codebase Evidence records the repo-wide grep result, and Step 9's Verification runs the grep. No orphan-stating site is missed. Four "secret-first only" sites are left unchanged on purpose: `docs/runbooks/mcp-tools.md:902`, `src/app/insights/signal-sources/page.tsx:322`, `services/xstockstrat-agent/tests/test_template_tools.py:4`, `.gitleaks.toml:20`.
- [x] Overlap: § Step Dependencies lists the shared files with 345, 357, 321, 330, 318 and 324. Correction to the overlap report: this feature does **not** edit the root `docs/context-constitution-findings.md` (no `mcp_credential` hit there); only the agent-local findings file (Step 5).

### Unresolved ⚠ carried into execution

- Step 4: target database list and sweep cadence are not confirmed by the operator (P-03). Blocks Step 4, and with it Steps 5+6 and 9 — [ ] unaddressed
- Step 2: cross-owner seeds use two users (`sweep328-v1`, `sweep328-v2`) where the binding operator decision names one V. The single-V reading contradicts itself (case i needs no source, cases ii/iii need sources). The operator has not confirmed the refinement — [ ] unaddressed
- Steps 1–3: the sweep and assertion SQL have run only on a stand-in schema. The CI `migration-rerun` job is the first real run; a red there reopens the unit — [ ] unaddressed
- Step 8: the UI instantiate writer (`src/app/insights/templates/page.tsx:40`) has no pin (intentional skip, O-25) — [ ] unaddressed
- Product spec: no `## Consumer Surface(s)` section (C-14, bug template). The spec's note stays; the product spec was not edited in this review — [ ] unaddressed
- Step 9: `docs/repo-surveyor/debt-radar-findings.md:553` asks whether the defect report covers the UI path (it does: AC-3, Steps 7–8). The file is outside this feature's file set and is not edited; the operator decides whether to answer it there — [ ] unaddressed

### Overlap findings

- `345-authelia-sso`: `services/xstockstrat-agent/app/tools.py`, `docs/runbooks/mcp-tools.md`, `.github/workflows/ci.yml`, `docs/patterns/config-governance.md` — different functions and sections.
- `357-fix-portfolio-internal-position`: `.github/workflows/ci.yml:1065` only.
- `321-fix-trading-config-plumbing`, `330-fix-live-enrich-ttl-seed`: `docs/patterns/config-governance.md` (append-only logs; 330's sentinel row is already on `main-dev`).
- Batch peers (no implementation spec on trunk, unverified): `314`, `331`, and per `merge-order.md` 319, 322, 327 on `tools.py` / `tests/test_tools.py`; `318`, `324` on `.github/workflows/ci.yml`.
- Rule for all of them: the second merger rebases and re-greps its anchors. No merge-order row is needed (no FAIL-level overlap).

### Open Threads

- [ ] **Operator gate (Step 4): confirm the target database list and the cadence** before Step 4; Steps 5+6 and 9 wait on it.
- [ ] **Confirm the two-seed-user reading** of the cross-owner decision (Step 2) at the `/sdd-execute` checkpoint.
- [ ] A red `migration-rerun` job on the integration PR reopens Steps 1–3.
- [ ] UI instantiate writer stays unpinned (O-25).
- [ ] `docs/repo-surveyor/debt-radar-findings.md:553` is unanswered and outside this feature's file set.
- Next: `/sdd-execute fix-agent-bearer-secret-orphan`.

## Session 2026-11-21 — /sdd-distill
- Distilled 8 sessions → header + Superseded Sessions; kept 2 verbatim (sdd-spec, sdd-review impl-spec). The round-2 state fence was dropped; the round-3 fence (last in file) kept byte-for-byte.
- context.md 687 → 362 lines, 74753 → 52484 bytes. Original prose preserved in git history.
