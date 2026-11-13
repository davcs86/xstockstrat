# Context Log: fix-fundsignal-scoring-correctness

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect reports (Issues disabled; clustered triage):
  - `docs/reports/2026-10-21-analysis-fundsignal-formula-partial-row-wire-zero-defect.md` — formula-path producer scores absent metrics as 0.0 (SEV-2)
  - `docs/reports/2026-10-21-analysis-fundsignal-small-cross-section-quantile-defect.md` — lone scored symbol always labelled "buy" (SEV-2)
  - `docs/reports/2026-10-21-analysis-zero-conviction-read-as-neutral-defect.md` — conviction 0.0 read back as neutral 0.5 by the scorer (SEV-2)
  - `docs/reports/2026-10-21-ingest-fundsignal-fabricated-signals-not-retracted-defect.md` — fabricated 0.5 fundamentals signals already stored are never retracted (SEV-2; dev + production)
- Cluster rationale: all four are residuals of feature 246's fundamentals-signal correctness work (proto3 zero-vs-absent and degenerate scoring), sharing the producer → ingest → scorer pipeline.
- Severity: SEV-2 (all four)
- Routed to SDD path (Track C); prod-impacting SEV-2 (report 4) routed to C by operator decision 2026-11-10
- Created: status.md, feature.md, product-spec.md, acceptance.feature (4 regression scenarios), context.md; report sidecars stamped `triaged`
- Affected services (from reports): xstockstrat-analysis, xstockstrat-ingest, xstockstrat-indicators
- Root cause hypothesis: proto3 doubles lack presence (0.0 = absent); direction quantile has no floor; 246 had no retraction path
- Recommended design depth: full → `/sdd-design fix-fundsignal-scoring-correctness` (rationale: ≥2 services, a data migration/one-off SQL, possible proto presence change, durable @AC-8 @feature-201 change needing C-16 sign-off)
- Development branch: feature/fix-fundsignal-scoring-correctness

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags; no Consumer Surface section); possible proto (optional conviction) must be classified additive; fundsignal key contract deferred; retraction migration NNN/approvals (DBA + ingest owner) deferred; AC-2 negative-only; AC-1 contradicts durable @AC-8 @feature-201 (C-16 sign-off before /sdd-spec); ListOpportunities recompute precondition (OQ4b)
- Overlap findings: WARN: analysis/ingest/indicators shared; ingest migrations dir vs 318 ordering gate
- Recommended design depth: full (proto/migration possible; 3 services; C-16 sign-off for durable @AC-8 @feature-201)
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)

## Session 2026-11-10 (operator decisions before /sdd-design)

- C-16 sign-off: rewrite durable `@AC-8 @feature-201` from "composite differs from the producer, which passes pe_ratio as 0.0" to "composite matches the producer" (producer omits absent metrics too). The earlier signed-off divergence existed only because the producer's 0.0 scored missing P/B and D/E as top — the defect itself.
- Retraction of stored fabricated 0.5-conviction fundamentals signals approved in principle (DBA + ingest owner = operator). Mechanism (operator SQL vs numbered migration) and exact predicate decided in `/sdd-design`; the final SQL/migration is reviewed in its PR.

## Session 2026-11-11 — sdd-batch design gate (round 2)

- `/sdd-design fix-fundsignal-scoring-correctness` (full) ran 2 rounds and is halted at the approval gate (gate policy: halt). Per the grilling protocol, design.md is NOT written and status.md is unchanged (`spec-ready`). Register: `debate.md` (D-1..D-11, R-1..R-6, O-1..O-14; O-1, O-2, O-4..O-8 closed @ round 2).

## Open Threads

