# Context: opportunities-latency-fix

**Feature**: `docs/roadmap/features/183-opportunities-latency-fix/feature.md`
**Product Spec**: `docs/roadmap/features/183-opportunities-latency-fix/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/183-opportunities-latency-fix/implementation-spec.md`

---

## Session 2026-09-08 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Root cause analysis performed via DigitalOcean runtime logs: identified 6 bottlenecks (P0–P5) in the ListOpportunities call chain.
- Ledger scan: feature 141 (semaphore sizing to downstream capacity) directly relevant — batch RPCs eliminate the per-symbol fan-out entirely, and the Go batch handler must use `WHERE symbol = ANY($1)` single-query pattern (not per-symbol goroutine fan-out) to respect the pool budget.

## Session 2026-09-09 — sdd-design

- Phase 0 Recon: wrote recon.md (services: packages/proto, xstockstrat-marketdata, xstockstrat-analysis, xstockstrat-ui; key reuse patterns: GetLatestQuotesBatch single-query template, MultiSymbolSource.GetBarsMulti interface).
- Phase 1 Grilling: 4 rounds (full). Chosen approach: 8-step additive batch RPCs (LATERAL JOIN BatchGetBars, ROW_NUMBER BatchGetLatestPrice) + Phase 0 asyncio.gather + TTL 10→20 + BFF per-call timeoutMs. Rejected: streaming BatchGetBars (unnecessary complexity), flat ANY without per-symbol LIMIT (unbounded rows), raise sem 2→5 (insufficient).
- Constitution rules touched: C-04, C-08, C-11, C-14, C-16, F-01, F-04, F-11, P-03, P-05. Floor breaches: none.
- Status: draft → design-approved.

## Decisions

- **LATERAL JOIN over ROW_NUMBER for BatchGetBars** — LATERAL pushes per-symbol LIMIT into the index scan, avoids materializing all rows; ROW_NUMBER reserved for BatchGetLatestPrice (prev close) where only 1 row/symbol is needed.
- **`timeframe = "1d"` enforcement** — BatchGetBars rejects non-daily timeframes to avoid combinatorial lock-budget risk; only consumer (analysis Phase 1) uses daily bars exclusively.
- **TTL 20s (not 15s)** — React Query v5 counts refetchInterval from completion, not start; 20s provides margin over 15s poll + ~5s response time.
- **Type-assert fallback for GetLatestTradesMulti** — Alpaca source may not implement the multi-trade interface; runtime type-assert with per-symbol fallback preserves non-Alpaca compatibility.
- **8 MB gRPC receive limit** — worst case 100 symbols × 400 bars × ~80 bytes ≈ 3.2 MB; 8 MB provides 2.5× headroom over default 4 MB.
- **`now_utc` captured AFTER `asyncio.gather`** — prevents timestamp staleness equal to the duration of the slowest drain.
- **Enrichment batch try/except with per-symbol fallback** — preserves @AC-11 (omit-not-fabricate) when batch transport fails.
- **C-16 CHANGE sign-off**: `@AC-5 @FR-4 @feature-177` TTL default raised 10→20s; guarantee shape preserved, only threshold changes.

## Open Threads

- [ ] EXPLAIN ANALYZE the LATERAL JOIN on staging with ~100 symbols, 400-day range — target: /sdd-spec Step 2.
- [ ] Verify Alpaca multi-symbol trades endpoint exists and its rate limits — target: /sdd-spec Step 3.
- [ ] Verify Connect-es `CallOptions.timeoutMs` emits `DeadlineExceeded` status code — target: /sdd-spec Step 8.

## Session 2026-09-09 — sdd-spec

- Implementation spec generated: 13 steps (4 proto/gen, 4 marketdata Go service+test, 4 analysis Python service+test, 2 UI BFF service+test, 1 config).
- All 9 acceptance scenarios (AC-1 through AC-9) mapped to test steps: AC-1→Step 13, AC-2/AC-3→Step 4, AC-4/AC-5→Step 6, AC-6/AC-7/AC-8/AC-9→Step 11.
- Consumer surface `/insights` reached by Step 12 (BFF deadline plumbing) per C-14.
- Test-step pairing (C-08) satisfied: Steps 3→4, 5→6, 7/8/9/10→11, 12→13.
- Cross-cutting constraints applied: lint gates in all test step verifications, header propagation cited for Steps 8/9 (reuses existing channel/stub), C-13 single-consumer inline literals noted for test data.
- Note: Go `service` steps (3, 5) land new logic in handler/repository/service packages — handler and repository are excluded from CI coverage measurement, so integration test verification is sufficient per spec-template.md; service-layer tests in Steps 4/6 cover the service package.
- Status: design-approved → implementation-ready.

## Session 2026-09-09 — sdd-review product-spec

- Product spec reviewed (retroactive — status already design-approved). Result: PASS WITH WARNINGS (1 warning, 0 blockers).
- Warning: criterion 9 — unchecked open-question checkbox for ledger 141 trap; resolved by checking box (substance was already resolved in design.md/recon.md).
- Overlap findings: CLEAN — no collisions with 7 in-flight features.
- Trading domain checks: skipped (non-trading feature).

## Session 2026-09-09 — sdd-review impl-spec (advisory)

- Result: 0 failures, 4 warnings, 1 note (advisory — did not block).
- Unresolved ✗ / ⚠ carried into execution:
  - Step 4: ⚠ Missing explicit coverage threshold in Verification command (C-08) — [x] addressed (added `-coverprofile` + ≥40% gate)
  - Step 6: ⚠ Missing explicit coverage threshold in Verification command (C-08) — [x] addressed (added `-coverprofile` + ≥40% gate)
  - Step 11: ⚠ Missing explicit coverage threshold in Verification command (C-08) — [x] addressed (added `--cov=app --cov-fail-under=40`)
  - Step 12: Note — forward() opts merge imprecision (conflated `forward`'s own options with callback opts) — [x] addressed (clarified `forwardOpts` second param → merged into `callOpts` → threaded to callback)
  - Step 2: ⚠ Wildcard paths for codegen stubs (`*.go`, `*_pb2*.py`, `*`) — [ ] accepted (codegen output; exact filenames depend on `buf.gen.yaml` template and are not stable to pin)
- Overlap findings: CLEAN — no collisions with 7 in-flight features.

## Session 2026-09-09T — sdd-execute (unattended, all steps)

**Mode**: unattended execution — user approved skipping per-step Phase 2 confirmation for all steps.
**Open review warnings**: 0 failures, 1 accepted wildcard note (Step 2, codegen output).

### Step 1 — proto: BatchGetBars and BatchGetLatestPrice definitions
- Added 2 RPCs (BatchGetBars, BatchGetLatestPrice) and 5 messages to marketdata.proto
- Verification: `buf lint` pass, `buf breaking --against main-dev` pass
- TDD: N/A (proto — non-code-bearing)
- Status: implementation-ready → in-progress

### Step 2 — proto-gen: regenerate stubs
- Ran `./scripts/buf-gen.sh` — generated Go, Python, TS stubs (13 files changed, 1786 insertions)
- TS build (`pnpm run build`) passed
- TDD: N/A (proto-gen — non-code-bearing)
