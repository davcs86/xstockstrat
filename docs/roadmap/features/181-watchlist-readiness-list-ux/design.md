# Design: watchlist-readiness-list-ux (feature 181)

**Created**: 2026-09-06
**Mode**: /sdd-design full (4 rounds) — gates `spec-ready` → `design-approved`
**Inputs**: `product-spec.md` (FR-1..7), `recon.md`, Constitution `docs/sdd/constitution.md`, ledger `fails.md`
**Debate**: design-proposer vs design-adversary, 5 rounds (full-mode cap); 2 operator forks resolved at the
Round-2 gate, Obj 3–7 closed at Round 3 (adversary-verified), R-E infinite-PENDING trap mechanized at
Round 4 (failure sentinel; operator-approved shared-compute scope deviation), Round 5 final holistic
coherence pass → APPROVE. No Floor breach at any round.

---

## Chosen Approach

One **additive, cache-first** analysis RPC decorates the watchlist readiness list; the client renders
rows immediately and self-heals pending rows by polling the **same** RPC. No portfolio→analysis edge
(FR-4 acyclic), no client-supplied `strategy_id` (Round-1 IDOR closed structurally).

### New RPC — `AnalysisService.GetWatchlistReadiness`

- **Request**: `{ string watchlist_id = 1; PageRequest page = 2; }` — owner is the `x-user-id` header,
  never on the wire (mirrors `ListOpportunities`, `analysis.proto:617-626`).
- **Response**: `{ repeated WatchlistReadinessRow rows = 1; PageResponse page = 2; }`.
- **Row**: `{ string symbol = 1; string strategy_id = 2; ReadinessState state = 3;`
  `SymbolReadiness readiness = 4; google.protobuf.Timestamp computed_at = 5; }` — `readiness` populated
  **iff** `state == RESOLVED`. **Not a `oneof`** (dodges the flattened-oneof e2e trap, fails.md:1281/1317).
  `strategy_id` is the **join key only** (not a display payload). **No `source` field** — the @feature-127
  provenance badge already renders from `binding.source` on the `['watchlists']` read
  (`WatchlistReadiness.tsx:32-39,276`), so carrying it on the verdict Row would duplicate it (Round-3 Obj 3).
  The client keys each verdict cell by `(symbol, strategy_id)` (`WatchlistReadiness.tsx:270` today keys by
  `symbol` alone — the composite key is strictly more correct when a symbol binds multiple strategies).
- **Enum**: `ReadinessState { READINESS_STATE_UNSPECIFIED = 0; RESOLVED = 1; PENDING = 2; UNKNOWN = 3; }`
  (enum-over-string governance; `_UNSPECIFIED = 0`). Reuses `SymbolReadiness` (`analysis.proto:595-601`)
  and `common.v1.PageRequest`/`PageResponse` — appended after `GetAttribution` (`analysis.proto:52`).

### Server behavior (analysis servicer, new handler beside `EvaluateReadiness:2727`)

1. Owner-gated `GetWatchlist(watchlist_id)` — a **new method on the existing `self._portfolio` stub**
   (RPC `portfolio.proto:22`), invoked over the **existing** analysis→portfolio edge the
   `_drain_watchlist_bindings` drain already uses (`servicer.py:3745-3770`). **No new edge, no portfolio
   change, no cycle** (F-06 clean).
