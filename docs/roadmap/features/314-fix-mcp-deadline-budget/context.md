# Context Log: fix-mcp-deadline-budget

> Distilled 2026-11-21 by /sdd-distill. Full pre-distill session prose is in git history (before this commit).

Append-only except for /sdd-distill rewrites. Each session appends a new ## Session entry.
Register of record: `debate.md` (D-1..D-15, R-1..R-13, O-1..O-25); approved approach: `design.md`.

---

## Decisions

- **Scope**: one feature, no proto change; clustered from 3 SEV-2/SEV-3 defect reports (agent extract no MCP cap, list_opportunities over MCP timeout, cross-hop deadline bounds unenforced); Track C by operator decision 2026-11-10 (triage). Branch `feature/fix-mcp-deadline-budget`. Affected: agent, config, portfolio, marketdata, analysis. Config SetConfig bounds registry and agent call budgets (PLAT-13).
- **Extract budget (D-3, D-4, D-7, D-15)**: new key `agent` / `extract.call_budget_seconds`, default 35, bounds [5,35]; read once via `_agent_policy` with the non-finite/<=0 -> 35 guard; one `asyncio.timeout` scope entered after `_get_source` and attachments; per-URL catch of `httpx.TimeoutException`/`TransportError` only -> `PARTIAL: N of M URLs not fetched (deadline: a, transport: b)` + `unfetched_urls`; all-succeed stays `{raw_text}`; EgressBlocked->ToolError and HTTPStatusError propagate (AC-7 @feature-207). `extract_website_content`: `DEADLINE_EXCEEDED: ...within Ns` only when the whole-call budget expires, every `httpx.TransportError` (timeout subclasses included) is `FETCH_FAILED: <ExceptionClass>`; in `extract_email_content` a per-URL `httpx.TimeoutException` counts under `deadline`. One count-only WARN, never a URL/host (FR-6 @feature-207). Why 35 (corrected O-5): today's per-request path is connect 10 + read 30 = 40 s (redirects pay connect again), so 35 s is a NEW whole-call cap that can cut off a fetch finishing after 35 s; it is the largest value keeping auth 10 + `_get_source` 10 + 35 = 55 s under the 57 s bar. Reader default is module constant `_EXTRACT_CALL_BUDGET_DEFAULT_S = 35.0`; the 35/44 ceilings live only in the config registry (R-4).
- **Ceiling (D-2)**: `agent.opportunities.read_timeout_seconds` [30,55] -> [30,44] (10 + 3 + 44 = 57 s; 45 gives 58 s and misses AC-6 @feature-273 headroom, R-2); row comment states the invariant; injected-clock AC-2 test; fallback 43 is an operator decision if an unmodelled latency term appears (no measured real-time variant specced; zero slack would be flaky).
- **Cross-key gate (D-1, D-6, D-8, D-9)**: `CROSS_KEY_ORDERING` two rows + precomputed `CROSS_KEY_RULES_BY_KEY` map (O-17): `quote_timeout_ms` > max(`quotes.batch_timeout_ms`, `quotes.mark_timeout_ms`) (mark runs concurrently with batch); `opportunity.live_enrich_timeout_ms` > `price.batch_timeout_ms`. Strict `>` ("prevents inversion only"; `>=` rejected R-6), global writes only vs global siblings in the same environment (all readers subscribe globally), after authz + per-key gate and before the existence gate, code 3, no write; sibling read via `value_data` + `Number()`, absent/non-finite sibling skips with key-only WARN, DB error -> code 13; the sibling SELECT must not contain the text `SELECT key, is_secret` (test pool keys on it). Remedy leads with "raise the greater key" (the only always-succeeding direction: quote max 8000 > max(5000,2500); enrich max 4000 > price max 2500); offer "lower the lesser key" only when exactly one lesser key violates (O-23). Zero `pool.query` for out-of-bounds / non-admin writes (O-18). Per-key narrowing: global quote=2500 is unwritable over stored batch=2500 (@AC-1 feature-229 still passes: fake-config fixture), sanctioned by the C-16 sign-off below.
- **Migration (D-10..D-14)**: one idempotent statement of CTEs: seed (`agent`/`extract.call_budget_seconds`='35', both envs, global, full 048 column shape: value_type float, default_value '35', constraint-stating description, consuming_service xstockstrat-agent, `ON CONFLICT ... DO NOTHING RETURNING`), a single-key clamp of GLOBAL `read_timeout_seconds` > 44 -> 44 (`user_id IS NULL AND NOT is_secret`, `CASE WHEN value_data ~ re THEN value_data::numeric > 44 ELSE false END`, `caller_identity = NULL`, sentinel `system:config-migration-feature-fix-mcp-deadline-budget`), DISTINCT `pg_notify('config_changed')` over seed U heal (047.up shape; audit trigger does not notify). Per-user rows above 44 are RAISE NOTICE only (assertion file, CI only; the up stays one statement). Down deletes only the sentinel global '35' seed row, forward-only for the clamp, DISTINCT notify. Inverted pairs are NOT healed in SQL (R-11: bakes a behaviour choice into an immutable migration, F-01); operator fixes by ordered SetConfig. Clamp is single-key, value-guarded, audited, replay-safe; no replay latch (R-13 rejects dropping the clamp: a 45-55 row set in the deploy window keeps the 68 s path). Tests: static `mcpDeadlineBudgetMigration.test.ts` + `scripts/migration-assertions/config-mcp-deadline-budget.sql` (BEGIN/ROLLBACK + PREPARE copy of the clamp, pinned to the migration text by the static test; no new migration-rerun fixture hook); regenerate `scripts/config-wiring-stored.json` each time a config migration lands.
- **Migration number**: provisional `056` (trunk `...052,054,055`; 053 claimed by 345; feature 321 also specs 056 - second merger renumbers to max+1). SQL, sentinel, tests and docs are number-free. The register's `049` (D-12) and recon's `048` are stale placeholders.
- **Regex (spec-time)**: clamp matches bounded strict decimal `^[+-]?([0-9]{1,30}(\.[0-9]{0,30})?|\.[0-9]{1,30})([eE][+-]?[0-9]{1,3})?$`; read edge uses `parseFloat(row.value_data)` (`configServiceImpl.ts:935`), which accepts trailing garbage `::numeric` rejects, so no regex makes every such row castable; non-matching global rows are listed by Step 9 and fixed by operator SetConfig.
- **R7** (sandbox timeout vs ExecuteFormula deadline): no change (D-5; closed by feature 295 AC-31, client.py clamps 45 s, 45 + 10 < 60).
- **Other rejected**: URL-count cap for extract (R-3, no single-slow-URL bound); non-overlapping per-key bounds (R-1, breaks AC-1/AC-8 feature-229); copying reader defaults for absent siblings (R-5); ordering DSL/margin field (R-7); unconditional heal UPDATEs without enumeration+sign-off (R-8, fails.md:2363-2365); number-bearing sentinel (R-9); `pg_advisory_xact_lock` (R-10, F-06 2-slot pool; concurrent greater/lesser race accepted as residual).
- **Spec-time**: seed-before-reader: Step 3 adds one temporary `seeded-unread` entry to `scripts/config-wiring.json`, Step 5 (the reader) deletes it (insights.md:4681-4683). `@AC-2` RED-before-green lives in the config unit (Step 2); Step 7's agent test lands after the ceiling so its RED is a working-tree mutation of the registry row (55), restored before commit (C-08/P-06 trade-off). Doc-drift: stored description of `agent`/`opportunities.read_timeout_seconds` says `[30,55]` (`scripts/config-wiring-stored.json:154,166`) - Step 8 findings row unless the operator asks for a rewrite.
- **Steps (9)**: 1+2 config gate/ceiling/tests; 3+4 migration + assertion + static test; 5+6 agent extract budget + tests; 7 agent `@AC-2` injected-clock test; 8 docs; 9 operator-run enumeration + read-back (docs, advisory evidence). Coverage: `@AC-1` -> 6, 4; `@AC-2` -> 2, 4, 7, 9; `@AC-3` -> 2. Constitution touched: C-01, C-05, C-07, C-11, C-15, C-16, C-18, F-01, F-06, F-07, P-02, P-03, PLAT-N1; no Floor breaches.

