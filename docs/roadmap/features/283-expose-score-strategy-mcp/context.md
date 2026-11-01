# Context: expose-score-strategy-mcp

**Feature**: `docs/roadmap/features/283-expose-score-strategy-mcp/feature.md`
**Product Spec**: `docs/roadmap/features/283-expose-score-strategy-mcp/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/283-expose-score-strategy-mcp/implementation-spec.md`

---

## Session 2026-11-01 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the operator's request to close the 215 Step 26 (e) gap.
- Number 283 = max(282)+1 on `origin/main-dev` `0fc13c41`, so no renumbering.
- Origin: `docs/roadmap/features/215-block-fundamentals-strategy-on-etf/implementation-spec.md` § Deviation "Step 26 (e) — `ScoreStrategy` not reachable via MCP" (blocks 215 `launched`).
- Facts grounded: `ScoreStrategy` at `services/xstockstrat-analysis/app/handlers/servicer.py:2566` (owner-scoped, `range` ignored, persists grade, emits `analysis.strategy.scored`); `StrategyScore` at `packages/proto/analysis/v1/analysis.proto:249-258` (`evidence_symbols` is an `int32` count); agent registers 45 tools today.
- Unresolved: FR-5 fork (how to name excluded symbols) — raised in product-spec Open Questions, not guessed.

## Session 2026-11-01 — sdd-review product-spec

- First pass FAILED (criterion 9: four unresolved open questions). Operator resolved: tool shape = `manage_strategy operation='score'` (count stays 45); FR-5 = option C (no proto field); owner-scoped auth; `merge-order.md` row added for 215/283. Spec + acceptance revised (AC-6/7 concrete, AC-8..10 added).
- Re-review: PASS WITH WARNINGS. Status: draft → spec-ready.
- Warnings applied: `excluded_symbols` named in FR-5; remaining question reformatted as "Deferred to /sdd-design"; AC-10 reworded as an outcome.
- Warnings carried to design: preserve NOT_FOUND detail via `_grpc_error_message` for `score`; AC-7 re-opens to operator if no no-proto channel; AC-9 must also reject `clear_fields`.
- Overlap: no FAIL-level collisions. Same-function overlap with 215 on `manage_strategy` (`tools.py`/`client.py`); `score` calls a different RPC than the `STRATEGY_OPERATION_*` dispatch.
- **Unresolved, needs operator ruling:** `merge-order.md` row for 215/283 reads as a PR-level deadlock (283 needs 215's servicer code on trunk; row makes 215's integration PR wait for 283). Intended sequence: 215 integration PR → 283 → 215 `launched`.
- Recommended design depth: full (overlap finding; possible analysis change).

## Session 2026-11-01 — merge-order split + warning fixes

- `merge-order.md` row 100 split into two (283 waits for 215's *merge*; 215's `launched` waits for 283). Row 2 is not machine-enforced (the file gates only integration PRs) — enforced by 215's Step 26 (e).
- Spec warnings addressed: `excluded_symbols` in FR-1; server detail text preserved in FR-3; AC-9 also covers `clear_fields`; feature.md reviewer table updated for option C. Re-review requested.

## Session 2026-11-01 — sdd-review product-spec (pass 3)

