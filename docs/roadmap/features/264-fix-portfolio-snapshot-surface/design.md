# Design: fix-portfolio-snapshot-surface

**Created**: 2026-10-22
**Rounds**: 2 (full; termination: approved)
**Approved by**: user @ 2026-10-22 (operator design-gate decision, round 2: "APPROVED as synthesized", Floor clear)
**Grounded in**: recon.md

---

## Chosen Approach

Scope is D-24 (FR-1..FR-3) and D-12 (FR-4), Track C, SEV-2. The fix is **internal only**. The one consumer
surface is the portfolio gRPC `StreamPortfolioUpdates` RPC, and no UI segment or Agent tool subscribes to it today
(recon.md § Codebase Map). So the fix closes the leak before any consumer is wired. No proto change.

### FR-1..FR-3 (D-24): owner-scoped, fail-closed fan-out

**Service: `services/xstockstrat-portfolio/internal/service/portfolio_service.go`.**

- `subs` (`:54`, built at `:155`; recon.md:23-24) changes from `map[string]chan *PortfolioSnapshot` to
  `map[string]snapshotSubscriber{ch chan *portfoliov1.PortfolioSnapshot; userID string}`. This copies trading's
  `orderSubscriber` (`services/xstockstrat-trading/internal/service/trading.go:344-357`; recon.md:77-81).
- `Subscribe(id, userID string)` replaces `Subscribe(id)` (`:875`). `Unsubscribe(id)` (`:884`) keeps its signature
  and still closes `sub.ch` (recon.md:25-26).
- `broadcastSnapshot` (`:908`) skips every subscriber where `sub.userID != userID`. The skip goes inside the
  fan-out loop (`:936-943`; recon.md:30). The match is strict, with **no** empty-means-all mode. That deliberately
  differs from `trading.go:390` (recon.md:82-83).
- Valuation, the unpriced skip (`:915-919`), `InsertSnapshot` and `emitEvent` stay **before** the loop. They keep
  running on the fill `ctx` passed at `:376` (recon.md:31). The emit still carries the request's `x-trace-id`
  (C-03, operator decision 2026-10-21), and feature-231 @AC-2/@AC-8 hold.
- Test call sites that need the new signature: `portfolio_quote_deadline_test.go:106,321,396,424` and
  `offline_account_pnl_test.go:320`.

**Handler: `services/xstockstrat-portfolio/internal/handler/portfolio_handler.go`.**

- Add an unexported consumer-side interface:
  `type snapshotHub interface { Subscribe(id, userID string) chan *portfoliov1.PortfolioSnapshot; Unsubscribe(id string) }`.
  `*service.PortfolioService` satisfies it.
- Add one unexported helper:
  `streamSnapshots(ctx, hub snapshotHub, userID, subID string, mode commonv1.TradingMode, send func(*portfoliov1.PortfolioSnapshot) error) error`.
  It replaces the subscribe / defer-unsubscribe / select / TradingMode-filter loop that exists twice today, at
  Connect `:119-138` and gRPC `:293-311` (recon.md:37-45).
- **Connect `StreamPortfolioUpdates`** keeps its empty-caller check at `:115-118`, then calls the helper with
  `stream.Send`.
- **gRPC adapter.** The adapter (`:292-294`) gets
  `if userID == "" { return status.Error(codes.InvalidArgument, "user_id required") }`. The check runs **before** it
  builds `subID` or subscribes, so an anonymous caller is never registered (recon.md:90-92). Each caller builds
  `subID` only after the check, as `fmt.Sprintf("portfolio-%s-%p", userID, stream)`.
- Identity still comes only from `x-user-id` via `streamUserID` (`:28`; recon.md:35). The body `user_id` is
  `[deprecated = true]` with the comment "body value ignored" (`packages/proto/portfolio/v1/portfolio.proto:215`),
  and it stays ignored.
- No new exported symbol.
- **Note:** the Connect `StreamPortfolioUpdates` is **not mounted**. `cmd/server/main.go:94` registers only
  `hdl.GRPCHandler()`. @AC-3/@AC-6 therefore guard a dead path. They stay because the operator fixed FR-3, and the
  shared helper makes keeping them cheap.

**Tests (C-08, C-13, C-15).**

