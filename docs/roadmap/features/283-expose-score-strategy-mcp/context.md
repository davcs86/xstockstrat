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
