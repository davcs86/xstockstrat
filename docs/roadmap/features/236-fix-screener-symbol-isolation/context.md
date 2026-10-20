# Context Log: fix-screener-symbol-isolation

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-20 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-19-analysis-screener-no-per-symbol-isolation-defect.md`
  (Issues disabled). Source: Latent-bugs row in `services/xstockstrat-analysis/docs/context-constitution-findings.md:20`.
- Severity: SEV-2. Environment: dev (main-dev) @ 1302e6d. Routed to SDD path (Track C).
- Created: feature.md, product-spec.md, acceptance.feature (AC-1..AC-3), context.md.
- Affected services: xstockstrat-analysis.
- Root cause hypothesis: `asyncio.gather` at `screener.py:115` has no `return_exceptions`, and
  `_eval_symbol` has no outer guard; it catches only `grpc.RpcError` (`:229`).
- Confirmation evidence: the report's reproduction (a `ZeroDivisionError` from `compute_signal_score` over
  50 symbols makes the RPC abort UNKNOWN with no results) was not re-run at triage. A code read on
  main-dev @ 37b9a56 confirms the shape: `screener.py:115` gather with no `return_exceptions`, and the
  `:256` `compute_signal_score` call is unguarded.
- Design forks for /sdd-design:
  - degraded-row shape: INSUFFICIENT_DATA re-triggers the UI poll loop (feature 144 note), so the options are
    `score_unavailable` or dropping the row;
  - the isolation point;
  - `CancelledError` must keep propagating (AC-2). The servicer's `asyncio.wait_for` →
    DEADLINE_EXCEEDED lives at `app/handlers/servicer.py:3786-3795`.
  - The servicer maps a `ValueError` out of `screen()` to INVALID_ARGUMENT (`:3796`). That error is raised by
    `_validate_fundamental_metrics` before the fan-out, and per-symbol isolation must not absorb it (AC-3).
- Recommended design depth: quick → `/sdd-design fix-screener-symbol-isolation quick` (rationale: SEV-2,
  single service, no proto/migration/config anticipated; escalate to full if a new `ScreenResultStatus`
  value is chosen).
- Development branch: feature/fix-screener-symbol-isolation