| Scenario | Package | How it is tested |
|---|---|---|
| @AC-1 owner isolation | `service` | Uses `newQuoteSvc` (`portfolio_quote_deadline_test.go:93`; recon.md:98) and the shape of `TestBroadcastOrder_ScopesToSubscriberUser` (`trading_ownership_test.go:111`; recon.md:84-85). Calls `broadcastSnapshot` directly and asserts per-subscriber channels. |
| @AC-2, @AC-6 empty caller | `handler` | A test-local fake `snapshotHub` records calls. The test asserts `codes.InvalidArgument` / `connect.CodeInvalidArgument` and **zero** `Subscribe` calls on the fake. No nil-service panic. |
| @AC-3 Connect isolation | `handler` | Waits on the fake hub's "subscribed" signal, then pushes a snapshot. A must receive it within a bound. B must receive nothing in a `select` against `time.After(100ms)`. |

- For @AC-1 the spec picks one of two options and records the Gherkin edit in context.md:
  - reword the When step to "a snapshot is broadcast for u-1", or
  - drive the test through the fill path at `:376`.
- The fake gRPC server stream is test-local in `internal/handler/`: it embeds `grpc.ServerStream` and overrides
  `Context`/`Send`.

### FR-4 (D-12): branch (b), retire the key

- Delete `StartSnapshotWriter` (`portfolio_service.go:893-906`). It has no callers; `main.go:64-69` starts only the
  consumers (recon.md:20-21, :32-35).
- **Delete @AC-4** (branch a) from `acceptance.feature`.
- **New config migration `034_retire_portfolio_snapshot_interval.{up,down}.sql`** in
  `services/xstockstrat-config/migrations/`.
- **Up** follows the `020_remove_analysis_signal_source_weights.up.sql:8` pattern (recon.md:103-107):
  `DELETE FROM config.config_values WHERE namespace='portfolio' AND key IN ('portfolio.snapshot.interval_minutes','snapshot.interval_minutes')`.
  This covers every environment and every `user_id`. 029 rewrites only `key` (`029:24-28`; recon.md:60-62), so
  both stored forms are matched.
- **Down** is a literal copy of the `020_…down.sql:1-24` layout: its header, the column list including `is_secret`,
  `ON CONFLICT (namespace, key, environment, COALESCE(user_id,'')) DO NOTHING`, and the clobber note. It restores
  exactly two rows:

  | Environment | Row | Provenance |
  |---|---|---|
  | staging | `('portfolio','portfolio.snapshot.interval_minutes','int','5',FALSE,'Portfolio snapshot frequency','5','xstockstrat-portfolio','staging',NULL)` | `001_config_tables.up.sql:68`, renamed dev→staging at `017_config_secrets_and_scoping.up.sql:38` |
  | production | `('portfolio','portfolio.snapshot.interval_minutes','int','1',FALSE,'Portfolio snapshot frequency (prod)','1','xstockstrat-portfolio','production',NULL)` | `002_config_environment.up.sql:69` |

- **Migration number 034.**
  - The latest file on disk is `030` (recon.md:63-65).
  - 031 is claimed by 243 (`243-fix-sandbox-seed-keys/design.md:13`).
  - 032 is double-claimed by 244 (`implementation-spec.md:1067`) and 248 (`implementation-spec.md:133`). Resolving
    that collision will most likely move one of them to 033.
  - The spec adds a reservation plus a sequencing row (264 after 243, 244, 248) to
    `docs/roadmap/features/merge-order.md`, per its pre-assignment note at `:197-199`.
  - The final step carries a literal **two-sided pre-merge gate**, run after `git fetch` on
    `git ls-tree --name-only origin/main-dev services/xstockstrat-config/migrations/`:
    - (a) no number ≥ 034 exists;
    - (b) 031, 032 and 033 are each present, or that number's owner is sequenced after 264 in merge-order.md.
  - If either check fails, renumber or hold the merge.
- **@AC-5 is reworded** to a static scan of "the config migration set". It is a `node:test` test in
  `services/xstockstrat-config/src/__tests__/`, run via `tsc && node --test dist/__tests__/*.test.js`
  (`services/xstockstrat-config/package.json:12`). It resolves `../../migrations` from `__dirname`.
  - It scans `*.up.sql` sorted by numeric prefix and matches both quoted key forms. It asserts:
    - (i) at least one up file matches;
    - (ii) the highest-numbered match contains a `DELETE FROM config.config_values` statement, and that statement
      itself contains `namespace = 'portfolio'` and a key literal;
    - (iii) no later file INSERTs either form.
  - Applied state is checked by a dev-smoke step: `scripts/db-migrate.sh`, then `ListKeys` in production and staging.
