# Design: fix-marketdata-fundamentals-cache

**Created**: 2026-10-22
**Rounds**: 4 (full; termination: approved)
**Approved by**: user @ 2026-10-22 (operator approval at the design gate after round 4; Floor clear)
**Grounded in**: recon.md

---

## Chosen Approach

Single service (`xstockstrat-marketdata`, Go). No proto, migration or config-key change. All paths are under
`services/xstockstrat-marketdata/`. Steps are ordered to limit rebase risk against 215 and 254 (recon.md
§Recommended Scope). D-19 is the last, isolated step.

**Consumer surfaces (C-14).** The fix is internal to marketdata, and the served shape is unchanged
(`missing_metrics = 18`, `marketdata.proto:241`; recon.md §Dependencies). What consumers see changes in four
ways: honest `missing_metrics` on partial rows, fewer silent stale rows, correct quota counts, and
`stale=true` (not ResourceExhausted) at the cap for a symbol already served. The agent tools
`query_fundamentals`/`screen_symbols` (`services/xstockstrat-agent/app/tools.py:402`, `:812`), `traderBff.ts`
and `insightsBff.ts` get read-only verification steps at `/sdd-spec`. Analysis fundsignal (feature 246) benefits
from the honest `missing_metrics`.

### S. Source-id constants (precondition for Steps 2 and 5)

Neither `fmp.SourceName` nor `finnhub.SourceName` exists today. The client write sites use bare literals:
`Source: "fmp"` at `internal/fmp/fmp_client.go:334` and `Source: "finnhub"` at
`internal/finnhub/finnhub_client.go:94`. The only named constant is `classification.SourceFMP = "fmp"`
(`internal/classification/sector.go:17`), used at `internal/repository/classification_repo.go:149`.

- Add `const SourceName = "fmp"` in package `fmp` and use it at `:334`. Add `const SourceName = "finnhub"` in
  package `finnhub` and use it at `finnhub_client.go:94`.
- Change `classification.SourceFMP` to an alias of `fmp.SourceName`, so one named constant remains (DRY guard
  rail, C-18).
- Today `classification` imports no internal package and `fmp` imports only `internal/source`. `/sdd-spec` must
  confirm with `go list -deps` that `source` does not import `classification`. If it does, the alias would
  create a cycle. In that case reverse it: `fmp.SourceName = classification.SourceFMP`.
- The repo count and seed methods take the source id as a `string` parameter, so `repository` imports neither
  `fmp` nor `finnhub`. The service passes `fmp.SourceName` or `finnhub.SourceName`.
