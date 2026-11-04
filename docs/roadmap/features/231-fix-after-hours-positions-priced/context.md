# Context: fix-after-hours-positions-priced  (archived 2026-11-04)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-11-04 — /sdd-archiver

**What**: After the 16:00 ET close the IEX quote goes one-sided (ask or bid is 0). Five sites averaged `(ask + bid) / 2` and guarded only the sum, so quote-priced positions, persisted equity snapshots, concentration risk and the EDGAR price overlay read at about half value (MSFT 534.575 → 250.705, LYFT 17.055 → 8.025; broker LYFT read 16.98). Shipped: marketdata owns a single valuation mark, the additive `optional double Quote.mark_price = 8` set only by `GetLatestQuotes` (two-sided mid, else newest stored 1d close inside `marketdata.quotes.mark_close_max_age_hours`, else unset). Portfolio `markOf` (mark, else two-sided mid, else unpriced) is used by every read path, and the snapshot and concentration checks skip with a WARN when any position is unpriced. Launched 2026-10-20 via PR #1256 (integration) and #1258 (promotion).

**Why (irrecoverable rationale)**:
- The lone surviving quote side is not a usable price. Staging evidence 2026-10-19 after the close (lone side x2 vs stored 1d close): LYFT 16.05 vs 16.98 (broker 16.98), ICE 141.45 vs 158.32, MSFT 501.41 vs 533.645, ELWT no quote vs 5.48 (illiquid, 10-16). This ruled out trading's positive-side rule (`trading.go:3160-3168`) for valuation. The stored 1d close matched the broker. (context.md round-1 evidence, 2026-10-19)
- The mark is computed in marketdata, not per consumer, by operator steer at the round-1 gate: one policy (C-18), and portfolio keeps only a 1-line two-sided-mid fallback.
- Portfolio keeps that fallback because `deploy.yml:204` updates both components in one `doctl apps update`, so deploy order cannot be enforced. A portfolio that deploys before marketdata, or a rollback, then degrades to "two-sided mid only" instead of the halved price.
- The 120h floor on `mark_close_max_age_hours` exists because 1d bars are stamped 00:00 ET: on a Monday evening Friday's bar is about 92h old (about 116h with a Monday holiday). The 168h default is the design's chosen value; its sources give no further derivation.
- Both numbers are config keys because a staleness window and a lookup budget are policy values (F-07; feature 071 precedent), not code invariants. This was a Floor finding in round 2 (500ms) and again in round 3 (168h).
- The operator accepted that any unpriced position skips that user's per-fill snapshot and concentration check. The alternative, computing over the priced subset, would give understated equity and false concentration alerts. A permanently unpriceable holding (delisted, illiquid, stale beyond the bound) therefore disables both checks for that user until priced. The WARN names the symbols. Drawdown is unaffected because it reads broker `account_balances`.

