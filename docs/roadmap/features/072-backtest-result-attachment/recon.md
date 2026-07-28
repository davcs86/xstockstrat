# Recon: backtest-result-attachment

**Created**: 2026-07-27
**From**: product-spec.md
**Affected services**: `xstockstrat-agent` (the only service the product spec allows changing);
`xstockstrat-analysis` surveyed **read-only** because OQ-1's `ResourceLink` branch would depend on it

---

## Objective

`run_backtest` returns the entire `BacktestResult` inline, including feature-064 per-bar
`diagnostics` — one row per symbol per bar, bounded only by `analysis.backtest.max_range_days`
(default 730) plus feature-071's warm-up prefix. Split it: a compact inline summary that still
diagnoses the 0-trade case, plus an MCP-native attachment carrying the full detail. The load-bearing
decision is OQ-1 — `EmbeddedResource` (bytes travel in the tool result) vs `ResourceLink` (bytes
deferred until read), which determines whether the feature reduces context or merely relabels it.

## Codebase Map

- **`xstockstrat-agent`** (Python 3.12, FastMCP)
  - Entry point: `app/main.py:36` (`FastMCP("xstockstrat-agent")`), tools registered `app/main.py:37`
  - Transport dispatcher: `app/main.py:130-159` (`handle_mcp`), mounted `app/main.py:182`
    (`Mount("/", app=handle_mcp)`)
  - Streamable HTTP: `app/main.py:103` (`StreamableHTTPSessionManager`), dispatched `app/main.py:159`
  - Legacy SSE: `app/main.py:75` (`SseServerTransport("/messages")`), stream `app/main.py:152-157`,
    POST channel `app/main.py:144-146`
  - Auth gate: `app/main.py:105-114` (`_authorized`), applied `app/main.py:148-150`;
    `aud` binding `app/auth.py:28,43`; 401 + discovery pointer `app/main.py:116-128`
  - Tool under change: `app/tools.py:240-275` (decorator `:240`, signature `:241-247`,
    docstring `:248-268`, return `:269-275`)
  - Client wrapper: `app/client.py:143-204`; the projection is `app/client.py:200-204`
    (`MessageToDict(resp, preserving_proto_field_name=True, always_print_fields_with_no_presence=True)`)
  - Tool catalog route: `app/main.py:77-96`, registered `app/main.py:180` (`GET /api/tools`)
  - Last migration: **none** — the agent owns no schema
  - Config-read pattern: `client.get_config_value("<bare-key>")` one-shot `GetConfig`
    (agent `CLAUDE.md` § Config Keys Consumed) — **this feature adds no config key**

- **`xstockstrat-analysis`** (read-only survey — the OQ-1 link target)
  - `GetBacktest` RPC: `packages/proto/analysis/v1/analysis.proto:19-22`
  - `GetBacktest` handler: `app/handlers/servicer.py:1498-1523`
  - Detail read: `app/repositories/backtest_details.py:63-67`; verbatim
    `result.ParseFromString(...)` at `servicer.py:1521-1522`
  - Detail write: `servicer.py:527-528` (call site), `servicer.py:1389-1413` (`_persist_backtest_detail`)
  - Schema: `migrations/008_backtest_details.up.sql:7-12`
  - `RunBacktest` current span (post-071): `servicer.py:199-561`

## Patterns to REUSE

- **Compact-summary construction** → **no existing helper.** Discovery grepped
  `summar|compact|truncat|_condense|digest` across the service: only
  `app/prompts/signal_extraction.md:55` and HMAC `hexdigest` in `app/oauth_server.py:41,51,52`.
  This is new code — but it should live in **one** place, not be inlined in the tool body, since the
  same projection is needed by the attachment path's fallback.
- **Proto → dict projection** → reuse `MessageToDict(..., preserving_proto_field_name=True,
  always_print_fields_with_no_presence=True)` exactly as `app/client.py:200-204` does. Feature 064
  chose those two flags deliberately (snake_case keys existing consumers expect; zero-valued metrics
  preserved so the "0 trades / 0% return" case is present rather than omitted). The summary must keep
  both flags or a `total_return: 0.0` silently disappears from the inline payload — which is exactly
  the case FR-2 exists to protect.
