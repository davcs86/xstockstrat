# Design: fix-mcp-deadline-budget

**Created**: 2026-11-20
**Rounds**: 3 (full; termination: approved)
**Approved by**: user @ 2026-11-20 (operator approval at the design gate, with binding conditions — see context.md, Session 2026-11-20)
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

One feature, no proto change (recon.md:134). It honours D-1..D-15 and R-1..R-13 in debate.md.

Line numbers in `services/xstockstrat-agent/app/tools.py` have drifted since recon: `_agent_policy` is at
`tools.py:2685` on the round-3 tree (recon.md:34 records `:2668`). `/sdd-spec` re-greps every site.

**Consumer surface (C-14).** Agent tools `extract_email_content`, `extract_website_content` and
`list_opportunities`, and the `SetConfig` write edge (agent `set_config` tool and config-ui). No UI change.

### Operator conditions (binding, 2026-11-20)

These were set at the gate and override anything looser below or in the register:

- The clamp is scoped to global rows only (`user_id IS NULL`). Per-user rows above 44 are reported with
  `RAISE NOTICE` and never rewritten.
- The clamp's WHERE uses `CASE WHEN value_data ~ re THEN value_data::numeric > 44 ELSE false END`.
- The heal scope is a read-only prod/staging enumeration at spec time with operator sign-off. If the
  enumeration cannot be run, the clamp ships and the sign-off is recorded as "unenumerated".
- The down migration is forward-only for the clamp.
- Inverted pairs go to ordered operator `SetConfig`, not SQL.
- The migration number is the next free config migration above the main-dev tip at spec time (main-dev now
  holds 055). The register's `049` (D-12) is the round-3 placeholder; this document writes `<NNN>`.

### 1. Extract whole-call budget (AC-1) — agent `tools.py`

Follows D-3, D-4, D-7 and D-15. Today the URL loop is serial with no whole-call cap and no per-URL catch
(recon.md:23-27), and every `_fetch_url` bound is per request (recon.md:29-33).

- New key `agent` / `extract.call_budget_seconds`: default 35, bounds [5,35].
- It is read once per call with `_agent_policy` (recon.md:34). A non-finite or <= 0 value falls back to 35, the
  same guard `list_opportunities` uses (recon.md:35-39).
- The budget is a single `asyncio.timeout` scope, entered after `_get_source` and after attachments.
- Each URL has its own `try`, which catches only `httpx.TimeoutException` and `httpx.TransportError`.
  `EgressBlocked` → `ToolError` and `HTTPStatusError` propagate unchanged.
- Partial response: `{raw_text, error: "PARTIAL: N of M URLs not fetched (deadline: a, transport: b)",
  unfetched_urls}`. When every URL succeeds the response is still exactly `{raw_text}` (recon.md:156).
- `extract_website_content` (recon.md:28) uses the same budget:
  - deadline: `ToolError("DEADLINE_EXCEEDED: content fetch did not complete within Ns")`;
  - transport failure: `ToolError("FETCH_FAILED: <ExceptionClass>")`.
- One WARN with counts and the exception class only; no URL or host is logged.
- Why 35 (the corrected O-5 rationale):
  - Today's per-request path is connect 10 + read 30 = 40 s, and each redirect pays connect again
    (recon.md:29-33).
  - So 35 s is a **new** whole-call cap that can cut off a fetch that currently finishes after 35 s.
  - 35 is the largest value with auth 10 + `_get_source` 10 + 35 = 55 s, inside the 57 s bar (recon.md:40,
    recon.md:109).
- Both error shapes are documented in `docs/runbooks/mcp-tools.md`.
- AC-1 needs a new trickling-bytes harness; none exists (recon.md:157).

### 2. `list_opportunities` ceiling (AC-2) — config

Follows D-2.

- In `services/xstockstrat-config/src/grpc/configServiceImpl.ts`, the `agent.opportunities.read_timeout_seconds`
  row becomes [30,44] (recon.md:50, recon.md:88).
- The row comment states the invariant 10 + 3 + v <= 57 s (recon.md:35-40, recon.md:147).
- Injected-clock AC-2 test, elapsed <= 57 s, built on the hung-server template (recon.md:91-95). Fall back to 43
  if a measured variant exceeds it.
