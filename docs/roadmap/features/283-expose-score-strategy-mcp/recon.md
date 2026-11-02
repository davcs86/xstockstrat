# Recon: expose-score-strategy-mcp

**Created**: 2026-11-01
**From**: product-spec.md
**Affected services**: xstockstrat-agent, xstockstrat-analysis (only if the no-proto channel for `excluded` needs a servicer change)

---

## Objective

Expose `analysis.v1.AnalysisService/ScoreStrategy` through the MCP agent as `manage_strategy operation='score'` (tool count stays 45, `get_strategy` stays read-only), returning the `StrategyScore` in snake_case plus `excluded_symbols`. `excluded_symbols` must come from the `excluded` list the servicer already computes, with no new `StrategyScore` proto field (operator decision, option C). This unblocks 215 Step 26 (e).

## Codebase Map

- **`xstockstrat-analysis`** (Python)
  - Proto: `rpc ScoreStrategy(ScoreStrategyRequest) returns (StrategyScore)` — `packages/proto/analysis/v1/analysis.proto:14`; `ScoreStrategyRequest` (`strategy_id=1`, `range=2`) — `analysis.proto:244-247`; `StrategyScore` fields 1-8 (`strategy_id`, `overall_score`, `component_scores` map, `rating`, `evidence_symbols` int32, `evidence_days` int32, `provisional`, `origin`) — `analysis.proto:249-259`. No `excluded` field.
  - Handler: `@owner_scoped async def ScoreStrategy` — `services/xstockstrat-analysis/app/handlers/servicer.py:2565-2662`. `range` is ignored (docstring `:2572`).
    - Owner miss -> `PERMISSION_DENIED` "strategy not found or not owned" (`:2587-2592`, via `get_by_owner_and_id`).
    - `excluded: list[str] = []` is created and passed to `_fetch_and_aggregate(..., excluded=excluded)` (`:2595-2603`); populated by `excluded.extend(dropped)` (`:2852-2853`).
    - `_GradeInputsUnknown` -> `UNAVAILABLE` "fundamentals availability unknown — grade unchanged" (`:2604-2609`); class defined at `:273`.
    - Other read error -> `UNAVAILABLE` "evidence store unavailable" (`:2611-2613`).
    - `score is None` -> clear stale grade (delete failure -> `UNAVAILABLE` "score store unavailable", `:2624`), then `NOT_FOUND` "no eligible evidence — all evidence symbols excluded (fundamentals unavailable: …)" when `excluded` is non-empty (`:2626-2631`), else "no eligible evidence — run a backtest" (`:2633-2635`).
    - Success: `_persist_strategy_score`, best-effort `analysis.strategy.scored` emit, `return score` (`:2637-2662`). `excluded` is dropped here.
  - Last migration: none needed (no schema change). Highest on disk is `027_contract_owner_dimension`.
  - Config-read pattern: n/a (no new keys).
  - Existing tests: `services/xstockstrat-analysis/tests/test_grade_fundamentals_exclusion.py`, `tests/test_analysis_servicer.py` (ScoreStrategy cases); `real_pg`-marked suites via `uv run pytest -m real_pg`.
  - Docs: `services/xstockstrat-analysis/docs/scoring.md` (ScoreStrategy manual refresh), CLAUDE.md § Fundamentals availability guard.
- **`xstockstrat-agent`** (Python)
  - Tool: `manage_strategy` — `services/xstockstrat-agent/app/tools.py:907-1094`; args `operation: str, strategy_id: str` plus 11 optional definition args and `clear_fields` (`:908-923`). Docstring opens at `:924-925` (`operation: 'register' | 'update' | 'deactivate' | 'reactivate'`), ends `:1033` (RESPONSE CASING paragraph).
    - Builds `supplied`/`mask` (`:1043-1064`); only `update` is pre-validated (empty-mask guard `:1067-1075`).
    - Resolves `_caller_access_scope` / `_caller_user_id` (`:1079-1080`; `_caller_user_id` def `:155`) and calls `client.manage_strategy(...)` (`:1079-1088`).
    - Error mapping `_grpc_error_message(e, not_found="strategy not found", deadline_s=client._RPC_TIMEOUT_S, write=True)` (`:1089-1094`).
  - `_grpc_error_message` — `tools.py:223-252`: NOT_FOUND returns the fixed `not_found` arg and drops the server detail (`:244-245`); PERMISSION_DENIED returns `exc.details() or "permission denied"` (`:248-249`); UNAVAILABLE falls through to `exc.details() or str(code)` (`:252`).
  - Client: `manage_strategy(user_id, operation, definition, update_mask=None, access_scope=0)` — `services/xstockstrat-agent/app/client.py:915`; `op_map` (`:932-937`) and `ValueError("unknown operation … (expected register/update/deactivate/reactivate)")` (`:938-941`); returns `MessageToDict(resp)` camelCase (`:979`).
  - `get_strategy` — `client.py:982-1005`: `mtls.secure_channel(ANALYSIS_ENDPOINT, "xstockstrat-analysis")`, `stub.GetStrategy(req, metadata=_metadata(("x-user-id", user_id)), timeout=_RPC_TIMEOUT_S)`, projected with `MessageToDict(resp, preserving_proto_field_name=True, always_print_fields_with_no_presence=True)`.
  - Deadlines: `_RPC_TIMEOUT_S = 10.0`, `_LONG_RPC_TIMEOUT_S = 45.0` — `client.py:37-38`.
  - No reference to `ScoreStrategy`, `score_strategy` or `operation='score'` anywhere in agent `.py` files.

