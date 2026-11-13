# Context Log: fix-mcp-deadline-budget

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect reports (clustered triage):
  - docs/reports/2026-10-29-agent-extract-tools-no-mcp-cap-defect.md (SEV-2)
  - docs/reports/2026-10-29-agent-list-opportunities-over-mcp-timeout-defect.md (SEV-2)
  - docs/reports/2026-10-19-cross-hop-deadline-bounds-unenforced-defect.md (SEV-3)
- Cluster rationale: all three are unenforced end-to-end deadline budgets fixed in the same SetConfig bounds
  registry and agent call budgets (PLAT-13).
- Severity: SEV-2 (highest of cluster)
- Routed to SDD path (Track C); prod-impacting SEV-2 routed to C by operator decision 2026-11-10
- Created: status.md, feature.md, product-spec.md, acceptance.feature (3 regression scenarios), context.md
- Affected services (from reports): xstockstrat-agent, xstockstrat-config, xstockstrat-portfolio,
  xstockstrat-marketdata, xstockstrat-analysis
- Root cause hypothesis: per-hop/per-key budgets with no whole-call bound and no cross-key validation. R7 residual
  (sandbox timeout vs ExecuteFormula deadline) appears reshaped since the report (`client.py:1121`
  `formula_deadline_s`, `configServiceImpl.ts:176` bound) — re-verify in recon.
- Recommended design depth: full → `/sdd-design fix-mcp-deadline-budget` (rationale: SEV-2, ≥2 affected services,
  config-bound changes)
- Development branch: feature/fix-mcp-deadline-budget

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags; no Consumer Surface section); ceiling/budget key contract deferred to design (namespace-relative + full C-05 contract); AC-1 'just inside 30 s' not concrete; R7 residual and 3 of 4 cross-hop pairs uncovered
- Overlap findings: WARN: configServiceImpl.ts SetConfig path shared with 319; agent shared with 319/322/328/331
- Recommended design depth: full (agent + config + 3 callee services; config bounds)
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)

## Session 2026-11-11 — sdd-batch design gate (round 2)

- `/sdd-design fix-mcp-deadline-budget` full debate halted at its approval gate after round 2 (gate policy: halt).
  design.md NOT written; status.md unchanged. Register: `debate.md` (D-1..D-11, R-1..R-10, O-1..O-18).

### Open Threads

- **Approach**: one feature, no proto change. (1) Agent extract whole-call budget: new key `agent` /
  `extract.call_budget_seconds` (default 35, bounds [5,35], non-finite/<=0 → 35), one `asyncio.timeout` scope around
  the URL loop entered after `_get_source` and attachments; per-URL catch of `httpx.TimeoutException`/`TransportError`
  only → neutral `PARTIAL: N of M URLs not fetched (deadline: a, transport: b)` result with `unfetched_urls`;
  all-succeed shape unchanged; EgressBlocked→ToolError and HTTPStatusError propagate; one count-only WARN, no URL.
  `extract_website_content` gets the same budget (DEADLINE_EXCEEDED vs non-deadline transport ToolError).
  (2) Config ceiling `opportunities.read_timeout_seconds` [30,55] → [30,44] (10 + 3 + 44 = 57 s), injected-clock AC-2
  test, fallback 43. (3) `CROSS_KEY_ORDERING` two-row table, strict `>` ("prevents inversion only"), precomputed
  key→rules map, global writes only vs global siblings, run after authz + per-key gate and before the existence gate,
  code 3 with both keys/stored value/remedy. (4) Migration 048: seed row, sentinel
  `system:config-migration-feature-fix-mcp-deadline-budget`, heal scope gated on a spec-time prod/staging query +
  operator sign-off, closing `pg_notify('config_changed')`, forward-only heal DOWN. (5) Docs + three findings rows.
  R7 unchanged (D-5). Build order: config gate → spec-time query + 048 → agent budget → docs.
- **Strongest open objections (blocking)**: O-12 — 048 .up/.down must `pg_notify('config_changed')` over the DISTINCT
  touched (namespace, environment) pairs and the test must assert it, else the running snapshot keeps the 68 s path;
  O-13 — heal UPDATEs change live deadlines, so the spec-time row enumeration plus operator sign-off must be recorded
  here (drop Heal 2 on zero inversions; operator picks raise-greater vs lower-lesser otherwise). Non-blocking open:
  O-5 (correct the 35 s rationale: connect 10 + read 30 = 40 s, so 35 is a new cap), O-14..O-18.
