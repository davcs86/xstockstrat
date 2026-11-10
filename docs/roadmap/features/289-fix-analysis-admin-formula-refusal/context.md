# Context: fix-analysis-admin-formula-refusal  (archived 2026-11-10)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-11-10 — /sdd-archiver

**What**: The fix is wider than the reported admin `PERMISSION_DENIED` bug. Any formula refusal (`NOT_FOUND` or `PERMISSION_DENIED`) that the traced rule references now becomes a terminal 0-of-0 `formula_unreadable` verdict on every path that traces readiness. Before, it showed up as an "indicators outage" row or an aborted `EvaluateReadiness`. Paths that don't trace readiness (backtest, live loop, `GetIndicatorSeries`) keep their old mapping.

The design debate also pulled in three changes the defect never asked for, each signed off:
- a GLOBAL reclassification of a refused `GetFormula` under the fundamentals gate;
- a per-owner formula cache in `recompute_unscored_pairs`;
- changes to four existing business-rule contracts: this feature's own `@AC-14`, the feature-224 "skip" contract, `@AC-1 @feature-185`, and the feature-083 two-axis ranking.

Launched 2026-11-07 via PR #1472.

**Why (irrecoverable rationale)**:
- **`NOT_FOUND` is treated the same as `PERMISSION_DENIED`.** The daily refresh and the materializer send owner-only metadata (`owner_metadata()` drops `x-access-scope`), so for the same formula indicators answers `NOT_FOUND`. A marker set only on `PERMISSION_DENIED` would be overwritten by a quiet skip row lasting about 24 h, and non-admin owners would never see it.
- **The global fundamentals change is safe.**
  - A `GetFormula` refusal implies an `ExecuteFormula` refusal for every metadata class, because both go through `_load_formula` + `_can_read_formula`.
  - The one reverse case is an admin reading a foreign formula. `GetFormula` succeeds there as an audited read, and only `ExecuteFormula` refuses. That case is left untouched, so in practice the change matters only for `NOT_FOUND`.
  - With the gate OFF nothing changes. This proof existed only in design.md.
- **Global, not limited to opportunities + heal.** The user chose this against both the proposer and the adversary (round-3 decision 1, re-confirmed in round 4). No reason is recorded beyond accepting the before/after table.
- **Held rows keep their signal action and signal axis.** Zeroing both axes would remove a genuine sell-signal REDUCE on a held position. A held row with no signal keeps the fallback ADD.
- **Held unreadable rows are deliberately NOT a C-16 change of `@AC-11/12 @feature-199`.** Those scenarios cover data-unavailable and muted non-held placeholders, and held 0/0 rows already get a signal-only composite.
- **Formula visibility is deliberately NOT a fingerprint input (YAGNI).** A repaired formula can keep showing the marker for up to about 24 h. Accepted, with no UI hint.

**Rejected alternatives**:
- `raise_unreadable=True` on the read paths — `FormulaExecutionError` propagates by design and aborts `EvaluateReadiness` and the recompute.
- A `FormulaExecutionError` subclass, or catching it in 5–6 servicer `except` arms — repeats the "fourth caller omits the kwarg" trap, drops the whole candidate rather than one component, and cannot tell referenced from unreferenced formulas.
- Reading `unreadable_formulas` after the call — one evaluator is shared across concurrently gathered candidates, so refusals cannot be attributed.
- A `flag_unreadable` constructor flag with guards and `for_owner` plumbing — mechanism for callers that don't exist (user decision, round 2).
- A PERMISSION_DENIED-only (scope-dependent) marker — the owner-metadata passes overwrite it.
- Propagating the admin bit into scheduled passes — breaks the feature-225 `owner_metadata` contract and still leaves non-admins silent.
- A reason enum (`OpportunityDegradedReason`) — churns the three existing bool markers (`data_unavailable`, `muted`, `fundamentals_unavailable`). C-04 targets closed sets carried as strings, so a bool is adequate.
- Marking any unreadable component — an exit-only formula would blank the entry trace and could suppress a held REDUCE.
- A partial 0/N result — a rule with a missing operand is not honestly evaluable (P-03).
- Retrying unreadable rows on the 300 s heal — the refusal is permanent until the formula is repaired, so the retry never ends.
- A `readiness_cache` column, or the `bar_epoch=-1` sentinel — `-1` classifies as UNKNOWN and re-kicks every 300 s.
- "Never cache refusals" in `_formula_fundamentals` instead of a per-owner cache — adds per-candidate `GetFormula` calls on the opportunities/heal/kick paths even with the gate OFF.
- A characterization test pinning the outage batch-loss behaviour — that would pin a bug, so a defect report was filed instead.

