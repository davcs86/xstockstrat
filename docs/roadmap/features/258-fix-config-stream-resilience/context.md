# Context Log: fix-config-stream-resilience

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-config-stream-resilience-defect.md` (Issues disabled),
  sidecar `triaged` / `ref: feature:258-fix-config-stream-resilience`.
- Source: repo-surveyor debt-radar scan (`docs/repo-surveyor/debt-radar-findings.md` @ 4535695), findings
  D-05, D-06 (config `getConfig` + `setConfig` sites and the ledger `pool.connect` site), D-35, D-58.
- Severity: SEV-2 (group). D-58 was rated one level lower on its own by the surveyor; grouped here because it shares
  the "end the call so the client reconnects" fix contract with D-35. Impact type: stale-config-and-hung-rpc.
  Environment: dev (main-dev) @ a053b0e. Config-only: no.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2
  (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..8), context.md.
- Affected services: xstockstrat-config, xstockstrat-ledger.
- Root cause hypothesis: config assumes the DB is always available — LISTEN client lacks ledger `EventNotifier`'s
  error/end/reconnect handling; stream error paths drop or never register subscribers without ending the call;
  three handlers await before `try`.
- All four D-ids reproduce on a053b0e. Line drift vs the scan: none — D-05 `configServiceImpl.ts:164-172`, D-06
  `:319` / `:447-462` / ledger `ledgerServiceImpl.ts:74`, D-35 `:305-312`, D-58 `:264-271` (scan cited `:268-271`
  for the catch). Reference pattern: `services/xstockstrat-ledger/src/services/eventNotifier.ts:74-78`.
- **Overlaps:**
  - `241-fix-config-audit-author-spoof` (implementation-ready) edits `setConfig` in the same file
    (`configServiceImpl.ts`, author handling around `:410`) — D-06's setConfig fix wraps `:447-462`; rebase/sequence
    against 241 before the integration PR.
  - `248-fix-ledger-trimmed-notify-payload` (implementation-ready) edits `ledgerServiceImpl.ts` (StreamEvents /
    notifier paths), not `appendEvent`; textual merge risk only.
  - `252-fix-identity-ledger-test-suites` (implementation-ready): the ledger unit suite currently early-returns on a
    failed lazy import, so a ledger AC-5 test may not actually run until 252 lands — sequence 252 first or verify
    the new test executes (red-before-green, P-06).
  - Resolved `2026-10-03-node-configwatcher-stream-doubling-defect` (`69c8554`) fixed the client-side reconnect path
    that D-35/D-58's server-side fix depends on.
- Design forks to settle: re-snapshot strategy on LISTEN reconnect (`reloadAll` + broadcast to all vs per-namespace);
  D-35 ordering (register-then-snapshot vs version check); gRPC status for DB failures (`UNAVAILABLE` vs `INTERNAL`);
  reconnect-storm trade-off on a DB outage (clients already back off).
- Recommended design depth: full → `/sdd-design fix-config-stream-resilience` (rationale: SEV-2 with 2 affected
  services, the C-0 full trigger; no proto/migration).
- Development branch: feature/fix-config-stream-resilience

## Session 2026-10-21 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria verdict: PASS WITH WARNINGS (0 fails, 0 floor breaches).
- Warnings:
  - C-15 (criterion 8): AC-2 and AC-8 asserted "the error is logged". **Resolved:** both now assert a captured
    error-level log record carrying the rejection message (observable outcome).
  - FR-3 coverage for `setConfig` exercised only the existence-gate query (AC-4). **Resolved:** added AC-11 (the
    `config.config_values` INSERT/UPDATE rejects after the gate passes → gRPC error status, no unhandled rejection).
  - AC-7 is non-deterministic as worded ("first SNAPSHOT or a following DELTA"). Open for /sdd-design: pin the
    interleaving (e.g. a controlled promise on the snapshot SELECT) once the D-35 ordering is chosen.
  - FR-1 gives no reconnect bound; AC-1/AC-9 cannot be timed deterministically until /sdd-design fixes the backoff
    constants. Not a blocker.
  - No Open Questions section; the design forks are recorded in the triage session above (re-snapshot strategy on
    reconnect: `reloadAll()` + broadcast every namespace vs per-namespace; D-35 ordering; `UNAVAILABLE` vs
    `INTERNAL`; reconnect-storm trade-off). /sdd-design must settle them explicitly (C-11).
- Overlap findings (level WARN, file-level only; no migration, proto field or config-key collision):
  - `configServiceImpl.ts` SetConfig — same function as `241-fix-config-audit-author-spoof` (gate :386, owner
    branch :394, attribution :410-414, :513; implementation-ready). Manual merge, not mechanical rebase.
  - `configServiceImpl.ts` GetConfig :319 — direct line overlap with `263-fix-edge-owner-scope` (config reads
    :317-319; draft).
  - `ledgerServiceImpl.ts` — disjoint functions vs `248-fix-ledger-trimmed-notify-payload` (StreamEvents,
    rowToEvent), `257-fix-ledger-query-pagination` (queryEvents, StreamEvents replay) and `263-fix-edge-owner-scope`
    (QueryEvents); rebase-only.
  - Low risk: `272-fix-analysis-backtest-bounds` may read or retire `analysis.backtest.max_duration_seconds`, used
    here only as an AC fixture key; `244-fix-python-config-stored-zero` edits the disjoint SCALAR_BOUNDS_REGISTRY
    region (:99-146); `252-fix-identity-ledger-test-suites` changes the ledger/config test harness AC-5/AC-10 rely on
    (sequence after 252 or verify the tests run); `266-fix-db-tls-fail-closed` changes startup DB wiring that could
    reach the LISTEN client; `259-fix-python-loop-supervision` and the 247/273 agent deadline features consume the
    FR-3/FR-5 error contracts client-side.
  - merge-order: no row references 258; no FAIL-level overlap, so no blocking row. Optional non-blocking
    same-function rows (258 vs 241 SetConfig, 258 vs 263 getConfig) left for /sdd-spec.
- OPERATOR DECISIONS (binding, recorded 2026-10-21):
  - Grouped by service+theme from the 2026-10-20 debt-radar scan; Track C.
  - Scope is D-05, D-06, D-35, D-58.
- Next: `/sdd-design fix-config-stream-resilience`.