### Operator decisions (binding, recorded 2026-11-20, verbatim)

- Operator (2026-11-20, design gate): binding conditions —
  - the clamp is scoped to global rows only (`user_id IS NULL`); per-user rows above 44 are reported with
    RAISE NOTICE, never rewritten;
  - the WHERE uses `CASE WHEN value_data ~ re THEN value_data::numeric > 44 ELSE false END`;
  - the heal scope is a read-only prod/staging enumeration at spec time with operator sign-off, and if the
    enumeration cannot be run the clamp ships and the sign-off is recorded as "unenumerated";
  - the down is forward-only for the clamp;
  - inverted pairs go to ordered operator SetConfig, not SQL.
- Operator (2026-11-20): C-16 sign-off for the CHANGEs to this feature's @AC-2, @AC-6 feature-207, @AC-2
  feature-247 and @AC-1 feature-229.
- Operator decision (2026-11-10, triage): prod-impacting SEV-2 routed to Track C (SDD path).

### Enumeration and sign-off (spec-time, 2026-11-20)

- Staging only, global rows only, read-only, via staging agent MCP `get_config`: `agent`/`opportunities.read_timeout_seconds` = `40.0` (not > 44); `portfolio`/`marketdata.quote_timeout_ms` = `4000` vs `marketdata`/`quotes.batch_timeout_ms` = `2500`, `quotes.mark_timeout_ms` = `500` (not inverted); `analysis`/`opportunity.live_enrich_timeout_ms` = `3000` vs `marketdata`/`price.batch_timeout_ms` = `2500` (not inverted); `agent`/`extract.call_budget_seconds` absent as expected.
- Not run: production, per-user rows, raw `value_data` text (tool returns parsed value), homelab staging.
- **Sign-off: "unenumerated"** until Step 9's pre-deploy run on both databases (and again post-rollout).

## Open Threads

