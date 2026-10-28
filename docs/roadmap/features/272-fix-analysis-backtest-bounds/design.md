# Design: fix-analysis-backtest-bounds

**Created**: 2026-10-22
**Rounds**: 2 (full; termination: approved — operator approval at the design gate, Floor clear)
**Approved by**: operator @ 2026-10-22 (design gate r2: "APPROVED as synthesized with D-28 discriminator option (a)"; I-2 owned by feature 273)
**Grounded in**: recon.md

---

## Chosen Approach

Scope is D-28 and D-29 (operator, 2026-10-21). All paths are under
`services/xstockstrat-analysis/app/handlers/servicer.py` unless noted. Line numbers come from recon.md.

The shape:
- rename the `RunBacktest` body and put a thin wrapper in front of it;
- a narrow disarm callable;
- `FAILED_PRECONDITION` for `_BarFetchError`;
- a presence-aware config read;
- no proto change and no migration (recon.md:127-132).

### 1. D-28: two-token re-serve guard in `_fetch_bars_paged`

This is adversary option (a), approved by the operator on 2026-10-22.

- **Rule.** Replace the `if not fresh: return bars` terminal (recon.md:25-27, `:1432-1435`). Raise only when both
  hold:
  - `page_token`, the token just sent, is non-empty (`:1413`/`:1441`, recon.md:78-80);
  - `resp.page.next_page_token` is non-empty.
- **Error.** Reuse `_BarFetchError` (`:358`, recon.md:29-30, :75-77) and the page-cap message tail:
  `_BarFetchError(f"{symbol}: page_token {page_token!r} added no newer bar and re-issued a cursor ({len(bars)} bars so far) — refusing to return a truncated series")`.
- **EOF.** A page with no fresh bars and an empty response token returns `bars`. This covers an empty first page
  and also "token sent, empty terminal page" (new @AC-7). It matches product-spec.md:23: "a re-served page on a
  token-bearing request raises, while genuine EOF still returns".
- **Why option (a) is enough.** Marketdata's `cursor = start` fallback re-serves the first page with its own
  non-empty token, since a first page is only tokened when the range exceeds 500 bars. So the real hazard always
  comes back tokened. @AC-1 (token "stuck" on every response) and the existing @AC-4 (token "t1" re-issued on an
  empty page) both raise.
- **Unchanged.** The `:1441-1443` EOF exit and the `_MAX_BAR_PAGES` cap (`:1445-1448`, recon.md:27-28). Update the
  docstring (`:1395-1411`) to state the two-token rule.
- **Tests** (`tests/test_warmup.py` `TestFetchBarsPaged` `:210`, helpers `:193-207`, recon.md:54-59):
  - Invert `test_identical_page_with_identical_token_terminates` (`:236-243`) to
    `pytest.raises(_BarFetchError, match="refusing to return a truncated series")`. This is a deliberate C-18 test
    change: it locked the bug in.
  - Add a three-bar EOF test (AC-2), an AC-4 test and an AC-7 test (`[1, 2]` returned).
  - Run the full analysis suite in this step, because about 102 `GetBars = AsyncMock` sites may return a truthy
    MagicMock `next_page_token`.

### 2. R-1: `_BarFetchError` fails the run loudly

- **Re-raise.** In the per-symbol loop of `_run_backtest`, add `except _BarFetchError: raise` ahead of
  `except grpc.RpcError` / `except Exception` (`:1127-1132`, recon.md:138-147). Today that generic handler logs and
  skips the symbol.
- **Abort.** The wrapper aborts with `FAILED_PRECONDITION` and the message `backtest bar series incomplete: {e}`.
- **Benchmark.** The path at `:951-965` catches only `_InsufficientData` (recon.md:149-150). A benchmark
  `_BarFetchError`, UNKNOWN today, now also maps to `FAILED_PRECONDITION`.
- **Agent.** The agent already passes server details through via `exc.details()`
  (`services/xstockstrat-agent/app/tools.py:240`).