- **Base64 encoding** → `base64` is already imported at `app/tools.py:21` (used at `:119`). No new
  dependency needed if the attachment is a `BlobResourceContents`.
- **Auth for a resource read** → **already covered, no new code.** `_authorized` (`app/main.py:105-114`)
  runs at the raw-ASGI layer in `handle_mcp` **before** the Streamable-HTTP and `/sse` branches
  (`app/main.py:148-150`), so a JSON-RPC `resources/read` traverses the identical `aud`-bound JWT
  check as a `tools/call`. **This answers OQ-3: no new auth surface is introduced by the link
  branch.** (Only `/messages` at `:144` bypasses the gate — that is the pre-existing SSE POST
  channel, unchanged by this feature.)
- **Tool-name-set assertion** → `tests/test_tools_endpoint.py:17-38` asserts exact set equality over
  14 names. This feature adds no tool, so that set must not move (AC-6).

## Dependencies

- Proto/RPC: **none changed.** `BacktestResult` (`analysis.proto:65-84`, fields 1–15) already
  arrives complete. Its persistence warning (`analysis.proto:61-64`) — wire bytes persisted verbatim,
  additive changes only — is a reason **not** to reshape it for presentation.
- The `ResourceLink` branch would add a new inter-service edge: **agent → analysis `GetBacktest`**
  (currently zero occurrences of `GetBacktest|get_backtest` anywhere under
  `services/xstockstrat-agent/`).
- Migration: none.
- Config keys: none new. The link branch would however make the agent's link lifetime governed by
  **another feature's** key — `analysis.backtest.detail_retention_per_strategy` (default 20,
  `servicer.py:1403`).
- New env vars / ports: none.
- Dependency pin: `pyproject.toml:6` is `mcp>=1.0.0` (unbounded); resolved is `mcp == 1.27.1`
  (`uv.lock:439-440`). **OQ-4** applies only if the design uses a type newer than the floor.

## Risks / Not-found

**The feature-068 reuse has four gaps, all now verified against trunk (not "may" — "does"):**

