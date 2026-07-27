# Product Spec: backtest-result-attachment

**Created**: 2026-07-26

---

## Problem Statement

The `run_backtest` MCP tool returns the **entire** `BacktestResult` inline. `client.run_backtest`
(`services/xstockstrat-agent/app/client.py:166-175`) serialises the whole proto with
`MessageToDict(..., always_print_fields_with_no_presence=True)`, which includes the per-symbol
`diagnostics` added by feature 064 — a day-by-day row per bar (OHLCV, every computed indicator value,
warm-up flag, entry/exit/conviction decision) for **every simulated symbol**. A five-symbol backtest
over the default ~504-trading-day window is on the order of 2,500 bar rows, all delivered as one
inline payload that the model then renders as prose. It is unreadable for a human, and it consumes an
enormous share of the agent's context for data that is mostly only needed on demand.

**Grounding (verified, not assumed):**
- The MCP Python SDK resolves to **`mcp == 1.27.1`** (`services/xstockstrat-agent/uv.lock`), which
  exposes `EmbeddedResource`, `ResourceLink`, `BlobResourceContents` and `TextResourceContents` —
  confirmed by import, not inferred. **However `pyproject.toml:6` pins only `mcp>=1.0.0`
  (unbounded)**, and `ResourceLink` is a later-spec addition than that floor. If the design picks
  `ResourceLink` it MUST raise the floor in the same PR, or a fresh resolve can silently produce a
  build without it.
- **All thirteen current tools return plain `dict`** — this would be the agent's first non-text tool
  result, so there is no in-repo precedent to copy. Verified: zero matches for
  `EmbeddedResource|ResourceLink|BlobResourceContents|TextResourceContents|ImageContent` anywhere
  under `services/xstockstrat-agent/`.
- Transport is Streamable HTTP (MCP 2025-03-26) plus SSE
  (`services/xstockstrat-agent/app/main.py:50-103` — `build_sse_app` opens at `:50`, SSE at `:75`,
  `StreamableHTTPSessionManager` at `:103`).
- **An existing test pins today's behavior**: `test_run_backtest_projects_full_result_with_diagnostics`
  (`services/xstockstrat-agent/tests/test_tools.py:534-577`) asserts the full result *is* projected
  inline with `diagnostics` present. This feature must invert that assertion, or preserve it by
  keeping `client.run_backtest` intact and splitting in `tools.py`. Either way it is directly in the
  blast radius. **Resolved at design:** the split lives in `tools.py` and `client.run_backtest` is
  untouched, so this test is **preserved**, not inverted (design.md § Chosen Approach).

