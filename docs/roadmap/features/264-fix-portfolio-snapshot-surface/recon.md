# Recon: fix-portfolio-snapshot-surface

**Created**: 2026-10-21
**From**: product-spec.md (SEV-2, Track C; defect report `docs/reports/2026-10-21-portfolio-snapshot-surface-defect.md`)
**Affected services**: xstockstrat-portfolio; xstockstrat-config (only if FR-4 picks branch (b), retire the key)

---

## Objective

Close a latent cross-tenant leak (D-24). `StreamPortfolioUpdates` sends every user's snapshot to every
subscriber, and the gRPC path also accepts an empty caller. After the fix, each subscriber gets only snapshots
where `portfolio_id == x-user-id`, on both the Connect and gRPC paths. Also resolve the dead config key
`portfolio.snapshot.interval_minutes` (D-12): either wire a multi-user periodic writer, or retire the key, its
docs and the uncalled `StartSnapshotWriter`. Scope is D-12 and D-24 only (operator decision, 2026-10-21).

## Codebase Map

- **`xstockstrat-portfolio`** (Go)
  - Entry point: `services/xstockstrat-portfolio/cmd/server/main.go:64-69`. It starts only the `go svc.Consume*`
    goroutines and `go svc.HydrateStops(ctx)`. Nothing starts `StartSnapshotWriter`.
  - Subscriber state (`services/xstockstrat-portfolio/internal/service/portfolio_service.go`):
    - `subs map[string]chan *portfoliov1.PortfolioSnapshot` at `:54`, with no owner field. The `s.mu` RWMutex is at `:53`.
    - The map is built in the constructor at `:155`.
    - `Subscribe(id string)` is at `:875` and `Unsubscribe(id string)` at `:884`. Both take only an id.
      `Subscribe` creates a channel with buffer 32. `Unsubscribe` deletes the entry and closes the channel.
  - Producer, `broadcastSnapshot` (same file):
    - Defined at `:908`. The unpriced-skip is at `:915-919`.
    - `snap.PortfolioId` is set to `userID` at `:925`.
    - The unfiltered fan-out loop is `for _, ch := range s.subs` at `:937` (loop body `:936-943`).
    - It is called after every fill at `:376` as `s.broadcastSnapshot(ctx, fill.UserID, mode)`. The producer is live.
  - Dead writer, `StartSnapshotWriter(ctx, userID string, mode commonv1.TradingMode)` (same file):
    - Defined at `:894-906`. It is per-user, uses a `time.NewTicker` and has no injectable clock.
    - It reads the key at `:895` as `s.cfg.GetInt("portfolio.snapshot.interval_minutes", 5)`.
    - It calls `broadcastSnapshot` at `:903`.
  - Handlers (`services/xstockstrat-portfolio/internal/handler/portfolio_handler.go`):
    - `streamUserID` at `:28` reads `x-user-id` from `metadata.FromIncomingContext` and returns `""` if the header is absent.
    - Connect `StreamPortfolioUpdates` (`:114-139`):
      - The empty-caller check is at `:116-118` and returns `connect.CodeInvalidArgument, "user_id required"`.
      - It subscribes with `h.svc.Subscribe(subID)` at `:120`.
      - It filters only on `req.Msg.TradingMode` at `:129`.
    - gRPC adapter (`grpcPortfolioAdapter` type at `:247`, `GRPCHandler()` at `:242`), stream at `:292-312`:
      - There is **no** empty-caller check.
      - It subscribes with `a.h.svc.Subscribe(subID)` at `:294`.
      - It filters only on `req.TradingMode` at `:302`.
    - `NewPortfolioHandler(svc *service.PortfolioService)` at `:49` takes a concrete type, not an interface.
  - Repository (`services/xstockstrat-portfolio/internal/repository/portfolio_repo.go`):
    - `ListPositions(ctx, userID, mode, pageSize, pageToken, accountID, symbolFilter, side)` is at `:135`.
    - `InsertSnapshot(ctx, portfolioID, userID, equity, cash, dayPnL, openPositions, mode)` is at `:201`.
    - The per-user helpers are `ListAccountBalancesByUser` at `:547` and `ListOfflineAccountIdsByUser` at `:572`.
    - No `DISTINCT` / list-all-users query exists.
  - Last migration: not applicable. Portfolio needs no migration on either branch.
  - Config-read pattern:
    - `s.cfg.GetInt(...)` at `portfolio_service.go:895`.
    - The `intConfig` interface is at `:1561`. The `quoteCfg intConfig` field is at `:51`, with its nil-default
      read at `:418-421`.
  - Other key symbols:
    - `PortfolioService.now func() time.Time` at `:65` is the offline valuation clock (`clock()` at
      `offline_valuation.go:54`). It is not wired to any ticker.
