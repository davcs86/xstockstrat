# Design: fix-marketdata-miss-path-noise

**Created**: 2026-11-20
**Rounds**: 3 (full; termination: approved)
**Approved by**: user @ 2026-11-20 (operator approval at the design gate; Floor clear)
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

Three parts. (A) and (C) quiet cancel-caused WARNs. (B) adds a negative cache to the `GetBars` miss path. All
three ship: the operator ruled KEEP on (B) at the design gate (context.md, Session 2026-11-20).

The change is internal-only. It alters logging and one in-process cache in two backend services, and reaches
no UI segment or Agent tool (C-14).

Citations: `recon.md` means the path:line is in recon.md § Codebase Map or § Patterns to REUSE. A line marked
*(debate)* was verified during the debate rounds (debate.md row named) and is not in recon.md; `/sdd-spec`
re-greps it. Marketdata paths are under `services/xstockstrat-marketdata/internal/service/` and portfolio paths
under `services/xstockstrat-portfolio/internal/service/`.

### (A) Marketdata cancel-quiet (D-1)

- Add `warnUnlessDone(ctx, msg, args...)`. It logs WARN on a live ctx, and Debug with `ctx_done` when ctx is done.
- Apply it at these `marketdata_service.go` sites (recon.md):
  - `:411` `GetBars: live fetch failed` (AC-1);
  - `:431` and `:438`, the re-read after cache;
  - `:630` `GetLatestQuote: cache insert failed`;
  - `:1409`, `:1413`, `:1421` and `:1429`, the bar-ingest WARNs.
- `ingestRecentBarsForTimeframe` (`marketdata_service.go:1393`, recon.md) returns early on `ctx.Err()`.
- The warm poller is unchanged: `:1239` and `:1263` are already Debug and `:1286` is a load-bearing aggregate
  WARN (recon.md).
- `:422` `GetBars: cache insert failed` is unchanged (recon.md), so `@AC-8` and `@AC-11 @feature-290` hold.
- AC-1 test: a cancel logs no WARN, and a non-cancel error on a live ctx still WARNs.

### (C) Portfolio cancel-quiet (D-2)

- `processAccountDeregistered` (`portfolio_service.go:1540`, recon.md) uses the feature-290 `stop` closure
  (`:1618`, recon.md) and returns `ctx.Err()`.
- `processBracketUpdate` (WARN at `:1706`) and `processBalanceSync` (WARN at `:1765`) log Debug on a done ctx.
  Both stay void and stay `ackAlways` (wired at `:1693` and `:1741`, recon.md), per R-2.
- `processOrderFill` is unchanged. It is wired at `:177` without `ackAlways` *(debate, O-9)*, so the product
  spec's order-fill site is stale and the docs step corrects it.
- Tests reuse `portfolio_sync_cancel_test.go` helpers `cancelingDB` `:16`, `warnCount` `:52` and `canceledCtx`
  `:58` (recon.md).

### (B) GetBars miss-path negative cache

State and key:

- New file `bars_miss.go` holds `missMu` and `lastEmptyFetch map[string]time.Time`, beside
  `staleMu`/`lastStaleCheck` (`marketdata_service.go:58-59`, recon.md).
- The constructor initialises the map. The writer also creates it when nil, for the `cacheBarsSvc` test fixture
  *(debate, O-7)*.
- The key is raw `req.Symbol+"|"+canonicalTf`. This is the form `staleCheckDue` uses (`:367-376`, recon.md) and
  the same strings passed to the read and the fetch at `:327`, `:329` and `:350` *(debate, O-3)*.

Wiring:

- `liveRefetch` is extracted from the `:347-356` block (the guard is at `:347` and the WARN at `:353`, recon.md).
  It takes an explicit `implicitFirstPage bool`. Only `startImplicit && pageToken==""` consults or writes the
  cache, so explicit-range and backtest reads always fetch (O-2, O-19).
- `missFetchDue(key, window, now)` takes an injected `now`, as `staleCheckDue(…, now)` does (recon.md). It
  checks the entry without reserving it.
- `fetchAndCacheBars` (`:403`, recon.md) returns a named `barsFetch{bars, token, confirmedEmpty}`.
  `confirmedEmpty` is `err==nil && len==0 && ctx.Err()==nil` (D-3). Its callers are `:350` and the test helper
  shared by the `TestFetchAndCacheBars_*` tests *(debate, O-16)*.
