# Context Log: fix-agent-bearer-secret-orphan

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect report (Issues disabled; clustered triage):
  - docs/reports/2026-10-19-agent-bearer-secret-orphan-on-failed-register-defect.md — Signal-source bearer secret is orphaned when the source register fails (SEV-3)
- Cluster rationale: single-report feature — the secret-first orphan spans the agent tool paths and the config-ui hook, one fix decision.
- Severity: SEV-3
- Routed to SDD path (Track C)
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..AC-3), context.md; stamped the report sidecar `triaged`
- Affected services (from report): xstockstrat-agent, xstockstrat-config, xstockstrat-ingest, xstockstrat-ui
- Root cause hypothesis: deliberate secret-first ordering (feature 224) with no compensating delete; `config.proto` has no delete RPC
- Open questions: maintainer ruling — compensating delete (new config RPC) vs accept + sweep; sweep home (product-spec § Open Questions)
- Recommended design depth: full → `/sdd-design fix-agent-bearer-secret-orphan` (rationale: SEV-3, but 4 affected services, a possible proto change (new config RPC), and a secret-handling security posture)
- Development branch: feature/fix-agent-bearer-secret-orphan

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags; no Consumer Surface section); conditional config RPC must be flagged additive + authz rule; sweep migration strategy deferred; OQ1 maintainer ruling gates acceptance — resolve first in /sdd-design
- Overlap findings: WARN: agent tools.py with 314; config.proto with 322
- Recommended design depth: full (4 services; conditional new config RPC (additive proto))
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)

## Session 2026-11-10 (operator decisions before /sdd-design)

- Operator ruled **sweep**: keep the secret-first write; a sweep deletes `mcp_credential.*` rows unreferenced by any source. No compensating-delete RPC, so no proto change. Where/how the sweep runs (scheduled job vs runbook vs data migration — OQ2) is decided in `/sdd-design`.
- AC-1..3 now assert the post-sweep state; AC-4 added: the sweep never deletes a referenced secret.

## Session 2026-11-11 — sdd-batch design gate (round 2)

- `/sdd-design fix-agent-bearer-secret-orphan` (full) stopped at its approval gate after round 2 (gate policy: halt). design.md was not written and status.md was not changed (grilling protocol). Debate register: `debate.md` (State in-debate, Rounds run 2).

### Open Threads

- **Approach (round-2 synthesis).** No migration and no proto change (D-1; R-1/R-2 locked).
  - The operator runs a re-runnable, unlatched SQL sweep, `scripts/config-heal/mcp-credential-orphan-sweep.sql`. It is one data-modifying CTE in the shape of config 046: delete, audit, report, notify. It has no BEGIN, COMMIT or ROLLBACK.
  - Predicate: owner-exact on `user_id`, stripped key, environment ignored (D-2). Grace keys on `updated_at`, from the psql variable `grace_hours` (default 24h, `GREATEST(...,1)` floor).
  - Audit: one explicit row per deletion, actor `system:config-heal-mcp-credential-sweep` (D-4). No snapshot (D-3).
  - Notify: `GROUP BY namespace, environment, user_id` with all four CONFIG-4 fields (D-7).
  - Preview: a separate read-only SELECT whose marker-delimited predicate is byte-identical to the sweep's, enforced by a vitest (D-6).
  - Runbook: a section in `docs/runbooks/mcp-tools.md` that states psql 10 or later, then lists the steps: privilege pre-check, confirm targets, preview, sweep, re-preview.
  - Tests:
    - a config vitest on the SQL text;
    - an assertion `scripts/migration-assertions/config-mcp-credential-sweep.sql`, wrapped in BEGIN…ROLLBACK, that loads the sweep with `\ir`. It runs through the existing catch-all loop with no `migration-rerun.sh` edit (D-8);
    - agent AC-1/AC-2 tests on the `test_tools.py` `set_config` seam;
    - a UI AC-3 Playwright failure-path test in `e2e/insights/signal-sources.spec.ts`.
  - CI: both path filters gain the scripts. The SQL gate is the live migration-rerun job, plus a local pglast pre-parse (D-9).
  - C-10 text edits say "+ reclaimed by the orphan sweep (runbook)".
