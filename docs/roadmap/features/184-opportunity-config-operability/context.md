# Context: opportunity-config-operability

**Feature**: `docs/roadmap/features/184-opportunity-config-operability/feature.md`
**Product Spec**: `docs/roadmap/features/184-opportunity-config-operability/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/184-opportunity-config-operability/implementation-spec.md`

---

## Session 2026-09-07 — sdd-story

- Created from the opportunities-queue audit (this session), which compared the opportunities
  generator/materializer against the watchlists philosophy (features 180/181/182). This feature is the
  **config-operability** half — the direct feature-182 parallel.
- Audit finding (dim G1): the analysis code reads 15 `analysis.opportunity.*` keys; **0 are seeded**
  (invisible no-seed pattern) and **0 are bounded** — including footguns `refresh_hour_utc` (unclamped)
  and `max_concurrent_bars_fetches` (feature-141 SEV-2 lever). Confirmed via grep of migrations +
  configServiceImpl.ts SCALAR_BOUNDS_REGISTRY (only decay/stale + the feature-182 materializer keys).
- Scope: register at code defaults (no behavior change) + bounds on the numeric footguns; reuse
  feature-182's `lookupScalarBounds()` two-operand helper + migration template. FR-6 (refresh
  kill-switch, audit G6) carried as a design option.
- Sibling feature: **185 opportunity-compute-robustness** (the compute-correctness half — sentinel +
  dedicated sem + non-blocking cold read). Kept separate so config-only (184) can ship low-risk while
  185 has its own design debate.