- `_RPC_TIMEOUT_S` does not move (recon.md:88).

### 3. Cross-key ordering (AC-3) — config `configServiceImpl.ts`

Follows D-1, D-6, D-8 and D-9. Today the ordering exists only as prose comments (recon.md:57).

- `CROSS_KEY_ORDERING` has two rows, and `CROSS_KEY_RULES_BY_KEY: ReadonlyMap` is precomputed at module load.
  A key in no rule issues no query.
  - `portfolio.marketdata.quote_timeout_ms` > max(`marketdata.quotes.batch_timeout_ms`,
    `marketdata.quotes.mark_timeout_ms`) (recon.md:51-53).
  - `analysis.opportunity.live_enrich_timeout_ms` > `marketdata.price.batch_timeout_ms` (recon.md:48-49).
- The gate runs after authz and the per-key gate and before the existence gate (recon.md:59, recon.md:89). It
  applies to global writes only, uses strict `>`, and sends code 3 with no write.
- Sibling values are read from global `value_data` in the same environment and parsed with `Number()`. An
  absent or non-finite sibling skips the comparison with a key-only WARN; a DB error takes the code-13 path.
- The rejection message and the `docs/runbooks/config-rollout.md` remedy **lead with "raise the greater key"**.
  That is the only direction that always succeeds:
  - quote max 8000 > max(5000, 2500);
  - enrich max 4000 > price max 2500.
- They offer "lower <lesser key> first" only when exactly one lesser key violates.
- The rule is "prevents inversion only": strict `>` carries no warm-read margin.
- Stated narrowing: a global `quote_timeout_ms` = 2500 is rejected while the stored global
  `quotes.batch_timeout_ms` is 2500 (the seeded value, recon.md:62-66). `@AC-1 @feature-229` still passes,
  because its fixture is a fake config and never goes through `SetConfig` (recon.md:127).
- Tests in `setConfigScalarBounds.test.ts` (recon.md:96-100):
  - AC-3, the reverse direction, the enrich pair, per-user skip, absent sibling and unparseable sibling;
  - global quote=2500 over stored batch=2500 is rejected with the remedy text;
  - zero `pool.query` calls for an out-of-bounds write and for a non-admin write to a cross-key member.
- The rule stays invisible in ListKeys / config-ui (recon.md:60, recon.md:154); accepted as an open risk.

### 4. Migration — config `<NNN>_mcp_deadline_budget`

`<NNN>` is the next free config migration above the main-dev tip at spec time (operator; main-dev holds 055),
deduped by key. The number-free sentinel `system:config-migration-feature-fix-mcp-deadline-budget` (D-11) keeps
a later renumber to file renames. Recon's `048` (recon.md:135) and the register's `049` are both stale.

`<NNN>.up` is one idempotent statement made of CTEs:

- **seed**: `agent` / `extract.call_budget_seconds` = '35', staging and production, global.
  - Full 048 column shape: `value_type 'float'`, `default_value '35'` (equal to the `_agent_policy` literal
    default), a constraint-stating description, and `consuming_service 'xstockstrat-agent'`.
  - `ON CONFLICT (namespace, key, environment, COALESCE(user_id,'')) DO NOTHING RETURNING namespace, environment`.
- **heal**: a single-key clamp, global rows only (operator condition):
  - `UPDATE config.config_values SET value_data='44', updated_by=<sentinel>, update_reason='feature
    fix-mcp-deadline-budget: clamp to MCP-safe ceiling', caller_identity=NULL`
  - `WHERE namespace='agent' AND key='opportunities.read_timeout_seconds' AND user_id IS NULL AND NOT is_secret
    AND CASE WHEN value_data ~ '<numeric re>' THEN value_data::numeric > 44 ELSE false END`
  - `RETURNING namespace, environment`.
  - Global-only, because the agent's `WatchConfigRequest` carries no `user_id`
    (`services/xstockstrat-agent/app/config/watcher.py:49-53`), so per-user rows are never read. The per-user
    count above 44 is reported with `RAISE NOTICE` only, as in `config-046.sql:78-85`.
  - The `CASE` is required because Postgres does not guarantee qual evaluation order; a bare
    `value_data::numeric` could abort the migration on a non-numeric row.
  - `caller_identity=NULL`, because the audit trigger records `NEW.caller_identity`
    (`017_config_secrets_and_scoping.up.sql:69-74`).
  - The regex is either widened to match Python `float()` syntax, or the spec-time enumeration lists every
    non-matching row.
