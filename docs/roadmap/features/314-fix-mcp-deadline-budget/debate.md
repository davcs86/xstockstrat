# Debate Register: fix-mcp-deadline-budget

**State**: in-debate
**Mode**: full
**Rounds run**: 3 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-11 | /sdd-batch | 5 | 5 | 0 | 11 | 0 | yes |
| 2 | 2026-11-11 | /sdd-batch | 6 | 5 | 10 | 7 | 0 | yes |
| 3 | 2026-11-13 | /sdd-batch | 4 | 3 | 7 | 7 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | Cross-key ordering is enforced in SetConfig through a CROSS_KEY_ORDERING table, not through non-overlapping per-key bounds. | Disjoint ranges break @AC-1/@AC-8 feature-229. configServiceImpl.ts:153,155; recon Risks. | settled |
| D-2 | 1 | The agent.opportunities.read_timeout_seconds ceiling is 44 (bounds [30,44]), not 45. | 10 + 3 + 45 = 58 s misses the 3 s headroom of AC-6 @feature-273; 44 gives 57 s. client.py:44; tools.py:2665; configServiceImpl.ts:150. | settled |
| D-3 | 1 | The extract budget comes from new config key agent.extract.call_budget_seconds with ceiling 35, never from a literal. | AC-8 @feature-207; auth 10 s + _get_source 10 s + 35 s = 55 s. auth.py:46; tools.py:2616,2668. | settled |
| D-4 | 1 | EgressBlocked keeps raising ToolError, and the all-succeed extract response shape is unchanged. | AC-7 @feature-207. tools.py:613,2745. | settled |
| D-5 | 1 | R7 (sandbox) needs no code change; it is closed by feature 295 AC-31. | client.py:1121 clamps to 45 s; 45 + 10 = 55 < 60. | settled |
| D-6 | 2 | The cross-key gate applies to global writes only, compared against global siblings in the same environment; per-user writes skip it. | All readers subscribe globally: analysis watcher.py:58-64, servicer.py:4819-4824; portfolio config.go:79; marketdata config.go:87. | settled |
| D-7 | 2 | The extract budget is one asyncio.timeout scope, entered after _get_source and attachments. Per URL it catches only httpx.TimeoutException/TransportError. EgressBlocked→ToolError and HTTPStatusError propagate unchanged. | tools.py:595,602-611,2736,2745-2748; AC-7 @feature-207. | settled |
| D-8 | 2 | The cross-key ordering is strict > and documented as 'prevents inversion only'. The quote rule's lesser term is max(batch, mark), because mark runs concurrently with batch. | configServiceImpl.ts:141-142,151-152; marketdata_service.go:672,726. | settled |
| D-9 | 2 | Sibling values are read from global value_data and parsed with Number(). An absent or non-finite sibling skips the comparison with a key-only WARN; a DB error takes the code-13 path. | configServiceImpl.ts:768-786,929-930. | settled |
| D-10 | 2 | Migration 048 ends .up and .down with pg_notify('config_changed') over the touched (namespace, environment) pairs. | The audit trigger does not notify; SetConfig notifies at configServiceImpl.ts:841; precedent at 041:539, 046:58, 047:58. | settled |
| D-11 | 2 | 048 writes updated_by with the number-free sentinel system:config-migration-feature-fix-mcp-deadline-budget. | docs/patterns/config-governance.md author-sentinel table, feature 305 row. | settled |
| D-12 | 3 | The migration is config 049_mcp_deadline_budget on this tree, because 048 is taken by feature 334. At merge it is renumbered to max(origin/main-dev)+1, deduped by key. The number-free sentinel (D-11) limits the renumber to file renames. | services/xstockstrat-config/migrations/048_webhook_fanout_callback_keys.{up,down}.sql exist; fails.md 2026-11-10 fix-analysis-live-loop-budget-seed. | settled |
| D-13 | 3 | Inverted cross-hop pairs are not healed in SQL. The operator remediates them with ordered SetConfig writes after deploy, recorded in config-rollout.md from the spec-time enumeration. SetConfig audits and notifies them. | configServiceImpl.ts:750-760 (the gate admits the corrective write), :841 (notify); F-01 (immutable migration would bake in a behaviour choice); fails.md:2363-2365. | settled |
| D-14 | 3 | 049.down deletes only the sentinel-scoped, global seed row with value '35', in the 048.down shape. It is forward-only for the read_timeout clamp, and it ends with a DISTINCT pg_notify over the deleted rows. | 048_webhook_fanout_callback_keys.down.sql:4-13; 047_config_alias_removal_rows.down.sql:23-24; fails.md:2363-2365. | settled |
| D-15 | 3 | The extract partial result uses error 'PARTIAL: N of M URLs not fetched (deadline: a, transport: b)'. extract_website_content raises 'DEADLINE_EXCEEDED: …within Ns' on the budget and 'FETCH_FAILED: <ExceptionClass>' on a transport failure. Both shapes are documented in mcp-tools.md. | A fast httpx.TransportError is not a deadline (O-15); tools.py extract path; FR-6 @feature-207 (no URL echoed). | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Non-overlapping per-key bounds for the cross-hop timeout keys | Breaks @AC-1 feature-229 (quote 2500) or @AC-8 feature-229 (batch 500). | locked |
| R-2 | 1 | Ceiling 45 for opportunities.read_timeout_seconds | 58 s worst case misses the 3 s headroom of AC-6 @feature-273. | locked |
| R-3 | 1 | URL-count cap as the extract budget | Does not bound a single slow or dead URL. | locked |
| R-4 | 1 | Agent-side clamp of read_timeout_seconds to the config ceiling | Duplicates the ceiling literal across config and agent (DRY, F-07). | locked |
| R-5 | 1 | Copying reader default literals into config for absent siblings | Duplicates Go and Python defaults across languages; C-05 seeding makes absence an edge case. | locked |
| R-6 | 2 | Gating cross-key ordering with >= to keep quote=2500 writable over batch=2500 | Allows equal deadlines, i.e. inversion at the boundary. | locked |
| R-7 | 2 | A generic ordering DSL or a per-row margin field in CROSS_KEY_ORDERING | YAGNI (C-18); two rows with strict > match the narrowed claim. | locked |
| R-8 | 2 | Unconditional heal UPDATEs without a prior prod/staging row enumeration and operator sign-off | Repeats fails.md 2026-09-16 fix-trading-config-key-mismatch (fails.md:2363-2365). | locked |
| R-9 | 2 | Number-bearing sentinel system:config-migration-<NNN> for 048 | A merge-time renumber would rewrite SQL and test literals; the feature-305 number-free sentinel avoids that. | locked |
| R-10 | 2 | pg_advisory_xact_lock serialization of greater/lesser writes | Needs a transaction on the 2-slot direct pool (F-06); the residual is accepted for rare operator writes. | locked |
| R-11 | 3 | A SQL heal of inverted cross-hop timeout pairs in the migration, even with an operator-picked direction | It bakes a behaviour choice (lengthen user latency or shorten the cold fetch) into an immutable migration (F-01). SetConfig already performs the corrective write with audit and notify. | locked |
| R-12 | 3 | Clamping agent opportunities.read_timeout_seconds in all user_id scopes | The agent's WatchConfigRequest carries no user_id (watcher.py:49-53), so per-user rows are never read. Rewriting them is an unneeded mutation of user-owned rows (fails.md:2363-2365, D-6). | locked |
| R-13 | 3 | Dropping the read_timeout clamp from the migration entirely and relying on enumeration plus operator SetConfig | A row set to 45-55 in the deploy window survives and keeps the 68 s path live. The clamp is single-key, value-guarded, audited and replay-safe. | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | O-1: Write-only bounds do not fix stored rows. 048 must heal read_timeout_seconds > 44 and any inverted cross-hop pairs, with a migration test. | yes | closed @ round 2 (The heal shape and migration test are now specified (seed, clamp, inverted-pair heal, test). The remaining gaps (notify, sign-off, forward-only down) are split out as O-12 and O-13.) |
| O-2 | 1 | O-2: httpx.TimeoutException and TransportError must yield the partial extract result; EgressBlocked still raises. | yes | closed @ round 2 (A per-URL try catches httpx.TimeoutException/TransportError into the partial result. EgressBlocked→ToolError (tools.py:2745-2748) is not caught.) |
| O-3 | 1 | O-3: The per-user cross-key branch governs unread rows. Verify analysis's scope and gate global writes only. | yes | closed @ round 2 (Analysis global scope verified (watcher.py:58-64, servicer.py:4819-4824); gate restricted to global writes.) |
| O-4 | 1 | O-4: The extract budget reader needs the non-finite / <= 0 → default guard (tools.py:1766 pattern). | no | closed @ round 2 (_agent_policy read with the non-finite/<=0→35 guard from tools.py:1766.) |
| O-5 | 1 | O-5: A default of 30 s tightens a working fetch path. Use 35 or record why 30 was chosen. | no | closed @ round 3 (design.md states that the per-request path today is connect 10 + read 30 = 40 s (redirects pay connect again), so 35 s is a new whole-call cap. It is the largest value that keeps auth 10 + _get_source 10 + 35 = 55 s.) |
| O-6 | 1 | O-6: Strict > gives no warm-read margin. Add a named margin or narrow the claim to 'prevents inversion only'. | no | closed @ round 2 (Strict > kept; comments at :141-142,:151-152 and design.md reworded to 'prevents inversion only'.) |
| O-7 | 1 | O-7: Specify sibling value parsing and unparseable-value behaviour; AC-3 needs a sibling-returning mock. | no | closed @ round 2 (value_data parsed with Number(); absent/NaN sibling skips with a WARN; DB error takes code 13; a new sibling-returning mock is added.) |
| O-8 | 1 | O-8: The rejection message and config-rollout.md must state the write order. | no | closed @ round 2 (The rejection message names both keys, the stored value and the remedy; config-rollout.md documents the write order.) |
| O-9 | 1 | O-9: A ceiling of 44 has no slack. Assert with an injected clock; use 43 if latency is measured. | no | closed @ round 2 (Injected-clock assertion <= 57 s; fallback to 43 if a measured variant exceeds it.) |
| O-10 | 1 | O-10: Use one asyncio.timeout scope instead of per-call wait_for(remaining). | no | closed @ round 2 (A single asyncio.timeout scope around the URL loop.) |
| O-11 | 1 | O-11: The deadline path must not log URLs (FR-6 @feature-207). | no | closed @ round 2 (One WARN with counts and the exception class name only; no URL or host.) |
| O-12 | 2 | O-12: 048 .up/.down must pg_notify('config_changed') over the DISTINCT touched (namespace, environment) pairs (047:58 shape), and the test must assert it. Otherwise the stale snapshot keeps the 68 s path after deploy. | yes | closed @ round 3 (049.up ends with a DISTINCT (namespace, environment) pg_notify CTE over the seed ∪ heal RETURNING (047.up:57-61), and 049.down does the same over the delete RETURNING (047.down:23-24). Both are asserted in the migration tests.) |
| O-13 | 2 | O-13: The heal scope needs a spec-time prod/staging row enumeration plus operator sign-off in context.md. Drop Heal 2 if there are zero inversions. 048.down is forward-only for the heals (fails.md:2363-2365). | yes | open |
| O-14 | 2 | O-14: Strict > makes quote=2500 unwritable over the seeded batch=2500. State the narrowing in design.md and add a rejection test with the remedy message. | no | closed @ round 3 (design.md states the strict-> narrowing (quote=2500 is unwritable over batch=2500; the @AC-1 feature-229 fake-config fixture still passes), and a code-3 rejection test with the remedy text is added. The remedy direction wording is tracked in O-23.) |
| O-15 | 2 | O-15: Use a neutral PARTIAL prefix with deadline/transport counts in the extract partial result. extract_website_content transport failures are not DEADLINE_EXCEEDED. | no | closed @ round 3 (Adopted 'PARTIAL: N of M URLs not fetched (deadline: a, transport: b)' and FETCH_FAILED vs DEADLINE_EXCEEDED in extract_website_content, both documented in mcp-tools.md.) |
| O-16 | 2 | O-16: Use the number-free sentinel system:config-migration-feature-<slug> for updated_by. | no | closed @ round 3 (updated_by is system:config-migration-feature-fix-mcp-deadline-budget (config-governance.md:142).) |
| O-17 | 2 | O-17: Precompute a key→rules map once from CROSS_KEY_ORDERING; no DSL or margin field. | no | closed @ round 3 (CROSS_KEY_RULES_BY_KEY ReadonlyMap is built once at module load from the two-row CROSS_KEY_ORDERING. A key in no rule issues no query.) |
| O-18 | 2 | O-18: Assert that an out-of-bounds or denied write to a cross-key member issues zero queries. | no | closed @ round 3 (setConfigScalarBounds.test.ts asserts pool.query call count 0 for an out-of-bounds write and a non-admin global write to marketdata.quotes.batch_timeout_ms.) |
| O-19 | 3 | O-19: Scope the 049 clamp to user_id IS NULL. The agent watches global config only (watcher.py:49-53). Test that per-user 50 is untouched, and report per-user rows above 44 with RAISE NOTICE only (config-046.sql:78-85). | yes | open |
| O-20 | 3 | O-20: Guard the clamp cast with CASE WHEN value_data ~ re THEN value_data::numeric > 44 ELSE false END, because qual order is not guaranteed. Then either widen the regex to Python float() syntax, or have the enumeration list every non-matching row. | yes | open |
| O-21 | 3 | O-21: The real-DB assertion must use the webhook-fanout-callback.sql BEGIN/ROLLBACK + PREPARE-copy pattern, pinned to the 049 text by a static test. Fixtures load before the heal chain (migration-rerun.py:687-690). | no | open |
| O-22 | 3 | O-22: The clamp must SET caller_identity = NULL; the audit trigger records NEW.caller_identity (017.up:69-74). | no | open |
| O-23 | 3 | O-23: The rejection remedy and the rollout step lead with 'raise the greater key'. Offer 'lower the lesser key' only when exactly one lesser key violates (configServiceImpl.ts:144,149; quote vs max(batch, mark)). | no | open |
| O-24 | 3 | O-24: Add a post-rollout verification query to config-rollout.md. The old image (ceiling 55) accepts 45-55 writes between the 049 run and the new config image going live. | no | open |
| O-25 | 3 | O-25: Seed row in the full 048 column shape: value_type 'float', default_value '35' equal to the _agent_policy default, a constraint-stating description, consuming_service 'xstockstrat-agent' (check-config-wiring.mjs defaultMatches). | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
