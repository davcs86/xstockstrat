# Context: mcp-get-positions-tools

**Feature**: `docs/roadmap/features/169-mcp-get-positions-tools/feature.md`
**Product Spec**: `docs/roadmap/features/169-mcp-get-positions-tools/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/169-mcp-get-positions-tools/implementation-spec.md`

---

## Session 2026-09-02T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Story: "Add Get_positions and Get_positions_by_account_id tools to the MCP. User-bound for everyone, even admins."
- Key design decisions deferred to /sdd-design:
  - Whether to reuse existing `client.list_account_positions` or add a new cross-account client method.
  - Confirm `ListPositions` returns broker-authoritative valuation (post-056 fix, per fails ledger).
  - Pagination token passthrough shape.
- Known trap surfaced from ledger: fails 2026-07-01 (056-open-positions-ui) — two position read paths historically disagreed on mark-to-market. Must confirm the path used here includes the broker-authoritative columns.
- Known trap surfaced from ledger: fails 2026-08-02 (mcp-tools-alignment-triage) — all MCP tool inventory surfaces must be updated and parity-tested.
- Insight surfaced: insights (screener-agent-tool) — tool count is asserted in 4+ separate docs; all must be grepped when adding a tool.

## Session 2026-09-02T00:00:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Open questions resolved during review:
  - Mark-to-market: `ListPositions` returns broker-authoritative `current_price`, `market_value`, `unrealized_pnl`. `enrichPositions` only fills unvalued positions (`CurrentPrice <= 0`) from marketdata mid-quotes. `MessageToDict` omits zero-value fields.
  - Pagination: Uses nested `PageRequest`/`PageResponse` submessages (not top-level). Existing `list_account_positions` does NOT support pagination — new tools must add `page_size`/`page_token` params and return `next_page_token`.
- Warnings:
  - FR-4 field path corrected: `page_token`/`page_size` are inside `ListPositionsRequest.page` (a `PageRequest` submessage), not top-level.
  - FR-6 "six surfaces" count noted as potentially imprecise — reconcile during design.
- Overlap findings: CLEAN — no collisions. Feature 010 (`agent-scheduler`, draft) shares `xstockstrat-agent` but targets different modules (`app/scheduler.py` vs `app/tools.py`).

## Session 2026-09-02T00:00:00Z — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-agent, xstockstrat-portfolio; key reuse patterns: list_watchlists user-bound+pagination, descriptor-parity test).
- Phase 1 Grilling: 2 rounds (quick). Chosen approach: single consolidated `list_positions` client method + two user-bound tool wrappers + frozen-set parity test. Rejected: single tool with optional account_id, client-side ownership guard, backward-compat wrapper (056 dual-path trap).
- Key decisions:
  - Consolidate `list_account_positions` into new paginated `list_positions` (eliminates 056 dual-path trap, C-10(b)).
  - AC-4 amended: backend returns empty list for non-owned accounts (not PERMISSION_DENIED); FR-3 wording corrected.
  - `manage_offline_account` sub-op strips `next_page_token` to preserve backward compatibility.
  - `tests/test_offline_client.py` must be updated (two tests reference old method name and shape).
- Constitution rules touched: C-08, C-10(b), C-14, C-15, C-16, F-04, P-03. Floor breaches: none.
- Status: spec-ready → design-approved.

## Session 2026-09-02T00:00:00Z — sdd-spec

- Implementation spec generated: 8 steps, all `pending`.
- Step order: client consolidation (Steps 1-2) → tool registration (Steps 3-4) → manage_offline_account backward-compat update (Steps 5-6) → parity test (Step 7) → doc updates + name-set test (Step 8).
- All 10 AC scenarios mapped: AC-1 through AC-6 and AC-9/AC-10 → Step 4 (tool unit tests), AC-7 → Step 8 (inventory surfaces), AC-8 → Step 7 (parity test).
- Key codebase findings confirmed during spec:
  - Insertion point in tools.py: after `list_accounts` at line 1694, before `_get_source` at line 1697.
  - Client consolidation replaces `list_account_positions` (client.py:1880-1892) with `list_positions` following `list_watchlists` pagination pattern (client.py:357-371).
  - manage_offline_account sub-op (tools.py:1600-1603) switches to consolidated method, strips `next_page_token`.
  - Two existing tests in test_offline_client.py (lines 136 and 281) must rename call target.
  - Parity test mirrors test_backtest_view.py:189-212 pattern with 23 Position proto fields.
  - Four inventory surfaces to update: tools.py docstring, CLAUDE.md, mcp-tools.md, test_tools_endpoint.py (33 → 35).
- Reviewer roles: Service owner: xstockstrat-agent (Steps 1-8), Service owner: xstockstrat-portfolio (read-only, no steps assigned).
- Status: design-approved → implementation-ready.

## Session 2026-09-02T00:00:00Z — sdd-review impl-spec (advisory)

- Result: 0 failures, 7 warnings (advisory — did not block).
- Unresolved ⚠ carried into execution:
  - Steps 2, 4, 6, 7, 8: test Verification blocks missing `--cov-fail-under=40` (C-08) — [x] will be addressed during execution: each test step runs with `--cov-fail-under=40` appended to the verification command (F-09 prevents editing immutable step bodies; deviation logged per step)
  - Step 4: AC-4 `acceptance.feature:31` still says "PERMISSION_DENIED" but design amended to "empty list" (C-15) — [x] fixed: acceptance.feature + product-spec.md FR-3 amended pre-execution
- Overlap findings: CLEAN — no collisions.
