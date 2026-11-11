# Context Log: fix-analysis-evidence-dry

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect reports (Issues disabled; clustered triage):
  - docs/reports/2026-10-19-analysis-fingerprint-ignores-formula-version-defect.md — Evidence fingerprint ignores referenced formula content (SEV-3)
  - docs/reports/2026-10-19-analysis-live-gate-sql-duplicated-defect.md — Entry-backfill re-types the live-enabled gate SQL instead of importing it (SEV-3)
- Cluster rationale: both are analysis single-source-of-truth gaps on the strategy evidence/live path (ANALYSIS-3 fingerprint input, ANALYSIS-7 live gate).
- Severity: SEV-3 (highest across reports)
- Routed to SDD path (Track C)
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..AC-2), context.md; stamped both report sidecars `triaged`
- Affected services (from reports): xstockstrat-analysis, xstockstrat-indicators
- Root cause hypothesis: formula content lives in indicators, outside the hashed `definition_json`; gate literal duplicated, likely to dodge an import cycle via `servicer.py`
- Open questions: invalidate vs re-fingerprint; one-time fingerprint shift on rollout (product-spec § Open Questions)
- Recommended design depth: full → `/sdd-design fix-analysis-evidence-dry` (rationale: SEV-3, but ≥2 affected services — analysis + indicators — rubric escalate signal)
- Development branch: feature/fix-analysis-evidence-dry

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags); AC-2 partly implementation-flavoured but behaviourally verifiable; two OQs deferred; first review FAILed crit 8 + 11 (fixed)
- Overlap findings: none (CLEAN)
- Recommended design depth: full (analysis + indicators)
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)

## Session 2026-11-11 — sdd-batch design gate (round 2)

/sdd-design fix-analysis-evidence-dry (full) halted at its approval gate after round 2 (gate policy: halt). Per the grilling protocol, design.md is NOT written and status.md stays `spec-ready`. The debate register is in `debate.md` (D-1..D-8, R-1..R-5, O-1..O-16).

## Open Threads

- **Approach (round-2 synthesis).** D-1..D-4 stand and R-1..R-3 are honoured.
  - AC-2: `entry_backfill.run_once` reads live strategies through `StrategiesRepository(db_pool).list_live_enabled()`, keeping its try/except → warning → return (entry_backfill.py:63-69). Red-first tests capture the SQL and monkeypatch `app.repositories.strategies.LIVE_ENABLED_PREDICATE_SQL`.
  - AC-1: a pure `_formula_digest` (D-5 field classification, pinned by a descriptor-walk test over FormulaDefinition/FormulaParameter/FormulaOutput, with `author` pinned as DISPLAY) and `_evidence_fingerprint`, which is byte-identical to `_definition_fingerprint` when there are no CUSTOM_FORMULA components (D-2). Digests come from the existing single formula read via a `digests` out-param, and the per-owner cache value becomes `_FormulaRead(metrics, digest)` across every owner: :1930, :2807, :2906, :3092-3100, :5059 and :5634 (D-6).
  - `_run_backtest` computes run_fingerprint after the formula-map build (:986-999). An outage or a backtest-time refusal gives run_fingerprint=None plus the run warning "evidence not recorded: formula version unavailable — rerun" at :1336 (D-7). A run-level `_FormulaRead` cache is seeded into the `_recompute_headline` call (:1409-1415).
  - `_fetch_and_aggregate` (:2859-2907) reads digests on both the guarded and unguarded paths. An outage raises `_FormulaVersionUnknown(_GradeInputsUnknown)` before any cell read (D-8). With the gate on, the message stays the @AC-23-pinned "fundamentals availability unknown — grade unchanged"; with the gate off it is "formula version unavailable — grade unchanged", pending sign-off. The spec must enumerate all four callers: ScoreStrategy :2647, RunBacktest :1409, boot :3096 and ManageStrategy UPDATE :3391.
  - Readiness callers are untouched (D-3). No migration (D-4).
  - Build order: AC-2 → digest/fingerprint helpers → digests threading + `_FormulaRead` → `_run_backtest` → `_fetch_and_aggregate` + UPDATE handling → owner-isolation test → (only after sign-off) @AC-23 amendment, new gate-off scenario, CLAUDE.md bullet, docs (ANALYSIS-3/ANALYSIS-7, docs/scoring.md, known limitations).
