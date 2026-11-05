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
