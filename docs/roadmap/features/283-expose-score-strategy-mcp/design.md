# Design: expose-score-strategy-mcp

**Created**: 2026-11-01
**Rounds**: 5 (full; termination: approved with documented open risks — hard cap reached)
**Approved by**: user @ 2026-11-01 (AskUserQuestion gate, round 5; also signed off FR-5 "null" + `@AC-11`, and the one-line `@AC-5 @feature-273` EXTEND)
**Grounded in**: recon.md

---

## Chosen Approach

Expose `ScoreStrategy` as `manage_strategy operation='score'` (no new tool; tool count stays 45; `get_strategy` untouched), and carry the already-computed `excluded` list back to the agent in a gRPC **trailer** — no `StrategyScore` proto field (operator option C).

1. **Analysis** (`services/xstockstrat-analysis/app/handlers/servicer.py`, recon § analysis `:2565-2662`). Constants `_EXCLUDED_TRAILER_KEY = "x-score-excluded-symbols"` and `_EXCLUDED_TRAILER_MAX_BYTES = 4096`. Just before `return score` (`:2662`, after persist `:2637` and the best-effort emit) set `context.set_trailing_metadata` to the compact JSON array of `excluded` (`"[]"` when none). `excluded` is already sorted/deduped (`:2798`, extended once `:2852-2853`). If the encoded value exceeds the cap, log WARN and set no trailer. Every abort path (`:2583-2635`) returns earlier, so aborted calls never carry the key. `owner_scoped` and `_CancelStatusInterceptor` forward `context` unchanged (`servicer.py:481-487`, `telemetry.py:134-136`).
2. **Agent client** (`services/xstockstrat-agent/app/client.py`, recon `:982-1005`). New `score_strategy(user_id, strategy_id)` modelled on `get_strategy`: `x-user-id` only, `timeout=_LONG_RPC_TIMEOUT_S` (45 s); call-object form (`call = stub.ScoreStrategy(...)`; `resp = await call`; `md = await call.trailing_metadata()`) inside the `mtls.secure_channel` block; snake_case projection plus `excluded_symbols`. Key present and valid JSON `list[str]` → that list; key missing / unparseable / wrong shape → `None` plus one WARN (never a fabricated `[]`, P-03). The unknown-operation `ValueError` (`:938-941`) gains "'score' is routed to ScoreStrategy"; `op_map` is untouched.
3. **Agent tool** (`services/xstockstrat-agent/app/tools.py`, recon `:907-1094`). A `score` branch as the first statement after the docstring (`:1034`), above the dict-rule `json.dumps`, testing the ORIGINAL arguments: any definition argument, or a non-None `clear_fields` (even `[]`), raises `ValueError("manage_strategy(operation='score') accepts only strategy_id; got: …")` before identity resolution or any client call (AC-9). Otherwise `return await _score_strategy(ctx, strategy_id)` — its own helper/catch site so `manage_strategy` keeps the 10 s budget — which resolves `_caller_user_id` (`:155`) and maps errors with `_grpc_error_message(e, not_found=e.details() or "no eligible evidence", deadline_s=client._LONG_RPC_TIMEOUT_S, write=True)`. The shared mapper (`:223-252`, drops NOT_FOUND detail at `:244-245`) is not changed. Owner-scoped, no admin gate.
4. **Consumer surface (C-14).** Agent only: the `manage_strategy` tool, its docstring, `docs/runbooks/mcp-tools.md`, `plugins/strat-lab/skills/backtest/SKILL.md` (same-PR rule), agent `CLAUDE.md` row (names the trailer key), analysis `CLAUDE.md` § Fundamentals availability guard (one sentence). UI unchanged (`insightsBff.ts` ignores the trailer).
5. **Docstring semantics.** `score` persists the grade, emits `analysis.strategy.scored`, ignores `range`; NOT_FOUND clears the stale grade; UNAVAILABLE leaves it unchanged; `excluded_symbols` = symbols with no surviving cell, `[]` when unguarded or the fundamentals gate is off, `null` = analysis did not report (also covers a trailer lost on the agent side). A deadline means outcome unknown — verify with `list_strategies`; the docstring does not claim an atomic refresh.
6. **Tests / guards.**
   - Analysis unit tests (`tests/test_grade_fundamentals_exclusion.py`): trailer on success (`'["SCHD"]'`/`"[]"`); AC-4 path (`test_pit_outage_raises_and_score_strategy_aborts_unavailable`, `:195-207`) aborts UNAVAILABLE with the exact text and never sets the trailer; oversize → no trailer + WARN; sorted+deduped pinned.
   - **First execute step — production-wiring loopback test** (analysis `tests/test_telemetry.py`, model `_serve_sleeper` `:365-387`): install `GrpcAioInstrumentorServer().instrument()` and `GrpcAioInstrumentorClient().instrument()` (what analysis `telemetry.py:206` and agent `telemetry.py:80` install in production), plain `grpc.aio.server`/channel, `uninstrument()` in teardown; drive the agent's REAL `client.score_strategy`; assert populated list, `"[]"`, and no key on abort arrive. First sub-step reads the installed `opentelemetry-instrumentation-grpc` 0.66b1 to confirm symbol names. **If red:** fallback = a small client interceptor of our own, inside OTel, capturing the trailer from the real call (needs `mtls.secure_channel` to accept `interceptors=`; confirm the instrumentor prepends). **If that also fails: FR-5 returns to the operator** (no auto-adopted proto field).
   - Agent tests: AC-1/2/3/4/8/9 tool tests patching `client.score_strategy` (exact server text); present-trailer parse with a fake call returning `grpc.aio.Metadata`; `None`+WARN via real-channel `hung_backend` `answers={"ScoreStrategy": (0, StrategyScore(...))}` (`conftest.py:176-180`); descriptor-parity (result keys minus `excluded_symbols` vs `StrategyScore.DESCRIPTOR`, `origin` opt-out); count guard stays 45 (`test_tools_endpoint.py:14,106-122`).
   - **Docs parity that fails today**: compare the SET of operations each surface mentions (docstring `operation:` line, runbook `operation` row, `SKILL.md`) with the set derived from `analysis_pb2.StrategyOperation` (minus UNSPECIFIED) ∪ {`score`} — set comparison, not exact-string match, no line-number anchors.
   - Deadline guards: `test_tool_deadlines.py` — `"_score_strategy"` in `_LONG_TOOLS` (`:23`), `"_score_"` in `_MUTATING_PREFIXES` (`:24-35`), plus a tool-level hung-backend case asserting "outcome unknown, verify before retrying"; 10+45 ≤ 57 (`:276`). `test_client_deadlines.py` — `_stub_calls` (`:109-124`) matches each `ast.Call` on `stub.X` ONCE (no double count of awaited calls), `"ScoreStrategy"` in `_LONG_RPCS` (`:48`), `_MIN_STUB_CALLS` (`:54`) pinned to the exact new count (73 → 74, verified red/green), one test-only `_AC5_ROWS` tuple.
   - Staging confirmation after deploy: one manual `score` call asserting a non-null `excluded_symbols` (only meaningful if staging runs `OTEL_ENABLED=true` like production).