- **Strongest open objection (blocking).** The synthesis fixes three defects, and the next proposer must confirm each fix.
  - O-5 (petition P-2): the round-2 `DISTINCT ON … min(key)` notify is invalid SQL and would abort the sweep. The fix is the GROUP BY form.
  - O-3 (petition P-1): an explicit `psql -f` line in `migration-rerun.sh` would run the assertion twice. The fix is to drop that edit.
  - O-10 (new): the sweep and preview must contain no transaction-control token. An inner COMMIT would leak the assertion's seed rows into the shared rerun DB ahead of `ingest-013.sql`.
  - Non-blocking, still open: O-11 (counts scoped to seed user_ids), O-12 (`\set grace_hours 0` before a further `\ir`), O-13 (no pglast in CI), O-14 (the AC-3 seam is Playwright with C-12 fixtures), O-15 (psql 10 or later in the runbook).
- **Floor status.** No Floor breaches. D-1..D-5 are honoured and none of R-1..R-5 is reintroduced.
- **Uncovered @AC changes.** None. Every touched scenario is a PRESERVE, and `acceptance.feature` is not edited (O-9 closed). These PRESERVE rows are not covered by an operator decision and must stay green: feature AC-4, ingest @AC-3, platform @AC-35, config @AC-1/2/3/14 (redaction), @AC-11/13 (per-user scoping), @AC-4/5 (GetSecret authority) and @AC-16 (GetSecret found=false).
- **Closed this round.** O-1, O-2, O-4, O-6, O-7, O-8, O-9.
- **Open risks.**
  - Reclaim only happens when an operator runs the sweep.
  - A credential staged longer ago than the grace window is reclaimed (documented).
  - The prod role's privileges and the cluster topology are unverified (both mitigated in the runbook).
  - CI does not statically parse the sweep.
  - The assertion's isolation depends on the outer BEGIN…ROLLBACK.
