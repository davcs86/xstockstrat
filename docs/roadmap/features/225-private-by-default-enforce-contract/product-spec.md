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

FR-1. Every owner-scoped RPC in `xstockstrat-analysis`, `xstockstrat-indicators` and `xstockstrat-ingest`
(an RPC that resolves its owner from `x-user-id`; recon enumerates them per service) rejects a call that
carries no `x-user-id` and no SAN-bound internal-caller grant with **`UNAUTHENTICATED`**, uniformly across
the three services (operator decision 2026-10-08). An identified caller who does not own the object keeps
today's code (`NOT_FOUND` / `PERMISSION_DENIED`). This removes the release-N headerless tolerance; it
changes analysis's current `PERMISSION_DENIED` and indicators' `INVALID_ARGUMENT` for the headerless case,
and removes ingest's slug-holder fallback for headerless calls.
FR-2. indicators removes the `_INTERNAL_FORMULA_READERS` SAN-bound `analysis` bypass
(`services/xstockstrat-indicators/app/handlers/servicer.py`). analysis reads formulas only as the
requesting owner or as the SAN-bound `system` identity; a headered `analysis` caller reading another
user's formula gets the ordinary non-owner result.
FR-3. analysis contract migration `027` first re-applies 224's D-1 owner backfill to any
`analysis.backtest_runs` row written with `user_id IS NULL` since 224 (unique strategy owner, else
`SEED_USER_ID`), then sets `analysis.backtest_runs.user_id NOT NULL`.
FR-4. The contract migrations drop exactly these release-N compatibility objects:
- **ingest `014`** (contract-of `013_signal_ownership_templates`): trigger `newsletter_signals_n1_owner_fill`
  on `ingest.newsletter_signals`, function `ingest.n1_owner_fill_signals()`, table `ingest.signal_dedup_keys`
  (superseded by `ingest.signal_dedup_claims`).
- **analysis `027`** (contract-of `026_owner_dimension_templates`): table `analysis.strategy_scores`
  (superseded by `analysis.strategy_scores_v2`), plus FR-3. analysis has no N-1 trigger.
- **indicators**: **no migration in 225.** Release-N code still writes `indicators.formulas.is_public`, and
  migrations run PRE_DEPLOY while release-N binaries still serve, so dropping the column now would fail
  Register/UpdateFormula during rollout. 225 only stops the indicators repository from writing or reading
  `is_public` (the column keeps its `DEFAULT FALSE`); the column drop is a follow-up contract release
  (operator decision 2026-10-08). The `008` reservation is released.
FR-5. Each contract migration carries `-- contract-of: <224 expand file>` within its first 5 lines (where
`scripts/check-migration-contract.sh` reads it); the `migration-contract-gate` CI job accepts it only when
that expand file is on `origin/main`. Each up-file is replay-safe (`IF EXISTS` / guarded `DO` blocks, per
224 design §1) and is covered by `scripts/migration-rerun.sh`. Each `.down.sql` raises instead of
recreating dropped objects (so `migrate goto` below the contract is refused — DBA note).
FR-6. No `LEGACY_GLOBAL` credential path exists to delete (224 did not ship `credential_scope`; ingest
`013` header: prod had zero `mcp_client` sources). 225 keeps a regression guard that `mcp_client` bearer
resolution is per-user only.

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

Contract migrations at the pre-reserved numbers in `merge-order.md` (indicators `008` released — FR-4):

- analysis `027` — D-1 re-backfill of NULL `backtest_runs.user_id`, then `SET NOT NULL`; drop `analysis.strategy_scores`.
- ingest `014` — drop trigger `newsletter_signals_n1_owner_fill`, function `ingest.n1_owner_fill_signals()`,
  table `ingest.signal_dedup_keys`.

Each carries `-- contract-of:` in its first 5 lines, is replay-safe, is added to `scripts/migration-rerun.sh`,
and its down-file raises. analysis `027` requires `SEED_USER_ID` (`-- requires-env`), like `026`.

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

- [x] Precondition: 224 is `launched` — promotion #1233 merged to `main` (2026-10-08); the 224 expand files
  are on `origin/main`. Release order: 225 merges and deploys after prod has run 224 with no N-1 binary.
- [x] FR-1 status code: `UNAUTHENTICATED` (operator decision 2026-10-08, context.md).
- [x] FR-6: no `LEGACY_GLOBAL` path shipped → regression guard only.
- [x] indicators contract scope: no migration in 225; stop writing `is_public`; drop later (operator decision).
- [x] Reserved numbers: analysis `027` / ingest `014` are next-free on trunk (overlap scan 2026-10-08);
  `/sdd-spec` re-verifies against every remote branch (deferred to that named phase).
- [x] Known trap (fail-open→fail-closed): carried to `/sdd-design` as an adversary check — every in-process
  caller (analysis live loop, pnl consumer, fundsignal producer) must be shown to send `x-user-id` or a
  SAN-bound grant before FR-1 ships.
