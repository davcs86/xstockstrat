# Context: opportunity-live-only-rotation

**Feature**: `docs/roadmap/features/366-opportunity-live-only-rotation/feature.md`
**Product Spec**: `docs/roadmap/features/366-opportunity-live-only-rotation/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/366-opportunity-live-only-rotation/implementation-spec.md`

---

## Session 2026-11-26 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Origin: staging vs homelab staging opportunity comparison (2026-11-25/26). AAPL on homelab got only its watchlist-bound dip_buyer_vol_stop row; squeeze_breakout_trend / fundamentals_macd_blend rows went only to the top 20 live-only symbols (exactly 20 symbols / 40 rows from a ~350 pool).
- OPERATOR DECISIONS (2026-11-26, verbatim choices from the question dialog):
  - Semantics: "Rotate across passes" — each compute evaluates the next chunk of max_live_only_symbols_per_compute symbols from a persisted cursor (chosen over "All chunks, one pass" and "All chunks, budgeted").
  - Scope: "Live-only cap only" — max_live_held_symbols_per_compute out of scope.
  - Process: "SDD: story + design full".
- C-16 CHANGE: this reverses feature 131's rejection of cross-pass carried state for the live-only cap (131 context.md:12) and changes 131's AC-8 rule (live-only cap = truncation). 131's scenarios were archived without promotion to a durable suite, so the rule lives only in 131 context.md and services/xstockstrat-analysis/CLAUDE.md (key table). Operator sign-off is the "Rotate across passes" decision above; design must restate it.
- Raised for design (product-spec Open Questions): coverage latency ≈ ceil(P/N) daily computes (~18 days for P≈350, N=20); carried-row valid_until semantics; rotation order under churn; persistence shape vs replace_for_user; reuse of live_loop's scheduler; no behavioral test pins the current cap.

## Session 2026-11-26 — cursor store decision

- OPERATOR DECISION: "yes, use postgres" — rotation cursor persists in Postgres, not Redis. Rationale given: no Redis anywhere in the stack (compose, .do, deploy, service deps); cursor must commit in the same transaction as the queue rows (a split write skips or repeats a chunk, breaking FR-2/FR-6); state is one value per user per ~daily compute; FR-5 restart-survival is free in Postgres; Redis would add a new service in both environments, mTLS wiring (feature 210) and a new failure mode. Preferred shape: cursor column on analysis.opportunity_compute_state (migration 023). Redis does not address the coverage-latency question (cadence-bound, not store-bound).

## Session 2026-11-26 — sdd-review product-spec (round 1: FAIL → revised)

- Tree: c166919 (feature/opportunity-live-only-rotation == origin, main-dev merged).
- Demoted-duplicate check: operator answered "No" — not a re-attempt.
- spec-reviewer round 1: FAIL — criterion 7 (migration strategy unstated, contradictory checkbox), criterion 8 (AC-5 non-observable; AC-2/AC-6 "evaluated" wording; FR-6 removals and FR-7 caps unpinned), criterion 9 (7 open questions unchecked). No Floor breach.
- feature-overlap: no FAIL-level collision. WARN: same function/file as in-flight 308-fix-analysis-per-symbol-isolation (`_compute_opportunities`, `opportunities.py`; 308 debate.md R-4 locks "never drop held/watchlist/muted rows on a failure path") and 330-fix-live-enrich-ttl-seed (`_compute_opportunities` bars request). Spec's "migration 023" was the existing table's creator, not the new migration's number (next free analysis NNN ≥ 030). 364/365 live on PR #1605's branch, not in this checkout.
- OPERATOR DECISIONS (question dialog, verbatim choices):
  - Coverage latency: "Bound the cycle" → FR-2/FR-2a; new key `analysis.opportunity.live_only_cycle_max_days` (int, default 3, bounds [1,30]). The 3-day value is the default the option proposed; a config key, not a literal, per the no-hardcoded-values rule. Per-compute limit wins over the cycle bound, with a recorded shortfall (FR-2a) — orchestrator-stated default, open to operator correction at the design gate.
  - Carried-row freshness: "Keep own age, max age" → FR-8 (row keeps its own computed_at/valid_until; dropped after one full cycle). Existing per-row `valid_until` ("expires" label) carries it — no proto change; an explicit per-row "as of" cue is a design decision.
  - Remaining open questions: "Yes, defer to design" — rotation order, persistence shape vs replace_for_user, C-16 CHANGE restatement, live_loop scheduler reuse, test gap, 308/330 overlap. /sdd-design must resolve each.
- Revisions: product-spec FR-2/FR-2a/FR-3/FR-8, Config Key Changes (new key contract + meaning change of max_live_only_symbols_per_compute), Database Changes (additive ALTER, NNN ≥ 030 re-derived at /sdd-spec, up/down, db-migrate), Consumer Surface UI note; acceptance.feature AC-2/AC-3/AC-5/AC-6 reworded to observable row outcomes, AC-8..AC-12 appended (IDs append-only; AC-1..AC-7 keep their original subjects).

## Session 2026-11-26 — sdd-review product-spec (round 2)

- Product spec approved. Status: draft → spec-ready. Tree: 96a77f2.
- Warnings (carry into /sdd-design):
  - Pin the FR-8 age boundary (`>` vs `>=` at exactly one cycle) so a carried row cannot vanish just before its re-evaluation lands; add a scenario. Cover FR-2a × FR-8 (oversized pool: carried rows aging out when the cycle cannot complete).
  - Update `docs/patterns/config-governance.md:538` and `services/xstockstrat-analysis/CLAUDE.md:274` (cap → chunk-limit meaning); line 538 also says `get_int` but the reader uses `int_positive` — correct it.
  - Confirm AC-9's held-attribution semantics against `servicer.py` at /sdd-spec.
  - Resolve every DEFERRED item; treat 308 debate.md R-4 ("never drop held/watchlist/muted rows on a failure path") as a hard constraint on the carried-row merge.
- Overlap findings: WARN only — 308 (same function + opportunities.py), 330 (same function). No FAIL-level overlap; no merge-order write required.
- Recommended design depth: full (operator choice; also escalated by the schema migration).

## Session 2026-11-26 — sdd-batch design gate (round 2)

- /sdd-design full debate halted at its approval gate after round 2 (gate policy: halt). design.md not written; status.md unchanged (spec-ready). Register: `debate.md` (D-1..D-9, R-1..R-7, O-1..O-14; O-1..O-4 closed @ round 2).

## Open Threads

