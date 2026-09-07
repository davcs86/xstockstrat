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
