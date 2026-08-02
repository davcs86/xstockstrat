# Product Spec: fix-mcp-signal-source-verbs

**Type**: bug
**Source Report**: `docs/reports/2026-08-01-mcp-tools-alignment-triage.md` (F-6)
**Severity**: SEV-2
**Created**: 2026-08-02

---

## Problem Statement

`manage_signal_source` presents register/update/deactivate as distinct safe verbs, but the ingest
backend implements register and update as **one blind full-replace upsert** (report F-6):

- register on an existing slug silently overwrites it; update on an unknown slug silently creates it;
- every omitted field **blanks** the stored value — omitting `credentials_ref` NULLs the stored
  reference (`has_credentials` flips false);
- the agent always sends `active=True`, so any update also **reactivates** a deactivated source (the
  only reactivation path — update cannot be decoupled from reactivation);
- no slug-format validation, and `mediated_authenticated_website` escapes the `credentials_ref`-required
  check that plain `authenticated_website` has.

Expected: register → `ALREADY_EXISTS` on conflict; update → `NOT_FOUND` + field-mask merge; update
decoupled from reactivation; the `mediated_authenticated_website` credential gap closed.

## Reproduction Steps

1. Register a source with `credentials_ref`. 2. `update` it changing only `display_name` (omit
   `credentials_ref`) → stored reference is NULLed, `has_credentials` flips false. 3. `update` a
   deactivated source → it is silently reactivated. 4. `update` a slug that doesn't exist → a new
   source is silently created.

## Root Cause Hypothesis

RC-2 (feature-070 partial-merge never propagated to `ManageSignalSource`), RC-6 (one-way/forced
lifecycle). See report F-6.

## Affected Services

`xstockstrat-ingest` (`app/handlers/servicer.py`, `app/repositories/signal_sources.py`, possibly the
proto request for an `update_mask` field), `xstockstrat-agent` (`app/client.py`, `app/tools.py`).

## Fix Scope

- [x] Proto changes possible — an `update_mask` (or explicit register/update RPCs) on the ingest
      signal-source request; confirm during `/sdd-design` whether a field-mask can be server-side only.
- [ ] No database migrations anticipated.
- [ ] No config key changes anticipated.

## Acceptance Criteria

- [ ] register on an existing slug → `ALREADY_EXISTS`; update on an unknown slug → `NOT_FOUND`.
- [ ] a single-field update preserves all omitted fields, including `credentials_ref` (no wipe).
- [ ] update no longer forces `active=True`; a separate/explicit reactivation exists.
- [ ] `mediated_authenticated_website` requires `credentials_ref` like `authenticated_website`.
- [ ] RED-first tests for each; existing tests pass.

## Out of Scope

- Broader credential-storage redesign (that is F-1 / feature 093).
- Refactoring unrelated to the verb split.