- **Behavior delta** (ledger insights.md:178-190, "pagination fixes are rarely no-behavior-change"):
  - One bad symbol now fails the whole run. Before, the per-symbol skip at `:1127-1132` and "partial run stays OK"
    at `:1234` let it through.
  - A benchmark error moves from UNKNOWN to FAILED_PRECONDITION.
- **Other callers stay best-effort, verified in debate:**
  - `readiness.py:66-71` sets `fetch_ok=False`, which keeps @AC-2 @feature-181 and @AC-1/@AC-5 @feature-185.
  - The chart path catches at `:1954-1960`.
  - The materializer and readiness paths keep their `except Exception` handling (recon.md:148-157).

### 3. D-29: wall-clock wrapper with disarm

- **Rename.** The current body becomes `async def _run_backtest(self, request, context, disarm)`. The public
  `RunBacktest` (`:784-785`, recon.md:23-24) keeps `@owner_scoped` and becomes the wrapper.
- **Config read.** Read at call time with
  `limit = self._cfg.get_int_present("analysis.backtest.max_duration_seconds", 300)` (`app/config/watcher.py:107`;
  precedent `:3890`; recon.md:45-49, :83-87). Call-time reads keep per-user overrides working (recon.md:180-181).
  - `0` means no limit.
  - A negative value logs a WARN and uses 300.
  - The `default_fill_model` `get_int` zero-trap read (`:787-794`) is untouched.
- **Timeout.** Run
  `async with asyncio.timeout(limit or None) as cm: return await self._run_backtest(request, context, lambda: cm.reschedule(None))`.
- **`except TimeoutError`:**
  - If `not cm.expired()`, re-raise. An inner `wait_for` timeout, today or from peers 215/274, is not the
    backtest deadline.
  - Otherwise `await context.abort(grpc.StatusCode.DEADLINE_EXCEEDED, f"backtest exceeded {limit}s deadline")`
    and `return None`. This is the same idiom as the screener (`:3786-3796`, recon.md:40-42), whose block is not
    edited (feature 245 owns it).
- **`except _BarFetchError as e`:** `context.abort(FAILED_PRECONDITION, f"backtest bar series incomplete: {e}")`.
- **Disarm point.** `disarm()` is called exactly once, immediately before `self._backtests[backtest_id] = result`
  (`:1267`). The only awaited call before it is the read RPC `_fundamentals_gap_labels` (`:1246`).
  - Persistence after the disarm always completes: evidence cells `:1280`, history `:1300`, detail `:1314`,
    headline recompute `:1322`, the `analysis.backtest.completed` event `:1346`.
  - A run that times out during compute writes no evidence and no history (recon.md:164-166). This preserves
    @AC-3 @feature-149.
  - The `analysis.backtest.started` append (`:818`) is inside the bound, so a timed-out run leaves an orphan
    `started` event.
- **Executor threads.** CPU cores stay in `run_in_executor` (`:1717`, `:2229`, `:2400`; recon.md:158-163). This
  preserves @AC-4 @feature-176. The RPC returns on time, but the thread runs to completion; that is documented and
  not fixed here.

### 4. Tests pinned for /sdd-spec

The cfg mocks stub `get_int_present` (fails.md:1394-1396). Harnesses: `make_servicer()` + `_owned_ctx()`
(recon.md:90-93).

| Test | Setup | Expected |
|---|---|---|
| AC-3 | limit 1; a stubbed symbol awaits `asyncio.sleep(3)` | DEADLINE_EXCEEDED in under 2 s; message names 1 s; no cells, no history |
| AC-3b | the stall is inside an awaited `self._marketdata.GetBars` AsyncMock | DEADLINE_EXCEEDED. Guards against the `:1127-1132` handlers absorbing cancellation |
| T-inner-timeout | a `TimeoutError` raised inside the body while `cm` has not expired | it propagates and is not mapped to the deadline message |
| T-commit | a slow stubbed `_recompute_headline` after `disarm()` | the completed event and history are still written |
| T-executor | the deadline fires while awaiting `run_in_executor` | the RPC returns; a `threading.Event` shows the thread finishes later |
| AC-5 | stored 0 | no deadline |
| AC-5 | stored -5 | 300, plus a WARN |
| AC-6 | `_BarFetchError` on a symbol, and separately on the benchmark | FAILED_PRECONDITION with the prefix; no cells, no history |