- **nt**: `SELECT pg_notify('config_changed', json_build_object('namespace', t.namespace, 'environment',
  t.environment)::text) FROM (SELECT DISTINCT namespace, environment FROM (seed UNION ALL heal) u) t` — the
  `047.up:57-61` shape (D-10). Nothing touched means no notify.
- Replay safety: the seed is `DO NOTHING`, and the clamp is value-guarded and kept a no-op by the new ceiling.

`<NNN>.down`:

- Deletes only seed rows matching the sentinel, `user_id IS NULL`, the key and value '35' (the `048.down:4-13`
  shape).
- Is forward-only for the clamp (operator condition).
- Ends with the same DISTINCT `pg_notify` over the delete's `RETURNING` (`047.down:23-24`).

Inverted cross-hop pairs are **not** healed in SQL (D-13, operator condition). The operator fixes them by
ordered `SetConfig`, which the gate admits ("raise the greater key") and which audits and notifies itself.

Spec-time, read-only staging and prod enumeration — blocking for `/sdd-spec`:

- (a) global `opportunities.read_timeout_seconds` rows > 44, plus any non-matching value;
- (b) global inverted pairs.
- The lists and the operator's sign-off go into context.md.
  - The clamp ships in its defensive form even when (a) is empty.
  - Any inversions become an ordered post-deploy `SetConfig` step in `config-rollout.md`.
- If the enumeration cannot be run: ship the clamp, record the sign-off as "unenumerated", keep the down
  forward-only (operator condition).
- `config-rollout.md` also gets:
  - a pre-deploy re-run of query (a);
  - a post-rollout verification query, because the old config image (ceiling 55) accepts 45-55 writes between
    the db-migrator run and the new image going live.

Tests:

- `services/xstockstrat-config/src/__tests__/mcpDeadlineBudgetMigration.test.ts` — static SQL, in the
  `servabilitySeedMigrations` style (recon.md:101). It asserts:
  - the seed row's shape and sentinel;
  - `user_id IS NULL` and the `CASE` guard in the clamp;
  - DISTINCT notify in up and down;
  - the down deletes only the sentinel '35' row and does not un-clamp;
  - a pin that the PREPARE copy matches the migration's clamp text.
- `scripts/migration-assertions/config-mcp-deadline-budget.sql` uses the `webhook-fanout-callback.sql` pattern:
  `BEGIN … ROLLBACK`, insert rows, then `PREPARE` a verbatim copy of the clamp. Fixtures load before the heal
  chain by hard-coded name (`scripts/migration-rerun.py:687-690`), so a fresh DB has no row > 44. Cases:
  - global 55 → 44 and 44.5 → 44;
  - global 40 untouched;
  - per-user 50 untouched;
  - non-numeric untouched, with no error;
  - `caller_identity` becomes NULL;
  - the audit row has `changed_by` = sentinel.
- Regenerate `scripts/config-wiring-stored.json`.

### 5. Docs

- Agent `CLAUDE.md` key table: the new row, and [30,55] becomes [30,44] (recon.md:173).
- The stale batch text in portfolio `CLAUDE.md` (recon.md:174).
- The `docs/patterns/config-governance.md` per-feature key log.
- `docs/runbooks/mcp-tools.md`: PARTIAL and FETCH_FAILED.
- `docs/runbooks/config-rollout.md`: the write order with "raise the greater key" first, that the migration
  notifies, the pre- and post-deploy queries, and the unenumerated fallback.
- Resolve the findings rows: `docs/context-constitution-findings.md:44`, config `:24`, portfolio `:26`
  (recon.md:170-172).

### R7 and reader services

- R7 (sandbox) needs no change (D-5; recon.md:41-44, recon.md:146).
- Portfolio, marketdata and analysis are readers only; no code or migration change (recon.md:67-78).

### Build order

