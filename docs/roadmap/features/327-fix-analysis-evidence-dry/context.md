> Distilled 2026-11-21 by /sdd-distill. Full pre-distill session prose is in git history (before this commit).

# Context Log: fix-analysis-evidence-dry

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries. (/sdd-distill is the sanctioned exception for compaction.)

---

## Decisions

- **Scope (triage 2026-11-10).** Two SEV-3 analysis single-source-of-truth gaps on the strategy evidence/live path (ANALYSIS-3 fingerprint input, ANALYSIS-7 live gate), Track C (SDD path), branch `feature/fix-analysis-evidence-dry`, depth full (>= 2 services: xstockstrat-analysis + xstockstrat-indicators). Defect reports: `docs/reports/2026-10-19-analysis-fingerprint-ignores-formula-version-defect.md` (evidence fingerprint ignores referenced formula content) and `docs/reports/2026-10-19-analysis-live-gate-sql-duplicated-defect.md` (entry-backfill re-types the live-enabled gate SQL instead of importing it); sidecars stamped `triaged`. Root cause: formula content lives in indicators, outside the hashed `definition_json`; the gate literal was duplicated, likely to dodge an import cycle via `servicer.py`. Product spec approved 2026-11-10 (spec-ready; warnings only: no FR-N/@FR tags, AC-2 partly implementation-flavoured; first review FAILed criteria 8 + 11, fixed); overlap CLEAN.
- **Operator decision (binding, recorded 2026-11-20, design gate), verbatim:** "the round-3 synthesis fix is binding — the UPDATE path pops the grade only when def_hash changes, comparing against the old definition_json from the locked row, with a pin test, so @AC-2 @regression @feature-194 is PRESERVED. C-16 sign-off for the CHANGE to @AC-23 @feature-289 and the gate-off availability coupling as synthesized."
  - As synthesized in round 3, `@AC-23 @feature-289` is PRESERVE (the composite fingerprint keeps it as written) and the gate-off coupling is EXTEND (new 327 `@AC-4`). design.md therefore has no CHANGE line; the sign-off covers both as synthesized.
  - This decision resolves O-17 (the only blocking objection). No status transition was supplied for the register, so O-11 and O-17 to O-24 still read `open` in debate.md.
  - OQ1 (invalidate vs re-fingerprint): re-fingerprint; old cells are kept and stop matching (D-4). OQ2 (rollout shift): the one-time evidence reset for CUSTOM_FORMULA strategies is accepted, with no migration (D-4). The operator has NOT explicitly acknowledged O-18 (below).
