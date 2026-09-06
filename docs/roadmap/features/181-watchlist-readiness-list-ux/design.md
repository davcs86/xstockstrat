# Design: watchlist-readiness-list-ux (feature 181)

**Created**: 2026-09-06
**Mode**: /sdd-design full (2 rounds) — gates `spec-ready` → `design-approved`
**Inputs**: `product-spec.md` (FR-1..7), `recon.md`, Constitution `docs/sdd/constitution.md`, ledger `fails.md`
**Debate**: design-proposer vs design-adversary, 2 rounds; 2 operator forks resolved at the Round-2 gate.

---

## Chosen Approach

One **additive, cache-first** analysis RPC decorates the watchlist readiness list; the client renders
rows immediately and self-heals pending rows by polling the **same** RPC. No portfolio→analysis edge
(FR-4 acyclic), no client-supplied `strategy_id` (Round-1 IDOR closed structurally).

### New RPC — `AnalysisService.GetWatchlistReadiness`

- **Request**: `{ string watchlist_id = 1; PageRequest page = 2; }` — owner is the `x-user-id` header,
  never on the wire (mirrors `ListOpportunities`, `analysis.proto:617-626`).
- **Response**: `{ repeated WatchlistReadinessRow rows = 1; PageResponse page = 2; }`.
- **Row**: `{ string symbol = 1; string strategy_id = 2; string source = 3; ReadinessState state = 4;`
  `SymbolReadiness readiness = 5; google.protobuf.Timestamp computed_at = 6; }` — `readiness` populated
  **iff** `state == RESOLVED`. **Not a `oneof`** (dodges the flattened-oneof e2e trap, fails.md:1281/1317).
- **Enum**: `ReadinessState { READINESS_STATE_UNSPECIFIED = 0; RESOLVED = 1; PENDING = 2; UNKNOWN = 3; }`
  (enum-over-string governance; `_UNSPECIFIED = 0`). Reuses `SymbolReadiness` (`analysis.proto:595-601`)
  and `common.v1.PageRequest`/`PageResponse` — appended after `GetAttribution` (`analysis.proto:52`).

### Server behavior (analysis servicer, new handler beside `EvaluateReadiness:2727`)

1. Owner-gated `GetWatchlist(watchlist_id)` over the **existing** analysis→portfolio edge
   (same stub `_drain_watchlist_bindings` uses, `servicer.py:3745-3770`) — **no portfolio change, no cycle**.
2. Flatten `bindings` (carry `WatchlistBinding.source`, `portfolio.proto:220-226`), impose a **total
   order** `(symbol ASC, strategy_id ASC)`, **keyset-slice** the page (page token = last-seen
   `(symbol, strategy_id)` — drift-proof, matches the `ListOpportunities`/`usePortfolio` precedent).
3. `readiness_cache.read_many(caller_user_id, strategy_id, "entry", symbols)` — **cache read only**,
   never SLOW compute in this RPC.
4. **Freshness = full `is_readiness_row_fresh` predicate** (`readiness.py:16-28`): fingerprint match
   **AND** `now < valid_until` **AND** `bar_epoch >= latest_bar_epoch`. The `latest_bar_epoch` is
   obtained by **one `GetDataCoverage` MIN/MAX probe per distinct page symbol** (≤ page size) — the
   exact probe `EvaluateReadiness` (`servicer.py:2837-2850`) and the materializer
   (`servicer.py:3883-3898`) already run. This is a bounded metadata read, **not** a bars fetch and
   **not** a re-eval — "cache-only compute" is preserved. Fresh → `RESOLVED` + inline `SymbolReadiness`;
   stale/missing → `PENDING`.