A hard verification item for the spec: grep every RunBacktest harness whose cfg is a bare `MagicMock` with no
`get_int_present` stub.

### 5. Consumer surface (C-14) and docs

- **UI.** No code change. Both `/insights` pages render `ConnectError.rawMessage`, so both new messages surface
  as-is.
- **Agent `run_backtest` tool.** No code change in this feature. The server message reaches the agent through
  `exc.details()`. Under the prod limit of 120 s, though, the MCP 60 s cap fires first and the agent user never
  sees `backtest exceeded 120s deadline`. The server message reaches agent users only when the limit is below 60 s,
  and then only once feature 273's I-2 lands (§7).
- **Analysis `CLAUDE.md:468` row** (recon.md:51-52) becomes: "Wall-clock bound on backtest evaluation up to result
  assembly; persistence and grade recompute not bounded; 0 = no limit, negative = 300; exceeded → DEADLINE_EXCEEDED
  `backtest exceeded Ns deadline`; executor threads are not interrupted — do not retry immediately."
- **strat-lab and runbooks** (recon.md:182-187), in the same PR per `docs/patterns/strat-lab-plugin.md`. Files:
  `plugins/strat-lab/skills/backtest/SKILL.md`, `reference/output-handling.md`, `reference/aggregation.md`,
  `plugins/strat-lab/README.md`, and `docs/runbooks/mcp-tools.md` (next to `:412`). Each gets two rows plus the
  prod 60 s-cap fact; this extends @AC-32 @feature-224:
  - `DEADLINE_EXCEEDED`: narrow the range or the symbols, and do not retry immediately.
  - `FAILED_PRECONDITION` `backtest bar series incomplete:`: retrying will not fix it; report it.

### 6. Gate G-1: launch-checklist step in implementation-spec.md

- **When.** After step 3 is on dev, before `launch-ready`.
- **Measure.** Query ledger `QueryEvents` (`packages/proto/ledger/v1/ledger.proto:15`) for
  `analysis.backtest.started` (`:818`) and `analysis.backtest.completed` (`:1346`) on `backtest:<id>` streams.
  Use the trailing 30 days, on dev and prod.
- **Record in context.md:**
  - n, p50, p95, p99 and max for completed runs;
  - per environment, the count of `started` events with no `completed`. This corrects the survivorship bias of
    counting only completed pairs.
- **Threshold.** An operator input. The default is edge-origin-timeout minus 10 s; that is 90 s only if the
  ungrounded Cloudflare ~100 s assumption holds.
- **Pass condition.** Prod p99 is at or below the threshold and the orphan count is trivial. Otherwise the operator
  either raises the prod row through `set_config`/config-ui (no migration), or signs off in context.md quoting the
  numbers.

### 7. C-10 seam with feature 273 (fix-agent-client-deadlines)

- **I-1.** Any agent client deadline on `stub.RunBacktest` (`services/xstockstrat-agent/app/client.py:634`; none
  today) must be either above limit + 15 s, or below the MCP 60 s cap with a distinct message. At prod 120 s only
  the second branch is feasible.
- **I-2.** In `_grpc_error_message` (`services/xstockstrat-agent/app/tools.py:228-231`), when `deadline_s is None`,
  pass through `exc.details()`. This also covers the screener abort. There is no string-prefix coupling.
  - **Feature 273 owns this code** (operator, 2026-10-22).
  - This feature stays analysis-only, so xstockstrat-agent is not added to Affected Services.
  - Merge order is 273 before 272, recorded in both features' context.md.
- **I-3.** The UI BFF `runBacktest` (`insightsBff.ts:41`) must not gain a `timeoutMs` at or below limit + slack.

