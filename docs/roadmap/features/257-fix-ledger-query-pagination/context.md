# Context Log: fix-ledger-query-pagination

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-ledger-query-pagination-defect.md` (Issues disabled).
- Source: repo-surveyor debt-radar scan `docs/repo-surveyor/debt-radar-findings.md` @ 4535695, findings **D-13**, **D-27**,
  **D-46**. All three re-verified on main-dev @ a053b0e and all reproduce in code. None excluded.
- Severity: SEV-2. Impact type: wrong-pnl-reported. Environment: dev (main-dev) @ a053b0e. Config-only: no.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2 (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..5), context.md; report sidecar `.status` (`triaged`).
- Affected services: xstockstrat-ledger (D-13, D-27), xstockstrat-portfolio (D-46).
- Root cause hypothesis: ledger pagination is half-implemented (the token is emitted and never read). `GetPnL` treats a page
  error as end-of-data. The replay is a single unbounded query on `DB_POOL_MAX=1`.
- **Sequencing with 251-fix-getpnl-source-service (load-bearing):** this feature must merge **before or together with**
  `251-fix-getpnl-source-service`. 251 currently masks D-46: its `SourceService: "trading"` filter matches zero rows
  (`portfolio_service.go:753`, `:798`). Fixing 251 alone makes `GetPnL` match real fills, and beyond 500 platform-wide
  fills the D-13 page-1 loop then returns an inflated realized P&L as success. At spec time, add a
  `merge-order.md` entry (257 ≤ 251), and append a pointer to this constraint in 251's context.md when 251 is next touched.
  Design may choose to absorb 251's one-line fix here instead.
- Line drift (scan @ 4535695 → a053b0e):
  - None for D-13 (`ledgerServiceImpl.ts:157`, `:171`) or D-27 (`:234-243`, pg-cursor at `:342`).
  - D-46 pass 1 now spans `portfolio_service.go:749-791` (cited `:750-791`). Pass 2 is unchanged at `:795-836`.
  - `GetPnL` starts at `:722`.
- Adjacent observations, not filed and left for design to weigh:
  - `HydrateStops` (`portfolio_service.go:534`) reads only the first 100 oldest `order.filled` events, with no paging.
  - Trading `resolveUnknownIntents` (`trading.go:2222`) calls `QueryEvents`.
  - Both change behaviour once `pageToken` is honoured or `pageSize` is capped, so check them for regressions.
  - The `ORDER BY recorded_at` with an `event_id` token has no stable tiebreak. `sequence` (indexed, globally monotonic) is
    the natural keyset.
- Overlaps:
  - **251-fix-getpnl-source-service** (draft): same `GetPnL` loops in `portfolio_service.go:749-836`. See the sequencing above.
  - **248-fix-ledger-trimmed-notify-payload** (implementation-ready) edits the same `streamEvents` function
    (`ledgerServiceImpl.ts:196-257`, the live/buffer/`writeRow` path) that D-27 restructures. This is a high conflict risk:
    sequence after 248, or coordinate the replay-batching change with 248's buffer-flush logic.
  - **252-fix-identity-ledger-test-suites** (implementation-ready) makes the ledger real-impl tests loadable
    (`ledgerServiceImpl.test.ts`). 248 already depends on it. This feature's ledger tests likely depend on 252 too.
  - **256-fix-offline-book-consistency** and **264-fix-portfolio-snapshot-surface** edit other functions in `portfolio_service.go`.
  - **263-fix-edge-owner-scope** was triaged in the same 2026-10-21 batch. It adds an owner predicate to the **same**
    `queryEvents` WHERE builder (`ledgerServiceImpl.ts:124-162`) that D-13 gives a keyset and cap. This is a high textual
    and semantic overlap, and the keyset token must compose with the owner filter. Coordinate in design or merge one first.
  - **258-fix-config-stream-resilience** (same batch) edits `ledgerServiceImpl.ts:74` (appendEvent try/catch). Same file,
    different function.
- Recommended design depth: full → `/sdd-design fix-ledger-query-pagination` (rationale: 2 affected services, which is the
  C-0 full trigger, plus a cross-feature merge-order constraint with 251 and a same-function overlap with 248).
- Development branch: feature/fix-ledger-query-pagination

## Session 2026-10-21 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria verdict: PASS WITH WARNINGS (no fails, no Floor breaches).
- Warnings:
  - C-15 (criterion 8) OK. Every FR has a covering scenario: FR-1/2 by AC-1, FR-3 by AC-2, FR-4 by AC-7, FR-5 by AC-3
    and AC-6, FR-6 by AC-4, FR-7 by AC-5. Arithmetic rechecked (AC-3 = 250.00, AC-6 = 501.00).
  - FR-1/FR-4 order by `sequence`, while today's query orders by `recorded_at ASC` (`ledgerServiceImpl.ts:162`). The
    two can differ for concurrently inserted rows. **Resolved in this session:** FR-4 now says the first page is the
    oldest by `sequence` and asks design to record whether the difference matters to any caller.
  - FR-4 claimed trading `trading.go:2222` requests page_size ≤ 500; it sets no `PageSize` (default 100). **Resolved:**
    FR-4 wording now says "effective `page_size`" and cites `trading.go:2222-2225` with the default 100.
  - FR-2: an exactly-full last page must return an empty token. **Resolved:** FR-2 now states it and asks design to
    keep the existing `limit+1` probe.
  - Peer features 248/251/263 and a `merge-order.md` row for 257 could not be verified in the reviewer's working tree;
    `merge-order.md` has no 257 row yet. Open: `/sdd-spec` must write the 257 ≤ 251 row before the impl-spec gate.
  - Criteria 5, 6, 7, 9, 11 pass. No proto change; conditional key `ledger.query.max_page_size` follows C-05; no
    migration decided (any future one is a new numbered migration, C-07; F-01 not at risk). Trading-domain C-5
    satisfied by FR-5 + AC-6; C-1..C-4 not triggered.
  - Code claims verified: `queryEvents` ignores `pageToken`, no cap (`ledgerServiceImpl.ts:157-171`); replay is one
    unbounded `pool.query` (`:235-243`); ExportEvents uses `Cursor` (`:342`); `idx_events_sequence` (migration 001:43);
    `GetPnL` loops at `portfolio_service.go:753-758`, `:798-803` (PageSize 500, `SourceService: "trading"`,
    `slog.Warn` + `break`); `HydrateStops` at `:534`; trading call sites `trading.go:2091`, `:2222`, `:3221`.
- Overlap findings (level WARN; no config-key, proto-field or migration collision, so no FAIL):
  - `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts` `streamEvents` (trunk :182): FR-7 replay rewrite vs
    **248-fix-ledger-trimmed-notify-payload** (implementation-ready) Step 8 editing the subscribe literal (:202-220).
    Same function, manual merge. Soft same-function note recommended for merge-order (no hard order).
  - Same file, `queryEvents` (trunk :124, ORDER BY at :162): FR-1/FR-3 keyset + cap vs **263-fix-edge-owner-scope**
    (draft) owner predicate in the same WHERE builder. Conditional on 263's design; keyset must compose with it.
  - `services/xstockstrat-portfolio/internal/service/portfolio_service.go` `GetPnL` (trunk :722; PageSize 500 at :754,
    :799): FR-5/FR-6 vs **251-fix-getpnl-source-service** (draft; its `:683` cite is stale). Hard sequencing: 257 must
    merge before or together with 251.
  - Low risk: 264-fix-portfolio-snapshot-surface (different function in `portfolio_service.go`, rebase-only);
    240-offline-account-full-pnl (launched, historical only); 252-fix-identity-ledger-test-suites (shares ledger test
    harness, no clash; AC-5 uses a separate real-TimescaleDB harness); 248 adds config migration
    `032_ledger_stream_resolve_timeout` in xstockstrat-config (no collision).
  - Recommended merge-order row (to confirm with the user before writing, at `/sdd-spec`): `fix-getpnl-source-service`
    (251) must wait for `fix-ledger-query-pagination` (257) — GetPnL realized P&L inflated once >500 fills if 251
    merges alone. Resolved: No.

OPERATOR DECISIONS (binding, recorded 2026-10-21):
- Grouped by service+theme from the 2026-10-20 debt-radar scan; Track C.
- Scope is D-13, D-27, D-46; must merge before or with 251-fix-getpnl-source-service.

- Files modified: product-spec.md (FR-2, FR-4 wording), status.md, feature.md, context.md.
- Next: `/sdd-design fix-ledger-query-pagination` (full depth).
