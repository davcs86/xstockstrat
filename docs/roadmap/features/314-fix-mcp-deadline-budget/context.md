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
