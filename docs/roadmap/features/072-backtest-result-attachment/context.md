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