7. **Process.** Final impl-spec step is the root `CLAUDE.md` teardown (`/context-forge:context-constitution refresh`, or manual reconciliation recorded in the PR body — `fails.md:670`).

## Rejected Alternatives

- Additive `StrategyScore.excluded_symbols` proto field (option A) — ruled out by the operator decision; returns to the operator only if every no-proto channel fails.
- Comma-joined trailer with empty string for "none" — empty-value presence is fragile and comma-ambiguous; compact JSON array is never empty.
- Missing trailer → `[]` + WARN — fabricates "nothing excluded" (P-03); `null` + WARN chosen.
- Response header (initial metadata) instead of a trailer — `excluded` is only final after aggregation.
- Derive `excluded` in the agent via `GetStrategy` + evidence reads — no evidence-listing RPC; duplicates guard logic (C-18).
- Read `excluded` from the `analysis.strategy.scored` ledger payload — best-effort emit, racy second read, alters a shared payload.
- Encode `excluded` into `component_scores` via a sentinel key — pollutes a numeric map.
- Truncate the list when over the cap — a truncated list reads as authoritative; `null` + WARN is the honest result.
- `set_details()` on an OK status — also a trailer, no lower delivery risk, and clients treat `details` as error text.
- Keep the 10 s `_RPC_TIMEOUT_S` for `score` — cancels the handler before `_persist_strategy_score` (`:2637`).
- Edit the shared `_grpc_error_message` to pass NOT_FOUND detail — touches a shared mapper; a call-site passthrough is smaller and correct.
- Hoist `op_map` into a shared `STRATEGY_OPERATIONS` constant — lost to minimum-diff/greppable enum constants.
- PLAT-* constitution row for the trailer contract — cut: comments at both sites, literal-key assertions in both suites and the agent `CLAUDE.md` row guard it.
- Three-document operations parser with line anchors — cut in favour of set comparison.
- `try/except` around `set_trailing_metadata` — cut: validation happens after return, so it could never fire.

