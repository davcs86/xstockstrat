# Implementation Spec: expose-score-strategy-mcp

**Status**: `pending`
**Created**: 2026-11-01
**Feature**: `docs/roadmap/features/283-expose-score-strategy-mcp/feature.md`
**Total Steps**: 10
**Feature Branch**: `feature/expose-score-strategy-mcp`

---

## Execution Summary

Expose `analysis.v1.AnalysisService/ScoreStrategy` as `manage_strategy operation='score'` (no new tool, count stays 45, `get_strategy` untouched, no proto field, no config key, no migration). The already-computed `excluded` list rides back to the agent in a gRPC trailer `x-score-excluded-symbols` (compact JSON array, 4096-byte cap), read through the call-object form; a missing/unparseable trailer is `excluded_symbols: null` + one WARN, never a fabricated `[]` (P-03).

**Order is risk-first.** The only unproven mechanism is trailer delivery through the production stacks, so the two loopback tests come first, each paired with the smallest production change that can turn it green: Steps 1-2 are the **agent (client) half** (real `client.score_strategy` through a real channel with `GrpcAioInstrumentorClient` installed), Steps 3-4 the **analysis (server) half** (real `ScoreStrategy` behind `server_interceptors()` + `GrpcAioInstrumentorServer`). **Go/no-go gates**: if the Step 2 or Step 4 loopback stays red *because the trailer is dropped* (not because of a typo), stop. Step 2 carries the pre-approved own-interceptor fallback; if that also fails, FR-5 returns to the operator (design.md § Open Risks) and no proto field is adopted. Step 5 adds the tool tests and tool-deadline guard (RED) and Step 6 the `score` branch that turns them green; Steps 7-9 add the call-object deadline matcher, the docs parity test and the docs; Step 10 is the root `CLAUDE.md` teardown.

**Consumer surface (C-14).** Agent only: Steps 2 and 6 (`client.score_strategy`, the `manage_strategy` `score` branch and docstring) plus Step 8/9 docs. **UI: none, deliberately** — the UI BFF already reaches `ScoreStrategy` (`insightsBff.ts`), ignores the trailer, and the tool count is unchanged, so `copilot.ts` / `CopilotRail.tsx` are not edited (product-spec § Consumer Surface).

**Design refinements found while grounding this spec** (each is a correction of a *mechanism* in design.md, not of the Chosen Approach; they are logged in `context.md` for `/sdd-review impl-spec` to challenge):
1. **Loopback split in two.** design.md § Chosen Approach 6 has the analysis `tests/test_telemetry.py` drive "the agent's REAL `client.score_strategy`". That cannot work in one process: both services ship a top-level package named `app` (`services/xstockstrat-analysis/app`, `services/xstockstrat-agent/app`) with separate `uv` environments. Each half is proven in its own suite against a real gRPC wire, and together they cover the full path. The analysis half lives in a new `tests/test_score_trailer_loopback.py` (not `test_telemetry.py`), and uses an insecure port: TLS does not touch metadata handling, and the existing `otel_reset` fixtures in both suites monkeypatch `instrument` to a no-op (`xstockstrat-analysis/tests/conftest.py:513`, `xstockstrat-agent/tests/conftest.py:265`), so the new tests must not use them.
2. **`_stub_calls` matcher.** design.md says to match "each `ast.Call` on `stub.X` ONCE". Measured on `app/client.py`: the existing awaited matcher counts **73**; matching every `ast.Call` whose receiver is `stub` or a `Call` counts **82** (9 non-RPC calls such as `datetime(...).isoformat()` at `client.py:110`, `:149`, `:688`, `:867`, `:2205`, `:2228`, `:2402`, `:2490`). So the correct extension is a single added branch for `ast.Assign` whose value is `stub.X(...)` with receiver `Name('stub')` only, giving exactly **74** (73 + `ScoreStrategy`).
3. **`hung_backend` gains optional trailers** (`tests/conftest.py:146-208`): a reply may be `(delay_s, outcome, trailers)`. This lets the real-channel tests reuse the existing fixture instead of building a second in-process server (C-18 DRY; C-13: `conftest.py` is the canonical Python home).

## Scenario Coverage (C-15)

| Scenario | Covered by step(s) |
|---|---|
| `@AC-1` refresh returns the grade with provenance, snake_case | 1 (client projection), 5 (tool) |
| `@AC-2` non-owner rejected, no grade written | 3 (analysis: no trailer, no write), 5 (tool message) |
| `@AC-3` no eligible evidence → NOT_FOUND, stale grade cleared | 3 (analysis), 5 (tool passthrough) |
| `@AC-4` unknown availability → UNAVAILABLE, grade unchanged | 3 (analysis), 5 (tool) |
| `@AC-5` description discloses side effects | 5 |
| `@AC-6` count stays 45, surfaces agree | 8 (PRESERVE: existing `test_every_tool_count_surface_states_the_catalog_size` must stay green; no new test and no RED by design, C-18) |
| `@AC-7` refresh names the excluded symbols | 1 (client half, wire), 3 (server half, wire), 5 (tool) |
| `@AC-8` all-excluded error names the symbols | 3 (analysis), 5 (tool) |
| `@AC-9` definition args rejected, no backend call | 5 |
| `@AC-10` runbook + strat-lab document `score`; operations sets equal | 8 |
| `@AC-11` missing trailer yields `null`, not `[]`, + WARN | 1 (real channel), 5 (client unit) |

## Business Rules (C-16)

- **EXTEND `@AC-5 @feature-273`** (`services/xstockstrat-agent/acceptance/fix-agent-client-deadlines.feature`): new Examples row `| ScoreStrategy | 45.5 |` — operator sign-off recorded in `context.md` 2026-11-01 (round-5 gate); lands in Step 7 together with the test-only `_AC5_ROWS` tuple.
- **EXTEND `@AC-10 @feature-273`**: guard now also sees the call-object form (test-code change only, Step 7).
- **PRESERVE** `@AC-1 @feature-214` (count 45), `@AC-1/2/3/4/6 @feature-149` (the `score` branch exits before `supplied`/`mask`), `@AC-6 @feature-273` (10 s + 45 s ≤ 57 s), `@AC-3/8/9/11/12 @feature-215` (aborts carry no trailer; grade maths untouched), `@AC-6 @feature-262` (`get_by_owner_and_id` untouched), `@AC-5 @FR-4 @feature-149`, `@AC-32 @FR-12 @feature-224`, `@AC-5 @FR-5 @feature-210`.
- Promotion of 283's own scenarios into the durable suites is performed by `/sdd-execute` at the integration PR (`scenario-promoter`); no spec step hand-authors them (`docs/sdd/business-rules/CLAUDE.md`).

## Step Dependencies

- Step 2 requires Step 1: Step 1's tests are the paired RED for `client.score_strategy`; Step 2 is the client go/no-go gate.
- Step 4 requires Step 3 (paired RED) and is the server go/no-go gate. Steps 1-2 and 3-4 are independent of each other and may run in either order, but both gates must be green before Step 6 is merged.
- Step 5 [test, RED] requires Step 2 (the tool tests patch `client.score_strategy`) and is written before Step 6.
- Step 6 [service] turns Step 5 green: the `score` branch and `_score_strategy` helper; it calls `client.score_strategy` (Step 2).
- Step 7 requires Step 2 (the matcher needs `client.score_strategy`); its Verification also re-runs `test_tool_deadlines.py`, so run it after Step 6.
- Step 8 requires Step 6 (docstring) and edits the runbook and strat-lab skill itself so its RED→GREEN lives in one step.
- Step 9 requires Steps 4 and 6 (documents behavior that exists).
- Step 10 is last: it audits every context file Steps 8-9 touched.
- **Cross-feature**: 283 waits for 215's code on trunk — already satisfied (`merge-order.md:102` row and the "Launch gate: 215 ↔ 283" note at `:321-329` exist and are correct; **no `merge-order.md` edit is needed**, verified). Same-function overlap with 215/275/281 on `manage_strategy` (`tools.py`, `client.py`) and soft overlap on `mcp-tools.md` / `SKILL.md`: rebase onto landed bodies and re-anchor by symbol, never by line number. The tool count is unchanged, so 283 does not race 281's `forty-five` guard.
- **Post-merge (not a spec step)**: 215 Step 26 (e) is run through `manage_strategy operation='score'` on staging, asserting a non-null `excluded_symbols` (meaningful only if staging runs `OTEL_ENABLED=true` like production). Do not set 215 to `code-completed` before it runs (`merge-order.md:327-330`).

