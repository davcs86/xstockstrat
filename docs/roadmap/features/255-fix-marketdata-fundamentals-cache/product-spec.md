# Product Spec: fix-marketdata-fundamentals-cache

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-21-marketdata-fundamentals-cache-defect.md`
**Severity**: SEV-3
**Created**: 2026-10-21

---

## Problem Statement

All citations are in `services/xstockstrat-marketdata/` at main-dev @ a053b0e.

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
- [ ] Config semantics: `marketdata.fmp.daily_request_cap` `<= 0` changes from "disabled" in practice to "uncapped" as documented. Update the marketdata `CLAUDE.md` key row and `docs/patterns/config-governance.md` if they describe it.

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Finnhub `GetFundamentalsMulti` dropping per-symbol errors (debt-radar NC-F, unconfirmed)
- The EDGAR companyfacts decode (feature 253)
