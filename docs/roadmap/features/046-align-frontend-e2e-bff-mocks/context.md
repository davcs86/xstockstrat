# Context: align-frontend-e2e-bff-mocks  (archived 2026-08-05)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-05 — /sdd-archiver

**What**: This shipped as almost entirely test-file surgery (`e2e/*.ts`, three `CLAUDE.md` docs) — zero production code changed. The bulk of "aligning" the mocks was closing gaps left by `044-client-api-pattern`/PR #451, plus fixing two pre-existing proto-field bugs (`accountId`→`id`) in the mock backends that had been silently returning broken data all along (context.md Step 3, Step 5).
**Why (irrecoverable rationale)**: H2C gRPC mock via `*_ENDPOINT` was chosen over a transport override specifically so *no production code needs touching* — the BFF's `createGrpcTransport` dials the mock exactly as it dials a real backend (product-spec.md:74-78). Per-frontend mocks (not shared) were chosen because each frontend's service set differs enough that a shared module would couple unrelated fixtures (product-spec.md:79-83).
**Rejected alternatives**:
- Transport override / non-gRPC test-only shim — lost because it would require production code awareness of test mode (product-spec.md:74-78).
- Shared cross-frontend mock module — lost because it couples unrelated service fixtures across trader/insights/config-ui (product-spec.md:79-83).
**Scars & gotchas**:
- protobuf-es JSON serializes enum fields as **string names** (`ORDER_STATUS_FILLED`), not integers — spec assumed `'number'`, had to be corrected during Step 3 (context.md:94).
- Verifying "mock has the right imports" is not the same as "mock works" — Step 4's verification only grepped for `MarketDataService` presence; the real `accountId`/`id` proto-field bug wasn't caught until Step 5 ran the full suite and hit a React duplicate-key crash (context.md:109-111).
- Playwright teardown hangs across all three suites at the end of a full run; had to SIGKILL and count pass-dots instead of waiting for clean exit (context.md:129).
- Badge/locator collisions are easy to introduce: exact-count assertions (`hasText:'3'`) falsely matched dollar amounts; multiple comboboxes on one page required scoping to `form` (context.md:93,96).
**Permanent deviations**:
- impl-spec said `runBacktest` mock returns `{result: {...}}` → shipped returns `BacktestResult` fields at top level → because the actual proto RPC returns `BacktestResult` directly, not wrapped (context.md:105).
- impl-spec said remove the `page.route` mock entirely for the failed-order test → shipped kept a BFF `PlaceOrder` route intercept returning Connect-error JSON → because the mock always succeeds and only a BFF-level error simulation could produce the failure path (context.md:87).
**Cross-feature signal**: The same `accountId`→`id` proto-field bug existed independently in both trader's and insights's `mock-backend.ts` — a copy-pasted scaffolding bug that static/import-only verification cannot catch; only a full e2e run surfaces it.
**Deferred follow-ons**: none found in context.md.
**Ledger entries written**: insights.md (2), fails.md (1) — see the 2026-08-05 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at f5abed5.
