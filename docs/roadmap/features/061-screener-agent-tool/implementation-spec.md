# Implementation Spec: screener-agent-tool

**Status**: `pending`
**Created**: 2026-06-27
**Feature**: `docs/roadmap/features/061-screener-agent-tool/feature.md`
**Total Steps**: 4
**Feature Branch**: `feature/screener-agent-tool`

---

## Execution Summary

This is a thin, single-service feature that exposes Feature 060's `ScreenSymbols` analysis RPC as a
new `screen_symbols` MCP tool in `xstockstrat-agent`, mirroring the existing `run_backtest` tool
exactly. No proto, config, or DB changes belong to this feature — it is a pure runtime consumer of
060's contract. The client wrapper (`app/client.py`) is added first, then the FastMCP tool
declaration (`app/tools.py`) that delegates to it, then a paired test step, then the docs/tool-count
updates. The implementation order is client → tool → test → docs because the tool depends on the
client method and the test exercises both.

**Hard build-order dependency on Feature 060:** the generated symbols `analysis_pb2.ScreenSymbolsRequest`,
`analysis_pb2.ScreenResult`, and `analysis_pb2_grpc.AnalysisServiceStub.ScreenSymbols` **do not exist
yet** — they are produced by Feature 060 Step 1 (proto) + Step 2 (`./scripts/buf-gen.sh`). Confirmed
absent today: zero hits for `ScreenSymbols` in `packages/proto/gen/python/` and in
`packages/proto/analysis/v1/analysis.proto`. **Do not start `/sdd-execute` on this feature until
Feature 060 is merged to the working base and the regenerated stubs are present** (verify with
`grep -rn "ScreenSymbols" packages/proto/gen/python/analysis/v1/analysis_pb2.py`). This dependency is
already recorded in `docs/roadmap/features/merge-order.md`.

## Step Dependencies

- **All steps require Feature 060 merged + stubs regenerated** — `analysis_pb2.ScreenSymbolsRequest` /
  `analysis_pb2_grpc.AnalysisServiceStub.ScreenSymbols` must exist in `packages/proto/gen/python/`
  before any code here can reference them.
- Step 2 (tool) requires Step 1 (client method): the `@server.tool()` wrapper calls
  `client.screen_symbols(...)`.
- Step 3 (test) covers Steps 1 & 2: it mocks the gRPC channel for the client and patches
  `client.screen_symbols` for the tool, mirroring the existing `run_backtest` test patterns.
- Step 4 (docs) requires Steps 1 & 2 complete (the tool must exist before the count is bumped to
  eleven and the enumeration updated).

---

### Step 1 — service: Add `client.screen_symbols` gRPC wrapper

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify

**Reviewers**: `xstockstrat-agent` (service owner) — `x-mcp-secret` metadata, read-only (non-admin) scope, per-call channel pattern, response shaping

**Codebase Evidence**:
- Existing per-call-channel pattern to mirror — `run_backtest` at `services/xstockstrat-agent/app/client.py:138-164`:
  ```python
  async def run_backtest(strategy_id: str, symbols: list[str], initial_capital: float = 100000.0) -> dict[str, Any]:
      from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc  # noqa: PLC0415
      async with grpc.aio.insecure_channel(ANALYSIS_ENDPOINT) as channel:
          stub = analysis_pb2_grpc.AnalysisServiceStub(channel)
          resp = await stub.RunBacktest(
              analysis_pb2.RunBacktestRequest(strategy_id=..., symbols=list(symbols), initial_capital=...),
              metadata=_metadata(),
          )
      return { "backtest_id": resp.backtest_id, ... }
  ```