## Patterns to REUSE

- Owner identity for `score` -> reuse `_caller_user_id(ctx, tool)` (`tools.py:155`) and forward only `x-user-id` (as `get_strategy`, `client.py:1003`); propagation trio rides `CallerPropagationMiddleware` with no per-tool plumbing (agent CLAUDE.md, AGENT-4).
- snake_case `score` projection -> reuse `MessageToDict(resp, preserving_proto_field_name=True, always_print_fields_with_no_presence=True)` from `client.get_strategy` (`client.py:1003-1005`); `provisional` is a plain bool so it prints `false`.
- Pre-backend argument rejection (AC-9) -> shape of the `update`-only `ValueError` guard at `tools.py:1067-1075`, using the existing `supplied` / `mask` / `clear_fields` locals; must fire before the client call.
- Error detail passthrough (AC-3/AC-8) -> `_grpc_error_message(..., not_found=<exc.details()>)` or a new NOT_FOUND branch in the helper (`tools.py:244-245`); PERMISSION_DENIED/UNAVAILABLE already pass details through.
- Executable parity guard (FR-4/AC-10) -> descriptor-parity model `services/xstockstrat-agent/tests/test_backtest_view.py:203` (`test_summary_key_set_covers_every_proto_field`, `analysis_pb2.BacktestResult.DESCRIPTOR.fields_by_name` at `:222`) and `tests/test_strategy_builders.py:115` (`test_manage_strategy_definition_covers_every_proto_field`). Analogue: `StrategyScore.DESCRIPTOR.fields_by_name` + `excluded_symbols` vs the projection key set, with an explicit opt-out set.
- Tool-count guard (AC-6) -> existing `tests/test_tools_endpoint.py:106-122` (`test_every_tool_count_surface_states_the_catalog_size`, `_TOOL_COUNT = 45` at `:14`) covering `tools.py`, agent CLAUDE.md, `docs/runbooks/mcp-tools.md`, `copilot.ts:21` and the `remove-agent-postgres-mcp` feature; AC-6 only needs it to keep passing. Runbook-section guard `test_tools_endpoint.py:100-103` requires the `### manage_strategy` heading (`docs/runbooks/mcp-tools.md:490`) to stay.
- Docstring/schema assertions -> `server._tool_manager.get_tool("manage_strategy").description` / `.parameters["properties"]` (`tests/test_tools.py:1083`, `:1106`).
- Tool tests -> `_tool_fn(server, "manage_strategy")(...)` with `patch.object(client, "manage_strategy", AsyncMock(...))` (`tests/test_tools.py:942-1223`); gRPC error mapping at `:1220` and `:1577`; client tests `tests/test_client.py:92,127,156,175` (bogus operation ValueError at `:175`).
- Route `score` to its own RPC separately from `STRATEGY_OPERATION_*` dispatch (operator decision) -> a new `client.score_strategy(user_id, strategy_id)` wrapper (the existing `op_map` stays register/update/deactivate/reactivate); the tool branches on `operation == "score"` before building the definition.

## Existing Business Rules (preserve / extend)

No existing `@AC-*` covers `ScoreStrategy` as an RPC; 283's own scenarios establish it at promotion. The 283 messages for AC-3/4/8 are described only in analysis CLAUDE.md, not in a suite. Both affected services have an `acceptance/` directory.

