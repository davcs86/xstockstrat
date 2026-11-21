# Design: fix-fundsignal-scoring-correctness

**Created**: 2026-11-20
**Rounds**: 3 (full; termination: approved)
**Approved by**: user @ 2026-11-20 (design gate, option A; Floor clear)
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

Four fixes on the fundamentals-signal pipeline (producer → ingest → scorer), built in this order:
(0) proto, (1) formula input, (2) direction, (3) conviction presence, (4) retraction migration.
There is no indicators code change (recon.md:60) and no new config key (`R-2`).

Recon line numbers for ingest `servicer.py` moved after recon was written; the re-baselined lines
are given below next to the recon anchor. `/sdd-spec` re-greps every line reference before use.

### 1. Formula input (D-1)

- In `services/xstockstrat-analysis/app/engine/fundsignal_loop.py` `_score_via_formula`
  (recon.md:29-32), build the input dict only from keys not in `set(f.missing_metrics)`. This reuses
  the `_builtin_score` guard (recon.md:28, recon.md:66).
- Absence is keyed on `missing_metrics`, never on a zero value, so a real `roe` 0.0 is still scored.
- An empty dict means the symbol is unscored. That replaces the `issuperset` test (recon.md:31).
- The `scores.get("composite", 0.0)` read (recon.md:32) is unchanged.
- Scorer scale contract (D-10): a system scoring composite is in [0,1] with 0.5 neutral. Document
  it in the analysis `CLAUDE.md` next to `scoring_formula_id` and pin it with a range test on
  `value_quality` and `_builtin_score`. There is no clamp.

### 2. Direction: degenerate-only side gate (D-6, D-9, D-14; operator decision 2026-11-20, option A)

- In `_map_directions` (recon.md:34), keep the folded sort
  `sorted([*scores.values(), *reference_scores])` (recon.md:67) and both `_quantile` cuts
  (recon.md:35) byte-identical.
- Degeneracy test: `degenerate = len(ordered) < _MIN_CROSS_SECTION or buy_cut <= sell_cut`. It is
  counted over the folded set (D-9).
- Add two **new** module constants in `fundsignal_loop.py` (D-14): `_NEUTRAL_SCORE = 0.5` and
  `_MIN_CROSS_SECTION = 5`. Both are fixed invariants, not config.
- When degenerate:
  - `buy` iff `s >= buy_cut and s > _NEUTRAL_SCORE`;
  - `sell` iff `s <= sell_cut and s < _NEUTRAL_SCORE`;
  - anything else is `hold`.
- When not degenerate, the code path and the labels are unchanged from today.
- The operator rejected two variants at the gate: the always-on side gate, and using
  `buy_quantile`/`sell_quantile` as absolute score cuts in the degenerate branch.
- Expected results the spec must pin:
  - 260 `@AC-9` (`tests/test_fundsignal_loop.py:1353`, recon.md:71): folded set
    0.10/0.50/0.70/0.90 gives `sell_cut` 0.50, so AAPL 0.10 stays `sell`.
  - `test_map_directions_reference_scores_set_the_cuts` (recon.md:71): its lone-0.10 assertion flips
    from `buy` to `sell`. The test carries no `@AC` tag.
  - `test_quantile_buckets` (recon.md:71) still passes.
  - A lone 0.05 is `sell`, a lone 0.9 is `buy`, a lone 0.5 is `hold`.
- Calibration of `_MIN_CROSS_SECTION` (O-10, `R-7`):
  - The property at the 0.80/0.20 defaults: 5 is the smallest n from which every n' ≥ n has a
    non-empty hold band and a buy share of at most 40%.
  - Test `test_min_cross_section_calibrated_to_default_quantiles` asserts the property for n = 5..50
    on distinct scores, asserts n = 4 violates it, and asserts n = 2..4 take the degenerate branch.
  - Document next to the constants in the analysis `CLAUDE.md` that 5 is calibrated to the default
    quantiles, while `buy_quantile`/`sell_quantile` are live keys (recon.md:43).

### 3. Conviction presence (D-3, D-4, D-7, D-8)

- **Proto PR.** Add `bool conviction_provided = 12;` to `ExternalSignal` in
  `packages/proto/ingest/v1/ingest.proto`. Field 4 stays a plain `double` (recon.md:69 for the
  field-number and presence precedent). The same PR:
  - updates the conviction and dedup-key comments (recon.md:105, recon.md:108);
  - runs `./scripts/buf-gen.sh`;
  - adds the PROTO-7 entry in `packages/proto/docs/context-constitution.md`;
  - records the CI `buf breaking` verdict in context.md.
