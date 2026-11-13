# Debate Register: fix-orphaned-code

**State**: in-debate
**Mode**: full
**Rounds run**: 3 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-11 | /sdd-batch | 5 | 3 | 0 | 2 | 0 | yes |
| 2 | 2026-11-11 | /sdd-batch | 4 | 2 | 1 | 1 | 0 | yes |
| 3 | 2026-11-13 | /sdd-batch | 4 | 3 | 1 | 0 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | Portfolio fix: swap r.pool to r.db at portfolio_repo.go:217,241,341 with no interface change. Pool() keeps returning r.pool. pgxmock tests for all three methods are proven RED per test via `go test -run`, with no recover(). | portfolio_repo.go:22,25,45,49,56; portfolio_repo_test.go:49-87 | settled |
| D-2 | 1 | Item 9: keep the PortfolioPanel combined branch and add a constraint comment of at most 2 lines at PortfolioPanel.tsx:85, which preserves @AC-30. | AccountContext.tsx:43-48; e2e/trader/offline-pnl.spec.ts:109-121,195-205 | settled |
| D-3 | 1 | Ingest: close findings row :23 (app/extractors/*). Annotate row :24 with the dangling labels app.extractors.noop and app.extractors.example_simple_email. Leave fundsignal_loop.py:623, ui page.tsx:604 and the fixture strings unchanged. Refresh the INGEST-6 ~L anchors. Keep the RawInput name, narrowed to McpClientInput. | services/xstockstrat-ingest/docs/context-constitution-findings.md:23-24; fundsignal_loop.py:623; signal-sources/page.tsx:604; servicer.py:205,1469,1504,1540 (extractor_module is never resolved) | settled |
| D-4 | 1 | Lock regen uses `pnpm install --lockfile-only`, then `pnpm install --frozen-lockfile`. `pnpm why` is mandatory, and the lock diff must be scoped to the touched importers. | services/xstockstrat-{ledger,notify}/Dockerfile:13,17 (--frozen-lockfile); fails.md:2388-2390 | settled |
| D-5 | 1 | The config gate runs after `rm -rf dist`, or relies on CI's clean checkout, and c8 --lines 40 is re-run. | config package.json test script `tsc && node --test dist/__tests__/*.test.js` | settled |
| D-6 | 2 | Reword config CLAUDE.md:131 (APPLICATION_ENV) to 'telemetry resource attribute only' and close config findings :14 in the same step as the configWatcher.ts deletion, not in a separate docs step. Review config findings :4 and :33 and context-constitution.md :7,18,19,50 in that step too, and leave findings :22 alone. | services/xstockstrat-config/CLAUDE.md:131; services/xstockstrat-config/docs/context-constitution-findings.md:14; services/xstockstrat-config/src/telemetry.ts:32 (sole remaining reader after the deletion) | settled |
| D-7 | 2 | Refines D-4: the expected root pnpm-lock.yaml diff is the touched importer entries plus the transitive packages:/snapshots: closure that `pnpm why` confirms has no remaining dependent. Anything else is drift and fails the step. | D-4; fails.md:2388-2390; adversary r2 objection 4 | settled |
| D-8 | 2 | Gate /sdd-spec on the operator's recorded O-1 choice. Whichever option is chosen, amend the @AC-2 Given clause to list exactly the leaves covered (under (b), also add identity to product-spec Affected Services) before any package.json edit appears in a step's Files list. | acceptance.feature @AC-2; F-08/P-03; services/xstockstrat-{ledger,config,notify}/package.json:11 and identity:11,55 | settled |
| D-9 | 2 | Sequence 323 against peer 324 in docs/roadmap/features/merge-order.md. The later-merged feature rebases and regenerates the root lock under the D-4 protocol, and nobody resolves the lock by hand. | docs/roadmap/features/324-fix-ci-enforcement-gaps/product-spec.md:45,52 (coverage-script edits at config/identity/notify package.json:13, ledger:14) | settled |
| D-10 | 3 | Refines D-8: the @AC-2 amendment rewrites the When/Then as well as the Given, in the same edit before /sdd-spec. The When becomes 'each touched leaf's package.json and the root pnpm-lock.yaml importers are inspected, and git ls-files is searched for the deleted paths'. The Then keeps 'every affected service still builds and passes its tests'. The AC-2 presence check is exactly: manifests free of node-pg-migrate/"migrate" (and notify jsonwebtoken/bcrypt/@types), root-workspace `pnpm why` matching the expected output, deleted paths absent from git ls-files, and empty `grep AlpacaAsset`. A repo-wide grep is never used. | docs/roadmap/features/323-fix-orphaned-code/acceptance.feature:12-16; stale per-service locks services/xstockstrat-notify/pnpm-lock.yaml:41,47,90 and services/xstockstrat-identity/pnpm-lock.yaml:90,1112,2595; C-15/P-03 | settled |
| D-11 | 3 | The four per-service pnpm-lock.yaml files (services/xstockstrat-{config,identity,ledger,notify}/pnpm-lock.yaml) are neither regenerated nor deleted. Step 3 adds one root docs/context-constitution-findings.md row naming them as vestigial and stale against their manifests. | Dockerfiles copy only the root lock (:13); no consumer in .github/, scripts/, .husky/ or docs/patterns/; .jscpd.json:32 only ignores them; deferred by 175 (context.md:14,20) and stepped around by 226 (context.md:67) and 274 (context.md:49,91); no existing findings row | settled |
| D-12 | 3 | Step 3's spec makes the local `pnpm install --frozen-lockfile` output and the `docker compose build` output for the touched leaves required evidence recorded in context.md. No CI guard is added in this feature. | .github/workflows/ci.yml:564,789,995 (--no-frozen-lockfile for Node leaves) vs :305; services/xstockstrat-*/Dockerfile:17 (--frozen-lockfile); product-spec Out of Scope; peer 324 owns CI gaps | settled |
| D-13 | 3 | Under (b): the identity edit is package.json:11,55 only; the identity compose build gate is unconditional; no identity doc edit; expected `pnpm why node-pg-migrate` is zero dependents across all importers (identity only under (a)); expected `pnpm why bcrypt jsonwebtoken` is identity only. The identity C-16 sweep records fix-identity-ledger-test-suites.feature @AC-1 @feature-252 as PRESERVE, with the Then clause discharged by `pnpm build && pnpm test:coverage` and the mutation clause recorded as unaffected (no src/ change). | services/xstockstrat-identity/Dockerfile:13,17; docker-compose.yml:181,185; services/xstockstrat-identity/CLAUDE.md:118; root pnpm-lock.yaml:136,251,360,481; identity package.json:34-35,48-49; fix-identity-ledger-test-suites.feature:4-9 | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Delete the PortfolioPanel combined branch | Turns durable @AC-30 into a C-16 CHANGE and breaks offline-pnl.spec.ts | locked |
| R-2 | 1 | Migrate WatchlistRepo and signal_expiry_repo to a mockable db handle | Scope creep: needs a Begin-capable interface and collides with peer 311 | locked |
| R-3 | 1 | Change fundsignal_loop.py:623's extractor_module value | Changes stored-row semantics; the label is never resolved | locked |
| R-4 | 2 | Spin identity's node-pg-migrate removal off into a follow-up bug | It needs a second lock regen and a second PR for a one-line deletion (C-18) | locked |
| R-5 | 2 | Resolve the pnpm-lock.yaml conflict with peer 324 by hand | Risks a corrupted or drifted lock; the later-merged feature regenerates it instead | locked |
| R-6 | 3 | Delete or regenerate the four vestigial per-service pnpm-lock.yaml files in this feature | Deleting is outside the report's ten items and against the 175 deferral precedent. Regenerating is unscoped churn on files nothing reads (D-7, C-18). A findings row records the gap instead. | locked |
| R-7 | 3 | Use a repo-wide `grep node-pg-migrate`, or the unamended 'repository is searched' wording, as the AC-2 check | It reports RED after a correct fix because of the stale per-service locks; narrowing the check without rewording the scenario is a silent C-15/P-03 deviation | locked |
| R-8 | 3 | Add a CI --frozen-lockfile guard for the Node leaves in this feature | Out of scope per product-spec; peer 324 owns CI enforcement gaps | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | Operator choice on identity for the node-pg-migrate removal: (a) three leaves, and narrow root findings :57 to identity-only; or (b) amend the product spec to add identity and close :57. In either case the AC-2 Given clause must list the leaves actually covered. | yes | open |
| O-2 | 1 | Re-verify every recon line number before it goes into implementation-spec.md (the config :14, marketdata :33 and agent :34 findings rows, and config-wiring.json:52-55). | no | closed @ round 2 (The proposer re-verified every named anchor at main-dev (config-wiring.json:52-55, config findings :14, marketdata :33, agent :34, plus extra config-doc hits), and the adversary confirmed them. A spec-time re-grep stays as a step note.) |
| O-3 | 2 | Under (b), run a C-16 identity sweep: record services/xstockstrat-identity/acceptance/fix-identity-ledger-test-suites.feature @AC-1 @feature-252 as PRESERVE, discharged by `pnpm run test:coverage`, and grep the six other identity suites for build and dependency terms. | no | closed @ round 3 (The proposer grepped all seven identity suites. The one hit, fix-identity-ledger-test-suites.feature @AC-1 @feature-252, is PRESERVE: its Then clause (:8) is discharged by `pnpm build && pnpm test:coverage`, and its mutation clause (:9) is recorded as unaffected (no src/ change). The adversary confirmed. It applies under (b) and is N/A under (a).) |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