- **Next.** The next `/sdd-batch` run resumes the debate from the state block below. The operator rules on petitions P-1 and P-2 at the gate.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Round-2 best approach. It keeps the proposal and fixes the adversary's two compile/run defects. There is no migration and no proto change (D-1, R-1/R-2 locked).\n\n1. **Sweep** — new file `scripts/config-heal/mcp-credential-orphan-sweep.sql`. It is one data-modifying CTE in the shape of `services/xstockstrat-config/migrations/046_config_dead_rows_prune.up.sql:5-30`: delete, then audit, then report, then notify. No latch, no snapshot (D-3), and no transaction-control token (no BEGIN, COMMIT or ROLLBACK), so the assertion's outer BEGIN…ROLLBACK stays in charge. A single statement is already atomic.\n   - **Header:** `\\if :{?grace_hours} \\else \\set grace_hours 24 \\endif`.\n   - **Predicate**, kept between `-- predicate:begin` and `-- predicate:end`:\n     - `v.is_secret AND v.user_id IS NOT NULL AND v.namespace='ingest' AND v.key LIKE 'mcp_credential.%'`\n     - `AND v.updated_at < now() - make_interval(hours => GREATEST(:'grace_hours'::int, 1))`\n     - `AND NOT EXISTS (SELECT 1 FROM ingest.signal_sources s WHERE s.user_id = v.user_id AND substring(s.credentials_ref from position('.' in s.credentials_ref)+1) = v.key)` (D-2)\n     - Grace keys on `updated_at`: it defaults to NOW() at `001_config_tables.up.sql:19` and the BEFORE UPDATE trigger bumps it at `:44,49-51`, so re-staging a key restarts its grace.\n   - **Audit:** actor `system:config-heal-mcp-credential-sweep`. `old_value` is the stored `[redacted]` value_data. This is the only audit row (D-4).\n   - **Report:** `config.config_keys_report_296`, action `mcp-credential-orphan-deleted`.\n   - **Notify (corrected):** `SELECT pg_notify('config_changed', json_build_object('namespace',namespace,'key',min(key),'environment',environment,'user_id',user_id)::text) FROM d GROUP BY namespace, environment, user_id`. That gives one notify per (namespace, environment, user_id), with all four CONFIG-4 fields. The proposal's `DISTINCT ON … min(key)` is invalid SQL. The listener reads only namespace and environment (`services/xstockstrat-config/src/grpc/configServiceImpl.ts:417-424`).\n   - **Final SELECT:** the deleted and notified counts.\n\n2. **Preview** — new file `scripts/config-heal/mcp-credential-orphan-sweep-preview.sql`. It is a read-only SELECT of `(user_id, key, environment, now()-updated_at AS age)` plus a count. It uses the same header and a byte-identical marker-delimited predicate. I chose this over the \"preview = sweep under BEGIN/ROLLBACK\" option because it takes no row locks and an operator can see that it is read-only. One option is picked and the other dropped.\n\n3. **Runbook** — new section in `docs/runbooks/mcp-tools.md` near `:820`:\n   - States the minimum psql version: 10 or later for `\\if` and `:{?var}`. The migrate image is postgres:16, but operators run their own host psql (`brew install libpq`).\n   - Steps in order:\n     1. `has_table_privilege` pre-check: SELECT on `ingest.signal_sources`; DELETE on `config.config_values`; INSERT on `config.config_audit` and `config.config_keys_report_296`.\n     2. The operator confirms the target databases or clusters and names each one.\n     3. Run the preview.\n     4. Run the sweep.\n     5. Re-run the preview and expect 0.\n   - States the reclaim rule: an `mcp_credential.*` secret left unreferenced for longer than `grace_hours` (default 24h, floor 1h) is reclaimed. This includes credentials staged with `set_config` and attached later through an explicit `credentials_ref`.\n\n4. **Tests**\n   - **(a) Config vitest**, using `services/xstockstrat-config/src/__tests__/migrationSql.ts`. It asserts:\n     - every predicate component (`updated_at`, not `created_at`; the GREATEST floor; the stripped-key NOT EXISTS);\n     - `GROUP BY namespace, environment, user_id` with the four payload fields, and no `DISTINCT ON`;\n     - no `value_encrypted`, `premigration` or `config_markers`;\n     - no BEGIN, COMMIT or ROLLBACK token in either script;\n     - the two marker blocks are byte-identical.\n   - **(b) Assertion file** — new `scripts/migration-assertions/config-mcp-credential-sweep.sql`. Its name avoids both the `config-[0-9]*` and `fixtures-*` patterns.\n     - There is no `migration-rerun.sh` edit. The catch-all loop at `scripts/migration-rerun.sh:768-780` already runs it after `db-migrate.sh up` has put ingest at 14 (`:759-766`). An explicit line would run it twice.\n     - The file wraps everything in BEGIN…ROLLBACK, so the seed rows and pg_notify never reach `ingest-013.sql` (which sorts next) or the AC-8 listener check.\n     - It seeds its own unique `user_id`s and backdates `updated_at`.\n     - It runs `\\ir ../config-heal/mcp-credential-orphan-sweep.sql`.\n     - Seed cases: referenced A; orphan B; in-grace orphan C; another user's row with key B; a global secret; refs with no dot, NULL and empty; a pre-staged key older than the grace (deleted, as documented).\n     - It asserts counts scoped to its seed `user_id`s only: B and the old pre-staged key are gone, the rest remain.\n     - It runs `\\ir` again and asserts 0 newly deleted.\n     - It then does `\\set grace_hours 0`, re-seeds an orphan backdated by 30 minutes, runs `\\ir` a third time, and asserts the 30-minute row survives. That checks the floor is treated as 1h.\n   - **(c) Agent guard:** AC-1 and AC-2 regression tests on the `services/xstockstrat-agent/tests/test_tools.py:147-178` AsyncMock `set_config` seam. A failed register or instantiate returns the mapped ALREADY_EXISTS error and writes exactly one secret per attempt.\n   - **(d) UI guard:** an AC-3 failure-path Playwright spec in `services/xstockstrat-ui/e2e/insights/signal-sources.spec.ts`, next to the feature-224 block at `:200-227`. The mock rejects register; the UI shows the error; exactly one SetConfig is recorded. Mock data comes from `e2e/fixtures/` and `INVENTORY.md` (C-12). It is not a Vitest test, because UI Vitest is node-env and scoped to `src/lib/**`.\n\n5. **CI** — in `.github/workflows/ci.yml:60,71-79`, add `scripts/config-heal/mcp-credential-orphan-sweep*.sql` to both the `migrations` filter and the `xstockstrat-config` filter.\n   - The spec names the live `migration-rerun` CI job as the SQL gate. Nothing in `scripts/` or `.github/` uses pglast; \"pass 2d\" is the feature-305 dead-row pass.\n   - Before pushing, the executor pglast-parses the CTE locally, with the psql meta-commands stripped and `:'grace_hours'` replaced by a literal (fails.md:3878).\n\n6. **Text edits (C-10)** — add \"+ reclaimed by the orphan sweep (runbook)\" at:\n   - `docs/patterns/config-governance.md:318,525`\n   - `services/xstockstrat-agent/CLAUDE.md:175`\n   - `docs/patterns/inter-service-mtls.md:58`\n   - the insights.md feature-166 note\n   - `services/xstockstrat-agent/app/tools.py:402` and `:1436` (the explicit-ref docstring states the grace reclaim rule)\n   - `services/xstockstrat-ui/src/app/config-ui/hooks/useSignalSourceMutations.ts:35-36`\n   - the ingest CLAUDE.md bearer note\n   \n   Agent finding `:44` moves to resolved.\n\n`acceptance.feature` is not edited (O-9). The tests backdate rows, and the header already records the operator's sweep ruling.",
    "open_objections": [
      {
        "text": "[O-5 / C-01] The proposal's notify form `DISTINCT ON (namespace, environment, user_id) ... min(key)` is invalid SQL: the aggregate is not in GROUP BY, so the whole statement aborts and deletes nothing. Synthesis adopts `... FROM d GROUP BY namespace, environment, user_id` with json_build_object over all four CONFIG-4 fields. The next proposer must confirm it, and the vitest must assert GROUP BY rather than DISTINCT ON.",
        "blocking": true
      },
      {
        "text": "[O-3 / C-01] The explicit `psql -f` line in `migration-rerun.sh` would run the assertion twice. The catch-all loop at `scripts/migration-rerun.sh:768-780` already runs every non-`config-[0-9]*`, non-`fixtures-*` file after `db-migrate.sh up` has brought ingest to 14 (`:759-766`). Drop the edit, and state the naming constraint in the spec. The rest of O-3 (BEGIN…ROLLBACK, `\\ir`, backdating) is satisfied.",
        "blocking": true
      },
      {
        "text": "[new, C-01] The sweep and preview scripts must contain no transaction-control tokens (BEGIN, COMMIT or ROLLBACK). An inner COMMIT would commit the assertion's seed rows into the shared rerun DB ahead of `ingest-013.sql`. Add a vitest assertion for this.",
        "blocking": true
      },
      {
        "text": "[new] Assertion expected counts must be scoped to the assertion's own seed user_ids, not global counts. Fixture state from earlier passes is present in the 768 loop's DB.",
        "blocking": false
      },
      {
        "text": "[new] The grace_hours=0 case needs `\\set grace_hours 0` before a further `\\ir`. Without it the header's `\\if :{?grace_hours}` keeps the earlier value, and the spec must spell this out.",
        "blocking": false
      },
      {
        "text": "[new, C-01] Assumption 2 (a pglast pass 2d) is false. pglast is not used anywhere in `scripts/` or `.github/`. The spec must name the live migration-rerun CI job as the SQL gate, plus a local pglast parse of the CTE with meta-commands stripped and the variable replaced by a literal.",
        "blocking": false
      },
      {
        "text": "[new, C-08/C-12/C-15] The AC-3 UI guard needs a named seam. Use a Playwright failure-path spec in `services/xstockstrat-ui/e2e/insights/signal-sources.spec.ts`, with mocks from the fixture inventory, not a node-env Vitest test.",
        "blocking": false
      },
      {
        "text": "[new, C-10] The runbook must state the minimum psql version (10 or later) for `\\if` and `:{?var}`, because operators run their host psql, not the postgres:16 migrate image.",
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
      "DISTINCT ON (namespace, environment, user_id) with min(key) as the notify form. It is invalid SQL (aggregate without GROUP BY) and aborts the sweep statement.",
      "An explicit `psql -f` invocation of the assertion in migration-rerun.sh. The catch-all loop at `:768-780` already runs it after ingest is migrated, so the line would run it twice.",
      "Preview = the sweep wrapped in BEGIN; \\ir sweep; ROLLBACK. It has zero drift, but it takes config_values row locks while previewing and does not read as read-only to an operator. The marker-block equality vitest was chosen instead.",
      "A shared `\\ir` predicate fragment spliced into the middle of a CTE statement. It is fragile, because it depends on psql's query-buffer behavior mid-statement.",
      "Grace on GREATEST(created_at, updated_at). No gain: updated_at defaults to NOW() and the trigger bumps it on update (`001_config_tables.up.sql:19,44`).",
      "Exempting the explicit-credentials_ref path from the sweep. A staged key that stays unreferenced past the grace cannot be told apart from an orphan, so the reclaim rule is documented instead.",
      "Editing acceptance.feature to add 'older than the grace window' to AC-1..3. That is an EXTEND needing operator sign-off; backdated tests satisfy the existing wording.",
      "A UI Vitest test for the AC-3 hook. UI Vitest is node-env and scoped to src/lib/**, so it cannot exercise the React hook."
    ],
    "open_risks": [
      "Reclaim depends on an operator running the script. Orphans pile up between runs, and AC-1..3 hold only after a manual run. The escalation path is a post-migrate hook.",
      "A credential deliberately staged longer ago than grace_hours is reclaimed. A source updated later to reference it gets GetSecret found=false (config @AC-16). This is documented, not prevented.",
      "The prod operator role's privileges on ingest.signal_sources and config.* are unverified (fails.md ~L2819). The runbook pre-check mitigates this.",
      "The dev/prod cluster topology is unconfirmed, so the run targets cannot be named in advance (fails.md ~L3940). The operator-confirm step mitigates this.",
      "No CI step statically parses the sweep. Only the live migration-rerun job catches SQL defects (fails.md:3878 pattern), so expect CI round-trips unless the executor pre-parses locally.",
      "The assertion file sorts before ingest-013.sql in the shared rerun DB. Correctness depends on the outer BEGIN…ROLLBACK and on the sweep having no transaction control.",
      "An operator's host psql may be older than 10 and fail on `\\if` and `:{?var}`. The runbook states the minimum version."
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
      "CONFIG-4",
      "PLAT-N1"
    ],
    "rationale": "The proposal answers O-1, O-2, O-4, O-6, O-7, O-8 and O-9 concretely, so they close.\n- **O-1:** grace keys on updated_at, which the trigger resets (`001:19,44`), with a 24h default and a 1h floor, documented in the runbook and at `tools.py:1436`.\n- **O-2:** both CI filters gain the script paths.\n- **O-4:** a preview with a byte-identical marker block, plus the five-step runbook order.\n- **O-6:** a psql variable with a GREATEST floor, plus a 0-hour case.\n- **O-7:** every listed doc instance gets the edit.\n- **O-8:** no-dot, NULL and empty ref cases.\n- **O-9:** the tests backdate rows, and the acceptance.feature header already records the operator's 2026-11-10 sweep ruling.\n\nI checked the adversary's two blocking claims against the code. Both hold.\n- `scripts/migration-rerun.sh:768-780` loops over every assertion except `fixtures-*` and `config-[0-9]*` below R, after `db-migrate.sh up` at `:759-766`. The proposal's explicit invocation would therefore run the file twice. O-3's answer is defective and stays open.\n- `DISTINCT ON … min(key)` is invalid PostgreSQL. The listener destructures only namespace and environment (`configServiceImpl.ts:417-424`). O-5's answer is defective and stays open; the synthesis carries the GROUP BY correction.\n- `grep pglast` finds nothing in `scripts/` or `.github/`, which confirms assumption 2 is false.\n\nThe no-transaction-control rule is new and blocking because the assertion's isolation depends on it. No Floor breaches. The approach honors D-1..D-5 and reintroduces no R-1..R-5.\n\nThe adversary's REOPEN petitions on O-3 and O-5 target objections that are still open, not closed, so they need no operator reopen. They are recorded as petitions with new evidence, and reopened stays empty.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "The preview is a separate read-only SELECT file whose predicate is a marker-delimited block, byte-identical to the sweep's and enforced by a vitest. It is not the sweep run under BEGIN/ROLLBACK.",
          "evidence": "The adversary accepted either option (C-18). The SELECT preview takes no config_values row locks and reads as read-only; the proposer's choice, with no counter-argument on record."
        },
        {
          "text": "The sweep notifies with `GROUP BY namespace, environment, user_id` and json_build_object over namespace, min(key), environment and user_id. DISTINCT ON is not used.",
          "evidence": "DISTINCT ON with an ungrouped aggregate is rejected by PostgreSQL. The listener reads only namespace and environment (`services/xstockstrat-config/src/grpc/configServiceImpl.ts:417-424`)."
        },
        {
          "text": "No migration-rerun.sh edit. The assertion `config-mcp-credential-sweep.sql` runs through the existing catch-all loop after ingest is migrated.",
          "evidence": "`scripts/migration-rerun.sh:759-780`: the loop skips only fixtures-* and config-[0-9]* below R, after db-migrate.sh up brings ingest to 14."
        },
        {
          "text": "The SQL gate for the sweep is the live migration-rerun CI job, plus a local pglast pre-parse with meta-commands stripped. There is no CI static parse.",
          "evidence": "No pglast in scripts/ or .github/ (grep). fails.md:3878."
        }
      ],
      "new_rejected": [
        {
          "text": "DISTINCT ON (namespace, environment, user_id) ... min(key) notify form",
          "why": "Invalid SQL: an aggregate without GROUP BY aborts the single sweep statement."
        },
        {
          "text": "Explicit psql -f invocation of the sweep assertion in migration-rerun.sh",
          "why": "The catch-all loop at `migration-rerun.sh:768-780` already runs it, so the line would run it twice."
        },
        {
          "text": "Preview implemented as the sweep wrapped in BEGIN/ROLLBACK",
          "why": "It takes row locks during preview and does not read as read-only to an operator; the marker-block SELECT preview was chosen."
        },
        {
          "text": "UI Vitest for the AC-3 hook guard",
          "why": "UI Vitest is node-env and scoped to src/lib/**; the Playwright signal-sources spec is the seam."
        }
      ],
      "new_objections": [
        {
          "text": "The sweep and preview scripts must contain no BEGIN, COMMIT or ROLLBACK token, because an inner COMMIT would leak the assertion's seed rows into the shared rerun DB ahead of ingest-013.sql. A vitest must assert this.",
          "blocking": true
        },
        {
          "text": "Assertion counts must be scoped to the assertion's own seed user_ids, not global counts.",
          "blocking": false
        },
        {
          "text": "The grace_hours=0 case must `\\set grace_hours 0` before a further `\\ir`, because the header's `\\if :{?grace_hours}` keeps the earlier value.",
          "blocking": false
        },
        {
          "text": "Assumption 2 (pglast pass 2d) is false. The spec must name the live migration-rerun CI job as the gate, plus a local stripped-meta-command pglast pre-parse.",
          "blocking": false
        },
        {
          "text": "The AC-3 UI guard must be a Playwright failure-path spec in `services/xstockstrat-ui/e2e/insights/signal-sources.spec.ts` using fixture-inventory mocks (C-12).",
          "blocking": false
        },
        {
          "text": "The runbook must state psql 10 or later as the minimum for `\\if` and `:{?var}` on operator hosts.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-1",
          "how": "Grace keyed on updated_at (reset by the BEFORE UPDATE trigger, `001_config_tables.up.sql:19,44`), 24h default psql variable with a 1h floor. The explicit-ref reclaim rule is documented in the runbook and at `tools.py:1436`, with a seed case for an old pre-staged key."
        },
        {
          "id": "O-2",
          "how": "`scripts/config-heal/mcp-credential-orphan-sweep*.sql` added to both the migrations and xstockstrat-config filters in `ci.yml:60,71-79`."
        },
        {
          "id": "O-4",
          "how": "Read-only preview file with a byte-identical marker-delimited predicate and a vitest equality check. The runbook order is privilege pre-check, confirm targets, preview, sweep, re-preview."
        },
        {
          "id": "O-6",
          "how": "`grace_hours` psql variable with `GREATEST(:'grace_hours'::int, 1)` and a grace_hours=0 assertion case."
        },
        {
          "id": "O-7",
          "how": "All listed doc and comment instances gain '+ reclaimed by the orphan sweep (runbook)', plus `tools.py:402,1436`, `useSignalSourceMutations.ts:35-36` and the ingest CLAUDE.md note."
        },
        {
          "id": "O-8",
          "how": "No-dot, NULL and empty credentials_ref seed cases in the assertion."
        },
        {
          "id": "O-9",
          "how": "Tests backdate updated_at, and acceptance.feature is not edited. Its header already records the operator's sweep ruling."
        }
      ],
      "reopen_petitions": [
        {
          "target": "O-3",
          "evidence": "`scripts/migration-rerun.sh:768-780` catch-all loop already runs non-config-[0-9]*, non-fixtures-* assertions after db-migrate.sh up (`:759-766`), so the proposed explicit invocation runs the file twice (adversary).",
          "is_new": true
        },
        {
          "target": "O-5",
          "evidence": "The proposed `DISTINCT ON ... min(key)` notify is invalid SQL; the listener ignores key and user_id (`configServiceImpl.ts:417-420`) (adversary).",
          "is_new": true
        }
      ],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```