- **Strongest open objection: O-1 (blocking, C-16).** A score-time refusal yields the "unreadable" digest, which clears the grade (NOT_FOUND "no eligible evidence — run a backtest"). @AC-23 @feature-289 says it should succeed with x-score-excluded-symbols "[]". No operator sign-off is recorded. The sign-off package must state the blast radius:
  - all four recompute paths, including RunBacktest :2943-2949, which also deletes the DB row;
  - both gate states;
  - the post-feature-224 population of strategies referencing another author's formerly-public formula.
  It is bundled with **O-9 (blocking, C-16/P-03)**: the new gate-off coupling, under which an indicators outage aborts gate-off grading for every CUSTOM_FORMULA strategy. If the operator refuses, the fallbacks are the composite `<def_hash>.<formula_hash>` prefix fingerprint or analysis migration 028 (per-cell digest, needs DBA approval).
- **Non-blocking objections still open:** O-4, O-8 and O-10 to O-16 (run-level cache seed, all four callers, all cache owners, backtest-time refusal → NULL, `_FormulaVersionUnknown`, warning at :1336, `author` DISPLAY pin). The round-2 synthesis adopts every one of them; they close once design.md records them.
- **Floor status:** no breach. There is no proto, migration, config literal, pool change, or new owner-agnostic read.
- **Uncovered @AC changes (need operator decision):**
  - `@AC-23 @feature-289`: CHANGE, not covered.
  - The `@feature-289/@feature-215` gate-off behaviour (no durable scenario; services/xstockstrat-analysis/CLAUDE.md § Fundamentals availability guard says "Gate OFF is unchanged"): CHANGE, not covered.
  - Preserved: @AC-2 @feature-194, @AC-6 @feature-152, @AC-11 @feature-215, @AC-4/@AC-6 @feature-262. Extended: 327 @AC-1, @AC-2.