**Scars & gotchas**:
- **The triage lead was wrong.** It blamed staging `fundsignal.scoring_formula_id` (`d1ff5e6b…`), but that formula is `SYSTEM_AUTHOR`, which `_can_read_formula` always passes, so it can never be refused. The `FormulaExecutionError` timeouts were a different failure.
- **The burst dates were off by one.** A `[1d]` metric bucket at timestamp T counts the preceding 24 h. The real bursts were 2026-10-31 (3,298 lines) and 2026-11-02 (920), not 11-01 and 11-03.
- **Before the fix, the heal's `except grpc.RpcError` treated `PERMISSION_DENIED` as an outage.** It re-stamped the row `unavailable` every 300 s, forever. The new marker is outside the heal selector, which keys on `"unavailable"` only.
- **With the fundamentals gate ON, the refusal never reached `ExecuteFormula`.** A refused `GetFormula` was recorded as a fundamentals failure, `assess` returned UNKNOWN, and the row was stamped `unavailable`. The two stores disagreed and the heal looped.
- **Test-harness traps that make assertions vacuous:**
  - `make_servicer()` passes no pool, so `_strategies_repo` and `_opportunities_repo` are `None`.
  - `_opportunity_refresh_tick` swallows errors in `except Exception`.
  - The stock `_FakeReadinessCache` made a "never awaited" assertion vacuous.
  - `_FakeOppRepo` mirrors the SQL floor and source exclusion, so it must be extended for each new structural marker. Its `replace_symbols` never copies `action`, so an inline spy is needed.
  - `_readiness_to_proto` indexes trace keys directly, so a bare `{"formula_unreadable": True}` raises `KeyError`.
- **Test-module import cycles forced where new tests live.** `test_unreadable_formula.py` → `test_analysis_servicer` / `test_owner_header_guard` → `test_readiness_materializer`. Every new servicer, heal or materializer case had to go into `test_unreadable_formula.py`, and `_META` is per-class and not importable. Import cycles drove test re-placement in 3 of the 7 impl-review rounds (2, 4, 5). Harness-vacuity traps drove 3 more (1, 3, 6).
- **The batch promotion plan was built from a stale checkout.** It proposed CREATE-ing three suites that would have duplicated every `@feature-289` scenario, which Step 14 (`642bcdbc`) had already promoted into 10 existing suites. The operator superseded it with a NO-OP plan.
  - This is the SECOND occurrence, after feature 269. The plan-time `@feature-<NNN>` grep should become binding.
- **`Opportunity` has no `signal_axis` field.** Assert axis, action and composite on the stored fake rows, not on the RPC response.
- **The readiness half was green on arrival.** `@AC-2/3/8/20` passed before Step 7, because the Step 5 evaluator sink already reaches every `compute_readiness_row` caller.
- **Codegen on this host.**
  - Host `buf-gen.sh` lacks `grpc_tools` and `tsc`. Use the cached `xstockstrat-codegen` image after `pnpm install`; the image has no `tsc`. Start `dockerd` if `docker info` fails.
  - A `buf breaking` negative control (temporarily renumbering a field → exit 100) proved the comparison against `origin/main-dev` was real.
