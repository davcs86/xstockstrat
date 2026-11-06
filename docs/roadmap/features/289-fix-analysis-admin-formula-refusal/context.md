# Context Log: fix-analysis-admin-formula-refusal

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-04 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-11-04-analysis-admin-formula-refusal-misclassified-defect.md` (Issues disabled): analysis treats indicators' admin-formula refusal as an outage / unhandled error
- Severity: SEV-2
- Routed to SDD path (Track C); environment recorded as dev (main-dev), Grafana label `staging`
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), status.md, context.md
- Affected services (from report): xstockstrat-analysis (consumer surfaces: xstockstrat-ui opportunities/readiness pages, xstockstrat-agent list_opportunities)
- Root cause hypothesis: Feature 275 added `raise_unreadable` handling only on the backtest evaluator; the opportunities and readiness paths use the default evaluator plus a broad `except grpc.RpcError` (`servicer.py:~5787`, `evaluator.py:226-273`). Lead: staging `fundsignal.scoring_formula_id` (d1ff5e6b-...) is the formula in the `EvaluateReadiness` FormulaExecutionError timeouts; check its owner vs the caller identity.
- Recommended design depth: full -> `/sdd-design fix-analysis-admin-formula-refusal` (rationale: SEV-2 plus named consumer surfaces (ui, agent) count as >=2 services (rubric escalate signal))
- Development branch: feature/fix-analysis-admin-formula-refusal
- Number 289 reserved via scripts/sdd-allocate-feature-number.sh (triage authorized by the operator, 2026-11-04)

---

## Session 2026-11-04 — re-verification after merging main-dev

- Merged `origin/main-dev` (39 commits, `3aedb964`) into the session branch; the only conflict was `docs/roadmap/ledger/insights.md` (both sides appended) — both sets of entries kept.
- **Code: defect still present, nothing in the merge touches it.** The merge brought no change to `services/xstockstrat-analysis/app/handlers/servicer.py`, `.../app/services/evaluator.py` or `services/xstockstrat-indicators/app/handlers/servicer.py` (analysis/indicators changes were the 243 sandbox-key check and acceptance-file tags only). `_compute_opportunities` still catches every `grpc.RpcError` as an indicators outage (`servicer.py:5787` "indicator RPC failed for %s"); `raise_unreadable=True` is still set only at the backtest evaluator construction (`servicer.py:2116`); `evaluator.py:_execute_formula` still lets `PERMISSION_DENIED` propagate when `raise_unreadable` is False. Indicators' AC-28 refusal is unchanged (`indicators/.../servicer.py:~248`).
- **Logs (Loki, staging, checked 2026-11-04 23:28 UTC): the defect is dormant, not fixed.** Last matching line is `_compute_opportunities: indicator RPC failed for MYSZ … admins cannot execute another user's formula` at 2026-11-02 04:07:43 UTC; none in the ~2.7 days since. The bursts were **2026-10-31 (3,298 lines)** and **2026-11-02 (920 lines)** — the earlier "2026-11-01 / 2026-11-03" labels in this feature's product-spec and the defect report were an off-by-one-interval error (the `[1d]` metric bucket at a timestamp counts the preceding 24 h); corrected in both. The `EvaluateReadiness` ERROR lines (7 `AioRpcError` + 5 `FormulaExecutionError` timeouts) date from the 2026-10-31 burst. The trigger for a burst (which caller identity / which scheduled compute runs the admin path) is still unconfirmed — keep it as a recon question for `/sdd-design`; absence of recent occurrences does not mean the code path is safe.
- Other features on the path: 215 (`launched`) reads `_compute_opportunities` but is unrelated; 294 `signal-map-instrumentation` (`implementation-ready`) adds analysis live-loop counters (FR-2/FR-5/FR-13) and edits `app/telemetry.py` / `live_loop.py` — low overlap with this fix, re-check when this feature has a spec.
- Status unchanged: `draft`. Severity (SEV-2) left as recorded; the dormancy is a reason to confirm severity at `/sdd-review`/`/sdd-design`, not to change it here.
- Next: `/sdd-review fix-analysis-admin-formula-refusal product-spec`, then `/sdd-design fix-analysis-admin-formula-refusal` (full — UI/agent consume the output).

---

## Session 2026-11-04 — sdd-review product-spec (verdict FAIL → spec revised)

- First review: FAIL, 4 blockers (no FR-N; scenarios untagged / vague; 3 unchecked Fix Scope items; no Consumer Surface(s) — C-14) + warnings. Overlap scan: warn-level only (no config/proto/migration collision); same-file rebase risk with 294 in `servicer.py` / `evaluator.py`; behavioural constraints from launched 275 (`@AC-5 @feature-224`), 215 (`EvaluateReadiness` must not pass `failures`) and 185 (catches `grpc.RpcError` only).
- **Correction (append-only; supersedes the earlier "Lead" in the triage-era product-spec):** the claim that `fundsignal.scoring_formula_id` (`d1ff5e6b-…`) explains the `PERMISSION_DENIED` was wrong — that is the system-seeded formula (`SYSTEM_AUTHOR`), and `_can_read_formula` returns True for it (`indicators/app/handlers/servicer.py:141-148`), so it can never trigger the admin refusal; a `FormulaExecutionError` timeout is also a different failure. Lead removed from the product spec.
- Revised product-spec + acceptance.feature: FR-1..FR-5 added; repro tightened to "admin-owned strategy, foreign-authored component formula" (the caller identity that triggered the bursts stays UNCONFIRMED — recon question); Consumer Surface(s) named (UI `/insights` opportunities + readiness panel, agent `list_opportunities`; each earns a step); additive proto field anticipated, no DB change (rides the provenance JSONB like `data_unavailable`); sibling `compute_readiness_row` callers (`GetWatchlistReadiness`, materializer) in scope per C-10(b); Out of Scope made explicit (AC-28, backtest `raise_unreadable`, live loop, 215 parity, timeouts); acceptance rewritten with concrete values (`admin-1`, `s-1`, `f-9`/`user-2`, `MYSZ`), tags, split paths and the outage-preserved regression (AC-4) and boundary guards (AC-5). Catch anchor is `servicer.py:5780-5790` (the earlier `~5787` pointed at the `log.warning` line inside it).
- Status stays `draft` until the revised spec is re-reviewed.

---

## Session 2026-11-04 — sdd-review product-spec (third pass; approved)