- **`xstockstrat-config`** (Node.js; touched on branch (b) only)
  - Key seeds:
    - `services/xstockstrat-config/migrations/001_config_tables.up.sql:68`: global row, value `5`,
      "Portfolio snapshot frequency".
    - `services/xstockstrat-config/migrations/002_config_environment.up.sql:69`: `production` row, value `1`,
      "Portfolio snapshot frequency (prod)".
  - Stored key form: `029_heal_config_keys_full_dotted.up.sql:24-28` runs
    `SET key = namespace || '.' || key WHERE key NOT LIKE namespace || '.%' AND is_secret = false AND namespace IN (..., 'portfolio', ...)`.
    After 029 the rows are stored as `key = 'portfolio.snapshot.interval_minutes'`, namespace `portfolio`.
  - Last migration: `030_marketdata_edgar_snapshot_keys.up.sql` (`services/xstockstrat-config/migrations/`). It shows
    the post-147 column layout `(namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id)`
    and the conflict target `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING` (`:23,:55`).
  - No config-service source change is needed on branch (b). `services/xstockstrat-config/CLAUDE.md`
    § Config Keys Managed only points at `001`.

## Patterns to REUSE

- **Owner-scoped subscriber.** Reuse trading's pattern in `services/xstockstrat-trading/internal/service/trading.go`:
  - `type orderSubscriber struct { ch; userID }` at `:344`.
  - `subs map[string]orderSubscriber` at `:133`.
  - `SubscribeOrderUpdates(id, userID string)` at `:351`.
  - The `broadcastOrder` owner skip at `:386-390`.
  - **Deviation:** trading treats an empty `userID` as "all users" (`sub.userID != "" && ...` at `:390`). Portfolio
    must be fail-closed, so it gets no empty-means-all mode. The handlers reject an empty caller before `Subscribe`.
- **Isolation test template.** Reuse `TestBroadcastOrder_ScopesToSubscriberUser` at
  `services/xstockstrat-trading/internal/service/trading_ownership_test.go:111`.
- **Empty-caller rejection on gRPC.** Mirror the Connect check at `portfolio_handler.go:116-118`. Use the gRPC
  equivalent `status.Error(codes.InvalidArgument, "user_id required")` (the adapter's other methods map errors
  through `toGRPCError`, e.g. `:287`). It must run **before** `Subscribe` at `:294`, so the subscriber is never registered.
- **Handler test with a nil service.** The validation runs before the service is touched, so the test can build a
  bare `&PortfolioHandler{}` (`internal/handler/portfolio_identity_test.go:27-35`). Use `ctxWithHeader(userID)` and
  `ctxNoHeader()` from the same file (`:18-25`).
- **Service test harness** (`internal/service`, pgxmock):
  - `newQuoteSvc(t, stub, timeoutMs)` at `portfolio_quote_deadline_test.go:93`.
  - `fakeConfig{vals map[string]int64}` at `watchlist_service_test.go:244`.
  - `ctxWithUser` at `watchlist_service_test.go:280`.
  - The existing broadcast tests `TestBroadcastSnapshot_AC2_BrokerFirstEquity` (`:393`) and `..._AC8_AnyUnpricedSkips`
    (`:420`), which use `svc.Subscribe("t")` + `len(ch)`.
- **Retire-key migration (branch b).** Reuse `services/xstockstrat-config/migrations/020_remove_analysis_signal_source_weights.up.sql:8`
  (`DELETE FROM config.config_values WHERE namespace = ... AND key = ...`).
  - Its `.down.sql` (`:9-24`) re-inserts one row per environment with `user_id` NULL and `ON CONFLICT ... DO NOTHING`,
    and carries a comment that the restore clobbers operator edits.
  - The header comment format is `-- Migration:` / `-- Service:` / `-- Feature N:`.
- **Governance log (both branches).** Reuse the "**Removes** `analysis.signals.source_weights` (migration 020)"
  entry at `docs/patterns/config-governance.md:423-427`. The entry goes in the § Per-Feature Registered Keys section
  (heading at `:105`).