- `noteMissResult` is the only writer:
  - it sets the entry on a confirmed empty;
  - it deletes the entry when a fetch returns bars;
  - it does nothing on an error or a cancel;
  - while it holds the lock, it sweeps entries older than the window.
- The hit path (stored bars, fresh or stale) never takes `missMu` (O-18, R-4). The stale branch (`:339-346`,
  recon.md) never touches an entry.
- The WARN fires only on a change into the empty state, meaning there was no prior entry. A refetch after the
  window logs Debug.
- Window `<=0` (D-4): `missFetchDue` always returns true, `noteMissResult` is skipped and the map is cleared,
  mirroring `bar_hold.go:50-51` *(debate, D-4)*. Every call then fetches and WARNs as before the fix.
- `BatchGetBars` is untouched.

Accepted behaviour, stated per O-12 and O-14:

- **Herd.** N concurrent cold first calls for one servable-but-empty symbol can each make one vendor call,
  because the check does not reserve. Once a confirmed empty lands, the window suppresses later calls. AC-2 is
  sequential. Reserve-with-rollback is the fallback if a one-call-under-concurrency guarantee is ever wanted.
- **Honest value.** (B) saves one Alpaca `GetBars` call per implicit miss inside the window. It does not save
  warming through `markWarmIfServable` (`asset_servability.go:81`, recon.md) or ingester polling. The WARN fires
  once per change into the empty state.

Tests:

- AC-2, sequential: three calls inside the window make one vendor call and log at most one WARN.
- Window-expiry positive control: an entry older than the window (through the injected `now`) leads to exactly
  one more vendor call and a Debug line, not a WARN.
- Disabled control (window `0`): every call fetches and every call WARNs.
- Scope negative control: an explicit-range miss with a live entry still fetches.
- Cancel-plus-empty red test, using `barsCancelSource` with a call counter taken at entry *(debate, O-6/O-7)*.
- `TestGetBarsWarnsWhenMissAndLiveFetchEmpty` (`marketdata_service_test.go:1273`, recon.md) is retargeted onto
  `liveRefetch` and pinned by name.

### Config key, seed and bounds

- Key: namespace `marketdata`, key `bars.miss_backoff_ms`, `int`, default `1800000`, bounds `[0, 21600000]`.
- Reader: `resolveBarsMissBackoff(s.budgetCfg)`, read live on each miss.
- `resolveBarIngestBackoff` (`bar_hold.go:35`, recon.md) becomes a wrapper over a shared `resolveOffMs` only if
  its signature, `bar_hold_test.go` and the `:1395` caller (recon.md) stay byte-identical. Otherwise the new key
  gets a parallel reader (O-15).
- Seed (D-5), modelled on `048_webhook_fanout_callback_keys.up.sql:4-43` *(debate, O-10)*:
  - two rows, staging and production: `('marketdata','bars.miss_backoff_ms','int','1800000',<desc>,'1800000',
    'xstockstrat-marketdata','system:config-migration-feature-fix-marketdata-miss-path-noise',env,NULL)`;
  - `ON CONFLICT (namespace,key,environment,COALESCE(user_id,'')) DO NOTHING`;
  - the down migration deletes only rows carrying the sentinel;
  - the number is at least `049`, taken as max+1 at merge.
- Bounds: add `'marketdata.bars.miss_backoff_ms'` beside `configServiceImpl.ts:163`. It resolves through the
  `${namespace}.${key}` lookup at `:182`. Add a test row beside `setConfigScalarBounds.test.ts:283`
  *(debate, O-10)*.
- Seed test (O-17):
  - Write a bespoke test on `src/__tests__/migrationSql.ts`: `findOne('_marketdata_bars_miss_backoff',
    'up'|'down')` (`:8`) and `splitStatements` (`:19`) *(debate, O-17)*.
  - Assert the relative key, fail on the FQN, and assert value_type `int`, the sentinel and the sentinel-filtered
    down migration.
  - Do not clone `barIngestBackoffSeedMigration.test.ts`.
  - Do not reuse `globalIntSeedCases.ts` unchanged. Extending it is allowed only if its two existing suites stay
    byte-identical.