---

### Step 1 — test: agent client-half production-wiring loopback (RED)

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/conftest.py` — modify (`hung_backend`: optional trailers)
- `services/xstockstrat-agent/tests/test_score_trailer_loopback.py` — create

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- `services/xstockstrat-agent/tests/conftest.py:146` `def hung_backend(monkeypatch)`; `:168` `def _handle(method, context) -> bytes`; `:171` `reply = replies.get(method)`; `:176` `delay_s, outcome = reply`; `:177-180` `context.abort(...)` or `return outcome.SerializeToString()`. Docstring documents `answers` as `(delay_s, msg)` or `(delay_s, grpc.StatusCode)`. The fixture re-points the endpoint and sets `client.mtls.secure_channel` to `lambda ep, _svc: grpc.aio.insecure_channel(ep)` (resolved at call time, so a prior `GrpcAioInstrumentorClient().instrument()` wraps it).
- Production installs exactly `GrpcAioInstrumentorClient().instrument()` at `services/xstockstrat-agent/app/telemetry.py:80`.
- The existing `otel_reset` fixture stubs it out: `services/xstockstrat-agent/tests/conftest.py:265` `monkeypatch.setattr(GrpcAioInstrumentorClient, "instrument", lambda self, **kw: None)` — the new tests must **not** request `otel_reset`.
- Exact wire names: `packages/proto/analysis/v1/analysis.proto:3` `package xstockstrat.analysis.v1;`; `StrategyScore` fields 1-8 at `:249-259`.
- `client.score_strategy` and the logger `app.client` (`client.py:20` `log = logging.getLogger(__name__)`): **score_strategy not found** — created in Step 2.

**TDD**: `red-green required` — RED: `AttributeError: module 'app.client' has no attribute 'score_strategy'`.

**Covers**: `AC-1, AC-7, AC-11`

**Instructions**:
0. Read the installed OpenTelemetry package before writing assertions: `cd services/xstockstrat-agent && uv sync --extra dev && uv run python -c "import opentelemetry.instrumentation.grpc as m; print(m.__file__, m.__version__)"`; open that package and confirm (a) `GrpcAioInstrumentorClient` has `instrument()` **and** `uninstrument()`, (b) whether its aio client interceptor returns the call object or the response. Record both in `context.md`. Do not rely on memory of the 0.66b1 source.
1. `tests/conftest.py`, `hung_backend._handle`: accept an optional third reply element. Replace `delay_s, outcome = reply` with `delay_s, outcome, *rest = reply`; after the `StatusCode` abort branch and before `return outcome.SerializeToString()`, `if rest: context.set_trailing_metadata(rest[0])`. Update the fixture docstring (`answers` may be `(delay_s, msg, trailers)`). Existing 2-tuples behave identically.
2. Create `tests/test_score_trailer_loopback.py`. Add a fixture `instrument_client` (parametrized `[False, True]` named `instrumented`) that, when True, calls `GrpcAioInstrumentorClient().instrument()` before the test body and `.uninstrument()` in teardown; it must not use `otel_reset`.
3. Tests, each using `hung_backend("ANALYSIS_ENDPOINT", answers={"ScoreStrategy": (0, analysis_pb2.StrategyScore(strategy_id="s", overall_score=0.7, rating="B", evidence_symbols=2, evidence_days=756, provisional=False), (("x-score-excluded-symbols", '["SCHD"]'),))})` then `await client.score_strategy("u-1", "s")`. Import the stubs in-function as the rest of the suite does (`from gen.analysis.v1 import analysis_pb2`):
   - **populated** (both `instrumented` values): `result["excluded_symbols"] == ["SCHD"]`, `result["evidence_symbols"] == 2` (an `int`), `result["evidence_days"] == 756`, `result["provisional"] is False`, `result["rating"] == "B"`, keys are snake_case.
   - **empty list** (instrumented): trailer `"[]"` → `excluded_symbols == []`.
   - **absent** (instrumented): no third tuple element → `excluded_symbols is None`, and exactly one WARNING record from logger `app.client` (`caplog.at_level(logging.WARNING, logger="app.client")`).
   - **malformed** (parametrize `'not json'`, `'"SCHD"'`, `'[1]'`, `'{"a":1}'`): each → `None` plus exactly one WARN.
   - `client._EXCLUDED_TRAILER_KEY == "x-score-excluded-symbols"` (literal asserted in both suites; the analysis suite asserts the same literal in Step 3).
4. Diagnostic rule for Step 2's gate: **populated/`instrumented=False` green and `instrumented=True` red with `excluded_symbols is None`** is the signature of the client-side OTel wrapper swallowing trailers.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest tests/test_score_trailer_loopback.py -q   # RED now: AttributeError on client.score_strategy
cd services/xstockstrat-agent && uv run pytest tests/test_tool_deadlines.py tests/test_client_deadlines.py -q   # existing hung_backend users unchanged
cd services/xstockstrat-agent && ruff check . && ruff format --check .
```
C-13: the `StrategyScore(...)` literal has one consumer in this file (Steps 5/8 build their own scenario literals); inline is compliant.
The agent coverage command (`--cov-fail-under=40`) is repeated in Steps 2, 5 (run after Step 6), 7, 8 and 10; this RED step carries it so the gate is never skipped: `cd services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40 -q` (expected to fail now with the `AttributeError`).

---

