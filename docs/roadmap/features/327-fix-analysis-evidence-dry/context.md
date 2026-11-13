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

## Session 2026-11-13 — sdd-batch design gate (round 3)

/sdd-design fix-analysis-evidence-dry (full) halted at its approval gate after round 3 (gate policy: halt). Per the grilling protocol, design.md is NOT written and status.md stays `spec-ready`. The debate register is in `debate.md` (D-1..D-11, R-1..R-9, O-1..O-24).

## Open Threads

- **Approach (round-3 synthesis).** D-1..D-8 stand and R-1..R-5 are honoured. The round-2 operator package (O-1 + O-9) is no longer needed: proposal r3's composite fingerprint answers O-1 without a C-16 CHANGE, and O-9 is reclassified EXTEND.
  - AC-2 (D-1, unchanged): `entry_backfill.run_once` reads through `StrategiesRepository(db_pool).list_live_enabled()` inside the existing try/except → warning → return (entry_backfill.py:63-69), with red-first SQL-capture and predicate-monkeypatch tests.
  - Evidence fingerprint (D-9): `_evidence_fingerprint` = `def_hash + '.' + sha256(sorted 'fid=digest' joined by ';')`, byte-identical to `_definition_fingerprint` when there is no CUSTOM_FORMULA (D-2). Hex never contains '.', so the two shapes cannot collide. `_formula_digest` follows D-5 with author/description/source pin tests.
  - Single read (D-6): the `digests` out-param on `_formula_fundamentals` and the warmup helpers (written inside the `if formula_id not in cache` block, :2541-2555); the cache value becomes `_FormulaRead(metrics, digest)` with digest = hex, `_UNREADABLE` (NOT_FOUND/PERMISSION_DENIED) or None (outage). The return map stays `{fid: metrics}`; :5067 and :5642 need annotation-only edits.
  - New owner-scoped read `BacktestRunSymbolsRepository.latest_formula_fingerprint(user_id, strategy_id, def_hash)` (`starts_with(definition_fingerprint, def_hash||'.')`, newest `completed_at`, real_pg test). It uses only the `(user_id, strategy_id)` prefix of the 026 index, with an in-memory sort. The exact-match reads (backtest_run_symbols.py:67,88) are unchanged, so legacy bare cells are never selected.
  - `_run_backtest` (D-7, D-10, D-11): remove :916-924; run_fingerprint is set only when every CUSTOM_FORMULA fid has a real digest (None on outage or refusal, which loses nothing per evaluator.py:267-271); the "formula version unavailable — rerun" warning goes at :1335-1336 for an outage only; a run-level `_FormulaRead` cache (refused fids seeded as `_FormulaRead([], _UNREADABLE)`) is passed into `_recompute_headline` at :1409-1415; the :1416-1417 log branches on `_FormulaVersionUnknown`.
  - `_fetch_and_aggregate` (:2859-2915): defaults are bound once and reused for `_exclude_refused_cells`. A None digest raises `_FormulaVersionUnknown(_GradeInputsUnknown)` carrying formula_id before any cell read. `_UNREADABLE` resolves through `latest_formula_fingerprint` (None → the existing no-evidence path). ScoreStrategy (:2654-2659): gate on → the pinned @AC-23 message; gate off → UNAVAILABLE "formula version unavailable — grade unchanged". Callers: :2647, :1409, :3096 and :3391.
  - ManageStrategy UPDATE (:3384-3395): pop the in-memory grade only when the def_hash of the locked row's old `definition_json` (`current['definition_json']` in `_apply`, not the earlier `pre` read) differs from the new one. Pin test: a rename during a GetFormula outage keeps the grade.
  - Acceptance and docs: new 327 @AC-3 (score-time refusal grades on the newest formula-aware evidence, never pre-feature cells), @AC-4 (gate-off outage → UNAVAILABLE, distinct message), @AC-5 (rename during outage keeps the grade); amend test_grade_fundamentals_exclusion.py:501-506 to mock `latest_formula_fingerprint`; a distinct NOT_FOUND message when the fallback finds nothing for an unreadable formula; rewrite ANALYSIS-3/ANALYSIS-7 and docs/scoring.md; record the limitations (readiness valid_until, headline staleness, a behavioural UPDATE during an outage clears the grade, a refusal grades on the last readable version, mixed refused/readable formulas use the newest composite as a whole, the boot recompute leaves CUSTOM_FORMULA pairs unscored if indicators is not ready).
  - Build order: AC-2 → helpers → `_FormulaRead` threading → repository method → `_run_backtest` → `_fetch_and_aggregate` → UPDATE guard → owner-isolation test (:3100) → test_ac23 amendment → acceptance scenarios and docs.