- **PRESERVE** `@AC-1 @FR-1 @feature-214` "The xstockstrat-agent MCP advertises no db_ tool" (`services/xstockstrat-agent/acceptance/remove-agent-postgres-mcp.feature`) — advertised count stays 45, so `score` is an operation, not a tool.
- **PRESERVE** `@AC-1 @regression @FR-1 @FR-4 @feature-273` "A stalled portfolio backend surfaces a deadline error from get_positions instead of hanging" (`services/xstockstrat-agent/acceptance/fix-agent-client-deadlines.feature`) — the new call must surface `DEADLINE_EXCEEDED`.
- **EXTEND** `@AC-5 @FR-1 @FR-2 @FR-4 @regression @feature-273` "Every agent backend RPC is bounded by its budget" (same file) — the new `ScoreStrategy` wrapper adds a budget row (10.5 s vs 45.5 s is open, see Risks).
- **PRESERVE** `@AC-6 @regression @FR-3 @feature-273` "A tool whose backends all stall still answers before the MCP client gives up" (same file) — `score` budget stays at least 3 s under the 60 s client timeout.
- **PRESERVE** `@AC-10 @regression @FR-1 @FR-2 @feature-273` "No agent backend stub call is issued without a deadline" (same file) — the new `client.py` stub call must pass `timeout`.
- **PRESERVE** `@AC-1 @FR-1`, `@AC-2 @FR-3`, `@AC-3 @FR-2`, `@AC-4 @FR-1`, `@AC-6 @FR-1` `@feature-149` (`services/xstockstrat-agent/acceptance/manage-strategy-accept-object-rules.feature`) — rule serialization, string passthrough, omitted-rule mask and empty-object behavior of register/update stay unchanged; the `score` branch must not leak into update validation.
- **PRESERVE** `@AC-5 @FR-4 @feature-149` "Every documentation surface reflects the widened manage_strategy input type" (`docs/sdd/business-rules/platform.feature`) — docstring, `mcp-tools.md` and the strat-lab skill keep the "JSON string or object" statement while gaining `score`.
- **PRESERVE** `@AC-32 @FR-12 @feature-224` "Agent docs and strat-lab skill stay in parity with the tool contract" (same file) — the 283 doc-parity guard extends, not replaces, it.
- **PRESERVE** `@AC-5 @FR-5 @feature-210` "Header-propagation semantics are unchanged beneath mTLS" (same file) — `score` rides the existing trio propagation.
- **PRESERVE** `@AC-11 @FR-9 @feature-215` "The derived grade excludes refused symbols without deleting evidence" (`services/xstockstrat-analysis/acceptance/block-fundamentals-strategy-on-etf.feature`) — grade math and non-deletion unchanged; 283 only surfaces `excluded`.
- **PRESERVE** `@AC-8 @FR-8 @feature-215` — an outage is `UNAVAILABLE` with the grade unchanged, never an `excluded` entry.
- **PRESERVE** `@AC-9 @FR-8 @feature-215` — a disabled snapshot source never yields `excluded` entries.
- **PRESERVE** `@AC-12 @FR-10 @feature-215` — a PIT page-cap hit is unknown (`UNAVAILABLE`), not excluded.
- **PRESERVE** `@AC-3 @FR-5 @feature-215` — non-ETF equities and non-fundamentals strategies leave `excluded_symbols` empty.
- **PRESERVE** `@AC-6 @FR-5 @regression @feature-262` "The strategies repository offers no owner-agnostic read or write" (`services/xstockstrat-analysis/acceptance/fix-analysis-owner-scope.feature`) — `ScoreStrategy` keeps resolving via `get_by_owner_and_id` if the analysis side is touched.
- **PRESERVE** `@AC-6 @FR-3 @regression @feature-244` (`analysis.scoring.shrinkage_days` row, `docs/sdd/business-rules/platform.feature`) — grade values stay consistent (k = 250 for stored 0).
- No CHANGE flags, so no sign-off entry is needed in `context.md`.

## Dependencies

- Proto/RPC: `ScoreStrategy` / `StrategyScore` (`analysis.proto:14`, `:244-259`) read only. No proto change (option C); if no no-proto channel is viable the fork returns to the operator, never an auto-added field.
- Migration: none.
- Config keys: none new.
- Inter-service edges: agent -> analysis `ScoreStrategy` (existing `ANALYSIS_ENDPOINT` edge, `client.py:996`). No new edge.
- New env vars / ports: none.

## Risks / Not-found

