# Context Log: fix-ledger-trimmed-notify-payload

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-20 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-19-ledger-stream-trimmed-notify-payload-defect.md`
  (Issues disabled). Source: `services/xstockstrat-ledger/docs/context-constitution-findings.md` § Latent bugs row 1.
- Severity: SEV-2. Impact type: silent-data-corruption. Environment: dev (main-dev) @ 1302e6d. Config-only: no.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..3), context.md.
- Affected services (from report): xstockstrat-ledger, xstockstrat-analysis, xstockstrat-portfolio.
- Root cause hypothesis: trigger trim branch (`migrations/001_ledger_events_hypertable.up.sql:72`) expects a
  re-fetch; `EventNotifier.dispatch` (`src/services/eventNotifier.ts:124`) → `StreamEvents.writeRow`
  (`src/grpc/ledgerServiceImpl.ts:197`) → `rowToEvent` (`:371-373`) treats the stub as a full row.
- Confirmation evidence (report): ledger side certain by code read (trim branch, parse, write path all cited above);
  report confidence high. Consumer impact depends on production payload sizes; not measured.
- Triage grep: trigger code verified at `001_...up.sql:72`; latest ledger migration is `003_events_user_id`; no proto
  field involved (`LedgerEvent` already carries payload/occurred_at).
- Recommended design depth: full → `/sdd-design fix-ledger-trimmed-notify-payload` (rationale: SEV-2 with 3 affected
  services; design forks: re-fetch in the fan-out vs. trigger change (would need migration `004`), whether the
  re-fetch runs per subscriber or once in `EventNotifier`, pool-borrow under the ledger's `DB_POOL_MAX=1` budget, and
  whether already-skipped events need consumer-side recovery).
- Design constraint to carry: ledger query pool is 1 conn + 1 dedicated LISTEN conn (root CLAUDE.md § Connection Pool
  Budget); a re-fetch must not starve `AppendEvent` or hold the pool across `call.write` backpressure.
- Development branch: feature/fix-ledger-trimmed-notify-payload

## Session 2026-10-20 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria: PASS WITH WARNINGS (0 fails, 0 floor breaches).
  Overlap: WARN (no FAIL).
- Warnings (6) and how this session handled them:
  - FR-1 "for any row size" overstated: the trim test counts chars (`001_ledger_events_hypertable.up.sql:72`), but
    `pg_notify` caps the body at 8000 bytes (`:81-82`), so a multi-byte row of 7000 chars or fewer can fail
    `AppendEvent`. Resolved: FR-1 is narrowed to rows `AppendEvent` commits, and an Out of Scope bullet hands the fork
    (fold into a `004` trigger migration, or a separate defect report) to /sdd-design.
  - AC-6 used symbolic sequences, and FR-4's no-row branch had no scenario. Resolved: AC-6 now uses 10/11/12, and
    AC-7 (no row for `event_id`) is appended.
  - AC-1 gave no concrete values for the optional fields, and there was no `stream_key`-filtered scenario. Resolved:
    AC-1 now asserts concrete `source_service`, `correlation_id`, `metadata` and `user_id`; AC-8 (`stream_key`
    filter) is appended. AC-1..AC-6 IDs are unchanged (C-15 append-only).
  - AC-4 testability: `ledgerServiceImpl.ts:197` ignores `call.write`'s return. Resolved: product-spec § Acceptance
    Criteria states the fake-`call` harness, and that only the second `Then` is red before the fix.
  - Red-before-green dependency on 252 (P-06, C-08). Resolved in product-spec § Acceptance Criteria: merge after 252
    unless design picks a feature-local harness. The merge-order row is open (see Router carry items).
  - Data repair of pre-fix stubs consumed through `analysis.ledger_stream_cursor` (`pnl_pattern_consumer.py:140-153`)
    has no owner. Partly resolved: Out of Scope marks a `docs/reports/` defect report as owed (see Router carry
    items).
- Overlap findings:
  - [file] `services/xstockstrat-ledger/package.json:13-14` and `src/__tests__/ledgerServiceImpl.test.ts:23` are
    shared with 252 `fix-identity-ledger-test-suites`. This is a hard sequencing dependency: the strip-types runner
    cannot load `ledgerServiceImpl.ts:20-21`.
  - Low-risk shared context: `ledgerServiceImpl.ts:138-140` with 251 (read-only there).
    `portfolio_service.go` with 240/242/251; this feature only verifies there.
    The analysis dir with 215/244/245/246; this feature only verifies there.
  - Config, proto and migration: clean. The conditional `004` is free on trunk (tip `003_events_user_id`).
    Re-derive the NNN across remote branches at /sdd-spec.
- Router carry items (outside this writer's paths, still open):
  - [ ] Add a `docs/roadmap/features/merge-order.md` row saying `fix-ledger-trimmed-notify-payload` (248) waits for
    `fix-identity-ledger-test-suites` (252). Reason: shared ledger test runner and test file. Resolved = No.
    Needs user confirmation.
  - [ ] File a `docs/reports/` defect report for repairing analysis P&L-pattern rows built from pre-fix stubs.
- Design carry items for /sdd-design (from spec-reviewer NOTE):
  - `EventNotifier.dispatch` swallows `onEvent` throws (`eventNotifier.ts:131-135`). FR-4's non-OK end must come
    from `call.destroy` with a status code. A clean `end()` makes portfolio reconnect with no sleep
    (`portfolio_service.go:220-222`) and makes analysis loop without the 2s backoff
    (`pnl_pattern_consumer.py:155-162`).
  - Per-subscriber re-fetch costs about 6 identical SELECTs per large event (portfolio 5 + analysis 1) on the
    `DB_POOL_MAX=1` query pool (`src/index.ts:44`). Consider resolving once per event (LEDGER-5, F-06).
  - Reproduction step 3 ("Invalid occurredAt") describes server-side object state. What a client sees depends on the
    Timestamp encoder, and a throw at `call.write` would be swallowed. Verify the client-visible symptom.
  - The awaited re-fetch must keep LEDGER-2 (subscribe → replay → flush → live in one synchronous block). An `await`
    inside the flush at `ledgerServiceImpl.ts:255-259` breaks that and needs an explicit ordering mechanism (FR-3).
  - Char-vs-byte trim mismatch (Out of Scope bullet): decide between folding it into a `004` migration and a separate
    defect report.
- Operator decisions (as relayed by the workflow orchestrator, recorded verbatim):

  OPERATOR DECISIONS (binding, recorded 2026-10-20):
  - Standing authorization: designs run in FULL mode only (no quick designs for automated fixes); the orchestrator auto-approves the design gate once rounds >= 2, no unresolved Floor (F-*) breach remains, no blocking objection remains, and every CHANGE to an existing @AC business rule is covered by an operator decision below.
  - Full design depth.
- Next: `/sdd-design fix-ledger-trimmed-notify-payload` (full).

## Session 2026-10-20 — sdd-review product-spec (re-review, resume)

- Re-run of /sdd-review product-spec against the spec as of `2279d1f6`. Criteria: PASS WITH WARNINGS (7 warnings,
  0 fails, 0 floor breaches). Overlap: WARN (no FAIL). Status stays `spec-ready`: the `draft` → `spec-ready` row
  was already written by the prior session, so no new Status History row is added.
- Warnings (7) and how this session handled them:
  - No `stream_key`-filtered scenario. Already resolved: AC-8 (`acceptance.feature:66-71`).
  - FR-4's no-row branch had no scenario. Already resolved: AC-7 (`acceptance.feature:56-64`).
  - AC-6 "on every attempt" implied retry semantics. Resolved: reworded to "fails with a database error until that
    error clears". Whether to retry is still for /sdd-design to decide.
  - AC-2 is deterministic only if the appends are back-to-back. Resolved: the When now reads "appended back-to-back,
    without waiting for delivery". The flush at `ledgerServiceImpl.ts:255-258` is synchronous today; an async re-fetch
    is what makes FR-3 hard.
  - Whether 248 waits for 252 or ships its own harness (C-08, P-06). Already in product-spec § Acceptance Criteria
    ("Sequencing on 252"). Settle at /sdd-design or /sdd-spec; impl-spec states the dependency or merge-order entry.
  - Test feasibility: AC-4..AC-7 need fault/timing injection, and a trigger-level proof needs real Postgres. Resolved:
    product-spec § Acceptance Criteria "Test tiers" bullet; impl-spec maps each AC to a tier.
  - Doc drift outside this spec: `services/xstockstrat-ledger/CLAUDE.md` says portfolio holds "three" permanent
    StreamEvents subscriptions; the correct count is five (`portfolio_service.go:168`, `:1117`, `:1129`, `:1249`,
    `:1297`). This is outside the writer's paths, so it is added as a router carry item for the teardown audit.
- Overlap findings: same as the prior session. [file] hard sequencing on 252 (`services/xstockstrat-ledger/package.json`
  test script, `ledgerServiceImpl.test.ts`, `eventNotifier.test.ts`); 252 should land first. Low-risk shared context
  only for portfolio (240/242/251), `ledgerServiceImpl.ts:138-140` (251, read-only), migrations/config (the conditional
  `004` is unclaimed; re-derive at /sdd-spec), analysis (244/245/246) and otel (250). There is no merge-order row yet for
  248/252 (proposed: 248 waits for 252, Resolved = No; the router asks before writing).
- Router carry items (added):
  - [ ] Fix the portfolio subscription count ("three" → five) in `services/xstockstrat-ledger/CLAUDE.md` during the
    teardown audit.
- Operator decisions (as relayed by the workflow orchestrator, recorded verbatim):

  OPERATOR DECISIONS (binding, recorded 2026-10-20):
  - Standing authorization: designs run in FULL mode only (no quick designs for automated fixes); the orchestrator auto-approves the design gate once rounds >= 2, no unresolved Floor (F-*) breach remains, no blocking objection remains, and every CHANGE to an existing @AC business rule is covered by an operator decision below.
  - Full design depth.
- Next: `/sdd-design fix-ledger-trimmed-notify-payload` (full).

## Session 2026-10-21 — sdd-design

- **Phase 0 Recon:** wrote recon.md (`c22716fb`).
  - Services: xstockstrat-ledger is the fix site; analysis and portfolio are verify-only.
  - Key reuse: `rowToEvent` as the single mapper, `call.destroy({code,message})` termination, and the existing
    LISTEN client with its `onReconnect` path.
- **Phase 1 Grilling:** 3 rounds (full).
  - Chosen approach: one global FIFO in `EventNotifier` resolves each trimmed NOTIFY row once, in NOTIFY order, on
    the dedicated LISTEN client. The read is by PK `(event_id, recorded_at)`, bounded by a startup
    `statement_timeout` B plus `query_timeout` 2B. On failure, `onGap` → `call.destroy` with code 13 or 14.
  - Rejected: pool-borrow resolve (options b/c), per-subscriber or per-stream resolve, end-on-every-stub,
    `BEGIN`/`SET LOCAL` on the LISTEN session, and a trigger migration. Full list: design.md § Rejected Alternatives.
- **Round record (P-05).** Transcribed from the orchestrator checkpoints `seeds/248/state-r1.json`, `state-r2.json`,
  `propose-r2.md`, `attack-r2.md` and `state-r3.json`.
  - **R1 blocking objections:**
    1. The resolve was unbounded, so one hung read froze all fan-out.
    2. The real-DB `recorded_at` round-trip had to be a required tier, with `log.warn` on every failure branch.
    3. AC-4/AC-5 could not be observed from the `streamEvents` unit tier.
  - **R1 adopted:** a required `resolveRow` callback, the queue cleared on reconnect, subscribers recomputed after the
    await, `Number()` at the 4 sequence sites, and the cost corrected from about 6 reads to about 2.
  - **R2 progress on R1:** R1(3) was resolved by the wired tier (ii). R1(2) was resolved for logging. R1(1) was
    partly resolved by `SET LOCAL statement_timeout`, a WatchConfig key and a new AC-9.
  - **R2 new blocking objections:**
    1. The fast-path predicate `queue.length === 0` let a full row overtake an in-flight resolve, breaking AC-2 and
       the 042 seal order.
    2. Counting the `pool.connect()` wait inside B turned replay contention into `onGap` (`@AC-6 @feature-210`).
    3. Tier (iv) could not be built: `tsconfig.json:22` excludes tests, `migration-rerun` has no Node toolchain, and
       the job was not in `ci-gate.needs`.
  - **R3 resolutions:** R2(1) by the `!this.draining && …` predicate. R2(2) by resolving on the LISTEN client, which
    leaves the pool untouched. R2(3) by running `test:db` on 252's compile-then-test, plus the `node-test` and
    `migration-rerun` steps and a `ci-gate` entry.
  - **R3 adversary result:** no Floor breach. Its one blocking item (round record not on disk, P-05) was downgraded to
    a gate-write obligation, which this entry and design.md § Rounds discharge.
  - **R3 adopted binding refinements:**
    - the stale-drain no-shift guard;
    - the wedged-listener teardown on `Query read timeout`;
    - the honest AC-9 harness scope;
    - the `node-shared` CI filter;
    - seed `value_type 'int'`;
    - the `LEDGER-8` invariant;
    - the resolver placed outside `ledgerServiceImpl.ts`.
  - **R3 rejected:** `tsconfig.dbtest.json` (it contradicts 252 design.md:201) and relying on TCP give-up.
- **Constitution rules touched:** C-01, C-08, C-11, C-14, C-15, C-16, C-18, P-02, P-03, P-04, P-05, P-06, F-01,
  F-06, F-07. Floor breaches: none.
- **Business rules:**
  - AC-1..AC-8 @feature-248: EXTEND (tiers only).
  - AC-9 @feature-248: new, EXTEND.
  - Durable rules are PRESERVE: `@AC-6 @feature-210`, `@AC-1/@AC-2 @feature-042`, and the `@feature-157`,
    `@feature-163`, `@feature-021`, `@feature-225`, `@feature-029` and `@feature-206` rules.
  - There is no CHANGE, so no operator CHANGE cover is needed.
- **Decisions:**
  - Resolve on the LISTEN client, never the query pool. F-06 stays at 1 pool + 1 listener.
  - New config key `ledger.stream.resolve_timeout_ms` (int, default 2000), seeded by config migration `031`
    (re-derive NNN at /sdd-spec).
    - No proto PR, following the 022 precedent; `services/xstockstrat-config/CLAUDE.md:103` is drift.
    - Fallback: a `RESOLVE_TIMEOUT_MS` constant plus an F-07 ruling.
  - The char-vs-byte trim mismatch is not folded in (no `004` migration); it stays a separate defect.
  - Tier (iv) rides on 252, so 248 merges after 252.
- **Open Threads** (from design.md § Open Risks, each with a target step):
  - [ ] LISTEN-session assumptions — tier (iv) step. They are: a notification arrives during an in-flight query, a
    NOTIFY is delayed rather than dropped, `statement_timeout` is honoured on `:25060`, and the `recorded_at` text
    round-trips.
  - [ ] 252 is unmerged, so tiers (i)-(iii) are vacuous until it lands; a merge-order row 248-after-252 is needed
    (router) — /sdd-spec.
  - [ ] Under 252 parity, the production `tsc` emits `src/__tests__/db/**`, so DB tests must not import test-only
    dependencies — tier (iv) step.
  - [ ] Head-of-line latency of K×B (K×2B on the backstop); put `queueDepth` in `log.warn` — EventNotifier step.
  - [ ] A spurious `Query read timeout` causes an avoidable fleet-wide resync — EventNotifier step (document it).
  - [ ] B live-ness: SET-on-change (preferred) versus documenting "applies on listener reconnect" — /sdd-spec,
    resolver step.
  - [ ] Config-team approval for the new key — pre-merge gate in the impl-spec.
  - [ ] Observability: timeouts → 14, which portfolio logs at Info; a counter is deferred (accepted).
  - [ ] ts-proto encoding of a string `sequence` on resolved rows is untraced — tier (iii).
  - [ ] Product-spec amendment owed — /sdd-spec, before steps are written:
    - FR-2 (`product-spec.md:51`) becomes a read on the LISTEN connection.
    - Fix Scope (`:59`) becomes one config key.
    - Add a Status History note.
  - [ ] Append the AC-9 scenario to acceptance.feature (C-15, append-only) — /sdd-spec.
  - [ ] Teardown and docs — docs step plus teardown (fails.md:670):
    - add a `LEDGER-8` row and the LEDGER-2 resolve rule;
    - update ledger `CLAUDE.md` § Live Streaming Architecture and fix "three" → "five";
    - update the "Split pool" pointer;
    - close `context-constitution-findings.md:36`;
    - register the key in the config-governance key log;
    - fix the config `CLAUDE.md:103` drift.
  - [ ] Pre-existing, out of scope:
    - the NOTIFY window between reconnect `LISTEN` and `onReconnect`;
    - the unbounded grpc-js write buffer;
    - data repair of analysis's pre-fix stubs (report owed, router);
    - the char-vs-byte trim.
  - [ ] Checkout drift: local main-dev lacks recon.md and shows 252 as `draft`. Read `origin/feature/*` or run
    `/sdd-sync`.
- Operator decisions (as relayed by the workflow orchestrator, recorded verbatim):

  OPERATOR DECISIONS (binding, recorded 2026-10-21):
  - Standing authorization: designs run in FULL mode only (no quick designs for automated fixes); the orchestrator auto-approves the design gate once rounds >= 2, no unresolved Floor (F-*) breach remains, no blocking objection remains, and every CHANGE to an existing @AC business rule is covered by an operator decision below.
  - Full design depth.
- **Approval:** auto-approved by the orchestrator under the operator standing authorization (3 rounds ≥ 2, no Floor
  breach, no blocking objection, no `@AC` CHANGE).
- **Status:** spec-ready → design-approved.
- **Next:** `/sdd-spec fix-ledger-trimmed-notify-payload`.