- `_metadata()` helper — `app/client.py:24-27`: returns `[("x-mcp-secret", MCP_AGENT_SECRET)]` when set, else `[]`. **Use this directly — no admin scope.**
- Inline admin-scope pattern (NOT used here) — `app/client.py:217` (and `:385`, `:527`): `meta = list(_metadata()) + [("x-access-scope", "7")]`. This feature is read-only (product-spec FR-3), so it must use plain `metadata=_metadata()`, exactly like `run_backtest`.
- `ANALYSIS_ENDPOINT` default — `app/client.py:17`: `os.environ.get("ANALYSIS_ENDPOINT", "xstockstrat-analysis:50056")`.
- Lazy proto import pattern (per-method) — `app/client.py:144`: `from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc  # noqa: PLC0415`.
- 060 contract field shape (from `docs/roadmap/features/060-screener-engine/implementation-spec.md:80-96`):
  - `ScreenSymbolsRequest`: `repeated string symbols = 1; repeated ScreenCriterion criteria = 2; repeated string signal_sources = 3; double signal_weight = 4; double technical_weight = 5; double min_conviction = 6; int32 rank_limit = 7;`
  - `ScreenCriterion`: `string ref_name = 1; ScreenKind kind = 2; string metric_name = 3; StrategyComponent component = 4; Comparator op = 5; double threshold = 6; double threshold_high = 7; double weight = 8; bool hard_filter = 9;`
  - `ScreenResult`: `string symbol = 1; double score = 2; map<string,double> criterion_scores = 3; bool passed = 4; ScreenResultStatus status = 5; CoverageGap gap = 6;`
  - `ScreenSymbolsResponse`: `repeated ScreenResult results = 1; repeated CoverageGap coverage_gaps = 2;`
- Header-propagation note: the agent's outbound calls use Python per-method `metadata=` (no AsyncLocalStorage interceptor); this matches `docs/patterns/header-propagation.md`. The agent forwards only `x-mcp-secret` via `_metadata()` (it is the platform-internal caller, not a request-scoped propagator) — `run_backtest` does the same, so reusing `_metadata()` is the established pattern.

**Instructions**:
1. Add an `async def screen_symbols(...)` coroutine to `app/client.py`, placed immediately after
   `run_backtest` (after `client.py:164`), mirroring `run_backtest`'s structure exactly.
2. Signature (keep it explicit-symbols-only per product-spec OQ-061-a — no `watchlist_id`):
   ```python
   async def screen_symbols(
       symbols: list[str],
       criteria: list[dict[str, Any]] | None = None,
       signal_sources: list[str] | None = None,
       signal_weight: float = 0.0,
       technical_weight: float = 1.0,
       min_conviction: float = 0.0,
       rank_limit: int = 0,
   ) -> dict[str, Any]:
   ```
   (Accept criteria as a list of plain dicts so the FastMCP tool can pass JSON-shaped input; map each
   dict into an `analysis_pb2.ScreenCriterion`. Defaults of `0` / `0.0` let the analysis side apply its
   own config-driven defaults, e.g. `analysis.screener.default_rank_limit`.)
3. Lazily import the analysis stubs inside the function, matching `client.py:144`:
   `from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc  # noqa: PLC0415`.
4. Open a fresh per-call channel exactly like `run_backtest`:
   `async with grpc.aio.insecure_channel(ANALYSIS_ENDPOINT) as channel:` and
   `stub = analysis_pb2_grpc.AnalysisServiceStub(channel)`.
5. Build the request, mapping each criterion dict to a `ScreenCriterion`. Use enum-name → value via
   the generated `.Value(...)` helpers so callers can pass strings (e.g. `"COMPARATOR_GTE"`,
   `"SCREEN_KIND_FUNDAMENTAL"`):
   ```python
   req_criteria = [
       analysis_pb2.ScreenCriterion(
           ref_name=c.get("ref_name", ""),
           kind=analysis_pb2.ScreenKind.Value(c["kind"]) if isinstance(c.get("kind"), str) else c.get("kind", 0),
           metric_name=c.get("metric_name", ""),
           op=analysis_pb2.Comparator.Value(c["op"]) if isinstance(c.get("op"), str) else c.get("op", 0),
           threshold=c.get("threshold", 0.0),
           threshold_high=c.get("threshold_high", 0.0),
           weight=c.get("weight", 0.0),
           hard_filter=c.get("hard_filter", False),
       )
       for c in (criteria or [])
   ]
   resp = await stub.ScreenSymbols(
       analysis_pb2.ScreenSymbolsRequest(
           symbols=list(symbols),
           criteria=req_criteria,
           signal_sources=list(signal_sources or []),
           signal_weight=signal_weight,
           technical_weight=technical_weight,
           min_conviction=min_conviction,
           rank_limit=rank_limit,
       ),
       metadata=_metadata(),
   )
   ```
   (Do not set `component` from string input in this thin tool — leave it at its default unless a
   numeric value is supplied, since `StrategyComponent` mapping is out of scope for the read-only
   wrapper; document this in the docstring.)
