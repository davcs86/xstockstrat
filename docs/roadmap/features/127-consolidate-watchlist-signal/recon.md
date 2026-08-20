# Recon: consolidate-watchlist-signal

**Created**: 2026-08-19
**From**: product-spec.md
**Affected services**: xstockstrat-agent, xstockstrat-portfolio

---

## Objective

When `ingest_signal` is called with `direction="watchlist"` and the ingest is not deduplicated,
auto-add the symbol to a **special, system-managed, per-user watchlist** (owned by the calling user
via the propagated `x-user-id`, auto-created under a well-known reserved name) — best-effort and
non-blocking, mirroring the existing post-commit auto-alert side effect. Resolves the two same-named
"watchlist" concepts (the inert ingest label vs the real portfolio watchlist) into one.

## Codebase Map

- **`xstockstrat-agent`** (Python MCP server)
  - `ingest_signal` tool — decl/docstring `app/tools.py:257-284` (**no `ctx: Context` param today**);
    ingest call `:285-295`; the **existing best-effort auto-alert side effect to mirror** `:296-333`
    (gate `if not result.get("deduplicated") and conviction >= alert_threshold:` at `:312`;
    post-commit `try/except → log.warning` at `:316-332`).
  - Caller identity: `_caller_user_id(ctx, tool)` derives the caller's own id from verified claims,
    raises if empty — `app/tools.py:109-124`. Used by `emit_alert` (`:363`), `manage_formula` author
    (`:707→712`), `manage_strategy`, etc. `ingest_signal` **passes no identity** (no `ctx`, never calls
    `_caller_user_id`) — the `ctx`-plumbing precedent to copy is `emit_alert`/`manage_formula`.
  - gRPC client (`app/client.py`): ephemeral per-call channel + lazy stub pattern (ingest `:182-188`,
    notify `:223-226`); endpoint constants `:20-26` (**no `PORTFOLIO_ENDPOINT` / portfolio stub**);
    `_metadata()` returns `[]` (`:29-30`), callers append `("x-user-id", user_id)` explicitly
    (`:281`, `:460`, `:485`, `:868`). `client.ingest_signal` returns `{"signal_id", "deduplicated"}` (`:188`).
  - Doc parity (FR-5): `docs/runbooks/mcp-tools.md:195-227` (`ingest_signal` entry; auto-alert prose
    `:197`, dedup-suppression row `:227`) + the in-code `SIDE EFFECT:` docstring block `app/tools.py:278-284`.
  - Env: `PORTFOLIO_ENDPOINT` absent from the agent block in `docker-compose.yml:518-533`,
    `.do/app.yaml:265-301`, `.do/app.dev.yaml:@269`, and `services/xstockstrat-agent/CLAUDE.md:139-146`.
- **`xstockstrat-portfolio`** (Go, gRPC 50052) — watchlist mechanism (features 058/097)
  - RPCs `CreateWatchlist`/`AddWatchlistSymbols`/`GetWatchlist`/`ListWatchlists` — `portfolio.proto:20-26`;
    handlers `portfolio_handler.go:133,173,270,310` → service `portfolio_service.go:1217` (Create),
    `:1329` (Add).
  - **Ownership is header-derived, never from the request body**: `requireUserID(ctx)`
    (`portfolio_service.go:1188-1195`) reads `middleware.FromContext(ctx).UserID` (`:1190`), extracted
    from `x-user-id` gRPC metadata (`internal/middleware/propagation.go:29-33`). `user_id` intentionally
    absent from all watchlist request messages (`portfolio.proto:193-194`).
  - **Empty/absent `x-user-id` → hard reject** `CodeInvalidArgument "missing user identity"`
    (`portfolio_service.go:1188-1195`) — no default, no empty-owner row. Cross-owner access →
    `CodePermissionDenied` (`:1210-1211`).
  - `AddWatchlistSymbols` idempotency: repo `insertBindingsTx` `INSERT ... ON CONFLICT (watchlist_id,
    symbol) DO NOTHING` (`watchlist_repo.go:266-275`) — re-add is a silent no-op, existing binding's
    `strategy_id` preserved; only over-cap (`> portfolio.watchlist.max_symbols_per_list`, default 500)
    fails `CodeInvalidArgument` (`portfolio_service.go:1341-1344`).
  - `AddWatchlistSymbols` requires an existing owned watchlist id (`loadOwned` → `CodeNotFound`/
    `CodeInvalidArgument`, `:1200-1206`) → **127 must `CreateWatchlist` first if none exists.**
    `WatchlistBinding{symbol, strategy_id}` — `""` strategy_id = unbound (`portfolio.proto:174-177`).
  - **No system/service-owned/broadcast watchlist exists** — schema is single-user (`UNIQUE (user_id,
    name)`, `migrations/007_watchlists.up.sql:8,13`). Last watchlist migration `008`. **No schema change
    needed** (127 consumes existing RPCs).