2. Flatten `bindings`, impose a **total order** `(symbol ASC, strategy_id ASC)`, **keyset-slice** the
   page. Page token = the last-seen `(symbol, strategy_id)` of the sorted set, encoded as an **opaque
   base64 string** into `common.v1.PageRequest.page_token` (a `string`, `common.proto:12`); resume with
   the lexicographic `(symbol, strategy_id) > (cursor.symbol, cursor.strategy_id)`. Keyset (not offset) is
   drift-proof: a binding added/removed between page reads shifts no cursor, so no row is skipped or
   duplicated. **Precedent is `ListPositions`** (single-column keyset: `WHERE ($N='' OR symbol > $N) ORDER
   BY symbol ASC LIMIT`, `portfolio_repo.go:155-166`; client stack `usePortfolio.ts:46-56`) — the
   **composite** `(symbol, strategy_id)` cursor is a net-new lexicographic **extension** of it. NOTE:
   `ListOpportunities` is **offset**-paginated (`servicer.py:3148-3155`), the counter-example — do **not**
   copy its slice. This keyset bounds readiness **compute + response size**, not the portfolio read
   (`GetWatchlist` returns bindings whole, `watchlist_repo.go:441`) — which satisfies FR-3 ("evaluated
   only for the visible page").
3. `readiness_cache.read_many(caller_user_id, strategy_id, "entry", symbols)` — **cache read only**,
   never SLOW compute in this RPC.
4. **Classify each page pair (stateless, over existing cache columns + the probe).** `latest_bar_epoch`
   (`lbe`) is obtained by **one `GetDataCoverage` MIN/MAX probe per distinct page symbol** (≤ page size) —
   the exact probe `EvaluateReadiness` (`servicer.py:2837-2850`) and the materializer
   (`servicer.py:3883-3898`) already run: a bounded metadata read, **not** a bars fetch, **not** a re-eval
   ("cache-only compute" preserved). The classifier, in this order (see R-E for the sentinel):
   ```
   row = cached.get(symbol); lbe = latest_bar_epoch.get(symbol, 0)
   if row and row["bar_epoch"] < 0:                            -> UNKNOWN   # data-unavailable sentinel
   elif row and is_readiness_row_fresh(row, now, fp, lbe):     -> RESOLVED  # inline SymbolReadiness
   else:                                                       -> PENDING   # + deduped kick
   ```
   `is_readiness_row_fresh` (`readiness.py:16-28`) is the full predicate — fingerprint match **AND**
   `now < valid_until` **AND** `bar_epoch >= latest_bar_epoch` (the authoritative `bar_epoch` bust, keeping
   @AC-2). A probe miss (`lbe = 0`) makes `bar_epoch >= 0` always true → a non-sentinel row serves
   `RESOLVED` best-effort (matches the interactive path); a sentinel (`-1`) row is `UNKNOWN` regardless of
   `lbe`, so the `bar_epoch < 0` check is **first**.
5. For the page's not-fresh pairs, fire a **best-effort background refresh** — reuse `compute_readiness_row`
   + `upsert_many` (`readiness.py:38`, `readiness_cache.py:44`) grouped by strategy, each definition loaded
   owner-scoped via `get_by_owner_and_id` (`strategies.py:66`). Dedupe via a **guard-set keyed per
   `(owner, strategy_id, symbol)`** — a new `self._readiness_kicking` mirroring the
   `_kick_opportunity_recompute` shape (`servicer.py:3291-3308`: set-add on entry, `finally: discard`,
   exception-swallow, un-awaited `create_task`), **not** a blocking per-owner lock (which starves a second
   open page). The triple granularity is the true unit of work: disjoint pages proceed concurrently; two
   views of the same pair collapse to one refresh (all triples in a strategy-group added/discarded
   coherently). Bars gated by the **materializer's own** semaphore `self._readiness_materializer_bars_sem`
   (`servicer.py:443`), **not** the interactive `_bars_fetch_sem` (`servicer.py:404`) — preserves the
   feature-176 priority-inversion guard (a background kick never starves interactive readiness). The kick
   stamps `valid_until = readiness_valid_until(now, valid_window_hours)` (**24h backstop**, `readiness.py:31-35`,
   the materializer's window at `servicer.py:3923`), **not** the 30s interactive `stale_after` the
   `EvaluateReadiness` SLOW body stamps (`servicer.py:2825`) — so a page warmed once by any read stays
   `RESOLVED` across polls until a `bar_epoch` bust, even with the 180 loop off. `upsert_many` is an
   idempotent `ON CONFLICT … DO UPDATE` (`readiness_cache.py:52-61`) and the kick + loop run the same
   `compute_readiness_row`, so a double-fire on one pair is last-write-wins, not corruption. Returns
   immediately; a refresh failure never touches the response (FR-5).
   - **PENDING** pairs are kicked on every poll (guard-set deduped). **UNKNOWN** (sentinel `-1`) pairs are
     kicked only when a **retry cooldown** has elapsed — `now - row["computed_at"] > _READINESS_UNKNOWN_RETRY_SECONDS`
     (300s, a module constant beside `_READINESS_LOOKBACK_DAYS`, `servicer.py:2766`) — evaluated statelessly
     from the row's own `computed_at`. So a persistently data-unavailable pair re-attempts at most once per
     ~5 min (not every 30s poll), and self-heals: when bars return, the cooldown-gated kick writes a real
     `bar_epoch` ≥ `lbe` → the next poll classifies it `RESOLVED`. No operator action, no schema/state.

### Client behavior (UI)

- New `useWatchlistReadiness(watchlistId, pageToken)` on its **own** query key
  `['watchlistReadiness', watchlistId, pageToken]` — **never** `['watchlists']` (preserves the
  feature-167 single-row patch, @AC-6 / recon R1). Page-token stack reused from `usePortfolio.ts:33,46-55`
  + `trader/positions/page.tsx:47-55,508-520`.
- **Page agreement.** Rows render from the existing `['watchlists']` cache (bindings held whole), sliced
  client-side with the **same** `(symbol ASC, strategy_id ASC)` total order and the same keyset token
  passed to the RPC, so client and server bound roughly the same page. Correctness does **not** depend on
  membership agreeing exactly: each verdict is matched onto its row by the `(symbol, strategy_id)` cell
  key, so a rebind race can only leave a since-removed pair unmatched (→ stays `PENDING`/drops on next
  poll), never land a wrong verdict on a row.
- Rows render immediately (FR-1). `RESOLVED` → verdict; `PENDING` → C-17 `Skeleton` (`aria-busy`);
  `UNKNOWN` → icon+text error via `QueryStateMessages` (FR-5). The hook **re-fetches
  `GetWatchlistReadiness` on an interval** (staleTime:30_000-equivalent cadence) while any rendered row is
  **`PENDING` OR `UNKNOWN`** — polling must stay alive on `UNKNOWN` too, so the server's cooldown-gated
  recovery re-kick (step 5) is observed and a data-recovered pair flips to `RESOLVED` without a manual
  reload (Round-4 recovery gap). Pagination control keyboard-operable + labeled (FR-7).
- **The poll-alive condition is computed from the *rendered* rows** (the binding rows joined to the
  readiness map), **not** from the readiness response alone — otherwise a symbol just added via
  `useAddWatchlistSymbols` (which invalidates `['watchlists']` and re-renders a new binding row) would have
  no readiness entry, so a response-only check would never re-poll it and the new row would hang on
  `Skeleton` forever (Round-3 Obj 6 gap). The union keeps the poll alive until every rendered row is
  `RESOLVED`.
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
- **R-E discriminator: `computed_at` recency (`stuck = recent AND bar_epoch < lbe`).** Rejected — misfires
  on the normal new-bar-at-close case: a row computed seconds before a daily bar closes is *recent* and
  *trails* the new `lbe`, yet is a healthy not-yet-recomputed row (should be `PENDING`), not data-unavailable
  (`UNKNOWN`). Would paint a ≤5-min false `UNKNOWN` once/day at bar close and suppress the legitimate
  refresh — a C-16 @AC-2 (feature-177) regression.
- **R-E discriminator: `bar_epoch == 0`.** Rejected — the benchmark is loaded once per request independent
  of each symbol's primary fetch (`servicer.py:2768-2770`), so a *benchmark-present* strategy whose primary
  bars fail writes `bar_epoch = max(0, benchmark_epoch) > 0` — a `== 0` test misses it and the trap stays
  open for benchmark strategies. Only an explicit failure sentinel written by `compute_readiness_row`
  covers both sub-cases (see R-E).

---

## Open Risks / Conditions Carried to /sdd-spec

- **R-A (recon R3, adversary "at risk").** Feature 180's FAST/`bar_epoch` guarantee is not yet in a
  durable C-16 suite. The probe-gate decision keeps this surface consistent with feature-177 @AC-2.
  /sdd-spec adds: (1) a pytest in `services/xstockstrat-analysis/tests/test_readiness.py` (which already
  unit-tests `is_readiness_row_fresh` + the interactive bar_epoch FAST gate) covering all four classifier
  states — fresh→RESOLVED; sentinel(`-1`)→UNKNOWN; bar-stale non-sentinel→PENDING+kick; probe-miss
  (`lbe=0`)→best-effort RESOLVED — with the load-bearing assertion *a bar-busted row is never a stale
  RESOLVED*; (2) a durable C-16 scenario in **`services/xstockstrat-analysis/acceptance/readiness-caching-poll-discipline.feature`**
  (the existing feature-177 readiness suite — **not** `platform.feature`, which is the cross-cutting suite),
  asserting the same guarantee, and flags the feature-180 FAST/`bar_epoch` guarantee for promotion in the
  same edit.
- **R-B (Obj 5, fails.md:118) — SPLIT.** **FR-1** (immediate render + per-row loading) and **FR-2** (the
  client per-strategy N+1 elimination — one page-bounded RPC + interval refetch of that same RPC, never N
  `EvaluateReadiness` calls) are **UNCONDITIONAL**. **FR-6** (visible page served FAST with no server-side
  re-eval on *first* render) is **contingent** on the feature-180 materializer being enabled with a
  `valid_window` covering the read cadence — `analysis.readiness_materializer.enabled` defaults **off**. On
  a cold page every row is `PENDING`; the single page-bounded refetch loop + the 24h-stamping kick warm the
  pairs over one RPC (the N+1 is killed, not relocated), and the durable stamp keeps them warm thereafter.
  /sdd-spec documents the "enable the 180 materializer for a warm first render" operator prerequisite and
  does **not** flip the shipped default (that is an ops/config-governance decision beyond this read-shape feature).
- **R-C (Obj 3/6).** A rebind reflects on the readiness view only on its next refetch/poll, and a rebind
  on a non-visible page is invisible until paged to — accepted for the 1-day-bar cadence, violates no `@AC`
  or FR (FR-1/2/3 are visible-page only). The rebind mutation must **not** add an `invalidateQueries`
  full-page refetch on either key.
- **R-D (Obj 3) — RESOLVED (verified, not deferred).** The retained `['watchlists']` read supplies every
  non-readiness affordance; the readiness Row carries none of them. Provenance mapping (each verified in
  code): in-queue marker ← `useOpportunities()` (`WatchlistDetail.tsx:72,90` → `WatchlistReadiness.tsx:265,293`);
  provenance badge ← `binding.source` (`WatchlistReadiness.tsx:32-39,276`); system-managed delete ←
  `watchlist.systemManaged` (`WatchlistDetail.tsx:221`); firing/watching cues + blocking + firing-row jump
  `firing` ← the verdict via `readinessState/isFiring/blockingCondition` (`WatchlistReadiness.tsx:42-75,266-296`);
  jump href ← `binding.strategyId` (`WatchlistReadiness.tsx:301`). /sdd-spec records this table.
- **R-E (Obj 4c) — RESOLVED via a failure sentinel (operator-approved scope deviation).** The
  cache-read-only + probe-gate combination introduced an infinite-`PENDING` trap: if `GetDataCoverage`
  succeeds (`lbe > 0`) but `_fetch_bars_paged` **persistently** fails, `compute_readiness_row` today
  swallows the error and upserts `bar_epoch = max(0, benchmark_epoch)` (`readiness.py:61-82`), which never
  reaches `lbe` → `is_readiness_row_fresh` False forever → `PENDING` on every poll. Two rejected
  discriminators (`computed_at` recency; `bar_epoch == 0`) are in Rejected Alternatives — recency misfires
  on the normal new-bar-at-close case, and `== 0` misses benchmark-present failures. **Fix (operator
  choice, see context.md):** `compute_readiness_row` stamps **`bar_epoch = -1`** on a primary-bars-fetch
  exception (instead of the `max(0, benchmark_epoch)` fallback); the classifier maps `bar_epoch < 0 →
  UNKNOWN` (step 4), and the server rate-limits the recovery re-kick by a `computed_at` cooldown (step 5).
  `-1` is schema-safe: `readiness_cache.bar_epoch` is `BIGINT NOT NULL` with no non-negative constraint
  (`migrations/022_readiness_cache.up.sql:14`). Reuses `ReadinessState.UNKNOWN` — **no new proto field, no
  migration** (F-06 holds). **Scope deviation:** `compute_readiness_row` is the compute path shared by the
  interactive `EvaluateReadiness` handler and the feature-180 materializer, so this is a (more-correct)
  behavior change to shipped features 177/180 — a benchmark-present primary-failure row that today can
  FAST-serve a degraded verdict now becomes non-fresh/`UNKNOWN`. This exceeds 181's "presentation +
  read-shape only" scope; the operator **explicitly approved** it (recorded in context.md, C-11/P-03).
  /sdd-spec MUST re-verify feature-177 @AC-2 **and @AC-1** against `readiness-caching-poll-discipline.feature`
  in the same PR (the shared-compute edit changes only the *failure* stamp, so @AC-1's happy-path FAST skip
  for *successful* symbols must be asserted unchanged, not just @AC-2's bar-bust), and RED-test the sentinel
  write + the four-way classifier.
- **R-F (Obj 4a, NEW) — semaphore config coupling.** Reusing `self._readiness_materializer_bars_sem`
  (`servicer.py:443`) for on-read kicks means `analysis.readiness_materializer.max_concurrent_bars_fetches`
  now **also** throttles interactive watchlist-read kicks. Document in the spec and `analysis/CLAUDE.md`
  so operators know the coupling. (Contention is low: the materializer is a once-daily loop, default off.)

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
