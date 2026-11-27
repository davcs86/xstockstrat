# Implementation Spec: fix-marketdata-miss-path-noise

**Status**: `pending`
**Created**: 2026-11-20
**Feature**: `docs/roadmap/features/317-fix-marketdata-miss-path-noise/feature.md`
**Total Steps**: 11
**Feature Branch**: `feature/fix-marketdata-miss-path-noise`
**Severity**: SEV-3

---

## Execution Summary

The build follows design.md § Build order (D-7): (A) marketdata cancel-quiet, (C) portfolio cancel-quiet, (B) the
`GetBars` miss-path negative cache with its seeded window key, then docs. Every code-bearing pair is numbered
test-first (fails.md 2026-11-10 fix-marketdata-dead-symbol-ingest: the executor follows step numbers) and lands
as one atomic unit, because a RED test step cannot pass its own Verification alone.

| Unit | Steps | Part | Commit |
|---|---|---|---|
| A | 1 + 2 | marketdata `warnUnlessDone` at the cancel-caused WARN sites; ingest early return | one |
| C | 3 + 4 | portfolio `processAccountDeregistered` stop closure; bracket / balance Debug on a done ctx | one |
| B1 | 5 + 6 | `SetConfig` bounds for `marketdata` / `bars.miss_backoff_ms` | one |
| B2 | 7 + 8 + 9 + 10 | seed migration, miss cache, reader, `liveRefetch`, `barsFetch` | one |
| — | 11 | docs | one |

**Evidence tree.** Every `path:line` below was read on `origin/main-dev` @ `36aed60b`. The feature branch
(`origin/feature/fix-marketdata-miss-path-noise` @ `52f410ca`, merge-base `c4fd48b0`) is 166 commits behind it and
was not merged at spec time: this spec run may write only inside the feature directory, so
`docs/sdd/tree-freshness.md`'s sync is deferred to `/sdd-execute` BRANCH SYNC (see § Step Dependencies,
precondition). recon.md and design.md cite `c4fd48b0`, so these anchors moved:

| Anchor | recon / design | `36aed60b` |
|---|---|---|
| `staleMu` / `lastStaleCheck` fields; constructor init | `:58-59`; `:239` | `marketdata_service.go:59-60`; `:246` |
| `GetBars`; `markWarmIfServable` call | `:264`; `:281` | `:271`; `:288` |
| `refetch := len(bars) == 0`; stale branch; live-fetch guard; miss WARN | `:338`; `:339-346`; `:347`; `:353` | `:345`; `:346-353`; `:354`; `:360` |
| `staleCheckDue` | `:367-376` | `:372-383` |
| `fetchAndCacheBars`; live-fetch WARN; cache-insert WARN; re-read WARNs | `:403`; `:411`; `:422`; `:431`/`:438` | `:410`; `:418`; `:429`; `:438`/`:445` |
| `GetLatestQuote: cache insert failed` | `:630` | `:637` |
| warm-poller Debug lines; aggregate WARN | `:1239`/`:1263`; `:1286` | `:1249`/`:1277`; `:1300` |
| `ingestRecentBarsForTimeframe`; `resolveBarIngestBackoff` call | `:1393`; `:1395` | `:1410`; `:1412` |
| bar-ingest WARNs | `:1409`/`:1413`/`:1421`/`:1429` | `:1433`/`:1437`/`:1449`/`:1457` |
| portfolio `processOrderFill` wiring; `ackAlways`; `observed` | `:177`; `:185`; `:231` | `portfolio_service.go:180`; `:188`; `:234` |
| retry classification | `:1482` | `:1511` |
| `processAccountDeregistered`; its two WARNs; `errors.Join` | `:1540`; `:1566`/`:1570`; `:1573` | `:1569`; `:1595`/`:1599`; `:1602` |
| feature-290 `stop` closure | `:1618` | `:1646-1649` |
| bracket wiring / handler / WARN | `:1693`/`:1696`/`:1706` | `:1722`/`:1725`/`:1735` |
| balance wiring / handler / WARN | `:1741`/`:1744`/`:1765` | `:1770`/`:1773`/`:1794` |
| config bounds neighbour; lookup; bounds test row | `configServiceImpl.ts:163`; `:182`; `setConfigScalarBounds.test.ts:283` | `:163`; `:187`; `:283` |
| marketdata tests: `TestStaleCheckDue`; `TestGetBarsMarksSymbolWarm`; `TestGetBarsWarnsWhenMissAndLiveFetchEmpty`; `funcBody` | `:1164`; `:1252`; `:1273`; `:1378` | `marketdata_service_test.go:1165`; `:1253`; `:1274`; `:1379` |
| `fakeBarsStore`; `recordingBarsStore`; `cacheBarsSvc`; shared `fetchAndCacheBars` test helper | `:4214`; `:5400`; `:5447`; `:5456` | `:4677`; `:5863`; `:5907`; `:5919` (`fetchAAPLDaily`) |

Two things changed in substance, not only in line number:

- `ingestRecentBarsForTimeframe` now takes two contexts, `(ctx, fetchCtx context.Context, …)`
  (`marketdata_service.go:1410`), and has a new fetch-deadline WARN `bar ingest: cycle deadline passed, timeframe
  not fetched` (`:1422`). D-1's early return and `warnUnlessDone` key on `ctx`, the process context. `fetchCtx`
  expiring on a live process is a genuine failure and keeps its WARNs (feature 291 `@AC-5`).
- The marketdata `GetBars` prose and the portfolio cancel-stop prose no longer live in the two service
  `CLAUDE.md` files. They are in `services/xstockstrat-marketdata/docs/alpaca-integration.md:9`,
  `services/xstockstrat-marketdata/docs/context-constitution.md:17,22` (MARKETDATA-3, MARKETDATA-8) and
  `services/xstockstrat-portfolio/docs/context-constitution.md:16` (PORTFOLIO-3). Step 11 edits the text where it
  lives.

**Consumer surface (C-14).** None — internal and platform-only (design.md § Chosen Approach). The change alters
logging and one in-process cache in two backend services and reaches no UI segment and no Agent tool. Explicit
range reads (backtests, `run_backtest`) never consult the cache, so the `strat-lab` plugin is unaffected.

**Trading domain (step-constraints §A).** `xstockstrat-portfolio` is affected, but no step touches
`TRADING_MODE`, broker dispatch, order types, order placement or fill processing. Broker coverage, order-type
handling and fill handling are unaffected by every step; `processOrderFill` is not edited (design (C)).

**Proto / service-schema migrations.** None. The only migration is one config seed (Step 8).

## Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` a GetBars live fetch aborted by client cancellation logs no WARN | Step 1 (`TestFetchAndCacheBars_AC1_*`), made green by Step 2 |
| `@AC-2` repeated GetBars for a symbol with no data performs one live fetch | Step 9 (`TestLiveRefetch_AC2_ThreeCallsOneVendorFetchOneWarn`), made green by Step 10 |

`@AC-2` stays as written by operator decision O-11 (2026-11-20, KEEP). The expiry, disabled and scope controls
land as tests in Step 9, not as scenario edits.

## Spec-time decisions to confirm at `/sdd-review impl-spec`

