# Implementation Spec: backtest-result-attachment

**Status**: `pending`
**Created**: 2026-07-27
**Feature**: `docs/roadmap/features/072-backtest-result-attachment/feature.md`
**Total Steps**: 5
**Feature Branch**: `feature/backtest-result-attachment`

---

## Execution Summary

Follows `design.md` § Chosen Approach exactly: the split lives in the agent's presentation layer only
— `client.run_backtest` is **untouched**, so the feature-064 fidelity test
(`tests/test_tools.py:535-577`, which exercises the *client*) is preserved rather than inverted.
Steps 1–2 add and test a new pure module `app/backtest_view.py` (summary projection + attachment
block construction), because both the summary and the attachment need the same projection and recon
found **no existing helper** to reuse. Steps 3–4 rewire the `run_backtest` tool to return
`[TextContent(summary), *blocks]` under `@server.tool(structured_output=False)` and cover it with
tool-layer tests. Step 5 discharges the C-10 documentation obligation across the two remaining
consumer surfaces. No proto, no migration, no config key, no `xstockstrat-analysis` change.

Base branch reality: this work rebases onto `{070 + 071}` (shared branch
`claude/features-070-071-rnbkqo`, PR #792 — see `merge-order.md:59-88`). **All `path:line`
citations below were read against that post-070/071 tree**, which is why they differ from the
product spec's (stale) citations.

## Step Dependencies

- **Step 2 covers Step 1** (C-08 pairing) and forms one red-green cycle with it (P-06).
- **Step 3 requires Step 1**: `run_backtest` imports `app.backtest_view`.
- **Step 4 covers Step 3** (C-08 pairing) and forms one red-green cycle with it (P-06).
  **Steps 3 and 4 must land in the same step branch/PR.** Step 3 alone leaves the existing
  `test_run_backtest_calls_grpc` (`tests/test_tools.py:271`) red — it asserts
  `result["backtest_id"]` against what is now a list of content blocks. That adaptation is
  authored in Step 4, so splitting the pair across PRs would violate **F-05** (never commit before
  the step's verification passes).
- **Step 5 requires Step 3**: the docs must describe the shape the tool actually returns.
- No step depends on `xstockstrat-analysis`, `packages/proto`, or any migration.

### Carried-forward risks from `design.md` § Open Risks

- `backtest_view.summarize` **must be total over partial dicts** or the feature-071 window tests
  (`tests/test_tools.py:288,303`, which mock `client.run_backtest` with `{"backtest_id": "bt-2"}` /
  `{"backtest_id": "bt-3"}`) break → covered by Step 2.
- **Non-echoing fixtures** (insights 2026-07-27): AC-2's fixture must carry per-bar content that
  appears **only** in the attachment; AC-1 must assert across **two** symbol counts → Steps 2 and 4.
- `profit_factor` is the **string** `"Infinity"` on zero losing trades and `volume` is a **string**
  int64 (`MessageToDict` contract, verified — insights 2026-07-27) → assertions must expect that,
  Steps 2 and 4.
- Accepted, not mitigated: a client may inline the `EmbeddedResource` anyway. Escalation (gzip blob)
  is additive and explicitly out of scope for v1.

---

### Step 1 — service: add `app/backtest_view.py` (summary projection + attachment block)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/backtest_view.py` — create

(No new env var or port — no `docker-compose.yml` / `.do/app*.yaml` edit. Confirmed: the change is
pure in-process presentation logic.)

**Reviewers**: `xstockstrat-agent` (service owner) — `run_backtest` return-shape correctness, MCP
attachment semantics, no fidelity loss vs the inline payload.
_(Registry gap **closed 2026-07-27**: `docs/runbooks/reviewer-registry.md` now carries an
`xstockstrat-agent` row, so this focus is registry-sourced rather than inferred. It had been the
one service missing from the Service Owners table; features 070 and 071 shared the gap.)_

**Codebase Evidence**:
- **No existing helper to reuse** — `recon.md` § Patterns to REUSE: a grep for
  `summar|compact|truncat|_condense|digest` across the service hit only
  `app/prompts/signal_extraction.md:55` and HMAC `hexdigest` at `app/oauth_server.py:41,51,52`.
  Confirmed current module list: `services/xstockstrat-agent/app/` = `__init__.py`, `auth.py`,
  `client.py`, `config/`, `main.py`, `oauth_metadata.py`, `oauth_server.py`, `prompts/`,
  `telemetry.py`, `tools.py` — **no `backtest_view.py`**.
- Input shape is the dict from `client.run_backtest`, produced by
  `services/xstockstrat-agent/app/client.py:200-204`:
  `MessageToDict(resp, preserving_proto_field_name=True, always_print_fields_with_no_presence=True)`
  — so keys are snake_case and zero-valued metrics are present.
- Field set of `BacktestResult`, read from `packages/proto/analysis/v1/analysis.proto:65-83`:
  `backtest_id`(1), `strategy_id`(2), `total_return`(3), `annualized_return`(4), `sharpe_ratio`(5),
  `max_drawdown`(6), `win_rate`(7), `total_trades`(8), `profit_factor`(9), `completed_at`(10),
  `trades`(11), `status`(12), `coverage_gaps`(13), `diagnostics`(14), `initial_capital`(15).
- `SymbolDiagnostics` fields, `packages/proto/analysis/v1/analysis.proto:140-146`
  (note `warmup_bars = 5` is at `:145` — inside the message, and `_SYMBOL_KEYS` depends on it):
  `symbol`(1), `bars`(2), `no_trade_reason`(3), `bars_total`(4), `warmup_bars`(5) — the `bars` array
  is what the summary drops.
- SDK types confirmed importable from the resolved SDK (`mcp == 1.27.1`, `uv.lock:439-440`), executed
  in `services/xstockstrat-agent/.venv`:
  `from mcp.types import EmbeddedResource, TextResourceContents, Annotations, TextContent` → ok.
- `Annotations` fields confirmed at `.venv/.../mcp/types.py:761-763`
  (`audience: list[Role] | None`, `priority: Annotated[float, Field(ge=0.0, le=1.0)] | None`);
  `TextResourceContents` at `:871`; `EmbeddedResource` at `:1177`.
- URI scheme executed against pydantic: `AnyUrl('xstockstrat:///backtest/bt-1/result.json')` is
  accepted — no `file:///` fallback needed (`design.md` § 2).
- Lint config confirmed: `services/xstockstrat-agent/pyproject.toml:33-38` —
  `target-version = "py312"`, `line-length = 100`, `select = ["E", "F", "I", "UP"]`.

**TDD**: `red-green required` — paired with Step 2.

**Instructions**:

Create `services/xstockstrat-agent/app/backtest_view.py` as a **pure** module (no gRPC, no I/O, no
`app.client` import) exposing three functions plus module-level constants. Keep the file under the
100-char line limit and import-sorted (ruff `I`).

1. Module docstring: state that this is the presentation split for feature 072 — it never
   re-serializes the proto, it projects the dict `client.run_backtest` already returns, so FR-3
   fidelity holds by construction.

2. Constants (no config keys — these are presentation constants, not `WatchConfig` values; **F-07**
   is honored because nothing here is operationally tunable):
   - `_ATTACHMENT_MIME = "application/json"`
   - `_URI_TEMPLATE = "xstockstrat:///backtest/{backtest_id}/result.json"`
   - `_ATTACHMENT_PRIORITY = 0.1`
   - `_HEAD_KEYS = ("backtest_id", "strategy_id", "status", "completed_at")`
   - `_METRIC_KEYS = ("total_return", "annualized_return", "sharpe_ratio", "max_drawdown",
     "win_rate", "total_trades", "profit_factor", "initial_capital")` — the FR-2 headline set,
     matching `analysis.proto:68-74` (the eight metric fields) plus `initial_capital` at `:83`
   - `_SYMBOL_KEYS = ("symbol", "no_trade_reason", "bars_total", "warmup_bars")` — FR-2's per-symbol
     0-trade diagnosis set, `bars` deliberately excluded

3. `def summarize(result: dict[str, Any]) -> dict[str, Any]:` — the FR-2 inline summary.
   - **Total over partial dicts**: copy a key only when it is present —
     `{k: result[k] for k in _HEAD_KEYS + _METRIC_KEYS if k in result}`. Never inject `None` for a
     missing key and never use a truthy guard (`always_print_fields_with_no_presence=True` means a
     real payload carries `total_return: 0.0` / `total_trades: 0`, and those must survive —
     `client.py:195-199` documents exactly why).
   - Copy `coverage_gaps` verbatim when the key is present (AC-4 — this is the only path for an
     `INSUFFICIENT_DATA` run).
   - When `diagnostics` is present, set
     `summary["diagnostics"] = [{k: d[k] for k in _SYMBOL_KEYS if k in d} for d in result["diagnostics"] or []]`
     — same key name as feature 064 so existing readers keep their path, with the `bars` array
     dropped. This is what makes the summary O(symbols) rather than O(symbols x bars).
   - Do **not** coerce or normalize any value. `profit_factor` legitimately arrives as the string
     `"Infinity"` and `volume` as a string int64 — pass them through untouched.
   - Do **not** add `attachments` here; Step 3 sets it (see `attachment_refs` below), so a caller
     that wants the projection alone gets exactly that.

4. `def build_blocks(result: dict[str, Any]) -> list[EmbeddedResource]:` — the FR-3 attachment.
   - Return `[]` when there is nothing to attach. Content test (`design.md` § 2 — "attach only when
     there is content"): truthy `result.get("trades")`, **or** any element of
     `result.get("diagnostics") or []` with a truthy `bars`. An `INSUFFICIENT_DATA` run has neither,
     so AC-4 falls out of this general rule rather than a status special-case — do **not** branch on
     `status`.
   - Otherwise return exactly one block:
     ```python
     EmbeddedResource(
         type="resource",
         annotations=Annotations(audience=["user"], priority=_ATTACHMENT_PRIORITY),
         resource=TextResourceContents(
             uri=_URI_TEMPLATE.format(backtest_id=result.get("backtest_id") or "unknown"),
             mimeType=_ATTACHMENT_MIME,
             text=json.dumps(result, separators=(",", ":")),
         ),
     )
     ```
     `result` is passed **verbatim** — no re-projection, no reassembler. That is the whole fidelity
     argument (`design.md` § 2; ledger insights 2026-07-27). `uri` is a `str`; pydantic coerces it to
     `AnyUrl` (executed above).
   - No base64 and no `BlobResourceContents` — explicitly rejected (`design.md` § Rejected
     Alternatives). Do not import `base64` here.

5. `def attachment_refs(blocks: list[EmbeddedResource]) -> list[dict[str, str]]:` — returns
   `[{"uri": str(b.resource.uri), "mime_type": b.resource.mimeType} for b in blocks]`. This is
   FR-5's degradation aid: a client that renders no attachment affordance still shows the user, in
   the inline summary, that detail exists and under what URI.

**Placement note (recorded, not silent — P-03):** `design.md` § 3 names `app/backtest_view.py` as the
home of `summarize` and shows the `EmbeddedResource` construction (§ 2) without naming its module.
`build_blocks`/`attachment_refs` are placed in the same module so `tools.py` stays a thin call site
and the whole split is unit-testable without a `FastMCP` server. This is a within-design placement
decision, logged in `context.md`.

**Verification**:

```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check .
cd services/xstockstrat-agent && uv run python -c "
from app.backtest_view import summarize, build_blocks, attachment_refs
print(summarize({'backtest_id': 'bt-2'}))
print(build_blocks({'backtest_id': 'bt-2'}))
"
```
Expect `{'backtest_id': 'bt-2'}` and `[]` — proving totality over a partial dict and the
no-content-no-attachment rule before any test is written.

---

### Step 2 — test: unit tests for `app/backtest_view.py`

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_backtest_view.py` — create

**Reviewers**: `xstockstrat-agent` (service owner) — no fidelity loss vs the inline payload,
FR-2 field retention, partial-dict totality. _(Registry gap closed 2026-07-27 — `reviewer-registry.md` now carries an `xstockstrat-agent` row.)_

**Codebase Evidence**:
- Test layout confirmed: `services/xstockstrat-agent/tests/` contains `__init__.py`, `conftest.py`,
  `test_auth.py`, `test_client.py`, `test_oauth.py`, `test_tools.py`, `test_tools_endpoint.py` —
  **no `test_backtest_view.py`**.
- pytest config: `services/xstockstrat-agent/pyproject.toml:29-31` — `testpaths = ["tests"]`,
  `asyncio_mode = "auto"`. These are sync tests, so no `@pytest.mark.asyncio` is needed.
- Coverage threshold **40** with `--cov=app`, confirmed at `.github/workflows/ci.yml:336-338`
  (`service: xstockstrat-agent`, `coverage_threshold: 40`, `cov_source: app`) and
  `services/xstockstrat-agent/CLAUDE.md` § Running Tests.
- `MessageToDict` type mapping that these assertions must expect (executed at design time, recorded
  in `docs/roadmap/ledger/insights.md` 2026-07-27 — 072 entry): `bar_index` → `7` (`int`),
  `volume` → `'51234567'` (`str`), `vwap` → `'NaN'` (`str`), `profit_factor` → `'Infinity'` (`str`).
- Partial-dict callers that must not break:
  `services/xstockstrat-agent/tests/test_tools.py:288` (`{"backtest_id": "bt-2"}`) and `:303`
  (`{"backtest_id": "bt-3"}`) — feature-071 window tests.

**TDD**: `red-green required` — this is the red half of Step 1's cycle. Authored and run **before**
`app/backtest_view.py` exists (import error is not an acceptable red — see the gate's "fail for the
right reason" rule, so create the module skeleton with `raise NotImplementedError` bodies if needed
to get a behavioral red, per `.claude/skills/sdd-execute/reference/tdd-gate.md`).

**Instructions**:

Create `services/xstockstrat-agent/tests/test_backtest_view.py`. Build a module-level
`_full_result(symbols=1, bars=50)` factory returning a realistic `client.run_backtest`-shaped dict
(parameterized — tests 4 and 5 vary bar count and symbol count; mirrors Step 4's `_result(symbols, bars)`) — the fixture must
be **non-echoing** (ledger insights 2026-07-27): every per-bar field carries a value that appears
**nowhere** in the FR-2 summary key set, so a test cannot pass by reading the wrong half.
Concretely, give bars a distinctive sentinel such as `"close": 111.111` and
`"indicators": {"sentinel_only_in_attachment": 42.0}`, and give the summary-level metrics different
values.

Cover:

1. `test_summary_keeps_every_fr2_field` — all of `backtest_id`, `strategy_id`, `status`,
   `completed_at`, the eight metric keys, and `coverage_gaps` survive `summarize`.
2. `test_summary_keeps_zero_valued_metrics` — a result with `total_return: 0.0` and
   `total_trades: 0` keeps both keys present (the feature-064 "0 trades / 0% return" case that
   `always_print_fields_with_no_presence=True` exists to protect, `client.py:195-199`).
3. `test_summary_drops_per_bar_bars_but_keeps_the_diagnosis` — per symbol, `symbol`,
   `no_trade_reason`, `bars_total`, `warmup_bars` are present and `"bars" not in entry` (AC-3, the
   feature-064 regression guard).
4. `test_summary_is_independent_of_window_length` — build the same result at 50 bars/symbol and at
   5,000 bars/symbol. **Not byte-identical**: `_SYMBOL_KEYS` retains `bars_total`, which tracks bar
   count by definition, so demanding byte-identity could only be satisfied by pinning `bars_total`
   equal across the two fixtures — the inert-fixture trap this step's own non-echoing rule warns
   against (ledger insights 2026-07-27). Assert instead, all three:
   (a) the two summaries are equal after popping `bars_total` from every `diagnostics` entry;
   (b) `bars_total` actually differs (50 vs 5000) — so the fixture is proven live, not inert;
   (c) `abs(len(json.dumps(a)) - len(json.dumps(b))) < 16` — digit-width growth only, nothing
   that scales with bar count.
   This is the reworded AC-1's first half ("independent of window length", `design.md` § 7) —
   size-independence, not byte-equality.
5. `test_summary_grows_linearly_in_symbol_count` — 1 symbol vs 10 symbols: the serialized summary
   grows, but stays under a small absolute bound (assert `< 8_000` bytes for 10 symbols) while the
   full payload for the same input is orders of magnitude larger. AC-1's second half; asserted
   across **two** symbol counts, per `design.md` § Open Risks.
6. `test_summary_passes_non_finite_strings_through` — `profit_factor: "Infinity"` stays the string
   `"Infinity"`, not `math.inf` and not `None`.
7. `test_summarize_tolerates_a_partial_dict` — `summarize({"backtest_id": "bt-2"})` returns
   `{"backtest_id": "bt-2"}` and raises nothing (protects `test_tools.py:288,303`).
8. `test_attachment_round_trips_to_the_complete_result` —
   `json.loads(build_blocks(full)[0].resource.text) == full` (AC-2, FR-3), and assert the sentinel
   `"sentinel_only_in_attachment"` **is** in the attachment text while being absent from
   `json.dumps(summarize(full))`.
9. `test_attachment_block_shape` — one block; `block.type == "resource"`;
   `block.resource.mimeType == "application/json"`; `str(block.resource.uri)` starts with
   `"xstockstrat:///backtest/"` and contains the `backtest_id`;
   `block.annotations.audience == ["user"]` and `block.annotations.priority == 0.1`.
10. `test_no_attachment_when_there_is_no_detail` — an `INSUFFICIENT_DATA`-shaped result
    (`status: "BACKTEST_STATUS_INSUFFICIENT_DATA"`, populated `coverage_gaps`, `trades: []`,
    `diagnostics: []`) yields `build_blocks(...) == []` while `summarize(...)` still carries
    `coverage_gaps` (AC-4).
11. `test_attachment_refs_describe_each_block` — `attachment_refs` returns one `{"uri", "mime_type"}`
    entry per block and `[]` for `[]`.

**Verification**:

```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check .
cd services/xstockstrat-agent && uv run pytest tests/test_backtest_view.py -q
cd services/xstockstrat-agent && uv run pytest --cov=app --cov-report=term-missing --cov-fail-under=40
```
All three must pass; the last must report total coverage ≥ 40% (CI parity —
`.github/workflows/ci.yml:336-338,353-358`).

---

### Step 3 — service: `run_backtest` returns a summary + attachment; raise the `mcp` floor

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify
- `services/xstockstrat-agent/pyproject.toml` — modify
- `services/xstockstrat-agent/uv.lock` — modify

(No new env var or port — no `docker-compose.yml` / `.do/app.dev.yaml` / `.do/app.yaml` edit.)

**Reviewers**: `xstockstrat-agent` (service owner) — `run_backtest` return-shape correctness, MCP
attachment semantics, degradation behavior. _(Registry gap closed 2026-07-27 — `reviewer-registry.md` now carries an `xstockstrat-agent` row.)_

**Codebase Evidence**:
- Current tool, read on the post-070/071 tree: `services/xstockstrat-agent/app/tools.py:240`
  (`@server.tool()`), `:241-247` (signature `strategy_id, symbols, initial_capital=100000.0,
  start=None, end=None` → `-> dict`), `:248-268` (docstring), `:269-275`
  (`return await client.run_backtest(...)`).
- The docstring text this step replaces, `app/tools.py:265-268`: *"Returns the full backtest result
  including per-symbol `diagnostics`: a day-by-day list of bars … use these to explain why a strategy
  produced 0 trades…"* — the feature-064 promise FR-2 must keep true from the **inline** half.
- `client.run_backtest` is **not modified**: `app/client.py:143-204`. Its projection at `:200-204`
  stays the single source of the payload, so the feature-064 client test
  (`tests/test_tools.py:535-577`, which patches `analysis_pb2_grpc.AnalysisServiceStub` and asserts
  `out["diagnostics"][0]["bars"][0]["action"]`) keeps passing unchanged.
- Existing imports at `app/tools.py:21-27`: `base64`, `logging`, `grpc`,
  `from mcp.server import FastMCP`, `from app import client`. `json` and `mcp.types` are **not** yet
  imported — both are new here.
- Degradation precedent to mirror: `app/tools.py:212-215` —
  `except Exception as e: log.warning("Auto-alert failed after ingest_signal (signal already ingested): %s", e)`
  — a secondary concern failing must not fail the primary result.
- `structured_output=False` is a real parameter of the resolved SDK: executed
  `inspect.signature(FastMCP.tool)` → `['self', 'name', 'title', 'description', 'annotations',
  'icons', 'meta', 'structured_output']` (mcp 1.27.1).
- Its effect, confirmed in-tree at
  `.venv/lib/python3.12/site-packages/mcp/server/fastmcp/utilities/func_metadata.py:264-265`:
  `if structured_output is False: return FuncMetadata(arg_model=arguments_model)` — no output schema,
  no return-value validation.
- Content-block passthrough confirmed in the same file: `:521` `if isinstance(result, ContentBlock):
  return [result]`; `:530` `if isinstance(result, list | tuple): return list(chain.from_iterable(...))`.
  A list of blocks is therefore flattened and passed through verbatim.
- Today's payload really is pretty-printed: `func_metadata.py:539`
  `pydantic_core.to_json(result, fallback=str, indent=2)` — the baseline this feature improves on.
- Current pin: `services/xstockstrat-agent/pyproject.toml:6` — `"mcp>=1.0.0"` (unbounded). Resolved:
  `uv.lock:439-440` — `name = "mcp"` / `version = "1.27.1"`. The `[package.metadata]` requirement
  echo to update is `uv.lock:1318` — `{ name = "mcp", specifier = ">=1.0.0" }`.

**TDD**: `red-green required` — paired with Step 4 (write Step 4's tests first, capture red, then
apply this step).

**Instructions**:

1. **Imports** — add `import json` to the stdlib block at `app/tools.py:21-22` (before `logging`,
   ruff `I` ordering), and add `from mcp.types import TextContent` next to the existing
   `from mcp.server import FastMCP` at `:25`; add `from app import backtest_view` alongside
   `from app import client` at `:27` (or extend it to `from app import backtest_view, client`).

2. **Decorator** — change `@server.tool()` at `app/tools.py:240` to
   `@server.tool(structured_output=False)`. This is load-bearing: without it FastMCP builds an output
   schema from the return annotation and validates against it. Do **not** return a `CallToolResult` —
   explicitly rejected in `design.md` § 1.

3. **Return annotation** — change `-> dict:` at `app/tools.py:247` to `-> list:`.

4. **Body** — replace the `return await client.run_backtest(...)` at `app/tools.py:269-275` with:
   ```python
   result = await client.run_backtest(
       strategy_id=strategy_id,
       symbols=symbols,
       initial_capital=initial_capital,
       start=start,
       end=end,
   )
   summary = backtest_view.summarize(result)
   blocks: list = []
   try:
       blocks = backtest_view.build_blocks(result)
       summary["attachments"] = backtest_view.attachment_refs(blocks)
   except Exception as e:  # presentation-only failure must not fail a successful backtest
       log.warning("Backtest attachment construction failed (result unaffected): %s", e)
       blocks = []
       summary["attachments"] = []
       summary["attachments_error"] = str(e)
   return [TextContent(type="text", text=json.dumps(summary, indent=2)), *blocks]
   ```
   Keep the `client.run_backtest(...)` kwargs **exactly** as they are today (`:270-275`) — feature
   071's `start`/`end` forwarding is asserted by `tests/test_tools.py:272-280,297-298,309-310` and
   must not move. `summarize` is deliberately **outside** the `try`: a projection bug is a real
   failure, only attachment construction degrades (`design.md` § 4).

5. **Docstring (FR-6, first of three surfaces)** — rewrite only the trailing *Returns* paragraph at
   `app/tools.py:265-268`; leave the `strategy_id` / `symbols` / `initial_capital` / `start` / `end`
   parameter prose at `:249-264` untouched (feature 071 owns it). The replacement must state:
   - the tool returns **two parts** — a compact JSON summary as the first text block, plus an
     attached `application/json` resource carrying the **complete** result;
   - what stays inline: `backtest_id`, `status`, the headline metrics, `coverage_gaps`, and per
     symbol its `no_trade_reason`, `bars_total` and `warmup_bars` — enough to explain a 0-trade run
     **without opening the attachment** (this preserves the feature-064 promise the old text made);
   - what moves to the attachment: the full per-bar `diagnostics` and the full `trades` list;
   - that a run with no diagnostics and no trades (e.g. `BACKTEST_STATUS_INSUFFICIENT_DATA`) has
     **no attachment** — the summary with `coverage_gaps` is the whole result;
   - that `summary["attachments"]` names each attached resource's `uri`/`mime_type`, so a client
     that renders no attachment affordance still tells the user detail exists (FR-5).
   **Note the third consumer surface:** this docstring is republished verbatim by
   `GET /api/tools` (`app/main.py:77-96`, registered at `:180`) and rendered on the
   `xstockstrat-ui` `/accounts/mcp-tools` page. No UI fixture pins the text (zero `run_backtest`
   matches under `services/xstockstrat-ui`), so nothing breaks — but the rendered page changes.
   `tests/test_tools_endpoint.py:41-52` asserts descriptions only for `ingest_signal` and
   `trigger_backfill`, so it is unaffected.

6. **Do not touch the module docstring** at `app/tools.py:1-19`. It says "Fourteen tools" (`:4`) and
   this feature adds none — AC-6. Likewise leave `tests/test_tools_endpoint.py:23-38`'s name set
   alone.

7. **Dependency floor (OQ-4)** — change `pyproject.toml:6` from `"mcp>=1.0.0"` to `"mcp>=1.27.1"`,
   then run `uv lock` in `services/xstockstrat-agent/` and commit the updated `uv.lock` in the same
   PR (root `CLAUDE.md` § Python uv lock rule). The resolved version does not change (already
   1.27.1); only `uv.lock:1318`'s recorded specifier does. Rationale, stated honestly per
   `design.md` § 5: **not** because a type requires it — `EmbeddedResource`/`TextResourceContents`
   long predate the floor — but because `>=1.0.0` unbounded is a latent hazard and 1.27.1 is the
   only version whose content-block behavior was verified in-tree.

**Header propagation**: not applicable — this step adds **no** new outbound gRPC call. It reuses the
existing `client.run_backtest` call path unchanged (`app/client.py:192-194`, `metadata=_metadata()`).

**Verification**:

```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check .
cd services/xstockstrat-agent && uv lock --check
cd services/xstockstrat-agent && grep -n 'mcp>=1.27.1' pyproject.toml
cd services/xstockstrat-agent && grep -n 'structured_output=False' app/tools.py
cd services/xstockstrat-agent && uv run pytest tests/ -q
```
The full-suite run is green only once Step 4's adaptation of `test_run_backtest_calls_grpc` is in the
same branch — see § Step Dependencies.

> **Doc-drift note (P-03, surfaced not papered over):** root `CLAUDE.md` § Python uv lock rule states
> `uv lock --check` enforces lock freshness in CI. It does not for this service — the `python-test`
> job installs with `pip install -e ".[dev]"` (`.github/workflows/ci.yml:352-353`) and no
> `uv lock --check` step exists anywhere in `.github/workflows/ci.yml`. The command above is
> therefore a **local** gate only. Not fixed here (out of scope); worth a separate CI change.

---

### Step 4 — test: tool-layer tests for the split return

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tools.py` — modify

**Reviewers**: `xstockstrat-agent` (service owner) — return-shape correctness, AC-1..AC-4 coverage,
no regression of the feature-064 / feature-071 guards. _(Registry gap closed 2026-07-27 — `reviewer-registry.md` now carries an `xstockstrat-agent` row.)_

**Codebase Evidence**:
- Test helpers to reuse, `services/xstockstrat-agent/tests/test_tools.py:15-22`:
  `_make_server()` (builds a `FastMCP("test-agent")` and calls `register_tools`) and
  `_tool_fn(server, name)` (returns `server._tool_manager._tools[name].fn`). The existing
  `run_backtest` tests call the tool via `_tool_fn`, e.g. `:266-270`.
- **Existing test that must be adapted** — `test_run_backtest_calls_grpc`,
  `tests/test_tools.py:260-280`: line `:271` asserts `result["backtest_id"] == "bt-1"` against a
  dict return. After Step 3 the return is a list of content blocks, so this line is red.
  Its `mock_backtest.assert_called_once_with(...)` block at `:272-280` (including feature 071's
  `start=None, end=None`) must be left intact.
- **Existing tests that must keep passing untouched**:
  - `TestRunBacktestWindow` (`:283-323`) — mocks `client.run_backtest` with `{"backtest_id": "bt-2"}`
    (`:288`) and `{"backtest_id": "bt-3"}` (`:303`) and asserts only `call_args.kwargs`; these pass
    iff `summarize` is total over partial dicts (Step 1).
  - `test_start_and_end_are_exposed_on_the_tool_schema` (`:312-323`) — asserts `inputSchema`;
    `structured_output=False` affects only the *output* schema, so this is unaffected.
  - `test_run_backtest_projects_full_result_with_diagnostics` (`:534-577`) — exercises
    **`client.run_backtest`**, not the tool, and `client.py` is untouched. Its `:573-577`
    assertions on `out["diagnostics"][0]["bars"][0]["action"]` stay as-is. **Do not invert it.**
    (`merge-order.md:71-75` recorded this as the sharpest 070/071↔072 conflict; keeping the split in
    `tools.py` resolves it rather than merely sequencing it.)
  - `test_run_backtest_sends_strategy_id_ref_for_registered_definition` (`:580-611`) and
    `TestRunBacktestRangeOnTheWire` (`:614-702`) — both stub-capture level on the client; unaffected.
- Non-echoing-fixture requirement: `docs/roadmap/ledger/insights.md` 2026-07-27 (071 execute entry) —
  a mock whose fields are indistinguishable cannot prove which one a consumer read.

**TDD**: `red-green required` — this is the red half of Step 3's cycle.

**Instructions**:

1. Add `import json` to the imports at `tests/test_tools.py:3-12` (ruff `I` ordering: alongside
   `import base64` at `:3`).

2. **Adapt** `test_run_backtest_calls_grpc` (`:260-280`): replace the single assertion at `:271`
   with a parse of the first content block —
   ```python
   summary = json.loads(result[0].text)
   assert summary["backtest_id"] == "bt-1"
   ```
   Leave `mock_backtest.assert_called_once_with(...)` (`:272-280`) exactly as it is. Add a one-line
   comment naming feature 072 so the shape change is self-documenting.

3. Add a new `class TestRunBacktestAttachment:` immediately after `TestRunBacktestWindow`
   (i.e. after `:323`, before the `# ── screen_symbols (feature 061) ──` banner at `:326`), with a
   module-level or class-level `_result(symbols, bars)` factory that builds a realistic
   `client.run_backtest`-shaped dict. **Non-echoing**: per-bar rows must carry a sentinel
   (`"indicators": {"sentinel_only_in_attachment": 1.0}`) that appears nowhere in the FR-2 summary
   key set, and `volume` as a **string** (`"51234567"`) and `profit_factor` as `"Infinity"` so the
   `MessageToDict` type contract is exercised rather than assumed.

   Tests (each patches `client.run_backtest` with `AsyncMock(return_value=_result(...))` and calls
   `await _tool_fn(server, "run_backtest")(strategy_id="sma", symbols=[...])`):

   - `test_inline_summary_has_no_per_bar_detail` — `result[0]` is a `TextContent`;
     `"sentinel_only_in_attachment" not in result[0].text`; the parsed summary has no `"trades"` key
     and each `diagnostics` entry has no `"bars"` key (**AC-1**).
   - `test_inline_summary_is_independent_of_window_length` — same symbols, 50 bars vs 5,000 bars.
     Same three-part assertion as Step 2 test 4, and for the same reason: `bars_total` legitimately
     differs, so byte-equality of `result[0].text` is unsatisfiable without an inert fixture. Assert
     equality-modulo-`bars_total`, that `bars_total` did change, and that the length delta is
     `< 16` bytes (**AC-1**, reworded per `design.md` § 7).
   - `test_inline_summary_is_linear_in_symbol_count` — 1 symbol vs 10 symbols: `len(result[0].text)`
     grows but stays under a small absolute bound; asserted across **two** symbol counts, not one
     (`design.md` § Open Risks).
   - `test_attachment_round_trips_to_the_complete_result` — `result[1]` is the `EmbeddedResource`;
     `json.loads(result[1].resource.text) == <the exact dict the mock returned>` (**AC-2**, FR-3);
     and the sentinel **is** present in `result[1].resource.text`.
   - `test_the_published_tool_returns_two_content_blocks` — **the only test that crosses the
     `structured_output=False` seam.** Every other test here calls `_tool_fn(...)`, which returns the
     raw undecorated function (`tests/test_tools.py:21-22`), so the return value never passes through
     `FuncMetadata.convert_result` → `_convert_to_content` — the exact machinery Step 3 calls
     load-bearing. Without this, the decorator could be wrong (or the annotation dropped) and every
     other assertion would still pass. Drive the registered tool instead:
     `await server.call_tool("run_backtest", {"strategy_id": "sma", "symbols": ["AAPL"]})`, and assert
     the client-visible content is `[TextContent, EmbeddedResource]` in that order. Additionally assert
     via `await server.list_tools()` that the published `run_backtest` carries **no** `outputSchema` —
     that is the observable proof `structured_output=False` took effect, and it fails loudly if a
     future SDK bump changes the passthrough.
   - `test_zero_trade_run_is_diagnosable_from_the_summary_alone` — a result whose symbols have
     `total_trades: 0`, `no_trade_reason: "NO_TRADE_REASON_ENTRY_NEVER_TRUE"`, `bars_total`,
     `warmup_bars`: all three per-symbol fields plus `total_trades: 0` are present in the parsed
     summary, and `profit_factor` is the **string** `"Infinity"` (**AC-3** regression guard, FR-2).
   - `test_insufficient_data_run_has_coverage_gaps_inline_and_no_attachment` — a result with
     `status: "BACKTEST_STATUS_INSUFFICIENT_DATA"`, populated `coverage_gaps`, empty `trades` and
     empty `diagnostics`: `len(result) == 1`, the parsed summary carries `coverage_gaps`, and
     `summary["attachments"] == []` (**AC-4** regression guard).
   - `test_attachment_failure_degrades_to_summary_only` — patch
     `app.tools.backtest_view.build_blocks` to raise; assert `len(result) == 1`, the summary is still
     complete, `summary["attachments"] == []` and `summary["attachments_error"]` is present — the
     call does **not** raise (FR-5, `design.md` § 4).
   - `test_summary_advertises_its_attachments` — `summary["attachments"]` is a one-element list whose
     entry has `mime_type == "application/json"` and a `uri` containing the `backtest_id` (FR-5).

4. Do **not** add, rename, or remove any tool; do **not** touch `tests/test_tools_endpoint.py`
   (**AC-6** — the name-set assertion at `:23-38` and the five prose count statements stay at
   whatever value feature 070 left them: "fourteen").

**Verification**:

```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check .
cd services/xstockstrat-agent && uv run pytest tests/test_tools.py tests/test_tools_endpoint.py tests/test_client.py -q
cd services/xstockstrat-agent && uv run pytest --cov=app --cov-report=term-missing --cov-fail-under=40
```
All must pass; the last must report total coverage ≥ 40% (CI parity —
`.github/workflows/ci.yml:336-338,353-358`). Confirm in the middle run that
`test_run_backtest_projects_full_result_with_diagnostics` and all of `TestRunBacktestWindow`,
`TestRunBacktestRangeOnTheWire` are **still passing** — they are the feature-064/071 guards.

---

### Step 5 — docs: document the split return shape on the remaining consumer surfaces

**Status**: `pending`
**Service**: `docs/runbooks/`, `services/xstockstrat-agent/`
**Files**:
- `docs/runbooks/mcp-tools.md` — modify
- `services/xstockstrat-agent/CLAUDE.md` — modify

**Reviewers**: none (per `docs/runbooks/reviewer-registry.md:43-51`, step category `docs` → None).

**Codebase Evidence**:
- The stale Return block: `docs/runbooks/mcp-tools.md:277-281` —
  ```
  **Return**

  ```json
  { "backtest_id": "bt-abc123" }
  ```
  ```
  This is **already wrong on trunk**: feature 064 made `run_backtest` return the full result, and the
  doc was never updated. Repairing it is part of FR-6, not scope creep.
- Section boundaries confirmed: `### \`run_backtest\`` starts at `docs/runbooks/mcp-tools.md:241`;
  the Parameters block is at `:245-253` (**feature 071 owns it — do not touch**); the
  evaluation-window section runs `:255-275`; the Return block is `:277-281`; the Errors table starts
  at `:283`.
- Agent service doc: `services/xstockstrat-agent/CLAUDE.md` § MCP Tools table, the `run_backtest`
  row currently reads *"Trigger a backtest via xstockstrat-analysis (optional `start`/`end`
  evaluation window — feature 071)"*.
- **Count statements that must NOT change** (AC-6): `docs/runbooks/mcp-tools.md:3` ("the fourteen
  tools") and `:29` ("the same fourteen tools"); `services/xstockstrat-agent/app/tools.py:4`
  ("Fourteen tools:"); `services/xstockstrat-agent/CLAUDE.md` ("registers fourteen tools");
  `docs/runbooks/CLAUDE.md:17` ("all fourteen agent tools"). Two of these files are edited by this
  feature — the criterion binds the count *statements*, not the files
  (`product-spec.md` AC-6; `merge-order.md:79-83`).
- **No resources section is needed** (FR-6a discharged by omission): this design registers **no** MCP
  resource — `design.md` § 6 — so `mcp-tools.md` stays a tools-only reference and the agent
  `CLAUDE.md` gains no resources section. Recon confirmed zero `@server.resource` registrations in
  the service.

**TDD**: `N/A (docs — no executable logic)`.

**Instructions**:

1. `docs/runbooks/mcp-tools.md` — replace the Return block at `:277-281` with a description of the
   two-part result matching the Step 3 docstring:
   - State that the tool returns **content blocks**: a text block carrying a compact JSON summary,
     followed (when there is detail to attach) by one embedded `application/json` resource carrying
     the **complete** `BacktestResult`.
   - Show a realistic trimmed summary JSON example including `backtest_id`, `status`, the headline
     metrics, a `diagnostics` array of `{symbol, no_trade_reason, bars_total, warmup_bars}`, and the
     `attachments` array of `{uri, mime_type}`. Use `"profit_factor": "Infinity"` in the example
     with a one-line note that `MessageToDict` renders non-finite doubles and int64s as **strings**
     — this is the exact contract that decided the format (ledger insights 2026-07-27).
   - State the attachment URI form: `xstockstrat:///backtest/<backtest_id>/result.json`.
   - State what moves to the attachment: full per-bar `diagnostics` and the full `trades` list.
   - State the no-attachment case: a run with no diagnostics and no trades (typically
     `BACKTEST_STATUS_INSUFFICIENT_DATA`) returns the summary block only, `attachments: []`; the
     `coverage_gaps` are inline.
   - State the degradation contract (FR-5): attachment rendering is client-dependent; the summary
     always stands alone, and `attachments` names what exists. If attachment construction fails the
     tool still succeeds and adds `attachments_error`.
   - Leave the Parameters block (`:245-253`), the evaluation-window section (`:255-275`) and the
     Errors table (`:283+`) untouched.
2. `services/xstockstrat-agent/CLAUDE.md` — extend the `run_backtest` row of the MCP Tools table to
   note the return shape, e.g. append *"; returns a compact summary block plus the full result as an
   attached `application/json` resource (feature 072)"*. One line only — do not add a resources
   section, and do not change "fourteen".

**Verification**:

```bash
# -i is required: app/tools.py:4 reads "Fourteen tools:" with a capital F, so a case-sensitive
# grep returns 4 and this AC-6 gate fails spuriously on every run.
grep -in "fourteen" docs/runbooks/mcp-tools.md docs/runbooks/CLAUDE.md services/xstockstrat-agent/CLAUDE.md services/xstockstrat-agent/app/tools.py
grep -n "bt-abc123" docs/runbooks/mcp-tools.md
grep -rn "xstockstrat:///backtest" docs/runbooks/mcp-tools.md services/xstockstrat-agent/app/tools.py
sed -n '241,300p' docs/runbooks/mcp-tools.md
```
Expect: five "fourteen" statements still present and unchanged (AC-6); **zero** `bt-abc123` matches
(the stale block is gone, AC-5); the attachment URI form documented in both the runbook and the tool
docstring; and the Parameters block at `:245-253` visibly unmodified.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