- Pool safety of the concurrent mark lookup (why it cannot deadlock the pool): marketdata MaxConns is 2; the warm read releases its connection before the branch, so at most two are in use afterwards (the close query, and the serial `InsertQuote` calls inside the singleflight). There is no hold-and-wait and every acquire is context-bounded. (design.md:68-70)
- `mark_timeout_ms` ceiling 2500 equals the `batch_timeout_ms` default, so under defaults the close lookup never extends the cold-path worst case (bound W + max(B, C)); the key is unseeded per the 227/229 waiver pattern. (design.md:79-80)
- Accepted cost of `needClose`: it includes every cold symbol, so a cold symbol that turns out two-sided wastes one indexed lookup. (design.md:43-44)
- Behaviour change from prior code (operator-signed, not a design deviation): the snapshot used to skip only when NO position was priced (old `priced == 0` rule, recon.md:98); it now skips when ANY position is unpriced (design.md:97,131 specified this, and the portfolio `CLAUDE.md` rule was rewritten from "no position priced" to "any position unpriced").
- Unproven SQL plan: pgxmock never runs Postgres, so the LATERAL/PK-index plan and the `close > 0` filter of `GetLatestDailyClosesBatch` are proven by SQL text only; AC-7 is `since`-argument pins plus SQL-text pins (implementation-spec.md:98-100; context.md:103). The only real-DB proof was the post-deploy staging check, which was never recorded.
- Consent: the operator's "no checkpoints" instruction was taken as the §5.1b mode-entry agreement and the §5.4 up-front confirmation (context.md:230-231), and also as the P-04 confirmation for the C-16 scenario promotion (context.md:424).
- Development ran on harness branch `ccr-9f55a8ac-dtw4iv` (the branch PR #1256 targets), not `feature/<slug>`, because the harness permits pushes only to the ccr branch (context.md:232-233).
- Recon warned that if one-sided meant unpriced with no fallback, GetPnL would return UNAVAILABLE every evening for offline holders (recon.md:155-156); the close-mark fallback mitigates it inside the staleness bound. Feature 240 later changed offline last-close pricing (see Permanent deviations).

**Rejected alternatives**:
- Live last trade via portfolio `BatchGetLatestPrice` — lost (round-1 adversary): two detached 2.5s budgets inside 229's 4s deadline; an unbounded prev-close scan on every call; serial per-symbol live calls inside `GetFundamentalsMulti` (the 227 hang class); a live Alpaca call on every after-hours read.
- Trading's positive-side rule (use the lone side) — lost: staging showed it 6-11% stale.
- Normalize or filter one-sided quotes at the producer or warm cache — lost: it changes trading sizing and widens 229 `@AC-8` for every consumer.
- Per-service duplication of the mark policy; a shared Go package; the `packages/proto/pnl` carve-out — lost: C-18, and `pnl` is scoped to realized P&L, needs a governance edit, and no CI job runs `go test` there.
- Marks as a `map<string,double>` on `GetLatestQuotesResponse` — lost: heavier portfolio merge; a scoped field comment ("populated only by GetLatestQuotes") covers the semantics.
- Serial close lookup after the cold fetch (W + B + C) — lost: it sits on a path that already timed out at 17:36. Coalescing the lookup under the singleflight was also rejected, since it needs a detached budget again.
- Reusing `latest_lookback_hours` as the staleness bound — lost (round-2 resolution, context.md:86): a separately named bound, later made the config key `mark_close_max_age_hours`.
- Hardcoded 168h or 500ms — lost under F-07 (became config keys).
- Concentration over the priced subset — lost to operator choice (skip + WARN).
- Storing the mark in `marketdata.quotes` — lost: needs a migration and on-read computation suffices.
- Reusing `GetPreviousDailyCloseBatch` for the close — lost: it is unbounded and returns the second-newest close.

**Scars & gotchas**:
- `GetPreviousDailyCloseBatch` looks reusable but is the wrong query (second-newest close, no lower bound). The new `GetLatestDailyClosesBatch` copies the `latestQuotesBatchSQL` LATERAL shape and `QueryExecModeExec`.
- Cold quotes are shared across singleflight waiters and the fake store returns stored pointers, so `withMark` must `proto.Clone` before setting `MarkPrice`. A test pins clone safety.
- The close-lookup goroutine uses a cap-1 buffered channel that is always received, on a per-caller non-detached `context.WithTimeout`; the WARN carries `ctx_done`. Concurrency is proven by a two-way handshake (`multi.started` <-> `closeFake.waitFor`) with `mark_timeout_ms` 2500; mutation check: forcing close-first serial makes AC-12 FAIL. A timing bound was rejected (no 650ms wall-clock assertion); AC-15 uses a 100ms budget and asserts < 1s.
- AC-6 must use a synthetic close aged 200h. The real ELWT 10-16 bar is only about 90h old on a Monday, so it would be priced inside the 168h bound.
- `edgarFinish` must not upsert when `live == nil`, or a transient mark miss caches the filed-date price for the 24h TTL (fails.md:2289 class). `GetFundamentalsMulti` phase 1 resolves all symbols before any upsert, so an aborting batch now caches nothing (accepted N6; response unchanged).
- `posValues[sym] =` at the old `portfolio_service.go:910` overwrote across accounts; the fix is `+=`. Before the fix the AC-3 symptom was "LYFT at 50.0%" and MSFT dropped.
- `checkRiskLimits` needs a non-nil `*config.Watcher`; the zero value `&config.Watcher{}` is safe (precedent `portfolio_fill_sync_race_test.go:65`). Portfolio tests had no notify fake, so a `recordingNotify` was created inline. Neither marketdata nor portfolio had `internal/testdata/`; Steps 6 and 12 created `internal/testdata/marks.go` in each (C-13).
- `buf breaking` against `.git` needs `../../.git#ref=HEAD,subdir=packages/proto` and `../../.git#branch=main-dev,subdir=packages/proto` forms (insights.md:1876, 215 Deviation Log). The local `main-dev` ref was stale (`09ec8d9a`) and had to be moved to `origin/main-dev` for the `buf-gen.sh` breaking guard.
- Codegen: Docker Hub 429 on `golang:1.27-trixie` forced the host-native toolchain. Plugins built with go1.24.7 reflowed doc comments in `analysis.pb.go` (dirty baseline); rebuilding with `GOTOOLCHAIN=go1.27.0`, matching CI `proto-freshness`, gave an empty baseline diff. Steps 3-4 emitted exactly the 8 expected generated files. `/usr/local/bin/golangci-lint` v2.5.0/go1.25 cannot load go1.27 modules (same as 229 D-3), so v2.14.0 was rebuilt with go1.27.0.
- `TestEnrichPosition` (`portfolio_helpers_test.go`) had to follow the new `enrichPosition(p, price)` signature; the spec review caught this as blocker B1 because lint type-checks tests. The PR #735 parity guard (`TestEnrichPositions_OneBatchedCall`) was kept with an amended comment, assertions unchanged.
- The MCP fundamentals tool is `query_fundamentals` (`tools.py:402`); "get_fundamentals" is only the client function name. No UI/agent caller of `GetPnL` was found by grep.
- Context-forge `/context-constitution refresh` was unavailable (only `context-scrubber` installed); the teardown was done by hand with the read-only `context-auditor` over 7 touched files, which found 3 pre-existing stale "mid-quotes" / "one-sided/empty" lines, all fixed.

**Permanent deviations**:
- design said an operator-run EDGAR cache purge (`DELETE FROM marketdata.fundamentals WHERE source='edgar'`, counts recorded) after the marketdata deploy → shipped no purge → because the operator has no SQL access (rollout decision 2026-10-20). Half-priced `source='edgar'` rows expire under `marketdata.edgar.cache_ttl_hours` (24, read live) and are re-derived with the mark, so ratios for after-hours-cached symbols may be off for up to 24h after deploy (accepted). `fundamentals_history` and already-emitted signals are never repaired.
- Promotion set differed from the spec: implementation-spec.md:116 planned `@AC-1` into the marketdata suite too; at integration `@AC-1` went to the portfolio suite only, since its Then asserts portfolio output (marketdata's side is AC-5/AC-7) (context.md:424-425).
- design said `GetFundamentalsMulti` prefetches quotes once per call (operator binding) → shipped one `GetLatestQuotes` for the pending-only symbols, none if all are cache hits → cache hits need no price (accepted refinement).
- design said the close-lookup goroutine is inline in `GetLatestQuotes` and `TestResolveQuoteTunables` is extended → shipped `lookupMarkCloses(ctx, symbols) <-chan map[string]float64` and a separate `TestResolveMarkTunables` (D-2; behaviour identical, in-scope structure choice).
- design said the Docker codegen image → shipped the host-native toolchain (D-1; CI `proto-freshness` re-verifies).
- Later superseded by feature 240-offline-account-full-pnl: the promoted portfolio suite scenarios `@AC-6` ("ELWT current_price is 0") and `@AC-14` ("16.05/0 -> 0") now read "priced from the last close with mark_source MARK_SOURCE_LAST_CLOSE" and "two-sided mid, then the offline last close". Do not read the original source values as current behaviour.

**Cross-feature signal**:
- Feature 229 (`quote_timeout_ms` 4s deadline, `@AC-5` GetPnL UNAVAILABLE, `@AC-8` omit missing symbols) is the budget and contract every 231 choice had to fit under; the quote-timeout invariant is now "must exceed max(batch, mark) + warm read".
- Feature 178's `@AC-1` "batched equals serial" in `quote-fanout-batching.feature` was narrowed (signed C-16 CHANGE): it holds for two-sided quotes only, because serial `GetLatestQuote` and the stream compute no mark.
- Feature 211 EDGAR price-join and 215/227 (`GetFundamentalsMulti` serial-loop hang class) were extended, not regressed.
- Duplicate defect: #1257 filed `docs/reports/2026-10-19-portfolio-snapshot-risk-midquote-valuation-defect.md` (SEV-2) mid-execution; it is a strict subset of Step 11, and its sidecar was stamped `triaged -> feature:231-fix-after-hours-positions-priced`.
- Overlap with `230-offline-account-full-pnl` (shipped as 240): same portfolio valuation functions; a soft WARN is recorded in `merge-order.md`. Feature number 230 was claimed by two in-flight branches, so this feature took 231.
- The quote-timeout investigation was folded into feature 226 by the operator (2026-10-19).

**Deferred follow-ons**:
- Stored-close freshness right after 16:00 (poller lags up to about 5 min; a symbol first queried after close may carry the previous session's close): price is real, never halved, but may lag. The after-close staging check (positions vs stored `1d` closes via the staging MCP) was assigned to Claude; the result is not recorded in context.md.
- Weekend first-query gap: the warm set is in memory and `minIngestLookback` is 48h, so a never-ingested symbol may have no close inside the bound and stays unpriced.
- `adjustment=all` makes a prior-day close back-adjusted on ex-dates, so it will not equal the broker's raw close (accepted).
- Whether IEX daily bars include extended-hours prints is unverified (marketdata findings open question).
- `StartSnapshotWriter` no-caller finding: RESOLVED by feature 264, which deleted the writer and retired `portfolio.snapshot.interval_minutes` (config migration 034); snapshots run only per fill (`services/xstockstrat-portfolio/docs/context-constitution-findings.md:32`).
- The `portfolio.proto` `day_pnl` comment still says "positions enriched from marketdata mid-quotes" (now `packages/proto/portfolio/v1/portfolio.proto:89`; the findings row cites ~L81); doc-lie, reword in the next proto PR.
- Two quote fetches per fill (`checkRiskLimits` and `broadcastSnapshot`): pre-existing, optional merge, out of scope.
- One extra pooled query per after-hours read/fill: under contention the mark lookup times out and fails safe to unpriced + WARN; monitor after deploy.
- Trading sizing (`trading.go:3156-3169`) keeps its own one-sided rule, unchanged.

**Ledger entries written**: insights.md (0 new), fails.md (0 new) — both lessons were already recorded: insights.md 2026-10-20 "fix-after-hours-positions-priced — design" (chokepoint mark + deploy-skew fallback; handshake concurrency test) and fails.md 2026-10-19 "fix-after-hours-positions-priced — assumption" (five unguarded mid sites; lone side not a fallback; F-07 staleness window).
**Runtime-invariant recommendations (→ /context-constitution)**: Candidates (may already be reflected by the Step 13 PORTFOLIO-1 rewrite): (1) a valuation price is `Quote.mark_price` else the two-sided mid else unpriced; a lone quote side is never a price; (2) snapshot and concentration require every position priced, with broker price first; (3) `quote_timeout_ms` must exceed max(batch, mark) + warm read.
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 1ed63958.