1. Config gate, ceiling and tests.
2. The spec-time enumeration and sign-off, then the migration and its tests.
3. Agent extract budget, with the AC-1 and AC-2 tests.
4. Docs.

Coordinate the `tools.py` and `configServiceImpl.ts` edits with features 319, 322, 328 and 331 (recon.md:158).

### Register objections still marked open

O-13 and O-19..O-25 stay `open` in debate.md: approval came from the operator at the gate, not from a
round-4 close, and the register is append-only. Each is adopted above and binds `/sdd-spec`:

- O-13, O-19, O-20 (blocking) — met by the operator conditions (enumeration + sign-off with the "unenumerated"
  fallback, forward-only down, global-only clamp, `CASE` guard).
- O-21 PREPARE-copy assertion; O-22 `caller_identity = NULL`; O-23 remedy wording; O-24 post-rollout query;
  O-25 seed column shape — all in sections 3 and 4.

## Rejected Alternatives

- `R-1` Non-overlapping per-key bounds for the cross-hop timeout keys — rejected because it breaks
  `@AC-1 @feature-229` (quote 2500) or `@AC-8 @feature-229` (batch 500).
- `R-2` Ceiling 45 for `opportunities.read_timeout_seconds` — rejected because the 58 s worst case misses the
  3 s headroom of `@AC-6 @feature-273`.
- `R-3` URL-count cap as the extract budget — rejected because it does not bound a single slow or dead URL.
- `R-4` Agent-side clamp of `read_timeout_seconds` to the config ceiling — rejected because it duplicates the
  ceiling literal across config and agent (DRY, F-07).
- `R-5` Copying reader default literals into config for absent siblings — rejected because it duplicates Go and
  Python defaults across languages; C-05 seeding makes absence an edge case.
- `R-6` Gating cross-key ordering with `>=` to keep quote=2500 writable over batch=2500 — rejected because it
  allows equal deadlines, i.e. inversion at the boundary.
- `R-7` A generic ordering DSL or a per-row margin field in `CROSS_KEY_ORDERING` — rejected as YAGNI (C-18);
  two rows with strict `>` match the narrowed claim.
- `R-8` Unconditional heal UPDATEs without a prior prod/staging row enumeration and operator sign-off —
  rejected because it repeats fails.md 2026-09-16 fix-trading-config-key-mismatch (`fails.md:2363-2365`).
- `R-9` Number-bearing sentinel `system:config-migration-<NNN>` — rejected because a merge-time renumber would
  rewrite SQL and test literals; the feature-305 number-free sentinel avoids that.
- `R-10` `pg_advisory_xact_lock` serialization of greater/lesser writes — rejected because it needs a
  transaction on the 2-slot direct pool (F-06); the residual is accepted for rare operator writes.
- `R-11` A SQL heal of inverted cross-hop timeout pairs in the migration, even with an operator-picked
  direction — rejected because it bakes a behaviour choice (lengthen user latency or shorten the cold fetch)
  into an immutable migration (F-01); `SetConfig` already performs the corrective write with audit and notify.
- `R-12` Clamping agent `opportunities.read_timeout_seconds` in all `user_id` scopes — rejected because the
  agent's `WatchConfigRequest` carries no `user_id` (`watcher.py:49-53`), so per-user rows are never read;
  rewriting them is an unneeded mutation of user-owned rows.
- `R-13` Dropping the `read_timeout` clamp from the migration entirely and relying on enumeration plus operator
  `SetConfig` — rejected because a row set to 45-55 in the deploy window survives and keeps the 68 s path live;
  the clamp is single-key, value-guarded, audited and replay-safe.

Considered in round 3 and not adopted (no register ID; listed for `/sdd-spec`, not locked):

- A new pre-migration fixture hook in `migration-rerun.py` — it adds a pass to an already complex runner; the
  PREPARE-copy assertion pinned by a static test is local and sufficient.
- A latch marker for the clamp's replay — unnecessary; the value guard plus the new ceiling make replay a no-op.

## Open Risks

- [ ] Concurrent writes to a greater key and a lesser key can each pass against the other's old value
  (accepted residual, R-10) — documented in `config-rollout.md` at the docs step.
