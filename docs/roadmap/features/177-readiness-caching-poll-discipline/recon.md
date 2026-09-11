# Recon: readiness-caching-poll-discipline

**Created**: 2026-09-04
**From**: product-spec.md
**Affected services**: xstockstrat-analysis, xstockstrat-ui

---

## Objective

Eliminate redundant recompute on the decide-surface read paths: cache/materialize watchlist readiness
the way Opportunities already is, stop the every-15s recompute for empty-universe users, make warm-poll
live enrichment conditional, and add a client `staleTime`. Must never present stale data as fresh and
must preserve readiness verdict correctness.

## Codebase Map

- **`xstockstrat-analysis`** (Python)
  - `ListOpportunities` (the materialization template): `app/handlers/servicer.py:2948`; freshness docstring `:2955`; cold-vs-stale branch + `count_for_user==0` gate `:2975-2987`; `_materialize_opportunities` `:3081`; `_kick_opportunity_recompute` (fire-and-forget, single-flight guard `_opportunity_recomputing`) `:3090`; daily wall-clock refresh `run_opportunity_refresh_forever` `:3567`
  - Opportunities repo (mirror target): `app/repositories/opportunities.py` — `replace_for_user` (transactional delete+bulk-insert, `computed_at` default `now()`) `:41`; `read` (LEFT JOIN, `include_expired` = SWR toggle, selects `computed_at`) `:77`; `count_for_user` `:124`; migration `011_opportunities.up.sql:19-20` (`valid_until`, `computed_at`)
  - `EvaluateReadiness` (no cache today): def `servicer.py:2660`, recompute loop `:2702-2721`; cache-key inputs in scope: `strategy_id` `:2716`, `symbols` `:2702`, `rule` `:2694`; bars window `_recent_range(_READINESS_LOOKBACK_DAYS=400)` `:2696/:245`
  - `_enrich_opportunities_live` (unconditional per read): call `servicer.py:3000`; def `:3006`; per-symbol `GetLatestPrice` `:3029` + `GetBars` `:3043`, bounded by `_bars_fetch_sem`
  - Empty-universe recompute: `count_for_user==0` forces `_materialize_opportunities` `:2976`; `replace_for_user` with `rows==[]` returns after DELETE without insert `opportunities.py:50-51` → count stays 0 → recompute every poll
  - Config accessors `app/config/watcher.py`: `get_int_present:102`/`get_float_present:131` (zero-legitimate readers to mirror for `stale_after_seconds` where 0 = "always stale"); existing `analysis.opportunity.*` keys are the neighbor namespace
  - Last migration: `021_pnl_positions_fees_total` (confirmed; next = **022**)
  - Proto: `EvaluateReadinessResponse` single field `readiness=1` `packages/proto/analysis/v1/analysis.proto:644-646`; `SymbolReadiness` fields 1-5 `:595-601` (no `computed_at`); `EvaluateReadinessRequest` fields 1-3 `:635`
- **`xstockstrat-ui`** (Next.js)
  - Readiness fan-out (staleTime target): `src/components/insights/WatchlistReadiness.tsx:193` `useQueries` — currently only `queryKey`+`queryFn`, no `staleTime`/`refetchInterval`/`gcTime`
  - Sibling cadence: `useOpportunities` `src/hooks/useOpportunities.ts:16` (`refetchInterval: 15_000`, no staleTime); single-query `useReadiness` `:48`
  - Shared QueryClient defaults: `src/lib/queryClient.ts:11-17` (`staleTime: 5_000, retry: 1`)
  - Canonical per-query staleTime override to REUSE: `src/app/insights/opportunities/page.tsx:130-137` (`staleTime: 30_000`)
  - Insights BFF: `src/lib/insightsBff.ts:55` `evaluateReadiness` plain pass-through `forward()`, no cache/dedup
  - Tests: readiness fixtures `e2e/fixtures/opportunities.ts` (`symbolReadiness`, `READINESS_BUCKET_OVERRIDE`), spec `e2e/insights/watchlists.spec.ts`; vitest `src/lib/readinessRollup.test.ts`

## Patterns to REUSE

