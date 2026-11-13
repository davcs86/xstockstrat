# Debate Register: fix-analysis-evidence-dry

**State**: in-debate
**Mode**: full
**Rounds run**: 3 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-11 | /sdd-batch | 4 | 3 | 0 | 8 | 0 | yes |
| 2 | 2026-11-11 | /sdd-batch | 4 | 2 | 5 | 8 | 0 | yes |
| 3 | 2026-11-13 | /sdd-batch | 3 | 4 | 10 | 8 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | AC-2: entry_backfill.run_once reads live strategies through StrategiesRepository(db_pool).list_live_enabled(), keeping its existing try/except → warning → return. It never binds LIVE_ENABLED_PREDICATE_SQL by name. | strategies.py:19,212-231 (call-time module-global read); entry_backfill.py:63-69,107,132,136; both proposer and adversary verified | settled |
| D-2 | 1 | The evidence fingerprint hashes the formula's behavioural content, not updated_at. With no CUSTOM_FORMULA components it is byte-identical to _definition_fingerprint. | formulas_repository.py:70 (updated_at=NOW() on seed); servicer.py:7285-7301; @AC-2 @feature-194, @AC-6 @feature-152 | settled |
| D-3 | 1 | Scope is evidence-only. Only the two evidence sites, _run_backtest's run_fingerprint and _fetch_and_aggregate at :2882, become formula-aware. The readiness callers :4011, :4208, :4294, :5257-5267 and :6107 stay on _definition_fingerprint. | servicer.py:5257-5267 is the compute_readiness_row fingerprint kwarg (confirmed by the adversary); sync caller at :4294 | settled |
| D-4 | 1 | Formula edits re-fingerprint evidence rather than deleting it: old cells stay and stop matching. No migration; the one-time reset is accepted (OQ1/OQ2). | @AC-11 @feature-215 non-destructive; proposal OQ1/OQ2, not contested by the adversary | settled |
| D-5 | 2 | Digest field classification: BEHAVIOURAL = source, input_schema, warmup_period, fundamental_inputs, parameters[] minus description (min/max presence kept), outputs[] name only. DISPLAY = name, description, author, created_at, updated_at, is_public, deleted, origin, formula_id. Canonical JSON uses defaults omitted, sorted keys and preserved repeated order. A descriptor-walk test asserts BEHAVIOURAL ∪ DISPLAY covers every field of FormulaDefinition, FormulaParameter and FormulaOutput. | indicators.proto:118-136,162-182; proposer r2 step 1 plus adversary r2 confirmation (author must stay DISPLAY because of the legacy_authors repair) | settled |
| D-6 | 2 | Digests come from the existing single formula read: a digests out-param on _declared_formula_warmup, _prefetch_formula_warmups and _formula_fundamentals, with the per-owner cache value changed to _FormulaRead(metrics, digest). No separate GetFormula resolver. | servicer.py:1914-1947,2525-2566,1930,3092-3100; proposer r2 step 3, adversary r2 accepted the shape | settled |
| D-7 | 2 | In _run_backtest, run_fingerprint is computed after the formula-map build (:986-999). A missing digest gives run_fingerprint=None plus the run warning 'evidence not recorded: formula version unavailable — rerun'. | servicer.py:918-924,986-999,1371,1341-1342; proposer r2 step 4, adversary r2 confirmed (placement nit only) | settled |
| D-8 | 2 | At score time, an outage on a referenced formula raises a _GradeInputsUnknown-family error before any cell read. On the gate-on path ScoreStrategy keeps the pinned UNAVAILABLE 'fundamentals availability unknown — grade unchanged'. | servicer.py:2654-2659; block-fundamentals-strategy-on-etf.feature:102; proposer r2 step 4, adversary r2 'addressed for the gate-on case' | settled |
| D-9 | 3 | The evidence fingerprint is the composite def_hash.sha256(sorted fid=digest), and it is byte-identical to def_hash when there is no CUSTOM_FORMULA (D-2). On a score-time refusal, the fingerprint is resolved through the new owner-scoped BacktestRunSymbolsRepository.latest_formula_fingerprint prefix read (newest by completed_at). Exact-match eligibility reads are unchanged, so legacy bare cells are never selected. This preserves @AC-23 @feature-289 with no CHANGE and no migration. | proposal r3 steps 1,3,5; adversary r3 'holds up, not R-5 in disguise, satisfies @AC-23 as written'; backtest_run_symbols.py:67,79,88,99 | settled |
| D-10 | 3 | A refusal or an outage at backtest time gives run_fingerprint=None, and the formula-version warning is added at :1335-1336. At score time an outage raises _FormulaVersionUnknown(_GradeInputsUnknown) carrying formula_id. With the gate on, the pinned message is kept. With the gate off, the result is UNAVAILABLE 'formula version unavailable - grade unchanged', classed EXTEND and pinned by the new 327 @AC-4. | evaluator.py:267-271; servicer.py:2129,1335-1336,2654-2659; services/xstockstrat-analysis/CLAUDE.md:504 refers to the live twin; proposer and adversary r3 agree EXTEND | settled |
| D-11 | 3 | _run_backtest seeds a run-level _FormulaRead cache from its own read and passes it into _recompute_headline at :1409-1415, so there is one GetFormula per formula per run. _fetch_and_aggregate binds its cache, failures and meta defaults once and reuses them for _exclude_refused_cells. | servicer.py:1405-1420,2859-2915; proposal r3 steps 4-5; adversary r3 confirmed | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Hash FormulaDefinition.updated_at into the evidence fingerprint | The seed upsert sets updated_at=NOW() on every indicators boot (formulas_repository.py:70), so fingerprints would churn on every restart | locked |
| R-2 | 1 | Widen all 7 _definition_fingerprint callers (readiness included) to be formula-aware | Blast radius: it forces an async resolver into the sync :4294 caller, and readiness has its own validity window; the limitation is documented instead | locked |
| R-3 | 1 | Name-bound import of LIVE_ENABLED_PREDICATE_SQL into entry_backfill | It freezes a copy at import time and defeats the AC-2 monkeypatch test | locked |
| R-4 | 2 | Separate GetFormula digest resolver alongside the warmup prefetch | It breaks the single-fetch contract (servicer.py:970-977) and lets warmup (0 on an outage) and the fingerprint disagree; superseded by the digests out-param | locked |
| R-5 | 2 | Leave refused formulas out of the digest (fingerprint falls back to the definition-only hash) | Pre-feature cells carrying the definition-only hash become eligible again whenever the formula is refused, a worse blind spot than today; it also does not preserve @AC-23 | locked |
| R-6 | 3 | Hash an 'unreadable' sentinel at score time so that a refused formula clears the grade | It is a C-16 CHANGE to @AC-23 @feature-289 without sign-off, superseded by the composite plus the newest-suffix refusal fallback | locked |
| R-7 | 3 | Keep the unconditional pop on UPDATE and record the outage grade loss as a limitation | It breaks @AC-2 @feature-194: a rename keeps def_hash unchanged, the write-path outage is swallowed (:729-736), and the swallowed recompute error (:3394-3395) leaves no grade | locked |
| R-8 | 3 | A byte-range predicate (>= def_hash//'.' AND < def_hash//'/') for the prefix query | Under the non-C collation of DO Postgres, punctuation does not sort in byte order, so rows can be silently missed or included | locked |
| R-9 | 3 | A per-cell formula_digests JSONB column (analysis migration 030) | It needs DBA approval and migration cost for a SEV-3 fix that the composite resolves without a migration | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | [C-16] The formula-aware fingerprint changes the @AC-23 @feature-289 refusal clause: a refused formula clears the grade (NOT_FOUND) instead of succeeding with x-score-excluded-symbols "[]". This needs an operator-signed CHANGE plus an amended durable scenario, or per-cell digest storage. | yes | closed @ round 3 (Round 3: the composite fingerprint with an owner-scoped newest-suffix refusal fallback preserves @AC-23 @feature-289. The adversary confirmed it, and the test_ac23 mock is amended.) |
| O-2 | 1 | [C-16] @AC-23 @feature-289 outage clause: the digest fetch at :2882 must surface an outage through the formula_cache/failures contract, so ScoreStrategy aborts with 'fundamentals availability unknown — grade unchanged' and not 'evidence store unavailable'. | yes | closed @ round 2 (Proposal r2 step 4: a score-time outage raises a _GradeInputsUnknown-family error before any cell read, giving the pinned gate-on message (:2654-2659). Confirmed by the adversary. The new gate-off coupling is tracked as a separate new objection.) |
| O-3 | 1 | Digest must strip the nested parameters[].description and outputs[].description fields, with the classification pinned by a recursive FormulaDefinition.DESCRIPTOR walk test. | yes | closed @ round 2 (Proposal r2 step 1 strips parameters[].description and keeps only outputs[].name, plus a recursive descriptor-walk classification test asserting full field coverage. Confirmed by the adversary against indicators.proto:118-136.) |
| O-4 | 1 | [C-18] Fold the digest into the existing single formula fetch (a digest_map out-param on _declared_formula_warmup and _formula_fundamentals) instead of a separate GetFormula resolver, so warmup and fingerprint cannot disagree. | no | closed @ round 3 (Round 3: a digests out-param on the single read plus a run-level _FormulaRead seed. Confirmed by the adversary.) |
| O-5 | 1 | An outage that leaves run_fingerprint=None in RunBacktest must append a run warning instead of losing the evidence silently. | no | closed @ round 2 (Proposal r2 step 4: NULL run_fingerprint plus the run warning 'evidence not recorded: formula version unavailable — rerun'. Confirmed by the adversary (placement moved to :1336 as a separate non-blocking nit).) |
| O-6 | 1 | [P-03] Correct the readiness lifetime claim (valid_until, 24h default) and record the pre-edit readiness verdict as a known limitation. | no | closed @ round 2 (Proposal r2 step 6 records the readiness valid_until limitation (24h default, 1h floor, readiness.py:31-35) in ANALYSIS-3 and context.md. Confirmed by the adversary.) |
| O-7 | 1 | Record, or reword in the Consumer Surface, that the ListStrategies/GetStrategyReport headline stays stale until the next recompute. | no | closed @ round 2 (Proposal r2 step 6 rewords the Consumer Surface and records the ListStrategies/GetStrategyReport headline staleness. Confirmed by the adversary.) |
| O-8 | 1 | Reuse the existing per-owner formula_cache in _fetch_and_aggregate and pin owner isolation with a test. | no | closed @ round 3 (Round 3: the defaults are bound once and reused for _exclude_refused_cells. An owner-isolation test goes through formula_caches.setdefault (:3100).) |
| O-9 | 2 | [C-16/P-03] Gate-off availability coupling: the digest read on the unguarded _fetch_and_aggregate path (servicer.py:2889-2895) makes an indicators outage abort grade derivation for every CUSTOM_FORMULA strategy with the gate off, contradicting feature 215/289 'gate off unchanged'. It needs operator sign-off together with O-1 and a distinct gate-off message. | yes | closed @ round 3 (Round 3: both sides class it EXTEND. No durable @AC pins gate-off independence from indicators, and CLAUDE.md:504 refers to the live twin. Pinned by the new 327 @AC-4 with a distinct message.) |
| O-10 | 2 | The RunBacktest recompute (:1409-1415) passes no formula_cache, causing a second GetFormula per formula. Seed a run-level _FormulaRead cache from the run's own read, or correct the 'no extra RPC' claim. | no | closed @ round 3 (Round 3: the run-level seed is passed to _recompute_headline at :1409-1415. The refused-fid residual is tracked as a new non-blocking objection.) |
| O-11 | 2 | [fails.md:2659] List all four _fetch_and_aggregate callers, including ManageStrategy UPDATE :3391, which pops the in-memory grade at :3388 before an exception-swallowing recompute. Restore on the outage subclass or record a limitation. | no | open |
| O-12 | 2 | _FormulaRead touches cache owners :2906, :3092, :5059 and :5634 beyond those named. Update the dict[str, list] annotations and grep tests/ for list assertions. | no | closed @ round 3 (Round 3: the return map stays {fid: metrics}, with annotation-only edits at :5067 and :5642. No test asserts the cache contents (confirmed by the adversary's grep).) |
| O-13 | 2 | A backtest-time refusal must give run_fingerprint=None (not an 'unreadable'-stamped fingerprint), or cells written during refusal will match at score time and count. | no | closed @ round 3 (Round 3: a refusal at backtest time gives run_fingerprint=None. This loses nothing per evaluator.py:267-271.) |
| O-14 | 2 | Add a _FormulaVersionUnknown(_GradeInputsUnknown) subclass carrying formula_id, so the :2655 log does not print a fid as a symbol and the gate-on/gate-off messages can branch. | no | closed @ round 3 (Round 3: a _FormulaVersionUnknown(_GradeInputsUnknown) subclass carrying formula_id.) |
| O-15 | 2 | Append the formula-version run warning at :1336 with the formula warnings, not into sector_warnings. | no | closed @ round 3 (Round 3: the warning is appended at :1335-1336 with the formula warnings.) |
| O-16 | 2 | Pin author as DISPLAY with a test: changing author must not move the digest. | no | closed @ round 3 (Round 3: a pin test checks that changing author or a description does not move the digest.) |
| O-17 | 3 | [C-16] The UPDATE path breaks @AC-2 @regression @feature-194. :3389 pops the grade, the rename succeeds during a GetFormula outage (:729-736), and the recompute's _FormulaVersionUnknown is swallowed at :3394-3395. Fix: pop only when the def_hash of the locked row's old definition_json differs from the new one, plus a pin test. | yes | open |
| O-18 | 3 | [C-16/P-03] Strategies whose formula is refused at rollout and that hold only pre-feature cells go permanently NOT_FOUND. This includes the 028 template instances and the 029 blend. It needs a distinct NOT_FOUND message and operator acknowledgement (OQ2) recorded in context.md. | no | open |
| O-19 | 3 | With mixed refused and readable formulas, the refusal fallback keeps pre-edit evidence for the readable formula. Accept this as a limitation or adopt the positional suffix. | no | open |
| O-20 | 3 | Correct the latest_formula_fingerprint index claim: only the (user_id, strategy_id) prefix is used, followed by an in-memory sort. | no | open |
| O-21 | 3 | Emit the formula-version run warning only for an outage (a None digest), not for a refusal. | no | open |
| O-22 | 3 | [C-18] Seed the refused fids as _FormulaRead([], _UNREADABLE) in the run-level recompute cache (:1407). | no | open |
| O-23 | 3 | Branch the :1416-1417 log on _FormulaVersionUnknown, and record the limitation that the boot recompute_unscored_pairs runs while indicators is not ready. | no | open |
| O-24 | 3 | [C-07] The 'next free migration 028' claim is stale because 028 and 029 exist; any fallback is 030. Correct recon.md and design.md. | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