- Numbering: 182 merged + launched, 183 (mcp-user-profile-roles) already exists on main-dev, so this is
  184 (185 is the sibling). Branch: `claude/opportunity-queue-philosophy` off origin/main-dev (operator
  granted the push OK; PR #1106's branch was left to the merged 182).
- Known trap carried: full-dotted `key` column + getter-matching `value_type` or silent orphan
  (migration-026/182 scar); several opportunity keys use the `get_int`/`get_float` zero-trap so a min≥1
  bound makes "0" intentionally unreachable — document per key.

## Session 2026-09-07 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- First criteria pass FAILED on one blocker (C-15 / criterion 8): FR-6 (refresh kill-switch) was a
  numbered functional requirement with no covering @AC-* scenario AND simultaneously open question #3
  ("include it or not") — a spec cannot both mandate a requirement and ask whether to do it.
- Fix (Behavior 1 / C-11 — surface the fork, defer to design): demoted the kill-switch out of the
  numbered FR list into a "Design option" note + the "Refresh kill-switch" Open Question. Committed
  requirements are now FR-1..FR-5 only, each with @AC coverage (FR-1→AC-1/2/3, FR-2→AC-4/5, FR-3→AC-1,
  FR-4→AC-6, FR-5→AC-7). Reconciled the Affected Services / Proto / Config Key Changes cross-refs and
  fixed the kill-switch key name to C-05 3-segment (`analysis.opportunity.refresh_enabled`).
- Re-review: PASS, 0 blockers, 0 warnings.
- Warnings: none.
- Overlap findings: CLEAN — no other active feature seeds/registers any analysis.opportunity.* key;
  next-free config seed migration is 028 (182 took 027 off the merge-order pre-assignment note, which
  only reached 026); feature 185's FR-3 semaphore key
  (analysis.opportunity.materializer_max_concurrent_bars_fetches) is a declared dependency on THIS
  feature's mechanism, distinct from 184's interactive max_concurrent_bars_fetches — not a duplicate.
- Advisory note carried to /sdd-spec: spec cites getters "in servicer.py"; resolved path is
  services/xstockstrat-analysis/app/handlers/servicer.py (use full path in impl-spec, C-01).

## Session 2026-09-07 — sdd-design

- Phase 0 Recon: wrote recon.md (services: config [migration+registry], analysis [docs-only],
  ui /config-ui [C-14, no code]). Key reuse patterns: 027 seed-migration shape; SCALAR_BOUNDS_REGISTRY
  + two-operand lookupScalarBounds (data-only growth, no new code); generic NamespaceEditor renders
  registered+bounded keys automatically; CONFIG_KEY_FIXTURES signal_decay row as e2e template.
- Phase 1 Grilling: 1 round (quick). Proposer=bound-all-15; adversary=NEEDS WORK (no Floor breach) on
  (a) C-15/C-16: the min-0 settability guard the design rests on had no @AC; (b) Behavior #2: bounding
  ~7 keys with no documented failure mode overreaches FR-2.
- Chosen approach (user decision): **justified set (~10) bounds** — FR-2's 8 + sparkline_bars
  (documented per-candidate fetch cost) + valid_window_hours (feature-182 twin precedent [1,168]);
  seed all 15, leave 5 (TTLs/retry/jitter/snooze) unbounded (cheap-to-loosen > latent regression).
  Rejected: bound-all-15, bound-only-8, in-feature get_float_present, in-feature kill-switch.
- Folded adversary fixes: added @AC-8 (bounded-key lower-edge-0 accepted: refresh_hour_utc=0,
  signal_rank_weight=0); lower-bound-per-getter-semantics rule (get_int_present bounded key → min 0;
  get_int zero-trap → min 1); restart-only sem-key description caveat (verified NamespaceEditor renders
  the description column, NamespaceEditor.tsx:181-183); signal_rank_weight get_float zero-trap
  description caveat; 028 = bind-at-rebase.
- Routed to feature 185 (named home, C-14 defer rule): the refresh kill-switch (analysis code change)
  AND the signal_rank_weight get_float→get_float_present fix.
- Constitution rules touched: C-05, C-07, C-08/P-06, C-10(c), C-12/C-13, C-14, C-15, C-16, F-01, F-07.
  Floor breaches: none.
- Status: spec-ready → design-approved.

### Open Threads (carry to /sdd-spec + /sdd-execute)
- [ ] Migration 028 collision — reconfirm max(NNN)+1 vs main-dev at execute (C-07). → step 1
- [ ] signal_rank_weight zero-trap live until feature 185 fixes the reader — description caveat only. → step 2
- [ ] No live valve for a runaway opportunity refresh (kill-switch deferred to 185). → feature 185

## Session 2026-09-07 — sdd-spec

- Generated implementation-spec.md with 5 steps. Status → implementation-ready.
- Step map: 1 migration (028 seed, 15 keys × 2 envs, offline-verified) · 2 service (config
  SCALAR_BOUNDS_REGISTRY +10 entries) · 3 test (setConfigScalarBounds.test.ts, paired w/ step 2,
  red-before-green; AC-4/5/8) · 4 test (config-ui e2e fixture + api-smoke, C-14/C-12, AC-6, zero
  component code) · 5 docs (analysis CLAUDE.md + config-governance log, AC-7).
- Key codebase findings (all re-confirmed live this session, not just from recon):
  - Config migration tip is `027_analysis_readiness_materializer_keys` (contiguous through 027; `024`
    is a permanent gap) → next-free NNN = `028`; bind-at-rebase reconfirm at execute (C-07).
  - `SCALAR_BOUNDS_REGISTRY` at `configServiceImpl.ts:100-113`; two-operand `lookupScalarBounds`
    `:118-120`; write-edge reject `:396-405`; ListKeys hint `:527-533` — all consume the registry with
    NO new code (data-only growth). Existing feature-182 RM int-key bounds prove int enforcement works.
  - `setConfigScalarBounds.test.ts` feature-182 RM block `:149-204` is the exact test template
    (in-process loopback gRPC harness, recording pool `{is_secret:false}`, `insertQuery()` guard).
  - config-ui is fully generic (`NamespaceEditor.tsx:69`; mock `listKeys` at `mock-backend.ts:1208-1215`
    spreads `validation`) → C-14 surface reached with zero component code; e2e fixture
    `CONFIG_KEY_FIXTURES` (`configKeys.ts:86-93` decay row) is the C-12 template.
  - analysis `CLAUDE.md` no-seed notes: 4 opportunity rows (`:333,:335,:337,:338`) drop the note; the
    5th note-bearing row `:334` (`analysis.compute.max_worker_threads`) is a compute key, genuinely
    still no-seed → its note MUST stay (FR-5, ledger fails 1512).
- Reviewers snapshot finalized from distinct per-step reviewers: DBA (step 1), xstockstrat-config owner
  (steps 1–3), xstockstrat-ui owner (step 4); step 5 docs = none.

## Session 2026-09-07 — sdd-review impl-spec (advisory)

- Result: 0 failures, 1 warning, 3 notes (advisory — did not block). Overlap: CLEAN.
- Unresolved ✗ / ⚠ carried into execution:
  - Step 4: (C-01) instruction told the executor to set the bounded-int fixture row's
    `validation.valueType` to a nonexistent "int-scalar enum" — `config.proto` ValueType has no such
    member; the service emits VALUE_TYPE_FLOAT_SCALAR (2) for ALL bounded keys (configServiceImpl.ts:529).
    — [x] resolved pre-execute: spec Step 4 corrected to `valueType: 2` for both bounded rows.
  - Step 1/2: (cosmetic note) `grep -c "analysis.opportunity." … # expect 30/10` over-counts if the
    mandated header comment matches — at execute, verify the row/entry count by inspection, not a bare
    line count. — [ ] unaddressed (cosmetic; announce at execute).
  - Scenario coverage (C-15 note): AC-1/2/3 (migration) + AC-7 (docs) have no runnable RED assertion —
    verified by offline SQL inspection + doc-state review, matching the feature-182 precedent for a
    config-only/docs feature. — [ ] unaddressed (accepted deviation; announce at execute).
- Overlap findings: none (migration 028, the 15 keys, proto surface, all shared files uncontested;
  185's materializer_max_concurrent_bars_fetches is a distinct one-way dependency, not a duplicate).
