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
