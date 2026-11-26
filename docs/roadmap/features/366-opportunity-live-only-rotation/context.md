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
