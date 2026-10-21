# Product Spec: fix-marketdata-fundamentals-cache

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-21-marketdata-fundamentals-cache-defect.md`
**Severity**: SEV-3
**Created**: 2026-10-21

---

## Problem Statement

All citations are in `services/xstockstrat-marketdata/` at main-dev @ a053b0e.

Who is hit: an operator who sets `marketdata.fmp.daily_request_cap` to 0 to lift the FMP cap finds FMP fundamentals
switched off instead (D-50); a trader on the Finnhub provider is throttled to stale or `ResourceExhausted` fundamentals
by EDGAR rows that never touched Finnhub (D-51), or is served EDGAR numbers labelled as vendor data (D-52), or a
half-enriched row for a full TTL (D-53).

- **D-50 (cap 0 disables FMP).** **Observed:** `fmp_client.go:97` and `marketdata_service.go:1958` document `cap <= 0` as
  uncapped. `reserve()` (`fmp_client.go:127`) and the quota gates (`marketdata_service.go:1688`, `:1742`) reject at
  `count >= cap`, which is always true at 0. **Expected:** `cap <= 0` is uncapped on every path.
- **D-51 (quota counts ignore source).** **Observed:** `CountFundamentalsFetchedToday` (`marketdata_repo.go:656-659`) and
  `CountFundamentalsFetchedSince` (`:669-670`) count all rows, including edgar and the inactive vendor. They seed FMP at boot
  (`cmd/server/main.go:129-130`) and drive the Finnhub window (`marketdata_service.go:1935`). **Expected:** count only the
  active provider's rows.
- **D-52 (vendor cache ignores source).** **Observed:** `marketdata_service.go:1676`, `:1734` accept any fresh row. The edgar
  path checks `cacheAxis(cached.Source)` (`:1850`). **Expected:** the vendor path treats an edgar-axis row as a miss.
- **D-53 (silent drops).** **Observed:** `_ = json.Unmarshal(extraJSON, &extra)` appears at `marketdata_repo.go:548`, `:836`,
  `:889`. `fmp_client.go:195`, `:198` drop the ratios/profile errors (including `ErrFMPDailyCapExceeded`), and the partial row
  is cached as fresh. **Expected:** the decode error is logged through one shared helper, and a partial enrichment is not
  cached as fresh for the full TTL.
- **D-19 (stream budget).** **Observed:** `internal/alpaca/stream.go:147-172` never resets `attempts`, sleeps with
  `time.Sleep` (no ctx), and gives up with only a log line. **Expected:** the budget resets on a successful session, the
  backoff can be cancelled, and subscribers are told when the manager gives up. Latent: no consumer is wired today.

## Functional Requirements

- **FR-1 (D-50).** When `marketdata.fmp.daily_request_cap` is `<= 0`, every FMP path (`reserve()` in the FMP client and
  both `GetFundamentals`/`GetFundamentalsMulti` quota gates) treats the budget as uncapped: it makes the fetch, never
  returns `ResourceExhausted` for quota, and never emits the 80%-of-cap WARNING alert. The marketdata `CLAUDE.md` row
  for the key (and `docs/patterns/config-governance.md`, if it describes the key) states `<= 0` = uncapped.
- **FR-2 (D-51).** The quota counts that seed the FMP day budget at boot and drive the Finnhub rolling window
  (`marketdata.finnhub.symbols_per_minute` over `marketdata.finnhub.rate_window_seconds`) count only rows whose
  `source` is the active provider (`marketdata.fundamentals.provider`); EDGAR rows and the inactive vendor's rows are
  excluded.
- **FR-3 (D-52).** Under `marketdata.fundamentals.snapshot_source=vendor`, a cached row whose `source` is on the EDGAR
  axis is a cache miss: the active vendor client is called and its result is served, mirroring the existing
  source-aware check on the EDGAR axis.
- **FR-4 (D-53).** (a) A failed decode of a row's `extra` jsonb column is logged as a WARN naming the symbol and the
  error, through one shared helper used by all three read sites. (b) When an FMP enrichment call (ratios or profile)
  fails, including `ErrFMPDailyCapExceeded`, a WARN names the symbol and the failed enrichment; the metrics that call
  would supply are listed in the response's `Fundamentals.missing_metrics` (existing field 18 semantics, no new proto
  field); and the row is not treated as fresh for the full `marketdata.fmp.cache_ttl_hours`, so the next request after
  the FMP quota resets re-fetches it.
- **FR-5 (D-19).** The Alpaca stream manager's reconnect counter counts consecutive failed attempts only and resets after
  a successful session; the backoff wait is cancellable by the manager's context; and when `MaxReconnects` consecutive
  attempts fail, the manager closes every subscriber's channel (the signal subscribers observe) and logs an ERROR naming
  the exhausted reconnect budget.

## Reproduction Steps

See the report § Reproduction (one step per D-id), for example:
- D-50: `daily_request_cap=0` + provider `fmp` → `GetFundamentals("AAPL")` returns `ResourceExhausted`.
- D-52: a fresh `source='edgar'` AAPL row with the vendor snapshot source is served without a vendor fetch.

## Root Cause Hypothesis

- D-50: the `cap > 0` short-circuit is missing from the `>=` guards.
- D-51/D-52: the `source` column (`migrations/002_fundamentals.up.sql:23`) is read only on the edgar axis (feature 211).
- D-53: best-effort enrichment ignores errors, and no partial marker exists.
- D-19: the counter is scoped to the manager's lifetime, not to consecutive failures.

## Affected Services

- xstockstrat-marketdata (all fix sites)

## Fix Scope

- [x] No proto changes anticipated (if design wants a wire-visible partial marker for D-53, it must reuse existing `Fundamentals.missing_metrics` semantics, not add a field)
- [x] No database migrations anticipated (the `source` column already exists; a `(source, fetched_at)` index is optional — design to confirm against `idx_fundamentals_fetched_at`)
- [x] Config semantics: `marketdata.fmp.daily_request_cap` `<= 0` changes from "disabled" in practice to "uncapped" as documented; the doc updates are part of FR-1. No new config key.
- [x] Migration condition: if design adopts the optional `(source, fetched_at)` index, it is the next free marketdata migration (`010_<description>.up.sql` + `.down.sql` at trunk tip `009_symbol_classification`), recorded as a design decision.

## Consumer Surface(s)

No surface changes request or response shape. These surfaces read `GetFundamentals`/`GetFundamentalsMulti`, whose
served result this feature changes (FR-1 serves where `ResourceExhausted` was returned, FR-3 changes which source is
served, FR-4 may add entries to `missing_metrics`), so `/sdd-spec` gives each a verification step:
- [x] **Agent**: `query_fundamentals` and `screen_symbols` (`services/xstockstrat-agent/app/tools.py:402`, `:812`).
- [x] **UI**: `/trader/positions/[symbol]` fundamentals (`services/xstockstrat-ui/src/lib/traderBff.ts`) and the
  `/insights` data explorer / formula workspace (`services/xstockstrat-ui/src/lib/insightsBff.ts`). No UI code change.
- FR-5 has no consumer surface: no subscriber of the Alpaca stream manager is wired today.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Finnhub `GetFundamentalsMulti` dropping per-symbol errors (debt-radar NC-F, unconfirmed)
- The EDGAR companyfacts decode (feature 253)