> **Line-citation correction (applied at `/sdd-spec`, per design.md § Open Risks).** Several
> citations in this spec were captured before feature 071 restructured the surrounding code and no
> longer resolve. The correct lines, verified on the post-070/071 tree, are:
> `tests/test_tools.py:534-577` (not `:485-527`); `xstockstrat-analysis` `app/handlers/servicer.py:527-528`
> (the `BACKTEST_STATUS_OK` gate, not `:507-511`), `:1398-1399` (no-op without a repo, not
> `:1281-1282`), `:1403` (retention read, not `:1286`), `:1412-1413` (swallowed write, not
> `:1295-1296`), `:1498-1523` (`GetBacktest` handler, not `:1275-1292`);
> `packages/proto/analysis/v1/analysis.proto:19-22` (`GetBacktest` RPC + its NOT_FOUND contract, not
> `:18-20`/`:21`), `:65-84` (`BacktestResult`, not `:64-83`), `:61-64` (the persisted-verbatim
> warning, not `:60-63`); `services/xstockstrat-agent/app/tools.py:240-275` (the tool, not
> `:239-260`) with the Returns paragraph at `:265-268` (not `:252-255`);
> `app/client.py:143-204` with the projection at `:200-204` (not `:166-175`);
> `docs/runbooks/mcp-tools.md:277-281` (the Return block, not `:253-257`) and `:245-253` (feature
> 071's Parameters block, not `:245-251`); `tests/test_tools_endpoint.py:23-38` (not `:23-37`).
> `recon.md` carries the correct set; `implementation-spec.md` cites only verified lines.

## User Story

As a strategy author driving backtests through the MCP agent, I want the full result delivered as an
attached file with only a compact summary inline, so that I can read the outcome at a glance and open
the detail when I actually need it — instead of scrolling thousands of lines of bar-by-bar prose.

## Functional Requirements

FR-1. `run_backtest` MUST return a **compact inline summary** plus an **attachment** carrying the full
detail, rather than one large inline payload.

FR-2. The inline summary MUST remain sufficient to diagnose the common failure case **without**
opening the attachment. It MUST retain at minimum: `backtest_id`, `status`, the headline metrics
(`total_return`, `sharpe_ratio`, `max_drawdown`, `win_rate`, `total_trades`, `profit_factor`,
`initial_capital`), any `coverage_gaps`, and **per symbol** its `no_trade_reason`, `bars_total` and
`warmup_bars`.

> This requirement exists to protect feature 064. The current `run_backtest` docstring
> (`services/xstockstrat-agent/app/tools.py:252-255`) states the diagnostics are returned so the agent
> can "explain why a strategy produced 0 trades and suggest changes to the strategy or its
> indicators." Moving *everything* into an opaque attachment would regress that capability, because
> the model cannot read an attachment it has not fetched. The per-symbol `no_trade_reason` +
> `warmup_bars` fields are precisely the 0-trade diagnosis, so they stay inline.

FR-3. The attachment MUST carry the full `BacktestResult` — including the complete per-bar
`diagnostics` for every symbol and the full `trades` list — in a machine-readable format, with no
loss of fidelity versus today's inline payload.

FR-4. The attachment MUST be delivered through an MCP-native mechanism (`EmbeddedResource` or
`ResourceLink` — chosen at design, see OQ-1), not by writing to a local path. The agent is a remote
service; a filesystem path is not reachable by the client.

FR-5. **Graceful degradation.** Client rendering of MCP resources is client-dependent and outside
this platform's control. If a client does not surface an attachment affordance, the inline summary
(FR-2) MUST still stand on its own as a usable result. The design MUST state this assumption
explicitly rather than presuming a download UI exists.

FR-6. The `run_backtest` tool docstring and `docs/runbooks/mcp-tools.md` (§`run_backtest` **Return**
block, `:253-257` — 071 owns the Parameters table at `:245-251`) MUST describe the new return shape
and what lives inline versus in the attachment.

> Note: `mcp-tools.md:253-257` is **already stale on trunk** — it documents the return as
> `{ "backtest_id": "bt-abc123" }`, which feature 064 superseded when it began returning the full
> result. FR-6's rewrite therefore also repairs pre-existing drift; that part of the diff is not
> scope creep.

FR-6a. **Conditional surface (inherits from OQ-1).** If the design registers an MCP **resource**
(the `ResourceLink` branch), that resource is the agent's first, and it becomes a new documented
consumer surface: `docs/runbooks/mcp-tools.md` currently documents *tools only* and
`services/xstockstrat-agent/CLAUDE.md` has no resources section. Whichever branch OQ-1 takes, the
C-10 documentation obligation for it MUST be discharged in the same PR rather than rediscovered at
execute time. (`services/xstockstrat-agent/CLAUDE.md:36`, the `run_backtest` tool-table row,
describes only what the tool does and needs no edit for a return-shape change — stated so the
omission is deliberate.)

> **Resolved at design (design.md § 6).** OQ-1 landed on `EmbeddedResource`, which registers **no**
> MCP resource — so FR-6a is discharged by *not creating* the surface: `docs/runbooks/mcp-tools.md`
> stays a tools-only reference and the agent `CLAUDE.md` gains no resources section. The design does,
> however, elect to append one clause to the `CLAUDE.md:36` tool-table row noting the new return
> shape (superseding the "needs no edit" note above), and identifies a **third** consumer surface the
> spec did not list: the tool docstring is republished verbatim by `GET /api/tools`
> (`app/main.py:77-96`, registered `:180`) and rendered on the `xstockstrat-ui` `/accounts/mcp-tools`
> page. No UI fixture pins that text (zero `run_backtest` matches under `services/xstockstrat-ui`),
> so the rewrite changes the rendered page without breaking anything.

## Out of Scope

- Any change to backtest math, scoring, fills, or sizing — this is purely a **return
  representation** change in the agent layer.
- Changing the return shape of the other twelve MCP tools (a shared helper may be introduced, but
  retrofitting other tools is a separate decision).
- Any `xstockstrat-ui` change. The UI calls `RunBacktest` over its own BFF and is unaffected.
- Persisting anything new: feature 068 already stores every OK run's full result (see OQ-1).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-agent` — **the only service that changes.** `run_backtest` tool
  (`app/tools.py:239-260`) and its client wrapper (`app/client.py:143-175`).

No change to `xstockstrat-analysis`: the full `BacktestResult` already arrives over the wire; this
feature only changes how the agent presents it.

## Proto Contract Changes

- [x] No proto changes required
- The agent already receives the complete `BacktestResult` (`analysis.proto:64-83`). Nothing new is
  needed on the wire. Note that message's persisted-verbatim warning (`analysis.proto:60-63`) — a
  reason **not** to reshape it for presentation purposes.

## Config Key Changes

- [x] No new config keys
- The chosen split is unconditional (summary inline, detail attached), so no size/bar-count threshold
  tunable is required. A threshold-based variant was explicitly rejected at story time precisely
  because it would need a config key and give the tool two response shapes to test.

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/backtest-result-attachment` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval — behavior change confined to `xstockstrat-agent` (no proto, no
  config, no migration)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A, no proto change
- [ ] DBA review + service owner (schema migration) — N/A

## Acceptance Criteria

**AC-1, AC-2 and AC-5 fail on unmodified `main-dev`**, where `run_backtest` returns one inline dict
containing every diagnostic bar. **AC-3, AC-4 and AC-6 pass today** and are **regression guards** —
they exist to prove this feature does not break what already works. Tagged individually below so
`/sdd-execute`'s red-before-green gate (P-06) does not chase a red test that cannot exist.

1. A multi-symbol `run_backtest` call returns an inline payload that does **not** contain per-bar
   `diagnostics` or the full `trades` list, and whose size is **independent of window length and
   linear in symbol count**.

   > **Amendment (recorded at `/sdd-design`, applied at `/sdd-spec`; approved by the user
   > 2026-07-27 — design.md § 7).** As originally written this criterion said "a small bounded size
   > regardless of window length **or symbol count**", which is strictly incompatible with FR-2:
   > FR-2 requires a per-symbol `no_trade_reason`/`bars_total`/`warmup_bars` row, so the summary is
   > necessarily O(symbols). FR-2 wins, because it is what protects the feature-064 0-trade
   > diagnosis. The summary is O(symbols), not O(symbols x bars) — ~2 KB at 5 symbols, ~19 KB at 50,
   > against a payload that today grows without bound in *both* dimensions. Tests must assert
   > boundedness across **two** symbol counts, not one.
2. The same call returns an attachment whose content round-trips to the **complete** `BacktestResult`,
   byte-for-byte equivalent in information to today's inline payload (FR-3).
3. *(Regression guard — passes today.)* A 0-trade run can still be diagnosed from the inline summary
   alone: `no_trade_reason`, `bars_total` and `warmup_bars` are present per symbol (FR-2 /
   feature-064 guard).
4. *(Regression guard — passes today.)* An `INSUFFICIENT_DATA` run still surfaces its
   `coverage_gaps` inline. Note this is exactly the case with **no** attachment available (see
   OQ-1) — so the inline path is the only path, and must not regress.
5. The `run_backtest` docstring and the `docs/runbooks/mcp-tools.md` **Return** block describe the
   split return shape.
6. *(Regression guard — passes today.)* This feature **adds no tool**, so it must not alter any
   tool-inventory **count statement** — `docs/runbooks/mcp-tools.md:3` and `:29`,
   `app/tools.py:4`, `services/xstockstrat-agent/CLAUDE.md:26`, `docs/runbooks/CLAUDE.md:17` — nor
   the name-set assertion at `services/xstockstrat-agent/tests/test_tools_endpoint.py:23-37` (a
   **sixth** count-bearing surface). Stated **count-agnostically on purpose**: feature 070 adds a
   14th tool and renumbers those statements from "thirteen" to "fourteen", so this criterion is
   "072 leaves the count statements at whatever value 070 left them", not "they still say
   thirteen". Two of those files *are* edited by FR-6 — the criterion binds the count *statements*,
   not the files.

## Open Questions

- [ ] **OQ-1 — `EmbeddedResource` vs `ResourceLink` (design phase).** The load-bearing decision: it
  determines whether the feature actually solves the problem. An `EmbeddedResource` still ships the
  full bytes in the tool result; if the client inlines that into the model's context, the payload is
  *relabelled but not reduced* and FR-1's intent is defeated. A `ResourceLink` genuinely defers the
  bytes until read.

  **The feature-068 reuse is real but NOT free.** `GetBacktest` (`analysis.proto:21`) serves the exact
  bytes the agent already received (`servicer.py:1275-1292`, `SerializeToString()`), so FR-3 fidelity
  is exact with zero new storage. But four gaps, all verified against trunk:
  1. **`INSUFFICIENT_DATA` runs are never persisted** — not "may not". The detail insert is gated on
     OK (`servicer.py:507-511`), and the contract says so outright: `GetBacktest` returns NOT_FOUND
     for "legacy/evicted/**INSUFFICIENT_DATA** runs" (`analysis.proto:18-20`). A `ResourceLink` on
     such a run **dangles** — and AC-4 is exactly that case. Likely resolution: `INSUFFICIENT_DATA`
     is summary-only with no attachment (there are no diagnostics worth attaching).
  2. **Persistence is best-effort**, so even an OK run can have no detail row
     (`servicer.py:1295-1296` swallows all exceptions; `:1281-1282` no-ops without a DB pool) — and
     nothing in `BacktestResult` tells the agent whether it landed, so a link can 404 on a perfectly
     successful run with no signal to fall back.
  3. **Eviction is count-based, not TTL** — `analysis.backtest.detail_retention_per_strategy`
     (default 20, `servicer.py:1286`). 20 further runs of the same strategy silently invalidate an
     outstanding link. The lifetime is owned by another feature's config key.
  4. **No agent-side plumbing exists** — zero `GetBacktest`/`get_backtest` hits anywhere under
     `services/xstockstrat-agent/`. A `client.get_backtest` wrapper plus an MCP resource handler
     would both be new.

  **`EmbeddedResource` avoids gaps 1–3 entirely.** That is the real tradeoff to weigh, not a
  foregone conclusion in favour of the link.

  **Escalation to watch:** if the design closes gap 1 by persisting `INSUFFICIENT_DATA` runs, it must
  edit `servicer.py:507-511` — contradicting this spec's own "no `xstockstrat-analysis` change" and
  landing **inside the `RunBacktest` region feature 071 restructures**. That would upgrade the 071
  overlap from rebase-only to a genuine same-function conflict and require a hard merge-order row.
- [ ] **OQ-2 — attachment format (design phase).** `diagnostics` is strongly tabular (one row per
  bar), so CSV is dramatically more compact than nested JSON; but `BacktestResult` as a whole is
  nested. Options include JSON for the envelope, CSV for the per-bar table, or both. Fidelity
  (FR-3) is the constraint, compactness the goal.
- [ ] **OQ-3 — does the attachment need auth?** If OQ-1 lands on `ResourceLink`, the resource read
  path must carry the same OAuth 2.1 / scope treatment as the tool call itself
  (`app/main.py:8`), not become an unauthenticated side channel.
- [ ] **OQ-4 — MCP SDK floor.** If OQ-1 picks `ResourceLink`, raise the `mcp` pin in
  `services/xstockstrat-agent/pyproject.toml:6` from the unbounded `>=1.0.0` to a floor that
  guarantees `ResourceLink` (resolved today is `1.27.1`). Otherwise a clean resolve can produce a
  build without the type.

---

## Design Constraints & Recorded Notes

_Not open questions — resolved facts the design must respect._

- **C-10 shared-consumer trap (ledger fails 056/060/067).** This changes a shared consumer surface:
  the tool docstring and `docs/runbooks/mcp-tools.md` must move in the same PR with a test (FR-6,
  AC-5). The tool *count* does not change, so feature 066's five-surface inventory rule does **not**
  apply here — AC-6 pins that explicitly, count-agnostically.
- **Merge overlap with features 070 + 071 — rebase-only, recorded in `merge-order.md`.** 070 and 071
  share one branch and one PR (`claude/features-070-071-rnbkqo`), so the real ordering is two-way:
  `{070+071}` as one unit vs `072`. 071 changes `run_backtest`'s **inputs**, 072 its **output**; 070
  adds a 14th tool in a different block of the same file. No field, key, or migration collision.
  **Sharpest point:** `services/xstockstrat-agent/tests/test_tools.py:485-527`
  (`test_run_backtest_projects_full_result_with_diagnostics`) asserts the full result *is* projected
  inline — 072 must invert that exact assertion while 071 extends the same file. That is a
  contradictory test, not an adjacent edit.
- **Reviewer-registry gap (docs follow-up, not blocking).**
  `docs/runbooks/reviewer-registry.md` has **no `xstockstrat-agent` row** in its Service Owners table
  (it covers eleven services), so this feature's reviewer focus is inferred rather than
  registry-sourced. Features 070 and 071 share the gap. Worth a one-line registry addition in a
  separate change.