- The seed, bounds, reader and tests land in one commit, gated by
  `node scripts/check-config-wiring.mjs --keys marketdata.bars.miss_backoff_ms --final`.
- Overlap scan (O-20), before allocating the number and again after every main-dev merge:
  - `git log --all -- 'services/xstockstrat-config/migrations/049*'` (and higher);
  - a grep of sibling `origin/feature/*` branches for the `bars.miss_backoff_ms` (namespace, key) string,
    especially the fix-live-enrich-ttl-seed and fix-trading-config-plumbing peers.

### Gate outcome (O-1, O-11)

Both blocking objections were closed by operator decision on 2026-11-20 (context.md, Session 2026-11-20):

- **O-1.** The volume-only gate (D-6) was run in Grafana Cloud Loki. In the defined window (2026-11-06 to
  2026-11-12) it returned 0 hits, which alone reads DROP. After that window, the 24h window ending
  2026-11-16T00:00Z had six symbols at or above the threshold of 10 (NAVI 12, PLAB 12, PLBY 12, EPRT 11, EXR 11,
  FICO 11). The operator ruled KEEP on that evidence, knowing what the defined window showed.
- **O-11.** Option (1) KEEP: (B) is built as designed and AC-2 stays, with no acceptance change.

### Build order

Each step is red before green, and each helper lands with its production caller.

1. (A) with the AC-1 tests.
2. (C) with its tests (D-7).
3. (B) in one commit: seed, bounds, tests, the `resolveOffMs` wrapper, `bars_miss.go`, `liveRefetch` wired at
   `:347`, `barsFetch`, and the retargeted structural test.
4. Docs:
   - the marketdata `CLAUDE.md` key table and GetBars bullet;
   - the portfolio `CLAUDE.md` cancel-stop note;
   - `config-governance.md` registered keys;
   - the product-spec order-fill correction (O-9).

## Rejected Alternatives

- `R-1` Using `timeframe.Interval(canonicalTf)` as the GetBars miss window — rejected because a window that
  decides staleness must be a config key (F-07; insight 2026-11-04 fix-marketdata-dead-symbol-ingest).
- `R-2` Returning `ctx.Err()` from `processBracketUpdate` or `processBalanceSync` — rejected because it moves
  feature 294's consumer outcome series from acked to error.
- `R-3` Cross-checking the O-1 gate's symbols with `GetSymbolServability` — rejected because every post-282
  miss WARN is already servability-filtered by `:347`, and the RPC is unreachable from the agent.
- `R-4` Deleting the negative-cache entry on every first-page implicit read that finds stored bars — rejected
  because it adds a lock to the lock-free hit path and contradicts the stale-branch no-touch rule;
  `noteMissResult` deletion plus a writer sweep covers the same cleanup.

## Open Risks

- [ ] The KEEP evidence sits outside the gate's defined window, and the flood is bursty (2177 hits over 7 days,
  then 1-3 per day). (B)'s saving may be small in a quiet period — to be re-checked in Loki at the dev
  smoke test after build step 3.
- [ ] Concurrent cold first calls can each make one vendor call (the accepted herd), bounded by the number of
  concurrent callers — to be stated in the marketdata `CLAUDE.md` GetBars bullet at build step 4.
- [ ] A window of up to 30 min can delay the first live fetch for a symbol that becomes populated outside the
  ingester's warm lookback — covered by the window-expiry positive control at build step 3; `0` is the rollback
  lever.
- [ ] Peer features may claim config migration numbers at `049` or above, or the same key — the overlap scan
  (O-20) runs at `/sdd-spec` and again after each main-dev merge before build step 3.
- [ ] Peers may edit `fetchAndCacheBars` before merge — re-grep at `/sdd-spec` and before build step 3.
- [ ] Lines marked *(debate)* are not in recon.md — `/sdd-spec` re-greps each before citing it in a step.

## Constitution Rules Touched

- `C-05` — honored by: the miss window is a config key read through the config service, with no hardcoded value.
- `C-07` — honored by: the seed number is max+1 at merge, with the O-20 overlap scan over migration numbers and
  the (namespace, key) string.