### Step 2 — service: agent `client.score_strategy` (go/no-go gate: client half)

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify
- `services/xstockstrat-agent/app/mtls.py` — modify (**contingency only**, see Instructions 5)
- `services/xstockstrat-agent/app/trailer_capture.py` — create (**contingency only**; exercised by `tests/test_score_trailer_loopback.py`)
- `services/xstockstrat-agent/tests/conftest.py` — modify (**contingency only**: `hung_backend`'s `secure_channel` lambda at `:195` is `lambda ep, _svc:` and must forward `interceptors=`)

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- `client.py:37-38` `_RPC_TIMEOUT_S = 10.0` / `_LONG_RPC_TIMEOUT_S = 45.0`; `:20` `log = logging.getLogger(__name__)`; `:14` `from google.protobuf.json_format import MessageToDict, ParseDict`; `:68` `def _metadata(*extra)`; `:17` `from app import mtls`.
- Model to copy: `client.py:982-1005` `async def get_strategy(user_id, strategy_id)` — `async with mtls.secure_channel(ANALYSIS_ENDPOINT, "xstockstrat-analysis") as channel:`, `stub = analysis_pb2_grpc.AnalysisServiceStub(channel)`, `metadata=_metadata(("x-user-id", user_id))`, `timeout=_RPC_TIMEOUT_S`, returns `MessageToDict(resp, preserving_proto_field_name=True, always_print_fields_with_no_presence=True)`; in-function import `from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc  # noqa: PLC0415`.
- `client.py:932-941` `op_map` (register/update/deactivate/reactivate) and `raise ValueError(f"unknown operation '{operation}' (expected register/update/deactivate/reactivate)")`.
- `app/mtls.py:37-43` `def secure_channel(endpoint, target_service)` returns `grpc.aio.secure_channel(endpoint, channel_credentials(), options=[("grpc.ssl_target_name_override", target_service)])` (no `interceptors=` parameter today).
- Header propagation (C-03): the call reuses `_metadata(("x-user-id", user_id))` and the per-request trio carried by `CallerPropagationMiddleware` (`docs/patterns/header-propagation.md`, AGENT-4), identical to `get_strategy`; no new mechanism.
- `StrategyScore.origin` is a message field (`analysis.proto:258`, has presence), so `always_print_fields_with_no_presence` omits it when unset; every other field prints.

**TDD**: `red-green required` (paired test: Step 1)

**Covers**: —

**Instructions**:
1. Add module constants next to `_LONG_RPC_TIMEOUT_S` (`client.py:38`): `_EXCLUDED_TRAILER_KEY = "x-score-excluded-symbols"` with a ≤2-line comment stating the constraint (analysis sets this trailer on a successful `ScoreStrategy`; the literal is asserted in both services' suites).
2. Add `async def score_strategy(user_id: str, strategy_id: str) -> dict[str, Any]` after `get_strategy` (`client.py:1005`):
   - same channel/stub/metadata shape as `get_strategy`, but `timeout=_LONG_RPC_TIMEOUT_S` (`ScoreStrategy` performs a PIT-fundamentals fan-out; 10 s would cancel the handler before `_persist_strategy_score`) and the **call-object form** inside the `async with`: `call = stub.ScoreStrategy(analysis_pb2.ScoreStrategyRequest(strategy_id=strategy_id), metadata=_metadata(("x-user-id", user_id)), timeout=_LONG_RPC_TIMEOUT_S)`; `resp = await call`; `md = await call.trailing_metadata()`. Do not send `range` (ignored server-side).
   - project with the `get_strategy` `MessageToDict(...)` call, then `result["excluded_symbols"] = <parsed>`.
   - parse: read `md.get(_EXCLUDED_TRAILER_KEY)` when `md` is not None; `json.loads`, and accept only a `list` whose items are all `str`; a missing key, `md is None`, invalid JSON or any other shape → `None` plus exactly one `log.warning(...)` naming the reason. Add `import json` to the module imports (`client.py:6-11`) if absent. Never substitute `[]` (P-03).
3. Update the unknown-operation `ValueError` text at `client.py:938-941` to end `(expected register/update/deactivate/reactivate; 'score' is routed to ScoreStrategy)`. Leave `op_map` literal (rejected: hoisting a shared constant).
4. **Gate.** Run Step 1's tests. All green ⇒ the client half is proven through the production client instrumentor; continue.
5. **Contingency (only if Step 1 shows the swallow signature).** Record the evidence in `context.md`, then implement the design's fallback: a small client interceptor in `app/trailer_capture.py` that, inside the OTel wrapper, captures `await call.trailing_metadata()` from the real call, and extend `mtls.secure_channel` (`mtls.py:37-43`) to accept an optional `interceptors=` list; confirm from the installed instrumentor source (Step 1 sub-step 0) that it *prepends* its own interceptors rather than replacing ours, and change `hung_backend`'s `secure_channel` lambda (`conftest.py:195`, `lambda ep, _svc:`) to forward `interceptors=` (listed in **Files**). Re-run Step 1. **If that is also red: stop; FR-5 returns to the operator** — do not add a proto field and do not ship `excluded_symbols` as always-`null`.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest tests/test_score_trailer_loopback.py tests/test_client.py -q   # GREEN, including instrumented=True
cd services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40 -q   # CI threshold (agent: 40%)
cd services/xstockstrat-agent && grep -n "x-user-id\|timeout=_LONG_RPC_TIMEOUT_S\|trailing_metadata" app/client.py   # propagation + budget + trailer read present
cd services/xstockstrat-agent && ruff check . && ruff format --check .
```

---

### Step 3 — test: analysis trailer unit tests + server-half production-wiring loopback (RED)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_grade_fundamentals_exclusion.py` — modify
- `services/xstockstrat-analysis/tests/test_score_trailer_loopback.py` — create

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `servicer.py:2566` `async def ScoreStrategy(self, request, context)` decorated `@owner_scoped` (`:2565`); abort paths `:2587-2592` (PERMISSION_DENIED "strategy not found or not owned"), `:2604-2609` (UNAVAILABLE "fundamentals availability unknown — grade unchanged"), `:2626-2631` (NOT_FOUND "no eligible evidence — all evidence symbols excluded (fundamentals unavailable: …)"), `:2633-2635` (NOT_FOUND "no eligible evidence — run a backtest"); success `:2637` `await self._persist_strategy_score(...)`, ledger emit, `:2662` `return score`.
- `servicer.py:2737` `_exclude_refused_cells`; `:2798` `return list(kept.values()), sorted(set(symbols) - kept.keys())` (already sorted+deduped); `:2852-2853` `if excluded is not None: excluded.extend(dropped)` (single extend).
- `tests/test_grade_fundamentals_exclusion.py`: `_blend_svc(cells, **kw)` at `:85`, `_wire` `:65`, `_cell` `:53`, `_owned_ctx` imported from `tests.test_analysis_servicer` (`test_analysis_servicer.py:63`, a `MagicMock` ctx whose `abort` raises `Exception("aborted")`, so `ctx.set_trailing_metadata` auto-exists and is assertable), `_UNKNOWN_MSG` `:45`, `_SID = "fundamentals_macd_blend"` `:44`; existing tests to extend: `test_all_excluded_clears_grade_and_score_strategy_names_schd` (`:140`) and `test_pit_outage_raises_and_score_strategy_aborts_unavailable` (`:196`). `SCHD_PIT_PERIODS = []` (`tests/conftest.py:116`, i.e. no fundamentals) and `AAPL_PIT_PERIODS` (`:117`).
- Production wiring to reproduce: `app/main.py:107` `grpc_server = grpc.aio.server(interceptors=server_interceptors())`; `app/telemetry.py` `server_interceptors()` returns `[_CancelStatusInterceptor()]` only when `OTEL_ENABLED=true` (`_enabled()` at `telemetry.py:20-21`); `init_telemetry()` installs `GrpcAioInstrumentorServer().instrument()` (`telemetry.py:206`). Model for an in-process aio server: `tests/test_telemetry.py:365-387` `_serve_sleeper`.
- The `otel_reset` fixture stubs the instrumentor out (`tests/conftest.py:513`) — do **not** use it.
- Full RPC path: `/xstockstrat.analysis.v1.AnalysisService/ScoreStrategy` (`analysis.proto:3` package).
- Re-anchor every cited line in `test_grade_fundamentals_exclusion.py` by **symbol** at execute time (`_cell`, `_SID`, `_UNKNOWN_MSG`, `_wire`, `_blend_svc` drift as 215 edits the file).
- Trailer constants: **not found** — `_EXCLUDED_TRAILER_KEY` / `_EXCLUDED_TRAILER_MAX_BYTES` are created in Step 4.

**TDD**: `red-green required` — RED: `set_trailing_metadata` never called / `ImportError` on `_EXCLUDED_TRAILER_KEY`.

**Covers**: `AC-2, AC-3, AC-4, AC-7, AC-8`

**Instructions**:
1. In `tests/test_grade_fundamentals_exclusion.py` import `_EXCLUDED_TRAILER_KEY` and `_EXCLUDED_TRAILER_MAX_BYTES` from `app.handlers.servicer`, and add a test that also asserts the literal `_EXCLUDED_TRAILER_KEY == "x-score-excluded-symbols"` (the agent suite asserts the same literal in Step 1).
2. Add success-path tests calling `await svc.ScoreStrategy(analysis_pb2.ScoreStrategyRequest(strategy_id=_SID), ctx)` with `ctx = _owned_ctx()`:
   - **AC-7**: `_blend_svc([_cell("AAPL", trades=3), _cell("MSFT", trades=3), _cell("SCHD")], pit={"AAPL": AAPL_PIT_PERIODS, "MSFT": AAPL_PIT_PERIODS, "SCHD": SCHD_PIT_PERIODS})` → `resp.evidence_symbols == 2` and `ctx.set_trailing_metadata.assert_called_once_with(((_EXCLUDED_TRAILER_KEY, '["SCHD"]'),))`.
   - **none excluded**: `_blend_svc([_cell("AAPL", trades=3)])` → trailer value is exactly `"[]"` (non-empty, so present-and-empty is distinguishable from absent).
   - **sorted + deduped is pinned**: two refused symbols fed in reverse order (`_cell("SCHD")`, `_cell("QQQ")`, with `SCHD_PIT_PERIODS` for both) plus a duplicate-window `SCHD` cell → `'["QQQ","SCHD"]'`.
   - **oversize → no trailer + WARN**: `monkeypatch.setattr("app.handlers.servicer._EXCLUDED_TRAILER_MAX_BYTES", 5)` with one excluded symbol → the call still returns the score, `ctx.set_trailing_metadata.assert_not_called()`, and a WARNING record is logged (`caplog`).
3. Abort paths never set the trailer (and write nothing):
   - extend `test_pit_outage_raises_and_score_strategy_aborts_unavailable` (**AC-4**): after the existing abort assertion, `ctx.set_trailing_metadata.assert_not_called()` and `svc._scores_repo.upsert.assert_not_awaited()` / `svc._scores_repo.delete.assert_not_awaited()`.
   - extend `test_all_excluded_clears_grade_and_score_strategy_names_schd` (**AC-8**): `ctx.set_trailing_metadata.assert_not_called()`; message contains `"all evidence symbols excluded (fundamentals unavailable: SCHD)"`.
   - new **AC-3** test: `_blend_svc([])` → abort `(NOT_FOUND, "no eligible evidence — run a backtest")`, `svc._scores_repo.delete.assert_awaited_with("u1", _SID)`, no trailer.
   - new **AC-2** test: `svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=None)` → abort `(PERMISSION_DENIED, "strategy not found or not owned")`, no trailer, `upsert`/`delete` not awaited.
4. Create `tests/test_score_trailer_loopback.py` (the **server-half production-wiring loopback**; this is the design's first-step gate for analysis):
   - 0. Read the installed `opentelemetry.instrumentation.grpc` (as in Step 1 sub-step 0): confirm `GrpcAioInstrumentorServer` has `uninstrument()` and that instrumenting must happen **before** `grpc.aio.server(...)` is constructed.
   - fixture: `monkeypatch.setenv("OTEL_ENABLED", "true")`; `inst = GrpcAioInstrumentorServer(); inst.instrument()`; yield; `inst.uninstrument()`. No `otel_reset`.
   - build the real servicer with `_blend_svc(...)`, `server = grpc.aio.server(interceptors=server_interceptors())` (this contains `_CancelStatusInterceptor`), `analysis_pb2_grpc.add_AnalysisServiceServicer_to_server(svc, server)`, `port = server.add_insecure_port("127.0.0.1:0")`, `await server.start()`, `await server.stop(0)` in a `finally`.
   - client: raw `grpc.aio.insecure_channel`, `call = channel.unary_unary("/xstockstrat.analysis.v1.AnalysisService/ScoreStrategy", request_serializer=analysis_pb2.ScoreStrategyRequest.SerializeToString, response_deserializer=analysis_pb2.StrategyScore.FromString)(req, metadata=[("x-user-id", "u1"), ("x-access-scope", "7"), ("x-trace-id", "t1")])`; `await call`; `md = await call.trailing_metadata()`.
   - assert: (a) populated list arrives as `'["SCHD"]'`; (b) none excluded arrives as the present value `"[]"`; (c) an aborted call (all excluded) raises `grpc.aio.AioRpcError` NOT_FOUND whose `trailing_metadata()` has no `x-score-excluded-symbols`.
   - Comment (≤2 lines) at the top: why the instrumentor + `server_interceptors()` are installed (green without them does not prove production delivers the trailer).
5. **Gate semantics** are in Step 4.

**Verification**:
```bash
cd services/xstockstrat-analysis && uv sync --extra dev && uv run pytest tests/test_grade_fundamentals_exclusion.py tests/test_score_trailer_loopback.py -q   # RED now
cd services/xstockstrat-analysis && uv run pytest --cov=app --cov-fail-under=40 -q   # CI threshold (analysis: 40%); expected red now, green after Step 4
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
cd services/xstockstrat-analysis && grep -n "from tests\.\|_blend_svc" tests/test_score_trailer_loopback.py   # C-13: imports the existing helper, no second copy of the fixture
```
C-13 verdict: `_blend_svc`/`_cell` already live in `test_grade_fundamentals_exclusion.py` and are imported cross-test elsewhere (`test_grade_fundamentals_exclusion.py:25-37` imports from `tests.test_analysis_servicer`); the loopback file imports them rather than copying (single definition site).

---

### Step 4 — service: analysis `ScoreStrategy` sets the excluded-symbols trailer (go/no-go gate: server half)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `servicer.py:17` `import json` already imported; `:95` `log = logging.getLogger(__name__)`; module constants block `:293-349` (e.g. `_INTERACTIVE_DERIVATION_CONCURRENCY = 4` at `:311`).
- `:2595` `excluded: list[str] = []` is passed as `excluded=excluded` to `_fetch_and_aggregate` (`:2598-2603`) and filled once by `excluded.extend(dropped)` (`:2852-2853`); sorted/deduped at `:2798`. Every abort returns earlier (`:2583-2635`); `return score` is `:2662`, after `_persist_strategy_score` (`:2637`) and the best-effort ledger emit.
- `owner_scoped` (`:477-489`) calls `fn(self, request, context)` unchanged and `_CancelStatusInterceptor` wraps `behavior(request_or_iterator, context)` unchanged (`app/telemetry.py:134-136`), so `context.set_trailing_metadata` reaches the real context.
- Decision (design § Rejected Alternatives): no `try/except` around `set_trailing_metadata` (validation happens after return; it could never fire), no truncation, no re-sort.

**TDD**: `red-green required` (paired test: Step 3)

**Covers**: —

**Instructions**:
1. Add constants to the module constants block: `_EXCLUDED_TRAILER_KEY = "x-score-excluded-symbols"` and `_EXCLUDED_TRAILER_MAX_BYTES = 4096`, with a ≤2-line comment naming the constraint: the agent's `client._EXCLUDED_TRAILER_KEY` must stay in step, and a value above the cap is omitted (never truncated) so the agent reads `null`. They are wire constants, not config (F-07 not engaged).
2. Immediately before `return score` in `ScoreStrategy` (after the ledger emit try/except), add: `encoded = json.dumps(excluded, separators=(",", ":"))`; if `len(encoded.encode("utf-8")) > _EXCLUDED_TRAILER_MAX_BYTES`: `log.warning("score: excluded-symbols trailer omitted (%d bytes > cap) for %s", ...)`, else `context.set_trailing_metadata(((_EXCLUDED_TRAILER_KEY, encoded),))`. `json.dumps` default `ensure_ascii=True` keeps the value ASCII as gRPC metadata requires. `"[]"` is sent when nothing was excluded.
3. Do not touch any abort path, `_fetch_and_aggregate`, `_exclude_refused_cells`, the grade maths or the proto. Do not set the trailer from `RunBacktest`/`ManageStrategy`.
4. **Gate.** Run Step 3's loopback. Green ⇒ the trailer survives `owner_scoped`, `_CancelStatusInterceptor` and `GrpcAioInstrumentorServer`. If the unit tests are green but the **wire** case is red with the key absent, an interceptor/instrumentor is dropping it: record the evidence in `context.md` and stop; FR-5 returns to the operator (no proto field is adopted automatically).

**Verification**:
```bash
cd services/xstockstrat-analysis && uv run pytest tests/test_grade_fundamentals_exclusion.py tests/test_score_trailer_loopback.py tests/test_analysis_servicer.py -q   # GREEN
cd services/xstockstrat-analysis && uv run pytest --cov=app --cov-fail-under=40 -q   # CI threshold (analysis: 40%)
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
git diff --stat -- packages/proto   # empty: no proto change
```

---

### Step 5 — test: agent tool + client unit tests and tool-deadline guards for `score` (RED)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tools.py` — modify (new class `TestManageStrategyScore`)
- `services/xstockstrat-agent/tests/test_client.py` — modify (new class `TestScoreStrategyClient`)
- `services/xstockstrat-agent/tests/test_tool_deadlines.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- Tool-test pattern: `tests/test_tools.py:23` `_make_server()` / `:29` `_tool_fn(server, name)`; `class TestManageStrategyTool` at `:937`; `patch.object(client, "manage_strategy", AsyncMock(...))` with `_ctx(ADMIN)` (`tests/conftest.py`, `ADMIN` ⇒ `user_id "u-1"`); error mapping precedent `test_grpc_error_reraised_as_clear_message` (`:1215`) using `_rpc_error(code, details)` (`tests/test_tools.py:931`); description assertions `server._tool_manager.get_tool("manage_strategy").description` (`:1106`) and `.parameters["properties"]` (`:1083`). Re-anchor by symbol at execute time (lines drift as 215/275/281 land).
- Client-test pattern: `tests/test_client.py:74-78` `_channel_cm()`, `:81` `class TestManageStrategyClient`, `:175` the bogus-operation `ValueError` test; `get_strategy` mock pattern `mock_stub.GetStrategy = AsyncMock(return_value=...)` (`:777`).
- Fake call object required by the call-object form: **not found** in `test_client.py` (all existing stubs are `AsyncMock(return_value=resp)`); a small awaitable with `trailing_metadata()` is new and has one consumer here (C-13: inline).
- `tests/test_tool_deadlines.py:23` `_LONG_TOOLS = {"run_backtest", "screen_symbols", "trigger_backfill", "run_fundamentals_scan"}`; `:24` `_MUTATING_PREFIXES`; `:19`/`:21` `_LONG_S`/`_SLACK_S`; `:51` `patched_budgets`; `:63` `_timed_error`; `:70` `test_ac1_get_positions_hung_portfolio_surfaces_deadline`; `:274` `test_fr3_worst_cases_fit_under_57s`; `:281` `_mapper_calls` (innermost-function attribution of each `_grpc_error_message` call); `:38` `_tool`; `:16` imports `ADMIN`, `_ctx`, `HANG_GUARD_S`; `hung_backend` fixture at `tests/conftest.py:146`.

**TDD**: `red-green required` — RED now: the tool tests (AC-1/2/3/4/5/7/8/9) and the tool-deadline guard fail because `manage_strategy` has no `score` branch and `_score_strategy` does not exist (`long_seen != _LONG_TOOLS`); GREEN after Step 6. The `TestScoreStrategyClient` cases already go green with Step 2 (they cover `client.score_strategy`, which exists by then); only the tool-level cases carry the RED for Step 6.

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5, AC-7, AC-8, AC-9, AC-11`

**Instructions**:
1. `TestManageStrategyScore` in `tests/test_tools.py` (scenario literals are single-consumer, inline per C-13), all patching `client.score_strategy` with `AsyncMock`:
   - **AC-1**: returns `{"strategy_id": "fundamentals_macd_blend", "overall_score": 0.71, "component_scores": {...}, "rating": "B", "evidence_symbols": 3, "evidence_days": 756, "provisional": False, "excluded_symbols": []}` unchanged; `m.assert_awaited_once_with(user_id="u-1", strategy_id="fundamentals_macd_blend")`; no `access_scope` kwarg; result keys all snake_case.
   - **AC-7**: the mocked client returns `{"evidence_symbols": 2, "excluded_symbols": ["SCHD"], ...}`; the tool returns it unchanged (the tool layer adds no re-derivation or filtering of `excluded_symbols`).
   - **AC-2**: `AioRpcError(PERMISSION_DENIED, details="strategy not found or not owned")` → `RuntimeError` matching that text.
   - **AC-3**: `AioRpcError(NOT_FOUND, details="no eligible evidence — run a backtest")` → message contains `no eligible evidence — run a backtest` (proves the server detail is not replaced by the fixed `"strategy not found"`).
   - **AC-4**: `AioRpcError(UNAVAILABLE, details="fundamentals availability unknown — grade unchanged")` → message contains exactly that text.
   - **AC-8**: `AioRpcError(NOT_FOUND, details="no eligible evidence — all evidence symbols excluded (fundamentals unavailable: SCHD)")` → message contains `all evidence symbols excluded (fundamentals unavailable: SCHD)`.
   - **AC-9**: (i) the AC's own example: `cooldown_days=45, clear_fields=["exit_rule"]` → `ValueError` matching `accepts only strategy_id` and naming both, `m.assert_not_awaited()`; (ii) `clear_fields=[]` alone is rejected; (iii) **signature-driven backstop**: `inspect.signature(manage_strategy_fn)` minus `ctx`/`operation`/`strategy_id` → for each remaining parameter pass a non-None sample value and assert `ValueError` (so a future definition argument that is not added to the Step 6 `given` list fails here).
   - **AC-5**: `description = " ".join(get_tool("manage_strategy").description.split())` contains `analysis.strategy.scored`, `persists`, and an `ignored` clause about the time range, and the `operation:` line lists `'score'`.
   - 215-era `update`/`register` tests in the same file must still pass untouched (PRESERVE `@feature-149`).
2. `TestScoreStrategyClient` in `tests/test_client.py`: with `patch("app.client.mtls")` + `_channel_cm()` and `mock_stub.ScoreStrategy = MagicMock(return_value=fake_call)` where `fake_call` is an awaitable (`__await__` returning a `StrategyScore`) exposing `async def trailing_metadata()`:
   - trailer present (`grpc.aio.Metadata(("x-score-excluded-symbols", '["SCHD"]'))`) → `excluded_symbols == ["SCHD"]`;
   - `trailing_metadata()` returns `None` (what a swallowing wrapper would produce) → `excluded_symbols is None` + one WARN (**AC-11**, unit half);
   - request carries `strategy_id` and **no** `range`; metadata contains `("x-user-id", "u-owner")`; `timeout == client._LONG_RPC_TIMEOUT_S` (`call_args.kwargs`);
   - the unknown-operation test at `test_client.py:175` additionally asserts the new message mentions `'score' is routed to ScoreStrategy`.

3. `tests/test_tool_deadlines.py` add `"_score_strategy"` to `_LONG_TOOLS` (`:23`) and `"_score_"` to `_MUTATING_PREFIXES` (`:24-35`) — RED: `test_every_catch_site_passes_deadline_s` reports `long_seen != _LONG_TOOLS` until Step 6 adds the helper. Add a tool-level test modelled on `test_ac1_get_positions_hung_portfolio_surfaces_deadline` (`:70-78`): `hung_backend("ANALYSIS_ENDPOINT")` with `patched_budgets`, `_timed_error(_tool("manage_strategy")(_ctx(ADMIN), operation="score", strategy_id="s"))` → message contains `within 0.6s (deadline exceeded)` and `outcome unknown, verify before retrying`, `elapsed < _LONG_S + _SLACK_S`, `handle.entered == 1` (RED now: the unknown-operation `ValueError` fires instead). `test_fr3_worst_cases_fit_under_57s` stays unchanged and green (PRESERVE `@AC-6 @feature-273`).

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest tests/test_tools.py tests/test_client.py tests/test_tool_deadlines.py -q   # RED now (tool-level cases + deadline guard); GREEN after Step 6
cd services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40 -q   # CI threshold (agent: 40%); run after Step 6
cd services/xstockstrat-agent && ruff check . && ruff format --check .
cd services/xstockstrat-agent && grep -rn "def _rpc_error" tests/   # C-13: reuse tests/test_tools.py:931, no new copy introduced
```

---

### Step 6 — service: agent `manage_strategy operation='score'`

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- `tools.py:12` module-docstring line `manage_strategy     — register/update/deactivate/reactivate stored strategies (update = merge)`; `:908` `async def manage_strategy(`; `:924-925` docstring opens `"""Register/update/deactivate/reactivate a stored strategy in xstockstrat-analysis.` / `operation: 'register' | 'update' | 'deactivate' | 'reactivate'.`; `:1031-1033` the `RESPONSE CASING` paragraph ends the docstring; `:1039-1042` dict-rule `json.dumps`; `:1044` `supplied = {`; `:1079-1094` identity resolution, `client.manage_strategy(...)` call and the `_grpc_error_message(..., not_found="strategy not found", deadline_s=client._RPC_TIMEOUT_S, write=True)` catch.
- `tools.py:155` `def _caller_user_id(ctx, tool)`; `:223-252` `_grpc_error_message`: NOT_FOUND returns the fixed `not_found` string (`:244-245`), PERMISSION_DENIED returns `exc.details() or "permission denied"` (`:248-249`), UNAVAILABLE falls through to `exc.details() or str(code)` (`:252`), DEADLINE_EXCEEDED builds the "upstream did not respond within …s (deadline exceeded); outcome unknown, verify before retrying" text when `write=True`.
- Existing module-level helper precedent: `tools._write_source_bearer` (referenced by `tests/test_tool_deadlines.py`), i.e. tools may delegate to module-level `async def` helpers with their own catch site.
- Deadline AST guard attributes each `_grpc_error_message` call to its **innermost enclosing function** (`tests/test_tool_deadlines.py:_mapper_calls`), so a separate `_score_strategy` helper is what lets `manage_strategy` keep `client._RPC_TIMEOUT_S` while `score` gets `client._LONG_RPC_TIMEOUT_S`.
- `manage_strategy` accepts `components: list[dict] | None` … `clear_fields: list[str] | None` (`tools.py:908-923`): ten definition arguments (`display_name` … `sector_param_overrides`) plus `clear_fields`.

**TDD**: `red-green required` (paired test: Step 5)

**Covers**: —

**Instructions**:
1. **Helper.** After `_grpc_error_message` (`tools.py:252`) and before `_EXTRACTOR_TOOL_MAP`, add `async def _score_strategy(ctx: Context, strategy_id: str) -> dict`: `user_id = _caller_user_id(ctx, "manage_strategy")`; `try: return await client.score_strategy(user_id=user_id, strategy_id=strategy_id)`; `except grpc.aio.AioRpcError as e: raise RuntimeError(_grpc_error_message(e, not_found=e.details() or "no eligible evidence", deadline_s=client._LONG_RPC_TIMEOUT_S, write=True)) from e`. The shared mapper is **not** edited (NOT_FOUND detail passthrough is the call-site's `not_found=`). Owner-scoped via the forwarded `x-user-id`; no admin gate, no `_caller_access_scope`.
2. **Branch.** In `manage_strategy`, make the first statement after the docstring (above the `isinstance(entry_rule, dict)` serialization at `:1039`): `if operation == "score":` build `given = [name for name, value in (("display_name", display_name), ("components", components), ("entry_rule", entry_rule), ("exit_rule", exit_rule), ("signal_params", signal_params), ("cooldown_days", cooldown_days), ("exit_cooldown_days", exit_cooldown_days), ("denied_symbols", denied_symbols), ("signal_eligible", signal_eligible), ("sector_param_overrides", sector_param_overrides), ("clear_fields", clear_fields)) if value is not None]`; if `given`: `raise ValueError(f"manage_strategy(operation='score') accepts only strategy_id; got: {', '.join(given)}")` — this fires before identity resolution or any client call, and a `clear_fields=[]` still counts (AC-9). Otherwise `return await _score_strategy(ctx, strategy_id)`. (The name list is duplicated from `supplied` on purpose to keep this branch first and out of the 215/275/281 merge region; Step 5's AC-9 backstop drives it from `inspect.signature` so a future argument cannot slip through.)
3. **Docstring.** Edit only these parts: summary line `Register/update/deactivate/reactivate/score a stored strategy in xstockstrat-analysis.`; `operation: 'register' | 'update' | 'deactivate' | 'reactivate' | 'score'.`; and append a `SCORE (feature 283)` paragraph before the `RESPONSE CASING` paragraph stating, in prose a client can read: `operation='score'` takes **only** `strategy_id` (any other argument is rejected before any call); it recomputes **and persists** the strategy's headline grade and emits an `analysis.strategy.scored` ledger event; any time range is **ignored** (the whole eligible evidence base is used); it returns snake_case `strategy_id, overall_score, component_scores, rating, evidence_symbols (int count), evidence_days, provisional, origin (when set), excluded_symbols`; `excluded_symbols` lists the symbols left with **no surviving evidence cell**, is `[]` when the strategy is not fundamentals-guarded or `analysis.backtest.fundamentals.enabled` is off (so `[]` does not mean "the guard ran and found nothing"), and is `null` when analysis did not report it; errors: `PERMISSION_DENIED` (not owned/missing), `NOT_FOUND` (no eligible evidence — the stale grade is cleared; includes the "all evidence symbols excluded (fundamentals unavailable: …)" variant), `UNAVAILABLE` (store down, or fundamentals availability unknown with the grade unchanged); a deadline means the outcome is unknown — verify with `list_strategies` (do not claim an atomic refresh). Also amend the `RESPONSE CASING` paragraph with one clause: `score` returns snake_case, unlike the other operations.
4. Update the module docstring line `tools.py:12` to `…register/update/deactivate/reactivate stored strategies; score = manual headline-grade refresh (update = merge)`. Do **not** change the tool count text (`tools.py:54` "forty-five" stays).
5. Do not change `supplied`/`mask`/`update_mask`, the `update` empty-mask guard, or the `client.manage_strategy` call.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest tests/test_tools.py tests/test_tool_deadlines.py tests/test_tools_endpoint.py -q   # Step 5's tests now GREEN (tool cases, `_LONG_TOOLS` guard, hung-backend case) and existing suites unchanged
cd services/xstockstrat-agent && grep -n "operation == \"score\"\|_score_strategy\|client._LONG_RPC_TIMEOUT_S" app/tools.py
cd services/xstockstrat-agent && ruff check . && ruff format --check .
```

---

### Step 7 — test: deadline guards, call-object matcher and the 273 durable row

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_client_deadlines.py` — modify
- `services/xstockstrat-agent/acceptance/fix-agent-client-deadlines.feature` — modify (one Examples row; operator-signed-off EXTEND of `@AC-5 @feature-273`)

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- `tests/test_tool_deadlines.py:274` `test_fr3_worst_cases_fit_under_57s` (`auth + _LONG_RPC_TIMEOUT_S <= 57`: 10 + 45 = 55) is a PRESERVE re-run in this step's Verification; the `_LONG_TOOLS` / `_MUTATING_PREFIXES` edits and the tool-level hung-backend case live in Step 5.
- `tests/test_client_deadlines.py:20-45` `_AC5_ROWS` (last row `("TriggerBackfill", "INGEST_ENDPOINT", lambda: client.trigger_backfill(["AAPL"]), _LONG)` at `:44`); `:48` `_LONG_RPCS = {"RunBacktest", "ScreenSymbols", "RunFundamentalsScan", "TriggerBackfill"}`; `:54` `_MIN_STUB_CALLS = 73`; `:109-124` `_stub_calls()` matches only `ast.Await(Call(Attribute))` with receiver `Name('stub')` or a `Call`; `:127-` `test_ac10_every_unary_stub_call_carries_a_deadline` asserts `len(calls) >= _MIN_STUB_CALLS` and `long_rpcs == _LONG_RPCS`.
- Measured matcher counts on `app/client.py` (AST walk of every top-level function): awaited-only = **73**; every `ast.Call` on `stub`/`Call` receiver = **82** (9 non-RPC calls such as `.isoformat()`, `.lower()`, `.upper()`, `.strip()`, `.astimezone()` on a constructed object); non-awaited calls whose receiver is `Name('stub')` = **0** today.
- `fix-agent-client-deadlines.feature:37-53` `@AC-5 … @feature-273` Scenario Outline Examples; the last row is `| TriggerBackfill     | 45.5   |` at `:53`.

**TDD**: `red-green required`

**Covers**: — (C-16 preservation/extension of `@AC-5`, `@AC-6`, `@AC-10 @feature-273`; no 283 `@AC-*` is verified here)

**Instructions**:
1. `test_client_deadlines.py` — **RED first**: set `_MIN_STUB_CALLS = 74` and run: it fails (matcher still sees 73, because `call = stub.ScoreStrategy(...)` is invisible to an `ast.Await`-only matcher). Then extend `_stub_calls` with exactly one added branch: when `node` is an `ast.Assign` whose `value` is an `ast.Call` with `func` an `ast.Attribute` whose `value` is `ast.Name` with `id == "stub"`, yield `(fn.name, node.value.func.attr, node.value)`. **Do not** match bare `ast.Call` nodes (that counts 82 + 1 and sweeps in non-RPC calls); the `Await` branch is unchanged so awaited calls are still counted once. Re-run: count is exactly 74 → green. Record both runs (73→red, 74→green) in `context.md`.
2. Add `"ScoreStrategy"` to `_LONG_RPCS` (`:48`) and a row to `_AC5_ROWS` (`:20-45`): `("ScoreStrategy", "ANALYSIS_ENDPOINT", lambda: client.score_strategy("u-1", "s-1"), _LONG)`. The fake-channel row (`test_ac5_listed_rpcs_pass_the_production_budget_kwarg`, `:81`) uses `AsyncMock(side_effect=_Recorded)`: `call = stub.ScoreStrategy(...)` returns a coroutine and `await call` raises `_Recorded` before `trailing_metadata()` is reached, so no mock change is needed — verify it passes rather than assuming. **Which edits carry the RED:** the `_MIN_STUB_CALLS = 74` bump (red until the matcher is extended) and adding `"ScoreStrategy"` to `_LONG_RPCS` (red until the matcher sees the call-object form: `long_rpcs != _LONG_RPCS`); the `_AC5_ROWS` tuple and the feature-file row go green immediately and are guarded by the parametrised AC-5 tests and the final grep.
3. `acceptance/fix-agent-client-deadlines.feature`: append `      | ScoreStrategy       | 45.5   |` after the `TriggerBackfill` row (`:53`), column-aligned with the table. This is the signed-off EXTEND of `@AC-5 @feature-273`; keep it in the same commit as the `_AC5_ROWS` tuple.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest tests/test_tool_deadlines.py tests/test_client_deadlines.py -q   # GREEN (ScoreStrategy row parametrised in the AC-5 test)
cd services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40 -q   # CI threshold (agent: 40%)
cd services/xstockstrat-agent && grep -n "ScoreStrategy" tests/test_client_deadlines.py acceptance/fix-agent-client-deadlines.feature   # row present in test tuple and feature file
cd services/xstockstrat-agent && ruff check . && ruff format --check .
```

---

### Step 8 — test: descriptor + operations-set parity guard, with the runbook and strat-lab skill edits it forces

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_score_strategy_parity.py` — create
- `docs/runbooks/mcp-tools.md` — modify (`### \`manage_strategy\``)
- `plugins/strat-lab/skills/backtest/SKILL.md` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- Descriptor-parity model: `tests/test_backtest_view.py:203` `test_summary_key_set_covers_every_proto_field` (`analysis_pb2.BacktestResult.DESCRIPTOR.fields_by_name`, in-function stub import per AGENT-2) and `tests/test_strategy_builders.py:115`; ledger `insights.md:440-443` / `fails.md:306-309` (hand-written MCP prose drifts from `client.py`/protos ⇒ executable parity, not prose).
- Enum source: `analysis_pb2.StrategyOperation` (`STRATEGY_OPERATION_REGISTER/UPDATE/DEACTIVATE/REACTIVATE` used in `client.py:932-937`; zero value `UNSPECIFIED`).
- Runbook anchors: heading `### \`manage_strategy\`` at `docs/runbooks/mcp-tools.md:490` (required by `tests/test_tools_endpoint.py:100-103`); the `| \`operation\` | \`string\` | Yes | \`"register"\`, \`"update"\`, \`"deactivate"\`, or \`"reactivate"\` |` parameter row; the "Effect on the derived grade" paragraph and `**Errors**` table close the section; the section header text says **Admin-scoped write** (stale since feature 133 — the new `score` text must state owner-scoped).
- Skill anchors: `plugins/strat-lab/skills/backtest/SKILL.md:15` Scope paragraph (tool list), `:21` Ownership paragraph, `:54` "Mutation guard" paragraph.
- Existing docs guard that must stay green: `tests/test_tools.py:1101` `test_docs_surfaces_state_rule_string_or_object` (`@AC-5 @FR-4 @feature-149`) and the count guard `tests/test_tools_endpoint.py:106-122`.
- `FieldDescriptor.has_presence` availability: confirm against the locked protobuf (`services/xstockstrat-agent/uv.lock`, `name = "protobuf"`) before using it; fall back to `field.message_type is not None or field.containing_oneof` if absent.
- Strat-lab plugin rules: `docs/patterns/strat-lab-plugin.md` (same-PR rule; validator `python3 plugins/strat-lab/scripts/validate.py`); manifests `plugins/strat-lab/.claude-plugin/plugin.json` and `.cursor-plugin/plugin.json` both `"version": "0.4.0"` (no version bump is made — nothing in the guard rail requires one; if bumped, both stay byte-identical).

**TDD**: `red-green required` — RED: the operations-set assertions fail on the runbook and `SKILL.md` surfaces because neither lists `score` yet; GREEN after the docs edits below. **Which surfaces carry the RED:** the runbook and `SKILL.md` assertions (neither lists `score` until this step's edits); the docstring surface is already green after Step 6 and carries no RED of its own (P-06). `AC-6` is a PRESERVE of the existing count guard and has no RED by design.

**Covers**: `AC-6, AC-10`

**Instructions**:
1. Write `tests/test_score_strategy_parity.py` **first** and run it RED. Locate everything by **regex markers, never by line numbers** (rebases from 215/275/281 will move them):
   - `test_score_projection_covers_every_proto_field`: call `client.score_strategy` with a mocked stub/fake call (as in Step 5) returning a `StrategyScore` with every non-presence field set to a non-default value; assert `set(result) - {"excluded_symbols"}` equals `{f.name for f in StrategyScore.DESCRIPTOR.fields if not f.has_presence}`, and pin the opt-out: `{f.name for f in DESCRIPTOR.fields if f.has_presence} == {"origin"}` (a new optional/message field fails until accounted for — `origin` is absent when unset). `excluded_symbols` is the only non-proto key.
   - `test_operation_sets_match_the_enum_on_every_surface`: `expected = {name.removeprefix("STRATEGY_OPERATION_").lower() for name in analysis_pb2.StrategyOperation.keys() if not name.endswith("_UNSPECIFIED")} | {"score"}`. Parse and compare **sets** (not exact strings): (a) the tool description's first line (`^(.+?) a stored strategy`, split on `/`, lower-cased) and its `operation:` line (quoted tokens); (b) the `| \`operation\` |` row inside the `### \`manage_strategy\`` section of `docs/runbooks/mcp-tools.md` (section = from that heading to the next `### `; tokens are the `"…"` literals); (c) a new canonical line in `plugins/strat-lab/skills/backtest/SKILL.md` matching `` `manage_strategy` operations: `register` | `update` | `deactivate` | `reactivate` | `score` `` (regex over backticked tokens). Each parsed set must equal `expected`.
   - `test_score_side_effects_are_documented_on_runbook_and_skill` (**AC-10**): the runbook section and `SKILL.md` each contain `analysis.strategy.scored`, a "persists" statement and an "ignored" time-range statement for `score`.
   - (The unknown-operation error text is asserted once, in Step 5's extension of `tests/test_client.py:175`; no duplicate here, C-18.)
2. Runbook (`docs/runbooks/mcp-tools.md`, only inside `### \`manage_strategy\``): add `"score"` to the `operation` row and its description; add a `**`score` (feature 283)**` block after the "Effect on the derived grade" paragraph covering: owner-scoped (`x-user-id`; not admin-gated), `strategy_id` only (other arguments rejected client-side), persists the grade + emits `analysis.strategy.scored`, time range ignored, snake_case return table (`strategy_id, overall_score, component_scores, rating, evidence_symbols (count), evidence_days, provisional, origin, excluded_symbols`), `excluded_symbols` semantics (`[]` / `null` / non-empty, same wording as the Step 6 docstring), a `Return` example, the 45 s budget and the worst-case bound `ceil(symbols/4) × 8 pages × 10 s` (`_FUND_PAGE_TIMEOUT_SECONDS`, `_MAX_FUND_PAGES`, `_INTERACTIVE_DERIVATION_CONCURRENCY` in `servicer.py:305-311`) with "a deadline before persist leaves the grade unchanged; verify with `list_strategies`", and add the `score` rows to the section's **Errors** table (PERMISSION_DENIED, both NOT_FOUND variants with the stale grade cleared, UNAVAILABLE variants). The section's opening sentence still says "**Admin-scoped write**" (stale since feature 133, per agent `CLAUDE.md:125`); leave it alone (not this feature's change) and have the `score` block say "owner-scoped, not admin-gated" explicitly — log the pre-existing drift in `context.md` for the findings log. Do not edit other tools' sections or the `forty-five` count text.
3. `SKILL.md`: add the canonical `` `manage_strategy` operations: … `score` `` line (e.g. in the Scope paragraph at `:15`), add `score` to the Ownership paragraph's list of ownership-gated operations (`:21`), and add a short "Refreshing the grade" paragraph near the Mutation guard: `manage_strategy(operation="score", strategy_id=...)` persists the grade, emits `analysis.strategy.scored`, ignores any range, returns `excluded_symbols` (`null` = analysis did not report; `[]` ≠ "the guard ran and found nothing"), and clears a stale grade with NOT_FOUND when no evidence is eligible. Keep the frontmatter untouched (an unquoted `: ` in frontmatter silently drops every field — `docs/patterns/strat-lab-plugin.md`).
4. Run the suite GREEN.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest tests/test_score_strategy_parity.py -q   # RED before edits (runbook + SKILL.md lack 'score'; docstring surface is green after Step 6), GREEN after
cd services/xstockstrat-agent && uv run pytest tests/test_tools_endpoint.py tests/test_tools.py -q   # AC-6 count guard (45) + feature-149 docs guard stay green
cd services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40 -q   # CI threshold (agent: 40%)
cd services/xstockstrat-agent && ruff check . && ruff format --check .
python3 plugins/strat-lab/scripts/validate.py --self-test && python3 plugins/strat-lab/scripts/validate.py
```

---

### Step 9 — docs: service CLAUDE.md files and scoring doc

**Status**: `pending`
**Service**: `docs` (`services/xstockstrat-agent/CLAUDE.md`, `services/xstockstrat-analysis/CLAUDE.md`, `services/xstockstrat-analysis/docs/scoring.md`)
**Files**:
- `services/xstockstrat-agent/CLAUDE.md` — modify
- `services/xstockstrat-analysis/CLAUDE.md` — modify
- `services/xstockstrat-analysis/docs/scoring.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Agent `CLAUDE.md:61` tool-table row `| \`manage_strategy\` | Register/update/deactivate stored strategies (\`update\` is a **partial merge** — feature 070) |`; `:44` "registers forty-five tools" (unchanged); `:125` the "`manage_strategy` / `set_strategy_live` are now ownership-gated" paragraph.
- Analysis `CLAUDE.md:421` `### Fundamentals availability guard (feature 215)`; the **Evidence exclusion (H)** bullet at `:464-467` ("ScoreStrategy aborts UNAVAILABLE on UNKNOWN, and NOT_FOUND when every evidence symbol is excluded."); `:595` event table row `analysis.strategy.scored` | `ScoreStrategy` RPC only.
- `services/xstockstrat-analysis/docs/scoring.md:39-44` ScoreStrategy manual-refresh paragraph.
- Root `CLAUDE.md` How-to-Act #5: comments/docs state constraints, not mechanism or history; keep each addition to the minimum that prevents a silent break.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Agent `CLAUDE.md:61`: extend the row to `Register/update/deactivate/reactivate stored strategies (\`update\` is a **partial merge** — feature 070); \`operation='score'\` refreshes the headline grade (owner-scoped, feature 283)`. Add one short paragraph by `:125` naming the **trailer contract**: `score` reads gRPC trailer `x-score-excluded-symbols` (compact JSON array of strings) from analysis's `ScoreStrategy` via the call-object form; missing/unparseable ⇒ `excluded_symbols: null` + WARN; the key literal is asserted in both services' suites (`tests/test_score_trailer_loopback.py`); a second trailer would justify a `PLAT-*` row in `docs/context-constitution.md` (not added now — design § Rejected Alternatives).
2. Analysis `CLAUDE.md` § Fundamentals availability guard: one sentence on the **Evidence exclusion (H)** bullet — a successful `ScoreStrategy` sets trailing metadata `x-score-excluded-symbols` (JSON array of the symbols left with no surviving cell; `"[]"` when none or when the guard does not apply; omitted above 4096 bytes and on every abort path), consumed by the agent's `manage_strategy operation='score'`.
3. `docs/scoring.md:39-44`: one clause that the manual refresh is reachable via the agent tool and reports the excluded symbols through the trailer.
4. Do not touch `merge-order.md` (verified already correct), the root `CLAUDE.md`, or any tool-count statement.

**Verification**:
```bash
grep -n "x-score-excluded-symbols" services/xstockstrat-agent/CLAUDE.md services/xstockstrat-analysis/CLAUDE.md services/xstockstrat-analysis/docs/scoring.md   # contract named in each
grep -n "forty-five" services/xstockstrat-agent/CLAUDE.md   # count text unchanged
cd services/xstockstrat-agent && uv run pytest tests/test_tools_endpoint.py -q   # count surfaces still agree (AC-6)
```

---

### Step 10 — docs: root CLAUDE.md teardown and full-suite verification

**Status**: `pending`
**Service**: `docs`
**Files**:
- `docs/roadmap/features/283-expose-score-strategy-mcp/context.md` — modify (session log: loopback evidence, matcher counts, gate outcomes)
- `services/xstockstrat-agent/CLAUDE.md`, `services/xstockstrat-analysis/CLAUDE.md`, `services/xstockstrat-analysis/docs/scoring.md`, `docs/runbooks/mcp-tools.md`, `plugins/strat-lab/skills/backtest/SKILL.md` — modify **only if** the refresh/manual reconciliation reports drift (already edited in Steps 8-9; listed so a drift fix is not an unlisted-file edit, F-08)

**Reviewers**: none

**Codebase Evidence**:
- Root `CLAUDE.md` § Teardown: any session that changed a context file (`CLAUDE.md`, constitution/findings, or a doc in `.agents/context-forge.json` → `scrubberExtraTargets`) **or** behavior those files describe must run `/context-forge:context-constitution refresh`, scoped to what was touched, as the last step before pushing; if the plugin is unavailable, re-read every touched context file against the current code, reconcile drift, and record in the PR body **both** that the plugin was unavailable **and** the manual reconciliation performed — a bare "plugin unavailable" does not pass (`fails.md:670`; `fails.md` 2026-08-06 `fix-mcp-writepath-authz` — treat absence as a blocking gap, not a note).
- Context files touched by Steps 8-9: `services/xstockstrat-agent/CLAUDE.md`, `services/xstockstrat-analysis/CLAUDE.md`, `docs/runbooks/mcp-tools.md`, `plugins/strat-lab/skills/backtest/SKILL.md`, `services/xstockstrat-analysis/docs/scoring.md`.

**TDD**: `N/A (docs/process)`

**Covers**: —

**Instructions**:
1. Run `/context-forge:context-constitution refresh` scoped to the five files above; fix the grounded drift it reports. If the plugin is unavailable: re-read each of the five against the current code (`client.score_strategy`, the `score` branch, `_score_strategy`, the analysis trailer, `_EXCLUDED_TRAILER_*`), reconcile, and write both facts and the reconciliation list into the PR body.
2. Append the execution findings to `context.md`: Step 1/3 sub-step 0 findings (installed instrumentor source), the Step 2/4 gate outcomes, the Step 7 matcher counts (73 red → 74 green), and the pre-existing, unfixed divergence in the `score is None` branch (`servicer.py:2618` pops memory before `:2621` deletes in the DB; a server-side cancel between them can diverge).
3. Run the full affected suites once, as CI does.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest --cov=app --cov-fail-under=40 -q && ruff check . && ruff format --check .
cd services/xstockstrat-analysis && uv run pytest --cov=app --cov-fail-under=40 -q && ruff check . && ruff format --check .
python3 plugins/strat-lab/scripts/validate.py
git diff --stat -- packages/proto .do docker-compose.yml   # empty: no proto, no deploy/env change
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

- 2026-11-01 — re-spec (sdd-batch-execute, after merging `origin/main-dev`, already up to date): steps 1-10 re-verified against the current codebase; no blocking mismatch. Line anchors re-pointed in Steps 3, 5, 7, 8 and 9 (`test_tools.py` `_make_server`/`_tool_fn` :23/:29, description :1106, `.parameters` :1083, docs guard :1101, error-mapping test :1215; `test_pit_outage_…` :196; `test_ac5_listed_rpcs_…` :81; `SKILL.md` Scope :15; analysis `CLAUDE.md` Evidence exclusion (H) :464-467). Instructions, Files and Verification unchanged; symbols remain authoritative.
- 2026-11-01 — Step 3 (minor, within Files): the success-path "sorted + deduped" and "oversize" unit tests also carry an eligible `_cell("AAPL", trades=3)`, because ScoreStrategy only reaches `return score` (where the trailer is set) when at least one symbol is eligible; the server loopback's populated case uses `AAPL + SCHD`. The literal-key test also pins `_EXCLUDED_TRAILER_MAX_BYTES == 4096` (the Step 4 value). No CI-equivalent fallback was needed for this step (pytest + ruff ran natively); the analysis `.venv` resolves Python 3.12.3 (`.python-version` 3.12, `requires-python >=3.12`), not the root-table 3.13.
