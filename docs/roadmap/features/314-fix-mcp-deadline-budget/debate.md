# Debate Register: fix-mcp-deadline-budget

**State**: in-debate
**Mode**: full
**Rounds run**: 2 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-11 | /sdd-batch | 5 | 5 | 0 | 11 | 0 | yes |
| 2 | 2026-11-11 | /sdd-batch | 6 | 5 | 10 | 7 | 0 | yes |

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

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | O-1: Write-only bounds do not fix stored rows. 048 must heal read_timeout_seconds > 44 and any inverted cross-hop pairs, with a migration test. | yes | closed @ round 2 (The heal shape and migration test are now specified (seed, clamp, inverted-pair heal, test). The remaining gaps (notify, sign-off, forward-only down) are split out as O-12 and O-13.) |
| O-2 | 1 | O-2: httpx.TimeoutException and TransportError must yield the partial extract result; EgressBlocked still raises. | yes | closed @ round 2 (A per-URL try catches httpx.TimeoutException/TransportError into the partial result. EgressBlocked→ToolError (tools.py:2745-2748) is not caught.) |
| O-3 | 1 | O-3: The per-user cross-key branch governs unread rows. Verify analysis's scope and gate global writes only. | yes | closed @ round 2 (Analysis global scope verified (watcher.py:58-64, servicer.py:4819-4824); gate restricted to global writes.) |
| O-4 | 1 | O-4: The extract budget reader needs the non-finite / <= 0 → default guard (tools.py:1766 pattern). | no | closed @ round 2 (_agent_policy read with the non-finite/<=0→35 guard from tools.py:1766.) |
| O-5 | 1 | O-5: A default of 30 s tightens a working fetch path. Use 35 or record why 30 was chosen. | no | open |
| O-6 | 1 | O-6: Strict > gives no warm-read margin. Add a named margin or narrow the claim to 'prevents inversion only'. | no | closed @ round 2 (Strict > kept; comments at :141-142,:151-152 and design.md reworded to 'prevents inversion only'.) |
| O-7 | 1 | O-7: Specify sibling value parsing and unparseable-value behaviour; AC-3 needs a sibling-returning mock. | no | closed @ round 2 (value_data parsed with Number(); absent/NaN sibling skips with a WARN; DB error takes code 13; a new sibling-returning mock is added.) |
| O-8 | 1 | O-8: The rejection message and config-rollout.md must state the write order. | no | closed @ round 2 (The rejection message names both keys, the stored value and the remedy; config-rollout.md documents the write order.) |
| O-9 | 1 | O-9: A ceiling of 44 has no slack. Assert with an injected clock; use 43 if latency is measured. | no | closed @ round 2 (Injected-clock assertion <= 57 s; fallback to 43 if a measured variant exceeds it.) |
| O-10 | 1 | O-10: Use one asyncio.timeout scope instead of per-call wait_for(remaining). | no | closed @ round 2 (A single asyncio.timeout scope around the URL loop.) |
| O-11 | 1 | O-11: The deadline path must not log URLs (FR-6 @feature-207). | no | closed @ round 2 (One WARN with counts and the exception class name only; no URL or host.) |
| O-12 | 2 | O-12: 048 .up/.down must pg_notify('config_changed') over the DISTINCT touched (namespace, environment) pairs (047:58 shape), and the test must assert it. Otherwise the stale snapshot keeps the 68 s path after deploy. | yes | open |
| O-13 | 2 | O-13: The heal scope needs a spec-time prod/staging row enumeration plus operator sign-off in context.md. Drop Heal 2 if there are zero inversions. 048.down is forward-only for the heals (fails.md:2363-2365). | yes | open |
| O-14 | 2 | O-14: Strict > makes quote=2500 unwritable over the seeded batch=2500. State the narrowing in design.md and add a rejection test with the remedy message. | no | open |
| O-15 | 2 | O-15: Use a neutral PARTIAL prefix with deadline/transport counts in the extract partial result. extract_website_content transport failures are not DEADLINE_EXCEEDED. | no | open |
| O-16 | 2 | O-16: Use the number-free sentinel system:config-migration-feature-<slug> for updated_by. | no | open |
| O-17 | 2 | O-17: Precompute a key→rules map once from CROSS_KEY_ORDERING; no DSL or margin field. | no | open |
| O-18 | 2 | O-18: Assert that an out-of-bounds or denied write to a cross-key member issues zero queries. | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
