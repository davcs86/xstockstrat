# Context: watchlist-bulk-default-strategy

**Feature**: `docs/roadmap/features/170-watchlist-bulk-default-strategy/feature.md`
**Product Spec**: `docs/roadmap/features/170-watchlist-bulk-default-strategy/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/170-watchlist-bulk-default-strategy/implementation-spec.md`

---

## Session 2026-09-03T18:14Z — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the user story.
- **Grounding (pre-story codebase-discovery):** Watchlists are owned by `xstockstrat-portfolio` (Go,
  feature 058) — NOT analysis. All watchlist protos live in `packages/proto/portfolio/v1/portfolio.proto`.
  A per-**symbol** `strategy_id` binding already exists (`WatchlistBinding.strategy_id`,
  `watchlist_symbols.strategy_id` col from migration 008). `RemoveWatchlistSymbols` /
  `AddWatchlistSymbols` already accept `repeated` symbols, so bulk add/remove exists at the wire level;
  only a bulk **strategy-assignment** RPC and a watchlist-**level** default strategy are genuinely new.
  Highest portfolio migration = `014` → next is `015`. Strategy is a bare string (owned by
  `xstockstrat-analysis`) with no cross-service FK.
- **Requester decisions locked (via up-front questions before story):**
  1. Default strategy = **add-time only** (binds new bare symbols; no retroactive rebind; no read-time fallback).
  2. Bulk strategy assignment = **new atomic `UpdateWatchlistBindings` (plural) RPC** (transactional, single `updated_at`).
  3. Bulk delete = **symbols within a watchlist only** (reuses `RemoveWatchlistSymbols`); whole-watchlist bulk delete out of scope.
  4. Surfaces = **Insights UI + agent MCP tools** (`manage_watchlist`, `manage_watchlist_symbols`).
- **Ledger traps folded into product-spec Open Questions:** fails.md:1147 (ownership scoping on the
  bulk write), fails.md:37/056 (add-time default applied in *every* insert path, not one), fails.md:1372/112
  (bulk-selection state must reset on watchlist switch). Nav-reachability trap (058/060) is satisfied —
  this extends the already-registered `/insights/watchlists` page.

## Session 2026-09-03T18:20Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Criteria verdict: PASS WITH WARNINGS (spec-reviewer). Warning: criterion 9 — three resolved Ledger
  traps were mis-formatted as unchecked Open-Questions boxes. Reclassified them into a
  "## Design Must Address" block (each already covered by an @AC scenario), leaving one genuine open
  fork (agent bulk-assign: new operation vs dedicated tool) deferred to /sdd-design.
- Verified against code: proto next-free field numbers (Watchlist=10, CreateWatchlistRequest=5,
  UpdateWatchlistRequest=6), migration 015 free, plural `UpdateWatchlistBindings` ≠ singular
  `UpdateWatchlistBinding` (portfolio.proto:39, launched feature 167).
- Overlap findings: CLEAN (feature-overlap). Only in-flight peer is 084-droplet-compose-deploy
  (infra-only, no resource overlap). No merge-order row required.

## Session 2026-09-03T18:55Z — sdd-design (quick, extended to 4 rounds by operator)

- Phase 0 Recon: wrote recon.md (services: portfolio/proto/ui/agent). Key reuse patterns: the single
  `requestBindings`/`normalizeBindings` add-time chokepoint; `loadOwned` service-layer ownership gate;
  `touchWatchlistTx` single updated_at bump; FieldMask precedent in analysis/ingest/indicators.
- Phase 1 Grilling: 4 rounds. Chosen approach: additive proto (`default_strategy_id` + set-based
  atomic `UpdateWatchlistBindings` RPC + `google.protobuf.FieldMask update_mask` on UpdateWatchlist),
  migration 015, add-time default at the chokepoint (Option B), scalar field-mask partial update.
  Rejected: SIGNAL-inclusive default (Option A), single-row loop bulk, fold-default-into-replace-all,
  dedicated SetDefaultStrategy RPC, mask-scope narrow/binding-inclusive, dedicated agent bulk tool.
- **Operator decisions recorded (P-04/P-05):**
  1. Fork 1 (default scope) → **Option B, MANUAL-only** (source==SIGNAL skipped). Removes the C-16
     CHANGE; no sign-off needed.
  2. Bulk strategy assignment → **new atomic `UpdateWatchlistBindings` RPC** (set-based UPDATE ... ANY).
  3. Bulk delete → symbols within a watchlist only (reuse `RemoveWatchlistSymbols`).
  4. Write path for `default_strategy_id` → **introduce `google.protobuf.FieldMask` in UpdateWatchlist**
     (operator steer over both fold-in and dedicated-RPC options). Design B (presence-gated, no-mask =
     legacy replace-all verbatim; default excluded from legacy SET so preserved-for-free).
  5. Mask scope → **scalar set {name, description, default_strategy_id}** (bindings/symbols NOT maskable).
  6. Fork 2 (agent bulk surface) → **new `"assign"` verb** on `manage_watchlist_symbols` (not a new tool).