- [ ] The 57 s worst case at ceiling 44 leaves zero slack; an unmodelled latency term breaks
  `@AC-6 @feature-273` — addressed at the AC-2 test step (fallback 43).
- [ ] The 35 s extract cap can cut off fetches that complete between 35 and 40 s or later today — covered by
  the C-16 CHANGE sign-off; documented in `mcp-tools.md` at the docs step.
- [ ] Strict `>` without a margin prevents inversion only; portfolio can still time out just after marketdata
  — accepted; the comment wording lands at the config gate step.
- [ ] The cross-key rule is invisible in ListKeys and config-ui; operators discover it on rejection —
  accepted; the rejection message and `config-rollout.md` carry the remedy.
- [ ] Global quote=2500 becomes unwritable while the global batch is 2500 — sanctioned by the operator's C-16
  sign-off for `@AC-1 @feature-229`; pinned by the rejection test at the config gate step.
- [ ] The clamp changes a live global value if an operator raised it above 44 after the spec-time enumeration
  — mitigated by the pre-deploy re-run, the post-rollout query and the audit row (migration step).
- [ ] Old config image window: 45-55 writes are accepted between the db-migrator run and the new image going
  live — post-rollout verification query (docs step).
- [ ] Per-user `read_timeout_seconds` rows above 44 stay stored; harmless while the agent watches global only,
  but a future per-user watch must re-run the heal — recorded in agent `CLAUDE.md` at the docs step.
- [ ] Rows in float syntax that the regex does not match keep the 68 s path unless the regex is widened or the
  rows are enumerated — decided at the spec-time enumeration.
- [ ] The heal scope is unverified if the enumeration cannot be run; the sign-off is then "unenumerated" —
  recorded in context.md at `/sdd-spec`.
- [ ] The PREPARE copy in the assertion file can drift from the migration unless the static pin test holds —
  migration test step.
- [ ] Edit collisions in `tools.py` and `configServiceImpl.ts` with features 319, 322, 328 and 331, and a
  migration-number race at merge — re-checked at `/sdd-spec` and at the integration PR.
- [ ] The attachment parse path is CPU-bound and stays outside the budget — out of scope; follow-up.
- [ ] `HTTPStatusError` still aborts the whole extract call; folding it into the partial result is a
  follow-up — out of scope.

## Constitution Rules Touched

- `C-01` — honored by: `SetConfig` stays the only runtime write path; inverted pairs are fixed through it, not SQL.
- `C-05` — honored by: the new `agent` / `extract.call_budget_seconds` key is seeded by a config migration,
  bounded in the registry, and listed in the agent `CLAUDE.md` table and the config-governance key log.
- `C-07` — honored by: a new numbered migration, numbered above the main-dev tip at spec time; no applied
  migration is edited.
- `C-11` — honored by: recon plus a 3-round full debate before any code; this ledger touch.
- `C-15` — honored by: the feature's `@AC-1..@AC-3` regression scenarios each get a test.
- `C-16` — honored by: every CHANGE below carries the operator's 2026-11-20 sign-off.
- `C-18` — honored by: a two-row table with strict `>`; no DSL, no margin field, no latch marker.
- `F-01` — honored: the migration is additive and value-guarded; no behaviour choice is baked in (R-11); the
  down is forward-only for the clamp.
- `F-06` — honored: no new pool, no transaction held across the gate (R-10); one extra read only for a
  cross-key member.
- `F-07` — honored: the ceiling literal lives only in the config registry (R-4); reader defaults are not
  copied (R-5).
- `P-02` — honored by: proposer and adversary exchanged only synthesized state.
- `P-03` — honored by: every claim cites recon.md or a re-verified `path:line`; unknowns sit in Open Risks.
- `PLAT-N1` — honored by: the pass conditions (57 s bar, code 3 with no write, zero-query assertions) are set
  here, and the spec-time enumeration verifies the heal scope instead of assuming it.

Floor breaches: none.

## Business Rules Touched (C-16)

All four CHANGE lines are covered by one operator decision: "Operator (2026-11-20): C-16 sign-off for the
CHANGEs to this feature's @AC-2, @AC-6 feature-207, @AC-2 feature-247 and @AC-1 feature-229" (context.md,
Session 2026-11-20).

