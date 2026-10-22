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
