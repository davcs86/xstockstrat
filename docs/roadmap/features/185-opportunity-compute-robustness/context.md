# Context: opportunity-compute-robustness

**Feature**: `docs/roadmap/features/185-opportunity-compute-robustness/feature.md`
**Product Spec**: `docs/roadmap/features/185-opportunity-compute-robustness/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/185-opportunity-compute-robustness/implementation-spec.md`

---

## Session 2026-09-07 — sdd-story

- Created from the opportunities-queue audit (this session). This is the **compute-correctness** half
  (the feature-181 sentinel + feature-176/180 semaphore-isolation parallels); the **config-operability**
  half is sibling feature 184.
- Audit findings driving this feature:
  - **G2 (FR-1/FR-2):** bars-fetch failure caches `[]` → `_empty_readiness` `0/0` (servicer.py:3841-3843,
    3883; evaluator.py:775, no `bar_epoch`), indistinguishable from evaluated-not-passing. No
    `bar_epoch=-1`→UNKNOWN analogue exists in `_compute_opportunities` (it lives only in the readiness
    paths, servicer.py:2886/2980). Surfaces as a misleading verdict, not a stuck one.
  - **G3 (FR-3):** `_bars_fetch_sem` (servicer.py:412) is shared by the compute fan-out (:3838/:3852) AND
    the interactive `_enrich_opportunities_live` (:3444/:3458). The readiness materializer has its own
    `_readiness_materializer_bars_sem` (:451) for this exact priority-inversion reason; opportunities
    never got the split.
  - **G4 (FR-4, design option):** cold ListOpportunities computes synchronously under the per-user lock
    (servicer.py:3354/3517) — the blocking first-load 181 avoided; but a cold user has no cached rows to
    render, so it's a genuine UX fork, not a mechanical port.
- Deliberately SEPARATE from feature 184: 184 is a low-risk config-only change (seed + bounds); 185 is a
  compute change that likely touches the `Opportunity` proto (additive) + C-16 (what a 0/0 row means) and
  needs a real design debate. FR-3's new semaphore config key is registered/bounded via 184's mechanism —
  sequencing (184 first?) decided at design.