## Open Risks

- [ ] **Client-side OTel wrapper may swallow trailers in production** (`GrpcAioInstrumentorClient` returns the response, not the call object → `trailing_metadata()` = `None`), making `excluded_symbols` always `null` while unit tests stay green — addressed by the production-wiring loopback test (execute step 1) and the own-interceptor fallback; FR-5 returns to the operator if both fail.
- [ ] **45 s budget** vs worst-case fundamentals paging (`ceil(symbols/4) × 8 pages × 10 s`) can hit DEADLINE_EXCEEDED on a slow day (grade unchanged; could delay 215 Step 26 (e)) — recorded in docstring/runbook; server-side time guard is an out-of-scope follow-up.
- [ ] **Trailer contract is untyped across two services** — guarded by comments + literal-key assertions in both suites + agent `CLAUDE.md` row; revisit a PLAT row if a second trailer is ever added.
- [ ] **Oversize trailer behaviour on the agent side unverified** (expected RESOURCE_EXHAUSTED; the 4096 cap exists so it never matters).
- [ ] **Pre-existing cancel divergence** in the `score is None` branch (`servicer.py:2618` pops memory before `:2621` deletes in DB) — not introduced here; one line in `context.md`.
- [ ] **Durable `@AC-5 @feature-273` Examples row** (`| ScoreStrategy | 45.5 |`) — signed off; lands in the implementation step that adds the test-only `_AC5_ROWS` tuple (keep the two in step).

## Constitution Rules Touched

- `C-11` — honored: design forks (channel, null semantics, durable row) surfaced to the operator, not guessed.
- `C-14` — honored: consumer surface = the agent tool; UI justified as unchanged.
- `C-15` — honored: `@AC-1..@AC-11` cover FR-1..FR-5; docs-parity test fails before the docs edit.
- `C-16` — honored: PRESERVE/EXTEND set below; the 273 `@AC-5` EXTEND carries operator sign-off.
- `C-18` — honored: no new tool, no proto field, no PLAT row, dead `try/except` cut.
- `P-01`/`P-02`/`P-04` — honored: single writer, mediated debate, operator gate each round.
- `P-03` — honored: absent trailer is `null`, never a fabricated `[]`.
- `P-06` — honored: new guards must be shown red then green (docs parity, exact stub-call count).
- `F-04` — honored: every path/symbol cited from recon or verified; unverified OTel items listed above.
- `F-07` — honored: the 4096 cap and trailer key are wire constants, not config.
- `F-11` — no Floor breach in any round.

## Business Rules Touched (C-16)

- PRESERVE `@AC-1 @FR-1 @feature-214` (`services/xstockstrat-agent/acceptance/remove-agent-postgres-mcp.feature`) — advertised tool count stays 45.
- PRESERVE `@AC-1/2/3/4/6 @feature-149` (`manage-strategy-accept-object-rules.feature`) — the `score` branch exits before `supplied`/`mask`.
- PRESERVE `@AC-6 @feature-273` — 10 s + 45 s ≤ 57 s.
- EXTEND `@AC-10 @feature-273` — guard now also sees the call-object form (test-code change only).
- EXTEND `@AC-5 @FR-1 @FR-2 @FR-4 @feature-273` (`services/xstockstrat-agent/acceptance/fix-agent-client-deadlines.feature`) — new Examples row `| ScoreStrategy | 45.5 |`; signed off by user @ 2026-11-01 (round-5 gate).
- PRESERVE `@AC-5 @FR-4 @feature-149`, `@AC-32 @FR-12 @feature-224`, `@AC-5 @FR-5 @feature-210` (`docs/sdd/business-rules/platform.feature`) — docs keep their statements; header trio unchanged.
- PRESERVE `@AC-3/8/9/11/12 @feature-215` — aborts set no trailer; grade maths untouched.
- PRESERVE `@AC-6 @feature-262` — `ScoreStrategy` keeps `get_by_owner_and_id`.

