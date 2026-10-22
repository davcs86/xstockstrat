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