- Numbering: 185 (sibling of 184; 182 launched, 183 = mcp-user-profile-roles already on main-dev).
  Branch: `claude/opportunity-queue-philosophy` off origin/main-dev (shared with 184's story for now).
- Known traps to carry to design: proto3 additive-field + agent descriptor-parity (a projected Opportunity
  field trips the parity test — fails.md:1151); every new proto field needs the e2e mock shape
  (fails.md:1281/1317); the sentinel must survive the JSONB persistence round-trip (feature-131 `muted`
  provenance-marker precedent — survives with no migration).

## Session 2026-09-07 — sdd-review product-spec
- Product spec approved. Status: draft → spec-ready.
- First pass FAILED (C-15/criterion 8): FR-4 (cold-read non-blocking) was a numbered but non-testable "evaluate this fork" requirement with no covering @AC. Fixed: demoted FR-4 to a "Design option" note + the "Cold-read non-blocking" Open Question; numbered requirements are now FR-1/2/3 (FR-1→AC-1/2/5, FR-2→AC-3, FR-3→AC-4). Reconciled the Affected Services cold-read cross-ref; fixed evaluator path to app/services/evaluator.py:775.
- Also folded two prior warnings into explicit design Open Questions: (C-14) the agent list_opportunities MCP mapping for the new proto field must be an explicit step or a documented internal-only justification at design (not "design confirms"); (C-16) the sentinel may CHANGE an opportunities @AC guarantee (0/0 meaning) → scenario-recon classifies PRESERVE/EXTEND/CHANGE; a CHANGE needs explicit user sign-off in context.md.
- Re-review: PASS WITH WARNINGS. 1 advisory carried to design/spec: AC-4's Then states the semaphore mechanism rather than the observable non-starvation outcome — reframe toward observable responsiveness at design/spec.
- Overlap findings: CLEAN — new sem key (analysis.opportunity.materializer_max_concurrent_bars_fetches) distinct from 184's; additive Opportunity field lands at #20 (highest is signal_confidence=19); no migration; no other in-flight collision. 032 shares analysis.proto but disjoint (new RPC/messages, not the Opportunity message).
- Warning: proto/design-heavy feature → run FULL design debate (not quick).

## Session 2026-09-07 — sdd-design
- Phase 0 Recon: wrote recon.md (services: analysis, proto, ui, agent + scenario-recon C-16). Key reuse: muted additive-flag round-trip; _readiness_materializer_bars_sem isolation; WatchlistReadiness UNKNOWN cell; agent parity-test template.
- Phase 1 Grilling: 3 rounds (full), + operator decisions on every contested fork.
  - Sentinel = additive bool Opportunity.data_unavailable #20 (provenance-derived, no migration; muted precedent). FR-1 coverage = primary+benchmark+indicator (grpc.RpcError only; benchmark mapped to candidates via source_symbol; new _row_for try/except = deliberate abort-contract deviation w/ RED test). conviction+signal_axis zeroed so unavailable sinks (@AC-14). Read-floor + mock predicate exempted (fails 1547).
  - FR-3 = REUSE _readiness_materializer_bars_sem (operator) — no new config key/migration; avoids the 3×[1,5]=15 SEV-2 aggregate re-open.
  - FR-4 (operator re-committed) = non-blocking cold read: ListOpportunitiesResponse.computing #3, distinct from empty-universe (computing=false), + terminal compute-failed state (no infinite spinner). Agent (one-shot) must surface computing/failed.
  - FR-5 (operator) = read-time 300s SURGICAL recovery (per-symbol, scalable — NOT full recompute which is a thundering-herd during an outage): UPDATE-in-place heal-only (no resurrection), re-drain signals (restore both axes, no P-03 zeroed-axis), unconditional computed_at re-stamp, finally-guarded _opportunity_retrying dedup, fresh-hit-only scan, opportunity_key ORDER BY tiebreak (paging stability). Built as a GENERIC reusable helper; fundsignal adoption = feature 186 (named follow-up). Operator refinement: also upsert readiness_cache for the recovered watchlist×strategy-entry subset (success-only) via the compute's EXISTING upsert_many — EXTENDS the compute's readiness write, does NOT change the readiness loop/read path.
  - FR-6 = agent projects data_unavailable + computing/failed + adds the Opportunity descriptor-parity test (none today; back-fill valid_until/signal_confidence, no silent allow-list).
- Constitution rules touched: C-04, C-08/P-06, C-09, C-10(b), C-14, C-15, C-16, F-01/F-07. Floor breaches: none (adversary-confirmed ×3 rounds).
- C-16: no CHANGE (sentinel out of ranking hot path; 0/0 quiet not reclassified; readiness-cache upsert is the compute's existing success-only write to the healed subset). No sign-off required.
- Scope change note (insights.md:1245): FR-4 re-committed + FR-5/FR-6 added since product-spec was spec-ready; product-spec governance sections (proto = additive committed; config = none; DB = none) refreshed to match. The 3-round debate + operator gates were the deep re-scrutiny; residual drift is caught by /sdd-review impl-spec.
- Status: spec-ready → design-approved.

### Open Threads (carry to /sdd-spec + /sdd-execute)
- [ ] Surgical replace_symbols = UPDATE-in-place heal-only (no resurrection) + opportunity_key tiebreak (paging) — RED tests: heal-in-place, no-resurrection, thin-[]-not-flagged, paging-stable. → FR-5 steps
- [ ] _opportunity_retrying cleared in finally; scan only on fresh-hit path. → FR-5 steps
- [ ] readiness_cache subset upsert success-only; must not perturb readiness FAST gate/bar_epoch. → FR-5 step
- [ ] FR-4 terminal compute-failed shape (bounded-retry vs failed stamp). → FR-4 step
- [ ] Agent one-shot must surface computing/failed (not silently empty). → FR-6 step
- [ ] fundsignal adoption of the generic recovery helper → feature 186 (named follow-up).

## Session 2026-09-07 — sdd-spec

- Generated implementation-spec.md with 15 steps. Status → implementation-ready.
- Consumed recon.md + design.md; verified all load-bearing path:line evidence against the current
  tree (line numbers drifted slightly from recon; spec cites the verified current lines).
- Two design-deferred open threads settled in the spec (no new config/migration — F-07-compliant):
  - FR-4 terminal compute-failed: in-memory `_opportunity_compute_failures: dict[str,int]` counter
    (mirrors the in-memory `_opportunity_recomputing` guard) + additive `bool compute_failed = 4` on
    `ListOpportunitiesResponse`; bounded by module constant `_OPPORTUNITY_COMPUTE_MAX_ATTEMPTS=3`.
    Keeps kicking (self-heal) but reports failed after N consecutive failures — avoids a
    stuck-forever state. No column, no migration.
  - FR-5 retry cadence: module constant `_OPPORTUNITY_UNAVAILABLE_RETRY_SECONDS=300` (mirrors
    `_READINESS_UNKNOWN_RETRY_SECONDS`); new heal-only repo method `replace_symbols` (UPDATE-in-place,
    never INSERT → no resurrection); `opportunity_key ASC` ORDER BY tiebreak for paging stability.
- Key verified codebase findings:
  - Proto: `Opportunity` next free = 20 (highest `signal_confidence = 19`, analysis.proto:579);
    `ListOpportunitiesResponse` has only fields 1/2 → `computing = 3`, `compute_failed = 4`.
  - Highest analysis migration on disk = `023_opportunity_compute_state` → confirms NO analysis
    migration needed (sentinel rides `provenance` JSONB; muted precedent at `_row_to_opportunity`
    servicer.py:4588 / read floor opportunities.py:107).
  - FR-3 reuse target confirmed: compute fan-out at servicer.py:3838/3852/3895 on `_bars_fetch_sem`;
    background bucket `_readiness_materializer_bars_sem` (servicer.py:451) already shared by the
    feature-181 R-F on-read kick (analysis CLAUDE.md:137/342) — extend it to the compute fan-out;
    interactive `_enrich_opportunities_live` (3444/3458) + EvaluateReadiness (2826) stay on
    `_bars_fetch_sem`.
  - FR-1 abort-contract: `_row_for`'s `evaluate_conditions_traced` (servicer.py:3899) currently has
    no try/except and gather has no return_exceptions → one indicators grpc.RpcError aborts the whole
    compute; spec adds a `grpc.RpcError`-only catch (NOT FormulaExecutionError — fails 2026-08-05).
  - Agent projection `_opportunity_to_dict` (client.py:747) already drifts (omits valid_until #9 +
    signal_confidence #19); FR-6 back-fills both so the new descriptor-parity test (template
    test_backtest_view.py:189) passes with no silent allow-list. No `Opportunity` parity test today.
  - UI path is pure passthrough (insightsBff.ts:55 forward, browserClients/analysisClient.ts:6); hook
    already polls 15s (useOpportunities.ts:20) — only render branches + e2e mock/fixture change.
  - `list_opportunities` documented at mcp-tools.md:848 (docs step 15); NOT a strat-lab plugin API →
    no plugin update owed.

### Open Threads (carry to /sdd-execute)
- [ ] FR-4 `_materialize_opportunities` may become unused by the RPC read path — grep for other
  callers (e.g. daily `_refresh_all` at servicer.py:4033 uses `_compute_opportunities` directly, not
  `_materialize_opportunities`) before removing; touch-only-what-the-task-requires. (Step 7)
- [ ] FR-5 `replace_symbols` correctness is the top risk — RED tests: heal-in-place, no-resurrection,
  thin-[]-not-flagged, paging-stable, finally-cleared dedup, readiness-cache success-only. (Step 10)
- [ ] Confirm a Step-10 repo test module exists or create `tests/test_opportunities_repo.py`. (Step 10)
- [ ] fundsignal adoption of the generic recovery helper → feature 186 (named follow-up).

## Session 2026-09-07 — sdd-review impl-spec (advisory)
- Result: 0 failures, 4 warnings (advisory — did not block). 0 Floor risks (no migration → F-01 N/A; all symbols resolve → C-01/F-04 satisfied). All 15 steps grounded; @AC-1..10 all covered; red-green pairing complete; both C-14 surfaces (ui + agent) have dedicated steps.
- Unresolved ⚠ carried into execution:
  - Step 3: (C-01 precision) the `evaluator.py:364` citation points at an unrelated RpcError-swallow site; the load-bearing claim (evaluate_conditions_traced→_assemble_component_series has no local grpc.RpcError guard, so an RpcError propagates and the no-return_exceptions gather aborts the whole compute) still holds — re-point the citation at the real propagation site during discovery. — [ ] unaddressed
  - Step 3: (F-08 hygiene) instruction 6 edits tests/test_analysis_servicer.py (`_MAPPED`), a Step-4 file — land that edit under Step 4 to stay within **Files** (spec self-flags this). — [ ] unaddressed
  - Steps 7/9: (C-01 line drift) several cited line numbers shifted (row build ~:3927-3937, gather :3939, empty-stamp :3365-3367) — symbols/structure resolve; re-confirm exact lines at discovery. — [ ] unaddressed
  - Step 14: (B2 letter) UI e2e has no --cov-fail-under — the sanctioned xstockstrat-ui carve-out (e2e is the gate). Acceptable. — [x] accepted (carve-out)
- Overlap findings: two shared-doc collisions with sibling 184 — services/xstockstrat-analysis/CLAUDE.md (185 Step 5 vs 184 Step 5) and services/xstockstrat-ui/e2e/fixtures/INVENTORY.md (185 Step 14 vs 184 Step 4). BENIGN: 184 is code-completed on the SAME shared branch (claude/opportunity-queue-philosophy), so 185's edits append on top of 184's already-committed edits — intra-branch sequencing, not a cross-branch merge conflict. (The feature.md `feature/<slug>` Development Branch fields are the unused SDD-convention default; actual dev is on the shared claude/* branch.) Proto fields 20/3/4 free; no config/migration/186-dir collision. No merge-order row needed.

## Session 2026-09-07 — sdd-execute (sequential)
Tooling: node ✓ v22.22.2 · pnpm ✓ 9.15.9 · python3 3.11.15 + uv ✓ 0.8.17 · buf ✗ (proto codegen via Docker) · dockerd ⬆ started (UP). Executing on branch claude/opportunity-queue-philosophy (shared with 184, per user grant). Open impl-spec warnings to address inline: evaluator.py:364 citation re-point (Step 3 discovery), _MAPPED edit under Step 4, line-drift re-confirm at discovery, Step-14 cov carve-out (accepted).

## Session 2026-09-07 — sdd-execute progress (Steps 1–8 landed)
Branch synced with origin/main-dev (already up to date). Commits on claude/opportunity-queue-philosophy:
- Step 1 (e723be4): proto additive `Opportunity.data_unavailable=20`, `ListOpportunitiesResponse.computing=3`/`compute_failed=4`. buf lint+breaking(main-dev) via Docker codegen image (buf missing on host) — non-breaking.
- Step 2 (8a32213): regen Go/Python/TS stubs (Docker `buf-gen.sh`); only analysis/v1 + gen/ts/dist changed.
- Step 3 (6f411d2): FR-1 sentinel — fetch_failed set (primary+benchmark except capture; benchmark→candidate map via source_symbol), `_row_for` try/except grpc.RpcError (abort-contract change; FormulaExecutionError still propagates), stamp "unavailable" provenance + zero conviction/signal_axis, derive `data_unavailable` at read, floor exemption `OR provenance ? 'unavailable'`, `_MAPPED` += data_unavailable. RED proven (revert to 8a32213). Citation drift logged: RpcError propagates from the main eval path (ExecuteFormula/ComputeIndicator @ evaluator.py:303+), not :364.
- Step 4 (eddbf9e): FR-1 tests drive `_compute_opportunities` directly (Step-7-proof). @AC-1/2/5 + abort-contract + FormulaExecutionError-propagates. _FakeOppRepo.read mirrors the "unavailable" floor exemption.
- Steps 5+6 (2fd7cb3): FR-3 — compute fan-out (primary/benchmark/_row_for benchmark loader) → `_readiness_materializer_bars_sem` (interactive `_enrich_opportunities_live`/`EvaluateReadiness` stay on `_bars_fetch_sem`). analysis CLAUDE.md updated. TestOpportunitySemaphoreIsolation (@AC-4, RED 0>=2). Migrated feature-141 `test_cross_user_concurrency_bounded_by_semaphore` to count only range-bearing (compute) GetBars.
- Step 7 (211f801): FR-4 non-blocking cold read — cold branch kicks background + returns empty with computing=True (compute_failed=True after `_OPPORTUNITY_COMPUTE_MAX_ATTEMPTS=3`); empty-universe/stale leave both False (distinctness). New `_opportunity_compute_failures` counter in `_kick._run` (reset on success, incr on failure). Removed dead `_materialize_opportunities`. Cold-read test blast radius (34 tests) resolved at one point: `_list_opps` drains the kick (`_drain_opportunity_recompute`, budget 20000) + re-reads; owner-scoping test inline drain; two feature-177 empty-universe tests rewritten (AC-4 mechanism strengthened to "never synchronously recomputed"; guarantee preserved — not a C-16 CHANGE).
- Step 8 (97d8cda): FR-4 tests — TestColdReadNonBlocking @AC-6/@AC-7 (direct ListOpportunities). RED proven (revert to 2fd7cb3). Old synchronous cold-read test rewritten to drained-poll happy path.

Full analysis suite green throughout: 719 passed, ~83.8% coverage. Next: Steps 9–10 (FR-5 surgical recovery), then agent (11/12), UI (13/14), docs (15). Checkpoints due after 10, 12, 14.
