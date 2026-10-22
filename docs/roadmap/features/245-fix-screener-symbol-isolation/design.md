# Design: fix-screener-symbol-isolation

**Created**: 2026-10-21
**Rounds**: 4 (full; termination: auto-approved under operator standing authorization 2026-10-21)
**Approved by**: orchestrator under operator standing authorization @ 2026-10-21 (context.md, "OPERATOR DECISIONS (binding, recorded 2026-10-20)": full mode, rounds >= 2, no Floor breach, no blocking objection, every @AC CHANGE operator-covered; there is no CHANGE)
**Grounded in**: recon.md

---

## Chosen Approach

Item numbering 1-8 is the single numbering carried from the round-3/round-4 syntheses; `/sdd-spec`
must keep it. Paths are relative to the repo root; `screener.py` = `services/xstockstrat-analysis/app/services/screener.py`,
`servicer.py` = `services/xstockstrat-analysis/app/handlers/servicer.py`.

**1. Engine isolation (`screener.py`).**
- Extract the inline row seed (`screener.py:207-216`; recon.md:41-42) into a staticmethod
  `_seed_row(symbol)`. Existing keys unchanged; one key added, `"eval_failed": False`. `_eval_symbol`
  (`:204`; recon.md:41) calls it.
- New `_eval_symbol_isolated(self, symbol, *args)`: `return (await self._eval_symbol(symbol, *args)), None`;
  on `except Exception as e` returns `({**self._seed_row(symbol), "eval_failed": True}, e)`. The
  exception is never stored on the row. Empty `raws` keep the degraded row out of
  `_normalize_universe` (`:409-437`, min-max over rows carrying the raw `:413-417`; recon.md:56-57,
  :178-183), so the other symbols' normalised scores equal a run without BAD (pinned AC-1 oracle).
- The gather (`:115-127`; recon.md:33-34) calls the wrapper. `per_symbol = [row for row, _ in pairs]`;
  local `failures = [(row["symbol"], e) for row, e in pairs if e is not None]`, read only by item 3.
- Unchanged: `CancelledError` (BaseException, Python 3.13) passes through the `except Exception`
  wrapper by construction (recon.md:78-80, :192-195); validation `_validate_fundamental_metrics`
  (`:110`) stays before the fan-out (recon.md:31-32, :196-198); servicer `wait_for` →
  DEADLINE_EXCEEDED (`servicer.py:3786-3795`) and `ValueError` → INVALID_ARGUMENT
  (`servicer.py:3797-3800`) untouched (recon.md:24-28).
- Read the flag by subscript `row["eval_failed"]`, never `.get(..., False)`, so seed drift fails loudly.

**2. Fail-closed result and sort.**
- `_build_result` (`:439`; recon.md:58-62): early branch right after the INSUFFICIENT_DATA return
  (`:440-448`): `if row["eval_failed"]: return ScreenResult(symbol=row["symbol"],
  status=SCREEN_RESULT_STATUS_OK, passed=False, score_unavailable=True)`. Score defaults 0.0, maps
  empty. It cannot reach the default `passed = True` (`:457`), the `bef4258` scar
  (recon.md:90-94, :203-204). Signature unchanged.
- `_rank` (`:149-153`; recon.md:36-38): `pairs = [(self._build_result(row, criteria, request, norm),
  row["eval_failed"]) for row in per_symbol]`; `pairs.sort(key=lambda p: (p[0].score_unavailable,
  p[1], -p[0].score))`; `return [r for r, _ in pairs]`. Extends the existing
  `(score_unavailable, -score)` key (`:152`). The row flag is the single source of truth: `screen()`
  does not dedupe symbols (`list(request.symbols)[:max_universe]`, `:93`), so a failed-symbol set
  would mis-sort a healthy duplicate.
- Nothing is cleared or mutated: both reads run inside `_rank`, after the summary log.
- Degraded rows stay `status OK`, `gap None`, `bars_errored False`, so they stay out of the
  `dataless_bars` summary (`:131-145`) and `coverage_gaps` (`:164-168`) (recon.md:85-89, :199-202).

**3. Logging and span.**
- One `if failures:` block next to the existing summary WARN (`:138-145`; recon.md:35). Message
  `"screener: %d/%d scanned symbols failed evaluation; sample=%s"`, sample
  `[f"{s}:{type(e).__name__}" for s, e in failures][:10]`, `exc_info=failures[0][1]`. Level
  `log.error` when `len(failures) == len(per_symbol)`, else `log.warning`. No per-symbol WARN (the
  `:129-130` no-double-report invariant). Module logger `:37` (recon.md:63-64).
