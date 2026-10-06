# Context: private-by-default-templates

**Feature**: `docs/roadmap/features/220-private-by-default-templates/feature.md`
**Product Spec**: `docs/roadmap/features/220-private-by-default-templates/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/220-private-by-default-templates/implementation-spec.md`

---

## Session 2026-10-06T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature (@AC-1..@AC-25), context.md from user story.
- Origin: operator request in the PR #1219 session (2026-10-05), answering residual 3 ("analysis can still
  execute another user's private formula by id"). The operator asked to "make strategies, custom formulas,
  public signals, and everything else private. Remove the concept of public. Instead, create strategies and
  signal templates that, when saved, become private instances."

### Operator decisions (verbatim answers, 2026-10-05, binding for /sdd-design)

1. **Signals:** "Both sources and signals per user." Each user owns their signal sources, which are
   instantiated from source templates, and the signals ingested into them. QuerySignals, live-loop
   signal_eligible, opportunities and attribution see only the owner's signals. Two users following the
   same newsletter each ingest their own copy.
2. **Templates:** "Admin catalog, snapshot copy." Only admins or seeded code author templates; all users
   can read them. Saving one creates an independent private copy that records origin template id and
   version. The UI may show "template updated" but never mutates the copy.
3. **Migration:** "Just make everything private." Public formulas become private to their author. No
   templates are seeded, so the catalog starts empty. System objects (SYSTEM_AUTHOR formulas and the
   fundamentals_macd_blend id convention) stay special-cased as they are today.
4. **References:** "Deep copy, remove bypass." Instantiating a strategy template deep-copies every
   referenced formula template into the user's private formulas and repoints the strategy at the copies.
   analysis runs formulas only as the strategy owner, and the x-internal-caller formula-read bypass from
   PR #1219 is removed.

### Recon digest (Explore agent, 2026-10-05; re-verify in /sdd-design Phase 0)

- **Formula** is the only entity with `is_public`. The UI lists only public formulas by default, because
  `useFormulas` sends `author_filter=''` and `include_public=true` and the SQL then returns no private rows.
  This is a latent UX bug that FR-1 subsumes.
- **Strategies, watchlists, opportunities and backtests** are already owner-scoped. However,
  `analysis.strategy_scores`, `backtest_run_symbols` and `backtest_details` are keyed by bare
  `strategy_id`, and `GetBacktest` performs no ownership check.
- **Signals and sources** have no owner column (`ingest.newsletter_signals`, `signal_sources` PK `slug`,
  `signal_dedup_keys`). `ManageSignalSource` is admin-only; `QuerySignals` has no user filter.
- **Copy features:** no backend clone or template capability exists. The only template-like things are
  the UI-only `FORMULA_TEMPLATES` and the screener presets.
- **PR #1219 dependency:** this feature removes the `_INTERNAL_FORMULA_READERS` / analysis
  `InternalCallerInterceptor` that #1219 adds. #1219 must merge first, or this feature must account for it.

### Open questions carried to /sdd-review and /sdd-design

OQ-1 through OQ-6 in product-spec.md:

- OQ-1: backfill owner for the global signal data.
- OQ-2: the fundamentals signal producer under per-user signals.
- OQ-3: admin reach over private objects.
- OQ-4: template placement.
- OQ-5: template-to-template references.
- OQ-6: owner of the inbound signal channels.

## Session 2026-10-06 — operator answers OQ-1..OQ-3

The operator accepted the recommended answers ("Go with both"):

- **OQ-1:** backfill global signal sources, signals and dedup keys to `SEED_USER_ID`, the feature-133 precedent (FR-11, @AC-27).
- **OQ-2:** the fundamentals producer emits under a `system`-owned source that is readable by all and immutable (FR-6, @AC-26). This is a third system special case, alongside `SYSTEM_AUTHOR` formulas and the blend-strategy id convention.
- **OQ-3:** admins keep a read-only, audited view of other users' objects and lose the update/delete override on formulas (new FR-13, @AC-28).

OQ-4 to OQ-6 remain for /sdd-design.
