# Design: readiness-caching-poll-discipline

**Created**: 2026-09-05
**Rounds**: 4 (quick → extended by user; termination: approved after round-4 adversary returned SOUND)
**Approved by**: user @ 2026-09-05
**Grounded in**: recon.md

---

## Chosen Approach

Cut redundant recompute on the decide-surface read paths without ever presenting stale data as fresh.
Consumer surface (C-14): UI `/insights` — the Watchlist readiness pane (server cache + a per-query
client `staleTime`) and the Opportunities pane (empty-universe + conditional-enrichment savings);
readiness verdicts and opportunity rows are unchanged in value.

**FR-1 — readiness cache (EXTEND).** New migration `022_readiness_cache`: table
`analysis.readiness_cache`, composite PK `(user_id, strategy_id, rule, symbol)`, plus
`def_fingerprint TEXT NOT NULL`, `bar_epoch BIGINT NOT NULL`,
`readiness_json JSONB NOT NULL DEFAULT '{}'::jsonb`, `computed_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
`valid_until TIMESTAMPTZ NOT NULL`. A `ReadinessCacheRepository` (`read_many`/`upsert_many`) mirrors
`OpportunitiesRepository` + migration `011`. `EvaluateReadiness` (`servicer.py:2660`, loop
`:2702-2721`) becomes a strict **two-path** state machine per requested symbol:
- **FAST** — cached row AND `def_fingerprint == _definition_fingerprint(cur)` (`servicer.py:4299`) AND
  `now() < valid_until` → serve `readiness_json`, **skip the bars fetch and skip
  `evaluate_conditions_traced`**.
- **SLOW** (miss / fingerprint mismatch / expired) → run the existing loop, **always**
  `evaluate_conditions_traced`, then `upsert_many` with
  `bar_epoch = max(evaluated newest-bar time.seconds, benchmark newest-bar time.seconds)`,
  `def_fingerprint = _definition_fingerprint(...)`, `valid_until = now() + stale_after_seconds`.

There is **no slow-path `bar_epoch` reuse** — reusing persisted JSON on an epoch match would let an
in-place-updating current-day 1d bar (same `time.seconds`, moving OHLC) serve the first compute of
the day all day, defeating the window (`@AC-1/2/155`, `@AC-11/095`). `analysis.readiness.stale_after_seconds`
(read via `get_int_present`; 0 = always stale) is **server-bounded `< 86400`** through the config
service's `SCALAR_BOUNDS_REGISTRY` (feature 161; rejected at `SetConfig` with INVALID_ARGUMENT,
`configServiceImpl.ts:376`), so a served-stale verdict can never outlive a new daily bar. `bar_epoch =
max(evaluated, benchmark)` ensures a benchmark-only new bar busts the cache even when the evaluated
symbol is dormant.

**FR-3 — empty-universe (CHANGE, user signed off @ 2026-09-05).** New migration
`023_opportunity_compute_state`: table `analysis.opportunity_compute_state`, PK `user_id`,
`computed_at`/`valid_until` NOT NULL. In `ListOpportunities` inside the existing `count_for_user==0`
branch (`servicer.py:2975`), a **pre-check**: a fresh compute-state row (`now() < valid_until`) serves
empty **without** forcing `_materialize_opportunities`. **Every** compute completion that yields an
empty universe stamps this row with `valid_until = now() + analysis.opportunity.empty_recompute_ttl_seconds`
(new key, ~30s default, its own key — not the 24h `valid_window_hours`) — at **all three** empty-yielding
sites: `_materialize_opportunities` (cold, `:3081`), `_kick_opportunity_recompute._run` (background,
`:3090`), and the daily refresh tick `_opportunity_refresh_tick` (`:3557`, which calls `replace_for_user`
inline). A shared `_replace_and_stamp_compute_state(uid, rows)` helper is the preferred wiring so all
three writers stamp uniformly (must not perturb the feature-158 durable-refresh `@AC-8/9/1/2/158`
re-anchoring — settle at `/sdd-spec`). The empty path also fires the existing `_kick` self-heal, so a
legitimately-empty user's first real opportunity surfaces within ≈ one poll cycle (≤ the signed-off TTL).

**FR-4 — conditional enrichment.** Gate `_enrich_opportunities_live` (`servicer.py:3006`) on
`computed_at` staleness (skip when fresh), and wrap the per-symbol `GetLatestPrice` seam in a
short-TTL **success-only** memo — an unavailable quote drops its price within the TTL, never
persisting a memoized price as current (`@AC-11`). Cross-surface parity (`@AC-12`) holds: both the
Decide card and the Signal-detail panel read `Opportunity.live_price` from one `ListOpportunities`
response — `SignalReadiness.tsx:31` consumes `opps?.opportunities` and makes no direct `GetLatestPrice`
call, so the memo introduces no divergence.

**FR-2 — client.** Per-query `staleTime: 30_000` on the readiness `useQueries`
(`WatchlistReadiness.tsx:193`, copying `opportunities/page.tsx:130`) — **never** a QueryClient default
(that would force a whole-list refetch, `@AC-6/167`).

**Proto/config:** additive `google.protobuf.Timestamp computed_at = 2` on `EvaluateReadinessResponse`
(`analysis.proto:644`, non-breaking, buf-gen + proto gate). Two **no-seed** config keys
(`analysis.opportunity.*` pattern). Both `.down.sql` DROP their table.

**Literal upserts** (every NOT NULL column; empty-bars symbol → `readiness_json='{}'::jsonb`, never NULL):
`readiness_cache` INSERT … ON CONFLICT `(user_id,strategy_id,rule,symbol)` DO UPDATE (fingerprint,
bar_epoch, readiness_json, computed_at, valid_until); `opportunity_compute_state` INSERT … ON CONFLICT
`(user_id)` DO UPDATE (computed_at, valid_until).

## Rejected Alternatives

- **In-process TTL cache for readiness** — lost to the user-locked durable-table decision (restart/scale safety).
- **Wall-clock `bar_epoch`** — masks an intraday-corrected / late same-day bar (stale-as-fresh); replaced by `max(evaluated, benchmark)` observed.
- **In-band `opportunities` sentinel row for empty-universe** — filtered by the `read()` conviction floor, so it re-kicks every poll and trips the multi-consumer NOT-NULL trap; replaced by the dedicated `opportunity_compute_state` table.
- **Slow-path `bar_epoch`-reuse micro-opt** — a same-`time.seconds` intraday bar update would freeze a day-one verdict; dropped (the fast path already delivers the caching win).
- **Reusing the 24h `valid_window_hours` for the empty TTL** — would delay a new opportunity up to 24h; replaced by a dedicated ~30s `empty_recompute_ttl_seconds`.

## Open Risks

- [ ] **FR-3 daily-tick stamping** — `_opportunity_refresh_tick` (`:3557`) must also stamp
  `opportunity_compute_state` on an empty completion (via the shared helper), or `design`/`spec`
  documents the accepted **one-poll** synchronous re-materialize after a daily-refresh empty
  transition (self-healing, bounded, not stale-as-fresh). Decide at `/sdd-spec`; must not perturb `@AC-8/9/158`.
- [ ] **empty→non-empty latency** — a user adding a watchlist binding mid-TTL is undetectable to
  analysis until the ~30s TTL expires (≤ one poll — the signed-off CHANGE bound). Add an
  "empty→non-empty within one TTL" test.
- [ ] **AC-12 parity — `/sdd-spec` VERIFY** — cite `SignalReadiness.tsx:31` (the recon path
  `insights/market/[symbol]/page.tsx` does not exist) as the proof both surfaces read one response.
- [ ] **176→177 sequencing** — 177 wraps `EvaluateReadiness`/`_enrich_opportunities_live`, which 176
  restructures; spec 177 against 176's post-restructure signatures (merge-order WARN row).

## Constitution Rules Touched

- `C-07` — honored: two numbered migrations, each `up.sql`+`down.sql` (down DROPs its table).
- `C-09` — honored: additive `computed_at=2` (buf-breaking-safe); buf-gen + proto gate.
- `C-05` — honored: two new keys `<service>.<category>.<key>`, no-seed, CLAUDE.md + Per-Feature-log rows; `stale_after_seconds` server-bounded `<86400` (SCALAR_BOUNDS_REGISTRY).
- `C-16` — FR-1 EXTEND; FR-3 CHANGE with explicit user sign-off (this session, context.md).
- `F-01`/`F-06` — n/a: new migrations (not edits), no new DB pool.
- `P-03` — honored: the CHANGE, the AC-12 proof path, and the daily-tick residual are recorded, not guessed.

## Business Rules Touched (C-16)

- **EXTEND** — FR-1 readiness cache: a new freshness ceiling alongside the opportunity SWR contract; no re-order of the cold-vs-stale machine (with benchmark-max epoch + `<86400` bound).
- **CHANGE (user signed off @ 2026-09-05)** — FR-3 empty-universe: delays a currently-empty user's first opportunity ≤ `empty_recompute_ttl_seconds` (~30s), bounded by the dedicated short TTL + self-heal kick.
- PRESERVE `@AC-11 @feature-095` (never stale-as-fresh) — success-only memo + `<86400` window.
- PRESERVE `@AC-12 @feature-095` (cross-surface price parity) — both surfaces read one `ListOpportunities` response (`SignalReadiness.tsx:31`).
- PRESERVE `@AC-1/@AC-2 @feature-155` (readiness verdict cues render identically from cache) — key includes `rule` + `def_fingerprint`; no stale-verdict path survives.
- PRESERVE `@AC-6 @feature-167` (no whole-list refetch) — per-query `staleTime`, not a QueryClient default.
- PRESERVE `@AC-8/@AC-9/@AC-1/@AC-2 @feature-158` (daily refresh re-anchor / retry-soon) — the shared stamp helper must not perturb the durable-refresh path.