- Config-service source is unchanged. No new config key; one key is removed.

### Build order

1. Service scoping, call-site updates, `package service` @AC-1 test.
2. `snapshotHub` + `streamSnapshots`, the gRPC empty-caller check, fake-hub handler tests (@AC-2/@AC-3/@AC-6).
3. Delete the writer and @AC-4. Add migration 034 + `.down.sql`, the @AC-5 `node:test` scan, and the merge-order.md
   reservation and sequencing row.
4. Docs:
   - portfolio `CLAUDE.md:99` and `:139`;
   - `services/xstockstrat-portfolio/docs/context-constitution-findings.md:29`;
   - `docs/repo-surveyor/debt-radar-findings.md:236`;
   - a "Removes" entry in the `docs/patterns/config-governance.md` Per-Feature Registered Keys log (`:423-427` form);
   - a check of `docs/context-constitution.md:40`.

   Then run the context-constitution teardown refresh.
5. At execute time, re-read `broadcastSnapshot` and both handlers first. Features 242/251/256/257 edit the same files.

## Rejected Alternatives

- **Exported `(*PortfolioService) SubscriberCount()` as a test seam.** Rejected under C-18: it is a production symbol
  that exists only for tests. The fake `snapshotHub` gives the same "never registered" proof.
- **Handler tests on `newQuoteSvc` or a real service.** Rejected because they would not compile or run:
  - `newQuoteSvc` lives in a `package service` test file;
  - `NewPortfolioService` (`:114`) dials mTLS dependencies;
  - `broadcastSnapshot` is unexported;
  - a bare struct panics on its nil map.
- **Nil-service panic as the never-registered proof.** Rejected because on RED it crashes the whole test binary
  instead of failing one named test.
- **Filter in the handler instead of the producer.** Rejected because every user's snapshot would still reach every
  channel, and each consumer would have to re-implement the check.
- **Trading-style empty-means-all filter (`trading.go:390`).** Rejected because fail-closed is required and
  portfolio has no internal cross-user subscriber.
- **A defense-in-depth `snap.PortfolioId == userID` check in the helper.** Rejected as DRY/YAGNI: the producer
  filter is enough.
- **A `subKey any` helper parameter.** Rejected under C-18 as speculative and loosely typed. A `subID string` built
  after validation is enough.
- **Deleting the unmounted Connect `StreamPortfolioUpdates` and dropping @AC-3/@AC-6.** Rejected as scope creep:
  FR-3 is operator-fixed.
- **FR-4 branch (a), wiring `StartSnapshotWriter`.** Rejected under C-18/YAGNI and F-06. It would need:
  - a new all-users query;
  - a clock seam;
  - periodic PgBouncer writes;

  and nothing consumes those rows.
- **Reserving 033 with a one-sided "≥ ours" gate.** Rejected because 033 is the likely landing spot for the 244/248
  renumber. A one-sided gate also misses the case where 264 merges first and peers' lower numbers are silently
  skipped.
- **Vitest for @AC-5.** Rejected because xstockstrat-config uses `node --test` over compiled `dist`.
- **@AC-5 check (ii) as "a DELETE scoped to namespace=portfolio".** Rejected as too weak: it would pass a
  namespace-wide or wrong-key DELETE.
- **A real-DB migration-apply test for @AC-5.** Rejected because no config test harness applies migrations, so this
  is out of proportion for a SEV-2 key retirement.

## Open Risks

- [ ] **Migration ordering is a process control.** If the two-sided gate is skipped, or the 244/248 renumber lands
  on 034, golang-migrate silently skips a migration on environments that are already migrated, and the static @AC-5
  scan cannot detect it. To be addressed at: the final-step pre-merge gate, plus the merge-order.md row (step 3).
- [ ] **@AC-5 is checked statically.** A C-15 reviewer may want proof from an applied database. Fallback: the
  dev-smoke step `db-migrate.sh` + `ListKeys` in both environments (step 3 / dev smoke).
- [ ] **Same-file overlap with 242/251/256/257** on `portfolio_service.go` and `portfolio_handler.go`. The cited line
  numbers will drift. To be addressed at: steps 1-2, by re-reading at execute time.
- [ ] **The down migration restores only the two global seed rows.** Per-user operator overrides are lost on
  rollback. Accepted, as in 020 (step 3).
