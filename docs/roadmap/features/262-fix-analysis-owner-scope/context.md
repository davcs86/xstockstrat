# Context Log: fix-analysis-owner-scope

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-analysis-owner-scope-defect.md` (Issues disabled);
  sidecar `triaged` / `ref: feature:262-fix-analysis-owner-scope`.
- Source: repo-surveyor debt-radar scan `docs/repo-surveyor/debt-radar-findings.md` @ 4535695, findings D-44, D-55, D-60.
- Severity: SEV-2 (group; D-44 is the tenant finding). Impact type: cross-tenant-state-leak. Environment: dev
  (main-dev) @ a053b0e. Config-only: no.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2 (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..4), context.md.
- Affected services: xstockstrat-analysis (fix site), xstockstrat-trading (`ListOrders` semantics, read-only).
- Root cause hypothesis: pre-133 "strategy_id implies owner" assumption plus trading's fail-open empty `user_id`
  (D-44); the live loop's `ValueError` guard not mirrored (D-55); leftover owner-agnostic repo methods (D-60).
- Re-verification on a053b0e: all three D-ids reproduce by reading; no line drift.
  - D-44: `entry_backfill.py:64-65` comment, `:71-73` call (unchanged); sibling `servicer.py:6316` (unchanged).
    Trading confirmed fail-open: `trading.go:1587` passes `req.UserId` to `trading_repo.go:229-231`, which adds no
    predicate when it is empty.
  - D-55: docstring `:52`, fetch `:59` (unchanged), drains `:103-108` (unchanged); also `:90`
    (`_resolve_fundamentals_universe`) and `:94` (`_drain_system_signals`) unguarded. `owner_metadata` in
    `app/identity.py:6-10`; live-loop guard `live_loop.py:393` (unchanged). Per-pair tasks are already safe
    (`gather(..., return_exceptions=True)`, `:122`).
  - D-60: `strategies.py:89` / `:110` (unchanged); 0 app callers; 30 stale `_strategies_repo.get_by_id` test
    references across `test_analysis_servicer.py` and `test_readiness_opportunities_source_symbol.py` (scan said ~15).
- **Related, not absorbed:** `docs/reports/2026-10-19-trading-listorders-body-user-id-filter-defect.md` (status `open`)
  — trading should scope non-admin `ListOrders` to `x-user-id`. Ordering hazard: if trading ships header scoping
  first, today's backfill call (no metadata) would get an empty or denied result, so it would fail closed rather than
  leak. This feature must send both the body `user_id` and `owner_metadata(user_id)` so it is correct under either
  trading behaviour.
- **Overlaps:**
  - `244-fix-python-config-stored-zero` (implementation-ready) modifies `entry_backfill.py:56-58`
    (`max_concurrent_entry_backfill` clamp). Same file, adjacent lines; rebase after 244, record in `merge-order.md`
    at /sdd-spec.
  - `259-fix-python-loop-supervision` (D-07) owns the unretained-task fix at `main.py:174`; reuse its helper rather
    than adding a second one.
  - No feature in 240–253 touches `repositories/strategies.py` `get_by_id`/`update`.
- Recommended design depth: full → `/sdd-design fix-analysis-owner-scope` (rationale: 2 affected services and a tenant
  isolation fix — the C-0 full trigger). Trading is read-only, so the operator may downgrade to
  `/sdd-design fix-analysis-owner-scope quick`. Design fork for D-60: delete both methods vs keep `get_by_id` for a
  documented internal use.
- Development branch: feature/fix-analysis-owner-scope

## Session 2026-10-21 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria: PASS WITH WARNINGS (0 fails, 0 floor breaches).
  Overlap: WARN (file-level only; no config-key, proto field or migration collision).
- OPERATOR DECISIONS (binding, recorded 2026-10-21):
  - Grouped by service+theme from the 2026-10-20 debt-radar scan; Track C.
  - Scope is D-44, D-55, D-60; the trading-side ListOrders report stays separate.
- Warnings:
  - C-15 / criterion 8: AC-3 covered only the `ValueError` (system-owned row) case of FR-3. **Resolved**: added
    `@AC-8` (non-`ValueError` drain failure: a portfolio RPC error from owner `u-b`'s held-symbols drain).
  - Criterion 8: AC-3's skipped strategy had no id. **Resolved**: named `"s-sys"`; the Then now asserts a warning
    naming strategy `"s-sys"` and owner `"system"`.
  - Criterion 2 / FR-4: "run_once never raises" leaves `entry_backfill.py:90` (`live_loop._resolve_fundamentals_universe`,
    the blend-universe resolve) uncovered by any FR/AC; `:100` (`_row_to_strategy_definition`) and `:112`
    (`resolve_universe`) are arguably within FR-3's "preparing one owner". **Open for /sdd-design**: decide whether
    `:90` failure degrades to an empty blend universe (state it in FR-4 + add an AC) or is scoped out.
  - Criterion 2 / FR-1: per-pair isolation of an `owner_metadata` failure inside `_backfill_pair` was unstated.
    **Resolved**: FR-1 now states a failure affects only that `(strategy, symbol)` pair (pairs are gathered with
    `return_exceptions=True`, `:122`).
  - Trading-domain (advisory): no scenario uses a `PARTIALLY_FILLED` order, so the C-5 "unchanged" claim is untested.
    Left for /sdd-spec to cover in an existing `_infer_open_entry_time` test if cheap.
- Overlap findings:
  - `services/xstockstrat-analysis/app/engine/entry_backfill.py` vs `244-fix-python-config-stored-zero`
    (implementation-ready; `:56-58` clamp). Line-disjoint, rebase-only; 244 merges first (recorded plan).
  - `entry_backfill.py` + `app/main.py:174` (unretained task) vs `259-fix-python-loop-supervision` (draft). Ownership of
    the supervised-loop helper is an unresolved fork between the two specs; 259 context.md:37-38 says 259 owns it and
    262 reuses it. /sdd-design must settle this (262's FR-3/FR-4 are in-function guards and do not need the helper).
  - `services/xstockstrat-analysis/tests/test_analysis_servicer.py` (FR-6 retarget of 30 stale `get_by_id` mocks) vs
    `215-block-fundamentals-strategy-on-etf` (in-progress), `244`, `245-fix-screener-symbol-isolation`
    (implementation-ready). Highest-churn overlap; expect rebase conflicts in mock setup — sequence after 215.
  - `tests/test_readiness_opportunities_source_symbol.py` (FR-6, `:61`, `:189`): no peer touches it.
  - Context only: xstockstrat-trading is read-only here (`trading_repo.go` not edited; 267/241/242 touch
    `trading.go`). Shared analysis service dir with 215, 242, 244, 245, 246, 259, 272 — disjoint files.
  - merge-order.md has no 262 entry; no FAIL-level overlap, so none required. Optional soft rows for /sdd-spec:
    262 after 244 (`entry_backfill.py`); 262 coordinated with 259 (`main.py:174`).
- Next: `/sdd-design fix-analysis-owner-scope`.

## Session 2026-10-22 — sdd-batch design state recovered (round 1)

- The batch run that produced round 1 was cut off by the session usage limit before its gate writer persisted the debate state. This block is the round-1 synthesis restored verbatim from the run journal (`synth:fix-analysis-owner-scope:r1`), so the next /sdd-batch run resumes from it instead of redoing the debate.

```sdd-batch-design-state
{
  "round": 1,
  "synth": {
    "approach": "Round-1 synthesis for 262-fix-analysis-owner-scope. The approach stands. It carries six adversary amendments, each one small and aimed at low rework. All edits are in services/xstockstrat-analysis. There are no proto, migration, config, trading or main.py changes. The work is three steps, and each ships with its tests.\n\nSTEP 0, a docs prerequisite done at /sdd-spec before any code. Append a new @AC-9 @FR-4 @regression scenario to docs/roadmap/features/262-fix-analysis-owner-scope/acceptance.feature, which currently ends at @AC-7 (line 65). The scenario: \"a failed fundamentals-universe resolve skips only the blend pairs; the rest of the pass continues\". This is additive, so it needs no C-16 sign-off.\n\nSTEP 1 (FR-1/FR-2): owner-scoped ListOrders in _backfill_pair, app/engine/entry_backfill.py:63-82.\n- Inside the existing try at :70-76, build `md = owner_metadata(user_id) + [(\"x-trace-id\", pass_trace_id)]` and call `trading_stub.ListOrders(trading_pb2.ListOrdersRequest(user_id=user_id, strategy_id=strategy_id, symbol=symbol), metadata=md)`.\n- A ValueError from owner_metadata (app/identity.py:8-9) stays pair-local through the existing `except Exception`.\n- `pass_trace_id = uuid.uuid4().hex` is minted once at the top of run_once. Precedent: app/handlers/servicer.py:3604. This follows the operator's trace-id decision: the backfill has no originating request, so it mints its own context and still carries a trace id. Only the backfill's ListOrders gets the trace id. The live_loop drains are not changed.\n- Replace the comment at :64-65 with at most 2 lines: the 3-tuple key constraint, and \"body user_id is load-bearing: trading treats empty as all users\" (services/xstockstrat-trading/internal/repository/trading_repo.go:229-231).\n- Pair-set logic does not change, so 193 @AC-3 is preserved.\n\nSTEP 2 (FR-3/FR-4): failure isolation inside run_once.\n\n(a) Live-strategies read (:59-61). Wrap the fetch in try/except Exception. On failure, log a warning \"entry_backfill: live-strategies read failed: %s\" and return.\n\n(b) Blend-universe resolve (:89-91). Wrap it and degrade to set(). The existing skip at :110-111 then drops the blend pairs (@AC-9). That skip must stay ahead of resolve_universe and pair issuance (fails.md 2026-10-05 and 2026-10-07).\n\n(c) _drain_system_signals (:94). Wrap it and degrade to set(). This is kept because FR-4 names it. It gets no comment claiming production protection, since _drain_signals_with already swallows errors (live_loop.py:491-504).\n\n(d) Per-row guard over :99-119, with two different failure scopes:\n- Row-scoped: _row_to_strategy_definition (:100) or resolve_universe (:113-120) raising. Log \"entry_backfill: strategy %s skipped \u2014 %s\" with the strategy_id from dict(row).get(\"strategy_id\") and `continue`. The owner is NOT added to failed_owners.\n- Owner-scoped: the owner-prep drains (:102-108: _drain_held, _drain_watchlist, _drain_owner_signals) raising. Log \"entry_backfill: strategy %s owner %s skipped \u2014 %s\" once, add the owner to `failed_owners: set[str]`, and skip that owner's later rows silently, checking before any drain.\n- Held and watchlist results are drained into locals and committed to held_cache/watch_cache together, only after both succeed. This closes the partial-cache KeyError at :114.\n- Catch Exception. CancelledError (a BaseException) still propagates (live_loop.py:393).\n\n(e) Gather results (:122). Loop over the asyncio.gather(..., return_exceptions=True) results and log each Exception with a warning. This makes the docstring's \"a per-pair failure is logged\" true, covering failures outside the pair try such as _write_entry_cooldown :82 and _infer_open_entry_time :77.\n\n(f) Docstring (:50-53). Update it so \"Never raises\" and \"logged\" are accurate.\n\nSTEP 3 (FR-5/FR-6): delete the dead repository methods, done last because tests/test_analysis_servicer.py also collides with features 215, 244 and 245.\n- Delete StrategiesRepository.get_by_id (app/repositories/strategies.py:89-97) and .update (:110-124). Rewrite the :100 docstring so it no longer cross-references get_by_id.\n- Retarget the 28+2 mocks in tests/test_analysis_servicer.py and tests/test_readiness_opportunities_source_symbol.py, following these rules:\n  - Where a test relies on \"not found\" (e.g. :684, :799 `get_by_id = AsyncMock(return_value=None)`), set `get_by_owner_and_id = AsyncMock(return_value=None)` explicitly. Never just delete the line: svc._strategies_repo is a bare AsyncMock (:110, :6301, :6324), so a missing attribute auto-creates a truthy mock and flips @AC-20/@AC-34 collision semantics.\n  - Invert the aliases at :1984 and :2012 instead of removing them.\n  - Change the arity of :4500 `lambda sid:` to `lambda uid, sid:`.\n  - Retarget :6335 `get_by_id.assert_not_awaited()` to `get_by_owner_and_id.assert_not_awaited()` (disable path, servicer.py:3412-3415).\n  - Assert the (user_id, strategy_id) owner argument only in tests whose subject is ownership (@AC-21 isolation). Elsewhere, set the correct mock explicitly and drop the dead one.\n- In the same PR, change services/xstockstrat-analysis/CLAUDE.md:230 to \"ListOrders(user_id, strategy_id, symbol) + owner x-user-id\".\n\nTESTS (P-06 red-before-green):\n- The @AC-3 test must fail on today's code. It must not rely on _fake_live_loop's plain AsyncMock drains (tests/test_entry_backfill.py:57-60), which never raise. Give _drain_held real owner semantics (side_effect that calls owner_metadata(o) and returns set()), or run it through the real LiveEvaluationLoop as in tests/test_owner_header_guard.py:177.\n- Extend tests/test_owner_header_guard.py:175 test_entry_backfill_run_once to replace `trading = MagicMock()` (:180) with a RecordingStub-style trading stub. It must assert a non-empty x-user-id equal to the row owner, a non-empty x-trace-id on ListOrders, and body user_id == owner (fails.md 2026-10-06).\n- Assert warnings with caplog in the style of tests/test_live_loop.py.\n- Reuse the helpers _order, _strategy_row, _fake_live_loop and _cfg from tests/test_entry_backfill.py.\n\nMERGE ORDER: 244, which edits the semaphore at :56-58, merges first. Record the overlap in merge-order.md as ADJACENT, not disjoint, with an expected textual rebase conflict, because the try-wrap at :59-61 re-indents the lines next to 244's edit. main.py:174 stays with feature 259.",
    "open_objections": [
      {
        "text": "P-06/C-15: the @AC-3 red test must reproduce the owner_metadata ValueError for a 'system' owner. _fake_live_loop's AsyncMock drains (tests/test_entry_backfill.py:57-60) never raise, and today's _backfill_pair never calls owner_metadata (entry_backfill.py:71-73), so a test built on them passes both before and after the fix. The synthesis adopts a real-semantics _drain_held side_effect or the real LiveEvaluationLoop (test_owner_header_guard.py:177). The proposer must confirm this concretely in r2 or the spec.",
        "blocking": true
      },
      {
        "text": "P-03/FR-3 scope: failed_owners must be filled only by owner-prep drain failures (entry_backfill.py:102-108). A row-level parse failure (:100) or resolve_universe failure must skip only that row, or a single malformed row would silently drop the owner's other valid strategies. The synthesis adopts the row-scoped vs owner-scoped split. The proposer has not yet answered this concretely.",
        "blocking": true
      },
      {
        "text": "C-15: @AC-9 must be appended to acceptance.feature before /sdd-spec cites it. The file currently ends at @AC-7, line 65. It is additive, so no C-16 sign-off is needed.",
        "blocking": true
      },
      {
        "text": "C-03 / operator trace-id decision: the proposal was silent on x-trace-id. The synthesis picks option (a): mint one uuid4 trace id per pass (precedent servicer.py:3604) and append it only to the backfill's ListOrders metadata. Record this in context.md together with the reason the drains are not changed.",
        "blocking": false
      },
      {
        "text": "FR-1 / docstring honesty: asyncio.gather(..., return_exceptions=True) at entry_backfill.py:122 drops exceptions raised outside the pair try without logging them. Add a results loop that logs them, or do not claim 'logged'. The synthesis adopts the logging loop.",
        "blocking": false
      },
      {
        "text": "C-16 regression on @AC-20/@AC-21/@AC-34: the mock retarget in test_analysis_servicer.py must follow the explicit-set, alias-invert, arity and assert_not_awaited rules (see :684, :799, :1984, :2012, :4500, :6335). A plain deletion flips the auto-created-mock semantics.",
        "blocking": false
      },
      {
        "text": "C-18: the _drain_system_signals guard can fire only in tests, because live_loop.py:491-504 already swallows errors. Keep it for FR-4, but add no comment claiming production protection.",
        "blocking": false
      },
      {
        "text": "Merge-order accuracy: record the overlap with 244 as adjacent, with an expected rebase conflict at entry_backfill.py:56-61, not as disjoint.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "193 @AC-3 (pair-set / blend gating)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "262 @AC-1 (owner-scoped ListOrders body user_id + x-user-id)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "262 @AC-2",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "262 @AC-3 (system/empty owner skipped pair-locally)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "262 @AC-8 (drain failure isolated per owner)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "262 @AC-4",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "262 @AC-5",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "262 @AC-6 (dead get_by_id/update removed)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "262 @AC-7",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "262 @AC-9 (blend-universe resolve failure skips only blend pairs) \u2014 to be appended",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "analysis @AC-20 (strategy id collision)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "analysis @AC-21 (owner isolation)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "analysis @AC-34",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Atomic cache writes without failed_owners: simpler, but 'system' and empty owners fail on every row, which means predictable log spam and repeated drains. It would win only if the parse-vs-prep split proved complicated, and it does not.",
      "Scoping the :89-91 blend-universe guard out to a follow-up: it leaves a known whole-pass abort in place, while the fix is one try that reuses the existing empty-universe skip at :110-111.",
      "Owner-scoping get_by_id/update instead of deleting them: less mock churn, but it keeps duplicates of get_by_owner_and_id/update_locked (C-18). FR-5 settles the question, and a repo-wide grep finds 0 callers in app/.",
      "Sending only the x-user-id header without the body user_id: trading's repo fails open on an empty body user_id (trading_repo.go:229-231), so a header alone does not scope the result.",
      "Catching only ValueError in the per-row guard: FR-3/@AC-8 require any drain failure to be isolated. A catch of Exception that excludes BaseException keeps cancellation propagating.",
      "Adding failed_owners on parse failure: a single bad row would silently drop the owner's other valid strategies (beyond FR-3's scope).",
      "Rewording @AC-8 to match the implementation: rework with no behavior gain, since the test already drives a raising _drain_held (tests/test_entry_backfill.py:49).",
      "Recording 'no trace id available' (option b) instead of minting one: the operator asked for trace-id propagation 'as much as possible', and minting is a one-line change with a precedent at servicer.py:3604."
    ],
    "open_risks": [
      "Mock retarget in test_analysis_servicer.py (about 30 sites), with concurrent edits from 215, 244 and 245: a careless retarget can silently weaken @AC-20/@AC-21/@AC-34 coverage through auto-created truthy AsyncMock attributes.",
      "Textual rebase conflict with 244 at entry_backfill.py:56-61. It is adjacent, not disjoint.",
      "The 'no callers outside analysis app/ and tests/' claim comes from greps. The adversary's repo-wide check found none (indicators and strategy_scores_repo get_by_id belong to other repositories), but a dynamic or getattr call would not show up.",
      "If the separate trading-side ListOrders report later scopes by header rather than body, both are already sent, but the trading change must not reject the analysis call shape (body + header + x-trace-id).",
      "The drains under live_loop still carry no x-trace-id. This is accepted for now and must be recorded in context.md so it is not mistaken for oversight."
    ],
    "constitution_rules_touched": [
      "C-03",
      "C-11",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-03",
      "P-06",
      "C-13"
    ],
    "rationale": "I re-checked the proposal's citations against the worktree (entry_backfill.py:49-123, identity.py:6-10, test_entry_backfill.py:50-62, test_owner_header_guard.py:175-183, acceptance.feature AC ids), and they hold. The adversary found no Floor breach. Its blocking points are real and cheap to fix:\n- the @AC-3 test would not go red on the current code;\n- failed_owners would wrongly treat a row-level parse failure as an owner failure;\n- @AC-9 does not exist yet.\n\nThe non-blocking points are adopted for the following reasons:\n- Gather logging, so the docstring claim is true.\n- Minting a trace id, to satisfy the operator's standing decision. There is precedent at servicer.py:3604, and the change touches only the backfill's ListOrders metadata.\n- The precise mock-retarget rules, to protect @AC-20/21/34.\n- Calling the 244 overlap adjacent rather than disjoint.\n\nEvery amendment keeps the proposal's structure: 3 steps, no proto, config or migration changes, and reuse of owner_metadata and the live_loop guard shape. This matches the user's direction to preserve as much as possible with low rework. Approval should wait until the proposer concretely confirms the two blocking test and scope amendments and @AC-9 is appended."
  },
  "floor_breaches": []
}
```

## Session 2026-10-22 — sdd-batch design gate (round 2)

- The /sdd-design full debate has stopped at its approval gate after round 2 (gate policy: halt). Per the grilling protocol, design.md is not written and status.md stays `spec-ready`. The round-2 debate state is below so the next /sdd-batch run resumes from it.

### Open Threads

- **Approach (stands).** Three code steps plus a docs step 0, all inside services/xstockstrat-analysis. There are no proto, migration, config, trading or main.py changes.
  - Step 0 appends @AC-9 @FR-4 @regression: a failed blend-universe resolve skips only the blend pairs.
  - Step 1 sends an owner-scoped ListOrders: body user_id, owner x-user-id, and a per-pass x-trace-id that is also logged.
  - Step 2 isolates failures in run_once:
    - strategies read: warn and return;
    - blend-universe and system drains: fall back to set();
    - each row splits into a row-scoped parse, owner-scoped held/watch prep (fills failed_owners, writes the caches atomically) and a row-scoped resolve;
    - end of pass: a summary per failed owner, plus a warning for each gather exception.
  - Step 3 deletes the dead get_by_id/update.
- **Strongest open objection (blocking).** Step 3's test rule must be **deletion-first**. Every single-line get_by_id mock is already followed by an explicit get_by_owner_and_id (22 servicer sites incl. 2175/3451, plus readiness:61/189), so the rename rules from r2 would add duplicate or conflicting mocks.
  - Delete those lines.
  - Replace the :1984/:2012 aliases with a direct AsyncMock.
  - Delete :4500 and reword :4501-4502, :978 and :1007.
  - Retarget :6335 to get_by_owner_and_id.assert_not_awaited().
  - The rule must be adopted in r3 or as a binding note to /sdd-spec before the step body is approved (F-09).
- **Non-blocking items, adopted.**
  - The owner-signal drain gets its own try and falls back to system_signals; only a held/watch failure poisons an owner.
  - @AC-3 runs on the real LiveEvaluationLoop, with `_live_loop` moved to tests/conftest.py.
  - The header-guard test asserts that trading.calls is non-empty first.
  - The overlap with 244 is recorded as ADJACENT at entry_backfill.py:56-61.
  - The trace-id gap in the live_loop drains is accepted on purpose and must be recorded here at spec time.
- **Floor status.** No breaches.
- **@AC changes not covered by an operator decision.** 262 @AC-9 (EXTEND: additive, appended at Step 0, needs no C-16 sign-off). The PRESERVE rows (193 @AC-3, analysis @AC-20/@AC-21/@AC-34) are kept unchanged. Every 262 @AC-1..@AC-8 CHANGE is covered by an operator decision.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Round-2 synthesis for 262-fix-analysis-owner-scope. The approach stands. Steps 0-2 are confirmed as r2 wrote them. Step 3's mock rules are replaced with a deletion-first rule, because the adversary is right and I re-verified it against the worktree. All edits are in services/xstockstrat-analysis. There are no proto, migration, config, trading or main.py changes.\n\nSTEP 0 (docs, at /sdd-spec, before code). Append @AC-9 @FR-4 @regression to docs/roadmap/features/262-fix-analysis-owner-scope/acceptance.feature after @AC-7 (line 65). Scenario: blend strategy live with blend enabled; live strategy \"s-2\" owned by \"u-a\" on \"MSFT\"; the fundamentals-universe resolve raises. Expected: the boot pass completes without raising, (\"u-a\",\"s-2\",\"MSFT\") is seeded, no ListOrders goes out for the blend strategy, and a warning names the failed resolve. This is additive, so it needs no C-16 sign-off.\n\nSTEP 1 (FR-1/FR-2), app/engine/entry_backfill.py:63-82, as in r2.\n- Mint pass_trace_id = uuid.uuid4().hex once per pass. Precedent: servicer.py:3604.\n- Inside the existing pair try (:70-76), build md = owner_metadata(user_id) + [(\"x-trace-id\", pass_trace_id)].\n- Call ListOrders(ListOrdersRequest(user_id=user_id, strategy_id=strategy_id, symbol=symbol), metadata=md).\n- Replace the comment at :64-65 with 2 lines: the 3-tuple key constraint, and \"body user_id is load-bearing: trading treats empty as all users\" (trading_repo.go:229-231).\n- Add imports for uuid and app.identity.owner_metadata; neither is imported today (:14-23).\n- NEW (adopted): include pass_trace_id in every warning this feature adds and in the \"boot pass complete\" info log at :123, so trading-side traces can be matched to the analysis pass.\n\nSTEP 2 (FR-3/FR-4), run_once.\n- (a) Wrap db_pool.fetch (:59-61): warn and return.\n- (b) Wrap _resolve_fundamentals_universe (:89-91): fall back to set(). The existing skip at :110-111 then drops the blend pairs, and it stays ahead of resolve_universe (@AC-9).\n- (c) Wrap _drain_system_signals (:94): fall back to set(). Add no comment claiming it protects production.\n- (d) Split the row loop (:99-121) into three phases:\n  - Phase 1, row-scoped: try _row_to_strategy_definition(d). On Exception, warn with strategy_id and user_id and continue; do NOT add to failed_owners. Verified: servicer.py:7193-7220 raises KeyError on a missing strategy_id/display_name/active and ParseError on a bad definition_json.\n  - Phase 2, owner-scoped: skip if owner is in failed_owners. Otherwise drain held and watchlist into locals and commit both to the caches together, which closes the partial-cache KeyError at :114. On Exception, warn, add the owner to failed_owners, and continue.\n  - Owner-signal drain (:106-109): a decision is still needed (open objection 2). The recommended answer is to put it in its own try and, on failure, fall back to system_signals with a warning, without adding the owner to failed_owners. Under this answer, held/watch failure is the only condition that poisons an owner, and that choice is recorded in context.md.\n  - Phase 3, row-scoped: the blend skip comes first. Then resolve_universe runs in its own try (warn, continue, no failed_owners), and the pairs are appended unchanged.\n  - Exception is caught; CancelledError still propagates.\n- NEW (adopted): at the end of the pass, emit one warning per failed owner listing the strategy_ids that were skipped, so no row disappears from the logs.\n- (e) Loop over the gather(return_exceptions=True) results at :122 and warn on each Exception.\n- (f) Correct the docstring at :50-53.\n\nSTEP 3 (FR-5/FR-6), last.\n- Delete StrategiesRepository.get_by_id (strategies.py:89-97) and .update (:110-124), and rewrite the :100 docstring.\n- Revised test rule, DELETION-FIRST. I verified that every single-line get_by_id assignment is already followed by an explicit get_by_owner_and_id on the next line:\n  - tests/test_analysis_servicer.py: 119, 684, 799, 812, 986, 1008, 1075, 2175 (`repo.`), 2285, 2815, 2892, 3119, 3170, 3451 (`repo.`), 4036, 4149, 6216, 6234, 6252, 6269, 6286, 6407, 6427, 7592.\n  - tests/test_readiness_opportunities_source_symbol.py: 61, 189.\n- So the rule is:\n  (i) Delete each get_by_id line whose next line already sets get_by_owner_and_id.\n  (ii) At :1975/:1984 and :2003/:2012, assign get_by_owner_and_id = AsyncMock(return_value={...}) directly and drop the alias.\n  (iii) Delete :4500. :4503-4505 already defines the (uid, sid) mock. Reword the :4501-4502 comment, which refers to \"mirror get_by_id\".\n  (iv) Retarget :6335 to get_by_owner_and_id.assert_not_awaited(). The disable path never calls it (servicer.py:3412-3415).\n  (v) Reword the stale \"get_by_id\" comments at :978 and :1007.\n- No test references _strategies_repo.update. The get_by_owner_and_id values these tests run against are already explicit, so the deletions change no test behavior and @AC-20/@AC-21/@AC-34 are preserved.\n- Also: reword the servicer.py:3174 comment, and set CLAUDE.md:230 to \"ListOrders(user_id, strategy_id, symbol) + owner x-user-id\".\n\nTESTS (P-06 red-before-green).\n- @AC-3: build it on the REAL LiveEvaluationLoop (the _live_loop helper at tests/test_owner_header_guard.py:139), moved into tests/conftest.py now that it has a second consumer (C-13). Rows: a \"system\" row ahead of a \"u-a\" row. Today the real owner_metadata ValueError escapes run_once, so the test is red. After the fix, u-a is seeded and caplog names s-sys/system. The real-semantics AsyncMock side effect from r2 is accepted only as a fallback if the conftest move collides.\n- @AC-8: an AsyncMock _drain_held that raises RuntimeError for \"u-b\" only.\n- @AC-2: an owner-filtering ListOrders fake `async def _list_orders(req, metadata=None)`; add `metadata=None` to the existing fakes at :153 and :227.\n- Row-vs-owner split: one u-a row missing display_name plus one valid u-a row; the valid row is seeded.\n- @AC-4/@AC-5/@AC-9: make the relevant call raise and assert with caplog.\n- Header guard at test_owner_header_guard.py:175: replace MagicMock with RecordingStub({\"ListOrders\": SimpleNamespace(orders=[])}). First assert trading.calls is non-empty (fails.md:2659). Then assert on each call: x-user-id == [\"bob\"], a non-empty x-trace-id, and req.user_id == \"bob\".\n\nMERGE ORDER: 244 merges first. Record its overlap as ADJACENT at entry_backfill.py:56-61, with a textual conflict expected. main.py:174 stays with 259.",
    "open_objections": [
      {
        "text": "Step 3 test rule must be the deletion-first rule. Delete each get_by_id line already followed by an explicit get_by_owner_and_id: the 22 servicer sites incl. 2175 and 3451 on the local `repo`, plus readiness:61/189. Replace the :1984/:2012 aliases with a direct AsyncMock(return_value={...}). Delete :4500 (the (uid, sid) mock already exists at :4503-4505) and reword :4501-4502, :978 and :1007. Retarget :6335. The r2 rules for :684, :799 and :4500 would add duplicate or conflicting mocks, and step bodies cannot be edited once approved (F-09). The proposer must adopt this rule in r3 or at /sdd-spec, before the step body is approved.",
        "blocking": true
      },
      {
        "text": "FR-3 owner-state consistency. The owner-signal drain (:106-109) must not feed failed_owners in the same try as held/watch. If it did, the owner's earlier rows would already be queued while its later rows are dropped, and FR-3 would be only half true. Recommended: a separate try that falls back to system_signals and warns, with held/watch failure as the only owner-poisoning condition. Record the choice in context.md.",
        "blocking": false
      },
      {
        "text": "P-06/C-13 test fidelity. Run @AC-3 against the real LiveEvaluationLoop (_live_loop, test_owner_header_guard.py:139) rather than a copy of live_loop.py:522, and move _live_loop to tests/conftest.py now that it has two consumers. Keep the AsyncMock override only for @AC-8.",
        "blocking": false
      },
      {
        "text": "C-03 / operator trace-id decision. pass_trace_id must appear in this feature's new warnings and in the 'boot pass complete' log at entry_backfill.py:123. Otherwise the minted id cannot be correlated from the analysis side. Record in context.md that the live_loop drains deliberately carry no trace id, because adding one would need a signature change that is out of scope.",
        "blocking": false
      },
      {
        "text": "Observability of failed_owners skips. At the end of the pass, emit one warning per failed owner listing all the strategy_ids skipped, so later rows of a failed owner do not vanish from the logs.",
        "blocking": false
      },
      {
        "text": "Header-guard vacuity (fails.md:2659). Assert that trading.calls is non-empty before the per-call x-user-id, x-trace-id and req.user_id assertions.",
        "blocking": false
      },
      {
        "text": "Merge-order accuracy. Record the 244 overlap as adjacent, with a textual rebase conflict expected at entry_backfill.py:56-61.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "193 @AC-3 (pair-set / blend gating)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "262 @AC-1 (owner-scoped ListOrders body user_id + x-user-id)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "262 @AC-2",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "262 @AC-3 (system/empty owner skipped pair-locally)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "262 @AC-4",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "262 @AC-5",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "262 @AC-6 (dead get_by_id/update removed)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "262 @AC-7",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "262 @AC-8 (drain failure isolated per owner)",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "262 @AC-9 (blend-universe resolve failure skips only blend pairs), to be appended",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "analysis @AC-20 (strategy id collision)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "analysis @AC-21 (owner isolation)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "analysis @AC-34",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Mechanically renaming get_by_id to get_by_owner_and_id (r2's Step 3 rules for :684, :799 and :4500). Every site already sets get_by_owner_and_id on the next line, so a rename creates duplicate assignments where the later one silently wins, and it bakes wrong line-level instructions into a step body that cannot be edited. The deletion-first rule is smaller and changes no test behavior.",
      "Atomic cache writes without failed_owners. Simpler, but 'system' and empty owners would re-drain and re-warn on every row.",
      "One try around the whole per-row body (recon). It cannot tell a malformed row (row-scoped) from a failed owner prep (owner-scoped): either one bad row poisons the owner, or failed_owners can never be filled.",
      "A per-pair trace id. Finer-grained, but a boot pass is one logical unit of work. Per-pass is enough once it is logged.",
      "Copying live_loop.py:522 into an AsyncMock side effect for @AC-3. It goes stale silently when the drain changes; the real LiveEvaluationLoop helper already exists.",
      "Scoping the :89-91 blend-universe guard out to a follow-up. That leaves a whole-pass abort in place when the fix is one try reusing the :110-111 skip.",
      "Owner-scoping get_by_id/update instead of deleting them. That keeps duplicates of get_by_owner_and_id/update_locked (C-18), and FR-5 settles it with 0 callers in app/.",
      "Sending only the x-user-id header without body user_id. trading_repo.go:229-231 fails open on an empty body user_id.",
      "Catching only ValueError. FR-3/@AC-8 require any drain failure to be isolated. Catching Exception still lets CancelledError propagate.",
      "Adding the owner to failed_owners on a parse failure. One bad row would silently drop the owner's other valid strategies.",
      "Recording 'no trace id available' instead of minting one. That contradicts the operator's standing trace-id decision."
    ],
    "open_risks": [
      "Concurrent edits to tests/test_analysis_servicer.py from 215, 244 and 245. With deletion-first this is reduced to one-line deletion conflicts, but a rebase that resurrects a deleted get_by_id line would now hit an AttributeError on the real repo spec only if the spec is used; svc._strategies_repo is a bare AsyncMock, so a resurrected line just becomes dead again rather than failing.",
      "Moving _live_loop into conftest.py can collide with other features that edit tests/conftest.py or test_owner_header_guard.py. If it does, fall back to the real-semantics side effect for @AC-3.",
      "Textual rebase conflict with 244 at entry_backfill.py:56-61 (adjacent).",
      "The 'no callers' claim for get_by_id/update rests on grep. A dynamic getattr call would not show up.",
      "If the separate trading-side ListOrders report later scopes by header rather than body, the trading change must keep accepting this call shape (body user_id + x-user-id + x-trace-id).",
      "The live_loop drains still carry no x-trace-id. This is accepted and must be recorded in context.md."
    ],
    "constitution_rules_touched": [
      "C-03",
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "F-09",
      "P-02",
      "P-03",
      "P-06"
    ],
    "rationale": "The proposal concretely answers all three round-1 blocking objections, so they are closed:\n- the @AC-3 red test now reproduces the real owner_metadata ValueError;\n- failed_owners is filled only by owner-prep;\n- @AC-9 is specified for Step 0.\n\nI re-verified the adversary's main Step 3 claim against the worktree, and it holds. Every single-line get_by_id assignment in test_analysis_servicer.py and test_readiness_opportunities_source_symbol.py is followed directly by an explicit get_by_owner_and_id. That includes two sites the adversary did not list, 2175 and 3451, which use a local `repo`. :4503-4505 already holds the (uid, sid) mock, and :1984/:2012 are pure aliases. r2's retarget rules would therefore add duplicate or conflicting mocks. Because step bodies are immutable once approved (F-09), this stays the one blocking objection until the deletion-first rule is adopted. It also lowers the top risk: the deletions keep test behavior the same and shrink the rebase overlap.\n\nThe adversary also confirmed that _row_to_strategy_definition is strict (servicer.py:7193-7220), which closes that assumption. A missing display_name is the trigger for the row-split test.\n\nThe remaining non-blocking amendments are cheap and stay within the 3-step, no-proto/config/migration shape:\n- the separate try for the owner-signal drain;\n- @AC-3 on the real loop;\n- pass_trace_id in the logs;\n- per-owner skip summaries;\n- the non-empty calls assertion.\n\nThere are no Floor breaches. The design can be approved once the proposer adopts the deletion-first Step 3 rule, either in r3 or as a binding note to /sdd-spec."
  },
  "floor_breaches": []
}
```

## Session 2026-10-22 — sdd-design

- Phase 0 Recon: wrote recon.md earlier (services: xstockstrat-analysis fix site, xstockstrat-trading read-only;
  key reuse patterns: `owner_metadata` built inside the existing per-pair `try`, `RecordingStub` header guard).
- Phase 1 Grilling: 2 rounds (full). The operator approved at the r2 gate on 2026-10-22 "as synthesized, including
  the deletion-first Step 3 test-mock rule". That resolves the one blocking objection.
- Chosen approach:
  - Step 0 adds @AC-9.
  - Step 1 sends an owner-scoped `ListOrders` with body `user_id`, `x-user-id` and a per-pass `x-trace-id`.
  - Step 2 splits `run_once` failures into row-scoped and owner-scoped (`failed_owners`) isolation.
  - Step 3 deletes `get_by_id`/`update` and their test mocks.
- Rejected: rename-style mock retargeting, a single per-row `try`, header-only scoping, and a per-pair trace id.
  The full list is in design.md.
- Decisions:
  - Only a held/watch drain failure adds an owner to `failed_owners`.
  - An owner-signal drain failure falls back to `system_signals` with a warning.
  - A parse or resolve failure is row-scoped.
  - The live_loop drains deliberately carry no `x-trace-id`. Adding one needs a signature change that is out of
    scope, and this is accepted under the operator trace-id decision of 2026-10-21.
- Constitution rules touched: C-03, C-11, C-13, C-15, C-16, C-18, F-09, P-02, P-03, P-06. Floor breaches: none.
- Status: spec-ready → design-approved.

### Open Threads

- [ ] Rebase churn on `tests/test_analysis_servicer.py` (215/244/245) — target Step 3 (confirm `grep get_by_id tests/`
  returns 0 after rebase).
- [ ] The `_live_loop` move into `tests/conftest.py` may collide with another feature. Fall back to a side effect
  with the real semantics. Target Step 2.
- [ ] Adjacent textual conflict with 244 at `entry_backfill.py:56-61`. Target /sdd-spec (merge-order.md row: 244
  before 262) and the Step 1 rebase.
- [ ] The "no callers" claim for `get_by_id`/`update` is grep-based. Target Step 3 (full analysis test suite run).
- [ ] The trading-side `ListOrders` report must keep accepting body `user_id` + `x-user-id` + `x-trace-id`. Tracked
  outside this feature (`docs/reports/2026-10-19-trading-listorders-body-user-id-filter-defect.md`).
- [ ] Record the live_loop no-trace-id acceptance in the spec. Target /sdd-spec.

## Session 2026-10-22 — sdd-spec

- Generated implementation-spec.md with 8 steps. Status: design-approved → implementation-ready.
- Step 1 (design Step 0) was done in this session: `@AC-9 @FR-4 @regression` was appended to
  acceptance.feature (commit `72aea957`). It is additive, so no C-16 sign-off is needed.
- Key codebase findings (re-verified on `origin/feature/fix-analysis-owner-scope` @ `5afe0c84`):
  - `entry_backfill.py` line refs in recon/design hold unchanged: `:59-61` fetch, `:63-82` pair,
    `:89-91` blend resolve, `:94` system drain, `:99-121` row loop, `:122` gather, `:123` info log.
    Neither `uuid` nor `owner_metadata` is imported today (`:14-21`).
  - The deletion-first Step 3 rule was re-verified line by line. Each of the 24 servicer sites
    plus readiness `:61`/`:189` is followed by an explicit `get_by_owner_and_id` with the same
    value. `:1984`/`:2012` are pure aliases, `:4503-4505` already holds the `(uid, sid)` mock, and
    the `_strategies_repo\.(get_by_id|update\b)` grep returns 30 in `tests/` and 0 in `app/`.
  - `_live_loop` (`test_owner_header_guard.py:139`) already has 4 in-file consumers and depends on
    the file-local `_cfg`/`_marketdata`, and `_marketdata` needs `_real_bars` from a test module.
    The spec therefore moves it to `tests/conftest.py` as
    `real_live_loop(ingest, indicators, rows, *, config_watcher, marketdata_stub)`, with those two
    dependencies injected, so conftest never imports a test module. The header guard keeps a
    one-line `_live_loop` wrapper, so its 4 call sites stay untouched.
  - The `@AC-6` assertion lands as a new class next to `TestListLiveEnabled`
    (`tests/test_analysis_servicer.py:6667`), which is where the strategies-repo unit tests
    already live.
- Decisions:
  - The live_loop drains (`_drain_held`/`_drain_watchlist`/`_drain_owner_signals`) deliberately
    carry **no `x-trace-id`**. Adding one needs a signature change that is out of scope. This is
    accepted under the operator trace-id decision of 2026-10-21; only the backfill's own
    `ListOrders` carries the per-pass id, and it is logged.
  - The consumer surface needs no UI or Agent step (C-14). `/trader` alerts change only through
    what analysis already emits.

### Open Threads

- [ ] merge-order.md row "244 before 262 — ADJACENT at `entry_backfill.py:56-61`, textual rebase
  conflict expected" was not written. This /sdd-spec run could write only this feature's directory.
  Add it at `/sdd-review impl-spec` or with the integration PR.
- [ ] Rebase churn on `tests/test_analysis_servicer.py` (215/244/245): handled at Step 7 by rebasing
  first, then the grep gate.
- [ ] Possible `tests/conftest.py` collision from moving `_live_loop`: Step 5 falls back to a
  real-`owner_metadata` side effect and records it in the Deviation Log.
- [ ] The "no callers" claim for `get_by_id`/`update` comes from grep: Step 7 closes it with a full
  analysis suite run.
- [ ] The trading-side `ListOrders` report must keep accepting body `user_id` + `x-user-id` +
  `x-trace-id` (tracked outside this feature).

## Session 2026-10-22 — sdd-review impl-spec (advisory)

- Result: 0 failures, 6 warnings (5 WARN + 1 NOTE), 0 floor breaches. Overlap: WARN (file-level,
  rebase-only; no migration NNN, proto field or config-key collision). Advisory: lifecycle unchanged
  (`implementation-ready`).
- Addressed in implementation-spec.md (commit `35d772f8`):
  - Step 5 `@AC-3` constructor risk: re-verified. `LiveEvaluationLoop.__init__` defaults
    `cooldowns_repo=None` (`live_loop.py:276`, stored `:300`) and `_write_entry_cooldown` returns
    early on `None` (`:901-902`). The spec evidence now says so instead of deferring to execute time.
  - Step 5 conftest move: added the missing `_EOF` dependency. conftest builds the page inline as
    `types.SimpleNamespace(next_page_token="")` and does not import from the test module. The
    fallback (keep `_live_loop`, real-`owner_metadata` side effect) is now marked preferred on any
    conftest collision with 244/246, after a rebase before the step.
  - Step 7 rebase churn: rule (i) now locates sites by grep on the rebased tree, not by the
    `5afe0c84` line numbers. The rebase is instruction 7 but is marked "do this first".
  - Merge-order bullet: updated to say the row is still unwritten and must be added before
    `/sdd-execute` Step 2.
- Not changed (no edit needed):
  - Step 4 nested try/except: each branch maps to an FR/AC. Optional per-row extraction is left
    to execute-time judgement.
  - Step 1 NOTE (spec `Status` header `pending` vs `status.md` `implementation-ready`): the header
    tracks execution progress and `/sdd-execute` manages it. Cosmetic.
- Overlap findings: `entry_backfill.py` ADJACENT to 244 (`:56-61`, rebase conflict expected);
  `tests/conftest.py` (244, 246), `tests/test_owner_header_guard.py` (246),
  `tests/test_analysis_servicer.py` (215, 244), `app/handlers/servicer.py` (215, 244),
  `services/xstockstrat-analysis/CLAUDE.md` (244, 246). All disjoint lines, rebase only. The other
  batch peer branches could not be scanned (they exist only as worktree FETCH_HEADs).

### Open Threads

- [ ] merge-order.md soft row: `fix-analysis-owner-scope` (262) | `fix-python-config-stored-zero`
  (244) | adjacent edit to `entry_backfill.py:56-61`, rebase conflict expected | No. Whichever
  merges second rebases. Needs operator yes/no. This run could write only the feature directory,
  so add it before `/sdd-execute` Step 2 or with the integration PR.
- [ ] Batch peers (fix-marketdata-fundamentals-cache, fix-portfolio-snapshot-surface,
  fix-db-tls-fail-closed, fix-indicators-formula-correctness, fix-template-update-metadata,
  fix-ui-transport-hardening, fix-analysis-backtest-bounds, fix-agent-client-deadlines) were not
  overlap-scanned. Re-check fix-analysis-backtest-bounds (same service) at the `/sdd-execute`
  checkpoint.
- [ ] Step 4: if the `run_once` row loop gets hard to read after the guards land, extract the
  per-row logic into a helper (advisory, no FR impact).

## Session 2026-10-29 (/sdd-execute re-spec, sdd-batch-execute)

- Branch setup (§5.3): merged `origin/main-dev` into the feature branch (clean, no conflicts; merge
  commit `41462525`). Ledger guard: clean.
- Re-spec of Steps 2–8 (commit `6244b100`): evidence re-verified against the merged tree. Drift is
  line numbers only: 244's `int_positive` semaphore clamp (`entry_backfill.py:57-59`) shifted
  `run_once` by +1; 259's `spawn(..., "entry-backfill", forever=False)` now starts the backfill
  (`app/main.py:174-180`, not edited); 244/246 `fundamentals_row`/`snapshot_watcher` are already in
  `tests/conftest.py`, so the Step 5 conftest-collision fallback is no longer expected; the
  analysis `CLAUDE.md` trading row moved to `:271`. Instructions, Files and Verification are
  unchanged in scope.
- Open Thread update: the 244 `entry_backfill.py` ADJACENT conflict has effectively happened
  (244 merged to main-dev); edits are indented against the current tree. The merge-order soft row
  for 244 is moot.

## Session 2026-10-29 (sdd-execute sequential (sdd-batch-execute))

- Status `implementation-ready` → `in-progress`.
- Up-front plan confirmation: given by operator standing authorization (operator chat 2026-10-28/29,
  session_01NpS3HShZK6pSnogA7CFo2f: "Start executing features 241-276" via batch-execute;
  unattended checkpoints, C-16 promotion auto-confirmed unless it changes an existing `@AC` rule,
  merge-train authorized; operator-only DB/prod steps: open PR, hold merge). Per-feature blocker
  decisions were given by the operator through the session's question tool on 2026-10-29.
  Checkpoints: `report`.
- Mode: sequential, one commit per step on `feature/fix-analysis-owner-scope`; single integration
  PR at the end. Steps 2–8 pending (Step 1 done at /sdd-spec).
- Step 2 done (service, `app/engine/entry_backfill.py`): `run_once` mints `pass_trace_id`
  once per pass; `_backfill_pair` sends `ListOrdersRequest(user_id=…, strategy_id=…, symbol=…)`
  with `metadata=owner_metadata(user_id) + [("x-trace-id", pass_trace_id)]`; the failure warning
  and completion log carry the trace id. A `ValueError` from `owner_metadata` stays pair-local.
  - TDD (AC-1 shape, scratch test not committed — Step 3 owns the real tests): red:
    `assert req.user_id == "u1"` failed (`'' == 'u1'`) → green: passed after the change.
  - Verification: grep hits for body `user_id`, `metadata=md`, `owner_metadata(user_id)` and
    `pass_trace_id`; `ruff check .` + `ruff format --check .` clean.
  - Deviation: the first comment line was reworded to fit ruff's 100-char limit (Deviation Log).
  - Expected interim breakage until Step 3: `test_run_once_swallows_per_pair_rpc_failure` and
    `test_blend_backfill_restricted_to_fundamentals_universe` fail because their `_list_orders(req)`
    fakes reject `metadata=`; Step 3 instruction 1 changes both signatures.