- **Floor status**: no Floor breaches.
- **Uncovered @AC changes** (no operator decision yet): CHANGE — @AC-2 (feature 314), @AC-6 feature-207,
  @AC-2 feature-247, @AC-1 feature-229 (quote=2500 no longer writable over seeded batch=2500 under strict `>`);
  EXTEND — @AC-1 and @AC-3 (feature 314). PRESERVE rows (AC-6 @feature-273, AC-7/AC-8 @feature-207, AC-8 @feature-229,
  AC-4 @feature-184, AC-25/AC-31 @feature-295, readiness-materializer write-path-only bounds) need no sign-off.
- **Resume**: the next `/sdd-batch` run resumes at round 3 from the state below; round 3 must close O-12 and O-13.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "One feature, no proto change, built on tree c4fd48b0. It honours D-1..D-5 and R-1..R-5. Round 3 only has to close O-12 and O-13 (the heal migration's live effect and its sign-off) and fix the smaller items listed below.\n\n(1) Extract whole-call budget (AC-1), agent services/xstockstrat-agent/app/tools.py.\n- New key `extract.call_budget_seconds` in namespace `agent`. Default 35, bounds [5,35] in SCALAR_BOUNDS_REGISTRY. Read once per call with `_agent_policy` (:2668). A value that is non-finite or <= 0 falls back to 35, the same guard as :1766.\n- One `async with asyncio.timeout(budget)` scope around the URL loop at :609-611. It is entered after `_get_source` (:595) and after attachments (:602-606), so the CPU-bound attachment parse stays outside the budget.\n- Each URL has its own `try`, catching only `httpx.TimeoutException` and `httpx.TransportError`.\n  - `EgressBlocked` becomes `ToolError` at :2745-2748 and still aborts the whole call (D-4).\n  - `HTTPStatusError` from :2736 propagates as it does today.\n- `TimeoutError` caught outside the scope marks the URL in flight and every URL not yet tried as unfetched.\n- Partial response: `{\"raw_text\", \"error\": \"PARTIAL: N of M URLs not fetched (deadline: a, transport: b)\", \"unfetched_urls\": [the caller's own strings]}`. The neutral prefix answers O-15. When every URL succeeds the response is still exactly `{\"raw_text\"}` (:613).\n- Logging: one WARN with counts and the exception class name only, never a URL or host.\n- `extract_website_content` (:644): the same budget wraps its single fetch.\n  - Deadline: `ToolError(\"DEADLINE_EXCEEDED: content fetch did not complete within Ns\")`.\n  - Transport failure: a non-deadline `ToolError` that names only the exception class.\n  - The source URL is never echoed.\n- O-5 rationale, corrected in design.md:\n  - Connect 10 s + read 30 s = 40 s (tools.py:2698-2699), and each redirect pays connect again. The per-chunk read timeout never bounded a trickling URL.\n  - So 35 s is a new cap. It can cut off a fetch that today finishes slowly after 35 s.\n  - 35 is chosen as the largest value that keeps auth 10 + `_get_source` 10 + 35 = 55 s under the 57 s bar.\n\n(2) list_opportunities ceiling (AC-2), config.\n- configServiceImpl.ts:150 becomes `{minValue: 30, maxValue: 44}`.\n- The row comment states the invariant: 10 + 3 + this value <= 57 s.\n- The AC-2 test (in test_list_opportunities_deadline.py, extending :27/:45):\n  - fake ValidateToken that sleeps just under the auth deadline;\n  - policy cap 3;\n  - hung server with the snapshot at 44;\n  - injected-clock assertion elapsed <= 57 s plus the upstream-deadline message.\n- If a measured real-time variant goes over 57 s, the ceiling drops to 43.\n\n(3) Cross-key ordering (AC-3), config configServiceImpl.ts.\n- `CROSS_KEY_ORDERING` holds exactly two rows, next to SCALAR_BOUNDS_REGISTRY (:114). Keys use the form `${namespace}.${relativeKey}` (:181-182).\n  - `portfolio.marketdata.quote_timeout_ms` > max(`marketdata.quotes.batch_timeout_ms`, `marketdata.quotes.mark_timeout_ms`). Mark runs concurrently with batch (marketdata_service.go:672/:726), so the max is the right term.\n  - `analysis.opportunity.live_enrich_timeout_ms` > `marketdata.price.batch_timeout_ms`.\n- A key→rules map is precomputed once at module load from that table (O-17). There is no DSL and no margin field.\n- `crossKeyOrderingRejection` runs after authz and the per-key gate (:750-760), and before the existence gate (:762). It checks both directions.\n- Global writes only (`userIdParam === null`), compared against global siblings in the same environment. Per-user writes skip it. All three readers subscribe globally:\n  - analysis watcher.py:58-64 and servicer.py:4819-4824;\n  - portfolio config.go:79;\n  - marketdata config.go:87.\n  design.md records that per-user rows of these keys are unread.\n- Sibling read: one SELECT shaped like :768-771 over `value_data` with `user_id IS NULL`, parsed with `Number()`.\n  - An absent or non-finite sibling skips that comparison and logs one WARN naming only the key (R-5).\n  - A DB error takes the code-13 path (:783-786).\n- Rejection: code 3, no write (AC-4 @feature-184). The message names both keys, the stored sibling value and the remedy (\"lower X first\" / \"raise Y first\"). The write order also goes into config-rollout.md.\n- The gate is strict `>`. The comments at :141-142 and :151-152 and design.md are reworded to \"prevents inversion only\".\n- Tests in setConfigScalarBounds.test.ts, using a new sibling-returning mock (the existing :42-48 mock still exercises the skip path):\n  - AC-3: quote 1000 with batch 5000 is rejected;\n  - the reverse direction;\n  - the enrich pair;\n  - per-user skip, absent sibling, unparseable sibling;\n  - an ordered pair accepted;\n  - quote=2500 with stored batch=2500 rejected with the remedy message (O-14, the narrowing is stated in design.md);\n  - an out-of-bounds write to a cross-key member still issues zero queries (O-18).\n\n(4) Migration 048, config.\n- Seed `agent` / `extract.call_budget_seconds` = 35 for both environments, global, `ON CONFLICT DO NOTHING`, in the shape of 041:40-46 / 043.\n- Heal scope is gated on a read-only staging and prod query during spec. Its row list goes into context.md with operator sign-off (O-13, fails.md:2363-2365):\n  - Heal 1 (clamp `read_timeout_seconds` > 44 to 44, all scopes, numeric guard `~ '^[0-9.]+$'`) ships only if the query finds such rows, or with operator sign-off for the defensive form.\n  - Heal 2 (inverted cross-hop pairs) is dropped if the query finds zero inversions; the new gate prevents future ones. If inversions exist, the operator picks one of two directions:\n    - raise the greater key: portfolio to max(lessers)+1 <= 8000, or enrich to batch+1 <= 2501;\n    - lower the lesser key.\n- The migration must end with `SELECT pg_notify('config_changed', json_build_object('namespace', t.namespace, 'environment', t.environment)::text) FROM (SELECT DISTINCT namespace, environment FROM <touched rows>) t`, matching 047:58 (O-12). The audit trigger does not notify; SetConfig notifies from code at configServiceImpl.ts:841. The Assumption about this is deleted.\n- `updated_by` is the number-free sentinel `system:config-migration-feature-fix-mcp-deadline-budget` (config-governance.md, feature-305 row), so a renumber at merge renames files only (O-16).\n- 048.down is forward-only for the heals: it deletes only the seed row and notifies.\n- The test, crossHopHealSeedMigration.test.ts (modelled on servabilitySeedMigrations.test.ts), asserts:\n  - the seed row and its sentinel;\n  - each heal that ships: 55 becomes 44, 40 is untouched, an inverted pair is healed, an ordered pair is untouched;\n  - the pg_notify payload.\n- The migration number is max(origin/main-dev) + 1 at merge, deduped by key.\n\n(5) Docs.\n- agent CLAUDE.md key table: the new row, and [30,55] becomes [30,44].\n- The stale batch text in portfolio CLAUDE.md.\n- The config-governance.md per-feature key log.\n- mcp-tools.md: the PARTIAL extract shape.\n- config-rollout.md: the write order, and that 048 notifies.\n- Resolve the three findings rows: docs/context-constitution-findings.md:44, config :24, portfolio :26.\n\nR7: no change (D-5).\n\nBuild order:\n- (a) config table, gate and ceiling, with tests;\n- (b) the spec-time prod/staging query, then migration 048 and its test;\n- (c) agent extract budget, AC-1 and AC-2 tests;\n- (d) docs.\n\nCoordinate edits to tools.py and configServiceImpl.ts with features 319, 322, 328 and 331.",
    "open_objections": [
      {
        "text": "O-12: Migration 048 must end its .up and .down with pg_notify('config_changed', {namespace, environment}) over the DISTINCT touched (namespace, environment) pairs, matching 047:58 / 046:58 / 041:539. The audit trigger does not notify; SetConfig notifies from app code (configServiceImpl.ts:841). Without the notify, the running config snapshot keeps 55 s and AC-2's 68 s worst case after deploy. The migration test must assert the notify payload.",
        "blocking": true
      },
      {
        "text": "O-13: Heal UPDATEs change live deadlines. A spec-time read-only staging/prod query must enumerate every row each heal changes, and the result plus operator sign-off goes in context.md (fails.md:2363-2365). If that query finds zero inversions, drop Heal 2. If inversions exist, the operator chooses whether to raise the greater key or lower the lesser one. 048.down is forward-only for the heals and deletes only the seed row.",
        "blocking": true
      },
      {
        "text": "O-5 (carried): Correct the default-35 reasoning. Connect 10 + read 30 = 40 s (tools.py:2698-2699) and redirects pay connect again, so 35 s is a new cap that can cut off slow fetches that finish today. Record that plainly in design.md.",
        "blocking": false
      },
      {
        "text": "O-14: Under strict >, quote_timeout_ms=2500 (@AC-1 feature-229 fixture) can no longer be written while the seeded quotes.batch_timeout_ms is 2500 (041:179). State this narrowing in design.md and add a rejection test with the remedy message. Do not lower the gate to >=.",
        "blocking": false
      },
      {
        "text": "O-15: A fast httpx.TransportError is not a deadline. Use a neutral 'PARTIAL: N of M URLs not fetched (deadline: a, transport: b)' prefix in the partial extract result, give extract_website_content a non-deadline ToolError for transport failures, and document the shape in mcp-tools.md.",
        "blocking": false
      },
      {
        "text": "O-16: Use the number-free sentinel system:config-migration-feature-<slug> (config-governance.md, feature 305) for updated_by, so the merge-time renumber does not touch SQL or test literals.",
        "blocking": false
      },
      {
        "text": "O-17: Precompute a key→rules map once from CROSS_KEY_ORDERING instead of scanning rows on every write. Keep the table to two rows with no margin field or DSL.",
        "blocking": false
      },
      {
        "text": "O-18: Add an assertion that an out-of-bounds or denied write to a cross-key member issues zero queries. The existing tests at setConfigScalarBounds.test.ts:318 and setConfigAuthz.test.ts:161,286 depend on that ordering.",
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
      "Ceiling 45 (R-2): 58 s misses the 3 s headroom of AC-6 @feature-273.",
      "URL-count cap for extract (R-3): it does not bound a single slow URL.",
      "Agent-side clamp of read_timeout_seconds (R-4): it duplicates the ceiling literal.",
      "Copying reader defaults for absent siblings (R-5): it duplicates cross-language defaults.",
      "SELECT ... FOR UPDATE around the gate and upsert: it holds a slot of the 2-slot direct pool longer. The concurrent-write race is accepted as a residual.",
      "Per-user cross-key scope with global fallback: all readers subscribe globally (watcher.py:58-64, config.go:79, config.go:87), so it would validate unread rows.",
      "Gating with >= instead of > to keep quote=2500 writable over batch=2500: it allows equal deadlines, i.e. inversion at the boundary.",
      "A generic ordering DSL or a per-row margin field: YAGNI. Two rows with strict > match the narrowed claim.",
      "pg_advisory_xact_lock(hashtext(env)) to serialize greater/lesser writes: it needs a transaction on the 2-slot direct pool (F-06 pressure). The residual is accepted for rare operator-only writes.",
      "Unconditional heal UPDATEs with no prior prod query: they repeat fails.md 2026-09-16, a heal changing live behaviour without enumerated rows or sign-off.",
      "The number-bearing sentinel system:config-migration-<NNN>: a merge-time renumber would have to rewrite the SQL and test literals. The number-free feature-slug sentinel avoids that.",
      "Labelling fast transport failures as DEADLINE_EXCEEDED: it misreports the cause."
    ],
    "open_risks": [
      "Concurrent writes to a greater key and a lesser key can each pass against the other's old value. This is an accepted residual, recorded in design.md.",
      "Raising a greater key in the heal lengthens user-visible portfolio and opportunities latency, while lowering a lesser key shortens marketdata's cold fetch. The operator has to choose with the row list in hand.",
      "A 57 s worst case at ceiling 44 leaves zero slack. An unmodelled latency term breaks AC-6, and the fallback is 43.",
      "The 35 s extract cap can cut off fetches that finish slowly today (between 35 and 40 s or later).",
      "Strict > without a margin can still let portfolio's deadline expire just after marketdata's, giving unpriced positions.",
      "The cross-key rule is invisible in ListKeys and config-ui; operators find it only when a write is rejected.",
      "Edit collisions in tools.py and configServiceImpl.ts with features 319, 322, 328 and 331, and a migration-number race at merge.",
      "The attachment parse path is CPU-bound and stays outside the budget.",
      "HTTPStatusError keeps aborting the whole extract call. Folding it into the partial result is a follow-up."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-05",
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
    "rationale": "Round 2 answered O-2, O-3, O-4 and O-6 through O-11 concretely, with checked citations, so those close.\n\n- O-3: analysis's global WatchConfig scope is verified at watcher.py:58-64, so a global-only gate is right.\n- O-2: Timeout and TransportError go to the partial result, and EgressBlocked keeps propagating as ToolError.\n- O-1: the heal shape and its migration test are now specified. Its remaining gaps are split out as new blocking items O-12 and O-13, so O-1 closes as superseded.\n\nI checked the adversary's two blocking findings in the code:\n\n- O-12: the config audit trigger never issues pg_notify. Only SetConfig's application code does (configServiceImpl.ts:841), and every earlier healing migration sends its own notify (041:539, 044:248, 045:132, 046:58, 047:58). Without one, the 68 s path survives deploy.\n- O-13: fails.md:2363-2365 requires heal migrations to enumerate the rows they change and get operator sign-off, with a forward-only DOWN.\n\nBoth are fixed in the approach: a notify at the end of 048, a heal scope gated on a spec-time prod/staging query plus sign-off, Heal 2 dropped if zero inversions are found, and forward-only heal DOWNs.\n\nI also found a number-free sentinel, system:config-migration-feature-<slug> (config-governance.md, feature 305). It settles the adversary's renumbering concern better than a merge checklist would.\n\nO-5 stays open because the proposal's reasoning (a preserved 30 s window) is wrong: connect 10 + read 30 = 40 s. The value 35 itself stands under D-3.\n\nThe 2500-quote narrowing is now recorded as a CHANGE to @AC-1 feature-229. The scenario still passes against a fake config, but recon framed 2500 as a value that must stay writable, so the change needs a design.md note and a rejection test. No operator decision sanctions it yet.\n\nNo Floor breach was found. No settled D-n, locked R-n or closed O-n is contradicted.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "The cross-key gate applies to global writes only, compared against global siblings in the same environment; per-user writes skip it.",
          "evidence": "All readers subscribe globally: analysis watcher.py:58-64, servicer.py:4819-4824; portfolio config.go:79; marketdata config.go:87."
        },
        {
          "text": "The extract budget is one asyncio.timeout scope, entered after _get_source and attachments. Per URL it catches only httpx.TimeoutException/TransportError. EgressBlocked→ToolError and HTTPStatusError propagate unchanged.",
          "evidence": "tools.py:595,602-611,2736,2745-2748; AC-7 @feature-207."
        },
        {
          "text": "The cross-key ordering is strict > and documented as 'prevents inversion only'. The quote rule's lesser term is max(batch, mark), because mark runs concurrently with batch.",
          "evidence": "configServiceImpl.ts:141-142,151-152; marketdata_service.go:672,726."
        },
        {
          "text": "Sibling values are read from global value_data and parsed with Number(). An absent or non-finite sibling skips the comparison with a key-only WARN; a DB error takes the code-13 path.",
          "evidence": "configServiceImpl.ts:768-786,929-930."
        },
        {
          "text": "Migration 048 ends .up and .down with pg_notify('config_changed') over the touched (namespace, environment) pairs.",
          "evidence": "The audit trigger does not notify; SetConfig notifies at configServiceImpl.ts:841; precedent at 041:539, 046:58, 047:58."
        },
        {
          "text": "048 writes updated_by with the number-free sentinel system:config-migration-feature-fix-mcp-deadline-budget.",
          "evidence": "docs/patterns/config-governance.md author-sentinel table, feature 305 row."
        }
      ],
      "new_rejected": [
        {
          "text": "Gating cross-key ordering with >= to keep quote=2500 writable over batch=2500",
          "why": "Allows equal deadlines, i.e. inversion at the boundary."
        },
        {
          "text": "A generic ordering DSL or a per-row margin field in CROSS_KEY_ORDERING",
          "why": "YAGNI (C-18); two rows with strict > match the narrowed claim."
        },
        {
          "text": "Unconditional heal UPDATEs without a prior prod/staging row enumeration and operator sign-off",
          "why": "Repeats fails.md 2026-09-16 fix-trading-config-key-mismatch (fails.md:2363-2365)."
        },
        {
          "text": "Number-bearing sentinel system:config-migration-<NNN> for 048",
          "why": "A merge-time renumber would rewrite SQL and test literals; the feature-305 number-free sentinel avoids that."
        },
        {
          "text": "pg_advisory_xact_lock serialization of greater/lesser writes",
          "why": "Needs a transaction on the 2-slot direct pool (F-06); the residual is accepted for rare operator writes."
        }
      ],
      "new_objections": [
        {
          "text": "O-12: 048 .up/.down must pg_notify('config_changed') over the DISTINCT touched (namespace, environment) pairs (047:58 shape), and the test must assert it. Otherwise the stale snapshot keeps the 68 s path after deploy.",
          "blocking": true
        },
        {
          "text": "O-13: The heal scope needs a spec-time prod/staging row enumeration plus operator sign-off in context.md. Drop Heal 2 if there are zero inversions. 048.down is forward-only for the heals (fails.md:2363-2365).",
          "blocking": true
        },
        {
          "text": "O-14: Strict > makes quote=2500 unwritable over the seeded batch=2500. State the narrowing in design.md and add a rejection test with the remedy message.",
          "blocking": false
        },
        {
          "text": "O-15: Use a neutral PARTIAL prefix with deadline/transport counts in the extract partial result. extract_website_content transport failures are not DEADLINE_EXCEEDED.",
          "blocking": false
        },
        {
          "text": "O-16: Use the number-free sentinel system:config-migration-feature-<slug> for updated_by.",
          "blocking": false
        },
        {
          "text": "O-17: Precompute a key→rules map once from CROSS_KEY_ORDERING; no DSL or margin field.",
          "blocking": false
        },
        {
          "text": "O-18: Assert that an out-of-bounds or denied write to a cross-key member issues zero queries.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-1",
          "how": "The heal shape and migration test are now specified (seed, clamp, inverted-pair heal, test). The remaining gaps (notify, sign-off, forward-only down) are split out as O-12 and O-13."
        },
        {
          "id": "O-2",
          "how": "A per-URL try catches httpx.TimeoutException/TransportError into the partial result. EgressBlocked→ToolError (tools.py:2745-2748) is not caught."
        },
        {
          "id": "O-3",
          "how": "Analysis global scope verified (watcher.py:58-64, servicer.py:4819-4824); gate restricted to global writes."
        },
        {
          "id": "O-4",
          "how": "_agent_policy read with the non-finite/<=0→35 guard from tools.py:1766."
        },
        {
          "id": "O-6",
          "how": "Strict > kept; comments at :141-142,:151-152 and design.md reworded to 'prevents inversion only'."
        },
        {
          "id": "O-7",
          "how": "value_data parsed with Number(); absent/NaN sibling skips with a WARN; DB error takes code 13; a new sibling-returning mock is added."
        },
        {
          "id": "O-8",
          "how": "The rejection message names both keys, the stored value and the remedy; config-rollout.md documents the write order."
        },
        {
          "id": "O-9",
          "how": "Injected-clock assertion <= 57 s; fallback to 43 if a measured variant exceeds it."
        },
        {
          "id": "O-10",
          "how": "A single asyncio.timeout scope around the URL loop."
        },
        {
          "id": "O-11",
          "how": "One WARN with counts and the exception class name only; no URL or host."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-13 — sdd-batch design gate (round 3)

- `/sdd-design fix-mcp-deadline-budget` full debate halted at its approval gate after round 3 (gate policy: halt).
  design.md NOT written; status.md unchanged. Register: `debate.md` (D-1..D-15, R-1..R-13, O-1..O-25).

### Open Threads

- **Approach**: one feature, no proto change, honouring D-1..D-15 / R-1..R-13. (1) Agent extract whole-call budget:
  new key `agent` / `extract.call_budget_seconds` (default 35, bounds [5,35], non-finite/<=0 → 35, read via
  `_agent_policy`, now tools.py:2685); one `asyncio.timeout` scope entered after `_get_source` and attachments;
  per-URL catch of `httpx.TimeoutException`/`TransportError` only → `PARTIAL: N of M URLs not fetched (deadline: a,
  transport: b)` + `unfetched_urls`; all-succeed shape stays `{raw_text}`; `extract_website_content` raises
  `DEADLINE_EXCEEDED: …within Ns` or `FETCH_FAILED: <ExceptionClass>` (D-15); one count-only WARN, no URL/host.
  design.md states the corrected O-5 rationale (today 40 s per request, 35 s is a new whole-call cap).
  (2) `opportunities.read_timeout_seconds` [30,55] → [30,44] (10 + 3 + v <= 57 s), injected-clock AC-2 test, fallback 43.
  (3) `CROSS_KEY_ORDERING` (two rows, strict `>`, "prevents inversion only") with a precomputed
  `CROSS_KEY_RULES_BY_KEY` map; global writes only, after authz + per-key gate, before the existence gate; code 3, no
  write; remedy leads with "raise the greater key". Tests cover AC-3, reverse, enrich pair, per-user skip,
  absent/unparseable sibling, the quote=2500 narrowing, and zero `pool.query` calls for out-of-bounds/non-admin writes.
  (4) Migration config `049_mcp_deadline_budget` (048 is taken by feature 334; renumber at merge, D-12) with the
  number-free sentinel: seed CTE (full 048 column shape), a global-only, CASE-guarded clamp of
  `read_timeout_seconds` > 44 → 44 with `caller_identity = NULL`, and a DISTINCT `pg_notify` CTE over seed ∪ heal;
  inverted cross-hop pairs are NOT healed in SQL; the operator fixes them by ordered SetConfig (D-13). 049.down
  deletes only the sentinel '35' seed row, stays forward-only for the clamp, and notifies (D-14). A blocking
  spec-time read-only staging/prod enumeration (rows > 44, non-matching values, inverted pairs) plus operator
  sign-off goes here, with "unenumerated" as the fallback. Tests: a static `mcpDeadlineBudgetMigration.test.ts`
  and a `scripts/migration-assertions/config-mcp-deadline-budget.sql` PREPARE-copy assertion pinned to the 049
  text. (5) Docs: the agent/portfolio CLAUDE.md tables, the config-governance key log, mcp-tools.md (PARTIAL,
  FETCH_FAILED), config-rollout.md (write order, 049 notify, pre-deploy and post-rollout queries, the unenumerated
  fallback), and three findings rows. R7 unchanged (D-5). Build order: config gate → enumeration + 049 → agent
  budget → docs. Coordinate tools.py/configServiceImpl.ts edits with features 319, 322, 328 and 331.
- **Strongest open objections (blocking)**:
  - O-19: scope the clamp to `user_id IS NULL`, because the agent watches global config only (watcher.py:49-53).
    Per-user 50 stays untouched; per-user rows > 44 are reported with RAISE NOTICE only.
  - O-20: guard the cast with `CASE WHEN value_data ~ re THEN value_data::numeric > 44 ELSE false END`. Then either
    widen the regex to Python `float()` syntax or enumerate every non-matching row.
  - O-13 remainder: its blocking status stays until the proposer adopts O-19/O-20 and the "unenumerated" fallback.
  - Non-blocking open: O-21..O-25 (the PREPARE-copy assertion, `caller_identity = NULL`, remedy wording,
    the post-rollout query, the seed column shape).
  - Closed this round: O-5, O-12, O-14..O-18.
- **Floor status**: no Floor breaches.
- **Uncovered @AC changes** (no operator decision yet):
  - CHANGE: @AC-2 (feature 314), @AC-6 feature-207, @AC-2 feature-247, @AC-1 feature-229 (global quote=2500 is
    unwritable over stored batch=2500 under strict `>`).
  - EXTEND: @AC-1 and @AC-3 (feature 314).
  - The PRESERVE rows need no sign-off: AC-6 @feature-273, AC-7/AC-8 @feature-207, AC-8 @feature-229, AC-4
    @feature-184, AC-25/AC-31 @feature-295, and readiness-materializer write-path-only bounds.
- **Resume**: the next `/sdd-batch` run resumes at round 4 from the state below. Round 4 must close O-13, O-19 and O-20.

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