- [ ] **The DELETE writes no `config_audit` row and no pg_notify DELTA,** because the audit triggers fire on
  INSERT/UPDATE only. Running instances keep the stale value until restart. Impact is nil because nothing reads the
  key after the writer is deleted. Accepted, as in 020; recorded in context.md (step 3).

## Constitution Rules Touched

- `C-01` — honored by: every claim cites recon.md or verified `path:line`, and `/sdd-spec` re-greps before writing
  steps.
- `C-03` — honored by: `InsertSnapshot`/`emitEvent` stay on the fill `ctx` (`:376`), so `x-trace-id` propagates.
  The only background path (`StartSnapshotWriter`) is deleted, not re-contexted.
- `C-05` — honored by: one key is retired by migration and logged in config-governance.md, and no key is added.
- `C-07` — honored by: `034_retire_portfolio_snapshot_interval.{up,down}.sql` is reserved past the 031-033 peer
  claims, with the two-sided pre-merge gate.
- `C-08` — honored by: each service/handler/migration step has a paired test step (@AC-1/2/3/5/6) within portfolio
  and config CI thresholds.
- `C-11` — honored by: the Track C path (triage → review → full design).
- `C-13` — honored by: the fake hub and fake gRPC stream are test-local in `internal/handler/`. The service test
  reuses the existing `newQuoteSvc` harness.
- `C-15` — honored by: every scenario traces to a test. The @AC-4 deletion, the @AC-5 rewording and the @AC-1
  When-step choice are recorded in context.md.
- `C-16` — honored by: § Business Rules Touched below.
- `C-18` — honored by: only an unexported interface and helper are added. No test-only export. The dead writer is
  deleted rather than wired.
- `F-01` — honored by: no applied migration is edited; a new migration is added.
- `F-04` — honored by: no invented path or symbol. Line numbers are flagged to re-read at execute time.
- `F-06` — honored by: branch (b) adds no periodic writes or connections, and the pool budget is unchanged.
- `F-07` — honored by: no hardcoded config value is introduced. The only config read, `GetInt(..., 5)` at `:895`,
  is deleted together with its key.

## Business Rules Touched (C-16)

- EXTEND `@AC-1` "A snapshot stream subscriber receives only its own snapshots" (feature-local) — new isolation
  guarantee. Covered by the operator scope decision D-24 (2026-10-21; context.md).
- EXTEND `@AC-2` "A snapshot stream with no caller identity is rejected on the gRPC path" — new fail-closed
  guarantee. Covered by D-24.
- EXTEND `@AC-3` "The Connect path also isolates subscribers" — covered by D-24.
- PRESERVE `@AC-6` "A snapshot stream with no caller identity stays rejected on the Connect path" — not regressed:
  the Connect check at `:115-118` is kept ahead of the helper.
- CHANGE `@AC-4` "portfolio.snapshot.interval_minutes is honoured (FR-4 branch a)" — **deleted** (branch b chosen).
  Signed off by the operator @ 2026-10-22 at the round-2 design gate ("SIGNS OFF the CHANGE to @AC-4 (deleted) and
  @AC-5"; context.md, Session 2026-10-22 — sdd-design approved).
- CHANGE `@AC-5` "portfolio.snapshot.interval_minutes is retired (FR-4 branch b)" — Given/When reworded to a static
  scan of the config migration set, plus a dev-smoke `ListKeys`. Signed off by the operator @ 2026-10-22 (same
  record).
- PRESERVE `@AC-2` "The persisted equity snapshot values broker positions first and marks the rest"
  (`services/xstockstrat-portfolio/acceptance/fix-after-hours-positions-priced.feature`, @feature-231) — not
  regressed: valuation, `InsertSnapshot` and `emitEvent` run once, before the owner filter, and the matching
  subscriber still gets exactly one update.
- PRESERVE `@AC-8` "Any unpriced position skips the equity snapshot and names the symbol" (same suite) — not
  regressed: the unpriced skip (`:915-919`) still returns before any emit or fan-out.
- PRESERVE `@AC-8` "the dead source-weights key is gone after the removal migration"
  (`services/xstockstrat-config/acceptance/surface-signal-weight-decay-config.feature`, @feature-161) — not
  regressed: 034 inserts no retired key, and the @AC-5 scan's check (iii) enforces the same rule for this key.
- PRESERVE `@AC-5` "Header-propagation semantics are unchanged beneath mTLS" (`docs/sdd/business-rules/platform.feature`,
  @feature-210) — not regressed: identity is still read from the propagated `x-user-id` via `streamUserID`, and
  propagation code is untouched.