- **No in-repo precedent for the no-proto channel.** A grep over `services/**/*.py` (excluding generated code) finds no `set_trailing_metadata` / `trailing_metadata` use. Candidate: `context.set_trailing_metadata(...)` before `return score` at `servicer.py:2662` (needs an analysis change; `context` is a `grpc.aio` ServicerContext), read in the agent by awaiting the call object (`call = stub.ScoreStrategy(...)`; `resp = await call`; `await call.trailing_metadata()`) instead of the response-only `await stub.X(...)` form used everywhere in `client.py`. Open design points: metadata key naming and encoding (a `-bin` key or JSON string, ASCII-only otherwise), header size limits for long lists, and what the agent returns when the metadata is absent (older analysis build versus genuinely none excluded). If no channel is judged viable, return to the operator (spec AC-7).
- **`_grpc_error_message` drops NOT_FOUND detail** (`tools.py:244-245`) -> `score` must pass the server detail through or AC-3/AC-8 lose their specific messages.
- **Deadline-test constraint.** `tests/test_tool_deadlines.py` (`test_every_catch_site_passes_deadline_s`, `:310-325`) requires every `_grpc_error_message` call's `deadline_s` to be `client._RPC_TIMEOUT_S` unless the enclosing function is in `_LONG_TOOLS = {run_backtest, screen_symbols, trigger_backfill, run_fundamentals_scan}` (`:23`); mutating tools (`manage_` prefix) must pass `write=` explicitly (`:328-335`). `ScoreStrategy` performs a PIT fundamentals fan-out (up to 8 pages x 10 s per symbol) and can plausibly exceed 10 s; the budget choice (10.5 s vs 45.5 s, and whether `score` gets its own catch site or helper so register/update keep the short budget) is open. Total must stay within the 57 s guard at `test_tool_deadlines.py:275-280`.
- **AC-4 forcing:** the `_GradeInputsUnknown` path (`servicer.py:273`, abort at `:2604-2609`) needs a deterministic fault-injection method (e.g. a stubbed marketdata RPC error other than NotFound/FailedPrecondition, which the loaders classify UNKNOWN) in an analysis-side test; the design must say how the agent-level scenario observes it (mocked `AioRpcError` UNAVAILABLE with that detail).
- **Tests not read in this recon:** the ScoreStrategy cases in `test_analysis_servicer.py` / `test_grade_fundamentals_exclusion.py`, and the `copilot.ts` / `CopilotRail.tsx` count surfaces beyond `copilot.ts:21`.
- Applicable ledger traps:
  - `fails.md:307-308` (mcp-tools-alignment-triage): hand-written MCP prose/runbook/strat-lab skill drift from `client.py`/protos -> an executable parity guard is required, not prose only.
  - `insights.md:441-443`: descriptor-parity contract tests with an explicit opt-out set; `fails.md:1150`: a new proto field on a shared message breaks agent parity projections (not triggered here, since no proto change).
  - `fails.md:66-68`: nested subagents lack `AskUserQuestion`, so any self-run design gate is provisional and the real forks must reach the operator.
- Merge order: `docs/roadmap/features/merge-order.md:102` (row, 215's integration PR already on trunk) and the "Launch gate: 215 <-> 283" section at `:321-326`. Operator decision: record 215's `launched` wait as a prose note, not a table row — design/spec must keep that edit scoped to merge-order.md.
- Same-function overlap with 215/275/281 on `manage_strategy` (`tools.py`, `client.py`) and soft overlap on `docs/runbooks/mcp-tools.md` and `plugins/strat-lab/skills/backtest/SKILL.md`; rebase onto landed bodies.
- Strat-lab same-PR rule (root CLAUDE.md): `plugins/strat-lab/skills/backtest/SKILL.md` mentions `manage_strategy` at lines 16, 21, 54-74, 84, 143, 154 (the Mutation guard paragraph is at `:54`); `docs/runbooks/mcp-tools.md:490` is `### manage_strategy`.

## Recommended Scope

Advisory, input to the grilling and /sdd-spec:
1. Analysis (conditional on the channel decision): emit `excluded` on the success path via trailing metadata, plus a servicer test (excluded present, empty, and UNKNOWN stays `UNAVAILABLE`).
2. Agent client: `score_strategy` wrapper with a deadline-compliant call, call-object read of trailing metadata, snake_case projection plus `excluded_symbols`.
3. Agent tool: `operation='score'` branch before definition building, rejecting every other argument including `clear_fields` (AC-9), owner-scoped `x-user-id`, NOT_FOUND detail passthrough, docstring side effects (FR-2).
4. Tests: tool/client/deadline-AST, descriptor-parity guard and count guard (AC-6, AC-10).
5. Docs: `mcp-tools.md`, strat-lab `SKILL.md`, agent CLAUDE.md note, and the merge-order.md prose note.