6. Shape the response into a JSON-serializable dict (FastMCP returns dicts), mirroring how
   `run_backtest` returns a flat dict:
   ```python
   return {
       "results": [
           {
               "symbol": r.symbol,
               "score": r.score,
               "criterion_scores": dict(r.criterion_scores),
               "passed": r.passed,
               "status": analysis_pb2.ScreenResultStatus.Name(r.status),
           }
           for r in resp.results
       ],
       "coverage_gaps": [{"symbol": g.symbol} for g in resp.coverage_gaps],
   }
   ```
   (Use `MessageToDict` from `app/client.py:9` as an alternative if a faithful full-message dump is
   preferred — but match the explicit-field style of `run_backtest` for consistency. Confirm the
   exact `CoverageGap` field names against the regenerated `analysis_pb2` at execute time; if the
   field is not `symbol`, adjust — this is the one place where the 060-generated shape must be
   re-verified before writing.)
7. Attach `metadata=_metadata()` only — **no** `x-access-scope` (read-only, product-spec FR-3).

**Verification**:
- `grep -n "async def screen_symbols" services/xstockstrat-agent/app/client.py` — method present.
- `grep -n "x-access-scope" services/xstockstrat-agent/app/client.py` — confirm the new method does
  **not** add this header (existing admin matches at `:217/:385/:527` only; the new method's body must
  contain none).
- `grep -n "metadata=_metadata()" services/xstockstrat-agent/app/client.py` — confirm the new call uses
  the plain `_metadata()` form (carrying `x-mcp-secret`).
- Lint: `cd services/xstockstrat-agent && ruff check . && ruff format --check .` — passes.

---

### Step 2 — service: Add `screen_symbols` FastMCP tool

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: `xstockstrat-agent` (service owner) — FastMCP tool declaration, delegation to client, docstring/param documentation, read-only scope

**Codebase Evidence**:
- Existing tool to mirror — `run_backtest` at `services/xstockstrat-agent/app/tools.py:230-244`:
  ```python
  @server.tool()
  async def run_backtest(strategy_id: str, symbols: list[str], initial_capital: float = 100000.0) -> dict:
      """Trigger a backtest via xstockstrat-analysis. ..."""
      return await client.run_backtest(strategy_id=strategy_id, symbols=symbols, initial_capital=initial_capital)
  ```
- All tools are registered inside `register_tools(server)` (entry at `tools.py:57`); `tools.py` imports
  `from app import client` and does **not** import proto modules directly (`tools.py:17-23`) — it
  delegates to `client`.
- Header docstring enumeration to update — `tools.py:4` `"Ten tools:"` followed by the list at
  `tools.py:5-14`.

**Instructions**:
1. Add an `@server.tool()`-decorated `async def screen_symbols(...)` inside `register_tools`,
   immediately after `run_backtest` (after `tools.py:244`), mirroring `run_backtest`'s shape.
