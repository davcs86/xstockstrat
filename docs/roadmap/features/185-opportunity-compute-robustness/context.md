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
