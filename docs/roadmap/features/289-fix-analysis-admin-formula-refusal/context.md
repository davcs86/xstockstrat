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
