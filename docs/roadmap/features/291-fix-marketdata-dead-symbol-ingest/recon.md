# Recon: fix-marketdata-dead-symbol-ingest

**Created**: 2026-11-04
**From**: product-spec.md
**Affected services**: xstockstrat-marketdata (observed by xstockstrat-analysis live loop; no code change expected there)

---

## Objective

The always-on bar ingester re-requests every warm symbol each 5-minute cycle, including ~6 (AXIA, EVTV,
LRHC, LXP, PSKY, RAMP) that never return bars, and WARNs about them every cycle (1,173 lines/7d). Back off or
report-once for repeatedly empty symbols, without changing what GetBars/BatchGetBars return and without
regressing analysis's data-unavailable handling.

## Codebase Map

- **`xstockstrat-marketdata`** (Go) — `internal/service/marketdata_service.go` unless noted
  - Warm set: `warmMu`/`warmSymbols map[string]struct{}` `:48-51`, init `:221`; `lastStaleCheck` `:56`, init `:222`. **Add-only**: sole writer `markWarm` `:1089-1096` (ignores `""`, no timestamp/counter, no `delete` anywhere).
  - `markWarm` callers: GetBars `:263`, GetLatestQuote `:546`, GetLatestQuotes `:576`, GetLatestPrice `:689`, BatchGetBars `:750`, BatchGetLatestPrice `:869`. Readers: `warmSnapshot()` `:1100-1108` (ingester `:1263`), `StartWarmQuotePoller` inline copy `:1133-1138`.
  - Ingester: `StartBarIngestPoller` `:1188-1212` (interval `marketdata.stream.bar_ingest_interval_ms` default 300000, re-read every tick, `<=0` pauses) → `ingestRecentBars` `:1262-1285` → `ingestRecentBarsForTimeframe` `:1289-1330` (multi path `:1292-1299`: absent key and empty slice both count as missing; per-symbol fallback `:1314-1328`: fetch error → WARN + `continue`, NOT counted missing; `len(bars)==0` → missing) → `reportIngestCycle` `:1337-1351` (free function, no receiver/state; always INFO heartbeat; WARN `:1348` with sample capped `barIngestNoBarsSample=10` `:1333`).
  - Alpaca multi: `internal/alpaca/client.go:411` `GetBarsMulti` — symbols sent raw, a symbol with no bars is simply absent from the response map (no per-symbol error). Defaults `feed=iex`, `adjustment=all` (`:94`, `:147`).
  - GetBars miss path `:313-332`: `refetch := len(bars)==0` → a symbol with no stored bars refetches live on **every** call (`staleCheckDue` `:343-352` only limits stored-but-stale); WARN `:329`. `markWarm` is called unconditionally on every GetBars (`:263`), so a dead symbol analysis keeps querying is re-warmed each time — **eviction alone is undone; back-off state must live in the ingester or `markWarm` must consult it.**
  - Config pattern: `intGetter` `:116`, `resolvePositiveInt` `:986-991`, wrappers `:998-1018`; live per-tick/per-call reads; `<=0` = pause (MARKETDATA-5, `docs/context-constitution.md:21`). `marketdata.stream.*` keys are **unseeded** (`scripts/config-wiring.json:608-629`, `"kind":"read-unseeded"`, owner feature 278).
  - Pollers started `cmd/server/main.go:160` (warm), `:162` (ingest).

## Patterns to REUSE

- Report-once + negative cache → feature 227/215 precedent in the same service: ETF-flag filler (`StartEtfFlagFiller`; empty profile negative-cached, fill-log rate-limited once per window — `etfFlagLogEvery`); `fix-etf-flag-fill.feature` "An empty FMP profile logs an unlabelled record and stays negative-cached" (tag not read). Reuse the shape, not the code.
- Per-key rate limiter → `staleCheckDue` / `lastStaleCheck` (`:343-352`, keyed `symbol|tf`) — closest in-service state-per-key precedent.
- New tunable key → `intGetter`/`resolvePositiveInt` pattern (`:986-1018`); register in `scripts/config-wiring.json` as `read-unseeded`, add a row to `services/xstockstrat-marketdata/CLAUDE.md` § Config Keys Consumed and the Per-Feature Registered Keys log in `docs/patterns/config-governance.md`; platform scenarios `@AC-1…@AC-11 @feature-278` gate new keys (wiring-check reader + test).
- Tests → `TestIngestRecentBars_WarnsOncePerCycleForSymbolsWithoutBars` (`marketdata_service_test.go:1156`), `…LogsHeartbeatEveryCycle` (`:1204`), `installWarnRecorder` (`:1916`), `installLogRecorder` (`:1907`), fakes `fakeBackfillSource` (`:900`), `fakeEmptyMultiSource` (`:1139`), `fakeMultiSource` (`:1298`), `fakeCfg` (`:281`). Tests build `&MarketDataService{}` / `&MarketDataService{warmSymbols: …}` with nil maps — **new state fields must tolerate zero-value construction** (lazy-init / nil-guard).
- C-13: fakes are inline in the test file today; one consumer stays inline.

## Existing Business Rules (preserve / extend)

No durable `@AC-*` covers the bar ingester, the warm set, the GetBars live-fallback→cache→re-read path, or the analysis live loop's "no 1d bars" handling — those exist only as prose invariants (CLAUDE.md, `services/xstockstrat-marketdata/docs/context-constitution.md`). New `@AC-*` for them go in this feature's `acceptance.feature`. No EXTEND, no CHANGE. Closest guarantees (all PRESERVE):