- Result: PASS WITH WARNINGS, no blockers; status remains spec-ready. All pass-2 warnings verified fixed.
- Addressed: AC-6 reworded (count stated as words or digits); merge-order row A set Resolved=Yes (215's code verified on origin/main-dev); row B now states its real enforcement (CI promotes only `code-completed`; keep 215 `in-progress` until Step 26 (e) runs).
- Carried to design: `_grpc_error_message` (`tools.py:244-245`) discards the server detail on NOT_FOUND — `score` must pass it through; AC-4 needs a way to force `_GradeInputsUnknown`; update the `operation` docstring and the parity guard together.
- Open for operator: whether row B stays in the table or moves to a prose note (scan 3 flagged `/sdd-execute` would still prompt on it).

## Session 2026-11-01 — sdd-batch design gate (round 2)

Debate halted at the approval gate after round 2 (gate policy: halt). design.md NOT written; status.md unchanged (spec-ready).

### Open Threads

- **Approach (r2 + adversary fixes).** No proto change, tool count stays 45, `get_strategy` untouched. Analysis `ScoreStrategy` sets trailing metadata `x-score-excluded-symbols` (comma-joined, already sorted/deduped by `_exclude_refused_cells`) on every success, including `""`, never on abort paths. Agent `client.score_strategy` reads it via the call-object form (`trailing_metadata()`); a missing key returns `None` plus one WARN (deploy skew; `[]` would fabricate "nothing excluded", P-03). `manage_strategy(operation='score')` is a top-of-function branch accepting only `strategy_id` (AC-9 rejects any other field or `clear_fields` before any call), delegating to a separate `_score_strategy` helper with the 45 s `_LONG_RPC_TIMEOUT_S` deadline and a local NOT_FOUND detail passthrough. `op_map` stays literal. The parity test derives the operation set from `analysis_pb2.StrategyOperation | {"score"}` and checks the docstring summary line and :925, mcp-tools.md, and strat-lab SKILL.md.
- **Strongest open objection (blocking, carried to impl-spec).** The success-path trailer through the production analysis stack (aio server, `_CancelStatusInterceptor`, OTel `GrpcAioInstrumentorServer`, owner_scoped, mTLS) has no in-repo precedent. The loopback test must include the instrumentor and is the FIRST execute step; if it fails, FR-5 returns to the operator (no auto-adopted proto field). Second blocking item: the `None`+WARN path needs its own real-channel case (`answers={"ScoreStrategy": (0, StrategyScore(...))}`), since an unanswered `hung_backend` method only yields DEADLINE_EXCEEDED.
- **Floor status.** No Floor breaches.
- **Uncovered @AC changes (no operator decision).** New append-only @AC-11 (null `excluded_symbols`); AC-10 EXTEND; `@AC-5 @feature-273` EXTEND (add `ScoreStrategy | 45.5` row); PRESERVE only: `@AC-6 @feature-273`, `@AC-1 @feature-214`, `@AC-1/2/3/4/6 @feature-149`. Covered by operator decision: AC-3, AC-8, AC-4 (PRESERVE), AC-9, AC-7 (EXTEND). FR-5 is amended to "null = analysis did not report"; AC-7 is not edited.
- **Non-blocking, carry to design.md/impl-spec.** Record the trailer contract once as a PLAT-* row in `docs/context-constitution.md`; `[]` is meaningful only with `analysis.backtest.fundamentals.enabled` on; 45 s may be insufficient for large guarded strategies (bound ~ceil(symbols/4) x pages x 10 s; a pre-persist deadline leaves the grade unchanged, verify via `list_strategies`); header-size limit unhandled; the UI BFF caller (`insightsBff.ts`) ignores the trailer; prose merge-order note near merge-order.md:102 and :321-326; fix product-spec § Decisions "two rows" -> "prose note".
- **Next step.** Operator approves or redirects at the gate; the next `/sdd-batch` run resumes from the state below and writes design.md.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Current best approach (r2 proposal with adversary fixes adopted). No proto change, tool count stays 45, get_strategy untouched.\n\n1. Analysis (services/xstockstrat-analysis/app/handlers/servicer.py): in ScoreStrategy, immediately before `return score` (~:2662), call context.set_trailing_metadata(((_EXCLUDED_TRAILER_KEY, \",\".join(excluded)),)). `_EXCLUDED_TRAILER_KEY = \"x-score-excluded-symbols\"` is a module constant. Use `\",\".join(excluded)` WITHOUT re-sorting: `_exclude_refused_cells` already returns sorted(set(...)) (:2798) and excluded is filled by one extend (:2852-2853); pin \"sorted, deduped\" as a property of that function in an analysis test (DRY, C-18). Trailer set on every success including \"\" ; never on any abort path (:2583-2635 return earlier).\n\n2. Agent client (services/xstockstrat-agent/app/client.py): keep op_map (:932-937) LITERAL (drop the r2 STRATEGY_OPERATIONS hoist; greppable enum constants, minimum diff). Only update the ValueError text (:938-941) to mention that 'score' is routed separately. Add score_strategy(user_id, strategy_id) modelled on get_strategy (:982-1005): forwards only x-user-id, no range, timeout=_LONG_RPC_TIMEOUT_S; call-object form (call = stub.ScoreStrategy(...); resp = await call; md = await call.trailing_metadata()) inside the async-with mtls.secure_channel block; snake_case MessageToDict plus excluded_symbols. Present key \"\" -> []; present key -> split list; MISSING key -> None plus one WARN log (deploy skew; [] would fabricate \"nothing excluded\", P-03).\n\n3. Agent tool (services/xstockstrat-agent/app/tools.py): `score` branch at the very top of manage_strategy (:1034), above the dict-rule json.dumps (:1039-1042), testing ORIGINAL arguments. Any non-None value among the ten `supplied` keys (:1044-1055) or clear_fields (even []) raises ValueError(\"manage_strategy(operation='score') accepts only strategy_id; got: <names>\") before identity resolution or any client call (AC-9). Else return await _score_strategy(ctx, strategy_id). _score_strategy (new module-level async helper): _caller_user_id(ctx,\"manage_strategy\") (:155) -> client.score_strategy; catches AioRpcError with _grpc_error_message(e, not_found=e.details() or \"no eligible evidence\", deadline_s=client._LONG_RPC_TIMEOUT_S, write=True). Shared mapper (:244-245) unchanged; PERMISSION_DENIED/UNAVAILABLE already pass server text (:248-252) for AC-2/AC-4. Owner-scoped via x-user-id, no admin gate.\n\n4. Deadline: 45 s (_LONG_RPC_TIMEOUT_S), separate helper because the AST walker attributes catch sites to the innermost function. tests/test_tool_deadlines.py: add \"_score_strategy\" to _LONG_TOOLS (:23), \"_score_\" to _MUTATING_PREFIXES (:24-35); 10+45=55 <= 57 budget (:276) holds. Add real-channel hung_backend test (conftest.py:146-208) for a hung ScoreStrategy failing within _LONG_S+_SLACK_S with \"outcome unknown, verify before retrying\". Add `ScoreStrategy | 45.5` row to @AC-5 @feature-273 table. design.md records: UI waits 300 s but MCP 60 s client limit caps this at 45 s; worst-case bound for guarded strategies ~ ceil(symbols/4) x pages x 10 s (_FUND_PAGE_TIMEOUT_SECONDS=10, _MAX_FUND_PAGES=8, concurrency 4) can exceed 45 s; a deadline before _persist_strategy_score (servicer.py:2637) means grade UNCHANGED, verify with list_strategies. State this bound in the docstring and runbook too.\n\n5. Parity guard (tests/test_score_strategy_parity.py): (a) result keys minus {\"excluded_symbols\"} subset of StrategyScore.DESCRIPTOR.fields_by_name; descriptor fields missing from the result must have has_presence or be in opt-out {\"origin\"}; FR-1 reworded \"origin when set\". (b) operations: expected set derived IN THE TEST from analysis_pb2.StrategyOperation (minus UNSPECIFIED, prefix stripped, lower-cased) | {\"score\"}; a parser reads the canonical `operation: 'register' | ... | 'score'` line from the docstring summary line (tools.py:924) AND :925, the manage_strategy section of docs/runbooks/mcp-tools.md, and plugins/strat-lab/skills/backtest/SKILL.md, each must equal that set; plus assert the client's ValueError text lists exactly the literal-op_map names (or call once per op with a mocked stub). Count guard (AC-6) unchanged at 45 (test_tools_endpoint.py:14,106-122).\n\n6. Trailer verification: (i) analysis suite loopback test: grpc.aio.server(interceptors=server_interceptors()) with telemetry forced on AND GrpcAioInstrumentorServer().instrument() (or init_telemetry() with OTEL_ENABLED=true) applied before server construction, uninstrumented on teardown (telemetry.py:151-153,167); mirrors main.py:107,116 with add_secure_port, test-CA mtls.server_credentials(), real ssl client channel. Assert: populated trailer arrives; empty value arrives as present key \"\"; abort path carries no trailer key. This is the FIRST execute step. (ii) agent test_client.py: fake call object that is awaitable and exposes trailing_metadata(). (iii) agent real-channel None+WARN test: hung_backend with answers={\"ScoreStrategy\": (0, analysis_pb2.StrategyScore(...))} (success without trailer; a method missing from answers hangs, conftest.py:172-175) asserting excluded_symbols is None and WARN via caplog. Both suites assert the literal \"x-score-excluded-symbols\".\n\n7. AC-4 forcing: extend analysis test_pit_outage_raises_and_score_strategy_aborts_unavailable (tests/test_grade_fundamentals_exclusion.py:195-207): assert UNAVAILABLE \"fundamentals availability unknown — grade unchanged\", set_trailing_metadata not called, scores repo neither upserted nor deleted. Agent side patches client.score_strategy with AioRpcError(UNAVAILABLE, that text) and asserts exact message; AC-3/AC-8 same with NOT_FOUND details.\n\n8. Docs/process: SCORE docstring paragraph (persists grade, emits analysis.strategy.scored, ignores range, clears stale grade on NOT_FOUND, unchanged on UNAVAILABLE, only strategy_id, snake_case keys plus excluded_symbols where null = analysis did not report, \"[]\" only meaningful while analysis.backtest.fundamentals.enabled is on, verify with list_strategies after a deadline). Update docstring summary line (:924), mcp-tools.md, strat-lab SKILL.md (same PR per strat-lab rule), agent CLAUDE.md manage_strategy row (count stays 45). Record the trailer contract ONCE as a cross-module invariant row in docs/context-constitution.md (PLAT-*) and point both service CLAUDE.md files and mcp-tools.md at it (avoids fails.md:306-309 drift). Note in design.md that the UI BFF caller (insightsBff.ts) ignores the trailer. Amend FR-5 to \"null = analysis did not report\" and add a NEW append-only @AC-11 pinning the null case (do not edit AC-7). Prose merge-order note near merge-order.md:102 and :321-326; fix product-spec.md § Decisions \"two rows\" -> \"prose note\".",
    "open_objections": [
      {"text": "RESOLVED in this synthesis but must be carried into impl-spec: loopback test must include GrpcAioInstrumentorServer (OTel) as well as _CancelStatusInterceptor, otherwise green does not prove production delivers the trailer. If the test fails, FR-5 returns to the operator (no auto-adopted proto field).", "blocking": true},
      {"text": "RESOLVED in this synthesis but must be carried into impl-spec: the None+WARN path needs its own real-channel case with answers={'ScoreStrategy': (0, StrategyScore(...))}; the hung_backend no-answer case only yields DEADLINE_EXCEEDED and cannot cover it.", "blocking": true},
      {"text": "FR-5/AC-7 return-type change (excluded_symbols may be null) requires a product-spec amendment and a new append-only @AC-11; AC-7 itself is not edited.", "blocking": false},
      {"text": "Trailer key is an untyped cross-service contract: record once in docs/context-constitution.md (PLAT-* row) and reference from CLAUDE.md files; both suites assert the literal.", "blocking": false},
      {"text": "Empty trailer is ambiguous when the fundamentals gate is off or the strategy needs no fundamentals ([] does not mean 'passed the guard'); docstring and runbook must state [] is meaningful only with analysis.backtest.fundamentals.enabled on.", "blocking": false},
      {"text": "45 s budget is not proven sufficient for large guarded strategies; design.md, docstring and runbook must state the ceil(symbols/4) x pages x 10 s bound and that a pre-persist deadline leaves the grade unchanged (verify via list_strategies).", "blocking": false},
      {"text": "Docstring summary line (tools.py:924), which is the first line in tools/list, must be covered by the parity parser, not only :925.", "blocking": false}
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {"ac_id": "AC-3", "kind": "PRESERVE", "covered_by_operator_decision": true},
      {"ac_id": "AC-8", "kind": "PRESERVE", "covered_by_operator_decision": true},
      {"ac_id": "AC-9", "kind": "EXTEND", "covered_by_operator_decision": true},
      {"ac_id": "AC-7", "kind": "EXTEND", "covered_by_operator_decision": true},
      {"ac_id": "AC-4", "kind": "PRESERVE", "covered_by_operator_decision": true},
      {"ac_id": "AC-11 (new, null excluded_symbols)", "kind": "EXTEND", "covered_by_operator_decision": false},
      {"ac_id": "AC-10", "kind": "EXTEND", "covered_by_operator_decision": false},
      {"ac_id": "@AC-5 @feature-273", "kind": "EXTEND", "covered_by_operator_decision": false},
      {"ac_id": "@AC-6 @feature-273", "kind": "PRESERVE", "covered_by_operator_decision": false},
      {"ac_id": "@AC-1 @feature-214", "kind": "PRESERVE", "covered_by_operator_decision": false},
      {"ac_id": "@AC-1/2/3/4/6 @feature-149", "kind": "PRESERVE", "covered_by_operator_decision": false}
    ],
    "rejected_alternatives": [
      "Additive StrategyScore.excluded_symbols proto field (option A): ruled out by binding operator decision; returns to operator only if the trailer loopback test fails.",
      "STRATEGY_OPERATIONS hoist replacing literal op_map with getattr(analysis_pb2, f'STRATEGY_OPERATION_{op.upper()}'): lost to minimum-diff/greppable enum constants; the enum anchor lives in the parity test instead.",
      "Missing trailer -> [] plus WARN: keeps the list type but tells the operator 'nothing excluded' during deploy skew, fabricating data (P-03); None plus WARN chosen.",
      "Response header (initial metadata) instead of trailer: excluded is final only after aggregation, and it does not reduce interceptor risk.",
      "Agent derives excluded via GetStrategy plus evidence reads: no evidence-listing RPC exists and it duplicates guard logic (C-18).",
      "Read excluded from the analysis.strategy.scored ledger payload: best-effort emit, second racing RPC, alters a shared payload.",
      "Encode excluded into component_scores via sentinel key: pollutes numeric map; map<string,double> cannot carry symbols.",
      "Keeping 10 s _RPC_TIMEOUT_S for score: cancels the handler before _persist_strategy_score, so no grade persisted.",
      "Editing shared _grpc_error_message to pass NOT_FOUND detail for all tools: would change other tools' messages; passthrough kept local to the score site.",
      "Re-sorting/deduping in the servicer edit: redundant with _exclude_refused_cells.",
      "Async kick-then-poll ScoreStrategy: changes ScoreStrategy semantics and loses the synchronous NOT_FOUND/UNAVAILABLE contract.",
      "New score_strategy tool or admin gating: ruled out by operator decisions."
    ],
    "open_risks": [
      "Success-path trailer through the production analysis stack (aio server, _CancelStatusInterceptor, OTel GrpcAioInstrumentorServer, owner_scoped, mTLS) into the agent call-object read has no in-repo precedent; if any layer drops it every result shows excluded_symbols null, AC-7 fails, and FR-5 returns to the operator. Loopback test (with the instrumentor) is the first execute step.",
      "45 s may be insufficient for cold PIT fundamentals on large strategies (~ceil(symbols/4) x 8 pages x 10 s) and sits near the MCP client's 60 s limit; timeout leaves grade unchanged and reports outcome unknown.",
      "Header size: excluded lists beyond gRPC's ~8 KiB metadata limit are not handled; assumed a few hundred tickers at most.",
      "Textual conflicts on manage_strategy with features 215/275/281; top-of-function branch minimises this; merge order 283 after 215 (on trunk).",
      "Unread: the current shape of mcp-tools.md and strat-lab SKILL.md (canonical operation line must fit them), and whether _CancelStatusInterceptor/instrumentor alter trailing metadata.",
      "Deploy skew (older analysis without trailer) yields null excluded_symbols; documented and tested but a third state for operators.",
      "Empty list is ambiguous when the fundamentals gate is off or not needed; mitigated by docs only."
    ],
    "constitution_rules_touched": ["C-10", "C-11", "C-15", "C-16", "C-18", "P-02", "P-03", "PLAT-4", "PLAT-5", "PLAT-13", "AGENT-4", "PLAT-N1"],
    "rationale": "The r2 proposal is sound and consistent with all binding operator decisions (operation='score', no proto field, owner scoping, separate RPC route, local NOT_FOUND passthrough, AC-9 pre-call rejection, docstring plus executable parity guard, AC-4 forcing). The adversary found no Floor breach. I adopt its two blocking fixes: the loopback test must include the OTel instrumentor (the most likely trailer-dropping layer) and the None path needs a real success-without-trailer case since an unanswered hung_backend method just times out. I also adopt the non-blocking simplifications: keep op_map literal and anchor the enum set in the test (CLAUDE.md rule 3 and C-18), drop the redundant sort/dedup, cover the docstring summary line, and centralise the wire contract in the context constitution. The None return changes FR-5, so the spec is amended and a new append-only AC-11 pins it rather than editing AC-7. Residual uncertainty is concentrated in the trailer delivery path, with an explicit escalation back to the operator rather than auto-adopting a proto field."
  },
  "floor_breaches": []
}
```

## Session 2026-11-01 — sdd-batch design gate (round 3)

Debate halted at the approval gate after round 3 (gate policy: halt). design.md NOT written; status.md unchanged (spec-ready).

### Open Threads

- **Approach (r3 + adversary fixes).** No proto change, tool count stays 45, `get_strategy` untouched; `manage_strategy` `operation='score'` routes to `ScoreStrategy`. Analysis sets trailing metadata `x-score-excluded-symbols` as a JSON array string (never empty, so `"[]"` is distinct from a missing key) on every success path, never on aborts. The agent reads it via the call-object form; a missing key yields `excluded_symbols = null` plus a WARN (never a fabricated `[]`). 45 s deadline in a separate `_score_strategy` helper; AC-9 pre-call rejection of definition args; local NOT_FOUND passthrough; marker-anchored (not line-number) parity guard across docstring, runbook and strat-lab SKILL.md.
- **Strongest open objection (blocking).** The call-object form of `ScoreStrategy` is invisible to the existing `@AC-10 @feature-273` deadline AST guard; the impl-spec must extend `_stub_calls` (Assign/AnnAssign), `_LONG_RPCS`, `_AC5_ROWS` and keep the fake-channel mock raising on await with `trailing_metadata()`. Second blocker: six spec/acceptance changes (FR-5 null amendment, new @AC-11, AC-10 parser scope, 273 @AC-5 row, SKILL.md canonical line, product-spec "two rows" to "prose note") exceed the operator decisions and need real operator sign-off.
- **Floor status.** No Floor breaches.
- **Uncovered @AC changes (no operator decision).** New append-only @AC-11; AC-10 EXTEND; `@AC-5 @feature-273` and `@AC-10 @feature-273` EXTEND; PRESERVE only: `@AC-6 @feature-273`, `@AC-1 @feature-214`, `@AC-1/2/3/4/6 @feature-149`, `@AC-3 @feature-215`. Covered by operator decision: AC-3, AC-4, AC-7, AC-8, AC-9.
- **Known limitation (recorded, not fixed).** Server-side cancellation in the `score is None` branch can diverge memory and DB (`_strategies.pop` before `scores_repo.delete`); pre-existing.
- **Next step.** Operator approves or redirects at the gate; the next `/sdd-batch` run resumes from the state below. First execute step is the analysis trailer loopback test (with OTel instrumentor); failure returns FR-5 to the operator. Final impl-spec step names the root-CLAUDE.md teardown.

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "Current best approach (r3 proposal with adversary fixes adopted). No proto change, tool count stays 45, get_strategy untouched, manage_strategy operation='score' routed to ScoreStrategy.\n\n1. Analysis (services/xstockstrat-analysis/app/handlers/servicer.py): module constant _EXCLUDED_TRAILER_KEY = \"x-score-excluded-symbols\". Immediately before `return score` (~:2662) call context.set_trailing_metadata on every success path. ENCODING CHANGE (adopted from adversary): send a JSON array string (json.dumps(excluded), e.g. \"[]\" or '[\"AAPL\",\"MSFT\"]'), never an empty value, so \"none excluded\" is a non-empty present value and is distinct from \"key missing = analysis did not report\"; no comma-ambiguity. No re-sort (_exclude_refused_cells already returns sorted(set(...)) :2798, extended once :2852-2853; sortedness/dedup verified, drop the 'not re-read' caveat); an analysis test pins sorted+deduped. Abort paths (:2583-2635) return earlier and carry no trailer.\n\n2. Agent client (services/xstockstrat-agent/app/client.py): op_map (:932-937) stays literal; only the ValueError text (:938-941) changes to say 'score' is routed separately. Add score_strategy(user_id, strategy_id) modelled on get_strategy (:982-1005): x-user-id only, no range, timeout=_LONG_RPC_TIMEOUT_S, call-object form (call = stub.ScoreStrategy(...); resp = await call; md = await call.trailing_metadata()), snake_case MessageToDict plus excluded_symbols. Parse: key present -> json.loads list; key MISSING (or unparseable) -> None plus one WARN log (deploy skew; [] would fabricate 'nothing excluded', P-03).\n\n3. Agent tool (services/xstockstrat-agent/app/tools.py): `score` branch at the very top of manage_strategy (:1034) above the dict-rule json.dumps (:1039-1042), testing ORIGINAL arguments. Any non-None definition arg or clear_fields (even []) raises ValueError(\"manage_strategy(operation='score') accepts only strategy_id; got: <names>\") before identity resolution/any client call (AC-9). Otherwise return await _score_strategy(ctx, strategy_id): _caller_user_id(ctx,\"manage_strategy\") (:155) -> client.score_strategy; catch AioRpcError -> _grpc_error_message(e, not_found=e.details() or \"no eligible evidence\", deadline_s=client._LONG_RPC_TIMEOUT_S, write=True). Shared mapper unchanged (PERMISSION_DENIED/UNAVAILABLE already pass server text :248-252). Owner-scoped, no admin gate.\n\n4. Deadline: 45 s; separate helper because the AST walker attributes catch sites to the innermost function. Agent tests/test_tool_deadlines.py: add \"_score_strategy\" to _LONG_TOOLS (:23), \"_score_\" to _MUTATING_PREFIXES (:24-35); 10+45<=57 (:276). ADDED to close adversary blocker #1 (tests/test_client_deadlines.py, @AC-10 @feature-273): extend _stub_calls (:109-124) to also match Assign/AnnAssign whose value is Call(stub.X) (not only ast.Await(Call)); add \"ScoreStrategy\" to _LONG_RPCS (:48) and _AC5_ROWS (:20-45); re-check _MIN_STUB_CALLS (:54); the fake-channel row (:85-101) must keep an AsyncMock that raises on await AND exposes trailing_metadata() (not a coroutine-only mock). Add `ScoreStrategy | 45.5` row to @AC-5 @feature-273. design.md records the worst-case bound ceil(symbols/4) x pages x 10 s (can exceed 45 s); a deadline before _persist_strategy_score (:2637) leaves grade UNCHANGED, verify via list_strategies. Known limitation (recorded in context.md/findings, not fixed here): on server-side CancelledError in the `score is None` branch, self._strategies.pop (:2618) runs before await scores_repo.delete (:2621), so memory and DB can diverge (pre-existing, UI BFF path has it too); docstring must not claim atomic refresh; server-side time_remaining guard rejected as out of scope follow-up.\n\n5. Parity guard (tests/test_score_strategy_parity.py): (a) result keys minus {\"excluded_symbols\"} subset of StrategyScore.DESCRIPTOR.fields_by_name; descriptor fields absent from result must have presence or be in opt-out {\"origin\"}. (b) operations: expected set built in the test from analysis_pb2.StrategyOperation (drop UNSPECIFIED, strip prefix, lower-case) | {\"score\"}; parsers read the tools.py docstring summary line (:924) and :925, the `| operation |` row under `### manage_strategy` in docs/runbooks/mcp-tools.md, and a new canonical line in plugins/strat-lab/skills/backtest/SKILL.md (\"`manage_strategy` operations: `register` | `update` | `deactivate` | `reactivate` | `score`\"). Parsers anchor on regex markers (docstring `operation:` token, heading + table-row, literal prefix), NEVER line numbers; the spec must forbid line-number anchoring (rebases from 215/275/281). Plus: client ValueError text lists exactly the four op_map names. Count guard stays 45 (test_tools_endpoint.py:14,106-122).\n\n6. Trailer verification: FIRST execute step is an analysis loopback test: grpc.aio.server(interceptors=server_interceptors()) with OTel forced on and GrpcAioInstrumentorServer().instrument() applied before server construction (un-instrumented on teardown), mTLS add_secure_port; asserts populated trailer arrives, empty-list \"[]\" arrives as present non-empty value, abort carries no key. Agent side: fake awaitable call object test; real-channel hung_backend case with answers={\"ScoreStrategy\": (0, StrategyScore(...))} asserting excluded_symbols None + WARN. If the loopback test fails, FR-5 returns to the operator (no auto-adopted proto field). Both suites assert the literal key.\n\n7. AC-4 forcing: extend test_pit_outage_raises_and_score_strategy_aborts_unavailable (analysis tests/test_grade_fundamentals_exclusion.py:195-207): UNAVAILABLE with exact text, no set_trailing_metadata, no upsert/delete. Agent side patches client.score_strategy to raise AioRpcError(UNAVAILABLE, that text) and asserts the exact message; AC-3/AC-8 likewise with NOT_FOUND details.\n\n8. Docs/process: docstring, mcp-tools.md, strat-lab SKILL.md, agent CLAUDE.md row, one PLAT-* trailer-contract row in docs/context-constitution.md (service CLAUDE.md files point to it). Semantics to state precisely (adversary C-18): excluded_symbols = symbols left with NO surviving cell (_exclude_refused_cells :2798), NOT symbols with any refused window; always [] when the strategy is not guarded or analysis.backtest.fundamentals.enabled is off (:2825-2836), so [] does not mean 'guard ran and found nothing'; null = analysis did not report. Spec: amend FR-5 (null) and add append-only @AC-11 (do not edit AC-7). Merge-order prose note near merge-order.md:102 and :321-326; product-spec § Decisions 'two rows' -> 'prose note'. Final impl-spec step names the root-CLAUDE.md teardown (/context-forge:context-constitution refresh, or manual reconciliation recorded in the PR body, fails.md:670) because context files are touched.",
    "open_objections": [
      {
        "text": "BLOCKING (answered in approach item 4, must be carried into impl-spec): the call-object form of ScoreStrategy is invisible to the existing @AC-10 @feature-273 deadline guard (tests/test_client_deadlines.py _stub_calls :109-124 matches only ast.Await(Call(stub.X))). Required: extend _stub_calls to Assign/AnnAssign, add ScoreStrategy to _LONG_RPCS and _AC5_ROWS, re-check _MIN_STUB_CALLS, keep the fake-channel mock raising on await with trailing_metadata(). Stays open until the impl-spec carries these steps.",
        "blocking": true
      },
      {
        "text": "BLOCKING (needs the real operator gate; not coverable by a design synthesis): six spec/acceptance changes go beyond the binding operator decisions and need explicit operator sign-off, per fails.md:66-68 any self-run gate is provisional: (1) FR-5 amendment 'null = analysis did not report'; (2) new append-only @AC-11; (3) AC-10 parser scope; (4) new row in feature 273's durable @AC-5; (5) new canonical operations line in strat-lab SKILL.md; (6) rewriting product-spec § Decisions 'two rows' -> 'prose note' (reconciles an operator-recorded decision with the binding 'prose note' decision).",
        "blocking": true
      },
      {
        "text": "RESOLVED (r2), carry into impl-spec: loopback test must include GrpcAioInstrumentorServer (OTel) plus _CancelStatusInterceptor; if it fails FR-5 returns to the operator.",
        "blocking": true
      },
      {
        "text": "RESOLVED (r2), carry into impl-spec: None+WARN path needs its own real-channel hung_backend case with answers={'ScoreStrategy': (0, StrategyScore(...))}.",
        "blocking": true
      },
      {
        "text": "Editing 273's durable @AC-5 row is an EXTEND of another feature's suite (C-16); record it in context.md with sign-off. Recon's 'no CHANGE flags, no sign-off needed' no longer holds.",
        "blocking": false
      },
      {
        "text": "Server-side cancellation under the 45 s deadline can leave memory/DB divergence in the score-is-None branch (:2618 pop before :2621 delete); pre-existing. Record as known limitation in context.md/findings; docstring must not claim atomic refresh; write=True 'outcome unknown' message is correct.",
        "blocking": false
      },
      {
        "text": "excluded_symbols semantics (symbols with no surviving cell; [] when strategy unguarded or fundamentals gate off) must be stated in docstring and runbook so operators do not misread [] as 'guard ran, nothing found'.",
        "blocking": false
      },
      {
        "text": "Parity-guard parsers must anchor on regex markers, not line numbers; the impl-spec must forbid line-number anchoring (rebase brittleness with 215/275/281).",
        "blocking": false
      },
      {
        "text": "New PLAT-* row and agent CLAUDE.md edit trigger the root CLAUDE.md teardown audit; name it in the final impl-spec step.",
        "blocking": false
      },
      {
        "text": "Trailer key is an untyped cross-service contract: record once in docs/context-constitution.md (PLAT-* row), reference from CLAUDE.md files; both suites assert the literal.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-8",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-9",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-7",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-11 (new, null excluded_symbols)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-10",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5 @feature-273",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-10 @feature-273",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-6 @feature-273",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-1 @feature-214",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-1/2/3/4/6 @feature-149",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3 @feature-215",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Additive StrategyScore.excluded_symbols proto field (option A): ruled out by binding operator decision; returns to operator only if the trailer loopback test fails.",
      "Comma-joined trailer with empty string for 'none excluded': empty-value presence is fragile and comma-ambiguous; replaced by JSON array (always non-empty).",
      "STRATEGY_OPERATIONS hoist replacing literal op_map: lost to minimum-diff/greppable constants; enum anchor lives in the parity test.",
      "Missing trailer -> [] plus WARN: fabricates 'nothing excluded' (P-03); None plus WARN chosen.",
      "Response header (initial metadata) instead of trailer: excluded only final after aggregation.",
      "Agent derives excluded via GetStrategy plus evidence reads: no evidence-listing RPC, duplicates guard logic (C-18).",
      "Read excluded from analysis.strategy.scored ledger payload: best-effort emit, racing second RPC, alters shared payload.",
      "Encode excluded into component_scores via sentinel key: pollutes numeric map.",
      "Keeping 10 s _RPC_TIMEOUT_S for score: cancels handler before _persist_strategy_score.",
      "Editing shared _grpc_error_message (or adding a pass_not_found_detail flag) to pass NOT_FOUND detail: touches shared mapper; local call-site passthrough is smaller and correct.",
      "Re-sorting/deduping in the servicer edit: redundant with _exclude_refused_cells.",
      "Async kick-then-poll ScoreStrategy: changes ScoreStrategy semantics, loses synchronous NOT_FOUND/UNAVAILABLE contract.",
      "Server-side context.time_remaining() guard before persist: would fix cancellation divergence but changes ScoreStrategy semantics; recorded as follow-up, out of scope.",
      "grpc.aio with_call-style API to keep the awaited form: does not exist in grpc.aio; call-object form is forced, so the guard is fixed instead.",
      "New score_strategy tool or admin gating: ruled out by operator decisions."
    ],
    "open_risks": [
      "Success-path trailer through the production analysis stack (aio server, _CancelStatusInterceptor, OTel GrpcAioInstrumentorServer, owner_scoped, mTLS) into the agent call-object read has no in-repo precedent; if any layer drops it every result shows excluded_symbols null, AC-7 fails, FR-5 returns to the operator. Loopback test is the first execute step and go/no-go gate.",
      "45 s may be insufficient for cold PIT fundamentals on large guarded strategies (ceil(symbols/4) x 8 pages x 10 s) and sits near the MCP client's 60 s limit; timeout leaves grade unchanged (if before persist) and reports outcome unknown.",
      "Server-side cancellation memory/DB divergence at :2618/:2621 (pre-existing); stale grade could be restored by hydrate_scores at restart.",
      "Header size: excluded lists beyond the ~8 KiB gRPC metadata limit unhandled; JSON encoding is slightly larger than CSV but a few hundred tickers is ~4 KiB at worst.",
      "Textual conflicts on manage_strategy and the same docs with features 215/275/281; top-of-function branch and marker-anchored parsers minimise this; 283 integration waits on 215 (on trunk).",
      "Deploy skew (older analysis without trailer) yields null excluded_symbols, a third state operators must understand.",
      "Empty list is ambiguous when the fundamentals gate is off or the strategy is unguarded; mitigated by docs only.",
      "Six spec/acceptance changes lack operator sign-off; any design-gate approval run by a nested subagent is provisional (fails.md:66-68).",
      "The unread-this-round assumption that hung_backend answers returns success without a trailer (conftest.py:172-175) must be confirmed when writing the test."
    ],
    "constitution_rules_touched": [
      "C-10",
      "C-11",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-03",
      "P-04",
      "PLAT-4",
      "PLAT-5",
      "PLAT-13",
      "AGENT-4",
      "PLAT-N1"
    ],
    "rationale": "The r3 proposal is sound against all binding operator decisions (operation='score', no proto field, owner scoping, separate RPC route, local NOT_FOUND passthrough, AC-9 pre-call rejection, docstring plus executable parity guard, AC-4 forcing) and the adversary found no Floor breach. I adopt the adversary's first blocker concretely: the call-object form escapes the @AC-10 deadline AST guard, so _stub_calls, _LONG_RPCS, _AC5_ROWS and the fake-channel mock are all extended. I adopt the JSON-array trailer encoding because it removes the empty-value-versus-missing fragility and comma ambiguity at no real cost, strengthening the None-means-not-reported contract. The second blocker (six spec/acceptance changes beyond the operator decisions, including rewriting an operator-recorded product-spec line) cannot be settled by synthesis and stays open for the real operator gate; I do not mark those changes covered. Non-blocking items are carried as documentation and test constraints: precise excluded_symbols semantics, marker-anchored (not line-number) parsers, the 45 s cancellation limitation recorded rather than fixed, the 273 @AC-5 EXTEND sign-off, and the teardown audit step. The residual technical uncertainty remains the trailer delivery path, gated by the loopback test with explicit escalation to the operator."
  },
  "floor_breaches": []
}
```

## Session 2026-11-01 — sdd-design (by hand, continuing the sdd-batch rounds)

- Phase 0 Recon: reused recon.md written by the sdd-batch run (services: agent, analysis; reuse: `get_strategy` projection, `update`-branch ValueError shape, descriptor-parity tests). Verified current, not re-run.
- Phase 1 Grilling: 5 rounds (full; hard cap). Rounds 1-3 ran under sdd-batch (halted at the gate each time); the batch preflight then failed twice on a model-safeguard error, so rounds 4-5 were run by hand with design-proposer/design-adversary mediated by the orchestrator (P-02). Chosen approach: `manage_strategy operation='score'` + analysis sets trailer `x-score-excluded-symbols` (compact JSON array, 4096-byte cap) read via the call-object form; missing trailer = `excluded_symbols: null` + WARN. Rejected: additive proto field, comma-joined trailer, response header, ledger-payload read, agent-side derivation, truncation, PLAT row, parser with line anchors, dead try/except.
- Constitution rules touched: C-11, C-14, C-15, C-16, C-18, P-01..P-04, P-06, F-04, F-07. Floor breaches: none in any round.
- Operator sign-offs at the round-5 gate: FR-5 "null = analysis did not report" + new append-only `@AC-11` (spec/acceptance amended); EXTEND of feature 273's durable `@AC-5` Examples table with `| ScoreStrategy | 45.5 |` (lands in the implementation step that adds the test-only `_AC5_ROWS` tuple — keep the two in step). Product-spec merge-order wording corrected to "one table row + prose launch-gate note".
- Open Threads (target step): (1) client-side OTel may swallow trailers — execute step 1 loopback with production instrumentors, own-interceptor fallback, else FR-5 back to operator; (2) 45 s budget vs worst-case paging — docstring/runbook note; (3) untyped trailer contract — comments + literal-key asserts + agent CLAUDE.md row; (4) oversize-trailer error unverified — cap exists so it never matters; (5) pre-existing cancel divergence `servicer.py:2618` vs `:2621` — not fixed here; (6) `_stub_calls` must match each call once and `_MIN_STUB_CALLS` pinned to the exact new count (73 → 74) with red/green shown; (7) docs-parity test must compare operation SETS and fail before the docs edit; (8) final step = root CLAUDE.md teardown with real manual reconciliation if the plugin is unavailable (`fails.md:670`); (9) staging confirmation: one manual `score` call, non-null `excluded_symbols`, only meaningful if staging has `OTEL_ENABLED=true`.
- Status: spec-ready → design-approved.

## Session 2026-11-01 — sdd-spec

- Generated implementation-spec.md with 10 steps. Status → implementation-ready. Both design artifacts consumed; recon `Codebase Map` reused, line anchors re-verified against the tree at `4fb1d97f` (all matched).
- Key codebase findings:
  - **Design refinement 1 — loopback split.** design.md § 6 has analysis `tests/test_telemetry.py` drive the agent's real `client.score_strategy`; impossible in one process (both services ship a top-level `app` package, separate `uv` envs). Spec splits it: agent half (Steps 1-2, real client + `GrpcAioInstrumentorClient` over a real channel via `hung_backend`) and analysis half (Steps 3-4, real servicer behind `server_interceptors()` + `GrpcAioInstrumentorServer`, raw client). Analysis half is a new `tests/test_score_trailer_loopback.py`, insecure port (TLS does not alter metadata). Both suites' `otel_reset` fixtures no-op `instrument()` (analysis `conftest.py:513`, agent `conftest.py:265`), so the new tests must not use them.
  - **Design refinement 2 — `_stub_calls`.** "Match each `ast.Call` once" is wrong as stated: measured on `app/client.py`, awaited-only matcher = 73, every `Call` on `stub`/`Call` receiver = 82 (9 non-RPC calls such as `.isoformat()`/`.lower()`). The spec adds one `ast.Assign` branch restricted to receiver `Name('stub')` ⇒ exactly 74 (verify 73 red / 74 green at execute).
  - **Design refinement 3 — `hung_backend` trailers.** Reply tuple gains an optional third element so real-channel trailer tests reuse the fixture (`tests/conftest.py:146-208`).
  - `merge-order.md` already carries the 283 → 215 row (`:102`) and the "Launch gate: 215 ↔ 283" note (`:321-329`); no edit step needed.
  - `SCHD_PIT_PERIODS = []` (`xstockstrat-analysis/tests/conftest.py:116`) is the "no fundamentals" fixture; `_owned_ctx()` is a `MagicMock`, so `ctx.set_trailing_metadata` is directly assertable.
  - Pre-existing drift noticed, not fixed here: `docs/runbooks/mcp-tools.md` `### manage_strategy` still opens "Admin-scoped write" though ownership-gating landed in feature 133 (agent `CLAUDE.md:125`); worth a findings-log line.
  - Agent and analysis CI coverage thresholds are both 40% (`ci.yml` matrix).
- Open for `/sdd-review impl-spec`: challenge refinements 1-3; Step 2/4 contingency (own client interceptor touching `app/mtls.py`) is listed in `**Files**` for F-08 but only used if the OTel client wrapper swallows trailers.

## Session 2026-11-01 — sdd-review impl-spec (advisory)

- Result: converged after 5 passes — pass 1: 5 failures + 7 warnings; pass 2: 0 + 6; pass 3: 1 + 1; pass 4: 1 + 2; pass 5: **0 failures, 0 warnings (CONVERGED)** (advisory — did not block). Lifecycle unchanged (`implementation-ready`).
- Fixed across passes: Steps 5/6 swapped so the tool tests (incl. `_LONG_TOOLS`/`_MUTATING_PREFIXES` guard + hung-backend case) precede the `score` branch (P-06); `--cov-fail-under=40` added to the test steps; Step 2 / Step 10 Files lists cover contingency and conditional files (F-08); Step 3 anchors re-pointed by symbol; redundant "four ops" parity test dropped; Step 7 keeps a real RED (`_MIN_STUB_CALLS`=74 + `_LONG_RPCS`); Covers/Scenario Coverage reconciled for AC-1/AC-7 (C-15); stale step pointers and change-history prose removed.
- Unresolved ✗ / ⚠ carried into execution: none.
- Overlap findings (no FAIL-level): same-function overlap with 215 on analysis `ScoreStrategy` (`servicer.py`) and `tests/test_grade_fundamentals_exclusion.py` — rebase and re-anchor by symbol after 215's final edits; disjoint-function overlap with 215/275/281/282 in agent `tools.py`/`client.py` and soft overlap on `mcp-tools.md`, `SKILL.md`, agent/analysis `CLAUDE.md`. `merge-order.md` row 102 corrected: 215's spec does not edit `manage_strategy` (was claimed as same-function).

## Session 2026-11-01 — sdd-execute re-spec (sdd-batch-execute)

- Merged `origin/main-dev` into the detached `origin/feature/expose-score-strategy-mcp` checkout: already up to date (no conflicts); `scripts/ledger-guard.py --own-slug expose-score-strategy-mcp --base origin/main-dev --fix` reported clean (no repair).
- Re-verified Steps 1-10 against the current tree: no blocking mismatch; every cited symbol resolves, and the expected-absent symbols (`client.score_strategy`, `_EXCLUDED_TRAILER_*`, the `score` branch, both `test_score_trailer_loopback.py` files, `test_score_strategy_parity.py`) are still absent, so the planned REDs hold. `import json` is still missing from agent `client.py` (Step 2 Instruction 2 adds it). AST matcher on `client.py` re-measured at 73 awaited stub calls, 0 `Assign = stub.X(...)` (Step 7's 73→74 plan holds). Locked protobuf 6.33.6 exposes `FieldDescriptor.has_presence` (Step 8).
- Line anchors re-pointed (symbols authoritative): `test_tools.py` `_make_server`/`_tool_fn` :23/:29, description :1106, `.parameters` :1083, docs guard :1101, `test_grpc_error_reraised_as_clear_message` :1215; `test_pit_outage_…` :196; `test_ac5_listed_rpcs_…` :81; `SKILL.md` Scope :15; analysis `CLAUDE.md` Evidence exclusion (H) :464-467. Instructions, Files and Verification unchanged.

## Session 2026-11-01 — sdd-execute sequential (sdd-batch-execute)

- Mode: `/sdd-execute expose-score-strategy-mcp sequential`, run by the sdd-batch-execute workflow in its own worktree (sole writer, P-01). The operator approved the up-front plan (the sequential mode-entry confirmation, given once for this feature); per-step operator checkpoints still apply.
- Status: `implementation-ready` → `in-progress`. Branch base: `origin/feature/expose-score-strategy-mcp` merged with `origin/main-dev` (already up to date) and re-spec committed first (see the session above).
- Next: Step 1 (agent client-half loopback, RED).

### Step 1 — test: agent client-half production-wiring loopback (RED) — 2026-11-01

- Sub-step 0 (installed OTel, `opentelemetry-instrumentation-grpc` 0.66b1 in the agent `.venv`): (a) `GrpcAioInstrumentorClient` has `instrument()` and `uninstrument()` (`BaseInstrumentor.uninstrument`, `instrumentor.py:119`; `_uninstrument` restores `grpc.aio.insecure_channel`/`secure_channel`, `grpc/__init__.py:537-539`). (b) The aio unary client interceptor returns the **call object**, not the response (`_aio_client.py` `_wrap_unary_response`: `call = await continuation()` … `return call`). Also: `_add_interceptors` **prepends** OTel's interceptors to any caller-supplied `interceptors=` (`grpc/__init__.py:495-515`), which is what Step 2's contingency needs.
- `hung_backend` replies accept an optional third element `trailers` (`delay_s, outcome, *rest = reply`; `context.set_trailing_metadata(rest[0])` after the abort branch). Existing 2-tuple users unchanged: `test_tool_deadlines.py`, `test_client_deadlines.py`, `test_auth_deadline.py` → 42 passed.
- New `tests/test_score_trailer_loopback.py`: `instrument_client` fixture (params plain/instrumented, real `GrpcAioInstrumentorClient().instrument()`/`.uninstrument()`, no `otel_reset`); populated (both), empty `[]`, absent → `None` + 1 WARN, malformed ×4 → `None` + 1 WARN (instrumented), `_EXCLUDED_TRAILER_KEY` literal.
- TDD (AC-1, AC-7, AC-11) red: 9 failed — 8× `AttributeError: module 'app.client' has no attribute 'score_strategy'`, 1× `... no attribute '_EXCLUDED_TRAILER_KEY'` → green due in Step 2. Full suite with coverage: 9 failed (the new tests only), 613 passed. `ruff check` + `ruff format --check` clean.

### Step 2 — service: agent `client.score_strategy` (go/no-go gate: client half) — 2026-11-01

- `app/client.py`: top-level `import json`; `_EXCLUDED_TRAILER_KEY = "x-score-excluded-symbols"` beside `_LONG_RPC_TIMEOUT_S`; `score_strategy(user_id, strategy_id)` after `get_strategy` (call-object form, `_LONG_RPC_TIMEOUT_S`, `x-user-id` via `_metadata`, `get_strategy` projection + `excluded_symbols`); parsing in a private `_parse_excluded_trailer` (missing / `md is None` / bad JSON / non-`list[str]` → `None` + one WARN, never `[]`); `manage_strategy` unknown-operation `ValueError` now ends `; 'score' is routed to ScoreStrategy)`.
- **Gate: GREEN through the production client instrumentor** — `test_score_trailer_loopback.py` 9 passed incl. every `instrumented` case, so the OTel aio client wrapper does not swallow trailers. **Contingency not triggered**: `app/mtls.py`, `app/trailer_capture.py` and the `conftest.py` `secure_channel` lambda are untouched.
- TDD red (from Step 1): 9 failed (`AttributeError` on `score_strategy` / `_EXCLUDED_TRAILER_KEY`) → green: 9 passed. Verification: loopback + `test_client.py` 76 passed; full suite `--cov=app --cov-fail-under=40` 622 passed, 84.36%; ruff check + format clean.
- `ScoreStrategy` is not yet seen by the `@AC-10` AST deadline guard (call-object form, not awaited) — expected; Step 7 extends `_stub_calls` (73 → 74).


### Step 3 — test: analysis trailer unit tests + server-half production-wiring loopback (RED) — 2026-11-01

- Sub-step 0 (installed OTel, `opentelemetry-instrumentation-grpc` 0.66b1 in the analysis `.venv`): `GrpcAioInstrumentorServer` has `uninstrument()` (`BaseInstrumentor`); `_instrument` swaps the module attribute `grpc.aio.server` for a wrapper that prepends `aio_server_interceptor` to `interceptors=`, so it must be installed **before** `grpc.aio.server(...)` is built. `_uninstrument` restores the original.
- `tests/test_grade_fundamentals_exclusion.py`: imports `_EXCLUDED_TRAILER_KEY`/`_EXCLUDED_TRAILER_MAX_BYTES`; new literal test (key + 4096 cap); success-path AC-7 (`'["SCHD"]'`, `evidence_symbols == 2`), none-excluded (`"[]"`), sorted+deduped (`'["QQQ","SCHD"]'`), over-cap (cap monkeypatched to 5 → no trailer + WARNING); abort paths assert no trailer: AC-4 extension (+ no upsert/delete), AC-8 extension (exact excluded message), new AC-3 (`_blend_svc([])`, delete awaited) and AC-2 (not owned, no upsert/delete). Success-path cases carry an eligible AAPL cell (see Deviation Log).
- New `tests/test_score_trailer_loopback.py`: `production_wiring` fixture (`OTEL_ENABLED=true`, real `GrpcAioInstrumentorServer().instrument()`/`.uninstrument()`, no `otel_reset`); real servicer via imported `_blend_svc`/`_cell` (C-13: no second fixture copy) behind `grpc.aio.server(interceptors=server_interceptors())` (asserts `_CancelStatusInterceptor` present); raw `unary_unary` client with the header trio; populated `'["SCHD"]'`, present-empty `"[]"`, aborted NOT_FOUND carries no key.
- TDD (AC-2, AC-3, AC-4, AC-7, AC-8) red: both files `ImportError: cannot import name '_EXCLUDED_TRAILER_KEY'` (the spec's stated RED). Behavioral-RED and green-reachability probe with a **temporary, reverted** Step-4-shaped `servicer.py` (not committed): constants only → 6 failed (`set_trailing_metadata` called 0 times ×3, no WARN, wire key absent ×2), 23 passed; constants + trailer block → 29 passed through the real instrumentor + `_CancelStatusInterceptor`. Green is due in Step 4.
- Verification: full suite `--cov=app --cov-fail-under=40 --continue-on-collection-errors` → 1479 passed, 2 collection errors (the two RED files only); `ruff check` + `ruff format --check` clean; C-13 grep shows `from tests.test_grade_fundamentals_exclusion import _blend_svc, _cell`.

### Step 4 — service: analysis `ScoreStrategy` sets the excluded-symbols trailer (go/no-go gate: server half) — 2026-11-01

- `app/handlers/servicer.py`: `_EXCLUDED_TRAILER_KEY = "x-score-excluded-symbols"` and `_EXCLUDED_TRAILER_MAX_BYTES = 4096` after `_INTERACTIVE_DERIVATION_CONCURRENCY` (2-line constraint comment); in `ScoreStrategy`, after the ledger-emit try/except and immediately before `return score`, `json.dumps(excluded, separators=(",", ":"))` → over-cap = one `log.warning` and no trailer, else `context.set_trailing_metadata(((_EXCLUDED_TRAILER_KEY, encoded),))`. Abort paths, `_fetch_and_aggregate`, `_exclude_refused_cells`, grade maths and proto untouched; no try/except around the trailer call.
- **Gate: GREEN through the production server wiring** — `test_score_trailer_loopback.py` passes behind `server_interceptors()` (`_CancelStatusInterceptor`, `OTEL_ENABLED=true`) + a real `GrpcAioInstrumentorServer`: populated `'["SCHD"]'`, present-empty `"[]"`, aborted NOT_FOUND carries no key. With Step 2's client gate also green, both go/no-go gates hold; no proto field, FR-5 stays as designed.
- TDD red (from Step 3, re-captured before implementing): 2 collection errors, `ImportError: cannot import name '_EXCLUDED_TRAILER_KEY' from 'app.handlers.servicer'` → green: `test_grade_fundamentals_exclusion.py` + `test_score_trailer_loopback.py` + `test_analysis_servicer.py` 418 passed.
- Verification: full suite `--cov=app --cov-fail-under=40` 1508 passed, 90.26%; `ruff check` + `ruff format --check` clean; `git diff --stat -- packages/proto` empty. No CI-equivalent fallback used (pytest/ruff ran natively).

### Step 5 — test: agent tool + client unit tests and tool-deadline guards for `score` (RED) — 2026-11-01

- `tests/test_tools.py`: new `TestManageStrategyScore` (after `TestManageStrategyTool`; `import inspect`, `import re`): AC-1 (grade returned unchanged, `score_strategy` awaited once with `user_id="u-1", strategy_id=…`, no `access_scope`, snake_case keys), AC-7 (`excluded_symbols` passed through), AC-2/3/4/8 parametrized (server detail surfaces in the `RuntimeError`; reuses the file's `_rpc_error`, C-13), AC-9 (example args, `clear_fields=[]`, and the `inspect.signature` backstop over every non-`ctx`/`operation`/`strategy_id` parameter, each with `client.manage_strategy`/`score_strategy` not awaited), AC-5 (description: `analysis.strategy.scored`, `persists`, a range…ignored clause, `'score'` on the `operation:` line).
- `tests/test_client.py`: new `TestScoreStrategyClient` with an inline awaitable `_FakeCall` exposing `trailing_metadata()` (single consumer, C-13): trailer present → `["SCHD"]`; `trailing_metadata()` → `None` gives `excluded_symbols is None` + one WARN (AC-11 unit half); request has `strategy_id` and no `range`, metadata carries `("x-user-id", "u-owner")`, `timeout == client._LONG_RPC_TIMEOUT_S`. `test_unknown_operation_raises` now matches `'score' is routed to ScoreStrategy`. These are green already (Step 2), as the spec states.
- `tests/test_tool_deadlines.py`: `_score_strategy` in `_LONG_TOOLS`, `_score_` in `_MUTATING_PREFIXES`; new `test_manage_strategy_score_hung_analysis_surfaces_long_deadline` (hung `ANALYSIS_ENDPOINT`, `within 0.6s (deadline exceeded)` + `outcome unknown, verify before retrying`, `elapsed < _LONG_S + _SLACK_S`, `entered == 1`). `test_fr3_worst_cases_fit_under_57s` unchanged (PRESERVE `@AC-6 @feature-273`).
- TDD (AC-1, AC-2, AC-3, AC-4, AC-5, AC-7, AC-8, AC-9, AC-11) red: 12 failed — 8× `ValueError: unknown operation 'score'` from `client.manage_strategy` (no `score` branch), 2× AC-9 `DID NOT RAISE`/regex mismatch, AC-5 `'analysis.strategy.scored'` not in description, `long_seen` missing `_score_strategy`; 208 passed in the three files. Green-reachability probe with a **temporary, reverted** Step-6-shaped `tools.py` (not committed): 220 passed. Green is due in Step 6.
- Verification: full suite `--cov=app` → 12 failed (the RED cases only), 624 passed, coverage 84% (the 40% gate re-runs after Step 6); `ruff check` + `ruff format --check` clean; `def _rpc_error` grep shows only the two pre-existing copies (`test_tools.py`, `test_tool_deadlines.py`), no new one. No CI-equivalent fallback used.

### Step 6 — service: agent `manage_strategy operation='score'` — 2026-11-01

- `app/tools.py`: module-level `_score_strategy(ctx, strategy_id)` between `_grpc_error_message` and `_EXTRACTOR_TOOL_MAP`. It resolves `x-user-id` via `_caller_user_id` (owner-scoped; no admin gate, no `_caller_access_scope`) and calls `client.score_strategy`. Its own catch site passes `not_found=e.details() or "no eligible evidence"`, `deadline_s=client._LONG_RPC_TIMEOUT_S` and `write=True`. The shared mapper is not edited.
- `manage_strategy`: the first statement after the docstring is `if operation == "score":`. It builds the 11-name `given` list (ten definition args plus `clear_fields`), raises `ValueError("manage_strategy(operation='score') accepts only strategy_id; got: …")` before any identity resolution or client call, and otherwise returns `_score_strategy`. `supplied`/`mask`/`update_mask`, the `update` empty-mask guard and the `client.manage_strategy` call are untouched.
- Docstring changes:
  - The summary line and the `operation:` line now include `score`.
  - A new `SCORE (feature 283)` paragraph sits before `RESPONSE CASING`. It covers: only `strategy_id`; recomputes and persists the grade; the `analysis.strategy.scored` event; range ignored; the snake_case fields; the `excluded_symbols` `[]`/`null` semantics; PERMISSION_DENIED/NOT_FOUND/UNAVAILABLE; and that a deadline means the outcome is unknown, so verify with `list_strategies`.
  - `RESPONSE CASING` gains the `score` snake_case clause.
  - The module docstring line is updated and wrapped for E501 (see the Deviation Log). The "forty-five" tool-count text is unchanged.
- TDD (paired RED from Step 5, re-captured before implementing): 12 failed, 147 passed in `test_tools.py` + `test_tool_deadlines.py` + `test_tools_endpoint.py`. The failures were 10× `TestManageStrategyScore`, the hung-analysis deadline case, and `test_every_catch_site_passes_deadline_s` (`long_seen` missing `_score_strategy`). After implementing: 159 passed.
- Verification:
  - The three files: 159 passed.
  - The grep shows `operation == "score"`, `_score_strategy` and `client._LONG_RPC_TIMEOUT_S` at the new catch site.
  - `ruff check` and `ruff format --check` are clean.
  - Full suite with `--cov=app --cov-fail-under=40`: 636 passed, 84.44%.
  - No CI-equivalent fallback was used.

### Step 7 — test: deadline guards, call-object matcher and the 273 durable row — 2026-11-01

- `tests/test_client_deadlines.py`: `_MIN_STUB_CALLS = 74`; `"ScoreStrategy"` added to `_LONG_RPCS` (reflowed one per line, E501); `_AC5_ROWS` gains `("ScoreStrategy", "ANALYSIS_ENDPOINT", lambda: client.score_strategy("u-1", "s-1"), _LONG)`; `_stub_calls` gains exactly one branch — an `ast.Assign` whose value is `Call(Attribute(Name('stub')))` yields `(fn.name, rpc, call)` — ahead of the unchanged `ast.Await` filter. No bare-`ast.Call` matching.
- `acceptance/fix-agent-client-deadlines.feature`: `| ScoreStrategy       | 45.5   |` appended after `TriggerBackfill` (signed-off EXTEND of `@AC-5 @feature-273`), same commit as the `_AC5_ROWS` tuple.
- TDD (C-16 preservation/extension of `@AC-5`, `@AC-6`, `@AC-10 @feature-273`) red: with the bump + `_LONG_RPCS` edit and the matcher unchanged, 1 failed / 21 passed — `AssertionError: matcher found only 73 stub calls` (`assert 73 >= 74`). Green after the Assign branch: matcher count exactly 74 (`('score_strategy', 'ScoreStrategy')` included); the fake-channel `ScoreStrategy` row passes with no mock change (`await call` raises `_Recorded` before `trailing_metadata()`), and the hung-backend row passes.
- Verification: `test_tool_deadlines.py` + `test_client_deadlines.py` 42 passed (incl. PRESERVE `test_fr3_worst_cases_fit_under_57s`); full suite `--cov=app --cov-fail-under=40` 638 passed, 84.44%; `ScoreStrategy` grep hits the test tuple, `_LONG_RPCS` and the feature row; `ruff check` + `ruff format --check` clean. No CI-equivalent fallback used.

### Step 8 — test: descriptor + operations-set parity guard, with the runbook and strat-lab skill edits it forces — 2026-11-01

- `tests/test_score_strategy_parity.py` (new). Every surface is located by a regex marker, never by line number.
  - `test_score_projection_covers_every_proto_field` pins `{f for f in StrategyScore.DESCRIPTOR.fields if f.has_presence} == {"origin"}` and checks that `client.score_strategy`'s keys minus `excluded_symbols` equal the no-presence descriptor fields. `FieldDescriptor.has_presence` is present in the locked protobuf, so the fallback was not needed.
  - `test_operation_sets_match_the_enum_on_every_surface` checks that `StrategyOperation` minus `UNSPECIFIED`, plus `score`, matches four surfaces: the tool summary line, the docstring `operation:` line, the runbook `| \`operation\` |` row inside `### \`manage_strategy\``, and the new canonical `SKILL.md` line.
  - `test_score_side_effects_are_documented_on_runbook_and_skill` is parametrized over the runbook and skill (AC-10): `analysis.strategy.scored`, `persists`, and a range…ignored clause.
  - The fake call and `_channel_cm` come from the `tests.test_client` module (see the Deviation Log).
- `docs/runbooks/mcp-tools.md`, inside `### \`manage_strategy\`` only:
  - `"score"` is added to the `operation` row.
  - Seven `score` rows are added to **Errors**: client-side `ValueError`, PERMISSION_DENIED, both NOT_FOUND variants with the stale grade cleared, the availability-unknown UNAVAILABLE, the store-down UNAVAILABLE variants, and the 45 s deadline.
  - A `**\`score\` (feature 283).**` block follows "Effect on the derived grade". It covers: owner-scoped, not admin-gated; `strategy_id` only; persists the grade and emits `analysis.strategy.scored`; range ignored; a snake_case field table with `excluded_symbols` `[]`/`null` semantics; a Return example; and the 45 s budget with the `ceil(symbols/4) × 8 × 10 s` bound, plus "verify with `list_strategies`".
  - The count text was not touched.
- `plugins/strat-lab/skills/backtest/SKILL.md`:
  - The canonical line `` `manage_strategy` operations: `register` | `update` | `deactivate` | `reactivate` | `score` `` is added after the Scope paragraph.
  - The Ownership paragraph now names `manage_strategy` "(every operation, `score` included)".
  - A new **Refreshing the grade (feature 283)** paragraph follows the Mutation guard.
  - Frontmatter is untouched. No plugin version bump: the manifests were not edited.
- Pre-existing drift, not fixed here (for the findings log):
  - The runbook `manage_strategy` opener still says "**Admin-scoped write**", although the section has been ownership-gated since feature 133 (agent `CLAUDE.md` § Management-tool authorization). The new `score` block states "owner-scoped, not admin-gated" explicitly.
  - The `client.manage_strategy` docstring also still says "admin-scoped".
- TDD (AC-6, AC-10):
  - RED: 3 failed, 1 passed. The failures were the runbook operation set missing `score` (the docstring surfaces already passed after Step 6), plus the runbook and SKILL.md missing `analysis.strategy.scored`. The projection test was already green from Step 2.
  - GREEN after the docs edits: 4 passed.
- Verification:
  - `test_tools_endpoint.py` + `test_tools.py`: 139 passed. This includes the AC-6 count guard (45) and the feature-149 docs guard, both PRESERVE.
  - Full suite with `--cov=app --cov-fail-under=40`: 642 passed, 84.44%.
  - `ruff check` and `ruff format --check` are clean.
  - `validate.py --self-test` and `validate.py` are OK.
  - No CI-equivalent fallback was used.


### Step 9 — docs: service CLAUDE.md files and scoring doc — 2026-11-01

- `services/xstockstrat-agent/CLAUDE.md`:
  - The `manage_strategy` tool-table row now reads register/update/deactivate/reactivate, plus "`operation='score'` refreshes the headline grade (owner-scoped, feature 283)".
  - A new paragraph after the feature-133 ownership-gated paragraph names the trailer contract: key `x-score-excluded-symbols`, a compact JSON array of strings, read via the call-object form; missing or unparseable ⇒ `excluded_symbols: null` plus WARN; the key literal is asserted in both services' `tests/test_score_trailer_loopback.py`; a second trailer would justify a `PLAT-*` row (not added).
  - The "forty-five" count text was not touched.
- `services/xstockstrat-analysis/CLAUDE.md`: one sentence on the **Evidence exclusion (H)** bullet. It says a successful ScoreStrategy sets the trailer (`"[]"` when none or the guard does not apply; omitted above 4096 bytes and on every abort path), consumed by the agent's `manage_strategy operation='score'`. These semantics were checked against `servicer.py` (`_EXCLUDED_TRAILER_MAX_BYTES = 4096`, set only on the success return) and `client._parse_excluded_trailer`.
- `services/xstockstrat-analysis/docs/scoring.md`: one clause on the manual-refresh paragraph. It says the refresh is reachable via the agent tool and reports excluded symbols through the trailer.
- `merge-order.md` and the root `CLAUDE.md` were not touched.
- TDD: N/A (docs).
  - Baseline: before the edits, the trailer-key grep matched nothing in the three files (exit 1).
  - After the edits, the grep hits all three files (agent `:134`, analysis `:468`, scoring `:45`), and `forty-five` is unchanged (`:44`, `:50`).
- Verification:
  - `test_tools_endpoint.py`: 9 passed (AC-6 count surfaces).
  - As an extra check, `test_tools.py` + `test_score_strategy_parity.py`: 134 passed.
  - No CI-equivalent fallback was used.