These are places where discovery forced a choice design.md did not spell out. None reopens a settled decision
or a rejected alternative. Operator rulings of 2026-11-21 (context.md, "operator rulings on the four spec-time
choices"): decisions 1, 3 and 4 are **confirmed as specced**; decision 2 is **overridden** (see it below).
Decisions 5 and 6 were not put to the operator and stay open for `/sdd-review impl-spec`.

1. **(B) is two commits, not one.** *(Confirmed by the operator, 2026-11-21.)* design.md asks for seed, bounds, reader and tests in one commit. That is
   five steps, above the four-step cap of `step-constraints.md` §C. The seam is the bounds registry entry
   (unit B1, Steps 5 + 6): it passes its own Verification alone and lands first, so no commit ever holds the
   seeded key without its write bounds. The design's gate, `check-config-wiring.mjs … --final`, stays on unit B2.
2. **`resolveBarsMissBackoff` is a parallel reader in `bars_miss.go`, with exactly one `scripts/config-wiring.json`
   receiver entry; there is no `resolveOffMs` wrapper.** *(Overridden by the operator: 2026-11-21 "Use the parallel
   reader fallback"; 2026-11-26 "bars_miss.go, one receiver entry".)* The earlier spec added a `resolveOffMs`
   wrapper plus one forwarder and two receiver entries. That is dropped; design.md O-15's "otherwise a parallel
   reader" branch is taken, and `resolveBarIngestBackoff` and `bar_hold.go` are not touched. The gate attributes a
   read through `registry.receivers["<file>:<receiver>"]` (`scripts/check-config-wiring.mjs:547-552`); a
   `cfg.GetInt(barsMissBackoffKey, …)` in `bars_miss.go` is `unattributed` without an entry, so the one entry
   `"services/xstockstrat-marketdata/internal/service/bars_miss.go:cfg": "marketdata"` is added. Prototyped on a
   scratch copy of `origin/main-dev` @ `2b2dec92` (gate files byte-identical to `36aed60b`), with the key's two
   seed rows in the scratch stored set: `node scripts/check-config-wiring.mjs --final` exit 0 and `node --test
   scripts/config-wiring.test.mjs` 75/75 pass. Accepted costs: about eight lines duplicated from
   `resolveBarIngestBackoff` (below jscpd's 100-token floor, `.jscpd.json:4`; the O-15 exception to design.md's
   C-18 line), and one more edit to a file `345-authelia-sso` also edits.
3. **The miss line goes through `warnUnlessDone`.** *(Confirmed by the operator, 2026-11-21.)* design.md lists the (A) sites and does not list the miss
   WARN (`:360`). After (B) it sits in `liveRefetch`. Left as a plain WARN, a client cancel on an implicit miss
   would still log one WARN per cancelled call, which is the noise `@AC-1` removes. Step 10 logs it with
   `warnUnlessDone`, so a done ctx gets Debug and a live ctx keeps the WARN.
4. **`UpdatePositionBracket` moves from `r.pool.Exec` to `r.db.Exec`** *(Confirmed by the operator, 2026-11-21.)* (`portfolio_repo.go:379`). design (C)
   asks for the bracket test to reuse `cancelingDB`. That fake reaches the repo only through `r.db`
   (`NewPortfolioRepoWithDB`, `portfolio_repo.go:50-52`), and `r.pool` is nil there, so the handler panics before
   it can log. In production `db` is the pool (`:46`), so behaviour is identical.
5. **Sweep versus "Debug after the window".** `noteMissResult` sweeps entries older than the window while it
   holds the lock (O-18), and the WARN fires only when no entry exists (design (B)). An expired entry swept by
   another key's write therefore makes that symbol's next empty refetch WARN again instead of logging Debug.
   The WARN is once per change into the empty state as far as the map remembers. Step 9's expiry control uses a
   single key, so no sweep interferes, and `TestLiveRefetch_CrossKeySweep_ExpiredEntryWarnsAgain` (Step 9) pins
   the cross-key case so the behaviour cannot change unnoticed. This follows design.md literally; a longer
   sweep horizon would be a design change.
6. **The migration number is `056`, provisional.** See § Step Dependencies, merge checklist.

## Step Dependencies

- **Precondition before Step 1 (`/sdd-execute` BRANCH SYNC).** Merge `origin/main-dev` into
  `feature/fix-marketdata-miss-path-noise`. Every anchor in this spec is a `36aed60b` line; the branch tree
  (`c4fd48b0`) lacks config migrations `048`–`055`, the two-context `ingestRecentBarsForTimeframe` and the
  current `scripts/config-wiring-stored.json`. After the merge, re-grep each step's anchors before editing; a
  moved line is not a deviation, a missing symbol is (F-04).
- **Steps 1 + 2 land together** (`step-constraints.md` §C: "adds a test that references a symbol a later step
  creates"). Step 1 unit-tests `warnUnlessDone`, which Step 2 creates. Both are backend.
- **Steps 3 + 4 land together** (§C: a step must pass its own Verification on the tree before it). Step 3's
  tests are RED until Step 4; the two bracket tests panic on the nil `r.pool` until Step 4's repo seam. Both
  are backend.
- **Steps 5 + 6 land together** (§C, same reason). Step 5's "rejects just outside" case is RED until Step 6
  adds the bounds entry. Both are backend.
- **Steps 7 + 8 + 9 + 10 land together** (§C: "seeds a config key (migration) → the reader step and its
  wiring test"; "changes a … return shape … in a package whose build compiles tests"; "adds a test that
  references a symbol a later step creates"). All four are backend.
  - Step 8's seed without Step 10's reader is a `seeded-unread` finding under `--final`.
  - Step 10's reader is unexported and needs its production caller in the same commit (fails.md 2026-11-10
    filter-otc-symbols).
  - Step 10 changes `fetchAndCacheBars`' return shape. The only callers are `marketdata_service.go:357` and
    the test helper `fetchAAPLDaily` (`marketdata_service_test.go:5919`), which Step 9 edits.
  - Step 7 resolves the migration by suffix and is RED until Step 8's files exist.
- **Steps 5 + 6 before Steps 7–10.** The key must have its write bounds before it is seeded.
- **Steps 3 + 4 need nothing from Steps 1 + 2** (different service). They come second because D-7 fixes the
  build order.
- **Step 9 requires Step 1.** Step 1 adds the `err` field to `barsCancelSource`; Step 9 adds `calls` to the
  same fake and reuses `err`.
- **Step 11 requires Steps 2, 4 and 10.** It documents their behaviour. The docs name the migration by its
  number-free suffix, so a renumber does not touch them.
- **RED capture per unit (insights.md 2026-11-10 fix-ctx-cancel-warn-flood — ordering).** Write the test step,
  run each new test alone with `-run '<Test>$'`, and record the failure before the service step. Where a test
  names a symbol the service step creates (`warnUnlessDone`, `liveRefetch`, `missFetchDue`, `noteMissResult`,
  `resolveBarsMissBackoff`, `barsFetch`), a throwaway stub file declaring the symbol turns the package-wide
  compile failure into a per-test failure; delete the stub before the commit. Each test step names the
  predicted failure mode.
- **Step 8 needs a reachable Postgres plus `psql` and `migrate` on `PATH`** to regenerate
  `scripts/config-wiring-stored.json` (`scripts/config-wiring-stored.py:4-5`). This is artifact generation, not
  verification. CI job `config-wiring-stored` builds the same toolchain from `scripts/Dockerfile.migrate`
  (`.github/workflows/ci.yml:1323-1374`) and uploads the regenerated file as artifact `config-wiring-stored`
  even when its freshness diff fails. If no local Postgres is available, commit that artifact unedited and
  record the run URL in `context.md`. The JSON is never written by hand. If neither route works, Step 8 is
  blocked (P-03).
  - **Preflight before Step 7 (the first step of unit B2).** Confirm which of the two routes is available and
    record it in `context.md`. Unit B2 is one commit, so starting it with neither route leaves Steps 7, 9 and
    10 written and uncommittable.
- **Merge checklist — migration number and key overlap (O-20; fails.md 2026-11-10
  fix-marketdata-dead-symbol-ingest — migration).** Run before unit B2 and again after every `origin/main-dev`
  merge into the branch.
  1. `git fetch origin`.
  2. `git log --all --oneline -- 'services/xstockstrat-config/migrations/056*' 'services/xstockstrat-config/migrations/057*' 'services/xstockstrat-config/migrations/058*'`.
  3. `git log --all --oneline -S"miss_backoff_ms" -- services scripts docs/patterns` (the `(namespace, key)`
     string on any ref).
  4. The final number is max(`origin/main-dev` config migrations) + 1. golang-migrate never applies a version
     below the applied maximum.
  5. On a renumber: rename both files, regenerate `scripts/config-wiring-stored.json`, re-run Step 8's
     Verification. The file content, the test and the docs are number-free.
  6. Regenerate `scripts/config-wiring-stored.json` after any `origin/main-dev` merge that brings in another
     config migration: `inputs_sha256` hashes every config migration (`scripts/check-config-wiring.mjs:226`,
     `storedInputsSha256`).
  - Spec-time result (2026-11-20, `36aed60b`): the trunk tail is `055_analysis_live_enrich_ttl_reseed`; `053`
    was never used on any ref; commands 2 and 3 return nothing. `056` is free and no ref carries the key.
  - Peers that move the number or the hash (impl-spec review, 2026-11-20, read on `36aed60b`):
    `345-authelia-sso` plans a config migration as `053_authelia_sso_keys`
    (`docs/roadmap/features/345-authelia-sso/implementation-spec.md:223-224`), a number below the trunk tail,
    so it will be renumbered and can take `056` if it merges first. Both 345 (`:225`) and
    `330-fix-live-enrich-ttl-seed` (`implementation-spec.md:270`, already on trunk as `055`) regenerate
    `scripts/config-wiring-stored.json`. Whichever feature merges last regenerates it again (item 6).
- **Shared files with peers (file-level only, no key or number clash; impl-spec review 2026-11-20).**
  - `scripts/config-wiring.json`: `345-authelia-sso` also adds registry entries
    (`docs/roadmap/features/345-authelia-sso/implementation-spec.md:751`). This feature adds one receiver entry,
    `bars_miss.go:cfg`. The keys are disjoint; on a merge conflict keep both sets and re-run Step 10's two
    config-wiring commands.
  - `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go`: `323-fix-orphaned-code`
    (`product-spec.md:46`, `r.pool` at `:217,241,341`) and `311-fix-position-fold-correctness`
    (`product-spec.md:67`, `:66`) name other lines of this file. Step 4 changes line `:379` only.
- **`fetchAndCacheBars` peer edits (design open risk).** Spec-time
  `git log --all --since=2026-11-10 -G"fetchAndCacheBars|no bars stored and live fetch"` on
  `marketdata_service.go` finds only `e19bb53f` and `927c42de` (#1499, on trunk). Re-run before unit B2.
- **After the integration deploy (operator, not a step).** Read the key back per environment
  (`docs/runbooks/config-rollout.md` § Step 6). Re-run the O-1 Loki query at the dev smoke test and compare the
  miss-WARN volume (design open risk: the KEEP evidence is bursty).
- **Acceptance promotion (C-16).** `@AC-1` and `@AC-2` are promoted to
  `services/xstockstrat-marketdata/acceptance/` at integration by `/sdd-execute`, not by a step here.

---

### Step 1 — test: marketdata cancel-quiet regression tests (AC-1)

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/cancel_quiet_test.go` — create
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify (`barsCancelSource` only)

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence** (`services/xstockstrat-marketdata/internal/service/`, `36aed60b`):
- `barsCancelSource` at `marketdata_service_test.go:5839-5850`: fields `*fakeBackfillSource`, `newBars`,
  `cancel`; `GetBars` calls `f.cancel()` when set, then `return f.newBars(), nil`. It has no error field.
- `cacheBarsSvc` at `:5907` builds `&MarketDataService{registry: reg, barsStore: store}` (`s.repo` nil).
  `fetchAAPLDaily(ctx, svc)` at `:5918-5922` is the one test caller of `fetchAndCacheBars`.
- Log recorders: `installWarnRecorder` `:2065` (WARN only, `count(msg)` `:2044`, `find(msg)` `:2032`);
  `installWarmLogRecorder` `:5460` records every level with `recordedLog.level` (`:2008-2012`, `warmLogRecorder` `:5428`).
- Negative-control template: `TestFetchAndCacheBars_AC8_GenuineInsertFailureStillWarns` `:6047`.
- Ingest rig: `newBarHoldService` `bar_hold_test.go:116`, `newRecordingBarsSource` `:54` (fields `multiCalls`,
  `requested`, `multiErr`, `errs` `:45-52`), `bhTF` `:23`, `bhWindow` `:25`, `bhDMs` `:27`, `bhLive` `:37`,
  `bhSymbols` `:38`, `bhEnd` `:41`. Existing call shape: `bar_hold_test.go:768`.
- `barsBatchStore` interface (`QueryBarsBatch` + `InsertBars`) at `marketdata_service.go:149-152`;
  `recordingBarsStore{err: …}` implements it (`marketdata_service_test.go:5863-5886`).
- Structural-test helper `funcBody(t, src, signature)` at `:1379`; precedent `TestGetBarsMarksSymbolWarm` `:1253`.
- `GetLatestQuote` reads `s.repo.GetLatestQuote` first (`marketdata_service.go:622`) and the two re-reads call
  `s.repo.QueryRecentBars` / `s.repo.QueryBars` (`:436`, `:443`). `repo` is the concrete
  `*repository.MarketDataRepo` (`:41`), so those three sites have no behavioural seam: **Not found** — they are
  covered structurally, as `:1253` and `:1274` already do for `GetBars`.

**Lands with**: `Step 2`

**TDD**: `red-green required`

**Covers**: `AC-1`

**Instructions**:
1. In `marketdata_service_test.go`, add an `err error` field to `barsCancelSource` and make `GetBars` return
   `nil, f.err` after the optional `f.cancel()` when `f.err != nil`. Change nothing else in that file.
2. Create `cancel_quiet_test.go` (package `service`). No test calls `t.Parallel()`: `slog.SetDefault` is
   process-global (`marketdata_service_test.go:2000`). Every `fetchAndCacheBars` call goes through `fetchAAPLDaily`, so Step 10's
   return-shape change touches one helper only.
   - `TestFetchAndCacheBars_AC1_CanceledLiveFetchLogsNoWarn` — `@AC-1`. Source
     `barsCancelSource{fakeBackfillSource: &fakeBackfillSource{}, cancel: cancel, err: context.Canceled}`,
     recorder `installWarmLogRecorder`. Assert: no WARN-level record with message `GetBars: live fetch failed`;
     exactly one Debug-level record with that message and attribute `ctx_done` = `true`; no bars returned.
     Predicted RED: assertion (one WARN recorded).
   - `TestFetchAndCacheBars_AC1_LiveCtxFetchErrorStillWarns` — `@AC-1` negative control. `err:
     errors.New("alpaca: 500")`, live ctx: one WARN `GetBars: live fetch failed` with `symbol` = `AAPL`.
     Characterization: green before and after.
   - `TestFetchAndCacheBars_AC1_LiveCtxCanceledErrorStillWarns` — `err: context.Canceled` on a **live** ctx
     still WARNs, so the helper keys on ctx state, not error text (insights.md 2026-11-04
     fix-ctx-cancel-warn-flood). Characterization.
   - `TestWarnUnlessDone` — live ctx: one WARN with the message and the passed attributes, no `ctx_done`.
     Done ctx: no WARN, one Debug with the same message, the passed attributes and `ctx_done` = `true`.
     Predicted RED: compile failure (`warnUnlessDone` undefined) — use the stub method.
   - `TestIngestRecentBarsForTimeframe_DoneCtxReturnsBeforeFetch` — `newBarHoldService(bhDMs)`,
     `newRecordingBarsSource(bhLive...)`, a cancelled **process** ctx and `context.Background()` as `fetchCtx`.
     Assert `src.multiCalls == 0`, `len(src.requested[0]) == 0`, zero log records at any level, and no hold
     entry. Predicted RED: assertion (the vendor is called and `bar ingest: cycle complete` is logged).
   - `TestIngestRecentBarsForTimeframe_CancelMidCycleQuietsInsertWarn` — a store declared in this file that
     implements `barsBatchStore`, cancels the process ctx inside `InsertBars` and returns an error. Assert: no
     WARN `bar ingest: insert failed`; at least one Debug with that message and `ctx_done` = `true`; no
     `bar ingest: cycle complete` record (D-1: `applyBarCycle` and `reportIngestCycle` are skipped).
     Predicted RED: assertion (WARN logged).
   - `TestIngestRecentBarsForTimeframe_LiveCtxInsertFailureStillWarns` — `recordingBarsStore{err: …}` on a live
     ctx: the WARN is recorded and `bar ingest: cycle complete` is logged. Characterization.
   - `TestCancelQuietSites_Structural` — read `marketdata_service.go` and use `funcBody`:
     - `func (s *MarketDataService) fetchAndCacheBars(` contains `warnUnlessDone(ctx, "GetBars: live fetch
       failed"` once and `warnUnlessDone(ctx, "GetBars: re-read after cache failed"` twice, and still contains
       `slog.WarnContext(ctx, "GetBars: cache insert failed"` (`@AC-8` / `@AC-11 @feature-290`).
     - `func (s *MarketDataService) GetLatestQuote(` contains `warnUnlessDone(ctx, "GetLatestQuote: cache
       insert failed"`.
     - `func (s *MarketDataService) ingestRecentBarsForTimeframe(` contains `warnUnlessDone(ctx, "bar ingest:
       insert failed"` twice, `warnUnlessDone(ctx, "bar ingest: multi-bar fetch failed, falling back to
       per-symbol"` and `warnUnlessDone(ctx, "bar ingest: live fetch failed"` once each, and still contains
       `slog.WarnContext(ctx, "bar ingest: cycle deadline passed, timeframe not fetched"`.
     - The file still contains `slog.WarnContext(ctx, "warm poller: cache insert failures"` (load-bearing
       aggregate, `:1300`).
     Predicted RED: assertion.
3. C-13: the only domain literals are the `AAPL` bars from `aaplDailyBars()` (`:5899`, reused) and the `bh*`
   symbols (reused). No new domain literal, so no fixture home is created.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/service/ -race -count=1 \
  -run 'TestFetchAndCacheBars_|TestWarnUnlessDone|TestIngestRecentBarsForTimeframe_|TestCancelQuietSites_Structural'
cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -rn "type barsCancelSource" --include="*_test.go" services/xstockstrat-marketdata   # one declaration (C-13)
```
All pass with Step 2 applied; total ≥ 40%. New logic is in an excluded package (`internal/service`) — no
coverage threshold applies to it; the run is the regression gate. RED is captured before Step 2 per § Step
Dependencies.

---

### Step 2 — service: `warnUnlessDone` at the cancel-caused marketdata WARN sites

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence** (`marketdata_service.go`, `36aed60b`):
- `fetchAndCacheBars` at `:410`; `slog.WarnContext(ctx, "GetBars: live fetch failed", …)` `:418`; `GetBars: cache
  insert failed` `:429` (unchanged); `if ctx.Err() != nil` re-read skip `:432`; `GetBars: re-read after cache
  failed` `:438` and `:445`.
- `GetLatestQuote: cache insert failed` at `:637`, inside `GetLatestQuote` (`:617`).
- `ingestRecentBarsForTimeframe(ctx, fetchCtx context.Context, …)` at `:1410`; `began := time.Now()` `:1411`;
  `d := resolveBarIngestBackoff(s.budgetCfg)` `:1412`; `planBarRequest` `:1413`; `bar ingest: insert failed`
  `:1433` and `:1457`; `multi-bar fetch failed, falling back to per-symbol` `:1437`; `bar ingest: live fetch
  failed` `:1449`; `res := s.applyBarCycle(…)` `:1461`; `reportIngestCycle(…)` `:1462`.
- Its only production caller is `ingestRecentBars` (`:1403`), called from the poller loop with the process ctx
  and a per-cycle `fetchCtx` (`:1327-1329`).
- Existing `ctx_done` attribute precedent: `GetLatestQuotes: mark lookup failed … "ctx_done", ctx.Err() != nil`
  at `:737`.
- Warm poller: per-symbol lines are already `slog.DebugContext` (`:1249`, `:1277`); the aggregate WARN is `:1300`.

**Lands with**: `Step 1`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add `func warnUnlessDone(ctx context.Context, msg string, args ...any)` directly above `fetchAndCacheBars`.
   On a live ctx it calls `slog.WarnContext(ctx, msg, args...)`. When `ctx.Err() != nil` it calls
   `slog.DebugContext` with the same message and the arguments plus `"ctx_done", true`. Comment: at most two
   lines, stating only the constraint (keys on ctx state, never on the error text).
2. Replace `slog.WarnContext(` with `warnUnlessDone(` at exactly these eight sites, keeping message and
   attributes byte-identical: `:418`, `:438`, `:445`, `:637`, `:1433`, `:1437`, `:1449`, `:1457`. Each passes
   the function's own `ctx`; in the ingester that is the process ctx, never `fetchCtx`.
3. Leave unchanged: `GetBars: resolve source failed` (`:413`), `GetBars: cache insert failed` (`:429`), the
   fetch-deadline WARN (`:1422`), the warm poller (`:1249`, `:1277`, `:1300`), `BatchGetBars` (`:863`) and
   `GetLatestQuotes` (`:701`, `:737`).
4. In `ingestRecentBarsForTimeframe`, return when `ctx.Err() != nil` in two places: as the first statement
   (before `began` at `:1411`), and immediately before `res := s.applyBarCycle(…)` (`:1461`). The second guard
   is what D-1 means by "skips `applyBarCycle` and `reportIngestCycle`" for a cancel that lands mid-cycle: a
   shutdown must not accrue no-bars streaks.
5. No new outbound gRPC call, so header propagation is not touched. No config key, env var or port.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off go vet ./internal/service/
grep -c 'warnUnlessDone(ctx, ' services/xstockstrat-marketdata/internal/service/marketdata_service.go   # 8
grep -n 'slog.WarnContext(ctx, "GetBars: cache insert failed"\|slog.WarnContext(ctx, "warm poller: cache insert failures"' \
  services/xstockstrat-marketdata/internal/service/marketdata_service.go   # both still present
```
Plus Step 1's Verification (tests, coverage, lint), which is the unit's green run.

---

### Step 3 — test: portfolio cancel-quiet tests (deregistration, bracket, balance)

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_sync_cancel_test.go` — modify (append tests)

**Reviewers**: xstockstrat-portfolio owner — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence** (`services/xstockstrat-portfolio/internal/service/`, `36aed60b`):
- Helpers in `portfolio_sync_cancel_test.go`: `cancelingDB` `:16-32` (`cancelAtExec`, `failOnCancel`),
  `cancelSyncSvc` `:34`, `warnCount` `:52`, `canceledCtx` `:58`. Templates: `TestProcessPositionSync_AC1…`
  `:64`, `AC2…` `:82`, `AC3…` (never parked, through `svc.boundedRetry`) `:103`, `AC4…` (live-ctx negative
  control over pgxmock) `:129`.
- `syncRecorderDB` (`execs`, `find`) at `portfolio_offline_test.go:220-245`; `syncEvent(t, seq, payload)` at
  `portfolio_sync_retry_test.go:21`; `parkedCount` `:47`; `newFillSvc` (pgxmock) at
  `portfolio_fill_errors_test.go:56`; `errDBBlip` `:22`; `recordWarns` / `warnRecorder.find` at
  `portfolio_quote_deadline_test.go:63` / `:52`.
- Existing live-ctx guard `TestProcessAccountDeregistered_AC2_DeleteFailureIsRetryable` at
  `portfolio_sync_retry_test.go:134` (`@AC-2 @feature-256`) — not edited by this feature.
- Payload shapes: `bracketUpdatePayload` `portfolio_service.go:1710-1717`; `balanceSyncPayload` `:1757-1765`;
  deregistration payload keys `account_id` / `user_id` as used at `portfolio_sync_retry_test.go:136`.
- `UpdatePositionBracket` runs on `r.pool.Exec` (`internal/repository/portfolio_repo.go:379`), and
  `NewPortfolioRepoWithDB` leaves `pool` nil (`:50-52`). No behavioural test of `processBracketUpdate` exists
  (`portfolio_bracket_test.go` covers `parseBracketUpdatePayload` only): **Not found**.

**Lands with**: `Step 4`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
Append to `portfolio_sync_cancel_test.go`. No `t.Parallel()` (`slog.SetDefault` is process-global).
1. `TestProcessAccountDeregistered_CanceledCtxMakesNoWrite` — `canceledCtx()` with a `syncRecorderDB`. Assert
   `errors.Is(err, context.Canceled)`, zero execs, zero WARNs. Predicted RED: assertion (two execs, nil error).
2. `TestProcessAccountDeregistered_WriteThatSeesCancellationStopsWithoutWarn` — `cancelingDB{cancelAtExec: 1,
   failOnCancel: true}`. Assert one exec, no `DELETE FROM portfolio.offline_account_realized`, zero WARNs,
   `context.Canceled` returned. Predicted RED: assertion (two execs, one WARN).
3. `TestProcessAccountDeregistered_CanceledIsNeverParked` — through `svc.boundedRetry("account deregistration",
   svc.processAccountDeregistered)` on `canceledCtx()`: `context.Canceled` returned and `parkedCount(rec) == 0`.
4. `TestProcessAccountDeregistered_LiveCtxCanceledErrorStillWarns` — pgxmock, live ctx, the positions DELETE
   returns `context.Canceled`: the WARN `deregister: delete positions failed` is recorded and the returned
   error is non-nil. Characterization (ctx state, not error text).
5. `TestProcessBracketUpdate_DoneCtxWriteFailureLogsNoWarn` — `cancelingDB{cancelAtExec: 1, failOnCancel:
   true}`: one exec, zero WARNs. Predicted RED: nil-pointer panic on `r.pool` until Step 4's seam.
6. `TestProcessBracketUpdate_LiveCtxWriteFailureStillWarns` — pgxmock `ExpectExec("UPDATE portfolio.positions")`
   returning `errDBBlip`: the WARN `update position bracket failed` is recorded. Predicted RED: the same panic.
7. `TestProcessBalanceSync_DoneCtxWriteFailureLogsNoWarn` — `cancelingDB` as in 5: zero WARNs. Predicted RED:
   assertion (one WARN).
8. `TestProcessBalanceSync_LiveCtxWriteFailureStillWarns` — pgxmock failure on a live ctx: the WARN `upsert
   account balance failed` is recorded. Characterization.
9. `TestAckAlwaysConsumers_DoneCtxStillAck` — `ackAlways(svc.processBracketUpdate)` and
   `ackAlways(svc.processBalanceSync)` return nil on `canceledCtx()` with a failing write (R-2: the feature-294
   `acked` outcome does not move to `error`). Characterization.
10. C-13: the bracket and balance payload maps are new literals with one consumer each (this file). Inline is
    compliant; no fixture home is created. Deregistration reuses the existing `syncEvent` call shape.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/service/ -race -count=1 \
  -run 'TestProcessAccountDeregistered_|TestProcessBracketUpdate_|TestProcessBalanceSync_|TestAckAlwaysConsumers_|TestProcessPositionSync_'
cd services/xstockstrat-portfolio && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
```
All pass with Step 4 applied; total ≥ 40%. New logic is in excluded packages (`internal/service`,
`internal/repository`) — no coverage threshold applies to it.

---

### Step 4 — service: portfolio cancel-quiet in the deregistration, bracket and balance consumers

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify
- `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go` — modify (one line, `:379`)

**Reviewers**: xstockstrat-portfolio owner — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence** (`36aed60b`):
- `processAccountDeregistered` at `portfolio_service.go:1569`: lock `:1589-1590`;
  `DeletePositionsNotInSync` `:1594` with WARN `:1595`; `DeleteOfflineRealized` `:1598` with WARN `:1599`;
  `return errors.Join(failures...)` `:1602`. Wired through `boundedRetry` at `:1481`.
- Feature-290 pattern in `processPositionSync`: `stop := func(sym string) error { slog.DebugContext(ctx,
  "position sync stopped: context done", …); return ctx.Err() }` at `:1646-1649`; the guard before a write
  `:1651-1653`; the guard inside a failed write `:1665-1667`.
- A returned `context.Canceled` / `context.DeadlineExceeded` is transient and never parked: `:1511`.
- `processBracketUpdate` at `:1725`, WARN `:1735`; wired `ackAlways(s.processBracketUpdate)` `:1722`.
- `processBalanceSync` at `:1773`, WARN `:1794`; wired `ackAlways(s.processBalanceSync)` `:1770`.
- `ackAlways` `:188-193`; `observed` counts any non-nil return as outcome `error` `:234-245`.
- `processOrderFill` is wired `s.observed("order fill", "ok", s.processOrderFill)` at `:180`, with no
  `ackAlways` (O-9) — not edited.
- `PortfolioRepo{pool, db}` at `portfolio_repo.go:30-35`; production sets `db: pool` (`:46`);
  `UpdatePositionBracket` uses `r.pool.Exec` (`:379`); `UpsertAccountBalance` (`:436`),
  `DeletePositionsNotInSync` (`:392`) and `DeleteOfflineRealized` (`:575`) already use `r.db.Exec`.
- Trading-domain survey: none of these lines reads `TRADING_MODE`, a `BrokerType`, an `OrderType` or an
  `OrderStatus`.

**Lands with**: `Step 3`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `processAccountDeregistered`: after the lock, declare a `stop` closure like `:1646-1649` — it logs
   `slog.DebugContext(ctx, "account deregistration stopped: context done", "account_id", payload.AccountID)` and
   returns `ctx.Err()`. Return `stop()` when `ctx.Err() != nil` before each of the two deletes, and inside each
   delete's error branch before its WARN. On a live ctx the WARNs, the `failures` slice and
   `errors.Join(failures...)` stay as they are (`@AC-2 @feature-256`).
2. `processBracketUpdate` and `processBalanceSync`: inside the existing write-error branch, when
   `ctx.Err() != nil`, log `slog.DebugContext` (`"bracket update stopped: context done"` with `symbol`;
   `"balance sync stopped: context done"` with `account_id`) and return. Otherwise the existing WARN is
   unchanged. Both stay void and stay `ackAlways` (R-2). Do not add a ctx check before the write.
3. `portfolio_repo.go:379`: change `r.pool.Exec` to `r.db.Exec` in `UpdatePositionBracket`. Nothing else in
   that file.
4. `processOrderFill`, `ackAlways`, `observed` and the consumer wiring lines are not edited. Fill handling,
   broker coverage and order-type handling are unaffected by this step.
5. No new outbound gRPC call; no config key, env var or port.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off go vet ./internal/service/ ./internal/repository/
grep -n 'stopped: context done' services/xstockstrat-portfolio/internal/service/portfolio_service.go   # 4 lines: position sync, deregistration, bracket, balance
grep -n 'ackAlways(s.processBracketUpdate)\|ackAlways(s.processBalanceSync)' services/xstockstrat-portfolio/internal/service/portfolio_service.go   # both still wired
grep -n 'r\.pool\.Exec' services/xstockstrat-portfolio/internal/repository/portfolio_repo.go   # no match
```
Plus Step 3's Verification (tests, coverage, lint), which is the unit's green run.

---

### Step 5 — test: `SetConfig` bounds for `marketdata` / `bars.miss_backoff_ms`

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/setConfigScalarBounds.test.ts` — modify (one row)

**Reviewers**: xstockstrat-config owner — Config key naming, environment (`production`/`staging`) / global-per-user scoping, secret encryption + redaction, WatchConfig stream stability

**Codebase Evidence** (`36aed60b`):
- `TIMEOUT_KEY_FORMS` at `setConfigScalarBounds.test.ts:270-289`; the neighbour row
  `{ ns: 'marketdata', key: 'stream.bar_ingest_backoff_ms', field: 'intVal', min: 0, max: 86400000 }` at `:283`.
- The loop at `:291-309` generates, per row, "accepts … at its bounds" and "rejects … just outside … and
  writes nothing"; `:311-318` also refuses the prefixed spelling of every row.

**Lands with**: `Step 6`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add `{ ns: 'marketdata', key: 'bars.miss_backoff_ms', field: 'intVal', min: 0, max: 21600000 }` directly
   after the `:283` row. No other edit: the existing loops generate the cases.
2. Predicted RED: the generated "rejects marketdata/bars.miss_backoff_ms just outside [0, 21600000]" case
   fails on `err?.code`, because an unbounded key accepts `-1`.
3. C-13: the row is a table entry in an existing table, not a new domain literal.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
grep -n "bars.miss_backoff_ms" services/xstockstrat-config/src/__tests__/setConfigScalarBounds.test.ts   # one row
```
All pass with Step 6 applied.

---

### Step 6 — service: `SCALAR_BOUNDS_REGISTRY` entry for `marketdata.bars.miss_backoff_ms`

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify

**Reviewers**: xstockstrat-config owner — Config key naming, environment (`production`/`staging`) / global-per-user scoping, secret encryption + redaction, WatchConfig stream stability

**Codebase Evidence** (`36aed60b`):
- `SCALAR_BOUNDS_REGISTRY` at `configServiceImpl.ts:114`, keyed `${namespace}.${relative key}` (comment
  `:112-113`); neighbour entry `'marketdata.stream.bar_ingest_backoff_ms': { minValue: 0, maxValue: 86400000 }`
  at `:163`.
- `lookupScalarBounds` returns `SCALAR_BOUNDS_REGISTRY[`${namespace}.${key}`]` at `:186-188`, so the registry
  key is the display FQN while the stored key stays relative (no double prefix, O-10).

**Lands with**: `Step 5`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add `'marketdata.bars.miss_backoff_ms': { minValue: 0, maxValue: 21600000 },` directly after `:163`.
2. Comment, at most two lines, stating the constraints only: `0` is the documented kill switch, and the 6 h
   ceiling bounds how long a newly populated symbol can go without its first live fetch.
3. Config-key contract (C-05), stated here for the registry half; the reader and seed are Steps 10 and 8:
   namespace `marketdata`, key `bars.miss_backoff_ms`, `value_type` `int`, code default `1800000`, bounds
   `[0, 21600000]`.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
grep -n "'marketdata.bars.miss_backoff_ms'" services/xstockstrat-config/src/grpc/configServiceImpl.ts   # one entry
node scripts/check-config-wiring.mjs --final   # still exit 0: a bounds entry is neither a seed nor a read
```

---

### Step 7 — test: seed-migration shape test for `bars.miss_backoff_ms`

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/barsMissBackoffSeedMigration.test.ts` — create

**Reviewers**: xstockstrat-config owner — Config key naming, environment (`production`/`staging`) / global-per-user scoping, secret encryption + redaction, WatchConfig stream stability

**Codebase Evidence** (`36aed60b`):
- Shared helpers in `src/__tests__/migrationSql.ts`: `findOne(suffix, ext)` `:8-16` (asserts exactly one
  `*<suffix>.<ext>.sql`), `splitStatements(sql)` `:19-50` (quote-aware, strips `--` comments).
- Bespoke suites already built on those helpers for the sentinel row shape:
  `delistingConfirmationSeedMigration.test.ts:1-72` (constants `SUFFIX` / `KEY` / `ACTOR` / `SEEDED` / `BOUNDS`
  / `HEAD` / `CONFLICT` / `ROW`; five cases) and `uiChartHistoryBarsSeedMigration.test.ts`.
- `globalIntSeedCases.ts:16-20` matches a nine-column INSERT **without** `updated_by` and a down that deletes
  every global row (`:83-87`). It does not fit a sentinel seed and is used by two suites
  (`servabilitySeedMigrations.test.ts`, `signalPruneIntervalSeedMigration.test.ts`): not reused, not edited (O-17).
- `barIngestBackoffSeedMigration.test.ts` is not cloned (O-17).
- Test script: `"test": "tsc && node --test dist/__tests__/*.test.js"` (`package.json:12`).

**Lands with**: `Step 8, Step 9, Step 10`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Create the suite on `findOne` and `splitStatements` only, following the case list of
   `delistingConfirmationSeedMigration.test.ts`. Constants: suffix `_marketdata_bars_miss_backoff`, key
   `bars.miss_backoff_ms`, actor `system:config-migration-feature-fix-marketdata-miss-path-noise`, seeded
   `1800000`, bounds `{ min: 0, max: 21600000 }`.
2. Cases:
   - the up is exactly one statement: the ten-column `INSERT INTO config.config_values (namespace, key,
     value_type, value_data, description, default_value, consuming_service, updated_by, environment, user_id)`
     ending `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING`;
   - it seeds one global row per environment (`production`, `staging`) and nothing else: namespace
     `marketdata`, `value_type` `int`, `value_data` = `default_value` = `1800000`, consuming service
     `xstockstrat-marketdata`, the actor sentinel, `user_id` `NULL`, a non-empty description;
   - the stored key is namespace-relative: the up does not contain `'marketdata.bars.miss_backoff_ms'`;
   - the seeded value lies inside the bounds;
   - the down is one `DELETE FROM config.config_values WHERE …` restricted by the actor sentinel,
     `user_id IS NULL`, namespace, key and `value_data = '1800000'`.
3. Predicted RED: the `findOne` assertion `expected exactly one *_marketdata_bars_miss_backoff.up.sql, got []`.
   That is the missing fix, not a compile error.
4. C-13: no domain data; the constants describe the migration under test.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
git diff --stat origin/main-dev -- services/xstockstrat-config/src/__tests__/globalIntSeedCases.ts \
  services/xstockstrat-config/src/__tests__/barIngestBackoffSeedMigration.test.ts \
  services/xstockstrat-config/src/__tests__/migrationSql.ts   # empty: shared helpers and precedents untouched
```
All pass with Step 8 applied.

---

### Step 8 — migration: seed `marketdata` / `bars.miss_backoff_ms` (config `056`, provisional)

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/057_marketdata_bars_miss_backoff.up.sql` — create
- `services/xstockstrat-config/migrations/057_marketdata_bars_miss_backoff.down.sql` — create
- `scripts/config-wiring-stored.json` — modify (regenerated, never hand-edited)

**Reviewers**: DBA — Migration NNN numbering (no gaps, no conflicts), up+down pair present, run-order compliance with `scripts/db-migrate.sh`; xstockstrat-config owner — Config key naming, environment (`production`/`staging`) / global-per-user scoping, WatchConfig stream stability

**Codebase Evidence** (re-grounded 2026-11-26 on the merged tree `a68b1294` = feature tip `7a3692fd` + `origin/main-dev` `f802b184`):
- Trunk tail of `services/xstockstrat-config/migrations/`: `054_marketdata_delisting_confirmation_days`,
  `055_analysis_live_enrich_ttl_reseed`, `056_analysis_live_only_cycle_max_days` (feature 366
  opportunity-live-only-rotation, `540f8ff7`). `056` is taken; the next free number is `057`.
- Merge checklist command 2 (§ Step Dependencies) also finds `056_mcp_deadline_budget` on the unmerged
  `fix-mcp-deadline-budget` branch (`270e850d`); it sits at the trunk tail's number, so it renumbers on merge and
  may take `057` if it merges first. No ref carries `057`/`058`; command 3 (`miss_backoff_ms`) returns nothing.
- Row shape to follow (design D-5 / O-10): `048_webhook_fanout_callback_keys.up.sql:4-43` and its single-key
  twin `054_marketdata_delisting_confirmation_days.up.sql:4-13` — ten columns, relative key, sentinel
  `updated_by`, two environments, `user_id` `NULL`, `ON CONFLICT (namespace, key, environment,
  COALESCE(user_id, '')) DO NOTHING`.
- Down shape: `054_…down.sql:4-10` — a `DELETE` filtered by namespace, key, environment, `user_id IS NULL`,
  the sentinel and the seeded `value_data`.
- Never modelled on `042` (FQN key) or `047` (latched DELETE) — D-5.
- `scripts/config-wiring-stored.json` records every seeded row with its file name (for example `:2621` and
  `:2633` for `054`, `:965` and `:977` for `056`) and an `inputs_sha256` over all config migrations; `--final` fails `STALE-STORED` on a mismatch
  (`scripts/check-config-wiring.mjs:714`, `freshness`).
- Header comment convention: `-- Migration: <file>` / `-- Service: xstockstrat-config, feature <slug>. …`
  (`054_…up.sql:1-2`).

**Lands with**: `Step 7, Step 9, Step 10`

**TDD**: `N/A (migration)`

**Covers**: —

**Instructions**:
1. Re-run the merge checklist (§ Step Dependencies) and take the number as max(`origin/main-dev`) + 1. It is
   `057` after the `f802b184` merge (`056` was `max + 1` at spec time and is now taken by feature 366). The
   file content carries no number outside its header comment line.
2. Up: one `INSERT` of two rows (`staging`, `production`):
   `('marketdata', 'bars.miss_backoff_ms', 'int', '1800000', <description>, '1800000', 'xstockstrat-marketdata',
   'system:config-migration-feature-fix-marketdata-miss-path-noise', <env>, NULL)`, ending with the
   `ON CONFLICT … DO NOTHING` clause above. Description (same text on both rows, no apostrophe): what the
   window does (milliseconds a servable symbol with no stored bars is not live-fetched again by GetBars after
   a live fetch returned none), that it is read live on each miss, that `0` or less disables the back-off so
   every miss fetches and warns, and that explicit-range reads always fetch.
3. Down: one `DELETE FROM config.config_values WHERE namespace = 'marketdata' AND key = 'bars.miss_backoff_ms'
   AND environment IN ('staging', 'production') AND user_id IS NULL AND updated_by =
   'system:config-migration-feature-fix-marketdata-miss-path-noise' AND value_data = '1800000';`. A row an
   operator has changed is never deleted.
4. Regenerate the stored set: `DATABASE_URL=<scratch postgres> python3 scripts/config-wiring-stored.py`
   (routes and the blocked case are in § Step Dependencies). Commit the generator's output unedited.
5. Config-key contract (C-05): namespace `marketdata`; key `bars.miss_backoff_ms`; `value_type` `int`; code
   default `1800000`; reader `services/xstockstrat-marketdata/internal/service/bars_miss.go:resolveBarsMissBackoff`
   (Step 10); seed: this migration; live mechanism: read on each implicit first-page miss through
   `s.budgetCfg` (the `WatchConfig`-backed watcher), no restart.
6. No `scripts/config-wiring.json` `findings` entry: a key seeded and read under the same relative string
   produces no finding, and a baseline entry would fail as `STALE`.

**Verification** (offline, no database):
```bash
ls services/xstockstrat-config/migrations/057_marketdata_bars_miss_backoff.up.sql \
   services/xstockstrat-config/migrations/057_marketdata_bars_miss_backoff.down.sql
ls services/xstockstrat-config/migrations | sort | tail -2   # this pair is the highest number
ls services/xstockstrat-config/migrations | grep -c '^057_'   # 2: no other 057 pair on the merged tree
# read both: the up's two-row INSERT is reversed by the down's sentinel- and value-filtered DELETE
grep -c "057_marketdata_bars_miss_backoff.up.sql" scripts/config-wiring-stored.json   # 2 (staging, production)
node scripts/check-config-wiring.mjs --keys marketdata.bars.miss_backoff_ms --final   # exit 0, with Step 10 applied
```
On the local-Postgres route the generator applies every config migration's `up` on a scratch database, one
file at a time (`scripts/config-wiring-stored.py:77-80`, `db.migrate("up", "1")`), so the `up` of this migration
is executed there. On the CI-artifact route the same generator runs in CI. The `down` is not executed locally
on either route: Step 7's test pins its SQL text, and the rollback itself runs in CI and at deploy.

---

### Step 9 — test: GetBars miss-path negative-cache tests (AC-2) and the retargeted structural test

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/bars_miss_test.go` — create
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify (`barsCancelSource`, `fetchAAPLDaily`, `TestGetBarsWarnsWhenMissAndLiveFetchEmpty`)

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence** (`services/xstockstrat-marketdata/internal/service/`, `36aed60b`):
- Unit-test shape for a mutex + `map[string]time.Time` back-off with an injected `now`: `TestStaleCheckDue` at
  `marketdata_service_test.go:1165-1190`, built from `&MarketDataService{lastStaleCheck: make(…)}`.
- `cacheBarsSvc` `:5907-5911` leaves `s.repo` nil: "any re-read … panics". A fetch that returns bars on a live
  ctx with a succeeding store reaches `s.repo.QueryRecentBars` (`marketdata_service.go:436`). An empty or
  failed fetch returns before any repo call (`:416-423`).
- `barsCancelSource` `:5839-5850` (after Step 1: with `err`); `fetchAAPLDaily` `:5918-5922` destructures
  `bars, token := svc.fetchAndCacheBars(…)`; its users are the `TestFetchAndCacheBars_*` tests (`:5966-6082`)
  and Step 1's tests.
- `TestGetBarsWarnsWhenMissAndLiveFetchEmpty` `:1274-1283` pins the substring `slog.WarnContext(ctx, "GetBars:
  no bars stored and live fetch returned none"` in the body of `GetBars`.
- `TestGetBarsMarksSymbolWarm` `:1253-1269` pins `refetch && liveFetchAllowed(snap, req.Symbol)` in `GetBars`
  (`@AC-4 @feature-282`) — not edited; Step 10 keeps that guard in `GetBars`.
- Reader-test shape with a snapshot-built watcher: `TestResolveBarIngestBackoff` at `bar_hold_test.go:563-585`
  (`config.MustSnapshotWatcher("marketdata", …)`, `fakeCfg{ints: …}`); `fakeCfg` at
  `marketdata_service_test.go:290`.
- `bar_hold_test.go` is not edited by this feature (O-15).

**Lands with**: `Step 7, Step 8, Step 10`

**TDD**: `red-green required`

**Covers**: `AC-2`

**Instructions**:
1. `marketdata_service_test.go`:
   - add `calls int` to `barsCancelSource`, incremented as the first statement of `GetBars` (counted at entry;
     fails.md 2026-11-10 fix-ctx-cancel-warn-flood);
   - `fetchAAPLDaily` reads the `barsFetch` result: `f := svc.fetchAndCacheBars(…)`, returning
     `cachedBarsResult{bars: f.bars, token: f.token}`;
   - retarget `TestGetBarsWarnsWhenMissAndLiveFetchEmpty`, keeping its name: read `bars_miss.go`, assert the
     body of `func (s *MarketDataService) liveRefetch(` contains `warnUnlessDone(ctx, "GetBars: no bars stored
     and live fetch returned none"`; read `marketdata_service.go`, assert the body of `GetBars` contains
     `s.liveRefetch(`.
2. Create `bars_miss_test.go` (package `service`, no `t.Parallel()`). The service under test is
   `cacheBarsSvc(src, &recordingBarsStore{})`; `budgetCfg` stays nil (default window 30 min) unless a case says
   otherwise. `liveRefetch` is called directly with symbol `DNB`, timeframe `1d`, `implicitFirstPage` true, no
   stored bars and an explicit `now`. The empty source is `barsCancelSource{fakeBackfillSource:
   &fakeBackfillSource{}, newBars: <returns nil>}`.
   - `TestLiveRefetch_AC2_ThreeCallsOneVendorFetchOneWarn` — `@AC-2`. Three calls inside the window:
     `src.calls == 1`; WARN `GetBars: no bars stored and live fetch returned none` recorded exactly once; all
     three return no bars.
   - `TestLiveRefetch_WindowExpiry_RefetchesOnceWithDebug` — positive control. After the first call, a call at
     `now + window + 1s` makes `src.calls == 2`, records a Debug line with the miss message and adds no WARN;
     the next call inside the new window makes no further vendor call. One key only (spec-time decision 5).
   - `TestLiveRefetch_CrossKeySweep_ExpiredEntryWarnsAgain` — pins spec-time decision 5. Two keys that differ
     by timeframe or by symbol (a second symbol, if used, is declared in this file only, C-13). Key A gets a
     confirmed empty at `now`. At `now + window + 1s` key B gets a confirmed empty, which sweeps A's expired
     entry. A call for key A at that same time makes one more vendor call and records a second WARN for A, not
     a Debug line. An entry still inside the window is not swept: a control call for key B right after makes no
     vendor call (`@AC-2` unaffected).
   - `TestLiveRefetch_WindowZero_FetchesAndWarnsEveryCall` — disabled control. `budgetCfg:
     &fakeCfg{ints: map[string]int64{barsMissBackoffKey: 0}}`: three calls, three vendor calls, three WARNs,
     and `lastEmptyFetch` holds no entry. A negative value behaves the same.
   - `TestLiveRefetch_ExplicitRangeMiss_StillFetchesWithLiveEntry` — scope negative control. After an implicit
     confirmed-empty call, a call with `implicitFirstPage` false makes one more vendor call, logs the WARN, and
     leaves the entry's timestamp unchanged.
   - `TestLiveRefetch_CancelPlusEmpty_RecordsNoEntry` — D-3. The source cancels the ctx inside the fetch and
     returns `(nil, nil)`: no entry is recorded, no WARN is logged, and a second call on a fresh ctx fetches
     again (`src.calls == 2`).
   - `TestLiveRefetch_FetchError_RecordsNoEntry` — `err` set on a live ctx: no entry; the next call fetches.
   - `TestLiveRefetch_StaleBranch_NeverTouchesEntry` — with non-empty stored bars and a live entry for the
     key: the vendor is called, the stored bars and token come back when the fetch is empty, and the entry is
     unchanged.
   - `TestMissFetchDue` — table test with an injected `now`, shaped like `TestStaleCheckDue`: no entry → due;
     inside the window → not due; at or past the window → due; a different symbol or timeframe is independent;
     a second check without a write is still due (the check does not reserve); window `0` → due and the map
     is cleared.
   - `TestNoteMissResult` — confirmed empty with no prior entry sets the entry and reports first-empty; a
     confirmed empty with a prior entry reports not-first; a result with bars deletes the entry; an error or
     cancel result changes nothing; a write sweeps another key's entry older than the window; a nil map is
     created on first write.
   - `TestResolveBarsMissBackoff` — nil cfg and an absent key give 30 min; stored `0` and a negative value
     give `0`; a `fakeCfg` value and a snapshot-built `config.MustSnapshotWatcher("marketdata", …)` value are
     read as milliseconds (insights.md 2026-11-04 fix-marketdata-dead-symbol-ingest: snapshot-built reader test).
3. Predicted RED for every case in `bars_miss_test.go`: compile failure on the new symbols — use the stub
   method (§ Step Dependencies), under which `AC2` fails on `src.calls == 3`. The retargeted structural test
   fails on the missing `bars_miss.go`.
4. C-13: `DNB` is a new symbol literal with one consumer (this file). Inline is compliant. `barsCancelSource`
   keeps a single declaration, now consumed by three files of one package; it is a fake, not domain data, so
   it does not move.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go test ./internal/service/ -race -count=1 \
  -run 'TestLiveRefetch_|TestMissFetchDue|TestNoteMissResult|TestResolveBarsMissBackoff|TestGetBarsWarnsWhenMissAndLiveFetchEmpty|TestGetBarsMarksSymbolWarm|TestFetchAndCacheBars_|TestResolveBarIngestBackoff|TestBarHold_'
cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
git diff --stat origin/main-dev -- services/xstockstrat-marketdata/internal/service/bar_hold_test.go   # empty (O-15)
grep -rn '"DNB"' --include="*_test.go" services/xstockstrat-marketdata | cut -d: -f1 | sort -u   # one file (C-13)
```
All pass with Step 10 applied; total ≥ 40%. New logic is in an excluded package (`internal/service`) — no
coverage threshold applies to it.

---

### Step 10 — service: GetBars miss-path negative cache (`bars_miss.go`, `liveRefetch`, `barsFetch`, reader)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/bars_miss.go` — create
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify
- `scripts/config-wiring.json` — modify (`registry.receivers`: exactly one entry, `bars_miss.go:cfg`; no forwarder, no `findings` entry)

`bar_hold.go` is **not** modified (spec-time decision 2, O-15).

**Reviewers**: xstockstrat-marketdata owner — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence** (`36aed60b`; marketdata paths under `services/xstockstrat-marketdata/internal/service/`):
- Struct fields `staleMu sync.Mutex` / `lastStaleCheck map[string]time.Time` at `marketdata_service.go:59-60`;
  constructor literal `lastStaleCheck: make(map[string]time.Time)` at `:246`; `budgetCfg intGetter` `:116`,
  assigned only when the watcher is non-nil `:256-258`.
- `GetBars` `:271`: `snap := s.markWarmIfServable(req.Symbol)` `:288`; `startImplicit` `:310`; `readStart`
  `:321-324`; reads `QueryRecentBars(ctx, req.Symbol, canonicalTf, readStart, end, pageSize)` `:334` and
  `QueryBars(…)` `:336`; `if pageToken == "" {` `:344`; `refetch := len(bars) == 0` `:345`; stale branch
  `:346-353` (`staleCheckDue(req.Symbol, canonicalTf, interval, time.Now())` `:349`); guard `if refetch &&
  liveFetchAllowed(snap, req.Symbol) {` `:354`; fetch call with raw `req.Symbol`, `canonicalTf`, `readStart`,
  `end`, `pageSize`, `startImplicit` `:357`; miss WARN `:360-361` (attributes `symbol`, `timeframe`, `start`,
  `end`).
- The live-fetch block sits inside `if pageToken == ""` (`:344`), so at its only call site "implicit first
  page" (`startImplicit && pageToken == ""`) equals `startImplicit`, the value already passed as
  `fetchAndCacheBars`' `recent` argument (`:357`).
- `staleCheckDue(symbol, tf string, interval time.Duration, now time.Time) bool` `:374-383`, key `symbol + "|" + tf`.
- `fetchAndCacheBars(…) ([]*marketdatav1.Bar, string)` `:410-449`: returns `nil, ""` for a source-resolve
  failure `:415`, a fetch error `:419` and an empty fetch `:422`; otherwise the live or re-read page.
- `liveFetchAllowed` `asset_servability.go:66-71`; `markWarmIfServable` `:81`.
- `resolveBarIngestBackoff(cfg intGetter) time.Duration` `bar_hold.go:35-44`: default when `cfg == nil`, `<= 0`
  → `0`, else milliseconds. Constants `barIngestBackoffKey` / `defaultBarIngestBackoffMs` `:9-10`. Its one
  caller: `marketdata_service.go:1412`. `<= 0` clears state: `planBarRequest` `bar_hold.go:50-53`.
- `intGetter` `marketdata_service.go:138`.
- Wiring gate (`scripts/check-config-wiring.mjs` and `scripts/config-wiring.json` are unchanged between `36aed60b`
  and `2b2dec92`): `GETTER_RE` `:266` matches a `.GetInt(` call; `extractRegexReads` `:457` records `{file,
  receiver}` and resolves a constant key argument through same-package constants (`resolveIdent` `:375`);
  `attribute` `:547-552` looks up `registry.receivers["<file>:<receiver>"]`; `join` `:580` reports a read with no
  entry as `unattributed` (`:588`), which is gated unless baselined (`GATED_UNLESS_BASELINED` `:691`).
- Registry precedent: receiver entries `"…/marketdata/internal/service/bar_hold.go:cfg": "marketdata"`
  (`scripts/config-wiring.json:115`) and `"…/asset_servability.go:cfg": "marketdata"` (`:114`), one per file whose
  reader takes a `cfg` parameter. `registry.receivers` is alphabetical; `bars_miss.go:cfg` goes directly after `:115`.
- Spec-time prototype on a scratch copy of `origin/main-dev` @ `2b2dec92` (the key's two seed rows added to the
  scratch `scripts/config-wiring-stored.json`):
  - reader in a new `bars_miss.go`, no entry: `seeded-unread` plus `bars_miss.go:cfg:bars.miss_backoff_ms:unattributed`;
  - the same reader plus the one entry `bars_miss.go:cfg`: `--final` exit 0, `--keys marketdata.bars.miss_backoff_ms`
    exit 0, `node --test scripts/config-wiring.test.mjs` 75/75 pass;
  - not exercised: the real generated stored set (no `migrate` binary there, so the stored rows were hand-added to
    the scratch copy only) and `go build` (modules not downloadable offline).

**Lands with**: `Step 7, Step 8, Step 9`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **State.** Add `missMu sync.Mutex` and `lastEmptyFetch map[string]time.Time` to `MarketDataService` beside
   `staleMu` / `lastStaleCheck` (`:59-60`), and initialise the map in the constructor literal beside `:246`.
2. **`scripts/config-wiring.json`.** Add exactly one entry to `registry.receivers`, directly after the
   `bar_hold.go:cfg` line (`:115`), keeping the file's format and alphabetical order:
   `"services/xstockstrat-marketdata/internal/service/bars_miss.go:cfg": "marketdata"`. No forwarder, no
   `findings` entry, no other change. Do not add a `resolveOffMs` helper (spec-time decision 2).
3. **Gate check, right after instructions 2 and 4's reader** (Steps 5, 6 and 8 applied, the stored set
   regenerated): run `node scripts/check-config-wiring.mjs --final` and `node --test
   scripts/config-wiring.test.mjs`. Both must be green; the new key has a seed and a read, so there is no
   `seeded-unread` and no `unattributed`. If either is red, stop and report (P-03).
4. **`bars_miss.go`** (new, package `service`):
   - constants in a `const (` block: `barsMissBackoffKey = "bars.miss_backoff_ms"` and
     `defaultBarsMissBackoffMs int64 = 1800000`;
   - `func resolveBarsMissBackoff(cfg intGetter) time.Duration` with the body shape of `resolveBarIngestBackoff`
     (`bar_hold.go:35-44`) but its own key and default: `cfg == nil` → the default;
     `cfg.GetInt(barsMissBackoffKey, defaultBarsMissBackoffMs)` otherwise; `<= 0` → `0`; else milliseconds. The
     parameter must be named `cfg` and the read written `cfg.GetInt(` so instruction 2's entry attributes it.
     Doc comment at most two lines: `<= 0` disables the back-off (off, not default), unlike `resolvePositiveInt`;
   - `type barsFetch struct { bars []*marketdatav1.Bar; token string; confirmedEmpty bool }`;
   - `func (s *MarketDataService) missFetchDue(key string, window time.Duration, now time.Time) bool` — takes
     `missMu`; when `window <= 0` it clears `lastEmptyFetch` and returns true (D-4, mirroring
     `bar_hold.go:50-53`); otherwise it returns true when the key has no entry or `now.Sub(entry) >= window`.
     It never writes an entry (no reservation; the herd is accepted, O-12);
   - `func (s *MarketDataService) noteMissResult(key string, window time.Duration, now time.Time, f barsFetch)
     (firstEmpty bool)` — the only writer. Under `missMu`: read whether the key has an entry (`firstEmpty` is
     its negation), then sweep entries older than `window`; when `len(f.bars) > 0` delete the key; when
     `f.confirmedEmpty` set the key to `now`, creating the map if nil (the `cacheBarsSvc` literal leaves it
     nil, O-7); on any other result change nothing;
   - `func (s *MarketDataService) liveRefetch(ctx context.Context, symbol, tf string, start, readStart, end
     time.Time, pageSize int, implicitFirstPage bool, stored []*marketdatav1.Bar, storedToken string, now
     time.Time) ([]*marketdatav1.Bar, string)`:
     1. `miss := len(stored) == 0`; the cache applies only when `miss && implicitFirstPage`; the key is
        `symbol + "|" + tf` (raw symbol, O-3);
     2. when the cache applies, read `window := resolveBarsMissBackoff(s.budgetCfg)` and return `stored,
        storedToken` without fetching or logging if `!s.missFetchDue(key, window, now)`;
     3. `f := s.fetchAndCacheBars(ctx, symbol, tf, readStart, end, pageSize, implicitFirstPage)`;
     4. when the cache applies and `window > 0`, `firstEmpty := s.noteMissResult(key, window, now, f)`;
        otherwise `firstEmpty` is true (window `<= 0` and explicit-range misses log as before the fix);
     5. when `len(f.bars) > 0` return `f.bars, f.token`;
     6. when `miss`: if `firstEmpty`, `warnUnlessDone(ctx, "GetBars: no bars stored and live fetch returned
        none", "symbol", symbol, "timeframe", tf, "start", start, "end", end)`; otherwise `slog.DebugContext`
        with the same message and attributes;
     7. return `stored, storedToken` (a stale-but-present page is kept when the refetch yields nothing).
   - A stored page (the stale branch) never reaches `missFetchDue` or `noteMissResult`, so the hit path takes
     no `missMu` (O-18, R-4).
5. **`fetchAndCacheBars`** returns `barsFetch`: `barsFetch{}` for the source-resolve failure and the fetch
   error; `barsFetch{confirmedEmpty: ctx.Err() == nil}` for the empty fetch (D-3); `barsFetch{bars: …, token:
   …}` on every path that returns a page. Its doc comment stays at most two lines.
6. **`GetBars`** (`:354-363`): keep the guard line `if refetch && liveFetchAllowed(snap, req.Symbol) {`
   byte-identical and replace its body with `bars, nextToken = s.liveRefetch(ctx, req.Symbol, canonicalTf,
   start, readStart, end, pageSize, startImplicit, bars, nextToken, time.Now())`. `BatchGetBars` is not touched.
7. Comments: at most two lines each, constraints only (the entry is written only on a confirmed empty; only
   `noteMissResult` writes). Mechanism and history go to the commit message and Step 11's docs.
8. No new outbound gRPC call, env var or port. The window is never a code constant used as the window (F-07,
   R-1): `defaultBarsMissBackoffMs` is the default of a seeded, bounded key.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off go vet ./internal/service/
node scripts/check-config-wiring.mjs --keys marketdata.bars.miss_backoff_ms --final   # exit 0, no output for marketdata
node --test scripts/config-wiring.test.mjs
git diff origin/main-dev -- scripts/config-wiring.json | grep '^[-+] ' | grep -v '^+      "services/xstockstrat-marketdata/internal/service/bars_miss.go:cfg": "marketdata",$'   # no output: exactly one added line, nothing removed
grep -c 'resolveOffMs' services/xstockstrat-marketdata/internal/service/*.go | grep -v ':0$'   # no output: no wrapper
grep -n 'refetch && liveFetchAllowed(snap, req.Symbol)' services/xstockstrat-marketdata/internal/service/marketdata_service.go   # one line
grep -n 'missMu' services/xstockstrat-marketdata/internal/service/*.go | grep -v _test.go   # struct field + missFetchDue + noteMissResult only
git diff --stat origin/main-dev -- services/xstockstrat-marketdata/internal/service/bar_hold.go   # empty: untouched (O-15)
```
Plus the Verification of Steps 7, 8 and 9, which together are the unit's green run.

---

### Step 11 — docs: key table, GetBars / cancel-stop invariants, registered keys, product-spec corrections

**Status**: `pending`
**Service**: `xstockstrat-marketdata`, `xstockstrat-portfolio` (service docs); `docs/patterns/`; feature directory
**Files**:
- `services/xstockstrat-marketdata/CLAUDE.md` — modify
- `services/xstockstrat-marketdata/docs/alpaca-integration.md` — modify
- `services/xstockstrat-marketdata/docs/context-constitution.md` — modify
- `services/xstockstrat-portfolio/docs/context-constitution.md` — modify
- `docs/patterns/config-governance.md` — modify
- `docs/roadmap/features/317-fix-marketdata-miss-path-noise/product-spec.md` — modify

**Reviewers**: none

**Codebase Evidence** (`36aed60b`):
- Marketdata key table row `stream.bar_ingest_backoff_ms` at `services/xstockstrat-marketdata/CLAUDE.md:55`;
  `CLAUDE.md:119` points the `GetBars` cache and live-fallback prose to `docs/alpaca-integration.md`.
- `GetBars` bullet at `services/xstockstrat-marketdata/docs/alpaca-integration.md:9`: "(1) a DB **miss** (no
  stored bars) — populates a never-backfilled symbol on demand".
- MARKETDATA-3 at `services/xstockstrat-marketdata/docs/context-constitution.md:17`, with pointers
  "`#fetchAndCacheBars (~L403)` … live-fallback routing in `#GetBars (~L334-356)`". MARKETDATA-8 at `:22`: "the
  DB-miss fallback fires on every window".
- PORTFOLIO-3 at `services/xstockstrat-portfolio/docs/context-constitution.md:16`: "except when ctx is done,
  where any sync returns ctx.Err() before the next write (feature 290; Debug log only, transient so never
  parked) … and only the bracket and balance consumers keep `ackAlways` (best-effort)".
  `services/xstockstrat-portfolio/CLAUDE.md:97` only points to PORTFOLIO-3 — not edited.
- `docs/patterns/config-governance.md`: `## Per-Feature Registered Keys` is "Append-only … Newest first"
  (`:146-148`); re-grounded 2026-11-26 on the merged tree `a68b1294`: the first entry is now `### feature 366 —
  opportunity-live-only-rotation` at `:152` (`### feature 330` moved to `:173`); single-key marketdata precedent
  `### feature 352` at `:187-200`. The generic sentinel row `system:config-migration-feature-<slug>` is at `:143`.
- `product-spec.md:17-19` lists "the `ackAlways` consumers draining at shutdown (balance sync, bracket update,
  order-fill)".
- `product-spec.md` § Fix Scope (`:60-64`): "DB migrations anticipated: **no**" (`:63`) and "Config key changes
  anticipated: **no** — unless design chooses a new negative-cache TTL / back-off key" (`:64`). Steps 6, 8 and
  10 add the key `marketdata` / `bars.miss_backoff_ms` and one config seed migration, so both lines are stale.

**Lands with**: —

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. `services/xstockstrat-marketdata/CLAUDE.md`: add a `bars.miss_backoff_ms` row after `:55` — `int`,
   `1800000`; the `GetBars` miss back-off; read live on each implicit first-page miss
   (`resolveBarsMissBackoff`); `<= 0` disables it and clears its state (off, not default, like
   `stream.bar_ingest_backoff_ms`); seeded in staging and production by config migration
   `marketdata_bars_miss_backoff`; SetConfig-bounded `[0, 21600000]`; trade-off: a symbol that becomes
   populated outside the ingester's lookback can wait up to this value for its first live fetch.
2. `alpaca-integration.md:9`, live-fallback (1): state that on the implicit first page a servable symbol whose
   live fetch returned none (a confirmed empty: no error, ctx live) is not live-fetched again for
   `bars.miss_backoff_ms`; explicit-range reads always fetch; an error or a cancel records nothing; the WARN
   fires on the change into the empty state and later empty refetches log at Debug. State the two accepted
   behaviours (design open risks): concurrent cold first calls can each make one vendor call; the back-off
   saves the Alpaca call only, not warming or ingester polling. Add that cancel-caused failures on the live
   fetch, the re-read, the `GetLatestQuote` cache insert and the bar-ingest loop log at Debug with `ctx_done`.
3. `context-constitution.md` (marketdata): in MARKETDATA-8 replace "the DB-miss fallback fires on every
   window" with the rule that it fires on every explicit window and, on the implicit first page, at most once
   per `bars.miss_backoff_ms` after a confirmed empty. In MARKETDATA-3 point the live-fallback routing at
   `#liveRefetch` (`bars_miss.go`) and refresh the `~L` hints of the symbols it names.
4. `context-constitution.md` (portfolio), PORTFOLIO-3: extend the cancel-stop clause to the deregistration
   consumer (returns `ctx.Err()` before the next write, Debug only, never parked) and say that the bracket and
   balance consumers keep `ackAlways` and log a write failure at Debug when ctx is done. Add the new guard
   tests to its pointer list.
5. `docs/patterns/config-governance.md`: add `### feature 317 — fix-marketdata-miss-path-noise
   (`xstockstrat-marketdata` / `xstockstrat-config`)` directly above the current first entry (`### feature 366`
   at `:152` on the merged tree; re-check the first `### feature` heading under `## Per-Feature Registered Keys`
   after any later `origin/main-dev` merge), shaped like the feature-352 entry (`:187-200`):
   one paragraph (what the window does; full-dotted `SCALAR_BOUNDS_REGISTRY` entry; seeded `1800000` in staging
   and production, global, `int`, insert-if-absent, by config migration `marketdata_bars_miss_backoff` with the
   actor sentinel `system:config-migration-feature-fix-marketdata-miss-path-noise`; the down deletes only a
   global row that still carries the sentinel and still holds `1800000`; no `scripts/config-wiring.json`
   baseline entry, one `registry.receivers` entry `bars_miss.go:cfg` for the reader; approval: owner + config team) and
   one table row: `marketdata.bars.miss_backoff_ms` | int | `1800000` | `[0,21600000]`; never clamped on read |
   reader `resolveBarsMissBackoff` (`bars_miss.go`), read live on each implicit first-page miss; `<= 0`
   disables the back-off and clears its state.
6. `product-spec.md:17-19`: correct the order-fill claim (O-9) — the `ackAlways` consumers are balance sync and
   bracket update only; `processOrderFill` returns its error and is not `ackAlways`-wrapped, so it has no
   cancel-caused WARN site. Make the smallest edit that removes the false claim and cite design O-9.
   In § Fix Scope (`:63-64`) bring the two stale lines in line with the design: config key changes **yes** —
   `marketdata` / `bars.miss_backoff_ms` (design (B), D-5); DB migrations — no service-schema migration, one
   config seed migration (`marketdata_bars_miss_backoff`). The proto line (`:62`) stays **no**.
7. Do not use the phrases the doc check bans (`scripts/check-config-wiring.mjs:862`).

**Verification**:
```bash
node scripts/check-config-wiring.mjs --doc-check
grep -n "bars.miss_backoff_ms" services/xstockstrat-marketdata/CLAUDE.md services/xstockstrat-marketdata/docs/alpaca-integration.md \
  services/xstockstrat-marketdata/docs/context-constitution.md docs/patterns/config-governance.md   # at least one hit per file
grep -n "fires on every window" services/xstockstrat-marketdata/docs/context-constitution.md   # no match
grep -n "feature 317" docs/patterns/config-governance.md
grep -n "order-fill" docs/roadmap/features/317-fix-marketdata-miss-path-noise/product-spec.md   # only inside the correction
grep -n "bars.miss_backoff_ms\|marketdata_bars_miss_backoff" docs/roadmap/features/317-fix-marketdata-miss-path-noise/product-spec.md   # Fix Scope names the key and the seed
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Deviation 1 — Steps 1+2: Verification lines run from the repo root, each in its own subshell (2026-11-27)

- **Spec said**: the Step 1 / Step 2 `**Verification**` blocks, as written, each line starting `cd services/xstockstrat-marketdata`.
- **Actual**: run in one shell, the first `cd` makes every later `cd services/xstockstrat-marketdata` fail and the
  final `grep` path resolve inside the service dir, and the trailing `# …` comments would swallow a closing `)`.
  Each line was run unchanged, in its own subshell from the repo root, chained with `&&`, the comments ending
  their own lines. `golangci-lint` was the pinned v2.14.0 (`$(go env GOPATH)/bin`, put first on `PATH`; the
  `/usr/local/bin` copy is 2.5.0 built with go1.25.1).
- **Disposition**: CI-equivalent fallback — commands and judgment unchanged; only the shell framing.
- **Anchors**: line numbers moved after the BRANCH SYNC (e.g. `fetchAndCacheBars` `:410` → `:418`,
  `ingestRecentBarsForTimeframe` `:1410` → `:1434`); every symbol and message was found, so this is not a deviation (F-04).

### Deviation 2 — Steps 3+4: union Verification shell framing; supplementary RED/count runs (2026-11-27)

- **Spec said**: the Step 3 and Step 4 `**Verification**` blocks, each line run as written.
- **Actual**: the same framing as Deviation 1. Each line ran unchanged, in its own subshell from the repo root, and
  the lines were chained with `&&`. The pinned `golangci-lint` v2.14.0 came first on `PATH`. Step 4's
  `r\.pool\.Exec` "no match" grep ran as `! grep …`, so a match fails the chain; its trailing `# …` comments were
  dropped. Two runs were added beyond the Verification. Step 3's bracket nil-pointer panic (the predicted RED)
  aborts the test binary before the balance tests, so a second RED run covered `TestProcessBalanceSync_*` alone.
  A `-v` re-run of Step 3's first line counted the executed tests (28 PASS, 0 FAIL).
- **Disposition**: CI-equivalent fallback. The commands and the judgment are unchanged; only the shell framing
  differs, plus diagnostic runs.
- **Anchors**: lines moved after BRANCH SYNC (e.g. `processAccountDeregistered` `:1569` → `:1590`,
  `processBracketUpdate` `:1725` → `:1746`, `processBalanceSync` `:1773` → `:1794`). Every symbol was found, so
  this is not a deviation (F-04).

### Deviation 3 — Steps 5+6: union Verification shell framing; Node 24 on PATH (2026-11-27)

- **Spec said**: the Step 5 and Step 6 `**Verification**` blocks, each line run as written.
- **Actual**: the same framing as Deviation 1. Run in one shell, line 1's `cd services/xstockstrat-config` makes the
  repo-relative `grep` paths, the second `cd` and `node scripts/check-config-wiring.mjs --final` fail. Each line ran
  unchanged in its own subshell from the repo root, chained with `&&`; the trailing `# …` comments were dropped.
  The run used `PATH=/opt/node24/bin:$PATH` (root `CLAUDE.md` pins Node 24; the PATH default is v22).
- **Disposition**: CI-equivalent fallback. The commands and the judgment are unchanged; only the shell framing.
- **Anchors**: the neighbour registry entry moved from `configServiceImpl.ts:163` to `:165`; the test row anchor
  `:283` is unchanged. Every symbol was found, so this is not a deviation (F-04).