- [ ] Operator decision - migration number: 314 and 321 both spec config migration `056`; decide merge order or renumber one now; otherwise renumber checklist at the integration PR and after every `origin/main-dev` merge. `config-wiring-stored.json` is regenerated by 314, 321, 330, 345 - regenerate after each merge, never merge by hand. (Step 3/integration PR)
- [ ] Operator decision - stale description: accept the Step 8 findings row, or ask for the `agent`/`opportunities.read_timeout_seconds` description to be rewritten (separate statement or follow-up migration; departs from design.md section 4, touches Step 4's one-statement assertions). Decide before Step 3.
- [ ] Operator go-ahead - Step 3: throwaway Postgres 16 (with `psql` and `migrate`; precedent 347 context.md:18) or the CI `config-wiring-stored` artifact to generate the stored set; without it Steps 3 + 4 are blocked (P-03).
- [ ] Operator question 1 - live `RAISE NOTICE`: left as specced (per-user rows above 44 reported by Step 9's query; reviewer found this reasonable); changes only if the operator wants the notice on live DBs (needs a second statement in the up).
- [ ] Step 9 (blocking for the integration PR): run the full read-only enumeration on staging + production (global `read_timeout_seconds` rows > 44, values the regex does not match, global inverted cross-hop pairs) pre-deploy and post-rollout; record lists + operator sign-off here (replaces "unenumerated"); inversions become ordered post-deploy SetConfig steps in config-rollout.md.
- [ ] Step 7 RED is a working-tree mutation of `configServiceImpl.ts`: record both runs here and confirm `git status --short services/xstockstrat-config/` is empty before commit.
- [ ] Cross-source regex pins (Step 2 reads agent `client.py`/`tools.py`; Steps 6, 7 read `configServiceImpl.ts`) break if either file moves - accepted; keep failure messages explicit.
- [ ] /sdd-execute: re-check migration number, dedup seed by key at the integration PR and after every `origin/main-dev` merge; re-grep every cited line (`tools.py`, `configServiceImpl.ts` also edited by features 319, 322, 328, 331 and batch peers - expect drift). Evidence tree is `origin/main-dev` @ `fb52065c`; the feature-branch-168-commits-behind precondition is satisfied (branch synced by merge commit 4d2af4ac, see /sdd-distill entry).
- [ ] Docs (Step 8): agent CLAUDE.md key table (new row, [30,55] -> [30,44]), portfolio CLAUDE.md stale batch text, config-governance.md key log, mcp-tools.md (PARTIAL, FETCH_FAILED), config-rollout.md (write order raise-greater-first, migration notify, pre-deploy re-run + POST-rollout query because the old config image (ceiling 55) accepts 45-55 writes between db-migrator and new image, unenumerated fallback), resolve findings rows `docs/context-constitution-findings.md:44`, config `:24`, portfolio `:26`.
- Open risks carried (design.md; target step): concurrent greater/lesser writes can each pass against the other's old value (accepted, R-10) [docs]; 57 s at ceiling 44 has zero slack, fallback 43 [AC-2 test]; 35 s extract cap can cut off fetches finishing at 35-40 s today [mcp-tools.md]; strict `>` prevents inversion only, portfolio can still time out just after marketdata [gate step]; cross-key rule invisible in ListKeys/config-ui [rejection message; docs]; global quote=2500 unwritable over batch=2500 (C-16 sign-off) [rejection test]; clamp changes a live global value raised above 44 after enumeration [pre-deploy re-run + audit row]; per-user rows above 44 stay stored, a future per-user watch must re-run the heal [agent CLAUDE.md]; float-syntax rows the regex misses keep the 68 s path [Step 9]; PREPARE copy can drift [static pin]; edit collisions with 319, 322, 328, 331 [integration PR]; attachment parsing is CPU-bound and outside the budget and `HTTPStatusError` still aborts the whole extract call (follow-ups, out of scope).
- Register status: O-13 and O-19..O-25 stay `open` in debate.md (operator approved at the gate instead of round 4; no status transition recorded; no rows added, no reopen petitions); all adopted in design.md and bind /sdd-spec.

## Files Modified

- none yet - no /sdd-execute step has run. Planned (implementation-spec.md): `services/xstockstrat-config/src/grpc/configServiceImpl.ts` + tests, config migration `056_mcp_deadline_budget.{up,down}.sql`, `scripts/migration-assertions/config-mcp-deadline-budget.sql`, `scripts/config-wiring.json` / `config-wiring-stored.json`, `services/xstockstrat-agent/app/tools.py` + tests, docs (agent/portfolio CLAUDE.md, config-governance.md, mcp-tools.md, config-rollout.md, findings).

## Superseded Sessions

- 2026-11-10 (/sdd-triage): bug cluster from the 3 defect reports; root-cause hypothesis per-hop/per-key budgets with no whole-call bound and no cross-key validation; R7 residual looked reshaped (`client.py:1121` `formula_deadline_s`, `configServiceImpl.ts:176`). Created status/feature/product-spec/acceptance (3 scenarios)/context; depth full (SEV-2, >=2 services, config-bound changes).
- 2026-11-10 (sdd-review product-spec): approved, draft -> spec-ready. Warnings: bug-template conventions, ceiling/budget key contract deferred to design, AC-1 'just inside 30 s' not concrete, R7 + 3 of 4 cross-hop pairs uncovered. Overlap WARN: configServiceImpl.ts SetConfig path shared with 319; agent shared with 319/322/328/331.
- 2026-11-11 (sdd-batch design gate round 2; halted at gate, design.md not written): approach superseded by round 3; closed O-2..O-4, O-6..O-11 (see debate.md), opened O-12/O-13 blocking + O-14..O-18; round-2 fence dropped as superseded (every row recoverable from debate.md and the round-3 fence below).
- 2026-11-13 (sdd-batch design gate round 3; halted at gate): closed O-5, O-12, O-14..O-18; opened blocking O-19/O-20 + O-13 remainder and O-21..O-25; round 4 was to close them but the operator approved at the 2026-11-20 gate instead. Last design state (the only `sdd-batch-design-state` fence in this file, last in file):


```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "One feature with no proto change. It honours D-1..D-11 and R-1..R-10. Parts (1)-(3) and (5) are carried forward from round 2, with the round-3 refinements listed below. Line numbers in tools.py have drifted: `_agent_policy` is now at tools.py:2685.\n\n(1) Extract whole-call budget (AC-1), in services/xstockstrat-agent/app/tools.py. This follows D-3, D-4 and D-7.\n- New key `agent` / `extract.call_budget_seconds`: default 35, bounds [5,35].\n- It is read once per call with `_agent_policy` (:2685). A non-finite or <=0 value falls back to 35, the same guard as :1766.\n- The budget is a single `asyncio.timeout` scope. It is entered after `_get_source` and after attachments.\n- Each URL has its own `try`, which catches only `httpx.TimeoutException` and `httpx.TransportError`. EgressBlocked→ToolError and HTTPStatusError propagate unchanged.\n- Partial response: `{raw_text, error: \"PARTIAL: N of M URLs not fetched (deadline: a, transport: b)\", unfetched_urls}`. When every URL succeeds, the response is still exactly `{raw_text}`.\n- `extract_website_content` uses the same budget:\n  - deadline: `ToolError(\"DEADLINE_EXCEEDED: content fetch did not complete within Ns\")`;\n  - transport failure: `ToolError(\"FETCH_FAILED: <ExceptionClass>\")`.\n- One WARN with counts and the exception class only; no URL or host is logged.\n- design.md states the corrected O-5 rationale:\n  - Today's per-request path is connect 10 + read 30 = 40 s, and each redirect pays connect again.\n  - So 35 s is a NEW whole-call cap that can cut off a fetch that currently finishes after 35 s.\n  - 35 is the largest value with auth 10 + `_get_source` 10 + 35 = 55 s, inside the 57 s bar.\n- Both error shapes are documented in docs/runbooks/mcp-tools.md.\n\n(2) list_opportunities ceiling (AC-2), config. Follows D-2.\n- In services/xstockstrat-config/src/grpc/configServiceImpl.ts, the `agent.opportunities.read_timeout_seconds` row becomes [30,44].\n- The row comment states the invariant 10 + 3 + v <= 57 s.\n- Injected-clock AC-2 test, elapsed <= 57 s. Fall back to 43 if a measured variant exceeds it.\n\n(3) Cross-key ordering (AC-3), config configServiceImpl.ts. Follows D-1, D-6, D-8 and D-9.\n- `CROSS_KEY_ORDERING` has two rows, and `CROSS_KEY_RULES_BY_KEY: ReadonlyMap` is precomputed at module load (O-17). A key in no rule issues no query.\n  - quote_timeout_ms > max(quotes.batch_timeout_ms, quotes.mark_timeout_ms).\n  - opportunity.live_enrich_timeout_ms > price.batch_timeout_ms.\n- The gate runs after authz and the per-key gate (:750-760) and before the existence gate. It applies to global writes only, uses strict >, and sends code 3 with no write.\n- The rejection message and the config-rollout.md remedy LEAD WITH \"raise the greater key\". That is the only direction that always succeeds:\n  - quote max 8000 > max(5000, 2500);\n  - enrich max 4000 > price max 2500.\n- They offer \"lower <lesser key> first\" only when exactly one lesser key violates.\n- Tests in setConfigScalarBounds.test.ts:\n  - AC-3, reverse direction, the enrich pair, per-user skip, absent sibling and unparseable sibling;\n  - the O-14 narrowing: global quote=2500 over stored batch=2500 is rejected with the remedy text, and design.md states that @AC-1 feature-229 still passes because its fixture is a fake config;\n  - O-18: zero `pool.query` calls for an out-of-bounds write and for a non-admin write to a cross-key member.\n\n(4) Migration, config. It is `049_mcp_deadline_budget` today, because 048 is taken by feature 334 (048_webhook_fanout_callback_keys). At merge it becomes max(origin/main-dev)+1, deduped by key. The number-free sentinel `system:config-migration-feature-fix-mcp-deadline-budget` (D-11) keeps a renumber to file renames.\n\n049.up is one idempotent statement made of CTEs:\n- **seed**: `agent` / `extract.call_budget_seconds` = '35', staging and production, global.\n  - Full 048 column shape: `value_type 'float'`, `default_value '35'` (equal to the `_agent_policy` literal default), a constraint-stating description, and `consuming_service 'xstockstrat-agent'`.\n  - `ON CONFLICT (namespace, key, environment, COALESCE(user_id,'')) DO NOTHING RETURNING namespace, environment`.\n- **heal**, a single-key clamp scoped to GLOBAL rows only:\n  - `UPDATE config.config_values SET value_data='44', updated_by=<sentinel>, update_reason='feature fix-mcp-deadline-budget: clamp to MCP-safe ceiling', caller_identity=NULL`\n  - `WHERE namespace='agent' AND key='opportunities.read_timeout_seconds' AND user_id IS NULL AND NOT is_secret AND CASE WHEN value_data ~ '<numeric re>' THEN value_data::numeric > 44 ELSE false END`\n  - `RETURNING namespace, environment`.\n  - Why global-only: the agent's WatchConfigRequest carries no user_id (app/config/watcher.py:49-53), so per-user rows are never read. The per-user count is reported with RAISE NOTICE only, as in config-046.sql:78-85.\n  - Why the CASE: Postgres does not guarantee qual evaluation order, so a bare `value_data::numeric` could abort the migration on a non-numeric row.\n  - The regex is either widened to match Python float() syntax, or the spec-time enumeration lists every non-matching row.\n- **nt**: `SELECT pg_notify('config_changed', json_build_object('namespace', t.namespace, 'environment', t.environment)::text) FROM (SELECT DISTINCT namespace, environment FROM (seed UNION ALL heal) u) t`. This is the 047.up:57-61 shape (D-10). Nothing touched means no notify.\n- **Replay safety**: the migration-rerun replay of 049 is safe. The seed is DO NOTHING, and the clamp is value-guarded and kept a no-op by the new ceiling.\n\n049.down:\n- It deletes only seed rows matching the sentinel, `user_id IS NULL`, the key and value '35' (the 048.down:4-13 shape).\n- It is forward-only for the clamp.\n- It ends with the same DISTINCT pg_notify over the delete's RETURNING (047.down:23-24).\n\nInverted cross-hop pairs are NOT healed in SQL. The operator fixes them by ordered SetConfig, which the gate admits (\"raise the greater key\"), and SetConfig audits and notifies them itself (configServiceImpl.ts:841).\n\nSpec-time, read-only staging and prod enumeration, blocking for /sdd-spec:\n- (a) global `opportunities.read_timeout_seconds` rows > 44, plus any non-matching value;\n- (b) global inverted pairs.\n- The lists and the operator's sign-off go into context.md:\n  - The clamp ships in its defensive form even when (a) is empty.\n  - Any inversions become an ordered post-deploy SetConfig step in config-rollout.md.\n- If the enumeration cannot be run, ship the clamp, record the sign-off as \"unenumerated\", and keep the down forward-only.\n- config-rollout.md also gets:\n  - a pre-deploy re-run of query (a);\n  - a POST-rollout verification query, because the old config image (ceiling 55) accepts 45-55 writes between the db-migrator run and the new image going live.\n\nTests:\n- `services/xstockstrat-config/src/__tests__/mcpDeadlineBudgetMigration.test.ts`, static SQL, servabilitySeedMigrations style. It asserts:\n  - the seed row's shape and sentinel;\n  - `user_id IS NULL` and the CASE guard in the clamp;\n  - DISTINCT notify in up and down;\n  - the down deletes only the sentinel '35' row and does not un-clamp;\n  - a pin that the PREPARE copy matches the 049 clamp text.\n- `scripts/migration-assertions/config-mcp-deadline-budget.sql` uses the webhook-fanout-callback.sql pattern: BEGIN … ROLLBACK, insert rows, then PREPARE a verbatim copy of the clamp. This is needed because fixtures load before the heal chain by hard-coded name (migration-rerun.py:687-690), so a fresh DB has no row > 44. Cases:\n  - global 55→44 and 44.5→44;\n  - global 40 untouched;\n  - per-user 50 untouched;\n  - non-numeric untouched, with no error;\n  - caller_identity becomes NULL;\n  - the audit row has changed_by = sentinel.\n- Regenerate `scripts/config-wiring-stored.json`.\n\n(5) Docs:\n- agent CLAUDE.md key table: the new row, and [30,55] becomes [30,44];\n- the stale batch text in portfolio CLAUDE.md;\n- the config-governance.md per-feature key log;\n- mcp-tools.md: PARTIAL and FETCH_FAILED;\n- config-rollout.md: the write order with \"raise the greater key\" first, that 049 notifies, the pre- and post-deploy queries, and the unenumerated fallback;\n- resolve the findings rows: docs/context-constitution-findings.md:44, config :24, portfolio :26.\n\nR7 needs no change (D-5).\n\nBuild order:\n- (a) config gate, ceiling and tests;\n- (b) the spec-time enumeration and sign-off, then 049 and its tests;\n- (c) agent extract budget, with the AC-1 and AC-2 tests;\n- (d) docs.\n\nCoordinate the tools.py and configServiceImpl.ts edits with features 319, 322, 328 and 331.",
    "open_objections": [
      {
        "text": "O-13 (carried): The heal scope needs a spec-time prod/staging enumeration with operator sign-off in context.md, and 049.down must be forward-only for the clamp. The proposal now drops the SQL heal for inverted pairs (they go to ordered operator SetConfig) and adds the sign-off. It stays open until the proposer adopts the global-only scope (O-19), the CASE guard (O-20) and the stated fallback for when the enumeration cannot be run (ship the clamp, record the sign-off as 'unenumerated').",
        "blocking": true
      },
      {
        "text": "O-19: The 049 clamp must be scoped to `user_id IS NULL`. The agent's WatchConfigRequest carries no user_id (services/xstockstrat-agent/app/config/watcher.py:49-53), so per-user rows are never read, and rewriting them is an unneeded mutation (fails.md:2363-2365). Replace the 'per-user 50→44' test case with 'per-user 50 untouched', and report per-user rows above 44 with RAISE NOTICE only (config-046.sql:78-85).",
        "blocking": true
      },
      {
        "text": "O-20: The clamp WHERE `value_data ~ re AND value_data::numeric > 44` depends on qual evaluation order, which Postgres does not guarantee. A non-numeric row could abort 049 mid-deploy. Use `CASE WHEN value_data ~ re THEN value_data::numeric > 44 ELSE false END`. Then either widen the regex to the syntax Python float() accepts (tools.py `_agent_policy` cast), or have the spec-time enumeration list every non-matching row.",
        "blocking": true
      },
      {
        "text": "O-21: The real-DB assertion cannot observe a pre-049 row as described. Fixtures load by hard-coded name before the heal chain (scripts/migration-rerun.py:687-690), so a fresh DB has no row above 44. Use the webhook-fanout-callback.sql pattern: BEGIN…ROLLBACK plus a PREPARE that is a verbatim copy of the clamp, with a static test in mcpDeadlineBudgetMigration.test.ts that pins the copy to the 049 text.",
        "blocking": false
      },
      {
        "text": "O-22: The audit trigger records NEW.caller_identity (017_config_secrets_and_scoping.up.sql:69-74). The clamp must SET caller_identity = NULL so the audit row does not attribute the migration to the row's previous internal caller.",
        "blocking": false
      },
      {
        "text": "O-23: The rejection remedy and the ordered config-rollout.md step must lead with 'raise the greater key'. Lowering a lesser key fails in two cases: when both batch and mark invert quote, and when enrich=500 equals the price min of 500 (configServiceImpl.ts:144,149). Offer 'lower the lesser key' only when exactly one lesser key violates.",
        "blocking": false
      },
      {
        "text": "O-24: The old config image (ceiling 55) accepts 45-55 writes between the db-migrator's 049 run and the new image going live. config-rollout.md needs a post-rollout verification query in addition to the pre-deploy re-run.",
        "blocking": false
      },
      {
        "text": "O-25: Specify the full seed row in the 048 column shape: value_type 'float'; default_value '35', equal to the `_agent_policy` literal default; a constraint-stating description; consuming_service 'xstockstrat-agent'. That keeps check-config-wiring.mjs defaultMatches and the ListKeys metadata consistent.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1 (feature 314)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 (feature 314)",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3 (feature 314)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-6 feature-273",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-7 feature-207",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-8 feature-207",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-6 feature-207",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 feature-247",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-1 feature-229",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-8 feature-229",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4 feature-184",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-25 feature-295",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-31 feature-295",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "readiness-materializer-config-keys: bounds are write-path only",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Non-overlapping per-key bounds for the cross-hop keys (R-1): these break @AC-1 or @AC-8 feature-229.",
      "Ceiling 45 (R-2): the 58 s worst case misses the 3 s headroom of AC-6 @feature-273.",
      "URL-count cap for extract (R-3): it does not bound a single slow URL.",
      "Agent-side clamp of read_timeout_seconds (R-4): it duplicates the ceiling literal.",
      "Copying reader defaults for absent siblings (R-5): it duplicates cross-language defaults.",
      "Gating with >= (R-6): it allows equal deadlines, i.e. inversion at the boundary.",
      "Ordering DSL or per-row margin field (R-7): YAGNI.",
      "Unconditional heal UPDATEs without enumeration or sign-off (R-8): fails.md:2363-2365.",
      "Number-bearing sentinel (R-9): a renumber would rewrite the SQL and test literals.",
      "pg_advisory_xact_lock serialization (R-10): F-06 pool pressure.",
      "A SQL heal of inverted cross-hop pairs, even with an operator-picked direction (the round-2 Heal 2): it bakes a behaviour choice into an immutable migration. SetConfig already makes the corrective write with audit and notify.",
      "Clamping read_timeout_seconds in every user_id scope: the agent watches global config only (watcher.py:49-53), so per-user rows are unread. Rewriting them is an unneeded mutation of user-owned rows.",
      "Dropping the SQL clamp entirely and relying on enumeration plus SetConfig: a row set to 45-55 in the deploy window survives, and the 68 s path stays live. The clamp is single-key, value-guarded and audited.",
      "A new pre-049 fixture hook in migration-rerun.py: it adds a pass to an already complex runner. The PREPARE-copy assertion pinned by a static test is local and sufficient.",
      "A latch marker for the clamp's replay: unnecessary, because the value guard plus the new ceiling make replay a no-op."
    ],
    "open_risks": [
      "Concurrent writes to a greater key and a lesser key can each pass against the other's old value. This is an accepted residual (R-10).",
      "The 57 s worst case at ceiling 44 leaves zero slack. An unmodelled latency term breaks AC-6; the fallback is 43.",
      "The 35 s extract cap can cut off fetches that complete between 35 and 40 s or later today.",
      "Strict > without a margin prevents inversion only. Portfolio can still time out just after marketdata.",
      "The cross-key rule is invisible in ListKeys and config-ui; operators discover it on rejection.",
      "Global quote=2500 becomes unwritable while the global batch is 2500 (a narrowing of @AC-1 feature-229 framing). No operator decision sanctions it yet.",
      "The clamp changes a live global value if an operator raised it above 44 after the spec-time enumeration. Mitigated by the pre-deploy re-run, the post-rollout query and the audit row.",
      "Old config image window: 45-55 writes are accepted between the db-migrator run and the new image going live.",
      "Per-user read_timeout_seconds rows above 44 stay stored. They are harmless while the agent watches global only, but a future per-user watch must re-run the heal.",
      "Rows in float syntax that the regex does not match keep the 68 s path unless the regex is widened or the rows are enumerated.",
      "The PREPARE copy in the assertion file can drift from 049 unless the static pin test holds.",
      "Edit collisions in tools.py and configServiceImpl.ts with features 319, 322, 328 and 331, and a migration-number race at merge (049 today).",
      "The attachment parse path is CPU-bound and stays outside the budget.",
      "HTTPStatusError still aborts the whole extract call. Folding it into the partial result is a follow-up."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-05",
      "C-07",
      "C-11",
      "C-15",
      "C-16",
      "C-18",
      "F-01",
      "F-06",
      "F-07",
      "P-02",
      "P-03",
      "PLAT-N1"
    ],
    "rationale": "I verified the adversary's evidence against the tree:\n\n- **watcher.py:49-53.** `_build_watch_request` sends only namespace, client_id and environment. `_agent_policy` (tools.py:2685) reads via `read_config_value`, which is that global snapshot. So the proposal's premise for an all-scope clamp is false, and the per-user clamp is an unneeded mutation of the kind fails.md:2363-2365 warns about.\n- **017.up:69-74.** The audit trigger writes NEW.updated_by/update_reason, which confirms the proposer's assumption. It also writes NEW.caller_identity, which the clamp must reset.\n- **migration-rerun.py:687-690.** Fixtures load by hard-coded name. The webhook-fanout-callback.sql PREPARE-copy pattern exists (\"Each PREPARE body is a copy of the statement its source ships\").\n- **048_webhook_fanout_callback_keys** exists, so 049 is correct (C-07). D-10 and D-11 used 048 as a placeholder, so no D-n changes.\n\nClosed this round, because the proposal answered them concretely:\n\n- O-12: a notify CTE over the seed ∪ heal RETURNING in up, and over the delete RETURNING in down, in the 047 shape, asserted in tests.\n- O-5: corrected 40 s reasoning.\n- O-14: the narrowing is stated, plus a rejection test. The remedy wording gap is split out as O-23.\n- O-15: PARTIAL and FETCH_FAILED shapes.\n- O-16: sentinel.\n- O-17: precomputed map.\n- O-18: zero-query assertions.\n\nO-13 stays open. Dropping the SQL heal for inverted pairs and adding sign-off answer most of it. The global-only scope, the CASE guard and the fallback for an unrunnable enumeration are folded into the synthesized approach, but the proposer has not yet adopted them, so they are tracked as blocking O-19 and O-20 plus the O-13 remainder.\n\nTwo new decisions are recorded:\n\n- the SQL-free remediation of inverted pairs;\n- the forward-only seed-scoped down.\n\nTwo alternatives are newly locked:\n\n- the SQL inverted-pair heal;\n- the all-scope clamp.\n\nBoth rest on verified evidence and are consistent with D-6 and R-8. No D-n, R-n or closed O-n is contradicted. No Floor breach.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "The migration is config 049_mcp_deadline_budget on this tree, because 048 is taken by feature 334. At merge it is renumbered to max(origin/main-dev)+1, deduped by key. The number-free sentinel (D-11) limits the renumber to file renames.",
          "evidence": "services/xstockstrat-config/migrations/048_webhook_fanout_callback_keys.{up,down}.sql exist; fails.md 2026-11-10 fix-analysis-live-loop-budget-seed."
        },
        {
          "text": "Inverted cross-hop pairs are not healed in SQL. The operator remediates them with ordered SetConfig writes after deploy, recorded in config-rollout.md from the spec-time enumeration. SetConfig audits and notifies them.",
          "evidence": "configServiceImpl.ts:750-760 (the gate admits the corrective write), :841 (notify); F-01 (immutable migration would bake in a behaviour choice); fails.md:2363-2365."
        },
        {
          "text": "049.down deletes only the sentinel-scoped, global seed row with value '35', in the 048.down shape. It is forward-only for the read_timeout clamp, and it ends with a DISTINCT pg_notify over the deleted rows.",
          "evidence": "048_webhook_fanout_callback_keys.down.sql:4-13; 047_config_alias_removal_rows.down.sql:23-24; fails.md:2363-2365."
        },
        {
          "text": "The extract partial result uses error 'PARTIAL: N of M URLs not fetched (deadline: a, transport: b)'. extract_website_content raises 'DEADLINE_EXCEEDED: …within Ns' on the budget and 'FETCH_FAILED: <ExceptionClass>' on a transport failure. Both shapes are documented in mcp-tools.md.",
          "evidence": "A fast httpx.TransportError is not a deadline (O-15); tools.py extract path; FR-6 @feature-207 (no URL echoed)."
        }
      ],
      "new_rejected": [
        {
          "text": "A SQL heal of inverted cross-hop timeout pairs in the migration, even with an operator-picked direction",
          "why": "It bakes a behaviour choice (lengthen user latency or shorten the cold fetch) into an immutable migration (F-01). SetConfig already performs the corrective write with audit and notify."
        },
        {
          "text": "Clamping agent opportunities.read_timeout_seconds in all user_id scopes",
          "why": "The agent's WatchConfigRequest carries no user_id (watcher.py:49-53), so per-user rows are never read. Rewriting them is an unneeded mutation of user-owned rows (fails.md:2363-2365, D-6)."
        },
        {
          "text": "Dropping the read_timeout clamp from the migration entirely and relying on enumeration plus operator SetConfig",
          "why": "A row set to 45-55 in the deploy window survives and keeps the 68 s path live. The clamp is single-key, value-guarded, audited and replay-safe."
        }
      ],
      "new_objections": [
        {
          "text": "O-19: Scope the 049 clamp to user_id IS NULL. The agent watches global config only (watcher.py:49-53). Test that per-user 50 is untouched, and report per-user rows above 44 with RAISE NOTICE only (config-046.sql:78-85).",
          "blocking": true
        },
        {
          "text": "O-20: Guard the clamp cast with CASE WHEN value_data ~ re THEN value_data::numeric > 44 ELSE false END, because qual order is not guaranteed. Then either widen the regex to Python float() syntax, or have the enumeration list every non-matching row.",
          "blocking": true
        },
        {
          "text": "O-21: The real-DB assertion must use the webhook-fanout-callback.sql BEGIN/ROLLBACK + PREPARE-copy pattern, pinned to the 049 text by a static test. Fixtures load before the heal chain (migration-rerun.py:687-690).",
          "blocking": false
        },
        {
          "text": "O-22: The clamp must SET caller_identity = NULL; the audit trigger records NEW.caller_identity (017.up:69-74).",
          "blocking": false
        },
        {
          "text": "O-23: The rejection remedy and the rollout step lead with 'raise the greater key'. Offer 'lower the lesser key' only when exactly one lesser key violates (configServiceImpl.ts:144,149; quote vs max(batch, mark)).",
          "blocking": false
        },
        {
          "text": "O-24: Add a post-rollout verification query to config-rollout.md. The old image (ceiling 55) accepts 45-55 writes between the 049 run and the new config image going live.",
          "blocking": false
        },
        {
          "text": "O-25: Seed row in the full 048 column shape: value_type 'float', default_value '35' equal to the _agent_policy default, a constraint-stating description, consuming_service 'xstockstrat-agent' (check-config-wiring.mjs defaultMatches).",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-5",
          "how": "design.md states that the per-request path today is connect 10 + read 30 = 40 s (redirects pay connect again), so 35 s is a new whole-call cap. It is the largest value that keeps auth 10 + _get_source 10 + 35 = 55 s."
        },
        {
          "id": "O-12",
          "how": "049.up ends with a DISTINCT (namespace, environment) pg_notify CTE over the seed ∪ heal RETURNING (047.up:57-61), and 049.down does the same over the delete RETURNING (047.down:23-24). Both are asserted in the migration tests."
        },
        {
          "id": "O-14",
          "how": "design.md states the strict-> narrowing (quote=2500 is unwritable over batch=2500; the @AC-1 feature-229 fake-config fixture still passes), and a code-3 rejection test with the remedy text is added. The remedy direction wording is tracked in O-23."
        },
        {
          "id": "O-15",
          "how": "Adopted 'PARTIAL: N of M URLs not fetched (deadline: a, transport: b)' and FETCH_FAILED vs DEADLINE_EXCEEDED in extract_website_content, both documented in mcp-tools.md."
        },
        {
          "id": "O-16",
          "how": "updated_by is system:config-migration-feature-fix-mcp-deadline-budget (config-governance.md:142)."
        },
        {
          "id": "O-17",
          "how": "CROSS_KEY_RULES_BY_KEY ReadonlyMap is built once at module load from the two-row CROSS_KEY_ORDERING. A key in no rule issues no query."
        },
        {
          "id": "O-18",
          "how": "setConfigScalarBounds.test.ts asserts pool.query call count 0 for an out-of-bounds write and a non-admin global write to marketdata.quotes.batch_timeout_ms."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

- 2026-11-20 (sdd-design, approved): recon.md written 2026-11-11; 3 full rounds, terminated by operator approval at the gate, Floor clear; wrote design.md, debate.md State -> approved, spec-ready -> design-approved. Chosen approach = Decisions above; operator binding conditions and C-16 sign-off are recorded verbatim under Decisions. Register state: no rows added, O-13/O-19..O-25 left `open` (see Open Threads).

## Session 2026-11-20 — sdd-spec

- Generated implementation-spec.md with 9 steps. Status: design-approved → implementation-ready.
- Evidence tree: `origin/main-dev` @ `fb52065c`. The feature branch tip (`1640bc78`) is 168 commits behind it
  (config migrations stop at `047`), so the spec's precondition is to merge `origin/main-dev` into
  `feature/fix-mcp-deadline-budget` before Step 1 and re-grep every cited line.
- Steps: 1+2 config gate, ceiling and tests (one unit); 3+4 config migration `056_mcp_deadline_budget`,
  assertion file and static test (one unit); 5+6 agent extract budget and tests (one unit); 7 agent `@AC-2`
  injected-clock test; 8 docs; 9 operator-run enumeration and read-back.
- Scenario coverage: `@AC-1` → Steps 6, 4; `@AC-2` → Steps 2, 4, 7, 9; `@AC-3` → Step 2.

### Enumeration and sign-off (operator condition, design gate 2026-11-20)

- Run: staging only, global rows only, read-only, through the staging agent MCP `get_config` on 2026-11-20.
  - `agent` / `opportunities.read_timeout_seconds` = `40.0` (float) — not above 44.
  - `portfolio` / `marketdata.quote_timeout_ms` = `4000`; `marketdata` / `quotes.batch_timeout_ms` = `2500`,
    `quotes.mark_timeout_ms` = `500` — not inverted (4000 > 2500).
  - `analysis` / `opportunity.live_enrich_timeout_ms` = `3000`; `marketdata` / `price.batch_timeout_ms` =
    `2500` — not inverted.
  - `agent` / `extract.call_budget_seconds` is absent, as expected before the seed.
- Not run: production (no read path from this session); per-user rows in either environment; the raw
  `value_data` text (the tool returns the parsed value, so a spelling the regex does not match cannot be
  seen); the homelab staging deployment.
- **Sign-off: "unenumerated".** No operator sign-off on an enumeration was obtained in this run. Per the
  operator condition the clamp ships in its defensive form and the down stays forward-only. Step 9 runs the
  full query on both databases before the integration PR merges and again after the rollout, and replaces or
  confirms this sign-off.
- No inverted pair was found on staging, so the spec carries no ordered post-deploy `SetConfig` list. Step 9
  re-checks both environments.

### Spec-time decisions

- Migration number `056`: trunk holds `…052, 054, 055`; `053` is claimed by feature 345 (not on trunk). The
  number is provisional until merge; the SQL, sentinel, tests and docs are number-free.
- Regex (the open "widen vs enumerate" thread): the clamp matches a bounded strict decimal,
  `^[+-]?([0-9]{1,30}(\.[0-9]{0,30})?|\.[0-9]{1,30})([eE][+-]?[0-9]{1,3})?$`. The read edge uses
  `parseFloat(row.value_data)` (`configServiceImpl.ts:935`), which accepts trailing garbage that `::numeric`
  rejects, so no regex makes every such row castable. Non-matching global rows are listed by Step 9's query
  and fixed by operator `SetConfig`.
- Seed-before-reader: Step 3 adds one temporary `seeded-unread` entry to `scripts/config-wiring.json`; Step 5
  (the reader) deletes it (insights.md:4681-4683).
- `@AC-2` red-before-green: the cycle is in the config unit (Step 2). Step 7's agent test lands after the
  ceiling, so its RED is a working-tree mutation of the registry row (55), restored before commit.
- `extract_website_content`: only the whole-call budget expiring is `DEADLINE_EXCEEDED`; every
  `httpx.TransportError`, timeout subclasses included, is `FETCH_FAILED: <ExceptionClass>`. In
  `extract_email_content` a per-URL `httpx.TimeoutException` counts under `deadline`.
- The reader default is a module constant `_EXTRACT_CALL_BUDGET_DEFAULT_S = 35.0` in `tools.py`; the 35 and 44
  ceilings live only in the config registry (R-4).

### Key codebase findings

- `tests/test_tools.py:2472-2477` asserts the exact set of policy keys an extract call reads; the new budget
  read adds a fifth, which is why Steps 5 + 6 are one unit.
- `setConfigScalarBounds.test.ts:276` and `:370-378` pin the 55 ceiling; they change with the registry row
  (Steps 1 + 2 are one unit). The suite's recording pool keys on `SELECT key, is_secret`, so the gate's
  sibling read must not contain that text.
- `tools.py` does not import `httpx` today (`app/egress.py:16` does); Step 5 adds the import.
- `scripts/config-wiring-stored.json` must be regenerated on a scratch Postgres 16 with `psql` and `migrate`
  (CI job `config-wiring-stored`); without it `check-config-wiring --final` fails `STALE-STORED`.
- A file named `config-mcp-deadline-budget.sql` under `scripts/migration-assertions/` runs after all
  migrations (`scripts/migration-rerun.py:562-572`); no test pins a PREPARE copy to its source today, so
  Step 4's pin is new.
- No `agent.extract.*` row exists in `SCALAR_BOUNDS_REGISTRY`; Step 1 adds `[5,35]` for the new key.

### Open Threads

- **For impl-spec review / the operator**:
  - The `RAISE NOTICE` for per-user rows above 44 is in the assertion file (CI only), following
    `config-046.sql:78-86`, because design.md keeps the up migration a single statement. The live count is
    reported by Step 9's query. Emitting it on the live databases would need a second statement in the up.
  - The stored description of `agent` / `opportunities.read_timeout_seconds` still says "SetConfig-bounded
    `[30,55]`" (`scripts/config-wiring-stored.json:154,166`). design.md's clamp does not rewrite descriptions,
    so it stays stale unless the operator asks for it.
  - The enumeration sign-off is "unenumerated" until Step 9's pre-deploy run.
- **For /sdd-execute**:
  - Step 3 needs a throwaway Postgres to generate the stored set; starting one needs the operator's go-ahead
    (precedent: 347 context.md:18), or use the CI artifact.
  - Re-check the migration number and dedup the seed by key at the integration PR and after every
    `origin/main-dev` merge; regenerate the stored set each time another config migration arrives.
  - `tools.py` and `configServiceImpl.ts` are also edited by features 319, 322, 328, 331 and by batch peers;
    expect line drift.
  - A fallback to ceiling 43 is an operator decision if an unmodelled latency term shows up; no measured
    real-time `@AC-2` variant is specced (zero slack at 44 would make it flaky).
- Design risks carried unchanged: attachment parsing stays outside the budget; `HTTPStatusError` still aborts
  the whole extract call (both out of scope, follow-ups).

## Session 2026-11-20 — sdd-review impl-spec (advisory)

- Criteria verdict: PASS WITH WARNINGS (0 fails, 9 warnings, no Floor breach). Overlap verdict: FAIL — one
  config migration NNN collision. Lifecycle unchanged (`implementation-ready`).
- Claims re-verified on `origin/main-dev` @ `fb52065c` and `origin/feature/fix-trading-config-plumbing`
  before editing implementation-spec.md.

### Addressed (implementation-spec.md edited)

- **Config-key wiring test** (`agent` / `extract.call_budget_seconds`): Step 6 gains a real-reader case —
  no `_agent_policy` patch; `install_watcher(monkeypatch, "agent", …)` (`tests/test_config_watcher.py:46-50`,
  imported as in `tests/test_formula_deadline.py:10`) sets `12.0` and `_extract_call_budget_s()` must return
  it, and `35.0` when the key is absent (autouse `config_snapshots`, `tests/conftest.py:145-163`).
- **Step 9 category**: re-labelled `test` → `docs` (operator-run, results in context.md), `Covers` set to
  none, and the C-15 table marks it advisory evidence. The automated `@AC-2` gates stay Steps 2, 4 and 7.
- **`grep -c … # expect 0`** (exits 1 on a zero count): Step 3 (the `.down.sql` check) and Step 5 (the
  `scripts/config-wiring.json` check) now use `! grep -q …`.
- **Migration `056` collision**: recorded in decision 1 and the renumber checklist. Feature 321
  `fix-trading-config-plumbing` (`implementation-ready`, not on trunk) also specs `056`
  (`056_trading_broker_paper_per_environment`, its implementation-spec.md:630-631). Trunk tip is still
  `…052, 054, 055`. Neither spec is renumbered now; the second merger renumbers to max + 1.
- **Stale description** (operator question 2): the default is now a config findings row in Step 8
  (doc-drift: the stored text says `[30,55]`, the enforced bound is `[30,44]`), so it is not left silent.
- **Step 3 Postgres dependency**: § Step Dependencies now says to settle the route (scratch Postgres with
  the operator's go-ahead, or the CI `config-wiring-stored` artifact) at the /sdd-execute confirmation,
  before Step 1.
- **Step 7 RED**: the spec now states that the committed history holds no red-before-green for this test,
  and names instruction 2's `55` → `> 57` check as the committed regression evidence.

### Open Threads

- **Operator decision — migration number.** 314 and 321 both spec config migration `056`. Decide the merge
  order (or renumber one spec now); until then the renumber checklist runs at the integration PR and after
  every `origin/main-dev` merge. `scripts/config-wiring-stored.json` is regenerated by 314, 321, 330 and 345
  — regenerate after each merge, never merge it by hand.
- **Operator decision — stale description.** Accept the Step 8 findings row, or ask for the description of
  `agent` / `opportunities.read_timeout_seconds` to be rewritten (a separate statement or a follow-up
  migration; departs from design.md § 4 and touches the one-statement assertions in Step 4). Decide before
  Step 3.
- **Operator go-ahead — Step 3.** A throwaway Postgres 16 (with `psql` and `migrate`) or the CI artifact is
  needed to generate the stored set; without one Steps 3 + 4 are blocked (P-03).
- **Operator question 1 — live `RAISE NOTICE`.** Left as specced: the up migration stays one statement and
  Step 9's query reports per-user rows above 44. The reviewer found this reasonable; it changes only if the
  operator wants the notice on the live databases.
- **Step 7 RED is a working-tree mutation** of `configServiceImpl.ts` (C-08 / P-06 trade-off, decision 6).
  It depends on executor discipline: record both runs here and confirm `git status --short
  services/xstockstrat-config/` is empty before the commit.
- **Cross-source regex pins** (Step 2 reads agent `client.py` / `tools.py`; Steps 6 and 7 read
  `configServiceImpl.ts`) break if either file moves. Accepted (precedent exists); keep the failure
  messages explicit.
- **Evidence tree**: the feature branch is 168 commits behind `origin/main-dev`; merge it before Step 1 and
  re-grep every cited `path:line`.
- The enumeration sign-off is still "unenumerated" until Step 9's pre-deploy run.

## Session 2026-11-21 — /sdd-distill

- Distilled 7 sessions -> header + Superseded Sessions; kept 2 verbatim.
- context.md 865 -> 478 lines (75253 -> 53257 bytes). Original prose preserved in git history.
- Branch note: the feature branch was synced with main-dev (merge commit 4d2af4ac) before this distill, so the 'merge origin/main-dev before Step 1 (168 commits behind)' precondition in the kept sessions above is satisfied; re-grep of cited lines is still required.
- Dropped the superseded round-2 `sdd-batch-design-state` fence (fully recoverable from debate.md and the round-3 fence); the round-3 fence is the sole, last fence, byte-identical.