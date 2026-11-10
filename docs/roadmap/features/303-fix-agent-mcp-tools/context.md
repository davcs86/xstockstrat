# Context: fix-agent-mcp-tools  (archived 2026-11-10)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-11-10 — /sdd-archiver

**What**: The agent's tool refusals never reached MCP callers.
- Every refusal (backend gRPC errors, input validation, the admin gate) was a built-in `RuntimeError`, `ValueError` or `PermissionError`.
- The `mcp` 2.3.0 SDK masks the text of anything that is not a `ToolError` to `Error executing tool <name>`.
- CI stayed green because tests called the raw tool function and skipped SDK dispatch.

Shipped:
- 99 `ToolError` raise sites in `app/tools.py`;
- a `CODE: body` mapper that passes details through for codes a caller can act on, and collapses everything else to a fixed hint plus a server WARN;
- a `ClientArgumentError(ToolError, ValueError)` for `client.py`-raised refusals.

Staging smoke covered refusal paths only. The INTERNAL collapse and the original FAILED_PRECONDITION case were proven by unit and dispatch tests only.

**Why (irrecoverable rationale)**:
- **Per-site explicit `ToolError`, not a registration-time wrapper.** The operator chose this on preference, not feasibility. The wrapper would not have broken `FuncMetadata`/`Context` injection. It was rejected because it encodes an implicit rule ("a RuntimeError chained from AioRpcError is a refusal"), and the 52 hand-written refusals needed per-site edits anyway. Do not cite "middleware can't work" against the wrapper; that holds only for `ServerMiddleware`.
- **The collapse is a security default, separate from OQ2.**
  - INTERNAL, UNKNOWN, DATA_LOSS, UNIMPLEMENTED and unlisted codes are withheld, so grpc-core and internal text never reach the caller.
  - The operator separately waived review of secret-adjacent paths (OQ2). The collapse "does not relitigate" that waiver.
- **The pass-through set is the operator's choice.** The operator's eight codes pass through. RESOURCE_EXHAUSTED and ABORTED were added by the operator against the adversary's collapse default.
- **UNAVAILABLE uses an exact-message allowlist.**
  - Collapsing all UNAVAILABLE would lose two recovery hints callers rely on: 283 @AC-4 "fundamentals availability unknown — grade unchanged", and feature 256's "positions not published; re-confirm to retry".
  - A per-tool flag would forward grpc-core "failed to connect … ipv4:…" text.
  - Accepted cost: cross-service string drift. It is acceptable because drift fails safe: a reworded string collapses to the generic hint and never leaks.
- **`ClientArgumentError` has both bases.**
  - The `ValueError` base keeps `client.py`'s own internal `except ValueError` catches, and the unmodified client tests, green.
  - The `ToolError` base removes the 15 per-tool `except ValueError` clauses the R1 plan needed.
- **Plain `ToolError` in `tools.py`, with no compat subclass.** The operator wanted one plain rule and a single exception type. The cost was a one-time flip of about 67 `pytest.raises`, plus a C-16 rewording of 5 durable Thens.
- **Mapper rows are pinned to protect earlier features.** Bodies must survive as substrings: 283's score strings, 273's "upstream did not respond within …", and 247 @AC-1's raw gRPC error from `get_config_value`. For the same reason, nothing converts inside `client.py` gRPC paths (273 @AC-5/@AC-10).

**Rejected alternatives**:
- **NOT_FOUND literal-only:** lost because the server's remedy hint (`pass create_key=true`) must reach the caller. The operator chose literal + deduped server details (R1 gate).
- **Registration-time exception-converting wrapper:** lost on operator preference (implicit convention; still needs per-site edits).
- **`ServerMiddleware` conversion:** cannot work at all, because it sees only the already-masked result.
- **Compat subclasses in `tools.py`** (`ToolError` plus the old built-in as a second base): would have avoided the C-16 CHANGE and the test flips; lost to "one plain rule".
- **Collapse-all UNAVAILABLE:** loses two documented recovery hints.
- **Per-tool `pass_details` flag:** leaks grpc-core connection text.
- **A blanket `except ValueError` per tool for `client.py` errors:** forwards response-mapping bugs, and echoes `set_config` `int()`/`float()` conversion text, which can contain secret values.
- **The adversary's collapse default for RESOURCE_EXHAUSTED/ABORTED:** overridden by the operator.
- **Doing the five durable Then rewordings at promotion only:** the old Thens turn false at merge. They were edited in place in the step that broke them, with Then text byte-identical to 303's AC-7..AC-11.
- **Rewriting the strat-lab "Python exception name e.g. ValueError → report it" lines** (`SKILL.md`, `reference/backfill.md`, `mcp-tools.md`): they describe analysis-side `type(e).__name__` warnings, which are still accurate. One new sentence was added instead.

