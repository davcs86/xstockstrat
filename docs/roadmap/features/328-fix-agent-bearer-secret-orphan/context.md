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

## Session 2026-11-13 — sdd-batch design gate (round 3)

- `/sdd-design fix-agent-bearer-secret-orphan` (full) stopped at its approval gate after round 3 (gate policy: halt). design.md was not written and status.md was not changed (grilling protocol). Debate register: `debate.md` (State in-debate, Rounds run 3).

### Open Threads

- **Approach (round-3 synthesis).** No migration, no proto change and no new key (D-1, D-5).
  - **Sweep.** The operator runs `scripts/config-heal/mcp-credential-orphan-sweep.sql`, which is exactly one statement: a data-modifying CTE in the config 046 shape. Its parts are `d` (DELETE … RETURNING), `aud`, `nt`, and a final `SELECT deleted, notified` that references `nt` (without that reference the notify never runs). It has no latch, no snapshot (D-3) and no transaction statement.
  - **Predicate.** It sits in a `-- mcp_orphan:begin/end` marker block that is byte-identical in the sweep and the preview (D-6). It matches `is_secret`, `user_id IS NOT NULL`, namespace `ingest` and `starts_with(key, 'mcp_credential.')` (D-11, not LIKE). The grace window keys on `updated_at`, with `GREATEST(:'grace_hours'::int, 1)`: default 24h, floor 1h. The NOT EXISTS join is owner-exact on the stripped key (D-2).
  - **Audit and notify.** The only audit row has actor `system:config-heal-mcp-credential-sweep` and the `[redacted]` old_value (D-4). The notify is `GROUP BY namespace, environment, user_id` (D-7).
  - **Report write dropped.** The synthesis drops the `config_keys_report_296` write (C-18). The proposer must confirm.
  - **Preview.** A read-only SELECT over the same marker block, with a `count(*) OVER ()` total.
  - **Runbook.** It lives in `docs/runbooks/config-rollout.md`, cross-linked from `mcp-tools.md`. Access is DB-owner psql over direct `:25060` (`operator-db-access.md`). It requires psql 10 or later and `-v ON_ERROR_STOP=1`.
    - Steps: privilege pre-check, confirmed targets, preview, sweep, re-preview expecting 0.
    - It states the reclaim rule and the audit query by actor.
  - **Tests.**
    - **(a) Config SQL-text test.** A node:test, `mcpCredentialSweep.test.ts`. It asserts one statement per file (WITH for the sweep, SELECT for the preview), that the sweep references `nt`, that the marker blocks are identical, and the predicate pieces. It also asserts none of `value_encrypted`, `premigration`, `config_markers` or `config_keys_report_296` appears.
    - **(b) Assertion `scripts/migration-assertions/config-mcp-credential-sweep.sql`.** It is built from multi-block BEGIN…`\ir`…DO-assert…ROLLBACK blocks and runs through the existing post loop with no harness edit (D-8, D-12).
      - Seeds are backdated by INSERT, never UPDATE (D-10), and use SetConfig's row shape.
      - Every must-survive seed is 25h old and matches every other conjunct.
      - Three cross-owner seeds are included, plus a `grace_hours=0` block with 30-minute and 2-hour orphans.
      - The audit count filters on actor.
    - **(c) Agent AC-1/AC-2 tests.** On the `test_tools.py` AsyncMock seam. They assert three distinct keys and `credentials_ref == f"ingest.{key}"` on every attempt.
    - **(d) UI AC-3 Playwright test.** Uses the 409 route-fulfill seam in `e2e/insights/signal-sources.spec.ts`. The UI instantiate path gets a 409 case or a recorded skip; the recommendation is the skip.
    - **Covers lines** name SQL block 1 as the RED coverage for AC-1..3.
  - **CI.** The sweep scripts are added to the `migrations` path filter (`ci.yml:88-97`) and the `xstockstrat-config` filter (`:60`). The gate is the live migration-rerun job plus a local pglast pre-parse (D-9).
  - **C-10 text edits.** Each site gets "+ reclaimed by the orphan sweep (runbook)". The `tools.py` sites are named by symbol: the `_write_source_bearer` docstring and the `manage_signal_source` `credentials_ref:` param doc. A new row goes into the author-sentinel table (`config-governance.md:137-142`).
- **Strongest open objection (blocking): O-16, the cross-owner seed (C-16 @AC-35 / D-2).** The round-3 "another user's row with key B" seed either fails under the correct join or passes vacuously because of the grace window. Three old seeds are required:
  - (i) V holds U's referenced key A and has no source. It must be deleted; a key-only join would keep it.
  - (ii) V's source references K, and U holds an orphan K. U's K must be deleted.
  - (iii) V's own referenced key must survive.

  The synthesis carries this fix, and the next proposer must adopt it explicitly.
  - Non-blocking and still open: O-17 (survivor seeds per conjunct), O-18 (audit count filtered by actor), O-19 (Covers lines and RED source), O-20 (sentinel table row), O-21 (single-statement test and the `nt` check), O-22 (target database list and runbook home), O-23 (drop `rep`), O-24 (symbol-named `tools.py` sites) and O-25 (UI instantiate pin or recorded skip).
- **Floor status.** No Floor breaches. There is no migration, and `grace_hours` is a psql variable, so F-07 does not apply. D-1..D-9 are honoured and none of R-1..R-9 is reintroduced.
- **Uncovered @AC changes.** None. Every touched scenario is a PRESERVE, and `acceptance.feature` is not edited (O-9). AC-1..3 are covered by the operator's 2026-11-10 sweep ruling. These PRESERVE rows are not covered by an operator decision and must stay green: feature AC-4, ingest @AC-3, platform @AC-35, config @AC-1/2/3/14 (redaction), @AC-11/13 (per-user scoping), @AC-4/5 (GetSecret authority) and @AC-16 (GetSecret found=false).
- **Closed this round.** O-3, O-5, O-10, O-11, O-12, O-13, O-14 and O-15. Petitions P-1 and P-2 are moot, because their targets O-3 and O-5 closed on the evidence they cited.
- **Open risks.**
  - Reclaim only happens when an operator runs the sweep.
  - A credential staged longer ago than the grace window is reclaimed (documented).
  - The prod role's privileges are unverified (mitigated by the pre-check).
  - The target database list is not yet confirmed by the operator.
  - CI does not statically parse the sweep.
  - The assertion's isolation depends on the BEGIN…ROLLBACK blocks and on each script being a single statement.
  - Operator psql must be 10 or later.
  - Batch peers also edit `tools.py`.
- **Next.** The next `/sdd-batch` run resumes the debate from the state block below.

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