- **Presence predicate**, the same at every reader: `conviction_provided or conviction != 0.0`.
- **Producers.** There are exactly four non-test `ExternalSignal(` constructions:
  - agent `services/xstockstrat-agent/app/client.py:248-255`: set the flag inside
    `if conviction is not None`;
  - ingest `services/xstockstrat-ingest/app/engine/mcp_client_loop.py:90-94`: set it
    unconditionally, because conviction is mandatory there;
  - analysis `fundsignal_loop.py:654-658` `_emit_signal`: set it unconditionally;
  - ingest `QuerySignals` builder (recon.md:49; now `servicer.py:1343-1352`): for a non-NULL row set
    `conviction=float(row)` and `conviction_provided=True`; for a NULL row leave both unset.
- **Ingest write** (recon.md:46-48; now range check `:1081`, write sentinel `:1101`, dedup claim
  upsert `:1134-1161`): store
  `signal.conviction if (signal.conviction_provided or signal.conviction != 0.0) else None`.
  Storage needs no schema change (recon.md:52).
- **Scorer** `services/xstockstrat-analysis/app/services/scoring.py:31` (recon.md:37): use the
  predicate, else 0.5. Legacy NULL rows keep their 0.5 weight (`R-1`).
- **Tests, one per seam**, all on a real `ingest_pb2.ExternalSignal`:
  - (a) analysis: a 0.0 built-in score at the default `min_conviction_to_emit` makes `_emit_signal`
    send `conviction=0.0, conviction_provided=True`;
  - (b) ingest: that request stores 0, and `QuerySignals` returns
    `conviction_provided=True, conviction=0.0`;
  - (c) analysis: `compute_signal_score` on that proto adds 0.0 (screener path, feature `@AC-3`);
  - (d) mcp_client: an explicit 0.0 is stored as 0, next to
    `mcp-client-signal-source.feature:34` (recon.md:99).
- **Shared test helper (O-16).** Rebuild `_make_signal` (`tests/test_analysis_helpers.py:182-194`)
  on a real `ingest_pb2.ExternalSignal`. A MagicMock makes `conviction_provided` truthy and would
  flip `test_zero_conviction_uses_default_half` (`:235-239`). Keep that test as the
  "not given → 0.5" pin and add an explicit-0.0 sibling. Never invert its assertion.
- **Docs** (closed under O-5): the proto comment, INGEST-4 (recon.md:51), agent `tools.py`,
  `docs/runbooks/mcp-tools.md:251`, `signal_extraction.md`, the strat-lab skill, and the analysis
  `CLAUDE.md` (anchors now `:160` and `:419`). The stale parity comment is at
  `acceptance/fundamentals-formula-inputs.feature:39`.

### 4. Retraction: ingest data migration (D-2, D-5, D-11, D-12, D-13)

- Provisional number `017_retract_fabricated_fundsignals`. The number is re-derived at spec time
  after feature 318 (D-5).
- Predicate (D-11), all inside a `to_regclass('marketdata.fundamentals')` guard:
  - system derived source slugs from `ingest.signal_sources`;
  - `conviction = 0.5`;
  - `ingested_at < '2026-10-31T00:00:00Z'`;
  - the symbol is in the frozen operator list;
  - `valid_until IS NULL OR valid_until > now()`;
  - `NOT EXISTS` a `marketdata.fundamentals` row for the symbol with any non-null metric.
- The migration sets `valid_until` only. Conviction and dedup claims are untouched (recon.md:152).
- It runs `GET DIAGNOSTICS` and `RAISE NOTICE` with the updated count. A rerun is a no-op. The down
  file is a stub.
- Fixture `scripts/migration-assertions/ingest-017.sql`, in the `BEGIN … \ir … ROLLBACK` shape. It
  INSERTs `marketdata.fundamentals` rows and never CREATEs the table (D-13). Scenarios:
  - (a) an all-null symbol is retracted;
  - (b) a symbol with data survives;
  - (c) a genuine 0.5 signal on a symbol with data survives;
  - (d) a symbol outside the frozen list survives;
  - (e) rename `marketdata.fundamentals`, then apply: zero rows change;
  - (f) a rerun is a no-op.