2. Declare a JSON-friendly signature and delegate to the client method from Step 1:
   ```python
   @server.tool()
   async def screen_symbols(
       symbols: list[str],
       criteria: list[dict] | None = None,
       signal_sources: list[str] | None = None,
       signal_weight: float = 0.0,
       technical_weight: float = 1.0,
       min_conviction: float = 0.0,
       rank_limit: int = 0,
   ) -> dict:
       """Scan a universe of symbols via xstockstrat-analysis and return ranked candidates.
       symbols: explicit ticker list to screen e.g. ['NVDA', 'AAPL'] (no watchlist resolution).
       criteria: list of criterion dicts, each with keys: ref_name, kind
           (e.g. 'SCREEN_KIND_FUNDAMENTAL'|'SCREEN_KIND_TECHNICAL_FORMULA'|'SCREEN_KIND_SIGNAL'),
           metric_name, op (e.g. 'COMPARATOR_GTE'), threshold, threshold_high, weight, hard_filter.
       signal_sources/signal_weight/technical_weight/min_conviction: optional signal-blend params.
       rank_limit: cap on returned results (0 = analysis-side default)."""
       return await client.screen_symbols(
           symbols=symbols,
           criteria=criteria,
           signal_sources=signal_sources,
           signal_weight=signal_weight,
           technical_weight=technical_weight,
           min_conviction=min_conviction,
           rank_limit=rank_limit,
       )
   ```
3. Update the module header docstring enumeration: change `tools.py:4` from `"Ten tools:"` to
   `"Eleven tools:"` and add a `screen_symbols` line to the list at `tools.py:5-14`.

**Verification**:
- `grep -n "async def screen_symbols" services/xstockstrat-agent/app/tools.py` — tool present.
- `grep -n "@server.tool()" services/xstockstrat-agent/app/tools.py | wc -l` — count increases by 1
  (now 11 decorated tools).
- Lint: `cd services/xstockstrat-agent && ruff check . && ruff format --check .` — passes (lint+coverage
  also run together in the paired Step 3).

---

### Step 3 — test: Unit tests for `screen_symbols` tool + client wrapper (covers Steps 1 & 2)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tools.py` — modify (tool-level delegation test)
- `services/xstockstrat-agent/tests/test_client.py` — modify (client-level gRPC mock test)

**Reviewers**: `xstockstrat-agent` (service owner) — test correctness, metadata assertion, mock fidelity to gRPC contract

**Codebase Evidence**:
- Tool-level test pattern — `tests/test_tools.py:231-247` (`test_run_backtest_calls_grpc`): patches
  `client.run_backtest` with an `AsyncMock`, resolves the tool function via
  `_tool_fn(server, "run_backtest")` (helper at `tests/test_tools.py:21-22`), invokes it, and asserts
  `assert_called_once_with(...)`.
- Client-level gRPC mock pattern — `tests/test_client.py:39-65` (`test_emit_alert_sends_grpc_call`) and
  `:78-104` (admin-scope variant): patches `app.client.grpc`, sets
  `insecure_channel.return_value = _channel_cm()` (helper at `test_client.py:71-75`), patches the stub
  (e.g. `AnalysisServiceStub`) to a `MagicMock` whose RPC is an `AsyncMock`, then asserts the endpoint
  and the `metadata` passed to the RPC.
- Fixtures — `tests/conftest.py:10-28` registers the `gen` proto namespace on `sys.path`; `:31-47`
  sets endpoint/secret env and patches module-level client vars (incl. `MCP_AGENT_SECRET="test-secret"`).
- Framework — pytest with `asyncio_mode = "auto"` (`pyproject.toml:29-31`).
- Coverage threshold — `uv run pytest --cov=app --cov-fail-under=40` (`CLAUDE.md:105`).

**Instructions**:
1. In `tests/test_tools.py`, add `test_screen_symbols_calls_client` mirroring
   `test_run_backtest_calls_grpc` (`test_tools.py:231-247`): patch `client.screen_symbols` with an
   `AsyncMock` returning a deterministic ranked dict (e.g. `{"results": [{"symbol": "NVDA", "score":
   0.9, ...}], "coverage_gaps": []}`), resolve the tool via `_tool_fn(server, "screen_symbols")`,
   invoke with a symbol list + one criterion dict, and assert `assert_called_once_with(...)` with the
   forwarded kwargs.