- **Resume:** the next /sdd-batch run resumes the debate from the state block below. Approval needs the operator's O-1 + O-9 decision recorded in this context.md.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Round-2 synthesis for 327-fix-analysis-evidence-dry. D-1..D-4 stand and R-1..R-3 are honoured. Approval is blocked on one operator decision package (O-1 plus the new gate-off coupling). Every code claim the adversary made was checked: servicer.py:1405-1420 (the RunBacktest recompute passes no formula_cache), :3385-3397 (UPDATE pops before the recompute and swallows the error), and :5059/:5634 (dict[str, list] formula_fund_cache owners).\n\nAC-2 (D-1, unchanged):\n- entry_backfill.run_once does `rows = await StrategiesRepository(db_pool).list_live_enabled()`, keeping the try/except → warning → return at entry_backfill.py:63-69.\n- Red-first tests in tests/test_entry_backfill.py: capture the SQL, and monkeypatch app.repositories.strategies.LIVE_ENABLED_PREDICATE_SQL to a narrowed predicate so nothing is selected.\n\nAC-1 (formula-aware evidence fingerprint, evidence sites only per D-3, no migration per D-4):\n\n1. `_formula_digest(formula)`, a pure function beside `_definition_fingerprint` (servicer.py:7285).\n   - Hashes sha256 over MessageToDict(preserving_proto_field_name=True) with defaults omitted and sorted keys, repeated-field order kept.\n   - BEHAVIOURAL fields: source, input_schema, warmup_period, fundamental_inputs; parameters[] minus description (FormulaParameter.description=4, keeps optional min/max presence); outputs[] name only.\n   - DISPLAY fields: name, description, author, created_at, updated_at (R-1), is_public, deleted, origin, formula_id.\n   - `author` must stay DISPLAY because the legacy_authors repair rewrites it.\n   - Descriptor-walk test over FormulaDefinition, FormulaParameter and FormulaOutput asserts BEHAVIOURAL ∪ DISPLAY == {f.name for f in DESCRIPTOR.fields}.\n   - Pin tests: changing a description or author does not move the digest; changing the source does.\n\n2. `_evidence_fingerprint(definition_json, digests)`.\n   - Empty digests → byte-identical to `_definition_fingerprint` (D-2).\n   - Otherwise sha256(def_hash + \"|\" + sorted \"fid=digest\").\n\n3. Single read, digests out-param on the existing helpers.\n   - Helpers: `_declared_formula_warmup` (:2525-2564), passed through `_prefetch_formula_warmups` (:2566), and `_formula_fundamentals` (:1914-1947).\n   - Success writes `digests[fid]`. Outage writes nothing and records failures[(\"formula\",fid)]=UNKNOWN as today. At score time a refusal writes \"unreadable\" (see 6).\n   - Cache value becomes `_FormulaRead(metrics, digest)`. Every owner must be updated, not only :1930/:2807:\n     - :2906 local default;\n     - :3092-3100 per-owner boot cache;\n     - :5059 heal and :5634 opportunities, whose `dict[str, list]` annotations change;\n     - first grep tests/ for any assertion that the cache holds lists.\n   - Answers O-4 and O-8 only together with step 4b.\n\n4. `_run_backtest`.\n   - (a) Remove :918-924 and compute run_fingerprint after the formula-map build (:986-999), before the symbol loop, under the existing own-definition guard.\n   - If any CUSTOM_FORMULA fid has no real digest, set run_fingerprint=None. That covers an outage and, as adopted from the adversary, a refusal at backtest time, so no cell is ever stamped with the \"unreadable\" sentinel.\n   - Append the run warning \"evidence not recorded: formula version unavailable — rerun\" next to the other formula warnings at :1336 (result.warnings.extend(formula_deleted_cache.values())), not into sector_warnings.\n   - (b) Seed a run-level formula_cache from the run's own read: {fid: _FormulaRead(formula_fund_map.get(fid, []), digests.get(fid))}. Pass it into the `_recompute_headline` call at :1409-1415 so OK runs make no second GetFormula. Otherwise Key Decision 1 and Touchpoints must say +1 GetFormula per formula per recompute.\n\n5. `_fetch_and_aggregate` (:2859-2907).\n   - When the definition has CUSTOM_FORMULA components, call `_formula_fundamentals(definition, meta or owner_metadata(user_id), cache=…, failures=…, digests=…)` first. Do this on both the guarded and the unguarded path, binding the local defaults once and reusing them for `_exclude_refused_cells` (:2906-2907).\n   - A missing digest (outage) raises a new subclass `_FormulaVersionUnknown(_GradeInputsUnknown)` that carries formula_id, so the :2655 log does not print a fid as a symbol. It is raised before any cell read, and existing except sites still catch it.\n   - Gate on: ScoreStrategy keeps the @AC-23-pinned UNAVAILABLE \"fundamentals availability unknown — grade unchanged\" (:2654-2659).\n   - Gate off: a distinct message, \"formula version unavailable — grade unchanged\", pending operator sign-off (new objection).\n   - Callers to enumerate in the spec, all four:\n     - ScoreStrategy :2647;\n     - RunBacktest :1409 → :2942 (already catches _GradeInputsUnknown at :1416);\n     - boot :3096 (logs per pair :3104-3105);\n     - ManageStrategy UPDATE :3391.\n   - UPDATE already pops the in-memory grade before recompute by design (:3388). An outage there leaves no headline until the next recompute or restart; the DB row stays. Record that as a known limitation, or catch the subclass and restore the popped score.\n   - Readiness callers :4011/:4208/:4294/:5267/:6107 are untouched (D-3, R-2).\n\n6. Refusal at score time (unresolved, operator decision).\n   - The \"unreadable\" digest at score time matches no cell, so the grade clears and ScoreStrategy returns NOT_FOUND \"no eligible evidence — run a backtest\" (:2665-2686).\n   - This is a C-16 CHANGE to @AC-23 @feature-289. The sign-off package must state the full blast radius:\n     - all four recompute paths clear the grade (RunBacktest :1409 → :2943-2949 also deletes the DB row; UPDATE :3391; boot :3096; ScoreStrategy);\n     - it applies whether the gate is on or off;\n     - the real affected population is post-feature-224 (migration 007) strategies referencing a formerly-public formula another user authored, which are NOT_FOUND for their owner.\n   - Deliverables, only after sign-off is recorded in context.md:\n     - amend block-fundamentals-strategy-on-etf.feature:97-102;\n     - add a gate-off scenario beside it;\n     - amend the services/xstockstrat-analysis/CLAUDE.md § Fundamentals availability guard feature-289 bullet (\"Gate OFF is unchanged\").\n   - Fallbacks if the operator refuses:\n     - composite `<def_hash>.<formula_hash>` fingerprint with a newest-stamped-suffix prefix query on refusal (keeps @AC-23, no migration, two fingerprint shapes in one column);\n     - per-cell digest storage (analysis migration 028 plus DBA approval).\n\n7. Docs.\n   - Rewrite ANALYSIS-3 and ANALYSIS-7 (services/xstockstrat-analysis/docs/context-constitution.md:19,23) and docs/scoring.md.\n   - Known limitations:\n     - readiness keeps the pre-edit verdict until valid_until (24h default, 1h floor, readiness.py:31-35) or the next bar;\n     - the ListStrategies/GetStrategyReport headline (:3115-3122) stays stale until the next recompute;\n     - an UPDATE outage leaves no in-memory headline (if not restored).\n   - Consumer Surface reworded to: \"after a referenced formula is edited, the next ScoreStrategy/RunBacktest recompute stops counting pre-edit evidence\".\n   - context.md records OQ1/OQ2 (D-4).\n\nBuild order:\n1. AC-2 swap plus tests.\n2. `_formula_digest`/`_evidence_fingerprint` plus the descriptor-walk, description/author/source pins and byte-identity tests.\n3. digests threading plus `_FormulaRead` across all four cache owners.\n4. `_run_backtest` relocation, NULL-on-outage-or-refusal, the :1336 warning, and the run-level cache seed.\n5. `_fetch_and_aggregate` digest, `_FormulaVersionUnknown`, gate-on/gate-off message tests, and UPDATE-path handling.\n6. Owner-isolation test through formula_caches.setdefault(user_id, {}) (:3092-3100): owner A's refusal is \"unreadable\" while owner B's digest is real.\n7. Only after operator sign-off: the @AC-23 amendment, the new gate-off scenario and the CLAUDE.md bullet, then docs.",
    "open_objections": [
      {
        "text": "O-1 [C-16] The score-time refusal clears the grade instead of succeeding with x-score-excluded-symbols \"[]\" (@AC-23 @feature-289), and no operator sign-off is recorded. The sign-off package must cover the full blast radius: all four recompute paths (ScoreStrategy :2647; RunBacktest :1409 → :2943-2949, which also deletes the DB row; ManageStrategy UPDATE :3391; boot :3096), both gate states, and the post-feature-224 population of strategies that reference another author's formerly-public formula. Deliverables after sign-off: the amended scenario at block-fundamentals-strategy-on-etf.feature:97-102, a new gate-off scenario, and the amended CLAUDE.md 'Gate OFF is unchanged' bullet. If the operator refuses, use the composite-prefix fingerprint or migration 028.",
        "blocking": true
      },
      {
        "text": "[C-16/P-03] New gate-off availability coupling. Today the unguarded _fetch_and_aggregate path (servicer.py:2889-2895) never calls GetFormula. After the change, an indicators outage aborts grade derivation for every CUSTOM_FORMULA strategy even with the fundamentals gate off, contradicting feature 215/289's 'gate off: nothing below happens'. This must go into the same operator sign-off as O-1, with a distinct gate-off message ('formula version unavailable — grade unchanged'); the @AC-23-pinned message stays on the gate-on branch.",
        "blocking": true
      },
      {
        "text": "O-4/O-8 are not fully closed. The RunBacktest recompute at servicer.py:1409-1415 passes no formula_cache, so on every OK run _fetch_and_aggregate issues a second GetFormula per formula. Either seed a run-level formula_cache of _FormulaRead values from the run's own read and pass it through, or correct the 'no extra RPC' claim in Key Decisions and Touchpoints.",
        "blocking": false
      },
      {
        "text": "[fails.md:2659] The proposal's list of _fetch_and_aggregate callers is incomplete. It misses ManageStrategy UPDATE (:3391), which pops self._strategies before the recompute (:3388) and swallows errors, so a newly possible outage leaves ListStrategies/GetStrategyReport with no headline until the next recompute or restart. List all four callers and either catch the outage subclass and restore the popped score, or record this as a known limitation.",
        "blocking": false
      },
      {
        "text": "[C-18/P-03] The _FormulaRead value-type change has more cache owners than the proposal names (:1930/:2807). Also affected: the :2906 local default, :3092-3100 boot per-owner, and :5059 (heal) and :5634 (opportunities), whose dict[str, list] annotations must change. Grep tests/ for assertions on cache contents before changing the type.",
        "blocking": false
      },
      {
        "text": "A refusal at backtest time must not stamp a matchable fingerprint. With the 'unreadable' digest, cells written while the formula is refused would match the score-time fingerprint and count. Treat a backtest-time refusal like an outage (run_fingerprint=None plus the run warning); use 'unreadable' only at score time.",
        "blocking": false
      },
      {
        "text": "[C-18] Raising _GradeInputsUnknown(fid) puts a formula id in the symbol field (:279-281), so the :2655 log prints it as a symbol. Add a _FormulaVersionUnknown(_GradeInputsUnknown) subclass that carries formula_id; it also lets the gate-on and gate-off messages branch.",
        "blocking": false
      },
      {
        "text": "[C-18] The O-5 run warning belongs with the formula warnings at :1336 (result.warnings.extend(formula_deleted_cache.values())), not in sector_warnings (:1039).",
        "blocking": false
      },
      {
        "text": "Pin `author` as DISPLAY with a test (changing author must not move the digest). The legacy_authors repair rewrites author, so classifying it as BEHAVIOURAL would reset every repaired formula's evidence.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-23 @feature-289",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@feature-289/@feature-215 gate-off behaviour (no durable scenario; services/xstockstrat-analysis/CLAUDE.md § Fundamentals availability guard 'Gate OFF is unchanged')",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 @feature-194",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-6 @feature-152",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-11 @feature-215",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4 @feature-262",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-6 @feature-262",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-1 (327)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2 (327)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Hash FormulaDefinition.updated_at into the fingerprint (R-1): the seed upsert churns it on every indicators boot.",
      "Make all 7 _definition_fingerprint callers formula-aware (R-2): blast radius, including an async resolver in the sync :4294 caller.",
      "Name-bound import of LIVE_ENABLED_PREDICATE_SQL (R-3): it freezes the value at import and defeats the monkeypatch test.",
      "A separate GetFormula digest resolver: it breaks the single-fetch contract (:970-977) and can disagree with the warmup prefetch. Superseded by the digests out-param on the existing helpers.",
      "Leave refused formulas out of the digest, so the fingerprint equals the definition-only hash: pre-feature cells become eligible again whenever the formula is refused, a worse blind spot than today.",
      "Put the 'unreadable' digest into backtest-time stamps: while the formula stays refused, cells stamped during refusal would match and count. Refusal at backtest time gives NULL instead.",
      "Append the formula-version warning into sector_warnings: it couples unrelated concerns. Use the :1336 formula-warning site.",
      "Reuse the @AC-23-pinned 'fundamentals availability unknown' message for gate-off formula outages: it misleads consumers about strategies with no fundamentals. A distinct gate-off message is used.",
      "Per-cell digest storage (migration 028), held only as the fallback if the CHANGE is refused: it needs DBA approval and a backfill question, which is too much for SEV-3.",
      "Composite-prefix fingerprint (<def_hash>.<formula_hash> plus a newest-suffix query), held only as the fallback if the CHANGE is refused: two fingerprint shapes in one column (C-18) and a new repository query."
    ],
    "open_risks": [
      "The operator may refuse the @AC-23 CHANGE and/or the gate-off coupling. Build steps 5-7 would then be redesigned around the composite-prefix fingerprint or migration 028.",
      "One-time evidence reset for every existing CUSTOM_FORMULA strategy (OQ2) and grade loss for post-feature-224 strategies that reference another author's formerly-public formula; this must be communicated.",
      "Field-classification drift in FormulaDefinition/FormulaParameter/FormulaOutput is mitigated only if the descriptor-walk test fails on any unclassified field.",
      "Changing the _FormulaRead value type across four cache owners (:2906, :3092, :5059, :5634) risks regressions in the heal and opportunities paths if any reader still expects a list.",
      "An indicators outage now affects gate-off ScoreStrategy and all recompute paths. On the UPDATE path the in-memory headline stays absent until the next recompute or restart.",
      "Readiness and the ListStrategies/GetStrategyReport headline keep serving pre-edit verdicts until valid_until, the next bar, or the next recompute (a documented limitation).",
      "recompute_unscored_pairs shares one failures dict across owners (:3093). Owner isolation of digests rests on the per-owner formula cache, so the isolation test is load-bearing."
    ],
    "constitution_rules_touched": [
      "C-10",
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-03"
    ],
    "rationale": "The proposal answers the round-1 correctness objections concretely.\n- O-2: a score-time outage now raises a _GradeInputsUnknown-family error before any cell read, keeping the pinned gate-on message.\n- O-3: nested descriptions are stripped and the descriptor-walk test pins the classification.\n- O-5: a NULL fingerprint plus a run warning replaces silent loss.\n- O-6/O-7: the readiness and headline limitations are recorded and the Consumer Surface is reworded.\nThe adversary confirmed each of these against the code, so those objections close.\n\nI checked the adversary's new code claims myself and they hold:\n- servicer.py:1409-1415 passes no formula_cache, so the 'no extra RPC' claim is false for the RunBacktest recompute.\n- :3388-3395 pops the in-memory grade before an exception-swallowing recompute.\n- :5059/:5634 are additional dict[str, list] owners of formula_fund_cache.\nThe synthesis adopts the run-level cache seed, the full caller list, the full cache-owner list, the backtest-time refusal → NULL fix (it closes a real hole where 'unreadable'-stamped cells could count), the _FormulaVersionUnknown subclass, and moving the warning to :1336.\n\nThe remaining blocker is governance, not design. O-1's refusal CHANGE is honestly declared now, but it lacks operator sign-off and the package must state its full blast radius. Extending the digest read to the unguarded path also creates a second unsigned C-16 change: an indicators outage now affects gate-off grading. Both go to the operator together.\n\nNo proto, migration, config literal, pool change or new owner-agnostic read is introduced, so there is no Floor breach. The register is honoured: no D-n is contradicted, no R-n is reintroduced, and no petitions or reopens were filed.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Digest field classification: BEHAVIOURAL = source, input_schema, warmup_period, fundamental_inputs, parameters[] minus description (min/max presence kept), outputs[] name only. DISPLAY = name, description, author, created_at, updated_at, is_public, deleted, origin, formula_id. Canonical JSON uses defaults omitted, sorted keys and preserved repeated order. A descriptor-walk test asserts BEHAVIOURAL ∪ DISPLAY covers every field of FormulaDefinition, FormulaParameter and FormulaOutput.",
          "evidence": "indicators.proto:118-136,162-182; proposer r2 step 1 plus adversary r2 confirmation (author must stay DISPLAY because of the legacy_authors repair)"
        },
        {
          "text": "Digests come from the existing single formula read: a digests out-param on _declared_formula_warmup, _prefetch_formula_warmups and _formula_fundamentals, with the per-owner cache value changed to _FormulaRead(metrics, digest). No separate GetFormula resolver.",
          "evidence": "servicer.py:1914-1947,2525-2566,1930,3092-3100; proposer r2 step 3, adversary r2 accepted the shape"
        },
        {
          "text": "In _run_backtest, run_fingerprint is computed after the formula-map build (:986-999). A missing digest gives run_fingerprint=None plus the run warning 'evidence not recorded: formula version unavailable — rerun'.",
          "evidence": "servicer.py:918-924,986-999,1371,1341-1342; proposer r2 step 4, adversary r2 confirmed (placement nit only)"
        },
        {
          "text": "At score time, an outage on a referenced formula raises a _GradeInputsUnknown-family error before any cell read. On the gate-on path ScoreStrategy keeps the pinned UNAVAILABLE 'fundamentals availability unknown — grade unchanged'.",
          "evidence": "servicer.py:2654-2659; block-fundamentals-strategy-on-etf.feature:102; proposer r2 step 4, adversary r2 'addressed for the gate-on case'"
        }
      ],
      "new_rejected": [
        {
          "text": "Separate GetFormula digest resolver alongside the warmup prefetch",
          "why": "It breaks the single-fetch contract (servicer.py:970-977) and lets warmup (0 on an outage) and the fingerprint disagree; superseded by the digests out-param"
        },
        {
          "text": "Leave refused formulas out of the digest (fingerprint falls back to the definition-only hash)",
          "why": "Pre-feature cells carrying the definition-only hash become eligible again whenever the formula is refused, a worse blind spot than today; it also does not preserve @AC-23"
        }
      ],
      "new_objections": [
        {
          "text": "[C-16/P-03] Gate-off availability coupling: the digest read on the unguarded _fetch_and_aggregate path (servicer.py:2889-2895) makes an indicators outage abort grade derivation for every CUSTOM_FORMULA strategy with the gate off, contradicting feature 215/289 'gate off unchanged'. It needs operator sign-off together with O-1 and a distinct gate-off message.",
          "blocking": true
        },
        {
          "text": "The RunBacktest recompute (:1409-1415) passes no formula_cache, causing a second GetFormula per formula. Seed a run-level _FormulaRead cache from the run's own read, or correct the 'no extra RPC' claim.",
          "blocking": false
        },
        {
          "text": "[fails.md:2659] List all four _fetch_and_aggregate callers, including ManageStrategy UPDATE :3391, which pops the in-memory grade at :3388 before an exception-swallowing recompute. Restore on the outage subclass or record a limitation.",
          "blocking": false
        },
        {
          "text": "_FormulaRead touches cache owners :2906, :3092, :5059 and :5634 beyond those named. Update the dict[str, list] annotations and grep tests/ for list assertions.",
          "blocking": false
        },
        {
          "text": "A backtest-time refusal must give run_fingerprint=None (not an 'unreadable'-stamped fingerprint), or cells written during refusal will match at score time and count.",
          "blocking": false
        },
        {
          "text": "Add a _FormulaVersionUnknown(_GradeInputsUnknown) subclass carrying formula_id, so the :2655 log does not print a fid as a symbol and the gate-on/gate-off messages can branch.",
          "blocking": false
        },
        {
          "text": "Append the formula-version run warning at :1336 with the formula warnings, not into sector_warnings.",
          "blocking": false
        },
        {
          "text": "Pin author as DISPLAY with a test: changing author must not move the digest.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-2",
          "how": "Proposal r2 step 4: a score-time outage raises a _GradeInputsUnknown-family error before any cell read, giving the pinned gate-on message (:2654-2659). Confirmed by the adversary. The new gate-off coupling is tracked as a separate new objection."
        },
        {
          "id": "O-3",
          "how": "Proposal r2 step 1 strips parameters[].description and keeps only outputs[].name, plus a recursive descriptor-walk classification test asserting full field coverage. Confirmed by the adversary against indicators.proto:118-136."
        },
        {
          "id": "O-5",
          "how": "Proposal r2 step 4: NULL run_fingerprint plus the run warning 'evidence not recorded: formula version unavailable — rerun'. Confirmed by the adversary (placement moved to :1336 as a separate non-blocking nit)."
        },
        {
          "id": "O-6",
          "how": "Proposal r2 step 6 records the readiness valid_until limitation (24h default, 1h floor, readiness.py:31-35) in ANALYSIS-3 and context.md. Confirmed by the adversary."
        },
        {
          "id": "O-7",
          "how": "Proposal r2 step 6 rewords the Consumer Surface and records the ListStrategies/GetStrategyReport headline staleness. Confirmed by the adversary."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```
