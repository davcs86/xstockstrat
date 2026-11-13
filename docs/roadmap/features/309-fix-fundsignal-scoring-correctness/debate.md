# Debate Register: fix-fundsignal-scoring-correctness

**State**: in-debate
**Mode**: full
**Rounds run**: 3 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-11 | /sdd-batch | 6 | 4 | 0 | 8 | 0 | yes |
| 2 | 2026-11-11 | /sdd-batch | 5 | 2 | 7 | 6 | 0 | yes |
| 3 | 2026-11-13 | /sdd-batch | 3 | 2 | 3 | 4 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | Formula path omits a metric only when it is in missing_metrics (never by value); an empty input dict means unscored. | fundsignal_loop.py:534-550, :579; evaluator.py:586-588; uncontested by adversary r1 | settled |
| D-2 | 1 | marketdata and ingest share one database per environment (per-service schemas), so an ingest migration can read marketdata.fundamentals; recon.md is corrected accordingly. | docs/patterns/database.md:3, :32, :122; marketdata migrations/002_fundamentals.up.sql:7-25 | settled |
| D-3 | 1 | A breaking proto change to ingest v1 is not approvable. If buf breaking flags the in-place optional, conviction presence uses an additive field (bool conviction_provided = 12) instead. | docs/runbooks/proto-versioning.md:5; packages/proto/buf.yaml (no breaking block); ingest.proto ExternalSignal fields end at 11 | settled |
| D-4 | 1 | Conviction-presence RED tests use a real ingest_pb2.ExternalSignal (no MagicMock), and AC-3 is scoped to the screener path only. | tests/test_analysis_helpers.py:165-194; analysis servicer.py:890-891; screener.py:285 | settled |
| D-5 | 1 | The retraction migration's down file is a stub comment; the migration number is re-derived at spec time after feature 318. | docs/patterns/database.md:39; ingest migrations latest = 014_contract_signal_ownership | settled |
| D-6 | 1 | _NEUTRAL_SCORE = 0.5 is a fixed module invariant (the [0,1] midpoint), not a config key, and not an F-07 breach. | Adversary r1 Floor check; analysis CLAUDE.md fixed-invariant precedent | settled |
| D-7 | 2 | Conviction presence uses an additive `bool conviction_provided = 12` on ExternalSignal as the design (not a fallback). Field 4 stays plain `double`. The presence predicate is `conviction_provided or conviction != 0.0`. | packages/proto/docs/context-constitution.md:25 (PROTO-7: optional conversion is buf-breaking; the sibling-flag pattern is established); ExternalSignal fields end at user_id=11 (ingest.proto); consistent with D-3 | settled |
| D-8 | 2 | Every ExternalSignal producer that sets conviction also sets conviction_provided=True: agent client.py:255, ingest mcp_client_loop.py:94, analysis fundsignal_loop.py:658. QuerySignals (ingest servicer.py:1297-1302) sets conviction_provided=True for non-NULL rows and leaves both fields unset for NULL rows. | fundsignal_loop.py:654-658 builds conviction=float(conviction); servicer.py:1302 writes 0.0 for NULL; adversary r2 | settled |
| D-9 | 2 | Cross-section degeneracy is counted over the folded set (scores ∪ reference_scores), whichever gate shape the operator picks. | fundsignal_loop.py:278-279, :597; fails.md fix-fundsignal-emit-accounting; agreed by both sides r2 | settled |
| D-10 | 2 | Scorer scale contract: a system scoring composite is in [0,1] with 0.5 neutral. It is documented in analysis CLAUDE.md next to scoring_formula_id and pinned by a range test on value_quality and _builtin_score; there is no clamp. | fundsignal_loop.py:550, :586; proposer r2, accepted by adversary r2 | settled |
| D-11 | 2 | The retraction migration is to_regclass-guarded and bounded by ingested_at < '2026-10-31T00:00:00Z' (the feature-246 production launch). | ingest/migrations/013_signal_ownership_templates.up.sql:101-104; docs/roadmap/features/246-fix-fundsignal-neutral-score/feature.md:30 | settled |
| D-12 | 3 | The retraction migration's cross-schema read is documented as the second recorded migration-time cross-schema read. The PR amends docs/patterns/database.md:21-22 ("The only migration-time cross-schema read") and root CLAUDE.md § Database to cover identity→analysis 029 plus marketdata→ingest, with run order at database.md:35. DBA and marketdata-owner acknowledgement is required there. | docs/patterns/database.md:21-22, :35; scripts/migration-rerun.py:26-37 (marketdata migrates before ingest); proposer r3, verified by adversary r3 | settled |
| D-13 | 3 | The retraction migration-assertions fixture follows the BEGIN … \ir … ROLLBACK shape. It INSERTs marketdata.fundamentals rows (never CREATEs the table) and includes a RENAME-then-apply scenario that must change zero rows, proving the to_regclass guard branch. | scripts/migration-rerun.py:26-37; scripts/migration-assertions/ingest-016.sql:19-35; marketdata/migrations/002_fundamentals.up.sql:7-25; verified by adversary r3 | settled |
| D-14 | 3 | _NEUTRAL_SCORE and _MIN_CROSS_SECTION are both NEW module constants in fundsignal_loop.py. The spec names them as additions, not existing anchors. | grep of services/xstockstrat-analysis/app for _NEUTRAL_SCORE/NEUTRAL returns nothing (adversary r3, re-verified) | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Scorer-only conviction fix (read 0.0 literally) with no presence signal | The agent omits conviction (agent/app/client.py:254-255, tools.py:654-668), so NULL rows would silently drop from 0.5 to 0.0 weight. | locked |
| R-2 | 1 | Config-seeded minimum cross-section size plus absolute fallback (config migration 048) | It adds a key and a stored-zero decision (platform @AC-6 @feature-244) for no extra protection. | locked |
| R-3 | 1 | Retraction from a literal operator list alone, leaving env-specific symbols out | It rests on the false separate-database premise, cannot be tested against the @AC-4 Given, and leaves fabricated rows active. | locked |
| R-4 | 1 | Routing a buf-flagged in-place optional through the 2-owner + platform-lead breaking-proto approval | proto-versioning.md:5 forbids breaking changes to an existing v1 proto. | locked |
| R-5 | 2 | In-place `optional double conviction = 4` as the primary branch behind a step-0 buf check | PROTO-7 records the implicit-to-optional conversion as buf-breaking and names the sibling flag as the pattern; an expected-to-fail proto PR is churn. | locked |
| R-6 | 2 | Deriving degeneracy only from the _quantile cut indices, with no size constant | At the 0.80/0.20 defaults it flags only n<=3, which under-covers the report's 2-4 symbol collapse range. | locked |
| R-7 | 3 | Calibrating _MIN_CROSS_SECTION with a test that asserts distinct quantile cut ranks at n=5 | _quantile (fundsignal_loop.py:801, int(round(q*(n-1)))) already gives distinct ranks at n=2..4, so the test cannot distinguish 5 from 4. The discriminating property is a non-empty hold band with buy share <= 40% for every n>=5. | locked |
| R-8 | 3 | Treating a stored 0 as equal to a legacy NULL in the dedup claim upsert | It re-introduces the 0.0-as-absent sentinel at the dedup seam (servicer.py:1147-1148), which the conviction_provided flag exists to remove. The bounded duplicate within dedup_window_hours is accepted instead. | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | O-1 [P-03/C-01] The fix-4 retraction mechanism was built on a false separate-database premise. Correct recon and adopt the in-database guard, with an absent-table guard and marketdata-owner acknowledgement of the cross-schema read. | yes | closed @ round 2 (Recon corrected (D-2). The cross-schema read is to_regclass-guarded per the 013 precedent, the in-database NOT EXISTS leg is intersected with the frozen operator list, and the marketdata owner acknowledges the read in the PR. The adversary judged it substantively addressed in r2.) |
| O-2 | 1 | O-2 [C-09] buf breaking on the in-place optional conviction is unverified; run it, record it, and pre-decide the additive field-12 fallback. | yes | closed @ round 2 (The design now uses the additive field conviction_provided=12, which is buf-safe by construction, based on the PROTO-7 record. The CI proto-lint buf breaking verdict is still recorded in context.md.) |
| O-3 | 1 | O-3 [How-to-Act #1/#3, P-03] The always-on side gate changes labels on all cross-sections (062 FR-6) and creates a first-deploy dedup overlap. Needs an operator decision: always-on or degenerate-only. | yes | open |
| O-4 | 1 | O-4 [C-18/F-07-adjacent] The side gate assumes the system scoring formula composite is in [0,1], centred on 0.5. Document the contract with a test, or clamp. | no | closed @ round 2 (The [0,1], 0.5-neutral composite contract is documented in analysis CLAUDE.md and pinned by a range test on value_quality and _builtin_score; no clamp. Accepted by the adversary in r2.) |
| O-5 | 1 | O-5 [C-10/C-14] Conviction-semantics docs must be updated on every surface (tools.py, mcp-tools.md:251, signal_extraction.md:70-71, ingest.proto:127, INGEST-4, strat-lab skill), and the mcp_client_loop.py:94 explicit-0.0 path must be tested. | no | closed @ round 2 (All doc surfaces are listed (proto comment, INGEST-4, tools.py, mcp-tools.md:251, signal_extraction.md, the strat-lab skill, analysis CLAUDE.md, the 201 @AC-4 comment) plus the PROTO-7 entry. The mcp_client_loop.py:94 explicit-0.0 path is tested next to mcp-client-signal-source.feature:34.) |
| O-6 | 1 | O-6 [C-08/P-06] MagicMock HasField is always truthy; use a real proto. AC-3 is screener-only. | no | closed @ round 2 (D-4 adopted: real ingest_pb2.ExternalSignal in the tests; AC-3 is screener-only.) |
| O-7 | 1 | O-7 [C-07] Migration number is provisional (feature 318); fixtures only in the migration-assertions harness; rerun pinned as a no-op. | no | closed @ round 2 (The number is provisional and re-derived at spec time, fixtures live only in scripts/migration-assertions, a rerun is a no-op via the valid_until > now() guard, and the down file is a stub (D-5). The fixture-content refinement moves to O-12.) |
| O-8 | 1 | O-8 [P-03] Scope the retraction to system derived source slugs and to ingested_at < the feature-246 production cutoff instead of attesting those assumptions. | no | closed @ round 2 (Source is scoped to system derived slugs from ingest.signal_sources, and the cutoff is ingested_at < 2026-10-31T00:00:00Z, sourced from 246/feature.md:30.) |
| O-9 | 2 | O-9 [C-09/P-03] Under conviction_provided, fundsignal_loop.py:658 and the QuerySignals read-back (servicer.py:1297-1302) must also carry presence, and a producer-path RED test must show a 0.0 score reads back as 0.0. | no | closed @ round 3 (The proposer confirmed exactly four non-test ExternalSignal constructions (agent client.py:248, ingest mcp_client_loop.py:90, ingest servicer.py:1343, analysis fundsignal_loop.py:654), each setting conviction_provided per D-8, and the adversary verified the grep. Ingest lines are re-baselined (:1081, :1101, :1134-1161, :1343-1352). The 0.0 read-back is pinned by a three-seam test chain (emit → ingest store/QuerySignals → compute_signal_score).) |
| O-10 | 2 | O-10 [C-18/F-07-adjacent] _MIN_CROSS_SECTION=5 is coupled to the default quantiles, which are live config. Document the coupling and pin it with a default-quantile test. | no | open |
| O-11 | 2 | O-11 [P-03] A budget-deferred day can mix absolute-gate and quantile labels. Record this as an accepted residual in design.md. | no | closed @ round 3 (design.md records the budget-deferred mixed-label day (a degenerate first run, then a quantile-labelled resume, with earlier claims never relabelled) as an accepted residual. Uncontested by the adversary in r3.) |
| O-12 | 2 | O-12 [C-07] The migration fixture must create marketdata.fundamentals with retract and survive rows so the to_regclass guard cannot pass vacuously. The migration must RAISE NOTICE with the updated count. | no | closed @ round 3 (The fixture INSERTs marketdata.fundamentals rows per harness order (migration-rerun.py:26-37) with retract, survive, genuine-0.5, off-list and rerun scenarios. A RENAME-then-apply scenario proves the to_regclass guard branch is non-vacuous, and the migration emits GET DIAGNOSTICS plus RAISE NOTICE with the count. Verified by the adversary in r3.) |
| O-13 | 2 | O-13 [C-16] The 246 @AC-3, 201 @AC-8 and 201 @AC-4 CHANGEs need operator sign-off in context.md before /sdd-spec. | no | open |
| O-14 | 2 | O-14 [How-to-Act #1/P-03] Stored wrong-direction buy rows from degenerate days are in no scope. The operator chooses natural expiry or a targeted retraction. | no | open |
| O-15 | 3 | O-15 [P-03, product-spec OQ4(b)] Retraction leaves materialized analysis.opportunities rows readable (opportunities.py:233 filters only valid_until > now()). design.md must state the lag bound and record accept vs trigger; the synthesis default is accept. | no | open |
| O-16 | 3 | O-16 [C-08/P-06, extends D-4] The MagicMock helper _make_signal (tests/test_analysis_helpers.py:182-194) makes conviction_provided truthy and flips test_zero_conviction_uses_default_half (:235-239), R-1's only pin. Rebuild the helper on a real ingest_pb2.ExternalSignal, keep :235, and add an explicit-0.0 sibling. | no | open |
| O-17 | 3 | O-17 [P-03] Deploy-boundary dedup: a post-deploy explicit-0.0 resubmit (stored 0) IS DISTINCT FROM a legacy NULL claim (servicer.py:1147-1148), giving a second active row within signals.dedup_window_hours. Record it as an accepted residual in design.md or decide otherwise. | no | open |
| O-18 | 3 | O-18 [P-03; protects AC-4] The to_regclass guard can no-op silently in production while golang-migrate records the version as applied. Add a per-environment post-deploy check (RAISE NOTICE count vs the frozen-list SELECT, plus a SQL check that no matching row is still active), recorded in context.md. | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
