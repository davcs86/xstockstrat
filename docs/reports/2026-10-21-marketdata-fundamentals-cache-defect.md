# Defect: Marketdata fundamentals cache, quota and stream paths silently drop data, miscount quota and ignore source

**Recorded**: 2026-10-21
**Severity**: SEV-3
**Impact type**: stale-or-missing-fundamentals
**Environment**: dev (main-dev) @ a053b0e
**Affected service(s)**: xstockstrat-marketdata
**Config-only fix possible**: no
**Source**: repo-surveyor debt-radar scan (`docs/repo-surveyor/debt-radar-findings.md` @ 4535695), findings D-19, D-50, D-51, D-52, D-53. All five were re-verified against main-dev @ a053b0e.

## Observed

### D-19 — Alpaca stream reconnect budget is lifetime-cumulative and gives up silently

`streamManager.run` counts `attempts` across the manager's whole lifetime and never resets it after a
successful connection. Once the drops add up to `MaxReconnects`, it logs one `slog.Error`, sets
`running = false` and returns. Subscriber channels stay open and get no error. The backoff uses
`time.Sleep`, which does not observe any context. This is latent: no in-repo consumer is wired to
`StreamBars`/`StreamQuotes` today.

### D-50 — FMP "cap ≤ 0 = uncapped" is implemented as "cap ≤ 0 = disabled"

`BudgetSnapshot` and `atQuotaAlertThreshold` document `cap <= 0` as uncapped. `reserve()` rejects whenever
`c.used >= dailyCap`, and that is always true at cap 0. `GetFundamentalsMulti` and `resolveFundamentals`
check `count >= cap` the same way, so they serve stale data or return `ResourceExhausted`. An operator who
sets `marketdata.fmp.daily_request_cap=0` to lift the cap turns FMP off completely.

### D-51 — Vendor quota counts ignore `source`

`CountFundamentalsFetchedToday` and `CountFundamentalsFetchedSince` count every `marketdata.fundamentals` row.
That includes `source='edgar'` snapshot-cache rows and rows from the inactive vendor. These counts seed FMP's
day budget at boot and drive Finnhub's rolling window, so quota reads as "exhausted" too early and the
service serves stale data.

### D-52 — Vendor fundamentals cache ignores the row's `source`

The vendor path treats a row as fresh with `found && time.Since(fetchedAt) <= ttl` and never checks
`cached.Source`. The edgar path does check (`cacheAxis(cached.Source) == snapshotSourceEdgar`), and the
marketdata docs describe "source-aware self-heal". After `snapshot_source` switches from edgar back to
vendor, edgar rows are served as vendor data until the TTL runs out.

### D-53 — Three silent decode/enrichment drops in the fundamentals path

- The repository decodes `extra` JSON with `_ = json.Unmarshal(extraJSON, &extra)` in three copies. A decode
  failure, such as the bytea/jsonb hex-garble hazard under `DB_PGBOUNCER` documented in the same file, loses
  `total_debt` (the D/E basis) silently.
- FMP extended enrichment drops the `fetchRatios`/`fetchProfile` errors, including `ErrFMPDailyCapExceeded`
  mid-batch. The partial row is then upserted as fresh for `cache_ttl_hours`. P/B, ROE, beta and sector go
  missing for a whole TTL.

## Expected

- **D-19:** A successful connection resets the reconnect budget. The backoff sleep returns early on shutdown. On
  give-up, subscribers learn about it (closed channel or error), not just a log line.
- **D-50:** `daily_request_cap <= 0` means uncapped everywhere (reserve, quota gate, alert threshold), as documented.
- **D-51:** Quota counts include only rows written by the active vendor (`source = <active provider>`).
- **D-52:** The vendor path treats a non-vendor (edgar) cache row as a miss, just as the edgar path treats a vendor row.
- **D-53:** A failed `extra` decode is logged. Decoding lives in one helper. A row whose enrichment failed is
  marked partial and is not cached as fresh for the full TTL.

