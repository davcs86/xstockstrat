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

## Session 2026-10-22 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria verdict: PASS WITH WARNINGS (0 fails, 0 floor breaches).
- Warnings (8):
  1. AC-2 had no NULL-`user_id` fixture — **resolved**: Background seeds an `order.filled` on `account:acct-legacy`
     with NULL `user_id` (symbol TSLA); AC-2 asserts it is not returned.
  2. AC-3 copilot isolation loosely specified — **resolved**: seeds `note-a` (`copilot:u-a:default`) and `note-b`
     (`copilot:u-b:default`); asserts exactly `note-a` is returned.
  3. FR-2 "either refused or owner-scoped" contradicted AC-2/AC-7 — **resolved**: FR-2 narrowed to owner-scoping
     (Expected paragraph aligned).
  4. FR-6 listed before FR-5 — **resolved**: reordered.
  5. FR-1 `account:<id>` ownership determination unnamed — **deferred to /sdd-design**: recorded as an open Open
     Question (trading `ListBrokerAccounts` per call vs cached set vs ledger `user_id` predicate; C-11).
  6. Consumer surface PERMISSION_DENIED mapping for `useReconciliationStatus` (advisory) — **resolved**: foreign
     account surfaces through the hook's existing error state.
  7. Doubled input paths from the caller — informational; real dir is `docs/roadmap/features/263-fix-edge-owner-scope/`.
  8. Trading-domain grep matched incidentally — C-1..C-5 not applicable; no action.
- Operator override applied (2026-10-22): FR-3/FR-4, AC-4/AC-5, Expected, Consumer Surface and the Open Questions
  entry now assert **bind-to-caller** (the caller's own `x-user-id` replaces a foreign `user_id`; caller's own
  overrides returned; no other user's data read), replacing the 2026-10-21 "refuse with PERMISSION_DENIED".
- Overlap findings (WARN, file-level only; no config-key / proto-field / migration FAIL):
  - ledger `ledgerServiceImpl.ts:124` QueryEvents vs `257-fix-ledger-query-pagination` (draft; same queryEvents
    body `:157-171`) — high merge-conflict risk if 263 adds a backend owner predicate; 257 also flags other
    QueryEvents callers.
  - ledger `ledgerServiceImpl.ts` vs `248-fix-ledger-trimmed-notify-payload` (implementation-ready; `:196-257`,
    `:364-377`) — same file, non-overlapping bands.
  - agent `tools.py:1592`/`:1620` vs `241-fix-config-audit-author-spoof` (implementation-ready; `set_config`
    `:1694`, `_write_source_bearer` `:353`) — same file, different functions.
  - agent `tools.py:1592-1640` vs `247-fix-agent-getconfig-deadline` (implementation-ready; `client.py:1751`,
    `tools.py:627`, `:2378`) — collides if 263 changes the `client.get_config` call.
  - agent `tools.py` vs `273-fix-agent-client-deadlines` (draft; `GetConfig` `:2043`) — low-to-medium risk.
  - config `configServiceImpl.ts` (`:78-79`, `:317-319`, `:527-536`) vs `241` (SetConfig `:376-414`, `:513`) —
    same file, non-overlapping bands.
  - UI `traderBff.ts:118-123` vs `270-fix-ui-trader-feedback` (draft; no anchors yet) — same-service WARN.

### OPERATOR DECISIONS (binding, recorded 2026-10-22)

- Grouped by service+theme from the 2026-10-20 debt-radar scan; Track C (precedent #1264).
- Scope is D-25, D-31.
- Operator 2026-10-21 (standing, all features): x-trace-id must be propagated as much as possible; no C-03 waiver — request-derived emits/writes use context.WithoutCancel(ctx) (Go) / the inbound metadata (Python/Node), never a fresh background context; only work with no originating request (background sweepers/loops) may mint its own context, and it should still carry a trace id when one is available.
- Operator 2026-10-22 overrides the review writer's D-31 resolution: a non-admin get_config/list_config_keys call carrying a foreign user_id is BOUND to the caller (the caller's own x-user-id replaces it), NOT refused with PERMISSION_DENIED. Amend FR-3/FR-4 and AC-4/AC-5 (and the Open Questions entry) to assert the caller's own overrides are returned and no other user's data is ever read. Confirmed unchanged: admin-scope callers stay exempt (FR-6/AC-8); NULL-user_id ledger rows are never returned by trader-BFF reads (FR-2, ExportEvents parity). D-25 fix site remains a /sdd-design choice.

- Next: `/sdd-design fix-edge-owner-scope` (full depth recommended).
