# Product Spec: spec-hygiene-guards

**Created**: 2026-11-05

---

## Problem Statement

PR #657 (open, base `main`, 2026-06-09) audited launched features against code. Reconciled against `main-dev` `b371a3e` (2026-11-05), almost all of its findings are resolved, archived, or owned by feature 295; three residuals remain and nothing guards or records them. (1) Nine feature-number prefixes are shared by 19 directories, and no mechanical gate stops a new collision. (2) Root `CLAUDE.md` still says "All services → xstockstrat-ledger / xstockstrat-notify", which overclaims. (3) Portfolio and analysis silently attribute an empty `account_id` to a literal `alpaca-default` account that no broker row backs. The full finding-by-finding disposition is in `context.md`.

## User Story

As a platform maintainer, I want the spec-hygiene residuals from the PR #657 audit enforced or corrected in the repo, so that feature numbers stay unambiguous, the dependency graph in the first-loaded context file is true, and no component invents an account identity.

## Functional Requirements

FR-1. A CI check fails when two or more directories under `docs/roadmap/features/` share a three-digit `NNN-` prefix, unless that prefix is in a checked-in grandfather allowlist. The failure output names the prefix and every colliding directory.

FR-2. The grandfather allowlist is shrink-only: the check fails when an allowlisted prefix no longer has two or more directories (a stale entry), so entries are removed as soon as they stop being needed. The initial allowlist is the eight prefixes whose every directory is `launched` (number immutable): `058`, `064`, `097`, `111`, `140`, `149`, `153`, `169`.

FR-3. `065-second-market-data-vendor` (status `idea`, not launched) is renumbered to a fresh number from `scripts/sdd-allocate-feature-number.sh` using the collision procedure in `docs/runbooks/feature-workflow.md` § Feature Numbering (`git mv`, then fix the moved directory's own path lines and any self-referential `NNN`). `065-cross-stock-score-derivation` (launched) keeps `065`, so `065` is not allowlisted.

FR-4. Root `CLAUDE.md` § Inter-Service Dependencies replaces "All services → xstockstrat-ledger (event writes)" and "All services → xstockstrat-notify (alert emissions)" with the services that actually call them (see AC-5), re-verified against the code at design time.

FR-5. `xstockstrat-portfolio` (position fold) and `xstockstrat-analysis` (P&L pattern consumer) no longer substitute the literal `alpaca-default` when an event or fill carries an empty `account_id`. The replacement behavior is fixed by OQ-1; AC-6/AC-7 assume the recommended option.

## Out of Scope

- PR #657's GAP-2 (`agent.oauth.*` keys unseeded): owned by feature 295 (`implementation-ready`) via its parity gate; the PR's `006_agent_oauth_config` migration is obsolete (it inserts a `trading_mode` column feature 147 removed, and uses an `ON CONFLICT` target that no longer exists).
- PR #657's GAP-1 (FR-6 `alpaca-default` seed row), GAP-3 (`OTEL_SERVICE_NAME`), S-1, S-4, S-5, S-6, and the nginx supersession: resolved or archived on `main-dev`. Specs 001, 009, 015 and 038 were pruned by `/sdd-archiver`, so there is nothing left to amend.
- PR #657's S-3 ("all services subscribe at startup" vs the agent): becomes true when 295 lands (the agent subscribes); no wording change now.
- Renumbering any `launched` feature, or editing applied migrations (including the inert `DEFAULT 'alpaca-default'` column defaults in trading `003_orders_account_id` and portfolio `003_positions_account_id`).
- Closing PR #657 (a maintainer action once this lands).

## Affected Services

- `xstockstrat-portfolio` — remove the `alpaca-default` fallback in the fill fold (`internal/service/portfolio_service.go`).
- `xstockstrat-analysis` — remove the fallback in the P&L pattern consumer (`app/engine/pnl_pattern_consumer.py`, two sites).
- Repo-level (no service): CI check + allowlist, `docs/roadmap/features/` renumber, root `CLAUDE.md`.

## Consumer Surface(s)

- [ ] **UI** — none
- [ ] **Agent** — none
- [x] **None** — internal/platform-only. FR-1..FR-3 are CI and repo hygiene, FR-4 is documentation, and FR-5 changes how two backend consumers treat a malformed internal event; none adds or changes a field or control reachable from `/trader`, `/insights`, `/config-ui` or an MCP tool.

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes (the inert `DEFAULT 'alpaca-default'` column defaults stay; see Out of Scope and OQ-3)

## Feature Workflow Notes

Branch to create: `feature/spec-hygiene-guards` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (portfolio and analysis owners for FR-5)
- [ ] 2 service owners + platform lead (breaking proto change) — n/a
- [ ] DBA review + service owner (schema migration) — n/a

Teardown (root `CLAUDE.md`): FR-4 edits a context file, so `/context-forge:context-constitution refresh` runs scoped to it before the PR; if the plugin is unavailable the PR body must record that and the manual reconciliation (ledger `fails.md:670`).

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **OQ-1 (decides AC-6/AC-7).** What should portfolio and analysis do with an empty `account_id`? A: treat it as malformed — portfolio's fold returns an error naming `account_id` and writes no row; analysis logs WARN and skips that event without advancing past valid ones (recommended: no phantom account, no poison-pill loop). B: persist it under `""`. C: resolve it from the user's single broker account when exactly one exists. The audit's owner verdict says `alpaca-default` was never deployed, but legacy ledger events replayed by analysis may predate `account_id`; design must check the retained event history before choosing A.
- [ ] **OQ-2.** Where does the FR-1 check live — a new job in `.github/workflows/ci.yml` calling a `scripts/` checker (unit-tested like `sdd-allocate-feature-number.test.sh`), or an extension of an existing workflow? `ci-validate-feature-status.yml` is a promotion-time status updater, not a lint gate, so it is not a natural home.
- [ ] **OQ-3.** Should a follow-up migration drop the inert `DEFAULT 'alpaca-default'` on `trading.orders.account_id` and `portfolio.positions.account_id`? It is excluded here because a new migration on live tables needs DBA review and its own rollback story.
- [ ] **OQ-4.** Can the allowlist be made append-proof (fail if a PR adds a prefix versus its base) rather than relying on review? Without it, a contributor can "fix" a new collision by allowlisting it.
- [ ] **Known traps (Ledger).** `fails.md` ~L213-227: feature numbers were once allocated from the local tree and collided with unmerged branches — the allocator now exists, so FR-3 must use it, never `max+1`. `fails.md` ~L1511: stale governance text persisted because no gate forced the fix — FR-4 must be verified against code, not copied from this spec. `fails.md` ~L671: the context-forge teardown was skipped on a CLAUDE.md edit; do not repeat. `fails.md` ~L1240: an ID-resolving helper's result must be threaded through all downstream calls — relevant if OQ-1 picks option C.
