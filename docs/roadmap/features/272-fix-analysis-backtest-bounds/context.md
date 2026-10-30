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

## Session 2026-10-22 — sdd-batch design gate (round 2)

The `/sdd-design fix-analysis-backtest-bounds` full debate is halted at its approval gate after round 2 (gate policy: halt). design.md is not written and status.md is unchanged, per the grilling protocol. The next /sdd-batch run resumes from the state block below.

## Open Threads

- **Approach (r2 synthesis).** Rename the current `RunBacktest` body to `_run_backtest(request, context, disarm)`, behind a thin `@owner_scoped` wrapper. The wrapper reads `analysis.backtest.max_duration_seconds` with `get_int_present` (default 300; 0 = no limit; negative = 300 plus a WARN) and runs the body under `asyncio.timeout`. It maps `TimeoutError` to DEADLINE_EXCEEDED `backtest exceeded Ns deadline` only when `cm.expired()` is true, and re-raises otherwise. `disarm()` is called once, just before `self._backtests[backtest_id] = result` (:1267), so persistence always completes. `_BarFetchError` is re-raised out of the per-symbol loop and mapped to FAILED_PRECONDITION `backtest bar series incomplete:`; this also covers the benchmark path, which today escapes as UNKNOWN. **D-28 changed to adversary option (a):** `_fetch_bars_paged` raises only when a token was sent **and** the response re-issues a non-empty `next_page_token`. An empty response token is EOF. No proto, no migration, no UI change. Docs and consumer rows cover the analysis CLAUDE.md, the strat-lab skill, README.md and mcp-tools.md, including the prod 60 s MCP-cap disclosure. G-1 is a pinned launch-checklist step: ledger started/completed p50–p99, an orphan-`started` count, and an operator-input threshold. The C-10 seam I-1..I-3 is owned by fix-agent-client-deadlines.
- **Strongest open objections (blocking):**
  1. [P-03/C-15] D-28 discriminator. The proposer must confirm option (a) plus the new AC-7 in round 3, or take the stricter option (b) with its own AC and a recorded spec delta against product-spec.md:23.
  2. [C-10] The I-2 fallback must be decided before `/sdd-spec`. If fix-agent-client-deadlines does not adopt the `deadline_s is None → exc.details()` pass-through (tools.py:228-231), this feature adds xstockstrat-agent to Affected Services now, pins the order in merge-order.md, and adds a C-08 agent test step. The proposer's retroactive fallback at step 4 is rejected. Ownership must be recorded in both features' context.md.
- **Non-blocking:**
  - grpc.aio cancellation semantics are unverified locally; AC-3b is the tripwire.
  - The proposer has yet to confirm the `cm.expired()` check.
  - G-1 threshold and orphan-count wording must go into the spec.
  - Prod 60 s MCP-cap disclosure in the docs.
  - "Do not retry immediately" (executor-thread pile-up).