## Reproduction

1. **D-50:** Set `marketdata.fmp.daily_request_cap=0` with provider `fmp`, then call `GetFundamentals("AAPL")` on an
   empty cache. The call returns `ResourceExhausted` ("fmp request cap 0 reached"). Expected: the fetch succeeds.
2. **D-51:** With provider `finnhub`, insert 20 `source='edgar'` rows with `fetched_at = now()`, then call
   `GetFundamentals` for an uncached symbol with `symbols_per_minute=20`. Quota reads as exhausted and no Finnhub fetch is made.
3. **D-52:** Store an AAPL row with `source='edgar'` and `fetched_at = now()`. Set `snapshot_source` to the vendor
   and call `GetFundamentals("AAPL")`. The edgar row is returned as fresh and no vendor fetch happens.
4. **D-53:** Run FMP extended mode where `fetchProfile` returns `ErrFMPDailyCapExceeded`. The upserted row has no
   sector or beta and is served as fresh until `cache_ttl_hours` passes. Separately, store a row whose `extra` is
   not valid JSON. `GetFundamentals` returns it with `total_debt` absent and logs nothing.
5. **D-19:** Configure `MaxReconnects=3` and let the stream connect and then drop three times, each after a
   successful session. The manager stops for good after the third drop and subscribers get nothing.

## Evidence

### D-19

`services/xstockstrat-marketdata/internal/alpaca/stream.go:147-172`
> attempts := 0
> ...
> if attempts >= maxReconnects {
> slog.Error("alpaca stream giving up after max reconnects", "max", maxReconnects)
> ...
> time.Sleep(time.Duration(delayMs) * time.Millisecond)

### D-50

`services/xstockstrat-marketdata/internal/fmp/fmp_client.go:97`
> // BudgetSnapshot returns today's used count and the live cap (cap <= 0 = uncapped).

`services/xstockstrat-marketdata/internal/fmp/fmp_client.go:127`
> if c.limits != nil && c.used >= dailyCap {

`services/xstockstrat-marketdata/internal/service/marketdata_service.go:1688`, `:1742` (`if count >= cap {`), `:1958-1959`
> // atQuotaAlertThreshold is the single home of the 80%-of-cap threshold; cap <= 0 is never "at threshold".

### D-51

`services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:656-659` (`CountFundamentalsFetchedToday`), `:669-670` (`CountFundamentalsFetchedSince`)
> `SELECT count(*) FROM marketdata.fundamentals WHERE fetched_at >= $1`

Consumers: `cmd/server/main.go:129-130` (FMP boot seed) and `internal/service/marketdata_service.go:1935` (Finnhub window).

### D-52

`services/xstockstrat-marketdata/internal/service/marketdata_service.go:1676` (and `:1734`)
> if found && time.Since(fetchedAt) <= ttl {

compare `:1850`
> found && time.Since(fetchedAt) <= ttl && cacheAxis(cached.Source) == snapshotSourceEdgar {

### D-53

`services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:548`, `:836`, `:889`
> _ = json.Unmarshal(extraJSON, &extra)

`services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:582`: comment on the `DB_PGBOUNCER` bytea/jsonb hex-garble hazard.

`services/xstockstrat-marketdata/internal/fmp/fmp_client.go:195`, `:198`
> if r, rErr := c.fetchRatios(ctx, sym); rErr == nil && r != nil {
> if p, pErr := c.fetchProfile(ctx, sym); pErr == nil && p != nil {

## Root cause hypothesis

- **D-50:** The guards were written as `>=` comparisons without the `cap > 0` short-circuit that the docs promise.
- **D-51, D-52:** The `source` column (`migrations/002_fundamentals.up.sql:23`) was added for the edgar axis (feature 211),
  but only the edgar side was taught to read it.
- **D-53:** Best-effort enrichment was written as "ignore the error". No partial marker exists.
- **D-19:** The counter is scoped to the manager's lifetime, not to consecutive failures.

## Confidence

high
