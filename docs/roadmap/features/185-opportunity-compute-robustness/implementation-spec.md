# Implementation Spec: opportunity-compute-robustness

**Status**: `pending`
**Created**: 2026-09-07
**Feature**: `docs/roadmap/features/185-opportunity-compute-robustness/feature.md`
**Total Steps**: 15
**Feature Branch**: `feature/opportunity-compute-robustness`

---

## Execution Summary

Apply the feature-181/176 correctness philosophy to the opportunities compute across four services.
The proto contract lands first (Step 1 additive fields + Step 2 codegen) because every other service
consumes the regenerated stubs. The analysis service is the core: FR-1 sentinel (Steps 3/4), FR-3
background-sem isolation (Steps 5/6), FR-4 non-blocking cold read + `computing`/`compute_failed`
(Steps 7/8), and FR-5 surgical read-time recovery + readiness-cache subset heal (Steps 9/10). The two
named consumer surfaces (C-14) follow: agent projection + descriptor-parity (Steps 11/12) and the
`/insights/opportunities` UI render of the unavailable + computing + failed states (Steps 13/14). A
docs step (Step 15) reconciles `mcp-tools.md` with the agent return-shape change.

**No migration** (analysis or config): the `data_unavailable` sentinel rides the existing
`analysis.opportunities` `provenance` JSONB (feature-131 `muted` precedent); FR-3 reuses the existing
`analysis.readiness_materializer.max_concurrent_bars_fetches` sem (no new config key); the FR-4
terminal-failed marker and the FR-5 300s cooldown are in-memory state + a module constant (F-07: code
tuning constants, not WatchConfig values). The two consumer-surface steps are the C-14 fulfillment —
they are not optional finishing touches.

## Scenario Coverage (Constitution C-15)

| Scenario | FR | Covered by step |
|---|---|---|
| @AC-1 (sentinel marked, distinguishable) | FR-1 | Step 4 |
| @AC-2 (evaluated 0/N NOT marked) | FR-1 | Step 4 |
| @AC-3 (UI renders unavailable cue) | FR-2 | Step 14 |
| @AC-4 (background sem does not starve interactive read) | FR-3 | Step 6 |
| @AC-5 (sentinel survives materialization round-trip) | FR-1 | Step 4 |
| @AC-6 (cold read non-blocking, distinct from empty universe) | FR-4 | Step 8 |
| @AC-7 (persistently-failing cold compute → terminal failed) | FR-4 | Step 8 |
| @AC-8 (data-unavailable row self-heals surgically) | FR-5 | Step 10 |
| @AC-9 (recovered watchlist symbol refreshes readiness cache) | FR-5 | Step 10 |
| @AC-10 (agent surfaces data_unavailable + parity test) | FR-6 | Step 12 |

Every `@AC-*` scenario is covered. UI scenario @AC-3 (plus the FR-4 UI states) is verified by a
Playwright e2e step (Step 14), consistent with the frontend having no unit coverage threshold.

## Consumer Surfaces (Constitution C-14)

Both surfaces named in the product spec earn dedicated steps:
- **UI** `/insights/opportunities` → Steps 13 (render) + 14 (e2e test).
- **Agent** `list_opportunities` → Steps 11 (projection) + 12 (descriptor-parity test).

The generalization of the FR-5 surgical-recovery helper to the fundsignal loop is deferred to the
**named follow-up feature 186** (see Out of Scope in `product-spec.md`); 185 wires the helper into
opportunities only.

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto): stubs regenerate from the edited `.proto`.
- Steps 3, 7, 9, 11 (all consumers of the new proto fields) require Step 2.
- Step 4 [test] covers Step 3 [service]; Step 6 [test] covers Step 5; Step 8 [test] covers Step 7;
  Step 10 [test] covers Step 9; Step 12 [test] covers Step 11; Step 14 [test] covers Step 13.
- Step 7 (FR-4 cold read) and Step 9 (FR-5 fresh-read recovery) both edit the `ListOpportunities`
  RPC body (`servicer.py:3354-3395`): implement Step 7 first (cold/empty branch), then Step 9
  (fresh-hit scan + paging tiebreak) so the two branches compose cleanly.
- Step 9 (FR-5) reuses the sem routed in Step 5 (FR-3) — the recovery re-fetch runs on
  `_readiness_materializer_bars_sem`; sequence Step 5 before Step 9.
- Step 13 (UI) requires the response-level `computing`/`compute_failed` flags from Step 7 and the
  `data_unavailable` field from Step 3 (both via the Step 2 stubs; UI path is pure passthrough).
- Step 15 (docs) requires Step 11 (agent return-shape change it documents).

---

### Step 1 — proto: additive data-unavailable + computing/failed fields

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/analysis/v1/analysis.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness per message, no breaking change, `buf lint`/`buf breaking` pass; xstockstrat-analysis owner — opportunity compute semantics; xstockstrat-ui owner — new state rendering; xstockstrat-agent owner — MCP tool return-shape stability

**Codebase Evidence**:
- `Opportunity` message at `packages/proto/analysis/v1/analysis.proto:549`; highest field is
  `optional double signal_confidence = 19;` (`:579`) → **next free = 20**. Confirmed via
  `sed -n '549,580p'`.
- `bool muted = 12;` (`:561`) is the binary-flag precedent (a bool, not an enum — C-04's zero-value
  rule does not apply).
- `message ListOpportunitiesResponse` (`:627`) has exactly `repeated Opportunity opportunities = 1;`
  and `PageResponse page = 2;` → next free response fields = **3 and 4**. Confirmed via `sed`.

**TDD**: `N/A (proto)`

**Covers**: `—`

**Instructions**:
1. In the `Opportunity` message, after `optional double signal_confidence = 19;` (`:579`), add:
   ```proto
   // feature 185 — a per-symbol bars/indicator fetch failure during the compute (terminal
   // data-unavailable), derived at read from the "unavailable" provenance marker (no column).
   // Distinct from an evaluated 0/N row; conviction+signal_axis are zeroed so it sinks in ranking.
   bool data_unavailable = 20;
   ```
2. In `ListOpportunitiesResponse` (`:627`), after `page = 2;`, add:
   ```proto
   // feature 185 — cold (never-materialized) read: empty page returned non-blocking while a
   // background recompute runs. FALSE for a legitimately-empty universe (distinctness proof).
   bool computing = 3;
   // feature 185 — a persistently-failing cold recompute (past the bounded attempt count):
   // renders a terminal error instead of an infinite "computing" spinner.
   bool compute_failed = 4;
   ```

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/opportunity-compute-robustness"
```
Both pass (additive fields are non-breaking). If the feature branch does not yet exist at run time,
`/sdd-execute` runs `buf breaking` against `.git#branch=main-dev` per the proto governance gate.

---

### Step 2 — proto-gen: regenerate all three stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/**` — modify (generated)
- `packages/proto/gen/python/**` — modify (generated)
- `packages/proto/gen/ts/**` — modify (generated; includes compiled `gen/ts/dist/`)

**Reviewers**: Proto Reviewer — field number uniqueness, backward compatibility; xstockstrat-analysis owner; xstockstrat-ui owner; xstockstrat-agent owner (inherited from Step 1)

**Codebase Evidence**:
- `scripts/buf-gen.sh` generates Go/TS via buf and Python via grpcio-tools (`buf-gen.sh:61-66`,
  cited in `recon.md`) and compiles the TS package. Root `CLAUDE.md` § Generating Proto Stubs.