2. In `tests/test_client.py`, add `test_screen_symbols_sends_grpc_call` mirroring
   `test_emit_alert_sends_grpc_call` (`test_client.py:39-65`): patch `app.client.grpc`, wire
   `insecure_channel.return_value = _channel_cm()`, patch `AnalysisServiceStub` so `.ScreenSymbols` is
   an `AsyncMock` returning a mock response with `.results`/`.coverage_gaps`, call
   `await client.screen_symbols(symbols=["NVDA"], criteria=[...])`, then assert:
   - the channel was opened against `ANALYSIS_ENDPOINT` (`xstockstrat-analysis:50056`),
   - the `metadata` passed to `.ScreenSymbols` contains `("x-mcp-secret", "test-secret")` and **does
     not** contain any `x-access-scope` entry (acceptance criterion #2: carries `x-mcp-secret` and no
     admin headers).
3. Build the mock response objects to expose the fields the wrapper reads (`results[*].symbol/score/
   criterion_scores/passed/status`, `coverage_gaps[*].symbol`) so the dict-shaping path in Step 1 is
   exercised.

**Verification**:
- `cd services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40` — both new tests pass
  and coverage stays ≥ 40%.
- `cd services/xstockstrat-agent && ruff check . && ruff format --check .` — lint + format clean
  (satisfies the §B code-quality gate alongside coverage).

---

### Step 4 — docs: Update tool count and tool enumeration

**Status**: `pending`
**Service**: `docs/runbooks/` + `services/xstockstrat-agent/CLAUDE.md`
**Files**:
- `services/xstockstrat-agent/CLAUDE.md` — modify
- `docs/runbooks/mcp-tools.md` — modify
- `docs/runbooks/CLAUDE.md` — modify (index line referencing the tool count)

**Reviewers**: none (docs step)

**Codebase Evidence**:
- `services/xstockstrat-agent/CLAUDE.md:22` — `"The agent registers ten tools"`; the tool table follows
  at `CLAUDE.md:27-36` (10 rows; `run_backtest` row present).
- `docs/runbooks/mcp-tools.md:3` — `"Complete reference for the nine tools exposed by ..."` (already
  inconsistent with CLAUDE.md's "ten"); tool sections begin under `## Tools` (`mcp-tools.md:69`).
- `docs/runbooks/CLAUDE.md` index line for `mcp-tools.md` — `"all nine agent tools ..."`.
- (Tool-list docstrings in `app/tools.py:4-14` are updated in Step 2, not here.)

**Instructions**:
1. In `services/xstockstrat-agent/CLAUDE.md`: change `:22` `"ten tools"` → `"eleven tools"`, and add a
   table row under the MCP Tools table (`:27-36`):
   `| \`screen_symbols\` | Scan a symbol universe via xstockstrat-analysis and return ranked candidates (read-only) |`.
   Add `screen_symbols` to the read-only set (it does **not** belong in the
   "Management-tool authorization" admin list — note it carries no admin `x-access-scope`).
2. In `docs/runbooks/mcp-tools.md`: bump the count in the intro (`:3`) to the correct total (reconcile
   the existing "nine" vs CLAUDE.md "ten" mismatch — with this feature the true count becomes
   **eleven**), and add a `### screen_symbols` subsection under `## Tools` (`mcp-tools.md:69`) with a
   parameter table (symbols, criteria, signal_sources, signal_weight, technical_weight, min_conviction,
   rank_limit), the return shape (`results[]` with symbol/score/criterion_scores/passed/status +
   `coverage_gaps[]`), and a note that it sends `x-mcp-secret` and **no** admin scope.
3. In `docs/runbooks/CLAUDE.md`: update the `mcp-tools.md` index line's tool count to match (eleven).

**Verification**:
- `grep -n "eleven tools" services/xstockstrat-agent/CLAUDE.md` — updated count present.
- `grep -n "screen_symbols" services/xstockstrat-agent/CLAUDE.md docs/runbooks/mcp-tools.md` — tool
  documented in both.
- `grep -rn "ten tools\|nine tools\|nine agent tools" services/xstockstrat-agent/CLAUDE.md docs/runbooks/mcp-tools.md docs/runbooks/CLAUDE.md`
  — no stale counts remain.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