- **Approach (round-2 synthesis).** Symbol-ordered rotation chunk resumed from a persisted `live_only_cursor` (bisect_right, wrap; D-1) on `analysis.opportunity_compute_state`, written in the same transaction as the queue replace (D-2), with an epoch `to_timestamp(0)` first-insert `valid_until` sentinel. Non-chunk live-only rows are carried only when (a) live-only by provenance, (b) a non-chunk pool symbol, (c) the strategy is in `resolved.universe`, (e) unexpired by both clocks, and (f) the current `best_direction` still resolves to the stored action via `_resolve_action_tag`; `carried_symbols` (suppressing the step-3 `(sym,'')` row) is built from those pre-step-3 predicates, and a fresh-wins `opportunity_key` dedup runs at the append site. One clock: fresh live-only rows are stamped `now + cycle_days x 24h`; a carried row drops at `valid_until <= now OR age >= cycle` (D-7). Read-side revalidation via a scoped `has_expired` (excludes live-only rows, applies the read's symbol/disposition filters) routes to the existing stale branch, preserving the 185 @AC-8 surgical heal on the fresh branch. Carry-read failure fails the whole compute (D-3); held/watchlist/muted rows are always rebuilt fresh (308 R-4).
- **Strongest open objection (O-8, blocking).** An unscoped `has_expired` would send the common partial-expiry state to the stale branch, which skips `retry_symbols` (servicer.py:4775-4789) and silently breaks 185 @AC-8; the proposer must adopt the scoped form or obtain an operator-signed C-16 CHANGE. Also blocking and open: O-9 (action-consistency predicate (f) + RED signal-flip test), O-10 (pre-step-3 `carried_symbols`; every pool symbol keeps >= 1 row), O-11 (epoch sentinel decode pinned by a real_pg test). Non-blocking: O-5 (operator waiver for the uncapped live-only stamp + C-05 docs), O-6 (operator accepts the FR-2 shortfall at P about 350, N=20, or raises N), O-7 (verify against the 308/330 diffs), O-12 (read-driven cursor advance; log on change only), O-13 (unavailable fresh chunk row replaces a good row), O-14 (C-18 queue row-count bound).
- **Floor status.** No Floor breaches.
- **Uncovered @AC changes.** Not covered by an operator decision (all PRESERVE): 185@AC-8 (surgical read-time heal), 185@AC-6, 185@AC-7, 356@AC-5, 356@AC-10, 200@AC-10. Covered by operator decisions: 131@AC-8 CHANGE (live-only truncation per compute becomes rotation), 366@AC-12 EXTEND (carried row older than one cycle dropped; `>=` boundary).

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Round-2 synthesis. The base is proposal r2. I checked the adversary's four blocking claims against the code and amended the plan to fix them. Settled D-1..D-5 are kept, and none of locked R-1..R-3 is reintroduced. All paths are under services/xstockstrat-analysis/.\n\n1. **Chunk (D-1, unchanged).** At step 2b (app/handlers/servicer.py:5541-5547):\n   - pool = sorted(competitive_pool); start = bisect_right(pool, cursor), wrapping to 0; chunk = the next min(N, P) symbols; new_cursor = chunk[-1].\n   - An empty pool leaves the cursor untouched and writes nothing.\n   - N = int_positive('opportunity.max_live_only_symbols_per_compute').\n   - Shortfall (D-5) is computed from the full pool before chunking.\n   - Amended: log INFO and the single WARNING only when (pool bucket, N, cycle_days) changes, following live_loop.py:467-486.\n   - The log line labels projected_computes = ceil(P/N) as computes, not days, because kicks also advance the cursor.\n\n2. **Carry eligibility (closes O-1).**\n   - Collect entry_universe_by_symbol from resolved.universe in the same loop that fills live_by_symbol (servicer.py:5451-5455).\n   - Right after 2b, one repo read loads the stored rows with strategy_id <> ''. If that read fails, the whole compute fails (D-3).\n   - A stored row (sym, strat) is a carry candidate only if all of these hold:\n     - (a) _is_live_only_row(provenance): live_strategy is present and none of watchlist, position or denied is;\n     - (b) sym is in live_signal_symbols and not in chunk;\n     - (c) strat is in entry_universe_by_symbol[sym];\n     - (e) valid_until > now AND now - computed_at < cycle_days;\n     - (f) NEW: the symbol's current signal still resolves to the stored action. Evaluate _resolve_action_tag (servicer.py:6810) with a non-held candidate whose best_direction is the symbol's current direction; it must equal the stored action, otherwise the row is dropped. For a non-held, non-watchlist row only the best_direction branch applies, so a buy that flips to sell returns None and the row is dropped.\n   - carried_symbols is built from the rows that pass (a), (b), (c), (e) and (f), all of which are known before step 3.\n   - Step 3 (servicer.py:5556-5560) skips the (sym, '') row only for symbols in carried_symbols. A symbol whose stored rows all fail a predicate therefore keeps its fresh (sym, '') path.\n   - (d) and the authoritative opportunity_key dedup (fresh row wins) run at the append site:\n     - after step 5 (:5617-5625), the cut (:5639) and the stamp (:5963), and before the symbol_score fold (:5975);\n     - a carried row is removed only when a fresh row with the same key exists, so no symbol is ever left with zero rows.\n   - Carried rows are not traced and do not count against max_universe_size.\n   - Dispositions (DISMISS/SNOOZE/TAKE) live in opportunity_actions and are joined at read time by key (opportunities.py:241-242, 274-279), so they survive a carry with no extra work.\n\n3. **One clock (closes O-3).**\n   - A fresh live-only row is stamped valid_until = now_utc + cycle_days x 24h. All other rows keep session_end + window_hours (:5955-5963).\n   - Drop rule: valid_until <= now OR age >= cycle. This matches the exclusive read filter (opportunities.py:233), so AC-12 (4 days against a 3-day cycle) is dropped.\n   - The heal (:5317-5320) gives the live-only stamp to rows that pass _is_live_only_row, and it resets the FR-8 age.\n\n4. **Read-side revalidation (O-2 mechanism, amended to fix the 185 @AC-8 regression).**\n   - opps.has_expired(user_id, symbol=req_symbol) is a sibling of has_fresh (opportunities.py:340-348), on the budgeted connection (servicer.py:4703, ANALYSIS-14).\n   - Its SQL is EXISTS over the same WHERE clause as read(), minus the validity predicate, and only for rows that are NOT live-only. That means the SQL negation of _is_live_only_row on provenance.\n   - Non-live-only rows share one uniform stamp, so 'any curated row expired' equals today's 'all curated rows expired'.\n   - When it is true: take the existing stale branch exactly (servicer.py:4808-4819: kick_full, served_include_expired = True, include_expired = True).\n   - When it is false: the existing fresh branch runs unchanged, including retry_symbols (:4775-4789). The surgical heal of 185 @AC-8 therefore still fires for unavailable live-only and other rows, and the count_for_user empty path (365 and its batch peer) is untouched.\n   - An expired live-only row is past FR-8 by construction (one clock), so the fresh read hiding it is the intended drop. The daily refresh re-evaluates it.\n\n5. **Atomic persist (D-2).**\n   - _compute_opportunities returns (rows, new_cursor). Its only callers are servicer.py:4952 and :6070.\n   - _replace_and_stamp_compute_state (:4922) opens one connection and one transaction and runs:\n     - replace_for_user(user_id, rows, conn=conn), whose INSERT binds computed_at as COALESCE($n, now()) so carried rows keep their stored value;\n     - then, when the cursor is not None, compute_state.write_cursor(conn, user_id, cursor): INSERT (user_id, computed_at, valid_until, live_only_cursor) VALUES ($1, now(), to_timestamp(0), $2) ON CONFLICT (user_id) DO UPDATE SET live_only_cursor = EXCLUDED.live_only_cursor.\n   - Amended sentinel: to_timestamp(0), the epoch. It is a normal tz-aware timestamptz, so the comparison at servicer.py:4799 needs no special decode, and it is not exposed to clock skew the way now() is. Neither '-infinity' nor now() is used.\n   - Pin the decode with a real_pg test. The empty-gate valid_until is never touched on conflict (185 @AC-6/7).\n   - The test fakes (tests/test_analysis_servicer.py:4501, :5778) gain the conn parameter.\n\n6. **Failure paths.**\n   - Any exception rolls back the queue, the carried rows and the cursor together (356 @AC-5/@AC-10).\n   - Only live-only rows are carried. Held, watchlist and muted rows are always rebuilt fresh (308 R-4). 366 rebases after 308 and 330.\n\n7. **Migrations, config and docs: unchanged from proposal r2.**\n   - Analysis 030: ADD COLUMN live_only_cursor TEXT NULL.\n   - Config 056: seeds opportunity.live_only_cycle_max_days = 3 with bounds {1,30} (configServiceImpl.ts:137, test_config_zero_clamps.py:61, test_config_read_classification.py:56, the platform.feature outline).\n   - C-16 CHANGE docs: CLAUDE.md:274 and config-governance.md:538 (cap becomes chunk limit; get_int becomes int_positive).\n   - valid_window_hours rows: note that the live-only stamp is computed_at + cycle.\n   - Add the carried-row bound next to the :295 worst case.\n\n**RED tests (P-06), written first:**\n- a denied live strategy across two computes, against real PG;\n- a signal flip from buy to sell while the row is carried, so the row is dropped;\n- invariant: every pool symbol has at least one row after a compute;\n- a partial live-only expiry with fresh curated rows: the fresh branch runs and retry_symbols still heals (185 @AC-8);\n- a curated row expires: the stale branch runs;\n- a symbol-scoped read is not flipped by another symbol's expired row;\n- the cursor upsert does not clobber the empty-gate valid_until, and the epoch decode works (real_pg);\n- weekend session_end lag;\n- a heal of a carried live-only row.",
    "open_objections": [
      {
        "text": "has_expired must not count live-only rows, and it must apply the read's own filters (symbol, dispositions). Unscoped, it routes the common partial-expiry state to the stale branch, which skips retry_symbols (servicer.py:4775-4789) and silently breaks 185 @AC-8's surgical heal. It would also let other symbols' rows flip a symbol-scoped read. The synthesis step 4 scoping fixes this; the proposer must adopt it, or obtain an operator-signed C-16 CHANGE to 185 @AC-8.",
        "blocking": true
      },
      {
        "text": "Carry predicate (f): action is recomputed every pass from the current signal (_resolve_action_tag at servicer.py:5877 and 6810; a speculative sell is dropped at :5884), so a carried ENTER row can contradict a flipped signal for up to cycle_days. Carry only when the current best_direction still resolves to the stored action, and add a RED signal-flip test.",
        "blocking": true
      },
      {
        "text": "carried_symbols, which suppresses the step-3 (sym,'') row, must be built from the predicates known before step 3: (a), (b), (c), (e) and (f). The post-step-5 dedup may remove a carried row only when a fresh row with the same key exists. Add an invariant test that every pool symbol has at least one row.",
        "blocking": true
      },
      {
        "text": "The first-insert valid_until sentinel in write_cursor must decode safely at servicer.py:4799. '-infinity' is unverified under asyncpg, and now() is exposed to clock skew. Use to_timestamp(0) (the epoch) and pin it with a real_pg test.",
        "blocking": true
      },
      {
        "text": "Read-driven kicks advance the cursor, so the rotation cadence depends on UI traffic. Log INFO and WARNING only on a change of (pool bucket, N, cycle_days), and label the projection in computes. Alternatively, put 'advance only on the daily refresh' to the operator alongside O-6.",
        "blocking": false
      },
      {
        "text": "An unavailable fresh evaluation of a chunk symbol replaces its previously good live-only row. Recovery relies on the surgical heal, which the scoped has_expired keeps live. Either accept that and record it, or keep the prior eligible row when the fresh row is sym_unavailable.",
        "blocking": false
      },
      {
        "text": "C-18: ListOpportunities paginates the whole queue in Python on every 15s poll (servicer.py:4743-4746), and carried rows reach min(P, N x computes_per_cycle) x max_live_strategies_per_symbol. State the bound in the :295 note, add a row-count test or metric, and decide whether a carried-row cap is warranted.",
        "blocking": false
      },
      {
        "text": "O-5 (pre-existing): the waiver for an uncapped live-only stamp (cycle up to 30 days) needs the operator to record it; the C-05 doc rows must also be updated.",
        "blocking": false
      },
      {
        "text": "O-6 (pre-existing): the operator must accept the shortfall as the default at homelab scale (P about 350, N=20, so about 18 computes per cycle) or raise N to about 117.",
        "blocking": false
      },
      {
        "text": "O-7 (pre-existing, narrowed): the action-source question is resolved (dispositions are joined at read; action is handled by predicate (f)). What remains is to verify against the 308 muted_only/failure-path diff and the 330 live-enrich TTL diff before /sdd-spec.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "131@AC-8 (live-only truncation per compute)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "366@AC-12 (carried row older than one cycle dropped; >= boundary)",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "185@AC-8 (surgical read-time heal)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "185@AC-6",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "185@AC-7",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "356@AC-5",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "356@AC-10",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "200@AC-10",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "An unscoped has_expired, where any expired row selects the stale branch (proposal r2 step 4). It lost because it disables the 185 @AC-8 surgical heal in the common partial-expiry state, and it lets rows outside a symbol-scoped read flip it.",
      "Carry test (b), signal presence only, without an action-consistency check. It lost because action is recomputed from the current direction each pass, so a carried row can contradict a flipped signal.",
      "A '-infinity' first-insert valid_until. It lost because the asyncpg decode is unverified at servicer.py:4799 and risks a TypeError on the cold path. The epoch, to_timestamp(0), is aware and skew-safe.",
      "Recording 'last successful compute' on compute_state as the read trigger (the O-2 runner-up). It lost because it costs the same query and contradicts D-2's cursor-only upsert.",
      "A 168h cap on the live-only stamp. It lost because it silently makes cycle_days > 7 unreachable under the operator-set bounds [1,30]."
    ],
    "open_risks": [
      "When a recompute keeps failing, every read on an expired curated row serves the stale queue and kicks again. The kicks are deduplicated only by the _opportunity_retrying and failure-count guards.",
      "D-3 fail-closed: a transient error on the carry read also blocks the watchlist and held refresh for that compute.",
      "Rotation cadence follows read traffic, because every full kick advances the cursor. The FR-2a projection is only meaningful in computes.",
      "The carried-row volume and the per-poll Python pagination cost (C-18) grow toward P x max_live_strategies_per_symbol under compute storms.",
      "Rebase conflicts with 308 (R-4 failure-path retention) and 330 (live-enrich TTL) in _compute_opportunities; neither diff has been read.",
      "Shortfall is the default state: FR-2's cycle is not achieved at P about 350 and N=20 unless the operator raises N.",
      "The SQL negation of _is_live_only_row in has_expired must stay in lockstep with the Python predicate; a DRY risk, so cover it with a parity test."
    ],
    "constitution_rules_touched": [
      "C-16",
      "C-05",
      "C-11",
      "C-08",
      "C-18",
      "P-02",
      "P-03",
      "P-06",
      "F-01",
      "F-04",
      "F-06",
      "F-07",
      "ANALYSIS-14"
    ],
    "rationale": "I checked the adversary's key claims in the code.\n- **Surgical heal.** servicer.py:4775-4789 computes retry_symbols only on the fresh branch, and its own comment says 'Not on the cold/empty or stale branches'. The unscoped has_expired therefore does regress 185 @AC-8.\n- **Action recomputation.** Action is recomputed every pass at servicer.py:5877 via _resolve_action_tag (:6810). For a non-held, non-watchlist row only the best_direction branch applies, so a flipped signal yields None and the row is dropped. The stale-action objection holds.\n- **Sentinel.** No code anywhere uses '-infinity', so its decode is unverified.\n\nClosures:\n- O-1 closes because the proposal concretely switched to resolved.universe and added the fresh-wins dedup and a real-PG RED test; the adversary agreed it is answered.\n- O-3 closes on the single clock, the pinned drop rule and the heal stamp; the adversary did not object.\n- O-2 closes as a mechanism question (a read-side trigger now exists). Its scoping defect is a new blocking objection, which the synthesized approach fixes by excluding live-only rows and applying the read's filters. Non-live rows share a uniform stamp, so the stale-branch semantics match today's.\n- O-4 closes because the adversary concurred that queue_share is defined over valid rows.\n\nStill open: O-5 (an operator waiver), O-6 (operator acceptance) and O-7, narrowed to the 308/330 diffs.\n\nTwo choices in the sentinel and carried_symbols fixes:\n- The epoch sentinel takes up the adversary's decode concern and the prior synthesis's clock-skew concern together.\n- Building carried_symbols before step 3 prevents a symbol from vanishing.\n\nNo settled D-n is contradicted and no R-n is reintroduced. No REOPEN petitions were filed, and the operator steer reopens nothing.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Carry eligibility: a stored row qualifies only if it is live-only by provenance, its symbol is a non-chunk pool symbol, its strategy is in resolved.universe, and it is unexpired by both clocks. An authoritative fresh-wins dedup by opportunity_key runs at the append site after step 5, the cut and the stamp, and before the symbol_score fold.",
          "evidence": "live_loop.py:108-111; servicer.py:5451-5455, 5617-5639; 011_opportunities.up.sql:21; adversary r2 accepted it as answering O-1"
        },
        {
          "text": "One clock: a fresh live-only row is stamped valid_until = now + cycle_days x 24h, and other rows keep session_end + window_hours. A carried row is dropped when valid_until <= now OR age >= cycle. The heal applies the live-only stamp to live-only rows and resets their age.",
          "evidence": "servicer.py:5955-5963, 5317-5320; opportunities.py:233; operator 'Keep own age, max age'; adversary r2 raised no objection"
        },
        {
          "text": "Carried rows count in GetStrategyAnalytics queue_share with no code change. This is not a C-16 CHANGE, because the share is defined over valid attributed rows.",
          "evidence": "opportunities.py:363-383; adversary r2 had no objection to O-4"
        },
        {
          "text": "Dispositions survive a carry with no extra work, because they are joined at read time from opportunity_actions by opportunity_key.",
          "evidence": "opportunities.py:241-242, 274-279; adversary r2 verification"
        }
      ],
      "new_rejected": [
        {
          "text": "An unscoped has_expired, where any expired row of the user selects the stale branch",
          "why": "It disables the 185 @AC-8 surgical heal, because retry_symbols is computed only on the fresh branch (servicer.py:4775-4789), and it lets out-of-scope rows flip a filtered read."
        },
        {
          "text": "Carry eligibility on signal presence alone, with no action-consistency check",
          "why": "Action is recomputed each pass from the current direction (servicer.py:5877, 6810), so a carried row could keep an action the current signal contradicts."
        },
        {
          "text": "A '-infinity' valid_until sentinel on the first cursor insert",
          "why": "The asyncpg decode is unverified at the servicer.py:4799 comparison and risks a TypeError on the cold/empty path; the epoch, to_timestamp(0), is aware and skew-safe."
        },
        {
          "text": "A 'last successful compute' stamp on compute_state as the read-side staleness trigger",
          "why": "It costs the same query and contradicts D-2's cursor-only on-conflict upsert."
        }
      ],
      "new_objections": [
        {
          "text": "has_expired must exclude live-only rows and apply the read's filters (symbol, dispositions), so the partial-expiry state keeps the fresh branch and the 185 @AC-8 surgical heal; otherwise an operator-signed C-16 CHANGE is required.",
          "blocking": true
        },
        {
          "text": "Add carry predicate (f): the current best_direction must resolve to the stored action via _resolve_action_tag, otherwise drop the row; add a RED signal-flip test.",
          "blocking": true
        },
        {
          "text": "Build carried_symbols, which suppresses the step-3 (sym,'') row, from the pre-step-3 predicates (a)(b)(c)(e)(f) only; dedup removes a carried row only when a fresh row with the same key exists; add an invariant test that every pool symbol has at least one row.",
          "blocking": true
        },
        {
          "text": "The write_cursor first-insert valid_until sentinel must decode safely at servicer.py:4799; use to_timestamp(0) and pin it with a real_pg test.",
          "blocking": true
        },
        {
          "text": "Read-driven kicks advance the cursor: log only on a change of (pool bucket, N, cycle_days), label the projection in computes, and offer the operator 'advance only on the daily refresh'.",
          "blocking": false
        },
        {
          "text": "An unavailable fresh chunk evaluation replaces a good live-only row; either rely on the surgical heal (recorded) or keep the prior eligible row when the fresh row is sym_unavailable.",
          "blocking": false
        },
        {
          "text": "C-18: bound and measure the queue row count, since carried rows enlarge the per-poll full-queue Python pagination (servicer.py:4743-4746); decide whether to cap carried rows.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-1",
          "how": "Proposal r2 tests carry eligibility against resolved.universe (deny-safe), adds the fresh-wins opportunity_key dedup after step 5 and the cut, and adds a real-PG RED test; the adversary accepted it."
        },
        {
          "id": "O-2",
          "how": "A read-side staleness trigger (has_expired routing to the existing stale branch) was adopted; its scoping defect is tracked as a new round-2 blocking objection, and the synthesis includes the fix."
        },
        {
          "id": "O-3",
          "how": "A single clock (live-only valid_until = computed_at + cycle), the pinned drop rule valid_until <= now OR age >= cycle, and the heal applying the live-only stamp."
        },
        {
          "id": "O-4",
          "how": "queue_share is defined over valid attributed rows, so carried rows count with no rule change; the adversary concurred."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-26 — sdd-batch design gate (round 3)

- /sdd-design full debate halted at its approval gate after round 3 (gate policy: halt). design.md not written; status.md unchanged (spec-ready). Register: `debate.md` (D-1..D-13, R-1..R-10, O-1..O-17; O-10 and O-11 closed @ round 3).

## Open Threads

- **Approach (round-3 synthesis).** Proposal r3 plus the adversary's two blocking fixes; D-1..D-9 kept, no R-1..R-7 reintroduced. Symbol-ordered rotation chunk resumed from `live_only_cursor` (D-1, D-5). Before step 3, one fail-closed repo read (D-3) loads stored live-only rows; a row is carried only when (a) live-only by provenance (`_LIVE_ONLY_EXCLUDING_MARKERS`), (b) its symbol is in `competitive_pool` and not in the chunk, (c) its strategy is in `entry_universe_by_symbol[sym]` and `_capped_live(sym)` (FR-7 cap), (e) unexpired by both clocks (D-7), and (f) action-consistent under a three-way rule (D-10): drop when `_resolve_action_tag` on the current `best_direction` returns None; keep without comparing when the provenance holds `fundamentals_unavailable`/`formula_unreadable` (the UNSPECIFIED override, servicer.py:5885-5892); otherwise require equality. `carried_symbols` comes from those predicates only and suppresses the step-3 `(sym,'')` row; carried rows are appended after step 5/cut/stamp with a fresh-wins `opportunity_key` dedup (D-12). Read side (D-11): `_read_opportunity_queue` makes one `opps.read(include_expired=True, same filters)` and splits in Python — any in-scope expired curated row → today's stale branch + kick; else fresh rows → fresh branch with the 185 @AC-8 heal; else → 365's no-rows branch. No has_expired SQL, no WHERE extraction. Persist (D-2, D-13): `_compute_opportunities` returns `(rows, new_cursor)`; queue replace and `write_cursor` share one transaction, with a `to_timestamp(0)` first-insert sentinel pinned by a real_pg test. Touchpoints: analysis migration 030, config 056 (`opportunity.live_only_cycle_max_days`=3, [1,30]), C-16 doc updates; no proto change.
- **Strongest open objection.** O-8 and O-9 (blocking) are answered in this synthesis but stay open until the proposer adopts them in the next round: O-8 — `has_expired` inside the rows branch alone misses the no-rows branch, where 365's unscoped `has_fresh` turns true under the D-7 cycle stamp, so a symbol-filtered read with expired curated rows is served filtered-empty with no kick (the R-3/O-2 hole); fix is the include_expired split plus the RED 365-composition test. O-9 — strict action equality drops carried 215/289 UNSPECIFIED-override rows; fix is the three-way rule plus RED survive/drop tests. Non-blocking for /sdd-spec: O-15 (`_capped_live` on predicate (c)), O-16 (`competitive_pool` in predicate (b)), O-17 (name the cursor plumbing); operator decisions still owed: O-5, O-6, O-12 (kick-driven vs daily-refresh advance), O-13, O-14; O-7 verify against 308/330 diffs.
- **Floor status.** No Floor breaches.
- **Uncovered @AC changes.** Not covered by an operator decision (all PRESERVE): 185@AC-8 (surgical read-time heal), 185@AC-6, 185@AC-7, 289@AC-21 (formula_unreadable marker round-trips storage), 215 fundamentals_unavailable skip row (UNSPECIFIED override), 365@AC-1, 365@AC-2, 131 FR-7 per-symbol live-strategy cap, 356@AC-5, 356@AC-10, 200@AC-10. Covered by operator decisions: 131@AC-8 CHANGE (live-only truncation per compute), 366@AC-12 EXTEND (carried row older than one cycle dropped; `>=` boundary).

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "Round-3 synthesis. The base is proposal r3. I checked the adversary's two blocking defects in the code and folded in their fixes. D-1..D-9 are kept, and none of R-1..R-7 is reintroduced. All paths are under services/xstockstrat-analysis/.\n\n1. **Chunk and cursor (D-1, D-5, unchanged).**\n   - At step 2b (app/handlers/servicer.py:5541-5547): pool = sorted(competitive_pool); start = bisect_right(pool, cursor), wrapping to 0; chunk = the next min(N, P) symbols; new_cursor = chunk[-1].\n   - An empty pool leaves the cursor untouched.\n   - The shortfall is computed from the full pool before chunking.\n   - Per O-12, the log fires only when (pool bucket, N, cycle_days) changes. It carries pool_size, carried_rows and projected_computes = ceil(P/N), labelled in computes.\n\n2. **Carried-rows read and carried_symbols, built before step 3 (O-10 closed).**\n   - One repo read loads the user's stored rows with strategy_id <> ''. If it fails, the whole compute fails (D-3).\n   - A stored row qualifies only if all of these hold:\n     - (a) _is_live_only_row(provenance), using the shared constant _LIVE_ONLY_EXCLUDING_MARKERS = ('watchlist','position','denied');\n     - (b) its symbol is in competitive_pool (amended from live_signal_symbols, so \"pool\" means one thing in (b), in FR-4 and in the shortfall) and is not in chunk;\n     - (c) its strategy is in entry_universe_by_symbol[sym], collected from resolved.universe at :5451-5455, AND in _capped_live(sym) (:5461-5465). This keeps the FR-7 per-symbol cap on the carry path, is deny-safe, and is not R-2;\n     - (e) valid_until > now AND now - computed_at < cycle (D-7);\n     - (f) see item 3.\n   - carried_symbols is the set of symbols of the surviving rows.\n   - Step 3 (:5557-5560) changes to `if not targets and sym not in carried_symbols`.\n   - Carried rows are appended after step 5 (:5617-5625), the cut (:5639) and the stamp (:5963), and before the symbol_score fold. A carried row is removed only when a fresh row with the same opportunity_key exists (fresh wins), so no symbol in carried_symbols can end with zero rows.\n   - Carried rows are not traced and do not count against max_universe_size.\n\n3. **Predicate (f): action consistency, amended for the UNSPECIFIED override (O-9 fix).**\n   - Before step 3, build best_direction_by_symbol from max(sigs, key=conviction).direction. This uses the same tie rule as step 3's strict > at :5601-5603, and a parity test pins it.\n   - Compute `expected = _resolve_action_tag({is_held: False, is_watchlist: False, best_direction: d}, False)` (:6810-6832).\n   - If expected is None, drop the row. A buy that flips to sell lands here.\n   - Else, if the provenance holds 'fundamentals_unavailable' or 'formula_unreadable', keep the row. The stored UNSPECIFIED is the 215/289 override (:5885-5892, verified), so actions are not compared.\n   - Else, require expected == stored action.\n   - Muted UNSPECIFIED rows are already excluded by (a), because they carry the 'denied' marker.\n\n4. **Read-side staleness: one include_expired read, split in Python (replaces the has_expired EXISTS and the WHERE extraction; fixes O-8 on both branches and composes with 365).**\n   - _read_opportunity_queue makes one call, opps.read(..., include_expired=True, the same sources/action_filter/sort/symbol/min_conviction), on the budgeted connection (ANALYSIS-14).\n   - With now = datetime.now(UTC), it computes:\n     - fresh = [r for r in rows if r.valid_until > now], which keeps the ORDER BY order;\n     - stale_curated = any(r.valid_until <= now and not _is_live_only_row(r.provenance)).\n   - If stale_curated: run today's stale branch semantics exactly (kick_full, served_include_expired=True) and serve rows. No retry_symbols are built.\n     - This covers both the partial-expiry case and the adversary's no-rows case: a symbol-filtered read whose curated rows have expired while other symbols' live-only rows are fresh is served stale and kicked.\n     - It closes the R-3/O-2 hole without consulting 365's unscoped has_fresh.\n   - Else, if fresh is non-empty: run the fresh branch with rows = fresh, unchanged, including the 185 @AC-8 retry_symbols heal (:4775-4789).\n   - Else: the existing no-rows branch (:4790-4819) as 365 leaves it (count_for_user, cold-gate state check, 365's `elif not has_fresh`). Expired live-only rows only reach here and are past FR-8 by construction (D-7).\n   - The scoping matches read()'s WHERE exactly (symbol, DISMISS/active-SNOOZE exclusion, conviction floor, filters), because it is the same result set.\n   - No SQL is refactored. The :253 `$3::double precision` anchor and the $6-$9 order are untouched.\n   - The clock is the app clock, already accepted at the :4799 gate.\n   - 366 rebases onto 365 and edits this branch head after 365 lands.\n   - The SQL/Python marker parity test is no longer needed. Only the Python _is_live_only_row reads the constant.\n\n5. **Atomic persist (D-2) with the epoch sentinel (O-11 closed).**\n   - _compute_opportunities returns (rows, new_cursor). Its two callers are :4952-4953 and :6070-6071.\n   - _replace_and_stamp_compute_state (:4922) takes the cursor. When a pool exists, it opens one connection and one transaction and runs:\n     - replace_for_user(user_id, rows, conn=conn), whose INSERT binds computed_at as COALESCE($n, now());\n     - then, when the cursor is not None, write_cursor(conn, user_id, cursor): INSERT (user_id, computed_at, valid_until, live_only_cursor) VALUES ($1, now(), to_timestamp(0), $2) ON CONFLICT (user_id) DO UPDATE SET live_only_cursor = EXCLUDED.live_only_cursor.\n   - On the injected-repo, no-pool test path (:4710), both calls run with conn=None, each on its own repo handle. The fakes (tests/test_analysis_servicer.py:4501, :5778) gain `conn=None`.\n   - OpportunityComputeStateRepository.get (opportunity_compute_state.py:17-27) adds live_only_cursor to its SELECT. The compute reads the cursor through it.\n   - A real_pg test pins three things:\n     - the epoch decodes tz-aware;\n     - `datetime.now(UTC) < valid_until` is False without raising;\n     - a second write_cursor leaves an existing empty-stamp valid_until byte-identical (185 @AC-6/@AC-7).\n\n6. **Non-blocking items.**\n   - O-13: rely on the surgical heal; recorded.\n   - O-14: carried-row bound ≤ min(P−N, N × computes_per_cycle) × max_live_strategies_per_symbol, stated in the CLAUDE.md:295 note. carried_rows is logged. No cap.\n   - O-12: the operator chooses between the kick-driven advance (the status quo design) and 'advance only on the daily refresh'.\n   - O-5, O-6: these need the operator at the gate.\n   - O-7: verify against the 308 and 330 diffs at /sdd-spec.\n\n7. **Touchpoints (unchanged).**\n   - Analysis migration 030: ADD COLUMN live_only_cursor TEXT NULL; the down migration drops it.\n   - Config 056: seeds opportunity.live_only_cycle_max_days=3, bounds [1,30]. Add it to configServiceImpl.ts:137 and the zero-clamp and classification tables.\n   - C-16 docs: CLAUDE.md:274 and config-governance.md:538 (cap becomes chunk limit; get_int becomes int_positive).\n   - No proto change and no new inter-service edge.\n\n**RED tests (P-06):**\n- Predicate (f):\n  - a carried fundamentals_unavailable row survives;\n  - a carried formula_unreadable row survives;\n  - a buy→sell flip drops the row, and also drops a carried skip row (expected is None).\n- Parity of best_direction_by_symbol with step 3.\n- Invariant: no carried_symbols symbol ends with zero rows, and a non-carried symbol keeps the (sym,\"\") row.\n- The per-symbol cap holds on carried rows after max_live_strategies_per_symbol is lowered.\n- Read-side branches:\n  - a partial live-only expiry keeps the fresh branch, and retry_symbols still heals (185 @AC-8);\n  - an expired curated row in scope takes the stale branch and kicks;\n  - a symbol-filtered read whose curated rows have all expired, while other symbols have fresh live-only rows, is served stale and kicked (the 365 composition);\n  - another symbol's expired row does not flip a symbol-scoped read;\n  - a DISMISSed expired curated row does not flip the read;\n  - 365 @AC-1/@AC-2 (a symbol absent from the queue) still serve filtered-empty.\n- The epoch-sentinel real_pg test.",
    "open_objections": [
      {
        "text": "O-8 (amended): has_expired, as proposed, applies only inside the rows branch. After 366, 365's unscoped has_fresh is true whenever any live-only row is fresh (D-7 cycle stamp). A symbol-filtered read whose curated rows have expired then lands in the no-rows branch and is served filtered-empty with no stale serve and no kick, which reintroduces the R-3/O-2 hole. The synthesis replaces this with one include_expired read split in Python (stale_curated → stale branch; fresh → fresh branch plus heal; else → 365's no-rows branch). The proposer must adopt that, or add the scoped expired test ahead of has_fresh in the no-rows branch, with the RED composition test.",
        "blocking": true
      },
      {
        "text": "O-9 (amended): predicate (f) compares the stored action against _resolve_action_tag. That drops every carried fundamentals_unavailable or formula_unreadable live-only row, whose stored action is the UNSPECIFIED override (servicer.py:5885-5892), and breaks 289 @AC-21 and the 215 skip row. Fix: drop when expected is None; keep without comparing when the provenance holds either marker; otherwise require equality. Add the RED survive and drop tests.",
        "blocking": true
      },
      {
        "text": "FR-7 per-symbol cap: predicate (c) must also require strat in _capped_live(sym) (servicer.py:5461-5465). Otherwise carried rows exceed max_live_strategies_per_symbol for up to one cycle after the cap is lowered.",
        "blocking": false
      },
      {
        "text": "Predicate (b) must use competitive_pool rather than live_signal_symbols, so that 'pool' means the same set in the chunk, in FR-4 and in the shortfall figure.",
        "blocking": false
      },
      {
        "text": "Cursor plumbing must be named for /sdd-spec: the _compute_opportunities return shape (rows, new_cursor), live_only_cursor in OpportunityComputeStateRepository.get, the conn=None behaviour on the injected no-pool path (servicer.py:4710), and the conn kwarg on the test fakes (test_analysis_servicer.py:4501, 5778).",
        "blocking": false
      },
      {
        "text": "O-12 (pre-existing, worsened): the stale branch kicks on every poll while any in-scope curated row is expired (all weekend, because of session_end), so the cursor advances back-to-back. The operator must choose kick-driven advance or 'advance only on the daily refresh' before the @AC-10/@AC-11 timing and the shortfall figure can be trusted.",
        "blocking": false
      },
      {
        "text": "O-13 (pre-existing): an unavailable fresh evaluation of a chunk symbol replaces its good live-only row; recovery relies on the surgical heal. This is recorded and accepted unless the operator objects.",
        "blocking": false
      },
      {
        "text": "O-14 (pre-existing): the carried-row bound goes in the CLAUDE.md:295 note and carried_rows is logged. No cap is added, because a cap brings starvation back. The operator should confirm.",
        "blocking": false
      },
      {
        "text": "O-5 (pre-existing): an operator waiver is needed for the uncapped live-only stamp (cycle up to 30 days), together with the C-05 doc updates.",
        "blocking": false
      },
      {
        "text": "O-6 (pre-existing): the operator must accept the FR-2 shortfall as the default outcome at homelab scale, or raise N.",
        "blocking": false
      },
      {
        "text": "O-7 (pre-existing): verify against the 308 (R-4 failure path) and 330 (live-enrich TTL) diffs before /sdd-spec.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "131@AC-8 (live-only truncation per compute)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "366@AC-12 (carried row older than one cycle dropped; >= boundary)",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "185@AC-8 (surgical read-time heal)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "185@AC-6",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "185@AC-7",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "289@AC-21 (formula_unreadable marker round-trips storage)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "215 fundamentals_unavailable skip row (UNSPECIFIED override)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "365@AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "365@AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "131 FR-7 per-symbol live-strategy cap",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "356@AC-5",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "356@AC-10",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "200@AC-10",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "A has_expired EXISTS built on a WHERE builder extracted from read() and called only inside the rows branch (proposal r3 step 4). It lost for three reasons. It misses the no-rows branch, where 365's unscoped has_fresh turns true under the D-7 cycle stamp. Closing that gap needs a second call site. And refactoring read()'s placeholder-ordered SQL (the $3::double precision anchor at opportunities.py:253) puts every ListOpportunities read at risk for one boolean.",
      "Scoping 365's has_fresh by symbol and dispositions instead of testing for expired rows. It lost because it rewrites 365's predicate after 365 lands, and it still cannot tell an expired in-scope row from an absent one.",
      "Predicate (f) as strict equality between _resolve_action_tag and the stored action. It lost because it deletes carried 215/289 UNSPECIFIED-override rows (servicer.py:5885-5892).",
      "Keeping the prior eligible row when the fresh chunk row is sym_unavailable (the O-13 option). It lost because it contradicts fresh-wins (D-6) and FR-8 own-age; the surgical heal recovers it.",
      "A cap on carried rows (the O-14 option). It lost because it brings back the starvation the rotation exists to remove."
    ],
    "open_risks": [
      "The include_expired read moves expired rows on every poll. The volume is bounded by queue size, but carried rows grow it (O-14) and weekends make every curated row expired.",
      "Freshness is judged by the app clock rather than DB now(); app/DB skew shifts the boundary by the skew. The same trade-off is already accepted at the servicer.py:4799 gate.",
      "366 edits the head of _read_opportunity_queue, which 365 also changes. The rebase order must be 365 first, then 308 and 330, then 366; none of these diffs has been read.",
      "Under weekend stale-branch kicks, the cursor advances on every recompute (O-12), so rotation cadence follows traffic.",
      "D-3 fail-closed: a transient error on the carry read also blocks the held and watchlist refresh for that compute.",
      "best_direction_by_symbol stays correct only while step 3 keeps its iteration order and strict >; a parity test pins this implicit coupling, and a shared helper is deferred.",
      "In the no-rows branch, a symbol-filtered read of a symbol whose only rows are expired live-only rows is served filtered-empty whenever 365's has_fresh is true. That is the intended FR-8 drop, but it is visible during a shortfall.",
      "Shortfall is the default at P about 350 and N=20 unless the operator raises N (O-6)."
    ],
    "constitution_rules_touched": [
      "C-16",
      "C-05",
      "C-11",
      "C-08",
      "C-18",
      "P-02",
      "P-03",
      "P-06",
      "F-01",
      "F-04",
      "F-06",
      "F-07",
      "ANALYSIS-14"
    ],
    "rationale": "I checked both of the adversary's blocking claims against the code.\n\n**O-9: predicate (f).** At servicer.py:5885-5892, a non-held row's action is set to OPPORTUNITY_ACTION_TAG_UNSPECIFIED when fund_skip is set or formula_unreadable is set. Strict equality in (f) would therefore drop exactly the 215/289 rows that recon marked PRESERVE. O-9 stays open with the amended three-way rule.\n\n**O-8: has_expired and 365.** At servicer.py:4790-4819, the no-rows branch is the only path a symbol-filtered read with zero fresh rows can take. has_fresh (opportunities.py:340-348) is unscoped. Under D-7, any fresh live-only row makes it true, so 365's `elif not has_fresh` would serve filtered-empty for a symbol whose curated rows have expired. That is the R-3 hole again. O-8 stays open.\n\n**The read-side fix.** Rather than adding a second has_expired call site, the synthesis adopts the adversary's alternative: one include_expired read, split in Python. It resolves O-8 on both branches with exact read() scoping and fewer statements. It also removes the proposer's self-named strongest risk, the refactor of read()'s placeholder-ordered SQL, and the need for an SQL/Python marker parity check. Its cost (expired rows transferred, app clock) is recorded as a risk. It contradicts no D-n. It is not R-4 (it is scoped), not R-7 (no compute_state stamp) and not R-3 (it adds a read-side trigger).\n\n**Closures.**\n- O-10 closes: carried_symbols comes from the pre-step-3 predicates, dedup removes a carried row only on a key collision, and the invariant test was added. The adversary verified it.\n- O-11 closes: the to_timestamp(0) sentinel plus the real_pg decode and no-clobber test. The adversary verified the comparison at :4798-4799.\n\n**Non-blocking fixes folded in.** The adversary's non-blocking points (the _capped_live cap, the competitive_pool consistency, and the cursor plumbing) are folded into the approach and recorded as new non-blocking objections so /sdd-spec checks them.\n\n**Register.** No REOPEN petitions were filed, and the operator steer reopens nothing.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "The live-only chunk's carry predicate (f) is three-way: drop when _resolve_action_tag on the current best_direction returns None; keep without comparing actions when the provenance holds fundamentals_unavailable or formula_unreadable (the stored UNSPECIFIED override); otherwise require equality with the stored action. best_direction_by_symbol is built before step 3 with step 3's tie rule.",
          "evidence": "servicer.py:5877-5892 (UNSPECIFIED override verified), 5601-5603, 6810-6832; adversary r3"
        },
        {
          "text": "The read-side staleness decision is one opps.read(include_expired=True, same filters) split in Python. Any in-scope expired non-live-only row selects today's stale branch. Otherwise, fresh rows take the fresh branch, including the 185 @AC-8 heal. Otherwise, the read falls through to 365's no-rows branch. No has_expired SQL and no WHERE extraction.",
          "evidence": "servicer.py:4770-4819; opportunities.py:250-253, 340-348; adversary r3 alternative and the 365 composition defect"
        },
        {
          "text": "carried_symbols is built from the pre-step-3 predicates only, and step 3 suppresses (sym,'') only for those symbols. The post-step-5 dedup removes a carried row only when a fresh row has the same opportunity_key.",
          "evidence": "servicer.py:5557-5560, 5617-5639; adversary r3 verified the invariant"
        },
        {
          "text": "write_cursor's first-insert valid_until is to_timestamp(0), and the on-conflict update touches only live_only_cursor. A real_pg test pins the aware decode and the no-clobber behaviour.",
          "evidence": "servicer.py:4798-4799; 023_opportunity_compute_state.up.sql:8-13; adversary r3 verified"
        }
      ],
      "new_rejected": [
        {
          "text": "A has_expired EXISTS sharing an extracted read() WHERE builder, called only in the rows branch",
          "why": "It misses the no-rows branch, where 365's unscoped has_fresh turns true under the D-7 cycle stamp, and it refactors the placeholder-anchored read() SQL (opportunities.py:253) that every ListOpportunities read uses."
        },
        {
          "text": "Strict stored-action equality as carry predicate (f)",
          "why": "It drops carried 215 fundamentals_unavailable and 289 formula_unreadable rows, whose stored action is the UNSPECIFIED override (servicer.py:5885-5892)."
        },
        {
          "text": "Scoping 365's has_fresh instead of testing for in-scope expired rows",
          "why": "It rewrites 365's predicate after 365 lands, and it cannot tell an expired in-scope row from an absent one."
        }
      ],
      "new_objections": [
        {
          "text": "FR-7: carry predicate (c) must also require strat in _capped_live(sym) (servicer.py:5461-5465), so carried rows never exceed max_live_strategies_per_symbol.",
          "blocking": false
        },
        {
          "text": "Carry predicate (b) must use competitive_pool, not live_signal_symbols, so that 'pool' is one set across the chunk, FR-4 and the shortfall.",
          "blocking": false
        },
        {
          "text": "Name the cursor plumbing for /sdd-spec: the _compute_opportunities return shape (rows, new_cursor), live_only_cursor in compute_state.get, conn=None on the injected no-pool path (servicer.py:4710), and the conn kwarg on the test fakes.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-10",
          "how": "Proposal r3 builds carried_symbols from the pre-step-3 predicates, removes a carried row in the dedup only on a fresh opportunity_key collision, and adds the invariant test; the adversary verified it."
        },
        {
          "id": "O-11",
          "how": "Proposal r3 uses the to_timestamp(0) first-insert sentinel and a real_pg decode and no-clobber test; the adversary verified the comparison at servicer.py:4798-4799."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-26 — sdd-batch design gate (round 4)

- /sdd-design full debate halted at its approval gate after round 4 (gate policy: halt). design.md not written; status.md unchanged (spec-ready). Register: `debate.md` (D-1..D-14, R-1..R-14, O-1..O-23; O-5, O-6, O-8, O-9, O-12..O-17 closed @ round 4).

## Open Threads

- **Approach (round-4 synthesis).** Proposal r4 with D-1..D-13 kept, none of R-1..R-10 reintroduced, and the operator decisions on O-5 ('Accept both': live-only `valid_until = now + cycle_days × 24h`, no 168h cap, documented next to `valid_window_hours`), O-6 (the FR-2a shortfall is the expected default, logged at INFO) and O-12 ('Every recompute': the cursor advances on every compute, logs labelled in computes and fired only on a change of (pool bucket, N, cycle_days)). Chunk = the next `min(N, P)` symbols of `sorted(competitive_pool)` after `bisect_right(pool, cursor)`, wrapping; empty pool writes no cursor. Before step 3, a new fail-closed `read_live_attributed(user_id)` (plain SELECT, no actions join, no conviction floor) loads stored rows; a row is carried only when (a) live-only by provenance, (b) in `competitive_pool` and not in the chunk, (c) `strat in _capped_live(sym)` AND `(sym, strat) not in set(denied_covered)` (FR-7 cap plus the deny half that restores D-6's universe test), (e) `valid_until > now AND now - computed_at < cycle`, and (f) D-10's three-way action rule. Carried rows are appended after step 5/cut/stamp with fresh-wins dedup. Read side (D-11 + new D-14): one `include_expired=True` read; stale_curated → today's stale branch + kick; fresh with `n_expired == 0` → serve as read; fresh with `n_expired > 0` → re-issue today's unchanged `include_expired=False` read (no Python filtering, because every `_SORT_ORDER_BY` ranks by a symbol-partition window aggregate), no `kick_full` (R-14); else → 365's no-rows branch. Both fresh branches run the 185 @AC-8 heal. Persist: `_compute_opportunities` returns `(rows, new_cursor)`; `replace_for_user` (with `COALESCE($14::timestamptz, now())`) and `write_cursor` share one transaction; the empty-rows `upsert` stays outside and after it. Touchpoints: analysis migration 030, config 056 (`opportunity.live_only_cycle_max_days` = 3, [1,30]), analysis CLAUDE.md, config-governance.md:538, services/xstockstrat-analysis/docs/opportunities.md:7, database.md if it lists `opportunity_compute_state` columns; no proto change.
- **Strongest open objection.** O-18 (blocking): predicate (c) as `_capped_live(sym)` alone reads the pre-deny `resolved.union` (live_loop.py:128-130, 155-156; servicer.py:5451-5455), so it is the locked R-2 and drops D-6's universe test; FR-4's "deny-listed → removed" would rest on a dedup side effect. The synthesis carries the fix (`and (sym, strat) not in set(denied_covered)`) plus a RED test in which a carried (AAPL, squeeze) row is denied and only the muted placeholder remains; it stays open until the proposer adopts it. Non-blocking: O-19 (branch (iv) is the routine steady state — state it and measure the second read; any predicate-(e) lookahead needs the operator), O-20 (all-sell pool gives `rows == []` with a non-null cursor — test it), O-21 (`$14::timestamptz` anchor + real_pg mixed-None test), O-22 (missing C-05 doc touchpoints), O-23 (document that (e)'s age clause matters only after `cycle_max_days` is lowered, and the residual), O-7 (verify against 308/330/365 diffs at /sdd-spec; rebase order 365 → 308, 330 → 366).
- **Floor status.** No Floor breaches.
- **Uncovered @AC changes.** Not covered by an operator decision (all PRESERVE): 185@AC-8 (surgical read-time heal), 185@AC-6, 185@AC-7, 190@AC-8 (symbol-group ordering), 190@AC-9 (symbol-group ordering / paging tiebreak), 132 deny list (deny-listed pair removed; FR-4), 289@AC-21 (formula_unreadable marker round-trips storage), 215 fundamentals_unavailable skip row (UNSPECIFIED override), 365@AC-1, 365@AC-2, 131 FR-7 per-symbol live-strategy cap, 193@AC-1 (blend evaluates only on fundamentals universe), 356@AC-5, 356@AC-10, 200@AC-10. Covered by operator decisions: 131@AC-8 CHANGE (live-only truncation per compute), 366@AC-12 EXTEND (carried row older than one cycle dropped; `>=` boundary), 366 EXTEND (live-only `valid_until = computed_at + cycle_max_days`, overriding `valid_window_hours` for live-only rows).

```sdd-batch-design-state
{
  "round": 4,
  "synth": {
    "approach": "Round-4 synthesis. The base is proposal r4. I kept D-1..D-13, brought none of R-1..R-10 back, and applied the operator decisions on O-5, O-6 and O-12. I checked the adversary's blocking claim in the code and it holds: `resolve_universe` builds `union` before the deny list is applied (app/engine/live_loop.py:128-130, 155). Deny is applied only in `universe = (union - denied) | deny_entry` (:156). `live_by_symbol` is filled from `resolved.union` (servicer.py:5451-5452), and `denied_covered` collects `denied & union` (:5454-5455). The fix for this is folded into item 2(c). All paths are under services/xstockstrat-analysis/.\n\n1. **Chunk and cursor (D-1, D-5, O-16, O-12, O-6).**\n   - At step 2b (servicer.py:5541-5547), `pool = sorted(competitive_pool)`.\n   - `start = bisect_right(pool, cursor)`, wrapping to 0. `chunk` is the next `min(N, P)` symbols, wrapping modulo P. `new_cursor = chunk[-1]`.\n   - An empty pool returns `new_cursor = None`, so the cursor is not written.\n   - The cursor advances on every compute: the stale and cold kicks (:4942) and the daily refresh (:6045). This is the operator's 'Every recompute'.\n   - The shortfall is computed from the full pool. It is logged at INFO, and only when (pool bucket, N, cycle_days) changes. Fields: user, pool_size, carried_rows, projected_computes = ceil(P/N). It is labelled in computes, not days. Per the operator's O-6 decision it is the expected default outcome, not an error.\n\n2. **Carry read and predicates, all before step 3 (D-3, D-6, D-10, D-12).**\n   - A new `OpportunitiesRepository.read_live_attributed(user_id)` is a plain SELECT of all columns plus `computed_at`, `valid_until` and `composite_score`, with `WHERE user_id = $1 AND strategy_id <> ''`.\n   - It has no actions join and no conviction floor. `read()` filters DISMISS and applies the floor (opportunities.py:204-253), so it cannot serve this read.\n   - If this read fails, the compute fails (D-3).\n   - A stored row qualifies only if all of these hold:\n     - (a) `_is_live_only_row(row)`: `strategy_id != ''`, `'live_strategy'` is in provenance, and none of `('watchlist', 'position', 'denied')` is present.\n     - (b) its symbol is in `competitive_pool` and not in `chunk`.\n     - (c) **(corrected this round)** `strat in _capped_live(sym)` (:5461-5465) AND `(sym, strat) not in denied_covered_set`, where `denied_covered_set = set(denied_covered)` from :5455.\n       - The `_capped_live` half is the FR-7 cap (closes O-15).\n       - The deny half restores D-6's `resolved.universe` test. For a non-held symbol, `(sym, strat) ∉ denied_covered` is the same as `sym ∈ resolved.universe` for that strategy. Held symbols are already excluded by (a).\n       - Without the deny half, (c) is the locked R-2.\n     - (e) `valid_until > now AND now - computed_at < cycle` (D-7). A row aged exactly one cycle is dropped (the `>=` boundary). @AC-12's 4-day-old row under a 3-day cycle drops.\n       - The age clause is redundant for rows stamped under the current cycle. It does real work only after an operator lowers `cycle_max_days`. The spec must say so, so that no one deletes it as dead code.\n     - (f) D-10 verbatim. `expected = _resolve_action_tag({is_held: False, is_watchlist: False, best_direction: d}, False)`:\n       - drop when `expected` is None (verified: a non-held sell returns None at servicer.py:6602-6604);\n       - keep without comparing when provenance holds `fundamentals_unavailable` or `formula_unreadable`;\n       - otherwise require `expected == stored action`.\n   - `carried_symbols` is the set of symbols of the surviving rows. Step 3 (:5557-5560) becomes `if not targets and sym not in carried_symbols`.\n   - Carried rows are appended after step 5, the cut and the stamp loop (:5961-5963), and before the `symbol_score` fold (:5975-5983).\n   - On an `opportunity_key` collision the fresh row wins.\n   - Carried rows are not traced and do not count against `max_universe_size`.\n\n3. **Stamp (D-7, O-5 operator decision).**\n   - A fresh live-only row gets `valid_until = now + cycle_days × 24h`. Every other row keeps `session_end + window_hours` (:5961).\n   - The heal (`replace_symbols`) applies the same live-only stamp, which resets the row's age.\n   - There is no 168h cap. This is documented next to `opportunity.valid_window_hours` in CLAUDE.md (C-05).\n\n4. **Read-side staleness (D-11 decision rule, served per the new D-14).**\n   - (i) Run one `opps.read(include_expired=True, same filters)` and compute `stale_curated`, `fresh` and `n_expired`.\n   - (ii) If `stale_curated`: take today's stale branch exactly, serve these rows, set `kick_full` and `served_include_expired = True`.\n   - (iii) Else, if `fresh` is non-empty and `n_expired == 0`: serve the rows as read. They are identical to today's fresh read.\n   - (iv) Else, if `fresh` is non-empty and `n_expired > 0`: re-issue today's unchanged `include_expired=False` read (servicer.py:4765-4774) and serve that.\n     - The reason: every `_SORT_ORDER_BY` branch ranks a symbol by a window aggregate over its whole partition (opportunities.py:42-60, verified), so filtering in Python would reorder symbol groups (190 @AC-8/@AC-9).\n     - Branch (iv) sets no `kick_full` (R-14).\n   - (v) Else: 365's no-rows branch, unchanged.\n   - Branches (iii) and (iv) run the 185 @AC-8 `retry_symbols` heal (:4776-4789).\n   - The second statement runs sequentially on the same budgeted connection (ANALYSIS-14).\n   - **Branch (iv) is the routine steady state, not an edge case.** Under the default 3-day cycle and a daily refresh, some chunk sits expired-but-uncomputed for about 24 h. The design states this, and the second read is counted in a metric or log so its cost is measured.\n\n5. **Atomic persist (D-2, D-13, O-17).**\n   - `_compute_opportunities` returns `(rows, new_cursor)`. Its callers are :4952-4953 and :6070-6071.\n   - `_replace_and_stamp_compute_state(user_id, rows, propagation_meta=None, cursor=None)` (:4922) works like this:\n     - With a pool, it runs one `async with pool.acquire() as conn, conn.transaction()`.\n     - Inside it: `replace_for_user(user_id, rows, conn=conn)`. Its INSERT binds `computed_at` as `COALESCE($14::timestamptz, now())`, with an explicit type anchor (fails.md:2352-2355).\n     - Then, if `cursor` is not None: `write_cursor(conn, user_id, cursor)`, which runs `INSERT … VALUES ($1, now(), to_timestamp(0), $2) ON CONFLICT (user_id) DO UPDATE SET live_only_cursor = EXCLUDED.live_only_cursor`.\n     - The existing best-effort empty-rows `upsert` (:4933-4940) stays outside and after the transaction, and touches only `computed_at` and `valid_until`.\n   - An empty-rows compute with a non-null cursor **can** occur. An all-sell pool yields `rows == []` (servicer.py:5884, 6602-6604). The ordering above handles it, but the spec must not assume it cannot happen.\n   - On the injected no-pool path (:4710), both calls take `conn=None`. The fakes at tests/test_analysis_servicer.py:4501 and :5778 gain a `conn=None` kwarg.\n   - `OpportunityComputeStateRepository.get` (opportunity_compute_state.py:17-27) adds `live_only_cursor` to its SELECT.\n   - A failure raises before the transaction, so the queue, carried rows and cursor are all left unchanged (356 @AC-5/@AC-10, 308 R-4).\n\n6. **Recorded non-blocking items.**\n   - O-13: rely on the surgical heal.\n   - O-14: no cap. The bound `≤ min(P−N, N × computes_per_cycle) × max_live_strategies_per_symbol` goes in the CLAUDE.md:295 note, and `carried_rows` is logged.\n   - O-7: a gate at /sdd-spec. Rebase order: 365, then 308 and 330, then 366.\n\n**RED tests (P-06):**\n- Carried from r3/r4:\n  - predicate (f): keep with each of the two markers; drop on a buy→sell flip;\n  - parity of `best_direction_by_symbol` with step 3;\n  - the zero-row invariant;\n  - the cap holds on carried rows after `max_live_strategies_per_symbol` is lowered;\n  - read branches (ii), (iii), (iv) and (v), the 365 composition, symbol scope and DISMISS;\n  - sort parity for sorts 0-3 with expired live-only rows present (real_pg);\n  - an expired `(sym, '')` row selects the stale branch;\n  - restart: the cursor and the carried `valid_until` survive a new servicer instance (real_pg, AC-5);\n  - the epoch-sentinel decode and no-clobber test.\n- New this round:\n  - **Deny**: a carried (AAPL, squeeze) row, then squeeze denies AAPL. The result is exactly one row for that key, the muted placeholder, and the carried row is rejected by (c) before the dedup.\n  - **All-sell pool**: the cursor advances, the empty stamp is applied, and `upsert` does not clobber `live_only_cursor`.\n  - **`$14` binding**: a real_pg `executemany` with mixed None and datetime `computed_at`, plus the INSERT added to the bound-param-referenced guard.\n\n**Touchpoints:**\n- Migrations:\n  - analysis 030 (re-derive at /sdd-spec): `ADD COLUMN live_only_cursor TEXT NULL`, with a down migration.\n  - config 056: seeds `opportunity.live_only_cycle_max_days = 3`, bounds [1,30]. Add it at configServiceImpl.ts:137, test_config_zero_clamps.py:61 and test_config_read_classification.py:56.\n- Docs:\n  - services/xstockstrat-analysis/CLAUDE.md:274 and :295, and the `valid_window_hours` row;\n  - docs/patterns/config-governance.md:538 (`get_int` → `int_positive`, plus the new row);\n  - **services/xstockstrat-analysis/docs/opportunities.md:7** (read branches and the cursor transaction in the helper);\n  - the `opportunity_compute_state` columns in docs/patterns/database.md, if it lists them.\n- No proto change and no new inter-service edge.",
    "open_objections": [
      {
        "text": "Predicate (c) as worded in proposal r4 is not deny-safe. `_capped_live` reads `live_by_symbol`, which is built from `resolved.union`. That set is pre-deny coverage (live_loop.py:128-130, 155-156; servicer.py:5451-5455, where `denied_covered = denied & union` proves that union contains denied symbols). (c) alone is therefore the locked R-2, and it drops D-6's `resolved.universe` test, so FR-4's 'deny-listed → removed' rests on a dedup side effect. Fix: (c) = `strat in _capped_live(sym) and (sym, strat) not in set(denied_covered)`, plus the RED test in which a carried (AAPL, squeeze) row is denied and the result is exactly the muted placeholder.",
        "blocking": true
      },
      {
        "text": "Read branch (iv) (fresh rows plus expired live-only rows, re-read with include_expired=False) is the routine steady state under the default 3-day cycle and daily refresh, so most polls run two reads. The design must state this as steady state and measure the re-read (a log or counter). (iv) must never set kick_full (R-14). An optional predicate-(e) lookahead (treating valid_until <= now + one refresh interval as expired) would shorten visible lifetime below the cycle, so it needs the operator's sign-off before adoption.",
        "blocking": false
      },
      {
        "text": "The claim that 'an empty-rows compute with a non-empty pool cannot occur' is false. An all-sell pool yields rows == [] (servicer.py:5884, 6602-6604) with a non-null cursor. The spec must not rely on that claim. Add a test: an all-sell pool means the cursor advances, the empty stamp is applied, and upsert does not clobber live_only_cursor.",
        "blocking": false
      },
      {
        "text": "Type-anchor the new computed_at bind as COALESCE($14::timestamptz, now()) (fails.md:2352-2355). Add a real_pg executemany test with mixed None and datetime values, and extend the bound-param-referenced guard to the new INSERT.",
        "blocking": false
      },
      {
        "text": "C-05 doc touchpoints are missing services/xstockstrat-analysis/docs/opportunities.md:7 (the stale-while-revalidate branches, and the _replace_and_stamp_compute_state sites that now carry the cursor transaction). They also miss the opportunity_compute_state columns in docs/patterns/database.md, if that file lists them.",
        "blocking": false
      },
      {
        "text": "The age clause in predicate (e) is load-bearing only after cycle_max_days is lowered; the spec must say so. Residual: rows stamped under the old, longer cycle stay visible on fresh reads past the new cycle until the next compute, because the read filters on valid_until only (opportunities.py:233).",
        "blocking": false
      },
      {
        "text": "O-7: verify the carried-row re-INSERT against the 308 (R-4 failure path) and 330 (live-enrich TTL) diffs, and against 365 after it merges, at /sdd-spec. Rebase order: 365, then 308 and 330, then 366.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "131@AC-8 (live-only truncation per compute)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "366@AC-12 (carried row older than one cycle dropped; >= boundary)",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "366 live-only valid_until = computed_at + cycle_max_days (overrides valid_window_hours for live-only rows)",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "185@AC-8 (surgical read-time heal)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "185@AC-6",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "185@AC-7",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "190@AC-8 (symbol-group ordering)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "190@AC-9 (symbol-group ordering / paging tiebreak)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "132 deny list (deny-listed pair removed; FR-4)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "289@AC-21 (formula_unreadable marker round-trips storage)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "215 fundamentals_unavailable skip row (UNSPECIFIED override)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "365@AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "365@AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "131 FR-7 per-symbol live-strategy cap",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "193@AC-1 (blend evaluates only on fundamentals universe)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "356@AC-5",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "356@AC-10",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "200@AC-10",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "A Python re-sort of the fresh rows that mirrors _SORT_ORDER_BY (the proposer's runner-up). It lost because it duplicates four SQL orderings, including NULLS LAST and the $3 blend, and those copies would drift (DRY). The second read is cheap at queue sizes of a few hundred rows.",
      "`MAX(...) FILTER (WHERE valid_until > now()) OVER (...)` inside read(). It lost because it changes the stale branch's ordering semantics and edits the placeholder-anchored read() SQL that R-8 guards.",
      "A read-path DELETE of expired live-only rows. It lost because it puts writes on the budgeted read-only DB phase (ANALYSIS-14) and races _opportunity_lock.",
      "Setting kick_full in read branch (iv). It lost because each compute stamps one shared expiry, so every expiry-kick schedules another kick one cycle later. Kick chains never merge, so the compute rate grows without bound, and each kick advances the cursor (O-12).",
      "Predicate (c) as `_capped_live(sym)` alone. It lost because it reads the pre-deny resolved.union (the locked R-2) and drops D-6's universe test."
    ],
    "open_risks": [
      "Read branch (iv) is the common steady state, so most polls run two full reads on the budgeted connection. The cost is not yet measured.",
      "366 edits the head of _read_opportunity_queue, which 365 has just rewritten. The 308, 330 and 365 diffs have not been read (O-7).",
      "Freshness is judged by the app clock, not DB now(); app/DB skew shifts the boundary. The same trade-off is already accepted at servicer.py:4799.",
      "D-3 fails closed: a transient error on the carry read also blocks that compute's held and watchlist refresh.",
      "best_direction_by_symbol stays correct only while step 3 keeps its iteration order and its strict >. A parity test pins this coupling.",
      "At homelab scale (P about 350, N=20), the shortfall is the accepted default (O-6), and rotation cadence follows compute traffic (O-12).",
      "After cycle_max_days is lowered, rows stamped under the old, longer cycle stay visible on fresh reads until the next compute.",
      "Expired live-only rows sit invisible for about 24 h after a d+3 refresh keeps a chunk that then expires minutes later. An optional lookahead fix needs the operator."
    ],
    "constitution_rules_touched": [
      "C-16",
      "C-05",
      "C-11",
      "C-08",
      "C-18",
      "P-02",
      "P-03",
      "P-06",
      "F-01",
      "F-04",
      "F-06",
      "F-07",
      "ANALYSIS-14"
    ],
    "rationale": "I checked the adversary's claims against the code.\n\n**Deny (blocking).** live_loop.py:128-130 and 155-156 show that `union` is pre-deny coverage, and that deny is applied only to `universe`. servicer.py:5451-5455 fills `live_by_symbol` from `union` and collects `denied & union` into `denied_covered`. Predicate (c) as `_capped_live` alone is therefore the locked R-2 and drops D-6's universe test. I honored the register rather than recording a new decision: the approach carries the corrected (c), and the objection stays open and blocking until the proposer adopts it.\n\n**Sort parity.** opportunities.py:42-60 confirms that all four sorts rank by symbol-partition window aggregates. Python-filtering an include_expired read reorders symbol groups. This is new evidence, not on record in D-11 or R-8. The fix keeps D-11's decision rule and changes only which rows are served, so it is recorded as an amending decision (D-14), not a supersession. No reopen petition is needed.\n\n**Sell row.** servicer.py:6602-6604 confirms that a non-held sell returns None. This validates predicate (f)'s flip-drop and also falsifies the stated empty-rows invariant.\n\n**Closures.**\n- O-8 closes: D-11 plus D-14 is adopted, and the adversary verified branches (ii)-(iv).\n- O-9 closes: D-10 is adopted with RED tests, and the sell-is-None assumption is now verified.\n- O-5, O-6 and O-12 close by explicit operator decisions.\n- O-15 closes: the `_capped_live` cap is included. The separate deny gap is a new objection.\n- O-16 closes: the pool is `competitive_pool`.\n- O-17 closes: the plumbing is named in item 5, and the adversary did not object.\n- O-13 and O-14 close as recorded dispositions (rely on the heal; no cap, with a documented bound and a logged count). The adversary raised no objection.\n- O-7 stays open as a /sdd-spec gate.\n\n**Register.** No D-n is contradicted and no R-n is reintroduced. The proposer filed no unconditional REOPEN, and the operator steer reopens nothing.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Under D-11, a read branch's rows are served only from a read whose WHERE matches that branch, never Python-filtered. Branch (iii) (fresh, n_expired == 0) serves the include_expired=True rows as read. Branch (iv) (fresh, n_expired > 0, which can only mean expired live-only rows) re-issues today's unchanged include_expired=False read, sequentially on the same budgeted connection, and sets no kick_full. Both branches run the 185 @AC-8 heal.",
          "evidence": "opportunities.py:42-60 (every _SORT_ORDER_BY branch ranks by a symbol-partition window aggregate; verified r4); servicer.py:4765-4774, 4776-4789; adversary r4 verified the branch identities"
        }
      ],
      "new_rejected": [
        {
          "text": "A Python re-sort of the fresh rows that mirrors _SORT_ORDER_BY",
          "why": "It duplicates four SQL orderings (NULLS LAST, the $3 blend) that would drift (DRY), and the second read is cheap at queue sizes of a few hundred rows."
        },
        {
          "text": "`MAX(...) FILTER (WHERE valid_until > now()) OVER (...)` inside read()",
          "why": "It changes the stale branch's ordering semantics and edits the placeholder-anchored read() SQL that R-8 guards (opportunities.py:253)."
        },
        {
          "text": "A read-path DELETE of expired live-only rows",
          "why": "It puts writes on the budgeted read-only DB phase (ANALYSIS-14) and races _opportunity_lock (servicer.py:4951, 4987, 6069)."
        },
        {
          "text": "Setting kick_full in read branch (iv), the partial live-only expiry state",
          "why": "Each compute stamps one shared expiry, so every expiry-kick schedules another one cycle later. Chains never merge, so the compute rate grows without bound, and each kick advances the cursor (O-12)."
        }
      ],
      "new_objections": [
        {
          "text": "Predicate (c) must be `strat in _capped_live(sym) and (sym, strat) not in set(denied_covered)`. _capped_live reads the pre-deny resolved.union (live_loop.py:128-130, 155-156; servicer.py:5451-5455), so on its own it is R-2 and drops D-6's universe test. Add a RED test: a carried row whose strategy then denies the symbol leaves only the muted placeholder.",
          "blocking": true
        },
        {
          "text": "Read branch (iv) is the routine steady state (3-day cycle, daily refresh). State it as such and measure the second read (a log or counter). Any predicate-(e) lookahead that shortens visible lifetime below the cycle needs the operator.",
          "blocking": false
        },
        {
          "text": "An empty-rows compute with a non-null cursor occurs for an all-sell pool (servicer.py:5884, 6602-6604). Do not rely on the opposite claim. Test that the cursor advances, the empty stamp is applied, and live_only_cursor is not clobbered.",
          "blocking": false
        },
        {
          "text": "Type-anchor COALESCE($14::timestamptz, now()) (fails.md:2352-2355). Add a real_pg executemany test with mixed None and datetime values, and extend the bound-param-referenced guard to the new INSERT.",
          "blocking": false
        },
        {
          "text": "Add services/xstockstrat-analysis/docs/opportunities.md:7 and, if it lists the columns, the opportunity_compute_state entry in docs/patterns/database.md to the C-05 doc touchpoints.",
          "blocking": false
        },
        {
          "text": "Document that predicate (e)'s age clause is load-bearing only after cycle_max_days is lowered, and record the residual: old rows stay visible on fresh reads until the next compute (opportunities.py:233).",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-5",
          "how": "Operator decision 2026-11-26 ('Accept both'): live-only rows are stamped computed_at + cycle_max_days with no extra 168h cap, documented next to valid_window_hours (C-05)."
        },
        {
          "id": "O-6",
          "how": "Operator decision 2026-11-26 ('Accept both'): the FR-2a shortfall is the expected default at homelab scale, logged at INFO, not an error."
        },
        {
          "id": "O-8",
          "how": "Proposal r4 adopts D-11's one include_expired read, with branches stale_curated -> stale, fresh -> fresh plus heal, else -> 365's no-rows branch. The new D-14 serving rule fixes symbol-group ordering. The adversary verified branches (ii)-(iv) against servicer.py:4765-4819."
        },
        {
          "id": "O-9",
          "how": "Proposal r4 adopts D-10's three-way predicate (f) with RED tests for keep and drop. The adversary confirmed that a non-held sell resolves to None (servicer.py:6602-6604), so a buy->sell flip drops."
        },
        {
          "id": "O-12",
          "how": "Operator decision 2026-11-26 ('Every recompute'): the cursor advances on every compute. Logs are labelled in computes and fire only on a change of (pool bucket, N, cycle_days)."
        },
        {
          "id": "O-13",
          "how": "Recorded disposition: recovery of an unavailable fresh chunk row relies on the surgical heal. Keeping the prior row contradicts fresh-wins (D-6). The adversary raised no objection in r4."
        },
        {
          "id": "O-14",
          "how": "Recorded disposition: no cap on carried rows. The bound min(P-N, N x computes_per_cycle) x max_live_strategies_per_symbol goes in the CLAUDE.md:295 note, and carried_rows is logged. The adversary raised no objection in r4."
        },
        {
          "id": "O-15",
          "how": "Predicate (c) now requires strat in _capped_live(sym) (servicer.py:5461-5465), so the FR-7 per-symbol cap holds on carried rows. The deny gap is tracked as a separate new objection."
        },
        {
          "id": "O-16",
          "how": "Predicate (b) and the chunk both use competitive_pool, so 'pool' is one set across the chunk, FR-4 and the shortfall."
        },
        {
          "id": "O-17",
          "how": "Proposal r4 item 5 names the plumbing: the (rows, new_cursor) return, the callers at :4952-4953 and :6070-6071, live_only_cursor in compute_state.get, conn=None on the :4710 no-pool path, and the conn kwarg on the fakes at test_analysis_servicer.py:4501 and :5778. The adversary did not object."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-26 — sdd-batch design gate (round 5)

- /sdd-design full debate halted at its approval gate after round 5 (gate policy: halt). design.md not written; status.md unchanged (spec-ready). Register: `debate.md` (D-1..D-16, R-1..R-16, O-1..O-25; O-18..O-23 closed @ round 5; O-7, O-24, O-25 open, all non-blocking).

## Open Threads

- **Approach (round-5 synthesis).** Proposal r5 carries r4 forward with D-1..D-14 and the operator decisions on O-5, O-6 and O-12 kept, and none of R-1..R-14 reintroduced. New this round: carry predicate (c) is deny-safe, `strat in _capped_live(sym) and (sym, strat) not in denied_covered_set` (D-15). It is exact for non-held symbols, and predicates (a) and (b) guarantee those, so no second `resolve_universe` pass is needed (R-15). Read branch (iv) is documented as the routine steady state, never kicks (R-14), and is counted by a new module-level `analysis.opportunity.read_reissue` Counter (D-16; a log was rejected, R-16). The persist path is `_replace_and_stamp_compute_state(..., cursor=None)`: replace_for_user plus write_cursor run in one transaction, with `COALESCE($14::timestamptz, now())` binding computed_at, and the best-effort empty-universe upsert stays after the transaction. New RED tests: deny on a carried row (asserted per opportunity_key, with (sym,'') parity), held+denied pinning predicate (b), an all-sell pool, mixed None/datetime binds in real_pg, a lowered cycle (5 to 3 drops a 4-day-old row), and the read_reissue counter on branch (iv) only. Touchpoints: analysis migration 030 (live_only_cursor) and config migration 056 (opportunity.live_only_cycle_max_days = 3, [1,30]), both renumbered at /sdd-spec, plus the C-05 docs (analysis CLAUDE.md :274/:295 and § Observability, config-governance.md:538, docs/opportunities.md:7, and database.md if it lists the columns). No proto change and no new inter-service edge.
- **Strongest open objection.** O-7 (non-blocking, the /sdd-spec gate): verify the carried-row re-INSERT against the 308 diff (R-4: no failure path may drop held, watchlist or muted rows), the 330 diff and the 365 diff once it merges, in rebase order 365, then 308 and 330, then 366. Also open and non-blocking: O-24 (list read_reissue and the exact D-5 shortfall log text in CLAUDE.md § Observability) and O-25 (/sdd-spec must accept or remove the empty-stamp-failure residual; accepting it is the default and preserves 177's never-fail-the-write behaviour).
- **Floor status.** No Floor breaches. The adversary returned SOUND in round 5.
- **Uncovered @AC changes.** None is a CHANGE or EXTEND without operator cover. 131@AC-8 (CHANGE), 366@AC-12 and the live-only valid_until = computed_at + cycle_max_days stamp (EXTEND) are covered by operator decisions. Not covered by an operator decision (all PRESERVE): 132 deny list (FR-4), 131 FR-7 per-symbol live-strategy cap, 185@AC-6, 185@AC-7, 185@AC-8 (surgical heal), 190@AC-8, 190@AC-9, 177 empty-universe stamp, 289@AC-21, 215 fundamentals_unavailable skip row, 365@AC-1, 365@AC-2, 193@AC-1, 356@AC-5, 356@AC-10, 200@AC-10.

```sdd-batch-design-state
{
  "round": 5,
  "synth": {
    "approach": "Round-5 synthesis. The base is proposal r5, which carries the r4 synthesis forward. It honors D-1..D-14 and the operator decisions on O-5, O-6 and O-12, and brings back none of R-1..R-14. I checked the adversary's r5 claims against the code and they hold:\n- servicer.py:5451-5455 fills live_by_symbol from resolved.union and collects denied ∩ union into denied_covered.\n- _capped_live (:5461-5465) is pre-deny.\n- live_signal_symbols applies `- held_norm` (:5540).\n- Step 3 (:5557-5560) runs before the step-5 muted loop (:5619-5625).\n- The empty-universe upsert runs after replace_for_user and is best-effort (:4932-4940).\n- _OPPORTUNITY_RECOMPUTE is a module-level Counter (telemetry.py:444-446).\n\nAll paths below are under services/xstockstrat-analysis/.\n\n**1. Chunk and cursor (D-1, D-5; O-6 and O-12 operator decisions). Unchanged from r4.**\n- The chunk is taken from `pool = sorted(competitive_pool)`, starting at bisect_right(pool, cursor) and wrapping.\n- The cursor advances on every compute.\n- The shortfall is computed from the full pool and logged at INFO, only when (pool bucket, N, cycle_days) changes. It is labelled in computes.\n\n**2. Carry predicates, all before step 3 (D-6, D-10, D-12).**\n- (a) The row is live-only by provenance.\n- (b) sym is in competitive_pool and not in the chunk. competitive_pool is already non-held (:5540).\n- (c) **Final form:** `strat in _capped_live(sym) and (sym, strat) not in denied_covered_set`, where `denied_covered_set = set(denied_covered)` is built once after :5455.\n  - For a non-held sym, `(sym, strat) ∉ denied_covered` holds exactly when sym is in resolved.universe for that strategy (live_loop.py:147,150,155-156). This also holds for the blend.\n  - This restores D-6's universe test with no second resolve_universe pass.\n  - The _capped_live half takes cap slots in pre-deny order, the same way as the fresh path (:5535-5537), so carry and fresh agree on which strategies fit under the FR-7 cap.\n  - A carried pair that becomes denied is rejected at (c), before carried_symbols is built.\n  - **The non-held precondition rests on predicate (b)**, through competitive_pool's `- held_norm`, as well as on (a). The spec must document this dependency on both (a) and (b).\n- (e) The row is kept only while `valid_until > now AND now - computed_at < cycle`; a row aged exactly one cycle drops (>=).\n  - The age clause matters only after cycle_max_days is lowered, and must not be deleted as dead code.\n  - Residual: rows stamped under the old, longer cycle stay visible on fresh reads until the next compute, because the read filters on valid_until only (opportunities.py:233).\n- (f) is D-10 verbatim.\n\nCarried rows are appended after step 5, the cut and the stamp (:5961-5963), and before the symbol_score fold. Fresh rows win on an opportunity_key collision.\n\n**3. Stamp (D-7, O-5).**\n- A fresh live-only row gets `valid_until = now + cycle_days × 24h`, with no 168h cap.\n- The heal (replace_symbols) applies the same stamp to live-only rows.\n- replace_symbols never writes the cursor, because the heal does not advance rotation (fails.md:2282-2284). The spec states this.\n\n**4. Read side (D-11, D-14).**\n- Branches (i)-(v) are as in r4.\n- **Branch (iv) is the documented routine steady state.** Under a 3-day cycle and a daily refresh, about one chunk sits expired for roughly 24 h, so most polls in that window run two reads.\n- (iv) never sets kick_full (R-14). It runs sequentially on the same budgeted connection (ANALYSIS-14).\n- (iv) increments a new label-free module-level `Counter(\"analysis.opportunity.read_reissue\", ...)` beside _OPPORTUNITY_RECOMPUTE (telemetry.py:444-446), through a named helper like its siblings, not an ad-hoc create_counter.\n- The predicate-(e) lookahead is not adopted, because it needs operator sign-off. The roughly 24 h invisibility is a documented residual.\n\n**5. Atomic persist (D-2, D-13).**\n- `_compute_opportunities` returns (rows, new_cursor).\n- `_replace_and_stamp_compute_state(..., cursor=None)` (:4922) opens one pool.acquire() and conn.transaction(). Inside it:\n  - replace_for_user(conn=conn), whose INSERT binds `COALESCE($14::timestamptz, now())`. A fresh row passes None; a carried row passes its stored computed_at.\n  - then write_cursor(conn) when cursor is not None, using the to_timestamp(0) first insert and the cursor-only ON CONFLICT.\n- The best-effort empty-universe upsert (:4932-4940) stays outside and after the transaction. It only SETs computed_at and valid_until, so it cannot clobber live_only_cursor.\n- An all-sell pool yields rows == [] with a non-null cursor (:5884; :6602-6604). The design does not claim otherwise.\n- Accepted residual (default, preserving 177's 'a stamp failure never fails the write', :4939): if the stamp fails after a committed cursor advance, every poll recomputes until the next stamp succeeds, and each such compute advances the cursor (O-12). /sdd-spec records this, or the operator chooses to move the stamp into the transaction.\n- conn=None on the no-pool path (:4710). The fakes at tests/test_analysis_servicer.py:4501 and :5778 gain a conn kwarg. compute_state.get selects live_only_cursor.\n\n**RED tests (P-06).** All r4 tests carry over. New this round:\n- **Deny.** A carried (AAPL, squeeze_breakout_trend) row whose strategy then denies AAPL leaves exactly one row **for that opportunity_key**, the muted placeholder, rejected at (c). The test also asserts that the (AAPL, \"\") row is present or absent exactly as it would be for a never-carried denied non-chunk symbol (parity with today).\n- **Held + denied + a carried row present → the carried row is dropped.** The test is documented as pinning predicate (b), not only (a).\n- **All-sell pool.** The cursor advances, the empty stamp is applied, and live_only_cursor survives the upsert.\n- **Mixed binds.** A real_pg executemany with mixed None and datetime $14 values. The new INSERT is added to the bound-param-referenced guard (tests/test_opportunities_repo.py:236+).\n- **Lowered cycle.** Lowering the cycle from 5 to 3 drops a 4-day-old carried row.\n- **Re-read counter.** read_reissue increments on branch (iv) only.\n\n**Touchpoints.**\n- Migrations, both renumbered at /sdd-spec:\n  - analysis 030: `ADD COLUMN live_only_cursor TEXT NULL`, with a down migration;\n  - config 056: seeds opportunity.live_only_cycle_max_days = 3, bounds [1,30]. Also touch configServiceImpl.ts:137, test_config_zero_clamps.py:61 and test_config_read_classification.py:56.\n- Docs (C-05):\n  - services/xstockstrat-analysis/CLAUDE.md:274 and :295, plus the valid_window_hours row;\n  - **CLAUDE.md § Observability: the read_reissue instrument, and the exact message text of the shortfall log;**\n  - docs/patterns/config-governance.md:538 (get_int → int_positive, plus the new row);\n  - services/xstockstrat-analysis/docs/opportunities.md:7 (branches (i)-(v), the cursor transaction, and the steady-state note on (iv));\n  - docs/patterns/database.md, if it lists the opportunity_compute_state columns.\n- No proto change and no new inter-service edge.\n- O-7 stays the /sdd-spec gate. Rebase order: 365, then 308 and 330, then 366.",
    "open_objections": [
      {
        "text": "O-7: at /sdd-spec, verify the carried-row re-INSERT against the 308 diff (R-4: no failure path may drop held, watchlist or muted rows), the 330 diff (live-enrich TTL, same function) and the 365 diff once it merges. Rebase order: 365, then 308 and 330, then 366.",
        "blocking": false
      },
      {
        "text": "C-05 / FR-2a observability. CLAUDE.md § Observability must list the new analysis.opportunity.read_reissue counter. The counter is defined at module level beside _OPPORTUNITY_RECOMPUTE (telemetry.py:444-446) with a named helper. The same section must record the D-5 shortfall diagnostic's exact log message text, because operators alert on that text.",
        "blocking": false
      },
      {
        "text": "The empty-universe stamp stays best-effort and outside the cursor transaction (servicer.py:4932-4940). If the stamp fails after the cursor advance commits, every poll recomputes and advances the cursor until a stamp succeeds. /sdd-spec must explicitly either accept this residual, which is the default and preserves 177's 'a stamp failure never fails the write', or move the stamp into the transaction.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "131@AC-8 (live-only truncation per compute)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "366@AC-12 (carried row older than one cycle dropped; >= boundary)",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "366 live-only valid_until = computed_at + cycle_max_days (overrides valid_window_hours for live-only rows)",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "132 deny list (deny-listed pair removed / muted placeholder; FR-4)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "131 FR-7 per-symbol live-strategy cap",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "185@AC-6",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "185@AC-7",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "185@AC-8 (surgical read-time heal)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "190@AC-8 (symbol-group ordering)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "190@AC-9 (symbol-group ordering / paging tiebreak)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "177 empty-universe compute-state stamp (best-effort, never fails the write)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "289@AC-21 (formula_unreadable marker round-trips storage)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "215 fundamentals_unavailable skip row (UNSPECIFIED override)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "365@AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "365@AC-2",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "193@AC-1 (blend evaluates only on fundamentals universe)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "356@AC-5",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "356@AC-10",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "200@AC-10",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Calling resolve_universe a second time, or carrying a per-strategy resolved.universe dict, for predicate (c). It lost because it duplicates state that denied_covered already holds (C-18 DRY) and costs an extra pass. The set lookup is exact for non-held symbols, and predicates (a) and (b) guarantee those symbols are non-held.",
      "A rate-limited INFO log, instead of a counter, for the branch-(iv) second read. It lost because (iv) is the steady state on a 15 s UI poll, so a log line is noise. The Counter wrapper (telemetry.py:325-338) costs nothing extra and swallows errors.",
      "A predicate-(e) lookahead that treats rows expiring within one refresh interval as expired. It is not adopted, because it shortens visible lifetime below the cycle, and that needs operator sign-off nobody has requested. The operator can still choose it, so it is not locked.",
      "Predicate (c) as _capped_live(sym) alone. It lost because that is the locked R-2: it reads the pre-deny resolved.union."
    ],
    "open_risks": [
      "Branch (iv) is the common steady state, so most polls run two reads on the budgeted connection. The cost is now measured by read_reissue but not yet bounded.",
      "Expired live-only rows stay invisible for about 24 h between their expiry and the next compute that reaches their chunk. This is an accepted residual, and the lookahead fix is left to the operator.",
      "Predicate (c)'s deny equivalence relies on carried symbols being non-held, which predicates (a) and (b) guarantee. A later change to either predicate could let a held+denied (deny_entry) pair through. A RED test pins this.",
      "After a committed cursor advance, a failed empty-universe stamp leaves each poll recomputing and advancing the cursor until a stamp succeeds. This is the existing 177 behaviour, amplified by O-12.",
      "366 edits the head of _read_opportunity_queue, which 365 has just rewritten, and the 308, 330 and 365 diffs are still unread (O-7).",
      "Freshness is judged by the app clock, not DB now(), so app/DB skew shifts the boundary. The same trade-off is already accepted at servicer.py:4799.",
      "D-3 fails closed: a transient error on the carry read also blocks that compute's held and watchlist refresh.",
      "best_direction_by_symbol stays correct only while step 3 keeps its iteration order and its strict >. A parity test pins this coupling.",
      "After cycle_max_days is lowered, rows stamped under the old, longer cycle stay visible on fresh reads until the next compute."
    ],
    "constitution_rules_touched": [
      "C-16",
      "C-05",
      "C-11",
      "C-08",
      "C-18",
      "P-02",
      "P-03",
      "P-06",
      "F-01",
      "F-04",
      "F-06",
      "F-07",
      "ANALYSIS-14"
    ],
    "rationale": "The adversary returned SOUND with no floor breaches. I checked its load-bearing claims in the code this round:\n- servicer.py:5451-5455 shows union-based live_by_symbol and denied_covered = denied ∩ union.\n- :5540 shows live_signal_symbols minus held_norm, which feeds competitive_pool.\n- :5557-5560, against :5619-5625, shows step 3 running before the step-5 muted placeholders. So today a non-chunk denied symbol gets both a (sym,'') row and the placeholder. That is why the deny RED test must assert per opportunity_key, with parity for (sym,'').\n- :4932-4940 shows the empty upsert is outside the transaction, after it, and best-effort.\n- telemetry.py:444-446 shows the module-level Counter pattern.\n\nClosures:\n- **O-18** closes. The deny-safe (c) is adopted and verified (live_loop.py:147,150,155-156), and the deny RED test is added. I record it as D-15 because r4 carried it only as approach text.\n- **O-19** closes. (iv) is stated as the steady state and counted by read_reissue (D-16). It never kicks (R-14), and the lookahead is declined pending the operator.\n- **O-20** closes. The ordering argument is verified, the all-sell RED test is added, and the false claim is dropped. The stamp-failure residual is a new non-blocking item.\n- **O-21** closes. The $14::timestamptz anchor, the mixed real_pg test and the guard extension are adopted.\n- **O-22** closes. Both doc touchpoints are added.\n- **O-23** closes. The age clause is documented as load-bearing, with the lowering RED test, and the residual is recorded.\n- **O-7** stays open as the /sdd-spec gate.\n\nTwo new non-blocking objections capture the adversary's remaining C-05 points: Observability doc entries for the counter and the shortfall log text, and an explicit spec choice on the empty-stamp residual. Neither blocks approval.\n\nRegister check: no D-n is contradicted, no R-n is reintroduced, no closed O-n is re-raised, no petitions were filed, and the operator steer reopens nothing.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Carry predicate (c) is `strat in _capped_live(sym) and (sym, strat) not in denied_covered_set`, where denied_covered_set = set(denied_covered) is built once after servicer.py:5455. For a non-held sym this holds exactly when sym is in resolved.universe for that strategy. A carried pair that becomes denied is rejected at (c), before carried_symbols is built. The non-held precondition rests on predicate (b) (competitive_pool excludes held_norm) as well as on (a), and the spec documents both. The RED test asserts per opportunity_key that only the muted placeholder remains, and that the (sym,'') row has parity with a never-carried denied symbol.",
          "evidence": "live_loop.py:147,150,155-156; servicer.py:5451-5455, 5461-5465, 5535-5540, 5557-5560, 5619-5625; adversary r5 verified the equivalence, including the blend"
        },
        {
          "text": "Read branch (iv) is documented as the routine steady state. It never sets kick_full and is measured by a new label-free module-level Counter analysis.opportunity.read_reissue beside _OPPORTUNITY_RECOMPUTE, with a named helper, listed in CLAUDE.md § Observability. The predicate-(e) lookahead is not adopted without operator sign-off.",
          "evidence": "telemetry.py:325-338, 444-446; servicer.py:4765-4774; R-14; adversary r5"
        }
      ],
      "new_rejected": [
        {
          "text": "A second resolve_universe pass, or a per-strategy resolved.universe dict, for carry predicate (c)",
          "why": "It duplicates state that denied_covered already holds (C-18 DRY) and costs an extra pass. The set lookup is exact because carried symbols are non-held under predicates (a) and (b)."
        },
        {
          "text": "A rate-limited per-user INFO log, instead of a counter, for the branch-(iv) re-read",
          "why": "(iv) is the steady state on a 15 s poll, so a log line is noise. The Counter wrapper costs nothing extra and swallows errors (telemetry.py:325-338)."
        }
      ],
      "new_objections": [
        {
          "text": "C-05 / FR-2a: list analysis.opportunity.read_reissue in CLAUDE.md § Observability, as a module-level Counter beside _OPPORTUNITY_RECOMPUTE (telemetry.py:444-446) with a named helper. Record the D-5 shortfall log's exact message text in the same section, because operators alert on that text.",
          "blocking": false
        },
        {
          "text": "The empty-universe stamp is best-effort and runs outside the cursor transaction (servicer.py:4932-4940). A stamp failure after a committed cursor advance makes every poll recompute and advance the cursor until a stamp succeeds. /sdd-spec must explicitly either accept this residual, which is the default and preserves 177's never-fail-the-write property, or move the stamp into the transaction.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-18",
          "how": "Proposal r5 adopts the deny-safe predicate (c), `strat in _capped_live(sym) and (sym, strat) not in denied_covered_set` (D-15), with a RED test asserted per opportunity_key. The adversary r5 verified the equivalence against live_loop.py:147,150,155-156 and servicer.py:5454-5455."
        },
        {
          "id": "O-19",
          "how": "(iv) is stated as the steady state, counted by analysis.opportunity.read_reissue, and never kicks (R-14). The lookahead is declined pending the operator (D-16)."
        },
        {
          "id": "O-20",
          "how": "The false claim is dropped. The ordering (replace, then cursor inside the transaction, then the upsert of computed_at and valid_until after it) was verified at servicer.py:4932-4940, and an all-sell RED test was added. The stamp-failure residual is tracked as a new non-blocking objection."
        },
        {
          "id": "O-21",
          "how": "The INSERT binds COALESCE($14::timestamptz, now()), and a real_pg executemany test covers mixed None and datetime values. The new INSERT is added to the bound-param-referenced guard (tests/test_opportunities_repo.py:236+)."
        },
        {
          "id": "O-22",
          "how": "services/xstockstrat-analysis/docs/opportunities.md:7 (branches (i)-(v), the cursor transaction, steady-state (iv)) and docs/patterns/database.md (if it lists the columns; /sdd-spec confirms) are added to the C-05 touchpoints."
        },
        {
          "id": "O-23",
          "how": "The spec documents the age clause as load-bearing only after cycle_max_days is lowered, adds a RED test that lowers 5 to 3 and expects a 4-day-old row to drop, and records the opportunities.py:233 residual."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-26 — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-analysis, plus the xstockstrat-config seed and bounds; key reuse patterns: the live_loop identity-resume bisect cursor, `live_loop.py:459-510`, and the single `_replace_and_stamp_compute_state` write helper, `servicer.py:4922`).
- Phase 1 Grilling: 5 rounds (full). The adversary returned SOUND in round 5 with no Floor breaches. The operator approved the round-5 synthesis at the gate ('Approve', 2026-11-26). Termination: approved. debate.md State is now approved. No reopen petitions were filed, so none needed a 'user declined' verdict.
- Chosen approach: each compute evaluates the next chunk of `opportunity.max_live_only_symbols_per_compute` symbols from `sorted(competitive_pool)`, starting at a persisted `live_only_cursor` (bisect_right, wrap). Rows from earlier chunks are carried forward under predicates (a)(b)(c)(e)(f). The cursor commits in the same transaction as `replace_for_user`. Fresh live-only rows are stamped `now + cycle_days × 24h`. The read side uses one `include_expired=True` read split into branches (i)-(v).
- Rejected: R-1..R-16, all locked and listed in design.md § Rejected Alternatives. The headline rejections are R-2 (union-based carry eligibility), R-4 and R-8 (has_expired variants), R-14 (kicking on partial expiry) and R-15 (a second resolve_universe pass).
- Constitution rules touched: C-16, C-05, C-08, C-11, C-18, P-02, P-03, P-06, F-01, F-04, F-06, F-07, ANALYSIS-14. Floor breaches: none.
- Business rules: CHANGE 131@AC-8 (operator-signed, 'Rotate across passes'). EXTEND 366@AC-12 (the `>=` boundary), the live-only `valid_until` override (O-5), and the 244 stored-zero row for the new key. All other affected @AC are PRESERVE (design.md § Business Rules Touched).
- Ledger: no line added. The reusable traps found here (for example R-14) are feature-specific until a second occurrence.
- Status: spec-ready → design-approved.

### Decisions

- Round-5 synthesis, D-1..D-16 (debate.md), is the approved design. The binding operator rulings are 'Rotate across passes', 'Live-only cap only', 'use postgres', 'Bound the cycle', 'Keep own age, max age', O-5 'Accept both', O-6 'Accept both', O-8/O-9 (round 3), O-12 'Every recompute', round 4 'Another round', and round 5 'Accept ~24h gap', 'Keep best-effort' and 'Approve'.
- Rebase order: 365, then 308 and 330, then 366.

### Open Threads

- [ ] O-7: verify the carried-row re-INSERT against the 308 diff (R-4: never drop held, watchlist or muted rows on a failure path), the 330 diff and the merged 365 diff. Target: the `/sdd-spec` gate, before any step is written.
- [ ] O-24: list `analysis.opportunity.read_reissue` and the exact D-5 shortfall log text in `services/xstockstrat-analysis/CLAUDE.md` § Observability. Target: the `/sdd-spec` docs step.
- [ ] O-25: record as accepted the residual where a failed empty-universe stamp makes each poll recompute and advance the cursor (operator default 'Keep best-effort'). Target: `/sdd-spec` persist step.
- [ ] Branch (iv) runs two reads on most polls. `read_reissue` measures this but does not bound it. Target: the read-side step.
- [ ] Expired live-only rows are invisible for about 24 h until their next chunk compute (accepted residual). Target: the docs step (`opportunities.md`).
- [ ] Predicate (c)'s deny equivalence depends on (a) and (b) keeping carried symbols non-held. Target: the compute step, with the held+denied RED test.
- [ ] Freshness uses the app clock, not DB `now()` (the same trade-off as `servicer.py:4799`). Target: the compute step, documented only.
- [ ] D-3 fails closed: a carry-read error also blocks that compute's held and watchlist refresh. Target: the compute step (356 @AC-5/@AC-10 tests).
- [ ] `best_direction_by_symbol` is coupled to step 3's iteration order and strict `>`. Target: the compute step (parity test).
- [ ] After `cycle_max_days` is lowered, rows stamped under the old cycle stay visible on fresh reads until the next compute. Target: the docs step plus the lowered-cycle RED test.
- [ ] Re-derive the migration numbers (analysis `030`, config `056`) from the merged tree. Target: `/sdd-spec`.

## Session 2026-11-26 — sdd-spec

- Wrote implementation-spec.md with 11 steps. Status: design-approved → implementation-ready. Tree: `origin/feature/opportunity-live-only-rotation@dfa444c2` (`origin/main-dev@34f68c57` is 1 commit ahead, with no `services/` diff).
- Atomic units (§C):
  - Steps 4+5+6. The `_compute_opportunities` return becomes `(rows, new_cursor)`, which breaks about 25 unpacking test call sites and 3 stubs. A new read must be classified in `test_config_read_classification.py`. The config `056` seed must land with its reader, because CI's `check-config-wiring.mjs --final` gates read-unseeded and seeded-unread keys.
  - Steps 9+10. The first read becomes `include_expired=True`, which turns `tests/test_analysis_servicer.py:7930` (`[False, True]` → `[True, True]`) red.
- Key codebase findings:
  - Migration numbers: analysis `030` and config `056` are free on all 220 remote refs (`git log --remotes --diff-filter=A`).
  - Step 6 must regenerate `scripts/config-wiring-stored.json` with `scripts/config-wiring-stored.py`, which needs a DB. Use the CI artifact fallback, as in 330. Never hand-edit it.
  - The `read_path` "pool" fixture swaps `self._db_pool` for a `FakePool` whose `acquire` is a coroutine (`tests/conftest.py:280-288`). So the persist transaction is opened through a new `OpportunitiesRepository.transaction()`, on the same pool.
  - `docs/patterns/database.md` does not list the `opportunity_compute_state` columns, so it needs no change (O-22).
- O-7 gate result:
  - 365 has no code yet; the Precondition gates Step 9 on its `elif not await opps.has_fresh(user_id):`.
  - 308 does not touch step 2b, the stamp or the persist path, so its R-4 holds.
  - 330 has no conflict.
  - Finding: under the binding O-9 rule, a carried 308 `evaluation_failed` row (stored UNSPECIFIED) is compared and dropped; its symbol falls back to `(sym, "")`. Changing that needs an operator ruling.

### Decisions

- Pool bucket in the O-12 log key = `projected_computes = -(-P // N)`. The shortfall fires when `projected_computes > cycle_max_days`. The exact INFO text is `opportunity live-only rotation shortfall: user=%s pool=%d per_compute=%d projected_computes=%d cycle_max_days=%d` (O-24 text fixed). These are assumptions for impl-spec review.
- The cursor read and the carried-row read run only when `competitive_pool` is non-empty.
- Pure helpers `_rotation_chunk`, `_carry_within_cycle` and `_is_live_only_row` pin the `>=` boundary and the wrap/churn cases without patching the clock.
- O-25 is recorded as accepted (operator 'Keep best-effort'): the empty stamp stays outside and after the queue+cursor transaction.
- Read branch (v) also covers "only expired live-only rows" and falls through to 365's body.

### Open Threads

- [ ] O-7 residual: re-verify after 308 merges (line numbers move; re-locate sites by symbol), and gate Step 9 on 365 being merged.
- [ ] Impl-spec review: confirm Assumptions 1-5 (spec § Assumptions) and the 308 `evaluation_failed` finding.

## Session 2026-11-26 — sdd-review impl-spec (advisory)

- Result: 0 failures, 7 warnings (advisory, did not block). No Floor breach. Lifecycle unchanged (implementation-ready). Tree: `origin/feature/opportunity-live-only-rotation@5497ad67`.
- Addressed in implementation-spec.md:
  - [x] Config wiring criterion (b): Step 5 item 3 adds a real-reader test in `tests/test_config_zero_clamps.py`. It builds `AnalysisServicer(snapshot_watcher(...))` with the value parsed from the config `056` up.sql and with a stored `5`, and asserts `_live_only_cycle_days()` returns it.
  - [x] C-14: the consumer-surface rationale moved to § Step Dependencies (served rows map through `_row_to_opportunity`, `servicer.py:4746`/`:6925`, per-row `valid_until`). Step 10 adds a `ListOpportunities` test with distinct per-row `valid_until` values.
  - [x] Steps 4 and 6 now point to one combined Verification block in Step 5, covering analysis tests, config tests and lint, and `check-config-wiring.mjs --final`/`--doc-check`.
  - [x] The 308 `evaluation_failed` finding is now a row in § Open Risks, which points to the Open Thread below.
- Unresolved ⚠ carried into execution:
  - Step 4: [ ] unaddressed. Needs an operator ruling on the 308 interaction. A carried `evaluation_failed` live-only row (stored UNSPECIFIED) is outside the O-9 keep-list, so it is dropped and its symbol falls back to `(sym, "")`. Rule before Step 4 executes or 308 merges. Otherwise record it as an accepted residual in Step 11 (P-03).
  - Step 9: [ ] unaddressed. Blocked until 365 merges. The Precondition grep for `elif not await opps.has_fresh(user_id):` must find one hit; trunk still has a bare `else:` at about `servicer.py:4790` (P-03). Steps 9-10 cannot be verified against the post-365 shape until then.
  - Step 6: [ ] unaddressed (execution risk). Regenerating `scripts/config-wiring-stored.json` needs a DB, or the CI artifact fallback; without either the step is blocked. Never hand-edit the file.
  - Spec § Assumptions 1-5: [ ] unaddressed. Operator confirmation needed. Assumption 3 (a repo-owned `transaction()` in place of D-2's literal servicer-owned acquire) deviates from D-2's wording. It is the same pool and connection, so there is no F-06 risk.
- Overlap findings (WARN only, no merge-order write):
  - `servicer.py`: Step 9 depends on 365 (draft). Hard precondition: 365 merges before Step 9.
  - `opportunities.py`, `servicer.py`, `tests/test_analysis_servicer.py`: rebase-only overlap with 308 (implementation-ready).
  - `docs/patterns/config-governance.md`, `services/xstockstrat-analysis/CLAUDE.md`: doc-section rebase with 330 (in-progress).
  - Migrations: analysis `030` and config `056` are free on trunk.
  - Config and proto: no collisions.

## Session 2026-11-26 — operator pre-execute decisions (main session)

- OPERATOR DECISION (Step 4 / O-9 keep-list, verbatim choice 'No, drop it'): 308's `evaluation_failed` marker does NOT join the keep-list. A carried live-only row marked evaluation_failed is dropped; the symbol falls back to its (sym, '') row and is re-evaluated on its next turn. Resolves the Step 4 [ ] unaddressed item → [x].
- OPERATOR DECISION ('Confirm all five'): impl-spec Assumptions 1–5 are operator-confirmed — (1) pool bucket = projected_computes = ceil(P/N); (2) shortfall fires when projected_computes > cycle_max_days; (3) queue+cursor transaction via a new OpportunitiesRepository.transaction() on the same pool (accepted wording deviation from D-2, same connection/transaction, no F-06 risk); (4) cursor and carry reads only on a non-empty competitive_pool; (5) _rotation_chunk / _carry_within_cycle as pure module-level helpers.
- Execution mode: /sdd-batch-execute SEQUENTIAL (mode-entry confirmation 'Agree: all three', 2026-11-26). Step 9 is blocked until 365 merges (precondition grep for 'elif not await opps.has_fresh(user_id):'); integration PR waits on 308 and 330 per rebase order 365 → 308/330 → 366.

## Session 2026-11-26 — merge order revised (main session)

- OPERATOR DECISION (verbatim choice "Don't wait"): 366's integration PR does NOT wait for 308-fix-analysis-per-symbol-isolation or 330-fix-live-enrich-ttl-seed. Supersedes the design-time rebase order "365, then 308 and 330, then 366" (365 is merged, #1606 → 6dead38). Basis: /sdd-review overlap scan rated both WARN (same function, no shared migration NNN / proto field / config key), merge-order.md has no row, 330's config migration 055 is already on main-dev (366 uses 056), and 366 honours 308 debate.md R-4 by construction (only live-only rows are carried; held/watchlist/muted rows are always rebuilt). Whichever of 366 / 308 / 330 lands second rebases `_compute_opportunities` by hand.

## Session 2026-11-26 — sdd-execute sequential (sdd-batch-execute)

- Up-front confirmation (operator-approved record, binding, verbatim): {"mainDev":"6dead3812b5c0d7e471413e050013edd8779b576","dev":"5d150fe9f8bb6771594b3248913b9d1431c5cbfe","specHash":"959c07b3abc1910f36e2bc29efe7c83a1471a29e","directive":"conditional","pending":[1,2,3,4,5,6,7,8,9,10,11],"mismatches":[{"n":4,"detail":"Line drift only. Every cited symbol and code shape is present. Most anchors past servicer.py:4790 sit 1 line later after the 365 merge: _compute_opportunities is at :5360 (spec :5359), `return rows` :5985 (:5984), now_utc :5383, denied_covered :5416, _capped_live :5462, _candidate :5470, _new_live_strats :5536, live_signal_symbols :5542, competitive_pool :5543, max_live_only :5544, `if not targets:` :5559, the _best_sig_conv tie :5602-5603 (matches), the stamp :5962-5964, _replace_and_stamp_compute_state :4923, the callers :4953-4954 and :6071-6072, _opportunity_key :6804, _resolve_action_tag :6811, _row_to_opportunity :6926. The _opportunity_compute_failures init (:640) and live_loop.py:484 match. The spec's Precondition says to re-locate by symbol, so this does not block."},{"n":5,"detail":"tests/test_opportunity_compute_state.py stubs are at :53 (`AsyncMock(return_value=[])`, spec :52) and :82 (`side_effect=[[], [{\"symbol\": \"AAPL\"}]]`, spec :81). There is also an unlisted result-discarding call site at tests/test_opportunities_latency.py:181 (`await svc._compute_opportunities(...)`), which needs no change. All other listed call sites, harness anchors (make_servicer :44, _sig :4482, _FakeOppRepo :4499/:4509/:4515, _wl :4704, _strat_row :4715, _materialized_svc :4776/:4835, _drain_opportunity_recompute :4875, _StampedComputeState :5731, the only `def upsert(self, user_id` in tests at :5741), AC6_ROWS :32-67/:61, FR3_KEYS :25-62/:56 and test_ac6_servicer_init_semaphores_and_pool :110-127 match."},{"n":7,"detail":"Line drift only. The heal window_hours read is at servicer.py:5025 (spec :5023), the `hr.pop(\"_healed\", False)` loop at :5320 (spec :5312-5320 range ok) and replace_symbols at :5324 (spec :5323). The `_healed: True` heal row with `valid_until: None` is at :5248-5262. The code shape matches."},{"n":9,"detail":"Minor drift: `q.rows = rows` is at servicer.py:4821 (spec :4820). The first read (:4765-4774), the heal selection (:4775-4789), the post-365 `elif not await opps.has_fresh(user_id):` at :4790 (Precondition satisfied: exactly 1 hit), the finally-kicks (:4721-4725), and telemetry.py _OPPORTUNITY_RECOMPUTE :444, record_opportunity_recompute :486 and Counter.add :332 all match."}]}
- Merged main-dev `6dead381` into the branch (`c0190305`). merge-train-resolve kept the branch side ("ours") for context.md, feature.md and status.md; ledger-guard reported the ledger clean.
- Re-spec commits (`git log --first-parent origin/main-dev..HEAD`): `e989374a` respec(opportunity-live-only-rotation): align steps 4,5,7,9 with current codebase. Line anchors only; instructions, files and verification commands are unchanged.
- Tooling detection (steps 1-11): python 3.13 ✓ · uv ✓ 0.11.32 · pnpm ✓ 9.15.9 · node v22.23.5 (pinned 24) · docker ✓ · psql ✓ · migrate ✗ (Step 6's `config-wiring-stored.py` regeneration uses the local Docker route or the CI artifact fallback).
- status.md → in-progress.

```sdd-batch-setup
{"mainDev":"6dead3812b5c0d7e471413e050013edd8779b576","date":"2026-11-26"}
```

### Step 1 — migration: `live_only_cursor` column on `analysis.opportunity_compute_state` [done]
- Added analysis `030`: up `ALTER TABLE analysis.opportunity_compute_state ADD COLUMN IF NOT EXISTS live_only_cursor TEXT NULL;` (nullable, no default/backfill/index), down `DROP COLUMN IF EXISTS live_only_cursor;`. Discovery 2026-11-26: last migration `029_seed_fundamentals_blend_strategy`, no `03x` on any remote ref, base DDL at `023_opportunity_compute_state.up.sql:8-13`, no prior `live_only_cursor` symbol.
- TDD: N/A (migration). Verified offline (no DB started): both `030_*` files listed, exit=0 (`.sdd-logs/v-1.log`); the `.up` ADD COLUMN is reversed by the `.down` DROP COLUMN (by inspection). Config-key wiring gate not applicable (no `config.config_values` insert, no key touched).
- Files modified: `services/xstockstrat-analysis/migrations/030_opportunity_compute_state_live_only_cursor.up.sql`, `services/xstockstrat-analysis/migrations/030_opportunity_compute_state_live_only_cursor.down.sql`
- Deviations: none