- Constitution rules touched: C-01/07/08/09/10/14/16/17, P-01/02/03/06, F-01/04 — all honored.
  Floor breaches: none across all 4 rounds. Business rules: all PRESERVE/EXTEND, no CHANGE.
- Status: spec-ready → design-approved.

## Session 2026-09-03T19:30Z — sdd-spec

- Generated implementation-spec.md with **14 steps**. Status → implementation-ready.
- Consumed recon.md + design.md; verified every cited `path:line` against the current tree (proto
  next-free numbers, portfolio service/repo/handler anchors, UI hooks/components/mock, agent
  tools/client). No design deviations — the five design slices map to Steps 1/2, 3, 4–5, 6–7, 8–9
  (portfolio), 10–11 (UI), 12–13 (agent), 14 (docs).
- Key codebase findings (grounding for /sdd-execute):
  - Proto: `Watchlist` next-free field = **10**, `CreateWatchlistRequest` = **5**, `UpdateWatchlistRequest`
    = **6** (`portfolio.proto:224/242/269`). FieldMask precedent to import: `analysis.proto:9` /
    `ingest.proto:10` / `indicators.proto:9`. Mirror RPC `UpdateWatchlistBinding` at `:39`, req/resp `:318-326`.
  - `scanWatchlist` (`watchlist_repo.go:380`) has **exactly two** SELECT consumers — `GetByID:92`,
    `ListByUser:115` — both must gain `default_strategy_id` (F-04). Legacy `Update` SET (`:164-166`)
    deliberately omits the column so it is preserved-for-free on the no-mask path.
  - Add-time default chokepoint = `requestBindings` two branches (`portfolio_service.go:1313-1322`),
    `normalizeBindings` preserves `Source` (`:1300-1304`) → Option B (MANUAL-only) skips `source==SIGNAL`.
  - Bulk RPC mirrors single-row servicer (`:1496`) + repo (`:247`, set-based via `symbol = ANY($2)`
    precedent at `RemoveSymbols:230-235`); two-layer handler (`portfolio_handler.go:230`/`:391`);
    `loadOwned` (`:1352`) is the ownership gate (repo stays ownership-agnostic — closes fails.md:1147).
  - Last portfolio migration = `014` → **015** free. ADD COLUMN precedent = `008` (`TEXT NOT NULL DEFAULT ''`).
  - UI: `ui/checkbox.tsx` primitive **exists**; selection reset is **free** via `key={watchlistId}`
    remount (`page.tsx:198`, closes fails.md:1372); no-invalidate cache-patch model = `useUpdateWatchlistBinding`
    (`useWatchlists.ts:116-150`); one `forward()` BFF line (`insightsBff.ts:109`); mock handlers in `watchlistMock.ts`.
  - Agent: `_watchlist_to_dict = MessageToDict(..., preserving_proto_field_name=True)` (`client.py:328`)
    **auto-echoes** `default_strategy_id` (closes the C-14 read-surface open risk); new `"assign"` verb on
    `manage_watchlist_symbols` dispatch (`tools.py:1512`) + new `client.update_watchlist_bindings` wrapper.
    Tool count stays **35** (verb, not a new tool). `mcp-tools.md:1065/1103` doc parity in the same PR (C-10).
- No new env vars/ports → **no** docker-compose / `.do/app*.yaml` changes (recon Dependencies).

## Open Threads

- [ ] Bulk NOT_FOUND count check compares the **deduped** (post-normalizeSymbols) count — assert in bulk RED tests. Target: portfolio bulk-RPC step.
- [ ] Existing UpdateWatchlist callers (UI/agent name/desc/binding edits) must keep `update_mask` unset — assert at UI/agent steps. Target: UI + agent steps.
- [ ] Agent `get_watchlist` must echo `default_strategy_id` (C-14 read-surface) — assert in agent client test. Target: agent step.
- [ ] Anti-rebind guarantee is SQL-level (`insertBindingsTx` ON CONFLICT DO NOTHING), modeled in `fakeWatchlistStore`, not DB-tested — record caveat on the scenario. Target: portfolio test step.