- **Periodic writer valuation (branch a only).** The writer must call the existing `broadcastSnapshot` (broker-first
  valuation plus the unpriced-skip). It must not compute a second valuation.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-2` "The persisted equity snapshot values broker positions first and marks the rest"
  (`services/xstockstrat-portfolio/acceptance/fix-after-hours-positions-priced.feature`, `@FR-4 @regression @feature-231`).
  It guarantees exactly one `portfolio.snapshot` event and one subscriber update per computed snapshot, with
  broker-first valuation. The owner filter must not drop or duplicate the matching subscriber's update. A branch (a)
  writer must reuse this valuation.
- **PRESERVE** `@AC-8` "Any unpriced position skips the equity snapshot and names the symbol"
  (`services/xstockstrat-portfolio/acceptance/fix-after-hours-positions-priced.feature`, `@FR-4 @feature-231`).
  When any position is unpriced there is no row, no event and no subscriber update, and a WARN names the symbol.
  This applies to the per-fill path and to any branch (a) periodic writer.
- **PRESERVE** `@AC-5` "Header-propagation semantics are unchanged beneath mTLS" (`docs/sdd/business-rules/platform.feature`,
  `@FR-5 @feature-210`). `x-user-id` is read from the propagated trio. The gRPC owner check and the empty-caller
  rejection must not alter propagation.
- **PRESERVE** `@AC-8` "the dead source-weights key is gone after the removal migration"
  (`services/xstockstrat-config/acceptance/surface-signal-weight-decay-config.feature`, `@FR-6 @feature-161`).
  It is the precedent for retiring a dead key by config migration, and it requires that new config migrations do
  not reintroduce retired keys. Context for branch (b) only.
- **PRESERVE** `@AC-11` "A per-user config value overrides the global value"
  (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`, `@FR-9 @feature-147`). It sets the
  scope-resolution semantics for `portfolio.*` keys, which branch (a) must not break.
- **PRESERVE** `@AC-18` "Deregistering an offline account purges its baseline rows" (`docs/sdd/business-rules/platform.feature`,
  `@FR-8 @feature-163`). A branch (a) writer must not snapshot purged accounts. See also `@AC-15 @FR-1 @feature-157`
  in the same suite.
- **EXTEND** (none). The new `@AC-1`, `@AC-2`, `@AC-3`, `@AC-4`/`@AC-5` and `@AC-6` add behavior beside the
  guarantees above and do not alter any existing `@AC-*`.
- No CHANGE-class rule found.
- **No existing `@AC-*` covers this subject.** Nothing yet guarantees subscriber isolation, empty-caller rejection
  on `StreamPortfolioUpdates`, or `portfolio.snapshot.interval_minutes`, so feature 264's scenarios are the first.
  Doc-only guarantees that FR-1/FR-2 agree with live in portfolio `CLAUDE.md`: the H-3 `GetSnapshot` rule
  `portfolio_id == caller`, and the rule that a missing header on the self-scoped streaming RPC gives
  `InvalidArgument "user_id required"`.
- **Coverage caveat (scenario-recon).** Fully read: `platform.feature`, `fix-after-hours-positions-priced.feature`
  and `surface-signal-weight-decay-config.feature`. `config-secrets-and-scoping.feature` was read in part. The other
  12 portfolio and 3 config suites were keyword-grepped only. Promotion must keep the `@feature-264` tag, because
  `@AC-1..6` reuse numbers from other features.

## Dependencies

- **Proto/RPC.** None anticipated. `StreamPortfolioUpdates` is at `packages/proto/portfolio/v1/portfolio.proto:17`
  and its request at `:214`. The request message's fields were not opened; the handlers read only `TradingMode`.
  Identity comes from `x-user-id` metadata, not a request field.
- **Migration.**
  - Portfolio: none.
  - Config, branch (b) only: next number is **`033` or higher**. Trunk tip and every ref seen by
    `git log --all` end at `030`. `031` is claimed by feature 243 (`031_heal_indicators_sandbox_keys_full_dotted`)
    and `032` by both 244 and 248 (an existing collision, routed outside this feature). Proposed name:
    `033_retire_portfolio_snapshot_interval.{up,down}.sql`. Re-derive at spec time across all refs (fails.md
    2026-07-29, 2026-08-06).
- **Config keys.** `portfolio.snapshot.interval_minutes` already exists and is either made live (a) or retired (b).
  - It is stored full-dotted after 029.
  - Seeds: global `5` (001) and production `1` (002).
  - Readers: only `portfolio_service.go:895`. Digest grep found no reference in ui, agent, config source, scripts,
    `.do` or docker-compose.
- **Inter-service edges.** None new.
- **New env vars / ports.** None.

## Risks / Not-found

- **`Subscribe` signature change ripples into tests.** Adding an owner argument breaks these call sites:
  - `portfolio_quote_deadline_test.go:321,:396,:424`
  - `offline_account_pnl_test.go:320`
  - the literal map construction at `portfolio_quote_deadline_test.go:106`
  - the constructor at `portfolio_service.go:155`

  All must be updated in the same step.
- **No stream-handler tests exist** for either the Connect or gRPC `StreamPortfolioUpdates` path.
  - `@AC-1`, `@AC-2`, `@AC-3` and `@AC-6` need new fakes: a `PortfolioService_StreamPortfolioUpdatesServer` and a
    Connect `ServerStream`.
  - `NewPortfolioHandler` takes a concrete `*service.PortfolioService`, so handler-level isolation tests need a real
    service value. Use an exported or test-only constructor. `@AC-2`/`@AC-6` can use the nil-service pattern instead.
  - These are the first handler-level fixtures for this RPC, so they need C-13 canonical fixture placement.
