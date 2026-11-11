# Debate Register: fix-analysis-evidence-dry

**State**: in-debate
**Mode**: full
**Rounds run**: 2 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-11 | /sdd-batch | 4 | 3 | 0 | 8 | 0 | yes |
| 2 | 2026-11-11 | /sdd-batch | 4 | 2 | 5 | 8 | 0 | yes |

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

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Hash FormulaDefinition.updated_at into the evidence fingerprint | The seed upsert sets updated_at=NOW() on every indicators boot (formulas_repository.py:70), so fingerprints would churn on every restart | locked |
| R-2 | 1 | Widen all 7 _definition_fingerprint callers (readiness included) to be formula-aware | Blast radius: it forces an async resolver into the sync :4294 caller, and readiness has its own validity window; the limitation is documented instead | locked |
| R-3 | 1 | Name-bound import of LIVE_ENABLED_PREDICATE_SQL into entry_backfill | It freezes a copy at import time and defeats the AC-2 monkeypatch test | locked |
| R-4 | 2 | Separate GetFormula digest resolver alongside the warmup prefetch | It breaks the single-fetch contract (servicer.py:970-977) and lets warmup (0 on an outage) and the fingerprint disagree; superseded by the digests out-param | locked |
| R-5 | 2 | Leave refused formulas out of the digest (fingerprint falls back to the definition-only hash) | Pre-feature cells carrying the definition-only hash become eligible again whenever the formula is refused, a worse blind spot than today; it also does not preserve @AC-23 | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | [C-16] The formula-aware fingerprint changes the @AC-23 @feature-289 refusal clause: a refused formula clears the grade (NOT_FOUND) instead of succeeding with x-score-excluded-symbols "[]". This needs an operator-signed CHANGE plus an amended durable scenario, or per-cell digest storage. | yes | open |
| O-2 | 1 | [C-16] @AC-23 @feature-289 outage clause: the digest fetch at :2882 must surface an outage through the formula_cache/failures contract, so ScoreStrategy aborts with 'fundamentals availability unknown — grade unchanged' and not 'evidence store unavailable'. | yes | closed @ round 2 (Proposal r2 step 4: a score-time outage raises a _GradeInputsUnknown-family error before any cell read, giving the pinned gate-on message (:2654-2659). Confirmed by the adversary. The new gate-off coupling is tracked as a separate new objection.) |
| O-3 | 1 | Digest must strip the nested parameters[].description and outputs[].description fields, with the classification pinned by a recursive FormulaDefinition.DESCRIPTOR walk test. | yes | closed @ round 2 (Proposal r2 step 1 strips parameters[].description and keeps only outputs[].name, plus a recursive descriptor-walk classification test asserting full field coverage. Confirmed by the adversary against indicators.proto:118-136.) |
| O-4 | 1 | [C-18] Fold the digest into the existing single formula fetch (a digest_map out-param on _declared_formula_warmup and _formula_fundamentals) instead of a separate GetFormula resolver, so warmup and fingerprint cannot disagree. | no | open |
| O-5 | 1 | An outage that leaves run_fingerprint=None in RunBacktest must append a run warning instead of losing the evidence silently. | no | closed @ round 2 (Proposal r2 step 4: NULL run_fingerprint plus the run warning 'evidence not recorded: formula version unavailable — rerun'. Confirmed by the adversary (placement moved to :1336 as a separate non-blocking nit).) |
| O-6 | 1 | [P-03] Correct the readiness lifetime claim (valid_until, 24h default) and record the pre-edit readiness verdict as a known limitation. | no | closed @ round 2 (Proposal r2 step 6 records the readiness valid_until limitation (24h default, 1h floor, readiness.py:31-35) in ANALYSIS-3 and context.md. Confirmed by the adversary.) |
| O-7 | 1 | Record, or reword in the Consumer Surface, that the ListStrategies/GetStrategyReport headline stays stale until the next recompute. | no | closed @ round 2 (Proposal r2 step 6 rewords the Consumer Surface and records the ListStrategies/GetStrategyReport headline staleness. Confirmed by the adversary.) |
| O-8 | 1 | Reuse the existing per-owner formula_cache in _fetch_and_aggregate and pin owner isolation with a test. | no | open |
| O-9 | 2 | [C-16/P-03] Gate-off availability coupling: the digest read on the unguarded _fetch_and_aggregate path (servicer.py:2889-2895) makes an indicators outage abort grade derivation for every CUSTOM_FORMULA strategy with the gate off, contradicting feature 215/289 'gate off unchanged'. It needs operator sign-off together with O-1 and a distinct gate-off message. | yes | open |
| O-10 | 2 | The RunBacktest recompute (:1409-1415) passes no formula_cache, causing a second GetFormula per formula. Seed a run-level _FormulaRead cache from the run's own read, or correct the 'no extra RPC' claim. | no | open |
| O-11 | 2 | [fails.md:2659] List all four _fetch_and_aggregate callers, including ManageStrategy UPDATE :3391, which pops the in-memory grade at :3388 before an exception-swallowing recompute. Restore on the outage subclass or record a limitation. | no | open |
| O-12 | 2 | _FormulaRead touches cache owners :2906, :3092, :5059 and :5634 beyond those named. Update the dict[str, list] annotations and grep tests/ for list assertions. | no | open |
| O-13 | 2 | A backtest-time refusal must give run_fingerprint=None (not an 'unreadable'-stamped fingerprint), or cells written during refusal will match at score time and count. | no | open |
| O-14 | 2 | Add a _FormulaVersionUnknown(_GradeInputsUnknown) subclass carrying formula_id, so the :2655 log does not print a fid as a symbol and the gate-on/gate-off messages can branch. | no | open |
| O-15 | 2 | Append the formula-version run warning at :1336 with the formula warnings, not into sector_warnings. | no | open |
| O-16 | 2 | Pin author as DISPLAY with a test: changing author must not move the digest. | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
