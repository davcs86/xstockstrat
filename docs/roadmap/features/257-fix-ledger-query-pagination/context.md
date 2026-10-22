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