- EXTEND `@AC-1` "extract_email_content returns partial results before the MCP client timeout" (this feature's
  `acceptance.feature`) — new case added: the PARTIAL error with deadline/transport counts and
  `unfetched_urls`, plus the `extract_website_content` DEADLINE_EXCEEDED / FETCH_FAILED shapes.
- CHANGE `@AC-2` "list_opportunities worst case stays under the MCP client timeout" (this feature's
  `acceptance.feature`) — the SetConfig ceiling in its Given moves from 55 to 44 and the bar tightens to
  <= 57 s; signed off by user @ 2026-11-20 (context.md).
- EXTEND `@AC-3` "SetConfig rejects a value that inverts portfolio-over-marketdata quote deadline ordering"
  (this feature's `acceptance.feature`) — new cases added: the reverse direction, the enrich-over-price pair,
  and the global-only scope.
- CHANGE `@AC-6 @feature-207` "A legitimate public URL is still fetched and extracted"
  (`services/xstockstrat-agent/acceptance/extract-tool-ssrf-hardening.feature`) — a legitimate fetch is now
  also bounded by the 35 s whole-call budget and can end as PARTIAL / DEADLINE_EXCEEDED; signed off by user @
  2026-11-20 (context.md).
- CHANGE `@AC-2 @feature-247` "extract_website_content proceeds with its default fetch policy"
  (`services/xstockstrat-agent/acceptance/fix-agent-getconfig-deadline.feature`) — the default policy now
  includes the whole-call budget (default 35 s); signed off by user @ 2026-11-20 (context.md).
- CHANGE `@AC-1 @feature-229 @feature-240` "Portfolio reads return unenriched positions when the quote fetch
  exceeds its deadline and no daily close exists"
  (`services/xstockstrat-portfolio/acceptance/fix-book-portfolio-page.feature`) — a global quote deadline of
  2500 is no longer writable while the stored global batch is 2500; the scenario's fake-config fixture still
  passes; signed off by user @ 2026-11-20 (context.md).
- PRESERVE `@AC-6 @feature-273` "A tool whose backends all stall still answers before the MCP client gives up"
  (`services/xstockstrat-agent/acceptance/fix-agent-client-deadlines.feature`) — not regressed by: both tool
  worst cases land at or under 57 s (55 s extract, 57 s list_opportunities).
- PRESERVE `@AC-7 @feature-207` "A blocked fetch does not leak internal targets and is recorded"
  (`extract-tool-ssrf-hardening.feature`) — not regressed by: `EgressBlocked` still raises; `unfetched_urls`
  names only caller-supplied URLs; the WARN carries no URL or host.
- PRESERVE `@AC-8 @feature-207` "The egress policy is sourced from config, not hardcoded literals" (same file)
  — not regressed by: the budget is a seeded config key read through `_agent_policy`.
- PRESERVE `@AC-8 @feature-229` "A cold-fetch failure returns the warm subset instead of failing the batch"
  (`services/xstockstrat-marketdata/acceptance/fix-book-portfolio-page.feature`) — not regressed by: per-key
  bounds are unchanged, so batch 500 stays valid.
- PRESERVE `@AC-4 @feature-184` "An out-of-bounds tuning write is rejected at the write edge"
  (`services/xstockstrat-config/acceptance/opportunity-config-operability.feature`) — not regressed by: the
  per-key gate runs first and unchanged; the cross-key gate reuses its code-3, no-write shape.
- PRESERVE `@AC-25 @feature-295` "Internal-caller grants and write bounds match on the canonical key"
  (`services/xstockstrat-config/acceptance/fix-config-keys-drift.feature`) — not regressed by: the cross-key
  rules key on namespace + relative key.
- PRESERVE `@AC-31 @feature-295` "The derived deadline never exceeds the long-RPC budget" (same file) — not
  regressed by: R7 and the sandbox bounds are untouched (D-5).
- PRESERVE "The bounds are write-path only and change no read path"
  (`services/xstockstrat-config/acceptance/readiness-materializer-config-keys.feature`) — not regressed by:
  the cross-key gate is in `SetConfig` only; no reader changes.
