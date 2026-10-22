# Context Log: fix-analysis-backtest-bounds

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-analysis-backtest-bounds-defect.md` (Issues disabled);
  sidecar `triaged` / `ref: feature:272-fix-analysis-backtest-bounds`.
- Source: repo-surveyor debt-radar scan `docs/repo-surveyor/debt-radar-findings.md` @ 4535695, findings D-28, D-29.
- Severity: SEV-2 (group). Impact type: silent-partial-backtest-data. Environment: dev (main-dev) @ a053b0e.
  Config-only: no.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2 (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..3), context.md.
- Affected services: xstockstrat-analysis (fix site), xstockstrat-config (seeded key; migration only if retired).
- Root cause hypothesis: D-28 guard does not tell EOF from a re-served page by whether a token was sent; D-29 key
  seeded in the first config migration with no implementation.
- Re-verification on a053b0e: both D-ids reproduce by reading; no line drift.
  - D-28: `servicer.py:1432-1435` (unchanged); docstring `:1394-1412`; `_MAX_BAR_PAGES = 32` `:298`,
    `_BAR_PAGE_SIZE = 1000` `:294`. **Test that locks the bug in:** `tests/test_warmup.py:236-243`
    (`test_identical_page_with_identical_token_terminates` asserts `[1, 2]`). The fix must invert it to expect
    `_BarFetchError` — a deliberate test change, not a regression (record in design per C-18).
  - D-29: `001_config_tables.up.sql:69`, `002_config_environment.up.sql:71`, analysis `CLAUDE.md:468` (all unchanged);
    0 readers in `app/`; screener's own key read at `servicer.py:3786` (unchanged); `RunBacktest` at `:785`, no
    `wait_for`. `docs/reports/2026-08-07-config-governance-audit.md` also mentions the key (historical).
- **Overlaps:**
  - `244-fix-python-config-stored-zero` (implementation-ready) changes the analysis getters. If D-29 wires the key,
    read it presence-aware so a stored 0 is not silently replaced (or clamp 0 = no limit explicitly), and rebase on 244.
  - `docs/reports/2026-10-19-dead-config-keys-defect.md` (`open`) does not list this key; if design retires it, note
    the addition there or in its eventual feature to avoid a second retirement.
  - No feature in 240–253 touches `_fetch_bars_paged` or `RunBacktest`'s deadline.
  - `strat-lab` plugin: if `run_backtest` gains a new failure mode (truncation error or `DEADLINE_EXCEEDED`), root
    CLAUDE.md requires the `backtest` skill update in the same PR (`docs/patterns/strat-lab-plugin.md`).
- Recommended design depth: full → `/sdd-design fix-analysis-backtest-bounds` (rationale: 2 affected services and a
  possible config migration — the C-0 full trigger). Design fork for D-29: wire `asyncio.wait_for` (and the
  production 120 s value then becomes live — check current backtest durations on dev first) vs retire the key.
- Development branch: feature/fix-analysis-backtest-bounds

## Session 2026-10-21 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria verdict: PASS WITH WARNINGS (0 fails, 0 floor breaches).
  Overlap verdict: WARN (no FAIL).
- OPERATOR DECISIONS (binding, recorded 2026-10-21):
  - Grouped by service+theme from the 2026-10-20 debt-radar scan; Track C.
  - Scope is D-28, D-29.
- Warnings (for /sdd-design):
  - OQ-1 (enforce vs retire the backtest duration key) stays open, owned by /sdd-design. Default is enforce (FR-3
    stands). Record the resolution here at design time. If design picks retire, rewrite FR-3 and @AC-3 before
    /sdd-spec (C-11).
  - FR-3 leaves a value <= 0 (reject vs "no limit") to design. Add an @AC scenario for whichever choice is made.
  - FR-3 "a message naming the limit": @AC-3 says "names the 1 second limit". Pin the exact message string at design.
  - @AC-3 is timing-sensitive (3 s evaluation, 2 s bound). Design must pin how the delay is injected (a fake clock or
    a stubbed evaluator) so the regression test is not flaky.
  - Coverage gap (resolved in this session): added @AC-4. A token-bearing request that returns an empty page is a loud
    failure (FR-1). It is distinct from an empty first page, which is EOF (FR-2).
  - Consumer surface: the spec does not say whether a UI/agent message exists for DEADLINE_EXCEEDED. Settle this at
    design, and update the strat-lab `backtest` skill in the same PR (docs/patterns/strat-lab-plugin.md).
  - The prod value of 120 s (`002_config_environment.up.sql:71`) first takes effect on enforce. Before launch, check
    dev backtest durations against it.
- Overlap findings (WARN only):
  - `servicer.py` RunBacktest (`:785`) / `_fetch_bars_paged` (`:1394-1446`) is shared with 244
    `fix-python-config-stored-zero` (implementation-ready). FR-3 depends on 244's presence-aware getter, so 244 merges
    first or this feature rebases on it.
  - Shares the RunBacktest region and the `_fetch_bars_paged` pager precedent with 215
    `fundamentals-blend-strategy-restrictions` (in-progress, live overlap).
  - Shares `servicer.py` with 245 `fix-screener-symbol-isolation` (screener deadline `:3786`, which FR-3 mirrors).
    FR-3 must not edit the screener block.
  - 274 `otel-metrics-logs-export` (spec-ready) cites `servicer.py:799-800` inside RunBacktest. Re-check at impl-spec.
  - `tests/test_analysis_servicer.py` is shared with 244 and 215, but no test case is shared. No other active feature
    names `tests/test_warmup.py`.
  - Config key `analysis.backtest.max_duration_seconds`: no active feature defines or edits it.
  - Migration 033 is free in every active spec (needed only under retire). Separately, 032 is double-claimed by 244
    and 248, a FAIL between those two features that does not involve this one. Flagged to the router.
  - Merge-order (router-owned proposal): add a Blocking Dependencies row "fix-analysis-backtest-bounds blocked by
    fix-python-config-stored-zero (244)". Consider also blocking on 215 for the RunBacktest region.

## Session 2026-10-22 — sdd-batch design state recovered (round 1)

- The batch run that produced round 1 was cut off by the session usage limit before its gate writer persisted the debate state. This block is the round-1 synthesis restored verbatim from the run journal (`synth:fix-analysis-backtest-bounds:r1`), so the next /sdd-batch run resumes from it instead of redoing the debate.

```sdd-batch-design-state
{
  "round": 1,
  "synth": {
    "approach": "Round-1 synthesis: keep the proposer's shape and fold in the adversary's fixes that are cheap and grounded. Paths are under services/xstockstrat-analysis/app/handlers/servicer.py unless noted.\n\nD-28 (FR-1/FR-2). In `_fetch_bars_paged`, change the `if not fresh: return bars` branch (:1432-1435). The loop's `page_token` is non-empty exactly when a token was sent. In that case raise `_BarFetchError(f\"{symbol}: page_token {page_token!r} added no newer bar ({len(bars)} bars so far) \u2014 refusing to return a truncated series\")`. An empty `page_token` (empty first page) still returns `bars`, as does the EOF exit at :1441-1443. Update the docstring (:1401-1405). In tests/test_warmup.py, invert :236 to `pytest.raises(_BarFetchError, match=\"refusing to return a truncated series\")`, and add AC-4 (token plus empty page) and a three-bar EOF test for AC-2. Step 1 verification runs the whole analysis suite, not just test_warmup.py: 102 `GetBars = AsyncMock` sites could carry a truthy MagicMock token.\n\nR-1, the error is swallowed. In the RunBacktest per-symbol loop, add `except _BarFetchError: raise` before `except grpc.RpcError` / `except Exception` (:1127-1132). The public wrapper catches `_BarFetchError` and aborts with a pinned message prefix. Current best code is FAILED_PRECONDITION rather than UNAVAILABLE, with prefix `backtest bar series incomplete: {e}`. Both causes the spec names are deterministic upstream states (a re-served page after marketdata's `cursor = start` fallback, and the `_MAX_BAR_PAGES` cap), so a retry gets the same answer. The servicer reserves UNAVAILABLE for transient store outages (:684, :2536, :2566). This single handler also covers the benchmark path. `_load_benchmark_bars` at :951-965 catches only `_InsufficientData`, so today a benchmark `_BarFetchError` leaks out as UNKNOWN. Other callers keep their best-effort mapping, verified as preserved: the four `fetch_bars=` injections go through `compute_readiness_row`, whose `except Exception` sets `fetch_ok=False` (app/services/readiness.py:66-71), and the chart path catches it at :1954-1960.\n\nD-29 (FR-3), done without re-indenting:\n- Rename the current RunBacktest body to `async def _run_backtest(self, request, context, disarm)`. Body unchanged except one line.\n- A thin public `RunBacktest` keeps `@owner_scoped`. At call time it reads `limit = self._cfg.get_int_present(\"analysis.backtest.max_duration_seconds\", 300)`. `0` means no limit. A negative value falls back to 300 with a WARN log. No config-service registry change.\n- It runs `async with asyncio.timeout(limit or None) as bound: return await self._run_backtest(request, context, lambda: bound.reschedule(None))`.\n- On `except TimeoutError`: if `not bound.expired()`, re-raise; otherwise `await context.abort(grpc.StatusCode.DEADLINE_EXCEEDED, f\"backtest exceeded {limit}s deadline\")` and `return None`. The return-None idiom is the one at :475-476.\n- `disarm()` is called once, right before `self._backtests[backtest_id] = result` (:1267). Only a narrow callable crosses into the body, not the Timeout object.\n- After disarm, persistence (cells :1280, history :1300, detail :1314, headline :1322, completed event :1344) always runs to the end. A run past the deadline during compute writes no evidence or history, which keeps `@AC-3 @feature-149`.\n\nTests:\n- AC-3: limit=1, symbol stubs `await asyncio.sleep(3)`. Assert DEADLINE_EXCEEDED, the message, elapsed under 2 s, and no history or cells written.\n- Commit-point pin: the deadline fires after `disarm()` (e.g. a slow stubbed `_recompute_headline`), and the completed event plus history are still written.\n- Executor case: the deadline fires while awaiting `run_in_executor`; the RPC returns and the thread keeps its slot (R-3).\n- AC-5: a stored 0 means no deadline.\n- Negative value: falls back to the default.\n- AC-6: `_BarFetchError` gives FAILED_PRECONDITION and no history or cells.\n\nDocs:\n- Analysis CLAUDE.md:468 row: the key bounds evaluation up to result assembly. Persistence and grade recompute (including the 215 PIT fan-out) are not bounded, so total RPC time can exceed it. 0 = no limit, negative = default, DEADLINE_EXCEEDED, the executor thread is not interrupted.\n- plugins/strat-lab backtest skill, reference/output-handling.md, reference/aggregation.md, plugins/strat-lab/README.md, and the docs/runbooks/mcp-tools.md error table (next to :412): two rows. DEADLINE_EXCEEDED: narrow the range or symbols, do not blind-retry. FAILED_PRECONDITION `backtest bar series incomplete:`: not fixed by retry, report it. This extends `@AC-32 @feature-224`.\n\nPinned operator gates, carried as open blocking objections until the spec writes them in:\n1. Before launch, query the ledger for the gap between `analysis.backtest.started` (:818) and `analysis.backtest.completed` (:1346) on `backtest:<id>` streams, dev and prod, p95/p99. If p99 is above about 100 s, the operator either raises the prod value through config (change the seed with migration 033 only if needed) or signs off in context.md. The prod seed is 120, from services/xstockstrat-config/migrations/002_config_environment.up.sql:71.\n2. Record the cross-feature invariant \"client deadline > analysis.backtest.max_duration_seconds + persistence slack\" in this feature's and fix-agent-client-deadlines' context.md, the agent doc rows, and the UI BFF transport.\n\nConsumer UI is verified: both surfaces render the server message verbatim through `ConnectError.rawMessage` (services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx:89-92 and :484; trader/positions/[symbol]/page.tsx:1141). No UI step is needed.\n\nUnchanged: no proto, no migration (unless gate 1 forces one), no new emits. The abort uses the inbound context, and existing emits keep `propagation_meta`/`x-trace-id`, which satisfies the operator's C-03 trace rule.\n\nBuild order:\n1. FR-1/FR-2 guard and tests, plus the full-suite run.\n2. `_BarFetchError` re-raise and the wrapper mapping, plus AC-6.\n3. Rename and wrapper, deadline, disarm, negative-value handling, plus AC-3, AC-5 and the commit-point and executor tests.\n4. Docs and consumer rows.\n5. Pre-launch duration-evidence gate.",
    "open_objections": [
      {
        "text": "R-5/P-03: the 120 s prod limit is enforced for the first time and nothing gates it. The spec must pin a pre-launch step that measures started\u2192completed gaps (p95/p99) from the ledger in dev and prod. If p99 is above about 100 s, the operator must either raise the prod value or sign off in context.md. A note in the risks section does not count as a gate.",
        "blocking": true
      },
      {
        "text": "C-10 cross-feature seam with fix-agent-client-deadlines: the agent stub.RunBacktest (services/xstockstrat-agent/app/client.py:634), and the UI BFF transport, must use a client deadline greater than analysis.backtest.max_duration_seconds plus persistence slack. Otherwise the server's 'backtest exceeded Ns deadline' message never reaches the caller. Record the invariant in both features' context.md and in the agent doc rows.",
        "blocking": true
      },
      {
        "text": "Status code for _BarFetchError: the synthesis moves it from UNAVAILABLE to FAILED_PRECONDITION with the pinned prefix 'backtest bar series incomplete:', because both causes are deterministic and the servicer uses UNAVAILABLE for transient store outages. The proposer must confirm this in r2, or keep UNAVAILABLE and pin 'retry at most once, then report' text in the skill and mcp-tools.md.",
        "blocking": false
      },
      {
        "text": "\u22640 semantics: the synthesis chooses 0 = no limit, negative = fall back to 300 with a WARN, and no config-service SCALAR_BOUNDS_REGISTRY bound. A value of 1 still makes every backtest fail. The proposer should accept this, or justify adding a [0,3600] registry bound in xstockstrat-config. Whichever is chosen goes in CLAUDE.md:468 and @AC-5.",
        "blocking": false
      },
      {
        "text": "Doc accuracy: after disarm, the key bounds compute up to result assembly only. _recompute_headline (:1322) and persistence are unbounded. The CLAUDE.md row and the skill text must not call it a 'max backtest run time'.",
        "blocking": false
      },
      {
        "text": "R-1 delta: failing the whole run throws away healthy symbols. This is inconsistent with the per-symbol RpcError skip (:1127-1129) and with 'A partial run stays OK' (:1234). It matches the spec's 'fails loudly', but the delta and the rejected skip-with-CoverageGap alternative must be written into design.md (see insights.md:178-190).",
        "blocking": false
      },
      {
        "text": "Tests to pin: (a) the deadline fires after disarm and persistence still completes; (b) the deadline fires while awaiting run_in_executor, and the RPC returns while the thread keeps running. Both are named but not yet in the AC/test plan.",
        "blocking": false
      },
      {
        "text": "Spec-time harness grep (fails.md:1394-1396): every RunBacktest harness whose cfg is a bare MagicMock without a get_int_present stub must be found. make_servicer() (tests/test_analysis_servicer.py:49) and the three named harnesses are already fine.",
        "blocking": false
      },
      {
        "text": "Not yet verified: whether the agent run_backtest MCP tool surfaces the new status messages verbatim. The two UI pages were verified to render ConnectError.rawMessage.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1 @feature-272",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-2 @feature-272",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-3 @feature-272",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-4 @feature-272",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-5 @feature-272 (new: stored 0 = no deadline; negative = default)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-6 @feature-272 (new: _BarFetchError -> FAILED_PRECONDITION, no history/cells)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3 @feature-149",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-8 @feature-215",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4 @feature-152",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-9 @feature-151",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4 @feature-176",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 @feature-181",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-1 @feature-185",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-32 @feature-224",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Whole-body asyncio.wait_for mirroring the screener (:3786-3796): the smallest diff, but a cancellation can land between the evidence write :1280 and the completed event :1346 and leave cells or history without a completed event.",
      "Split the body into _compute_backtest + _persist_backtest and wrap only compute: clean responsibilities, but too many locals have to be threaded through (symbol_cells, fund_cache, fund_failures, caller_user_id, ...). That is a large diff that collides with peer features 215 and 274, against the operator's low-rework instruction.",
      "Skip the symbol with a CoverageGap and a result.warnings entry instead of failing the run: keeps healthy symbols and matches per-symbol handling, but contradicts the spec's 'fails loudly' and still writes evidence from a fault the run itself detected.",
      "Passing the asyncio Timeout object ('bound') into the body: replaced with a narrow disarm callable so the body cannot touch any other part of the timeout (C-18).",
      "UNAVAILABLE for _BarFetchError: implies 'transient, retry', but both causes are deterministic, so a retrying agent or skill would loop. FAILED_PRECONDITION is preferred, pending proposer confirmation.",
      "\u22640 = no limit for all non-positive values: a typo like -1 would silently remove the bound. Only 0 disables; negatives fall back to the default.",
      "A server-enforced SCALAR_BOUNDS_REGISTRY bound in xstockstrat-config: more robust, but adds config-service scope. Deferred under the low-rework instruction unless r2 justifies it.",
      "Deferring the /insights and trader UI check: resolved now by reading the code. Both render ConnectError.rawMessage verbatim, so no UI step is needed."
    ],
    "open_risks": [
      "The prod limit of 120 s (config migration 002:71) is enforced for the first time. Multi-symbol portfolio runs that complete today may get DEADLINE_EXCEEDED. Mitigated only by the pinned duration-evidence gate.",
      "When the deadline fires, the work in a run_in_executor thread (:1717, :2229, :2400) is not interrupted. It keeps its _compute_executor slot, so repeated timeouts can saturate the executor even though the RPC returns.",
      "Placing disarm() after any later await reintroduces the half-persisted run. Only the pinned commit-point test guards this.",
      "Behavior change (insights.md:178-190): runs that used to 'succeed' with one symbol truncated by a re-served page now fail entirely.",
      "FR-1 can turn previously passing tests red where a GetBars mock returns a truthy MagicMock next_page_token. The full suite must be run.",
      "Orphan analysis.backtest.started events (:818) with no completed event, for timed-out or bars-failed runs. Same as today's mid-run aborts, but more frequent.",
      "Rebase churn: the rename moves code that peers 215 and 274 cite into _run_backtest. The code is unchanged, but their line references shift.",
      "Cross-feature deadline ordering with fix-agent-client-deadlines: if the agent or BFF deadline is \u2264 the server limit, the server's message is masked by a generic client-side DEADLINE_EXCEEDED."
    ],
    "constitution_rules_touched": [
      "C-03",
      "C-10",
      "C-11",
      "C-14",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-03",
      "F-01",
      "F-07"
    ],
    "rationale": "The adversary verified the core mechanics against the code: the disarm point at :1267 comes before every persistence write, there is no CancelledError/BaseException handler in the body, the symbol loop is sequential, and make_servicer() stubs get_int_present. I also confirmed that the `if not fresh: return bars` branch is the defect site, that the per-symbol `except Exception` at :1130-1132 swallows _BarFetchError, and that the benchmark path catches only _InsufficientData. That makes rename-plus-wrapper the lowest-rework option that keeps @AC-3 @feature-149, matching the user's 'preserve as much as you can while having low rework'.\n\nI closed the C-14 UI objection by reading the code: both pages render ConnectError.rawMessage. I adopted the adversary's cheap fixes: the narrow disarm callable, negative values falling back to the default, the doc wording that the key bounds compute only, and the full-suite run. I moved the status code to FAILED_PRECONDITION because the servicer already uses UNAVAILABLE for transient store outages and both truncation causes are deterministic. That change and the \u22640 choice stay non-blocking until the proposer confirms them.\n\nTwo blocking objections stay open because the proposal did not concretely answer them: the prod 120 s evidence gate and the client/server deadline ordering with fix-agent-client-deadlines. Both need pinned spec and context.md entries before design approval. There are no Floor breaches: F-07 holds because 300 is only the call-site fallback, and F-01 holds because there is no migration."
  },
  "floor_breaches": []
}
```
