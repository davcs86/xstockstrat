# Context Log: fix-fundsignal-scoring-correctness

> Distilled 2026-11-21 by /sdd-distill. Full pre-distill session prose is in git history (before this commit).

Append-only from here on. Each session appends a new ## Session entry.

## Decisions

Direction, conviction presence, formula input and retraction are all settled (`design.md`, `debate.md` D-1..D-14 / R-1..R-8 / O-1..O-18 hold the register). Why-level history that lives only in this log:

- **Triage routing**: the four reports (formula partial-row wire-zero, small-cross-section quantile, zero-conviction-read-as-neutral, fabricated-signals-not-retracted) are residuals of feature 246 sharing the producer → ingest → scorer pipeline; all SEV-2; report 4 is prod-impacting and went to Track C by operator decision 2026-11-10; design depth `full` (≥2 services, data migration, proto presence, durable `@AC-8 @feature-201` change). Root cause: proto3 doubles lack presence (0.0 = absent); direction quantile has no floor; 246 had no retraction path.
- **(1) Formula input (D-1)**: `_score_via_formula` builds input only from keys not in `missing_metrics`; an empty input means `unscored` (replaces the `issuperset` skip). `scores.get("composite", 0.0)` read is unchanged. No indicators code change, no new config key.
- **(2) Direction — operator option A (2026-11-20, verbatim record below)**: degenerate-only side gate in `_map_directions`. `degenerate = len(ordered) < _MIN_CROSS_SECTION or buy_cut <= sell_cut`, counted over the folded set `scores ∪ reference_scores` (D-9; `ordered` and both `_quantile` cuts stay byte-identical). When degenerate: `buy` iff `s >= buy_cut and s > _NEUTRAL_SCORE`; `sell` iff `s <= sell_cut and s < _NEUTRAL_SCORE`; else `hold`. Non-degenerate labels are the unchanged 062 quantile labels. `_NEUTRAL_SCORE = 0.5` (D-6) and `_MIN_CROSS_SECTION = 5` (D-14) are NEW fixed module constants, not config (this is not R-2); the spec must not cite `_NEUTRAL_SCORE` as an existing anchor. 260 `@AC-9` preserved (AAPL `sell`); only the untagged lone-0.10 test at `tests/test_fundsignal_loop.py:1370` flips `buy` → `sell`.
- **Calibration (O-10)**: at 0.80/0.20, 5 is the smallest n from which EVERY n' ≥ n has a non-empty hold band and buy share ≤ 40%; n=4 has no hold band and 50% buy; n=2..4 take the degenerate branch. Pinned by `test_min_cross_section_calibrated_to_default_quantiles` (n=5..50 holds, n=4 violates). Coupling to the live `buy_quantile`/`sell_quantile` keys is documented in analysis docs next to the constants; a config key is only a possible follow-up.
- **Scale contract (D-10)**: a system scoring composite is in [0,1], 0.5 neutral; documented next to `scoring_formula_id`, pinned by a range test on `value_quality`/`_builtin_score`; NO clamp at `fundsignal_loop.py:586` (a clamp silently changes formula semantics, and the gate reads the absolute scale only in degenerate sets).
- **(3) Conviction presence (D-3/D-7/D-8)**: additive `bool conviction_provided = 12` on `ExternalSignal` (fields end at 11; field 4 stays plain `double`). Predicate on write and in the scorer: `conviction_provided or conviction != 0.0`; legacy NULL rows keep 0.5 weight (R-1). Exactly four non-test producers set it: agent `client.py` (inside `if conviction is not None`), ingest `mcp_client_loop.py` (unconditionally; conviction is mandatory there), analysis `_emit_signal` (unconditionally; the report-3 producer path), ingest `QuerySignals` builder (non-NULL rows only; both fields unset for NULL, never `conviction=None`). Tests use a real `ingest_pb2.ExternalSignal` at every seam (D-4); one test per seam: emit → ingest store/QuerySignals → `compute_signal_score`, plus mcp_client explicit 0.0. O-16: rebuild the MagicMock `_make_signal` (`tests/test_analysis_helpers.py`) on a real proto because an auto-truthy `conviction_provided` flips `test_zero_conviction_uses_default_half`; keep that test as the not-given → 0.5 pin (R-1's only guard) and add an explicit-0.0 sibling; never invert it.
- **Dedup (O-17/R-8)**: do NOT treat a stored 0 as NULL in the claim upsert (re-introduces the sentinel at the dedup seam); the post-deploy explicit-0.0 resubmit duplicate within `signals.dedup_window_hours` is an accepted residual. The legacy in-band `conviction != 0.0` rule keeps a sentinel (pre-flag client sending deliberate 0.0 reads as not given); documented in INGEST-4.
- **(4) Retraction (D-5/D-11/D-12/D-13)**: ingest data migration, `to_regclass('marketdata.fundamentals')`-guarded (precedent `013_signal_ownership_templates.up.sql:101-104`). Predicate: system `derived` slugs from `ingest.signal_sources`, `conviction=0.5`, `ingested_at < '2026-10-31T00:00:00Z'` (246 production launch, `246/feature.md:30`), symbol in a frozen operator list, still active, and NOT EXISTS a `marketdata.fundamentals` row with any non-null metric. `GET DIAGNOSTICS` + `RAISE NOTICE` count; conviction and dedup claims untouched; rerun is a no-op (`valid_until > now()`); down file is a stub. List frozen from the per-environment read-only SELECT of the same predicate minus the list leg, recorded in the PR. Fixture shape `BEGIN … \ir … ROLLBACK` (`ingest-016.sql:19-35`): INSERT `marketdata.fundamentals` rows (harness migrates marketdata first, `scripts/migration-rerun.py:26-37`; never CREATE the table) and a RENAME-then-apply scenario proving the guard branch. The PR amends `docs/patterns/database.md:21-22` and root CLAUDE.md § Database: "only migration-time cross-schema read" becomes two (identity→analysis 029, marketdata→ingest). Number: provisional 017 → re-derived to **019** at spec time (`main-dev` holds 015..018).
- **Rejected alternatives (why)**: always-on side gate (relabels every day, 062 FR-6; first-deploy dedup overlap); absolute `buy_quantile`/`sell_quantile` cuts in the degenerate branch (overloads one live key with two meanings; would give a real hold band); degeneracy from `_quantile` cut indices only (R-6; at 0.80/0.20 flags only n<=3); calibration test "distinct cut ranks at n=5" (non-discriminating: `_quantile` already distinct at n=2..4); scorer-only conviction fix (R-1); config-seeded min cross-section (R-2); retraction from a literal operator list alone (R-3; false separate-database premise, untestable against @AC-4 Given); retraction from NOT EXISTS alone with no list (a cache miss could widen the set; the list intersection keeps it shrink-only); routing a buf-flagged in-place optional through breaking-proto approval (R-4); in-place `optional double conviction = 4` as primary (R-5; PROTO-7 `packages/proto/docs/context-constitution.md:25` records implicit→optional as buf-breaking and names the sibling flag as the pattern); fixing `test_zero_conviction_uses_default_half` by inverting it.
- **C-16 / business rules**: 2026-11-10 operator sign-off to rewrite durable `@AC-8 @feature-201` (composite matches the producer; the earlier divergence existed only because the producer's 0.0 scored missing P/B and D/E as top); 2026-11-20 sign-off for the CHANGEs to `@AC-3 @feature-246`, `@AC-4` / `@AC-8 @feature-201`. PRESERVE: 246 `@AC-1`/`@AC-2`, 260 `@AC-8`/`@AC-9`. EXTEND: `mcp-client-signal-source.feature:34` round-trip, 309 `@AC-1..@AC-4` (+ `@AC-5` added by impl-spec review).
- **Accepted residuals (no action)**: n ≥ 5 all-weak top quantile is `buy`; degenerate hold band is exactly 0.5; budget-deferred mixed-label day (O-11: degenerate first run then quantile-labelled resume, earlier claims never relabelled); deploy-boundary dedup duplicate (O-17); opportunity lag ≤ ~24h with no triggered recompute (O-15, default pending operator confirm; read filter `opportunities.py:233` is `valid_until > now()`, window `opportunity.valid_window_hours` 24); stored wrong-direction `buy` rows expire naturally up to `valid_days` 90 (O-14 default pending confirm; a targeted retraction would need an ingest migration reading `analysis.fundsignal_emitted` (migrates after ingest) or an analysis migration writing `ingest.*`, both breaking own-schema harder than the recorded exception).
- **Spec (2026-11-20)**: 18 steps; atomic units Steps 1+2, 3+4, 6+7, 11+12; anchors are `main-dev@36aed60b` lines (branch tip was 166 commits behind; `/sdd-execute` BRANCH SYNC must merge `main-dev` before Step 1); analysis doc anchors moved to `services/xstockstrat-analysis/docs/fundsignal.md:18` and `docs/fundamentals-guard.md:12`; strat-lab skill needs no edit.

## Open Threads

Authoritative list: the two `## Open Threads` sections after the two verbatim recent sessions below (operator gates 1-4, O-14/O-15 before Step 1, `@AC-5` confirmation, peer-spec re-grep, 313 `_ingest_external_signal` hand-merge, follow-up `_MIN_CROSS_SECTION` config key, `migration-rerun` result). Carried forward from earlier sections and not repeated there:

- [ ] Document the `_MIN_CROSS_SECTION` / default-quantile coupling and the [0,1] scale contract in analysis docs — target: direction step (spec Step 8).
- [ ] Document the surviving legacy sentinel (`conviction != 0.0` without the flag reads as not given) — target: conviction docs step.
- [ ] Review EDGAR source-aware self-heal (could null a fundamentals row before migration time) against the frozen list; unverified per-environment db-migrator SELECT grant on `marketdata.fundamentals` (missing grant fails loudly, missing table no-ops silently — O-18 check) — target: migration PR / post-deploy.
- [ ] Re-grep absence of TS/UI consumers of `ExternalSignal.conviction` (spec found none; no pinning test) — target: Step 1 / BRANCH SYNC.

## Files Modified

None yet (no code written). Artifacts only: `implementation-spec.md` (18 steps), `acceptance.feature` (`@AC-5` added by impl-spec review), `design.md`, `recon.md`, `debate.md`, `product-spec.md`.

## Superseded Sessions

- 2026-11-10 — /sdd-triage: bug cluster of four SEV-2 reports (formula partial-row wire-zero; small-cross-section quantile; zero-conviction-read-as-neutral; fabricated signals not retracted) routed to Track C; all residuals of 246 across analysis/ingest/indicators; depth `full`; branch `feature/fix-fundsignal-scoring-correctness`; details in Decisions.
- 2026-11-10 — sdd-review product-spec: approved, draft → spec-ready. Warnings: bug-template conventions (no FR-N/@FR tags, no Consumer Surface section); AC-2 negative-only; proto optional must be classified additive; fundsignal key contract, migration NNN/approvals (DBA + ingest owner) and ListOpportunities recompute precondition (OQ4b) deferred; AC-1 contradicts durable `@AC-8 @feature-201` (C-16 sign-off before /sdd-spec); overlap WARN: analysis/ingest/indicators shared, ingest migrations dir vs 318 ordering gate.
- 2026-11-11 — sdd-batch design gate (round 2): halted at the approval gate (policy: halt); design.md not written, status `spec-ready`. Round-2 synthesis fixed build order (0 proto, 1 formula input, 2 direction, 3 conviction presence, 4 retraction) and adopted the additive `conviction_provided = 12` (adversary's PROTO-7 evidence) over in-place optional. Closed O-1 (recon corrected D-2: cross-schema read `to_regclass`-guarded, list-intersected), O-2 (design no longer depends on an unverified buf verdict; CI `buf breaking` verdict still to record), O-4, O-5, O-6, O-7, O-8; opened O-9..O-14. Its `sdd-batch-design-state` fence is superseded by the round-3 fence below.
- 2026-11-13 — sdd-batch design gate (round 3): halted at the gate; register D-1..D-14, R-1..R-8, O-1..O-18; closed O-9 (four producers confirmed exhaustive), O-11, O-12; opened O-15..O-18; corrected the O-10 calibration test and the fixture (INSERT not CREATE, RENAME scenario); O-3 stayed blocking pending the operator. Last design-state fence follows verbatim.

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "Round-3 synthesis for 309-fix-fundsignal-scoring-correctness. Build order is unchanged: (0) proto, (1) formula input, (2) direction, (3) conviction presence, (4) retraction migration. There is no indicators code change and no new config key. The spec must re-baseline every line reference listed below; several moved since recon.\n\n(1) FORMULA INPUT (D-1). In `services/xstockstrat-analysis/app/engine/fundsignal_loop.py` `_score_via_formula` (:571-581), build the input dict only from keys not in `set(f.missing_metrics)`. An empty dict goes to `unscored`, replacing the `issuperset` test at :579. The `scores.get(\"composite\", 0.0)` read at :586 is unchanged; the scale contract is D-10.\n\n(2) DIRECTION: degenerate-only side gate. This is the current best but is still pending the operator's O-3 decision.\n- In `_map_directions` (:591-608), keep `ordered = sorted([*scores.values(), *reference_scores])` (:597) and both `_quantile` cuts (:598-599) byte-identical (D-9).\n- Degeneracy test: `degenerate = len(ordered) < _MIN_CROSS_SECTION or buy_cut <= sell_cut`.\n- Add TWO NEW module constants in fundsignal_loop.py: `_NEUTRAL_SCORE = 0.5` (D-6 fixes its value; the symbol does not exist yet, so the spec must not cite it as an existing anchor) and `_MIN_CROSS_SECTION = 5`. Both are fixed invariants, not config (not R-2).\n- When degenerate: `buy` iff `s >= buy_cut and s > _NEUTRAL_SCORE`; `sell` iff `s <= sell_cut and s < _NEUTRAL_SCORE`; anything else is `hold`.\n- When not degenerate: the code path and labels are unchanged.\n- Verified expected results:\n  - 260 @AC-9 (`tests/test_fundsignal_loop.py:1353-1364`): folded set 0.10/0.50/0.70/0.90, cut idx 2/1, so `sell_cut` is 0.50 and AAPL is `sell` (preserved).\n  - `test_map_directions_reference_scores_set_the_cuts`: line :1370 flips the lone 0.10 from `buy` to `sell`. It carries no @AC tag.\n  - `test_quantile_buckets` (:250) still passes.\n  - A lone 0.05 is `sell`, a lone 0.9 is `buy`, a lone 0.5 is `hold`.\n- O-10 calibration, corrected:\n  - `_quantile` (:793-802, `idx = int(round(q*(n-1)))`) already gives distinct cut ranks at n=2, 3 and 4. A \"distinct ranks at n=5\" test discriminates nothing, so it is rejected.\n  - The real property at the 0.80/0.20 defaults: 5 is the smallest n from which EVERY n' ≥ n has a non-empty hold band and a buy share ≤ 40%. n=4 has no hold band and 50% buy; n=2 has no hold band.\n  - Test `test_min_cross_section_calibrated_to_default_quantiles` asserts that property for n=5..50 on distinct scores, asserts n=4 violates it, and asserts n=2..4 take the degenerate branch.\n  - Document the coupling (5 is calibrated to the default quantiles, while `buy_quantile`/`sell_quantile` at :275-276 are live keys) next to the constants in analysis CLAUDE.md.\n- O-11 (closed): design.md records the mixed-label day as an accepted residual. A budget-deferred degenerate first run can be followed by a quantile-labelled resume, and earlier claims are never relabelled.\n- Scorer scale contract (D-10): document it next to `scoring_formula_id`, plus a range test on `value_quality`/`_builtin_score`. No clamp.\n\n(3) CONVICTION PRESENCE (D-3, D-7, D-8).\n- Proto PR: add `bool conviction_provided = 12;` to `ExternalSignal` in `packages/proto/ingest/v1/ingest.proto`. Also:\n  - update the :127 and :141 comments;\n  - run `./scripts/buf-gen.sh`;\n  - add the PROTO-7 entry (`packages/proto/docs/context-constitution.md:25`);\n  - record the CI `buf breaking` verdict in context.md.\n- There are exactly four non-test `ExternalSignal(` constructions (grep-confirmed by both sides):\n  - agent `services/xstockstrat-agent/app/client.py:248-255`: set the flag inside `if conviction is not None`.\n  - ingest `services/xstockstrat-ingest/app/engine/mcp_client_loop.py:90-94`: set it unconditionally, because conviction is mandatory there (`app/extractors/mcp_client.py:45-56`).\n  - analysis `fundsignal_loop.py:654-658` `_emit_signal`: set it unconditionally.\n  - ingest `QuerySignals` builder (`app/handlers/servicer.py:1343-1352`): set `conviction=float(row)` and `conviction_provided=True` only for a non-NULL row; leave both unset for a NULL row.\n- Re-baselined ingest lines: range check :1081, write sentinel :1101, dedup claim upsert :1134-1161 (re-claim on `conviction IS DISTINCT FROM EXCLUDED.conviction` at :1147-1148), read-back :1343-1352.\n- Write: `signal.conviction if (signal.conviction_provided or signal.conviction != 0.0) else None`.\n- Scorer `services/xstockstrat-analysis/app/services/scoring.py:31` uses the same predicate, else 0.5. Legacy NULL rows keep 0.5 (R-1).\n- Tests, one per seam (D-4, real `ingest_pb2.ExternalSignal`):\n  - (a) analysis: a 0.0 built-in score at the default `min_conviction_to_emit` makes `_emit_signal` send `conviction=0.0, conviction_provided=True`;\n  - (b) ingest: that request stores 0, and QuerySignals returns `conviction_provided=True, conviction=0.0`;\n  - (c) analysis: `compute_signal_score` on that proto adds 0.0 (screener path, AC-3);\n  - (d) mcp_client: explicit 0.0 is stored as 0, next to `mcp-client-signal-source.feature:34`.\n- NEW (O-16): rebuild the shared helper `_make_signal` (`tests/test_analysis_helpers.py:182-194`) on a real `ingest_pb2.ExternalSignal`. A MagicMock auto-creates a truthy `conviction_provided`, which flips `test_zero_conviction_uses_default_half` (:235-239). Keep :235 as the \"not given → 0.5\" pin, which is R-1's only existing guard, and add an explicit-0.0 sibling (provided → 0.0 weight). Never invert :235.\n- Doc surfaces are as closed under O-5. Analysis CLAUDE.md anchors are now :160 (feature-246 unscored bullet) and :419 (partial-row sentence); the stale parity comment is `acceptance/fundamentals-formula-inputs.feature:39`.\n- Deploy-boundary dedup (O-17): the current best is to accept it and record it in design.md as a residual bounded by `signals.dedup_window_hours`. A post-deploy explicit-0.0 resubmit stores 0, which IS DISTINCT FROM a legacy NULL claim, so it creates one extra active row scored 0.0 beside the legacy 0.5 row until the window passes. Do not special-case 0 = NULL in the upsert; that would re-introduce the sentinel at the dedup seam.\n\n(4) RETRACTION: ingest data migration, provisionally `017_retract_fabricated_fundsignals`. 015 and 016 exist; the number is re-derived at spec time after feature 318 (D-5).\n- The predicate is unchanged (D-11): system derived slugs from `ingest.signal_sources`, `conviction=0.5`, `ingested_at < '2026-10-31T00:00:00Z'`, the frozen operator list, `(valid_until IS NULL OR valid_until > now())`, and `NOT EXISTS` a `marketdata.fundamentals` row with any non-null metric. It all sits inside `to_regclass('marketdata.fundamentals')` (013:101-104 precedent).\n- Add `GET DIAGNOSTICS` plus `RAISE NOTICE` with the count. Conviction and dedup claims are untouched, a rerun is a no-op, and the down file is a stub.\n- Fixture `scripts/migration-assertions/ingest-017.sql` uses the `BEGIN … \\ir … ROLLBACK` shape of `ingest-016.sql:19-35`. It INSERTs `marketdata.fundamentals` rows (the harness migrates marketdata first, `scripts/migration-rerun.py:26-37`). Scenarios:\n  - (a) an all-null symbol is retracted;\n  - (b) a symbol with data survives;\n  - (c) a genuine 0.5 signal on a symbol with data survives;\n  - (d) a symbol outside the frozen list survives;\n  - (e) `ALTER TABLE marketdata.fundamentals RENAME`, then apply: zero rows change, proving the guard branch;\n  - (f) a rerun is a no-op.\n- The PR amends `docs/patterns/database.md:21-22` and root CLAUDE.md § Database. The \"only migration-time cross-schema read\" becomes two (identity→analysis 029, marketdata→ingest 017), with run order at database.md:35. The DBA and the marketdata owner acknowledge it there.\n- NEW (O-18): per-environment post-deploy check, recorded in context.md: (i) read the RAISE NOTICE count from the db-migrator job log and compare it with the frozen-list SELECT; (ii) run a read-only SQL check that no row matching the predicate is still active. This catches a silent `to_regclass` no-op that golang-migrate would still record as applied.\n- Opportunity lag (O-15, product-spec OQ4(b)): the current best is to ACCEPT the lag, with no triggered recompute. Retracted ingest rows stop feeding new computes immediately. Materialized `analysis.opportunities` rows (read filter `o.valid_until > now()`, `app/repositories/opportunities.py:233`) clear at the next stale-read background recompute or the daily refresh at `analysis.opportunity.refresh_hour_utc`, and in any case by row `valid_until` = session date + `opportunity.valid_window_hours` (24). design.md states this bound; the operator confirms.\n- O-14: the current best is natural `valid_days` expiry for stored wrong-direction `buy` rows from degenerate days. A targeted retraction needs either an ingest migration reading `analysis.fundsignal_emitted`, which migrates after ingest (`migration-rerun.py:26-37`), or an analysis migration writing `ingest.*`. Both break own-schema harder than the recorded read exception. The operator confirms.\n\nOperator sign-offs needed in context.md before /sdd-spec:\n- the O-3 gate shape, including the degenerate-branch hold-band variant;\n- the O-13 C-16 CHANGEs (246 @AC-3, 201 @AC-8, 201 @AC-4);\n- O-14 (natural expiry vs targeted retraction);\n- O-15 (accept the lag vs trigger a recompute).",
    "open_objections": [
      {
        "text": "O-3 [How-to-Act #1/#3, P-03] The direction gate's shape needs an explicit operator decision in context.md. Current best is degenerate-only (folded set < 5 or buy_cut <= sell_cut) with a side tie-break at 0.5. Two variants are still in play. (i) Always-on side gate: removes the n>=5 all-weak top-quantile buy, but relabels every production day (062 FR-6) and adds first-deploy dedup overlap. (ii) In the degenerate branch, use buy_quantile/sell_quantile as absolute score cuts (s>=0.80 buy, s<=0.20 sell): this keeps a real hold band, so a lone 0.51 is not buy and a lone 0.49 is not sell, but it overloads one live key with two meanings. With the side tie-break as proposed, the degenerate hold band is exactly s==0.5.",
        "blocking": true
      },
      {
        "text": "O-10 [C-18/F-07-adjacent] The r3 calibration test (distinct cut ranks at n=5) does not discriminate, because _quantile (fundsignal_loop.py:801) already gives distinct ranks at n=2..4. The synthesis replaces it with this property: at 0.80/0.20, every n in 5..50 has a non-empty hold band and |buy|/n <= 0.4, n=4 violates that, and n=2..4 take the degenerate branch. The CLAUDE.md note must state this property. The proposer must adopt it.",
        "blocking": false
      },
      {
        "text": "O-13 [C-16] The 246 @AC-3, 201 @AC-8 and 201 @AC-4 CHANGEs need operator sign-off in context.md before /sdd-spec. None is recorded.",
        "blocking": false
      },
      {
        "text": "O-14 [How-to-Act #1/P-03] For stored wrong-direction buy rows from degenerate days, the synthesis default is natural valid_days expiry, because a targeted retraction would break own-schema/run-order (analysis migrates after ingest). The operator must confirm.",
        "blocking": false
      },
      {
        "text": "O-15 [P-03, product-spec OQ4(b)] Retraction does not clear materialized analysis.opportunities rows. The read filter is only o.valid_until > now() (opportunities.py:233). design.md must state the lag bound (next background recompute or the daily refresh at opportunity.refresh_hour_utc, or by valid_until = session + opportunity.valid_window_hours) and record accept vs trigger. The synthesis default is accept; the operator confirms.",
        "blocking": false
      },
      {
        "text": "O-16 [C-08/P-06, extends D-4] The shared MagicMock helper _make_signal (tests/test_analysis_helpers.py:182-194) makes conviction_provided truthy, which flips test_zero_conviction_uses_default_half (:235-239), R-1's only existing pin. The spec must rebuild _make_signal on a real ingest_pb2.ExternalSignal, keep :235 as the not-given→0.5 pin, and add an explicit-0.0 sibling.",
        "blocking": false
      },
      {
        "text": "O-17 [P-03] Dedup at the deploy boundary: the claim upsert re-claims on conviction IS DISTINCT FROM EXCLUDED.conviction (ingest servicer.py:1147-1148). A post-deploy explicit-0.0 resubmit (stored 0) beside a legacy NULL claim becomes a second active row within signals.dedup_window_hours. design.md must record this as an accepted residual (the synthesis default) or decide otherwise.",
        "blocking": false
      },
      {
        "text": "O-18 [P-03; protects AC-4] In production the to_regclass guard can no-op silently while golang-migrate still records the version as applied. Add a per-environment post-deploy check, recorded in context.md: the RAISE NOTICE count from the db-migrator log matches the frozen-list SELECT, and a read-only SQL check shows no matching row still active.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1 @feature-246",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 @feature-246",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3 @feature-246",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-8 @feature-201",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4 @feature-201",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-9 @feature-260",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-8 @feature-260",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "mcp-client-signal-source.feature:34 round-trip",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-1 @feature-309",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 @feature-309",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-3 @feature-309",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4 @feature-309",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Scorer-only conviction fix with no presence signal (R-1, locked).",
      "Config-seeded minimum cross-section size plus absolute fallback (R-2, locked).",
      "Retraction from a literal operator list alone (R-3, locked).",
      "Routing a buf-flagged in-place optional through breaking-proto approval (R-4, locked).",
      "In-place optional double conviction = 4 as the primary branch (R-5, locked).",
      "Deriving degeneracy only from the _quantile cut indices, with no size constant (R-6, locked).",
      "A calibration test asserting distinct cut ranks at n=5. _quantile (fundsignal_loop.py:801) already gives distinct ranks at n=2..4, so it does not distinguish 5 from 4. Replaced by the hold-band/buy-share property test.",
      "Treating a stored 0 as equal to a legacy NULL in the dedup upsert to avoid the deploy-boundary duplicate. It re-introduces the 0.0 sentinel at the dedup seam, the exact conflation the presence flag removes. The bounded duplicate is accepted instead.",
      "Fixing test_zero_conviction_uses_default_half by inverting its assertion. It silently deletes the only existing pin of R-1's legacy-NULL→0.5 guarantee.",
      "A migration-assertions fixture that CREATEs marketdata.fundamentals. The harness migrates marketdata before ingest (scripts/migration-rerun.py:26-37), so the table already exists; the fixture INSERTs rows and proves the guard with a RENAME scenario."
    ],
    "open_risks": [
      "Degenerate-only leaves n>=5 all-weak cross-sections labelling their top quantile buy (designed relative ranking). The O-3 operator choice decides whether that is acceptable.",
      "With the side tie-break, the degenerate hold band is exactly s==0.5, so a lone 0.51 or 0.49 gets a direction from noise around neutral (O-3 variant ii).",
      "_MIN_CROSS_SECTION=5 is calibrated to the default quantiles. An operator who retunes buy_quantile/sell_quantile can shift where the hold band appears. The buy_cut <= sell_cut clause catches only full collapse.",
      "The legacy in-band rule `conviction != 0.0` keeps a sentinel: a pre-flag client that sends a deliberate 0.0 still reads as not-given (0.5).",
      "Deploy-boundary dedup duplicate within signals.dedup_window_hours (O-17).",
      "Retraction cutoff 2026-10-31T00:00:00Z is sourced from 246/feature.md:30 and not checked against deploy logs.",
      "The db-migrator role's SELECT on marketdata.fundamentals is unverified per environment (analysis 029 → identity.users is the precedent). A missing grant fails the migration loudly, but a missing table no-ops silently (O-18 check).",
      "Migration number 017 may collide with feature 318 (both ingest); re-derived at spec time.",
      "Opportunity rows built from retracted signals stay readable for up to about 24h if the lag is accepted (O-15).",
      "Stored wrong-direction buy rows stay active for up to valid_days (90) under natural expiry (O-14).",
      "EDGAR source-aware self-heal could null a fundamentals row before migration time; the frozen-list intersection bounds the retraction set.",
      "There is no test pinning the absence of TS/UI consumers of ExternalSignal.conviction (grep-only)."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-07",
      "C-08",
      "C-09",
      "C-10",
      "C-11",
      "C-14",
      "C-16",
      "C-18",
      "F-07",
      "P-02",
      "P-03",
      "P-06"
    ],
    "rationale": "I re-checked the adversary's load-bearing r3 claims in the tree, and all hold.\n- `_quantile` (fundsignal_loop.py:793-802) uses `int(round(q*(n-1)))`. At 0.80/0.20 that gives idx 1/0 (n=2), 2/0 (n=3), 2/1 (n=4) and 3/1 (n=5). The r3 \"distinct ranks at n=5\" test is therefore non-discriminating.\n- The correct calibration property is non-monotone below 5: n=3 has a hold band and 33% buy, while n=4 has no hold band and 50% buy. So 5 is justified as the smallest n from which the property holds for every larger n. That is how the synthesis frames it.\n- `_NEUTRAL_SCORE` does not exist in services/xstockstrat-analysis/app. D-6 settles only its value, so the approach now names it as a new constant rather than a reuse.\n- `_make_signal` (tests/test_analysis_helpers.py:182-194) is a MagicMock, and test_zero_conviction_uses_default_half (:235-239) asserts a buy with 0.0 scores above 0.5. Under the new predicate the auto-truthy `conviction_provided` would flip it. That is the fails.md:726 trap, now O-16.\n- The ingest upsert re-claims on `conviction IS DISTINCT FROM EXCLUDED.conviction` (servicer.py:1147-1148), now O-17.\n- opportunities.py:233 filters only on `valid_until > now()`, and analysis CLAUDE.md:611/:614 give the 24h window and daily refresh. So the O-15 lag is bounded at about 24h.\n- database.md:21-22 says \"The only migration-time cross-schema read\", and migration-rerun.py:26-37 orders marketdata before ingest. Both support the r3 fixture correction and the doc amendment (new D).\n- Analysis CLAUDE.md anchors moved to :160 and :419.\n\nClosures:\n- O-9: the four producer sites are confirmed exhaustive by both sides, ingest lines are re-baselined, and there is a per-seam test chain.\n- O-11: recorded as a design.md residual, uncontested.\n- O-12: the fixture INSERTs per harness order, the RENAME scenario proves the guard branch non-vacuously, and RAISE NOTICE carries the count. The adversary verified all of it.\n\nStill open:\n- O-10 stays open: the proposal's test was wrong, and the synthesis substitutes the property test for the proposer to adopt.\n- O-3 stays blocking, as a product-semantics choice reserved for the operator. The adversary's absolute-cut variant and the s==0.5 hold-band point are folded into O-3's options rather than raised as a separate objection, because they are a variant of the same gate-shape decision.\n- O-13 and O-14 stay operator-gated.\n\nNew non-blocking objections O-15 to O-18 come from adversary points the proposal did not answer. For each, the synthesis states a current-best default.\n\nRegister check: the approach honours D-1 to D-11. The fixed constants are not R-2. Nothing in R-1 to R-6 is reintroduced and no closed O-n is re-raised. O-16 extends D-4 to an existing helper and does not contest closed O-6. No REOPEN was filed and no operator steer reopens anything.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "The retraction migration's cross-schema read is documented as the second recorded migration-time cross-schema read. The PR amends docs/patterns/database.md:21-22 (\"The only migration-time cross-schema read\") and root CLAUDE.md § Database to cover identity→analysis 029 plus marketdata→ingest, with run order at database.md:35. DBA and marketdata-owner acknowledgement is required there.",
          "evidence": "docs/patterns/database.md:21-22, :35; scripts/migration-rerun.py:26-37 (marketdata migrates before ingest); proposer r3, verified by adversary r3"
        },
        {
          "text": "The retraction migration-assertions fixture follows the BEGIN … \\ir … ROLLBACK shape. It INSERTs marketdata.fundamentals rows (never CREATEs the table) and includes a RENAME-then-apply scenario that must change zero rows, proving the to_regclass guard branch.",
          "evidence": "scripts/migration-rerun.py:26-37; scripts/migration-assertions/ingest-016.sql:19-35; marketdata/migrations/002_fundamentals.up.sql:7-25; verified by adversary r3"
        },
        {
          "text": "_NEUTRAL_SCORE and _MIN_CROSS_SECTION are both NEW module constants in fundsignal_loop.py. The spec names them as additions, not existing anchors.",
          "evidence": "grep of services/xstockstrat-analysis/app for _NEUTRAL_SCORE|NEUTRAL returns nothing (adversary r3, re-verified)"
        }
      ],
      "new_rejected": [
        {
          "text": "Calibrating _MIN_CROSS_SECTION with a test that asserts distinct quantile cut ranks at n=5",
          "why": "_quantile (fundsignal_loop.py:801, int(round(q*(n-1)))) already gives distinct ranks at n=2..4, so the test cannot distinguish 5 from 4. The discriminating property is a non-empty hold band with buy share <= 40% for every n>=5."
        },
        {
          "text": "Treating a stored 0 as equal to a legacy NULL in the dedup claim upsert",
          "why": "It re-introduces the 0.0-as-absent sentinel at the dedup seam (servicer.py:1147-1148), which the conviction_provided flag exists to remove. The bounded duplicate within dedup_window_hours is accepted instead."
        }
      ],
      "new_objections": [
        {
          "text": "O-15 [P-03, product-spec OQ4(b)] Retraction leaves materialized analysis.opportunities rows readable (opportunities.py:233 filters only valid_until > now()). design.md must state the lag bound and record accept vs trigger; the synthesis default is accept.",
          "blocking": false
        },
        {
          "text": "O-16 [C-08/P-06, extends D-4] The MagicMock helper _make_signal (tests/test_analysis_helpers.py:182-194) makes conviction_provided truthy and flips test_zero_conviction_uses_default_half (:235-239), R-1's only pin. Rebuild the helper on a real ingest_pb2.ExternalSignal, keep :235, and add an explicit-0.0 sibling.",
          "blocking": false
        },
        {
          "text": "O-17 [P-03] Deploy-boundary dedup: a post-deploy explicit-0.0 resubmit (stored 0) IS DISTINCT FROM a legacy NULL claim (servicer.py:1147-1148), giving a second active row within signals.dedup_window_hours. Record it as an accepted residual in design.md or decide otherwise.",
          "blocking": false
        },
        {
          "text": "O-18 [P-03; protects AC-4] The to_regclass guard can no-op silently in production while golang-migrate records the version as applied. Add a per-environment post-deploy check (RAISE NOTICE count vs the frozen-list SELECT, plus a SQL check that no matching row is still active), recorded in context.md.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-9",
          "how": "The proposer confirmed exactly four non-test ExternalSignal constructions (agent client.py:248, ingest mcp_client_loop.py:90, ingest servicer.py:1343, analysis fundsignal_loop.py:654), each setting conviction_provided per D-8, and the adversary verified the grep. Ingest lines are re-baselined (:1081, :1101, :1134-1161, :1343-1352). The 0.0 read-back is pinned by a three-seam test chain (emit → ingest store/QuerySignals → compute_signal_score)."
        },
        {
          "id": "O-11",
          "how": "design.md records the budget-deferred mixed-label day (a degenerate first run, then a quantile-labelled resume, with earlier claims never relabelled) as an accepted residual. Uncontested by the adversary in r3."
        },
        {
          "id": "O-12",
          "how": "The fixture INSERTs marketdata.fundamentals rows per harness order (migration-rerun.py:26-37) with retract, survive, genuine-0.5, off-list and rerun scenarios. A RENAME-then-apply scenario proves the to_regclass guard branch is non-vacuous, and the migration emits GET DIAGNOSTICS plus RAISE NOTICE with the count. Verified by the adversary in r3."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

- 2026-11-20 — sdd-design: Recon (recon.md 2026-11-11; consumer surfaces `/insights/opportunities` and MCP `list_opportunities`; reuse: `_builtin_score` missing-metrics guard, 260 `reference_scores` fold). 3 rounds (full), approved by the operator at the gate; O-3 closed by operator decision; O-10 and O-13..O-18 stay `open` (non-blocking) in the register and design.md adopts or accepts each. Constitution rules touched C-01, C-07, C-08, C-09, C-10, C-11, C-14, C-16, C-18, F-07, P-02, P-03, P-06; no Floor breaches. Ledger: no line added (MagicMock trap already `fails.md:726`; silent `to_regclass` no-op unproven until execute). Status spec-ready → design-approved.

## Session 2026-11-10 (operator decisions before /sdd-design)

- C-16 sign-off: rewrite durable `@AC-8 @feature-201` from "composite differs from the producer, which passes pe_ratio as 0.0" to "composite matches the producer" (producer omits absent metrics too). The earlier signed-off divergence existed only because the producer's 0.0 scored missing P/B and D/E as top — the defect itself.
- Retraction of stored fabricated 0.5-conviction fundamentals signals approved in principle (DBA + ingest owner = operator). Mechanism (operator SQL vs numbered migration) and exact predicate decided in `/sdd-design`; the final SQL/migration is reviewed in its PR.

## Session 2026-11-20 (operator decisions at the design gate)

- Operator (2026-11-20, design gate, option A): the direction gate is degenerate-only (folded set < 5 or `buy_cut <= sell_cut`) with a side tie-break at 0.5. The always-on side gate and the absolute-score-cut variant are rejected.
- C-16 sign-off for the CHANGEs to `@AC-3 @feature-246` and `@AC-4` / `@AC-8 @feature-201`.
- O-3 is closed by this record.

## Session 2026-11-20 — sdd-spec

- Generated implementation-spec.md with 18 steps. Status: design-approved → implementation-ready.
- Operator decisions carried in (recorded above, 2026-11-20): direction gate is degenerate-only with the 0.5 side tie-break (option A); C-16 sign-off for the CHANGEs to `@AC-3 @feature-246` and `@AC-4` / `@AC-8 @feature-201`; O-3 closed.
- Tree: the feature branch tip `9a9c62cf` sits on base `c4fd48b0a`, 166 commits behind `main-dev`. This run did not merge `main-dev` (the batch protocol allows edits under this directory only), so the tree-freshness Sync was not run. Discovery read `origin/main-dev@36aed60b` through a read-only `git archive` snapshot, and every spec anchor is a `main-dev@36aed60b` line. `/sdd-execute` BRANCH SYNC must merge `main-dev` before Step 1.
- Key codebase findings:
  - Ingest migration number is `019`: `main-dev` already holds `015`..`018`, so design.md's provisional `017` is taken. No peer branch in the batch claims ingest `019`.
  - `fundsignal_loop.py`, `scoring.py` and the analysis tests named by the design are identical on the feature tip and `main-dev`. Ingest `servicer.py` anchors moved again: write sentinel `:1277`, range check `:1257`, `QuerySignals` builder `:1519-1528`.
  - The analysis doc anchors moved out of `CLAUDE.md`: the "Unscored symbols" bullet is `services/xstockstrat-analysis/docs/fundsignal.md:18`; the "diverges by design" line is `docs/fundamentals-guard.md:12`.
  - Exactly four non-test `ExternalSignal(` constructions (agent `client.py:250`, ingest `mcp_client_loop.py:90`, ingest `servicer.py:1519`, analysis `fundsignal_loop.py:654`). No `ExternalSignal` descriptor-parity guard exists, and no TS/UI or Go consumer of `ExternalSignal` / `QuerySignals` was found.
  - `scripts/migration-rerun.py` globs `scripts/migration-assertions/*.sql`, so `ingest-019.sql` needs no harness edit. The shared fixture's fundamentals rows are `FX<i>` symbols ingested after the cutoff, so migration 019 changes none of them.
  - The strat-lab skill has no ingest-conviction statement; it gets no edit.
  - The degenerate rule was checked with a throwaway script: 260 `@AC-9` and `test_quantile_buckets` keep their labels; only the lone-0.10 assertion at `tests/test_fundsignal_loop.py:1370` flips. At 0.80 / 0.20, every n in 5..50 has a hold band and a buy share ≤ 40%; n = 4 has neither.
- Atomic units (`**Lands with**`): Steps 1+2 (proto + proto-gen), 3+4 (formula input), 6+7 (direction gate), 11+12 (producer flag + scorer, with the real-proto `_make_signal`).

## Open Threads (implementation-ready)

- [ ] **Operator gate — frozen retraction list.** Step 16 blocks until this file holds a `Frozen retraction list` entry: the union over environments of the read-only SELECT in Step 16. The list is not in the repo.
- [ ] **Operator gate — retraction cutoff.** Confirm `2026-10-31T00:00:00Z` against deploy logs, or supply the corrected instant, in the same entry.
- [ ] **O-14 and O-15 are still unconfirmed.** design.md asked `/sdd-spec` to confirm them with the operator. The 2026-11-20 operator record names neither and this run had no operator to ask. The spec plans on the synthesis defaults (natural expiry of wrong-direction `buy` rows; about 24h opportunity lag, no recompute). A different choice needs a re-spec — target: `/sdd-review impl-spec`.
- [ ] The mcp_client explicit-0.0 EXTEND (`mcp-client-signal-source.feature:34`) is covered by a test in Step 10 but has no `@AC-*` in `acceptance.feature`, so no durable scenario text is added — target: `/sdd-review impl-spec`.
- [ ] Record the `buf breaking` verdict for `conviction_provided = 12` — target: Step 1.
- [ ] Record the CI `migration-rerun` result for `ingest-019.sql` — target: Step 17 / integration PR.
- [ ] Post-deploy check per environment (O-18): NOTICE count vs the frozen-list SELECT; no matching row still active — target: after the migration deploys.
- [ ] DBA + marketdata-owner acknowledgement of the cross-schema read; EDGAR self-heal reviewed against the list — target: migration PR (Steps 16, 18).

## Session 2026-11-20 — sdd-review impl-spec (advisory)

- Verdict: PASS WITH WARNINGS — 0 FAIL, 8 warnings, no Floor breaches. Overlap: WARN (no proto field, migration number or config key clash). Lifecycle unchanged (`implementation-ready`).
- Addressed (edits to `implementation-spec.md`, plus one scenario in `acceptance.feature`):
  - mcp_client explicit-0.0 EXTEND had no `@AC-*` (C-15 / C-16). Added `@AC-5` to `acceptance.feature`, worded from design.md § Business Rules Touched (the EXTEND next to `mcp-client-signal-source.feature:34`, approved at the design gate). Step 10 now carries `**Covers**: AC-5`; the Scenario Coverage table has the row. No new test was added: Step 10 tests 1 and 5 already assert it.
  - Step 16 placeholder (F-04 / P-03). The precondition now says `<frozen list>` and the cutoff literal are placeholders that are never committed, and the verification greps that no `<frozen` text is left in the up file.
  - Second cross-schema migration read. New Operator Gate 4: Step 16 blocks until this file holds the operator's explicit approval of the second exception and the marketdata owner's acknowledgement. The 2026-11-10 approval in principle predates the mechanism and does not name the cross-schema read.
  - O-14 / O-15. Operator Gate 3 now tells `/sdd-execute` to ask at its up-front confirmation, before Step 1, instead of deferring to this review.
  - Stale branch and `buf breaking`. Step 1 verification now says to run after BRANCH SYNC and to use the `#ref=HEAD` form when the local feature ref is stale or absent.
  - Overlap. Step Dependencies now names the shared files: ingest `servicer.py` `_ingest_external_signal` and `mcp_client_loop.py` with `fix-system-identity-paths` (313; `merge-order.md:404` on `main-dev`), merged by hand by whichever lands second. `fix-python-loop-supervision` (259) is `launched` on `main-dev`, so its `fundsignal_loop.py` rewrite is already in the spec anchors and is not a live collision.
  - `_MIN_CROSS_SECTION` (F-07 adjacent). Step Dependencies records the quantile coupling, the Step 7 calibration test and the Step 8 docs note, and names a config key as a possible follow-up.
  - Step 17 threshold. Step 17 now states that no coverage threshold applies and that Steps 16 and 17 count as verified only when CI `migration-rerun` is green on the integration PR.
- Not changed: step sizes (Steps 4, 12, 13 touch 3-4 files, inside the 5-file limit; advisory only).
- Reviewer claim not adopted as written: the verdict cites "DBA plus platform lead" for the cross-schema exception. Root `CLAUDE.md` § Approval Flow says DB migration = DBA + service owner, and `docs/runbooks/approval-flow.md` covers order approval only. Gate 4 asks for the operator's approval and the marketdata owner's acknowledgement; the operator decides whether platform-lead sign-off is also wanted.

## Open Threads (after impl-spec review — surface at the /sdd-execute checkpoint)

- [ ] **O-14 and O-15 need the operator's answer before Step 1** (Operator Gate 3). Defaults planned: wrong-direction `buy` rows expire naturally (up to 90 days); opportunity rows from retracted signals stay readable for about 24h. A different choice needs a re-spec.
- [ ] **Frozen retraction list** (Gate 1) and **cutoff `2026-10-31T00:00:00Z` confirmation** (Gate 2): both block Step 16. Steps 1-15 are not blocked.
- [ ] **Approval of the second migration-time cross-schema read** (Gate 4): operator approval and marketdata-owner acknowledgement recorded here before Step 16 lands; operator to say whether platform-lead sign-off is also required.
- [ ] **`@AC-5` was added by this review without an operator in the loop.** Its wording comes from the approved design.md EXTEND. Operator to confirm or reword at the execute checkpoint (C-16: it extends `@AC-4 @feature-166`, it does not change it).
- [ ] Peer specs for `fix-analysis-per-symbol-isolation` and `fix-analysis-evidence-dry` were not read. They may edit `fundsignal_loop.py` or `scoring.py`. Re-grep the Step 3, 6 and 11 anchors after BRANCH SYNC and after any later merge of `main-dev`.
- [ ] `fix-system-identity-paths` (313) edits the same ingest function as Step 9. Whichever merges second merges `_ingest_external_signal` by hand.
- [ ] Possible follow-up feature: make `_MIN_CROSS_SECTION` a config key or derive it from the quantiles. Not in scope here.
- [ ] Steps 16 and 17 have offline greps only; their real check is CI `migration-rerun` on the integration PR. Record that result here.
- Earlier threads still open: `buf breaking` verdict (Step 1); post-deploy check per environment (O-18); EDGAR self-heal review against the list (Step 16).

## Session 2026-11-21 — /sdd-distill
- Distilled 9 sessions → header + Superseded Sessions; kept 2 verbatim (sdd-spec, sdd-review impl-spec) plus the two operator-decision sessions (verbatim operator rulings).
- Dropped the superseded round-2 `sdd-batch-design-state` fence (the round-3 fence is the last and only one; register in debate.md); its content is hoisted into Decisions.
- context.md 620 → 322 lines / 72335 → 48792 bytes. Original prose preserved in git history.