- **Strongest open objection: O-17 (blocking, C-16).** The UPDATE path breaks @AC-2 @regression @feature-194 (fix-strategy-signal-params-dead-keys.feature:18-23): :3389 pops the grade, a rename succeeds during a GetFormula outage because :729-736 swallows it, and the recompute's `_FormulaVersionUnknown` is swallowed at :3394-3395, so the grade disappears. The synthesis adopts the pop-only-on-def_hash-change guard (built against the locked row), but the objection stays blocking until the proposer commits to it.
- **Non-blocking objections still open:** O-11 (closes with the O-17 guard; a limitation is acceptable for behavioural edits only, not renames), O-18 (refused-at-rollout strategies holding only pre-feature cells go permanently NOT_FOUND, including 028 template instances and the 029 `fundamentals_macd_blend` — needs a distinct NOT_FOUND message and the operator OQ2 acknowledgement recorded here), O-19 (mixed refused/readable formulas: accept as a limitation or adopt the positional suffix), O-20 (index claim), O-21 (outage-only warning), O-22 (refused-fid seed), O-23 (log branch + boot limitation), O-24 (C-07: recon's "next free migration is 028" is stale; 028 and 029 exist, so any fallback is 030).
- **Floor status:** no breach. There is no proto, migration, config literal, pool change, or new owner-agnostic read.
- **Uncovered @AC changes:** none needing a CHANGE sign-off. Preserved: @AC-23 @feature-289, @AC-2 @feature-194 (conditional on the O-17 guard), @AC-6 @feature-152, @AC-11 @feature-215, @AC-4/@AC-6 @feature-262. Extended: 327 @AC-1, @AC-2 and the new @AC-3, @AC-4, @AC-5. None are covered by an operator decision yet.
- **Resume:** the next /sdd-batch run resumes the debate from the state block below. Approval needs O-17 closed (proposer commits to the UPDATE guard) and the OQ2 acknowledgement (O-18) recorded in this context.md.

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "Round-3 synthesis for 327-fix-analysis-evidence-dry. D-1 to D-8 stand and R-1 to R-5 are honoured. The composite fingerprint from proposal r3 is adopted. The adversary found no Floor breach and confirmed it is not R-5 in disguise. One blocker remains: the ManageStrategy UPDATE path. Its fix is folded into step 6.\n\nVerified this round:\n- servicer.py:3384-3395 pops self._strategies before a recompute that swallows exceptions.\n- _fetch_formula_outputs (:729-736) swallows a GetFormula outage, so a rename succeeds during an outage.\n- fix-strategy-signal-params-dead-keys.feature:18-23 pins \"evidence grade survives\" on a rename.\n- services/xstockstrat-analysis/CLAUDE.md:504 \"Gate OFF is unchanged\" is about the live twin evaluator.declared_formula_fundamentals, not about gate-off grade derivation.\n- Analysis migrations 028 and 029 exist, so the next free number is 030.\n\nAC-2 (D-1, unchanged). entry_backfill.run_once calls `await StrategiesRepository(db_pool).list_live_enabled()` inside the existing try/except, warning and return (entry_backfill.py:63-69). Red-first tests in tests/test_entry_backfill.py:\n- capture the SQL;\n- monkeypatch app.repositories.strategies.LIVE_ENABLED_PREDICATE_SQL to a narrowed predicate and assert that nothing is selected.\n\nAC-1 (evidence sites only, per D-3; no migration, per D-4):\n\n1. Pure helpers beside _definition_fingerprint (servicer.py:7293).\n   - _formula_digest(formula): the D-5 classification plus a descriptor-walk test. Pin tests: changing author or a description leaves the digest unchanged; changing source changes it.\n   - _evidence_fingerprint(definition_json, digests):\n     - empty digests: byte-identical to _definition_fingerprint (D-2);\n     - otherwise: def_hash + '.' + sha256 of the sorted 'fid=digest' pairs joined by ';'.\n     - Hex never contains '.', so the two shapes cannot collide. The column is TEXT.\n\n2. Single read (D-6).\n   - The digests out-param goes on _formula_fundamentals (:1914-1947) and on _declared_formula_warmup / _prefetch_formula_warmups.\n   - In the warmup helper, write the digest inside the \"if formula_id not in cache\" block (:2541-2555), because formula_warmup_cache is dict[str,int] (:967).\n   - The cache value becomes _FormulaRead(metrics, digest). The digest is the hex string, _UNREADABLE on NOT_FOUND or PERMISSION_DENIED, or None on an outage. The return map stays {fid: metrics}.\n   - Annotation-only edits at :5067 (heal) and :5642 (opportunities). :2906 and :3092-3100 only pass the cache through.\n\n3. New owner-scoped repository read: BacktestRunSymbolsRepository.latest_formula_fingerprint(user_id, strategy_id, def_hash).\n   - SQL: `SELECT definition_fingerprint FROM analysis.backtest_run_symbols WHERE user_id=$1 AND strategy_id=$2 AND starts_with(definition_fingerprint,$3) ORDER BY completed_at DESC LIMIT 1`, with $3 = def_hash||'.'.\n   - Indexing: only the (user_id, strategy_id) equality prefix of the 026 index is used, then an in-memory sort. Document it that way; no byte-range optimization.\n   - The exact-match reads fetch_eligible and fetch_all_for_fingerprint (backtest_run_symbols.py:67,88) are unchanged, so bare legacy cells are never selected.\n   - Add a real_pg test.\n\n4. _run_backtest (D-7).\n   - Remove :916-924.\n   - After the formula-map build (:986-999), set run_fingerprint only when every CUSTOM_FORMULA fid has a real digest. Otherwise it is None, for both an outage and a refusal. This loses nothing, because a refusal makes every symbol FORMULA_ERROR (evaluator.py:267-271).\n   - Append the \"formula version unavailable — rerun\" warning at :1335-1336, and only for an outage (a None digest).\n   - Seed a run-level cache with _FormulaRead for each real digest, plus _FormulaRead([], _UNREADABLE) for each refused fid. Pass it as formula_cache into _recompute_headline at :1409-1415.\n   - Branch the :1416-1417 log on _FormulaVersionUnknown.\n\n5. _fetch_and_aggregate (:2859-2915).\n   - Bind the formula_cache, failures and meta defaults once, and reuse them for _exclude_refused_cells.\n   - When CUSTOM_FORMULA components exist, call _formula_fundamentals(digests=...) first:\n     - a None digest raises _FormulaVersionUnknown(_GradeInputsUnknown), carrying formula_id, before any cell read;\n     - an _UNREADABLE digest resolves the fingerprint with latest_formula_fingerprint, and None there takes the existing no-evidence path;\n     - otherwise the fingerprint is the composite.\n   - ScoreStrategy (:2654-2659) branches on the error type:\n     - gate on: the pinned message;\n     - gate off: UNAVAILABLE \"formula version unavailable — grade unchanged\".\n   - The four callers: :2647, :1409, :3096 and :3391.\n\n6. ManageStrategy UPDATE (:3384-3395). Pop the in-memory grade only when _definition_fingerprint of the old definition_json differs from that of the new one.\n   - Take the old JSON from the locked row (current['definition_json'] in _apply), not from the earlier `pre` read.\n   - An unchanged def_hash still recomputes, but an outage keeps the grade.\n   - Pin test: a rename while GetFormula is UNAVAILABLE keeps the grade.\n   - A behavioural edit during an outage clears the grade. This is correct and is recorded as a limitation.\n\n7. Acceptance and docs.\n   - New scenarios in 327:\n     - @AC-3: a score-time refusal grades on the newest formula-aware evidence, never on pre-feature cells;\n     - @AC-4: gate off plus a GetFormula outage gives UNAVAILABLE with the distinct message;\n     - @AC-5: a rename during an outage keeps the grade.\n   - Amend test_grade_fundamentals_exclusion.py:501-506 to mock latest_formula_fingerprint.\n   - Add a distinct NOT_FOUND message for the case where the fallback finds nothing and a formula is unreadable (today :2683-2685 says \"run a backtest\").\n   - Rewrite ANALYSIS-3 and ANALYSIS-7, and docs/scoring.md.\n   - Record these limitations:\n     - readiness valid_until;\n     - the headline stays stale until the next recompute;\n     - a behavioural UPDATE during an outage clears the grade;\n     - a refusal grades on the last readable version;\n     - with mixed refused and readable formulas, the newest composite is used as a whole;\n     - if indicators is not ready at boot, the boot recompute leaves CUSTOM_FORMULA pairs unscored.\n   - context.md records OQ1/OQ2 and the operator acknowledgement of the unrecoverable refused population (028 template instances and the 029 blend).\n\nBuild order:\n1. AC-2.\n2. Helpers.\n3. _FormulaRead threading.\n4. Repository method.\n5. _run_backtest.\n6. _fetch_and_aggregate.\n7. UPDATE guard.\n8. Owner-isolation test (:3100).\n9. test_ac23 amendment.\n10. Acceptance scenarios and docs.",
    "open_objections": [
      {
        "text": "[C-16] New: the UPDATE path breaks @AC-2 @regression @feature-194 (fix-strategy-signal-params-dead-keys.feature:18-23). servicer.py:3389 pops the grade before the recompute, and a rename succeeds during a GetFormula outage because :729-736 swallows it. The recompute's _FormulaVersionUnknown is then swallowed at :3394-3395, so the grade disappears. The synthesis adopts the fix in step 6: pop only when def_hash changes, comparing against the old definition_json from the locked row, plus a pin test. The proposer must commit to it.",
        "blocking": true
      },
      {
        "text": "O-11: this is answered only once the pop-only-on-def_hash-change guard is adopted. Recording it as a limitation is acceptable for behavioural edits only, not for renames.",
        "blocking": false
      },
      {
        "text": "[C-16/P-03] Strategies whose formula is refused at rollout and that hold only pre-feature cells go permanently NOT_FOUND, because reruns FORMULA_ERROR. This includes instances of the 028 templates and the 029 fundamentals_macd_blend. It needs a distinct NOT_FOUND message naming the unreadable formula, and an operator acknowledgement (OQ2) recorded in context.md.",
        "blocking": false
      },
      {
        "text": "Mixed refused and readable formulas: the fallback serves the newest composite as a whole, so an edit to the readable formula G is not enforced while F is refused. Either accept this as a recorded limitation or adopt the positional per-formula suffix.",
        "blocking": false
      },
      {
        "text": "Correct the latest_formula_fingerprint index claim: under a non-C collation, only the (user_id, strategy_id) prefix of the 026 index is used, and completed_at is sorted in memory. Do not use a byte-range predicate.",
        "blocking": false
      },
      {
        "text": "Emit the formula-version run warning only for an outage (a None digest), not for a refusal; a rerun cannot fix a refusal.",
        "blocking": false
      },
      {
        "text": "[C-18] Seed refused fids as _FormulaRead([], _UNREADABLE) in the run-level recompute cache, so the refused-only recompute (:1407) does not fetch them again.",
        "blocking": false
      },
      {
        "text": "Branch the RunBacktest log at :1416-1417 on _FormulaVersionUnknown. Record that the boot recompute_unscored_pairs (:3094-3105) leaves CUSTOM_FORMULA pairs unscored when indicators is not ready.",
        "blocking": false
      },
      {
        "text": "[C-07] Recon's \"next free migration is 028\" is stale: 028 and 029 exist, so any per-cell fallback would be 030. Correct recon.md and design.md.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-23 @feature-289",
        "kind": "PRESERVE",
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
      },
      {
        "ac_id": "@AC-3 (327, new: score-time refusal grades on newest formula-aware evidence)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-4 (327, new: gate-off GetFormula outage aborts UNAVAILABLE)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-5 (327, new: rename during GetFormula outage keeps grade)",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "R-1: hash updated_at. The seed upsert changes it on every boot.",
      "R-2: make all 7 callers formula-aware. The blast radius is too large.",
      "R-3: name-bound import of LIVE_ENABLED_PREDICATE_SQL. The value freezes at import time.",
      "R-4: a separate GetFormula digest resolver. It breaks the single-fetch contract.",
      "R-5: drop refused formulas from the digest. Legacy cells would become eligible again.",
      "An 'unreadable' sentinel at score time that clears the grade. This is a C-16 CHANGE to @AC-23 with no sign-off, superseded by the composite plus newest-suffix fallback.",
      "Record the UPDATE-path outage grade loss as a limitation. This breaks @AC-2 @feature-194 on a rename.",
      "A byte-range predicate for the prefix query. Under a non-C collation, punctuation is not sorted in byte order.",
      "Newest-suffix fallback on a gate-off outage. It contradicts D-8.",
      "Per-cell formula_digests JSONB (migration 030). It needs DBA approval and migration cost for SEV-3.",
      "Positional per-formula suffix (not locked). It costs complexity and longer keys; it is the remedy if the mixed-formula limitation is rejected."
    ],
    "open_risks": [
      "The UPDATE pop guard may be built against the stale `pre` read (:3316) instead of the locked row, which would let concurrent updates race.",
      "Strategies whose formula is refused and that hold only pre-feature evidence go to an unrecoverable NOT_FOUND. This includes the 028 template instances and the 029 blend. It needs operator acknowledgement and user communication.",
      "With mixed refused and readable formulas, edits to the readable formula are not enforced while another formula is refused.",
      "Ordering by completed_at may pick a slightly older composite when runs are concurrent.",
      "The fallback query sorts in memory over a strategy's cells, so its cost grows with the number of cells.",
      "An indicators outage now affects gate-off ScoreStrategy and every recompute path. Boot-time scoring depends on indicators being ready.",
      "There is a one-time evidence reset (D-4), and readiness and headline staleness remain documented limitations.",
      "Owner isolation of digests rests on the per-owner formula cache (:3092-3100), which shares one failures dict. The isolation test is load-bearing."
    ],
    "constitution_rules_touched": [
      "C-07",
      "C-10",
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "P-02",
      "P-03"
    ],
    "rationale": "Proposal r3 answers O-1 concretely. It uses a composite def_hash.formula_hash fingerprint with an owner-scoped fallback to the newest suffix on a score-time refusal. That keeps the @AC-23 'succeeds with []' clause without a C-16 CHANGE. Exact-match reads are unchanged, so legacy cells are never eligible (R-5 honoured). Both sides agree.\n\nO-9 closes as EXTEND. No durable @AC pins gate-off independence from indicators. I also verified that CLAUDE.md:504 refers to the live twin. The behaviour is pinned by the new @AC-4.\n\nO-4, O-8, O-10, O-12, O-13, O-14, O-15 and O-16 are answered and confirmed by the adversary. The small residuals are carried as non-blocking objections.\n\nThe adversary's blocking finding is verified. The UPDATE path pops the grade (:3389), the write-path outage is swallowed (:729-736), and the recompute error is swallowed (:3394-3395). Together these break @AC-2 @feature-194 when def_hash is unchanged. The cheap guard is adopted into the approach but stays blocking until the proposer commits to it.\n\nThere is no Floor breach: no proto, migration, config, pool or owner-agnostic read. The register is honoured.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "The evidence fingerprint is the composite def_hash.sha256(sorted fid=digest), and it is byte-identical to def_hash when there is no CUSTOM_FORMULA (D-2). On a score-time refusal, the fingerprint is resolved through the new owner-scoped BacktestRunSymbolsRepository.latest_formula_fingerprint prefix read (newest by completed_at). Exact-match eligibility reads are unchanged, so legacy bare cells are never selected. This preserves @AC-23 @feature-289 with no CHANGE and no migration.",
          "evidence": "proposal r3 steps 1,3,5; adversary r3 'holds up, not R-5 in disguise, satisfies @AC-23 as written'; backtest_run_symbols.py:67,79,88,99"
        },
        {
          "text": "A refusal or an outage at backtest time gives run_fingerprint=None, and the formula-version warning is added at :1335-1336. At score time an outage raises _FormulaVersionUnknown(_GradeInputsUnknown) carrying formula_id. With the gate on, the pinned message is kept. With the gate off, the result is UNAVAILABLE 'formula version unavailable - grade unchanged', classed EXTEND and pinned by the new 327 @AC-4.",
          "evidence": "evaluator.py:267-271; servicer.py:2129,1335-1336,2654-2659; services/xstockstrat-analysis/CLAUDE.md:504 refers to the live twin; proposer and adversary r3 agree EXTEND"
        },
        {
          "text": "_run_backtest seeds a run-level _FormulaRead cache from its own read and passes it into _recompute_headline at :1409-1415, so there is one GetFormula per formula per run. _fetch_and_aggregate binds its cache, failures and meta defaults once and reuses them for _exclude_refused_cells.",
          "evidence": "servicer.py:1405-1420,2859-2915; proposal r3 steps 4-5; adversary r3 confirmed"
        }
      ],
      "new_rejected": [
        {
          "text": "Hash an 'unreadable' sentinel at score time so that a refused formula clears the grade",
          "why": "It is a C-16 CHANGE to @AC-23 @feature-289 without sign-off, superseded by the composite plus the newest-suffix refusal fallback"
        },
        {
          "text": "Keep the unconditional pop on UPDATE and record the outage grade loss as a limitation",
          "why": "It breaks @AC-2 @feature-194: a rename keeps def_hash unchanged, the write-path outage is swallowed (:729-736), and the swallowed recompute error (:3394-3395) leaves no grade"
        },
        {
          "text": "A byte-range predicate (>= def_hash||'.' AND < def_hash||'/') for the prefix query",
          "why": "Under the non-C collation of DO Postgres, punctuation does not sort in byte order, so rows can be silently missed or included"
        },
        {
          "text": "A per-cell formula_digests JSONB column (analysis migration 030)",
          "why": "It needs DBA approval and migration cost for a SEV-3 fix that the composite resolves without a migration"
        }
      ],
      "new_objections": [
        {
          "text": "[C-16] The UPDATE path breaks @AC-2 @regression @feature-194. :3389 pops the grade, the rename succeeds during a GetFormula outage (:729-736), and the recompute's _FormulaVersionUnknown is swallowed at :3394-3395. Fix: pop only when the def_hash of the locked row's old definition_json differs from the new one, plus a pin test.",
          "blocking": true
        },
        {
          "text": "[C-16/P-03] Strategies whose formula is refused at rollout and that hold only pre-feature cells go permanently NOT_FOUND. This includes the 028 template instances and the 029 blend. It needs a distinct NOT_FOUND message and operator acknowledgement (OQ2) recorded in context.md.",
          "blocking": false
        },
        {
          "text": "With mixed refused and readable formulas, the refusal fallback keeps pre-edit evidence for the readable formula. Accept this as a limitation or adopt the positional suffix.",
          "blocking": false
        },
        {
          "text": "Correct the latest_formula_fingerprint index claim: only the (user_id, strategy_id) prefix is used, followed by an in-memory sort.",
          "blocking": false
        },
        {
          "text": "Emit the formula-version run warning only for an outage (a None digest), not for a refusal.",
          "blocking": false
        },
        {
          "text": "[C-18] Seed the refused fids as _FormulaRead([], _UNREADABLE) in the run-level recompute cache (:1407).",
          "blocking": false
        },
        {
          "text": "Branch the :1416-1417 log on _FormulaVersionUnknown, and record the limitation that the boot recompute_unscored_pairs runs while indicators is not ready.",
          "blocking": false
        },
        {
          "text": "[C-07] The 'next free migration 028' claim is stale because 028 and 029 exist; any fallback is 030. Correct recon.md and design.md.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-1",
          "how": "Round 3: the composite fingerprint with an owner-scoped newest-suffix refusal fallback preserves @AC-23 @feature-289. The adversary confirmed it, and the test_ac23 mock is amended."
        },
        {
          "id": "O-4",
          "how": "Round 3: a digests out-param on the single read plus a run-level _FormulaRead seed. Confirmed by the adversary."
        },
        {
          "id": "O-8",
          "how": "Round 3: the defaults are bound once and reused for _exclude_refused_cells. An owner-isolation test goes through formula_caches.setdefault (:3100)."
        },
        {
          "id": "O-9",
          "how": "Round 3: both sides class it EXTEND. No durable @AC pins gate-off independence from indicators, and CLAUDE.md:504 refers to the live twin. Pinned by the new 327 @AC-4 with a distinct message."
        },
        {
          "id": "O-10",
          "how": "Round 3: the run-level seed is passed to _recompute_headline at :1409-1415. The refused-fid residual is tracked as a new non-blocking objection."
        },
        {
          "id": "O-12",
          "how": "Round 3: the return map stays {fid: metrics}, with annotation-only edits at :5067 and :5642. No test asserts the cache contents (confirmed by the adversary's grep)."
        },
        {
          "id": "O-13",
          "how": "Round 3: a refusal at backtest time gives run_fingerprint=None. This loses nothing per evaluator.py:267-271."
        },
        {
          "id": "O-14",
          "how": "Round 3: a _FormulaVersionUnknown(_GradeInputsUnknown) subclass carrying formula_id."
        },
        {
          "id": "O-15",
          "how": "Round 3: the warning is appended at :1335-1336 with the formula warnings."
        },
        {
          "id": "O-16",
          "how": "Round 3: a pin test checks that changing author or a description does not move the digest."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```