- Same block: `span = trace.get_current_span(); span.set_attribute("screener.degraded_count",
  len(failures)); span.record_exception(failures[0][1])`. No `set_status`. Runs on the loop before
  the executor hop (`:155-160`; recon.md:37-38). With OTel off, INVALID_SPAN makes both no-ops.
- Top-level `from opentelemetry import trace` (opentelemetry-api via opentelemetry-sdk,
  `services/xstockstrat-analysis/pyproject.toml:15`; package-level precedent
  `app/engine/live_loop.py:36`, which imports `metrics`).

**4. Agent consumer surface (C-14/C-10).** recon.md:166-168 records that the agent drops
`score_unavailable` and that `passed=false` is load-bearing.
- Client: forward `"score_unavailable": r.score_unavailable`
  (`services/xstockstrat-agent/app/client.py:760-766`).
- Test: extend `test_screen_symbols_sends_grpc_call` (`services/xstockstrat-agent/tests/test_client.py:217`)
  with a BAD row; add `"score_unavailable": False` to the exact-equality NVDA dict (`:277-283`).
- Docstring (`services/xstockstrat-agent/app/tools.py:833-846`, one edit): add `score_unavailable`
  (bool) to Returns; delete the false sentence "never reported OK/passed just because a criterion had
  no data" (`:845-846`); describe the three `score_unavailable=true` row kinds — (a) evaluation fault:
  status OK, passed=false; (b) data-less hard-filter row: passed=false; (c) data-less soft-only row
  (feature 144): passed=true. `score_unavailable=true` = no comparable score, unranked; with
  passed=false it was not evaluated, not a failed screen. Keep "Filter candidates on `passed`".
  Amend the `min_conviction` / `rank_limit` sentences: un-evaluated rows (score 0.0) are also removed
  by `min_conviction > 0` and may be cut by `rank_limit` (`screener.py:172-181`; recon.md:39-40); the
  server log is then the only trace.
- Runbook `docs/runbooks/mcp-tools.md`: Return JSON (`:449`) gains `score_unavailable`; aside (`:455`)
  same correction; Errors table (`:457-463`) notes a per-symbol fault now yields a degraded row, not a
  failed call; same `min_conviction` caveat.
- Spec: append `@AC-5 @FR-1` (agent row shape); add `xstockstrat-agent` to Affected Services.

**5. Alerting (P-03), option (i) — explicit trade-off, no `alert-rules.yaml` change.**
- (a) The round-2 claim that ERROR "keeps the error-rate signal" is retracted: `xstk-error-rate-high`
  reads `rpc_server_duration_milliseconds_count` (`packages/otel/alerts/alert-rules.yaml:26-45`),
  which feature 250 records as not emitted; no LoggerProvider, no `log_destinations`.
- (b) Today a whole-RPC UNKNOWN pages no one, but in dev it yields an error-status server span; the
  fix turns that span OK. Item 3's `screener.degraded_count` + `record_exception` are its trace-side
  replacement.
- (c) Residual: once feature 250 ships either branch, an all-degraded scan returns OK and stays below
  the error-rate threshold.
- (d) Authority: C-14's "named follow-up feature" clause; named follow-up = feature 250
  (`fix-otel-metrics-logs-gap`).
