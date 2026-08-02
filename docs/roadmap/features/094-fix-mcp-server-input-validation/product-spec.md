# Product Spec: fix-mcp-server-input-validation

**Type**: bug
**Source Report**: `docs/reports/2026-08-01-mcp-tools-alignment-triage.md` (F-9 code, F-10 notify validation)
**Severity**: SEV-3
**Created**: 2026-08-02

---

## Problem Statement

Two small, independent server-side input-validation gaps:

- **Conviction (F-9).** `ingest_signal`'s conviction has no range check in the servicer. A value
  `> 1.0` escapes Python validation and dies as a DB CHECK → `INTERNAL` (not `INVALID_ARGUMENT`);
  a negative value is swallowed by the `> 0.0` NULL sentinel and silently stored as NULL. (The
  false "source default" docstring/runbook claim was already fixed in the docs-only pass.)
- **Notify (F-10).** `notify.emitAlert` applies no field validation — empty `title`/`body` are
  stored and delivered blank (proto3 strings are never NULL, so the `NOT NULL` columns never fire).

Expected: out-of-range conviction and empty title/body are rejected with `INVALID_ARGUMENT` at the
service boundary.

## Reproduction Steps

1. `ingest_signal(..., conviction=1.5)` → `INTERNAL` (DB CHECK), not `INVALID_ARGUMENT`.
2. `ingest_signal(..., conviction=-0.1)` → silently stored NULL, call succeeds.
3. `emit_alert(title="", body="")` → stored and delivered blank.

## Root Cause Hypothesis

RC-4-adjacent — validation delegated to the DB CHECK (surfacing as INTERNAL) or absent entirely.
See report F-9 / F-10 (#8).

## Affected Services

`xstockstrat-ingest` (`app/handlers/servicer.py` `IngestSignal` conviction guard),
`xstockstrat-notify` (`src/grpc/notifyServiceImpl.ts` `emitAlert` title/body guard).

## Fix Scope

- [ ] No proto changes anticipated.
- [ ] No database migrations anticipated.
- [ ] No config key changes anticipated.
- Two independent single-clause guards; can be split into two PRs if convenient.

## Acceptance Criteria

- [ ] `ingest_signal` with `conviction > 1.0` or `< 0.0` → `INVALID_ARGUMENT` (RED: currently
      `INTERNAL` / silent NULL). A valid value in `[0,1]` is unaffected.
- [ ] `emit_alert` with empty `title` or `body` → `INVALID_ARGUMENT` (RED: currently accepted).
- [ ] Existing tests pass.

## Out of Scope

- Making a genuine zero-conviction representable (needs a proto-presence change) — noted as a
  follow-up in report F-9, not part of this SEV-3 fix.
- `emit_alert` authorization gating — that is feature 092 (F-11).
