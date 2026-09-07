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
