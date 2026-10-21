# Product Spec: fix-edge-owner-scope

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-21-edge-owner-scope-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21

---

## Problem Statement

Source: repo-surveyor debt-radar scan @ 4535695, findings D-25, D-31 (re-verified on main-dev @ a053b0e).

**Observed.**
- **D-25** — `traderBff.ts:118-126` (`services/xstockstrat-ui/src/lib/traderBff.ts`) rewrites only `copilot:` stream
  keys to the caller's thread and forwards every other (or empty) `stream_key` unchanged. Ledger `QueryEvents`
  (`services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:124-162`) has no owner predicate, so any signed-in
  trader can read every user's events. Live callers: `usePositionLineage.ts:16-19` (no stream key, owner filtered
  client-side only) and `useReconciliationStatus.ts:12-13` (`account:<id>`, no ownership check).
- **D-31** — agent `get_config` / `list_config_keys` (`services/xstockstrat-agent/app/tools.py:1592`, `:1620`)
  pass a caller-chosen `user_id` as the request body; config reads (`configServiceImpl.ts:78-79`, `:317-319`,
  `:527-536`) trust it over the verified `x-user-id` the agent propagates. Any MCP user can read another user's
  non-secret per-user overrides and see which keys they overrode.

**Expected.** Every edge read returns only the caller's own data. The trader BFF forwards only owned stream keys
(and refuses empty/unknown ones) or the ledger read is owner-scoped; a non-admin `get_config` / `list_config_keys`
for another user's `user_id` is refused with `PERMISSION_DENIED`. Legitimate own-data reads
(copilot thread, own position lineage, own account reconciliation status, own config overlay) keep working.

## Functional Requirements

- **FR-1** — The trader BFF `LedgerService.QueryEvents` forwards a non-empty `stream_key` only when it is owned by
  the verified caller (an `account:<id>` the caller owns, or the caller's own `copilot:` thread); a foreign stream key
  fails with `PERMISSION_DENIED` and returns no events.
- **FR-2** — A trader BFF `QueryEvents` with an empty or unrecognised `stream_key` is either refused or owner-scoped
  to the verified caller; it never returns an event belonging to another user, nor a historical row whose `user_id`
  is NULL (`ExportEvents` parity). An empty-`stream_key` query still returns the caller's own events (FR-5).
- **FR-3** — Agent `get_config` called by a non-admin caller with a `user_id` other than the verified caller's fails
  with `PERMISSION_DENIED` and never returns that user's per-user override values.
- **FR-4** — Agent `list_config_keys` called by a non-admin caller with a `user_id` other than the verified caller's
  fails with `PERMISSION_DENIED` and never reveals which keys that user overrode.
- **FR-6** — A caller with admin access scope may still read another user's per-user overlay through `get_config`
  (FR-3/FR-4 bind non-admin callers only).
- **FR-5** — Legitimate own-data reads keep working: own copilot thread, own position lineage, own account
  reconciliation status, and own per-user config overlay.

## Consumer Surface(s)

- **UI — trader segment (`/trader`)**: BFF `QueryEvents` responses become owner-scoped. `useReconciliationStatus`
  (`account:<id>`) keeps working for owned accounts and gets `PERMISSION_DENIED` for foreign ones;
  `usePositionLineage` (no stream key) receives only the caller's events instead of filtering client-side. No visual
  change for a user reading their own data.
- **Agent (MCP tools)**: `get_config` and `list_config_keys` stop returning another user's per-user overlay to a
  non-admin caller; own-overlay reads are unchanged.

## Reproduction Steps

1. D-25: as trader user A, call `/trader/api/xstockstrat.ledger.v1.LedgerService/QueryEvents` with
   `{"streamKey": "account:<B's account id>"}` or `{"eventType": "order.filled"}` (no stream key); B's events return.
2. D-31: as non-admin MCP user A, `get_config(namespace="analysis", user_id="<B>")` returns B's overlay values.

## Root Cause Hypothesis

Owner scoping is a per-edge special case (copilot rewrite, insights forced key, `SetConfig` per-user write gate)
rather than a rule at the backend read: ledger `QueryEvents` has no owner concept, and config reads trust the body
`user_id`.

## Affected Services

- xstockstrat-ui (trader BFF; fix site for D-25; position-lineage and reconciliation hooks are consumers)
- xstockstrat-ledger (unscoped `QueryEvents`; fix site only if design scopes the read backend-side, as
  `ExportEvents` already does at `ledgerServiceImpl.ts:279-311`)
- xstockstrat-agent (D-31 tools; fix site if the agent binds `user_id` to the caller)
- xstockstrat-config (body-`user_id` reads; fix site if config binds `user_id` to `x-user-id` unless admin/internal)

## Fix Scope

- [x] No proto changes anticipated — an edge-only fix or a ledger predicate on the inbound `x-user-id` needs none;
  revisit only if design adds an explicit owner field to `QueryEventsRequest`
- [x] No database migrations anticipated — `ledger.events.user_id` already exists (migration 003, nullable; historical
  rows are NULL and cannot be backfilled under the append-only guard)
- [x] No config key changes anticipated

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Open Questions

- [x] Fix site for D-25 (BFF allow-list vs ledger owner predicate on `QueryEvents`). Resolved 2026-10-21: the product
  contract is site-agnostic. FR-1/FR-2 and AC-1/AC-2/AC-7 assert behaviour at the trader BFF surface, so either site
  satisfies them. `/sdd-design` picks the site (C-11) and must keep insights BFF and `ExportEvents` parity.
- [x] Foreign `user_id` in D-31: refuse vs bind to caller. Resolved 2026-10-21: refuse with `PERMISSION_DENIED`
  (FR-3/FR-4, AC-4/AC-5). Silent rebinding would hide the error and differ from FR-1 and the `SetConfig` per-user gate.
- [x] Admin/internal exemption and NULL-owner rows. Resolved 2026-10-21: admin-scope callers stay exempt from
  FR-3/FR-4 (FR-6, AC-8), matching the existing "non-admin" wording. NULL-`user_id` historical ledger rows are never
  returned by a trader BFF read (FR-2, `ExportEvents` parity, AC-2), since they cannot be attributed to the caller.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Config `GetSecret` taking `user_id` from the body (debt-radar NC-B, needs confirmation — not yet a finding)
- The `sourceService: 'trading'` vs `'xstockstrat-trading'` mismatch in `usePositionLineage.ts:18` (same class as
  feature `251-fix-getpnl-source-service`; note that fixing it without D-25 would start returning other users'
  fills to the browser)
- Insights BFF `queryEvents` (already forces `portfolio:<own id>`)