- **UI tooling.**
  - Local Playwright `setup` warm-up times out at 10 s on a cold `pnpm dev`. Use `CI=1`.
  - pnpm does not hoist `@phosphor-icons/react`, so check icon exports under `services/xstockstrat-ui/node_modules`.

**Permanent deviations**:
- **Commit granularity.**
  - Plan: green at every step (design), one commit per step (execute skill §5.5).
  - Shipped: Steps 5+6 and Steps 7+8a+8b as two combined commits.
  - Because: the operator chose Option C at the Step 5 and Step 7 blockers. What the blockers were is not recorded beyond "Option C".
- **Required `formulaUnreadable`.**
  - Design: making `readinessState`'s `formulaUnreadable` required would make `tsc` flag `SignalReadiness.tsx` / `WatchlistReadiness.tsx` for edits.
  - Shipped: no edit there.
  - Because: those arguments are generated `SymbolReadiness` objects that already carry the field.
- **Act buttons.** Hidden for a non-held unreadable row. This is not in the design and no rationale is recorded; it follows the "fully non-actionable" UNSPECIFIED rule.
- **Promotion targets.**
  - Plan: impl-spec Step 14 listed the 185/190/177/275 suites. Design only said to add a clarifying line to the durable feature-185 suite.
  - Shipped:
    - a two-line comment under `@AC-1 @feature-185`;
    - `@AC-23` in the 215 suite;
    - `@AC-11` in the 224 suite (operator Option A);
    - `@AC-12` left unpromoted as an OVERLAP with `@AC-8 @feature-185`.
  - Because: `@AC-23` and `@AC-11` had no home in the listed suites.

**Cross-feature signal**:
- **Sibling paths left broken.** Feature 275 fixed the refusal on the backtest path only, so the opportunities and readiness siblings stayed broken. Same family as "fix one caller of a shared error mapping; siblings remain".
- **Repair-needed formulas also get the marker.** Feature 276's legacy-username `author` rows answer `NOT_FOUND` even to the formula's own owner, so the marker surfaces them too. That is why the UI copy reads "missing / private / author record needs repair".
- **Signed-off contract changes:**
  - feature-224 "skip the component with a warning";
  - feature-083 ranking for non-held rows;
  - a narrowing of `@AC-1 @feature-185`;
  - gate-ON FR-5 for backtest/ScoreStrategy.

**Deferred follow-ons**:
- `docs/reports/2026-11-05-analysis-readiness-batch-loss-on-indicator-outage-defect.md` (open): genuine-outage batch loss in the kick, materializer and heal, plus the `fetch_failed` symbol-wide bleed for the other markers.
- **Pre-rollout blast-radius measurement.** It measures how many existing quiet partial rows will flip to the marker at rollout: every owner of a deleted, legacy-author or hidden formula. It was owed in the integration PR body, and nothing records that it ran. Logs cannot size it, because the refusal line carries no user id and is deduped per evaluator. The SQL is preserved here:
  `SELECT s.user_id, s.strategy_id, c->>'formula_id', f.author FROM analysis.strategies s CROSS JOIN LATERAL jsonb_array_elements(s.definition_json::jsonb->'components') c LEFT JOIN indicators.formulas f ON f.formula_id::text = c->>'formula_id' WHERE coalesce(c->>'formula_id','') <> '' AND (f.formula_id IS NULL OR f.pending_intent_id IS NOT NULL OR (f.author <> s.user_id AND f.author <> 'system'));`
  - Do not add a `deleted_at` filter: soft-deleted formulas still execute.
  - Pair it with `legacy_authors` in report mode.
  - Cross-schema reachability on the DO cluster was never verified.
- **Latent UI noise, out of scope** (named as `/sdd-qa defect` candidates, none filed): `e2e/insights/backfills.spec.ts:135-136` TS2339, which CI does not catch because it has no standalone `tsc`, and 7 files that are not prettier-clean.
- **Acceptance OVERLAPs left for human consolidation:**
  - `@AC-5` / `@AC-22` vs feature-275 `@AC-1` / `@AC-7`;
  - `@AC-16` vs `private-by-default-templates.feature`.