- **Floor status:** no breaches. The 300 fallback follows the existing `get_int_present` default pattern (F-07), and there is no migration (F-01).
- **@AC changes:**
  - Operator-covered (operator decision "Scope is D-28, D-29"): @AC-1 @feature-272 is CHANGE, @AC-3 @feature-272 is CHANGE, @AC-2 @feature-272 is PRESERVE.
  - **Not yet covered by an operator decision:**
    - New EXTENDs @AC-4..@AC-7 @feature-272: a token-bearing re-served page raises; stored 0 / negative semantics; FAILED_PRECONDITION for `_BarFetchError`, including the benchmark UNKNOWN → FAILED_PRECONDITION change; a sent token followed by an empty page and empty next token is EOF.
    - EXTEND @AC-32 @feature-224.
    - The PRESERVE set: @AC-3 @feature-149, @AC-8 @feature-215, @AC-4 @feature-152, @AC-9 @feature-151, @AC-4 @feature-176, @AC-2 @feature-181, @AC-1/@AC-5 @feature-185.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Round-2 synthesis. The r2 shape stands: rename plus thin wrapper, a narrow disarm callable, FAILED_PRECONDITION for `_BarFetchError`, presence-aware config read, and no proto or migration. This round changes the D-28 discriminator and folds in the adversary's cheap fixes. Paths are under services/xstockstrat-analysis/app/handlers/servicer.py unless noted.\n\n1. **D-28 (adversary option (a), adopted).**\n   - In `_fetch_bars_paged`, replace `if not fresh: return bars` (:1432-1435) with: raise only when `page_token` (the token sent) is non-empty **and** `resp.page.next_page_token` is non-empty.\n   - The error is `_BarFetchError(f\"{symbol}: page_token {page_token!r} added no newer bar and re-issued a cursor ({len(bars)} bars so far) — refusing to return a truncated series\")`.\n   - An empty-fresh page with an empty response token returns `bars` as EOF. This covers both an empty first page and \"token sent, empty terminal page\".\n   - Why this is enough: marketdata's `cursor = start` fallback re-serves the first page with its own non-empty token, because a first page is only tokened when the range exceeds 500 bars. That satisfies @AC-1, which uses token \"stuck\" on every response. It also matches the spec text \"a re-served page on a token-bearing request raises, while genuine EOF still returns\" (product-spec.md:23).\n   - The `:1441-1443` EOF exit and the `_MAX_BAR_PAGES` cap (:1445-1448) are unchanged. Update the docstring (:1401-1410) to state the two-token rule.\n   - Tests:\n     - Invert tests/test_warmup.py:236-243 to `pytest.raises(_BarFetchError, match=\"refusing to return a truncated series\")` (AC-1).\n     - Add the three-bar EOF test (AC-2).\n     - Add AC-4: a token-bearing re-served page that still carries a token raises.\n     - Add AC-7: a sent token followed by an empty page with an empty next token returns `[1, 2]`.\n   - Step 1 runs the full analysis suite, because 102 `GetBars = AsyncMock` sites may return a truthy MagicMock `next_page_token`.\n\n2. **R-1 (confirmed).**\n   - Add `except _BarFetchError: raise` before `except grpc.RpcError` (:1127).\n   - The wrapper aborts with `FAILED_PRECONDITION` and the message `backtest bar series incomplete: {e}`.\n   - The benchmark path (:951-965) catches only `_InsufficientData`, so today a benchmark `_BarFetchError` escapes as UNKNOWN. After this change it maps to FAILED_PRECONDITION.\n   - The agent passes this through verbatim via `exc.details()` (services/xstockstrat-agent/app/tools.py:240).\n   - design.md must record the insights.md:178-190 delta: (i) one bad symbol now fails the whole run, unlike the per-symbol skip at :1127-1132 and \"partial run stays OK\" at :1234; (ii) benchmark UNKNOWN becomes FAILED_PRECONDITION. It must also record the rejected skip-with-CoverageGap alternative.\n   - Other callers stay best-effort and are verified: readiness.py:66-71 sets `fetch_ok=False` (keeps @AC-2 @feature-181 and @AC-1/@AC-5 @feature-185), and the chart path catches at :1954-1960.\n\n3. **D-29 wrapper (amended).**\n   - Rename the current body to `async def _run_backtest(self, request, context, disarm)`. The public `RunBacktest` keeps `@owner_scoped`.\n   - Read `limit = self._cfg.get_int_present(\"analysis.backtest.max_duration_seconds\", 300)` (watcher.py:107). `0` means no limit. A negative value logs a WARN and uses 300.\n   - Run `async with asyncio.timeout(limit or None) as cm: return await self._run_backtest(request, context, lambda: cm.reschedule(None))`.\n   - `except TimeoutError:` if `not cm.expired()`, re-raise. This is the adversary's C-18 fix, so inner `wait_for` timeouts from peers 215/274 are not misreported. Otherwise call `await context.abort(DEADLINE_EXCEEDED, f\"backtest exceeded {limit}s deadline\")` and `return None` (idiom :475-476).\n   - `except _BarFetchError as e:` call `context.abort(FAILED_PRECONDITION, ...)`.\n   - `disarm()` is called exactly once, immediately before `self._backtests[backtest_id] = result` (:1267). The only awaited call before it is the read RPC `_fundamentals_gap_labels` (:1246).\n   - Persistence after disarm always completes: cells :1280, history :1300, detail :1314, headline :1322, completed event :1344.\n   - A run timed out during compute writes no evidence or history (keeps @AC-3 @feature-149).\n\n4. **Tests pinned in the plan.**\n   - AC-3: limit 1, a stubbed symbol awaits `asyncio.sleep(3)`. Expect DEADLINE_EXCEEDED in under 2 s, a message naming 1 s, and no cells or history.\n   - AC-3b, new for the cancellation-swallow objection: the stall sits inside an awaited `self._marketdata.GetBars` AsyncMock, and the test asserts DEADLINE_EXCEEDED. This guards against `except grpc.RpcError`/`except Exception` at :1127-1132 absorbing the cancellation.\n   - T-inner-timeout: a `TimeoutError` raised inside the body while `cm` has not expired propagates and is not mapped to the deadline message.\n   - T-commit: a slow stubbed `_recompute_headline` after `disarm()` still writes the completed event and history.\n   - T-executor: the deadline fires while awaiting `run_in_executor`. The RPC returns, and a `threading.Event` shows the thread finishes later.\n   - AC-5: a stored 0 means no deadline; a stored -5 means 300 plus a WARN.\n   - AC-6: `_BarFetchError` gives FAILED_PRECONDITION with the prefix and no cells or history.\n   - Hard verification item (fails.md:1394): grep for every RunBacktest harness whose cfg is a bare MagicMock without a `get_int_present` stub.\n\n5. **Docs.**\n   - The analysis CLAUDE.md:468 row reads: \"Wall-clock bound on backtest evaluation up to result assembly; persistence and grade recompute not bounded; 0 = no limit, negative = 300; exceeded → DEADLINE_EXCEEDED `backtest exceeded Ns deadline`; executor threads are not interrupted — do not retry immediately.\"\n   - The strat-lab skill (SKILL.md, reference/output-handling.md, reference/aggregation.md), README.md and docs/runbooks/mcp-tools.md (next to :412) each get two rows:\n     - DEADLINE_EXCEEDED: narrow the range or symbols, and do not retry immediately.\n     - FAILED_PRECONDITION `backtest bar series incomplete:`: retrying will not fix it; report it.\n   - They also state the prod fact: at 120 s the agent caller hits the MCP 60 s cap first and never sees the server message. The server message reaches agent users only when the limit is below 60 s. This extends @AC-32 @feature-224.\n\n6. **Gate G-1 (pinned launch-checklist step in implementation-spec.md).**\n   - When: after step 3 is on dev, before launch-ready.\n   - Measure: query ledger `QueryEvents` (verified at packages/proto/ledger/v1/ledger.proto:15) for `analysis.backtest.started` (:818) and `analysis.backtest.completed` (:1346) on `backtest:<id>` streams, trailing 30 days, dev and prod.\n   - Record in context.md:\n     - n, p50, p95, p99 and max for runs that completed;\n     - the count of `started` events with no `completed`, per environment. This answers the survivorship-bias objection.\n   - Threshold: an **operator input**, with default edge-origin-timeout - 10 s (90 s if the Cloudflare ~100 s assumption holds).\n   - Pass: prod p99 at or below the threshold and a trivial orphan count. Otherwise the operator either (a) raises the prod row through `set_config`/config-ui, with no migration, or (b) signs off in context.md quoting the numbers.\n\n7. **C-10 seam with fix-agent-client-deadlines (I-2 amended).**\n   - I-1: any agent client deadline on `stub.RunBacktest` (client.py:634, none today) must be either above limit + 15 s, or below the MCP 60 s cap with a distinct message. At the prod limit of 120 s only the second branch is feasible.\n   - I-2 (adversary's simpler form): in `_grpc_error_message` (tools.py:228-231), when `deadline_s is None` pass through `exc.details()`, because the server originated the error. This also covers the screener abort (:3786-3796). There is no string-prefix coupling.\n   - I-3: the UI BFF `runBacktest` (insightsBff.ts:41) must not gain `timeoutMs` at or below limit + slack.\n   - Ownership: the code belongs to fix-agent-client-deadlines.\n   - Fallback, decided before `/sdd-spec`, not retroactively: if the peer does not adopt I-2, add xstockstrat-agent to Affected Services now, pin the merge order in docs/roadmap/features/merge-order.md (this feature's agent step lands after the peer's tools.py change), and add a C-08 agent test step.\n   - Record I-1..I-3 in both features' context.md.\n\nUI: no change. Both pages render `ConnectError.rawMessage`.\n\nTrace rule (operator 2026-10-21): the abort uses the inbound context, no new emits are added, and existing emits keep `propagation_meta`/`x-trace-id`.\n\nBuild order:\n1. D-28 guard and tests, plus the full-suite run.\n2. `_BarFetchError` re-raise, the wrapper mapping and AC-6.\n3. Rename, wrapper, disarm and `expired()` check, plus AC-3/3b/5, T-commit, T-executor and T-inner-timeout.\n4. Docs and consumer rows, plus the agent fallback if needed.\n5. G-1.",
    "open_objections": [
      {
        "text": "[P-03/C-15] D-28 discriminator. The synthesis adopts adversary option (a): raise only when a token was sent AND `resp.page.next_page_token` is non-empty; an empty response token means EOF. It adds AC-7 (token sent, empty page, empty next token → returns the bars so far). The proposer has not yet answered this. It must confirm (a) in r3, or choose (b): keep the stricter rule, add an AC for it, and record that the change goes beyond product-spec.md:23 in context.md.",
        "blocking": true
      },
      {
        "text": "[C-10] The I-2 fallback must be decided before /sdd-spec. If fix-agent-client-deadlines does not commit to the `deadline_s is None → exc.details()` pass-through in `_grpc_error_message` (tools.py:228-231), this feature adds xstockstrat-agent to Affected Services now, pins the merge order in docs/roadmap/features/merge-order.md, and adds a C-08 agent test step. The proposer chose a retroactive fallback at step 4, which brings back the same-file collision. Concrete ownership must be recorded in both context.md files.",
        "blocking": true
      },
      {
        "text": "[C-18] Cancellation swallowing is not proven. grpc.aio is believed to re-raise asyncio.CancelledError when a task awaiting a unary call is cancelled. That is from memory: grpc is not installed locally, so it is unverified. AC-3b, with the stall inside an awaited GetBars AsyncMock, is the pinned guard. The proposer should cite the grpc.aio `_UnaryResponseMixin.__await__` behavior or accept AC-3b as the tripwire.",
        "blocking": false
      },
      {
        "text": "[C-18] The wrapper must map TimeoutError to DEADLINE_EXCEEDED only when `cm.expired()` is true, and re-raise otherwise. The synthesis adopts this, and T-inner-timeout pins it. The proposer should confirm.",
        "blocking": false
      },
      {
        "text": "[P-03] G-1 threshold and bias. The threshold becomes an operator input (default edge timeout - 10 s), because the Cloudflare ~100 s origin timeout is not grounded in the repo. G-1 must also record per environment the count of `started` events with no `completed`. Both are adopted in the synthesis; the spec must write them into the checklist step.",
        "blocking": false
      },
      {
        "text": "[C-10] Docs must state that at the prod limit of 120 s the agent caller hits the MCP 60 s cap first and never sees `backtest exceeded 120s deadline`. I-1's first branch cannot be met in prod.",
        "blocking": false
      },
      {
        "text": "Executor-thread pile-up on retries. The skill, mcp-tools and CLAUDE.md rows must say 'do not retry immediately'. A cooperative threading.Event cancel check is recorded only as a follow-up.",
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
        "ac_id": "@AC-4 @feature-272 (new: token-bearing re-served page that still carries a token raises)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5 @feature-272 (new: stored 0 = no deadline; negative = 300 + WARN)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-6 @feature-272 (new: _BarFetchError -> FAILED_PRECONDITION 'backtest bar series incomplete:', no history/cells; includes benchmark UNKNOWN -> FAILED_PRECONDITION)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-7 @feature-272 (new: token sent -> empty page + empty next_page_token returns bars so far as EOF)",
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
        "ac_id": "@AC-5 @feature-185",
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
      "Stricter D-28 rule (raise whenever a token was sent and the page has no fresh bars, whatever the response token says). It goes beyond product-spec.md:23 ('genuine EOF still returns') and would need a spec amendment and a new AC. Option (a) catches the real marketdata `cursor = start` re-serve, which always carries a non-empty token.",
      "I-2 as a `details().startswith('backtest exceeded')` prefix match in the agent. It ties the agent to analysis's message text. Replaced with 'deadline_s is None → pass through exc.details()', which needs no string contract and also covers the screener abort.",
      "Wrapper `except TimeoutError` mapping every TimeoutError to DEADLINE_EXCEEDED. It would misreport inner wait_for timeouts, now or ones added by peers 215/274. Replaced with a `cm.expired()` check that re-raises otherwise.",
      "Retroactive I-2 fallback at step 4. It reintroduces the same-file collision with fix-agent-client-deadlines and leaves Affected Services wrong at spec time. Replaced with a pre-spec decision plus merge-order pin.",
      "Fixed G-1 threshold of 90 s derived from an assumed Cloudflare 100 s origin timeout. It is not grounded in the repo, so the threshold is now an operator input.",
      "G-1 using completed started/completed pairs only. It is biased low because it drops cancelled or errored runs. The orphan `started` count is added.",
      "Whole-body asyncio.wait_for mirroring the screener (:3786-3796). A cancellation can land between the evidence write (:1280) and the completed event (:1346), leaving a half-persisted run.",
      "Bound only the compute section (:828-1266) as an extracted helper, or split it into _compute_backtest/_persist_backtest. Too many locals have to be threaded through, and the large diff in the region peers 215/274 edit invites collisions.",
      "Skip the symbol with a CoverageGap instead of failing the run. It contradicts the spec's 'fails loudly' and still writes evidence from a fault the run itself detected.",
      "UNAVAILABLE for _BarFetchError. Both causes are deterministic, and the servicer reserves UNAVAILABLE for transient store outages (:684, :2536, :2566), so a retrying caller would loop.",
      "A SCALAR_BOUNDS_REGISTRY [0,3600] bound in xstockstrat-config. It adds config-service code scope and cannot catch the real hazard, a positive-but-small value; G-1 covers that.",
      "Passing the asyncio Timeout object into the body. Replaced with a narrow disarm callable (C-18)."
    ],
    "open_risks": [
      "The prod limit of 120 s (config migration 002:71) is enforced for the first time. Multi-symbol runs that complete today may get DEADLINE_EXCEEDED. Only the G-1 gate mitigates this.",
      "disarm() at :1267 is correct only while nothing awaited that writes state sits before it. Peers 215/274 edit this region, and T-commit is the only tripwire.",
      "grpc.aio cancellation semantics are unverified locally. If a cancelled GetBars surfaces as AioRpcError(CANCELLED), :1127 swallows it, and the run overruns and persists. AC-3b is meant to catch this.",
      "Abandoned run_in_executor threads (:1717, :2229, :2400) keep their _compute_executor slots (default 4 from analysis.compute.max_worker_threads). Rapid retries can delay the screener's sync tail.",
      "Until I-2 lands, agent users with an operator-lowered limit under 60 s still get the generic 'retry shortly' message. At prod 120 s, agent users never see the server message.",
      "Behavior change (insights.md:178-190): runs that used to 'succeed' with one symbol truncated now fail entirely, and a benchmark UNKNOWN becomes FAILED_PRECONDITION.",
      "FR-1 can turn existing tests red where GetBars mocks return a truthy MagicMock next_page_token (102 AsyncMock sites). The full suite must be run.",
      "Orphan analysis.backtest.started events (:818) for timed-out or bars-failed runs become more frequent.",
      "The rename shifts the line references that peers 215/274 cite into _run_backtest (code unchanged), which causes rebase churn.",
      "If fix-agent-client-deadlines declines I-2, xstockstrat-agent joins this feature's scope, and merge-order coupling follows."
    ],
    "constitution_rules_touched": [
      "C-03",
      "C-08",
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
    "rationale": "The r2 proposal concretely closed both round-1 blocking objections. G-1 is now a pinned launch-checklist step, and the C-10 seam has I-1..I-3 with an owner. It also confirmed FAILED_PRECONDITION, the ≤0 semantics and the doc wording, so those are resolved.\n\nThe adversary raised one new blocking point. I verified it against the code: servicer.py:1432-1435 returns on `not fresh` without checking either token. product-spec.md:23 says only \"a re-served page on a token-bearing request raises, while genuine EOF still returns\". acceptance.feature has only AC-1..3; there is no literal FR-2 in product-spec.md, and the earlier rounds' AC-4 is not in the file yet.\n\nI adopted option (a). It satisfies AC-1 (every response carries \"stuck\"), it matches the spec literally, and it still catches the real marketdata `cursor = start` re-serve, which always comes back tokened. The proposer has not answered it, so it stays blocking until r3 confirms (a) or takes (b) with an AC.\n\nI also folded in the cheap, grounded adversary fixes:\n- the `cm.expired()` check;\n- an AC-3b cancellation test inside an awaited GetBars;\n- the I-2 `deadline_s is None` pass-through, verified at tools.py:228-231, where `deadline_s` already exists in the signature;\n- the orphan-count and operator-input threshold for G-1, with ledger QueryEvents now verified;\n- the prod 60 s MCP-cap disclosure;\n- \"do not retry immediately\".\n\nThe I-2 fallback stays blocking because the proposer's retroactive version brings back the same-file collision. Scope and merge order must be fixed before /sdd-spec.\n\nThere are no Floor breaches: the 300 fallback follows the existing get_int_present default pattern (F-07), and there is no migration (F-01).\n\nThe business-rule list is corrected against the real acceptance.feature. AC-1 and AC-3 are CHANGE and AC-2 is PRESERVE, all sanctioned by the operator's 'Scope is D-28, D-29'. AC-4..7 are new EXTENDs that no operator decision covers."
  },
  "floor_breaches": []
}
```

## Session 2026-10-22 — sdd-design

- Phase 0 Recon: wrote recon.md. Services: xstockstrat-analysis, xstockstrat-config. Key reuse patterns:
  - `_BarFetchError` plus the "refusing to return a truncated series" message tail;
  - the `get_int_present` presence-aware read;
  - the screener's `context.abort(DEADLINE_EXCEEDED)` idiom.
- Phase 1 Grilling: 2 rounds (full). Termination: the operator approved at the design gate. Floor clear.
- OPERATOR DECISIONS (binding, recorded 2026-10-22, design gate r2):
  - APPROVED as synthesized, with D-28 discriminator option (a): raise only when a token was sent AND
    `resp.page.next_page_token` is non-empty. An empty next token is EOF (new @AC-7).
  - I-2 belongs to feature 273 (fix-agent-client-deadlines): the `deadline_s is None -> exc.details()`
    pass-through in `_grpc_error_message` (`services/xstockstrat-agent/app/tools.py:228-231`).
    - 272 stays analysis-only; xstockstrat-agent is not in Affected Services.
    - Merge order: 273 before 272.
- Chosen approach:
  - D-28: the two-token re-serve guard in `_fetch_bars_paged`, with `test_warmup.py:236-243` inverted (C-18).
  - `_BarFetchError` is re-raised out of the per-symbol loop and mapped to FAILED_PRECONDITION
    `backtest bar series incomplete:`. This includes the benchmark path, which was UNKNOWN before.
  - D-29: the body is renamed to `_run_backtest(request, context, disarm)` behind a thin `@owner_scoped` wrapper.
    - The limit is read with `get_int_present("analysis.backtest.max_duration_seconds", 300)`. 0 means no limit; a
      negative value means 300 plus a WARN.
    - The body runs under `asyncio.timeout`. The result is DEADLINE_EXCEEDED `backtest exceeded Ns deadline`, and
      only when `cm.expired()` is true.
    - `disarm()` is called just before `self._backtests[backtest_id] = result` (`:1267`), so persistence always
      completes.
  - No proto, no migration, no UI change.
  - Docs plus strat-lab/mcp-tools rows, including the prod 60 s MCP-cap disclosure.
  - G-1 is a launch-checklist gate.
- Rejected (full list in design.md):
  - the stricter D-28 rule (b);
  - a whole-body `wait_for`;
  - skip-with-CoverageGap;
  - UNAVAILABLE as the status code;
  - retiring the key;
  - a config-side bounds registry;
  - the agent prefix match;
  - the retroactive I-2 fallback.
- Constitution rules touched: C-03, C-08, C-10, C-11, C-14, C-15, C-16, C-18, P-02, P-03, F-01, F-07.
  Floor breaches: none.
- C-16:
  - CHANGE @AC-1 / @AC-3 @feature-272: operator sign-off 2026-10-21 ("Scope is D-28, D-29") plus the 2026-10-22
    gate approval.
  - PRESERVE @AC-2 @feature-272 and the cross-feature set listed in design.md.
  - EXTEND @AC-4..7 @feature-272 and @AC-32 @feature-224.
- Status: spec-ready → design-approved.

### Open Threads (from design.md § Open Risks)

- [ ] Add @AC-5 (stored 0 / negative), @AC-6 (FAILED_PRECONDITION, benchmark included) and @AC-7 (token sent,
  empty page, empty next token = EOF) to acceptance.feature. Target: /sdd-spec, before step 1 (C-15).
- [ ] Pin "fix-analysis-backtest-bounds after fix-agent-client-deadlines (273)" in
  `docs/roadmap/features/merge-order.md`, and record I-1..I-3 in 273's context.md. Both belong to other writers.
  Target: before /sdd-spec.
- [ ] Prod 120 s is enforced for the first time; runs that complete today may get DEADLINE_EXCEEDED. Target: the
  G-1 launch-checklist step (ledger p50-p99, orphan-`started` count per environment, operator-input threshold).
- [ ] `disarm()` placement at `:1267` is fragile against peer edits from 215/274. Target: step 3 (T-commit), and
  re-check at each rebase.
- [ ] grpc.aio cancellation is unverified locally. A swallowed `AioRpcError(CANCELLED)` at `:1127` would let the
  run overrun. Target: step 3 (AC-3b).
- [ ] Abandoned executor threads hold `_compute_executor` slots. Target: step 4 docs ("do not retry immediately").
  A cooperative cancel is a follow-up only.
- [ ] Agent users get the generic message until 273's I-2 lands, and never see the server message at prod 120 s
  because the MCP 60 s cap fires first. Target: step 4 docs, plus merge order 273 → 272.
- [ ] Behavior delta: one truncated symbol fails the whole run, and a benchmark UNKNOWN becomes FAILED_PRECONDITION
  (insights.md:178-190). Target: step 2 (AC-6) and the PR body.
- [ ] About 102 `GetBars` AsyncMock sites may return a truthy MagicMock `next_page_token` and turn tests red.
  Target: step 1, with a full-suite run.
- [ ] Orphan `analysis.backtest.started` events will increase. Target: G-1.
- [ ] The rename shifts the line anchors cited by 215/274. Target: re-grep at /sdd-spec.
- [ ] RunBacktest test harnesses whose cfg is a bare MagicMock lack a `get_int_present` stub (fails.md:1394).
  Target: hard verification item at /sdd-spec.

## Session 2026-10-22 — sdd-spec

- Generated implementation-spec.md with 9 steps. Status: design-approved → implementation-ready. This session
  resumed after a cut session; it reused recon.md, design.md and the round-2 gate state, with no re-debate.
- **Added** @AC-5 (stored 0 = no limit; negative = 300 + WARN), @AC-6 (FAILED_PRECONDITION
  `backtest bar series incomplete:`, no persistence, benchmark included) and @AC-7 (a sent token followed by an
  empty page with an empty `next_page_token` is EOF) to acceptance.feature before any step (C-15). Coverage:
  - AC-1, AC-2, AC-4, AC-7 → Step 2;
  - AC-6 → Step 4;
  - AC-3, AC-5 → Step 6.
- **Steps:**
  1. D-28 two-token guard.
  2. Pager tests and the full-suite tripwire.
  3. Rename to `_run_backtest`, a thin `@owner_scoped` wrapper, `except _BarFetchError: raise` in the loop, and
     the FAILED_PRECONDITION map.
  4. AC-6 tests (new `tests/test_backtest_bounds.py`).
  5. `asyncio.timeout(limit or None)`, the `cm.expired()` check, and `disarm()` before
     `self._backtests[backtest_id] = result`.
  6. AC-3, AC-3b, AC-5, T-inner-timeout, T-commit and T-executor.
  7. The analysis `CLAUDE.md:468` row.
  8. strat-lab skill, README and references, plus the `mcp-tools.md` rows (@AC-32 @feature-224 parity kept).
  9. The G-1 launch gate.
- **Key codebase findings:**
  - All design anchors still hold on the branch tip:
    - `_fetch_bars_paged` `:1394`, terminal `:1432-1435`;
    - `_BarFetchError` `:358`;
    - `RunBacktest` `:784-785`;
    - loop handlers `:1127-1132`;
    - disarm anchor `:1267`;
    - completed emit `:1344-1351`;
    - screener `:3786-3796`.
  - **The design's "~102 truthy-MagicMock GetBars" risk is retired.** A scratch prototype of the option (a) guard
    against the full analysis suite (`uv run pytest -m 'not real_pg'`, 1272 tests) turned exactly one test red:
    the bug-locking `test_warmup.py::test_identical_page_with_identical_token_terminates`. Step 2 keeps the full
    suite as its tripwire.
  - **Harness audit (fails.md:1394):** every RunBacktest harness stubs `get_int_present`:
    - `make_servicer` `test_analysis_servicer.py:49`;
    - `test_owner_dimension.py:34`;
    - `test_fundamentals_formula_servicer.py:185`;
    - `test_blend_guard.py:34`.

    The remaining RunBacktest suites derive from `make_servicer`. No bare-MagicMock harness exists.
  - Reuse targets:
    - `_wire_per_symbol`, `_sym_bars` and `_mkt_def` (`tests/test_backtest_source_symbol.py:29-56`) for AC-6/AC-3;
    - the `_watcher` real-ConfigWatcher pattern (`tests/test_list_opportunities_deadlines.py:63-69`).

    A second consumer of `_watcher` moves it into `tests/conftest.py` in Step 6 (C-13).
  - No internal `self.RunBacktest` caller in `app/`, so the rename is safe. The `_BACKTEST_MAX_DURATION_DEFAULT_S =
    300` module constant serves both the getter default and the negative fallback.
  - UI consumer is verified: `insights/strategies/[id]/page.tsx:89-92`, `:484` and `trader/positions/[symbol]/page.tsx:1141`
    render `ConnectError.rawMessage`, so no UI step is needed (C-14 restated in the spec).

### Decisions (sdd-spec)

- T-inner-timeout injects the inner `TimeoutError` through `_load_benchmark_bars` (`:951`, which catches only
  `_InsufficientData`). A per-symbol injection would be swallowed by the loop's `except Exception`, so it could not
  exercise the wrapper's `cm.expired()` re-raise.
- G-1 is spec'd as a `config`-category operational gate (Step 9). Its only file is this context.md (measurements +
  operator threshold/sign-off).

### Open Threads (carried)

- [ ] Pin "fix-analysis-backtest-bounds after fix-agent-client-deadlines (273)" in
  `docs/roadmap/features/merge-order.md`, and record I-1..I-3 in 273's context.md. This is still outside this
  writer's scope (router / 273's writer); it is not on this branch.
- [ ] G-1 measurements and the operator threshold. Target: Step 9, after Step 5 is on dev.
- [ ] Re-grep `self._backtests[backtest_id] = result` and the loop handlers at every rebase onto peers 215/274/244.

## Session 2026-10-22 — sdd-review impl-spec (advisory)

- Result: 0 failures, 7 warnings, 0 floor breaches (advisory; did not block). Overlap: WARN (file-level only; no
  migration, proto or config-key collision for 272). Lifecycle unchanged (`implementation-ready`).
- Addressed in implementation-spec.md (each claim re-verified against the tree):
  - Step 6 **Files** now lists `tests/conftest.py` and `tests/test_list_opportunities_deadlines.py`. The helper move
    is item 0 (done first, as `config_watcher` in conftest); the "define `_watcher` locally" preamble is gone and
    item 8 just says there is one declaration site (C-13).
  - Line hints re-grepped and corrected: `_load_benchmark_bars` awaited at `:952` (was :951, three places);
    `analysis.backtest.started` append `:817-826`, `event_type` `:820`; `analysis.backtest.completed` append
    `:1344-1352`, `event_type` `:1346`; `mcp-tools.md` Errors table `:406-415`, `max_range_days` row `:412`, last
    row `:415`.
  - Step 6 AC-3, AC-3b and T-executor now call under `pytest.raises(Exception, match="aborted")` (the
    `_owned_ctx()` abort mock raises), matching Step 4.
  - Step 6 negative-limit test now uses `monkeypatch.setattr(servicer_mod.asyncio, "timeout", recorder)`, with the
    recorder delegating to the real `asyncio.timeout`; it is restored at teardown, so the global patch cannot leak.
  - Step 6 T-commit notes the accepted same-tick edge: a deadline firing just before `disarm()` still maps to
    DEADLINE_EXCEEDED. No code change; it is informational.
- Still open (carried to the /sdd-execute checkpoint):
  - [ ] C-10 merge order: the "272 after 273 (fix-agent-client-deadlines)" Blocking Dependencies row in
    `docs/roadmap/features/merge-order.md`, and the I-1..I-3 record in 273's context.md, are not written. They are
    outside this writer's scope (router / 273's writer). Close before /sdd-execute, or the order is advisory only.
  - [ ] Step 9 G-1 gate: the 90 s / Cloudflare ~100 s assumption is ungrounded (P-03). The operator threshold and the
    measurements are still owed; the gate must not be skipped before `launch-ready`.
  - [ ] Overlap rebase churn on `servicer.py` (215, 244; 244's anchors at `:787-788` and `_backtest_symbol_evaluated`
    move behind the Step 3 wrapper), `tests/conftest.py` (244, 246, 215 also add helpers; names differ, merge
    conflict only), analysis `CLAUDE.md` (246, 244, 215; different sections) and `mcp-tools.md` (249; different
    row). Re-grep anchors at every rebase.
  - Router note, not 272's: peers 244 and 248 both claim config migration `032`.

## Session 2026-10-29 — re-spec (sdd-execute sequential, sdd-batch-execute)

- Branch setup: detached at `origin/feature/fix-analysis-backtest-bounds`, normal merge of `origin/main-dev`
  (`b8b8bac2`, no conflicts); ledger-guard `--fix` reported clean (no repair).
- Re-spec of step bodies 1, 3, 4, 5, 6, 7, 8 and 9 only (implementation-spec.md), each claim re-grepped:
  - Steps 1, 3, 4, 7, 8: line drift only (e.g. `_fetch_bars_paged` `:1401`, `RunBacktest` `:792`, loop handlers
    `:1134-1139`, disarm anchor `:1274`, `_windowed_req` `:3685`, analysis CLAUDE.md row `:509`, mcp-tools Errors
    `:421`). Content matches.
  - Step 5: feature 244 landed on main-dev. `get_int` (`watcher.py:111-117`) is now presence-aware and
    `get_int_present = get_int` (`:119`), so the call keeps its semantics. `int_positive` (`:142`) is not usable
    (0 must mean no limit; a negative must WARN). The screener read is now `int_positive(..., 120)` at `:3793`, and
    the verification text says so. The `default_fill_model` note is no longer called a zero-trap.
  - Step 6 (C-13): reuse the existing `tests/conftest.py:61` `snapshot_watcher` instead of adding `config_watcher`.
    `tests/conftest.py` and `test_list_opportunities_deadlines.py` are dropped from Files. Migrating that file's
    local `_watcher` onto `snapshot_watcher` is a separate decision, out of scope here.
  - Step 9: the prior evidence was wrong. `029` heals only platform/trading/portfolio/marketdata. The analysis rows
    are still the bare `backtest.max_duration_seconds` (001:69 `'300'`, 002:71 `'120'` production), so the dotted read
    gets the 300 s code default everywhere unless an operator creates dotted rows. Step 9 now carries an
    **operator-decision blocker** (A: reword G-1 / set dotted rows via set_config; B: heal migration — a new DB gate
    and a re-spec; C: other). No choice was made on the operator's behalf.
  - Step 8 docs rows no longer name "prod 120 s, staging 300 s". They say "default 300 s; 0 = no limit", which is
    true under any Step 9 decision.
- Not re-specced (outside the directive's step-body scope, non-normative): the Execution Summary's "first-enforced
  prod value of 120 s" sentence and the Step Dependencies line hints (244 / 245 anchors). The step bodies above
  supersede them.

### Open Threads (carried)

- [ ] **Step 9 operator decision (A/B/C) on the bare-vs-dotted key.** Needed before G-1 runs. Does not block
  Steps 1-8.
- [ ] C-10 merge-order pin (273 before 272) and I-1..I-3 in 273's context.md: still outside this writer's scope.
- [ ] G-1 measurements and the operator threshold, after Step 5 is on dev.

## Session 2026-10-29 — sdd-execute sequential (sdd-batch-execute)

- Lifecycle: `implementation-ready` → `in-progress`.
- **Up-front confirmation (sequential mode entry):** given by the operator's standing authorization (operator chat
  2026-10-28/29, session_01NpS3HShZK6pSnogA7CFo2f: "Start executing features 241-276" via batch-execute;
  unattended checkpoints; merge-train authorized; operator-only DB/prod steps are to open a PR and hold the merge).
  Checkpoints are `report`. C-16 promotion is auto-confirmed unless it changes an existing @AC rule. No
  feature-specific blocker decision for 272 was relayed in this unit, so the Step 9 key-scope decision (previous
  entry) stays open for the operator.
- Execution order: Steps 1-8 per implementation-spec.md (TDD pairs 1/2, 3/4, 5/6). Step 9 is an operational gate
  after Step 5 is on dev, and it is blocked on the operator decision above.

## Session 2026-10-29 — sdd-execute sequential: Steps 1+2 (D-28)

- Steps 1 and 2 executed together as one commit under the standing operator rule (operator 2026-10-29, 'Merge pairs
  + standing rule'): Step 1's RED test is Step 2's test. Deviation Log entry in implementation-spec.md.
- Step 1: `_fetch_bars_paged` raises `_BarFetchError` when a page adds no fresh bar **and** a token was sent **and**
  the response re-issues a non-empty token; otherwise EOF. Docstring "Strict cursor monotonicity" bullet updated.
  Located by symbol (spec line numbers had drifted +7/+8 in the discovery digest).
- Step 2: `test_identical_page_with_identical_token_terminates` inverted to `..._raises` (C-18, deliberate);
  added `test_three_bar_eof_returns_full_series` (AC-2), `test_empty_page_with_reissued_token_raises` (AC-4),
  `test_empty_terminal_page_after_sent_token_is_eof` (AC-7). C-13: local helpers only, no conftest change.
- TDD: AC-1 red: `test_identical_page_with_identical_token_raises` DID NOT RAISE; AC-4 red:
  `test_empty_page_with_reissued_token_raises` DID NOT RAISE (2 failed, 9 passed) → green: 11 passed
  (`-k FetchBarsPaged`). AC-2 / AC-7 passed before and after (regression guards).
- Verification: `grep "re-issued a cursor"` hit; `ruff check` / `ruff format --check` clean; full suite
  `pytest --cov=app --cov-fail-under=40`: 1455 passed, coverage 90.02%. Tripwire: no other test went red.
- Files: `services/xstockstrat-analysis/app/handlers/servicer.py`, `services/xstockstrat-analysis/tests/test_warmup.py`.

## Session 2026-10-29 — sdd-execute sequential (sdd-batch-execute): branch setup + re-spec of steps 3-9

- Authorization: operator standing authorization (operator chat 2026-10-28/29, session_01NpS3HShZK6pSnogA7CFo2f:
  "Start executing features 241-276" via batch-execute; unattended checkpoints; merge-train authorized; defer
  255/275; operator-only DB/prod steps: open PR, hold merge). Checkpoints `report`; C-16 promotion auto-confirmed
  unless it changes an existing @AC rule. Status was already `in-progress`, so no transition this session.
- §5.3 branch setup: `git merge --no-edit origin/main-dev` into the detached checkout → merge `e266b4ae`, no
  conflicts. Ledger guard (`--own-slug fix-analysis-backtest-bounds --base origin/main-dev --fix`): clean, no repair.
  The merge brought feature 262 (owner scope) changes to analysis tests and `CLAUDE.md`; no anchor this feature
  cites in `servicer.py` moved (the only servicer.py change was a comment at `:3187`).
- Re-spec (implementation-spec.md, step bodies only):
  - Step 4: `_EOF_PAGE` `:135`, `_windowed_req` `:3671`, `_persist_backtest_run` `servicer.py:2861`,
    `_persist_symbol_cells` `:2940`.
  - Step 5: screener idiom `:3799-3809` (`int_positive` `:3799`, abort `:3805-3808`, `return` `:3809`);
    `stale_after_seconds` precedent `:3903`; `run_in_executor` sites `:1730`/`:2242`/`:2413`.
  - Step 6: harness audit adds `tests/test_config_zero_clamps.py:161` (`test_ac6_default_fill_model_zero_is_legacy`,
    feature 244), which sets `svc._cfg = _all_fr3_zero()` (a real `snapshot_watcher`). Its key table (`AC6_ROWS`)
    has no `analysis.backtest.max_duration_seconds`, so `get_int_present` returns 300 and the "existing runs keep
    the 300 s default" conclusion holds. `_persist_backtest_run` seam → `:2861`.
  - Steps 3, 7, 8, 9: every cited anchor re-greps at its stated line; no change.
- Open threads unchanged: Step 9 operator decision (A/B/C), C-10 merge-order pin (273 before 272), G-1 measurements.

## Session 2026-10-29 — sdd-execute sequential: Steps 3+4 (R-1, AC-6)

- Steps 3 and 4 executed together as one commit under the standing operator rule (operator 2026-10-29, 'Merge pairs
  + standing rule'): Step 3's RED test is Step 4's test. Deviation Log entry in implementation-spec.md.
- Step 3: `RunBacktest` is now a thin `@owner_scoped` wrapper that awaits `_run_backtest` (the former body,
  byte-identical, decorator removed) and maps `_BarFetchError` to `context.abort(FAILED_PRECONDITION,
  "backtest bar series incomplete: <e>")` then `return None`. The per-symbol loop gained `except _BarFetchError:
  raise` before `except grpc.RpcError`. The abort uses the inbound `context`; no emit, no minted context (C-03).
  Located by symbol (spec line numbers had drifted).
- Step 4: new `services/xstockstrat-analysis/tests/test_backtest_bounds.py` —
  `test_truncated_symbol_fails_run_failed_precondition` (AAPL re-serves with token `"stuck"`) and
  `test_truncated_benchmark_fails_run_failed_precondition` (SPY benchmark re-serves). Both assert the
  FAILED_PRECONDITION code, the message prefix, and that neither `_persist_symbol_cells` nor
  `_persist_backtest_run` was awaited. C-13: reuses `_wire_per_symbol`/`_sym_bars`/`_mkt_def` and
  `make_servicer`/`_owned_ctx`/`_windowed_req`/`_EOF_PAGE`; no conftest change.
- TDD: AC-6 red: symbol test `DID NOT RAISE` (the loop skipped AAPL and the run returned); benchmark test regex
  mismatch (the uncaught `_BarFetchError` "SPY: page_token 'stuck' added no newer bar and re-issued a cursor …"
  escaped) → 2 failed. Green: 2 passed.
- Verification: Step 3 grep hit (`:795`, `:797`, `:801`, `:1143`); `ruff check` / `ruff format --check` clean;
  `pytest --cov=app --cov-fail-under=40`: 1468 passed, coverage 90.08%; Step 4 import grep hit both lines.
- Files: `services/xstockstrat-analysis/app/handlers/servicer.py`,
  `services/xstockstrat-analysis/tests/test_backtest_bounds.py`.

## Session 2026-10-29 — sdd-execute sequential: Steps 5+6 (D-29, AC-3, AC-5)

- Steps 5 and 6 executed together as one commit under the standing operator rule (operator 2026-10-29, 'Merge pairs
  + standing rule'; widened 2026-10-30, 'Widen the rule (Recommended)'): Step 5's RED tests are Step 6's tests.
  Operator decision on the Step 5 blocker (2026-10-30, 'A: Register key (Recommended)'): register the new read in the
  feature-244 classification guard. Deviation Log entry in implementation-spec.md (step merge + Files expansion).
- Step 5: `_BACKTEST_MAX_DURATION_DEFAULT_S = 300` beside `_MAX_BAR_PAGES`. `RunBacktest` reads
  `get_int_present("analysis.backtest.max_duration_seconds", 300)` at call time (per-user overrides apply); negative
  → WARN + 300; `async with asyncio.timeout(limit or None) as cm` wraps `_run_backtest`; a `TimeoutError` maps to
  `context.abort(DEADLINE_EXCEEDED, "backtest exceeded {limit}s deadline")` only when `cm.expired()`, else re-raises.
  `_run_backtest(self, request, context, disarm)` calls `disarm()` (`cm.reschedule(None)`) immediately before
  `self._backtests[backtest_id] = result`, so persistence + the completed emit are never cut. `_BarFetchError`
  handling unchanged. No compute moved out of `run_in_executor`; no new emits (C-03). Screener read untouched.
- Step 6: `tests/test_backtest_bounds.py` gains AC-3 `test_deadline_exceeded_names_limit`, AC-3b
  `test_deadline_fires_inside_awaited_getbars`, AC-5 `test_stored_zero_means_no_limit` and
  `test_negative_limit_falls_back_to_300_with_warn` (monkeypatched `servicer_mod.asyncio.timeout` recorder),
  `test_inner_timeout_is_not_mapped_to_deadline`, `test_deadline_after_disarm_still_persists` (T-commit),
  `test_deadline_returns_while_executor_thread_finishes` (T-executor). C-13: uses `tests.conftest.snapshot_watcher`;
  no new watcher factory; conftest and `test_list_opportunities_deadlines.py` untouched.
- Files expansion: `tests/test_config_read_classification.py` — key in `HONOUR_KEYS` + `ZERO_IS_LEGIT`
  `"0 = no limit (feature-272 @AC-5)"` (without it `test_rule2_key_sets_match_classification` fails "unclassified
  plain reads").
- TDD: red 4 failed (AC-3, AC-3b, AC-5 negative, T-executor: DID NOT RAISE / no 300 recorded), 5 passed
  (AC-5 zero, T-inner-timeout, T-commit are regression guards that pass before Step 5, as the spec expects) →
  green 9 passed (+ classification guard 6 passed).
- Verification (Python 3.13.17): Step 5 grep hit all five patterns; screener read still
  `int_positive(self._cfg, "analysis.screener.max_duration_seconds", 120)`; `pytest --cov=app --cov-fail-under=40`:
  1475 passed, coverage 90.08%; `ruff check` / `ruff format --check` clean; watcher-factory grep shows only
  `conftest.py` (`snapshot_watcher`) and `test_list_opportunities_deadlines.py` (`_watcher`).
- Files: `services/xstockstrat-analysis/app/handlers/servicer.py`,
  `services/xstockstrat-analysis/tests/test_backtest_bounds.py`,
  `services/xstockstrat-analysis/tests/test_config_read_classification.py`.
- Open threads unchanged: Step 9 operator decision (A/B/C), C-10 merge-order pin (273 before 272), G-1 measurements.

## Session 2026-10-29 — sdd-execute sequential: Step 7 (docs)

- Step 7: `services/xstockstrat-analysis/CLAUDE.md:509` description cell for `analysis.backtest.max_duration_seconds`
  replaced with the design §5 text (evaluation bound up to result assembly; persistence/grade recompute unbounded;
  `0` = no limit, negative = 300 + WARN; `DEADLINE_EXCEEDED` `backtest exceeded Ns deadline`; executor threads not
  interrupted; presence-aware call-time read, per-user overrides apply). Type `int` and default `300` unchanged;
  screener row (`:538`) untouched. No deviation.
- TDD: N/A (docs).
- Verification: `grep -n "analysis.backtest.max_duration_seconds"` → `:509` (new text); `grep -c "Max backtest run
  time"` → 0.
