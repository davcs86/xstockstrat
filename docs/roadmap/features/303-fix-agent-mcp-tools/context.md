# Context Log: fix-agent-mcp-tools

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-07 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-11-07-agent-mcp-tool-error-details-masked-defect.md` (GitHub Issues disabled; report on PR #1470)
- Severity: SEV-3 (operator UX, no data loss, blocks diagnosis)
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), context.md
- Affected services (from report): xstockstrat-agent
- Root cause hypothesis: non-`ToolError` exceptions are masked by `mcp` 2.3.0 (`tools/base.py:211-213`); agent raises none of type `ToolError`
- Recommended design depth: skip → `/sdd-spec fix-agent-mcp-tools` (rationale: SEV-3, single service, no proto/migration/config, clear root cause). Open point for spec: whether ValueError/PermissionError refusals also become ToolError, and the secret-path review.
- Development branch: feature/fix-agent-mcp-tools

## Session 2026-11-07 (operator decisions on open points)

- OQ1 resolved: **yes** — the `ValueError` and `PermissionError` validation refusals in `app/tools.py` also become `ToolError`, alongside the gRPC-mapped `RuntimeError` sites. Scope is therefore every tool-level anticipated refusal, not only backend gRPC errors.
- OQ2 resolved: **no review** of secret-adjacent paths (`set_config` on `is_secret` keys, `manage_account` credentials) before backend error details are forwarded. Operator decision; the spec adds no such step.
- Next: `/sdd-spec fix-agent-mcp-tools` (design depth stays skip).

## Session 2026-11-07 — sdd-design (Phase 0)

- Boot: status `draft` (Track C bug, `/sdd-review` skipped) and `feature/fix-agent-mcp-tools` created on origin from the PR #1470 branch — both confirmed by the operator. Tree: feature/fix-agent-mcp-tools@7bc411f ≡ origin/feature/fix-agent-mcp-tools.
- Phase 0 Recon: wrote recon.md (service: xstockstrat-agent; reuse: `_grpc_error_message` `app/tools.py:225-254`, `_CountingChannel` `app/mtls.py:39-56`, conftest fixture home `tests/conftest.py`).
- Post-Recon escalation (quick mode): scenario-recon classified 5 existing `@AC-*` as CHANGE (agent-broker-account-tools @AC-2/3/7/8, mcp-watchlist-tools @AC-9 — Thens name RuntimeError/ValueError literally). Operator chose **Upgrade to full** (min 2 debate rounds, cap 5). One-way; never downgraded.
- CHANGE sign-off for those 5 rules is still pending — to be requested at the Phase-1 gate.

## Session 2026-11-07 — sdd-design (Phase 1, round 1 of full)

- Proposer R1: per-site explicit `ToolError` (47 gRPC sites + hand-written/ValueError/PermissionError refusals), code-name prefix once in `_grpc_error_message`, per-tool `except ValueError` for client.py arg errors, @AC-1 + surface sweep + AST guard tests, docs parity. Rejected: server middleware, per-tool decorator.
- Adversary R1: verdict NEEDS WORK, **Floor status: none**. Adopted without a user fork: (1)(2) tests must inject admin claims via `_claims_from_context` or they can never go green / prove nothing; (3) do NOT rewrite strat-lab lines `SKILL.md:202`, `reference/backfill.md:40-41`, `mcp-tools.md:344` (analysis-side `type(e).__name__` warning, still accurate; also `self-grill.md:45`, `output-handling.md:37`) — add one new sentence on the new tool-error shape instead; (5) typed `ClientArgumentError(ValueError)` in client.py instead of blanket `except ValueError` (avoids forwarding response-mapping bugs and `set_config` int()/float() secret echo at `client.py:2310-2312`); (8) `_extract_from_bytes:2609` converts with fixed text, no `{e}`; (9)(10) AST guard inverted (any `raise` in tool bodies must be `ToolError` unless allowlisted); (11) per-file list of pytest.raises that must NOT flip (mtls, header_propagation, startup_snapshot, strategy_builders, client rows).
- Forks surfaced to the operator at the R1 gate: central-wrapper vs per-site mechanism; NOT_FOUND server-message handling; INTERNAL/UNKNOWN/UNAVAILABLE detail passthrough. CHANGE sign-off for the 5 rules still pending.

## Session 2026-11-07 — sdd-design (Phase 1, round 1 gate → steer into round 2)

Operator steers at the R1 gate (AskUserQuestion), recorded verbatim in effect:
- **Mechanism: per-site explicit `ToolError`** (SDK's documented contract). Registration-time wrapper rejected; record its real trade-off in design.md (implicit convention "RuntimeError chained from AioRpcError", hand-written refusals still need per-site edits). The earlier "middleware cannot work" claim stands only for ServerMiddleware; the wrapper was rejected on preference, NOT because it breaks `FuncMetadata`/`Context` injection (it does not: `func_metadata.py:322`, `context_injection.py:27`).
- **NOT_FOUND: literal + server details** — `NOT_FOUND: <not_found literal>: <details()>` when details are non-empty; the documented literal and the 283 score substrings survive as substrings and the server hint (e.g. `pass create_key=true`) reaches the caller.
- **INTERNAL/UNKNOWN/UNAVAILABLE/DATA_LOSS: collapse to a safe fixed hint** (`CODE: <hint>`, e.g. 'upstream unavailable; retry shortly'); `details()` passed through only for the caller-actionable codes (FAILED_PRECONDITION, NOT_FOUND, PERMISSION_DENIED, INVALID_ARGUMENT, ALREADY_EXISTS, OUT_OF_RANGE, DEADLINE_EXCEEDED, UNAUTHENTICATED). Full text stays in server logs. This is distinct from OQ2 (no secret-path review) and does not relitigate it.
- Adopted without a fork (see round 1 entry): typed `ClientArgumentError(ValueError)`; claims-injected @AC-1/sweep tests; inverted AST guard; strat-lab lines left unchanged + one new sentence; `_extract_from_bytes:2609` fixed text; per-file pytest.raises migration list.
- Round 2 mandated (full mode: min 2); CHANGE sign-off for the 5 rules still pending.

## Session 2026-11-07 — sdd-design (Phase 1, round 2 of full → round 3)

- Proposer R2 (refined): mapper `CODE: body` for every result; NOT_FOUND literal+details with dedupe; allowlist pass-through / fail-safe collapse + server WARN; 47 sites -> `ToolError`; hand-written/ValueError/PermissionError refusals -> `ToolError` (:2347 is a caller refusal, recon was wrong); `ClientArgumentError` at the 21 explicit client.py sites + implicit date errors + non-echoing `set_config` casts; dispatch-level @AC-1 (exact `type(exc) is ToolError`) + `_PROBES` sweep == `list_tools()`; inverted AST guard; 68 flip / 23 stay of 91 `pytest.raises`; docs + one strat-lab sentence.
- Adversary R2: verdict NEEDS WORK, **Floor status: none**. Adopted without a fork: drop duplicate @AC-5 (keep @AC-2/3/4/6); mapper-equality asserts `tests/test_tools.py:2124-2126` flip; doc sweep adds `mcp-tools.md` :155,:303,:457,:510,:938,:972,:1146,:585,:586 and tool docstrings `tools.py:1538`,`:1083`; reuse `_mapper_calls` walker (`test_tool_deadlines.py:303-322`), bare `raise` allowed, `raise <Name>` fails; list implicit `float()/int()` arg casts (`client.py:169/171,:1219`) under FR-4 as deliberate crashes; `_iso_to_timestamp` also catches TypeError/OverflowError; fix wrong 'feature 273 pass-through' clause at `SKILL.md:234-236` (303 is the pass-through); log-level ERROR->INFO+WARN recorded as accepted; keep the `_PROBES` sweep + `list_tools()` equality + text assertion as the one thing never cut.
- Operator steers at the R2 gate:
  - **UNAVAILABLE: exact-message allowlist** (`pass_messages`): collapse UNAVAILABLE everywhere except two exact server strings passed verbatim — 'fundamentals availability unknown — grade unchanged' (expose-score @AC-4) and 'positions not published; re-confirm to retry' (trading `trading.go:1001`, feature 256 recovery hint). Cross-service string drift is not caught by CI — record in design.md.
  - **RESOURCE_EXHAUSTED and ABORTED: pass details through** (operator overrode the adversary's collapse default; pass-through set is now the operator's eight codes + these two).
  - **`ClientArgumentError(ToolError, ValueError)` in client.py** (removes the 15 per-tool clauses; client.py gains one SDK import).
  - **Gate: Run another round** (R3). Approve + the C-16 CHANGE sign-off for the 5 rules (broker @AC-2/3/7/8, watchlist @AC-9) are NOT yet given — still pending.
