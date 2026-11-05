# Product Spec: spec-hygiene-guards

**Created**: 2026-11-05

---

## Problem Statement

PR #657 (open, base `main`, 2026-06-09) audited launched features against code. Reconciled against `main-dev` `b371a3e` (2026-11-05), almost all of its findings are resolved, archived, or owned by another feature or defect report; two residuals remain with nothing guarding or recording them. (1) Nine feature-number prefixes are shared by 19 directories, and no mechanical gate stops a new collision. (2) Root `CLAUDE.md` still says "All services → xstockstrat-ledger / xstockstrat-notify", which overclaims. The full finding-by-finding disposition is in `context.md`.

## User Story

As a platform maintainer, I want the spec-hygiene residuals from the PR #657 audit enforced or corrected in the repo, so that feature numbers stay unambiguous and the dependency graph in the first-loaded context file is true.

## Functional Requirements

FR-1. A CI check fails when two or more directories under `docs/roadmap/features/` share a three-digit `NNN-` prefix, unless that prefix is in a checked-in grandfather allowlist. The failure output names the prefix and every colliding directory.

FR-2. The grandfather allowlist is shrink-only: the check fails when an allowlisted prefix no longer has two or more directories (a stale entry), so entries are removed as soon as they stop being needed. The initial allowlist is the eight prefixes whose every directory is `launched` (number immutable): `058`, `064`, `097`, `111`, `140`, `149`, `153`, `169`.

FR-3. `065-second-market-data-vendor` (status `idea`, not launched) is renumbered to a fresh number from `scripts/sdd-allocate-feature-number.sh` using the collision procedure in `docs/runbooks/feature-workflow.md` § Feature Numbering (`git mv`, then fix the moved directory's own path lines and any self-referential `NNN`). `065-cross-stock-score-derivation` (launched) keeps `065`, so `065` is not allowlisted. FR-1..FR-3 land in one PR: the check would fail on the unrenumbered `065` pair if it merged first.

FR-4. Root `CLAUDE.md` § Inter-Service Dependencies replaces "All services → xstockstrat-ledger (event writes)" and "All services → xstockstrat-notify (alert emissions)" with the services that actually call them. The lists in AC-5 are the authoritative target; design re-verifies them against the code and, if they differ, amends AC-5 before `/sdd-spec` (the doc must match the code, not the draft).

FR-5. On pull requests, the check also fails when the allowlist on the PR head contains a prefix that the allowlist on its base branch does not, so a new collision cannot be "fixed" by allowlisting it. Removing a prefix is allowed.

## Out of Scope

- The `alpaca-default` / `"default"` placeholder-identity fallbacks in `xstockstrat-portfolio` and `xstockstrat-analysis`: already recorded as open defect `docs/reports/2026-10-19-portfolio-default-identity-fallback-defect.md` (SEV-3), which also covers the reachable `user_id: ""` path via trading's `RegisterBrokerAccount`. Route it with `/sdd-triage --from-report` (Track C); it is a bug, not new capability. Dropping the inert `DEFAULT 'alpaca-default'` column defaults belongs to that track too.
- PR #657's GAP-2 (`agent.oauth.*` keys unseeded): owned by feature 295 (`implementation-ready`) via its parity gate; the PR's `006_agent_oauth_config` migration is obsolete (it inserts a `trading_mode` column feature 147 removed, and uses an `ON CONFLICT` target that no longer exists).
- PR #657's GAP-1 (FR-6 `alpaca-default` seed row), GAP-3 (`OTEL_SERVICE_NAME`), S-1, S-4, S-5, S-6, and the nginx supersession: resolved or archived on `main-dev`. Specs 001, 009, 015 and 038 were pruned by `/sdd-archiver`, so there is nothing left to amend.
- PR #657's S-3 ("all services subscribe at startup" vs the agent): becomes true when 295 lands (the agent subscribes); no wording change now.
- Renumbering any `launched` feature.
- Closing PR #657 (a maintainer action once this lands).

## Affected Services

None. Repo-level only: CI check + allowlist, the `docs/roadmap/features/` renumber, and root `CLAUDE.md`.

## Consumer Surface(s)

- [ ] **UI** — none
- [ ] **Agent** — none
- [x] **None** — internal/platform-only. FR-1..FR-3 are CI and repo hygiene and FR-4 is documentation; no service behavior, field, control or MCP tool changes.

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/spec-hygiene-guards` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [ ] 1 service owner approval (non-breaking proto or config change) — n/a, no service touched
- [ ] 2 service owners + platform lead (breaking proto change) — n/a
- [ ] DBA review + service owner (schema migration) — n/a

Platform Lead reviews FR-4 (dependency-graph correctness). Step categories are `docs` and CI tooling, so no service-owner review applies.

Teardown (root `CLAUDE.md`): FR-4 edits a context file, so `/context-forge:context-constitution refresh` runs scoped to it before the PR; if the plugin is unavailable the PR body must record that and the manual reconciliation (ledger `fails.md:670`). `/sdd-spec` carries this as an explicit final step.

Shared-file overlap (warn-level, rebase only; no `merge-order.md` entry needed): `.github/workflows/ci.yml` (`changes` filter, new job, `ci-gate` needs) is also edited by 295 (`config-wiring`) and 297 (its own job); root `CLAUDE.md` is edited by 297 (Key File Paths row) and 295 (§ Config Governance Rules), in sections disjoint from FR-4's § Inter-Service Dependencies. Landing after 295 and 297 is optional.

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

None blocking. Decisions taken at product-spec review (2026-11-05), recorded in `context.md`:

- [x] **Check location (was OQ-1).** A new `scripts/check-feature-numbers.sh` with a sibling `.test.sh`, a new job in `.github/workflows/ci.yml` added to the `ci-gate` needs list, following `check-migration-contract.sh` / `check-otel-produced-signals.sh`. It runs on `pull_request` and on `push` to `main-dev` / `main` (direct pushes to `main-dev` occur). Verified at review: the `changes` job (`ci.yml:13-21`) skips only a `main-dev` → `main` promotion PR, not docs-only PRs. Exact job wiring and path filter are `/sdd-spec` detail.
- [x] **Append-proof allowlist (was OQ-2).** Yes — now FR-5 / AC-6. PR-only because `github.base_ref` is empty on push; precedent `migration-contract-gate` (`ci.yml` ~L722-739, `fetch-depth: 0`, diff against `origin/${{ github.base_ref }}`).

Known traps (Ledger), for design and spec:

- `fails.md` ~L213-227: feature numbers were once allocated from the local tree and collided with unmerged branches — the allocator now exists, so FR-3 must use it, never `max+1`.
- `fails.md` ~L1511: stale governance text persisted because no gate forced the fix — FR-4 must be verified against code, not copied from this spec.
- `fails.md` ~L671: the context-forge teardown was skipped on a CLAUDE.md edit; do not repeat.