5. For the page's not-fresh pairs, fire a **best-effort, per-owner-deduped background refresh** — reuse
   `compute_readiness_row` + `upsert_many` (`readiness.py:38`, `readiness_cache.py:44`) grouped by
   strategy, each definition loaded owner-scoped via `get_by_owner_and_id` (`strategies.py:66`), bars
   gated by the materializer's own semaphore (feature 180). Dedupe via a **guard-set** mirroring
   `_kick_opportunity_recompute` (`servicer.py:3291-3308`: set-add on entry, `finally: discard`,
   exception-swallow, un-awaited `create_task`) — **not** a blocking per-owner lock (which would starve
   a second page's cold pairs). Returns immediately; a refresh failure never touches the response (FR-5).

### Client behavior (UI)

- New `useWatchlistReadiness(watchlistId, pageToken)` on its **own** query key
  `['watchlistReadiness', watchlistId, pageToken]` — **never** `['watchlists']` (preserves the
  feature-167 single-row patch, @AC-6 / recon R1). Page-token stack reused from `usePortfolio.ts:33,46-55`
  + `trader/positions/page.tsx:47-55,508-520`.
- Rows render immediately (FR-1). `RESOLVED` → verdict; `PENDING` → C-17 `Skeleton` (`aria-busy`) and the
  hook **re-fetches `GetWatchlistReadiness` on an interval** (staleTime:30_000-equivalent cadence,
  `refetchInterval` while any row is `PENDING`) until no `PENDING` rows remain; `UNKNOWN` → icon+text
  error via `QueryStateMessages`. Pagination control keyboard-operable + labeled (FR-7).
- `WatchlistReadiness.tsx:186-202` `useQueries` fan-out is **removed**; the per-strategy client
  `EvaluateReadiness` fan-out is **not** reintroduced — pending rows resolve through the one page-bounded
  RPC (the N+1 is killed, not relocated).
- The existing `['watchlists']` read is **retained** for the management surface (add/remove bindings,
  @feature-127 provenance badge + system-managed-delete affordance, @feature-155 **in-queue marker** —
  opportunity-queue state the readiness Row does not carry); `['watchlistReadiness']` layers **only** the
  verdict column. No `invalidateQueries(['watchlists'])` is added.

### BFF + e2e

- One `getWatchlistReadiness` forward in **insightsBff only** (`insightsBff.ts:55`, same shape as
  `evaluateReadiness`; owner from `x-user-id`, `forward`/`createDispatch` pass ConnectError through — no
  HTTP-400 collapse, fails.md:552). No second BFF call site (traderBff lists no watchlists; fails.md:1138 clear).
- e2e mock in **both** homes (`e2e/mock-backend.ts` ~:821-835, `e2e/helpers/watchlistMock.ts` ~:75),
  flattened proto3-JSON camelCase (`state`, nested `readiness`) — fails.md:1281/1317.

---

## Operator Decisions at the Round-2 Gate

1. **Inline freshness → Probe-gate (keep @AC-2).** The decorated read gates `RESOLVED` on the full
   `is_readiness_row_fresh` predicate (including the authoritative `bar_epoch` conjunct) via a cheap
   per-symbol `GetDataCoverage` probe — **not** the `valid_until` window alone. Rejected the pure-cache
   alternative (window-only), which the adversary proved ships a bar-stale `RESOLVED` verdict with no
   self-heal path (Obj 1) — a C-16 @AC-2 regression that would have needed explicit sign-off. The
   `stale_after < 86400` bound does **not** eliminate bar-staleness (it caps it at one bar), so the
   probe is required to keep inline freshness == poll freshness.
2. **PENDING resolution → Poll the new RPC.** Pending rows resolve by re-fetching the page-bounded
   `GetWatchlistReadiness`, **not** by polling the old per-strategy `EvaluateReadiness`. This overrides
   the initial "clients poll from the old endpoint" steering: the adversary showed the old-endpoint model
   re-introduces the exact N+1 (Obj 5) and double-computes each pair against the background kick (Obj 4).
   Polling the new RPC kills both — the background kick is the sole compute path; the RPC stays cache+probe.

---

## Rejected Alternatives

- **Option C — BFF two-backend aggregation** (`ListWatchlists` + N `EvaluateReadiness` merged in
  insightsBff). Cycle-free but net-new aggregation pattern, and it **relocates** the N backend readiness
  calls server-side rather than eliminating them; no proto reuse of the 180 batch path. Superseded by the
  single analysis RPC.
- **Option B — optional `readiness` field on portfolio's `Watchlist`.** Requires portfolio→analysis =
  the forbidden cycle (FR-4). Not viable.
- **Round-1 Option A — client-supplied `(symbol, strategy_id)` pairs.** IDOR: a caller could request
  readiness for a non-owned `strategy_id` and leak `SymbolReadiness.conditions` rule internals
  (fails.md:1153). Closed by keying on `watchlist_id` (server derives pairs from the owner's own watchlist).
- **Offset pagination.** Drift-prone: a binding added/removed between page reads skips/duplicates a row.
  Replaced with keyset over the sorted set (Obj 7).
- **Blocking per-owner refresh lock.** Starves a second open page's cold pairs. Replaced with a guard-set
  dedupe (Obj 4).
- **Coarse whole-owner `_materialize_readiness_for_owner` on read.** Re-warms every watchlist for one
  page view — wasteful. Scope the kick to the page's not-fresh pairs.

---

## Open Risks / Conditions Carried to /sdd-spec

- **R-A (recon R3, adversary "at risk").** Feature 180's FAST/`bar_epoch` guarantee is not yet in a
  durable C-16 suite. The probe-gate decision keeps this surface consistent with feature-177 @AC-2, but
  /sdd-spec should add a regression test asserting a bar-busted row renders `PENDING` (not a stale
  `RESOLVED`), and flag the 180 promotion.
- **R-B (Obj 5, fails.md:118).** The N+1-**kill** (FR-2/FR-6) is contingent on the feature-180
  materializer being enabled with a `valid_window` covering the read cadence; `enabled` defaults **off**
  and default `stale_after=30s` re-colds rows. **FR-1** (immediate render + loading state) is the
  unconditional win. Record this contingency in the spec; do not overclaim FR-2/FR-6.
- **R-C (Obj 3/6).** A rebind reflects on the readiness view only on its next refetch/poll, and a rebind
  on a non-visible page is invisible until paged to — accepted for the 1-day-bar cadence. The rebind
  mutation must **not** add an `invalidateQueries` full-page refetch on either key.
- **R-D (Obj 3).** /sdd-spec must confirm the retained `['watchlists']` read still supplies every
  @feature-155 / @feature-127 affordance field (in-queue marker, provenance, system-managed delete) that
  the readiness Row does not carry.

---

## Constitution Rules Touched

- **C-04** enum-over-string (`ReadinessState`, `_UNSPECIFIED=0`).
- **C-11 / P-03** surfaced the freshness/bar-epoch and kick-vs-poll forks to the operator, not guessed.
- **C-14** UI consumer surface (`/insights/watchlists`, existing page).
- **C-15 / C-16** @AC-1..6 covered; PRESERVE feature-177 @AC-1/2/3 (inline probe-gate + poll cadence),
  PRESERVE feature-167 @AC-6 (separate query key), EXTEND feature-155 @AC-4 (loading/unknown join the
  icon+text cue set).
- **C-17** shared Skeleton / QueryStateMessages / EmptyState primitives + a11y (`aria-busy`,
  keyboard-operable labeled pagination).
- **F-06** no new pool/edge/env/schema — reuses the analysis pool, the existing analysis→portfolio edge,
  and feature 180's `readiness_cache`.
- **Anti-IDOR** (fails.md:1153): pairs derived from the owner's own watchlist + caller-keyed cache read.
- **Ledger**: fails.md:552 (error passthrough), :1138 (single BFF site), :1281/:1317 (both e2e mock homes,
  flattened non-oneof shape), :1151 (no agent hand-projection — re-verified), :118 (skip-fresh steady state → R-B).
