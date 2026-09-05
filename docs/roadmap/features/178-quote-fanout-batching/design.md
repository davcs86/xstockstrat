# Design: quote-fanout-batching

**Created**: 2026-09-05
**Rounds**: 3 (quick → extended by user; termination: approved after round-3 adversary returned SOUND)
**Approved by**: user @ 2026-09-05
**Grounded in**: recon.md

---

## Chosen Approach

Collapse the N+1 fan-out on the portfolio→marketdata and portfolio→DB read edges, preserving enriched
values field-for-field including the missing-quote (null-not-zero) outcome. Consumer surface (C-14):
internal performance change behind the existing `/trader` + `/insights` reads and the agent
`get_positions*` tools — response shapes unchanged.

**New additive marketdata RPC (mirrors `GetFundamentalsMulti`, `marketdata.proto:44,221-227`):**
`GetLatestQuotes(GetLatestQuotesRequest{ repeated string symbols = 1 }) returns
(GetLatestQuotesResponse{ repeated Quote quotes = 1 })`. `Quote` self-keys on `symbol` (field 1), so
the response is **partial** — a symbol with no quote is **omitted**, never zero-filled (null-not-zero,
`@AC-4`). `repeated Quote` (not `map<string,Quote>`) matches the batch precedent; the client re-keys by
`Quote.symbol`. Additive → `buf breaking` passes; still `buf lint` + `./scripts/buf-gen.sh` +
Proto-Reviewer + marketdata-owner gate. (The `GetLatestQuotes` name deliberately avoids colliding with
the internal `GetLatestQuotesMulti` helper — a choice, not an oversight.)

**New marketdata repo method `GetLatestQuotesBatch(ctx, symbols) (map[string]*Quote, error)`** — a
genuinely new method, **not** a mirror of the singular `GetLatestQuote` (`marketdata_repo.go:278-284`,
`WHERE symbol=$1 ORDER BY time DESC LIMIT 1`, which cannot generalize — a `LIMIT` truncates the set):
```sql
SELECT DISTINCT ON (symbol) time, symbol, ask_price, ask_size, bid_price, bid_size, source
FROM marketdata.quotes
WHERE symbol = ANY($1)
ORDER BY symbol, time DESC
```
`$1` is a `[]string` (pgx TextArray). This read is index-shaped: the composite index
`idx_quotes_symbol_time (symbol, time DESC)` **already exists** (`migrations/001_marketdata_hypertables.up.sql:56`),
so `DISTINCT ON` uses it (no sort, no cache-hit-path regression) — **no new migration**. (`/sdd-spec`
should `EXPLAIN`-verify MergeAppend+Unique.)

**Batched marketdata service method `GetLatestQuotes`** — cache-first, exactly like the singular path
(`marketdata_service.go:406-427`, which is itself cache-first, so equivalence holds — a pure-live wrap
would drift freshness): (a) one `GetLatestQuotesBatch` for the warm set; (b) cold set = requested −
returned keys; (c) one `alpaca.GetLatestQuotesMulti(cold)` (`client.go:362`) under a **set-keyed
`singleflight.Group`** (`golang.org/x/sync`, indirect→direct); (d) `InsertQuote` each cold as an
**independent** `INSERT … ON CONFLICT` (matching singular parity, not one wrapping txn); merge disjoint
by construction. Single-flight sits beside the existing `staleMu`/`lastStaleCheck` interval limiter
(distinct code paths, no shared lock → no deadlock).

**Portfolio — per-site symbol sets (NOT uniform):**
- `enrichPositions` (`portfolio_service.go:324`) batches **only `CurrentPrice==0` positions** (it skips
  broker-valued positions before fetching, `:326`) — a full-set batch would overwrite
  broker-authoritative mark-to-market with mid-quotes, breaking `@AC-12/157` (short MtM) and `@AC-7`
  (ListPositions↔ListPortfolios parity). Missing key → the same `continue`/skip as the singular error
  path (`:330-337`).
- The 3 inline loops — `GetPnL` (`:522`), `broadcastSnapshot` (`:692`), `checkRiskLimits` (`:731`) —
  fetch unconditionally → **full** symbol set. In `checkRiskLimits` the batch rebuilds
  `posValues[symbol]=price*qty` + `totalValue` (the **concentration** check `:742-748`) identically;
  feature 172's drawdown block (`:750`) is kept verbatim.
- The `(Ask+Bid)/2` formula is byte-identical across all four sites (`:334/525/695/734`).

