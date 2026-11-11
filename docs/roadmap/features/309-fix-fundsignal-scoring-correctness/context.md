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
