# Context Log: fix-portfolio-snapshot-surface

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-portfolio-snapshot-surface-defect.md` (Issues disabled).
- Source: repo-surveyor debt-radar scan `docs/repo-surveyor/debt-radar-findings.md` @ 4535695, findings **D-12**, **D-24**.
  Both re-verified on main-dev @ a053b0e and both reproduce in code. None excluded.
- Severity: SEV-2 (group; D-24 is latent security, D-12 alone was rated lower). Impact type: cross-tenant-data-exposure.
  Environment: dev (main-dev) @ a053b0e. Config-only: no.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2 (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..4), context.md; report sidecar `.status` (`triaged`).
- Affected services: xstockstrat-portfolio. xstockstrat-config is affected only if D-12 retires the key.
- Root cause hypothesis: the subscriber map has no owner, and filtering was deferred to a never-built consumer (D-24).
  The writer was scaffolded per user and never wired; per-fill broadcast masked it (D-12).
- Line drift (scan @ 4535695 → a053b0e):
  - The scan cites `portfolio_service.go:937`, `portfolio_handler.go:129`, `:292-302`, `:894`.
  - Current: the broadcast loop is at `:936-942`, the `StartSnapshotWriter` definition at `:893-906`, the Connect
    handler at `:114-138` (TradingMode filter `:129`) and the gRPC adapter at `:291-311`.
- **Nuance vs the scan:** the scan calls D-24 latent because there is "no client caller". That is true of the consumer
  side only. The producer is live: `processOrderFill` calls `broadcastSnapshot` after every fill
  (`portfolio_service.go:376`), so snapshots are produced and fanned out today and are dropped only because nobody subscribes.
  For D-12, per-fill snapshots also mean `GetSnapshot` has data, but only at fill times.
- Prior record: `docs/reports/2026-09-16-trading-system-security-audit.md:177` already noted "`StreamPortfolioUpdates`
  broadcasts every user's snapshot". It was never triaged into a feature.
- Overlaps:
  - None of features 240–253 touch `StartSnapshotWriter`, `broadcastSnapshot` or `portfolio_handler.go`.
  - **251-fix-getpnl-source-service**, **256-fix-offline-book-consistency** and **257-fix-ledger-query-pagination** edit
    other functions in `portfolio_service.go`. Same file, so rebase/merge-order only.
- Design fork for D-12: wire vs delete.
  - Wiring needs a multi-user loop (the current signature is per user) and adds periodic `InsertSnapshot` writes. Portfolio
    is on PgBouncer `:25061`, so the pool impact is small but must be stated.
  - Deleting needs a new config migration to retire the seeded rows, plus a governance log entry.
- Recommended design depth: quick → `/sdd-design fix-portfolio-snapshot-surface quick` (rationale: SEV-2 and a single service
  with no proto, which is the C-0 quick trigger). **Escalate to full** (`/sdd-design fix-portfolio-snapshot-surface`) if
  design picks the delete-the-key path, because that adds a config-service migration and a second service.
- Development branch: feature/fix-portfolio-snapshot-surface

## Session 2026-10-21 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria verdict: PASS WITH WARNINGS (no fails, no floor breaches).
- Warnings (and how each was handled):
  1. C-15: `@AC-6` (Connect empty caller) passes on the buggy code, because `portfolio_handler.go:115-118` already
     rejects an empty caller. Only the gRPC adapter (`:292-295`) lacks the check. **Resolved:** AC-6 is relabelled
     `@non-regression` (no longer `@regression`). The Problem Statement and FR-3 now say the empty-caller defect is
     gRPC-only and the owner-filter gap is on both paths (Connect loop `:125-134`).
  2. Criterion 1: no persona named. **Resolved:** the Problem Statement now names the tenant/trader whose equity would leak.
  3. Criterion 9: AC-4 and AC-5 are mutually exclusive until design picks the FR-4 branch. **Carried to /sdd-design:**
     design must delete the losing scenario before impl-spec review.
  4. Criterion 8: AC-5's doc-table `Then` was not a runtime outcome, and AC-4 depended on timing. **Resolved:** the
     doc-table check moved to the product-spec Fix Scope, and AC-4 is pinned to a fake service clock.
  5. Branch (b) hygiene: **Resolved:** `services/xstockstrat-portfolio/docs/context-constitution-findings.md:29` is
     added to the update list. Under branch (a) the pooled pool budget (default 2) is already stated.
- Overlap findings (WARN only, no FAIL):
  - Same-file, disjoint-region rebase overlap in `services/xstockstrat-portfolio/internal/service/portfolio_service.go`
    with 242 fix-push-untargeted-broadcast, 256 fix-offline-book-consistency, 257 fix-ledger-query-pagination and
    251 fix-getpnl-source-service.
  - No live peer names `portfolio_handler.go`.
  - No collision on the `portfolio.snapshot.interval_minutes` key.
  - Branch (b) migration NNN: trunk tip is `030`, and `031`/`032` are claimed by 243/244/248, so this feature uses
    `033` or higher (re-derive at spec time). Out of scope for this feature, to be routed separately: 244 and 248
    both claim `032_*`.
  - No merge-order row is recommended.
- OPERATOR DECISIONS (binding, recorded 2026-10-21):
  - Grouped by service+theme from the 2026-10-20 debt-radar scan; Track C.
  - Scope is D-12, D-24.
- Next: `/sdd-design fix-portfolio-snapshot-surface`.

## Session 2026-10-22 — sdd-batch design state recovered (round 1)

- The batch run that produced round 1 was cut off by the session usage limit before its gate writer persisted the debate state. This block is the round-1 synthesis restored verbatim from the run journal (`synth:fix-portfolio-snapshot-surface:r1`), so the next /sdd-batch run resumes from it instead of redoing the debate.

```sdd-batch-design-state
{
  "round": 1,
  "synth": {
    "approach": "Round 1 synthesis. Approach accepted, with spec-time fixes.\n\n**FR-1..FR-3 (D-24): owner-scoped fan-out, fail-closed.**\n1. **Service \u2014 `services/xstockstrat-portfolio/internal/service/portfolio_service.go`.**\n   - Replace `subs map[string]chan *PortfolioSnapshot` (`:54`, built at `:155`) with `map[string]snapshotSubscriber{ch chan *PortfolioSnapshot; userID string}`. This copies trading's `orderSubscriber` (`services/xstockstrat-trading/internal/service/trading.go:344-357`).\n   - `Subscribe(id, userID string)` replaces `Subscribe(id)`. `Unsubscribe(id)` keeps its signature and closes `sub.ch`.\n   - The `broadcastSnapshot` fan-out loop (`:936-943`) skips any subscriber where `sub.userID != userID`. This is strict equality with no empty-means-all mode, so it deliberately differs from `trading.go:390`.\n   - Valuation, the unpriced-skip, `InsertSnapshot` and `emitEvent` (`:909-934`) are unchanged and still run before the loop. That keeps feature 231 @AC-2 (one event + one update) and @AC-8 (skip with no event and no update).\n   - The fill `ctx` (`:376`) still reaches `emitEvent`, so C-03 / the operator trace-id decision is met.\n2. **Handler \u2014 `services/xstockstrat-portfolio/internal/handler/portfolio_handler.go`.**\n   - Add one unexported helper: `(h *PortfolioHandler) streamSnapshots(ctx context.Context, userID, subID string, mode commonv1.TradingMode, send func(*portfoliov1.PortfolioSnapshot) error) error`.\n   - Change from the proposal: it takes `subID string`, not `subKey any`. Each caller builds `subID` as `fmt.Sprintf(\"portfolio-%s-%p\", userID, stream)` after it has checked `userID`.\n   - The helper holds the subscribe/defer-unsubscribe/select loop and the `TradingMode` filter that today exist twice (`:119-138` and `:293-311`).\n   - The Connect `StreamPortfolioUpdates` keeps its empty-caller check (`:115-118`) and then calls the helper with `stream.Send`.\n   - The gRPC adapter (`:292-294`) gets `if userID == \"\" { return status.Error(codes.InvalidArgument, \"user_id required\") }` before it formats `subID` or subscribes. It then calls the helper with `grpcStream.Send`.\n\n**FR-4 (D-12): branch (b), retire the key.**\n- Delete `StartSnapshotWriter` (`portfolio_service.go:893-906`). It has no callers; `main.go:64-69` does not start it.\n- Add config migration `NNN_retire_portfolio_snapshot_interval.{up,down}.sql`. NNN is provisionally 033; 030 is the latest on disk.\n- **Up:** `DELETE FROM config.config_values WHERE namespace='portfolio' AND key IN ('portfolio.snapshot.interval_minutes','snapshot.interval_minutes')`, across every environment and every `user_id`.\n- **Down:** copy the 020 down file. Use its column list `(namespace, key, value_type, value_data, is_secret, description, default_value, consuming_service, environment, user_id)` and insert exactly two rows:\n  - `('portfolio','portfolio.snapshot.interval_minutes','int','5',FALSE,'Portfolio snapshot frequency','5','xstockstrat-portfolio','staging',NULL)`\n  - `('portfolio','portfolio.snapshot.interval_minutes','int','1',FALSE,'Portfolio snapshot frequency (prod)','5','xstockstrat-portfolio','production',NULL)`\n\n  Add `ON CONFLICT (namespace, key, environment, COALESCE(user_id,'')) DO NOTHING` and the clobber-caveat comment from 020. The spec verifies the default_value and description text against 001/002/029.\n- Delete @AC-4 from `acceptance.feature`.\n- **@AC-5 harness:** a static test in `services/xstockstrat-config/src/__tests__/` that scans `migrations/*.up.sql` only. It matches both literal key forms and asserts:\n  - the highest-numbered up file containing either form is a `DELETE` scoped to `namespace='portfolio'`;\n  - no later file INSERTs either form.\n\n  029's generic UPDATE never names the key, so it is not matched. Reword @AC-5's Given/When to \"the config migration set\". Add a `db-migrate.sh` + `ListKeys` check to the dev smoke checklist. Record both changes in `context.md`.\n\n**Tests.**\n- **@AC-1, service isolation:** uses the `newQuoteSvc` harness and the shape of `TestBroadcastOrder_ScopesToSubscriberUser`.\n- **@AC-1/@AC-3 through the helper:** wait until the subscription is registered (poll `len(svc.subs)` under `mu`) before broadcasting. Use a bounded wait for \"B receives nothing\", not a bare `len(ch)`.\n- **@AC-2/@AC-6 (empty caller):**\n  - Do not rely on a nil-service panic.\n  - Use a real service from an in-package constructor and assert `codes.InvalidArgument` plus `len(svc.subs)==0` after the call.\n  - If no real service is available, assert inside `recover()`.\n- **Fixture:** the fake gRPC server stream (embeds `grpc.ServerStream`, overrides `Context`/`Send`) is test-local in `internal/handler/` (C-13).\n- **Call sites to update:** `portfolio_quote_deadline_test.go:106,321,396,424` and `offline_account_pnl_test.go:320`.\n\n**Build order.**\n1. Service scoping, call sites and isolation test.\n2. Handler helper, gRPC empty-caller check and handler tests.\n3. Writer deletion, migration and @AC-5 static test.\n4. Docs: portfolio `CLAUDE.md:99` and `:139`, the isolation sentence next to the H-3 rule, `services/xstockstrat-portfolio/docs/context-constitution-findings.md:29`, `docs/repo-surveyor/debt-radar-findings.md:236`, the `config-governance.md` Removes log, and a check of `docs/context-constitution.md:40`. Then the context-constitution refresh at teardown.",
    "open_objections": [
      {
        "text": "The down migration has to restore the real scopes, not a 'global' environment: the two rows (staging/5 and production/1) with user_id NULL, using the 020 column list including is_secret. The proposal's 'global/5 + production/1, 030 layout' wording is wrong (002_config_environment.up.sql:7 default 'dev' became 'staging' under feature 147; see the 020 down comment). The fix is adopted in the approach; the spec must write both rows out exactly and check default_value/description against 001/002/029.",
        "blocking": false
      },
      {
        "text": "The migration number can be skipped silently (C-07, fails.md:2909). 032 is already double-claimed (features 244 and 248), and batch peers (fix-config-stream-resilience, fix-template-update-metadata and others) may add config migrations. If any of them lands a higher number first, golang-migrate never applies this file on environments that are already migrated. Required: reserve the number in docs/roadmap/features/merge-order.md at design time, and re-check `ls services/xstockstrat-config/migrations` against origin/main-dev right before merge, not only at spec time.",
        "blocking": false
      },
      {
        "text": "Using a nil-service panic as proof for @AC-2/@AC-6 crashes the whole internal/handler test binary on the buggy tree, so you get a crash rather than a named RED. Replace it with a real-service assertion (codes.InvalidArgument and len(svc.subs)==0), or recover() if that is not possible.",
        "blocking": false
      },
      {
        "text": "The @AC-1/@AC-3 helper tests can race: the helper subscribes in its own goroutine, so a broadcast may happen before registration. The tests must wait for registration and use a bounded negative wait.",
        "blocking": false
      },
      {
        "text": "@AC-5's static-scan semantics must be pinned as stated in the approach (up files only, both literal forms, highest-numbered match is a portfolio-scoped DELETE, no later INSERT). The @AC-5 Gherkin rewording and the dev-smoke `db-migrate.sh` + `ListKeys` step must be recorded in context.md, because the scenario text changes at design time.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-2",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-3",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-6",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-231 @AC-2 (single event + single update per fill)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-231 @AC-8 (unpriced skip: no event, no update)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-161 @AC-8 (retired key not reintroduced)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-210 platform @AC-5 (x-user-id identity read)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Filter in the handler instead of in broadcastSnapshot. Lost because every other user's snapshot would still reach every channel, and each future consumer would have to re-implement the check. Filtering at the producer closes the leak where it happens.",
      "Trading-style `sub.userID != \"\" &&` empty-means-all filter (trading.go:390). Lost because portfolio has no internal cross-user subscriber, and fail-closed is required.",
      "Delete the Connect StreamPortfolioUpdates (portfolio is gRPC-only) and drop @AC-3/@AC-6. Lost as scope creep. The shared helper already removes the risk that the two paths drift apart.",
      "`subKey any` helper parameter. Lost under C-18: it is speculative and loosely typed, and `subID string` built after validation is enough.",
      "FR-4 branch (a), wire StartSnapshotWriter. Lost under C-18/YAGNI: it needs a new all-users query, a clock seam, periodic writes through PgBouncer (F-06) and a decision on GetSnapshot semantics, and nothing would consume the rows.",
      "Real-DB migration-apply test for @AC-5. It matches the Gherkin exactly, but lost because no config test applies migrations today, so it would be new harness work and the opposite of low rework.",
      "Nil-service panic as the never-registered proof. Lost because on RED it crashes the whole test binary instead of producing a named failure."
    ],
    "open_risks": [
      "Migration ordering: if a peer config migration with a higher number merges first, golang-migrate silently skips this one on already-migrated environments. Mitigation: reserve the number in merge-order.md and re-check against main-dev at merge.",
      "@AC-5 is checked by a static scan, not by applying migrations and listing keys. A C-15 reviewer may still call that insufficient. Fallback: the dev-smoke `db-migrate.sh` + `ListKeys` step.",
      "Not verified: which environment the original 001 row actually carries after 002/147/029. The up migration's scope-agnostic DELETE covers this, but the down restore's exact rows and description text need a spec-time check against 001/002/029.",
      "Not verified: StreamPortfolioUpdatesRequest fields (portfolio.proto:214). If any owner/user_id field is read, it must be ignored in favour of x-user-id.",
      "The Subscribe signature change ripples into the existing test call sites (portfolio_quote_deadline_test.go and offline_account_pnl_test.go); a missed site breaks compilation."
    ],
    "constitution_rules_touched": [
      "C-03",
      "C-05",
      "C-07",
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "F-01",
      "F-06"
    ],
    "rationale": "The adversary rated the design SOUND and named no Floor breaches.\n\n**Accepted as proposed.** The proposal closes D-24 where the leak happens: an owner is stored on each subscriber and the fan-out in broadcastSnapshot keeps only exact matches, so a subscriber with no owner gets nothing. It covers both stream paths through one shared helper, and the gRPC adapter rejects an empty caller before it subscribes. It resolves D-12 the YAGNI way, by deleting the dead writer and retiring the key with a new config migration (F-01 holds because no applied migration is edited). This keeps as much existing behaviour as possible with low rework, as the user asked:\n- feature 231's rules hold because valuation, InsertSnapshot and emitEvent stay ahead of the filter;\n- the operator's trace-id decision is met because the fill ctx is unchanged.\n\n**Folded in from the adversary.** These are spec-time fixes, all non-blocking:\n- the down migration restores two rows (staging/production) with is_secret;\n- the helper takes subID string instead of subKey any;\n- @AC-2/@AC-6 are proven with a real service rather than a nil-service panic;\n- the helper tests wait for registration;\n- the @AC-5 scan semantics are pinned.\n\n**Business-rule impact.**\n- @AC-1/2/3 extend isolation and fail-closed behaviour, which scope D-24 sanctions.\n- Deleting @AC-4 and rewording @AC-5 follow from choosing branch (b). The operator decision covers only scope (D-12, D-24), not that choice, so these are flagged as not operator-covered and must be recorded in context.md.\n\n**Remaining action.** Migration-number reservation is the one item that needs action outside the spec, given the 032 collision and the peer config migrations in this batch."
  },
  "floor_breaches": []
}
```

## Session 2026-10-22 — sdd-batch design gate (round 2)

- The /sdd-design full debate has reached its approval gate after round 2 (gate policy: halt). design.md is not written and status.md is unchanged (`spec-ready`) until the operator approves.

## Session 2026-10-22 — sdd-design (approved)

- Phase 0 Recon: recon.md was already written (services: xstockstrat-portfolio, xstockstrat-config; key reuse
  patterns: trading's owner-scoped `orderSubscriber`, and the 020 retire-key migration).
- Phase 1 Grilling: 2 rounds (full), approved at the round-2 gate. Termination: approved, Floor clear.
  - **Chosen approach:**
    - Owner-scoped, fail-closed `broadcastSnapshot` fan-out.
    - An unexported handler `snapshotHub` interface and a shared `streamSnapshots` helper.
    - gRPC returns `InvalidArgument` on an empty caller before it subscribes.
    - Delete `StartSnapshotWriter` and retire `portfolio.snapshot.interval_minutes` via config migration 034.
  - **Rejected:**
    - FR-4 branch (a) (wire the writer).
    - An exported `SubscriberCount()` seam.
    - A handler-side filter.
    - An empty-means-all filter.
    - Reserving 033 with a one-sided gate.
    - Vitest.
    - A real-DB migration test.
- **Operator decision (binding, 2026-10-22, design gate r2):** "APPROVED as synthesized — D-12 branch (b): delete
  the zero-caller StartSnapshotWriter and retire portfolio.snapshot.interval_minutes via config migration 034
  (up/down as specified). SIGNS OFF the CHANGE to @AC-4 (deleted) and @AC-5. D-24 owner-scoped, fail-closed
  fan-out unchanged." This is the C-16 sign-off for both CHANGE lines in design.md.
- **Standing operator decision (2026-10-21) is honored:** `x-trace-id` is propagated, with no C-03 waiver.
  Snapshot persist and emit stay on the fill ctx (`portfolio_service.go:376`). The only background path is deleted.
- **Gherkin changes for /sdd-spec to apply (C-15):**
  - Delete @AC-4.
  - Reword @AC-5's Given/When to "the config migration set". The test is static because no config test applies
    migrations. Add a dev-smoke step: `scripts/db-migrate.sh`, then `ListKeys` in production and staging.
  - For @AC-1, either reword the When step to "a snapshot is broadcast for u-1" or drive the test through the fill
    path. The spec picks one and records it here.
- **Recorded trade-off:** the config audit triggers fire on INSERT/UPDATE only. The 034 DELETE therefore writes no
  `config_audit` row and sends no pg_notify DELTA, and running instances keep the stale value until restart.
  Impact is nil because nothing reads the key. This is the same trade-off as 020.
- **Recorded fact:** the Connect `StreamPortfolioUpdates` is unmounted (`cmd/server/main.go:94` registers only the
  gRPC handler). @AC-3/@AC-6 are kept because FR-3 is operator-fixed.
- Constitution rules touched: C-01, C-03, C-05, C-07, C-08, C-11, C-13, C-15, C-16, C-18, F-01, F-04, F-06, F-07.
  Floor breaches: none.
- Ledger: no new line. The migration-ordering trap is already recorded (fails.md:2909, :613).
- Status: spec-ready → design-approved.

## Open Threads

- [ ] **Migration ordering (C-07)** — target: the impl-spec final step, plus step 3.
  - Reserve `034_retire_portfolio_snapshot_interval` in `docs/roadmap/features/merge-order.md`, with a row
    sequencing 264 after 243, 244 and 248.
  - Before merge, run the literal two-sided gate on
    `git ls-tree --name-only origin/main-dev services/xstockstrat-config/migrations/`:
    - (a) no number ≥ 034 exists;
    - (b) 031, 032 and 033 are each present, or that number's owner is sequenced after 264.
  - The 244/248 `032` double-claim must be resolved first. If its renumber lands anywhere other than 033, re-check 034.
- [ ] **@AC-5 is checked statically, not against an applied DB (C-15)** — target: step 3 and dev smoke. Fallback:
  `db-migrate.sh` + `ListKeys` in both environments.
- [ ] **Same-file overlap with 242/251/256/257** on `portfolio_service.go` / `portfolio_handler.go` — target: steps
  1-2. Re-read at execute time because the line numbers drift.
- [ ] **The down migration restores only the two global seed rows**, so per-user overrides are lost on rollback.
  Accepted (020 precedent) — target: step 3.
- [ ] **The DELETE leaves no `config_audit` row and no pg_notify DELTA.** Accepted — target: step 3, recorded above.
- [x] **Gherkin edits** (@AC-4 delete, @AC-5 reword, @AC-1 When-step choice) — done at /sdd-spec 2026-10-22 (see that session).

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Round 2 synthesis. The round-1 design and round-2 proposal stand. The adversary's two blocking objections are adopted as fixes below, and both have concrete answers.\n\n**FR-1..FR-3 (D-24): owner-scoped fan-out, fail-closed. Unchanged.**\n- **Service, `services/xstockstrat-portfolio/internal/service/portfolio_service.go`.**\n  - `subs` (`:54`, built at `:155`) becomes `map[string]snapshotSubscriber{ch, userID}`, copying `services/xstockstrat-trading/internal/service/trading.go:344-357`.\n  - `Subscribe(id, userID string)` replaces `Subscribe(id)` (`:875`).\n  - `broadcastSnapshot` (`:908`) skips any sub where `sub.userID != userID` inside the fan-out loop (`:936-943`). This is strict equality with no empty-means-all mode.\n  - Valuation, the unpriced-skip, `InsertSnapshot` and `emitEvent` stay before the loop on the fill `ctx` from `:376`. That satisfies C-03 and the operator's trace-id decision.\n  - Call sites to update: `portfolio_quote_deadline_test.go:106,321,396,424` and `offline_account_pnl_test.go:320`.\n- **Handler, `services/xstockstrat-portfolio/internal/handler/portfolio_handler.go`. Change this round: an interface seam (adopted from objection 1).**\n  - Declare an unexported consumer-side interface in the handler package: `type snapshotHub interface { Subscribe(id, userID string) chan *portfoliov1.PortfolioSnapshot; Unsubscribe(id string) }`. `*service.PortfolioService` satisfies it.\n  - Add an unexported helper `streamSnapshots(ctx, hub snapshotHub, userID, subID string, mode commonv1.TradingMode, send func(*portfoliov1.PortfolioSnapshot) error) error`. It replaces the duplicated loops at `:119-138` (Connect) and `:293-311` (gRPC).\n  - Connect keeps its empty-caller check (`:115-118`).\n  - The gRPC adapter adds `status.Error(codes.InvalidArgument, \"user_id required\")` before it builds `subID` or calls `Subscribe`.\n  - The body `user_id` is still ignored. It is `[deprecated = true]` with \"body value ignored\" (`packages/proto/portfolio/v1/portfolio.proto:215`). No proto change.\n  - **`SubscriberCount()` is DROPPED.** No new exported symbol (C-18).\n\n**Tests.**\n- **@AC-1 owner isolation: `package service` test.**\n  - Uses `newQuoteSvc` (`portfolio_quote_deadline_test.go:93`), which is reachable only in-package, and the shape of `trading_ownership_test.go:111`.\n  - Calls `broadcastSnapshot` directly and asserts on `subs` channels.\n  - Reword @AC-1's When step to \"a snapshot is broadcast for u-1\", matching @AC-3. Alternatively, drive the test through the fill path at `:376`. The spec picks one and records it in context.md (C-15).\n- **@AC-3, @AC-2, @AC-6: `package handler` tests with a test-local fake hub (C-13).**\n  - The fake records `Subscribe` calls, signals on a channel when subscribed, and lets the test push snapshots. This replaces `Eventually` polling.\n  - @AC-2 and @AC-6 assert `codes.InvalidArgument` / `connect.CodeInvalidArgument` and zero `Subscribe` calls on the fake. No nil-service panic.\n  - @AC-3 (helper-level isolation of the delivered stream) waits on the fake's subscribed signal, then pushes a snapshot. Stream A must receive within a bound. B must receive nothing within a `select` against `time.After(100ms)`.\n- **Fake gRPC server stream:** embeds `grpc.ServerStream`, overrides `Context` and `Send`, test-local in `internal/handler/`.\n- **Record in design.md:** the Connect `StreamPortfolioUpdates` is not mounted. `cmd/server/main.go:94` registers only `hdl.GRPCHandler()`. @AC-3/@AC-6 therefore guard a dead path, and they stay because FR-3 is operator-fixed. The shared helper is what keeps them cheap.\n\n**FR-4 (D-12): branch (b), retire the key.**\n- Delete `StartSnapshotWriter` (`portfolio_service.go:893-906`). It has no callers. Delete @AC-4.\n- **Up:** `DELETE FROM config.config_values WHERE namespace='portfolio' AND key IN ('portfolio.snapshot.interval_minutes','snapshot.interval_minutes')`. It covers all environments and all `user_id`s.\n- **Down:** a literal copy of the `020_remove_analysis_signal_source_weights.down.sql:1-24` layout. Keep its header, the column list including `is_secret`, `ON CONFLICT (namespace, key, environment, COALESCE(user_id,'')) DO NOTHING`, and the clobber note. Insert exactly two rows:\n  - `('portfolio','portfolio.snapshot.interval_minutes','int','5',FALSE,'Portfolio snapshot frequency','5','xstockstrat-portfolio','staging',NULL)`. Provenance: `001_config_tables.up.sql:68`, renamed dev→staging at `017_config_secrets_and_scoping.up.sql:38`.\n  - `('portfolio','portfolio.snapshot.interval_minutes','int','1',FALSE,'Portfolio snapshot frequency (prod)','1','xstockstrat-portfolio','production',NULL)`. Provenance: `002_config_environment.up.sql:69`.\n  - 029 rewrites only `key` (`029:24-28`), which is confirmed.\n- **Migration number (change this round, objection 2).**\n  - Verified on disk: the latest file is `030`. 031 is claimed by 243 (`docs/roadmap/features/243-fix-sandbox-seed-keys/design.md:13`). 032 is double-claimed by 244 (`244…/implementation-spec.md:1067`) and 248 (`248…/implementation-spec.md:133`). The resolution of that collision will most likely move one of them to 033.\n  - Reserve **034**: `034_retire_portfolio_snapshot_interval.{up,down}.sql`. Record it in `docs/roadmap/features/merge-order.md`, following the pre-assignment note at `:197-199`. Add a row sequencing 264 after 243, 244 and 248.\n  - Add a **two-sided** pre-merge gate to the impl-spec's final step and to context.md. After `git fetch`, `git ls-tree --name-only origin/main-dev services/xstockstrat-config/migrations/` must show:\n    - (a) no number ≥ 034;\n    - (b) every number below 034 (031, 032, 033) present, or its owner explicitly sequenced after 264 in merge-order.md.\n  - If either condition fails, renumber or hold the merge.\n- **@AC-5 harness (change this round, objections 4 and 5).**\n  - Write it as a `node:test` test (not Vitest) in `services/xstockstrat-config/src/__tests__/`. It runs via `tsc && node --test dist/__tests__/*.test.js` (`services/xstockstrat-config/package.json:12`). Resolve `migrations/` from `__dirname` (`dist/__tests__`) as `../../migrations`.\n  - It scans `*.up.sql` sorted by numeric prefix and matches both quoted key forms. It asserts:\n    - (i) at least one up file matches;\n    - (ii) the highest-numbered match contains a `DELETE FROM config.config_values` **statement** that itself contains both `namespace = 'portfolio'` and a key literal;\n    - (iii) no later file INSERTs either form.\n  - Record in context.md: the reworded Given/When (\"the config migration set\"), why the test is static (no config test applies migrations), and the dev-smoke step (`scripts/db-migrate.sh`, then `ListKeys` in both environments).\n  - Also record the objection-9 trade-off: config audit triggers fire on INSERT/UPDATE only, so the DELETE writes no `config_audit` row and sends no pg_notify DELTA. Running instances keep the stale value until restart. Impact is nil because nothing reads the key. Same trade-off as 020.\n\n**Build order.**\n1. Service scoping, call sites, `package service` isolation test.\n2. `snapshotHub` interface and helper, gRPC empty-caller check, fake-hub handler tests.\n3. Delete the writer, add migration 034 and the `node:test` @AC-5 scan, add the merge-order.md reservation and sequencing row.\n4. Docs: portfolio `CLAUDE.md:99` and `:139`, `services/xstockstrat-portfolio/docs/context-constitution-findings.md:29`, `docs/repo-surveyor/debt-radar-findings.md:236`, the `config-governance.md` Removes log (`:423-427` form), and a check of `docs/context-constitution.md:40`. Then the context-constitution teardown refresh.\n5. Re-read `broadcastSnapshot` and the handlers at execute time. 242/251/256/257 touch the same files (insights, feature 125).",
    "open_objections": [
      {
        "text": "Pre-merge migration gate must be two-sided and actually executed: (a) no config migration >= 034 on origin/main-dev, (b) 031/032/033 all present on origin/main-dev or their owners explicitly sequenced after 264 in merge-order.md. The 244/248 032 double-claim must be resolved (expected: one moves to 033) before 264 merges; if it moves elsewhere, re-check 034. Spec must encode this as a literal command in the final step and record it in context.md (C-07; fails.md:2909, :613).",
        "blocking": false
      },
      {
        "text": "@AC-1 traceability: either reword the When step to 'a snapshot is broadcast for u-1' or drive the service test through the fill path (portfolio_service.go:376). Spec picks one and records the Gherkin change in context.md (C-15).",
        "blocking": false
      },
      {
        "text": "@AC-4 deletion and @AC-5 rewording (static migration-set scan instead of applied-DB ListKeys) follow from choosing branch (b), which the operator decision (scope D-12/D-24) does not explicitly sanction. They must be recorded in context.md and surfaced at the design gate for operator acknowledgement.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-2",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-3",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "@AC-6",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-231 @AC-2 (single event + single update per fill)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-231 @AC-8 (unpriced skip: no event, no update)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-161 @AC-8 (retired key not reintroduced)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "feature-210 platform @AC-5 (x-user-id identity read)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Exported `(*PortfolioService) SubscriberCount()` accessor as a test seam. Lost under C-18: it is a production symbol that exists only for tests. The handler-side `snapshotHub` interface with a fake hub gives the same 'never registered' proof (zero Subscribe calls) and needs no export.",
      "Handler tests using `newQuoteSvc` or a real service. Not buildable: `newQuoteSvc` is in a `package service` _test.go file (portfolio_quote_deadline_test.go:1,93), `NewPortfolioService` (:114) dials mTLS dependencies, `broadcastSnapshot` (:908) is unexported, and a bare struct panics on its nil map in Subscribe.",
      "Reserving migration 033 with a one-sided '>= ours' gate. Lost because 033 is the likely landing spot for the 244/248 032 collision, and a one-sided gate misses the case where 264 merges first and peers' lower-numbered migrations are silently skipped.",
      "Vitest for the @AC-5 scan. Lost because xstockstrat-config uses `node --test` over compiled dist (package.json:12).",
      "@AC-5 check (ii) as 'a DELETE scoped to namespace=portfolio'. Too weak: it would pass a namespace-wide or wrong-key DELETE. Replaced by a statement-level key+namespace match.",
      "Defense-in-depth `snap.PortfolioId == userID` check in the helper on top of the producer filter. Rejected as DRY/YAGNI; the producer filter at broadcastSnapshot is sufficient.",
      "Real-DB migration-apply test for @AC-5. The config service has no harness that applies migrations, so this is out of proportion for a SEV-2 key retirement. The static scan, the dev-smoke ListKeys step and the two-sided merge gate are enough.",
      "Filter in the handler instead of the producer. Lost because snapshots would still reach every channel and each consumer would have to re-implement the check.",
      "Trading-style empty-means-all filter (trading.go:390). Lost because fail-closed is required and portfolio has no internal cross-user subscriber.",
      "Delete the unmounted Connect StreamPortfolioUpdates and drop @AC-3/@AC-6. Lost as scope creep, since FR-3 is operator-fixed; the shared helper makes keeping it cheap.",
      "FR-4 branch (a), wire StartSnapshotWriter. Lost under C-18/YAGNI and F-06: it needs a new all-users query, a clock seam and periodic PgBouncer writes, and nothing consumes the rows."
    ],
    "open_risks": [
      "Migration ordering is still a process control. If the two-sided gate is skipped, or the 244/248 renumber lands on 034, golang-migrate silently skips a migration on environments that are already migrated, and the static @AC-5 scan cannot detect it.",
      "@AC-5 is checked statically. A C-15 reviewer may still want applied-state proof. Fallback: the dev-smoke db-migrate.sh + ListKeys step in both environments.",
      "Same-file overlap with 242/251/256/257 on portfolio_service.go and portfolio_handler.go. Line numbers cited here will drift, so re-read at execute time.",
      "Down migration restores only the two global seed rows. Any per-user operator overrides are lost on rollback (accepted, same as 020).",
      "The DELETE produces no config_audit row and no pg_notify DELTA. There is no audit trail of the retirement beyond the migration file. Accepted; record in context.md."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-03",
      "C-05",
      "C-07",
      "C-08",
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "F-01",
      "F-04",
      "F-06",
      "F-07"
    ],
    "rationale": "Both blocking objections are concrete and verified, so both are adopted rather than left open.\n\n**Objection 1 (handler-test harness).** Confirmed from the code:\n- `newQuoteSvc` is in `package service` (`portfolio_quote_deadline_test.go:1,93`).\n- `broadcastSnapshot` is unexported (`portfolio_service.go:908`).\n- `NewPortfolioService` (`:114`) dials real dependencies.\n\nThe proposal's handler tests therefore could not compile. The fix splits the tests by package: owner-filter isolation stays a `package service` test, and the handler helper takes a narrow unexported `snapshotHub` interface that a test-local fake satisfies. This also makes the exported `SubscriberCount()` unnecessary. That resolves the non-blocking C-18 objection, and the handler tests become deterministic.\n\n**Objection 2 (migration ordering).** Confirmed: 030 is the latest file on disk, 243 claims 031, and 244 and 248 both claim 032. Reserving 034 keeps clear of the likely 033 renumber. The two-sided gate plus a merge-order.md sequencing row covers both failure directions. It is still a process control, so it stays an open non-blocking objection and risk, but it now has a concrete, executable answer.\n\n**Smaller fixes.** The non-blocking factual fixes are folded in:\n- `node:test` instead of Vitest, with the path resolved from `dist`;\n- a statement-level check for the DELETE;\n- the 017:38 citation for the dev→staging rename;\n- confirmation that 029 changes only `key`;\n- the note that Connect is unmounted;\n- the no-audit-row and no-DELTA trade-off on delete.\n\n**Holds from earlier rounds.**\n- No Floor breach.\n- C-03 and the operator trace-id decision hold: emits stay on the fill ctx, and the only background path is deleted.\n- feature-231 and feature-210 rules are preserved.\n\n**Business-rule impact.** Changes to @AC-1/2/3 fall under the D-24 scope decision. Deleting @AC-4 and rewording @AC-5 follow from the branch-(b) design choice, which the operator did not explicitly sanction, so they are flagged for acknowledgement.\n\nThe design is ready for approval, provided the remaining items are encoded in the spec and context.md."
  },
  "floor_breaches": []
}
```

## Session 2026-10-22 — sdd-spec

- Generated implementation-spec.md with 10 steps. Status: design-approved → implementation-ready.
- Steps:
  1. service: owner-scoped subscriber and fail-closed fan-out.
  2. test: @AC-1/@AC-3 producer.
  3. service: `snapshotHub` + `streamSnapshots` + gRPC empty-caller check.
  4. test: @AC-2/@AC-6/@AC-3 Connect wiring.
  5. service: delete `StartSnapshotWriter`.
  6. docs: merge-order.md 034 reservation.
  7. migration: config 034 up/down.
  8. test: @AC-5 `node:test` static scan.
  9. docs: drift + teardown.
  10. test: two-sided pre-merge gate + dev-smoke `ListKeys`.
- **Gherkin edits applied (C-15; covered by the operator's 2026-10-22 C-16 sign-off for @AC-4/@AC-5):**
  - @AC-4 deleted (branch a).
  - @AC-1 When step reworded to "a snapshot is broadcast for user u-1 holding 10 AAPL priced at 100.00". This was
    the spec's pick between the two design options. Step 2 calls `broadcastSnapshot` directly (the fill path at
    `portfolio_service.go:376` calls it unchanged).
  - @AC-5 reworded to the static scan of the migration set, plus an applied-state line verified by the Step 10 dev
    smoke (`scripts/db-migrate.sh`, then `ListKeys` in production and staging). The test is static because no config
    test applies migrations.
  - The feature header comment was updated to match.
- **Spec-time resolutions (within design, no deviation):**
  - The handler holds the seam as an unexported field `hub snapshotHub`, set by `NewPortfolioHandler` to `svc`. The
    Step 4 fake therefore reaches the real Connect/gRPC entry points. No exported symbol is added.
  - The @AC-3 isolation RED is captured at the producer (Step 2). The Step 4 Connect half is a wiring
    characterization.
- **RED capture protocol.** Behavioral REDs, never compile errors (tdd-gate):
  - Step 1 splits into Part A (signature, struct, call sites, unfiltered loop) and Part B (owner skip).
  - Step 3 splits into Part A (seam + helper refactor) and Part B (gRPC check).
  - Step 8 runs before Step 7, so the highest match is `002`, an INSERT, and check (ii) fails.
- **Key codebase findings:**
  - **Correction to design.md/recon.md:** `offline_account_pnl_test.go:320` calls `broadcastSnapshot` with no
    subscriber and builds its service through `acctSvc` → `newQuoteSvc` (`:94-96`). It needs no edit. The real call
    sites are `portfolio_quote_deadline_test.go:106` (map literal) and `:321/:396/:424`, which become
    `Subscribe("t", "u1")` to match their `"u1"` broadcasts and keep feature-231 @AC-2/@AC-8 green.
  - Config migrations: the `origin/main-dev` tip is `030`, and no `031`+ file exists on any remote ref (a scan of
    remote history). 243 claims 031; 244 and 248 both claim 032. None of the eight batch peers' branches claims a
    config migration. 034 stands.
  - `docs/context-constitution.md:40` (PLAT-6) cites the deleted reader as its evidence. Step 9 re-points it to
    `portfolio_service.go:965` `s.cfg.GetFloat("portfolio.risk.max_drawdown_pct", 0.10)`.
  - Portfolio `CLAUDE.md:21-22` ("a missing header still yields InvalidArgument") was false for the gRPC stream
    until Step 3. Step 9 adds the stream-isolation sentence to the H-3 paragraph (`:45-52`).
  - Deleting the writer orphans nothing: `s.cfg` is still used at `:491-492` and `:965-966`, and `time` has 11
    other uses.
  - Key-removal approval is config team + all consumers (`docs/runbooks/config-rollout.md:246`). The only consumer
    was the deleted writer.
- `merge-order.md` is a shared repo-level file. This session was restricted to the feature directory, so its 034
  reservation row is Step 6 of the spec, not pre-written. The 244/248 032 collision is still routed outside this
  feature.
- Ledger: no new line. The migration-ordering and Node-reporter traps are already recorded (fails.md:613, :2909,
  2026-10-20).

## Session 2026-10-22 — sdd-review impl-spec

- Mode B (advisory). Lifecycle is unchanged: `implementation-ready`. Criteria verdict: PASS WITH WARNINGS (0 fails,
  0 floor breaches). Overlap verdict: WARN (no FAIL collision; 034 is unclaimed).
- **Addressed** (all edits are in `implementation-spec.md`, and each claim was re-verified in code):
  1. Fill-state completeness (B2b). Step 1 Codebase Evidence now notes that fill-state handling is unchanged.
     `processOrderFill` (`:264`) has no PARTIALLY_FILLED/FILLED branch and reaches `:376` once per `order.filled` event.
  2. @AC-3 Connect wiring. Step 4 gains case 4b, `TestStreamPortfolioUpdates_GRPC_AC1_WiresCallerIdentity`. It drives
     the **mounted** gRPC adapter end to end with `fakeGRPCStream` + `ctxWithHeader`, so a wiring slip in
     `a.h.hub`/`Subscribe(subID, userID)` fails a test. The Connect arm cannot be driven: `connect.ServerStream` has
     no exported constructor (`go doc`, v1.16.2). Its wiring is instead pinned by a new Step 3 grep for the exact
     `streamSnapshots(ctx, h.hub, …, stream.Send)` call. The @AC-1 coverage row and Step 4 Covers were updated.
  3. Migration ordering. The Step Dependencies section now records that no no-gap rule applies: `origin/main-dev`
     already skips config `024`, so 034 need not become 033. Step 10 gains an enforcement item: the integration PR
     stays a draft with an (a)/(b) checklist until that day's gate output passes, and the merge-order row stays
     `Resolved: No` until 243/244/248 have merged.
  4. RED capture fragility. Explicit **STOP — RED capture** blocks were added between Part A and Part B in Steps 1 and
     3. Each one gives the exact test command and requires the failing output to be pasted into context.md.
  5. Config DELETE with no audit row and no DELTA. Step 7 gains a pre-check (item 0): grep that no Go reader of the
     key remains, i.e. that Step 5 has landed.
  6. Same-file overlap. 242's real portfolio scope was confirmed as `checkRiskLimits`/`emitRiskAlert`
     (`:964-1018`) plus added tests in `portfolio_quote_deadline_test.go`, disjoint from this feature's regions.
     The overlap scan's "line-drift" claim is a misread: `Subscribe("t")` is at `:321/:396/:424` and
     `broadcastSnapshot` at `:328/:402/:429`, exactly as the spec cites. `origin/main-dev` (post-231) has no
     portfolio diff vs this branch. `offline_account_pnl_test.go:320` was confirmed to need no edit, because the
     `broadcastSnapshot` signature is unchanged.
- **Still open** (carried to the /sdd-execute checkpoint):
  - [ ] **Merge gate is process-only.** No CI job enforces the two-sided 034 gate. It depends on the executor
    keeping the PR draft (Step 10 item 4). The 244/248 `032` double claim is still unresolved outside this feature.
  - [ ] **Connect `StreamPortfolioUpdates` is untestable end to end and likely unreachable in practice.** It is
    unmounted (`main.go:94`). `streamUserID` (`portfolio_handler.go:28-38`) reads gRPC incoming metadata, which a
    Connect HTTP request does not populate. It is out of scope here: FR-3 keeps the arm, and the wiring is pinned by grep.
    Consider a debt-radar note or deleting the Connect stream arm in a later feature.
  - [ ] **Same-file rebase with 242/251/256/257.** Re-grep the cited lines at execute time (unchanged guidance).
- Ledger: no new line. The existing entries already cover these traps (fails.md:613, :2909).

## Session 2026-10-28 — sdd-execute re-spec gate (§5.3)
- Branch setup: detached at `origin/feature/fix-portfolio-snapshot-surface`, merged `origin/main-dev` with
  `-X ours` (e786d2b5), pushed.
- Directive: conditional. Re-spec'd step bodies 1, 3, 4, 5, 6, 8 only (line-ref drift; no behavior change).
  - Steps 1/3/4: the gRPC `StreamPortfolioUpdates` signature is at `portfolio_handler.go:292` (`Sprintf` `:293`).
    `cmd/server/main.go` refs moved: `NewPortfolioHandler` `:78`, `RegisterPortfolioServiceServer` `:101`.
  - Step 5: consumer goroutines at `main.go:71-76`; `s.cfg.FactorMap` at `:492`.
  - Step 6: `031_heal_indicators_sandbox_keys_full_dotted` (243, d8b7a8df) and `032_analysis_zero_trap_descriptions`
    (244, d2002841) are now committed on their feature branches. They match the claims, so reserving 034 still holds.
    No 033_/034_ file exists on any remote ref. 277's 033 mention is moot (demoted/canceled). The blockquote is at
    `merge-order.md:213`.
  - Step 8: `pnpm run test:coverage` is at `.github/workflows/ci.yml:594`.
- Steps 2, 7, 9, 10 were not in the validation's drift list, so they were not edited.

## Session 2026-10-28 — sdd-execute sequential (sdd-batch-execute)
- **Up-front confirmation (§5.1b/§5.4):** given by operator standing authorization in the operator chat on
  2026-10-28 (session_01NpS3HShZK6pSnogA7CFo2f): "Start executing features 241-276" via batch-execute, and later
  "start batch 2 in parallel too". The operator's answers were:
  - checkpoints are unattended, reported only;
  - C-16 promotion is auto-confirmed unless it changes an existing @AC rule;
  - merge-train is authorized;
  - 255 and 275 are deferred;
  - DB and prod steps are operator-only: open the PR and hold the merge.
- Lifecycle: `implementation-ready` → `in-progress`. Severity SEV-2.
- Consumer surface (C-14): none or internal. All steps are portfolio backend, the config migration, or docs.
- Open review warnings carried forward: the `[ ]` items in the 2026-10-22 sdd-review impl-spec note.

### Step 1 — service: Owner-scope the snapshot subscriber map and fan-out (fail-closed) [done]
- Added `snapshotSubscriber{ch, userID}`; `subs` is now `map[string]snapshotSubscriber`; `Subscribe(id, userID)`;
  `Unsubscribe` closes `sub.ch`; `broadcastSnapshot` skips any subscriber with `sub.userID != userID` (strict, so an
  empty owner receives nothing). Valuation, the unpriced skip, `InsertSnapshot` and `emitEvent` are unchanged and stay
  before the loop on the fill `ctx`. Both handler call sites pass the caller id; the gRPC adapter hoists `userID`.
  The three feature-231 tests subscribe as `"u1"`.
- TDD (Step 2 RED evidence, @AC-1/@AC-3 producer): with Part A only,
  `GOWORK=off go test ./internal/service/ -run 'TestBroadcastSnapshot_' -count=1 -v` →
  `portfolio_snapshot_scope_test.go:38: other user's stream received 1 of u-1's snapshots` /
  `--- FAIL: TestBroadcastSnapshot_AC1_OnlyOwnerReceives` and
  `portfolio_snapshot_scope_test.go:56: empty-owner stream received 1 snapshots` /
  `--- FAIL: TestBroadcastSnapshot_EmptyOwnerSubscriberReceivesNothing`. After Part B (`-race`): all five
  `TestBroadcastSnapshot_*` PASS, including the 231 `SkipsWhenUnpriced`/`AC2_BrokerFirstEquity`/`AC8_AnyUnpricedSkips`.
  The probe test file is not committed here; Step 2 creates it.
- Verification: `go build ./...` + `go vet ./...` clean; the grep shows the struct, map and skip; the old-signature
  grep exits 1; `GOWORK=off go test ./... -race -count=1` all packages ok.
- Files modified: `services/xstockstrat-portfolio/internal/service/portfolio_service.go`,
  `services/xstockstrat-portfolio/internal/handler/portfolio_handler.go`,
  `services/xstockstrat-portfolio/internal/service/portfolio_quote_deadline_test.go`
- Deviations: RED probe file not committed with Step 1; `:292`→`:293` line drift (Deviation Log).
- Open: `golangci-lint` in `~/go/bin` refuses this module (`built with go1.25 < go 1.27.0`), so Step 2's lint
  verification needs a lint binary built with Go ≥ 1.27, or a CI-equivalent fallback.

### Step 2 — test: Owner isolation at the producer (@AC-1, @AC-3 producer half) [done]
- Created `portfolio_snapshot_scope_test.go` with two tests:
  - `TestBroadcastSnapshot_AC1_OnlyOwnerReceives`: the u-1 stream gets one snapshot (`PortfolioId u-1`,
    `Equity 1000`), the u-2 stream stays empty, and `ledger.calls == 1`.
  - `TestBroadcastSnapshot_EmptyOwnerSubscriberReceivesNothing`: the fail-closed case.
  - Both share a file-local mock setup (`newScopedSnapshotSvc`) built on `newQuoteSvc`. They reuse `testdata.Aapl` and
    add no new testdata symbol (C-13).
- TDD, AC-1/AC-3 RED: the Step-1 owner skip was disabled in the working tree only, never committed. Output:
  - `portfolio_snapshot_scope_test.go:39: other user's stream received 1 of u-1's snapshots` (FAIL);
  - `portfolio_snapshot_scope_test.go:56: empty-owner stream received 1 snapshots` (FAIL).
- GREEN, with the skip restored: all five `TestBroadcastSnapshot_*` pass under `-race`.
- Verification:
  - `go test ./... -race` is ok across all packages;
  - CI-scoped coverage total is 68.6% (threshold 40%);
  - golangci-lint v2.14.0 reports `0 issues` (rebuilt with go1.27; see the Deviation Log);
  - the C-13 grep finds exactly one declaration.
- Files modified: `services/xstockstrat-portfolio/internal/service/portfolio_snapshot_scope_test.go` (new).
- Deviations: lint binary rebuilt at the CI pin (Deviation Log). Out-of-scope changes: none.

### Step 3 — service: Shared `streamSnapshots` helper, `snapshotHub` seam, gRPC empty-caller rejection [done]
- `portfolio_handler.go`:
  - unexported `snapshotHub` interface, plus the `*service.PortfolioService` compile-time assertion;
  - `hub` field, set in `NewPortfolioHandler`;
  - `streamSnapshots` holds the single subscribe/send loop and the unchanged TradingMode filter, and both
    `StreamPortfolioUpdates` paths call it;
  - the gRPC adapter now returns `InvalidArgument "user_id required"` before it builds `subID` or subscribes;
  - `req.UserId` stays unread.
- TDD, @AC-2 RED (Part A only, using a probe test). Output (FAIL):
  - `want InvalidArgument, got context deadline exceeded`;
  - `anonymous stream must never subscribe; recorded 1 Subscribe calls`.
- GREEN after Part B: PASS.
- Verification:
  - `go build` and `go vet` are clean;
  - the four greps match: helper, `hub: svc` and the gRPC check found; loop count 1; Connect wiring count 1;
  - `go test ./... -race` is ok;
  - golangci-lint v2.14.0 reports `0 issues`.
- Files modified: `services/xstockstrat-portfolio/internal/handler/portfolio_handler.go`.
- Deviations: RED probe not committed (Deviation Log). Out-of-scope changes: none.

## Session 2026-10-29 — sdd-execute sequential (sdd-batch-execute)
- **Up-front confirmation:** standing operator authorization (operator chat 2026-10-28/29,
  session_01NpS3HShZK6pSnogA7CFo2f): "Start executing features 241-276" via batch-execute. Checkpoints are
  unattended ("report"). C-16 promotion is auto-confirmed unless it changes an existing @AC rule. Merge-train is
  authorized; 255/275 are deferred. DB/prod steps are operator-only: open the PR and hold the merge. Status was
  already `in-progress` (set 2026-10-28), so there is no status flip this session.
- **Branch setup:** `git merge -X ours origin/main-dev` into the detached checkout of `origin/feature/fix-portfolio-snapshot-surface` (8ddff283).
- **Re-spec gate §5.3:** step bodies 4, 5, 6, 7, 8, 9 and 10 were re-checked against the merged tree.
  - Step 4: the gRPC adapter signature is at `portfolio_handler.go:305`. The Step-3 wiring (`:43`, `:54`, `:63`,
    `:151`, `:312`) is recorded.
  - Step 5: `StartSnapshotWriter` comment is at `:898`, func at `:899-911`, reader at `:900`. Other `s.cfg` uses are
    at `:492` and `:973-974`. Delete by symbol.
  - Step 6: 248's branch now commits `033_ledger_stream_resolve_timeout` (990ceb0b). Claims are 031 = 243,
    032 = 244, 033 = 248; the double claim is resolved. 034 is still free on every remote ref. The row reason text was
    updated, and the blockquote anchor moved to `merge-order.md:226`.
  - Steps 7 and 8: no mismatch; a re-verified note was added.
  - Step 9: `InsertSnapshot` is at `:936` and `max_drawdown_pct` at `:973`. config-governance anchors moved to
    `:426`/`:108` after the main-dev merge.
  - Step 10: gate state recorded. (a) passes because main-dev tops out at 030. (b) is not yet met because
    031/032/033 exist only on the 243/244/248 branches.

### Step 4 — test: Stream handler identity gate and helper wiring (@AC-2, @AC-6, @AC-3 Connect half) [done]
- Created `portfolio_stream_test.go` with inline `fakeHub` (owner-filtered `push`, which mirrors the Step 1 producer
  contract) and `fakeGRPCStream`. C-13: there is a single consumer, so nothing goes into testdata. It holds five tests:
  - `TestStreamPortfolioUpdates_GRPC_AC2_RejectsEmptyCaller`;
  - `TestStreamPortfolioUpdates_Connect_AC6_RejectsEmptyCaller`, which sets the deprecated body `UserId` and confirms
    it is ignored;
  - `TestStreamSnapshots_AC3_DeliversOnlyToCallersStream`;
  - `TestStreamPortfolioUpdates_GRPC_AC1_WiresCallerIdentity`, end to end through the mounted adapter;
  - `TestStreamSnapshots_TradingModeFilterPreserved`.
- TDD, @AC-2 RED: the gRPC check was reverted in the working tree only. Output (FAIL):
  - `portfolio_stream_test.go:162: want InvalidArgument, got context deadline exceeded`;
  - `portfolio_stream_test.go:165: anonymous stream must never subscribe; recorded 1 Subscribe calls`.
  - @AC-6 and the @AC-1/@AC-3 wiring cases passed on that tree, which is expected (red N/A per the spec).
- GREEN with the handler restored: all five pass under `-race`.
- Verification:
  - `go test ./... -race` is ok;
  - CI-scoped coverage total is 68.6% (threshold 40%);
  - golangci-lint v2.14.0 (go1.27 rebuild) reports `0 issues`;
  - the C-13 grep finds one declaration each of `fakeHub` and `fakeGRPCStream`.
- Files modified: `services/xstockstrat-portfolio/internal/handler/portfolio_stream_test.go` (new).
- Deviations: RED via a working-tree revert; lint fallback (Deviation Log). Out-of-scope changes: none.

### Step 5 — service: Delete the zero-caller `StartSnapshotWriter` [done]
- Deleted `StartSnapshotWriter` (doc comment + func, `portfolio_service.go:898-911`). `broadcastSnapshot` stays: its
  production caller is the per-fill path (`:376`), plus its unit tests. `s.cfg`, `"time"` and `commonv1` stay in use.
- TDD: N/A (dead-code deletion, no caller). Pre-deletion, the verification grep found 3 hits (`:898-900`).
- Verification:
  - `grep -rn "StartSnapshotWriter\|snapshot.interval_minutes" --include=*.go services/` exits 1;
  - `GOWORK=off go build ./...` and `go test ./... -race -count=1` are ok across all packages;
  - golangci-lint v2.14.0 (go1.27 rebuild) reports `0 issues`.
- Files modified: `services/xstockstrat-portfolio/internal/service/portfolio_service.go`.
- Deviations: lint fallback (Deviation Log). Out-of-scope changes: none.
- Open: `portfolio.snapshot.interval_minutes` now has no Go reader; the service CLAUDE.md config row and the findings
  row are handled by the later doc steps.

### Step 6 — docs: Reserve config migration 034 and sequence 264 in merge-order.md [done]
- Added the 264 row after the 231 row (`merge-order.md:77`): 264 after 243 (`031`), 244 (`032`) and 248 (`033`),
  reserving `034_retire_portfolio_snapshot_interval`; Resolved `No`. The 243/244/248 rows and claims are untouched.
- TDD: N/A (docs). Pre-edit, `grep -n "034_retire_portfolio_snapshot_interval" merge-order.md` found 0 hits.
- Verification: the same grep now returns exactly one row (`:77`). The pre-assignment blockquote cite `:226` holds.
- Files modified: `docs/roadmap/features/merge-order.md`.
- Deviations: none. Out-of-scope changes: none.
- Open: the Step 10 two-sided gate must be re-run before merge, after 243/244/248 land.

### Step 7 — migration: `034_retire_portfolio_snapshot_interval.{up,down}.sql` [done]
- Pre-check (ordering): `grep -rn "snapshot.interval_minutes" --include=*.go services/` exits 1, so Step 5 has landed
  (3e531aaf) and no Go reader remains.
- Up: `DELETE FROM config.config_values WHERE namespace = 'portfolio' AND key IN ('portfolio.snapshot.interval_minutes',
  'snapshot.interval_minutes')`, so every environment, every `user_id` and both stored key forms. Header follows 020.
- Down: the 020 layout (clobber NOTE, column list with `is_secret`, `ON CONFLICT … DO NOTHING`). It restores exactly the
  two seeded rows: staging/5 (001:68, renamed by 017:38) and production/1 (002:69), full-dotted key, `user_id` NULL.
  Per-user overrides are not restored, which is accepted as in 020.
- TDD: N/A (migration). Pre-state: the 034 files were absent, and the only `snapshot.interval_minutes` matches in the
  config migrations were the 001/002 INSERT seeds.
- Verification (offline, no DB): both files are listed; `^03[1-9]_` shows only the 034 pair locally; the up has the
  DELETE (`:6`); the down count is `2`. By inspection, the down re-inserts exactly the rows the up deletes.
- Files modified: `services/xstockstrat-config/migrations/034_retire_portfolio_snapshot_interval.{up,down}.sql` (new).
- Deviations: none. Out-of-scope changes: none.
- Open: the Step 8 @AC-5 scan is the paired test. Its RED (the highest match being the 002 INSERT) can no longer be
  captured on this tree; Step 8 must re-capture it by moving the 034 files aside in the working tree only. The Step 10
  two-sided gate is still owed before merge.

### Step 8 — test: @AC-5 static scan of the config migration set [done]
- Created `retiredPortfolioSnapshotInterval.test.ts`. It reads `migrations/*.up.sql`, sorts by numeric prefix, splits
  on `;` (comment lines dropped, whitespace normalised, lower-cased) and asserts: (i) some up file names either quoted
  key form; (ii) the highest match has a `DELETE FROM config.config_values` statement that itself holds
  `namespace = 'portfolio'` and a key literal; (iii) no `INSERT INTO config.config_values` naming either form at or
  after that file. File names are in every assertion message; no runner-output assertions; no fixture (C-13 N/A).
- TDD: RED with the 034 pair moved aside in the working tree only — fails on (ii) at `002_config_environment.up.sql`.
  GREEN with 034 restored — the highest match is `034_…up.sql`.
- Verification: the single test file passes (1/1, not skipped); `pnpm run test:coverage` 183/183 pass, c8 lines
  86.77% (≥40); `pnpm run lint` 0 errors (158 pre-existing warnings, none in the new file).
- Files modified: `services/xstockstrat-config/src/__tests__/retiredPortfolioSnapshotInterval.test.ts` (new).
- Deviations: RED re-capture method (Deviation Log). Out-of-scope changes: none.
- Open: Step 10 still owes the dev-smoke `ListKeys` check (applied state) and the two-sided migration-number gate.

### Step 9 — docs: Retire the key and record stream isolation in context docs, then the teardown refresh [done]
- Portfolio `CLAUDE.md`: deleted the `portfolio.snapshot.interval_minutes` row; `portfolio.snapshot` event reworded to
  "Snapshot written after each processed fill"; appended the `StreamPortfolioUpdates` isolation sentence to the H-3
  paragraph (owner-only delivery; empty caller `InvalidArgument` on both paths before subscribing). That keeps the
  `:21-22` "missing header yields `InvalidArgument`" claim true (gRPC adapter `portfolio_handler.go:309`, Connect `:148`).
- Portfolio findings `:29`: `StartSnapshotWriter` row marked `~~…~~ **RESOLVED 2026-10-29 (feature 264)**` (240-row
  convention); evidence now cites config migration 034 and `#broadcastSnapshot`.
- Debt radar D-12 (`:236`) and D-24 (`:447`): suffix `*(carried, open)*` → `*(fixed by feature 264)*`.
- config-governance: new `### feature 264` entry at the top of § Per-Feature Registered Keys (newest-first), with
  "**Removes** `portfolio.snapshot.interval_minutes` (migration 034)".
- PLAT-6 (`docs/context-constitution.md:40`): evidence now `portfolio_service.go#portfolio.risk.max_drawdown_pct`
  (~L958, `s.cfg.GetFloat("portfolio.risk.max_drawdown_pct", 0.10)`); rule text unchanged.
- **Teardown: the context-forge `context-constitution` refresh skill is unavailable in this session** (only
  `context-forge:context-scrubber` is listed). Manual reconciliation: re-read each touched file against current code.
  - `grep -rn "StartSnapshotWriter|interval_minutes" --include=*.go services/xstockstrat-portfolio` returns no hits.
  - `broadcastSnapshot` (`portfolio_service.go:898`) skips subscribers whose `userID` differs from the owner (`:928`);
    `InsertSnapshot` is at `:921`.
  - Portfolio `docs/context-constitution.md` (PORTFOLIO-1/-16 and the 231 note) cites `broadcastSnapshot` only for
    valuation and skip behaviour, which is unchanged, so there is no grounded drift. Root findings have no
    snapshot-stream entry.
  - `scrubberExtraTargets` (`README.md`, `docs/patterns/ui-ux-governance.md`) were not touched and describe no changed behaviour.
  - The integration PR body must record both that the plugin was unavailable and this reconciliation.
- TDD: N/A (docs).
- Verification: (1) the `snapshot.interval_minutes` grep over portfolio `CLAUDE.md` and `docs/context-constitution.md`
  exits 1; (2) config-governance `:114` matches `**Removes** \`portfolio.snapshot.interval_minutes\``; (3) D-12
  and D-24 both show "fixed by feature 264"; (4) portfolio `CLAUDE.md:52` holds the `StreamPortfolioUpdates` sentence.
- Files modified: `services/xstockstrat-portfolio/CLAUDE.md`,
  `services/xstockstrat-portfolio/docs/context-constitution-findings.md`, `docs/repo-surveyor/debt-radar-findings.md`,
  `docs/patterns/config-governance.md`, `docs/context-constitution.md`.
- Deviations: governance entry placement, PLAT-6 line (~L958, not ~L973), and the manual teardown (Deviation Log).
  Out-of-scope changes: none.
- Open: Step 10 (the two-sided migration-number gate before merge, plus dev-smoke `ListKeys`).

## Session 2026-10-29 — sdd-execute re-spec gate (§5.3), sdd-execute sequential (sdd-batch-execute)

- Up-front confirmation: operator standing authorization (operator chat 2026-10-28/29, session_01NpS3HShZK6pSnogA7CFo2f:
  "Start executing features 241-276" via batch-execute; unattended checkpoints; C-16 promotion auto-confirmed unless it
  changes an existing @AC rule; merge-train authorized; 255/275 deferred; operator-only DB/prod steps: open PR, hold merge).
- Status already `in-progress`; no status flip.
- Branch setup: `git merge --no-edit origin/main-dev` → `f01acaa` (no conflicts). ledger-guard
  (`--own-slug fix-portfolio-snapshot-surface --base origin/main-dev --fix`) reported clean; no repair needed.
- Re-spec (Step 10 body only):
  - Evidence now cites fails.md:2909 (Mistake) / :2911 (Rule).
  - Adds `config.proto:29` `rpc ListKeys` and agent `list_config_keys(namespace, user_id="")` at `tools.py:1628` (was :1620).
  - Adds `merge-order.md:77`.
  - Gate state re-verified: `origin/main-dev` config migrations top out at `030`, so (a) passes and (b) is still unmet.
  - Instructions item 2 and the Verification smoke line now use the real tool signature. The smoke is marked as an operator/post-deploy action.
- Step 10 stays `pending`. It is held for the operator per the existing Deviation Log entry; nothing local remains to run.

## Session 2026-10-29 — sdd-execute sequential, Step 10 (operator-deferred)

- Ran the Step 10 item-1 gate on `origin/main-dev` @ `22001134`.
  - Config migrations top out at `031`: 243 merged in #1334.
  - The `/0(3[4-9]|[4-9][0-9])_` grep is empty, so (a) passes.
  - (b) is unmet: `032` (244) and `033` (248) are still only on their feature branches.
- The post-deploy `list_config_keys(namespace="portfolio")` smoke on the staging and production agents is an operator action.
- Step 10 stays `pending`; the Deviation Log hold entry now carries the re-run.
- Open: merge-order.md:77 still names 243 as unmerged. Update it when 244 and 248 land and the row resolves.

## Session 2026-10-29 — sdd-batch-execute promotion plan (awaiting operator confirm)

```sdd-batch-promotion-plan
## Promotion plan: fix-portfolio-snapshot-surface (feature 264)

### Verdicts
| @AC | target suite (path) | CREATE/APPEND | verdict | note |
|---|---|---|---|---|
| @AC-1 | services/xstockstrat-portfolio/acceptance/fix-portfolio-snapshot-surface.feature | CREATE | NEW | gRPC subscriber isolation |
| @AC-2 | same | CREATE | NEW | gRPC empty x-user-id rejected |
| @AC-3 | same | CREATE | NEW | Connect subscriber isolation |
| @AC-6 | same | CREATE | NEW | Connect empty-caller non-regression |
| @AC-5 | services/xstockstrat-config/acceptance/fix-portfolio-snapshot-surface.feature | CREATE | NEW | key retirement via config migration 034 |

Neither target file exists. A repo-wide grep of `**/acceptance/*.feature` and `docs/sdd/business-rules/platform.feature` for `StreamPortfolioUpdates` and `snapshot.interval_minutes` returned no matches. So there are no DUP, OVERLAP or CONFLICT cases.

### Ready-to-write blocks

--- /home/user/xstockstrat/services/xstockstrat-portfolio/acceptance/fix-portfolio-snapshot-surface.feature (CREATE) ---
~~~gherkin
# Promoted from docs/roadmap/features/264-fix-portfolio-snapshot-surface/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-264` tag.
# Durable business rules xstockstrat-portfolio already guarantees. A rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-portfolio - StreamPortfolioUpdates is owner-scoped and fail-closed
  A snapshot stream delivers only the subscriber's own snapshots (a snapshot's portfolio_id is the owning
  user_id) and rejects a subscriber with no caller identity.

  @AC-1 @FR-1 @regression @feature-264
  Scenario: A snapshot stream subscriber receives only its own snapshots
    Given a gRPC StreamPortfolioUpdates stream "A" opened with x-user-id "u-1"
    And a gRPC StreamPortfolioUpdates stream "B" opened with x-user-id "u-2"
    When a snapshot is broadcast for user "u-1" holding 10 "AAPL" priced at 100.00
    Then stream "A" receives a snapshot with portfolio_id "u-1"
    And stream "B" receives no snapshot

  @AC-2 @FR-2 @regression @feature-264
  Scenario: A snapshot stream with no caller identity is rejected on the gRPC path
    When a gRPC StreamPortfolioUpdates stream is opened with no x-user-id
    Then the stream fails with INVALID_ARGUMENT
    And it is not registered as a subscriber

  @AC-3 @FR-3 @regression @feature-264
  Scenario: The Connect path also isolates subscribers
    Given a Connect StreamPortfolioUpdates stream "A" opened with x-user-id "u-1"
    And a Connect StreamPortfolioUpdates stream "B" opened with x-user-id "u-2"
    When portfolio broadcasts a snapshot for user "u-1"
    Then stream "A" receives a snapshot with portfolio_id "u-1"
    And stream "B" receives no snapshot

  @AC-6 @FR-3 @non-regression @feature-264
  Scenario: A snapshot stream with no caller identity stays rejected on the Connect path
    When a Connect StreamPortfolioUpdates stream is opened with no x-user-id
    Then the stream fails with INVALID_ARGUMENT
    And it is not registered as a subscriber
~~~

--- /home/user/xstockstrat/services/xstockstrat-config/acceptance/fix-portfolio-snapshot-surface.feature (CREATE) ---
~~~gherkin
# Promoted from docs/roadmap/features/264-fix-portfolio-snapshot-surface/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-264` tag.
# Durable business rules xstockstrat-config already guarantees. A rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-config - portfolio.snapshot.interval_minutes is a retired key
  The dead key (its periodic writer was never started) is deleted by migration and must not be re-seeded.

  @AC-5 @FR-4 @regression @feature-264
  Scenario: portfolio.snapshot.interval_minutes is retired (FR-4 branch b)
    Given the xstockstrat-config migration set
    When the up migrations are scanned in numeric order for "portfolio.snapshot.interval_minutes" and "snapshot.interval_minutes"
    Then the highest-numbered match deletes the key from config.config_values in namespace "portfolio"
    And no migration from that one onward inserts either key form
    And after the migrations are applied, neither the "production" nor the "staging" listing for service "portfolio" contains "portfolio.snapshot.interval_minutes"
~~~

### Notes / ambiguities / conflicts
- Attribution: AC-1, 2, 3 and 6 assert on StreamPortfolioUpdates behavior, which lives in portfolio, so they go to the portfolio suite. AC-5 asserts on config.config_values and the config migration set (migration 034), so it goes to the config suite even though the key's namespace is `portfolio`. The feature.md Reviewers table lists both owners.
- AC-4 was deleted at design (operator, 2026-10-22). The source file has no AC-4, and the gap is intentional, so nothing was renumbered.
- No contradiction with promoted rules. The retired key still appears in `services/xstockstrat-portfolio/CLAUDE.md` § Config Keys Consumed. The step that executes migration 034 should remove that row. This is a doc-drift note, not a promotion issue.
- The suites have no "Backed by" comment, because test names are not known at plan time. The orchestrator may add one after execution, as in `fix-book-portfolio-page.feature`.

### Coverage check
- Source scenarios: 5 (AC-1, 2, 3, 5, 6). Planned: 5 NEW, 0 DUP, 0 OVERLAP, 0 CONFLICT. None were skipped.
```

## Session 2026-10-29 — sdd-execute re-spec gate (§5.3), sdd-execute sequential (sdd-batch-execute)

- Authorization: operator standing authorization (operator chat 2026-10-28/29, session_01NpS3HShZK6pSnogA7CFo2f — "Start executing features 241-276" via batch-execute; unattended checkpoints `report`; C-16 promotion auto-confirmed unless it changes an existing @AC rule; operator-only DB/prod steps: open PR, hold merge). Status already `in-progress`, so no status flip.
- Branch setup: `git merge --no-edit origin/main-dev` (`0099647f`) merged cleanly (merge commit `1b440eab`); ledger-guard `--fix` reported clean.
- Re-spec (Step 10 only, still `pending`): Codebase Evidence gate-state bullet updated. `origin/main-dev` config migrations now top out at `031_heal_indicators_sandbox_keys_full_dotted` (243 merged via #1334). Gate (a) passes (`/0(3[4-9]|[4-9][0-9])_` grep: no output). Gate (b) unmet: `032` only on `origin/feature/fix-python-config-stored-zero`, `033` only on `origin/feature/fix-ledger-trimmed-notify-payload`. Other evidence re-verified: `scripts/db-migrate.sh`, `config.proto:29` `rpc ListKeys`, `tools.py:1628` `list_config_keys`, `merge-order.md:77`, `fails.md:613/2909/2911`; local `034_retire_portfolio_snapshot_interval.{up,down}.sql` present. Step 10 stays an operator-held gate (integration PR draft, merge held).
- Step 10 execute (2026-10-29): gate item 1 run against `origin/main-dev` @ `0099647f`. Config migrations list `…028 029 030 031`; the `/0(3[4-9]|[4-9][0-9])_` grep prints nothing (exit 1), so (a) passes. (b) is unmet: 244 (`032`) and 248 (`033`) are not yet on `main-dev`, and merge-order.md:77 stays `Resolved: No`. The post-deploy `list_config_keys(namespace="portfolio")` smoke on the staging and production agents needs a deployed build. Step 10 is deferred to the operator per the Deviation Log entry and stays `pending`; open the integration PR as a draft with the (a)/(b) checklist and hold the merge.

## Session 2026-10-29 — operator decision: Step 10 becomes post-merge verification

- Gate (a): `git ls-tree origin/main-dev services/xstockstrat-config/migrations/` tops out at `033_ledger_stream_resolve_timeout`; nothing is numbered `034` or higher. **Pass.**
- Gate (b): `031_heal_indicators_sandbox_keys_full_dotted`, `032_analysis_zero_trap_descriptions` and `033_ledger_stream_resolve_timeout` are all on main-dev (`0ba6a8b7`), so 243, 244 and 248 have landed. **Pass.** No renumber is needed.
- The ListKeys smoke needs migration 034 applied by a deploy, so it is post-merge by construction. The operator chose **"Post-merge verification (Recommended)"**.
- Step 10 is `done` and status is `code-completed`. merge-order.md row 77 is set to `Resolved: Yes`.
- Owed after merge:
  - (1) After the dev deploy, run staging `list_config_keys(namespace="portfolio")` and confirm `portfolio.snapshot.interval_minutes` is absent; record the output here.
  - (2) At the next `/promote`, run the same check on production.

## Session 2026-10-29 — post-merge staging ListKeys smoke (pass)

- Merged as `9bd923f3` (#1345). It was deployed to dev by DO deployment `db6ee608`, which went ACTIVE at 23:38:03Z.
- The staging agent call `list_config_keys(namespace="portfolio")` returns only `portfolio.watchlist.max_per_user` and `portfolio.watchlist.max_symbols_per_list`. `portfolio.snapshot.interval_minutes` is absent, so migration 034 applied. Item (1) of the owed list is closed.
- Still owed: item (2), the same check on production at the next `/promote`.

## Session 2026-10-30 — Production check waived

- Operator decision 2026-10-30 (own words): "Prod is not running. Staging is enough". The production check owed at `/promote` is **waived**. The staging/dev verification already recorded above is the final rollout verification for this feature.