- **Still unconfirmed:** which caller identity caused the 10-31 and 11-02 bursts. Narrowed, but not confirmed: the bursts came from a scope-propagating path (EvaluateReadiness, kick, heal or the ListOpportunities recompute), never from the owner-metadata scheduled passes. The design does not depend on it.
- **Accepted race.** A `GetFormula` refusal can be followed by an `ExecuteFormula` success:
  - during a legacy-author repair; or
  - when the template saga commits an analysis strategy before indicators un-hides its `pending_intent_id` copies.
  
  Either feeds `close` to a fundamentals-only formula once, and `FormulaExecutionError` aborts that recompute or heal. It self-heals on the next pass.

**Ledger entries written**: insights.md (2), fails.md (2) — see the 2026-11-10 entries. Existing entries were skipped: the 2026-11-05 sink reuse entry, the RED-ordering insight, the scope-mapping fail, the stale-digest fails, and the inert-hook fail.

**Runtime-invariant recommendations (→ /context-constitution)**:
- **ANALYSIS: register every new opportunities provenance token in all of these places**, or it turns into a source chip or is floored out:
  - `_PROVENANCE_STRUCTURAL_MARKERS`;
  - the SQL read floor;
  - `_row_to_opportunity` + `TestOpportunityRowParity._MAPPED`;
  - agent `_opportunity_to_dict` / `_full_opportunity`;
  - analysis `_FakeOppRepo`;
  - UI `e2e/mock-backend.ts` `MARKERS` / floor.
- **ANALYSIS:** the 300 s heal selector matches only `"unavailable"`. A non-retryable state must never carry that token.
- **ANALYSIS/INDICATORS:** `owner_metadata()` drops `x-access-scope`, so scheduled passes get `NOT_FOUND`, never the admin `PERMISSION_DENIED`.
- **ANALYSIS:** the `declared_formula_fundamentals` copies diverge on purpose. The servicer copy is refusal-aware; the live-loop evaluator copy records UNKNOWN. A DRY merge must not unify them. This is pinned by `test_fundamentals_pit_pager.py` and an `evaluator.py` constraint comment.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 2d91b5671335fcce267679b50caa494440205f51. Defect report `docs/reports/2026-11-04-analysis-admin-formula-refusal-misclassified-defect.md` (pruned 2026-11-10; `git show 2d91b567:docs/reports/2026-11-04-analysis-admin-formula-refusal-misclassified-defect.md`) (+ `.status`) was pruned in the same run.

## Retained verbatim records

Operator decisions and C-16 sign-offs copied verbatim from the pre-archive session log, because durable suites and later features cite "<NNN> context.md" as their provenance. Headings are demoted one level.

### Session 2026-11-05 — sdd-design round 2 gate (user decisions)
- Round-2 adversary: NEEDS WORK, no Floor breach. HIGH finding verified in code by the orchestrator (`servicer.py:1925-1929`, `fundamentals_guard.py:102-117`, `servicer.py:5762-5768`): with `analysis.backtest.fundamentals.enabled` ON (default OFF), a refused `GetFormula` is recorded as a fundamentals failure → UNKNOWN → the opportunity/heal paths stamp `unavailable` and never call `ExecuteFormula`, so the two stores disagree and the heal retries forever. Other findings (terminal-state ranking, invented ENTER/ADD action, neutral copy, blast-radius measurement, constructor flag vs private sink, `referenced_refs` reuse, AC-14 retirement form, UI completeness, gate-ON RED evidence, `fetch_failed` cross-candidate bleed as Open Risk) folded into round 3.
- **USER DECISIONS (explicit, AskUserQuestion):** (1) **Include** the `_formula_fundamentals` fix: a refused `GetFormula` (NOT_FOUND / PERMISSION_DENIED) is "not a fundamentals formula" (no failure recorded) so the refusal reaches `ExecuteFormula` and produces the marker; real outages still record UNKNOWN (feature-215 outage semantics preserved). (2) **Rank/action = zero both axes, action UNSPECIFIED** (the fundamentals-skip / fund_skip treatment) — recorded as a **C-16 CHANGE sign-off** against the feature-083 two-axis ranking contract for unreadable rows (signal axis zeroed; row fully non-actionable). (3) **Mechanism = private keyword-only sink, always-on inside the traced path** (no `flag_unreadable` constructor flag, no `ValueError` guards, no `for_owner` change). (4) **Run round 3** before approving.

