# Context Log: fix-edge-owner-scope

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-edge-owner-scope-defect.md` (Issues disabled), sidecar
  `triaged` / `ref: feature:263-fix-edge-owner-scope`.
- Source: repo-surveyor debt-radar scan (`docs/repo-surveyor/debt-radar-findings.md` @ 4535695), findings D-25,
  D-31 (both flagged security, "Human triage" routing in the scan).
- Severity: SEV-2. Impact type: cross-tenant-data-read. Environment: dev (main-dev) @ a053b0e. Config-only: no.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2
  (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..6), context.md.
- Affected services: xstockstrat-ui, xstockstrat-ledger, xstockstrat-agent, xstockstrat-config.
- Root cause hypothesis: owner scoping is per-edge special-casing; ledger `QueryEvents` has no owner concept and
  config reads trust body `user_id` over the verified `x-user-id`.
- Both D-ids reproduce on a053b0e. Line drift vs the scan: none — `traderBff.ts:118-126`,
  `ledgerServiceImpl.ts:124-165` (WHERE built `:126-156`), `tools.py:1592-1617` / `:1620-1639`, config
  `configServiceImpl.ts:317` / `:527`.
- New evidence found at triage (not in the scan): the exposure has live callers —
  `services/xstockstrat-ui/src/hooks/usePositionLineage.ts:16-19` sends no stream key (owner filtered client-side
  only) and `useReconciliationStatus.ts:12-13` sends `account:<id>` with no ownership check. Lineage also filters
  `sourceService: 'trading'`, which trading never writes (it writes `xstockstrat-trading`), so lineage likely returns
  nothing today; fixing that literal before D-25 would begin shipping other users' fills to the browser.
- Agent propagates the verified caller as `x-user-id` (`client.py:59-79` `_metadata`), so config already has the
  signal it needs; a config-side bind would also cover the trader/insights BFF `getConfig` forwards
  (`traderBff.ts:146`, `insightsBff.ts:161`), which pass the browser's body through unchanged.
- **Overlap check:** no `docs/reports/*config*user*` report exists. Adjacent but excluded: debt-radar NC-B
  (`configServiceImpl.ts:343`, `getSecret` takes body `user_id`) is still a needs-confirmation question, not a
  finding. Feature `241-fix-config-audit-author-spoof` (implementation-ready) edits config `setConfig` and agent
  `tools.py`/`client.py` config tools — rebase against it. Feature `242-fix-push-untargeted-broadcast` touches
  `traderBff.ts` and config `authz.ts` — textual merge risk. Feature `251-fix-getpnl-source-service` is the same
  source-service literal class as the lineage note above.
- Design forks to settle: (a) D-25 fix locus — BFF allow-list + account-ownership check (needs a trading
  `ListBrokerAccounts` lookup per call or a cached set) vs a backend ledger owner predicate. `ledger.events` already
  has a nullable `user_id` (`migrations/003_events_user_id.up.sql`, feature 021) and `ExportEvents` already scopes
  `WHERE user_id = <x-user-id>` (`ledgerServiceImpl.ts:279-311`), so no migration is needed — but historical rows
  are `user_id = NULL` (UPDATE is denied), and backend writers that append without a user would vanish from a
  scoped read; empty stream key: refuse vs force-scope. (b) D-31 fix
  locus — agent binds `user_id` to the caller vs config binds body `user_id` to `x-user-id` unless admin /
  allow-listed internal caller (must not break internal per-user `WatchConfig` subscribers); whether admins keep
  cross-user reads.
- Recommended design depth: full → `/sdd-design fix-edge-owner-scope` (rationale: SEV-2 security with 4 affected
  services — the C-0 full trigger; no proto/migration anticipated).
- Development branch: feature/fix-edge-owner-scope