- Files: `services/xstockstrat-analysis/CLAUDE.md`.
- Open threads unchanged: Step 9 operator decision (A/B/C), C-10 merge-order pin (273 before 272), G-1 measurements.

## Session 2026-10-29 — sdd-execute sequential: Step 8 (docs)

- Step 8 (C-14 consumer surfaces, same PR per `docs/patterns/strat-lab-plugin.md`):
  - `docs/runbooks/mcp-tools.md` `run_backtest` Errors table: two rows after the `max_range_days` row
    (`DEADLINE_EXCEEDED` `backtest exceeded Ns deadline`, default 300 s / 0 = no limit, do not retry immediately;
    `FAILED_PRECONDITION` `backtest bar series incomplete: …`, report it) plus a sentence under the table on the MCP
    60 s tool cap and feature 273's pass-through. No per-environment value named.
  - `plugins/strat-lab/skills/backtest/SKILL.md` Phase 2: "Failure modes (feature 272)" paragraph (same two cases,
    one truncated symbol fails the whole multi-symbol run, 60 s-cap fact), before `### Fill model`.
  - `reference/output-handling.md`: bullet after the fundamentals-outage bullet — RPC errors, no result file; the
    fundamentals "rerun" warning kept distinct.
  - `reference/aggregation.md` § Combine independent runs: failed basket member is reported, never aggregated as
    zero trades.
  - `plugins/strat-lab/README.md`: one line after the three-failure list naming the two loud failures.