- `@AC-3 @FR-2 @feature-191` "BatchGetBars omits symbols with no stored bars" (`services/xstockstrat-marketdata/acceptance/opportunities-latency-fix.feature`) — null-not-zero; a dead symbol is never fabricated.
- `@AC-53 @FR-5`, `@AC-54 @FR-5 @feature-240` (`…/offline-account-full-pnl.feature`) — strict mode still fails INTERNAL on a live-fetch error; allow_partial returns stored bars. A back-off short-circuiting a cold fetch that today errors would alter `@AC-53` (would be a CHANGE needing sign-off).
- `@AC-3 @FR-3 @feature-178` (`…/quote-fanout-batching.feature`) — single-flight coalescing intact for live symbols.
- `@AC-8 @FR-2 @feature-196` (`…/proto-deprecated-field-removal-program.feature`), `@AC-1 @feature-153` (`…/fix-ohlcv-chunk-lock-oom.feature`) — ingester persistence shape and chunk-lock budget (no new per-cycle ohlcv scans).
- Analysis consumers (`services/xstockstrat-analysis/acceptance/`): `@AC-1/@AC-5/@AC-8/@AC-2 @FR-1/FR-5 @feature-185` (`opportunity-compute-robustness.feature`) — failing/empty bars still yield the data-unavailable sentinel; **recovery requires marketdata to re-serve a symbol once it has bars, so any "dead" state must clear on recovery**; `@AC-13 @feature-215`, `@AC-2 @feature-181`, `@AC-2 @feature-275` (a GetBars RPC error must reach the caller, never become an empty success), `@AC-4/@AC-7 @feature-272` (GetBars pagination semantics).
- **Pending, not durable — feature 282** (`docs/roadmap/features/282-filter-otc-symbols/acceptance.feature`, 26 scenarios, status `implementation-ready`, **not implemented**): treat as binding intent — `@AC-4` (unservable GetBars: 0 live fetches, not warmed), `@AC-9` (unloaded asset set does not block warming; one WARN on entering that state), `@AC-15` (first successful asset load prunes unservable symbols), `@AC-16/17/26` (quote/price paths ungated; held unservable symbols stay warm and valued).
- Note: nothing guards the analysis live loop's reaction to a symbol with no bars — leave the GetBars/BatchGetBars response contract unchanged (recommended) or add an `@AC`.

## Dependencies

- Proto/RPC: none (no response-contract change)
- Migration: none
- Config keys: probably 1–2 new unseeded `marketdata.stream.*` keys if back-off is tunable (F-07: no hardcoded thresholds) — decision for the debate; registration via `scripts/config-wiring.json` + CLAUDE.md row + config-governance log
- Inter-service edges: none new
- New env vars / ports: none

## Risks / Not-found

- **Cause unknown.** No code or doc explains why LXP/PSKY (real listings) return no bars on `feed=iex`/`adjustment=all`; `GetBarsMulti` cannot distinguish "no IEX trades" from "bad symbol" (absent key either way). Weak hints: PSKY "bars stale since 2026-10-05" (`docs/roadmap/features/240-offline-account-full-pnl/context.md:1090`), PSKY has an SEC CIK (recent filer, likely rename); 282 context records AXIA/EVTV/LRHC/PSKY as "no Webull row, FMP major exchange". Verification needs live Alpaca calls (`/v2/assets/{sym}`, `/v2/stocks/bars` iex vs sip) — not available here. The fix should be correct whatever the cause (back-off is cause-agnostic).
- **Overlap with feature 282** (in-flight, same warm-set/`markWarm`/GetBars region at `:262`, `:748-750`, `:867-869`): 282 filters by Alpaca asset-list membership/OTC, not data availability; its R6 (`design.md:59`) names "re-warmed held unservable symbols keep producing ingester no-bars noise", and 282 context notes a negative-cache follow-up. 291 must not re-add unservable symbols or break 282 AC-16/17/26; merge order / conflict on `markWarm` is a coordination risk. 282's design excludes a negative cache — this is that follow-up.
- Held offline positions must stay valued (282 AC-17/26; 240 offline valuation): a held dead symbol still has to be priceable via the quote path and last-close — backing off the **bar ingester** must not stop quote/price serving.
- **Not found:** any eviction/aging/negative-cache/backoff for symbols with no data; any 282 implementation (`asset_servability.go`, `markWarmIfServable`, `GetSymbolServability`); symbol normalisation (uppercase/trim) in `GetBarsMulti`/`markWarm`; any test running `ingestRecentBars` end-to-end or the poller loops; where SetConfig bounds are declared (not searched).
- Also in play: `GetBars` live-refetch-on-every-call for no-stored-bars symbols (`:313-332`) is the second source of dead-symbol vendor calls (952 `GetBars: no bars stored…` lines in a 2-day burst, BOSSY/CRTD/DNB/FORL) — in scope? decide at the gate.
- No `fails.md`/`insights.md` entry specific to ingester backoff found.

## Recommended Scope

1. Ingester back-off/negative-cache for symbols that return no bars for N consecutive cycles (state in the ingester, tolerant of zero-value service construction), cleared when bars return; report once per state change instead of per cycle; heartbeat INFO unchanged.
2. Decide at the gate: whether `GetBars` miss-path refetch is rate-limited too (same state), and whether thresholds are config keys (1–2 unseeded keys) or fixed invariants (operator-approved style, as in feature 229).
3. Tests: ingester table test with consecutive-empty cycles → back-off → recovery; `reportIngestCycle` once-per-transition WARN; zero-value-service safety.
