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