- Anchor drift only (discovery): mcp-tools Errors table at `:421-430`, SKILL.md Fill-model heading at `:195` — text
  anchors used, matching the 2026-10-29 re-spec. No deviation.
- TDD: N/A (docs).
- Verification: `validate.py --self-test` OK and `validate.py` passed all checks; message grep hits all five files;
  `list_templates|instantiate_template` counts mcp-tools.md 7, SKILL.md 5 (unchanged); `is_public|include_public`
  no match (@AC-32 @feature-224 guard holds).
- Open threads unchanged: Step 9 operator decision (A/B/C), C-10 merge-order pin (273 before 272), G-1 measurements.

## Session 2026-10-29 — sdd-execute sequential: Step 9 (config, G-1 gate) — operator decision, deferred

- G-1 operator decision (A/B/C), in their own words (session question tool, 2026-10-30): 'A: Reword G-1, hold the merge (Recommended)'.
  Option A: G-1 measures against the effective limit, which is the 300 s code default in every environment. The seeded bare
  key `backtest.max_duration_seconds=120` (prod) is not read by Step 5's dotted `analysis.backtest.max_duration_seconds`.
  This holds unless the operator creates dotted `analysis.backtest.max_duration_seconds` rows via `set_config` or `/config-ui`
  (no migration; F-01). Option B (heal migration) not chosen.
- G-1 measurements not yet taken: ledger `QueryEvents` p50/p95/p99/max of (completed - started) plus orphan counts (dev and
  prod, trailing 30 days), the confirmed effective limit per environment, and the operator threshold are all outstanding. They
  need production/dev ledger access this session cannot perform.
- Step 9 Status stays `pending` (deferred to operator). The integration PR is opened as draft/held and must not be merged
  until the G-1 numbers and the operator threshold (or sign-off quoting them) are recorded here.
- Anchor drift (discovery, no deviation): `analysis.backtest.started` append `servicer.py:827`, `completed` `:1353`.