**TDD**: `N/A (proto-gen)`

**Covers**: `—`

**Instructions**:
1. Run `./scripts/buf-gen.sh` from the repo root.
2. Stage every changed file under `packages/proto/gen/` (Go, Python, TS + `gen/ts/dist/`). Do not
   hand-edit generated files.

**Verification**:
```bash
./scripts/buf-gen.sh
git status --porcelain packages/proto/gen/   # expect only the three stub trees changed
```
The `proto-freshness` CI job re-runs `buf-gen.sh` and fails on any uncommitted stub drift.

---

### Step 3 — service (analysis, FR-1): data-unavailable sentinel

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/repositories/opportunities.py` — modify

**Reviewers**: xstockstrat-analysis owner — opportunity compute semantics, sentinel representation, materialized-row meaning, no look-ahead bias

**Codebase Evidence**:
- Primary bars fetch except-site: `_fetch_into` catches `Exception`, logs, `return sym, []`
  (`servicer.py:3837-3843`); benchmark twin `_fetch_benchmark_into` (`:3851-3857`). Confirmed via `sed`.
- `benchmark_syms` is built from `strategy_defs[sid].components[*].source_symbol`
  (`servicer.py:3858-3872`) — so a benchmark failure maps back to candidates by matching a candidate's
  strategy's component `source_symbol`.
- `_row_for` calls `evaluate_conditions_traced` at `servicer.py:3899` (no try/except today); the gather
  over `_row_for` has **no** `return_exceptions` (`:3946`), and `evaluate_conditions_traced` propagates
  `grpc.RpcError` (from `_assemble_component_series` → indicators `GetFormula`, `evaluator.py:364`
  shows the RpcError shape) and separately raises `FormulaExecutionError` for formula bugs
  (`evaluator.py:313/319/328/335`) — so one indicators outage currently aborts the whole compute.
- Row dict built at `servicer.py:3932-3941`: `"conviction": readiness["conviction"]`,
  `"signal_axis": c["signal_axis"]`, `"provenance": c["provenance"]`.
- `_add_provenance(c, origin)` helper defined at `servicer.py:3639`; existing `"denied"` marker stamp
  at `:3786`. Candidate seed carries `"provenance": []` (recon `:3626-3632`).
- `_row_to_opportunity` producer↔reader↔UI contract point at `servicer.py:4568`; `muted` derived at
  read via `muted=("denied" in provenance)` (`:4588`). Confirmed via `sed`.
- Read conviction floor: `opportunities.py:107` — `AND (o.conviction >= $2 OR o.provenance ? 'denied')`.
  A `conviction=0` row vanishes unless its provenance is exempted (fails.md:1547 vanish trap;
  fails.md 2026-08-19 "filter rule must be applied at every layer").
- OR-F parity `_MAPPED` set at `tests/test_analysis_servicer.py:4887` — hand-maintained; a new
  `Opportunity` field must be added or `test_mapper_covers_every_proto_field` (`:4911`) fails.

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
1. **Symbol-level capture.** In `_compute_opportunities`, after Phase-1 primary and benchmark fetch
   loops (`servicer.py:3846`/`:3872`), collect `fetch_failed: set[str]`:
   - In `_fetch_into`'s except (`:3841-3843`) and `_fetch_benchmark_into`'s except (`:3855-3857`),
     record the failed symbol (return a failure flag alongside `sym, []`, or accumulate into a
     `fetch_failed` set in the enclosing scope). Do **not** infer failure from `bars == []` — a
     warm-up-thin symbol legitimately returns `[]` and must stay an evaluated 0/N row (@AC-2).
   - Map each failed **benchmark** symbol to every candidate whose strategy has a component with that
     `source_symbol` (the `strategy_defs[sid].components[*].source_symbol` relation used to build
     `benchmark_syms`), adding those candidate symbols to `fetch_failed`.
2. **Candidate-level capture.** Wrap the `evaluate_conditions_traced` call in `_row_for`
   (`servicer.py:3899`) in `try/except grpc.RpcError` (transport only — **not**
   `FormulaExecutionError`, which is a formula bug, not a data outage; fails.md 2026-08-05 / design
   Rejected Alt 8). On `grpc.RpcError`: add this candidate's symbol to `fetch_failed`, keep the
   `_empty_readiness(sym)` default, and continue building the row (do not re-raise). This is a
   **deliberate abort-contract change** — record it in the `## Deviation Log` at execute time.
3. **Stamp + zero.** After rows are assembled (`servicer.py:3944`), for every candidate whose symbol
   is in `fetch_failed`, stamp `_add_provenance(c, "unavailable")` on the candidate (so it rides the
   `provenance` JSONB, feature-131 precedent). In the row dict build (`:3932-3941`), when the symbol is
   in `fetch_failed`, set `"conviction": 0.0` **and** `"signal_axis": 0.0` so the read
   `ORDER BY ((1-w)·conviction + w·signal_axis) DESC` (`opportunities.py:114`) sinks it out of the
   ranking hot path (@AC-14 PRESERVE).
4. **Derive at read.** In `_row_to_opportunity` (`servicer.py:4588`, beside the `muted` derivation),
   add `data_unavailable=("unavailable" in provenance)`.
5. **Read-floor exemption.** In `opportunities.py:107`, change the floor clause to
   `AND (o.conviction >= $2 OR o.provenance ? 'denied' OR o.provenance ? 'unavailable')` so a
   `conviction=0` unavailable row does not vanish at the DB read (fails.md:1547 — apply at every layer).