- The PR amends `docs/patterns/database.md:21-22` and the root `CLAUDE.md` § Database: the recorded
  migration-time cross-schema reads become two (identity→analysis 029, marketdata→ingest). The DBA
  and the marketdata owner acknowledge the read there (D-12).
- Post-deploy check per environment, recorded in context.md (O-18):
  - compare the `RAISE NOTICE` count in the db-migrator job log with the frozen-list SELECT;
  - run a read-only SQL check that no row matching the predicate is still active.

### Consumer surfaces (C-14)

- `/insights/opportunities` in xstockstrat-ui and MCP `list_opportunities` in xstockstrat-agent
  (recon.md:6) show the corrected scores and directions. Neither needs a code change for that.
- The agent's `ingest_signal` path changes: `client.py` sets `conviction_provided`, and the tool
  docs change with it.
- xstockstrat-ui has no code change. No TS consumer of `ExternalSignal.conviction` was found.

## Rejected Alternatives

- `R-1` Scorer-only conviction fix (read 0.0 literally) with no presence signal — rejected because
  the agent omits conviction, so NULL rows would silently drop from 0.5 to 0.0 weight.
- `R-2` Config-seeded minimum cross-section size plus absolute fallback (config migration 048) —
  rejected because it adds a key and a stored-zero decision (platform `@AC-6 @feature-244`) for no
  extra protection.
- `R-3` Retraction from a literal operator list alone, leaving env-specific symbols out — rejected
  because it rests on the false separate-database premise, cannot be tested against the `@AC-4`
  Given, and leaves fabricated rows active.
- `R-4` Routing a buf-flagged in-place `optional` through the 2-owner + platform-lead
  breaking-proto approval — rejected because `proto-versioning.md:5` forbids breaking changes to an
  existing v1 proto.
- `R-5` In-place `optional double conviction = 4` as the primary branch behind a step-0 buf check —
  rejected because PROTO-7 records the implicit-to-optional conversion as buf-breaking and names
  the sibling flag as the pattern; an expected-to-fail proto PR is churn.
- `R-6` Deriving degeneracy only from the `_quantile` cut indices, with no size constant — rejected
  because at the 0.80/0.20 defaults it flags only n ≤ 3, which under-covers the report's 2-4 symbol
  collapse range.
- `R-7` Calibrating `_MIN_CROSS_SECTION` with a test that asserts distinct quantile cut ranks at
  n = 5 — rejected because `_quantile` already gives distinct ranks at n = 2..4, so the test cannot
  distinguish 5 from 4.
- `R-8` Treating a stored 0 as equal to a legacy NULL in the dedup claim upsert — rejected because
  it re-introduces the 0.0-as-absent sentinel at the dedup seam, which `conviction_provided` exists
  to remove. The bounded duplicate is accepted instead.

## Open Risks

The first two were approved as the synthesis default at the gate. The 2026-11-20 operator record
does not name them, so `/sdd-spec` confirms each with the operator before planning around it.

- [ ] Stored wrong-direction `buy` rows from degenerate days stay active for up to `valid_days`
  (90) under natural expiry (O-14). A targeted retraction would break own-schema or migration run
  order — to be confirmed at `/sdd-spec`.
- [ ] Opportunity rows built from retracted signals stay readable until the next background
  recompute or the daily refresh, and at most about 24h (`opportunity.valid_window_hours`); no
  recompute is triggered (O-15) — to be confirmed at `/sdd-spec`.