1. **`INSUFFICIENT_DATA` runs are never persisted.** The insert is gated
   `if result.status == analysis_pb2.BACKTEST_STATUS_OK:` (`servicer.py:527-528`), and the proto
   contract says so outright (`analysis.proto:19-22`: NOT_FOUND for "legacy/evicted/INSUFFICIENT_DATA
   runs"). AC-4 is exactly this case.
2. **The write is best-effort and swallowed** — `except Exception as e: log.warning(...)`
   (`servicer.py:1412-1413`) — and **no-ops entirely without a DB pool** (`servicer.py:1398-1399`).
3. **Eviction is count-based, not TTL** — `max(1, get_int("analysis.backtest.detail_retention_per_strategy", 20))`
   (`servicer.py:1403`); 20 further runs of the same strategy silently invalidate an outstanding link.
   Insert and eviction are **not transactional together** (`backtest_details.py:11-14`).
4. **Nothing in `BacktestResult` reports whether the detail row landed.** Verified field-by-field
   (`analysis.proto:65-84`); `_persist_backtest_detail` returns `None` and never mutates `result`
   (`servicer.py:1389,1412-1413`). So a caller holding an OK result **cannot know** whether
   `GetBacktest` will later succeed — a link can 404 on a perfectly successful run with no signal.

**Additional findings not in the product spec:**

5. **`GetBacktest` performs no authorization at all** — no `_has_admin_scope`, no
   `backtest_id`↔caller ownership check (`servicer.py:1498-1523`; docstring `:1506-1507` states "no
   admin gate (read parity with `ListBacktests`)"). Any caller reaching the RPC can fetch any run's
   full detail. Acceptable for a platform-internal gRPC edge, but it means a link's security rests
   entirely on the agent's own gate, not on a second check downstream.
6. **`GetBacktest` collapses DB errors into NOT_FOUND** (`servicer.py:1513-1515`), so "evicted",
   "never persisted", and "database down" are indistinguishable to the agent.
7. **The agent is deliberately stateless** — agent `CLAUDE.md` § OAuth (FR-B13): "there is **no
   in-memory store** and `instance_count > 1` is safe". So serving a resource from an agent-side
   cache of bytes it already holds is **not** available without breaking that invariant. This is the
   fact that makes OQ-1 a real dilemma rather than a third obvious option.
8. **No precedent to copy.** All 14 tools return plain `dict` (`app/tools.py` — 14 registrations, all
   `-> dict:`); zero matches for
   `EmbeddedResource|ResourceLink|BlobResourceContents|TextResourceContents|ImageContent|Annotations`
   and zero `@server.resource` registrations anywhere in the service. This is the agent's first
   non-text tool result.
9. **The contradictory test.** `tests/test_tools.py:534-577`
   (`test_run_backtest_projects_full_result_with_diagnostics`) asserts at `:573-577` that
   `out["diagnostics"][0]["bars"][0]["action"]` is present inline. 072 must invert this. Note it
   tests **`client.run_backtest`**, not the tool — so keeping the client intact and splitting in
   `tools.py` preserves it rather than inverting it.
10. **Feature-071 overlap is live, not hypothetical.** `run_backtest` in both `tools.py` and
    `client.py` was edited this week for `start`/`end`; `tests/test_tools.py` gained
    `TestRunBacktestWindow` (`:283-323`) and `TestRunBacktestRangeOnTheWire` (`:614-702`). Any 072
    work rebases onto that. If the design were to close gap 1 by persisting INSUFFICIENT runs it
    would edit `servicer.py:527-528`, inside the `RunBacktest` span (`:199-561`) 071 restructured —
    upgrading the overlap from rebase-only to a hard conflict.

**Applicable ledger traps:**

- **fails 056 / 060 / 067 (C-10 "shipped the producer, forgot the shared consumer")** — the tool
  docstring and `docs/runbooks/mcp-tools.md` are shared consumer surfaces and must move in the same
  PR (FR-6). If the design registers an MCP resource, that is a **new** documented surface
  (`mcp-tools.md` documents tools only; agent `CLAUDE.md` has no resources section) — FR-6a.
- **fails 2026-07-21 (`MessageToDict` contract)** — verify the serializer's behavior before designing
  on top of it. Relevant here: `always_print_fields_with_no_presence=True` is what keeps zero-valued
  metrics present; dropping it while "compacting" would silently delete the very fields FR-2 requires.
- **insights 2026-07-27 (echoing mock)** — a test whose fixture makes the summary and the attachment
  indistinguishable proves nothing about which one a consumer read.

## Recommended Scope

Advisory only — input to the grilling, not binding.

1. **Decide OQ-1** against gaps 1–4 + risk 7 (statelessness rules out an agent-side cache).
2. **Summary projection helper** — one function, `BacktestResult` → compact dict, reusing the
   feature-064 `MessageToDict` flag pair. Pure, unit-testable, no I/O.
3. **Attachment construction** in `tools.py` only, leaving `client.run_backtest` returning the full
   result — which preserves `test_run_backtest_projects_full_result_with_diagnostics` instead of
   inverting it, and keeps the split at the presentation boundary where it belongs.
4. **Format (OQ-2)** — measured, not asserted: state the compression ratio for a realistic
   multi-symbol run rather than claiming CSV is smaller.
5. **Degradation path (FR-5)** — what the tool returns when the attachment cannot be produced.
6. **Docs** — `mcp-tools.md` §`run_backtest` **Return** block (`:253-257`, already stale on trunk,
   superseded by feature 064) + the tool docstring; plus a resources section if OQ-1 adds one (FR-6a).
7. **Tests** — inline payload bounded regardless of window/symbol count; attachment round-trips to
   the complete result; the three regression guards (AC-3/4/6).
