# Product Spec: private-by-default-enforce-contract

**Created**: 2026-10-07

---

## Problem Statement

Feature 224 (`private-by-default-templates`) shipped as release N, which only expands the schema. So
that a rolling deploy and an N-1 rollback stay safe, it deliberately:

- tolerates headerless calls (no `x-user-id`);
- keeps the SAN-bound `analysis` formula-read bypass (`_INTERNAL_FORMULA_READERS`) in indicators;
- leaves `analysis.backtest_runs.user_id` nullable;
- installs N-1 owner-fill triggers;
- retains the superseded tables, including the bare-id `strategy_scores` cache.

Until these transitional allowances are removed, the private-by-default guarantee is not fail-closed.

## User Story

As a platform operator, I want the release-N transitional allowances of feature 224 removed once it is
launched, so that every owner-scoped read and write fails closed and the schema carries no dead N-1
compatibility objects.

## Functional Requirements

FR-1. Owner-scoped RPCs in `xstockstrat-analysis`, `xstockstrat-indicators` and `xstockstrat-ingest`
reject a call with no `x-user-id` and no SAN-bound internal-caller grant. The rejection is
`UNAUTHENTICATED`; the exact code is confirmed at design. This removes the release-N headerless
tolerance.
FR-2. indicators removes the `_INTERNAL_FORMULA_READERS` SAN-bound `analysis` bypass. analysis reads
formulas only as the requesting owner or as the SAN-bound `system` identity.
FR-3. `analysis.backtest_runs.user_id` becomes `NOT NULL` (contract migration analysis `027`).
FR-4. The contract migrations (analysis `027`, indicators `008`, ingest `014`) drop:
- the `*_n1_owner_fill` triggers;
- the tables superseded by 224;
- the bare-id `analysis.strategy_scores` cache, which `strategy_scores_v2` replaced.
FR-5. Each contract migration declares `-- contract-of: <224 expand file>`. The
`migration-contract-gate` CI job accepts it only when that expand file is already on `origin/main`.
Each `.down.sql` refuses to run (it raises) instead of recreating the dropped objects.
FR-6. Any `LEGACY_GLOBAL` credential path for `mcp_client` sources is deleted. This applies only if 224
shipped one, which is confirmed at recon.

## Out of Scope

- New template kinds or template UI changes.
- Any change to 224's per-user secret model or admin audit semantics.
- Fixing the pre-224 non-idempotent migrations
  (`docs/reports/2026-10-07-db-migrate-dirty-recovery-replay-unsafe-defect.md`). They are tracked by
  that defect report.

## Affected Services

- `xstockstrat-analysis` — headerless fail-closed, `backtest_runs.user_id` NOT NULL, `strategy_scores` drop, N-1 trigger drop
- `xstockstrat-indicators` — bypass removal, headerless fail-closed, N-1 trigger/table drop
- `xstockstrat-ingest` — headerless fail-closed, N-1 trigger drop, `LEGACY_GLOBAL` removal (if shipped)

## Consumer Surface(s)

- [ ] **UI**
- [ ] **Agent**
- [x] **None**. This is internal hardening: the UI BFF and the MCP agent already send `x-user-id`
  (feature 224), so no consumer-facing behavior changes for an authenticated caller. Recon must check
  that no live caller still relies on headerless tolerance.

## Proto Contract Changes

- [x] No proto changes required. Removing deprecated fields is a separate, breaking-proto decision
  that is out of scope unless the design asks for it.

## Config Key Changes

- [x] No new config keys

## Database Changes

Contract migrations, one per service, at the pre-reserved numbers in `merge-order.md`:

- analysis `027`
- indicators `008`
- ingest `014`

Each one drops 224's N-1 owner-fill triggers and superseded tables. analysis `027` also sets
`backtest_runs.user_id NOT NULL` and drops `strategy_scores`. Each migration carries a
`-- contract-of:` header, and its down-file refuses to run.

## Feature Workflow Notes

Branch to create: `feature/private-by-default-enforce-contract` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval per affected service
- [ ] 2 service owners + platform lead (breaking proto change) — not expected
- [x] DBA review + service owner (schema migration)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **Precondition:** 224 must be `launched`, with no N-1 binary still running anywhere, before
  225 merges (see `merge-order.md`).
- [ ] FR-1: which status code is used for a headerless call, `UNAUTHENTICATED` or `PERMISSION_DENIED`?
  It must be consistent across the three services.
- [ ] FR-6: did 224 ship `credential_scope=LEGACY_GLOBAL`? 224's ingest `013` has no
  `credential_scope` column, so this is likely a no-op. Confirm at recon.
- [ ] Re-verify the reserved numbers 027/008/014 against every remote branch at `/sdd-spec`.
- [ ] **Known trap** (ledger `fails.md`, fail-open→fail-closed hardening): re-check every
  "low-risk because validation lags" justification against the fail-closed behavior.