**Scars & gotchas**:
- **The mapper change alone turns exactly three existing asserts red.** So mapper and tests ship as one atomic unit. One of those tests had to change its injected code from UNAVAILABLE to FAILED_PRECONDITION, because UNAVAILABLE "boom" now collapses.
- **`hung_backend` hard-coded the abort detail as "rejected"** (`tests/conftest.py`). Detail-dependent loopback tests (the em-dash round trip) needed a new `(delay_s, StatusCode, details)` answer shape.
- **The empty-details fallback for pass-through codes returns the lower-cased code name** (UNAUTHENTICATED → "unauthenticated"). This behaviour change was inherited from the spec code.
- **Gaps found during green in the `_PROBES` sweep:** `extract_email_content` needs `urls=[…]`, and the offline operation is `create_account`.
- **Feature 296 merged after the spec was written.** It added a test that injects INVALID_ARGUMENT through `set_config` and asserts `RuntimeError`. Step 5 turned it red, which forced a Type A scope addition to `tests/test_config_tools.py`.
- **The merge train halts on a feature-branch base.** Step PRs #1473/#1480/#1481/#1482 were merged directly, after CI Gate green and `mergeable_state: clean`.
- **The executor had no `.venv`.** Run `uv sync --frozen --extra dev` before `uv run --no-sync pytest`.
- **The `status.md → code-completed` flip was missed at Step 9.** It was done only on the ALL-DONE path.
- **C-16 promotion renamed example keys.** The pre-296 examples `analysis.foo`/`analysis.x` became `foo`/`x` in the durable `fix-agent-mcp-tools.feature`; only values changed.
- **Durable Thens must not carry test-mocked backend detail literals.** Keep them type- and mock-neutral; e.g. AC-9's mocked trading detail was dropped (R5 promotion rule).
- **Converted refusals now log at INFO without a traceback, instead of ERROR.** Accepted, because no alert rule keys on agent logs.

**Permanent deviations**:
- **Covers map test names.** The design named three tests, but the executor named the tests itself, so the shipped names differ; AGENT-5 cites the real ones. This is traceability only, with no behaviour change.

  | Design name | Shipped as |
  |---|---|
  | `test_every_tool_refusal_is_a_tool_error` | `test_every_listed_tool_surfaces_a_backend_refusal_as_a_tool_error` |
  | `test_dispatch_refusal_reaches_caller[...]` | `test_set_config_backend_refusal_reaches_the_caller` / `test_set_config_not_found_keeps_literal_and_server_hint` / `test_internal_failures_are_withheld_and_logged` |
  | `test_unconverted_exception_is_masked_by_sdk` | `test_sdk_masks_exceptions_that_are_not_tool_errors` |

- **Step structure.**
  - Design: 5 advisory steps.
  - Shipped: 9 steps in 4 atomic units (1+2, 3+4, 5+6, 7+8, plus 9).
  - Because: red-first required each test step to land with its code step. Process only.
- **No behavioural divergence from design was found.** The mapper rows, the 99/103 raise split, the 4 allowlisted raises and the `_extract_from_bytes` fixed text all shipped as designed.

**Cross-feature signal**:
- **A Dependabot minor bump changed caller-visible behaviour unnoticed.** `mcp` went 2.0.0 → 2.2.0 → 2.3.0 (2026-10-19/20), and nothing caught it because no test went through SDK dispatch. Which 2.x release introduced the masking was never established.
- **New obligation for every agent tool:** a `_PROBES` entry and `ToolError` raises, enforced by the sweep and an AST guard. Feature 299 (`query_logs`) is the first to inherit it.
- **The agent CI path filter now includes analysis `servicer.py` and trading `trading.go`.** This is a producer→consumer string contract that is invisible from the producer side.

**Deferred follow-ons**:
- **Feature 299 (`agent-log-query`) must:**
  - raise `ToolError` from `query_logs` ("log store unavailable");
  - add a `query_logs` `_PROBES` entry;
  - account for its `log_reader` role being able to read the new WARN, which holds withheld backend details.
- **Crashes that stay masked by declaration (FR-4):**
  - `httpx` `raise_for_status()` in `_fetch_url`;
  - implicit `float()`/`int()` casts in `client.py`;
  - `base64.b64decode` in `tools.py`.
- **Config `INVALID_ARGUMENT` "(got: <value>)" echo for bounded keys.** It passes through under the pass-through rule. It is unreachable today, because all bounded keys are numeric policy keys, and review was waived under OQ2.
- **No suite pins that backends never echo secrets** in the error details that pass through.
- **Pre-existing drift in `mcp-tools.md`** (the password `ValueError` is caught inside `_extract_from_bytes`). Deliberately left.