### Trace rule (operator, 2026-10-21)

- Both aborts use the inbound `context`.
- No new emits are added.
- Existing emits keep `propagation_meta` / `x-trace-id`.
- No background context is minted.

### Build order

1. D-28 guard and tests, plus the full-suite run.
2. `_BarFetchError` re-raise, the wrapper mapping and AC-6.
3. Rename, wrapper, disarm and the `expired()` check, plus AC-3/3b/5, T-commit, T-executor and T-inner-timeout.
4. Docs and consumer rows.
5. G-1.

## Rejected Alternatives

- **Stricter D-28 rule** (option b): raise whenever a token was sent and the page has no fresh bars, whatever the
  response token says. Rejected because it goes beyond product-spec.md:23 ("genuine EOF still returns") and would
  need a spec amendment. Option (a) already catches the real `cursor = start` re-serve, which is always tokened.
- **I-2 as a `details().startswith('backtest exceeded')` prefix match in the agent.** Rejected because it couples
  the agent to analysis's message text. Replaced by the `deadline_s is None` pass-through.
- **Mapping every `TimeoutError` to DEADLINE_EXCEEDED.** Rejected because it would misreport inner `wait_for`
  timeouts. Replaced by the `cm.expired()` check.
- **Retroactive I-2 fallback at step 4** (this feature edits `tools.py` if 273 does not). Rejected because it
  brings back the same-file collision and leaves Affected Services wrong at spec time. The operator settled
  ownership on 273 before spec.
- **A fixed G-1 threshold of 90 s.** Rejected because the Cloudflare ~100 s origin timeout is not grounded in the
  repo. The threshold is now an operator input.
- **G-1 over completed started/completed pairs only.** Rejected because it is biased low. The orphan-`started`
  count is added.
- **Whole-body `asyncio.wait_for` mirroring the screener** (`:3786-3796`). Rejected because a cancellation could
  land between the evidence write (`:1280`) and the completed event (`:1346`), leaving a half-persisted run.
- **Bounding only the compute section** (`:828-1266`) via an extracted helper, or a `_compute_backtest` /
  `_persist_backtest` split. Rejected because too many locals would need threading through, and the large diff in
  the region peers 215/274 edit invites collisions.
- **Skipping the symbol with a CoverageGap instead of failing.** Rejected because it contradicts the spec's "fails
  loudly" and still writes evidence from a fault the run itself detected.
- **UNAVAILABLE for `_BarFetchError`.** Rejected because both causes are deterministic, and the servicer reserves
  UNAVAILABLE for transient store outages (`:684`, `:2536`, `:2566`); a retrying caller would loop.
- **A `SCALAR_BOUNDS_REGISTRY` [0, 3600] bound in xstockstrat-config.** Rejected because it adds config-service
  code scope and cannot catch the real hazard, a positive-but-small value. G-1 covers that.
- **Retiring the key** (OQ-1, config migration 033, recon.md:94-98, :128-130). Rejected; the spec defaults to
  enforce and the debate kept that.
- **Passing the asyncio `Timeout` object into the body.** Rejected in favour of a narrow disarm callable (C-18).

## Open Risks

- [ ] The prod limit of 120 s (`002_config_environment.up.sql:71`) is enforced for the first time, so multi-symbol
  runs that complete today may get DEADLINE_EXCEEDED. Addressed at G-1, the launch-checklist step.
- [ ] `disarm()` at `:1267` is correct only while no awaited state-writing call sits before it. Peers 215/274 edit
  this region; T-commit is the tripwire. Addressed at step 3 and re-checked at each rebase.
- [ ] grpc.aio cancellation semantics are unverified locally (grpc is not installed). If a cancelled `GetBars`
  surfaced as `AioRpcError(CANCELLED)`, `:1127` would swallow it and the run would overrun and persist. Addressed
  at step 3 (AC-3b).