- C-18 waivers (literals not on this fix's path): the fallback `"fmp"` at `marketdata_repo.go:587`, and the
  `"finnhub"` literals in the service provider switch at `marketdata_service.go:1931`/`:1951`.

### Step 1 — D-50: cap `<= 0` is a zero budget (comments and docs only; no behaviour change)

The operator ruling of 2026-10-22 resolves OQ-1. The enforced behaviour is already a zero budget:
`reserve()` refuses at `fmp_client.go:127`, the `count >= cap` gates are at `marketdata_service.go:1688`/`:1742`,
and `enrichmentUnderCap` is at `:2421-2427` (recon.md §Patterns to REUSE). These stay unchanged.

- Correct the misleading comments at `fmp_client.go:97` ("cap <= 0 = uncapped") and
  `marketdata_service.go:1958` (`atQuotaAlertThreshold`).
- `atQuotaAlertThreshold` (`:1959`) stays the single home of the 80% threshold. Only its comment changes; the
  helper is not duplicated (C-18, @feature-215 @AC-14).
- Fix the docs: marketdata `CLAUDE.md:82` and `docs/patterns/config-governance.md:183`/`:773`. A `/sdd-spec`
  checklist step verifies them, per review warning 1.
- Behavioural pins: cap-0 tests for the single path (AC-1) and the multi-symbol path (AC-9), next to
  `TestGetFundamentals_AtCapNoCacheResourceExhausted` (`marketdata_service_test.go:400`).

### Step 2 — D-51: source-filtered quota counts and a boot-seed seam

- `CountFundamentalsFetchedToday` (`marketdata_repo.go:656`, SQL `:658-659`) and `CountFundamentalsFetchedSince`
  (`:669`, SQL `:670`) gain a `source = $1` predicate. The `fundamentalsRepo` interface (`marketdata_service.go:157-158`)
  and `fakeFundRepo` (`marketdata_service_test.go:204`, `:208`, `:216`) gain the same parameter.
- **FMP boot seed.** It counts `fmp.SourceName` rows whatever the active provider is. The `*fmp.Client` budget
  is shared by the snapshot, ratio-enrichment and classification paths, and it is seeded even under the
  `finnhub` boot default (`cmd/server/main.go:125`, `:129-130`; recon.md §Risks).
  - The final predicate is in Step 5.8.
  - Seam for AC-3 (review warning 2): extract the `main.go:129-130` seed into a small `SeedFMPBudget` function
    that takes the repo count interface and the budget seeder, and unit-test it with the fake. A `pgxmock`
    SQL test pins the WHERE clause.
- **Finnhub window.** It is filtered on `finnhub.SourceName` (`marketdata_service.go:1935`). There is no as_of
  clause.
- `edgar+fmp` rows are on the edgar axis and are not counted. The seed is documented as a conservative floor
  (`CLAUDE.md:82`); classification calls write no row either.
- No `010` index migration. The existing `idx_fundamentals_fetched_at` (`migrations/002_fundamentals.up.sql:27-28`)
  is enough, and no need was shown (F-01; review warning 6).

### Step 3 — D-52: vendor-axis fresh check

- The source-blind fresh accept at `marketdata_service.go:1676` (Multi) and `:1734` (single) gains
  `cacheAxis(f.Source) == snapshotSourceVendor`. This reuses `cacheAxis` (`:1805`) and mirrors the edgar-axis
  check at `:1849-1850`, as feature 211 design point 5 requires; it does not compare raw strings.
- The stale serves at quota (`:1690-1694`, `:1697-1702`, `:1743-1745`, `:1752`) are unchanged. An edgar row may
  still be served `stale=true`, labelled by its `Source`. This keeps @feature-215 @AC-7 (no new
  ResourceExhausted).
- The edgar-mode vendor fallback (`edgarResolve` → `resolveFundamentals`, `:1868`) cannot loop: the vendor path
  never re-enters the edgar resolver. Tests mirror `TestGetFundamentals_EdgarCacheSelfHeal_feature211` (`:2433`).

### Step 4 — D-53a: undecodable `extra` logged

Add one shared `decodeExtraMetrics` helper in `internal/repository/marketdata_repo.go`. It replaces the three
silent decodes at `:548`, `:836` and `:889` and emits `slog.WarnContext`. There is one helper, not three copies
(C-18). AC-6's input is refined at `/sdd-spec` to an `extra` value that actually fails the decode.

### Step 5 — D-53b: a failed enrichment is stored already-expired (operator r2/r3/r4)

- **5.1 Flag.** Add a transient `EnrichmentFailed bool` to `source.Fundamentals` (`internal/source/source.go:62-64`).
  The `FundamentalsSource` interface does not change.
- **5.2 One classification point.**
  - `getJSON`'s non-200 return (`fmp_client.go:254-255`) becomes an unexported `*statusError{path string; code int}`.
    Its `Error()` text stays byte-identical (`"fmp: %s returned HTTP %d"`), with no URL and no apikey.
  - The enrichment loop (`:195-200`; today `rErr == nil && r != nil` drops the error) calls a single unexported
    `enrichmentExpires(err) bool`. It checks, in this order:
    1. `nil` → false.
    2. `errors.Is(err, ErrFMPDailyCapExceeded)` → true. This error arrives unwrapped from `reserve` (`:233`).
    3. `errors.Is(err, context.Canceled)` or `errors.Is(err, context.DeadlineExceeded)` → true. This check must
       precede the transport classification, because the limiter wrap (`:229`) and the `*url.Error` wrap (`:243`)
       both contain ctx errors.
    4. `errors.As(err, &se)` with `se.code` in {402, 403, 404} → false. These deterministic FMP 4xx responses are
       cached fresh: the metric pointers stay nil and `missing_metrics` is honest (operator r3 (2)).
    5. Everything else → true. That covers 5xx, other non-200 codes including 400/401/429, transport (`:243`),
       read (`:251`) and decode (`:258`) failures.
  - The three exempt codes live in one `switch`, not in a tunable or a list (C-18, F-07).
  - `nil, nil` (an empty array, `:280-282`, `:293-295`) is still a successful answer.
- **5.3 WARN.**
  - One aggregated `slog.WarnContext` per `GetFundamentalsMulti` call, with entries `SYM:ratios|profile:class`.
  - `class` is one of `cap`, `ctx`, `http_<code>`, `transport`, `read`, `decode`, evaluated in the 5.2 order.
    Deterministic 4xx pairs are included.
  - The raw `err.Error()` is never logged, because the `:243` `*url.Error` carries `apikey=`. This is why 254
    stays a soft dependency.
- **5.4 Expire on write.** In `UpsertFundamentals` (`marketdata_repo.go:574`):
  - In VALUES, `now()` (`:593`) becomes `CASE WHEN $17::boolean THEN 'epoch'::timestamptz ELSE now() END`.
  - In the conflict branch, `fetched_at=now()` (`:600`) becomes `fetched_at=EXCLUDED.fetched_at`.
  - `$17 = f.EnrichmentFailed`. The `::boolean` cast is required (ledger `fails.md:1977-1989`). There is no
    signature change.
  - Fix the `:572-573` doc comment. `edgarFinish` (`:1876-1885`) never sets the flag.
- **5.5 Keep last-known-good values on a flagged overwrite (operator r3 (1)).**
  - The enrichment columns (`:595-597`: pb_ratio, dividend_yield, roe, debt_to_equity, beta) become
    `CASE WHEN $17::boolean AND fundamentals.source = EXCLUDED.source THEN COALESCE(EXCLUDED.<col>, fundamentals.<col>) ELSE EXCLUDED.<col> END`.
  - The same-source guard means edgar values are never relabelled as fmp.
  - A deterministic-4xx row (`$17` false) is overwritten plainly.
  - `as_of` is still overwritten, which is the provenance note in Open Risks.
- **5.6 Trace-carrying write ctx.** Create one `wctx := context.WithoutCancel(ctx)` for the whole post-fetch
  write/emit block (`marketdata_service.go:1706-1713`, `:1762-1766`).
  - It covers `UpsertFundamentals`, `seedFromProfile` and `maybeAlertQuota`/`quotaCountAfterFetch`.
  - The `slog.Warn` calls at `:1708`/`:1763` become `slog.WarnContext(wctx, …)`.
  - This is the operator standing C-03 rule: no fresh background ctx.
- **5.7 Behaviour.**
  - The current call serves `stale=false` with an honest `missing_metrics` (`toProtoFundamentals` `:2033-2038`).
  - The next call with budget fails the TTL check and re-fetches.
  - The next call at the cap serves the stored row `stale=true`, never ResourceExhausted (@feature-215 @AC-7).
- **5.8 Seed predicate (operator r3 (3)).**
  - `CountFundamentalsFetchedToday` (`marketdata_repo.go:652-662`) becomes
    `WHERE source = $1 AND (fetched_at >= $d OR as_of >= $d)`, with `$1 = fmp.SourceName`. `$d` is the existing
    UTC-day expression, unchanged.
  - Add a 2-line constraint comment at `fmp_client.go:333` (`AsOf: now`): the seed depends on AsOf being the
    fetch instant. A client test asserts AsOf ≈ now.
- **5.9 Tests.**
  - AC-5 (cap-exceeded profile), plus a 503-profile sibling.
  - AC-10.
  - 4xx-exemption tests: a 404 profile and a 402 ratios. The stored row is non-epoch, the next call within TTL
    makes no FMP call, and `missing_metrics` lists the metrics.
  - One test per WARN class, plus a no-apikey-in-log test.
  - A ctx-cancel-after-quote test: the row persists via `wctx`.
  - `pgxmock` tests for the CASE, the merge and the seed WHERE. One seed test uses 30 edgar rows with as_of today
    (expect 0); another uses epoch-stamped fmp rows with as_of today (expect them counted).
  - One real-Postgres `DB_PGBOUNCER=true` epoch-branch upsert test (ledger `fails.md:1977-1989`).
  - `fakeFundRepo` becomes source-, flag- and merge-aware.
- **Spec text (operator r3 (4), r4).**
  - FR-4(b) is rewritten to reflect the 4xx exemption and the 5.5 provenance note.
  - AC-5's first Then lists `"beta"` only. `sector` is a string and is not in the `missing_metrics` vocabulary
    (`:2021-2031`).
  - The new `@AC-10 @FR-3 @FR-4 @regression` uses an FMP HTTP 503 on profile as its trigger, which is a
    transient class.
  - No @AC is added for the 4xx exemption; unit tests pin it.

### Step 6 — D-19: Alpaca stream reconnect budget and give-up (isolated last step)

- Add a manager-owned ctx to `streamManager` (`internal/alpaca/stream.go:60-67`). `run()` is a background loop
  with no originating request, so it may mint its own ctx (operator standing rule).
- Add a dial/URL seam in place of the hardcoded `wss://…` at `:183`, so tests can use an `httptest` websocket
  server.
- The consecutive-failure counter (`attempts`, `:147`/`:163`) resets after a healthy session. A session is healthy
  once the `subscription` ack has arrived (`:214`).
- The `time.Sleep` backoff (`:172`) becomes ctx-cancellable.
- On give-up (`:165-170`), log ERROR and call `closeAllLocked`. Under `m.mu` it removes each sub from `subs` and
  then closes its channels. The per-sub goroutine in `add()` (`:121-132`) closes only subs it still owns, so no
  channel is closed twice.
- Consumers observe the close through `StartBarStream`/`StartQuoteStream` → `marketdata.feed.disconnected`
  (`marketdata_service.go:1493-1517`, `:1528`).
- `TIMEFRAME_1MIN` stays pinned (`TestDispatchBarCarries1MinEnum`, `stream_test.go:20`).

### Housekeeping

- Merge order: 255 after 215, and a soft WARN row for 254 noting the overlaps at `fmp_client.go:243`/`:254-255`
  and `marketdata_service.go:1704`/`:1760`. Rows are added only after a user yes (review warning 5).
- Before Step 5, grep every `fetched_at` reader (the `marketdata_repo.go:526`/`:569` scan sites plus the C-14
  consumers) so that no reader shows 1970.

## Rejected Alternatives

- **Citing an existing `fmp.SourceName`/`finnhub.SourceName`** (the text of r1–r4). Rejected: neither exists, so
  the spec would carry a phantom symbol (F-04).
- **Adding `fmp.SourceName` alongside `classification.SourceFMP`.** Rejected: it gives one vendor id two named
  constants (DRY). One aliases the other instead.
- **Having the fmp client import `classification.SourceFMP` directly.** Rejected as the primary option because
  classification is an odd home for a snapshot-source id. It is kept as the fallback if the alias creates a cycle.
- **Having the repo import `fmp` for the seed constant.** Rejected: it inverts the dependency direction. The repo
  takes the source as a parameter instead.
- **Expiring on every enrichment failure, including 402/403/404** (r2/r3 wording). Rejected per operator r3 (2):
  it burns quota and starves the 215 filler and 217 classification.
- **Exempting all 4xx except 429.** Rejected: it goes beyond the operator's explicit 402/403/404 list, and a 401
  (bad key) would stay cached fresh for a TTL after the key is fixed.
- **Rejecting an unexported status error as having "no consumer"** (r3). Superseded: the 4xx exemption is now a
  real, package-internal consumer.
- **Deferring the @AC-10 trigger to `/sdd-spec`.** Rejected: an acceptance scenario's meaning would stay open
  after sign-off (C-15). The trigger is pinned to a 503 now.
- **A bounded retry window (`now()-ttl+N`) instead of epoch.** Rejected: operator r2 mandates "already expired",
  and a window needs a fixed invariant or a tunable (F-07). The operator may revisit it.
- **Skipping the upsert on a transient failure** (the `edgarFinish` precedent). Rejected: superseded by operator
  r3 (1). It would also return ResourceExhausted at the cap for a symbol already served, which regresses
  @feature-215 @AC-7.
- **A retryable class limited to cap/ctx, with every other failure cached fresh** (r2). Rejected per operator r2:
  no residual is accepted for transient failures.
- **An unconditional cross-source COALESCE.** Rejected: it relabels edgar values as fmp.
- **An unparenthesised seed OR clause.** Rejected: it counts edgar rows, which reintroduces D-51.
- **Seeding the FMP budget with the active provider's rows.** Rejected: under the `finnhub` default it would seed
  the FMP budget with Finnhub rows.
- **Logging the raw `rErr`/`pErr`.** Rejected: the `:243` `*url.Error` text carries `apikey=`.
- **One WARN per symbol per enrichment.** Rejected: it floods once the cap is hit.
- **Detaching only the upsert ctx.** Rejected: `seedFromProfile` and `maybeAlertQuota` would still die on a
  cancelled ctx (operator C-03 rule).
- **Making 254 a hard predecessor.** Rejected: class-only logging removes the leak without that dependency.
- **A marker in `extra_metrics`, a per-symbol error set, a `FailedEnrichments` slice, or a migration `010`
  `(source, fetched_at)` index.** Rejected, in order: the marker leaks onto the wire, the error set and slice churn
  the interface without a consumer, and the index is not needed.
- **Adding `sector` to the `missing_metrics` vocabulary.** Rejected: it changes the documented canonical names
  (`marketdata.proto:213-218`). AC-5 lists `beta` only.

## Open Risks

- [ ] **403 classification.** A 403 classed as deterministic may sometimes be transient at FMP (a suspended key, a
  per-minute limit). The row would then be pinned fresh with missing metrics for one TTL. This is bounded,
  visible as `http_403` in the WARN, and operator-sanctioned. — address at the Step 5 tests/PR note.
- [ ] **Unassigned 4xx codes.** HTTP 400, 401 and 429, and read-body failures, are not in the operator's expire
  list or exempt list. The design expires them; operator r4 "approved as synthesized" accepts this. Changing it is
  a one-line `switch` edit. — record at the Step 5 PR.
- [ ] **Re-fetch amplification.** Under a persistent 5xx or transport failure, every request and every fundsignal
  cycle re-spends the counted quote and ratios calls (only non-200 responses refund, `fmp_client.go:235-240`).
  The cap is reached earlier, which starves the 215 filler and 217 classification. The hard cap bounds it, and it
  applies only to transient classes. This is an accepted cost of operator r2. — record at the Step 5 PR.
- [ ] **Import cycle.** Aliasing `classification.SourceFMP = fmp.SourceName` adds an edge from `classification`
  to `fmp`. The reverse-alias fallback applies if it is a cycle. — `/sdd-spec` (`go list -deps`).
- [ ] **Epoch timestamps.** An epoch-stamped `fetched_at` shows as 1970 to any reader that displays it. —
  fetched_at reader grep before Step 5.
- [ ] **Provenance after a merge.** After a flagged COALESCE merge, a stale-served row carries prior enrichment
  values under today's `as_of`, with an empty `missing_metrics`. This is acceptable only because the row is
  served `stale=true`, and feature-246 consumers must know it. — FR-4(b) note at `/sdd-spec`.
- [ ] **Coarse WARNs.** Class-only WARNs lose detailed diagnostics until 254 lands. — 254.
- [ ] **Session time zone.** The existing `now() AT TIME ZONE 'UTC'` timestamp/timestamptz comparison depends on
  the session time zone, and the new as_of clause inherits that. — Step 5.8.
- [ ] **Rebase conflicts.** Expect conflicts with 215 and 254 at `fmp_client.go:243`/`:254-255`,
  `marketdata_service.go:1704`/`:1760`, the upsert SQL and the seed WHERE. — merge-order rows (on a user yes).
- [ ] **Test fake.** Making `fakeFundRepo` source-, flag- and merge-aware may break tests that seed `todayCount`
  directly. — Steps 2 and 5.
- [ ] **Floor under Finnhub.** Under the finnhub provider the FMP seed counts about 0, and classification spend
  writes no row. Both are accepted under floor semantics (`CLAUDE.md:82`). — Step 2 docs.
- [ ] **Healthy-session assumption.** D-19 assumes Alpaca sends `subscription` only after a successful
  auth+subscribe. — Step 6 test.
- [ ] **Ack-then-drop servers.** A server that acks and then drops reconnects forever at a fixed delay.
  Accepted. — Step 6 PR note.
- [ ] **StreamBars clients.** StreamBars RPC clients still hang after a manager give-up
  (`marketdata_handler.go:37-54`). AC-8 holds at the manager level only. — follow-up feature.

## Constitution Rules Touched

- `C-03` (trace/ctx propagation): honored by a single `context.WithoutCancel(ctx)` for the request-derived write
  and emit block, and `WarnContext` at `:1708`/`:1763`. Only the D-19 background loop mints its own ctx. No waiver.
- `C-08` (acceptance-first): honored. AC-1/AC-9 are behavioural, AC-5 is rewritten, and AC-10 is added with a
  pinned trigger. Each FR has a regression @AC.
- `C-11` (no silent guesses): honored. The open forks went to the operator: OQ-1, transient-failure expiry (r2),
  the 4xx exemption, merge, seed predicate and spec text (r3), and S plus the AC-10 trigger (r4). The unassigned
  4xx codes are recorded as an explicit acknowledgement.
- `C-14` (consumer surface): honored. The agent tools and the two BFFs get read-only verification steps. The
  served shape and status codes are unchanged.
- `C-15` / `C-16` (acceptance truth and business rules): honored. See Business Rules Touched. Each CHANGE cites an
  operator decision.
- `C-18` (DRY): honored. There is one source constant per vendor (alias), one `atQuotaAlertThreshold`, one
  `decodeExtraMetrics`, one `enrichmentExpires` switch, and the three literal waivers are recorded.
- `F-01` (migrations): honored. No migration, and no `010` index.
- `F-04` (never invent): honored. The phantom `SourceName` symbols are now introduced explicitly by S, and are no
  longer cited as existing.
- `F-07` (no hidden tunables): honored. The epoch sentinel and the hardcoded 402/403/404 switch need no new config
  key, and the bounded-window tunable was rejected.
- `P-02` / `P-03` (mediated debate, grounded claims): honored. Four mediated rounds, with line numbers re-checked
  in the worktree at r4.
- `PLAT-N1` (best-effort/verify): honored. Tests are named per class and per AC, plus one real-Postgres
  PgBouncer test.

## Business Rules Touched (C-16)

- CHANGE `@AC-1` "An FMP daily cap of 0 is a zero budget (FMP disabled)" (feature `acceptance.feature`):
  rewritten to the zero-budget semantics, and its source-text Then was dropped. Signed off by the operator
  2026-10-22 (OQ-1; context.md §Session 2026-10-22 — sdd-review product-spec).
- CHANGE `@AC-9` "An FMP daily cap of 0 is a zero budget on the multi-symbol path": the multi-path equivalent.
  Signed off by the operator 2026-10-22 (OQ-1, same entry).
- CHANGE `@AC-5` "A failed FMP enrichment is not cached as a fresh complete row": the first Then lists `"beta"`
  only. FR-4(b) is rewritten for expire-on-transient, the 402/403/404 exemption and the merge-provenance note.
  Signed off by the operator 2026-10-22 (design gate r2 and r3 (2)/(4); context.md).
- EXTEND `@AC-10` (new, `@FR-3 @FR-4 @regression`): a fresh `source=edgar` row on the vendor path plus a transient
  FMP HTTP 503 on profile. The first call serves vendor values `stale=false` with `missing_metrics` containing
  `beta`, and the row becomes an already-expired fmp row. The next call at the cap serves it `stale=true` with no
  HTTP call. After the quota resets, it re-fetches. Signed off by the operator 2026-10-22 (design gate r3 (4),
  r4).
- PRESERVE `@AC-2`, `@AC-3`, `@AC-4`, `@AC-6`, `@AC-7`, `@AC-8` (feature `acceptance.feature`): implemented as
  written by Steps 2, 3, 4 and 6.
- PRESERVE `@AC-7 @feature-215` "absence distinct from outage and disable"
  (`services/xstockstrat-marketdata/acceptance/block-fundamentals-strategy-on-etf.feature`): not regressed. The
  stale serves are unchanged, and an expired row is served stale at the cap, never ResourceExhausted.
- PRESERVE `@AC-14 @feature-215` "The ETF label never spends the guard's FMP headroom" (same file): not regressed.
  `atQuotaAlertThreshold` stays single-sourced, and only its comment changes.
- PRESERVE `@AC-5 @feature-215` (same file): cap-0 semantics agree with OQ-1. Covered by the operator decision.
- PRESERVE `@feature-217 @AC-4` "Failed FMP calls refund the shared daily budget"
  (`services/xstockstrat-marketdata/acceptance/sector-classification.feature`): not regressed, because
  `reserve()`/`refund()` are unchanged.
- PRESERVE `@AC-5 @feature-198` "FMP-Free ratio enrichment degrades gracefully at the daily cap"
  (`services/xstockstrat-marketdata/acceptance/historical-fundamentals-backtest.feature`): not regressed. D-53b
  applies to the snapshot path only, not to `BackfillFundamentals`.
- PRESERVE `@AC-5 @feature-196` "deprecating a response field never changes the proto schema"
  (`docs/sdd/business-rules/platform.feature`): not regressed. `missing_metrics` is reused and no proto field is
  added.
- PRESERVE `@AC-6 @feature-211` and `@AC-7 @feature-211`
  (`services/xstockstrat-marketdata/acceptance/edgar-fundamentals-enrichment.feature`): not regressed. The
  edgar-axis check is untouched, and the vendor fallback still serves vendor-sourced data.

## Rounds

- **r1:** Steps 1–6 were laid out. D-53b used a narrow retryable flag.
- **r2:** Skip-the-upsert was rejected as a @feature-215 @AC-7 regression and replaced by the epoch-sentinel
  upsert. Operator: transient failures expire, with no residual.
- **r3:** Class-only WARN, the `wctx` block, the same-source merge and the parenthesised seed. Operator: adopt the
  merge, exempt 402/403/404, adopt the seed predicate, sign off the spec text.
- **r4:** S (source constants do not exist yet; introduce and alias them), the classification order, and the
  pinned AC-10 503 trigger. Operator: approved as synthesized.

Termination: approved. The operator approved at the r4 gate, and there were no Floor breaches.