- **Server-side materialization** → mirror `OpportunitiesRepository` + migration `011` (`replace_for_user`/`read`/`count_for_user`, `computed_at`/`valid_until`) for a readiness cache. `_kick_opportunity_recompute`'s fire-and-forget + single-flight guard is the SWR mechanism to copy.
- **Conditional enrichment gate** → use the existing `computed_at` freshness stamp (`opportunities.py:99`) as the staleness input; only fan out `_enrich_opportunities_live` when the enriched values are older than the window.
- **Client staleTime** → copy the `staleTime: 30_000` per-query override at `opportunities/page.tsx:130` onto the readiness `useQueries` at `WatchlistReadiness.tsx:193` (align with the 15s poll cadence).
- **Zero-legitimate config read** → `get_int_present` `watcher.py:102` for `analysis.readiness.stale_after_seconds` (0 = always stale).
- **Fixtures** → `e2e/fixtures/opportunities.ts` `symbolReadiness` + `READINESS_BUCKET_OVERRIDE` (C-12; extend, don't recreate).

## Existing Business Rules (preserve / extend)

All PRESERVE — a freshness/cadence change that must not alter verdicts or present stale-as-fresh.
- **PRESERVE** `@AC-11 @feature-095` "unavailable live quote omits the price, never fabricated" (`services/xstockstrat-ui/acceptance/opportunity-live-market-enrichment.feature`) — the core "never stale-as-fresh" guard; caching must omit/em-dash, never synthesize.
- **PRESERVE** `@AC-12 @feature-095` "live price equals across Decide and Signal-detail surfaces" — client `staleTime` must not desync the two surfaces from one fetch cycle.
- **PRESERVE** `@AC-4/@AC-6/@AC-13 @feature-095` — cached sparkline gaps render null not NaN; missing condition leaves show no fabricated chip; cache-miss universe degrades to symbol+price, never fabricates.
- **PRESERVE** `@AC-1/@AC-2 @feature-155` (`.../watchlist-opportunity-signal-cues.feature`) — firing / "N away" readiness verdict cues must render identically from cache.
- **PRESERVE** `@AC-12 @feature-155` — a source vanishing on refetch must not strand the queue empty (poll/staleTime refetch keeps the fallback).
- **PRESERVE** `@AC-6 @feature-167` (`.../watchlist-single-strategy-update.feature`) — UI patches only the changed row, no whole-list `['watchlists']` invalidation; the new `staleTime` must not force a whole-list refetch.
- **PRESERVE** `@AC-8/@AC-9/@AC-1/@AC-2 @feature-158` (`.../durable-loop-scheduler.feature`) — daily opportunity refresh re-anchors across redeploy, retries-soon on enumeration failure, poll-free sleep-until-due, next-due write only after a completed run. Bounded staleness must not break these.
- **AMBIGUITY → design must classify**: whether the new readiness staleness bound EXTENDS the existing opportunity SWR/daily-refresh contract (a new ceiling alongside) or CHANGES it. The opportunity materialization freshness contract itself is documented only in `services/xstockstrat-analysis/CLAUDE.md` (not C-16-promoted). If the design alters refresh cadence/re-anchoring → CHANGE needing user sign-off in context.md.

## Dependencies

- Proto/RPC: optional additive `google.protobuf.Timestamp computed_at = 2` on `EvaluateReadinessResponse` (`analysis.proto:644`) if FR-5 surfaces served-staleness — non-breaking; buf-gen + proto gate if taken.
- Migration: next `022` for `services/xstockstrat-analysis/migrations/` IF a readiness materialization table is added (up.sql + down.sql pair). Whether a table is needed vs. an in-process/keyed cache is the central design fork.
- Config keys: new `analysis.readiness.stale_after_seconds` (+ possibly an empty-universe TTL key) — read via `get_int_present`; document in analysis `CLAUDE.md` Config Keys.
- Inter-service edges: unchanged.
- New env vars / ports: none.

## Risks / Not-found

- **Central fork**: readiness cache home — its own materialization table (mirror 011, migration 022) vs. an in-process TTL/keyed cache. Table = durable, survives restart, works when analysis scales; in-process = simpler, lost on restart, unsafe if analysis scales past instance_count:1.
- **Cache invalidation "bar epoch"**: readiness verdict depends on the latest bar; the cache key/validity must bust when a new daily/intraday bar lands (fails.md:751-754 remount-cost trap; feature 118 poll cadence).
- **176↔177 same-function overlap**: 176 edits `_compute_opportunities`/`EvaluateReadiness`/`_enrich_opportunities_live`; 177 edits the same. Sequence 176 first (mechanics) then 177 (cadence); coordinate at `/sdd-spec` + merge-order.
- **Client staleTime vs @AC-6/167**: a global/misplaced staleTime could force whole-list refetch — must be a per-query override, not a QueryClient default change.
- **Empty-universe cache placement**: analysis is instance_count:1 today; an in-process empty-cache is fine now but a table sentinel is scale-safe.

## Recommended Scope

1. Analysis: cache readiness (repo + migration 022 mirroring 011, or a justified in-process cache) keyed on (user, strategy, symbols, bar epoch), with SWR + a `stale_after_seconds` window. (FR-1/FR-5)
2. Analysis: cache the empty-universe opportunity result (sentinel) so `count_for_user==0` no longer forces recompute every poll. (FR-3)
3. Analysis: gate `_enrich_opportunities_live` on `computed_at` staleness — skip when fresh. (FR-4)
4. UI: add `staleTime` (per-query, ~15-30s) to the readiness `useQueries`. (FR-2)
Each with an equivalence/verdict test + a "no recompute within window" test.