- **Branch (a) gaps:**
  - No repository method lists all users with positions, so a new `DISTINCT user_id` query is needed.
  - The writer has no fake-clock or injectable-ticker seam, and `@AC-4` pins a fake service clock.
  - Writes add up to one `InsertSnapshot` per user per interval through PgBouncer `:25061` (pooled, default 2), so
    the load must be stated under F-06.
  - Periodic snapshots would also count as the "absolute snapshot" that insights.md 2026-08-26 (157) relies on.
    Confirm they do not change existing semantics.
- **Branch (b) gaps:**
  - The `down` must restore the full-dotted key form (post-029), not the bare form.
  - The 001 row's environment after 002 was not verified, so it is unknown whether a separate `staging` row exists.
    The up file should delete by `namespace = 'portfolio' AND key IN ('portfolio.snapshot.interval_minutes', 'snapshot.interval_minutes')`
    across every environment and `user_id`, so it does not depend on which scopes exist.
  - **`@AC-5` has no existing harness.** No config-service test applies migrations or asserts on seeds (the tests in
    `services/xstockstrat-config/src/__tests__/` mock the DB). Design must choose either a real-DB migration test or
    a static scan of `migrations/`.
- **Doc drift to fix with the change:**
  - Portfolio `CLAUDE.md:99` (key row).
  - Portfolio `CLAUDE.md:139`: the `portfolio.snapshot` event says "Periodic snapshot written", which is inaccurate
    today because the snapshot is written per fill.
  - `services/xstockstrat-portfolio/docs/context-constitution-findings.md:29` (`StartSnapshotWriter` row).
  - `docs/repo-surveyor/debt-radar-findings.md:236` (D-12).
  - `docs/context-constitution.md:40` (long line that matches the key; inspect it at spec time).
  - The dated report `docs/reports/2026-08-07-config-governance-audit.md:202` is not edited.
  - Root `CLAUDE.md` teardown: running the context-constitution refresh is required.
- **Same-file overlap.** `portfolio_service.go` is also edited in disjoint regions by 242, 251, 256 and 257. This is
  rebase/merge-order only.
  - Per insights.md (feature 125, "recon/spec-quoted code skeletons go stale"), re-read `broadcastSnapshot` and the
    handlers at execute time.
- **Digest discrepancy, resolved.** Digest 2 said `acceptance.feature` still had a single combined FR-4 scenario.
  On the feature branch it is already split into `@AC-4` (branch a) and `@AC-5` (branch b). Design deletes the loser.
- **Not found:**
  - Any caller of `StartSnapshotWriter`.
  - An owner field on the portfolio subscriber.
  - Existing `StreamPortfolioUpdates` handler tests.
  - A ticker clock seam.
  - Any config migration `031`+ on any ref.
- **Prior record.** `docs/reports/2026-09-16-trading-system-security-audit.md:177` already noted the broadcast leak
  but it was never triaged.

## Recommended Scope

Advisory only. Design (C-11) decides FR-4. Recon evidence favours **branch (b), retire**, because:

- branch (a) needs a new all-users query, a clock seam, new periodic DB writes, and a decision on whether periodic
  rows change what `GetSnapshot` returns;
- no surface reads periodic snapshots (Consumer Surface: none);
- YAGNI (C-18).

Branch (b) adds a second service, so the context.md triage note says to escalate the design depth to full.

Proposed steps:

1. **service + test (portfolio).** Owner-scope the subscriber.
   - Change `subs` to `map[string]snapshotSubscriber{ch, userID}` and `Subscribe(id, userID)`.
   - Make `broadcastSnapshot` skip non-owners, fail-closed.
   - Update all existing call sites.
   - Service-level isolation test modelled on trading's `:111` test (`@AC-1` core).
2. **handler + test (portfolio).**
   - gRPC adapter: add the empty-caller `codes.InvalidArgument` check before `Subscribe`, and pass the caller to
     `Subscribe`.
   - Connect path: pass the caller to `Subscribe`.
   - Stream fakes for `@AC-1`, `@AC-2`, `@AC-3` and `@AC-6`.
3. **FR-4.** Either:
   - (b) delete `StartSnapshotWriter`, add config migration `033_retire_portfolio_snapshot_interval.{up,down}.sql`,
     and add an `@AC-5` test (harness per design); or
   - (a) add a multi-user writer, the repo query, a clock seam, wiring in `main.go:64-69`, and an `@AC-4` test.
4. **docs.**
   - Portfolio `CLAUDE.md:99,:139`.
   - `context-constitution-findings.md:29`.
   - A `config-governance.md` § Per-Feature Registered Keys entry.
   - The D-12/D-24 status in `debt-radar-findings.md`.
   - Teardown refresh.