- **Design (approved after 3 rounds; register in `debate.md`, full text in `design.md`).**
  - **D-1 AC-2:** `entry_backfill.run_once` reads live strategies through `StrategiesRepository(db_pool).list_live_enabled()` inside the existing try/except → warning → return (`entry_backfill.py:63-69`); never bind `LIVE_ENABLED_PREDICATE_SQL` by name. Red-first tests capture the SQL and monkeypatch `app.repositories.strategies.LIVE_ENABLED_PREDICATE_SQL` (call-time module-global read, `strategies.py:19,212-231`).
  - **D-2/D-3/D-4:** the evidence fingerprint hashes formula behavioural content, not `updated_at`; with no CUSTOM_FORMULA components it is byte-identical to `_definition_fingerprint`. Scope is evidence-only: only `_run_backtest`'s run_fingerprint and `_fetch_and_aggregate` (:2882) become formula-aware; readiness callers (:4011, :4208, :4294, :5257-5267, :6107) stay on `_definition_fingerprint`. Formula edits re-fingerprint (old cells stay, stop matching); no migration.
  - **D-5 digest classification:** BEHAVIOURAL = source, input_schema, warmup_period, fundamental_inputs, parameters[] minus description (min/max presence kept), outputs[] name only; DISPLAY = name, description, author, created_at, updated_at, is_public, deleted, origin, formula_id (author stays DISPLAY because of the legacy_authors repair). Canonical JSON: defaults omitted, sorted keys, repeated order preserved. A descriptor-walk test asserts BEHAVIOURAL ∪ DISPLAY covers every field of FormulaDefinition/FormulaParameter/FormulaOutput; pin tests that author/description changes do not move the digest.
  - **D-6 single read:** `digests` out-param on `_declared_formula_warmup`, `_prefetch_formula_warmups`, `_formula_fundamentals` (written inside the `if formula_id not in cache` block); per-owner cache value becomes `_FormulaRead(metrics, digest)` (digest = hex, `_UNREADABLE` for NOT_FOUND/PERMISSION_DENIED, None for outage); return map stays `{fid: metrics}` (annotation-only edits at :5067, :5642). No separate GetFormula resolver.
  - **D-9 composite fingerprint:** `_evidence_fingerprint` = `def_hash + '.' + sha256(sorted 'fid=digest' joined by ';')` (hex never contains '.', so shapes cannot collide). On a score-time refusal, the new owner-scoped `BacktestRunSymbolsRepository.latest_formula_fingerprint(user_id, strategy_id, def_hash)` (`starts_with(definition_fingerprint, def_hash||'.')`, newest `completed_at`, real_pg test; uses only the `(user_id, strategy_id)` prefix of the 026 index plus an in-memory sort, O-20) resolves it. Exact-match eligibility reads (`backtest_run_symbols.py:67,88`) are unchanged, so legacy bare cells are never selected; preserves @AC-23 @feature-289 with no CHANGE and no migration.
  - **D-7/D-10/D-11 `_run_backtest`:** remove :916-924; run_fingerprint is computed after the formula-map build (:986-999) and set only when every CUSTOM_FORMULA fid has a real digest (None on outage or refusal; loses nothing per `evaluator.py:267-271`); run warning "evidence not recorded: formula version unavailable — rerun" at :1335-1336, outage only, with the formula warnings (not `sector_warnings`); a run-level `_FormulaRead` cache (refused fids seeded `_FormulaRead([], _UNREADABLE)`) is passed into `_recompute_headline` (:1409-1415); the :1416-1417 log branches on `_FormulaVersionUnknown`.
  - **D-8/D-10 `_fetch_and_aggregate` (:2859-2915):** defaults bound once and reused for `_exclude_refused_cells`; a None digest raises `_FormulaVersionUnknown(_GradeInputsUnknown)` carrying formula_id before any cell read; `_UNREADABLE` resolves through `latest_formula_fingerprint` (None → no-evidence path with a distinct NOT_FOUND message). ScoreStrategy (:2654-2659): gate on → pinned @AC-23 message "fundamentals availability unknown — grade unchanged"; gate off → UNAVAILABLE "formula version unavailable — grade unchanged" (EXTEND, 327 @AC-4). Callers to enumerate: ScoreStrategy :2647, RunBacktest :1409, boot :3096, ManageStrategy UPDATE :3391.
  - **ManageStrategy UPDATE guard (O-17, binding):** pop the in-memory grade only when the def_hash of the locked row's old `definition_json` (`current['definition_json']` in `_apply`, not the earlier `pre` read at :3316) differs from the new one; pin test: a rename during a GetFormula outage keeps the grade (concurrent-update race otherwise).
  - **Acceptance/docs:** new 327 @AC-3 (score-time refusal grades on the newest formula-aware evidence, never pre-feature cells), @AC-4 (gate-off outage → UNAVAILABLE, distinct message), @AC-5 (rename during outage keeps the grade); amend `test_grade_fundamentals_exclusion.py:501-506` to mock `latest_formula_fingerprint`; rewrite ANALYSIS-3/ANALYSIS-7 and docs/scoring.md; record limitations (readiness valid_until 24h default/1h floor `readiness.py:31-35`, ListStrategies/GetStrategyReport headline staleness, behavioural UPDATE during an outage clears the grade, a refusal grades on the last readable version, mixed refused/readable formulas use the newest composite as a whole, boot recompute leaves CUSTOM_FORMULA pairs unscored if indicators is not ready). Owner isolation: per-owner formula cache (`:3092-3100`, `formula_caches.setdefault` :3100) sharing one `failures` dict makes the isolation test load-bearing.
