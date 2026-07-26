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