- **Approach (round-2 synthesis).** Build order: (0) proto, (1) formula input, (2) direction, (3) conviction presence, (4) retraction migration. No indicators code change and no new config key.
  - (1) Formula input: `_score_via_formula` builds its input only from keys not in `missing_metrics`; an empty input means unscored (D-1).
  - (2) Direction: a degenerate-only side gate in `_map_directions`. Degeneracy is counted over the folded set (D-9) and holds when the set has fewer than `_MIN_CROSS_SECTION = 5` symbols (a fixed module constant, not config) or when `buy_cut <= sell_cut`. In that case `buy` also needs a score above 0.5 and `sell` a score below 0.5. Non-degenerate labels are identical to the 062 quantile labels. The [0,1] composite contract, with 0.5 neutral, is documented and range-tested, with no clamp (D-10).
  - (3) Conviction presence: an additive `bool conviction_provided = 12` on `ExternalSignal` (D-7). Every producer sets it (agent, ingest mcp_client, analysis `_emit_signal`), and QuerySignals sets it for non-NULL rows (D-8). The predicate is `conviction_provided or conviction != 0.0`, and legacy NULL rows keep their 0.5 weight.
  - (4) Retraction: a `to_regclass`-guarded ingest data migration (number provisional, 015/016 after 318). It expires `system`/derived 0.5-conviction rows ingested before 2026-10-31T00:00:00Z whose symbol is both on a frozen operator list and lacking any non-null marketdata.fundamentals metric (D-11). It logs the updated count with `RAISE NOTICE`, a rerun is a no-op, and the down file is a stub.
- **Strongest open objection: O-3 (blocking).** The direction gate's shape needs an explicit operator decision: degenerate-only (recommended) or always-on (runner-up). Degenerate-only leaves an n=5 cliff, where an all-weak 5-symbol set still labels its top symbol `buy`.
- **Floor status:** no Floor breaches.
- **Uncovered @AC changes (C-16), not yet covered by an operator decision:**
  - CHANGE to `@AC-3 @feature-246` (`fix-fundsignal-neutral-score.feature:42`), `@AC-8 @feature-201` and `@AC-4 @feature-201` (O-13). The earlier 2026-11-10 operator decision covers the intent of the 201 @AC-8 rewrite, but the batch records `covered_by_operator_decision: false` until the sign-off names the final wording.
  - EXTEND for the `mcp-client-signal-source.feature:34` round-trip and for 309 @AC-1..@AC-4.
- **Other open objections (non-blocking):**
  - O-9: producer and read-back presence, plus a producer-path RED test;
  - O-10: document the coupling between `_MIN_CROSS_SECTION` and the quantiles, plus a default-quantile test;
  - O-11: record the mixed-semantics budget-deferred day as a residual;
  - O-12: a non-vacuous migration fixture and `RAISE NOTICE`;
  - O-14: stored wrong-direction `buy` rows, either natural expiry (the default) or a targeted retraction.