- **Rejected (locked).** R-1 hash `FormulaDefinition.updated_at` (seed upsert sets `updated_at=NOW()` every indicators boot, `formulas_repository.py:70`). R-2 widen all 7 `_definition_fingerprint` callers (async resolver into sync :4294; blast radius). R-3 name-bound import of `LIVE_ENABLED_PREDICATE_SQL` (freezes at import, defeats the monkeypatch test). R-4 separate GetFormula digest resolver (breaks single-fetch contract `servicer.py:970-977`; warmup 0 on outage vs fingerprint disagree). R-5 drop refused formulas from the digest (pre-feature cells become eligible again; worse blind spot). R-6 "unreadable" sentinel at score time clearing the grade (unsigned C-16 CHANGE to @AC-23). R-7 unconditional UPDATE pop + limitation (breaks @AC-2 @feature-194 on rename; :729-736 swallows the write-path outage, :3394-3395 the recompute error). R-8 byte-range predicate for the prefix query (non-C collation on DO Postgres does not sort punctuation in byte order). R-9 per-cell `formula_digests` JSONB (migration 030; DBA approval). Also not adopted: newest-suffix fallback on a gate-off outage (contradicts D-8); reusing the @AC-23 message for gate-off (misleads for strategies without fundamentals); positional per-formula suffix (kept as the remedy if the mixed-formula limitation is rejected); composite-prefix and migration as round-2 fallbacks (composite then adopted in round 3, migration not needed).
- **@AC status / constitution.** The gate-off "unchanged" behaviour of @feature-289/@feature-215 (analysis CLAUDE.md § Fundamentals availability guard; `CLAUDE.md:504` refers to the live twin; no durable scenario pins gate-off independence from indicators) is classed EXTEND (O-9). PRESERVE: @AC-23 @feature-289, @AC-2 @feature-194 (conditional on the O-17 guard), @AC-6 @feature-152, @AC-11 @feature-215, @AC-4/@AC-6 @feature-262; EXTEND: 327 @AC-1, @AC-2 and new @AC-3..@AC-5; agent durable rules @AC-4 @feature-283 and @AC-5 @feature-303 PRESERVE. Constitution touched: C-07, C-10, C-11, C-13, C-15, C-16, C-18, P-02, P-03; no Floor breach; no proto/migration/config/pool change.
- **Spec shape (implementation-spec.md, now 18 steps, status implementation-ready).** Atomic `Lands with` units 3+4, 5+6, 7+8, 9+10, 11+12, 13+14, 16+17; steps 1-2 are a service → test pair. Coverage: AC-1 → Step 12 (+4, 6, 10), AC-2 → Step 2, AC-3 → Step 12 (+8), AC-4 → Step 12 (+17), AC-5 → Step 14. Step 16-18 (added at impl review, C-14): agent allow-list for the gate-off UNAVAILABLE string (`xstockstrat-agent/app/tools.py:242`, `_grpc_error_message` :278-282), pin in `tests/test_tool_errors.py` (backend string as single-line module-level `_FORMULA_VERSION_UNKNOWN_MSG = "<text>"`, so Step 11 must keep that form), rows in `tests/test_tools.py`, `docs/runbooks/mcp-tools.md` (AGENT-10); insights BFF needs no step (`insightsBff.ts:40-42` bare forward); strat-lab `backtest` skill unchanged. Spec-time strings: NOT_FOUND "no eligible evidence — formula <ids> is not readable and no evidence was recorded for a readable version; restore access to the formula or rebind the component, then run a backtest"; the run warning is emitted only for a registered own run that would stamp a fingerprint; `_UNREADABLE` is an `object()` sentinel and `_evidence_fingerprint` raises on a non-string digest; `_fetch_and_aggregate` reports refused ids through an `unreadable=` out-list; UPDATE guard treats the hash as changed (today's behaviour) if `apply_fn` never ran. Tree: `/sdd-spec` merged `origin/main-dev` into the feature branch (merge `f7d02e7e`); analysis migrations 028/029 exist, next free 030, none needed (O-24 resolved).
- **Other risks carried.** Changing the `_FormulaRead` value type across the cache owners (:1930, :2807, :2906, :3092-3100, :5059, :5634) risks regressions in heal/opportunities paths if any reader still expects a list (grep found no test asserting cache contents). Field-classification drift mitigated only by the descriptor-walk test. Branch-only interim: between Step 9 and Step 11 CUSTOM_FORMULA strategies stamp composites the read side does not yet ask for.

## Open Threads

- [ ] **Scope addition needs operator confirmation (C-14).** Steps 16-18 add `xstockstrat-agent` (design.md called it internal-only); `feature.md` Affected Services/Reviewers not yet edited. If declined: drop 16-18 and record a deliberate withhold at the agent, deferred to a named follow-up. Target: `/sdd-execute` up-front confirmation.
- [ ] **Unrecoverable refused population (O-18).** Strategies whose formula is refused at rollout and that hold only pre-feature cells go permanently NOT_FOUND (028 template instances, 029 `fundamentals_macd_blend`). The operator approved the synthesis that lists this but has not acknowledged it explicitly; gated at Step 11's Phase-2 confirmation (Step 15 only checks the record) and repeated in the integration-PR rollout note.
- [ ] Existing-test fallout: Steps 10 and 12 may amend an existing assertion only when it fails solely because of the composite stamp / bare-mock `latest_formula_fingerprint`; `tests/test_analysis_servicer.py` is conditional in Step 10; anything else is a blocker to report.
- [ ] Duplicate-component second `GetFormula` on the unprefixed path (existing behaviour, unchanged); O-22 "one GetFormula per formula per run" holds only for one component per id there (Step 10 duplicate-component case).
- [ ] Branch-only interim (Steps 9 → 11): no `main-dev` PR between those steps; per-step PRs target `feature/fix-analysis-evidence-dry` only.
- [ ] Overlap (WARN, merge-conflict risk only): `servicer.py` with 308-fix-analysis-per-symbol-isolation (Steps 9, 11, 13) and 322-fix-retired-surface-proto-cleanup (Step 8); `tests/test_analysis_servicer.py` with 308 and 322; `entry_backfill.py` with 312-fix-read-path-owner-trust (comment only); analysis CLAUDE.md with 309/322 (not edited here); new agent steps touch `tools.py`, `tests/test_tool_errors.py`, `docs/runbooks/mcp-tools.md` and must be re-checked against fix-agent-bearer-secret-orphan, fix-agent-mcp-transport-fallthrough, fix-mcp-deadline-budget. Target: merge order at `/sdd-execute` / `/merge-train`.
- [ ] Accepted limitations to document at Step 15: mixed refused/readable formulas (O-19), `completed_at` ordering under concurrent runs, fallback query cost (O-20), indicators availability coupling (O-23), one-time evidence reset (D-4), readiness/headline staleness.
- [ ] Debate bookkeeping: O-11 and O-17..O-24 still read `open` in debate.md (no status transition supplied); each maps to a numbered step in implementation-spec.md.

## Files Modified

- Design/spec artifacts only so far (no service code): `recon.md`, `debate.md` (approved, 3 rounds), `design.md`, `implementation-spec.md` (18 steps), `acceptance.feature` (appended @AC-3, @AC-4, @AC-5; IDs append-only).
- Planned (services/xstockstrat-analysis): `app/engine/entry_backfill.py` (Step 2), `app/handlers/servicer.py` (digest/fingerprint helpers, `_FormulaRead` threading, `_run_backtest`, `_fetch_and_aggregate`, UPDATE guard), `app/repositories/backtest_run_symbols.py` (`latest_formula_fingerprint`), `tests/test_grade_fundamentals_exclusion.py` / `tests/test_analysis_servicer.py` (amendments), docs ANALYSIS-3/ANALYSIS-7 + `docs/scoring.md`; services/xstockstrat-agent: `app/tools.py`, `tests/test_tool_errors.py`, `tests/test_tools.py`, `docs/runbooks/mcp-tools.md` (Steps 16-18).

## Superseded Sessions

- 2026-11-10 /sdd-triage: clustered two SEV-3 defect reports into one full-depth Track C feature (analysis + indicators); created status.md, feature.md, product-spec.md, acceptance.feature (AC-1..2), context.md; open questions invalidate-vs-re-fingerprint and one-time fingerprint shift (resolved as OQ1/OQ2 in Decisions).
- 2026-11-10 sdd-review product-spec: approved draft → spec-ready (warnings and first-review FAILs of criteria 8 + 11 recorded in Decisions → Scope); overlap CLEAN; depth full. Tree ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits).
- 2026-11-11 sdd-batch design gate (round 2): halted at approval gate (D-1..D-8, R-1..R-5, O-1..O-16); approach (AC-2 via `list_live_enabled`; pure `_formula_digest` + `_evidence_fingerprint`; `digests` out-param + `_FormulaRead`; `_run_backtest` NULL fingerprint + warning; `_FormulaVersionUnknown`) adopted into D-5..D-8. Blocking O-1 (score-time refusal would clear the grade: unsigned C-16 CHANGE to @AC-23, blast radius all four recompute paths including RunBacktest :2943-2949 which also deletes the DB row, both gate states, post-feature-224 foreign-formerly-public formulas) + O-9 (gate-off coupling: indicators outage aborts gate-off grading for every CUSTOM_FORMULA strategy); fallbacks were the composite `<def_hash>.<formula_hash>` prefix fingerprint or analysis migration (per-cell digest, DBA approval); round 3 chose the composite. Superseded by the round-3 fence.
- 2026-11-13 sdd-batch design gate (round 3): halted (D-1..D-11, R-1..R-9, O-1..O-24); composite fingerprint answered O-1 without a C-16 CHANGE (O-9 reclassified EXTEND, so the round-2 operator package was no longer needed); new blocking O-17 (UPDATE path breaks @AC-2 @feature-194: :3389 pops the grade, a rename succeeds during a GetFormula outage, :3394-3395 swallows `_FormulaVersionUnknown`) with the pop-only-on-def_hash-change guard; non-blocking O-11, O-18..O-24 (O-18 refused-at-rollout permanent NOT_FOUND needs a distinct message + OQ2 acknowledgement; O-24 C-07 recon's "next free migration is 028" stale). Approach and acceptance/docs list are hoisted into Decisions. State fence (last in file, read by the batch parser) preserved byte-for-byte:

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

- 2026-11-20 sdd-design: recon.md (written 2026-11-11; reuse `StrategiesRepository.list_live_enabled` and the lazy one-GetFormula-per-formula cache); 3 grilling rounds (full); status spec-ready → design-approved; wrote design.md, debate.md State → approved (no new rows, no petitions). The operator decision (binding) and OQ1/OQ2 rulings are reproduced verbatim in Decisions; design.md line cites are from the round-3 tree (branch base `c4fd48b0a` had migrations up to 027). Its Open Threads are hoisted into the header (UPDATE guard source row, O-18, O-19, `completed_at` ordering, O-20, O-23, D-4 reset, owner-isolation test, line drift, register bookkeeping).
- 2026-11-20 sdd-spec and impl-review: see the two verbatim sessions below.

## Session 2026-11-20 — sdd-spec

- Generated implementation-spec.md with 15 steps. Status → implementation-ready.
- Tree: `/sdd-spec` Step 0.5 merged `origin/main-dev` into `feature/fix-analysis-evidence-dry` (merge `f7d02e7e`, no conflicts) before discovery; every cite in the spec was re-grepped on that tree (resolves the "line drift" thread and O-24: analysis migrations `028`/`029` exist, next free is `030`, none needed).
- Operator decisions carried as binding (recorded 2026-11-20, design gate): the UPDATE path pops the grade only when `def_hash` changes, compared against the old `definition_json` of the locked row, with a pin test (Steps 13–14; `@AC-2 @regression @feature-194` PRESERVED); C-16 sign-off for the `@AC-23 @feature-289` treatment and the gate-off availability coupling as synthesized (Steps 11–12).
- `acceptance.feature`: appended `@AC-3`, `@AC-4`, `@AC-5` (design.md step 7 mandates them; IDs append-only) so every `**Covers**` ID exists. Coverage: AC-1 → Step 12 (+4, 6, 10), AC-2 → Step 2, AC-3 → Step 12 (+8), AC-4 → Step 12, AC-5 → Step 14.
- Atomic units (`**Lands with**`): 3+4, 5+6, 7+8, 9+10, 11+12, 13+14 — each test step imports a symbol its service step creates. Steps 1–2 are a plain service → test pair.
- Key codebase findings:
  - `_formula_fundamentals` gained a `warmups=` keyword on main-dev (feature 341, `servicer.py:1919-1920`, caller `:4561`); the new `digests=` keyword sits beside it and all three read helpers only gain optional keywords, so no existing caller or test call site changes (`tests/test_fundamentals_pit_pager.py:307`, `tests/test_owner_header_guard.py:343-344`).
  - `_apply` (`servicer.py:3344-3345`) already holds the locked row's `old_json`; `_stub_update_repo` (`tests/test_analysis_servicer.py:2500`) really awaits `apply_fn`, so the guard is testable without a DB.
  - The `_derivation_svc` cells repo is a bare `AsyncMock()` (`tests/test_analysis_servicer.py:130`), so after Step 11 a refusal's `latest_formula_fingerprint` returns a truthy mock — `test_ac23_refused_formula_*` (`tests/test_grade_fundamentals_exclusion.py:501`) is amended in Step 12 with an explicit return.
  - `real_pg` is provisioned in CI (`.github/workflows/ci.yml:508-512`; `local_pg` fails rather than skips under `CI=true`), so Step 8's prefix-read test is proven there.
- Spec-time clarifications (design left the wording open; flag at impl-spec review):
  - Exact strings: run warning `"evidence not recorded: formula version unavailable — rerun"` (D-7 text), gate-off abort `"formula version unavailable — grade unchanged"` (design.md step 5), and a NOT_FOUND `"no eligible evidence — formula <ids> is not readable and no evidence was recorded for a readable version; restore access to the formula or rebind the component, then run a backtest"` (design fixed only "a distinct message naming the unreadable formula").
  - The run warning is emitted only on a run that would stamp a fingerprint (registered own run) — an inline run never records evidence, so "evidence not recorded" would mislead there.
  - `_UNREADABLE` is an `object()` sentinel and `_evidence_fingerprint` raises on a non-string digest, so a refused digest can never be hashed (R-6).
  - `_fetch_and_aggregate` reports the refused formula ids through an `unreadable=` out-list, mirroring the existing `excluded=` out-list.
  - UPDATE guard: when `apply_fn` never ran (only possible with a repo mock that skips it) the guard treats the hash as changed and pops, i.e. today's behaviour.
- Debate bookkeeping: O-11 and O-17 to O-24 each map to a numbered step (table in implementation-spec.md); debate.md is unchanged (no status transition was supplied).

## Open Threads

- **Unrecoverable refused population (O-18)** — still needs the operator's explicit acknowledgement; the spec gates it at Step 15's Phase-2 confirmation and repeats it in the integration-PR rollout note.
- **Branch-only interim** — between Step 9 and Step 11 CUSTOM_FORMULA strategies stamp composites the read side does not ask for yet; no `main-dev` PR between those steps.
- **Existing-test fallout** — Steps 10 and 12 allow amending an existing assertion only when it fails solely because of the composite stamp / the bare-mock `latest_formula_fingerprint`; anything else is a blocker to report.
- **Mixed refused and readable formulas (O-19)**, **`completed_at` ordering**, **fallback query cost (O-20)**, **indicators availability coupling (O-23)**, **one-time evidence reset (D-4)** — accepted limitations, documented at Step 15.

## Session 2026-11-20 — sdd-review impl-spec (advisory)

- Result: 1 failure, 7 warnings on the criteria pass; overlap WARN (5 file collisions, no migration / proto field / config key collision). Advisory — did not block; lifecycle unchanged (`implementation-ready`).
- Addressed in implementation-spec.md (each claim re-verified on the tree @ `96a48951`):
  - [x] **FAIL, C-14 consumer surface.** Confirmed: `services/xstockstrat-agent/app/tools.py:242` allow-lists one UNAVAILABLE string and `_grpc_error_message` (`:278-282`) replaces any other with `upstream unavailable; …`, so the Step 11 gate-off abort `"formula version unavailable — grade unchanged"` would be withheld from the MCP caller. Added Step 16 (agent allow-list + tool description), Step 17 (pin in `tests/test_tool_errors.py`, rows in `tests/test_tools.py`; Covers `AC-4`), Step 18 (`docs/runbooks/mcp-tools.md`, AGENT-10). Steps 16+17 are a `Lands with` pair. The NOT_FOUND text needs no agent code change (`tools.py:273-274`, `:296`). The insights BFF gets no step: `insightsBff.ts:40-42` is a bare `forward`. The "all free-text" rationale was replaced; Total Steps 15 → 18.
  - [x] **WARN, Step 13 line drift.** Re-grepped: comment `:3393-3394`, lock `:3396`, pop `:3397`, recompute `:3398-3401`, `except` `:3402-3403`; `update_locked` call `:3379-3381`; Step 11's UPDATE cite is now `:3399-3401`.
  - [x] **WARN, Step 2 red proof.** Step 2 gained instruction 3: the red is shown by temporarily restoring the literal in the working tree (never `git stash`), then discarding it.
  - [x] **WARN, C-16 sign-off for the gate-off coupling.** It is recorded (this file, "Session 2026-11-20 — sdd-design", operator decision; design.md "Business Rules Touched (C-16)"); Step 11's evidence now cites it.
  - [x] **WARN, O-18 gate placement.** The acknowledgement gate moved from Step 15 to Step 11's Phase-2 gate (instruction 0); Step 15 only checks the record exists. The acknowledgement itself is still open (below).
  - [x] **WARN, duplicate components and the `GetFormula` count pin.** Confirmed `if fid in out: continue` (`servicer.py:1934-1935`) dedups only fundamentals formulas and the unprefixed path passes no cache (`:1002-1004`). Step 10 instruction 5 now pins the count with one component per formula id and adds a duplicate-component case that does not assert the count.
- Spec-time decisions made in this review (flag at the checkpoint):
  - Step 17 pins the backend string as the assignment `_FORMULA_VERSION_UNKNOWN_MSG = "<text>"` in the analysis source (the ingest pattern at `tests/test_tool_errors.py:192`), so Step 11 must keep it a single-line module-level assignment.
  - Agent durable rules `@AC-4 @feature-283` and `@AC-5 @feature-303` are PRESERVE (the existing string stays allow-listed); no new 327 scenario was added, Step 17 covers `AC-4`.
  - The strat-lab `backtest` skill is not edited: no behaviour in the `docs/patterns/strat-lab-plugin.md` guard-rail table changes.

## Open Threads

- [ ] unaddressed — **Scope addition needs operator confirmation (C-14).** Steps 16–18 add `xstockstrat-agent` to the touched services, which design.md called internal-only. `feature.md` (Affected Services, Reviewers table — agent service owner for Steps 16–17) was not edited by this advisory review. Alternative if the operator declines: drop Steps 16–18 and record a deliberate withhold of the message at the agent, deferred to a named follow-up. Target: `/sdd-execute` up-front confirmation.
- [ ] unaddressed — **Unrecoverable refused population (O-18).** Still needs the operator's explicit acknowledgement; now gated at Step 11 (before the behaviour lands).
- [ ] unaddressed — **Existing-test fallout not enumerated.** Steps 10 and 12 may amend an existing assertion only when it fails solely because of the composite stamp or the bare-mock `latest_formula_fingerprint`; `tests/test_analysis_servicer.py` is a conditional Files entry in Step 10. No pre-run was possible before the code exists. Target: Steps 10 and 12; any other failure is a blocker to report.
- [ ] unaddressed — **Duplicate-component second `GetFormula`.** Existing behaviour on the unprefixed path (two components on one non-fundamentals formula id); left unchanged, so "one `GetFormula` per formula per run" (O-22) holds only for one component per id there. Target: Step 10 duplicate-component case.
- [ ] unaddressed — **Branch-only interim (Steps 9 → 11).** The branch stamps composites nothing reads yet; `/sdd-execute` must not open a `main-dev` PR between those steps (per-step PRs target `feature/fix-analysis-evidence-dry` only).
- [ ] unaddressed — **Overlap (WARN, merge-conflict risk only).** `services/xstockstrat-analysis/app/handlers/servicer.py` with 308-fix-analysis-per-symbol-isolation (its Steps 9, 11, 13) and 322-fix-retired-surface-proto-cleanup (its Step 8, `_compute_opportunities`); `tests/test_analysis_servicer.py` with 308 and 322; `app/engine/entry_backfill.py` with 312-fix-read-path-owner-trust (comment only); `services/xstockstrat-analysis/CLAUDE.md` with 309 and 322 (this feature does not edit it). The new agent steps also touch `services/xstockstrat-agent/app/tools.py`, `tests/test_tool_errors.py` and `docs/runbooks/mcp-tools.md`, which this overlap scan predates — re-check against the agent peers (fix-agent-bearer-secret-orphan, fix-agent-mcp-transport-fallthrough, fix-mcp-deadline-budget) before execution. Target: merge order at `/sdd-execute` / `/merge-train`.
- **Mixed refused and readable formulas (O-19)**, **`completed_at` ordering**, **fallback query cost (O-20)**, **indicators availability coupling (O-23)**, **one-time evidence reset (D-4)** — accepted limitations, documented at Step 15 (unchanged).

## Session 2026-11-21 — /sdd-distill
- Distilled 7 sessions → header + Superseded Sessions; kept 2 verbatim (sdd-spec, sdd-review impl-spec). The round-2 state fence was dropped; the round-3 fence (last in file) kept byte-for-byte.
- context.md 622 → 364 lines, 73936 → 50614 bytes. Original prose preserved in git history.
