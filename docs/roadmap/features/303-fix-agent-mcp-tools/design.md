# Design: fix-agent-mcp-tools

**Created**: 2026-11-07
**Rounds**: 5 (full; termination: approved at the hard cap, round 5 adversary verdict SOUND, no Floor breach)
**Approved by**: user @ 2026-11-07
**Grounded in**: recon.md

---

## Chosen Approach

Per-site explicit `ToolError` — the SDK's documented contract for an anticipated failure
(`mcp/server/mcpserver/exceptions.py:43-58`); everything else is masked to `Error executing tool <name>`
(`tools/base.py:208-213`, recon Codebase Map). Four seams:

1. **Mapper.** Extend the single gRPC formatter `_grpc_error_message` (`app/tools.py:225-254`, recon
   Patterns to REUSE) to always return `CODE: body`; add one keyword `pass_messages: frozenset[str]`.
   - Pass details through for FAILED_PRECONDITION, PERMISSION_DENIED, INVALID_ARGUMENT, ALREADY_EXISTS,
     OUT_OF_RANGE, UNAUTHENTICATED, RESOURCE_EXHAUSTED, ABORTED, and DEADLINE_EXCEEDED (server detail;
     the client sentinel keeps feature 273's wording and write-aware tail).
   - NOT_FOUND body = `d if (d and not_found in d) else (not_found if not d or d == not_found else
     f"{not_found}: {d}")`, so `_score_strategy`'s `not_found="no eligible evidence"` and
     `"watchlist not found"` dedupe and the config hint (`configServiceImpl.ts:824`) is appended.
   - UNAVAILABLE passes only an exact string in `pass_messages` (two sites: `_score_strategy` ←
     "fundamentals availability unknown — grade unchanged", analysis `servicer.py:2660-2663`;
     `manage_offline_account` ← "positions not published; re-confirm to retry", `trading.go:1001`).
   - Everything else collapses to a fixed hint and logs the withheld detail at WARNING on logger
     `app.tools` (`backend error withheld from tool caller: code=%s details=%r`):
     UNAVAILABLE/CANCELLED → "upstream unavailable"/"upstream call cancelled" + `retry shortly`
     (or `outcome unknown, verify before retrying` on writes); INTERNAL/UNKNOWN/DATA_LOSS/UNIMPLEMENTED/
     unlisted → "upstream error, details withheld; report it" (+ the write tail on writes).
   - Raise sites keep the `_grpc_error_message(...)` call shape the deadline AST guard walks
     (`tests/test_tool_deadlines.py:303-359`). Write flags at all 47 call sites were audited; the two
     "watch" rows (`run_backtest` retry advice, `manage_watchlist update` replay) are existing behavior,
     unchanged.
2. **Raise sites.** All 47 `except grpc.aio.AioRpcError` sites and 52 hand-written/validation/admin
   refusals in `app/tools.py` raise `ToolError` (99 of 103); four internal control-flow raises stay
   (`_extract_from_bytes` `:2600`/`:2602` caught at `:2604`; `_fetch_url` `:2684`/`:2709` caught at
   `:2712`). `:2347` converts (a caller refusal, correcting recon); `:2609` converts with fixed text.
   An inverted AST guard over `tools.py` (the `_mapper_calls` walker centralized as `tools_ast_nodes`)
   fails any `raise` that is not `ToolError(...)` outside an exact-count allowlist.
3. **Client arguments.** `class ClientArgumentError(ToolError, ValueError)` in `app/client.py` at its 21
   explicit raises, `_iso_to_timestamp` (`:105-111`, also catching `TypeError`/`OverflowError`) and the
   `set_config` conversions (`:2309-2312`; the wrap covers the protobuf int64-overflow assignment, not
   just `int()`/`float()`, so the value is never echoed). The `ValueError` base keeps client-level tests
   and client.py's own `except ValueError` catches (e.g. `:345`, `:1228`, `:2165`) intact. No conversion
   happens inside a gRPC path of `client.py` (273 @AC-5/@AC-10; 247 @AC-1).
4. **Proof at the boundary.** Dispatch-level tests via `server.call_tool` (precedent
   `tests/test_tools.py:807`) assert `type(exc) is ToolError` (excludes `UnexpectedToolError`, which
   subclasses it), and a sweep whose probe set must equal `{t.name for t in list_tools()}`.

**Consumer surface (C-14):** all 45 Agent MCP tools of `xstockstrat-agent`, as seen by Claude.ai and any
MCP client; no UI change, no backend change. Telemetry is unaffected: `agent.backend.rpc_errors` is
counted at the channel (`app/mtls.py:39-56`) and `mcp.tool.duration` already scores both outcomes as
`error` (`app/tool_metrics.py:87-92`, `:121-133`).

**Advisory step decomposition for /sdd-spec** (round 5 package, adversary-verified; the spec author
re-derives line numbers by grep at spec time):
1. *service+test, mapper* — `app/tools.py` mapper + constants + the two `pass_messages` sites;
   `tests/conftest.py` (`_rpc_error`, details-aware `hung_backend` answer shape); delete the three local
   `_rpc_error` copies; fix `test_tools.py:1668-1671`, `:2124-2126` and `test_offline_client.py:494`;
   new `tests/test_tool_errors.py` (mapper table, WARN, anchored drift test that FAILS on a missing source
   file); `tests/test_score_trailer_loopback.py` (em-dash round trip); `.github/workflows/ci.yml:59`
   (agent filter gains `services/xstockstrat-analysis/app/handlers/servicer.py` and
   `services/xstockstrat-trading/internal/service/trading.go`). One atomic unit.
2. *service+test, client* — `app/client.py` (`ClientArgumentError`, 21 sites, `_iso_to_timestamp`,
   `set_config` wrap) + tests; AC-4 mocks `ConfigServiceStub`, not `client.set_config`.
3. *5a, gRPC sites* — the 47 sites → `ToolError`; the `pytest.raises` lines that inject an
   `AioRpcError` flip (20); dispatch tests AC-1/2/3/6; durable `agent-broker-account-tools.feature` :52/:57.
4. *5b, other sites* — 52 refusals → `ToolError`; the other tools.py-originated `pytest.raises` flip
   (47); AST guard; remaining durable edits.
5. *docs* — `docs/runbooks/mcp-tools.md`, agent `docs/context-constitution.md` AGENT-5 (`:22`, `:31`),
   agent `CLAUDE.md`, tool docstrings, `plugins/strat-lab/skills/backtest/SKILL.md` (one sentence;
   `:234-236` attribution fix), `merge-order.md` only if still needed.

Classification rule for flips: a test that injects an `AioRpcError` through a tools.py path ships with
5a; every other tools.py-originated test with 5b; client-originated tests need no flip (they stay green
because `ClientArgumentError` ⊂ `ValueError`). Final per-file line lists: 20 / 47 / 24 stay = 91
(`pytest.raises(RuntimeError|ValueError|PermissionError)` in `services/xstockstrat-agent/tests`).

## Rejected Alternatives

- **Registration-time wrapper that converts exceptions** — rejected on preference (operator, R1 gate),
  not feasibility: it would not break `FuncMetadata`/`Context` injection (`func_metadata.py:322`,
  `context_injection.py:27`). It encodes an implicit "RuntimeError chained from AioRpcError is a
  refusal" rule, and the 52 hand-written/validation refusals would still need per-site edits.
  `ServerMiddleware` cannot work at all: it sees only the already-masked result (`server.py:441-456`).
- **Compat subclasses** (`ToolError` + the old built-in as a second base) — would keep ~67 tests and the
  five durable Thens unchanged (no C-16 CHANGE); rejected (operator, R3 gate) for one plain rule and a
  single exception type, at the cost of the one-time mechanical flip and the sign-off.
- **Collapse-all UNAVAILABLE / per-tool `pass_details` flag** — collapse-all loses two documented
  recovery hints (283 @AC-4; feature 256's re-confirm); a per-tool flag forwards every UNAVAILABLE detail
  of that tool, including grpc-core "failed to connect … ipv4:…". The exact-message allowlist forwards
  only two known strings; its cost is cross-service string drift (see Open Risks).
- **Blanket `except ValueError` per tool for client.py errors** — forwards response-mapping bugs and
  echoes `set_config` conversion text; a typed `ClientArgumentError` marks only deliberate refusals.
- **Treating the five durable rewordings as promotion-only** — rejected: the old Thens turn false at
  merge, so the durable edits are in-place (tagged `@feature-303`), with Then text byte-identical to
  303's AC-7..AC-11 so launch-time promotion classifies them DUP/OVERLAP; the `@supersedes-*` tag is
  informational only.

## Open Risks

- [ ] The two UNAVAILABLE pass strings can drift in analysis/trading without the agent suite noticing
  — anchored drift test (`StatusCode.UNAVAILABLE,\s*"…"` / `codes.Unavailable,\s*"…"`, ignores the log
  line at `servicer.py:1421`), failing — not skipping — on a missing file; agent CI filter gains both
  paths — step 1. On drift the effect is a safe collapse, not a leak.
- [ ] Withheld backend details now sit in an agent WARN; feature 299 (`agent-log-query`, draft) lets a
  `log_reader` role read agent logs — 299's design must account for it — recorded here and in context.md.
- [ ] Feature 299's `query_logs` ("log store unavailable") must raise `ToolError`; a `raise RuntimeError`
  in `tools.py` fails the AST guard — carried by the AGENT-5 rewrite (step 5) that 299's recon reads.
- [ ] Converted refusals now log INFO without a traceback (`server.py:453`) instead of ERROR (`:455`);
  no alert rule keys on agent logs (`packages/otel/alerts`) — accepted.
- [ ] Still-masked crashes by declaration (FR-4): `httpx` `raise_for_status()` (`tools.py:2703`), implicit
  arg casts (`client.py:169,171,725,734,757,1219,2498-2499`), `base64.b64decode` (`tools.py:577`).
- [ ] Config `INVALID_ARGUMENT` `(got: <value>)` echoes a submitted value for bounded keys
  (`configServiceImpl.ts:764`); every bounded key is a numeric policy key today, none secret; the
  operator waived a secret-path review (OQ2) — recorded only, passes through under FR-2.
- [ ] Backend text for the ten pass-through codes is forwarded verbatim (operator decision); no suite
  pins that backends never echo secrets in error details (recon gap).
- [ ] Merge state: 294 and 295 are already merged (`merge-order.md:98,:102`); only ordinary rebase overlap
  on `app/tools.py` remains — no `merge-order.md` row needed (verify with `git log` at spec time).

## Constitution Rules Touched

- `C-01` / `F-04` — honored by: every path/line was grep-verified across five rounds; the spec author
  re-derives line numbers by grep.
- `C-02` — honored by: context.md R1–R5 decisions read and recorded before each phase.
- `C-08` / `F-05` — honored by: each code step carries its tests, runs the full suite at ≥ 40 % coverage,
  and code + the tests it breaks ship as one atomic unit.
- `C-10` — honored by: all 99 refusal sites converted; the sweep == `list_tools()`; the AST guard stops new ones.
- `C-13` — honored by: `_rpc_error` (3 copies → `tests/conftest.py`) and `tools_ast_nodes` (2 consumers)
  centralized at their second consumer; `dispatch_error` stays module-local (one consumer file).
- `C-14` — honored by: the consumer surface is named (all agent tools); no UI/backend change.
- `C-15` — honored by: FR-1..FR-4 each covered; AC-1..AC-11 carry `@FR-N`; IDs append-only; Covers map
  below.
- `C-16` — honored by: PRESERVE list below; five CHANGE rows signed off by the operator (context.md).
- `C-18` — honored by: one mapper extended, one exception class, one new keyword used by exactly two
  sites; trade-offs recorded above.
- `P-01`, `P-02`, `P-04`, `P-05` — honored by: single orchestrator, mediated debate, gates at every round,
  decisions checkpointed in context.md as they happened.
- `P-03` — honored by: unverified items recorded as Not found; the one open provenance item is the
  `git log` merge-state check.
- `P-06` — honored by: each code step names a red command; the SDK-masking test is a declared
  characterization; AC-7/8/10/11 are type-neutral records whose red-first signal is the `pytest.raises`
  flip.
- `F-07` — honored by: hint strings are code constants; no config value is hardcoded.
- `F-08` — honored by: step Files include `tests/conftest.py`, `ci.yml`, and the durable `.feature` files.
- `F-01`, `F-02`, `F-03`, `F-06`, `F-09`, `F-10`, `F-11` — not touched / execute-time rules; no Floor
  breach was raised in any round.

## Business Rules Touched (C-16)

- PRESERVE 283 `expose-score-strategy-mcp.feature` @AC-2/3/4/8/9 — substrings survive (NOT_FOUND
  contains-rule; @AC-4 stays verbatim through `pass_messages`; @AC-9 is a tools.py refusal whose text is
  unchanged).
- PRESERVE 273 `fix-agent-client-deadlines.feature` @AC-1/2/3/6/9 — "upstream did not respond within …"
  kept as a substring; @AC-5/@AC-10 untouched (no conversion inside `client.py` gRPC paths).
- PRESERVE 247 @AC-1 (`get_config_value` still raises a gRPC error), 227 @AC-2, 148 @AC-3/@AC-6,
  161 @AC-3, 156 @AC-8 (no new local gate), 183 @AC-1/4/9, 164 @AC-1/4, 207 @AC-1/2/4/5/7 (`_fetch_url`
  keeps its fixed text), 294 @AC-21 (rpc_errors counted at the channel), 274 @AC-21,
  `consolidate-watchlist-signal` @AC-4 (the `except Exception` swallow still catches), 295 @AC-34
  (config key names forwarded unmodified in `details()`).
- CHANGE `@AC-2`, `@AC-3`, `@AC-7`, `@AC-8` `@feature-164` (`agent-broker-account-tools.feature` :20, :27,
  :57, :63) and `@AC-9 @feature-148` (`mcp-watchlist-tools.feature` :72) — each Then reworded from a
  literal exception class to "raises an error whose text …"; behavior and "no backend call" clauses
  unchanged. **Signed off by user @ 2026-11-07 (context.md, final-gate entry).** In-place edits land in
  the step that makes the old Then false (:57 in 5a; the others in 5b); scenario AC-7..AC-11 in
  `acceptance.feature` carry byte-identical Then text.

## Covers map (C-15) — AC → test (all in `services/xstockstrat-agent/tests/`)

- AC-1 `test_tool_errors.py::test_dispatch_refusal_reaches_caller[ac1_failed_precondition]` (5a)
- AC-2 `::test_mapper_table[not_found_other]` (1) + `::test_dispatch_refusal_reaches_caller[ac2_not_found_hint]` (5a)
- AC-3 `::test_mapper_table[...]`, `::test_mapper_warns_on_withheld_details` (1) + dispatch rows (5a)
- AC-4 `::test_set_config_bad_int_is_refused_without_echo` incl. the `99999999999999999999` row (2)
- AC-5 `test_score_trailer_loopback.py::test_unavailable_detail_round_trips_em_dash` (1, flipped in 5a) +
  drift test `::test_unavailable_pass_strings_match_backend_sources` (1)
- AC-6 `::test_every_tool_refusal_is_a_tool_error` (5a; never cut) + FR-1 regression
  `::test_tools_py_raises_only_tool_error` (5b)
- AC-7 `test_account_tools.py:76` (5b; tighten with `re.escape`) · AC-8 `:93` (5b) · AC-9 `:150` (5a) ·
  AC-10 `:188` (5b) · AC-11 `test_watchlist_tools.py:237` (5b; tighten to the full allowed-operations text)
- Characterization (no AC, exempt from red-first): `::test_unconverted_exception_is_masked_by_sdk` (5a)