- [ ] An n ≥ 5 all-weak cross-section still labels its top quantile `buy` (designed relative
  ranking; accepted by the operator's option A) — no action; documented in the direction step.
- [ ] In the degenerate branch the hold band is exactly `s == 0.5`, so a lone 0.51 is `buy` and a
  lone 0.49 is `sell` (accepted by option A) — pinned by the direction step's tests.
- [ ] `_MIN_CROSS_SECTION = 5` is calibrated to the default quantiles. Retuned quantiles can shift
  where the hold band appears; `buy_cut <= sell_cut` catches only full collapse — documented in
  the direction step.
- [ ] A budget-deferred degenerate first run can be followed by a quantile-labelled resume, and
  earlier claims are never relabelled (O-11, accepted residual) — no action.
- [ ] The legacy rule `conviction != 0.0` keeps a sentinel: a pre-flag client that sends a
  deliberate 0.0 still reads as not given (0.5) — documented in the conviction docs step.
- [ ] Deploy-boundary dedup: a post-deploy explicit-0.0 resubmit beside a legacy NULL claim makes
  one extra active row until `signals.dedup_window_hours` passes (O-17, accepted residual) — no
  action.
- [ ] The retraction cutoff `2026-10-31T00:00:00Z` comes from `246/feature.md:30` and is not
  checked against deploy logs — to be checked in the migration PR.
- [ ] The db-migrator role's SELECT on `marketdata.fundamentals` is unverified per environment. A
  missing grant fails loudly; a missing table no-ops silently — covered by the post-deploy check.
- [ ] Migration number 017 may collide with feature 318 — re-derived at `/sdd-spec`.
- [ ] EDGAR self-heal could null a fundamentals row before migration time; the frozen-list
  intersection bounds the retraction set — to be reviewed in the migration PR.
- [ ] No test pins the absence of TS/UI consumers of `ExternalSignal.conviction` (grep only) —
  re-grepped at `/sdd-spec`.

## Constitution Rules Touched

- `C-01` — honored by: recon corrected on the shared-database fact (D-2); every anchor re-grepped at
  spec time.
- `C-07` — honored by: a new numbered ingest migration with a stub down file, a rerun no-op, and a
  migration-assertions fixture (D-5, D-13).
- `C-08` — honored by: RED tests first, on a real `ingest_pb2.ExternalSignal`, one per seam (D-4).
- `C-09` — honored by: an additive proto field only, `buf breaking` verdict recorded, buf-gen in
  the same PR (D-3, D-7).
- `C-10` — honored by: every conviction-semantics doc surface updated in the same PR as the code.
- `C-11` — honored by: this design (3 full rounds, operator-approved at the gate).
- `C-14` — honored by: consumer surfaces named above; the agent tool path and docs change with the
  proto.
- `C-16` — honored by: each CHANGE below carries the operator sign-off.
- `C-18` — honored by: the scale contract (D-10) and the `_MIN_CROSS_SECTION` coupling are
  documented and tested.
- `F-07` — honored: the two constants are fixed invariants, not tunables (D-6); no hardcoded
  config value is introduced.
- `P-02` — honored by: mediated proposer/adversary rounds.
- `P-03` — honored by: every residual is listed under Open Risks; nothing is silently deviated.
- `P-06` — honored by: the MagicMock helper is rebuilt on a real proto (O-16).

Floor breaches: none.

## Business Rules Touched (C-16)

- CHANGE `@AC-3 @feature-246` "Under a scoring formula, an all-missing row is skipped and a partial
  row is still scored" (`services/xstockstrat-analysis/acceptance/fix-fundsignal-neutral-score.feature`)
  — the formula input is `dividend_yield` only, no `pe_ratio 0.0`; signed off by user @ 2026-11-20
  (context.md, design gate, option A).
- CHANGE `@AC-8 @feature-201` "On a partial fundamentals row the strategy omits absent metrics (does
  not penalize) and diverges from the producer"
  (`services/xstockstrat-analysis/acceptance/fundamentals-formula-inputs.feature`) — the strategy
  composite now matches the producer; signed off by user @ 2026-11-10 and again @ 2026-11-20
  (context.md).
- CHANGE `@AC-4 @feature-201` "One formula, identical I/O in the producer and in a strategy —
  fully-populated rows" (same file) — the full-row parity guarantee stands; the "partial-row case
  diverges" comment at `:39` is removed; signed off by user @ 2026-11-20 (context.md).
- PRESERVE `@AC-1 @feature-246` "Symbols with no usable fundamentals are not scored, ranked or
  emitted" — not regressed by: an empty formula input is unscored and never enters the
  cross-section.
- PRESERVE `@AC-2 @feature-246` "A metric reported as zero is scored, not treated as absent" — not
  regressed by: absence is keyed on `missing_metrics`, never on value.
- PRESERVE `@AC-9 @feature-260` "A one-symbol retry keeps the day's cross-sectional direction" — not
  regressed by: degeneracy is counted over the folded set; AAPL 0.10 stays `sell`.
- PRESERVE `@AC-8 @feature-260` "A non-force retry after a lost IngestSignal response resends the
  same signal and counts the dedup" — not regressed by: direction and conviction stay deterministic
  on retry.
- EXTEND the mcp_client conviction round-trip
  (`services/xstockstrat-ingest/acceptance/mcp-client-signal-source.feature:34`) — new case added:
  an explicit 0.0 is stored as 0.
- EXTEND `@AC-1`..`@AC-4 @feature-309` (`acceptance.feature`) — new regression scenarios, promoted
  to the durable suites at launch.