- Handoff (completion-time write, NOT in 245's worktree): append to feature 250's `context.md` on
  `feature/fix-otel-metrics-logs-gap` (its development branch, 250 `context.md:37`), after reading it
  (C-02). Content: (1) if logs are exported, a log rule on the ERROR line "scanned symbols failed
  evaluation"; (2) if the trace/span-metrics path is used, a TraceQL query or TraceQL-metrics rate on
  `{ span.screener.degraded_count > 0 }`.

**6. UI consumer surface (C-14/C-17).** recon.md:169-173, :188-191 record that `SymbolScreening`
never reads `scoreUnavailable` and that the screener page renders it.
- `SymbolScreening.tsx` (`:63-64`, branch `:234-257`): `unevaluated = result?.scoreUnavailable === true`;
  three-way branch (insufficient / unevaluated / table). Unevaluated renders the shared `EmptyState`
  (`src/components/shared/EmptyState.tsx`, title "Not evaluated") inside a
  `data-testid="symbol-screen-unevaluated"` wrapper (EmptyState's own test id is fixed).
- `insights/screener/page.tsx:256-263`: tooltip copy only; `no-criteria-data` test id kept.
- Spec: add FR-4 and `@AC-4 @FR-4`; Playwright test in `e2e/trader/position-detail.spec.ts` using
  `noCriteriaDataRow` (`e2e/fixtures/screenResults.ts:68-70`); update the `e2e/fixtures/INVENTORY.md:47`
  consumer list (C-12/C-13). Add `xstockstrat-ui` to Affected Services.
- `/insights/screener` needs no logic change: it polls on INSUFFICIENT_DATA only (`page.tsx:122`, `:128`)
  and already renders `scoreUnavailable` (`:184`, `:258`) (recon.md:169-170).

**7. Tests.** Engine tests in `services/xstockstrat-analysis/tests/test_screener.py`, servicer tests
in `tests/test_analysis_servicer.py` `TestScreenSymbols` `:1095` (recon.md:97-112).
- AC-1 outline from the `:572-618` signal-weighted template, RED on today's code via "BAD's row **is**
  present" (recon.md:113-116 fixture discipline: >=2 bars with `.time`, an in-window signal). Asserts:
  the other 49 rows equal the 49-symbol run without BAD; BAD sorts after every other row; Example 2
  ordering (`sig` raw set before the `rsi` raise); Example 3 at `_latest_indicator` (`:284`); the
  summary log names `BAD`.
- FR-2: `test_cancelled_error_in_symbol_eval_propagates` on a 1-2 symbol universe.
- AC-2: new servicer deadline test (hanging GetBars, `get_int` → 1) (recon.md:207-209).
- AC-3: reuse `test_unknown_metric_aborts_invalid_argument` (`:1265`; recon.md:111-112).
- New: `test_degraded_row_soft_only_criteria_is_not_passed` (all soft, `hard_filter=False`, BAD raises;
  `passed is False` and `score_unavailable is True`).
- New: sort-tie test (feature-144 row at exactly 0.0 sorts before BAD; `scoring.py:57-58`).
- New: duplicate-symbol test (same symbol twice, only the first eval raises; the healthy copy ranks
  by its score).
- Seed-key guards that must stay green instead of a bespoke seed-identity test: `test_screener.py:129`,
  `:153`, `:183`, `:215`, `:335`; plus concurrency guards `:625`, `:661` (recon.md:105-106).
- `/sdd-execute` runs both mutations (`except BaseException` in the wrapper; a cancel-swallowing catch
  around `screen()`) and records which tests go red.

**8. Docs, memory, completion obligations.**
- Resolve the Latent-bugs row `services/xstockstrat-analysis/docs/context-constitution-findings.md:20`
  (recon.md:236-237); context-constitution teardown.
- Divergence from feature 185 recorded here: 185's opportunities `_row_for` catches only `RpcError`
  (`servicer.py:5693-5698`); this fix isolates `Exception` for the screener only.
- File defect reports for the sibling unguarded gathers `servicer.py:3983` and `:5776`
  (recon.md:215-217).
- Product-spec / acceptance amendments owed before step planning: AC-1 wording ("is present", pinned
  49-run oracle, summary log), FR-4, AC-4, AC-5, Affected Services + Consumer Surface(s) +
  "no UI change" paragraph.

**Consumer surfaces (C-14):** Agent `screen_symbols` — item 4 (AC-5). UI `/trader/positions/[symbol]`
Screening — item 6 (AC-4). UI `/insights/screener` — copy only (item 6). Alerting — named follow-up
feature 250 (item 5).

## Rejected Alternatives

- `gather(return_exceptions=True)` + isinstance split — needs an explicit CancelledError re-raise and a zip to recover the symbol; the wrapper gets both free.
- Dropping the degraded row — symbol goes silently missing; AC-1 could not assert "is present" and stay red on today's code (P-06).
- New `ScreenResultStatus` (e.g. EVAL_ERROR) — proto change (C-04/C-09) breaking exhaustive UI/agent enum handling; too much for a SEV-2 fix.
- INSUFFICIENT_DATA as degraded status — re-triggers the screener poll and pending badge; pollutes `coverage_gaps` and the `dataless_bars` summary.
- Degraded result via the default `_build_result` path — `passed = True` (`screener.py:457`) would pass a raw-less row.
- Keeping the partial row's raws — shifts the other 49 normalised scores (fails.md:804-822).
- All-failed scan escalated as ValueError — servicer maps it to INVALID_ARGUMENT, mislabelling a code fault.
- Option (b), INTERNAL when every row is degraded — for N=1 contradicts FR-1 "RPC returns OK"; needs an unrecorded P-03 user clarification.
- Option (c), user-signed deferral of the SymbolScreening surface — no operator decision sanctions a C-14 deferral; option (a) is cheap.
- Storing the exception on the row and clearing it to None — clearing before `_rank` re-opens the `passed=True` scar (round-3 blocker); keeping it is YAGNI.
- LogQL alert rule on the ERROR summary line (option ii) — no service exports logs (feature 250); the rule never fires. Handed to 250.
- `opentelemetry.metrics` counter for degraded rows — no MeterProvider under `services/`; a no-op until 250 lands.
- `failed_syms` closure set as sort tie-break — `screen()` does not dedupe (`screener.py:93`); a healthy duplicate mis-sorts; duplicates the row's `eval_failed` fact.
- `row.get("eval_failed", False)` — tolerates hand-built rows but hides seed drift.
- Agent guidance "exclude any `score_unavailable` row whatever `passed` says" — silently reverses feature 144's keep-visible decision (144 `context.md:8`, `:14`); fault rows are already passed=false.
- Keying agent guidance on `score_unavailable` AND passed=false while keeping the "never reported OK/passed" sentence — that sentence is false for feature-144 soft-only rows (fails.md:632).
- Accepting "agent cannot tell a fault from a fail" as a risk — C-14 needs a step or named follow-up for a named consumer surface.
- Relying on score 0.0 to sort degraded rows last — feature-144 rows reach exactly 0.0 (`scoring.py:57-58`).
- Per-symbol WARN plus summary WARN — double-reports, against the `screener.py:129-130` invariant.
- Hand-rolled notice mirroring the insufficient block — C-17 defect (`docs/patterns/ui-ux-governance.md:126-128`); `EmptyState` exists.
- `except BaseException` mutation as AC-2's proof of teeth — CPython 3.13 gather propagates the cancel via `_cancel_requested` even when children swallow it (source read, not run).
- Bespoke before/after seed byte-identity test — not runnable as a single-run test; a key-equality assertion is a change-detector. Existing seed-key tests guard the keys.
- Appending the feature-250 handoff in 245's worktree — 250's SDD skills read `feature/fix-otel-metrics-logs-gap`; invisible until a main-dev merge, and two branches would append to one file.
- Alerting on the span "exception event" — span-metrics generators do not turn exception events into alertable series; TraceQL on `span.screener.degraded_count` named instead.

## Open Risks

- [ ] FR-2/AC-2 teeth rest on a CPython 3.13 gather source read — `/sdd-execute` runs both mutations and records which tests go red (AC-2 / FR-2 test step).
- [ ] After feature 250 ships either branch, an all-degraded scan returns OK below the error-rate threshold — mitigated by the handoff on 250's branch + the span attribute; depends on draft 250 picking it up (completion write; 250 design).
- [ ] `set_attribute`/`record_exception` landing on the GrpcAioInstrumentorServer server span (contextvar copy through `wait_for`) is unverified — `/sdd-spec` adds an in-memory span exporter test (non-gating) (engine step).
- [ ] `min_conviction > 0` / `rank_limit < N` silently remove degraded rows (`screener.py:172-181`); "no symbol goes missing" holds only for unfiltered requests — documented in item 4 (agent docstring + runbook step).
- [ ] `_seed_row` extraction touches every path's seed keys; drift changes `dataless_bars`/`coverage_gaps` for healthy symbols — guarded only by `test_screener.py:129/:153/:183/:215/:335` (engine step).
- [ ] To the agent a fault row and a data-less hard-filter row look identical (OK, passed=false, score_unavailable=true); telling them apart needs the server log — accepted for SEV-2 without a proto change (agent step docs).
- [ ] AC-2 servicer test runs ~1s against a hanging mock; may flake on slow CI (AC-2 test step).
- [ ] AC-4 Playwright `page.route` glob intercepting the `/insights/api` ScreenSymbols call made from `/trader` is unverified (UI step).
- [ ] `EmptyState`'s fixed `data-testid` may collide on the position-detail page — scope the AC-4 selector to the `symbol-screen-unevaluated` wrapper (UI step).
- [ ] Recon keyword-grepped 28 analysis suites only (recon.md:152-153); an existing test asserting UNKNOWN on a symbol exception could flip (engine step: full analysis suite run).
- [ ] "No logs reach Loki" not checked against a live Grafana (feature 250).
- [ ] Sibling unguarded gathers `servicer.py:3983`, `:5776` stay exposed until filed and fixed (docs step: defect reports).
- [ ] Cross-branch write to `feature/fix-otel-metrics-logs-gap` could conflict with concurrent 250 work — read 250's `context.md` immediately before appending (completion write).
- [ ] Product-spec/acceptance amendments (AC-1 wording, FR-4, AC-4, AC-5, Affected Services) not yet applied — owed before `/sdd-spec` plans steps (C-15).

## Constitution Rules Touched

- `C-11` — honored by: 4 full-mode rounds (operator-required full depth), no Floor breach, no blocking objection; gate auto-approved under the standing authorization.
- `C-14` — honored by: agent step (item 4, AC-5) and UI step (item 6, AC-4); feature 250 is the named follow-up for alerting, handoff on 250's own branch.
- `C-10` — honored by: `docs/runbooks/mcp-tools.md` Return JSON (`:449`), aside (`:455`), Errors table (`:457-463`), `min_conviction` caveat, in the same PR.
- `C-15` — honored by: AC-1 reworded with stronger assertions (pinned oracle, "is present"); AC-4, AC-5 appended.
- `C-16` — honored by: feature 160 AC-1/AC-2 and feature 224 AC-29 preserved; feature 144 render change is EXTEND; 144's keep-visible agent decision PRESERVED (no durable @AC).
- `C-17` — honored by: notice on shared `EmptyState` inside a wrapper test id.
- `C-12`/`C-13` — honored by: `noCriteriaDataRow` reused; `INVENTORY.md:47` consumer list updated.
- `C-18` — honored by: `eval_failed` set once, never cleared; summary-only logging with typed samples; no never-firing LogQL rule or counter; no change-detector test.
- `C-01` (DRY) — honored by: seed extracted once (`_seed_row`); sort reads the row's own flag via the zip.
- `C-04`/`C-09` — honored by: no proto change; `ScreenResult.score_unavailable` (field 14, `analysis.proto:529`) reused.
- `C-08`/`P-06` — honored by: AC-1 red first; FR-2 CancelledError, soft-only degraded, sort-tie, duplicate-symbol tests; mutations run during execute.
- `C-02` — honored by: 250's `context.md` read on its own branch before the handoff append.
- `F-07` — honored by: no new config keys; `get_int` reused.
- `F-09` — honored by: design-level contradictions (error-clearing, symbol-uniqueness assumption) resolved in design, not left to the impl-spec.
- `P-03` — honored by: retracted error-rate claim, lost dev span + replacement attribute, TraceQL handoff form all recorded (item 5).
- `P-04`/`P-05` — honored by: full rounds 1-4 `context.md` entry and Status History row written with this design.md.
- `P-02` — honored by: the round-4 synthesis is the only input to this document.

## Business Rules Touched (C-16)

No CHANGE lines, so no operator sign-off is required; the standing authorization (context.md, 2026-10-20) covers the gate.

- PRESERVE `@AC-1 @feature-160` "A signal-weighted screen returns results instead of crashing" (`services/xstockstrat-analysis/acceptance/fix-signal-screen-crash.feature:6`) — not regressed by: the wrapper returns `_eval_symbol`'s row unchanged on success; healthy rows still OK and ranked (recon.md:120-123).
- PRESERVE `@AC-2 @feature-160` "compute_signal_score reads the bar time from the correct proto field" (`fix-signal-screen-crash.feature:14`) — not regressed by: `compute_signal_score` untouched; it is only the AC-1 failure-injection site (recon.md:124-127).
- PRESERVE `@AC-29 @FR-6 @feature-224` "Opportunity provenance and screener signal filter exclude other users' signals" (`private-by-default-templates.feature:42`) — not regressed by: degraded rows carry no signal data (fresh seed, empty raws); `_fetch_signals` scoping unchanged (recon.md:128-131).
- PRESERVE (this feature) `@AC-2` "The scan deadline still cancels the whole scan" — `CancelledError` bypasses `except Exception`; servicer path untouched.
- PRESERVE (this feature) `@AC-3` "An unknown fundamental metric is still rejected for the whole request" — validation stays before the fan-out.
- EXTEND (this feature) `@AC-1` "One symbol's non-RPC failure degrades only that symbol's row" — new assertions: BAD's row is present; other 49 equal the run without BAD; BAD sorts last; summary log names BAD.
- EXTEND (this feature) `@AC-4 @FR-4` (new) — SymbolScreening renders "Not evaluated" for a `scoreUnavailable` row; also changes how feature-144 data-less rows render there (EXTEND of 144, no durable @AC).
- EXTEND (this feature) `@AC-5 @FR-1` (new) — agent `screen_symbols` rows carry `score_unavailable`.
- PRESERVE feature 144 keep-visible decision (144 `context.md:8`, `:14`; no durable @AC) — agent guidance keeps "filter on `passed`".