- **Operator sign-offs needed here before /sdd-spec:** O-3 gate shape; the C-16 CHANGEs (O-13); the O-14 stored-direction scope.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Round-2 synthesis for 309-fix-fundsignal-scoring-correctness. Build order: (0) proto, (1) formula input, (2) direction, (3) conviction presence, (4) retraction migration. There is no indicators code change and no new config key.\n\n(1) FORMULA INPUT (D-1, unchanged). In `services/xstockstrat-analysis/app/engine/fundsignal_loop.py` `_score_via_formula` (:571-578), build the input dict only from keys that are not in `set(f.missing_metrics)`. Replace the `issuperset` skip at :579 with `if not fundamentals: unscored.append(sym)`.\n\n(2) DIRECTION: degenerate-only side gate. This is the current best, but it is still pending the operator's O-3 decision; the runner-up is the always-on gate.\n- In `_map_directions` (:592-608), compute `ordered` (the folded set `scores ∪ reference_scores`) and the cuts exactly as today.\n- `degenerate = len(ordered) < _MIN_CROSS_SECTION or buy_cut <= sell_cut`. `_MIN_CROSS_SECTION = 5` is a fixed module constant, like `_NEUTRAL_SCORE` (D-6). It is not config (R-2).\n- When degenerate: `buy` iff `s >= buy_cut and s > _NEUTRAL_SCORE`; `sell` iff `s <= sell_cut and s < _NEUTRAL_SCORE`; anything else is `hold`.\n- When not degenerate, labels are byte-identical to the 062 quantile labels.\n- Flip `tests/test_fundsignal_loop.py:1370` (lone 0.10) from `buy` to `sell`.\n- Expected results: 260 @AC-9 (n=4, AAPL 0.10) is `sell`; a lone 0.05 is `sell`; a lone 0.9 is `buy`; a lone 0.5 is `hold`.\n- Document in analysis CLAUDE.md, next to `_NEUTRAL_SCORE`, that 5 is calibrated to the default 0.80/0.20 quantiles while `buy_quantile`/`sell_quantile` are live keys (:275-276). Pin it with a default-quantile test (O-10).\n- design.md records the mixed-semantics day (a budget-deferred degenerate first run, then a full quantile resume run) as an accepted residual (O-11).\n- Scorer scale contract (O-4, closed): \"a system scoring composite is in [0,1], 0.5 neutral\". Document it next to `scoring_formula_id` in analysis CLAUDE.md. Add a range test on `value_quality` and `_builtin_score`. No clamp at :586.\n\n(3) CONVICTION PRESENCE: additive sibling flag as the design. This adopts the adversary's PROTO-7 evidence and stays inside D-3.\n- Step 0 (its own PR): add `bool conviction_provided = 12;` to `ExternalSignal` in `packages/proto/ingest/v1/ingest.proto`. Verified: ExternalSignal's fields end at 11, so 12 is free on that message. The other `= 12` hits in the file are on other messages. Field 4 stays `double conviction = 4`.\n- Update the comments at :127 and the :141 dedup comment, then run `./scripts/buf-gen.sh`. An additive field is buf-safe by construction. CI `proto-lint` still runs `buf breaking`, and its verdict is recorded in context.md.\n- Add a PROTO-7 sibling-flag entry for `ExternalSignal.conviction_provided` in `packages/proto/docs/context-constitution.md:25`.\n- Presence predicate, one per service: `sig.conviction_provided or sig.conviction != 0.0`. The second clause is the in-band legacy rule, bounded and documented in INGEST-4 per fails.md:2278.\n- Every producer that sets conviction must set `conviction_provided=True`:\n  - `services/xstockstrat-agent/app/client.py:255`, inside the `if conviction is not None` branch;\n  - `services/xstockstrat-ingest/app/engine/mcp_client_loop.py:94`;\n  - `services/xstockstrat-analysis/app/engine/fundsignal_loop.py:658` (`_emit_signal`). This is the report-3 producer path; without it a 0.0 score is still stored as NULL.\n- Ingest write `services/xstockstrat-ingest/app/handlers/servicer.py:1055`: store `signal.conviction if present else None`.\n- Ingest QuerySignals builder `servicer.py:1297-1302`: for a non-NULL row, set `conviction=float(row)` and `conviction_provided=True`. For a NULL row, leave both unset (never `conviction=None`).\n- Scorer `services/xstockstrat-analysis/app/services/scoring.py:31`: `sig.conviction if present else 0.5`.\n- Legacy NULL rows keep their 0.5 weight. Other analysis readers (servicer.py:5029, :5556, :6749) are unchanged.\n- Tests use a real `ingest_pb2.ExternalSignal` (D-4). AC-3 is screener-only (screener.py:285). Add a producer-path RED test: the built-in score is 0.0 → `_emit_signal` → ingest write → QuerySignals → `compute_signal_score` adds 0.0, not 0.5. Add an mcp_client explicit-0.0 → stored-0 test next to `mcp-client-signal-source.feature:34`.\n- Doc surfaces (O-5, closed):\n  - the ingest.proto:127 comment;\n  - INGEST-4 (`services/xstockstrat-ingest/docs/context-constitution.md:23`);\n  - `services/xstockstrat-agent/app/tools.py:665-668`;\n  - `docs/runbooks/mcp-tools.md:251`;\n  - `services/xstockstrat-agent/app/prompts/signal_extraction.md:70-71`;\n  - the strat-lab `backtest` skill, if it states the 0.0 rule;\n  - the analysis CLAUDE.md feature-246 unscored bullet and the partial-row sentence;\n  - the 201 @AC-4 comment;\n  - PROTO-7.\n\n(4) RETRACTION: ingest data migration. The number is provisional (015, or 016 after feature 318; D-5).\n- The SQL is wrapped in `DO $$ BEGIN IF to_regclass('marketdata.fundamentals') IS NOT NULL THEN ... END IF; END $$`. Precedent: `ingest/migrations/013_signal_ownership_templates.up.sql:101-104`.\n- Statement: `UPDATE ingest.newsletter_signals s SET valid_until=now() WHERE s.user_id='system'`, with these conditions:\n  - `s.source IN (SELECT slug FROM ingest.signal_sources WHERE user_id='system' AND source_type='derived')`;\n  - `s.conviction=0.5`;\n  - `s.ingested_at < '2026-10-31T00:00:00Z'` (246 production launch, `246/feature.md:30`);\n  - `s.symbol = ANY(<frozen operator list>)`;\n  - `(s.valid_until IS NULL OR s.valid_until > now())`;\n  - `NOT EXISTS` a marketdata.fundamentals row for the symbol where `COALESCE` of the six metric columns `IS NOT NULL`.\n- Add `GET DIAGNOSTICS` + `RAISE NOTICE` with the updated count, so each environment's run log can be compared with the frozen-list SELECT (O-12).\n- The list is frozen from a read-only SELECT of the same predicate without the list leg, run per environment and recorded in the PR.\n- Conviction and dedup claims are left untouched. A rerun is a no-op (`valid_until > now()`). The down file is a stub.\n- Fixture `scripts/migration-assertions/ingest-0NN.sql` (precedent ingest-014.sql) must CREATE `marketdata.fundamentals` and seed it with an all-null symbol (retracted), a symbol with data (survives), and a genuine 0.5 signal on a symbol with data (survives). That way the `to_regclass` guard cannot pass vacuously.\n- The marketdata owner acknowledges the cross-schema read in the PR, with DBA and ingest-owner approval.\n- Accepted residuals: opportunity reader lag of about 24h; OQ6 is out of scope.\n- Stored wrong-direction `buy` rows from degenerate days (report 2) default to natural expiry (`valid_days`) unless the operator chooses a targeted retraction (O-14).\n\nOperator sign-offs needed in context.md before /sdd-spec:\n- the O-3 gate shape;\n- the C-16 CHANGEs to 246 @AC-3 (`fix-fundsignal-neutral-score.feature:42`), 201 @AC-8 and 201 @AC-4;\n- the O-14 stored-direction scope.",
    "open_objections": [
      {
        "text": "O-3 [How-to-Act #1/#3, P-03] The direction gate's shape still needs an explicit operator decision in context.md. The synthesis recommends degenerate-only (folded set < 5 or buy_cut <= sell_cut); the runner-up is always-on. Degenerate-only leaves the n=5 cliff, where an all-weak 5-symbol set still labels its top symbol buy.",
        "blocking": true
      },
      {
        "text": "O-9 [C-09/P-03] Under the conviction_provided flag, every producer and the read-back must carry presence. That means fundsignal_loop.py:658 (_emit_signal) sets conviction_provided=True, and QuerySignals at servicer.py:1297-1302 sets it for non-NULL rows, plus a producer-path RED test where a 0.0 built-in score reads back as 0.0. The synthesis adopts all of this; the proposer must confirm it in r3.",
        "blocking": false
      },
      {
        "text": "O-10 [C-18/F-07-adjacent] _MIN_CROSS_SECTION=5 is calibrated to the default 0.80/0.20 quantiles, but buy_quantile/sell_quantile are live config keys (fundsignal_loop.py:275-276). Document the coupling next to _NEUTRAL_SCORE in analysis CLAUDE.md and pin it with a default-quantile test.",
        "blocking": false
      },
      {
        "text": "O-11 [P-03] Within one day, a budget-deferred degenerate first run can be labelled by the absolute gate while the full resume run is labelled by quantile, and early claims are never relabelled. Record this as an accepted residual in design.md.",
        "blocking": false
      },
      {
        "text": "O-12 [C-07] The migration-assertions fixture must CREATE marketdata.fundamentals with three rows: one all-null symbol, one symbol with data, and one genuine 0.5 signal on a symbol with data that must survive. Otherwise the to_regclass guard passes vacuously. The migration must also RAISE NOTICE with the updated row count for each environment's log.",
        "blocking": false
      },
      {
        "text": "O-13 [C-16] The CHANGEs to 246 @AC-3 (fix-fundsignal-neutral-score.feature:42, pe_ratio 0.0 in the input), 201 @AC-8 and 201 @AC-4 need operator sign-off in context.md before /sdd-spec. No operator decision is recorded in this run.",
        "blocking": false
      },
      {
        "text": "O-14 [How-to-Act #1/P-03] Wrong-direction buy signals that report 2 says are already stored (low scores emitted as buy from degenerate days, active for valid_days) are in neither the retraction predicate nor OQ6. The operator chooses between natural expiry (the synthesis default) and a targeted retraction joined through analysis.fundsignal_emitted.",
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
      "Config-seeded minimum cross-section size plus an absolute fallback (R-2, locked).",
      "Retraction from a literal operator list alone (R-3, locked).",
      "Routing a buf-flagged in-place optional through breaking-proto approval (R-4, locked).",
      "Retraction from the NOT EXISTS predicate alone, with no operator list. A cache miss could widen the set; intersecting with the list keeps it shrink-only.",
      "Clamping the formula composite at fundsignal_loop.py:586. It silently changes formula semantics, and the gate reads the absolute scale only in degenerate sets; the synthesis uses a documented contract plus a range test instead.",
      "In-place `optional double conviction = 4` as the primary branch behind a step-0 buf gamble. PROTO-7 (packages/proto/docs/context-constitution.md:25) records the implicit-to-optional conversion as buf-breaking and names the plain-double plus sibling-flag shape as the established pattern, so the additive field 12 is the design.",
      "Deriving degeneracy from the _quantile cut indices (no constant). At the 0.80/0.20 defaults it flags only n<=3, which under-covers the report's 2-4 symbol collapse range."
    ],
    "open_risks": [
      "The degenerate-only gate leaves an n=5 cliff, where a set of all-weak distinct scores still yields a quantile buy. The operator's O-3 choice decides this.",
      "The legacy in-band rule `conviction != 0.0` in the presence predicate keeps a sentinel. A pre-flag client that sends a deliberate 0.0 still reads as not-given (0.5) until it sets conviction_provided.",
      "One-time dedup miss after deploy: an explicit 0.0 resubmit is now stored as 0, which IS DISTINCT FROM a legacy NULL inside dedup_window_hours.",
      "The retraction cutoff (2026-10-31T00:00:00Z) is sourced from 246/feature.md:30 and was not independently verified against deploy logs.",
      "EDGAR's source-aware self-heal could overwrite a fundamentals row with nulls. The operator-list intersection bounds this.",
      "The migration number may collide with feature 318 (both are ingest migrations); it is re-derived at spec time.",
      "Stored wrong-direction buy rows remain active up to valid_days (90) if the operator chooses natural expiry under O-14.",
      "TS UI consumers of ExternalSignal.conviction: the proposer's grep found none, but there is no test pinning this."
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
    "rationale": "I checked the adversary's two load-bearing claims in the repo.\n\n- PROTO-7 (packages/proto/docs/context-constitution.md:25) does say that the marketdata.Fundamentals metrics deliberately did NOT go `optional` because of the buf-breaking and approval cost. It names the plain-double plus sibling-flag shape as the established pattern. So the in-place optional is the branch expected to fail. Adopting field 12 as the design stays inside D-3 (additive field, never breaking-v1) and avoids a step-0 gamble.\n- I verified that field 12 is free on ExternalSignal: its fields end at user_id=11, and the other `= 12` hits in the file belong to other messages.\n- `_emit_signal` (fundsignal_loop.py:654-658) builds `ExternalSignal(conviction=float(conviction))`, and the QuerySignals builder (servicer.py:1297-1302) writes 0.0 for NULL. So under a sibling flag, both must set conviction_provided, or the report-3 producer path stays broken. That gap is now concrete in the approach (O-9).\n\nO-2 is closed because the design no longer depends on an unverified buf verdict.\n\nO-1, O-6, O-7 and O-8 are closed: the adversary judged them substantively addressed, with the to_regclass precedent, D-4, the provisional number, the harness fixture, the rerun no-op, and the sourced cutoff. O-12 refines the fixture so the guard cannot pass vacuously.\n\nO-4 is closed with a documented contract and a range test. The adversary accepted the no-clamp reasoning, since the gate reads the absolute scale only in degenerate sets.\n\nO-5 is closed, with PROTO-7 added to the doc list.\n\nO-3 stays blocking, because the gate shape is a product-semantics choice only the operator can make. Degenerate-only is the less disruptive recommendation.\n\nThe adversary's other points become non-blocking new objections (O-10 to O-14). The C-16 CHANGEs remain uncovered because no operator decision is recorded.\n\nRegister check: the approach honors D-1 to D-6. The fixed constant _MIN_CROSS_SECTION is not R-2 (which locked a config-seeded key). No R-n is reintroduced and no closed O-n is re-raised. Neither side filed a REOPEN, and the operator reopens nothing.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Conviction presence uses an additive `bool conviction_provided = 12` on ExternalSignal as the design (not a fallback). Field 4 stays plain `double`. The presence predicate is `conviction_provided or conviction != 0.0`.",
          "evidence": "packages/proto/docs/context-constitution.md:25 (PROTO-7: optional conversion is buf-breaking; the sibling-flag pattern is established); ExternalSignal fields end at user_id=11 (ingest.proto); consistent with D-3"
        },
        {
          "text": "Every ExternalSignal producer that sets conviction also sets conviction_provided=True: agent client.py:255, ingest mcp_client_loop.py:94, analysis fundsignal_loop.py:658. QuerySignals (ingest servicer.py:1297-1302) sets conviction_provided=True for non-NULL rows and leaves both fields unset for NULL rows.",
          "evidence": "fundsignal_loop.py:654-658 builds conviction=float(conviction); servicer.py:1302 writes 0.0 for NULL; adversary r2"
        },
        {
          "text": "Cross-section degeneracy is counted over the folded set (scores ∪ reference_scores), whichever gate shape the operator picks.",
          "evidence": "fundsignal_loop.py:278-279, :597; fails.md fix-fundsignal-emit-accounting; agreed by both sides r2"
        },
        {
          "text": "Scorer scale contract: a system scoring composite is in [0,1] with 0.5 neutral. It is documented in analysis CLAUDE.md next to scoring_formula_id and pinned by a range test on value_quality and _builtin_score; there is no clamp.",
          "evidence": "fundsignal_loop.py:550, :586; proposer r2, accepted by adversary r2"
        },
        {
          "text": "The retraction migration is to_regclass-guarded and bounded by ingested_at < '2026-10-31T00:00:00Z' (the feature-246 production launch).",
          "evidence": "ingest/migrations/013_signal_ownership_templates.up.sql:101-104; docs/roadmap/features/246-fix-fundsignal-neutral-score/feature.md:30"
        }
      ],
      "new_rejected": [
        {
          "text": "In-place `optional double conviction = 4` as the primary branch behind a step-0 buf check",
          "why": "PROTO-7 records the implicit-to-optional conversion as buf-breaking and names the sibling flag as the pattern; an expected-to-fail proto PR is churn."
        },
        {
          "text": "Deriving degeneracy only from the _quantile cut indices, with no size constant",
          "why": "At the 0.80/0.20 defaults it flags only n<=3, which under-covers the report's 2-4 symbol collapse range."
        }
      ],
      "new_objections": [
        {
          "text": "O-9 [C-09/P-03] Under conviction_provided, fundsignal_loop.py:658 and the QuerySignals read-back (servicer.py:1297-1302) must also carry presence, and a producer-path RED test must show a 0.0 score reads back as 0.0.",
          "blocking": false
        },
        {
          "text": "O-10 [C-18/F-07-adjacent] _MIN_CROSS_SECTION=5 is coupled to the default quantiles, which are live config. Document the coupling and pin it with a default-quantile test.",
          "blocking": false
        },
        {
          "text": "O-11 [P-03] A budget-deferred day can mix absolute-gate and quantile labels. Record this as an accepted residual in design.md.",
          "blocking": false
        },
        {
          "text": "O-12 [C-07] The migration fixture must create marketdata.fundamentals with retract and survive rows so the to_regclass guard cannot pass vacuously. The migration must RAISE NOTICE with the updated count.",
          "blocking": false
        },
        {
          "text": "O-13 [C-16] The 246 @AC-3, 201 @AC-8 and 201 @AC-4 CHANGEs need operator sign-off in context.md before /sdd-spec.",
          "blocking": false
        },
        {
          "text": "O-14 [How-to-Act #1/P-03] Stored wrong-direction buy rows from degenerate days are in no scope. The operator chooses natural expiry or a targeted retraction.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-1",
          "how": "Recon corrected (D-2). The cross-schema read is to_regclass-guarded per the 013 precedent, the in-database NOT EXISTS leg is intersected with the frozen operator list, and the marketdata owner acknowledges the read in the PR. The adversary judged it substantively addressed in r2."
        },
        {
          "id": "O-2",
          "how": "The design now uses the additive field conviction_provided=12, which is buf-safe by construction, based on the PROTO-7 record. The CI proto-lint buf breaking verdict is still recorded in context.md."
        },
        {
          "id": "O-4",
          "how": "The [0,1], 0.5-neutral composite contract is documented in analysis CLAUDE.md and pinned by a range test on value_quality and _builtin_score; no clamp. Accepted by the adversary in r2."
        },
        {
          "id": "O-5",
          "how": "All doc surfaces are listed (proto comment, INGEST-4, tools.py, mcp-tools.md:251, signal_extraction.md, the strat-lab skill, analysis CLAUDE.md, the 201 @AC-4 comment) plus the PROTO-7 entry. The mcp_client_loop.py:94 explicit-0.0 path is tested next to mcp-client-signal-source.feature:34."
        },
        {
          "id": "O-6",
          "how": "D-4 adopted: real ingest_pb2.ExternalSignal in the tests; AC-3 is screener-only."
        },
        {
          "id": "O-7",
          "how": "The number is provisional and re-derived at spec time, fixtures live only in scripts/migration-assertions, a rerun is a no-op via the valid_until > now() guard, and the down file is a stub (D-5). The fixture-content refinement moves to O-12."
        },
        {
          "id": "O-8",
          "how": "Source is scoped to system derived slugs from ingest.signal_sources, and the cutoff is ingested_at < 2026-10-31T00:00:00Z, sourced from 246/feature.md:30."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-13 — sdd-batch design gate (round 3)

- `/sdd-design fix-fundsignal-scoring-correctness` (full) ran round 3 and is halted at the approval gate (gate policy: halt). Per the grilling protocol, design.md is NOT written and status.md is unchanged (`spec-ready`). Register: `debate.md` now holds D-1..D-14, R-1..R-8 and O-1..O-18. O-9, O-11 and O-12 closed in round 3.

## Open Threads (round 3)

- **Approach (round-3 synthesis).** The build order is unchanged: (0) proto, (1) formula input, (2) direction, (3) conviction presence, (4) retraction migration. There is no indicators code change and no new config key. The spec must re-baseline every line reference, because several have moved since recon.
  - (1) Formula input (D-1): `_score_via_formula` (`fundsignal_loop.py:571-581`) builds its input only from keys not in `missing_metrics`. An empty input dict means the symbol is `unscored`, which replaces the `issuperset` test at :579.
  - (2) Direction: a degenerate-only side gate, still pending O-3.
    - In `_map_directions` (:591-608), `ordered` and both `_quantile` cuts stay byte-identical (D-9).
    - `degenerate = len(ordered) < _MIN_CROSS_SECTION or buy_cut <= sell_cut`.
    - `_NEUTRAL_SCORE = 0.5` and `_MIN_CROSS_SECTION = 5` are both NEW fixed module constants, not config (D-6, D-14).
    - When degenerate, `buy` needs `s > 0.5` and `sell` needs `s < 0.5`.
    - 260 @AC-9 is preserved (AAPL `sell`). The untagged lone-0.10 test at :1370 flips from `buy` to `sell`.
    - O-10 calibration is now a property test: at 0.80/0.20, every n in 5..50 has a non-empty hold band and a buy share of at most 40%, n=4 violates that, and n=2..4 take the degenerate branch. The coupling to the live quantile keys is documented in analysis CLAUDE.md.
    - The [0,1] scorer contract with 0.5 neutral is pinned by a range test, with no clamp (D-10).
  - (3) Conviction presence: additive `bool conviction_provided = 12` (D-7).
    - Exactly four non-test producers set it: agent `client.py:248-255`, ingest `mcp_client_loop.py:90-94`, analysis `_emit_signal` at `fundsignal_loop.py:654-658`, and ingest QuerySignals at `servicer.py:1343-1352`, for non-NULL rows only.
    - Write and score both use `conviction_provided or conviction != 0.0`. Legacy NULL rows keep their 0.5 weight (R-1).
    - Tests use a real proto at each seam: emit → ingest store/QuerySignals → `compute_signal_score`, plus mcp_client explicit 0.0.
    - O-16: rebuild the MagicMock `_make_signal` on a real `ExternalSignal`, keep `test_zero_conviction_uses_default_half` as the not-given→0.5 pin, and add an explicit-0.0 sibling.
    - O-17 (default: accept): the deploy-boundary dedup duplicate is an accepted residual, bounded by `signals.dedup_window_hours`. A 0 is never treated as NULL in the upsert (R-8).
  - (4) Retraction: a `to_regclass`-guarded ingest data migration, provisionally 017 and re-derived at spec time after feature 318.
    - The predicate is unchanged (D-11). The migration adds `GET DIAGNOSTICS` + `RAISE NOTICE`.
    - The fixture follows `BEGIN … \ir … ROLLBACK`: it INSERTs fundamentals rows and includes a RENAME scenario that proves the guard (D-13).
    - The PR amends `docs/patterns/database.md:21-22` and root CLAUDE.md § Database for a second migration-time cross-schema read, acknowledged by the DBA and the marketdata owner (D-12).
    - O-18: a per-environment post-deploy check compares the NOTICE count with the frozen-list SELECT and confirms no matching row is still active.
    - O-15 (default: accept): opportunity lag of about 24h or less, with no triggered recompute.
    - O-14 (default: natural expiry): stored wrong-direction `buy` rows are left to expire after `valid_days`.
- **Strongest open objection: O-3 (blocking).** The operator must choose the direction-gate shape:
  - degenerate-only with the 0.5 side tie-break (current best). Its degenerate hold band is only `s == 0.5`, and an n≥5 all-weak cross-section still labels its top quantile `buy`;
  - variant (i), an always-on side gate. It relabels every day (062 FR-6) and adds first-deploy dedup overlap;
  - variant (ii), absolute `buy_quantile`/`sell_quantile` score cuts in the degenerate branch. This gives a real hold band but overloads one live key with two meanings.
- **Floor status:** no Floor breaches.
- **Uncovered @AC changes (C-16), not yet covered by an operator decision:**
  - CHANGE: `@AC-3 @feature-246`, `@AC-8 @feature-201` and `@AC-4 @feature-201` (O-13).
  - EXTEND: the `mcp-client-signal-source.feature:34` round-trip and 309 @AC-1..@AC-4.
  - PRESERVE: 246 @AC-1/@AC-2 and 260 @AC-8/@AC-9.
- **Other open objections (non-blocking):** O-10 (the proposer adopts the property test), O-13, O-14, O-15, O-16, O-17 and O-18.
- **Operator sign-offs needed here before /sdd-spec:** the O-3 gate shape (including variant ii), the O-13 C-16 CHANGEs, O-14 (natural expiry or targeted retraction), and O-15 (accept the lag or trigger a recompute).

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
