# Context: fundamentals-provider-alternative

**Feature**: `docs/roadmap/features/127-fundamentals-provider-alternative/feature.md`
**Product Spec**: `docs/roadmap/features/127-fundamentals-provider-alternative/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/127-fundamentals-provider-alternative/implementation-spec.md`

---

## Session 2026-08-12T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- User explicitly named Finnhub and Twelve Data as the two candidates to evaluate, and required
  design/recon to confirm the best alternative against their **actual, current API docs** rather
  than reuse conclusions from the earlier chat discussion (which had leaned toward Finnhub without
  verifying live docs). Encoded as FR-1/FR-2 and Acceptance Criteria 1-2.
- **Deviation**: `**Development Branch**` is set to the harness-assigned
  `claude/fmp-free-layer-ratios-dr0c4j` instead of creating a new `feature/fundamentals-provider-alternative`
  branch. Reason: this session's task instructions pin all commits/pushes to that branch and
  forbid pushing elsewhere without explicit permission. Deliberately avoids the branch-divergence
  failure mode recorded in `docs/roadmap/ledger/fails.md` (2026-07-30,
  `082-fix-fmp-config-boot-only`) where a harness branch and a separately-created SDD branch
  silently diverged. All SDD phases for this feature (story/design/spec/execute) will run on this
  one branch.
- Read `docs/roadmap/ledger/fails.md` for relevant traps: the 082 branch-divergence entry (above)
  and the 2026-08-06 `fundamentals-data-source` entry ("don't assume an existing helper
  parameterizes what a new call site needs" — re: quota-guard/alert-severity code). Both carried
  into product-spec.md § Feature Workflow Notes / Open Questions.

## Session 2026-08-12T00:10:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Criteria pass (spec-reviewer): **PASS WITH WARNINGS**, no Floor (`F-*`) breach, no blocker.
  - Warning: 3 unresolved `Open Questions` checkboxes (provider pick, replace-vs-switchable,
    the fails.md quota-guard-helper trap) — each explicitly deferred to `/sdd-design`, matching
    the accepted precedent set by feature 059's own product-spec review (deferred
    OQ-059-a-impl, non-blocking). Confirm `/sdd-design` Phase 0 Recon genuinely resolves all
    three rather than re-deferring to `/sdd-spec`.
  - Warning: `Consumer Surface(s)` = `None` is defensible today (RPC contract unchanged), but
    re-check if design's FR-1 findings widen scope (new fields, new RPC, or an
    operator-facing provider-selector surface) — `/insights` or `/config-ui` might then apply.
- Overlap pass (feature-overlap): **CLEAN**. No config-key/proto-field/migration collisions.
  Only shared-service context noted: `125-unified-symbol-page` reads the same
  `GetFundamentals`/`GetFundamentalsMulti` RPCs read-only (no clash); `076-fmp-key-to-secret-env`
  established the `<PROVIDER>_API_KEY` secret-env precedent this feature's FR-5 follows (distinct
  key name, no clash) — worth checking its migration-NNN tip again at `/sdd-spec` time if a
  migration ends up needed. No `finnhub`/`twelvedata` name collisions anywhere in the repo.