### Session 2026-11-05 — sdd-design round 3 gate (user decisions)
- Round-3 adversary: SOUND, APPROVE WITH FOLDED FIXES, no Floor breach. Folded items: benchmark `source_symbol` call site (`evaluator.py:752`) must receive the sink; existing test `tests/test_unreadable_formula.py:293-307` (pins `(1, 2)`) is rewritten as the test-level face of the AC-14 retirement; blast-radius SQL corrected (`formula_id`, no `deleted_at` filter — soft-deleted formulas still execute); UI copy says "missing" not "deleted"; `sink.add` outside the log-dedupe block; UI file list adds `readinessCue.ts` / `readinessRollup.test.ts`.
- **USER DECISIONS (explicit, AskUserQuestion):**
  1. **`_formula_fundamentals` fix is GLOBAL** (all 9 callers incl. backtest `servicer.py:984` and ScoreStrategy `:2790`), contrary to the proposer/adversary recommendation (opportunities + heal only). Consequence to be spelled out in round 4 and re-confirmed at the final gate: with `analysis.backtest.fundamentals.enabled` ON, a refused formula in a backtest moves from UNKNOWN ("fundamentals fetch failed — rerun") to the FORMULA_ERROR path, ScoreStrategy evidence exclusion stops aborting on it, and `_declared_formula_warmup` (`:2543-2546`) must be made consistent. This is a **C-16 CHANGE of FR-5 / the backtest outcome with the gate ON** (not of `@AC-1/@AC-4/@AC-7 @feature-275`, which are gate-agnostic).
  2. **Held rows keep their signal action + signal axis**; the unreadable marker zeroes only readiness/conviction for held rows. Non-held rows: both axes zeroed, action UNSPECIFIED (round-2 decision 2). AC-18 pins both cases.
  3. **Run round 4** before approving.