- [ ] Abandoned `run_in_executor` threads (`:1717`, `:2229`, `:2400`) keep their `_compute_executor` slots
  (default 4, `analysis.compute.max_worker_threads`). Rapid retries can delay the screener's sync tail. Addressed
  at step 4 ("do not retry immediately"); a cooperative `threading.Event` cancel is a follow-up only.
- [ ] Until feature 273's I-2 lands, agent users with a limit below 60 s get the generic "retry shortly" message.
  At prod 120 s, agent users never see the server message. Addressed at step 4 (docs) and through merge order
  273 before 272.
- [ ] Behavior change (insights.md:178-190): runs that used to "succeed" with one symbol truncated now fail
  entirely, and a benchmark UNKNOWN becomes FAILED_PRECONDITION. Addressed at step 2 (AC-6) and in the PR body.
- [ ] D-28 can turn existing tests red where `GetBars` mocks return a truthy MagicMock `next_page_token` (about 102
  AsyncMock sites). Addressed at step 1 with the full-suite run.
- [ ] Orphan `analysis.backtest.started` events (`:818`) for timed-out or bars-failed runs become more frequent.
  Addressed at G-1 (orphan count).
- [ ] The rename shifts line references that peers 215/274 cite into `_run_backtest` (the code itself is
  unchanged), which causes rebase churn. Addressed at /sdd-spec by re-greping the anchors.
- [ ] New scenarios @AC-5, @AC-6 and @AC-7 are not yet in `acceptance.feature` (it holds AC-1..4). Add them at
  /sdd-spec, before any step (C-15).
- [ ] The merge-order pin "272 after 273" and the 273 context.md record of I-1..I-3 are outside this feature's
  write scope. Add them through `docs/roadmap/features/merge-order.md` and feature 273's writer before /sdd-spec.

## Constitution Rules Touched

- `C-03` — honored by: the aborts use the inbound context, no fresh background context is minted, and existing
  emits keep `x-trace-id` (operator, 2026-10-21; no waiver).
- `C-08` — honored by: every new behavior has a pinned test (AC-1..7, AC-3b, T-inner-timeout, T-commit,
  T-executor) and the full analysis suite runs at step 1.
- `C-10` — honored by: the I-1..I-3 seam with feature 273, which owns the I-2 code, and merge order 273 before 272.
- `C-11` — honored by: a full-mode debate (2 rounds) and operator approval at the gate before /sdd-spec.
- `C-14` — honored by: the consumer surfaces are named. The UI renders `rawMessage`; the agent pass-through and
  its prod 60 s-cap limit are documented; the strat-lab skill, README and mcp-tools rows change in the same PR.
- `C-15` — honored by: every new guarantee is an `@AC-*` scenario. AC-5..7 are added to acceptance.feature at
  /sdd-spec.
- `C-16` — honored by: § Business Rules Touched below, with operator references for each CHANGE.
- `C-18` — honored by: the deliberate inversion of `test_warmup.py:236-243` is recorded here; the narrow disarm
  callable and the `cm.expired()` check avoid misattributed failures.
- `P-02` — honored by: the proposer and adversary exchanged only mediated synthesized state across both rounds.
- `P-03` — honored by: ungrounded claims (the Cloudflare timeout, grpc.aio cancellation) are kept as operator
  inputs or tripwire tests, not facts.
- `F-01` — honored: no migration. The seeded key is reused with its name, type and values unchanged.
- `F-07` — honored: the 300 fallback is the existing `get_int_present` call-site default pattern, and there is no
  hardcoded limit beyond it.

## Business Rules Touched (C-16)

