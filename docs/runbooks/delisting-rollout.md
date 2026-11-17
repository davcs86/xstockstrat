# Runbook: First Rollout of Delisted-Symbol Detection

**When to use**: once per environment, when feature 352 (`delisted-symbol-handling`) is first deployed,
and whenever a burst of `symbol_delisting` alerts is expected or seen. It explains what the first days
after the deploy look like, how to size the first-flag alert burst before it arrives, and how to defer it.

**No command is run by this runbook** except one read-only SQL query (§3). The burst is deferred through
the config UI (§4).

---

## 1. Prerequisites

- `xstockstrat-marketdata` and `xstockstrat-portfolio` are both on a build that contains feature 352, and
  marketdata migration `010_symbol_profile` and the config migration `marketdata_delisting_confirmation_days`
  are applied.
- Deploy order is free, with one effect to know: **portfolio deployed ahead of marketdata** gets
  `Unimplemented` from `SyncWatchlistDelistings` on every prune tick, logs a WARN and removes nothing until
  marketdata is on the new build.
- Detection depends on portfolio's prune tick (`portfolio` / `watchlist.signal_prune_interval_seconds`):
  marketdata only knows the watchlist symbol union portfolio last sent. A portfolio outage freezes that
  union; symbols added to a watchlist during the outage are not watched for delisting until portfolio is back.

## 2. What happens after the deploy

`N` below is `marketdata` / `assets.delisting_confirmation_trading_days` (default `5`, bounds `[1,30]`).

1. **At deploy** `marketdata.symbol_profile` and `marketdata.watched_symbol` are both empty. Marketdata's
   boot read of the flagged set finds nothing and starts nothing.
2. **Portfolio's first prune tick** sends the watchlist symbol union; marketdata stores it in
   `marketdata.watched_symbol`.
3. **The first successful asset-set load on a trading day after that** records a first-unservable date —
   that day — for every watchlist symbol that is unservable right now. A symbol that has been dead for
   months therefore carries a **deploy-era** first-unservable date, not the date it actually stopped trading.
4. **`N` trading days later** one asset-set load flags all of those symbols together. This is the
   first-flag burst.
5. **Portfolio drains the burst at no more than 100 symbols per prune tick**: for each it removes the symbol
   from system-managed "Signals" watchlists and sends one WARNING alert (category `symbol_delisting`). A
   burst of `K` symbols takes ⌈K/100⌉ ticks.

After the burst, flags arrive one symbol at a time, `N` trading days after a watchlist symbol first becomes
unservable.

## 3. Size the coming burst

Run this read-only query against the environment's database, following
[`operator-db-access.md`](operator-db-access.md):

```sql
SELECT count(*) FROM marketdata.symbol_profile
WHERE delisted_at IS NULL AND first_unservable_date IS NOT NULL;
```

The count is the number of symbols currently inside a confirmation window — the upper bound of the next
burst. A symbol that becomes servable again, or leaves every watchlist, before day `N` drops out of it.

## 4. Defer the burst

Raise `marketdata` / `assets.delisting_confirmation_trading_days` in the config UI **before day `N`**
(SetConfig accepts `[1,30]`). The value is re-read at each successful asset-set load, so the change applies
on the next load without a restart. The windows already running keep their first-unservable dates; only the
day on which they are flagged moves. Lowering the value later flags every symbol whose window has by then
elapsed, on the next trading-day load.

## 5. Verification

- Marketdata logs one INFO `delisting hook` per successful asset-set load with the per-step counts
  (`started`, `flagged`, `recovered`), the `watched` count and `skipped` (`closed_day` on weekends and
  holidays, `empty_union` until portfolio's first tick has run).
- `marketdata.delisting.hook_failures{reason timeout|error}` stays at zero.
- After the burst, the §3 count is back near zero and the affected symbols show the delisted marker on the
  `/insights` watchlist page.
