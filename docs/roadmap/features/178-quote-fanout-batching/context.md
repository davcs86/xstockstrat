# Context: quote-fanout-batching  (archived 2026-09-16)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-09-16 — /sdd-archiver

**What**: Shipped an additive `GetLatestQuotes` batch RPC on marketdata plus a set-keyed singleflight on its cold-symbol fallback, and switched portfolio's four mark-to-market read sites and the `ListWatchlists` 1+N binding loop to single batched reads — a pure performance change that preserved every enriched value field-for-field, including the missing-quote (null-not-zero) outcome. No new proto messages beyond the additive RPC, no migration, no config.

**Why (irrecoverable rationale)**:
- The set-keyed singleflight (key = sorted-joined cold set) is a deliberate scope cut, not full FR-3: it coalesces identical cold sets only; two concurrent batches with overlapping-but-unequal cold sets each still hit Alpaca. Accepted because the always-on warm-quote poller keeps cold sets tiny/usually-empty. Per-symbol scatter/gather fan-in (which would fully satisfy FR-3) was rejected for the bookkeeping cost and loss of the single Alpaca batch call.
- Cold quotes are written back as independent `INSERT … ON CONFLICT` execs, not one wrapping transaction, to match the singular path's per-quote cache-write parity.
- The batched repo read is a genuinely new method (`GetLatestQuotesBatch`, `DISTINCT ON (symbol) … ORDER BY symbol, time DESC`), NOT a generalization of singular `GetLatestQuote`; it rides the pre-existing `idx_quotes_symbol_time`, so no new migration was needed.

**Rejected alternatives**:
- `map<string,Quote>` response — breaks the `GetFundamentalsMulti` `repeated` precedent; `repeated Quote` self-keyed encodes null-not-zero and stays consistent.
- Naive `WHERE symbol=ANY ORDER BY time DESC` (± LIMIT) — returns all history or truncates symbols.
- Pure-live `GetLatestQuotesMulti` wrap (no DB) — bypasses cache, risks freshness drift, raises Alpaca load.
- Per-symbol singleflight fan-in — see above.
- N per-symbol `repo.GetLatestQuote` reads inside the batch — trades a gRPC N+1 for a DB N+1.

**Scars & gotchas**:
- The originating performance audit was factually wrong: it claimed marketdata "already exposes a batch `GetLatestQuotesMulti`" — false; that was an internal Go `MultiSymbolSource` helper, never a gRPC RPC. Caught at product-spec review (FAILED first pass); scope and audit both corrected.
- golangci-lint couldn't run locally (host v2.5.0/go1.25 refuses the go1.27 target; repo pins v2.13.1); fell back to `go build`+`go vet`+`gofmt -l`, deferred lint to CI.
- buf absent on host — codegen via Docker; `buf breaking` ran against `main-dev` (still proves additivity).
- Two testability seams added to prod code: (a) `MarketDataService.GetLatestQuotes` nil-guards its `s.repo` calls so coalescing + null-not-zero are testable with no DB (no-op in prod); (b) `WatchlistRepo` gained a `db queryRower` field (mirroring PortfolioRepo) so `bindingsByWatchlist` runs under pgxmock for the @AC-2 single-query count.
- New Go logic lives in service/handler/repository — excluded from `-coverpkg`; red-green behavioral tests were the only gate.

**Permanent deviations**:
- Partial-upstream-failure divergence — WAIVED and shipped untested. A cold-batch Alpaca transport error drops the *entire* cold set, whereas the replaced N singular calls dropped only the individually-failed symbol. This changes which symbols contribute to the denominator and thus `checkRiskLimits` concentration, `broadcastSnapshot` equity, `GetPnL` unrealized, and whether `emitRiskAlert` fires on a first-read-under-live-fault. Accepted as bounded (warm poller keeps cold sets tiny; no @AC exercises a live upstream fault) and covered by no partial-failure parity test. Reads as a latent bug once design.md is gone; it was a conscious choice.
- `latestQuotesFor` returns an empty map on whole-call RPC error → every symbol treated missing/neutral, matching N-failing-singular equivalence.

**Cross-feature signal**: The feature-172 "same-function merge conflict" in `checkRiskLimits` evaporated — 172 landed before /sdd-spec, and the recon adversary corrected a mislocation (the quote loop feeds the concentration check, not 172's drawdown block). Recon-time "same-function collision" alarms are worth re-validating at spec time against landed code. The `(Ask+Bid)/2` byte-identical-across-all-sites requirement is the PR#735 / fails.md:38 C-10(b) scar recurring — a fourth site + a cross-path parity test were added.

**Deferred follow-ons**: Per-symbol singleflight fan-in remains the un-taken path if overlapping-unequal cold sets ever stop being rare. If any @AC ever exercises a live Alpaca fault, the waived partial-upstream-failure divergence needs a parity test. `EXPLAIN`-verify that `DISTINCT ON` uses `idx_quotes_symbol_time` was deferred to CI/integration.

**Ledger entries written**: insights.md (3), fails.md (2) — see the 2026-09-16 entries. (The `(Ask+Bid)/2` byte-identity lesson was a DUP of fails.md:38 and was not re-appended.)

**Runtime-invariant recommendations (→ /context-constitution)**: PORTFOLIO-* — `enrichPositions` must never fetch/overwrite quotes for positions with `CurrentPrice > 0` (broker mark-to-market is authoritative; overwriting breaks short MtM @AC-12/157 and ListPositions↔ListPortfolios parity @AC-7). MARKETDATA-* — the batch `GetLatestQuotes` cold path coalesces only identical cold sets and drops the whole cold set on upstream error (aggregate divergence from the singular path). PLAT-*/MARKETDATA-* — `Quote` self-keys on `symbol`; a partial `repeated Quote` omits absent symbols (null-not-zero), the client re-keys, no zero-fill.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at a6029d9a.