**Ledger entries written**: insights.md (2), fails.md (1) — see the 2026-11-10 entries. The 2026-11-07 SDK-dispatch design entry already existed and was skipped. That entry cites this feature's design.md and the defect report; both resolve via `git show 2d91b5671335fcce267679b50caa494440205f51:<path>`.

**Runtime-invariant recommendations (→ /context-constitution)**:
- **ANALYSIS / TRADING, producer side.** The exact UNAVAILABLE strings "fundamentals availability unknown — grade unchanged" (analysis `servicer.py`) and "positions not published; re-confirm to retry" (trading `trading.go`) are consumed verbatim by the agent. Rewording either collapses the caller's recovery hint, and only the agent drift test would catch it.
- **AGENT.** The WARN "backend error withheld from tool caller" on `app.tools` holds raw backend details. Anything exposing agent logs (299's `log_reader`) is a disclosure surface.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 2d91b5671335fcce267679b50caa494440205f51. Defect report `docs/reports/2026-11-07-agent-mcp-tool-error-details-masked-defect.md` (+ `.status`) was pruned in the same run.

## Retained verbatim records

Operator decisions and C-16 sign-offs copied verbatim from the pre-archive session log, because durable suites and later features cite "<NNN> context.md" as their provenance. Headings are demoted one level.

### Session 2026-11-07 (operator decisions on open points)

- OQ1 resolved: **yes** — the `ValueError` and `PermissionError` validation refusals in `app/tools.py` also become `ToolError`, alongside the gRPC-mapped `RuntimeError` sites. Scope is therefore every tool-level anticipated refusal, not only backend gRPC errors.
- OQ2 resolved: **no review** of secret-adjacent paths (`set_config` on `is_secret` keys, `manage_account` credentials) before backend error details are forwarded. Operator decision; the spec adds no such step.
- Next: `/sdd-spec fix-agent-mcp-tools` (design depth stays skip).

_From: Session 2026-11-07 — sdd-design (Phase 1, round 2 of full → round 3)_

  - **Gate: Run another round** (R3). Approve + the C-16 CHANGE sign-off for the 5 rules (broker @AC-2/3/7/8, watchlist @AC-9) are NOT yet given — still pending.

_From: Session 2026-11-07 — sdd-design (Phase 1, round 3 of full → round 4)_

- Operator steers at the R3 gate: **exception classes = plain `ToolError` everywhere** (adversary's compat-subclass Alternative A NOT taken); **gate = Run another round** (R4). Approve and the C-16 CHANGE sign-off for broker @AC-2/3/7/8 and watchlist @AC-9 are still pending (they follow plain `ToolError`: the ~68 `pytest.raises` flip and the five Thens are reworded).

_From: Session 2026-11-07 — sdd-design (Phase 1, round 4 of full → round 5, the hard cap)_

- Operator at the R4 gate: **Run final round 5** (cap). Approve + C-16 CHANGE sign-off for broker @AC-2/3/7/8 and watchlist @AC-9 remain pending.

_From: Session 2026-11-07 — sdd-design (Phase 1, round 5 of full — hard cap — APPROVED)_

- **Final operator gate: Approve + C-16 sign-off.** The operator signed off, 2026-11-07, the CHANGE of five existing business rules by rewording their Then-steps from a literal exception class to "raises an error whose text …" — `agent-broker-account-tools.feature` @AC-2 (:20), @AC-3 (:27), @AC-7 (:57), @AC-8 (:63) [`@feature-164`] and `mcp-watchlist-tools.feature` @AC-9 (:72) [`@feature-148`]; behavior and the "no backend call" clauses are unchanged; edits tagged `@feature-303` and executed in the steps that make the old Thens false (5a: :57; 5b: the rest).

_From: Step 6 — test: flip gRPC-path assertions; dispatch, sweep, characterization, durable edit [done]_

- Durable `acceptance/agent-broker-account-tools.feature`: `@feature-303` appended to the `@AC-7` tag line; Then reworded to `the tool raises an error whose text contains "PERMISSION_DENIED" and conveys the permission denial` (C-16 CHANGE, operator sign-off).

_From: Step 8 — test: flip the 47 non-gRPC assertions; FR-1 AST guard; AC-7/8/10/11; durable edits [done]_

- Durable suites (C-16 CHANGE, operator sign-off): `agent-broker-account-tools.feature` `@AC-2/@AC-3/@AC-8` and `mcp-watchlist-tools.feature` `@AC-9` tagged `@feature-303`, Then lines reworded type-neutrally.