- Pass 2: FAIL (1 blocker — both Consumer Surface boxes unchecked). Pass 3: **PASS WITH WARNINGS, 0 blockers**; all warnings addressed: AC-9 re-based on the real bug path (a previously data-unavailable row older than 300 s whose heal now meets `PERMISSION_DENIED`; the `:5129` catch would re-stamp it "unavailable" and retry forever); AC-3 asserts the real "readiness refresh kick failed" warning (the kick's exception sits outside the per-symbol loop, so one unreadable symbol would discard the whole batch — a sibling `AAPL` entry must also resolve); AC-8 labelled defense-in-depth; Background bound `s-2` to `AAPL`; AC-7 is a Scenario Outline naming `/insights/opportunities`, `/insights/watchlists`, `/trader/positions/[symbol]` (`SignalReadiness.tsx`, the "Why this fired" panel) and the mobile section; AC-11 (live loop unchanged) and AC-12 (300 s heal still works on recovery) appended; AC-4 no longer compound.
- **New fact for recon (verified in code):** the daily opportunity refresh (`servicer.py:5982`) and the readiness materializer (`:6031`) use `owner_metadata()` (`app/identity.py:10`), which carries only `x-user-id` and drops `x-access-scope`; indicators returns `PERMISSION_DENIED` only on the admin bit (`indicators servicer.py:245`), else `NOT_FOUND` (skipped). So the 2026-10-31 / 2026-11-02 bursts most likely came from a path that propagates the inbound scope — `EvaluateReadiness`, `_kick_readiness_refresh`, the heal, or the `ListOpportunities`-triggered recompute (`:4894`) — not the scheduled passes. Still to be confirmed in `/sdd-design` recon.
- Recommended design depth: full. Status: draft → spec-ready.

---

## Session 2026-11-04/05 — loop round 1 (fixes)

- Round-1 review: PASS WITH WARNINGS, 0 blockers; three warnings fixed: AC-7 is a Scenario Outline with a data-source column (opportunity row for `/insights/opportunities` and the mobile section; readiness entry/result for `/insights/watchlists` and `/trader/positions/[symbol]`) and is tagged `@FR-2 @FR-3`; AC-9's Given now places `MYSZ` on `admin-1`'s watchlist (the heal stages a readiness-cache entry only for a watchlist entry-rule pair, `servicer.py:5181-5187`); AC-10 split — AC-10 is the opportunities-recompute timeout (recompute fails, no rows replaced), **AC-13** appended for the `EvaluateReadiness` timeout (RPC aborts, not converted to a 0/0 unreadable result). Recon note: `app/main.py:157` (live-loop evaluator) is explicitly excluded.

## Session 2026-11-05 — loop round 2 (product-spec review)
- Added `@AC-14` (NOT_FOUND skip behaviour pinned, C-16; the realistic scheduled-pass path since `owner_metadata()` drops the admin bit). AC-10/AC-13 Givens reworded to `success=false` "timed out after 5000ms" (not an RPC `DEADLINE_EXCEEDED`, which FR-4 treats as data-unavailable). AC-8/AC-11 flagged stub-level.

- Round 3 (product-spec): FR-1 "sinks in the ranking" removed (no assertion; rank position deferred to /sdd-design); AC-8/AC-9 Thens reworded to observable readiness verdicts; anchors/date refreshed.

## Session 2026-11-05 — sdd-design round 1 (recon.md written; proposer + adversary run; user gate)
- Recon: recon.md written (tree stamp: `ccr-e5badadb-vrersi@70e0d5ab`, documented deviation — HEAD is not on main-dev because the 289–293 artifacts exist only on the PR branch). Premise corrections recorded in recon.md § Risks (the heal's `except grpc.RpcError` at `servicer.py:5129` already catches PERMISSION_DENIED as an outage; `_compute_opportunities` is not a `compute_readiness_row` caller; `compute_readiness_row` has no `failures` parameter).
- Round-1 adversary verdict: NEEDS WORK, no Floor breach. Strongest finding (verified against code paths by the adversary, recon-consistent): the daily refresh (`servicer.py:5982`) and materializer (`:6031`) use `owner_metadata` (no admin bit) → indicators answers NOT_FOUND → they overwrite the marker with a quiet skipped-component row valid ~24 h; non-admin owners with a foreign/legacy-author formula never see the marker.
- **USER DECISIONS (explicit, AskUserQuestion, 2026-11-05) — C-16 sign-offs:**
  1. **Unify the refusal tuple**: under the new evaluator flag, both NOT_FOUND and PERMISSION_DENIED produce the unreadable-formula marker on every path. This **CHANGES `@AC-14` of this feature** (NOT_FOUND no longer a silent skip on the marker-bearing surfaces) and the feature-224 "other surfaces skip the component with a warning" contract in analysis `CLAUDE.md` § feature 224 (the NOT_FOUND log string "formula %s not readable by owner" is kept). Live loop / backtest unchanged (`@AC-5 @feature-224`, `@AC-1/@AC-7 @feature-275`).
  2. **Sign-off on narrowing `@AC-1 @FR-1 @feature-185`**: a formula-visibility refusal is no longer "data unavailable". Outage codes (UNAVAILABLE, DEADLINE_EXCEEDED) still yield the sentinel (pinned by `@AC-4`). At launch add a clarifying line to the durable feature-185 suite (C-16).
  3. **Marker / 0-of-0 only for unreadable formulas the traced rule references** (intersect unreadable ref names with the rule's leaf references); unreferenced foreign formulas keep today's skip behaviour (does not suppress a held-position exit).
- Consequences to apply to product-spec.md / acceptance.feature after design approval (append-only AC IDs): FR-1 NOT_FOUND clause, AC-14 reversed (new ID for the new behaviour), referenced-component scoping scenarios, daily-refresh/materializer scenario with owner metadata.

## Session 2026-11-05 — sdd-design round 2 gate (user decisions)
- Round-2 adversary: NEEDS WORK, no Floor breach. HIGH finding verified in code by the orchestrator (`servicer.py:1925-1929`, `fundamentals_guard.py:102-117`, `servicer.py:5762-5768`): with `analysis.backtest.fundamentals.enabled` ON (default OFF), a refused `GetFormula` is recorded as a fundamentals failure → UNKNOWN → the opportunity/heal paths stamp `unavailable` and never call `ExecuteFormula`, so the two stores disagree and the heal retries forever. Other findings (terminal-state ranking, invented ENTER/ADD action, neutral copy, blast-radius measurement, constructor flag vs private sink, `referenced_refs` reuse, AC-14 retirement form, UI completeness, gate-ON RED evidence, `fetch_failed` cross-candidate bleed as Open Risk) folded into round 3.
- **USER DECISIONS (explicit, AskUserQuestion):** (1) **Include** the `_formula_fundamentals` fix: a refused `GetFormula` (NOT_FOUND / PERMISSION_DENIED) is "not a fundamentals formula" (no failure recorded) so the refusal reaches `ExecuteFormula` and produces the marker; real outages still record UNKNOWN (feature-215 outage semantics preserved). (2) **Rank/action = zero both axes, action UNSPECIFIED** (the fundamentals-skip / fund_skip treatment) — recorded as a **C-16 CHANGE sign-off** against the feature-083 two-axis ranking contract for unreadable rows (signal axis zeroed; row fully non-actionable). (3) **Mechanism = private keyword-only sink, always-on inside the traced path** (no `flag_unreadable` constructor flag, no `ValueError` guards, no `for_owner` change). (4) **Run round 3** before approving.

## Session 2026-11-05 — sdd-design round 3 gate (user decisions)
- Round-3 adversary: SOUND, APPROVE WITH FOLDED FIXES, no Floor breach. Folded items: benchmark `source_symbol` call site (`evaluator.py:752`) must receive the sink; existing test `tests/test_unreadable_formula.py:293-307` (pins `(1, 2)`) is rewritten as the test-level face of the AC-14 retirement; blast-radius SQL corrected (`formula_id`, no `deleted_at` filter — soft-deleted formulas still execute); UI copy says "missing" not "deleted"; `sink.add` outside the log-dedupe block; UI file list adds `readinessCue.ts` / `readinessRollup.test.ts`.
- **USER DECISIONS (explicit, AskUserQuestion):**
  1. **`_formula_fundamentals` fix is GLOBAL** (all 9 callers incl. backtest `servicer.py:984` and ScoreStrategy `:2790`), contrary to the proposer/adversary recommendation (opportunities + heal only). Consequence to be spelled out in round 4 and re-confirmed at the final gate: with `analysis.backtest.fundamentals.enabled` ON, a refused formula in a backtest moves from UNKNOWN ("fundamentals fetch failed — rerun") to the FORMULA_ERROR path, ScoreStrategy evidence exclusion stops aborting on it, and `_declared_formula_warmup` (`:2543-2546`) must be made consistent. This is a **C-16 CHANGE of FR-5 / the backtest outcome with the gate ON** (not of `@AC-1/@AC-4/@AC-7 @feature-275`, which are gate-agnostic).
  2. **Held rows keep their signal action + signal axis**; the unreadable marker zeroes only readiness/conviction for held rows. Non-held rows: both axes zeroed, action UNSPECIFIED (round-2 decision 2). AC-18 pins both cases.
  3. **Run round 4** before approving.

## Session 2026-11-05 — sdd-design round 4 gate (user decisions)
- Round-4 proposer (final consolidated design) delivered; new fact: for an ADMIN, indicators `GetFormula` of a foreign formula succeeds (audited read, `indicators servicer.py:440-451`); only `ExecuteFormula` refuses (`:243-250`) — so the global `_formula_fundamentals` change matters for NOT_FOUND only (missing row, or a non-admin caller on a foreign/hidden/legacy-author formula). With `analysis.backtest.fundamentals.enabled` OFF there is zero change anywhere (`fundamentals_guard.py:94-95`).
- **USER DECISIONS (explicit, AskUserQuestion):**
  1. **CONFIRMED the global `_formula_fundamentals` change** — C-16 CHANGE of FR-5 with the gate ON, with this recorded before/after: (a) backtest (both the explicit-start and no-start branches; `_declared_formula_warmup` `:2543-2546` changed in lock-step so they don't split): UNKNOWN "fundamentals fetch failed — rerun", no diagnostics row → symbol evaluated, `NO_TRADE_REASON_FORMULA_ERROR` row + warning "backtest symbol SYM not evaluated: NOT_FOUND", INSUFFICIENT_DATA if nothing traded (identical to gate OFF); (b) ScoreStrategy / grade recompute (`servicer.py:2790` → `:2637-2643`): permanent UNAVAILABLE "grade unchanged" → the refused component is no longer "required", grade recomputed over surviving cells (accepted risk: may include ETF 0-trade cells the guard can no longer judge for a refused formula that really declares fundamentals); (c) opportunities + 300 s heal: stamped `unavailable` forever → the marker; (d) the live loop's `declared_formula_fundamentals` (`evaluator.py:669-681`) unchanged (live deny-entry ignores UNKNOWN); real outages (UNAVAILABLE, DEADLINE_EXCEEDED, …) still record UNKNOWN. No durable `@AC` text pins "refused `GetFormula` → UNKNOWN"; existing fixtures use UNAVAILABLE and stay green.
  2. **Held rows with a refused formula and no signal keep the existing fallback action (ADD)**; held + sell signal → REDUCE; non-held → UNSPECIFIED with both axes zeroed.
  3. **Run one short adversary pass on the round-4 delta** (global fundamentals change, held-row rule, hoisted `UNREADABLE_FORMULA_CODES`, benchmark call site) before approving.

## Session 2026-11-05 — sdd-design approved (COMPLETION)
- Phase 0 Recon: recon.md (services: analysis, ui, agent; key reuse: the provenance-marker template `_add_provenance`/`_row_to_opportunity`/floor clause, `referenced_refs`, `_empty_readiness`, the agent descriptor-parity guard).
- Phase 1 Grilling: 4 rounds (full) plus a targeted adversary pass on the round-4 delta (SOUND / APPROVE WITH FOLDED FIXES, no Floor breach). The user chose that pass and "then approve" at the round-4 gate; the pass found one narrow HIGH (cross-owner formula-cache poisoning in `recompute_unscored_pairs` `servicer.py:3074-3086`, verified in code) which is folded into the design (per-owner formula cache; `design.md` § Fundamentals gate) — no new user-level decision. Chosen approach: private always-on per-call sink in the traced evaluator, bool `formula_unreadable` (25 on Opportunity, 6 on SymbolReadiness) riding the provenance token / `readiness_json`, referenced-only marking, unified NOT_FOUND+PERMISSION_DENIED, fund_skip-style non-held rank/action with held rows keeping their signal action and axis, global `_formula_fundamentals` refusal classification (+ `_declared_formula_warmup` lock-step). Rejected: constructor flag, scope-dependent marker, admin-scope propagation, reason enum, partial 0/N, 300 s retry of unreadable rows, fundamentals fix scoped to opportunities+heal (overridden by the user), never-cache-refusals (full list in design.md).
- Constitution rules touched: C-04, C-09, C-10(b), C-14, C-15, C-16, C-17, C-18, C-03, F-04. Floor breaches: none in any round.
- **C-16 sign-offs recorded in this file:** unified refusal tuple (CHANGE of this feature's `@AC-14` and the feature-224 "skip" contract); narrowing `@AC-1 @feature-185`; non-held rank/action (feature-083 two-axis CHANGE); gate-ON FR-5 CHANGE with the before/after table (round-4 decision 1).
- Product-spec/acceptance amended: FR-1/2/3/5 rewritten, FR-6/FR-7 added, proto/Out-of-Scope updated; `@AC-14` deleted (retired-ID comment), `@AC-7`/`@AC-8` edited in place, Background gains "entry rule of s-1 references f-9", `@AC-15..@AC-27` appended.
- Follow-up filed: `docs/reports/2026-11-05-analysis-readiness-batch-loss-on-indicator-outage-defect.md` (+ `.status` open).
- Open Threads (target step): blast-radius SQL + `legacy_authors` report before the dev rollout (PR body); verify `LockSimple` in `@phosphor-icons/react` (UI step); re-verify line anchors after 291/294 rebases (`/sdd-spec`); add a `merge-order.md` row for 294 only if its spec edits `_execute_formula` (`/sdd-review impl-spec` overlap scan); add the live-loop-divergence Open Risk to the analysis `CLAUDE.md` § feature 224 bullet (docs step).
- Status: spec-ready → design-approved.

## Session 2026-11-05 — sdd-spec

- Generated implementation-spec.md with 14 steps. Status design-approved → implementation-ready. Steps: 1 proto (fields 25 / 6), 2 proto-gen + the two descriptor-parity carries (analysis `_row_to_opportunity` + `TestOpportunityRowParity._MAPPED`; agent `_opportunity_to_dict` + `_full_opportunity`), 3/4 analysis read side service+test, 5/6 evaluator sink service+test, 7/8 servicer producer wiring service+test (incl. global `_formula_fundamentals` + `_declared_formula_warmup`, per-owner formula cache, rewrite of `test_unreadable_formula.py:293-307`), 9/10 agent (C-14) service+test, 11/12 UI (C-14) service+test, 13 docs (analysis/UI CLAUDE.md, strat-lab skill clause, operator note), 14 docs deferred to the integration PR (C-16 durable-suite promotion).
- **Tree:** `ccr-e5badadb-vrersi@a75d1916 ≡ origin/main-dev +32 unpushed (documented deviation: HEAD not on main-dev; feature branch not on origin; 289 artifacts exist only on this branch; user-accepted 2026-11-05)` (`git rev-list --left-right --count HEAD...origin/main-dev` → `32 0`). Supersedes the recon-time stamp `@70e0d5ab`.
- Scenario coverage: every @AC-1..13 and @AC-15..27 is mapped to a step in the spec's Execution Summary (AC-14 retired, not covered). C-14: UI = Steps 11/12, agent = Steps 9/10.
- Key codebase findings:
  - All `design.md` / `recon.md` line anchors re-verified in this tree; they still resolve. Corrections only: `test_fundamentals_pit_pager.py` servicer sibling `:295-302` and evaluator sibling `:304-311` (design cited `:304-309`; both use UNAVAILABLE today, NOT_FOUND parameters are added); `test_grade_fundamentals_exclusion.py` boot-pass test `:387-396`, `GetFormula` count assertion `:395`; `WatchlistReadiness.tsx` switches at `:52` (`barVariant`) and `:74` (`stateLabel`), rollup `:235`, cue `:296` (design cited `:59,81`); agent `_opportunity_to_dict` docstring starts `client.py:817`, whitelist keys `:838-841`.
  - The descriptor-parity guard that needs the carry on the analysis side is `tests/test_analysis_servicer.py:6379` `TestOpportunityRowParity._MAPPED` (`:6385-6411`); on the agent side `tests/test_opportunity_projection.py` `_full_opportunity` + `test_opportunity_projection_covers_every_proto_field`. Step 2 therefore combines regen and both carries so the guards never go red on a step PR.
  - `recompute_unscored_pairs` (`servicer.py:3064-3089`): `formula_cache` `:3075` is shared across owners; `failures` `:3076` is also shared (records outages only after the change) and is left alone; per-owner `formula_caches.setdefault(user_id, {})` is the fix.
  - `_assemble_sector_resolved` (`evaluator.py:472`) is used only by `evaluate_with_series` (backtest) and `GetIndicatorSeries` calls `_assemble_component_series` / `_compute_component` directly (`servicer.py:4541-4567`) without a sink, so both stay byte-identical.
  - Feature 294 Step 13 touches `evaluator.py` only at the `fundamentals formula=` `log.info` → `log.debug` (`evaluator.py:613-614`) and `servicer.py` ticks / the `PIT fundamentals loaded` log (`~:1894-1896`); it does not edit `_execute_formula`, so no `merge-order.md` row is added (rebase-only, noted in Step Dependencies). Feature 293 touches analysis `live_loop.py` / tests / CLAUDE.md config rows only.
  - Strat-lab rule (root `CLAUDE.md`): the gate-ON backtest outcome change (refused formula: "fundamentals fetch failed — rerun" → FORMULA_ERROR) lands in Step 13 as a one-sentence clause in `plugins/strat-lab/skills/backtest/SKILL.md` (`:178-199`) and `reference/output-handling.md` (`:25-36`).
  - Teardown (root `CLAUDE.md`): Step 13 edits context files; `/context-forge:context-constitution refresh` (or the manual re-read, recorded in the PR body) is owed before pushing.
- **Not found / unverified:** `LockSimple` in the installed `@phosphor-icons/react` (no `node_modules` in this tree; `^2.1.7` in `package.json`; no existing import in `src/`) — Step 11 verifies after `pnpm install`, fallback `Lock`; cross-schema reachability of the blast-radius SQL on the DO cluster; exact generated-stub paths beyond `git ls-files packages/proto/gen | grep analysis/v1`; the live twin `evaluator.declared_formula_fundamentals` has no existing NOT_FOUND test (added in Step 8).
- No decision needs the user. Open Threads carried: blast-radius SQL + `legacy_authors` report before the dev rollout (operator, PR body); `LockSimple` check (Step 11); Step 14 deferred to the integration PR.

## Session 2026-11-05 — sdd-review impl-spec loop round 1 (fixes)

All 12 warnings from the `/sdd-review impl-spec` pass were verified against the tree and applied to `implementation-spec.md` (none rejected). `design.md`, product-spec and the C-16 sign-offs are untouched; no step body changed beyond what a warning required.

- W1 (Step 11): `readinessRollup.test.ts` mechanical edits now cover the 5 `readinessState` calls (`:6-9`, `:13`) AND the `rollupReadiness` row literals (`:27-30`, `:40`), the `:35` `toEqual` (`unreadable: 0`) and the sum invariants (`:50`, `:57`, `+ c.unreadable`).
- W2 (Step 1): `buf breaking` now compares against `origin/main-dev` (the CI form, `ci.yml` `origin/${base_ref}`); the vacuous self-comparison and the "create the feature branch" sentence are removed.
- W3 (Step 4): `_empty_readiness` import noted; FAST case rewritten around a custom-formula row plus `_readiness_cache_repo = MagicMock(read_many=AsyncMock(...))` with a fresh fingerprint/`valid_until`/`bar_epoch` row (the stock `_svc`/`_FakeReadinessCache` made the "never awaited" assertion vacuous); the AC-21 round-trip moved to `test_opportunities_repo.py` beside `test_row_to_opportunity_skip_row_round_trip` (`:592`); TDD qualified (only `source == ""` is red); template cite fixed to `:549-558`.
- W4 (Step 6): Instruction 5 replaced (`_execute` gains `ref_name="z"` and an optional `sink`; sink, `raise_unreadable`, and no-sink assertions); TDD RED text corrected (no `TypeError` on the public API).
- W5 (Step 6): Instruction 7 now requires a real `StrategyEvaluator` over a refusing stub, `_compute(evaluator=, definition=)`, non-empty bars; `_fake_evaluator` explicitly not reused.
- W6 (Step 7): the dead "pop `formula_unreadable`" sentence deleted (verified: the evaluator is not called when `fund_skip or fund_unknown`, `servicer.py:~5768`); precedence reworded to `fund_skip > unreadable > sibling-fetch_failed unavailable`. The spec had no "kept equal / popped" clause elsewhere (Execution Summary included), so nothing further to delete.
- W7/W8 (Step 8a): fixtures parameterized (`_definition(z_ref, formula_id, strategy_id)`, `_row` derives from the definition) with `_WARNING` as the log literal; Gherkin names declared narrative; s-2/s-3 rows specified via `_materialized_svc(strategies={...})`; the AC-11 live-loop clause is now a NEW PERMISSION_DENIED test asserting one `live_loop: (s-1,<sym>) error: … — continuing` WARNING on logger `app.engine.live_loop`.
- W9 (Steps 9/10): Step 10 TDD rewritten — Instructions 1-2 are green-on-arrival guards (Step 2 carried the key); only Instruction 3 (docstring) is red and `/sdd-execute` must write it before Step 9's edit. AC-6 stays under Step 10's **Covers** (guard-covered projection). Step 9's TDD line updated to match.
- W10 (Step 12): marked-row fixtures explicitly NOT added to `OPPORTUNITIES`; queue surfaces use a per-test `page.route`; `symbol === 'MYSZ'` pool branch in `mock-backend.ts listOpportunities`; override keyed `MYSZ` (grep confirms no existing MYSZ in `e2e/`) with the `formulaUnreadable?` type extension; the EXIT branch (`mock-backend.ts:1018-1019`) is changed to spread the override for the held variant; verification notes `vitest.config.ts` thresholds (adjusted from the warning: actual thresholds are lines/functions/statements 40, all on `src/lib/**`).
- W11 (Step 13 / deps): verification adds `python3 plugins/strat-lab/scripts/validate.py --self-test && python3 plugins/strat-lab/scripts/validate.py` (script and flags verified); Step Dependencies gains the same-PR rule (Step 13 strat-lab edits ship with Step 7's gate-ON behaviour change; with per-step PRs that is the integration PR; do not merge Step 7/8b to `main-dev` without Step 13).
- W12 (Step 8 split): Step 8 is now 8a (opportunities, readiness, heal, materializer/refresh/kick; covers AC-1..5, 8..13, 15..21, 26) and 8b (gate-ON backtest/score/opportunities, `_formula_fundamentals` pit-pager parity, per-owner cache; covers AC-22..25); each has Files (5 and 4), TDD, Covers, Verification, Status. Other steps are not renumbered. Execution Summary, Scenario Coverage, Step Dependencies (Step 7 now paired with 8a+8b) and all cross-references updated; every live AC (1-13, 15-27) is still covered and `@AC-14` stays retired.
- Not re-verified in this round (carried): line anchors in `servicer.py` beyond those re-read here; `LockSimple` availability; blast-radius SQL reachability.

## Session 2026-11-05 — sdd-review impl-spec loop round 2 (fixes)

All 7 warnings from round 2 were verified against the tree; all applied (none rejected). `design.md` changed only in the optional precedence/popped alignment below.

- Round 2 (impl-spec) W1 (Steps 5/6/8a): traced `_compute_opportunities` (`servicer.py:5770-5861`): after Step 5 the marker trace is stored as `readiness_json`, so `test_list_opportunities_unreadable_formula_is_not_unavailable` (`test_unreadable_formula.py:293-307`) yields `(0, 0)` (data_unavailable False) before Step 7; the `(1, 2)` pin would be red. Added Step 6 Instruction 8 (interim re-pin to `(0, 0)`), a Step 6 Codebase Evidence bullet, a Step 5/6 boundary note, and Step 8a Instruction 1 now says the interim assertion becomes the full rewrite.
- Round 2 W2 (Step 4/8a): the FAST `EvaluateReadiness` case moved from `test_analysis_servicer.py` to `test_unreadable_formula.py` (verified `:20-28` imports from `test_analysis_servicer`, so the reverse import is circular; copying would duplicate, C-13). Step 4 Files, Evidence, Instruction 2 and Verification updated; Instruction 2 now sets `GetFormula = AsyncMock(return_value=SimpleNamespace(fundamental_inputs=[]))` (verified: `TestEvaluateReadiness._svc` has a bare `MagicMock` indicators and `_formula_fundamentals` at `servicer.py:3973` awaits `GetFormula`), `ComputeIndicator` and a best-effort `_marketdata` stub; `_definition_fingerprint` is imported from `app.handlers.servicer` (`:7209`). The same `GetFormula` note added to Step 8a Instruction 3 (SLOW case). `_empty_readiness` import is no longer attributed to `test_analysis_servicer.py`.
- Round 2 W3 (Step 6): added Instruction 0 (`_traced_evaluator(execute_side_effect, *, component_sem)` with an awaitable `ComputeIndicator` via `_sma_resp(req)`; `_definition_two_formulas()` with `z`/`f-zscore` and `z2`/`f-timeout` for Instruction 3; Instruction 7's `RecordingStub` gains `"ComputeIndicator": _sma_resp`). Verified `_sma_resp(req)` exists at `test_unreadable_formula.py:82` and the existing `**_kw` lambda form at `:265`, which is used instead of `metadata=None`.
- Round 2 W4 (Step 13): verified `CLAUDE.md:52` reads "skip the component with a warning" (the old grep said "skips", count 0, `grep -c` exits 1). Verification now uses `! grep -q "skip the component with a warning"`; Instruction 3 writes a `(feature 289)` marker into both strat-lab files and a final `grep -n "feature 289"` over them confirms the edits (the existing files already contain `NOT_FOUND`/`PERMISSION_DENIED`, so that pair would not discriminate).
- Round 2 W5 (Step 12): `tsconfig.json:21` includes `**/*.ts`; `mock-backend.ts` floor emulation now uses `(o as { formulaUnreadable?: boolean }).formulaUnreadable`. Dropped the `opportunities.spec.ts:57` "same exemption" sentence and Files mention (it filters `OPPORTUNITIES`, which excludes the marked rows); any test routing the marked row through `mockOpportunities` must use the same cast.
- Round 2 W6 (Step 12): option (a). The EXIT-branch/`exitReadiness` bullet and Files phrase are deleted: @AC-27 is a `/insights/opportunities` (ListOpportunities) scenario, served by the per-test route, and no assertion exercises a held `EvaluateReadiness` EXIT path. The `MYSZ` pool branch now states it serves the non-held variant only.
- Round 2 W7 (Steps 8b/11): verified `GetFormula` count assertion is `test_grade_fundamentals_exclusion.py:396` (`:395` is the `GetHistoricalFundamentals` count) and the `states` list is `opportunityShared.test.ts:9`; all occurrences fixed (Execution Summary anchor note, 8b Evidence, 8b Instruction 2, Step 11 Files).
- Round 2 optional: `design.md` § Consumers (analysis) precedence is now `fund_skip > unreadable > sibling-fetch_failed unavailable` (with the reason an `unavailable` from `fund_unknown` cannot coexist), and the dead "popped when suppressed" clause is removed there and in the Persistence bullet (line 17).

## Session 2026-11-05 — sdd-review impl-spec loop round 3 (fixes)

All 5 items from round 3 were verified against the tree; all applied, one adjusted.

- Round 3 (impl-spec) item 1 (Steps 4/8a): `servicer.py:547` sets `_strategies_repo = StrategiesRepository(db_pool) if db_pool else None` and `make_servicer()` passes no pool, so attribute assignment on it raised `AttributeError`. Step 4 Instruction 2(b) now assigns `svc._strategies_repo = MagicMock(get_by_owner_and_id=AsyncMock(return_value=row_of_strategy))` (with the `_write_svc` precedent, `test_unreadable_formula.py:~191-197`); Step 8a Instruction 3 reuses it for the SLOW/FAST setups.
- Round 3 item 2 (Step 8a): verified `_FakeOppRepo` (`test_analysis_servicer.py:4500`): `read` floor exempts only `denied`/`unavailable` (`~:4544-4550`), `available_sources` skips only `watchlist`/`position`/`denied` (`~:4586`). Step 8a Evidence gains the fake-repo-gap bullet, Instruction 0 gains the `_FakeOppRepo` extension (floor condition + skipped-origin tuple), and the Files line for `test_analysis_servicer.py` names it. Real-SQL floor/source behaviour stays covered by Step 4.
- Round 3 item 3 (adjusted): added characterization/red notes to Step 8a and 8b TDD. 8a characterization = AC-4, 5, 10, 11, 12, 13 (green on arrival); AC-26 moved to the RED list (the test first asserts the marked state, which is red today; the requested list had it as characterization). AC-16's `s-2` assertions are green but live in the same test as red `s-1` assertions (noted). 8b: AC-25 characterization; AC-22/23/24 red.
- Round 3 item 4 (Step 13): the third verification `grep -n "feature 289" A B` (passes on one file's hit) replaced by a per-file `for … grep -q … || { echo …; exit 1; }` loop.
- Round 3 item 5: Step 8a Instruction 0 now adds `import logging` to `test_unreadable_formula.py` (verified absent; no `caplog` use today) for the AC-11 live-loop test. Step 11: `readinessVariant(passing: number, total: number)` (`opportunities/page.tsx:60`, calls `readinessState` at `:61`) gains `formulaUnreadable`; its only call site is `:559` (grep-confirmed); both the Call sites evidence list and Instruction 2 updated.

## Session 2026-11-05 — sdd-review impl-spec loop round 4 (fixes)

Both items from round 4 were verified against the tree; both applied, plus the optional caplog filter. No claim was wrong. `design.md` untouched.

- Round 4 (impl-spec) item 1 (Step 10): Instruction 3 modifies and Verification runs `tests/test_tools.py` but Files omitted it. Added `services/xstockstrat-agent/tests/test_tools.py — modify (list_opportunities docstring mentions formula_unreadable)` to Step 10 Files. Verified `test_tools.py:1103-1111` (`test_docs_surfaces_state_rule_string_or_object`) is the docstring-assertion pattern (`server._tool_manager.get_tool(name).description`, whitespace-normalized) and `test_tools.py:2049+` already hosts the `list_opportunities` tool tests; `tests/test_list_correlation_parity.py:122` pins a different `list_opportunities` docstring concern (join keys) and stays unmodified. Evidence bullet added.
- Round 4 item 2a (Step 8a placement): verified `test_unreadable_formula.py:20-28` imports from `tests.test_analysis_servicer` (a reverse import would be circular) and that `_row`/`_definition`/`_not_found`/`_sma_resp` are defined in `test_unreadable_formula.py` (`:34,:38,:69,:82`). The `EvaluateReadiness` SLOW/FAST/timeout cases and the heal cases therefore move to `test_unreadable_formula.py`; `_unavailable_served_row` (`:4665`) and `_FakeReadinessCache` (`:4651`) are module-level in `test_analysis_servicer.py` and importable. `test_analysis_servicer.py`'s Files entry is now "Instruction 0 only"; the `TestUnguardedReadinessParity_feature215` re-run is noted only in Verification. Instruction 0(ii) also adds `timedelta` plus the two imports; Instructions 2/3/5 state the new home; Evidence gains a placement bullet. `_META` is a per-class attribute (`:5465`, `:5813`, `:7847`), not importable, so heal cases declare their own.
- Round 4 item 2b (Step 8a Instruction 5): verified `_FakeOppRepo.replace_symbols` (`test_analysis_servicer.py:4591-4611`) copies conviction/readiness_json/signal_axis/provenance/thesis/valid_until/composite/symbol_score but never `action`; `_spy_heal` is `test_opportunities_fundamentals_guard.py:366-370` (also sets `svc._readiness_cache_repo = _FakeReadinessCache()`); `_materialized_svc` sets `svc._opportunities_repo = _FakeOppRepo()` (`:4790`), so the attribute name is `_opportunities_repo`. Instruction 5 now asserts `action` via an inline spy on `svc._opportunities_repo.replace_symbols` reading `spy.await_args.args[1]` (C-13: declared inline, not imported across test files).
- Round 4 optional (AC-11 live-loop test): verified `live_loop.py:62` `log = logging.getLogger(__name__)` and the warning at `:479`; the test now filters `caplog.records` on `r.name == "app.engine.live_loop"` and WARNING level before counting the single match.
- Coverage unchanged: AC-1..13 and AC-15..27 covered (AC-14 retired); Step 8a `Covers`, Step 10 `Covers: AC-6` and Step Dependencies are unaffected (no step moved, only test placement within 8a).

## Session 2026-11-05 — sdd-review impl-spec loop round 5 (fixes)

One item from round 5 verified against the tree and applied. `design.md` untouched.

- Round 5 (impl-spec) item (Step 8a placement): verified `test_readiness_materializer.py:23-24` `_live_row` wraps `_simple_strategy_row()`, `test_watchlist_readiness.py:24` (`_wl_svc`) and `test_opportunity_refresh.py` have no custom-formula strategy builder, and that importing `_row`/`_definition` into `test_readiness_materializer.py` is circular (`test_unreadable_formula.py:29` -> `tests.test_owner_header_guard`, whose `:31` imports `_due_schedule`, `_live_row`, `_materializer_svc` from `tests.test_readiness_materializer`). Step 8a now places the @AC-3 kick end-to-end case (via `_cache_svc(bars_by_symbol, strategy_row=None)` from `tests.test_readiness_cache`, `:27`) and the @AC-8/@AC-19 materializer and daily-refresh cases in `test_unreadable_formula.py`, importing `_materializer_svc`, `_upserted_rows`, `_due_schedule` (`test_readiness_materializer.py:48,:93,:27`) and `_mock_pool` (`test_opportunity_refresh.py:18`); the live row is built inline as `{**_row(_definition()), "user_id": ..., "strategy_id": ...}`; `test_readiness_materializer.py` must not import from `test_unreadable_formula.py`. Cycle-free: none of the three import-source modules imports `test_unreadable_formula.py`. Step 8a Files drop `test_readiness_materializer.py`, `test_opportunity_refresh.py`, `test_watchlist_readiness.py` (the last stays owned by Step 4) and list them as import sources; Verification still re-runs them, now labelled a harmless regression re-run. Cosmetic: Evidence reworded, `_opportunity_refresh_tick` is the servicer method `svc._opportunity_refresh_tick(schedule)` (`test_opportunity_refresh.py:42/:61/:82`), not a helper.
- Coverage unchanged: AC-1..13 and AC-15..27 covered (AC-14 retired); Step 8a `Covers` and Step Dependencies unaffected (only test placement within 8a).

## Session 2026-11-05 — sdd-review impl-spec loop round 6 (fixes)

All 3 items from round 6 verified against the tree (including a throwaway scratch run of the daily-refresh and kick cases against the unfixed tree, since deleted) and applied; item 1 adjusted. `design.md` untouched.

- Round 6 (impl-spec) item 1 (adjusted, Step 8a Instruction 4): verified `make_servicer()` passes no pool so `_opportunities_repo` is `None` (`servicer.py:~590`), `_opportunity_refresh_tick` swallows the resulting error in `except Exception` and retries soon (`:~5973-5979`), and `_FakeOppRepo.distinct_user_ids` returns `list(self.rows.keys())` (`test_analysis_servicer.py:~4628`, empty before any compute). The daily-refresh case now builds with `_materialized_svc(watchlists=[_wl(bindings=[("MYSZ","s-1")])], strategies={"s-1": _row(_definition())}, bars={"MYSZ": _FIRING_BARS})` and seeds `distinct_user_ids = AsyncMock(return_value=["bob"])`. Adjustments to the requested wording: `_FakeOppRepo.rows` is `dict[user_id, list[row dict]]`, so the assertion finds the `symbol == "MYSZ"` / `strategy_id == "s-1"` row inside `rows["bob"]` rather than indexing by symbol; `ExecuteFormula` metadata is asserted as `await_args.kwargs["metadata"] == [("x-user-id", "bob")]` (confirmed `owner_metadata("bob")`); the retry path also advances `pool.execute` once, so the `await_count == 1` check is paired with the existence of the `MYSZ` row. Cosmetic: the due-now precedents are `test_opportunity_refresh.py:50-66` and `:69-89` (was `:31-48`); a real `DurableSchedule` over `_mock_pool()` is kept because the `pool.execute` count is only observable through the pool (`_due_schedule()` would expose `advance.await_count` instead).
- Round 6 (impl-spec) item 2 (Step 8a Instruction 3, kick + `GetWatchlistReadiness`): verified `_cache_svc` does not set `_portfolio` (`GetWatchlistReadiness` aborts UNAVAILABLE on `None`, `servicer.py:4103`), its `read_many` returns `{}` (first call is PENDING and kicks), the in-flight guard is `svc._readiness_kicking` (`:629`, discarded in the kick's `finally` `:4329`), and the cache rows are keyed by `r["symbol"]`. The `_wl_svc` portfolio setup, drain loop, `upsert_many` feed-back, second call and post-drain `caplog` assertion are now spelled out in the spec. A scratch run confirmed the second call returns both rows RESOLVED (on the unfixed tree `MYSZ` is 1/2 with no marker, i.e. red for the right reason).
- Round 6 (impl-spec) item 3 (Step 8a Instruction 0(ii)): verified `_real_bars(symbol, closes, start=…)` exists in `tests/test_readiness_opportunities_source_symbol.py:23` (real `Bar` messages with `.close`/`.time.seconds`) and that module imports only `tests.test_analysis_servicer`, so importing it into `test_unreadable_formula.py` creates no cycle. Added `import asyncio`, `DurableSchedule` and `_real_bars` to the import list and recorded which cases use `_real_bars` vs `_FIRING_BARS`; the Files bullet's import-only sources list gains `_real_bars`.
- Round 6 (impl-spec) notes folded in: the materializer case carries a one-line test comment that `_materializer_svc` sets `svc._cfg.get_bool = MagicMock(return_value=enabled)` so the fundamentals gate is effectively ON there (harmless: no fundamentals operand; `_formula_fundamentals` is called without `failures` at `servicer.py:~6061`). AAPL is bound to `s-1` in the AC-3 kick builder and the AC-8 materializer builder, with the spec stating explicitly that the Gherkin binds it to `s-2`, `_cache_svc(strategy_row=…)` returns one row for any id (the materializer resolves bindings only against the single live row `s-1`), both symbols are RESOLVED, so assertions hold.
- Coverage unchanged: AC-1..13 and AC-15..27 covered (AC-14 retired); Step 8a `Covers` and Step Dependencies unaffected (test construction detail only).

## Session 2026-11-05 — sdd-review impl-spec loop round 7 (fixes)
- Round 7 (impl-spec): Step 8a Instruction 3 used `_ctx(_HEADERS)` (not imported in test_unreadable_formula.py); replaced with `ctx_with(_BOB)` (already imported). Round-7 review otherwise found no defects across all 14 steps; the review loop is considered converged.

## Session 2026-11-05 — sdd-execute sequential (sdd-batch-execute)

- **Up-front confirmation.** The operator approved the up-front plan (§5.4). `status.md` was already `in-progress`: the earlier batch run made that flip (commit `f92fb728`, feature.md row) but wrote no context.md entry for it, so this entry records it. Neither run changed the status after that.
- **§5.3 branch setup.** `git merge --no-edit origin/main-dev` → already up to date, with no conflicts. `scripts/ledger-guard.py --own-slug fix-analysis-admin-formula-refusal --base origin/main-dev --fix` → clean. Neither step produced a merge commit.
- **Re-spec (conditional directive, Steps 2, 1, 6, 11, 12).** Only the step bodies changed.
  - Step 2 (codegen toolchain). `scripts/buf-gen.sh` runs on the host and is not Docker-based. It needs host `grpc_tools`, which is missing (`ModuleNotFoundError`), plus the TS plugins and `tsc` from `node_modules`, which is not installed. Instruction 1 and Verification now run `pnpm install --frozen-lockfile` first, then use the cached pinned image with `localenv-setup.sh:87-92`'s invocation: `docker run --rm --platform linux/amd64 -v "<root>:/workspace" -w /workspace xstockstrat-codegen:latest ./scripts/buf-gen.sh`. A read-only `docker run` confirmed the image carries buf 1.72.0, the Go plugins in `/go/bin`, the global TS plugins and `grpc_tools`, but no `tsc`. Running `./scripts/localenv-setup.sh` itself is the fallback for a missing image, because it also rebuilds the image and writes `./certs/`; the host fallback is `docs/runbooks/codegen-toolchain-host-setup.md`. Files gain `gen/ts/analysis/v1/analysis.ts` (ts_proto). `analysis_connect.ts` is noted as checked in but expected to stay unchanged.
  - Step 1: the `reserved` grep hits `:200` and `:422`, both comments, so the additive-is-safe conclusion holds.
  - Step 6: `_not_found()` is at `test_unreadable_formula.py:34` (was `:36`).
  - Step 11: the `readiness-cue-${cueState}` testid is at `WatchlistReadiness.tsx:317` (render `:316`). The long-open `LockSimple` question is now **verified**: the published `@phosphor-icons/react@2.1.10` tarball (the `pnpm-lock.yaml:1915` resolution) exports `LockSimple`. The step still re-greps `node_modules` after install.
  - Step 12: `mockWatchlists` is `INVENTORY.md:44`; recon's `:71` is the `strat-notfound-readiness-01` row.
- **Husky hook.** The main worktree has no `node_modules` to symlink, and `core.hooksPath` (`/home/user/xstockstrat/.husky/_`) does not exist, so git ran no pre-commit hook for these docs-only commits. `--no-verify` was not used. Step 2's `pnpm install` restores the hook for the code steps.

## Session 2026-11-06 — sdd-execute sequential (sdd-batch-execute)

- **Up-front confirmation.** The operator approved the up-front plan (§5.4). `status.md` was already `in-progress`, so no status flip and no flip row this session.
- **§5.3 branch setup.** `git merge --no-edit origin/main-dev` → already up to date (`origin/main-dev` `94908ce6`; branch 6 commits ahead, 0 behind), no conflicts. `scripts/ledger-guard.py --own-slug fix-analysis-admin-formula-refusal --base origin/main-dev --fix` → clean. No merge commit.
- **Re-spec (conditional directive, Steps 2, 4, 6, 9, 11).** Only step bodies changed; no Files change.
  - Step 2: the `xstockstrat-codegen:latest` cache claim is unverifiable while the Docker daemon is stopped (`docker images` cannot answer); the containerd metadata under `/var/lib/docker` references the image. Instruction 1 and Verification now start `dockerd` when `docker info` fails and check `docker images xstockstrat-codegen` before the `docker run` (per `.claude/skills/sdd-execute/reference/tooling-setup.md:32`, `docs/runbooks/codegen-toolchain-host-setup.md:151`). All other Step 2 anchors re-verified.
  - Step 4: `TestEvaluateReadiness._svc` (`test_analysis_servicer.py:4360`) assigns `svc._strategies_repo = AsyncMock()` first (`:4362`) and stubs `ComputeIndicator` with an inline `lambda req, metadata=None: SimpleNamespace(result=[…])` (`:4369-4374`), not `_sma_resp`. Instruction 2(b) now uses the equivalent `_sma_resp` form already in `test_unreadable_formula.py:265`.
  - Step 6: `_period_keyed_stub` is `test_evaluator_traced.py:259` and `_counting_stub` `:273`; `:296-323` are the three tests that use them.
  - Step 9: the feature-215 bullet group in `docs/runbooks/mcp-tools.md` runs `:1075-1084` (last bullet "A held position on such a symbol still receives its exit-rule row." at `:1084`); the feature-289 group goes after `:1084`.
  - Step 11: `rollupReadiness` (`readinessRollup.ts:42-62`) branches inline (`if (!r || r.totalConditions === 0)` at `:51`) and does not call `readinessState`, so Instruction 1 now spells out an explicit `formulaUnreadable` arm between the `!r` and `totalConditions === 0` checks; the doc comment is `:37-41`. `LockSimple` cannot be re-checked locally (no `node_modules`); the re-check now targets `services/xstockstrat-ui/node_modules/@phosphor-icons/react/dist/index.d.ts` (pnpm does not hoist it to the root — `.npmrc` public-hoists only `@bufbuild/*`) and is part of Step 11's Verification.
- **Husky hook.** Still no `node_modules` in the main worktree and `core.hooksPath` (`/home/user/xstockstrat/.husky/_`) is absent, so git ran no pre-commit hook for these docs-only commits; `--no-verify` was not used.

## Session 2026-11-06 — sdd-execute sequential, Step 1

- Tooling setup (step 1): buf ✓ 1.72.0 (host, `/root/.local/bin/buf`). No other tool needed (TDD: N/A, `proto` category).

### Step 1 — proto: add `formula_unreadable` to `Opportunity` and `SymbolReadiness` [done]
- Added `bool formula_unreadable = 25;` after `fundamentals_gap = 24` in `message Opportunity` (3-line comment) and `bool formula_unreadable = 6;` after `conditions = 5` in `message SymbolReadiness` (2-line comment); no `reserved`, nothing renumbered. TDD: N/A (proto). Verification: `buf lint packages/proto/` exit 0; `buf breaking . --against "../../.git#branch=origin/main-dev,subdir=packages/proto"` (from `packages/proto`) exit 0, no output. Negative control (not committed): temporarily renumbering `fundamentals_gap` to 26 made the same `buf breaking` exit 100 ("Previously present field \"24\" … was deleted"), so the comparison against `origin/main-dev` is real in this worktree; file restored byte-identical before the green run.
- Files modified: `packages/proto/analysis/v1/analysis.proto`
- Deviations: none
- Husky hook: the main worktree still has no `node_modules` (a symlink would dangle) and `core.hooksPath` `/home/user/xstockstrat/.husky/_` is absent, so no pre-commit hook ran; `--no-verify` was not used. Step 2's `pnpm install` restores it.

## Session 2026-11-06 — sdd-execute sequential, Step 2

- Tooling setup (step 2): dockerd ⬇ started (`docker info` failed first) · `xstockstrat-codegen:latest` ✓ cached (`4e6dabffd89c`) · pnpm ✓ 9.15.9, `pnpm install --frozen-lockfile` ⬇ in this worktree (the main worktree has no `node_modules`, so no symlink) · uv ✓ (`uv sync --extra dev` in analysis + agent) · ruff ✓ (uv).
- Discovery: the dispatcher's digest was taken from the main checkout, which does not have Step 1. On `origin/feature/fix-analysis-admin-formula-refusal@ad9b548e` every Step 2 anchor resolves: `formula_unreadable = 25` / `= 6` at `analysis.proto:657,685`; `_row_to_opportunity` at `servicer.py:6803` (`fundamentals_unavailable` `:6827`); `TestOpportunityRowParity` at `test_analysis_servicer.py:6379`; `_opportunity_to_dict` at `client.py:839` (`fundamentals_gap` `:863`); `test_opportunity_projection_covers_every_proto_field` at `test_opportunity_projection.py:50`.

### Step 2 — proto-gen: regenerate stubs and carry the two descriptor-parity guards [done]
- Regen: `docker run --rm --platform linux/amd64 -v "$PWD:/workspace" -w /workspace xstockstrat-codegen:latest ./scripts/buf-gen.sh`. buf lint, buf generate, grpcio-tools and tsc all passed. `git status --porcelain packages/proto/gen` lists only these 8 files: `analysis.pb.go`, `analysis_pb2.py`, `analysis.ts`, `analysis_pb.ts`, and `ts/dist/analysis/v1/analysis{,_pb}.{js,d.ts}`. Nothing changed outside `analysis/v1`, so nothing needed reverting. `analysis_connect.ts` stayed unchanged, as expected.
- TDD: N/A for the generated stubs. The two existing parity guards proved the carries red then green.
  - RED (after regen, before the carries): `TestOpportunityRowParity::test_mapper_covers_every_proto_field` failed with `Extra items in the right set: 'formula_unreadable'` (1 failed, 3 passed). The agent `test_opportunity_projection_covers_every_proto_field` failed the same way (1 failed, 4 passed).
  - GREEN (after the carries): analysis 4 passed; agent 5 passed.
- Carries:
  - `_row_to_opportunity`: added `formula_unreadable=("formula_unreadable" in provenance)` with a one-line comment.
  - `_MAPPED`: added `"formula_unreadable"`.
  - `_opportunity_to_dict`: added `"formula_unreadable": o.formula_unreadable` after `fundamentals_gap`.
  - `_full_opportunity`: added `formula_unreadable=True`.
- Verification: analysis `ruff check .` passed and `ruff format --check .` reported 122 files already formatted. Agent `ruff check .` passed and `ruff format --check .` reported 65 files already formatted.
- Files modified: the 8 generated files above, `services/xstockstrat-analysis/app/handlers/servicer.py`, `services/xstockstrat-analysis/tests/test_analysis_servicer.py`, `services/xstockstrat-agent/app/client.py`, `services/xstockstrat-agent/tests/test_opportunity_projection.py`.
- Deviations: one, the placement of the `_MAPPED` comment (E501). See `## Deviation Log`.
- Husky hook: `pnpm install` ran husky's `prepare`, so `core.hooksPath=.husky/_` now resolves in this worktree and the pre-commit hook runs for this commit. `--no-verify` was not used.

## Session 2026-11-06 — sdd-execute sequential, Step 3

- Tooling setup (step 3): uv ✓ (`uv sync --extra dev` in analysis, this worktree had no `.venv`) · ruff ✓ (uv). Nothing else needed.
- Discovery (on `origin/feature/fix-analysis-admin-formula-refusal@739b9e80`): `_readiness_to_proto` `servicer.py:6471` (constructor `:6473`); `_symbol_readiness_from_json` `:6492`, which routes through `_readiness_to_proto` (`:6498`); call sites FAST `:4009`, SLOW `:4048` (`_readiness_to_proto(staged["readiness_json"])`), RESOLVED `:4201`; `_PROVENANCE_STRUCTURAL_MARKERS` `opportunities.py:27`; floor clause `:256-257`. The proto fields `SymbolReadiness.formula_unreadable = 6` and `Opportunity.formula_unreadable = 25` are present (`analysis.proto:685,657`, Steps 1-2). Both items the dispatcher digest listed as not found (the proto field and the `:4048` cite) resolve on this tree.

### Step 3 — service: analysis read side (SymbolReadiness funnel, floor clause, structural marker) [done]
- `_readiness_to_proto` now sets `formula_unreadable=bool(trace.get("formula_unreadable", False))`, so the FAST, SLOW and RESOLVED paths all carry it. `"formula_unreadable"` is appended to `_PROVENANCE_STRUCTURAL_MARKERS` with a 1-line comment, and the read floor gains `OR o.provenance ? 'formula_unreadable'` with the comment "feature 289: likewise the formula-unreadable row". `_SORT_ORDER_BY`, the count query and `replace_symbols` are untouched.
- TDD covers the AC-3/AC-17/AC-20 read-side halves. It used an uncommitted probe because Step 4 owns the durable tests (see Deviation Log).
  - RED: 3 failed. `_readiness_to_proto(...).formula_unreadable` returned `False is True`; `'formula_unreadable' in ['watchlist', 'position', 'denied', 'fundamentals_unavailable']` failed; the floor SQL lacked `o.provenance ? 'formula_unreadable'`.
  - GREEN: 3 passed. The probe was deleted before commit.
- Verification:
  - `uv run pytest tests/test_opportunities_repo.py tests/test_unreadable_formula.py tests/test_watchlist_readiness.py -q` → 60 passed.
  - `uv run pytest --cov=app --cov-fail-under=40` → 1529 passed, coverage 90.32%.
  - `ruff check .` → All checks passed.
  - `ruff format --check .` → 122 files already formatted.
- Files modified: `services/xstockstrat-analysis/app/handlers/servicer.py`, `services/xstockstrat-analysis/app/repositories/opportunities.py`.
- Deviations: two (RED via probe; comment and list layout fitted to 100 columns). See `## Deviation Log`.
- Husky hook: no pre-commit hook ran for this commit, and `--no-verify` was not used.
  - This worktree has no `node_modules`, and neither does the main worktree, so a symlink would dangle; it was removed. `core.hooksPath` `/home/user/xstockstrat/.husky/_` is absent.
  - Neither hook check applies to this commit anyway: its `lint-staged` globs only `services/xstockstrat-ui/**`, and its duplication check outside the UI is report-only.

## Session 2026-11-06 — sdd-execute sequential, Step 4

- Tooling setup (step 4): uv ✓ (`uv sync --extra dev` in analysis; this worktree had no `.venv`) · ruff ✓ (uv). Nothing else needed.
- Discovery (on `origin/feature/fix-analysis-admin-formula-refusal@34b20235`): the dispatcher digest called Steps 1-3 unapplied, but it read the main checkout. On this tree they are applied: `_readiness_to_proto` sets `formula_unreadable` (`servicer.py:6489`), `_PROVENANCE_STRUCTURAL_MARKERS` and the read floor carry the token (`opportunities.py`), and `_row_to_opportunity` derives it (`servicer.py:6830`). Every Step 4 test anchor resolved:
  - `test_opportunities_repo.py`: `_read` `:100`, `_fetch_pool`, the feature-215 templates `:549-558`, `test_row_to_opportunity_skip_row_round_trip` `:592`.
  - `test_watchlist_readiness.py`: `_wl_svc` `:27`, `_cache_row` `:55`.
  - `test_unreadable_formula.py`: `_definition` `:38`, `_row` `:69`, `_sma_resp` `:82`.
  - `servicer.py`: FAST gate `:4000-4010`; `_formula_fundamentals` `:1901`, called at `:3973`.

### Step 4 — test: analysis read side (seeded-row, floor, structural marker, funnel) [done]
- Added 5 tests.
  - `test_opportunities_repo.py`:
    - `test_read_floor_exempts_formula_unreadable`: `min_conviction=0.9` is bound at `$2`, and the floor SQL carries `o.provenance ? 'formula_unreadable'`.
    - `test_formula_unreadable_is_a_structural_marker`: `_primary_source(["formula_unreadable","uw"]) == "uw"` and `["watchlist","formula_unreadable"]` → `""`.
    - `test_row_to_opportunity_formula_unreadable_round_trip`.
  - `test_watchlist_readiness.py`: `test_formula_unreadable_cache_row_is_resolved_with_marker`. `MYSZ` and its sibling `AAPL` are both RESOLVED, and only `MYSZ` carries the marker.
  - `test_unreadable_formula.py`: `test_evaluate_readiness_fast_serves_formula_unreadable_marker`. FAST returns the marker and 0 total conditions, and `ExecuteFormula` is never awaited.
- TDD (AC-3, AC-17, AC-20 and AC-21 read-side halves):
  - RED: the five tests were run with the pre-Step-3 `servicer.py` and `opportunities.py` (from `739b9e80`), restored to HEAD afterwards → 5 failed, each for the right reason:
    - The floor SQL lacked the clause.
    - The marker was absent from `['watchlist', 'position', 'denied', 'fundamentals_unavailable']`.
    - The round-trip returned `source == 'formula_unreadable'`.
    - FAST and RESOLVED both reached the marker assertion (`False is True`).
  - GREEN on HEAD: 5 passed.
- Verification:
  - The 3 files: 65 passed.
  - `uv run pytest --cov=app --cov-fail-under=40`: 1534 passed, coverage 90.32%.
  - `ruff check .`: all passed. `ruff format --check .`: 122 files already formatted.
  - Seeded-row grep: one declaration per file. The `readiness_json` grep matches only `test_unreadable_formula.py:323`, because the watchlist file binds its single seeded dict to `marked` and passes it via `readiness_json=marked`.
- Files modified: `services/xstockstrat-analysis/tests/test_opportunities_repo.py`, `services/xstockstrat-analysis/tests/test_watchlist_readiness.py`, `services/xstockstrat-analysis/tests/test_unreadable_formula.py`.
- Deviations: one. `test_watchlist_readiness.py` also imports `_empty_readiness`, so the seeded row has the full trace shape. See `## Deviation Log`.
- Husky hook: neither this worktree nor the main worktree has `node_modules`, so a symlink would dangle and was removed. `core.hooksPath` `/home/user/xstockstrat/.husky/_` is absent, so no pre-commit hook ran. `--no-verify` was not used.

## Session 2026-11-06 — sdd-execute sequential, Steps 5 + 6 (combined, operator Option C)
- Operator decision (2026-11-06), on the Step 5 blocker: Option C. Steps 5 and 6 run as one unit. Step 6's tests, including the Instruction 8 re-pin, were authored first; then the saved Step 5 patch (`step5-evaluator.patch`) was applied and both steps' Verification ran together, landing as ONE "step 5+6" commit. Logged in `## Deviation Log`.
- Tooling setup (steps 5-6): uv ✓ (`uv sync --extra dev` in analysis; this worktree had no `.venv`) · ruff ✓ (uv). Nothing else needed.
- Discovery: the dispatcher digest confirmed every Step 5 anchor in `evaluator.py`:
  - `FormulaExecutionError` `:102`;
  - `_execute_formula` `:256-275`;
  - `_compute_component` `:491`, with the call at `:518`;
  - `_fundamentals_formula_series` `:552`, with the call at `:590`;
  - `_assemble_component_series` `:686`, with calls at `:739`, `:745` and `:752`;
  - `evaluate_conditions_traced` `:383`, with the serial call at `:429`, the concurrent call at `:447` and `parsed_rule` at `:466`;
  - `referenced_refs` `:958`;
  - `_empty_readiness` `:1134`.

  The Step 6 helpers were re-read in this tree: `_definition` `:40`, `_sma_resp` `:84`, `_evaluator`/`_execute` `:140-147`, and the pinned test at `:306`. In `test_readiness.py`: `_compute` `:86`, and `_real_bars` from `test_readiness_opportunities_source_symbol.py:23`.

### Step 5 — service: evaluator private sink and `UNREADABLE_FORMULA_CODES` [done]
- `UNREADABLE_FORMULA_CODES` sits beside `FormulaExecutionError` and replaces the inline tuple in the `raise_unreadable` branch, which is otherwise byte-identical and still checked first.
- `_execute_formula(..., unreadable_sink=None)` adds `comp.ref_name` to the sink outside the per-evaluator log dedupe, then returns `None`. The no-sink re-raise and NOT_FOUND-skip arms are unchanged.
- The keyword-only `unreadable_sink` is threaded through `_assemble_component_series` (all three sites), `_compute_component` and `_fundamentals_formula_series`.
- `evaluate_conditions_traced` creates a per-call `unreadable` set after the no-bars return and `_validate_definition`, and passes it at both the serial and the concurrent call. If the parsed rule references a refused ref, it returns `{**_empty_readiness(symbol), "formula_unreadable": True}`.
- `_assemble_sector_resolved` / `evaluate_with_series` / `GetIndicatorSeries` pass no sink and are untouched. `compute_readiness_row`'s signature is unchanged.
- Files modified: `services/xstockstrat-analysis/app/services/evaluator.py`.
- Deviations: landed with Step 6 in one commit (operator Option C).

### Step 6 — test: evaluator sink and `compute_readiness_row` [done]
- `test_unreadable_formula.py`: the `_traced_evaluator` / `_definition_two_formulas` helpers, plus `_execute(ev, sink=None)` (now with `ref_name="z"`). New tests:
  - The referenced refusal returns the marker with one log record (both codes, serial and concurrent; @AC-1, @AC-15).
  - An unreferenced refused component is skipped with no marker and one log line (@AC-16).
  - Refusal mixed with a `"Formula execution timed out after 5000ms"` component raises `FormulaExecutionError` for `f-timeout` (@AC-10, @AC-13 evaluator half).
  - A benchmark `source_symbol` refusal returns the marker (the `:752` site).
  - Direct `_execute_formula`: the sink collects `{"z"}` and returns `None`; with `raise_unreadable=True`, the raise comes first and the sink stays empty (@AC-5).
  - Two gathered candidates on one shared evaluator are both marked, with one log record.
  - Interim re-pin of `test_list_opportunities_unreadable_formula_is_not_unavailable` `(1, 2)` → `(0, 0)`, `data_unavailable False` kept.
- `test_readiness.py`: `_compute` gains `evaluator=` / `definition=`, and there is a new `test_compute_readiness_row_unreadable_formula_is_marked_not_sentinel`. A real `StrategyEvaluator` refuses PERMISSION_DENIED and gets `formula_unreadable True`, `0/0`, and `bar_epoch` = the last bar's seconds (≥ 0, never `-1`) (@AC-2). The `-1` sentinel tests are unchanged.
- TDD (AC-1, AC-2, AC-5, AC-10, AC-13, AC-15, AC-16):
  - RED on the pre-Step-5 evaluator: `pytest tests/test_unreadable_formula.py tests/test_readiness.py tests/test_evaluator_traced.py -q` → 23 failed, 40 passed.
    - PERMISSION_DENIED cases: the `AioRpcError` was re-raised.
    - NOT_FOUND referenced cases: the marker dict was missing.
    - The re-pin: `(1, 2) != (0, 0)`.
    - `compute_readiness_row`: the `AioRpcError` was re-raised.
    - Direct sink tests and the five existing `_execute` callers: `TypeError` on the unknown `unreadable_sink` keyword.
  - GREEN after the patch: 63 passed.
- Verification:
  - Combined Step 5 + 6 command: 63 passed.
  - `uv run pytest --cov=app --cov-fail-under=40`: 1553 passed, coverage 90.33%.
  - `ruff check .`: all passed. `ruff format --check .`: 122 files already formatted.
- Files modified: `services/xstockstrat-analysis/tests/test_unreadable_formula.py`, `services/xstockstrat-analysis/tests/test_readiness.py`.
- Deviations: four, all in `## Deviation Log`:
  - the combined commit;
  - the `_execute` RED noise;
  - the both-codes parametrization;
  - the `test_readiness.py` imports.
- Husky hook: the main worktree has no `node_modules`, so the symlink would dangle and was removed. `core.hooksPath` `.husky/_` is absent, so no pre-commit hook ran. `--no-verify` was not used.

## Session 2026-11-06 — sdd-execute sequential, Steps 7 + 8a + 8b (combined, operator Option C)
- Operator decision (2026-11-06), on the Step 7 blocker: Option C. Steps 7, 8a and 8b run as one unit. The 8a and 8b tests were authored first, including the 8b Instruction 2 re-pin of `test_grade_fundamentals_exclusion.py:396` to `== 2`. RED was captured on the pre-Step-7 tree. Then the saved `step7-servicer.patch` was applied unchanged, and all three Verification blocks ran together. The unit lands as ONE "step 7+8a+8b" commit, logged in `## Deviation Log`.
- Tooling setup: uv ✓ (`uv sync --extra dev` in analysis; this worktree had no `.venv`) · ruff ✓. Nothing else needed.
- Discovery: the dispatcher digest confirmed every Step 7 anchor in `servicer.py`:
  - `_row_for` `:5699`;
  - the heal `_retry_unavailable_symbols` `:4934`;
  - `_formula_fundamentals` `:1901`;
  - `_declared_formula_warmup` `:2512`;
  - `recompute_unscored_pairs` `:3064`;
  - the import block `:66-76`.

  The evaluator constant and marker from Steps 5+6 are present (`evaluator.py:104`). `git apply --check` of the saved patch was clean against `c9a6bfd0`/`8ef7abd8`, the blobs at `origin/feature/…@64b80f98`.

### Step 7 — service: servicer producer wiring (rows, heal, fundamentals classification, per-owner cache) [done]
- `_row_for`:
  - reads `formula_unreadable` from the trace and adds the `"formula_unreadable"` provenance token;
  - binds UNSPECIFIED and zeroes both axes for a non-held row, while a held row keeps `_resolve_action_tag`'s REDUCE/ADD and its signal axis;
  - `sym_unavailable` gains `and not unreadable`.
- Heal: a marked re-evaluation rewrites the row to the marker (`"unavailable"` dropped) with conviction 0.0. A held row omits `action` (COALESCE keeps the stored one) and keeps axis and composite. A non-held row binds `action` 0 with axis 0.0 and composite `None`. The selector is unchanged, so a marked row is never re-selected.
- `_formula_fundamentals` / `_declared_formula_warmup`: a refusal in `UNREADABLE_FORMULA_CODES` records no failure; an outage still records UNKNOWN. Either way the result is cached.
- `recompute_unscored_pairs` now keeps a per-owner `formula_caches`.
- `UNREADABLE_FORMULA_CODES` is imported.
- `evaluator.py`: constraint comment above the `declared_formula_fundamentals` `except` (`:697`).
- Files modified: `services/xstockstrat-analysis/app/handlers/servicer.py`, `services/xstockstrat-analysis/app/services/evaluator.py`.
- Deviations: combined commit; comment anchor drift (`:675` → `:697`).

### Step 8a — test: servicer paths (opportunities, readiness, heal, materializer, scheduled passes) [done]
- `test_analysis_servicer.py`: `_FakeOppRepo.read` exempts `"formula_unreadable"` from the floor, and `available_sources` skips it.
- `test_unreadable_formula.py`:
  - `_definition(z_ref, formula_id, strategy_id)`, with `_row` taking its id and name from the definition;
  - the `:293-307` rewrite (`formula_unreadable True`);
  - opportunities with both codes: the s-1 marker, the floor, `source`, `available_sources`, one log record and no "indicator RPC failed", with the unreferenced s-2 evaluated;
  - the held REDUCE and ADD examples;
  - the s-3 sibling and a `tech` `UNAVAILABLE` sibling, in both completion orders;
  - the AC-26 clear;
  - AC-4 outage, AC-10 recompute timeout (rows kept), AC-13 `EvaluateReadiness` timeout raises;
  - the new AC-11 live-loop warning test;
  - `EvaluateReadiness` SLOW→FAST;
  - kick + `GetWatchlistReadiness`;
  - the daily refresh with owner metadata;
  - the materializer (owner NOT_FOUND / PERMISSION_DENIED);
  - the heal (watchlist and held), never re-selected;
  - heal recovery.
- Files modified: `services/xstockstrat-analysis/tests/test_unreadable_formula.py`, `services/xstockstrat-analysis/tests/test_analysis_servicer.py`.

### Step 8b — test: servicer paths (gate-ON fundamentals classification, per-owner formula cache) [done]
- New tests:
  - `test_backtest_fundamentals_guard.py`: @AC-22, both start branches: FORMULA_ERROR, `backtest symbol AAPL not evaluated: NOT_FOUND`, no "rerun", INSUFFICIENT_DATA.
  - `test_grade_fundamentals_exclusion.py`:
    - @AC-23 `ScoreStrategy` with a refusal → OK with trailer `"[]"`; an outage still aborts UNAVAILABLE;
    - the `:396` re-pin to `GetFormula` `== 2`;
    - the u1-refused/u2-readable poisoning test in both orders.
  - `test_opportunities_fundamentals_guard.py`: @AC-24, the compute and heal marker, not re-selected; @AC-25, the `GetFormula` UNAVAILABLE row stays `unavailable` with ENTER.
  - `test_fundamentals_pit_pager.py`: NOT_FOUND parameters. Servicer → `{}`/`{}`; evaluator → UNKNOWN (the live twin is unchanged).
- Files modified: `services/xstockstrat-analysis/tests/test_backtest_fundamentals_guard.py`, `services/xstockstrat-analysis/tests/test_grade_fundamentals_exclusion.py`, `services/xstockstrat-analysis/tests/test_opportunities_fundamentals_guard.py`, `services/xstockstrat-analysis/tests/test_fundamentals_pit_pager.py`.

### TDD and Verification (Steps 7 + 8a + 8b)
- TDD, RED on the pre-Step-7 tree:
  - `pytest tests/test_unreadable_formula.py`: 11 failed, 40 passed. The opportunities, held, sibling, AC-26, daily-refresh and heal cases failed on `'formula_unreadable' in [...]`, and the `:293-307` rewrite on `formula_unreadable False is True`.
  - The four 8b files: 8 failed, 72 passed.
    - @AC-22: no AAPL diagnostic, because the "fundamentals fetch failed — not evaluated" UNKNOWN path was taken.
    - `:396`: `1 == 2`.
    - @AC-23: `Exception: aborted` (UNAVAILABLE).
    - Poisoning: `KeyError ('u2', …)` and `1 == 2`.
    - @AC-24: `['watchlist', 'unavailable']`.
    - pit pager NOT_FOUND: `{('formula','divf'): UNKNOWN} != {}`.
- GREEN after the patch: the same five files, 131 passed.
- Green on arrival (see `## Deviation Log`): the readiness half (@AC-2/3/8/20), already delivered by Step 5, and the characterization cases (@AC-4/10/11/12/13/25, the evaluator NOT_FOUND pin).
- Verification:
  - Step 8a command: 478 passed. Step 8b command: 80 passed.
  - `uv run pytest --cov=app --cov-fail-under=40`: 1582 passed, coverage 91.04%.
  - `ruff check .`: all passed. `ruff format --check .`: 122 files already formatted.
  - `grep UNREADABLE_FORMULA_CODES`: servicer `:68`, `:1929` and `:2549`; evaluator `:104`, `:267` and `:272`.
  - C-13 grep `def _not_found|def _rpc_error`: no new declaration (pre-existing per-file helpers only).
- Header propagation: no new outbound gRPC call. The daily-refresh and materializer tests assert owner-only `[("x-user-id", "bob")]` metadata on `ExecuteFormula`.
- Deviations: five, all in `## Deviation Log`:
  - the combined commit;
  - green-on-arrival readiness cases;
  - 8a test construction;
  - 8b test construction;
  - the evaluator comment anchor.
- Same-PR rule still open: Step 13's strat-lab edits must ship in the integration PR with this gate-ON backtest change (Step Dependencies). This unit does not merge to `main-dev` on its own.
- Husky hook: the main worktree has no `node_modules`, so the symlink would dangle and was removed. `core.hooksPath` `.husky/_` is absent, so no pre-commit hook ran. `--no-verify` was not used.

## Session 2026-11-06 — sdd-execute sequential, Step 9
- Tooling setup (step 9): uv ✓ (`uv sync --extra dev` in agent; this worktree had no `.venv`) · ruff ✓ 0.16.9 (uv). Nothing else needed.
- Discovery: the dispatcher digest read the main worktree, which lacks Steps 1-8, and reported `formula_unreadable` missing. On `origin/feature/fix-analysis-admin-formula-refusal@a68b3152` the Step 2 projection key is present (`client.py:864`), as is the proto field (`analysis.proto:657`). Other anchors confirmed: `list_opportunities` `tools.py:1684`, field list `:1697-1701`; runbook feature-215 group ends `mcp-tools.md:1084`; `data_unavailable` absent from the agent `CLAUDE.md`; no `list_opportunities` in `plugins/strat-lab`; no `EvaluateReadiness` in the agent.

### Step 9 — service: agent `list_opportunities` consumer surface (C-14) [done]
- `tools.py`: the `list_opportunities` docstring field list gains `formula_unreadable (...)` after `fundamentals_gap`, worded per Instruction 1.
- `mcp-tools.md`: a feature-289 bullet group follows the feature-215 group. It covers the semantics, the non-held/held action rule, the `min_conviction` floor exemption, never a `source` / `available_sources` facet, and mutual exclusion with `data_unavailable` / `fundamentals_unavailable`.
- Agent `CLAUDE.md` unchanged (Instruction 3). No tool added, so the forty-five count stands.
- TDD (@AC-6 docstring half), via the uncommitted probe `tests/test_zz_step9_probe.py`. RED: `assert "formula_unreadable (true = the row's strategy references a formula" in normalized` failed (1 failed). GREEN: 1 passed. Probe deleted before commit.
- Verification:
  - Step 10's three files plus `test_list_correlation_parity.py`: 214 passed.
  - `uv run pytest --cov=app --cov-fail-under=40`: 650 passed, coverage 84.49%.
  - `ruff check .`: all passed. `ruff format --check .`: 65 files already formatted.
- Files modified: `services/xstockstrat-agent/app/tools.py`, `docs/runbooks/mcp-tools.md`.
- Deviations: two, both in `## Deviation Log` (probe RED; `available_sources` wording).
- Husky hook: the main worktree has no `node_modules`, so a symlink would dangle and was removed. `core.hooksPath` `.husky/_` is absent, so no pre-commit hook ran and prettier did not format `mcp-tools.md`. `--no-verify` was not used.

## Session 2026-11-06 — sdd-execute sequential, Step 10
- Tooling setup (step 10): uv ✓ (`uv sync --extra dev` in agent; this worktree had no `.venv`) · ruff ✓ (uv). Nothing else needed.
- Discovery: the dispatcher digest read the main worktree, which lacks Steps 1-9, and called the step blocked on Step 2. On `origin/feature/fix-analysis-admin-formula-refusal@3b5cbb69` both prerequisites are present: the projection key `client.py:864` (Step 2), the `_full_opportunity` `formula_unreadable=True` line (Step 2), and the docstring clause `tools.py:1702-1705` (Step 9). Test anchors confirmed: `test_fundamentals_skip_row_projection` (projection model), `TestListOpportunitiesClient` `test_client.py:1282` with the feature-185 case at `:1352`, the docstring pattern `test_tools.py:1103`, and the `list_opportunities` tool tests from `:2049`.

### Step 10 — test: agent projection [done]
- `test_opportunity_projection.py`: `test_formula_unreadable_projected_true_and_false`. A marked `MYSZ`/`s-1` row projects `True` with `data_unavailable`/`fundamentals_unavailable` `False`; a default message projects `False`; a `data_unavailable` row projects `formula_unreadable False` (@AC-6).
- `test_client.py`: `TestListOpportunitiesClient.test_projects_formula_unreadable_row`. Through `client.list_opportunities`, `["opportunities"][0]` is `MYSZ`/`s-1` with `formula_unreadable True`, `data_unavailable False`, action UNSPECIFIED; the evaluated `[1]` row is `False` (@AC-6).
- `test_tools.py`: `test_list_opportunities_docstring_documents_formula_unreadable` reads the registered description (whitespace-normalized) and asserts the `formula_unreadable (true = the row's strategy references a formula` clause and `never also data_unavailable`.
- `_full_opportunity` stays the single fixture (Instruction 4); no new fixture declaration (C-13).
- TDD (@AC-6): the spec calls these guards green on arrival, since Steps 2 and 9 landed first. Their teeth were still shown by swapping in the pre-implementation blobs (`client.py@ad9b548e`, pre-Step-2; `tools.py@a68b3152`, pre-Step-9), restored to HEAD afterwards. RED: 3 failed — two `KeyError: 'formula_unreadable'` (projection and client mapping), and the docstring clause assertion. GREEN on HEAD: 3 passed.
- Verification:
  - `uv run pytest tests/test_opportunity_projection.py tests/test_client.py tests/test_tools.py -q`: 208 passed.
  - `uv run pytest --cov=app --cov-fail-under=40`: 653 passed, coverage 84.49%.
  - `ruff check .`: all passed. `ruff format --check .`: 65 files already formatted.
- Files modified: `services/xstockstrat-agent/tests/test_opportunity_projection.py`, `services/xstockstrat-agent/tests/test_client.py`, `services/xstockstrat-agent/tests/test_tools.py`.
- Deviations: one — the client mapping case is a sibling test, not an edit of the feature-185 case. See `## Deviation Log`.
- Agent consumer surface (Steps 9-10) is complete.
- Husky hook: the main worktree has no `node_modules`, so a symlink would dangle and was removed. `core.hooksPath` `.husky/_` is absent, so no pre-commit hook ran. `--no-verify` was not used.

## Session 2026-11-06 — sdd-execute sequential (sdd-batch-execute), §5.3 re-spec before Step 11

- Operator approved the up-front plan. Status was already `in-progress`, so it was not flipped.
- Branch setup: a normal merge of `origin/main-dev` into the detached `origin/feature/fix-analysis-admin-formula-refusal` merged cleanly as `282cd49f` (no conflicts, so the ledger files needed no hand resolution). It brings in feature 282 (`UNSERVABLE_REASON`, `RefusedSymbolsNotice`) and the 293 live-loop WARN latch. `scripts/ledger-guard.py --own-slug fix-analysis-admin-formula-refusal --base origin/main-dev --fix` reported clean, with nothing to repair.
- Re-spec, conditional directive, with every citation re-checked against the post-merge tree:
  - Step 11: `opportunityShared.test.ts` states list `:9` → `:11`; `SemanticRole` `opportunityShared.tsx:19` → `:20`; `WatchlistReadiness.tsx` `barVariant`/`stateLabel` `:52`/`:74` → `:51`/`:73`; `SectionRenderer.tsx` `SignalRow` `:154-158` and badge chain `:171`, readiness slot `:235-246`; detail header `:1008-1014`.
  - Step 11, merge impact: feature 282 added `UNSERVABLE_REASON` and its test block to `opportunityShared.{tsx,test.ts}`. Neither touches `READINESS_CUE`.
  - Step 11, `LockSimple`: still not checkable locally because there is no `node_modules`. The lockfile pin `2.1.10` is unchanged and the npm registry resolves it, so the step's mandatory post-install grep stays.
  - Step 12: `watchlistMock.ts` `ReadinessStateOverrides` `:39` → `:52`, and the RESOLVED `READINESS_BUCKET_OVERRIDE[b.symbol]` spread `:254` → `:280` (shifted by feature 282's `unservable` arg). Both the Codebase Evidence and Instruction 2 were updated.
  - Step 14: added `services/xstockstrat-analysis/acceptance/fix-backtest-silent-symbol-skip.feature` to Files. `@AC-7 @feature-275` (`:63`) has no gate precondition. This feature's `@AC-22` is the same outcome with the gate ON, so it is promoted beside `@AC-7 @feature-275` as `@feature-289`, and the feature-275 text is not edited (PRESERVE).
  - Step 14, open item for the integration-time `scenario-promoter`: no listed Step 14 suite is a ScoreStrategy suite, so `@AC-23` (gate-ON ScoreStrategy) has no named durable home yet. Surface its owning suite at integration; do not guess it here.
  - Step 13: every citation verified, and the step body is unchanged.
- Husky hook: the main worktree has no `node_modules` and `.husky/_` is absent, so no pre-commit hook ran. `--no-verify` was not used.