### Session 2026-11-05 — sdd-design round 4 gate (user decisions)
- Round-4 proposer (final consolidated design) delivered; new fact: for an ADMIN, indicators `GetFormula` of a foreign formula succeeds (audited read, `indicators servicer.py:440-451`); only `ExecuteFormula` refuses (`:243-250`) — so the global `_formula_fundamentals` change matters for NOT_FOUND only (missing row, or a non-admin caller on a foreign/hidden/legacy-author formula). With `analysis.backtest.fundamentals.enabled` OFF there is zero change anywhere (`fundamentals_guard.py:94-95`).
- **USER DECISIONS (explicit, AskUserQuestion):**
  1. **CONFIRMED the global `_formula_fundamentals` change** — C-16 CHANGE of FR-5 with the gate ON, with this recorded before/after: (a) backtest (both the explicit-start and no-start branches; `_declared_formula_warmup` `:2543-2546` changed in lock-step so they don't split): UNKNOWN "fundamentals fetch failed — rerun", no diagnostics row → symbol evaluated, `NO_TRADE_REASON_FORMULA_ERROR` row + warning "backtest symbol SYM not evaluated: NOT_FOUND", INSUFFICIENT_DATA if nothing traded (identical to gate OFF); (b) ScoreStrategy / grade recompute (`servicer.py:2790` → `:2637-2643`): permanent UNAVAILABLE "grade unchanged" → the refused component is no longer "required", grade recomputed over surviving cells (accepted risk: may include ETF 0-trade cells the guard can no longer judge for a refused formula that really declares fundamentals); (c) opportunities + 300 s heal: stamped `unavailable` forever → the marker; (d) the live loop's `declared_formula_fundamentals` (`evaluator.py:669-681`) unchanged (live deny-entry ignores UNKNOWN); real outages (UNAVAILABLE, DEADLINE_EXCEEDED, …) still record UNKNOWN. No durable `@AC` text pins "refused `GetFormula` → UNKNOWN"; existing fixtures use UNAVAILABLE and stay green.
  2. **Held rows with a refused formula and no signal keep the existing fallback action (ADD)**; held + sell signal → REDUCE; non-held → UNSPECIFIED with both axes zeroed.
  3. **Run one short adversary pass on the round-4 delta** (global fundamentals change, held-row rule, hoisted `UNREADABLE_FORMULA_CODES`, benchmark call site) before approving.

_From: Session 2026-11-05 — sdd-design round 1 (recon.md written; proposer + adversary run; user gate)_

- **USER DECISIONS (explicit, AskUserQuestion, 2026-11-05) — C-16 sign-offs:**
  1. **Unify the refusal tuple**: under the new evaluator flag, both NOT_FOUND and PERMISSION_DENIED produce the unreadable-formula marker on every path. This **CHANGES `@AC-14` of this feature** (NOT_FOUND no longer a silent skip on the marker-bearing surfaces) and the feature-224 "other surfaces skip the component with a warning" contract in analysis `CLAUDE.md` § feature 224 (the NOT_FOUND log string "formula %s not readable by owner" is kept). Live loop / backtest unchanged (`@AC-5 @feature-224`, `@AC-1/@AC-7 @feature-275`).
  2. **Sign-off on narrowing `@AC-1 @FR-1 @feature-185`**: a formula-visibility refusal is no longer "data unavailable". Outage codes (UNAVAILABLE, DEADLINE_EXCEEDED) still yield the sentinel (pinned by `@AC-4`). At launch add a clarifying line to the durable feature-185 suite (C-16).
  3. **Marker / 0-of-0 only for unreadable formulas the traced rule references** (intersect unreadable ref names with the rule's leaf references); unreferenced foreign formulas keep today's skip behaviour (does not suppress a held-position exit).

_From: Session 2026-11-05 — sdd-design approved (COMPLETION)_

- **C-16 sign-offs recorded in this file:** unified refusal tuple (CHANGE of this feature's `@AC-14` and the feature-224 "skip" contract); narrowing `@AC-1 @feature-185`; non-held rank/action (feature-083 two-axis CHANGE); gate-ON FR-5 CHANGE with the before/after table (round-4 decision 1).

_From: Session 2026-11-05 — sdd-spec_

- Generated implementation-spec.md with 14 steps. Status design-approved → implementation-ready. Steps: 1 proto (fields 25 / 6), 2 proto-gen + the two descriptor-parity carries (analysis `_row_to_opportunity` + `TestOpportunityRowParity._MAPPED`; agent `_opportunity_to_dict` + `_full_opportunity`), 3/4 analysis read side service+test, 5/6 evaluator sink service+test, 7/8 servicer producer wiring service+test (incl. global `_formula_fundamentals` + `_declared_formula_warmup`, per-owner formula cache, rewrite of `test_unreadable_formula.py:293-307`), 9/10 agent (C-14) service+test, 11/12 UI (C-14) service+test, 13 docs (analysis/UI CLAUDE.md, strat-lab skill clause, operator note), 14 docs deferred to the integration PR (C-16 durable-suite promotion).

_From: Step 14 — docs: promote scenarios into the durable per-service suites (integration PR only) [done]_

- For the integration PR body (Instruction 3): the C-16 sign-offs are round-1 decisions 1-2, round-2 decision 2, round-3 decision 2 and round-4 decision 1.