6. **Parity set.** Add `"data_unavailable"` to the `_MAPPED` set in
   `tests/test_analysis_servicer.py:4887` (it is a mapper-populated field). (This edit lands with the
   Step 4 test but is listed here because the field is produced by this step's mapper change.)

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
```
Behavioral verification is in the paired Step 4 (coverage + RED assertions).

---

### Step 4 — test (analysis, FR-1): sentinel behavior, round-trip, parity, abort-contract

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify
- `services/xstockstrat-analysis/tests/conftest.py` — modify (only if a shared domain fixture gains a
  second consumer; otherwise inline — see C-13 note below)

**Reviewers**: xstockstrat-analysis owner — strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `TestOpportunityRowParity` at `tests/test_analysis_servicer.py:4882`; `_MAPPED` (`:4887`),
  `_INTENTIONALLY_UNSET` (`:4908`), `test_mapper_covers_every_proto_field` (`:4911`),
  `test_guard_has_teeth` (`:4916`). These already pin `_row_to_opportunity` to the proto descriptor.
- Existing `_row_to_opportunity` unit tests: `tests/test_analysis_servicer.py:4923/4952/5775/5905`
  (row-dict → proto assertions) — templates for the new `data_unavailable` cases.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-5`

**Instructions**:
1. **@AC-1** (marked + distinguishable): a compute where a candidate's primary bars fetch raises →
   its materialized row carries `"unavailable"` in provenance and `_row_to_opportunity` sets
   `data_unavailable=True`; assert a sibling candidate that evaluated 0/N carries neither.
2. **@AC-2** (evaluated-not-passing NOT marked): a candidate with available bars and 0-of-3 passing
   conditions → `data_unavailable=False`, `provenance` has no `"unavailable"`, and it is still an
   evaluated row (`passing_conditions=0, total_conditions=3`). Include a **thin-`[]`** case (a
   legitimate empty-bars return that did NOT raise) asserting it is NOT flagged (design top risk).
3. **@AC-5** (round-trip): write an `"unavailable"`-provenance row via `replace_for_user`, read it
   back via `read(...)` **without** recompute, and assert `_row_to_opportunity` still derives
   `data_unavailable=True` (survives the JSONB persistence round-trip). Also assert the
   read-floor exemption: a `conviction=0` unavailable row is **returned** by `read(...)` under a
   non-zero `min_conviction` (mirrors the existing muted-survives-floor coverage).
4. **Abort-contract RED test**: a compute where the indicators `evaluate_conditions_traced` raises
   `grpc.RpcError` for one candidate → that candidate's row is a sentinel (`data_unavailable=True`)
   **and the other candidates still produce real rows** (the compute no longer aborts wholesale).
   Assert a `FormulaExecutionError` still propagates (NOT swallowed as unavailable).
5. **Parity**: `test_mapper_covers_every_proto_field` now includes `data_unavailable` in `_MAPPED`
   and passes; confirm `test_guard_has_teeth` still fails on a dropped field.
6. **C-13 note**: reuse existing row-dict/definition builders in this test module; a strategy/row
   literal that gains a **second** consumer moves to `tests/conftest.py` in this step, else stays
   inline (state the verdict explicitly).

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check . \
  && pytest tests/test_analysis_servicer.py -k "unavailable or Parity or abort" -q \
  && pytest --cov=app --cov-fail-under=40
```
RED-first: the new assertions fail before Step 3 (no `data_unavailable` field / floor still drops the
row), pass after. Coverage ≥ 40%.

---

### Step 5 — service (analysis, FR-3): route compute fan-out onto the background sem

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/CLAUDE.md` — modify (extend the
  `analysis.readiness_materializer.max_concurrent_bars_fetches` description to note the opportunity
  compute fan-out now also shares it — behavior the doc describes)

**Reviewers**: xstockstrat-analysis owner — semaphore isolation, priority-inversion guard, backtest reproducibility

**Codebase Evidence**:
- `_bars_fetch_sem` built from `analysis.opportunity.max_concurrent_bars_fetches` (default 2) at
  `servicer.py:412`; `_readiness_materializer_bars_sem` built from
  `analysis.readiness_materializer.max_concurrent_bars_fetches` (default 2) at `servicer.py:451`.
- Compute fan-out currently on `_bars_fetch_sem`: `_fetch_into` (`:3838`), `_fetch_benchmark_into`
  (`:3852`), and the cache-warm `_load_benchmark_bars_windowed(... sem=self._bars_fetch_sem)` inside
  `_row_for` (`:3895`).
- Interactive read path stays on `_bars_fetch_sem`: `_enrich_opportunities_live` (`:3444`/`:3458`)
  and `EvaluateReadiness` SLOW (`:2826`) — do **not** touch these.
- Precedent (R-F): the `GetWatchlistReadiness` on-read refresh kick already shares
  `_readiness_materializer_bars_sem` rather than `_bars_fetch_sem` (analysis `CLAUDE.md:137`,
  `:342`) — this feature extends the same background bucket to the compute fan-out. No new config key,
  no migration (design FR-3; avoids the 3×`[1,5]`=15 feature-141 SEV-2 re-open).

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
1. In `_compute_opportunities`, change the three compute-side bars-fetch acquisitions from
   `self._bars_fetch_sem` to `self._readiness_materializer_bars_sem`:
   - `_fetch_into` (`servicer.py:3838`)
   - `_fetch_benchmark_into` (`servicer.py:3852`)
   - the `sem=self._bars_fetch_sem` argument to `_load_benchmark_bars_windowed` in `_row_for`
     (`servicer.py:3895`)
2. Leave `_enrich_opportunities_live` (`:3444`/`:3458`) and `EvaluateReadiness` (`:2826`) on
   `_bars_fetch_sem` — that is the interactive read path this split protects.
3. Update the `analysis.readiness_materializer.max_concurrent_bars_fetches` row in
   `services/xstockstrat-analysis/CLAUDE.md` (line ~342) to state the opportunity compute fan-out
   also runs on this background sem (feature 185).

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check . \
  && grep -n "_readiness_materializer_bars_sem\|_bars_fetch_sem" app/handlers/servicer.py
```
Confirm the three compute-fan-out sites now name `_readiness_materializer_bars_sem` and the two
interactive sites still name `_bars_fetch_sem`. Behavioral verification is in Step 6.

---

### Step 6 — test (analysis, FR-3): background/interactive semaphore isolation

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: xstockstrat-analysis owner — semaphore isolation correctness

**Codebase Evidence**:
- The two sems are distinct `asyncio.Semaphore` instances on the servicer (`servicer.py:412` and
  `:451`) — an isolation test can assert on which instance each path acquires.
- Existing servicer test harness constructs `AnalysisServicer` with injected fakes
  (`tests/test_analysis_servicer.py` fixtures) — the compute path is exercised there today.

**TDD**: `red-green required`

**Covers**: `AC-4`

**Instructions**:
1. Assert the compute fan-out and the interactive read path do **not** contend on the same permits:
   the `_compute_opportunities` bars fetches acquire `_readiness_materializer_bars_sem` while
   `_enrich_opportunities_live` acquires `_bars_fetch_sem`. A structural assertion (patch/count
   acquisitions on each sem instance during a compute vs. during a live enrichment, or assert the
   distinct instances are wired to the distinct call sites) is sufficient — the observable is
   "governed by a semaphore separate from the background compute's" (@AC-4).
2. RED-first: written against the pre-Step-5 tree (compute on `_bars_fetch_sem`) the isolation
   assertion fails; after Step 5 it passes.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check . \
  && pytest tests/test_analysis_servicer.py -k "sem or isolation or starve" -q \
  && pytest --cov=app --cov-fail-under=40
```

---

### Step 7 — service (analysis, FR-4): non-blocking cold read + computing/failed

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: xstockstrat-analysis owner — cold-read semantics, poll-discipline (@AC-4 caching), per-user lock behavior

**Codebase Evidence**:
- `ListOpportunities` cold-vs-empty branch: `if not rows:` (`servicer.py:3354`) →
  `if count_for_user == 0:` (`:3355`) → fresh empty-stamp path kicks + serves empty (`:3362-3367`);
  the `else:` (`:3368-3372`) calls the **synchronous** `_materialize_opportunities` then re-reads.
  The rows-stale `else:` (`:3375-3378`) kicks + serves stale. Confirmed via `sed`.
- Response is built at `servicer.py:3392-3395` (`ListOpportunitiesResponse(opportunities=..., page=...)`).
- `_kick_opportunity_recompute` (`:3523`) is fire-and-forget, guarded by the in-memory
  `_opportunity_recomputing` set (`:471`, `:3526-3528`); its `_run` swallows exceptions in a
  `finally` that discards the guard (`:3535-3538`) — a failure is currently invisible to the RPC.
- `_opportunity_recomputing: set[str]` in-memory state precedent at `servicer.py:471` (a process-local
  guard, reset on restart) — the model for the new failure counter.

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
1. **In-memory failure counter.** In `__init__` (beside `_opportunity_recomputing`, `servicer.py:471`),
   add `self._opportunity_compute_failures: dict[str, int] = {}`. Add a module-level constant
   `_OPPORTUNITY_COMPUTE_MAX_ATTEMPTS = 3` (a code tuning constant, F-07-compliant — mirrors the
   readiness `_READINESS_UNKNOWN_RETRY_SECONDS` code-constant precedent).
2. **Record outcomes in the kick.** In `_kick_opportunity_recompute._run` (`:3532-3538`): on success
   (after `_replace_and_stamp_compute_state` returns), set
   `self._opportunity_compute_failures.pop(user_id, None)`; in the `except`, increment
   `self._opportunity_compute_failures[user_id] = self._opportunity_compute_failures.get(user_id, 0) + 1`.
   Keep the existing swallow-and-log (a recompute failure never takes down the loop).
3. **Non-blocking cold branch.** Replace the synchronous `else:` branch (`:3368-3372`,
   `_materialize_opportunities` + re-read) with: `self._kick_opportunity_recompute(user_id, meta)` and
   leave `rows = []` (fall through to empty pagination). Track a local `computing`/`compute_failed`
   flag for the response:
   - if `self._opportunity_compute_failures.get(user_id, 0) >= _OPPORTUNITY_COMPUTE_MAX_ATTEMPTS`
     → `compute_failed=True`, `computing=False` (still kick so it self-heals when data recovers, but
     report the terminal state — @AC-7);
   - else → `computing=True`, `compute_failed=False`.
4. **Distinctness.** The fresh empty-stamp branch (`:3362-3367`, a legitimately-empty universe) and
   the rows-stale branch (`:3375-3378`) leave `computing=False`/`compute_failed=False` — default-false
   is the proof that empty-universe (empty **without** the flag, preserving @AC-4's
   no-recompute-per-poll) is distinct from cold (empty **with** `computing`).
5. **Response.** Pass `computing=<flag>` and `compute_failed=<flag>` to the
   `ListOpportunitiesResponse(...)` constructor at `:3392-3395`. Non-cold paths pass both false.
6. `_materialize_opportunities` (`:3514`) is now unused by the RPC read path — leave it if another
   caller (e.g. the daily `_refresh_all`) uses it; grep before removing (touch-only-what-the-task-
   requires). If no caller remains, remove it and its double-check comment in this step.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check . \
  && grep -n "_opportunity_compute_failures\|computing\|compute_failed\|_materialize_opportunities" app/handlers/servicer.py
```
Behavioral verification is in Step 8.

---

### Step 8 — test (analysis, FR-4): cold non-blocking, distinctness, terminal-failed

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: xstockstrat-analysis owner — cold-read + poll-discipline correctness

**Codebase Evidence**:
- `ListOpportunities` RPC + cold/empty/stale branch structure at `servicer.py:3354-3395` (Step 7
  evidence). Existing `ListOpportunities` behavioral tests in `tests/test_analysis_servicer.py`
  (cold/stale/empty paths) are the templates.
- `_opportunity_compute_state_repo.get/upsert` (`app/repositories/opportunity_compute_state.py:17/29`)
  — the fresh-empty-stamp mechanism the empty-universe case relies on.

**TDD**: `red-green required`

**Covers**: `AC-6, AC-7`

**Instructions**:
1. **@AC-6** (cold non-blocking): a user with no materialized rows and no fresh empty-stamp →
   `ListOpportunities` returns `opportunities=[]` with `computing=True`, `compute_failed=False`, and
   a background recompute is kicked (assert the kick fired). Assert it did **not** synchronously
   compute (no blocking `_materialize_opportunities` under the lock on the RPC thread).
2. **@AC-6** (distinctness): a user whose universe is legitimately empty (a fresh empty-stamp present)
   → `opportunities=[]` with `computing=False` (and no per-poll recompute — preserves @AC-4).
3. **@AC-7** (terminal failed): with `_opportunity_compute_failures[user]` at/above
   `_OPPORTUNITY_COMPUTE_MAX_ATTEMPTS`, a cold read returns `compute_failed=True`, `computing=False`
   (not `computing` forever). Assert the success path resets the counter (a subsequent successful
   recompute clears the failed flag).
4. RED-first: pre-Step-7, the response has no `computing`/`compute_failed` and the cold path blocks —
   these assertions fail; post-Step-7 they pass.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check . \
  && pytest tests/test_analysis_servicer.py -k "cold or computing or failed or empty_universe" -q \
  && pytest --cov=app --cov-fail-under=40
```

---

### Step 9 — service (analysis, FR-5): surgical read-time recovery + readiness-cache subset heal

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/repositories/opportunities.py` — modify

**Reviewers**: xstockstrat-analysis owner — surgical partial-replace correctness (no resurrection), paging stability, signal-axis honesty (P-03), readiness-cache success-only invariant

**Codebase Evidence**:
- Fresh read returns `provenance` + `computed_at` per row (`opportunities.py:97-99` SELECT; `read()`
  → `_to_dict`) — the scan inputs are already present.
- `replace_for_user` is a whole-user DELETE+INSERT (`opportunities.py:41-75`); the whole-user-replace
  authoritative-drop invariant is documented at `:43-46`. FR-5 needs a **new heal-only** method that
  never INSERTs a missing key (no resurrection).
- ORDER BY at `opportunities.py:114` is
  `((1-$3)*conviction + $3*signal_axis) DESC, conviction DESC` — no unique tiebreak, so a partial
  UPDATE that reshuffles physical order can dup/skip under offset paging (`servicer.py:3380-3387`).
- Recovery primitives to reuse: `_fetch_bars_paged` (`servicer.py:1067`),
  `_load_strategy_definition` (`:3952`), `evaluate_conditions_traced` (`evaluator.py:202`),
  `_load_benchmark_bars_windowed` (`:1430`), `_drain_active_signals` (`:4258`),
  `_resolve_action_tag` (`:4533`), `_opportunity_key` (`:4526`).
- Readiness-cache subset heal: `compute_readiness_row(... fetch_bars=self._fetch_bars_paged,
  bars_sem=self._readiness_materializer_bars_sem, rule="entry", ...)` staging pattern at
  `servicer.py:4131-4158`, then `self._readiness_cache_repo.upsert_many(staged_rows)` (`:4161`,
  also used `:2871`/`:3092`) — reuse this to upsert the recovered `(symbol, strategy, entry)` subset,
  **success-only** (a still-down symbol is not staged).
- Guard precedent: `_opportunity_recomputing` set + `_opportunity_lock` (`servicer.py:471`/`:3484`).

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
1. **New module constant** `_OPPORTUNITY_UNAVAILABLE_RETRY_SECONDS = 300` (mirrors
   `_READINESS_UNKNOWN_RETRY_SECONDS`; a code tuning constant, F-07-compliant).
2. **New dedup state**: in `__init__`, `self._opportunity_retrying: set[str] = set()`.
3. **New repo method** `replace_symbols(self, user_id, symbols, rows)` in `opportunities.py` —
   **UPDATE-in-place, heal-only**: for each row (keyed by `opportunity_key`), UPDATE `conviction`,
   `readiness_json`, `signal_axis`, `provenance`, `thesis`, `valid_until`, and `computed_at = now()`
   WHERE `user_id = $1 AND opportunity_key = $k`. It MUST NOT INSERT — a `(symbol, strategy)` key not
   already present is silently skipped (no resurrection; the whole-user-replace invariant is honored
   to the degree a partial refresh can — a universe-membership change reconciles at the next daily
   full compute). Wrap in one transaction. Also **re-stamp `computed_at` for the scanned symbols'
   still-present rows even when re-eval still yields unavailable** (so the 300s cooldown holds).
4. **New helper** `_kick_opportunity_retry(self, user_id, symbols, propagation_meta)` — a generic,
   reusable fire-and-forget (built for later fundsignal adoption, feature 186; wired only into
   opportunities here):
   - take `_opportunity_lock(user_id)`; **skip if `user_id in self._opportunity_recomputing`** (a
     full recompute already heals);
   - dedup via `self._opportunity_retrying` — add `user_id` on entry, **clear in a `finally`** (no
     stuck flag);
   - re-fetch bars for **only** `symbols` on `self._readiness_materializer_bars_sem` (bounded
     per-symbol footprint — NOT a full-universe recompute; design Rejected Alt 3);
   - re-trace via `_load_strategy_definition` + `evaluate_conditions_traced` +
     `_load_benchmark_bars_windowed`, and **re-drain active signals** (`_drain_active_signals`) so a
     healed row restores **both** `conviction` and `signal_axis` (never a dishonest zeroed axis, P-03);
   - build heal rows keyed by `_opportunity_key(user_id, sym, strat)` and call
     `replace_symbols(user_id, symbols, rows)`;
   - for each **successfully** re-evaluated `(symbol, strategy)` that is a watchlist×strategy entry
     subset, stage a readiness row via `compute_readiness_row(... rule="entry" ...)` and
     `_readiness_cache_repo.upsert_many(staged)` — **success-only** (a still-down symbol is not
     staged; @AC-9);
   - **never** call `_replace_and_stamp_compute_state` (the empty-only stamp / @AC-4 stays untouched).
5. **Fresh-hit scan.** In `ListOpportunities`, on the **fresh** read path only (the branch that
   served real rows — NOT the cold/empty/stale branches at `:3355-3378`), after `rows` are read,
   compute the stale-unavailable set
   `{r["symbol"] for r in rows if "unavailable" in r["provenance"] and (now - r["computed_at"]).total_seconds() > _OPPORTUNITY_UNAVAILABLE_RETRY_SECONDS}`.
   If non-empty and `user_id not in self._opportunity_retrying`, fire
   `_kick_opportunity_retry(user_id, symbols, meta)` (fire-and-forget). Do **not** run the scan on the
   stale-served set (the stale branch already fires a full recompute — avoids double work + lock
   contention).
6. **Paging tiebreak.** Add `, o.opportunity_key ASC` as the final term of the ORDER BY at
   `opportunities.py:114` (a pure tiebreak — all unavailable rows tie at `conviction=0, signal_axis=0`;
   without it the partial UPDATE can dup/skip a row across polls). It does not reorder non-tied rows
   (no @AC-14 ranking change).

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check . \
  && grep -n "replace_symbols\|_kick_opportunity_retry\|_opportunity_retrying\|_OPPORTUNITY_UNAVAILABLE_RETRY_SECONDS\|opportunity_key ASC" app/handlers/servicer.py app/repositories/opportunities.py
```
Behavioral verification is in Step 10.

---

### Step 10 — test (analysis, FR-5): heal-in-place, no-resurrection, paging, readiness-cache subset

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify
- `services/xstockstrat-analysis/tests/test_opportunities_repo.py` — modify or create (for
  `replace_symbols` unit coverage; create only if no analysis repo test module exists — confirm via
  `ls services/xstockstrat-analysis/tests/`)

**Reviewers**: xstockstrat-analysis owner — partial-replace correctness, paging determinism, readiness-cache success-only

**Codebase Evidence**:
- `replace_for_user`/`read` behavior in `opportunities.py:41-125` (the invariants the new
  `replace_symbols` must NOT violate). Existing readiness-cache upsert semantics
  (`_readiness_cache_repo.upsert_many`, `servicer.py:4161`) for the @AC-9 assertion.

**TDD**: `red-green required`

**Covers**: `AC-8, AC-9`

**Instructions**:
1. **@AC-8** (self-heal surgical): a served `data_unavailable` row older than 300s + recovered market
   data → the scan fires `_kick_opportunity_retry` for **only** that symbol (assert the full compute
   was NOT run), the row heals in place with **both** `conviction` and `signal_axis` restored
   (signal_axis re-drained, not left 0), and a **still-unavailable** symbol has its `computed_at`
   re-stamped so it does not re-kick before the next 300s.
2. **No-resurrection**: `replace_symbols` given a row whose `opportunity_key` is absent from the table
   does NOT INSERT it (a symbol dropped from the universe stays dropped until the daily full compute).
3. **Thin-`[]`-not-flagged** (guards the FR-1 boundary from the recovery side): a symbol that returns
   `[]` without a fetch error is not treated as unavailable and is not scanned for retry.
4. **Paging-stable**: with several rows tied at `conviction=0, signal_axis=0`, offset pagination
   across two polls returns each row exactly once (the `opportunity_key ASC` tiebreak holds order
   through a partial UPDATE).
5. **Dedup**: `_opportunity_retrying` is cleared in the `finally` (no stuck flag after a raising
   retry); a concurrent fresh read while a retry is in flight does not stack a second kick.
6. **@AC-9** (readiness-cache subset): a recovered symbol that participates in a watchlist×strategy
   entry-rule readiness → the fresh `(symbol, strategy, entry)` rows are upserted to
   `analysis.readiness_cache`; a symbol whose re-fetch **still fails** is NOT written (success-only).
7. RED-first: pre-Step-9 there is no `replace_symbols`/scan — these fail; post-Step-9 they pass.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check . \
  && pytest tests/ -k "replace_symbols or retry or heal or resurrect or paging or readiness_cache_subset" -q \
  && pytest --cov=app --cov-fail-under=40
```

---

### Step 11 — service (agent, FR-6): project data_unavailable + computing/failed

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability (return shape), `mcp-tools.md` parity, no secret values in output

**Codebase Evidence**:
- `_opportunity_to_dict` hand-projection at `client.py:747-789`: projects `symbol/action/conviction/
  passing_conditions/total_conditions/thesis/strategy_id/source/opportunity_key/provenance/muted`
  and the presence-gated live fields — but **omits** `valid_until` (field 9) and `signal_confidence`
  (field 19). `muted` is a plain bool key (`:765`).
- `list_opportunities` wrapper at `client.py:792-805` returns
  `{"opportunities": [_opportunity_to_dict(o, ...) for o in resp.opportunities]}` — it does NOT
  surface response-level `computing`/`compute_failed` today.
- Tool at `tools.py:1160-1176`; docstring `:1161-1169` documents the return shape.
- Agent is a **one-shot, non-polling** consumer (design FR-6 / Open Risks) — a cold/failed queue must
  surface `computing`/`compute_failed` in the tool result, not appear as a silently-empty list.

**TDD**: `red-green required`

**Covers**: `—`

**Instructions**:
1. In `_opportunity_to_dict` (`client.py:747`), add `"data_unavailable": o.data_unavailable` to the
   base dict `d`. Back-fill the two drifted fields so the new parity test (Step 12) passes with no
   silent allow-list: add `"signal_confidence"` (presence-gated: `if o.HasField("signal_confidence")`)
   and `"valid_until"` (project the `google.protobuf.Timestamp` — e.g. ISO string via
   `o.valid_until.ToDatetime().isoformat()` when `o.HasField("valid_until")`, matching the
   omit-not-fabricate contract for an unset timestamp).
2. In `list_opportunities` (`client.py:792`), carry the response-level flags:
   return `{"opportunities": [...], "computing": resp.computing, "compute_failed": resp.compute_failed}`.
3. Update the `list_opportunities` tool docstring (`tools.py:1161-1169`) to document the new
   `data_unavailable` per-row flag and the top-level `computing`/`compute_failed` states (a cold or
   persistently-failed queue is reported explicitly, not as an empty list).

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check .
```
Behavioral + parity verification is in Step 12.

---

### Step 12 — test (agent, FR-6): Opportunity descriptor-parity + projection

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_opportunity_projection.py` — create
- `services/xstockstrat-agent/tests/test_client.py` — modify (behavioral projection assertions)

**Reviewers**: xstockstrat-agent owner — projection parity (no silent field drift)

**Codebase Evidence**:
- No `Opportunity` descriptor-parity test exists today — the projection already silently omits
  `valid_until`/`signal_confidence` (recon; fails.md 2026-08-02 RC-1, fails.md insights "a new proto
  field on a shared message breaks the agent's descriptor-parity projection test").
- Parity templates: `services/xstockstrat-agent/tests/test_backtest_view.py:189`
  (`test_summary_key_set_covers_every_proto_field` — `set(kept) | set(dropped) == set(DESCRIPTOR.
  fields_by_name)`); behavioral projection test `tests/test_client.py:1084`.
- In-function proto import per AGENT-2 (`test_backtest_view.py:200` — `from gen.analysis.v1 import
  analysis_pb2` inside the test, module stays pure).

**TDD**: `red-green required`

**Covers**: `AC-10`

**Instructions**:
1. Add `test_opportunity_projection.py` with a descriptor-parity test mirroring
   `test_backtest_view.py:189`: build the set of keys `_opportunity_to_dict` can emit (the base keys +
   the presence-gated live/`signal_confidence`/`valid_until` set + `data_unavailable`) and assert
   `emitted | intentionally_unset == set(analysis_pb2.Opportunity.DESCRIPTOR.fields_by_name)`. Include
   a "guard has teeth" assertion (dropping a key breaks equality). With the Step 11 back-fill there is
   **no silent allow-list** — every proto field is either projected or explicitly justified.
2. **@AC-10** behavioral: given a `resp.opportunities[i]` with `data_unavailable=True`, the projected
   dict carries `data_unavailable: True`; given `resp.computing=True`/`resp.compute_failed=True`, the
   `list_opportunities` result carries those top-level keys.
3. RED-first: pre-Step-11 the parity test fails (fields omitted, no `data_unavailable`); post-Step-11
   it passes.

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check . \
  && pytest tests/test_opportunity_projection.py tests/test_client.py -k "opportunity or projection or parity" -q \
  && pytest --cov=app --cov-fail-under=40
```

---

### Step 13 — service (UI, FR-2 + FR-4): render unavailable + computing/failed states

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/opportunities/page.tsx` — modify

**Reviewers**: xstockstrat-ui owner — analytics display accuracy, C-17 primitives, no hardcoded colors, accessible name for the new state cue

**Codebase Evidence**:
- The `0/0` "quiet" fallback to conditionally replace: `no conditions` at
  `page.tsx:509-510` (inside `OpportunityRow`, gated by `const hasReadiness = o.totalConditions > 0`
  at `:456`).
- Canonical C-17 unavailable cell to mirror: `WatchlistReadiness.tsx:320-328` renders
  `ReadinessState.UNKNOWN` as `TriangleAlert` + `QueryStateMessages error errorText="unavailable"`
  with `role="status"` and `data-testid="readiness-unknown-<symbol>"`.
- `muted` renders as an inline `<Badge variant="outline">` (`page.tsx:465`) — the bool→inline-render
  precedent (a bool does not get an `opportunityShared.tsx` enum-map entry).
- Cold/empty render branches: `rows.length === 0 → <EmptyState .../>` in both the mobile
  (`page.tsx:339-344`) and desktop (`:358-363`) blocks; loading via `Skeleton`; load `error` via a
  `text-sell` line. The hook `useOpportunities` already polls every 15s (`useOpportunities.ts:20`,
  `refetchInterval: 15_000`) and returns the whole response as `data` (`page.tsx:98`).
- BFF + browser client are pure passthrough (`insightsBff.ts:55` `forward(... listOpportunities ...)`;
  `browserClients/analysisClient.ts:6` generic typed client) — the new proto fields
  (`o.dataUnavailable`, `data.computing`, `data.computeFailed`) surface automatically, camelCase.

**TDD**: `red-green required` (verified via the Step 14 Playwright e2e)

**Covers**: `—`

**Instructions**:
1. **FR-2 unavailable row** (`OpportunityRow`, `page.tsx:509-510`): when `o.dataUnavailable` is true,
   render the C-17 unavailable cue mirroring `WatchlistReadiness.tsx:320-328` — a `TriangleAlert` +
   `QueryStateMessages error errorText="unavailable"` in a `role="status"` span with
   `data-testid={`opportunity-unavailable-${o.symbol}`}`, using role tokens (`text-destructive`),
   **instead of** the readiness bar / `no conditions` line. A genuinely-evaluated `0/0` row
   (`!o.dataUnavailable`) keeps the existing `no conditions` "quiet" render — do not reclassify it
   (@AC-2 / C-16 EXTEND: icon **and** text, never a silent "quiet" reclass). Mirror the change into
   the mobile `signalGroup` mapping (`page.tsx:203-219`) if the mobile row renders readiness.
2. **FR-4 cold/failed states**: in both `rows.length === 0` branches (`:339-344` and `:358-363`),
   branch before `EmptyState`:
   - `data?.computeFailed` → an error state via the canonical primitive (a `QueryStateMessages error`
     line or `EmptyState` with an error-tone title, e.g. "Couldn't compute opportunities");
   - else `data?.computing` → a "computing" state (a `Skeleton`/loading-tone `EmptyState`, e.g.
     "Computing your opportunities…") — the 15s poll (already configured) resolves it;
   - else the existing `EmptyState title="No opportunities match the filter"` (legitimately empty).
3. Use only design-role tokens and existing `ui/*` primitives (`QueryStateMessages`, `EmptyState`,
   `Skeleton`, `Badge`) — no hardcoded colors, no near-duplicate primitive (C-17).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
```
Behavioral verification (renders) is in Step 14.

---

### Step 14 — test (UI): e2e for unavailable + computing/failed states

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/opportunities.spec.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/opportunities.ts` — modify (add a `dataUnavailable` row)
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify (catalog the new fixture facet)
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (mock predicate + computing/failed shape)

**Reviewers**: xstockstrat-ui owner — e2e coverage, fixture inventory (C-12)

**Codebase Evidence**:
- `OPPORTUNITIES` fixture at `e2e/fixtures/opportunities.ts:54` (rows carry `conviction`,
  `passingConditions`, `muted`, `provenance`, `opportunityKey`); INVENTORY row for the queue at
  `e2e/fixtures/INVENTORY.md` ("Opportunity queue").
- Mock handler `listOpportunities` at `mock-backend.ts:791-799` filters
  `OPPORTUNITIES.filter((o) => o.muted || o.conviction >= min)` — the every-layer filter exemption
  (fails.md:1547): the mock predicate must also pass a `conviction=0` unavailable row
  (`|| o.dataUnavailable`), and must be able to return `computing`/`computeFailed`.
- Spec `e2e/insights/opportunities.spec.ts`: `toJson` (`:22`), per-page stateful `page.route` mock
  (`:28-45`), muted-survives-floor test (`:102`) — the templates for the new cases.

**TDD**: `red-green required`

**Covers**: `AC-3`

**Instructions**:
1. **Fixture (C-12)**: add one `dataUnavailable: true` row to `OPPORTUNITIES` (a `conviction: 0`,
   `provenance` including `"unavailable"` row — mirrors the GME muted-0 placeholder at
   `opportunities.ts:123-136`). Update `INVENTORY.md`'s Opportunity-queue row to note the
   `dataUnavailable` facet (feature 185). Reuse the existing fixture module — no inline literal.
2. **Mock**: in `mock-backend.ts:791-799`, extend the filter predicate to
   `o.muted || o.dataUnavailable || o.conviction >= min`. Ensure the response can carry
   `computing`/`computeFailed` (add optional fields to the returned object, defaulting false); the
   per-page `page.route` mock in the spec can override them per test.
3. **@AC-3** (unavailable render): assert the queue renders
   `opportunity-unavailable-<symbol>` (`TriangleAlert` + "unavailable" text) for the
   `dataUnavailable` row, and that it is **not** rendered as a `no conditions` "quiet" line.
4. **FR-4 UI states** (verifying Step 13; also covers @AC-6/@AC-7 at the UI layer): with a per-page
   `page.route` returning `{opportunities: [], computing: true}` → the "computing" state renders (not
   the plain empty state); `{opportunities: [], computeFailed: true}` → the error state renders;
   `{opportunities: []}` → the existing "No opportunities match the filter" empty state.
5. RED-first: the new `opportunity-unavailable-*` / computing / failed selectors do not exist
   pre-Step-13.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint \
  && grep -n "from '../fixtures'\|from './fixtures'\|helpers/auth" e2e/insights/opportunities.spec.ts \
  && pnpm test:e2e -- opportunities
```
`xstockstrat-ui` has no unit coverage threshold — e2e is the coverage gate. Confirm the fixture
imports come from `e2e/fixtures/` and `INVENTORY.md` was updated (C-12).

---

### Step 15 — docs: reconcile mcp-tools.md with the agent return shape

**Status**: `pending`
**Service**: `docs/runbooks`
**Files**:
- `docs/runbooks/mcp-tools.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `list_opportunities` is documented at `docs/runbooks/mcp-tools.md:848`. The reviewer registry pins
  the agent owner to "`docs/runbooks/mcp-tools.md` parity" — a return-shape change must update it.
- This feature does **not** touch any `strat-lab` plugin API (`run_backtest`, `manage_strategy`,
  `trigger_backfill`/`get_backfill_status`, `set_strategy_live` per root `CLAUDE.md`) —
  `list_opportunities` is not in the `strat-lab` `backtest` skill's surface, so no plugin update is
  owed.

**TDD**: `N/A (docs)`

**Covers**: `—`

**Instructions**:
1. Update the `list_opportunities` return-shape documentation (`mcp-tools.md:848`+) to add the
   per-row `data_unavailable` flag and the top-level `computing`/`compute_failed` states, and note
   that a cold or persistently-failed queue is reported explicitly (not as an empty list).

**Verification**:
```bash
grep -n "data_unavailable\|computing\|compute_failed" docs/runbooks/mcp-tools.md
```
Confirm the new fields are documented under `list_opportunities`.

---

## Deviation Log

- **Step 13 (client-side floor exemption — every-layer):** the impl-spec named the OpportunityRow
  render + the two empty branches, but the page's own `rows` useMemo re-filters by the min-conviction
  slider and exempted only `muted`. A data-unavailable row (conviction 0) would vanish when the user
  raised the slider — the same "filter at every layer" trap the backend read floor avoids
  (fails.md:1547). Added `|| o.dataUnavailable` to that client filter so the sentinel survives the
  slider, mirroring the backend/mock exemptions.
- **Step 13 (mobile companion cue threaded):** the impl-spec's "mirror into the mobile signalGroup
  mapping if the mobile row renders readiness" — it does, so `SignalItem` gained `dataUnavailable`,
  the page's `mobileSections` maps it, and `SectionRenderer`'s `SignalRow` renders an explicit
  unavailable cue (using this file's phosphor `Warning` icon for consistency, not lucide) in the
  readiness slot instead of a 0/0 meter (`data-testid=opportunity-unavailable-mobile-<sym>`).
- **Step 13 (pre-existing tsc error, NOT introduced):** `npx tsc --noEmit` reports one error in
  `src/middleware.test.ts` (a vitest `MockInstance` typing incompatibility) that exists on
  `origin/main-dev` and is unrelated to this feature — left untouched (touch-only-what-the-task-
  requires). The Step-13/14 gate (`pnpm run lint` + `pnpm test:e2e`) is clean; my touched files
  carry zero tsc errors.
- **Step 14 (e2e ran under the CI-parity path):** `buf` and a pinned Playwright build are absent, so
  the e2e ran with `CI=1` (prod `pnpm build && pnpm start`) + the Chromium-1194 fallback
  (`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`), the same deviation feature 184 recorded. All 6 new
  feature-185 e2e tests pass (unavailable cue desktop + mobile, floor survival, computing, terminal
  failed, empty-universe distinctness); the full UI e2e suite is green (439 passed).
- **Step 9 (`replace_symbols(user_id, rows)` — dropped the spec's `symbols` param):** the impl-spec
  signature was `replace_symbols(user_id, symbols, rows)`, but `symbols` is redundant — each heal row
  is keyed by `opportunity_key` (which encodes the symbol) and the WHERE matches on it. Two-arg
  signature; no functional change.
- **Step 9 (`_signal_decay` extracted — DRY):** the decay + source-weight arithmetic was inline in the
  compute loop and is also needed by the recovery to restore `signal_axis` (@AC-8). Extracted to a
  module-level `_signal_decay(...)` used by BOTH sites (jscpd/dry-reviewer would flag a duplicate);
  the compute keeps its aggregated missing-`ingested_at` count + per-signal debug log around the call.
  Behavior-preserving (full suite stayed green).
- **Step 9 (recovery uses the strategy ROW, not just the definition):** the @AC-9 readiness-cache heal
  needs `_definition_fingerprint(row["definition_json"])`, so the recovery fetches the owner-scoped
  row via `get_by_owner_and_id` (same active + live_enabled gate), caches per distinct strategy, and
  derives both the definition and fingerprint from it.
- **Step 9 (@AC-9 readiness heal re-fetches via `compute_readiness_row`):** that helper does its own
  bounded per-symbol fetch, so a healed watchlist-entry symbol is fetched again for its readiness row.
  Accepted — the design mandates reusing `compute_readiness_row` + `upsert_many`; footprint stays
  per-symbol bounded. Success-only enforced by staging only rows with returned `bar_epoch >= 0`.
- **Step 9 (`FormulaExecutionError` propagates from the recovery, mirrors Step 3):** the eval is a
  `try/except grpc.RpcError` (transport → still-unavailable) inside an `else` after a separate
  bars-fetch `try/except Exception`; a `FormulaExecutionError` is caught by neither and propagates to
  `_kick_opportunity_retry._run`'s guard (logged, retry aborts) — a formula bug is not a data outage.
- **Step 9 (line drift):** the compute is now at `servicer.py:3582` (post Steps 3/5/7), not `3542`;
  all cited symbols resolved. Full suite after Step 9: 719 passed, 82.06% coverage.
- **Step 10 (test topology):** the FR-5 behavior tests drive `_retry_unavailable_symbols` and the
  ListOpportunities fresh-read scan directly (like Step 4 drove `_compute_opportunities`), using an
  extended `_FakeOppRepo` (new `replace_symbols` mirroring the real heal-only/no-INSERT semantics +
  the `opportunity_key` ASC tiebreak in `read`) and a new `_FakeReadinessCache`. `test_opportunities_
  repo.py` was created (no such module existed) for the real `replace_symbols` SQL/bind assertions
  via an AsyncMock pool (the sibling repo-test pattern — no real DB). @AC-8 (heal both axes in place,
  surgical not full-compute), @AC-8 still-down-re-stamped, no-resurrection (fake + real SQL),
  paging-stable (offset paging over tied 0/0 rows), dedup (guard cleared in finally; skipped under a
  full recompute), @AC-9 (readiness-cache subset upsert, success-only). RED proven by reverting the
  Step-9 source to `97d8cda` (9 failed — recovery methods + real `replace_symbols` absent). Full
  suite after Step 10: 730 passed, 84.01% coverage.
- **Step 1 (proto verification):** `buf` is not on the host, so Step-1 `buf lint`/`buf breaking`
  and Step-2 codegen were run via the pinned `Dockerfile.codegen` image
  (`docker run … ./scripts/buf-gen.sh`, which runs lint + breaking-against-`main-dev` + generate in
  one pass) rather than a bare-host `buf`. This is the CI-parity path (`proto-freshness` re-runs the
  same script). Both gates passed; additive fields are non-breaking.
- **Step 3 (abort-contract change, design-sanctioned):** `_row_for` now wraps
  `evaluate_conditions_traced` in `try/except grpc.RpcError`. Previously an indicators transport
  outage propagated out of the `asyncio.gather` (no `return_exceptions`) and aborted the *entire*
  compute; now it marks only that candidate data-unavailable and the compute completes. This is the
  deliberate abort-contract deviation called out in the design (Rejected Alt 8). `FormulaExecutionError`
  (a formula bug, not a data outage) is intentionally left to propagate.
- **Step 3 (impl-spec evidence line drift):** the impl-spec cited `evaluator.py:364` as "the RpcError
  shape"; that line is inside `declared_formula_warmups` (an unrelated helper that catches RpcError).
  The load-bearing fact is unchanged and confirmed: the main eval path
  (`_assemble_component_series` → `ExecuteFormula`/`ComputeIndicator`/`GetFormula`, `evaluator.py:303`+)
  *propagates* `grpc.RpcError` — it is caught only in the new `_row_for` guard.
- **Step 3 (stamp/zero placement, equivalent to spec intent):** the impl-spec described a post-assembly
  pass (":3944") to stamp `unavailable` + zero the axes. Implemented instead at the row-dict build
  inside `_row_for` (single pass): `provenance` is a shared list reference and `conviction`/`signal_axis`
  are by-value, so a build-time `sym in fetch_failed` check is equivalent and avoids a second loop.
  The check is guarded by `evaluated` (a muted-non-held candidate never evaluates, so it is never
  spuriously marked unavailable even if it shares a symbol with a failed eligible candidate).
- **Step 3 (`_MAPPED` parity-set edit landed here, not with Step 4):** the impl-spec allowed the
  `_MAPPED` addition to land with Step 4; it was landed with Step 3 instead so the OR-F parity test
  (`test_mapper_covers_every_proto_field`, RED since Step 2 added the proto field) returns green in the
  same commit as the mapper change that populates it. Step 4 adds only behavioral tests.
- **Step 4 (tests drive `_compute_opportunities` directly, not the cold `ListOpportunities` path):**
  the FR-1 sentinel is a compute-path concern, so the new `TestOpportunityDataUnavailable` tests call
  `svc._compute_opportunities("u1", meta)` + `_row_to_opportunity` + `_FakeOppRepo` directly rather
  than driving the compute through a cold `_list_opps`. This is deliberate: **Step 7 (FR-4) makes the
  cold `ListOpportunities` read non-blocking** (kick + empty, no synchronous compute), so any Step-4
  test coupled to the cold path would break at Step 7. RED-first proof was captured by reverting the
  Step-3 source to `8a32213` and re-running (AC-1 marking, AC-5 floor+round-trip, and the
  abort-contract test all failed — the abort-contract's uncaught `RpcError` proved the pre-Step-3
  whole-compute abort — then passed after restore). Full suite: 714 passed, 83.86% coverage.
- **Steps 5 + 6 committed together:** Step 5's FR-3 sem move broke a pre-existing feature-141 test
  (`test_cross_user_concurrency_bounded_by_semaphore`, which asserted `peak == 2` counting *all*
  GetBars) — post-FR-3 the compute and enrichment no longer share permits, so cross-user peak can
  reach 4. That test was migrated to count only compute-path (range-bearing) fetches (the same
  `HasField("range")` distinguisher the sibling dedup test uses), asserting the compute sem's bound
  in isolation. Because that migrated test lives in the same file as the new Step-6
  `TestOpportunitySemaphoreIsolation` class, Steps 5 and 6 were committed as one unit to keep the
  commit's suite green. Step 6 RED was proven first (reverting Step 5 → `test_compute_fanout…`
  failed `0 >= 2`). Full suite: 716 passed, 83.86% coverage.
- **✅ RESOLVED [x] (Step 7): cold-read test blast radius.** Step 7 changes the
  cold `ListOpportunities` branch (`servicer.py:3368-3372`) from synchronous compute to
  kick+empty. Beyond `test_cold_read_computes_synchronously_then_serves` (which Step 8 explicitly
  rewrites), **many** `TestListOpportunitiesMaterialized` tests drive the compute via a cold
  `_list_opps(svc)` and then assert on the served rows / `svc._opportunities_repo.rows` (e.g.
  `test_watchlist_and_held_add_rows_with_real_readiness`, `test_min_conviction_filters_on_readiness`,
  `test_signal_and_watchlist_collapse_into_one_row`, the feature-132 muted tests, the feature-131
  live-attribution tests). These will return empty after Step 7 unless migrated to drain the
  background kick (the `for _ in range(100): await asyncio.sleep(0)` pattern already used by
  `test_stale_read_serves_stale_and_kicks_recompute`). Step 7/8 MUST migrate this whole set, not only
  the three named cold/stale/empty tests. Resolved when Step 8's full-suite run is green.
  **Resolution:** migrated at a single point — the `_list_opps` helper now drains the guarded
  background kick (new `_drain_opportunity_recompute`, budget 20000: the 240-candidate compute needs
  more than 200 loop turns) and re-reads on a cold `computing`+empty response, so every compute-path
  assertion sees the materialized queue. `test_owner_scoping_preserved_under_parallel_fanout` (direct
  `ListOpportunities` for `uB`) got an inline drain. Two feature-177 tests in
  `test_opportunity_compute_state.py` were rewritten (see next note). Full suite: 716 passed, 83.82%.
- **Step 7 (`_materialize_opportunities` removed):** grep confirmed its only caller was the cold
  branch this step replaces (no daily-refresh or test caller), so the now-dead method was deleted.
  The daily refresh + `_kick` call `_replace_and_stamp_compute_state` directly, unaffected.
- **Step 7 (feature-177 AC-4 mechanism strengthened, guarantee PRESERVED — C-16):** FR-4 makes the
  cold path non-blocking, so feature-177's "a legitimately-empty universe is not repeatedly
  *synchronously* recomputed" is **strengthened** to "never synchronously recomputed" (delegated to
  the guarded background kick). The observable AC-4 guarantee is preserved, not weakened, so this is
  within FR-4's operator-approved scope (not a new C-16 CHANGE). `test_empty_universe_recomputes_at_
  most_once_over_window` → rewritten to assert zero synchronous computes + the cold pending signal;
  `test_fresh_empty_serve_kicks_self_heal_and_writes_new_row` → drains the kicked recompute per poll.
