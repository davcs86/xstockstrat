# Context Log: fix-analysis-held-position-drains

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-17 (/sdd-triage)

- Bug recorded via defect report `docs/reports/2026-11-17-analysis-held-position-drains-trust-page-token-defect.md` (no GitHub issue — Issues disabled): analysis held-position drains trust next_page_token and return partial results as success
- Source: feature 353 (`fix-listpositions-nextpagetoken-skips`) design § Open Risks follow-up
- Severity: SEV-3
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), context.md
- Affected services (from report): xstockstrat-analysis (upstream, unchanged: xstockstrat-portfolio `ListPositions`)
- Root cause hypothesis: Both loops predate the token-looping consumer rule (feature 257) and copy the best-effort pattern: the exit trusts the server token and the error path returns accumulated state. Shared helper vs in-place hardening is an open design question (operator decision 2026-11-17: decide in design).
- Recommended design depth: quick → `/sdd-design fix-analysis-held-position-drains quick` (rationale: SEV-3, single service, no proto/migration/config — rubric says skip; operator chose quick so the helper-vs-in-place fork is debated)
- Development branch: feature/fix-analysis-held-position-drains
- Operator decision (2026-11-17): whether both drains share one helper or are hardened in place is decided in `/sdd-design` (not pre-constrained).
- Must PRESERVE `@AC-16 @feature-294` (`services/xstockstrat-analysis/acceptance/signal-map-instrumentation.feature`: a failed held drain is still counted) and `@AC-8 @feature-262` (`fix-analysis-owner-scope.feature`: drains stay owner-scoped).
- Sibling loops with the same shape (`live_loop.py:535` watchlists, `:601` signals, `:178` fundamentals universe) are out of scope unless design argues otherwise.

## Session 2026-11-17 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria verdict: PASS WITH WARNINGS (0 fails, 0 floor breaches).
- Warnings:
  - Criterion 8 / FR-6: `@AC-4` (non-gRPC exception in `_drain_held_symbols`) was not red-before-green, because `servicer.py:6428` catches only `grpc.RpcError` and a non-gRPC exception already propagates. **Resolved:** dropped `@regression` from `@AC-4` (kept as a guard scenario), and FR-6 now says only `@regression` scenarios must fail on current code.
  - FR-4 live loop: `live_loop.py:401-402` caches `held_cache` only on success and the handler at `:409` catches only `ValueError`, so a failed owner could be re-drained once per strategy and the metric fired per strategy. **Resolved:** FR-4 now states a failed owner is drained at most once per cycle and `drain_failures{source=held}` is recorded once per failed owner per cycle; `@AC-7` now uses two `o-1` strategies and asserts exactly one `ListPositions` call for `o-1` and a metric increase of exactly 1.
  - Criterion 8 wording: several `Then` steps assert drain-boundary detail (call counts, "raises to its caller"). Accepted for a bug fix; RPC-boundary outcomes are covered by `@AC-5`/`@AC-6`.
  - Criterion 11 (advisory): Consumer Surface uses prose, not checkboxes. Accepted.
  - Trading-domain C-1 to C-5 detection grep fired on "portfolio"/"broker"/"order"; satisfied by the spec's explicit no-broker/order/fill/BrokerType declaration.
- Overlap findings (WARN, no FAIL):
  - `services/xstockstrat-analysis/app/handlers/servicer.py` — same function `_compute_opportunities` edited by `308-fix-analysis-per-symbol-isolation` (spec-ready); rebase/manual-merge risk.
  - `servicer.py` — `327-fix-analysis-evidence-dry` (spec-ready) edits a disjoint region (live-gate SQL literal); rebase-only.
  - `services/xstockstrat-analysis/app/engine/live_loop.py` — 327 names live_loop.py as a live-gate SQL site; unconfirmed whether it edits the file (possible WARN).
  - No config, proto or migration overlap. Context only: 353 (upstream ListPositions fix, soft precedence, not a hard dependency), 357, 358 (draft peers, no shared file).
  - Merge-order: no entry required (rebase-level overlaps only).
- Recommended design depth: quick (SEV-3, single service, no proto/migration/config, rebase-only overlap; one round settles the shared-helper vs in-place fork).

OPERATOR DECISIONS (binding, recorded 2026-11-17):
- Operator 2026-11-17: whether live_loop._drain_held and servicer._drain_held_symbols share one helper or are hardened in place is decided in design, not pre-constrained.
- Follow docs/roadmap/ledger/fails.md:3311: fail closed, reject a token equal to the one sent, test against a fake that ignores the token.
- PRESERVE @AC-16 @feature-294 (signal-map-instrumentation.feature) and @AC-8 @feature-262 (fix-analysis-owner-scope.feature).
- Do not touch features 351, 353 or 354.
- Red-before-green is mandatory.
