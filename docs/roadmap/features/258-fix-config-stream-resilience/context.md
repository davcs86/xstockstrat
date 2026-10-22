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