**Portfolio `ListWatchlists` (FR-2)** — collapse the 1+N `listBindings` loop into one
`SELECT symbol, strategy_id, source FROM portfolio.watchlist_symbols WHERE watchlist_id = ANY($1)
ORDER BY watchlist_id, symbol` over **only the paginated page's** watchlist IDs (excluding the current
`+1` lookahead, `watchlist_repo.go:132`), grouped in Go into `wl.Bindings`/`wl.Symbols` exactly as
today. Preserves per-symbol `strategy_id`/`source` (`@AC-1/2/167`). `ListByUser` (x-user-id scoped)
stays disjoint from `ListAllWatchlistSymbols` (`@AC-2/154`) — untouched.

## Rejected Alternatives

- **`map<string,Quote>` response** — explicit absent semantics at the type level, but breaks the
  `GetFundamentalsMulti` `repeated` precedent; `repeated Quote` self-keyed is the consistent choice and
  directly encodes null-not-zero.
- **Naive `WHERE symbol=ANY ORDER BY time DESC` (± `LIMIT`)** — returns all history or truncates
  symbols; `DISTINCT ON (symbol)` is the correct latest-per-symbol shape.
- **Pure-live `GetLatestQuotesMulti` wrap (no DB)** — bypasses the cache, risking FR-4 freshness drift
  and raising Alpaca load — the opposite of the goal.
- **Per-symbol singleflight fan-in** — fully satisfies FR-3's "N misses → one fetch" across
  overlapping-unequal cold sets, but adds scatter/gather bookkeeping and loses the single Alpaca batch
  call; the warm poller makes overlapping-unequal cold sets a vanishing case, so set-keying is the
  right scope cut.
- **N per-symbol `repo.GetLatestQuote` reads inside the batch** — trades the gRPC N+1 for a DB N+1; the
  `DISTINCT ON … ANY` batched read closes it.

## Open Risks

- [ ] **Partial-upstream-failure divergence — WAIVED (accepted, bounded).** A cold-batch Alpaca
  transport error drops the **entire** cold set, so the *set* of symbols contributing to
  `checkRiskLimits` concentration / `broadcastSnapshot` equity / `GetPnL` unrealized differs from the
  singular path (a smaller denominator observably changes the concentration ratio and whether
  `emitRiskAlert` fires). Accepted because the always-on warm-quote poller keeps cold sets tiny/usually
  empty, it is a degenerate first-read-under-live-fault path, and no existing `@AC-*` exercises a live
  upstream fault. Tests assert happy-path cross-path parity (`@AC-7/12/157`, byte-identical
  `(Ask+Bid)/2`) + the null-not-zero contract (`@AC-4`); **no** partial-failure parity test.
- [ ] **Set-keyed single-flight scope cut** — satisfies `@AC-3` (single-symbol), partially meets FR-3's
  general "N misses → one fetch" (overlapping-unequal cold sets each hit Alpaca). Warm-poller-justified;
  per-symbol fan-in is the recorded rejected alternative.
- [ ] **172→178 same-function overlap** in `checkRiskLimits` — recorded in `merge-order.md` (172 before
  178, manual reconcile keeping 172's drawdown block verbatim).
- [ ] **`/sdd-spec`: `EXPLAIN`-verify** the `DISTINCT ON` uses `idx_quotes_symbol_time`; author the new
  portfolio-side `MarketDataServiceClient` test stub (none exists).

## Constitution Rules Touched

- `C-09` — honored: additive RPC + two new messages (field numbers from 1, `Quote` reused); `buf breaking` passes; buf-gen + `proto-freshness` acknowledged. Proto approval gate (Proto Reviewer + marketdata owner).
- `C-04` — n/a: `repeated string symbols` is an open, runtime-extensible set (correctly not an enum).
- `C-01` — honored: `GetLatestQuotesBatch` named as new repo surface with its exact query, not a mislabeled mirror.
- `C-10(b)` — honored: all four mark-to-market read sites switched with a byte-identical `(Ask+Bid)/2` cross-path parity test (guards the PR#735 scar, fails.md:38).
- `C-16` — the marketdata quote / missing-quote / batch guarantees are net-new `@AC-*` authored in this feature's `acceptance.feature` (marketdata has no prior quote suite).
- `F-01` — n/a (no migration). `F-06` — n/a (no pool change; pooled `:25061` route unchanged).

## Business Rules Touched (C-16)

- PRESERVE `@AC-7/@AC-12 @feature-157`, `@AC-12 @feature-163` (mark-to-market + provenance parity across read paths) — `CurrentPrice==0`-only enrichPositions set + all-four-sites byte-identical formula.
- PRESERVE `@AC-1/@AC-2 @feature-167` (per-symbol `strategy_id`/`source` on the collapsed binding read).
- PRESERVE `@AC-1 @feature-154` (distinct cross-user union) — the `ANY`-array collapse touches only the x-user-id-scoped `ListByUser`, not the authz-gated `ListAllWatchlistSymbols`.
- NET-NEW (author here): marketdata quote correctness, missing-quote null-not-zero, batch + single-flight behavior — no prior suite to preserve.
