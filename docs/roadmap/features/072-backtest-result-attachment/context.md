# Context: backtest-result-attachment

**Feature**: `docs/roadmap/features/072-backtest-result-attachment/feature.md`
**Product Spec**: `docs/roadmap/features/072-backtest-result-attachment/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/072-backtest-result-attachment/implementation-spec.md`

---

## Session 2026-07-26 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- **Origin:** raised while feature 071 was mid-implementation. The user asked that `run_backtest`
  return an attached file instead of a large prose payload.

### Two user decisions taken at story time

1. **Scope — separate feature, not an FR on 071.** 071 is already `design-approved` with six steps
   left, including the risky `trade_start_idx` loop restructure. Folding this in would have reopened
   071's product spec, re-run its review gate, and delayed the window work behind engine risk. This
   change is agent-only and independently shippable.
2. **Payload split — summary inline, detail attached.** Chosen over "everything attached" (which
   would regress feature 064's stated purpose — the agent could no longer explain a 0-trade run) and
   over a threshold-based split (which would need a config key and give the tool two response shapes
   to test). This became FR-2, with AC-3 as the feature-064 regression guard.

### Grounding verified before writing the spec

- `mcp>=1.0.0` / `mcp.server.FastMCP`; the installed SDK exposes `EmbeddedResource`, `ResourceLink`,
  `BlobResourceContents`, `TextResourceContents` — an attachment return is protocol-supported.
- **All thirteen existing tools return plain `dict`/`str`** — no in-repo precedent for a non-text
  tool result, so the mechanism has to be established from scratch.
- Transport is Streamable HTTP (MCP 2025-03-26) + SSE (`app/main.py:50-98`).
- The bloat source is `client.run_backtest` (`app/client.py:166-175`) serialising the whole proto
  with `always_print_fields_with_no_presence=True`, including feature-064 per-bar `diagnostics`.
- **No analysis-service change is needed** — the full `BacktestResult` already arrives over the wire.

### Open threads for /sdd-design

- **OQ-1 is load-bearing:** an `EmbeddedResource` still ships the bytes in the tool result, so if the
  client inlines it the payload is *relabelled but not reduced* and FR-1's intent is defeated. A
  `ResourceLink` genuinely defers. Strong reuse candidate: feature 068 already persists every OK run
  (`analysis.backtest_details`) and serves it via `GetBacktest(backtest_id)`, so a link could resolve
  through that with **no new storage or TTL**. Must also handle `INSUFFICIENT_DATA` runs, which 068
  may not persist.
- OQ-2 format (CSV is far more compact for the tabular per-bar diagnostics; the envelope is nested).
- OQ-3 auth on the resource-read path if OQ-1 picks `ResourceLink`.
- Client rendering of MCP resources is client-dependent — FR-5 requires the inline summary to stand
  alone rather than assuming a download affordance exists.

### Cross-feature note

Rebase-only overlap with `071-backtest-time-window`: both edit `app/tools.py` `run_backtest`,
`app/client.py` `run_backtest`, and the same `docs/runbooks/mcp-tools.md` section. 071 changes the
tool's **inputs**, 072 its **output** — no field/key/migration collision. Recorded in
`merge-order.md`.

### Deviation — branch

Per the harness assignment, this session works on `claude/features-070-071-rnbkqo` rather than
`feature/backtest-result-attachment`. Only the SDD artifacts are being created here; no
implementation has started.

## Session 2026-07-26 — sdd-review product-spec

- **Verdict: PASS WITH WARNINGS.** No blockers, no Floor breach. Status: `draft` → `spec-ready`.
- All code citations verified as resolving. Confirmed true: thirteen tools all returning `dict`, zero
  non-text MCP content types anywhere in the agent, proto line ranges exact, no `xstockstrat-agent`
  row in the reviewer registry.

### Warnings addressed

1. **AC preamble was factually wrong.** AC-3, AC-4 and AC-6 *pass* on unmodified `main-dev`; only
   AC-1/2/5 are red. Left as written it would have sent `/sdd-execute` chasing a red test that cannot
   exist (P-06). Split along feature 070's precedent and each guard tagged inline.
2. **AC-6 pinned the literal "thirteen"**, which feature 070 is actively renumbering to "fourteen".
   Reworded count-agnostically, and now binds the count **statements** rather than the files (two of
   which FR-6 legitimately edits).
3. **C-10 gap conditional on OQ-1** — a `ResourceLink` would make this the agent's *first* MCP
   resource, a documented consumer surface FR-6 did not cover (`mcp-tools.md` documents tools only;
   the agent `CLAUDE.md` has no resources section). Added FR-6a so the obligation is inherited by
   whichever OQ-1 branch wins.
4. **Six unchecked open questions, three of which were resolved notes in checkbox clothing.** Moved
   the trap/overlap/registry items into a new `## Design Constraints & Recorded Notes` section so the
   gate reads genuine open questions only.

### Verified what the reviewer could not

The reviewer flagged it could not confirm the resolved MCP SDK version (`pyproject.toml:6` pins only
`mcp>=1.0.0`, unbounded). Checked directly: **`mcp == 1.27.1`** in `uv.lock`, and all four of
`EmbeddedResource` / `ResourceLink` / `BlobResourceContents` / `TextResourceContents` import cleanly.
Recorded as **OQ-4**: if the design picks `ResourceLink`, the floor must be raised in the same PR, or
a clean resolve can silently produce a build without the type.

### Overlap scan — the 068 reuse is real but NOT free

`GetBacktest` serves the exact bytes the agent already received, so FR-3 fidelity is exact with zero
new storage. Four verified gaps now written into OQ-1:

1. **`INSUFFICIENT_DATA` runs are never persisted** — confirmed, not "may". Insert gated on OK
   (`servicer.py:507-511`); the contract states NOT_FOUND for INSUFFICIENT runs
   (`analysis.proto:18-20`). A `ResourceLink` there **dangles**, and AC-4 is exactly that case.
2. **Persistence is best-effort** (`servicer.py:1295-1296`), so even an OK run can lack a detail row,
   with no signal in `BacktestResult` telling the agent to fall back.
3. **Count-based eviction** (`detail_retention_per_strategy`, default 20) silently invalidates an
   outstanding link — a lifetime owned by another feature's config key.
4. **No agent-side plumbing exists** — zero `GetBacktest` hits under `services/xstockstrat-agent/`.

**`EmbeddedResource` avoids gaps 1–3 entirely**, so OQ-1 is a genuine tradeoff rather than a foregone
conclusion. **Escalation flagged:** closing gap 1 by persisting INSUFFICIENT runs would require
editing `servicer.py:507-511` — inside the `RunBacktest` region feature 071 restructures — upgrading
the overlap from rebase-only to a hard dependency.

### merge-order.md amended

The note added at story time was accurate but insufficient. Corrected for: **070 + 071 are ONE merge**
(shared branch), not two; the **sharpest conflict is a test** — `test_tools.py:485-527` asserts the
full result *is* projected inline, which 072 must invert while 071 edits the same file; **six**
count-bearing surfaces, not five (the `test_tools_endpoint.py` name-set assertion); doc **sub-block**
ownership (071 → Parameters `:245-251`, 072 → Return `:253-257`); and a forward-looking line on the
escalation above.

### Also noted

`docs/runbooks/mcp-tools.md:253-257` is **already stale on trunk** — it documents the return as
`{ "backtest_id": "bt-abc123" }`, superseded by feature 064. FR-6's rewrite repairs that drift; the
impl spec should say so, so the diff is not mistaken for scope creep.

## Session 2026-07-27 — sdd-design

- **Phase 0 Recon**: wrote `recon.md` (service: `xstockstrat-agent`; `xstockstrat-analysis` surveyed
  read-only as the OQ-1 link target). Key reuse patterns: the feature-064 `MessageToDict` flag pair
  (`client.py:200-204`) as the summary's *source* so it cannot drift; the existing raw-ASGI auth gate,
  which already covers a resource read.
- **Phase 1 Grilling**: 1 round (quick). Adversary verdict **NEEDS WORK**, **no Floor breach**; all
  objections resolved before approval.
- **Chosen approach**: `@server.tool(structured_output=False)` returning
  `[TextContent(summary), EmbeddedResource(compact-JSON TextResourceContents)]`; split in `tools.py`
  only, `client.run_backtest` untouched.
- **Rejected**: `ResourceLink` (failure asymmetry — unrecoverable vs merely verbose); CSV (fidelity
  failure, verified by execution); base64/Blob (+33% for a non-reason); gzip (recorded as the
  designated escalation); `CallToolResult` (unvalidated `structuredContent` for a harder SDK floor).
- **Constitution rules touched**: F-04, F-07, F-11, C-01, C-05, C-08, C-10, C-11, C-12(n/a), P-03,
  P-05, P-06. Floor breaches: **none**.
- Status: `spec-ready` → `design-approved`.

### Decisions

- **OQ-1 → `EmbeddedResource`.** Decisive argument is failure asymmetry under statelessness, not
  size: the agent has no in-memory store, so a dangling `ResourceLink` loses the bytes permanently and
  the user re-runs the backtest. And the agent **cannot know at emit time whether a link would
  resolve** — nothing in `BacktestResult` reports whether feature-068's best-effort detail row landed.
- **OQ-2 → one compact-JSON `TextResourceContents`** (user-selected). The blob literally *is*
  `client.run_backtest`'s dict, so FR-3 fidelity holds by construction rather than by a reassembler.
- **OQ-3 → moot.** This design registers no MCP resource. (Had it needed one, recon verified the
  `aud`-JWT gate at `main.py:105-114` already applies at `:148-150`, before the transport branch, so
  `resources/read` was gated identically anyway.)
- **OQ-4 → pin `mcp>=1.27.1`**, honestly labelled: not because a type requires it, but because
  `>=1.0.0` unbounded is a latent hazard and 1.27.1 is the only version whose content-block behavior
  was verified in-tree.
- **AC-1 reworded** (user-selected): "independent of window length; linear in symbol count." FR-2 and
  the original AC-1 are strictly incompatible; FR-2 wins because it protects the feature-064 0-trade
  diagnosis.

### Verified by execution (not inferred)

Run against the installed SDK and generated stubs rather than reasoned about:

- `structured_output=False` → `FuncMetadata(arg_model=arguments_model)` (`func_metadata.py:264-265`);
  `ContentBlock` passes through verbatim (`:521-522`) and lists flatten (`:530-536`). So no
  `CallToolResult` is needed.
- `AnyUrl` accepts `xstockstrat:///backtest/<id>/result.json` — the proposer's flagged unverified
  assumption resolves in its favor; no `file:///` fallback.
- `func_metadata.py:539` uses `indent=2`, so today's payload really is pretty-printed — the
  "even the worst case beats trunk" argument rests on a real ~1.6× from whitespace alone.
- **`MessageToDict` type mapping — this is what killed CSV:** `bar_index` → `7` (`int`),
  `volume` → `'51234567'` (`str`, int64→JSON string), `vwap` → `'NaN'` (`str`),
  `profit_factor` → `'Infinity'` (`str`). `csv.DictReader` returns everything as `str`, and
  `json_format` rejects `'nan'` on parse. A CSV "round-trip" would have been a hand-written
  type-reconstruction table wearing a fidelity label.

### Open Threads

- [ ] **Connector may inline the attachment anyway** — the one premise the OQ-1 decision rests on
  that cannot be verified in-repo. Accepted; disconfirming observable = a real connector run whose
  context still balloons; escalation = gzip blob, additive. → revisit after first real-world run.
- [ ] `backtest_view.summarize` must be total over partial dicts, or `test_tools.py:288,303` break.
  → step 1.
- [ ] Non-echoing fixtures: AC-2's must carry per-bar content present **only** in the attachment;
  AC-1 must assert across **two** symbol counts. → steps 1 and 3.
- [ ] Apply the AC-1 rewording and fix stale line citations in `product-spec.md`. → /sdd-spec.
- [ ] `profit_factor` is the **string** `"Infinity"` on zero losing trades — AC-3/AC-4 assertions must
  expect that. → step 1.

## Session 2026-07-27 — sdd-spec

- Generated `implementation-spec.md` with **5 steps**. Status: `design-approved` →
  `implementation-ready`. Two `service`+`test` pairs (C-08) plus one `docs` step; no proto, no
  migration, no config key, no `xstockstrat-analysis` change.
- Step map: **1** `app/backtest_view.py` (new pure module: `summarize` / `build_blocks` /
  `attachment_refs`) → **2** `tests/test_backtest_view.py` → **3** `tools.py` `run_backtest`
  returns `[TextContent(summary), *blocks]` under `structured_output=False` + docstring rewrite +
  `mcp>=1.27.1` pin → **4** `tests/test_tools.py` tool-layer tests → **5** docs
  (`mcp-tools.md` Return block + agent `CLAUDE.md` row).

### Key codebase findings (all read on the post-070/071 tree, branch `claude/features-070-071-rnbkqo`)

- `run_backtest` tool is at `app/tools.py:240-275` (decorator `:240`, signature `:241-247`,
  docstring `:248-268` with the Returns paragraph at `:265-268`, body `:269-275`) — **not** the
  `:239-260` the product spec cited. `client.run_backtest` is `app/client.py:143-204`, projection
  at `:200-204`; it is **untouched** by this feature.
- **The SDK claims in design.md were re-verified by execution**, not carried over on trust
  (`services/xstockstrat-agent/.venv`, `mcp == 1.27.1`):
  `inspect.signature(FastMCP.tool)` → `[... 'meta', 'structured_output']`;
  `func_metadata.py:264` `if structured_output is False: return FuncMetadata(arg_model=…)`;
  `:521` `ContentBlock` passthrough; `:530` list flatten; `:539` `indent=2` (today's payload really
  is pretty-printed); `types.py:761-763` `Annotations.audience/priority`, `:871`
  `TextResourceContents`, `:1177` `EmbeddedResource`; and
  `AnyUrl('xstockstrat:///backtest/bt-1/result.json')` is accepted.
- **A second contradictory test exists that recon did not name**: `test_run_backtest_calls_grpc`
  (`tests/test_tools.py:260-280`) asserts `result["backtest_id"] == "bt-1"` at `:271` on the **tool's**
  return. Step 3 makes that a list of content blocks, so it goes red. Recon flagged only
  `test_run_backtest_projects_full_result_with_diagnostics` (`:534-577`), which is a *client*-level
  test and is genuinely preserved. Consequence recorded in § Step Dependencies: **Steps 3 and 4 must
  land in one step branch/PR**, or Step 3 commits red (F-05).
- Count statements verified in place and untouched by this feature (AC-6): `mcp-tools.md:3`, `:29`,
  `app/tools.py:4`, agent `CLAUDE.md:26`, `docs/runbooks/CLAUDE.md:17` — all read "fourteen" after
  feature 070; plus the name-set assertion at `tests/test_tools_endpoint.py:23-38`.
- `docs/runbooks/mcp-tools.md` §`run_backtest`: Parameters block `:245-253` (feature 071 owns it),
  evaluation-window section `:255-275`, **Return block `:277-281`** (the stale
  `{ "backtest_id": "bt-abc123" }`, superseded by feature 064), Errors from `:283`.
- CI parity for the agent: `.github/workflows/ci.yml:336-338` — `coverage_threshold: 40`,
  `cov_source: app`; lint is `ruff check .` + `ruff format --check .` (`:307-310`).
- `reviewer-registry.md:9-24` still has **no `xstockstrat-agent` row** — the Reviewers snapshot in
  `feature.md` is inferred and labelled as such.

### Decisions

- **`build_blocks` / `attachment_refs` live in `app/backtest_view.py`, not `tools.py`.** design.md
  § 3 names that module only for `summarize` and shows the `EmbeddedResource` construction (§ 2)
  without naming a home. Placing all three together keeps `tools.py` a thin call site and makes the
  whole split unit-testable without a `FastMCP` server. Recorded here rather than left silent (P-03);
  it is a placement detail inside the approved design, not a change to it.
- **`summarize` runs outside the degradation `try/except`.** design.md § 4 degrades only on
  *attachment construction* failure; a projection bug is a real failure and must surface.
- **The attach/no-attach rule is content-based, not status-based** — truthy `trades` or any symbol
  with truthy `bars`. AC-4's `INSUFFICIENT_DATA` case then falls out of the general rule instead of
  needing a `status` branch.
- **The `mcp>=1.27.1` pin is folded into Step 3** rather than given its own step, so it does not
  drag a spurious C-08 test pairing; `uv lock` + committed `uv.lock` are in the same step's Files.

### Open Threads

- [ ] **Doc drift found, not fixed (out of scope).** Root `CLAUDE.md` § Python uv lock rule claims
  `uv lock --check` gates CI. It does not: the `python-test` job installs with
  `pip install -e ".[dev]"` (`.github/workflows/ci.yml:352-353`) and no `uv lock --check` step exists
  anywhere in the workflow. Step 3's `uv lock --check` is therefore a **local** gate only. Worth a
  separate CI change; noted in the step body so `/sdd-execute` does not mistake it for a CI guarantee.
- [ ] **Connector may inline the attachment anyway** — unchanged from design; accepted, escalation is
  a gzip blob (additive). Revisit after the first real-world run.
- [x] `backtest_view.summarize` totality over partial dicts → Step 1 instructions + Step 2 test 7.
- [x] Non-echoing fixtures + two symbol counts → Steps 2 (tests 4, 5, 8) and 4.
- [x] `profit_factor` as the string `"Infinity"` → Steps 2 (test 6) and 4.
- [x] AC-1 rewording + stale citations applied to `product-spec.md`.

## Session 2026-07-27 — sdd-review impl-spec (advisory)

**PASS WITH WARNINGS** — 0 blockers, 5 warnings, 7 notes, **no Floor breach**. Overlap scan
returned **CLEAN** (no config / proto / migration / file collision; 072 declares none of the first
three, and 070+071 are merged so their edits are trunk reality rather than pending diffs).

Four warnings were **fixed in the spec before execute**, deliberately — **F-09** freezes step bodies
once execution starts, so these would otherwise have become Deviation Log churn:

1. **The byte-identity assertion was unsatisfiable** (Steps 2 and 4). `_SYMBOL_KEYS` retains
   `bars_total`, which tracks bar count by definition, so a 50-bar and a 5,000-bar summary can never
   be byte-identical — the only way to make it pass would be pinning `bars_total` equal across the
   two fixtures, which is exactly the inert-fixture trap the same step warns about. It was also an
   over-extension of the approved design, which says *independent of window length*, not
   *byte-identical*. Replaced with a three-part assertion: equal after popping `bars_total`;
   `bars_total` **did** change (proving the fixture is live); serialized length delta `< 16` bytes.
2. **Nothing crossed the `structured_output=False` seam** (Step 4). Every test called `_tool_fn`,
   which returns the raw undecorated function, so the return value never reached
   `FuncMetadata.convert_result` → `_convert_to_content` — the machinery Step 3 calls load-bearing.
   The decorator could have been wrong and every assertion would still have passed. Added a
   `server.call_tool(...)` round-trip plus a `list_tools()` assertion that the published tool carries
   no `outputSchema`.
3. **`grep -n "fourteen"` is case-sensitive** and `app/tools.py:4` reads "**F**ourteen tools:", so the
   AC-6 gate returned 4 matches against a stated expectation of 5 — a spurious failure on every run.
   Verified by running it. Now `grep -in`.
4. **Two proto citations did not resolve** — the metric fields are `analysis.proto:68-74` plus
   `initial_capital` at `:83` (not `:67-79,82`), and `SymbolDiagnostics` is `:140-146` with
   `warmup_bars` at `:145`, outside the cited `:139-144` even though `_SYMBOL_KEYS` depends on it.

Also fixed: `_full_result()` was specified no-arg but tests 4 and 5 need it parameterized by bar and
symbol count (Step 4's `_result(symbols, bars)` already had it right).

**Not a defect, but load-bearing for dispatch:** Step 3's verification cannot pass standalone —
`test_run_backtest_calls_grpc` (`tests/test_tools.py:271`) asserts `result["backtest_id"]` on the
**tool's** return and goes red the moment Step 3 returns content blocks. Steps 3 and 4 must be
dispatched to `/sdd-execute` as **one unit** or the run trips F-05.

The reviewer independently re-verified the whole `structured_output=False` chain against the
installed `mcp == 1.27.1` — `FastMCP.tool` signature, `func_metadata.py:264-265/521-522/530-536/539`,
and the `convert_result` path — and confirmed the design's core mechanism is sound. It also confirmed
the spec's `uv lock --check` doc-drift finding is real (zero occurrences anywhere under
`.github/workflows/`), which means the spec **supersedes** `design.md:99`'s claim that it gates CI.

Separately repaired from the overlap scan (committed alongside): `merge-order.md`'s note said
"072 must invert that exact assertion" about the feature-064 guard — now false, and it would have
misdirected execution — and 070's lifecycle still read `in-progress` after its own merge.

### Open Threads (added)

- [ ] Root `CLAUDE.md` claims `uv lock --check` gates CI; it does not. Out of 072's scope — worth a
  separate docs fix.
- [ ] `docs/runbooks/reviewer-registry.md` still has no `xstockstrat-agent` row (shared gap with 070
  and 071), so this feature's reviewer focus stays inferred rather than registry-sourced.