## Patterns to REUSE

- Best-effort post-commit side effect → mirror the existing `ingest_signal` auto-alert `try/except →
  log.warning` gated on `not deduplicated` (`app/tools.py:296-333`).
- Caller identity → add `ctx: Context` to `ingest_signal` and call `_caller_user_id(ctx,
  "ingest_signal")` exactly like `emit_alert`/`manage_formula` (`app/tools.py:109-124,363,707`).
- New portfolio client method → mirror the ephemeral-channel + lazy-stub pattern in `app/client.py`,
  appending `[*_metadata(), ("x-user-id", user_id)]` (header-derived ownership).
- Reserved-name per-user watchlist → CreateWatchlist-if-absent then AddWatchlistSymbols (idempotent);
  name config-driven (`agent.signal.watchlist_name`, default e.g. "Signals").
- Idempotency of AddWatchlistSymbols is native (`ON CONFLICT DO NOTHING`) — no extra guard needed.

## Dependencies

- Proto/RPC: **no change** — reuses `CreateWatchlist`/`AddWatchlistSymbols` (feature 058).
- Migration: none (portfolio watchlist tables exist; agent has none).
- Config keys: possibly `agent.signal.watchlist_name` (string, default "Signals") for the reserved
  watchlist name — additive, `agent.signal.*` category already exists (`agent.signal.alert_threshold`).
- Inter-service edges: **new agent→portfolio gRPC edge** (`AddWatchlistSymbols`/`CreateWatchlist`).
  No cycle (portfolio doesn't dial the agent).
- New env var: `PORTFOLIO_ENDPOINT=xstockstrat-portfolio:50052` on the agent — absent from
  docker-compose + both .do specs + agent CLAUDE.md (must be added to all).

## Risks / Not-found

- **Identity fork — RESOLVED by product intent (per-user special watchlist).** `ingest_signal` has no
  `ctx` and derives no user id today; the fix is to plumb `_caller_user_id` (the OAuth caller identity
  IS on the request). A **fully-automated caller with no verified user claims** (`_caller_user_id`
  raises) must be handled: the watchlist add is skipped best-effort (log), consistent with FR-3 —
  portfolio would hard-reject an empty `x-user-id` anyway. Design must state this fallback explicitly (P-03).
- **C-10(c) governance**: the reserved "Signals" watchlist is a per-user, agent-managed named resource.
  It is NOT owner-less, so it doesn't need a new ownership sentinel — but the reserved-name convention
  should be recorded, and whether the UI distinguishes agent-added entries (product-spec OQ#3, a C-14
  override) is a deferral needing sign-off.
- **`PORTFOLIO_ENDPOINT` deploy parity** across docker-compose + 2 DO specs (C-1 style).
- **MCP tool-doc parity** (FR-5): docstring + `mcp-tools.md` must gain the side-effect note (ledger
  `mcp-tools-alignment` — this exact tool has a doc-drift history).
- Not-found: no portfolio stub/endpoint in the agent; no caller-identity in the `ingest_signal` path;
  no existing watchlist side effect; no system-owned watchlist concept.

## Recommended Scope

Advisory (input to grilling / `/sdd-spec`):
1. agent: add `ctx: Context` to `ingest_signal` + derive `_caller_user_id` (best-effort; skip on no id).
2. agent: new `app/client.py` portfolio method (`ensure_signal_watchlist` + `add_watchlist_symbol`),
   `PORTFOLIO_ENDPOINT` wiring in 3 deploy files + agent CLAUDE.md.
3. agent: the auto-add side effect in `ingest_signal` (gated `direction=="watchlist"` + not
   deduplicated), best-effort try/except → log.warning; CreateWatchlist-if-absent (reserved name) then
   AddWatchlistSymbols (unbound binding).
4. config: `agent.signal.watchlist_name` (default "Signals") if the reserved-name path is chosen.
5. docs: FR-5 doc parity (docstring + mcp-tools.md) + a tool-contract/side-effect test.
