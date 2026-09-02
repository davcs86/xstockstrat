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