- `C-11` — honored by: full-mode design debate of 3 rounds, approved at the gate before any code.
- `C-13` — honored by: tests reuse the existing fakes and helpers; `barsCancelSource` relocates to the canonical
  fixture home if it gains a second consumer.
- `C-15` — honored by: AC-1 and AC-2 are red-before-green regression scenarios; AC-2 stays unchanged by operator
  decision O-11.
- `C-16` — honored by: the Business Rules list below; no existing guarantee is altered.
- `C-18` — honored by: the seed test builds on the shared `migrationSql.ts` helpers, the reader shares
  `resolveOffMs` where byte-identity allows, and the hit path gains no lock.
- `P-02` — honored by: every proposer and adversary exchange was mediated through the synthesized state.
- `P-03` — honored by: unverified items stay marked *(debate)* or listed in Open Risks, not guessed.
- `P-06` — honored by: an entry is recorded only on a confirmed empty (D-3), with positive, disabled and scope
  controls so a never-fetches implementation cannot pass.
- `F-07` — honored: the window is the seeded, bounded key `bars.miss_backoff_ms`, not a code constant (R-1).

No Floor breach was raised in any round.

## Business Rules Touched (C-16)

- PRESERVE `@AC-1` "a GetBars live fetch aborted by client cancellation logs no WARN" (this feature's
  `acceptance.feature`) — not regressed by: `warnUnlessDone` at `:411`, with the live-ctx negative control.
- CHANGE `@AC-2` "repeated GetBars for a symbol with no data performs one live fetch" (this feature's
  `acceptance.feature`) — the debate classed (B) as a CHANGE to GetBars miss behaviour. Operator decision O-11
  (2026-11-20, design gate; context.md Session 2026-11-20): option (1) KEEP, (B) is built as designed and the
  scenario text stays as written. The expiry, disabled and scope controls land as tests, not as scenario edits.
- PRESERVE `@AC-4 @feature-282` "GetBars for an unservable symbol does not trigger a live fetch or warm the
  symbol" (`services/xstockstrat-marketdata/acceptance/filter-otc-symbols.feature`) — not regressed by: the
  servability gate at `:347` stays first; the cache covers only servable-but-empty symbols.
- PRESERVE `@AC-9 @feature-282` "An asset set that has never loaded does not block GetBars or warming" — not
  regressed by: the first call still fetches; only a confirmed empty suppresses later calls.
- PRESERVE `@AC-12 @feature-282` "Strict BatchGetBars omits unservable cold symbols without a live fetch" — not
  regressed by: `BatchGetBars` is untouched.
- PRESERVE `@AC-14 @feature-282` "Partial BatchGetBars still fetches servable cold symbols within the deadline"
  — not regressed by: the cache is not shared with `BatchGetBars`.
- PRESERVE `@AC-23 @feature-282` "Symbols are normalized before classification" — not regressed by: the key is
  the same raw `req.Symbol` string used by the read and the fetch, so key and fetch cannot diverge (O-3).
- PRESERVE `@AC-8 @feature-290` "A genuine cache-insert failure with a live client still warns and returns the
  live page" (`services/xstockstrat-marketdata/acceptance/fix-ctx-cancel-warn-flood.feature`) — not regressed
  by: `:422` is left alone.
- PRESERVE `@AC-11 @feature-290` "A genuine cache-insert failure after the client has left still warns" — not
  regressed by: `:422` is left alone.
- PRESERVE `@AC-2 @feature-191` "BatchGetBars returns bars for multiple symbols in one call"
  (`services/xstockstrat-marketdata/acceptance/opportunities-latency-fix.feature`) — not regressed by:
  `BatchGetBars` is untouched.
- PRESERVE `@AC-3 @feature-191` "BatchGetBars omits symbols with no stored bars" — not regressed by:
  `BatchGetBars` is untouched.
- PRESERVE `@AC-2 @feature-256` "A failed offline-realized delete on deregistration is retried"
  (`services/xstockstrat-portfolio/acceptance/fix-offline-book-consistency.feature`) — not regressed by: a
  genuine failure on a live ctx still WARNs and returns the joined error; only a done ctx returns `ctx.Err()`,
  which is classed transient and never parked (`portfolio_service.go:1482`, recon.md).