- CHANGE `@AC-1 @feature-272` "A re-served bar page is a loud failure, not a truncated series" — reverses the
  silent truncation locked in by `test_warmup.py:236-243`. Signed off by operator 2026-10-21 ("Scope is D-28,
  D-29") and by the 2026-10-22 design-gate approval of option (a) (context.md).
- PRESERVE `@AC-2 @feature-272` "Genuine end of data still returns the full series" — not regressed by: an empty
  response token stays EOF. Operator 2026-10-21 scope.
- CHANGE `@AC-3 @feature-272` "RunBacktest enforces the backtest wall-clock limit" — the seeded key becomes live
  for the first time. Signed off by operator 2026-10-21 ("Scope is D-28, D-29") and the 2026-10-22 gate approval
  (context.md).
- EXTEND `@AC-4 @feature-272` "An empty page on a token-bearing request is a loud failure" — already in
  acceptance.feature. Under option (a) it raises because the response re-issues token "t1".
- EXTEND `@AC-5 @feature-272` (new) — a stored 0 means no deadline; a negative value means 300 plus a WARN.
- EXTEND `@AC-6 @feature-272` (new) — `_BarFetchError` gives FAILED_PRECONDITION `backtest bar series
  incomplete:` with no history or cells; includes the benchmark UNKNOWN → FAILED_PRECONDITION change.
- EXTEND `@AC-7 @feature-272` (new) — a sent token followed by an empty page and an empty `next_page_token`
  returns the bars so far as EOF. Introduced by operator 2026-10-22 (design gate r2).
- PRESERVE `@AC-3 @regression @feature-149` "Per-symbol evidence cells and the derived grade are unchanged"
  (`fix-backtest-annualized-return.feature:22`) — not regressed by: a run aborted before `disarm()` writes no
  cells, and a completed run's persistence is unbounded and unchanged.
- PRESERVE `@AC-8 @feature-215` "A fundamentals outage is not reported as absence"
  (`block-fundamentals-strategy-on-etf.feature`) — not regressed by: `_BarFetchError` is a separate abort; the
  fetch-failed "rerun" warning path is untouched.
- PRESERVE `@AC-4 @FR-4 @feature-152` "Insufficient benchmark history names the benchmark in coverage_gaps"
  (`market-regime-benchmark-operand.feature:34`) — not regressed by: `_InsufficientData` handling at `:951-965` is
  unchanged; only `_BarFetchError` maps differently.
- PRESERVE `@AC-9 @FR-3 @feature-151` "The effective fill model is resolved once and round-trips"
  (`backtest-next-bar-fill.feature:64`) — not regressed by: the `default_fill_model` `get_int` read is untouched.
- PRESERVE `@AC-4 @feature-176` "A long backtest does not block another user's read"
  (`analysis-concurrency-offload.feature`) — not regressed by: compute stays in `run_in_executor`.
- PRESERVE `@AC-2 @feature-181` "A data-unavailable readiness row is decorated UNKNOWN"
  (`readiness-caching-poll-discipline.feature`) — not regressed by: `readiness.py:66-71` still maps a fetch error
  to `fetch_ok=False`.
- PRESERVE `@AC-1 @feature-185` and `@AC-5 @feature-185` (`opportunity-compute-robustness.feature`) — not
  regressed by: the opportunity and materializer callers keep their best-effort handlers, so the new error lands
  on the data-unavailable sentinel.
- EXTEND `@AC-32 @FR-12 @feature-224` "Agent docs and strat-lab skill stay in parity with the tool contract"
  (`docs/sdd/business-rules/platform.feature:300`) — new cases: the two failure-mode rows and the prod 60 s-cap
  disclosure in the skill, README and mcp-tools.

## Rounds

- **Round 1 (full).** Shape established: rename plus wrapper, disarm at `:1267`, presence-aware read, no
  migration. Two objections stayed blocking: the prod 120 s evidence gate, and the agent client/server deadline
  ordering.
- **Round 2 (full).** Both round-1 blockers closed: G-1 pinned, and the I-1..I-3 seam given an owner.
  FAILED_PRECONDITION and the ≤ 0 semantics confirmed. Two new blockers came up: the D-28 discriminator, and the
  pre-spec I-2 fallback.
- **Termination: approved.** The operator approved the round-2 synthesis at the gate on 2026-10-22. Picking option
  (a) with AC-7 settled the D-28 blocker. Assigning I-2 to feature 273, with merge order 273 before 272, settled
  the C-10 blocker. No Floor breaches.
